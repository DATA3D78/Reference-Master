import {clamp,worldPoint,zoomAt,fitCamera,bounds,findSpace,expandSelection,rectangleSelection,organizeItems,snapTranslation,mediaAspectRatio,mediaFrameSize,mediaFrameCorrections} from './canvas-state.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>structuredClone(v),activeStatuses=['SUBMITTING','IN_QUEUE','IN_PROGRESS'];
export class IdeationCanvas {
  constructor(actions){
    this.actions=actions;this.board=null;this.selected=new Set();this.cards=new Map();this.pending=[];this.undoStack=[];this.flushing=false;this.gesture=null;this.editing=new Map();this.noteTimers=new Map();this.jobs=[];this.enabled=false;this.loading=null;this.projectId='default';this.projectVersion=0;this.groupsEnabled=false;this.projectsEnabled=false;this.groupNodes=new Map();this.tool='select';
    this.viewport=$('#canvas-viewport');this.stage=$('#canvas-stage');this.mediaRatios=new Map();
    this.stage.addEventListener('focusin',e=>{const node=e.target.closest('[data-canvas-item]');if(node&&e.target===node&&this.board&&!this.selected.has(node.dataset.canvasItem)){this.selected=expandSelection(this.board.items,[node.dataset.canvasItem]);this.render();}});
    this.contextMenu=document.createElement('div');this.contextMenu.id='canvas-context-menu';this.contextMenu.className='canvas-context-menu';this.contextMenu.hidden=true;this.contextMenu.setAttribute('role','menu');this.contextMenu.setAttribute('aria-label','Canvas item actions');document.body.append(this.contextMenu);
    this.viewport.addEventListener('contextmenu',e=>{const card=e.target.closest('[data-canvas-item]');if(!card)return;e.preventDefault();this.openContextMenu(card.dataset.canvasItem,e.clientX,e.clientY);});
    this.contextMenu.addEventListener('click',e=>{const action=e.target.closest('[data-action]'),item=this.menuItem;if(action&&item){this.closeContextMenu(true);void this.runCardAction(action.dataset.action,item);}else if(e.target.closest('a'))this.closeContextMenu(true);});
    this.contextMenu.addEventListener('keydown',e=>this.contextMenuKey(e));
    this.contextMenu.addEventListener('dragstart',e=>{if(!e.target.closest('[data-reference-drag]')||!this.menuItem)return;const {jobId,mediaId}=this.menuItem;e.dataTransfer.setData('application/x-fwrd-media',JSON.stringify({jobId,mediaId}));e.dataTransfer.effectAllowed='copy';});
    this.contextMenu.addEventListener('dragend',()=>this.closeContextMenu());
    document.addEventListener('pointerdown',e=>{if(!this.contextMenu.contains(e.target))this.closeContextMenu();});
    document.addEventListener('focusin',e=>{if(!this.contextMenu.contains(e.target))this.closeContextMenu();});
    window.addEventListener('resize',()=>this.closeContextMenu());window.addEventListener('blur',()=>this.closeContextMenu());
    this.snapEnabled=true;try{this.snapEnabled=localStorage.getItem('fwrd-canvas-snap')!=='false';}catch{}
    $('#canvas-snap').setAttribute('aria-pressed',String(this.snapEnabled));
    $('#canvas-snap').addEventListener('click',()=>{this.snapEnabled=!this.snapEnabled;$('#canvas-snap').setAttribute('aria-pressed',String(this.snapEnabled));try{localStorage.setItem('fwrd-canvas-snap',String(this.snapEnabled));}catch{}this.renderSnapGuides([]);});
    this.viewport.addEventListener('pointerdown',e=>this.pointerDown(e));this.viewport.addEventListener('pointermove',e=>this.pointerMove(e));this.viewport.addEventListener('pointerup',e=>this.pointerUp(e));this.viewport.addEventListener('pointercancel',e=>this.pointerUp(e,true));
    this.viewport.addEventListener('wheel',e=>this.wheel(e),{passive:false});this.viewport.addEventListener('keydown',e=>this.keyDown(e));
    this.viewport.dataset.tool=this.tool;
    this.groupDrafts=new Map();this.groupTimers=new Map();
    this.stage.addEventListener('input',e=>{if(!e.target.matches('[data-group-name]'))return;const id=e.target.dataset.groupName;this.groupDrafts.set(id,e.target.value);clearTimeout(this.groupTimers.get(id));this.groupTimers.set(id,setTimeout(()=>this.saveGroupName(id),500));$('#canvas-save-state').textContent='Saving…';});
    for(const event of ['change','focusout'])this.stage.addEventListener(event,e=>{if(e.target.matches('[data-group-name]'))this.saveGroupName(e.target.dataset.groupName);});
    $('#canvas-select-tool').addEventListener('click',()=>this.setTool('select'));$('#canvas-pan-tool').addEventListener('click',()=>this.setTool('pan'));
    $('#canvas-clear-selection').addEventListener('click',()=>{this.selected.clear();this.render();});
    $('#canvas-download').addEventListener('click',async()=>{const items=this.selection().filter(i=>['media','asset'].includes(i.type)).map(i=>i.type==='asset'?{assetId:i.assetId}:{jobId:i.jobId,mediaId:i.mediaId}),projectId=this.projectId;this.downloading=true;this.render();try{await this.actions.downloadBatch(items,projectId);}catch(error){this.actions.toast(error.message);}finally{this.downloading=false;this.render();}});
    $('#canvas-group').addEventListener('click',()=>this.group());$('#canvas-ungroup').addEventListener('click',()=>this.ungroup());$('#canvas-row').addEventListener('click',()=>this.arrange('row'));$('#canvas-reuse').addEventListener('click',()=>{const item=this.selection().find(i=>i.type==='media');if(item)this.actions.reuseSettings(item.jobId);});
    this.viewport.addEventListener('keyup',e=>{if(e.code==='Space')this.space=false;});window.addEventListener('blur',()=>{this.space=false;});
    this.stage.addEventListener('click',e=>this.cardAction(e));this.stage.addEventListener('input',e=>this.noteInput(e));this.stage.addEventListener('focusout',e=>{if(e.target.matches('textarea[data-note]'))this.saveNote(e.target.dataset.note);});
    this.viewport.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('application/x-fwrd-media')){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';this.viewport.classList.add('drag-over');}});
    this.viewport.addEventListener('dragleave',e=>{if(!this.viewport.contains(e.relatedTarget))this.viewport.classList.remove('drag-over');});
    this.viewport.addEventListener('drop',e=>{this.viewport.classList.remove('drag-over');try{const item=JSON.parse(e.dataTransfer.getData('application/x-fwrd-media'));if(item.jobId&&item.mediaId&&this.board){e.preventDefault();e.stopPropagation();this.addMedia(item.jobId,item.mediaId,worldPoint(this.point(e),this.board.camera));}}catch{}});
    $('#canvas-note').addEventListener('click',()=>this.addNote());$('#canvas-arrange').addEventListener('click',()=>this.arrange());$('#canvas-remove').addEventListener('click',()=>this.remove());$('#canvas-undo').addEventListener('click',()=>this.undo());
    $('#canvas-fit').addEventListener('click',()=>this.fit());$('#canvas-zoom-in').addEventListener('click',()=>this.zoom(1.2));$('#canvas-zoom-out').addEventListener('click',()=>this.zoom(1/1.2));$('#canvas-reset-zoom').addEventListener('click',()=>{if(this.board)this.zoom(1/this.board.camera.zoom);});
    $('#canvas-title').addEventListener('input',()=>{this.titleDraft=$('#canvas-title').value;clearTimeout(this.titleTimer);this.titleTimer=setTimeout(()=>this.saveTitle(),500);});
    $('#canvas-title').addEventListener('change',()=>this.saveTitle());
    $('#canvas-save-state').addEventListener('click',()=>{if(this.pending.length&&!this.flushing)this.flush();});
    window.addEventListener('beforeunload',e=>{this.saveTitle();for(const id of this.groupDrafts.keys())this.saveGroupName(id);for(const id of this.editing.keys())this.saveNote(id);if(this.pending.length){e.preventDefault();e.returnValue='';}});
  }
  configure(enabled,{groups=false,projects=false}={}){this.enabled=enabled;this.groupsEnabled=groups;this.projectsEnabled=projects;}
  endpoint(){return '/api/ideation'+(this.projectsEnabled?'?project='+encodeURIComponent(this.projectId):'');}
  async savePending(){
    this.saveTitle();for(const id of this.groupDrafts.keys())this.saveGroupName(id);for(const id of this.editing.keys())this.saveNote(id);if(this.wheelTimer){clearTimeout(this.wheelTimer);this.wheelTimer=null;this.setCamera(this.board.camera);}
    await this.flush();if(this.pending.length){this.actions.toast('Save your canvas changes before switching projects. Click the save status to retry.');return false;}
    return true;
  }
  async changeProject(projectId){
    if(projectId===this.projectId)return true;this.closeContextMenu();
    if(!await this.savePending())return false;
    this.renderSnapGuides([]);clearTimeout(this.mediaFitTimer);this.mediaFitTimer=null;this.mediaRatios.clear();this.projectVersion++;this.projectId=projectId;this.board=null;this.loading=null;this.gesture=null;this.selected.clear();this.cards.clear();this.groupNodes.clear();this.undoStack=[];this.stage.replaceChildren();$('#canvas-marquee').hidden=true;this.jobs=[];return true;
  }
  setTool(tool){this.tool=tool;this.viewport.dataset.tool=tool;$('#canvas-select-tool').setAttribute('aria-pressed',String(tool==='select'));$('#canvas-pan-tool').setAttribute('aria-pressed',String(tool==='pan'));}
  membership(items=this.selection()){return items.map(({id,groupId,groupName})=>({id,...(groupId?{groupId,groupName}:{})}));}
  group(){if(!this.groupsEnabled||this.selected.size<2)return;const items=this.selection(),groupId=crypto.randomUUID(),groupName='Group '+(new Set(this.board.items.map(i=>i.groupId).filter(Boolean)).size+1);this.commit([{type:'groups',members:items.map(i=>({id:i.id,groupId,groupName}))}],[{type:'groups',members:this.membership(items)}]);}
  ungroup(){if(!this.groupsEnabled)return;const items=this.selection();this.commit([{type:'groups',members:items.map(i=>({id:i.id}))}],[{type:'groups',members:this.membership(items)}]);}
  saveGroupName(id){if(!this.groupDrafts.has(id))return;const value=this.groupDrafts.get(id);clearTimeout(this.groupTimers.get(id));this.groupTimers.delete(id);this.groupDrafts.delete(id);this.renameGroup(id,value);}
  renameGroup(id,value){const name=value.trim().slice(0,60),items=this.board?.items.filter(i=>i.groupId===id)||[];if(!name||!items.length){this.render();return;}if(items.every(i=>i.groupName===name))return;this.commit([{type:'groups',members:items.map(i=>({id:i.id,groupId:id,groupName:name}))}],[{type:'groups',members:this.membership(items)}]);}

  async load(){
    if(this.board)return true;if(this.loading)return this.loading;
    if(!this.enabled){this.message('Restart FWRD.STUDIO to activate the saved canvas.');return false;}
    this.message('Loading your canvas…');
    const version=this.projectVersion;this.loading=(async()=>{try{const {board}=await this.actions.api(this.endpoint());if(version!==this.projectVersion)return false;this.board=board;this.message('');this.saved();this.render();return true;}catch(error){this.message(error.message);return false;}finally{if(version===this.projectVersion)this.loading=null;}})();return this.loading;
  }
  message(text){$('#canvas-loading').hidden=!text;$('#canvas-loading').textContent=text;}
  saved(error=false){const el=$('#canvas-save-state');el.textContent=error?(this.pending.length?'Not saved · Click to retry':'Reconnecting…'):this.pending.length?'Saving…':'Saved on this computer';el.dataset.error=String(error);}
  optimistic(ops){for(const op of ops){if(op.type==='camera')this.board.camera=copy(op.camera);else if(op.type==='title')this.board.title=op.title;else if(op.type==='update'){const item=this.board.items.find(i=>i.id===op.id);if(item)Object.assign(item,op.patch);}else if(op.type==='groups'){for(const member of op.members){const item=this.board.items.find(i=>i.id===member.id);if(item){delete item.groupId;delete item.groupName;Object.assign(item,member);}}}else if(op.type==='remove')this.board.items=this.board.items.filter(i=>!op.ids.includes(i.id));else if(op.type==='restore')for(const item of op.items)if(!this.board.items.some(i=>i.id===item.id))this.board.items.push(copy(item));}}
  commit(ops,inverse=[]){
    if(!this.board)return Promise.resolve(false);
    if(inverse.length){this.undoStack.push(copy(inverse));if(this.undoStack.length>50)this.undoStack.shift();}
    this.optimistic(ops);const promise=new Promise(resolve=>this.pending.push({ops:copy(ops),resolve}));this.saved();this.render();this.flush();return promise;
  }
  flush(){
    if(this.flushing)return this.flushTask;if(!this.pending.length)return Promise.resolve();this.flushing=true;
    this.flushTask=(async()=>{try{
      while(this.pending.length){
        const first=this.pending[0],{board}=await this.actions.post('/api/ideation',{operations:first.ops,...(this.projectsEnabled?{projectId:this.projectId}:{})});
        const live=this.gesture?this.board.items.filter(i=>this.selected.has(i.id)).map(copy):[],camera=(this.gesture?.kind==='pan'||this.wheelTimer)?copy(this.board.camera):null;
        this.pending.shift();this.board=board;for(const entry of this.pending)this.optimistic(entry.ops);
        for(const item of live){const target=this.board.items.find(i=>i.id===item.id);if(target)Object.assign(target,{x:item.x,y:item.y,width:item.width,height:item.height});}
        for(const [id,edit] of this.editing){const item=this.board.items.find(i=>i.id===id);if(item)item.text=edit.text;}
        if(camera)this.board.camera=camera;this.render();first.resolve(true);
      }
      this.saved();
    }catch(error){this.saved(true);this.actions.toast('Canvas changes are not saved yet. Click the save status to retry.');}
    finally{this.flushing=false;}})();return this.flushTask;
  }
  async refresh(jobs){
    this.jobs=jobs;this.renderActivity();if(!this.board||this.pending.length||this.gesture||this.editing.size||this.wheelTimer)return;
    const version=this.projectVersion;try{const {board}=await this.actions.api(this.endpoint());if(version!==this.projectVersion)return;if(!this.pending.length&&!this.gesture&&!this.editing.size&&!this.wheelTimer&&(board.revision!==this.board.revision||board.visibilityVersion!==this.board.visibilityVersion)){this.board=board;this.render();}if(!this.pending.length)this.saved();}catch{this.saved(true);}
  }
  saveTitle(){clearTimeout(this.titleTimer);if(!this.board||this.titleDraft===undefined)return;const title=this.titleDraft.trim();this.titleDraft=undefined;if(!title){$('#canvas-title').value=this.board.title;return;}if(title!==this.board.title)this.commit([{type:'title',title}],[{type:'title',title:this.board.title}]);}
  selection(){return this.board?.items.filter(i=>this.selected.has(i.id))||[];}
  point(e){const r=this.viewport.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  center(){return {x:this.viewport.clientWidth/2,y:this.viewport.clientHeight/2};}
  insertionPoint(count=1){
    const point=this.board?worldPoint({x:Math.max(40,this.viewport.clientWidth/2-150*this.board.camera.zoom),y:Math.max(50,this.viewport.clientHeight/2-150*this.board.camera.zoom)},this.board.camera):{x:0,y:0};
    const pending=this.jobs.filter(j=>j.settings.destination==='ideation').flatMap(j=>j.tasks.flatMap((t,i)=>activeStatuses.includes(t.status)?[{x:(j.settings.canvasPosition?.x||0)+i*336,y:j.settings.canvasPosition?.y||0,width:300,height:260}]:[]));
    return findSpace([...(this.board?.items||[]),...pending],point,count*336-36,260);
  }
  async addMedia(jobId,mediaId,position){
    const version=this.projectVersion;if(!await this.load()||version!==this.projectVersion)return;const id=`media:${jobId}:${mediaId}`;
    if(this.board.items.some(i=>i.id===id)){this.selected=new Set([id]);this.fit(true);return;}
    if(await this.commit([{type:'addMedia',jobId,mediaId,position:position||this.insertionPoint()}],[{type:'remove',ids:[id]}])&&version===this.projectVersion){this.selected=new Set([id]);this.render();this.actions.toast('Added to Ideation.');}
  }
  async addSources(sources){
    const version=this.projectVersion;if(!await this.load()||version!==this.projectVersion)return false;
    const keyed=new Map(sources.map(source=>[source.assetId?`asset:${source.assetId}`:`media:${source.jobId}:${source.mediaId}`,source]));
    const added=[...keyed].filter(([id])=>!this.board.items.some(item=>item.id===id));
    if(this.board.items.length+added.length>1000)throw Error('This canvas holds up to 1,000 items. Remove an item before adding more.');
    if(added.length){
      const position=this.insertionPoint();
      void this.commit(added.map(([,source])=>({type:source.assetId?'addAsset':'addMedia',...source,position})),[{type:'remove',ids:added.map(([id])=>id)}]);
      await this.flush();
      if(this.pending.length||version!==this.projectVersion)return false;
    }
    this.selected=new Set(keyed.keys());this.render();this.fit(true);return true;
  }
  resolveMedia(item){
    if(item.type==='asset'){
      if(!item.asset)throw Error('Asset unavailable');
      return {media:item.asset,title:item.asset.name,description:item.asset.name,url:'/api/assets/media?id='+encodeURIComponent(item.assetId)};
    }
    const {job,media}=this.actions.findResult(item.jobId,item.mediaId);
    return {media,title:job.modelName,description:job.settings.prompt,url:this.actions.mediaURL(job,media)};
  }
  async addNote(){const version=this.projectVersion;if(!await this.load()||version!==this.projectVersion)return;const id=crypto.randomUUID();if(await this.commit([{type:'addNote',id,position:this.insertionPoint()}],[{type:'remove',ids:[id]}])&&version===this.projectVersion){this.selected=new Set([id]);this.render();this.cards.get(id)?.querySelector('textarea').focus();}}
  remove(){const items=this.selection();if(!items.length)return;for(const item of items)this.saveNote(item.id);this.commit([{type:'remove',ids:items.map(i=>i.id)}],[{type:'restore',items:copy(items)}]);this.selected.clear();this.render();this.actions.toast('Removed from canvas. Your media stays in Assets or History.');}
  undo(){if(!this.undoStack.length)return;this.commit(this.undoStack.pop());}
  arrange(layout='grid'){const items=this.selected.size?this.selection():this.board?.items||[];if(!items.length)return;const patches=organizeItems(items,layout).map(({id,...patch})=>({type:'update',id,patch}));this.commit(patches,items.map(i=>({type:'update',id:i.id,patch:{x:i.x,y:i.y}})));this.fit();}
  fit(selected=false){if(!this.board)return;this.setCamera(fitCamera(selected?this.selection():this.board.items,this.viewport.clientWidth,this.viewport.clientHeight));}
  zoom(factor){if(this.board)this.setCamera(zoomAt(this.board.camera,this.center(),this.board.camera.zoom*factor));}
  setCamera(camera){this.renderSnapGuides([]);camera.x=clamp(camera.x,-500000,500000);camera.y=clamp(camera.y,-500000,500000);this.commit([{type:'camera',camera}]);}
  renderCamera(){if(!this.board)return;const c=this.board.camera;this.stage.style.transform=`translate(${c.x}px,${c.y}px) scale(${c.zoom})`;this.viewport.style.backgroundSize=`${32*c.zoom}px ${32*c.zoom}px`;this.viewport.style.backgroundPosition=`${c.x}px ${c.y}px`;$('#canvas-reset-zoom').textContent=Math.round(c.zoom*100)+'%';}
  mediaRatio(item){
    if(this.mediaRatios.has(item.id))return this.mediaRatios.get(item.id);
    try{if(item.type==='asset')return mediaAspectRatio(item.asset);const {job,media}=this.actions.findResult(item.jobId,item.mediaId);return mediaAspectRatio(media,job.settings);}catch{return null;}
  }
  queueMediaFit(){
    if(this.mediaFitTimer)return;
    this.mediaFitTimer=setTimeout(()=>{
      this.mediaFitTimer=null;if(!this.board)return;
      if(this.gesture){this.queueMediaFit();return;}
      if(this.flushing||this.pending.length)return;
      const operations=mediaFrameCorrections(this.board.items,item=>this.mediaRatio(item));
      if(operations.length)this.commit(operations);
    },80);
  }
  render(){
    if(!this.board)return;this.queueMediaFit();this.renderCamera();if(document.activeElement!==$('#canvas-title')&&this.titleDraft===undefined)$('#canvas-title').value=this.board.title;
    const ids=new Set(this.board.items.map(i=>i.id));if(this.menuItem&&!ids.has(this.menuItem.id))this.closeContextMenu();for(const [id,node] of this.cards)if(!ids.has(id)){node.remove();this.cards.delete(id);this.selected.delete(id);}
    this.board.items.forEach((item,index)=>{
      let node=this.cards.get(item.id);if(node?.querySelector('.canvas-missing')){try{this.resolveMedia(item);node.remove();node=null;}catch{}}if(!node){node=this.makeCard(item);this.cards.set(item.id,node);this.stage.append(node);}
      Object.assign(node.style,{left:item.x+'px',top:item.y+'px',width:item.width+'px',height:item.height+'px',zIndex:String(index+1)});node.classList.toggle('selected',this.selected.has(item.id));node.setAttribute('aria-selected',String(this.selected.has(item.id)));
      if(item.type==='note'){const input=node.querySelector('textarea');if(input!==document.activeElement)input.value=item.text;}
    });
    this.renderGroups();$('#canvas-download').disabled=!!this.downloading||!this.selection().some(i=>['media','asset'].includes(i.type));$('#canvas-selection-count').textContent=this.selected.size+' selected';$('#canvas-group').disabled=!this.groupsEnabled||this.selected.size<2;$('#canvas-ungroup').disabled=!this.groupsEnabled||!this.selection().some(i=>i.groupId);$('#canvas-reuse').disabled=this.selection().filter(i=>i.type==='media').length!==1;$('#canvas-remove').disabled=!this.selected.size;$('#canvas-clear-selection').disabled=!this.selected.size;$('#canvas-arrange').disabled=!this.board.items.length;$('#canvas-row').disabled=!this.board.items.length;$('#canvas-undo').disabled=!this.undoStack.length;this.renderActivity();
  }
  renderGroups(){
    const groups=new Map();for(const item of this.board.items)if(item.groupId){if(!groups.has(item.groupId))groups.set(item.groupId,[]);groups.get(item.groupId).push(item);}
    for(const [id,node] of this.groupNodes)if(!groups.has(id)){node.remove();this.groupNodes.delete(id);}
    for(const [id,items] of groups){let node=this.groupNodes.get(id);if(!node){node=document.createElement('div');node.className='canvas-group-frame';node.dataset.canvasGroup=id;node.innerHTML=`<div class="canvas-group-title"><button data-group-handle="${esc(id)}" aria-label="Move group" title="Drag this handle to move the group">⠿</button><input data-group-name="${esc(id)}" aria-label="Group name" maxlength="60"></div>`;this.stage.prepend(node);this.groupNodes.set(id,node);}const box=bounds(items);Object.assign(node.style,{left:box.x-14+'px',top:box.y-18+'px',width:box.width+28+'px',height:box.height+32+'px'});node.classList.toggle('selected',items.some(i=>this.selected.has(i.id)));const input=node.querySelector('input');if(input!==document.activeElement)input.value=this.groupDrafts.get(id)??items[0].groupName;}
  }
  makeCard(item){
    const node=document.createElement('article');node.className='canvas-card '+(item.type==='note'?'canvas-note':'');node.dataset.canvasItem=item.id;node.tabIndex=0;node.setAttribute('role','group');
    if(item.type==='note'){node.setAttribute('aria-label','Canvas note');node.innerHTML=`<header><span>Note</span><div class="canvas-card-tools"><button data-action="remove" aria-label="Remove note">${this.actions.icon('close')}</button></div></header><textarea data-note="${esc(item.id)}" aria-label="Note text" maxlength="3000" placeholder="A thought, a direction, a connection…"></textarea>`;node.querySelector('textarea').value=item.text;}
    else {
      try{
        const {media,url,title,description}=this.resolveMedia(item),video=media.contentType.startsWith('video/');node.setAttribute('aria-label',`${video?'Video':'Image'} · ${title}`);
        node.classList.add('canvas-media');node.setAttribute('aria-haspopup','menu');node.setAttribute('aria-keyshortcuts','Shift+F10');
        const element=document.createElement(video?'video':'img');element.draggable=false;
        const version=this.projectVersion;
        element.addEventListener(video?'loadedmetadata':'load',()=>{
          if(version!==this.projectVersion||this.cards.get(item.id)!==node)return;
          const ratio=mediaAspectRatio({width:video?element.videoWidth:element.naturalWidth,height:video?element.videoHeight:element.naturalHeight});
          if(ratio){this.mediaRatios.set(item.id,ratio);this.queueMediaFit();}
        });element.src=url;
        if(video){element.controls=true;element.playsInline=true;element.preload='metadata';element.setAttribute('aria-label','Canvas video');}else{element.alt=description;element.loading='lazy';}
        element.addEventListener('error',()=>{if(node.querySelector('.canvas-media-error'))return;const message=document.createElement('div');message.className='canvas-media-error';message.textContent='Media preview unavailable. Check its saved copy in Assets or History.';node.append(message);});node.append(element);if(video){const surface=document.createElement('div');surface.className='canvas-video-move';surface.setAttribute('aria-hidden','true');node.append(surface);}
      }catch{node.innerHTML='<header><span>Media unavailable</span></header><p class="canvas-missing">This image or video could not be found.</p>';}
    }
    const resize=document.createElement('button');resize.className='canvas-resize';resize.dataset.resize='true';resize.setAttribute('aria-label','Resize canvas item');resize.title='Drag to resize';node.append(resize);return node;
  }
  renderActivity(){
    const jobs=this.jobs.filter(j=>j.settings.destination==='ideation'),active=jobs.filter(j=>j.tasks.some(t=>activeStatuses.includes(t.status)));
    this.stage.querySelectorAll('.canvas-ghost').forEach(n=>n.remove());
    for(const job of active)job.tasks.forEach((task,index)=>{if(!activeStatuses.includes(task.status))return;const point=job.settings.canvasPosition||{x:0,y:0},node=document.createElement('div');node.className='canvas-card canvas-ghost';Object.assign(node.style,{left:(point.x+index*336)+'px',top:point.y+'px',width:'300px',height:'260px'});node.innerHTML='<span class="spinner"></span><span></span>';node.querySelector('span:last-child').textContent=task.status==='IN_PROGRESS'?'Generating…':'Waiting for the model…';this.stage.append(node);});
    $('#canvas-empty').hidden=!!this.board?.items.length||!!active.length;const latest=jobs[0],bad=!active.length&&latest?.tasks.find(t=>['FAILED','UNKNOWN'].includes(t.status));const el=$('#canvas-generation-status');el.hidden=!active.length&&!bad;el.classList.toggle('failed',!!bad);el.replaceChildren();
    if(active.length)el.textContent=`${active.length} generation${active.length===1?'':'s'} on your canvas. You can keep creating and arranging your ideas.`;
    else if(bad){el.append(document.createTextNode(bad.error||'Generation could not finish.'));const button=document.createElement('button');button.textContent='View in Create';button.addEventListener('click',()=>this.actions.showHistory());el.append(button);}
  }
  pointerDown(e){
    if(!this.board||e.button>1)return;const node=e.target.closest('[data-canvas-item]'),item=node&&this.board.items.find(i=>i.id===node.dataset.canvasItem),resize=e.target.closest('[data-resize]'),groupHandle=e.target.closest('[data-group-handle]');
    if(!resize&&!groupHandle&&e.target.closest('button,a,input,textarea,video')&&!this.space&&e.button!==1)return;
    this.renderSnapGuides([]);
    const pan=this.space||e.button===1||(!item&&!groupHandle&&this.tool==='pan'),additive=e.shiftKey||e.metaKey||e.ctrlKey;
    if(pan){this.gesture={kind:'pan',start:{x:e.clientX,y:e.clientY},camera:copy(this.board.camera)};this.viewport.classList.add('panning');}
    else if(!item&&!groupHandle){this.gesture={kind:'select',start:{x:e.clientX,y:e.clientY},point:this.point(e),base:additive?[...this.selected]:[]};if(!additive)this.selected.clear();}
    else{
      const ids=groupHandle?new Set(this.board.items.filter(i=>i.groupId===groupHandle.dataset.groupHandle).map(i=>i.id)):expandSelection(this.board.items,[item.id]);
      if(additive){const removing=[...ids].every(id=>this.selected.has(id));for(const id of ids)removing?this.selected.delete(id):this.selected.add(id);if(removing){this.render();return;}}
      else if(![...ids].every(id=>this.selected.has(id)))this.selected=ids;
      if(resize)this.selected=new Set([item.id]);
      this.gesture={kind:resize?'resize':'move',start:{x:e.clientX,y:e.clientY},zoom:this.board.camera.zoom,items:copy(this.selection())};
    }
    this.viewport.focus({preventScroll:true});this.viewport.setPointerCapture(e.pointerId);e.preventDefault();this.render();
  }
  pointerMove(e){
    const g=this.gesture;if(!g)return;const dx=e.clientX-g.start.x,dy=e.clientY-g.start.y;g.moved=g.moved||Math.abs(dx)+Math.abs(dy)>3;
    if(!g.moved)return;
    if(g.kind==='select'){const end=this.point(e),rect=$('#canvas-marquee');rect.hidden=false;Object.assign(rect.style,{left:Math.min(g.point.x,end.x)+'px',top:Math.min(g.point.y,end.y)+'px',width:Math.abs(end.x-g.point.x)+'px',height:Math.abs(end.y-g.point.y)+'px'});this.selected=expandSelection(this.board.items,[...g.base,...rectangleSelection(this.board.items,worldPoint(g.point,this.board.camera),worldPoint(end,this.board.camera))]);this.render();return;}
    if(g.kind==='pan'){this.board.camera={...g.camera,x:clamp(g.camera.x+dx,-500000,500000),y:clamp(g.camera.y+dy,-500000,500000)};this.renderCamera();return;}
    const snapped=g.kind==='move'?snapTranslation(g.items,this.board.items,{x:dx/g.zoom,y:dy/g.zoom},{zoom:g.zoom,enabled:this.snapEnabled&&!e.altKey}):null;
    this.renderSnapGuides(snapped?.guides||[]);
    for(const source of g.items){const item=this.board.items.find(i=>i.id===source.id);if(!item)continue;
      if(g.kind==='move'){item.x=source.x+snapped.dx;item.y=source.y+snapped.dy;}
      else if(['media','asset'].includes(item.type)){const ratio=this.mediaRatio(source)||source.width/source.height,size=mediaFrameSize(source.width+dx/g.zoom,ratio);if(size)Object.assign(item,size);}
      else{item.width=clamp(source.width+dx/g.zoom,120,2000);item.height=clamp(source.height+dy/g.zoom,100,3000);}
      const node=this.cards.get(item.id);Object.assign(node.style,{left:item.x+'px',top:item.y+'px',width:item.width+'px',height:item.height+'px'});
    }
    this.renderGroups();
  }
  pointerUp(e,cancel=false){
    const g=this.gesture;if(!g)return;this.gesture=null;this.viewport.classList.remove('panning');$('#canvas-marquee').hidden=true;if(this.viewport.hasPointerCapture(e.pointerId))this.viewport.releasePointerCapture(e.pointerId);
    if(cancel)this.renderSnapGuides([]);else this.guideTimer=setTimeout(()=>this.renderSnapGuides([]),700);
    if(g.kind==='select'){if(cancel)this.selected=new Set(g.base);this.render();return;}
    if(cancel){if(g.camera)this.board.camera=g.camera;for(const source of g.items||[])Object.assign(this.board.items.find(i=>i.id===source.id)||{},source);this.render();return;}
    if(!g.moved)return;if(g.kind==='pan')this.setCamera(this.board.camera);
    else{const keys=g.kind==='resize'?['width','height']:['x','y'];const patch=item=>Object.fromEntries(keys.map(k=>[k,item[k]]));this.commit(this.selection().map(i=>({type:'update',id:i.id,patch:patch(i)})),g.items.map(i=>({type:'update',id:i.id,patch:patch(i)})));}
  }
  wheel(e){
    if(!this.board)return;e.preventDefault();this.closeContextMenu();
    this.renderSnapGuides([]);
    if(e.ctrlKey||e.metaKey)this.board.camera=zoomAt(this.board.camera,this.point(e),this.board.camera.zoom*Math.exp(-e.deltaY*.01));
    else{const factor=e.deltaMode===1?16:1;this.board.camera.x=clamp(this.board.camera.x-e.deltaX*factor,-500000,500000);this.board.camera.y=clamp(this.board.camera.y-e.deltaY*factor,-500000,500000);}
    this.renderCamera();clearTimeout(this.wheelTimer);this.wheelTimer=setTimeout(()=>{this.wheelTimer=null;this.setCamera(this.board.camera);},250);
  }
  renderSnapGuides(guides){
    clearTimeout(this.guideTimer);const layer=$('#canvas-snap-guides');layer.replaceChildren();if(!this.board)return;
    const c=this.board.camera;
    for(const guide of guides){const line=document.createElement('div');line.className='canvas-snap-guide '+(guide.axis==='x'?'vertical':'horizontal');
      if(guide.axis==='x')Object.assign(line.style,{left:guide.value*c.zoom+c.x+'px',top:guide.from*c.zoom+c.y-10+'px',height:(guide.to-guide.from)*c.zoom+20+'px'});
      else Object.assign(line.style,{top:guide.value*c.zoom+c.y+'px',left:guide.from*c.zoom+c.x-10+'px',width:(guide.to-guide.from)*c.zoom+20+'px'});
      layer.append(line);
    }
  }
  keyDown(e){
    if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
      const node=e.target.closest('[data-canvas-item]')||this.cards.get([...this.selected][0]);
      if(node){e.preventDefault();const rect=node.getBoundingClientRect();this.openContextMenu(node.dataset.canvasItem,rect.left+20,rect.top+20);return;}
    }
    if(e.target.closest('textarea,input,video')||!this.board)return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='g'){e.preventDefault();e.shiftKey?this.ungroup():this.group();return;}
    if(e.code==='Space'){this.space=true;e.preventDefault();return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();this.undo();return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'){e.preventDefault();this.selected=new Set(this.board.items.map(i=>i.id));this.render();return;}
    if(e.key==='Escape'){this.selected.clear();this.render();return;}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();this.remove();return;}
    if(e.key==='0'){e.preventDefault();this.fit();return;}
    const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},dir=directions[e.key];
    if(dir&&this.selected.size){e.preventDefault();const amount=e.shiftKey?20:2,items=this.selection();this.commit(items.map(i=>({type:'update',id:i.id,patch:{x:clamp(i.x+dir[0]*amount,-100000,100000),y:clamp(i.y+dir[1]*amount,-100000,100000)}})),items.map(i=>({type:'update',id:i.id,patch:{x:i.x,y:i.y}})));}
  }
  openContextMenu(id,x,y){
    const item=this.board?.items.find(i=>i.id===id);if(!item)return;this.closeContextMenu();
    if(!this.selected.has(id)){this.selected=expandSelection(this.board.items,[id]);this.render();}
    const menu=this.contextMenu;menu.replaceChildren();this.menuItem=item;
    const title=document.createElement('div');title.className='canvas-context-title';menu.append(title);
    const button=(label,action,icon)=>{const el=document.createElement('button');el.type='button';el.setAttribute('role','menuitem');if(action)el.dataset.action=action;el.innerHTML=this.actions.icon(icon);const text=document.createElement('span');text.textContent=label;el.append(text);menu.append(el);return el;};
    title.textContent='Note';
    if(item.type==='asset'){
      try{
        const resolved=this.resolveMedia(item);title.textContent=resolved.title;
        button('Use as reference','reference','image');
        const download=document.createElement('a');download.href=resolved.url+'&download=1';download.download='';download.setAttribute('role','menuitem');download.innerHTML=this.actions.icon('download')+'<span>Download</span>';menu.append(download);
      }catch{title.textContent='Asset unavailable';}
    }else if(item.type==='media'){
      try{
        const {job,media}=this.actions.findResult(item.jobId,item.mediaId);title.textContent=job.modelName;
        if(/^(image|video)\//.test(media.contentType)&&this.actions.assetsEnabled?.())button('Add to Asset Library','asset','box');
        button('Reuse generation settings','reuse','repeat');button('Use as reference','reference','image');button(media.favorite?'Remove from Favorites':'Add to Favorites','favorite','star');
        const drag=button('Drag to references or Favorites',null,'grip');drag.draggable=true;drag.dataset.referenceDrag='true';
        const download=document.createElement('a');download.href=this.actions.mediaURL(job,media,true);download.download='';download.setAttribute('role','menuitem');download.innerHTML=this.actions.icon('download')+'<span>Download</span>';menu.append(download);
      }catch{title.textContent='Media unavailable';}
    }
    const remove=button('Remove from canvas','remove','close');remove.classList.add('canvas-context-remove');
    menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
    const rect=menu.getBoundingClientRect();menu.style.left=clamp(x,8,Math.max(8,window.innerWidth-rect.width-8))+'px';menu.style.top=clamp(y,8,Math.max(8,window.innerHeight-rect.height-8))+'px';menu.querySelector('[role=menuitem]')?.focus({preventScroll:true});
  }
  closeContextMenu(restoreFocus=false){
    const item=this.menuItem;this.menuItem=null;this.contextMenu.hidden=true;
    if(restoreFocus&&item)this.cards.get(item.id)?.focus({preventScroll:true});
  }
  contextMenuKey(e){
    if(e.key==='Escape'){e.preventDefault();this.closeContextMenu(true);return;}
    if(e.key==='Tab'){this.closeContextMenu(true);return;}
    const items=[...this.contextMenu.querySelectorAll('[role=menuitem]')],index=items.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();
    }
  }
  async cardAction(e){const action=e.target.closest('[data-action]');if(!action||!this.board)return;const item=this.board.items.find(i=>i.id===action.closest('[data-canvas-item]').dataset.canvasItem);if(!item)return;
    await this.runCardAction(action.dataset.action,item);
  }
  async runCardAction(action,item){
    if(action==='remove'){this.selected=new Set([item.id]);this.remove();}
    if(action==='asset'){await this.actions.saveAsset(item.jobId,item.mediaId);}
    if(action==='reuse'){await this.actions.reuseSettings(item.jobId);}
    if(action==='reference'){if(item.type==='asset')await this.actions.useAsset(item.asset,this.resolveMedia(item).url);else await this.actions.useReference(item.jobId,item.mediaId);}
    if(action==='favorite'){try{const {media}=this.actions.findResult(item.jobId,item.mediaId);await this.actions.favorite(item.jobId,item.mediaId,!media.favorite);this.render();}catch(error){this.actions.toast(error.message);}}
  }
  noteInput(e){if(!e.target.matches('textarea[data-note]'))return;const id=e.target.dataset.note,item=this.board.items.find(i=>i.id===id);if(!item)return;
    const edit=this.editing.get(id)||{before:item.text};edit.text=e.target.value;this.editing.set(id,edit);item.text=edit.text;clearTimeout(this.noteTimers.get(id));this.noteTimers.set(id,setTimeout(()=>this.saveNote(id),600));$('#canvas-save-state').textContent='Saving…';
  }
  saveNote(id){const edit=this.editing.get(id);if(!edit)return;clearTimeout(this.noteTimers.get(id));this.editing.delete(id);this.noteTimers.delete(id);if(edit.text!==edit.before)this.commit([{type:'update',id,patch:{text:edit.text}}],[{type:'update',id,patch:{text:edit.before}}]);}
}
