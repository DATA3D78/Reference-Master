export function assetCollection(asset){
 const sources=asset.sources||[];
 return asset.category==='character'||sources.some(s=>s.category==='character')?'character':asset.category==='id'||sources.some(s=>s.category==='id')?'id':asset.category==='outfit'||sources.some(s=>s.category==='outfit')?'outfit':'assets';
}
export const collectionLabel=collection=>({assets:'Assets',character:'Character',outfit:'Outfit',id:'ID',favorites:'Favorites',generations:'Generations'}[collection]||collection);
// Keep the complete prompt separate from short, human-readable media titles.
export function mediaPresentation({job,asset,name='',title='',prompt,jobId,contentType='image/png'}={}){
  const label=String(asset?.name||name||'').trim();
  const structured=/^(?:```(?:json)?\s*)?[{[]/.test(label);
  const fullPrompt=typeof job?.settings?.prompt==='string'?job.settings.prompt:typeof prompt==='string'?prompt:(jobId||structured?label:'');
  const kind=(asset?.contentType||job?.mode||contentType).split('/')[0];
  const short=value=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length>96?text.slice(0,93).trimEnd()+'…':text;};
  const display=asset&&label&&!structured?short(label):job?generationTitle(job):title?short(title):fullPrompt?generationTitle({settings:{prompt:fullPrompt},mode:kind}):short(label)||'Untitled '+kind;
  return {title:display,prompt:fullPrompt};
}

// Shared by the image/video popup and the Color Grading / Effects source panel.
export class MediaPromptDetails{
  constructor(element,{id}){
    this.element=element;this.version=0;element.classList.add('media-prompt-details');
    element.innerHTML=`<div class="media-prompt-heading"><h3 id="${id}-title"></h3><div class="media-prompt-buttons" role="group" aria-label="Prompt actions" hidden><button type="button" class="secondary" id="${id}-show-prompt" aria-expanded="false" aria-controls="${id}-prompt">Show prompt</button><button type="button" class="secondary" id="${id}-copy-prompt">Copy prompt</button></div></div><pre id="${id}-prompt" class="media-prompt-text" tabindex="0" aria-label="Generation prompt" hidden></pre><p class="media-prompt-copy-status" role="status" hidden></p>`;
    this.title=element.querySelector('h3');this.buttons=element.querySelector('.media-prompt-buttons');this.toggle=element.querySelector('[aria-expanded]');this.copyButton=element.querySelector('#'+id+'-copy-prompt');this.panel=element.querySelector('pre');this.status=element.querySelector('[role="status"]');
    this.toggle.onclick=()=>this.show(this.panel.hidden);
    this.copyButton.onclick=()=>void this.copy();
  }
  set({title='',prompt=''}={}, {preserveOpen=false}={}){
    const wasOpen=!this.panel.hidden;this.version++;this.prompt=typeof prompt==='string'?prompt:'';
    this.title.textContent=title;this.panel.textContent=this.prompt;this.panel.scrollTop=0;
    this.buttons.hidden=!this.prompt.trim();this.status.hidden=true;this.copyButton.textContent='Copy prompt';
    this.show(preserveOpen&&wasOpen&&!this.buttons.hidden);
  }
  show(open){this.panel.hidden=!open;this.toggle.textContent=open?'Hide prompt':'Show prompt';this.toggle.setAttribute('aria-expanded',String(open));}
  async copy(){
    const version=this.version,text=this.prompt;if(!text.trim())return;
    try{await navigator.clipboard.writeText(text);if(version!==this.version)return;this.copyButton.textContent='Copied';this.status.textContent='Prompt copied.';this.status.hidden=false;}
    catch{if(version!==this.version)return;this.show(true);this.panel.focus();this.status.textContent='Select the prompt and press ⌘C or Ctrl+C to copy it.';this.status.hidden=false;}
  }
}

// Calendar ranges use local time; Monday is the first day of the week.
export function historyRange(period,now=new Date()){
  if(!['day','week','month'].includes(period))return null;
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=new Date(start);
  if(period==='day')end.setDate(end.getDate()+1);
  if(period==='week'){start.setDate(start.getDate()-(start.getDay()+6)%7);end.setTime(start.getTime());end.setDate(end.getDate()+7);}
  if(period==='month'){start.setDate(1);end.setTime(start.getTime());end.setMonth(end.getMonth()+1);}
  return {start,end};
}
export function inHistoryPeriod(createdAt,period,now=new Date()){
  const range=historyRange(period,now);if(!range)return true;
  const time=new Date(createdAt).getTime();return time>=range.start.getTime()&&time<range.end.getTime();
}

// Display names only: saved files keep their stable IDs on disk.
export function downloadNamePart(value,fallback='Project',maxBytes=100){
  const clean=String(value??'').normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|\uD800-\uDFFF]/gu,'-').replace(/\s+/g,' ').replace(/^\.+|[. ]+$/g,'').trim();
  let result='',bytes=0;const encoder=new TextEncoder();
  for(const char of clean){const size=encoder.encode(char).length;if(bytes+size>maxBytes)break;result+=char;bytes+=size;}
  return result.trim().replace(/[. ]+$/,'')||fallback;
}
export function projectDownloadName(projectName,suffix,extension){
  return `${downloadNamePart(projectName)}-${downloadNamePart(suffix,'asset')}.${String(extension).replace(/[^a-z0-9]/gi,'')||'bin'}`;
}
export function assetDownloadName(projectName,asset){
  const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'})[asset.contentType]||'bin';
  return projectDownloadName(projectName,String(asset.name||'asset').replace(/\.(png|jpe?g|webp|mp4|mov|webm)$/i,''),extension);
}
export function downloadDisposition(name,attachment=true){
  const ascii=name.replace(/[^\x20-\x7e]|["\\]/g,'_');
  const encoded=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return `${attachment?'attachment':'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function referencePickerCapacity(limits,references,kind,serverTotal=limits.total){
  return Math.max(0,Math.min((limits[kind]||0)-references.filter(r=>r.kind===kind).length,limits.total-references.length,serverTotal-references.length));
}
export function referenceLibrarySources({assets,jobs,projectId,kind,maxMB,contentTypes}){
  const types=contentTypes||({image:['image/png','image/jpeg','image/webp'],video:['video/mp4','video/quicktime'],audio:['audio/mpeg','audio/wav']})[kind]||[];
  const sources=assets.map(asset=>({key:'asset:'+asset.id,url:'/api/assets/media?id='+encodeURIComponent(asset.id),name:asset.name,contentType:asset.contentType,bytes:asset.bytes,collection:assetCollection(asset),label:collectionLabel(assetCollection(asset))}));
  for(const job of jobs.filter(j=>j.projectId===projectId&&!j.deletedAt))for(const task of job.tasks||[]){
    if(task.status!=='COMPLETED'||task.deletedAt)continue;
    for(const media of task.outputs||[]){
      if(!media.favorite||media.deletedAt||media.deleted)continue;
      let name=job.settings?.prompt||job.modelName||'Favorite';try{const parsed=JSON.parse(name);name=parsed.title||parsed.scene_description||name;}catch{}
      sources.push({key:'favorite:'+job.id+':'+media.id,url:'/api/media?job='+encodeURIComponent(job.id)+'&media='+encodeURIComponent(media.id),name:String(name).slice(0,180),contentType:media.contentType,bytes:media.local?.bytes,collection:'favorites',label:job.modelName||'Favorite'});
    }
  }
  return sources.filter(source=>types.includes(source.contentType)).map(source=>({...source,disabled:source.bytes>maxMB*1024**2,reason:source.bytes>maxMB*1024**2?`Exceeds ${maxMB} MB limit`:''}));
}

// Each preview keeps the ordering and filtering of the collection it was opened from.
export class PreviewGallery {
  constructor(){this.clear();}
  clear(){this.items=[];this.index=0;}
  get current(){return this.items[this.index];}
  open(items,selected){
    const unique=new Map(items.filter(item=>item?.key&&item.url).map(item=>[item.key,item]));
    if(!unique.has(selected.key))unique.set(selected.key,selected);
    this.items=[...unique.values()];this.index=this.items.findIndex(item=>item.key===selected.key);
    return this.current;
  }
  move(step){if(this.items.length)this.index=(this.index+step%this.items.length+this.items.length)%this.items.length;return this.current;}
  remove(key){
    const currentKey=this.current?.key,index=this.items.findIndex(item=>item.key===key);if(index<0)return this.current;
    this.items.splice(index,1);this.index=currentKey===key?Math.min(index,this.items.length-1):this.items.findIndex(item=>item.key===currentKey);
    this.index=Math.max(0,this.index);return this.current;
  }
  restore(item,index){
    if(this.items.some(entry=>entry.key===item.key))return this.current;
    const currentKey=this.current?.key;this.items.splice(Math.max(0,Math.min(index,this.items.length)),0,item);
    this.index=currentKey?this.items.findIndex(entry=>entry.key===currentKey):0;return this.current;
  }
}
export function previewArrowStep(event){
  if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.defaultPrevented||event.target?.isContentEditable||event.target?.closest?.('input,textarea,select,video,audio'))return 0;
  return event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0;
}

// SHOOT has its own image history; the Create tabs never include its batches.
export function generationFeed(jobs,mode,shootJobIds=[]){
  const known=new Set(shootJobIds);
  return jobs.filter(job=>{
    if(job.deletedAt)return false;
    const shoot=!!job.settings?.shootBatchId||known.has(job.id);
    return mode==='shoot'?job.mode==='image'&&shoot:job.mode===mode&&!shoot;
  });
}

// Keep batch mutations sequential and retain the exact successful subset for Undo.
export async function runSelectionBatch(items,operation){
  const succeeded=[],failed=[];
  for(const item of [...items]){
    try{await operation(item);succeeded.push(item);}
    catch(error){failed.push({item,error});}
  }
  return {succeeded,failed};
}

export function generationTitle(job){
  const prompt=String(job.settings?.prompt||'').trim();
  const source=prompt.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let title=source;
  if(/^[{[]/.test(source)){
    try{
      const details=JSON.parse(source);
      title=[details?.title,details?.name,details?.scene_description,details?.subject?.primary,details?.subject,details?.description,details?.prompt].find(value=>typeof value==='string'&&value.trim())||'';
    }catch{
      const quoted=source.match(/"(?:title|name)"\s*:\s*("(?:\\.|[^"\\])*")/);
      try{title=quoted?JSON.parse(quoted[1]):'';}catch{title='';}
    }
  }
  title=title.replace(/^(?:please\s+)?(?:generate|create|make|draw|render)\s+(?:(?:an?|the)\s+)?(?:(?:image|picture|photo|video)\s+of\s+)?/i,'')
    .replace(/^(?:an?|the)\s+/i,'').split(/[\n.!?;]|,\s/)[0].replace(/\s+/g,' ').trim();
  const words=title.split(' ').slice(0,8);
  while(words.length>1&&words.join(' ').length>64)words.pop();
  title=words.join(' ').slice(0,64).replace(/[\s,:–—-]+$/,'');
  return title?title.charAt(0).toUpperCase()+title.slice(1):job.mode==='audio'?'Untitled audio':job.mode==='video'?'Untitled video':'Untitled image';
}

// Route desktop drops through the same validated file-input handlers as uploads.
const targets=[];
export function registerFileDrop(selector,resolve){targets.push({selector,resolve});}
export function deliverFiles(input,files){
 if(!input||input.matches(':disabled'))return false;
 if(!input.multiple&&files.length!==1)throw Error('Drop one file at a time in this upload area.');
 const transfer=new DataTransfer();for(const file of files)transfer.items.add(file);
 input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
}
export function installFileDrops(report){
 const mappings=[
 ['#creator-add,#creator-images','#creator-files'],
 ['#creator-outfit-add,#creator-outfit-preview','#creator-outfit-file'],
 ['#outfit-image-field,#outfit-reference-picker','#outfit-file'],
 ['#character-add-images,#character-images,#character-reference-picker','#character-files'],
 ['#character-pick-outfit,#character-outfit-preview','#character-outfit-file'],
 ['#llm-dropzone,#llm-library','#llm-files'],
 ['#tool-dropzone,#tool-library','#tool-file'],
 ['#edit-source,#edit-empty-add,#edit-library','#edit-file'],
 ['#audio-dropzone,#audio-library','#audio-file'],
 ['#canvas-library','#canvas-library-files'],
 ['#assets-section','#assets-files'],
 ['#shoot-picker','#shoot-file']
 ];
 for(const [selector,id] of mappings)registerFileDrop(selector,()=>document.querySelector(id));
 let highlighted;
 const clear=()=>{highlighted?.classList.remove('file-drop-active');highlighted=null;};
 const match=event=>{
  for(const entry of targets){const zone=event.target.closest?.(entry.selector);if(zone){const input=entry.resolve();if(input&&!input.matches(':disabled'))return {zone,input};}}
  const label=event.target.closest?.('label[for]');const input=label?document.getElementById(label.htmlFor):event.target;
  return input?.type==='file'&&!input.matches(':disabled')?{zone:label||input,input}:null;
 };
 for(const type of ['dragenter','dragover'])document.addEventListener(type,event=>{
  if(![...event.dataTransfer.types].includes('Files'))return;
  const hit=match(event);if(!hit)return;
  event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';
  if(highlighted!==hit.zone){clear();highlighted=hit.zone;highlighted.classList.add('file-drop-active');}
 },true);
 document.addEventListener('dragleave',event=>{if(highlighted&&!highlighted.contains(event.relatedTarget))clear();},true);
 document.addEventListener('drop',event=>{
  if(![...event.dataTransfer.types].includes('Files'))return;
  const hit=match(event);clear();if(!hit)return;
  event.preventDefault();event.stopImmediatePropagation();
  const files=[...event.dataTransfer.files];if(!files.length)return;
  try{
   if(hit.input.id==='character-outfit-file'){const mode=document.querySelector('#character-outfit-mode');mode.value='upload';mode.dispatchEvent(new Event('change',{bubbles:true}));}
   if(deliverFiles(hit.input,files))hit.zone.closest('dialog')?.close();
  }catch(error){report(error.message);}
 },true);
 window.addEventListener('blur',clear);document.addEventListener('dragend',clear,true);
}
