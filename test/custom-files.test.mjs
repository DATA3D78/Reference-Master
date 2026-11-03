import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CUSTOM_FILES,customPaths,removeLegacyCustomLinks} from '../custom-files.mjs';
import {createStudio} from '../server.mjs';

delete process.env.FAL_KEY;
delete process.env.OPENROUTER_API_KEY;
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'studio-custom-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'CUSTOM'));
  return root;
}
test('temporary root links preserve edits until restart; cleanup preserves files and unrelated links',async t=>{
  const root=await fixture(t);
  for(const name of CUSTOM_FILES){
    await writeFile(join(root,'CUSTOM',name),'original');
    await symlink(join('CUSTOM',name),join(root,name));
  }
  await writeFile(join(root,'CUSTOM','FAL_API_KEY_HERE.txt'),'dummy-edited-key');
  assert.equal(await readFile(join(root,'FAL_API_KEY_HERE.txt'),'utf8'),'dummy-edited-key');
  await removeLegacyCustomLinks(root);
  for(const name of CUSTOM_FILES){
    await assert.rejects(lstat(join(root,name)),{code:'ENOENT'});
    assert((await lstat(join(root,'CUSTOM',name))).isFile());
  }
  assert.equal(await readFile(join(root,'CUSTOM','FAL_API_KEY_HERE.txt'),'utf8'),'dummy-edited-key');
  await writeFile(join(root,'FAL_API_KEY_HERE.txt'),'separate-file');
  await symlink('FAL_API_KEY_HERE.txt',join(root,'OPENROUTER_API_KEY_HERE.txt'));
  await rm(join(root,'CUSTOM','IMAGE_PROMPT_PRESETS.txt'));
  await symlink('CUSTOM/IMAGE_PROMPT_PRESETS.txt',join(root,'IMAGE_PROMPT_PRESETS.txt'));
  await removeLegacyCustomLinks(root);
  assert.equal(await readFile(join(root,'FAL_API_KEY_HERE.txt'),'utf8'),'separate-file');
  assert((await lstat(join(root,'OPENROUTER_API_KEY_HERE.txt'))).isSymbolicLink());
  assert((await lstat(join(root,'IMAGE_PROMPT_PRESETS.txt'))).isSymbolicLink());
});
test('studio loads and reloads both keys and prompt presets from CUSTOM without serving the files',async t=>{
  const root=await fixture(t),paths=customPaths(root);
  await writeFile(paths.keyFile,'dummy-fal-custom');
  await writeFile(paths.openRouterKeyFile,'dummy-router-custom');
  for(const mode of ['image','video'])await writeFile(join(paths.promptPresetDir,mode.toUpperCase()+'_PROMPT_PRESETS.txt'),`[${mode} preset]\nOriginal ${mode} instructions.\n`);
  const app=await createStudio({...paths,dataDir:join(root,'data'),autoArchive:false,pollMs:3600000,fetchImpl:async()=>{throw Error('No provider calls expected.');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const get=path=>fetch(base+path);
  const bootstrap=await (await get('/api/bootstrap')).json();
  assert(bootstrap.keyConfigured);assert(bootstrap.features.customFolder);
  assert((await (await get('/api/llm/config')).json()).keyConfigured);
  for(const mode of ['image','video']){
    const path='/api/prompt-presets?mode='+mode;
    let config=await (await get(path)).json();
    assert.equal(config.relativePath,'CUSTOM/'+mode.toUpperCase()+'_PROMPT_PRESETS.txt');
    assert.equal(config.presets[0].prompt,`Original ${mode} instructions.`);
    await writeFile(join(paths.promptPresetDir,config.filename),`[${mode} preset]\nUpdated ${mode} instructions.\n`);
    config=await (await get(path)).json();
    assert.equal(config.presets[0].prompt,`Updated ${mode} instructions.`);
    assert(!JSON.stringify(config).includes('dummy-router-custom'));
  }
  for(const name of CUSTOM_FILES)for(const prefix of ['/','/CUSTOM/'])assert.equal((await get(prefix+name)).status,404);
  assert.equal((await get('/custom-files.mjs')).status,404);
  await writeFile(paths.keyFile,'# Cleared\n');
  await writeFile(paths.openRouterKeyFile,'# Cleared\n');
  assert.equal((await (await get('/api/bootstrap')).json()).keyConfigured,false);
  assert.equal((await (await get('/api/llm/config')).json()).keyConfigured,false);
});
