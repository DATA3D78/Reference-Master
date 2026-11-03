import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {finalizeH264MP4} from '../public/editing-mp4.js';
import {h264RecordingType,videoExportSize} from '../public/editing-video.js';
import {Input,MP4,BufferSource,EncodedPacketSink} from '../public/vendor/mediabunny/mediabunny.min.js';
const fixture=()=>readFile(new URL('./fixtures/editor-fragmented-h264.mp4',import.meta.url));
function boxes(buffer){const data=Buffer.from(buffer),list=[];let i=0;while(i+8<=data.length){let size=data.readUInt32BE(i);const type=data.toString('ascii',i+4,i+8);if(size===1)size=Number(data.readBigUInt64BE(i+8));if(!size)size=data.length-i;assert(size>=8&&i+size<=data.length);list.push(type);i+=size;}assert.equal(i,data.length);return list;}
async function packets(track){const result=[];for await(const p of new EncodedPacketSink(track).packets())result.push(p);return result;}
test('edited MP4 becomes a seekable, non-fragmented H.264/AAC file without re-encoding samples',async()=>{
 const original=await fixture();assert(boxes(original).includes('moof'));
 const result=await finalizeH264MP4(original,{expectedDuration:2,expectedWidth:256,expectedHeight:192});
 const top=boxes(result.buffer);assert(!top.includes('moof'));assert(top.indexOf('moov')<top.indexOf('mdat'));assert(!Buffer.from(result.buffer).includes(Buffer.from('mvex')));
 const before=new Input({formats:[MP4],source:new BufferSource(original)}),after=new Input({formats:[MP4],source:new BufferSource(result.buffer)});
 try{
  assert.match(await after.getMimeType(),/avc1.*mp4a/);assert(Math.abs(await after.getDurationFromMetadata()-2)<.15);
  assert.equal(result.videoPackets,60);assert.equal(result.audioPackets,92);
  for(const [a,b] of [[await before.getPrimaryVideoTrack(),await after.getPrimaryVideoTrack()],[await before.getPrimaryAudioTrack(),await after.getPrimaryAudioTrack()]]){
   const oldPackets=await packets(a),newPackets=await packets(b);assert.equal(newPackets.length,oldPackets.length);
   for(let i=0;i<oldPackets.length;i++){assert.deepEqual(newPackets[i].data,oldPackets[i].data);assert(Math.abs(newPackets[i].timestamp-oldPackets[i].timestamp)<.001);}
   assert(await new EncodedPacketSink(b).getPacket(1.4));
  }
 }finally{before.dispose();after.dispose();}
});
test('invalid, truncated or incorrectly sized recordings cannot be saved as successful exports',async()=>{
 const original=await fixture();await assert.rejects(finalizeH264MP4(new Uint8Array(20)));
 await assert.rejects(finalizeH264MP4(original,{expectedDuration:20}),/complete clip/);
 await assert.rejects(finalizeH264MP4(original,{expectedWidth:1920,expectedHeight:1080}),/size/);
 const hevc=Buffer.from(original);const position=hevc.indexOf(Buffer.from('avc1'),200);assert(position>0);hevc.write('hvc1',position);
 await assert.rejects(finalizeH264MP4(hevc),/H.264/);
});
test('video format selection requires H.264 plus AAC; there is no silent WebM fallback',()=>{
 assert.match(h264RecordingType(()=>true),/^video\/mp4;codecs=avc1,mp4a.40.2$/);
 assert.equal(h264RecordingType(t=>t.includes('webm')),'');
 assert.equal(h264RecordingType(()=>false),'');
});
test('H.264 export sizes are even, preserve orientation and respect selected limit',()=>{
 assert.deepEqual(videoExportSize(1921,1081,0),{width:1920,height:1080});
 const portrait=videoExportSize(1081,1921,1280);assert.equal(portrait.height,1280);assert.equal(portrait.width%2,0);assert(portrait.width<portrait.height);
 assert.deepEqual(videoExportSize(641,479,1920),{width:640,height:478});
});
