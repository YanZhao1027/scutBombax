// Optional Cloudflare PATH-ONLY router. It never acts on private passes,
// /api, login, or organizer paths. This is NOT the Activity app backend.
// Production config remains disabled until campus public egress CIDRs and a
// real HTTPS LAN site are verified; no default campus IPs are guessed.
const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
});
const MAX_AGE_MS=95_000;
const byteHex=a=>Array.from(a).map(x=>x.toString(16).padStart(2,'0')).join('');
function parseIPv4(s){
  const parts=String(s).split('.');
  if(parts.length!==4||parts.some(x=>!/^(?:0|[1-9]\d{0,2})$/.test(x)||Number(x)>255))return null;
  return Uint8Array.from(parts.map(Number));
}
function parseIPv6(s){
  if(typeof s!=='string'||!/^[0-9a-fA-F:.]+$/.test(s))return null;
  if(s.includes('.')){
    const at=s.lastIndexOf(':');const v4=parseIPv4(s.slice(at+1));if(!v4)return null;
    s=s.slice(0,at)+':'+(v4[0]*256+v4[1]).toString(16)+':'+(v4[2]*256+v4[3]).toString(16);
  }
  const parts=s.split('::');if(parts.length>2)return null;
  const a=parts[0]?parts[0].split(':'):[],b=parts[1]?parts[1].split(':'):[];
  if([...a,...b].some(v=>!v||v.length>4||!/^[\da-fA-F]+$/.test(v)))return null;
  const count=a.length+b.length;
  if(parts.length===2&&count>=8||parts.length===1&&count!==8)return null;
  const all=parts.length===2?[...a,...Array(8-count).fill('0'),...b]:a;
  if(all.length!==8)return null;
  const bytes=new Uint8Array(16);
  for(let i=0;i<8;i++){const val=parseInt(all[i],16);bytes[i*2]=val>>8;bytes[i*2+1]=val&255;}
  return bytes;
}
const ipBytes=s=>s?.includes(':')?parseIPv6(s):parseIPv4(s);
export function cidrIncludes(ip,cidr){
  const list=String(cidr).split('/');
  if(list.length!==2||!/^(0|[1-9]\d{0,2})$/.test(list[1]))return false;
  const host=ipBytes(ip),network=ipBytes(list[0]),bits=Number(list[1]);
  if(!host||!network||host.length!==network.length||bits>host.length*8)return false;
  for(let i=0;i<host.length;i++){
    const mask=Math.max(0,Math.min(8,bits-i*8));
    const bitmask=mask?255<<(8-mask)&255:0;
    if((host[i]&bitmask)!==(network[i]&bitmask))return false;
  }
  return true;
}
export function campusAddress(ip,cidrs){
  if(!ip||typeof cidrs!=='string'||cidrs.length>1600)return false;
  return cidrs.split(',').map(x=>x.trim()).filter(Boolean).some(c=>cidrIncludes(ip,c));
}
function validLanOrigin(origin){
  try{
    const url=new URL(origin);
    return url.protocol==='https:'&&url.pathname==='/'&&!url.search&&!url.hash&&
      url.hostname.endsWith('.10273055.xyz')&&url.hostname!=='activity.10273055.xyz'&&
      url.username===''&&url.password===''&&url.port==='';
  }catch{return false;}
}
async function validHeartbeat(req,env){
  const stamp=req.headers.get('X-Bombax-Timestamp')||'';
  const nonce=req.headers.get('X-Bombax-Nonce')||'';
  const sig=req.headers.get('X-Bombax-Signature')||'';
  const node=req.headers.get('X-Bombax-Node')||'';
  if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>35_000||
    !/^[a-f0-9]{32}$/.test(nonce)||!/^v1=[a-f0-9]{64}$/.test(sig)||
    node!==env.CAMPUS_NODE_ID)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.CAMPUS_HEARTBEAT_SECRET),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const input=new TextEncoder().encode('v1\n'+node+'\n'+stamp+'\n'+nonce);
  const received=Uint8Array.from(sig.slice(3).match(/../g).map(x=>parseInt(x,16)));
  if(!(await crypto.subtle.verify('HMAC',key,received,input)))return false;
  // Good enough for heartbeats; KV is eventually consistent, not a user auth system.
  if(await env.CAMPUS_STATUS.get('nonce:'+nonce))return false;
  await env.CAMPUS_STATUS.put('nonce:'+nonce,'1',{expirationTtl:120});
  return true;
}
const cloud=()=>json({mode:'cloud',reason:'default'});
export default {
  async fetch(req,env){
    const url=new URL(req.url);
    if(!url.pathname.startsWith('/__route/'))return new Response('Not found',{status:404});
    if(url.pathname==='/__route/heartbeat'&&req.method==='POST'){
      // Separate signing secret and KV namespace are REQUIRED. No bearer-pass
      // token, staff cookie, or student IP address is persisted in KV.
      if(env.CAMPUS_ROUTE_ENABLED!=='true'||!env.CAMPUS_STATUS||
        typeof env.CAMPUS_HEARTBEAT_SECRET!=='string'||
        env.CAMPUS_HEARTBEAT_SECRET.length<32)return json({error:'routing disabled'},503);
      if(!await validHeartbeat(req,env))return json({error:'unauthorized heartbeat'},403);
      await env.CAMPUS_STATUS.put('healthy',JSON.stringify({
        node:env.CAMPUS_NODE_ID,at:Date.now()
      }),{expirationTtl:120});
      return json({ok:true});
    }
    if(url.pathname==='/__route/decision'&&req.method==='GET'){
      if(env.CAMPUS_ROUTE_ENABLED!=='true'||!env.CAMPUS_STATUS||
        !validLanOrigin(env.CAMPUS_LAN_ORIGIN)||
        !campusAddress(req.headers.get('CF-Connecting-IP'),env.CAMPUS_EGRESS_CIDRS||'')){
        return cloud();
      }
      const row=await env.CAMPUS_STATUS.get('healthy');
      let state;try{state=JSON.parse(row||'null');}catch{state=null;}
      if(!state||state.node!==env.CAMPUS_NODE_ID||!Number.isFinite(state.at)||
        Date.now()-state.at>MAX_AGE_MS||state.at>Date.now()+5000)return cloud();
      return json({mode:'probe',lanOrigin:env.CAMPUS_LAN_ORIGIN,timeoutMs:1300});
    }
    return json({error:'unsupported route'},404);
  }
};
