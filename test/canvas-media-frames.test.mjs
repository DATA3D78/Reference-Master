import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mediaAspectRatio,mediaFrameSize,mediaFrameCorrections} from '../public/canvas-state.js';
import {createIdeationStore} from '../ideation-store.mjs';
import {IdeationCanvas} from '../public/ideation.js';

test('media dimensions take precedence over requested ratios, including auto output sizes',()=>{
  assert.equal(mediaAspectRatio({width:1536,height:1024},{ratio:'16:9'}),1.5);
  assert.equal(mediaAspectRatio({}, {ratio:'9:16'}),9/16);
  assert.equal(mediaAspectRatio({width:0,height:10},{ratio:'auto'}),null);
  assert.equal(mediaAspectRatio({width:Infinity,height:2},{ratio:'0:1'}),null);
});

test('wide, portrait and square frames keep their ratio at both resize limits',()=>{
  for(const ratio of [1,16/9,9/16,4/3,3/4,2.35,8,1/8,20,.04]){
    for(const width of [120,300,550,2000,10000]){
      const frame=mediaFrameSize(width,ratio);
      assert(frame.width>=120&&frame.width<=2000);
      assert(frame.height>=100&&frame.height<=3000);
      assert(Math.abs(frame.width/frame.height-ratio)<1e-10);
    }
  }
  assert.deepEqual(mediaFrameSize(300,16/9),{width:300,height:168.75});
  assert.deepEqual(mediaFrameSize(300,1),{width:300,height:300});
  assert.equal(mediaFrameSize(300,NaN),null);
});

test('legacy padded cards are corrected once, preserving position, grouping and notes',()=>{
  const items=[{id:'image',type:'media',x:80,y:-100,width:300,height:210.75,groupId:'g'},
    {id:'video',type:'media',x:480,y:100,width:300,height:575.33},
    {id:'note',type:'note',x:10,y:20,width:260,height:200,text:'Keep this'}];
  const original=structuredClone(items),ratio=i=>i.id==='image'?16/9:9/16;
  const ops=mediaFrameCorrections(items,ratio);
  assert.equal(ops.length,2);assert.deepEqual(items,original);
  for(const op of ops){assert.deepEqual(Object.keys(op.patch).sort(),['height','width']);Object.assign(items.find(i=>i.id===op.id),op.patch);}
  assert.equal(items[0].height,168.75);assert.equal(items[0].groupId,'g');assert.equal(items[0].x,80);assert.equal(items[0].y,-100);
  assert.deepEqual(mediaFrameCorrections(items,ratio),[]);assert.deepEqual(items[2],original[2]);
});

test('new media and corrected legacy frames retain exact dimensions after reopening',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'frame-ratio-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const job={id:'job',mode:'image',settings:{ratio:'auto'}},media={id:'media',width:1600,height:900};
  const findMedia=()=>({job,media}),store=await createIdeationStore({directory,findMedia});
  let board=await store.mutate([{type:'addMedia',jobId:'job',mediaId:'media',position:{x:55,y:90}}]);
  assert.equal(board.items[0].height,168.75);
  const id=board.items[0].id;
  board=await store.mutate([{type:'update',id,patch:{width:450,height:450/(16/9)+42}}]);
  const repaired=await store.mutate(mediaFrameCorrections(board.items,()=>16/9));
  const reopened=await createIdeationStore({directory,findMedia});
  assert.deepEqual(reopened.snapshot(),repaired);assert.equal(repaired.items[0].width,450);assert.equal(repaired.items[0].height,253.125);assert.equal(repaired.items[0].x,55);assert.equal(repaired.items[0].y,90);
});

test('resize uses loaded media dimensions even when saved frame and provider metadata differ',()=>{
  const source={id:'media',type:'media',jobId:'job',mediaId:'output',x:0,y:0,width:300,height:342};
  const canvas=Object.create(IdeationCanvas.prototype);
  Object.assign(canvas,{board:{items:[{...source}]},mediaRatios:new Map([['media',16/9]]),cards:new Map([['media',{style:{}}]]),gesture:{kind:'resize',start:{x:0,y:0},zoom:1,items:[source]},renderGroups(){},renderSnapGuides(){}});
  canvas.pointerMove({clientX:100,clientY:200});
  assert.equal(canvas.board.items[0].width,400);assert.equal(canvas.board.items[0].height,225);
});
