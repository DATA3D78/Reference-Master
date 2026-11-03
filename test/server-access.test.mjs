import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequestAccess,studioRuntime} from '../server-access.mjs';
import {createStudio} from '../server.mjs';
// Node's fetch normalizes Host; explicit HTTP requests exercise proxy hosts.
function request(url,options={}){return new Promise((resolve,reject)=>{
  const req=httpRequest(url,{method:options.method||'GET',headers:options.headers},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));res.on('error',reject);
  });req.on('error',reject);req.end(options.body);
});}
const origin='https://studio.example.com';
const secret=randomBytes(32).toString('hex');
const headers={host:'studio.example.com','x-studio-proxy-token':secret,'x-forwarded-proto':'https'};

test('local access retains loopback host and same-origin restrictions',()=>{
  const authorize=createRequestAccess();
  for(const host of ['localhost:4322','127.0.0.1:4322'])authorize({headers:{host,origin:'http://'+host}},4322);
  for(const h of [{host:'evil.example:4322'},{host:'localhost:80'},{host:'localhost:4322',origin:'https://evil.example'}])assert.throws(()=>authorize({headers:h},4322),{status:403});
});

test('hosted access rejects missing, malformed or plaintext configuration',()=>{
  for(const publicOrigin of ['http://studio.example.com','https://user:password@studio.example.com','https://studio.example.com/path','https://studio.example.com/?x=1','bad'])assert.throws(()=>createRequestAccess({publicOrigin,proxySecret:secret}));
  for(const proxySecret of ['',undefined,'too-short','g'.repeat(64)])assert.throws(()=>createRequestAccess({publicOrigin:origin,proxySecret}));
  assert.throws(()=>createRequestAccess({proxySecret:secret}));
});

test('hosted access needs trusted proxy, configured HTTPS host and same origin',()=>{
  const authorize=createRequestAccess({publicOrigin:origin,proxySecret:secret});
  authorize({headers});authorize({headers:{...headers,origin,'sec-fetch-site':'same-origin'}});
  for(const h of [
    {...headers,'x-studio-proxy-token':''}, {...headers,'x-studio-proxy-token':'a'.repeat(64)},
    {...headers,host:'localhost:4322'}, {...headers,'x-forwarded-proto':'http'},
    {...headers,origin:'https://evil.example'}, {...headers,origin:'null'},
    {...headers,'sec-fetch-site':'cross-site'}, {...headers,'x-forwarded-proto':'https, http'},
  ])assert.throws(()=>authorize({headers:h}),{status:403});
});

test('runtime defaults stay local; remote binding requires complete explicit configuration',async t=>{
  const root=await mkdtemp(join(tmpdir(),'hosting-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const local=await studioRuntime(root,{});assert.equal(local.host,'127.0.0.1');assert.equal(local.port,4322);assert.equal(local.options.dataDir,join(root,'.local'));
  for(const env of [{FRAME_HOST:'0.0.0.0'},{FRAME_PUBLIC_ORIGIN:origin},{PORT:'0'},{PORT:'oops'},{FRAME_DATA_DIR:'relative'}])await assert.rejects(studioRuntime(root,env));
  const tokenFile=join(root,'token');await writeFile(tokenFile,secret+'\n');
  const runtime=await studioRuntime(root,{FRAME_PUBLIC_ORIGIN:origin,FRAME_PROXY_SECRET_FILE:tokenFile,FRAME_DATA_DIR:join(root,'media'),FRAME_CUSTOM_DIR:join(root,'custom'),PORT:'12345'});
  assert.equal(runtime.host,'0.0.0.0');assert.equal(runtime.port,12345);assert.equal(runtime.options.access.proxySecret,secret);assert.equal(runtime.options.keyFile,join(root,'custom','FAL_API_KEY_HERE.txt'));
  assert.equal(runtime.options.promptPresetDir,join(root,'custom'));
});

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'hosting-server-')),custom=join(dir,'custom'),servers=[];
  await mkdir(custom);await writeFile(join(custom,'IMAGE_PROMPT_PRESETS.txt'),'[My preset]\nA soft photographic finish.\n');
  t.after(async()=>{for(const {server} of servers)if(server.listening)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const launch=async()=>{
    const studio=await createStudio({dataDir:join(dir,'data'),key:'',openRouterKey:'',keyFile:null,openRouterKeyFile:null,promptPresetDir:custom,access:{publicOrigin:origin,proxySecret:secret},autoArchive:false,pollMs:3600000,fetchImpl:async()=>{throw Error('No provider calls during hosting tests');}});
    servers.push(studio);await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
    const url='http://127.0.0.1:'+studio.server.address().port;
    const get=(path,extra={})=>request(url+path,{headers:{...headers,...extra}});
    const config=await (await get('/api/bootstrap')).json();
    const post=(path,body,extra={})=>request(url+path,{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Studio-Token':config.csrf,origin,...extra},body:JSON.stringify(body)});
    return {...studio,url,get,post,config};
  };
  return {dir,launch,...await launch()};
}

test('every hosted route is gated and private files stay unavailable after authentication',async t=>{
  const f=await fixture(t);
  for(const path of ['/','/app.js','/api/bootstrap','/api/projects','/api/assets/media?id=abc','/api/download?job=x&media=y','/api/editing/exports/'+ 'a'.repeat(48)]){
    assert.equal((await request(f.url+path,{headers:{host:headers.host,'x-forwarded-proto':'https'}})).status,403,path);
  }
  assert.equal((await f.get('/')).status,200);assert.equal((await f.get('/app.js')).status,200);
  assert.ok(f.config.csrf);assert.equal(JSON.stringify(f.config).includes(secret),false);
  for(const path of ['/CUSTOM/API_KEY.txt','/.local/jobs.json','/deploy/secrets/proxy-token','/server-access.mjs'])assert.equal((await f.get(path)).status,404,path);
  assert.equal((await f.get('/api/bootstrap',{origin:'https://evil.example'})).status,403);
});

test('authenticated mutations retain CSRF protection and survive a server restart',async t=>{
  const f=await fixture(t),body={type:'create',name:'Online project'};
  assert.equal((await f.post('/api/projects',body,{'X-Studio-Token':''})).status,403);
  assert.equal((await f.post('/api/projects',body,{origin:'https://evil.example'})).status,403);
  const created=await f.post('/api/projects',body);assert.equal(created.status,200);const {project}=await created.json();
  const presets=await(await f.get('/api/prompt-presets?mode=image')).json();assert.equal(presets.presets[0].title,'My preset');
  await new Promise(r=>f.server.close(r));const restarted=await f.launch();
  assert.ok(restarted.config.projects.some(p=>p.id===project.id&&p.name==='Online project'));
  assert.notEqual(restarted.config.csrf,f.config.csrf);
  assert.equal((await restarted.post('/api/projects',body,{'X-Studio-Token':f.config.csrf})).status,403);
});

test('Caddy authenticates all routes, strips credentials and overwrites spoofed proxy headers', {skip:!process.env.CADDY_TEST_BIN}, async t=>{
  const f=await fixture(t),bin=process.env.CADDY_TEST_BIN;
  const hashResult=spawnSync(bin,['hash-password','--algorithm','bcrypt','--bcrypt-cost','4'],{input:'test-only-hosting-password\n',encoding:'utf8'});
  assert.equal(hashResult.status,0,hashResult.stderr);
  const production=await readFile(new URL('../deploy/Caddyfile',import.meta.url),'utf8');
  const env={...process.env,STUDIO_DOMAIN:'studio.example.com',STUDIO_USER:'studio',STUDIO_PASSWORD_HASH:hashResult.stdout.trim(),STUDIO_PROXY_TOKEN:secret,XDG_DATA_HOME:join(f.dir,'caddy-data'),XDG_CONFIG_HOME:join(f.dir,'caddy-config')};
  const checked=spawnSync(bin,['validate','--config',new URL('../deploy/Caddyfile',import.meta.url).pathname,'--adapter','caddyfile'],{env,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
  // Exercise the production auth/proxy directives over loopback only. Real TLS
  // issuance needs the chosen public domain and is checked during deployment.
  const config=join(f.dir,'Caddyfile');
  await writeFile(config,'{\n admin off\n auto_https off\n}\n'+production.replace('{$STUDIO_DOMAIN} {',`http://:${port} {\n bind 127.0.0.1`).replace('studio:4322','127.0.0.1:'+f.server.address().port));
  let logs='';const child=spawn(bin,['run','--config',config,'--adapter','caddyfile'],{env,stdio:['ignore','ignore','pipe']});child.stderr.on('data',s=>logs+=s);
  const stopped=new Promise(r=>child.once('exit',r));t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await stopped;}});
  const proxy='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<100;i++){try{await request(proxy,{headers:{host:headers.host}});ready=true;break;}catch{await delay(30);}}
  assert.ok(ready,logs);
  for(const path of ['/','/app.js','/api/bootstrap','/api/assets','/api/download?job=x']){
    const response=await request(proxy+path,{headers:{host:headers.host,'X-Studio-Proxy-Token':secret,'X-Forwarded-Proto':'https'}});
    assert.equal(response.status,401,path);assert.match(response.headers.get('www-authenticate'),/Basic/);
  }
  let forwarded;f.server.prependListener('request',req=>forwarded=req.headers);
  const authenticated={host:headers.host,Authorization:'Basic '+Buffer.from('studio:test-only-hosting-password').toString('base64'),'X-Studio-Proxy-Token':'forged','X-Forwarded-Proto':'http'};
  const response=await request(proxy+'/api/bootstrap',{headers:authenticated});assert.equal(response.status,200);assert.ok((await response.json()).csrf);
  assert.equal(forwarded.authorization,undefined);assert.equal(forwarded['x-studio-proxy-token'],secret);assert.equal(forwarded['x-forwarded-proto'],'https');
  assert.equal((await request(proxy+'/api/bootstrap',{headers:{...authenticated,Authorization:'Basic '+Buffer.from('studio:wrong').toString('base64')}})).status,401);
  assert.equal((await request(proxy+'/api/bootstrap',{headers:{...authenticated,Origin:'https://evil.example'}})).status,403);
});
