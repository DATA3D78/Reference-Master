import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MODELS,capabilities,buildInput} from '../public/models.js';
import {buildAudioInput} from '../public/audio-models.js';
import {TOOLS,buildToolInput} from '../public/tools-models.js';
import {normalizeOutputs,normalizeEstimate,validRouterURL,queueURLs,serializeInput,retryDelay,createComfyRouter} from '../comfy-router.mjs';
import {validMediaURL,publicAddress} from '../public-media-fetch.mjs';
const ref=(kind='image')=>({kind,contentType:kind==='image'?'image/png':kind==='video'?'video/mp4':'audio/wav',bytes:100,data:`data:${kind}/${kind==='image'?'png':kind==='video'?'mp4':'wav'};base64,aGVsbG8=`,metadata:{width:512,height:512,duration:2}});
function matches(value,s={},defs={}){
 if(s.$ref)return matches(value,defs[s.$ref.split('/').pop()],defs);
 if(s.nullable&&value===null)return true;
 if(s.allOf&&!s.allOf.every(x=>matches(value,x,defs)))return false;
 if(s.anyOf&&!s.anyOf.some(x=>matches(value,x,defs)))return false;
 if(s.oneOf&&s.oneOf.filter(x=>matches(value,x,defs)).length!==1)return false;
 if(s.enum&&!s.enum.includes(value))return false;
 if(s.type==='string'&&(typeof value!=='string'||value.length<(s.minLength||0)||value.length>(s.maxLength??Infinity)))return false;
 if(s.type==='boolean'&&typeof value!=='boolean')return false;
 if(['integer','number'].includes(s.type)&&(typeof value!=='number'||!Number.isFinite(value)||s.type==='integer'&&!Number.isInteger(value)||value<(s.minimum??-Infinity)||value>(s.maximum??Infinity)))return false;
 if(s.type==='array'&&(!Array.isArray(value)||value.length<(s.minItems||0)||value.length>(s.maxItems??Infinity)||!value.every(v=>matches(v,s.items,defs))))return false;
 if(s.type==='object'||s.properties||s.required){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(s.required?.some(k=>!Object.hasOwn(value,k)))return false;
  for(const [k,v] of Object.entries(value)){if(s.properties?.[k]){if(!matches(v,s.properties[k],defs))return false;}else if(s.additionalProperties===false)return false;}
 }
 return true;
}
const schemas=new Map();
async function schema(endpoint){if(!schemas.has(endpoint))schemas.set(endpoint,JSON.parse(await readFile(new URL('./comfy-schemas/'+endpoint.replace('/','__')+'.json',import.meta.url))));return schemas.get(endpoint);}
function request(model,inputType){const c=capabilities(model,inputType);return {model:model.id,inputType,prompt:'A colorful glass sculpture',ratio:c.ratios[0],resolution:c.resolutions[0],duration:c.durations?.[0],count:1,frameIndices:[0],audio:true};}
for(const model of MODELS.filter(m=>m.available))test(model.name+' maps every offered input, ratio, resolution and duration to its native Comfy schema',async()=>{
 for(const inputType of model.inputs){
  const c=capabilities(model,inputType),refs=inputType==='text'?[]:inputType==='frames'?[ref(),ref()]:inputType==='video'&&model.referenceLimits?[ref()]:['video','edit'].includes(inputType)?[ref('video')]:[ref()];
  for(const ratio of c.ratios)for(const resolution of c.resolutions)for(const duration of c.durations||['5']){
   const settings={...request(model,inputType),ratio,resolution,duration},built=buildInput(settings,refs),spec=await schema(built.endpoint);
   assert(matches(built.input,spec.input,spec.definitions),model.id+' '+JSON.stringify(built.input));
   assert(!built.endpoint.includes('fal'));assert.equal(built.model.provider,'comfy');
  }
 }
});
test('exact unavailable models/tools cannot issue provider calls',()=>{
 assert(!MODELS.some(m=>m.id.includes('fast')));assert.throws(()=>buildInput({model:'seedance25-fast'}),/supported model/);
 for(const tool of TOOLS.filter(t=>!t.available))assert.throws(()=>buildToolInput({tool:tool.id},ref(tool.kind)),/Comfy/);
 assert.equal(buildAudioInput({model:'music-3',prompt:'music',lyrics:'[instrumental]'}).model.provider,'fal');
});
test('Seedance 2.0 uses its own endpoint and enforces model-specific limits beyond the shared schema',()=>{
 const seed=MODELS.find(m=>m.id==='seedance20'),settings={...request(seed,'video'),duration:'15',resolution:'720p'};
 const built=buildInput(settings,[ref(),ref('audio')]);
 assert.equal(built.endpoint,'byteplus/dreamina-seedance-2-0-260128');
 assert.deepEqual(built.input.content.slice(1).map(c=>c.role),['reference_image','reference_audio']);
 assert.equal(built.input.duration,15);assert.equal(built.input.resolution,'720p');assert.equal(built.input.generate_audio,true);
 assert(!('output_format' in built.input),'output_format is a Seedance 2.5-only option');
 assert.throws(()=>buildInput({...settings,resolution:'1080p'},[ref()]),/resolution/);
 for(const duration of ['3','16','30'])assert.throws(()=>buildInput({...settings,duration},[ref()]),/duration/);
 assert.throws(()=>buildInput(settings,[ref('audio')]),/at least one image/);
 assert.throws(()=>buildInput(settings,Array.from({length:10},()=>ref())),/image references/);
 assert.throws(()=>buildInput(settings,[ref(),...Array.from({length:4},()=>ref('audio'))]),/audio references/);
 assert.throws(()=>buildInput(settings,[ref(),...Array.from({length:2},()=>({...ref('audio'),metadata:{duration:8}}))]),/total at most 15/);
 assert.throws(()=>buildInput(settings,[ref(),{...ref('audio'),contentType:'audio/ogg'}]),/MP3 or WAV/);
 assert.throws(()=>buildInput(settings,[ref('video')]),/Reference type/);
 assert.equal(MODELS.find(m=>m.id==='wan3').available,true);
 assert.equal(MODELS.find(m=>m.id==='seedance25').available,true);
});
test('keyframe times are seconds; reference roles, order and encoded images match the native APIs',()=>{
 const model=MODELS.find(m=>m.id==='flux3-video');const built=buildInput({...request(model,'keyframes'),duration:'5',frameIndices:[96,0]},[ref(),{...ref(),data:'data:image/png;base64,b3RoZXI='}]);
 assert.deepEqual(built.input.keyframes,[[0,'b3RoZXI='],[4,'aGVsbG8=']]);
 const seed=MODELS.find(m=>m.id==='seedance25');const multi=buildInput(request(seed,'video'),[ref(),ref('audio')]);assert.deepEqual(multi.input.content.slice(1).map(c=>c.role),['reference_image','reference_audio']);
 assert.throws(()=>buildInput(request(seed,'video'),[ref('video')]),/type|references/i);
 const nano=buildInput(request(MODELS[0],'image'),[ref()]);assert.equal(nano.input.contents[0].parts[1].inlineData.data,'aGVsbG8=');
 const krea=buildInput(request(MODELS.find(m=>m.id==='krea2-large'),'image'),[ref()]);assert.equal(krea.input.image_style_references[0].url,ref().data);
});
test('Seed Audio translates voice IDs, local references and all adjustable audio settings',async()=>{
 for(const multilingual of [false,true])for(const inputType of ['text','audio','image']){
  const refs=inputType==='text'?[]:[ref(inputType)];const built=buildAudioInput({model:'seed-audio',prompt:'Hello',inputType,options:{multilingual,speed:1.5,volume:.5,pitch:2,...(inputType==='text'?{voice:'voice-id'}:{})}},refs);
  const s=await schema(built.endpoint);assert(matches(built.input,s.input,s.definitions));
  assert.equal(built.input.audio_config.speech_rate,50);assert.equal(built.input.audio_config.loudness_rate,-50);
  assert.deepEqual(built.input.references,inputType==='text'?[{speaker:'voice-id'}]:[{[inputType+'_data']:'aGVsbG8='}]);
 }
});
test('native outputs normalize URL and inline results without treating provider usage as Comfy billing',()=>{
 const cases=[['vertexai/gemini-3-pro-image',{candidates:[{content:{parts:[{text:'hello'},{inlineData:{mimeType:'image/png',data:'YWJj'}},{fileData:{mimeType:'image/png',fileUri:'https://cdn.example.com/a.png'}}]}}]},2],['openai/gpt-image-2.5-flare',{data:[{b64_json:'YWJj'}]},1],['byteplus/seedream-5-0-260128',{data:[{url:'https://cdn.example.com/a.png'}]},1],['krea/krea-2-large',{result:{urls:['https://cdn.example.com/a.png']}},1],['bfl/flux-3-image',{result:{sample:'https://cdn.example.com/a.jpg',cost:999}},1],['bfl/video-edit-v1',{result:{sample:'https://cdn.example.com/a.mp4'}},1],['wan/wan3.0-video',{output:{video_url:'https://cdn.example.com/a.mp4'}},1],['byteplus/dreamina-seedance-2-5-260628',{content:{video_url:'https://cdn.example.com/a.mp4'}},1],['minimax/minimax-h3',{task:{content:{url:'https://cdn.example.com/a.mp4'}}},1],['byteplus/seed-audio-1.0',{audio:'YWJj',duration:2},1]];
 for(const [model,result,count] of cases){const outputs=normalizeOutputs(model,result);assert.equal(outputs.length,count,model);assert(!outputs.some(o=>'cost'in o));}
 assert.throws(()=>normalizeOutputs('vertexai/gemini-3-pro-image',{candidates:[{content:{parts:[{text:'No output'}]}}]}),/no downloadable/);
});
test('live estimates distinguish exact, range, unknown and zero; output count multiplies dollars',()=>{
 assert.deepEqual([normalizeEstimate({source:'exact',currency:'USD',amount:'0.15'},3).minimum,normalizeEstimate({source:'exact',currency:'USD',amount:'0.15'},3).maximum],[.44999999999999996,.44999999999999996]);
 const range=normalizeEstimate({source:'estimated',currency:'USD',min_amount:'0.1',max_amount:'0.3'},2);assert.equal(range.minimum,.2);assert.equal(range.maximum,.6);assert(range.approximate);
 for(const value of [{source:'unknown',currency:'USD'},{source:'exact',currency:'USD'},{source:'future',currency:'USD',amount:'1'},{source:'exact',currency:'EUR',amount:'1'}])assert.equal(normalizeEstimate(value).available,false);
 assert.equal(normalizeEstimate({source:'exact',currency:'USD',amount:'0'}).minimum,0);
});
test('credentials cannot leave api.comfy.org; redirects, private media and oversized bodies are refused',async()=>{
 let calls=0;const client=createComfyRouter(async(url,opts)=>{calls++;assert.equal(opts.headers['X-API-Key'],'test-secret');assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.redirect,'error');return Response.json({ok:true});});
 await client.request('https://api.comfy.org/v2/models/bfl/flux-3-image/estimate',{method:'POST',input:{prompt:'hi'},credential:'test-secret'});
 for(const url of ['https://queue.fal.run/fal-ai/test','https://api.comfy.org.evil.com/v2/models/a/b','https://secret@api.comfy.org/v2/models/a/b','https://api.comfy.org/admin','http://api.comfy.org/v2/models/a/b']){assert(!validRouterURL(url));await assert.rejects(client.request(url,{credential:'test-secret'}));}
 assert.equal(calls,1);assert.throws(()=>queueURLs('../bad','x'));assert.throws(()=>serializeInput({data:'a'.repeat(100*1024*1024)}),{status:413});
 for(const address of ['127.0.0.1','10.1.1.1','169.254.169.254','100.64.0.1','192.168.0.1'])assert(!publicAddress({address,family:4}));
 for(const address of ['::1','::ffff:127.0.0.1','fd00::1','fe80::1'])assert(!publicAddress({address,family:6}));
 assert(publicAddress({address:'8.8.8.8',family:4}));assert(!validMediaURL('https://127.0.0.1/a'));assert(!validMediaURL('https://server.local/a'));assert.equal(retryDelay('9'),9000);
});

test('every image and video model with a documented visible watermark flag explicitly disables it',async()=>{
 let checked=0;
 for(const model of MODELS.filter(m=>m.available))for(const kind of model.inputs){
  const refs=kind==='text'?[]:kind==='frames'?[ref(),ref()]:['video','edit'].includes(kind)&&!model.referenceLimits?[ref('video')]:[ref()];
  const built=buildInput(request(model,kind),refs),spec=await schema(built.endpoint);
  const inputSpec=spec.input.$ref?spec.definitions[spec.input.$ref.split('/').pop()]:spec.input;
  for(const flag of ['watermark','aigc_watermark'])if(inputSpec.properties?.[flag]?.type==='boolean'){assert.equal(built.input[flag],false,model.id+' '+kind);checked++;}
  if(inputSpec.properties?.parameters?.properties?.watermark){assert.equal(built.input.parameters.watermark,false);checked++;}
  assert(matches(built.input,spec.input,spec.definitions));
 }
 assert(checked>=10);
});
