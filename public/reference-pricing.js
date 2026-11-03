// Published provider prices; final charges come from fal billing events.
import {MODELS,capabilities,imageDimensions,validateReferenceFiles,validateReferenceSelection} from './models.js';
export const PRICING_CHECKED = '2026-10-19';
const GPT_PRICE_EXAMPLES = [
  [1024,768, .00402,.00903,.03612,.06420,.14445],
  [1024,1024,.00588,.01317,.05268,.09366,.21072],
  [1024,1536,.00474,.01029,.04116,.07377,.16464],
  [1920,1080,.00441,.01029,.03960,.07041,.15840],
  [2560,1440,.00615,.01434,.05529,.09828,.22110],
  [3840,2160,.01113,.02595,.10008,.17790,.40026],
];
const VIDEO_RATES = {
  wan3:{'480p':.05,'720p':.10,'1080p':.20},
  'minimax-h3':{'480p':.05,'768p':.06,'2K':.13,'4K':.16},
  'flux3-video':{'720p':.17,'1080p':.29},
};
export function formatUSD(value) {
  if(!Number.isFinite(value))return '—';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
}
// Published frame sizes, rather than a fixed short edge: square 720p is 960×960.
const SEEDANCE_SIZES={
  '480p':{'21:9':[992,432],'16:9':[864,496],'4:3':[752,560],'1:1':[640,640],'3:4':[560,752],'9:16':[496,864],'9:21':[432,992]},
  '720p':{'21:9':[1470,630],'16:9':[1280,720],'4:3':[1112,834],'1:1':[960,960],'3:4':[834,1112],'9:16':[720,1280],'9:21':[630,1470]},
};
export function seedanceFrameSize(resolution,ratio,references=[]){
  let chosen=ratio,automatic=ratio==='From image';
  if(automatic){
    const m=references.find(r=>r.kind==='image')?.metadata;
    if(!Number.isFinite(m?.width)||!Number.isFinite(m?.height)||m.width<=0||m.height<=0)return null;
    const aspect=m.width/m.height;
    chosen=Object.keys(SEEDANCE_SIZES['720p']).sort((a,b)=>{
      const value=r=>{const [w,h]=r.split(':').map(Number);return Math.abs(Math.log(aspect/(w/h)));};return value(a)-value(b);
    })[0];
  }
  const size=(SEEDANCE_SIZES[resolution]||SEEDANCE_SIZES['720p'])[chosen];
  if(!size)return null;
  const scale=resolution==='1080p'?1.5:1;
  return {width:Math.round(size[0]*scale),height:Math.round(size[1]*scale),automatic,derived:resolution==='1080p',ratio:chosen};
}
export function estimateReferenceCost(settings,references=[],now=new Date(),{preview=false}={}) {
  const model=MODELS.find(m=>m.id===settings.model);
  if(model?.provider==='comfy')return {available:false,currency:'USD',source:'comfy',statusLabel:'—',reason:'Comfy pricing is shown by the provider; fal.ai rates do not apply.',lines:[],notes:[]};
  const source=model?.endpoints?.[settings.inputType];
  const result={available:false,currency:'USD',checkedAt:PRICING_CHECKED,source:'reference',referenceProvider:'fal.ai',approximate:true,url:source?`https://fal.ai/models/${source}`:undefined,
    label:'Estimated total',lines:[],notes:[],count:settings.count};
  const unavailable=(note,statusLabel='Not available')=>({...result,statusLabel,reason:note,notes:[...result.notes,note]});
  if(!model?.available||!source)return unavailable('Pricing is unavailable for this model.');
  const c=capabilities(model,settings.inputType);
  if(!c.resolutions.includes(settings.resolution)||!c.ratios.includes(settings.ratio)||!Number.isInteger(settings.count)||settings.count<1||settings.count>(model.mode==='image'?4:2))return unavailable('Choose valid generation settings to see a price.');
  if(model.mode==='video'&&!c.durations.includes(settings.duration))return unavailable('Choose a video duration to see a price.');
  // Missing inputs do not hide fixed prices in the composer. Submission and
  // historical billing estimates still require their complete reference set.
  try{validateReferenceFiles(model,settings.inputType,references);if(!preview)validateReferenceSelection(model,settings,references);}catch(e){return unavailable(e.message,'Check inputs');}
  
  const age=now.getTime()-Date.parse(result.checkedAt+'T00:00:00Z');
  result.stale=age>7*86400000;
  if(result.stale)result.notes.push('These saved rates are over a week old. Check current fal.ai pricing before generating.');
  const round=value=>Math.round((value+Number.EPSILON)*1e8)/1e8;
  const finish=(perOutput,maximum=perOutput)=>({...result,available:true,perOutput:round(perOutput),minimum:round(perOutput*settings.count),maximum:round(maximum*settings.count),reason:[`${result.referenceProvider} published rates, checked ${result.checkedAt}; Final fal.ai billing may differ.`,...result.notes,result.url].filter(Boolean).join(' ')});
  const addImageLine=rate=>result.lines.push(`${settings.count} image${settings.count===1?'':'s'} × ${formatUSD(rate)} each`);
  if(settings.inputType==='edit'){
    const duration=references[0]?.metadata?.duration;
    if(!Number.isFinite(duration)||duration<=0)return unavailable('Add a video with a readable duration to estimate its editing cost.','Add video');
    result.lines.push(`${settings.count} video${settings.count===1?'':'s'} × ${round(duration)}s × $0.03 / second`);
    result.notes.push('FLUX FAST editing at 720p. Estimated output length follows the source clip; final duration can vary.');
    return finish(duration*.03);
  }
  if(model.id==='nano21'){
    const tokens={'1K':1120,'2K':1680,'4K':3780}[settings.resolution],rate=tokens*35.294/1e6;
    result.label='Estimated image output';result.extraUsage=true;result.approximate=true;addImageLine(rate);
    result.lines.push(`${tokens.toLocaleString('en-US')} estimated output image tokens × $35.294 / 1M tokens per image`);
    result.notes.push('Token-based billing. Prompt and reference input tokens cost $1.764 / 1M; text and thinking output cost $8.823 / 1M. These are extra and cannot be known before generation.','The selected thinking level affects additional usage. Resolution token counts are representative; actual token usage may differ.');
    return finish(rate);
  }
  if(model.family==='krea'){
    const rate=settings.inputType==='image'?model.referencePrice:model.textPrice;addImageLine(rate);
    result.notes.push(settings.inputType==='image'?'Style-reference generation rate, regardless of the number of references.':'Text-to-image rate. Adding style references uses a different rate.');return finish(rate);
  }
  if(model.family==='nano'){
    const rate=settings.resolution==='4K'?.30:.15;
    addImageLine(rate);result.notes.push('1K and 2K use the standard rate; 4K costs twice as much.');
    return finish(rate);
  }
  if(model.id==='seedream5-lite'){
    addImageLine(.035);result.notes.push('Flat rate per output image, including reference editing.');return finish(.035);
  }
  if(model.id==='seedream5-pro'){
    const size=imageDimensions(model,settings.ratio,settings.resolution),rate=size.width*size.height<=1536**2?.0675:.135;
    const extra=settings.inputType==='image'?Math.max(0,references.length-1)*.0045:0;
    addImageLine(rate+extra);result.lines.push(`${size.width} × ${size.height} px · ${formatUSD(rate)} base per image`);
    if(extra)result.lines.push(`${references.length-1} additional reference${references.length===2?'':'s'} × $0.0045 per output`);
    result.notes.push('fal labels these rates tentative. The first reference image is free.');return finish(rate+extra);
  }
  if(model.family==='flux-image'){
    // Direct publisher rates fill fal's unpublished higher-resolution tiers.
    result.referenceProvider='BFL';result.url='https://bfl.ai/pricing';
    const rate={'1K':.048,'2K':.10,'4K':.607}[settings.resolution];
    addImageLine(rate);result.notes.push('Regular list price per output image; references have no separate charge.');return finish(rate);
  }

  if(model.family==='gpt'){
    const quality=settings.quality||'high';
    if(!model.qualities.includes(quality))return unavailable('Choose a supported quality.');
    const {width,height}=imageDimensions(model,settings.ratio,settings.resolution);
    // Only canonical examples are published. Scale the nearest example by pixel area,
    // explicitly as a heuristic for image output alone; do not invent token totals.
    const distance=([w,h])=>Math.abs(Math.log(width*height/(w*h)))+Math.abs(Math.log(width/height/(w/h)));
    const row=[...GPT_PRICE_EXAMPLES].sort((a,b)=>distance(a)-distance(b))[0];
    const scale=width*height/(row[0]*row[1]);
    const prices=row.slice(2).map(p=>p*scale);
    const index=['low','medium','high','xhigh','max'].indexOf(quality);
    const minimum=quality==='auto'?prices[0]:prices[index],maximum=quality==='auto'?prices[4]:minimum;
    result.label='Image cost estimate';result.extraUsage=true;result.approximate=true;
    result.lines.push(`${settings.count} image${settings.count===1?'':'s'} · ${width} × ${height} px · ${quality} quality`);
    result.notes.push('Output images only. Prompt, reference-image and reasoning tokens are extra; the final total can be higher.');
    if(scale!==1||row[0]!==width||row[1]!==height)result.notes.push(`Approximation scaled by pixel area from fal’s ${row[0]} × ${row[1]} example; actual token usage varies.`);
    if(quality==='auto')result.notes.push('Auto quality spans the published low-to-max image rates. This is not a spending limit.');
    result.lines.push('Text: $5 input / $10 output per 1M tokens; images: $8 input / $30 output per 1M tokens.');
    return finish(minimum,maximum);
  }
  if(settings.duration==='Smart')return unavailable('Smart duration is chosen by the model. Final cost depends on output length plus input video duration.','Variable');
  const duration=Number(settings.duration);
  let inputSeconds=0;
  if(settings.inputType==='video'){
    const videos=references.filter(r=>r.kind==='video');
    if(videos.some(r=>!Number.isFinite(r.metadata?.duration)||r.metadata.duration<=0))return unavailable('Wait for reference video durations to load.','Reading video');
    inputSeconds=videos.reduce((sum,r)=>sum+r.metadata.duration,0);
  }
  if(model.family==='seedance'){
    const frame=seedanceFrameSize(settings.resolution,settings.ratio,references);
    if(!frame)return unavailable('Add a reference image to determine the output aspect ratio.','Add image');
    const {width,height}=frame;result.approximate=true;
    if(frame.automatic)result.notes.push(`Automatic framing is estimated using the closest published ${frame.ratio} size; the provider may choose a different frame size.`);
    if(frame.derived)result.notes.push('1080p dimensions are estimated by scaling the published 720p frame size by 1.5; final provider sizing can differ.');
    const seconds=duration+inputSeconds,rate=model.id==='seedance20'?.014:settings.resolution==='1080p'?.0234:.0214,discount=inputSeconds>0?(model.id==='seedance20'?.0086016/.014:.6):1;
    const tokens=width*height*seconds*24/1024,perOutput=tokens/1000*rate*discount;
    result.lines.push(`${settings.count} video${settings.count===1?'':'s'} × ${formatUSD(perOutput)} estimated each`);
    result.lines.push(`${duration}s output${inputSeconds?` + ${round(inputSeconds)}s references`:''} · ≈ ${width} × ${height} px at 24 fps`);
    result.lines.push(`${Math.round(tokens).toLocaleString('en-US')} tokens × ${formatUSD(rate)} / 1,000${discount<1?' × '+round(discount)+' reference discount':''} per video`);
    result.notes.push('Token estimate; final frame dimensions and duration can vary. Audio uses the same published rate.');
    return finish(perOutput);
  }
  let rate=VIDEO_RATES[model.id]?.[settings.resolution];
  if(model.family==='flux-video'&&settings.inputType==='video')rate=settings.resolution==='720p'?.41:.53;
  if(!Number.isFinite(rate))return unavailable('No verified rate is available for these settings.');
  const billableSeconds=duration+(model.family==='wan'?inputSeconds:0),perOutput=rate*billableSeconds;
  result.lines.push(`${settings.count} video${settings.count===1?'':'s'} × ${billableSeconds.toFixed(2).replace(/\.00$/,'')}s × ${formatUSD(rate)} / second`);
  if(model.family==='wan'&&inputSeconds)result.lines.push(`${duration}s output + ${round(inputSeconds)}s input video per generation`);
  if(model.family==='flux-video'&&settings.inputType==='video')result.notes.push('Uses the higher video-extension rate, applied to generated seconds.');
  result.notes.push(model.family==='minimax'?'Native audio is included.':'Audio uses the same published rate.');
  return finish(perOutput);
}


// Each queue task creates one output; never store a whole batch total per task.
export function referenceBillingEstimate(settings,references=[],now=new Date(),options={}){
  const value=estimateReferenceCost({...settings,count:1},references,now,options);
  return value.available?{amount:value.minimum,maximum:value.maximum,extraUsage:!!value.extraUsage,checkedAt:value.checkedAt,source:'reference',referenceProvider:value.referenceProvider,url:value.url}:null;
}
export function seedAudioReference(duration){
  const base={available:false,source:'reference',referenceProvider:'fal.ai',currency:'USD',checkedAt:PRICING_CHECKED,approximate:true,url:'https://fal.ai/models/bytedance/seed-audio-1.0',statusLabel:'After generation',reason:'fal.ai reference rate: $0.1875 per generated minute. Duration is known after generation; Final fal.ai billing may differ.'};
  if(!Number.isFinite(duration)||duration<=0)return base;
  const amount=Math.round(duration*.1875/60*1e8)/1e8;
  return {...base,available:true,minimum:amount,maximum:amount};
}
