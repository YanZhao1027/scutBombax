import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const base=new URL('../cloudflare-live/public/',import.meta.url);
const code=fs.readFileSync(new URL('scan-utils.js',base),'utf8');
const html=fs.readFileSync(new URL('index.html',base),'utf8');
const app=fs.readFileSync(new URL('app.js',base),'utf8');
function loadScanner(secure=true){
  const window={isSecureContext:secure,location:{origin:'https://activity-stage.10273055.xyz'}};
  vm.runInNewContext(code,{window,URL});
  return window.BombaxScanner;
}
test('Only 256-bit activity tokens are accepted, never official payment/authentication QR payloads',()=>{
  const scan=loadScanner();
  assert.equal(scan.validToken('bqx_'+('a0'.repeat(32))),true);
  assert.equal(scan.validToken('  bqx_'+('ab'.repeat(32))+'  '),true);
  const bearer='bqx_'+('ab'.repeat(32));
  assert.equal(scan.validToken('https://activity-stage.10273055.xyz/#pass='+bearer),true);
  assert.equal(scan.normalizeToken('https://activity-stage.10273055.xyz/#pass='+bearer),bearer);
  assert.equal(scan.normalizeToken(bearer),bearer);
  assert.equal(scan.validToken('https://evil.example/#pass='+bearer),false);
  assert.equal(scan.validToken('https://activity-stage.10273055.xyz/?pass='+bearer),false);
  assert.equal(scan.validToken('https://activity-stage.10273055.xyz/#pass='+bearer+'&admin=1'),false);
  assert.equal(scan.validToken('https://activity-stage.10273055.xyz.evil.example/#pass='+bearer),false);
  for(const bad of [
    null,'',42,'bqx_00000','bqx_'+('f'.repeat(63)),
    'bqx_'+('f'.repeat(65)),'bqx_'+('G'.repeat(64)),
    'https://ecardwxnew.scut.edu.cn/',
    'https://activity-stage.10273055.xyz/?token=bqx_'+('f'.repeat(64)),
    'wxp://anything','student-id:000001','BEGIN:VCARD',
    '0'.repeat(64)
  ])assert.equal(scan.validToken(bad),false,String(bad));
});
test('User-friendly camera errors distinguish browser denial, no hardware and busy hardware',()=>{
  const scan=loadScanner();
  assert.match(scan.scannerProblem({name:'NotAllowedError'}),/相机|权限/);
  assert.match(scan.scannerProblem({name:'PermissionDeniedError'}),/相机|权限/);
  assert.match(scan.scannerProblem({name:'SecurityError'}),/相机|权限/);
  assert.match(scan.scannerProblem({name:'NotFoundError'}),/没有找到|设备/);
  assert.match(scan.scannerProblem({name:'NotReadableError'}),/占用/);
  assert.match(scan.scannerProblem({name:'AbortError'}),/中断/);
  assert.match(loadScanner(false).scannerProblem({name:'TypeError'}),/HTTPS/);
});
test('Scanner is only loaded from same-origin assets and trial file import only appears in synthetic mode',()=>{
  assert.match(html,/<script defer src="\/scan-utils\.js"><\/script>/);
  assert.match(html,/<link rel="stylesheet" href="\/scanner\.css">/);
  assert.match(app,/if\(app\.syntheticOnly\)\{\s*const picker/);
  assert.match(app,/await image\.decode\(\)/);
  assert.match(app,/decodeFromImageElement\(image\)/);
  assert.match(app,/URL\.revokeObjectURL\(blobUrl\)/);
  assert.match(app,/validToken\(checkin\)/);
  assert.match(app,/if\(document\.hidden\)cleanScanner\(\)/);
  assert.doesNotMatch(app,/console\.(log|debug|info)\(.*(?:token|result)/);
});

test('Full-viewport camera UI supports continuous scanning, closure, Android Back and camera cleanup',()=>{
  const css=fs.readFileSync(new URL('scanner.css',base),'utf8');
  assert.match(app,/class:'bombax-scanner-fullscreen'/);
  assert.match(app,/role:'dialog','aria-modal':'true'/);
  assert.match(app,/requestFullscreen\(\{navigationUI:'hide'\}\)/);
  assert.match(app,/scannerFullscreenEntered/);
  assert.match(app,/history\.pushState\(\{__bombaxScanner:true\}/);
  assert.match(app,/window\.addEventListener\('popstate'/);
  assert.match(app,/document\.addEventListener\('fullscreenchange'/);
  assert.match(app,/if\(document\.hidden\)cleanScanner\(\)/);
  assert.match(app,/getTracks\?\.\(\)\.forEach\(track=>track\.stop\(\)\)/);
  assert.match(app,/lastAccepted=checkin/);
  assert.match(app,/核销成功 .*本机已成功/);
  assert.match(app,/✕ 退出扫码/);
  assert.match(css,/position:\s*fixed;/);
  assert.match(css,/100dvh/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/object-fit:\s*cover;/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
});

test('One-code staff form offers explicit location choice',()=>{
  assert.match(app,/app\.syntheticOnly\?quickFill:fillGPS/);
  assert.match(app,/填入演示坐标/);
  assert.match(app,/换设备后选择/);
  assert.doesNotMatch(app,/手机需在此区域才能领取签到码/);
});
