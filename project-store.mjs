import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const DEFAULT_PROJECT='default';
const fail=message=>Object.assign(new Error(message),{status:400});
const name=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw fail('Name your project using 1–80 characters.');return value.trim();};
export async function createProjectStore(directory,{beforeDelete=()=>{}}={}){
  const file=join(directory,'projects.json');let queue=Promise.resolve(),state;const deleting=new Set();
  try{state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!Array.isArray(state.projects)||!state.projects.some(p=>p.id===DEFAULT_PROJECT)||new Set(state.projects.map(p=>p.id)).size!==state.projects.length||state.projects.some(p=>!/^([a-z0-9-]{1,64})$/.test(p.id)||name(p.name)!==p.name))throw Error('Invalid projects');}
  catch(e){if(e.code!=='ENOENT')throw Error('Cannot read saved projects. Preserve .local/projects.json before repairing it.');state={version:1,projects:[{id:DEFAULT_PROJECT,name:'My first project',createdAt:new Date().toISOString()}]};await writeFile(file,JSON.stringify(state),{mode:0o600});}
  const list=({deleted=false}={})=>structuredClone(state.projects.filter(p=>!!p.deletedAt===deleted));
  const requireProject=(value, {includeDeleted=false}={})=>{const project=state.projects.find(p=>p.id===(value===undefined?state.projects.find(p=>!p.deletedAt)?.id:value));if(!project||(!includeDeleted&&(project.deletedAt||deleting.has(project.id))))throw fail('Choose an existing project.');return structuredClone(project);};
  const mutate=operation=>{const work=queue.catch(()=>{}).then(async()=>{
    if(!operation||typeof operation!=='object'||(operation.type!=='create'&&typeof operation.id!=='string'))throw fail('Choose a valid project action.');
    const draft=structuredClone(state);let project;
    if(operation.type==='create'){if(list().length>=200)throw fail('You can keep up to 200 active projects.');project={id:randomUUID(),name:name(operation.name),createdAt:new Date().toISOString()};draft.projects.push(project);}
    else if(operation.type==='rename'){requireProject(operation.id);project=draft.projects.find(p=>p.id===operation.id);project.name=name(operation.name);}
    else if(operation.type==='delete'){
      requireProject(operation.id);beforeDelete(operation.id);project=draft.projects.find(p=>p.id===operation.id);project.deletedAt=new Date().toISOString();
      if(!draft.projects.some(p=>!p.deletedAt))draft.projects.push({id:randomUUID(),name:'My first project',createdAt:new Date().toISOString()});
      deleting.add(project.id);
    }
    else if(operation.type==='restore'){
      requireProject(operation.id,{includeDeleted:true});project=draft.projects.find(p=>p.id===operation.id);
      if(project.deletedAt&&list().length>=200)throw fail('You can keep up to 200 active projects.');delete project.deletedAt;
    }
    else throw fail('Choose a valid project action.');
    try{await writeFile(file+'.tmp',JSON.stringify(draft),{mode:0o600});await rename(file+'.tmp',file);state=draft;return structuredClone(project);}finally{deleting.delete(project.id);}
  });queue=work;return work;};
  return {list,requireProject,mutate};
}
