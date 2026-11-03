import {randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {projectDownloadName,downloadDisposition,downloadNamePart} from './public/library.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const MAX_BYTES=0xffffffff-1024*1024;
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crcUpdate(crc,chunk){for(const byte of chunk)crc=table[(crc^byte)&255]^(crc>>>8);return crc;}
const cleanName=name=>downloadNamePart(name,'media',220);

// Stored (uncompressed) ZIP entries with data descriptors allow videos to stream
// directly from disk. Only the small central directory stays in memory.
export async function* zipFiles(files){
  let offset=0;const central=[];
  for(const file of files){
    const name=Buffer.from(file.name),header=Buffer.alloc(30),start=offset;
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x808,6);header.writeUInt16LE(33,12);header.writeUInt16LE(name.length,26);
    yield header;yield name;offset+=header.length+name.length;
    let crc=0xffffffff,bytes=0;
    for await(const chunk of createReadStream(file.path)){bytes+=chunk.length;if(bytes>file.bytes)throw fail('A selected file changed. Please download again.',409);crc=crcUpdate(crc,chunk);yield chunk;offset+=chunk.length;}
    if(bytes!==file.bytes)throw fail('A selected file changed. Please download again.',409);
    crc=(crc^0xffffffff)>>>0;
    const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(bytes,8);descriptor.writeUInt32LE(bytes,12);yield descriptor;offset+=16;
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x808,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes,20);entry.writeUInt32LE(bytes,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(start,42);central.push(entry,name);
  }
  const start=offset;for(const entry of central){yield entry;offset+=entry.length;}
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(offset-start,12);end.writeUInt32LE(start,16);yield end;
}

export function createBatchDownloads({resolve,now=Date.now}){
  const tickets=new Map();
  const prune=()=>{for(const [id,ticket] of tickets)if(ticket.expires<=now())tickets.delete(id);};
  async function prepare(body){
    if(!Array.isArray(body?.items)||!body.items.length||body.items.length>250)throw fail('Select between 1 and 250 files for one download.');
    const unique=new Map();
    for(const item of body.items){
      if(!item||typeof item!=='object'||Array.isArray(item))throw fail('Invalid download selection.');
      const keys=Object.keys(item).sort().join(',');
      if(!(keys==='assetId'&&typeof item.assetId==='string')&&!(keys==='jobId,mediaId'&&typeof item.jobId==='string'&&typeof item.mediaId==='string'))throw fail('Choose files from your library.');
      if(Object.values(item).some(v=>!v||v.length>200))throw fail('Invalid download selection.');
      unique.set(JSON.stringify(item.assetId?{assetId:item.assetId}:{jobId:item.jobId,mediaId:item.mediaId}),item);
    }
    const files=[];let bytes=0;
    for(const item of unique.values()){
      const file=await resolve(item,body.projectId);bytes+=file.bytes;
      if(!Number.isSafeInteger(file.bytes)||file.bytes<0||bytes>MAX_BYTES)throw fail('This selection is over 4 GB. Download it in smaller batches.',413);
      // Names already include the source project. Keep it at the very start.
      const name=cleanName(file.name),dot=name.lastIndexOf('.'),number=String(files.length+1).padStart(3,'0');
      files.push({...file,name:dot>0?name.slice(0,dot)+'-'+number+name.slice(dot):name+'-'+number});
    }
    prune();if(tickets.size>=20)tickets.delete(tickets.keys().next().value);
    const origins=new Set(files.map(file=>file.projectId)),name=projectDownloadName(origins.size===1?files[0].projectName:'Multiple projects','selection','zip');
    const id=randomBytes(24).toString('hex');tickets.set(id,{files,name,expires:now()+10*60*1000});
    return {url:'/api/downloads/batch/'+id,count:files.length,name};
  }
  async function serve(res,id){
    prune();const ticket=tickets.get(id);if(!ticket)throw fail('This download expired. Select Download again.',404);
    const length=ticket.files.reduce((n,f)=>n+f.bytes+92+Buffer.byteLength(f.name)*2,22);
    res.writeHead(200,{'Content-Type':'application/zip','Content-Length':length,'Content-Disposition':downloadDisposition(ticket.name),'Cache-Control':'no-store'});
    await pipeline(Readable.from(zipFiles(ticket.files)),res);
  }
  return {prepare,serve};
}
