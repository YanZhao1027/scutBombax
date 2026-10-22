import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import backend from '../worker.mjs';
const ORIGIN='http://127.0.0.1:3319';
const tok=()=>randomBytes(32).toString('hex');

export function fixture({
  origin=ORIGIN,synthetic=true,ready=true,rateAllowed=true,
  loginAllowed=true,withUploads=true
}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));
  const storage=new Map();
  const R2={
    async put(key,value){storage.set(key,new Uint8Array(value));return {key};},
    async get(key){const bytes=storage.get(key);return bytes?{body:new Blob([bytes])}:null;},
    async delete(key){storage.delete(key);}
  };
  const DB={
    prepare(sql){
      const st=sqlite.prepare(sql);
      return {
        args:[],bind(...args){this.args=args;return this;},
        async first(){return st.get(...this.args)||null;},
        async all(){return {results:st.all(...this.args)};},
        async run(){return {success:true,meta:st.run(...this.args)};}
      };
    },
    async batch(commands){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(const stmt of commands)out.push(await stmt.run());
        sqlite.exec('COMMIT');return out;
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  const rootToken=tok();
  let allowLogin=loginAllowed;
  const env={
    DB,MATERIALS:withUploads?R2:null,LITE_ROOT_TOKEN:rootToken,
    LITE_ENABLED:ready?'true':'false',SYNTHETIC_ONLY:synthetic?'true':'false',
    PUBLIC_ORIGIN:origin,LOCAL_QA:'true',
    APPLY_RATE_LIMIT:{limit:async()=>({success:rateAllowed})},
    STAFF_LOGIN_LIMIT:{limit:async()=>({success:allowLogin})},
    ASSETS:{fetch:async()=>new Response('no static assets',{status:404})}
  };
  async function api(path,{method='GET',data,headers={},cookie}={}){
    const h={...headers};
    if(cookie)h.Cookie=cookie;
    if(method!=='GET'){
      h['X-Lite-Action']='1';
      h.Origin=origin;
      h['CF-Connecting-IP']='127.0.0.1';
      if(!(data instanceof FormData))h['Content-Type']='application/json';
    }
    const req=new Request(origin+path,{method,headers:h,
      ...(method==='GET'?{}:{body:data instanceof FormData?data:JSON.stringify(data||{})})});
    const response=await backend.fetch(req,env);
    const type=response.headers.get('Content-Type')||'';
    let result;
    if(type.includes('application/json'))result=await response.json();
    else if(type.includes('text/csv'))result=await response.text();
    else result=Buffer.from(await response.arrayBuffer());
    return {status:response.status,data:result,headers:response.headers};
  }
  async function login(eventId,username,password){
    const res=await api('/api/staff/login',{method:'POST',
      data:{eventId,username,password}});
    return {...res,cookie:(res.headers.get('set-cookie')||'').split(';')[0]};
  }
  async function event({start=Date.now()-1000,end=Date.now()+3600000,
    material=true,adminUsername='qa_admin',adminDisplayName='测试负责人'}={}){
    const adminPassword=tok().slice(0,27)+'!Aa';
    const res=await api('/api/events',{method:'POST',headers:{'X-Lite-Root':rootToken},
      data:{title:'测试社团活动',place:'测试教学楼101',startsAt:start,endsAt:end,
        instructions:'仅用于虚构数据联调',requireMaterial:material,
        adminUsername,adminDisplayName,adminPassword}});
    if(res.status!==201)throw Error(JSON.stringify(res));
    const logged=await login(res.data.event.id,adminUsername,adminPassword);
    if(logged.status!==200)throw Error('Admin fixture login failed: '+JSON.stringify(logged.data));
    return {...res.data,id:res.data.event.id,adminUsername,adminPassword,
      adminCookie:logged.cookie};
  }
  async function member(event,{username='qa_scanner',permissions={
    review:false,scan:true,export:false,manual:false
  }}={}){
    const password=tok().slice(0,27)+'!Aa';
    const created=await api('/api/staff/accounts',{method:'POST',cookie:event.adminCookie,
      data:{eventId:event.id,username,displayName:'测试'+username,password,permissions}});
    if(created.status!==201)throw Error('Member creation failed: '+JSON.stringify(created));
    const logged=await login(event.id,username,password);
    if(logged.status!==200)throw Error('Member login failed: '+JSON.stringify(logged));
    return {id:created.data.id,username,password,cookie:logged.cookie,permissions};
  }
  function form({name='测试学生甲',studentNumber='TEST-2026-01',
    contact='TEST-WECHAT-01',note='测试参加活动',material=true,privacyAck=true}={}){
    const data=new FormData();
    data.set('name',name);data.set('studentNumber',studentNumber);
    data.set('contact',contact);data.set('note',note);
    if(privacyAck)data.set('privacyAck','yes');
    if(material){
      const sample=new Uint8Array(32);
      sample.set([137,80,78,71,13,10,26,10],0);
      data.set('material',new Blob([sample],{type:'image/png'}),'test.png');
    }
    return data;
  }
  return {sqlite,env,storage,rootToken,api,login,event,member,form,
    denyLogin(){allowLogin=false;},close(){sqlite.close();}};
}
