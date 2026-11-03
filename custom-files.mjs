import {lstat,readlink,stat,unlink,link,chmod} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';

export const API_KEY_FILES={comfy:'COMFY_API_KEY_HERE.txt',fal:'FAL_API_KEY_HERE.txt',openrouter:'OPENROUTER_API_KEY_HERE.txt'};
export const CUSTOM_FILES=['IMAGE_PROMPT_PRESETS.txt','VIDEO_PROMPT_PRESETS.txt',API_KEY_FILES.fal,API_KEY_FILES.openrouter];
export function customPaths(root){
  const directory=join(root,'CUSTOM');
  return {comfyKeyFile:join(directory,API_KEY_FILES.comfy),keyFile:join(directory,API_KEY_FILES.fal),falKeyFile:join(directory,API_KEY_FILES.fal),openRouterKeyFile:join(directory,API_KEY_FILES.openrouter),promptPresetDir:directory};
}

// Link then unlink gives rename semantics without ever replacing a newer file.
// If both names already exist, retain both and use the new name.
export async function migrateApiKeyFile(path){
  if(!path)return;
  const legacyName=({[API_KEY_FILES.fal]:'API_KEY.txt',[API_KEY_FILES.openrouter]:'OPENROUTER_API_KEY.txt'})[basename(path)];
  if(!legacyName)return;
  const legacy=join(dirname(path),legacyName);
  try{
    if(!(await lstat(legacy)).isFile())return;
    await link(legacy,path);
    await chmod(path,0o600);
    await unlink(legacy);
  }catch(error){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}
}

// The move leaves temporary links for a server still using the old paths.
// Remove only those exact links after the updated server has started.
export async function removeLegacyCustomLinks(root){
  for(const name of [...CUSTOM_FILES,'API_KEY.txt','OPENROUTER_API_KEY.txt']){
    const legacy=join(root,name),target=join(root,'CUSTOM',name);
    try{
      if(!(await lstat(legacy)).isSymbolicLink())continue;
      if(resolve(root,await readlink(legacy))!==resolve(target))continue;
      if((await stat(target)).isFile())await unlink(legacy);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
