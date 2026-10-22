/* Activity Lite: independent Cloudflare Worker + D1 + private R2.
 * Students: no account, private receipt + browser-generated one-time QR.
 * Staff: event-scoped password accounts, scoped permissions and HttpOnly sessions.
 * App scanner and web admin share ONLY these independent staff credentials.
 * No school login, location tracking, WebSocket or QR image upload.
 */
const DAY=86400000, MAX_UPLOAD=2*1024*1024, MAX_FORM=MAX_UPLOAD+100000;
const PASSWORD_ITERATIONS=210000, STAFF_SESSION_MS=12*3600_000;
const COOKIE='lite_staff';
const UTF8=new TextEncoder();
const uuid=()=>crypto.randomUUID();
const now=()=>Date.now();
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const hexToken=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
const string=(s,max,min=1)=>{
  if(typeof s!=='string'||s.trim().length<min||s.length>max)fail(400,'字段长度不合法');
  return s.trim();
};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const requireThat=(value,status,message)=>{if(!value)fail(status,message);};
async function digest(value){
  const raw=await crypto.subtle.digest('SHA-256',UTF8.encode(value));
  return Array.from(new Uint8Array(raw),x=>x.toString(16).padStart(2,'0')).join('');
}
function matches(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function json(value,status=200){
  return new Response(JSON.stringify(value),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function csvCell(v){
  let value=String(v??'');
  if(/^[\s\uFEFF]*[=+\-@]/u.test(value))value="'"+value;
  return '"'+value.replaceAll('"','""')+'"';
}
const csv=rows=>'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
function mutation(req,env){
  const origin=env.PUBLIC_ORIGIN;
  requireThat(origin&&req.headers.get('Origin')===origin&&
    new URL(req.url).origin===origin&&req.headers.get('X-Lite-Action')==='1',
    403,'该操作需要同源页面');
}
async function body(req){
  const size=Number(req.headers.get('Content-Length')||0);
  requireThat(size<=16000,413,'请求太大');
  const t=await req.text();requireThat(t.length<=16000,413,'请求太大');
  try{return JSON.parse(t);}catch{fail(400,'JSON 格式错误');}
}
async function limitedBytes(req,max){
  const size=req.headers.get('Content-Length');
  if(size!==null)requireThat(/^\d+$/.test(size)&&Number(size)<=max,413,'材料超过限制');
  const parts=[];let bytes=0;
  if(req.body){
    const reader=req.body.getReader();
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>max){await reader.cancel();fail(413,'提交内容超过限制');}
        parts.push(value);
      }
    }finally{reader.releaseLock();}
  }
  const result=new Uint8Array(bytes);let offset=0;
  for(const part of parts){result.set(part,offset);offset+=part.length;}
  return result;
}
async function parseApply(req){
  const type=req.headers.get('Content-Type')||'';
  requireThat(type.startsWith('multipart/form-data;')&&type.includes('boundary='),415,'必须提交活动表单');
  const raw=await limitedBytes(req,MAX_FORM);
  const decoded=new Request('http://lite.internal/upload',{method:'POST',
    headers:{'Content-Type':type},body:raw});
  return decoded.formData();
}
function usernameOf(raw){
  requireThat(typeof raw==='string'&&/^[a-zA-Z0-9_.-]{3,32}$/.test(raw),
    400,'工作人员账号限 3-32 位英文字母、数字、点、下划线或短横线');
  return raw.toLowerCase();
}
function staffPassword(value){
  requireThat(typeof value==='string'&&value.length>=12&&value.length<=128,
    400,'工作人员密码至少 12 位，最多 128 位');
  return value;
}
async function derivedPassword(password,salt,iterations=PASSWORD_ITERATIONS){
  const imported=await crypto.subtle.importKey('raw',UTF8.encode(password),
    {name:'PBKDF2'},false,['deriveBits']);
  const hashed=await crypto.subtle.deriveBits(
    {name:'PBKDF2',salt:UTF8.encode(salt),iterations,hash:'SHA-256'},imported,256);
  return Array.from(new Uint8Array(hashed),x=>x.toString(16).padStart(2,'0')).join('');
}
function cookieToken(req){
  const row=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim())
    .find(x=>x.startsWith(COOKIE+'='));
  const token=row?.slice(COOKIE.length+1)||null;
  return hexToken(token)?token:null;
}
function staffCookie(value,env,clear=false){
  // Only the local USB QA loopback may omit Secure; public deployments MUST
  // be HTTPS. HttpOnly and SameSite=Strict are unconditional.
  const local=env.LOCAL_QA==='true'&&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(env.PUBLIC_ORIGIN||'');
  return COOKIE+'='+(clear?'':value)+'; Path=/api; HttpOnly; SameSite=Strict; '+
    (local?'':'Secure; ')+(clear?'Max-Age=0':'Max-Age=43200');
}
async function verifiedStaff(db,req,eventId,permission){
  const event=await db.prepare('SELECT * FROM events WHERE id=?').bind(eventId).first();
  requireThat(event,404,'活动不存在');
  const token=cookieToken(req);
  requireThat(token,401,'请先登录活动工作人员账号');
  const account=await db.prepare(
    'SELECT a.* FROM staff_sessions s JOIN staff_accounts a ON a.id=s.staff_id '+
    'WHERE s.digest=? AND s.expires_at>? AND a.event_id=? AND a.enabled=1'
  ).bind(await digest(token),now(),eventId).first();
  requireThat(account,401,'登录已过期或账号已停用');
  const wanted=Array.isArray(permission)?permission:[permission];
  requireThat(wanted.length===0||account.role==='admin'||wanted.some(p=>account['can_'+p]===1),
    403,'此账号没有所需活动权限');
  return {event,staff:account};
}
function permissionsOf(s){
  return {review:s.role==='admin'||s.can_review===1,
    scan:s.role==='admin'||s.can_scan===1,
    export:s.role==='admin'||s.can_export===1,
    manual:s.role==='admin'||s.can_manual===1,
    accounts:s.role==='admin'};
}
function requestedPermissions(p){
  requireThat(p&&typeof p==='object'&&!Array.isArray(p),400,'请填写子账号权限');
  for(const key of ['review','scan','export','manual'])
    requireThat(typeof p[key]==='boolean',400,'权限必须明确选择允许或禁止');
  requireThat(['review','scan','export','manual'].some(key=>p[key]),
    400,'子账号至少需要一种权限');
  return [p.review?1:0,p.scan?1:0,p.export?1:0,p.manual?1:0];
}
async function audit(db,eventId,registrationId,action,staffId=null){
  await db.prepare('INSERT INTO audit(id,event_id,registration_id,staff_id,action,at) VALUES(?,?,?,?,?,?)')
    .bind(uuid(),eventId,registrationId,staffId,action,now()).run();
}
function eventIdParam(value){
  return typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)?value:null;
}
function safeAccount(account){
  return {id:account.id,username:account.username,displayName:account.display_name,
    role:account.role,enabled:Boolean(account.enabled),permissions:permissionsOf(account)};
}
function publicEvent(e){
  return {id:e.id,title:e.title,place:e.place,instructions:e.instructions,
    startsAt:e.starts_at,endsAt:e.ends_at,requireMaterial:Boolean(e.require_material)};
}
async function loadReceipt(db,req){
  const token=req.headers.get('X-Lite-Receipt');
  requireThat(hexToken(token),404,'回执无效');
  const r=await db.prepare('SELECT * FROM registrations WHERE receipt_digest=?')
    .bind(await digest(token)).first();
  requireThat(r,404,'未找到对应报名回执');
  return r;
}
async function uploadForm(req,env,e){
  const form=await parseApply(req);
  requireThat(form.get('privacyAck')==='yes',400,'请先同意必要的活动报名信息处理');
  const name=string(form.get('name'),60),
    studentNumber=string(form.get('studentNumber'),40),
    contact=string(form.get('contact'),100),
    note=typeof form.get('note')==='string'?String(form.get('note')).trim().slice(0,400):'';
  if(env.SYNTHETIC_ONLY==='true')
    requireThat(name.startsWith('测试')&&studentNumber.startsWith('TEST-')&&
      contact.startsWith('TEST-'),403,'演练服务只接受以 测试 / TEST- 开头的虚构资料');
  const evidence=form.get('material');
  let data=null,mime=null,key=null;
  if(evidence && typeof evidence.arrayBuffer==='function' && evidence.size>0){
    requireThat(evidence.size<=MAX_UPLOAD,413,'材料不得超过 2MB');
    mime=evidence.type;
    requireThat(['image/png','image/jpeg'].includes(mime),415,'材料只接受 PNG/JPEG');
    data=new Uint8Array(await evidence.arrayBuffer());
    const png=[137,80,78,71,13,10,26,10];
    const valid=mime==='image/png'
      ?data.length>=24&&png.every((x,i)=>data[i]===x)
      :data.length>=16&&data[0]===255&&data[1]===216&&
        data.at(-2)===255&&data.at(-1)===217;
    requireThat(valid,415,'材料与文件格式不匹配');
  }
  requireThat(!e.require_material||data,400,'此活动要求提交截图材料');
  const id=uuid(),receiptToken=randomToken(),stamp=now();
  if(data){
    requireThat(env.MATERIALS?.put,503,'私有材料存储尚未配置');
    key='lite/'+e.id+'/'+id;
    await env.MATERIALS.put(key,data,{httpMetadata:{contentType:mime}});
  }
  try{
    await env.DB.prepare(
      'INSERT INTO registrations(id,event_id,receipt_digest,name,student_number,contact,note,material_key,material_mime,material_bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,\'pending\',?,?)'
    ).bind(id,e.id,await digest(receiptToken),name,studentNumber,contact,note,key,mime,data?.length||0,stamp,stamp).run();
  }catch(error){
    if(key)await env.MATERIALS.delete(key);
    throw error;
  }
  await audit(env.DB,e.id,id,'apply');
  return {receiptUrl:env.PUBLIC_ORIGIN+'/#receipt='+receiptToken,state:'pending'};
}
async function api(req,env,url){
  const method=req.method,p=url.pathname,db=env.DB;
  if(method==='GET'&&p==='/api/health')
    return json({ok:true,lite:true,ready:env.LITE_ENABLED==='true',
      syntheticOnly:env.SYNTHETIC_ONLY==='true'});
  requireThat(env.LITE_ENABLED==='true',503,'Lite 服务尚未启用');
  requireThat(db?.prepare,503,'缺少数据库绑定');
  if(method!=='GET')mutation(req,env);

  if(method==='POST'&&p==='/api/events'){
    const master=req.headers.get('X-Lite-Root');
    requireThat(hexToken(master)&&hexToken(env.LITE_ROOT_TOKEN)&&matches(
      await digest(master),await digest(env.LITE_ROOT_TOKEN)
    ),403,'无创建活动权限');
    const x=await body(req),title=string(x.title,90),
      place=string(x.place,120),instructions=String(x.instructions||'').slice(0,800),
      start=x.startsAt,end=x.endsAt,username=usernameOf(x.adminUsername),
      adminName=string(x.adminDisplayName,60),
      password=staffPassword(x.adminPassword);
    requireThat(Number.isInteger(start)&&Number.isInteger(end)&&end>now()&&
      end>start&&end-start<=14*DAY&&start>now()-DAY,400,'活动时间范围无效');
    const id=uuid(),adminId=uuid(),salt=randomToken(),stamp=now();
    requireThat(db.batch,503,'数据库事务不可用');
    await db.batch([
      db.prepare(
        'INSERT INTO events(id,title,place,instructions,starts_at,ends_at,require_material,created_at) VALUES(?,?,?,?,?,?,?,?)'
      ).bind(id,title,place,instructions,start,end,x.requireMaterial===false?0:1,stamp),
      db.prepare(
        "INSERT INTO staff_accounts(id,event_id,username,display_name,password_salt,password_digest,password_iterations,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'admin',?,?)"
      ).bind(adminId,id,username,adminName,salt,await derivedPassword(password,salt),
        PASSWORD_ITERATIONS,stamp,stamp)
    ]);
    return json({event:publicEvent({id,title,place,instructions,starts_at:start,ends_at:end,
      require_material:x.requireMaterial===false?0:1}),
      shareUrl:env.PUBLIC_ORIGIN+'/#event='+id,
      manageUrl:env.PUBLIC_ORIGIN+'/#staff='+id,
      scanUrl:env.PUBLIC_ORIGIN+'/#scan='+id
    },201);
  }

  if(method==='POST'&&p==='/api/staff/login'){
    const x=await body(req),eventId=eventIdParam(x.eventId);
    requireThat(eventId,400,'活动标识无效');
    const username=usernameOf(x.username);
    requireThat(typeof x.password==='string'&&x.password.length<=128,400,'登录信息不合法');
    const rate=env.STAFF_LOGIN_LIMIT;
    requireThat(rate?.limit,503,'工作人员登录限流未配置');
    const ip=req.headers.get('CF-Connecting-IP');
    requireThat(ip,403,'无法验证登录请求来源');
    const allowed=await rate.limit({key:'lite-staff-login:'+ip+':'+eventId+':'+username});
    requireThat(allowed.success,429,'登录太频繁，请稍后重试');
    const staff=await db.prepare(
      'SELECT * FROM staff_accounts WHERE event_id=? AND username=? AND enabled=1'
    ).bind(eventId,username).first();
    // Hash a fixed salt even when a username is unknown, reducing timing
    // differences between existing and nonexistent accounts.
    const passwordSalt=staff?.password_salt||'00000000000000000000000000000000';
    const calculated=await derivedPassword(x.password,passwordSalt,
      staff?.password_iterations||PASSWORD_ITERATIONS);
    requireThat(staff&&matches(calculated,staff.password_digest),401,'账号或密码错误');
    const token=randomToken(),stamp=now();
    await db.prepare('INSERT INTO staff_sessions(digest,staff_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(await digest(token),staff.id,stamp+STAFF_SESSION_MS,stamp).run();
    await audit(db,eventId,null,'staff.login',staff.id);
    const response=json({account:safeAccount(staff)});
    response.headers.set('Set-Cookie',staffCookie(token,env));
    return response;
  }
  if(method==='POST'&&p==='/api/staff/logout'){
    const token=cookieToken(req);
    if(token)await db.prepare('DELETE FROM staff_sessions WHERE digest=?')
      .bind(await digest(token)).run();
    const response=json({ok:true});
    response.headers.set('Set-Cookie',staffCookie('',env,true));
    return response;
  }
  if(method==='GET'&&p==='/api/staff/me'){
    const eventId=eventIdParam(url.searchParams.get('eventId'));
    requireThat(eventId,400,'活动标识无效');
    const {event,staff}=await verifiedStaff(db,req,eventId,[]);
    return json({event:publicEvent(event),account:safeAccount(staff)});
  }
  if(method==='GET'&&p==='/api/staff/accounts'){
    const eventId=eventIdParam(url.searchParams.get('eventId'));
    requireThat(eventId,400,'活动标识无效');
    const {staff}=await verifiedStaff(db,req,eventId,['accounts']);
    requireThat(staff.role==='admin',403,'只有活动管理员可分配子账号');
    const rows=await db.prepare(
      'SELECT id,username,display_name,role,can_review,can_scan,can_export,can_manual,enabled FROM staff_accounts WHERE event_id=? ORDER BY role,created_at'
    ).bind(eventId).all();
    return json({accounts:rows.results.map(safeAccount)});
  }
  if(method==='POST'&&p==='/api/staff/accounts'){
    const x=await body(req),eventId=eventIdParam(x.eventId);
    requireThat(eventId,400,'活动标识无效');
    const {staff}=await verifiedStaff(db,req,eventId,['accounts']);
    requireThat(staff.role==='admin',403,'只有活动管理员可创建子账号');
    requireThat(!('role' in x)||x.role==='member',400,'不能通过子账号接口创建管理员');
    const username=usernameOf(x.username),displayName=string(x.displayName,60),
      password=staffPassword(x.password),flags=requestedPermissions(x.permissions);
    const id=uuid(),salt=randomToken(),stamp=now();
    await db.prepare(
      "INSERT INTO staff_accounts(id,event_id,username,display_name,password_salt,password_digest,password_iterations,role,can_review,can_scan,can_export,can_manual,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'member',?,?,?,?,?,?)"
    ).bind(id,eventId,username,displayName,salt,await derivedPassword(password,salt),
      PASSWORD_ITERATIONS,...flags,stamp,stamp).run();
    await audit(db,eventId,null,'staff.create',staff.id);
    return json({ok:true,id},201);
  }
  const accountAction=p.match(/^\/api\/staff\/accounts\/([a-f0-9-]{36})$/);
  if(method==='PATCH'&&accountAction){
    const x=await body(req),eventId=eventIdParam(x.eventId);
    requireThat(eventId,400,'活动标识无效');
    const {staff}=await verifiedStaff(db,req,eventId,['accounts']);
    requireThat(staff.role==='admin',403,'只有活动管理员可修改子账号');
    const previous=await db.prepare(
      'SELECT * FROM staff_accounts WHERE id=? AND event_id=? AND role=\'member\''
    ).bind(accountAction[1],eventId).first();
    requireThat(previous,404,'该活动中没有此子账号');
    requireThat(!('role' in x)||x.role==='member',400,'不得提升子账号为管理员');
    const flags=x.permissions===undefined
      ?[previous.can_review,previous.can_scan,previous.can_export,previous.can_manual]
      :requestedPermissions(x.permissions);
    const enabled=x.enabled===undefined?previous.enabled:
      (typeof x.enabled==='boolean'?Number(x.enabled):null);
    requireThat(enabled!==null,400,'停用状态无效');
    const salt=x.password===undefined?previous.password_salt:randomToken();
    const hash=x.password===undefined?previous.password_digest:
      await derivedPassword(staffPassword(x.password),salt);
    const display=x.displayName===undefined?previous.display_name:string(x.displayName,60);
    // Invalidate ALL sessions after any permission/password/account change.
    await db.batch([
      db.prepare(
        'UPDATE staff_accounts SET display_name=?,password_salt=?,password_digest=?,can_review=?,can_scan=?,can_export=?,can_manual=?,enabled=?,updated_at=? WHERE id=? AND event_id=?'
      ).bind(display,salt,hash,...flags,enabled,now(),previous.id,eventId),
      db.prepare('DELETE FROM staff_sessions WHERE staff_id=?').bind(previous.id)
    ]);
    await audit(db,eventId,null,'staff.update',staff.id);
    return json({ok:true});
  }
  if(method==='GET'&&p==='/api/events'){
    const rows=await db.prepare(
      'SELECT id,title,place,instructions,starts_at,ends_at,require_material FROM events WHERE ends_at>? ORDER BY starts_at ASC LIMIT 50'
    ).bind(now()).all();
    return json({events:rows.results.map(publicEvent)});
  }
  if(method==='GET'&&p==='/api/receipt'){
    const r=await loadReceipt(db,req);
    const e=await db.prepare('SELECT * FROM events WHERE id=?').bind(r.event_id).first();
    return json({event:publicEvent(e),state:r.status,decision:r.decision,
      checkedIn:Boolean(r.checked_at),channel:r.checked_by||null});
  }
  if(method==='POST'&&p==='/api/receipt/ticket'){
    const r=await loadReceipt(db,req);
    const e=await db.prepare('SELECT ends_at FROM events WHERE id=?').bind(r.event_id).first();
    requireThat(r.status==='approved',403,'审核尚未通过');
    requireThat(!r.checked_at,409,'已经签到');
    requireThat(e?.ends_at>now(),409,'活动已结束');
    const token=randomToken();
    const update=await db.prepare(
      'UPDATE registrations SET checkin_digest=?,updated_at=? WHERE id=? AND status=\'approved\' AND checked_at IS NULL'
    ).bind(await digest(token),now(),r.id).run();
    requireThat(update.meta.changes===1,409,'签到状态已改变');
    // URL fragment is not sent by the browser as an HTTP request to the server.
    return json({checkinUrl:env.PUBLIC_ORIGIN+'/#checkin='+token,
      eventTitle:(await db.prepare('SELECT title FROM events WHERE id=?').bind(r.event_id).first()).title});
  }
  const m=p.match(/^\/api\/events\/([a-f0-9-]{36})(?:\/(.+))?$/);
  if(m){
    const eventId=m[1],action=m[2]||'';
    const e=await db.prepare('SELECT * FROM events WHERE id=?').bind(eventId).first();
    requireThat(e,404,'活动不存在');
    if(method==='GET'&&action==='')return json({event:publicEvent(e)});
    if(method==='POST'&&action==='apply'){
      requireThat(now()<=e.ends_at,409,'报名已经结束');
      requireThat(env.APPLY_RATE_LIMIT?.limit,503,'报名限流未配置');
      const ip=req.headers.get('CF-Connecting-IP');
      requireThat(ip,403,'请求来源未经验证');
      const result=await env.APPLY_RATE_LIMIT.limit({key:'lite-apply:'+ip});
      requireThat(result.success,429,'提交太频繁，请稍后重试');
      return json(await uploadForm(req,env,e),201);
    }
    if(method==='POST'&&action==='redeem'){
      const {staff}=await verifiedStaff(db,req,eventId,'scan');
      requireThat(now()>=e.starts_at&&now()<=e.ends_at,409,'不在签到时间');
      const {token}=await body(req);
      requireThat(hexToken(token),400,'不是活动签到码');
      const result=await db.prepare(
        'UPDATE registrations SET checked_at=?,checked_by=\'scan\',checked_actor_id=?,checkin_digest=NULL,updated_at=? WHERE event_id=? AND checkin_digest=? AND status=\'approved\' AND checked_at IS NULL'
      ).bind(now(),staff.id,now(),eventId,await digest(token)).run();
      requireThat(result.meta.changes===1,409,'签到码已失效、已使用或不属于本活动');
      // Normal scanner response NEVER includes name, student number, or contact.
      return json({ok:true,message:'签到成功，请下一位'});
    }
    if(method==='GET'&&action==='records'){
      await verifiedStaff(db,req,eventId,['review','manual']);
      const rows=await db.prepare(
        'SELECT id,name,student_number,contact,note,status,decision,material_key,material_mime,checked_at,checked_by,checkin_reason,created_at FROM registrations WHERE event_id=? ORDER BY created_at DESC LIMIT 500'
      ).bind(eventId).all();
      return json({event:publicEvent(e),
        registrations:rows.results.map(r=>({...r,hasMaterial:Boolean(r.material_key),
          material_key:undefined}))});
    }
    const material=action.match(/^material\/([a-f0-9-]{36})$/);
    if(method==='GET'&&material){
      await verifiedStaff(db,req,eventId,'review');
      const row=await db.prepare('SELECT material_key,material_mime FROM registrations WHERE id=? AND event_id=?')
        .bind(material[1],eventId).first();
      requireThat(row?.material_key,404,'材料不存在');
      const blob=await env.MATERIALS?.get(row.material_key);
      requireThat(blob,404,'材料未找到');
      return new Response(blob.body,{headers:{
        'Content-Type':row.material_mime,'Cache-Control':'private, no-store',
        'Content-Disposition':'inline; filename="material"',
        'X-Content-Type-Options':'nosniff'}});
    }
    if(method==='POST'&&action==='review'){
      const {staff}=await verifiedStaff(db,req,eventId,'review');
      const x=await body(req),regId=string(x.registrationId,40),
        decision=String(x.decision||'').trim().slice(0,250);
      requireThat(['approved','rejected'].includes(x.state),400,'审核状态不合法');
      const row=await db.prepare('SELECT id,material_key FROM registrations WHERE id=? AND event_id=?')
        .bind(regId,eventId).first();
      requireThat(row,404,'报名不存在');
      requireThat(x.state!=='approved'||!e.require_material||row.material_key,409,'尚未提交材料');
      await db.prepare(
        'UPDATE registrations SET status=?,decision=?,reviewed_by=?,checkin_digest=NULL,updated_at=? WHERE id=? AND event_id=?'
      ).bind(x.state,decision,staff.id,now(),regId,eventId).run();
      await audit(db,eventId,regId,'review.'+x.state,staff.id);
      return json({ok:true});
    }
    if(method==='POST'&&action==='manual'){
      const {staff}=await verifiedStaff(db,req,eventId,'manual');
      const x=await body(req),regId=string(x.registrationId,40),
        reason=string(x.reason,250,8);
      requireThat(x.identityChecked===true,400,'必须先当面核对');
      requireThat(now()>=e.starts_at&&now()<=e.ends_at,409,'不在活动时间');
      const result=await db.prepare(
        'UPDATE registrations SET checked_at=?,checked_by=\'manual\',checked_actor_id=?,checkin_reason=?,checkin_digest=NULL,updated_at=? WHERE id=? AND event_id=? AND checked_at IS NULL'
      ).bind(now(),staff.id,reason,now(),regId,eventId).run();
      requireThat(result.meta.changes===1,409,'该报名已到场或不存在');
      await audit(db,eventId,regId,'attendance.manual',staff.id);
      return json({ok:true});
    }
    if(method==='GET'&&action==='export'){
      const {staff}=await verifiedStaff(db,req,eventId,'export');
      const rows=await db.prepare(
        'SELECT name,student_number,contact,checked_at,checked_by FROM registrations WHERE event_id=? AND status=\'approved\' AND checked_at IS NOT NULL ORDER BY checked_at'
      ).bind(eventId).all();
      await audit(db,eventId,null,'export',staff.id);
      return new Response(csv([['姓名','自填学号','联系方式','签到时间','方式'],
        ...rows.results.map(r=>[r.name,r.student_number,r.contact,
          new Date(r.checked_at).toISOString(),r.checked_by])]),{headers:{
        'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="lite-present.csv"',
        'Cache-Control':'no-store'}});
    }

  }
  fail(404,'没有此接口');
}
export default {
  async fetch(req,env){
    try{
      const url=new URL(req.url);
      const response=url.pathname.startsWith('/api/')?await api(req,env,url):
        await env.ASSETS.fetch(req);
      const h=new Headers(response.headers);
      h.set('Referrer-Policy','no-referrer');
      h.set('X-Content-Type-Options','nosniff');
      h.set('X-Frame-Options','DENY');
      h.set('Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; "+
        "media-src 'self' blob:; connect-src 'self'; object-src 'none'; "+
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if(url.pathname.startsWith('/api/'))h.set('Cache-Control','no-store');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
    }catch(error){
      return json({error:error.status?error.message:
        (error.message||'').includes('UNIQUE constraint')?'记录重复':'请求失败'},error.status||500);
    }
  }
};
