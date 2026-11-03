import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEditorExports} from '../editor-export.mjs';

test('staged editor copies are private, size bounded, expire, and clear on close',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fwrd-editor-test-'));let time=100;const store=await createEditorExports({directory,now:()=>time,ttl:10,maxBytes:3,validateMedia:()=>{}});t.after(async()=>{await store.close();await rm(directory,{recursive:true,force:true});});
 const input={data:Buffer.from('ab'),contentType:'image/png',name:'Study.png'};
 const first=await store.prepare(input),id=first.url.split('/').pop();assert.equal((await stat(join(directory,id+'.bin'))).mode&0o777,0o600);
 const second=await store.prepare(input);assert.equal((await readdir(directory)).length,1);await assert.rejects(store.serve({},id),e=>e.status===404);
 time=111;await assert.rejects(store.serve({},second.url.split('/').pop()),e=>e.status===404);assert.equal((await readdir(directory)).length,0);
 await assert.rejects(store.prepare({...input,data:Buffer.from('abcd')}),e=>e.status===413);await assert.rejects(store.prepare({...input,contentType:'text/html'}),e=>e.status===415);
 await store.prepare(input);await store.close();assert.equal((await readdir(directory)).length,0);await assert.rejects(store.prepare(input),e=>e.status===503);
});
