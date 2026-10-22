// Cloudflare same-origin campus static steering: permanently disabled until
// a campus egress CIDR, tunnel hostname, secret and release are configured.
// All /api traffic stays on the SAME Cloudflare Worker and D1/R2 database.
// Never redirect a bearer QR to another hostname.
const fallbackName='bqx_route_fallback';
const refreshName='bqx_route_refresh';
function ipv4(s){
  if(!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s))return null;
  const parts=s.split('.');
  if(parts.some(x=>Number(x)>255||(x.length>1&&x[0]==='0')))return null;
  return parts.reduce((value,p)=>(value<<8n)|BigInt(p),0n);
}
function ipv6(input){
  let s=String(input).toLowerCase();
  if(!/^[0-9a-f:]+$/.test(s)||s.includes(':::'))return null;
  const halves=s.split('::');
  if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(':'):[];
  const right=halves.length===2&&halves[1]?halves[1].split(':'):[];
  if(halves.length===1&&left.length!==8)return null;
  if(halves.length===2&&left.length+right.length>=8)return null;
  const slots=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  if(slots.length!==8||slots.some(x=>!x||x.length>4||!/^[\da-f]+$/.test(x)))return null;
  return slots.reduce((v,x)=>(v<<16n)|BigInt(parseInt(x,16)),0n);
}
export function inCidrs(ip,csv){
  if(!csv||!ip)return false;
  const ipv=ip.includes(':')?6:4,value=ipv===6?ipv6(ip):ipv4(ip);
  if(value===null)return false;
  return csv.split(',').some(part=>{
    const m=/^([^\/\s]+)\/(\d{1,3})$/.exec(part.trim());
    if(!m)return false;
    const family=m[1].includes(':')?6:4;
    if(family!==ipv)return false;
    const width=ipv===4?32:128,prefix=Number(m[2]);
    if(prefix<0||prefix>width)return false;
    const network=ipv===6?ipv6(m[1]):ipv4(m[1]);
    if(network===null)return false;
    const shift=BigInt(width-prefix);
    return (value>>shift)===(network>>shift);
  });
}
const enabled=env=>env.CAMPUS_ROUTING_ENABLED==='true'&&
  env.PUBLIC_ORIGIN==='https://activity.10273055.xyz'&&
  typeof env.CAMPUS_HEARTBEAT_SECRET==='string'&&env.CAMPUS_HEARTBEAT_SECRET.length>=32&&
  /^https:\/\/[a-z0-9.-]+$/i.test(env.CAMPUS_STATIC_ORIGIN||'')&&
  /^[0-9a-f]{40}$/.test(env.CAMPUS_RELEASE_SHA||'')&&
  typeof env.CAMPUS_EGRESS_CIDRS==='string';
const c=(name,req)=>((req.headers.get('Cookie')||'').split(';')
  .map(x=>x.trim()).find(x=>x.startsWith(name+'='))||'').slice(name.length+1);
const addCookies=(res,values)=>{
  const out=new Response(res.body,res);
  for(const value of values)out.headers.append('Set-Cookie',value);
  return out;
};
const refreshCookie=(count,at)=>refreshName+'='+count+'.'+at+
  '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=35';
const bypassCookie=()=>fallbackName+'=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function compareSecret(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let delta=0;
  for(let i=0;i<a.length;i++)delta|=a.charCodeAt(i)^b.charCodeAt(i);
  return delta===0;
}
export async function campusHeartbeat(req,env){
  if(!enabled(env)||req.method!=='POST')return new Response('Not found',{status:404});
  const header=req.headers.get('Authorization');
  if(!header?.startsWith('Bearer ')||!compareSecret(header.slice(7),env.CAMPUS_HEARTBEAT_SECRET))
    return new Response('Not authorized',{status:401,headers:noStore});
  const len=Number(req.headers.get('Content-Length')||0);
  if(len>2048)return new Response('Too large',{status:413});
  let input;
  try{input=JSON.parse((await req.text()).slice(0,2048));}catch{return new Response('Invalid body',{status:400});}
  if(input?.release!==env.CAMPUS_RELEASE_SHA||typeof input.ready!=='boolean')
    return new Response('Release mismatch',{status:409});
  const now=Date.now();
  await env.DB.prepare('INSERT INTO activity_campus_heartbeat(id,release,ready,last_seen_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET release=excluded.release,ready=excluded.ready,last_seen_at=excluded.last_seen_at')
    .bind(input.release,input.ready?1:0,now).run();
  return new Response('{"ok":true}',{headers:{'Content-Type':'application/json',...noStore}});
}
export async function maybeCampusAsset(req,env,url){
  if(!enabled(env)||!['GET','HEAD'].includes(req.method)||url.origin!==env.PUBLIC_ORIGIN)return null;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__campus/')||url.pathname.startsWith('/cdn-cgi/'))return null;
  if(!/^[a-zA-Z0-9_./-]*$/.test(url.pathname)||url.pathname.includes('..'))return null;
  if(c(fallbackName,req)==='1')return null;
  const publicIp=req.headers.get('CF-Connecting-IP');
  if(!inCidrs(publicIp,env.CAMPUS_EGRESS_CIDRS))return null;
  const fresh=await env.DB.prepare('SELECT release,ready,last_seen_at FROM activity_campus_heartbeat WHERE id=1').first();
  if(!fresh||fresh.ready!==1||fresh.release!==env.CAMPUS_RELEASE_SHA||Date.now()-fresh.last_seen_at>90_000)return null;
  // Only count real HTML navigations, never stylesheet/script subrequests.
  const document= (url.pathname==='/'||url.pathname==='/admin/'||url.pathname==='/adminlogin/')&&
    (req.headers.get('Sec-Fetch-Dest')==='document'||(req.headers.get('Accept')||'').includes('text/html'));
  let hits=0,first=Date.now();
  if(document){
    const m=/^(\d)\.(\d{13})$/.exec(c(refreshName,req));
    if(m&&Date.now()-Number(m[2])<30_000){hits=Number(m[1]);first=Number(m[2]);}
    if(hits>=2)return addCookies(await env.ASSETS.fetch(req),[bypassCookie()]);
  }
  const original=new URL(env.CAMPUS_STATIC_ORIGIN);
  const target=new URL(url.pathname,original);
  const headers=new Headers({'Accept':req.headers.get('Accept')||'*/*','X-Bombax-Static-Request':'1'});
  if(env.CAMPUS_ACCESS_CLIENT_ID&&env.CAMPUS_ACCESS_CLIENT_SECRET){
    headers.set('CF-Access-Client-Id',env.CAMPUS_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret',env.CAMPUS_ACCESS_CLIENT_SECRET);
  }
  try{
    const up=await fetch(target.toString(),{method:req.method,headers,redirect:'manual',signal:AbortSignal.timeout(1500)});
    if(!up.ok||up.headers.get('X-Bombax-Static-Release')!==env.CAMPUS_RELEASE_SHA)
      throw new Error('Static origin unhealthy or wrong release');
    const responseHeaders=new Headers({
      'Content-Type':up.headers.get('Content-Type')||'application/octet-stream',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','X-Bombax-Route':'campus'
    });
    const response=new Response(up.body,{status:up.status,headers:responseHeaders});
    return document?addCookies(response,[refreshCookie(hits+1,first)]):response;
  }catch{
    // A broken Tunnel must fail back to CF on the same URL / same cookies.
    return addCookies(await env.ASSETS.fetch(req),[bypassCookie()]);
  }
}
