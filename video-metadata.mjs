// Read video sample counts from MP4/MOV containers without decoding or assuming FPS.
// Fragmented and ambiguous multi-video-track files deliberately have no estimate.
export function videoFrameCount(data){
 try{
  let remaining=100000;
  const boxes=(start,end)=>{
   const result=[];
   for(let at=start;at<end;){
    if(--remaining<0||end-at<8)throw Error('Invalid boxes');
    let size=data.readUInt32BE(at),header=8;
    if(size===1){if(end-at<16)throw Error('Invalid extended box');size=Number(data.readBigUInt64BE(at+8));header=16;}
    if(size===0)size=end-at;
    if(!Number.isSafeInteger(size)||size<header||size>end-at)throw Error('Invalid box size');
    result.push({type:data.toString('ascii',at+4,at+8),start:at+header,end:at+size});at+=size;
   }
   return result;
  };
  const children=box=>boxes(box.start,box.end),root=boxes(0,data.length);
  if(root.some(b=>b.type==='moof'))return undefined;
  const moov=root.filter(b=>b.type==='moov');if(moov.length!==1)return undefined;
  const movie=children(moov[0]);if(movie.some(b=>b.type==='mvex'))return undefined;
  const tracks=[];
  for(const track of movie.filter(b=>b.type==='trak')){
   const mdia=children(track).find(b=>b.type==='mdia');if(!mdia)continue;
   const media=children(mdia),handler=media.find(b=>b.type==='hdlr');
   if(!handler||handler.end-handler.start<12||data.toString('ascii',handler.start+8,handler.start+12)!=='vide')continue;
   const minf=media.find(b=>b.type==='minf'),stbl=minf&&children(minf).find(b=>b.type==='stbl');
   if(!stbl)return undefined;
   const timing=children(stbl).find(b=>b.type==='stts');
   if(!timing||timing.end-timing.start<8||data.readUInt32BE(timing.start)!==0)return undefined;
   const count=data.readUInt32BE(timing.start+4);
   if(count>remaining||timing.end-timing.start!==8+count*8)return undefined;
   remaining-=count;let frames=0;
   for(let i=0;i<count;i++){
    const offset=timing.start+8+i*8,n=data.readUInt32BE(offset);
    if(!n||!data.readUInt32BE(offset+4))return undefined;
    frames+=n;if(!Number.isSafeInteger(frames))return undefined;
   }
   tracks.push(frames);
  }
  return tracks.length===1&&tracks[0]>0?tracks[0]:undefined;
 }catch{return undefined;}
}
