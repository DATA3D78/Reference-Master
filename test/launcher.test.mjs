import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { studioReady, waitForStudio } from '../launcher.mjs';
import { portIsBusy, waitForFreePort } from '../service.mjs';

const ready=()=>Response.json({features:{comfyRouter:true},csrf:'token',keyConfigured:false,models:[{id:'nano-pro'}]});
test('launcher does not mistake a foreign or failed web server for the studio',async()=>{
  assert.equal(await studioReady('http://local',async()=>new Response('hello')),false);
  assert.equal(await studioReady('http://local',async()=>new Response('{}',{status:503})),false);
  assert.equal(await studioReady('http://local',async()=>{throw Error('offline');}),false);
  assert.equal(await studioReady('http://local',async()=>ready()),true);
});
test('launcher opens only after the studio is healthy and explains startup failure',async()=>{
  let attempts=0;
  assert.deepEqual(await waitForStudio({url:'http://local',interval:1,fetchImpl:async()=>++attempts===3?ready():new Response('{}')}),{url:'http://local/'});
  assert.equal(attempts,3);
  await assert.rejects(()=>waitForStudio({attempts:2,interval:1,fetchImpl:async()=>new Response('{}')}),/has not started/);
});
test('supervisor waits for an existing server to stop before taking over its port',async t=>{
  const server=net.createServer(socket=>socket.end());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());const port=server.address().port;
  assert.equal(await portIsBusy(port),true);
  let released=false;const waiting=waitForFreePort(port,{interval:20}).then(()=>{released=true;});
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(released,false);
  await new Promise(resolve=>server.close(resolve));await waiting;
  assert.equal(released,true);assert.equal(await portIsBusy(port),false);
});
test('supervisor waiting for an occupied port can be stopped cleanly',async t=>{
  const server=net.createServer(socket=>socket.end());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());const controller=new AbortController();
  const waiting=waitForFreePort(server.address().port,{signal:controller.signal,interval:20});
  controller.abort();await assert.rejects(waiting,{name:'AbortError'});
});
test('real supervisor takes over after an older server stops, then stops only its own child',async t=>{
  const root=await mkdtemp(join(tmpdir(),'studio-supervisor-'));
  const older=net.createServer(socket=>socket.end());await new Promise(resolve=>older.listen(0,'127.0.0.1',resolve));
  const port=older.address().port;
  await copyFile(new URL('../service.mjs',import.meta.url),join(root,'service.mjs'));
  await writeFile(join(root,'server.mjs'),`import http from 'node:http'; import {writeFileSync} from 'node:fs'; writeFileSync('started','yes'); http.createServer((req,res)=>res.end('studio fixture')).listen(Number(process.env.PORT),'127.0.0.1');`);
  const supervisor=spawn(process.execPath,[join(root,'service.mjs')],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let logs='';supervisor.stdout.on('data',data=>{logs+=data;});supervisor.stderr.on('data',data=>{logs+=data;});
  const exit=once(supervisor,'exit');
  t.after(async()=>{older.close();if(supervisor.exitCode===null){supervisor.kill('SIGTERM');await exit;}await rm(root,{recursive:true,force:true});});
  await new Promise(resolve=>setTimeout(resolve,150));
  await assert.rejects(()=>readFile(join(root,'started')),{code:'ENOENT'});
  await new Promise(resolve=>older.close(resolve));
  let healthy=false;
  for(let n=0;n<60;n++){
    try{healthy=await (await fetch(`http://127.0.0.1:${port}`)).text()==='studio fixture';}catch{}
    if(healthy)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(healthy,true,`Supervisor exit: ${supervisor.exitCode}; ${logs}`);
  supervisor.kill('SIGTERM');await exit;
  assert.equal(await portIsBusy(port),false);
});
