import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,pbkdf2Sync,randomBytes} from 'node:crypto';
import {createOrigin} from '../server.mjs';

test('Ubuntu single-authority HTTP and SQLite integration (synthetic only)',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bombax-ubuntu-e2e-'));
  const app=createOrigin({dataDir:dir,port:18794});
  try{
    await app.listen();
    const root='http://127.0.0.1:18794';
    const origin='https://activity.10273055.xyz';
    const req=async(route,method='GET',body,auth='')=>{
      const r=await fetch(root+route,{method,headers:{
        ...(method==='GET'?{}:{Origin:origin,'X-Bombax-Action':'1','Content-Type':'application/json'}),
        ...(auth?{Cookie:auth}:{})
      },...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=await r.text();
      let data;try{data=JSON.parse(text)}catch{data=text}
      return {status:r.status,data,cookies:r.headers.getSetCookie()};
    };
    assert.equal((await req('/api/health')).data.syntheticOnly,true);
    assert.deepEqual((await req('/api/events')).data.events,[]);
    assert.equal((await req('/api/admin/events')).status,403);
    assert.equal((await req('/../package.json')).status,404);
    const invalidHost=await new Promise((resolve,reject)=>{const r=http.request(root+'/api/events',{headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});
    assert.equal(invalidHost,421);
    assert.equal(app.bindings.DB.inspect('SELECT COUNT(*) AS c FROM activity_events')[0].c,0);
    assert.equal(app.bindings.DB.inspect('SELECT COUNT(*) AS c FROM _local_migrations')[0].c,5);

    const owner=randomUUID(),salt=randomBytes(16).toString('hex');
    const hash=pbkdf2Sync('12341234',Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
    await app.bindings.DB.prepare(
      'INSERT INTO activity_users(id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(owner,'TEST_organizer',salt,hash,100000,'organizer',null,'测试负责人',Date.now()).run();

    const login=await req('/api/login','POST',{username:'TEST_organizer',password:'12341234'});
    assert.equal(login.status,200,JSON.stringify(login.data));
    assert.ok(login.cookies[0]?.startsWith('bqx_live='));
    const staffCookie=login.cookies[0].split(';')[0];

    const current=Date.now();
    const evt=await req('/api/events','POST',{
      title:'测试本地主站活动',guidelines:'虚构数据',latitude:23,longitude:113,
      radiusM:500,startsAt:current+3600000,endsAt:current+7200000,
      requirePhoto:false
    },staffCookie);
    assert.equal(evt.status,201,JSON.stringify(evt.data));
    const id=evt.data.id;
    assert.equal((await req('/api/events')).data.events.length,1);
    assert.equal((await req('/api/events/'+id+'/banner')).status,200);
    assert.equal((await req('/api/events/'+id+'/staff-roles','GET',undefined,staffCookie)).status,200);

    const join=await req('/api/events/'+id+'/join','POST',{
      displayName:'测试虚构学生',studentNumber:'TEST-STUDENT-001',
      privacyAcknowledged:true,aiConsent:false
    });
    assert.equal(join.status,201,JSON.stringify(join.data));
    assert.ok(join.cookies[0]?.startsWith('bqx_g_'));
    const studentCookie=join.cookies[0].split(';')[0];
    const before=await req('/api/events/'+id,'GET',undefined,studentCookie);
    assert.equal(before.data.registration.state,'pending');

    const reject=await req('/api/events/'+id+'/review','POST',{
      registrationId:join.data.id,state:'rejected',reason:'测试驳回'
    },staffCookie);
    assert.equal(reject.status,200,JSON.stringify(reject.data));
    const again=await req('/api/events/'+id+'/reapply','POST',{
      displayName:'测试虚构学生再次',studentNumber:'TEST-STUDENT-002',
      privacyAcknowledged:true,aiConsent:false
    },studentCookie);
    assert.equal(again.status,201,JSON.stringify(again.data));
    assert.equal(again.data.oldReceiptRevoked,true);
    const revoked=await req('/api/events/'+id,'GET',undefined,studentCookie);
    assert.equal(revoked.data.receiptRevoked,true);
    const newer=await req('/api/events/'+id,'GET',undefined,again.cookies[0].split(';')[0]);
    assert.equal(newer.data.registration.id,again.data.id);
    assert.equal(newer.data.registration.state,'pending');
    assert.equal(app.bindings.DB.inspect('SELECT COUNT(*) AS c FROM activity_revoked_receipts')[0].c,1);
  } finally {
    await app.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
