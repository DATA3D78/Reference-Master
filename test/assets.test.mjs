import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAssetStore} from '../asset-store.mjs';
import {createStudio,detectMedia} from '../server.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const movie=Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
const input={data:png,contentType:'image/png',name:'Original.png',metadata:{width:640,height:480},source:{type:'upload',projectId:'default'}};
const unavailable=async()=>{throw Error('No provider/network access in this test');};
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'fwrd-assets-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function store(directory){return createAssetStore({directory,validateMedia:detectMedia});}
async function api(t,{jobs=[],provider=unavailable}={}){
  const dir=await mkdtemp(join(tmpdir(),'fwrd-assets-api-')),servers=[];
  if(jobs.length)await writeFile(join(dir,'jobs.json'),JSON.stringify(jobs));
  t.after(async()=>{for(const s of servers){if(s.server.listening)await new Promise(r=>s.server.close(r));await s.save();}await rm(dir,{recursive:true,force:true});});
  async function start(fetchImpl=provider){
    const studio=await createStudio({dataDir:dir,fetchImpl,key:'',openRouterKey:'',keyFile:null,openRouterKeyFile:null,pollMs:3600000,autoArchive:false});servers.push(studio);
    await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${studio.server.address().port}`,boot=await(await fetch(url+'/api/bootstrap')).json();
    const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.csrf,...headers},body:JSON.stringify(body)});
    const upload=(path='/api/uploads',data=png,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':boot.csrf,'X-File-Name':encodeURIComponent('Reference é.png'),'X-Media-Metadata':JSON.stringify({width:640,height:480}),...headers},body:data});
    return {studio,url,boot,post,upload,list:async query=>(await(await fetch(url+'/api/assets'+(query||''))).json()).assets};
  }
  return {dir,start,...await start()};
}
const job=(kind='image')=>({id:'saved-job',projectId:'default',createdAt:'2026-10-08T12:00:00.000Z',modelName:'Nano Banana Pro',mode:kind,settings:{prompt:'Reference study',model:'nano-pro',inputType:'text',ratio:'4:3',resolution:'1K',count:1},tasks:[{status:'COMPLETED',outputs:[{id:'saved-output',url:'https://fal.media/reference-fixture',contentType:kind==='image'?'image/png':kind==='audio'?'audio/mpeg':'video/mp4',width:640,height:480}]}]});

test('asset originals, names and dimensions survive restart; callers cannot mutate the index',async t=>{
  const directory=await temp(t),s=await store(directory),{asset,existing}=await s.add(input);assert.equal(existing,false);
  assert.deepEqual(await readFile(join(directory,asset.id+'.png')),png);assert.equal((await stat(join(directory,asset.id+'.png'))).mode&0o777,0o600);
  s.list()[0].name='mutated';assert.equal(s.get(asset.id).name,'Original.png');
  await s.rename(asset.id,'Quiet landscape');const reopened=await store(directory);
  assert.equal(reopened.get(asset.id).name,'Quiet landscape');assert.deepEqual(reopened.get(asset.id).originalNames,['Original.png']);assert.equal(reopened.get(asset.id).width,640);
});

test('concurrent duplicates save one original and retain multiple project and generated origins',async t=>{
  const directory=await temp(t),s=await store(directory);
  const added=await Promise.all([s.add(input),s.add({...input,name:'Another name.png',source:{type:'upload',projectId:'project-two'}}),s.add({...input,source:{type:'generated',projectId:'default',jobId:'job',mediaId:'output',modelName:'Test model'}}),s.add(input)]);
  assert.equal(new Set(added.map(r=>r.asset.id)).size,1);assert.equal(added.filter(r=>!r.existing).length,1);
  assert.equal(s.list().length,1);assert.equal(s.list('project-two').length,1);assert.equal(s.list('missing').length,0);assert.equal(s.list()[0].sources.length,3);
  assert.equal((await readdir(directory)).filter(n=>n.endsWith('.png')).length,1);
  await rm(join(directory,added[0].asset.id+'.png'));await s.add(input);assert.deepEqual(await readFile(join(directory,added[0].asset.id+'.png')),png);
});

test('failed metadata writes do not publish an asset and a retry recovers',async t=>{
  const directory=await temp(t),s=await store(directory);await mkdir(join(directory,'index.json'));
  await assert.rejects(s.add(input));assert.equal(s.list().length,0);assert.equal((await readdir(directory)).some(n=>n.includes('.part-')),false);
  await rm(join(directory,'index.json'),{recursive:true});assert.equal((await s.add(input)).existing,false);assert.equal((await store(directory)).list().length,1);
});

test('invalid files, IDs, names and corrupt metadata fail without overwriting saved data',async t=>{
  const directory=await temp(t),s=await store(directory);
  await assert.rejects(s.add({...input,data:Buffer.from('<html>')}));
  await assert.rejects(s.add({...input,contentType:'image/svg+xml'}));
  assert.throws(()=>s.get('../index.json'),e=>e.status===404);
  const {asset}=await s.add({...input,name:'../../My\nimage.png'});assert.equal(asset.name,'Myimage.png');
  await assert.rejects(s.rename(asset.id,''));await assert.rejects(s.rename(asset.id,'a'.repeat(181)));
  const broken=JSON.stringify({version:1,assets:[{...asset,originalNames:null}]});await writeFile(join(directory,'index.json'),broken);await assert.rejects(store(directory),/Cannot read/);assert.equal(await readFile(join(directory,'index.json'),'utf8'),broken);
});

test('image uploads auto-save, survive removing references and restart, and download without a key',async t=>{
  const f=await api(t);assert.equal(f.boot.features.assetLibrary,true);assert.equal(f.boot.keyConfigured,false);
  const response=await f.upload();assert.equal(response.status,201);const uploaded=await response.json();assert.ok(uploaded.assetId);assert.equal(uploaded.kind,'image');
  assert.equal((await f.list())[0].name,'Reference é.png');
  const removed=await fetch(f.url+'/api/uploads/'+uploaded.id,{method:'DELETE',headers:{'X-Studio-Token':f.boot.csrf}});assert.equal(removed.status,200);
  assert.equal((await f.list()).length,1);await new Promise(r=>f.studio.server.close(r));const next=await f.start(unavailable);
  assert.equal((await next.list())[0].id,uploaded.assetId);
  assert.equal((await next.post('/api/assets/rename',{id:uploaded.assetId,name:'Saved direction'})).status,200);
  const download=await fetch(next.url+'/api/assets/media?id='+uploaded.assetId+'&download=1');assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'image/png');assert.match(download.headers.get('Content-Disposition'),/attachment.*Saved%20direction.png/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
});

test('direct imports and composer/LLM inputs share one library with correct project associations; video frames are excluded',async t=>{
  const f=await api(t);const projectReply=await f.post('/api/projects',{type:'create',name:'Moodboard'});assert.equal(projectReply.status,200);const {project}=await projectReply.json();
  assert.equal((await f.upload('/api/assets/import')).status,201);
  assert.equal((await f.upload('/api/uploads',png,{'X-Project-Id':project.id})).status,201);
  assert.equal((await f.list()).length,1);assert.equal((await f.list('?project='+project.id))[0].sources.length,2);
  const frame=await f.upload('/api/uploads',Buffer.concat([png,Buffer.from([4])]),{'X-Upload-Purpose':'video-frame'});assert.equal(frame.status,201);assert.equal((await frame.json()).assetId,undefined);
  const staged=await f.upload('/api/uploads',movie,{'Content-Type':'video/mp4'});assert.equal(staged.status,201);assert.ok((await staged.json()).assetId);
  assert.equal((await f.upload('/api/assets/import',movie,{'Content-Type':'video/mp4'})).status,201);assert.equal((await f.list()).length,2);
  assert.equal((await f.upload('/api/uploads',png,{'X-Project-Id':'missing'})).status,400);assert.equal((await fetch(f.url+'/api/assets?project=missing')).status,400);
});

test('generated images are copied locally once, reuse existing uploads and remain available with provider disabled',async t=>{
  let calls=0;const f=await api(t,{jobs:[job()],provider:async(url,options)=>{assert.equal(url,'https://fal.media/reference-fixture');assert.equal(options?.headers?.Authorization,undefined);calls++;return new Response(png,{headers:{'Content-Type':'image/png'}});}});
  await f.upload();const saved=await f.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output',name:'Generated study'});assert.equal(saved.status,201);const body=await saved.json();assert.equal(body.existing,true);assert.equal(calls,1);
  assert.equal((await f.list())[0].sources.some(s=>s.type==='generated'&&s.jobId==='saved-job'),true);
  const again=await f.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output'});assert.equal(again.status,201);assert.equal(calls,1);assert.equal((await f.list()).length,1);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start(unavailable);assert.equal((await next.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output'})).status,201);
  const image=await fetch(next.url+'/api/assets/media?id='+body.asset.id);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
});

test('library mutations require a local token/origin; files cannot be read through arbitrary paths and audio is excluded',async t=>{
  const f=await api(t,{jobs:[job('audio')]});
  assert.equal((await f.upload('/api/assets/import',png,{'X-Studio-Token':''})).status,403);
  assert.equal((await f.upload('/api/assets/import',png,{Origin:'https://example.com'})).status,403);
  assert.equal((await f.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output'})).status,400);
  assert.equal((await f.post('/api/assets',{url:'file:///etc/passwd'})).status,404);
  assert.equal((await fetch(f.url+'/api/assets/media?id=..%2Findex.json')).status,404);
  assert.equal((await fetch(f.url+'/.local/assets/index.json')).status,404);
  const {asset}=await(await f.upload('/api/assets/import')).json();await rm(join(f.dir,'assets',asset.id+'.png'));
  assert.equal((await fetch(f.url+'/api/assets/media?id='+asset.id)).status,404);
});


test('video originals auto-save, deduplicate, survive restart and support playback ranges and downloads',async t=>{
  const f=await api(t);assert.equal(f.boot.features.videoAssets,true);
  const headers={'Content-Type':'video/mp4','X-File-Name':encodeURIComponent('Walking.mp4'),'X-Media-Metadata':JSON.stringify({width:1280,height:720,duration:12.5})};
  const first=await f.upload('/api/uploads',movie,headers);assert.equal(first.status,201);const uploaded=await first.json();
  const again=await f.upload('/api/assets/import',movie,headers);assert.equal(again.status,201);assert.equal((await again.json()).existing,true);
  assert.equal((await f.list()).length,1);assert.equal((await f.list())[0].duration,12.5);
  assert.equal((await fetch(f.url+'/api/uploads/'+uploaded.id,{method:'DELETE',headers:{'X-Studio-Token':f.boot.csrf}})).status,200);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start();
  const asset=(await next.list())[0];assert.equal(asset.id,uploaded.assetId);assert.equal(asset.contentType,'video/mp4');assert.equal(asset.duration,12.5);
  assert.deepEqual(await readFile(join(f.dir,'assets',asset.id+'.mp4')),movie);
  const url=next.url+'/api/assets/media?id='+asset.id;
  const full=await fetch(url);assert.equal(full.status,200);assert.equal(full.headers.get('Accept-Ranges'),'bytes');assert.deepEqual(Buffer.from(await full.arrayBuffer()),movie);
  for(const [header,start,end] of [['bytes=4-7',4,7],['bytes=8-',8,movie.length-1],['bytes=-4',movie.length-4,movie.length-1]]){
    const partial=await fetch(url,{headers:{Range:header}});assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Type'),'video/mp4');assert.equal(partial.headers.get('Content-Range'),`bytes ${start}-${end}/${movie.length}`);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),movie.subarray(start,end+1));
  }
  const invalid=await fetch(url,{headers:{Range:'bytes=500-'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('Content-Range'),`bytes */${movie.length}`);
  const download=await fetch(url+'&download=1');assert.match(download.headers.get('Content-Disposition'),/attachment.*Walking.mp4/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),movie);
  assert.equal((await next.upload('/api/assets/import',png,headers)).status,400);
});

test('generated videos can be saved to Assets once and reused after restart without the provider',async t=>{
  let calls=0;const f=await api(t,{jobs:[job('video')],provider:async()=>{calls++;return new Response(movie,{headers:{'Content-Type':'video/mp4'}});}});
  const first=await f.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output',name:'Motion study'});assert.equal(first.status,201);const {asset}=await first.json();
  assert.equal(asset.contentType,'video/mp4');assert.equal(asset.sources[0].type,'generated');assert.equal(calls,1);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start(unavailable);
  const again=await next.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output'});assert.equal(again.status,201);assert.equal((await again.json()).existing,true);assert.equal(calls,1);
  const result=await fetch(next.url+'/api/assets/media?id='+asset.id);assert.deepEqual(Buffer.from(await result.arrayBuffer()),movie);
});

test('MOV assets retain their format and reject disguised video data or audio imports',async t=>{
  const f=await api(t),mov=Buffer.concat([movie,Buffer.from('mov-fixture')]);
  const response=await f.upload('/api/assets/import',mov,{'Content-Type':'video/quicktime','X-File-Name':'Clip.mov'});assert.equal(response.status,201);const {asset}=await response.json();
  assert.equal(asset.contentType,'video/quicktime');assert.deepEqual(await readFile(join(f.dir,'assets',asset.id+'.mov')),mov);
  assert.equal((await f.upload('/api/assets/import',png,{'Content-Type':'video/quicktime'})).status,400);
  assert.equal((await f.upload('/api/assets/import',Buffer.from('ID3audio'),{'Content-Type':'audio/mpeg'})).status,400);
  assert.equal((await f.list()).length,1);
});


test('asset removal and restore survive restarts and keep shared origins and original bytes',async t=>{
  const directory=await temp(t),s=await store(directory),{asset}=await s.add(input);
  await s.add({...input,source:{type:'generated',projectId:'second',jobId:'job',mediaId:'media'}});
  const first=await s.remove(asset.id);assert.ok(first.deletedAt);
  assert.equal((await s.remove(asset.id)).deletedAt,first.deletedAt);
  assert.equal(s.list().length,0);assert.equal(s.list('second').length,0);
  const reopened=await store(directory);
  assert.equal(reopened.list(null,{deleted:true})[0].id,asset.id);
  assert.equal(reopened.list('second',{deleted:true}).length,1);
  assert.deepEqual(await readFile((await reopened.inspect(asset.id)).path),png);
  await reopened.restore(asset.id);
  const restored=await store(directory);assert.equal(restored.list().length,1);assert.equal(restored.list('second').length,1);
  assert.equal(restored.list()[0].sources.length,2);assert.equal(restored.list(null,{deleted:true}).length,0);
  await restored.remove(asset.id);const readded=await restored.add(input);assert.equal(readded.existing,false);assert.equal(readded.asset.deletedAt,undefined);
  assert.equal(restored.list().length,1);assert.equal(restored.list()[0].id,asset.id);
  const {asset:video}=await restored.add({...input,data:movie,contentType:'video/mp4'});
  await restored.remove(video.id);assert.equal(restored.list().length,1);await restored.restore(video.id);assert.equal(restored.list().length,2);
  await assert.rejects(restored.remove('../index.json'),e=>e.status===404);
  await assert.rejects(restored.restore('a'.repeat(64)),e=>e.status===404);
});

test('failed removal writes preserve the visible library and original file',async t=>{
  const directory=await temp(t),s=await store(directory),{asset}=await s.add(input);
  await rm(join(directory,'index.json'));await mkdir(join(directory,'index.json'));
  await assert.rejects(s.remove(asset.id));assert.equal(s.list().length,1);assert.equal(s.list(null,{deleted:true}).length,0);
  assert.deepEqual(await readFile((await s.inspect(asset.id)).path),png);
  await rm(join(directory,'index.json'),{recursive:true});await s.remove(asset.id);assert.equal((await store(directory)).list().length,0);
});

test('asset removal API is protected, preserves generations, filters Trash by project and restores without a provider',async t=>{
  const f=await api(t,{jobs:[job()]});assert.equal(f.boot.features.assetRemoval,true);
  const {project}=await(await f.post('/api/projects',{type:'create',name:'Second project'})).json();
  const uploaded=await(await f.upload('/api/uploads')).json();await f.upload('/api/assets/import',png,{'X-Project-Id':project.id});
  const before=await readFile(join(f.dir,'jobs.json'),'utf8');
  assert.equal((await f.post('/api/assets/remove',{id:uploaded.assetId},{'X-Studio-Token':''})).status,403);
  assert.equal((await f.post('/api/assets/remove',{id:uploaded.assetId},{Origin:'https://example.com'})).status,403);
  assert.equal((await f.post('/api/assets/remove',{id:'../../jobs.json'})).status,404);
  assert.equal((await f.post('/api/assets/remove',{id:uploaded.assetId})).status,200);
  assert.equal((await f.list()).length,0);assert.equal((await f.list('?project='+project.id)).length,0);
  assert.equal((await f.list('?deleted=1&project='+project.id))[0].id,uploaded.assetId);
  assert.equal(await readFile(join(f.dir,'jobs.json'),'utf8'),before);
  assert.equal((await fetch(f.url+'/api/assets/media?id='+uploaded.assetId)).status,200);
  await f.post('/api/projects',{type:'delete',id:project.id});assert.equal((await f.list('?deleted=1&project='+project.id)).length,1);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start();assert.equal((await next.list()).length,0);
  assert.equal((await next.post('/api/assets/restore',{id:uploaded.assetId},{'X-Studio-Token':''})).status,403);
  assert.equal((await next.post('/api/assets/restore',{id:uploaded.assetId})).status,200);
  assert.equal((await next.list()).length,1);assert.equal((await next.list('?deleted=1')).length,0);
});

test('uploaded image and video assets can be placed on project canvases and survive Trash, undo and restart',async t=>{
  const f=await api(t);assert.equal(f.boot.features.canvasAssets,true);
  const {asset:image}=await(await f.upload('/api/assets/import')).json();
  const {asset:video}=await(await f.upload('/api/assets/import',movie,{'Content-Type':'video/mp4','X-Media-Metadata':JSON.stringify({width:1920,height:1080,duration:3})})).json();
  const {project}=await(await f.post('/api/projects',{type:'create',name:'Canvas studies'})).json();
  const inserted=await f.post('/api/ideation',{projectId:project.id,operations:[{type:'addAsset',assetId:image.id},{type:'addAsset',assetId:video.id}]});assert.equal(inserted.status,200);
  const {board}=await inserted.json();assert.equal(board.items.length,2);assert.equal(board.items[0].asset.name,image.name);assert.equal(board.items[1].height,168.75);
  assert.equal((await(await fetch(f.url+'/api/ideation?project=default')).json()).board.items.length,0);
  await f.post('/api/assets/remove',{id:image.id});assert.equal((await f.list()).length,1);
  const visible=(await(await fetch(f.url+'/api/ideation?project='+project.id)).json()).board;assert.equal(visible.items[0].asset.id,image.id);
  assert.equal((await fetch(f.url+'/api/assets/media?id='+image.id)).status,200);
  await f.post('/api/ideation',{projectId:project.id,operations:[{type:'remove',ids:[board.items[0].id]}]});
  assert.equal((await f.post('/api/ideation',{projectId:project.id,operations:[{type:'restore',items:[board.items[0]]}]})).status,200);
  const disk=JSON.parse(await readFile(join(f.dir,'projects',project.id,'ideation.json'),'utf8'));assert.equal(disk.items.some(i=>i.asset),false);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start();
  const saved=(await(await fetch(next.url+'/api/ideation?project='+project.id)).json()).board;
  assert.equal(saved.items.length,2);assert.equal(saved.items.find(i=>i.assetId===image.id).asset.name,image.name);
  assert.equal((await next.post('/api/ideation',{projectId:'default',operations:[{type:'addAsset',assetId:image.id}]})).status,400);
  assert.equal((await next.post('/api/ideation',{projectId:project.id,operations:[{type:'addAsset',assetId:'missing'}]})).status,404);
});

test('local editor WebM exports persist and download as video without provider access',async t=>{
 const f=await api(t);assert.equal(f.boot.features.localEditing,true);
 const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('\x42\x82\x84webm\x18\x53\x80\x67')]);
 assert.equal(detectMedia(webm,'video/webm'),'video');assert.throws(()=>detectMedia(Buffer.from('not a webm'),'video/webm'));
 const result=await f.upload('/api/assets/import',webm,{'Content-Type':'video/webm','X-File-Name':'Edited.webm','X-Media-Metadata':JSON.stringify({width:640,height:360,duration:2})});assert.equal(result.status,201);
 const {asset}=await result.json();assert.equal(asset.contentType,'video/webm');assert.equal(asset.duration,2);
 const media=await fetch(f.url+'/api/assets/media?id='+asset.id+'&download=1');assert.equal(media.headers.get('content-type'),'video/webm');assert.match(media.headers.get('content-disposition'),/\.webm/);assert.deepEqual(Buffer.from(await media.arrayBuffer()),webm);
 for(const file of ['editing.js','editing-models.js','editing-renderer.js','editing.css'])assert.equal((await fetch(f.url+'/'+file)).status,200);
});

test('editor downloads use expiring local attachments with project names and do not add library entries',async t=>{
 const f=await api(t);const projectReply=await f.post('/api/projects',{type:'create',name:'Color studies'}),{project}=await projectReply.json();
 const result=await f.upload('/api/editing/exports',png,{'X-Project-Id':project.id,'X-File-Name':encodeURIComponent('Study-graded.png')});assert.equal(result.status,201);const ticket=await result.json();assert.equal(ticket.name,'Color studies-Study-graded.png');
 assert.equal((await f.list()).length,0);assert.match(ticket.url,/^\/api\/editing\/exports\/[a-f0-9]{48}$/);
 const file=await fetch(f.url+ticket.url);assert.equal(file.status,200);assert.equal(file.headers.get('Content-Type'),'image/png');assert.match(file.headers.get('Content-Disposition'),/attachment.*Color%20studies-Study-graded.png/);assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);
 assert.equal((await f.upload('/api/editing/exports',png,{'X-Project-Id':project.id,'X-Studio-Token':''})).status,403);
 assert.equal((await f.upload('/api/editing/exports',png,{'X-Project-Id':project.id,Origin:'https://example.com'})).status,403);
 assert.equal((await f.upload('/api/editing/exports',Buffer.from('<script>bad</script>'),{'X-Project-Id':project.id})).status,400);
 assert.equal((await f.upload('/api/editing/exports',png,{'X-Project-Id':'missing'})).status,400);
 assert.equal((await fetch(f.url+'/api/editing/exports/'+'0'.repeat(48))).status,404);
});

test('feed asset saved state survives reload and tracks Trash and restore for images and videos',async t=>{
 for(const kind of ['image','video']){
  const f=await api(t,{jobs:[job(kind)],provider:async()=>new Response(kind==='video'?movie:png,{headers:{'Content-Type':kind==='video'?'video/mp4':'image/png'}})});
  const output=async()=>((await(await fetch(f.url+'/api/jobs?project=default')).json()).jobs[0].tasks[0].outputs[0]);
  assert.equal((await output()).savedToAssets,false);
  const {asset}=await(await f.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output'})).json();
  assert.equal((await output()).savedToAssets,true);assert.equal((await output()).assetId,asset.id);
  await f.post('/api/favorites',{jobId:'saved-job',mediaId:'saved-output',favorite:true});
  assert.equal((await output()).favorite,true);assert.equal((await output()).savedToAssets,true);
  await f.post('/api/assets/remove',{id:asset.id});assert.equal((await output()).savedToAssets,false);assert.equal((await output()).favorite,true);
  await f.post('/api/assets/restore',{id:asset.id});assert.equal((await output()).savedToAssets,true);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start();
  const refreshed=(await(await fetch(next.url+'/api/jobs?project=default')).json()).jobs[0].tasks[0].outputs[0];assert.equal(refreshed.savedToAssets,true);assert.equal(refreshed.favorite,true);
 }
});

test('result names persist, transfer on save and update existing linked assets',async t=>{
 for(const kind of ['image','video']){
 const f=await api(t,{jobs:[job(kind)],provider:async()=>new Response(kind==='video'?movie:png,{headers:{'Content-Type':kind==='video'?'video/mp4':'image/png'}})});
 const target={jobId:'saved-job',mediaId:'saved-output'};
 for(const name of ['', ' '.repeat(3),'x'.repeat(181)])assert.equal((await f.post('/api/media/rename',{...target,name})).status,400);
 assert.equal((await f.post('/api/media/rename',{...target,mediaId:'missing',name:'Test'})).status,404);
 assert.equal((await f.post('/api/media/rename',{...target,name:'Marlene · Party'})).status,200);
 const {asset}=await(await f.post('/api/assets',{...target,name:'Old generated title'})).json();assert.equal(asset.name,'Marlene · Party');
 await f.post('/api/media/rename',{...target,name:'Marlene · Wet hair'});assert.equal((await f.list())[0].name,'Marlene · Wet hair');
 await f.post('/api/assets/remove',{id:asset.id});await f.post('/api/media/rename',{...target,name:'Marlene · Final'});await f.post('/api/assets/restore',{id:asset.id});assert.equal((await f.list())[0].name,'Marlene · Final');
 await new Promise(r=>f.studio.server.close(r));const next=await f.start(unavailable);
 const output=(await(await fetch(next.url+'/api/jobs?project=default')).json()).jobs[0].tasks[0].outputs[0];assert.equal(output.name,'Marlene · Final');assert.equal((await next.list())[0].name,output.name);
 }
});

test('result style tags transfer to assets, support removal and survive restart',async t=>{
 const f=await api(t,{jobs:[job()],provider:async()=>new Response(png,{headers:{'Content-Type':'image/png'}})}),target={jobId:'saved-job',mediaId:'saved-output'};
 assert.equal((await f.post('/api/media/tags',{...target,tags:['invalid']})).status,400);
 assert.equal((await f.post('/api/media/tags',{...target,tags:'casual'})).status,400);
 await f.post('/api/media/tags',{...target,tags:['casual','chic','casual']});
 const {asset}=await(await f.post('/api/assets',target)).json();assert.deepEqual(asset.tags,['casual','chic']);
 const {filterAssets}=await import('../public/assets.js');assert.equal(filterAssets(await f.list(),{query:'chic'}).length,1);
 await f.post('/api/media/tags',{...target,tags:[]});assert.deepEqual((await f.list())[0].tags,[]);
 await f.post('/api/media/tags',{...target,tags:['fitness']});
 await new Promise(r=>f.studio.server.close(r));const next=await f.start(unavailable);
 const output=(await(await fetch(next.url+'/api/jobs?project=default')).json()).jobs[0].tasks[0].outputs[0];assert.deepEqual(output.tags,['fitness']);assert.deepEqual((await next.list())[0].tags,['fitness']);
});

test('creator saves retain separate Character category and explicit audience after restart',async t=>{
 for(const [gender,audience] of [['Female','women'],['Male','men']]){
  const j=job('image');j.settings={...j.settings,workflow:'creator',creator:{name:'Alex',gender}};
  const f=await api(t,{jobs:[j],provider:async()=>new Response(png,{headers:{'Content-Type':'image/png'}})});
  const response=await f.post('/api/assets',{jobId:'saved-job',mediaId:'saved-output',name:'Alex'});
  assert.equal(response.status,201);const {asset}=await response.json();
  assert.equal(asset.sources[0].category,'character');assert.equal(asset.sources[0].characterAudience,audience);
  const listed=(await f.list())[0];assert.equal(listed.category,'character');assert.equal(listed.characterAudience,audience);
  await new Promise(r=>f.studio.server.close(r));const next=await f.start(unavailable);
  assert.equal((await next.list())[0].category,'character');assert.equal((await next.list())[0].characterAudience,audience);
 }
});
