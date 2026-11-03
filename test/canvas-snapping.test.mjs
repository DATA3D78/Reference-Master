import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapTranslation} from '../public/canvas-state.js';
import {IdeationCanvas} from '../public/ideation.js';
const card=(id,x,y,width=100,height=80)=>({id,x,y,width,height});
const position=(item,snap)=>({x:item.x+snap.dx,y:item.y+snap.dy});

test('invisible grid uses world coordinates, including negatives, at every zoom',()=>{
  const item=card('a',5,9);
  for(const zoom of [.15,.5,1,3]){
    const snap=snapTranslation([item],[item],{x:15,y:-32},{zoom});
    assert.deepEqual(position(item,snap),{x:16,y:-16});assert.deepEqual(snap.guides,[]);
  }
});
test('nearby edges and centers take precedence over the grid and produce guides',()=>{
  const item=card('a',5,5),target=card('b',350,100);
  const edge=snapTranslation([item],[item,target],{x:88,y:90});
  assert.equal(position(item,edge).y,100);assert.equal(edge.guides[0].axis,'y');assert.equal(edge.guides[0].value,100);
  const centered=snapTranslation([card('a',0,0)],[card('b',200,350,160)],{x:232,y:100});
  assert.equal(centered.dx+50,280);assert.equal(centered.guides[0].value,280);
});
test('magnetic tolerance is measured in screen pixels at different zoom levels',()=>{
  const item=card('a',0,0),target=card('b',400,300);
  assert.equal(snapTranslation([item],[target],{x:295,y:150},{zoom:1}).dx,300);
  assert.equal(snapTranslation([item],[target],{x:295,y:150},{zoom:2}).dx,288); // Grid only; ten screen pixels is too far.
  assert.equal(snapTranslation([item],[target],{x:290,y:150},{zoom:.5}).dx,300);
});
test('groups and multiple selections snap as a unit without changing internal spacing',()=>{
  const items=[card('a',10,25,80,80),card('b',130,55,80,100)],target=card('c',400,200,200,130);
  const snap=snapTranslation(items,[...items,target],{x:185,y:178});
  const moved=items.map(i=>position(i,snap));
  assert.deepEqual(moved,[{x:200,y:200},{x:320,y:230}]);assert.equal(snap.guides.length,2);
  const stationary=[{...card('c',200,500,80),groupId:'g'},{...card('d',320,500,80),groupId:'g'}];
  const groupCenter=snapTranslation([card('a',0,0)],stationary,{x:253,y:320});
  assert.equal(groupCenter.dx+50,300); // Center of the stationary group, not either member.
});
test('Option/Alt or Snap off bypasses both grid and magnets without mutating items',()=>{
  const item=card('a',5,5),target=card('b',350,100),before=structuredClone([item,target]);
  assert.deepEqual(snapTranslation([item],[target],{x:88,y:90},{enabled:false}),{dx:88,dy:90,guides:[]});
  assert.deepEqual([item,target],before);
});
test('distant cards do not attract selections, and canvas limits preserve group spacing',()=>{
  const item=card('a',0,0),far=card('b',400,10000);
  assert.deepEqual(snapTranslation([item],[far],{x:295,y:150}).guides,[]);
  const group=[card('a',99920,0),card('b',99980,30)];
  for(const enabled of [true,false]){const snap=snapTranslation(group,[],{x:100,y:40},{enabled});assert(snap.dx>=0&&snap.dx<=20);assert(position(group[1],snap).x<=100000);assert.equal(position(group[1],snap).x-position(group[0],snap).x,60);}
});
test('drag controller applies snapping, bypasses it with Alt, and leaves resize geometry alone',()=>{
  const original=card('a',5,5),canvas=Object.create(IdeationCanvas.prototype);
  Object.assign(canvas,{board:{items:[{...original},card('b',350,100)]},cards:new Map([['a',{style:{}}]]),snapEnabled:true,renderGroups(){},renderSnapGuides(guides){this.guides=guides;}});
  const gesture=()=>({kind:'move',start:{x:0,y:0},zoom:1,items:[{...original}]});
  canvas.gesture=gesture();canvas.pointerMove({clientX:1,clientY:1});assert.deepEqual(canvas.board.items[0],original);
  canvas.pointerMove({clientX:88,clientY:90});assert.equal(canvas.board.items[0].y,100);assert(canvas.guides.length);
  canvas.pointerMove({clientX:88,clientY:90,altKey:true});assert.equal(canvas.board.items[0].y,95);assert.equal(canvas.guides.length,0);
  canvas.board.items[0]={...original,type:'note'};canvas.gesture={...gesture(),kind:'resize'};canvas.pointerMove({clientX:47,clientY:60});assert.equal(canvas.board.items[0].width,147);assert.equal(canvas.board.items[0].height,140);assert.equal(canvas.guides.length,0);
});
