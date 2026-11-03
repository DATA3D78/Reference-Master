// Native Comfy Router schemas: https://docs.comfy.org/development/comfy-router/schemas
export const COMFY_MODELS={
 'nano-pro':'vertexai/gemini-3-pro-image','nano21':'vertexai/gemini-nano-banana-2.1',
 'krea2-large':'krea/krea-2-large','krea2-medium':'krea/krea-2-medium','krea2-medium-turbo':'krea/krea-2-medium-turbo',
 'gpt25-flare':'openai/gpt-image-2.5-flare','gpt25-sunburst':'openai/gpt-image-2.5-sunburst',
 'seedream5-lite':'byteplus/seedream-5-0-260128','seedream5-pro':'byteplus/seedream-5-0-pro-260628',
 'flux3-image':'bfl/flux-3-image','wan3':'wan/wan3.0-video','seedance20':'byteplus/dreamina-seedance-2-0-260128','seedance25':'byteplus/dreamina-seedance-2-5-260628',
 'minimax-h3':'minimax/minimax-h3','flux3-video':'bfl/flux-3-video'
};
export const rawBase64=value=>typeof value==='string'?value.replace(/^data:[^,]+,/, ''):value;
export function comfyModel(model){
 const endpoint=COMFY_MODELS[model.id];
 const referenceEndpoints=model.endpoints||(model.id==='seedance20'?{text:'bytedance/seedance-2.0/text-to-video',image:'bytedance/seedance-2.0/image-to-video',frames:'bytedance/seedance-2.0/image-to-video',video:'bytedance/seedance-2.0/reference-to-video'}:undefined);
 const result={...model,referenceEndpoints,provider:'comfy',available:!!endpoint,inputVersion:3,docs:'https://comfy.org/platform/router/',endpoints:endpoint?Object.fromEntries(model.inputs.map(type=>[type,type==='edit'?'bfl/video-edit-v1':endpoint])):undefined};
 if(!endpoint){result.description='Not available through this Comfy integration';result.unavailableReason='An exact Comfy Router schema for this model has not been published. Choose another model.';}
 if(model.family==='krea'){result.resolutions=['1K'];result.note='1K output. References guide the visual style.';}
 if(model.id==='wan3'){
  result.description='Video from prompts, frames and image references';result.maxVideos=0;
  result.referenceLimits={image:10,video:0,audio:0,total:10};result.videoAction='Use image references';
  result.videoNote='Comfy accepts local images here. Video and audio references require a public media URL and are unavailable in this local uploader.';
 }
 if(model.id==='seedance25'){
  result.maxVideos=0;result.referenceLimits={image:30,video:0,audio:10,total:40};result.videoAction='Use image & audio references';
  result.videoNote='Local image and audio references are supported. Comfy requires public URLs for video references.';
 }
 if(model.id==='seedance20')result.docs='https://docs.comfy.org/development/comfy-router/models/byteplus/dreamina-seedance-2-0-260128/code';
 if(model.id==='wan3')result.docs='https://docs.comfy.org/development/comfy-router/models/wan/wan3-0-video/code';
 if(model.id==='minimax-h3'){
  result.inputs=['text','image','frames','end'];result.resolutions=['768p','2K'];result.targetAudio=false;
  result.referenceLimits=undefined;result.note='Comfy Router supports 768p and 2K output.';result.description='Video from text and first/last frames';
 }
 return result;
}
export function nativeInput(model,body,references,dimensions){
 const prompt=body.prompt.trim(),urls=references.map(r=>r.data),kind=body.inputType;
 if(kind==='edit')return {prompt,video:rawBase64(urls[0]),safety_tolerance:2};
 if(model.family==='nano'){
  const generationConfig={responseModalities:['IMAGE'],imageConfig:{imageSize:body.resolution,imageOutputOptions:{mimeType:'image/png'}}};
  if(body.ratio!=='auto')generationConfig.imageConfig.aspectRatio=body.ratio;
  if(model.thinkingLevels)generationConfig.thinkingConfig={thinkingLevel:(body.thinking||'medium').toUpperCase()};
  return {contents:[{role:'user',parts:[{text:prompt},...references.map(ref=>({inlineData:{mimeType:ref.contentType,data:rawBase64(ref.data)}}))]}],generationConfig,uploadImagesToStorage:true};
 }
 if(model.family==='krea')return {prompt,aspect_ratio:body.ratio,resolution:'1K',creativity:body.creativity||'medium',...(urls.length?{image_style_references:urls.map(url=>({url,strength:1}))}:{})};
 if(model.family==='gpt'||model.family==='seedream'){
  const input={prompt,size:dimensions.width+'x'+dimensions.height,output_format:'png'};
  if(model.family==='gpt')Object.assign(input,{n:1,quality:body.quality||'high'});
  else Object.assign(input,{response_format:'url',watermark:false,...(model.id==='seedream5-lite'?{sequential_image_generation:'disabled'}:{})});
  if(urls.length)input.image=urls;return input;
 }
 if(model.family==='flux-image')return {prompt,aspect_ratio:body.ratio,resolution:body.resolution.toLowerCase(),...(urls.length?{images:urls.map(rawBase64)}:{})};
 if(model.family==='wan'){
  const media=references.map((ref,index)=>({type:kind==='video'?'reference_image':index===0?'first_frame':'last_frame',url:ref.data}));
  return {input:{prompt,...(media.length?{media}:{})},parameters:{duration:Number(body.duration),resolution:body.resolution.toUpperCase(),ratio:body.ratio,audio:!!body.audio,watermark:false}};
 }
 if(model.family==='seedance'||model.family==='minimax'){
  const content=[{type:'text',text:prompt},...references.map((ref,index)=>{
   const type=ref.kind+'_url';return {type,[type]:{url:ref.data},role:kind==='video'?'reference_'+ref.kind:kind==='end'||index===1?'last_frame':'first_frame'};
  })];
  return {content,duration:Number(body.duration),resolution:model.family==='minimax'?body.resolution.toUpperCase():body.resolution,ratio:body.ratio==='From image'?'adaptive':body.ratio,...(model.family==='seedance'?{generate_audio:!!body.audio,watermark:false}:{aigc_watermark:false}),...(model.id==='seedance25'?{output_format:'mp4'}:{})};
 }
 if(model.family==='flux-video'){
  const input={mode:kind==='text'?'t2v':kind==='video'?'v2v':'i2v',prompt,duration:Number(body.duration),aspect_ratio:body.ratio,resolution:body.resolution==='720p'?'hd':'fhd',generate_audio:!!body.audio};
  if(kind==='video')input.start_video=rawBase64(urls[0]);
  else if(urls.length)input.keyframes=kind==='keyframes'?urls.map((url,i)=>[body.frameIndices[i]/24,rawBase64(url)]).sort((a,b)=>a[0]-b[0]):urls.map(rawBase64);
  return input;
 }
 throw Error('This model does not have a Comfy Router adapter.');
}
