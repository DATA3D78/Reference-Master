// Stable shader indices keep saved looks independent of gallery order.
const effect=(id,name,description,index,category,controls={},defaults={},colors=false,sourceColors=false,animated=false)=>({id,name,description,index,category,controls,defaults,colors,sourceColors,animated});
export const EFFECTS=[
 effect('none','Original','Clear the effect stack',0,'All'),
 effect('vhs','VHS','Analog tape, scanlines and color drift',7,'Screen & Motion',{size:'Tracking drift'},{},false,false,true),
 effect('dither','Dithering','Ordered ink patterns and reduced tones',2,'Drawing',{size:'Dot scale',threshold:'Brightness'},{},true,true),
 effect('halftone','Halftone','Rotated print dots that follow the image',3,'Drawing',{size:'Dot scale',angle:'Screen angle'},{},true,true),
 effect('pixel','Pixelate','A clean grid of sampled color blocks',4,'Digital',{size:'Pixel size'}),
 effect('threshold','Threshold','Separate light and dark into two tones',6,'Drawing',{threshold:'Cutoff'},{},true,true),
 effect('duotone','Duotone','Two custom colors across the tonal range',8,'Color & Glass',{threshold:'Tone balance'},{},true),
 effect('glass','Reeded Glass','Directional fluted glass refraction',10,'Color & Glass',{size:'Rib width',angle:'Glass direction'}),
 effect('receipt-scans','Receipt Scans','Rough thermal prints with scanner jitter',15,'Print & Paper',{size:'Print texture',threshold:'Ink density',seed:'Texture seed',speed:'Scan speed'},{size:4,threshold:.52,foreground:'#24201d',background:'#f3efe5'},true,false,true),
 effect('receipt','Receipt','Faded thermal ink on a torn paper slip',16,'Print & Paper',{size:'Print texture',threshold:'Ink density',seed:'Texture seed'},{size:3,threshold:.5,foreground:'#282421',background:'#f4f0e6'},true),
 effect('stippling','Stippling','Scattered ink dots shaped by shadow',17,'Drawing',{size:'Dot spacing',threshold:'Ink density',seed:'Dot seed'},{size:5,foreground:'#24221f',background:'#f4efe1',sourceColor:false},true,true),
 effect('cross-hatch','Cross Hatch','Layered pen strokes in the shadows',18,'Drawing',{size:'Line spacing',angle:'Stroke angle',threshold:'Ink density'},{size:7,foreground:'#272521',background:'#f2eddf',sourceColor:false},true,true),
 effect('euphoria','Euphoria','Violet shadows, pink light and soft bloom',19,'Screen & Motion',{size:'Bloom radius',threshold:'Highlight glow'},{size:18,threshold:.58,foreground:'#ffa3ce',background:'#34216b'},true),
 effect('torn-photo','Torn Photo','Offset photo fragments with fibrous edges',20,'Print & Paper',{size:'Tear width',angle:'Tear direction',threshold:'Tear position',seed:'Paper seed'},{size:16,angle:78,background:'#e7dfd0',foreground:'#fff8eb'},true),
 effect('scribble-frames','Scribble Frames','Loose hand-drawn borders around the frame',21,'Drawing',{size:'Frame width',threshold:'Stroke density',seed:'Scribble seed',speed:'Boil speed'},{size:16,foreground:'#f7efcb',background:'#161619'},true,false,true),
 effect('bad-signal','Bad Signal','Horizontal dropouts, static and RGB tearing',22,'Screen & Motion',{size:'Signal displacement',threshold:'Dropout density',seed:'Signal seed',speed:'Interference speed'},{size:20,threshold:.45},false,false,true),
 effect('slow-shutter','Slow Shutter','Long-exposure trails and luminous smears',23,'Screen & Motion',{size:'Trail length',angle:'Trail direction',threshold:'Exposure persistence'},{size:28,angle:12,threshold:.65}),
 effect('gameboy','Gameboy Camera','Four green tones and a dithered pixel grid',24,'Digital',{size:'Pixel size',threshold:'Exposure'},{size:7,threshold:.52,foreground:'#d5e6a5',background:'#193d2e'},true),
 effect('ps1','PS1','Low-resolution color, facets and texture wobble',25,'Digital',{size:'Pixel size',threshold:'Color depth',seed:'Texture seed',speed:'Wobble speed'},{size:7,threshold:.45},false,false,true),
 effect('grunge-dither','Grunge Dither','Broken dither with distressed ink and dirt',26,'Digital',{size:'Dot size',threshold:'Distress',seed:'Texture seed'},{size:4,foreground:'#211f1d',background:'#e8e0cb',sourceColor:false},true,true),
 effect('mixed-media','Mixed Media','Color fragments, print, hatch and paper collage',27,'Print & Paper',{size:'Collage scale',angle:'Cut direction',threshold:'Print coverage',seed:'Layout seed'},{size:30,angle:12,foreground:'#22252a',background:'#f0dfb5'},true),
 effect('motion-freeze','Motion Freeze','Crisp repeated exposures with a held video echo',28,'Screen & Motion',{size:'Echo spacing',angle:'Motion direction',threshold:'Freeze interval'},{size:25,angle:0,threshold:.35}),
 effect('one-d','1D','Stretch a sampled image slice into color ribbons',29,'Digital',{size:'Ribbon width',angle:'Ribbon direction',threshold:'Slice position'},{size:4,angle:0,threshold:.5}),
 effect('tv','TV','Curved CRT glass, phosphor pixels and scanlines',30,'Screen & Motion',{size:'Phosphor scale',threshold:'Screen curvature'},{size:3,threshold:.4},false,false,true),
 effect('grunge','Grunge','Rough paper, dust, scratches and worn color',31,'Print & Paper',{size:'Texture scale',threshold:'Wear',seed:'Texture seed'},{size:15,threshold:.5,background:'#d5c5a4',foreground:'#302c26'},true),
 effect('static-grain','Static Grain','A fixed, repeatable film-grain texture',32,'Screen & Motion',{size:'Grain size',threshold:'Grain strength',seed:'Grain seed'},{size:3,threshold:.5}),
 effect('gradient-map','Gradient Map','Custom shadow, midtone and highlight colors',33,'Color & Glass',{threshold:'Midtone position'},{foreground:'#ffdda1',midtone:'#c76584',background:'#202b56'},true),
];
export const EFFECT_CATEGORIES=['All','Print & Paper','Drawing','Screen & Motion','Digital','Color & Glass'];
export function effectDefinition(id){return EFFECTS.find(e=>e.id===id)||EFFECTS[0];}
export function filterEffects(query='',category='All'){const q=query.trim().toLowerCase();return EFFECTS.filter(e=>(category==='All'||e.category===category)&&(e.name+' '+e.description).toLowerCase().includes(q));}
export const GRADE_FIELDS=[
 ['exposure','Exposure',-5,5,.05,0],['contrast','Contrast',-100,100,1,0],['highlights','Highlights',-100,100,1,0],['shadows','Shadows',-100,100,1,0],['warmth','Warmth',-100,100,1,0],['tint','Tint',-100,100,1,0],
 ['saturation','Saturation',-100,100,1,0],['vibrance','Vibrance',-100,100,1,0],
 ['grain','Grain',0,100,1,0],['glow','Glow',0,100,1,0],['halation','Halation',0,100,1,0],['vignette','Vignette',-100,100,1,0],
 ['lensBlur','Lens blur',0,100,1,0],['atmosphere','Atmosphere',0,100,1,0],['relight','Relight',0,100,1,0],
];
export const GRADE_GROUPS=[{id:'light',name:'Light',keys:['exposure','contrast','highlights','shadows','warmth','tint']},{id:'colour',name:'Colour',keys:['saturation','vibrance']},{id:'film',name:'Film & Optics',keys:['grain','glow','halation','vignette']},{id:'depth',name:'Depth',keys:['lensBlur','atmosphere','relight']}];
export const needsDepth=grade=>['lensBlur','atmosphere','relight'].some(key=>grade[key]>0);
export const gradeValue=(key,value)=>key==='exposure'?value.toFixed(2)+' EV':(value>0?'+':'')+Math.round(value);
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export function defaultEffect(id='none'){return {id,amount:100,size:8,angle:45,threshold:.5,foreground:'#e6dec9',background:'#151820',sourceColor:true,...effectDefinition(id).defaults,...(effectDefinition(id).controls.seed?{seed:1}:{}),...(effectDefinition(id).controls.speed?{speed:1}:{})};}
export function defaultEdit(){return {grade:Object.fromEntries(GRADE_FIELDS.map(([id,,,,,value])=>[id,value])),curves:Object.fromEntries(['rgb','r','g','b'].map(c=>[c,[[0,0],[1,1]]])),effects:[]};}
export function normalizeEdit(value={}){
 if(!value||typeof value!=='object')value={};
 const d=defaultEdit();for(const [key,,min,max] of GRADE_FIELDS)if(Number.isFinite(value.grade?.[key]))d.grade[key]=clamp(value.grade[key],min,max);
 // Legacy curves are retained for preset compatibility but no longer rendered.
 for(const c of Object.keys(d.curves)){const points=value.curves?.[c];if(Array.isArray(points)&&points.length>=2&&points.length<=12&&points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))){const sorted=points.map(([x,y])=>[clamp(x),clamp(y)]).sort((a,b)=>a[0]-b[0]);if(sorted[0][0]===0&&sorted.at(-1)[0]===1&&sorted.every((p,i)=>!i||p[0]-sorted[i-1][0]>=.005))d.curves[c]=sorted;}}
 // An explicit empty stack clears effects. Older drafts and presets migrate
 // from their single effect without changing its parameters.
 const entries=Array.isArray(value.effects)?value.effects:[value.effect],seen=new Set();
 for(const e of entries){
  if(!e||e.id==='none'||seen.has(e.id)||!EFFECTS.some(f=>f.id===e.id))continue;
  seen.add(e.id);const effect=defaultEffect(e.id);
  for(const [key,min,max] of [['amount',0,100],['size',2,64],['angle',0,180],['threshold',0,1],['seed',0,999],['speed',0,3]])if(Number.isFinite(e[key]))effect[key]=clamp(e[key],min,max);
  for(const key of ['foreground','background','midtone'])if(/^#[\da-f]{6}$/i.test(e[key]||''))effect[key]=e[key];
  if(typeof e.sourceColor==='boolean')effect.sourceColor=e.sourceColor;
  d.effects.push(effect);
 }
 return d;
}
// A preset only changes its own section; references, export options and the
// other section's adjustments belong to the current editing session.
export function presetSettings(kind,value){
 if(!['color','effects'].includes(kind))throw Error('Choose Color Grading or Effects.');
 const settings=normalizeEdit(value);
 return kind==='color'?{grade:settings.grade,curves:settings.curves}:{effects:settings.effects};
}
export function applyEditPreset(current,preset){
 return normalizeEdit({...normalizeEdit(current),...presetSettings(preset.kind,preset.settings)});
}
// Monotone cubic interpolation avoids overshoot between user-defined curve points.
export function curveValue(points,x){
 const slopes=points.slice(1).map((p,i)=>(p[1]-points[i][1])/(p[0]-points[i][0]));
 const m=points.map((p,i)=>i===0?slopes[0]:i===points.length-1?slopes.at(-1):slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
 const i=Math.max(0,Math.min(points.length-2,points.findIndex((p,j)=>j<points.length-1&&x<=points[j+1][0]))),a=points[i],b=points[i+1],h=b[0]-a[0],t=clamp((x-a[0])/h);
 return clamp((2*t**3-3*t*t+1)*a[1]+(t**3-2*t*t+t)*h*m[i]+(-2*t**3+3*t*t)*b[1]+(t**3-t*t)*h*m[i+1]);
}
export function curveTexture(curves){const bytes=new Uint8Array(256*4);for(let i=0;i<256;i++){const v=curveValue(curves.rgb,i/255);for(let c=0;c<3;c++)bytes[i*4+c]=Math.round(curveValue(curves[['r','g','b'][c]],v)*255);bytes[i*4+3]=255;}return bytes;}
export function exportSize(width,height,longEdge=0){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('The source has no readable dimensions.');const scale=longEdge?Math.min(1,longEdge/Math.max(width,height)):1;return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
