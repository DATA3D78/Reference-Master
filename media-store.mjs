import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { mkdir, lstat, open, rename, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {projectDownloadName,downloadDisposition} from './public/library.js';

const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg'};
const failure=(message,status=502)=>Object.assign(new Error(message),{status});
export function mediaFilename(jobId,media){
  const extension=extensions[media.contentType];
  if(!extension)throw failure('This output format cannot be saved locally.',415);
  return createHash('sha256').update(`${jobId}\0${media.id}`).digest('hex')+'.'+extension;
}
export function byteRange(value,size){
  if(!value)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2]))throw failure('Requested range is not available.',416);
  let start,end;
  if(!match[1]){const length=Number(match[2]);if(!Number.isSafeInteger(length)||length<=0)throw failure('Requested range is not available.',416);start=Math.max(0,size-length);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw failure('Requested range is not available.',416);
  return {start,end};
}
export async function createMediaStore({directory,getDirectory=()=>directory,getDirectories=()=>[directory],fetchImpl,validURL,validateMedia,projectName=()=>undefined}){
  await mkdir(directory,{recursive:true,mode:0o700});
  const pending=new Map();
  async function inspect(jobId,media){
    const filename=mediaFilename(jobId,media);
    for(const folder of getDirectories(jobId)){
      const path=join(folder,filename);
      try{const stat=await lstat(path);if(stat.isFile()&&stat.size)return {filename,path,bytes:stat.size,savedAt:stat.mtime.toISOString()};}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
    return null;
  }
  async function ensure(jobId,media){
    const requestKey=mediaFilename(jobId,media);let filename=requestKey;
    if(pending.has(requestKey))return pending.get(requestKey);
    const task=(async()=>{
      const existing=await inspect(jobId,media);if(existing)return existing;
      if(!validURL(media.url))throw failure('This output has no supported provider link.',404);
      const response=await fetchImpl(media.url,{redirect:'error',signal:AbortSignal.timeout(180000)});
      if(!response.ok||!response.body)throw failure(`The provider file is unavailable (HTTP ${response.status}). A local copy could not be saved.`);
      const receivedType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(extensions[receivedType]&&receivedType.split('/')[0]===media.contentType.split('/')[0]){media.contentType=receivedType;filename=mediaFilename(jobId,media);}
      const maxBytes=media.contentType.startsWith('video/')?2*1024**3:256*1024**2;
      const encoding=response.headers.get('content-encoding');
      const expected=encoding&&encoding!=='identity'?null:response.headers.get('content-length');
      if(expected!==null&&Number(expected)>maxBytes){await response.body.cancel();throw failure('This output is too large to save automatically.',413);}
      const target=getDirectory(jobId);await access(target,constants.W_OK);
      const path=join(target,filename),temporary=path+'.part-'+randomUUID();
      let bytes=0,head=Buffer.alloc(0);
      const validation=new Transform({transform(chunk,encoding,callback){
        bytes+=chunk.length;
        if(bytes>maxBytes){callback(failure('This output is too large to save automatically.',413));return;}
        if(head.length<64)head=Buffer.concat([head,chunk.subarray(0,64-head.length)]);
        callback(null,chunk);
      },flush(callback){
        try{
          if(expected!==null&&Number(expected)!==bytes)throw failure('The download was interrupted before the local copy was complete.');
          validateMedia(head,media.contentType);callback();
        }catch(e){callback(e);}
      }});
      try{
        await pipeline(Readable.fromWeb(response.body),validation,createWriteStream(temporary,{flags:'wx',mode:0o600}));
        const handle=await open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
        await rename(temporary,path);
        return await inspect(jobId,media);
      }catch(e){await rm(temporary,{force:true}).catch(()=>{});throw e;}
    })();
    pending.set(requestKey,task);
    try{return await task;}finally{pending.delete(requestKey);}
  }
  async function saveBytes(jobId,media,encoded){
    if(typeof encoded!=='string'||encoded.length>350*1024**2||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw failure('Comfy returned invalid inline media.',422);
    const data=Buffer.from(encoded,'base64');if(!data.length)throw failure('Comfy returned empty media.',422);
    validateMedia(data.subarray(0,4096),media.contentType);
    const target=getDirectory(jobId);await access(target,constants.W_OK);
    const path=join(target,mediaFilename(jobId,media)),temp=path+'.part-'+randomUUID();
    try{await writeFile(temp,data,{flag:'wx',mode:0o600});await rename(temp,path);}catch(e){await rm(temp,{force:true}).catch(()=>{});throw e;}
    return inspect(jobId,media);
  }
  async function serve(req,res,url,job,media,file,{reference=false,referenceMB,validateMedia:validate=validateMedia}={}){
    if(reference){
      const max=(referenceMB??(media.contentType.startsWith('video/')?30:10))*1024**2;
      if(file.bytes>max)throw failure('This output exceeds the reference file size limit. Download a smaller version and add it instead.',413);
      const handle=await open(file.path,'r');try{const head=Buffer.alloc(64);const {bytesRead}=await handle.read(head,0,64,0);validate(head.subarray(0,bytesRead),media.contentType);}finally{await handle.close();}
    }
    let range;
    try{range=reference?null:byteRange(req.headers.range,file.bytes);}
    catch(e){if(e.status===416)res.setHeader('Content-Range',`bytes */${file.bytes}`);throw e;}
    const extension=extensions[media.contentType];
    const name=projectDownloadName(projectName(job.projectId),`${createHash('sha256').update(job.id).digest('hex').slice(0,8)}-${createHash('sha256').update(media.id).digest('hex').slice(0,8)}`,extension);
    const download=url.pathname==='/api/download';
    const headers={'Content-Type':media.contentType,'Content-Length':range?range.end-range.start+1:file.bytes,'Accept-Ranges':'bytes','Cache-Control':reference||download?'no-store':'private, max-age=3600','Content-Disposition':downloadDisposition(name,download)};
    if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${file.bytes}`;
    res.writeHead(range?206:200,headers);
    await pipeline(createReadStream(file.path,range||{}),res);
  }
  async function serveRemote(req,res,media,{reference=false,referenceMB}={}){
    if(!validURL(media.url))throw failure('This result has no online preview. Keep a local copy when generating this format.',404);
    const range=reference?null:req.headers.range;
    if(range&&!/^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$/.test(range))throw failure('Unsupported media range.',416);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000);
    const abort=()=>controller.abort();res.once('close',abort);
    try{
      const response=await fetchImpl(media.url,{redirect:'error',signal:controller.signal,headers:range?{Range:range}:{}});
      if(![200,206].includes(response.status)||!response.body){await response.body?.cancel();throw failure('Online preview unavailable. The provider link may have expired.',502);}
      const type=(response.headers.get('content-type')||media.contentType).split(';')[0].trim().toLowerCase();
      if(type!==media.contentType&&type!=='application/octet-stream'){await response.body.cancel();throw failure('The provider returned an unexpected media format.',502);}
      const max=reference?(referenceMB??(media.contentType.startsWith('video/')?30:10))*1024**2:media.contentType.startsWith('video/')?2*1024**3:256*1024**2;
      const length=response.headers.get('content-length');
      if(length!==null&&Number(length)>max){await response.body.cancel();throw failure('This media exceeds the preview or reference size limit.',413);}
      const headers={'Content-Type':media.contentType,'Cache-Control':'no-store','Content-Disposition':'inline'};
      if(length!==null)headers['Content-Length']=length;
      for(const name of ['accept-ranges','content-range'])if(response.headers.has(name))headers[name]=response.headers.get(name);
      let bytes=0;
      const limit=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>max?failure('Media size limit exceeded.',413):null,chunk);}});
      res.writeHead(response.status,headers);
      await pipeline(Readable.fromWeb(response.body),limit,res);
    }finally{clearTimeout(timeout);res.off('close',abort);controller.abort();}
  }
  return {inspect,ensure,serve,saveBytes,serveRemote};
}
