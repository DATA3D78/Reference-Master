import {test} from 'node:test';
import assert from 'node:assert/strict';
import {videoFrameCount} from '../video-metadata.mjs';
import {box,track,video} from './fixtures/mp4.mjs';
test('MP4/MOV frame counts use only video timing samples, including variable frame rates and trailing metadata',()=>{
 assert.equal(videoFrameCount(video()),300);
 assert.equal(videoFrameCount(video([[60,1000],[61,2000]])),121);
 const normal=box('moov',track()),extended=Buffer.alloc(16);extended.writeUInt32BE(1);extended.write('moov',4);extended.writeBigUInt64BE(BigInt(normal.length+8),8);
 assert.equal(videoFrameCount(Buffer.concat([extended,normal.subarray(8)])),300);
 const zero=box('moov',track());zero.writeUInt32BE(0);assert.equal(videoFrameCount(zero),300);
});
test('unknown, fragmented, multiple-video-track and malformed containers never produce invented counts',()=>{
 for(const input of [Buffer.alloc(0),Buffer.alloc(8),Buffer.from('not video'),video().subarray(0,60),box('moov',track('soun')),box('moov',track(),track()),box('moov',track(),box('mvex')),Buffer.concat([video(),box('moof')]),video([[0,1000]]),video([[1,0]])])assert.equal(videoFrameCount(input),undefined);
 const huge=Buffer.alloc(16);huge.writeUInt32BE(1);huge.write('moov',4);huge.writeBigUInt64BE(2n**63n,8);assert.equal(videoFrameCount(huge),undefined);
 const invalid=video();invalid.writeUInt32BE(0xffffffff,invalid.lastIndexOf('stts')+8);assert.equal(videoFrameCount(invalid),undefined);
});
