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

