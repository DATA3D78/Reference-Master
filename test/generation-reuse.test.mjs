import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStudio} from '../server.mjs';

test('original references survive upload cleanup and server restart in their original order',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fwrd-reuse-'));let app;
 const start=async()=>{app=await createStudio({dataDir:dir,key:'test-key',openRouterKey:'',autoArchive:false,pollMs:3600000,fetchImpl:async()=>Response.json({request_id:'mock',status:'IN_QUEUE'})});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;const bootstrap=await(await fetch(url+'/api/bootstrap')).json();return {url,headers:{'X-Studio-Token':bootstrap.csrf}};};
 const stop=async()=>{await app.ready;await new Promise(r=>app.server.close(r));await app.refresh();await app.save();};
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
 let f=await start();const images=[Buffer.from([137,80,78,71,13,10,26,10,1]),Buffer.from([137,80,78,71,13,10,26,10,2])],ids=[];
 for(const [i,body] of images.entries()){const response=await fetch(f.url+'/api/uploads',{method:'POST',headers:{...f.headers,'Content-Type':'image/png','X-File-Name':`ref-${i}.png`},body});assert.equal(response.status,201);ids.push((await response.json()).id);}
 const response=await fetch(f.url+'/api/generate',{method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:JSON.stringify({projectId:'default',model:'nano-pro',inputType:'image',prompt:'A landscape',ratio:'16:9',resolution:'2K',count:1,referenceIds:ids})});assert.equal(response.status,202);const {job}=await response.json();assert.equal(job.settings.references.length,2);
 for(const id of ids)await fetch(f.url+'/api/uploads/'+id,{method:'DELETE',headers:f.headers});
 await stop();f=await start();
 for(const [i,bytes] of images.entries()){const result=await fetch(f.url+`/api/generation-reference?job=${job.id}&index=${i}`);assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);}
 assert.equal((await fetch(f.url+`/api/generation-reference?job=${job.id}&index=99`)).status,404);
});
