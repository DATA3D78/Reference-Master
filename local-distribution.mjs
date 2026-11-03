// Entrypoint for the self-contained Mac release. User data never lives inside
// the signed app bundle, so replacing the app preserves the library and keys.
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from './server.mjs';
import {API_KEY_FILES,migrateApiKeyFile} from './custom-files.mjs';
import {portIsBusy,waitForFreePort} from './service.mjs';

const root=dirname(fileURLToPath(import.meta.url));
export const LOCAL_RELEASE_PORT=4318;
export async function prepareLocalDistribution({home,templates=join(root,'CUSTOM')}={}){
  if(!home||!isAbsolute(home))throw Error('Choose an absolute studio data folder.');
  await mkdir(home,{recursive:true,mode:0o700});
  const canonical=await realpath(home),custom=join(canonical,'CUSTOM'),dataDir=join(canonical,'data');
  await mkdir(custom,{recursive:true,mode:0o700});await mkdir(dataDir,{recursive:true,mode:0o700});
  await Promise.all(Object.values(API_KEY_FILES).map(name=>migrateApiKeyFile(join(custom,name))));
  for(const filename of [...Object.values(API_KEY_FILES),'IMAGE_PROMPT_PRESETS.txt','VIDEO_PROMPT_PRESETS.txt']){
    const content=Object.values(API_KEY_FILES).includes(filename)?'# Paste your own API key on one line, then save this file.\n':await readFile(join(templates,filename),'utf8');
    try{await writeFile(join(custom,filename),content,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const instanceId='local-release:'+createHash('sha256').update(canonical).digest('hex');
  return {home:canonical,instanceId,options:{dataDir,key:undefined,openRouterKey:undefined,keyFile:join(custom,API_KEY_FILES.fal),openRouterKeyFile:join(custom,API_KEY_FILES.openrouter),promptPresetDir:custom,instanceId}};
}
export async function localReleaseReady(url,instanceId,fetchImpl=fetch){
  try{const r=await fetchImpl(url+'/api/bootstrap',{signal:AbortSignal.timeout(1500)});if(!r.ok)return false;const b=await r.json();return b.instanceId===instanceId&&typeof b.csrf==='string'&&Array.isArray(b.models);}catch{return false;}
}
export function parseLocalArguments(args){
  const [action,...rest]=args,options={port:LOCAL_RELEASE_PORT};
  if(!['serve','wait'].includes(action))throw Error('Choose serve or wait.');
  for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!value||!['--home','--port'].includes(key))throw Error('Invalid local launcher options.');if(key==='--home')options.home=value;else options.port=Number(value);}
  if(!options.home||!isAbsolute(options.home))throw Error('Choose an absolute studio data folder.');
  if(!Number.isInteger(options.port)||options.port<1024||options.port>65535)throw Error('Choose a valid local port.');
  return {action,...options};
}
export async function runLocalDistribution(args){
  // Finder normally supplies no provider credentials, but a shell launch may.
  // A release always reads the recipient's saved key files or in-app session.
  delete process.env.FAL_KEY;delete process.env.OPENROUTER_API_KEY;
  const {action,home,port}=parseLocalArguments(args),profile=await prepareLocalDistribution({home}),url='http://127.0.0.1:'+port;
  if(action==='wait'){
    for(let n=0;n<60;n++){if(await localReleaseReady(url,profile.instanceId)){console.log(JSON.stringify({url:url+'/'}));return;}await delay(500);}
    throw Error(`The studio could not start. Another app may be using port ${port}. Use the FS menu to open the saved-files folder and check service.log.`);
  }
  const controller=new AbortController();let studio,stopping=false;
  const stop=()=>{stopping=true;controller.abort();if(studio){studio.server.close();studio.server.closeIdleConnections();}const timeout=setTimeout(()=>process.exit(0),5000);timeout.unref();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    if(await portIsBusy(port)){
      if(!await localReleaseReady(url,profile.instanceId))throw Error(`Port ${port} belongs to another app or studio library. Quit it before opening this copy. Nothing was stopped.`);
      await waitForFreePort(port,{signal:controller.signal});
    }
    if(stopping)return;
    studio=await createStudio(profile.options);
    if(stopping)return;
    await new Promise((resolve,reject)=>{studio.server.once('error',reject);studio.server.listen(port,'127.0.0.1',resolve);});
    console.log(`FWRD.STUDIO is ready at ${url}`);
  }catch(error){if(!stopping)throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)runLocalDistribution(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
