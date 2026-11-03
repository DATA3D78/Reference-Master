import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {findSpace,mediaAspectRatio,mediaFrameSize} from './public/canvas-state.js';
const fail=message=>Object.assign(new Error(message),{status:400});
const number=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=250;
const grouping=item=>(item.groupId===undefined&&item.groupName===undefined)||(id(item.groupId)&&typeof item.groupName==='string'&&item.groupName.trim().length>0&&item.groupName.length<=60);
const geometry=item=>number(item.x,-100000,100000)&&number(item.y,-100000,100000)&&number(item.width,120,2000)&&number(item.height,100,3000);
export function validateCanvasPosition(position){if(position===undefined)return {x:0,y:0};if(!position||!number(position.x,-90000,90000)||!number(position.y,-90000,90000))throw fail('Choose a valid canvas position.');return {x:position.x,y:position.y};}
const newBoard=()=>({version:1,revision:0,title:'Untitled ideas',camera:{x:60,y:60,zoom:1},items:[],seen:[]});
function validBoard(b){return b&&b.version===1&&Number.isInteger(b.revision)&&typeof b.title==='string'&&b.title.length<=80&&b.camera&&number(b.camera.x,-500000,500000)&&number(b.camera.y,-500000,500000)&&number(b.camera.zoom,.15,3)&&Array.isArray(b.items)&&b.items.length<=1000&&b.items.every(i=>id(i.id)&&['media','asset','note'].includes(i.type)&&geometry(i)&&grouping(i)&&(i.type==='media'?id(i.jobId)&&id(i.mediaId):i.type==='asset'?id(i.assetId):typeof i.text==='string'&&i.text.length<=3000))&&new Set(b.items.map(i=>i.id)).size===b.items.length&&Array.isArray(b.seen)&&b.seen.every(id);}
export async function createIdeationStore({directory,findMedia,findAsset}){
  const file=join(directory,'ideation.json');let state=newBoard(),queue=Promise.resolve();
  try{state=JSON.parse(await readFile(file,'utf8'));if(!validBoard(state))throw Error('Invalid board');}catch(error){if(error.code!=='ENOENT')throw new Error('Cannot read the saved ideation canvas. Preserve .local/ideation.json before repairing it.');}
  const snapshot=()=>structuredClone(state);
  const transact=fn=>{const next=queue.catch(()=>{}).then(async()=>{const draft=snapshot();if(!fn(draft))return snapshot();if(!validBoard(draft))throw fail('The canvas update is invalid.');draft.revision=state.revision+1;await writeFile(file+'.tmp',JSON.stringify(draft),{mode:0o600});await rename(file+'.tmp',file);state=draft;return snapshot();});queue=next;return next;};
  const addMedia=(draft,jobId,mediaId,position)=>{
    const {job,media}=findMedia(jobId,mediaId),itemId=`media:${jobId}:${mediaId}`;
    if(media.contentType?.startsWith('audio/'))throw fail('Audio is available in Audio, History and Favorites. The canvas accepts images and videos.');
    if(draft.items.some(i=>i.id===itemId))return;
    if(draft.items.length>=1000)throw fail('This canvas holds up to 1,000 items. Remove an item before adding another.');
    const ratio=mediaAspectRatio(media,job.settings)||(job.mode==='video'?16/9:1),{width,height}=mediaFrameSize(300,ratio)||{width:300,height:300};
    const point=findSpace(draft.items,validateCanvasPosition(position),width,height);
    draft.items.push({id:itemId,type:'media',jobId,mediaId,...point,width,height});if(!draft.seen.includes(itemId))draft.seen.push(itemId);
  };
  const assetFor=(assetId,adding=false)=>{
    if(!id(assetId)||!findAsset)throw fail('Choose an asset from your library.');
    const asset=findAsset(assetId);
    if(!asset||! /^(image|video)\//.test(asset.contentType))throw fail('The canvas accepts images and videos.');
    if(adding&&asset.deletedAt)throw fail('Restore this asset from Trash before adding it.');
    return asset;
  };
  const addAsset=(draft,assetId,position)=>{
    const asset=assetFor(assetId,true),itemId=`asset:${assetId}`;
    if(draft.items.some(i=>i.id===itemId))return;
    if(draft.items.length>=1000)throw fail('This canvas holds up to 1,000 items. Remove an item before adding another.');
    const ratio=mediaAspectRatio(asset)||(asset.contentType.startsWith('video/')?16/9:1),{width,height}=mediaFrameSize(300,ratio)||{width:300,height:300};
    const point=findSpace(draft.items,validateCanvasPosition(position),width,height);
    draft.items.push({id:itemId,type:'asset',assetId,...point,width,height});
  };
  const mutate=operations=>transact(draft=>{
    if(!Array.isArray(operations)||operations.length<1||operations.length>1000)throw fail('Choose a valid canvas update.');
    for(const op of operations){
      if(!op||typeof op!=='object')throw fail('Invalid canvas operation.');
      if(op.type==='camera'){
        if(!op.camera||!number(op.camera.x,-500000,500000)||!number(op.camera.y,-500000,500000)||!number(op.camera.zoom,.15,3))throw fail('Invalid canvas zoom or position.');
        draft.camera={x:op.camera.x,y:op.camera.y,zoom:op.camera.zoom};
      }else if(op.type==='title'){
        if(typeof op.title!=='string'||op.title.length>80||!op.title.trim())throw fail('Name your canvas using 1–80 characters.');draft.title=op.title.trim();
      }else if(op.type==='addMedia')addMedia(draft,op.jobId,op.mediaId,op.position);
      else if(op.type==='addAsset')addAsset(draft,op.assetId,op.position);
      else if(op.type==='addNote'){
        if(draft.items.some(i=>i.id===op.id&&i.type==='note'))continue;
        if(!id(op.id)||draft.items.some(i=>i.id===op.id)||draft.items.length>=1000)throw fail('Cannot add this note.');
        const point=findSpace(draft.items,validateCanvasPosition(op.position),260,200);
        draft.items.push({id:op.id,type:'note',...point,width:260,height:200,text:''});
      }else if(op.type==='update'){
        const item=draft.items.find(i=>i.id===op.id);if(!item)throw fail('This canvas item is no longer available.');
        if(!op.patch||Object.keys(op.patch).some(k=>!['x','y','width','height','text'].includes(k)))throw fail('Invalid canvas item change.');
        if('text' in op.patch&&(item.type!=='note'||typeof op.patch.text!=='string'||op.patch.text.length>3000))throw fail('Notes must be at most 3,000 characters.');
        Object.assign(item,op.patch);if(!geometry(item))throw fail('Invalid canvas item size or position.');
      }else if(op.type==='groups'){
        if(!Array.isArray(op.members)||op.members.length>1000)throw fail('Choose valid group members.');
        for(const member of op.members){const item=draft.items.find(i=>i.id===member.id);if(!item)throw fail('This group item is no longer available.');if(!grouping(member))throw fail('Invalid group name or identifier.');delete item.groupId;delete item.groupName;if(member.groupId){item.groupId=member.groupId;item.groupName=member.groupName;}}
      }else if(op.type==='remove'){
        if(!Array.isArray(op.ids)||op.ids.some(i=>!id(i)))throw fail('Choose canvas items to remove.');draft.items=draft.items.filter(i=>!op.ids.includes(i.id));
      }else if(op.type==='restore'){
        if(!Array.isArray(op.items)||op.items.length>1000)throw fail('Cannot restore these items.');
        for(const item of op.items){
          if(item.type==='media')findMedia(item.jobId,item.mediaId);
          if(item.type==='asset')assetFor(item.assetId);
          const restored=structuredClone(item);delete restored.asset;
          if(!draft.items.some(i=>i.id===item.id))draft.items.push(restored);
        }
      }else if(op.type==='front'){
        const item=draft.items.find(i=>i.id===op.id);if(item){draft.items=draft.items.filter(i=>i.id!==item.id);draft.items.push(item);}
      }else throw fail('Unknown canvas operation.');
    }
    return true;
  });
  const syncJobs=jobs=>transact(draft=>{
    let changed=false;
    for(const job of [...jobs].reverse())if(job.settings.destination==='ideation')for(const task of job.tasks)if(task.status==='COMPLETED')for(const media of (task.outputs||[]).filter(m=>!m.deletedAt)){
      const key=`media:${job.id}:${media.id}`;
      if(!draft.seen.includes(key)&&draft.items.length<1000){addMedia(draft,job.id,media.id,job.settings.canvasPosition);changed=true;}
    }
    return changed;
  });
  return {snapshot,mutate,syncJobs};
}
