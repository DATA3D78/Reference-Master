import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceLibrarySources,referencePickerCapacity} from '../public/library.js';
test('reference picker offers compatible assets across projects and only visible favorites from the current project',()=>{
  const assets=[{id:'image',name:'Photo.png',contentType:'image/png',bytes:100},{id:'large',name:'Large.png',contentType:'image/png',bytes:11*1024**2},{id:'movie',name:'Movie.mov',contentType:'video/quicktime',bytes:100}];
  const media={id:'favorite',contentType:'image/jpeg',favorite:true};
  const jobs=[{id:'current',projectId:'a',settings:{prompt:'{"scene_description":"A quiet study"}'},tasks:[{status:'COMPLETED',outputs:[media,{...media,id:'removed',deletedAt:'now'},{...media,id:'not-favorite',favorite:false}]},{status:'COMPLETED',deletedAt:'now',outputs:[media]}]},{id:'other',projectId:'b',tasks:[{status:'COMPLETED',outputs:[media]}]}];
  const sources=referenceLibrarySources({assets,jobs,projectId:'a',kind:'image',maxMB:10});
  assert.deepEqual(sources.map(s=>s.key),['asset:image','asset:large','favorite:current:favorite']);
  assert.equal(sources[1].disabled,true);assert.match(sources[1].reason,/10 MB/);assert.equal(sources[2].name,'A quiet study');
  assert.equal(referenceLibrarySources({assets,jobs,projectId:'a',kind:'video',maxMB:50}).length,1);
  assert.equal(referenceLibrarySources({assets,jobs,projectId:'a',kind:'video',maxMB:50,contentTypes:['video/mp4']}).length,0);
});
test('reference picker accounts for retained files, per-kind limits, shared totals and older server limits',()=>{
  const limits={image:9,video:3,audio:3,total:12};
  const refs=[...Array(8).fill({kind:'image'}),...Array(2).fill({kind:'video'})];
  assert.equal(referencePickerCapacity(limits,refs,'image'),1);
  assert.equal(referencePickerCapacity(limits,refs,'audio'),2);
  assert.equal(referencePickerCapacity(limits,refs,'audio',11),1);
  assert.equal(referencePickerCapacity({image:2,total:2},[{kind:'image'}],'image'),1);
  assert.equal(referencePickerCapacity({image:1,total:1},[{kind:'image'},{kind:'image'}],'image'),0);
  assert.equal(referencePickerCapacity({image:8,total:8},[],'video'),0);
});

test('all shared picker sources separate general assets, outfits and IDs',async()=>{
 const {llmLibrarySources}=await import('../public/llm.js');
 const {canvasLibrarySources}=await import('../public/canvas-library.js');
 const assets=[{id:'general'},{id:'outfit',category:'outfit'},{id:'id',category:'id'},{id:'legacy-outfit',sources:[{category:'outfit'}]},{id:'legacy-id',sources:[{category:'id'}]}].map(a=>({name:a.id,contentType:'image/png',bytes:100,...a}));
 const expected=['assets','outfit','id','outfit','id'];
 assert.deepEqual(referenceLibrarySources({assets,jobs:[],projectId:'p',kind:'image',maxMB:10}).map(s=>s.collection),expected);
 assert.deepEqual(llmLibrarySources(assets,[],'p').map(s=>s.collection),expected);
 for(const source of ['assets','outfit','id'])assert.deepEqual(canvasLibrarySources({assets,source}).map(s=>s.media.id),assets.filter((a,i)=>expected[i]===source).map(a=>a.id));
 assert.equal(canvasLibrarySources({assets,source:'favorites'}).length,0);
});
