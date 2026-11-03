import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../server.mjs';
import {buildLlmRequest} from '../llm-store.mjs';
import {LLM_MODELS,videoTimestamps} from '../public/llm-models.js';
const image={kind:'image',contentType:'image/png',bytes:8,data:'data:image/png;base64,iVBORw0KGgo='};
const base={projectId:'default',model:'openai/gpt-5.6-sol',task:'image',format:'text',instruction:'Describe the colors.',maxTokens:8192,referenceIds:[]};
import {description} from './fixtures/visual-description.mjs';
const completed=content=>Response.json({id:'gen-mock',choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:60,total_tokens:160,cost:.0012}});
async function fixture(t,options={}){
  const dir=await mkdtemp(join(tmpdir(),'llm-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const calls=[];
  if(options.seed)await writeFile(join(dir,'llm-jobs.json'),JSON.stringify(options.seed));
  if(options.savedKey)await writeFile(join(dir,'router-key.txt'),options.savedKey);
  const app=await createStudio({dataDir:dir,key:'dummy-fal-key',openRouterKey:options.savedKey?undefined:options.key??'dummy-router-key',openRouterKeyFile:options.savedKey?join(dir,'router-key.txt'):null,autoArchive:false,pollMs:3600000,fetchImpl:async(url,opts)=>{calls.push({url,opts});return options.provider?options.provider(url,opts):completed(JSON.parse(opts.body).response_format?JSON.stringify(description):'A blue sculpture sits on a gray surface.');}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{if(app.server.listening)await new Promise(r=>app.server.close(r));});
  const url='http://127.0.0.1:'+app.server.address().port,get=path=>fetch(url+path),config=await(await get('/api/bootstrap')).json();
  const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':config.csrf,...headers},body:JSON.stringify(body)});
  const upload=async()=>{const r=await fetch(url+'/api/uploads',{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':config.csrf},body:Buffer.from([137,80,78,71,13,10,26,10])});assert.equal(r.status,201);return(await r.json()).id;};
  const settled=async(id,project='default')=>{for(let i=0;i<100;i++){const {jobs}=await(await get('/api/llm/jobs?project='+project)).json(),job=jobs.find(j=>j.id===id);if(job&&job.status!=='RUNNING'){await delay(15);return job;}await delay(10);}throw Error('Mock analysis did not finish.');};
  return {...app,dir,url,calls,get,post,config,upload,settled};
}
test('only the requested interactive GPT families are exposed and all support the image/JSON payload',()=>{
  assert.equal(LLM_MODELS.length,8);
  for(const m of LLM_MODELS){assert.match(m.id,/^openai\/gpt-(5\.6-(sol|terra|luna)|6-astra)(-pro)?$/);const {payload}=buildLlmRequest({...base,model:m.id,format:'json'},[image]);assert.equal(payload.model,m.id);assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.provider.require_parameters,true);assert.equal(payload.messages[1].content[2].image_url.url,image.data);assert.equal(payload.stream,false);}
  assert.throws(()=>buildLlmRequest({...base,model:'openai/gpt-6-sol'},[image]),/supported/);
  assert.throws(()=>buildLlmRequest({...base,model:'openai/gpt-5.6-sol:batch'},[image]),/supported/);
});
test('video requests preserve chronological frames, require plain text and disclose sampling/audio limits',()=>{
  const timestamps=videoTimestamps(30,24),video={name:'clip.mp4',duration:30,timestamps};
  const {payload,settings}=buildLlmRequest({...base,task:'video',video},Array(24).fill(image));
  assert.match(payload.messages[0].content,/sampled timestamps/);assert.match(payload.messages[0].content,/plain headings/);
  assert.equal(payload.response_format,undefined);assert.equal(payload.messages[1].content.filter(c=>c.type==='image_url').length,24);assert.match(payload.messages[1].content[0].text,/not continuous video or audio/);assert.deepEqual(settings.video.timestamps,timestamps);
  for(const modified of [{format:'json'},{video:{...video,timestamps:timestamps.slice(1)}},{video:{...video,timestamps:timestamps.toReversed()}},{video:{...video,duration:601}},{video:{...video,timestamps:timestamps.map(()=>0)}}])assert.throws(()=>buildLlmRequest({...base,task:'video',video,...modified},Array(24).fill(image)));
  for(const [duration,count]of [[NaN,12],[0,12],[601,12],[5,13]])assert.throws(()=>videoTimestamps(duration,count));
  assert(videoTimestamps(.01,12).every((n,i,a)=>n>=0&&n<.01&&(i===0||n>a[i-1])));
});
test('image and refinement validation reject incomplete or oversized requests',()=>{
  for(const refs of [[],Array(9).fill(image),[{...image,kind:'video'}],[{...image,bytes:11*1024**2}]])assert.throws(()=>buildLlmRequest(base,refs));
  const source={id:'source',status:'COMPLETED',output:'Existing description'};
  assert.throws(()=>buildLlmRequest({...base,task:'refine'},[],undefined));
  assert.throws(()=>buildLlmRequest({...base,task:'refine',instruction:''},[],source));
  const {payload}=buildLlmRequest({...base,task:'refine',sourceText:'Edited selection'},[image],source);assert.match(payload.messages[1].content[0].text,/Edited selection/);assert.match(payload.messages[1].content[0].text,/Describe the colors/);
  for(const maxTokens of [0,8193,'8192'])assert.throws(()=>buildLlmRequest({...base,maxTokens},[image]));
});
test('LLM generation, JSON, refinement and project isolation persist without credentials or media bytes',async t=>{
  const f=await fixture(t),id=await f.upload();
  assert.equal(f.config.features.detailedLlmStructure,true);assert.equal((await(await f.get('/api/llm/config')).json()).detailedStructure,true);
  const receipt=await f.post('/api/llm/generate',{...base,format:'json',referenceIds:[id]});assert.equal(receipt.status,202);const first=await f.settled((await receipt.json()).job.id);assert.equal(first.status,'COMPLETED');assert.deepEqual(JSON.parse(first.output),description);assert.equal(first.usage.cost,.0012);
  const secondResponse=await f.post('/api/llm/generate',{...base,task:'refine',sourceId:first.id,sourceText:first.output,instruction:'Make the sculpture red',referenceIds:[id]});assert.equal(secondResponse.status,202);const second=await f.settled((await secondResponse.json()).job.id);assert.equal(second.settings.sourceId,first.id);assert.equal(second.status,'COMPLETED');
  const {project}=await(await f.post('/api/projects',{type:'create',name:'Another project'})).json();assert.deepEqual((await(await f.get('/api/llm/jobs?project='+project.id)).json()).jobs,[]);
  assert.equal((await f.post('/api/llm/generate',{...base,projectId:project.id,task:'refine',sourceId:first.id,instruction:'Change it'})).status,400);
  assert.equal((await f.get('/api/llm/jobs?project=does-not-exist')).status,400);
  const saved=await readFile(join(f.dir,'llm-jobs.json'),'utf8');for(const secret of ['dummy-router-key','dummy-fal-key','data:image/png','Authorization'])assert(!saved.includes(secret));assert.equal(JSON.parse(saved).length,2);
  assert(f.calls.every(call=>call.url==='https://openrouter.ai/api/v1/chat/completions'&&call.opts.headers.Authorization==='Bearer dummy-router-key'&&call.opts.redirect==='error'));
  const reloaded=await createStudio({dataDir:f.dir,key:'',openRouterKey:'',autoArchive:false,pollMs:3600000});await new Promise(r=>reloaded.server.listen(0,'127.0.0.1',r));const restored=await fetch('http://127.0.0.1:'+reloaded.server.address().port+'/api/llm/jobs').then(r=>r.json());assert.equal(restored.jobs.length,2);assert.equal(restored.jobs[1].output,first.output);await new Promise(r=>reloaded.server.close(r));
});
test('LLM key and API routes retain local CSRF, origin, reference and private-file protection',async t=>{
  const f=await fixture(t,{key:''});assert.equal((await(await f.get('/api/llm/config')).json()).keyConfigured,false);
  for(const path of ['/OPENROUTER_API_KEY.txt','/API_KEY.txt','/llm-store.mjs','/llm-description.mjs','/.local/llm-jobs.json'])assert.equal((await f.get(path)).status,404);
  assert.equal((await f.post('/api/llm/settings',{key:'dummy-key'},{'X-Studio-Token':'wrong'})).status,403);
  assert.equal((await f.post('/api/llm/settings',{key:'dummy-key'},{Origin:'https://elsewhere.test'})).status,403);
  assert.equal((await f.post('/api/llm/settings',{key:'dummy\nkey'})).status,400);
  assert.equal((await f.post('/api/llm/generate',base)).status,401);
  await f.post('/api/llm/settings',{key:'dummy-router-key'});assert.equal((await f.post('/api/llm/generate',{...base,referenceIds:['expired']})).status,400);
  const id=await f.upload();assert.equal((await f.post('/api/llm/generate',{...base,referenceIds:[id,id]})).status,400);
  assert.equal((await f.get('/api/bootstrap')).status,200);assert.equal(f.calls.length,0);
});
test('OpenRouter key file loads independently of fal credentials',async t=>{
  delete process.env.OPENROUTER_API_KEY;
  const f=await fixture(t,{savedKey:'dummy-file-router-key'});assert.equal((await(await f.get('/api/llm/config')).json()).keyConfigured,true);
  const id=await f.upload(),r=await f.post('/api/llm/generate',{...base,referenceIds:[id]});await f.settled((await r.json()).job.id);assert.equal(f.calls[0].opts.headers.Authorization,'Bearer dummy-file-router-key');
  assert(!(await(await f.get('/api/llm/config')).text()).includes('dummy-file-router-key'));
});
test('concurrent LLM submissions keep independent results, references and active project state',async t=>{
  const pending=[];const f=await fixture(t,{provider:()=>new Promise(resolve=>pending.push(resolve))}),id=await f.upload();
  const {project}=await(await f.post('/api/projects',{type:'create',name:'Parallel LLM project'})).json();
  const first=await f.post('/api/llm/generate',{...base,referenceIds:[id]});assert.equal(first.status,202);const a=(await first.json()).job;
  const second=await f.post('/api/llm/generate',{...base,projectId:project.id,model:'openai/gpt-6-astra',instruction:'Describe the composition.',referenceIds:[id]});assert.equal(second.status,202);const b=(await second.json()).job;
  assert.equal(pending.length,2);assert.notEqual(a.id,b.id);
  assert.deepEqual(new Set((await(await f.get('/api/jobs')).json()).activeLlmProjectIds),new Set(['default',project.id]));
  pending[1](completed('The second analysis finishes first.'));assert.equal((await f.settled(b.id,project.id)).output,'The second analysis finishes first.');
  assert.deepEqual((await(await f.get('/api/jobs')).json()).activeLlmProjectIds,['default']);
  const third=await f.post('/api/llm/generate',{...base,instruction:'A separate request',referenceIds:[id]});assert.equal(third.status,202);const c=(await third.json()).job;
  pending[2](Response.json({detail:'Invalid request'},{status:422}));assert.equal((await f.settled(c.id)).status,'FAILED');
  pending[0](completed('The original analysis.'));assert.equal((await f.settled(a.id)).output,'The original analysis.');
  assert.deepEqual((await(await f.get('/api/jobs')).json()).activeLlmProjectIds,[]);
  assert.equal(f.calls.length,3);for(const call of f.calls)assert.equal(JSON.parse(call.opts.body).messages[1].content[2].image_url.url,image.data);
  const saved=JSON.parse(await readFile(join(f.dir,'llm-jobs.json'),'utf8'));assert.equal(saved.length,3);assert.equal(saved.find(j=>j.id===b.id).projectId,project.id);assert.equal(saved.find(j=>j.id===a.id).settings.instruction,base.instruction);
});
test('provider failures and invalid JSON never masquerade as completed outputs or retry automatically',async t=>{
  const cases=[{name:'invalid JSON',format:'json',provider:()=>completed('invalid'),status:'FAILED'},{name:'schema mismatch',format:'json',provider:()=>completed('{"unexpected":true}'),status:'FAILED'},{name:'empty',provider:()=>completed(''),status:'FAILED'},{name:'refusal',provider:()=>Response.json({choices:[{message:{refusal:'No'}}]}),status:'FAILED'},{name:'truncated',provider:()=>Response.json({choices:[{message:{content:'Partial'},finish_reason:'length'}]}),status:'FAILED'},{name:'credits',provider:()=>Response.json({error:{message:'dummy-router-key'}},{status:402}),status:'FAILED'},{name:'network',provider:()=>{throw Error('dummy-router-key');},status:'UNKNOWN'}];
  for(const c of cases)await t.test(c.name,async st=>{const f=await fixture(st,c),id=await f.upload(),r=await f.post('/api/llm/generate',{...base,format:c.format||'text',referenceIds:[id]}),job=await f.settled((await r.json()).job.id);assert.equal(job.status,c.status);assert(!job.error.includes('dummy-router-key'));assert.equal(job.output,undefined);await f.refresh();assert.equal(f.calls.length,1);});
});
test('interrupted LLM requests reopen as unknown without duplicating a charged request',async t=>{
  const f=await fixture(t,{seed:[{id:'pending',projectId:'default',status:'RUNNING',settings:{task:'image'}}]});const {jobs}=await(await f.get('/api/llm/jobs')).json();assert.equal(jobs[0].status,'UNKNOWN');assert.match(jobs[0].error,/not resubmitted/);assert.equal(f.calls.length,0);
});

test('older saved JSON remains readable and can be refined into the detailed hierarchy',async t=>{
  const oldOutput='{"title":"Old glass study","subject":"Blue glass","generation_prompt":"Blue glass on gray"}';
  const f=await fixture(t,{seed:[{id:'legacy',projectId:'default',status:'COMPLETED',settings:{task:'image',format:'json'},output:oldOutput}]});
  assert.equal((await(await f.get('/api/llm/jobs')).json()).jobs[0].output,oldOutput);
  const r=await f.post('/api/llm/generate',{...base,format:'json',task:'refine',sourceId:'legacy',instruction:'Describe the surface in greater detail.'});
  assert.equal(r.status,202);const result=await f.settled((await r.json()).job.id);
  assert.equal(result.status,'COMPLETED');assert.deepEqual(JSON.parse(result.output),description);
  const jobs=(await(await f.get('/api/llm/jobs')).json()).jobs;
  assert.equal(jobs.find(j=>j.id==='legacy').output,oldOutput);assert.equal(result.settings.sourceText,oldOutput);
});

test('a malformed nested provider response fails while preserving usage and avoiding retries',async t=>{
  const malformed=structuredClone(description);malformed.subject.clothing={top:'Gray shirt'};
  const f=await fixture(t,{provider:()=>completed(JSON.stringify(malformed))}),id=await f.upload();
  const r=await f.post('/api/llm/generate',{...base,format:'json',referenceIds:[id]}),job=await f.settled((await r.json()).job.id);
  assert.equal(job.status,'FAILED');assert.match(job.error,/detailed description structure/);assert.equal(job.output,undefined);
  assert.equal(job.usage.cost,.0012);assert.equal(f.calls.length,1);
});

test('connection failures retain accurate status and safe diagnostics without resubmitting',async t=>{
  const transport=(code,name)=>{throw new TypeError('dummy-router-key',{cause:Object.assign(new Error('dummy-router-key data:image/png;base64,SECRET'),{code,name})});};
  const cases=[
    {name:'untrusted certificate',provider:()=>transport('SELF_SIGNED_CERT_IN_CHAIN'),status:'FAILED',code:'TLS_CERTIFICATE',pattern:/certificate could not be verified/,accepted:false},
    {name:'DNS failure',provider:()=>transport('ENOTFOUND'),status:'FAILED',code:'CONNECTION_FAILED',pattern:/No generation request was sent/,accepted:false},
    {name:'timeout after sending',provider:()=>transport(undefined,'TimeoutError'),status:'UNKNOWN',code:'TIMEOUT',pattern:/timed out/},
    {name:'socket reset',provider:()=>transport('ECONNRESET'),status:'UNKNOWN',code:'CONNECTION_INTERRUPTED',pattern:/may have been processed/},
    {name:'body interrupted',provider:()=>({ok:true,json:()=>transport('UND_ERR_SOCKET')}),status:'UNKNOWN',code:'INCOMPLETE_RESPONSE',pattern:/could not be read completely/,accepted:true},
    {name:'invalid response JSON',provider:()=>new Response('{incomplete'),status:'UNKNOWN',code:'INCOMPLETE_RESPONSE',pattern:/could not be read completely/,accepted:true},
    {name:'null response',provider:()=>Response.json(null),status:'UNKNOWN',code:'INCOMPLETE_RESPONSE',pattern:/could not be read completely/,accepted:true}
  ];
  for(const c of cases)await t.test(c.name,async st=>{
    const f=await fixture(st,c);assert.equal(f.config.features.llmConnectionFix,true);
    const reference=await f.upload(),receipt=await f.post('/api/llm/generate',{...base,referenceIds:[reference]}),job=await f.settled((await receipt.json()).job.id);
    assert.equal(job.status,c.status);assert.equal(job.errorCode,c.code);assert.match(job.error,c.pattern);
    assert.equal(job.billingAccepted,c.accepted);assert.equal(job.output,undefined);
    for(const secret of ['dummy-router-key','SECRET','data:image'])assert(!JSON.stringify(job).includes(secret));
    const saved=JSON.parse(await readFile(join(f.dir,'llm-jobs.json'),'utf8')).find(saved=>saved.id===job.id);
    assert.equal(saved.errorCode,c.code);assert.equal(saved.status,c.status);
    await f.refresh();assert.equal(f.calls.length,1);
  });
});

test('token errors identify the submitted limit and retain charged usage without automatic retries',async t=>{
  const f=await fixture(t,{provider:(_url,opts)=>Response.json({id:'gen-truncated',choices:[{message:{content:'Partial'},finish_reason:'length'}],usage:{completion_tokens:JSON.parse(opts.body).max_tokens,cost:.02}})});
  const reference=await f.upload();
  for(const maxTokens of [2048,16384]){
    const receipt=await f.post('/api/llm/generate',{...base,maxTokens,referenceIds:[reference]}),job=await f.settled((await receipt.json()).job.id);
    assert.equal(job.status,'FAILED');assert.match(job.error,new RegExp(maxTokens.toLocaleString('en-US')+'-token limit'));
    assert.equal(job.usage.cost,.02);assert.equal(job.requestId,'gen-truncated');assert.equal(job.output,undefined);
    if(maxTokens===16384)assert(!job.error.includes('larger'));else assert.match(job.error,/larger response length/);
  }
  assert.equal(f.calls.length,2);
});

test('LLM delete and restore require the local token and correct project, without an API key',async t=>{
  const f=await fixture(t,{key:'',seed:[{id:'saved-text',projectId:'default',status:'COMPLETED',modelName:'Test',createdAt:'2026-10-08T12:00:00Z',settings:{task:'image',format:'text'},output:'A saved description',billingKeyHash:'private-hash',usage:{cost:.02}}]});
  assert.equal(f.config.features.llmDeletion,true);const body={projectId:'default',jobId:'saved-text'};
  assert.equal((await f.post('/api/llm/delete',body,{'X-Studio-Token':'wrong'})).status,403);
  assert.equal((await f.post('/api/llm/delete',body,{Origin:'https://elsewhere.test'})).status,403);
  assert.equal((await f.post('/api/llm/delete',{...body,jobId:'missing'})).status,404);
  assert.equal((await f.post('/api/llm/delete',body)).status,200);
  assert.equal((await(await f.get('/api/llm/jobs')).json()).jobs.length,0);
  assert.equal((await f.get('/llm-deletions.json')).status,404);
  const restored=await(await f.post('/api/llm/restore',body)).json();assert.equal(restored.job.output,'A saved description');assert(!('billingKeyHash' in restored.job));
  assert.equal((await(await f.get('/api/llm/jobs')).json()).jobs.length,1);assert.equal(f.calls.length,0);
});
