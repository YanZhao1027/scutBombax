/**
 * Real HTTP+Cloudflare D1/R2 smoke run against the isolated synthetic-only
 * activity stage. This deliberately never touches school or audition systems.
 * Node >=22. Requires explicit BOMBAX_CONFIRM_SYNTHETIC_STAGE=yes.
 * All data is fictional; uploaded PNG is the stage's publicly marked TEST ONLY fixture.
 */
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

if(process.env.BOMBAX_CONFIRM_SYNTHETIC_STAGE!=='yes')
  throw Error('Specify BOMBAX_CONFIRM_SYNTHETIC_STAGE=yes to use only fictional data');
const base='https://activity-stage.10273055.xyz';
const secret=process.env.BOMBAX_STAGE_STAFF_PASSWORD;
if(!secret)throw Error('Set BOMBAX_STAGE_STAFF_PASSWORD locally for authorized synthetic staff; never upload or paste it into chat.');
const id=randomBytes(4).toString('hex');
const clients=new Map();
const dummy=fs.readFileSync(new URL('../cloudflare-live/public/demo-proof.png',import.meta.url));
let requests=0;
async function request(method,path,role='anonymous',payload,options={}){
  const headers={Origin:base,'X-Bombax-Action':'1'};
  if(clients.has(role))headers.Cookie=clients.get(role);
  let body;
  if(method!=='GET'){
    if(options.upload){headers['Content-Type']='image/png';body=payload;}
    else{headers['Content-Type']='application/json';body=JSON.stringify(payload);}
  }
  let res,lastError;
  for(let attempt=0;attempt<(method==='GET'?3:1);attempt++){
    try{
      res=await fetch(base+path,{method,headers,body,signal:AbortSignal.timeout(25000)});
      break;
    }catch(e){
      lastError=e;
      if(method==='GET'&&attempt<2){
        console.log('Transient GET connectivity timeout; retrying safely');
        await new Promise(resolve=>setTimeout(resolve,650*(attempt+1)));
      }
    }
  }
  if(!res)throw Error('Network failure for '+method+' '+path.split('?')[0]+': '+lastError?.message);
  requests++;
  if(res.headers.get('set-cookie'))clients.set(role,res.headers.get('set-cookie').split(';')[0]);
  const mime=res.headers.get('content-type')||'';
  const data=mime.includes('application/json')?await res.json()
    :mime.includes('text/')||mime.includes('svg')?await res.text()
    :new Uint8Array(await res.arrayBuffer());
  // Never log session cookies, QR tokens, PNG bytes, image contents, or private identifiers.
  console.log(method,path.split('?')[0],res.status);
  return {status:res.status,data};
}
function assertStatus(resp,code){
  assert.equal(resp.status,code,typeof resp.data==='object'&&!(resp.data instanceof Uint8Array)?JSON.stringify(resp.data):'unexpected status');
  return resp.data;
}
async function login(role){
  // Explicitly synthetic-only account names; real campus users are prohibited.
  assert(role.startsWith('demo_'));
  let result=await request('POST','/api/login',role,{username:role,password:secret});
  if(result.status===429){
    console.log('Auth rate limit enforced. Waiting for a new 60-second window.');
    await new Promise(resolve=>setTimeout(resolve,66000));
    result=await request('POST','/api/login',role,{username:role,password:secret});
  }
  assertStatus(result,200);
}
async function main(){
  console.log('Synthetic Stage End-to-End: one-code pass + D1/R2 + human review');
  const health=assertStatus(await request('GET','/api/health'),200);
  assert.equal(health.syntheticOnly,true);
  assert.equal(health.ready,true);
  await login('demo_owner');
  const start=Date.now();
  const event=assertStatus(await request('POST','/api/events','demo_owner',{
    title:'TEST ONLY - activity '+id,
    guidelines:'虚构报名材料：内置 42 点赞 TEST ONLY 图片；人工审核',
    latitude:23.12,longitude:113.32,radiusM:250,
    startsAt:start-240000,endsAt:start+5400000,requirePhoto:true
  }),201);
  assert.match(event.id,/^[0-9a-f-]{36}$/);
  const root='/api/events/'+event.id;
  console.log('Event created with fictional location and bounded check-in time');
  for(const [username,duty] of [
    ['demo_review','reviewer'],['demo_scan','scanner'],['demo_manual','manual']
  ]){
    assertStatus(await request('POST',root+'/staff','demo_owner',{username,duty}),200);
  }
  for(const staff of ['demo_review','demo_scan','demo_manual'])await login(staff);
  const aRole='guestA';
  const a=assertStatus(await request('POST',root+'/join',aRole,{
    displayName:'测试报名甲',studentNumber:'TEST-A-'+id.toUpperCase(),
    privacyAcknowledged:true,note:'synthetic upload-first path',aiConsent:false
  }),201);
  assert.match(clients.get(aRole)||'',/^bqx_g_[a-f0-9]{32}=bqx_[a-f0-9]{64}$/);
  console.log('Applicant A enrolled');
  const uploaded=assertStatus(await request('POST',root+'/upload',aRole,dummy,{upload:true}),201);
  assert.equal(uploaded.bytes,dummy.length);
  const ownFiles=assertStatus(await request('GET',root+'/materials',aRole),200);
  assert.equal(ownFiles.materials.length,1);
  assert.equal(ownFiles.materials[0].id,uploaded.id);
  const protectedFile='/api/materials/'+uploaded.id;
  assertStatus(await request('GET',protectedFile,'demo_scan'),403);
  const file=assertStatus(await request('GET',protectedFile,'demo_review'),200);
  assert.equal(file.byteLength,dummy.length,'R2 private PNG must match original fixture bytes');
  console.log('Private R2 bytes roundtrip succeeded; scanner cannot view evidence');
  const list=assertStatus(await request('GET',root+'/queue','demo_review'),200);
  assert.equal(list.registrations.find(x=>x.id===a.id)?.material_count,1);
  assertStatus(await request('POST',root+'/review','demo_scan',{
    registrationId:a.id,state:'approved'
  }),403);
  assertStatus(await request('POST',root+'/review','demo_review',{
    registrationId:a.id,state:'approved',reason:'TEST ONLY fixture meets trial guideline'
  }),200);
  // The registration receipt IS the QR throughout: no GPS-based 45s token.
  const pass=clients.get(aRole).split('=')[1];
  assert.match(pass,/^bqx_[0-9a-f]{64}$/);
  const qr=assertStatus(await request('POST',root+'/pass-qr',aRole,{}),200);
  assert.match(qr,/<svg/);
  const restored=assertStatus(await request('POST','/api/pass/restore','secondPhoneA',{token:pass}),200);
  assert.equal(restored.eventId,event.id);
  console.log('One-code pass created and restored on a second simulated browser');
  const parallel=await Promise.all([
    request('POST',root+'/redeem','demo_scan',{token:pass}),
    request('POST',root+'/redeem','demo_owner',{token:pass})
  ]);
  assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);
  assertStatus(await request('POST',root+'/redeem','demo_scan',{token:pass}),409);
  assertStatus(await request('POST',root+'/manual-checkin','demo_manual',{
    registrationId:a.id,reason:'duplicate should fail',identityChecked:true
  }),409);
  const qrAfter=assertStatus(await request('POST',root+'/pass-qr','secondPhoneA',{}),200);
  assert.equal(qrAfter,qr,'Original QR must not change after check-in');
  const current=assertStatus(await request('GET',root,'secondPhoneA'),200);
  assert.equal(current.registration.attendance.channel,'scan');
  console.log('Concurrent scan exactly once; unchanged pass still shows checked-in status');
  const bRole='guestB';
  const bNum='TEST-E2E-'+id.toUpperCase();
  const b=assertStatus(await request('POST',root+'/join',bRole,{
    displayName:'测试报名乙',studentNumber:bNum,privacyAcknowledged:true,
    note:'synthetic manual-first path',aiConsent:false
  }),201);
  assert.match(clients.get(bRole)||'',/^bqx_g_[a-f0-9]{32}=bqx_[a-f0-9]{64}$/);
  assertStatus(await request('POST',root+'/manual-checkin','demo_scan',{
    registrationId:b.id,reason:'scanner is unauthorized',identityChecked:true
  }),403);
  const presence=assertStatus(await request('POST',root+'/manual-checkin','demo_manual',{
    registrationId:b.id,reason:'演练：先现场核对、后提交 TEST ONLY 材料',identityChecked:true
  }),200);
  assert.equal(presence.reviewPending,true);
  assertStatus(await request('POST',root+'/review','demo_review',{
    registrationId:b.id,state:'approved',reason:'missing evidence'
  }),409);
  const uploadedB=assertStatus(await request('POST',root+'/upload',bRole,dummy,{upload:true}),201);
  assert.equal(uploadedB.bytes,dummy.length);
  const bqueue=assertStatus(await request('GET',root+'/queue','demo_review'),200);
  assert.equal(bqueue.registrations.find(x=>x.id===b.id)?.channel,'manual');
  assertStatus(await request('POST',root+'/review','demo_review',{
    registrationId:b.id,state:'approved',reason:'补交测试截图已经审核'
  }),200);
  assertStatus(await request('POST',root+'/redeem','demo_scan',{token:clients.get(bRole).split('=')[1]}),409);
  assertStatus(await request('POST',root+'/ticket',bRole,{}),410);
  assertStatus(await request('GET',root+'/export','demo_scan'),403);
  const exported=assertStatus(await request('GET',root+'/export','demo_owner'),200);
  assert(exported.includes('TEST-E2E-'+id.toUpperCase()));
  assert(exported.includes('manual'));
  assert(exported.includes('scan'));
  assert(!exported.includes('bqx_'));
  console.log('Manual-first late-upload route, role separation, and CSV export passed');
  console.log('PASS:',requests,'synthetic-only real HTTPS requests, event=',event.id);
  console.log('NOTE: physical QR scan and identity verification remain separate device-level checks.');
}
await main().catch(err=>{
  console.error('FAIL:',err.message);
  process.exitCode=1;
});
