import {retryDelay} from './comfy-router.mjs';
import {AUDIO_MODELS,audioContentType} from './public/audio-models.js';
import {MODELS} from './public/models.js';
import {TOOLS} from './public/tools-models.js';

const ORIGIN='https://queue.fal.run';
const ENDPOINTS=new Set([...MODELS.filter(m=>m.available).flatMap(m=>Object.values(m.endpoints)),...AUDIO_MODELS.map(m=>m.endpoint),...TOOLS.map(t=>t.endpoint)]);
const ROOTS=new Set([...ENDPOINTS].map(endpoint=>endpoint.split('/').slice(0,2).join('/')));
const fail=(message,status=502,extra={})=>Object.assign(Error(message),{status,...extra});
export function falModelURL(endpoint){
  if(!ENDPOINTS.has(endpoint))throw fail('Unsupported fal.ai model.',400);
  return ORIGIN+'/'+endpoint;
}
export function falQueueURLs(endpoint,id){
  falModelURL(endpoint);
  if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,160}$/.test(id))throw fail('fal.ai returned an invalid request ID. Check fal activity before retrying.');
  // fal polls at owner/app, including models submitted to a deeper subpath.
  const resultURL=ORIGIN+'/'+endpoint.split('/').slice(0,2).join('/')+'/requests/'+id;
  return {resultURL,statusURL:resultURL+'/status'};
}
export function validFalURL(value){
  try{
    const url=new URL(value),path=url.pathname.slice(1);
    if(url.origin!==ORIGIN||url.username||url.password||url.search||url.hash)return false;
    if(ENDPOINTS.has(path))return true;
    const match=path.match(/^([^/]+\/[^/]+)\/requests\/[-a-zA-Z0-9_]{1,160}(?:\/status)?$/);
    return !!match&&ROOTS.has(match[1]);
  }catch{return false;}
}
export function createFalRouter(fetchImpl=fetch){
  return {async request(url,{credential,method='GET',input}={}){
    if(!validFalURL(url))throw fail('Refusing an invalid fal.ai queue URL.');
    if(!credential)throw fail('Add your fal.ai key in Settings → API keys & prompts.',401);
    const body=input===undefined?undefined:JSON.stringify(input);
    if(body&&Buffer.byteLength(body)>280*1024**2)throw fail('This fal.ai request is too large. Use a source video up to 200 MB.',413);
    let response;
    try{response=await fetchImpl(url,{method,body,redirect:'error',signal:AbortSignal.timeout(90000),headers:{Authorization:'Key '+credential,'Content-Type':'application/json'}});}
    catch{throw fail('Cannot reach fal.ai. Check fal activity before retrying; the request may have been processed.',503);}
    const retryAfter=retryDelay(response.headers.get('Retry-After'));
    let data;try{data=await response.json();}catch{throw fail('fal.ai returned an unreadable response. Check fal activity before retrying.',502,{retryAfter});}
    if(!data||typeof data!=='object')throw fail('fal.ai returned an invalid response.',502,{retryAfter});
    if(!response.ok){
      const detail=Array.isArray(data.detail)?data.detail.map(d=>d.msg||d.type).join('; '):typeof data.detail==='string'?data.detail:typeof data.error==='string'?data.error:data.error?.message;
      const message=[401,403].includes(response.status)?'fal.ai rejected this key or model access. Check FAL_API_KEY_HERE.txt in Settings.':response.status===402?'Your fal.ai account needs credits.':response.status===429?'fal.ai is limiting requests. Wait before trying again.':detail||`fal.ai returned HTTP ${response.status}.`;
      throw fail(message,response.status,{retryAfter});
    }
    return {data,status:response.status,retryAfter};
  }};
}
export function normalizeFalOutputs(endpoint,result,settings={}){
  falModelURL(endpoint);
  const kind=AUDIO_MODELS.some(m=>m.endpoint===endpoint)?'audio':TOOLS.find(t=>t.endpoint===endpoint)?.kind||MODELS.find(m=>Object.values(m.endpoints).includes(endpoint))?.mode;
  const media=kind==='audio'?[result.audio]:kind==='video'?[result.video]:Array.isArray(result.images)?result.images:[result.image];
  if(!media.length||media.some(m=>!m||typeof m.url!=='string'||!m.url))throw fail('fal.ai returned no downloadable media. Check fal activity for this request.',422);
  return media.map(m=>{
    let url;try{url=new URL(m.url);}catch{throw fail('fal.ai returned an invalid media link.',422);}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('fal.ai returned an invalid media link.',422);
    const imageType=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'})[url.pathname.split('.').pop().toLowerCase()];
    const contentType=kind==='audio'?audioContentType(m,settings):kind==='video'?'video/mp4':/^image\/(png|jpeg|webp)$/.test(m.content_type)?m.content_type:imageType||'image/png';
    return {url:m.url,contentType,width:m.width,height:m.height,duration:m.duration??result.duration,...(kind==='audio'?{sampleRate:m.sample_rate,channels:m.channels}:{})};
  });
}
