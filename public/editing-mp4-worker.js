import {finalizeH264MP4} from './editing-mp4.js';
self.onmessage=async({data})=>{
 try{
  const result=await finalizeH264MP4(data.buffer,{...data.options,onProgress:progress=>self.postMessage({progress})});
  self.postMessage({result},[result.buffer]);
 }catch(error){self.postMessage({error:error.message||'The MP4 could not be finalized.'});}
};
