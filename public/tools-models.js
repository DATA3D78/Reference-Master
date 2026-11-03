// Input controls verified against the linked fal OpenAPI schemas on 2026-10-08.
const choice=(key,label,values,value)=>({key,label,type:'select',values,value});
const number=(key,label,value,min,max,step=1,extra={})=>({key,label,type:'number',value,min,max,step,...extra});
const toggle=(key,label,value=false)=>({key,label,type:'checkbox',value});
export const TOOLS=[
 {id:'seedvr-video',name:'Video enhancer',modelName:'SeedVR2 Video',kind:'video',endpoint:'fal-ai/seedvr/upscale/video',icon:'spark',description:'Enhance and upscale your footage with SeedVR2.',note:'Keeps the source aspect ratio. Saves an H.264 MP4 for playback and reuse.',action:'Enhance video',maxMB:200,fields:[
  choice('upscale_mode','Resize by',['factor','target'],'factor'),number('upscale_factor','Upscale factor',2,1,10,.1,{when:['upscale_mode','factor']}),{...choice('target_resolution','Target resolution',['720p','1080p','1440p','2160p'],'1080p'),when:['upscale_mode','target']},choice('output_quality','Output quality',['low','medium','high','maximum'],'high'),
  number('noise_scale','Noise scale',.1,0,1,.001,{advanced:true}),number('seed','Seed','',Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,1,{optional:true,advanced:true,placeholder:'Random'}),{...choice('output_write_mode','Output encoding',['fast','balanced','small'],'balanced'),advanced:true}
 ]},
 {id:'seedvr-seamless',name:'Image upscaling',modelName:'SeedVR Seamless',kind:'image',endpoint:'fal-ai/seedvr/upscale/image/seamless',icon:'image',description:'Enlarge images while preserving seamless textures.',note:'Keeps the source aspect ratio. Seamless textures stay tileable.',action:'Upscale image',maxMB:30,fields:[
  choice('upscale_mode','Resize by',['factor','target'],'factor'),number('upscale_factor','Upscale factor',2,1,10,.1,{when:['upscale_mode','factor']}),choice('target_resolution','Target resolution',['720p','1080p','1440p','2160p'],'1080p'),choice('output_format','Output format',['png','jpeg','webp'],'png'),number('noise_scale','Noise scale',.1,0,1,.001,{advanced:true}),number('seed','Seed','',0,2147483647,1,{optional:true,advanced:true,placeholder:'Random'})
 ]},
 {id:'depth-anything',name:'Video depth map',modelName:'Depth Anything Video',kind:'video',endpoint:'fal-ai/depth-anything-video',icon:'layers',description:'Turn motion into a depth map for compositing.',note:'Processes up to 2,400 frames. Auto resolution preserves the source up to 1080p.',action:'Generate depth map',maxMB:200,fields:[
  choice('model','Depth model',['VDA-Small','VDA-Base','VDA-Large'],'VDA-Large'),choice('colormap','Depth colors',['grayscale','turbo','inferno','magma','viridis'],'grayscale'),choice('resolution','Output resolution',['auto','360p','480p','720p','1080p'],'auto'),toggle('side_by_side','Show original and depth side by side'),number('max_frames','Maximum frames',2400,1,2400,1,{advanced:true}),number('output_fps','Output frame rate','',.1,240,.1,{optional:true,advanced:true,placeholder:'Keep source FPS'})
 ]}
].map(t=>({...t,provider:'comfy',available:false,docs:'https://fal.ai/models/'+t.endpoint+'/api',pricing:'https://fal.ai/models/'+t.endpoint}));
TOOLS.find(t=>t.id==='seedvr-seamless').fields.find(f=>f.key==='target_resolution').when=['upscale_mode','target'];
export const toolById=id=>TOOLS.find(t=>t.id===id);
export const toolDefaults=id=>Object.fromEntries(toolById(id).fields.map(f=>[f.key,f.value]));
export function toolOptions(id,values={}){
 const tool=toolById(id);if(!tool)throw Error('Choose a supported tool.');
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid tool settings.');
 const options={};
 for(const field of tool.fields){
  const value=values[field.key]??field.value;
  if(field.optional&&(value===''||value===null))continue;
  if(field.type==='select'){if(!field.values.includes(value))throw Error('Choose a valid '+field.label.toLowerCase()+'.');options[field.key]=value;}
  else if(field.type==='checkbox'){if(typeof value!=='boolean')throw Error('Choose a valid '+field.label.toLowerCase()+'.');options[field.key]=value;}
  else{if(typeof value!=='number'||!Number.isFinite(value)||value<field.min||value>field.max||(field.step===1&&!Number.isInteger(value)))throw Error(`${field.label} must be between ${field.min} and ${field.max}.`);if(['grain','noise_scale'].includes(field.key)&&Math.abs(value/field.step-Math.round(value/field.step))>1e-7)throw Error(`${field.label} uses increments of ${field.step}.`);options[field.key]=value;}
 }
 return options;
}
export function validateToolReference(tool,ref){
 if(!ref||ref.kind!==tool.kind)throw Error('Add one '+tool.kind+' to use this tool.');
 if(!Number.isFinite(ref.bytes)||ref.bytes<=0||ref.bytes>tool.maxMB*1024**2)throw Error(`Choose a ${tool.kind} up to ${tool.maxMB} MB.`);
 const types=tool.kind==='image'?['image/png','image/jpeg','image/webp']:['video/mp4','video/quicktime'];
 if(!types.includes(ref.contentType))throw Error(tool.kind==='image'?'Use PNG, JPG or WebP.':'Use an MP4 or MOV video.');
 const info=ref.metadata;
 if(!info||![info.width,info.height].every(n=>Number.isInteger(n)&&n>0&&n<=100000))throw Error('Could not read the source dimensions. Add the file again.');
 if(tool.kind==='video'&&(!Number.isFinite(info.duration)||info.duration<=0))throw Error('Could not read the video duration. Add the file again.');
}
export function buildToolInput(body,ref){
 throw Error('This legacy tool is not available through Comfy Router.');
 const tool=toolById(body.tool);if(!tool)throw Error('Choose a supported tool.');
 validateToolReference(tool,ref);const options=toolOptions(tool.id,body.options);
 const input={...options,[tool.kind+'_url']:ref.data};
 if(['seedvr-seamless','seedvr-video'].includes(tool.id)){input.sync_mode=false;if(tool.kind==='image')input.enable_safety_checker=true;else input.output_format='X264 (.mp4)';if(options.upscale_mode==='factor')delete input.target_resolution;else delete input.upscale_factor;}
 if(tool.id==='depth-anything')input.include_raw_depths=false;
 return {tool,options,endpoint:tool.endpoint,input};
}
export function estimateToolCost(id,values,metadata){
 const tool=toolById(id),base={available:false,checkedAt:'2026-10-09',url:tool?.pricing};
 if(!tool)return {...base,note:'Choose a tool.'};
 let options;try{options=toolOptions(id,values);}catch(e){return {...base,note:e.message};}
 if(!metadata)return {...base,note:'Add '+(tool.kind==='image'?'an image':'a video')+' to estimate the cost.'};
 if(id==='depth-anything'){
  if(!(metadata.duration>0))return {...base,note:'Video duration is needed.'};
  return {...base,available:true,amount:metadata.duration*.04,note:'Based on the full input duration at $0.04/second. Frame limits and final provider billing may change the charge.'};
 }
 if(![metadata.width,metadata.height].every(n=>Number.isFinite(n)&&n>0))return {...base,note:'Source dimensions are needed.'};
 const factor=options.upscale_mode==='factor'?options.upscale_factor:Math.max(1,parseInt(options.target_resolution)/Math.min(metadata.width,metadata.height));
 const mp=metadata.width*metadata.height*factor**2/1e6;
 if(id==='seedvr-video'){
  if(!Number.isSafeInteger(metadata.frameCount)||metadata.frameCount<=0)return {...base,note:'The video frame count could not be read. fal.ai will calculate the charge.'};
  return {...base,available:true,amount:mp*metadata.frameCount*.001,note:`Estimated from ${mp.toFixed(2)} output megapixels × ${metadata.frameCount} frames at $0.001/MP. Provider sizing and billing may differ.`};
 }
 return {...base,available:true,amount:mp*.0025,note:`Estimated from ${mp.toFixed(2)} output megapixels at $0.0025/MP. Provider sizing and billing may differ.`};
}
