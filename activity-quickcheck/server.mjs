import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { openDB,newId,hashPassword,validPassword,hashToken,safeUser,distanceMeters,makeCsv } from './db.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const MAX_JSON=32*1024, MAX_UPLOAD=3*1024*1024;
const SESSION_MS=12*60*60*1000, TICKET_MS=45*1000;
const now=()=>Date.now();
const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
function error(status,message) { const e=new Error(message);e.status=status;throw e; }
function assert(ok,status,message){if(!ok)error(status,message);}
function text(v,max=200){assert(typeof v==='string'&&v.trim()&&v.length<=max,400,'字段无效或过长');return v.trim();}
function bodyJSON(bytes){try{return JSON.parse(bytes.toString('utf8'))}catch{error(400,'JSON 格式不正确')}}
function setJSON(res,status,obj,headers={}){res.writeHead(status,{...jsonHeaders,...headers});res.end(JSON.stringify(obj));}
function cookieName(){return 'bombax_activity_session';}
function parseCookie(req){
  const match=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName()+'='));
  return match?match.slice(cookieName().length+1):'';
}
function secureCookies(req){return Boolean(req.socket.encrypted||process.env.ACTIVITY_TRUST_PROXY_HTTPS==='1') ? '; Secure' : '';}
function sessionHeader(req,token,expire=SESSION_MS){
  return cookieName()+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.floor(expire/1000)+secureCookies(req);
}
function contentType(file){return file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'application/octet-stream';}
function allowedOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site']==='same-origin' || req.headers['sec-fetch-site']==='none';
  try{
    const url=new URL(origin);
    if (process.env.ACTIVITY_PUBLIC_ORIGIN) return url.origin===new URL(process.env.ACTIVITY_PUBLIC_ORIGIN).origin;
    return url.host===req.headers.host && ['http:','https:'].includes(url.protocol);
  } catch{return false}
}
function checkMutation(req){
  assert(allowedOrigin(req),403,'跨站请求已拒绝');
  assert(req.headers['x-bombax-action']==='1',403,'请求缺少必要的同源标记');
}
async function readBody(req,limit=MAX_JSON){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;assert(size<=limit,413,'上传内容太大');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function activityPlain(row){return {id:row.id,title:row.title,description:row.description,
  latitude:row.latitude,longitude:row.longitude,radiusM:row.radius_m,
  startAt:row.start_at,endAt:row.end_at,requireAttachment:Boolean(row.require_attachment)};}
function auth(db,req){
  const token=parseCookie(req);
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const user=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token),now());
  return user||null;
}
function requireRole(user,role){assert(user,401,'请先登录');assert(user.role===role,403,'没有权限');}
function activityAccess(db,user,id,allowed=['owner','scanner','reviewer','manual']){
  assert(user,401,'请先登录');
  const a=db.prepare('SELECT * FROM activities WHERE id=?').get(id);
  assert(a,404,'活动不存在');
  assert(user.role==='organizer',403,'没有该活动管理权限');
  const duty=a.owner_id===user.id ? 'owner' :
    db.prepare('SELECT duty FROM staff WHERE activity_id=? AND user_id=?').get(id,user.id)?.duty;
  assert(duty && allowed.includes(duty),403,'没有此岗位的操作权限');
  return {...a,duty};
}
function registration(db,user,aid){
  assert(user,401,'请先登录');
  return db.prepare('SELECT * FROM registrations WHERE activity_id=? AND user_id=?').get(aid,user.id);
}
function joinRows(db,aid){
  // Prioritize students already physically witnessed who are still awaiting materials.
  return db.prepare("SELECT r.id,r.user_id,r.note,r.state,r.review_note,r.created_at,r.updated_at,r.reviewed_at,u.display_name,u.student_id,c.checked_at,c.channel,c.reason,(SELECT COUNT(*) FROM attachments at WHERE at.registration_id=r.id) AS attachment_count FROM registrations r JOIN users u ON u.id=r.user_id LEFT JOIN checkins c ON c.registration_id=r.id WHERE r.activity_id=? ORDER BY CASE WHEN r.state='pending' AND c.channel='manual' THEN 0 WHEN r.state='pending' THEN 1 ELSE 2 END, r.updated_at DESC").all(aid);
}
function fileAuthorized(db,user,attachmentId){
  assert(user,401,'请先登录');
  const at=db.prepare('SELECT at.*,r.user_id,r.activity_id FROM attachments at JOIN registrations r ON r.id=at.registration_id WHERE at.id=?').get(attachmentId);
  assert(at,404,'附件不存在');
  if(at.user_id!==user.id)activityAccess(db,user,at.activity_id,['owner','reviewer']);
  return at;
}
function geoAccept(activity,obj) {
  const {latitude,longitude,accuracyM}=obj;
  assert([latitude,longitude,accuracyM].every(Number.isFinite),400,'无法读取有效定位');
  assert(Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&accuracyM>=0,400,'定位值不合法');
  // Deliberately refuse low-precision fixes. Override requires staff confirmation outside this flow.
  assert(accuracyM<=120,422,'定位精度不足，请移到室外重新尝试或申请人工复核');
  const meters=distanceMeters(latitude,longitude,activity.latitude,activity.longitude);
  assert(meters<=activity.radius_m,422,'当前位置不在活动签到范围内');
  return true;
}
function parseToken(value){return /^bqx_[a-f0-9]{64}$/.test(value||'')?value:'';}
function validateUpload(bytes){
  let mime='';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217)mime='image/jpeg';
  else if(bytes.subarray(0,4).toString()==='%PDF')mime='application/pdf';
  assert(mime,415,'仅允许 PNG、JPEG 或 PDF 文件');
  return mime;
}

export function createApp({dbPath=path.join(root,'var/activity.sqlite'),uploadDir=path.join(root,'var/uploads')}={}){
  fs.mkdirSync(uploadDir,{recursive:true,mode:0o700});
  const db=openDB(dbPath);
  const ipTries=new Map();
  function throttle(req){
    const address=req.socket.remoteAddress||'local',slot=ipTries.get(address)||{count:0,time:now()};
    if(now()-slot.time>15*60*1000){slot.count=0;slot.time=now();}
    slot.count++;
    ipTries.set(address,slot);
    assert(slot.count<=50,429,'登录尝试过于频繁');
  }
  async function api(req,res,u){
    const method=req.method,pathName=u.pathname;
    if(method==='GET'&&pathName==='/api/health')return setJSON(res,200,{ok:true,product:'花工木棉 活动速签',demo:true});
    const user=auth(db,req);
    if(method==='GET'&&pathName==='/api/me')return setJSON(res,200,{user:safeUser(user)});
    if(['POST','PATCH','DELETE'].includes(method))checkMutation(req);
    if(method==='POST'&&pathName==='/api/register'){
      throttle(req);
      const data=bodyJSON(await readBody(req));
      const username=text(data.username,32),name=text(data.displayName,40);
      const studentId=text(data.studentId,32);
      assert(/^[a-zA-Z0-9_]{3,32}$/.test(username),400,'用户名仅允许字母、数字和下划线');
      assert(/^[a-zA-Z0-9-]{4,32}$/.test(studentId),400,'学号格式不符合要求');
      const id=newId();
      db.prepare('INSERT INTO users (id,username,password_hash,role,student_id,display_name,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id,username,hashPassword(data.password),'student',studentId,name,now());
      return setJSON(res,201,{ok:true,notice:'自填学号尚未经学校认证，请勿视为官方实名'});
    }
    if(method==='POST'&&pathName==='/api/login'){
      throttle(req);
      const data=bodyJSON(await readBody(req)),username=text(data.username,32);
      const found=db.prepare('SELECT * FROM users WHERE username=?').get(username);
      assert(found && validPassword(data.password,found.password_hash),401,'账号或密码不正确');
      const token=randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
        .run(hashToken(token),found.id,now()+SESSION_MS);
      return setJSON(res,200,{user:safeUser(found)}, {'Set-Cookie':sessionHeader(req,token)});
    }
    if(method==='POST'&&pathName==='/api/logout'){
      if(user){const token=parseCookie(req);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));}
      return setJSON(res,200,{ok:true},{'Set-Cookie':sessionHeader(req,'',0)});
    }
    if(method==='POST'&&pathName==='/api/qr'){
      requireRole(user,'student');
      const data=bodyJSON(await readBody(req));
      const token=parseToken(data.token);
      assert(token,400,'签到码格式无效');
      const row=db.prepare("SELECT r.user_id,r.state,t.expires_at,c.id AS checked FROM tickets t JOIN registrations r ON r.id=t.registration_id LEFT JOIN checkins c ON c.registration_id=r.id WHERE t.token_hash=?").get(hashToken(token));
      assert(row&&row.user_id===user.id&&row.state==='approved'&&!row.checked&&row.expires_at>=now(),403,'二维码已失效');
      const png=await QRCode.toBuffer(token,{type:'png',width:350,errorCorrectionLevel:'M',margin:2});
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Content-Length':png.length});
      return res.end(png);
    }
    if(method==='GET'&&pathName==='/api/activities'){
      const rows=db.prepare('SELECT * FROM activities ORDER BY start_at DESC LIMIT 100').all();
      return setJSON(res,200,{activities:rows.map(activityPlain)});
    }
    if(method==='POST'&&pathName==='/api/activities'){
      requireRole(user,'organizer');
      const data=bodyJSON(await readBody(req));
      const lat=Number(data.latitude),lon=Number(data.longitude),radius=Number(data.radiusM);
      const start=Number(data.startAt),end=Number(data.endAt);
      assert([lat,lon,radius,start,end].every(Number.isFinite),400,'活动坐标或时间无效');
      assert(Math.abs(lat)<=90&&Math.abs(lon)<=180&&radius>=50&&radius<=1000,400,'坐标或定位半径无效');
      assert(end>start&&end-start<=7*86400000&&end>now(),400,'活动时间范围无效');
      const id=newId();
      db.prepare('INSERT INTO activities (id,owner_id,title,description,latitude,longitude,radius_m,start_at,end_at,require_attachment,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,user.id,text(data.title,100),String(data.description||'').slice(0,2000),lat,lon,radius,start,end,data.requireAttachment===false?0:1,now());
      return setJSON(res,201,{id});
    }
    const activity=u.pathname.match(/^\/api\/activities\/([a-f0-9]{36})(?:\/(.*))?$/);
    if(activity){
      const aid=activity[1],action=activity[2]||'';
      const event=db.prepare('SELECT * FROM activities WHERE id=?').get(aid);
      assert(event,404,'活动不存在');
      if(method==='GET'&&action===''){
        const mine=user?.role==='student'?registration(db,user,aid):null;
        const checkin=mine?db.prepare('SELECT checked_at,channel FROM checkins WHERE registration_id=?').get(mine.id):null;
        return setJSON(res,200,{activity:activityPlain(event),
          registration:mine?{state:mine.state,reviewNote:mine.review_note,note:mine.note,
            checkedAt:checkin?.checked_at||null,checkinChannel:checkin?.channel||null}:null});
      }
      if(method==='POST'&&action==='join'){
        requireRole(user,'student');
        assert(now()<=event.end_at,409,'活动已结束');
        const data=bodyJSON(await readBody(req));
        assert(!registration(db,user,aid),409,'已报名该活动');
        const id=newId();
        db.prepare('INSERT INTO registrations (id,activity_id,user_id,note,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(id,aid,user.id,String(data.note||'').slice(0,500),'pending',now(),now());
        return setJSON(res,201,{id,state:'pending'});
      }
      if(method==='POST'&&action==='upload'){
        requireRole(user,'student');
        const reg=registration(db,user,aid);
        assert(reg,403,'请先报名');
        assert(now()<event.end_at,409,'活动已结束');
        assert(!db.prepare("SELECT 1 FROM checkins WHERE registration_id=? AND channel='scan'").get(reg.id),409,'二维码签到已核销，不允许再补材料');
        const count=db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE registration_id=?').get(reg.id).n;
        assert(count<3,409,'每次报名最多三个附件');
        const name=text(decodeURIComponent(req.headers['x-bombax-filename']||'附件'),100);
        const bytes=await readBody(req,MAX_UPLOAD);
        assert(bytes.length>=10,400,'附件为空或损坏');
        const mime=validateUpload(bytes);
        const id=newId(),destination=path.join(uploadDir,id);
        fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
        try{
          db.exec('BEGIN IMMEDIATE');
          assert(!db.prepare("SELECT 1 FROM checkins WHERE registration_id=? AND channel='scan'").get(reg.id),409,'二维码签到已核销');
          assert(db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE registration_id=?').get(reg.id).n<3,409,'每人最多三份附件');
          db.prepare('INSERT INTO attachments (id,registration_id,filename,mime,bytes,created_at) VALUES (?,?,?,?,?,?)')
            .run(id,reg.id,name,mime,bytes.length,now());
          db.prepare("UPDATE registrations SET state='pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=MAX(updated_at+1,?) WHERE id=?")
            .run(now(),reg.id);
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');fs.rmSync(destination,{force:true});throw e;}
        return setJSON(res,201,{id,mime,bytes:bytes.length});
      }
      if(method==='GET'&&action==='my-attachments'){
        requireRole(user,'student');
        const reg=registration(db,user,aid);
        assert(reg,404,'请先报名');
        return setJSON(res,200,{attachments:db.prepare('SELECT id,filename,mime,bytes FROM attachments WHERE registration_id=?').all(reg.id)});
      }
      if(method==='POST'&&action==='ticket'){
        requireRole(user,'student');
        const reg=registration(db,user,aid);
        assert(reg&&reg.state==='approved',403,'报名尚未审核通过');
        assert(now()>=event.start_at&&now()<=event.end_at,409,'不在签到时间内');
        assert(!db.prepare('SELECT 1 FROM checkins WHERE registration_id=?').get(reg.id),409,'该报名已签到');
        const data=bodyJSON(await readBody(req));
        geoAccept(event,data); // Coordinates used for evaluation only; not stored or logged.
        const token='bqx_'+randomBytes(32).toString('hex'),issued=now();
        db.prepare('INSERT INTO tickets (id,registration_id,token_hash,expires_at,issued_at) VALUES (?,?,?,?,?) ON CONFLICT(registration_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,issued_at=excluded.issued_at')
          .run(newId(),reg.id,hashToken(token),issued+TICKET_MS,issued);
        return setJSON(res,200,{token,expiresAt:issued+TICKET_MS});
      }
      if(method==='POST'&&action==='staff'){
        const a=activityAccess(db,user,aid,['owner']);
        const data=bodyJSON(await readBody(req));
        assert(['scanner','reviewer','manual'].includes(data.duty),400,'必须指定扫码、审核或人工通道岗位');
        const target=db.prepare('SELECT * FROM users WHERE username=? AND role=?').get(text(data.username,32),'organizer');
        assert(target,404,'仅可添加已创建的主办方账号');
        db.prepare('INSERT INTO staff (activity_id,user_id,duty) VALUES (?,?,?) ON CONFLICT(activity_id,user_id) DO UPDATE SET duty=excluded.duty').run(aid,target.id,data.duty);
        return setJSON(res,200,{ok:true,duty:data.duty});
      }
      if(method==='GET'&&action==='registrations'){
        const access=activityAccess(db,user,aid);
        const rows=joinRows(db,aid);
        const visible=access.duty==='scanner' ? rows.map(row=>({
          id:row.id,state:row.state,checked_at:row.checked_at,channel:row.channel
        })) : access.duty==='manual' ? rows.map(row=>({
          id:row.id,display_name:row.display_name,student_id:row.student_id,
          state:row.state,checked_at:row.checked_at,channel:row.channel
        })) : rows;
        return setJSON(res,200,{duty:access.duty,registrations:visible});
      }
      if(method==='POST'&&action==='review'){
        activityAccess(db,user,aid,['owner','reviewer']);
        const data=bodyJSON(await readBody(req));
        assert(['approved','rejected'].includes(data.state),400,'审核状态不正确');
        const reg=db.prepare('SELECT * FROM registrations WHERE id=? AND activity_id=?').get(text(data.registrationId,40),aid);
        assert(reg,404,'报名记录不存在');
        assert(!db.prepare("SELECT 1 FROM checkins WHERE registration_id=? AND channel='scan'").get(reg.id),409,'已完成快速扫码核销，不能更改审核状态');
        if(data.state==='approved'&&event.require_attachment){
          assert(db.prepare('SELECT 1 FROM attachments WHERE registration_id=?').get(reg.id),409,'必须先上传附件');
        }
        const note=String(data.note||'').slice(0,300);
        db.prepare('UPDATE registrations SET state=?,review_note=?,reviewed_by=?,reviewed_at=?,updated_at=MAX(updated_at+1,?) WHERE id=?')
          .run(data.state,note,user.id,now(),now(),reg.id);
        db.prepare('DELETE FROM tickets WHERE registration_id=?').run(reg.id);
        return setJSON(res,200,{ok:true});
      }
      if(method==='POST'&&action==='manual-checkin'){
        activityAccess(db,user,aid,['owner','manual']);
        const data=bodyJSON(await readBody(req));
        const regId=text(data.registrationId,40);
        const reason=text(data.reason,250);
        assert(data.identityChecked===true,400,'必须明确确认现场已核对身份');
        const timestamp=now();
        assert(timestamp>=event.start_at&&timestamp<=event.end_at,409,'不在现场核验时间内');
        db.exec('BEGIN IMMEDIATE');
        try {
          const reg=db.prepare('SELECT * FROM registrations WHERE id=? AND activity_id=?').get(regId,aid);
          assert(reg,404,'该活动报名不存在');
          assert(!db.prepare('SELECT 1 FROM checkins WHERE registration_id=?').get(regId),409,'该学生已经登记到场');
          // Manual lane records verified physical presence, not approval of uploaded materials.
          db.prepare("INSERT INTO checkins (id,registration_id,activity_id,staff_id,checked_at,channel,reason,identity_check) VALUES (?,?,?,?,?,'manual',?,'checked')")
            .run(newId(),regId,aid,user.id,timestamp,reason);
          db.prepare('DELETE FROM tickets WHERE registration_id=?').run(regId);
          db.exec('COMMIT');
          return setJSON(res,200,{ok:true,checkedAt:timestamp,channel:'manual',reviewPending:reg.state!=='approved'});
        } catch(e){db.exec('ROLLBACK');throw e;}
      }
      if(method==='POST'&&action==='redeem'){
        activityAccess(db,user,aid,['owner','scanner']);
        const data=bodyJSON(await readBody(req));
        const token=parseToken(data.token);
        assert(token,400,'签到码格式错误');
        const start=now();
        // Atomic read + write across multiple staff connections/processes sharing SQLite.
        db.exec('BEGIN IMMEDIATE');
        try {
          const row=db.prepare('SELECT t.*,r.activity_id,r.state FROM tickets t JOIN registrations r ON r.id=t.registration_id WHERE t.token_hash=?').get(hashToken(token));
          assert(row&&row.activity_id===aid&&row.state==='approved',409,'签到码无效或不属于该活动');
          assert(start>=event.start_at&&start<=event.end_at,409,'不在现场签到时间内');
          assert(row.expires_at>=start,409,'签到码已过期，请学生刷新');
          assert(!db.prepare('SELECT 1 FROM checkins WHERE registration_id=?').get(row.registration_id),409,'该学生已签到');
          db.prepare("INSERT INTO checkins (id,registration_id,activity_id,staff_id,checked_at,channel) VALUES (?,?,?,?,?,'scan')")
            .run(newId(),row.registration_id,aid,user.id,start);
          db.prepare('DELETE FROM tickets WHERE registration_id=?').run(row.registration_id);
          db.exec('COMMIT');
          return setJSON(res,200,{ok:true,checkedAt:start});
        }catch(e){db.exec('ROLLBACK');throw e;}
      }
      if(method==='GET'&&action==='export'){
        activityAccess(db,user,aid,['owner','reviewer']);
        const rows=db.prepare("SELECT u.display_name,u.student_id,r.state,c.checked_at,c.channel,c.identity_check,c.reason,r.reviewed_at FROM registrations r JOIN users u ON u.id=r.user_id JOIN checkins c ON c.registration_id=r.id WHERE r.activity_id=? AND r.state='approved' ORDER BY c.checked_at").all(aid);
        const data=makeCsv([['姓名','学号','资料审核','现场核销时间','到场核验方式','人工身份核对','人工核验原因','资料审核时间'],...rows.map(r=>
          [r.display_name,r.student_id,'通过',new Date(r.checked_at).toISOString(),r.channel==='manual'?'人工通道':'快速扫码',r.identity_check||'',r.reason||'',r.reviewed_at?new Date(r.reviewed_at).toISOString():''])]);
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="activity-checkins.csv"','Cache-Control':'no-store'});
        return res.end(data);
      }
    }
    const getAttachment=pathName.match(/^\/api\/attachments\/([a-f0-9]{36})$/);
    if(method==='GET'&&getAttachment){
      const at=fileAuthorized(db,user,getAttachment[1]);
      const file=path.join(uploadDir,at.id);
      assert(fs.existsSync(file),404,'附件暂不可用');
      res.writeHead(200,{'Content-Type':at.mime,'Content-Length':at.bytes,'Content-Disposition':'attachment; filename="material"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
      return fs.createReadStream(file).pipe(res);
    }
    const inspect=pathName.match(/^\/api\/registrations\/([a-f0-9]{36})\/attachments$/);
    if(method==='GET'&&inspect){
      const reg=db.prepare('SELECT * FROM registrations WHERE id=?').get(inspect[1]);
      assert(reg,404,'报名记录不存在');
      activityAccess(db,user,reg.activity_id,['owner','reviewer']);
      return setJSON(res,200,{attachments:db.prepare('SELECT id,filename,mime,bytes FROM attachments WHERE registration_id=?').all(reg.id)});
    }
    return error(404,'未找到接口');
  }
  async function web(req,res,u){
    if(req.method!=='GET')return error(405,'方法不支持');
    const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
    if(u.pathname==='/zxing.js'){
      const file=path.join(root,'node_modules/@zxing/browser/umd/zxing-browser.min.js');
      assert(fs.existsSync(file),500,'扫码依赖缺失，请先运行 npm install');
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public,max-age=3600'});
      return fs.createReadStream(file).pipe(res);
    }
    const filename=allowed[u.pathname];assert(filename,404,'页面不存在');
    const fullPath=path.join(root,'public',filename);
    const csp=["default-src 'none'","script-src 'self'","style-src 'self'","img-src 'self' data:","connect-src 'self'","media-src 'self' blob:","font-src 'self'","base-uri 'none'","form-action 'self'","frame-ancestors 'none'"].join('; ');
    res.writeHead(200,{'Content-Type':contentType(fullPath),'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), geolocation=(self)','Cache-Control':'no-store'});
    return fs.createReadStream(fullPath).pipe(res);
  }
  const server=http.createServer(async (req,res)=>{
    try{
      const u=new URL(req.url,'http://internal.invalid');
      if(u.pathname.startsWith('/api/'))await api(req,res,u);
      else await web(req,res,u);
    }catch(e){
      if(res.headersSent){res.destroy();return;}
      if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return setJSON(res,409,{error:'账号、学号或活动记录已存在'});
      const status=e.status||500;
      if(status===500)console.error('Internal request failed:',e.name,e.code||'server-error');
      setJSON(res,status,{error:status===500?'服务器处理失败':e.message});
    }
  });
  return {server,db,close(){server.close();db.close();}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const port=Number(process.env.ACTIVITY_PORT||3317);
  const host=process.env.ACTIVITY_HOST||'127.0.0.1';
  if(host!=='127.0.0.1'&&host!=='::1'&&!process.env.ACTIVITY_PUBLIC_ORIGIN)throw new Error('非本机监听必须设置 ACTIVITY_PUBLIC_ORIGIN，并通过 HTTPS 反向代理部署');
  const {server}=createApp({dbPath:process.env.ACTIVITY_DB_PATH||undefined});
  server.listen(port,host,()=>console.log('花工木棉活动速签仅监听 '+host+':'+port+'；不包含真实学生测试数据'));
}
