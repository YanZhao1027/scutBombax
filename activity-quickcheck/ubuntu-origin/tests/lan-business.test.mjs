import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,randomUUID,pbkdf2Sync} from 'node:crypto';
import {createOrigin} from '../server.mjs';
const LAN='https://activity-lan.10273055.xyz:8443';
function api(port,route,{method='GET',body,cookie}={}){
  return new Promise((resolve,reject)=>{
    const serialized=body===undefined?null:JSON.stringify(body);
    const headers={
      Host:'activity-lan.10273055.xyz:8443',
      ...(method!=='GET'?{'Origin':LAN,'X-Bombax-Action':'1',
        'Content-Type':'application/json'}:{}),
      ...(cookie?{Cookie:cookie}:{}),
    };
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers},res=>{
      const bodyChunks=[];
      res.on('data',b=>bodyChunks.push(b));
      res.on('end',()=>{
        const value=Buffer.concat(bodyChunks).toString();
        let data;try{data=JSON.parse(value);}catch{data=value;}
        resolve({status:res.statusCode,body:data,
          cookie:res.headers['set-cookie']?.[0]?.split(';')[0]||''});
      });
    });
    req.on('error',reject);
    if(serialized)req.write(serialized);
    req.end();
  });
}
test('LAN portal shares one Ubuntu SQLite authority, with host-only cookies',async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'bombax-lan-business-'));
  const port=18976,app=createOrigin({dataDir:data,port});
  try{
    await app.listen();
    const id=randomUUID(),salt=randomBytes(16).toString('hex');
    const hash=pbkdf2Sync('12341234',Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
    await app.bindings.DB.prepare(
      'INSERT INTO activity_users(id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(id,'TEST_lan_organizer',salt,hash,100000,'organizer',null,'测试校内负责人',Date.now()).run();
    const login=await api(port,'/api/login',{
      method:'POST',body:{username:'TEST_lan_organizer',password:'12341234'}});
    assert.equal(login.status,200,JSON.stringify(login.body));
    assert.ok(login.cookie.startsWith('bqx_live='));
    const now=Date.now();
    const event=await api(port,'/api/events',{method:'POST',cookie:login.cookie,body:{
      title:'测试校内直连报名',guidelines:'全程虚构',
      latitude:23,longitude:113,radiusM:500,startsAt:now+3_600_000,
      endsAt:now+7_200_000,requirePhoto:false
    }});
    assert.equal(event.status,201,JSON.stringify(event.body));
    const join=await api(port,'/api/events/'+event.body.id+'/join',{method:'POST',
      body:{displayName:'测试校内学生',studentNumber:'TEST-CAMPUS-1',privacyAcknowledged:true,
        aiConsent:false}});
    assert.equal(join.status,201,JSON.stringify(join.body));
    assert.ok(join.cookie.startsWith('bqx_g_'));
    const info=await api(port,'/api/events/'+event.body.id,{cookie:join.cookie});
    assert.equal(info.body.registration.state,'pending');
    assert.equal(app.bindings.DB.inspect('SELECT COUNT(*) AS c FROM activity_events')[0].c,1);
    assert.equal(app.bindings.DB.inspect('SELECT COUNT(*) AS c FROM activity_registrations')[0].c,1);
    assert.equal((await api(port,'/api/events')).body.events.length,1);
  }finally{
    await app.close();
    fs.rmSync(data,{recursive:true,force:true});
  }
});
