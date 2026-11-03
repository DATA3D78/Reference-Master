export const COMFY_ORIGIN='https://api.comfy.org';
export const MAX_ROUTER_BYTES=100*1024*1024;
const fail=(message,status=502,extra={})=>Object.assign(Error(message),{status,...extra});
export function modelURL(model){if(typeof model!=='string'||!/^[a-zA-Z0-9][-a-zA-Z0-9_.]*\/[a-zA-Z0-9][-a-zA-Z0-9_.]*$/.test(model))throw fail('Invalid Comfy model.',400);return COMFY_ORIGIN+'/v2/models/'+model;}
export function queueURLs(model,id){if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,160}$/.test(id))throw fail('Comfy returned an invalid request ID. Check Comfy usage before retrying.');const resultURL=modelURL(model)+'/requests/'+id;return {resultURL,statusURL:resultURL+'/status'};}
export function validRouterURL(value){try{const u=new URL(value);return u.origin===COMFY_ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/v2\/models\/[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+(?:\/estimate|\/requests(?:\/[-a-zA-Z0-9_]+(?:\/status)?)?)?$/.test(u.pathname);}catch{return false;}}
export function serializeInput(input){const body=JSON.stringify(input);if(Buffer.byteLength(body)>MAX_ROUTER_BYTES)throw fail('Comfy accepts at most 100 MB per request, including base64 encoding. Use fewer or smaller reference files (under 74 MB combined).',413);return body;}
export function retryDelay(value,now=Date.now()){const seconds=Number(value);if(value!==null&&value!==''&&Number.isFinite(seconds)&&seconds>=0)return Math.max(1000,seconds*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(1000,date-now):4000;}
export function normalizeEstimate(quote,count=1){
 const base={available:false,statusLabel:'—',label:'Estimated total',currency:'USD',source:quote?.source||'unknown',checkedAt:quote?.pricing_as_of,reason:quote?.reason||'not_quotable'};
 const number=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;
 if(quote?.currency!=='USD'||!Number.isInteger(count)||count<1||count>4)return base;
 const min=number(quote.source==='exact'?quote.amount:quote.min_amount),max=number(quote.source==='exact'?quote.amount:quote.max_amount);
 if(!['exact','estimated'].includes(quote.source)||!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min)return base;
 return {...base,available:true,minimum:min*count,maximum:max*count,approximate:quote.source!=='exact'};
}
export function billingEstimate(quote){const value=normalizeEstimate(quote);return value.available?{amount:value.minimum,maximum:value.maximum,extraUsage:value.approximate,checkedAt:value.checkedAt}:null;}
export function createComfyRouter(fetchImpl=fetch){
 return {async request(url,{credential,method='GET',input,idempotencyKey}={}){
  if(!validRouterURL(url))throw fail('Refusing an invalid Comfy Router URL.');
  if(!credential)throw fail('Connect your Comfy API key in Settings first.',401);
  const body=input===undefined?undefined:serializeInput(input);
  let response;try{response=await fetchImpl(url,{method,body,redirect:'error',signal:AbortSignal.timeout(90000),headers:{'X-API-Key':credential,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})}});}catch{throw fail('Cannot reach Comfy Router. Check your connection and Comfy usage before retrying a generation.',503);}
  const retryAfter=retryDelay(response.headers.get('Retry-After'));
  let data;try{data=await response.json();}catch{throw fail('Comfy returned an unreadable response. Check Comfy usage before retrying.',502,{retryAfter});}
  if(!response.ok){
   const detail=Array.isArray(data.detail)?data.detail.map(d=>d.msg||d.type).join('; '):typeof data.detail==='string'?data.detail:typeof data.message==='string'?data.message:typeof data.error==='string'?data.error:data.error?.message;
   const errorType=data.error_type||response.headers.get('X-Comfy-Error-Type');
   const message=errorType==='not_enabled'?'Live price estimates are not enabled for this Comfy key.':response.status===401||response.status===403?'Comfy rejected this key or model access. Check your Comfy platform key.':response.status===402?'Your Comfy account needs credits.':response.status===429?'Comfy is limiting requests. Waiting before the next check.':detail||`Comfy returned HTTP ${response.status}.`;
   throw fail(message,response.status,{retryAfter,errorType});
  }
  const credits=response.headers.get('X-Comfy-Credits-Used');
  // Comfy publishes $1 = 211 credits in RouterCostEstimate. Provider payload costs are never used.
  const actualCost=credits!==null&&/^\d+(?:\.\d+)?$/.test(credits)?Number(credits)/211:undefined;
  return {data,status:response.status,retryAfter,actualCost};
 }};
}
const typeFrom=(url,fallback)=>{try{return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',mov:'video/quicktime',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg'})[new URL(url).pathname.split('.').pop().toLowerCase()]||fallback;}catch{return fallback;}};
export function normalizeOutputs(model,result,settings={}){
 const output=[];
 const add=(url,data,contentType,extra={})=>{if(typeof data==='string'&&data)output.push({data,contentType,...extra});else if(typeof url==='string'&&url)output.push({url,contentType:typeFrom(url,contentType),...extra});};
 if(model.startsWith('vertexai/')){for(const candidate of result.candidates||[])for(const part of candidate.content?.parts||[])if(!part.thought){if(part.inlineData?.mimeType?.startsWith('image/'))add(null,part.inlineData.data,part.inlineData.mimeType);else if(part.fileData?.mimeType?.startsWith('image/'))add(part.fileData.fileUri,null,part.fileData.mimeType);}
 }else if(model.startsWith('openai/')||model.includes('/seedream-'))for(const item of result.data||[])add(item.url,item.b64_json,'image/'+(result.output_format||'png'),{width:item.width,height:item.height});
 else if(model.startsWith('krea/'))for(const url of result.result?.urls||[])add(url,null,'image/png');
 else if(model.startsWith('bfl/'))add(result.result?.sample,null,model==='bfl/flux-3-image'?'image/jpeg':'video/mp4');
 else if(model==='wan/wan3.0-video')add(result.output?.video_url,null,'video/mp4');
 else if(model.includes('/dreamina-seedance-'))add(result.content?.video_url,null,result.output_format==='mov'?'video/quicktime':'video/mp4',{duration:result.duration});
 else if(model==='minimax/minimax-h3')add(result.task?.content?.url,null,'video/mp4',{duration:result.task?.duration});
 else if(model.startsWith('byteplus/seed-audio-'))add(result.url,result.audio,({mp3:'audio/mpeg',wav:'audio/wav',ogg_opus:'audio/ogg'})[settings.options?.output_format]||'audio/mpeg',{duration:result.duration});
 if(!output.length)throw fail('Comfy returned no downloadable media. Check this request in your Comfy platform activity.',422);
 return output;
}
