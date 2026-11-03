import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createLlmStore} from '../llm-store.mjs';

const parent={id:'parent',projectId:'default',status:'COMPLETED',modelName:'GPT-5.6 Sol',createdAt:'2026-10-08T12:00:00Z',output:'{"title":"A portrait"}',settings:{task:'image',format:'json'},usage:{cost:.02},billingKeyHash:'private-hash'};
const child={...parent,id:'child',output:'A refined portrait',settings:{task:'refine',format:'text',sourceId:'parent',sourceText:parent.output}};
const requireProject=id=>{id=id||'default';if(!['default','second'].includes(id))throw Object.assign(Error('Project not found'),{status:400});return {id};};
async function fixture(t,seed=[parent,child],fetchImpl=async()=>{throw Error('Unexpected provider call');}){
  const directory=await mkdtemp(join(tmpdir(),'llm-deletion-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'llm-jobs.json'),JSON.stringify(seed));
  const open=()=>createLlmStore({directory,fetchImpl,requireProject});return {directory,open,store:await open()};
}
test('LLM deletion persists, preserves refinements and spending, and restores the original output',async t=>{
  const seed=[parent,child,{...parent,id:'failed',status:'FAILED',output:undefined},{...parent,id:'unknown',status:'UNKNOWN',output:undefined},{...parent,id:'other',projectId:'second'}];
  const f=await fixture(t,seed),before=await readFile(join(f.directory,'llm-jobs.json'),'utf8'),spending=f.store.spendingEntries();
  await Promise.all(['parent','failed','unknown'].map(jobId=>f.store.setDeleted({jobId,projectId:'default'},true)));
  assert.deepEqual(f.store.list().jobs.map(j=>j.id),['child']);assert.equal(f.store.list('second').jobs.length,1);
  assert.equal(f.store.list().jobs[0].settings.sourceText,parent.output);assert.deepEqual(f.store.spendingEntries(),spending);
  assert.equal(await readFile(join(f.directory,'llm-jobs.json'),'utf8'),before);
  const reopened=await f.open();assert.deepEqual(reopened.list().jobs.map(j=>j.id),['child']);
  await assert.rejects(reopened.submit({projectId:'default',model:'openai/gpt-5.6-sol',task:'refine',format:'text',maxTokens:8192,instruction:'Change colors',sourceId:'parent'},[],'test-key'),/completed text output/);
  const restored=await reopened.setDeleted({projectId:'default',jobId:'parent'},false);assert.equal(restored.job.output,parent.output);assert(!('billingKeyHash' in restored.job));
  assert.deepEqual((await f.open()).list().jobs.map(j=>j.id),['parent','child']);
  assert.equal((await stat(join(f.directory,'llm-deletions.json'))).mode&0o777,0o600);
  await assert.rejects(reopened.setDeleted({jobId:'parent',projectId:'second'},true),e=>e.status===404);
  await assert.rejects(reopened.setDeleted({jobId:'missing'},true),e=>e.status===404);
});
test('a failed deletion write leaves the output visible and a subsequent retry succeeds',async t=>{
  const f=await fixture(t);await mkdir(join(f.directory,'llm-deletions.json.tmp'));
  await assert.rejects(f.store.setDeleted({jobId:'parent'},true),e=>e.status===500);
  assert.equal(f.store.list().jobs.length,2);assert.equal((await f.open()).list().jobs.length,2);
  await rm(join(f.directory,'llm-deletions.json.tmp'),{recursive:true});await f.store.setDeleted({jobId:'parent'},true);assert.equal(f.store.list().jobs.length,1);
  await writeFile(join(f.directory,'llm-deletions.json'),'broken');await assert.rejects(f.open(),/Cannot read deleted LLM outputs/);
  assert.equal(await readFile(join(f.directory,'llm-deletions.json'),'utf8'),'broken');
});
test('running analyses cannot be deleted; completed analyses can be removed without cancellation or resubmission',async t=>{
  let finish,calls=0;const f=await fixture(t,[],()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const body={projectId:'default',model:'openai/gpt-5.6-sol',task:'image',format:'text',maxTokens:8192,instruction:''};
  const job=await f.store.submit(body,[{kind:'image',contentType:'image/png',bytes:8,data:'data:image/png;base64,iVBORw0KGgo='}],'test-key');
  await assert.rejects(f.store.setDeleted({jobId:job.id},true),e=>e.status===409);
  assert.equal(f.store.list().jobs[0].status,'RUNNING');
  finish(Response.json({choices:[{message:{content:'A blue sculpture.'},finish_reason:'stop'}]}));
  for(let i=0;i<100&&f.store.list().jobs[0].status==='RUNNING';i++)await delay(5);
  assert.equal(f.store.list().jobs[0].status,'COMPLETED');await delay(15);
  await f.store.setDeleted({jobId:job.id},true);assert.equal(f.store.list().jobs.length,0);assert.equal(calls,1);
});
