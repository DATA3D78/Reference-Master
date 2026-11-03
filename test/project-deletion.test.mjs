import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../server.mjs';
import {createProjectStore} from '../project-store.mjs';
const settings={model:'nano-pro',inputType:'text',prompt:'A landscape',ratio:'1:1',resolution:'1K',count:1,referenceIds:[],destination:'ideation'};
const seed=()=>({id:'old-job',projectId:'default',mode:'image',provider:'comfy',modelName:'Nano Banana Pro',createdAt:new Date().toISOString(),settings,costEstimate:{amount:.15},tasks:[{status:'COMPLETED',requestId:'old-request',outputs:[{id:'old-media',url:'https://fal.media/old.png',contentType:'image/png',favorite:true}]}]});
async function fixture(t,{job=seed(),fetchImpl=async()=>{throw Error('No external calls allowed');}}={}){
  const dir=await mkdtemp(join(tmpdir(),'project-deletion-')),servers=[];
  await writeFile(join(dir,'jobs.json'),JSON.stringify([job]));
  await writeFile(join(dir,'llm-jobs.json'),JSON.stringify([{id:'old-llm',projectId:'default',createdAt:new Date().toISOString(),status:'COMPLETED',settings:{task:'image'},output:'Saved description',usage:{cost:.02}}]));
  t.after(async()=>{for(const studio of servers)if(studio.server.listening)await new Promise(r=>studio.server.close(r));await rm(dir,{recursive:true,force:true});});
  const launch=async()=>{
    const studio=await createStudio({dataDir:dir,key:'',openRouterKey:'test-key',autoArchive:false,pollMs:3600000,fetchImpl});servers.push(studio);await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
    const url='http://127.0.0.1:'+studio.server.address().port,get=async path=>(await fetch(url+path)).json(),config=await get('/api/bootstrap');
    const post=(path,body,token=config.csrf)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)});
    return {...studio,url,get,post,config};
  };return {dir,launch,...await launch()};
}

test('deleting the last/default project creates a usable replacement and restores all saved data after restart',async t=>{
  const f=await fixture(t),board=(await f.get('/api/ideation')).board,spending=await f.get('/api/spending');
  const deleted=await f.post('/api/projects',{type:'delete',id:'default'});assert.equal(deleted.status,200);const response=await deleted.json();
  assert.equal(response.projects.length,1);assert.notEqual(response.projects[0].id,'default');assert.equal(response.deletedProjects[0].id,'default');
  assert.deepEqual((await f.get('/api/jobs')).jobs,[]);assert.deepEqual((await f.get('/api/llm/jobs')).jobs,[]);
  for(const path of ['/api/jobs?project=default','/api/llm/jobs?project=default','/api/ideation?project=default'])assert.equal((await fetch(f.url+path)).status,400);
  const reopened=await f.launch();assert.equal(reopened.config.features.projectDeletion,true);assert.equal(reopened.config.projects[0].id,response.projects[0].id);assert.equal(reopened.config.deletedProjects[0].id,'default');
  assert.equal((await reopened.get('/api/spending')).total,spending.total);
  const restore=await reopened.post('/api/projects',{type:'restore',id:'default'});assert.equal(restore.status,200);assert.equal((await restore.json()).deletedProjects.length,0);
  assert.equal((await reopened.get('/api/jobs?project=default')).jobs[0].tasks[0].outputs[0].favorite,true);
  assert.equal((await reopened.get('/api/llm/jobs?project=default')).jobs[0].output,'Saved description');
  assert.deepEqual((await reopened.get('/api/ideation?project=default')).board,board);
  assert.equal(JSON.parse(await readFile(join(f.dir,'jobs.json'),'utf8'))[0].tasks[0].requestId,'old-request');
});

test('deletion is project-scoped, requires CSRF, and disallows renaming a deleted project',async t=>{
  const f=await fixture(t),other=(await(await f.post('/api/projects',{type:'create',name:'Other project'})).json()).project;
  assert.equal((await f.post('/api/projects',{type:'delete',id:other.id},'wrong')).status,403);
  assert.equal((await f.post('/api/projects',{type:'delete',id:'missing'})).status,400);
  assert.equal((await f.post('/api/projects',{type:'delete'})).status,400);
  await f.post('/api/projects',{type:'delete',id:other.id});assert.equal((await f.get('/api/projects')).projects[0].id,'default');assert.equal((await f.get('/api/jobs')).jobs.length,1);
  assert.equal((await f.post('/api/projects',{type:'rename',id:other.id,name:'Hidden'})).status,400);
  await f.post('/api/projects',{type:'restore',id:other.id});assert.equal((await f.get('/api/projects')).projects.length,2);
});

test('a project with an active fal generation cannot be deleted; other projects still can',async t=>{
  const job=seed();job.tasks=[{status:'IN_PROGRESS',requestId:'running'}];const f=await fixture(t,{job});
  const blocked=await f.post('/api/projects',{type:'delete',id:'default'});assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/running/);
  const other=(await(await f.post('/api/projects',{type:'create',name:'Other'})).json()).project;
  assert.equal((await f.post('/api/projects',{type:'delete',id:other.id})).status,200);
});

test('active LLM analysis and prompt enhancement block project deletion until finished',async t=>{
  let release,called;const reached=()=>new Promise(r=>called=r);let received=reached();
  const f=await fixture(t,{fetchImpl:async()=>{called();await new Promise(r=>release=r);return Response.json({id:'mock',choices:[{message:{content:'A clear description.'},finish_reason:'stop'}],usage:{cost:.001}});}});
  const image=await fetch(f.url+'/api/uploads',{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':f.config.csrf},body:Buffer.from([137,80,78,71,13,10,26,10])});const ref=(await image.json()).id;
  const result=await f.post('/api/llm/generate',{projectId:'default',model:'openai/gpt-5.6-sol',task:'image',format:'text',instruction:'Describe this',maxTokens:2048,referenceIds:[ref]});assert.equal(result.status,202);await received;
  assert.equal((await f.post('/api/projects',{type:'delete',id:'default'})).status,409);release();
  for(let i=0;i<100&&(await f.get('/api/llm/jobs')).activeProjectIds.length;i++)await delay(5);
  assert.deepEqual((await f.get('/api/llm/jobs')).activeProjectIds,[]);
  received=reached();const enhancement=f.post('/api/enhance-prompt',{projectId:'default',mode:'image',model:'nano-pro',prompt:'A clear scene'});await received;
  assert.equal((await f.post('/api/projects',{type:'delete',id:'default'})).status,409);release();assert.equal((await enhancement).status,200);
  assert.equal((await f.post('/api/projects',{type:'delete',id:'default'})).status,200);
});

test('failed disk writes leave the project active and retries are durable',async t=>{
  const f=await fixture(t);await mkdir(join(f.dir,'projects.json.tmp'));
  assert.equal((await f.post('/api/projects',{type:'delete',id:'default'})).status,500);assert.equal((await f.get('/api/projects')).projects[0].id,'default');
  assert.equal((await f.get('/api/jobs')).jobs.length,1);assert.equal(JSON.parse(await readFile(join(f.dir,'projects.json'),'utf8')).projects[0].deletedAt,undefined);
  await rm(join(f.dir,'projects.json.tmp'),{recursive:true});assert.equal((await f.post('/api/projects',{type:'delete',id:'default'})).status,200);
});

test('serialized project deletion preserves at least one active project during concurrent deletes',async t=>{
  const f=await fixture(t),store=await createProjectStore(f.dir),other=await store.mutate({type:'create',name:'Second'});
  await Promise.all([store.mutate({type:'delete',id:'default'}),store.mutate({type:'delete',id:other.id})]);assert.equal(store.list().length,1);assert.equal(store.list({deleted:true}).length,2);
  await Promise.all([store.mutate({type:'restore',id:'default'}),store.mutate({type:'restore',id:other.id})]);assert.equal(store.list().length,3);assert.equal(store.list({deleted:true}).length,0);
});
