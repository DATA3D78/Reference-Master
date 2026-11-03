import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEditingPresetStore} from '../editing-preset-store.mjs';
import {defaultEdit,defaultEffect,presetSettings,applyEditPreset} from '../public/editing-models.js';
import {createStudio} from '../server.mjs';
const thumbnail='data:image/jpeg;base64,/9j/2Q==';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'fwrd-presets-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const create=(name='Warm grain',kind='color',settings=defaultEdit())=>({type:'create',kind,name,settings,preview:thumbnail});

test('preset application preserves the other section and never copies source media or export state',()=>{
 const original=defaultEdit();original.grade.exposure=.5;original.effects=[{...defaultEffect('glass'),size:16}];
 const chosen=defaultEdit();chosen.grade.contrast=25;chosen.grade.grain=20;chosen.curves.r=[[0,.12],[.5,.55],[1,.95]];chosen.effects=[defaultEffect('pixel'),{...defaultEffect('vhs'),amount:36}];
 chosen.source={assetId:'private-file'};chosen.exportSize=3840;
 const graded=applyEditPreset(original,{kind:'color',settings:chosen});
 assert.deepEqual(graded.effects,original.effects);assert.deepEqual(graded.grade,chosen.grade);assert.deepEqual(graded.curves,chosen.curves);
 const effected=applyEditPreset(original,{kind:'effects',settings:chosen});
 assert.deepEqual(effected.grade,original.grade);assert.deepEqual(effected.curves,original.curves);assert.deepEqual(effected.effects,chosen.effects);
 assert.equal(graded.source,undefined);assert.equal(effected.exportSize,undefined);assert.equal(original.grade.contrast,0);
 assert.deepEqual(Object.keys(presetSettings('effects',chosen)),['effects']);
 assert.throws(()=>presetSettings('video',chosen),/Choose/);
});
test('saved settings, thumbnails, names and preservation survive store restart',async t=>{
 const dir=await fixture(t),store=await createEditingPresetStore(dir),settings=defaultEdit();settings.grade.grain=29;settings.curves.b=[[0,.15],[1,.9]];
 const {preset}=await store.mutate(create(' Film / soft ', 'color',settings));settings.grade.grain=0;
 assert.equal(preset.name,'Film / soft');assert.equal(preset.settings.grade.grain,29);assert.equal(preset.settings.effects,undefined);
 await store.mutate({type:'rename',id:preset.id,name:'Film noir'});await store.mutate({type:'preserve',id:preset.id,preserved:true});
 const list=(await createEditingPresetStore(dir)).list();assert.equal(list[0].name,'Film noir');assert.equal(list[0].preserved,true);assert.equal(list[0].preview,thumbnail);assert.deepEqual(list[0].settings.curves.b,[[0,.15],[1,.9]]);
 list[0].settings.grade.grain=99;assert.equal(store.list()[0].settings.grade.grain,29);
 assert.equal((await stat(join(dir,'editing-presets.json'))).mode&0o777,0o600);
});
test('preserved presets cannot be deleted; Trash, restore and permanent delete behave independently',async t=>{
 const store=await createEditingPresetStore(await fixture(t));const {preset:p}=await store.mutate(create());
 await store.mutate({type:'preserve',id:p.id,preserved:true});await assert.rejects(store.mutate({type:'delete',id:p.id}),e=>e.status===409);
 await assert.rejects(store.mutate({type:'purge',id:p.id}),e=>e.status===409);
 const {preset:copy}=await store.mutate({type:'duplicate',id:p.id,name:'Second look'});assert.notEqual(copy.id,p.id);assert.equal(copy.preserved,false);assert.deepEqual(copy.settings,p.settings);
 await store.mutate({type:'delete',id:copy.id});assert.ok(store.list().find(x=>x.id===copy.id).deletedAt);
 await assert.rejects(store.mutate({type:'rename',id:copy.id,name:'Hidden'}),/Restore/);
 await store.mutate({type:'restore',id:copy.id});assert.equal(store.list().find(x=>x.id===copy.id).deletedAt,undefined);
 await store.mutate({type:'delete',id:copy.id});await store.mutate({type:'purge',id:copy.id});assert.equal(store.list().length,1);
 await store.mutate({type:'preserve',id:p.id,preserved:false});await store.mutate({type:'delete',id:p.id});assert.ok(store.list()[0].deletedAt);
});
test('concurrent saves and mutations retain all preset records',async t=>{
 const dir=await fixture(t),store=await createEditingPresetStore(dir);
 const results=await Promise.all(Array.from({length:8},(_,i)=>store.mutate(create('Look '+i))));assert.equal(store.list().length,8);
 await Promise.all(results.flatMap(({preset:p},i)=>[store.mutate({type:'rename',id:p.id,name:'Renamed '+i}),store.mutate({type:'preserve',id:p.id,preserved:true})]));
 const saved=(await createEditingPresetStore(dir)).list();assert.equal(saved.length,8);assert(saved.every(p=>p.name.startsWith('Renamed ')&&p.preserved));
});
test('invalid settings, oversized previews and names cannot damage existing presets',async t=>{
 const dir=await fixture(t),store=await createEditingPresetStore(dir);await store.mutate(create());
 for(const operation of [create(' '),create('x'.repeat(81)),create('Bad','audio'),{...create(),settings:null},{...create(),preview:'https://example.com/picture.jpg'},{...create(),preview:'data:image/svg+xml;base64,AAAA'},{...create(),preview:'data:image/jpeg;base64,'+'A'.repeat(120000)},{type:'rename',id:'../projects.json',name:'wrong'}])await assert.rejects(store.mutate(operation));
 assert.equal(store.list().length,1);
 const settings=defaultEdit();settings.grade.contrast=500;settings.source={assetId:'private'};
 const {preset}=await store.mutate(create('Bounded','color',settings));assert.equal(preset.settings.grade.contrast,100);assert.equal(preset.settings.source,undefined);
});
test('failed writes leave memory intact and corrupt libraries are never silently overwritten',async t=>{
 const dir=await fixture(t),store=await createEditingPresetStore(dir),file=join(dir,'editing-presets.json');
 await mkdir(file);await assert.rejects(store.mutate(create()));assert.equal(store.list().length,0);
 await rm(file,{recursive:true});await store.mutate(create());assert.equal(store.list().length,1);
 await writeFile(file,'{broken');await assert.rejects(createEditingPresetStore(dir),/Cannot read saved presets/);assert.equal(await readFile(file,'utf8'),'{broken');
});
test('presets API is local, token protected, global across projects and persistent across server restarts',async t=>{
 const dir=await fixture(t),servers=[];t.after(async()=>{for(const s of servers)if(s.listening)await new Promise(r=>s.close(r));});
 async function start(){const studio=await createStudio({dataDir:dir,key:'',openRouterKey:'',keyFile:null,openRouterKeyFile:null,autoArchive:false,pollMs:3600000,fetchImpl:async()=>{throw Error('No provider calls allowed');}});servers.push(studio.server);await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+studio.server.address().port,boot=await(await fetch(url+'/api/bootstrap')).json();return {studio,url,boot,post:(body,headers={})=>fetch(url+'/api/editing/presets',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.csrf,...headers},body:JSON.stringify(body)})};}
 const f=await start();assert.equal(f.boot.features.editingPresets,true);assert.equal(f.boot.features.effectStack,true);
 assert.equal((await f.post(create(),{'X-Studio-Token':''})).status,403);assert.equal((await f.post(create(),{Origin:'https://elsewhere.example'})).status,403);
 assert.equal((await f.post({...create(),preview:'X'.repeat(170000)})).status,413);
 const stack={effects:[{...defaultEffect('glass'),size:19},{...defaultEffect('duotone'),foreground:'#c78f54',amount:57}]};
 const saved=await f.post(create('Reusable','effects',stack));assert.equal(saved.status,200);const {preset}=await saved.json();
 assert.equal((await fetch(f.url+'/editing-presets.js')).status,200);assert.equal((await fetch(f.url+'/.local/editing-presets.json')).status,404);
 await fetch(f.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':f.boot.csrf},body:JSON.stringify({type:'create',name:'Another project'})});
 const list=await(await fetch(f.url+'/api/editing/presets')).json();assert.equal(list.presets[0].id,preset.id);
 await f.post({type:'preserve',id:preset.id,preserved:true});assert.equal((await f.post({type:'delete',id:preset.id})).status,409);
 await new Promise(r=>f.studio.server.close(r));const g=await start();const reopened=await(await fetch(g.url+'/api/editing/presets')).json();assert.equal(reopened.presets[0].name,'Reusable');assert.equal(reopened.presets[0].preserved,true);assert.deepEqual(reopened.presets[0].settings,stack);
 const duplicated=await (await g.post({type:'duplicate',id:preset.id,name:'Stack copy'})).json();assert.deepEqual(duplicated.preset.settings,stack);
 assert.deepEqual(applyEditPreset(defaultEdit(),duplicated.preset).effects,stack.effects);
});

test('legacy presets migrate on load and keep their look through rename and restart',async t=>{
 const dir=await fixture(t),store=await createEditingPresetStore(dir);
 const {preset}=await store.mutate(create('Legacy','effects'));
 const file=join(dir,'editing-presets.json'),data=JSON.parse(await readFile(file,'utf8'));
 const legacy={...defaultEffect('halftone'),size:17,foreground:'#ac7341',sourceColor:false};
 data.presets[0].settings={effect:legacy};await writeFile(file,JSON.stringify(data));
 const reopened=await createEditingPresetStore(dir);assert.deepEqual(reopened.list()[0].settings,{effects:[legacy]});
 await reopened.mutate({type:'rename',id:preset.id,name:'Vintage print'});
 const saved=(await createEditingPresetStore(dir)).list()[0];assert.deepEqual(saved.settings,{effects:[legacy]});
 assert.deepEqual(applyEditPreset(defaultEdit(),saved).effects,[legacy]);
});

test('new effects and all custom controls survive saving, duplication and restart',async t=>{
 const dir=await fixture(t),store=await createEditingPresetStore(dir),settings={effects:[{...defaultEffect('receipt-scans'),seed:87,speed:1.4},{...defaultEffect('gradient-map'),midtone:'#14a391',threshold:.28},defaultEffect('motion-freeze')]};
 const {preset}=await store.mutate(create('Print experiment','effects',settings));
 const copy=await store.mutate({type:'duplicate',id:preset.id,name:'Print experiment copy'});
 const reopened=await createEditingPresetStore(dir);
 assert.deepEqual(reopened.list().find(p=>p.id===copy.preset.id).settings,settings);
 assert.deepEqual(applyEditPreset(defaultEdit(),reopened.list()[0]).effects,settings.effects);
});
