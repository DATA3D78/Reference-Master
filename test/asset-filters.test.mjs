import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetProjectOptions,assetProjectNames,filterAssets} from '../public/assets.js';
test('library filters all or individual projects, combines source filters, and sorts shared media by project or name',()=>{
  const projects=[{id:'one',name:'Zebra'},{id:'two',name:'Alpha'}],deleted=[{id:'gone',name:'Old work'}];
  const make=(id,name,sources,contentType='image/png')=>({id,name,sources,contentType,originalNames:[],createdAt:'2026-10-09T12:00:00Z'});
  const shared=make('shared','B image',[{projectId:'one',type:'upload'},{projectId:'two',type:'generated',modelName:'Model'}]);
  const video=make('video','A video',[{projectId:'one',type:'upload'}],'video/mp4');
  const old=make('old','C image',[{projectId:'gone',type:'upload'}]);
  const assets=[video,old,shared],options=assetProjectOptions(assets,projects,deleted);
  assert.deepEqual(options.map(p=>p.name),['Alpha','Old work (deleted project)','Zebra']);
  assert.equal(assetProjectNames(shared,options),'Alpha · Zebra');
  assert.equal(filterAssets(assets,{},options).length,3);
  assert.deepEqual(filterAssets(assets,{project:'two'},options).map(a=>a.id),['shared']);
  assert.equal(filterAssets(assets,{project:'two',source:'upload'},options).length,0);
  assert.equal(filterAssets(assets,{project:'two',source:'generated',query:'alpha',kind:'image'},options).length,1);
  assert.deepEqual(filterAssets(assets,{sort:'project'},options).map(a=>a.id),['shared','old','video']);
  assert.deepEqual(filterAssets(assets,{sort:'name'},options).map(a=>a.id),['video','shared','old']);
  assert.equal(filterAssets(assets,{project:'gone'},options).length,1);
  assert.deepEqual(assets.map(a=>a.id),['video','old','shared']);
  assert.equal(assetProjectOptions([make('missing','Unknown',[{projectId:'legacy',type:'upload'}])],projects)[1].name,'Project legacy');
});

test('Outfit tab shows only outfit assets and combines with project and media filters',()=>{
 const make=(id,category,project='one')=>({id,category,name:id,contentType:'image/png',originalNames:[],sources:[{type:'generated',projectId:project}],createdAt:'2026-10-29T12:00:00Z'});
 const assets=[make('general','general'),make('outfit','outfit'),make('other','outfit','two')];
 assert.equal(filterAssets(assets).length,3);
 assert.deepEqual(filterAssets(assets,{category:'outfit',project:'one'}).map(a=>a.id),['outfit']);
 assert.equal(filterAssets(assets,{category:'outfit',kind:'video'}).length,0);
 assert.equal(filterAssets(assets,{category:'outfit',source:'upload'}).length,0);
});

test('general assets exclude outfits identified by category or source',()=>{
 const asset=(id,category,sources=[])=>({id,name:id,category,sources,contentType:'image/png',originalNames:[],createdAt:'2026-10-29'});
 const assets=[asset('regular','general'),asset('outfit','outfit'),asset('tagged','general',[{category:'outfit'}])];
 assert.deepEqual(filterAssets(assets,{category:'general'}).map(a=>a.id),['regular']);
 assert.deepEqual(new Set(filterAssets(assets,{category:'outfit'}).map(a=>a.id)),new Set(['outfit','tagged']));
});

test('Outfit audience filters keep general assets separate and All includes unisex',()=>{
 const assets=['women','men','neutral'].map(outfitAudience=>({id:outfitAudience,name:outfitAudience,category:'outfit',outfitAudience,createdAt:'2026-10-29',originalNames:[],sources:[],contentType:'image/png'}));
 assert.equal(filterAssets(assets,{category:'outfit'}).length,3);
 assert.deepEqual(filterAssets(assets,{category:'outfit',outfitAudience:'women'}).map(a=>a.id),['women']);
 assert.deepEqual(filterAssets(assets,{category:'outfit',outfitAudience:'men'}).map(a=>a.id),['men']);
 assert.equal(filterAssets(assets,{category:'general'}).length,0);
});

test('ID category separates character sheets from general and outfit assets with audience subfilters',()=>{
 const assets=[['w','id','women'],['m','id','men'],['g','general','neutral'],['o','outfit','women']].map(([id,category,referenceAudience])=>({id,name:id,category,referenceAudience,contentType:'image/png',sources:[],originalNames:[],createdAt:'2026-10-30'}));
 assert.deepEqual(filterAssets(assets,{category:'id',outfitAudience:'women'}).map(a=>a.id),['w']);
 assert.deepEqual(filterAssets(assets,{category:'id',outfitAudience:'men'}).map(a=>a.id),['m']);
 assert.deepEqual(filterAssets(assets,{category:'general'}).map(a=>a.id),['g']);
 assert.deepEqual(filterAssets(assets,{category:'outfit'}).map(a=>a.id),['o']);
});

test('ID galleries separate Character, Product and Environment while retaining character audience filters',()=>{
 const assets=[['w','character','women'],['m','character','men'],['p','product','neutral'],['e','environment','neutral']].map(([id,referenceType,referenceAudience])=>({id,name:id,category:'id',referenceType,referenceAudience,contentType:'image/png',sources:[],originalNames:[],createdAt:'2026-10-30'}));
 assert.equal(filterAssets(assets,{category:'id',idType:'all'}).length,4);
 assert.deepEqual(filterAssets(assets,{category:'id',idType:'character',outfitAudience:'women'}).map(a=>a.id),['w']);
 for(const [idType,id] of [['product','p'],['environment','e']])assert.deepEqual(filterAssets(assets,{category:'id',idType,outfitAudience:'women'}).map(a=>a.id),[id]);
});

test('Character gallery is separate from general assets and filters women and men',()=>{
 const make=(id,category,characterAudience)=>({id,name:id,category,characterAudience,sources:[{category}],contentType:'image/png',originalNames:[],createdAt:'2026-11-01'});
 const entries=[make('woman','character','women'),make('man','character','men'),make('general','general'),make('sheet','id')];
 assert.deepEqual(filterAssets(entries,{category:'character'}).map(a=>a.id),['man','woman']);
 assert.deepEqual(filterAssets(entries,{category:'character',outfitAudience:'women'}).map(a=>a.id),['woman']);
 assert.deepEqual(filterAssets(entries,{category:'general'}).map(a=>a.id),['general']);
});
