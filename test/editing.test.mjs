import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultEdit,defaultEffect,normalizeEdit,curveValue,curveTexture,exportSize,EFFECTS} from '../public/editing-models.js';

test('neutral curves preserve every 8-bit channel value',()=>{
 const lut=curveTexture(defaultEdit().curves);
 for(let i=0;i<256;i++)assert.deepEqual([...lut.slice(i*4,i*4+4)],[i,i,i,255]);
});
test('RGB master and per-channel curves compose without changing other channels',()=>{
 const settings=defaultEdit();settings.curves.rgb=[[0,.1],[1,.9]];settings.curves.r=[[0,0],[1,.5]];
 const lut=curveTexture(settings.curves);
 assert.deepEqual([...lut.slice(0,4)],[13,26,26,255]);assert.deepEqual([...lut.slice(1020)],[115,230,230,255]);
});
test('tone curve interpolation stays between adjacent control points even at uneven spacing',()=>{
 for(const points of [[[0,0],[.01,.8],[.8,.85],[1,1]],[[0,1],[.2,.1],[.5,.8],[1,.2]]]){
  for(let i=0;i<points.length-1;i++){const [x0,y0]=points[i],[x1,y1]=points[i+1];for(let n=0;n<=100;n++){const v=curveValue(points,x0+(x1-x0)*n/100);assert.ok(v>=Math.min(y0,y1)-1e-8&&v<=Math.max(y0,y1)+1e-8);}}
  for(const [x,y] of points)assert.ok(Math.abs(curveValue(points,x)-y)<1e-8);
 }
});
test('corrupt drafts cannot retain retired controls, invalid curves or shader colors',()=>{
 assert.deepEqual(normalizeEdit(null),defaultEdit());
 const value=normalizeEdit({grade:{black:5,white:-1,gamma:NaN,saturation:300},curves:{rgb:[[0,0],[0,.5],[1,1]],r:[[0,0],[.3,.7],[1,1]]},effect:{id:'unknown',size:Infinity,angle:-5,foreground:'red; bad',sourceColor:'no'}});
 assert.equal(value.grade.black,undefined);assert.equal(value.grade.white,undefined);assert.equal(value.grade.gamma,undefined);assert.equal(value.grade.saturation,100);assert.deepEqual(value.curves.rgb,[[0,0],[1,1]]);assert.equal(value.curves.r.length,3);assert.deepEqual(value.effects,[]);
 assert.equal(new Set(EFFECTS.map(e=>e.index)).size,EFFECTS.length);
});
test('export sizing preserves orientation and never enlarges source media',()=>{
 assert.deepEqual(exportSize(6000,4000,1920),{width:1920,height:1280});assert.deepEqual(exportSize(4000,6000,1920),{width:1280,height:1920});assert.deepEqual(exportSize(640,360,1920),{width:640,height:360});assert.deepEqual(exportSize(3000,2000),{width:3000,height:2000});assert.throws(()=>exportSize(0,600));assert.throws(()=>exportSize(Infinity,600));
});

test('single-effect drafts migrate; explicit empty stacks clear them',()=>{
 const legacy={id:'glass',amount:71,size:19,angle:92,threshold:.32,foreground:'#ABCDEF',background:'#112233',sourceColor:false};
 assert.deepEqual(normalizeEdit({effect:legacy}).effects,[legacy]);
 assert.deepEqual(normalizeEdit({effect:legacy,effects:[]}).effects,[]);
 assert.deepEqual(normalizeEdit({effect:{id:'none'}}).effects,[]);
});
test('effect stacks retain order and independent settings while sanitizing invalid entries',()=>{
 const stack=[{...defaultEffect('glass'),size:22},{...defaultEffect('duotone'),foreground:'#987654',amount:31}];
 const normalized=normalizeEdit({effects:stack});assert.deepEqual(normalized.effects,stack);
 stack[0].size=55;assert.equal(normalized.effects[0].size,22);
 const bounded=normalizeEdit({effects:[null,{id:'none'},{id:'bad'},...normalized.effects,{id:'glass',size:60},{id:'pixel',size:Infinity,angle:-5,foreground:'red;bad',sourceColor:'no',amount:101}]});
 assert.deepEqual(bounded.effects.map(e=>e.id),['glass','duotone','pixel']);
 assert.deepEqual(bounded.effects[2],{...defaultEffect('pixel'),angle:0});
});

test('the Effects gallery contains exactly the requested retained and new looks',()=>{
 const retained=['VHS','Dithering','Halftone','Pixelate','Threshold','Duotone','Reeded Glass'];
 const added=['Receipt Scans','Receipt','Stippling','Cross Hatch','Euphoria','Torn Photo','Scribble Frames','Bad Signal','Slow Shutter','Gameboy Camera','PS1','Grunge Dither','Mixed Media','Motion Freeze','1D','TV','Grunge','Static Grain','Gradient Map'];
 assert.deepEqual(EFFECTS.filter(e=>e.id!=='none').map(e=>e.name).sort(),[...retained,...added].sort());
 assert.deepEqual(normalizeEdit({effects:['ascii','edges','glow','ripple','blur','zoom','blocks'].map(id=>({id}))}).effects,[]);
});
test('new effect controls keep independent colors, animation and texture settings within bounds',()=>{
 const value=normalizeEdit({effects:[{id:'gradient-map',midtone:'#123456',foreground:'#fedcba',threshold:.33},{id:'receipt-scans',seed:9999,speed:-4},{id:'bad-signal',seed:9,speed:2.5}]});
 assert.equal(value.effects[0].midtone,'#123456');assert.equal(value.effects[0].foreground,'#fedcba');assert.equal(value.effects[0].threshold,.33);
 assert.equal(value.effects[1].seed,999);assert.equal(value.effects[1].speed,0);assert.equal(value.effects[2].seed,9);assert.equal(value.effects[2].speed,2.5);
 assert.deepEqual(normalizeEdit(value),value);
});
