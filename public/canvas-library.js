import {assetCollection,collectionLabel} from './library.js';
import {mediaPresentation} from './library.js?v=prompt-details';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const visual=media=>!media.deletedAt&&/^(image|video)\//.test(media.contentType);
export function canvasLibrarySources({assets=[],jobs=[],projects=[],source='assets',query='',mediaURL}){
  const items=['assets','outfit','character','id'].includes(source)?assets.filter(a=>visual(a)&&assetCollection(a)===source).map(asset=>({key:'asset:'+asset.id,source:{assetId:asset.id},name:mediaPresentation({asset,job:jobs.find(j=>(asset.sources||[]).some(s=>s.jobId===j.id))}).title,detail:[...new Set((asset.sources||[]).map(s=>projects.find(p=>p.id===s.projectId)?.name||s.projectName).filter(Boolean))].join(' · '),media:asset,url:'/api/assets/media?id='+encodeURIComponent(asset.id)})):
    jobs.flatMap(job=>job.tasks.filter(t=>t.status==='COMPLETED'&&!t.deletedAt).flatMap(t=>(t.outputs||[]).filter(media=>visual(media)&&(source!=='favorites'||media.favorite)).map(media=>({key:`media:${job.id}:${media.id}`,source:{jobId:job.id,mediaId:media.id},name:mediaPresentation({job}).title,prompt:job.settings.prompt,detail:job.modelName,media,url:mediaURL(job,media)}))));
  const search=query.trim().toLowerCase();return items.filter(item=>(item.name+' '+item.detail+' '+(item.prompt||'')).toLowerCase().includes(search));
}
export class CanvasLibrary{
  constructor(actions){
    this.actions=actions;this.assets=[];this.source='assets';this.selected=new Map();this.busy=false;this.loading=false;this.version=0;
    this.dialog=$('#canvas-library');
    $('#canvas-library-close').addEventListener('click',()=>{if(!this.busy)this.dialog.close();});
    this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
    this.dialog.addEventListener('close',()=>{this.version++;this.selected.clear();$('#canvas-library-grid').replaceChildren();});
    $('#canvas-library-search').addEventListener('input',()=>this.render());
    $('#canvas-library-sources').addEventListener('click',e=>{const source=e.target.closest('[data-canvas-source]');if(source&&!this.busy){this.source=source.dataset.canvasSource;this.render();}});
    $('#canvas-library-grid').addEventListener('change',e=>{const checkbox=e.target.closest('[data-canvas-choice]');if(!checkbox||this.busy)return;const item=this.visible.find(i=>i.key===checkbox.dataset.canvasChoice);if(item){checkbox.checked?this.selected.set(item.key,item.source):this.selected.delete(item.key);this.render();}});
    $('#canvas-library-clear').addEventListener('click',()=>{this.selected.clear();this.render();});
    $('#canvas-library-add').addEventListener('click',()=>this.add());
    $('#canvas-library-upload').addEventListener('click',()=>{if(!this.busy){$('#canvas-library-files').value='';$('#canvas-library-files').click();}});
    $('#canvas-library-files').addEventListener('change',e=>this.upload([...e.target.files]));
  }
  status(message){$('#canvas-library-status').textContent=message;}
  setBusy(value){this.busy=value;this.actions.busy(value);this.render();}
  async open(){
    if(this.busy||this.dialog.open)return;
    if(!this.actions.context().enabled){this.actions.toast('Open Apply Studio Update.command, then refresh to add uploads, Assets and Favorites to your canvas.');return;}
    if(!await this.actions.canvas.load())return;
    this.projectId=this.actions.context().projectId;this.source='assets';this.selected.clear();this.assets=[];this.loading=true;$('#canvas-library-search').value='';this.status('Loading your assets…');this.render();this.dialog.showModal();
    const version=++this.version;
    try{const result=await this.actions.api('/api/assets');if(version!==this.version)return;this.assets=result.assets;this.status('');}
    catch(error){if(version===this.version)this.status(error.message);}
    finally{if(version===this.version){this.loading=false;this.render();}}
  }
  render(){
    const canvas=this.actions.canvas;
    this.visible=canvasLibrarySources({assets:this.assets,jobs:this.actions.context().jobs,projects:this.actions.context().projects,source:this.source,query:$('#canvas-library-search').value,mediaURL:this.actions.mediaURL});
    const existing=new Set(canvas.board?.items.map(i=>i.id));
    for(const key of this.selected.keys())if(existing.has(key))this.selected.delete(key);
    for(const button of this.dialog.querySelectorAll('[data-canvas-source]')){button.setAttribute('aria-pressed',String(button.dataset.canvasSource===this.source));button.disabled=this.busy;}
    $('#canvas-library-grid').innerHTML=this.visible.map(item=>{
      const added=existing.has(item.key),selected=this.selected.has(item.key),video=item.media.contentType.startsWith('video/');
      return `<label class="canvas-library-card${selected?' chosen':''}${added?' added':''}"><span class="canvas-library-choice"><input type="checkbox" data-canvas-choice="${esc(item.key)}" aria-label="Select ${esc(item.name)}" ${selected?'checked':''} ${this.busy||added?'disabled':''}><span>${added?'On your canvas':video?'Video':'Image'}</span></span>${video?`<video muted playsinline preload="metadata" src="${esc(item.url)}" aria-label="${esc(item.name)}"></video>`:`<img loading="lazy" src="${esc(item.url)}" alt="${esc(item.name)}">`}<span class="canvas-library-name" title="${esc(item.name)}">${esc(item.name)}</span><small>${esc(item.detail)}</small></label>`;
    }).join('');
    $('#canvas-library-empty').hidden=this.loading||!!this.visible.length;
    $('#canvas-library-empty').textContent=$('#canvas-library-search').value.trim()?'No matching images or videos.':this.source==='favorites'?'Star an image or video in this project to find it here.':this.source==='generations'?'This project has no generated images or videos yet.':'Upload images or videos from your computer to begin.';
    $('#canvas-library-scope').textContent=['assets','outfit','character','id'].includes(this.source)?collectionLabel(this.source)+' from all projects':'From the current project';
    $('#canvas-library-selected').textContent=this.selected.size+' selected';
    $('#canvas-library-add').disabled=this.busy||!this.selected.size;
    $('#canvas-library-clear').disabled=this.busy||!this.selected.size;
    $('#canvas-library-upload').disabled=this.busy;
    $('#canvas-library-close').disabled=this.busy;
    $('#canvas-library-search').disabled=this.busy;
  }
  async add(){
    if(this.busy||!this.selected.size)return;
    if(this.projectId!==this.actions.context().projectId){this.dialog.close();return;}
    this.setBusy(true);this.status('Adding to your canvas…');
    try{if(await this.actions.canvas.addSources([...this.selected.values()])){this.actions.toast('Added to Ideation.');this.dialog.close();}else this.status('Canvas changes are waiting to save. Close this window and click the canvas save status to retry.');}
    catch(error){this.status(error.message);}
    finally{this.setBusy(false);}
  }
  async upload(files){
    if(!files.length||this.busy)return;
    if(this.projectId!==this.actions.context().projectId){this.dialog.close();return;}
    const projectId=this.projectId;this.setBusy(true);const sources=[];let errorMessage='';
    try{
      for(const file of files){
        const {kind,contentType}=this.actions.fileInfo(file),limit=kind==='video'?200:30;
        if(!['image/png','image/jpeg','image/webp','video/mp4','video/quicktime'].includes(contentType)||file.size>limit*1024**2)throw Error(`${file.name}: choose PNG, JPG or WebP up to 30 MB, or MP4/MOV up to 200 MB.`);
      }
      if(this.actions.canvas.board.items.length+files.length>1000)throw Error('This canvas holds up to 1,000 items. Remove an item before adding more.');
      for(const file of files){
        const {kind,contentType}=this.actions.fileInfo(file);this.status('Saving '+file.name+'…');const preview=URL.createObjectURL(file);let metadata;
        try{metadata=await this.actions.metadata(file,kind,preview);}finally{URL.revokeObjectURL(preview);}
        const {asset}=await this.actions.api('/api/assets/import',{method:'POST',headers:{'Content-Type':contentType,'X-File-Name':encodeURIComponent(file.name),'X-Project-Id':projectId,'X-Media-Metadata':JSON.stringify(metadata)},body:file});
        this.assets=this.assets.filter(a=>a.id!==asset.id);this.assets.unshift(asset);sources.push({assetId:asset.id});
      }
    }catch(error){errorMessage=error.message;}
    try{
      if(sources.length){
        this.status('Adding to your canvas…');
        if(await this.actions.canvas.addSources(sources)){
          this.actions.toast(`${sources.length} file${sources.length===1?'':'s'} saved in Assets and added to Ideation.`);
          if(!errorMessage)this.dialog.close();
        }else errorMessage+=' Files are saved in Assets. Close this window and click the canvas save status to retry.';
      }
    }catch(error){errorMessage+=(errorMessage?' ':'')+error.message+' Uploaded files are saved in Assets.';}
    finally{this.status(errorMessage);$('#canvas-library-files').value='';this.setBusy(false);}
  }
}
