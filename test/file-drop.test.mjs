import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliverFiles,installFileDrops,registerFileDrop} from '../public/library.js';

test('desktop drops use the existing upload change event, preserve multiple files, and enforce single-file and disabled inputs',()=>{
 const previous=globalThis.DataTransfer;
 globalThis.DataTransfer=class {files=[];items={add:file=>this.files.push(file)};};
 try{
  let calls=0;const input={multiple:true,matches:()=>false,dispatchEvent:e=>{assert.equal(e.type,'change');assert.equal(e.bubbles,true);calls++;}};
  const files=[new File(['a'],'one.png'),new File(['b'],'two.png')];
  assert.equal(deliverFiles(input,files),true);assert.deepEqual(input.files,files);assert.equal(calls,1);
  input.multiple=false;assert.throws(()=>deliverFiles(input,files),/one file/);assert.equal(calls,1);
  input.matches=()=>true;assert.equal(deliverFiles(input,[files[0]]),false);assert.equal(calls,1);
 }finally{globalThis.DataTransfer=previous;}
});

test('routing follows the current picker destination and handles file drops only once without intercepting app media drags',()=>{
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldTransfer=globalThis.DataTransfer;
 const events={};let destination,calls=0,stopped=0,closed=0;
 globalThis.document={querySelector:()=>null,addEventListener:(name,fn)=>{events[name]=fn;}};
 globalThis.window={addEventListener:()=>{}};
 globalThis.DataTransfer=class {files=[];items={add:f=>this.files.push(f)};};
 try{
  const zone={classList:{add(){},remove(){}},closest:()=>({close(){closed++;}})};
  registerFileDrop('#test-picker',()=>destination);
  installFileDrops(message=>assert.fail(message));
  destination={id:'one',multiple:true,matches:()=>false,dispatchEvent(){calls++;}};
  const event={target:{closest:s=>s==='#test-picker'?zone:null},dataTransfer:{types:['Files'],files:[new File(['a'],'photo.png')]},preventDefault(){},stopImmediatePropagation(){stopped++;}};
  events.drop(event);assert.equal(calls,1);assert.equal(stopped,1);assert.equal(closed,1);
  destination={id:'outfit',multiple:false,matches:()=>false,dispatchEvent(){calls+=10;}};
  events.drop(event);assert.equal(calls,11);
  event.dataTransfer.types=['application/x-fwrd-media'];events.drop(event);assert.equal(calls,11);
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;globalThis.DataTransfer=oldTransfer;}
});
