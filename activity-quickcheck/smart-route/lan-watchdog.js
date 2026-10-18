/* Include on the LAN-hosted site, not on the Cloudflare public fallback.
 * After rapid LAN refreshes or health failures, force Cloudflare fallback. */
(function(root){
  if(root.location.hostname!=='activity-lan.10273055.xyz')return;
  const cloud='https://activity.10273055.xyz/?force_cloud=1';
  if(root.location.hash?.startsWith('#pass='))return; // Never forward private QR fragments
  const key='bqx-lan-reload-watch-v1',time=Date.now();
  try{
    const prev=JSON.parse(root.sessionStorage.getItem(key)||'{}');
    const result=prev.first&&time-prev.first<25_000
      ?{first:prev.first,count:prev.count+1}:{first:time,count:1};
    root.sessionStorage.setItem(key,JSON.stringify(result));
    if(result.count>=3){root.location.replace(cloud);return;}
  }catch{/* No storage: use live health fallback only. */}
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),1300);
  root.fetch('/__lan/health',{credentials:'omit',cache:'no-store',signal:ctrl.signal})
    .then(async response=>{
      if(!response.ok)throw Error('unhealthy');
      const value=await response.json();
      if(value.service!=='bombax-campus-lan'||value.healthy!==true)throw Error('unhealthy');
    })
    .catch(()=>root.location.replace(cloud))
    .finally(()=>clearTimeout(timer));
})(window);
