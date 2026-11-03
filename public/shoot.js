import {SHOOT_SECTIONS,SHOOT_SUBJECT_KINDS,shootSubjectKind,sourceSubjectKind,shootKindChanged,shootSections,changeShootSubjectKind,shootFieldPlaceholder,SHOOT_MODELS,SHOOT_MOODS,newShoot,parseShootJSON,compiledShoot,activeShootField,sectionFields,sectionFor,getPath,humanize,resetSection,applyMood,applySectionDescription,shootReferences,shootPrompt,shootDirectionKey,shootRefinementReady,shootPlainText,resolvedRatios,shootPlans} from './shoot-model.js';
import {LLM_MODELS} from './llm-models.js';
import {llmLibrarySources,llmOutputTitle} from './llm.js';
import {projectDownloadName,generationFeed,inHistoryPeriod} from './library.js';
import {estimateReferenceCost} from './reference-pricing.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assetURL=ref=>'/api/assets/media?id='+encodeURIComponent(ref.assetId);
const mediaURL=(job,media)=>'/api/media?job='+encodeURIComponent(job.id)+'&media='+encodeURIComponent(media.id);
const inputValue=v=>Array.isArray(v)?v.map(x=>typeof x==='object'?JSON.stringify(x):x).join('\n'):typeof v==='string'?v:JSON.stringify(v);
const referenceTitle=(draft,role)=>role==='subject'?`Main ${shootSubjectKind(draft)} reference`:({source:'Original image',outfit:'Outfit from assets',product:'Additional product reference',location:'Location reference'})[role];
const imageLoaded=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('This image could not be opened. Choose another file.'));img.src=url;});
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export class ShootWorkspace{
 constructor(actions){
  this.actions=actions;this.projectId=null;this.draft=newShoot();this.revision=0;this.visible=false;this.busy=false;this.loaded=false;this.queue=Promise.resolve();this.jobs=[];this.sources=[];this.view='original';this.format='json';this.resultLayout='cards';this.historyPeriod='all';try{if(localStorage.getItem('fwrd-shoot-layout')==='feed')this.resultLayout='feed';const period=localStorage.getItem('fwrd-shoot-history-period');if(['day','week','month','all'].includes(period))this.historyPeriod=period;}catch{}this.selected=new Set();this.resultPending=new Set();this.resultVersion=0;this.openSections=new Set(['subject']);this.epoch=0;this.version=0;
  $('#shoot-controls').innerHTML=`<div class="shoot-step-label"><span>01</span> YOUR STARTING POINT</div><div id="shoot-source-slot"></div><p class="hint" id="shoot-source-purpose">Used only to create the JSON prompt.</p><div class="shoot-source-actions"><button type="button" id="shoot-load-json" class="text-button">Load JSON / saved output</button></div><div class="field"><label for="shoot-llm-model">Description model</label><select id="shoot-llm-model">${LLM_MODELS.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div><button type="button" id="shoot-describe" class="secondary shoot-wide">Describe image</button><p class="hint">Describing refreshes Prompt and resets Direction. Earlier outputs stay saved in LLM.</p><div class="shoot-step-label"><span>02</span> PLAN YOUR SHOOT</div><fieldset id="shoot-plan-fields"><div class="field"><label for="shoot-model">Image model</label><select id="shoot-model">${SHOOT_MODELS.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label for="shoot-resolution">Resolution</label><select id="shoot-resolution"></select></div><div class="field" id="shoot-quality-field" hidden><label for="shoot-quality">Quality</label><select id="shoot-quality"></select></div><div class="field"><label>Aspect ratios</label><div id="shoot-ratios" class="shoot-ratios" role="group" aria-label="SHOOT aspect ratios"></div><p class="hint" id="shoot-ratio-hint"></p></div><div class="field"><label for="shoot-count">Variations per ratio</label><select id="shoot-count"><option value="2">2 variations</option><option value="3">3 variations</option><option value="4">4 variations</option></select></div></fieldset><section class="cost-estimate" aria-label="SHOOT cost estimate"><div class="cost-heading"><span>Estimated total · USD</span><strong id="shoot-cost">—</strong></div></section><button type="button" id="shoot-generate" class="primary">Generate shoot</button><button type="button" id="shoot-cancel-batch" class="text-button" hidden>Skip remaining ratios</button><p class="hint" id="shoot-plan-hint">Images are generated with your Comfy Router account.</p><p id="shoot-status" class="shoot-status" role="status"></p><p id="shoot-error" class="error" role="alert" hidden></p>`;
  $('#shoot-workspace').innerHTML=`<div class="workspace-top shoot-top"><div><span class="eyebrow">SHOOT / CREATIVE DIRECTION</span><h2>One scene. Your direction.</h2></div><span id="shoot-save-state" class="hint" role="status"></span></div><p class="shoot-intro">Keep what works. Change only what you choose.</p><div class="shoot-tabs" role="group" aria-label="SHOOT workspace"><button type="button" data-shoot-view="original" aria-pressed="true">Prompt</button><button type="button" data-shoot-view="sections" aria-pressed="false">Direction</button><button type="button" data-shoot-view="prompt" aria-pressed="false">Refine prompt</button><button type="button" data-shoot-view="results" aria-pressed="false">Results <span id="shoot-result-count"></span></button></div><div id="shoot-empty" class="shoot-empty"><div class="shoot-empty-mark">${actions.icon('image')}</div><h3>Build a shoot from an image.</h3><p>Describe your reference, then shape the subject, product, action, framing, location and photographic style independently.</p><div class="shoot-empty-steps"><span><b>01 / Describe</b>Start from a photo or saved JSON.</span><span><b>02 / Direct</b>Replace one detail or a whole section.</span><span><b>03 / Shoot</b>Choose ratios and create variations.</span></div></div><div id="shoot-sections"></div><div id="shoot-prompt-panel" hidden><h3 id="shoot-prompt-title" class="shoot-prompt-title"></h3><p id="shoot-prompt-hint" class="hint"></p><div class="shoot-prompt-actions"><div class="shoot-tabs" role="group" aria-label="SHOOT prompt format"><button type="button" data-shoot-format="json" aria-pressed="true">JSON</button><button type="button" data-shoot-format="text" aria-pressed="false">Plain text</button></div><button type="button" class="secondary" id="shoot-copy">Copy</button><button type="button" class="secondary" id="shoot-download-prompt">Download</button></div><pre id="shoot-prompt" tabindex="0"></pre></div><div id="shoot-results-panel" hidden><div class="workspace-history-filters"><label>History<select id="shoot-history-period" aria-label="SHOOT history period"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="all">All time</option></select></label><span id="shoot-history-count" class="hint" role="status"></span></div><div class="shoot-results-actions"><div class="view-switch" role="group" aria-label="SHOOT result layout"><button type="button" data-shoot-layout="feed" aria-pressed="false">Feed</button><button type="button" data-shoot-layout="cards" aria-pressed="true">Cards</button></div><button type="button" class="secondary" id="shoot-select-all">Select all</button><span id="shoot-selected-count" class="hint">0 selected</span><button type="button" class="secondary" id="shoot-download-results">Download selection</button><button type="button" class="secondary" id="shoot-delete-selected" disabled>Delete selected</button><button type="button" class="text-button" id="shoot-clear-selection" disabled>Unselect all</button></div><div id="shoot-results"></div><p id="shoot-results-empty" class="hint">Your SHOOT images will appear here.</p></div>`;
  this.createPicker();this.createImportDialog();
  $('#shoot-llm-model').addEventListener('change',()=>{this.draft.llmModel=$('#shoot-llm-model').value;this.changed();});
  $('#shoot-describe').addEventListener('click',()=>void this.describe('source'));
  $('#shoot-source-slot').addEventListener('click',e=>this.referenceAction(e));
  $('#shoot-load-json').addEventListener('click',()=>void this.openImport());
  $('#shoot-model').addEventListener('change',()=>{const m=SHOOT_MODELS.find(x=>x.id===$('#shoot-model').value);this.draft.model=m.id;if(!m.resolutions.includes(this.draft.resolution))this.draft.resolution=m.resolutions[0];this.draft.ratios=this.draft.ratios.filter(r=>r==='original'||m.ratios.includes(r));if(!this.draft.ratios.length)this.draft.ratios=['original'];this.changed();this.renderPlan();});
  for(const key of ['resolution','quality','count'])$('#shoot-'+key).addEventListener('change',()=>{this.draft[key]=key==='count'?Number($('#shoot-'+key).value):$('#shoot-'+key).value;this.changed();this.renderPlan();});
  $('#shoot-ratios').addEventListener('change',e=>{const ratio=e.target.dataset.shootRatio;if(!ratio)return;if(e.target.checked){if(this.draft.ratios.length>=10){e.target.checked=false;this.actions.toast('Choose up to 10 ratios.');return;}this.draft.ratios.push(ratio);}else this.draft.ratios=this.draft.ratios.filter(r=>r!==ratio);if(!this.draft.ratios.length)this.draft.ratios=['original'];this.changed();this.renderPlan();});
  $('#shoot-generate').addEventListener('click',()=>void this.generate());
  $('#shoot-cancel-batch').addEventListener('click',()=>{this.draft.batch.remaining=[];this.changed();this.render();this.status('Remaining ratios skipped. Submitted generations continue and stay in Results.');});
  $('#shoot-history-period').value=this.historyPeriod;
  $('#shoot-history-period').addEventListener('change',()=>{this.historyPeriod=$('#shoot-history-period').value;try{localStorage.setItem('fwrd-shoot-history-period',this.historyPeriod);}catch{}this.renderResults();});
  $('#shoot-workspace').addEventListener('click',e=>void this.workspaceAction(e));
  $('#shoot-sections').addEventListener('input',e=>this.editField(e));
  $('#shoot-sections').addEventListener('change',e=>this.changeSection(e));
  $('#shoot-sections').addEventListener('toggle',e=>{if(!e.target.matches('details[data-shoot-section]'))return;const id=e.target.dataset.shootSection;e.target.open?this.openSections.add(id):this.openSections.delete(id);},true);
  $('#shoot-results').addEventListener('change',e=>{const key=e.target.dataset.shootSelection;if(!key)return;e.target.checked?this.selected.add(key):this.selected.delete(key);this.renderSelection();});
  window.addEventListener('beforeunload',e=>{if(this.dirty||this.busy){e.preventDefault();e.returnValue='';}});
  this.render();
 }
 locked(){return this.busy||!this.loaded||!!this.draft.pending||!!this.draft.batch?.remaining.length;}
 setBusy(value){if(value!==this.busy){this.busy=value;this.actions.busy(value);}this.syncDisabled();}
 status(text){$('#shoot-status').textContent=text;}
 error(text){$('#shoot-error').textContent=text;$('#shoot-error').hidden=!text;}
 changed(){this.version++;this.dirty=true;$('#shoot-save-state').textContent='Saving…';clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>void this.persist().catch(e=>this.error(e.message)),450);this.renderPrompt();this.updateEstimate();}
 persist(){
  clearTimeout(this.saveTimer);const projectId=this.projectId,epoch=this.epoch,snapshot=structuredClone(this.draft),version=this.version;
  if(!this.loaded||!this.dirty)return this.queue;
  const work=this.queue.catch(()=>{}).then(async()=>{
   if(epoch!==this.epoch)return;
   const result=await this.actions.post('/api/shoot',{projectId,revision:this.revision,draft:snapshot});
   if(epoch!==this.epoch)return;
   this.revision=result.revision;if(version===this.version){this.dirty=false;$('#shoot-save-state').textContent='Saved in project';}
  });this.queue=work;return work.catch(error=>{$('#shoot-save-state').textContent='Not saved';throw error;});
 }
 show(projectId){
  if(this.loadingProject===projectId&&this.showTask)return this.showTask;
  this.loadingProject=projectId;
  const task=this.loadProject(projectId);this.showTask=task;
  return task.finally(()=>{if(this.showTask===task){this.showTask=null;this.loadingProject=null;}});
 }
 async loadProject(projectId){
  this.visible=true;clearTimeout(this.timer);
  if(projectId!==this.projectId||!this.loaded){
   this.setBusy(true);
   try{if(this.actions.subjectTypesEnabled?.()===false){this.loaded=false;throw Error('Open Apply Studio Update.command, then refresh to activate Character, Product and Location in SHOOT.');}await this.persist();this.epoch++;this.projectId=projectId;this.loaded=false;this.jobs=[];this.selected.clear();const epoch=this.epoch,result=await this.actions.api('/api/shoot?project='+encodeURIComponent(projectId));if(epoch!==this.epoch)return;this.draft=result.draft;this.revision=result.revision;this.loaded=true;this.dirty=false;this.status('');this.error('');$('#shoot-save-state').textContent=this.revision?'Saved in project':'';this.render();}
   catch(error){this.error(error.message);}finally{this.setBusy(false);}
  }
  await this.refresh();this.schedule();
 }
 hide(){this.visible=false;clearTimeout(this.timer);clearTimeout(this.estimateTimer);this.estimateVersion=(this.estimateVersion||0)+1;void this.persist().catch(e=>this.error(e.message));$('#shoot-picker').close();$('#shoot-import').close();}
 schedule(){clearTimeout(this.timer);if(this.visible)this.timer=setTimeout(async()=>{await this.refresh();this.schedule();},2500);}
 async refresh(){
  if(!this.loaded)return;const epoch=this.epoch,pending=this.draft.pending,resultVersion=this.resultVersion;
  try{
   const [jobs,llm]=await Promise.all([this.actions.api('/api/jobs?project='+encodeURIComponent(this.projectId)),pending&&!this.busy?this.actions.api('/api/llm/jobs?project='+encodeURIComponent(this.projectId)):Promise.resolve(null)]);
   if(epoch!==this.epoch)return;if(resultVersion===this.resultVersion&&!this.resultPending?.size)this.jobs=jobs.jobs;const known=new Set(this.draft.jobIds);for(const job of this.jobs)if(this.draft.batch?.id&&job.settings.shootBatchId===this.draft.batch.id){known.add(job.id);this.draft.batch.remaining=this.draft.batch.remaining.filter(r=>r!==job.settings.ratio);if(!this.draft.batch.jobIds.includes(job.id))this.draft.batch.jobIds.push(job.id);}
   if(known.size!==this.draft.jobIds.length){this.draft.jobIds=[...known].slice(-300);this.changed();this.syncDisabled();}
   if(llm&&pending&&this.draft.pending?.id===pending.id){const job=llm.jobs.find(j=>j.id===pending.id);if(!job||job.status!=='RUNNING'){
    const role=this.draft.pending.role;if(role==='refine'){await this.finishRefinement(job);this.renderResults();return;}this.draft.pending=null;
    try{if(job?.status==='COMPLETED'){const data=parseShootJSON(job.output);if(role==='source'){this.resetDescription(data,job.id);this.view='original';}else applySectionDescription(this.draft,role,data);this.status(role==='source'?'Description ready. Prompt and Direction now use this image.':`${referenceTitle(this.draft,role)} described. Other sections are unchanged.`);}
    else this.error(job?.error||'This analysis is no longer available in LLM history. Your existing edits are kept.');}catch(error){this.error(error.message);}
    this.changed();this.render();
   }}
   this.renderResults();
  }catch(error){if(epoch===this.epoch)this.error(error.message);}
 }
 referenceMarkup(role){
  const ref=this.draft.references[role];return ref?`<div class="shoot-reference"><img src="${assetURL(ref)}" alt="${esc(referenceTitle(this.draft,role))}"><div><strong>${esc(ref.name)}</strong><small>${ref.width} × ${ref.height}</small><button type="button" class="text-button" data-shoot-pick="${role}">Replace image</button>${['product','location'].includes(role)?`<button type="button" class="text-button" data-shoot-describe="${role}">Describe reference</button>`:''}</div><button type="button" class="icon-button" data-shoot-remove="${role}" aria-label="Remove ${referenceTitle(this.draft,role)}">${this.actions.icon('close')}</button></div>`:`<button type="button" class="dropzone shoot-drop" data-shoot-pick="${role}" aria-haspopup="dialog">${this.actions.icon('upload')}<strong>${role==='source'?'Add your original image':'Add '+referenceTitle(this.draft,role).toLowerCase()}</strong><span>Upload · Assets · Outfit · Character · ID · Favorites</span></button>`;
 }
 render(){
  $('#shoot-source-slot').innerHTML=this.referenceMarkup('source');this.renderSections();this.renderPlan();this.renderPrompt();this.renderResults();this.renderView();this.syncDisabled();
 }
 renderSections(){
  if(!this.draft.base){$('#shoot-sections').innerHTML='';return;}
  const kind=shootSubjectKind(this.draft);
  $('#shoot-sections').innerHTML=`<div class="shoot-subject-kind field"><label for="shoot-subject-kind">Main subject</label><select id="shoot-subject-kind">${SHOOT_SUBJECT_KINDS.map(k=>`<option value="${k}" ${k===kind?'selected':''}>${humanize(k)}</option>`).join('')}</select><p class="hint">Original: ${humanize(sourceSubjectKind(this.draft.base))}. Choose what your final image is about. Changing type clears the main reference and its subject/action edits.</p></div>`+shootSections(this.draft).map((section,index)=>{
   const on=this.draft.enabled.includes(section.id),fields=sectionFields(this.draft,section.id),count=Object.keys(this.draft.patches).filter(path=>sectionFor(path)===section.id&&activeShootField(this.draft,path)).length;
   return `<details class="shoot-section ${on?'changed':''}" data-shoot-section="${section.id}" ${this.openSections.has(section.id)?'open':''}><summary><span class="shoot-section-number">0${index+1}</span><span><strong>${section.name}</strong><small>${section.hint}</small></span><span class="shoot-section-state">${on?'Edited'+(count?' · '+count:''):'Original'}</span>${this.actions.icon('chevron')}</summary><div class="shoot-section-body"><div class="shoot-section-tools"><label><input type="checkbox" data-shoot-enable="${section.id}" ${on?'checked':''}> Replace this section</label><button type="button" class="text-button" data-shoot-reset="${section.id}">Restore original</button></div>${section.reference?`<div class="shoot-section-reference">${this.referenceMarkup(section.id)}</div>`:''}${section.id==='subject'&&kind==='character'?`<div class="shoot-outfit-choices" role="group" aria-label="Outfit source"><label class="shoot-checkbox"><input type="checkbox" id="shoot-keep-outfit" ${!this.draft.useAssetOutfit&&this.draft.keepOutfit&&!shootKindChanged(this.draft)?'checked':''} ${shootKindChanged(this.draft)?'disabled':''}> Keep outfit from original image</label><label class="shoot-checkbox"><input type="checkbox" id="shoot-reference-outfit" ${!this.draft.useAssetOutfit&&(!this.draft.keepOutfit||shootKindChanged(this.draft))?'checked':''}> Use outfit from character reference</label><label class="shoot-checkbox"><input type="checkbox" id="shoot-asset-outfit" ${this.draft.useAssetOutfit?'checked':''}> Use outfit from assets</label></div>${this.draft.useAssetOutfit?this.referenceMarkup('outfit'):''}`:''}${section.id==='style'?`<div class="shoot-mood-heading">Mood gallery <span>10 starting points</span></div><div class="shoot-moods">${SHOOT_MOODS.map(m=>`<button type="button" data-shoot-mood="${m.id}" title="${esc(m.light)}"><span style="--mood-a:${m.colors[0]};--mood-b:${m.colors[1]}" aria-hidden="true"></span>${m.name}</button>`).join('')}</div>`:''}<div class="shoot-fields">${fields.map((f,i)=>{const edited=on&&Object.hasOwn(this.draft.patches,f.path),value=f.path==='subject.hair'?(this.draft.patches[f.path]??''):(on?f.value:(this.draft.patches[f.path]??f.value));return `<div class="field ${edited?'edited':''}"><label for="shoot-field-${section.id}-${i}">${esc(f.path.split('.').slice(section.id==='style'?0:1).map(humanize).join(' / ')||humanize(f.path))}${Array.isArray(f.value)?'<small>One item per line</small>':''}</label><textarea id="shoot-field-${section.id}-${i}" rows="${String(inputValue(value)).length>150?4:2}" maxlength="12000" data-shoot-field="${esc(f.path)}" data-shoot-type="${Array.isArray(f.value)?'array':typeof f.value}" placeholder="${esc(shootFieldPlaceholder(this.draft,f.path))}">${esc(inputValue(value))}</textarea></div>`;}).join('')}</div></div></details>`;
  }).join('');
 }
 renderPlan(){
  const d=this.draft,m=SHOOT_MODELS.find(m=>m.id===d.model);$('#shoot-model').value=d.model;$('#shoot-llm-model').value=d.llmModel||LLM_MODELS[0].id;
  $('#shoot-resolution').innerHTML=m.resolutions.map(r=>`<option ${r===d.resolution?'selected':''}>${r}</option>`).join('');
  $('#shoot-quality-field').hidden=!m.qualities;$('#shoot-quality').innerHTML=(m.qualities||[]).map(r=>`<option ${r===d.quality?'selected':''}>${r}</option>`).join('');$('#shoot-count').value=d.count;
  $('#shoot-ratios').innerHTML=['original',...m.ratios.filter(r=>r!=='auto')].map(r=>`<label><input type="checkbox" data-shoot-ratio="${r}" ${d.ratios.includes(r)?'checked':''}><span>${r==='original'?'Match source':r}</span></label>`).join('');
  const match=resolvedRatios({...d,ratios:['original']})[0];$('#shoot-ratio-hint').textContent=d.references.source?`Match source: ${match==='auto'?'automatic':match+' · nearest supported ratio'}`:'Match source uses 1:1 until you add an image.';
  const n=resolvedRatios(d).length*d.count;$('#shoot-generate').textContent=d.batch?.remaining.length?`Resume ${d.batch.remaining.length} remaining ratio${d.batch.remaining.length===1?'':'s'}`:`Generate ${n} images`;
  this.updateEstimate();this.syncDisabled();this.renderSelection();
 }
 syncDisabled(){
  const locked=this.locked();$('#shoot-plan-fields').disabled=locked;
  for(const el of $('#shoot-sections').querySelectorAll('input,textarea,button,select'))el.disabled=locked;
  for(const el of $('#shoot-source-slot').querySelectorAll('button'))el.disabled=locked;
  for(const el of $('#shoot-picker').querySelectorAll('button,input'))el.disabled=this.busy;
  if($('#shoot-keep-outfit'))$('#shoot-keep-outfit').disabled=locked||shootKindChanged(this.draft);
  $('#shoot-describe').disabled=locked||!this.draft.references.source;$('#shoot-load-json').disabled=locked;
  $('#shoot-llm-model').disabled=locked;$('#shoot-generate').disabled=this.busy||!this.loaded||!!this.draft.pending||!this.draft.base;
  $('#shoot-cancel-batch').hidden=!this.draft.batch?.remaining.length;$('#shoot-cancel-batch').disabled=this.busy;
 }
 renderView(){
  const describing=this.draft.pending?.role==='source',source=!!this.draft.references.source;
  $('#shoot-empty').hidden=!!this.draft.base&&!describing||this.view==='results';$('#shoot-sections').hidden=!this.draft.base||describing||this.view!=='sections';$('#shoot-prompt-panel').hidden=!this.draft.base||describing||!['original','prompt'].includes(this.view);$('#shoot-results-panel').hidden=this.view!=='results';
  $('#shoot-empty h3').textContent=describing?'Describing your image…':source?'Your image is ready to describe.':'Build a shoot from an image.';
  $('#shoot-empty p').textContent=describing?'The new description will populate Prompt and all six Direction sections when it is ready.':source?'Click Describe image to create a fresh prompt and populate the Direction sections for this image.':'Describe your reference, then shape the subject, product, action, framing, location and photographic style independently.';
  $('#shoot-empty .shoot-empty-steps').hidden=source||describing;
  for(const button of document.querySelectorAll('[data-shoot-view]'))button.setAttribute('aria-pressed',String(button.dataset.shootView===this.view));
  this.renderPrompt();
 }
 renderPrompt(){
  const original=this.view==='original',refined=this.draft.refinement,working=this.draft.pending?.role==='refine',ready=!!refined?.prompt,stale=ready&&!shootRefinementReady(this.draft);
  const ratios=resolvedRatios(this.draft).length;$('#shoot-plan-hint').textContent=`${ratios} ratio${ratios===1?'':'s'} × ${this.draft.count} variations · ${ready&&!stale?'Uses saved refined prompt · Comfy image generation':'Refines with Comfy, then generates with Comfy Router'}`;
  $('#shoot-prompt-title').textContent=original?'Original description':'Refined generation prompt';
  $('#shoot-prompt-hint').textContent=original?'The prompt created from your image description. Choose Direction to make changes.':working?'Describing your references and refining your Direction changes before generating images…':!ready?'Click Generate images to describe your selected references and build the final prompt. Your images will be generated from that prompt.':stale?'Direction has changed. This is the previous generation prompt; Generate images will create an updated version.':'The exact prompt used for your images. Changing the image model, resolution, ratios or variations reuses this prompt unchanged.';
  const prompt=original&&this.draft.base?JSON.stringify(this.draft.base,null,2):refined?.prompt;
  $('#shoot-prompt').textContent=prompt?(this.format==='json'?prompt:shootPlainText(this.draft,{original,prompt})):'';
  $('#shoot-prompt').hidden=!prompt;$('#shoot-copy').disabled=!prompt;$('#shoot-download-prompt').disabled=!prompt;
  for(const button of document.querySelectorAll('[data-shoot-format]'))button.setAttribute('aria-pressed',String(button.dataset.shootFormat===this.format));
 }
 async workspaceAction(event){
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.shootView){this.view=b.dataset.shootView;this.renderView();return;}
  if(b.dataset.shootLayout){this.resultLayout=b.dataset.shootLayout;try{localStorage.setItem('fwrd-shoot-layout',this.resultLayout);}catch{}this.renderResults();return;}
  if(b.hasAttribute('data-shoot-delete-failed')){await this.deleteFailedResult(b.dataset.shootJob,Number(b.dataset.shootDeleteFailed));return;}
  if(b.dataset.shootDelete){await this.resultAction(b.dataset.shootDelete,'delete');return;}
  if(b.dataset.shootFormat){this.format=b.dataset.shootFormat;this.renderPrompt();return;}
  if(b.dataset.shootPick||b.dataset.shootRemove||b.dataset.shootDescribe){this.referenceAction(event);return;}
  if(b.dataset.shootReset&&!this.locked()){resetSection(this.draft,b.dataset.shootReset);this.changed();this.renderSections();return;}
  if(b.dataset.shootMood&&!this.locked()){applyMood(this.draft,b.dataset.shootMood);this.changed();this.renderSections();return;}
  if(b.dataset.shootFavorite||b.dataset.shootAsset){await this.resultAction(b.dataset.shootFavorite||b.dataset.shootAsset,b.dataset.shootFavorite?'favorite':'asset');return;}
  if(b.dataset.shootPreview){const item=this.resultMedia().find(i=>i.key===b.dataset.shootPreview);if(item)this.actions.preview(item.job,item.media,this.resultMedia());return;}
  if(b.id==='shoot-copy'){try{await navigator.clipboard.writeText($('#shoot-prompt').textContent);this.actions.toast('SHOOT prompt copied.');}catch{this.actions.toast('Select the prompt and copy it with ⌘/Ctrl C.');}return;}
  if(b.id==='shoot-download-prompt'){download(new Blob([$('#shoot-prompt').textContent],{type:this.format==='json'?'application/json':'text/plain'}),projectDownloadName(this.actions.projectName(this.projectId),this.view==='original'?'SHOOT-description':'SHOOT-refined-prompt',this.format==='json'?'json':'txt'));return;}
  if(b.id==='shoot-clear-selection'){this.selected.clear();this.renderResults();return;}
  if(b.id==='shoot-delete-selected'){await this.deleteSelected();return;}
  if(b.id==='shoot-select-all'){const items=this.resultMedia();this.selected=this.selected.size===items.length?new Set():new Set(items.map(x=>x.key));this.renderResults();return;}
  if(b.id==='shoot-download-results')await this.downloadResults();
 }
 editField(event){
  const field=event.target;if(!field.dataset.shootField||this.locked())return;
  const path=field.dataset.shootField,section=sectionFor(path);let value=field.value;
  if(field.dataset.shootType==='array')value=value.split('\n').map(x=>x.trim()).filter(Boolean);
  else if(field.dataset.shootType==='number'){value=Number(value);if(!Number.isFinite(value))return;}
  else if(field.dataset.shootType==='boolean')value=value==='true';
  const original=getPath(this.draft.base,path);if(JSON.stringify(value)===JSON.stringify(original))delete this.draft.patches[path];else this.draft.patches[path]=value;
  if(!this.draft.enabled.includes(section))this.draft.enabled.push(section);
  const card=field.closest('.shoot-section');card.classList.add('changed');card.querySelector('[data-shoot-enable]').checked=true;card.querySelector('.shoot-section-state').textContent='Edited';field.closest('.field').classList.toggle('edited',Object.hasOwn(this.draft.patches,path));this.changed();
 }
 changeSection(event){
  if(this.locked())return;
  if(event.target.id==='shoot-subject-kind'){changeShootSubjectKind(this.draft,event.target.value);this.openSections.add('subject');this.changed();this.renderSections();this.syncDisabled();return;}
  if(event.target.dataset.shootEnable){const section=event.target.dataset.shootEnable;this.draft.enabled=this.draft.enabled.filter(s=>s!==section);if(event.target.checked)this.draft.enabled.push(section);this.changed();this.renderSections();}
  if(event.target.id==='shoot-asset-outfit'){this.draft.useAssetOutfit=event.target.checked;if(event.target.checked&&!this.draft.enabled.includes('subject'))this.draft.enabled.push('subject');this.changed();this.renderSections();if(event.target.checked&&!this.draft.references.outfit)void this.openPicker('outfit');return;}
  if(['shoot-keep-outfit','shoot-reference-outfit'].includes(event.target.id)){this.draft.useAssetOutfit=false;this.draft.keepOutfit=event.target.id==='shoot-keep-outfit'?event.target.checked:!event.target.checked;$('#shoot-keep-outfit').checked=this.draft.keepOutfit;$('#shoot-reference-outfit').checked=!this.draft.keepOutfit;this.changed();this.renderSections();}
 }
 referenceAction(event){
  if(this.locked())return;const b=event.target.closest('button');if(!b)return;
  if(b.dataset.shootPick)void this.openPicker(b.dataset.shootPick);
  if(b.dataset.shootRemove)this.replaceReference(b.dataset.shootRemove,null);
  if(b.dataset.shootDescribe)void this.describe(b.dataset.shootDescribe);
 }
 createPicker(){
  const dialog=document.createElement('dialog');dialog.id='shoot-picker';dialog.setAttribute('aria-labelledby','shoot-picker-title');dialog.innerHTML=`<div class="dialog-heading"><h2 id="shoot-picker-title">Add an image</h2><button type="button" class="icon-button" data-shoot-picker-close aria-label="Close image picker">${this.actions.icon('close')}</button></div><button type="button" class="secondary shoot-wide" id="shoot-upload">${this.actions.icon('upload')} Upload from computer</button><p class="hint">PNG, JPG or WebP · up to 10 MB</p><input type="file" id="shoot-file" accept="image/png,image/jpeg,image/webp" hidden><div class="shoot-tabs" role="group" aria-label="Image collection"><button type="button" data-shoot-collection="assets" aria-pressed="true">Assets</button><button type="button" data-shoot-collection="outfit" aria-pressed="false">Outfit</button><button type="button" data-shoot-collection="character" aria-pressed="false">Character</button><button type="button" data-shoot-collection="id" aria-pressed="false">ID</button><button type="button" data-shoot-collection="favorites" aria-pressed="false">Favorites</button></div><input type="search" id="shoot-picker-search" placeholder="Search images" aria-label="Search SHOOT images"><div id="shoot-picker-grid"></div><p id="shoot-picker-status" class="hint" role="status"></p>`;document.body.append(dialog);
  dialog.querySelector('[data-shoot-picker-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>this.pickerVersion=(this.pickerVersion||0)+1);
  $('#shoot-upload').addEventListener('click',()=>$('#shoot-file').click());$('#shoot-file').addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';if(file)void this.importFile(file,this.pickerRole);});
  $('#shoot-picker-search').addEventListener('input',()=>this.renderPicker());
  dialog.querySelectorAll('[data-shoot-collection]').forEach(b=>b.addEventListener('click',()=>{this.collection=b.dataset.shootCollection;this.renderPicker();}));
  $('#shoot-picker-grid').addEventListener('click',e=>{const b=e.target.closest('[data-shoot-library]');if(b)void this.importSource(this.sources[Number(b.dataset.shootLibrary)],this.pickerRole);});
  for(const root of [$('#shoot-source-slot'),$('#shoot-sections')]){
   root.addEventListener('dragover',e=>{if(e.target.closest('[data-shoot-pick]')&&e.dataTransfer.types.includes('Files'))e.preventDefault();});
   root.addEventListener('drop',e=>{const target=e.target.closest('[data-shoot-pick]');if(!target)return;e.preventDefault();if(this.locked())return;const files=[...e.dataTransfer.files];if(files.length!==1){this.error('Choose one image for each reference slot.');return;}void this.importFile(files[0],target.dataset.shootPick);});
  }
 }
 async openPicker(role){
  if(this.locked())return;this.pickerRole=role;$('#shoot-upload').hidden=role==='outfit';$('#shoot-picker .shoot-tabs').hidden=role==='outfit';this.collection=role==='outfit'?'outfit':'assets';this.sources=[];this.pickerError='';$('#shoot-picker-title').textContent=referenceTitle(this.draft,role);$('#shoot-picker-search').value='';this.renderPicker();$('#shoot-picker-status').textContent='Loading images…';$('#shoot-picker').showModal();const version=this.pickerVersion=(this.pickerVersion||0)+1;
  const results=await Promise.allSettled([this.actions.api('/api/assets'),this.actions.api('/api/jobs?project='+encodeURIComponent(this.projectId))]);if(version!==this.pickerVersion)return;
  this.pickerErrors=Object.fromEntries(results.map((r,i)=>[i?'favorites':'assets',r.status==='rejected'?r.reason.message:'']));this.sources=llmLibrarySources(results[0].status==='fulfilled'?results[0].value.assets.filter(a=>role!=='outfit'||a.category==='outfit'||a.sources?.some(s=>s.category==='outfit')):[],results[1].status==='fulfilled'?results[1].value.jobs:[],this.projectId);this.renderPicker();
 }
 renderPicker(){
  const query=$('#shoot-picker-search').value.toLowerCase(),entries=this.sources.map((s,index)=>({...s,index})).filter(s=>s.collection===this.collection&&s.name.toLowerCase().includes(query));
  $('#shoot-picker-grid').innerHTML=entries.map(s=>`<button type="button" class="shoot-library-image" data-shoot-library="${s.index}" ${s.disabled?'disabled':''}><img src="${esc(s.url)}" alt="" loading="lazy"><strong>${esc(s.name)}</strong><small>${esc(s.reason||s.label)}</small></button>`).join('');
  $('#shoot-picker-status').textContent=this.pickerError||this.pickerErrors?.[this.collection==='favorites'?'favorites':'assets']||(entries.length?`${entries.length} images · ${this.collection!=='favorites'?'all projects':'this project'}`:this.pickerRole==='outfit'?'No Outfit assets yet. Save an image to Outfit assets first.':'No images here yet. Choose another collection or upload an image.');
  for(const b of document.querySelectorAll('[data-shoot-collection]'))b.setAttribute('aria-pressed',String(b.dataset.shootCollection===this.collection));
 }
 async importSource(source,role){
  if(this.locked()||!source||source.disabled)return;this.setBusy(true);this.error('');
  try{const r=await fetch(source.url);if(!r.ok)throw Error('Could not load this image.');if(Number(r.headers.get('Content-Length'))>10*1024**2){await r.body?.cancel();throw Error('Choose an image up to 10 MB.');}const blob=await r.blob();await this.acceptFile(new File([blob],source.name,{type:source.contentType}),role);}
  catch(e){this.error(e.message);$('#shoot-picker-status').textContent=e.message;}finally{this.setBusy(false);}
 }
 async importFile(file,role){if(this.locked())return;this.setBusy(true);this.error('');try{await this.acceptFile(file,role);}catch(e){this.error(e.message);$('#shoot-picker-status').textContent=e.message;}finally{this.setBusy(false);}}
 async acceptFile(file,role){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024**2)throw Error('Choose a PNG, JPG or WebP image up to 10 MB.');
  const preview=URL.createObjectURL(file);let image;try{image=await imageLoaded(preview);}finally{URL.revokeObjectURL(preview);}
  const metadata={width:image.naturalWidth,height:image.naturalHeight},result=await this.actions.api('/api/assets/import',{method:'POST',headers:{'Content-Type':file.type,'X-Media-Metadata':JSON.stringify(metadata),'X-File-Name':encodeURIComponent(file.name),'X-Project-Id':this.projectId},body:file});
  this.replaceReference(role,{assetId:result.asset.id,name:file.name.slice(0,250),contentType:file.type,...metadata});$('#shoot-picker').close();
  this.status(role==='source'?'New image ready. Click Describe image to populate Prompt and Direction.':role==='subject'?`${referenceTitle(this.draft,role)} added. Generate will adapt the scene to this main subject.`:`${referenceTitle(this.draft,role)} added. It will guide only this section.`);
 }
 resetDescription(base=null,sourceId=null){
  Object.assign(this.draft,{base,subjectKind:'auto',sourceJobId:sourceId,patches:{},enabled:[],pending:null,refinement:null,batch:null});
 }
 replaceReference(role,reference){
  if(reference)this.draft.references[role]=reference;else delete this.draft.references[role];
  if(role==='source'&&reference){this.resetDescription();this.view='original';}
  else if(reference){const section=role==='outfit'?'subject':role;if(!this.draft.enabled.includes(section))this.draft.enabled.push(section);if(role==='outfit')this.draft.useAssetOutfit=true;}
  this.changed();this.render();
 }
 async stageReferences(refs){
  if(this.draft.useAssetOutfit&&shootSubjectKind(this.draft)==='character'&&this.draft.enabled.includes('subject')&&!this.draft.references.outfit)throw Error('Choose an Outfit asset before generating.');
  const uploaded=[];try{for(const ref of refs){const response=await fetch(assetURL(ref));if(!response.ok)throw Error(`${ref.name} is no longer available. Choose its reference again.`);const blob=await response.blob();if(blob.size>10*1024**2)throw Error('A reference is over 10 MB.');const data=await this.actions.api('/api/uploads',{method:'POST',headers:{'Content-Type':ref.contentType,'X-Media-Metadata':JSON.stringify({width:ref.width,height:ref.height}),'X-File-Name':encodeURIComponent(ref.name),'X-Project-Id':this.projectId},body:blob});uploaded.push({id:data.id,kind:'image',contentType:ref.contentType,bytes:blob.size,metadata:{width:ref.width,height:ref.height}});}return uploaded;}catch(error){await this.unstage(uploaded);throw error;}
 }
 async unstage(refs){await Promise.allSettled(refs.map(ref=>this.actions.api('/api/uploads/'+ref.id,{method:'DELETE'})));}
 async describe(role){
  if(this.locked()||!this.draft.references[role])return;
  this.setBusy(true);this.error('');let refs=[];
  try{await this.persist();const config=await this.actions.api('/api/llm/config');if(!config.keyConfigured){this.actions.connectLlm();return;}if(role==='source'&&!config.shootSubjectTypes)throw Error('Open Apply Studio Update.command, then refresh to activate Character, Product and Location descriptions.');refs=await this.stageReferences([this.draft.references[role]]);
   const {job}=await this.actions.post('/api/llm/generate',{projectId:this.projectId,model:this.draft.llmModel||LLM_MODELS[0].id,task:'image',shootDescription:role==='source',format:'json',maxTokens:8192,instruction:role==='source'?'Describe the image in detailed photographic terms so its subject, action, composition, environment and visual style can be edited independently.':`Describe the ${role} in this reference carefully. This will be used to replace only the ${role} in another scene.`,referenceIds:refs.map(r=>r.id)});
   this.draft.pending={id:job.id,role};if(role==='source')this.view='original';this.changed();await this.persist();this.renderView();this.status('Describing with Comfy… You can leave this section; it resumes when you return.');
  }catch(e){this.error(e.message);}finally{await this.unstage(refs);this.setBusy(false);}
 }
 createImportDialog(){
  const dialog=document.createElement('dialog');dialog.id='shoot-import';dialog.setAttribute('aria-labelledby','shoot-import-title');dialog.innerHTML=`<div class="dialog-heading"><h2 id="shoot-import-title">Start from JSON</h2><button type="button" class="icon-button" id="shoot-import-close" aria-label="Close JSON import">${this.actions.icon('close')}</button></div><label for="shoot-saved-output">Saved JSON outputs · current project</label><select id="shoot-saved-output"><option value="">Choose a saved output</option></select><label for="shoot-json-input">Or paste a JSON prompt</label><textarea id="shoot-json-input" rows="12" maxlength="100000" placeholder='{"scene_description": "…", "subject": {…}}'></textarea><p class="hint">Loading a new description resets the six section edits. Your images and generated results stay saved.</p><p class="error" id="shoot-import-error" hidden></p><button type="button" class="primary" id="shoot-import-apply">Use this description</button>`;document.body.append(dialog);
  $('#shoot-import-close').addEventListener('click',()=>dialog.close());$('#shoot-saved-output').addEventListener('change',()=>{const job=this.savedOutputs?.find(j=>j.id===$('#shoot-saved-output').value);if(job)$('#shoot-json-input').value=job.output;});
  $('#shoot-import-apply').addEventListener('click',()=>{if(this.locked())return;try{this.useDescription($('#shoot-json-input').value,$('#shoot-saved-output').value||null);dialog.close();}catch(e){$('#shoot-import-error').textContent=e.message;$('#shoot-import-error').hidden=false;}});
 }
 async openImport(){
  if(this.locked())return;$('#shoot-import-error').hidden=true;$('#shoot-json-input').value='';$('#shoot-saved-output').innerHTML='<option value="">Loading…</option>';$('#shoot-import').showModal();const epoch=this.epoch;
  try{const data=await this.actions.api('/api/llm/jobs?project='+encodeURIComponent(this.projectId));if(epoch!==this.epoch)return;this.savedOutputs=data.jobs.filter(j=>j.status==='COMPLETED'&&j.settings.format==='json');$('#shoot-saved-output').innerHTML='<option value="">Choose a saved output</option>'+this.savedOutputs.map(j=>`<option value="${esc(j.id)}">${esc(llmOutputTitle(j))}</option>`).join('');}
  catch(e){$('#shoot-saved-output').innerHTML='<option value="">Saved outputs unavailable</option>';$('#shoot-import-error').textContent=e.message;$('#shoot-import-error').hidden=false;}
 }
 useDescription(text,sourceId=null){this.resetDescription(parseShootJSON(text),sourceId);this.view='original';this.changed();this.render();}
 async importOutput(job){await this.show(job.projectId);if(!this.loaded||this.locked())return;if(this.draft.base&&!window.confirm('Use this JSON as a new SHOOT description? The current section edits will reset.'))return;this.useDescription(job.output,job.id);}
 updateEstimate(){
  clearTimeout(this.estimateTimer);const revision=this.estimateVersion=(this.estimateVersion||0)+1;
  if(!this.draft.base){$('#shoot-cost').textContent='—';return;}
  const refs=shootReferences(this.draft).map(r=>({kind:'image',contentType:r.contentType,metadata:{width:r.width,height:r.height},bytes:1}));let plans;
  try{plans=shootPlans(this.draft,refs);}catch(e){$('#shoot-cost').textContent='—';$('#shoot-cost').title=e.message;return;}
  const paint=estimates=>{if(revision!==this.estimateVersion)return;const valid=estimates.every(e=>e.available);if(!valid){$('#shoot-cost').textContent='—';return;}const minimum=estimates.reduce((n,e)=>n+(e.minimum??e.amount??0),0),maximum=estimates.reduce((n,e)=>n+(e.maximum??e.amount??0),0);const money=v=>v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:3});$('#shoot-cost').textContent='≈'+money(minimum)+(minimum!==maximum?'–'+money(maximum):'')+(estimates.some(e=>e.extraUsage)?' +':'');$('#shoot-cost').title='Image generation estimate. Comfy descriptions and prompt refinement are billed separately.';};
  const fallback=plans.map(p=>estimateReferenceCost(p,refs));paint(fallback);
  if(!this.actions.context().keyConfigured||refs.length)return;
  this.estimateTimer=setTimeout(async()=>{const results=await Promise.allSettled(plans.map(p=>this.actions.post('/api/estimate',{...p,referenceIds:[]})));paint(results.map((r,i)=>r.status==='fulfilled'&&r.value.available?r.value:fallback[i]));},700);
 }
 async startRefinement(refs){
  const config=await this.actions.api('/api/llm/config');
  if(shootSubjectKind(this.draft)!=='character'&&!config.shootProductRefinement)throw Error('Open Apply Studio Update.command, then refresh to activate the product refinement fix.');
  if(!config.shootSubjectTypes)throw Error('Open Apply Studio Update.command, then refresh to activate Character, Product and Location direction.');
  if(!config.shootReferenceAnalysis)throw Error('Quit and reopen FWRD.STUDIO.V2 to activate reference-aware prompt refinement.');
  if(shootReferences(this.draft).some(r=>r.role==='subject')&&!config.shootConciseSubject)throw Error('Open Apply Studio Update.command, then refresh to activate brief subject descriptions.');
  if(!config.keyConfigured){this.actions.connectLlm();return;}
  await this.persist();this.view='prompt';this.status('Refining your prompt and describing replacement references…');
  const key=shootDirectionKey(this.draft),shootDraft={...this.draft,refinement:null,pending:null,batch:null};
  const {job}=await this.actions.post('/api/llm/generate',{projectId:this.projectId,model:this.draft.llmModel,task:'shoot',format:'json',maxTokens:16384,referenceIds:refs.map(r=>r.id),shootDraft});
  this.draft.refinement={jobId:job.id,key,prompt:null};this.draft.pending={id:job.id,role:'refine'};
  this.changed();await this.persist();this.renderView();
 }
 async finishRefinement(job){
  const pending=this.draft.pending,refined=this.draft.refinement;
  if(pending?.role!=='refine')return;
  this.setBusy(true);this.draft.pending=null;let generate=false;
  try{
   if(job?.status!=='COMPLETED')throw Error(job?.error||'The prompt refinement is no longer available. No images were submitted.');
   if(!refined||refined.jobId!==job.id||refined.key!==shootDirectionKey(this.draft))throw Error('Direction changed during refinement. Generate again to use your latest changes.');
   parseShootJSON(job.output);refined.prompt=job.output;
   this.draft.batch={id:crypto.randomUUID(),remaining:resolvedRatios(this.draft),jobIds:[]};
   this.view='prompt';this.status('Refined prompt ready. Starting your images…');generate=true;
  }catch(error){this.error(error.message);}
  try{this.changed();await this.persist();}catch(error){generate=false;this.error(error.message);}
  finally{this.setBusy(false);this.render();}
  if(generate)await this.generate();
 }
 async generate(){
  if(this.busy||!this.loaded||this.draft.pending||!this.draft.base)return;
  if(!this.actions.context().keyConfigured){this.actions.connect();return;}
  this.setBusy(true);this.error('');let refs=[];
  try{
   refs=await this.stageReferences(shootReferences(this.draft));
   if(!this.draft.batch?.remaining.length&&!shootRefinementReady(this.draft)){
    shootPlans(this.draft,refs); // Validate model, ratios and reference limits before paid analysis.
    await this.startRefinement(refs);return;
   }
   if(!shootRefinementReady(this.draft))throw Error('This batch has no matching refined prompt. Skip remaining ratios, then generate a new shoot.');
   const plans=shootPlans(this.draft,refs,this.draft.refinement.prompt);
   // New image settings need a new batch receipt, not a new prompt analysis.
   if(!this.draft.batch?.remaining.length)this.draft.batch={id:crypto.randomUUID(),remaining:resolvedRatios(this.draft),jobIds:[]};
   this.changed();await this.persist();
   const batch=this.draft.batch;
   for(const ratio of [...batch.remaining]){
    this.status('Starting '+ratio+' · '+this.draft.count+' variations…');
    const plan=plans.find(p=>p.ratio===ratio);if(!plan)throw Error('This ratio is no longer supported. Skip remaining ratios and choose a new plan.');
    const {job}=await this.actions.post('/api/generate',{...plan,projectId:this.projectId,referenceIds:refs.map(r=>r.id),shootBatchId:batch.id});
    if(!this.draft.jobIds.includes(job.id))this.draft.jobIds.push(job.id);this.draft.jobIds=this.draft.jobIds.slice(-300);
    if(!batch.jobIds.includes(job.id))batch.jobIds.push(job.id);batch.remaining=batch.remaining.filter(r=>r!==ratio);this.jobs=this.jobs.filter(j=>j.id!==job.id);this.jobs.unshift(job);this.actions.submitted(job);this.changed();await this.persist();
   }
   this.view='results';this.status('Shoot started. Results save with this project as each variation finishes.');
  }catch(error){this.error(error.message+(this.draft.batch?.remaining.length?' Submitted ratios stay saved. Check Results, then resume the remaining ratios when ready.':''));}
  finally{await this.unstage(refs);this.setBusy(false);this.render();}
 }
 shootJobs(){return generationFeed(this.jobs,'shoot',this.draft.jobIds);}
 visibleShootJobs(now=new Date()){return this.shootJobs().filter(job=>inHistoryPeriod(job.createdAt,this.historyPeriod,now));}
 resultMedia(jobs=this.visibleShootJobs()){return jobs.flatMap(job=>(job.tasks||[]).flatMap(task=>(task.outputs||[]).filter(media=>!media.deleted&&!media.deletedAt&&media.contentType?.startsWith('image/')).map(media=>({job,media,key:job.id+':'+media.id}))));}
 async deleteFailedResult(jobId,taskIndex){
  const job=this.visibleShootJobs().find(job=>job.id===jobId),task=job?.tasks.find((task,index)=>(task.taskIndex??index)===taskIndex);
  const key=jobId+':task:'+taskIndex;
  if(!task||!['FAILED','UNKNOWN'].includes(task.status)||this.deletingResults||this.resultPending.has(key))return;
  this.resultPending.add(key);this.actions.busy(true);this.renderResults();
  try{await this.actions.deleteFailedResult(jobId,taskIndex,this.projectId);}
  catch(error){this.actions.toast(error.message);}
  finally{this.resultPending.delete(key);this.actions.busy(false);this.renderResults();}
 }
 async resultAction(key,action){
  const item=this.resultMedia().find(i=>i.key===key);if(!item||this.deletingResults||this.resultPending.has(key))return;
  this.resultPending.add(key);this.resultVersion++;this.actions.busy(true);this.renderResults();
  try{
   if(action==='favorite'){
    const result=await this.actions.favorite(item.job.id,item.media.id,!item.media.favorite,item);
    if(result)item.media.favorite=result.favorite;
   }else if(action==='delete')await this.actions.deleteResult(item.job.id,item.media.id,this.projectId);
   else await this.actions.saveAsset(item.job.id,item.media.id,item);
  }catch(error){this.actions.toast(error.message);}
  finally{this.resultPending.delete(key);this.resultVersion++;this.actions.busy(false);this.renderResults();}
 }
 syncResultJob(jobId,job){
  this.resultVersion++;this.jobs=this.jobs.filter(j=>j.id!==jobId);if(job)this.jobs.push(job);this.jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));this.renderResults();
 }
 resultActions(job,media){
  const key=job.id+':'+media.id,pending=this.resultPending.has(key),favorite=!!media.favorite;
  return `<div class="shoot-result-buttons"><button type="button" class="favorite-action ${favorite?'saved':''}" data-shoot-favorite="${esc(key)}" aria-pressed="${favorite}" aria-label="${favorite?'Remove from':'Add to'} Favorites" title="${favorite?'Remove from':'Add to'} Favorites" ${pending?'disabled':''}>${this.actions.icon('star')} ${favorite?'Favorited':'Favorite'}</button>${this.actions.assetsEnabled()?`<button type="button" data-shoot-asset="${esc(key)}" class="asset-save-action ${media.savedToAssets?'saved':''}" aria-pressed="${!!media.savedToAssets}" aria-label="${media.savedToAssets?'Saved in Assets':'Add to Asset Library'}" title="${media.savedToAssets?'Saved in Assets':'Add to Asset Library'}" ${pending?'disabled':''}>${this.actions.icon('box')} ${media.savedToAssets?'Saved':'Assets'}</button>`:''}<a class="shoot-result-download" href="/api/download?job=${encodeURIComponent(job.id)}&media=${encodeURIComponent(media.id)}">${this.actions.icon('download')} Download</a><button type="button" class="shoot-result-delete" data-shoot-delete="${esc(key)}" aria-label="Delete image" title="Delete image" ${pending?'disabled':''}>${this.actions.icon('trash')} Delete</button></div>`;
 }
 renderResults(){
  const allJobs=this.shootJobs(),jobs=this.visibleShootJobs(),signature=JSON.stringify([this.resultLayout,this.historyPeriod,allJobs,jobs.map(job=>job.id),[...this.selected],[...this.resultPending]]);if(signature===this.resultsSignature)return;this.resultsSignature=signature;
  $('#shoot-results').dataset.layout=this.resultLayout;for(const button of document.querySelectorAll('[data-shoot-layout]'))button.setAttribute('aria-pressed',String(button.dataset.shootLayout===this.resultLayout));
  const items=this.resultMedia(jobs),total=this.resultMedia(allJobs).length,valid=new Set(items.map(i=>i.key));this.selected=new Set([...this.selected].filter(k=>valid.has(k)));
  $('#shoot-result-count').textContent=total||'';$('#shoot-results-empty').hidden=!!jobs.length;
  $('#shoot-history-count').textContent=(this.historyPeriod==='all'?total:items.length+' of '+total)+' image'+(total===1?'':'s');
  $('#shoot-results-empty').textContent=allJobs.length?'No SHOOT results in this period. Choose another period or All time.':'Your SHOOT images will appear here.';
  $('#shoot-results').innerHTML=jobs.map(job=>`<section class="shoot-result-group"><h3>${esc(job.settings.ratio)} <span>${esc(job.modelName)} · ${esc(job.settings.resolution)}</span></h3><div class="shoot-result-grid">${job.tasks.map((task,index)=>({...task,taskIndex:task.taskIndex??index})).filter(task=>!task.deletedAt&&(task.status!=='COMPLETED'||task.outputs?.some(m=>!m.deleted&&!m.deletedAt))).map(task=>task.outputs?.some(m=>!m.deleted&&!m.deletedAt)?task.outputs.filter(m=>!m.deleted&&!m.deletedAt).map(media=>`<article class="shoot-result-card"><label class="shoot-result-selection"><input type="checkbox" data-shoot-selection="${job.id+':'+media.id}" ${this.selected.has(job.id+':'+media.id)?'checked':''} ${this.deletingResults?'disabled':''} aria-label="Select ${esc(job.settings.ratio)} variation"><span>Select</span></label><button type="button" class="media-preview" data-shoot-preview="${esc(job.id+':'+media.id)}" aria-label="Preview generated image"><img src="${mediaURL(job,media)}" alt="${esc(job.settings.ratio)} shoot variation" loading="lazy"></button>${this.resultActions(job,media)}</article>`).join(''):`<div class="shoot-result-placeholder" role="status">${['COMPLETED','FAILED','UNKNOWN','CANCELLED'].includes(task.status)?esc(task.error||'No image was returned.'):this.actions.icon('spark')+'<span>Creating variation…</span>'}${['FAILED','UNKNOWN'].includes(task.status)?`<button type="button" class="shoot-failed-delete" data-shoot-job="${esc(job.id)}" data-shoot-delete-failed="${task.taskIndex}" aria-label="Delete failed generation" ${this.resultPending.has(job.id+':task:'+task.taskIndex)?'disabled':''}>${this.actions.icon('trash')} Delete</button>`:''}</div>`).join('')}</div></section>`).join('');this.renderSelection();
 }
 renderSelection(){const n=this.selected.size;$('#shoot-selected-count').textContent=n+' selected';$('#shoot-download-results').disabled=!n||this.busy;$('#shoot-download-results').textContent='Download selection';$('#shoot-select-all').disabled=!this.resultMedia().length||this.busy;$('#shoot-clear-selection').disabled=!n||this.busy;$('#shoot-delete-selected').disabled=!n||this.busy||!!this.resultPending.size;$('#shoot-delete-selected').textContent=this.deletingResults?'Deleting…':'Delete selected';}
 async deleteSelected(){
  const items=this.resultMedia().filter(item=>this.selected.has(item.key));if(!items.length||this.busy||this.resultPending.size)return;
  this.deletingResults=true;this.setBusy(true);for(const item of items)this.resultPending.add(item.key);this.resultVersion++;this.renderResults();
  try{await this.actions.deleteResults(items.map(item=>({jobId:item.job.id,mediaId:item.media.id})),this.projectId);}
  catch(error){this.actions.toast(error.message);}
  finally{this.deletingResults=false;for(const item of items)this.resultPending.delete(item.key);this.resultVersion++;this.setBusy(false);this.renderResults();}
 }
 async downloadResults(){
  const items=this.resultMedia().filter(i=>this.selected.has(i.key));if(!items.length||this.busy)return;
  this.setBusy(true);this.error('');
  try{
   const result=await this.actions.post('/api/downloads/batch',{projectId:this.projectId,items:items.map(i=>({jobId:i.job.id,mediaId:i.media.id}))});const a=document.createElement('a');a.href=result.url;a.download=result.name;a.click();
  }catch(error){this.error(error.message);}finally{this.setBusy(false);this.renderSelection();}
 }
}
