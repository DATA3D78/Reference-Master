import {mkdir,readdir,writeFile,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {downloadDisposition,downloadNamePart} from './public/library.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const EDIT_EXPORT_MAX_BYTES=256*1024*1024;
// Browser-generated blobs are staged locally so embedded browsers can download
// them through an ordinary HTTP attachment. These copies never enter Assets.
export async function createEditorExports({directory,validateMedia,now=Date.now,maxBytes=512*1024*1024,ttl=10*60*1000}){
 await mkdir(directory,{recursive:true,mode:0o700});
 for(const name of await readdir(directory))if(/^[a-f0-9]{48}\.bin$/.test(name))await unlink(join(directory,name));
 const tickets=new Map();let bytes=0,queue=Promise.resolve(),closed=false;
 const enqueue=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
 const remove=async id=>{const entry=tickets.get(id);if(!entry)return;await unlink(entry.path).catch(e=>{if(e.code!=='ENOENT')throw e;});tickets.delete(id);bytes-=entry.bytes;};
 const prune=async()=>{for(const [id,entry] of tickets)if(entry.expires<=now())await remove(id);};
 const timer=setInterval(()=>enqueue(prune).catch(()=>{}),60000);timer.unref();
 const prepare=({data,contentType,name})=>enqueue(async()=>{
  if(closed)throw fail('The studio is closing. Reopen it and export again.',503);
  if(!['image/png','image/jpeg','video/mp4'].includes(contentType))throw fail('Unsupported editor export format.',415);
  validateMedia(data,contentType);
  if(!data.length||data.length>Math.min(EDIT_EXPORT_MAX_BYTES,maxBytes))throw fail('This export is too large. Choose a smaller size.',413);
  await prune();while(tickets.size>=10||bytes+data.length>maxBytes)await remove(tickets.keys().next().value);
  const id=randomBytes(24).toString('hex'),path=join(directory,id+'.bin'),safeName=downloadNamePart(name,'Edited copy',220);
  await writeFile(path,data,{mode:0o600,flag:'wx'});tickets.set(id,{path,contentType,name:safeName,bytes:data.length,expires:now()+ttl});bytes+=data.length;
  return {url:'/api/editing/exports/'+id,name:safeName};
 });
 const serve=async(res,id)=>{await enqueue(prune);const entry=tickets.get(id);if(!entry)throw fail('This export link expired. Download the copy again.',404);res.writeHead(200,{'Content-Type':entry.contentType,'Content-Length':entry.bytes,'Content-Disposition':downloadDisposition(entry.name),'Cache-Control':'no-store'});await pipeline(createReadStream(entry.path),res);};
 const close=()=>{closed=true;clearInterval(timer);return enqueue(async()=>{for(const id of tickets.keys())await remove(id);});};
 return {prepare,serve,close};
}
