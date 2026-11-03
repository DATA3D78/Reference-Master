import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,capabilities} from '../public/models.js';
import {estimateReferenceCost,referenceBillingEstimate,seedAudioReference} from '../public/reference-pricing.js';
import {pricePreview,priceText} from '../public/comfy-pricing.js';
const base={model:'nano-pro',inputType:'text',ratio:'1:1',resolution:'1K',duration:'5',count:1,quality:'high',audio:false};
const image={kind:'image',metadata:{width:1280,height:720}};
const video={kind:'video',metadata:{width:1280,height:720,duration:4}};
const quote=(settings={},refs=[],preview=false)=>estimateReferenceCost({...base,...settings},refs,new Date('2026-10-19T12:00:00Z'),{preview});

test('reference rates cover every selectable model, input mode and resolution',()=>{
 for(const model of MODELS.filter(m=>m.available))for(const inputType of model.inputs){
  const c=capabilities(model,inputType),refs=inputType==='text'?[]:inputType==='frames'?[image,image]:['video','edit'].includes(inputType)&&model.family==='flux-video'?[video]:[image];
  for(const resolution of c.resolutions)for(const ratio of c.ratios){
   const result=quote({model:model.id,inputType,resolution,ratio,duration:inputType==='edit'?'From video':'5',frameIndices:inputType==='keyframes'?[0]:undefined},refs);
   assert.equal(result.available,true,[model.id,inputType,resolution,ratio,result.reason].join(' / '));
   assert(result.minimum>0&&Number.isFinite(result.maximum));assert.equal(result.source,'reference');assert.equal(result.approximate,true);
  }
 }
});
test('image count, output tiers, style references and quality affect estimates',()=>{
 assert.equal(quote({count:4}).minimum,.6);assert.equal(quote({count:4,resolution:'4K'}).minimum,1.2);
 for(const [model,text,style]of [['krea2-large',.06,.065],['krea2-medium',.03,.035],['krea2-medium-turbo',.015,.0175]]){
  assert.equal(quote({model,resolution:'Native'}).minimum,text);assert.equal(quote({model,resolution:'Native',inputType:'image'},[image]).minimum,style);
 }
 assert.equal(quote({model:'seedream5-pro',inputType:'image',count:2},[image,image,image]).minimum,.153);
 assert.equal(quote({model:'seedream5-pro',resolution:'2K',count:2}).minimum,.27);
 assert.equal(quote({model:'seedream5-lite',resolution:'4K',count:4}).minimum,.14);
 for(const model of ['gpt25-flare','gpt25-sunburst']){
  assert(quote({model,quality:'high'}).minimum>quote({model,quality:'low'}).minimum);
  const auto=quote({model,quality:'auto'});assert(auto.maximum>auto.minimum);assert(auto.extraUsage);
 }
 assert(quote({model:'nano21',resolution:'4K'}).minimum>quote({model:'nano21',resolution:'1K'}).minimum);
 assert.match(priceText(quote({model:'nano21'})),/\+$/);
});
test('FLUX uses publisher tier prices after its expired launch promotion',()=>{
 for(const [resolution,amount]of [['1K',.048],['2K',.10],['4K',.607]]){
  const value=quote({model:'flux3-image',resolution});assert.equal(value.minimum,amount);assert.equal(value.referenceProvider,'BFL');assert.equal(value.url,'https://bfl.ai/pricing');
 }
});
test('video estimates distinguish Seedance versions, duration, dimensions and extension/edit modes',()=>{
 assert.equal(quote({model:'wan3',resolution:'720p',duration:'10',count:2}).minimum,2);
 assert.equal(quote({model:'wan3',resolution:'1080p',duration:'10',count:2}).minimum,4);
 assert.equal(quote({model:'seedance20',resolution:'720p',ratio:'16:9'}).minimum,1.512);
 assert.equal(quote({model:'seedance25',resolution:'720p',ratio:'16:9'}).minimum,2.3112);
 assert.equal(quote({model:'seedance25',resolution:'1080p',ratio:'16:9'}).minimum,5.6862);
 assert.equal(quote({model:'minimax-h3',resolution:'2K',duration:'10'}).minimum,1.3);
 assert.equal(quote({model:'flux3-video',resolution:'720p',inputType:'video'},[video]).minimum,2.05);
 assert.equal(quote({model:'flux3-video',resolution:'720p',inputType:'edit',ratio:'From video',duration:'From video'},[video]).minimum,.12);
});
test('fixed previews need no prompt, key or references; stored costs require enough reference metadata',()=>{
 assert(quote({inputType:'image'},[],true).available);assert.equal(quote({inputType:'image'}).available,false);
 assert.equal(quote({model:'seedance25',resolution:'720p',inputType:'image',ratio:'From image'},[{kind:'image'}]).available,false);
 assert.equal(quote({count:0}).available,false);assert.equal(quote({resolution:'invalid'}).available,false);
 assert.equal(referenceBillingEstimate({...base,count:4}).amount,.15);
 assert.equal(seedAudioReference().available,false);assert.equal(seedAudioReference(60).minimum,.1875);
});
test('preview keeps a usable fallback after disabled live pricing, and ignores stale responses',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const paints=[],requests=[];const preview=pricePreview(()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),v=>paints.push(v));
 const fallback=quote(),newer=quote({resolution:'4K'});
 preview.update(base,{fallback});assert.equal(paints.at(-1),fallback);t.mock.timers.tick(650);
 requests[0].resolve({available:false,reason:'not_enabled'});await Promise.resolve();assert.equal(paints.at(-1),fallback);
 preview.update(base,{fallback});t.mock.timers.tick(650);preview.update(base,{fallback:newer});t.mock.timers.tick(650);
 requests[1].resolve({available:true,minimum:99,maximum:99});await Promise.resolve();assert.equal(paints.at(-1),newer);
 requests[2].reject(Error('offline'));await Promise.resolve();assert.equal(paints.at(-1),newer);
 preview.update(base,{fallback,enabled:false});assert.equal(paints.at(-1),fallback);
 preview.update(base,{fallback});t.mock.timers.tick(650);requests[3].resolve({available:true,minimum:0,maximum:0,source:'exact'});await Promise.resolve();assert.equal(paints.at(-1).minimum,0);
});
