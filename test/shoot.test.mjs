import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../server.mjs';
import {createShootStore} from '../shoot-store.mjs';
import {ShootWorkspace} from '../public/shoot.js';
import {description} from './fixtures/visual-description.mjs';
import {newShoot,validateShoot,parseShootJSON,compiledShoot,sectionFields,resetSection,applySectionDescription,applyMood,shootReferences,shootPrompt,shootPlans,resolvedRatios,shootPlainText,shootDirectionKey,shootRefinementReady} from '../public/shoot-model.js';
const base=()=>({...newShoot(),base:structuredClone(description)});
const ref=assetId=>({assetId,name:'Reference.png',contentType:'image/png',width:1200,height:800});
test('SHOOT preserves every untouched nested field and can disable or restore a section',()=>{
 const draft=base(),before=structuredClone(draft.base);draft.patches={'subject.expression':'A quiet smile','composition.framing':'Full body portrait','visual_style.mood':['Calm']};draft.enabled=['subject'];
 const result=compiledShoot(draft);assert.equal(result.subject.expression,'A quiet smile');assert.deepEqual(result.composition,before.composition);assert.deepEqual(result.visual_style,before.visual_style);assert.deepEqual(result.subject.clothing,before.subject.clothing);assert.deepEqual(draft.base,before);
 draft.enabled.push('framing');assert.equal(compiledShoot(draft).composition.framing,'Full body portrait');resetSection(draft,'subject');assert.deepEqual(compiledShoot(draft).subject,before.subject);assert.equal(draft.patches['subject.expression'],undefined);assert.equal(compiledShoot(draft).composition.framing,'Full body portrait');
});
test('subject is image-driven: only expression and hair are editable; legacy hidden fields cannot conflict',()=>{
 const draft=base();draft.enabled=['subject'];draft.references.subject=ref('character');
 draft.patches={'subject.type':'OLD HIDDEN TYPE','subject.clothing.top':'OLD HIDDEN OUTFIT','subject.expression':'A quiet smile','subject.hair':'Short curls'};
 const result=compiledShoot(draft);assert.equal(result.subject.type,description.subject.type);assert.deepEqual(result.subject.clothing,description.subject.clothing);assert.equal(result.subject.expression,'A quiet smile');assert.equal(result.subject.hair,'Short curls');
 assert.deepEqual(sectionFields(draft,'subject').map(f=>f.path),['subject.expression','subject.hair']);
 const prompt=JSON.parse(shootPrompt(draft));assert.deepEqual(prompt.shoot_direction.changed_fields,['subject.expression','subject.hair']);assert(!shootPrompt(draft).includes('OLD HIDDEN'));
 assert.match(prompt.shoot_direction.references[0].instruction,/Keep the original outfit as described in subject.clothing/);assert.match(prompt.shoot_direction.references[0].instruction,/explicit subject.hair override/);
 draft.keepOutfit=false;let instruction=JSON.parse(shootPrompt(draft)).shoot_direction.references[0].instruction;assert.match(instruction,/Replace the outfit.*character reference/);assert.doesNotMatch(instruction,/Keep the outfit/);
 draft.patches['subject.hair']='';instruction=JSON.parse(shootPrompt(draft)).shoot_direction.references[0].instruction;assert.match(instruction,/Use the hair from this character reference/);
 const before=compiledShoot(draft);applySectionDescription(draft,'subject',{subject:{expression:'Changed by legacy analysis',pose:'Running',clothing:{top:'Jacket'}}});assert.deepEqual(compiledShoot(draft),before);
 draft.enabled=[];assert.deepEqual(compiledShoot(draft),description);assert.equal(shootReferences(draft).length,0);
});
test('describing product and location remains scoped to the selected section',()=>{
 const draft=base();draft.patches['composition.framing']='Headshot';draft.enabled=['framing'];const other=structuredClone(description);other.environment.setting='Mars';
 applySectionDescription(draft,'location',other);assert.equal(compiledShoot(draft).environment.setting,'Mars');assert.deepEqual(compiledShoot(draft).subject,description.subject);assert.equal(compiledShoot(draft).composition.framing,'Headshot');
 applySectionDescription(draft,'product',other);assert.equal(compiledShoot(draft).product.description,other.scene_description);
});
test('reference order and explicit role instructions follow only enabled replacements',()=>{
 const d=base();d.references={location:ref('location'),source:ref('source'),subject:ref('subject'),product:ref('product')};d.enabled=['subject','location'];d.patches['subject.type']='Adult man';
 assert.deepEqual(shootReferences(d).map(r=>r.role),['subject','location']);const prompt=JSON.parse(shootPrompt(d));assert.deepEqual(prompt.shoot_direction.references.map(r=>r.image),[1,2]);assert.match(prompt.shoot_direction.priority,/override.*conflicting/);assert.match(prompt.shoot_direction.references[0].instruction,/original/);assert.deepEqual(prompt.environment,description.environment);assert.match(shootPlainText(d),/Subject:/);
});
test('all ten moods only alter photographic style and restoring returns the base exactly',()=>{
 for(const id of ['cinematic','editorial','daylight','noir','golden','flash','pastel','studio','vintage','neon']){const d=base();applyMood(d,id);const output=compiledShoot(d);assert.deepEqual(output.subject,description.subject);assert.deepEqual(output.environment,description.environment);assert.deepEqual(output.composition,description.composition);assert.notDeepEqual(output.visual_style.mood,description.visual_style.mood);resetSection(d,'style');assert.deepEqual(compiledShoot(d),description);}
});
test('draft validation rejects unsafe JSON, malformed refs, invalid plans and oversized fields',()=>{
 assert.throws(()=>parseShootJSON('{"__proto__":{"polluted":true}}'));
 assert.throws(()=>parseShootJSON('[]'));assert.throws(()=>parseShootJSON('{"subject": {"constructor": "oops"}}'));
 for(const patch of [{ratios:[]},{count:20},{enabled:['settings']},{model:'wan3'},{resolution:'bad'},{references:{source:{...ref('ok'),assetId:'../../secrets'}}},{patches:{'subject.__proto__.polluted':true}},{patches:{'lighting.style':'x'.repeat(30001)}}])assert.throws(()=>validateShoot({...base(),...patch}));
 assert.equal({}.polluted,undefined);assert.deepEqual(validateShoot(base()),base());
});
test('ratio matching deduplicates overlapping ratios and each request has 2–4 variations',()=>{
 const d=base();d.references.source=ref('source');d.ratios=['original','3:2','9:16'];d.count=4;
 assert.deepEqual(resolvedRatios(d),['3:2','9:16']);const refs=[{kind:'image',contentType:'image/png',bytes:10,metadata:{width:1200,height:800}}],plans=shootPlans(d,refs);assert.equal(plans.length,2);assert(plans.every(p=>p.count===4&&p.inputType==='image'));assert.equal(plans[1].ratio,'9:16');
 d.model='nano21';assert.equal(resolvedRatios({...d,ratios:['original']})[0],'3:2');d.ratios=['1:1'];d.patches['subject.expression']='x'.repeat(30000);d.enabled=['subject'];assert(shootPlans(d,refs)[0].prompt.length>30000);d.model='nano-pro';assert.throws(()=>shootPlans(d,refs),/characters/);
});
test('SHOOT persists separate project drafts, rejects stale writes and survives reopening',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shoot-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));const requireProject=id=>{if(!['a','b'].includes(id))throw Object.assign(Error('Unknown project'),{status:400});return {id};};let store=await createShootStore(dir,requireProject);
 const a=store.load('a');a.draft.base=description;a.draft.patches['subject.expression']='New expression';a.draft.enabled=['subject'];await store.save({projectId:'a',...a});assert.equal(store.load('b').draft.base,null);
 await assert.rejects(store.save({projectId:'a',...a}),/another tab/);assert.equal(store.load('a').revision,1);
 store=await createShootStore(dir,requireProject);assert.equal(compiledShoot(store.load('a').draft).subject.expression,'New expression');assert.throws(()=>store.load('missing'));
 const saved=await readFile(join(dir,'shoot-drafts.json'),'utf8');assert(!saved.includes('data:image'));
});
test('SHOOT routes use CSRF and project isolation; resumed generation returns the existing receipt',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shoot-api-'));let submissions=0;
 const app=await createStudio({dataDir:dir,key:'dummy-fal',openRouterKey:'',pollMs:3600000,autoArchive:false,fetchImpl:async url=>{submissions++;return Response.json({request_id:'shoot-mock',status:'IN_QUEUE'});}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await app.refresh();await app.save();await rm(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+app.server.address().port,config=await fetch(origin+'/api/bootstrap').then(r=>r.json());assert.equal(config.features.shoot,true);
 const post=(path,body,token=config.csrf)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token,Origin:origin},body:JSON.stringify(body)});
 const initial=await fetch(origin+'/api/shoot').then(r=>r.json());assert.equal(initial.draft.base,null);
 assert.equal((await post('/api/shoot',{projectId:'default',revision:0,draft:base()},'wrong')).status,403);
 assert.equal((await post('/api/shoot',{projectId:'missing',revision:0,draft:base()})).status,400);
 assert.equal((await post('/api/shoot',{projectId:'default',revision:0,draft:base()})).status,200);
 assert.equal((await post('/api/shoot',{projectId:'default',revision:0,draft:base()})).status,409);
 for(const path of ['/shoot.js','/shoot.css','/shoot-model.js'])assert.equal((await fetch(origin+path)).status,200);
 assert.equal((await fetch(origin+'/shoot-store.mjs')).status,404);assert.equal((await fetch(origin+'/.local/shoot-drafts.json')).status,404);
 const plan={...shootPlans(base())[0],projectId:'default',referenceIds:[],shootBatchId:'12345678-1234-1234-1234-123456789012'};
 const response=await post('/api/generate',plan);assert.equal(response.status,202);const first=(await response.json()).job;
 const duplicate=await post('/api/generate',plan);assert.equal(duplicate.status,202);assert.equal((await duplicate.json()).job.id,first.id);
 assert.equal((await fetch(origin+'/api/jobs').then(r=>r.json())).jobs.length,1);assert(submissions<=2,'Only two variation tasks may be submitted');
});

test('the starting image never reaches generation; only enabled replacement images are uploaded',async()=>{
 for(const enabled of [[],['subject'],['subject','product','location']]){
  const draft=base();draft.model='nano21';draft.ratios=['original'];draft.enabled=enabled;
  draft.references={source:{...ref('analysis-only'),width:1080,height:1350},subject:{...ref('character'),width:1920,height:1080},product:ref('item'),location:ref('place')};
  const exactPrompt=shootPrompt(draft);draft.refinement={jobId:'refined',key:shootDirectionKey(draft),prompt:exactPrompt};draft.batch={id:crypto.randomUUID(),remaining:resolvedRatios(draft),jobIds:[]};
  let staged=[],requests=[],errors=[];
  const context={draft,busy:false,loaded:true,projectId:'test',jobs:[],
   actions:{context:()=>({keyConfigured:true,shootSubjectTypes:true}),submitted:()=>{},post:async(path,body)=>{requests.push(body);return {job:{id:'mock-'+requests.length,settings:body}};}},
   stageReferences:async refs=>{staged=refs;return refs.map(r=>({id:r.assetId,kind:'image',contentType:r.contentType,bytes:10,metadata:{width:r.width,height:r.height}}));},
   unstage:async()=>{},persist:async()=>{},changed:()=>{},setBusy:()=>{},error:s=>{if(s)errors.push(s);},status:()=>{},render:()=>{}
  };
  await ShootWorkspace.prototype.generate.call(context);
  assert.deepEqual(errors,[]);assert.deepEqual(staged.map(r=>r.role),enabled);assert(!staged.some(r=>r.assetId==='analysis-only'));
  assert.equal(requests.length,1);assert.equal(requests[0].prompt,exactPrompt);assert.equal(requests[0].inputType,enabled.length?'image':'text');assert.equal(requests[0].ratio,'4:5','source dimensions resolve locally even with differently shaped character reference');
  assert.deepEqual(requests[0].referenceIds,staged.map(r=>r.assetId));
  const prompt=JSON.parse(requests[0].prompt);assert.deepEqual(prompt.shoot_direction.references.map(r=>r.role),enabled);assert.deepEqual(prompt.shoot_direction.references.map(r=>r.image),enabled.map((_,i)=>i+1));assert.match(prompt.shoot_direction.scene_source,/not attached/);assert.deepEqual(prompt.subject,description.subject);
 }
});
test('Describe image still sends the starting image to the LLM',async()=>{
 const draft=newShoot();draft.references.source=ref('analysis-only');let staged=[],request;
 const context={draft,projectId:'test',locked:()=>false,setBusy:()=>{},error:s=>assert.equal(s,''),persist:async()=>{},changed:()=>{},status:()=>{},renderView:()=>{},unstage:async()=>{},
  actions:{api:async()=>({keyConfigured:true,shootSubjectTypes:true}),post:async(path,body)=>{assert.equal(path,'/api/llm/generate');request=body;return {job:{id:'mock-analysis'}};}},
  stageReferences:async refs=>{staged=refs;return [{id:'staged-source'}];}
 };
 await ShootWorkspace.prototype.describe.call(context,'source');assert.deepEqual(staged,[draft.references.source]);assert.deepEqual(request.referenceIds,['staged-source']);assert.deepEqual(draft.pending,{id:'mock-analysis',role:'source'});
});

test('failed SHOOT deletion uses stable task indices and leaves active variations alone',async()=>{
  const calls=[],busy=[];
  const workspace=Object.create(ShootWorkspace.prototype);
  Object.assign(workspace,{projectId:'project',resultPending:new Set(),visibleShootJobs:()=>[{id:'job',tasks:[{taskIndex:3,status:'FAILED'},{taskIndex:5,status:'IN_PROGRESS'}]}],renderResults:()=>{},actions:{busy:value=>busy.push(value),deleteFailedResult:async(...args)=>calls.push(args),toast:message=>assert.fail(message)}});
  await workspace.deleteFailedResult('job',3);
  await workspace.deleteFailedResult('job',5);
  await workspace.deleteFailedResult('job',0);
  assert.deepEqual(calls,[['job',3,'project']]);
  assert.deepEqual(busy,[true,false]);
  assert.equal(workspace.resultPending.size,0);
});
