import test from 'node:test';
import assert from 'node:assert/strict';
import backend from '../cloudflare-live/worker.mjs';
const makeEnv=()=>({
  DB:{prepare(){throw new Error('D1 must not be accessed by anonymous health and closed-gate routes');}},
  ENABLE_LIVE:'false',PUBLIC_ORIGIN:'https://activity-stage.10273055.xyz',
  ASSETS:{fetch:async()=>new Response('static demo',{status:200})}
});
test('Cloudflare live backend only responds with readiness until explicitly enabled',async()=>{
  const env=makeEnv();
  const health=await backend.fetch(new Request('https://activity-stage.10273055.xyz/api/health'),env);
  assert.equal(health.status,200);
  const x=await health.json();
  assert.equal(x.ready,false);
  assert.equal(x.ok,true);
  const write=await backend.fetch(new Request('https://activity-stage.10273055.xyz/api/register',{
    method:'POST',headers:{'Origin':'https://activity-stage.10273055.xyz','X-Bombax-Action':'1'},
    body:JSON.stringify({username:'invalid'})}),env);
  assert.equal(write.status,503);
  const empty=await backend.fetch(new Request('https://activity-stage.10273055.xyz/'),env);
  assert.equal(empty.status,200);
});

import {pbkdf2Sync} from 'node:crypto';

function authFixture(iterations=100000){
  const password='12341234';
  const salt='00112233445566778899aabbccddeeff';
  const user={
    id:'synthetic-organizer-1',username:'demo_localtest',display_name:'Synthetic Test Organizer',
    role:'organizer',student_number:null,password_salt:salt,
    password_digest:pbkdf2Sync(password,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex'),
    password_iterations:iterations
  };
  let session;
  const db={prepare(sql){
    const statement={values:[],bind(...args){this.values=args;return this;},
      async first(){
        if(sql.startsWith('SELECT * FROM activity_users WHERE username=?'))return user;
        if(sql.startsWith('SELECT u.* FROM activity_sessions'))return session?user:null;
        throw new Error('Unexpected read SQL in fixture');
      },
      async run(){
        if(sql.startsWith('INSERT INTO activity_sessions')){
          session=this.values;return {success:true};
        }
        throw new Error('Unexpected write SQL in fixture');
      }
    };
    return statement;
  }};
  const env={
    DB:db,ENABLE_LIVE:'true',SYNTHETIC_ONLY:'true',
    PUBLIC_ORIGIN:'https://activity-stage.10273055.xyz',
    AUTH_RATE_LIMIT:{limit:async()=>({success:true})},
    ASSETS:{fetch:async()=>new Response('STATIC')}
  };
  const req=new Request('https://activity-stage.10273055.xyz/api/login',{
    method:'POST',
    headers:{
      'Origin':'https://activity-stage.10273055.xyz',
      'X-Bombax-Action':'1',
      'CF-Connecting-IP':'127.0.0.1',
      'Content-Type':'application/json'
    },
    body:JSON.stringify({username:user.username,password})
  });
  return {env,req,user};
}
test('Synthetic 100k account successfully signs in and receives HttpOnly cookie',async()=>{
  const {env,req,user}=authFixture();
  const res=await backend.fetch(req,env);
  assert.equal(res.status,200,JSON.stringify(await res.clone().json()));
  const data=await res.json();
  assert.equal(data.user.username,user.username);
  const cookie=res.headers.get('Set-Cookie')||'';
  assert.match(cookie,/^bqx_live=[a-f0-9]{64};/);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Secure/);
  const me=await backend.fetch(new Request('https://activity-stage.10273055.xyz/api/me',{
    headers:{Cookie:cookie.split(';')[0]}
  }),env);
  assert.equal(me.status,200);
  assert.equal((await me.json()).user.username,user.username);
});
test('Legacy 240k account is refused with actionable migration error instead of HTTP 500',async()=>{
  const {env,req}=authFixture(240000);
  const res=await backend.fetch(req,env);
  assert.equal(res.status,503);
  assert.match((await res.json()).error,/不兼容|迁移/);
});
