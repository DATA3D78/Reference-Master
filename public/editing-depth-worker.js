// The model and inference runtime are bundled locally. Media never leaves the browser.
import {pipeline,env,RawImage} from './vendor/depth-runtime/transformers.min.js';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='/vendor/';
env.backends.onnx.wasm.wasmPaths='/vendor/depth-runtime/';env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
let estimator;
self.onmessage=async({data:{id,width,height,pixels}})=>{
 try{
  estimator??=pipeline('depth-estimation','depth-anything-v2-small',{device:'wasm',dtype:'q8',progress_callback:p=>{if(p.status==='progress')self.postMessage({id,progress:p.progress});}}).catch(e=>{estimator=null;throw e;});
  const pipe=await estimator,{depth}=await pipe(new RawImage(new Uint8ClampedArray(pixels),width,height,4));
  const data=new Uint8Array(depth.data);self.postMessage({id,width:depth.width,height:depth.height,data},[data.buffer]);
 }catch(e){self.postMessage({id,error:e.message||'Depth could not be estimated.'});}
};
