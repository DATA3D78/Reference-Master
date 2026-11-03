import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {TOOLS,toolDefaults,toolOptions,buildToolInput,estimateToolCost} from '../public/tools-models.js';
import {createStudio} from '../server.mjs';
import {video as mp4Fixture} from './fixtures/mp4.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]),mp4=mp4Fixture();
const reference=kind=>({kind,bytes:100,contentType:kind==='image'?'image/png':'video/mp4',metadata:{width:640,height:360,...(kind==='video'?{duration:10,frameCount:300}:{})},data:'data:'+kind+'/mock;base64,AA=='});
test('tool controls map to documented schemas, fixed safety and no invented prompts',()=>{
 assert.deepEqual(TOOLS.map(t=>t.endpoint),['fal-ai/seedvr/upscale/video','fal-ai/seedvr/upscale/image/seamless','fal-ai/depth-anything-video']);
 for(const tool of TOOLS){const r=buildToolInput({tool:tool.id,options:toolDefaults(tool.id)},reference(tool.kind));assert.equal(r.endpoint,tool.endpoint);assert.equal(r.input[tool.kind+'_url'],reference(tool.kind).data);assert(!Object.hasOwn(r.input,'prompt'));}
 const image=buildToolInput({tool:'seedvr-seamless',options:{upscale_mode:'target',target_resolution:'2160p',noise_scale:.123,seed:42,output_format:'webp',enable_safety_checker:false,sync_mode:true}},reference('image')).input;
 assert.equal(image.target_resolution,'2160p');assert.equal(image.upscale_factor,undefined);assert.equal(image.noise_scale,.123);assert.equal(image.seed,42);assert.equal(image.output_format,'webp');assert.equal(image.enable_safety_checker,true);assert.equal(image.sync_mode,false);
 const scaled=buildToolInput({tool:'seedvr-video',options:{upscale_factor:3.5,noise_scale:.123,seed:-42,output_quality:'maximum',output_write_mode:'small',target_fps:60,model:'Proteus',output_format:'GIF (.gif)',sync_mode:true}},reference('video')).input;
 assert.deepEqual(scaled,{video_url:reference('video').data,upscale_mode:'factor',upscale_factor:3.5,noise_scale:.123,seed:-42,output_quality:'maximum',output_write_mode:'small',output_format:'X264 (.mp4)',sync_mode:false});
 const target=buildToolInput({tool:'seedvr-video',options:{upscale_mode:'target',target_resolution:'2160p'}},reference('video')).input;
 assert.equal(target.target_resolution,'2160p');assert.equal(target.upscale_factor,undefined);assert.equal(target.seed,undefined);assert.equal(target.enable_safety_checker,undefined);
 const depth=buildToolInput({tool:'depth-anything',options:{model:'VDA-Small',colormap:'turbo',resolution:'720p',max_frames:480,output_fps:24,side_by_side:true}},reference('video')).input;assert.equal(depth.model,'VDA-Small');assert.equal(depth.max_frames,480);assert.equal(depth.output_fps,24);assert.equal(depth.side_by_side,true);assert.equal(depth.include_raw_depths,false);
});
test('tools reject unsupported settings and incompatible or oversized input before submission',()=>{
 assert.throws(()=>toolOptions('seedvr-video',{noise_scale:.0005}),/increments/);
 assert.throws(()=>toolOptions('seedvr-seamless',{noise_scale:.0005}),/increments/);
 for(const [id,options] of [['seedvr-video',{upscale_factor:11}],['seedvr-video',{upscale_factor:.9}],['seedvr-video',{target_resolution:'4K'}],['seedvr-video',{output_quality:'best'}],['seedvr-video',{output_write_mode:'tiny'}],['seedvr-video',{seed:1.5}],['seedvr-video',{noise_scale:1.1}],['seedvr-seamless',{upscale_factor:11}],['seedvr-seamless',{noise_scale:-1}],['seedvr-seamless',{upscale_mode:'other'}],['depth-anything',{max_frames:2401}],['depth-anything',{output_fps:0}],['depth-anything',{colormap:'blue'}],['depth-anything',{side_by_side:'yes'}]])assert.throws(()=>toolOptions(id,options));
 assert.throws(()=>buildToolInput({tool:'unknown'},reference('image')));
 for(const tool of TOOLS){assert.throws(()=>buildToolInput({tool:tool.id},reference(tool.kind==='image'?'video':'image')));assert.throws(()=>buildToolInput({tool:tool.id},{...reference(tool.kind),bytes:(tool.maxMB+1)*1024**2}));assert.throws(()=>buildToolInput({tool:tool.id},{...reference(tool.kind),metadata:{width:0,height:360,duration:10}}));}
 assert.throws(()=>buildToolInput({tool:'topaz-precision'},reference('video')),/supported tool/);
 assert.doesNotThrow(()=>buildToolInput({tool:'seedvr-video'},{...reference('video'),metadata:{width:640,height:360,duration:301}}));
});
test('tool estimates use SeedVR output pixels and actual frame counts without assuming FPS',()=>{
 assert.equal(estimateToolCost('seedvr-video',{},reference('video').metadata).amount,640*360*4/1e6*300*.001);
 const video={width:1920,height:1080,frameCount:121};
 assert.equal(estimateToolCost('seedvr-video',{upscale_factor:1},video).amount,.2509056);
 assert.equal(estimateToolCost('seedvr-video',{upscale_mode:'target',target_resolution:'2160p'},video).amount,.2509056*4);
 assert.equal(estimateToolCost('seedvr-video',{upscale_mode:'target',target_resolution:'2160p'},{...video,width:1080,height:1920}).amount,.2509056*4);
 for(const frameCount of [undefined,0,-1,NaN,Infinity,1.5])assert.equal(estimateToolCost('seedvr-video',{},{...video,frameCount}).available,false);
 assert.equal(estimateToolCost('depth-anything',{},reference('video').metadata).amount,.4);
 assert.equal(estimateToolCost('seedvr-seamless',{},{width:1000,height:1000}).amount,.01);
 assert.equal(estimateToolCost('seedvr-seamless',{upscale_mode:'target',target_resolution:'2160p'},{width:1920,height:1080}).amount,8.2944*.0025);
 assert.equal(estimateToolCost('seedvr-seamless',{},null).available,false);
});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'fwrd-tools-')),requests=[],servers=[];
 const provider=async(url,options={})=>{
  if(url.startsWith('https://fal.media/'))return new Response(url.endsWith('.png')?png:mp4);
  if(options.method==='POST'){const id='req-'+requests.length;requests.push({url,input:JSON.parse(options.body),headers:options.headers});return Response.json({request_id:id,status_url:'https://queue.fal.run/'+id+'/status',response_url:'https://queue.fal.run/'+id+'/result'});}
  if(url.endsWith('/status'))return Response.json({status:'COMPLETED'});
  const index=Number(url.match(/req-(\d+)/)[1]),isImage=requests[index].url.includes('/upscale/image/');return Response.json(isImage?{image:{url:'https://fal.media/upscaled.png',content_type:'image/png',width:1280,height:720},seed:7}:{video:{url:'https://fal.media/processed.mp4',content_type:'video/mp4'}});
 };
 const launch=async()=>{const studio=await createStudio({dataDir:dir,key:'test-fal-key',openRouterKey:'',fetchImpl:provider,pollMs:3600000});servers.push(studio);await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+studio.server.address().port;
  const get=async path=>(await fetch(url+path)).json(),config=await get('/api/bootstrap');
  const post=(path,body,token=config.csrf)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)});
  const upload=async kind=>(await(await fetch(url+'/api/uploads',{method:'POST',headers:{'Content-Type':kind==='image'?'image/png':'video/mp4','X-Studio-Token':config.csrf,'X-File-Name':'source.'+(kind==='image'?'png':'mp4'),'X-Media-Metadata':JSON.stringify({...reference(kind).metadata,frameCount:999999})},body:kind==='image'?png:mp4})).json());return {...studio,get,post,upload,config,url};};
 t.after(async()=>{for(const s of servers){await s.ready;await new Promise(r=>s.server.close(r));}await rm(dir,{recursive:true,force:true});});return {...await launch(),dir,requests,launch};
}
test('tools submit concurrently, save outputs, support favorites and canvas, retain settings and spending after restart',async t=>{
 const f=await fixture(t);assert.equal(f.config.features.mediaTools,true);assert.equal(f.config.features.seedvrVideo,true);const inputs={image:await f.upload('image'),video:await f.upload('video')};
 const {project}=await(await f.post('/api/projects',{type:'create',name:'Tools project'})).json();
 for(const tool of TOOLS){const response=await f.post('/api/tools/generate',{projectId:project.id,tool:tool.id,options:toolDefaults(tool.id),referenceId:inputs[tool.kind].id,sourceName:'Test source'});assert.equal(response.status,202);const {job}=await response.json();assert.equal(job.settings.tool,tool.id);assert.equal(job.settings.options.model,toolDefaults(tool.id).model);}
 for(let i=0;i<100;i++){const {jobs}=await f.get('/api/jobs?project='+project.id);if(jobs.every(j=>j.tasks[0].status==='IN_QUEUE'))break;await delay(5);}
 assert.equal(f.requests.length,3);assert.deepEqual(f.requests.map(r=>r.url),TOOLS.map(t=>'https://queue.fal.run/'+t.endpoint));assert(f.requests.every(r=>r.headers.Authorization==='Key test-fal-key'));
 await f.refresh();const {jobs}=await f.get('/api/jobs?project='+project.id);assert(jobs.every(j=>j.tasks[0].status==='COMPLETED'&&j.tasks[0].outputs[0].savedLocally));assert.equal((await f.get('/api/jobs')).jobs.length,0);
 const videoJob=jobs.find(j=>j.settings.tool==='seedvr-video');assert.equal(videoJob.settings.sourceMetadata.frameCount,300);assert.equal(videoJob.tasks[0].outputs[0].contentType,'video/mp4');
 const image=jobs.find(j=>j.settings.tool==='seedvr-seamless'),media=image.tasks[0].outputs[0];assert.equal(media.width,1280);
 assert.equal((await f.post('/api/favorites',{jobId:image.id,mediaId:media.id,projectId:project.id,favorite:true})).status,200);
 assert.equal((await f.post('/api/ideation',{projectId:project.id,operations:[{type:'addMedia',jobId:image.id,mediaId:media.id}]})).status,200);
 assert.deepEqual((await f.get('/api/assets')).assets.map(a=>a.contentType).sort(),['image/png','video/mp4']);
 const total=await f.get('/api/spending');assert(total.estimated>0);assert.equal(total.unpriced,0);
 const disk=await readFile(join(f.dir,'jobs.json'),'utf8');assert(!disk.includes('data:'));assert(!disk.includes('test-fal-key'));assert(disk.includes('seedvr-video'));assert.equal(JSON.parse(disk).find(j=>j.settings.tool==='seedvr-video').costEstimate.amount,estimateToolCost('seedvr-video',{},reference('video').metadata).amount);
 const reopened=await f.launch(),saved=(await reopened.get('/api/jobs?project='+project.id)).jobs;assert.equal(saved.length,3);assert(saved.every(j=>j.tasks[0].outputs[0].savedLocally));
 const download=await fetch(reopened.url+'/api/download?job='+image.id+'&media='+media.id);assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'image/png');
 assert.equal((await reopened.post('/api/generations/delete',{jobId:image.id,mediaId:media.id,projectId:project.id})).status,200);assert.equal((await reopened.get('/api/spending')).total,total.total);
});
test('tools API validates credentials, CSRF, project, source and options before any provider call',async t=>{
 const f=await fixture(t),image=await f.upload('image'),video=await f.upload('video'),body={tool:'seedvr-seamless',referenceId:image.id};
 assert.equal((await f.post('/api/tools/generate',body,'wrong')).status,403);
 for(const overrides of [{tool:'invalid'},{tool:'topaz-precision'},{referenceId:'expired'},{options:{upscale_factor:100}},{projectId:'missing'},{referenceId:video.id}])assert.notEqual((await f.post('/api/tools/generate',{...body,...overrides})).status,202);
 assert.equal(f.requests.length,0);await f.post('/api/settings',{key:''});assert.equal((await f.post('/api/tools/generate',body)).status,401);assert.equal(f.requests.length,0);
});
