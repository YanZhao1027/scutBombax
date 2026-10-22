import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,pbkdf2Sync} from 'node:crypto';
import {createOrigin} from '../server.mjs';

test('live origin: independent staff, student photo, consent and AI recommendation',async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'bombax-photo-ai-'));
  const keyFile=path.join(data,'deepseek.key');
  fs.writeFileSync(keyFile,'local-test-mocked-api-key',{mode:0o600});
  const app=createOrigin({dataDir:data,port:18978,liveMode:true,deepseekKeyFile:keyFile});
  const nativeFetch=globalThis.fetch;
  let aiRequests=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url)==='https://api.deepseek.com/chat/completions'){
      aiRequests++;
      const payload=JSON.parse(init.body);
      assert.equal(payload.model,'deepseek-flash');
      assert.match(JSON.stringify(payload.messages),/data:image\/png;base64,/);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
        assessment:'looks_sufficient',visible_like_count:38,evidence_quality:'clear',
        visible_evidence:'测试图示数字38',concerns:['不能验证截图真伪']
      })}}]}),{headers:{'Content-Type':'application/json'}});
    }
    return nativeFetch(url,init);
  };
  const base='http://127.0.0.1:18978';
  const origin='https://activity.10273055.xyz';
  async function call(route,{method='GET',data,cookie,raw,contentType}={}){
    const headers={};
    if(method!=='GET'){headers['Origin']=origin;headers['X-Bombax-Action']='1';}
    if(cookie)headers.Cookie=cookie;
    if(data!==undefined)headers['Content-Type']='application/json';
    if(raw)headers['Content-Type']=contentType||'image/png';
    const response=await nativeFetch(base+route,{method,headers,
      body:raw??(data!==undefined?JSON.stringify(data):undefined)});
    let result;const bytes=await response.arrayBuffer();
    try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{result={};}
    return {status:response.status,data:result,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    await app.listen();
    const health=await call('/api/health');
    assert.equal(health.data.syntheticOnly,false);
    assert.equal(health.data.allowImageUpload,true);
    assert.equal(health.data.aiReviewAvailable,true);
    const salt=randomBytes(16).toString('hex'),pwd='OwnerHasStrongRandomPassword2026';
    await app.bindings.DB.prepare('INSERT INTO activity_users(id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(randomUUID(),'organizer',salt,pbkdf2Sync(pwd,Buffer.from(salt,'hex'),450000,32,'sha256').toString('hex'),450000,'organizer',null,'主办方',Date.now()).run();
    const login=await call('/api/login',{method:'POST',data:{username:'organizer',password:pwd}});
    assert.equal(login.status,200,JSON.stringify(login.data));
    const now=Date.now();
    const created=await call('/api/events',{method:'POST',cookie:login.cookie,data:{
      title:'校园活动报名测试',guidelines:'朋友圈赞数至少28',minLikes:null,
      latitude:23.12,longitude:113.32,radiusM:150,startsAt:now+3600000,
      endsAt:now+7200000,requirePhoto:true
    }});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const eid=created.data.id;
    assert.equal((await call('/api/events/'+eid+'/review-settings',{
      method:'POST',data:{minLikes:28}})).status,403,'anonymous cannot edit event requirements');
    assert.equal((await call('/api/events/'+eid+'/review-settings',{
      method:'POST',cookie:login.cookie,data:{minLikes:-1}})).status,400);
    const settings=await call('/api/events/'+eid+'/review-settings',{
      method:'POST',cookie:login.cookie,data:{minLikes:28}});
    assert.equal(settings.status,200,JSON.stringify(settings.data));
    assert.equal(settings.data.minLikes,28);
    assert.equal(app.bindings.DB.inspect('SELECT min_likes FROM activity_events WHERE id=?',eid)[0].min_likes,28);
    const joined=await call('/api/events/'+eid+'/join',{method:'POST',data:{
      displayName:'李某某',studentNumber:'2024091234',privacyAcknowledged:true,aiConsent:true
    }});
    assert.equal(joined.status,201,JSON.stringify(joined.data));
    const cookie=joined.cookie;
    const sample=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aH9MAAAAASUVORK5CYII=','base64');
    const uploaded=await call('/api/events/'+eid+'/upload',{method:'POST',cookie,
      raw:sample,contentType:'image/png'});
    assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
    const image=await call('/api/materials/'+uploaded.data.id);
    assert.equal(image.status,403,'unauthenticated materials remain private');
    const queue=await call('/api/events/'+eid+'/queue',{cookie:login.cookie});
    assert.equal(queue.data.registrations[0].ai_consent,1);
    const ai=await call('/api/events/'+eid+'/ai-review',{method:'POST',cookie:login.cookie,
      data:{registrationId:joined.data.id}});
    assert.equal(ai.status,200,JSON.stringify(ai.data));
    assert.equal(ai.data.advice.visibleLikeCount,38);
    assert.equal(ai.data.advice.minimumLikes,28);
    assert.equal(ai.data.advice.thresholdMet,true);
    assert.equal(ai.data.advice.humanApprovalRequired,true);
    assert.equal(aiRequests,1);
    assert.equal((await call('/api/events/'+eid,{cookie})).data.registration.state,'pending');
    const revoke=await call('/api/events/'+eid+'/consent',{method:'POST',cookie,
      data:{aiConsent:false}});
    assert.equal(revoke.status,200);
    const after=await call('/api/events/'+eid+'/ai-review',{method:'POST',cookie:login.cookie,
      data:{registrationId:joined.data.id}});
    assert.equal(after.status,403,'AI cannot run after consent revoked');
    assert.equal(aiRequests,1);
    const approved=await call('/api/events/'+eid+'/review',{method:'POST',cookie:login.cookie,
      data:{registrationId:joined.data.id,state:'approved'}});
    assert.equal(approved.status,200);
    assert.equal((await call('/api/events/'+eid,{cookie})).data.registration.state,'approved');
  }finally{
    globalThis.fetch=nativeFetch;
    await app.close();
    fs.rmSync(data,{recursive:true,force:true});
  }
});
