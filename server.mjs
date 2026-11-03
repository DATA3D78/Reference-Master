import {creatorViewRatio,CREATOR_VIEWS,creatorDefinition,creatorPrompt} from './public/creator-model.js';
import {referenceAudience} from './public/reference-model.js';
import {isOutfitGeneration,outfitAudience} from './public/outfit-prompt.js';
import {estimateReferenceCost,referenceBillingEstimate} from './public/reference-pricing.js';
import './network-trust.mjs';
import {createComfyRouter,modelURL,queueURLs,normalizeOutputs,billingEstimate,normalizeEstimate} from './comfy-router.mjs';
import {validMediaURL,fetchPublicMedia} from './public-media-fetch.mjs';
export {validMediaURL} from './public-media-fetch.mjs';
import {createRequestAccess,studioRuntime} from './server-access.mjs';
import {assetDownloadName,projectDownloadName} from './public/library.js';
import http from 'node:http';
import {createBatchDownloads} from './batch-download.mjs';
import {createShootStore} from './shoot-store.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { MODELS, buildInput, referenceFileMB } from './public/models.js';
import { createMediaStore } from './media-store.mjs';
import {createMediaPreferences,nativeMediaFolderPicker} from './media-preferences.mjs';
import { createIdeationStore, validateCanvasPosition } from './ideation-store.mjs';
import {createProjectStore,DEFAULT_PROJECT} from './project-store.mjs';
import {readSavedApiKey} from './api-key-file.mjs';
import {createSettingsFiles,openTextFile} from './settings-files.mjs';
import {customPaths} from './custom-files.mjs';
import {createLlmStore} from './llm-store.mjs';
import {LLM_MODELS,LLM_LIMITS} from './public/llm-models.js';
import {createAssetStore} from './asset-store.mjs';
import {createPromptEnhancer} from './prompt-enhancer.mjs';
import {videoFrameCount} from './video-metadata.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CUSTOM_PATHS=customPaths(ROOT);
const ACTIVE=new Set(['SUBMITTING','IN_QUEUE','IN_PROGRESS']);
const MIME = { '.png':'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg':'image/svg+xml' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function readBody(req, max) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw fail('File or request is too large.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req,max=64 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Expected JSON.',415);
  try { return JSON.parse((await readBody(req, max)).toString()); } catch(e) { if (e.status) throw e; throw fail('Invalid JSON.'); }
}
export function detectMedia(data, claimed) {
  if (claimed === 'image/png' && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image';
  if (claimed === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image';
  if (claimed === 'image/webp' && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP') return 'image';
  if(claimed==='video/webm'&&data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&data.subarray(4,4096).includes(Buffer.from('webm')))return 'video';
  if (['video/mp4','video/quicktime'].includes(claimed) && ['ftyp','moov','mdat','wide','free'].includes(data.toString('ascii',4,8))) return 'video';
  if (claimed === 'audio/wav' && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WAVE') return 'audio';
  if (claimed === 'audio/mpeg' && (data.toString('ascii',0,3) === 'ID3' || (data.length>=3 && data[0]===255 && (data[1]&0xe0)===0xe0 && (data[1]&0x06)!==0))) return 'audio';
  if (claimed === 'audio/ogg' && data.toString('ascii',0,4) === 'OggS' && data.subarray(0,64).includes(Buffer.from('OpusHead'))) return 'audio';
  throw fail('Unsupported file. Use PNG, JPEG, WebP, MP4, MOV, WebM, MP3, WAV or Ogg Opus.');
}

export async function createStudio({ dataDir = join(ROOT,'.local'), fetchImpl = fetch, comfyKey=process.env.COMFY_API_KEY||undefined, comfyKeyFile=dataDir===join(ROOT,'.local')?join(ROOT,'CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt'):null, pollMs = 4000, autoArchive = true, promptPresetDir = CUSTOM_PATHS.promptPresetDir, access, instanceId, openSettingsFile=openTextFile, pickMediaFolder=nativeMediaFolderPicker(join(ROOT,'launcher/select-media-folder')) } = {}) {
  const authorizeRequest=createRequestAccess(access),comfy=createComfyRouter(fetchImpl);
  const settingsFiles=createSettingsFiles({comfyKeyFile,hosted:!!access?.publicOrigin,openFile:openSettingsFile});
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let jobs = [];
  try { jobs = JSON.parse(await readFile(join(dataDir,'jobs.json'),'utf8')); } catch(e) { if (e.code !== 'ENOENT') throw new Error('Cannot read saved history. Preserve .local/jobs.json and repair it before restarting.'); }
  const preparingEnhancements=new Map();
  const projects=await createProjectStore(dataDir,{beforeDelete:projectId=>{
    if(jobs.some(job=>job.projectId===projectId&&job.tasks.some(task=>ACTIVE.has(task.status)))||llm.activeProjectIds().includes(projectId)||enhancer.activeProjectIds().includes(projectId)||preparingEnhancements.has(projectId))throw fail('A generation, LLM analysis or prompt enhancement is running in this project. Wait for it to finish before deleting the project.',409);
  }});
  const mediaPreferences=await createMediaPreferences({dataDir,projectIds:projects.list({deleted:true}).concat(projects.list()).map(p=>p.id),hosted:!!access?.publicOrigin,pickFolder:pickMediaFolder});
  const projectName=id=>{if(typeof id!=='string')return 'Project';try{return projects.requireProject(id,{includeDeleted:true}).name;}catch{return 'Project';}};
  let migrated=false;
  for(const job of jobs){if(!job.provider){job.provider='fal';migrated=true;}if(!job.projectId){job.projectId=DEFAULT_PROJECT;migrated=true;}projects.requireProject(job.projectId,{includeDeleted:true});}
  for(const job of jobs)for(const task of job.tasks)for(const media of task.outputs||[])if(!media.id){media.id=randomUUID();migrated=true;}
  for (const job of jobs) for (const task of job.tasks) if (task.status === 'SUBMITTING'||job.provider!=='comfy'&&job.managedBy!=='v2'&&ACTIVE.has(task.status)) { task.status = 'UNKNOWN'; task.error = job.provider==='comfy'||job.managedBy==='v2'?'The app restarted during submission. Check provider activity before retrying.':'This request belongs to the original studio. Open the original app to check it.';migrated=true; }
  const csrf=randomBytes(24).toString('hex');
  let legacyComfyKey=comfyKey??await readSavedApiKey(comfyKeyFile,'CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt','Comfy');
  async function reloadComfyKey(){if(comfyKey===undefined)legacyComfyKey=await readSavedApiKey(comfyKeyFile,'CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt','Comfy');}
  async function credentialFor(provider){if(provider!=='comfy')throw fail('This legacy model is not available through Comfy Router.',409);await reloadComfyKey();if(!legacyComfyKey)throw fail('Add your Comfy API key in Settings.',401);return legacyComfyKey;}
  const llm=await createLlmStore({directory:dataDir,fetchImpl,requireProject:projects.requireProject,validateSavedProject:id=>projects.requireProject(id,{includeDeleted:true})});
  const enhancer=createPromptEnhancer({directory:promptPresetDir,fetchImpl});
  const assets=await createAssetStore({directory:join(dataDir,'assets'),validateMedia:detectMedia,projectName});
  const shoot=await createShootStore(dataDir,projects.requireProject);
  const uploads = new Map(); let uploadBytes = 0; let saving = Promise.resolve(); const refreshing = new Set();
  const save = () => {
    const snapshot = JSON.stringify(jobs,null,2);
    const next = saving.catch(()=>{}).then(async () => { await writeFile(join(dataDir,'jobs.tmp'),snapshot,{mode:0o600}); await rename(join(dataDir,'jobs.tmp'),join(dataDir,'jobs.json')); });
    saving = next; return next;
  };
  const mediaStore=await createMediaStore({directory:join(dataDir,'media'),getDirectory:jobId=>mediaPreferences.directory(jobs.find(j=>j.id===jobId)?.projectId),getDirectories:jobId=>mediaPreferences.directories(jobs.find(j=>j.id===jobId)?.projectId),fetchImpl:fetchImpl===fetch?fetchPublicMedia:fetchImpl,validURL:validMediaURL,validateMedia:detectMedia,projectName});
  const archiving=new Map(),retryAfter=new Map();
  // Recover finished files even if the process stopped before history was updated.
  for(const job of jobs)for(const task of job.tasks)for(const media of task.outputs||[]){
    const file=await mediaStore.inspect(job.id,media).catch(()=>null);
    if(file){const local={bytes:file.bytes,savedAt:file.savedAt};if(JSON.stringify(media.local)!==JSON.stringify(local)||media.storageError){media.local=local;delete media.storageError;migrated=true;}}
    else if(media.local){delete media.local;migrated=true;}
  }
  if(migrated)await save();
  async function archiveOne(job,media,{force=false}={}){
    const key=job.id+'/'+media.id;
    if(archiving.has(key))return archiving.get(key);
    if(!force&&!media.local&&(retryAfter.get(key)||0)>Date.now())return null;
    const task=(async()=>{
      try{
        const file=await mediaStore.ensure(job.id,media),local={bytes:file.bytes,savedAt:file.savedAt};
        if(JSON.stringify(media.local)!==JSON.stringify(local)||media.storageError){media.local=local;delete media.storageError;await save();}
        retryAfter.delete(key);return file;
      }catch(e){
        if(!await mediaStore.inspect(job.id,media).catch(()=>null))delete media.local;
        media.storageError=cleanError(e);retryAfter.set(key,Date.now()+60000);
        await save().catch(()=>{});
        if(force)throw fail('A local copy could not be saved. '+media.storageError,e.status||502);
        return null;
      }
    })();
    archiving.set(key,task);try{return await task;}finally{archiving.delete(key);}
  }
  async function archive(){
    const remaining=jobs.filter(job=>mediaPreferences.automatic(job.projectId)).flatMap(job=>job.tasks.filter(t=>t.status==='COMPLETED').flatMap(t=>(t.outputs||[]).filter(media=>!media.deletedAt&&!media.local).map(media=>({job,media}))));
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(2,remaining.length)},async()=>{while(cursor<remaining.length){const {job,media}=remaining[cursor++];if(mediaPreferences.automatic(job.projectId))await archiveOne(job,media);}}));
  }

  const findMedia=(jobId,mediaId)=>{
    const job=jobs.find(j=>j.id===jobId);
    const media=job?.tasks.filter(t=>t.status==='COMPLETED').flatMap(t=>t.outputs||[]).find(m=>m.id===mediaId);
    if(!media)throw fail('Output not found.',404);
    return {job,media};
  };
  const batchDownloads=createBatchDownloads({resolve:async(item,projectId)=>{
    if(item.assetId){const asset=assets.get(item.assetId),file=await assets.inspect(item.assetId),origin=asset.sources[0]?.projectId,name=projectName(origin);return {...file,projectId:origin,projectName:name,name:assetDownloadName(name,asset)};}
    const project=projects.requireProject(projectId),{job,media}=findMedia(item.jobId,item.mediaId);
    if(job.projectId!==project.id||media.deletedAt)throw fail('A selected generation is no longer available in this project.',404);
    const file=await archiveOne(job,media,{force:true});
    return {...file,projectId:job.projectId,projectName:project.name,name:projectDownloadName(project.name,String(job.modelName||job.mode).slice(0,60)+'-'+String(job.createdAt).slice(0,10),file.path.split('.').pop())};
  }});
  const cleanError = (e,credential=legacyComfyKey) => [credential,legacyComfyKey].filter(Boolean).reduce((message,key)=>message.split(key).join('[redacted]'),String(e.message || 'Request failed.')).replace(/data:[^\s]+/g,'[file data]').slice(0,700);
  const boards=new Map();
  const boardFor=async(projectId)=>{
    projectId=projects.requireProject(projectId).id;
    if(!boards.has(projectId))boards.set(projectId,(async()=>{
      const directory=projectId===DEFAULT_PROJECT?dataDir:join(dataDir,'projects',projectId);
      await mkdir(directory,{recursive:true,mode:0o700});
      return createIdeationStore({directory,findAsset:id=>assets.get(id),findMedia:(jobId,mediaId)=>{const found=findMedia(jobId,mediaId);if(found.job.projectId!==projectId)throw fail('This result belongs to another project.');if(found.media.deletedAt)throw fail('This generation was deleted.');return found;}});
    })().catch(error=>{boards.delete(projectId);throw error;}));
    return boards.get(projectId);
  };
  const syncBoards=async()=>{for(const project of projects.list())await(await boardFor(project.id)).syncJobs(jobs.filter(j=>j.projectId===project.id));};
  const visibleJob=job=>job.tasks.some(task=>!task.deletedAt&&(task.status!=='COMPLETED'||!task.outputs?.length||task.outputs.some(media=>!media.deletedAt)));
  // Keep original records and canvas positions for Undo and billing; hide deleted outputs in the library.
  const publicBoard=board=>{
    const hidden=new Set(board.items.filter(item=>{if(item.type!=='media')return false;try{return !!findMedia(item.jobId,item.mediaId).media.deletedAt;}catch{return false;}}).map(item=>item.id));
    const items=board.items.filter(item=>!hidden.has(item.id)).map(item=>{
      if(item.type!=='asset')return item;
      try{const asset=assets.get(item.assetId);return {...item,asset:{id:asset.id,name:asset.name,contentType:asset.contentType,bytes:asset.bytes,width:asset.width,height:asset.height,duration:asset.duration}};}catch{return item;}
    });
    const assetItems=items.filter(i=>i.type==='asset');
    return hidden.size||assetItems.length?{...board,items,visibilityVersion:JSON.stringify([[...hidden],assetItems.map(i=>i.asset)])}:board;
  };
  const projectSummaries=()=>projects.list().map(p=>{const entries=jobs.filter(j=>j.projectId===p.id&&visibleJob(j)),media=entries.flatMap(j=>j.tasks.flatMap(t=>(t.outputs||[]).filter(m=>!m.deletedAt)));return {...p,mediaStorage:mediaPreferences.snapshot(p.id),generations:entries.length,images:media.filter(m=>m.contentType.startsWith('image/')).length,videos:media.filter(m=>m.contentType.startsWith('video/')).length,audios:media.filter(m=>m.contentType.startsWith('audio/')).length,favorites:media.filter(m=>m.favorite).length};});
  let deletionQueue=Promise.resolve();
  const setDeleted=(body,deleted)=>{
    const next=deletionQueue.catch(()=>{}).then(async()=>{
      const project=projects.requireProject(body.projectId);
      let job,record;
      if(Object.hasOwn(body,'taskIndex')){
        if(!Number.isInteger(body.taskIndex)||body.taskIndex<0||body.mediaId!=null)throw fail('Choose one failed generation.');
        job=jobs.find(j=>j.id===body.jobId);record=job?.tasks[body.taskIndex];
        if(!record)throw fail('Generation not found.',404);
        if(!['FAILED','UNKNOWN'].includes(record.status))throw fail('Only failed or uncertain submissions can be removed this way.',409);
      }else{
        const found=findMedia(body.jobId,body.mediaId);job=found.job;record=found.media;
      }
      if(job.projectId!==project.id)throw fail('This generation belongs to another project.');
      const previous=record.deletedAt;
      if(deleted)record.deletedAt=previous||new Date().toISOString();else delete record.deletedAt;
      try{await save();}catch{if(previous)record.deletedAt=previous;else delete record.deletedAt;throw fail('Could not save this change. Check available storage and try again.',500);}
      return {job:visibleJob(job)?publicJob(job):null};
    });
    deletionQueue=next;return next;
  };
  await syncBoards();
  function publicJob(job) {
    const savedAssets=new Map(assets.list().flatMap(asset=>asset.sources.filter(source=>source.jobId===job.id).map(source=>[source.mediaId,asset.id])));
    return { id:job.id, provider:job.provider, projectId:job.projectId, createdAt:job.createdAt, settings:job.settings, modelName:job.modelName, mode:job.mode,
      // Preserve original task indices when hidden failures are omitted, so later deletes and Undo target the same submission.
      tasks:job.tasks.flatMap(({ status, error, notice, queuePosition, outputs = [], requestId, deletedAt },taskIndex)=>deletedAt?[]:[{ taskIndex,status,error,notice,queuePosition,outputs:outputs.filter(media=>!media.deletedAt).map(({local,storageError,...media})=>({...media,savedToAssets:savedAssets.has(media.id),assetId:savedAssets.get(media.id),savedLocally:!!local,localBytes:local?.bytes,storageError})),requestId }]) };
  }
  async function run(job, config, credential) {
    for (const task of job.tasks) {
      try {
        const client=comfy;
        const {data:r,retryAfter}=await client.request(modelURL(config.endpoint)+'/requests',{method:'POST',credential,input:config.input,idempotencyKey:task.idempotencyKey});
        if(typeof r.request_id==='string')task.requestId=r.request_id;
        const urls=queueURLs(config.endpoint,r.request_id);
        Object.assign(task,{status:r.error_type?'FAILED':'IN_QUEUE',...urls,modelId:config.endpoint,queuePosition:r.queue_position,nextPollAt:Date.now()+retryAfter,costEstimate:billingEstimate(r.estimate)||job.costEstimate});
        if(r.error_type)task.error='Comfy'+' could not complete this request: '+String(r.error_type).replaceAll('_',' ');
      } catch(e) { task.status=e.status>=500||e.status===409?'UNKNOWN':'FAILED';task.error=cleanError(e,credential); }
      try { await save(); } catch { task.notice='History could not be saved. Keep this app open and copy the provider request ID.'; }
    }
  }
  async function refresh() {
    for (const [id,u] of uploads) if (Date.now()-u.createdAt>3600000) {uploadBytes-=u.bytes;uploads.delete(id);}
    const tasks=jobs.filter(j=>j.provider==='comfy'&&!!legacyComfyKey).flatMap(job=>job.tasks.map(task=>({job,task}))).filter(({task:t})=>['IN_QUEUE','IN_PROGRESS'].includes(t.status)&&!refreshing.has(t)&&(t.nextPollAt||0)<=Date.now());
    await Promise.all(tasks.map(async ({job,task})=>{
      const client=comfy,credential=legacyComfyKey,providerName='Comfy';
      refreshing.add(task);
      try {
        const urls=queueURLs(task.modelId,task.requestId);
        const status=await client.request(urls.statusURL,{credential}),s=status.data;
        task.nextPollAt=Date.now()+status.retryAfter;task.notice=undefined;
        if(s.error_type||s.error){task.status='FAILED';task.error=cleanError({message:providerName+' could not complete this request: '+String(s.error_type||s.error).replaceAll('_',' ')},credential);}
        else if(s.status==='COMPLETED'){
          const receipt=await client.request(urls.resultURL,{credential});
          task.nextPollAt=Date.now()+receipt.retryAfter;
          if(receipt.status===202)return;
          const outputs=normalizeOutputs(task.modelId,receipt.data,job.settings),saved=[];
          for(const output of outputs){
            const {data,...details}=output,media={id:randomUUID(),...details};
            if(data){const file=await mediaStore.saveBytes(job.id,media,data);media.local={bytes:file.bytes,savedAt:file.savedAt};}
            else if(!validMediaURL(media.url))throw fail(providerName+' returned an unsupported media link.',422);
            saved.push(media);
          }
          task.outputs=saved;task.status='COMPLETED';
          if(Number.isFinite(receipt.actualCost))task.actualCost=receipt.actualCost;
        }else if(['IN_QUEUE','IN_PROGRESS'].includes(s.status)){task.status=s.status;task.queuePosition=s.queue_position;}
        else throw fail(providerName+' returned an unrecognized queue status.',502);
      }catch(e){
        task.nextPollAt=Date.now()+(e.retryAfter||15000);
        if([400,404,410,422].includes(e.status)){task.status='FAILED';task.error=cleanError(e);}else task.notice=cleanError(e);
      }finally{refreshing.delete(task);}
    }));
    if(tasks.length)await save();
    await syncBoards();if(autoArchive)await archive();
  }
  async function quote(body){
    if(!Array.isArray(body.referenceIds)||body.referenceIds.length>50||new Set(body.referenceIds).size!==body.referenceIds.length)throw fail('Invalid reference list.');
    const refs=body.referenceIds.map(id=>uploads.get(id));if(refs.some(ref=>!ref))throw fail('Add the expired reference again.');
    await reloadComfyKey();if(!legacyComfyKey)return {available:false,reason:'Add your Comfy API key in Settings.'};
    const config=buildInput(body,refs);const {data}=await comfy.request(modelURL(config.endpoint)+'/estimate',{method:'POST',credential:legacyComfyKey,input:config.input});return normalizeEstimate(data,body.count||1);
  }
  const timer = setInterval(()=>refresh().catch(()=>{}),pollMs); timer.unref();
  const server = http.createServer(async (req,res)=>{
    const send = (status,body) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const port=server.address()?.port;
      authorizeRequest(req,port);
      const url = new URL(req.url,`http://${req.headers.host}`);
      if (req.method !== 'GET' && req.headers['x-studio-token'] !== csrf) throw fail('Reload the app and try again.',403);
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {await reloadComfyKey();return send(200,{ csrf, instanceId, mediaStorage:mediaPreferences.snapshot(), keyConfigured:!!legacyComfyKey,comfyKeyConfigured:!!legacyComfyKey, models:MODELS,provider:'comfy',studioVersion:2,features:{shoot:true,shootRefinement:true,shootReferenceAnalysis:true,shootConciseSubject:true,shootSubjectTypes:true,shootProductRefinement:true,comfyRouter:true,hybridProviders:false,referencePricing:true,settingsFiles:true,effectStack:false,expandedEffects:false,radianceGrading:false,h264EditingExport:false,editingPresets:false,localEditing:false,customFolder:true,pricingReview:true,canvasAssets:true,assetRemoval:true,projectDownloadNames:true,detailedLlmStructure:true,llmConnectionFix:true,seedvrVideo:false,llmDeletion:true,batchDownloads:true,ideation:true,projects:true,canvasGroups:true,savedApiKey:true,llm:true,concurrentGenerations:true,promptEnhancer:true,assetLibrary:true,videoAssets:true,spending:false,generationDeletion:true,failedGenerationDeletion:true,mediaTools:false,audioGeneration:false,projectDeletion:true},projects:projectSummaries(),deletedProjects:projects.list({deleted:true}) });}
      if(url.pathname==='/api/estimate'&&req.method==='POST'){try{return send(200,await quote(await jsonBody(req,512*1024)));}catch(e){return send(200,{available:false,statusLabel:'—',reason:cleanError(e)});}}
      if(url.pathname==='/api/shoot'&&req.method==='GET')return send(200,shoot.load(url.searchParams.get('project')||undefined));
      if(url.pathname==='/api/shoot'&&req.method==='POST')return send(200,await shoot.save(await jsonBody(req,768*1024)));
      if(url.pathname==='/api/settings/media'&&req.method==='GET'){const project=projects.requireProject(url.searchParams.get('project')||undefined);return send(200,mediaPreferences.snapshot(project.id));}
      if(url.pathname==='/api/settings/media'&&req.method==='POST'){const {projectId,...settings}=await jsonBody(req,2048),project=projects.requireProject(projectId);const result=await mediaPreferences.update(settings,project.id);return send(200,result);}
      if(url.pathname==='/api/settings/media/folder'&&req.method==='POST'){const body=await jsonBody(req,2048);if(body.draft===true)return send(200,await mediaPreferences.choose('default',{draft:true}));const project=projects.requireProject(body.projectId);return send(200,await mediaPreferences.choose(project.id));}
      if(url.pathname==='/api/settings/files'&&req.method==='GET')return send(200,settingsFiles.list());
      if(url.pathname==='/api/settings/files/open'&&req.method==='POST'){const body=await jsonBody(req,2048);return send(200,await settingsFiles.open(body.id));}
      if(url.pathname==='/api/downloads/batch'&&req.method==='POST')return send(201,await batchDownloads.prepare(await jsonBody(req)));
      if(/^\/api\/downloads\/batch\/[a-f0-9]{48}$/.test(url.pathname)&&req.method==='GET'){await batchDownloads.serve(res,url.pathname.split('/').pop());return;}
      if(url.pathname==='/api/assets'&&req.method==='GET'){
        const project=url.searchParams.get('project');if(project)projects.requireProject(project,{includeDeleted:true});return send(200,{assets:assets.list(project,{deleted:url.searchParams.get('deleted')==='1'}).map(asset=>({...asset,referenceType:asset.sources.map(source=>jobs.find(job=>job.id===source.jobId)?.settings?.referenceType||source.referenceType).find(type=>['character','product','environment'].includes(type))||'character',referenceAudience:asset.sources.map(source=>referenceAudience(jobs.find(job=>job.id===source.jobId))!=='neutral'?referenceAudience(jobs.find(job=>job.id===source.jobId)):source.referenceAudience).find(value=>['women','men'].includes(value))||'neutral',outfitAudience:asset.sources.map(source=>jobs.find(job=>job.id===source.jobId)?.settings?.outfitAudience||source.outfitAudience||outfitAudience(jobs.find(job=>job.id===source.jobId))).find(value=>['women','men'].includes(value))||'neutral',characterAudience:asset.sources.map(source=>({Female:'women',Male:'men'}[jobs.find(job=>job.id===source.jobId)?.settings?.creator?.gender]||source.characterAudience)).find(value=>['women','men'].includes(value))||'neutral',category:asset.sources.some(source=>source.category==='character'||jobs.find(job=>job.id===source.jobId)?.settings?.workflow==='creator')?'character':asset.sources.some(source=>source.category==='id'||jobs.find(job=>job.id===source.jobId)?.settings?.workflow==='reference')?'id':asset.sources.some(source=>source.category==='outfit'||source.type==='generated'&&isOutfitGeneration(jobs.find(job=>job.id===source.jobId)))?'outfit':'general'}))});
      }
      if(url.pathname==='/api/assets/media'&&req.method==='GET'){await assets.serve(req,res,url.searchParams.get('id'),url.searchParams.get('download')==='1');return;}
      if(['/api/assets/remove','/api/assets/restore'].includes(url.pathname)&&req.method==='POST'){const body=await jsonBody(req);return send(200,{asset:await assets[url.pathname.endsWith('/remove')?'remove':'restore'](body.id)});}
      if(url.pathname==='/api/assets/rename'&&req.method==='POST'){const body=await jsonBody(req);return send(200,{asset:await assets.rename(body.id,body.name)});}
      if(url.pathname==='/api/media/tags'&&req.method==='POST'){
        const body=await jsonBody(req),{job,media}=findMedia(body.jobId,body.mediaId);
        const allowed=['sexy','casual','business','fitness','chic','cute'];
        if(!Array.isArray(body.tags)||body.tags.length>6||body.tags.some(tag=>!allowed.includes(tag)))throw fail('Choose valid style tags.');
        const tags=[...new Set(body.tags)];
        for(const asset of [...assets.list(),...assets.list(undefined,{deleted:true})])if(asset.sources.some(source=>source.jobId===job.id&&source.mediaId===media.id))await assets.setTags(asset.id,tags);
        media.tags=tags;await save();return send(200,{job:publicJob(job),tags});
      }
      if(url.pathname==='/api/media/rename'&&req.method==='POST'){
        const body=await jsonBody(req),{job,media}=findMedia(body.jobId,body.mediaId);
        if(typeof body.name!=='string'||!body.name.trim()||body.name.length>180)throw fail('Use a name of 1–180 characters.');
        const name=body.name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,'').trim();
        if(!name)throw fail('Enter a name.');
        for(const asset of [...assets.list(),...assets.list(undefined,{deleted:true})])if(asset.sources.some(source=>source.jobId===job.id&&source.mediaId===media.id))await assets.rename(asset.id,name);
        media.name=name;await save();return send(200,{job:publicJob(job),name});
      }
      if(url.pathname==='/api/assets'&&req.method==='POST'){
        const body=await jsonBody(req),{job,media}=findMedia(body.jobId,body.mediaId);
        if(!/^(image|video)\//.test(media.contentType))throw fail('The Asset Library saves images and videos.');
        const file=await archiveOne(job,media,{force:true});
        if(file.bytes>256*1024**2)throw fail('This file exceeds the Asset Library’s 256 MB saved-output limit.',413);
        return send(201,await assets.add({data:await readFile(file.path),contentType:media.contentType,name:media.name||body.name||`${job.modelName} · ${new Date(job.createdAt).toLocaleDateString('en-CA')}`,metadata:media,source:{type:'generated',referenceType:job.settings.workflow==='reference'?job.settings.referenceType:undefined,referenceAudience:referenceAudience(job),outfitAudience:outfitAudience(job),characterAudience:({Female:'women',Male:'men'}[job.settings.creator?.gender]||'neutral'),category:job.settings.workflow==='creator'?'character':job.settings.workflow==='reference'?'id':body.category==='outfit'||isOutfitGeneration(job)?'outfit':undefined,projectId:job.projectId,jobId:job.id,mediaId:media.id,modelName:job.modelName}}));
      }
      if(url.pathname==='/api/prompt-presets'&&req.method==='GET'){await reloadComfyKey();return send(200,{...await enhancer.config(url.searchParams.get('mode')),keyConfigured:!!legacyComfyKey});}
      if(url.pathname==='/api/enhance-prompt'&&req.method==='POST'){
        await reloadComfyKey();const body=await jsonBody(req,512*1024);const project=projects.requireProject(body.projectId);
        preparingEnhancements.set(project.id,(preparingEnhancements.get(project.id)||0)+1);
        try{return send(200,await enhancer.enhance({...body,projectId:project.id},legacyComfyKey));}finally{const remaining=preparingEnhancements.get(project.id)-1;if(remaining)preparingEnhancements.set(project.id,remaining);else preparingEnhancements.delete(project.id);}
      }
      if(url.pathname==='/api/llm/config'&&req.method==='GET'){await reloadComfyKey();return send(200,{keyConfigured:!!legacyComfyKey,shootReferenceAnalysis:true,shootConciseSubject:true,shootSubjectTypes:true,shootProductRefinement:true,detailedStructure:true,models:LLM_MODELS,limits:LLM_LIMITS});}
      if(url.pathname==='/api/llm/settings'&&req.method==='POST'){
        const body=await jsonBody(req);if(typeof body.key!=='string'||body.key.length>512||/[\r\n]/.test(body.key))throw fail('Enter a valid Comfy key.');
        comfyKey=legacyComfyKey=body.key.trim();return send(200,{keyConfigured:!!legacyComfyKey});
      }
      if(url.pathname==='/api/llm/jobs'&&req.method==='GET')return send(200,llm.list(url.searchParams.get('project')||undefined));
      if(['/api/llm/delete','/api/llm/restore'].includes(url.pathname)&&req.method==='POST')return send(200,await llm.setDeleted(await jsonBody(req),url.pathname.endsWith('/delete')));
      if(url.pathname==='/api/llm/generate'&&req.method==='POST'){
        await reloadComfyKey();const body=await jsonBody(req,256*1024);
        if(!Array.isArray(body.referenceIds)||body.referenceIds.length>LLM_LIMITS.frames||new Set(body.referenceIds).size!==body.referenceIds.length)throw fail('Invalid reference list.');
        const refs=body.referenceIds.map(id=>uploads.get(id));if(refs.some(r=>!r))throw fail('A reference expired. Import your images or video again.');
        return send(202,{job:await llm.submit(body,refs,legacyComfyKey)});
      }
      if(url.pathname==='/api/projects'&&req.method==='GET')return send(200,{projects:projectSummaries(),deletedProjects:projects.list({deleted:true})});
      if(url.pathname==='/api/projects'&&req.method==='POST'){const body=await jsonBody(req);if(body.type==='create')mediaPreferences.validateNew(body.mediaStorage);const project=await projects.mutate(body);if(body.type==='create')await mediaPreferences.initialize(project.id,body.mediaStorage);return send(200,{project,projects:projectSummaries(),deletedProjects:projects.list({deleted:true})});}
      if(url.pathname==='/api/ideation'&&req.method==='GET')return send(200,{board:publicBoard((await boardFor(url.searchParams.get('project')||undefined)).snapshot())});
      if(url.pathname==='/api/ideation'&&req.method==='POST'){const body=await jsonBody(req,4*1024*1024);return send(200,{board:publicBoard(await(await boardFor(body.projectId)).mutate(body.operations))});}
      if (url.pathname === '/api/settings' && req.method === 'POST') {
        const body=await jsonBody(req);
        if (typeof body.key !== 'string' || body.key.length > 512 || /[\r\n]/.test(body.key)) throw fail('Enter a valid API key.');
        comfyKey=legacyComfyKey=body.key.trim(); return send(200,{keyConfigured:!!legacyComfyKey,comfyKeyConfigured:!!legacyComfyKey});
      }
      if (['/api/uploads','/api/assets/import'].includes(url.pathname) && req.method === 'POST') {
        const contentType=req.headers['content-type'],project=projects.requireProject(req.headers['x-project-id']||undefined),libraryImport=url.pathname==='/api/assets/import';
        let filename;try{filename=decodeURIComponent(req.headers['x-file-name']||'Untitled asset');}catch{throw fail('Invalid asset filename.');}
        let metadata;
        try { metadata=JSON.parse(req.headers['x-media-metadata']||'null'); } catch { throw fail('Invalid reference metadata.'); }
        if(metadata && (typeof metadata!=='object'||Array.isArray(metadata))) throw fail('Invalid reference metadata.');
        metadata=metadata?{width:metadata.width,height:metadata.height,duration:metadata.duration}:undefined;
        const limit=contentType?.startsWith('audio/')?15:contentType?.startsWith('image/')?30:200;
        const data=await readBody(req,limit*1024*1024);
        const kind=detectMedia(data,contentType);
        if(kind==='video'&&metadata){const frameCount=videoFrameCount(data);if(frameCount)metadata.frameCount=frameCount;}
        if(libraryImport&&!['image','video'].includes(kind))throw fail('Choose a PNG, JPG, WebP, MP4 or MOV file.');
        if (!libraryImport&&uploadBytes+data.length>512*1024*1024) throw fail('Staged reference files exceed the local 512 MB total limit. Remove files or use smaller versions.',413);
        let savedAsset;
        if(['image','video'].includes(kind)&&(libraryImport||req.headers['x-upload-purpose']!=='video-frame'))savedAsset=await assets.add({data,contentType,name:filename,metadata,source:{type:'upload',projectId:project.id}});
        if(libraryImport)return send(201,savedAsset);
        // Another upload can finish while the original is saved to disk.
        if(uploadBytes+data.length>512*1024*1024)throw fail('Staged reference files exceed the local 512 MB total limit. Remove files or use smaller versions.',413);
        const id=randomUUID(); uploads.set(id,{assetId:savedAsset?.asset.id,name:filename,kind,contentType,metadata,bytes:data.length,data:`data:${contentType};base64,${data.toString('base64')}`,createdAt:Date.now()}); uploadBytes+=data.length;
        return send(201,{id,kind,metadata,...(savedAsset?{assetId:savedAsset.asset.id}: {})});
      }
      if (url.pathname.startsWith('/api/uploads/') && req.method === 'DELETE') {
        const id=url.pathname.split('/').pop(); const u=uploads.get(id); if(u){ uploadBytes-=u.bytes; uploads.delete(id); } return send(200,{ok:true});
      }
      if(url.pathname==='/api/jobs'&&req.method==='GET'){const project=projects.requireProject(url.searchParams.get('project')||undefined);return send(200,{jobs:jobs.filter(j=>j.projectId===project.id&&visibleJob(j)).map(publicJob),activeProjectIds:[...new Set(jobs.filter(j=>j.tasks.some(t=>ACTIVE.has(t.status))).map(j=>j.projectId))],activeLlmProjectIds:llm.activeProjectIds(),activeEnhancementProjectIds:enhancer.activeProjectIds()});}
      if(['/api/generations/delete','/api/generations/restore'].includes(url.pathname)&&req.method==='POST')return send(200,await setDeleted(await jsonBody(req),url.pathname.endsWith('/delete')));
      if(url.pathname==='/api/archive'&&req.method==='POST'){
        const body=await jsonBody(req);const {job,media}=findMedia(body.jobId,body.mediaId);
        await archiveOne(job,media,{force:true});return send(200,{savedLocally:true});
      }
      if(url.pathname==='/api/outfit-audience'&&req.method==='POST'){
        const body=await jsonBody(req),job=jobs.find(j=>j.id===body.jobId);
        if(!job||!isOutfitGeneration(job)||!['women','men','neutral'].includes(body.outfitAudience))throw fail('Choose an outfit and its category.');
        const previous=job.settings.outfitAudience;job.settings.outfitAudience=body.outfitAudience;
        try{await save();}catch(e){job.settings.outfitAudience=previous;throw e;}
        return send(200,{outfitAudience:job.settings.outfitAudience});
      }
      if (url.pathname === '/api/favorites' && req.method === 'POST') {
        const body=await jsonBody(req);
        if(typeof body.jobId!=='string'||typeof body.mediaId!=='string'||typeof body.favorite!=='boolean')throw fail('Choose an output and a favorite status.');
        const {job,media}=findMedia(body.jobId,body.mediaId),previous=media.favorite;
        if(body.projectId!==undefined&&body.projectId!==job.projectId)throw fail('This favorite belongs to another project.');
        media.favorite=body.favorite;
        try{await save();}catch{if(media.favorite===body.favorite)media.favorite=previous;throw fail('Could not save your favorite. Check available storage and try again.',500);}
        return send(200,{mediaId:media.id,favorite:media.favorite});
      }
      if (url.pathname === '/api/generate' && req.method === 'POST') {
        await reloadComfyKey();
        if (!legacyComfyKey) throw fail('Add your Comfy API key in Settings first.',401);
        const credential=legacyComfyKey;
        const body=await jsonBody(req,512*1024);
        const project=projects.requireProject(body.projectId),ideation=await boardFor(project.id);
        if (!Array.isArray(body.referenceIds) || new Set(body.referenceIds).size!==body.referenceIds.length) throw fail('Invalid reference list.');
        if(body.destination!==undefined&&!['studio','ideation'].includes(body.destination))throw fail('Choose Create or Ideation.');
        if(body.shootBatchId!==undefined){
          if(typeof body.shootBatchId!=='string'||!/^[-a-f0-9]{36}$/.test(body.shootBatchId))throw fail('Invalid SHOOT batch.');
          const existing=jobs.find(job=>job.projectId===project.id&&job.settings.shootBatchId===body.shootBatchId&&job.settings.ratio===body.ratio);
          if(existing){await saving;return send(202,{job:publicJob(existing)});}
        }
        const canvasPosition=body.destination==='ideation'?validateCanvasPosition(body.canvasPosition):undefined;
        if(body.destination==='ideation'&&ideation.snapshot().items.length+body.count>1000)throw fail('The canvas is full. Remove an item or generate in Create.');
        const refs=body.referenceIds.map(id=>uploads.get(id));
        if (refs.some(r=>!r)) throw fail('A reference expired. Remove it and add it again.');
        if(body.workflow==='creator'){try{body.creator=creatorDefinition(body.creator);body.creatorView=body.creatorView||'head-front';body.prompt=creatorPrompt(body.creator,refs.length-(body.creatorOutfit===true?1:0),body.creatorView,MODELS.find(m=>m.id===body.model)?.family,body.creatorOutfit===true);body.ratio=creatorViewRatio(body.creatorView,MODELS.find(m=>m.id===body.model)?.family);body.count=1;}catch(e){throw fail(e.message);}if(!MODELS.find(m=>m.id===body.model&&m.mode==='image'))throw fail('Choose an image model.');}
        let config; try { config=buildInput(body,refs); } catch(e){throw fail(e.message);}
        const job={id:randomUUID(),provider:'comfy',managedBy:'v2',projectId:project.id,createdAt:new Date().toISOString(),modelName:config.model.name,mode:config.model.mode,
          settings:{ ...(body.workflow==='creator'?{workflow:'creator',creator:body.creator,creatorView:body.creatorView,creatorOutfit:body.creatorOutfit===true}:{}),...(body.workflow==='reference'?{workflow:'reference',referenceType:['product','environment'].includes(body.referenceType)?body.referenceType:'character',referenceAudience:referenceAudience({settings:{prompt:body.prompt}})}:{}),...(body.workflow==='outfit'?{workflow:'outfit',outfitAudience:['women','men','neutral'].includes(body.outfitAudience)?body.outfitAudience:outfitAudience({settings:{prompt:body.prompt}})}:{}),...(body.shootBatchId?{shootBatchId:body.shootBatchId}:{}),model:body.model,inputType:body.inputType,prompt:body.prompt.trim(),ratio:body.ratio,resolution:body.resolution,count:body.count,duration:body.duration,audio:!!body.audio,quality:config.model.qualities?(body.quality||'high'):undefined,...(config.model.creativityLevels?{creativity:body.creativity||'medium'}:{}),...(config.model.thinkingLevels?{thinking:body.thinking||'medium'}:{}),frameIndices:body.inputType==='keyframes'?body.frameIndices:undefined },
          tasks:Array.from({length:body.count},()=>({status:'SUBMITTING',idempotencyKey:randomUUID(),modelId:config.endpoint,outputs:[]}))};
        job.costEstimate=referenceBillingEstimate(body,refs);
        job.settings.references=[];
        for(const ref of refs){
          const record={assetId:ref.assetId,name:ref.name||'Reference',kind:ref.kind,contentType:ref.contentType,metadata:ref.metadata};
          if(!record.assetId){
            const bytes=Buffer.from(ref.data.slice(ref.data.indexOf(',')+1),'base64');
            record.file=createHash('sha256').update(bytes).digest('hex');
            await mkdir(join(dataDir,'reference-inputs'),{recursive:true,mode:0o700});
            await writeFile(join(dataDir,'reference-inputs',record.file),bytes,{mode:0o600});
          }
          job.settings.references.push(record);
        }
        job.pricingReferences=refs.map(ref=>({kind:ref.kind,metadata:ref.metadata}));
        if(body.destination==='ideation'){job.settings.destination='ideation';job.settings.canvasPosition=canvasPosition;}
        projects.requireProject(project.id);jobs.unshift(job);
        try { await save(); } catch(e) { jobs=jobs.filter(j=>j!==job); throw fail('Cannot save this generation to disk. Check available storage.',500); }
        run(job,config,credential).catch(()=>{});
        return send(202,{job:publicJob(job)});
      }
      if(url.pathname==='/api/generation-reference'&&req.method==='GET'){
        const job=jobs.find(job=>job.id===url.searchParams.get('job'));
        if(!job)throw fail('Generation not found.',404);
        projects.requireProject(job.projectId);
        const index=Number(url.searchParams.get('index'));
        const ref=Number.isInteger(index)&&index>=0?job.settings.references?.[index]:null;
        if(!ref)throw fail('The original input was not saved. Reattach it to reuse this generation.',404);
        if(ref.assetId){await assets.serve(req,res,ref.assetId);return;}
        if(!/^[a-f0-9]{64}$/.test(ref.file||''))throw fail('Saved input unavailable.',404);
        const bytes=await readFile(join(dataDir,'reference-inputs',ref.file)).catch(()=>{throw fail('Saved input is missing. Reattach the original file.',404);});
        res.writeHead(200,{'Content-Type':ref.contentType,'Content-Length':bytes.length,'Cache-Control':'private, no-store'});res.end(bytes);return;
      }
      if (['/api/download','/api/media'].includes(url.pathname) && req.method === 'GET') {
        let job,media;
        if(url.searchParams.has('media'))({job,media}=findMedia(url.searchParams.get('job'),url.searchParams.get('media')));
        else {job=jobs.find(j=>j.id===url.searchParams.get('job'));media=job?.tasks.flatMap(t=>t.outputs || [])[Number(url.searchParams.get('index'))];}
        if(!job||!media)throw fail('Output not found.',404);
        const referenceModel=MODELS.find(m=>m.id===url.searchParams.get('model'));
        const options={reference:url.searchParams.get('reference')==='1',referenceMB:referenceModel?referenceFileMB(referenceModel,media.contentType.startsWith('video/')?'video':'image'):undefined};
        let file=await mediaStore.inspect(job.id,media);
        if(!file&&!mediaPreferences.automatic(job.projectId)&&url.pathname==='/api/media'){
          await mediaStore.serveRemote(req,res,media,options);return;
        }
        if(!file)file=await archiveOne(job,media,{force:true});
        if(!file)throw fail('The local copy is still unavailable. Retry saving this result.',502);
        await mediaStore.serve(req,res,url,job,media,file,{reference:url.searchParams.get('reference')==='1',referenceMB:referenceModel?referenceFileMB(referenceModel,media.contentType.startsWith('video/')?'video':'image'):undefined});return;
      }
      if (req.method === 'GET' && ['/','/index.html','/app.js','/comfy-inputs.js','/comfy-pricing.js','/pricing-preview.js','/reference-pricing.js','/models.js','/style.css','/favicon.svg','/ideation.js','/canvas-library.js','/ideation.css','/canvas-state.js','/creator.js','/creator-model.js','/reference.js','/reference-model.js','/character-template.png','/product-template.png','/outfit.js','/outfit-prompt.js','/shoot.js','/shoot.css','/shoot-model.js','/llm.js','/llm.css','/llm-models.js','/prompt-enhancer.js','/assets.js','/assets.css','/library.js'].includes(url.pathname)) {
        const file=url.pathname==='/'?'/index.html':url.pathname; const ext=file.slice(file.lastIndexOf('.'));
        res.writeHead(200,{'Content-Type':MIME[ext],'Cache-Control':'no-cache'}); res.end(await readFile(join(ROOT,'public',file))); return;
      }
      send(404,{error:'Not found.'});
    } catch(e) { if (!res.headersSent) send(e.status || 500,{error:e.status?cleanError(e):'The local server encountered an error. Please try again.'}); else res.destroy(); }
  });
  server.on('close',()=>{clearInterval(timer);});
  const ready=autoArchive?archive():Promise.resolve();
  return {server,refresh,save,archive,ready};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime=await studioRuntime(ROOT);
  const {server}=await createStudio(runtime.options);
  const {port,host}=runtime;
  const openBrowser=()=>{ if(!runtime.publicOrigin&&process.env.FRAME_OPEN_BROWSER==='1' && process.platform==='darwin') execFile('/usr/bin/open',[`http://127.0.0.1:${port}`],()=>{}); };
  server.on('error',e=>{ console.error(e.code==='EADDRINUSE'?`Port ${port} is in use. Frame may already be open at http://127.0.0.1:${port}`:e.message); if(e.code==='EADDRINUSE')openBrowser(); process.exitCode=1; });
  server.listen(port,host,()=>{console.log(`Frame Studio is ready → ${runtime.publicOrigin||'http://127.0.0.1:'+port}`);openBrowser();});
}
