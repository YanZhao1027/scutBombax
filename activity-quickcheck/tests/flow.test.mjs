import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { newId,hashPassword,makeCsv,distanceMeters } from '../db.mjs';

function setup(){
  const dir=mkdtempSync(path.join(tmpdir(),'bombax-quickcheck-'));
  const app=createApp({dbPath:path.join(dir,'demo.sqlite'),uploadDir:path.join(dir,'uploads')});
  return {dir,...app};
}
function org(db,name){
  const id=newId();
  db.prepare('INSERT INTO users (id,username,password_hash,role,display_name,created_at) VALUES (?,?,?,?,?,?)')
    .run(id,name,hashPassword('VeryStrongTestPass123!'),'organizer','Organizer Fixture',Date.now());
  return id;
}
function now(){return Date.now();}
function campusEvent(){
  return {title:'Test Event',description:'synthetic test only',latitude:23.1,longitude:113.3,
    radiusM:200,startAt:now()-3000,endAt:now()+3600000,requireAttachment:true};
}
async function run(){
  const app=setup();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const clients={};
  async function api(pathName,{method='GET',data,as='anon',headers={},body}={}){
    const h={...headers};
    if(method!=='GET')h['X-Bombax-Action']='1';
    if(data!==undefined){h['Content-Type']='application/json';body=JSON.stringify(data);}
    if(clients[as])h.Cookie=clients[as];
    const res=await fetch(base+pathName,{method,headers:h,body});
    const setCookie=res.headers.get('set-cookie');
    if(setCookie)clients[as]=setCookie.split(';')[0];
    const t=res.headers.get('content-type')||'';
    const value=t.includes('json')?await res.json():t.includes('text/csv')?await res.text():await res.arrayBuffer();
    return {status:res.status,value,headers:res.headers};
  }
  return {app,base,api,clients,async close(){await new Promise(r=>app.server.close(r));app.db.close();rmSync(app.dir,{recursive:true,force:true})}};
}
test('Distance and CSV quote injection prevention',()=>{
  assert.equal(distanceMeters(23.1,113.3,23.1,113.3),0);
  assert.ok(distanceMeters(23.1,113.3,23.2,113.3)>11000);
  const csv=makeCsv([['Name','Student ID'],['=HYPERLINK("bad")','+123']]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+123"));
});
test('Full flow: owner staff, private attachments, geo, single-use scan, scoped export',async t=>{
  const ctx=await run();t.after(()=>ctx.close());
  const {api,app}=ctx;
  org(app.db,'org_test');
  org(app.db,'staff_test');
  for(const name of ['student_a','student_b']){
    const out=await api('/api/register',{method:'POST',data:{username:name,displayName:name,
      studentId:name==='student_a'?'TEST-ALPHA':'TEST-BETA',password:'VeryStrongTestPass123!'}});
    assert.equal(out.status,201);
  }
  async function login(as,username){
    const res=await api('/api/login',{method:'POST',as,data:{username,password:'VeryStrongTestPass123!'}});
    assert.equal(res.status,200);
  }
  await login('org','org_test');await login('staff','staff_test');
  await login('a','student_a');await login('b','student_b');
  assert.equal((await api('/api/activities',{method:'POST',as:'a',data:campusEvent()})).status,403);
  const create=await api('/api/activities',{method:'POST',as:'org',data:campusEvent()});
  assert.equal(create.status,201);const id=create.value.id;
  assert.equal((await api('/api/activities/'+id+'/registrations',{as:'staff'})).status,403);
  assert.equal((await api('/api/activities/'+id+'/staff',{method:'POST',as:'org',data:{username:'staff_test'}})).status,200);
  assert.equal((await api('/api/activities/'+id+'/registrations',{as:'staff'})).status,200);
  assert.equal((await api('/api/activities/'+id+'/join',{method:'POST',as:'a',data:{note:'please review'}})).status,201);
  assert.equal((await api('/api/activities/'+id+'/join',{method:'POST',as:'a',data:{note:'repeat'}})).status,409);
  const all=await api('/api/activities/'+id+'/registrations',{as:'org'});
  const reg=all.value.registrations[0].id;
  assert.equal((await api('/api/activities/'+id+'/review',{method:'POST',as:'org',data:{registrationId:reg,state:'approved'}})).status,409);
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
  const upload=await api('/api/activities/'+id+'/upload',{method:'POST',as:'a',
    headers:{'X-Bombax-Filename':'test-image.png','Content-Type':'image/png'},body:png});
  assert.equal(upload.status,201);
  const attId=upload.value.id;
  assert.equal((await api('/api/attachments/'+attId,{as:'b'})).status,403);
  assert.equal((await api('/api/attachments/'+attId,{as:'org'})).status,200);
  assert.equal((await api('/api/activities/'+id+'/review',{method:'POST',as:'org',data:{registrationId:reg,state:'approved'}})).status,200);
  assert.equal((await api('/api/activities/'+id+'/ticket',{method:'POST',as:'a',data:{latitude:0,longitude:0,accuracyM:5}})).status,422);
  assert.equal((await api('/api/activities/'+id+'/ticket',{method:'POST',as:'a',data:{latitude:23.1,longitude:113.3,accuracyM:400}})).status,422);
  const issued=await api('/api/activities/'+id+'/ticket',{method:'POST',as:'a',data:{latitude:23.1,longitude:113.3,accuracyM:5}});
  assert.equal(issued.status,200);
  assert.match(issued.value.token,/^bqx_[a-f0-9]{64}$/);
  assert.equal((await api('/api/qr',{method:'POST',as:'b',data:{token:issued.value.token}})).status,403);
  assert.equal((await api('/api/qr',{method:'POST',as:'a',data:{token:issued.value.token}})).status,200);
  assert.equal((await api('/api/activities/'+id+'/redeem',{method:'POST',as:'a',data:{token:issued.value.token}})).status,403);
  const redeemed=await Promise.all([
    api('/api/activities/'+id+'/redeem',{method:'POST',as:'org',data:{token:issued.value.token}}),
    api('/api/activities/'+id+'/redeem',{method:'POST',as:'staff',data:{token:issued.value.token}})
  ]);
  assert.deepEqual(redeemed.map(r=>r.status).sort(),[200,409]);
  assert.equal((await api('/api/activities/'+id+'/ticket',{method:'POST',as:'a',data:{latitude:23.1,longitude:113.3,accuracyM:5}})).status,409);
  const exportFile=await api('/api/activities/'+id+'/export',{as:'org'});
  assert.equal(exportFile.status,200);
  assert.match(exportFile.value,/TEST-ALPHA/);
  assert.equal((await api('/api/activities/'+id+'/export',{as:'b'})).status,403);
  assert.equal((await api('/api/activities/'+id+'/export',{as:'staff'})).status,200);
  assert.equal((await api('/api/activities/'+id+'/review',{method:'POST',as:'org',data:{registrationId:reg,state:'rejected'}})).status,409);
});
test('Reject CSRF-like POST without same-origin action header',async t=>{
  const ctx=await run();t.after(()=>ctx.close());
  const r=await fetch(ctx.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'unknown',password:'BadPassword123!'})});
  assert.equal(r.status,403);
  const origin=await fetch(ctx.base+'/api/register',{method:'POST',
    headers:{'X-Bombax-Action':'1','Content-Type':'application/json','Origin':'https://attacker.invalid'},
    body:JSON.stringify({username:'evil',password:'BadPassword123!',studentId:'EVIL-01',displayName:'Unknown'})});
  assert.equal(origin.status,403);
});
