// The native menu-bar app owns this supervisor, so closing the browser or
// Terminal cannot stop the studio. Reuse an existing server without interrupting jobs.
import net from 'node:net';
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function portIsBusy(port) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    const finish=(error,busy)=>{socket.destroy();error?reject(error):resolve(busy);};
    socket.setTimeout(1500,()=>finish(new Error('Timed out checking the studio port.')));
    socket.once('connect',()=>finish(null,true));
    socket.once('error',error=>finish(error.code==='ECONNREFUSED'?null:error,false));
  });
}

export async function waitForFreePort(port,{signal,interval=2000}={}) {
  while(await portIsBusy(port))await delay(interval,undefined,{signal});
  signal?.throwIfAborted();
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const root=dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||4322);
  const controller=new AbortController();let child,stopping=false;
  const stop=()=>{stopping=true;controller.abort();if(child)child.kill('SIGTERM');};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try{
    await waitForFreePort(port,{signal:controller.signal});
    child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,stdio:'inherit',env:{...process.env,PORT:String(port),FRAME_OPEN_BROWSER:'0'}});
    child.on('error',()=>{console.error('Could not start the studio server.');process.exitCode=1;});
    child.on('exit',code=>{process.exitCode=stopping?0:(code??1);});
  }catch(error){if(!stopping){console.error(error.message);process.exitCode=1;}}
}
