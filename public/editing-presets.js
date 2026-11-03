import {EFFECTS,presetSettings,normalizeEdit} from './editing-models.js';
const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const effectNames=settings=>normalizeEdit(settings).effects.map(e=>EFFECTS.find(f=>f.id===e.id).name).join(' → ')||'Original';
const label=kind=>kind==='color'?'Color Grading':'Effects';

export class EditingPresets{
 constructor(actions){
  this.actions=actions;this.presets=[];this.working=false;
  $('.edit-heading').insertAdjacentHTML('afterend',`<div class="edit-preset-toolbar"><button type="button" class="secondary" id="edit-preset-save">${actions.icon('plus')} Save preset</button><button type="button" class="secondary" id="edit-preset-gallery">${actions.icon('canvas')} Preset gallery</button><span>Keep a look. Use it again.</span></div>`);
  this.gallery=document.createElement('dialog');this.gallery.id='edit-presets';this.gallery.setAttribute('aria-labelledby','edit-presets-title');
  this.gallery.innerHTML=`<div class="dialog-heading"><div><span class="eyebrow" id="edit-presets-kind"></span><h2 id="edit-presets-title">Preset gallery</h2></div><button type="button" class="icon-button" data-preset-close aria-label="Close preset gallery">${actions.icon('close')}</button></div><p class="preset-intro">Your saved looks, available in every project.</p><div class="preset-filters"><input type="search" id="edit-presets-search" placeholder="Search presets" aria-label="Search presets"><select id="edit-presets-sort" aria-label="Sort presets"><option value="newest">Newest first</option><option value="name">Name A–Z</option></select></div><div class="preset-collections" role="group" aria-label="Preset collection"><button type="button" data-preset-collection="saved" aria-pressed="true">Saved</button><button type="button" data-preset-collection="preserved" aria-pressed="false">Preserved</button><button type="button" data-preset-collection="trash" aria-pressed="false">Trash</button></div><p id="edit-presets-status" role="status"></p><div id="edit-presets-grid"></div><p class="preset-footnote">Preserve protects a preset from deletion. Deleted presets stay in Trash until you restore or permanently delete them.</p>`;
  this.formDialog=document.createElement('dialog');this.formDialog.id='edit-preset-dialog';this.formDialog.setAttribute('aria-labelledby','edit-preset-dialog-title');
  this.formDialog.innerHTML=`<form id="edit-preset-form"><div class="dialog-heading"><h2 id="edit-preset-dialog-title">Save preset</h2><button type="button" class="icon-button" data-preset-close aria-label="Close preset details">${actions.icon('close')}</button></div><p id="edit-preset-description"></p><label id="edit-preset-name-label" for="edit-preset-name">Preset name<input id="edit-preset-name" name="preset-name" maxlength="80" required autocomplete="off"></label><p id="edit-preset-error" role="alert" hidden></p><div class="preset-form-actions"><button type="button" class="secondary" data-preset-close>Cancel</button><button type="submit" class="primary" id="edit-preset-confirm">Save preset</button></div></form>`;
  document.body.append(this.gallery,this.formDialog);
  for(const dialog of [this.gallery,this.formDialog]){
   dialog.querySelectorAll('[data-preset-close]').forEach(button=>button.onclick=()=>dialog.close());
   dialog.addEventListener('cancel',e=>{if(this.working)e.preventDefault();});
  }
  $('#edit-preset-save').onclick=()=>this.openForm('create');$('#edit-preset-gallery').onclick=()=>void this.openGallery();
  $('#edit-presets-search').oninput=$('#edit-presets-sort').onchange=()=>this.render();
  this.gallery.addEventListener('click',event=>{
   const tab=event.target.closest('[data-preset-collection]');
   if(tab){this.collection=tab.dataset.presetCollection;this.error='';this.render();return;}
   const button=event.target.closest('[data-preset-action]');if(!button||this.working)return;
   const preset=this.presets.find(p=>p.id===button.closest('[data-preset-id]').dataset.presetId);if(!preset)return;
   const action=button.dataset.presetAction;
   if(action==='apply'){
    if(this.actions.current().busy)return;
    this.actions.apply(preset);this.gallery.close();return;
   }
   if(['rename','duplicate','purge'].includes(action)){this.openForm(action,preset);return;}
   void this.mutate({type:action,id:preset.id,...(action==='preserve'?{preserved:!preset.preserved}:{})});
  });
  $('#edit-preset-form').onsubmit=event=>{event.preventDefault();void this.submit();};
 }
 setDisabled(disabled){this.disabled=disabled;for(const id of ['edit-preset-save','edit-preset-gallery'])$('#'+id).disabled=disabled||this.working;}
 setWorking(value){
  this.working=value;this.setDisabled(this.disabled);
  for(const el of [...this.gallery.querySelectorAll('button,input,select'),...this.formDialog.querySelectorAll('button,input')]){
   el.disabled=value||el.dataset.protected==='true';
  }
 }
 available(){
  if(this.disabled||this.actions.current().busy)return false;
  if(!this.actions.enabled){this.actions.toast('Run Apply Studio Update.command and refresh to activate saved presets.');return false;}
  return true;
 }
 async openGallery(){
  if(!this.available())return;
  this.actions.pause();this.kind=this.actions.current().kind;this.collection='saved';this.error='';this.loading=true;
  $('#edit-presets-kind').textContent=label(this.kind);$('#edit-presets-search').value='';this.render();this.gallery.showModal();
  try{const result=await this.actions.api('/api/editing/presets');this.presets=result.presets;}
  catch(e){this.error=e.message;}
  finally{this.loading=false;this.render();}
 }
 render(){
  const query=$('#edit-presets-search').value.trim().toLocaleLowerCase();
  const presets=this.presets.filter(p=>p.kind===this.kind&&(this.collection==='trash'?!!p.deletedAt:!p.deletedAt)&&(this.collection!=='preserved'||p.preserved)&&p.name.toLocaleLowerCase().includes(query));
  presets.sort($('#edit-presets-sort').value==='name'?(a,b)=>a.name.localeCompare(b.name):(a,b)=>b.createdAt.localeCompare(a.createdAt));
  for(const tab of this.gallery.querySelectorAll('[data-preset-collection]'))tab.setAttribute('aria-pressed',String(tab.dataset.presetCollection===this.collection));
  $('#edit-presets-status').textContent=this.loading?'Loading presets…':this.error||`${presets.length} ${presets.length===1?'preset':'presets'}`;
  const messages={saved:'Save your first look with “Save preset”.',preserved:'Choose Preserve on a saved preset to keep it protected.',trash:'Deleted presets appear here, ready to restore.'};
  $('#edit-presets-grid').innerHTML=this.loading||this.error?'':!presets.length?`<div class="preset-empty">${this.actions.icon(this.collection==='trash'?'trash':'canvas')}<h3>${query?'No matching presets.':this.collection==='saved'?'A place for your signature looks.':this.collection==='preserved'?'Keep your best looks close.':'Your Trash is empty.'}</h3><p>${query?'Try another name.':messages[this.collection]}</p></div>`:presets.map(p=>{
   const effect=effectNames(p.settings);
   const button=(action,text,extra='')=>`<button type="button" data-preset-action="${action}" ${extra}>${text}</button>`;
   return `<article class="preset-card" data-preset-id="${esc(p.id)}"><div class="preset-preview">${p.preview?`<img src="${esc(p.preview)}" alt="Preview of ${esc(p.name)}" loading="lazy">`:`<div class="preset-swatch" aria-label="${esc(label(p.kind))} preset">${this.actions.icon(p.kind==='color'?'curves':'effects')}</div>`}${p.preserved?'<span class="preset-protected">Preserved</span>':''}</div><div class="preset-card-info"><h3>${esc(p.name)}</h3><p>${esc(p.kind==='color'?'Light, colour, film & depth':effect||'Effects')}<span>${new Date(p.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</span></p></div><div class="preset-card-actions">${p.deletedAt?button('restore','Restore','class="preset-apply"')+button('purge','Delete permanently','class="preset-remove"'):button('apply','Apply','class="preset-apply"')+button('preserve',p.preserved?'Unpreserve':'Preserve',`aria-pressed="${p.preserved}"`)+button('rename','Rename')+button('duplicate','Duplicate')+button('delete',this.actions.icon('trash'),`class="preset-remove" aria-label="Delete ${esc(p.name)}" title="${p.preserved?'Unpreserve before deleting':'Move to Trash'}" ${p.preserved?'disabled data-protected="true"':''}`)}</div></article>`;
  }).join('');
 }
 openForm(type,preset){
  if(!this.available())return;this.actions.pause();const current=this.actions.current();
  this.operation=type==='create'?{type,kind:current.kind,settings:presetSettings(current.kind,current.settings),preview:this.actions.preview()}:{type,id:preset.id};
  const titles={create:'Save preset',rename:'Rename preset',duplicate:'Duplicate preset',purge:'Delete permanently?'};
  $('#edit-preset-dialog-title').textContent=titles[type];$('#edit-preset-confirm').textContent=type==='purge'?'Delete permanently':type==='rename'?'Save name':type==='duplicate'?'Save duplicate':'Save preset';
  $('#edit-preset-description').textContent=type==='purge'?`“${preset.name}” will be permanently removed from your preset gallery. This cannot be undone.`:type==='create'?(current.kind==='color'?'Save light, colour, film and depth adjustments.':'Save all active effects, their order and individual settings.')+' Reuse this preset with other media in any project.':type==='duplicate'?'Create a separate copy while keeping the original preset.':'Give this saved look a new name.';
  $('#edit-preset-name-label').hidden=type==='purge';$('#edit-preset-name').required=type!=='purge';
  $('#edit-preset-name').value=type==='create'?(current.kind==='color'?'Untitled grade':effectNames(current.settings).slice(0,80)):type==='duplicate'?preset.name.slice(0,75)+' copy':preset.name;
  $('#edit-preset-error').hidden=true;this.formDialog.showModal();
  if(type!=='purge'){$('#edit-preset-name').focus();$('#edit-preset-name').select();}
 }
 async submit(){
  if(this.working)return;const operation={...this.operation};if(operation.type!=='purge')operation.name=$('#edit-preset-name').value.trim();
  this.setWorking(true);$('#edit-preset-error').hidden=true;
  try{
   const result=await this.actions.api('/api/editing/presets',{method:'POST',body:JSON.stringify(operation),headers:{'Content-Type':'application/json'}});this.presets=result.presets;this.formDialog.close();
   this.actions.toast(operation.type==='purge'?'Preset permanently deleted.':operation.type==='rename'?'Preset renamed.':'Preset saved.');
   if(this.gallery.open)this.render();
  }catch(e){$('#edit-preset-error').textContent=e.message;$('#edit-preset-error').hidden=false;}
  finally{this.setWorking(false);}
 }
 async mutate(operation){
  this.setWorking(true);this.error='';
  try{const result=await this.actions.api('/api/editing/presets',{method:'POST',body:JSON.stringify(operation),headers:{'Content-Type':'application/json'}});this.presets=result.presets;this.actions.toast(operation.type==='delete'?'Preset moved to Trash.':operation.type==='restore'?'Preset restored.':operation.preserved?'Preset preserved.':'Preset unpreserved.');}
  catch(e){this.error=e.message;}
  finally{this.render();this.setWorking(false);}
 }
}
