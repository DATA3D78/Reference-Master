import {test} from 'node:test';
import assert from 'node:assert/strict';
import {llmLibrarySources} from '../public/llm.js';

test('LLM library includes all assets but only compatible favorites from the current project',()=>{
  const assets=[{id:'image',name:'Uploaded image',contentType:'image/png',bytes:100},{id:'video',name:'Clip',contentType:'video/mp4',bytes:200}];
  const job=(projectId,id,favorite,contentType='image/jpeg')=>({id,projectId,modelName:'Model',settings:{prompt:'{"title":"Favorite portrait"}'},tasks:[{outputs:[{id:'output',favorite,contentType,local:{bytes:50}}]}]});
  const jobs=[job('default','mine',true),job('other','theirs',true),job('default','not-favorite',false),job('default','video',true,'video/mp4')];
  const images=llmLibrarySources(assets,jobs,'default');
  assert.deepEqual(images.map(s=>s.key),['asset:image','favorite:mine:output']);
  assert.equal(images[1].name,'Favorite portrait');assert.equal(images[1].url,'/api/media?job=mine&media=output');
  assert.deepEqual(llmLibrarySources(assets,jobs,'default',true).map(s=>s.key),['asset:video','favorite:video:output']);
  assert.deepEqual(llmLibrarySources(assets,jobs,'other').map(s=>s.key),['asset:image','favorite:theirs:output']);
});

test('saved references obey LLM size limits and cannot direct the picker to an external URL',()=>{
  const entries=llmLibrarySources([{id:'a&b',name:'Small',contentType:'image/webp',bytes:10*1024**2,url:'https://unexpected.test/image'},{id:'large',name:'Large',contentType:'image/png',bytes:10*1024**2+1},{id:'audio',name:'Audio',contentType:'audio/mpeg',bytes:20}],[],'default');
  assert.equal(entries.length,2);assert.equal(entries[0].disabled,false);assert.equal(entries[1].disabled,true);assert.match(entries[1].reason,/10 MB/);
  assert.equal(entries[0].url,'/api/assets/media?id=a%26b');
  assert.equal(llmLibrarySources([{id:'v',name:'Large video',contentType:'video/mp4',bytes:201*1024**2}],[],'default',true)[0].disabled,true);
});
