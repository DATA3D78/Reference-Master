import {runSelectionBatch} from '../public/library.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStudio} from '../server.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const seed=()=>({id:'batch',provider:'comfy',projectId:'default',createdAt:new Date().toISOString(),provider:'comfy',modelName:'Nano Banana Pro',mode:'image',costEstimate:{amount:.15},settings:{model:'nano-pro',inputType:'text',prompt:'A landscape',ratio:'1:1',resolution:'1K',count:2,destination:'ideation'},tasks:[{status:'COMPLETED',requestId:'request-a',outputs:[{id:'image-a',url:'https://fal.media/a.png',contentType:'image/png',favorite:true}]},{status:'COMPLETED',requestId:'request-b',outputs:[{id:'video-b',url:'https://fal.media/b.mp4',contentType:'video/mp4'}]}]});
async function setup(t,job=seed()){
  const dir=await mkdtemp(join(tmpdir(),'fwrd-deletion-')),servers=[];
  await writeFile(join(dir,'jobs.json'),JSON.stringify([job]));
  t.after(async()=>{for(const studio of servers){await studio.ready;await new Promise(r=>studio.server.close(r));}await rm(dir,{recursive:true,force:true});});
  const launch=async()=>{
    const studio=await createStudio({dataDir:dir,key:'',openRouterKey:'',autoArchive:false,pollMs:3600000,fetchImpl:async url=>{assert.equal(url,'https://fal.media/a.png');return new Response(png);}});servers.push(studio);
    await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${studio.server.address().port}`;
    const get=async path=>(await fetch(url+path)).json(),config=await get('/api/bootstrap');
    const post=(path,body={},token=config.csrf)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify({jobId:'batch',mediaId:'image-a',projectId:'default',...body})});
    return {...studio,url,get,post,config};
  };
  return {dir,launch,...await launch()};
}

test('delete one output, preserve billing and asset copies, hide it on canvas, and restore its original position and favorite',async t=>{
  const f=await setup(t);assert.equal(f.config.features.generationDeletion,true);
  const board=(await f.get('/api/ideation')).board,spending=await f.get('/api/spending');
  const savedAsset=await f.post('/api/assets');assert.equal(savedAsset.status,201);const asset=(await savedAsset.json()).asset;
  const response=await f.post('/api/generations/delete');assert.equal(response.status,200);
  const {job}=await response.json();assert.deepEqual(job.tasks.flatMap(t=>t.outputs).map(m=>m.id),['video-b']);
  const after=(await f.get('/api/ideation')).board;assert.equal(after.items.length,1);assert.notEqual(after.visibilityVersion,board.visibilityVersion);
  assert.equal((await f.get('/api/jobs')).jobs.length,1);
  const summary=(await f.get('/api/projects')).projects[0];assert.equal(summary.images,0);assert.equal(summary.videos,1);assert.equal(summary.favorites,0);
  assert.equal((await f.get('/api/spending')).total,spending.total);
  assert.equal((await f.get('/api/assets')).assets[0].id,asset.id);
  assert.equal((await f.post('/api/ideation',{operations:[{type:'addMedia',jobId:'batch',mediaId:'image-a'}]})).status,400);
  assert.equal((await f.post('/api/generations/delete')).status,200);
  const restored=await(await f.post('/api/generations/restore')).json();assert.equal(restored.job.tasks[0].outputs[0].favorite,true);
  assert.deepEqual((await f.get('/api/ideation')).board.items,board.items);
  assert.equal((await f.get('/api/projects')).projects[0].favorites,1);
});

test('deleting every completed result hides the generation and persists across restart; Undo can restore it',async t=>{
  const f=await setup(t);
  await f.post('/api/generations/delete');const last=await(await f.post('/api/generations/delete',{mediaId:'video-b'})).json();assert.equal(last.job,null);
  assert.deepEqual((await f.get('/api/jobs')).jobs,[]);assert.equal((await f.get('/api/projects')).projects[0].generations,0);
  const records=JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'));assert(records[0].tasks.every(t=>t.outputs[0].deletedAt));assert.equal(records[0].tasks[0].requestId,'request-a');
  const reopened=await f.launch();assert.deepEqual((await reopened.get('/api/jobs')).jobs,[]);assert.equal((await reopened.get('/api/ideation')).board.items.length,0);
  await reopened.refresh();assert.equal((await reopened.get('/api/ideation')).board.items.length,0);
  await reopened.post('/api/generations/restore');assert.equal((await reopened.get('/api/jobs')).jobs.length,1);assert.equal((await reopened.get('/api/ideation')).board.items.length,1);
});

test('deletion requires CSRF, a completed output and matching project; pending tasks remain visible',async t=>{
  const job=seed();job.tasks[1]={status:'IN_PROGRESS',requestId:'pending'};const f=await setup(t,job);
  assert.equal((await f.post('/api/generations/delete',{},'bad-token')).status,403);
  const project=await(await f.post('/api/projects',{type:'create',name:'Other'})).json();
  assert.equal((await f.post('/api/generations/delete',{projectId:project.project.id})).status,400);
  assert.equal((await f.post('/api/generations/delete',{mediaId:'missing'})).status,404);
  await f.post('/api/generations/delete');const jobs=await f.get('/api/jobs');assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].tasks[1].status,'IN_PROGRESS');assert.deepEqual(jobs.activeProjectIds,['default']);
});

test('failed persistence leaves the generation visible and allows a retry',async t=>{
  const f=await setup(t);await mkdir(join(f.dir,'jobs.tmp'));
  const failed=await f.post('/api/generations/delete');assert.equal(failed.status,500);assert.match((await failed.json()).error,/Could not save/);
  assert.equal((await f.get('/api/jobs')).jobs[0].tasks[0].outputs.length,1);
  assert.equal(JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'))[0].tasks[0].outputs[0].deletedAt,undefined);
  await rm(join(f.dir,'jobs.tmp'),{recursive:true});assert.equal((await f.post('/api/generations/delete')).status,200);
});

test('failed and uncertain cards delete independently, keep stable indices, persist, and restore without changing billing',async t=>{
  const job=seed();job.tasks=[{status:'FAILED',error:'Content could not be processed.',requestId:'failed-a'},{status:'UNKNOWN',error:'Check your provider receipt.',requestId:'unknown-b'}];
  const f=await setup(t,job);assert.equal(f.config.features.failedGenerationDeletion,true);
  const spending=await f.get('/api/spending');
  const removed=await f.post('/api/generations/delete',{mediaId:undefined,taskIndex:0});assert.equal(removed.status,200);
  assert.deepEqual((await removed.json()).job.tasks.map(t=>[t.taskIndex,t.status]),[[1,'UNKNOWN']]);
  const last=await f.post('/api/generations/delete',{mediaId:undefined,taskIndex:1});assert.equal(last.status,200);assert.equal((await last.json()).job,null);
  assert.deepEqual((await f.get('/api/jobs')).jobs,[]);assert.equal((await f.get('/api/projects')).projects[0].generations,0);
  const records=JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'));assert(records[0].tasks.every(t=>t.deletedAt));assert.equal(records[0].tasks[0].requestId,'failed-a');
  assert.equal((await f.get('/api/spending')).total,spending.total);
  const reopened=await f.launch();assert.deepEqual((await reopened.get('/api/jobs')).jobs,[]);
  const restore=await reopened.post('/api/generations/restore',{mediaId:undefined,taskIndex:0});assert.equal(restore.status,200);
  assert.deepEqual((await restore.json()).job.tasks.map(t=>[t.taskIndex,t.status]),[[0,'FAILED']]);
  await reopened.refresh();assert.equal((await reopened.get('/api/jobs')).jobs[0].tasks[0].status,'FAILED');
});

test('removing a failure preserves successful siblings and rejects active tasks, wrong projects, invalid indices and missing CSRF',async t=>{
  const job=seed();job.tasks.push({status:'FAILED',error:'Provider error'},{status:'IN_PROGRESS',requestId:'active'});
  const f=await setup(t,job),target={mediaId:undefined,taskIndex:2};
  assert.equal((await f.post('/api/generations/delete',target,'bad-token')).status,403);
  const {project}=await(await f.post('/api/projects',{type:'create',name:'Other'})).json();
  assert.equal((await f.post('/api/generations/delete',{...target,projectId:project.id})).status,400);
  for(const taskIndex of [-1,1.5,'2',null])assert.equal((await f.post('/api/generations/delete',{...target,taskIndex})).status,400);
  assert.equal((await f.post('/api/generations/delete',{...target,taskIndex:99})).status,404);
  assert.equal((await f.post('/api/generations/delete',{...target,jobId:'missing'})).status,404);
  assert.equal((await f.post('/api/generations/delete',{...target,mediaId:'image-a'})).status,400);
  for(const taskIndex of [0,3])assert.equal((await f.post('/api/generations/delete',{...target,taskIndex})).status,409);
  const removed=await f.post('/api/generations/delete',target);assert.equal(removed.status,200);
  assert.deepEqual((await removed.json()).job.tasks.map(t=>t.taskIndex),[0,1,3]);
  const {jobs,activeProjectIds}=await f.get('/api/jobs');assert.deepEqual(jobs[0].tasks.flatMap(t=>t.outputs).map(m=>m.id),['image-a','video-b']);assert.deepEqual(activeProjectIds,['default']);
});

test('failed-card deletion rolls back a storage failure and can be retried',async t=>{
  const job=seed();job.tasks=[{status:'FAILED',error:'Provider error'}];const f=await setup(t,job),target={mediaId:undefined,taskIndex:0};
  await mkdir(join(f.dir,'jobs.tmp'));
  assert.equal((await f.post('/api/generations/delete',target)).status,500);
  assert.equal((await f.get('/api/jobs')).jobs[0].tasks[0].status,'FAILED');
  await rm(join(f.dir,'jobs.tmp'),{recursive:true});
  assert.equal((await f.post('/api/generations/delete',target)).status,200);
  assert.deepEqual((await f.get('/api/jobs')).jobs,[]);
});


test('batch deletion continues after a failed item and Undo restores exactly the successful subset',async t=>{
  const f=await setup(t),items=[{mediaId:'image-a'},{mediaId:'missing'},{mediaId:'video-b'}];
  const mutate=operation=>async item=>{const response=await f.post('/api/generations/'+operation,item);const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
  const result=await runSelectionBatch(items,mutate('delete'));
  assert.deepEqual(result.succeeded,[items[0],items[2]]);assert.deepEqual(result.failed.map(entry=>entry.item),[items[1]]);
  assert.deepEqual((await f.get('/api/jobs')).jobs,[]);
  const undo=await runSelectionBatch(result.succeeded,mutate('restore'));assert.equal(undo.failed.length,0);
  const job=(await f.get('/api/jobs')).jobs[0];assert.deepEqual(job.tasks.flatMap(task=>task.outputs.map(media=>media.id)),['image-a','video-b']);assert.equal(job.tasks[0].outputs[0].favorite,true);
});
