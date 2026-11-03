import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {customPaths,migrateApiKeyFile} from '../custom-files.mjs';
import {createSettingsFiles} from '../settings-files.mjs';
import {createStudio} from '../server.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'studio-settings-files-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const paths=customPaths(root);await mkdir(paths.promptPresetDir);
  for(const name of ['IMAGE_PROMPT_PRESETS.txt','VIDEO_PROMPT_PRESETS.txt'])await writeFile(join(paths.promptPresetDir,name),'[Test]\nPreset instructions.\n');
  return {root,paths};
}
test('migration never overwrites a newer key and does not follow legacy symlinks',async t=>{
  const {root,paths}=await fixture(t),old=join(paths.promptPresetDir,'API_KEY.txt');
  await writeFile(old,'legacy');await writeFile(paths.keyFile,'newer');
  await migrateApiKeyFile(paths.keyFile);
  assert.equal(await readFile(paths.keyFile,'utf8'),'newer');assert.equal(await readFile(old,'utf8'),'legacy');
  const unrelated=join(root,'unrelated');await writeFile(unrelated,'private');
  await symlink(unrelated,join(paths.promptPresetDir,'OPENROUTER_API_KEY.txt'));
  await migrateApiKeyFile(paths.openRouterKeyFile);
  await assert.rejects(lstat(paths.openRouterKeyFile),{code:'ENOENT'});
});
test('only the four allowlisted regular files can open; API responses never contain keys or paths',async t=>{
  const {paths}=await fixture(t),opened=[];
  await writeFile(paths.falKeyFile,'dummy-private-fal');await writeFile(paths.keyFile,'dummy-private-key');await writeFile(paths.openRouterKeyFile,'dummy-private-router');
  const files=createSettingsFiles({...paths,platform:'darwin',openFile:async path=>opened.push(path)});
  const list=files.list();assert.equal(list.files.length,4);
  assert.doesNotMatch(JSON.stringify(list),/dummy-private|\/CUSTOM\/|\.\.\//);
  for(const file of list.files)assert.equal((await files.open(file.id)).opened,true);
  assert.deepEqual(opened,[paths.keyFile,paths.openRouterKeyFile,join(paths.promptPresetDir,'IMAGE_PROMPT_PRESETS.txt'),join(paths.promptPresetDir,'VIDEO_PROMPT_PRESETS.txt')]);
  for(const id of ['../../secret','/etc/passwd','constructor',{},null])await assert.rejects(files.open(id),{status:400});
  await rm(paths.keyFile);await symlink(paths.openRouterKeyFile,paths.keyFile);
  await assert.rejects(files.open('fal'),{status:409});
  for(const options of [{hosted:true,platform:'darwin'},{platform:'linux'}]){
    const disabled=createSettingsFiles({...paths,...options,openFile:()=>assert.fail('Must not open')});
    assert.equal(disabled.list().enabled,false);await assert.rejects(disabled.open('fal'),{status:403});
  }
});
test('settings file routes require CSRF and same-origin requests and do not expose file contents',async t=>{
  const {root,paths}=await fixture(t),opened=[];
  await writeFile(paths.keyFile,'dummy-secret');await writeFile(paths.openRouterKeyFile,'dummy-router');
  const app=await createStudio({...paths,dataDir:join(root,'data'),key:'',openRouterKey:'',autoArchive:false,openSettingsFile:async path=>opened.push(path)});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const config=await(await fetch(base+'/api/bootstrap')).json();
  const post=(id,headers={})=>fetch(base+'/api/settings/files/open',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':config.csrf,...headers},body:JSON.stringify({id})});
  const list=await(await fetch(base+'/api/settings/files')).json();assert.doesNotMatch(JSON.stringify(list),/dummy-secret|dummy-router/);
  assert.equal((await post('fal',{'X-Studio-Token':''})).status,403);
  assert.equal((await post('fal',{Origin:'https://other.example'})).status,403);
  assert.equal((await post('../secret')).status,process.platform==='darwin'?400:403);
  assert.equal(opened.length,0);
  const response=await post('fal');assert.equal(response.status,process.platform==='darwin'?200:403);
  if(process.platform==='darwin')assert.deepEqual(opened,[paths.keyFile]);
  for(const name of ['COMFY_API_KEY_HERE.txt','FAL_API_KEY_HERE.txt','OPENROUTER_API_KEY_HERE.txt'])for(const prefix of ['/','/CUSTOM/'])assert.equal((await fetch(base+prefix+name)).status,404);
});
