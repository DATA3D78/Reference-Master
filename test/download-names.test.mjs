import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../server.mjs';
import {projectDownloadName,downloadDisposition} from '../public/library.js';
import {LlmWorkspace} from '../public/llm.js';

const filename=response=>decodeURIComponent(response.headers.get('content-disposition').split("filename*=UTF-8''")[1]);
const png=Buffer.from([137,80,78,71,13,10,26,10,1]);
const mp4=Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(20)]);
function entries(zip){const names=[];let offset=zip.readUInt32LE(zip.length-6);while(zip.readUInt32LE(offset)===0x02014b50){const size=zip.readUInt16LE(offset+28);names.push(zip.subarray(offset+46,offset+46+size).toString());offset+=46+size+zip.readUInt16LE(offset+30)+zip.readUInt16LE(offset+32);}return names;}

test('project filenames preserve readable Unicode and extensions while staying safe and bounded',()=>{
  assert.equal(projectDownloadName('TEST_MODELS','text-abc123','json'),'TEST_MODELS-text-abc123.json');
  assert.equal(projectDownloadName('Été 東京','text-abc123','txt'),'Été 東京-text-abc123.txt');
  const name=projectDownloadName('../Scene/ "A"\r\n','../output\\movie','mp4'),header=downloadDisposition(name);
  assert(!/[\r\n/\\"]/.test(name));assert(!name.startsWith('.'));assert(name.endsWith('.mp4'));assert(!/[\r\n]/.test(header));
  assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]),name);
  const long=projectDownloadName('🌅'.repeat(80),'é'.repeat(180),'png');assert(Buffer.byteLength(long)<255);assert(long.endsWith('.png'));
});

test('text and JSON download links use the output project even when another project is selected',async t=>{
  let link;const prior=globalThis.document;
  globalThis.document={createElement:()=>link={click(){this.clicked=true;}}};
  t.after(()=>{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;});
  t.mock.method(URL,'createObjectURL',()=> 'blob:mock-download');
  const job={id:'output-123456',projectId:'origin',output:'Saved text',settings:{format:'text'}};
  const context={projectId:'other',jobs:[job],actions:{projectName:id=>id==='origin'?'Original Project':'Other Project'}};
  const button={dataset:{llmAction:'download'},closest:()=>({dataset:{llmJob:job.id}})},event={target:{closest:()=>button}};
  await LlmWorkspace.prototype.resultAction.call(context,event);
  assert.equal(link.download,'Original Project-text-output-1.txt');assert.equal(link.clicked,true);
  job.settings.format='json';job.output='{"scene_description":"A scene"}';
  await LlmWorkspace.prototype.resultAction.call(context,event);
  assert.equal(link.download,'Original Project-text-output-1.json');assert.equal(link.clicked,true);
});

test('all downloads use their source project, follow renames and preserve shared asset origins',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-download-names-'));
  const media=[{id:'image',url:'https://fal.media/image',contentType:'image/png'},{id:'video',url:'https://fal.media/video',contentType:'video/mp4'},{id:'audio',url:'https://fal.media/audio',contentType:'audio/wav'}];
  await writeFile(join(dir,'jobs.json'),JSON.stringify([{id:'origin-job',projectId:'default',createdAt:'2026-10-09T12:00:00Z',modelName:'Test model',mode:'image',settings:{prompt:'An asset'},tasks:[{status:'COMPLETED',outputs:media}]}]));
  const app=await createStudio({dataDir:dir,key:'',keyFile:null,openRouterKey:'',openRouterKeyFile:null,autoArchive:false,pollMs:3600000,fetchImpl:async url=>new Response(url.endsWith('/video')?mp4:url.endsWith('/audio')?wav:png)});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.server.close(r));await app.save();await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port,boot=await fetch(base+'/api/bootstrap').then(r=>r.json());
  assert.equal(boot.features.projectDownloadNames,true);
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.csrf},body:JSON.stringify(body)});
  await post('/api/projects',{type:'rename',id:'default',name:'Été Studio'});
  for(const [id,extension]of [['image','png'],['video','mp4'],['audio','wav']]){
    const response=await fetch(base+'/api/download?job=origin-job&media='+id);assert.equal(response.status,200);assert.match(filename(response),new RegExp('^Été Studio-[a-f0-9]{8}-[a-f0-9]{8}\\.'+extension+'$'));assert.equal(response.headers.get('cache-control'),'no-store');await response.arrayBuffer();
  }
  const {asset}=await post('/api/assets',{jobId:'origin-job',mediaId:'image'}).then(r=>r.json());
  const {project}=await post('/api/projects',{type:'create',name:'Another project'}).then(r=>r.json());
  // The same bytes can be reused by another project without changing their origin.
  const shared=await fetch(base+'/api/uploads?project='+project.id,{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':boot.csrf,'X-File-Name':'Shared.png'},body:png});assert.equal(shared.status,201);
  const assetResponse=await fetch(base+'/api/assets/media?id='+asset.id+'&download=1');assert(filename(assetResponse).startsWith('Été Studio-'));await assetResponse.arrayBuffer();
  const ticket=await post('/api/downloads/batch',{projectId:project.id,items:[{assetId:asset.id}]}).then(r=>r.json());
  assert.equal(ticket.name,'Été Studio-selection.zip');const archive=await fetch(base+ticket.url);assert.equal(filename(archive),ticket.name);assert(entries(Buffer.from(await archive.arrayBuffer())).every(name=>name.startsWith('Été Studio-')));
  await post('/api/projects',{type:'rename',id:'default',name:'Renamed Studio'});
  const renamed=await fetch(base+'/api/download?job=origin-job&media=image');assert(filename(renamed).startsWith('Renamed Studio-'));await renamed.arrayBuffer();
  await post('/api/projects',{type:'delete',id:'default'});
  const archivedOrigin=await fetch(base+'/api/assets/media?id='+asset.id+'&download=1');assert(filename(archivedOrigin).startsWith('Renamed Studio-'));await archivedOrigin.arrayBuffer();
  // A second, distinct upload allows one ZIP to contain different project prefixes.
  const uploaded=await fetch(base+'/api/uploads?project='+project.id,{method:'POST',headers:{'Content-Type':'image/png','X-Studio-Token':boot.csrf,'X-File-Name':'Other.png'},body:Buffer.concat([png,Buffer.from([9])])}).then(r=>r.json());
  const mixed=await post('/api/downloads/batch',{projectId:project.id,items:[{assetId:asset.id},{assetId:uploaded.assetId}]}).then(r=>r.json());
  assert.equal(mixed.name,'Multiple projects-selection.zip');
  const mixedArchive=await fetch(base+mixed.url),names=entries(Buffer.from(await mixedArchive.arrayBuffer()));
  assert(names[0].startsWith('Renamed Studio-'));assert(names[1].startsWith('Another project-'));
});
