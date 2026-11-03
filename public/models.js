import {comfyModel,nativeInput} from './comfy-inputs.js';
const imageRatios = ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','4:5','5:4','21:9'];
const videoRatios = ['16:9','9:16','1:1','4:3','3:4'];
const seconds = (min,max) => Array.from({length:max-min+1},(_,i)=>String(min+i));

// Video input paths, counts and rules checked against fal's schemas on 2026-10-02.
export const MODELS = [
  { id:'nano-pro', name:'Nano Banana Pro', maker:'Google', mode:'image', mark:'N',
    family:'nano', description:'Image generation & reference editing', inputs:['text','image'],
    ratios:imageRatios, resolutions:['1K','2K','4K'], maxImages:8, maxVideos:0, minPrompt:3,
    endpoints:{} },
  { id:'nano21', name:'Nano Banana 2.1', maker:'Google', mode:'image', mark:'N',
    family:'nano', description:'New image generation & reference editing', inputs:['text','image'],
    ratios:[...imageRatios,'4:1','1:4','8:1','1:8','auto'], resolutions:['1K','2K','4K'], maxImages:14,maxVideos:0,minPrompt:3,maxPrompt:50000,
    thinkingLevels:['minimal','medium','high'],pricingChecked:'2026-10-09',
    endpoints:{} },
  ...[['large','Large',.06,.065],['medium','Medium',.03,.035],['medium/turbo','Medium Turbo',.015,.0175]].map(([variant,label,textPrice,referencePrice])=>({
    id:'krea2-'+variant.replace('/','-'),name:'Krea 2 '+label,maker:'Krea',mode:'image',mark:'K',family:'krea',
    description:variant==='medium/turbo'?'Fast image generation & style references':'Image generation & style references',inputs:['text','image'],
    ratios:['1:1','16:9','9:16','4:3','3:2','2:3','4:5','2.35:1'],resolutions:['Native'],maxImages:10,maxVideos:0,maxPrompt:5000,
    creativityLevels:['raw','low','medium','high'],imageAction:'Use style references',referenceImageLabel:'Style reference images',
    imageNote:'Add up to 10 images to guide the visual style. Each reference uses the standard strength.',note:'Krea chooses the output resolution. References guide the visual style.',
    pricingChecked:'2026-10-09',textPrice,referencePrice,
    endpoints:{text:`krea/v2/${variant}/text-to-image`,image:`krea/v2/${variant}/text-to-image`}
  })),
  ...['flare','sunburst'].map(variant=>({
    id:`gpt25-${variant}`, name:`GPT Image 2.5 ${variant==='flare'?'Flare':'Sunburst'}`, maker:'OpenAI', mode:'image', mark:'G',
    family:'gpt', description:variant==='flare'?'Fast generation & precise editing':'Detailed generation & precise editing', inputs:['text','image'],
    ratios:imageRatios, resolutions:['1K','2K','Max'], qualities:['auto','low','medium','high','xhigh','max'], maxImages:8, maxVideos:0,
    sizeLimits:{minArea:655360,maxArea:8294400,maxEdge:3840,step:16},
    endpoints:{text:`openai/gpt-image-2.5/${variant}/text-to-image`,image:`openai/gpt-image-2.5/${variant}/edit`}
  })),
  { id:'seedream5-lite', name:'Seedream 5.0 Lite', maker:'ByteDance', mode:'image', mark:'S',
    family:'seedream', description:'Fast image creation & reference editing', inputs:['text','image'],
    ratios:imageRatios, resolutions:['2K','3K','4K'], maxImages:8, maxVideos:0,
    sizeLimits:{minArea:3686400,maxArea:16777216,maxEdge:14142,step:16},
    endpoints:{} },
  { id:'seedream5-pro', name:'Seedream 5.0 Pro', maker:'ByteDance', mode:'image', mark:'S',
    family:'seedream', description:'Image creation & precise reference editing', inputs:['text','image'],
    ratios:imageRatios, resolutions:['1K','2K'], maxImages:8, maxVideos:0,
    sizeLimits:{minArea:1048576,maxArea:4194304,maxEdge:14142,step:16},
    endpoints:{} },
  { id:'flux3-image', name:'FLUX 3.0', maker:'Black Forest Labs', mode:'image', mark:'F',
    family:'flux-image', description:'Image generation & multi-image editing', inputs:['text','image'],
    ratios:[...imageRatios,'2:1','1:2','7:5','5:7'], resolutions:['1K','2K','4K'], maxImages:8, maxVideos:0,
    imageRules:{minDimension:256,maxArea:4000000},
    endpoints:{},
    imageNote:'References must be at least 256 pixels per side and at most 4 megapixels. 4K generation can take several minutes.' },
  { id:'wan3', name:'Wan 3.0', maker:'Alibaba', mode:'video', mark:'W',
    maxPrompt:20000,family:'wan', description:'Frames, images, video & audio references', inputs:['text','image','frames','video'],
    ratios:videoRatios, resolutions:['480p','720p','1080p'], durations:seconds(2,30),
    maxImages:1,maxVideos:5,videoMB:30,audioMB:15,audioField:'audio',videoRules:{maxDuration:15,maxTotalDuration:15},
    referenceLimits:{image:10,video:5,audio:5,total:20},referencePrefix:'reference_',referenceSyntax:'plain',videoAction:'Use image, video & audio references',
    audioRules:{maxDuration:15,maxTotalDuration:15},audioNote:'Audio clips may total up to 15 seconds.',
    videoNote:'Up to 5 clips, totaling at most 15 seconds, at least 16 fps. Input video duration is billed too.',
    endpoints:{} },
  { id:'seedance20', name:'Seedance 2.0', maker:'ByteDance', mode:'video', mark:'S',
    family:'seedance',description:'Video from prompts, frames, image & audio references',inputs:['text','image','frames','video'],
    ratios:[...videoRatios,'21:9'],resolutions:['480p','720p'],durations:seconds(4,15),
    maxImages:1,maxVideos:3,imageMB:30,videoMB:50,audioMB:15,audioField:'generate_audio',
    referenceLimits:{image:9,video:3,audio:3,total:12},videoAction:'Use image, video & audio references',
    videoRules:{minDuration:2,maxDuration:15,maxTotalDuration:15,minArea:640*640,maxArea:834*1112,maxTotalBytes:50*1024**2,contentTypes:['video/mp4','video/quicktime']},
    imageRules:{minDimension:300,maxDimension:6000,minRatio:0.4,maxRatio:2.5},
    audioRules:{minDuration:2,maxDuration:15,maxTotalDuration:15,contentTypes:['audio/mpeg','audio/wav','audio/x-wav']},
    audioNote:'Up to 3 MP3 or WAV clips, 2–15 seconds each; 15 seconds total. Include at least one image or video.',
    videoNote:'Up to 9 images, 3 videos and 3 audio clips; 12 files total. Videos: 2–15 seconds total, under 50 MB combined, 480p–720p.',
    note:'4–15 seconds · 480p or 720p · optional native audio.',
    endpoints:{} },
  { id:'seedance25', name:'Seedance 2.5', maker:'ByteDance', mode:'video', mark:'S',
    family:'seedance',description:'Long clips from prompts & references',inputs:['text','image','frames','video'],
    ratios:[...videoRatios,'21:9'],resolutions:['480p','720p','1080p'],durations:seconds(4,30),
    maxImages:1,maxVideos:10,imageMB:30,videoMB:200,audioMB:15,audioField:'generate_audio',imageRatio:'From image',
    referenceLimits:{image:30,video:10,audio:10,total:50},videoAction:'Use image, video & audio references',
    audioRules:{minDuration:1.8,maxDuration:30.2,maxTotalDuration:30.2},
    audioNote:'Each audio file must be 1.8–30.2 seconds; 30.2 seconds total.',
    videoRules:{minDuration:1.8,maxDuration:30.2,maxTotalDuration:30.2,minDimension:300,maxDimension:6000,minRatio:0.4,maxRatio:2.5},
    videoNote:'Up to 10 clips, 1.8–30.2 seconds each, totaling at most 30.2 seconds, at 24–60 fps. Each side: 300–6,000 px; aspect ratio: 0.4–2.5.',
    endpoints:{} },
  { id:'minimax-h3', name:'MiniMax H3', maker:'MiniMax', mode:'video', mark:'M',
    family:'minimax',description:'Frames, references & soundtrack control',inputs:['text','image','frames','end','video'],
    ratios:[...videoRatios,'21:9'],resolutions:['480p','768p','2K','4K'],durations:seconds(5,15),
    maxImages:1,maxVideos:3,videoMB:30,audioMB:15,imageRatio:'From image',targetAudio:true,targetAudioRules:{minDuration:2},
    referenceLimits:{image:9,video:3,audio:3,total:12},referencePrefix:'reference_',referenceSyntax:'plain',videoAction:'Use image, video & audio references',
    audioRules:{minDuration:2,maxDuration:15,maxTotalDuration:15},audioNote:'Each audio clip must be 2–15 seconds; 15 seconds total.',
    videoRules:{minDuration:2,maxDuration:15,maxTotalDuration:15},
    videoNote:'Up to 3 clips, 2–15 seconds each, totaling at most 15 seconds. Refer to Video 1, Video 2, etc.',
    note:'Native audio is included. 2K and 4K upscale a 768p base result.',
    endpoints:{} },
  { id:'flux3-video', name:'FLUX Video', maker:'Black Forest Labs', mode:'video', mark:'F',
    promptLimits:{edit:4096},family:'flux-video',description:'First/last frames, keyframes & video edits',inputs:['text','image','frames','keyframes','video','edit'],
    ratios:[...videoRatios,'21:9','2:1'],resolutions:['720p','1080p'],durations:seconds(5,20),
    maxImages:1,maxVideos:1,videoMB:50,audioField:'generate_audio',videoAction:'Extend a video',
    videoRules:{maxDuration:15,exclusiveMaxDuration:true,contentTypes:['video/mp4']},
    videoNote:'One MP4 shorter than 15 seconds. Describe how the video continues from its final frames.',
    endpoints:{} },
].map(model=>({available:true,minPrompt:1,maxPrompt:30000,...model,inputVersion:model.mode==='video'?2:undefined,docs:'https://comfy.org/platform/router/'})).map(comfyModel);

export const targetAudioAllowed=(model,inputType)=>Boolean(model.targetAudio)&&['text','image','frames','end'].includes(inputType);
export function referenceLimitsFor(model,inputType){
  if(inputType==='video'&&model.referenceLimits)return model.referenceLimits;
  const image=inputType==='frames'?2:inputType==='keyframes'?10:inputType==='end'?1:inputType==='image'?model.maxImages:0;
  const video=['video','edit'].includes(inputType)?model.maxVideos:0,audio=targetAudioAllowed(model,inputType)?1:0;
  return {image,video,audio,total:image+video+audio};
}
export function capabilities(model,inputType='text') {
  const limits=referenceLimitsFor(model,inputType);
  return {...model,maxPrompt:model.promptLimits?.[inputType]??model.maxPrompt,ratios:model.id==='wan3'&&inputType==='video'?['adaptive',...model.ratios]:inputType==='edit'?['From video']:['image','frames','end'].includes(inputType)&&model.imageRatio?[model.imageRatio]:model.ratios,
    resolutions:inputType==='edit'?['720p']:model.resolutions,durations:inputType==='edit'?['From video']:model.id==='wan3'&&inputType==='video'?['Smart',...model.durations]:model.durations,
    limits,maxRefs:limits.total};
}

// Keep the selected input's meaning where possible; choose the closest supported
// input only when a model does not offer it. Never modify or discard references.
export function retainedReferenceInput(model,inputType,refs=[]) {
  if(model.inputs.includes(inputType))return inputType;
  const counts=Object.fromEntries(['image','video','audio'].map(kind=>[kind,refs.filter(ref=>ref.kind===kind).length]));
  return model.inputs.reduce((best,type)=>{
    const limits=referenceLimitsFor(model,type);
    const score=Math.min(limits.total,Object.entries(counts).reduce((n,[kind,count])=>n+Math.min(count,limits[kind]||0),0));
    return score>best.score?{type,score}:best;
  },{type:model.inputs[0],score:-1}).type;
}

export function referenceCompatibility(model,inputType,refs=[]) {
  if(!refs.length)return '';
  const limits=referenceLimitsFor(model,inputType);
  for(const kind of ['image','video','audio']){
    const count=refs.filter(ref=>ref.kind===kind).length;
    if(count&&!limits[kind])return `This starting point does not accept ${kind} references.`;
    if(count>limits[kind])return `${model.name} accepts up to ${limits[kind]} ${kind} reference${limits[kind]===1?'':'s'} here; you have ${count}.`;
  }
  if(refs.length>limits.total)return `${model.name} accepts up to ${limits.total} reference files together; you have ${refs.length}.`;
  try{validateReferenceFiles(model,inputType,refs);validateReferenceMetadata(model,inputType,refs);}
  catch(error){return error.message;}
  return '';
}

export const mixedReferences=(model,inputType)=>(inputType==='video'&&Boolean(model.referenceLimits))||targetAudioAllowed(model,inputType);
export function referenceLabel(model,inputType,kind,index){
  if(kind==='audio'&&targetAudioAllowed(model,inputType))return 'Soundtrack';
  if(kind==='image'&&model.mode==='video'){
    if(inputType==='frames')return index===0?'First frame':'Last frame';
    if(inputType==='image')return 'First frame';
    if(inputType==='end')return 'Last frame';
    if(inputType==='keyframes')return `Keyframe ${index+1}`;
  }
  const name=kind[0].toUpperCase()+kind.slice(1);
  return model.referenceSyntax==='plain'?`${name} ${index+1}`:`@${name}${index+1}`;
}
export const referenceFileMB=(model,kind)=>kind==='video'?model.videoMB:kind==='audio'?model.audioMB:(model.imageMB||10);
export function validateReferenceFiles(model,inputType,refs) {
  const c=capabilities(model,inputType);
  if(!Array.isArray(refs)||refs.length>c.maxRefs)throw new Error('Too many reference files.');
  const counts={image:0,video:0,audio:0};
  for(const ref of refs){
    if(!ref||!Object.hasOwn(counts,ref.kind)||!c.limits[ref.kind])throw new Error('Reference type does not match the selected input.');
    counts[ref.kind]++;
    if(counts[ref.kind]>c.limits[ref.kind])throw new Error(`Too many reference files: use up to ${c.limits[ref.kind]} ${ref.kind} references.`);
    if(ref.bytes>referenceFileMB(model,ref.kind)*1024*1024)throw new Error('A reference exceeds this model’s file size limit.');
    if(model.family==='flux-video'&&ref.kind==='video'&&ref.bytes>=50*1024*1024)throw new Error('FLUX input videos must be under 50 MB.');
  }
}

const referencesHaveVisual=refs=>refs.some(r=>r.kind==='image'||r.kind==='video');
export function validateReferenceSelection(model,body,refs){
  const images=refs.filter(r=>r.kind==='image');
  if(model.id==='seedance20'&&refs.some(r=>r.kind==='audio')&&!referencesHaveVisual(refs))throw new Error('Seedance 2.0 audio references need at least one image or video.');
  if(body.inputType==='frames'&&images.length!==2)throw new Error('Add both the first and last frame.');
  if(['image','end','keyframes'].includes(body.inputType)&&!images.length)throw new Error('Add a reference image first.');
  if(['video','edit'].includes(body.inputType)&&!refs.length)throw new Error('Add a reference file first.');
  if(body.inputType==='keyframes'){
    const positions=body.frameIndices;
    if(!Array.isArray(positions)||positions.length!==images.length||positions.some(n=>!Number.isInteger(n)||n<0||n>Number(body.duration)*24)||new Set(positions).size!==positions.length)throw new Error(`Choose a unique frame position from 0 to ${Number(body.duration)*24} for each keyframe (24 fps).`);
  }
}

// Image tiers describe an approximate pixel area; the exact dimensions are shown in the UI.
export function imageDimensions(model,ratio,resolution) {
  if(!model.sizeLimits)return null;
  const [x,y]=ratio.split(':').map(Number),r=x/y;
  const {minArea,maxArea,maxEdge,step}=model.sizeLimits;
  const area=Math.min(resolution==='Max'?maxArea:({ '1K':1024,'2K':2048,'3K':3072,'4K':4096 }[resolution]||1024)**2,maxArea,maxEdge**2/Math.max(r,1/r));
  let width=Math.floor(Math.sqrt(area*r)/step)*step,height=Math.floor(Math.sqrt(area/r)/step)*step;
  while(width*height<minArea){if(width/height<r)width+=step;else height+=step;}
  return {width,height};
}

export function validateReferenceMetadata(model,inputType,refs) {
  for(const kind of ['image','video','audio']){
    const rules=kind==='video'?model.videoRules:kind==='audio'?(targetAudioAllowed(model,inputType)?model.targetAudioRules:model.audioRules):model.imageRules;
    validateKindMetadata(rules,kind,refs.filter(r=>r.kind===kind));
  }
}
function validateKindMetadata(rules,inputType,refs){
  if(!rules)return;
  let total=0,bytes=0;
  for(const ref of refs){
    bytes+=ref.bytes||0;
    const m=ref.metadata;
    if(!m)throw new Error('Add this reference again so its dimensions and duration can be checked.');
    if(inputType!=='audio'&&(!Number.isFinite(m.width)||!Number.isFinite(m.height)||m.width<=0||m.height<=0))throw new Error('Cannot read reference dimensions.');
    if(rules.minDimension && Math.min(m.width,m.height)<rules.minDimension)throw new Error(`Reference dimensions must be at least ${rules.minDimension} pixels per side.`);
    if(rules.maxDimension && Math.max(m.width,m.height)>rules.maxDimension)throw new Error(`Reference dimensions must be at most ${rules.maxDimension} pixels per side.`);
    if(rules.minArea && m.width*m.height<rules.minArea)throw new Error('Reference video resolution is too small for this model.');
    if(rules.maxArea && m.width*m.height>rules.maxArea)throw new Error(`Reference images must be at most ${rules.maxArea/1e6} megapixels.`);
    if(rules.minRatio && (m.width/m.height<rules.minRatio || m.width/m.height>rules.maxRatio))throw new Error(`Reference aspect ratio must be between ${rules.minRatio} and ${rules.maxRatio}.`);
    if(inputType==='video'||inputType==='audio'){
      if(!Number.isFinite(m.duration)||m.duration<=0)throw new Error(`Cannot read this ${inputType}’s duration.`);
      if(rules.minDuration&&m.duration<rules.minDuration)throw new Error(`Reference clips must be at least ${rules.minDuration} seconds.`);
      if(m.duration>rules.maxDuration || (rules.exclusiveMaxDuration&&m.duration>=rules.maxDuration))throw new Error(`Reference clips must be ${rules.exclusiveMaxDuration?'shorter than':'at most'} ${rules.maxDuration} seconds.`);
      if(rules.contentTypes&&!rules.contentTypes.includes(ref.contentType))throw new Error(inputType==='audio'?'This model accepts MP3 or WAV audio references only.':'This model accepts MP4 reference videos only.');
      total+=m.duration;
    }
  }
  if(rules.maxTotalBytes&&bytes>=rules.maxTotalBytes)throw new Error('Reference videos must be under 50 MB combined.');
  if(rules.maxTotalDuration&&total>rules.maxTotalDuration+0.001)throw new Error(`Reference ${inputType} files must total at most ${rules.maxTotalDuration} seconds.`);
}

export function validateRequest(body,references=[]) {
  const model=MODELS.find(m=>m.id===body.model);
  if(!model)throw new Error('Choose a supported model.');
  if(!model.available)throw new Error(model.unavailableReason);
  if(!model.inputs.includes(body.inputType))throw new Error('This model does not support that reference type.');
  const caps=capabilities(model,body.inputType);
  if(typeof body.prompt!=='string'||body.prompt.trim().length<model.minPrompt)throw new Error(`Write a prompt of at least ${model.minPrompt} character${model.minPrompt===1?'':'s'}.`);
  if(body.prompt.length>caps.maxPrompt)throw new Error(`${model.name} accepts up to ${caps.maxPrompt.toLocaleString('en-US')} prompt characters for this starting point.`);
  if(!caps.ratios.includes(body.ratio))throw new Error('Choose an aspect ratio supported by this model.');
  if(!caps.resolutions.includes(body.resolution))throw new Error('Choose a supported resolution.');
  if(!Number.isInteger(body.count)||body.count<1||body.count>(model.mode==='image'?4:2))throw new Error('Choose a valid output count.');
  if(model.mode==='video'&&!caps.durations.includes(body.duration))throw new Error('Choose a supported video duration.');
  if(body.quality!==undefined&&model.qualities&&!model.qualities.includes(body.quality))throw new Error('Choose a supported quality level.');
  if(body.creativity!==undefined&&model.creativityLevels&&!model.creativityLevels.includes(body.creativity))throw new Error('Choose a supported creativity level.');
  if(body.thinking!==undefined&&model.thinkingLevels&&!model.thinkingLevels.includes(body.thinking))throw new Error('Choose a supported thinking level.');
  validateReferenceFiles(model,body.inputType,references);
  validateReferenceSelection(model,body,references);
  validateReferenceMetadata(model,body.inputType,references);
  return {model,caps};
}

export function buildInput(body,references=[]) {
  const {model}=validateRequest(body,references);
  if(model.provider==='comfy')return {model,endpoint:model.endpoints[body.inputType],input:nativeInput(model,body,references,imageDimensions(model,body.ratio,body.resolution))};
  const urls=references.map(r=>r.data),input={prompt:body.prompt.trim()},endpoint=model.endpoints[body.inputType];
  if(body.inputType==='edit')return {endpoint,input:{...input,video_url:urls[0]},model};
  if(model.family==='nano'){
    Object.assign(input,{aspect_ratio:body.ratio,resolution:body.resolution,num_images:1,output_format:'png'});
    if(model.thinkingLevels)input.thinking_level=body.thinking||'medium';
    if(urls.length)input.image_urls=urls;
  }else if(model.family==='krea'){
    Object.assign(input,{aspect_ratio:body.ratio,creativity:body.creativity||'medium'});
    if(urls.length)input.image_style_references=urls.map(image_url=>({image_url,strength:1}));
  }else if(model.family==='gpt'||model.family==='seedream'){
    Object.assign(input,{image_size:imageDimensions(model,body.ratio,body.resolution),num_images:1});
    if(model.family==='gpt'){input.quality=body.quality||'high';input.output_format='png';}
    if(model.id==='seedream5-lite')input.max_images=1;
    if(model.id==='seedream5-pro')input.output_format='png';
    if(urls.length)input.image_urls=urls;
  }else if(model.family==='flux-image'){
    Object.assign(input,{aspect_ratio:body.ratio,resolution:body.resolution.toLowerCase(),output_format:'png'});
    if(urls.length)input.image_urls=urls;
  }else{
    Object.assign(input,{resolution:model.family==='minimax'?body.resolution.toUpperCase():body.resolution,
      duration:model.id==='wan3'&&body.duration==='Smart'?null:model.family==='seedance'?body.duration:Number(body.duration)});
    if(body.ratio!=='From image')input.aspect_ratio=body.ratio;
    if(model.audioField)input[model.audioField]=Boolean(body.audio);
    const images=references.filter(r=>r.kind==='image'),audios=references.filter(r=>r.kind==='audio');
    if(body.inputType==='image')input[model.family==='wan'?'start_image_url':'image_url']=images[0].data;
    if(body.inputType==='frames'){
      input[['wan','flux-video'].includes(model.family)?'start_image_url':'image_url']=images[0].data;
      input.end_image_url=images[1].data;
    }
    if(body.inputType==='end')input.end_image_url=images[0].data;
    if(body.inputType==='keyframes')input.keyframes=images.map((ref,i)=>({image_url:ref.data,frame_index:body.frameIndices[i]}));
    if(targetAudioAllowed(model,body.inputType)&&audios.length)input.target_audio_url=audios[0].data;
    if(body.inputType==='video'){
      if(mixedReferences(model,body.inputType)){
        for(const kind of ['image','video','audio']){
          const values=references.filter(r=>r.kind===kind).map(r=>r.data);
          if(values.length)input[`${model.referencePrefix||''}${kind}_urls`]=values;
        }
      }else if(model.family==='flux-video')input.video_url=urls[0];
      else input[model.family==='seedance'?'video_urls':'reference_video_urls']=urls;
    }
    if(model.family==='seedance')input.codec='H264';
  }
  return {endpoint,input,model};
}


export function formatUSD(value) {
  if(!Number.isFinite(value))return '—';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
}
// Published frame sizes, rather than a fixed short edge: square 720p is 960×960.
const SEEDANCE_SIZES={
  '480p':{'21:9':[992,432],'16:9':[864,496],'4:3':[752,560],'1:1':[640,640],'3:4':[560,752],'9:16':[496,864]},
  '720p':{'21:9':[1470,630],'16:9':[1280,720],'4:3':[1112,834],'1:1':[960,960],'3:4':[834,1112],'9:16':[720,1280]},
};
export function seedanceFrameSize(resolution,ratio,references=[]){
  let chosen=ratio,automatic=ratio==='From image';
  if(automatic){
    const m=references.find(r=>r.kind==='image')?.metadata;
    if(!Number.isFinite(m?.width)||!Number.isFinite(m?.height)||m.width<=0||m.height<=0)return null;
    const aspect=m.width/m.height;
    chosen=Object.keys(SEEDANCE_SIZES['720p']).sort((a,b)=>{
      const value=r=>{const [w,h]=r.split(':').map(Number);return Math.abs(Math.log(aspect/(w/h)));};return value(a)-value(b);
    })[0];
  }
  const size=(SEEDANCE_SIZES[resolution]||SEEDANCE_SIZES['720p'])[chosen];
  if(!size)return null;
  const scale=resolution==='1080p'?1.5:1;
  return {width:Math.round(size[0]*scale),height:Math.round(size[1]*scale),automatic,derived:resolution==='1080p',ratio:chosen};
}
export function formatCostEstimate(estimate){
  if(!estimate.available)return estimate.statusLabel||'Not available';
  const amount=estimate.minimum===estimate.maximum?formatUSD(estimate.minimum):`${formatUSD(estimate.minimum)}–${formatUSD(estimate.maximum)}`;
  return (estimate.approximate?'≈':'')+amount+(estimate.extraUsage?' + usage':'');
}
export {estimateReferenceCost as estimateCost} from './reference-pricing.js';

export function reusableSettings(job){
  const saved=job?.settings||{},model=MODELS.find(m=>m.id===saved.model&&m.available);
  if(!model)return {settings:null,warnings:['The original model is unavailable. Choose a current model.']};
  const warnings=[],choose=(value,values,label,fallback=values[0])=>{if(values.includes(value))return value;if(value!==undefined)warnings.push(`${label} changed to a supported value.`);return fallback;};
  const inputType=choose(saved.inputType,model.inputs,'Starting point'),c=capabilities(model,inputType),count=Number(saved.count),max=model.mode==='image'?4:2;
  if(String(saved.prompt||'').length>c.maxPrompt)warnings.push(`The original prompt is preserved. Shorten it to ${c.maxPrompt.toLocaleString('en-US')} characters before generating with this model.`);
  return {settings:{mode:model.mode,model:model.id,inputType,ratio:choose(saved.ratio,c.ratios,'Aspect ratio'),resolution:choose(saved.resolution,c.resolutions,'Resolution'),duration:choose(String(saved.duration??'5'),c.durations||['5'],'Duration'),count:Number.isInteger(count)&&count>=1&&count<=max?count:1,quality:choose(saved.quality,model.qualities||['high'],'Quality',(model.qualities||[]).includes('high')?'high':(model.qualities||['high'])[0]),audio:!!saved.audio,prompt:String(saved.prompt||''),frameIndices:Array.isArray(saved.frameIndices)?saved.frameIndices.slice():undefined,...(model.creativityLevels?{creativity:choose(saved.creativity,model.creativityLevels,'Creativity','medium')}:{}),...(model.thinkingLevels?{thinking:choose(saved.thinking,model.thinkingLevels,'Thinking','medium')}:{})},warnings};
}
