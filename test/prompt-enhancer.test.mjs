import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parsePromptPresets,createPromptEnhancer,PRESET_FILES,ENHANCER_MODEL} from '../prompt-enhancer.mjs';
import {createStudio} from '../server.mjs';
const imageText='# Edit this file\n\n[My image preset]\nCamera: 35mm.\nLighting: soft tungsten.\nTreatment: GRAIN-EXACT.\n\n[Other image preset]\nDo not crop.\n';
const videoText='[My video preset]\nLocked camera.\nLighting: daylight.\n';
const reply=text=>Response.json({choices:[{message:{content:text},finish_reason:'stop'}],usage:{cost:.00012}});
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'fwrd-enhance-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,PRESET_FILES.image),imageText);await writeFile(join(dir,PRESET_FILES.video),videoText);return dir;}
const base={projectId:'default',mode:'image',model:'nano-pro',prompt:'a red ball on table'};
test('preset files parse titles, multiline prompts and CRLF without changing preset content',()=>{
  const presets=parsePromptPresets(imageText.replaceAll('\n','\r\n'),'image');assert.equal(presets.length,2);assert.equal(presets[0].title,'My image preset');assert.equal(presets[0].prompt,'Camera: 35mm.\nLighting: soft tungsten.\nTreatment: GRAIN-EXACT.');
  assert.equal(presets[0].id,parsePromptPresets(imageText,'image')[0].id);assert.notEqual(presets[0].id,parsePromptPresets(imageText,'video')[0].id);
  assert.deepEqual(parsePromptPresets('# Instructions only\n','image'),[]);
  for(const text of ['Missing header','[Title]\n','[Same]\na\n[Same]\nb','[Title]\n'+'x'.repeat(8001),'x'.repeat(128*1024+1)])assert.throws(()=>parsePromptPresets(text,'image'));
  assert.throws(()=>parsePromptPresets(imageText,'../../secrets'));
});
test('only the base prompt reaches OpenRouter; exact preset text is appended after enhancement',async t=>{
  const dir=await directory(t),calls=[],enhancer=createPromptEnhancer({directory:dir,fetchImpl:async(url,options)=>{calls.push({url,options});return reply('A red ball rests on a table.');}}),config=await enhancer.config('image');
  const result=await enhancer.enhance({...base,presetId:config.presets[0].id},'test-router-key');
  assert.equal(result.enhanced,'A red ball rests on a table.');assert.equal(result.combinedPrompt,result.enhanced+'\n\n'+config.presets[0].prompt);assert.equal(result.preset.prompt,config.presets[0].prompt);
  const payload=JSON.parse(calls[0].options.body);assert.equal(payload.model,ENHANCER_MODEL);assert.equal(payload.messages[1].content,base.prompt);assert(!calls[0].options.body.includes('GRAIN-EXACT'));assert.match(payload.messages[0].content,/Do not add camera details/);assert.match(payload.messages[0].content,/lighting setups/);assert.match(payload.messages[0].content,/preserve them without elaborating/);
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer test-router-key');assert.equal(result.cost,.00012);assert(!JSON.stringify(result).includes('test-router-key'));
  const plain=await enhancer.enhance({...base,presetId:''},'test-router-key');assert.equal(plain.combinedPrompt,plain.enhanced);assert.equal(plain.preset,null);
});
test('video instructions preserve existing actions without adding camera or motion; preset edits reload',async t=>{
  const dir=await directory(t),calls=[],enhancer=createPromptEnhancer({directory:dir,fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return reply('A person walks toward the door and stops.');}});
  const first=await enhancer.config('video');await writeFile(join(dir,PRESET_FILES.video),'[My video preset]\nUpdated treatment, exactly.\n');
  const result=await enhancer.enhance({...base,mode:'video',model:'wan3',prompt:'person walk to door then stop',presetId:first.presets[0].id},'test-router-key');
  assert.match(calls[0].messages[0].content,/do not invent motion/);assert.equal(result.preset.prompt,'Updated treatment, exactly.');assert.equal((await enhancer.config('image')).presets[0].title,'My image preset');
  await assert.rejects(enhancer.enhance({...base,presetId:first.presets[0].id},'test-router-key'),/changed or was removed/);
});
test('invalid and incomplete enhancements fail without silently truncating a preset or returning an edited prompt',async t=>{
  const dir=await directory(t);
  for(const [name,fetchImpl,patch,pattern] of [
    ['length',async()=>Response.json({choices:[{message:{content:'Partial'},finish_reason:'length'}]}),{},/incomplete/],
    ['empty',async()=>reply(''),{},/no usable/],
    ['too long',async()=>reply('x'.repeat(30001)),{},/character limit/],
    ['invalid JSON',async()=>reply('Not JSON'),{prompt:'{"subject":"a ball"}'},/valid JSON/],
    ['refusal',async()=>Response.json({choices:[{message:{refusal:'No'}}]}),{},/declined/],
    ['credits',async()=>Response.json({error:{message:'test-router-key'}},{status:402}),{},/needs credits/],
    ['connection',async()=>{throw Error('test-router-key');},{},/interrupted/]
  ])await t.test(name,async()=>{const enhancer=createPromptEnhancer({directory:dir,fetchImpl});await assert.rejects(enhancer.enhance({...base,...patch},'test-router-key'),error=>pattern.test(error.message)&&!error.message.includes('test-router-key'));assert.deepEqual(enhancer.activeProjectIds(),[]);});
});
test('local enhancement API isolates files and credentials and reports active enhancements to the updater',async t=>{
  const dir=await directory(t);let release;const pending=new Promise(resolve=>release=resolve),calls=[];
  const app=await createStudio({dataDir:join(dir,'data'),promptPresetDir:dir,key:'test-fal-key',openRouterKey:'test-router-key',autoArchive:false,pollMs:3600000,fetchImpl:async(url,options)=>{calls.push({url,options});return pending;}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const url='http://127.0.0.1:'+app.server.address().port,config=await fetch(url+'/api/bootstrap').then(r=>r.json());assert(config.features.promptEnhancer);
  const post=(body,headers={})=>fetch(url+'/api/enhance-prompt',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':config.csrf,...headers},body:JSON.stringify(body)});
  const presets=await fetch(url+'/api/prompt-presets?mode=image').then(r=>r.json());assert(presets.keyConfigured);assert(!JSON.stringify(presets).includes('test-router-key'));
  assert.equal((await post(base,{'X-Studio-Token':'invalid'})).status,403);assert.equal((await post(base,{Origin:'https://other.example'})).status,403);
  assert.equal((await post({...base,projectId:'missing'})).status,400);assert.equal((await post({...base,mode:'llm'})).status,400);
  assert.equal((await fetch(url+'/api/prompt-presets?mode=../../API_KEY.txt')).status,400);
  for(const path of ['/API_KEY.txt','/OPENROUTER_API_KEY.txt','/prompt-enhancer.mjs','/IMAGE_PROMPT_PRESETS.txt'])assert.equal((await fetch(url+path)).status,404);
  const response=post({...base,presetId:presets.presets[0].id});
  for(let i=0;!calls.length&&i<100;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(calls.length,1);assert.deepEqual((await fetch(url+'/api/jobs').then(r=>r.json())).activeEnhancementProjectIds,['default']);
  release(reply('A red ball rests on a table.'));assert.equal((await response).status,200);assert.deepEqual((await fetch(url+'/api/jobs').then(r=>r.json())).activeEnhancementProjectIds,[]);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-router-key');assert(!calls[0].options.body.includes('test-fal-key'));
});

test('enhancement certificate failures and interrupted responses keep accurate spending outcomes',async t=>{
  const dir=await directory(t);
  for(const bodyFailure of [false,true]){
    let calls=0;const entries=[];
    const error=new TypeError('test-router-key',{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}});
    const enhancer=createPromptEnhancer({directory:dir,trackSpending:async entry=>entries.push(structuredClone(entry)),fetchImpl:async()=>{
      calls++;if(bodyFailure)return {ok:true,json:async()=>{throw error;}};throw error;
    }});
    await assert.rejects(enhancer.enhance(base,'test-router-key'),error=>{
      assert.match(error.message,bodyFailure?/may have been processed/:/No generation request was sent/);
      assert(!error.message.includes('test-router-key'));return true;
    });
    assert.equal(calls,1);assert.deepEqual(enhancer.activeProjectIds(),[]);
    assert.equal(entries.at(-1).status,bodyFailure?'UNKNOWN':'FAILED');assert.equal(entries.at(-1).accepted,bodyFailure);
  }
});

test('enhancement preserves long prompts and reserves room for the preset within the selected input limit',async t=>{
  const dir=await directory(t),calls=[];
  const enhancer=createPromptEnhancer({directory:dir,fetchImpl:async(url,options)=>{const payload=JSON.parse(options.body);calls.push(payload);return reply(payload.messages[1].content);}});
  const prompt='Detailed subject. '.repeat(1400),config=await enhancer.config('image');
  assert(prompt.length>5000&&prompt.length<30000);
  const result=await enhancer.enhance({...base,prompt,presetId:config.presets[0].id},'test-router-key');
  assert.equal(result.enhanced,prompt.trim());assert.equal(result.combinedPrompt,prompt.trim()+'\n\n'+config.presets[0].prompt);
  assert.match(calls[0].messages[0].content,new RegExp(String(30000-config.presets[0].prompt.length-2)));
  const full='x'.repeat(30000);assert.equal((await enhancer.enhance({...base,prompt:full},'test-router-key')).combinedPrompt,full);
  await assert.rejects(enhancer.enhance({...base,prompt:full,presetId:config.presets[0].id},'test-router-key'),/character limit/);
  const before=calls.length;await assert.rejects(enhancer.enhance({...base,mode:'video',model:'flux3-video',inputType:'edit',prompt:'x'.repeat(4097)},'test-router-key'),/4,096/);assert.equal(calls.length,before);
});
