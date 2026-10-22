import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PRESETS,builtInBanner,sanitizeUploadedSvg,bannerKind} from '../cloudflare-live/banner-art.mjs';

const load=name=>readFileSync(new URL('../cloudflare-live/public/'+name,import.meta.url),'utf8');
const app=load('app.js'),index=load('index.html'),adminLogin=load('adminlogin.html'),
  admin=load('admin.html'),mine=load('my.html'),review=load('review-grid.js');

test('student homepage is a first-screen banner card catalog; admin lives at separate routes',()=>{
  assert.match(index,/href="\/adminlogin"/);
  assert.match(index,/href="\/my"/);
  assert.doesNotMatch(index,/<input|工作人员登录|admin-login-frame|<form/);
  assert.match(index,/href="\/platform.css\?v=20261023-ai-tristate-1"/);
  const css=load('platform.css');
  assert.match(css,/body:has\(\.public-headline\) #notice:not\(\.error\)/,
    'public cards remain the visual focus; errors stay visible');
  assert.match(index,/src="\/review-grid.js\?v=20261023-ai-tristate-2"/);
  assert.match(adminLogin,/工作人员登录/);
  assert.match(admin,/活动管理后台/);
  assert.match(mine,/我的活动与一码通/);
  assert.match(app,/function signupWindow\(event\)/);
  assert.match(app,/class:'activity-card-grid'/);
  assert.match(app,/class:'activity-banner'/);
  assert.match(app,/\/api\/events\/'\+event.id\+'\/banner'/);
  assert.match(app,/报名：/);
  assert.match(app,/参与要求：/);
  assert.match(app,/async function renderAdminHome\(root\)/);
  assert.match(app,/request\('\/api\/admin\/events'\)/);
  assert.match(app,/page\(\)==='public'\|\|page\(\)==='my'/);
  assert.match(app,/location\.assign\('\/admin'\)/);
  assert.match(app,/location\.replace\('\/adminlogin'\)/);
  assert.match(app,/const adminMode=page\(\)==='admin'&&app.me\?\.role==='organizer'/);
  assert.match(app,/if\(adminMode\)await organizerView\(event,root\)/);
  assert.doesNotMatch(index,/<details[^>]*>.*登录/s);
});
test('all five built-in cartoons are original first-party 21:9 SVG vectors',()=>{
  assert.equal(PRESETS.length,5);
  for(const preset of PRESETS){
    const svg=builtInBanner(preset.key);
    assert.match(svg,/^<svg/);
    assert.match(svg,/viewBox="0 0 1050 450"/);
    assert.ok(svg.length<100000);
    assert.doesNotMatch(svg,/<script|<foreignObject|<image|href=|url\(/i);
  }
  assert.equal(bannerKind(undefined,'招新音乐会'),'concert');
  assert.equal(bannerKind(undefined,'志愿活动'),'volunteer');
});
test('backend SVG sanitizer only returns static graphics, with strict 21:9 root',()=>{
  const good='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1050 450">'+
    '<g fill="#114488"><circle cx="30" cy="40" r="20"/><text x="40" y="70">社团招新</text></g></svg>';
  const sanitized=sanitizeUploadedSvg(good);
  assert.match(sanitized,/^<svg xmlns=/);
  assert.match(sanitized,/社团招新/);
  for(const attack of [
    '<svg viewBox="0 0 1050 450"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1050 450" onload="alert(1)"></svg>',
    '<svg viewBox="0 0 1050 450"><foreignObject/></svg>',
    '<svg viewBox="0 0 1050 450"><use href="#a"/></svg>',
    '<svg viewBox="0 0 1050 450"><image href="https://evil.invalid/pixel"/></svg>',
    '<svg viewBox="0 0 1050 450"><path d="M1 2" style="background:url(//evil)"/></svg>',
    '<svg viewBox="0 0 1050 450"><rect fill="url(#id)"/></svg>',
    '<svg viewBox="0 0 1000 700"><rect/></svg>',
    '<svg viewBox="0 0 1050 450"><animate attributeName="opacity"/></svg>',
    '<!DOCTYPE svg><svg viewBox="0 0 1050 450"></svg>',
    '<svg viewBox="0 0 1050 450"><text>&lt;script&gt;</text></svg>',
    '<svg viewBox="0 0 1050 450"><rect id="my-id"/></svg>',
    '<svg viewBox="0 0 1050 450"><g><rect/></svg>'
  ])assert.throws(()=>sanitizeUploadedSvg(attack));
  assert.throws(()=>sanitizeUploadedSvg('<svg viewBox="0 0 1050 450"></svg>'+' '.repeat(100000)));
});
test('real evidence uploads use native image decoding and JPEG quality 75 with bounded canvas memory',async()=>{
  const start=app.indexOf('const MAX_EVIDENCE_SOURCE_BYTES=');
  const end=app.indexOf('\nasync function studentView(',start);
  assert.ok(start>=0&&end>start,'compression helper must remain isolated and testable');
  const helper=app.slice(start,end);
  let closed=0,canvasCreated=0,encoding=null,drawn=null;
  const canvas={width:0,height:0,
    getContext(kind,options){
      assert.equal(kind,'2d');assert.deepEqual({...options},{alpha:false});
      return {fillStyle:'',fillRect(){},drawImage(_source,_x,_y,width,height){drawn={width,height};}};
    },
    toBlob(callback,type,quality){encoding={type,quality};callback({type:'image/jpeg',size:512});}
  };
  const sandbox={
    window:{createImageBitmap:async()=>({width:2000,height:4000,close(){closed++;}})},
    document:{createElement(tag){canvasCreated++;assert.equal(tag,'canvas');return canvas;}},
    URL:{createObjectURL(){throw new Error('native bitmap path should not create an object URL');},revokeObjectURL(){}},
    Image:function Image(){}
  };
  vm.runInNewContext(helper+'\nthis.__compressEvidenceImage=compressEvidenceImage;',sandbox);
  const result=await sandbox.__compressEvidenceImage({type:'image/png',size:1200000});
  assert.equal(encoding.type,'image/jpeg');
  assert.equal(encoding.quality,0.75);
  assert.deepEqual(drawn,{width:1600,height:3200},'very large screenshots should be downscaled before encoding');
  assert.equal(result.width,1600);assert.equal(result.height,3200);
  assert.equal(result.blob.type,'image/jpeg');assert.equal(result.compressedBytes,512);
  assert.equal(closed,1,'native ImageBitmap must be released');
  assert.equal(canvas.width,0);assert.equal(canvas.height,0,'canvas backing memory must be released');
  assert.equal(canvasCreated,1);
  assert.match(app,/compressEvidenceImage\(file\)/);
  assert.match(app,/从手机相册选择/);
  assert.match(app,/打开相机拍照/);
  assert.match(app,/aiConsent:aiConsent\.checked/);
  assert.match(app,/raw:compressed\.blob,headers:\{'Content-Type':'image\/jpeg'\}/);
  assert.match(app,/path\.endsWith\('\/upload'\)\?60000/);
  assert.doesNotMatch(app,/本轮上传测试访问码/);
  assert.doesNotMatch(app,/X-Bombax-Upload-Test-Key/);
  assert.doesNotMatch(helper,/import\s+.*(?:sharp|jimp|pica|browser-image-compression)/i,
    'no extra image-decoder/compression package should be loaded');
});

test('evidence compression rejects oversized source files before decoding and releases oversized bitmaps',async()=>{
  const start=app.indexOf('const MAX_EVIDENCE_SOURCE_BYTES=');
  const end=app.indexOf('\nasync function studentView(',start);
  const helper=app.slice(start,end);
  let decodeCalls=0,closed=0,canvasCalls=0;
  const sandbox={
    window:{createImageBitmap:async()=>{decodeCalls++;return {width:6000,height:3000,close(){closed++;}};}},
    document:{createElement(){canvasCalls++;return {width:0,height:0};}},
    URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},Image:function Image(){}
  };
  vm.runInNewContext(helper+'\nthis.__compressEvidenceImage=compressEvidenceImage;',sandbox);
  let oversized;
  try{await sandbox.__compressEvidenceImage({type:'image/png',size:13*1024*1024});}
  catch(error){oversized=error;}
  assert.match(oversized?.message||'',/12 MB/);
  assert.equal(decodeCalls,0,'oversized input must be rejected before decoding');
  let dimensions;
  try{await sandbox.__compressEvidenceImage({type:'image/jpeg',size:1000});}
  catch(error){dimensions=error;}
  assert.match(dimensions?.message||'',/分辨率过高/);
  assert.equal(decodeCalls,1);assert.equal(closed,1);
  assert.equal(canvasCalls,0,'overlarge decoded dimensions must be rejected before canvas allocation');
});

test('review sheet supports shift-range selection, all, approval ticks and only chosen submissions',()=>{
  const window={};
  vm.runInNewContext(review,{window,document:{},Node:Object});
  const f=window.BombaxReviewGrid.createSelection(['a','b','c','d','e']);
  assert.equal(f.length,0);
  f.choose(1,true);
  f.choose(3,true,true);
  assert.deepEqual([...f.selected],['b','c','d']);
  f.setApproval('c',true);f.setApproval('d',true);
  assert.equal(f.unassigned,1,'selecting a row alone must never mean reject');
  assert.equal(f.decisions(()=>'').length,2);
  f.setRejection('b',true);
  assert.equal(f.unassigned,0,'reject is a separate explicit checkbox');
  assert.deepEqual(JSON.parse(JSON.stringify(f.decisions(id=>'reason '+id))),[
    {registrationId:'b',state:'rejected',reason:'reason b'},
    {registrationId:'c',state:'approved',reason:'reason c'},
    {registrationId:'d',state:'approved',reason:'reason d'}
  ]);
  f.choose(2,false,true);
  assert.equal(f.length,1);
  assert.equal(f.selected.has('b'),true);
  assert.equal(f.approved.has('c'),false);
  f.all(true);assert.equal(f.length,5);
  f.all(false);assert.equal(f.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.decisions(()=>''))),[]);
  assert.match(review,/驳回 ✕/);
  assert.match(review,/rejectedInputs/);
  assert.match(review,/selection\.unassigned/);
  assert.match(review,/ArrowRight/);assert.match(review,/ArrowLeft/);
  assert.match(review,/className/);
  assert.match(review,/\/review-batch/);
  assert.match(review,/window\.confirm/);
  assert.doesNotMatch(review,/innerHTML\s*=/);
});

test('Cloudflare clean staff and one-code routes reach ASSETS unchanged to avoid .html redirect loops',async()=>{
  const api=(await import('../cloudflare-live/worker.mjs')).default;
  const env={ASSETS:{fetch:async req=>new Response(new URL(req.url).pathname)}};
  for(const route of ['/adminlogin','/admin','/my','/']){
    const response=await api.fetch(new Request('https://activity-stage.10273055.xyz'+route),env);
    assert.equal(response.status,200);
    assert.equal(await response.text(),route,'must not internally request *.html (Cloudflare redirects to clean URL)');
  }
});

test('fast public bootstrap never waits for ZXing or staff authentication',()=>{
  const home=load('index.html'),login=load('adminlogin.html');
  assert.doesNotMatch(home,/<script[^>]+src="\/zxing\.js"/);
  assert.doesNotMatch(login,/<script[^>]+src="\/zxing\.js"/);
  assert.match(app,/async function loadQrReader\(\)/);
  assert.match(app,/Promise\.all\(\[/);
  assert.match(app,/staffPage\?request\('\/api\/me'\):Promise\.resolve\(\{user:null\}\)/);
  assert.match(app,/AbortSignal\.timeout\(method==='GET'\?12000:path\.endsWith\('\/upload'\)\?60000:path\.endsWith\('\/ai-review'\)\?75000:25000\)/);
  assert.match(app,/async function launchStart\(\)/);
  assert.match(app,/receipt-rejected-banner/);
  assert.match(app,/POST|method:'POST'/);
  const roles=load('staff-roles.js');
  assert.match(roles,/staff-roles/);
  assert.match(roles,/input\.type='checkbox'/);
  assert.match(roles,/window\.confirm/);
  assert.doesNotMatch(roles,/innerHTML/);
});
test('campus read-only origin never accepts receipts or user data and binds loopback only',()=>{
  const file=readFileSync(new URL('../campus-origin/server.mjs',import.meta.url),'utf8');
  assert.match(file,/127\.0\.0\.1/);
  assert.match(file,/if\(method!=='GET'&&method!=='HEAD'\)/);
  assert.match(file,/__lan\/health/);
  assert.match(file,/Cloudflare HTTPS|Cloudflare/);
  assert.match(file,/activity-stage\.10273055\.xyz/);
  assert.match(file,/old|cache/);
});

test('rejected student reapply renders without a temporal dead zone for attendance',()=>{
  const student=app.slice(app.indexOf('async function studentView(event,root){'),
    app.indexOf('async function studentViewReload(',app.indexOf('async function studentView(event,root){')));
  const declared=student.indexOf('const attendance=reg.attendance;');
  const condition=student.indexOf("if(reg.state==='rejected'&&!attendance)");
  assert.ok(declared>=0&&condition>declared,
    'attendance must be read before rejected-state reapply controls use it');
  assert.equal((student.match(/const attendance=reg.attendance;/g)||[]).length,1);
  assert.match(student,/oldReceiptRevoked/);
  assert.match(student,/newPassIssued/);
  assert.match(student,/报名已驳回/);
  assert.match(student,/if\(snapshot\.reissued\)/);
  assert.match(student,/旧二维码已永久作废/);
  assert.match(student,/receipt-rejected-banner/);
});
