import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creatorDefinition,creatorPrompt,CREATOR_FIELDS} from '../public/creator-model.js';
import {buildInput,MODELS} from '../public/models.js';
test('creator builds valid JSON for text and up to two reference images',()=>{
 for(const count of [0,1,2]){const d={gender:'Female',ethnicity:'Arab',body:'Athletic / fit',chest:'Medium',glutes:'Large',eyes:'Green',hair:'Curly',age:28,height:170,weight:65,details:'Freckles and a healed cheek scar.',idea:'A mountain guide.'};const prompt=JSON.parse(creatorPrompt(d,count));assert.equal(prompt.subject.ethnicity,'Arab');assert.equal(prompt.subject.height_cm,170);assert.equal(prompt.subject.weight_kg,65);assert(prompt.subject.details.includes('Freckles'));assert(count?prompt.reference_direction.includes(`${count} supplied`):prompt.reference_direction.includes('fictional'));}
 assert.throws(()=>creatorPrompt({},3));assert.throws(()=>creatorDefinition({age:12}));assert.throws(()=>creatorDefinition({height:'invalid'}));assert.throws(()=>creatorDefinition({gender:'invalid'}));assert.throws(()=>creatorDefinition({details:'x'.repeat(4001)}));
});
test('every appearance preset serializes and all creator models accept zero or two refs',()=>{
 for(const [key,field] of Object.entries(CREATOR_FIELDS))for(const value of field.options)assert.equal(JSON.parse(creatorPrompt({[key]:value})).subject[key],value);
 for(const m of MODELS.filter(m=>m.available&&m.mode==='image'&&m.inputs.includes('text')&&m.inputs.includes('image')&&m.maxImages>=2))for(const count of [0,2]){
 const refs=Array.from({length:count},()=>({kind:'image',data:'data:image/png;base64,AA==',contentType:'image/png',bytes:10,metadata:{width:1024,height:1024}}));
 const r=buildInput({model:m.id,inputType:count?'image':'text',prompt:creatorPrompt({},count),ratio:m.ratios.includes('3:4')?'3:4':m.ratios[0],resolution:m.resolutions[0],count:1,quality:'high'},refs);assert(r.input.prompt.includes('Generate one photorealistic adult'));
 }
});
test('server creates and retains creator workflow from validated settings with no paid requests',async t=>{
 const {createStudio}=await import('../server.mjs');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'creator-api-'));let calls=0;
 const studio=await createStudio({dataDir:dir,key:'test-key',keyFile:null,openRouterKeyFile:null,openRouterKey:'',autoArchive:false,pollMs:3600000,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({request_id:'creator-test-request',status:'IN_QUEUE'}),{headers:{'Content-Type':'application/json'}});}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>studio.server.close(r));await studio.save();await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+studio.server.address().port,boot=await(await fetch(base+'/api/bootstrap')).json();
 const body={model:'nano-pro',inputType:'text',workflow:'creator',creator:{gender:'Male',eyes:'Brown',name:'Test character'},prompt:'ignored',ratio:'3:4',resolution:'1K',count:1,referenceIds:[]};
 const post=body=>fetch(base+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.csrf},body:JSON.stringify(body)});
 const invalid=await post({...body,creator:{age:12}});assert.equal(invalid.status,400);assert.equal(calls,0);
 const response=await post(body);assert.equal(response.status,202);const {job}=await response.json();assert.equal(job.settings.workflow,'creator');assert.equal(job.settings.creator.gender,'Male');assert.equal(JSON.parse(job.settings.prompt).subject.eyes,'Brown');
});

test('six fixed views use two square headshots and four portrait shots',async()=>{
 const {CREATOR_VIEWS}=await import('../public/creator-model.js');
 assert.equal(CREATOR_VIEWS.length,6);assert.deepEqual(CREATOR_VIEWS.map(v=>v.ratio),['1:1','1:1','3:4','3:4','3:4','3:4']);
 for(const view of CREATOR_VIEWS){const p=JSON.parse(creatorPrompt({framing:'Full body',name:'Lola'},0,view.id));assert.equal(p.framing,view.direction);assert.equal(p.aspect_ratio,view.ratio);assert(p.title.includes(view.label));assert(!('framing' in p.subject));}
 assert.throws(()=>creatorPrompt({},0,'unknown'));
});

test('creator submits six distinct requests with fixed ratios and selected model/resolution',async()=>{
 const {CharacterCreator}=await import('../public/creator.js');const original=globalThis.document;globalThis.document={querySelector:()=>({textContent:''})};
 const requests=[],jobs=[];const workspace={busy:false,images:[],project:'default',values:()=>({model:'nano-pro',resolution:'2K',gender:'Female'}),lock(){},save(){},status(){},actions:{post:async(path,body)=>{requests.push(body);return {job:{id:String(requests.length)}};},submitted:job=>jobs.push(job)}};
 try{await CharacterCreator.prototype.generate.call(workspace);assert.equal(jobs.length,6);assert.deepEqual(requests.map(r=>r.ratio),['1:1','1:1','3:4','3:4','3:4','3:4']);assert.equal(new Set(requests.map(r=>r.creatorView)).size,6);assert(requests.every(r=>r.count===1&&r.model==='nano-pro'&&r.resolution==='2K'&&r.inputType==='text'));}finally{globalThis.document=original;}
});

test('female creator outfit is fixed across six views and ignores legacy clothing',async()=>{
 const {CREATOR_VIEWS}=await import('../public/creator-model.js');
 for(const view of CREATOR_VIEWS){const p=JSON.parse(creatorPrompt({gender:'Female',clothing:'Black boots and jacket'},2,view.id));assert.match(p.subject.clothing,/beige crop top/);assert.match(p.subject.clothing,/beige fitted cotton shorts/);assert.match(p.subject.clothing,/Barefoot/);assert(!p.subject.clothing.includes('boots'));assert.match(p.presentation,/overrides clothing in reference images/);}
 assert.equal(creatorDefinition({gender:'Male',clothing:'Old draft'}).clothing,'Simple fitted opaque T-shirt, trousers and shoes.');
});

 test('Krea uses square headshots and 4:5 portraits in prompt and provider input',async()=>{
 const {CREATOR_VIEWS,creatorViewRatio}=await import('../public/creator-model.js');
 for(const m of MODELS.filter(m=>m.family==='krea'))for(const view of CREATOR_VIEWS){
 const ratio=creatorViewRatio(view.id,m.family),prompt=creatorPrompt({},0,view.id,m.family);
 assert.equal(ratio,view.id.startsWith('head-')?'1:1':'4:5');
 assert.equal(JSON.parse(prompt).aspect_ratio,ratio);
 assert.equal(buildInput({model:m.id,inputType:'text',prompt,ratio,resolution:'Native',count:1},[]).input.aspect_ratio,ratio);
 }
 });

test('uploaded wardrobe stays separate from zero to two character references in every view',async()=>{
 const {CREATOR_VIEWS}=await import('../public/creator-model.js');
 for(const count of [0,1,2])for(const view of CREATOR_VIEWS){const p=JSON.parse(creatorPrompt({gender:'Female'},count,view.id,undefined,true));assert.match(p.subject.clothing,new RegExp('image '+(count+1)));assert.match(p.outfit_reference,/wardrobe only/);assert(!p.subject.clothing.includes('beige crop top'));assert.match(p.presentation,/seamless medium-grey/);}
});

test('single-view buttons submit only the requested view and reject invalid views',async()=>{
 const {CharacterCreator}=await import('../public/creator.js');const {CREATOR_VIEWS}=await import('../public/creator-model.js');
 const requests=[];const workspace={busy:false,images:[],project:'default',values:()=>({model:'krea2-large',resolution:'Native',gender:'Female'}),lock(){},save(){},status(){},actions:{post:async(path,body)=>{requests.push(body);return {job:{id:'one'}};},submitted(){}}};
 for(const view of CREATOR_VIEWS){requests.length=0;await CharacterCreator.prototype.generate.call(workspace,view.id);assert.equal(requests.length,1);assert.equal(requests[0].creatorView,view.id);assert.equal(requests[0].ratio,view.id.startsWith('head-')?'1:1':'4:5');}
 requests.length=0;await CharacterCreator.prototype.generate.call(workspace,'invalid');assert.equal(requests.length,0);
});

test('creator prices all six views and accounts for reference and resolution changes',async()=>{
 const {creatorCosts}=await import('../public/creator.js');
 const total=rows=>rows.reduce((sum,r)=>sum+r.minimum,0);
 const nano=creatorCosts({model:'nano-pro',resolution:'1K'});assert.equal(nano.length,6);assert(nano.every(r=>r.available));assert(Math.abs(total(nano)-.9)<1e-8);
 assert(Math.abs(total(creatorCosts({model:'nano-pro',resolution:'4K'}))-1.8)<1e-8);
 const text=creatorCosts({model:'krea2-large',resolution:'Native'}),image=creatorCosts({model:'krea2-large',resolution:'Native'},[{width:800,height:1000}]);assert(total(image)>total(text));assert(image.every(r=>r.available));
 const seed=refs=>total(creatorCosts({model:'seedream5-pro',resolution:'1K'},refs));assert(seed([{},{},{}])>seed([{}]));
 assert(creatorCosts({model:'nano21',resolution:'1K'}).every(r=>r.extraUsage));
});

test('view toggles only select; submit generates the selected subset and empty selection submits nothing',async()=>{
 const {CharacterCreator}=await import('../public/creator.js');const requests=[];
 const workspace={busy:false,selectedViews:[],images:[],project:'default',values:()=>({model:'nano-pro',resolution:'1K'}),lock(){},save(){},renderCost(){},status(){},actions:{post:async(path,body)=>{requests.push(body);return {job:{id:'test'}};},submitted(){}}};
 CharacterCreator.prototype.toggleView.call(workspace,'head-front');CharacterCreator.prototype.toggleView.call(workspace,'body-back');assert.equal(requests.length,0);assert.deepEqual(workspace.selectedViews,['head-front','body-back']);
 await CharacterCreator.prototype.generate.call(workspace);assert.deepEqual(requests.map(r=>r.creatorView),['head-front','body-back']);
 CharacterCreator.prototype.toggleView.call(workspace,'head-front');CharacterCreator.prototype.toggleView.call(workspace,'body-back');requests.length=0;await CharacterCreator.prototype.generate.call(workspace);assert.equal(requests.length,0);
});

test('selection updates displayed price, count and empty-selection disabled state',async()=>{
 const {CharacterCreator}=await import('../public/creator.js');const original=globalThis.document;const elements=new Map();
 globalThis.document={querySelector:s=>{if(!elements.has(s))elements.set(s,{querySelector(){return null;}});return elements.get(s);}};
 const workspace={images:[],selectedViews:['head-front','body-back'],values:()=>({model:'nano-pro',resolution:'1K'})};
 try{CharacterCreator.prototype.renderCost.call(workspace);assert.equal(elements.get('#creator-cost-amount').textContent,'≈$0.30');assert.equal(elements.get('#creator-generate-label').textContent,'Generate 2 views');assert.equal(elements.get('#creator-generate').disabled,false);workspace.selectedViews=[];CharacterCreator.prototype.renderCost.call(workspace);assert.equal(elements.get('#creator-cost-amount').textContent,'≈$0.00');assert.equal(elements.get('#creator-generate').disabled,true);}finally{globalThis.document=original;}
});

test('back view never turns to expose prompted facial details',()=>{
 const p=JSON.parse(creatorPrompt({eyes:'Green',face:'Freckles'},0,'body-back'));
 assert.match(p.framing,/no head turn/);assert.match(p.framing,/no face, eyes, nose, mouth or facial profile/);assert.match(p.rear_view_priority,/must not be rendered/);
 assert.equal(JSON.parse(creatorPrompt({},0,'head-front')).rear_view_priority,undefined);
});

test('face description uses character references only and remains editable prompt guidance',async()=>{
 const {CharacterCreator}=await import('../public/creator.js');const previousDocument=globalThis.document,previousFetch=globalThis.fetch;const fields={'#creator-description-model':{value:'test-model'},'#creator-faceDescription':{value:''},'#creator-age':{value:''},'#creator-hair':{value:''},'#creator-face':{value:''}};globalThis.document={querySelector:s=>fields[s]};globalThis.fetch=async()=>({ok:true,blob:async()=>new Blob(['image'],{type:'image/png'})});
 const calls=[],removed=[];const workspace={images:[{id:'face',name:'Face.png',contentType:'image/png',width:100,height:100}],outfit:{id:'outfit'},project:'p',lock(){},status(){},save(){},actions:{api:async(path,options)=>{if(options?.method==='POST')return {id:'ref'};if(options?.method==='DELETE'){removed.push(path);return {};}return {jobs:[{id:'description',status:'COMPLETED',output:JSON.stringify({description:'Oval face with freckles and arched eyebrows.',age:28,hair:'Wavy',eyes:null,face:'Freckles'})}]};},post:async(path,body)=>{calls.push(body);return {job:{id:'description'}};}}};
 try{await CharacterCreator.prototype.describeFace.call(workspace);assert.deepEqual(calls[0].referenceIds,['ref']);assert.equal(calls[0].format,'text');assert.equal(calls[0].model,'openai/gpt-5.6-sol');const {buildLlmRequest}=await import('../llm-store.mjs');assert.doesNotThrow(()=>buildLlmRequest(calls[0],[{kind:'image',contentType:'image/png',bytes:5,data:'data:image/png;base64,AA=='}]));assert.equal(removed.length,1);const description=fields['#creator-faceDescription'].value;assert.match(description,/Oval face/);assert.equal(JSON.parse(creatorPrompt({faceDescription:description})).subject.faceDescription,description);}finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('Describe face shows local feedback and sends no request without photos',async()=>{const {CharacterCreator}=await import('../public/creator.js');const previous=globalThis.document,feedback={};globalThis.document={querySelector:()=>feedback};try{await CharacterCreator.prototype.describeFace.call({images:[],busy:false,status(){},actions:{post(){throw Error('Must not call provider');}}});assert.match(feedback.textContent,/Add a character photo/);}finally{globalThis.document=previous;}});

test('face autofill accepts visible traits and approximate adult age, never sensitive or body fields',async()=>{const {parseFaceAnalysis}=await import('../public/creator-model.js');assert.deepEqual(parseFaceAnalysis(JSON.stringify({description:'Visible face.',age:29,hair:'Wavy',hairColor:'Black',eyes:'Brown',face:'Freckles',ethnicity:'East Asian',gender:'Female',body:'Slim',height:170})),{faceDescription:'Visible face.',age:29,hair:'Wavy',hairColor:'Black',eyes:'Brown',face:'Freckles'});assert.deepEqual(parseFaceAnalysis(JSON.stringify({description:'Face.',age:15,hair:null,eyes:'invented',face:'None specified'})),{faceDescription:'Face.'});assert.throws(()=>parseFaceAnalysis('not json'));});
