import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../server.mjs';
import {MODELS,buildInput} from '../public/models.js';
test('image models build native Comfy inputs',()=>{
 for(const model of MODELS.filter(m=>m.mode==='image'&&m.available)){
  const result=buildInput({model:model.id,inputType:'text',prompt:'A ceramic vase',ratio:'1:1',resolution:model.resolutions[0],count:1},[]);
  assert.equal(result.model.provider,'comfy');assert.match(result.endpoint,/^(vertexai|krea|openai|byteplus|bfl)\//);assert(result.input);
 }
});
test('Reference Master submits product/environment sheets only to Comfy with its credential',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'reference-master-comfy-'));const calls=[];
 const app=await createStudio({dataDir,comfyKey:'test-comfy',autoArchive:false,pollMs:1e8,fetchImpl:async(url,opts)=>{
  assert.equal(new URL(url).origin,'https://api.comfy.org');assert.equal(opts.headers['X-API-Key'],'test-comfy');assert.equal(opts.headers.Authorization,undefined);calls.push({url,input:JSON.parse(opts.body)});
  return Response.json({request_id:'mock-'+calls.length,status:'IN_QUEUE'},{headers:{'Retry-After':'100'}});
 }});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>{app.server.close(r);app.server.closeAllConnections();});await app.save();await rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 const origin='http://127.0.0.1:'+app.server.address().port;const boot=await(await fetch(origin+'/api/bootstrap')).json();assert.equal(boot.provider,'comfy');assert(boot.keyConfigured);
 for(const feature of ['audioGeneration','mediaTools','localEditing','spending'])assert.equal(boot.features[feature],false);
 const settings=await(await fetch(origin+'/api/settings/files')).json();assert.deepEqual(settings.files.map(f=>f.id),['comfy']);
 for(const path of ['/api/audio/generate','/api/tools/generate','/api/editing/presets']){
  const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.csrf},body:'{}'});assert.equal(response.status,404,path);
 }

 for(const referenceType of ['character','product','environment']){
  const response=await fetch(origin+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.csrf},body:JSON.stringify({projectId:boot.projects[0].id,workflow:'reference',referenceType,model:'nano-pro',inputType:'text',prompt:'A reference sheet',ratio:'16:9',resolution:'1K',count:1,referenceIds:[]})});
  const result=await response.json();assert.equal(response.status,202,JSON.stringify(result));assert.equal(result.job.provider,'comfy');assert.equal(result.job.settings.referenceType,referenceType);
 }
 for(let i=0;i<50&&calls.length<3;i++)await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,3);assert(calls.every(c=>c.input.contents));
});

import {createLlmStore} from '../llm-store.mjs';
import {createPromptEnhancer} from '../prompt-enhancer.mjs';
import {writeFile} from 'node:fs/promises';
test('text analysis and enhancement use Comfy, preserve chat payloads and record Comfy billing',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'comfy-text-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
 const calls=[];const fetchImpl=async(url,options)=>{assert.equal(url,'https://api.comfy.org/v2/models/openrouter/chat-completions');assert.equal(options.headers['X-API-Key'],'comfy-test');assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');const payload=JSON.parse(options.body);assert.equal(payload.model,'openai/gpt-5.6-sol');assert(payload.messages.length);calls.push(payload);return Response.json({id:'chat-test',choices:[{finish_reason:'stop',message:{content:'A red vase on a table.'}}],usage:{cost:0.001}});};
 const store=await createLlmStore({directory,fetchImpl,requireProject:id=>({id})});
 const job=await store.submit({projectId:'default',model:'openai/gpt-5.6-sol',task:'image',format:'text',instruction:'Describe this product.',maxTokens:8192},[{kind:'image',contentType:'image/png',bytes:8,data:'data:image/png;base64,iVBORw0KGgo='}],'comfy-test');
 for(let i=0;i<100&&store.list('default').jobs[0].status==='RUNNING';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(store.list('default').jobs[0].status,'COMPLETED');assert.equal(store.spendingEntries()[0].provider,'comfy');assert.equal(store.spendingEntries()[0].actual,0.001);
 await writeFile(join(directory,'IMAGE_PROMPT_PRESETS.txt'),'# No presets');
 const billing=[];const enhancer=createPromptEnhancer({directory,fetchImpl,trackSpending:async entry=>billing.push({...entry})});
 const result=await enhancer.enhance({projectId:'default',mode:'image',model:'nano-pro',prompt:'a vase'},'comfy-test');assert.equal(result.enhanced,'A red vase on a table.');assert.equal(billing.at(-1).provider,'comfy');assert.equal(calls.length,2);
});
