import {readFile,stat} from 'node:fs/promises';

// This file is read by the local server only, never served to the browser.
export async function readSavedApiKey(path,label='CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt',provider='Comfy'){
  if(!path)return '';
  let text;
  try{
    if((await stat(path)).size>4096)throw new Error('format');
    text=await readFile(path,'utf8');
  }catch(error){
    if(error.code==='ENOENT')return '';
    throw new Error(`Cannot read ${label}. Save it as a plain-text file containing only your ${provider} key and optional # comments.`);
  }
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  if(lines.length>1||lines.some(line=>line.length>512||/\s/.test(line)))throw new Error(`${label} must contain one API key on its own line.`);
  return lines[0]||'';
}
