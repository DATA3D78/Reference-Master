import {timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';

const denied=message=>Object.assign(Error(message),{status:403});
export function createRequestAccess({publicOrigin,proxySecret}={}){
  if(!publicOrigin){
    if(proxySecret)throw Error('A proxy secret requires FRAME_PUBLIC_ORIGIN.');
    return (req,port)=>{
      if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))throw denied('Use the local app address.');
      if(req.headers.origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(req.headers.origin))throw denied('Cross-site requests are not allowed.');
    };
  }
  let url;try{url=new URL(publicOrigin);}catch{throw Error('FRAME_PUBLIC_ORIGIN must be your HTTPS address.');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('FRAME_PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  if(!/^[a-f0-9]{64}$/.test(proxySecret||''))throw Error('Hosted mode requires a 32-byte proxy secret from the deployment setup.');
  const expected=Buffer.from(proxySecret);
  return req=>{
    // Caddy authenticates every path, then overwrites this header. Knowing the
    // public hostname or forging forwarding headers never bypasses that gate.
    const received=Buffer.from(String(req.headers['x-studio-proxy-token']||''));
    if(received.length!==expected.length||!timingSafeEqual(received,expected))throw denied('Access through the private studio sign-in.');
    if(req.headers.host!==url.host||req.headers['x-forwarded-proto']!=='https')throw denied('Use the configured HTTPS studio address.');
    if(req.headers.origin&&req.headers.origin!==url.origin)throw denied('Cross-site requests are not allowed.');
    if(req.headers['sec-fetch-site']==='cross-site')throw denied('Cross-site requests are not allowed.');
  };
}

// Only the executable entry point reads hosting variables. Imported test/local
// servers retain explicit options and do not inherit deployment credentials.
export async function studioRuntime(root,env=process.env){
  const publicOrigin=env.FRAME_PUBLIC_ORIGIN||undefined;
  const host=env.FRAME_HOST||(publicOrigin?'0.0.0.0':'127.0.0.1');
  if(!publicOrigin&&host!=='127.0.0.1')throw Error('Remote binding requires the private hosting configuration.');
  if(!['127.0.0.1','0.0.0.0','::'].includes(host))throw Error('Unsupported FRAME_HOST.');
  const port=Number(env.PORT||4322);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be between 1 and 65535.');
  const dataDir=env.FRAME_DATA_DIR||join(root,'.local'),customDir=env.FRAME_CUSTOM_DIR||join(root,'CUSTOM');
  if(!isAbsolute(dataDir)||!isAbsolute(customDir))throw Error('Storage directories must be absolute paths.');
  let proxySecret;
  if(env.FRAME_PROXY_SECRET_FILE)proxySecret=(await readFile(env.FRAME_PROXY_SECRET_FILE,'utf8')).trim();
  createRequestAccess({publicOrigin,proxySecret});
  return {host,port,publicOrigin,options:{dataDir,comfyKeyFile:join(customDir,'REFERENCE_MASTER_COMFY_KEY.txt'),promptPresetDir:customDir,access:{publicOrigin,proxySecret}}};
}
