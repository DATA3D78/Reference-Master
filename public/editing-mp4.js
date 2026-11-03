import {Input,BufferSource,MP4,Output,Mp4OutputFormat,BufferTarget,EncodedVideoPacketSource,EncodedAudioPacketSource,EncodedPacketSink} from './vendor/mediabunny/mediabunny.min.js';

// MediaRecorder writes fragmented MP4s in Chromium. Repackage the original
// encoded samples, without another lossy encode, for QuickTime/editing apps.
export async function finalizeH264MP4(buffer,{expectedDuration,expectedWidth,expectedHeight,onProgress=()=>{}}={}){
 const input=new Input({formats:[MP4],source:new BufferSource(buffer)});
 let output,check;
 try{
  const videos=await input.getVideoTracks(),audios=await input.getAudioTracks();
  if(videos.length!==1||audios.length>1)throw Error('The recording has invalid media tracks. Export again.');
  const video=videos[0],audio=audios[0];
  if(await video.getCodec()!=='avc'||(audio&&await audio.getCodec()!=='aac'))throw Error('The browser did not record H.264 video with AAC sound. Use a current Chrome or Safari and export again.');
  const videoConfig=await video.getDecoderConfig(),audioConfig=audio&&await audio.getDecoderConfig();
  if(!videoConfig?.description||(audio&&!audioConfig))throw Error('The recording is missing its codec information. Export again.');
  const width=await video.getDisplayWidth(),height=await video.getDisplayHeight();
  if((expectedWidth&&width!==expectedWidth)||(expectedHeight&&height!==expectedHeight))throw Error('The recorded video size is incorrect. Choose a smaller export size.');
  const first=await input.getFirstTimestamp(),videoEnd=await video.computeDuration(),duration=videoEnd-first;
  if(!Number.isFinite(duration)||duration<=0)throw Error('The recording has no playable video. Export again.');
  if(expectedDuration&&Math.abs(duration-expectedDuration)>Math.max(.5,expectedDuration*.03))throw Error('Video export ended before the complete clip was recorded. Keep the studio visible and try again.');
  const target=new BufferTarget();output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target});
  const tracks=[{track:video,source:new EncodedVideoPacketSource('avc'),config:videoConfig,count:0}];
  output.addVideoTrack(tracks[0].source,{rotation:await video.getRotation()});
  if(audio){const entry={track:audio,source:new EncodedAudioPacketSource('aac'),config:audioConfig,count:0};tracks.push(entry);output.addAudioTrack(entry.source);}
  await output.start();
  await Promise.all(tracks.map(async entry=>{
   for await(const packet of new EncodedPacketSink(entry.track).packets()){
    // Shift both tracks by the SAME origin to preserve their synchronization.
    await entry.source.add(packet.clone({timestamp:packet.timestamp-first}),entry.count++===0?{decoderConfig:entry.config}:undefined);
    if(entry.track===video&&entry.count%30===0)onProgress(Math.min(.95,(packet.timestamp-first)/duration));
   }
   entry.source.close();
   if(!entry.count)throw Error('The recording contains an empty media track. Export again.');
  }));
  await output.finalize();
  const data=target.buffer;
  check=new Input({formats:[MP4],source:new BufferSource(data)});
  const finalDuration=await check.getDurationFromMetadata();
  if(!Number.isFinite(finalDuration)||finalDuration<=0||Math.abs(finalDuration-duration)>Math.max(.5,duration*.03))throw Error('The MP4 could not be finalized correctly. Export again.');
  onProgress(1);
  return {buffer:data,width,height,duration:finalDuration,videoCodec:videoConfig.codec,audioCodec:audioConfig?.codec||null,videoPackets:tracks[0].count,audioPackets:tracks[1]?.count||0};
 }catch(error){await output?.cancel().catch(()=>{});throw error;}
 finally{input.dispose();check?.dispose();}
}
