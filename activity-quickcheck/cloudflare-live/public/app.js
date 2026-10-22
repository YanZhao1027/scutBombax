'use strict';
const $=id=>document.getElementById(id);
const MODE=document.body.dataset.page||'student';
const PRESETS=Object.freeze([
  ['music','音乐演出'],['volunteer','志愿公益'],['sports','体育运动'],
  ['science','科技创新'],['festival','文化社团']
]);
const app={me:null,events:[],active:null,poll:null,scanner:null,scannerOverlay:null,scannerVideo:null,scannerEpoch:0,scannerHistory:false,scannerFullscreenEntered:false,scannerPreviousFocus:null,scannerFeedback:null,qr:null,syntheticOnly:false};
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
function notice(s,type=''){
  const n=$('notice');n.className='notice '+type;n.textContent=s;
  n.hidden=MODE==='student'&&!type&&s.startsWith('活动速签已连接');
}
async function safe(fn){try{await fn();}catch(e){notice(e.message||'请求失败','error');}}
async function request(path,{method='GET',data,raw,headers={}}={}){
  const options={method,credentials:'same-origin',headers:{...headers}};
  if(method!=='GET')options.headers['X-Bombax-Action']='1';
  if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  if(raw!==undefined)options.body=raw;
  const response=await fetch(path,options);
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
  if(app.qr){URL.revokeObjectURL(app.qr);app.qr=null;}
}
async function start(){
  const ready=await request('/api/health');app.syntheticOnly=Boolean(ready.syntheticOnly);
  if(!ready.ready){notice('生产 API 尚未开放。请使用公开演示站；不要填写真实学生资料。','error');$('account').replaceChildren();$('content').replaceChildren(
    card('正在安全验收',text('此环境目前禁用真实报名、附件和 DeepSeek 处理。'),
      el('a',{href:'https://activity-demo.10273055.xyz/',text:'打开无个人信息的交互演示'})));
    return;
  }
  if(MODE==='adminlogin'){
    const me=await request('/api/me');
    if(me.user?.role==='organizer'){location.replace('/admin/');return;}
    $('account').replaceChildren();
    renderAdminLogin();
    notice('工作人员登录区 · 请使用主办方授权的岗位账号');
    return;
  }
  if(MODE==='admin'){
    const me=await request('/api/me');
    if(me.user?.role!=='organizer'){location.replace('/adminlogin/');return;}
    app.me=me.user;
    app.events=(await request('/api/events')).events;
    renderAccount();home();
    notice('管理后台已连接 · 仅对授权工作人员开放');
    return;
  }
  // The QR opens this page with a private fragment: browsers never send it
  // in the HTTP request. Consume it immediately, then erase it from history.
  let restoredEventId=null;
  const fragment=location.hash;
  if(fragment.startsWith('#event=')){
    // Native Android pass shelf restores the HttpOnly cookie without exposing the
    // receipt to JS. Only the non-secret event UUID travels in this fragment.
    history.replaceState(history.state,'',location.pathname+location.search);
    const match=/^#event=([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(fragment);
    if(match)restoredEventId=match[1];
    else notice('本机票夹的活动编号无效','error');
  }
  if(fragment.startsWith('#pass=')){
    history.replaceState(history.state,'',location.pathname+location.search);
    const match=/^#pass=(bqx_[a-f0-9]{64})$/.exec(fragment);
    if(match){
      try {
        const restored=await request('/api/pass/restore',{method:'POST',data:{token:match[1]}});
        restoredEventId=restored.eventId;
      }catch(error){
        notice(error.message||'一码通无效，请联系活动主办方','error');
      }
    }else notice('这不是有效的花工木棉一码通二维码','error');
  }
  // The public landing page never shows staff login forms, even when
  // an existing organizer HttpOnly session happens to be present.
  const me=await request('/api/me');app.me=me.user;
  app.events=(await request('/api/events')).events;
  renderAccount();home();
  if(restoredEventId){
    const event=app.events.find(x=>x.id===restoredEventId);
    if(event)await viewEvent(event);
    else notice('本次活动不在当前可用列表中，请联系主办方','error');
  }else if(!fragment)notice('活动速签已连接；学生无需登录，报名后请保存一码通二维码。');
}
function renderAccount(){
  const root=$('account');root.replaceChildren();
  if(MODE!=='admin'||app.me?.role!=='organizer')return;
  root.append(el('div',{class:'admin-session'},
    el('strong',{text:'已登录：'+app.me.displayName}),
    button('退出管理后台',async()=>{
      await request('/api/logout',{method:'POST'});clean();
      location.assign('/adminlogin/');
    },'secondary')));
}
function renderAdminLogin(){
  const target=$('content');target.replaceChildren();
  const username=inp('username'),password=inp('password','password');
  const login=form([
    label('授权工作人员用户名',username),
    label('工作人员密码',password)
  ],'安全登录管理后台',async x=>{
    await request('/api/login',{method:'POST',data:x});
    location.replace('/admin/');
  });
  target.append(el('section',{class:'admin-login-panel'},
    el('div',{class:'admin-login-icon',text:'✿'}),
    el('h1',{text:'主办方后台登录'}),
    text('仅活动负责人、材料审核员、现场扫码员和人工确认岗位使用。学生无需登录。'),
    login,el('a',{href:'/',text:'← 返回公开活动首页'})));
}
function bannerUrl(event){
  if(event.has_custom_banner)return '/api/events/'+encodeURIComponent(event.id)+'/banner.svg';
  const chosen=PRESETS.some(x=>x[0]===event.banner_template)?event.banner_template:'music';
  return '/banners/'+chosen+'.svg';
}
function enrollmentDates(event){
  return {open:event.registration_opens_at??event.created_at??event.starts_at,
    close:event.registration_closes_at??event.ends_at};
}
function enrollmentLabel(event){
  const t=Date.now(),{open,close}=enrollmentDates(event);
  return t<open?'即将开放报名':t>close?'报名已截止':'正在报名';
}
function drawEventCard(event){
  const {open,close}=enrollmentDates(event);
  const info=el('div',{class:'activity-info'},
    el('div',{class:'activity-meta'},el('span',{class:'activity-pill',text:enrollmentLabel(event)}),
      el('span',{class:'activity-type',text:'无需账号 · 一码通'})),
    el('h3',{text:event.title}),
    el('div',{class:'activity-detail-label',text:'报名时间'}),
    text(stamp(open)+' — '+stamp(close),'activity-date'),
    el('div',{class:'activity-detail-label',text:'活动时间'}),
    text(stamp(event.starts_at)+' — '+stamp(event.ends_at),'activity-date'),
    el('div',{class:'activity-detail-label',text:'活动要求'}),
    text(event.guidelines||'请以主办方发布的活动说明为准','activity-requirements'),
    button('查看活动 / 免登录报名',()=>viewEvent(event),'activity-open'));
  return el('article',{class:'activity-card'},
    el('img',{class:'activity-banner',src:bannerUrl(event),alt:event.title+'主题卡通横幅',loading:'lazy',decoding:'async'}),
    info);
}
function home(){
  clean();app.active=null;
  const root=$('content');root.replaceChildren();
  if(MODE==='admin'&&app.me?.role==='organizer'){
    const create=form([
      label('活动标题',inp('title')),
      label('审核要求（例如集赞数量）',el('textarea',{name:'guidelines',maxlength:'1000'})),
      label('WGS84 纬度',el('input',{name:'latitude',type:'number',step:'any',required:'required'})),
      label('WGS84 经度',el('input',{name:'longitude',type:'number',step:'any',required:'required'})),
      label('定位半径（米，50–1000）',el('input',{name:'radiusM',type:'number',min:50,max:1000,step:1,value:150,required:'required'})),
      label('开始时间（按设备本地时间）',el('input',{name:'startsAt',type:'datetime-local',value:localInputTime(Date.now()-5*60000),required:'required'})),
      label('结束时间（按设备本地时间）',el('input',{name:'endsAt',type:'datetime-local',value:localInputTime(Date.now()+90*60000),required:'required'})),
      label('报名开放时间',el('input',{name:'registrationOpensAt',type:'datetime-local',value:localInputTime(Date.now()-5*60000),required:'required'})),
      label('报名截止时间',el('input',{name:'registrationClosesAt',type:'datetime-local',value:localInputTime(Date.now()+85*60000),required:'required'})),
      label('活动卡通横幅（内置 21:9 SVG）',el('select',{name:'bannerTemplate'},
        ...PRESETS.map(([id,name])=>el('option',{value:id,text:name})))),
      label('可选：替换为主办方的 21:9 SVG（严格小于 100 KB）',
        el('input',{name:'bannerSvg',type:'file',accept:'.svg,image/svg+xml'}))
    ],'创建活动',async x=>{
      const valid=validateEventInputs(x);
      const registrationOpensAt=new Date(x.registrationOpensAt).getTime();
      const registrationClosesAt=new Date(x.registrationClosesAt).getTime();
      if(!Number.isFinite(registrationOpensAt)||!Number.isFinite(registrationClosesAt)||
        registrationOpensAt>registrationClosesAt||registrationClosesAt>valid.ends)
        throw new Error('报名开始须早于报名截止，报名截止不能晚于活动结束');
      const created=await request('/api/events',{method:'POST',data:{
        title:x.title,guidelines:x.guidelines,latitude:Number(x.latitude),longitude:Number(x.longitude),
        radiusM:valid.radius,startsAt:valid.starts,endsAt:valid.ends,requirePhoto:true,
        registrationOpensAt,registrationClosesAt,bannerTemplate:x.bannerTemplate
      }});
      const art=x.bannerSvg;
      if(art instanceof File&&art.size>0){
        try{await uploadEventBanner(created.id,art);}
        catch(e){notice('活动已创建，但插画上传失败：'+e.message,'error');await start();return;}
      }
      notice('活动创建成功','success');await start();
    });
    const useGps=button('用当前 GPS 作为活动地点',async()=>{
      const pos=await requestPhoneLocation(false);
      if(!Number.isFinite(pos.coords.accuracy)||pos.coords.accuracy>150)
        throw new Error('当前位置精度较差（约 '+Math.round(pos.coords.accuracy||0)+' 米），不建议用作活动中心；请到开阔处或使用准确的 WGS84 坐标。');
      create.elements.latitude.value=pos.coords.latitude.toFixed(7);
      create.elements.longitude.value=pos.coords.longitude.toFixed(7);
      notice('已填写活动地点；学生一码通无需重新定位生成，现场由工作人员当面核验。','success');
    },'secondary');
    const trialCoordinates=button('一键填入虚构测试坐标',async()=>{
      create.elements.latitude.value='23.12';
      create.elements.longitude.value='113.32';
      notice('已填入虚构坐标（不读取真实位置）；一码通签到由工作人员现场核验。','success');
    },'secondary');
    const fillTrialTime=button('一键设置：开始前 5 分钟，结束后 90 分钟',async()=>{
      create.elements.namedItem('startsAt').value=localInputTime(Date.now()-5*60000);
      create.elements.namedItem('endsAt').value=localInputTime(Date.now()+90*60000);
      create.elements.namedItem('registrationOpensAt').value=localInputTime(Date.now()-5*60000);
      create.elements.namedItem('registrationClosesAt').value=localInputTime(Date.now()+85*60000);
      create.elements.namedItem('radiusM').value='150';
      notice('已填入合法的演练时间和 150 米半径（以本设备时间为准）。','success');
    },'secondary');
    root.append(card('主办方：创建活动',
      text(app.syntheticOnly
        ? '虚构数据测试：请使用固定测试坐标，切勿采集真实活动地点或学生定位。一码通签到无需学生 GPS；只能由工作人员现场核对身份。'
        : '填写活动地点，开始须早于结束；活动不超过 7 天。'),
      el('details',{},el('summary',{text:'展开创建表单'}),
        el('div',{class:'row'},app.syntheticOnly?trialCoordinates:useGps,fillTrialTime),
        text('当前设备时区：'+(Intl.DateTimeFormat().resolvedOptions().timeZone||'本地')+'。时间已预填，可直接创建 90 分钟模拟活动。'),
        create)));
  }
  if(MODE==='admin'){
    const selector=el('select',{'aria-label':'选择要管理的活动'},
      el('option',{value:'',text:'选择需要审核或现场处理的活动'}),
      ...app.events.map(e=>el('option',{value:e.id,text:e.title+' · '+stamp(e.starts_at)})));
    root.prepend(el('section',{class:'admin-workspace'},
      el('div',{class:'admin-workspace-header'},
        el('h2',{text:'管理工作台'}),text('选择活动后进入审核、扫码和人员授权；这里不展示学生首页活动卡片。')),
      el('div',{class:'row'},selector,
        button('进入该活动管理',async()=>{
          const event=app.events.find(e=>e.id===selector.value);
          if(!event)throw new Error('请先选择一个活动');
          await viewEvent(event);
        }))));
    return;
  }
  const board=el('section',{class:'activity-board'},
    el('div',{class:'activity-heading'},
      el('h2',{text:'当前运营活动'}),
      el('span',{class:'activity-heading-sub',text:'浏览活动 · 查看要求 · 免登录报名'})));
  const grid=el('div',{class:'activity-grid'});
  const ordered=[...app.events].sort((a,b)=>{
    const aOpen=enrollmentDates(a).close>=Date.now()?0:1;
    const bOpen=enrollmentDates(b).close>=Date.now()?0:1;
    return aOpen-bOpen || a.starts_at-b.starts_at;
  });
  for(const e of ordered)grid.append(drawEventCard(e));
  if(!ordered.length)grid.append(text('活动筹备中，稍后回来查看。'));
  board.append(grid);root.append(board);
  void renderStudentPassDesk(root);
}
async function importPassImage(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)
    throw new Error('请选择 5 MB 以内的 PNG、JPEG 或 WebP 一码通截图');
  if(!window.ZXingBrowser?.BrowserQRCodeReader)throw new Error('二维码识别组件暂不可用，请重新加载');
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
  root.append(el('details',{class:'pass-desk'},
    el('summary',{text:'我的活动 / 从截图找回一码通'}),box));
}
async function uploadEventBanner(eventId,file){
  if(!(file instanceof File)||file.type!=='image/svg+xml')
    throw new Error('只能上传 image/svg+xml 格式的 SVG 文件');
  if(file.size<=100||file.size>=100_000)throw new Error('SVG 插画必须严格小于 100 KB');
  await request('/api/events/'+eventId+'/banner',{
    method:'POST',raw:file,headers:{'Content-Type':'image/svg+xml'}});
}
async function viewEvent(event){
  clean();app.active=event.id;
  const root=$('content');root.replaceChildren();
  const head=card(event.title,button(MODE==='admin'?'← 返回管理台':'← 返回活动',home,'secondary'),
    text(MODE==='admin'?'这里可管理审核、授权岗位和现场核销；一切实际结果以服务端记录为准。':
      '查看报名、补充材料以及固定一码通；请为二维码单独截图备份。'));
  root.append(head);
  if(MODE==='admin'&&app.me?.role==='organizer')await organizerView(event,root);
  else await studentView(event,root);
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
    const dates=enrollmentDates(event),now=Date.now();
    if(now<dates.open||now>dates.close){
      box.append(text('当前不在报名开放时间：'+stamp(dates.open)+' 至 '+stamp(dates.close)+
        '。如已报名，请通过一码通截图恢复后查询审核状态。'));
      return;
    }
    const privacy=el('input',{type:'checkbox',name:'privacyAcknowledged',value:'yes'});
    const join=form([
      label('虚构测试姓名（以“测试”开头）',inp('displayName')),
      label('虚构测试学号（TEST- 开头）',inp('studentNumber')),
      label('补充说明（可选）',el('textarea',{name:'note',maxlength:'500'})),
      el('label',{class:'check'},privacy,'我确认仅使用虚构测试资料，理解报名会保存自填信息和内置模拟截图，仅授权工作人员可查看；本测试站尚不支持真实报名或学校实名认证。')
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
  box.append(el('div',{class:'row'},
    el('span',{class:'tag',text:reg.state==='approved'?'审核通过 · 可参加现场签到':reg.state==='pending'?'审核中 · 暂不可签到':'需补充材料 · 暂不可签到'}),
    el('span',{class:'tag '+(attendance?'green':''),text:attendance?'已签到（'+(attendance.channel==='manual'?'人工通道':'扫码')+'）':'尚未签到'})));
  const passResponse=await request('/api/events/'+event.id+'/pass-qr',{method:'POST'});
  const passSvg=await passResponse.blob();
  if(app.qr)URL.revokeObjectURL(app.qr);
  app.qr=URL.createObjectURL(passSvg);
  box.append(el('h3',{text:'我的一码通 · 报名时生成的固定二维码'}),
    el('img',{class:'qr',src:app.qr,alt:'本次活动唯一的一码通凭证，可查询报名状态并由工作人员扫码核销'}),
    el('div',{class:'row'},
      el('a',{href:app.qr,download:'花工木棉-活动一码通.svg',text:'下载并保存一码通二维码'})),
    text('整个活动都用这一个二维码：扫描可查询是否审核通过，审核通过后到场由授权工作人员核销；扫码签到后仍能查询状态。'),
    text('二维码相当于私密通行凭证，请勿转发或展示给陌生人；工作人员核销时仍需当面核实身份。'),
    text(window.BombaxAppVault?.enabled
      ? '本机 App 已尝试用 Android Keystore 加密保管本场活动。请仍截图保存二维码，清除应用数据或卸载时本机保险箱会消失。'
      : '网页版请另外截图保存一码通。换设备后选择“从照片恢复旧的一码通截图”即可向服务器验证。'));
  if(reg.reviewReason)box.append(text('审核意见：'+reg.reviewReason));
  if(attendance&&reg.state!=='approved')box.append(text('人工通道已记录到场，仍需补齐证明材料并获得审核通过。'));
  const files=await request('/api/events/'+event.id+'/materials');
  for(const f of files.materials)box.append(el('div',{class:'item'},
    text('已上传 '+f.mime+' · '+Math.ceil(f.length/1024)+' KB')));
  if(!attendance||attendance.channel==='manual'){
    box.append(el('h3',{text:'证明截图上传'}),
      text(app.syntheticOnly?'只允许使用本站内置的虚构图片。Worker 会校验文件 SHA-256；真实图片会被拒绝。':'最多三张 PNG/JPEG，每张不超过 3MB。'));
    if(app.syntheticOnly)box.append(el('img',{class:'qr',src:'/demo-proof.png',alt:'系统内置、标注 TEST ONLY 的虚构点赞截图'}));
    box.append(button('真正上传内置模拟截图至私有 R2',async()=>{
      const source=await fetch('/demo-proof.png',{credentials:'same-origin'});
      if(!source.ok)throw new Error('无法获取内置测试图片');
      const blob=await source.blob();
      await request('/api/events/'+event.id+'/upload',{method:'POST',raw:blob,headers:{'Content-Type':'image/png'}});
      notice('图片已上传到私有 R2，等待审核员处理。','success');await studentViewReload(event);
    },'secondary'));
    if(!app.syntheticOnly){
      const fileInput=el('input',{type:'file',accept:'image/png,image/jpeg'});
      box.append(fileInput,button('上传选中的真实证明材料',async()=>{
        const f=fileInput.files?.[0];if(!f)throw new Error('请选择截图');
        if(f.size>3*1024*1024)throw new Error('文件超过 3MB');
        await request('/api/events/'+event.id+'/upload',{method:'POST',raw:f,headers:{'Content-Type':f.type}});
        notice('证明材料已提交。','success');await studentViewReload(event);
      }));
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
  const duty=response.duty,queue=response.registrations;
  const roles={owner:'负责人',reviewer:'后台材料审核',scanner:'快速扫码',manual:'人工确认到场'};
  const panel=card('工作岗位：'+(roles[duty]||duty),
    text('扫码、审核和授权均由独立岗位控制；表格勾选之后必须人工确认才提交。'));
  root.append(panel);
  const totals=el('div',{class:'row'},
    el('span',{class:'tag',text:'报名 '+queue.length}),
    el('span',{class:'tag',text:'待审核 '+queue.filter(x=>x.state==='pending').length}),
    el('span',{class:'tag green',text:'已到场 '+queue.filter(x=>x.attended_at||x.attendedAt).length}));
  panel.append(totals);
  if(duty==='owner'){
    const cover=el('input',{type:'file',accept:'.svg,image/svg+xml'});
    panel.append(el('details',{class:'banner-manage'},
      el('summary',{text:'更换活动 21:9 SVG 卡通横幅'}),text('上传者必须是活动负责人。素材只支持安全 SVG 绘图，严格小于 100 KB。'),
      el('img',{class:'banner-preview',src:bannerUrl(event),alt:'当前活动横幅'}),
      label('选择新的插画文件',cover),
      button('上传并替换活动横幅',async()=>{
        const asset=cover.files?.[0];
        if(!asset)throw new Error('请选择 SVG 图片');
        await uploadEventBanner(event.id,asset);
        notice('横幅已替换；请重新打开活动查看新插画。','success');
        await start();
      })));
    const assign=form([
      label('已有主办方账号',inp('username')),
      label('人员岗位',el('select',{name:'duty'},
        el('option',{value:'reviewer',text:'后台审核'}),
        el('option',{value:'scanner',text:'扫码员'}),
        el('option',{value:'manual',text:'人工通道'})))
    ],'授权岗位',async x=>{
      await request('/api/events/'+event.id+'/staff',{method:'POST',data:x});
      notice('已更新该工作人员岗位。','success');
    });
    panel.append(el('details',{},el('summary',{text:'人员岗位授权'}),assign));
  }
  const mode=el('div',{class:'row'});
  if(duty==='owner'){
    for(const m of ['reviewer','scanner','manual'])mode.append(button(roles[m],()=>renderDuty(event,root,m,true),'secondary'));
    panel.append(mode);
  }else await renderDuty(event,root,duty,false);
  if(['owner','reviewer'].includes(duty))panel.append(button('导出已审核且已到场 CSV',async()=>{
    const response=await request('/api/events/'+event.id+'/export');
    const url=URL.createObjectURL(await response.blob()),anchor=el('a',{href:url,download:'花工木棉-活动申报名单.csv'});
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  },'secondary'));
  app.poll=setInterval(async()=>{
    if(document.visibilityState!=='visible'||app.active!==event.id)return;
    const focused=document.activeElement;
    if(focused&&['INPUT','TEXTAREA'].includes(focused.tagName))return;
    if(duty==='owner'||duty==='scanner'||duty==='reviewer')return;
    // Review spreadsheet must never auto-refresh away staged checkbox decisions.
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
  const slot=card(duty==='reviewer'?'待审核队列':duty==='scanner'?'扫码通道':'人工认证窗口');
  slot.id='duty-body';root.append(slot);
  const response=await request('/api/events/'+event.id+'/queue');
  const all=response.registrations;
  if(duty==='reviewer'){
    if(!window.BombaxReviewGrid?.render)throw new Error('批量审核表格未加载，请刷新后台');
    await window.BombaxReviewGrid.render({
      slot,rows:all,event,api:request,notify:notice,
      reload:()=>renderDuty(event,root,duty,owner)
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
      if(!window.ZXingBrowser||!window.BombaxScanner)
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
        if(!window.ZXingBrowser)throw new Error('本地识码组件没有加载');
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
  if(fragment.startsWith('#event=')||fragment.startsWith('#pass='))void safe(start);
});
safe(start);
