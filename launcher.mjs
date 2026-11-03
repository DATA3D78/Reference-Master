import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export async function studioReady(url,fetchImpl=fetch){
  try{
    const response=await fetchImpl(url+'/api/bootstrap',{signal:AbortSignal.timeout(2000)});
    if(!response.ok)return false;
    const body=await response.json();
    return (body.features?.falGeneration===true||body.features?.comfyRouter===true)&&typeof body.csrf==='string'&&typeof body.keyConfigured==='boolean'&&Array.isArray(body.models)&&body.models.some(m=>m.id==='nano-pro');
  }catch{return false;}
}
export async function waitForStudio({url='http://127.0.0.1:4322',attempts=40,interval=500,fetchImpl=fetch}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    if(await studioReady(url,fetchImpl))return {url:url+'/'};
    if(attempt+1<attempts)await delay(interval);
  }
  throw new Error('The studio has not started yet. Another app may be using port 4322. Details are in .local/service.log inside the studio folder.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try{
    const result=await waitForStudio();
    if(!process.argv.includes('--no-open'))await promisify(execFile)('/usr/bin/open',[result.url]);
    console.log(JSON.stringify(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
