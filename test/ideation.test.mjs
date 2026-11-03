import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIdeationStore,validateCanvasPosition} from '../ideation-store.mjs';
import {worldPoint,zoomAt,fitCamera,gridLayout,findSpace} from '../public/canvas-state.js';
const media={id:'image-1',width:1280,height:720};
const job={id:'job-1',mode:'image',settings:{ratio:'16:9',destination:'ideation',canvasPosition:{x:-300,y:50}},tasks:[{status:'COMPLETED',outputs:[media]}]};
const findMedia=(jobId,mediaId)=>{assert.equal(jobId,job.id);assert.equal(mediaId,media.id);return {job,media};};
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'canvas-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,store:await createIdeationStore({directory,findMedia})};}
test('canvas saves media, notes, sizes, title and camera across reopening',async t=>{
  const {store,directory}=await fixture(t);
  await store.mutate([{type:'addMedia',jobId:job.id,mediaId:media.id,position:{x:0,y:0}},{type:'addNote',id:'note',position:{x:400,y:0}}]);
  const board=await store.mutate([{type:'update',id:'media:job-1:image-1',patch:{x:-125,y:250,width:540,height:346}},{type:'update',id:'note',patch:{text:'Cool daylight, slow motion.'}},{type:'camera',camera:{x:85,y:20,zoom:.7}},{type:'title',title:'Blue hour'}]);
  const restarted=await createIdeationStore({directory,findMedia});assert.deepEqual(restarted.snapshot(),board);
  assert.equal(board.items[1].text,'Cool daylight, slow motion.');
  const saved=JSON.parse(await readFile(join(directory,'ideation.json'),'utf8'));assert.deepEqual(saved,board);assert(!JSON.stringify(saved).includes('https://'));
});
test('completed ideation generations arrive once, removal survives sync and restart, manual re-add works',async t=>{
  const {store,directory}=await fixture(t);
  const board=await store.syncJobs([job]);assert.equal(board.items.length,1);assert.equal(board.items[0].x,-300);
  assert.equal((await store.syncJobs([job])).revision,board.revision);
  await store.mutate([{type:'remove',ids:[board.items[0].id]}]);
  await store.syncJobs([job]);assert.equal(store.snapshot().items.length,0);assert.equal(job.tasks[0].outputs.length,1);
  const restarted=await createIdeationStore({directory,findMedia});await restarted.syncJobs([job]);assert.equal(restarted.snapshot().items.length,0);
  await restarted.mutate([{type:'addMedia',jobId:job.id,mediaId:media.id}]);assert.equal(restarted.snapshot().items.length,1);
  const {store:other}=await fixture(t);await other.syncJobs([{...job,settings:{ratio:'16:9'}}]);assert.equal(other.snapshot().items.length,0);
});
test('concurrent edits merge and invalid batches do not overwrite the saved canvas',async t=>{
  const {store,directory}=await fixture(t);await store.mutate([{type:'addNote',id:'a'}]);
  await Promise.all([store.mutate([{type:'update',id:'a',patch:{x:300}}]),store.mutate([{type:'update',id:'a',patch:{text:'Keep this'}}])]);
  assert.equal(store.snapshot().items[0].x,300);assert.equal(store.snapshot().items[0].text,'Keep this');
  const before=store.snapshot();await assert.rejects(store.mutate([{type:'title',title:'discard me'},{type:'update',id:'a',patch:{width:0}}]));assert.deepEqual(store.snapshot(),before);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'ideation.json'),'utf8')),before);
  for(const operations of [[{type:'camera',camera:{x:0,y:0,zoom:0}}],[{type:'addMedia',jobId:'missing',mediaId:'x'}],[{type:'update',id:'a',patch:{url:'https://example.com'}}],[{type:'update',id:'a',patch:{text:'x'.repeat(3001)}}]])await assert.rejects(store.mutate(operations));
  // Replaying an acknowledged note operation after a lost response is harmless.
  await store.mutate([{type:'addNote',id:'a'}]);assert.equal(store.snapshot().items.length,1);assert.equal(store.snapshot().items[0].text,'Keep this');
});
test('remove and restore preserve exact item geometry and note text',async t=>{
  const {store}=await fixture(t);await store.syncJobs([job]);await store.mutate([{type:'addNote',id:'note'},{type:'update',id:'note',patch:{text:'Direction A',width:400}}]);
  const items=store.snapshot().items;await store.mutate([{type:'remove',ids:items.map(i=>i.id)}]);await store.mutate([{type:'restore',items}]);assert.deepEqual(store.snapshot().items,items);
});
test('zoom keeps the pointer anchored, Fit contains items, and arrange avoids overlap',()=>{
  const camera={x:-80,y:170,zoom:.7},point={x:410,y:300};assert.deepEqual(worldPoint(point,zoomAt(camera,point,1.4)),worldPoint(point,camera));
  assert.equal(zoomAt(camera,point,100).zoom,3);
  const items=[{id:'a',x:-100,y:20,width:300,height:180},{id:'b',x:400,y:400,width:260,height:400},{id:'c',x:60,y:0,width:500,height:200}];
  const fit=fitCamera(items,1200,800);for(const i of items){assert(i.x*fit.zoom+fit.x>=49);assert((i.x+i.width)*fit.zoom+fit.x<=1151);assert(i.y*fit.zoom+fit.y>=49);assert((i.y+i.height)*fit.zoom+fit.y<=751);}
  const arranged=gridLayout(items).map(p=>({...items.find(i=>i.id===p.id),...p}));
  for(let i=0;i<arranged.length;i++)for(let j=i+1;j<arranged.length;j++){const a=arranged[i],b=arranged[j];assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
  assert.notDeepEqual(findSpace([{x:0,y:0,width:300,height:300}],{x:0,y:0},300,300),{x:0,y:0});
  for(const p of [{x:Infinity,y:0},{x:0,y:100000},null])assert.throws(()=>validateCanvasPosition(p));
});

test('groups survive reopening, move together, rename and undo grouping without affecting media',async t=>{
  const {store,directory}=await fixture(t);await store.mutate([{type:'addNote',id:'a'},{type:'addNote',id:'b',position:{x:500,y:0}}]);
  const grouped=await store.mutate([{type:'groups',members:[{id:'a',groupId:'g',groupName:'Direction A'},{id:'b',groupId:'g',groupName:'Direction A'}]}]);
  const reopened=await createIdeationStore({directory,findMedia});assert.deepEqual(reopened.snapshot(),grouped);
  const before=reopened.snapshot().items;await reopened.mutate(before.map(i=>({type:'update',id:i.id,patch:{x:i.x+40,y:i.y+25}})));
  assert.deepEqual(reopened.snapshot().items.map(i=>[i.x,i.y]),before.map(i=>[i.x+40,i.y+25]));
  await reopened.mutate([{type:'groups',members:before.map(i=>({id:i.id,groupId:'g',groupName:'Hero shots'}))}]);assert(reopened.snapshot().items.every(i=>i.groupName==='Hero shots'));
  await reopened.mutate([{type:'groups',members:before.map(i=>({id:i.id}))}]);assert(reopened.snapshot().items.every(i=>i.groupId===undefined));
  await assert.rejects(reopened.mutate([{type:'groups',members:[{id:'a',groupId:'g',groupName:''}]}]));
});

test('canvas assets keep their native ratio, grouping and geometry across undo and restart',async t=>{
  const {directory}=await fixture(t),assets={portrait:{id:'portrait',contentType:'image/png',width:900,height:1600},clip:{id:'clip',contentType:'video/mp4',width:1920,height:1080}};
  const findAsset=id=>{if(!assets[id])throw Error('Unknown asset');return assets[id];};
  const store=await createIdeationStore({directory,findMedia,findAsset});
  let board=await store.mutate([{type:'addAsset',assetId:'portrait'},{type:'addAsset',assetId:'clip'},{type:'addMedia',jobId:job.id,mediaId:media.id}]);
  assert.equal(board.items.length,3);assert.equal(board.items[0].width/board.items[0].height,900/1600);assert.equal(board.items[1].height,168.75);
  assert.notEqual(board.items[0].x,board.items[1].x);
  await store.mutate([{type:'addAsset',assetId:'portrait'}]);assert.equal(store.snapshot().items.length,3);
  board=await store.mutate([{type:'groups',members:board.items.map(i=>({id:i.id,groupId:'g',groupName:'Mixed sources'}))},{type:'update',id:'asset:portrait',patch:{x:-200,y:80,width:450,height:800}}]);
  const items=board.items;await store.mutate([{type:'remove',ids:items.map(i=>i.id)}]);
  assets.portrait.deletedAt=new Date().toISOString();
  await store.mutate([{type:'restore',items:items.map(i=>({...i,asset:{name:'Transient metadata'}}))}]);
  assert.deepEqual(store.snapshot().items,items);
  const reopened=await createIdeationStore({directory,findMedia,findAsset});assert.deepEqual(reopened.snapshot(),store.snapshot());
  await assert.rejects(store.mutate([{type:'addAsset',assetId:'portrait'}]),/Trash/);
  const before=store.snapshot();await assert.rejects(store.mutate([{type:'title',title:'Uncommitted'},{type:'addAsset',assetId:'missing'}]));assert.deepEqual(store.snapshot(),before);
  assets.sound={contentType:'audio/mpeg'};await assert.rejects(store.mutate([{type:'addAsset',assetId:'sound'}]),/images and videos/);
});
