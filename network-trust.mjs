import * as tls from 'node:tls';

// Use the same trust as the operating system, while retaining Node's defaults
// (including NODE_EXTRA_CA_CERTS). Never turn off certificate verification.
export function configureNetworkTrust(runtime=tls){
  if(typeof runtime.getCACertificates!=='function'||typeof runtime.setDefaultCACertificates!=='function')return false;
  const defaults=runtime.getCACertificates('default');
  const system=runtime.getCACertificates('system');
  if(system.length)runtime.setDefaultCACertificates([...new Set([...defaults,...system])]);
  return true;
}

// Initialize once, before the server creates any outbound TLS connections.
try{
  if(!configureNetworkTrust())console.warn('System certificate trust requires Node 22.19+ or 24.5+. Existing certificate verification remains active.');
}catch{
  console.warn('Could not load system certificates. Existing certificate verification remains active.');
}
