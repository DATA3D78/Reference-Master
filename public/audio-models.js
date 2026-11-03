// Verified against fal.ai's endpoint schemas and pricing on 2026-10-09.
export const AUDIO_MODELS=[
 {id:'seed-audio',name:'Seed Audio 1.0',endpoint:'bytedance/seed-audio-1.0',maxPrompt:2048,description:'Create speech and sound from text, audio references or an image.'},
].map(model=>({...model,provider:'comfy',available:model.id==='seed-audio',docs:'https://docs.comfy.org/development/comfy-router',pricing:'https://platform.comfy.org'}));
export const SEED_VOICES=['stokie_en','vivi_mixed_en_zh_ja_es_id','mindy_en_es_id_pt_zh','kian_en_zh','cedric_en_zh','sophie_en_zh','jean_en_zh','magnus_en_zh','mabel_en_zh','nadia_en_zh','opal_en_zh','pearl_en_zh','quentin_en_zh','corinne_mixed_en_zh','esther_mixed_en_zh','lyla_mixed_en_zh','tracy_es_zh','sandy_es_mixed_en_zh','felix_zh','celeste_zh','monkey_king_zh'];
export const audioModel=id=>AUDIO_MODELS.find(model=>model.id===id);
export const audioDefaults=id=>id==='seed-audio'?{voice:'',output_format:'mp3',sample_rate:24000,speed:1,volume:1,pitch:0,multilingual:false}:{duration:60,seed:'',num_inference_steps:30,guidance_scale:1.7};
export function audioOptions(id,values={}){
 if(!audioModel(id))throw Error('Choose a supported audio model.');
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid audio settings.');
 const defaults=audioDefaults(id),result={};
 const n=(key,min,max,integer=false)=>{const value=values[key]??defaults[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw Error(key.replaceAll('_',' ')+' must be between '+min+' and '+max+'.');result[key]=value;};
 if(id==='seed-audio'){
  const voice=values.voice??'';if(typeof voice!=='string'||voice.length>200||/[\r\n]/.test(voice))throw Error('Enter a valid preset voice or voice ID.');if(voice.trim())result.voice=voice.trim();
  const format=values.output_format??'mp3';if(!['mp3','wav','ogg_opus'].includes(format))throw Error('Choose MP3, WAV or Ogg Opus output.');result.output_format=format;
  const rate=values.sample_rate??24000;if(![8000,16000,24000,32000,44100,48000].includes(rate))throw Error('Choose a supported sample rate.');result.sample_rate=rate;
  n('speed',.5,2);n('volume',.5,2);n('pitch',-12,12,true);
  const multilingual=values.multilingual??false;if(typeof multilingual!=='boolean')throw Error('Choose a valid multilingual setting.');result.multilingual=multilingual;
 }else{
  n('duration',1,300);n('num_inference_steps',1,100,true);n('guidance_scale',0,20);
  if(values.seed!==''&&values.seed!=null){if(!Number.isSafeInteger(values.seed))throw Error('Seed must be a whole number.');result.seed=values.seed;}
 }
 return result;
}
export function validateAudioReferences(kind,refs){
 const max=kind==='audio'?3:kind==='image'?1:0;
 if(!Array.isArray(refs)||refs.length>max)throw Error(kind==='audio'?'Use up to 3 audio references.':kind==='image'?'Use one image reference.':'This starting point uses text only.');
 for(const ref of refs){
  if(!ref||ref.kind!==kind)throw Error('Choose '+kind+' references for this starting point.');
  if(!Number.isFinite(ref.bytes)||ref.bytes<=0||ref.bytes>10*1024**2)throw Error('Each reference must be up to 10 MB.');
  if(kind==='audio'){
   if(!['audio/mpeg','audio/wav','audio/ogg'].includes(ref.contentType))throw Error('Use MP3, WAV or Ogg Opus audio.');
   if(!Number.isFinite(ref.metadata?.duration)||ref.metadata.duration<=0||ref.metadata.duration>30)throw Error('Each audio reference must be up to 30 seconds.');
  }else if(!['image/png','image/jpeg','image/webp'].includes(ref.contentType)||![ref.metadata?.width,ref.metadata?.height].every(n=>Number.isInteger(n)&&n>0))throw Error('Use a valid PNG, JPG or WebP image.');
 }
}
export function buildAudioInput(body,refs=[]){
 const model=audioModel(body.model);if(!model)throw Error('Choose a supported audio model.');if(!model.available)throw Error('This audio model is not available through Comfy Router.');
 const prompt=body.prompt;if(typeof prompt!=='string'||!prompt.trim()||prompt.length>model.maxPrompt)throw Error('Enter a prompt up to '+model.maxPrompt.toLocaleString('en-US')+' characters.');
 const options=audioOptions(model.id,body.options),input={prompt:prompt.trim(),...options,enable_safety_checker:true};
 const inputType=model.id==='seed-audio'?(body.inputType||'text'):'text';
 if(!['text','image','audio'].includes(inputType))throw Error('Choose a supported starting point.');
 validateAudioReferences(inputType,refs);
 if(inputType!=='text'&&!refs.length)throw Error('Add a reference '+inputType+' first.');
 if(model.id==='seed-audio'){
  if(inputType==='audio')input.audio_urls=refs.map(r=>r.data);if(inputType==='image')input.image_url=refs[0].data;
 }else{
  if(typeof body.lyrics!=='string'||!body.lyrics.trim()||body.lyrics.length>30000)throw Error('Enter lyrics up to 30,000 characters, or use [instrumental] for an instrumental piece.');
  if(/^\s*\[(?:intro|verse|pre-chorus|chorus|post-chorus|bridge|instrumental|solo|outro)\][^\S\r\n]*\S/im.test(body.lyrics))throw Error('Put section tags such as [verse] on their own line, with lyrics on the next line.');
  input.lyrics=body.lyrics.trim();
 }
 const references=refs.map(ref=>{const value=ref.data;return {[inputType+(value.startsWith('data:')?'_data':'_url')]:value.startsWith('data:')?value.slice(value.indexOf(',')+1):value};});
 if(options.voice){if(references.length)throw Error('Use either a preset voice or reference files.');references.push({speaker:options.voice});}
 return {model,options,inputType,endpoint:'byteplus/seed-audio-1.0'+(options.multilingual?'-multilingual':''),input:{text_prompt:prompt.trim(),audio_config:{format:options.output_format,sample_rate:options.sample_rate,speech_rate:Math.round((options.speed-1)*100),loudness_rate:Math.round((options.volume-1)*100),pitch_rate:options.pitch},...(references.length?{references}:{})}};
}
export function estimateAudioCost(id,options={},duration){
 return {available:false,note:'Check Comfy platform usage for audio pricing.'};
 const model=audioModel(id),base={available:false,url:model?.pricing,checkedAt:'2026-10-09'};
 if(!model)return {...base,note:'Choose an audio model.'};
 if(Number.isFinite(duration)&&duration>0)return {...base,available:true,amount:duration*(id==='seed-audio'?.1875/60:.002),note:'Estimate based on the returned audio duration; final billing comes from fal.ai.'};
 if(id==='seed-audio')return {...base,note:'$0.1875 per generated minute. The duration is known after generation.'};
 try{const settings=audioOptions(id,options);return {...base,available:true,amount:settings.duration*.002,note:'Up to '+settings.duration+' seconds at $0.002/second. The model may finish earlier.'};}catch(error){return {...base,note:error.message};}
}
export function audioContentType(media,settings){
 const aliases={'audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/mp3':'audio/mpeg','audio/opus':'audio/ogg','application/ogg':'audio/ogg'};
 const claimed=aliases[media.content_type]||media.content_type;
 if(['audio/wav','audio/mpeg','audio/ogg'].includes(claimed))return claimed;
 const extension=new URL(media.url).pathname.split('.').pop().toLowerCase();
 return ({wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',opus:'audio/ogg'})[extension]||({mp3:'audio/mpeg',wav:'audio/wav',ogg_opus:'audio/ogg'})[settings?.options?.output_format]||'audio/wav';
}
