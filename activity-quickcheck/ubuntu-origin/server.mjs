/* Ubuntu is the sole Activity QuickCheck data authority.
 * The existing Worker business logic is reused with local SQLite and filesystem bindings.
 * Listens only on 127.0.0.1; use a separate HTTPS reverse proxy / Cloudflare Tunnel.
 * Student identifiers are self-declared; DeepSeek is opt-in/advisory only. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import worker from '../cloudflare-live/worker.mjs';
import {localBindings} from './storage.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const publicDir=path.join(root,'cloudflare-live/public');
const migrationsDir=path.join(root,'cloudflare-live/migrations');
const DEFAULT_PUBLIC='https://activity.10273055.xyz';
const LAN_PUBLIC='https://activity-lan.10273055.xyz:8443';
const CANONICAL_PASS_ORIGIN='https://activity.10273055.xyz';
const FUNNEL_HOST='zyubuntu-ms-7e51.tailedfb32.ts.net';
const types={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml; charset=utf-8',
  '.png':'image/png','.woff2':'font/woff2','.json':'application/json; charset=utf-8'
};
const securityHeaders={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY','Permissions-Policy':'camera=(self), geolocation=(self)'
};
function safeFile(url){
  const pathname=new URL(url).pathname;
  let name;
  try{name=decodeURIComponent(pathname);}catch{return null;}
  if(name==='/'||name==='/index.html')name='/index.html';
  else if(['/admin','/adminlogin','/my'].includes(name))name+='.html';
  if(name.includes('..')||name.includes('\\')||name.startsWith('//')||!/^\/[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9_-]+)?$/.test(name))return null;
  return path.join(publicDir,name.slice(1));
}
async function staticAssets(req){
  const file=safeFile(req.url);
  if(!file)return new Response('Not found',{status:404});
  let data;
  try{data=await fs.readFile(file);}
  catch(e){if(e.code==='ENOENT'||e.code==='EISDIR')return new Response('Not found',{status:404});throw e;}
  const ext=path.extname(file).toLowerCase();
  const lan=new URL(req.url).hostname==='activity-lan.10273055.xyz';
  const outgoing=lan&&file===path.join(publicDir,'index.html')
    ?Buffer.from(data.toString('utf8').replace('</head>',
      '<script defer src="/lan-watchdog.js"></script></head>')):data;
  return new Response(req.method==='HEAD'?null:new Uint8Array(outgoing),{
    status:200,headers:{'Content-Type':types[ext]||'application/octet-stream',
      'Cache-Control':ext==='.html'?'no-store':'public, max-age=300',
      ...securityHeaders}
  });
}
function requestOrigin(host){
  if(host==='activity.10273055.xyz'||host===FUNNEL_HOST||host===FUNNEL_HOST+':443')return DEFAULT_PUBLIC;
  if(host==='activity-lan.10273055.xyz:8443')return LAN_PUBLIC;
  if(/^(?:127\.0\.0\.1|localhost):[0-9]{4,5}$/.test(host))return DEFAULT_PUBLIC;
  return null;
}
export function createOrigin({dataDir=process.env.BOMBAX_ACTIVITY_DATA||path.join(process.env.HOME||'/tmp','.local/share/bombax-activity-origin'),
  port=Number(process.env.BOMBAX_ACTIVITY_PORT||8790),bind='127.0.0.1',
  liveMode=process.env.BOMBAX_ACTIVITY_MODE==='live',
  deepseekKeyFile=process.env.BOMBAX_DEEPSEEK_KEY_FILE}={}){
  if(!Number.isInteger(port)||port<1024||port>65535||bind!=='127.0.0.1')throw Error('Origin must remain on IPv4 loopback and an unprivileged port');
  const secretFile=process.env.BOMBAX_RELAY_SECRET_FILE;
  const relaySecret=secretFile?readFileSync(secretFile,'utf8').trim():'';
  const bindings=localBindings({dataDir,migrationsDir,publicDir,liveMode});
  if(liveMode&&deepseekKeyFile){
    let raw='';
    try{raw=readFileSync(deepseekKeyFile,'utf8').trim();}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(raw)bindings.DEEPSEEK_API_KEY=raw;
  }
  bindings.SYNTHETIC_IMAGE_SHA256=createHash('sha256').update(bindings.demoImage).digest('hex');
  bindings.ASSETS={fetch:staticAssets};
  const server=http.createServer(async(req,res)=>{
    try{
      const host=(req.headers.host||'').toLowerCase();
      const isFunnel=host===FUNNEL_HOST||host===FUNNEL_HOST+':443';
      if(isFunnel){
        const provided=req.headers['x-bombax-relay-auth'];
        const a=Buffer.from(typeof provided==='string'?provided:'');
        const b=Buffer.from(relaySecret);
        if(!relaySecret||a.length!==b.length||!timingSafeEqual(a,b)){
          res.writeHead(403,{...securityHeaders,'Cache-Control':'no-store'});
          res.end('Relay authorization required');return;
        }
      }
      const publicOrigin=requestOrigin(host);
      if(!publicOrigin){res.writeHead(421,securityHeaders);res.end('Unknown host');return;}
      const localHealth=new URL(req.url,'http://local').pathname==='/__lan/health';
      if(localHealth){
        if(host!=='activity-lan.10273055.xyz:8443'){
          res.writeHead(404,{...securityHeaders,'Cache-Control':'no-store'});res.end();return;
        }
        const origin=req.headers.origin||'';
        const cors=origin==='https://activity.10273055.xyz'?
          {'Access-Control-Allow-Origin':origin,
           'Access-Control-Allow-Private-Network':'true',
           'Vary':'Origin'}:{'Vary':'Origin'};
        if(req.method==='OPTIONS'){
          if(!cors['Access-Control-Allow-Origin']){
            res.writeHead(403,{...securityHeaders,'Cache-Control':'no-store'});res.end();return;
          }
          res.writeHead(204,{...securityHeaders,...cors,
            'Access-Control-Allow-Methods':'GET, OPTIONS',
            'Access-Control-Allow-Headers':'Content-Type',
            'Access-Control-Max-Age':'600','Cache-Control':'no-store'});
          res.end();return;
        }
        if(req.method!=='GET'&&req.method!=='HEAD'){
          res.writeHead(405,{...securityHeaders,'Cache-Control':'no-store'});res.end();return;
        }
        let healthy=false;
        try{healthy=bindings.DB.inspect('SELECT 1 AS alive')[0]?.alive===1;}catch{}
        const response=JSON.stringify({service:'bombax-campus-lan',healthy,
          kind:'synthetic-ubuntu-authoritative',origin:'local-sqlite'});
        res.writeHead(healthy?200:503,{...securityHeaders,...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(req.method==='HEAD'?'':response);return;
      }
      if((Number(req.headers['content-length'])||0)>4*1024*1024){
        res.writeHead(413,securityHeaders);res.end();return;
      }
      const headers=new Headers();
      for(const [key,val] of Object.entries(req.headers)){
        if(val===undefined)continue;
        if(['connection','transfer-encoding','host'].includes(key))continue;
        headers.set(key,Array.isArray(val)?val.join(', '):val);
      }
      if(isFunnel){
        const client=headers.get('X-Bombax-Client-IP')||'';
        headers.set('CF-Connecting-IP',/^[0-9a-fA-F:.]{3,45}$/.test(client)?client:'relay-unknown');
      }else if(!headers.get('CF-Connecting-IP')){
        headers.set('CF-Connecting-IP',req.socket.remoteAddress||'127.0.0.1');
      }
      headers.delete('X-Bombax-Relay-Auth');headers.delete('X-Bombax-Client-IP');
      const webReq=new Request(publicOrigin+req.url,{
        method:req.method,headers,
        ...(req.method!=='GET'&&req.method!=='HEAD'?{body:req,duplex:'half'}:{})
      });
      const resp=await worker.fetch(webReq,{...bindings,PUBLIC_ORIGIN:publicOrigin,PUBLIC_PASS_ORIGIN:CANONICAL_PASS_ORIGIN});
      res.statusCode=resp.status;
      for(const [key,value] of resp.headers.entries()){
        if(['content-length','transfer-encoding','connection'].includes(key))continue;
        if(key==='set-cookie')continue;
        res.setHeader(key,value);
      }
      const cookies=resp.headers.getSetCookie?.()||[];
      if(cookies.length)res.setHeader('Set-Cookie',cookies);
      for(const [key,value] of Object.entries(securityHeaders))if(!res.hasHeader(key))res.setHeader(key,value);
      if(req.method==='HEAD'){res.end();return;}
      const bytes=Buffer.from(await resp.arrayBuffer());
      res.setHeader('Content-Length',bytes.length);res.end(bytes);
    }catch(e){
      console.error('request failed:',e.name); // No query, token, body, IP, or PII in logs.
      if(!res.headersSent)res.writeHead(500,{...securityHeaders,'Cache-Control':'no-store'});
      res.end('Internal server error');
    }
  });
  return {server,bindings,async listen(){
    await new Promise((resolve,reject)=>server.once('error',reject).listen(port,bind,resolve));
    return 'http://'+bind+':'+port;
  },async close(){await new Promise(resolve=>server.close(resolve));bindings.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createOrigin();
  app.listen().then(url=>console.log('BOMBAX_ACTIVITY_READY '+url))
    .catch(err=>{console.error('startup failed:',err.message);process.exitCode=1;});
}
