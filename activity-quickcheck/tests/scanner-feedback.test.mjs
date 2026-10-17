import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../cloudflare-live/public/',import.meta.url);
const helper=fs.readFileSync(new URL('scanner-feedback.js',root),'utf8');
const app=fs.readFileSync(new URL('app.js',root),'utf8');
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const css=fs.readFileSync(new URL('scanner.css',root),'utf8');

function scannerFeedback(){
  const window={};
  vm.runInNewContext(helper,{window});
  return window.BombaxCheckinFeedback;
}
function fakeAudio(){
  const notes=[],events=[];
  const ctx={
    currentTime:1.5,state:'suspended',destination:{},
    async resume(){events.push('resume');this.state='running';},
    createOscillator(){
      const tone={
        frequency:{
          setValueAtTime(freq){events.push(['frequency',freq]);},
          exponentialRampToValueAtTime(freq){events.push(['ramp',freq]);}
        },
        connect(){},disconnect(){},
        start(at){notes.push('start');events.push(['start',at]);},
        stop(at){notes.push('stop');events.push(['stop',at]);}
      };
      return tone;
    },
    createGain(){
      return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},
        connect(){},disconnect(){}};
    },
    async close(){events.push('close');this.state='closed';}
  };
  return {ctx,notes,events};
}

test('success numbering increments once per accepted check-in, not from camera frames',()=>{
  const f=scannerFeedback().create();
  assert.equal(f.count,0);
  assert.equal(f.soundEnabled,false);
  const a=f.confirmed(),b=f.confirmed(),c=f.confirmed();
  assert.equal(a.marker,'#001');
  assert.equal(b.marker,'#002');
  assert.equal(c.marker,'#003');
  assert.equal(a.variant,'odd');
  assert.equal(b.variant,'even');
  assert.equal(c.variant,'odd');
  assert.equal(f.count,3);
  assert.deepEqual([a.played,b.played,c.played],[false,false,false]);
  f.dispose();
});

test('audio is disabled by default; explicit opt-in produces one bell per confirmation',async()=>{
  const audio=fakeAudio();
  let constructions=0;
  const f=scannerFeedback().create({audioFactory:()=>{constructions++;return audio.ctx;}});
  f.confirmed();f.confirmed();
  assert.equal(audio.notes.length,0);
  assert.equal(constructions,0,'do not even construct AudioContext before a user tap');
  const enabled=await f.setSound(true);
  assert.equal(enabled,true);
  assert.equal(f.soundEnabled,true);
  assert.equal(constructions,1);
  assert.deepEqual(audio.events.filter(x=>x==='resume'),['resume']);
  const first=f.confirmed();
  assert.equal(first.marker,'#003');
  assert.equal(first.played,true);
  assert.deepEqual(audio.notes,['start','stop'],'a single oscillator starts/stops once');
  const second=f.confirmed();
  assert.equal(second.marker,'#004');
  assert.equal(second.played,true);
  assert.deepEqual(audio.notes,['start','stop','start','stop'],'exactly one new bell per success');
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='frequency').map(x=>x[1]),[880,880]);
  assert.equal(await f.setSound(false),false);
  assert.equal(f.soundEnabled,false);
  const quiet=f.confirmed();
  assert.equal(quiet.count,5);
  assert.equal(quiet.played,false);
  assert.equal(audio.notes.length,4,'no bell after turning switch off');
  f.dispose();
  assert.equal(audio.events.includes('close'),true);
});

test('unsupported, blocked and failing audio never blocks visual success counting',async()=>{
  const unsupported=scannerFeedback().create({audioFactory:()=>null});
  assert.equal(await unsupported.setSound(true),false);
  assert.equal(unsupported.soundEnabled,false);
  assert.equal(unsupported.confirmed().marker,'#001');
  unsupported.dispose();
  const audio=fakeAudio();
  audio.ctx.resume=async()=>{throw Error('autoplay policy')};
  const blocked=scannerFeedback().create({audioFactory:()=>audio.ctx});
  assert.equal(await blocked.setSound(true),false);
  assert.equal(blocked.confirmed().played,false);
  blocked.dispose();
  const broken=fakeAudio();
  broken.ctx.state='running';
  broken.ctx.createOscillator=()=>{throw Error('speaker removed')};
  const f=scannerFeedback().create({audioFactory:()=>broken.ctx});
  assert.equal(await f.setSound(true),true);
  const success=f.confirmed();
  assert.equal(success.marker,'#001');
  assert.equal(success.played,false);
  assert.equal(f.soundEnabled,false);
  f.dispose();
});

test('staff panel and full-screen share a large changing marker and synchronized sound switch',()=>{
  const helperIndex=html.indexOf('src="/scanner-feedback.js"');
  assert.ok(helperIndex>0&&helperIndex<html.indexOf('src="/app.js"'));
  assert.match(app,/window\.BombaxCheckinFeedback\?\.create\(\)/);
  assert.match(app,/function marker\(compact=false\)/);
  assert.match(app,/marker\(true\),hud/);
  assert.match(app,/marker\(\),status/);
  assert.match(app,/role:'switch','aria-checked':'false'/);
  assert.match(app,/feedback\.setSound\(requested\)/);
  assert.match(app,/syncSoundControls\(\)/);
  assert.match(app,/app\.scannerFeedback\?\.dispose\(\)/);
  assert.match(app,/成功铃声：关/);
  assert.match(app,/成功铃声：开/);
  assert.match(css,/\.scan-marker-number/);
  assert.match(css,/\.scan-marker\[data-result="odd"\]/);
  assert.match(css,/\.scan-marker\[data-result="even"\]/);
  assert.match(css,/\.scan-marker\[data-result="error"\]/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(app,/继续对准下一位同学的动态二维码/);
});

test('successful HTTP response gates both the counter and the bell',()=>{
  const area=app.slice(app.indexOf('async function redeem(value){'),app.indexOf('async function startCamera('));
  assert.ok(area.length>1000,'must find scanner callback');
  assert.ok(area.indexOf("const confirmation=await request('/api/events/'+event.id+'/redeem'")>=0);
  assert.ok(area.indexOf('if(confirmation?.ok!==true)throw')>area.indexOf('const confirmation=await request('));
  assert.ok(area.indexOf('const receipt=feedback.confirmed(')>area.indexOf('if(confirmation?.ok!==true)throw'));
  assert.ok(area.indexOf('markSuccess(receipt)')>area.indexOf('const receipt=feedback.confirmed('));
  assert.match(area,/if\(scanning\|\|checkin===lastAccepted\)return/);
  assert.match(area,/markFailed\(\);\s*report\('核销失败/);
  assert.match(area,/successResetTimer=setTimeout\(/);
  assert.match(area,/等待下一位 · 本机已成功核销/);
  assert.match(area,/feedback\.confirmed\(\{audible:!document\.hidden\}\)/);
  assert.doesNotMatch(area,/console\.(?:log|debug|info)\([^)]*checkin/);
});
