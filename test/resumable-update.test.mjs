import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../server.mjs';

test('reopening the server polls a saved Comfy request and retrieves its image without resubmitting',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'resume-studio-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
 await writeFile(join(dir,'jobs.json'),JSON.stringify([{id:'saved-job',projectId:'default',provider:'comfy',mode:'image',modelName:'Test',createdAt:new Date().toISOString(),settings:{model:'nano-pro',ratio:'1:1',resolution:'1K',prompt:'Saved scene',count:1},tasks:[{status:'IN_PROGRESS',requestId:'saved-remote-id',modelId:'vertexai/gemini-3-pro-image',outputs:[]}]}]));
 const calls=[];
 const app=await createStudio({dataDir:dir,comfyKey:'dummy-key',key:'',openRouterKey:'',pollMs:1e8,autoArchive:false,fetchImpl:async(url,options)=>{calls.push({url,method:options.method});assert.equal(options.method,'GET');assert(url.includes('/requests/saved-remote-id'));return Response.json(url.endsWith('/status')?{status:'COMPLETED'}:{candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png}}]}}]});}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
 await app.refresh();const {jobs}=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/jobs').then(r=>r.json());
 assert.equal(jobs[0].tasks[0].status,'COMPLETED');assert.equal(jobs[0].tasks[0].outputs.length,1);assert.equal(calls.length,2);assert(calls.every(c=>c.method==='GET'));
});
