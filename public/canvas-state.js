export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function mediaAspectRatio(media={},settings={}){
  if(Number.isFinite(media.width)&&media.width>0&&Number.isFinite(media.height)&&media.height>0)return media.width/media.height;
  const parts=/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(settings.ratio||'');
  return parts&&Number(parts[1])>0&&Number(parts[2])>0?Number(parts[1])/Number(parts[2]):null;
}
// Keep a media frame within the saved canvas size limits without adding padding.
export function mediaFrameSize(width,ratio){
  if(!Number.isFinite(ratio)||ratio<=0)return null;
  const min=Math.max(120,100*ratio),max=Math.min(2000,3000*ratio);
  if(min>max)return null;
  const next=clamp(Number.isFinite(width)?width:300,min,max);
  return {width:next,height:clamp(next/ratio,100,3000)};
}
export function mediaFrameCorrections(items,resolveRatio){
  return items.flatMap(item=>{
    if(!['media','asset'].includes(item.type))return [];
    const size=mediaFrameSize(item.width,resolveRatio(item));
    return size&&(Math.abs(size.width-item.width)>.001||Math.abs(size.height-item.height)>.001)?[{type:'update',id:item.id,patch:size}]:[];
  });
}
export const worldPoint=(point,camera)=>({x:(point.x-camera.x)/camera.zoom,y:(point.y-camera.y)/camera.zoom});
export function zoomAt(camera,point,zoom){const world=worldPoint(point,camera),z=clamp(zoom,.15,3);return {x:point.x-world.x*z,y:point.y-world.y*z,zoom:z};}
export function bounds(items){if(!items.length)return null;const x=Math.min(...items.map(i=>i.x)),y=Math.min(...items.map(i=>i.y));return {x,y,width:Math.max(...items.map(i=>i.x+i.width))-x,height:Math.max(...items.map(i=>i.y+i.height))-y};}
export function fitCamera(items,width,height){const box=bounds(items);if(!box)return {x:60,y:60,zoom:1};const zoom=clamp(Math.min((width-100)/box.width,(height-100)/box.height),.15,1.5);return {x:(width-box.width*zoom)/2-box.x*zoom,y:(height-box.height*zoom)/2-box.y*zoom,zoom};}
export function findSpace(items,position,width,height){
  const origin={x:clamp(position?.x??0,-90000,90000),y:clamp(position?.y??0,-90000,90000)};
  for(let n=0;n<10000;n++){
    const x=origin.x+(n%5)*(width+36),y=origin.y+Math.floor(n/5)*(height+48);
    if(!items.some(i=>x<i.x+i.width+24&&x+width+24>i.x&&y<i.y+i.height+24&&y+height+24>i.y))return {x,y};
  }
  throw new Error('This part of the canvas is full. Pan to an empty area.');
}
export function gridLayout(items){const box=bounds(items);if(!box)return [];const columns=Math.ceil(Math.sqrt(items.length)),gap=36,columnWidth=Math.max(...items.map(i=>i.width))+gap;let y=box.y;const changes=[];for(let row=0;row<Math.ceil(items.length/columns);row++){const group=items.slice(row*columns,(row+1)*columns);group.forEach((item,col)=>changes.push({id:item.id,x:box.x+col*columnWidth,y}));y+=Math.max(...group.map(i=>i.height))+gap;}return changes;}
export function expandSelection(items,ids){const selected=new Set(ids),groups=new Set(items.filter(i=>selected.has(i.id)&&i.groupId).map(i=>i.groupId));return new Set(items.filter(i=>selected.has(i.id)||groups.has(i.groupId)).map(i=>i.id));}
export function rectangleSelection(items,a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),right=Math.max(a.x,b.x),bottom=Math.max(a.y,b.y);return expandSelection(items,items.filter(i=>i.x<right&&i.x+i.width>x&&i.y<bottom&&i.y+i.height>y).map(i=>i.id));}
export function organizeItems(items,layout='grid'){
  const clusters=new Map();for(const item of items){const key=item.groupId?'group:'+item.groupId:item.id;if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(item);}
  const units=[...clusters].map(([id,members])=>({id,...bounds(members)})),origin=bounds(units);if(!origin)return [];
  let x=origin.x;const placement=layout==='row'?units.map(u=>{const p={id:u.id,x,y:origin.y};x+=u.width+36;return p;}):gridLayout(units);
  return placement.flatMap(p=>{const unit=units.find(u=>u.id===p.id);return clusters.get(p.id).map(i=>({id:i.id,x:i.x+p.x-unit.x,y:i.y+p.y-unit.y}));});
}

// Snap the whole selection, never its members independently. Distances used for
// magnetic alignment are screen pixels so the feel stays consistent when zooming.
export function snapTranslation(moving,items,delta,{zoom=1,enabled=true,grid=16,tolerance=8,reach=240}={}){
  if(!moving.length)return {dx:0,dy:0,guides:[]};
  const box=bounds(moving),ids=new Set(moving.map(i=>i.id));
  const limits={x:[-100000-Math.min(...moving.map(i=>i.x)),100000-Math.max(...moving.map(i=>i.x))],y:[-100000-Math.min(...moving.map(i=>i.y)),100000-Math.max(...moving.map(i=>i.y))]};
  const result={dx:clamp(delta.x,...limits.x),dy:clamp(delta.y,...limits.y),guides:[]};
  if(!enabled)return result;
  const proposed={...box,x:box.x+result.dx,y:box.y+result.dy},targets=items.filter(i=>!ids.has(i.id)),groups=new Map();
  for(const item of targets)if(item.groupId){if(!groups.has(item.groupId))groups.set(item.groupId,[]);groups.get(item.groupId).push(item);}
  for(const members of groups.values())if(members.length>1)targets.push(bounds(members));
  const matches=[];
  for(const axis of ['x','y']){
    const size=axis==='x'?'width':'height',cross=axis==='x'?'y':'x',crossSize=axis==='x'?'height':'width',key=axis==='x'?'dx':'dy';
    const anchors=[proposed[axis],proposed[axis]+proposed[size],proposed[axis]+proposed[size]/2];
    let best;
    for(const target of targets){
      const gap=Math.max(0,target[cross]-proposed[cross]-proposed[crossSize],proposed[cross]-target[cross]-target[crossSize]);
      if(gap*zoom>reach)continue;
      const edges=[target[axis],target[axis]+target[size],target[axis]+target[size]/2];
      anchors.forEach((anchor,a)=>edges.forEach((edge,b)=>{
        if((a===2)!==(b===2))return; // Centers align to centers; edges align to edges.
        const correction=edge-anchor,distance=Math.abs(correction)*zoom,next=result[key]+correction;
        if(distance>tolerance||next<limits[axis][0]||next>limits[axis][1])return;
        if(!best||distance<best.distance-.001||(Math.abs(distance-best.distance)<.001&&gap<best.gap))best={axis,value:edge,correction,distance,gap,target};
      }));
    }
    if(best){result[key]+=best.correction;matches.push(best);}
    else if(grid>0)result[key]=clamp(Math.round(proposed[axis]/grid)*grid-box[axis],...limits[axis]);
  }
  const snapped={...box,x:box.x+result.dx,y:box.y+result.dy};
  result.guides=matches.map(({axis,value,target})=>{const cross=axis==='x'?'y':'x',size=axis==='x'?'height':'width';return {axis,value,from:Math.min(snapped[cross],target[cross]),to:Math.max(snapped[cross]+snapped[size],target[cross]+target[size])};});
  return result;
}
