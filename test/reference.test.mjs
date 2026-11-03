import {test} from 'node:test';
import assert from 'node:assert/strict';
import {characterSheetPrompt} from '../public/reference-model.js';
import {MODELS,buildInput} from '../public/models.js';
test('Character sheet numbers identity, outfit and template independently for one to eight photos',()=>{
 for(let count=1;count<=8;count++)for(const outfit of [false,true]){
  const prompt=characterSheetPrompt({count,outfit,wardrobe:'White shirt, blue jeans.',outfitDescription:'Black jacket.'});
  assert(prompt.includes(`Images 1 through ${count}`));
  assert(prompt.includes(`Image ${count+(outfit?2:1)} is the layout template ONLY`));
  assert(prompt.includes(outfit?`Image ${count+1} defines ONLY the outfit`:'White shirt, blue jeans.'));
  assert(!prompt.includes(outfit?'White shirt, blue jeans.':'Black jacket.'));
  assert.match(prompt,/Entirely text-free/);assert.match(prompt,/Column 4: two equal stacked panels/);
 }
 assert.throws(()=>characterSheetPrompt({count:0,wardrobe:'shirt'}),/one to eight/);
 assert.throws(()=>characterSheetPrompt({count:9,wardrobe:'shirt'}),/one to eight/);
 assert.throws(()=>characterSheetPrompt({count:1}),/Describe the outfit/);
});
test('character sheet model choices accept six images at 16:9 in both resolutions',()=>{
 const models=MODELS.filter(m=>m.mode==='image'&&m.inputs.includes('image')&&m.maxImages>=6&&m.ratios.includes('16:9')&&['1K','2K'].every(r=>m.resolutions.includes(r)));
 assert(models.some(m=>m.id==='seedream5-pro'));
 const refs=Array.from({length:6},()=>({kind:'image',contentType:'image/png',bytes:100,data:'data:image/png;base64,aGVsbG8=',metadata:{width:1000,height:1000}}));
 for(const m of models)for(const resolution of ['1K','2K']){
  const prompt=characterSheetPrompt({count:4,outfit:true,outfitDescription:'Jacket and trousers.'});
  const result=buildInput({model:m.id,inputType:'image',prompt,ratio:'16:9',resolution,count:1},refs);
  assert.equal(result.input.prompt,prompt);
 }
});

test('requested character description uses the existing plain-text tool and fills the sheet direction',async()=>{
 const {ReferenceWorkspace}=await import('../public/reference.js');
 const previous=globalThis.document;const fields={'#character-llm':{value:'test-model'},'#character-subject':{value:''}};
 globalThis.document={querySelector:selector=>fields[selector]};
 const calls=[],deleted=[];let saved=false;
 const workspace={images:[{id:'a'},{id:'b'}],project:'project',status:()=>{},stage:async image=>'upload-'+image.id,save:()=>{saved=true;},actions:{post:async(path,body)=>{calls.push({path,body});return {job:{id:'analysis'}};},api:async(path,options)=>{if(options?.method==='DELETE'){deleted.push(path);return {};}return {jobs:[{id:'analysis',status:'COMPLETED',output:'Short curly hair, rounded face and a slender build.'}]};}}};
 try{await ReferenceWorkspace.prototype.analyzeCharacter.call(workspace);
 assert.equal(calls[0].body.task,'image');assert.equal(calls[0].body.format,'text');assert.deepEqual(calls[0].body.referenceIds,['upload-a','upload-b']);
 assert.match(calls[0].body.instruction,/No JSON/);assert.equal(fields['#character-subject'].value,'Short curly hair, rounded face and a slender build.');assert(saved);assert.equal(deleted.length,2);
 }finally{globalThis.document=previous;}
});

test('ID audience comes from character identity, not outfit text',async()=>{
 const {referenceAudience}=await import('../public/reference-model.js');
 assert.equal(referenceAudience({settings:{prompt:characterSheetPrompt({count:1,subject:'A woman with dark hair.',wardrobe:'Menswear jacket.'})}}),'women');
 assert.equal(referenceAudience({settings:{prompt:characterSheetPrompt({count:1,subject:'A man with short hair.',wardrobe:'Feminine clothing.'})}}),'men');
 assert.equal(referenceAudience({settings:{prompt:characterSheetPrompt({count:1,wardrobe:'Woman outfit.'})}}),'neutral');
});

test('product sheets use six views, ordered references and no wardrobe',async()=>{
 const {productSheetPrompt,referenceDescriptionInstruction}=await import('../public/reference-model.js');
 for(let count=1;count<=4;count++){
  const prompt=productSheetPrompt({count,subject:'A blue-grey four-door SUV.'});
  assert(prompt.includes(`Image ${count+1} is the layout template ONLY`));
  assert.match(prompt,/three-column, two-row/);assert.match(prompt,/6. Detail close-up/);assert.match(prompt,/A blue-grey four-door SUV/);
  assert(!prompt.includes('WARDROBE'));assert(!prompt.includes('headshot'));
  for(const resolution of ['1K','2K'])assert.equal(buildInput({model:'nano-pro',inputType:'image',prompt,ratio:'16:9',resolution,count:1},Array.from({length:count+1},()=>({kind:'image',contentType:'image/png',bytes:100,data:'data:image/png;base64,aGVsbG8=',metadata:{width:1000,height:1000}}))).input.prompt,prompt);
 }
 assert.throws(()=>productSheetPrompt({count:5}),/one to four/);
 assert.match(referenceDescriptionInstruction('product'),/No JSON/);assert.match(referenceDescriptionInstruction('product'),/materials/);
 const {ReferenceWorkspace}=await import('../public/reference.js');
 assert.notEqual(ReferenceWorkspace.prototype.draftKey.call({project:'p',type:'product'}),ReferenceWorkspace.prototype.draftKey.call({project:'p',type:'character'}));
});

test('environment sheet preserves location geography in six views without product or wardrobe directions',async()=>{
 const {environmentSheetPrompt,referenceDescriptionInstruction}=await import('../public/reference-model.js');
 for(let count=1;count<=4;count++){
  const prompt=environmentSheetPrompt({count,subject:'A sunlit living room with oak flooring.'});
  assert(prompt.includes(`Image ${count+1} is the layout template ONLY`));
  for(const view of ['Wide master','Reverse angle','Left three-quarter','Right three-quarter','Overhead / plan','Ground or floor'])assert(prompt.includes(view));
  assert.match(prompt,/one continuous, physically coherent location/);
  assert.match(prompt,/blank grey panels are placeholders/);assert(!prompt.includes('WARDROBE'));
  for(const resolution of ['1K','2K'])assert.equal(buildInput({model:'nano-pro',inputType:'image',prompt,ratio:'16:9',resolution,count:1},Array.from({length:count+1},()=>({kind:'image',contentType:'image/png',bytes:100,data:'data:image/png;base64,aGVsbG8=',metadata:{width:1000,height:1000}}))).input.prompt,prompt);
 }
 assert.throws(()=>environmentSheetPrompt({count:0}),/one to four/);
 assert.match(referenceDescriptionInstruction('environment'),/No JSON/);
 assert.match(referenceDescriptionInstruction('environment'),/spatial layout/);
});

test('character special direction combines editable presets and applies across both wardrobe paths',async()=>{
 const {appendCharacterDirection,CHARACTER_DIRECTION_PRESETS}=await import('../public/reference-model.js');
 let direction=appendCharacterDirection('Keep the hair tied back.','soaked');direction=appendCharacterDirection(direction,'dirty');
 assert.match(direction,/Keep the hair tied back/);assert.match(direction,/rain-soaked/);assert.match(direction,/mud/);
 assert.equal(appendCharacterDirection(direction,'soaked'),direction);
 for(const outfit of [false,true]){
  const prompt=characterSheetPrompt({count:2,wardrobe:'Blue jacket.',outfit,outfitDescription:'Blue jacket.',direction});
  assert.match(prompt,/SPECIAL DIRECTION/);assert(prompt.includes(direction));assert.match(prompt,/across all five views, including portraits/);
 }
 assert(!characterSheetPrompt({count:1,wardrobe:'Jacket.'}).includes('SPECIAL DIRECTION'));
 assert.match(CHARACTER_DIRECTION_PRESETS.find(p=>p.id==='battle').text,/blood stains/);
});

test('reference uploads retain earlier images, accept eight together and reject a ninth',async()=>{
 const {ReferenceWorkspace}=await import('../public/reference.js');
 const previousDocument=globalThis.document,previousBitmap=globalThis.createImageBitmap;
 const fields={'#character-files':{files:[],value:''},'#character-subject':{value:''}};
 globalThis.document={querySelector:s=>fields[s]};globalThis.createImageBitmap=async()=>({width:800,height:1200,close(){}});
 let counter=0,analyses=0;const workspace={type:'character',busy:false,project:'p',images:[],lock(value){this.busy=value;},status(){},save(){},render(){},analyzeCharacter:async()=>{analyses++;},actions:{api:async()=>({asset:{id:String(++counter),name:'photo.png'}})}};
 const file={type:'image/png',size:100,name:'photo.png'};
 try{
  await ReferenceWorkspace.prototype.upload.call(workspace,[file]);
  const first=workspace.images[0].id;
  await ReferenceWorkspace.prototype.upload.call(workspace,Array(7).fill(file));
  assert.equal(workspace.images.length,8);assert.equal(workspace.images[0].id,first);assert.equal(analyses,0);
  await ReferenceWorkspace.prototype.upload.call(workspace,[file]);assert.equal(workspace.images.length,8);assert.equal(counter,8);
  workspace.images=[];await ReferenceWorkspace.prototype.upload.call(workspace,Array(8).fill(file));assert.equal(workspace.images.length,8);assert.equal(analyses,0);
  await ReferenceWorkspace.prototype.describeCharacter.call(workspace);assert.equal(analyses,1);
 }finally{globalThis.document=previousDocument;globalThis.createImageBitmap=previousBitmap;}
});

test('no-head checkbox changes only the front body panel in either wardrobe mode',()=>{
 for(const outfit of [false,true]){
  const options={count:2,wardrobe:'Blue jacket.',outfit,outfitDescription:'Blue jacket.'};
  const normal=characterSheetPrompt(options),cropped=characterSheetPrompt({...options,noHeadFront:true});
  assert.match(normal,/Column 1: front full body, head to toe/);
  assert.match(cropped,/entire head, face and hair must be outside the top edge/);
  assert.match(cropped,/natural photographic cropping/);
  assert.match(cropped,/ONLY to the front body view in column 1/);
  assert.match(cropped,/Column 2: back full body, head to toe/);
  assert.match(cropped,/Keep the head visible in the back full-body view/);
 }
});

test('makeup and hair directions reach both wardrobe workflows alongside distress',async()=>{
 const {CHARACTER_MAKEUP_PRESETS:makeup,CHARACTER_HAIR_PRESETS:hair}=await import('../public/reference-model.js');
 for(const outfit of [false,true])for(const m of makeup)for(const h of hair){
  const prompt=characterSheetPrompt({count:2,outfit,wardrobe:'Blue suit.',outfitDescription:'Blue suit.',makeup:m.text,hair:h.text,direction:'Wet skin and clothing.',noHeadFront:true});
  assert(prompt.includes('\nMAKEUP\n'+m.text));assert(prompt.includes('\nHAIR\n'+h.text));
  assert(prompt.includes('Wet skin and clothing.'));assert(prompt.includes('front body view, framed from the base of the neck'));
 }
 const plain=characterSheetPrompt({count:1,wardrobe:'Blue suit.'});
 assert(!plain.includes('\nMAKEUP\n'));assert(!plain.includes('\nHAIR\n'));
});

test('character draft saves makeup and hair independently of existing distress',async()=>{
 const {ReferenceWorkspace}=await import('../public/reference.js');
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage;
 let saved;globalThis.document={querySelector:s=>({value:({'#character-makeup':'Soft makeup','#character-hair':'Ponytail','#character-direction':'Soaked'})[s]||'',checked:false})};
 globalThis.localStorage={setItem:(key,value)=>{saved=JSON.parse(value);}};
 try{ReferenceWorkspace.prototype.save.call({project:'p',images:[],draftKey:()=> 'draft'});assert.equal(saved.makeup,'Soft makeup');assert.equal(saved.hair,'Ponytail');assert.equal(saved.direction,'Soaked');}
 finally{globalThis.document=oldDocument;globalThis.localStorage=oldStorage;}
});

test('sheet estimate counts the template and optional outfit as references',async()=>{
 const {referenceSheetCost}=await import('../public/reference.js');
 const base=referenceSheetCost('seedream5-pro','1K',[{}]);
 const outfit=referenceSheetCost('seedream5-pro','1K',[{}],{});
 assert(base.available&&outfit.available);assert(Math.abs(outfit.minimum-base.minimum-.0045)<1e-8);
 assert.equal(referenceSheetCost('nano-pro','1K',[{}]).minimum,.15);
 assert(referenceSheetCost('krea2-large','Native',Array(8).fill({}),{}).available);
 assert(!referenceSheetCost('nano-pro','1K',Array(8).fill({}),{}).available);
 assert(referenceSheetCost('nano21','1K',[{}]).extraUsage);
});
