import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LlmWorkspace} from '../public/llm.js';
import {ShootWorkspace} from '../public/shoot.js';

const now=new Date(2026,9,21,12),date=day=>new Date(2026,9,day,10).toISOString();
const ids=jobs=>jobs.map(job=>job.id);
test('LLM combines calendar history with base/refined prompt filters without changing saved outputs',()=>{
 const workspace=Object.create(LlmWorkspace.prototype);
 workspace.jobs=[
  {id:'description',createdAt:date(21),settings:{task:'image',format:'json'}},
  {id:'refinement',createdAt:date(21),settings:{task:'refine',format:'text'}},
  {id:'shoot',createdAt:date(20),settings:{task:'shoot',format:'json'}},
  {id:'video',createdAt:date(1),settings:{task:'video',format:'text'}},
  {id:'legacy',createdAt:date(0),settings:{sourceId:'description'}}
 ];
 const before=structuredClone(workspace.jobs);
 workspace.historyPeriod='day';workspace.promptKind='all';assert.deepEqual(ids(workspace.visibleJobs(now)),['description','refinement']);
 workspace.promptKind='base';assert.deepEqual(ids(workspace.visibleJobs(now)),['description']);
 workspace.promptKind='refined';assert.deepEqual(ids(workspace.visibleJobs(now)),['refinement']);
 workspace.historyPeriod='week';assert.deepEqual(ids(workspace.visibleJobs(now)),['refinement','shoot']);
 workspace.historyPeriod='month';workspace.promptKind='base';assert.deepEqual(ids(workspace.visibleJobs(now)),['description','video']);
 workspace.historyPeriod='all';workspace.promptKind='refined';assert.deepEqual(ids(workspace.visibleJobs(now)),['refinement','shoot','legacy']);
 workspace.promptKind='all';assert.equal(workspace.visibleJobs(now).length,5);assert.deepEqual(workspace.jobs,before);
});
test('SHOOT date filters scope selection/download/preview media and retain all saved jobs and prompt settings',()=>{
 const workspace=Object.create(ShootWorkspace.prototype);
 workspace.draft={jobIds:['tracked'],refinement:{prompt:'Exact saved prompt'}};
 workspace.jobs=[21,20,1,0].map((day,i)=>({id:'shoot-'+i,createdAt:date(day),mode:'image',settings:{shootBatchId:'batch-'+i},tasks:[{outputs:[{id:'image-'+i,contentType:'image/png'}]}]}));
 workspace.jobs.push({id:'regular',mode:'image',createdAt:date(21),settings:{},tasks:[{outputs:[{id:'regular',contentType:'image/png'}]}]});
 const before=structuredClone({jobs:workspace.jobs,draft:workspace.draft});
 for(const [period,count] of [['day',1],['week',2],['month',3],['all',4]]){
  workspace.historyPeriod=period;
  const jobs=workspace.visibleShootJobs(now);assert.equal(jobs.length,count);
  assert.deepEqual(workspace.resultMedia(jobs).map(item=>item.key),Array.from({length:count},(_,i)=>`shoot-${i}:image-${i}`));
 }
 assert.deepEqual({jobs:workspace.jobs,draft:workspace.draft},before);
});
