import {lstat,mkdir,writeFile} from 'node:fs/promises';
import {basename,join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const fail=(message,status)=>Object.assign(Error(message),{status});
export async function openTextFile(path){
  await exec('/usr/bin/open',['-a','TextEdit',path]);
}

// The client chooses a fixed ID, never a filesystem path or a shell command.
// File contents (especially credentials) never pass through this endpoint.
export function createSettingsFiles({comfyKeyFile,hosted=false,platform=process.platform,openFile=openTextFile}){
  const enabled=!hosted&&platform==='darwin';
  const entries=[
    {id:'comfy',label:'Comfy API key · Reference Master',path:comfyKeyFile},
  ];
  return {
    list:()=>({enabled,files:entries.map(({id,label,path})=>({id,label,filename:path?basename(path):null,available:enabled&&!!path}))}),
    async open(id){
      if(!enabled)throw fail('Text-file links are available in the local Mac app.',403);
      const entry=entries.find(file=>file.id===id);
      if(!entry?.path)throw fail('Unknown settings file.',400);
      let file;try{file=await lstat(entry.path);}catch(error){
        if(error.code!=='ENOENT')throw error;
        if(id==='comfy'){
          await mkdir(dirname(entry.path),{recursive:true});
          try{await writeFile(entry.path,'# Paste your own Comfy Router API key on the next line.\n',{flag:'wx',mode:0o600});}
          catch(createError){if(createError.code!=='EEXIST')throw createError;}
          file=await lstat(entry.path);
        }
      }
      if(!file?.isFile())throw fail('This settings file is missing or is a shortcut. Reopen the app to restore its settings files.',409);
      try{await openFile(entry.path);}catch{throw fail('The file could not open in TextEdit. Use the FS menu to open API keys & prompt settings.',500);}
      return {opened:true,filename:basename(entry.path)};
    },
  };
}
