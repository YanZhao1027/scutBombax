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
  assert.match(index,/href="\/platform.css"/);
  const css=load('platform.css');
  assert.match(css,/body:has\(\.public-headline\) #notice:not\(\.error\)/,
    'public cards remain the visual focus; errors stay visible');
  assert.match(index,/src="\/review-grid.js"/);
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
test('review sheet supports shift-range selection, all, approval ticks and only chosen submissions',()=>{
  const window={};
  vm.runInNewContext(review,{window,document:{},Node:Object});
  const f=window.BombaxReviewGrid.createSelection(['a','b','c','d','e']);
  assert.equal(f.length,0);
  f.choose(1,true);
  f.choose(3,true,true);
  assert.deepEqual([...f.selected],['b','c','d']);
  f.setApproval('c',true);f.setApproval('d',true);
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
