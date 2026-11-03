import {mkdir,copyFile,constants,chmod} from 'node:fs/promises';
const custom=new URL('../CUSTOM/',import.meta.url);
await mkdir(custom,{recursive:true});
try { await copyFile(new URL('REFERENCE_MASTER_COMFY_KEY.example.txt',custom),new URL('REFERENCE_MASTER_COMFY_KEY.txt',custom),constants.COPYFILE_EXCL); console.log('Created CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt. Add your own Comfy key.'); }
catch(error){if(error.code!=='EEXIST')throw error;console.log('Existing Comfy key file preserved.');}

await chmod(new URL('REFERENCE_MASTER_COMFY_KEY.txt',custom),0o600);
if(process.platform==='darwin'){
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const compiler=spawnSync('xcrun',['--find','clang'],{encoding:'utf8'});
  if(compiler.status===0){
    const result=spawnSync(compiler.stdout.trim(),['-framework','Cocoa',fileURLToPath(new URL('../launcher/SelectMediaFolder.m',import.meta.url)),'-o',fileURLToPath(new URL('../launcher/select-media-folder',import.meta.url))],{encoding:'utf8'});
    console.log(result.status===0?'Mac folder picker ready.':'Optional folder picker unavailable; default local storage still works.');
  }else console.log('Optional Mac folder picker requires Xcode Command Line Tools; default local storage still works.');
}
