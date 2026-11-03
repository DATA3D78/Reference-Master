import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,open,lstat,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';
import {byteRange} from './media-store.mjs';
import {assetDownloadName,downloadDisposition} from './public/library.js';
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const cleanName=name=>String(name||'Untitled asset').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,180)||'Untitled asset';
const dimensions=metadata=>Object.fromEntries(['width','height','duration'].filter(k=>Number.isFinite(metadata?.[k])&&metadata[k]>0&&metadata[k]<=100000).map(k=>[k,metadata[k]]));
export async function createAssetStore({directory,validateMedia,projectName=()=>undefined}){
  await mkdir(directory,{recursive:true,mode:0o700});const index=join(directory,'index.json');let state={version:1,assets:[]},queue=Promise.resolve();
  try{state=JSON.parse(await readFile(index,'utf8'));if(state.version!==1||!Array.isArray(state.assets)||state.assets.some(a=>!validId(a.id)||!Object.hasOwn(extensions,a.contentType)||typeof a.name!=='string'||typeof a.createdAt!=='string'||(a.deletedAt!==undefined&&(typeof a.deletedAt!=='string'||!Number.isFinite(Date.parse(a.deletedAt))))||!Number.isSafeInteger(a.bytes)||a.bytes<=0||!Array.isArray(a.originalNames)||a.originalNames.some(n=>typeof n!=='string')||!Array.isArray(a.sources)||a.sources.some(s=>!['upload','generated'].includes(s.type)||typeof s.projectId!=='string'))||new Set(state.assets.map(a=>a.id)).size!==state.assets.length)throw Error('Invalid asset index');}catch(e){if(e.code!=='ENOENT')throw Error('Cannot read the Asset Library. Preserve .local/assets before repairing it.');}
  const filePath=asset=>join(directory,asset.id+'.'+extensions[asset.contentType]);
  const list=(project,{deleted=false}={})=>structuredClone(state.assets.filter(a=>!!a.deletedAt===deleted&&(!project||a.sources.some(s=>s.projectId===project))).sort((a,b)=>(b.deletedAt||b.createdAt).localeCompare(a.deletedAt||a.createdAt)));
  const get=id=>{if(!validId(id))throw fail('Asset not found.',404);const asset=state.assets.find(a=>a.id===id);if(!asset)throw fail('Asset not found.',404);return structuredClone(asset);};
  const transact=fn=>{const task=queue.catch(()=>{}).then(fn);queue=task;return task;};
  async function atomic(path,bytes){const temp=path+'.part-'+randomUUID();try{await writeFile(temp,bytes,{flag:'wx',mode:0o600});const handle=await open(temp,'r');try{await handle.sync();}finally{await handle.close();}await rename(temp,path);}catch(e){await rm(temp,{force:true}).catch(()=>{});throw e;}}
  async function save(next){await atomic(index,JSON.stringify(next));state=next;}
  async function add({data,contentType,name,metadata,source}){
    if(!Object.hasOwn(extensions,contentType)||!['image','video'].includes(validateMedia(data,contentType)))throw fail('Choose a PNG, JPG, WebP, MP4, MOV or WebM file.',415);
    if(!data.length||data.length>256*1024**2)throw fail('This file exceeds the Asset Library’s 256 MB saved-output limit.',413);
    if(!source||!['upload','generated'].includes(source.type)||typeof source.projectId!=='string')throw fail('Choose a valid asset source.');
    const id=createHash('sha256').update(data).digest('hex');
    return transact(async()=>{
      const next=structuredClone(state);let asset=next.assets.find(a=>a.id===id),existing=!!asset&&!asset.deletedAt;
      if(!asset){asset={id,contentType,name:cleanName(name),originalNames:[],bytes:data.length,createdAt:new Date().toISOString(),sources:[],...dimensions(metadata)};next.assets.push(asset);}
      delete asset.deletedAt;
      const original=cleanName(name);if(!asset.originalNames.includes(original)&&asset.originalNames.length<30)asset.originalNames.push(original);
      const origin={...(['women','men','neutral'].includes(source.characterAudience)?{characterAudience:source.characterAudience}:{}),...(['character','product','environment'].includes(source.referenceType)?{referenceType:source.referenceType}:{}),...(['women','men','neutral'].includes(source.referenceAudience)?{referenceAudience:source.referenceAudience}:{}),...( ['women','men','neutral'].includes(source.outfitAudience)?{outfitAudience:source.outfitAudience}:{}),type:source.type,projectId:source.projectId,...(['outfit','id','character'].includes(source.category)?{category:source.category}:{}),...(source.jobId?{jobId:String(source.jobId),mediaId:String(source.mediaId),modelName:String(source.modelName||'')}: {})};
      if(!asset.sources.some(s=>JSON.stringify(s)===JSON.stringify(origin)))asset.sources.push(origin);
      Object.assign(asset,dimensions(metadata));
      if(Array.isArray(metadata?.tags))asset.tags=[...new Set([...(asset.tags||[]),...metadata.tags])];
      // A retry also repairs a missing local file without creating another asset.
      const path=filePath(asset),stat=await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(stat&&!stat.isFile())throw fail('The asset file cannot be saved at this location.',500);
      if(!stat||stat.size!==data.length)await atomic(path,data);
      await save(next);return {asset:structuredClone(asset),existing};
    });
  }
  async function renameAsset(id,name){if(typeof name!=='string'||!name.trim()||name.length>180)throw fail('Name the asset using 1–180 characters.');return transact(async()=>{get(id);const next=structuredClone(state),asset=next.assets.find(a=>a.id===id);asset.name=cleanName(name);await save(next);return structuredClone(asset);});}
  async function setTags(id,tags){return transact(async()=>{get(id);const next=structuredClone(state),asset=next.assets.find(a=>a.id===id);asset.tags=[...tags];await save(next);return structuredClone(asset);});}
  async function setRemoved(id,removed){return transact(async()=>{get(id);const next=structuredClone(state),asset=next.assets.find(a=>a.id===id);if(removed)asset.deletedAt||=new Date().toISOString();else delete asset.deletedAt;await save(next);return structuredClone(asset);});}
  async function inspect(id){const path=filePath(get(id));const stat=await lstat(path).catch(e=>{if(e.code==='ENOENT')throw fail('The saved asset file is missing. Reimport the original file to restore it.',404);throw e;});if(!stat.isFile())throw fail('The saved asset file is unavailable.',404);return {path,bytes:stat.size};}
  async function serve(req,res,id,download=false){const asset=get(id),file=await inspect(id),path=file.path,stat={size:file.bytes};
    const downloadName=assetDownloadName(projectName(asset.sources[0]?.projectId),asset);
    let range;try{range=byteRange(req.headers.range,stat.size);}catch(error){if(error.status===416){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}throw error;}
    const headers={'Content-Type':asset.contentType,'Content-Length':range?range.end-range.start+1:stat.size,'Accept-Ranges':'bytes','Cache-Control':download?'no-store':'private, max-age=3600','Content-Disposition':downloadDisposition(downloadName,download)};
    if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${stat.size}`;
    res.writeHead(range?206:200,headers);await pipeline(createReadStream(path,range||{}),res);
  }
  return {list,get,add,setTags,rename:renameAsset,remove:id=>setRemoved(id,true),restore:id=>setRemoved(id,false),inspect,serve};
}
