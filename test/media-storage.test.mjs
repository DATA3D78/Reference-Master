import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStudio} from '../server.mjs';
import {mediaFilename} from '../media-store.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const mp4=Buffer.alloc(128);mp4.write('ftyp',4);
const job=()=>({id:'persistent-library',createdAt:'2026-10-02T00:00:00Z',modelName:'Nano Banana Pro',mode:'image',settings:{model:'nano-pro',prompt:'Local storage check',ratio:'1:1',resolution:'1K'},tasks:[{status:'COMPLETED',outputs:[{id:'first-image',url:'https://v3.fal.media/image.png',contentType:'image/png',favorite:true},{id:'first-video',url:'https://v3.fal.media/video.mp4',contentType:'video/mp4'}]}]});
const running=new WeakMap();
async function setup(t,seed=[job()]){running.set(t,[]);const dir=await mkdtemp(join(tmpdir(),'fwrd-media-test-'));await writeFile(join(dir,'jobs.json'),JSON.stringify(seed));t.after(async()=>{for(const studio of running.get(t)){await studio.ready;await new Promise(r=>studio.server.close(r));await studio.save();}await rm(dir,{recursive:true,force:true});});return dir;}
async function launch(t,options){
  const studio=await createStudio({pollMs:3600000,...options});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
  running.get(t).push(studio);
  const url=`http://127.0.0.1:${studio.server.address().port}`;
  const bootstrap=await(await fetch(url+'/api/bootstrap')).json();
  return {...studio,url,bootstrap};
}

test('existing images and videos archive without an API key and remain viewable offline after restart',async t=>{
  const dir=await setup(t);let downloads=0;
  const original=await launch(t,{dataDir:dir,fetchImpl:async(url,opts)=>{downloads++;assert.equal(opts.headers?.Authorization,undefined);return new Response(url.endsWith('.mp4')?mp4:png);}});
  await original.ready;assert.equal(downloads,2);
  const stored=JSON.parse(await readFile(join(dir,'jobs.json'),'utf8'));
  assert(stored[0].tasks[0].outputs.every(m=>m.local?.bytes>0));
  // Simulate losing the final history update and the provider URLs expiring.
  for(const m of stored[0].tasks[0].outputs){delete m.local;m.url='https://v3.fal.media/expired';}
  await writeFile(join(dir,'jobs.json'),JSON.stringify(stored));
  let networkCalls=0;
  const reopened=await launch(t,{dataDir:dir,fetchImpl:async()=>{networkCalls++;throw Error('Network disabled');}});
  await reopened.ready;
  const {jobs}=await(await fetch(reopened.url+'/api/jobs')).json();
  assert.equal(reopened.bootstrap.keyConfigured,false);assert(jobs[0].tasks[0].outputs.every(m=>m.savedLocally));assert.equal(jobs[0].tasks[0].outputs[0].favorite,true);
  for(const [id,bytes]of[['first-image',png],['first-video',mp4]]){
    for(const route of ['media','download']){
      const res=await fetch(reopened.url+`/api/${route}?job=persistent-library&media=${id}`);
      assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);
    }
  }
  const reference=await fetch(reopened.url+'/api/media?job=persistent-library&media=first-image&reference=1');assert.equal(reference.status,200);assert.deepEqual(Buffer.from(await reference.arrayBuffer()),png);
  assert.equal(networkCalls,0);
});

test('interrupted downloads leave no published or partial file; retry preserves the result and favorite',async t=>{
  const seed=job();seed.tasks[0].outputs=seed.tasks[0].outputs.slice(0,1);const dir=await setup(t,[seed]);let interrupted=true;
  const f=await launch(t,{dataDir:dir,fetchImpl:async()=>new Response(png,{headers:{'Content-Length':String(interrupted?png.length+10:png.length)}})});
  await f.ready;
  let {jobs}=await(await fetch(f.url+'/api/jobs')).json(),media=jobs[0].tasks[0].outputs[0];
  assert.equal(media.savedLocally,false);assert.match(media.storageError,/interrupted/);assert.equal(media.favorite,true);assert.equal(jobs[0].tasks[0].status,'COMPLETED');
  assert.deepEqual(await readdir(join(dir,'media')),[]);
  interrupted=false;
  const retry=await fetch(f.url+'/api/archive',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':f.bootstrap.csrf},body:JSON.stringify({jobId:seed.id,mediaId:media.id})});assert.equal(retry.status,200);
  ({jobs}=await(await fetch(f.url+'/api/jobs')).json());assert.equal(jobs[0].tasks[0].outputs[0].savedLocally,true);assert.equal(jobs[0].tasks[0].outputs[0].storageError,undefined);
  assert.deepEqual(await readFile(join(dir,'media',mediaFilename(seed.id,media))),png);
});

test('concurrent previews save a single complete copy and isolate unsafe identifiers from filesystem paths',async t=>{
  const seed=job();seed.id='../../not-a-path';seed.tasks[0].outputs=[{...seed.tasks[0].outputs[0],id:'../../../still-not-a-path'}];const dir=await setup(t,[seed]);let calls=0;
  const f=await launch(t,{dataDir:dir,autoArchive:false,fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return new Response(png);}});
  const path=f.url+`/api/media?job=${encodeURIComponent(seed.id)}&media=${encodeURIComponent(seed.tasks[0].outputs[0].id)}`;
  const results=await Promise.all([fetch(path),fetch(path),fetch(path)]);
  for(const res of results){assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),png);}
  assert.equal(calls,1);const files=await readdir(join(dir,'media'));assert.equal(files.length,1);assert.match(files[0],/^[a-f0-9]{64}\.png$/);
});

test('a missing local file is reported as unsaved if recovery fails, and can be recovered later',async t=>{
  const seed=job();seed.tasks[0].outputs=seed.tasks[0].outputs.slice(0,1);const dir=await setup(t,[seed]);let available=true;
  const f=await launch(t,{dataDir:dir,fetchImpl:async()=>available?new Response(png):new Response('Expired',{status:410})});await f.ready;
  await rm(join(dir,'media',mediaFilename(seed.id,seed.tasks[0].outputs[0])));available=false;
  const res=await fetch(f.url+'/api/media?job=persistent-library&media=first-image');assert.equal(res.status,502);
  const {jobs}=await(await fetch(f.url+'/api/jobs')).json();assert.equal(jobs[0].tasks[0].outputs[0].savedLocally,false);assert.match(jobs[0].tasks[0].outputs[0].storageError,/410/);
  available=true;
  const retry=await fetch(f.url+'/api/archive',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':f.bootstrap.csrf},body:JSON.stringify({jobId:seed.id,mediaId:'first-image'})});assert.equal(retry.status,200);
});

test('online previews stream without archiving; manual keep persists and survives restart',async t=>{
  const seed=job();seed.tasks[0].outputs=seed.tasks[0].outputs.slice(0,1);
  const dir=await setup(t,[seed]);
  const preferences={version:1,automatic:false,directory:join(dir,'media'),directories:[join(dir,'media')]};
  await writeFile(join(dir,'media-preferences.json'),JSON.stringify(preferences));
  let calls=0;
  const f=await launch(t,{dataDir:dir,fetchImpl:async()=>{calls++;return new Response(png,{headers:{'Content-Type':'image/png'}});}});
  await f.ready;assert.equal(calls,0);
  const path='/api/media?job=persistent-library&media=first-image';
  const preview=await fetch(f.url+path);assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),png);
  await f.refresh();assert.equal(calls,1);assert.deepEqual(await readdir(join(dir,'media')),[]);
  const keep=await fetch(f.url+'/api/archive',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':f.bootstrap.csrf},body:JSON.stringify({jobId:seed.id,mediaId:'first-image'})});assert.equal(keep.status,200);
  assert.equal((await readdir(join(dir,'media'))).length,1);
  const reopened=await launch(t,{dataDir:dir,fetchImpl:async()=>{throw Error('Offline');}});await reopened.ready;
  assert.equal(reopened.bootstrap.mediaStorage.automatic,false);
  const offline=await fetch(reopened.url+path);assert.equal(offline.status,200);assert.deepEqual(Buffer.from(await offline.arrayBuffer()),png);
});

test('folder changes preserve old saves and persist new destinations without trusting client paths',async t=>{
  const dir=await setup(t),selected=await mkdtemp(join(tmpdir(),'fwrd-selected-'));
  t.after(()=>rm(selected,{recursive:true,force:true}));
  let choice=selected;
  const f=await launch(t,{dataDir:dir,autoArchive:false,pickMediaFolder:async()=>choice,fetchImpl:async url=>new Response(url.endsWith('.mp4')?mp4:png)});
  const post=(path,body,token=f.bootstrap.csrf)=>fetch(f.url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)});
  assert.equal((await post('/api/archive',{jobId:'persistent-library',mediaId:'first-image'})).status,200);
  assert.equal((await post('/api/settings/media',{automatic:false},'wrong')).status,403);
  assert.equal((await post('/api/settings/media',{automatic:false,directory:'/tmp/untrusted'})).status,400);
  assert.equal((await post('/api/settings/media',{automatic:false})).status,200);
  if(process.platform==='darwin'){
    const picked=await (await post('/api/settings/media/folder',{})).json();assert.equal(picked.directory,join(await realpath(selected),'FWRD.STUDIO Media','default'));
    assert.equal((await post('/api/archive',{jobId:'persistent-library',mediaId:'first-video'})).status,200);
    assert.equal((await readdir(picked.directory)).length,1);assert.equal((await readdir(join(dir,'media'))).length,1);
    choice=null;const cancelled=await(await post('/api/settings/media/folder',{})).json();assert.equal(cancelled.cancelled,true);assert.equal(cancelled.directory,picked.directory);
    const reopened=await launch(t,{dataDir:dir,fetchImpl:async()=>{throw Error('Offline');}});await reopened.ready;
    assert.equal(reopened.bootstrap.mediaStorage.directory,picked.directory);
    for(const id of ['first-image','first-video'])assert.equal((await fetch(reopened.url+'/api/media?job=persistent-library&media='+id)).status,200);
  }
});

test('online video ranges stay remote and expired links do not create saved files',async t=>{
  const dir=await setup(t);
  await writeFile(join(dir,'media-preferences.json'),JSON.stringify({version:1,automatic:false,directory:join(dir,'media'),directories:[join(dir,'media')]}));
  let expired=false;
  const f=await launch(t,{dataDir:dir,fetchImpl:async(url,options)=>{
    if(expired)return new Response('Expired',{status:410});
    assert.equal(options.headers.Range,'bytes=0-7');
    return new Response(mp4.subarray(0,8),{status:206,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 0-7/128','Content-Length':'8'}});
  }});await f.ready;
  const range=await fetch(f.url+'/api/media?job=persistent-library&media=first-video',{headers:{Range:'bytes=0-7'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 0-7/128');assert.deepEqual(Buffer.from(await range.arrayBuffer()),mp4.subarray(0,8));
  expired=true;assert.equal((await fetch(f.url+'/api/media?job=persistent-library&media=first-video')).status,502);
  assert.deepEqual(await readdir(join(dir,'media')),[]);
});

test('project auto-save and folder destinations are independent and migrate old settings',async t=>{
 const first=job(),second=job();first.projectId='default';first.tasks[0].outputs=first.tasks[0].outputs.slice(0,1);second.id='other-job';second.projectId='other';second.tasks[0].outputs=second.tasks[0].outputs.slice(0,1);
 const dir=await setup(t,[first,second]);
 await writeFile(join(dir,'projects.json'),JSON.stringify({version:1,projects:[{id:'default',name:'First'},{id:'other',name:'Other'}]}));
 await writeFile(join(dir,'media-preferences.json'),JSON.stringify({version:1,automatic:false,directory:join(dir,'media'),directories:[join(dir,'media')]}));
 const selected=await mkdtemp(join(tmpdir(),'fwrd-project-folders-'));t.after(()=>rm(selected,{recursive:true,force:true}));
 let downloads=0;
 const f=await launch(t,{dataDir:dir,pickMediaFolder:async()=>selected,fetchImpl:async()=>{downloads++;return new Response(png);}});await f.ready;
 const post=(path,body)=>fetch(f.url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':f.bootstrap.csrf},body:JSON.stringify(body)});
 assert(f.bootstrap.projects.every(p=>p.mediaStorage.automatic===false));assert.equal(downloads,0);
 assert.equal((await post('/api/settings/media',{projectId:'missing',automatic:true})).status,400);
 if(process.platform==='darwin'){
  const folder=await(await post('/api/settings/media/folder',{projectId:'other'})).json();
  await post('/api/settings/media',{projectId:'other',automatic:true});await f.refresh();
  assert.equal(downloads,1);assert.equal((await readdir(folder.directory)).length,1);assert.deepEqual(await readdir(join(dir,'media')),[]);
  assert.equal((await(await fetch(f.url+'/api/settings/media?project=default')).json()).automatic,false);
  await post('/api/archive',{jobId:first.id,mediaId:'first-image'});assert.equal((await readdir(join(dir,'media'))).length,1);
  const staged=await(await post('/api/settings/media/folder',{draft:true})).json();
  const created=await(await post('/api/projects',{type:'create',name:'Third',mediaStorage:{automatic:true,folderToken:staged.folderToken}})).json();
  const config=created.projects.find(p=>p.id===created.project.id).mediaStorage;
  assert.equal(config.automatic,true);assert(config.directory.endsWith(created.project.id));assert.notEqual(config.directory,folder.directory);
  const bad=await post('/api/projects',{type:'create',name:'Invalid',mediaStorage:{folderToken:'fake'}});assert.equal(bad.status,400);
  const reopened=await launch(t,{dataDir:dir,autoArchive:false,fetchImpl:async()=>{throw Error('No network');}});
  assert.equal(reopened.bootstrap.projects.find(p=>p.id==='default').mediaStorage.automatic,false);
  assert.equal(reopened.bootstrap.projects.find(p=>p.id==='other').mediaStorage.automatic,true);
  assert.equal(reopened.bootstrap.projects.find(p=>p.id===created.project.id).mediaStorage.directory,config.directory);
 }
});
