import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash,pbkdf2Sync} from 'node:crypto';
import backend from '../cloudflare-live/worker.mjs';

const origin='https://activity-stage.10273055.xyz';
const now=()=>Date.now();
const png=readFileSync(new URL('../cloudflare-live/public/demo-proof.png',import.meta.url));
const pngDigest=createHash('sha256').update(png).digest('hex');
const testPassword='OrganizerStageTestPassword12345!';
function makeFixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0001_init.sql','0002_password_iterations.sql','0003_guest_access.sql']){
    sqlite.exec(readFileSync(new URL('../cloudflare-live/migrations/'+file,import.meta.url),'utf8'));
  }
  const db={
    prepare(sql){
      const st=sqlite.prepare(sql);
      let params=[];
      return {
        bind(...items){params=items;return this;},
        async run(){return st.run(...params);},
        async first(){return st.get(...params)||null;},
        async all(){return {results:st.all(...params)};}
      };
    },
    async batch(statements){
      sqlite.exec('BEGIN');
      try {
        for(const statement of statements) await statement.run();
        sqlite.exec('COMMIT');
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  const files=new Map();
  const env={
    DB:db,ENABLE_LIVE:'true',SYNTHETIC_ONLY:'true',
    PUBLIC_ORIGIN:origin,SYNTHETIC_IMAGE_SHA256:pngDigest,
    AUTH_RATE_LIMIT:{limit:async()=>({success:true})},
    MATERIALS:{
      async put(key,data){files.set(key,new Uint8Array(data));},
      async get(key){
        const data=files.get(key);
        if(!data)return null;
        return {body:new Blob([data]).stream(),arrayBuffer:async()=>data.buffer};
      },
      async delete(key){files.delete(key);}
    },
    ASSETS:{fetch:async()=>new Response('static')}
  };
  function addAccount(username,role='organizer'){
    const salt='00112233445566778899aabbccddeeff';
    sqlite.prepare('INSERT INTO activity_users(id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      username,username,salt,pbkdf2Sync(testPassword,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex'),
      100000,role,role==='student'?'TEST-LEGACY':null,role==='student'?'测试旧账号':'测试工作人员',now()
    );
  }
  addAccount('demo_owner');addAccount('demo_reviewer');addAccount('demo_scanner');addAccount('demo_legacy_student','student');
  async function api(path,{method='GET',data,raw,cookie='',originHeader=true,limit=true}={}){
    const headers={'CF-Connecting-IP':'127.0.0.1'};
    if(cookie)headers.Cookie=cookie;
    if(method!=='GET'&&originHeader){headers.Origin=origin;headers['X-Bombax-Action']='1';}
    if(data!==undefined)headers['Content-Type']='application/json';
    if(raw!==undefined)headers['Content-Type']='image/png';
    const request=new Request(origin+path,{method,headers,body:data===undefined?raw:JSON.stringify(data)});
    return backend.fetch(request,limit?env:{...env,AUTH_RATE_LIMIT:undefined});
  }
  async function signIn(username){
    const res=await api('/api/login',{method:'POST',data:{username,password:testPassword}});
    assert.equal(res.status,200);
    const cookie=(res.headers.get('set-cookie')||'').split(';')[0];
    assert.match(cookie,/^bqx_live=[a-f0-9]{64}$/);
    return cookie;
  }
  async function createEvent(cookie,title='虚构活动一'){
    const res=await api('/api/events',{method:'POST',cookie,data:{
      title,guidelines:'仅使用模拟图片',latitude:23.1,longitude:113.3,radiusM:150,
      startsAt:now()-60000,endsAt:now()+3600000,requirePhoto:true
    }});
    assert.equal(res.status,201,await res.clone().text());
    return (await res.json()).id;
  }
  return {sqlite,env,files,api,signIn,createEvent,close(){sqlite.close();}};
}

test('students join without login; per-event HttpOnly receipt stays private and cannot cross events',async t=>{
  const f=makeFixture();t.after(()=>f.close());
  const owner=await f.signIn('demo_owner');
  const eid=await f.createEvent(owner);
  const eid2=await f.createEvent(owner,'虚构活动二');
  const route='/api/events/'+eid;

  const anon=await f.api('/api/me');
  assert.equal((await anon.json()).user,null);
  assert.equal((await f.api('/api/events')).status,200);
  assert.equal((await f.api(route)).status,200);
  assert.equal((await f.api(route+'/materials')).status,403);
  assert.equal((await f.api(route+'/queue')).status,403);
  assert.equal((await f.api(route+'/export')).status,403);
  assert.equal((await f.api('/api/register',{method:'POST',data:{}})).status,410);
  assert.equal((await f.api('/api/login',{method:'POST',data:{username:'demo_legacy_student',password:testPassword}})).status,401);

  const data={displayName:'测试甲',studentNumber:'TEST-STAGE-001',note:'虚构报名',privacyAcknowledged:true,aiConsent:false};
  assert.equal((await f.api(route+'/join',{method:'POST',data:{...data,privacyAcknowledged:false}})).status,400);
  assert.equal((await f.api(route+'/join',{method:'POST',data:{...data,studentNumber:'2025000000'}})).status,403);
  assert.equal((await f.api(route+'/join',{method:'POST',data:{...data,aiConsent:true}})).status,400);
  assert.equal((await f.api(route+'/join',{method:'POST',data,limit:false})).status,503);
  const joined=await f.api(route+'/join',{method:'POST',data});
  assert.equal(joined.status,201,await joined.clone().text());
  const setCookie=joined.headers.get('set-cookie')||'';
  assert.match(setCookie,/^bqx_g_[a-f0-9]{32}=bqx_[a-f0-9]{64};/);
  for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/api'])assert.ok(setCookie.includes(flag));
  const guestCookie=setCookie.split(';')[0];
  const receipt=guestCookie.split('=')[1];
  assert.match(receipt,/^bqx_[a-f0-9]{64}$/);
  const initialQr=await f.api(route+'/pass-qr',{method:'POST',cookie:guestCookie});
  assert.equal(initialQr.status,200);
  const initialSvg=await initialQr.text();
  assert.match(initialSvg,/<svg/);
  assert.doesNotMatch(initialSvg,/TEST-STAGE-001|测试甲/);
  assert.equal((await f.api(route+'/pass-qr',{method:'POST'})).status,403);
  const restored=await f.api('/api/pass/restore',{method:'POST',data:{token:receipt}});
  assert.equal(restored.status,200);
  assert.equal((await restored.clone().json()).eventId,eid);
  assert.equal(restored.headers.get('set-cookie')?.split(';')[0],guestCookie);
  assert.equal((await f.api('/api/pass/restore',{method:'POST',data:{token:receipt},limit:false})).status,503);
  const receiptRecord=f.sqlite.prepare('SELECT * FROM activity_guest_access').get();
  const end=f.sqlite.prepare('SELECT ends_at FROM activity_events WHERE id=?').get(eid).ends_at;
  assert.equal(receiptRecord.expires_at,end+30*86400_000,'one QR must remain valid through event and its stage status retention');
  assert.equal(createHash('sha256').update(receipt).digest('hex'),receiptRecord.token_digest);
  assert.notEqual(receiptRecord.token_digest,receipt);
  assert.equal(f.sqlite.prepare('SELECT student_number FROM activity_users WHERE role=? AND username LIKE ?').get('student','guest_%').student_number,null);
  const joinedData=await joined.json();
  assert.equal(joinedData.receiptStored,true);
  assert.ok(!JSON.stringify(joinedData).includes(receipt));

  const my=await f.api(route,{cookie:guestCookie});
  assert.equal((await my.json()).registration.state,'pending');
  assert.equal((await(await f.api(route)).json()).registration,null);
  assert.equal((await(await f.api('/api/events/'+eid2,{cookie:guestCookie})).json()).registration,null);
  assert.equal((await f.api(route+'/join',{method:'POST',data,cookie:guestCookie})).status,409);
  assert.equal((await f.api(route+'/upload',{method:'POST',raw:png})).status,403);
  const stageUpload=await f.api(route+'/upload',{method:'POST',raw:png,cookie:guestCookie});
  assert.equal(stageUpload.status,201,await stageUpload.clone().text());
  const materials=await f.api(route+'/materials',{cookie:guestCookie});
  assert.equal(materials.status,200);
  const fileId=(await materials.json()).materials[0].id;
  assert.equal((await f.api('/api/materials/'+fileId)).status,403);
  assert.equal((await f.api('/api/materials/'+fileId,{cookie:guestCookie})).status,200);
  assert.equal((await f.api(route+'/materials?registrationId='+joinedData.id,{cookie:guestCookie})).status,403);

  const reviewer=await f.signIn('demo_reviewer');
  const scanner=await f.signIn('demo_scanner');
  assert.equal((await f.api(route+'/staff',{method:'POST',cookie:owner,data:{username:'demo_reviewer',duty:'reviewer'}})).status,200);
  assert.equal((await f.api(route+'/staff',{method:'POST',cookie:owner,data:{username:'demo_scanner',duty:'scanner'}})).status,200);
  assert.equal((await f.api('/api/materials/'+fileId,{cookie:scanner})).status,403);
  assert.equal((await f.api('/api/materials/'+fileId,{cookie:reviewer})).status,200);
  // Even authorized scanner must not check in unapproved applicants.
  assert.equal((await f.api(route+'/redeem',{method:'POST',cookie:scanner,data:{token:receipt}})).status,409);
  const queue=await f.api(route+'/queue',{cookie:reviewer});
  assert.equal(queue.status,200);
  const rows=(await queue.json()).registrations;
  assert.equal(rows.length,1);
  assert.equal(rows[0].display_name,'测试甲');
  assert.equal(rows[0].student_number,'TEST-STAGE-001');
  assert.equal((await f.api(route+'/review',{method:'POST',cookie:reviewer,data:{registrationId:joinedData.id,state:'approved'}})).status,200);

  assert.equal((await f.api(route+'/ticket',{method:'POST',cookie:guestCookie,data:{}})).status,410);
  assert.equal((await f.api('/api/qr',{method:'POST',cookie:guestCookie,data:{token:receipt}})).status,410);
  assert.equal((await f.api(route+'/redeem',{method:'POST',data:{token:receipt},cookie:guestCookie})).status,403);
  assert.equal((await f.api(route+'/redeem',{method:'POST',data:{token:receipt},cookie:scanner})).status,200);
  assert.equal((await f.api(route+'/redeem',{method:'POST',data:{token:receipt},cookie:scanner})).status,409);
  const state=await(await f.api(route,{cookie:guestCookie})).json();
  assert.equal(state.registration.attendance.channel,'scan');
  // Check-in does NOT revoke the original pass or change its QR image.
  const afterQr=await f.api(route+'/pass-qr',{method:'POST',cookie:guestCookie});
  assert.equal(afterQr.status,200);
  assert.equal(await afterQr.text(),initialSvg);
  const postCheckInDevice=await f.api('/api/pass/restore',{method:'POST',data:{token:receipt}});
  assert.equal(postCheckInDevice.status,200);
  assert.equal((await postCheckInDevice.json()).eventId,eid);
  const restoredCookie=postCheckInDevice.headers.get('set-cookie').split(';')[0];
  assert.equal((await(await f.api(route,{cookie:restoredCookie})).json()).registration.attendance.channel,'scan');
  const csv=await f.api(route+'/export',{cookie:owner});
  assert.equal(csv.status,200);
  assert.match(await csv.text(),/TEST-STAGE-001/);
  assert.equal((await f.api(route+'/export',{cookie:guestCookie})).status,403);

  const joinedElsewhere=await f.api('/api/events/'+eid2+'/join',{method:'POST',data});
  assert.equal(joinedElsewhere.status,201,await joinedElsewhere.clone().text());
  const secondCookie=(joinedElsewhere.headers.get('set-cookie')||'').split(';')[0];
  assert.notEqual(secondCookie.split('=')[0],guestCookie.split('=')[0]);
  const secondPass=secondCookie.split('=')[1];
  assert.notEqual(secondPass,receipt);
  assert.equal((await f.api(route+'/pass-qr',{method:'POST',cookie:secondCookie})).status,403);
  assert.equal((await(await f.api('/api/pass/restore',{method:'POST',data:{token:secondPass}})).json()).eventId,eid2);
  assert.equal((await f.api('/api/events/'+eid2+'/redeem',{method:'POST',data:{token:receipt},cookie:scanner})).status,403);
  assert.equal((await f.api('/api/events/'+eid2+'/redeem',{method:'POST',data:{token:receipt},cookie:owner})).status,409);
  assert.equal((await f.api('/api/pass/restore',{method:'POST',data:{token:'bqx_'+('0'.repeat(64))}})).status,403);
});

test('stage gate refuses anonymous registration when switches are not both explicitly enabled',async t=>{
  const f=makeFixture();t.after(()=>f.close());
  const owner=await f.signIn('demo_owner');
  const eid=await f.createEvent(owner);
  const fields={displayName:'测试乙',studentNumber:'TEST-002',privacyAcknowledged:true,aiConsent:false};
  for(const key of ['ENABLE_LIVE','SYNTHETIC_ONLY']){
    const value=f.env[key];f.env[key]='false';
    const res=await f.api('/api/events/'+eid+'/join',{method:'POST',data:fields});
    assert.equal(res.status,503);
    f.env[key]=value;
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS c FROM activity_registrations').get().c,0);
});

test('separate guests in the same activity cannot access each other or enable third-party AI',async t=>{
  const f=makeFixture();t.after(()=>f.close());
  const owner=await f.signIn('demo_owner'),eid=await f.createEvent(owner);
  const route='/api/events/'+eid;
  async function join(name,number){
    const res=await f.api(route+'/join',{method:'POST',data:{
      displayName:name,studentNumber:number,privacyAcknowledged:true,aiConsent:false
    }});
    assert.equal(res.status,201);
    return {cookie:(res.headers.get('set-cookie')||'').split(';')[0],id:(await res.json()).id};
  }
  const first=await join('测试甲','TEST-A');
  const second=await join('测试乙','TEST-B');
  assert.notEqual(first.cookie,second.cookie);
  assert.equal((await f.api(route+'/upload',{method:'POST',cookie:first.cookie,raw:png})).status,201);
  const firstFiles=(await(await f.api(route+'/materials',{cookie:first.cookie})).json()).materials;
  const secondFiles=(await(await f.api(route+'/materials',{cookie:second.cookie})).json()).materials;
  assert.equal(firstFiles.length,1);
  assert.equal(secondFiles.length,0);
  assert.equal((await f.api('/api/materials/'+firstFiles[0].id,{cookie:second.cookie})).status,403);
  assert.equal((await f.api(route+'/materials?registrationId='+first.id,{cookie:second.cookie})).status,403);
  assert.equal((await f.api(route+'/consent',{method:'POST',cookie:first.cookie,data:{aiConsent:true}})).status,403);
  assert.equal((await f.api(route+'/ai-review',{method:'POST',cookie:owner,data:{registrationId:first.id}})).status,503);
  const reviewer=await f.signIn('demo_reviewer');
  assert.equal((await f.api(route+'/staff',{method:'POST',cookie:owner,data:{username:'demo_reviewer',duty:'reviewer'}})).status,200);
  assert.equal((await f.api(route+'/review',{method:'POST',cookie:reviewer,data:{registrationId:first.id,state:'approved'}})).status,200);
  const pass=first.cookie.split('=')[1];
  const secondPass=second.cookie.split('=')[1];
  assert.equal((await f.api(route+'/pass-qr',{method:'POST',cookie:second.cookie})).status,200);
  const svgBefore=await(await f.api(route+'/pass-qr',{method:'POST',cookie:first.cookie})).text();
  assert.notEqual(svgBefore,await(await f.api(route+'/pass-qr',{method:'POST',cookie:second.cookie})).text());
  assert.equal((await f.api('/api/pass/restore',{method:'POST',data:{token:pass}})).status,200);
  assert.equal((await f.api('/api/pass/restore',{method:'POST',data:{token:secondPass}})).status,200);
  const beforeExpiry=await f.api(route,{cookie:first.cookie});
  assert.equal((await beforeExpiry.json()).registration.state,'approved');
  f.sqlite.prepare('UPDATE activity_guest_access SET expires_at=? WHERE registration_id=?').run(now()-1,first.id);
  assert.equal((await(await f.api(route,{cookie:first.cookie})).json()).registration,null);
  assert.equal((await f.api(route+'/materials',{cookie:first.cookie})).status,403);
  assert.equal((await f.api(route+'/pass-qr',{method:'POST',cookie:first.cookie})).status,403);
  assert.equal((await f.api('/api/pass/restore',{method:'POST',data:{token:pass}})).status,403);
  assert.equal((await f.api(route+'/redeem',{method:'POST',data:{token:pass},cookie:owner})).status,409);
  assert.equal((await f.api(route+'/upload',{method:'POST',cookie:first.cookie,raw:png})).status,403);
});

test('one-code remains unchanged through manual arrival, late evidence and approval',async t=>{
  const f=makeFixture();t.after(()=>f.close());
  const owner=await f.signIn('demo_owner');
  const manual=await f.signIn('demo_reviewer');
  const eid=await f.createEvent(owner,'虚构现场人工通道');
  const route='/api/events/'+eid;
  assert.equal((await f.api(route+'/staff',{method:'POST',cookie:owner,
    data:{username:'demo_reviewer',duty:'manual'}})).status,200);
  const join=await f.api(route+'/join',{method:'POST',data:{
    displayName:'测试人工通道',studentNumber:'TEST-MANUAL',
    privacyAcknowledged:true,aiConsent:false
  }});
  assert.equal(join.status,201);
  const registrationId=(await join.json()).id;
  const cookie=join.headers.get('set-cookie').split(';')[0],pass=cookie.split('=')[1];
  const initialQr=await(await f.api(route+'/pass-qr',{method:'POST',cookie})).text();
  const checked=await f.api(route+'/manual-checkin',{method:'POST',cookie:manual,
    data:{registrationId,reason:'虚构现场身份已当面核实',identityChecked:true}});
  assert.equal(checked.status,200);
  assert.equal((await checked.json()).reviewPending,true);
  assert.equal((await f.api(route+'/redeem',{method:'POST',cookie:owner,data:{token:pass}})).status,409);
  assert.equal((await f.api(route+'/upload',{method:'POST',cookie,raw:png})).status,201);
  const reviewer=await f.signIn('demo_scanner');
  assert.equal((await f.api(route+'/staff',{method:'POST',cookie:owner,
    data:{username:'demo_scanner',duty:'reviewer'}})).status,200);
  assert.equal((await f.api(route+'/review',{method:'POST',cookie:reviewer,
    data:{registrationId,state:'approved'}})).status,200);
  const final=await(await f.api(route,{cookie})).json();
  assert.equal(final.registration.state,'approved');
  assert.equal(final.registration.attendance.channel,'manual');
  const returnedQr=await(await f.api(route+'/pass-qr',{method:'POST',cookie})).text();
  assert.equal(returnedQr,initialQr);
  const restore=await f.api('/api/pass/restore',{method:'POST',data:{token:pass}});
  assert.equal(restore.status,200);
  assert.equal((await restore.json()).eventId,eid);
});
