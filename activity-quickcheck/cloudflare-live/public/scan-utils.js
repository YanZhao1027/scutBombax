'use strict';
/**
 * Pure scanner helpers. No camera data, decoded token, or image is logged or
 * persisted. They are kept separate for deterministic browser/Node tests.
 */
(function attachScanHelpers(root){
  const TOKEN=/^bqx_[0-9a-f]{64}$/;
  function normalizeToken(value){
    if(typeof value!=='string')return null;
    const v=value.trim();
    if(TOKEN.test(v))return v;
    // Only this Activity QuickCheck domain's exact one-code URL is accepted.
    // Campus/payment URLs, foreign domains, query-string tokens and arbitrary
    // fragments must never become staff check-in credentials.
    try{
      const url=new URL(v);
      if(!root.location?.origin||url.origin!==root.location.origin||
          url.pathname!=='/'||url.search||url.username||url.password)return null;
      const match=/^#pass=(bqx_[0-9a-f]{64})$/.exec(url.hash);
      return match?match[1]:null;
    }catch{return null;}
  }
  function validToken(value){return normalizeToken(value)!==null;}
  function scannerProblem(error){
    const name=String(error?.name||'');
    const detail=String(error?.message||'');
    if(name==='NotAllowedError'||name==='PermissionDeniedError'||name==='SecurityError'||
        /permission denied|permission dismissed|denied permission/i.test(detail)){
      return '浏览器尚未获准使用相机。请到 Android 设置 → 应用 → 当前浏览器 → 权限 → 相机中允许，再检查网站相机权限；仍不可用请改用人工到场通道。';
    }
    if(name==='NotFoundError'||name==='DevicesNotFoundError'||name==='OverconstrainedError')
      return '没有找到可用摄像头，或选定的摄像头无法使用。请检查设备，必要时改用人工通道。';
    if(name==='NotReadableError'||name==='TrackStartError')
      return '摄像头正被其他应用占用，或无法启动。关闭其他相机应用后重试。';
    if(name==='AbortError')return '摄像头启动被中断，请重试；持续失败请转人工通道。';
    if(!root.isSecureContext)
      return '相机需要有效 HTTPS 安全连接。请不要使用纯 HTTP 校园网地址；改用独立 HTTPS 入口。';
    return '摄像头启动失败。请检查浏览器相机权限或改用人工到场通道。';
  }
  root.BombaxScanner=Object.freeze({validToken,normalizeToken,scannerProblem});
})(typeof window!=='undefined'?window:globalThis);
