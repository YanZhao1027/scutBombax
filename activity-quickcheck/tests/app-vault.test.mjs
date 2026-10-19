import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const base=new URL('../cloudflare-live/public/',import.meta.url);
const bridgeCode=fs.readFileSync(new URL('app-vault.js',base),'utf8');
const app=fs.readFileSync(new URL('app.js',base),'utf8');
const html=fs.readFileSync(new URL('index.html',base),'utf8');

test('ordinary browser has screenshot import but no privileged App vault',async()=>{
  const window={};
  vm.runInNewContext(bridgeCode,{window,setTimeout,clearTimeout,JSON,Promise,Map});
  assert.equal(window.BombaxAppVault.enabled,false);
  await assert.rejects(()=>window.BombaxAppVault.call('save'),/没有 Android 本机票夹/);
  assert.match(app,/async function importPassImage\(file\)/);
  assert.match(app,/new window.ZXingBrowser.BrowserQRCodeReader\(\).decodeFromImageElement\(img\)/);
  assert.match(app,/URL.revokeObjectURL\(blobUrl\)/);
  assert.match(app,/window.BombaxScanner\?\.normalizeToken\(result.getText\(\)\)/);
  assert.match(app,/const restored=await request\('\/api\/pass\/restore'/);
  assert.match(app,/if\(!verified.registration\)throw/);
  assert.match(app,/请务必另外截图保存一码通/);
  assert.match(html,/src="\/app-vault.js"/);
  assert.ok(html.indexOf('src="/app-vault.js"')<html.indexOf('src="/app.js"'));
});

test('native bridge operations never require JS to read or persist bearer secrets',async()=>{
  const pending=[];
  const bridge={postMessage(input){pending.push(JSON.parse(input));}};
  const window={BombaxNativeVault:bridge};
  vm.runInNewContext(bridgeCode,{window,setTimeout,clearTimeout,JSON,Promise,Map});
  const vault=window.BombaxAppVault;
  assert.equal(vault.enabled,true);
  const task=vault.call('save',{eventId:'00000000-0000-0000-0000-000000000000',title:'测试',state:'approved',attended:false,expiresAt:Date.now()+1000});
  assert.equal(pending.length,1);
  assert.equal(pending[0].op,'save');
  assert.equal(Object.keys(pending[0]).includes('token'),false);
  bridge.onmessage({data:JSON.stringify({id:pending[0].id,ok:true,data:{saved:true}})});
  assert.deepEqual(await task,{saved:true});
  const q=vault.call('list');
  bridge.onmessage({data:JSON.stringify({id:pending[1].id,ok:true,data:[{title:'活动',state:'approved'}]})});
  assert.equal((await q)[0].state,'approved');
  await assert.rejects(()=>vault.call('export-all-tokens'),/不支持/);
});

test('the saved activity is reopened only after native cookie restoration and server verification',()=>{
  assert.match(app,/await native.call\('restore',\{eventId:row.eventId\}\)/);
  assert.match(app,/const proof=await request\('\/api\/events\/'.*row.eventId\)/);
  assert.match(app,/if\(!proof.registration\)throw/);
  assert.match(app,/await window.BombaxAppVault.call\('save',\{/);
  assert.match(app,/const reg=snapshot.registration/);
  assert.match(app,/state:reg.state/);
  assert.match(app,/attended:!!reg.attendance/);
  assert.doesNotMatch(app,/localStorage\.setItem\(['"](?:pass|token)/);
  assert.doesNotMatch(app,/console\.(?:log|debug)\([^)]*pass/);
  assert.match(app,/离线记录仅供参考/);
});

test('Android local shelf only opens non-secret #event UUID and server checks attendance',()=>{
  assert.match(app,/fragment\.startsWith\('#event='\)/);
  assert.match(app,/history\.replaceState\(history\.state,'',location\.pathname\+location\.search\)/);
  assert.match(app,/if\(restoredEventId\)/);
  assert.match(app,/if\(event\)await viewEvent\(event\)/);
  assert.doesNotMatch(app,/location\.hash\s*=.*receiptToken/);
});

test('Android same-page #event navigation triggers server revalidation; other hashes do not',()=>{
  const snippet=app.match(/window\.addEventListener\('hashchange',\(\)=>\{[\s\S]*?\n\}\);/);
  assert.ok(snippet,'main-page native shelf needs a live hashchange handler');
  const calls=[];
  let handler;
  const ctx={
    window:{addEventListener:(name,fn)=>{
      assert.equal(name,'hashchange');handler=fn;
    }},
    location:{hash:''},
    launchStart:()=>calls.push('revalidate'),
    start:()=>{}
  };
  vm.runInNewContext(snippet[0],ctx);
  assert.equal(typeof handler,'function');
  ctx.location.hash='#event=1b71a955-dad9-4112-8d01-f575a3c0149e';
  handler();
  assert.equal(calls.length,1);
  ctx.location.hash='#pass=bqx_'+'0'.repeat(64);
  handler();
  assert.equal(calls.length,2);
  for(const other of ['','#x=y','#auth=token']){
    ctx.location.hash=other;handler();
  }
  assert.equal(calls.length,2);
  assert.match(app,/const proof=await request\('\/api\/events\/'/);
  assert.match(app,/if\(!proof.registration\)throw/);
});

test('clearing Android application data, not merely a memory cache, requires an independent screenshot',()=>{
  assert.match(app,/清除 App 应用数据（包括本机活动记录和缓存）/);
  assert.match(app,/恢复时必须联网由服务器查验/);
  assert.doesNotMatch(app,/普通“清除缓存”通常不会删除 App 私有票夹/);
});
