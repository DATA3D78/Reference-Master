import {test} from 'node:test';
import assert from 'node:assert/strict';
import {descriptionSchema,validDescription} from '../llm-description.mjs';
import {buildLlmRequest} from '../llm-store.mjs';
import {llmOutputTitle} from '../public/llm.js';
import {description} from './fixtures/visual-description.mjs';

const image={kind:'image',contentType:'image/png',bytes:8,data:'data:image/png;base64,iVBORw0KGgo='};
const base={model:'openai/gpt-5.6-sol',task:'image',format:'json',instruction:'',maxTokens:8192};
test('JSON enforces the supplied hierarchy at every nested level',()=>{
  assert.deepEqual(Object.keys(descriptionSchema.properties),['scene_description','subject','action','environment','lighting','composition','visual_style','key_details','negative_elements']);
  const visit=schema=>{if(schema.type!=='object')return;assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,Object.keys(schema.properties));Object.values(schema.properties).forEach(visit);};visit(descriptionSchema);
  assert(validDescription(description));
  for(const mutate of [d=>delete d.subject.clothing.gloves,d=>d.action.motion_blur='Heavy',d=>d.visual_style.mood.push({label:'calm'}),d=>d.lighting.key_light=null,d=>d.composition.camera_angle=' ',d=>d.environment.extra='Unexpected',d=>d.title='Extra title']){
    const broken=structuredClone(description);mutate(broken);assert.equal(validDescription(broken),false);
  }
  const absentLists={...description,negative_elements:[]};assert(validDescription(absentLists));
});
test('JSON and plain text share detailed coverage while preserving reference and user instructions',()=>{
  for(const format of ['json','text']){
    const {payload}=buildLlmRequest({...base,format,instruction:'Focus on the transparent material.'},[image,image]);
    const system=payload.messages[0].content,user=payload.messages[1].content;
    for(const section of ['Scene description','Subject','Clothing','Motion blur','Environment','Lighting','Composition','Visual style','Key details','Negative elements'])assert(system.includes(section));
    assert.match(system,/Not applicable/);assert.match(system,/do not silently combine separate scenes/);assert.match(system,/Never add details merely to fill a field/);
    assert.match(user[0].text,/Focus on the transparent material/);assert.equal(user[3].text,'Reference image 2');
    if(format==='json'){assert.deepEqual(payload.response_format.json_schema.schema,descriptionSchema);assert.equal(payload.response_format.json_schema.strict,true);}
    else{assert.equal(payload.response_format,undefined);assert.match(system,/same coverage and depth as the JSON/);assert.match(system,/plain headings/);}
  }
});
test('refining an older output requests the new structure without losing the source or creative changes',()=>{
  const source={id:'old',status:'COMPLETED',output:JSON.stringify({title:'Old glass study',subject:'Blue glass',generation_prompt:'Blue glass on gray'})};
  const {payload}=buildLlmRequest({...base,task:'refine',instruction:'Change the glass to red.'},[],source);
  assert.match(payload.messages[0].content,/converting older source formats into this structure/);
  assert(payload.messages[1].content[0].text.includes(source.output));assert.match(payload.messages[1].content[0].text,/Change the glass to red/);
});
test('result titles support both the new scene description and older saved titles',()=>{
  const job={status:'COMPLETED',settings:{task:'image',format:'json'},output:JSON.stringify(description)};
  assert.match(llmOutputTitle(job),/^A translucent blue glass sculpture/);assert(llmOutputTitle(job).length<=100);
  assert.equal(llmOutputTitle({...job,output:'{"title":"Old glass study"}'}),'Old glass study');
  assert.equal(llmOutputTitle({...job,output:'invalid'}),'Image description');
});
