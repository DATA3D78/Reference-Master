import {referenceBillingEstimate,seedAudioReference} from './public/reference-pricing.js';
import {readFile,writeFile,rename,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {estimateCost} from './public/models.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const rounded=value=>Math.round(value*1e9)/1e9;
export const keyFingerprint=key=>key?createHash('sha256').update(key).digest('hex'):undefined;
export function spendingPeriod(period,now=new Date()){
  if(!['day','week','month','year'].includes(period))throw fail('Choose daily, weekly, monthly or yearly spending.');
  const start=new Date(now);start.setHours(0,0,0,0);
  if(period==='week')start.setDate(start.getDate()-(start.getDay()+6)%7);
  if(period==='month')start.setDate(1);
  if(period==='year')start.setMonth(0,1);
  return {period,start:start.toISOString(),end:now.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
}
export function falCostEstimate(settings,references=[],now=new Date()){
  try{const value=estimateCost({...settings,count:1},references,now);return value.available?{amount:value.minimum,maximum:value.maximum,extraUsage:!!value.extraUsage,checkedAt:value.checkedAt,stale:!!value.stale}:null;}catch{return null;}
}
export function summarizeSpending(entries,period,now=new Date()){
  const range=spendingPeriod(period,now),start=Date.parse(range.start),end=now.getTime(),seen=new Set();
  const bucket=()=>({confirmed:0,estimated:0,confirmedCount:0,estimatedCount:0,unpriced:0,pending:0,extraUsage:0,referenceCount:0});
  const providers={comfy:bucket(),fal:bucket(),openrouter:bucket()};let first=null;
  const unique=new Map();
  for(const entry of entries){const id=entry.requestId?entry.provider+':'+entry.requestId:entry.id,previous=unique.get(id);if(!previous||!amount(previous.actual)&&(amount(entry.actual)||previous.status!=='COMPLETED'&&entry.status==='COMPLETED'))unique.set(id,entry);}
  for(const e of unique.values()){
    const at=Date.parse(e.createdAt);if(!Number.isFinite(at)||!providers[e.provider])continue;
    if(first===null||at<first)first=at;
    if(at<start||at>end)continue;
    const id=e.requestId?e.provider+':'+e.requestId:e.id;if(seen.has(id))continue;seen.add(id);
    const p=providers[e.provider];
    if(amount(e.actual)){p.confirmed+=e.actual;p.confirmedCount++;}
    else if(['SUBMITTING','IN_QUEUE','IN_PROGRESS','RUNNING'].includes(e.status))p.pending++;
    else if(e.status==='COMPLETED'&&amount(e.estimate?.amount)){p.estimated+=e.estimate.amount;p.estimatedCount++;if(e.estimate.source==='reference')p.referenceCount++;if(e.estimate.extraUsage||e.estimate.maximum>e.estimate.amount)p.extraUsage++;}
    else if(e.status==='COMPLETED'||e.status==='UNKNOWN'||e.requestId||e.accepted)p.unpriced++;
  }
  for(const p of Object.values(providers)){p.confirmed=rounded(p.confirmed);p.estimated=rounded(p.estimated);p.total=rounded(p.confirmed+p.estimated);}
  const total=Object.values(providers).reduce((all,p)=>{for(const k of Object.keys(bucket()))all[k]+=p[k];return all;},bucket());
  total.confirmed=rounded(total.confirmed);total.estimated=rounded(total.estimated);total.total=rounded(total.confirmed+total.estimated);
  return {...range,currency:'USD',scope:'studio',providers,...total,firstRecordedAt:first===null?null:new Date(first).toISOString()};
}
export function summarizeSpendingYear(entries,year,now=new Date()){
 if(!Number.isInteger(year)||year<2000||year>now.getFullYear())throw fail('Choose a year from 2000 through the current year.');
 entries=entries.filter(e=>Date.parse(e.createdAt)<=now.getTime());
 const months=Array.from({length:12},(_,month)=>{const end=new Date(year,month+1,1);end.setMilliseconds(-1);const data=summarizeSpending(entries,'month',end);return {...data,month:month+1,future:new Date(year,month,1)>now};});
 return {year,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,months,total:rounded(months.reduce((sum,m)=>sum+m.total,0))};
}
export async function createSpendingStore({directory,fetchImpl=fetch,now=()=>new Date()}){
  const file=join(directory,'spending.json');let state={version:1,trackingStartedAt:now().toISOString(),enhancements:[],receipts:{}},saving=Promise.resolve(),syncing=null,lastSync=null,notice='',storageError=false,needsSave=false;const lookupAttempts=new Map(),syncAttempts=new Map();
  try{state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!Array.isArray(state.enhancements)||!state.receipts||typeof state.receipts!=='object'||Array.isArray(state.receipts)||!Number.isFinite(Date.parse(state.trackingStartedAt))||state.enhancements.some(e=>!e||typeof e.id!=='string')||Object.values(state.receipts).some(e=>!e||!amount(e.amount)))throw Error();}catch(e){if(e.code!=='ENOENT')throw Error('Cannot read saved spending. Preserve .local/spending.json before repairing it.');needsSave=true;}
  async function persist(){const snapshot=JSON.stringify(state),temp=file+'.tmp-'+randomUUID();const task=saving.catch(()=>{}).then(async()=>{try{await writeFile(temp,snapshot,{flag:'wx',mode:0o600});const handle=await open(temp,'r');try{await handle.sync();}finally{await handle.close();}await rename(temp,file);storageError=false;}catch(e){storageError=true;await rm(temp,{force:true}).catch(()=>{});throw e;}});saving=task;return task;}
  async function trackEnhancement(entry){const safe={id:String(entry.id),provider:entry.provider==='comfy'?'comfy':'openrouter',kind:'enhancement',projectId:entry.projectId,createdAt:entry.createdAt,status:entry.status,model:entry.model,keyHash:entry.keyHash,accepted:!!entry.accepted,...(typeof entry.requestId==='string'?{requestId:entry.requestId}:{}),...(amount(entry.actual)?{actual:entry.actual}:{})};const index=state.enhancements.findIndex(e=>e.id===safe.id);if(index<0)state.enhancements.push(safe);else state.enhancements[index]={...state.enhancements[index],...safe};try{await persist();}catch(error){if(index<0&&safe.status==='RUNNING')state.enhancements=state.enhancements.filter(e=>e.id!==safe.id);throw error;}}
  // An interrupted enhancer is never automatically resubmitted.
  for(const e of state.enhancements)if(e.status==='RUNNING'){e.status='UNKNOWN';needsSave=true;}
  if(needsSave)await persist();
  function fallbackEstimate(job,task){
    if(job.provider!=='comfy'||task.status!=='COMPLETED')return null;
    if(job.mode==='audio'){
      if(job.settings?.model!=='seed-audio')return null;
      const value=seedAudioReference(task.outputs?.[0]?.duration);
      return value.available?{amount:value.minimum,source:'reference',referenceProvider:value.referenceProvider,checkedAt:value.checkedAt}:null;
    }
    if(!['image','video'].includes(job.mode)||!job.settings)return null;
    // Old jobs did not retain reference metadata. Flat rates can still be
    // reconstructed, but never guess a reference surcharge or source duration.
    if(job.settings.model==='seedream5-pro'&&job.settings.inputType==='image'&&!Array.isArray(job.pricingReferences))return null;
    try{return referenceBillingEstimate(job.settings,job.pricingReferences||[],now(),{preview:true});}catch{return null;}
  }
  function entries(falJobs,llmEntries){
    const records=[...falJobs.flatMap(job=>job.tasks.map((task,index)=>({id:(job.provider||'fal')+':'+job.id+':'+index,provider:job.provider||'fal',actual:task.actualCost,projectId:job.projectId,createdAt:task.createdAt||job.createdAt,status:task.status,requestId:task.requestId,keyHash:job.billingKeyHash,estimate:task.costEstimate??job.costEstimate??fallbackEstimate(job,task)}))),...llmEntries,...state.enhancements];
    return records.map(e=>{const receipt=e.requestId&&state.receipts[e.provider+':'+e.requestId];return receipt&&amount(receipt.amount)?{...e,actual:receipt.amount}:e;});
  }
  function summary(falJobs,llmEntries,period){return {...summarizeSpending(entries(falJobs,llmEntries),period,now()),trackingStartedAt:state.trackingStartedAt,lastSync,notice,storageError};}
  async function get(url,key,provider){
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:(provider==='fal'?'Key ':'Bearer ')+key}});
    if(!response.ok)throw fail(response.status===401||response.status===403?(provider==='fal'?'fal billing access is unavailable with this key. Image/video amounts remain estimates.':'OpenRouter could not confirm older charges with the current key.'):'The provider billing service is unavailable. Saved amounts are unchanged.',response.status);
    return response.json();
  }
  async function sync(falJobs,llmEntries,period,keys){
    spendingPeriod(period,now());if(syncing){await syncing;return sync(falJobs,llmEntries,period,keys);}
    const hash=keyFingerprint((keys.fal||'')+'\0'+(keys.openrouter||'')+'\0'+period);
    if(syncAttempts.has(hash)&&now().getTime()-syncAttempts.get(hash)<60000)return {notice:notice||'Billing was checked recently. Another check will be available shortly.'};
    syncAttempts.set(hash,now().getTime());
    syncing=(async()=>{
      const range=spendingPeriod(period,now()),all=entries(falJobs,llmEntries),candidates=all.filter(e=>!amount(e.actual)&&e.requestId&&!['SUBMITTING','IN_QUEUE','IN_PROGRESS','RUNNING'].includes(e.status)&&Date.parse(e.createdAt)>=Date.parse(range.start)&&Date.parse(e.createdAt)<=Date.parse(range.end));
      const notes=[];let updated=0,attempted=0;const seen=new Set();
      const eligible=(provider,key)=>candidates.filter(e=>e.provider===provider&&(!e.keyHash||e.keyHash===keyFingerprint(key))).filter(e=>{const id=provider+':'+e.requestId;if(seen.has(id))return false;seen.add(id);return true;}).sort((a,b)=>(lookupAttempts.get(provider+':'+a.requestId)||0)-(lookupAttempts.get(provider+':'+b.requestId)||0));
      if(keys.fal){
        const pending=eligible('fal',keys.fal),batch=pending.slice(0,50),groups=new Map();if(pending.length>50)notes.push('More fal requests await the next billing check.');
        for(const entry of batch){lookupAttempts.set('fal:'+entry.requestId,now().getTime());const date=new Date(entry.createdAt),month=date.getUTCFullYear()+'-'+date.getUTCMonth();if(!groups.has(month))groups.set(month,[]);groups.get(month).push(entry);}
        try{for(const group of groups.values()){
          const date=new Date(group[0].createdAt),start=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)-86400000),end=new Date(Math.min(now().getTime()+1000,Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,8)));
          const base=new URL('https://api.fal.ai/v1/models/billing-events');base.searchParams.set('start',start.toISOString());base.searchParams.set('end',end.toISOString());base.searchParams.set('limit','1000');for(const e of group)base.searchParams.append('request_id',e.requestId);
          const ids=new Set(group.map(e=>e.requestId)),totals=new Map(),cursors=new Set();let complete=false;
          for(let page=0;page<20;page++){
            attempted++;const result=await get(base.href,keys.fal,'fal');if(!Array.isArray(result.billing_events))throw Error('Invalid billing response');
            for(const event of result.billing_events){if(!ids.has(event.request_id))continue;const cost=amount(event.cost_total)?event.cost_total:null;if(!amount(cost))throw Error('Invalid billed amount');totals.set(event.request_id,(totals.get(event.request_id)||0)+cost);}
            if(result.has_more===false){complete=true;break;}if(typeof result.next_cursor!=='string'||!result.next_cursor||cursors.has(result.next_cursor))throw Error('Invalid billing pagination');cursors.add(result.next_cursor);base.searchParams.set('cursor',result.next_cursor);
          }
          if(!complete)throw Error('Incomplete billing response');
          for(const [id,cost] of totals){state.receipts['fal:'+id]={amount:rounded(cost),checkedAt:now().toISOString()};updated++;}
        }}catch(e){notes.push(e.status?e.message:'fal billing could not be fully checked. Unconfirmed amounts remain estimates.');}
      }
      if(keys.openrouter){const pending=eligible('openrouter',keys.openrouter);if(pending.length>10)notes.push('More OpenRouter requests await the next billing check.');
        for(const entry of pending.slice(0,10)){lookupAttempts.set('openrouter:'+entry.requestId,now().getTime());try{const url=new URL('https://openrouter.ai/api/v1/generation');url.searchParams.set('id',entry.requestId);attempted++;const {data}=await get(url.href,keys.openrouter,'openrouter');if(data?.id!==entry.requestId||!amount(data.total_cost))throw Error('Invalid billing response');state.receipts['openrouter:'+entry.requestId]={amount:data.total_cost,checkedAt:now().toISOString()};updated++;}catch(e){notes.push(e.status?e.message:'Some OpenRouter charges are not yet available.');if(e.status!==404)break;}}
      }
      if(candidates.some(e=>e.provider==='comfy'))notes.push('Some Comfy requests have no final billing header. Check Comfy platform usage to reconcile them.');
      if(updated)await persist();if(attempted)lastSync=now().toISOString();notice=[...new Set(notes)].join(' ');return {updated,notice};
    })().catch(e=>{notice=storageError?'Spending could not be saved. Check available disk space.':'Billing could not be checked. Saved amounts are unchanged.';return {updated:0,notice};}).finally(()=>{syncing=null;});return syncing;
  }
  return {summary,sync,trackEnhancement,yearSummary:(falJobs,llmEntries,year)=>summarizeSpendingYear(entries(falJobs,llmEntries),year,now())};
}
