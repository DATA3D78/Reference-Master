export const OUTFIT_SYSTEM_PROMPT = `Extract and recreate only the outfit, as a clean premium fashion flat lay on a neutral medium-grey background (#808080).
Do not include the person wearing the outfit. Do not show a face, body, skin, hair, hands, or the background, pose, or lighting from the original image. Include the complete top-and-bottom outfit: tops, shirts, sweaters, jackets and other upper-body garments, together with trousers, skirts, shorts or other lower-body garments shown or described. Preserve dresses and one-piece garments in full. Do not omit either the top or bottom garments.
Preserve the outfit, shoes, jewelry and worn accessories accurately: garment and shoe types; colors; materials and fabric texture; fit and silhouette; stitching, pockets, seams, folds, closures, laces, soles, logos, patterns and styling details.
Arrange every item centered on a uniform neutral medium-grey studio background (#808080), like a luxury fashion flat lay or e-commerce wardrobe layout. The background must remain medium grey, not white, even if the reference or outfit description mentions a white background. No mannequin or body parts. Include only garments, footwear and accessories worn as part of the outfit, such as jewelry, belts, hats and worn bags. Exclude handheld props and all non-outfit objects, including cups, drinks, phones, cigarettes, books, tools, furniture and background objects. Do not describe or list these objects in the outfit description. Ignore them even when visible in the reference or mentioned in older source text.`;
export function outfitPrompt(description){return OUTFIT_SYSTEM_PROMPT+'\n\nOutfit details:\n'+description.trim();}

export function isOutfitGeneration(job){return job?.settings?.workflow==='outfit'||String(job?.settings?.prompt||'').startsWith('Extract and recreate only the outfit, as a clean premium fashion flat lay on a ');}

export function outfitMannequinPrompt(description){return `Recreate the complete outfit accurately, worn on a dark-grey matte fashion display mannequin, centered full-length on a uniform medium-grey studio background (#808080).
Use a feminine or masculine mannequin form matching the visible styling and silhouette of the input image, or the explicitly described wearer in text-only input. If unclear or the outfit is shown alone, use a neutral mannequin form. This is an artificial display mannequin, not the original person: no human skin, hair, facial features or identity. Keep the mannequin dark grey, distinct from the background.
Include the complete top and bottom garments, or the full dress or one-piece, with shoes, jewelry and worn accessories. Preserve the reference garment types, colors, fabric texture, fit, silhouette, stitching, seams, pockets, closures, patterns, logos and styling details. Fit garments naturally onto the mannequin, preserving their design and showing how the complete outfit is worn. Do not copy the reference background, lighting or pose. Do not create a flat lay or collage. Show the entire outfit without cropping shoes or the top of the mannequin. Premium studio fashion product photography. Include only garments, footwear and accessories worn as part of the outfit, such as jewelry, belts, hats and worn bags. Exclude handheld props and all non-outfit objects, including cups, drinks, phones, cigarettes, books, tools, furniture and background objects. Do not describe or list these objects in the outfit description. Ignore them even when visible in the reference or mentioned in older source text.

Outfit details:
`+description.trim();}
export function outfitVariants(description,audience,changes=''){const edits=changes.trim()?`\n\nRequested outfit changes (apply to this version):\n${changes.trim()}\nThese changes override conflicting garment details in the source image and outfit description, including instructions to preserve every item. Omit removed items completely; show replacements instead of the original items. Keep all other outfit details unchanged. Keep the required presentation and medium-grey background.`:'';return [{name:'flat lay',prompt:outfitPrompt(description)+edits},{name:'mannequin',prompt:outfitMannequinPrompt(description)+(audience==='women'?'\nUse a female-form dark-grey mannequin matching the source wearer.':audience==='men'?'\nUse a male-form dark-grey mannequin matching the source wearer.':'')+edits}];}

export function outfitAudience(job){
 const explicit=job?.settings?.outfitAudience;
 if(['women','men','neutral'].includes(explicit))return explicit;
 const prompt=String(job?.settings?.prompt||'');
 const description=prompt.includes('Outfit details:')?prompt.split('Outfit details:').pop():'';
 const category=description.match(/Outfit category:\s*(Women|Men|General\s*\/\s*unisex)/i)?.[1]?.toLowerCase();
 if(category)return category==='women'?'women':category==='men'?'men':'neutral';
 const women=/\b(women|woman|womenswear|female|feminine)\b/i.test(description),men=/\b(men|man|menswear|male|masculine)\b/i.test(description);
 return women&&!men?'women':men&&!women?'men':'neutral';
}

export function parseOutfitAnalysis(text){
 let result;try{result=JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('Outfit analysis did not return a valid wearer category. Please try Describe outfit again.');}
 if(!['women','men','neutral'].includes(result.audience)||typeof result.description!=='string'||!result.description.trim())throw Error('Outfit analysis is incomplete. Please try Describe outfit again.');
 return {audience:result.audience,description:result.description.trim()};
}
