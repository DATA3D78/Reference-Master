import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyUpdate,checkRestart,currentStudio} from '../launcher/apply-update.mjs';
import {MODELS} from '../public/models.js';
const ready={config:{features:{comfyRouter:true},csrf:'test-token',models:[{id:'nano-pro'}]},jobs:[{tasks:[{status:'COMPLETED'}]}],cwd:'/studio',command:'/runtime/bin/node',appRoot:'/studio'};
test('manual updater only restarts the identified studio when no generation is active',()=>{
  assert.doesNotThrow(()=>checkRestart(ready));
  assert.throws(()=>checkRestart({...ready,activeLlmProjectIds:['default']}),/still running/);
  assert.throws(()=>checkRestart({...ready,activeEnhancementProjectIds:['default']}),/still running/);
  assert.throws(()=>checkRestart({...ready,activeProjectIds:['another-project']}),/still running/);
  for(const status of ['SUBMITTING','IN_QUEUE','IN_PROGRESS'])assert.throws(()=>checkRestart({...ready,jobs:[{tasks:[{status}]}]}),/still running/);
  assert.throws(()=>checkRestart({...ready,cwd:'/different-app'}),/different app/);
  assert.throws(()=>checkRestart({...ready,command:'/bin/other'}),/different app/);
  assert.throws(()=>checkRestart({...ready,config:{}}),/not the expected studio/);
  assert.throws(()=>checkRestart({...ready,jobs:undefined}),/Cannot verify/);
});
test('updater resumes only accepted Comfy requests whose IDs and credentials are saved',()=>{
 const job={id:'job',projectId:'default',provider:'comfy',tasks:[{status:'IN_PROGRESS',requestId:'accepted-request'}]};
 const state={...ready,jobs:[job],activeProjectIds:['default'],comfyKeySaved:true,savedJobs:[{...job,tasks:[{...job.tasks[0],modelId:'byteplus/seedream-5'}]}]};
 assert.deepEqual(checkRestart(state),{resuming:1});
 for(const patch of [{comfyKeySaved:false},{savedJobs:[]},{activeLlmProjectIds:['default']},{activeEnhancementProjectIds:['default']},{activeProjectIds:['other']},{jobs:[{...job,tasks:[{status:'SUBMITTING'}]}]},{jobs:[{...job,provider:'fal'}]},{savedJobs:[{...job,tasks:[{...job.tasks[0],requestId:'different'}]}]}])assert.throws(()=>checkRestart({...state,...patch}),/still running/);
});
test('updater detects older model catalogs even when projects are already active',()=>{
  const config={features:{shoot:true,shootRefinement:true,shootReferenceAnalysis:true,shootConciseSubject:true,shootSubjectTypes:true,shootProductRefinement:true,falGeneration:true,comfyRouter:false,hybridProviders:true,referencePricing:true,settingsFiles:true,effectStack:true,expandedEffects:true,radianceGrading:true,h264EditingExport:true,editingPresets:true,localEditing:true,customFolder:true,pricingReview:true,canvasAssets:true,assetRemoval:true,projectDownloadNames:true,detailedLlmStructure:true,llmConnectionFix:true,seedvrVideo:true,llmDeletion:true,batchDownloads:true,projects:true,canvasGroups:true,savedApiKey:true,llm:true,concurrentGenerations:true,promptEnhancer:true,assetLibrary:true,videoAssets:true,spending:true,generationDeletion:true,failedGenerationDeletion:true,mediaTools:true,audioGeneration:true,projectDeletion:true},models:MODELS};
  assert(currentStudio(config));
  assert(!currentStudio({...config,features:{...config.features,h264EditingExport:false}}));
  assert(!currentStudio({...config,features:{...config.features,shootProductRefinement:false}}));
  assert(!currentStudio({...config,features:{...config.features,expandedEffects:false}}));
  assert(!currentStudio({...config,features:{...config.features,radianceGrading:false}}));
  assert(!currentStudio({...config,features:{...config.features,shootConciseSubject:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,editingPresets:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,effectStack:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,localEditing:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,customFolder:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,assetRemoval:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,canvasAssets:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,pricingReview:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,projectDownloadNames:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,detailedLlmStructure:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,llmConnectionFix:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,seedvrVideo:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,llmDeletion:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,batchDownloads:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,videoAssets:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,audioGeneration:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,mediaTools:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,failedGenerationDeletion:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,projectDeletion:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,generationDeletion:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,concurrentGenerations:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,promptEnhancer:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,assetLibrary:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,...config.features,spending:false}}));
  assert(!currentStudio({...config,features:{comfyRouter:true,projects:true,canvasGroups:true}}));
  assert(!currentStudio({...config,models:MODELS.filter(m=>m.id!=='nano21')}));
  assert(!currentStudio({...config,models:MODELS.map(m=>m.id==='nano-pro'?{...m,maxPrompt:5000}:m)}));
  assert(!currentStudio({...config,models:MODELS.map(m=>m.id==='krea2-large'?{...m,endpoints:{text:'wrong'}}:m)}));
});

const latest={...ready.config,models:MODELS,features:Object.fromEntries([
  'shoot','shootRefinement','shootReferenceAnalysis','shootConciseSubject','shootSubjectTypes','shootProductRefinement','falGeneration','comfyRouter','hybridProviders','referencePricing','settingsFiles','effectStack','expandedEffects','radianceGrading','h264EditingExport','editingPresets','localEditing','customFolder','pricingReview','canvasAssets','assetRemoval',
  'projectDownloadNames','detailedLlmStructure','llmConnectionFix','seedvrVideo',
  'llmDeletion','batchDownloads','projects','canvasGroups','savedApiKey','llm',
  'concurrentGenerations','promptEnhancer','assetLibrary','videoAssets','spending',
  'generationDeletion','failedGenerationDeletion','mediaTools','audioGeneration','projectDeletion'
].map(name=>[name,true]))};
const offline=()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('connect ECONNREFUSED'),{code:'ECONNREFUSED'})});};
async function updaterHarness(overrides={}){
  const events=[];let started=false;
  const options={
    appRoot:'/studio',attempts:3,wait:async()=>{},log:message=>events.push(['log',message]),
    read:async()=>started?latest:offline(),isPortBusy:async()=>false,
    identify:async()=>({pid:123,cwd:ready.cwd,command:ready.command}),
    stop:async pid=>events.push(['stop',pid]),
    launch:async()=>{events.push(['launch']);started=true;},
    openStudio:async()=>events.push(['open']),...overrides
  };
  return {events,run:()=>applyUpdate(options)};
}
test('updater cold-starts a closed studio after fetch failed and opens only once ready',async()=>{
  const h=await updaterHarness();await h.run();
  assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[['launch'],['open']]);
  assert(h.events.some(e=>e[1]?.includes('studio is stopped')));
});
test('updater opens an already current studio without restarting it',async()=>{
  const h=await updaterHarness({read:async path=>{assert.equal(path,'/api/bootstrap');return latest;}});
  await h.run();assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[['open']]);
});
test('updater does not launch or stop a server on an occupied, unverified port',async()=>{
  const h=await updaterHarness({read:offline,isPortBusy:async()=>true});
  await assert.rejects(h.run,/listening on port 4322.*Nothing was stopped/);
  assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[]);
});
test('updater reports local network access failure without stopping or starting anything',async()=>{
  const h=await updaterHarness({read:offline,isPortBusy:async()=>{throw Error('EPERM');}});
  await assert.rejects(h.run,/local connections are allowed/);
  assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[]);
});
test('updater refuses a different application even if its port responds with JSON',async()=>{
  const h=await updaterHarness({read:async()=>({status:'ok'})});
  await assert.rejects(h.run,/not the expected studio/);
  assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[]);
});
test('updater restarts the verified idle studio and tolerates temporary connection failures',async()=>{
  let bootstraps=0;
  const h=await updaterHarness({read:async path=>{
    if(path==='/api/jobs')return {jobs:ready.jobs};
    if(++bootstraps===1)return ready.config;
    if(bootstraps===2)return offline();
    return latest;
  }});
  await h.run();assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[['stop',123],['launch'],['open']]);
});
test('updater leaves active generations and unreadable job status alone',async()=>{
  for(const activity of [{jobs:ready.jobs,activeProjectIds:['another-project']},{}]){
    const h=await updaterHarness({read:async path=>path==='/api/jobs'?activity:ready.config});
    await assert.rejects(h.run,/still running|Cannot verify/);
    assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[]);
  }
});
test('updater explains failure to launch and startup timeout rather than fetch failed',async()=>{
  const noLaunch=await updaterHarness({launch:async()=>{throw Error('open failed');}});
  await assert.rejects(noLaunch.run,/macOS could not open FWRD.STUDIO.V2.app/);
  const neverReady=await updaterHarness({read:offline});
  await assert.rejects(neverReady.run,/did not finish starting.*service.log/);
  assert.deepEqual(neverReady.events.filter(e=>e[0]!=='log'),[['launch']]);
});
test('updater surfaces a browser-open failure after startup without claiming startup failed',async()=>{
  const h=await updaterHarness({openStudio:async()=>{throw Error('browser unavailable');}});
  await assert.rejects(h.run,/browser unavailable/);
  assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[['launch']]);
});
test('updater respects a refused restart and does not attempt another way to stop the studio',async()=>{
  const h=await updaterHarness({
    read:async path=>path==='/api/jobs'?{jobs:ready.jobs}:ready.config,
    stop:async()=>{throw Object.assign(Error('not permitted'),{code:'EPERM'});}
  });
  await assert.rejects(h.run,/macOS did not allow it to stop/);
  assert.deepEqual(h.events.filter(e=>e[0]!=='log'),[]);
});
