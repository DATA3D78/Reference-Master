import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ShootWorkspace} from '../public/shoot.js';
import {newShoot,sectionFields,validateShoot} from '../public/shoot-model.js';
import {description} from './fixtures/visual-description.mjs';
const ref=id=>({assetId:id,name:id+'.png',contentType:'image/png',width:1200,height:800});
function fixture(){
 const draft={...newShoot(),base:structuredClone(description),sourceJobId:'old-analysis',references:{source:ref('old-image'),subject:ref('character')},enabled:['subject'],patches:{'subject.expression':'Old override'},refinement:{jobId:'old-refinement',key:'old-key',prompt:JSON.stringify(description)},batch:{id:'old-batch',remaining:[],jobIds:['saved-image']},jobIds:['saved-image']};
 const errors=[],statuses=[],requests=[],snapshots=[];
 const c={draft,view:'prompt',busy:false,loaded:true,projectId:'default',epoch:0,jobs:[],
  actions:{api:async()=>({keyConfigured:true,shootSubjectTypes:true}),post:async(path,body)=>{requests.push({path,body});return {job:{id:'new-analysis'}};}},
  changed:()=>snapshots.push(structuredClone(draft)),render:()=>{},renderView:()=>{},renderResults:()=>{},syncDisabled:()=>{},locked:()=>c.busy||!!draft.pending,
  setBusy:value=>{c.busy=value;},error:value=>{if(value)errors.push(value);},status:value=>statuses.push(value),persist:async()=>{},unstage:async()=>{},
  stageReferences:async refs=>refs.map(r=>({id:r.assetId}))
 };
 for(const method of ['resetDescription','replaceReference','useDescription','describe','refresh'])c[method]=(...args)=>ShootWorkspace.prototype[method].apply(c,args);
 return {c,draft,errors,statuses,requests,snapshots};
}
test('a new starting image clears stale descriptions and Direction edits while preserving saved results',()=>{
 const {c,draft}=fixture();c.replaceReference('source',ref('new-image'));
 assert.equal(draft.base,null);assert.equal(draft.sourceJobId,null);assert.equal(draft.refinement,null);assert.equal(draft.batch,null);assert.deepEqual(draft.patches,{});assert.deepEqual(draft.enabled,[]);assert.equal(c.view,'original');
 assert.equal(draft.references.source.assetId,'new-image');assert.deepEqual(draft.jobIds,['saved-image']);assert.deepEqual(validateShoot(draft),draft);
});
test('replacing a subject reference keeps the original source description and other Direction settings',()=>{
 const {c,draft}=fixture(),before=structuredClone(draft.base);c.replaceReference('subject',ref('new-character'));
 assert.deepEqual(draft.base,before);assert.equal(draft.sourceJobId,'old-analysis');assert.deepEqual(draft.patches,{'subject.expression':'Old override'});assert.equal(draft.references.subject.assetId,'new-character');
});
test('Describe image submits the new source directly without requiring a browser confirmation',async()=>{
 const {c,draft,requests,errors}=fixture();await c.describe('source');
 assert.deepEqual(errors,[]);assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/llm/generate');assert.equal(requests[0].body.task,'image');assert.deepEqual(requests[0].body.referenceIds,['old-image']);assert.equal(draft.pending.id,'new-analysis');assert.equal(c.view,'original');
});
test('completed replacement analysis repopulates Prompt and every Direction section from the new image',async()=>{
 const {c,draft,errors,snapshots}=fixture();c.replaceReference('source',ref('new-image'));await c.describe('source');
 const fresh=structuredClone(description);fresh.scene_description='A runner on a sunlit beach';fresh.subject.expression='Smiling into sunlight';fresh.subject.pose='Running toward the camera';fresh.action.description='Running on sand';fresh.environment.setting='A bright sandy beach';fresh.composition.framing='Wide full-body photograph';fresh.lighting.style='Warm sunlight';fresh.visual_style.mood=['Joyful'];fresh.product={description:'A blue water bottle'};
 c.actions.api=async path=>path.startsWith('/api/jobs')?{jobs:[]}:{jobs:[{id:'new-analysis',status:'COMPLETED',output:JSON.stringify(fresh)}]};
 await c.refresh();assert.deepEqual(errors,[]);assert.deepEqual(draft.base,fresh);assert.equal(draft.sourceJobId,'new-analysis');assert.equal(draft.pending,null);assert.equal(draft.refinement,null);assert.equal(c.view,'original');assert.deepEqual(draft.enabled,[]);
 for(const [section,path,value]of [['subject','subject.expression',fresh.subject.expression],['product','product.description','A blue water bottle'],['action','subject.pose',fresh.subject.pose],['framing','composition.framing',fresh.composition.framing],['location','environment.setting',fresh.environment.setting],['style','lighting.style',fresh.lighting.style]])assert.equal(sectionFields(draft,section).find(f=>f.path===path).value,value);
 assert.deepEqual(snapshots.at(-1).base,fresh);assert.deepEqual(draft.jobIds,['saved-image']);
});
test('late polling responses cannot clear or overwrite a newer pending description',async()=>{
 const {c,draft}=fixture();draft.pending={id:'old-analysis',role:'source'};let release;
 c.actions.api=async path=>path.startsWith('/api/jobs')?{jobs:[]}:new Promise(resolve=>{release=resolve;});
 const waiting=c.refresh();draft.pending={id:'new-analysis',role:'source'};release({jobs:[{id:'old-analysis',status:'COMPLETED',output:JSON.stringify(description)}]});await waiting;
 assert.deepEqual(draft.pending,{id:'new-analysis',role:'source'});
});
test('failed replacement analysis keeps the new source empty and retryable rather than restoring the old prompt',async()=>{
 const {c,draft,errors}=fixture();c.replaceReference('source',ref('new-image'));await c.describe('source');
 c.actions.api=async path=>path.startsWith('/api/jobs')?{jobs:[]}:{jobs:[{id:'new-analysis',status:'FAILED',error:'Provider error'}]};
 await c.refresh();assert.equal(draft.pending,null);assert.equal(draft.base,null);assert.equal(draft.references.source.assetId,'new-image');assert.deepEqual(errors,['Provider error']);assert(!c.locked());
});
test('loading saved JSON also resets the refined prompt and prior Direction without losing image history',()=>{
 const {c,draft}=fixture();const fresh={scene_description:'New saved scene',subject:{expression:'A smile'}};c.useDescription(JSON.stringify(fresh),'saved-json');
 assert.deepEqual(draft.base,fresh);assert.equal(draft.sourceJobId,'saved-json');assert.equal(draft.refinement,null);assert.equal(draft.batch,null);assert.deepEqual(draft.patches,{});assert.deepEqual(draft.jobIds,['saved-image']);
});
test('an older running server cannot silently drop typed Direction edits',async()=>{
 const {c,errors}=fixture();c.loaded=false;c.actions.subjectTypesEnabled=()=>false;c.schedule=()=>{};
 c.actions.api=async()=>{throw Error('Old server drafts must not be loaded for typed editing');};
 await ShootWorkspace.prototype.loadProject.call(c,'default');
 assert.equal(c.loaded,false);assert.equal(c.busy,false);assert.match(errors[0],/Apply Studio Update.command/);
});
