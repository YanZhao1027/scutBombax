/* Browser remains usable without the Android vault. The native bridge is origin-limited
 * and never replies with raw tokens, screenshots or Android Keystore material. */
(function(root){
  'use strict';
  const bridge=root.BombaxNativeVault;
  const enabled=typeof bridge?.postMessage==='function';
  const inflight=new Map();
  let sequence=0;
  if(enabled){
    bridge.onmessage=(event)=>{
      try{
        const m=JSON.parse(event.data);
        const req=inflight.get(m.id);
        if(!req)return;
        inflight.delete(m.id);clearTimeout(req.timer);
        if(m.ok)req.resolve(m.data);
        else req.reject(new Error(m.error||'本机票夹操作未成功，请保存二维码截图'));
      }catch{/* Ignore unexpected WebView messages: never expose secrets. */}
    };
  }
  function call(op,data={}){
    if(!enabled)return Promise.reject(new Error('此浏览器没有 Android 本机票夹'));
    if(!['list','save','restore','forget'].includes(op))
      return Promise.reject(new Error('不支持的票夹操作'));
    const id=String(++sequence);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        inflight.delete(id);
        reject(new Error('本机票夹无响应，请保存二维码截图并重试'));
      },6500);
      inflight.set(id,{resolve,reject,timer});
      try{bridge.postMessage(JSON.stringify({id,op,...data}));}
      catch{
        clearTimeout(timer);inflight.delete(id);
        reject(new Error('本机票夹暂不可用，请保存二维码截图'));
      }
    });
  }
  root.BombaxAppVault=Object.freeze({enabled,call});
})(window);
