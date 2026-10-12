import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {hashPassword,newId,openDB} from '../db.mjs';

async function fixture(){
  const dir=mkdtempSync(path.join(tmpdir(),'bombax-live-'));
  const app=createApp({dbPath:path.join(dir,'test.sqlite'),uploadDir:path.join(dir,'uploads')});
  await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
  const host='http://127.0.0.1:'+app.server.address().port;
  const cookies={};
  async function api(url,as='anon',method='GET',data,extra={}){
    const headers={...extra.headers};
    if(method!=='GET')headers['X-Bombax-Action']='1';
    if(data!==undefined)headers['Content-Type']='application/json';
    if(cookies[as])headers.Cookie=cookies[as];
    const res=await fetch(host+url,{method,headers,body:data===undefined?extra.body:JSON.stringify(data)});
    const cookie=res.headers.get('set-cookie');
    if(cookie)cookies[as]=cookie.split(';')[0];
    const type=res.headers.get('content-type')||'';
    return {status:res.status,data:type.includes('json')?await res.json():type.includes('text/csv')?await res.text():await res.arrayBuffer()};
  }
  return {app,dir,api,async close(){await new Promise(ok=>app.server.close(ok));app.db.close();rmSync(dir,{recursive:true,force:true});}};
}
const now=()=>Date.now();
const password='SyntheticTestPassword456!';
test('Four parallel duties: late submission, manual presence, delayed review, export',async t=>{
  const f=await fixture();t.after(()=>f.close());const {api,app}=f;
  for(const username of ['boss','scanner','reviewer','manual']){
    app.db.prepare('INSERT INTO users (id,username,password_hash,role,display_name,created_at) VALUES (?,?,?,?,?,?)')
      .run(newId(),username,hashPassword(password),'organizer','Synthetic Organizer',now());
  }
  const login=async(username)=>assert.equal((await api('/api/login',username,'POST',{username,password})).status,200);
  for(const username of ['boss','scanner','reviewer','manual'])await login(username);
  for(const username of ['late_student','quick_student']){
    assert.equal((await api('/api/register','anon','POST',{
      username,password,studentId:username==='late_student'?'TEST-100':'TEST-200',displayName:username
    })).status,201);
    await login(username);
  }
  const created=await api('/api/activities','boss','POST',{
    title:'Synthetic Workshop',description:'demo-only',latitude:23.1,longitude:113.3,
    radiusM:150,startAt:now()-3000,endAt:now()+3600000,requireAttachment:true
  });
  assert.equal(created.status,201);
  const ep='/api/activities/'+created.data.id;
  for(const [username,duty] of [['scanner','scanner'],['reviewer','reviewer'],['manual','manual']]){
    assert.equal((await api(ep+'/staff','boss','POST',{username,duty})).status,200);
  }
  assert.equal((await api(ep+'/join','late_student','POST',{note:'arrived with no screenshot'})).status,201);
  assert.equal((await api(ep+'/join','quick_student','POST',{note:'ready'})).status,201);
  const rows=(await api(ep+'/registrations','boss')).data.registrations;
  const late=rows.find(r=>r.student_id==='TEST-100'),quick=rows.find(r=>r.student_id==='TEST-200');
  assert.equal((await api(ep+'/manual-checkin','scanner','POST',{registrationId:late.id,identityChecked:true,reason:'test'})).status,403);
  assert.equal((await api(ep+'/manual-checkin','reviewer','POST',{registrationId:late.id,identityChecked:true,reason:'test'})).status,403);
  assert.equal((await api(ep+'/manual-checkin','manual','POST',{registrationId:late.id,identityChecked:false,reason:'test'})).status,400);
  assert.equal((await api(ep+'/manual-checkin','manual','POST',{registrationId:late.id,identityChecked:true,reason:'  '})).status,400);
  const arrival=await api(ep+'/manual-checkin','manual','POST',{registrationId:late.id,identityChecked:true,reason:'indoor GPS drift'});
  assert.equal(arrival.status,200);
  assert.equal(arrival.data.reviewPending,true);
  assert.equal((await api(ep+'/manual-checkin','manual','POST',{registrationId:late.id,identityChecked:true,reason:'repeat'})).status,409);
  assert.equal((await api(ep+'/ticket','late_student','POST',{latitude:23.1,longitude:113.3,accuracyM:5})).status,403);
  const noExport=await api(ep+'/export','boss');
  assert.equal(noExport.status,200);assert.doesNotMatch(noExport.data,/TEST-100/);
  assert.equal((await api(ep+'/review','scanner','POST',{registrationId:late.id,state:'approved'})).status,403);
  assert.equal((await api(ep+'/review','manual','POST',{registrationId:late.id,state:'approved'})).status,403);
  assert.equal((await api(ep+'/review','reviewer','POST',{registrationId:late.id,state:'approved'})).status,409);
  const png=Buffer.from([137,80,78,71,13,10,26,10,20,30,40,50,60,70,80,90]);
  async function upload(student){
    return api(ep+'/upload',student,'POST',undefined,{headers:{'X-Bombax-Filename':'synthetic.png'},body:png});
  }
  assert.equal((await upload('late_student')).status,201);
  assert.equal((await upload('quick_student')).status,201);
  const pending=(await api(ep+'/registrations','reviewer')).data.registrations;
  assert.equal(pending[0].id,late.id);
  assert.equal(pending[0].state,'pending');
  assert.equal(pending[0].channel,'manual');
  assert.equal((await api(ep+'/review','reviewer','POST',{registrationId:late.id,state:'approved',note:'materials complete'})).status,200);
  assert.equal((await api(ep+'/review','reviewer','POST',{registrationId:quick.id,state:'approved'})).status,200);
  const state=(await api(ep,'late_student')).data.registration;
  assert.equal(state.state,'approved');
  assert.equal(state.checkinChannel,'manual');
  const token=(await api(ep+'/ticket','quick_student','POST',{latitude:23.1,longitude:113.3,accuracyM:5})).data.token;
  const scannerRedeem=await api(ep+'/redeem','scanner','POST',{token});
  assert.equal(scannerRedeem.status,200);
  assert.equal((await api(ep+'/redeem','manual','POST',{token})).status,403);
  assert.equal((await api(ep+'/redeem','scanner','POST',{token})).status,409);
  const exportFile=await api(ep+'/export','reviewer');
  assert.equal(exportFile.status,200);
  for(const expected of ['TEST-100','TEST-200','人工通道','快速扫码','indoor GPS drift'])assert.match(exportFile.data,new RegExp(expected));
  assert.equal((await api(ep+'/export','scanner')).status,403);
  const scannerRows=(await api(ep+'/registrations','scanner')).data.registrations;
  assert.equal(scannerRows[0].student_id,undefined);
  assert.equal((await api(ep+'/registrations','manual')).data.registrations[0].note,undefined);
  const attach=(await api(ep+'/my-attachments','late_student')).data.attachments[0].id;
  assert.equal((await api('/api/attachments/'+attach,'scanner')).status,403);
  assert.equal((await api('/api/attachments/'+attach,'manual')).status,403);
  assert.equal((await api('/api/attachments/'+attach,'reviewer')).status,200);
  // Unlike already scanned check-ins, manual arrivals may be re-reviewed and audited.
  assert.equal((await api(ep+'/review','reviewer','POST',{registrationId:late.id,state:'rejected',note:'updated evidence'})).status,200);
  const laterExport=await api(ep+'/export','boss');
  assert.doesNotMatch(laterExport.data,/TEST-100/);
  assert.match(laterExport.data,/TEST-200/);
  assert.equal((await api(ep+'/review','reviewer','POST',{registrationId:quick.id,state:'rejected'})).status,409);
});
test('Existing databases retain data and add new columns non-destructively',()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'bombax-migrate-'));
  try{
    const file=path.join(folder,'legacy.sqlite');
    const db=openDB(file);
    db.exec('CREATE TABLE IF NOT EXISTS migration_probe (value TEXT)');
    db.prepare('INSERT INTO migration_probe(value) VALUES (?)').run('keep-existing-data');
    db.close();
    const reopened=openDB(file);
    assert.equal(reopened.prepare('SELECT value FROM migration_probe').get().value,'keep-existing-data');
    for(const [table,column] of [['staff','duty'],['registrations','updated_at'],['checkins','channel'],['checkins','reason']])
      assert.ok(reopened.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===column));
    reopened.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});
