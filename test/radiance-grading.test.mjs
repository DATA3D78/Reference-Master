import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GRADE_FIELDS,GRADE_GROUPS,defaultEdit,normalizeEdit,needsDepth,applyEditPreset} from '../public/editing-models.js';
import {depthPair,DepthSession} from '../public/editing-depth.js';
import {createEditingPresetStore} from '../editing-preset-store.mjs';
import {createStudio} from '../server.mjs';
test('grading exposes only the 15 requested controls and rejects invalid saved values',()=>{
 const names=['Exposure','Contrast','Highlights','Shadows','Warmth','Tint','Saturation','Vibrance','Grain','Glow','Halation','Vignette','Lens blur','Atmosphere','Relight'];
 assert.deepEqual(GRADE_FIELDS.map(f=>f[1]),names);assert.deepEqual(GRADE_GROUPS.flatMap(g=>g.keys),GRADE_FIELDS.map(f=>f[0]));
 assert(!needsDepth(defaultEdit().grade));
 for(const [key,,min,max]of GRADE_FIELDS){assert.equal(normalizeEdit({grade:{[key]:max+10}}).grade[key],max);assert.equal(normalizeEdit({grade:{[key]:min-10}}).grade[key],min);assert.equal(normalizeEdit({grade:{[key]:NaN}}).grade[key],0);}
 for(const key of ['lensBlur','atmosphere','relight'])assert(needsDepth({...defaultEdit().grade,[key]:1}));
 assert.equal(normalizeEdit({grade:{hue:20,gamma:2,sharpen:100}}).grade.gamma,undefined);
});
test('depth interpolation uses neighboring frames and rejects stale maps after seeking',()=>{
 const a={time:0},b={time:.5},c={time:1},frames=new Map([[1,c],[0,a],[.5,b]]);
 assert.deepEqual(depthPair(frames,.25),{a,b,mix:.5});assert.deepEqual(depthPair(frames,.75),{a:b,b:c,mix:.5});
 assert.equal(depthPair(frames,4),null);assert.equal(depthPair(new Map(),0),null);
 const session=new DepthSession();session.frames.set(0,a);session.state='ready';const epoch=session.epoch;session.reset();assert.equal(session.at(0),null);assert.equal(session.state,'idle');assert(session.epoch>epoch);
});
test('all new grading values survive preset save, reload and application without changing effects',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fwrd-radiance-presets-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=await createEditingPresetStore(dir),settings=defaultEdit();
 for(const [key]of GRADE_FIELDS)settings.grade[key]=key==='exposure'?.75:37;
 await store.mutate({type:'create',kind:'color',name:'Radiance test',settings});
 const preset=(await createEditingPresetStore(dir)).list()[0];assert.deepEqual(preset.settings.grade,settings.grade);
 const existing=normalizeEdit({effects:[{id:'vhs',amount:42}]});const applied=applyEditPreset(existing,preset);assert.deepEqual(applied.grade,settings.grade);assert.deepEqual(applied.effects,existing.effects);
});
test('depth runtime is available locally under a strict allowlist and supports WebAssembly CSP',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fwrd-radiance-http-')),custom=join(dir,'CUSTOM');await mkdir(custom);
 const {server}=await createStudio({dataDir:dir,key:'',keyFile:null,comfyKey:'',comfyKeyFile:null,openRouterKey:'',openRouterKeyFile:null,promptPresetDir:custom,pollMs:1e8,fetchImpl:async()=>{throw Error('No network');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
 const bootstrap=await fetch(origin+'/api/bootstrap').then(r=>r.json());assert.equal(bootstrap.features.radianceGrading,true);
 for(const path of ['/radiance-grade.js','/editing-depth.js','/editing-depth-worker.js','/vendor/depth-runtime/transformers.min.js','/vendor/depth-runtime/ort-wasm-simd-threaded.jsep.mjs','/vendor/depth-runtime/ort-wasm-simd-threaded.jsep.wasm','/vendor/depth-anything-v2-small/config.json','/vendor/depth-anything-v2-small/preprocessor_config.json','/vendor/depth-anything-v2-small/onnx/model_quantized.onnx']){
  const response=await fetch(origin+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-security-policy'),/wasm-unsafe-eval/);assert.doesNotMatch(response.headers.get('content-security-policy'),/'unsafe-eval'/);assert((await response.arrayBuffer()).byteLength>0);
 }
 for(const path of ['/vendor/radiance/README.md','/vendor/depth-runtime/package.json','/CUSTOM/FAL_API_KEY_HERE.txt']){const r=await fetch(origin+path);assert.equal(r.status,404);await r.text();}
});
