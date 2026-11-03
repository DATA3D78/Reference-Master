import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,retainedReferenceInput,referenceCompatibility,buildInput,capabilities} from '../public/models.js';

const model=id=>MODELS.find(m=>m.id===id);
const image={id:'image-1',kind:'image',name:'reference.png',preview:'blob:kept-image',data:'data:image/png;base64,aGVsbG8=',bytes:100,contentType:'image/png',metadata:{width:480,height:480}};
const video={id:'video-1',kind:'video',name:'reference.mp4',preview:'blob:kept-video',data:'data:video/mp4;base64,aGVsbG8=',bytes:100,contentType:'video/mp4',metadata:{width:480,height:480,duration:4}};
const audio={id:'audio-1',kind:'audio',name:'reference.wav',preview:'blob:kept-audio',data:'data:audio/wav;base64,aGVsbG8=',bytes:100,contentType:'audio/wav',metadata:{duration:2}};
function settings(m,inputType){const c=capabilities(m,inputType);return {model:m.id,inputType,prompt:'A moving blue sculpture',ratio:c.ratios[0],resolution:c.resolutions[0],duration:'5',count:1};}

test('all compatible image model switches keep ordered references usable in the provider payload',()=>{
  const refs=[image,{...image,id:'image-2',data:'second-image'}],before=structuredClone(refs);
  for(const m of MODELS.filter(m=>m.mode==='image')){
    assert.equal(retainedReferenceInput(m,'image',refs),'image');
    assert.equal(referenceCompatibility(m,'image',refs),'');
    const {input}=buildInput(settings(m,'image'),refs);
    assert.deepEqual(m.family==='krea'?input.image_style_references.map(r=>r.image_url):input.image_urls,refs.map(r=>r.data));
  }
  assert.deepEqual(refs,before);
});
test('mixed image, video and audio inputs remain usable when changing between reference video models',()=>{
  const refs=[image,video,audio],before=structuredClone(refs);
  for(const id of ['wan3','seedance25','minimax-h3']){
    const m=model(id),type=retainedReferenceInput(m,'video',refs);
    assert.equal(type,'video');assert.equal(referenceCompatibility(m,type,refs),'');
    const {input}=buildInput(settings(m,type),refs),prefix=m.referencePrefix||'';
    for(const ref of refs)assert.deepEqual(input[prefix+ref.kind+'_urls'],[ref.data]);
  }
  assert.deepEqual(refs,before);
});
test('lower model limits warn without trimming references, and switching back restores compatibility',()=>{
  const refs=Array.from({length:10},(_,i)=>({...image,id:'image-'+i})),before=structuredClone(refs);
  assert.match(referenceCompatibility(model('nano-pro'),'image',refs),/up to 8 image references.*10/);
  assert.equal(referenceCompatibility(model('nano21'),'image',refs),'');
  assert.deepEqual(refs,before);
  const clips=Array.from({length:4},(_,i)=>({...video,id:'video-'+i,metadata:{...video.metadata,duration:2}}));
  assert.match(referenceCompatibility(model('minimax-h3'),'video',clips),/up to 3 video references.*4/);
  assert.equal(referenceCompatibility(model('seedance25'),'video',clips),'');
});
test('unsupported inputs fall back to the closest supported reference input without modifying files',()=>{
  assert.equal(retainedReferenceInput(model('wan3'),'edit',[video]),'video');
  assert.equal(retainedReferenceInput(model('nano-pro'),'video',[image,video]),'image');
  assert.equal(retainedReferenceInput(model('seedance25'),'keyframes',[image,image,image]),'video');
  assert.equal(retainedReferenceInput(model('wan3'),'frames',[image,image]),'frames');
  assert.equal(retainedReferenceInput(model('nano-pro'),'missing',[]),'text');
});
test('unsupported types, combined caps and metadata are flagged before spending credits',()=>{
  assert.match(referenceCompatibility(model('flux3-video'),'video',[image,video]),/does not accept image/);
  assert.match(referenceCompatibility(model('nano-pro'),'text',[image]),/does not accept image/);
  assert.match(referenceCompatibility(model('minimax-h3'),'video',[...Array(9).fill(image),...Array(3).fill(video),audio]),/up to 12 reference files together.*13/);
  assert.match(referenceCompatibility(model('wan3'),'video',[{...video,bytes:31*1024**2}]),/file size/);
  assert.match(referenceCompatibility(model('wan3'),'video',[{...video,metadata:{...video.metadata,duration:20}}]),/15 seconds/);
  assert.match(referenceCompatibility(model('flux3-image'),'image',[{...image,metadata:{width:2500,height:2500}}]),/4 megapixels/);
});
