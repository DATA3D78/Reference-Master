import {installFileDrops,registerFileDrop} from './library.js';
import {CharacterCreator} from './creator.js';
import {referenceAudience} from './reference-model.js';
import {ReferenceWorkspace} from './reference.js';
let referenceWorkspace;
import {OutfitWorkspace} from './outfit.js';
import {isOutfitGeneration,outfitAudience} from './outfit-prompt.js';
import {estimateReferenceCost} from './reference-pricing.js';
import {pricePreview,priceText,priceLabel} from './comfy-pricing.js';
const INTERFACE_THEMES=[
  {id:'plum-lime',name:'Comfy Chrome',hue:282,chroma:.6},
  {id:'monochrome',name:'Monochrome',hue:0,chroma:0},
  {id:'light',name:'Light',hue:0,chroma:0,light:true},
  {id:'green',name:'Muted Green',hue:145,chroma:.52},
  {id:'orange',name:'Muted Orange',hue:28,chroma:.68},
  {id:'red',name:'Muted Red',hue:4,chroma:.57},
  {id:'pink',name:'Muted Pink',hue:335,chroma:.57},
  {id:'purple',name:'Muted Purple',hue:274,chroma:.57},
  {id:'blue',name:'Muted Blue',hue:213,chroma:1},
];
const validTheme=id=>INTERFACE_THEMES.find(theme=>theme.id===id)||INTERFACE_THEMES[0];
let savedTheme='plum-lime';try{savedTheme=localStorage.getItem('fwrd-theme')||savedTheme;}catch{}
document.documentElement.dataset.theme=validTheme(savedTheme).id;

// An older running server does not yet serve the new canvas assets. Keep Create
// and Favorites usable until that server restarts with the updated routes.
const {IdeationCanvas}=await import('./ideation.js?v=canvas-assets').catch(()=>({IdeationCanvas:class {
  constructor(){this.jobs=[];}
  configure(){}
  load(){const message=document.querySelector('#canvas-loading');message.hidden=false;message.textContent='Restart FWRD.STUDIO to activate Ideation. Your saved generations remain available in Create and Favorites.';document.querySelector('#canvas-section').append(message);document.querySelector('#canvas-section').style.padding='28px';document.querySelector('#canvas-viewport').hidden=true;document.querySelector('.canvas-heading').hidden=true;document.querySelector('.canvas-toolbar').hidden=true;return Promise.resolve(false);}
  render(){}
  renderActivity(){}
  refresh(){return Promise.resolve();}
  addMedia(){return this.load();}
}}));
import { MODELS, capabilities, imageDimensions, mixedReferences, targetAudioAllowed, referenceLabel, referenceFileMB, retainedReferenceInput, referenceCompatibility, validateReferenceFiles, validateReferenceMetadata, validateReferenceSelection, estimateCost, formatCostEstimate, formatUSD, reusableSettings } from './models.js';
const libraryDates=await import('./library.js?v=prompt-details').catch(()=>null);
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icons = {
 person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  flash:'M13 2 4 14h7l-1 8 10-12h-7l1-8Z',shirt:'m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z',
  curves:'M3 3v18h18M4 18C6 18 9 17 11 11S16 5 21 4',effects:'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  music:'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3ZM21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  tools:'m14 6 4-4a6 6 0 0 1-7 8L4 17a2 2 0 0 0 3 3l7-7a6 6 0 0 1 8-7l-4 4-4-4Z',layers:'m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  folder:'M3 7V5h7l2 3h9v12H3V7Z',row:'M3 5h5v14H3ZM10 5h5v14h-5ZM17 5h4v14h-4Z',
  canvas:'M3 3h8v8H3ZM15 5h6v12h-6ZM4 15h7v6H4Z',note:'M5 3h14v13l-5 5H5V3ZM14 21v-5h5M8 8h8M8 12h6',undo:'M4 10h10a6 6 0 1 1 0 12M4 10l5-5M4 10l5 5',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  spark:'M9 2 7 7 2 9l5 2 2 5 2-5 5-2-5-2-2-5ZM17 12l1.5 3.5L22 17l-3.5 1.5L17 22l-1.5-3.5L12 17l3.5-1.5L17 12Z',
  image:'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 16l5-5 4 4 3-3 6 6M15 8h.01',
  video:'M4 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM16 9l5-3v12l-5-3',
  star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  grip:'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
  grid:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  settings:'M4 7h16M4 17h16M8 4v6M16 14v6',
  'arrow-up-right':'M6 18 18 6M6 6h12v12',chevron:'m6 9 6 6 6-6',
  upload:'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  close:'m6 6 12 12M6 18 18 6',key:'M15 3a6 6 0 1 1-4 10L3 21v-5l6-6a6 6 0 0 1 6-7ZM16 7h.01',
  box:'m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10M7 4.8l10 5.5',
  mountain:'m2 20 7-13 5 9 3-6 5 10H2ZM7 11l2 2 2-2',
  orbit:'M17 7c5 4 7 8 5 10s-7 0-12-4S3 5 5 3s7 0 12 4ZM18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  repeat:'M3 7h13a4 4 0 0 1 4 4v2M3 7l4-4M3 7l4 4M21 17H8a4 4 0 0 1-4-4v-2M21 17l-4 4M21 17l-4-4',
};
function icon(name){ return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.spark}"/></svg>`; }
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
hydrateIcons();
$('#mixed-reference-fields').innerHTML=['image','video','audio'].map(kind=>`<div class="reference-group" id="${kind}-reference-group"><div class="label-row"><label id="${kind}-reference-label" for="${kind}-reference-input"></label><span id="${kind}-ref-count" class="muted"></span></div><button type="button" class="dropzone compact-dropzone reference-picker-drop" data-reference-picker="${kind}" aria-haspopup="dialog" aria-controls="reference-library" aria-label="Add ${kind} references: upload, Assets or Favorites"><strong>Drop ${kind==='audio'?'audio':kind+'s'} or <em>choose references</em></strong><span class="reference-source-methods">Upload · Assets · Outfit · Character · ID · Favorites</span><small id="${kind}-upload-hint"></small></button><input type="file" id="${kind}-reference-input" class="visually-hidden" accept="${kind==='image'?'image/png,image/jpeg,image/webp':kind==='video'?'video/mp4,video/quicktime,.mov':'audio/mpeg,audio/wav,.mp3,.wav'}" multiple><div id="${kind}-references" class="references"></div><p id="${kind}-reference-note" class="hint"></p></div>`).join('')+'<p id="mixed-ref-count" class="hint" aria-live="polite"></p>';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={ mode:'image',model:'nano-pro',inputType:'text',ratio:'1:1',references:[],jobs:[],csrf:'',keyConfigured:false,view:'studio',submitting:false,uploading:0,ready:false,toastTimer:0,historySignature:'',dragging:false,favoritePending:new Set(),libraryVersion:0 };
state.serverModels=null;state.features={};state.projectId='default';state.projects=[];state.deletedProjects=[];state.projectMutation=false;state.projectsVersion=0;state.projectDrafts=new Map();state.switching=false;state.activeProjectIds=[];state.deletionPending=new Set();
let creator=null,outfit=null,shoot=null,llm=null,promptEnhancer=null,assetLibrary=null,mediaTools=null,audioWorkspace=null,editing=null;let assetReturnView='studio';state.llmBusy=false;state.enhancing=false;
const currentModel=()=>MODELS.find(m=>m.id===state.model);
const caps=()=>capabilities(currentModel(),state.inputType);
const isMixed=()=>mixedReferences(currentModel(),state.inputType);
const oldVideoBackend=()=>state.mode==='video'&&state.serverModels&&(state.serverModels.find(m=>m.id===state.model)?.inputVersion||0)<2;
const modelRestartRequired=()=>state.serverModels&&!state.serverModels.some(m=>m.id===state.model);
const mixedRestartRequired=()=>oldVideoBackend()&&(state.inputType!=='text'||state.references.length>0);
const serverReferenceLimit=()=>{const model=state.serverModels?.find(m=>m.id===state.model);return model?capabilities(model,state.inputType).maxRefs:caps().maxRefs;};
const active=()=>state.activeProjectIds.length>0||state.jobs.some(j=>j.tasks.some(t=>['SUBMITTING','IN_QUEUE','IN_PROGRESS'].includes(t.status)));
const legacyGenerationBusy=()=>!state.features.concurrentGenerations&&active();
function error(message){$('#form-error').textContent=message;$('#form-error').hidden=!message;}
function toast(message,action){
  clearTimeout(state.toastTimer);const notices=[$('#toast'),...($('#preview-dialog').open?[$('#preview-notice')]:[])],buttons=[];let pending=false;
  for(const notice of notices){notice.textContent=message;notice.hidden=false;if(action){const button=document.createElement('button');button.type='button';button.className='toast-undo';button.textContent='Undo';buttons.push(button);button.addEventListener('click',async()=>{if(pending)return;pending=true;buttons.forEach(b=>b.disabled=true);try{await action();}finally{pending=false;buttons.forEach(b=>b.disabled=false);}});notice.append(button);}}
  state.toastTimer=setTimeout(()=>notices.forEach(notice=>notice.hidden=true),action?15000:4500);
}
$('#theme-choices').insertAdjacentHTML('beforeend',INTERFACE_THEMES.map(theme=>{
  const color=(s,l)=>`hsl(${theme.hue} ${s*theme.chroma}% ${theme.light?Math.max(0,Math.min(100,108-1.1*l)):l}%)`;
  return `<label class="theme-option"><input class="visually-hidden" type="radio" name="interface-theme" value="${theme.id}" aria-label="${theme.name}"><span class="theme-choice"><span class="theme-preview" aria-hidden="true" style="--swatch-bg:${theme.id==='plum-lime'?'#231b29':color(31,6)};--swatch-panel:${theme.id==='plum-lime'?'#242426':color(29,15)};--swatch-line:${color(26,27)};--swatch-accent:${theme.id==='plum-lime'?'#eaff4b':color(37,71)}"></span><span class="theme-label">${theme.name}</span><span class="theme-check" aria-hidden="true"></span></span></label>`;
}).join(''));
function applyInterfaceTheme(id,{persist=true}={}){
  const theme=validTheme(id);document.documentElement.dataset.theme=theme.id;let stored=true;
  if(persist)try{localStorage.setItem('fwrd-theme',theme.id);}catch{stored=false;}
  $$('#theme-choices input').forEach(input=>input.checked=input.value===theme.id);
  $('#theme-status').textContent=stored?`${theme.name} · Saved automatically.`:`${theme.name} · Applied for this tab.`;
  document.querySelector('meta[name="theme-color"]').content=getComputedStyle(document.body).backgroundColor;
  const brand=$('.brand svg'),iconLink=document.querySelector('link[rel="icon"]');
  if(brand&&iconLink){const favicon=brand.cloneNode(true);favicon.setAttribute('xmlns','http://www.w3.org/2000/svg');favicon.setAttribute('fill',getComputedStyle(brand).color);favicon.setAttribute('stroke','none');iconLink.href='data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(favicon));}
}
applyInterfaceTheme(document.documentElement.dataset.theme,{persist:false});
$('#theme-choices').addEventListener('change',event=>{if(event.target.matches('input[name="interface-theme"]'))applyInterfaceTheme(event.target.value);});
window.addEventListener('storage',event=>{if(event.key==='fwrd-theme'||event.key===null)applyInterfaceTheme(event.newValue,{persist:false});});
async function api(path,options={}){
  let r;try {r=await fetch(path,{...options,headers:{...(options.method && options.method!=='GET'?{'X-Studio-Token':state.csrf}:{}),...options.headers}});}catch{throw new Error('The local server is unavailable. Restart FWRD.STUDIO and reload this page.');}
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`Request failed (${r.status}).`);
  return data;
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function options(el,values,preferred,label=v=>v){el.replaceChildren(...values.map(value=>new Option(label(value),value)));el.value=values.includes(preferred)?preferred:values[0];}
function modelOptions(){
  const models=MODELS.filter(m=>m.mode===state.mode);
  closeModelMenu();
  $('#model-options').replaceChildren(...models.map(m=>{
    const option=document.createElement('div');
    option.id=`model-option-${m.id}`;option.dataset.model=m.id;option.setAttribute('role','option');
    option.setAttribute('aria-selected',String(m.id===state.model));option.setAttribute('aria-disabled',String(!m.available));
    const name=document.createElement('span');name.textContent=m.name;
    const detail=document.createElement('small');detail.textContent=m.available?m.description:'Not verified · endpoint pending';
    option.append(name,detail);return option;
  }));
  $('#model').value=state.model;
  const pending=models.filter(m=>!m.available);
  $('#model-availability').hidden=!pending.length;
  $('#model-availability').textContent=pending.map(m=>m.name+': Comfy Router integration unavailable.').join(' ');
}
let activeModelOption='',modelSearch='',modelSearchTime=0;
function closeModelMenu(){
  $('#model-options').hidden=true;$('#model').setAttribute('aria-expanded','false');$('#model').removeAttribute('aria-activedescendant');
  modelSearch='';
}
function highlightModel(id){
  activeModelOption=id;
  $$('#model-options [role=option]').forEach(o=>o.classList.toggle('highlighted',o.dataset.model===id));
  const option=$(`#model-option-${id}`);
  if(option){$('#model').setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest'});}
}
function openModelMenu(){
  if($('#model').disabled||$('#controls').disabled)return;
  $('#model-options').hidden=false;$('#model').setAttribute('aria-expanded','true');highlightModel(state.model);
}
function chooseModel(id){
  if(!MODELS.some(m=>m.id===id&&m.mode===state.mode&&m.available))return;
  state.model=id;state.inputType=retainedReferenceInput(currentModel(),state.inputType,state.references);
  error('');syncControls();$('#model').focus();
}
function updateModelNote(){
  const model=currentModel(),size=imageDimensions(model,state.ratio,$('#resolution').value);
  $('#model-note').textContent=state.inputType==='edit'?'FLUX FAST editing · 720p output. Motion, timing and framing follow the input video.':size?`${size.width} × ${size.height} px · Resolution tiers use approximate pixel area to stay within this model’s limits.`:model.note||(['image','frames','end'].includes(state.inputType)&&model.imageRatio?'Aspect ratio follows your reference image.':'');
  if(modelRestartRequired())$('#model-note').textContent+=' Open Apply Studio Update.command once, then refresh, to activate this model.';
  updateCost();
}
const generationPricing=pricePreview((url,body)=>post(url,body),estimate=>{
  $('#cost-label').textContent=priceLabel(estimate);$('#cost-amount').textContent=priceText(estimate);
  $('#cost-estimate').classList.toggle('cost-unavailable',!estimate.available);
  const detail=estimate.source==='reference'?estimate.reason:estimate.available?'Published Comfy Router estimate for these settings. Final billing may differ.':estimate.reason||'Add a prompt and references to estimate this request.';
  $('#cost-estimate').title=detail;$('#cost-estimate').setAttribute('aria-description',detail);
});
function updateCost(){
  generationPricing.update({...composerSettings(),kind:'generation',referenceIds:state.references.map(r=>r.id)},
    {fallback:estimateReferenceCost(composerSettings(),state.references,new Date(),{preview:true}),enabled:!!state.csrf&&state.keyConfigured&&!!$('#prompt').value.trim(),reason:state.keyConfigured?'Add a prompt to estimate this request.':'Connect Comfy Router to see an estimate.'});
}
function updateConnection(){
  $('#settings-nav').title='Appearance, API keys and prompt settings';updateCost();
  $('#disconnect').hidden=!state.keyConfigured;
}

async function clearReferences(){
  const refs=state.references;state.references=[];state.reusedFrameIndices=[];renderReferences();
  await Promise.allSettled(refs.map(async ref=>{URL.revokeObjectURL(ref.preview);await api(`/api/uploads/${ref.id}`,{method:'DELETE'});}));
}
function syncControls(){
  const model=currentModel(),c=caps();
  modelOptions();
  $('#model-mark').textContent=model.mark;
  $('#model-name').textContent=model.name;
  $('#model-description').textContent=model.description;
  options($('#input-type'),model.inputs,state.inputType,type=>({text:'Start with a prompt',image:model.imageAction||(state.mode==='video'?'Animate an image':'Use reference images'),frames:'First & last frames',end:'End on an image',keyframes:'Timed image keyframes',edit:'Edit a video (FLUX FAST)',video:model.videoAction||'Use reference video'}[type]));
  const adaptiveRatio=model.id==='wan3'&&state.inputType==='video';
  if(adaptiveRatio&&$('#ratios').dataset.adaptive!=='true')state.ratio='adaptive';
  $('#ratios').dataset.adaptive=String(adaptiveRatio);
  if(!c.ratios.includes(state.ratio))state.ratio=c.ratios[0];
  renderRatios();
  options($('#resolution'),c.resolutions,$('#resolution').value,v=>v==='Max'?'Max · up to 8 MP':v==='Native'?'Native · model default':v);$('#resolution').disabled=model.resolutions[0]==='Native';
  for(const key of ['creativity','thinking']){const levels=model[key+'Levels'];$('#'+key+'-field').hidden=!levels;options($('#'+key),levels||['medium'],$('#'+key).value||'medium');}
  $('#quality-field').hidden=!model.qualities;
  options($('#quality'),model.qualities||['high'],$('#quality').value||'high');
  options($('#count'),state.mode==='image'?['1','2','3','4']:['1','2'],$('#count').value,n=>`${n} ${state.mode}${n==='1'?'':'s'}`);
  $('#count-label').textContent=state.mode==='image'?'Number of images':'Number of videos';
  $('#duration-field').hidden=state.mode!=='video'||state.inputType==='edit';
  $('#ratio-field').hidden=state.inputType==='edit';
  const smartDuration=model.id==='wan3'&&state.inputType==='video';
  const durationControl=$('#duration');
  options(durationControl,c.durations||['5'],smartDuration&&durationControl.dataset.smart!=='true'?'Smart':durationControl.value||'5',v=>v==='Smart'?'Smart · from prompt & references':`${v} seconds`);
  durationControl.dataset.smart=String(smartDuration);
  $('#audio-field').hidden=!model.audioField||state.inputType==='edit';
  $('#reference-field').hidden=c.maxRefs===0&&!state.references.length;
  $('#single-reference').hidden=isMixed();
  $('#mixed-reference-fields').hidden=!isMixed();
  const videoInput=['video','edit'].includes(state.inputType);
  const imageLabel=state.inputType==='frames'?'First & last frames':state.inputType==='keyframes'?'Image keyframes':state.inputType==='end'?'Last frame':state.inputType==='image'&&state.mode==='video'?'First frame':'Reference images';
  $('#reference-label').textContent=videoInput?'Reference video':model.referenceImageLabel||imageLabel;
  $('#file-input').accept=videoInput?(model.videoRules?.contentTypes?model.videoRules.contentTypes.join(','):'video/mp4,video/quicktime,.mov'):'image/png,image/jpeg,image/webp';
  $('#file-input').multiple=c.maxRefs>1;
  $('#upload-hint').textContent=videoInput?`${model.videoRules?.contentTypes?'MP4':'MP4 or MOV'} · ${model.family==='flux-video'?'under':'up to'} ${model.videoMB} MB each`:`PNG, JPG or WebP · up to ${model.imageMB||10} MB each`;
  $('#reference-note').textContent=state.inputType==='video'?model.videoNote||'Use a video to guide the result.':state.mode==='video'?(model.imageRatio?'The image sets the first frame and aspect ratio. Describe the motion you want.':'The image sets the first frame. Describe the motion and choose an output ratio.'):(model.imageNote||`Add up to ${c.maxRefs} images to guide the result.`);
  if(state.mode==='image'&&state.inputType==='image'&&serverReferenceLimit()<c.maxRefs)$('#reference-note').textContent+=` Restart FWRD.STUDIO once to activate the ${c.maxRefs}-image limit; the running server currently accepts ${serverReferenceLimit()}.`;
  if(videoInput)$('#reference-note').textContent=state.inputType==='edit'?'One MP4 under 50 MB and shorter than 15 seconds. Describe the visual changes; motion and timing follow the original.':model.videoNote;
  if(state.inputType==='frames')$('#reference-note').textContent='Add two images in order: first frame, then last frame. Use the arrows to swap their order.';
  if(state.inputType==='end')$('#reference-note').textContent='The video finishes on this image. Describe what happens before it.';
  if(state.inputType==='keyframes')$('#reference-note').textContent='Add up to 10 images and set when each appears. Times snap to 24 fps; each time must be unique and within the output duration.';
  for(const kind of ['image','video','audio']){
    $(`#${kind}-reference-group`).hidden=!c.limits[kind];
    $(`#${kind}-reference-input`).multiple=c.limits[kind]>1;
    $(`#${kind}-reference-label`).textContent=kind==='image'?imageLabel:kind==='audio'&&targetAudioAllowed(model,state.inputType)?'Target soundtrack (optional)':`Reference ${kind==='audio'?'audio':kind+'s'}`;
    $(`#${kind}-upload-hint`).textContent=`${kind==='image'?'PNG, JPG or WebP':kind==='video'?'MP4 or MOV':'MP3 or WAV'} · up to ${referenceFileMB(model,kind)} MB each`;
    const hint=kind==='video'?model.videoNote:kind==='audio'?(targetAudioAllowed(model,state.inputType)?'At least 2 seconds. Replaces the final soundtrack; trimmed or padded to the video length.':model.audioNote):'';
    $(`#${kind}-reference-note`).textContent=hint||'';
    $(`#${kind}-reference-note`).hidden=!hint;
  }
  if(isMixed()&&state.inputType==='video')$('#reference-note').textContent=`Combine images, video and audio. Mention ${referenceLabel(model,state.inputType,'image',0)}, ${referenceLabel(model,state.inputType,'video',0)} or ${referenceLabel(model,state.inputType,'audio',0)} in your prompt. Up to ${c.maxRefs} files and 512 MB total.`;
  if(targetAudioAllowed(model,state.inputType)&&state.inputType==='text')$('#reference-note').textContent='Optionally add an audio track to use as the generated video’s soundtrack.';
  if(mixedRestartRequired())$('#reference-note').textContent+=' Restart FWRD.STUDIO to activate the updated video inputs.';
  updateModelNote();
  $('#prompt').maxLength=c.maxPrompt;
  $('#prompt').minLength=model.minPrompt;
  updatePromptCount();renderReferences();updateButton();
}
function renderRatios(){
  const ratios=caps().ratios;
  $('#ratios').innerHTML=ratios.map(r=>{
    const [w,h]=r.includes(':')?r.split(':').map(Number):[1,1];
    return `<button type="button" class="ratio ${r===state.ratio?'selected':''} ${r==='From image'||r==='auto'?'source':''}" data-ratio="${esc(r)}" aria-pressed="${r===state.ratio}" aria-label="${esc(r==='auto'?'Automatic aspect ratio':r==='From image'?'Aspect ratio from image':r+' aspect ratio')}"><span class="ratio-shape"><i style="width:${22*w/Math.max(w,h)}px;height:${22*h/Math.max(w,h)}px"></i></span><span>${esc(r==='adaptive'?'Adapt':r==='auto'?'Auto':r)}</span></button>`;
  }).join('');
  $('#ratio-description').textContent=(state.ratio.startsWith('From ')||state.ratio==='auto'||state.ratio==='adaptive')?'Automatic':state.ratio==='1:1'?'Square':Number(state.ratio.split(':')[0])>Number(state.ratio.split(':')[1])?'Landscape':'Portrait';
}
function renderReferences(){
  const images=state.references.filter(r=>r.kind==='image');
  if(state.inputType==='keyframes')images.forEach((r,i)=>{if(!r.manualFrame&&Number.isInteger(state.reusedFrameIndices?.[i])){r.frameIndex=state.reusedFrameIndices[i];r.manualFrame=true;}if(!r.manualFrame)r.frameIndex=images.length===1?0:Math.round(i*Number($('#duration').value)*24/(images.length-1));});
  const card=r=>{
    const i=state.references.filter(ref=>ref.kind===r.kind).indexOf(r);
    const label=referenceLabel(currentModel(),state.inputType,r.kind,i);
    const media=r.kind==='image'?`<img src="${esc(r.preview)}" alt="${esc(r.name)}">`:r.kind==='audio'?`<span class="reference-name">${esc(r.name)}</span><audio controls preload="metadata" src="${esc(r.preview)}" aria-label="Preview ${esc(r.name)}"></audio>`:`<video src="${esc(r.preview)}" muted preload="metadata"></video>`;
    const keyframe=state.inputType==='keyframes'&&r.kind==='image';
    return `<div class="reference ${r.kind==='audio'?'audio-reference':''} ${keyframe?'keyframe-reference':''}" title="${esc(r.name)}">${media}${isMixed()||state.mode==='video'?`<small>${label}</small>`:''}<button type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.name)}">×</button>${keyframe?`<label>Time (seconds)<input type="number" data-frame="${r.id}" min="0" max="${Number($('#duration').value)}" step="any" value="${Number((r.frameIndex/24).toFixed(3))}" aria-label="Time for ${label}"></label>`:''}${r.kind==='image'&&state.inputType==='frames'&&i>0?`<button type="button" class="reference-reorder" data-move="${r.id}" aria-label="Move ${esc(r.name)} to first frame">←</button>`:''}</div>`;
  };
  $('#references').innerHTML=isMixed()?'':state.references.map(card).join('');
  $('#ref-count').textContent=`${state.references.length} / ${caps().maxRefs}`;
  for(const kind of ['image','video','audio']){
    const refs=state.references.filter(r=>r.kind===kind);
    const limit=caps().limits[kind]||0,group=$(`#${kind}-reference-group`);
    group.hidden=!limit&&!refs.length;
    group.querySelector('.dropzone').hidden=!limit;
    $(`#${kind}-reference-input`).disabled=!limit;
    $(`#${kind}-references`).innerHTML=isMixed()?refs.map(card).join(''):'';
    $(`#${kind}-ref-count`).textContent=`${refs.length} / ${limit}`;
  }
  $('#mixed-ref-count').textContent=`${state.references.length} / ${caps().maxRefs} total files`;
  $('#reference-field').hidden=!caps().maxRefs&&!state.references.length;
  $('#dropzone').hidden=!caps().maxRefs;$('#file-input').disabled=!caps().maxRefs;
  const problem=referenceCompatibility(currentModel(),state.inputType,state.references);
  $('#reference-compatibility').hidden=!problem;
  $('#reference-compatibility').textContent=problem?`${problem} Your files are still here. Choose a compatible model or starting point, or remove the files you do not need before generating.`:'';
  updateCost();
}
function updatePromptCount(){const field=$('#prompt'),over=field.value.length>field.maxLength;$('#prompt-count').textContent=`${field.value.length.toLocaleString('en-US')} / ${field.maxLength.toLocaleString('en-US')}`;field.setCustomValidity(over?`${currentModel().name} accepts up to ${field.maxLength.toLocaleString('en-US')} characters. Your prompt is preserved; shorten it or choose another model.`:'');field.setAttribute('aria-invalid',String(over));}
function updateButton(){
  const busy=state.enhancing||state.submitting||state.uploading>0||state.switching||!state.ready;
  $('#project-select').disabled=storageBusy||state.enhancing||state.llmBusy||state.switching||state.submitting||state.uploading>0||!state.features.projects;$('#project-new').disabled=$('#project-quick-new').disabled=storageBusy||state.enhancing||!state.features.projects||state.switching;
  $('#generate').disabled=busy||legacyGenerationBusy()||!currentModel().available||modelRestartRequired()||mixedRestartRequired()||(state.view==='ideation'&&!state.features.ideation)||state.references.length>serverReferenceLimit()||!!referenceCompatibility(currentModel(),state.inputType,state.references);
  $('#controls').disabled=state.enhancing||state.submitting||state.uploading>0||state.switching;
  $$('[data-mode]').forEach(b=>b.disabled=state.enhancing||state.llmBusy||state.submitting||state.uploading>0||state.switching);
  const n=Number($('#count').value);
  $('#generate-label').textContent=!state.ready?'Starting studio…':state.uploading?'Preparing references…':state.submitting?'Starting generation…':legacyGenerationBusy()?'Generation in progress…':`Generate ${n>1?n+' ':''}${state.mode}${n>1?'s':''}`;
  const running=state.jobs.filter(j=>j.tasks.some(t=>['SUBMITTING','IN_QUEUE','IN_PROGRESS'].includes(t.status))).length;
  $('#workspace-status').textContent=running?`${running} generation${running===1?'':'s'} in progress`:active()?'Generating in another project':'Ready when you are';
  promptEnhancer?.sync();updateCost();
}
function changeMode(mode){
  if(state.enhancing)return;
  if(mode==='creator'){setView('creator');return;}
  if(mode==='reference'){setView('reference');return;}
  if(mode==='outfit'){if(!outfit)return;changeMode('image');setView('outfit');return;}
  if(mode==='shoot'){if(!shoot){toast('Open Apply Studio Update.command once, then refresh to activate SHOOT.');return;}setView('shoot');return;}
  if(mode==='llm'){if(!llm){toast('Open Apply Studio Update.command once, then refresh to activate LLM.');return;}setView('llm');return;}
  if(['llm','shoot','outfit','reference','product','environment','creator'].includes(state.view))setView('studio');
  if(state.mode===mode)return;
  state.mode=mode;state.model=mode==='image'?'nano-pro':'wan3';state.inputType=retainedReferenceInput(currentModel(),state.inputType,state.references);state.ratio=mode==='image'?'1:1':'16:9';
  modelOptions();
  $$('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  error('');syncControls();renderJobs();
}
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>changeMode(b.dataset.mode)));
$('#model').addEventListener('click',()=>$('#model-options').hidden?openModelMenu():closeModelMenu());
$('#model-options').addEventListener('pointerdown',e=>e.preventDefault());
$('#model-options').addEventListener('click',e=>{const option=e.target.closest('[data-model]');if(option)chooseModel(option.dataset.model);});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.model-picker'))closeModelMenu();});
$('#model').addEventListener('blur',closeModelMenu);
$('#model').addEventListener('keydown',e=>{
  const models=MODELS.filter(m=>m.mode===state.mode&&m.available),open=!$('#model-options').hidden;
  if(e.key==='Escape'){if(open){e.preventDefault();e.stopPropagation();closeModelMenu();}return;}
  if(e.key==='Tab'){closeModelMenu();return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();
    if(!open)openModelMenu();
    const current=models.findIndex(m=>m.id===activeModelOption);
    const next=e.key==='Home'?0:e.key==='End'?models.length-1:!open?current:(current+(e.key==='ArrowDown'?1:-1)+models.length)%models.length;
    highlightModel(models[next].id);return;
  }
  if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)chooseModel(activeModelOption);else openModelMenu();return;}
  if(e.key.length===1&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
    e.preventDefault();if(!open)openModelMenu();
    modelSearch=Date.now()-modelSearchTime<700?modelSearch+e.key.toLowerCase():e.key.toLowerCase();modelSearchTime=Date.now();
    const match=models.find(m=>m.name.toLowerCase().startsWith(modelSearch));if(match)highlightModel(match.id);
  }
});
$('#input-type').addEventListener('change',()=>{state.inputType=$('#input-type').value;error('');syncControls();});
$('#ratios').addEventListener('click',e=>{const b=e.target.closest('[data-ratio]');if(b){state.ratio=b.dataset.ratio;renderRatios();updateModelNote();}});
$('#count').addEventListener('change',updateButton);
$('#resolution').addEventListener('change',updateModelNote);
for(const id of ['quality','audio','creativity','thinking'])$('#'+id).addEventListener('change',updateCost);
$('#duration').addEventListener('change',()=>{if(state.inputType==='keyframes')renderReferences();else updateCost();});
$('#reference-field').addEventListener('change',e=>{
  if(!e.target.matches('[data-frame]'))return;
  const ref=state.references.find(r=>r.id===e.target.dataset.frame);
  if(ref){ref.frameIndex=e.target.value===''?NaN:Math.round(Number(e.target.value)*24);ref.manualFrame=true;updateCost();}
});
$('#prompt').addEventListener('input',()=>{updatePromptCount();error('');});
$('#reference-field').addEventListener('click',async e=>{
  const move=e.target.closest('[data-move]');
  if(move){const index=state.references.findIndex(r=>r.id===move.dataset.move),first=state.references.findIndex(r=>r.kind==='image');[state.references[first],state.references[index]]=[state.references[index],state.references[first]];renderReferences();return;}
  const b=e.target.closest('[data-remove]');if(!b)return;
  const ref=state.references.find(r=>r.id===b.dataset.remove);state.references=state.references.filter(r=>r!==ref);URL.revokeObjectURL(ref.preview);renderReferences();updateButton();
  try{await api(`/api/uploads/${ref.id}`,{method:'DELETE'});}catch(e){toast(e.message);}
});
async function metadata(file,kind,preview){
  if(kind==='image'){const img=new Image();img.src=preview;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};}
  return new Promise((resolve,reject)=>{const media=document.createElement(kind);const message=kind==='audio'?'Could not read this audio. Try an MP3 or WAV file.':'Could not read this video. Try an MP4 with H.264 video.';const timer=setTimeout(()=>{cleanup();reject(new Error(message));},15000);const cleanup=()=>{clearTimeout(timer);media.onloadedmetadata=null;media.onerror=null;media.removeAttribute('src');media.load();};media.onloadedmetadata=()=>{const data=kind==='audio'?{duration:media.duration}:{duration:media.duration,width:media.videoWidth,height:media.videoHeight};cleanup();resolve(data);};media.onerror=()=>{cleanup();reject(new Error(message));};media.preload='metadata';media.src=preview;});
}
function fileInfo(file){
  const fallback={mov:'video/quicktime',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',opus:'audio/ogg',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
  let contentType=file.type||fallback[file.name.split('.').pop().toLowerCase()]||'';
  if(['audio/x-wav','audio/wave','audio/vnd.wave'].includes(contentType))contentType='audio/wav';
  if(contentType==='audio/mp3')contentType='audio/mpeg';
  if(['audio/opus','application/ogg'].includes(contentType))contentType='audio/ogg';
  const kind=contentType.split('/')[0];
  return {kind,contentType,bytes:file.size};
}
async function addFiles(fileList,{locked=false}={}){
  if(!locked&&(state.uploading||state.submitting))return false;
  if(!fileList.length)return false;
  error('');if(!locked){state.uploading++;updateButton();}
  try{
    if(oldVideoBackend())throw new Error('Restart FWRD.STUDIO to activate the updated video inputs.');
    validateReferenceFiles(currentModel(),state.inputType,[...state.references,...fileList.map(fileInfo)]);
    for(const file of fileList){
      const {kind,contentType}=fileInfo(file);
      if(!['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav'].includes(contentType))throw new Error('Use PNG, JPG, WebP, MP4, MOV, MP3 or WAV files.');
      if(file.size>referenceFileMB(currentModel(),kind)*1024*1024)throw new Error(`${file.name} exceeds the file size limit.`);
      const preview=URL.createObjectURL(file);
      try{
        const info=await metadata(file,kind,preview);
        validateReferenceMetadata(currentModel(),state.inputType,[...state.references,{kind,metadata:info,contentType}]);
        const uploaded=await api('/api/uploads',{method:'POST',headers:{'Content-Type':contentType,'X-Media-Metadata':JSON.stringify(info),'X-File-Name':encodeURIComponent(file.name),'X-Project-Id':state.projectId},body:file});
        state.references.push({...uploaded,name:file.name,preview,metadata:info,contentType,bytes:file.size});renderReferences();
      }catch(e){URL.revokeObjectURL(preview);throw e;}
    }
    return true;
  }catch(e){error(e.message);return false;}finally{if(!locked)state.uploading--;$$('#reference-field input[type=file]').forEach(input=>input.value='');updateButton();}
}
const MEDIA_DRAG_TYPE='application/x-fwrd-media';
function findResult(jobId,mediaId){
  const job=state.jobs.find(j=>j.id===jobId),media=job?.tasks.flatMap(t=>t.outputs||[]).find(m=>m.id===mediaId);
  if(!media)throw new Error('This result is no longer available. Refresh your history and try again.');
  return {job,media};
}
function mediaURL(job,media,download=false){return `/api/${download?'download':'media'}?job=${encodeURIComponent(job.id)}&media=${encodeURIComponent(media.id)}`;}
async function prepareReference(kind,count=1){
  const model=currentModel(),limit=caps().limits[kind]||0,existing=state.references.filter(r=>r.kind===kind).length;
  if(limit&&existing+count<=limit)return;
  if(model.referenceLimits){
    if(state.inputType!=='video'){state.inputType='video';syncControls();}
    return;
  }
  if(kind==='image'&&model.inputs.includes('keyframes')&&existing+count>1){state.inputType=existing+count===2?'frames':'keyframes';syncControls();return;}
  if(!currentModel().inputs.includes(kind))throw new Error(`Choose a ${kind==='video'?'video model that supports video references':'model with image inputs'} first.`);
  if(state.inputType!==kind){state.inputType=kind;syncControls();}
}
async function dropFiles(files){
  if(state.uploading||state.submitting||!files.length)return;
  const kinds=files.map(f=>fileInfo(f).kind);
  if(new Set(kinds).size!==1&&!currentModel().referenceLimits){error('This model accepts one reference type at a time.');return;}
  // Lock the composer before preparing the input so overlapping drops cannot race.
  state.uploading++;updateButton();
  try{
    const counts=Object.fromEntries(['image','video','audio'].map(kind=>[kind,kinds.filter(k=>k===kind).length+state.references.filter(r=>r.kind===kind).length]));
    if(new Set(kinds).size>1){
      if(Object.entries(counts).some(([kind,count])=>count>(caps().limits[kind]||0))){state.inputType='video';syncControls();}
    }else await prepareReference(kinds[0],files.length);
    await addFiles(files,{locked:true});
  }
  catch(e){error(e.message);}finally{state.uploading--;updateButton();}
}
async function useReference(jobId,mediaId){
  if(state.uploading||state.submitting){toast('Wait for reference preparation to finish.');return;}
  const found=findResult(jobId,mediaId);if(found.media.contentType.startsWith('audio/')){if(!audioWorkspace){toast('Open Apply Studio Update.command, then refresh to activate Audio.');return;}setView('audio');await audioWorkspace.useResult(jobId,mediaId);return;}
  if(['tools','audio','favorites'].includes(state.view)){setView('studio');revealComposer();}
  state.uploading++;updateButton();error('');
  try{
    const {job,media}=findResult(jobId,mediaId),kind=media.contentType.startsWith('video/')?'video':'image';
    await prepareReference(kind);
    if(state.references.length>=caps().maxRefs)throw new Error('Remove a reference first to make room for this result.');
    const response=await fetch(mediaURL(job,media)+'&reference=1&model='+encodeURIComponent(state.model));
    if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'This result could not be loaded as a reference.');}
    const blob=await response.blob(),extension=kind==='video'?'mp4':media.contentType==='image/jpeg'?'jpg':media.contentType==='image/webp'?'webp':'png';
    const added=await addFiles([new File([blob],`${job.modelName}-${media.id.slice(0,8)}.${extension}`,{type:media.contentType})],{locked:true});
    if(added){toast('Added as a reference. Your prompt is unchanged.');if(innerWidth<800)$('#reference-field').scrollIntoView({behavior:'smooth',block:'center'});}
  }catch(e){error(e.message);toast(e.message);}finally{state.uploading--;updateButton();}
}
async function saveAsset(jobId,mediaId,source){
  if(!state.features.assetLibrary){toast('Open Apply Studio Update.command, then refresh to activate the Asset Library.');return;}
  try{const {job,media}=source||findResult(jobId,mediaId);if(media.contentType.startsWith('video/')&&!state.features.videoAssets)throw Error('Open Apply Studio Update.command, then refresh to activate video assets.');const result=await post('/api/assets',{jobId,mediaId,name:media.name||generationTitle(job),...(state.view==='outfit'?{category:'outfit'}:{})});media.savedToAssets=true;media.assetId=result.asset.id;for(const entry of state.jobs.filter(j=>j.id===jobId))for(const task of entry.tasks)for(const output of task.outputs||[])if(output.id===mediaId){output.savedToAssets=true;output.assetId=result.asset.id;}state.libraryVersion++;state.historySignature='';renderJobs();toast(job.settings.workflow==='creator'?'Saved to Character assets.':job.settings.workflow==='reference'?`Saved to ${job.settings.referenceType==='product'?'Product':job.settings.referenceType==='environment'?'Environment':'ID'} assets.`:state.view==='outfit'?'Saved to Outfit assets.':result.existing?'Already in Asset Library.':'Added to Asset Library.');return result;}catch(e){toast(e.message);}
}
function openAssets(){if(state.view!=='assets')assetReturnView=['studio','ideation','llm','tools'].includes(state.view)?state.view:'studio';setView('assets');}
const referenceLibrary={version:0,collection:'assets',sources:[],selection:new Set(),errors:{}};
const referenceContext=()=>JSON.stringify([state.projectId,state.mode,state.model,state.inputType,state.references.map(r=>r.id)]);
const referenceBusy=()=>state.enhancing||state.uploading||state.submitting||state.switching||!state.ready;
function referenceLibraryKind(){return isMixed()?['image','video','audio'].find(kind=>caps().limits[kind]):['video','edit'].includes(state.inputType)?'video':'image';}
function referenceLibraryRemaining(){return libraryDates.referencePickerCapacity(caps().limits,state.references,referenceLibrary.kind,serverReferenceLimit());}
function createReferenceLibrary(){
  const dialog=document.createElement('dialog');dialog.id='reference-library';dialog.setAttribute('aria-labelledby','reference-library-title');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="reference-library-title">Add image references</h2><button type="button" class="icon-button" id="reference-library-close" aria-label="Close reference picker">${icon('close')}</button></div><button type="button" class="secondary reference-library-upload" id="reference-library-upload">${icon('upload')} Upload from computer</button><p class="hint" id="reference-library-hint"></p><div class="reference-library-tabs" role="group" aria-label="Reference collection"><button type="button" data-reference-collection="assets" aria-pressed="true">Assets</button><button type="button" data-reference-collection="outfit" aria-pressed="false">Outfit</button><button type="button" data-reference-collection="character" aria-pressed="false">Character</button><button type="button" data-reference-collection="id" aria-pressed="false">ID</button><button type="button" data-reference-collection="favorites" aria-pressed="false">Favorites</button></div><input type="search" id="reference-library-search" aria-label="Search references" placeholder="Search Asset Library"><div id="reference-library-grid"></div><p id="reference-library-status" class="hint" role="status"></p><div class="reference-library-footer"><span id="reference-library-count" aria-live="polite">0 selected</span><button type="button" class="primary" id="reference-library-add" disabled>Add references</button></div>`;
  document.body.append(dialog);
  $('#reference-library-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>referenceLibrary.version++);
  $('#reference-library-upload').addEventListener('click',()=>{if(referenceBusy()||referenceContext()!==referenceLibrary.context||!referenceLibraryRemaining())return;const input=$(referenceLibrary.input);dialog.close();input.click();});
  $('#reference-library-search').addEventListener('input',renderReferenceLibrary);
  dialog.querySelectorAll('[data-reference-collection]').forEach(button=>button.addEventListener('click',()=>{referenceLibrary.collection=button.dataset.referenceCollection;renderReferenceLibrary();}));
  $('#reference-library-grid').addEventListener('change',event=>{
    const input=event.target.closest('[data-reference-source]');if(!input)return;
    const source=referenceLibrary.sources[Number(input.dataset.referenceSource)];if(!source||source.disabled)return;
    if(input.checked){if(referenceLibrary.selection.size>=referenceLibraryRemaining()){input.checked=false;return;}referenceLibrary.selection.add(source.key);}else referenceLibrary.selection.delete(source.key);
    renderReferenceLibrary();$(`#reference-library-grid input[data-reference-source="${input.dataset.referenceSource}"]`).focus({preventScroll:true});
  });
  $('#reference-library-add').addEventListener('click',()=>{
    if(referenceBusy()||referenceContext()!==referenceLibrary.context)return;
    const sources=[...referenceLibrary.selection].map(key=>referenceLibrary.sources.find(source=>source.key===key));
    if(!sources.length||sources.some(source=>!source||source.disabled)||sources.length>referenceLibraryRemaining())return;
    dialog.close();void importReferenceLibrary(sources,referenceLibrary.context);
  });
}
async function openReferenceLibrary(kind=referenceLibraryKind()){
  if(referenceBusy())return;
  if(!libraryDates?.referenceLibrarySources){toast('Refresh the studio to load the reference picker.');return;}
  if(!$('#reference-library'))createReferenceLibrary();
  const projectId=state.projectId,version=++referenceLibrary.version;
  Object.assign(referenceLibrary,{kind,context:referenceContext(),input:isMixed()?`#${kind}-reference-input`:'#file-input',maxMB:referenceFileMB(currentModel(),kind),sources:[],selection:new Set(),errors:{},loading:true});
  $('#reference-library-title').textContent=`Add ${kind} references`;$('#reference-library-search').value='';
  renderReferenceLibrary();$('#reference-library').showModal();
  const [assets,jobs]=await Promise.allSettled([api('/api/assets'),api('/api/jobs?project='+encodeURIComponent(projectId))]);
  if(version!==referenceLibrary.version||referenceContext()!==referenceLibrary.context)return;
  if(assets.status==='rejected')referenceLibrary.errors.assets=assets.reason.message;
  if(jobs.status==='rejected')referenceLibrary.errors.favorites=jobs.reason.message;
  referenceLibrary.sources=libraryDates.referenceLibrarySources({assets:assets.status==='fulfilled'?assets.value.assets:[],jobs:jobs.status==='fulfilled'?jobs.value.jobs:[],projectId,kind,maxMB:referenceLibrary.maxMB,contentTypes:kind==='video'?currentModel().videoRules?.contentTypes:undefined});
  referenceLibrary.loading=false;renderReferenceLibrary();
}
function renderReferenceLibrary(){
  const {kind,collection,selection,maxMB}=referenceLibrary,remaining=referenceLibraryRemaining(),query=$('#reference-library-search').value.trim().toLowerCase();
  $$('#reference-library [data-reference-collection]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.referenceCollection===collection)));
  $('#reference-library-search').placeholder=collection==='favorites'?'Search this project’s favorites': 'Search '+({assets:'Assets',outfit:'Outfit',id:'ID'}[collection]);
  $('#reference-library-hint').textContent=remaining?`Choose up to ${remaining} more ${kind==='audio'?'audio files':kind+' reference'+(remaining===1?'':'s')} · ${maxMB} MB each${state.inputType==='frames'?' · Select first frame, then last frame.':''}`:'The reference limit is reached. Remove a reference to make room.';
  const entries=referenceLibrary.sources.map((source,index)=>({...source,index})).filter(source=>source.collection===collection&&(source.name+' '+source.label).toLowerCase().includes(query));
  $('#reference-library-grid').innerHTML=entries.map(source=>{
    const selected=selection.has(source.key),disabled=source.disabled||!selected&&selection.size>=remaining;
    const preview=kind==='image'?`<img src="${esc(source.url)}" alt="" loading="lazy">`:kind==='video'?`<video src="${esc(source.url)}" preload="metadata" muted playsinline></video>`:`<span class="audio-reference-icon">${icon('music')}</span>`;
    return `<label class="reference-library-card ${selected?'selected':''} ${disabled?'unavailable':''}"><input type="checkbox" data-reference-source="${source.index}" aria-label="Select ${esc(source.name)}" ${selected?'checked':''} ${disabled?'disabled':''}>${preview}<strong title="${esc(source.name)}">${esc(source.name)}</strong><small>${esc(source.reason||source.label)}</small></label>`;
  }).join('');
  $('#reference-library-status').textContent=referenceLibrary.errors[collection==='favorites'?'favorites':'assets']||(referenceLibrary.loading?'Loading references…':entries.length?`${entries.length} ${kind} reference${entries.length===1?'':'s'} · ${collection!=='favorites'?'All projects':'Current project'}`:query?'No matching references.':collection!=='favorites'?`No saved ${kind} assets yet. Upload a file to begin.`:`No favorite ${kind} references in this project yet. Choose Assets or upload a file.`);
  $('#reference-library-count').textContent=`${selection.size} / ${remaining} selected`;
  $('#reference-library-add').disabled=!selection.size;$('#reference-library-add').textContent=selection.size?`Add ${selection.size} ${kind==='audio'?'audio file'+(selection.size===1?'':'s'):kind+(selection.size===1?'':'s')}`:'Add references';
  $('#reference-library-upload').disabled=!remaining;
}
async function importReferenceLibrary(sources,context){
  if(referenceBusy()||referenceContext()!==context)return;
  state.uploading++;updateButton();error('');
  try{
    const files=[];
    for(const source of sources){
      const limit=referenceFileMB(currentModel(),source.contentType.split('/')[0])*1024**2;
      const response=await fetch(source.url);if(!response.ok)throw Error('Could not load '+source.name+'. Try saving the original again.');
      if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw Error(source.name+' exceeds the selected model’s reference size limit.');}
      const blob=await response.blob();if(blob.size>limit)throw Error(source.name+' exceeds the selected model’s reference size limit.');
      files.push(new File([blob],source.name,{type:source.contentType}));
    }
    if(referenceContext()!==context)throw Error('The reference settings changed. Choose your references again.');
    if(await addFiles(files,{locked:true}))toast(`Added ${files.length} reference${files.length===1?'':'s'}.`);
  }catch(e){error(e.message);toast(e.message);}finally{state.uploading--;updateButton();}
}
$('#reference-field').addEventListener('click',event=>{const button=event.target.closest('[data-reference-picker]');if(button)void openReferenceLibrary(button.dataset.referencePicker==='single'?referenceLibraryKind():button.dataset.referencePicker);});
async function useAsset(asset,url){
  if(state.enhancing||state.uploading||state.submitting||state.llmBusy){toast('Wait for reference preparation to finish.');return;}
  if(assetReturnView==='tools'&&mediaTools){setView('tools');await mediaTools.loadSaved({url,name:asset.name,contentType:asset.contentType});revealComposer();return;}
  const target=assetReturnView==='llm'&&llm?'llm':assetReturnView==='ideation'?'ideation':'studio',kind=asset.contentType.startsWith('video/')?'video':'image';
  state.uploading++;updateButton();
  try{
    const max=target==='llm'?(kind==='video'?200:10):referenceFileMB(currentModel(),kind);if(asset.bytes>max*1024**2)throw Error(`This ${kind} exceeds the selected model's ${max} MB reference limit.`);
    const response=await fetch(url);if(!response.ok)throw Error((await response.json()).error||'Could not load this asset.');
    const blob=await response.blob(),file=new File([blob],asset.name,{type:asset.contentType});
    setView(target);
    if(target==='llm'){if((kind==='video')!==($('#llm-task').value==='video'))throw Error(`Choose ${kind==='video'?'Describe video':'Describe images or Refine a text output'} first to use this asset.`);await llm.importFiles([file]);}
    else{await prepareReference(kind);const added=await addFiles([file],{locked:true});if(added){revealComposer();toast('Asset added as a reference.');}}
  }catch(e){toast(e.message);}finally{state.uploading--;updateButton();}
}
$('#assets-nav').addEventListener('click',openAssets);
async function favoriteResult(jobId,mediaId,favorite,source){
  if(state.favoritePending.has(mediaId))return;
  state.favoritePending.add(mediaId);state.libraryVersion++;
  try{
    const result=await post('/api/favorites',{jobId,mediaId,favorite,...(state.features.projects?{projectId:source?.job?.projectId||state.projectId}:{})});
    const current=state.jobs.find(j=>j.id===jobId)?.tasks.flatMap(t=>t.outputs||[]).find(m=>m.id===mediaId);
    if(current)current.favorite=result.favorite;if(source)source.media.favorite=result.favorite;
    renderJobs();toast(result.favorite?'Added to Favorites.':'Removed from Favorites. Kept in history.');return result;
  }catch(e){toast(e.message);}finally{state.favoritePending.delete(mediaId);state.libraryVersion++;}
}
function dragPayload(event){
  try{const data=JSON.parse(event.dataTransfer.getData(MEDIA_DRAG_TYPE));return typeof data.jobId==='string'&&typeof data.mediaId==='string'?data:null;}catch{return null;}
}
function acceptsDrop(event){return [...event.dataTransfer.types].some(t=>t===MEDIA_DRAG_TYPE||t==='Files');}
function clearDrag(){state.dragging=false;$('.composer').classList.remove('drag-over');$('#favorites-nav').classList.remove('drag-over');}
for(const input of $$('#reference-field input[type=file]'))input.addEventListener('change',e=>dropFiles([...e.target.files]));
for(const type of ['dragenter','dragover'])$('.composer').addEventListener(type,e=>{
  if(['llm','shoot','outfit','reference','product','environment','creator'].includes(state.view))return;
  if(!acceptsDrop(e))return;e.preventDefault();e.dataTransfer.dropEffect=state.uploading||state.submitting?'none':'copy';
  if(!state.uploading&&!state.submitting)$('.composer').classList.add('drag-over');
});
$('.composer').addEventListener('dragleave',e=>{if(!$('.composer').contains(e.relatedTarget))$('.composer').classList.remove('drag-over');});
$('.composer').addEventListener('drop',e=>{
  if(['llm','shoot','outfit','reference','product','environment','creator'].includes(state.view))return;
  if(!acceptsDrop(e))return;e.preventDefault();e.stopPropagation();clearDrag();
  if(state.view==='audio'){
    if(!audioWorkspace){toast('Open Apply Studio Update.command, then refresh to activate Audio.');return;}
    const source=dragPayload(e);if(source)void audioWorkspace.useResult(source.jobId,source.mediaId).catch(error=>toast(error.message));else void audioWorkspace.addFiles([...e.dataTransfer.files]);return;
  }
  if(state.view==='tools'){
    if(!mediaTools){toast('Open Apply Studio Update.command, then refresh to activate Tools.');return;}
    const source=dragPayload(e);if(source)void mediaTools.useResult(source.jobId,source.mediaId).catch(error=>toast(error.message));else if(e.dataTransfer.files.length===1)void mediaTools.addFile(e.dataTransfer.files[0]);else toast('Choose one source file at a time.');return;
  }
  const source=dragPayload(e);if(source)useReference(source.jobId,source.mediaId);else dropFiles([...e.dataTransfer.files]);
});
$('#results').addEventListener('dragstart',e=>{
  const source=e.target.closest('[draggable=true]')?.closest('[data-media]');if(!source)return;
  const {job,media}=findResult(source.dataset.job,source.dataset.media);state.dragging=true;
  e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData(MEDIA_DRAG_TYPE,JSON.stringify({jobId:job.id,mediaId:media.id}));
  const url=new URL(mediaURL(job,media,true),location.href).href;
  e.dataTransfer.setData('text/uri-list',url);e.dataTransfer.setData('text/plain',url);
  const projectName=[...state.projects,...state.deletedProjects].find(p=>p.id===job.projectId)?.name||'Project';
  const extension=({'audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','video/mp4':'mp4','video/quicktime':'mov','image/jpeg':'jpg','image/webp':'webp'})[media.contentType]||'png';
  const name=libraryDates.projectDownloadName(projectName,media.id,extension);
  e.dataTransfer.setData('DownloadURL',`${media.contentType}:${name}:${url}`);
});
$('#results').addEventListener('dragend',clearDrag);
for(const type of ['dragenter','dragover'])$('#favorites-nav').addEventListener(type,e=>{if(![...e.dataTransfer.types].includes(MEDIA_DRAG_TYPE))return;e.preventDefault();e.dataTransfer.dropEffect='copy';$('#favorites-nav').classList.add('drag-over');});
$('#favorites-nav').addEventListener('dragleave',e=>{if(!$('#favorites-nav').contains(e.relatedTarget))$('#favorites-nav').classList.remove('drag-over');});
$('#favorites-nav').addEventListener('drop',e=>{const source=dragPayload(e);if(!source)return;e.preventDefault();clearDrag();favoriteResult(source.jobId,source.mediaId,true);});
// A dropped file outside the composer must not navigate away from the app.
document.addEventListener('dragover',e=>{if(acceptsDrop(e)){e.preventDefault();if(!e.target.closest('.composer,#favorites-nav,#ideation-nav,#canvas-viewport'))e.dataTransfer.dropEffect='none';}});
document.addEventListener('drop',e=>{if(acceptsDrop(e)){e.preventDefault();clearDrag();}});
const ideas={
  product:['A sculptural translucent amber glass perfume bottle on a travertine plinth, warm late-afternoon sunlight through linen curtains, soft organic shadows, quiet luxury editorial photography, 85mm lens, subtle film grain.','A slow cinematic orbit around a sculptural amber glass perfume bottle on a travertine plinth. Golden sunlight shifts across the glass. Gentle camera motion, warm editorial lighting, subtle film grain.'],
  landscape:['A solitary modernist house on the edge of a misty pine forest, a still lake reflecting its warm interior lights at blue hour, cinematic composition, soft natural colors, large-format architectural photography.','A slow aerial camera moves toward a solitary house beside a still lake at blue hour. Mist drifts between pine trees and warm light glows through the windows. Quiet cinematic atmosphere, natural movement.'],
  abstract:['An impossible sculpture made from folded terracotta silk and brushed silver, suspended in a warm ivory space, tactile materials, soft directional light, high-end contemporary art photography, restrained colors.','Folded terracotta silk slowly unfurls around a brushed silver sphere suspended in an ivory space. The camera gently pushes in. Soft directional light, tactile textures, graceful surreal movement.']
};
function useIdea(id){$('#prompt').value=ideas[id][state.mode==='image'?0:1];updatePromptCount();$('#prompt').focus();error('');}
$$('[data-idea]').forEach(b=>b.addEventListener('click',()=>useIdea(b.dataset.idea)));
$('#inspire').addEventListener('click',()=>useIdea(Object.keys(ideas)[Math.floor(Math.random()*3)]));
let mediaStorage={automatic:false},storageBusy=false,newProjectFolderToken=null;
function renderMediaStorage(config){
 if(config.projectId&&config.projectId!==state.projectId)return;
 mediaStorage=config;
 const project=state.projects.find(p=>p.id===state.projectId);if(project)project.mediaStorage=config;
 for(const id of ['media-auto-save','project-auto-save']){$('#'+id).checked=config.automatic;$('#'+id).disabled=storageBusy||!state.ready;}
 $('#media-save-folder').textContent=config.directory||(config.hosted?'Hosted studio storage':'Default studio folder');
 $('#project-save-folder').title='Save folder: '+(config.directory||'Hosted studio storage');
 $('#project-save-folder').hidden=$('#media-choose-folder').hidden=!config.folderPicker;
 $('#project-save-folder').disabled=$('#media-choose-folder').disabled=storageBusy;
 renderJobs();
}
async function loadMediaStorage(){
 const projectId=state.projectId;
 try{const config=await api('/api/settings/media?project='+encodeURIComponent(projectId));if(state.projectId===projectId)renderMediaStorage(config);$('#media-storage-status').textContent='Only this project is affected. Existing files stay in place.';}
 catch(e){$('#media-storage-status').textContent=e.message;}
}
async function chooseMediaFolder(projectId=state.projectId){
 $('#media-storage-status').textContent='Choose a folder in the macOS dialog…';
 const config=await post('/api/settings/media/folder',{projectId});
 if(projectId===state.projectId)renderMediaStorage(config);
 $('#media-storage-status').textContent=config.cancelled?'Folder unchanged.':'This project will use the selected folder for new saves.';
 return !config.cancelled;
}
async function pickCurrentProjectFolder(){
 if(storageBusy)return;storageBusy=true;renderMediaStorage(mediaStorage);updateButton();
 try{await chooseMediaFolder();}catch(e){toast(e.message);$('#media-storage-status').textContent=e.message;}
 finally{storageBusy=false;renderMediaStorage(mediaStorage);updateButton();}
}
for(const id of ['media-choose-folder','project-save-folder'])$('#'+id).addEventListener('click',pickCurrentProjectFolder);
for(const id of ['media-auto-save','project-auto-save'])$('#'+id).addEventListener('change',async e=>{
 if(storageBusy)return;const enabled=e.target.checked,projectId=state.projectId;storageBusy=true;renderMediaStorage(mediaStorage);updateButton();
 try{
  if(enabled&&mediaStorage.folderPicker&&!await chooseMediaFolder(projectId))return;
  renderMediaStorage(await post('/api/settings/media',{projectId,automatic:enabled}));
  toast(enabled?'Auto-save is on for this project.':'Auto-save is off for this project.');
 }catch(e){toast(e.message);$('#media-storage-status').textContent=e.message;}
 finally{storageBusy=false;renderMediaStorage(mediaStorage);updateButton();}
});
$('#new-project-folder').addEventListener('click',async()=>{
 const button=$('#new-project-folder');button.disabled=true;$('#project-save').disabled=true;
 try{const choice=await post('/api/settings/media/folder',{draft:true});if(!choice.cancelled){newProjectFolderToken=choice.folderToken;$('#new-project-folder-label').textContent=choice.directory+' / FWRD.STUDIO Media / this project';}}
 catch(e){$('#project-error').hidden=false;$('#project-error').textContent=e.message;}
 finally{button.disabled=false;$('#project-save').disabled=false;}
});
async function showSettings(){
  void loadMediaStorage();
  $('#settings-dialog').showModal();
  const container=$('#settings-file-links'),status=$('#settings-file-status');
  container.replaceChildren();status.textContent='Loading settings files…';
  try{
    let offline=false;
    const config=await api('/api/settings/files').catch(()=>{offline=true;return {enabled:true,files:[{id:'comfy',label:'Comfy API key · Reference Master',filename:'REFERENCE_MASTER_COMFY_KEY.txt',available:true}]};});
    for(const file of config.files.filter(file=>file.id==='comfy')){
      const button=document.createElement('button');button.type='button';button.className='settings-file-link';button.disabled=!file.available;
      const info=document.createElement('span'),label=document.createElement('strong'),filename=document.createElement('small'),action=document.createElement('span');
      label.textContent=file.label;filename.textContent=file.filename||'Not configured';info.append(label,filename);
      action.className='settings-file-action';action.textContent='Open API key file ↗';button.append(info,action);
      button.addEventListener('click',async()=>{
        button.disabled=true;status.textContent='Opening '+file.filename+'…';
        try{await post('/api/settings/files/open',{id:file.id});status.textContent='Opened in TextEdit. Save your changes, then refresh the studio.';}
        catch(error){status.textContent=error.message;}finally{button.disabled=!file.available;}
      });
      container.append(button);
    }
    status.textContent=offline?'The local server is unavailable. Start the app and reload to open your API key file.':config.enabled?'Files open in TextEdit on this Mac.':'Text-file links are available in the local Mac app.';
  }catch{status.textContent='Reopen the updated app to access your settings files.';}
}
function showConnection(provider){$('#api-key').value='';$('#settings-error').hidden=true;updateConnection();$('#connection-dialog').showModal();}
$('#settings-nav').addEventListener('click',showSettings);
$('#close-settings').addEventListener('click',()=>$('#settings-dialog').close());
$('#settings-done').addEventListener('click',()=>$('#settings-dialog').close());
$('#close-connection').addEventListener('click',()=>$('#connection-dialog').close());
$('#settings-form').addEventListener('submit',async e=>{
  e.preventDefault();const key=$('#api-key').value.trim();if(!key){$('#settings-error').textContent='Paste your Comfy API key first.';$('#settings-error').hidden=false;return;}
  $('#save-key').disabled=true;
  try{const r=await post('/api/settings',{key});state.keyConfigured=r.keyConfigured;$('#api-key').value='';$('#connection-dialog').close();updateConnection();toast('API key configured. You’re ready to generate.');}
  catch(e){$('#settings-error').textContent=e.message;$('#settings-error').hidden=false;}finally{$('#save-key').disabled=false;}
});
$('#disconnect').addEventListener('click',async()=>{try{await post('/api/settings',{key:''});state.keyConfigured=false;updateConnection();$('#connection-dialog').close();toast('API key removed from this session.');}catch(e){$('#settings-error').textContent=e.message;$('#settings-error').hidden=false;}});
$('#connection-dialog').addEventListener('close',()=>$('#api-key').value='');
function setView(view){
  if(['ideation','studio','llm','history','audio','tools','color','effects'].includes(view))view='creator';
  // Restore older saved History views into the unified Create feed.
  if(view==='history')view='studio';
  if(['color','effects'].includes(view)&&!editing){toast('Open Apply Studio Update.command, then refresh to activate the grading editor.');return;}
  if(editing?.busy&&view!==state.view){toast('Wait for the editor to finish, or cancel the export.');return;}
  if(view==='llm'&&!llm||view==='shoot'&&!shoot)view='studio';
  if((state.llmBusy||state.enhancing)&&view!==state.view){toast('Wait for prompt or reference preparation to finish.');return;}
  if(view!=='ideation')canvas.closeContextMenu();
  document.body.classList.toggle('assets-mode',view==='assets');$('#assets-section').hidden=view!=='assets';$('#assets-nav').classList.toggle('active',view==='assets');if(view==='assets'&&assetLibrary)void assetLibrary.show();
  if(state.view!==view)downloadSelection.clear();state.view=view;try{localStorage.setItem('fwrd-view:'+state.projectId,view);}catch{}
  document.body.classList.toggle('favorites-mode',view==='favorites');
  $('#studio-nav').classList.toggle('active',['studio','llm','shoot','outfit','reference','creator'].includes(view));$('#favorites-nav').classList.toggle('active',view==='favorites');
  $('#product-nav').classList.toggle('active',view==='product');
  $('#environment-nav').classList.toggle('active',view==='environment');
  $('.mode-switch').hidden=['product','environment'].includes(view);
  $('#reference-sheet-type').closest('.field').hidden=true;
  $('#projects-nav').classList.toggle('active',view==='projects');document.body.classList.toggle('projects-mode',view==='projects');$('#projects-section').hidden=view!=='projects';if(view==='projects'){renderProjects();refreshProjects();}
  document.body.classList.toggle('ideation-mode',view==='ideation');$('#canvas-section').hidden=view!=='ideation';
  document.body.classList.toggle('llm-mode',view==='llm');$('#llm-controls').hidden=view!=='llm';$('#llm-workspace').hidden=view!=='llm';$('#generate-form').hidden=['llm','shoot','outfit','reference','product','environment','creator','tools','audio','color','effects'].includes(view);
  document.body.classList.toggle('shoot-mode',view==='shoot');$('#shoot-controls').hidden=view!=='shoot';$('#shoot-workspace').hidden=view!=='shoot';
  document.body.classList.toggle('reference-mode',['reference','product','environment'].includes(view));$('#reference-controls').hidden=!['reference','product','environment'].includes(view);$('#reference-workspace').hidden=true;if(['reference','product','environment'].includes(view))showReferenceSheet();
  $('#creator-controls').hidden=view!=='creator';if(view==='creator')creator?.show(state.projectId);
  if(view==='creator'){$('.composer-title h1').textContent='Create your character.';}
  $('#outfit-controls').hidden=view!=='outfit';if(view==='outfit')outfit?.show(state.projectId);
  if(view==='shoot')void shoot.show(state.projectId);else shoot?.hide();
  const isEditing=['color','effects'].includes(view);document.body.classList.toggle('editing-mode',isEditing);$('#editing-controls').hidden=!isEditing;$('#editing-workspace').hidden=!isEditing;if(isEditing)void editing?.show(view);else editing?.hide();
  document.body.classList.toggle('audio-mode',view==='audio');$('#audio-controls').hidden=view!=='audio';if(view==='audio')audioWorkspace?.show();
  document.body.classList.toggle('tools-mode',view==='tools');$('#tools-controls').hidden=view!=='tools';if(view==='tools')mediaTools?.show();
  $$('[data-mode]').forEach(b=>{const selected=b.dataset.mode===(['llm','shoot','outfit','reference','creator'].includes(view)?view:state.mode);b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  $('.composer-title h1').textContent=view==='llm'?'Give your references a voice.':view==='ideation'?'Explore an idea.':'Create something new.';$('.composer-title p').textContent=view==='llm'?'Describe, refine, then create.':view==='ideation'?'Every generation lands on your canvas.':'An idea is all you need to begin.';
  if(view==='creator'){$('.composer-title h1').textContent='Create your character.';$('.composer-title p').textContent='Build an original character from an idea or references.';}
  if(view==='reference'){$('.composer-title h1').textContent='Build your character references.';$('.composer-title p').textContent='Create consistent character sheets from your photos.';}
  if(view==='environment'){$('.composer-title h1').textContent='Create your environment.';$('.composer-title p').textContent='Build consistent location references from your photos.';}
  if(view==='product'){$('.composer-title h1').textContent='Create your product.';$('.composer-title p').textContent='Build consistent product references from your photos.';}
  if(view==='outfit'){$('.composer-title h1').textContent='Extract your outfit.';$('.composer-title p').textContent='From an image or idea to a clean fashion flat lay.';}
  if(view==='shoot'){$('.composer-title h1').textContent='Direct your next shoot.';$('.composer-title p').textContent='A reference. A few changes. A new story.';}
  if(view==='audio'){$('.composer-title h1').textContent='Make yourself heard.';$('.composer-title p').textContent='From a few words to a world of sound.';}
  if(view==='tools'){$('.composer-title h1').textContent='Refine what you have.';$('.composer-title p').textContent='Enhance, upscale and explore depth.';}
  if(isEditing){$('.composer-title h1').textContent=view==='color'?'Shape the light.':'Make it feel different.';$('.composer-title p').textContent=view==='color'?'Light, colour, film and depth.':'Explore texture, pattern and distortion.';}
  if(view==='llm')void llm.show(state.projectId);else llm?.hide();updateConnection();
  if(view==='ideation'){canvas.jobs=state.jobs;canvas.load();}
  state.historySignature='';renderJobs();updateButton();
}
$('#environment-nav').addEventListener('click',()=>setView('environment'));
$('#product-nav').addEventListener('click',()=>setView('product'));
$('#studio-nav').addEventListener('click',()=>setView('studio'));$('#favorites-nav').addEventListener('click',()=>setView('favorites'));$('#favorites-history').addEventListener('click',showAllGenerations);$('#back-create').addEventListener('click',showAllGenerations);



$('#generate-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.enhancing||state.submitting||state.uploading||state.switching||legacyGenerationBusy())return;
  error('');if(!state.keyConfigured){showConnection();return;}
  if(!$('#prompt').value.trim()){error('Write a prompt to get started.');return;}
  if(state.inputType!=='text'&&!state.references.length){error('Add a reference file first.');return;}
  if(modelRestartRequired()){error('Open Apply Studio Update.command, then refresh, to activate this model.');return;}
  const serverModel=state.serverModels?.find(m=>m.id===state.model);
  if(serverModel&&$('#prompt').value.length>capabilities(serverModel,state.inputType).maxPrompt){error('Open Apply Studio Update.command, then refresh, to activate longer prompts. Your prompt has been kept.');return;}
  if(mixedRestartRequired()){error('Restart FWRD.STUDIO to activate the updated video inputs.');return;}
  const referenceProblem=referenceCompatibility(currentModel(),state.inputType,state.references);
  if(referenceProblem){error(referenceProblem);return;}
  if(state.references.length>serverReferenceLimit()){error('Restart FWRD.STUDIO to activate the increased reference limit, then add your references again.');return;}
  const frameIndices=state.references.filter(r=>r.kind==='image').map(r=>r.frameIndex);
  try{validateReferenceSelection(currentModel(),{inputType:state.inputType,duration:$('#duration').value,frameIndices},state.references);}catch(e){error(e.message);return;}
  const destination=state.view==='ideation'?'ideation':'studio';
  state.submitting=true;updateButton();
  try{
    if(destination==='ideation'&&!await canvas.load()){error('The saved canvas is not ready. Restart the studio or retry loading it.');return;}
    const {job}=await post('/api/generate',{...(state.features.projects?{projectId:state.projectId}:{}),destination,canvasPosition:destination==='ideation'?canvas.insertionPoint(Number($('#count').value)):undefined,model:state.model,inputType:state.inputType,prompt:$('#prompt').value,ratio:state.ratio,resolution:$('#resolution').value,count:Number($('#count').value),duration:$('#duration').value,audio:$('#audio').checked,quality:currentModel().qualities?$('#quality').value:undefined,creativity:currentModel().creativityLevels?$('#creativity').value:undefined,thinking:currentModel().thinkingLevels?$('#thinking').value:undefined,frameIndices:state.inputType==='keyframes'?frameIndices:undefined,referenceIds:state.references.map(r=>r.id)});
    state.libraryVersion++;state.jobs=state.jobs.filter(j=>j.id!==job.id);state.jobs.unshift(job);setView(destination);if(destination==='ideation'){document.body.classList.remove('mobile-controls');canvas.jobs=state.jobs;canvas.renderActivity();}
    if(innerWidth<800&&destination==='studio')$('.workspace').scrollIntoView({behavior:'smooth'});
  }catch(e){error(e.message);}finally{state.submitting=false;updateButton();}
});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!['favorites','color','effects','shoot','outfit','reference','product','environment','creator'].includes(state.view)&&!$('dialog[open]')){const button=$(state.view==='audio'?'#audio-run':state.view==='tools'?'#tool-run':state.view==='llm'?'#llm-generate':'#generate');if(button&&!button.disabled){e.preventDefault();$(state.view==='audio'?'#audio-form':state.view==='tools'?'#tool-form':state.view==='llm'?'#llm-form':'#generate-form').requestSubmit();}}});
function storageStatus(media){
  if(!media.savedLocally&&!mediaStorage.automatic)return `<div class="storage-status"><span>Online preview</span><button type="button" data-save-media="${esc(media.id)}">Keep on this computer</button></div>`;
  if(media.storageError)return `<div class="storage-status storage-warning" role="status"><span title="${esc(media.storageError)}">Local copy not saved yet</span><button type="button" data-save-media="${esc(media.id)}">Retry saving</button></div>`;
  return `<div class="storage-status ${media.savedLocally?'stored':''}"><span>${media.savedLocally?'Saved on this computer':'Saving a local copy…'}</span></div>`;
}
const generationTitle=job=>libraryDates.generationTitle(job);

const downloadSelection=new Map();let visibleDownloadItems=[],batchDownloading=false,batchDeleting=false;
let resultLayout='feed',historyPeriod='all';
try{if(localStorage.getItem('fwrd-result-layout')==='cards')resultLayout='cards';const saved=localStorage.getItem('fwrd-history-period');if(['day','week','month','all'].includes(saved))historyPeriod=saved;}catch{}
if(!libraryDates)historyPeriod='all';
function showAllGenerations(){
  if(state.llmBusy||state.enhancing){toast('Wait for prompt or reference preparation to finish.');return;}
  historyPeriod='all';$('#history-period').value='all';try{localStorage.setItem('fwrd-history-period','all');}catch{}setView('studio');
}
const selectionKey=(jobId,mediaId)=>JSON.stringify([jobId,mediaId]);
async function downloadBatch(items,projectId=state.projectId){
  if(!items.length)return;
  if(!state.features.batchDownloads){toast('Open Apply Studio Update.command, then refresh to activate batch downloads.');return;}
  const {url,count}=await post('/api/downloads/batch',{items,projectId});
  const link=document.createElement('a');link.href=url;link.download='';document.body.append(link);link.click();link.remove();
  toast(`Downloading ${count} file${count===1?'':'s'} in one ZIP.`);
}
function updateDownloadSelection(){
  const valid=new Set(visibleDownloadItems.map(i=>selectionKey(i.jobId,i.mediaId)));
  for(const key of downloadSelection.keys())if(!valid.has(key))downloadSelection.delete(key);
  $$('#results [data-select-media]').forEach(input=>{const card=input.closest('[data-media]'),selected=downloadSelection.has(selectionKey(card.dataset.job,card.dataset.media));input.checked=selected;card.classList.toggle('download-selected',selected);input.disabled=batchDeleting;});
  const count=downloadSelection.size,total=visibleDownloadItems.length;
  $('#download-selection-count').textContent=count+' selected';$('#select-visible').checked=total>0&&count===total;$('#select-visible').indeterminate=count>0&&count<total;$('#select-visible').disabled=!total||batchDeleting;
  $('#delete-selected').disabled=!count||batchDeleting||batchDownloading||!!state.deletionPending.size;$('#delete-selected').textContent=batchDeleting?'Deleting…':'Delete selected';
  $$('#results [data-delete-generation],[data-delete-failed]').forEach(button=>button.disabled=batchDeleting);
  $('#download-selected').disabled=!count||batchDownloading||batchDeleting;$('#download-selected').lastChild.textContent=batchDownloading?'Preparing ZIP…':'Download ZIP';$('#clear-selection').disabled=!count||batchDeleting;
}
for(const layout of ['feed','cards'])$('#view-'+layout).addEventListener('click',()=>{resultLayout=layout;try{localStorage.setItem('fwrd-result-layout',layout);}catch{}renderJobs();});
$('#history-period').value=historyPeriod;
$('#history-period').addEventListener('change',()=>{if(!libraryDates){$('#history-period').value='all';toast('Open Apply Studio Update.command, then refresh to activate history filters.');return;}historyPeriod=$('#history-period').value;try{localStorage.setItem('fwrd-history-period',historyPeriod);}catch{}renderJobs();});
$('#select-visible').addEventListener('change',e=>{downloadSelection.clear();if(e.target.checked)for(const item of visibleDownloadItems)downloadSelection.set(selectionKey(item.jobId,item.mediaId),item);updateDownloadSelection();});
$('#clear-selection').addEventListener('click',()=>{downloadSelection.clear();updateDownloadSelection();});
$('#delete-selected').addEventListener('click',()=>void deleteGenerations([...downloadSelection.values()]));
$('#download-selected').addEventListener('click',async()=>{if(batchDownloading||batchDeleting)return;const items=[...downloadSelection.values()],projectId=state.projectId;batchDownloading=true;updateDownloadSelection();try{await downloadBatch(items,projectId);}catch(error){toast(error.message);}finally{batchDownloading=false;updateDownloadSelection();}});
$('#results').addEventListener('change',e=>{if(!e.target.matches('[data-select-media]'))return;const card=e.target.closest('[data-media]'),item={jobId:card.dataset.job,mediaId:card.dataset.media},key=selectionKey(item.jobId,item.mediaId);if(e.target.checked)downloadSelection.set(key,item);else downloadSelection.delete(key);updateDownloadSelection();});
function mediaCard(media,job,index){
  const video=media.contentType.startsWith('video/'),audio=media.contentType.startsWith('audio/'),kind=audio?'audio':video?'video':'image',favorite=!!media.favorite,url=mediaURL(job,media);
  const preview=audio?`<div class="audio-player"><span>${icon('music')} ${esc(job.modelName)}</span><audio controls preload="metadata" src="${esc(url)}" aria-label="Generated audio"></audio></div>`:video?`<video controls playsinline preload="metadata" src="${esc(url)}" aria-label="Generated video"></video>`:`<button class="media-preview" data-preview="${esc(job.id)}" data-media-id="${esc(media.id)}" aria-label="Preview generated image"><img src="${esc(url)}" draggable="true" alt="${esc(generationTitle(job))}" loading="lazy" title="Drag to the composer to use as a reference, or to Favorites"></button>`;
  return `<article class="media-card" data-job="${esc(job.id)}" data-media="${esc(media.id)}"><label class="media-select" title="Select for batch actions"><input type="checkbox" data-select-media aria-label="Select ${kind} ${index+1} from ${esc(generationTitle(job))}"></label>${preview}<div class="media-info"><span class="media-output-name">${esc(media.name||(job.settings.workflow==='creator'?job.settings.creator?.name?.trim():'')||`${audio?'Audio':video?'Video':'Image'} ${index+1}`)}${audio&&Number.isFinite(media.duration)?' · '+media.duration.toFixed(1)+'s':media.width?' · '+media.width+' × '+media.height:''}</span><button type="button" class="text-button" data-rename-media aria-label="Rename result">Rename</button><button type="button" class="text-button" data-tag-media>Tags</button><a class="download" href="${esc(mediaURL(job,media,true))}" download>${icon('download')}Download</a></div>${media.tags?.length?`<div class="media-tags">${media.tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}<div class="media-actions">${video?`<button type="button" data-preview="${esc(job.id)}" data-media-id="${esc(media.id)}" aria-label="Open video preview" title="Open video preview">${icon('video')}<span>Preview</span></button>`:''}<button type="button" class="reference-action" data-reference="${esc(media.id)}" aria-label="Use ${kind} as reference">${icon(audio?'music':'image')}<span>Use as reference</span></button>${!audio?``:''}${!audio&&state.features.assetLibrary?`<button type="button" data-save-asset aria-pressed="${!!media.savedToAssets}" class="asset-save-action ${media.savedToAssets?'saved':''} ${job.settings.workflow==='creator'?'outfit-'+({Female:'women',Male:'men'}[job.settings.creator?.gender]||'neutral'):job.settings.workflow==='reference'?'outfit-'+referenceAudience(job):state.view==='outfit'?'outfit-'+outfitAudience(job):''}" aria-label="${media.savedToAssets?'Saved in Assets':job.settings.workflow==='creator'?'Add to Character assets':job.settings.workflow==='reference'?`Add to ${job.settings.referenceType==='product'?'Product':job.settings.referenceType==='environment'?'Environment':'ID'} assets`:state.view==='outfit'?'Add to Outfit assets':'Add to Asset Library'}" title="${media.savedToAssets?'Saved in Assets':job.settings.workflow==='creator'?'Add to Character assets':job.settings.workflow==='reference'?`Add to ${job.settings.referenceType==='product'?'Product':job.settings.referenceType==='environment'?'Environment':'ID'} assets`:state.view==='outfit'?'Add to Outfit assets':'Add to Asset Library'}">${job.settings.workflow==='creator'?icon('person'):job.settings.workflow==='reference'?(job.settings.referenceType==='product'?icon('box'):job.settings.referenceType==='environment'?icon('mountain'):'<span class="reference-id-icon" aria-hidden="true">ID</span>'):icon(state.view==='outfit'?'shirt':'box')}</button>`:''}<button type="button" class="drag-handle" draggable="true" title="Drag to the composer or Favorites" aria-label="Drag result; use the adjacent buttons for keyboard actions">${icon('grip')}</button><button type="button" class="favorite-action ${favorite?'saved':''}" data-favorite="${esc(media.id)}" aria-pressed="${favorite}" aria-label="${favorite?'Remove from':'Add to'} Favorites" title="${favorite?'Remove from':'Add to'} Favorites">${icon('star')}</button><button type="button" class="delete-generation" data-delete-generation aria-label="Delete generation" title="Delete this ${kind}">${icon('trash')}</button></div>${storageStatus(media)}</article>`;
}
async function deleteGeneration(jobId,target,projectId=state.projectId,restore=false,quiet=false){
  if(!state.features.generationDeletion||(target.taskIndex!==undefined&&!state.features.failedGenerationDeletion)){const message='Open Apply Studio Update.command, then refresh to activate generation deletion.';if(quiet)throw Error(message);toast(message);return;}
  const pendingKey=JSON.stringify([jobId,target]);
  if(state.deletionPending.has(pendingKey)){if(quiet)throw Error('This item is already being changed.');return;}
  state.deletionPending.add(pendingKey);state.libraryVersion++;updateDownloadSelection();
  try{
    const result=await post('/api/generations/'+(restore?'restore':'delete'),{jobId,...target,projectId});
    if(projectId===state.projectId){
      state.jobs=state.jobs.filter(job=>job.id!==jobId);if(result.job)state.jobs.push(result.job);
      state.jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      if(shoot?.projectId===projectId)shoot.syncResultJob(jobId,result.job);
      if(canvas.board)await canvas.refresh(state.jobs);renderJobs();
    }
    if(!quiet)toast(restore?'Generation restored.':'Generation deleted.',restore?undefined:()=>deleteGeneration(jobId,target,projectId,true));
    return result;
  }catch(error){if(quiet)throw error;toast(error.message,restore?()=>deleteGeneration(jobId,target,projectId,true):undefined);}
  finally{state.deletionPending.delete(pendingKey);state.libraryVersion++;updateDownloadSelection();}
}
async function deleteGenerations(items,projectId=state.projectId,restore=false){
  if(!items.length||batchDeleting||state.deletionPending.size)return;
  if(!libraryDates?.runSelectionBatch){toast('Refresh the page to enable batch deletion.');return;}
  const targets=[...new Map(items.map(item=>[selectionKey(item.jobId,item.mediaId),{jobId:item.jobId,mediaId:item.mediaId}])).values()];
  batchDeleting=true;state.deletionPending.add('batch');state.libraryVersion++;updateDownloadSelection();
  let result;
  try{
    result=await libraryDates.runSelectionBatch(targets,async item=>{
      await deleteGeneration(item.jobId,{mediaId:item.mediaId},projectId,restore,true);
      if(!restore)downloadSelection.delete(selectionKey(item.jobId,item.mediaId));
    });
  }finally{batchDeleting=false;state.deletionPending.delete('batch');state.libraryVersion++;updateDownloadSelection();}
  const count=result.succeeded.length,failed=result.failed.length;
  const message=(count?`${count} item${count===1?'':'s'} ${restore?'restored':'deleted'}.`:'')+(failed?` ${failed} could not be ${restore?'restored':'deleted'}. ${result.failed[0].error.message}`:'');
  const undo=!restore&&count?()=>deleteGenerations(result.succeeded,projectId,true):restore&&failed?()=>deleteGenerations(result.failed.map(entry=>entry.item),projectId,true):undefined;
  toast(message.trim(),undo);return result;
}
function renderJobs(){
  const favoriteCount=state.jobs.reduce((n,j)=>n+j.tasks.reduce((sum,t)=>sum+(t.outputs||[]).filter(m=>m.favorite).length,0),0);
  $('#favorite-count').textContent=String(favoriteCount);$('#favorite-count').hidden=!favoriteCount;
  if(['llm','shoot','assets'].includes(state.view))return;
  const favoriteView=state.view==='favorites',feedView=['studio','outfit','reference','product','environment','creator'].includes(state.view);
  const sectionJobs=state.view==='creator'?state.jobs.filter(job=>job.settings.workflow==='creator'):['reference','product','environment'].includes(state.view)?state.jobs.filter(job=>job.settings.workflow==='reference'&&job.settings.referenceType===$('#reference-sheet-type').value):state.view==='outfit'?state.jobs.filter(isOutfitGeneration):feedView?libraryDates.generationFeed(state.jobs.filter(job=>!isOutfitGeneration(job)&&job.settings.workflow!=='reference'&&job.settings.workflow!=='creator'),state.mode,shoot?.projectId===state.projectId?shoot.draft.jobIds:[]):state.jobs;
  let visible=favoriteView?state.jobs.filter(j=>j.tasks.some(t=>t.outputs?.some(m=>m.favorite))):state.view==='tools'?state.jobs.filter(j=>j.settings.tool):state.view==='audio'?state.jobs.filter(j=>j.mode==='audio'):sectionJobs;
  if(feedView)visible=visible.filter(job=>!libraryDates||libraryDates.inHistoryPeriod(job.createdAt,historyPeriod));

  canvas.jobs=state.jobs;if(state.view==='projects'){renderProjects();return;}if(state.view==='ideation'){canvas.render();return;}
  const signature=state.view+state.mode+resultLayout+historyPeriod+JSON.stringify(visible);
  if(signature===state.historySignature)return;state.historySignature=signature;
  $('#results').classList.toggle('card-view',resultLayout==='cards');
  for(const layout of ['feed','cards'])$('#view-'+layout).setAttribute('aria-pressed',String(resultLayout===layout));
  $('#history-period-label').hidden=!feedView;
  visibleDownloadItems=visible.flatMap(job=>job.tasks.filter(t=>t.status==='COMPLETED').flatMap(t=>(t.outputs||[]).filter(m=>!favoriteView||m.favorite).map(m=>({jobId:job.id,mediaId:m.id}))));
  $('#library-visible-count').textContent=feedView?(historyPeriod==='all'?'All time':{day:'Today',week:'This week',month:'This month'}[historyPeriod])+' · '+visible.length+' of '+sectionJobs.length+' generations':visible.length+' generation'+(visible.length===1?'':'s');
  $('#workspace-eyebrow').textContent=favoriteView?'YOUR FAVORITES':state.view==='creator'?'YOUR CHARACTERS':['reference','product','environment'].includes(state.view)?'YOUR REFERENCE SHEETS':state.view==='outfit'?'YOUR OUTFIT FEED':feedView?(state.mode==='video'?'YOUR VIDEO FEED':'YOUR IMAGE FEED'):'YOUR GENERATION FEED';
  if(state.view==='environment')$('#workspace-eyebrow').textContent='YOUR ENVIRONMENTS';
  if(state.view==='product')$('#workspace-eyebrow').textContent='YOUR PRODUCTS';
  $('#workspace-title').textContent=favoriteView?'Worth coming back to.':sectionJobs.length?'From your imagination.':'Room for imagination.';
  $('#audio-empty').hidden=state.view!=='audio'||!!visible.length;
  if(state.view==='audio'){$('#workspace-eyebrow').textContent='YOUR AUDIO';$('#workspace-title').textContent='Ideas you can hear.';}
  $('#tools-empty').hidden=state.view!=='tools'||!!visible.length;
  if(state.view==='tools'){$('#workspace-eyebrow').textContent='YOUR TOOL RESULTS';$('#workspace-title').textContent='A new level of detail.';}
  $('#welcome').hidden=!!sectionJobs.length||state.view!=='studio';$('#empty-favorites').hidden=!favoriteView||!!visible.length;$('#empty-history').hidden=!feedView||!sectionJobs.length||!!visible.length;$('#empty-history h3').textContent=sectionJobs.length?'No generations in this period.':'Your story starts here.';$('#empty-history p').textContent=sectionJobs.length?'Your history is saved. Choose All time to see earlier generations.':'Your generations will appear here, with the settings that made them.';$('#results').hidden=!visible.length;
  $('#results').innerHTML=visible.map(job=>{
    let outputIndex=0;
    const cards=job.tasks.map((task,index)=>{
      if(task.status==='COMPLETED')return task.outputs.map(media=>{const index=outputIndex++;return !favoriteView||media.favorite?mediaCard(media,job,index):'';}).join('');
      if(favoriteView)return '';
      const bad=task.status==='FAILED'||task.status==='UNKNOWN';
      const title=task.status==='UNKNOWN'?'Submission needs checking':bad?'Generation couldn’t finish':task.status==='SUBMITTING'?'Sending to the model':task.status==='IN_PROGRESS'?'Bringing your idea to life':'Waiting for the model';
      const detail=task.error||task.notice||(task.status==='IN_QUEUE'&&Number.isInteger(task.queuePosition)?`Queue position: ${task.queuePosition}. You can keep this tab open or come back later.`:'Your generation continues while this local app is running.');
      return `<article class="media-card task-placeholder ${bad?'error-state':''}" role="status">${bad?`<button type="button" class="delete-generation delete-failed-generation" data-delete-failed="${task.taskIndex??index}" aria-label="Delete ${task.status==='FAILED'?'failed generation':'uncertain submission'}" title="Delete this generation">${icon('trash')}</button>${icon('orbit')}`:'<span class="spinner"></span>'}<strong>${esc(title)}</strong><p>${esc(detail)}</p>${task.requestId?`<small class="muted">Request: ${esc(task.requestId)}</small>`:''}${bad?`<a class="text-button" href="${job.provider==='comfy'?'https://platform.comfy.org':'https://Comfy Router/dashboard/requests'}" target="_blank" rel="noopener noreferrer">${job.provider==='comfy'?'Open Comfy platform':'Open fal dashboard'} ↗</a>`:''}</article>`;
    }).join('');
    const time=new Date(job.createdAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const duration=job.settings.duration+(Number.isFinite(Number(job.settings.duration))?'s':'');
    return `<section class="job" data-job="${job.id}"><div class="job-top"><div><p class="job-prompt">${esc(generationTitle(job))}</p><div class="job-meta">${esc(job.modelName)}${job.mode==='audio'?' &nbsp;·&nbsp; '+esc(job.settings.options?.output_format||'WAV'):' &nbsp;·&nbsp; '+esc(job.settings.ratio)+' &nbsp;·&nbsp; '+esc(job.settings.resolution)}${job.mode==='video'?' &nbsp;·&nbsp; '+esc(duration):''} &nbsp;·&nbsp; ${esc(time)}</div></div><div class="job-tools"><button class="text-button" data-reuse="${job.id}" title="Copy these settings into the composer">${icon('repeat')}Reuse settings</button>${["image","video"].includes(job.mode)&&!job.settings.tool?`<button type="button" class="text-button" data-regenerate="${job.id}" title="Generate again with the original settings and inputs">${icon("spark")}${job.settings.workflow==='creator'?'Regenerate 6 views':'Regenerate'}</button>`:""}</div></div><div class="media-grid ${job.tasks.flatMap(t=>t.outputs||[]).filter(m=>!favoriteView||m.favorite).length===1?'single':''}">${cards}</div>${job.tasks.some(t=>t.status==='COMPLETED')?'<p class="job-note">'+(mediaStorage.automatic?'Media saves automatically to your save folder.':'Unsaved media previews online. Use Keep on this computer to retain a copy.')+' Drag a result into the composer, or star it for Favorites.</p>':''}</section>`;
  }).join('');
  updateDownloadSelection();
  // A failed remote media load should not leave a silent blank tile.
  $$('#results img,#results video,#results audio').forEach(el=>el.addEventListener('error',()=>{if(el.parentElement.querySelector('.expired-note'))return;const note=document.createElement('p');note.className='job-note expired-note';note.textContent='Preview unavailable. The provider link may have expired. Check the request in its provider dashboard.';el.parentElement.append(note);},{once:true}));
}
const mediaNameDialog=document.createElement('dialog');
mediaNameDialog.innerHTML='<form id="media-name-form"><div class="dialog-heading"><h2>Name this result</h2></div><div class="field"><label for="media-name-input">Name</label><input id="media-name-input" maxlength="180" required placeholder="e.g. Marlene · Party look"></div><p class="hint">Used in the feed, cards and Asset Library.</p><p id="media-name-error" role="alert"></p><div class="dialog-actions"><button type="button" id="media-name-cancel" class="secondary">Cancel</button><button type="submit" id="media-name-save" class="primary">Save name</button></div></form>';
document.body.append(mediaNameDialog);
let namingMedia=null;
$('#media-name-cancel').onclick=()=>mediaNameDialog.close();
$('#media-name-form').onsubmit=async e=>{e.preventDefault();if(!namingMedia)return;const target={...namingMedia},button=$('#media-name-save');button.disabled=true;try{const result=await post('/api/media/rename',{...target,name:$('#media-name-input').value.trim()});const existing=state.jobs.find(j=>j.id===target.jobId);if(existing)Object.assign(existing,result.job);state.libraryVersion++;state.historySignature='';renderJobs();mediaNameDialog.close();toast('Name saved.');}catch(err){$('#media-name-error').textContent=err.message;}finally{button.disabled=false;}};
const mediaTagOptions=['sexy','casual','business','fitness','chic','cute'];
const mediaTagsDialog=document.createElement('dialog');
mediaTagsDialog.innerHTML=`<form id="media-tags-form"><h2>Style tags</h2><p>Choose one or more tags to find this result in Assets.</p><div class="media-tag-options">${mediaTagOptions.map(tag=>`<label><input type="checkbox" name="tag" value="${tag}"> ${tag[0].toUpperCase()+tag.slice(1)}</label>`).join('')}</div><p id="media-tags-error" role="alert"></p><div class="dialog-actions"><button type="button" id="media-tags-cancel" class="secondary">Cancel</button><button type="submit" id="media-tags-save" class="primary">Save tags</button></div></form>`;
document.body.append(mediaTagsDialog);let taggingMedia=null;
$('#media-tags-cancel').onclick=()=>mediaTagsDialog.close();
$('#media-tags-form').onsubmit=async e=>{e.preventDefault();if(!taggingMedia)return;const button=$('#media-tags-save');button.disabled=true;try{const tags=[...mediaTagsDialog.querySelectorAll('input:checked')].map(input=>input.value);const result=await post('/api/media/tags',{...taggingMedia,tags});const existing=state.jobs.find(j=>j.id===taggingMedia.jobId);if(existing)Object.assign(existing,result.job);state.libraryVersion++;state.historySignature='';renderJobs();mediaTagsDialog.close();toast('Tags saved.');}catch(err){$('#media-tags-error').textContent=err.message;}finally{button.disabled=false;}};
$('#results').addEventListener('click',async e=>{
 const tagButton=e.target.closest('[data-tag-media]');if(tagButton){const card=tagButton.closest('[data-media]');taggingMedia={jobId:card.dataset.job,mediaId:card.dataset.media};const {media}=findResult(taggingMedia.jobId,taggingMedia.mediaId);for(const input of mediaTagsDialog.querySelectorAll('input'))input.checked=(media.tags||[]).includes(input.value);$('#media-tags-error').textContent='';mediaTagsDialog.showModal();return;}

  const renameButton=e.target.closest('[data-rename-media]');if(renameButton){const card=renameButton.closest('[data-media]');namingMedia={jobId:card.dataset.job,mediaId:card.dataset.media};const {media}=findResult(namingMedia.jobId,namingMedia.mediaId);$('#media-name-input').value=media.name||'';$('#media-name-error').textContent='';mediaNameDialog.showModal();$('#media-name-input').focus();return;}

  const deleteButton=e.target.closest('[data-delete-generation],[data-delete-failed]');if(deleteButton){const card=deleteButton.closest('[data-job]'),target=deleteButton.hasAttribute('data-delete-failed')?{taskIndex:Number(deleteButton.dataset.deleteFailed)}:{mediaId:card.dataset.media};deleteButton.disabled=true;try{await deleteGeneration(card.dataset.job,target);}finally{deleteButton.disabled=false;}return;}
  const assetButton=e.target.closest('[data-save-asset]');if(assetButton){const card=assetButton.closest('[data-media]');assetButton.disabled=true;try{await saveAsset(card.dataset.job,card.dataset.media);}finally{assetButton.disabled=false;}return;}
  const saveButton=e.target.closest('[data-save-media]');
  if(saveButton){
    const card=saveButton.closest('[data-media]');saveButton.disabled=true;saveButton.textContent='Saving…';
    try{await post('/api/archive',{jobId:card.dataset.job,mediaId:card.dataset.media});const {media}=findResult(card.dataset.job,card.dataset.media);media.savedLocally=true;delete media.storageError;state.libraryVersion++;renderJobs();toast('Saved on this computer.');}
    catch(e){toast(e.message);saveButton.disabled=false;saveButton.textContent='Retry saving';}return;
  }
  const addToCanvas=e.target.closest('[data-canvas]');if(addToCanvas){const card=addToCanvas.closest('[data-media]');setView('ideation');await canvas.addMedia(card.dataset.job,card.dataset.media);return;}
  const card=e.target.closest('[data-media]'),reference=e.target.closest('[data-reference]'),favorite=e.target.closest('[data-favorite]');
  if(reference&&card){await useReference(card.dataset.job,card.dataset.media);return;}
  if(favorite&&card){favorite.disabled=true;try{const {media}=findResult(card.dataset.job,card.dataset.media);await favoriteResult(card.dataset.job,card.dataset.media,!media.favorite);}finally{favorite.disabled=false;}return;}
  const regenerate=e.target.closest('[data-regenerate]');
  if(regenerate){if(await reuseSettings(regenerate.dataset.regenerate)){if(state.view==='creator')void creator.generate();else{setView('studio');$('#generate-form').requestSubmit();}}return;}
  const reuse=e.target.closest('[data-reuse]');
  if(reuse){await reuseSettings(reuse.dataset.reuse);return;}
  const preview=e.target.closest('[data-preview]');if(!preview)return;
  const {job,media}=findResult(preview.dataset.preview,preview.dataset.mediaId);
  previewResult(job,media);
});
const previewGallery=new libraryDates.PreviewGallery(),previewPending=new Set();let previewSession=0;
const previewPrompt=new libraryDates.MediaPromptDetails($('#preview-caption'),{id:'preview'});
function previewEntry(job,media){return {key:job.id+':'+media.id,url:mediaURL(job,media),downloadURL:mediaURL(job,media,true),title:generationTitle(job),prompt:job.settings.prompt,contentType:media.contentType,job,media};}
function assetPreviewEntry(asset){return {key:'asset:'+asset.id,url:'/api/assets/media?id='+encodeURIComponent(asset.id),downloadURL:'/api/assets/media?id='+encodeURIComponent(asset.id)+'&download=1',...libraryDates.mediaPresentation({asset,job:state.jobs.find(j=>(asset.sources||[]).some(s=>s.jobId===j.id))}),contentType:asset.contentType,asset};}
async function resolveMediaPresentation(source){
  let asset=source.asset,job=source.job||state.jobs.find(j=>j.id===source.jobId);
  try{
    if(source.assetId&&!asset)asset=(await api('/api/assets')).assets.find(a=>a.id===source.assetId);
    const origins=asset?.sources?.filter(s=>s.type==='generated')||[];
    job ||= state.jobs.find(j=>origins.some(s=>s.jobId===j.id));
    const origin=origins[0]||(source.jobId?source:null);
    if(!job&&origin?.projectId&&origin.jobId)job=(await api('/api/jobs?project='+encodeURIComponent(origin.projectId))).jobs.find(j=>j.id===origin.jobId);
  }catch{/* Keep viewing available media even when its source history is unavailable. */}
  return libraryDates.mediaPresentation({...source,asset,job});
}
function previewSource(entry){
  if(entry.job){try{return findResult(entry.job.id,entry.media.id);}catch{return {job:entry.job,media:entry.media};}}
  for(const source of entry.asset?.sources||[])if(source.type==='generated'){try{return findResult(source.jobId,source.mediaId);}catch{}}
  return null;
}
function previewResult(job,media,collection){
  if(media.contentType?.startsWith('video/'))$$('#results video').forEach(video=>video.pause());
  const items=collection||visibleDownloadItems.flatMap(({jobId,mediaId})=>{try{return [findResult(jobId,mediaId)];}catch{return [];}});
  const selected=previewEntry(job,media),kind=media.contentType?.split('/')[0],entries=items.filter(i=>!i.media.deleted&&!i.media.deletedAt&&i.media.contentType?.startsWith(kind+'/')).map(i=>previewEntry(i.job,i.media));
  openPreview(entries,selected);
}
function openPreview(items,selected){
  previewSession++;$('#preview-notice').hidden=true;previewGallery.open(items,selected);renderPreview();$('#preview-dialog').showModal();$('#close-preview').focus();
}
function renderPreview(){
  const entry=previewGallery.current;if(!entry){if($('#preview-dialog').open)$('#preview-dialog').close();return;}
  $('#preview-media video')?.pause();const video=entry.contentType?.startsWith('video/'),media=document.createElement(video?'video':'img');media.src=entry.url;
  const kind=video?'video':'image';$('#preview-dialog').setAttribute('aria-label',video?'Video preview':'Image preview');for(const [id,direction] of [['#preview-previous','Previous'],['#preview-next','Next']]){$(id).setAttribute('aria-label',direction+' '+kind);$(id).title=direction+' '+kind+(direction==='Previous'?' (←)':' (→)');}
  if(video){media.controls=true;media.playsInline=true;media.preload='metadata';media.setAttribute('aria-label',entry.title||'Video preview');}else media.alt=entry.title||'Image preview';
  $('#preview-media').replaceChildren(media);previewPrompt.set(entry);
  if(entry.asset&&!entry.promptResolved){
    entry.promptResolved=true;const session=previewSession;
    void resolveMediaPresentation(entry).then(details=>{Object.assign(entry,details);if(session===previewSession&&previewGallery.current===entry){previewPrompt.set(entry,{preserveOpen:true});if(video)media.setAttribute('aria-label',entry.title);else media.alt=entry.title;}});
  }
  const multiple=previewGallery.items.length>1;for(const id of ['#preview-previous','#preview-next'])$(id).hidden=!multiple;
  $('#preview-position').textContent=multiple?`${previewGallery.index+1} / ${previewGallery.items.length}`:'';renderPreviewActions();
}
function renderPreviewActions(){
  const entry=previewGallery.current;if(!entry)return;const source=previewSource(entry),pending=previewPending.has(entry.key),favorite=!!source?.media.favorite;
  const favoriteButton=$('#preview-favorite');favoriteButton.hidden=!source;favoriteButton.disabled=pending;favoriteButton.setAttribute('aria-pressed',String(favorite));favoriteButton.lastElementChild.textContent=favorite?'Remove from Favorites':'Add to Favorites';
  const saved=!!entry.asset&&!entry.asset.deletedAt||!!entry.savedAsset,saveButton=$('#preview-save-asset');saveButton.disabled=pending||saved;saveButton.lastElementChild.textContent=saved?'In Assets':entry.asset?.deletedAt?'Restore to Assets':'Add to Assets';
  $('#preview-download').href=entry.downloadURL;$('#preview-delete').disabled=pending||!!entry.asset?.deletedAt;$('#preview-delete').title=entry.asset?'Move this asset to Trash':'Delete this generation';
}
async function changePreviewDeletion(entry,restore=false){
  if(entry.asset){
    const {asset}=await post('/api/assets/'+(restore?'restore':'remove'),{id:entry.asset.id});entry.asset=asset;
    if(assetLibrary){assetLibrary.version++;await assetLibrary.refresh();}
  }else await deleteGeneration(entry.job.id,{mediaId:entry.media.id},entry.job.projectId,restore,true);
}
async function previewAction(action){
  const entry=previewGallery.current;if(!entry||previewPending.has(entry.key))return;
  const session=previewSession,index=previewGallery.index,source=previewSource(entry),shootKey=source?source.job.id+':'+source.media.id:null;
  previewPending.add(entry.key);state.uploading++;updateButton();renderPreviewActions();
  if(shootKey&&shoot?.projectId===source.job.projectId){shoot.resultPending.add(shootKey);shoot.resultVersion++;shoot.renderResults();}
  try{
    if(action==='favorite'&&source){
      const result=await favoriteResult(source.job.id,source.media.id,!source.media.favorite,source);
      if(result){entry.media&&(entry.media.favorite=result.favorite);if(shoot?.projectId===source.job.projectId)shoot.syncResultJob(source.job.id,source.job);}
    }else if(action==='asset'){
      if(entry.asset?.deletedAt){await changePreviewDeletion(entry,true);toast('Restored to Asset Library.');}
      else if(!entry.asset&&source){const saved=await saveAsset(source.job.id,source.media.id,source);if(saved)entry.savedAsset=saved.asset;}
    }else if(action==='delete'){
      await changePreviewDeletion(entry);
      if(session===previewSession){previewGallery.remove(entry.key);renderPreview();}
      toast(entry.asset?'Asset moved to Trash.':'Generation deleted.',async()=>{
        try{await changePreviewDeletion(entry,true);if(session===previewSession&&$('#preview-dialog').open){previewGallery.restore(entry,index);renderPreview();$('#close-preview').focus();}toast('Restored.');}
        catch(error){toast(error.message);}
      });
    }
  }catch(error){toast(error.message);}
  finally{
    previewPending.delete(entry.key);state.uploading--;updateButton();
    if(shootKey&&shoot?.projectId===source.job.projectId){shoot.resultPending.delete(shootKey);shoot.resultVersion++;shoot.renderResults();}
    if($('#preview-dialog').open){
      renderPreviewActions();
      if(session===previewSession&&document.activeElement===document.body){
        const focus=action==='favorite'?'#preview-favorite':action==='asset'?'#preview-download':$('#preview-next').hidden?'#close-preview':'#preview-next';$(focus).focus();
      }
    }
  }
}
for(const [id,action] of [['preview-favorite','favorite'],['preview-save-asset','asset'],['preview-delete','delete']])$('#'+id).addEventListener('click',()=>void previewAction(action));
function movePreview(step){previewGallery.move(step);renderPreview();}
$('#preview-previous').addEventListener('click',()=>movePreview(-1));$('#preview-next').addEventListener('click',()=>movePreview(1));
$('#preview-dialog').addEventListener('keydown',event=>{
  const step=libraryDates.previewArrowStep(event);if(!step||previewGallery.items.length<2)return;
  event.preventDefault();movePreview(step);
});
$('#close-preview').addEventListener('click',()=>$('#preview-dialog').close());
$('#preview-dialog').addEventListener('close',()=>{previewSession++;$('#preview-media video')?.pause();previewGallery.clear();$('#preview-media').replaceChildren();previewPrompt.set({});$('#preview-notice').hidden=true;});
async function poll(restoreLibrary=false){
  const version=state.libraryVersion,projectId=state.projectId;
  try{const r=await api('/api/jobs'+(state.features.projects?'?project='+encodeURIComponent(projectId):''));
    if(projectId===state.projectId&&!state.switching){state.activeProjectIds=r.activeProjectIds||[];if(!state.dragging&&!state.favoritePending.size&&!state.deletionPending.size&&version===state.libraryVersion){state.jobs=r.jobs;
      if(restoreLibrary){let saved;try{saved=localStorage.getItem('fwrd-view:'+projectId)||(projectId==='default'?localStorage.getItem('fwrd-view'):null);}catch{}setView(['studio','ideation','favorites','history','projects','llm','shoot','outfit','reference','product','environment','creator','assets','tools','audio','color','effects'].includes(saved)?saved:'studio');}else renderJobs();
      if(state.features.ideation&&state.view==='ideation')await canvas.refresh(state.jobs);if(state.view==='projects')await refreshProjects();}updateButton();}
  }catch(e){if(state.features.projectDeletion&&!state.projectMutation){await refreshProjects();if(projectId!==state.projectId)return;}$('#workspace-status').textContent='Local server disconnected';}finally{setTimeout(poll,3000);}
}
const canvas=new IdeationCanvas({api,post,downloadBatch,findResult,mediaURL,icon,toast,reuseSettings,saveAsset,useAsset:async(asset,url)=>{assetReturnView='ideation';await useAsset(asset,url);},assetsEnabled:()=>!!state.features.assetLibrary,favorite:favoriteResult,useReference:async(jobId,mediaId)=>{await useReference(jobId,mediaId);if(innerWidth<800)document.body.classList.add('mobile-controls');else document.body.classList.remove('controls-hidden');},showHistory:showAllGenerations});
$('#canvas-controls').addEventListener('click',()=>{document.body.classList.toggle(innerWidth<800?'mobile-controls':'controls-hidden');$('#canvas-controls').setAttribute('aria-pressed',String(document.body.classList.contains('controls-hidden')||document.body.classList.contains('mobile-controls')));});
let canvasLibrary=null;
async function openCanvasLibrary(){
  if(!state.features.canvasAssets){toast('Open Apply Studio Update.command, then refresh to add uploads, Assets and Favorites to your canvas.');return;}
  try{
    if(!canvasLibrary){const {CanvasLibrary}=await import('./canvas-library.js?v=canvas-assets');canvasLibrary=new CanvasLibrary({api,toast,canvas,mediaURL,fileInfo,metadata,context:()=>({projectId:state.projectId,jobs:state.jobs,projects:[...state.projects,...state.deletedProjects],enabled:!!state.features.canvasAssets}),busy:value=>{state.uploading+=value?1:-1;updateButton();}});}
    await canvasLibrary.open();
  }catch(error){toast(error.message);}
}
$('#canvas-library-open').addEventListener('click',openCanvasLibrary);$('#canvas-empty-library').addEventListener('click',openCanvasLibrary);
function composerSettings(){return {model:state.model,mode:state.mode,inputType:state.inputType,ratio:state.ratio,prompt:$('#prompt').value,resolution:$('#resolution').value,count:Number($('#count').value),duration:$('#duration').value,audio:$('#audio').checked,quality:$('#quality').value,creativity:$('#creativity').value,thinking:$('#thinking').value,frameIndices:state.references.some(r=>r.kind==='image')?state.references.filter(r=>r.kind==='image').map(r=>r.frameIndex):state.reusedFrameIndices};}
function applyComposer(settings){
  state.mode=settings.mode;state.model=settings.model;state.inputType=settings.inputType;state.ratio=settings.ratio;state.reusedFrameIndices=settings.inputType==='keyframes'&&Array.isArray(settings.frameIndices)?settings.frameIndices.slice():[];
  $$('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===state.mode);b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode));});
  syncControls();for(const key of ['resolution','count','duration','quality','creativity','thinking']){const input=$('#'+key);if([...input.options].some(o=>o.value===String(settings[key])))input.value=String(settings[key]);}
  $('#prompt').value=settings.prompt||'';$('#audio').checked=!!settings.audio;renderReferences();updateModelNote();updatePromptCount();updateButton();
}
function revealComposer(){document.body.classList.remove('controls-hidden');$('#canvas-controls').setAttribute('aria-pressed','false');if(innerWidth<800&&state.view==='ideation')document.body.classList.add('mobile-controls');$('.composer').scrollTop=0;}
async function reuseSettings(jobId){
  if(state.enhancing||state.submitting||state.uploading||state.switching){toast('Wait for reference preparation to finish.');return;}
  const job=state.jobs.find(j=>j.id===jobId);if(!job)return;
  if(job.settings.workflow==='creator'){setView('creator');try{await creator.reuse(job);revealComposer();return true;}catch(e){toast(e.message);return false;}}
  if(job.mode==='audio'){if(!audioWorkspace){toast('Open Apply Studio Update.command, then refresh to activate Audio.');return;}setView('audio');audioWorkspace.reuse(job);revealComposer();return;}
  if(job.settings.tool){if(!mediaTools){toast('Open Apply Studio Update.command, then refresh to activate Tools.');return;}setView('tools');mediaTools.reuse(job);revealComposer();return;}
  if(['favorites','outfit'].includes(state.view))setView('studio');
  const restored=reusableSettings(job);
  if(!restored.settings){$('#prompt').value=job.settings.prompt;updatePromptCount();revealComposer();toast(restored.warnings[0]+' Its prompt has been copied.');return;}
  state.uploading++;updateButton();
  try{
    const files=[];
    for(const [index,ref] of (job.settings.references||[]).entries()){
      const response=await fetch('/api/generation-reference?job='+encodeURIComponent(job.id)+'&index='+index);
      if(!response.ok)throw Error('An original input is unavailable. Reattach the original file before regenerating.');
      files.push(new File([await response.blob()],ref.name||'Reference',{type:ref.contentType}));
    }
    await clearReferences();applyComposer(restored.settings);error('');revealComposer();$('#prompt').focus();
    if(files.length&&!await addFiles(files,{locked:true}))return false;
    if(state.inputType!=='text'&&!files.length){toast('Settings restored. This older generation did not record its input files; reattach the originals.');return false;}
    toast(restored.warnings.length?restored.warnings.join(' '):'Settings and original inputs restored.');
    return !restored.warnings.length;
  }catch(e){error(e.message);toast(e.message);return false;}
  finally{state.uploading--;updateButton();}
}
function renderProjects(){
  $('#projects-update-note').hidden=!!state.features.projects;
  const signature=JSON.stringify([state.projectId,state.projects,state.deletedProjects]);if(signature===state.projectsSignature)return;state.projectsSignature=signature;
  $('#project-select').replaceChildren(...state.projects.map(p=>new Option(p.name,p.id)));$('#project-select').value=state.projectId;
  $('#project-list').innerHTML=state.projects.map(p=>`<article class="project-card ${p.id===state.projectId?'current':''}" data-project="${esc(p.id)}"><div class="project-card-top"><span>${icon('folder')}</span><h2>${esc(p.name)}</h2><button class="project-rename" data-project-rename="${esc(p.id)}" aria-label="Rename ${esc(p.name)}">Rename</button><button type="button" class="project-delete" data-project-delete="${esc(p.id)}" aria-label="Delete ${esc(p.name)}" title="Delete project">${icon('trash')}</button></div><div class="project-counts">${p.images||0} image${p.images===1?'':'s'} · ${p.videos||0} video${p.videos===1?'':'s'}${p.audios?' · '+p.audios+' audio':''}<br>${p.generations||0} generation${p.generations===1?'':'s'} · ${p.favorites||0} favorite${p.favorites===1?'':'s'}</div><div class="project-card-actions"><button data-project-view="studio">Create</button><button data-project-view="audio">Audio</button><button data-project-view="favorites">Favorites</button></div><div class="project-current-marker">${p.id===state.projectId?'Current project':''}</div></article>`).join('');
  $('#deleted-projects').hidden=!state.deletedProjects.length;
  $('#deleted-projects-count').textContent=state.deletedProjects.length;
  $('#deleted-project-list').innerHTML=state.deletedProjects.map(p=>`<div class="deleted-project-row"><div><strong>${esc(p.name)}</strong><small>Deleted ${esc(new Date(p.deletedAt).toLocaleDateString())}</small></div><button type="button" class="secondary" data-project-restore="${esc(p.id)}" aria-label="Restore ${esc(p.name)}">Restore</button></div>`).join('');
}
async function refreshProjects(){if(!state.features.projects||state.projectMutation)return;const version=state.projectsVersion;try{const response=await api('/api/projects');if(version!==state.projectsVersion||state.projectMutation)return;state.projects=response.projects;state.deletedProjects=response.deletedProjects||[];if(!state.projects.some(p=>p.id===state.projectId))await switchProject(state.projects[0].id,'projects');renderProjects();}catch{}}
async function switchProject(projectId,view){
  if(storageBusy||state.projectMutation||state.enhancing||state.switching||state.uploading||state.submitting||state.llmBusy||state.favoritePending.size||state.deletionPending.size){$('#project-select').value=state.projectId;toast('Wait for the current change to finish.');return false;}
  if(!state.features.projects){toast('Open Apply Studio Update.command to activate projects.');return false;}
  if(projectId===state.projectId){if(view)setView(view);return true;}
  const prior=state.projectId;state.switching=true;$('main').inert=true;updateButton();
  try{
    const response=await api('/api/jobs?project='+encodeURIComponent(projectId));
    if(!await canvas.changeProject(projectId))return false;
    state.projectDrafts.set(prior,{settings:composerSettings(),references:state.references});
    downloadSelection.clear();state.projectId=projectId;mediaStorage=state.projects.find(p=>p.id===projectId)?.mediaStorage||{automatic:false};state.jobs=response.jobs;state.activeProjectIds=response.activeProjectIds||[];state.libraryVersion++;
    const draft=state.projectDrafts.get(projectId);state.references=draft?.references||[];
    applyComposer(draft?.settings||{model:'nano-pro',mode:'image',inputType:'text',ratio:'1:1',prompt:'',resolution:'1K',count:1,duration:'5',audio:false,quality:'high'});
    try{localStorage.setItem('fwrd-project',projectId);}catch{}
    let saved;try{saved=localStorage.getItem('fwrd-view:'+projectId);}catch{}setView(view||(['studio','ideation','favorites','history','llm','shoot','outfit','reference','product','environment','creator','assets','tools','audio','color','effects'].includes(saved)?saved:'studio'));
    renderMediaStorage(mediaStorage);void loadMediaStorage();renderProjects();error('');return true;
  }catch(e){toast(e.message);return false;}finally{state.switching=false;$('main').inert=false;$('#project-select').value=state.projectId;updateButton();}
}
function projectDialog(id){if(!state.features.projects){toast('Open Apply Studio Update.command to activate projects.');return;}state.editProject=id||null;newProjectFolderToken=null;$('#new-project-storage').hidden=!!id;$('#new-project-auto-save').checked=false;$('#new-project-folder-label').textContent='Default: this project’s own folder in the studio library.';$('#new-project-folder').hidden=!mediaStorage.folderPicker;$('#project-name').value=id?state.projects.find(p=>p.id===id).name:'';$('#project-dialog-title').textContent=id?'Rename project':'New project';$('#project-save').textContent=id?'Save name':'Create project';$('#project-error').hidden=true;$('#project-dialog').showModal();$('#project-name').focus();}
function deleteProjectDialog(id){
  if(!state.features.projectDeletion){toast('Open Apply Studio Update.command, then refresh to activate project deletion.');return;}
  const project=state.projects.find(p=>p.id===id);if(!project||state.projectMutation)return;
  state.deleteProjectId=id;$('#delete-project-name').textContent=project.name;$('#delete-project-error').hidden=true;$('#delete-project-dialog').showModal();$('#delete-project-cancel').focus();
}
async function changeProjectDeletion(id,restore=false){
  if(storageBusy||state.projectMutation||state.enhancing||state.switching||state.uploading||state.submitting||state.llmBusy||state.favoritePending.size||state.deletionPending.size)throw Error('Wait for the current change to finish.');
  state.projectMutation=true;state.projectsVersion++;
  try{
    if(!restore&&id===state.projectId&&!await canvas.savePending())throw Error('Save your canvas changes before deleting this project.');
    const response=await post('/api/projects',{type:restore?'restore':'delete',id});
    state.projects=response.projects;state.deletedProjects=response.deletedProjects||[];state.projectMutation=false;
    if(!restore&&id===state.projectId)await switchProject(state.projects[0].id,'projects');
    renderProjects();toast(restore?'Project restored.':'Project deleted. You can restore it under Deleted projects.');
  }finally{state.projectMutation=false;state.projectsVersion++;}
}
$('#delete-project-cancel').addEventListener('click',()=>$('#delete-project-dialog').close());
$('#delete-project-dialog').addEventListener('cancel',event=>{if(state.projectMutation)event.preventDefault();});
$('#delete-project-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#delete-project-confirm');button.disabled=true;$('#delete-project-cancel').disabled=true;$('#delete-project-error').hidden=true;
  try{await changeProjectDeletion(state.deleteProjectId);$('#delete-project-dialog').close();}catch(error){$('#delete-project-error').textContent=error.message;$('#delete-project-error').hidden=false;}finally{button.disabled=false;$('#delete-project-cancel').disabled=false;}
});
$('#deleted-project-list').addEventListener('click',async event=>{const button=event.target.closest('[data-project-restore]');if(!button)return;button.disabled=true;try{await changeProjectDeletion(button.dataset.projectRestore,true);}catch(error){toast(error.message);}finally{button.disabled=false;}});
$('#projects-nav').addEventListener('click',()=>setView('projects'));
$('#project-select').addEventListener('change',e=>switchProject(e.target.value));
$('#project-new').addEventListener('click',()=>projectDialog());$('#project-quick-new').addEventListener('click',()=>projectDialog());$('#project-dialog-close').addEventListener('click',()=>$('#project-dialog').close());
$('#project-list').addEventListener('click',e=>{const remove=e.target.closest('[data-project-delete]');if(remove){deleteProjectDialog(remove.dataset.projectDelete);return;}const rename=e.target.closest('[data-project-rename]');if(rename){projectDialog(rename.dataset.projectRename);return;}const view=e.target.closest('[data-project-view]');if(view)switchProject(view.closest('[data-project]').dataset.project,view.dataset.projectView);});
$('#project-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('#project-save');button.disabled=true;try{const r=await post('/api/projects',{type:state.editProject?'rename':'create',id:state.editProject||undefined,name:$('#project-name').value.trim(),mediaStorage:state.editProject?undefined:{automatic:$('#new-project-auto-save').checked,...(newProjectFolderToken?{folderToken:newProjectFolderToken}:{})}});state.projects=r.projects;state.deletedProjects=r.deletedProjects||[];state.projectsVersion++;$('#project-dialog').close();renderProjects();if(!state.editProject)await switchProject(r.project.id,'ideation');}catch(e){$('#project-error').hidden=false;$('#project-error').textContent=e.message;}finally{button.disabled=false;}});
syncControls();
try{
  const config=await api('/api/bootstrap');if(!config.features?.comfyRouter)throw Error('Open Apply Studio Update.command, then refresh to activate Comfy for image and video models.');state.csrf=config.csrf;state.keyConfigured=config.keyConfigured;state.serverModels=config.models;state.features=config.features||{};
  if(state.features.llm){
    const {LlmWorkspace}=await import('./llm.js?v=unified-upload-entry');const style=document.createElement('link');style.rel='stylesheet';style.href='/llm.css?v=reference-picker';document.head.append(style);
    llm=new LlmWorkspace({api,post,toast,icon,useShoot:job=>{if(!shoot){toast('Open Apply Studio Update.command, then refresh to activate SHOOT.');return;}setView('shoot');void shoot.importOutput(job);},projectName:id=>[...state.projects,...state.deletedProjects].find(p=>p.id===id)?.name||'Project',deletionEnabled:()=>!!state.features.llmDeletion,openAssets,concurrent:!!state.features.concurrentGenerations,connection:updateConnection,busy:value=>{state.llmBusy=value;updateButton();},usePrompt:(mode,text)=>{if(state.submitting||state.uploading){toast('Wait for reference preparation to finish.');return;}changeMode(mode);$('#prompt').value=text;updatePromptCount();revealComposer();$('#prompt').focus();toast('Text copied into your '+mode+' prompt. Review it, then generate when ready.');}});
  }
  creator=new CharacterCreator({api,post,icon,busy:value=>{state.uploading+=value?1:-1;updateButton();},submitted:job=>{state.libraryVersion++;state.jobs.unshift(job);state.historySignature='';renderJobs();}});
  referenceWorkspace=new ReferenceWorkspace({api,post,busy:value=>{state.uploading+=value?1:-1;updateButton();},submitted:job=>{state.libraryVersion++;state.jobs.unshift(job);state.historySignature='';renderJobs();}});
  outfit=new OutfitWorkspace({api,post,icon,project:()=>state.projectId,busy:value=>{state.uploading+=value?1:-1;updateButton();},submitted:job=>{state.libraryVersion++;state.jobs.unshift(job);state.historySignature='';renderJobs();}});
  if(state.features.shoot){
    const {ShootWorkspace}=await import('./shoot.js?v=product-refinement');const style=document.createElement('link');style.rel='stylesheet';style.href='/shoot.css';document.head.append(style);
    shoot=new ShootWorkspace({api,post,toast,icon,subjectTypesEnabled:()=>!!state.features.shootSubjectTypes,favorite:favoriteResult,saveAsset,deleteResult:(jobId,mediaId,projectId)=>deleteGeneration(jobId,{mediaId},projectId),deleteFailedResult:(jobId,taskIndex,projectId)=>deleteGeneration(jobId,{taskIndex},projectId),deleteResults:deleteGenerations,assetsEnabled:()=>!!state.features.assetLibrary,preview:previewResult,projectName:id=>[...state.projects,...state.deletedProjects].find(p=>p.id===id)?.name||'Project',connect:showConnection,connectLlm:()=>llm?.openSettings(),context:()=>({keyConfigured:state.keyConfigured}),busy:value=>{state.uploading+=value?1:-1;updateButton();},submitted:job=>{state.libraryVersion++;state.jobs=state.jobs.filter(j=>j.id!==job.id);state.jobs.unshift(job);state.historySignature='';renderJobs();}});
  }
  if(state.features.assetLibrary){
    const {AssetLibrary}=await import('./assets.js?v=asset-removal');const style=document.createElement('link');style.rel='stylesheet';style.href='/assets.css?v=asset-removal';document.head.append(style);
    assetLibrary=new AssetLibrary({api,post,toast,icon,downloadBatch,metadata,fileInfo,context:()=>({projectId:state.projectId,projects:state.projects,deletedProjects:state.deletedProjects,assetRemoval:!!state.features.assetRemoval,videoAssets:!!state.features.videoAssets}),busy:value=>{state.uploading+=value?1:-1;updateButton();},use:useAsset,preview:(asset,url,collection=[])=>{const kind=asset.contentType.split('/')[0];openPreview(collection.filter(a=>a.contentType.startsWith(kind+'/')).map(assetPreviewEntry),{...assetPreviewEntry(asset),url});}});
  }
  if(state.features.promptEnhancer){
    const {PromptEnhancer}=await import('./prompt-enhancer.js');
    promptEnhancer=new PromptEnhancer({api,post,context:()=>({projectId:state.projectId,mode:state.mode,model:state.model,inputType:state.inputType,view:state.view}),busy:value=>{state.enhancing=value;updateButton();},setPrompt:text=>{$('#prompt').value=text;updatePromptCount();error('');},openSettings:()=>llm?.openSettings()});
  }else $('#enhance-toggle').addEventListener('click',()=>toast('Open Apply Studio Update.command once, then refresh to activate the prompt enhancer.'));
  if(config.mediaStorage)mediaStorage=config.mediaStorage;
  state.projects=config.projects||[{id:'default',name:'My first project'}];state.deletedProjects=config.deletedProjects||[];let savedProject;try{savedProject=localStorage.getItem('fwrd-project');}catch{}
  state.projectId=state.features.projects&&state.projects.some(p=>p.id===savedProject)?savedProject:state.projects[0].id;
  canvas.configure(!!state.features.ideation,{projects:!!state.features.projects,groups:!!state.features.canvasGroups});if(state.features.projects)await canvas.changeProject(state.projectId);
  mediaStorage=state.projects.find(p=>p.id===state.projectId)?.mediaStorage||mediaStorage;
  state.ready=true;renderMediaStorage(mediaStorage);renderProjects();updateConnection();syncControls();poll(true);
}catch(e){error(e.message);}

$('#prompt').addEventListener('input',updateCost);

function showReferenceSheet(){
 const type=['product','environment'].includes(state.view)?state.view:'character';
 $('#reference-sheet-type').value=type;referenceWorkspace?.show(state.projectId,type);
 $('#reference-sheet-title').textContent=type[0].toUpperCase()+type.slice(1)+' sheets';
 $('#reference-sheet-empty-title').textContent='Your '+type+' references will live here.';
}
$('#reference-sheet-type').addEventListener('change',()=>{try{localStorage.setItem('fwrd-reference-type:'+state.projectId,$('#reference-sheet-type').value);}catch{}showReferenceSheet();state.historySignature='';renderJobs();});

registerFileDrop('#reference-library',()=>referenceBusy()||!referenceLibraryRemaining()?null:document.querySelector(referenceLibrary.input));
installFileDrops(toast);
