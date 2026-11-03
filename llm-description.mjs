const text=description=>({type:'string',description});
const list=description=>({type:'array',items:{type:'string'},description});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});

// One outline drives both the strict JSON response and its plain-text equivalent.
export const descriptionSchema=object({
  scene_description:text('A detailed, cohesive overview of the visible scene, subject, action and atmosphere.'),
  subject:object({
    type:text('The main person, animal, object or other subject; mention multiple subjects where present.'),
    activity:text('What the subject is visibly doing, or its static state.'),
    pose:text('Posture, orientation, gesture and relationships between visible body parts or objects.'),
    expression:text('Visible expression and cautiously described body language; state when obscured or not applicable.'),
    hair:text('Visible hair color, length, shape, texture and arrangement, or not applicable.'),
    clothing:object({
      top:text('Visible upper-body clothing: cut, material, color, fit, folds and condition, or not applicable.'),
      gloves:text('Visible gloves and their material, color and details; state not present when absent.')
    })
  }),
  action:object({
    description:text('Visible action or stillness, gestures and movement cues. For video, describe the sequence with sampled timestamps and any visible camera movement.'),
    motion_blur:object({
      intensity:text('Observed strength of motion blur, including none when absent.'),
      direction:text('Visible direction and affected areas; do not invent movement from a still image.'),
      effect:text('How the observed blur or its absence affects the visual impression.')
    })
  }),
  environment:object({
    setting:text('The visible location, surfaces, spatial context and environmental features.'),
    weather:text('Weather only when supported by visible evidence; otherwise not visible or not applicable.'),
    rain_appearance:text('Rain streaks, droplets and wet surfaces only if visible; state no visible rain otherwise.'),
    background:text('Background objects, depth, shapes, detail, colors and focus.')
  }),
  lighting:object({
    style:text('Observed lighting quality, contrast and overall character.'),
    key_light:text('Apparent main light direction, softness, intensity and visible effects; qualify uncertain sources.'),
    accent_light:text('Visible secondary, rim, reflected or highlight lighting, or none visible.'),
    shadows:text('Shadow placement, depth, softness and shape.'),
    color_temperature:text('Observed warm/cool relationships and color casts, without invented technical measurements.')
  }),
  composition:object({
    framing:text('Shot scale and amount of the scene included.'),
    camera_angle:text('Apparent viewpoint, height, angle and perspective; avoid unsupported lens or camera specifications.'),
    subject_placement:text('Position, scale, balance, negative space and spatial relationships.'),
    cropping:text('What intersects the frame edges and what is excluded by the crop.'),
    visual_focus:text('Focal points and how contrast, color, depth or leading lines direct attention.')
  }),
  visual_style:object({
    genre:text('Observable photographic, illustration, design or other visual genre.'),
    mood:list('Nuanced atmosphere and emotional qualities supported by the image.'),
    texture:text('Material surfaces, grain, finish and other visible texture.'),
    sharpness:text('Focus, depth of field, detail and soft or sharp areas.'),
    color_palette:list('Specific dominant, secondary and accent colors, including tonal relationships.')
  }),
  key_details:list('Distinctive concrete details, including other clothing, accessories, objects, materials, positions and interactions not covered above.'),
  negative_elements:list('Relevant visible absences or explicit user exclusions. Do not invent arbitrary constraints or claim certainty about anything outside the frame.')
});

const label=key=>key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
function outline(schema,depth=0){
  return Object.entries(schema.properties).map(([key,field])=>`${'  '.repeat(depth)}${label(key)}${field.type==='object'?':\n'+outline(field,depth+1):': '+field.description}`).join('\n');
}

export function descriptionInstructions(format){
  return `Create a richly detailed visual prompt that another image or video model can use to reconstruct the reference. Develop each relevant field with specific, connected observations, rather than generic adjectives or a brief caption. Cover materials, fine textures, colors, placement, framing, light and shadow, atmosphere and observable action. Avoid repetition and fit a complete answer within the response length limit.
Use the following complete structure and field meanings in order:
${outline(descriptionSchema)}
Adapt every value to the actual reference. The structure does not imply that a person, gloves, rain or motion is present. Keep the fields and use "Not applicable", "Not visible", or a precise absence statement when appropriate. Never add details merely to fill a field. Use an empty list when there are no supported entries. Do not guess a person's identity, exact age, hidden features, camera model, lens specifications or lighting equipment. Qualify uncertain interpretations.
If several images differ, distinguish them with reference numbers within the relevant sections; do not silently combine separate scenes. When refining, apply the user's creative changes and preserve other source details, converting older source formats into this structure. Explicit creative changes may depart from the reference; descriptions without such instructions must remain faithful to it.
${format==='json'?'Return only one JSON object matching the supplied strict schema, including every nested field. Do not add a title, generation_prompt, extra keys, Markdown fences or commentary.':'Return only the final plain-text prompt. Use the section names above as plain headings, with labeled subtopics and detailed prose; use lists for mood, color palette, key details and negative elements. Keep the same coverage and depth as the JSON version. Do not use JSON syntax, Markdown fences or introductory commentary.'}`;
}

export function validDescription(value,schema=descriptionSchema){
  if(schema.type==='string')return typeof value==='string'&&value.trim().length>0;
  if(schema.type==='array')return Array.isArray(value)&&value.every(item=>validDescription(item,schema.items));
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(schema.properties);
  return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)&&validDescription(value[key],schema.properties[key]));
}
