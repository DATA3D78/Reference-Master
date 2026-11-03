const certificateCodes=new Set(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','CERT_REVOKED','ERR_TLS_CERT_ALTNAME_INVALID']);
const connectionCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT']);
const timeoutCodes=new Set(['ETIMEDOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);

export function openRouterTransportError(error,{readingResponse=false}={}){
  // Only use known codes, never expose upstream error messages or request data.
  const codes=new Set();let timedOut=false;
  for(let current=error,depth=0;current&&depth<6;current=current.cause,depth++){
    codes.add(current.code);if(current.name==='TimeoutError')timedOut=true;
  }
  let message,code,requestNotSent=false;
  if(!readingResponse&&[...codes].some(code=>certificateCodes.has(code))){
    code='TLS_CERTIFICATE';requestNotSent=true;
    message='A secure connection to Comfy could not be established because its certificate could not be verified. No generation request was sent. Run Apply Studio Update.command and reopen the studio. If it persists, check your Mac’s date and network certificates; Node 22.19+ or 24.5+ is required for system trust.';
  }else if(!readingResponse&&[...codes].some(code=>connectionCodes.has(code))){
    code='CONNECTION_FAILED';requestNotSent=true;
    message='Could not connect to Comfy. No generation request was sent. Check your internet connection and try again.';
  }else if(timedOut||[...codes].some(code=>timeoutCodes.has(code))){
    code='TIMEOUT';
    message='Comfy did not finish responding before the connection timed out. Check Comfy activity before retrying; the request may have been processed.';
  }else{
    code=readingResponse?'INCOMPLETE_RESPONSE':'CONNECTION_INTERRUPTED';
    message=readingResponse?'Comfy’s response could not be read completely. Check Comfy activity before retrying; the request may have been processed.':'Connection interrupted. Check Comfy activity before retrying; the request may have been processed.';
  }
  return Object.assign(new Error(message),{status:503,code,requestNotSent});
}
