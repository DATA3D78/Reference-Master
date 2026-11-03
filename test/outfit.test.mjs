const assertPrompt=(input,prompt)=>assert(JSON.stringify(input).includes(JSON.stringify(prompt).slice(1,-1)));
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLlmRequest} from '../llm-store.mjs';
import {LLM_MODELS} from '../public/llm-models.js';
import {MODELS,capabilities,buildInput} from '../public/models.js';
import {OUTFIT_SYSTEM_PROMPT,outfitPrompt} from '../public/outfit-prompt.js';
const base={task:'outfit',model:LLM_MODELS[0].id,format:'text',maxTokens:4096};
const image={kind:'image',contentType:'image/png',bytes:100,data:'data:image/png;base64,aGVsbG8=',metadata:{width:800,height:1200}};
test('Outfit describes a single image with a dedicated clothing-only system prompt',()=>{
 const r=buildLlmRequest(base,[image]);assert.equal(r.settings.task,'outfit');assert(r.payload.messages[0].content.startsWith(OUTFIT_SYSTEM_PROMPT));assert(r.payload.messages[0].content.includes('complete top-and-bottom outfit'));assert.equal(r.payload.messages[1].content[1].image_url.url,image.data);
 assert.throws(()=>buildLlmRequest(base,[image,image]),/one outfit image/);
});
test('Outfit enhances original text without requiring an existing LLM output',()=>{
 const r=buildLlmRequest({...base,instruction:'Navy linen jacket and cream trousers'},[]);
 assert(r.payload.messages[1].content[0].text.includes('Navy linen jacket and cream trousers'));
 assert.throws(()=>buildLlmRequest(base,[]),/describe an outfit/);
});
test('Flat-lay prompts work with supported image models and preserve image references',()=>{
 for(const m of MODELS.filter(m=>m.available&&m.mode==='image'&&m.inputs.includes('image')&&m.inputs.includes('text'))){
  for(const type of ['text','image']){const c=capabilities(m,type);const prompt=outfitPrompt('Navy jacket, cream trousers, leather loafers.');const r=buildInput({model:m.id,inputType:type,prompt,ratio:c.ratios.includes('3:4')?'3:4':c.ratios[0],resolution:c.resolutions[0],count:1},type==='image'?[image]:[]);assertPrompt(r.input,prompt);}
 }
});

test('Outfit provenance recognizes earlier flat-lay generations without treating ordinary references as outfits',async()=>{
 const {isOutfitGeneration}=await import('../public/outfit-prompt.js');
 assert(isOutfitGeneration({settings:{workflow:'outfit'}}));
 assert(isOutfitGeneration({settings:{prompt:outfitPrompt('Black jacket and trousers')}}));
 assert(isOutfitGeneration({settings:{prompt:'Extract and recreate only the outfit, as a clean premium fashion flat lay on a pure white background.'}}));
 assert.equal(isOutfitGeneration({settings:{prompt:'A person wearing a black jacket'}}),false);
 assert.equal(isOutfitGeneration(undefined),false);
});

test('Outfit creates distinct flat-lay and mannequin prompts from the same description',async()=>{
 const {outfitVariants}=await import('../public/outfit-prompt.js');
 const variants=outfitVariants('Navy jacket, cream trousers, leather loafers.');
 assert.deepEqual(variants.map(v=>v.name),['flat lay','mannequin']);
 for(const v of variants)assert(v.prompt.includes('Navy jacket, cream trousers, leather loafers.'));
 assert.match(variants[0].prompt,/No mannequin/);
 assert.match(variants[1].prompt,/dark-grey matte/);assert.match(variants[1].prompt,/feminine or masculine/);assert.match(variants[1].prompt,/neutral mannequin/);assert.match(variants[1].prompt,/#808080/);
});

test('audience detection ignores generic mannequin instructions and respects explicit categories',async()=>{
 const {outfitAudience,outfitMannequinPrompt}=await import('../public/outfit-prompt.js');
 assert.equal(outfitAudience({settings:{prompt:outfitMannequinPrompt('Outfit category: Women. Black jacket.')}}),'women');
 assert.equal(outfitAudience({settings:{prompt:outfitMannequinPrompt('Outfit category: Men. Blue suit.')}}),'men');
 assert.equal(outfitAudience({settings:{prompt:outfitMannequinPrompt('Black jacket.')}}),'neutral');
 assert.equal(outfitAudience({settings:{outfitAudience:'neutral',prompt:'Outfit details: Women'}}),'neutral');
});

test('explicit source wearer category takes precedence over incidental garment words',async()=>{
 const {outfitAudience}=await import('../public/outfit-prompt.js');
 assert.equal(outfitAudience({settings:{prompt:'Outfit details: Outfit category: Women. Masculine tailoring.'}}),'women');
 assert.equal(outfitAudience({settings:{prompt:'Outfit details: Outfit category: Men. Feminine detailing.'}}),'men');
 assert.equal(outfitAudience({settings:{prompt:'Outfit details: Outfit category: General / unisex. Menswear-inspired jacket.'}}),'neutral');
 const r=buildLlmRequest(base,[image]);assert.match(r.payload.messages[0].content,/visible wearer in the input image/);
});

test('structured wearer analysis is separate from flat-lay instructions and rejects missing classification',async()=>{
 const {parseOutfitAnalysis,outfitVariants}=await import('../public/outfit-prompt.js');
 const request=buildLlmRequest({...base,outfitAnalysis:true},[image]);
 assert.match(request.payload.messages[0].content,/woman or girl/);
 assert.match(request.payload.messages[0].content,/man or boy/);
 assert(!request.payload.messages[0].content.startsWith(OUTFIT_SYSTEM_PROMPT));
 assert.equal(request.payload.messages[1].content[1].image_url.url,image.data);
 for(const audience of ['women','men','neutral']){
  const parsed=parseOutfitAnalysis('```json\n'+JSON.stringify({audience,description:'A tailored jacket and matching trousers.'})+'\n```');
  assert.equal(parsed.audience,audience);
  const variants=outfitVariants(parsed.description,audience);
  if(audience!=='neutral')assert(variants[1].prompt.includes(audience==='women'?'female-form':'male-form'));
 }
 assert.throws(()=>parseOutfitAnalysis('A woman wearing a jacket'),/valid wearer category/);
 assert.throws(()=>parseOutfitAnalysis('{"description":"Jacket"}'),/incomplete/);
});

test('outfit descriptions and both generation variants exclude handheld props',async()=>{
 const {outfitVariants}=await import('../public/outfit-prompt.js');
 for(const structured of [false,true]){
  const request=buildLlmRequest({...base,outfitAnalysis:structured},[image]);
  assert.match(request.payload.messages[0].content,/Exclude handheld props/);
  assert(!request.payload.messages[1].content[0].text.includes('jewelry, props'));
 }
 for(const variant of outfitVariants('Jacket and trousers.','women'))assert.match(variant.prompt,/Exclude handheld props/);
});
