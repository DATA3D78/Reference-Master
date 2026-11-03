import {assetCollection,collectionLabel} from './library.js';
import {projectDownloadName,inHistoryPeriod} from './library.js?v=project-download-names';
import {LLM_MODELS,LLM_LIMITS,videoTimestamps} from './llm-models.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const taskName=task=>({image:'Image description',video:'Video essence',refine:'Refined output',shoot:'Refined SHOOT prompt'}[task]);
const sizeLabel=bytes=>(bytes/1024**2).toFixed(1)+' MB';
export function llmPromptKind(job){return ['refine','shoot'].includes(job.settings?.task)||job.settings?.sourceId?'refined':'base';}
export function llmOutputTitle(job){
  const fallback=taskName(job.settings.task);
  if(job.status!=='COMPLETED'||job.settings.format!=='json')return fallback;
  try{
    const data=JSON.parse(job.output);
    const value=[data?.title,data?.scene_description].find(s=>typeof s==='string'&&s.trim());
    if(!value)return fallback;
    const title=value.replace(/\s+/g,' ').trim();
    return title.length>100?title.slice(0,97).replace(/\s+\S*$/,'')+'…':title;
  }catch{return fallback;}
}
export function llmLibrarySources(assets,jobs,projectId,video=false){
  const types=video?['video/mp4','video/quicktime','video/webm']:['image/png','image/jpeg','image/webp'];
  const limit=(video?LLM_LIMITS.videoMB:LLM_LIMITS.imageMB)*1024**2;
  const sources=assets.map(a=>({key:'asset:'+a.id,url:'/api/assets/media?id='+encodeURIComponent(a.id),name:a.name,contentType:a.contentType,bytes:a.bytes,collection:assetCollection(a),label:collectionLabel(assetCollection(a))}));
  for(const job of jobs.filter(j=>j.projectId===projectId))for(const task of job.tasks||[])for(const media of task.outputs||[]){
    if(!media.favorite||media.deleted)continue;
    let name=job.settings?.prompt||job.modelName||'Favorite';try{name=JSON.parse(name).title||name;}catch{}
    sources.push({key:'favorite:'+job.id+':'+media.id,url:'/api/media?job='+encodeURIComponent(job.id)+'&media='+encodeURIComponent(media.id),name:String(name).slice(0,180),contentType:media.contentType,bytes:media.local?.bytes,collection:'favorites',label:job.modelName||'Favorite'});
  }
  return sources.filter(s=>types.includes(s.contentType)).map(s=>({...s,disabled:!!(s.bytes>limit),reason:s.bytes>limit?`Exceeds ${limit/1024**2} MB limit`:''}));
}
const eventOnce=(element,type,timeout=20000)=>new Promise((resolve,reject)=>{
  const end=()=>{clearTimeout(timer);element.removeEventListener(type,ok);element.removeEventListener('error',bad);};
  const ok=()=>{end();resolve();},bad=()=>{end();reject(Error('This media could not be decoded. Try a PNG/JPG image or an MP4 video encoded with H.264.'));};
  const timer=setTimeout(bad,timeout);element.addEventListener(type,ok,{once:true});element.addEventListener('error',bad,{once:true});
});
async function imageSize(url){const image=new Image(),ready=eventOnce(image,'load');image.src=url;await ready;return {width:image.naturalWidth,height:image.naturalHeight};}
async function sampleVideo(file,count,progress){
  if(file.size>LLM_LIMITS.videoMB*1024**2)throw Error('Use a video up to 200 MB.');
  const url=URL.createObjectURL(file),video=document.createElement('video');video.muted=true;video.preload='auto';video.playsInline=true;
  try{
    const loaded=eventOnce(video,'loadeddata');video.src=url;await loaded;
    const timestamps=videoTimestamps(video.duration,count),canvas=document.createElement('canvas');
    const scale=Math.min(1,1024/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    if(!canvas.width||!canvas.height)throw Error('The video has no readable frames.');
    const ctx=canvas.getContext('2d'),frames=[];
    for(let i=0;i<timestamps.length;i++){
      if(Math.abs(video.currentTime-timestamps[i])>.00001){const seeked=eventOnce(video,'seeked');video.currentTime=timestamps[i];await seeked;}
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));if(!blob)throw Error('A video frame could not be read.');
      frames.push({blob,name:`Frame ${i+1} · ${timestamps[i].toFixed(1)}s`,metadata:{width:canvas.width,height:canvas.height}});progress(i+1,count);
    }
    return {frames,video:{name:file.name.slice(0,200),duration:video.duration,timestamps},preview:url};
  }catch(error){URL.revokeObjectURL(url);throw error;}finally{video.removeAttribute('src');video.load();}
}

export class LlmWorkspace{
  constructor(actions){
    this.actions=actions;this.projectId='default';this.jobs=[];this.jobsVersion=0;this.deletionPending=new Set();this.active=[];this.references=[];this.video=null;this.videoPreview=null;this.busy=false;this.keyConfigured=false;this.format='text';this.selected=null;this.visible=false;this.drafts=new Map();this.signature='';this.historyPeriod='all';this.promptKind='all';
    try{const period=localStorage.getItem('fwrd-llm-history-period'),kind=localStorage.getItem('fwrd-llm-prompt-kind');if(['day','week','month','all'].includes(period))this.historyPeriod=period;if(['all','base','refined'].includes(kind))this.promptKind=kind;}catch{}
    $('#llm-controls').innerHTML=`<div class="llm-connection"><span id="llm-key-status">Comfy · loading…</span><button type="button" id="llm-open-settings">Connect</button></div><form id="llm-form"><fieldset id="llm-fields"><div class="field"><label for="llm-model">Language model</label><select id="llm-model">${LLM_MODELS.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select></div><div class="field"><label for="llm-task">Starting point</label><select id="llm-task"><option value="image">Describe images</option><option value="video">Extract video essence</option><option value="refine">Refine a text output</option></select></div><div id="llm-source-field" class="field" hidden><div class="label-row"><label for="llm-source">Selected text</label><button type="button" class="text-button" id="llm-clear-source">Clear</button></div><p id="llm-source-label" class="llm-source-label">Select “Refine output” on a result.</p><textarea id="llm-source" maxlength="100000" placeholder="Choose a result on the right. You can edit it here before refining."></textarea></div><div class="field"><div class="label-row"><label id="llm-import-label" for="llm-files">Reference images</label><span id="llm-file-count" class="muted">0 / 8</span></div><div id="llm-frame-setting" class="field" hidden><label for="llm-frames">Video detail</label><select id="llm-frames"><option value="12">12 frames · overview</option><option value="24" selected>24 frames · balanced</option><option value="48">48 frames · more detail</option></select></div><label class="dropzone llm-drop" id="llm-dropzone" for="llm-files"><strong>Drop files or <em>browse</em></strong><small id="llm-upload-hint">PNG, JPG, WebP · up to 10 MB each</small></label><input type="file" id="llm-files" class="visually-hidden" accept="image/png,image/jpeg,image/webp" multiple><video class="llm-video-preview" id="llm-video-preview" controls playsinline hidden></video><div id="llm-files-preview" class="llm-files"></div><button type="button" id="llm-clear-files" class="text-button" hidden>Clear references</button><p id="llm-media-note" class="hint">Import up to 8 images to describe together.</p></div><div class="field"><label for="llm-instruction">Your instruction <span class="muted" id="llm-optional">· optional</span></label><textarea id="llm-instruction" maxlength="12000" aria-describedby="llm-structure-hint" placeholder="Optional: tell the model what to focus on or change…"></textarea><p id="llm-structure-hint" class="hint"></p></div><div class="field" id="llm-format-field"><label>Output format</label><div class="llm-format" role="group" aria-label="Text output format"><button type="button" data-llm-format="text" aria-pressed="true">Plain text</button><button type="button" data-llm-format="json" aria-pressed="false">JSON</button></div></div><div class="field"><label for="llm-max-tokens">Response length limit</label><select id="llm-max-tokens"><option value="2048">2,048 tokens</option><option value="4096">4,096 tokens</option><option value="8192" selected>8,192 tokens</option><option value="16384">16,384 tokens</option></select></div></fieldset><div class="llm-rates" id="llm-rates"></div><p id="llm-error" class="error" role="alert" hidden></p><p id="llm-status" class="llm-status" role="status"></p><button type="submit" id="llm-generate" class="primary">Describe images</button><p class="hint">Your selected text and images go to Comfy when you submit. Outputs save with this project.</p></form>`;
    $('#llm-workspace').innerHTML=`<div class="workspace-top"><div><span class="eyebrow">YOUR TEXT WORKSPACE</span><h2>See it. Understand it. Shape it.</h2></div><span id="llm-output-count" class="muted"></span></div><p class="llm-intro">Turn visual references into words, then build on the result. Select an output to refine it with a new instruction and images.</p><div class="workspace-history-filters"><label>History<select id="llm-history-period" aria-label="LLM history period"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="all">All time</option></select></label><label>Prompt type<select id="llm-prompt-kind" aria-label="Prompt type"><option value="all">Both</option><option value="base">Base prompts</option><option value="refined">Refined prompts</option></select></label></div><p id="llm-history-empty" class="hint" hidden>No prompts match these filters. Choose another period or prompt type.</p><div id="llm-empty" class="llm-empty"><h3>A starting point for your next idea.</h3><p>Import an image or a video to begin.</p><div class="llm-steps"><span><b>01 / Describe</b>Image → text or JSON.<br>Video → a visual summary.</span><span><b>02 / Refine</b>Select a result. Add directions and new image references.</span><span><b>03 / Create</b>Copy the final text or use it as your Image or Video prompt.</span></div></div><div id="llm-results"></div>`;
    const dialog=document.createElement('dialog');dialog.id='llm-settings';dialog.innerHTML=`<form id="llm-settings-form"><div class="dialog-heading"><span class="eyebrow">COMFY / LLM</span><button type="button" class="icon-button" id="llm-close-settings" aria-label="Close Comfy settings">×</button></div><h2>Connect your<br>language models.</h2><p>Use your Comfy account for image descriptions, video summaries and text refinement.</p><label for="llm-api-key">Comfy API key</label><input id="llm-api-key" type="password" autocomplete="off" placeholder="Paste your Comfy key" spellcheck="false"><p class="hint">Open OPENROUTER_API_KEY_HERE.txt from Settings → API keys &amp; prompts to connect automatically. A key entered here lasts for this session.</p><p class="error" id="llm-settings-error" hidden></p><button type="submit" class="primary" id="llm-save-key">Connect Comfy</button><div class="settings-links"><a href="https://platform.comfy.org" target="_blank" rel="noopener noreferrer">Get an API key ↗</a><button type="button" class="text-button" id="llm-disconnect">Disconnect this session</button></div></form>`;document.body.append(dialog);
    $('#llm-task').addEventListener('change',async()=>{await this.clearReferences();this.sync();});
    this.createLibrary();
    $('#llm-frames').addEventListener('change',async()=>{await this.clearReferences();this.status('Import the video again to use this frame count.');});
    $('#llm-model').addEventListener('change',()=>this.sync());
    document.querySelectorAll('[data-llm-format]').forEach(b=>b.addEventListener('click',()=>{this.format=b.dataset.llmFormat;this.sync();}));
    $('#llm-files').addEventListener('change',e=>{const files=[...e.target.files];e.target.value='';void this.importFiles(files);});
    const drop=$('#llm-dropzone');for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();drop.classList.add('dragging');}});
    drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');void this.importFiles([...e.dataTransfer.files]);});
    $('#llm-clear-files').addEventListener('click',()=>this.clearReferences());
    $('#llm-files-preview').addEventListener('click',async e=>{const b=e.target.closest('[data-llm-remove]');if(!b||this.busy)return;const index=this.references.findIndex(r=>r.id===b.dataset.llmRemove);if(index<0)return;const [ref]=this.references.splice(index,1);URL.revokeObjectURL(ref.preview);await this.actions.api('/api/uploads/'+ref.id,{method:'DELETE'}).catch(()=>{});this.renderReferences();});
    $('#llm-clear-source').addEventListener('click',()=>{this.selected=null;$('#llm-source').value='';this.sync();this.render(true);});
    $('#llm-form').addEventListener('submit',e=>{e.preventDefault();void this.submit();});
    $('#llm-history-period').value=this.historyPeriod;$('#llm-prompt-kind').value=this.promptKind;
    for(const [id,property] of [['history-period','historyPeriod'],['prompt-kind','promptKind']])$('#llm-'+id).addEventListener('change',()=>{this[property]=$('#llm-'+id).value;try{localStorage.setItem('fwrd-llm-'+id,this[property]);}catch{}this.render();});
    $('#llm-results').addEventListener('click',e=>void this.resultAction(e));
    $('#llm-open-settings').addEventListener('click',()=>this.openSettings());$('#llm-close-settings').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>$('#llm-api-key').value='');
    $('#llm-settings-form').addEventListener('submit',async e=>{e.preventDefault();const key=$('#llm-api-key').value.trim();if(!key){$('#llm-settings-error').hidden=false;$('#llm-settings-error').textContent='Paste your Comfy key first.';return;}await this.configureKey(key);});
    $('#llm-disconnect').addEventListener('click',()=>this.configureKey(''));
    this.sync();
  }
  status(text){$('#llm-status').textContent=text;}
  error(text){$('#llm-error').textContent=text;$('#llm-error').hidden=!text;}
  setBusy(value){this.busy=value;this.actions.busy(value);this.sync();}
  async loadConfig(){const config=await this.actions.api('/api/llm/config');this.keyConfigured=config.keyConfigured;this.detailedStructure=!!config.detailedStructure;this.sync();this.actions.connection();}
  openSettings(){$('#llm-api-key').value='';$('#llm-settings-error').hidden=true;$('#llm-settings').showModal();}
  async configureKey(key){$('#llm-save-key').disabled=true;try{const r=await this.actions.post('/api/llm/settings',{key});this.keyConfigured=r.keyConfigured;$('#llm-api-key').value='';$('#llm-settings').close();this.sync();this.actions.connection();this.actions.toast(key?'Comfy connected.':'Comfy disconnected for this session.');}catch(error){$('#llm-settings-error').textContent=error.message;$('#llm-settings-error').hidden=false;}finally{$('#llm-save-key').disabled=false;}}
  sync(){
    const task=$('#llm-task').value,video=task==='video',refine=task==='refine';
    $('#llm-source-field').hidden=!refine;$('#llm-source-label').textContent=this.selected?'Using '+taskName(this.selected.settings.task)+' · '+this.selected.modelName:'Select “Refine output” on a result.';
    $('#llm-frame-setting').hidden=!video;$('#llm-frames').disabled=this.busy;
    $('#llm-import-label').textContent=video?'Reference video':refine?'New image references · optional':'Reference images';
    $('#llm-files').accept=video?'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm':'image/png,image/jpeg,image/webp';$('#llm-files').multiple=!video;
    $('#llm-upload-hint').textContent=video?'MP4, MOV, WebM · up to 200 MB / 10 minutes':'PNG, JPG, WebP · up to 10 MB each';
    $('#llm-media-note').textContent=video?'Analyzes sampled frames in time order. Audio is not included, and brief events between frames can be missed.':refine?'New images guide the refinement. The original output stays saved.':'Import up to 8 images to describe together.';
    $('#llm-optional').hidden=refine;$('#llm-instruction').placeholder=refine?'e.g. Keep the lighting and framing, but replace the subject with the person in these images.':video?'e.g. Focus on the main action, camera movement and atmosphere.':'Optional: tell the model what to focus on or change…';
    $('#llm-structure-hint').textContent=this.detailedStructure?'Detailed structure included automatically: scene, subject, action, environment, lighting, composition, visual style, key details and negative elements. JSON uses nested fields; plain text follows the same outline.':'Open Apply Studio Update.command, then refresh to activate detailed structured descriptions.';
    if(video)this.format='text';document.querySelectorAll('[data-llm-format]').forEach(b=>{b.setAttribute('aria-pressed',String(this.format===b.dataset.llmFormat));b.disabled=video&&b.dataset.llmFormat==='json';});
    const legacyBusy=!this.actions.concurrent&&this.active.length>0;
    $('#llm-fields').disabled=this.busy;$('#llm-generate').disabled=this.busy||legacyBusy;$('#llm-generate').textContent=this.busy?'Preparing…':legacyBusy?'Analysis in progress…':refine?'Create final output':video?'Describe video':'Describe images';
    $('#llm-key-status').textContent=this.keyConfigured?'Comfy connected':'Comfy key needed';$('#llm-open-settings').textContent=this.keyConfigured?'Settings':'Connect';
    const model=LLM_MODELS.find(m=>m.id===$('#llm-model').value);$('#llm-rates').innerHTML=`<strong>Comfy · USD</strong><br>$${model.inputPrice} / 1M input tokens · $${model.outputPrice} / 1M output tokens<br>Images, video frames and reasoning affect usage. Final cost appears when returned by Comfy. Rates checked Oct 7, 2026.`;
    this.renderReferences();
  }
  renderReferences(){
    const video=$('#llm-task').value==='video';$('#llm-file-count').textContent=video?(this.video?`${this.references.length} frames`:'0 / 1 video'):`${this.references.length} / 8`;
    $('#llm-files-preview').innerHTML=this.references.map(r=>`<div class="llm-file"><img src="${esc(r.preview)}" alt="${esc(r.name)}"><small>${esc(r.name)}</small>${!video?`<button type="button" data-llm-remove="${r.id}" aria-label="Remove ${esc(r.name)}" ${this.busy?'disabled':''}>×</button>`:''}</div>`).join('');
    const preview=$('#llm-video-preview');preview.hidden=!this.videoPreview;if(this.videoPreview&&preview.getAttribute('src')!==this.videoPreview)preview.src=this.videoPreview;if(!this.videoPreview)preview.removeAttribute('src');
    $('#llm-clear-files').hidden=!this.references.length;$('#llm-clear-files').disabled=this.busy;
  }
  async clearReferences(){if(this.busy)return;const old=this.references;this.references=[];for(const r of old){URL.revokeObjectURL(r.preview);void this.actions.api('/api/uploads/'+r.id,{method:'DELETE'}).catch(()=>{});}if(this.videoPreview)URL.revokeObjectURL(this.videoPreview);this.videoPreview=null;this.video=null;this.status('');this.renderReferences();}
  createLibrary(){
    const old=$('#llm-dropzone'),drop=document.createElement('button');drop.type='button';drop.id=old.id;drop.className=old.className;drop.setAttribute('aria-haspopup','dialog');drop.setAttribute('aria-controls','llm-library');drop.setAttribute('aria-label','Add references: upload, Assets or Favorites');
    drop.innerHTML=`${this.actions.icon('upload')}<strong>Drop files or <em>choose references</em></strong><span class="llm-source-methods">Upload · Assets · Outfit · Character · ID · Favorites</span>${old.querySelector('small').outerHTML}`;old.replaceWith(drop);
    drop.addEventListener('click',()=>void this.openLibrary());
    const dialog=document.createElement('dialog');dialog.id='llm-library';dialog.setAttribute('aria-labelledby','llm-library-title');
    dialog.innerHTML=`<div class="dialog-heading"><h2 id="llm-library-title">Add image references</h2><button type="button" class="icon-button" id="llm-library-close" aria-label="Close reference picker">${this.actions.icon('close')}</button></div><button type="button" class="secondary llm-library-upload" id="llm-library-upload">${this.actions.icon('upload')} Upload from computer</button><p class="hint" id="llm-library-hint"></p><div class="llm-library-tabs" role="group" aria-label="Reference collection"><button type="button" data-llm-collection="assets" aria-pressed="true">Assets</button><button type="button" data-llm-collection="outfit" aria-pressed="false">Outfit</button><button type="button" data-llm-collection="character" aria-pressed="false">Character</button><button type="button" data-llm-collection="id" aria-pressed="false">ID</button><button type="button" data-llm-collection="favorites" aria-pressed="false">Favorites</button></div><input type="search" id="llm-library-search" aria-label="Search references" placeholder="Search Asset Library"><div id="llm-library-grid"></div><p id="llm-library-status" class="hint" role="status"></p><div class="llm-library-footer"><span id="llm-library-count" aria-live="polite">0 selected</span><button type="button" class="primary" id="llm-library-add" disabled>Add references</button></div>`;
    document.body.append(dialog);
    $('#llm-library-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{this.libraryVersion=(this.libraryVersion||0)+1;});
    $('#llm-library-upload').addEventListener('click',()=>{dialog.close();$('#llm-files').click();});
    $('#llm-library-search').addEventListener('input',()=>this.renderLibrary());
    dialog.querySelectorAll('[data-llm-collection]').forEach(button=>button.addEventListener('click',()=>{this.libraryCollection=button.dataset.llmCollection;this.renderLibrary();}));
    $('#llm-library-grid').addEventListener('change',event=>{
      const input=event.target.closest('[data-llm-source]');if(!input)return;
      const source=this.library[Number(input.dataset.llmSource)];if(!source||source.disabled)return;
      if(input.checked){if(this.librarySelection.size>=this.libraryRemaining){input.checked=false;return;}this.librarySelection.add(source.key);}else this.librarySelection.delete(source.key);
      this.renderLibrary();$('#llm-library-grid input[data-llm-source="'+input.dataset.llmSource+'"]').focus({preventScroll:true});
    });
    $('#llm-library-add').addEventListener('click',()=>{
      if(this.busy||this.projectId!==this.libraryProject||$('#llm-task').value!==this.libraryTask)return;
      const sources=this.library.filter(s=>this.librarySelection.has(s.key));if(!sources.length||sources.length>this.libraryRemaining)return;
      dialog.close();void this.importSaved(sources);
    });
  }
  async openLibrary(){
    if(this.busy)return;
    const version=this.libraryVersion=(this.libraryVersion||0)+1,projectId=this.projectId,task=$('#llm-task').value,video=task==='video';
    this.libraryProject=projectId;this.libraryTask=task;this.libraryRemaining=video?1:Math.max(0,LLM_LIMITS.images-this.references.length);
    this.library=[];this.librarySelection=new Set();this.libraryCollection=this.libraryCollection||'assets';this.libraryErrors={};this.libraryLoading=true;
    $('#llm-library-title').textContent=video?'Add a video reference':'Add image references';$('#llm-library-search').value='';
    $('#llm-library-hint').textContent=video?'Choose one video · up to 200 MB / 10 minutes':`Choose up to ${this.libraryRemaining} more images · PNG, JPG, WebP · 10 MB each`;
    this.renderLibrary();$('#llm-library').showModal();
    const [assets,jobs]=await Promise.allSettled([this.actions.api('/api/assets'),this.actions.api('/api/jobs?project='+encodeURIComponent(projectId))]);
    if(version!==this.libraryVersion||projectId!==this.projectId)return;
    if(assets.status==='rejected')this.libraryErrors.assets=assets.reason.message;
    if(jobs.status==='rejected')this.libraryErrors.favorites=jobs.reason.message;
    this.library=llmLibrarySources(assets.status==='fulfilled'?assets.value.assets:[],jobs.status==='fulfilled'?jobs.value.jobs:[],projectId,video);
    this.libraryLoading=false;this.renderLibrary();
  }
  renderLibrary(){
    const collection=this.libraryCollection,query=$('#llm-library-search').value.trim().toLowerCase(),video=this.libraryTask==='video';
    document.querySelectorAll('[data-llm-collection]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.llmCollection===collection)));
    $('#llm-library-search').placeholder=collection==='favorites'?'Search this project’s favorites': 'Search '+({assets:'Assets',outfit:'Outfit',id:'ID'}[collection]);
    const entries=this.library.map((s,index)=>({...s,index})).filter(s=>s.collection===collection&&(s.name+' '+s.label).toLowerCase().includes(query));
    $('#llm-library-grid').innerHTML=entries.map(s=>{
      const selected=this.librarySelection.has(s.key),disabled=s.disabled||!selected&&this.librarySelection.size>=this.libraryRemaining;
      return `<label class="llm-library-card ${selected?'selected':''} ${disabled?'unavailable':''}"><input type="checkbox" data-llm-source="${s.index}" aria-label="Select ${esc(s.name)}" ${selected?'checked':''} ${disabled?'disabled':''}>${video?`<video src="${esc(s.url)}" preload="metadata" muted playsinline></video>`:`<img src="${esc(s.url)}" alt="" loading="lazy">`}<strong title="${esc(s.name)}">${esc(s.name)}</strong><small>${esc(s.reason||s.label)}</small></label>`;
    }).join('');
    $('#llm-library-status').textContent=this.libraryErrors[collection==='favorites'?'favorites':'assets']|| (this.libraryLoading?'Loading references…':entries.length?`${entries.length} ${video?'video':'image'}${entries.length===1?'':'s'} · ${collection!=='favorites'?'All projects':'Current project'}`:query?'No matching references.':collection!=='favorites'?`No saved ${video?'video':'image'} assets yet. Upload a file to begin.`:`No favorite ${video?'videos':'images'} in this project yet. Choose Assets or upload a file.`);
    const count=this.librarySelection.size;$('#llm-library-count').textContent=`${count} / ${this.libraryRemaining} selected`;
    $('#llm-library-add').disabled=!count;$('#llm-library-add').textContent=count?`Add ${count} ${video?'video':count===1?'image':'images'}`:'Add references';
    $('#llm-library-upload').disabled=!this.libraryRemaining;
    if(!this.libraryRemaining)$('#llm-library-hint').textContent='You already have 8 references. Remove an image to make room.';
  }
  async importSaved(sources){
    if(this.busy)return;this.setBusy(true);this.error('');const files=[],video=$('#llm-task').value==='video',limit=(video?LLM_LIMITS.videoMB:LLM_LIMITS.imageMB)*1024**2;
    try{
      for(const source of sources){
        this.status('Loading '+source.name+'…');
        const response=await fetch(source.url);if(!response.ok)throw Error('Could not load '+source.name+'. Try saving the original again.');
        if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw Error(source.name+' exceeds the '+limit/1024**2+' MB limit.');}
        const blob=await response.blob();if(blob.size>limit)throw Error(source.name+' exceeds the '+limit/1024**2+' MB limit.');
        files.push(new File([blob],source.name,{type:source.contentType}));
      }
    }catch(error){this.error(error.message);this.status('');return;}finally{this.setBusy(false);}
    await this.importFiles(files);
  }
  async upload(blob,name,metadata,videoFrame=false){const response=await this.actions.api('/api/uploads',{method:'POST',headers:{'Content-Type':blob.type,'X-Media-Metadata':JSON.stringify(metadata),'X-File-Name':encodeURIComponent(name),'X-Project-Id':this.projectId,...(videoFrame?{'X-Upload-Purpose':'video-frame'}:{})},body:blob});return {id:response.id,name,preview:URL.createObjectURL(blob)};}
  async importFiles(files){
    if(this.busy||!files.length)return;this.error('');const video=$('#llm-task').value==='video';
    try{
      if(video){if(files.length!==1||!(/\.(mp4|mov|webm)$/i.test(files[0].name)||files[0].type.startsWith('video/')))throw Error('Choose one MP4, MOV or WebM video.');await this.clearReferences();}
      else if(this.references.length+files.length>8||files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>10*1024**2))throw Error('Choose up to 8 PNG, JPG or WebP images, 10 MB each.');
      this.setBusy(true);
      if(video){const sampled=await sampleVideo(files[0],Number($('#llm-frames').value),(i,total)=>this.status(`Reading video frame ${i} / ${total}…`));this.videoPreview=sampled.preview;this.video=sampled.video;for(const [i,frame]of sampled.frames.entries()){this.status(`Preparing video frame ${i+1} / ${sampled.frames.length}…`);this.references.push(await this.upload(frame.blob,frame.name,frame.metadata,true));}}
      else for(const file of files){this.status('Preparing '+file.name+'…');const preview=URL.createObjectURL(file);try{const metadata=await imageSize(preview);this.references.push(await this.upload(file,file.name,metadata));}finally{URL.revokeObjectURL(preview);}}
      this.status(video?`${this.video.duration.toFixed(1)}s · ${this.references.length} frames ready · visual analysis only`:`${this.references.length} image${this.references.length===1?'':'s'} ready`);
    }catch(error){if(video){this.setBusy(false);await this.clearReferences();}this.error(error.message);}finally{this.setBusy(false);this.renderReferences();}
  }
  async submit(){
    if(this.busy||!this.actions.concurrent&&this.active.length)return;this.error('');
    if(!this.detailedStructure){this.error('Open Apply Studio Update.command, then refresh to activate detailed structured descriptions.');return;}
    if(!this.keyConfigured){this.openSettings();return;}
    const task=$('#llm-task').value,instruction=$('#llm-instruction').value.trim();
    if(task==='refine'&&(!this.selected||!$('#llm-source').value.trim()||!instruction)){this.error('Select an output, keep some source text, and add an instruction.');return;}
    if(task!=='refine'&&!this.references.length){this.error('Import '+(task==='video'?'a video':'an image')+' first.');return;}
    this.setBusy(true);this.status('Sending to Comfy…');
    try{const {job}=await this.actions.post('/api/llm/generate',{projectId:this.projectId,model:$('#llm-model').value,task,format:this.format,instruction,maxTokens:Number($('#llm-max-tokens').value),referenceIds:this.references.map(r=>r.id),video:task==='video'?this.video:undefined,sourceId:task==='refine'?this.selected?.id:undefined,sourceText:task==='refine'?$('#llm-source').value:undefined});this.jobsVersion++;this.jobs=this.jobs.filter(j=>j.id!==job.id);this.jobs.unshift(job);this.active=[...new Set([...this.active,this.projectId])];this.render(true);this.status(this.actions.concurrent?'Analysis started. You can submit another while it runs.':'You can leave this section while the local app stays running.');}
    catch(error){this.error(error.message);this.status('');}finally{this.setBusy(false);}
  }
  draft(){return {references:this.references,video:this.video,videoPreview:this.videoPreview,selected:this.selected,format:this.format,model:$('#llm-model').value,task:$('#llm-task').value,instruction:$('#llm-instruction').value,source:$('#llm-source').value,maxTokens:$('#llm-max-tokens').value,frames:$('#llm-frames').value};}
  async show(projectId){
    this.visible=true;
    if(projectId!==this.projectId){this.drafts.set(this.projectId,this.draft());this.projectId=projectId;const d=this.drafts.get(projectId)||{};this.references=d.references||[];this.video=d.video||null;this.videoPreview=d.videoPreview||null;this.selected=d.selected||null;this.format=d.format||'text';for(const [id,value]of Object.entries({model:d.model||LLM_MODELS[0].id,task:d.task||'image',instruction:d.instruction||'',source:d.source||'','max-tokens':d.maxTokens||'8192',frames:d.frames||'24'}))$('#llm-'+id).value=value;this.jobs=[];this.signature='';this.error('');this.status('');this.sync();this.render(true);}
    try{await this.loadConfig();await this.refresh();}catch(error){this.error(error.message);}this.schedule();
  }
  hide(){this.visible=false;clearTimeout(this.timer);}
  schedule(){clearTimeout(this.timer);if(this.visible)this.timer=setTimeout(async()=>{try{await this.refresh();}catch(error){this.error(error.message);}this.schedule();},2500);}
  async refresh(){if(this.deletionPending.size)return;const projectId=this.projectId,version=this.jobsVersion,result=await this.actions.api('/api/llm/jobs?project='+encodeURIComponent(projectId));if(this.projectId!==projectId||this.jobsVersion!==version)return;this.jobs=result.jobs;this.active=result.activeProjectIds;if(this.selected&&!this.jobs.some(job=>job.id===this.selected.id))this.clearDeletedSource(this.selected.id,projectId);this.render();this.sync();}
  clearDeletedSource(jobId,projectId){
    if(this.projectId===projectId&&this.selected?.id===jobId){this.selected=null;$('#llm-source').value='';}
    const draft=this.drafts.get(projectId);if(draft?.selected?.id===jobId){draft.selected=null;draft.source='';}
  }
  async deleteOutput(jobId,projectId=this.projectId,restore=false){
    if(!this.actions.deletionEnabled()){this.actions.toast('Open Apply Studio Update.command, then refresh to activate prompt deletion.');return;}
    if(this.busy){this.actions.toast('Wait for reference preparation to finish.');return;}
    if(this.deletionPending.has(jobId))return;
    this.deletionPending.add(jobId);this.jobsVersion++;this.render(true);
    try{
      const result=await this.actions.post('/api/llm/'+(restore?'restore':'delete'),{jobId,projectId});
      if(!restore)this.clearDeletedSource(jobId,projectId);
      if(this.projectId===projectId){this.jobs=this.jobs.filter(job=>job.id!==jobId);if(result.job)this.jobs.push(result.job);this.jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));this.sync();}
      this.actions.toast(restore?'Text output restored.':'Text output deleted.',restore?undefined:()=>this.deleteOutput(jobId,projectId,true));
    }catch(error){this.actions.toast(error.message,restore?()=>this.deleteOutput(jobId,projectId,true):undefined);}
    finally{this.deletionPending.delete(jobId);this.jobsVersion++;this.render(true);}
  }
  visibleJobs(now=new Date()){return this.jobs.filter(job=>inHistoryPeriod(job.createdAt,this.historyPeriod,now)&&(!this.promptKind||this.promptKind==='all'||llmPromptKind(job)===this.promptKind));}
  render(force=false){
    const jobs=this.visibleJobs(),signature=JSON.stringify([this.jobs,this.historyPeriod,this.promptKind,jobs.map(job=>job.id),this.selected?.id,[...this.deletionPending]]);if(!force&&signature===this.signature)return;this.signature=signature;
    const running=this.jobs.filter(j=>j.status==='RUNNING').length;
    $('#llm-output-count').textContent=this.jobs.length?`${this.historyPeriod==='all'&&this.promptKind==='all'?this.jobs.length:jobs.length+' of '+this.jobs.length} output${this.jobs.length===1?'':'s'}${running?` · ${running} running`:''}`:'';$('#llm-empty').hidden=!!this.jobs.length;
    $('#llm-history-empty').hidden=!this.jobs.length||!!jobs.length;
    $('#llm-results').innerHTML=jobs.map(job=>{
      const title=llmOutputTitle(job);
      const cost=Number.isFinite(job.usage?.cost)?` · $${job.usage.cost.toFixed(4)}`:'';
      return `<article class="llm-card ${this.selected?.id===job.id?'selected':''}" data-llm-job="${job.id}"><div class="llm-card-top"><div><h3>${esc(title)}</h3><div class="llm-card-meta">${esc(job.modelName)} · ${job.settings.format==='json'?'JSON':'Plain text'} · ${new Date(job.createdAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}<br>${llmPromptKind(job)==='refined'?(job.settings.task==='shoot'?'Refined prompt · SHOOT':'Refined prompt'):'Base prompt'}</div></div><button type="button" class="icon-button llm-delete" data-llm-action="delete" aria-label="Delete text output" title="${job.status==='RUNNING'?'Wait for this analysis to finish':'Delete output'}" ${job.status==='RUNNING'||this.deletionPending.has(job.id)?'disabled':''}>${this.actions.icon('trash')}</button></div>${job.status==='COMPLETED'?`<pre tabindex="0" class="llm-output ${job.settings.format==='json'?'json':''}">${esc(job.output)}</pre><div class="llm-card-actions"><button type="button" data-llm-action="refine" aria-pressed="${this.selected?.id===job.id}">Refine output</button><button type="button" data-llm-action="copy">Copy</button><button type="button" data-llm-action="download">Download ${job.settings.format==='json'?'JSON':'text'}</button>${job.settings.format==='json'?'<button type="button" data-llm-action="shoot">Use for SHOOT</button>':''}<button type="button" data-llm-action="image">Use for Image</button><button type="button" data-llm-action="video">Use for Video</button></div><p class="llm-usage">${job.storageError?esc(job.storageError):'Saved on this computer'}${Number.isFinite(job.usage?.total_tokens)?` · ${job.usage.total_tokens.toLocaleString()} tokens`:''}${cost}${job.settings.video?' · From sampled frames; audio not analyzed':''}</p>`:job.status==='RUNNING'?'<div class="llm-state" role="status"><span class="spinner"></span>Reading your references and shaping the response…</div>':`<div class="error" role="status">${esc(job.error||'This analysis could not finish.')}</div><a href="https://openrouter.ai/activity" target="_blank" rel="noopener noreferrer" class="text-button">Comfy activity ↗</a>`}</article>`;
    }).join('');
  }
  async resultAction(event){
    const button=event.target.closest('[data-llm-action]');if(!button)return;const job=this.jobs.find(j=>j.id===button.closest('[data-llm-job]').dataset.llmJob);if(!job)return;
    const action=button.dataset.llmAction;
    if(action==='delete'){await this.deleteOutput(job.id);return;}
    if(!job.output)return;
    if(action==='shoot'){if(!this.busy)this.actions.useShoot?.(job);return;}
    if(action==='refine'){
      if(this.busy){this.actions.toast('Wait for reference preparation to finish.');return;}
      await this.clearReferences();this.selected=job;this.format=job.settings.format;$('#llm-task').value='refine';$('#llm-source').value=job.output;$('#llm-instruction').value='';this.error('');this.sync();this.render(true);$('#llm-instruction').focus();return;
    }
    if(action==='copy'){try{await navigator.clipboard.writeText(job.output);this.actions.toast('Output copied.');}catch{this.actions.toast('Select the output text and copy it with ⌘/Ctrl C.');}return;}
    if(action==='download'){const url=URL.createObjectURL(new Blob([job.output],{type:job.settings.format==='json'?'application/json':'text/plain'})),a=document.createElement('a');a.href=url;a.download=projectDownloadName(this.actions.projectName(job.projectId),'text-'+job.id.slice(0,8),job.settings.format==='json'?'json':'txt');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    if(['image','video'].includes(action)){if(this.busy){this.actions.toast('Wait for reference preparation to finish.');return;}this.actions.usePrompt(action,job.output);}
  }
}
