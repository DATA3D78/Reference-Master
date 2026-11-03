import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../server.mjs';
import {customPaths} from '../custom-files.mjs';
import {TOOLS,buildToolInput,estimateToolCost} from '../public/tools-models.js';
import {AUDIO_MODELS,buildAudioInput,estimateAudioCost} from '../public/audio-models.js';
import {createFalRouter,falQueueURLs,validFalURL,normalizeFalOutputs} from '../fal-router.mjs';
const mp4=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(32)]);
const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(32)]);
const music={model:'music-3',prompt:'Gentle piano',lyrics:'[instrumental]',referenceIds:[],options:{duration:60}};
async function waitFor(fn){for(let i=0;i<300;i++){if(await fn())return;await delay(5);}throw Error('Test condition timed out');}
async function fixture(t,{comfyKey='',falKey='test-fal-secret',initial}={}){
  const root=await mkdtemp(join(tmpdir(),'fwrd-hybrid-')),dataDir=join(root,'data'),paths=customPaths(root),servers=[];
  await mkdir(paths.promptPresetDir);await mkdir(dataDir);
  await writeFile(paths.comfyKeyFile,comfyKey);await writeFile(paths.falKeyFile,falKey);await writeFile(paths.openRouterKeyFile,'');
  if(initial)await writeFile(join(dataDir,'jobs.json'),JSON.stringify(initial));
  const calls=[],requests=new Map();let expectedFal=falKey,clock=Date.now();t.mock.method(Date,'now',()=>clock);
  t.after(async()=>{for(const app of servers)if(app.server.listening)await new Promise(r=>{app.server.close(r);app.server.closeAllConnections();});await rm(root,{recursive:true,force:true});});
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url);calls.push({url,method:options.method,headers:options.headers,body:options.body&&JSON.parse(options.body)});
    if(u.hostname==='media.example.com'){
      assert(!options.headers?.Authorization);assert(!options.headers?.['X-API-Key']);
      return new Response(u.pathname.endsWith('.wav')?wav:mp4,{headers:{'Content-Type':u.pathname.endsWith('.wav')?'audio/wav':'video/mp4'}});
    }
    if(u.hostname==='api.comfy.org'){
      assert.equal(options.headers['X-API-Key'],comfyKey);assert.equal(options.headers.Authorization,undefined);
      return Response.json({source:'exact',currency:'USD',amount:'0.12'});
    }
    assert.equal(options.headers.Authorization,'Key '+expectedFal);assert.equal(options.headers['X-API-Key'],undefined);assert.equal(options.redirect,'error');
    if(u.hostname==='api.fal.ai'){
      assert.equal(u.pathname,'/v1/models/billing-events');
      return Response.json({has_more:false,billing_events:u.searchParams.getAll('request_id').map(id=>({request_id:id,cost_total:.08}))});
    }
    assert.equal(u.origin,'https://queue.fal.run');
    if(options.method==='POST'){
      const id='fal-'+(requests.size+1),endpoint=u.pathname.slice(1);requests.set(id,{endpoint});
      return Response.json({request_id:id,status:'IN_QUEUE',status_url:'https://evil.example/status',response_url:'https://evil.example/result'},{headers:{'Retry-After':'1'}});
    }
    const id=u.pathname.split('/')[4],record=requests.get(id);assert(record,u.pathname);
    const urls=falQueueURLs(record.endpoint,id);assert([urls.statusURL,urls.resultURL].includes(url));
    if(url===urls.statusURL)return Response.json({status:'COMPLETED',...(record.error?{error:record.error}:{})},{headers:{'Retry-After':'1'}});
    return Response.json(record.endpoint==='minimax/music-3'?{audio:{url:'https://media.example.com/'+id+'.wav',content_type:'image/png'},duration:45}:{video:{url:'https://media.example.com/'+id+'.mp4'}});
  };
  async function launch(){
    const app=await createStudio({...paths,dataDir,key:undefined,falKey:undefined,openRouterKey:'',pollMs:1e8,autoArchive:true,fetchImpl});servers.push(app);
    await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    const origin='http://127.0.0.1:'+app.server.address().port,bootstrap=await(await fetch(origin+'/api/bootstrap')).json();
    const api=async(path,body)=>{const res=await fetch(origin+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':bootstrap.csrf},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
    const upload=async()=>{const res=await fetch(origin+'/api/uploads',{method:'POST',headers:{'Content-Type':'video/mp4','X-Studio-Token':bootstrap.csrf,'X-Media-Metadata':JSON.stringify({width:640,height:360,duration:10})},body:mp4});assert.equal(res.status,201);return res.json();};
    return {app,origin,bootstrap,api,upload};
  }
  return {...await launch(),launch,paths,dataDir,calls,requests,advance:ms=>{clock+=ms;},setExpectedFal:key=>{expectedFal=key;}};
}
test('all media tools and audio models use fal; estimates reflect frame count, output dimensions and duration',()=>{
  assert.deepEqual(TOOLS.filter(t=>t.provider==='fal').map(t=>t.id),['seedvr-video','seedvr-seamless','depth-anything']);
  assert.equal(AUDIO_MODELS.find(m=>m.id==='seed-audio').provider,'fal');
  const ref={kind:'video',contentType:'video/mp4',bytes:100,data:'data:video/mp4;base64,abcd',metadata:{width:640,height:360,duration:10,frameCount:300}};
  for(const tool of TOOLS.filter(t=>t.available&&t.kind==='video')){const built=buildToolInput({tool:tool.id},ref);assert.equal(built.input.video_url,ref.data);assert.equal(built.tool.provider,'fal');}
  const a=estimateToolCost('seedvr-video',{upscale_factor:2},ref.metadata),b=estimateToolCost('seedvr-video',{upscale_factor:4},ref.metadata);
  assert.equal(b.amount,a.amount*4);assert.equal(estimateToolCost('seedvr-video',{}, {...ref.metadata,frameCount:600}).amount,a.amount*2);
  assert.equal(estimateToolCost('seedvr-video',{}, {...ref.metadata,frameCount:undefined}).available,false);
  assert.equal(estimateToolCost('depth-anything',{},ref.metadata).amount,.4);
  assert.equal(estimateAudioCost('music-3',{duration:120}).amount,.24);assert.equal(estimateAudioCost('music-3',{},45).amount,.09);
  assert.equal(estimateAudioCost('seed-audio').available,false);
  const built=buildAudioInput(music);assert.equal(built.endpoint,'minimax/music-3');assert.equal(built.input.lyrics,'[instrumental]');assert.equal(built.input.enable_safety_checker,true);
  assert.throws(()=>buildAudioInput({...music,lyrics:''}),/lyrics/);
});
test('fal credentials stay on the queue allowlist, including correct subpath polling',async()=>{
  const urls=falQueueURLs('fal-ai/seedvr/upscale/video','req-123');assert.equal(urls.statusURL,'https://queue.fal.run/fal-ai/seedvr/requests/req-123/status');
  let calls=0;const client=createFalRouter(async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Key fal-secret');return Response.json({request_id:'req-123'});});
  for(const url of ['https://evil.example/status','https://queue.fal.run.evil.example/fal-ai/seedvr','https://queue.fal.run/fal-ai/unlisted','https://secret@queue.fal.run/minimax/music-3','https://api.comfy.org/v2/models/minimax/music-3','https://queue.fal.run/minimax/music-3?redirect=evil']){
    assert(!validFalURL(url));await assert.rejects(client.request(url,{credential:'fal-secret'}));
  }
  await client.request(urls.statusURL,{credential:'fal-secret'});assert.equal(calls,1);
  assert.throws(()=>normalizeFalOutputs('minimax/music-3',{}),/no downloadable/);
  assert.throws(()=>normalizeFalOutputs('minimax/music-3',{audio:{url:'broken'}}),{status:422});
});
test('fal-only key submits all three models, saves outputs, preserves music lyrics and confirms billing',async t=>{
  const f=await fixture(t);assert.equal(f.bootstrap.keyConfigured,true);assert.equal(f.bootstrap.falKeyConfigured,true);
  const source=await f.upload();
  for(const tool of ['seedvr-video','depth-anything'])assert.equal((await f.api('/api/tools/generate',{tool,referenceId:source.id})).status,202);
  const musicResponse=await f.api('/api/audio/generate',music);assert.equal(musicResponse.status,202);assert.equal(musicResponse.data.job.settings.lyrics,music.lyrics);
  await waitFor(()=>f.requests.size===3);await delay(15);f.advance(2000);await f.app.refresh();
  const jobs=(await f.api('/api/jobs')).data.jobs;assert.equal(jobs.length,3);
  for(const job of jobs){assert.equal(job.provider,'fal');assert.equal(job.tasks[0].status,'COMPLETED',JSON.stringify(job));assert(job.tasks[0].outputs[0].savedLocally);const download=await fetch(f.origin+'/api/download?job='+job.id+'&media='+job.tasks[0].outputs[0].id);assert.equal(download.status,200);}
  const saved=await readFile(join(f.dataDir,'jobs.json'),'utf8');assert(!saved.includes('test-fal-secret'));assert(!saved.includes('evil.example'));
  const persisted=JSON.parse(saved);assert.equal(persisted.find(j=>j.mode==='audio').tasks[0].costEstimate.amount,.09);
  const summary=(await f.api('/api/spending/sync',{period:'day'})).data;assert.equal(summary.providers.fal.confirmed,.24);assert.equal(summary.providers.comfy.confirmed,0);
  assert(!f.calls.some(c=>c.url.includes('api.comfy.org')));
});
test('a Comfy key never substitutes for fal; file edits reload the fal key independently',async t=>{
  const f=await fixture(t,{comfyKey:'test-comfy-secret',falKey:''});
  const missing=await f.api('/api/audio/generate',music);assert.equal(missing.status,401);assert.match(missing.data.error,/fal.ai/);assert.equal(f.calls.length,0);
  await writeFile(f.paths.falKeyFile,'test-new-fal');f.setExpectedFal('test-new-fal');
  const quote=await f.api('/api/estimate',{kind:'audio',...music});assert.equal(quote.data.minimum,.12);assert.equal(f.calls.length,0);
  assert.equal((await f.api('/api/audio/generate',music)).status,202);await waitFor(()=>f.requests.size===1);
  const config=(await f.api('/api/bootstrap')).data;assert.equal(config.keyConfigured,true);assert.equal(config.falKeyConfigured,true);
  const imageQuote=await f.api('/api/estimate',{model:'nano-pro',inputType:'text',prompt:'Glass',ratio:'1:1',resolution:'1K',count:1,referenceIds:[]});assert.equal(imageQuote.data.minimum,.15);
  for(const file of ['COMFY_API_KEY_HERE.txt','FAL_API_KEY_HERE.txt','OPENROUTER_API_KEY_HERE.txt'])assert.equal((await fetch(f.origin+'/CUSTOM/'+file)).status,404);
  await writeFile(f.paths.falKeyFile,'# cleared');assert.equal((await f.api('/api/bootstrap')).data.falKeyConfigured,false);assert.equal((await f.api('/api/audio/generate',music)).status,401);
});
test('V2 fal queue resumes after restart; copied original requests stay isolated and failures show without retrying',async t=>{
  const initial=[{id:'legacy',provider:'fal',createdAt:new Date().toISOString(),settings:{},tasks:[{status:'IN_QUEUE',requestId:'legacy-id',outputs:[]}]}];
  const f=await fixture(t,{initial});await f.api('/api/audio/generate',music);await waitFor(()=>f.requests.size===1);await delay(15);
  await new Promise(r=>f.app.server.close(r));const next=await f.launch();f.requests.get('fal-1').error='content check failed';f.advance(2000);await next.app.refresh();
  const jobs=(await next.api('/api/jobs')).data.jobs;assert.equal(jobs.find(j=>j.id==='legacy').tasks[0].status,'UNKNOWN');
  const current=jobs.find(j=>j.id!=='legacy');assert.equal(current.tasks[0].status,'FAILED');assert.match(current.tasks[0].error,/content check failed/);assert.equal(f.requests.size,1);
});
