import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {description} from './fixtures/visual-description.mjs';
import {newShoot,validateShoot,sourceSubjectKind,shootSubjectKind,changeShootSubjectKind,shootSections,sectionFields,compiledShoot,shootReferences,shootPrompt,shootDirectionKey,shootRefinementReady,shootPlans,resetSection} from '../public/shoot-model.js';
import {buildLlmRequest,createLlmStore} from '../llm-store.mjs';
import {buildShootRefinement,finishShootRefinement} from '../shoot-refinement.mjs';
import {finishShootDescription} from '../shoot-description.mjs';
import {createShootStore} from '../shoot-store.mjs';

const ref=id=>({assetId:id,name:id+'.png',contentType:'image/png',width:1200,height:800});
const image={kind:'image',contentType:'image/png',bytes:8,data:'data:image/png;base64,iVBORw0KGgo='};
const product={type:'A rectangular perfume bottle with a black cap',materials:'Clear glass and black lacquer',finish:'Glossy reflective surfaces',color:'Amber liquid and a black cap',details:'A small white label centered on the bottle',orientation:'Upright, turned slightly to camera',placement:'Standing on a stone ledge',size:'Hand-sized bottle, supported by the ledge'};
const location={type:'A modern concrete courtyard',features:'Open courtyard framed by tall walls and an arched opening',materials:'Cast concrete and pale stone',scale:'Full architectural scene with human-scale entrances'};
function base(kind){const d=structuredClone(description);d.subject_kind=kind;if(kind==='product')d.subject=structuredClone(product);else if(kind==='location')d.subject=structuredClone(location);d.scene_description=kind==='character'?'A woman in a boxing ring':kind==='product'?'A perfume bottle on a ledge':'A concrete courtyard in soft light';return d;}
function draft(from,to){const d=newShoot();d.base=base(from);d.references.source=ref('analysis-only');if(to!==from)changeShootSubjectKind(d,to);d.references.subject=ref(to+'-reference');d.enabled=[...new Set([...d.enabled,'subject'])];return d;}
function output(d){const kind=shootSubjectKind(d),out=base(kind);out.scene_description=kind==='character'?'The woman from reference image stands beside a lit window.':kind==='product'?'The amber perfume bottle stands on a ledge in warm light.':'The concrete courtyard fills the frame in warm light.';if(kind==='character'){out.subject.type='The woman from reference image, medium tan skin';out.subject.clothing={top:'A white cotton shirt with a relaxed collar'};out.subject.pose='Standing naturally';out.subject.activity='Standing still';out.subject.expression='A calm expression';}out.reference_descriptions=shootReferences(d).map((r,i)=>({image:i+1,role:r.role,description:kind==='character'?'The woman from reference image, medium tan skin.':kind==='product'?'A clear rectangular amber perfume bottle with a black cap and small white label.':'A concrete courtyard with tall walls, pale stone paving and a broad arched opening.'}));return out;}
const body=d=>({task:'shoot',format:'json',shootDraft:d});

test('description classifies people, packshots, vehicles and places; old drafts remain loadable',()=>{
 for(const kind of ['character','product','location'])assert.equal(sourceSubjectKind(base(kind)),kind);
 for(const [type,kind]of [['A red sports car','product'],['A perfume bottle','product'],['An alpine landscape','location'],['An adult woman beside a car','character']])assert.equal(sourceSubjectKind({subject:{type}}),kind);
 const old=newShoot();delete old.subjectKind;assert.equal(validateShoot(old).subjectKind,'auto');
 assert.throws(()=>validateShoot({...newShoot(),subjectKind:'other'}));
});

test('type-specific descriptions omit human placeholders and pass through the LLM store',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shoot-kind-description-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const kind of ['character','product','location']){
  const source=base(kind),request={projectId:'test',task:'image',shootDescription:true,format:'json',model:newShoot().llmModel,maxTokens:8192};
  const built=buildLlmRequest(request,[image]);assert.equal(built.settings.shootDescription,true);assert.equal(built.payload.response_format.type,'json_object');assert.match(built.payload.messages[1].content[0].text,/subject_kind/);
  const store=await createLlmStore({directory:dir,requireProject:id=>({id}),fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(source)},finish_reason:'stop'}]})});
  const receipt=await store.submit(request,[image],'test-key');let job;
  for(let i=0;i<100;i++){job=store.list('test').jobs.find(j=>j.id===receipt.id);if(job.status!=='RUNNING')break;await delay(10);}
  assert.equal(job.status,'COMPLETED',job.error);assert.equal(JSON.parse(job.output).subject_kind,kind);
 }
 const invalid=base('product');delete invalid.subject.materials;assert.throws(()=>finishShootDescription(JSON.stringify(invalid)),/missing details/);
 const clean=base('location');clean.subject.expression='Not applicable';assert(!('expression' in JSON.parse(finishShootDescription(JSON.stringify(clean))).subject));
});

test('switching type clears incompatible edits and the old reference, retains source, style and history',()=>{
 const d=draft('character','character');d.enabled.push('action','style');d.patches={'subject.expression':'Smiling','subject.hair':'Short hair','subject.pose':'Waving','lighting.style':'Window light'};d.jobIds=['old-result'];
 changeShootSubjectKind(d,'product');assert.equal(d.references.subject,undefined);assert.equal(d.references.source.assetId,'analysis-only');assert.deepEqual(d.patches,{'lighting.style':'Window light'});assert.deepEqual(d.jobIds,['old-result']);
 assert.throws(()=>shootPlans(d),/Add a product reference/);
 const paths=sectionFields(d,'subject').map(f=>f.path);assert.deepEqual(paths,['subject.materials','subject.finish','subject.color','subject.details']);
 assert(sectionFields(d,'action').some(f=>f.path==='subject.size'));assert(!sectionFields(d,'action').some(f=>f.path==='subject.pose'));
 assert.equal(shootSections(d).find(s=>s.id==='action').name,'Placement & action');
 d.references.subject=ref('perfume');d.enabled.push('location');d.references.location=ref('old-place');d.patches['environment.setting']='Old location override';
 changeShootSubjectKind(d,'location');assert(!d.enabled.includes('location'));assert.equal(d.patches['environment.setting'],undefined);
 assert(!shootSections(d).find(s=>s.id==='location').reference);assert.deepEqual(sectionFields(d,'subject').map(f=>f.path),['subject.features','subject.materials','subject.scale']);
});

test('every cross-type replacement produces appropriate fields, ordered references and a consistent final type',()=>{
 for(const from of ['character','product','location'])for(const to of ['character','product','location']){
  const d=draft(from,to),original=structuredClone(d.base),request=buildShootRefinement(body(d),[image]);
  assert.match(request.instruction,new RegExp('MAIN SUBJECT TYPE: '+to));assert.deepEqual(shootReferences(d).map(r=>r.assetId),[to+'-reference']);
  if(from!==to){assert.match(request.instruction,new RegExp('from '+from+' to '+to));const compiled=compiledShoot(d);assert.deepEqual(compiled.key_details,[]);assert.deepEqual(compiled.negative_elements,[]);assert.equal(compiled.composition.camera_angle,original.composition.camera_angle);}
  const modelOutput=output(d);if(to!=='character'){modelOutput.subject.expression='Old smile';modelOutput.subject.hair='Old hair';modelOutput.subject.clothing={top:'Old coat'};}
  const final=JSON.parse(finishShootRefinement(d,JSON.stringify(modelOutput)));assert.equal(final.subject_kind,to);assert.deepEqual(d.base,original);assert.equal(final.shoot_direction.references[0].image,1);
  if(to!=='character')for(const field of ['expression','hair','clothing','pose','activity'])assert(!Object.hasOwn(final.subject,field));
  if(from!==to&&to==='character'){assert.equal(final.subject.pose,'Standing naturally');assert.equal(final.subject.expression,'A calm expression');assert.match(final.subject.clothing.top,/cotton/);}
 }
});

test('product and location overrides reinforce references without inheriting hidden character edits',()=>{
 for(const kind of ['product','location']){
  const d=draft('character',kind);d.patches={'subject.expression':'UNWANTED','subject.hair':'UNWANTED','subject.materials':'Brushed aluminum'};d.enabled.push('action');if(kind==='product')d.patches['subject.size']='A full-size car, four meters long';
  assert(!shootPrompt(d).includes('UNWANTED'));const final=JSON.parse(finishShootRefinement(d,JSON.stringify(output(d))));assert.equal(final.subject.materials,'Brushed aluminum');if(kind==='product')assert.equal(final.subject.size,'A full-size car, four meters long');
  d.patches['subject.materials']='';assert.equal(JSON.parse(finishShootRefinement(d,JSON.stringify(output(d)))).subject.materials,kind==='product'?product.materials:location.materials);
  const wrong=output(d);wrong.subject_kind='character';assert.throws(()=>finishShootRefinement(d,JSON.stringify(wrong)),/wrong main subject type/);
  const optional=output(d);delete optional.subject.materials;assert.doesNotThrow(()=>finishShootRefinement(d,JSON.stringify(optional)));
  const incomplete=output(d);delete incomplete.subject.type;assert.throws(()=>finishShootRefinement(d,JSON.stringify(incomplete)),/identity/);
 }
});

test('a main location excludes a competing background reference; character and product keep separate location support',()=>{
 for(const kind of ['character','product','location']){
  const d=draft('character',kind);d.enabled.push('product','location');d.references.product=ref('extra');d.references.location=ref('background');
  assert.deepEqual(shootReferences(d).map(r=>r.role),kind==='location'?['subject','product']:kind==='product'?['subject','location']:['subject','product','location']);
 }
});

test('product refinement accepts optional omissions and structured visible details without inventing values',()=>{
 const d=draft('character','product'),out=output(d);
 out.subject={type:product.type,materials:['Glass','Black lacquer'],details:{label:{color:'White',position:'Centered'},cap:'Rectangular'}};
 const before=structuredClone(d.base),final=JSON.parse(finishShootRefinement(d,JSON.stringify(out)));
 assert.deepEqual(final.subject,out.subject);assert.deepEqual(d.base,before);
 assert.equal(final.subject.size,undefined);assert.equal(final.subject.finish,undefined);
 assert.match(buildShootRefinement(body(d),[image]).instruction,/Omit optional properties/);
 // Some provider responses put all concrete detail in the reference analysis.
 out.subject={type:product.type};const fallback=JSON.parse(finishShootRefinement(d,JSON.stringify(out)));
 assert.equal(fallback.subject.details,out.reference_descriptions[0].description);
 d.patches['subject.materials']='Brushed aluminum';
 assert.equal(JSON.parse(finishShootRefinement(d,JSON.stringify(out))).subject.materials,'Brushed aluminum');
});

test('flexible product fields do not accept absent identity, missing analysis or mismatched references',()=>{
 const d=draft('character','product');
 for(const corrupt of [r=>r.subject={},r=>r.subject.type='',r=>r.reference_descriptions=[],r=>r.reference_descriptions[0].role='product',r=>r.reference_descriptions[0].image=2,r=>r.reference_descriptions[0].description='Bottle']){
  const out=output(d);corrupt(out);assert.throws(()=>finishShootRefinement(d,JSON.stringify(out)),/No images were submitted/);
 }
 const noRef=draft('product','product');noRef.enabled=[];
 const empty=output(noRef);empty.subject={type:'A bottle',materials:[],details:{},finish:null};
 assert.throws(()=>finishShootRefinement(noRef,JSON.stringify(empty)),/visual description/);
});

test('Product hides additional product and ignores its saved edits and image, retaining them for switch-back',()=>{
 const d=draft('character','product');d.enabled.push('product','location');
 d.references.product=ref('hidden-extra');d.references.location=ref('background');d.patches['product.description']='HIDDEN EXTRA OBJECT';
 const reopened=validateShoot(d),before=structuredClone(reopened);
 assert(!shootSections(reopened).some(s=>s.id==='product'));assert.equal(shootSections(reopened).length,5);
 assert(!shootPrompt(reopened).includes('HIDDEN EXTRA OBJECT'));assert.equal(compiledShoot(reopened).product,undefined);
 const refs=shootReferences(reopened);assert.deepEqual(refs.map(r=>r.assetId),['product-reference','background']);
 assert.deepEqual(JSON.parse(shootPrompt(reopened)).shoot_direction.references.map(r=>[r.image,r.role]),[[1,'subject'],[2,'location']]);
 assert.doesNotThrow(()=>buildShootRefinement(body(reopened),[image,image]));
 const key=shootDirectionKey(reopened);reopened.patches['product.description']='ANOTHER HIDDEN OBJECT';assert.equal(shootDirectionKey(reopened),key);
 assert.deepEqual(reopened.references,before.references);
 changeShootSubjectKind(reopened,'character');assert(shootSections(reopened).some(s=>s.id==='product'));assert(shootReferences(reopened).some(r=>r.assetId==='hidden-extra'));
});

test('a product image with nested details completes refinement in the LLM store in one request',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shoot-product-refine-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const d=draft('character','product'),out=output(d);let calls=0;
 out.subject={type:product.type,color:['Amber','Black'],details:{cap:'Black lacquer',bottle:'Transparent rectangular glass'}};
 const store=await createLlmStore({directory:dir,requireProject:id=>({id}),fetchImpl:async(url,options)=>{
  calls++;const request=JSON.parse(options.body);assert.equal(request.messages[1].content.filter(part=>part.type==='image_url').length,1);
  return Response.json({choices:[{message:{content:JSON.stringify(out)},finish_reason:'stop'}]});
 }});
 const receipt=await store.submit({...body(d),projectId:'test',model:d.llmModel,maxTokens:16384},[image],'test-key');let job;
 for(let i=0;i<100;i++){job=store.list('test').jobs.find(j=>j.id===receipt.id);if(job.status!=='RUNNING')break;await delay(10);}
 assert.equal(job.status,'COMPLETED',job.error);assert.equal(calls,1);assert.deepEqual(JSON.parse(job.output).subject,out.subject);
 assert.equal(JSON.parse(job.output).shoot_direction.references[0].role,'subject');
});

test('typed direction persists and image settings reuse its refined prompt; restoring returns original type',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shoot-type-draft-'));t.after(()=>rm(dir,{recursive:true,force:true}));let store=await createShootStore(dir,id=>({id}));
 const d=draft('character','product');d.refinement={jobId:'refined',key:shootDirectionKey(d),prompt:finishShootRefinement(d,JSON.stringify(output(d)))};await store.save({projectId:'test',revision:0,draft:d});
 store=await createShootStore(dir,id=>({id}));const reopened=store.load('test').draft;assert.equal(shootSubjectKind(reopened),'product');assert(shootRefinementReady(reopened));
 for(const settings of [{model:'nano21'},{resolution:'2K'},{ratios:['16:9']},{count:4}])assert(shootRefinementReady({...reopened,...settings}));
 const before=structuredClone(d.base);resetSection(d,'subject');assert.equal(shootSubjectKind(d),'character');assert.equal(d.references.subject,undefined);assert.deepEqual(d.base,before);assert(!shootRefinementReady(d));
});
