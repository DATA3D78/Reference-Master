// Direction edits stay separate from the original description. Generate refines
// them with the replacement images before submitting a saved final prompt.
import {LLM_MODELS} from './llm-models.js';
import {MODELS,validateRequest} from './models.js';
export const SHOOT_SECTIONS=[
 {id:'subject',name:'Subject',hint:'Identity, outfit and expression',roots:['subject'],reference:true},
 {id:'product',name:'Product',hint:'Introduce or replace an object',roots:['product'],reference:true},
 {id:'action',name:'Action',hint:'Movement, pose and gesture',roots:['action','subject.activity','subject.pose']},
 {id:'framing',name:'Framing',hint:'Camera angle, crop and placement',roots:['composition']},
 {id:'location',name:'Location',hint:'Setting, weather and background',roots:['environment'],reference:true},
 {id:'style',name:'Photo style',hint:'Light, mood, depth and texture',roots:['lighting','visual_style']}
];
export const SHOOT_MODELS=MODELS.filter(m=>m.mode==='image'&&m.available&&m.inputs.includes('image')&&m.family!=='krea');
export const SHOOT_SUBJECT_KINDS=['character','product','location'];
// Older saved descriptions have no classification. Infer only from their main
// subject, never from background prose; the Direction selector can correct it.
export function sourceSubjectKind(base){
 if(SHOOT_SUBJECT_KINDS.includes(base?.subject_kind))return base.subject_kind;
 const type=String(base?.subject?.type||'').toLowerCase();
 if(/\b(person|woman|man|girl|boy|people|character|model|animal|dog|cat)\b/.test(type))return 'character';
 if(/\b(product|bottle|perfume|packshot|car|vehicle|shoe|watch|bag|chair|object|packaging|furniture)\b/.test(type))return 'product';
 if(/\b(location|landscape|room|interior|building|architecture|forest|beach|mountain|cityscape|street|place)\b/.test(type))return 'location';
 return 'character';
}
export function shootSubjectKind(draft){return draft.enabled.includes('subject')&&SHOOT_SUBJECT_KINDS.includes(draft.subjectKind)?draft.subjectKind:sourceSubjectKind(draft.base);}
export function shootKindChanged(draft){return shootSubjectKind(draft)!==sourceSubjectKind(draft.base);}
export function changeShootSubjectKind(draft,kind){
 if(!SHOOT_SUBJECT_KINDS.includes(kind))throw Error('Choose Character, Product or Location.');
 if(kind===shootSubjectKind(draft))return;
 draft.subjectKind=kind;
 for(const path of Object.keys(draft.patches))if(['subject','action'].includes(sectionFor(path)))delete draft.patches[path];
 delete draft.references.subject;
 draft.enabled=draft.enabled.filter(s=>s!=='action');
 if(!draft.enabled.includes('subject'))draft.enabled.push('subject');
 if(kind==='location')resetSection(draft,'location');
 if(kind==='character'&&sourceSubjectKind(draft.base)!=='character')draft.keepOutfit=false;
}
export function shootSections(draft){
 const kind=shootSubjectKind(draft);
 return SHOOT_SECTIONS.filter(section=>!(section.id==='product'&&kind==='product')).map(section=>section.id==='subject'?{...section,name:humanize(kind),hint:kind==='character'?'Identity, outfit and expression':kind==='product'?'Packshot, object or vehicle':'Architecture, landscape or interior'}:section.id==='product'?{...section,name:'Additional product',hint:'Optional object alongside the main subject'}:section.id==='action'&&kind!=='character'?{...section,name:kind==='product'?'Placement & action':'Scene activity',hint:kind==='product'?'Orientation, scale, position and movement':'Stillness, movement and atmosphere'}:section.id==='location'&&kind==='location'?{...section,name:'Surroundings',hint:'Weather and surrounding context',reference:false}:section);
}
const subjectControls={character:['expression','hair'],product:['materials','finish','color','details'],location:['features','materials','scale']};
export function shootFieldPlaceholder(draft,path){
 if(path==='subject.hair')return 'Use reference hair, or describe a change…';
 if(subjectControls[shootSubjectKind(draft)].some(field=>path==='subject.'+field)&&path!=='subject.expression')return 'Use the reference, or describe a change…';
 return 'Describe what should replace this detail…';
}
export const SHOOT_MOODS=[
 {id:'cinematic',name:'Cinematic',colors:['#1d3438','#b59268'],light:'Low-key cinematic light, sculpted highlights and deep soft shadows',mood:['Cinematic','Dramatic'],texture:'Subtle fine film grain',palette:['Muted teal','Warm amber','Charcoal']},
 {id:'editorial',name:'Editorial',colors:['#b1a6a1','#514447'],light:'Directional editorial light with controlled contrast',mood:['Confident','Refined'],texture:'Natural detail and tactile surfaces',palette:['Warm neutrals','Muted earth tones']},
 {id:'daylight',name:'Soft daylight',colors:['#eee0c6','#aabac0'],light:'Soft window daylight with gentle falloff and open shadows',mood:['Airy','Intimate'],texture:'Natural, delicate texture',palette:['Warm white','Pale blue','Soft beige']},
 {id:'noir',name:'Noir',colors:['#151515','#b8b8b8'],light:'Hard side light with deep shadows and bright rim highlights',mood:['Mysterious','Tense'],texture:'Fine monochrome film grain',palette:['Black','Silver','White']},
 {id:'golden',name:'Golden hour',colors:['#b8693c','#e8c98b'],light:'Low golden sunlight, soft backlight and long warm shadows',mood:['Warm','Nostalgic'],texture:'Subtle analog grain and luminous highlights',palette:['Honey','Amber','Warm brown']},
 {id:'flash',name:'Direct flash',colors:['#d6d6c8','#535950'],light:'Direct on-camera flash with crisp cast shadows and rapid falloff',mood:['Spontaneous','Raw'],texture:'Crisp detail with visible analog grain',palette:['Neutral whites','Deep shadows','Natural colors']},
 {id:'pastel',name:'Pastel',colors:['#c6a9bc','#bed0c5'],light:'Broad diffused high-key light with low contrast',mood:['Gentle','Dreamlike'],texture:'Soft tactile detail',palette:['Dusty pink','Sage','Lavender','Cream']},
 {id:'studio',name:'Clean studio',colors:['#e4e3df','#8d918f'],light:'Large softbox key, subtle fill and clean separation from the background',mood:['Precise','Minimal'],texture:'Clean, detailed surfaces',palette:['White','Gray','Natural subject colors']},
 {id:'vintage',name:'Vintage film',colors:['#90775a','#c5b78e'],light:'Soft warm light with slightly faded highlights and lifted shadows',mood:['Nostalgic','Quiet'],texture:'Visible 35mm film grain with gentle halation',palette:['Faded ochre','Olive','Warm cream']},
 {id:'neon',name:'Night neon',colors:['#393452','#b76578'],light:'Colored practical neon with soft violet and rose edge lighting',mood:['Nocturnal','Electric'],texture:'Fine grain with luminous bloom',palette:['Midnight blue','Muted violet','Rose']}
];
export const humanize=s=>s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const unsafe=new Set(['__proto__','prototype','constructor']);
export function safeJSON(value,depth=0){
 if(depth>12)throw Error('Use JSON with at most 12 nested levels.');
 if(typeof value==='string'){if(value.length>30000)throw Error('One field is too long.');return;}
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){if(value.length>300)throw Error('Too many values in one list.');for(const item of value)safeJSON(item,depth+1);return;}
 if(!value||typeof value!=='object')throw Error('Use valid JSON values.');
 for(const [key,item]of Object.entries(value)){if(unsafe.has(key)||!key||key.includes('.')||key.length>120)throw Error('This JSON contains an unsupported field name.');safeJSON(item,depth+1);}
}
export function parseShootJSON(text){
 if(typeof text!=='string'||text.length>100000)throw Error('Use a JSON prompt up to 100,000 characters.');
 let value;try{value=JSON.parse(text);}catch{throw Error('Paste a valid JSON object.');}
 if(!value||Array.isArray(value)||typeof value!=='object'||!Object.keys(value).length)throw Error('Use a JSON object with named sections.');
 safeJSON(value);return value;
}
export function sectionFor(path){
 if(['activity','pose','orientation','placement','size'].some(key=>path==='subject.'+key||path.startsWith('subject.'+key+'.')))return 'action';
 return SHOOT_SECTIONS.find(s=>s.roots.some(root=>path===root||path.startsWith(root+'.')))?.id;
}
export function getPath(object,path){return path.split('.').reduce((value,key)=>value&&Object.hasOwn(value,key)?value[key]:undefined,object);}
export function setPath(object,path,value){
 const parts=path.split('.');if(parts.some(k=>unsafe.has(k)||!k))throw Error('Invalid field.');
 let parent=object;for(const key of parts.slice(0,-1)){if(!parent[key]||typeof parent[key]!=='object'||Array.isArray(parent[key]))parent[key]={};parent=parent[key];}
 parent[parts.at(-1)]=structuredClone(value);
}
export function flattenFields(object,prefix=''){
 return Object.entries(object||{}).flatMap(([key,value])=>{const path=prefix?prefix+'.'+key:key;return value&&typeof value==='object'&&!Array.isArray(value)?flattenFields(value,path):[{path,value}];});
}
export function newShoot(){return {version:1,subjectKind:'auto',base:null,patches:{},enabled:[],references:{},keepOutfit:true,useAssetOutfit:false,sourceJobId:null,pending:null,refinement:null,llmModel:LLM_MODELS[0].id,model:'nano-pro',resolution:'1K',quality:'high',ratios:['original'],count:2,output:'files',jobIds:[],batch:null};}
export function validateShoot(value){
 if(!value||value.version!==1)throw Error('Invalid SHOOT draft.');
 const draft=newShoot();
 if(value.subjectKind!==undefined&&!['auto',...SHOOT_SUBJECT_KINDS].includes(value.subjectKind))throw Error('Choose Character, Product or Location.');
 draft.subjectKind=value.subjectKind||'auto';
 if(value.base!==null&&value.base!==undefined)draft.base=parseShootJSON(JSON.stringify(value.base));
 if(!value.patches||typeof value.patches!=='object'||Array.isArray(value.patches))throw Error('Invalid section edits.');
 for(const [path,v]of Object.entries(value.patches)){if(!sectionFor(path)||path.length>300)throw Error('Unknown SHOOT field.');safeJSON(v);setPath({},path,v);draft.patches[path]=structuredClone(v);}
 if(Object.keys(draft.patches).length>200)throw Error('Too many section edits.');
 if(!Array.isArray(value.enabled)||value.enabled.some(s=>!SHOOT_SECTIONS.some(x=>x.id===s)))throw Error('Invalid section selection.');draft.enabled=[...new Set(value.enabled)];
 for(const [role,ref]of Object.entries(value.references||{})){
  if(!['source','subject','product','location','outfit'].includes(role)||!ref||typeof ref.assetId!=='string'||!/^[\w-]{1,100}$/.test(ref.assetId)||typeof ref.name!=='string'||ref.name.length>250||!['image/png','image/jpeg','image/webp'].includes(ref.contentType))throw Error('Choose an image from your library.');
  const width=ref.width,height=ref.height;if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>100000||height>100000)throw Error('Invalid reference dimensions.');
  draft.references[role]={assetId:ref.assetId,name:ref.name,contentType:ref.contentType,width,height};
 }
 draft.keepOutfit=value.keepOutfit!==false;draft.useAssetOutfit=value.useAssetOutfit===true;
 if(value.llmModel!==undefined&&!LLM_MODELS.some(m=>m.id===value.llmModel))throw Error('Choose a supported description model.');draft.llmModel=value.llmModel||LLM_MODELS[0].id;
 const id=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
 if(value.sourceJobId){if(!id(value.sourceJobId))throw Error('Invalid source output.');draft.sourceJobId=value.sourceJobId;}
 if(value.pending){if(!id(value.pending.id)||!['source','subject','product','location','refine'].includes(value.pending.role))throw Error('Invalid analysis.');draft.pending={id:value.pending.id,role:value.pending.role};}
 if(value.refinement){const r=value.refinement;if(!id(r.jobId)||typeof r.key!=='string'||r.key.length>250000||r.prompt!==null&&typeof r.prompt!=='string')throw Error('Invalid refined prompt.');if(r.prompt!==null)parseShootJSON(r.prompt);draft.refinement={jobId:r.jobId,key:r.key,prompt:r.prompt};}
 if(!SHOOT_MODELS.some(m=>m.id===value.model))throw Error('Choose a supported SHOOT model.');draft.model=value.model;
 const model=SHOOT_MODELS.find(m=>m.id===draft.model);
 if(!model.resolutions.includes(value.resolution))throw Error('Choose a resolution supported by the model.');draft.resolution=value.resolution;
 if(model.qualities&&!model.qualities.includes(value.quality))throw Error('Choose a supported image quality.');draft.quality=model.qualities?value.quality:'high';
 if(!Array.isArray(value.ratios)||!value.ratios.length||value.ratios.length>10||value.ratios.some(r=>r!=='original'&&(!model.ratios.includes(r)||r==='auto')))throw Error('Choose up to 10 supported aspect ratios.');draft.ratios=[...new Set(value.ratios)];
 if(![2,3,4].includes(value.count))throw Error('Choose 2, 3 or 4 variations per ratio.');draft.count=value.count;
 if(!['files','board'].includes(value.output))throw Error('Choose separate files or a board.');draft.output=value.output;
 if(!Array.isArray(value.jobIds)||value.jobIds.length>300||value.jobIds.some(v=>!id(v)))throw Error('Invalid shoot history.');draft.jobIds=[...new Set(value.jobIds)];
 if(value.batch){if(!id(value.batch.id)||!Array.isArray(value.batch.remaining)||value.batch.remaining.length>10||value.batch.remaining.some(r=>!model.ratios.includes(r))||!Array.isArray(value.batch.jobIds)||value.batch.jobIds.some(v=>!id(v)))throw Error('Invalid generation batch.');draft.batch={id:value.batch.id,remaining:value.batch.remaining,jobIds:value.batch.jobIds};}
 if(JSON.stringify({...draft,refinement:null}).length>230000||JSON.stringify(draft).length>650000)throw Error('This SHOOT draft is too large.');return draft;
}
export function compiledShoot(draft){
 if(!draft.base)throw Error('Describe an image or load a JSON prompt first.');
 const result=structuredClone(draft.base),kind=shootSubjectKind(draft);
 if(shootKindChanged(draft)){
  result.subject={type:''};result.action={description:''};
  result.composition={camera_angle:result.composition?.camera_angle||''};
  result.key_details=[];result.negative_elements=[];
  if(sourceSubjectKind(draft.base)==='product')delete result.product;
  if(kind==='location')result.environment={setting:'',background:''};
 }
 if(kind!=='character')for(const key of ['expression','hair','clothing','pose','activity'])delete result.subject?.[key];
 for(const [path,value]of Object.entries(draft.patches))if(activeShootField(draft,path))setPath(result,path,value);
 return result;
}
// Legacy subject/type/clothing patches are no longer editable. They must not
// override the reference image or the chosen outfit when an old draft reopens.
export function activeShootField(draft,path){
 const section=sectionFor(path),kind=shootSubjectKind(draft);
 if(!draft.enabled.includes(section)||section==='product'&&kind==='product')return false;
 if(section==='subject')return subjectControls[kind].some(key=>path==='subject.'+key)&&!(path!=='subject.expression'&&typeof draft.patches[path]==='string'&&!draft.patches[path].trim());
 if(section==='action'&&path.startsWith('subject.'))return (kind==='character'?['pose','activity']:kind==='product'?['orientation','placement','size']:[]).some(key=>path==='subject.'+key);
 return true;
}
export function sectionFields(draft,section){
 const kind=shootSubjectKind(draft),result=compiledShoot(draft);
 if(section==='subject')return subjectControls[kind].map(key=>({path:'subject.'+key,value:draft.references.subject&&draft.enabled.includes('subject')&&key!=='expression'?(draft.patches['subject.'+key]??''):(getPath(result,'subject.'+key)??'')}));
 const fields=flattenFields(result).filter(f=>sectionFor(f.path)===section);
 const defaults={product:{'product.description':'','product.placement':''},action:kind==='character'?{'action.description':'','subject.pose':''}:kind==='product'?{'action.description':'','subject.orientation':'','subject.placement':'','subject.size':''}:{'action.description':''},framing:{'composition.framing':'','composition.camera_angle':'','composition.subject_placement':'','composition.cropping':'','composition.visual_focus':''},location:{'environment.setting':'','environment.background':'','environment.weather':''},style:{'visual_style.genre':'','visual_style.mood':[],'visual_style.texture':'','visual_style.depth_of_field':''}};
 for(const [path,value]of Object.entries(defaults[section]||{}))if(!fields.some(f=>f.path===path))fields.push({path,value});
 return fields;
}
export function resetSection(draft,section){if(section==='subject'){if(shootKindChanged(draft))delete draft.references.subject;draft.subjectKind='auto';}draft.enabled=draft.enabled.filter(s=>s!==section);for(const path of Object.keys(draft.patches))if(sectionFor(path)===section)delete draft.patches[path];}
export function applySectionDescription(draft,section,description){
 safeJSON(description);
 if(section==='product'){draft.patches['product.description']=description.scene_description||JSON.stringify(description.subject||{});}
 else if(section!=='subject')for(const f of flattenFields(description))if(sectionFor(f.path)===section)draft.patches[f.path]=structuredClone(f.value);
 if(!draft.enabled.includes(section))draft.enabled.push(section);
}
export function applyMood(draft,id){
 const mood=SHOOT_MOODS.find(m=>m.id===id);if(!mood)throw Error('Choose a mood preset.');
 Object.assign(draft.patches,{'lighting.style':mood.light,'visual_style.mood':[...mood.mood],'visual_style.texture':mood.texture,'visual_style.color_palette':[...mood.palette]});
 if(!draft.enabled.includes('style'))draft.enabled.push('style');
}
// The source image is for LLM analysis only. Generation receives only explicit
// replacement references, in the same order used by the prompt's image numbers.
export function shootReferences(draft){return ['subject','outfit','product','location'].filter(role=>draft.references[role]&&(role==='outfit'?draft.useAssetOutfit&&shootSubjectKind(draft)==='character'&&draft.enabled.includes('subject'):draft.enabled.includes(role))&&!(role!=='subject'&&role===shootSubjectKind(draft))).map(role=>({role,...draft.references[role]}));}
export function shootPrompt(draft){
 const prompt=compiledShoot(draft),refs=shootReferences(draft),kind=shootSubjectKind(draft);
 prompt.subject_kind=kind;
 prompt.shoot_direction={
  main_subject_kind:kind,
  replace_main_subject:shootKindChanged(draft)?`Replace the original ${sourceSubjectKind(draft.base)} with a ${kind}. Remove the old main subject completely, not alongside the replacement. Adapt action, framing, scale, scene description, key details and exclusions to the new subject. Never transfer human expression, hair, clothing or anatomy to an object or place.`:'Keep the main subject category; apply enabled replacements and edits.',
  edited_sections:shootSections(draft).filter(s=>draft.enabled.includes(s.id)).map(s=>s.name),
  changed_fields:Object.keys(draft.patches).filter(path=>activeShootField(draft,path)),
  priority:'Apply edited fields and reference roles below. These override any conflicting original details, including the scene description, color palette, key details and negative elements. Preserve all nonconflicting details. Create a single photograph, not a collage.',
  scene_source:'Reconstruct the scene from this JSON description. The original image was used only to create the description and is not attached. Only the numbered replacement references below are attached.',
  references:refs.map((ref,i)=>({image:i+1,role:ref.role,instruction:ref.role==='outfit'?'Dress the character in the complete outfit from this image, including top, bottom, footwear and accessories. Preserve colors, materials, cut and details. Replace all original and character-reference clothing. Do not copy a person, mannequin, flat-lay arrangement or background from this outfit image.':ref.role==='subject'&&kind==='product'?`Use this product as the MAIN subject, replacing the original main subject entirely. Describe its recognizable shape, proportions, materials, finish, colors, and visible branding accurately. It may be a small packshot or a large vehicle; use realistic size and placement. Do not invent text or include the reference backdrop, people, hands or display props unless explicitly requested.`:ref.role==='subject'&&kind==='location'?`Use this location as the MAIN scene, replacing the original subject and setting. Describe visible architecture, landscape, spatial layout, materials and landmarks. Do not retain the original person or product, and do not invent one. Adapt framing and scene activity to this place; preserve the photographic style unless edited.`:ref.role==='subject'?`Use the subject from this character reference. Keep the written physical description brief: subject from reference image and broad visible skin tone. Let the reference image supply detailed appearance; do not list facial features or anatomy. ${refs.some(r=>r.role==='outfit')?'Use clothing only from the separate outfit reference; ignore clothing in this character image.':draft.keepOutfit&&!shootKindChanged(draft)?'Keep the original outfit as described in subject.clothing, including its clothing and accessories. Ignore the character reference outfit.':'Replace the outfit with the clothing and accessories from this character reference. Ignore the original subject type and clothing descriptions.'} ${shootKindChanged(draft)?'Create a natural pose, activity and expression suited to this scene; do not copy object orientation or inanimate properties into character fields.':'Keep the expression described in subject.expression and the described pose unless Action is edited.'} ${typeof draft.patches['subject.hair']==='string'&&draft.patches['subject.hair'].trim()?'Use the explicit subject.hair override.':'Use the hair from this character reference, overriding the original hair description.'} Do not copy the reference background, pose or lighting.`:ref.role==='product'?'Use this product, respecting its shape and details. Follow the edited placement.':'Replace only the environment with this location reference; preserve the subject and other unedited sections.'}))
 };
 return JSON.stringify(prompt,null,2);
}
export function shootDirectionKey(draft){return JSON.stringify({prompt:shootPrompt(draft),references:shootReferences(draft),model:draft.llmModel});}
export function shootRefinementReady(draft){return !!draft.refinement?.prompt&&draft.refinement.key===shootDirectionKey(draft);}
export function shootPlainText(draft,{original=false,prompt}={}){
 const output=[];const walk=(value,level=0)=>{for(const [key,item]of Object.entries(value)){const indent='  '.repeat(level);if(item&&typeof item==='object'&&!Array.isArray(item)){output.push(indent+humanize(key)+':');walk(item,level+1);}else output.push(indent+humanize(key)+': '+(Array.isArray(item)?item.map(v=>typeof v==='object'?JSON.stringify(v):v).join('; '):String(item??'')));}};
 walk(original?draft.base:JSON.parse(prompt??shootPrompt(draft)));return output.join('\n');
}
export function resolvedRatios(draft){
 const model=SHOOT_MODELS.find(m=>m.id===draft.model),source=draft.references.source;
 const ratio=source?source.width/source.height:1;
 // Use the source dimensions locally; "auto" would match a replacement image.
 const original=model.ratios.filter(r=>r!=='auto').reduce((best,r)=>{const n=r.split(':').map(Number);const b=best.split(':').map(Number);return Math.abs(Math.log(n[0]/n[1]/ratio))<Math.abs(Math.log(b[0]/b[1]/ratio))?r:best;},'1:1');
 return [...new Set(draft.ratios.map(r=>r==='original'?original:r))];
}
export function shootPlans(draft,references=[],prompt=shootPrompt(draft)){
 if(shootKindChanged(draft)&&!shootReferences(draft).some(r=>r.role==='subject'))throw Error(`Add a ${shootSubjectKind(draft)} reference for the new main subject.`);
 const ratios=resolvedRatios(draft);
 return ratios.map(ratio=>{const plan={model:draft.model,inputType:references.length?'image':'text',prompt,ratio,resolution:draft.resolution,count:draft.count,quality:draft.quality,destination:'studio'};validateRequest(plan,references);return plan;});
}
