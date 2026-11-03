import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareLocalDistribution,parseLocalArguments,localReleaseReady} from '../local-distribution.mjs';
import {copyReleaseCode} from '../distribution/build.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function folder(t){const path=await mkdtemp(join(tmpdir(),'studio-local-release-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
test('release staging excludes real credentials, libraries and workstation files',async t=>{
  const dir=await folder(t),dest=join(dir,'app');await copyReleaseCode(root,dest);
  for(const name of ['.local','deploy','test','launcher','FWRD.STUDIO.app','README.md'])await assert.rejects(stat(join(dest,name)),{code:'ENOENT'});
  for(const name of ['FAL_API_KEY_HERE.txt','OPENROUTER_API_KEY_HERE.txt']){
    const text=await readFile(join(dest,'CUSTOM',name),'utf8');assert.ok(text.startsWith('#'));assert.equal(text.split('\n').filter(line=>line&&!line.startsWith('#')).length,0);
  }
  assert.ok((await readdir(dest)).includes('server.mjs'));assert.ok((await readdir(join(dest,'public'))).includes('editing-renderer.js'));
  const imagePresets=await readFile(join(dest,'CUSTOM','IMAGE_PROMPT_PRESETS.txt'),'utf8');assert.match(imagePresets,/Natural detail/);
  assert.match(await readFile(join(dest,'public','index.html'),'utf8'),/API keys &amp; prompts/);
});
test('release code rejects symlinked application dependencies',async t=>{
  const dir=await folder(t),from=join(dir,'source');await mkdir(from);
  const {symlink}=await import('node:fs/promises');await symlink(join(root,'local-distribution.mjs'),join(from,'local-distribution.mjs'));
  await assert.rejects(copyReleaseCode(from,join(dir,'target')),/regular files/);
});
test('first launch initializes private recipient files and preserves them across updates',async t=>{
  const dir=await folder(t),templates=join(dir,'templates');await mkdir(templates);
  for(const file of ['IMAGE_PROMPT_PRESETS.txt','VIDEO_PROMPT_PRESETS.txt'])await writeFile(join(templates,file),'[Starter]\nA generic preset.\n');
  // Even a credential accidentally present in templates must never be copied.
  await writeFile(join(templates,'FAL_API_KEY_HERE.txt'),'do-not-copy-this');
  const home=join(dir,'profile'),a=await prepareLocalDistribution({home,templates});
  assert.equal(a.options.dataDir,join(a.home,'data'));assert.equal((await stat(a.options.keyFile)).mode&0o777,0o600);
  assert.doesNotMatch(await readFile(a.options.keyFile,'utf8'),/do-not-copy/);
  await writeFile(a.options.keyFile,'recipient-test-key');await writeFile(join(home,'CUSTOM','IMAGE_PROMPT_PRESETS.txt'),'[Mine]\nMy own preset.\n');
  await writeFile(join(home,'data','preserved.txt'),'Saved library');
  const b=await prepareLocalDistribution({home,templates});assert.equal(b.instanceId,a.instanceId);
  assert.equal(await readFile(b.options.keyFile,'utf8'),'recipient-test-key');assert.match(await readFile(join(home,'CUSTOM','IMAGE_PROMPT_PRESETS.txt'),'utf8'),/My own/);
  assert.equal(await readFile(join(home,'data','preserved.txt'),'utf8'),'Saved library');
  const other=await prepareLocalDistribution({home:join(dir,'other'),templates});assert.notEqual(other.instanceId,a.instanceId);
});
test('launcher checks the exact recipient library and validates its local options',async()=>{
  assert.deepEqual(parseLocalArguments(['serve','--home','/tmp/Example Folder']),{action:'serve',home:'/tmp/Example Folder',port:4318});
  for(const args of [['serve','--home','relative'],['serve','--home','/tmp/test','--port','80'],['invalid','--home','/tmp/test'],['serve','--home','/tmp/test','--unknown','1']])assert.throws(()=>parseLocalArguments(args));
  const body={instanceId:'mine',csrf:'token',models:[]};assert.equal(await localReleaseReady('http://local','mine',async()=>Response.json(body)),true);
  assert.equal(await localReleaseReady('http://local','someone-else',async()=>Response.json(body)),false);
  assert.equal(await localReleaseReady('http://local','mine',async()=>Response.json({csrf:'token',models:[]})),false);
});
test('packaged server starts with no installed Node tools or keys and keeps projects after replacement',async t=>{
  const dir=await folder(t),app=join(dir,'read-only app'),home=join(dir,'recipient');await copyReleaseCode(root,app);
  const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const processes=[];t.after(async()=>{for(const p of processes)if(p.child.exitCode===null){p.child.kill('SIGTERM');await p.exit;}});
  async function launch(){
    const child=spawn(process.execPath,[join(app,'local-distribution.mjs'),'serve','--home',home,'--port',String(port)],{cwd:app,env:{PATH:'/usr/bin:/bin',HOME:dir,FAL_KEY:'must-not-load-inherited-key',OPENROUTER_API_KEY:'must-not-load-inherited-key'},stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);const exit=once(child,'exit');processes.push({child,exit});
    const url='http://127.0.0.1:'+port;let config;
    for(let n=0;n<100;n++){try{const r=await fetch(url+'/api/bootstrap');if(r.ok){config=await r.json();break;}}catch{}await delay(30);}
    assert.ok(config,logs);return {child,exit,url,config};
  }
  const first=await launch();assert.equal(first.config.keyConfigured,false);assert.equal(first.config.projects.length,1);
  assert.equal((await(await fetch(first.url+'/api/llm/config')).json()).keyConfigured,false);
  const response=await fetch(first.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':first.config.csrf},body:JSON.stringify({type:'create',name:'My portable project'})});assert.equal(response.status,200);
  first.child.kill('SIGTERM');await first.exit;
  const second=await launch();assert.ok(second.config.projects.some(p=>p.name==='My portable project'));assert.equal(second.config.instanceId,first.config.instanceId);
  await assert.rejects(stat(join(app,'.local')),{code:'ENOENT'});
  second.child.kill('SIGTERM');await second.exit;
});
test('an occupied foreign port is rejected without stopping or opening the other application',async t=>{
  const dir=await folder(t),app=join(dir,'app');await copyReleaseCode(root,app);
  const foreign=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({csrf:'foreign',models:[],instanceId:'other'}));});
  await new Promise(r=>foreign.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>foreign.close(r)));const port=foreign.address().port;
  const child=spawn(process.execPath,[join(app,'local-distribution.mjs'),'serve','--home',join(dir,'recipient'),'--port',String(port)],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','ignore','pipe']});let logs='';child.stderr.on('data',s=>logs+=s);const [code]=await once(child,'exit');
  assert.equal(code,1);assert.match(logs,/another app or studio library/);assert.equal((await fetch('http://127.0.0.1:'+port)).status,200);
});
