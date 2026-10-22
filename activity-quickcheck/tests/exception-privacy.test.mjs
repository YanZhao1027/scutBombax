import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import backend from '../cloudflare-live/worker.mjs';

const origin='https://activity-stage.10273055.xyz';
const sha=value=>createHash('sha256').update(value).digest('hex');
const dbRoot=new URL('../cloudflare-live/migrations/',import.meta.url);
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0001_init.sql','0002_password_iterations.sql','0003_manual_exception_lookup.sql'])
    sqlite.exec(fs.readFileSync(new URL(name,dbRoot),'utf8'));
  const DB={
    prepare(sql){
      const stmt=sqlite.prepare(sql);
      return {
        args:[],bind(...args){this.args=args;return this;},
        async first(){return stmt.get(...this.args)||null;},
        async all(){return {results:stmt.all(...this.args)};},
        async run(){return {success:true,meta:stmt.run(...this.args)};}
      };
    },
    async batch(statements){
      sqlite.exec('BEGIN');
      try{
        const results=[];
        for(const statement of statements)results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  const users={};
  function createUser(who,role,number){
    const id=randomUUID(),salt='aabbccddeeff00112233445566778899';
    sqlite.prepare('INSERT INTO activity_users(id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id,'demo_'+who,salt,'0'.repeat(64),100000,role,number||null,'测试'+who,Date.now());
    users[who]=id;
    const token=randomBytes(32).toString('hex');
    sqlite.prepare('INSERT INTO activity_sessions(digest,user_id,expires_at) VALUES (?,?,?)')
      .run(sha(token),id,Date.now()+3600_000);
    return token;
  }
  const cookies={
    owner:createUser('owner','organizer'),
    scan:createUser('scan','organizer'),
    manual:createUser('manual','organizer'),
    review:createUser('review','organizer'),
    student:createUser('student','student','TEST-EX-01'),
    other:createUser('other','student','TEST-EX-02'),
    visitor:createUser('visitor','student','TEST-EX-03')
  };
  const events={one:randomUUID(),two:randomUUID()};
  const now=Date.now();
  const eventInsert=sqlite.prepare('INSERT INTO activity_events(id,owner_id,title,guidelines,lat,lon,radius_m,starts_at,ends_at,require_photo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for(const eid of Object.values(events))
    eventInsert.run(eid,users.owner,'测试活动','不含真实学生资料',23.1,113.3,150,now-60000,now+3600_000,0,now);
  for(const role of ['scanner','manual','reviewer']){
    const who=role==='scanner'?'scan':role==='reviewer'?'review':'manual';
    sqlite.prepare('INSERT INTO activity_staff(event_id,user_id,duty) VALUES (?,?,?)')
      .run(events.one,users[who],role);
  }
  function register(who,eventId,approved=true){
    const id=randomUUID();
    sqlite.prepare('INSERT INTO activity_registrations(id,event_id,user_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id,eventId,users[who],approved?'approved':'pending',now,now);
    return id;
  }
  const regs={
    student:register('student',events.one),
    other:register('other',events.two),
    visitor:register('visitor',events.one)
  };
  const calls=[];
  let rateAllowed=true;
  const env={DB,ENABLE_LIVE:'true',SYNTHETIC_ONLY:'true',PUBLIC_ORIGIN:origin,
    AUTH_RATE_LIMIT:{limit:async({key})=>{calls.push(key);return {success:rateAllowed};}},
    ASSETS:{fetch:async()=>new Response('STATIC')}};
  async function api(route,{as='student',method='GET',data}={}){
    const opts={method,headers:{Cookie:'bqx_live='+cookies[as]}};
    if(method!=='GET'){
      opts.headers.Origin=origin;
      opts.headers['X-Bombax-Action']='1';
      opts.headers['Content-Type']='application/json';
      opts.body=JSON.stringify(data||{});
    }
    const response=await backend.fetch(new Request(origin+route,opts),env);
    const type=response.headers.get('Content-Type')||'';
    return {status:response.status,body:type.includes('json')?await response.json():await response.text()};
  }
  return {sqlite,env,api,calls,users,cookies,events,regs,denyAssist(){rateAllowed=false;},close(){sqlite.close();}};
}
const validContext={reasonCode:'unreadable_qr',reasonNote:'现场相机无法读取二维码，学生到人工窗口求助',studentPresent:true};

test('Ordinary role queues never retrieve or expose names/student numbers; exception access is narrowly scoped',async t=>{
  const f=fixture();t.after(()=>f.close());
  const eid=f.events.one;
  // An applicant may accidentally write their PII into a free-form note.
  f.sqlite.prepare('UPDATE activity_registrations SET note=? WHERE id=?')
    .run('我叫测试student，学号 TEST-EX-01',f.regs.student);
  for(const staff of ['scan','manual','review','owner']){
    const result=await f.api('/api/events/'+eid+'/queue',{as:staff});
    assert.equal(result.status,200,staff);
    const text=JSON.stringify(result.body);
    assert.doesNotMatch(text,/TEST-EX|测试student|测试visitor|studentNumber|student_number|displayName|display_name|recovery_code/);
    assert.equal(result.body.registrations.length,2);
    if(staff==='scan'||staff==='manual')assert.ok(result.body.registrations.every(x=>!('id' in x)));
  }
  for(const who of ['scan','review','student']){
    const response=await f.api('/api/events/'+eid+'/assist-lookup',{as:who,method:'POST',
      data:{...validContext,reference:'BM-2222-2222-2222'}});
    assert.equal(response.status,403,who);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM activity_exception_lookup').get().count,0);
});

test('Student reference is random, stable, student-private; manual reveal needs reason, student presence and audit',async t=>{
  const f=fixture();t.after(()=>f.close());
  const event='/api/events/'+f.events.one;
  const first=await f.api(event);
  assert.equal(first.status,200);
  const code=first.body.registration.recoveryCode;
  assert.match(code,/^BM-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal((await f.api(event)).body.registration.recoveryCode,code);
  assert.equal((await f.api(event,{as:'scan'})).body.registration,null);
  assert.equal((await f.api(event,{as:'manual'})).body.registration,null);
  const lookup=reference=>f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,reference}});
  const noPresence=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,studentPresent:false,reference:code}});
  assert.equal(noPresence.status,403);
  const noReason=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,reasonNote:'短',reference:code}});
  assert.equal(noReason.status,400);
  const missing=await lookup('BM-2222-2222-2222');
  assert.equal(missing.status,404);
  assert.doesNotMatch(JSON.stringify(missing.body),/测试student|TEST-EX/);
  const answer=await lookup(code.toLowerCase().replaceAll('-',''));
  assert.equal(answer.status,200);
  assert.equal(answer.body.registration.displayName,'测试student');
  assert.equal(answer.body.registration.studentNumber,'TEST-EX-01');
  assert.equal(answer.body.registration.identityStatus,'self_declared');
  assert.equal(answer.body.registration.attendance,null);
  const logs=f.sqlite.prepare('SELECT actor_id,kind,reason_code,reason_note,registration_id,matched FROM activity_exception_lookup ORDER BY occurred_at').all();
  assert.equal(logs.length,2);
  assert.deepEqual(logs.map(x=>x.matched).sort(),[0,1]);
  assert.equal(logs.at(-1).actor_id,f.users.manual);
  assert.ok(logs.every(x=>x.kind==='recovery'));
  assert.ok(logs.every(x=>x.reason_code==='unreadable_qr'));
  assert.ok(logs.every(x=>!JSON.stringify(x).includes(code)));
  assert.ok(logs.every(x=>!JSON.stringify(x).includes('TEST-EX-01')));
  assert.ok(f.calls.some(x=>x==='assist:'+f.users.manual+':'+f.events.one));
  const wrongEvent=await f.api('/api/events/'+f.events.two+'/assist-lookup',{as:'owner',method:'POST',
    data:{...validContext,reference:code}});
  assert.equal(wrongEvent.status,404);
});

test('QR digest trail permits audited identification after expiration/rotation and successful scan, never duplicate sign-in',async t=>{
  const f=fixture();t.after(()=>f.close());
  const event='/api/events/'+f.events.one;
  const q=await f.api(event+'/ticket',{method:'POST',data:{latitude:23.1,longitude:113.3,accuracyM:5}});
  assert.equal(q.status,200,JSON.stringify(q.body));
  const firstToken=q.body.token;
  assert.match(firstToken,/^bqx_[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(q.body).includes('TEST-EX'));
  const second=await f.api(event+'/ticket',{method:'POST',data:{latitude:23.1,longitude:113.3,accuracyM:5}});
  assert.equal(second.status,200);
  const older=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',data:{
    ...validContext,reasonCode:'expired_qr',reference:firstToken}});
  assert.equal(older.status,200);
  assert.equal(older.body.registration.displayName,'测试student');
  assert.equal((await f.api(event+'/redeem',{as:'scan',method:'POST',data:{token:firstToken}})).status,409);
  assert.equal((await f.api(event+'/redeem',{as:'scan',method:'POST',data:{token:second.body.token}})).status,200);
  assert.equal((await f.api(event+'/redeem',{as:'scan',method:'POST',data:{token:second.body.token}})).status,409);
  const after=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,reference:second.body.token}});
  assert.equal(after.status,200);
  assert.equal(after.body.registration.attendance.channel,'scan');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM activity_attendance WHERE registration_id=?')
    .get(f.regs.student).count,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM activity_ticket_history WHERE registration_id=?')
    .get(f.regs.student).count,2);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM activity_tickets WHERE registration_id=?')
    .get(f.regs.student).count,0);
  const digest=sha(second.body.token);
  f.sqlite.prepare('UPDATE activity_ticket_history SET expires_at=? WHERE digest=?')
    .run(Date.now()-49*3600_000,digest);
  const tooOld=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,reference:second.body.token}});
  assert.equal(tooOld.status,404);
  assert.doesNotMatch(JSON.stringify(tooOld.body),/student|TEST-/);
});

test('Audited manual route enforces face-to-face identity check, remains idempotent and preserves review independence',async t=>{
  const f=fixture();t.after(()=>f.close());
  const event='/api/events/'+f.events.one;
  const student=await f.api(event);
  const code=student.body.registration.recoveryCode;
  const preLookup=await f.api(event+'/manual-checkin',{as:'manual',method:'POST',
    data:{registrationId:f.regs.student,reason:'即使知道内部 UUID 也不能越权签到',identityChecked:true}});
  assert.equal(preLookup.status,403);
  const lookup=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,reference:code}});
  assert.equal(lookup.status,200);
  const rid=lookup.body.registration.id;
  const noProof=await f.api(event+'/manual-checkin',{as:'manual',method:'POST',
    data:{registrationId:rid,reason:'扫码故障后人工确认',identityChecked:false}});
  assert.equal(noProof.status,400);
  const yes=await f.api(event+'/manual-checkin',{as:'manual',method:'POST',
    data:{registrationId:rid,reason:'扫码故障后人工现场核对到场',identityChecked:true}});
  assert.equal(yes.status,200);
  assert.equal((await f.api(event+'/manual-checkin',{as:'manual',method:'POST',
    data:{registrationId:rid,reason:'重复',identityChecked:true}})).status,409);
  const record=f.sqlite.prepare('SELECT channel FROM activity_attendance WHERE registration_id=?').get(rid);
  assert.equal(record.channel,'manual');
  const status=f.sqlite.prepare('SELECT state FROM activity_registrations WHERE id=?').get(rid);
  assert.equal(status.state,'approved');
});

test('Assistance is rate-limited before record disclosure',async t=>{
  const f=fixture();t.after(()=>f.close());
  const event='/api/events/'+f.events.one;
  const code=(await f.api(event)).body.registration.recoveryCode;
  f.denyAssist();
  const response=await f.api(event+'/assist-lookup',{as:'manual',method:'POST',
    data:{...validContext,reference:code}});
  assert.equal(response.status,429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM activity_exception_lookup').get().count,0);
});

test('CSV identity export is reserved for the event owner and logged; reviewer has no bulk identity access',async t=>{
  const f=fixture();t.after(()=>f.close());
  const event='/api/events/'+f.events.one;
  const stamp=Date.now();
  f.sqlite.prepare("UPDATE activity_registrations SET reviewed_at=? WHERE id=?").run(stamp,f.regs.student);
  f.sqlite.prepare("INSERT INTO activity_attendance(registration_id,event_id,staff_id,channel,attended_at) VALUES (?,?,?,'scan',?)")
    .run(f.regs.student,f.events.one,f.users.scan,stamp);
  for(const role of ['scan','manual','review','student']){
    const denied=await f.api(event+'/export',{as:role});
    assert.equal(denied.status,403,role);
    assert.doesNotMatch(JSON.stringify(denied.body),/TEST-EX|测试student/);
  }
  const exported=await f.api(event+'/export',{as:'owner'});
  assert.equal(exported.status,200);
  assert.match(exported.body,/TEST-EX-01/);
  assert.match(exported.body,/测试student/);
  const audit=f.sqlite.prepare("SELECT actor_id,action,subject_id FROM activity_audit WHERE action='attendance.export'").all();
  assert.equal(audit.length,1);
  assert.equal(audit[0].actor_id,f.users.owner);
  assert.equal(audit[0].subject_id,null);
});

test('New registration obtains the randomized recovery code without exposing PII to scanner',async t=>{
  const f=fixture();t.after(()=>f.close());
  const eid=f.events.two;
  // The existing student has no registration for the other activity.
  const joined=await f.api('/api/events/'+eid+'/join',{method:'POST',data:{note:'虚构数据测试报名'}});
  assert.equal(joined.status,201);
  const snapshot=await f.api('/api/events/'+eid);
  assert.equal(snapshot.status,200);
  const code=snapshot.body.registration.recoveryCode;
  assert.match(code,/^BM-([0-9A-HJKMNP-TV-Z]{4}-){2}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(f.sqlite.prepare('SELECT recovery_code FROM activity_registrations WHERE id=?')
    .get(joined.body.id).recovery_code,code);
  const queue=await f.api('/api/events/'+eid+'/queue',{as:'owner'});
  assert.equal(queue.status,200);
  assert.ok(!JSON.stringify(queue.body).includes(code));
});

test('Scheduled cleanup removes old QR digests without changing check-in records',async t=>{
  const f=fixture();t.after(()=>f.close());
  const event='/api/events/'+f.events.one;
  const qr=await f.api(event+'/ticket',{method:'POST',data:{latitude:23.1,longitude:113.3,accuracyM:5}});
  assert.equal(qr.status,200);
  const digest=sha(qr.body.token);
  f.sqlite.prepare('UPDATE activity_ticket_history SET expires_at=? WHERE digest=?')
    .run(Date.now()-49*3600_000,digest);
  await backend.scheduled({},f.env);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) c FROM activity_ticket_history WHERE digest=?').get(digest).c,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) c FROM activity_registrations WHERE id=?').get(f.regs.student).c,1);
});
