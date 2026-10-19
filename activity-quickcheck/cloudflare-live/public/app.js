'use strict';
const $=id=>document.getElementById(id);
const app={me:null,events:[],active:null,poll:null,scanner:null,scannerOverlay:null,scannerVideo:null,scannerEpoch:0,scannerHistory:false,scannerFullscreenEntered:false,scannerPreviousFocus:null,scannerFeedback:null,reviewDispose:null,staffDispose:null,qr:null,syntheticOnly:false,allowTestImageUpload:false};
function el(tag,props={},...children){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(k==='text')n.textContent=String(v);
    else if(k==='class')n.className=v;
    else if(k==='onClick')n.addEventListener('click',v);
    else if(k==='checked')n.checked=Boolean(v);
    else if(k==='value')n.value=v;
    else n.setAttribute(k,String(v));
  }
  for(const c of children.flat())if(c!==null&&c!==undefined)n.append(c instanceof Node?c:document.createTextNode(String(c)));
  return n;
}
const text=(s,cls='muted')=>el('p',{class:cls,text:s});
const button=(name,fn,cls='')=>el('button',{type:'button',class:cls,onClick:()=>safe(fn)},name);
const label=(name,control)=>el('label',{},name,control);
const inp=(name,type='text',value='')=>el('input',{name,type,value,required:'required'});
const card=(heading,...children)=>el('section',{class:'card'},el('h2',{text:heading}),...children);
const stamp=n=>new Date(n).toLocaleString('zh-CN',{hour12:false});
function locationHelp(error,forCheckin=false){
  const fallback=forCheckin
    ? '请转人工身份核验窗口，工作人员确认到场后仍可继续资料审核。'
    : '可改用经过核实的 WGS84 经纬度手动创建活动，或到室外重试。';
  if(error?.code===1)
    return '位置权限被拒绝。请在系统设置中允许当前浏览器或花工木棉活动工作台使用位置，并检查网站权限。'+fallback;
  if(error?.code===2)
    return '设备当前无法取得位置（可能没有室内 GPS 信号或网络定位不可用）。'+fallback;
  if(error?.code===3)
    return '定位超时，请到开阔处并等待定位服务获取坐标。'+fallback;
  return '手机未能获取有效位置。'+fallback;
}
async function requestPhoneLocation(forCheckin=false){
  if(!navigator.geolocation)throw new Error('当前浏览器未提供定位接口。请使用支持地理定位的浏览器，或改用人工通道。');
  return await new Promise((resolve,reject)=>{
    navigator.geolocation.getCurrentPosition(resolve,
      error=>reject(new Error(locationHelp(error,forCheckin))),
      {enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });
}
function localInputTime(timestamp){
  const d=new Date(timestamp),pad=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
}
function validateEventInputs(x){
  const radius=Number(x.radiusM),starts=new Date(x.startsAt).getTime(),ends=new Date(x.endsAt).getTime();
  if(!Number.isInteger(radius)||radius<50||radius>1000)throw new Error('定位半径须为 50–1000 米的整数；建议测试用 150 米');
  if(!Number.isFinite(starts)||!Number.isFinite(ends))throw new Error('时间格式不正确，请重新选择开始和结束时间');
  if(ends<=starts)throw new Error('结束时间必须晚于开始时间');
  if(ends-starts>7*86400000)throw new Error('活动跨度不能超过 7 天');
  if(ends<=Date.now())throw new Error('结束时间已经过去，请设置为未来时间（请核对手机日期和时区）');
  return {radius,starts,ends};
}
function notice(s,type=''){const n=$('notice');n.className='notice '+type;n.textContent=s;}
async function safe(fn){try{await fn();}catch(e){notice(e.message||'请求失败','error');}}
async function request(path,{method='GET',data,raw,headers={}}={}){
  const options={method,credentials:'same-origin',headers:{...headers}};
  if(method!=='GET')options.headers['X-Bombax-Action']='1';
  if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  if(raw!==undefined)options.body=raw;
  // Lost connections must fail visibly rather than leave "initializing"
  // forever. Do NOT automatically retry mutations (join/approval/redeem).
  options.signal=AbortSignal.timeout(method==='GET'?12000:path.endsWith('/upload')?60000:25000);
  let response;
  try{response=await fetch(path,options);}
  catch(error){
    throw new Error(error?.name==='TimeoutError'||error?.name==='AbortError'
      ?'连接活动平台超时，请点击重试；无需重复报名。'
      :'活动平台网络不可达，请检查网络后重试。');
  }
  if(!response.ok){
    const info=await response.json().catch(()=>({error:'HTTP '+response.status}));
    throw new Error(info.error||'HTTP '+response.status);
  }
  return response.headers.get('Content-Type')?.includes('application/json')?response.json():response;
}
function form(fields,submit,fn){
  const f=el('form',{},...fields,el('button',{type:'submit'},submit));
  f.addEventListener('submit',event=>{event.preventDefault();safe(()=>fn(Object.fromEntries(new FormData(f).entries())));});
  return f;
}
function clean(){
  if(app.poll){clearInterval(app.poll);app.poll=null;}
  try{app.scanner?.stop();}catch{}app.scanner=null;
  app.scannerFeedback?.dispose();app.scannerFeedback=null;
  app.reviewDispose?.();app.reviewDispose=null;
  app.staffDispose?.();app.staffDispose=null;
  if(app.qr){URL.revokeObjectURL(app.qr);app.qr=null;}
}
let qrReaderLoading=null;
async function loadQrReader(){
  if(window.ZXingBrowser?.BrowserQRCodeReader)return;
  if(!qrReaderLoading){
    qrReaderLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='/zxing.js';script.async=true;
      script.onload=()=>window.ZXingBrowser?.BrowserQRCodeReader
        ?resolve():reject(new Error('扫码组件未能正确初始化'));
      script.onerror=()=>reject(new Error('二维码识别组件下载失败，请检查网络后重试'));
      document.head.append(script);
    }).catch(error=>{qrReaderLoading=null;throw error;});
  }
  await qrReaderLoading;
}
async function start(){
  // Display usable text before the first network request. From the campus
  // network each individual HTTPS request may take around 700-1000ms; never
  // serialize independent /health, /me and /events round trips.
  $('content').replaceChildren(card('正在获取校园活动',
    text('正在连接活动平台；网络不佳时可以稍后重试。')));
  const fragment=location.hash;
  let restoredEventId=null,restorePromise=Promise.resolve(null);
  if(fragment.startsWith('#event=')){
    history.replaceState(history.state,'',location.pathname+location.search);
    const match=/^#event=([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(fragment);
    if(match)restoredEventId=match[1];
    else notice('本机票夹活动编号无效','error');
  }
  if(fragment.startsWith('#pass=')){
    // Consume QR fragment synchronously, before a single network round trip.
    history.replaceState(history.state,'',location.pathname+location.search);
    const match=/^#pass=(bqx_[a-f0-9]{64})$/.exec(fragment);
    if(match)restorePromise=request('/api/pass/restore',{method:'POST',data:{token:match[1]}})
      .catch(error=>{notice(error.message||'一码通无法恢复','error');return null;});
    else notice('这不是有效的花工木棉一码通二维码','error');
  }
  const staffPage=page()==='admin'||page()==='adminlogin';
  const [ready,me,events,restored]=await Promise.all([
    request('/api/health'),
    staffPage?request('/api/me'):Promise.resolve({user:null}),
    request('/api/events'),
    restorePromise
  ]);
  app.syntheticOnly=Boolean(ready.syntheticOnly);
  app.allowTestImageUpload=Boolean(ready.allowTestImageUpload);
  if(!ready.ready){
    notice('当前只开放虚构数据测试，真实报名暂未开通。','error');
    $('account').replaceChildren();
    $('content').replaceChildren(card('活动测试站尚未就绪',text('请稍后重试；请勿填写真实信息。')));
    return;
  }
  if(restored?.eventId)restoredEventId=restored.eventId;
  app.me=me.user;app.events=events.events||[];
  renderAccount();await home();
  if(restoredEventId){
    const event=app.events.find(x=>x.id===restoredEventId);
    if(event)await viewEvent(event);
    else notice('活动不在目前清单中，请联系主办方','error');
  }else if(!fragment)notice('活动列表已更新；学生无需登录。');
}
async function launchStart(){
  try{await start();}
  catch(error){
    notice('加载活动失败：'+(error?.message||'网络连接异常'),'error');
    const root=$('content');root.replaceChildren(card('活动加载未完成',
      text('网络较慢或连接中断时可重试；不需要反复刷新整个页面。'),
      button('重新获取活动列表',launchStart,'secondary'),
      el('a',{href:'/my',text:'我的一码通 / 截图恢复'})));
  }
}
function page(){
  const path=location.pathname.replace(/\/$/,'')||'/';
  if(path==='/adminlogin'||path==='/adminlogin.html')return 'adminlogin';
  if(path==='/admin'||path==='/admin.html')return 'admin';
  if(path==='/my'||path==='/my.html')return 'my';
  return 'public';
}
function renderAccount(){
  const root=$('account');root.replaceChildren();
  if(page()==='public'||page()==='my')return; // No staff login on student pages.
  if(page()==='adminlogin'){
    if(app.me?.role==='organizer'){location.replace('/admin');return;}
    const formNode=form([
      label('工作人员用户名',inp('username')),
      label('工作人员密码',inp('password','password'))
    ],'登录活动管理后台',async x=>{
      await request('/api/login',{method:'POST',data:x});
      location.assign('/admin');
    });
    root.append(el('div',{class:'admin-login-frame'},card('主办方 / 授权工作人员登录',
      text('学生无需账号。这里仅供活动主办方、审核员、扫码员及人工核验岗位使用。'),
      formNode,
      el('a',{href:'/',text:'← 返回学生活动首页'}))));
    return;
  }
  if(app.me?.role!=='organizer'){location.replace('/adminlogin');return;}
  root.append(el('div',{class:'admin-panel-head'},
    el('strong',{text:'已登录工作人员：'+app.me.displayName}),
    button('退出管理后台',async()=>{
      await request('/api/logout',{method:'POST'});clean();location.assign('/adminlogin');
    },'secondary')));
}
function signupWindow(event){
  const start=event.join_starts_at??event.starts_at;
  const end=event.join_ends_at??event.ends_at;
  const now=Date.now();
  return {start,end,state:now<start?'未开始报名':now>end?'报名已截止':'正在报名'};
}
async function home(){
  clean();app.active=null;
  const root=$('content');root.replaceChildren();
  const area=page();
  if(area==='adminlogin')return;
  if(area==='admin'){
    if(app.me?.role==='organizer')await renderAdminHome(root);
    return;
  }
  if(area==='my'){
    root.append(card('我的活动与一码通',
      text('不需要账号。这里查阅本机保管的活动，或用其他手机保存的二维码截图向服务端恢复。'),
      el('a',{href:'/',text:'← 返回全部活动卡片'})));
    await renderStudentPassDesk(root);
    return;
  }
  const heading=el('div',{class:'public-headline'},
    el('div',{},el('h2',{text:'发现校园活动'}),text('活动报名无需登录，完成后记得截图备份一码通。')));
  const gallery=el('div',{class:'activity-card-grid'});
  if(!app.events.length)gallery.append(card('目前没有开放的活动',text('请稍后刷新页面查看。')));
  for(const event of app.events){
    const windowInfo=signupWindow(event);
    const tile=el('article',{class:'activity-tile'},
      el('img',{class:'activity-banner',src:'/api/events/'+event.id+'/banner',
        alt:event.title+' · 21:9 主题卡通横幅',loading:'lazy'}),
      el('div',{class:'activity-tile-body'},
        el('h3',{class:'activity-tile-title',text:event.title}),
        el('span',{class:'tag '+(windowInfo.state==='正在报名'?'green':'orange'),text:windowInfo.state}),
        el('div',{class:'activity-tile-facts'},
          text('报名：'+stamp(windowInfo.start)+' — '+stamp(windowInfo.end)),
          text('活动：'+stamp(event.starts_at)+' — '+stamp(event.ends_at))),
        el('p',{class:'activity-tile-requirements',text:'参与要求：'+
          (event.guidelines||'请遵照主办方现场说明；'+(event.require_photo?'需提交材料':'无需提交材料'))}),
        el('div',{class:'action-row'},
          el('span',{class:'tag',text:event.require_photo?'须提交审核材料':'无须证明材料'}),
          button('查看详情 / 一码通报名',()=>viewEvent(event)))));
    gallery.append(tile);
  }
  root.append(heading,gallery);
}
async function renderAdminHome(root){
  const response=await request('/api/admin/events');
  const events=response.events||[];
  const homePanel=card('活动管理工作台',
    text('这里是工作人员管理页面，不显示面向学生的宣传活动卡片。选择已获授权的活动，再进入材料审核、现场核销或人工登记。'));
  if(events.length){
    const selector=el('select',{class:'admin-selector','aria-label':'选择负责的活动'});
    for(const e of events)selector.append(el('option',{value:e.id,text:e.title+' · '+stamp(e.starts_at)}));
    homePanel.append(label('选择我有权限管理的活动',selector),
      button('进入所选活动管理',()=>{
        const event=app.events.find(x=>x.id===selector.value);
        if(!event)throw new Error('活动未找到，请刷新后台');
        return viewEvent(event);
      }));
  }else homePanel.append(text('当前还没有获授权管理的活动。主办方可以创建活动，或联系原负责人授予审核/扫码岗位。'));
  root.append(homePanel);
  if(app.me?.role!=='organizer')return;
  const now=Date.now(),end=now+90*60000;
  const artOptions=el('select',{name:'bannerPreset'});
  for(const item of [
    ['concert','音乐与招新'],['sports','运动与比赛'],['volunteer','志愿与服务'],
    ['lecture','讲座与分享'],['celebration','节日与游园']
  ])artOptions.append(el('option',{value:item[0],text:item[1]}));
  const create=form([
    label('活动标题',inp('title')),
    label('报名和材料审核要求',el('textarea',{name:'guidelines',maxlength:'1000'})),
    label('报名开始时间',el('input',{name:'joinStartsAt',type:'datetime-local',
      value:localInputTime(now-5*60000),required:'required'})),
    label('报名截止时间',el('input',{name:'joinEndsAt',type:'datetime-local',
      value:localInputTime(end),required:'required'})),
    label('活动开始时间',el('input',{name:'startsAt',type:'datetime-local',
      value:localInputTime(now-5*60000),required:'required'})),
    label('活动结束时间',el('input',{name:'endsAt',type:'datetime-local',
      value:localInputTime(end),required:'required'})),
    label('内置 SVG 卡通主题',artOptions),
    label('WGS84 纬度',el('input',{name:'latitude',type:'number',step:'any',required:'required'})),
    label('WGS84 经度',el('input',{name:'longitude',type:'number',step:'any',required:'required'})),
    label('活动区域半径（米，50–1000）',el('input',{
      name:'radiusM',type:'number',min:50,max:1000,step:1,value:150,required:'required'}))
  ],'创建活动',async x=>{
    const valid=validateEventInputs(x);
    const signupStart=new Date(x.joinStartsAt).getTime();
    const signupEnd=new Date(x.joinEndsAt).getTime();
    if(!Number.isFinite(signupStart)||!Number.isFinite(signupEnd)||
      signupStart>=signupEnd||signupEnd>valid.ends||signupEnd<=Date.now())
      throw new Error('报名时间不合法：截止须晚于开始、早于或等于活动结束，并在未来');
    await request('/api/events',{method:'POST',data:{
      title:x.title,guidelines:x.guidelines,
      latitude:Number(x.latitude),longitude:Number(x.longitude),radiusM:valid.radius,
      startsAt:valid.starts,endsAt:valid.ends,joinStartsAt:signupStart,joinEndsAt:signupEnd,
      bannerPreset:x.bannerPreset,requirePhoto:true
    }});
    notice('虚构活动创建成功，默认卡通横幅已设置。','success');
    await start();
  });
  const quickFill=button('一键填入虚构地点',()=>{
    create.elements.latitude.value='23.12';create.elements.longitude.value='113.32';
    notice('已填入虚构测试坐标，未读取学生或工作人员位置。','success');
  },'secondary');
  const fillGPS=button('定位当前地点（非演练环境）',async()=>{
    const pos=await requestPhoneLocation(false);
    create.elements.latitude.value=pos.coords.latitude.toFixed(7);
    create.elements.longitude.value=pos.coords.longitude.toFixed(7);
  },'secondary');
  const formBox=card('新建活动 · 报名时间与 SVG 卡通横幅',
    text('创建时先选内置主题；建好后可进入活动后台上传小于 100 KB 的静态 SVG 替换。'),
    el('details',{},el('summary',{text:'展开活动录入'}),app.syntheticOnly?quickFill:fillGPS,create));
  root.append(formBox);
}
async function importPassImage(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)
    throw new Error('请选择 5 MB 以内的 PNG、JPEG 或 WebP 一码通截图');
  await loadQrReader();
  const blobUrl=URL.createObjectURL(file);
  let pass;
  try{
    const img=el('img',{src:blobUrl,alt:'本地导入的一码通截图'});
    await img.decode();
    const result=await new window.ZXingBrowser.BrowserQRCodeReader().decodeFromImageElement(img);
    pass=window.BombaxScanner?.normalizeToken(result.getText());
  }catch{
    throw new Error('截图未识别出花工木棉一码通，请使用原始清晰截图');
  }finally{URL.revokeObjectURL(blobUrl);}
  if(!pass)throw new Error('二维码不是本站的一码通，请勿导入校园认证码或支付码');
  // The screenshot never leaves the device; ONLY the bearer pass is sent via
  // HTTPS POST for mandatory validity verification. No URL query token.
  const restored=await request('/api/pass/restore',{method:'POST',data:{token:pass}});
  const verified=await request('/api/events/'+restored.eventId);
  if(!verified.registration)throw new Error('服务器未确认该截图的报名权限');
  const event=app.events.find(x=>x.id===restored.eventId);
  if(!event)throw new Error('凭证有效，但活动尚未出现在当前活动列表，请联系主办方');
  await viewEvent(event);
  notice('服务端查验通过，已恢复这场活动。花工木棉 App 也会加密保存本机票夹；请继续保留原截图。','success');
}
async function renderStudentPassDesk(root){
  const native=window.BombaxAppVault;
  const box=card(native?.enabled?'本机活动票夹 · 无账号':'一码通找回 · 无账号',
    text('活动报名不用登录。每次报名都只有一个固定二维码，可随时查询、补交材料或在现场签到。'),
    text('请务必另外截图保存一码通！在手机设置中清除 App 应用数据（包括本机活动记录和缓存）、卸载、换手机，或丢失原浏览器 Cookie，都可能失去本机凭证。恢复时必须联网由服务器查验；仅保存本机数据不是独立备份。'),
    text('一码通等同于私密报名凭证，截图持有人也可查看报名，请勿公开转发。'));
  const picker=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'});
  picker.setAttribute('aria-label','从照片导入旧的一码通截图');
  box.append(label('从照片恢复旧的一码通（仅本机识图，服务器查验有效性）',picker),
    button('导入截图并向服务器查证',()=>safe(async()=>{
      const file=picker.files?.[0];if(!file)throw new Error('请先选择保存的一码通截图');
      await importPassImage(file);picker.value='';
    }),'secondary'));
  if(native?.enabled){
    const lines=el('div',{},text('正在读取本机加密票夹…'));
    box.append(el('h3',{text:'本机已经参与的活动'}),lines,
      text('这里只在本机加密保存活动、上次查验状态和二维码凭证，不会建立花工木棉用户账号。离线记录仅供参考，以联网时服务器查验为准。'));
    native.call('list').then(rows=>{
      if(!box.isConnected)return;
      lines.replaceChildren();
      if(!rows?.length){lines.append(text('本机尚未保存活动，报名或导入截图后会自动保管。'));return;}
      for(const row of rows){
        const status=row.attended?'上次同步：已签到':row.state==='approved'?'上次同步：审核通过':row.state==='pending'?'上次同步：审核中':'上次同步：需补材料 / 被驳回';
        lines.append(el('div',{class:'item'},el('strong',{text:row.title||'活动'}),
          text(status),el('div',{class:'row'},
            button('联网验证并打开',()=>safe(async()=>{
              await native.call('restore',{eventId:row.eventId});
              const event=app.events.find(x=>x.id===row.eventId);
              if(!event)throw new Error('活动暂未列出，无法联网查询；票夹未删除');
              const proof=await request('/api/events/'+row.eventId);
              if(!proof.registration)throw new Error('服务端尚未认可本机凭证，请导入原截图');
              await viewEvent(event);
              notice('服务端已确认一码通有效，当前报名状态已刷新','success');
            }),'secondary'),
            button('从本机移除此活动',()=>safe(async()=>{
              if(!window.confirm('只删除本机加密副本。截图和服务器报名不会自动注销；确认删除？'))return;
              await native.call('forget',{eventId:row.eventId});
              await renderStudentPassDesk(root);
              box.remove();
            }),'secondary'))));
      }
    }).catch(()=>{
      if(box.isConnected)lines.replaceChildren(text('本机票夹暂不可用。仍可截图保存，或导入既有二维码。'));
    });
  }else box.append(text('网页版无需安装 App；单独保存截图即可，换设备可以在此导入并查证。'));
  root.prepend(box);
}
async function viewEvent(event){
  clean();app.active=event.id;
  const root=$('content');root.replaceChildren();
  // A staff member visiting the student homepage must still see the student
  // event experience; privileged tools appear ONLY under the /admin route.
  const adminMode=page()==='admin'&&app.me?.role==='organizer';
  const head=card(event.title,button('← 返回'+(adminMode?'管理后台':'活动列表'),
    ()=>{location.assign(adminMode?'/admin':'/');},'secondary'),
    text(adminMode?'活动工作人员操作台：资料审核与现场签到分别记录。':
      '无需登录：报名后可用同一个一码通查询审核及签到状态。'));
  root.append(head);
  if(adminMode)await organizerView(event,root);
  else await studentView(event,root);
}
const MAX_EVIDENCE_SOURCE_BYTES=12*1024*1024;
const MAX_EVIDENCE_BYTES=3*1024*1024;
const MAX_EVIDENCE_SOURCE_PIXELS=12_000_000;
const MAX_EVIDENCE_EDGE=3200;
const MAX_EVIDENCE_OUTPUT_PIXELS=8_000_000;
async function compressEvidenceImage(file){
  if(!file||!['image/png','image/jpeg'].includes(file.type))
    throw new Error('请选择 PNG 或 JPEG 格式的截图');
  if(!Number.isFinite(file.size)||file.size<16||file.size>MAX_EVIDENCE_SOURCE_BYTES)
    throw new Error('原始截图必须小于 12 MB');
  let decoded=null,canvas=null,release=()=>{};
  try{
    let source;
    // Use the browser/WebView's native image decoder. No extra JS decoder is loaded.
    if(typeof window.createImageBitmap==='function'){
      decoded=await window.createImageBitmap(file);
      source=decoded;
      release=()=>{try{decoded?.close();}catch{}};
    }else{
      const objectUrl=URL.createObjectURL(file),image=new Image();
      try{
        await new Promise((resolve,reject)=>{
          image.onload=resolve;
          image.onerror=()=>reject(new Error('手机无法解码这张截图，请换一张 PNG/JPEG 图片'));
          image.src=objectUrl;
        });
      }catch(error){URL.revokeObjectURL(objectUrl);throw error;}
      source=image;
      release=()=>{image.src='';URL.revokeObjectURL(objectUrl);};
    }
    const width=Number(source.width||source.naturalWidth);
    const height=Number(source.height||source.naturalHeight);
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)
      throw new Error('无法读取截图尺寸，请重新选择图片');
    if(width*height>MAX_EVIDENCE_SOURCE_PIXELS)
      throw new Error('截图分辨率过高，请先在手机相册中裁剪后再上传');
    const scale=Math.min(1,MAX_EVIDENCE_EDGE/Math.max(width,height),
      Math.sqrt(MAX_EVIDENCE_OUTPUT_PIXELS/(width*height)));
    const outputWidth=Math.max(1,Math.round(width*scale));
    const outputHeight=Math.max(1,Math.round(height*scale));
    canvas=document.createElement('canvas');
    canvas.width=outputWidth;canvas.height=outputHeight;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('当前浏览器无法处理图片，请更新浏览器后重试');
    // Screenshots are opaque; flatten any transparency onto white before JPEG encoding.
    context.fillStyle='#fff';context.fillRect(0,0,outputWidth,outputHeight);
    context.drawImage(source,0,0,outputWidth,outputHeight);
    const blob=await new Promise((resolve,reject)=>{
      canvas.toBlob(result=>{
        if(!result||result.type!=='image/jpeg'||result.size<16)
          reject(new Error('手机无法生成 JPEG 压缩图，请重新选择截图'));
        else resolve(result);
      },'image/jpeg',0.75);
    });
    if(blob.size>MAX_EVIDENCE_BYTES)
      throw new Error('压缩后仍超过 3 MB，请在手机相册中裁剪截图后重试');
    return {blob,width:outputWidth,height:outputHeight,originalBytes:file.size,compressedBytes:blob.size};
  }finally{
    try{release();}catch{}
    if(canvas){canvas.width=0;canvas.height=0;}
  }
}
async function studentView(event,root){
  const snapshot=await request('/api/events/'+event.id);
  const reg=snapshot.registration;
  if(reg && window.BombaxAppVault?.enabled){
    try{
      await window.BombaxAppVault.call('save',{
        eventId:event.id,title:event.title,state:reg.state,
        attended:!!reg.attendance,expiresAt:event.ends_at+30*86400_000
      });
    }catch{
      notice('本机加密保存暂未完成，请立即截图保存一码通，以免换机无法恢复。','error');
    }
  }
  const box=card('我的报名与审核状态');
  root.append(box);
  if(!reg){
    if(snapshot.receiptRevoked){
      box.append(el('div',{class:'receipt-rejected-banner',role:'alert'},
        el('h3',{text:'原二维码已永久作废'}),
        text('这张二维码对应的报名已被驳回并重新提交。旧二维码不可用于查询或签到。请导入重新填报后保存的新二维码截图。'),
        el('a',{href:'/my',text:'导入新的有效一码通截图'})));
      return;
    }
    const privacy=el('input',{type:'checkbox',name:'privacyAcknowledged',value:'yes'});
    const join=form([
      label('虚构测试姓名（以“测试”开头）',inp('displayName')),
      label('虚构测试学号（TEST- 开头）',inp('studentNumber')),
      label('补充说明（可选）',el('textarea',{name:'note',maxlength:'500'})),
      el('label',{class:'check'},privacy,app.allowTestImageUpload
        ?'我确认报名姓名和学号仅为虚构测试资料；如上传截图，我有权提交该图片，并理解图片会存入独立上传测试存储供性能测试，测试结束后清理。请勿上传他人的私密信息。'
        :'我确认仅使用虚构测试资料，理解报名会保存自填信息和内置模拟截图，仅授权工作人员可查看；本测试站尚不支持真实报名或学校实名认证。')
    ],'免登录提交报名',async v=>{
      if(!privacy.checked)throw new Error('请先确认虚构数据演练说明');
      await request('/api/events/'+event.id+'/join',{method:'POST',data:{
        displayName:v.displayName,studentNumber:v.studentNumber,note:v.note,
        privacyAcknowledged:true,aiConsent:false
      }});
      await studentViewReload(event);
      notice('报名成功！一码通二维码已经生成；请立即保存，以后查询和签到都使用这一个码。','success');
    });
    box.append(text('无需登录。演练环境仅接受 TEST- 虚构学号及“测试”开头的姓名；同一设备报名后可再次打开本活动查看状态。'),join);
    return;
  }
  const attendance=reg.attendance;
  if(snapshot.reissued){
    box.append(el('div',{class:'receipt-rejected-banner',role:'status'},
      el('h3',{text:'旧二维码已永久作废 · 当前是全新一码通'}),
      text('你正在查看重新填报后的新凭证。此前保存的全部旧二维码截图均无效。请立即截图保存下方新二维码，之后只使用新码查状态和签到。')));
  }
  if(reg.state==='rejected'&&!attendance){
    const privacy=el('input',{type:'checkbox',name:'privacyAcknowledged',value:'yes'});
    const rejoin=form([
      label('重新填写虚构姓名（测试开头）',inp('displayName')),
      label('重新填写虚构学号（TEST-开头）',inp('studentNumber')),
      label('根据驳回意见补充新的报名说明',el('textarea',{name:'note',maxlength:'500'})),
      el('label',{class:'check'},privacy,'我同意重新提交一个独立报名，旧一码通永久作废；旧截图不能再用于查询或核销。')
    ],'重新填报，生成全新二维码并作废原码',async values=>{
      if(!privacy.checked)throw new Error('请先确认原二维码将永久作废');
      if(!window.confirm('确定重新填报？当前旧二维码将立即作废，旧截图失去效力，之后只能使用新二维码。'))return;
      const outcome=await request('/api/events/'+event.id+'/reapply',{
        method:'POST',data:{displayName:values.displayName,studentNumber:values.studentNumber,
          note:values.note,privacyAcknowledged:true,aiConsent:false}
      });
      if(!outcome.oldReceiptRevoked||!outcome.newPassIssued)
        throw new Error('服务器未确认旧码作废或新码签发，请联系工作人员');
      await studentViewReload(event);
      notice('重新填报成功：原二维码已作废！请立即截图保存全新的二维码，之前的截图全部失效。','success');
    });
    box.append(el('div',{class:'receipt-rejected-banner',role:'alert'},
      el('h3',{text:'报名已驳回 · 旧二维码不可签到'}),
      text('驳回意见：'+(reg.reviewReason||'请按主办方要求更正资料')),
      text('选择重新填报后将生成完全不同的一码通。旧二维码将永久作废，旧材料不自动继承。'),
      rejoin));
  }
  box.append(el('div',{class:'row'},
    el('span',{class:'tag',text:reg.state==='approved'?'审核通过 · 可参加现场签到':reg.state==='pending'?'审核中 · 暂不可签到':'需补充材料 · 暂不可签到'}),
    el('span',{class:'tag '+(attendance?'green':''),text:attendance?'已签到（'+(attendance.channel==='manual'?'人工通道':'扫码')+'）':'尚未签到'})));
  const passResponse=await request('/api/events/'+event.id+'/pass-qr',{method:'POST'});
  const passSvg=await passResponse.blob();
  if(app.qr)URL.revokeObjectURL(app.qr);
  app.qr=URL.createObjectURL(passSvg);
  box.append(el('h3',{text:reg.state==='rejected'?'原一码通 · 驳回后仅可查看意见':'我的一码通 · 报名时生成的固定二维码'}),
    el('img',{class:'qr',src:app.qr,alt:'本次活动唯一的一码通凭证，可查询报名状态并由工作人员扫码核销'}),
    el('div',{class:'row'},
      el('a',{href:app.qr,download:'花工木棉-活动一码通.svg',text:'下载并保存一码通二维码'})),
    text(reg.state==='rejected'
      ?'该二维码对应已驳回的旧申请。只有重新填报并取得新二维码后，才能用新码再次参与审核；重新填报将立即作废旧码。'
      :'整个活动同一份有效报名都用这一个二维码；扫码签到后仍能查询。'),
    text('二维码相当于私密通行凭证，请勿转发或展示给陌生人；工作人员核销时仍需当面核实身份。'),
    text(window.BombaxAppVault?.enabled
      ? '本机 App 已尝试用 Android Keystore 加密保管本场活动。请仍截图保存二维码，清除应用数据或卸载时本机保险箱会消失。'
      : '网页版请另外截图保存一码通。换设备后选择“从照片恢复旧的一码通截图”即可向服务器验证。'));
  if(reg.reviewReason)box.append(text('审核意见：'+reg.reviewReason));
  if(attendance&&reg.state!=='approved')box.append(text('人工通道已记录到场，仍需补齐证明材料并获得审核通过。'));
  const files=await request('/api/events/'+event.id+'/materials');
  for(const f of files.materials)box.append(el('div',{class:'item'},
    text('已上传 '+f.mime+' · '+Math.ceil(f.length/1024)+' KB')));
  if(reg.state!=='rejected'&&(!attendance||attendance.channel==='manual')){
    box.append(el('h3',{text:'证明截图上传'}),
      text(app.syntheticOnly&&!app.allowTestImageUpload
        ?'只允许使用本站内置的虚构图片。Worker 会校验文件 SHA-256；真实图片会被拒绝。'
        :app.allowTestImageUpload
          ?'独立上传性能测试环境：最多三张 PNG/JPEG。请只上传你有权提交的截图；图片会存入独立私有测试存储，并在本轮测试结束后清理。'
          :'最多三张 PNG/JPEG。手机会先在本机以 JPEG 质量 75% 压缩，原图上限 12 MB，上传文件上限 3 MB。'));
    if(app.syntheticOnly&&!app.allowTestImageUpload)box.append(el('img',{class:'qr',src:'/demo-proof.png',alt:'系统内置、标注 TEST ONLY 的虚构点赞截图'}));
    if(app.syntheticOnly&&!app.allowTestImageUpload)box.append(button('真正上传内置模拟截图至私有 R2',async()=>{
      const source=await fetch('/demo-proof.png',{credentials:'same-origin'});
      if(!source.ok)throw new Error('无法获取内置测试图片');
      const blob=await source.blob();
      await request('/api/events/'+event.id+'/upload',{method:'POST',raw:blob,headers:{'Content-Type':'image/png'}});
      notice('图片已上传到私有 R2，等待审核员处理。','success');await studentViewReload(event);
    },'secondary'));
    if(!app.syntheticOnly||app.allowTestImageUpload){
      const fileInput=el('input',{type:'file',accept:'image/png,image/jpeg'});
      const testKeyInput=app.allowTestImageUpload
        ?el('input',{type:'password',autocomplete:'off',placeholder:'本轮上传测试访问码','aria-label':'本轮上传测试访问码'})
        :null;
      if(testKeyInput)box.append(label('隔离测试访问码（仅当前页面内存使用）',testKeyInput));
      let uploading=false;
      const uploadButton=button('本机压缩并上传截图（JPEG 75%）',async()=>{
        if(uploading)return;
        const f=fileInput.files?.[0];if(!f)throw new Error('请选择截图');
        if(testKeyInput&&!testKeyInput.value.trim())throw new Error('请输入隔离上传测试访问码');
        uploading=true;fileInput.disabled=true;uploadButton.disabled=true;
        if(testKeyInput)testKeyInput.disabled=true;
        try{
          notice('正在手机本机压缩截图；原图不会先上传或发送给第三方。');
          const compressed=await compressEvidenceImage(f);
          await request('/api/events/'+event.id+'/upload',{
            method:'POST',raw:compressed.blob,headers:{'Content-Type':'image/jpeg',
              ...(testKeyInput?{'X-Bombax-Upload-Test-Key':testKeyInput.value.trim()}:{})}
          });
          await studentViewReload(event);
          notice('截图已压缩为 JPEG（质量 75%）并提交：'+
            Math.ceil(compressed.originalBytes/1024)+' KB → '+
            Math.ceil(compressed.compressedBytes/1024)+' KB。','success');
        }finally{
          uploading=false;fileInput.disabled=false;uploadButton.disabled=false;
          if(testKeyInput)testKeyInput.disabled=false;
        }
      });
      box.append(fileInput,uploadButton);
    }
  }
  if(!attendance){
    box.append(el('hr'),text(
      reg.state==='approved'
        ? '审核已通过。请在活动现场出示上方一码通，由已登录的工作人员核对身份后扫码签到；无需 GPS 重新生成二维码。'
        : '同一个一码通可以随时查询审核进度。审核通过之前不能签到；你仍可按要求上传内置模拟材料。'
    ));
  }
  box.append(button('刷新审核结果',()=>studentViewReload(event),'secondary'));
}
async function studentViewReload(event){if(app.active===event.id){$('content').replaceChildren();await viewEvent(event);}}
async function organizerView(event,root){
  const response=await request('/api/events/'+event.id+'/queue');
  const duty=response.duty,queue=response.registrations,duties=response.duties||[duty];
  const roles={owner:'负责人',reviewer:'后台材料审核',scanner:'快速扫码',manual:'人工确认到场'};
  const panel=card('工作岗位：'+(roles[duty]||duty),
    text(duty==='reviewer'?'批量材料审核由工作人员手动刷新，避免打勾过程中被覆盖。':'其他岗位可自动刷新；扫码摄像头不会被定时重绘。'));
  root.append(panel);
  const totals=el('div',{class:'row'},
    el('span',{class:'tag',text:'报名 '+queue.length}),
    el('span',{class:'tag',text:'待审核 '+queue.filter(x=>x.state==='pending').length}),
    el('span',{class:'tag green',text:'已到场 '+queue.filter(x=>x.attended_at||x.attendedAt).length}));
  panel.append(totals);
  if(duty==='owner'){
    const preview=el('img',{class:'admin-illustration-preview',src:'/api/events/'+event.id+'/banner',
      alt:event.title+' 当前 21:9 SVG 主题插画'});
    const preset=el('select',{'aria-label':'选择内置 SVG 插画'});
    for(const [value,name] of [['concert','音乐与招新'],['sports','运动与比赛'],
      ['volunteer','志愿与服务'],['lecture','讲座与分享'],['celebration','节日与游园']])
      preset.append(el('option',{value,text:name}));
    const artFile=el('input',{type:'file',accept:'.svg,image/svg+xml'});
    artFile.setAttribute('aria-label','上传小于100KB的静态SVG横幅');
    panel.append(el('details',{class:'banner-editor'},
      el('summary',{text:'活动卡通横幅 · 替换/恢复内置插画（21:9）'}),
      text('只允许小于 100 KB 的静态 SVG。服务器会拒绝脚本、外链图片、动画、CSS 引用及非 21:9 文件。'),
      preview,preset,el('div',{class:'row'},
        button('应用选中的内置插画',async()=>{
          await request('/api/events/'+event.id+'/banner-preset',{method:'POST',data:{preset:preset.value}});
          preview.src='/api/events/'+event.id+'/banner?v='+Date.now();
          notice('已更新内置 SVG 卡通插画','success');
        },'secondary')),
      artFile,button('上传并替换本活动横幅',async()=>{
        const file=artFile.files?.[0];
        if(!file||!file.name.toLowerCase().endsWith('.svg')||file.size>=100000||file.size<=0)
          throw new Error('请选择小于 100 KB 的静态 SVG 文件');
        await request('/api/events/'+event.id+'/banner',{method:'POST',raw:file,
          headers:{'Content-Type':'image/svg+xml'}});
        preview.src='/api/events/'+event.id+'/banner?v='+Date.now();
        notice('SVG 已经过服务器安全校验并替换活动横幅','success');
      })));
    const staffDetails=el('details',{},el('summary',{text:'工作人员岗位授权表 · 多岗位勾选及撤权'}));
    const staffTarget=el('div',{});
    staffDetails.append(staffTarget);
    let staffLoaded=false;
    staffDetails.addEventListener('toggle',()=>{
      if(!staffDetails.open||staffLoaded)return;
      staffLoaded=true;
      if(!window.BombaxStaffRoles){
        notice('工作人员岗位授权组件加载失败，请刷新管理后台','error');
        return;
      }
      app.staffDispose=window.BombaxStaffRoles.mount({
        root:staffTarget,eventId:event.id,request,notify:notice
      });
    });
    panel.append(staffDetails);
  }
  const mode=el('div',{class:'row'});
  if(duty==='owner'){
    for(const m of ['reviewer','scanner','manual'])mode.append(button(roles[m],()=>renderDuty(event,root,m,true),'secondary'));
    panel.append(mode);
  }else if(duties.length>1){
    for(const item of duties)mode.append(button(roles[item],()=>renderDuty(event,root,item,false),'secondary'));
    panel.append(mode);
    await renderDuty(event,root,duty,false);
  }else await renderDuty(event,root,duty,false);
  if(duty==='owner'||duties.includes('reviewer'))panel.append(button('导出已审核且已到场 CSV',async()=>{
    const response=await request('/api/events/'+event.id+'/export');
    const url=URL.createObjectURL(await response.blob()),anchor=el('a',{href:url,download:'花工木棉-活动申报名单.csv'});
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  },'secondary'));
  app.poll=setInterval(async()=>{
    if(document.visibilityState!=='visible'||app.active!==event.id)return;
    const focused=document.activeElement;
    if(focused&&['INPUT','TEXTAREA'].includes(focused.tagName))return;
    if(duty==='owner'||duty==='scanner'||duty==='reviewer'||duties.length>1)return;
    // Never redraw the spreadsheet while staff are selecting approval rows.
    await safe(()=>renderDuty(event,root,duty,false));
  },5000);
}
async function renderDuty(event,root,duty,owner){
  const old=$('duty-body');
  if(old?.dataset.duty==='scanner'){
    cleanScanner();
    app.scannerFeedback?.dispose();app.scannerFeedback=null;
  }
  if(old)old.remove();
  app.reviewDispose?.();app.reviewDispose=null;
  const slot=card(duty==='reviewer'?'待审核队列':duty==='scanner'?'扫码通道':'人工认证窗口');
  slot.id='duty-body';root.append(slot);
  const response=await request('/api/events/'+event.id+'/queue?duty='+encodeURIComponent(duty));
  const all=response.registrations;
  if(duty==='reviewer'){
    slot.append(text('表格提供全选与 Shift 连续多选；勾「通过」后统一确认。图片会在右侧预览，支持前后顺序切换。'));
    if(!window.BombaxReviewGrid)throw new Error('批量审核组件尚未加载，请刷新后台');
    app.reviewDispose=window.BombaxReviewGrid.mount({
      root:slot,rows:all,eventId:event.id,request,
      notify:notice,onCommitted:()=>renderDuty(event,root,duty,owner)
    });
  }else if(duty==='manual'){
    slot.append(text('只在当面核对身份后操作。人工到场不等于集赞材料通过。'));
    const search=el('input',{placeholder:'搜索姓名或自填学号'}),list=el('div');
    slot.append(search,list);
    function draw(){
      list.replaceChildren();
      for(const r of all.filter(r=>!(r.attended_at||r.attendedAt))
        .filter(r=>String(r.displayName||r.display_name).includes(search.value)||String(r.studentNumber||r.student_number).includes(search.value)).slice(0,30)){
        const rid=r.id,who=r.displayName||r.display_name,id=r.studentNumber||r.student_number;
        const reason=el('input',{placeholder:'现场兜底原因（必填）',maxlength:'250'}),checked=el('input',{type:'checkbox'});
        list.append(el('div',{class:'item'},el('strong',{text:who+' · '+id}),
          reason,el('label',{class:'check'},checked,'已经在现场当面核对该学生身份'),
          button('记录到场',async()=>{
            if(!checked.checked||!reason.value.trim())throw new Error('必须先确认身份并填写原因');
            await request('/api/events/'+event.id+'/manual-checkin',{method:'POST',
              data:{registrationId:rid,reason:reason.value.trim(),identityChecked:true}});
            notice('已记录到场，材料审核仍独立进行。','success');await renderDuty(event,root,duty,owner);
          })));
      }
    }
    search.addEventListener('input',draw);draw();
  }else if(duty==='scanner'){
    slot.dataset.duty='scanner';
    slot.append(text('只核销花工木棉报名时生成的一码通：先检查审核状态并在现场核对本人身份。学校校园认证码和支付码无效。'));
    const status=el('div',{class:'status',role:'status','aria-live':'polite',text:'摄像头尚未开启。'});
    const token=el('input',{type:'text',placeholder:'备用：粘贴完整一码通或其私密链接',maxlength:160,
      autocomplete:'off',autocapitalize:'off',spellcheck:'false','aria-label':'完整花工木棉签到码'});
    const feedback=window.BombaxCheckinFeedback?.create();
    if(!feedback)throw new Error('扫码反馈组件未加载，请刷新测试站');
    app.scannerFeedback=feedback;
    const soundControls=[],markers=[];
    let scanning=false,lastAccepted='',lastAttempt='',lastAttemptAt=0,successResetTimer=null;
    function report(message,kind='normal'){
      status.textContent=message;
      status.className='status '+(kind==='ok'?'scan-good':kind==='error'?'scan-error':'');
      const overlay=app.scannerOverlay;
      if(overlay){
        const hud=overlay.querySelector('[data-scanner-result]');
        if(hud){
          hud.textContent=message;
          hud.dataset.kind=kind;
        }
      }
    }
    function marker(compact=false){
      const number=el('strong',{class:'scan-marker-number',text:'#000'});
      const caption=el('span',{class:'scan-marker-caption',text:'等待第 1 位 · 只有服务端确认成功才计数'});
      const card=el('div',{
        class:'scan-marker'+(compact?' scan-marker-overlay':''),
        'data-result':'idle',role:'status','aria-live':compact?'off':'polite'
      },el('span',{class:'scan-marker-title',text:'本机本次成功核销'}),number,caption);
      // Discard detached overlay views when staff reopen full-screen camera.
      for(let i=markers.length-1;i>=0;i--)if(!markers[i].card.isConnected)markers.splice(i,1);
      markers.push({card,number,caption});
      if(feedback.count){
        number.textContent='#'+String(feedback.count).padStart(3,'0');
        caption.textContent='上一次成功 · 等待下一位';
        card.dataset.result=feedback.count%2?'odd':'even';
      }
      return card;
    }
    function markSuccess(confirmation){
      for(const view of markers){
        view.number.textContent=confirmation.marker;
        view.caption.textContent='第 '+confirmation.count+' 位成功 · 等待下一位';
        view.card.dataset.result=confirmation.variant;
        view.card.classList.remove('scan-marker-pulse');
        void view.card.offsetWidth;
        view.card.classList.add('scan-marker-pulse');
      }
    }
    function markFailed(){
      for(const view of markers){
        view.card.dataset.result='error';
        view.caption.textContent='刚才的核销未通过 · 成功计数未增加';
      }
    }
    function syncSoundControls(){
      for(const item of soundControls){
        item.textContent=feedback.soundEnabled?'🔔 成功/错误提示音：开':'🔕 成功/错误提示音：关';
        item.setAttribute('aria-checked',String(feedback.soundEnabled));
        item.setAttribute('aria-label',feedback.soundEnabled?'关闭成功与失败提示音':'开启成功与失败提示音');
      }
    }
    function soundSwitch(css='secondary'){
      const control=el('button',{
        type:'button',class:css,role:'switch','aria-checked':'false',
        'aria-label':'开启成功与失败提示音'
      },'🔕 成功/错误提示音：关');
      control.addEventListener('click',()=>safe(async()=>{
        const requested=!feedback.soundEnabled;
        const active=await feedback.setSound(requested);
        syncSoundControls();
        report(requested&&!active
          ? '浏览器无法开启提示音，请检查系统音量或改用文字计数'
          : active?'8-bit 提示音已开启：成功响亮上行音、失败两段下降警示音':'提示音已关闭：仅显示成功编号',
          requested&&!active?'error':'normal');
      }));
      // Keep both the panel and fullscreen switches synchronized, including
      // when fullscreen opens after the panel switch was already enabled.
      for(let i=soundControls.length-1;i>=0;i--)
        if(!soundControls[i].isConnected)soundControls.splice(i,1);
      soundControls.push(control);
      syncSoundControls();
      return control;
    }
    function clearSuccessReset(){
      if(successResetTimer){clearTimeout(successResetTimer);successResetTimer=null;}
    }
    async function redeem(value){
      // Same static pass is valid for status lookup and staff check-in.
      // Scanner accepts only a raw bqx_ pass or this site's exact #pass URL.
      const checkin=window.BombaxScanner?.normalizeToken(String(value||'').trim())||'';
      if(scanning||checkin===lastAccepted)return;
      if(!window.BombaxScanner?.validToken(checkin)){
        if(lastAttempt!==checkin||Date.now()-lastAttemptAt>2000){
          report('不是花工木棉签到码；请勿扫描学校支付或认证二维码。','error');
          markFailed();
          feedback.rejected({audible:!document.hidden});
        }
        lastAttempt=checkin;lastAttemptAt=Date.now();
        return;
      }
      // A continuously visible already-redeemed/expired QR must not cause
      // repeated requests against the high-throughput onsite check-in API.
      if(checkin===lastAttempt&&Date.now()-lastAttemptAt<3000)return;
      lastAttempt=checkin;lastAttemptAt=Date.now();
      clearSuccessReset();
      scanning=true;
      report('正在核销下一位…');
      try{
        const confirmation=await request('/api/events/'+event.id+'/redeem',{
          method:'POST',data:{token:checkin}
        });
        if(confirmation?.ok!==true)throw new Error('服务端尚未确认核销成功');
        lastAccepted=checkin;
        // One increment (and at most one bell) per confirmed server response.
        // Failed, duplicate, unauthorized or in-flight scans never count.
        const receipt=feedback.confirmed({audible:!document.hidden});
        markSuccess(receipt);
        syncSoundControls();
        report('✓ 核销成功 '+receipt.marker+' · 本机已成功 '+receipt.count+' 人','ok');
        token.value='';
        try{navigator.vibrate?.(75);}catch{}
        successResetTimer=setTimeout(()=>{
          successResetTimer=null;
          if(!scanning&&slot.isConnected&&app.active===event.id&&feedback.count===receipt.count){
            report('等待下一位 · 本机已成功核销 '+receipt.count+' 人');
            for(const view of markers)view.caption.textContent='上一次成功 '+receipt.marker+' · 等待下一位';
          }
        },2100);
      }catch(e){
        markFailed();
        feedback.rejected({audible:!document.hidden});
        report('核销失败：'+e.message+'（成功计数未增加）','error');
        try{navigator.vibrate?.([75,55,75]);}catch{}
      }finally{
        setTimeout(()=>{scanning=false;},650);
      }
    }
    async function startCamera(video,overlay,epoch){
      if(app.scannerOverlay!==overlay||app.scannerEpoch!==epoch)return;
      report('正在启动后置摄像头…');
      try{
        await loadQrReader();
        if(epoch!==app.scannerEpoch)return;
        const reader=new window.ZXingBrowser.BrowserQRCodeReader();
        const controls=await reader.decodeFromVideoDevice(undefined,video,code=>{
          if(code?.getText)void redeem(code.getText());
        });
        if(app.scannerOverlay!==overlay||app.scannerEpoch!==epoch){
          controls.stop();
          try{video.srcObject?.getTracks?.().forEach(track=>track.stop());}catch{}
          video.srcObject=null;
          return;
        }
        app.scanner=controls;
        report('摄像头已就绪 · 将二维码对准中央取景框');
      }catch(error){
        if(app.scannerOverlay===overlay&&app.scannerEpoch===epoch){
          report(window.BombaxScanner.scannerProblem(error),'error');
        }
      }
    }
    function openCamera(){
      if(!window.BombaxScanner)
        throw new Error('扫码组件尚未加载。请刷新页面，或前往人工认证窗口。');
      if(!window.isSecureContext)
        throw new Error('摄像头必须通过有效 HTTPS 打开。纯 HTTP 校园网地址不可用。');
      cleanScanner();
      const video=el('video',{autoplay:'autoplay',playsinline:'playsinline',muted:'muted',
        'aria-label':'实时二维码摄像头画面'});
      const close=button('✕ 退出扫码',()=>cleanScanner(),'scanner-fullscreen-close');
      close.setAttribute('aria-label','退出全屏扫码，关闭摄像头');
      const hdr=el('div',{class:'scanner-fullscreen-header'},
        el('div',{class:'scanner-fullscreen-brand'},
          el('strong',{text:'花工木棉 · 全屏扫码'}),
          el('span',{text:'仅限本场活动一码通'})),close);
      const target=el('div',{class:'scanner-target','aria-hidden':'true'},
        el('div',{class:'scanner-target-line'}));
      const hud=el('div',{class:'scanner-fullscreen-result','data-scanner-result':'',role:'status',
        'aria-live':'polite',text:'正在申请相机权限…'});
      const retry=button('重新开启摄像头',()=>{
        if(app.scannerOverlay!==overlay)return;
        try{app.scanner?.stop();}catch{}
        app.scanner=null;
        try{video.srcObject?.getTracks?.().forEach(track=>track.stop());}catch{}
        video.srcObject=null;
        void startCamera(video,overlay,epoch);
      },'scanner-fullscreen-retry');
      const bottom=el('div',{class:'scanner-fullscreen-footer'},
        marker(true),hud,
        el('div',{class:'scanner-fullscreen-controls'},
          soundSwitch('scanner-fullscreen-sound'),retry),
        el('p',{text:'每次成功编号加一、播放一次 8-bit 上行提示音；失败或重复不加，播放两段更响亮的 8-bit 下降警示音（须先开启音效）。继续扫描下一位的一码通。'}));
      const overlay=el('div',{class:'bombax-scanner-fullscreen',role:'dialog','aria-modal':'true',
        'aria-label':'全屏二维码签到扫码','tabindex':'-1'},
        video,el('div',{class:'scanner-fullscreen-shade','aria-hidden':'true'}),
        hdr,el('div',{class:'scanner-target-wrap'},target),bottom);
      // Full-viewport fixed UI works on browsers without Fullscreen API.
      // When allowed, requestFullscreen hides browser chrome as well.
      document.body.append(overlay);
      document.body.classList.add('scanner-modal-open');
      app.scannerOverlay=overlay;
      app.scannerVideo=video;
      const epoch=++app.scannerEpoch;
      app.scannerPreviousFocus=document.activeElement;
      app.scannerFullscreenEntered=false;
      if(!history.state?.__bombaxScanner){
        try{history.pushState({__bombaxScanner:true},'',location.href);app.scannerHistory=true;}
        catch{app.scannerHistory=false;}
      }
      overlay.focus();
      if(typeof overlay.requestFullscreen==='function'){
        try{
          Promise.resolve(overlay.requestFullscreen({navigationUI:'hide'})).then(()=>{
            if(app.scannerOverlay===overlay&&document.fullscreenElement===overlay)
              app.scannerFullscreenEntered=true;
          }).catch(()=>{/* fixed-position fallback remains usable */});
        }catch{/* fixed-position fallback remains usable */}
      }
      void startCamera(video,overlay,epoch);
    }
    function previewSound(kind){
      // Staff must opt in first; sample tones never call the server or alter
      // the success counter, even during active camera scanning.
      if(!feedback.soundEnabled){
        report('请先手动开启提示音，再试听。试听不核销、不计数。','error');
        return;
      }
      const sample=feedback.preview(kind,{audible:!document.hidden});
      report(sample.played
        ?kind==='success'?'已试听成功 8-bit 上行音：未核销，成功编号不变':'已试听失败 8-bit 下降警示音：未核销，成功编号不变'
        :'此设备暂无法播放提示音。请检查系统媒体音量或浏览器声音权限。',
        sample.played?'normal':'error');
    }
    slot.append(el('div',{class:'row scanner-action-row'},
        button('开启全屏摄像头扫码',openCamera),soundSwitch()),
      el('details',{class:'sound-preview'},
        el('summary',{text:'现场试听提示音（不核销、不计数）'}),
        el('div',{class:'row'},
          button('试听成功铃声',()=>previewSound('success'),'secondary'),
          button('试听失败提示音',()=>previewSound('failure'),'secondary'))),
      marker(),status,
      text('成功核销会显示新的 #001、#002… 编号；失败或重复不会加一。音效默认关闭，开启后成功播放一次清晰的 8-bit 上行短音，失败播放两段更响亮的 8-bit 下降警示音。扫码时先核对本人身份。'));
    if(app.syntheticOnly){
      const picker=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp',class:'hidden',
        'aria-label':'只在虚构数据演练站选择二维码图片'});
      picker.addEventListener('change',()=>safe(async()=>{
        const file=picker.files?.[0];picker.value='';
        if(!file)return;
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)
          throw new Error('只接受 2 MB 以内的 PNG/JPEG/WebP 二维码图片');
        await loadQrReader();
        const blobUrl=URL.createObjectURL(file);
        try{
          const image=el('img',{src:blobUrl,alt:'待识别的测试二维码'});
          await image.decode();
          const result=await new window.ZXingBrowser.BrowserQRCodeReader().decodeFromImageElement(image);
          if(!result?.getText)throw new Error('图片未识别出二维码');
          await redeem(result.getText());
        }catch(error){
          if(!String(error.message||'').includes('核销失败'))
            report('图片识码失败：请确认它是清晰的花工木棉测试二维码，且未过期。','error');
        }finally{URL.revokeObjectURL(blobUrl);}
      }));
      slot.append(el('div',{class:'scanner-demo-panel'},
        text('仅虚构数据演练：选择二维码截图进行本机解码，不上传图片；真实活动不开放图片代扫。'),
        button('从图片识别测试二维码',()=>picker.click(),'secondary'),picker));
    }
    slot.append(el('div',{class:'scanner-fallback'},token,
      button('备用：核销已读取的一码通',()=>redeem(token.value),'secondary')));
  }
}
function cleanScanner(){
  ++app.scannerEpoch;
  try{app.scanner?.stop();}catch{}
  app.scanner=null;
  const video=app.scannerVideo;
  try{video?.srcObject?.getTracks?.().forEach(track=>track.stop());}catch{}
  if(video){try{video.pause();}catch{}video.srcObject=null;}
  app.scannerVideo=null;
  const overlay=app.scannerOverlay;
  app.scannerOverlay=null;
  app.scannerFullscreenEntered=false;
  if(overlay){
    if(document.fullscreenElement===overlay){
      try{Promise.resolve(document.exitFullscreen()).catch(()=>{});}catch{}
    }
    overlay.remove();
    document.body.classList.remove('scanner-modal-open');
    if(app.scannerPreviousFocus?.isConnected){
      try{app.scannerPreviousFocus.focus({preventScroll:true});}catch{}
    }
    app.scannerPreviousFocus=null;
  }
  if(app.scannerHistory){
    app.scannerHistory=false;
    if(history.state?.__bombaxScanner){
      try{history.back();}catch{}
    }
  }
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)cleanScanner();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&app.scannerOverlay){event.preventDefault();cleanScanner();}
});
window.addEventListener('popstate',()=>{
  if(app.scannerOverlay){app.scannerHistory=false;cleanScanner();}
});
document.addEventListener('fullscreenchange',()=>{
  if(app.scannerOverlay&&app.scannerFullscreenEntered&&
      document.fullscreenElement!==app.scannerOverlay)cleanScanner();
});
// Native shelf can change only the URL fragment within the already-loaded WebView.
// A same-document navigation does not rerun DOMContentLoaded, so explicitly
// re-verify the stored receipt with the Stage backend before entering an event.
window.addEventListener('hashchange',()=>{
  const fragment=location.hash;
  if(fragment.startsWith('#event=')||fragment.startsWith('#pass='))void launchStart();
});
launchStart();
