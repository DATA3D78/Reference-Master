import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {newShoot,validateShoot} from './public/shoot-model.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function createShootStore(directory,requireProject){
 const file=join(directory,'shoot-drafts.json');let state={},queue=Promise.resolve();
 try{state=JSON.parse(await readFile(file,'utf8'));if(!state||Array.isArray(state)||typeof state!=='object')throw Error();for(const record of Object.values(state)){validateShoot(record.draft);if(!Number.isSafeInteger(record.revision)||record.revision<0)throw Error();}}
 catch(error){if(error.code!=='ENOENT')throw Error('Cannot read SHOOT drafts. Preserve .local/shoot-drafts.json before repairing it.');}
 const load=projectId=>{const project=requireProject(projectId);return structuredClone(state[project.id]||{revision:0,draft:newShoot()});};
 const save=body=>{const work=queue.catch(()=>{}).then(async()=>{
  const project=requireProject(body?.projectId),old=state[project.id];
  if(body.revision!==(old?.revision||0))throw fail('SHOOT changed in another tab. Reload before editing to keep both versions safe.',409);
  let draft;try{draft=validateShoot(body.draft);}catch(error){throw fail(error.message);}
  const result={revision:(old?.revision||0)+1,draft},next={...state,[project.id]:result};
  await writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(file+'.tmp',file);state=next;return structuredClone(result);
 });queue=work;return work;};return {load,save};
}
