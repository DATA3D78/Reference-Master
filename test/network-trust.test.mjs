import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureNetworkTrust} from '../network-trust.mjs';
import {openRouterTransportError} from '../openrouter-errors.mjs';

test('system trust retains bundled and explicitly configured roots, without replacing them',()=>{
  const defaults=['bundled-root','extra-root','shared-root'],system=['system-root','shared-root'];let configured;
  const runtime={getCACertificates:type=>type==='default'?defaults:system,setDefaultCACertificates:certs=>{configured=certs;}};
  assert.equal(configureNetworkTrust(runtime),true);
  assert.deepEqual(configured,['bundled-root','extra-root','shared-root','system-root']);
  assert.deepEqual(defaults,['bundled-root','extra-root','shared-root']);
  assert.deepEqual(system,['system-root','shared-root']);
});

test('older runtimes and empty system stores preserve their existing verification settings',()=>{
  assert.equal(configureNetworkTrust({}),false);
  assert.equal(configureNetworkTrust({getCACertificates:()=>{throw Error('should not read');}}),false);
  let calls=0;
  assert.equal(configureNetworkTrust({getCACertificates:type=>type==='default'?['root']:[],setDefaultCACertificates:()=>calls++}),true);
  assert.equal(calls,0);
});

test('only known pre-request failures are reported as not sent; response failures remain uncertain',()=>{
  for(const code of ['SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','ENOTFOUND','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT']){
    const error=new TypeError('secret-key data:image/png;base64,SECRET',{cause:Object.assign(new Error('secret-key'),{code})});
    const before=openRouterTransportError(error);
    assert.equal(before.requestNotSent,true,code);assert.match(before.message,/No generation request was sent/);
    assert(!before.message.includes('secret-key'));assert(!before.message.includes('SECRET'));
    const after=openRouterTransportError(error,{readingResponse:true});
    assert.equal(after.requestNotSent,false,code);assert.match(after.message,/may have been processed/);
  }
  for(const error of [Object.assign(new Error(),{name:'TimeoutError'}),new Error('socket',{cause:{code:'UND_ERR_BODY_TIMEOUT'}}),new Error('reset',{cause:{code:'ECONNRESET'}})]){
    assert.equal(openRouterTransportError(error).requestNotSent,false);
    assert.match(openRouterTransportError(error).message,/may have been processed/);
  }
});
