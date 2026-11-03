import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readSavedApiKey} from '../api-key-file.mjs';
import {createStudio} from '../server.mjs';

// Each Node test file has its own process; never use a real environment key.
delete process.env.FAL_KEY;
async function folder(t){const dir=await mkdtemp(join(tmpdir(),'studio-key-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function start(t,dir,options={}){
  const calls=[];
  const app=await createStudio({dataDir:dir,keyFile:join(dir,'API_KEY.txt'),autoArchive:false,pollMs:3600000,
    fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({request_id:'test-receipt',status_url:'https://queue.fal.run/test/model/requests/test-receipt/status',response_url:'https://queue.fal.run/test/model/requests/test-receipt'});},...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const close=()=>new Promise(resolve=>app.server.close(resolve));
  t.after(async()=>{if(app.server.listening)await close();});
  const get=path=>fetch(base+path);
  const config=await(await get('/api/bootstrap')).json();
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':config.csrf},body:JSON.stringify(body)});
  return {get,post,config,calls,close};
}
test('key file accepts plain text, comments and line endings without echoing malformed secrets',async t=>{
  const dir=await folder(t),path=join(dir,'API_KEY.txt');
  assert.equal(await readSavedApiKey(path),'');
  await writeFile(path,'# Instructions\n\n');assert.equal(await readSavedApiKey(path),'');
  await writeFile(path,'# Instructions\r\n  dummy-key:private  \r\n');assert.equal(await readSavedApiKey(path),'dummy-key:private');
  for(const text of ['dummy-secret\nsecond-key','dummy secret','dummy-secret'.repeat(500)]){
    await writeFile(path,text);await assert.rejects(readSavedApiKey(path),error=>!error.message.includes('dummy')&&error.message.includes('FAL_API_KEY_HERE.txt'));
  }
});
test('saved key survives restarts, authenticates mock generation and never appears in HTTP or history',async t=>{
  const dir=await folder(t),key='dummy-persisted-private-key';await writeFile(join(dir,'API_KEY.txt'),key);
  let app=await start(t,dir);assert.equal(app.config.keyConfigured,true);assert.equal(app.config.features.savedApiKey,true);
  assert(!JSON.stringify(app.config).includes(key));
  for(const path of ['/API_KEY.txt','/api-key-file.mjs','/.env','/.local/jobs.json'])assert.equal((await app.get(path)).status,404);
  const response=await app.post('/api/generate',{model:'nano-pro',inputType:'text',prompt:'A blue sculpture',ratio:'1:1',resolution:'1K',count:1,duration:'5',referenceIds:[]});
  assert.equal(response.status,202);assert(!JSON.stringify(await response.json()).includes(key));
  assert.equal(app.calls[0].options.headers.Authorization,'Key '+key);
  await app.close();
  assert(!(await readFile(join(dir,'jobs.json'),'utf8')).includes(key));
  app=await start(t,dir);assert.equal(app.config.keyConfigured,true);assert(!(await(await app.get('/api/jobs')).text()).includes(key));
});
test('refresh loads file edits; session overrides and disconnect do not modify the saved file',async t=>{
  const dir=await folder(t),path=join(dir,'API_KEY.txt');await writeFile(path,'# Paste key here\n');
  const app=await start(t,dir);assert.equal(app.config.keyConfigured,false);
  await writeFile(path,'dummy-new-saved-key');assert.equal((await(await app.get('/api/bootstrap')).json()).keyConfigured,true);
  await writeFile(path,'');assert.equal((await(await app.get('/api/bootstrap')).json()).keyConfigured,false);
  await writeFile(path,'dummy-new-saved-key');
  await app.post('/api/settings',{key:'dummy-session-key'});
  await writeFile(path,'');assert.equal((await(await app.get('/api/bootstrap')).json()).keyConfigured,true);
  await writeFile(path,'dummy-new-saved-key');await app.post('/api/settings',{key:''});
  assert.equal((await(await app.get('/api/bootstrap')).json()).keyConfigured,false);
  assert.equal(await readFile(path,'utf8'),'dummy-new-saved-key');
});
test('explicit environment or session credential takes precedence over the file',async t=>{
  const dir=await folder(t);await writeFile(join(dir,'API_KEY.txt'),'dummy-file-key');
  const app=await start(t,dir,{key:'dummy-override-key'});
  const response=await app.post('/api/generate',{model:'nano-pro',inputType:'text',prompt:'A blue sculpture',ratio:'1:1',resolution:'1K',count:1,duration:'5',referenceIds:[]});
  assert.equal(response.status,202);assert.equal(app.calls[0].options.headers.Authorization,'Key dummy-override-key');
});
