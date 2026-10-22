/**
 * USB QA only: isolated in-memory SQLite with the REAL Cloudflare Worker.
 * adb reverse tcp:3318 tcp:3318
 * Launch the Android DEBUG Activity with destination=qa.
 * Binds 127.0.0.1 exclusively. No official school or live production data.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import worker from '../cloudflare-live/worker.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'cloudflare-live/public');
const HOST='127.0.0.1',PORT=3318,ORIGIN='http://127.0.0.1:3318';
const sha=v=>createHash('sha256').update(v).digest('hex');
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for(const name of ['0001_init.sql','0002_password_iterations.sql','0003_manual_exception_lookup.sql'])
  db.exec(fs.readFileSync(path.join(root,'cloudflare-live/migrations',name),'utf8'));
const D1={
  prepare(sql){
    const stmt=db.prepare(sql);
    return {
      values:[],bind(...v){this.values=v;return this;},
      async first(){return stmt.get(...this.values)||null;},
      async all(){return {results:stmt.all(...this.values)};},
      async run(){return {success:true,meta:stmt.run(...this.values)};}
    };
  },
  async batch(statements){
    db.exec('BEGIN IMMEDIATE');
    try{
      const out=[];
      for(const statement of statements)out.push(await statement.run());
      db.exec('COMMIT');return out;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
};
const users={},sessions={};
function makeUser(key,role,number,name){
  const id=randomUUID(),salt=randomBytes(16).toString('hex'),
    token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO activity_users(id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id,'demo_usb_'+key,salt,'0'.repeat(64),100000,role,number||null,name,Date.now());
  db.prepare('INSERT INTO activity_sessions(digest,user_id,expires_at) VALUES (?,?,?)')
    .run(sha(token),id,Date.now()+6*3600000);
  users[key]=id;sessions[key]=token;
}
makeUser('owner','organizer',null,'测试活动负责人');
makeUser('scanner','organizer',null,'测试扫码员');
makeUser('manual','organizer',null,'测试人工窗口');
makeUser('reviewer','organizer',null,'测试材料审核员');
makeUser('student','student','TEST-USB-001','测试学生甲');
makeUser('second','student','TEST-USB-002','测试学生乙');
const event=randomUUID(),rid1=randomUUID(),rid2=randomUUID(),started=Date.now()-60000,ends=Date.now()+3600000;
db.prepare('INSERT INTO activity_events(id,owner_id,title,guidelines,lat,lon,radius_m,starts_at,ends_at,require_photo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(event,users.owner,'USB 实机异常核验演练','仅限虚构数据',23.1,113.3,150,started,ends,0,Date.now());
for(const [key,duty] of [['scanner','scanner'],['manual','manual'],['reviewer','reviewer']])
  db.prepare('INSERT INTO activity_staff(event_id,user_id,duty) VALUES (?,?,?)').run(event,users[key],duty);
for(const [rid,uid] of [[rid1,users.student],[rid2,users.second]])
  db.prepare("INSERT INTO activity_registrations(id,event_id,user_id,state,created_at,updated_at) VALUES (?,?,?,'approved',?,?)")
    .run(rid,event,uid,Date.now(),Date.now());
const env={DB:D1,ENABLE_LIVE:'true',SYNTHETIC_ONLY:'true',PUBLIC_ORIGIN:ORIGIN,
  ASSIST_RATE_LIMIT:{limit:async()=>({success:true})},
  AUTH_RATE_LIMIT:{limit:async()=>({success:true})},
  ASSETS:{fetch:async()=>new Response('Not found',{status:404})}};
const roles=['scanner','manual','owner','reviewer','student','second'];
function activeRole(req){
  const token=(req.headers.cookie||'').split(';').map(x=>x.trim())
    .find(v=>v.startsWith('bqx_live='))?.slice(9)||'';
  return roles.find(role=>sessions[role]===token)||null;
}
function send(res,status,value,type='application/json; charset=utf-8',extra={}){
  const body=Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value);
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY',...extra});
  res.end(body);
}
async function localWorker(pathname,role,data){
  const headers={'Cookie':'bqx_live='+sessions[role],
    'Origin':ORIGIN,'X-Bombax-Action':'1','Content-Type':'application/json'};
  return worker.fetch(new Request(ORIGIN+pathname,{method:'POST',headers,body:JSON.stringify(data)}),env);
}
const staticNames={
  '/':'index.html','/index.html':'index.html','/style.css':'style.css',
  '/material3.css':'material3.css','/scanner.css':'scanner.css',
  '/zxing.js':'zxing.js','/scan-utils.js':'scan-utils.js','/app.js':'app.js',
  '/demo-proof.png':'demo-proof.png'
};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==HOST+':'+PORT)return send(res,403,{error:'USB loopback only'});
    const url=new URL(req.url,ORIGIN),pathname=url.pathname,role=activeRole(req);
    if(req.method==='GET'&&pathname.startsWith('/__qa/role/')){
      const next=pathname.split('/').at(-1);
      if(!roles.includes(next))return send(res,404,{error:'Unknown fixture role'});
      return send(res,303,'','text/plain',{'Location':'/',
        'Set-Cookie':'bqx_live='+sessions[next]+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=21600'});
    }
    if(!role&&pathname==='/')return send(res,303,'','text/plain',{'Location':'/__qa/role/scanner'});
    if(req.method==='GET'&&pathname==='/__qa/hook.js')
      return send(res,200,fs.readFileSync(path.join(root,'scripts/phone-qa-hook.js')),'text/javascript; charset=utf-8');
    if(req.method==='GET'&&pathname==='/__qa/toolbar.js')
      return send(res,200,fs.readFileSync(path.join(root,'scripts/phone-qa-toolbar.js')),'text/javascript; charset=utf-8');
    if(req.method==='GET'&&pathname==='/__qa/hint'){
      const row=db.prepare('SELECT recovery_code FROM activity_registrations WHERE id=?').get(rid1);
      return send(res,200,{synthetic:true,recoveryCode:row.recovery_code,
        event:'USB 实机异常核验演练'});
    }
    if(req.method==='GET'&&pathname==='/__qa/state'){
      const at=db.prepare('SELECT registration_id,channel FROM activity_attendance ORDER BY attended_at').all();
      const lookups=db.prepare('SELECT reason_code,matched FROM activity_exception_lookup').all();
      const actions=db.prepare('SELECT action,COUNT(*) count FROM activity_audit GROUP BY action').all();
      return send(res,200,{synthetic:true,attendance:at.map(x=>({
        student:x.registration_id===rid1?'studentA':'studentB',channel:x.channel})),
        lookups,actions,registrationCount:2});
    }
    if(req.method==='POST'&&pathname==='/__qa/expired'){
      if(role!=='scanner'||req.headers['x-bombax-action']!=='1')
        return send(res,403,{error:'Only scanner in USB fixture'});
      const response=await localWorker('/api/events/'+event+'/ticket','student',
        {latitude:23.1,longitude:113.3,accuracyM:5});
      const result=await response.json();
      if(response.status!==200)return send(res,response.status,result);
      const digest=sha(result.token),expired=Date.now()-1000;
      db.prepare('UPDATE activity_tickets SET expires_at=? WHERE digest=?').run(expired,digest);
      db.prepare('UPDATE activity_ticket_history SET expires_at=? WHERE digest=?').run(expired,digest);
      return send(res,200,{synthetic:true,token:result.token});
    }
    if(pathname.startsWith('/api/')){
      let size=0;const chunks=[];
      for await(const chunk of req){
        size+=chunk.length;if(size>4*1024*1024)return send(res,413,{error:'QA body too large'});
        chunks.push(chunk);
      }
      const headers={...req.headers};
      const response=await worker.fetch(new Request(ORIGIN+pathname+url.search,{
        method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})
      }),env);
      const raw=Buffer.from(await response.arrayBuffer());
      const h=Object.fromEntries(response.headers);h['Cache-Control']='no-store';
      h['Content-Length']=String(raw.length);
      res.writeHead(response.status,h);return res.end(raw);
    }
    if(req.method==='GET'&&staticNames[pathname]){
      const name=staticNames[pathname],file=path.join(assets,name);
      let data=fs.readFileSync(file);
      if(name==='index.html'){
        data=Buffer.from(data.toString('utf8').replace('<script defer src="/app.js"></script>',
          '<script defer src="/__qa/hook.js"></script><script defer src="/app.js"></script><script defer src="/__qa/toolbar.js"></script>'));
      }
      const type=name.endsWith('.css')?'text/css; charset=utf-8':
        name.endsWith('.js')?'text/javascript; charset=utf-8':
        name.endsWith('.png')?'image/png':'text/html; charset=utf-8';
      return send(res,200,data,type);
    }
    return send(res,404,{error:'Not found in USB fixture'});
  }catch(error){
    console.error('QA-only handler failure',String(error.message).slice(0,160));
    return send(res,500,{error:'Isolated QA runtime failure'});
  }
});
server.listen(PORT,HOST,()=>console.log(
  'USB synthetic QA READY http://'+HOST+':'+PORT+' (real Worker + SQLite/D1; no campus data)'));
process.on('SIGINT',()=>{server.close();db.close();});
