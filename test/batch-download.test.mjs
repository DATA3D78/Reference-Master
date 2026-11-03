import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBatchDownloads,zipFiles} from '../batch-download.mjs';
import {createStudio} from '../server.mjs';

async function folder(t){const dir=await mkdtemp(join(tmpdir(),'fwrd-batch-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
test('streamed ZIP contains UTF-8 names, correct CRC and original file bytes',async t=>{
  const dir=await folder(t),path=join(dir,'original');await writeFile(path,'123456789');
  const name='001-étude.txt',parts=[];for await(const part of zipFiles([{path,name,bytes:9}]))parts.push(part);
  const zip=Buffer.concat(parts),nameLength=Buffer.byteLength(name),descriptor=30+nameLength+9,central=descriptor+16;
  assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt16LE(6),0x808);
  assert.equal(zip.subarray(30,30+nameLength).toString(),name);
  assert.equal(zip.subarray(30+nameLength,descriptor).toString(),'123456789');
  assert.equal(zip.readUInt32LE(descriptor+4),0xcbf43926);assert.equal(zip.readUInt32LE(central),0x02014b50);
  assert.equal(zip.readUInt32LE(central+16),0xcbf43926);assert.equal(zip.readUInt32LE(zip.length-6),central);
  assert.equal(zip.readUInt16LE(zip.length-12),1);
  await assert.rejects(async()=>{for await(const _ of zipFiles([{path,name,bytes:8}])){}},/changed/);
});
test('download manifests deduplicate, bound size and count, reject arbitrary paths and expire',async()=>{
  let time=0,called=0;const downloads=createBatchDownloads({now:()=>time,resolve:async()=>{called++;return {path:'local',bytes:1,name:'../a.png'};}});
  const item={jobId:'job',mediaId:'image'},ticket=await downloads.prepare({items:[item,item]});assert.equal(ticket.count,1);assert.equal(called,1);
  for(const items of [[],Array(251).fill(item),[{path:'/private/file'}],[{assetId:'a',path:'x'}],[null]])await assert.rejects(downloads.prepare({items}),e=>e.status===400);
  time=600001;await assert.rejects(downloads.serve({},ticket.url.split('/').pop()),e=>e.status===404);
  await assert.rejects(createBatchDownloads({resolve:async()=>({bytes:2**32,name:'big.mp4'})}).prepare({items:[item]}),e=>e.status===413);
});
test('batch endpoint exports assets and generated media without a provider call; protects missing, deleted and cross-project outputs',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fwrd-batch-api-')),output={id:'image',url:'https://fal.media/test',contentType:'image/png'};
  const job={id:'job',projectId:'default',mode:'image',modelName:'Test model',createdAt:'2026-10-08T12:00:00Z',settings:{prompt:'Test',model:'nano-pro'},tasks:[{status:'COMPLETED',outputs:[output,{...output,id:'deleted',deletedAt:'2026-10-08'}]}]};
  await writeFile(join(dir,'jobs.json'),JSON.stringify([job]));
  let calls=0;const studio=await createStudio({dataDir:dir,fetchImpl:async()=>{calls++;return new Response(png);},key:'',keyFile:null,openRouterKey:'',openRouterKeyFile:null,autoArchive:false,pollMs:3600000});
  t.after(async()=>{await new Promise(r=>studio.server.close(r));await studio.save();await rm(dir,{recursive:true,force:true});});
  await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+studio.server.address().port;
  const boot=await(await fetch(base+'/api/bootstrap')).json();assert.equal(boot.features.batchDownloads,true);
  const post=(path,body,token=boot.csrf)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)});
  const {asset}=await(await post('/api/assets',{jobId:'job',mediaId:'image'})).json();assert.equal(calls,1);
  const body={projectId:'default',items:[{jobId:'job',mediaId:'image'},{assetId:asset.id}]};
  const response=await post('/api/downloads/batch',body);assert.equal(response.status,201);const ticket=await response.json();assert.equal(ticket.count,2);
  const downloaded=await fetch(base+ticket.url),zip=Buffer.from(await downloaded.arrayBuffer());assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'application/zip');assert.equal(Number(downloaded.headers.get('content-length')),zip.length);assert.equal(zip.readUInt16LE(zip.length-12),2);assert.equal(calls,1);
  assert.equal((await post('/api/downloads/batch',body,'bad')).status,403);
  assert.equal((await post('/api/downloads/batch',{...body,items:[{jobId:'job',mediaId:'deleted'}]})).status,404);
  assert.equal((await post('/api/downloads/batch',{...body,items:[{assetId:'../index.json'}]})).status,404);
  assert.equal((await post('/api/downloads/batch',{...body,items:[{jobId:'job',mediaId:'missing'}]})).status,404);
  const {project}=await(await post('/api/projects',{type:'create',name:'Second'})).json();
  assert.equal((await post('/api/downloads/batch',{...body,projectId:project.id,items:[body.items[0]]})).status,404);
  assert.equal((await post('/api/downloads/batch',{...body,projectId:project.id,items:[body.items[1]]})).status,201);
  assert.equal(calls,1);
});
