import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLlmRequest,createLlmStore} from '../llm-store.mjs';
import {buildShootRefinement,finishShootRefinement} from '../shoot-refinement.mjs';
import {newShoot,validateShoot,shootReferences,shootDirectionKey,shootRefinementReady,shootPlainText} from '../public/shoot-model.js';
import {ShootWorkspace} from '../public/shoot.js';
import {description} from './fixtures/visual-description.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const ref=id=>({assetId:id,name:id+'.png',contentType:'image/png',width:1200,height:800});
const image={kind:'image',contentType:'image/png',bytes:8,data:'data:image/png;base64,iVBORw0KGgo='};
function draftFixture(){const d=newShoot();d.base=structuredClone(description);Object.assign(d.base.subject,{type:'A woman in a black coat',expression:'A quiet smile',hair:'Long straight dark hair',clothing:{top:'A structured black wool coat',gloves:'Black leather gloves'}});d.base.scene_description='A woman wearing a black coat in a nighttime street portrait.';d.enabled=['subject','style'];d.keepOutfit=false;d.patches={'visual_style.mood':['Calm'],'subject.hair':''};d.references={source:ref('analysis-only'),subject:ref('character')};d.ratios=['1:1','4:5'];return d;}
function modelOutput(d){const result=structuredClone(d.base);result.scene_description='A subject with short curls and a rust-orange silk top stands in a nighttime street portrait.';result.subject.type='The young woman from reference image, medium tan skin';result.subject.hair='Short dark curls around her face';result.subject.clothing={top:'A rust-orange silk halter top with a draped neckline',bottom:'Fitted black shorts',accessories:'A narrow silver bracelet'};result.subject.expression='MODEL SHOULD NOT OVERRIDE';result.key_details=['The orange silk catches the warm street light.'];result.negative_elements=['No readable text'];result.reference_descriptions=shootReferences(d).map((r,i)=>({image:i+1,role:r.role,description:r.role==='subject'?'The young woman from reference image, medium tan skin, wearing a rust-orange top and black shorts.':`The ${r.role} reference has detailed visible shapes and textures.`}));return result;}
const body=d=>({projectId:'test',task:'shoot',format:'json',model:d.llmModel,maxTokens:16384,shootDraft:d});

test('refinement request describes every numbered replacement and reinforces the selected outfit without the source image',()=>{
 const d=draftFixture(),before=structuredClone(d.base);d.enabled.push('product','location');d.references.product=ref('object');d.references.location=ref('place');
 const request=buildLlmRequest(body(d),[image,image,image]);
 assert.equal(request.payload.response_format.type,'json_object');assert.equal(request.payload.messages[1].content.filter(p=>p.type==='image_url').length,3);
 const instruction=request.payload.messages[1].content[0].text;assert.match(instruction,/REPLACE the entire subject.clothing/);assert.match(instruction,/Rewrite scene_description, key_details, negative_elements/);assert.match(instruction,/explicit edited field values/);assert.doesNotMatch(instruction,/analysis-only/);assert.match(instruction,/ONE short phrase/);assert.match(instruction,/Do not enumerate face shape/);assert.doesNotMatch(instruction,/concrete description of the reference subject/);assert.deepEqual(d.base,before);
 d.keepOutfit=true;assert.match(buildShootRefinement(body(d),[image,image,image]).instruction,/Keep the original subject.clothing exactly/);
 assert.throws(()=>buildLlmRequest(body(d),[image]),/enabled replacement/);
 d.enabled=[];assert.doesNotThrow(()=>buildLlmRequest(body(d),[]));
});

test('final prompt contains described identity and outfit, preserves expression/explicit changes and never changes the original',()=>{
 for(const keepOutfit of [false,true]){
  const d=draftFixture();d.keepOutfit=keepOutfit;const before=structuredClone(d.base),result=JSON.parse(finishShootRefinement(d,JSON.stringify(modelOutput(d))));
  assert.equal(result.subject.type,'The young woman from reference image, medium tan skin');assert.equal(result.subject.hair,'As in reference image');assert.equal(result.subject.expression,'A quiet smile');assert.deepEqual(result.visual_style.mood,['Calm']);assert.deepEqual(d.base,before);
  if(keepOutfit)assert.deepEqual(result.subject.clothing,d.base.subject.clothing);else{assert.match(result.subject.clothing.top,/rust-orange silk/);assert(!JSON.stringify(result.subject.clothing).includes('coat'));}
  assert.match(result.shoot_direction.references[0].description,/woman from reference image, medium tan skin/);assert.deepEqual(result.shoot_direction.references.map(r=>r.image),[1]);
  d.patches['subject.hair']='A short copper bob';assert.equal(JSON.parse(finishShootRefinement(d,JSON.stringify(modelOutput(d)))).subject.hair,'A short copper bob');
 }
});

test('brief subject phrases are accepted without requiring an anatomical or hair inventory',()=>{
 const d=draftFixture(),output=modelOutput(d);output.subject.type='The woman from reference image';delete output.subject.hair;output.reference_descriptions[0].description='The woman from reference image';
 const final=JSON.parse(finishShootRefinement(d,JSON.stringify(output)));assert.equal(final.subject.type,output.subject.type);assert.equal(final.subject.hair,'As in reference image');
});

test('incomplete reference descriptions, missing sections or missing outfit fail closed',()=>{
 const d=draftFixture();for(const corrupt of [r=>delete r.environment,r=>r.reference_descriptions=[],r=>r.reference_descriptions[0].image=2,r=>r.reference_descriptions[0].description='Person',r=>r.subject.clothing={}]){const output=modelOutput(d);corrupt(output);assert.throws(()=>finishShootRefinement(d,JSON.stringify(output)),/No images were submitted/);}
});

function client(d){
 const requests=[],staged=[],errors=[],statuses=[],snapshots=[];
 const context={draft:d,busy:false,loaded:true,projectId:'test',jobs:[],
  actions:{context:()=>({keyConfigured:true,shootSubjectTypes:true}),api:async()=>({keyConfigured:true,shootSubjectTypes:true,shootReferenceAnalysis:true,shootConciseSubject:true}),submitted:()=>{},post:async(path,body)=>{requests.push({path,body});return {job:{id:path.includes('/llm/')?'analysis':`image-${requests.length}`,settings:body}};}},
  stageReferences:async refs=>{staged.push(refs);return refs.map(r=>({...image,id:r.assetId,metadata:{width:r.width,height:r.height}}));},unstage:async()=>{},
  persist:async()=>snapshots.push(validateShoot(d)),changed:()=>{},setBusy:value=>{context.busy=value;},error:s=>{if(s)errors.push(s);},status:s=>statuses.push(s),render:()=>{},renderView:()=>{}
 };
 for(const method of ['generate','startRefinement','finishRefinement'])context[method]=(...args)=>ShootWorkspace.prototype[method].apply(context,args);
 return {context,requests,staged,errors,statuses,snapshots};
}
test('Generate awaits analysis, persists it, then sends the exact refined prompt to every image ratio',async()=>{
 const d=draftFixture(),c=client(d);await c.context.generate();
 assert.deepEqual(c.errors,[]);assert.equal(c.requests.length,1);assert.equal(c.requests[0].path,'/api/llm/generate');assert.equal(c.requests[0].body.task,'shoot');assert.deepEqual(c.requests[0].body.referenceIds,['character']);assert.equal(d.pending.role,'refine');assert.equal(d.refinement.prompt,null);
 assert(c.staged.flat().every(r=>r.assetId!=='analysis-only'));
 const output=finishShootRefinement(d,JSON.stringify(modelOutput(d)));
 await c.context.finishRefinement({id:'analysis',status:'COMPLETED',output});
 assert.deepEqual(c.errors,[]);assert.equal(c.requests.length,3);assert(c.requests.slice(1).every(r=>r.path==='/api/generate'&&r.body.prompt===output));assert.equal(d.refinement.prompt,output);assert.equal(d.pending,null);assert.equal(d.batch.remaining.length,0);
 assert(c.snapshots.some(s=>s.refinement?.prompt===output&&s.batch?.remaining.length===2));
 const reopened=validateShoot(d);assert(shootRefinementReady(reopened));assert.equal(reopened.refinement.prompt,output);assert.match(shootPlainText(d,{prompt:output}),/rust-orange silk/);
 d.patches['subject.expression']='Laughing';assert(!shootRefinementReady(d));assert.equal(d.refinement.prompt,output,'Previous generation remains inspectable while stale');
});

test('failed, unknown, mismatched or malformed refinement never submits images',async()=>{
 for(const job of [{id:'analysis',status:'FAILED',error:'Reference analysis failed'},{id:'analysis',status:'UNKNOWN',error:'Connection interrupted'},{id:'other',status:'COMPLETED',output:'{}'},{id:'analysis',status:'COMPLETED',output:'broken JSON'}]){
  const d=draftFixture(),c=client(d);await c.context.generate();await c.context.finishRefinement(job);
  assert.equal(c.requests.length,1);assert.equal(d.pending,null);assert.equal(d.batch,null);assert(c.errors.length>0);
 }
});

test('partially submitted batches resume with their saved prompt without paying to refine again',async()=>{
 const d=draftFixture(),output=finishShootRefinement(d,JSON.stringify(modelOutput(d)));d.refinement={jobId:'saved-analysis',key:shootDirectionKey(d),prompt:output};d.batch={id:crypto.randomUUID(),remaining:['4:5'],jobIds:['first-image']};
 const c=client(validateShoot(d));await c.context.generate();assert.deepEqual(c.errors,[]);assert.equal(c.requests.length,1);assert.equal(c.requests[0].path,'/api/generate');assert.equal(c.requests[0].body.prompt,output);assert.equal(c.requests[0].body.ratio,'4:5');
});

test('new shoots reuse the exact persisted prompt across image settings and get fresh batch IDs',async()=>{
 const original=draftFixture(),output=finishShootRefinement(original,JSON.stringify(modelOutput(original)));
 original.refinement={jobId:'saved-analysis',key:shootDirectionKey(original),prompt:output};
 original.batch={id:crypto.randomUUID(),remaining:[],jobIds:['old-image']};original.jobIds=['old-image'];
 for(const settings of [{},{model:'nano21'},{resolution:'2K'},{ratios:['16:9','9:16']},{count:4},{quality:'high'},{model:'nano21',resolution:'2K',ratios:['16:9'],count:3}]){
  const d=validateShoot({...structuredClone(original),...settings}),c=client(d),previous=d.batch.id;
  c.context.actions.api=async()=>{throw Error('Saved prompt must not need OpenRouter configuration');};
  await c.context.generate();assert.deepEqual(c.errors,[]);assert(c.requests.length>0);
  assert(c.requests.every(r=>r.path==='/api/generate'&&r.body.prompt===output));
  assert(c.requests.every(r=>r.body.model===d.model&&r.body.resolution===d.resolution&&r.body.count===d.count));
  assert.notEqual(d.batch.id,previous);assert(c.requests.every(r=>r.body.shootBatchId===d.batch.id));assert.deepEqual(d.refinement,original.refinement);assert(d.jobIds.includes('old-image'));
  const first=d.batch.id;c.requests.length=0;await c.context.generate();assert.deepEqual(c.errors,[]);assert.notEqual(d.batch.id,first);assert(c.requests.every(r=>r.path==='/api/generate'&&r.body.prompt===output));
 }
});

test('description, active Direction, outfit or replacement reference changes still trigger new refinement',async()=>{
 for(const change of [d=>d.base.environment.setting='A new studio',d=>d.patches['subject.expression']='Laughing',d=>d.keepOutfit=true,d=>d.references.subject=ref('different-character')]){
  const d=draftFixture();d.refinement={jobId:'saved-analysis',key:shootDirectionKey(d),prompt:finishShootRefinement(d,JSON.stringify(modelOutput(d)))};d.batch={id:crypto.randomUUID(),remaining:[],jobIds:[]};change(d);
  const c=client(d);await c.context.generate();assert.deepEqual(c.errors,[]);assert.equal(c.requests.length,1);assert.equal(c.requests[0].path,'/api/llm/generate');assert.equal(d.pending.role,'refine');
 }
});

test('LLM store validates and persists the finalized SHOOT prompt and records its separate usage',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shoot-refine-'));t.after(()=>rm(dir,{recursive:true,force:true}));const d=draftFixture();let calls=0;
 const store=await createLlmStore({directory:dir,requireProject:id=>({id}),fetchImpl:async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(modelOutput(d))},finish_reason:'stop'}],usage:{cost:0.002}});}});
 const receipt=await store.submit(body(d),[image],'dummy-key');let job;
 for(let i=0;i<100;i++){job=store.list('test').jobs[0];if(job.status!=='RUNNING')break;await delay(10);}
 assert.equal(job.id,receipt.id);assert.equal(job.status,'COMPLETED');assert.match(job.output,/rust-orange silk/);assert.equal(job.settings.task,'shoot');assert.equal(job.usage.cost,.002);assert.equal(calls,1);
 await delay(20);const saved=await readFile(join(dir,'llm-jobs.json'),'utf8');assert(!saved.includes('dummy-key'));assert(!saved.includes('data:image'));assert.equal(JSON.parse(saved)[0].output,job.output);
});

 test('separate outfit asset persists, receives its own image role and overrides character clothing',()=>{
 const d=draftFixture();d.useAssetOutfit=true;d.keepOutfit=true;d.references.outfit=ref('wardrobe');
 const saved=validateShoot(d);assert.equal(saved.useAssetOutfit,true);
 assert.deepEqual(shootReferences(saved).map(r=>r.role),['subject','outfit']);
 const request=buildShootRefinement(body(saved),[image,image]);assert.match(request.instruction,/separate outfit reference/);
 const result=JSON.parse(finishShootRefinement(saved,JSON.stringify(modelOutput(saved))));
 assert.match(result.subject.clothing.top,/rust-orange/);assert.equal(result.shoot_direction.references[1].role,'outfit');
 assert.match(result.shoot_direction.references[1].instruction,/Dress the character/);
 const key=shootDirectionKey(saved);saved.references.outfit=ref('another-outfit');assert.notEqual(shootDirectionKey(saved),key);
 saved.enabled=[];assert.equal(shootReferences(saved).length,0);
 saved.enabled=['subject'];saved.subjectKind='product';assert(!shootReferences(saved).some(r=>r.role==='outfit'));
 });
