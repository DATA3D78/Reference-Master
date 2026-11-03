import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createStudio, detectMedia, validMediaURL } from '../server.mjs';
import { buildInput, capabilities, MODELS, imageDimensions, validateReferenceMetadata } from '../public/models.js';
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const base={model:'nano-pro',inputType:'text',prompt:'An amber glass sculpture',ratio:'1:1',resolution:'1K',count:1,duration:'5',referenceIds:[]};
const image={kind:'image',bytes:100,data:'data:image/png;base64,aGVsbG8=',contentType:'image/png',metadata:{width:640,height:640}};
const video={kind:'video',bytes:100,data:'data:video/mp4;base64,aGVsbG8=',contentType:'video/mp4',metadata:{width:640,height:640,duration:4}};
const audio={kind:'audio',bytes:100,data:'data:audio/wav;base64,aGVsbG8=',contentType:'audio/wav',metadata:{duration:2}};
const fixtures=JSON.parse(await readFile(new URL('./fixtures/fal-schemas.json',import.meta.url)));
const byId=id=>MODELS.find(m=>m.id===id);
function request(model,inputType='text') {
  const c=capabilities(model,inputType);
  return {...base,model:model.id,inputType,ratio:c.ratios[0],resolution:c.resolutions[0],duration:c.durations?.includes('5')?'5':c.durations?.[0],quality:model.qualities?'high':undefined,frameIndices:inputType==='keyframes'?[0]:undefined};
}
function matches(value,s,defs){
  if(s.$ref)return matches(value,defs[s.$ref.split('/').pop()],defs);
  if(s.anyOf)return s.anyOf.some(v=>matches(value,v,defs));
  if(s.enum&&!s.enum.includes(value))return false;
  if('const'in s&&value!==s.const)return false;
  if(s.type==='null')return value===null;
  if(s.type==='string'&&(typeof value!=='string'||value.length<(s.minLength||0)||value.length>(s.maxLength||Infinity)))return false;
  if(s.type==='integer'&&!Number.isInteger(value))return false;
  if(['integer','number'].includes(s.type)&&(typeof value!=='number'||value<(s.minimum??-Infinity)||value>(s.maximum??Infinity)||value<=(s.exclusiveMinimum??-Infinity)))return false;
  if(s.type==='boolean'&&typeof value!=='boolean')return false;
  if(s.type==='array')return Array.isArray(value)&&value.length>=(s.minItems||0)&&value.length<=(s.maxItems||Infinity)&&value.every(v=>matches(v,s.items,defs));
  if(s.type==='object'||s.properties){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    if((s.required||[]).some(k=>!(k in value)))return false;
    return Object.entries(value).every(([k,v])=>s.properties[k]&&matches(v,s.properties[k],defs));
  }
  return true;
}

test('all exposed model/input/ratio/resolution/duration combinations conform to official fal schema snapshots',()=>{
  for(const model of MODELS.filter(m=>m.available))for(const inputType of model.inputs){
    const c=capabilities(model,inputType),refs=inputType==='frames'?[image,image]:['image','end','keyframes'].includes(inputType)?[image]:['video','edit'].includes(inputType)?[video]:[];
    for(const ratio of c.ratios)for(const resolution of c.resolutions)for(const duration of c.durations||['5']){
      const result=buildInput({...request(model,inputType),ratio,resolution,duration},refs);
      const f=fixtures.endpoints[result.endpoint];assert(f,`Missing schema for ${result.endpoint}`);
      assert(matches(result.input,f.input,f.definitions),`${result.endpoint}: ${JSON.stringify(result.input)}`);
    }
  }
});
test('image models map ordered references to their own schema and enforce their reference limit',()=>{
  for(const model of MODELS.filter(m=>m.mode==='image')){
    const refs=Array.from({length:model.maxImages},(_,i)=>({...image,data:`data:image/png;base64,reference-${i}`}));
    const config=buildInput(request(model,'image'),refs),schema=fixtures.endpoints[config.endpoint];
    assert.equal(capabilities(model,'image').maxRefs,model.maxImages);
    assert.deepEqual(model.family==='krea'?config.input.image_style_references.map(r=>r.image_url):config.input.image_urls,refs.map(r=>r.data));
    assert(matches(config.input,schema.input,schema.definitions),model.name);
    assert.throws(()=>buildInput(request(model,'image'),[...refs,image]),/Too many reference/);
  }
  for(const model of MODELS.filter(m=>m.mode==='video'&&m.available)){
    assert.equal(capabilities(model,'image').limits.image,1);
    assert.throws(()=>buildInput(request(model,'image'),[image,image]),/Too many reference/);
  }
});
test('GPT and Seedream dimensions stay inside actual pixel budgets at every ratio and tier',()=>{
  for(const model of MODELS.filter(m=>m.sizeLimits))for(const ratio of model.ratios)for(const resolution of model.resolutions){
    const {width,height}=imageDimensions(model,ratio,resolution),limits=model.sizeLimits;
    assert(width*height>=limits.minArea&&width*height<=limits.maxArea,`${model.id} ${ratio} ${resolution}: invalid area`);
    assert(Math.max(width,height)<=limits.maxEdge);assert.equal(width%limits.step,0);assert.equal(height%limits.step,0);
    const [a,b]=ratio.split(':').map(Number);assert(Math.abs(width/height-a/b)<0.055);
  }
});

test('all selectable generation models, tools and audio use only fal endpoints',async()=>{
 const {AUDIO_MODELS}=await import('../public/audio-models.js');const {TOOLS}=await import('../public/tools-models.js');
 for(const m of [...MODELS,...AUDIO_MODELS,...TOOLS]){assert.equal(m.provider,'fal');assert.equal(m.available,true);for(const endpoint of Object.values(m.endpoints||{text:m.endpoint}))assert(fixtures.endpoints[endpoint],endpoint);}
 assert.equal(MODELS.length,15);assert(!MODELS.some(m=>m.id.includes('fast')));
});
test('Seedance 2.0 maps mixed media to fal fields and rejects invalid reference sets',()=>{
 const m=byId('seedance20'),settings=request(m,'video'),refs=[image,video,audio];
 const {endpoint,input}=buildInput(settings,refs);assert.equal(endpoint,'bytedance/seedance-2.0/reference-to-video');
 assert.deepEqual(input.image_urls,[image.data]);assert.deepEqual(input.video_urls,[video.data]);assert.deepEqual(input.audio_urls,[audio.data]);
 assert.throws(()=>buildInput(settings,[audio]),/at least one image or video/);
 assert.throws(()=>buildInput(settings,[{...video,bytes:50*1024**2}]),/under 50 MB/);
 assert.throws(()=>buildInput(settings,[video,video,video,video]),/Too many reference/);
});
test('audio and tool requests conform to fal schemas, including references and settings',async()=>{
 const {AUDIO_MODELS,buildAudioInput}=await import('../public/audio-models.js');const {TOOLS,buildToolInput}=await import('../public/tools-models.js');
 for(const m of AUDIO_MODELS)for(const inputType of m.id==='seed-audio'?['text','image','audio']:['text'])for(const multilingual of [false,true]){
  const result=buildAudioInput({model:m.id,inputType,prompt:'Sound direction',lyrics:'[instrumental]',options:m.id==='seed-audio'?{multilingual,speed:1.5,pitch:2}:{}},inputType==='text'?[]:[inputType==='image'?image:audio]);
  const f=fixtures.endpoints[result.endpoint];assert(matches(result.input,f.input,f.definitions));assert.equal(result.model.provider,'fal');
 }
 for(const t of TOOLS)for(const upscale_mode of ['factor','target']){const result=buildToolInput({tool:t.id,options:{upscale_mode}},t.kind==='image'?image:video),f=fixtures.endpoints[result.endpoint];assert(matches(result.input,f.input,f.definitions),t.id);}
});

 test('Wan reference smart duration sends explicit null for one or several videos',()=>{
 const model=byId('wan3');
 assert.equal(capabilities(model,'video').durations[0],'Smart');
 for(const count of [1,2,3]){
  const refs=Array.from({length:count},()=>({...video}));
  const result=buildInput({...request(model,'video'),duration:'Smart'},refs);
  assert.equal(result.input.duration,null);
  assert.equal(result.input.reference_video_urls.length,count);
 }
 assert.equal(buildInput({...request(model,'video'),duration:'8'},[video]).input.duration,8);
 assert.throws(()=>buildInput({...request(byId('seedance20'),'video'),duration:'Smart'},[video]));
});

test('Wan video references support adaptive ratio with smart duration',()=>{
 const model=byId('wan3');
 assert.equal(capabilities(model,'video').ratios[0],'adaptive');
 const result=buildInput({...request(model,'video'),ratio:'adaptive',duration:'Smart'},[video]);
 assert.equal(result.input.aspect_ratio,'adaptive');
 assert.equal(result.input.duration,null);
 assert.equal(buildInput({...request(model,'video'),ratio:'9:16'},[video]).input.aspect_ratio,'9:16');
});
