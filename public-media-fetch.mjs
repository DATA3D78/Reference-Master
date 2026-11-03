import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {Readable} from 'node:stream';
const denied=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(ip,bits,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');denied.addSubnet('2001:db8::',32,'ipv6');denied.addSubnet('2002::',16,'ipv6');denied.addSubnet('2001::',32,'ipv6');
export const publicAddress=({address,family})=>family===4?!denied.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied.check(address,'ipv6');
export function validMediaURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!isIP(u.hostname.replace(/^\[|\]$/g,''))&&u.hostname.includes('.')&&!/\.(?:local|localhost|internal|test|invalid)$/.test(u.hostname);}catch{return false;}}
// Resolve once and pin that public IP to the TLS connection; no credentials or redirects.
export async function fetchPublicMedia(value,{signal,headers:requestHeaders={}}={}){
 if(!validMediaURL(value))throw Error('Unsupported media download URL.');
 const url=new URL(value),addresses=await lookup(url.hostname,{all:true});
 if(!addresses.length||!addresses.every(publicAddress))throw Error('The media URL resolves to a private or reserved address.');
 const chosen=addresses.find(a=>a.family===4)||addresses[0];
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{signal,headers:{'Accept-Encoding':'identity',...(requestHeaders.Range?{Range:requestHeaders.Range}:{})},lookup:(hostname,options,callback)=>options?.all?callback(null,[chosen]):callback(null,chosen.address,chosen.family)},response=>{
   const headers=new Headers();for(const [key,value] of Object.entries(response.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
   resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers}));
  });request.on('error',reject);
 });
}
