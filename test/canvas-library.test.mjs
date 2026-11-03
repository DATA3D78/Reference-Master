import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canvasLibrarySources} from '../public/canvas-library.js';
import {IdeationCanvas} from '../public/ideation.js';
import {mediaFrameCorrections} from '../public/canvas-state.js';

test('canvas picker separates assets, favorites and generations, excludes deleted media and audio, and searches project names',()=>{
  const assets=[{id:'asset-a',name:'Portrait',contentType:'image/png',sources:[{projectId:'fashion'}]},{id:'clip',name:'Clip',contentType:'video/mp4',sources:[]},{id:'trash',name:'Hidden',contentType:'image/png',deletedAt:'2026-10-09'},{id:'audio',contentType:'audio/mpeg'}];
  const jobs=[{id:'job',modelName:'Test model',settings:{prompt:'Rain study'},tasks:[{status:'COMPLETED',outputs:[{id:'image',contentType:'image/png',favorite:true},{id:'video',contentType:'video/mp4'},{id:'audio',contentType:'audio/mpeg',favorite:true},{id:'deleted',contentType:'image/png',favorite:true,deletedAt:'2026-10-09'}]},{status:'COMPLETED',deletedAt:'2026-10-09',outputs:[{id:'hidden',contentType:'image/png',favorite:true}]}]}];
  const args={assets,jobs,projects:[{id:'fashion',name:'Fashion'}],mediaURL:(_,m)=>'/media/'+m.id};
  assert.deepEqual(canvasLibrarySources(args).map(i=>i.key),['asset:asset-a','asset:clip']);
  assert.equal(canvasLibrarySources({...args,query:' FASHION '})[0].name,'Portrait');
  assert.deepEqual(canvasLibrarySources({...args,source:'favorites'}).map(i=>i.source),[{jobId:'job',mediaId:'image'}]);
  assert.equal(canvasLibrarySources({...args,source:'generations',query:'rain'}).length,2);
});

test('mixed canvas insertion skips existing items and Undo removes only newly inserted sources',async()=>{
  const canvas=Object.create(IdeationCanvas.prototype),ops=[];
  Object.assign(canvas,{board:{items:[{id:'asset:existing'}]},projectVersion:1,pending:[],load:async()=>true,insertionPoint:()=>({x:30,y:50}),commit:(operations,inverse)=>ops.push({operations,inverse}),flush:async()=>{},render(){},fit(){}});
  assert.equal(await canvas.addSources([{assetId:'existing'},{assetId:'new'},{assetId:'new'},{jobId:'job',mediaId:'image'}]),true);
  assert.deepEqual(ops[0].operations,[{type:'addAsset',assetId:'new',position:{x:30,y:50}},{type:'addMedia',jobId:'job',mediaId:'image',position:{x:30,y:50}}]);
  assert.deepEqual(ops[0].inverse,[{type:'remove',ids:['asset:new','media:job:image']}]);
  assert.deepEqual([...canvas.selected],['asset:existing','asset:new','media:job:image']);
  canvas.board.items=Array.from({length:1000},(_,i)=>({id:'item'+i}));await assert.rejects(canvas.addSources([{assetId:'overflow'}]),/1,000/);
});

test('asset previews resolve local originals and use the same resize correction as generated media',()=>{
  const canvas=Object.create(IdeationCanvas.prototype),item={id:'asset:portrait',type:'asset',assetId:'portrait',width:300,height:300,asset:{id:'portrait',name:'Portrait',contentType:'image/png',width:900,height:1600}};
  canvas.mediaRatios=new Map();const resolved=canvas.resolveMedia(item);
  assert.equal(resolved.url,'/api/assets/media?id=portrait');assert.equal(resolved.description,'Portrait');
  assert.equal(canvas.mediaRatio(item),900/1600);
  const corrections=mediaFrameCorrections([item],i=>canvas.mediaRatio(i));assert.equal(corrections[0].patch.height,300/(900/1600));
});
