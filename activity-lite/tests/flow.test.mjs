import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support.mjs';
import backend from '../worker.mjs';

const receiptOf=value=>value.split('=').at(-1);
const qrOf=value=>value.split('=').at(-1);
const rights=(review=false,scan=false,exportRight=false,manual=false)=>
  ({review,scan,export:exportRight,manual});
async function addApproved(f,e,{material=true,name='测试学生甲',number='TEST-2026-01'}={}){
  const submitted=await f.api('/api/events/'+e.id+'/apply',{method:'POST',
    data:f.form({material,name,studentNumber:number})});
  assert.equal(submitted.status,201,JSON.stringify(submitted.data));
  const row=(await f.api('/api/events/'+e.id+'/records',{cookie:e.adminCookie}))
    .data.registrations[0];
  const approved=await f.api('/api/events/'+e.id+'/review',{method:'POST',cookie:e.adminCookie,
    data:{registrationId:row.id,state:'approved',decision:'材料通过'}});
  assert.equal(approved.status,200);
  return {row,receipt:receiptOf(submitted.data.receiptUrl),url:submitted.data.receiptUrl};
}

test('Only organizers have accounts: passwords hashed, no student users/GPS or admin secret in URL',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event();
  const names=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  assert.ok(names.includes('staff_accounts')&&names.includes('staff_sessions'));
  assert.ok(!names.includes('users')&&!names.includes('student_accounts'));
  const columns=f.sqlite.prepare('PRAGMA table_info(events)').all().map(x=>x.name);
  for(const column of ['lat','lon','latitude','longitude','manager_digest','scanner_digest'])
    assert.ok(!columns.includes(column),column);
  assert.match(e.manageUrl,/^http:\/\/127\.0\.0\.1:3319\/#staff=[a-f0-9-]{36}$/);
  assert.match(e.scanUrl,/^http:\/\/127\.0\.0\.1:3319\/#scan=[a-f0-9-]{36}$/);
  const account=f.sqlite.prepare("SELECT password_salt,password_digest,password_iterations,role FROM staff_accounts WHERE event_id=?").get(e.id);
  assert.equal(account.role,'admin');
  assert.equal(account.password_digest.length,64);
  assert.notEqual(account.password_digest,e.adminPassword);
  assert.ok(account.password_iterations>=200000);
  assert.equal((await f.api('/api/staff/me?eventId='+e.id,{cookie:e.adminCookie})).data.account.permissions.accounts,true);
});

test('Review, scan and CSV export are separate server-enforced rights; scanner sees no PII',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event();
  const reviewer=await f.member(e,{username:'qa_review',permissions:rights(true)});
  const scanner=await f.member(e,{username:'qa_scan',permissions:rights(false,true)});
  const exporter=await f.member(e,{username:'qa_export',permissions:rights(false,false,true)});
  const submission=await f.api('/api/events/'+e.id+'/apply',{method:'POST',data:f.form()});
  assert.equal(submission.status,201);
  const pending=await f.api('/api/receipt',{headers:{'X-Lite-Receipt':receiptOf(submission.data.receiptUrl)}});
  assert.equal(pending.data.state,'pending');
  const qrDenied=await f.api('/api/receipt/ticket',{method:'POST',
    headers:{'X-Lite-Receipt':receiptOf(submission.data.receiptUrl)}});
  assert.equal(qrDenied.status,403);
  const list=await f.api('/api/events/'+e.id+'/records',{cookie:reviewer.cookie});
  assert.equal(list.status,200);
  assert.equal(list.data.registrations[0].name,'测试学生甲');
  const reg=list.data.registrations[0];
  const file=await f.api('/api/events/'+e.id+'/material/'+reg.id,{cookie:reviewer.cookie});
  assert.equal(file.status,200);
  const decision=await f.api('/api/events/'+e.id+'/review',{method:'POST',cookie:reviewer.cookie,
    data:{registrationId:reg.id,state:'approved',decision:'通过'}});
  assert.equal(decision.status,200);
  const qr=await f.api('/api/receipt/ticket',{method:'POST',
    headers:{'X-Lite-Receipt':receiptOf(submission.data.receiptUrl)}});
  assert.equal(qr.status,200);
  const token=qrOf(qr.data.checkinUrl);
  assert.notEqual(token,receiptOf(submission.data.receiptUrl));
  for(const url of [
    '/api/events/'+e.id+'/records',
    '/api/events/'+e.id+'/material/'+reg.id,
    '/api/events/'+e.id+'/export',
    '/api/staff/accounts?eventId='+e.id
  ])assert.equal((await f.api(url,{cookie:scanner.cookie})).status,403,url);
  assert.equal((await f.api('/api/events/'+e.id+'/redeem',{method:'POST',cookie:reviewer.cookie,
    data:{token}})).status,403);
  const hit=await f.api('/api/events/'+e.id+'/redeem',{method:'POST',cookie:scanner.cookie,
    data:{token}});
  assert.equal(hit.status,200,JSON.stringify(hit.data));
  assert.deepEqual(Object.keys(hit.data).sort(),['message','ok']);
  assert.equal((await f.api('/api/events/'+e.id+'/redeem',{method:'POST',cookie:scanner.cookie,
    data:{token}})).status,409);
  assert.equal((await f.api('/api/events/'+e.id+'/export',{cookie:reviewer.cookie})).status,403);
  assert.equal((await f.api('/api/events/'+e.id+'/records',{cookie:exporter.cookie})).status,403);
  const exportResult=await f.api('/api/events/'+e.id+'/export',{cookie:exporter.cookie});
  assert.equal(exportResult.status,200);
  assert.match(exportResult.data,/TEST-2026-01/);
  const recorded=f.sqlite.prepare('SELECT checked_actor_id FROM registrations WHERE id=?').get(reg.id);
  const scannerAccount=f.sqlite.prepare('SELECT id FROM staff_accounts WHERE event_id=? AND username=?').get(e.id,'qa_scan');
  assert.equal(recorded.checked_actor_id,scannerAccount.id);
  const audit=f.sqlite.prepare('SELECT staff_id FROM audit WHERE event_id=? AND action=?').get(e.id,'review.approved');
  assert.equal(audit.staff_id,reviewer.id);
});

test('Admin provisions staff, cannot create a second admin; permissions and sessions revoke immediately',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event({material:false});
  const scan=await f.member(e,{username:'checkin_one',permissions:rights(false,true)});
  const list=await f.api('/api/staff/accounts?eventId='+e.id,{cookie:e.adminCookie});
  assert.equal(list.status,200);
  assert.equal(list.data.accounts.length,2);
  assert.ok(!JSON.stringify(list.data).includes('password_digest'));
  assert.equal((await f.api('/api/staff/accounts?eventId='+e.id,{cookie:scan.cookie})).status,403);
  const escalating=await f.api('/api/staff/accounts',{method:'POST',cookie:e.adminCookie,
    data:{eventId:e.id,username:'fakeadmin',displayName:'测试管理员',
      role:'admin',password:'Test-Password-Long-2026',permissions:rights(true,true,true,true)}});
  assert.equal(escalating.status,400);
  const edit=await f.api('/api/staff/accounts/'+scan.id,{method:'PATCH',cookie:e.adminCookie,
    data:{eventId:e.id,permissions:rights(true)}});
  assert.equal(edit.status,200);
  assert.equal((await f.api('/api/staff/me?eventId='+e.id,{cookie:scan.cookie})).status,401);
  const relog=await f.login(e.id,scan.username,scan.password);
  assert.equal(relog.status,200);
  assert.equal(relog.data.account.permissions.review,true);
  assert.equal(relog.data.account.permissions.scan,false);
  assert.equal((await f.api('/api/events/'+e.id+'/redeem',{method:'POST',cookie:relog.cookie,
    data:{token:'a'.repeat(64)}})).status,403);
  const disabled=await f.api('/api/staff/accounts/'+scan.id,{method:'PATCH',cookie:e.adminCookie,
    data:{eventId:e.id,enabled:false}});
  assert.equal(disabled.status,200);
  assert.equal((await f.api('/api/staff/me?eventId='+e.id,{cookie:relog.cookie})).status,401);
  assert.equal((await f.login(e.id,scan.username,scan.password)).status,401);
  const password='Another-Strong-Dummy-Password-54';
  assert.equal((await f.api('/api/staff/accounts/'+scan.id,{method:'PATCH',cookie:e.adminCookie,
    data:{eventId:e.id,enabled:true,password}})).status,200);
  assert.equal((await f.login(e.id,scan.username,scan.password)).status,401);
  assert.equal((await f.login(e.id,scan.username,password)).status,200);
  const deniedAdminEdit=await f.api('/api/staff/accounts/'+
    f.sqlite.prepare("SELECT id FROM staff_accounts WHERE event_id=? AND role='admin'").get(e.id).id,
    {method:'PATCH',cookie:e.adminCookie,data:{eventId:e.id,enabled:false}});
  assert.equal(deniedAdminEdit.status,404);
});

test('Accounts are event-bound even if usernames match; sessions are HttpOnly, same-site and logout revokes them',async t=>{
  const f=fixture();t.after(()=>f.close());
  const a=await f.event();
  const b=await f.event();
  assert.equal((await f.api('/api/staff/me?eventId='+b.id,{cookie:a.adminCookie})).status,401);
  assert.equal((await f.api('/api/events/'+b.id+'/records',{cookie:a.adminCookie})).status,401);
  const mgr=await f.login(a.id,a.adminUsername,a.adminPassword);
  assert.equal(mgr.status,200);
  const cookie=mgr.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Path=\/api/);
  assert.doesNotMatch(cookie,/Secure/); // localhost QA only
  const logout=await f.api('/api/staff/logout',{method:'POST',cookie:mgr.cookie});
  assert.equal(logout.status,200);
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await f.api('/api/staff/me?eventId='+a.id,{cookie:mgr.cookie})).status,401);
  assert.equal((await f.api('/api/staff/me?eventId='+a.id,{cookie:a.adminCookie})).status,200);
  f.env.LOCAL_QA='false';
  const secure=await f.login(a.id,a.adminUsername,a.adminPassword);
  assert.match(secure.headers.get('set-cookie'),/Secure/);
});

test('Staff login is rate-limited and fails closed; old capability headers no longer grant permissions',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event();
  assert.equal((await f.login(e.id,e.adminUsername,'bad-secret')).status,401);
  const noSession=await f.api('/api/events/'+e.id+'/records',{
    headers:{'X-Lite-Staff':'f'.repeat(64)}});
  assert.equal(noSession.status,401);
  f.denyLogin();
  assert.equal((await f.login(e.id,e.adminUsername,e.adminPassword)).status,429);
  f.env.STAFF_LOGIN_LIMIT=undefined;
  assert.equal((await f.login(e.id,e.adminUsername,e.adminPassword)).status,503);
});

test('No-account student flow, rotating QR invalidates old QR but not the private receipt',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event({material:false});
  const {receipt}=await addApproved(f,e,{material:false});
  const one=qrOf((await f.api('/api/receipt/ticket',{method:'POST',
    headers:{'X-Lite-Receipt':receipt}})).data.checkinUrl);
  const two=qrOf((await f.api('/api/receipt/ticket',{method:'POST',
    headers:{'X-Lite-Receipt':receipt}})).data.checkinUrl);
  assert.notEqual(one,two);
  const scanner=await f.member(e,{username:'scan_twice',permissions:rights(false,true)});
  for(const token of [one,receipt]){
    assert.equal((await f.api('/api/events/'+e.id+'/redeem',{method:'POST',
      cookie:scanner.cookie,data:{token}})).status,409);
  }
  assert.equal((await f.api('/api/events/'+e.id+'/redeem',{method:'POST',
    cookie:scanner.cookie,data:{token:two}})).status,200);
  assert.equal((await f.api('/api/receipt',{headers:{'X-Lite-Receipt':receipt}})).data.checkedIn,true);
  assert.equal((await f.api('/api/receipt/ticket',{method:'POST',
    headers:{'X-Lite-Receipt':receipt}})).status,409);
});

test('Manual exceptions require own permission and face-to-face attestation; one check-in record',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event({material:false});
  const scan=await f.member(e,{username:'scan_a',permissions:rights(false,true)});
  const helper=await f.member(e,{username:'manual_a',permissions:rights(false,false,false,true)});
  const submitted=await f.api('/api/events/'+e.id+'/apply',{method:'POST',data:f.form({material:false})});
  const rec=(await f.api('/api/events/'+e.id+'/records',{cookie:helper.cookie})).data.registrations[0];
  const req={method:'POST',data:{registrationId:rec.id,reason:'已在现场查验学生提供的独立证件',identityChecked:true}};
  assert.equal((await f.api('/api/events/'+e.id+'/manual',{...req,cookie:scan.cookie})).status,403);
  assert.equal((await f.api('/api/events/'+e.id+'/manual',{...req,cookie:helper.cookie,
    data:{...req.data,identityChecked:false}})).status,400);
  assert.equal((await f.api('/api/events/'+e.id+'/manual',{...req,cookie:helper.cookie})).status,200);
  assert.equal((await f.api('/api/events/'+e.id+'/manual',{...req,cookie:helper.cookie})).status,409);
  assert.equal(f.sqlite.prepare('SELECT checked_actor_id FROM registrations WHERE id=?').get(rec.id).checked_actor_id,helper.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='attendance.manual'").get().n,1);
  assert.equal((await f.api('/api/receipt',{headers:{'X-Lite-Receipt':
    receiptOf(submitted.data.receiptUrl)}})).data.checkedIn,true);
});

test('Concurrent scans are atomic and registration privacy is preserved',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event({material:false});
  const {receipt}=await addApproved(f,e,{material:false});
  const scanner=await f.member(e,{username:'scan_concurrent',permissions:rights(false,true)});
  const token=qrOf((await f.api('/api/receipt/ticket',{method:'POST',
    headers:{'X-Lite-Receipt':receipt}})).data.checkinUrl);
  const action=()=>f.api('/api/events/'+e.id+'/redeem',{method:'POST',
    cookie:scanner.cookie,data:{token}});
  assert.deepEqual((await Promise.all([action(),action()])).map(x=>x.status).sort(),[200,409]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registrations WHERE checked_at IS NOT NULL').get().n,1);
});

test('Cross-origin mutation rejected; synthetic data gate and upload limitation hold',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event();
  const forged=new Request(f.env.PUBLIC_ORIGIN+'/api/events/'+e.id+'/apply',{
    method:'POST',headers:{Origin:'https://wrong.example.test','X-Lite-Action':'1',
      'CF-Connecting-IP':'127.0.0.1'},body:f.form()});
  assert.equal((await backend.fetch(forged,f.env)).status,403);
  assert.equal((await f.api('/api/events/'+e.id+'/apply',{method:'POST',
    data:f.form({name:'真实学生'})})).status,403);
  assert.equal((await f.api('/api/events/'+e.id+'/apply',{method:'POST',
    data:f.form({material:false})})).status,400);
  assert.equal((await f.api('/api/events/'+e.id+'/apply',{method:'POST',
    data:f.form({privacyAck:false})})).status,400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registrations').get().n,0);
  const noStore=fixture({withUploads:false});t.after(()=>noStore.close());
  const event=await noStore.event();
  assert.equal((await noStore.api('/api/events/'+event.id+'/apply',{
    method:'POST',data:noStore.form()})).status,503);
});

test('The manager can export, but scanner cannot; CSV escapes formulas and is audited',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event({material:false});
  const {row}=await addApproved(f,e,{material:false});
  f.sqlite.prepare('UPDATE registrations SET student_number=?, checked_at=?, checked_by=? WHERE id=?')
    .run('=HYPERLINK("unsafe")',Date.now(),'scan',row.id);
  const output=await f.api('/api/events/'+e.id+'/export',{cookie:e.adminCookie});
  assert.equal(output.status,200);
  assert.match(output.data,/'=HYPERLINK/);
  const who=f.sqlite.prepare("SELECT staff_id FROM audit WHERE event_id=? AND action='export'").get(e.id);
  assert.ok(who.staff_id);
});

test('Expired sessions, stopped accounts and wrong-event access are denied before data reads',async t=>{
  const f=fixture();t.after(()=>f.close());
  const e=await f.event();
  const other=await f.event();
  const s=await f.member(e,{username:'q_scanner',permissions:rights(false,true)});
  assert.equal((await f.api('/api/events/'+other.id+'/redeem',{
    method:'POST',cookie:s.cookie,data:{token:'a'.repeat(64)}})).status,401);
  f.sqlite.prepare('UPDATE staff_sessions SET expires_at=? WHERE staff_id=?').run(Date.now()-1,s.id);
  assert.equal((await f.api('/api/staff/me?eventId='+e.id,{cookie:s.cookie})).status,401);
});

test('Service disabled and staff-event bootstrap requires strong root and admin password',async t=>{
  const f=fixture({ready:false});t.after(()=>f.close());
  assert.equal((await f.api('/api/health')).data.ready,false);
  assert.equal((await f.api('/api/events')).status,503);
  const live=fixture();t.after(()=>live.close());
  const options={title:'测试活动',place:'教室',startsAt:Date.now()+20000,
    endsAt:Date.now()+3600000,requireMaterial:false,adminUsername:'owner',
    adminDisplayName:'负责人',adminPassword:'too-short'};
  const denied=await live.api('/api/events',{method:'POST',
    headers:{'X-Lite-Root':live.rootToken},data:options});
  assert.equal(denied.status,400);
  assert.equal(live.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,0);
});
