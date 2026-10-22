/* Cloudflare is a stateless ingress ONLY.
 * Ubuntu owns registration, staff, QR, audit, and all material bytes.
 * Relay auth is a Wrangler secret; no D1, R2 or second data store here.
 * Tailscale Funnel is a 443/TLS transport fallback for restricted 7844 networks. */
const ubuntu='https://zyubuntu-ms-7e51.tailedfb32.ts.net';
const hostnames=new Set([
  'activity.10273055.xyz',
  'activity-relay-test.10273055.xyz',
  'bombax-activity-relay-test.ryowenth.workers.dev'
]);
const localMode=()=>new Response(JSON.stringify({mode:'cloud',reason:'lan-not-configured'}),{
  headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});
function unavailable(pathname){
  if(pathname==='/'){
    const body='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>花工木棉 · 活动平台维护</title><body style="font:16px/1.8 system-ui;background:#f5f8ff;color:#183b59;max-width:600px;margin:12vh auto;padding:28px"><h1>花工木棉活动平台</h1><p>Ubuntu 主服务器已建立，但校外 HTTPS 回源通道尚未恢复。当前暂停所有报名、审核与签到提交。</p><p>本站不会将请求临时写入另一套数据库，避免二维码和到场记录分叉。</p><p>请稍后重新访问。校内独立 HTTPS 入口也正在验收中。</p></body></html>';
    return new Response(body,{status:503,headers:{
      'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'60'
    }});
  }
  return new Response(JSON.stringify({ok:false,ready:false,syntheticOnly:true,error:'Ubuntu 校外回源暂不可用'}),{
    status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'60'}
  });
}
const error=(status,message)=>new Response(message,{status,headers:{
  'Content-Type':'text/plain; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
}});
export default {
  async fetch(request,env){
    const requested=new URL(request.url);
    if(!hostnames.has(requested.hostname)||requested.protocol!=='https:')return error(421,'Unknown public host');
    if(requested.pathname==='/__route/decision')return localMode();
    if(!['GET','HEAD','POST','PATCH','DELETE','OPTIONS'].includes(request.method))return error(405,'Method not supported');
    if(!env.RELAY_SECRET||env.RELAY_SECRET.length<48)return error(503,'Origin route is not configured');
    const target=new URL(requested.pathname+requested.search,ubuntu);
    const headers=new Headers(request.headers);
    headers.delete('X-Bombax-Relay-Auth');
    headers.delete('X-Bombax-Client-IP');
    headers.set('X-Bombax-Relay-Auth',env.RELAY_SECRET);
    const ip=request.headers.get('CF-Connecting-IP')||'';
    headers.set('X-Bombax-Client-IP',/^[0-9a-fA-F:.]{3,45}$/.test(ip)?ip:'relay-unknown');
    headers.delete('Host');
    let result;
    try{
      result=await fetch(target.toString(),{
        method:request.method,headers,
        ...(request.method==='GET'||request.method==='HEAD'?{}:{body:request.body}),
        redirect:'manual'
      });
    }catch{return unavailable(requested.pathname);}
    if(result.status===530||result.status===523||result.status===522||result.status===521)return unavailable(requested.pathname);
    const outgoing=new Headers(result.headers);
    outgoing.set('Referrer-Policy','no-referrer');
    outgoing.set('X-Content-Type-Options','nosniff');
    outgoing.delete('Server');
    return new Response(result.body,{status:result.status,statusText:result.statusText,headers:outgoing});
  }
};
