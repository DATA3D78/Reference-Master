import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, formatCostEstimate, seedanceFrameSize, formatUSD, MODELS, capabilities } from '../public/models.js';
const checked=new Date('2026-10-02T12:00:00Z');
const base={model:'nano-pro',inputType:'text',ratio:'1:1',resolution:'1K',duration:'5',count:1,quality:'high',audio:false};
const image={kind:'image',metadata:{width:1280,height:720}};
const video=duration=>({kind:'video',metadata:{width:1280,height:720,duration}});
const quote=(settings={},refs=[],date=checked)=>estimateCost({...base,...settings},refs,date);

test('Nano Banana 2.1 quotes image tokens separately from unknown input and thinking usage',()=>{
  for(const [resolution,tokens] of [['1K',1120],['2K',1680],['4K',3780]]){
    const estimate=quote({model:'nano21',resolution,count:3});
    assert(Math.abs(estimate.minimum-tokens*35.294/1e6*3)<1e-8);assert.equal(estimate.extraUsage,true);assert.equal(estimate.label,'Estimated image output');assert.equal(estimate.checkedAt,'2026-10-09');
    assert.equal(quote({model:'nano21',resolution,inputType:'image'},Array(14).fill(image)).available,true);
    assert.equal(quote({model:'nano21',resolution,inputType:'image'},Array(15).fill(image)).available,false);
  }
});
test('Krea 2 variants use their published text or style-reference rate per output',()=>{
  for(const [model,text,style]of [['krea2-large',.06,.065],['krea2-medium',.03,.035],['krea2-medium-turbo',.015,.0175]]){
    assert.equal(quote({model,resolution:'Native',count:4}).minimum,text*4);
    assert.equal(quote({model,resolution:'Native',count:4,inputType:'image'},Array(10).fill(image)).minimum,style*4);
    assert.equal(quote({model,resolution:'4K'}).available,false);
  }
});

test('image batch totals include 4K multipliers and reference-image surcharges',()=>{
  assert.equal(quote({count:4}).minimum,.6);
  assert.equal(quote({count:4,resolution:'4K'}).minimum,1.2);
  assert.equal(quote({model:'seedream5-lite',resolution:'4K',count:4}).minimum,.14);
  assert.equal(quote({model:'seedream5-pro',resolution:'1K',count:2,inputType:'image'},[image,image,image]).minimum,.153);
  assert.equal(quote({model:'seedream5-pro',resolution:'2K',count:2,inputType:'image'},[image,image,image]).minimum,.288);
  assert.equal(quote({model:'seedream5-pro',resolution:'2K',count:2}).minimum,.27);
  assert.equal(quote({model:'seedream5-pro',resolution:'2K',count:2,inputType:'image'},Array(8).fill(image)).minimum,.333);
});
test('FLUX image promotion expires and unknown tiers are not extrapolated',()=>{
  assert.equal(quote({model:'flux3-image',count:4}).minimum,.096);
  assert.equal(quote({model:'flux3-image'},[],new Date('2026-10-08T00:00:00Z')).minimum,.048);
  for(const resolution of ['2K','4K'])assert.equal(quote({model:'flux3-image',resolution}).available,false);
  assert(quote({},[],new Date('2026-11-02T12:00:00Z')).notes.some(n=>n.includes('over a week old')));
});
test('video estimates use the selected duration, resolution and batch count',()=>{
  assert.equal(quote({model:'wan3',resolution:'720p',duration:'10',count:2}).minimum,2);
  assert.equal(quote({model:'wan3',resolution:'1080p',duration:'10',count:2}).minimum,4);
  assert.equal(quote({model:'minimax-h3',resolution:'4K',duration:'15',count:2}).minimum,4.8);
  assert.equal(quote({model:'flux3-video',resolution:'1080p',duration:'10',count:2}).minimum,5.8);
});
test('reference and extension billing use endpoint-specific rules',()=>{
  assert.equal(quote({model:'wan3',resolution:'720p',inputType:'video',count:2},[video(4.125)]).minimum,1.825);
  assert.equal(quote({model:'minimax-h3',resolution:'768p',inputType:'video'},[video(4)]).minimum,.3);
  assert.equal(quote({model:'flux3-video',resolution:'720p'}).minimum,.85);
  const extension=quote({model:'flux3-video',resolution:'720p',inputType:'video'},[video(4)]);
  assert.equal(extension.minimum,2.05);
  assert.equal(extension.source,'https://fal.ai/models/blackforestlabs/flux-3/extend-video');
});
test('Seedance reproduces fal’s frame-area example and includes discounted input seconds for each output',()=>{
  const settings={model:'seedance25',resolution:'720p',ratio:'16:9'};
  assert.equal(quote(settings).minimum,2.3112);
  assert.equal(quote({...settings,ratio:'9:16'}).minimum,2.3112);
  assert.equal(quote({...settings,ratio:'1:1'}).minimum,quote(settings).minimum);
  assert.equal(quote({...settings,inputType:'image',ratio:'From image'},[image]).minimum,2.3112);
  assert.equal(quote({...settings,inputType:'video',count:2},[video(2)]).minimum,3.882816);
  assert.equal(quote({...settings,resolution:'1080p'}).minimum,5.6862);
});
test('Seedance mixed references bill only video durations and apply the video discount only when a video is present',()=>{
  const settings={model:'seedance25',inputType:'video',resolution:'720p',ratio:'16:9',duration:'10'};
  const audio={kind:'audio',metadata:{duration:30.2}};
  assert.equal(quote(settings,[image,audio]).minimum,4.6224);
  assert.equal(quote(settings,[audio]).minimum,4.6224);
  assert.equal(quote(settings,[image,audio,video(8)]).minimum,4.992192);
  assert.equal(quote(settings,[image,video(4),audio,video(4)]).minimum,4.992192);
  assert.equal(quote(settings,Array(31).fill(image)).available,false);
});
test('mixed Wan references count only video seconds while MiniMax soundtracks and FLUX frame/edit modes use endpoint rates',()=>{
  const audio={kind:'audio',metadata:{duration:3}};
  assert.equal(quote({model:'wan3',inputType:'video',resolution:'720p'},[image,audio]).minimum,.5);
  assert.equal(quote({model:'wan3',inputType:'video',resolution:'720p'},[image,audio,video(3)]).minimum,.8);
  assert.equal(quote({model:'minimax-h3',inputType:'video',resolution:'768p'},[image,audio,video(3)]).minimum,.3);
  assert.equal(quote({model:'minimax-h3',resolution:'768p'},[audio]).minimum,.3);
  const flux={model:'flux3-video',resolution:'720p'};
  assert.equal(quote({...flux,inputType:'frames'},[image,image]).minimum,.85);
  assert.equal(quote({...flux,inputType:'keyframes',frameIndices:[0,120]},[image,image]).minimum,.85);
  assert.equal(quote({...flux,inputType:'keyframes',frameIndices:[0,0]},[image,image]).available,false);
  assert.equal(quote({...flux,inputType:'edit',ratio:'From video',duration:'From video',count:2},[video(4)]).minimum,.24);
});
test('GPT estimates retain quality and output-only uncertainty instead of claiming a total',()=>{
  for(const model of ['gpt25-flare','gpt25-sunburst']){
    const high=quote({model,count:2});assert.equal(high.minimum,.10536);assert.equal(high.extraUsage,true);assert.equal(high.label,'Image cost estimate');
    const auto=quote({model,quality:'auto'});assert.equal(auto.minimum,.00588);assert.equal(auto.maximum,.21072);
    assert(quote({model,resolution:'2K'}).minimum>high.minimum/2);
    assert(quote({model,resolution:'2K'}).notes.some(n=>n.includes('Approximation')));
    assert(quote({model,inputType:'image'},[image]).notes.some(n=>n.includes('reference-image')));
    assert.equal(quote({model,quality:'ultra'}).available,false);
  }
});
test('missing inputs and invalid settings never appear as free generations',()=>{
  for(const settings of [{model:'no-such-model'},{model:'seedance25-fast'},{count:0},{count:1.5},{resolution:'16K'},{ratio:'bad'},{inputType:'video'},{inputType:'image'},{model:'wan3',resolution:'720p',duration:'invalid'}])assert.equal(quote(settings).available,false);
  assert.equal(quote({model:'wan3',resolution:'720p',inputType:'video'},[video(NaN)]).available,false);
  assert.equal(quote({model:'seedance25',resolution:'720p',ratio:'From image',inputType:'image'},[{kind:'image'}]).available,false);
  assert.equal(quote({inputType:'image'},[video(4)]).available,false);
  assert.equal(formatUSD(.035),'$0.035');assert.equal(formatUSD(NaN),'—');
});
test('all selectable combinations return finite positive estimates or an explicit unsupported tier',()=>{
  for(const model of MODELS.filter(m=>m.available))for(const inputType of model.inputs){
    const caps=capabilities(model,inputType),refs=inputType==='text'?[]:inputType==='frames'?[image,image]:['image','end','keyframes'].includes(inputType)?[image]:[video(4)];
    for(const resolution of caps.resolutions)for(const ratio of caps.ratios){
      const result=quote({model:model.id,inputType,resolution,ratio,duration:inputType==='edit'?'From video':'5',frameIndices:inputType==='keyframes'?[0]:undefined},refs);
      if(model.id==='flux3-image'&&resolution!=='1K'){assert.equal(result.available,false);continue;}
      assert.equal(result.available,true,model.id+' '+inputType+' '+resolution+' '+ratio);
      assert(Number.isFinite(result.minimum)&&result.minimum>0);assert(Number.isFinite(result.maximum)&&result.maximum>=result.minimum);
      assert(result.source.startsWith('https://fal.ai/models/'));
    }
  }
});


test('composer estimates fixed prices before references are uploaded without relaxing submission or historical estimates',()=>{
  const preview=(settings,refs=[])=>estimateCost({...base,...settings},refs,checked,{preview:true});
  assert.equal(preview({inputType:'image'}).minimum,.15);
  assert.equal(preview({inputType:'image',resolution:'2K'}).minimum,.15);
  assert.equal(preview({inputType:'image',resolution:'4K',count:4}).minimum,1.2);
  assert.equal(preview({model:'krea2-large',inputType:'image',resolution:'Native',count:2}).minimum,.13);
  assert.equal(preview({model:'seedream5-pro',inputType:'image',resolution:'2K'}).minimum,.135);
  assert.equal(preview({model:'seedream5-pro',inputType:'image',resolution:'2K'},[image,image,image]).minimum,.144);
  assert.equal(preview({model:'minimax-h3',inputType:'frames',resolution:'4K',duration:'15',count:2,ratio:'From image'}).minimum,4.8);
  assert.equal(quote({inputType:'image'}).available,false);
  for(const model of ['wan3','seedance25']){
    const settings={model,inputType:'video',resolution:'720p'};
    assert.equal(preview(settings).available,false);
    assert.equal(preview(settings).statusLabel,'Add references');
    assert.equal(preview(settings,[video(3)]).available,true);
  }
  assert.equal(preview({model:'seedance25',inputType:'image',resolution:'720p',ratio:'From image'}).statusLabel,'Add image');
  assert.equal(preview({model:'flux3-video',inputType:'edit',resolution:'720p',ratio:'From video',duration:'From video'}).statusLabel,'Add video');
  assert.equal(preview({inputType:'image'},[video(4)]).available,false);
});

test('Seedance uses published dimensions across every ratio, instead of treating every resolution as a short edge',()=>{
  const sizes={
    '480p':{'21:9':[992,432],'16:9':[864,496],'4:3':[752,560],'1:1':[640,640],'3:4':[560,752],'9:16':[496,864]},
    '720p':{'21:9':[1470,630],'16:9':[1280,720],'4:3':[1112,834],'1:1':[960,960],'3:4':[834,1112],'9:16':[720,1280]},
  };
  for(const [resolution,ratios]of Object.entries(sizes))for(const [ratio,[width,height]]of Object.entries(ratios)){
    const cost=quote({model:'seedance25',resolution,ratio,duration:'10',count:2});
    assert.equal(cost.minimum,Math.round(width*height*10*24/1024/1000*.0214*2*1e8)/1e8);
    assert.equal(cost.approximate,true);
    const auto=seedanceFrameSize(resolution,'From image',[{kind:'image',metadata:{width,height}}]);
    assert.equal(auto.width,width);assert.equal(auto.height,height);assert.equal(auto.automatic,true);
  }
  assert.equal(quote({model:'seedance25',resolution:'720p',ratio:'1:1'}).minimum,2.3112);
  assert.equal(quote({model:'seedance25',resolution:'480p',ratio:'1:1'}).minimum,1.0272);
  assert(quote({model:'seedance25',resolution:'1080p',ratio:'1:1'}).notes.some(n=>n.includes('scaling')));
});

test('every offered video duration and resolution scales by output count; video audio switches do not invent surcharges',()=>{
  for(const model of MODELS.filter(m=>m.available&&m.mode==='video'))for(const resolution of model.resolutions)for(const duration of model.durations){
    const settings={model:model.id,resolution,duration,ratio:'16:9'},one=quote(settings),two=quote({...settings,count:2});
    assert(one.available);assert(Math.abs(two.minimum-one.minimum*2)<1e-7);
    assert.equal(quote({...settings,audio:true}).minimum,one.minimum);
  }
});

test('compact totals distinguish fixed prices, approximations, output-only usage and missing inputs',()=>{
  assert.equal(formatCostEstimate(quote()),'$0.15');
  assert.equal(formatCostEstimate(quote({model:'seedance25',resolution:'720p',ratio:'1:1'})),'≈$2.3112');
  assert.match(formatCostEstimate(quote({model:'gpt25-flare'})),/^≈.* \+ usage$/);
  assert.match(formatCostEstimate(quote({model:'gpt25-flare',quality:'auto'})),/–/);
  assert.equal(formatCostEstimate({available:false,statusLabel:'Add video'}),'Add video');
  assert.equal(formatCostEstimate(quote({model:'flux3-image',resolution:'4K'})),'Not available');
});
