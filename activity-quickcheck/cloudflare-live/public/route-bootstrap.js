/* Progressive campus route. CANONICAL activity.10273055.xyz home only.
 * Never sends/redirects bearer QR fragments, App vault or staff login pages.
 * A healthy signed Cloudflare heartbeat is necessary, but browser LAN probe
 * must ALSO succeed before switching; otherwise stay on Cloudflare. */
(function(root){
  'use strict';
  if(root.location.hostname!=='activity.10273055.xyz'||
    root.location.pathname!=='/'||root.location.hash||
    root.location.search.includes('force_cloud=1')||
    root.BombaxAppVault?.enabled)return;
  const key='bqx-campus-route-v1';
  try{
    const previous=JSON.parse(root.sessionStorage.getItem(key)||'{}');
    const time=Date.now();
    if(previous.first&&time-previous.first<90_000&&previous.count>=2)return;
    const controller=new AbortController();
    const t=setTimeout(()=>controller.abort(),1600);
    root.fetch('/__route/decision',{cache:'no-store',credentials:'omit',signal:controller.signal})
      .then(async response=>{
        if(!response.ok)return;
        const outcome=await response.json();
        if(outcome.mode!=='probe'||typeof outcome.lanOrigin!=='string')return;
        let lan;
        try{lan=new URL(outcome.lanOrigin);}catch{return;}
        if(lan.protocol!=='https:'||!lan.hostname.endsWith('.10273055.xyz')||
          lan.hostname==='activity.10273055.xyz'||lan.username||lan.password||
          lan.pathname!=='/'||lan.search||lan.hash)return;
        const check=new AbortController(),alarm=setTimeout(()=>check.abort(),1300);
        try{
          const health=await root.fetch(lan.origin+'/__lan/health?ping='+Date.now(),{
            method:'GET',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',
            signal:check.signal
          });
          if(!health.ok)return;
          const status=await health.json();
          if(status.service!=='bombax-campus-lan'||status.healthy!==true)return;
        }finally{clearTimeout(alarm);}
        const next=previous.first&&time-previous.first<90_000
          ?{first:previous.first,count:previous.count+1}
          :{first:time,count:1};
        root.sessionStorage.setItem(key,JSON.stringify(next));
        // Only the *unauthenticated home screen* can switch origins.
        // No staff cookie, #pass token or event-scoped authorization moves.
        root.location.replace(lan.origin+'/');
      })
      .catch(()=>{/* Probe failure: remain on Cloudflare public home. */})
      .finally(()=>clearTimeout(t));
  }catch{/* Storage/privacy-blocked browsers always stay on Cloudflare. */}
})(window);
