import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProjectStore} from '../project-store.mjs';
import {createStudio} from '../server.mjs';
import {expandSelection,rectangleSelection,organizeItems} from '../public/canvas-state.js';
import {MODELS,capabilities,reusableSettings} from '../public/models.js';
const base={model:'nano-pro',inputType:'text',prompt:'A blue glass object',ratio:'1:1',resolution:'1K',count:1,duration:'5',referenceIds:[]};
const seed={id:'old-job',mode:'image',modelName:'Nano Banana Pro',createdAt:new Date().toISOString(),settings:{...base,destination:'ideation'},tasks:[{status:'COMPLETED',outputs:[{id:'old-media',url:'https://fal.media/old.png',contentType:'image/png',favorite:true}]}]};
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'project-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function start(dir){const studio=await createStudio({dataDir:dir,autoArchive:false,pollMs:3600000});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+studio.server.address().port,config=await fetch(url+'/api/bootstrap').then(r=>r.json());return {...studio,url,config,get:path=>fetch(url+path).then(r=>r.json()),post:(path,body,token=config.csrf)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)}),close:()=>new Promise(r=>studio.server.close(r))};}
test('project creation and rename are durable, validated, and concurrent-safe',async t=>{
  const dir=await temp(t),store=await createProjectStore(dir);assert.equal(store.list()[0].id,'default');
  const [a,b]=await Promise.all([store.mutate({type:'create',name:'Campaign A'}),store.mutate({type:'create',name:'Campaign B'})]);
  await store.mutate({type:'rename',id:a.id,name:'Autumn'});const reopened=await createProjectStore(dir);assert.equal(reopened.list().length,3);assert.equal(reopened.requireProject(a.id).name,'Autumn');assert.equal(reopened.requireProject(b.id).name,'Campaign B');
  for(const name of ['',null,'x'.repeat(81)])await assert.rejects(store.mutate({type:'create',name}));
  assert.throws(()=>store.requireProject('../outside'));assert.throws(()=>store.requireProject(null));
});
test('migration keeps the old library, favorites and canvas in the default project; other projects stay isolated',async t=>{
  const dir=await temp(t);await writeFile(join(dir,'jobs.json'),JSON.stringify([seed]));
  const legacy={version:1,revision:4,title:'Existing ideas',camera:{x:15,y:30,zoom:.8},items:[{id:'media:old-job:old-media',type:'media',jobId:'old-job',mediaId:'old-media',x:-100,y:80,width:300,height:342}],seen:['media:old-job:old-media']};await writeFile(join(dir,'ideation.json'),JSON.stringify(legacy));
  let app=await start(dir);t.after(async()=>{if(app.server.listening)await app.close();});
  const oldJobs=(await app.get('/api/jobs')).jobs;assert.equal(oldJobs[0].projectId,'default');assert.equal(oldJobs[0].tasks[0].outputs[0].favorite,true);assert.deepEqual((await app.get('/api/ideation')).board,legacy);
  assert.equal((await app.post('/api/projects',{type:'create',name:'Blocked'},'wrong')).status,403);
  const {project:b}=await(await app.post('/api/projects',{type:'create',name:'Campaign B'})).json();
  assert.equal((await app.get('/api/jobs?project='+b.id)).jobs.length,0);assert.equal((await app.get('/api/ideation?project='+b.id)).board.items.length,0);
  assert.equal((await app.post('/api/ideation',{projectId:b.id,operations:[{type:'addMedia',jobId:'old-job',mediaId:'old-media'}]})).status,400);
  assert.equal((await app.post('/api/favorites',{projectId:b.id,jobId:'old-job',mediaId:'old-media',favorite:false})).status,400);
  await app.post('/api/ideation',{projectId:b.id,operations:[{type:'addNote',id:'b-note'},{type:'title',title:'Campaign B board'}]});
  assert.deepEqual((await app.get('/api/ideation')).board,legacy);
  const summaries=(await app.get('/api/projects')).projects;assert.equal(summaries.find(p=>p.id==='default').favorites,1);assert.equal(summaries.find(p=>p.id===b.id).favorites,0);
  await app.close();app=await start(dir);assert.equal((await app.get('/api/ideation?project='+b.id)).board.title,'Campaign B board');assert.deepEqual((await app.get('/api/ideation')).board,legacy);
  const persisted=JSON.parse(await readFile(join(dir,'jobs.json')));assert.equal(persisted.length,1);assert.equal(persisted[0].tasks[0].outputs[0].id,'old-media');
});
test('marquee and shift selection include whole groups; row and grid preserve group offsets',()=>{
  const items=[{id:'a',x:0,y:0,width:200,height:180,groupId:'g'},{id:'b',x:240,y:0,width:200,height:180,groupId:'g'},{id:'c',x:900,y:250,width:300,height:260}];
  assert.deepEqual([...expandSelection(items,['a'])],['a','b']);assert.deepEqual([...rectangleSelection(items,{x:-10,y:-10},{x:50,y:50})],['a','b']);
  for(const layout of ['row','grid']){const result=organizeItems(items,layout),a=result.find(i=>i.id==='a'),b=result.find(i=>i.id==='b'),c=result.find(i=>i.id==='c');assert.equal(b.x-a.x,240);assert.equal(b.y-a.y,0);assert(c.x>=b.x+200||c.y>=a.y+180);}
});
test('reuse settings restores every supported model/input configuration and handles obsolete values',()=>{
  for(const model of MODELS.filter(m=>m.available))for(const inputType of model.inputs){const c=capabilities(model,inputType),settings={model:model.id,inputType,ratio:c.ratios.at(-1),resolution:c.resolutions.at(-1),duration:c.durations?.at(-1)||'5',count:model.mode==='image'?4:2,prompt:'Reuse exactly this prompt',audio:true,quality:model.qualities?.at(-1)||'high',frameIndices:inputType==='keyframes'?[0,24]:undefined,...(model.creativityLevels?{creativity:'high'}:{}),...(model.thinkingLevels?{thinking:'high'}:{})};const result=reusableSettings({settings});assert.deepEqual(result.settings,{...settings,mode:model.mode});assert.deepEqual(result.warnings,[]);}
  const {settings,warnings}=reusableSettings({settings:{...base,resolution:'unknown',ratio:'bad',duration:'bad',count:999}});assert.equal(settings.resolution,'1K');assert.equal(settings.count,1);assert(warnings.length>=2);
  assert.equal(reusableSettings({settings:{model:'removed-model'}}).settings,null);
});

test('reuse preserves long prompts and warns without truncating text over a current model limit',()=>{
  const prompt='A scene with detail. '.repeat(1200),result=reusableSettings({settings:{...base,model:'nano-pro',prompt}});
  assert.equal(result.settings.prompt,prompt);assert(!result.warnings.some(w=>/Shorten/.test(w)));
  const limited=reusableSettings({settings:{...base,model:'krea2-large',prompt}});
  assert.equal(limited.settings.prompt,prompt);assert(limited.warnings.some(w=>/preserved.*5,000/.test(w)));
});
