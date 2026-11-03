import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../server.mjs';
import {MODELS,capabilities} from '../public/models.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const mp4=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(32)]);
const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(24)]);
const base={model:'nano-pro',inputType:'text',prompt:'Glass sculpture',ratio:'1:1',resolution:'1K',count:1,duration:'5',referenceIds:[]};
async function waitFor(fn){for(let i=0;i<300;i++){if(await fn())return;await delay(5);}throw Error('Test condition timed out');}
async function fixture(t,{key='test-comfy-secret',initial,estimateError=false,queueEstimate=true,actualCost=true}={}){
 const dir=await mkdtemp(join(tmpdir(),'fwrd-comfy-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 if(initial)await writeFile(join(dir,'jobs.json'),JSON.stringify(initial));
 const requests=new Map(),calls=[],downloads=[],receipts=new Map();let clock=Date.now();t.mock.method(Date,'now',()=>clock);
 const fetchImpl=async(url,opts={})=>{
  const u=new URL(url);
  if(u.hostname==='media.example.com'){assert(!opts.headers?.['X-API-Key']);downloads.push(url);const video=u.pathname.endsWith('.mp4');return new Response(video?mp4:png,{headers:{'content-type':video?'video/mp4':'image/png'}});}
  assert.equal(u.origin,'https://api.comfy.org','V2 must never call fal');assert.equal(opts.headers['X-API-Key'],key);assert.equal(opts.redirect,'error');
  calls.push({url,method:opts.method,input:opts.body?JSON.parse(opts.body):undefined,headers:opts.headers});
  const parts=u.pathname.split('/'),model=parts.slice(3,5).join('/');
  if(parts.at(-1)==='estimate')return estimateError?Response.json({error_type:'not_enabled'},{status:403}):Response.json({source:'exact',currency:'USD',amount:'0.12',pricing_as_of:new Date().toISOString()});
  if(opts.method==='POST'){
   const id='request-'+(requests.size+1);assert.match(opts.headers['Idempotency-Key'],/^[a-f0-9-]{36}$/);
   requests.set(id,{model,input:JSON.parse(opts.body),status:'COMPLETED'});
   // A provider-supplied foreign URL must never receive our credential.
   return Response.json({request_id:id,status:'IN_QUEUE',status_url:'https://evil.example.com/status',response_url:'https://evil.example.com/result',estimate:queueEstimate?{source:'estimated',currency:'USD',min_amount:'0.1',max_amount:'0.2'}:undefined},{status:201,headers:{'Retry-After':'1'}});
  }
  const id=parts[6],record=requests.get(id);assert(record,id);
  if(parts.at(-1)==='status')return Response.json({status:record.status,...(record.error?{error_type:record.error}:{})},{headers:{'Retry-After':record.retry||'1'}});
  if(record.waitResult){record.waitResult=false;return Response.json({status:'IN_PROGRESS'},{status:202,headers:{'Retry-After':'2'}});}
  const image={url:'https://media.example.com/'+id+'.png'},video='https://media.example.com/'+id+'.mp4';let result;
  if(model.startsWith('vertexai/'))result={candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png.toString('base64')}}]}}]};
  else if(model.startsWith('openai/'))result={data:[{b64_json:png.toString('base64')}]};
  else if(model.includes('seedream'))result={data:[image]};
  else if(model.startsWith('krea/'))result={result:{urls:[image.url]}};
  else if(model.startsWith('bfl/'))result={result:{sample:model==='bfl/flux-3-image'?image.url:video,cost:999}};
  else if(model.startsWith('wan/'))result={output:{video_url:video}};
  else if(model.includes('seedance'))result={content:{video_url:video}};
  else if(model.startsWith('minimax/'))result={task:{content:{url:video}}};
  else if(model.startsWith('byteplus/seed-audio'))result={audio:mp3.toString('base64'),duration:2};
  else throw Error(model);
  return Response.json(result,{headers:actualCost?{'X-Comfy-Credits-Used':'42.2'}:{}});
 };
 const keyFile=join(dir,'COMFY_API_KEY_HERE.txt');await writeFile(keyFile,key);
 const app=await createStudio({dataDir:dir,keyFile,openRouterKey:'',pollMs:1e8,autoArchive:true,fetchImpl});
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{app.server.close(resolve);app.server.closeAllConnections();}));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const bootstrap=await(await fetch(origin+'/api/bootstrap')).json();
 async function api(path,body){const response=await fetch(origin+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':bootstrap.csrf},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
 return {dir,app,keyFile,origin,api,bootstrap,calls,requests,downloads,advance:ms=>{clock+=ms;}};
}
test('all 15 supported image/video models submit, poll, save locally and report Comfy USD charges',async t=>{
 const f=await fixture(t);assert.equal(f.bootstrap.features.comfyRouter,true);
 for(const model of MODELS.filter(m=>m.available)){
  const c=capabilities(model,'text'),settings={...base,model:model.id,ratio:c.ratios[0],resolution:c.resolutions[0],duration:c.durations?.[0]};
  const response=await f.api('/api/generate',settings);assert.equal(response.status,202,JSON.stringify(response));
 }
 await waitFor(()=>f.requests.size===15);await delay(10);f.advance(2000);await f.app.refresh();
 const jobs=(await f.api('/api/jobs')).data.jobs;assert.equal(jobs.length,15);
 for(const job of jobs){assert.equal(job.provider,'comfy');assert.equal(job.tasks[0].status,'COMPLETED',JSON.stringify(job.tasks[0]));const media=job.tasks[0].outputs[0];assert(media.savedLocally);const response=await fetch(f.origin+'/api/download?job='+job.id+'&media='+media.id);assert.equal(response.status,200);assert((await response.arrayBuffer()).byteLength>0);}
 const saved=await readFile(join(f.dir,'jobs.json'),'utf8');assert(!saved.includes('test-comfy-secret'));assert(!saved.includes('iVBOR'));assert(!saved.includes('evil.example'));
 const spending=(await f.api('/api/spending')).data;assert.equal(spending.providers.comfy.confirmed,3);assert.equal(spending.providers.fal.confirmed,0);
 await f.api('/api/spending/sync',{period:'day'});assert(!f.calls.some(c=>c.url.includes('fal')));
});
test('live estimates never submit a paid job; unknown price is not zero; settings changes invalidate quotes',async t=>{
 const f=await fixture(t);
 const first=await f.api('/api/estimate',{...base,count:3});assert.equal(first.data.minimum,.36);assert.equal(f.requests.size,0);
 await f.api('/api/estimate',{...base,count:2});assert.equal(f.calls.length,1);
 await f.api('/api/estimate',{...base,resolution:'2K'});assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.generationConfig.imageConfig.imageSize,'2K');
 await f.api('/api/settings',{key:''});const missing=await f.api('/api/estimate',base);assert.equal(missing.data.available,true);assert.equal(missing.data.minimum,.15);assert.equal(missing.data.source,'reference');
});
test('disabled estimates are handled without blocking generation or showing a false free price',async t=>{
 const f=await fixture(t,{estimateError:true});const quote=await f.api('/api/estimate',base);assert.equal(quote.data.available,true);assert.equal(quote.data.minimum,.15);assert.equal(quote.data.source,'reference');assert.match(quote.data.liveReason,/not enabled/);assert.equal(f.requests.size,0);assert.equal((await f.api('/api/generate',base)).status,202);
});
test('Seedance 2.0 and Wan 3.0 quote the selected video settings through Comfy',async t=>{
 const f=await fixture(t);
 for(const [model,duration,resolution] of [['seedance20','15','720p'],['wan3','30','1080p']]){
  const quote=await f.api('/api/estimate',{...base,model,duration,resolution,audio:true,count:2});
  assert.equal(quote.data.minimum,.24);assert.equal(f.requests.size,0);
  const call=f.calls.at(-1),seed=model==='seedance20';
  assert(call.url.endsWith('/'+(seed?'byteplus/dreamina-seedance-2-0-260128':'wan/wan3.0-video')+'/estimate'));
  const input=seed?call.input:call.input.parameters;
  assert.equal(input.duration,Number(duration));assert.equal(input.resolution,seed?resolution:resolution.toUpperCase());
 }
 const removed=await f.api('/api/generate',{...base,model:'seedance25-fast'});
 assert.equal(removed.status,400);assert.equal(f.requests.size,0);
});
test('queue error_type fails visibly; 202 results and Retry-After are respected without resubmitting',async t=>{
 const f=await fixture(t);await f.api('/api/generate',{...base,count:2});await waitFor(()=>f.requests.size===2);await delay(10);
 f.requests.get('request-1').error='content_policy_violation';f.requests.get('request-2').waitResult=true;
 f.advance(2000);await f.app.refresh();let jobs=(await f.api('/api/jobs')).data.jobs;assert.equal(jobs[0].tasks[0].status,'FAILED');assert.match(jobs[0].tasks[0].error,/content policy violation/);assert.notEqual(jobs[0].tasks[1].status,'COMPLETED');
 const calls=f.calls.length;await f.app.refresh();assert.equal(f.calls.length,calls);f.advance(3000);await f.app.refresh();jobs=(await f.api('/api/jobs')).data.jobs;assert.equal(jobs[0].tasks[1].status,'COMPLETED');assert.equal(f.requests.size,2);
});
test('audio uses Comfy, persists inline output and requires a separate fal key for music before provider calls',async t=>{
 const f=await fixture(t);const unavailable=await f.api('/api/audio/generate',{model:'music-3',prompt:'Song',lyrics:'[instrumental]',referenceIds:[]});assert.equal(unavailable.status,401);assert.equal(f.calls.length,0);
 const result=await f.api('/api/audio/generate',{model:'seed-audio',prompt:'Hello there',inputType:'text',referenceIds:[],options:{voice:'voice-id'}});assert.equal(result.status,202);assert.equal(result.data.job.settings.prompt,'Hello there');
 await waitFor(()=>f.requests.size===1);await delay(10);f.advance(2000);await f.app.refresh();const job=(await f.api('/api/jobs')).data.jobs[0];assert.equal(job.tasks[0].status,'COMPLETED');assert.equal(job.tasks[0].outputs[0].contentType,'audio/mpeg');
});
test('copied legacy pending requests never poll fal with the Comfy key; credentials and settings stay private',async t=>{
 const original=[{id:'old',modelName:'Nano Banana Pro',mode:'image',createdAt:new Date().toISOString(),settings:base,tasks:[{status:'IN_QUEUE',requestId:'old-request',statusURL:'https://queue.fal.run/status',outputs:[]}]}];
 const f=await fixture(t,{initial:original});await f.app.refresh();assert.equal(f.calls.length,0);const job=(await f.api('/api/jobs')).data.jobs[0];assert.equal(job.provider,'fal');assert.equal(job.tasks[0].status,'UNKNOWN');
 const files=(await f.api('/api/settings/files')).data.files;assert.equal(files[0].id,'comfy');assert.equal(files[0].filename,'COMFY_API_KEY_HERE.txt');assert(!JSON.stringify(files).includes('test-comfy-secret'));
 const forbidden=await fetch(f.origin+'/CUSTOM/COMFY_API_KEY_HERE.txt');assert.equal(forbidden.status,404);
 const csrf=await fetch(f.origin+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base)});assert.equal(csrf.status,403);
});

test('missing Comfy queue estimates and billing headers retain per-output reference costs',async t=>{
 const f=await fixture(t,{estimateError:true,queueEstimate:false,actualCost:false});
 await f.api('/api/generate',{...base,count:3,resolution:'4K'});
 await waitFor(()=>f.requests.size===3);await delay(10);f.advance(2000);await f.app.refresh();
 const spending=(await f.api('/api/spending')).data;
 assert.equal(spending.providers.comfy.estimated,.9);assert.equal(spending.providers.comfy.confirmed,0);
 assert.equal(spending.providers.comfy.referenceCount,3);assert.equal(spending.providers.comfy.unpriced,0);
 const saved=JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'));
 assert.equal(saved[0].costEstimate.amount,.3);assert.equal(saved[0].costEstimate.source,'reference');
 assert(f.calls.every(call=>!call.url.includes('fal.ai')));
});
test('final Comfy billing replaces reference estimates rather than adding to them',async t=>{
 const f=await fixture(t,{queueEstimate:false});await f.api('/api/generate',{...base,count:2});
 await waitFor(()=>f.requests.size===2);await delay(10);f.advance(2000);await f.app.refresh();
 const spending=(await f.api('/api/spending')).data;
 assert.equal(spending.confirmed,.4);assert.equal(spending.estimated,0);assert.equal(spending.referenceCount,0);
});
test('older image-to-video jobs can use flat reference rates but unknown reference surcharges stay unpriced',async t=>{
 const job=(id,settings)=>({id,provider:'comfy',mode:id==='wan'?'video':'image',modelName:id,createdAt:new Date().toISOString(),settings:{...base,...settings},tasks:[{status:'COMPLETED',outputs:[]}]});
 const f=await fixture(t,{initial:[job('wan',{model:'wan3',inputType:'image',ratio:'16:9',resolution:'480p',duration:'2'}),job('seedream',{model:'seedream5-pro',inputType:'image'})]});
 const spending=(await f.api('/api/spending')).data;
 assert.equal(spending.estimated,.1);assert.equal(spending.referenceCount,1);assert.equal(spending.unpriced,1);
});
