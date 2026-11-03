import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {presetSettings} from './public/editing-models.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const name=value=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw fail('Name your preset using 1–80 characters.');
 return value.trim();
};
const preview=value=>{
 if(value===undefined||value==='')return '';
 if(typeof value!=='string'||value.length>110000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw fail('The preset preview must be a small JPEG.');
 const bytes=Buffer.from(value.split(',')[1],'base64');
 if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw fail('The preset preview is not a JPEG.');
 return value;
};
const kind=value=>{if(!['color','effects'].includes(value))throw fail('Choose Color Grading or Effects.');return value;};

export async function createEditingPresetStore(directory){
 const file=join(directory,'editing-presets.json');let state={version:1,presets:[]},queue=Promise.resolve();
 try{
  state=JSON.parse(await readFile(file,'utf8'));
  if(state.version!==1||!Array.isArray(state.presets)||new Set(state.presets.map(p=>p.id)).size!==state.presets.length)throw Error('Invalid preset library');
  for(const p of state.presets){
   if(!/^[a-f0-9-]{36}$/.test(p.id)||name(p.name)!==p.name||kind(p.kind)!==p.kind||typeof p.preserved!=='boolean'||!p.settings||typeof p.settings!=='object'||!Number.isFinite(Date.parse(p.createdAt))||!Number.isFinite(Date.parse(p.updatedAt))||(p.deletedAt&&!Number.isFinite(Date.parse(p.deletedAt))))throw Error('Invalid preset');
   preview(p.preview);p.settings=presetSettings(p.kind,p.settings);
  }
 }catch(e){if(e.code!=='ENOENT')throw Error('Cannot read saved presets. Preserve .local/editing-presets.json before repairing it.');}
 const list=()=>structuredClone(state.presets);
 const mutate=operation=>{
  const work=queue.catch(()=>{}).then(async()=>{
   if(!operation||typeof operation!=='object')throw fail('Choose a valid preset action.');
   const draft=structuredClone(state),now=new Date().toISOString();let preset;
   const find=()=>{const found=draft.presets.find(p=>p.id===operation.id);if(!found)throw fail('This preset is no longer available. Refresh the gallery.',404);return found;};
   const capacity=()=>{if(draft.presets.length>=500)throw fail('Your gallery has 500 presets. Remove unused presets from Trash before saving more.');};
   if(operation.type==='create'){
    capacity();const category=kind(operation.kind);
    if(!operation.settings||typeof operation.settings!=='object'||Array.isArray(operation.settings))throw fail('Preset settings are missing.');
    preset={id:randomUUID(),name:name(operation.name),kind:category,settings:presetSettings(category,operation.settings),preview:preview(operation.preview),preserved:false,createdAt:now,updatedAt:now};
    draft.presets.push(preset);
   }else{
    preset=find();
    if(preset.deletedAt&&!['restore','purge'].includes(operation.type))throw fail('Restore this preset from Trash first.',409);
    if(operation.type==='rename')preset.name=name(operation.name);
    else if(operation.type==='preserve'){
     if(typeof operation.preserved!=='boolean')throw fail('Choose whether to preserve this preset.');
     preset.preserved=operation.preserved;
    }else if(operation.type==='duplicate'){
     capacity();preset={...structuredClone(preset),id:randomUUID(),name:name(operation.name),preserved:false,createdAt:now,updatedAt:now};draft.presets.push(preset);
    }else if(operation.type==='delete'){
     if(preset.preserved)throw fail('Unpreserve this preset before deleting it.',409);
     preset.deletedAt=now;
    }else if(operation.type==='restore')delete preset.deletedAt;
    else if(operation.type==='purge'){
     if(!preset.deletedAt||preset.preserved)throw fail('Only presets in Trash can be permanently deleted.',409);
     draft.presets=draft.presets.filter(p=>p.id!==preset.id);
    }else throw fail('Choose a valid preset action.');
    preset.updatedAt=now;
   }
   try{
    await writeFile(file+'.tmp',JSON.stringify(draft),{mode:0o600});await rename(file+'.tmp',file);
   }catch(e){await rm(file+'.tmp',{force:true}).catch(()=>{});throw e;}
   state=draft;return {preset:structuredClone(preset),presets:list()};
  });queue=work;return work;
 };
 return {list,mutate};
}
