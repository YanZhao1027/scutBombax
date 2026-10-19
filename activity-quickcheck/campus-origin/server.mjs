#!/usr/bin/env node
/* Campus-only **anonymous** activity gallery, never a pass or staff origin.
 * Serve on loopback until HTTPS/DNS and campus egress CIDRs are confirmed.
 * Sensitive actions ALWAYS open the Cloudflare synthetic Stage first-party UI.
 */
import http from 'node:http';
import {builtInBanner,bannerKind} from '../cloudflare-live/banner-art.mjs';
const upstream='https://activity-stage.10273055.xyz';
const bind=process.env.BOMBAX_CAMPUS_BIND||'127.0.0.1';
const port=Number(process.env.BOMBAX_CAMPUS_PORT||8789);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid campus preview port');
if(!(bind==='127.0.0.1'||bind==='::1'))throw Error('Public or campus bindings require an independently reviewed TLS gateway');
let cache={events:[],at:0,ready:false},loading=null;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fmt=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
async function fresh(force=false){
  if(!force&&Date.now()-cache.at<20_000&&cache.ready)return cache;
  if(loading)return loading;
  loading=(async()=>{
    try{
      const opts={signal:AbortSignal.timeout(7500),headers:{Accept:'application/json'}};
      const [health,listed]=await Promise.all([
        fetch(upstream+'/api/health',opts),fetch(upstream+'/api/events',opts)
      ]);
      if(!health.ok||!listed.ok)throw Error('Cloudflare API unavailable');
      const [status,result]=await Promise.all([health.json(),listed.json()]);
      if(!status.ready||!status.syntheticOnly||!Array.isArray(result.events))
        throw Error('Synthetic Stage not ready');
      cache={events:result.events.slice(0,100),at:Date.now(),ready:true};return cache;
    }catch(e){cache.ready=false;throw e;}
    finally{loading=null;}
  })();
  return loading;
}
const page=({events,offline=false})=>`<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
<title>花工木棉 · 大学城校内活动预览</title><link rel="stylesheet" href="/campus.css"></head>
<body><header><h1>✿ 花工木棉 · 活动预览</h1>
<a href="${upstream}/">打开 Cloudflare 活动测试站 ↗</a></header>
<main><p class="warning">虚构测试数据 · 校内只读预览。正式报名、上传材料、一码通、审核及扫码均在 Cloudflare HTTPS 站完成。</p>
${offline?'<p class="warning">Cloudflare 连接暂时不稳定，以下为最近缓存的活动介绍；请以线上报名状态为准。</p>':''}
<h2>校园活动</h2><div class="cards">${events.map(e=>{
  const link=upstream+'/#event='+encodeURIComponent(e.id);
  const status=Date.now()<(e.join_starts_at??e.starts_at)?'报名未开始':
    Date.now()>(e.join_ends_at??e.ends_at)?'报名已截止':'正在报名';
  return `<article><img src="/api/events/${encodeURIComponent(e.id)}/banner" alt="活动主题卡通"
   width="1050" height="450"><div class="body"><h3>${esc(e.title)}</h3>
   <p class="pill">${status}</p>
   <p>报名时间：${fmt(e.join_starts_at??e.starts_at)} — ${fmt(e.join_ends_at??e.ends_at)}</p>
   <p>活动时间：${fmt(e.starts_at)} — ${fmt(e.ends_at)}</p>
   <p class="requirements">参与要求：${esc(e.guidelines||'以主办方活动说明为准')}</p>
   <a class="action" href="${link}">前往 CF 正式提交测试报名 →</a></div></article>`;
}).join('')}</div>
<footer>本预览不接收或缓存私密令牌、报名、学生身份资料、审核图片或管理员会话。</footer>
</main></body></html>`;
const style=`*{box-sizing:border-box}body{font:15px/1.65 system-ui,sans-serif;margin:0;background:#f4f8ff;color:#21455f}
header{background:#fff;display:flex;justify-content:space-between;align-items:center;padding:16px clamp(16px,5vw,75px);gap:12px;flex-wrap:wrap;border-bottom:1px solid #d9e9fa}
header h1{font-size:23px;margin:0}a{color:#076ecb}main{max-width:1340px;margin:20px auto;padding:0 18px}
.warning{border:1px solid #f0cb7c;border-radius:10px;background:#fff8e7;padding:10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:18px}
article{background:#fff;border:1px solid #dce6f2;border-radius:18px;overflow:hidden;box-shadow:0 10px 25px #153f6712}
article img{width:100%;aspect-ratio:21/9;object-fit:cover;display:block;background:#e0eafa}
.body{padding:18px}.body h3{font-size:20px;margin:0}.body p{margin:9px 0}
.pill{color:#086ea7;font-weight:bold}.requirements{white-space:pre-line;max-height:70px;overflow:hidden}
.action{display:block;background:#0878e6;text-align:center;text-decoration:none;color:white;
 padding:12px;border-radius:11px;margin-top:16px;font-weight:700}
footer{margin:36px 0;color:#54708a}
`;
const send=(res,status,body,type='text/plain; charset=utf-8',extra={})=>{
  res.writeHead(status,{...headers,'Content-Type':type,...extra});
  res.end(body);
};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const method=req.method;
  if(method!=='GET'&&method!=='HEAD'){
    send(res,405,'校内只读预览不接受报名、凭证或后台操作');return;
  }
  if(url.pathname==='/__lan/health'){
    try{await fresh(true);send(res,200,JSON.stringify({service:'bombax-campus-lan',
      healthy:true,kind:'synthetic-readonly-catalog',upstream:'reachable'}),'application/json; charset=utf-8');}
    catch{send(res,503,JSON.stringify({service:'bombax-campus-lan',healthy:false}),
      'application/json; charset=utf-8');}
    return;
  }
  if(url.pathname==='/campus.css'){
    send(res,200,style,'text/css; charset=utf-8',{'Cache-Control':'public, max-age=3600'});return;
  }
  const banner=url.pathname.match(/^\/api\/events\/([a-f0-9-]{36})\/banner$/);
  if(banner){
    const event=cache.events.find(e=>e.id===banner[1]);
    if(!event){send(res,404,'未找到该活动');return;}
    // Original first-party hand-drawn safe illustration. Custom SVG remains
    // on Cloudflare Stage; never proxy arbitrary SVG or cookies from clients.
    send(res,200,builtInBanner(bannerKind(null,event.title)),
      'image/svg+xml; charset=utf-8',{'Content-Security-Policy':"default-src 'none'; sandbox",
        'Cache-Control':'public, max-age=120'});return;
  }
  if(url.pathname!=='/'){
    send(res,404,'校内预览仅提供公开活动首页和健康探测');return;
  }
  try{
    const state=await fresh();
    send(res,200,page(state),'text/html; charset=utf-8',{
      'Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"
    });
  }catch{
    send(res,503,page({events:cache.events,offline:true}),'text/html; charset=utf-8',{
      'Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"
    });
  }
});
server.listen(port,bind,()=>console.log('BOMBAX_CAMPUS_READONLY_READY localhost:'+port));
