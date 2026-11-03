// Depth Anything V2 Small, matching Radiance's small-model family. Quantized
// inference runs in a worker; preview and export share the same depth samples.
export function depthPair(frames,time,{maxGap=1.25}={}){
 const list=[...frames.values()].sort((a,b)=>a.time-b.time);if(!list.length)return null;
 let a=list[0],b=list.at(-1);for(const f of list){if(f.time<=time)a=f;if(f.time>=time){b=f;break;}}
 if(Math.min(Math.abs(a.time-time),Math.abs(b.time-time))>maxGap)return null;
 return {a,b,mix:a===b?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)))};
}
export class DepthSession{
 constructor(onChange){this.onChange=onChange;this.frames=new Map();this.pending=new Map();this.epoch=0;this.id=0;this.state='idle';}
 reset(){this.epoch++;this.frames.clear();this.state='idle';this.error='';}
 startWorker(){
  if(this.worker)return;this.worker=new Worker(new URL('./editing-depth-worker.js',import.meta.url),{type:'module'});
  this.worker.onmessage=({data})=>{const entry=this.pending.get(data.id);if(!entry)return;if(data.progress!==undefined){this.onChange?.('Loading local depth model… '+Math.round(data.progress)+'%');return;}clearTimeout(entry.timer);this.pending.delete(data.id);if(data.error)entry.reject(Error(data.error));else entry.resolve(data);};
  this.worker.onerror=event=>this.fail('Depth processing could not start'+(event.message?': '+event.message:'. Refresh the studio and retry.'));
 }
 fail(message){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();this.worker?.terminate();this.worker=null;}
 async analyse(media,time=0){
  const epoch=this.epoch;this.startWorker();const canvas=document.createElement('canvas'),w=media.videoWidth||media.naturalWidth||media.width,h=media.videoHeight||media.naturalHeight||media.height,scale=Math.min(1,256/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));const c=canvas.getContext('2d');c.drawImage(media,0,0,canvas.width,canvas.height);const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
  this.state='loading';this.onChange?.('Reading depth locally…');
  try{const id=++this.id,result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail('Depth estimation timed out. Retry depth or use a smaller source.'),180000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,width:canvas.width,height:canvas.height,pixels:pixels.buffer},[pixels.buffer]);});if(epoch!==this.epoch)return null;
   const frame={width:result.width,height:result.height,data:result.data,time};this.frames.set(time,frame);this.state='ready';this.error='';this.onChange?.('Depth ready · processed on this device');return frame;
  }catch(e){if(epoch===this.epoch){this.state='error';this.error=e.message;this.onChange?.('Depth unavailable: '+e.message);}throw e;}
 }
 preview(media,time=0){
  if(this.state==='error'||this.pending.size||this.frames.has(time))return;if(this.frames.size>1205)this.frames.delete(this.frames.keys().next().value);
  const pair=this.at(time);if(pair&&Math.min(Math.abs(pair.a.time-time),Math.abs(pair.b.time-time))<.5)return;
  this.active=this.analyse(media,time).catch(()=>{}).finally(()=>{if(this.state==='idle')this.onChange?.('');});
 }
 at(time=0){return depthPair(this.frames,time);}
 async image(media){if(!this.frames.has(0)){await this.active;if(!this.frames.has(0))await this.analyse(media,0);}return this.at(0);}
 async prepareVideo(url,duration,onProgress,cancelled){
  await this.active;this.reset();const epoch=this.epoch,video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Could not open video for depth analysis.')),20000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Error('Could not open video for depth analysis.'));};});
   const frames=Math.ceil(duration*2)+1;
   for(let i=0;i<frames;i++){if(cancelled()||epoch!==this.epoch)throw Error('Export cancelled.');const time=Math.min(i/2,Math.max(0,duration-.025));if(Math.abs(video.currentTime-time)>.001)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Could not seek video for depth analysis.')),10000);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=time;});await this.analyse(video,time);onProgress((i+1)/frames);}
  }finally{video.pause();video.removeAttribute('src');video.load();}
 }
 dispose(){this.reset();this.fail('Depth processing closed.');}
}
