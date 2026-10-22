/* Injected ONLY by the local synthetic phone QA server. Camera stays real.
   One simulated expired QR decode is sent through the actual ZXing callback. */
(function(){
  if (!window.ZXingBrowser?.BrowserQRCodeReader) return;
  const Reader=window.ZXingBrowser.BrowserQRCodeReader;
  window.ZXingBrowser.BrowserQRCodeReader=class QaReader extends Reader {
    async decodeFromVideoDevice(device,video,callback){
      const controls=await super.decodeFromVideoDevice(device,video,callback);
      if(!window.__qaInjectedFailure){
        window.__qaInjectedFailure=true;
        setTimeout(async()=>{
          try{
            const res=await fetch('/__qa/expired',{method:'POST',headers:{'X-Bombax-Action':'1'}});
            if(!res.ok)throw Error('Test QR preparation failed');
            const data=await res.json();
            if(!document.hidden)callback({getText:()=>data.token});
          }catch(error){console.warn('USB QA fixture could not trigger scan failure');}
        },1550);
      }
      return controls;
    }
  };
})();
