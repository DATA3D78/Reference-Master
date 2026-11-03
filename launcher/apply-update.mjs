// Run by the user through Apply Studio Update.command, never during generation.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,basename,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {MODELS} from '../public/models.js';
import {portIsBusy} from '../service.mjs';
import {readFile} from 'node:fs/promises';
import {readSavedApiKey} from '../api-key-file.mjs';
import {customPaths} from '../custom-files.mjs';
const exec=promisify(execFile);
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const address='http://127.0.0.1:4322';
async function get(path){const response=await fetch(address+path,{signal:AbortSignal.timeout(2500)});if(!response.ok)throw Error(`The local studio returned HTTP ${response.status}.`);return response.json();}
function checkStudio(config){
  if((config?.features?.falGeneration!==true&&config?.features?.comfyRouter!==true)||typeof config?.csrf!=='string'||!Array.isArray(config.models)||!config.models.some(m=>m.id==='nano-pro'))throw Error('Port 4322 is not the expected studio. Nothing was stopped.');
}
export function currentStudio(config){return !!(config.features?.h264EditingExport&&config.features?.radianceGrading&&config.features?.shootProductRefinement&&config.features?.shootSubjectTypes&&config.features?.shootConciseSubject&&config.features?.shootReferenceAnalysis&&config.features?.shootRefinement&&config.features?.shoot&&config.features?.falGeneration&&config.features?.referencePricing&&config.features?.settingsFiles&&config.features?.effectStack&&config.features?.expandedEffects&&config.features?.editingPresets&&config.features?.localEditing&&config.features?.customFolder&&config.features?.pricingReview&&config.features?.canvasAssets&&config.features?.assetRemoval&&config.features?.projectDownloadNames&&config.features?.detailedLlmStructure&&config.features?.llmConnectionFix&&config.features?.seedvrVideo&&config.features?.llmDeletion&&config.features?.batchDownloads&&config.features?.projects&&config.features?.canvasGroups&&config.features?.savedApiKey&&config.features?.llm&&config.features?.concurrentGenerations&&config.features?.promptEnhancer&&config.features?.assetLibrary&&config.features?.videoAssets&&config.features?.spending&&config.features?.generationDeletion&&config.features?.failedGenerationDeletion&&config.features?.mediaTools&&config.features?.audioGeneration&&config.features?.projectDeletion&&MODELS.filter(m=>m.available).every(expected=>config.models?.some(m=>m.id===expected.id&&m.maxPrompt===expected.maxPrompt&&JSON.stringify(m.promptLimits)===JSON.stringify(expected.promptLimits)&&m.maxImages===expected.maxImages&&JSON.stringify(m.endpoints)===JSON.stringify(expected.endpoints))));}
export function checkRestart({config,jobs,activeProjectIds=[],activeLlmProjectIds=[],activeEnhancementProjectIds=[],cwd,command,appRoot,savedJobs=[],comfyKeySaved=false,falKeySaved=false}){
  checkStudio(config);
  if(!Array.isArray(jobs)||jobs.some(j=>!Array.isArray(j.tasks)))throw Error('Cannot verify generation status. Nothing was stopped.');
  if(cwd!==appRoot||basename(command)!=='node')throw Error('The listener belongs to a different app. Nothing was stopped.');
  const running=jobs.flatMap(job=>job.tasks.filter(t=>['SUBMITTING','IN_QUEUE','IN_PROGRESS'].includes(t.status)).map(task=>({job,task})));
  const resumable=({job,task})=>(job.provider==='comfy'?comfyKeySaved:job.provider==='fal'&&falKeySaved)&&['IN_QUEUE','IN_PROGRESS'].includes(task.status)&&typeof task.requestId==='string'&&savedJobs.some(saved=>saved.id===job.id&&saved.projectId===job.projectId&&saved.provider===job.provider&&(job.provider!=='fal'||saved.managedBy==='v2')&&saved.tasks?.some(t=>t.requestId===task.requestId&&['IN_QUEUE','IN_PROGRESS'].includes(t.status)&&typeof t.modelId==='string'&&t.modelId.includes('/')));
  if(activeLlmProjectIds.length||activeEnhancementProjectIds.length||activeProjectIds.some(id=>!running.some(r=>r.job.projectId===id))||running.some(r=>!resumable(r)))throw Error('A submission, LLM analysis or generation that cannot safely resume is still running. Wait for it to finish, then open this updater again.');
  return {resuming:running.length};
}
async function identifyServer(){
  const {stdout:listeners}=await exec('/usr/sbin/lsof',['-n','-t','-iTCP:4322','-sTCP:LISTEN']);
  const pids=[...new Set(listeners.trim().split(/\s+/))];
  if(pids.length!==1||!/^\d+$/.test(pids[0]))throw Error('Could not identify one studio server. Nothing was stopped.');
  const pid=Number(pids[0]);
  const [{stdout:cwdInfo},{stdout:command}]=await Promise.all([exec('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn']),exec('/bin/ps',['-p',String(pid),'-o','comm='])]);
  const cwd=cwdInfo.split('\n').find(line=>line.startsWith('n'))?.slice(1);
  return {pid,cwd,command:command.trim()};
}

// Injectable operations let tests exercise startup and restart without touching
// the user's server, projects, keys or browser.
export async function applyUpdate({
  read=get,isPortBusy=()=>portIsBusy(4322),identify=identifyServer,
  readRestartState=async()=>({savedJobs:JSON.parse(await readFile(join(root,'.local','jobs.json'),'utf8')),comfyKeySaved:!!await readSavedApiKey(customPaths(root).comfyKeyFile,'CUSTOM/COMFY_API_KEY_HERE.txt','Comfy'),falKeySaved:!!await readSavedApiKey(customPaths(root).keyFile)}),
  stop=pid=>process.kill(pid,'SIGTERM'),
  launch=()=>exec('/usr/bin/open',[join(root,'FWRD.STUDIO.V2.app')]),
  openStudio=()=>exec('/usr/bin/open',[address]),
  wait=delay,log=console.log,attempts=60,appRoot=root
}={}){
  log('FWRD.STUDIO.V2 — Activate the update\n');
  let config;
  try{config=await read('/api/bootstrap');}
  catch{
    // A closed studio is a normal starting state. Never treat an occupied but
    // unresponsive port as permission to kill a process.
    let occupied;
    try{occupied=await isPortBusy();}
    catch{throw Error('Cannot reach the local studio on port 4322. Check that local connections are allowed, then try again. Nothing was stopped.');}
    if(occupied)throw Error('A server is listening on port 4322, but the studio could not be verified. Wait for it to finish starting and try again. Details are in .local/service.log. Nothing was stopped.');
    log('The studio is stopped. Starting it with the latest update…');
  }
  if(config!==undefined){
    checkStudio(config);
    if(currentStudio(config)){
      log('The latest studio update is already active. Opening your studio…');
      await openStudio();return;
    }
    let activity,server;
    try{activity=await read('/api/jobs');server=await identify();}
    catch{throw Error('Cannot verify the studio and its running generations. Nothing was stopped. Try again after the studio has finished loading.');}
    let recovery={};
    if(activity.jobs?.some(job=>job.tasks?.some(t=>['IN_QUEUE','IN_PROGRESS'].includes(t.status)))){
      try{recovery=await readRestartState();}catch{throw Error('Cannot verify saved generation requests. Nothing was stopped. Wait for them to finish, then try again.');}
    }
    const {resuming}=checkRestart({config,...activity,...server,...recovery,appRoot});
    if(resuming)log(`${resuming} provider request${resuming===1?' is':'s are'} still processing remotely. Their saved request IDs will resume checking after restart; no request will be cancelled or resubmitted.`);
    if(config.keyConfigured)log('Saved keys in CUSTOM load automatically. Session-only keys need to be reconnected after restarting.');
    log('Restarting the studio. Saved media, favorites and canvas data stay in place.');
    try{await stop(server.pid);}
    catch{throw Error('The studio could not be restarted because macOS did not allow it to stop. Quit FWRD.STUDIO.V2 from its FS menu, then run this updater again.');}
  }
  try{await launch();}
  catch{throw Error('macOS could not open FWRD.STUDIO.V2.app. Open the app beside this updater to start the studio.');}
  for(let i=0;i<attempts;i++){
    await wait(500);
    let ready=false;
    try{const next=await read('/api/bootstrap');checkStudio(next);ready=currentStudio(next);}catch{}
    if(ready){
      log('The update is ready. Opening your studio…');
      await openStudio();return;
    }
  }
  throw Error('The studio did not finish starting with the update. Open FWRD.STUDIO.V2.app again. If it still cannot start, check .local/service.log inside the studio folder.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)applyUpdate().catch(error=>{console.error(error.message);process.exitCode=1;});
