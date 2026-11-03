import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AUDIO_MODELS,audioDefaults,audioOptions,buildAudioInput,estimateAudioCost,validateAudioReferences} from '../public/audio-models.js';
import {createStudio,detectMedia} from '../server.mjs';
const wav=Buffer.from('RIFF0000WAVEfmt audio test'),mp3=Buffer.from('ID3 audio test'),png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const ogg=Buffer.concat([Buffer.from('OggS'),Buffer.alloc(24),Buffer.from('OpusHead'),Buffer.alloc(20)]);
const reference=(kind='audio')=>({kind,bytes:100,contentType:kind==='audio'?'audio/wav':'image/png',metadata:kind==='audio'?{duration:12}:{width:640,height:360},data:'data:'+kind+'/mock;base64,AA=='});
test('audio schemas map only documented options, reference modes and lyrics',()=>{
 assert.deepEqual(AUDIO_MODELS.map(m=>m.endpoint),['bytedance/seed-audio-1.0','minimax/music-3']);
 const seed=buildAudioInput({model:'seed-audio',prompt:'Say hello',inputType:'audio',options:{voice:'stokie_en',output_format:'wav',sample_rate:48000,speed:1.2,pitch:-3,multilingual:true,secret:'ignore'}},[reference(),reference()]);
 assert.equal(seed.input.voice,'stokie_en');assert.equal(seed.input.audio_urls.length,2);assert.equal(seed.input.image_url,undefined);assert.equal(seed.input.sample_rate,48000);assert.equal(seed.input.pitch,-3);assert.equal(seed.input.multilingual,true);assert.equal(seed.input.secret,undefined);
 const image=buildAudioInput({model:'seed-audio',prompt:'Describe this sound',inputType:'image'},[reference('image')]);assert.equal(image.input.image_url,reference('image').data);assert.equal(image.input.audio_urls,undefined);
 const music=buildAudioInput({model:'music-3',prompt:'Warm acoustic pop',lyrics:'[verse]\nHello world\n[chorus]\nWelcome home',options:{duration:300,seed:42,num_inference_steps:50,guidance_scale:2}});assert.equal(music.input.duration,300);assert.equal(music.input.seed,42);assert.equal(music.input.num_inference_steps,50);assert.equal(music.input.lyrics.split('\n')[0],'[verse]');assert.equal(music.input.output_format,undefined);
 assert.equal(buildAudioInput({model:'music-3',prompt:'Piano',lyrics:'[instrumental]'}).input.lyrics,'[instrumental]');
});
test('audio validates provider bounds, incompatible references and section tags before charging',()=>{
 for(const [id,options] of [['seed-audio',{pitch:13}],['seed-audio',{speed:.4}],['seed-audio',{volume:3}],['seed-audio',{sample_rate:123}],['seed-audio',{output_format:'pcm'}],['seed-audio',{multilingual:'true'}],['music-3',{duration:301}],['music-3',{num_inference_steps:2.5}],['music-3',{guidance_scale:21}],['music-3',{seed:1.5}]])assert.throws(()=>audioOptions(id,options));
 for(const body of [{model:'unknown',prompt:'Hello'},{model:'seed-audio',prompt:'x'.repeat(2049)},{model:'seed-audio',prompt:'',inputType:'text'},{model:'music-3',prompt:'Song',lyrics:''},{model:'music-3',prompt:'Song',lyrics:'[verse] Words lost by provider'},{model:'seed-audio',prompt:'Hello',inputType:'video'}])assert.throws(()=>buildAudioInput(body));
 assert.throws(()=>buildAudioInput({model:'music-3',prompt:'Song',lyrics:'[instrumental]'},[reference()]));
 assert.throws(()=>buildAudioInput({model:'seed-audio',prompt:'Hello',inputType:'image'},[reference()]));
 assert.throws(()=>buildAudioInput({model:'seed-audio',prompt:'Hello',inputType:'audio'},[]));
 assert.throws(()=>validateAudioReferences('audio',Array(4).fill(reference())));
 for(const ref of [{...reference(),bytes:10*1024**2+1},{...reference(),metadata:{duration:30.1}},{...reference(),metadata:{duration:NaN}},{...reference(),contentType:'audio/flac'}])assert.throws(()=>validateAudioReferences('audio',[ref]));
});
test('audio cost estimates distinguish unknown length from duration limits and completed lengths',()=>{
 assert.equal(estimateAudioCost('seed-audio').available,false);assert.equal(estimateAudioCost('seed-audio',{},60).amount,.1875);
 assert.equal(estimateAudioCost('music-3',{duration:300}).amount,.6);assert.equal(estimateAudioCost('music-3',{duration:300},120).amount,.24);
 assert.equal(detectMedia(ogg,'audio/ogg'),'audio');assert.throws(()=>detectMedia(Buffer.from('OggS not opus'),'audio/ogg'));
});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'fwrd-audio-')),requests=[],servers=[];
 const provider=async(url,options={})=>{
  if(url.startsWith('https://fal.media/'))return new Response(url.endsWith('.wav')?wav:url.endsWith('.ogg')?ogg:mp3);
  if(options.method==='POST'){const id='audio-'+requests.length;requests.push({url,input:JSON.parse(options.body),headers:options.headers});return Response.json({request_id:id,status_url:'https://queue.fal.run/'+id+'/status',response_url:'https://queue.fal.run/'+id+'/result'});}
  if(url.endsWith('/status'))return Response.json({status:'COMPLETED'});
  const request=requests[Number(url.match(/audio-(\d+)/)[1])],music=request.url.endsWith('music-3'),format=music?'wav':request.input.output_format==='ogg_opus'?'ogg':request.input.output_format;
  return Response.json({audio:{url:'https://fal.media/result.'+format,content_type:music?'image/png':undefined,...(!music?{duration:20,sample_rate:24000}:{})},...(music?{duration:40,seed:42}:{})});
 };
 const launch=async()=>{const studio=await createStudio({dataDir:dir,key:'audio-test-key',openRouterKey:'',fetchImpl:provider,pollMs:3600000});servers.push(studio);await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+studio.server.address().port,get=async path=>(await fetch(url+path)).json(),config=await get('/api/bootstrap');
  const post=(path,body,token=config.csrf)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)});
  const upload=async kind=>(await(await fetch(url+'/api/uploads',{method:'POST',headers:{'Content-Type':reference(kind).contentType,'X-Studio-Token':config.csrf,'X-Media-Metadata':JSON.stringify(reference(kind).metadata),'X-File-Name':'Reference'},body:kind==='audio'?wav:png})).json());
  return {...studio,url,get,post,upload,config};};
 t.after(async()=>{for(const studio of servers){await studio.ready;await new Promise(r=>studio.server.close(r));}await rm(dir,{recursive:true,force:true});});return {...await launch(),requests,dir,launch};
}
test('audio queue supports concurrency, local playback and downloads, projects, favorites, reuse and restart',async t=>{
 const f=await fixture(t);assert.equal(f.config.features.audioGeneration,true);const {project}=await(await f.post('/api/projects',{type:'create',name:'Sound project'})).json(),ref=await f.upload('audio');
 for(const model of AUDIO_MODELS){const response=await f.post('/api/audio/generate',{projectId:project.id,model:model.id,prompt:'Test sound',lyrics:'[instrumental]',inputType:model.id==='seed-audio'?'audio':'text',referenceIds:model.id==='seed-audio'?[ref.id]:[],options:audioDefaults(model.id)});assert.equal(response.status,202);}
 for(let i=0;i<100;i++){const {jobs}=await f.get('/api/jobs?project='+project.id);if(jobs.every(j=>j.tasks[0].status==='IN_QUEUE'))break;await delay(5);}
 assert.equal(f.requests.length,2);assert(f.requests.every(r=>r.headers.Authorization==='Key audio-test-key'));assert.equal(f.requests[0].input.audio_urls.length,1);
 await f.refresh();const {jobs}=await f.get('/api/jobs?project='+project.id);assert(jobs.every(j=>j.mode==='audio'&&j.tasks[0].status==='COMPLETED'&&j.tasks[0].outputs[0].savedLocally));assert.equal((await f.get('/api/jobs')).jobs.length,0);
 const music=jobs.find(j=>j.settings.model==='music-3'),media=music.tasks[0].outputs[0];assert.equal(media.contentType,'audio/wav');assert.equal(media.duration,40);assert.equal(music.settings.options.duration,60);assert.equal(music.settings.lyrics,'[instrumental]');
 const range=await fetch(f.url+'/api/media?job='+music.id+'&media='+media.id,{headers:{Range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'RIFF');
 const download=await fetch(f.url+'/api/download?job='+music.id+'&media='+media.id);assert.equal(download.headers.get('Content-Type'),'audio/wav');assert.match(download.headers.get('Content-Disposition'),/\.wav/);
 assert.equal((await f.post('/api/favorites',{jobId:music.id,mediaId:media.id,projectId:project.id,favorite:true})).status,200);
 assert.equal((await f.post('/api/assets',{jobId:music.id,mediaId:media.id})).status,400);assert.equal((await f.post('/api/ideation',{projectId:project.id,operations:[{type:'addMedia',jobId:music.id,mediaId:media.id}]})).status,400);
 const projects=(await f.get('/api/projects')).projects;assert.equal(projects.find(p=>p.id===project.id).audios,2);
 const spending=await f.get('/api/spending');assert(Math.abs(spending.estimated-(.08+.0625))<.000001);assert.equal(spending.unpriced,0);
 const disk=await readFile(join(f.dir,'jobs.json'),'utf8');assert(!disk.includes('data:'));assert(!disk.includes('audio-test-key'));
 const reopened=await f.launch(),saved=(await reopened.get('/api/jobs?project='+project.id)).jobs;assert.equal(saved.length,2);assert(saved.every(j=>j.tasks[0].outputs[0].savedLocally));
 assert.equal((await reopened.post('/api/generations/delete',{jobId:music.id,mediaId:media.id,projectId:project.id})).status,200);assert.equal((await reopened.get('/api/jobs?project='+project.id)).jobs.length,1);assert.equal((await reopened.get('/api/spending')).total,spending.total);assert.equal((await reopened.post('/api/generations/restore',{jobId:music.id,mediaId:media.id,projectId:project.id})).status,200);
});
test('audio API rejects invalid requests before provider calls and archives Opus',async t=>{
 const f=await fixture(t),body={model:'seed-audio',prompt:'Hello',referenceIds:[]};
 assert.equal((await f.post('/api/audio/generate',body,'wrong')).status,403);
 for(const overrides of [{model:'missing'},{prompt:'x'.repeat(2049)},{referenceIds:['expired']},{referenceIds:['same','same']},{projectId:'missing'},{options:{speed:3}},{inputType:'image'}])assert.equal((await f.post('/api/audio/generate',{...body,...overrides})).status,400);
 assert.equal(f.requests.length,0);
 assert.equal((await f.post('/api/audio/generate',{...body,options:{output_format:'ogg_opus'}})).status,202);
 for(let i=0;i<100;i++){if((await f.get('/api/jobs')).jobs[0].tasks[0].status==='IN_QUEUE')break;await delay(5);}await f.refresh();const media=(await f.get('/api/jobs')).jobs[0].tasks[0].outputs[0];assert.equal(media.contentType,'audio/ogg');assert.equal(media.savedLocally,true);
 await f.post('/api/settings',{key:''});assert.equal((await f.post('/api/audio/generate',body)).status,401);assert.equal(f.requests.length,1);
});
