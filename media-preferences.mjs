import {readFile,writeFile,rename,mkdir,realpath,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function createMediaPreferences({dataDir,projectIds=['default'],hosted=false,platform=process.platform,pickFolder}){
 const file=join(dataDir,'media-preferences.json'),legacyDirectory=join(dataDir,'media');
 const initial={automatic:true,directory:legacyDirectory,directories:[legacyDirectory]};
 let state={version:2,projects:Object.fromEntries(projectIds.map(id=>[id,{...initial}]))},queue=Promise.resolve(),choosing=false;
 const drafts=new Map();
 const valid=s=>s&&typeof s.automatic==='boolean'&&isAbsolute(s.directory)&&Array.isArray(s.directories)&&s.directories.every(isAbsolute);
 try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.version===1&&valid(saved))state={version:2,projects:Object.fromEntries(projectIds.map(id=>[id,{automatic:saved.automatic,directory:saved.directory,directories:saved.directories}]))};
  else if(saved.version===2&&saved.projects&&Object.values(saved.projects).every(valid))state=saved;
  else throw Error('Invalid media storage settings');
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const value=(id='default')=>state.projects[id]||{automatic:false,directory:join(legacyDirectory,id),directories:[join(legacyDirectory,id),legacyDirectory]};
 const snapshot=(id='default')=>({projectId:id,automatic:value(id).automatic,directory:hosted?null:value(id).directory,folderPicker:!hosted&&platform==='darwin',hosted});
 function commit(change){const task=queue.catch(()=>{}).then(async()=>{const next=change(state);await writeFile(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(file+'.tmp',file);state=next;});queue=task;return task;}
 function validateNew(body={}){if(typeof body!=='object'||body===null||Object.keys(body).some(k=>!['automatic','folderToken'].includes(k))||body.automatic!==undefined&&typeof body.automatic!=='boolean')throw fail('Invalid project storage settings.');if(body.folderToken&&(!drafts.has(body.folderToken)||drafts.get(body.folderToken).expires<Date.now()))throw fail('Choose the project folder again.');}
 const projectFolder=(parent,id)=>join(parent,'FWRD.STUDIO Media',id);
 return {
  snapshot,validateNew,directory:id=>value(id).directory,directories:id=>[...new Set([value(id).directory,...value(id).directories,legacyDirectory])],automatic:id=>value(id).automatic,
  async initialize(id,body={}){
   validateNew(body);const selected=body.folderToken?drafts.get(body.folderToken).parent:null;
   const directory=selected?projectFolder(selected,id):join(legacyDirectory,id);
   await mkdir(directory,{recursive:true,mode:0o700});await access(directory,constants.W_OK);
   await commit(s=>({...s,projects:{...s.projects,[id]:{automatic:body.automatic??false,directory,directories:[directory,legacyDirectory]}}}));
   if(body.folderToken)drafts.delete(body.folderToken);return snapshot(id);
  },
  async update(body,id='default'){
   if(typeof body.automatic!=='boolean'||Object.keys(body).some(k=>k!=='automatic'))throw fail('Choose whether to save media automatically.');
   await commit(s=>({...s,projects:{...s.projects,[id]:{...value(id),automatic:body.automatic}}}));return snapshot(id);
  },
  async choose(id='default',{draft=false}={}){
   if(hosted||platform!=='darwin')throw fail('Folder selection is available in the local Mac app.',403);
   if(choosing)throw fail('A folder chooser is already open.',409);choosing=true;
   try{
    const selected=await pickFolder();if(!selected)return {...snapshot(id),cancelled:true};
    if(!isAbsolute(selected))throw fail('Choose a folder on this computer.');
    const parent=await realpath(selected);await access(parent,constants.W_OK);
    if(draft){for(const [key,v] of drafts)if(v.expires<Date.now())drafts.delete(key);const folderToken=randomUUID();drafts.set(folderToken,{parent,expires:Date.now()+3600000});return {folderToken,directory:parent};}
    const directory=projectFolder(parent,id);await mkdir(directory,{recursive:true,mode:0o700});await access(directory,constants.W_OK);
    await commit(s=>({...s,projects:{...s.projects,[id]:{...value(id),directory,directories:[...new Set([...value(id).directories,value(id).directory,directory])]}}}));return snapshot(id);
   }finally{choosing=false;}
  }
 };
}
export function nativeMediaFolderPicker(executable){return async()=>{try{const {stdout}=await exec(executable,[],{timeout:300000,maxBuffer:65536});return stdout.trim()||null;}catch(e){if(e.code===2)return null;throw fail('The folder chooser could not open. Try again from the V2 Mac launcher.',500);}};}
