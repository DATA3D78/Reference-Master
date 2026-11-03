import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../server.mjs';
import {MODELS,capabilities} from '../public/models.js';
import {TOOLS} from '../public/tools-models.js';
import {AUDIO_MODELS} from '../public/audio-models.js';
import {falQueueURLs} from '../fal-router.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const mp4=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(32)]),mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(24)]);
const base={model:'nano-pro',inputType:'text',prompt:'Glass sculpture',ratio:'1:1',resolution:'1K',count:1,duration:'5',referenceIds:[]};
async function fixture(t,{falKey='test-fal-secret',comfyKey='',initial=[]}={}){
 const dir=await mkdtemp(join(tmpdir(),'fwrd-fal-test-')),servers=[],calls=[],requests=new Map();let clock=Date.now(),secret=falKey;
 t.mock.method(Date,'now',()=>clock);
 const keyFile=join(dir,'FAL_API_KEY_HERE.txt');await writeFile(keyFile,falKey);await writeFile(join(dir,'jobs.json'),JSON.stringify(initial));
 t.after(async()=>{for(const app of servers)if(app.server.listening)await new Promise(r=>{app.server.close(r);app.server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 const fetchImpl=async(url,options={})=>{
  const u=new URL(url);calls.push({url,method:options.method,input:options.body&&JSON.parse(options.body),headers:options.headers});
  if(u.hostname==='media.example.com'){assert(!options.headers?.Authorization);const video=u.pathname.endsWith('.mp4'),audio=u.pathname.endsWith('.mp3');return new Response(video?mp4:audio?mp3:png,{headers:{'content-type':video?'video/mp4':audio?'audio/mpeg':'image/png'}});}
  assert.equal(options.headers.Authorization,'Key '+secret);assert.equal(options.headers['X-API-Key'],undefined);assert.equal(options.redirect,'error');
  if(u.hostname==='api.fal.ai'){assert.equal(u.pathname,'/v1/models/billing-events');return Response.json({has_more:false,billing_events:u.searchParams.getAll('request_id').map(id=>({request_id:id,cost_total:.08}))});}
  assert.equal(u.origin,'https://queue.fal.run','New work must never call Comfy');
  if(options.method==='POST'){
   const id='fal-'+(requests.size+1),endpoint=u.pathname.slice(1);requests.set(id,{endpoint,status:'COMPLETED'});
   return Response.json({request_id:id,status:'IN_QUEUE',status_url:'https://evil.example/status',response_url:'https://evil.example/result'},{headers:{'Retry-After':'1'}});
  }
  const id=u.pathname.split('/')[4],record=requests.get(id);assert(record,id);const urls=falQueueURLs(record.endpoint,id);assert([urls.statusURL,urls.resultURL].includes(url));
  if(url.endsWith('/status'))return Response.json({status:record.status,...(record.error?{error:record.error}:{})},{headers:{'Retry-After':'1'}});
  if(record.waitResult){record.waitResult=false;return Response.json({status:'IN_PROGRESS'},{status:202,headers:{'Retry-After':'2'}});}
  const kind=AUDIO_MODELS.some(m=>m.endpoint===record.endpoint)?'audio':TOOLS.find(m=>m.endpoint===record.endpoint)?.kind||MODELS.find(m=>Object.values(m.endpoints).includes(record.endpoint))?.mode;
  const media={url:'https://media.example.com/'+id+(kind==='video'?'.mp4':kind==='audio'?'.mp3':'.png')};
  return Response.json(kind==='audio'?{audio:media,duration:60}:kind==='video'?{video:media}:{images:[media]});
 };
 async function launch(){
  const app=await createStudio({dataDir:dir,keyFile,comfyKey,openRouterKey:'',pollMs:1e8,autoArchive:true,fetchImpl});servers.push(app);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+app.server.address().port,bootstrap=await fetch(origin+'/api/bootstrap').then(r=>r.json());
  const api=async(path,body)=>{const res=await fetch(origin+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':bootstrap.csrf},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  const upload=async kind=>{const res=await fetch(origin+'/api/uploads',{method:'POST',headers:{'Content-Type':kind==='image'?'image/png':'video/mp4','X-Studio-Token':bootstrap.csrf,'X-Media-Metadata':JSON.stringify({width:640,height:640,duration:10})},body:kind==='image'?png:mp4});assert.equal(res.status,201);return res.json();};
  return {app,origin,bootstrap,api,upload};
 }
 const waitSubmitted=async count=>{for(let i=0;i<200;i++){if(requests.size===count&&JSON.parse(await readFile(join(dir,'jobs.json'))).every(j=>j.tasks.every(t=>t.status!=='SUBMITTING')))return;await delay(5);}throw Error('Submission did not settle');};
 return {...await launch(),launch,dir,keyFile,calls,requests,waitSubmitted,advance:ms=>clock+=ms,setSecret:value=>secret=value};
}
test('all 20 models use fal for submission, polling, saved media, download and billing',async t=>{
 const f=await fixture(t);assert.equal(f.bootstrap.provider,'fal');assert(f.bootstrap.features.falGeneration);assert.equal(f.bootstrap.features.comfyRouter,false);assert(f.bootstrap.keyConfigured);
 for(const model of MODELS){const c=capabilities(model,'text');const r=await f.api('/api/generate',{...base,model:model.id,ratio:c.ratios[0],resolution:c.resolutions[0],duration:c.durations?.[0]});assert.equal(r.status,202,JSON.stringify(r));assert.equal(r.data.job.provider,'fal');}
 for(const m of AUDIO_MODELS)assert.equal((await f.api('/api/audio/generate',{model:m.id,inputType:'text',prompt:'Gentle piano',lyrics:'[instrumental]',referenceIds:[]})).status,202);
 for(const tool of TOOLS){const source=await f.upload(tool.kind);assert.equal((await f.api('/api/tools/generate',{tool:tool.id,referenceId:source.id})).status,202);}
 await f.waitSubmitted(20);f.advance(2000);await f.app.refresh();
 const {jobs}=(await f.api('/api/jobs')).data;assert.equal(jobs.length,20);
 for(const job of jobs){assert.equal(job.tasks[0].status,'COMPLETED',JSON.stringify(job));const media=job.tasks[0].outputs[0];assert(media.savedLocally);const download=await fetch(f.origin+'/api/download?job='+job.id+'&media='+media.id);assert.equal(download.status,200);assert((await download.arrayBuffer()).byteLength);}
 assert(f.calls.every(c=>!c.url.includes('comfy')));
 await f.api('/api/spending/sync',{period:'day'});const spending=(await f.api('/api/spending')).data;assert.equal(spending.providers.fal.confirmed,1.6);assert.equal(spending.providers.fal.estimated,0);assert.equal(spending.providers.comfy.total,0);
});
test('price previews vary by chosen settings without contacting any provider or requiring a key',async t=>{
 const f=await fixture(t,{falKey:''});const quote=async settings=>(await f.api('/api/estimate',{...base,...settings})).data;
 assert.equal((await quote({})).minimum,.15);assert.equal((await quote({count:3,resolution:'4K'})).minimum,.9);
 for(const id of ['wan3','seedance20','seedance25','minimax-h3','flux3-video']){const model=MODELS.find(m=>m.id===id),resolution=model.resolutions[0];assert((await quote({model:id,resolution,duration:'10'})).minimum>(await quote({model:id,resolution,duration:'5'})).minimum);}
 assert.equal((await quote({model:'missing'})).available,false);assert.equal(f.calls.length,0);
});
test('a Comfy key cannot authorize any new generation, while one session fal key works everywhere',async t=>{
 const f=await fixture(t,{falKey:'',comfyKey:'legacy-comfy-secret'});assert.equal(f.bootstrap.keyConfigured,false);
 assert.equal((await f.api('/api/generate',base)).status,401);assert.equal(f.calls.length,0);
 assert.equal((await f.api('/api/settings',{key:'new-fal-session'})).status,200);f.setSecret('new-fal-session');
 assert.equal((await f.api('/api/generate',base)).status,202);assert.equal((await f.api('/api/audio/generate',{model:'seed-audio',prompt:'Hello',referenceIds:[]})).status,202);
 await f.waitSubmitted(2);const b=(await f.api('/api/bootstrap')).data;assert(b.keyConfigured&&b.falKeyConfigured);
 assert.equal((await f.api('/api/settings',{key:''})).data.keyConfigured,false);assert.equal((await f.api('/api/generate',base)).status,401);
 const files=(await f.api('/api/settings/files')).data.files;assert.deepEqual(files.map(f=>f.id),['fal','openrouter','image-prompts','video-prompts']);assert(!JSON.stringify(files).includes('secret'));
 for(const key of ['FAL_API_KEY_HERE.txt','COMFY_API_KEY_HERE.txt','OPENROUTER_API_KEY_HERE.txt'])assert.equal((await fetch(f.origin+'/CUSTOM/'+key)).status,404);
});
test('fal queue respects Retry-After, delayed results and visible errors without retrying paid submissions',async t=>{
 const f=await fixture(t);await f.api('/api/generate',{...base,count:2});await f.waitSubmitted(2);
 f.requests.get('fal-1').waitResult=true;f.requests.get('fal-2').error='provider failed';
 await f.app.refresh();assert.equal(f.calls.filter(c=>c.method==='GET').length,0);
 f.advance(2000);await f.app.refresh();let jobs=(await f.api('/api/jobs')).data.jobs;assert.equal(jobs[0].tasks[0].status,'IN_QUEUE');assert.equal(jobs[0].tasks[1].status,'FAILED');
 f.advance(3000);await f.app.refresh();jobs=(await f.api('/api/jobs')).data.jobs;assert.equal(jobs[0].tasks[0].status,'COMPLETED');assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
});
test('accepted fal image requests resume after restart with saved IDs and no duplicate submission',async t=>{
 const f=await fixture(t);await f.api('/api/generate',base);await f.waitSubmitted(1);await new Promise(r=>f.app.server.close(r));
 const next=await f.launch();f.advance(2000);await next.app.refresh();const jobs=(await next.api('/api/jobs')).data.jobs;assert.equal(jobs[0].tasks[0].status,'COMPLETED');assert.equal(f.requests.size,1);
 const saved=JSON.parse(await readFile(join(f.dir,'jobs.json')));assert.equal(saved[0].provider,'fal');assert.equal(saved[0].managedBy,'v2');assert.equal(saved[0].costEstimate.amount,.15);
});
test('SHOOT stores and submits the exact refined prompt and ordered replacement images via fal',async t=>{
 const f=await fixture(t),first=await f.upload('image'),second=await f.upload('image');const prompt=JSON.stringify({subject:{type:'The young woman from reference image, medium tan skin'},environment:{setting:'A quiet studio'}});
 const settings={...base,inputType:'image',prompt,referenceIds:[first.id,second.id],count:2,shootBatchId:'12345678-1234-1234-1234-123456789abc'};
 const r=await f.api('/api/generate',settings);assert.equal(r.status,202);await f.waitSubmitted(2);const calls=f.calls.filter(c=>c.method==='POST');assert(calls.every(c=>c.input.prompt===prompt&&c.input.image_urls.length===2&&c.url.endsWith('/edit')));
 const again=await f.api('/api/generate',settings);assert.equal(again.data.job.id,r.data.job.id);assert.equal(f.requests.size,2);
});
