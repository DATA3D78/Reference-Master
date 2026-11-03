import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ShootWorkspace} from '../public/shoot.js';
function fixture(){
 const item={key:'shoot-job:image-2',job:{id:'shoot-job'},media:{id:'image-2',favorite:false}},calls=[],busy=[],messages=[];
 const workspace={resultPending:new Set(),resultVersion:0,renderResults:()=>{},resultMedia:()=>[item],actions:{busy:value=>busy.push(value),toast:value=>messages.push(value),favorite:async(...args)=>{calls.push(args);return {favorite:args[2]};},saveAsset:async(...args)=>calls.push(args)}};
 workspace.resultAction=(...args)=>ShootWorkspace.prototype.resultAction.apply(workspace,args);
 return {workspace,item,calls,busy,messages};
}
test('SHOOT routes the chosen result to Favorites and Assets and supports removing the favorite',async()=>{
 const {workspace,item,calls,busy}=fixture();await workspace.resultAction(item.key,'favorite');assert.equal(item.media.favorite,true);
 await workspace.resultAction(item.key,'favorite');assert.equal(item.media.favorite,false);
 await workspace.resultAction(item.key,'asset');assert.deepEqual(calls,[[item.job.id,item.media.id,true,item],[item.job.id,item.media.id,false,item],[item.job.id,item.media.id,item]]);assert.deepEqual(busy,[true,false,true,false,true,false]);
});
test('a pending result action rejects duplicate clicks and unlocks after a failure',async()=>{
 const {workspace,item,messages,busy}=fixture();let fail,calls=0;workspace.actions.favorite=()=>{calls++;return new Promise((resolve,reject)=>{fail=reject;});};
 const first=workspace.resultAction(item.key,'favorite');await workspace.resultAction(item.key,'favorite');await workspace.resultAction(item.key,'asset');assert.equal(calls,1);assert(workspace.resultPending.has(item.key));
 fail(Error('Could not save'));await first;assert.equal(item.media.favorite,false);assert.equal(workspace.resultPending.size,0);assert.deepEqual(messages,['Could not save']);assert.deepEqual(busy,[true,false]);
});
test('an older result poll cannot undo a favorite saved while the request was in flight',async()=>{
 const {workspace,item}=fixture();let release;Object.assign(workspace,{loaded:true,epoch:0,projectId:'default',draft:{pending:null,jobIds:['shoot-job']},jobs:[{id:'shoot-job',tasks:[{outputs:[item.media]}]}],error:assert.fail});
 workspace.actions.api=()=>new Promise(resolve=>{release=resolve;});const poll=ShootWorkspace.prototype.refresh.call(workspace);
 await workspace.resultAction(item.key,'favorite');release({jobs:[{id:'shoot-job',tasks:[{outputs:[{id:item.media.id,favorite:false}]}]}]});await poll;
 assert.equal(workspace.jobs[0].tasks[0].outputs[0].favorite,true);
});
test('SHOOT delete targets one image in its project and does not trigger favorite or asset actions',async()=>{
 const {workspace,item,calls,busy}=fixture();workspace.projectId='project-a';workspace.actions.deleteResult=async(...args)=>calls.push(args);
 await workspace.resultAction(item.key,'delete');assert.deepEqual(calls,[[item.job.id,item.media.id,'project-a']]);assert.deepEqual(busy,[true,false]);
});
test('SHOOT deletion and Undo synchronize results without editing the prompt or losing saved job IDs',()=>{
 const jobs=[{id:'older',createdAt:'2026-10-20'},{id:'newer',createdAt:'2026-10-21'}],draft={jobIds:['older','newer'],refinement:{prompt:'saved exact prompt'}};
 const workspace={jobs,draft,resultVersion:0,renderResults:()=>{}};
 ShootWorkspace.prototype.syncResultJob.call(workspace,'older',null);assert.deepEqual(workspace.jobs.map(j=>j.id),['newer']);
 ShootWorkspace.prototype.syncResultJob.call(workspace,'older',jobs[0]);assert.deepEqual(workspace.jobs.map(j=>j.id),['newer','older']);assert.equal(workspace.resultVersion,2);assert.equal(workspace.draft.refinement.prompt,'saved exact prompt');assert.deepEqual(draft.jobIds,['older','newer']);
});


test('SHOOT bulk deletion snapshots only selected visible images, blocks repeat clicks and preserves prompt state',async()=>{
 let release;const calls=[],items=[{key:'j:a',job:{id:'j'},media:{id:'a'}},{key:'j:b',job:{id:'j'},media:{id:'b'}}];
 const workspace=Object.create(ShootWorkspace.prototype);
 Object.assign(workspace,{projectId:'project-a',busy:false,resultPending:new Set(),resultVersion:0,selected:new Set(['j:a','hidden:image']),draft:{refinement:{prompt:'Exact prompt'}},resultMedia:()=>items,renderResults:()=>{},setBusy(value){this.busy=value;},actions:{deleteResults:(...args)=>{calls.push(args);return new Promise(resolve=>{release=resolve;});},toast:assert.fail}});
 const deletion=workspace.deleteSelected();await workspace.deleteSelected();assert.equal(calls.length,1);assert.deepEqual(calls[0],[[{jobId:'j',mediaId:'a'}],'project-a']);assert(workspace.resultPending.has('j:a'));
 release();await deletion;assert.equal(workspace.busy,false);assert.equal(workspace.resultPending.size,0);assert.equal(workspace.draft.refinement.prompt,'Exact prompt');
});
