import {exportSize} from './editing-models.js';

export function videoExportSize(width,height,limit){
 const size=exportSize(width,height,limit);
 // H.264 4:2:0 encoders require even dimensions, including portrait exports.
 return {width:Math.max(2,Math.floor(size.width/2)*2),height:Math.max(2,Math.floor(size.height/2)*2)};
}
export function h264RecordingType(supports=type=>globalThis.MediaRecorder?.isTypeSupported(type)){
 // Let the encoder choose the AVC level for the requested dimensions. The old
 // fixed level 3.0 was unsuitable for HD/4K. Never fall back to WebM or HEVC.
 return ['video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1.420033,mp4a.40.2'].find(type=>supports(type))||'';
}
export async function finalizeVideo(blob,options,{signal,onProgress=()=>{}}={}){
 if(signal?.aborted)throw Error(signal.reason||'Export cancelled.');
 const buffer=await blob.arrayBuffer();
 if(signal?.aborted)throw Error(signal.reason||'Export cancelled.');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./editing-mp4-worker.js',import.meta.url),{type:'module'});
  const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve({...result,blob:new Blob([result.buffer],{type:'video/mp4'})});};
  const abort=()=>finish(Error(signal.reason||'Export cancelled.'));
  const timer=setTimeout(()=>finish(Error('MP4 finalization timed out. Choose a smaller export size.')),120000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>finish(Error('The MP4 export tools could not load. Run Apply Studio Update.command, refresh, and export again.'));
  worker.onmessage=({data})=>{if(data.error)finish(Error(data.error));else if(data.result)finish(null,data.result);else if(Number.isFinite(data.progress))onProgress(data.progress);};
  worker.postMessage({buffer,options},[buffer]);
 });
}
