import {runSelectionBatch} from './library.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class AssetLibrary{
  constructor(actions){
    this.actions=actions;this.category='general';this.idType='all';this.outfitAudience='all';this.assets=[];this.version=0;this.busy=false;this.selected=new Set();this.visible=[];this.downloading=false;this.pending=new Set();
    $('#assets-section').innerHTML=`<header class="assets-heading"><div><span class="eyebrow">YOUR REUSABLE MEDIA</span><h1>Asset Library</h1><p>Your images and videos, saved in one place. Bring them into your next idea.</p></div><button class="secondary" id="assets-import">Upload files</button><input id="assets-files" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.mov" multiple></header><div class="assets-filters"><input type="search" id="assets-search" aria-label="Search Asset Library" placeholder="Search names, tags, models or projects"><label class="assets-filter-label">Project<select id="assets-project" aria-label="Filter assets by project"><option value="">All projects</option></select></label><select id="assets-kind" aria-label="Filter assets by media type"><option value="">Images &amp; videos</option><option value="image">Images</option><option value="video">Videos</option></select><select id="assets-source" aria-label="Filter assets by source"><option value="">All sources</option><option value="upload">Uploads</option><option value="generated">Generated</option></select><label class="assets-filter-label">Sort<select id="assets-sort" aria-label="Sort assets"><option value="newest">Newest first</option><option value="project">Project name</option><option value="name">Asset name</option></select></label><label class="assets-filter-label">Show<select id="assets-collection" aria-label="Asset collection"><option value="library">Library</option><option value="trash">Trash</option></select></label></div><p id="assets-update" class="hint" hidden>Open Apply Studio Update.command, then refresh to enable asset removal and Trash.</p><p id="assets-status" role="status"></p><p id="assets-count" class="hint"></p><div class="asset-category-tabs segmented" role="group" aria-label="Asset category"><button type="button" data-asset-category="general" class="selected" aria-pressed="true" aria-label="General assets" title="General assets">${actions.icon('box')}</button><button type="button" data-asset-category="outfit" aria-pressed="false" aria-label="Outfit assets" title="Outfit assets">${actions.icon('shirt')}</button><button type="button" data-asset-category="character" aria-pressed="false" aria-label="Character assets" title="Character assets">${actions.icon('person')}</button><button type="button" data-asset-category="id" aria-pressed="false" aria-label="ID assets" title="ID assets"><span class="reference-id-icon" aria-hidden="true">ID</span></button><button type="button" data-asset-category="product" aria-pressed="false" aria-label="Product assets" title="Product assets">${actions.icon('box')}</button><button type="button" data-asset-category="environment" aria-pressed="false" aria-label="Environment assets" title="Environment assets">${actions.icon('mountain')}</button></div><div id="assets-id-galleries" class="segmented" role="group" aria-label="ID galleries" hidden><button type="button" data-id-gallery="all">All IDs</button><button type="button" data-id-gallery="character">Character</button><button type="button" data-id-gallery="product">Product</button><button type="button" data-id-gallery="environment">Environment</button></div><label id="assets-outfit-filter" class="assets-filter-label" hidden>Outfits<select id="assets-outfit-audience"><option value="all">All outfits</option><option value="women">Women</option><option value="men">Men</option></select></label><div class="batch-controls" role="group" aria-label="Asset selection"><label><input type="checkbox" id="assets-select-all">Select all shown</label><span id="assets-selected-count" aria-live="polite">0 selected</span><button type="button" class="secondary" id="assets-download" disabled>Download ZIP</button><button type="button" class="secondary" id="assets-delete-selected" disabled title="Move selected assets to Trash">Delete selected</button><button type="button" class="text-button" id="assets-clear-selection" disabled>Unselect all</button></div><div id="assets-grid"></div><div id="assets-empty" hidden><h2>Your references, ready for next time.</h2><p>Upload images or videos here, or choose Add to Asset Library on a generated result.</p></div><p class="assets-footnote">Saved on this computer · PNG, JPG, WebP up to 30 MB · MP4, MOV up to 200 MB · duplicate files are saved once</p><dialog id="asset-name-dialog"><form id="asset-name-form"><h2>Rename asset</h2><label for="asset-name">Name</label><input id="asset-name" required maxlength="180" autocomplete="off"><p class="error" id="asset-name-error" hidden></p><div class="asset-name-actions"><button type="button" class="secondary" id="asset-name-cancel">Cancel</button><button class="secondary" id="asset-name-save">Save name</button></div></form></dialog>`;
    for(const button of document.querySelectorAll('[data-id-gallery]'))button.addEventListener('click',()=>{this.idType=button.dataset.idGallery;this.outfitAudience='all';$('#assets-outfit-audience').value='all';this.selected.clear();this.render();});
    $('#assets-outfit-audience').addEventListener('change',()=>{this.outfitAudience=$('#assets-outfit-audience').value;this.selected.clear();this.render();});
    for(const button of document.querySelectorAll('[data-asset-category]'))button.addEventListener('click',()=>{this.category=button.dataset.assetCategory;this.outfitAudience='all';$('#assets-outfit-audience').value='all';this.selected.clear();this.render();});
    $('#assets-select-all').addEventListener('change',e=>{this.selected=e.target.checked?new Set(this.visible.map(a=>a.id)):new Set();this.updateSelection();});
    $('#assets-clear-selection').addEventListener('click',()=>{this.selected.clear();this.updateSelection();});
    $('#assets-grid').addEventListener('change',e=>{if(!e.target.matches('[data-select-asset]'))return;const id=e.target.closest('[data-asset]').dataset.asset;if(e.target.checked)this.selected.add(id);else this.selected.delete(id);this.updateSelection();});
    $('#assets-delete-selected').addEventListener('click',()=>void this.changeRemovedBatch(this.visible.filter(asset=>this.selected.has(asset.id)),$('#assets-collection').value==='trash'?'restore':'remove'));
    $('#assets-download').addEventListener('click',async()=>{if(this.downloading||this.batchRemoving)return;this.downloading=true;this.updateSelection();try{await actions.downloadBatch([...this.selected].map(assetId=>({assetId})));}catch(error){actions.toast(error.message);}finally{this.downloading=false;this.updateSelection();}});
    $('#assets-import').addEventListener('click',()=>$('#assets-files').click());
    $('#assets-files').addEventListener('change',e=>{void this.importFiles([...e.target.files]);e.target.value='';});
    $('#assets-search').addEventListener('input',()=>this.render());for(const id of ['assets-project','assets-source','assets-kind','assets-sort'])$('#'+id).addEventListener('change',()=>this.render());
    $('#assets-collection').addEventListener('change',()=>{this.selected.clear();void this.refresh();});
    $('#assets-grid').addEventListener('click',e=>void this.action(e));
    $('#asset-name-cancel').addEventListener('click',()=>$('#asset-name-dialog').close());
    $('#asset-name-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('#asset-name-save');button.disabled=true;try{const {asset}=await actions.post('/api/assets/rename',{id:this.renaming,name:$('#asset-name').value});this.assets=this.assets.map(a=>a.id===asset.id?asset:a);this.version++;this.render();$('#asset-name-dialog').close();}catch(error){$('#asset-name-error').hidden=false;$('#asset-name-error').textContent=error.message;}finally{button.disabled=false;}});
    const section=$('#assets-section');for(const name of ['dragenter','dragover'])section.addEventListener(name,e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();section.classList.add('drag-over');}});
    section.addEventListener('dragleave',e=>{if(!section.contains(e.relatedTarget))section.classList.remove('drag-over');});
    section.addEventListener('drop',e=>{section.classList.remove('drag-over');if(e.dataTransfer.files.length){e.preventDefault();void this.importFiles([...e.dataTransfer.files]);}});
  }
  url(asset,download=false){return '/api/assets/media?id='+encodeURIComponent(asset.id)+(download?'&download=1':'');}
  async show(){
    const enabled=!!this.actions.context().assetRemoval;
    $('#assets-update').hidden=enabled;$('#assets-collection').disabled=!enabled;
    if(!enabled)$('#assets-collection').value='library';
    this.syncProjects();await this.refresh();
  }
  syncProjects(){
    const select=$('#assets-project'),value=select.value,context=this.actions.context();
    this.projects=assetProjectOptions(this.assets,context.projects,context.deletedProjects);
    select.replaceChildren(new Option('All projects',''),...this.projects.map(p=>new Option(p.name,p.id)));
    if([...select.options].some(o=>o.value===value))select.value=value;
  }
  async refresh(){const version=++this.version;$('#assets-status').textContent='Loading assets…';try{const {assets}=await this.actions.api('/api/assets'+($('#assets-collection').value==='trash'?'?deleted=1':''));if(version!==this.version)return;this.assets=assets;this.syncProjects();$('#assets-status').textContent='';this.render();}catch(error){if(version===this.version)$('#assets-status').textContent=error.message;}}
  render(){
    const query=$('#assets-search').value.trim().toLowerCase(),project=$('#assets-project').value,source=$('#assets-source').value,kind=$('#assets-kind').value,trash=$('#assets-collection').value==='trash';
    const projectNames=a=>assetProjectNames(a,this.projects);
    const visible=filterAssets(this.assets.filter(a=>!!a.deletedAt===trash),{query,project,source,kind,category:this.category,idType:this.idType,outfitAudience:this.outfitAudience,sort:$('#assets-sort').value},this.projects);
    for(const button of document.querySelectorAll('[data-asset-category]')){const selected=button.dataset.assetCategory===this.category;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
    $('#assets-id-galleries').hidden=this.category!=='id';for(const b of document.querySelectorAll('[data-id-gallery]')){b.classList.toggle('selected',b.dataset.idGallery===this.idType);b.setAttribute('aria-pressed',String(b.dataset.idGallery===this.idType));}$('#assets-outfit-filter').hidden=!['outfit','character'].includes(this.category)&&!(this.category==='id'&&this.idType==='character');$('#assets-outfit-filter').firstChild.textContent=this.category==='character'?'Characters':this.category==='id'?'ID category':'Outfits';$('#assets-outfit-audience').options[0].textContent=this.category==='character'?'All characters':this.category==='id'?'All IDs':'All outfits';
    this.visible=visible;const ids=new Set(visible.map(a=>a.id));for(const id of this.selected)if(!ids.has(id))this.selected.delete(id);
    $('#assets-count').textContent=`${visible.length} asset${visible.length===1?'':'s'}${visible.length!==this.assets.length?' · '+this.assets.length+' total':''} · ${project?this.projects.find(p=>p.id===project)?.name:'All projects'}${this.category==='character'?' · Character':this.category==='outfit'?' · Outfits':this.category==='id'?' · ID':this.category==='product'?' · Product':this.category==='environment'?' · Environment':''}${trash?' · Trash':''}`;
    $('#assets-empty').hidden=!!visible.length;$('#assets-empty h2').textContent=this.assets.length?'No matching assets.':trash?'Trash is empty.':'Your references, ready for next time.';$('#assets-empty p').textContent=this.assets.length?'Try another name or change the filters.':trash?'Removed assets appear here. You can restore them at any time.':'Upload images or videos here, or choose Add to Asset Library on a generated result.';
    $('#assets-grid').innerHTML=visible.map(a=>`<article class="asset-card" data-asset="${a.id}"><label class="media-select" title="Select for batch actions"><input type="checkbox" data-select-asset aria-label="Select ${esc(a.name)}"></label><button class="asset-preview" data-asset-action="preview" aria-label="Preview ${esc(a.name)}">${a.contentType.startsWith('video/')?`<video src="${this.url(a)}" preload="metadata" muted playsinline></video><span class="asset-video-badge">Video${Number.isFinite(a.duration)?' · '+a.duration.toFixed(1)+'s':''}</span>`:`<img loading="lazy" src="${this.url(a)}" alt="${esc(a.name)}">`}</button><div class="asset-details"><div class="asset-title"><h2 title="${esc(a.name)}">${esc(a.name)}</h2>${!trash?`<button type="button" class="text-button" data-asset-action="rename" aria-label="Rename ${esc(a.name)}">Rename</button>`:''}</div><p>${[...new Set(a.sources.map(s=>s.type==='generated'?'Generated':'Uploaded'))].join(' · ')}${a.width&&a.height?' · '+a.width+' × '+a.height:''}</p><p class="asset-projects">${esc(projectNames(a))}</p></div>${a.tags?.length?`<div class="media-tags">${a.tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}<div class="asset-actions"><button type="button" data-asset-action="${trash?'restore':'use'}" ${this.pending.has(a.id)?'disabled':''}>${trash?'Restore':'Use as reference'}</button><a href="${this.url(a,true)}" download aria-label="Download ${esc(a.name)}">Download</a>${!trash?`<button type="button" class="asset-remove" data-asset-action="remove" aria-label="Remove ${esc(a.name)} from Asset Library" title="Move to Trash" ${this.pending.has(a.id)?'disabled':''}>${this.actions.icon('trash')}</button>`:''}</div></article>`).join('');
    this.updateSelection();
  }
  updateSelection(){
    document.querySelectorAll('#assets-grid [data-select-asset]').forEach(input=>{const card=input.closest('[data-asset]'),selected=this.selected.has(card.dataset.asset);input.checked=selected;card.classList.toggle('download-selected',selected);input.disabled=!!this.batchRemoving;});
    const count=this.selected.size,total=this.visible.length;$('#assets-selected-count').textContent=count+' selected';$('#assets-select-all').checked=total>0&&count===total;$('#assets-select-all').indeterminate=count>0&&count<total;$('#assets-select-all').disabled=!total||!!this.batchRemoving;$('#assets-clear-selection').disabled=!count||!!this.batchRemoving;$('#assets-download').disabled=!count||this.downloading||!!this.batchRemoving;$('#assets-download').textContent=this.downloading?'Preparing ZIP…':'Download ZIP';
    const trash=$('#assets-collection').value==='trash',button=$('#assets-delete-selected');button.disabled=!count||this.downloading||!!this.pending.size;button.textContent=this.batchRemoving?(trash?'Restoring…':'Deleting…'):(trash?'Restore selected':'Delete selected');button.title=trash?'Restore selected assets to the library':'Move selected assets to Trash';$('#assets-collection').disabled=!!this.batchRemoving||!this.actions.context().assetRemoval;
  }
  async changeRemovedBatch(assets,operation='remove'){
    if(!assets.length||this.batchRemoving||this.downloading||this.pending.size)return;
    if(!this.actions.context().assetRemoval){this.actions.toast('Open Apply Studio Update.command, then refresh to enable asset removal.');return;}
    this.batchRemoving=true;this.actions.busy(true);for(const asset of assets)this.pending.add(asset.id);this.version++;this.render();
    let result;
    try{
      result=await runSelectionBatch(assets,async asset=>{
        await this.actions.post('/api/assets/'+operation,{id:asset.id});this.version++;
        this.assets=this.assets.filter(item=>item.id!==asset.id);this.selected.delete(asset.id);this.render();
      });
      await this.refresh();
    }finally{this.batchRemoving=false;for(const asset of assets)this.pending.delete(asset.id);this.actions.busy(false);this.render();}
    const count=result.succeeded.length,failed=result.failed.length;
    const message=(count?`${count} asset${count===1?'':'s'} ${operation==='remove'?'moved to Trash':'restored'}.`:'')+(failed?` ${failed} could not be changed. ${result.failed[0].error.message}`:'');
    this.actions.toast(message.trim(),operation==='remove'&&count?()=>this.changeRemovedBatch(result.succeeded,'restore'):undefined);
  }
  async importFiles(files){
    if(this.busy||!files.length)return;this.busy=true;this.actions.busy(true);$('#assets-import').disabled=true;let count=0;
    try{
      const projectId=this.actions.context().projectId;
      for(const file of files){
        const {kind,contentType:type}=this.actions.fileInfo(file),limit=kind==='video'?200:30;
        if(!['image/png','image/jpeg','image/webp','video/mp4','video/quicktime'].includes(type)||file.size>limit*1024**2)throw Error(`${file.name}: choose an image up to 30 MB or an MP4/MOV video up to 200 MB.`);
        if(kind==='video'&&!this.actions.context().videoAssets)throw Error('Open Apply Studio Update.command, then refresh to activate video assets.');
        $('#assets-status').textContent='Saving '+file.name+'…';const preview=URL.createObjectURL(file);let metadata;
        try{metadata=await this.actions.metadata(file,kind,preview);}finally{URL.revokeObjectURL(preview);}
        await this.actions.api('/api/assets/import',{method:'POST',headers:{'Content-Type':type,'X-File-Name':encodeURIComponent(file.name),'X-Project-Id':projectId,'X-Media-Metadata':JSON.stringify(metadata)},body:file});count++;
      }
      await this.refresh();this.actions.toast(`${count} asset${count===1?'':'s'} saved to Asset Library.`);
    }catch(error){await this.refresh();$('#assets-status').textContent=(count?count+' saved. ':'')+error.message;}
    finally{this.busy=false;this.actions.busy(false);$('#assets-import').disabled=false;}
  }
  async changeRemoved(asset,operation){
    if(!this.actions.context().assetRemoval){this.actions.toast('Open Apply Studio Update.command, then refresh to enable asset removal.');return;}
    if(this.batchRemoving||this.pending.has(asset.id))return;
    this.pending.add(asset.id);this.render();
    try{await this.actions.post('/api/assets/'+operation,{id:asset.id});this.version++;this.assets=this.assets.filter(a=>a.id!==asset.id);this.selected.delete(asset.id);this.render();await this.refresh();this.actions.toast(operation==='remove'?'Asset moved to Trash.':'Asset restored to the library.',operation==='remove'?()=>this.changeRemoved(asset,'restore'):undefined);}
    catch(error){$('#assets-status').textContent=error.message;}
    finally{this.pending.delete(asset.id);this.render();}
  }
  async action(event){const button=event.target.closest('[data-asset-action]'),card=button?.closest('[data-asset]');if(!card)return;const asset=this.assets.find(a=>a.id===card.dataset.asset);if(!asset)return;
    if(['remove','restore'].includes(button.dataset.assetAction)){await this.changeRemoved(asset,button.dataset.assetAction);return;}
    if(button.dataset.assetAction==='preview'){this.actions.preview(asset,this.url(asset),this.visible);return;}
    if(button.dataset.assetAction==='rename'){this.renaming=asset.id;$('#asset-name').value=asset.name;$('#asset-name-error').hidden=true;$('#asset-name-dialog').showModal();return;}
    if(button.dataset.assetAction==='use'){button.disabled=true;try{await this.actions.use(asset,this.url(asset));}finally{button.disabled=false;}}
  }
}

export function assetProjectOptions(assets,projects=[],deletedProjects=[]){
  const byId=new Map(projects.map(p=>[p.id,{id:p.id,name:p.name}]));
  for(const asset of assets)for(const source of asset.sources){
    if(byId.has(source.projectId))continue;
    const deleted=deletedProjects.find(p=>p.id===source.projectId);
    byId.set(source.projectId,{id:source.projectId,name:deleted?deleted.name+' (deleted project)':'Project '+source.projectId.slice(0,8)});
  }
  return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function assetProjectNames(asset,projects=[]){return [...new Set(asset.sources.map(s=>projects.find(p=>p.id===s.projectId)?.name||'Project '+s.projectId.slice(0,8)))].sort((a,b)=>a.localeCompare(b)).join(' · ');}
export function filterAssets(assets,{query='',project='',source='',kind='',category='all',idType='all',outfitAudience='all',sort='newest'}={},projects=[]){
  query=query.trim().toLowerCase();
  const visible=assets.filter(a=>(category==='all'||(['product','environment'].includes(category)?assetCategory(a)==='id'&&(a.referenceType||a.sources.find(s=>s.referenceType)?.referenceType)===category:assetCategory(a)===category))&&(category!=='id'||idType==='all'||(a.referenceType||'character')===idType)&&(!['outfit','id','character'].includes(category)||(category==='id'&&['product','environment'].includes(idType))||outfitAudience==='all'||(category==='character'?a.characterAudience:category==='id'?a.referenceAudience:a.outfitAudience)===outfitAudience)&&(!kind||a.contentType.startsWith(kind+'/'))&&(!project||a.sources.some(s=>s.projectId===project))&&(!source||a.sources.some(s=>s.type===source&&(!project||s.projectId===project)))&&(!query||[a.name,...(a.tags||[]),...a.originalNames,...a.sources.map(s=>s.modelName||''),assetProjectNames(a,projects)].join(' ').toLowerCase().includes(query)));
  const newest=(a,b)=>(b.deletedAt||b.createdAt).localeCompare(a.deletedAt||a.createdAt)||a.id.localeCompare(b.id);
  return visible.sort((a,b)=>sort==='project'?assetProjectNames(a,projects).localeCompare(assetProjectNames(b,projects))||newest(a,b):sort==='name'?a.name.localeCompare(b.name)||newest(a,b):newest(a,b));
}

function assetCategory(a){return a.category==='character'||a.sources.some(s=>s.category==='character')?'character':a.category==='id'||a.sources.some(s=>s.category==='id')?'id':a.category==='outfit'||a.sources.some(s=>s.category==='outfit')?'outfit':'general';}
