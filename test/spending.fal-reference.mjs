import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSpendingStore,summarizeSpending,spendingPeriod,falCostEstimate,keyFingerprint} from '../spending-store.mjs';
import {createStudio} from '../server.mjs';
import {createPromptEnhancer,PRESET_FILES} from '../prompt-enhancer.mjs';
import {createLlmStore} from '../llm-store.mjs';
import {LLM_MODELS} from '../public/llm-models.js';
const now=new Date(2026,9,8,15,0,0),createdAt=now.toISOString();
const settings={model:'nano-pro',inputType:'text',prompt:'A red sculpture',ratio:'1:1',resolution:'1K',count:2,duration:'5'};
const reply=value=>Response.json(value);
const entry=(id,extra={})=>({id,provider:'fal',createdAt,status:'COMPLETED',estimate:{amount:.15},...extra});
const job=(extra={})=>({id:'job',projectId:'default',createdAt,settings,tasks:[{status:'COMPLETED',requestId:'fal-1',outputs:[]}],...extra});
async function directory(t){const path=await mkdtemp(join(tmpdir(),'fwrd-spend-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}

test('calendar ranges use local midnight, Monday weeks, month and year boundaries',()=>{
  assert.equal(spendingPeriod('day',now).start,new Date(2026,9,8).toISOString());
  assert.equal(spendingPeriod('week',now).start,new Date(2026,9,5).toISOString());
  assert.equal(spendingPeriod('week',new Date(2026,9,4,23)).start,new Date(2026,8,28).toISOString());
  assert.equal(spendingPeriod('month',now).start,new Date(2026,9,1).toISOString());
  assert.equal(spendingPeriod('year',new Date(2028,1,29,12)).start,new Date(2028,0,1).toISOString());
  assert.throws(()=>spendingPeriod('all',now),/daily/);
  const boundary=new Date(2026,9,8);
  const data=summarizeSpending([entry('before',{createdAt:new Date(+boundary-1).toISOString()}),entry('start',{createdAt:boundary.toISOString()}),entry('future',{createdAt:new Date(+now+1).toISOString()})],'day',now);
  assert.equal(data.total,.15);
});

test('combines providers across projects, counts paid failures, separates pending and unknown, and deduplicates receipts',()=>{
  const rows=[entry('a',{requestId:'same'}),entry('duplicate',{requestId:'same',actual:.11}),entry('b',{provider:'openrouter',projectId:'another',actual:.000321,status:'FAILED'}),entry('c',{status:'IN_QUEUE'}),entry('d',{status:'FAILED'}),entry('e',{status:'FAILED',requestId:'failed-receipt'}),entry('f',{status:'UNKNOWN'}),entry('g',{estimate:{amount:.2,extraUsage:true}}),entry('free',{provider:'openrouter',actual:0}),entry('no-receipt',{provider:'openrouter',status:'FAILED',accepted:true})];
  const data=summarizeSpending(rows,'day',now);
  assert.equal(data.confirmed,.110321);assert.equal(data.estimated,.2);assert.equal(data.total,.310321);
  assert.equal(data.confirmedCount,3);assert.equal(data.estimatedCount,1);assert.equal(data.pending,1);assert.equal(data.unpriced,3);assert.equal(data.extraUsage,1);
  assert.equal(data.providers.fal.confirmed,.11);assert.equal(data.providers.openrouter.confirmed,.000321);
});

test('historical estimates use one output per task and unpriced references never silently become zero',async t=>{
  const store=await createSpendingStore({directory:await directory(t),now:()=>now});
  const jobs=[job({tasks:[{status:'COMPLETED'},{status:'COMPLETED'},{status:'FAILED'},{status:'IN_QUEUE'}]}),job({id:'unknown',settings:{...settings,inputType:'edit'},tasks:[{status:'COMPLETED'}]})];
  const data=store.summary(jobs,[],'day');assert.equal(data.estimated,.3);assert.equal(data.estimatedCount,2);assert.equal(data.pending,1);assert.equal(data.unpriced,1);
  assert.equal(falCostEstimate(settings).amount,.15);
});

test('billing reconciliation sums paginated final costs once, ignores unrelated requests and persists without credentials',async t=>{
  const dir=await directory(t),calls=[];
  const store=await createSpendingStore({directory:dir,now:()=>now,fetchImpl:async(url,options)=>{
    calls.push({url,options});const u=new URL(url);assert.equal(u.origin,'https://api.fal.ai');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Key test-fal');assert.deepEqual(u.searchParams.getAll('request_id'),['fal-1']);
    assert(Date.parse(u.searchParams.get('end'))-Date.parse(u.searchParams.get('start'))<=90*86400000);
    return reply(u.searchParams.has('cursor')?{billing_events:[{request_id:'fal-1',cost_total:.04}],has_more:false}:{billing_events:[{request_id:'fal-1',cost_total:.08,cost_subtotal:.1,cost_discount:.02},{request_id:'unrelated',cost_total:100}],has_more:true,next_cursor:'next'});
  }});
  const jobs=[job({billingKeyHash:keyFingerprint('test-fal')})];
  await store.sync(jobs,[],'day',{fal:'test-fal'});assert.equal(calls.length,2);
  assert.equal(store.summary(jobs,[],'day').confirmed,.12);assert.equal(store.summary(jobs,[],'day').estimated,0);
  await store.sync(jobs,[],'day',{fal:'test-fal'});assert.equal(calls.length,2);
  await store.sync(jobs,[],'week',{fal:'test-fal'});await store.sync(jobs,[],'day',{fal:'test-fal'});assert.equal(calls.length,2);
  const saved=await readFile(join(dir,'spending.json'),'utf8');assert(!saved.includes('test-fal'));
  const reopened=await createSpendingStore({directory:dir,now:()=>new Date(+now+1000),fetchImpl:()=>{throw Error('offline');}});
  assert.equal(reopened.summary(jobs,[],'day').confirmed,.12);assert.equal(reopened.summary(jobs,[],'day').trackingStartedAt,createdAt);
});

test('billing permission failures retain estimates; missing events do not imply free generation',async t=>{
  const dir=await directory(t);let denied=true;
  const store=await createSpendingStore({directory:dir,now:()=>now,fetchImpl:async()=>denied?new Response('private provider body',{status:403}):reply({billing_events:[],has_more:false})});
  await store.sync([job()],[],'day',{fal:'test-fal'});let data=store.summary([job()],[],'day');assert.equal(data.estimated,.15);assert.equal(data.confirmedCount,0);assert.match(data.notice,/billing access/);assert(!data.notice.includes('private'));
  denied=false;await store.sync([job()],[],'month',{fal:'test-fal'});data=store.summary([job()],[],'day');assert.equal(data.estimated,.15);assert.equal(data.confirmedCount,0);
});

test('invalid or looping pagination never commits a partial charge',async t=>{
  const store=await createSpendingStore({directory:await directory(t),now:()=>now,fetchImpl:async()=>reply({billing_events:[{request_id:'fal-1',cost_total:.1}],has_more:true,next_cursor:'same'})});
  await store.sync([job()],[],'day',{fal:'test-fal'});
  assert.equal(store.summary([job()],[],'day').confirmed,0);assert.equal(store.summary([job()],[],'day').estimated,.15);
});

test('provider estimates are not treated as confirmed billing',async t=>{
  const store=await createSpendingStore({directory:await directory(t),now:()=>now,fetchImpl:async()=>reply({billing_events:[{request_id:'fal-1',cost_estimate_nano_usd:100000000}],has_more:false})});
  await store.sync([job()],[],'day',{fal:'test-fal'});assert.equal(store.summary([job()],[],'day').confirmedCount,0);
});

test('older OpenRouter charges are recovered once; wrong accounts and mismatched receipts are excluded',async t=>{
  const dir=await directory(t),calls=[];
  const store=await createSpendingStore({directory:dir,now:()=>now,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(new URL(url).origin,'https://openrouter.ai');assert.equal(options.headers.Authorization,'Bearer test-router');return reply({data:{id:'gen-1',total_cost:.012}});}});
  const rows=[entry('one',{provider:'openrouter',estimate:null,requestId:'gen-1',keyHash:keyFingerprint('test-router')}),entry('two',{provider:'openrouter',estimate:null,requestId:'gen-2',keyHash:keyFingerprint('other-key')})];
  await store.sync([],rows,'day',{openrouter:'test-router'});assert.equal(calls.length,1);
  const data=store.summary([],rows,'day');assert.equal(data.confirmed,.012);assert.equal(data.unpriced,1);
  const wrong=await createSpendingStore({directory:await directory(t),now:()=>now,fetchImpl:async()=>reply({data:{id:'different',total_cost:50}})});
  await wrong.sync([],rows,'day',{openrouter:'test-router'});assert.equal(wrong.summary([],rows,'day').confirmed,0);
});

test('old unpriced batches do not starve later requests',async t=>{
  let date=now;const calls=[];
  const store=await createSpendingStore({directory:await directory(t),now:()=>date,fetchImpl:async url=>{calls.push(new URL(url).searchParams.getAll('request_id'));return reply({billing_events:[],has_more:false});}});
  const jobs=Array.from({length:51},(_,i)=>job({id:'j'+i,tasks:[{status:'COMPLETED',requestId:'r'+i}]}));
  await store.sync(jobs,[],'day',{fal:'key'});date=new Date(+now+61000);await store.sync(jobs,[],'day',{fal:'key'});
  assert.equal(calls[0].length,50);assert(calls[1].includes('r50'));
});

test('enhancement charges persist even when the resulting prompt is invalid; interrupted work is recovered without recharging',async t=>{
  const dir=await directory(t);await writeFile(join(dir,PRESET_FILES.image),'# no presets');
  const store=await createSpendingStore({directory:dir});
  const enhancer=createPromptEnhancer({directory:dir,trackSpending:store.trackEnhancement,fetchImpl:async()=>reply({id:'gen-invalid',usage:{cost:.004},choices:[{message:{content:'not json'}}]})});
  await assert.rejects(enhancer.enhance({model:'nano-pro',mode:'image',projectId:'default',prompt:'{"subject":"cat"}'},'test-router'),/valid JSON/);
  assert.equal(store.summary([],[],'day').confirmed,.004);
  await store.trackEnhancement({id:'unfinished',status:'RUNNING',createdAt:new Date().toISOString(),projectId:'default'});
  const reopened=await createSpendingStore({directory:dir});const data=reopened.summary([],[],'day');assert.equal(data.confirmed,.004);assert.equal(data.unpriced,1);assert.equal(data.pending,0);
  const saved=await readFile(join(dir,'spending.json'),'utf8');assert(!saved.includes('test-router'));assert(!saved.includes('subject'));
});

test('enhancement is not submitted when its initial spending record cannot be saved',async t=>{
  const dir=await directory(t),store=await createSpendingStore({directory:dir});await writeFile(join(dir,PRESET_FILES.image),'');let calls=0;
  const enhancer=createPromptEnhancer({directory:dir,trackSpending:async entry=>{await rename(dir,dir+'-moved');try{await store.trackEnhancement(entry);}finally{await rename(dir+'-moved',dir);}},fetchImpl:async()=>{calls++;return reply({});}});
  await assert.rejects(enhancer.enhance({model:'nano-pro',mode:'image',projectId:'default',prompt:'A cat'},'key'),/Cannot save spending/);
  assert.equal(calls,0);assert.equal(store.summary([],[],'day').pending,0);assert.equal(store.summary([],[],'day').storageError,true);
});

test('LLM failures retain billed usage before output validation and hide key fingerprints from the browser',async t=>{
  const dir=await directory(t),store=await createLlmStore({directory:dir,requireProject:id=>({id}),fetchImpl:async()=>reply({id:'gen-refused',usage:{cost:.023,prompt_tokens:20},choices:[{message:{refusal:'No'}}]})});
  const body={model:LLM_MODELS[0].id,projectId:'default',task:'image',format:'text',maxTokens:2048,instruction:''};
  const initial=await store.submit(body,[{kind:'image',bytes:8,contentType:'image/png',data:'data:image/png;base64,aGVsbG8='}],'test-router');assert(!('billingKeyHash' in initial));
  for(let i=0;i<100&&store.list('default').jobs[0].status==='RUNNING';i++)await new Promise(r=>setTimeout(r,5));
  const output=store.list('default').jobs[0];assert.equal(output.status,'FAILED');assert.equal(output.usage.cost,.023);assert(!('billingKeyHash' in output));
  assert.equal(store.spendingEntries()[0].actual,.023);assert.equal(store.spendingEntries()[0].requestId,'gen-refused');
  // Let the asynchronous completion save settle before tearing down its directory.
  for(let i=0;i<100;i++){if(JSON.parse(await readFile(join(dir,'llm-jobs.json')))[0].status==='FAILED')break;await new Promise(r=>setTimeout(r,5));}
});

test('spending routes aggregate every project, protect mutations, and snapshot generation costs',async t=>{
  const dir=await directory(t),stamp=new Date().toISOString(),jobs=[job({createdAt:stamp,costEstimate:{amount:.15}})];await writeFile(join(dir,'jobs.json'),JSON.stringify(jobs));
  let sequence=0;const app=await createStudio({dataDir:dir,key:'test-fal',openRouterKey:'',autoArchive:false,pollMs:3600000,fetchImpl:async url=>{
    if(String(url).startsWith('https://queue.fal.run/'))return reply({request_id:'new-generation-'+(++sequence),status_url:'https://queue.fal.run/mock/status',response_url:'https://queue.fal.run/mock/result'});
    return reply({billing_events:[],has_more:false});
  }});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const base='http://127.0.0.1:'+app.server.address().port,get=path=>fetch(base+path),config=await get('/api/bootstrap').then(r=>r.json());assert.equal(config.features.spending,true);
  const post=(path,body,token=config.csrf)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body)});
  assert.equal((await post('/api/spending/sync',{period:'day'},'wrong')).status,403);
  assert.equal((await get('/api/spending?period=bad')).status,400);
  assert.equal((await get('/spending.json')).status,404);assert.equal((await get('/.local/spending.json')).status,404);
  assert.equal((await get('/spending.js')).status,200);
  const project=await post('/api/projects',{type:'create',name:'Second project'}).then(r=>r.json());
  const submitted=await post('/api/generate',{...settings,projectId:project.project.id,referenceIds:[]}).then(r=>r.json());assert(submitted.job);assert(!('billingKeyHash' in submitted.job));
  const total=await get('/api/spending?period=day&project='+project.project.id).then(r=>r.json());assert.equal(total.scope,'studio');assert.equal(total.estimated,.15);assert.equal(total.pending,2);
  const saved=JSON.parse(await readFile(join(dir,'jobs.json'))).find(j=>j.id===submitted.job.id);assert.equal(saved.costEstimate.amount,.15);assert.equal(saved.billingKeyHash,keyFingerprint('test-fal'));
  assert(!JSON.stringify(total).includes('test-fal'));assert(!JSON.stringify(total).includes('billingKeyHash'));
  // Complete the background queue-submission saves before cleanup.
  for(let i=0;i<100;i++){const all=JSON.parse(await readFile(join(dir,'jobs.json')));if(all[0].tasks.every(task=>task.status!=='SUBMITTING'))break;await new Promise(r=>setTimeout(r,5));}
});
