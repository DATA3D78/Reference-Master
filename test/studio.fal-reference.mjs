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
const image={kind:'image',bytes:100,data:'data:image/png;base64,aGVsbG8=',contentType:'image/png',metadata:{width:480,height:480}};
const video={kind:'video',bytes:100,data:'data:video/mp4;base64,aGVsbG8=',contentType:'video/mp4',metadata:{width:480,height:480,duration:4}};
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

test('requested catalog contains Nano Banana 2.1, three Krea 2 variants and all existing models; unverified Fast is blocked',()=>{
  assert.deepEqual(MODELS.filter(m=>m.mode==='image').map(m=>m.name),['Nano Banana Pro','Nano Banana 2.1','Krea 2 Large','Krea 2 Medium','Krea 2 Medium Turbo','GPT Image 2.5 Flare','GPT Image 2.5 Sunburst','Seedream 5.0 Lite','Seedream 5.0 Pro','FLUX 3.0']);
  assert.deepEqual(MODELS.filter(m=>m.mode==='video').map(m=>m.name),['Wan 3.0','Seedance 2.5 Fast','Seedance 2.5','MiniMax H3','FLUX Video']);
  assert.equal(MODELS.filter(m=>m.available).length,14);
  assert.throws(()=>buildInput({...base,model:'seedance25-fast'}),/exact fal.ai endpoint/);
  assert.equal(byId('seedance25-fast').endpoints,undefined);
});
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
test('Seedance maps all 50 mixed references in per-kind order, including audio-only and image-only guidance',()=>{
  const model=byId('seedance25'),refs=[];
  for(let i=0;i<30;i++){
    refs.push({...image,data:`image-${i}`});
    if(i<10)refs.push({...audio,data:`audio-${i}`},{...video,data:`video-${i}`,metadata:{...video.metadata,duration:2}});
  }
  const result=buildInput(request(model,'video'),refs),schema=fixtures.endpoints[result.endpoint];
  assert(matches(result.input,schema.input,schema.definitions));
  for(const kind of ['image','video','audio'])assert.deepEqual(result.input[`${kind}_urls`],refs.filter(r=>r.kind===kind).map(r=>r.data));
  assert.equal(result.input.image_url,undefined);
  for(const ref of [image,audio]){
    const input=buildInput(request(model,'video'),[ref]).input;
    assert.deepEqual(input[`${ref.kind}_urls`],[ref.data]);assert.equal(input.video_urls,undefined);
  }
});
test('Seedance enforces each media count, file size and separate video/audio duration totals',()=>{
  const model=byId('seedance25'),req=request(model,'video');
  for(const [ref,count] of [[image,31],[video,11],[audio,11]])assert.throws(()=>buildInput(req,Array(count).fill(ref)),/references/);
  assert.throws(()=>buildInput(req,Array(51).fill(image)),/Too many/);
  for(const [ref,mb]of [[image,30],[video,200],[audio,15]]){
    assert.doesNotThrow(()=>buildInput(req,[{...ref,bytes:mb*1024*1024}]));
    assert.throws(()=>buildInput(req,[{...ref,bytes:mb*1024*1024+1}]),/size/);
  }
  const duration=(ref,d)=>({...ref,metadata:{...ref.metadata,duration:d}});
  assert.doesNotThrow(()=>buildInput(req,[duration(video,30.2),duration(audio,30.2)]));
  for(const ref of [video,audio]){
    for(const d of [0,1.79,30.21,NaN])assert.throws(()=>buildInput(req,[duration(ref,d)]));
    assert.throws(()=>buildInput(req,[duration(ref,16),duration(ref,16)]),/total/);
  }
  assert.throws(()=>buildInput(request(model,'image'),[image,audio]),/Too many|type/);
  assert.throws(()=>buildInput(request(byId('flux3-video'),'video'),[audio]),/type/);
});
test('audio uploads require WAV or MP3 signatures',()=>{
  assert.equal(detectMedia(Buffer.from('RIFF0000WAVE'),'audio/wav'),'audio');
  assert.equal(detectMedia(Buffer.from('ID3\x04\x00\x00'),'audio/mpeg'),'audio');
  assert.equal(detectMedia(Buffer.from([255,251,144,0]),'audio/mpeg'),'audio');
  assert.throws(()=>detectMedia(Buffer.from('RIFF0000WEBP'),'audio/wav'));
  assert.throws(()=>detectMedia(Buffer.from('this is not an mp3'),'audio/mpeg'));
  assert.throws(()=>detectMedia(Buffer.from([255,241,144,0]),'audio/mpeg')); // AAC is not MP3.
});
test('Wan and MiniMax mix references with their own field names and enforce per-type and shared limits',()=>{
  const shortVideo={...video,metadata:{...video.metadata,duration:3}},shortAudio={...audio,metadata:{duration:3}};
  for(const [id,counts]of [['wan3',[10,5,5]],['minimax-h3',[6,3,3]]]){
    const model=byId(id),refs=[];
    for(const [ref,count]of [[image,counts[0]],[shortVideo,counts[1]],[shortAudio,counts[2]]])for(let i=0;i<count;i++)refs.push({...ref,data:`${ref.kind}-${i}`});
    const result=buildInput(request(model,'video'),refs),schema=fixtures.endpoints[result.endpoint];
    assert(matches(result.input,schema.input,schema.definitions));
    for(const kind of ['image','video','audio'])assert.deepEqual(result.input[`reference_${kind}_urls`],refs.filter(r=>r.kind===kind).map(r=>r.data));
    assert.equal(result.input.image_urls,undefined);
    for(const ref of [image,shortAudio])assert.doesNotThrow(()=>buildInput(request(model,'video'),[ref]));
    for(const [kind,ref]of [['image',image],['video',shortVideo],['audio',shortAudio]])assert.throws(()=>buildInput(request(model,'video'),Array(model.referenceLimits[kind]+1).fill(ref)),/reference/);
    assert.throws(()=>buildInput(request(model,'video'),[{...shortAudio,metadata:{duration:16}}]),/seconds/);
  }
  assert.throws(()=>buildInput(request(byId('minimax-h3'),'video'),[...Array(9).fill(image),...Array(3).fill(shortVideo),shortAudio]),/Too many/);
  assert.throws(()=>buildInput(request(byId('wan3'),'video'),Array(5).fill(video)),/total/);
});
test('first/last and end-only modes use exact endpoint fields, require both frames and preserve upload order',()=>{
  const last={...image,data:'last-frame'};
  for(const id of ['wan3','seedance25','minimax-h3','flux3-video']){
    const model=byId(id),req=request(model,'frames'),result=buildInput(req,[image,last]);
    assert.equal(result.input[['wan3','flux3-video'].includes(id)?'start_image_url':'image_url'],image.data);
    assert.equal(result.input.end_image_url,last.data);
    const schema=fixtures.endpoints[result.endpoint];assert(matches(result.input,schema.input,schema.definitions),id);
    assert.throws(()=>buildInput(req,[image]),/both/);
    assert.throws(()=>buildInput(req,[audio,last]),/type|both/);
  }
  const end=buildInput(request(byId('minimax-h3'),'end'),[last]);assert.equal(end.input.image_url,undefined);assert.equal(end.input.end_image_url,last.data);assert.equal(end.input.aspect_ratio,undefined);
});
test('MiniMax optional soundtrack works with text, first/last and end-only modes without entering the reference-audio list',()=>{
  const model=byId('minimax-h3'),track={...audio,metadata:{duration:45}};
  for(const type of ['text','image','frames','end']){
    const refs=type==='text'?[track]:type==='frames'?[track,image,image]:[track,image];
    const result=buildInput(request(model,type),refs),schema=fixtures.endpoints[result.endpoint];
    assert(matches(result.input,schema.input,schema.definitions));assert.equal(result.input.target_audio_url,track.data);assert.equal(result.input.reference_audio_urls,undefined);
  }
  assert.throws(()=>buildInput(request(model,'text'),[{...track,metadata:{duration:1.9}}]),/at least/);
  assert.throws(()=>buildInput(request(model,'text'),[track,track]),/Too many/);
  assert.throws(()=>buildInput(request(model,'video'),[track]),/seconds/);
});
test('FLUX keyframes validate unique frame positions and video editing sends only supported controls',()=>{
  const model=byId('flux3-video'),refs=Array.from({length:10},(_,i)=>({...image,data:`frame-${i}`})),frameIndices=refs.map((_,i)=>i*12);
  const req={...request(model,'keyframes'),frameIndices},result=buildInput(req,refs),schema=fixtures.endpoints[result.endpoint];
  assert(matches(result.input,schema.input,schema.definitions));assert.deepEqual(result.input.keyframes,refs.map((r,i)=>({image_url:r.data,frame_index:frameIndices[i]})));
  for(const positions of [undefined,[],[0,0],[-1,24],[0,121],[0,1.5]])assert.throws(()=>buildInput({...req,frameIndices:positions},refs.slice(0,2)),/frame position/);
  assert.doesNotThrow(()=>buildInput({...req,frameIndices:[0,120]},refs.slice(0,2)));
  assert.throws(()=>buildInput({...req,frameIndices:[...frameIndices,119]},[...refs,image]),/Too many/);
  const edit=buildInput(request(model,'edit'),[video]);assert.equal(edit.endpoint,'blackforestlabs/flux-3/edit-video');assert.deepEqual(edit.input,{prompt:base.prompt,video_url:video.data});
  assert.throws(()=>buildInput(request(model,'video'),[audio]),/type/);
  assert.throws(()=>buildInput(request(model,'edit'),[{...video,bytes:50*1024*1024}]),/under 50/);
});
test('reference routing uses each model’s actual field names and endpoint',()=>{
  const checks=[['nano-pro','image','fal-ai/nano-banana-pro/edit','image_urls'],['gpt25-flare','image','openai/gpt-image-2.5/flare/edit','image_urls'],['gpt25-sunburst','image','openai/gpt-image-2.5/sunburst/edit','image_urls'],['seedream5-lite','image','bytedance/seedream/v5/lite/edit','image_urls'],['seedream5-pro','image','bytedance/seedream/v5/pro/edit','image_urls'],['flux3-image','image','blackforestlabs/flux-3/edit-image','image_urls'],['wan3','image','alibaba/wan-3.0/image-to-video','start_image_url'],['wan3','video','alibaba/wan-3.0/reference-to-video','reference_video_urls'],['seedance25','video','bytedance/seedance-2.5/reference-to-video','video_urls'],['minimax-h3','video','minimax/h3/reference-to-video','reference_video_urls'],['flux3-video','video','blackforestlabs/flux-3/extend-video','video_url']];
  for(const [id,type,endpoint,key]of checks){const r=buildInput(request(byId(id),type),[type==='image'?image:video]);assert.equal(r.endpoint,endpoint);assert(r.input[key]);}
});
test('audio, duration types, quality and first-frame ratios differ by model',()=>{
  assert.equal(buildInput({...request(byId('wan3')),audio:true}).input.audio,true);
  assert.equal(typeof buildInput(request(byId('wan3'))).input.duration,'number');
  assert.equal(typeof buildInput(request(byId('seedance25'))).input.duration,'string');
  assert.equal(typeof buildInput(request(byId('flux3-video'))).input.duration,'number');
  for(const id of ['seedance25','minimax-h3'])assert.equal(buildInput(request(byId(id),'image'),[image]).input.aspect_ratio,undefined);
  for(const id of ['wan3','flux3-video'])assert.equal(buildInput(request(byId(id),'image'),[image]).input.aspect_ratio,'16:9');
  const h3=buildInput({...request(byId('minimax-h3')),audio:false});assert.equal(h3.input.generate_audio,undefined);assert.equal(h3.input.resolution,'480P');
  for(const quality of byId('gpt25-flare').qualities)assert.equal(buildInput({...request(byId('gpt25-flare')),quality}).input.quality,quality);
  assert.equal(buildInput(request(byId('flux3-image'))).input.resolution,'1k');
  assert.equal(buildInput(request(byId('flux3-image'))).input.num_images,undefined);
  assert.equal(buildInput(request(byId('seedream5-lite'))).input.max_images,1);
});
test('rejects unsupported settings, obsolete IDs, prompts, counts and references',()=>{
  for(const mutation of [{model:'nano'},{ratio:'22:1'},{resolution:'16K'},{count:0},{count:5},{count:1.5},{prompt:''},{prompt:'ab'},{prompt:'x'.repeat(30001)}])assert.throws(()=>buildInput({...base,...mutation}));
  assert.throws(()=>buildInput({...base,inputType:'video'},[video]));
  assert.throws(()=>buildInput({...base,inputType:'image'},[]),/reference/);
  assert.throws(()=>buildInput({...base,inputType:'image'},[video]),/type/);
  assert.throws(()=>buildInput({...base,inputType:'image'},[{...image,bytes:11*1024*1024}]),/size/);
  assert.throws(()=>buildInput({...request(byId('gpt25-flare')),quality:'ultra'}),/quality/);
});
test('video duration totals, dimensions, formats and FLUX image size are enforced',()=>{
  const ref=duration=>({...video,metadata:{...video.metadata,duration}});
  assert.throws(()=>validateReferenceMetadata(byId('wan3'),'video',[ref(8),ref(8)]),/total/);
  assert.throws(()=>validateReferenceMetadata(byId('minimax-h3'),'video',[ref(1)]),/at least/);
  assert.throws(()=>validateReferenceMetadata(byId('seedance25'),'video',[ref(16),ref(16)]),/total/);
  assert.throws(()=>validateReferenceMetadata(byId('flux3-video'),'video',[ref(15)]),/shorter/);
  assert.throws(()=>validateReferenceMetadata(byId('flux3-video'),'video',[{...video,contentType:'video/quicktime'}]),/MP4/);
  assert.throws(()=>validateReferenceMetadata(byId('flux3-image'),'image',[{...image,metadata:{width:255,height:480}}]),/256/);
  assert.throws(()=>validateReferenceMetadata(byId('flux3-image'),'image',[{...image,metadata:{width:2048,height:2048}}]),/megapixels/);
  assert.throws(()=>validateReferenceMetadata(byId('seedance25'),'video',[{...video,metadata:{width:240,height:480,duration:5}}]),/300/);
});
test('media validation rejects spoofed file types and untrusted output hosts',()=>{
  assert.throws(()=>detectMedia(Buffer.from('<script>bad</script>'),'image/png'));
  assert.equal(detectMedia(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),'image');
  assert.equal(detectMedia(Buffer.from([0,0,0,20,102,116,121,112]),'video/mp4'),'video');
  for(const u of ['http://127.0.0.1:4317','https://evil.example','https://evilfal.media/x','https://v3.fal.media:8080/x','https://x@storage.googleapis.com/x','file:///etc/passwd'])assert.equal(validMediaURL(u),false);
  assert.equal(validMediaURL('https://v3b.fal.media/test.png'),true);
});
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
function mockProvider(){
  const calls=[];let submitted=0;
  const fn=async(url,options={})=>{
    calls.push({url,options});
    if(options.method==='POST'){
      submitted++;
      return response({request_id:`r${submitted}`,status_url:`https://queue.fal.run/test/model/requests/r${submitted}/status`,response_url:`https://queue.fal.run/test/model/requests/r${submitted}`});
    }
    if(url.endsWith('/status'))return response({status:'COMPLETED'});
    if(url.includes('/requests/'))return response({images:[{url:'https://v3.fal.media/result.png',content_type:'image/png',width:1024,height:1024}]});
    if(url==='https://v3.fal.media/result.png')return new Response(png,{headers:{'Content-Type':'image/png'}});
    throw new Error('Unexpected mocked URL');
  };
  return {fn,calls};
}
async function fixture(t,opts={}){
  const dir=await mkdtemp(join(tmpdir(),'frame-test-'));
  if(opts.seedJobs)await writeFile(join(dir,'jobs.json'),JSON.stringify(opts.seedJobs));
  const provider=mockProvider();
  const studio=await createStudio({dataDir:dir,fetchImpl:provider.fn,pollMs:3600000,autoArchive:false,...opts});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${studio.server.address().port}`;
  const bootstrap=await (await fetch(url+'/api/bootstrap')).json();
  const call=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':bootstrap.csrf,...headers},body:JSON.stringify(body)});
  t.after(async()=>{await new Promise(resolve=>studio.server.close(resolve));await studio.save();await rm(dir,{recursive:true,force:true});});
  return {...studio,dir,url,bootstrap,call,provider};
}
async function waitUntil(predicate){for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for test state');}
test('overlapping batches snapshot settings, references and credentials and complete independently across projects',async t=>{
  const pending=[];
  const f=await fixture(t,{key:'parallel-test-key',fetchImpl:async(url,options={})=>{
    if(options.method==='POST')return new Promise(resolve=>pending.push({id:'parallel-'+(pending.length+1),url,options,input:JSON.parse(options.body),resolve}));
    if(url.endsWith('/status'))return response({status:'COMPLETED'});
    const entry=pending.find(p=>url.endsWith('/'+p.id));assert(entry);
    const media={url:`https://v3.fal.media/${entry.id}.${entry.url.includes('/image-to-video')?'mp4':'png'}`,width:480,height:480};
    return response(entry.url.includes('/image-to-video')?{video:{...media,content_type:'video/mp4'}}:{images:[{...media,content_type:'image/png'}]});
  }});
  assert.equal(f.bootstrap.features.concurrentGenerations,true);
  const upload=await fetch(f.url+'/api/uploads',{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':f.bootstrap.csrf,'X-Media-Metadata':JSON.stringify({width:480,height:480})},body:png});
  const {id}=await upload.json(),{project}=await(await f.call('/api/projects',{type:'create',name:'Parallel video'})).json();
  const aRequest={...base,inputType:'image',count:2,prompt:'First batch blue sculpture',referenceIds:[id],destination:'ideation',canvasPosition:{x:0,y:0}};
  const bRequest={...base,model:'wan3',inputType:'image',resolution:'480p',ratio:'16:9',prompt:'Second batch moving sculpture',referenceIds:[id],projectId:project.id,destination:'ideation',canvasPosition:{x:0,y:0}};
  const receipts=await Promise.all([f.call('/api/generate',aRequest),f.call('/api/generate',bRequest),f.call('/api/generate',{...base,prompt:'Third batch failure'})]);
  assert(receipts.every(r=>r.status===202));const [a,b,c]=await Promise.all(receipts.map(async r=>(await r.json()).job));assert.equal(new Set([a.id,b.id,c.id]).size,3);
  await waitUntil(()=>pending.length===3);
  const release=entry=>entry.resolve(response({request_id:entry.id,status_url:`https://queue.fal.run/test/model/requests/${entry.id}/status`,response_url:`https://queue.fal.run/test/model/requests/${entry.id}`}));
  const defaultState=await(await fetch(f.url+'/api/jobs')).json();assert.deepEqual(new Set(defaultState.activeProjectIds),new Set(['default',project.id]));assert.equal(defaultState.jobs.length,2);
  await fetch(f.url+'/api/uploads/'+id,{method:'DELETE',headers:{'X-Studio-Token':f.bootstrap.csrf}});await f.call('/api/settings',{key:'replacement-test-key'});
  release(pending.find(p=>p.input.prompt===bRequest.prompt));pending.find(p=>p.input.prompt==='Third batch failure').resolve(response({detail:'Failure in this batch only'},422));
  await waitUntil(async()=>{const jobs=(await(await fetch(f.url+'/api/jobs?project='+project.id)).json()).jobs;return jobs[0].tasks[0].status==='IN_QUEUE';});
  await f.refresh();const videoJob=(await(await fetch(f.url+'/api/jobs?project='+project.id)).json()).jobs[0];assert.equal(videoJob.id,b.id);assert.equal(videoJob.tasks[0].status,'COMPLETED');
  const first=pending.find(p=>p.input.prompt===aRequest.prompt);release(first);await waitUntil(()=>pending.length===4);release(pending[3]);
  await waitUntil(async()=>{const jobs=(await(await fetch(f.url+'/api/jobs')).json()).jobs;return jobs.find(j=>j.id===a.id).tasks.every(t=>t.status==='IN_QUEUE');});
  await f.refresh();const final=await(await fetch(f.url+'/api/jobs')).json();assert.deepEqual(final.activeProjectIds,[]);assert(final.jobs.find(j=>j.id===a.id).tasks.every(t=>t.status==='COMPLETED'));assert.equal(final.jobs.find(j=>j.id===c.id).tasks[0].status,'FAILED');
  assert(pending.every(p=>p.options.headers.Authorization==='Key parallel-test-key'));assert.deepEqual(pending[3].input,first.input);assert.deepEqual(first.input.image_urls,['data:image/png;base64,'+png.toString('base64')]);
  const {board}=await(await fetch(f.url+'/api/ideation')).json(),videoBoard=(await(await fetch(f.url+'/api/ideation?project='+project.id)).json()).board;assert.equal(board.items.length,2);assert(board.items.every(item=>item.jobId===a.id));assert.equal(videoBoard.items.length,1);assert.equal(videoBoard.items[0].jobId,b.id);
  await f.save();const saved=await readFile(join(f.dir,'jobs.json'),'utf8');assert.equal(JSON.parse(saved).length,3);assert(!saved.includes('parallel-test-key'));assert(!saved.includes('data:image'));
});
test('local security: host, origin, CSRF, missing key and static-file isolation',async t=>{
  const f=await fixture(t);
  assert.equal(f.bootstrap.keyConfigured,false);
  assert.equal((await f.call('/api/generate',base)).status,401);
  assert.equal((await f.call('/api/settings',{key:'secret'},{'X-Studio-Token':'bad'})).status,403);
  assert.equal((await f.call('/api/settings',{key:'secret'},{Origin:'https://evil.example'})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const req=http.get(f.url+'/api/bootstrap',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(wrongHost,403);
  assert.equal((await fetch(f.url+'/.local/jobs.json')).status,404);
  assert.equal((await fetch(f.url+'/server.mjs')).status,404);
  assert.equal((await fetch(f.url+'/')).status,200);
});
test('end-to-end mock generation, download, key secrecy and history persistence',async t=>{
  const f=await fixture(t,{autoArchive:true});
  assert.equal((await f.call('/api/settings',{key:'test-key-private'})).status,200);
  const res=await f.call('/api/generate',{...base,count:2});assert.equal(res.status,202);
  await waitUntil(()=>f.provider.calls.filter(c=>c.options.method==='POST').length===2);
  await f.refresh();
  const raw=await (await fetch(f.url+'/api/jobs')).text();const {jobs}=JSON.parse(raw);
  assert.equal(jobs.length,1);assert.equal(jobs[0].tasks.length,2);
  assert(jobs[0].tasks.every(task=>task.status==='COMPLETED'));
  assert(!raw.includes('test-key-private'));assert(!raw.includes('statusURL'));
  const stored=await readFile(join(f.dir,'jobs.json'),'utf8');assert(!stored.includes('test-key-private'));assert(!stored.includes('data:image'));
  assert(f.provider.calls.filter(c=>c.url.startsWith('https://queue.fal.run')).every(c=>c.options.headers.Authorization==='Key test-key-private'));
  assert(f.provider.calls.filter(c=>!c.url.startsWith('https://queue.fal.run')).every(c=>!c.options.headers?.Authorization));
  assert(jobs[0].tasks.every(t=>t.outputs.every(m=>m.savedLocally)));
  const file=await fetch(`${f.url}/api/download?job=${jobs[0].id}&index=0`);assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);assert.match(file.headers.get('content-disposition'),/attachment/);
});
test('uploads are validated and included as data URIs, never persisted in history',async t=>{
  const f=await fixture(t,{key:'mock-key'});
  const sendUpload=(data,type)=>fetch(f.url+'/api/uploads',{method:'POST',headers:{'X-Studio-Token':f.bootstrap.csrf,'Content-Type':type},body:data});
  assert.equal((await sendUpload('bad','image/png')).status,400);
  const uploaded=await (await sendUpload(Buffer.from([137,80,78,71,13,10,26,10]),'image/png')).json();
  assert.equal((await f.call('/api/generate',{...base,inputType:'image',referenceIds:[uploaded.id]})).status,202);
  await waitUntil(()=>f.provider.calls.length>0);
  const sent=JSON.parse(f.provider.calls[0].options.body);assert.match(sent.image_urls[0],/^data:image\/png;base64,/);
  await f.refresh();assert(!(await readFile(join(f.dir,'jobs.json'),'utf8')).includes('base64'));
});
test('local upload and generation API forwards all eight references in order without truncation',async t=>{
  const f=await fixture(t,{key:'mock-key'}),ids=[];
  for(let i=0;i<9;i++){
    const res=await fetch(f.url+'/api/uploads',{method:'POST',headers:{'X-Studio-Token':f.bootstrap.csrf,'Content-Type':'image/png'},body:Buffer.concat([png,Buffer.from([i])])});
    assert.equal(res.status,201);ids.push((await res.json()).id);
  }
  assert.equal(f.bootstrap.models.find(m=>m.id==='nano-pro').maxImages,8);
  assert.equal((await f.call('/api/generate',{...base,inputType:'image',referenceIds:ids})).status,400);
  assert.equal(f.provider.calls.length,0);
  assert.equal((await f.call('/api/generate',{...base,inputType:'image',referenceIds:ids.slice(0,8)})).status,202);
  await waitUntil(()=>f.provider.calls.length>0);
  const sent=JSON.parse(f.provider.calls[0].options.body);
  assert.deepEqual(sent.image_urls,ids.slice(0,8).map((_,i)=>'data:image/png;base64,'+Buffer.concat([png,Buffer.from([i])]).toString('base64')));
});
test('new image models submit exact schemas, save their controls and land on the project canvas',async t=>{
  for(const id of ['nano21','krea2-large','krea2-medium','krea2-medium-turbo'])for(const inputType of ['text','image'])await t.test(id+' '+inputType,async st=>{
    const f=await fixture(st,{key:'mock-key'}),model=byId(id),referenceIds=[];
    if(inputType==='image'){
      const response=await fetch(f.url+'/api/uploads',{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':f.bootstrap.csrf},body:png});referenceIds.push((await response.json()).id);
    }
    const controls=id==='nano21'?{thinking:'high'}:{creativity:'raw'},body={...request(model,inputType),...controls,referenceIds,destination:'ideation',canvasPosition:{x:0,y:0}};
    const response=await f.call('/api/generate',body);assert.equal(response.status,202);
    await waitUntil(async()=>{const {jobs}=await(await fetch(f.url+'/api/jobs')).json();return jobs[0]?.tasks.every(t=>t.status==='IN_QUEUE');});await f.refresh();
    const submit=f.provider.calls.find(c=>c.options.method==='POST'),payload=JSON.parse(submit.options.body),schema=fixtures.endpoints[model.endpoints[inputType]];
    assert.equal(submit.url,'https://queue.fal.run/'+model.endpoints[inputType]);assert(matches(payload,schema.input,schema.definitions));
    if(id==='nano21')assert.equal(payload.thinking_level,'high');else{assert.equal(payload.creativity,'raw');assert.equal(payload.resolution,undefined);assert.equal(payload.num_images,undefined);if(inputType==='image')assert.match(payload.image_style_references[0].image_url,/^data:image\/png;base64,/);}
    const {jobs}=await(await fetch(f.url+'/api/jobs')).json();for(const [key,value]of Object.entries(controls))assert.equal(jobs[0].settings[key],value);
    assert.equal((await(await fetch(f.url+'/api/ideation')).json()).board.items.length,1);
  });
});
test('new model creativity and thinking options are validated before provider submission',()=>{
  assert.throws(()=>buildInput({...request(byId('nano21')),thinking:'invalid'}),/thinking/);
  assert.throws(()=>buildInput({...request(byId('krea2-large')),creativity:'invalid'}),/creativity/);
  for(const creativity of ['raw','low','medium','high'])assert.equal(buildInput({...request(byId('krea2-large')),creativity}).input.creativity,creativity);
  for(const thinking of ['minimal','medium','high'])assert.equal(buildInput({...request(byId('nano21')),thinking}).input.thinking_level,thinking);
});
test('upload API sends 30 images, 10 videos and 10 audio files to Seedance without leaking them into saved history',async t=>{
  const f=await fixture(t,{key:'mock-key'}),ids=[],expected={image_urls:[],video_urls:[],audio_urls:[]};
  const upload=async(ref,data)=>fetch(f.url+'/api/uploads',{method:'POST',headers:{'X-Studio-Token':f.bootstrap.csrf,'Content-Type':ref.contentType,'X-Media-Metadata':JSON.stringify(ref.metadata)},body:data});
  assert.equal((await upload(audio,Buffer.from('fake WAV'))).status,400);
  assert.equal((await upload(audio,Buffer.alloc(15*1024*1024+1))).status,413);
  for(let i=0;i<30;i++){
    for(const ref of i<10?[image,{...video,metadata:{...video.metadata,duration:2}},audio]:[image]){
      const signature=ref.kind==='image'?png:ref.kind==='video'?Buffer.from([0,0,0,20,102,116,121,112]):Buffer.from('RIFF0000WAVE');
      const data=Buffer.concat([signature,Buffer.from([i])]),res=await upload(ref,data);
      assert.equal(res.status,201);const saved=await res.json();assert.equal(saved.kind,ref.kind);ids.push(saved.id);
      expected[`${ref.kind}_urls`].push(`data:${ref.contentType};base64,${data.toString('base64')}`);
    }
  }
  assert.equal(f.provider.calls.length,0);
  assert.equal((await f.call('/api/generate',{...request(byId('seedance25'),'video'),referenceIds:ids})).status,202);
  await waitUntil(()=>f.provider.calls.length>0);
  assert.equal(f.provider.calls[0].url,'https://queue.fal.run/bytedance/seedance-2.5/reference-to-video');
  const sent=JSON.parse(f.provider.calls[0].options.body);
  for(const key of Object.keys(expected))assert.deepEqual(sent[key],expected[key]);
  assert(!(await readFile(join(f.dir,'jobs.json'),'utf8')).includes('base64'));
});
test('HTTP generation routes mixed media, ordered frames, soundtracks and keyframe times per model',async t=>{
  const cases=[
    ['wan3','video',[audio,image,video]],
    ['minimax-h3','video',[audio,image,video]],
    ['wan3','frames',[image,image]],
    ['seedance25','frames',[image,image]],
    ['minimax-h3','frames',[audio,image,image]],
    ['minimax-h3','end',[audio,image]],
    ['flux3-video','frames',[image,image]],
    ['flux3-video','keyframes',[image,image]],
    ['flux3-video','edit',[video]],
  ];
  for(const [id,inputType,refs] of cases)await t.test(`${id} ${inputType}`,async st=>{
    const f=await fixture(st,{key:'mock-key'}),referenceIds=[],expectedRefs=[];
    for(const [i,ref] of refs.entries()){
      const signature=ref.kind==='image'?png:ref.kind==='video'?Buffer.from([0,0,0,20,102,116,121,112]):Buffer.from('RIFF0000WAVE');
      const bytes=Buffer.concat([signature,Buffer.from([i])]);
      const upload=await fetch(f.url+'/api/uploads',{method:'POST',headers:{'X-Studio-Token':f.bootstrap.csrf,'Content-Type':ref.contentType,'X-Media-Metadata':JSON.stringify(ref.metadata)},body:bytes});
      assert.equal(upload.status,201);referenceIds.push((await upload.json()).id);
      expectedRefs.push({...ref,bytes:bytes.length,data:`data:${ref.contentType};base64,${bytes.toString('base64')}`});
    }
    const body={...request(byId(id),inputType),referenceIds,...(inputType==='keyframes'?{frameIndices:[0,120]}:{})};
    const expected=buildInput(body,expectedRefs),res=await f.call('/api/generate',body);
    assert.equal(res.status,202);const {job}=await res.json();
    await waitUntil(()=>f.provider.calls.some(c=>c.options.method==='POST'));
    const submit=f.provider.calls.find(c=>c.options.method==='POST');
    assert.equal(submit.url,`https://queue.fal.run/${expected.endpoint}`);
    assert.deepEqual(JSON.parse(submit.options.body),expected.input);
    if(inputType==='keyframes')assert.deepEqual(job.settings.frameIndices,[0,120]);
  });
});
test('provider failure does not discard successful outputs in the same batch',async t=>{
  let submits=0;const provider=mockProvider();
  const f=await fixture(t,{key:'mock-key',fetchImpl:async(url,opts)=>{
    if(opts.method==='POST'&&++submits===2)return response({detail:'Insufficient credits'},402);
    return provider.fn(url,opts);
  }});
  await f.call('/api/generate',{...base,count:2});await waitUntil(()=>submits===2);await new Promise(r=>setTimeout(r,20));await f.refresh();
  const {jobs}=await (await fetch(f.url+'/api/jobs')).json();assert.equal(jobs[0].tasks[0].status,'COMPLETED');assert.equal(jobs[0].tasks[1].status,'FAILED');assert.match(jobs[0].tasks[1].error,/credits/);
});
test('untrusted queue URLs never receive the API key',async t=>{
  let calls=0;
  const f=await fixture(t,{key:'mock-key',fetchImpl:async()=>{calls++;return response({request_id:'r1',status_url:'https://evil.example/status',response_url:'https://evil.example/result'});}});
  await f.call('/api/generate',base);await new Promise(r=>setTimeout(r,30));await f.refresh();
  const {jobs}=await (await fetch(f.url+'/api/jobs')).json();assert.equal(jobs[0].tasks[0].status,'UNKNOWN');assert.equal(calls,1);
});
test('transient polling failures remain recoverable and do not resubmit paid requests',async t=>{
  let outage=true;const provider=mockProvider();
  const f=await fixture(t,{key:'mock-key',fetchImpl:async(url,opts)=>{
    if(url.endsWith('/status')&&outage)return response({detail:'Try later'},503);return provider.fn(url,opts);
  }});
  await f.call('/api/generate',base);await waitUntil(()=>provider.calls.length>0);await new Promise(r=>setTimeout(r,10));await f.refresh();
  let {jobs}=await (await fetch(f.url+'/api/jobs')).json();assert.equal(jobs[0].tasks[0].status,'IN_QUEUE');assert(jobs[0].tasks[0].notice);
  outage=false;await f.refresh();({jobs}=await (await fetch(f.url+'/api/jobs')).json());assert.equal(jobs[0].tasks[0].status,'COMPLETED');assert.equal(provider.calls.filter(c=>c.options.method==='POST').length,1);
});
test('restart recovers queued requests and marks interrupted submissions unknown',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'frame-restart-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'jobs.json'),JSON.stringify([{id:'saved',createdAt:new Date().toISOString(),settings:base,modelName:'Nano Banana 2',mode:'image',tasks:[{status:'IN_QUEUE',requestId:'saved1',statusURL:'https://queue.fal.run/test/model/requests/saved1/status',resultURL:'https://queue.fal.run/test/model/requests/saved1',outputs:[]},{status:'SUBMITTING',outputs:[]}]}]));
  const provider=mockProvider();const s=await createStudio({dataDir:dir,key:'mock-key',fetchImpl:provider.fn,pollMs:3600000,autoArchive:false});await s.refresh();s.server.emit('close');
  const jobs=JSON.parse(await readFile(join(dir,'jobs.json'),'utf8'));assert.equal(jobs[0].tasks[0].status,'COMPLETED');assert.equal(jobs[0].tasks[1].status,'UNKNOWN');assert(!provider.calls.some(c=>c.options.method==='POST'));
});

const libraryJob=()=>({id:'library',createdAt:new Date().toISOString(),settings:base,modelName:'Nano Banana Pro',mode:'image',tasks:[
  {status:'COMPLETED',outputs:[{url:'https://v3.fal.media/one.png',contentType:'image/png'},{url:'https://v3.fal.media/two.png',contentType:'image/png'}]},
  {status:'COMPLETED',outputs:[{url:'https://v3.fal.media/clip.mp4',contentType:'video/mp4'}]}
]});
test('favorites persist per image and video through restart; removing a favorite keeps history',async t=>{
  const f=await fixture(t,{seedJobs:[libraryJob()]});
  const list=async()=> (await (await fetch(f.url+'/api/jobs')).json()).jobs;
  const outputs=(await list())[0].tasks.flatMap(t=>t.outputs);
  assert.equal(new Set(outputs.map(m=>m.id)).size,3);
  for(const index of [1,2])assert.equal((await f.call('/api/favorites',{jobId:'library',mediaId:outputs[index].id,favorite:true})).status,200);
  const saved=JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'))[0].tasks.flatMap(t=>t.outputs);
  assert.equal(!!saved[0].favorite,false);assert.equal(saved[1].favorite,true);assert.equal(saved[2].favorite,true);
  const restarted=await createStudio({dataDir:f.dir,pollMs:3600000,autoArchive:false});
  await new Promise(r=>restarted.server.listen(0,'127.0.0.1',r));
  const reload=await(await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/jobs`)).json();
  await new Promise(r=>restarted.server.close(r));
  assert.deepEqual(reload.jobs[0].tasks.flatMap(t=>t.outputs).map(({savedLocally,localBytes,...m})=>m),saved);
  await f.call('/api/favorites',{jobId:'library',mediaId:outputs[1].id,favorite:false});
  const remaining=(await list())[0].tasks.flatMap(t=>t.outputs);
  assert.equal(remaining.length,3);assert.equal(remaining[1].favorite,false);assert.equal(remaining[2].favorite,true);
});
test('favorite mutations reject malformed, unknown, and cross-site selections',async t=>{
  const f=await fixture(t,{seedJobs:[libraryJob()]});
  for(const body of [{},{jobId:'library',mediaId:'nope',favorite:'yes'}])assert.equal((await f.call('/api/favorites',body)).status,400);
  assert.equal((await f.call('/api/favorites',{jobId:'library',mediaId:'nope',favorite:true})).status,404);
  assert.equal((await f.call('/api/favorites',{}, {'X-Studio-Token':'wrong'})).status,403);
  assert.equal((await f.call('/api/favorites',{}, {Origin:'https://example.com'})).status,403);
});
test('stable media references use local bytes without sharing credentials; oversized and spoofed references fail',async t=>{
  const seed=libraryJob();seed.tasks=[{status:'COMPLETED',outputs:['one','two','three'].map(n=>({url:`https://v3.fal.media/${n}.png`,contentType:'image/png'}))}];
  const large=Buffer.alloc(11*1024*1024);png.copy(large);const calls=[];
  const f=await fixture(t,{key:'must-stay-private',seedJobs:[seed],fetchImpl:async(url,options)=>{
    calls.push({url,options});const bytes=url.endsWith('one.png')?png:url.endsWith('two.png')?large:Buffer.from('not an image');
    return new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':String(bytes.length)}});
  }});
  const {jobs}=await(await fetch(f.url+'/api/jobs')).json(),ids=jobs[0].tasks[0].outputs.map(m=>m.id);
  const url=id=>f.url+`/api/media?job=library&media=${id}&reference=1`;
  const result=await fetch(url(ids[0]));assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
  assert.equal(calls[0].url,'https://v3.fal.media/one.png');assert.equal(calls[0].options.headers?.Authorization,undefined);assert.equal(calls[0].options.redirect,'error');
  assert.equal((await fetch(url(ids[1]))).status,413);
  const seedanceReference=await fetch(url(ids[1])+'&model=seedance25');assert.equal(seedanceReference.status,200);assert.equal((await seedanceReference.arrayBuffer()).byteLength,large.length);
  assert.equal((await fetch(url(ids[2]))).status,400);
  const before=calls.length;assert.equal((await fetch(f.url+'/api/media?job=library&media=https://evil.example')).status,404);assert.equal(calls.length,before);
});
test('inline video playback serves byte ranges from the local copy without re-fetching',async t=>{
  const bytes=Buffer.alloc(100);bytes.write('ftyp',4);const requests=[];
  const f=await fixture(t,{seedJobs:[libraryJob()],fetchImpl:async(url,options)=>{
    requests.push({url,options});return new Response(bytes,{headers:{'Content-Length':'100'}});
  }});
  const {jobs}=await(await fetch(f.url+'/api/jobs')).json(),id=jobs[0].tasks[1].outputs[0].id;
  const path=f.url+`/api/media?job=library&media=${id}`;
  const res=await fetch(path,{headers:{Range:'bytes=0-3'}});
  assert.equal(res.status,206);assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes.subarray(0,4));assert.equal(res.headers.get('content-range'),'bytes 0-3/100');assert.match(res.headers.get('content-disposition'),/^inline/);
  const suffix=await fetch(path,{headers:{Range:'bytes=-6'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,6);
  const bad=await fetch(path,{headers:{Range:'bytes=100-200'}});assert.equal(bad.status,416);assert.equal(bad.headers.get('content-range'),'bytes */100');
  assert.equal(requests.length,1);assert.equal(requests[0].url,'https://v3.fal.media/clip.mp4');assert.equal(requests[0].options.headers?.Range,undefined);
});

test('ideation API is protected, persists edits, and places generated batches without sending canvas data to fal',async t=>{
  const f=await fixture(t,{key:'mock-key'});
  assert.equal(f.bootstrap.features.ideation,true);
  for(const asset of ['ideation.js','canvas-state.js','ideation.css'])assert.equal((await fetch(f.url+'/'+asset)).status,200);
  assert.equal((await f.call('/api/ideation',{operations:[{type:'title',title:'Intruder'}]},{'X-Studio-Token':'bad'})).status,403);
  for(const bad of [{destination:'other'},{destination:'ideation',canvasPosition:{x:'no',y:0}}])assert.equal((await f.call('/api/generate',{...base,...bad})).status,400);
  assert.equal(f.provider.calls.length,0);
  assert.equal((await f.call('/api/generate',{...base,count:2,destination:'ideation',canvasPosition:{x:-500,y:200}})).status,202);
  await waitUntil(async()=>{const {jobs}=await(await fetch(f.url+'/api/jobs')).json();return jobs[0]?.tasks.every(t=>t.status==='IN_QUEUE');});await f.refresh();
  const {board}=await(await fetch(f.url+'/api/ideation')).json();assert.equal(board.items.length,2);assert.equal(board.items[0].x,-500);assert.equal(board.items[0].y,200);assert.notEqual(board.items[0].x,board.items[1].x);
  for(const call of f.provider.calls.filter(c=>c.options.method==='POST')){const sent=JSON.parse(call.options.body);assert.equal(sent.destination,undefined);assert.equal(sent.canvasPosition,undefined);}
  const changed=await f.call('/api/ideation',{operations:[{type:'update',id:board.items[0].id,patch:{x:600,y:-200}},{type:'title',title:'Explorations'}]});assert.equal(changed.status,200);
  const saved=JSON.parse(await readFile(join(f.dir,'ideation.json'),'utf8'));assert.equal(saved.title,'Explorations');assert.equal(saved.items[0].x,600);
  await f.call('/api/ideation',{operations:[{type:'remove',ids:board.items.map(i=>i.id)}]});await f.refresh();assert.equal((await(await fetch(f.url+'/api/ideation')).json()).board.items.length,0);
  assert.equal((await(await fetch(f.url+'/api/jobs')).json()).jobs[0].tasks.length,2);
});

test('generation in a project stays in its history and canvas while global queue state stays visible',async t=>{
  const f=await fixture(t,{key:'mock-key'});const {project}=await(await f.call('/api/projects',{type:'create',name:'Motion campaign'})).json();
  assert.equal((await f.call('/api/generate',{...base,projectId:'missing'})).status,400);assert.equal(f.provider.calls.length,0);
  assert.equal((await f.call('/api/generate',{...base,projectId:project.id,destination:'ideation',count:2})).status,202);
  const status=await(await fetch(f.url+'/api/jobs')).json();assert.deepEqual(status.activeProjectIds,[project.id]);assert.equal(status.jobs.length,0);
  await waitUntil(async()=>{const {jobs}=await(await fetch(f.url+'/api/jobs?project='+project.id)).json();return jobs[0]?.tasks.every(t=>t.status==='IN_QUEUE');});await f.refresh();
  const {jobs}=await(await fetch(f.url+'/api/jobs?project='+project.id)).json();assert.equal(jobs[0].projectId,project.id);assert.equal((await(await fetch(f.url+'/api/ideation?project='+project.id)).json()).board.items.length,2);assert.equal((await(await fetch(f.url+'/api/ideation')).json()).board.items.length,0);
  for(const call of f.provider.calls.filter(c=>c.options.method==='POST'))assert.equal(JSON.parse(call.options.body).projectId,undefined);
  await f.call('/api/favorites',{projectId:project.id,jobId:jobs[0].id,mediaId:jobs[0].tasks[0].outputs[0].id,favorite:true});
  const summaries=(await(await fetch(f.url+'/api/projects')).json()).projects;assert.equal(summaries.find(p=>p.id===project.id).favorites,1);assert.equal(summaries.find(p=>p.id==='default').favorites,0);
});

test('long prompt limits match each model and starting point without exceeding published schema bounds',()=>{
  for(const model of MODELS.filter(m=>m.available)){
    const c=capabilities(model,'text'),prompt='x'.repeat(c.maxPrompt),body={...request(model),prompt};
    const {input,endpoint}=buildInput(body);assert.equal(input.prompt,prompt);
    const limit=fixtures.endpoints[endpoint].input.properties.prompt.maxLength;
    if(limit)assert(c.maxPrompt<=limit,model.name);
    assert.throws(()=>buildInput({...body,prompt:prompt+'x'}),/accepts up to/);
  }
  assert.equal(byId('nano-pro').maxPrompt,30000);assert.equal(byId('nano21').maxPrompt,50000);
  const model=byId('flux3-video'),body={...request(model,'edit'),prompt:'x'.repeat(4096)};
  assert.equal(buildInput(body,[video]).input.prompt.length,4096);
  assert.throws(()=>buildInput({...body,prompt:body.prompt+'x'},[video]),/4,096/);
});

test('30,000-character Unicode prompts reach the API and saved history intact',async t=>{
  const f=await fixture(t,{key:'mock-key'}),prompt='画'.repeat(30000);
  assert(Buffer.byteLength(JSON.stringify({...base,prompt}))>64*1024);
  const response=await f.call('/api/generate',{...base,prompt});assert.equal(response.status,202);
  const receipt=await response.json();assert.equal(receipt.job.settings.prompt,prompt);
  await waitUntil(()=>f.provider.calls.some(c=>c.options.method==='POST'));
  assert.equal(JSON.parse(f.provider.calls.find(c=>c.options.method==='POST').options.body).prompt,prompt);
  const rejected=await f.call('/api/generate',{...base,prompt:prompt+'画'});assert.equal(rejected.status,400);
  assert.equal(f.provider.calls.filter(c=>c.options.method==='POST').length,1);
  await f.refresh();assert.equal(JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'))[0].settings.prompt,prompt);
});
