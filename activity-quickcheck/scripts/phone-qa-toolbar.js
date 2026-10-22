/* Local-only role switcher. Never served by Cloudflare worker. */
(function(){
  const boot=()=>{
    const nav=document.createElement('nav');
    nav.id='qa-usb-controls';
    nav.setAttribute('aria-label','USB 虚构数据测试角色');
    Object.assign(nav.style,{background:'#fff1d4',color:'#503901',padding:'12px 14px',
      display:'flex',gap:'14px',flexWrap:'wrap',alignItems:'center',font:'14px system-ui'});
    const badge=document.createElement('strong');
    badge.textContent='USB 实机 QA · 仅虚构数据';nav.append(badge);
    for(const [role,label] of [['scanner','扫码员'],['manual','人工窗口'],['student','学生']]){
      const link=document.createElement('a');link.textContent=label;link.href='/__qa/role/'+role;
      link.style.cssText='color:#134f9f;font-weight:750;text-decoration:underline';
      nav.append(link);
    }
    document.body.prepend(nav);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();
