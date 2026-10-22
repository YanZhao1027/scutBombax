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
        start(at){notes.push('start');events.push(['start',at,this.type]);},
        stop(at){notes.push('stop');events.push(['stop',at]);}
      };
      return tone;
    },
    createGain(){
      return {gain:{setValueAtTime(v){events.push(['gainSet',v]);},exponentialRampToValueAtTime(v){events.push(['gainRamp',v]);}},
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
  assert.deepEqual(audio.notes,['start','stop','start','stop'],'one two-note 8-bit chime per successful response');
  const second=f.confirmed();
  assert.equal(second.marker,'#004');
  assert.equal(second.played,true);
  assert.equal(audio.notes.length,8,'two short notes per success, never repeated per frame');
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='frequency').map(x=>x[1]),[880,1320,880,1320]);
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='start').map(x=>x[2]),
    ['square','square','square','square'],'eight-bit-style square oscillators, not quiet sine waves');
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='gainRamp'&&x[1]>0.1).map(x=>x[1]),
    [0.28,0.28,0.28,0.28],'success is about four times the previous peak amplitude');
  assert.equal(await f.setSound(false),false);
  assert.equal(f.soundEnabled,false);
  const quiet=f.confirmed();
  assert.equal(quiet.count,5);
  assert.equal(quiet.played,false);
  assert.equal(audio.notes.length,8,'no new sound after turning switch off');
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
  assert.ok(helperIndex>0&&helperIndex<html.indexOf('src="/app.js'));
  assert.match(app,/window\.BombaxCheckinFeedback\?\.create\(\)/);
  assert.match(app,/function marker\(compact=false\)/);
  assert.match(app,/marker\(true\),hud/);
  assert.match(app,/marker\(\),status/);
  assert.match(app,/role:'switch','aria-checked':'false'/);
  assert.match(app,/feedback\.setSound\(requested\)/);
  assert.match(app,/syncSoundControls\(\)/);
  assert.match(app,/app\.scannerFeedback\?\.dispose\(\)/);
  assert.match(app,/成功\/错误提示音：关/);
  assert.match(app,/成功\/错误提示音：开/);
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
  assert.match(area,/markFailed\(\);\s*feedback\.rejected\(\{audible:!document\.hidden\}\);\s*report\('核销失败/);
  assert.match(area,/successResetTimer=setTimeout\(/);
  assert.match(area,/等待下一位 · 本机已成功核销/);
  assert.match(area,/feedback\.confirmed\(\{audible:!document\.hidden\}\)/);
  assert.doesNotMatch(area,/console\.(?:log|debug|info)\([^)]*checkin/);
});

test('failed scans use a different low-pitch two-pulse alert, never count as successful',async()=>{
  const audio=fakeAudio();
  const f=scannerFeedback().create({audioFactory:()=>audio.ctx});
  assert.equal(f.rejected().played,false);
  assert.equal(f.count,0);
  assert.equal(await f.setSound(true),true);
  const failed=f.rejected();
  assert.equal(failed.count,0);
  assert.equal(failed.played,true);
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='frequency').map(x=>x[1]),[698,523]);
  assert.equal(audio.notes.length,4,'two prominent midrange 8-bit alert pulses');
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='gainRamp'&&x[1]>0.1).map(x=>x[1]),
    [0.36,0.36],'failures get louder peaks than success to remain audible on phone speakers');
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='start').map(x=>x[2]),
    ['square','square']);
  const accepted=f.confirmed();
  assert.equal(accepted.marker,'#001');
  assert.equal(f.count,1);
  assert.equal(f.rejected().count,1);
  assert.equal(f.count,1);
  assert.equal(await f.setSound(false),false);
  assert.equal(f.rejected().played,false);
  f.dispose();
});
test('invalid or unauthorized staff scans ring only on a throttled user-visible failure',()=>{
  const area=app.slice(app.indexOf('async function redeem(value){'),app.indexOf('async function startCamera('));
  assert.match(area,/if\(lastAttempt!==checkin\|\|Date\.now\(\)-lastAttemptAt>2000\)\{/);
  assert.match(area,/feedback\.rejected\(\{audible:!document\.hidden\}\)/);
  assert.match(area,/feedback\.confirmed\(\{audible:!document\.hidden\}\)/);
});

test('opt-in staff sound previews play both tones without ever changing check-in number',async()=>{
  const audio=fakeAudio();
  const f=scannerFeedback().create({audioFactory:()=>audio.ctx});
  assert.equal(f.preview('failure').played,false,'muted by default');
  assert.equal(audio.notes.length,0,'no sound nodes created before explicit opt-in');
  assert.equal(f.count,0);
  assert.equal(await f.setSound(true),true);
  const failure=f.preview('failure');
  assert.equal(failure.played,true);
  assert.equal(failure.count,0);
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='frequency').map(x=>x[1]),[698,523]);
  assert.equal(audio.notes.length,4,'two low error pulses');
  const success=f.preview('success');
  assert.equal(success.played,true);
  assert.equal(success.count,0);
  assert.equal(f.count,0,'previews cannot advance successful marker');
  assert.deepEqual(audio.events.filter(x=>Array.isArray(x)&&x[0]==='frequency').map(x=>x[1]),[698,523,880,1320]);
  assert.equal(audio.notes.length,8,'one two-note chiptune success cue');
  assert.equal(f.preview('arbitrary').played,false,'unsupported preview outcome is silent');
  assert.equal(f.preview('failure',{audible:false}).played,false,'hidden page never plays sample');
  assert.equal(f.count,0);
  assert.equal(await f.setSound(false),false);
  assert.equal(f.preview('failure').played,false);
  assert.equal(f.count,0);
  f.dispose();
});

test('8-bit motifs remain brief, separated and non-clipping without overlapping voices',async()=>{
  const audio=fakeAudio();
  const f=scannerFeedback().create({audioFactory:()=>audio.ctx});
  assert.equal(await f.setSound(true),true);
  for(const kind of ['success','failure']){
    const before=audio.events.length;
    assert.equal(f.preview(kind).played,true);
    const batch=audio.events.slice(before);
    const starts=batch.filter(x=>Array.isArray(x)&&x[0]==='start');
    const stops=batch.filter(x=>Array.isArray(x)&&x[0]==='stop');
    const volume=batch.filter(x=>Array.isArray(x)&&x[0]==='gainRamp'&&x[1]>0.1);
    assert.equal(starts.length,2);
    assert.equal(stops.length,2);
    assert.equal(volume.length,2);
    assert.ok(stops[0][1]<starts[1][1],'no overlapping waveforms that can clip');
    assert.ok(stops[1][1]-starts[0][1]<0.52,'cue remains short and responsive');
    assert.ok(volume.every(x=>x[1]>0.2&&x[1]<0.45),'amplitude increased without full-scale clipping');
    assert.ok(starts.every(x=>x[2]==='square'));
    assert.equal(f.count,0,'preview must not affect check-in success count');
  }
  f.dispose();
});

test('staff-only preview controls are opt-in, hidden by details, never call backend or count',()=>{
  const scanner=app.slice(app.indexOf("}else if(duty==='scanner'){"),app.indexOf("function cleanScanner(){"));
  const begin=scanner.indexOf('function previewSound(kind){');
  const end=scanner.indexOf('    slot.append(el(\'div\',{class:\'row scanner-action-row\'}',begin);
  assert.ok(begin>0&&end>begin,'scanner code includes preview handler');
  const handler=scanner.slice(begin,end);
  assert.match(handler,/if\(!feedback.soundEnabled\)/);
  assert.match(handler,/feedback.preview\(kind,\{audible:!document.hidden\}\)/);
  assert.doesNotMatch(handler,/request\(|\/api\/|feedback.confirmed\(|markSuccess\(|feedback.rejected\(/);
  assert.match(scanner,/现场试听提示音（不核销、不计数）/);
  assert.match(scanner,/button\('试听成功铃声',\(\)=>previewSound\('success'\)/);
  assert.match(scanner,/button\('试听失败提示音',\(\)=>previewSound\('failure'\)/);
  assert.match(scanner,/el\('details',\{class:'sound-preview'\}/);
});
