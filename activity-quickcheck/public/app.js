'use strict';
const $=id=>document.getElementById(id), me={user:null,activities:[],scanner:null,scanControls:null,qrUrl:null};
function el(tag,props={},...children){
  const node=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(k==='class')node.className=v;
    else if(k==='text')node.textContent=v;
    else if(k==='onclick')node.addEventListener('click',v);
    else if(k==='htmlFor')node.htmlFor=v;
    else if(k==='value')node.value=v;
    else node.setAttribute(k,String(v));
  }
  for(const c of children.flat())if(c!==null&&c!==undefined)node.append(c instanceof Node?c:document.createTextNode(String(c)));
  return node;
}
const field=(label,name,type='text',value='')=>el('label',{},label,el('input',{name,type,value,required:'required',...(type==='number'?{step:'any'}:{})}));
const btn=(label,fn,kind='')=>el('button',{type:'button',class:kind,onclick:()=>action(fn)},label);
const section=(title,...children)=>el('div',{class:'card'},el('h2',{text:title}),...children);
const localDate=ms=>new Date(ms).toLocaleString('zh-CN',{hour12:false});
function announce(message,type=''){const node=$('notice');node.textContent=message;node.className='notice '+type;}
async function call(endpoint,{method='GET',data,headers={}}={}){
  const options={method,credentials:'same-origin',headers:{...headers}};
  if(method!=='GET')options.headers['X-Bombax-Action']='1';
  if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  const response=await fetch(endpoint,options);
  if(!response.ok){
    const info=await response.json().catch(()=>({error:'请求失败：HTTP '+response.status}));
    throw new Error(info.error||'请求失败：HTTP '+response.status);
  }
  if(response.headers.get('Content-Type')?.includes('application/json'))return response.json();
  return response;
}
async function action(fn){
  try{await fn();}catch(e){announce(e.message,'error');}
}
const dataFrom=form=>Object.fromEntries(new FormData(form).entries());
function formFieldsSubmit(items,label,fn){
  const form=el('form',{},...items,el('button',{type:'submit'},label));
  form.addEventListener('submit',event=>{event.preventDefault();action(async()=>{await fn(dataFrom(form));});});
  return form;
}
function stopScanner(){
  try{me.scanControls?.stop();}catch{}
  me.scanControls=null;
}
function clearQR(){
  if(me.qrUrl){URL.revokeObjectURL(me.qrUrl);me.qrUrl=null;}
}
async function refresh(){
  const profile=await call('/api/me');me.user=profile.user;
  me.activities=(await call('/api/activities')).activities;
  renderAccount();renderMain();
}
function renderAccount(){
  const area=$('account');area.replaceChildren();
  if(me.user){
    area.append(el('div',{class:'row between'},el('div',{},
      el('strong',{text:'你好，'+me.user.displayName}),
      el('div',{class:'muted',text:me.user.role==='student'?'学生账户 · 学号自填，尚未经校方认证':'活动主办方账户'})
    ),btn('退出登录',async()=>{stopScanner();clearQR();await call('/api/logout',{method:'POST'});await refresh();},'secondary')));
    return;
  }
  const login=formFieldsSubmit([
    field('用户名','username'),
    field('密码','password','password')
  ],'登录',async info=>{await call('/api/login',{method:'POST',data:info});announce('已登录','success');await refresh();});
  const register=formFieldsSubmit([
    field('登录用户名（字母/数字/下划线）','username'),
    field('姓名（自行填写）','displayName'),
    field('学号（自行填写，未校方认证）','studentId'),
    field('密码（至少 12 位）','password','password')
  ],'创建学生账户',async info=>{await call('/api/register',{method:'POST',data:info});announce('注册成功。学号尚未经过学校核实，请使用注册账号登录。','success');});
  area.append(el('h2',{text:'加入活动速签'}),el('p',{class:'muted',text:'独立账号试点，不读取微信/校园认证 Token，也不连接一卡通。'}),
    el('div',{class:'grid'},el('div',{},el('h3',{text:'登录'}),login),el('div',{},el('h3',{text:'学生注册'}),register)));
}
function renderMain(){
  stopScanner();clearOrganizerPoll();clearQR();
  const root=$('main-content');root.replaceChildren();
  if(me.user?.role==='organizer')root.append(renderCreator());
  const list=section('活动列表');
  if(!me.activities.length)list.append(el('p',{class:'muted',text:'尚无活动。主办方创建后会出现在这里。'}));
  for(const activity of me.activities)list.append(renderActivityCard(activity));
  root.append(list);
}
function renderCreator(){
  const form=formFieldsSubmit([
    field('活动名称','title'),
    el('label',{},'活动说明',el('textarea',{name:'description',maxlength:'2000'})),
    field('场地纬度（WGS84）','latitude','number'),
    field('场地经度（WGS84）','longitude','number'),
    field('允许定位半径（米，50–1000）','radiusM','number','150'),
    field('开始时间','start','datetime-local'),
    field('结束时间','end','datetime-local'),
    el('label',{},'是否要求上传附件',el('select',{name:'requireAttachment'},el('option',{value:'true',text:'需要附件'}),el('option',{value:'false',text:'无附件要求'})))
  ],'创建活动',async v=>{
    const data={...v,latitude:Number(v.latitude),longitude:Number(v.longitude),radiusM:Number(v.radiusM),
      startAt:new Date(v.start).getTime(),endAt:new Date(v.end).getTime(),requireAttachment:v.requireAttachment==='true'};
    await call('/api/activities',{method:'POST',data});announce('活动已创建','success');await refresh();
  });
  return section('创建新活动',el('p',{class:'muted',text:'测试时填写真实场地的经纬度（不是地图坐标 GCJ-02）；必须提前确认学生已同意定位用途。'}),form);
}
function renderActivityCard(a){
  const article=el('div',{class:'item'},el('h3',{text:a.title}),el('div',{class:'muted',text:a.description||'没有活动说明'}),
    el('p',{class:'muted',text:localDate(a.startAt)+' → '+localDate(a.endAt)+' · 半径 '+a.radiusM+' 米 · '+(a.requireAttachment?'需提交证明附件':'不要求附件')}));
  if(me.user?.role==='student')article.append(btn('报名 / 我的签到',()=>studentActivity(a)));
  if(me.user?.role==='organizer')article.append(btn('活动管理 / 扫码',()=>organizerActivity(a)));
  if(!me.user)article.append(el('p',{class:'muted',text:'请先登录查看报名详情。'}));
  return article;
}
async function studentActivity(a){
  stopScanner();clearOrganizerPoll();
  const current=await call('/api/activities/'+a.id);
  const root=$('main-content');root.replaceChildren();
  const panel=section(a.title,
    btn('← 返回活动列表',async()=>renderMain(),'secondary'),
    el('p',{class:'muted',text:localDate(a.startAt)+' 至 '+localDate(a.endAt)}),
    el('p',{class:'muted',text:'定位仅用于当前签到是否在场的判断；服务端不保存经纬度。'}));
  root.append(panel);
  if(!current.registration){
    panel.append(formFieldsSubmit([el('label',{},'报名备注 / 活动申请信息',el('textarea',{name:'note',maxlength:'500'}))],
      '提交报名',async data=>{await call('/api/activities/'+a.id+'/join',{method:'POST',data});announce('报名提交成功，请继续上传需要的材料','success');await studentActivity(a);}));
    return;
  }
  const reg=current.registration;
  panel.append(el('div',{class:'tally'},'审核状态：',el('strong',{text:reg.state==='pending'?'待审核':reg.state==='approved'?'已通过':'未通过'})),
    reg.reviewNote?el('div',{class:'muted',text:'审核意见：'+reg.reviewNote}):null);
  if(reg.checkedAt){panel.append(el('div',{class:'tag green',text:'已完成现场'+(reg.checkinChannel==='manual'?'人工确认':'扫码核销')+'：'+localDate(reg.checkedAt)}),
    el('p',{class:'muted',text:reg.state==='approved'?'资料已审核通过，已达到申报候选名单条件。':'请继续补充所需材料并等待审核；仅确认到场还不能进入活动票申报名单。'}));
    if(reg.state==='approved')return;}
  const at=(await call('/api/activities/'+a.id+'/my-attachments')).attachments;
  const docs=el('div',{},el('h3',{text:'证明附件'}));
  if(!at.length)docs.append(el('p',{class:'muted',text:'还没有附件'}));
  for(const f of at)docs.append(el('div',{class:'row'},el('span',{text:f.filename+' ('+Math.ceil(f.bytes/1024)+'KB)'}),
    el('a',{href:'/api/attachments/'+f.id,target:'_blank',rel:'noopener noreferrer',text:'查看'})));
  const input=el('input',{type:'file',accept:'image/png,image/jpeg,application/pdf'});
  docs.append(el('p',{class:'muted',text:'PNG/JPEG/PDF；单份不超过 3MB，最多三份；上传后需要重新审核。请避免上传无关个人信息。'}),input,
    btn('上传附件',async()=>{
      const file=input.files?.[0];if(!file)throw new Error('请选择附件');
      if(file.size>3*1024*1024)throw new Error('文件过大');
      const response=await fetch('/api/activities/'+a.id+'/upload',{method:'POST',credentials:'same-origin',
        headers:{'X-Bombax-Action':'1','X-Bombax-Filename':encodeURIComponent(file.name)},body:file});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||'上传失败');
      announce('附件上传成功；审核状态已重置为待审核','success');await studentActivity(a);
    }));
  panel.append(docs);
  if(reg.state!=='approved'||reg.checkedAt)return;
  panel.append(el('hr'),el('h3',{text:'到场定位 + 出示签到码'}),
    el('p',{class:'muted',text:'在活动时间内到达指定区域，点击下面按钮。浏览器会请求位置权限；现场二维码有效期仅 45 秒。'}));
  const qrArea=el('div',{class:'spaced'});
  panel.append(btn('检查位置并生成 45 秒二维码',async()=>{
    assertLocationEnabled();
    const pos=await geolocation();
    const data={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracyM:pos.coords.accuracy};
    const ticket=await call('/api/activities/'+a.id+'/ticket',{method:'POST',data});
    const response=await call('/api/qr',{method:'POST',data:{token:ticket.token}});
    clearQR();
    me.qrUrl=URL.createObjectURL(await response.blob());
    qrArea.replaceChildren(el('img',{class:'qrcode',src:me.qrUrl,alt:'本人本次签到二维码'}),
      el('div',{class:'muted',text:'请出示给现场工作人员 · 失效时间 '+localDate(ticket.expiresAt)}));
    announce('位置检查通过。请在二维码过期前出示给工作人员。','success');
  }),qrArea);
}
function assertLocationEnabled(){if(!navigator.geolocation)throw new Error('设备不支持定位');}
function geolocation(){
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,
    ()=>reject(new Error('无法获得位置：请允许定位、到室外重试或向主办方申请人工复核')),
    {enableHighAccuracy:true,timeout:13000,maximumAge:0}));
}
async function organizerActivity(a){
  stopScanner();clearOrganizerPoll();
  const root=$('main-content');root.replaceChildren();
  const pane=section(a.title,btn('← 返回活动列表',async()=>renderMain(),'secondary'),
    el('p',{class:'muted',text:'活动当天实行后台持续审核、3–4 个扫码窗口，以及一条线下人工认证通道。'}));
  root.append(pane);
  const {duty}=await call('/api/activities/'+a.id+'/registrations');
  const dutyLabels={owner:'活动负责人',reviewer:'后台材料审核员',scanner:'扫码核验员',manual:'人工身份核验员'};
  pane.append(el('div',{class:'tag',text:'当前岗位：'+(dutyLabels[duty]||duty)}));
  const counters=el('div',{class:'tally'});pane.append(counters);
  if(duty==='owner'){
    const staffForm=formFieldsSubmit([
      field('工作人员账号','username'),
      el('label',{},'现场岗位',el('select',{name:'duty'},
        el('option',{value:'reviewer',text:'后台审核'}),
        el('option',{value:'scanner',text:'快速扫码'}),
        el('option',{value:'manual',text:'线下人工认证'})))
    ],'设置岗位',async data=>{
      await call('/api/activities/'+a.id+'/staff',{method:'POST',data});
      announce('工作人员岗位已更新','success');
    });
    pane.append(el('details',{},el('summary',{text:'为工作人员授权 / 调整岗位'}),staffForm));
  }
  if(['owner','reviewer'].includes(duty)){
    pane.append(btn('导出审核通过且已到场名单',async()=>{
      const response=await call('/api/activities/'+a.id+'/export');
      const blob=await response.blob(),href=URL.createObjectURL(blob);
      const link=el('a',{href,download:'花工木棉-活动签到名单.csv'});
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),1500);
      announce('已导出审核通过且现场到场的学生；请按校方模板核实后再提交。','success');
    }));
  }
  const area=section(duty==='manual'?'线下人工核验':duty==='scanner'?'扫码快速窗口':'实时材料审核队列');
  root.append(area);
  let refreshing=false;
  let renderCount=0;
  let noFresh=false;
  async function load(initial=false){
    if(refreshing)return;
    refreshing=true;
    try {
      const {registrations,duty:liveDuty}=await call('/api/activities/'+a.id+'/registrations');
      if(liveDuty!==duty){noFresh=true;stopScanner();clearOrganizerPoll();announce('岗位权限已更改，请重新打开活动页面','error');return;}
      const approved=registrations.filter(x=>x.state==='approved').length;
      const checked=registrations.filter(x=>x.checked_at).length;
      const wait=registrations.filter(x=>x.state==='pending').length;
      counters.textContent='报名 '+registrations.length+' 人 · 审核通过 '+approved+' · 待审核 '+wait+' · 已到场 '+checked+' · 待补审到场 '+registrations.filter(x=>x.checked_at&&x.state!=='approved').length;
      if(duty==='scanner'){
        if(initial)setupScanner(area,a);
        return;
      }
      const active=document.activeElement;
      if(!initial&&active&&area.contains(active)&&['INPUT','TEXTAREA'].includes(active.tagName))return;
      renderCount++;
      area.replaceChildren(el('h3',{text:duty==='manual'?'现场身份人工确认': '报名材料持续审核 · 自动刷新'}));
      const last=el('p',{class:'muted',text:'最近更新：'+new Date().toLocaleTimeString('zh-CN',{hour12:false})+' · 每 5 秒刷新'});area.append(last);
      if(duty==='manual')renderManualQueue(area,registrations,a,load);
      else renderReviewQueue(area,registrations,a,load);
    }catch(err){if(initial)throw err;announce('刷新失败：'+err.message,'error');}
    finally{refreshing=false;}
  }
  await load(true);
  if(duty!=='scanner')me.organizerPoll=setInterval(()=>{if(!noFresh&&document.visibilityState==='visible'&&root.isConnected)load();},5000);
}
function clearOrganizerPoll(){if(me.organizerPoll){clearInterval(me.organizerPoll);me.organizerPoll=null;}}
function renderReviewQueue(area,rows,a,refresh){
  const pending=rows.filter(r=>r.state==='pending');
  const attendedPending=pending.filter(r=>r.channel==='manual');
  const normalPending=pending.filter(r=>r.channel!=='manual');
  area.append(el('div',{class:'row'},
    el('span',{class:'tag orange',text:'待审核 '+pending.length}),
    el('span',{class:'tag',text:'人工已到场待补审 '+attendedPending.length}),
    btn('立即刷新',()=>refresh(true),'secondary')));
  if(!pending.length)area.append(el('p',{class:'muted',text:'目前没有待审核的申请。审核员可以继续等待现场新报名或新附件。'}));
  for(const r of [...attendedPending,...normalPending])area.append(reviewCard(r,a,refresh));
  const resolved=rows.filter(r=>r.state!=='pending');
  if(resolved.length){
    const details=el('details',{},el('summary',{text:'查看已处理申请（'+resolved.length+'）'}));
    for(const r of resolved)details.append(reviewCard(r,a,refresh));
    area.append(details);
  }
}
function reviewCard(r,a,refresh){
  const item=el('div',{class:'item'},
    el('div',{class:'row between'},el('strong',{text:r.display_name||'学生'}),el('span',{class:'tag',text:r.state==='approved'?'已通过':r.state==='rejected'?'已驳回':'待审核'})),
    el('p',{class:'muted',text:'自填学号（非官方认证）：'+(r.student_id||'未知')+' · 附件 '+r.attachment_count+' 份 · 最新提交 '+localDate(r.updated_at||r.created_at)}),
    el('p',{class:'muted',text:'备注：'+(r.note||'无')}));
  if(r.channel==='manual')item.append(el('p',{class:'tag green',text:'已人工核验到场；待审核通过后进入申报名单'}));
  else if(r.checked_at)item.append(el('p',{class:'tag green',text:'已完成快速扫码核销'}));
  const links=el('div',{class:'spaced'});
  item.append(btn('查看证明附件',async()=>{
    const {attachments}=await call('/api/registrations/'+r.id+'/attachments');
    links.replaceChildren(...attachments.map(f=>el('div',{},el('a',{href:'/api/attachments/'+f.id,target:'_blank',rel:'noopener noreferrer',text:f.filename}))));
    if(!attachments.length)links.append(el('p',{class:'muted',text:'该报名尚无证明材料'}));
  },'secondary'),links);
  if(r.channel!=='scan'){
    const note=el('input',{placeholder:'审核备注 / 补充材料要求（可选）',maxlength:'300'});
    item.append(el('div',{class:'row spaced'},note,
      btn('审核通过',async()=>{
        await call('/api/activities/'+a.id+'/review',{method:'POST',data:{registrationId:r.id,state:'approved',note:note.value}});
        await refresh(true);
      }),
      btn('驳回或要求补充',async()=>{
        await call('/api/activities/'+a.id+'/review',{method:'POST',data:{registrationId:r.id,state:'rejected',note:note.value}});
        await refresh(true);
      },'danger')));
  }
  return item;
}
function renderManualQueue(area,rows,a,refresh){
  area.append(el('p',{class:'muted',text:'仅登记已当面出示身份凭据、由工作人员亲眼确认到场的报名学生。人工通道不代替集赞资料审核，也不需要扫描学校支付/校园码。'}));
  area.append(btn('立即刷新候选列表',()=>refresh(true),'secondary'));
  const outstanding=rows.filter(r=>!r.checked_at);
  const search=el('input',{placeholder:'按姓名或自填学号筛选现场学生',autocomplete:'off'});
  const list=el('div');area.append(search,list);
  function draw(){
    list.replaceChildren();
    const term=search.value.trim().toLowerCase();
    const found=outstanding.filter(r=>(r.display_name||'').toLowerCase().includes(term)||(r.student_id||'').toLowerCase().includes(term)).slice(0,80);
    if(!found.length)list.append(el('p',{class:'muted',text:'没有匹配且尚未确认到场的报名记录。学生需要先完成报名。'}));
    for(const r of found){
      const item=el('div',{class:'item'},
        el('strong',{text:r.display_name||'学生'}),
        el('p',{class:'muted',text:'自填学号：'+r.student_id+' · 材料 '+(r.state==='approved'?'已通过':r.state==='pending'?'待审核':'需补充')}));
      const reason=el('input',{placeholder:'例：室内定位漂移 / 现场补审（必填）',maxlength:'250'});
      const confirm=el('input',{type:'checkbox'});
      const label=el('label',{},confirm,'我已在现场当面核对参与者身份（未经学校官方校验）');
      item.append(reason,label,btn('记录人工到场',async()=>{
        if(!confirm.checked)throw new Error('请先确认已现场核对身份');
        if(!reason.value.trim())throw new Error('需要填写人工通道原因');
        await call('/api/activities/'+a.id+'/manual-checkin',{method:'POST',
          data:{registrationId:r.id,reason:reason.value.trim(),identityChecked:true}});
        announce('人工到场记录成功。未审核的材料仍须后台审核才能纳入最终名单。','success');
        await refresh(true);
      }));
      list.append(item);
    }
  }
  search.addEventListener('input',draw);draw();
}
function setupScanner(area,a){
  area.append(el('p',{class:'muted',text:'只接受花工木棉短时动态码；请勿扫描学校的支付二维码。审核员和人工通道会独立处理晚到报名。'}));
  const video=el('video',{autoplay:'autoplay',muted:'muted',playsinline:'playsinline'});
  const result=el('div',{class:'scan-result',role:'status',text:'等待扫码…'});
  const manual=el('input',{placeholder:'摄像头不可用时输入花工木棉签到码',autocomplete:'off'});
  let busy=false;
  async function redeem(token){
    if(busy)return;
    busy=true;
    try{
      await call('/api/activities/'+a.id+'/redeem',{method:'POST',data:{token}});
      result.textContent='✓ 核销成功，请下一位';result.style.color='#16884e';manual.value='';
    }catch(e){result.textContent='核销失败：'+e.message;result.style.color='#ae4b16';}
    finally{setTimeout(()=>{busy=false;},500);}
  }
  area.append(row(btn('开启摄像头',async()=>{
    if(!window.ZXingBrowser)throw new Error('扫码依赖尚未加载');
    stopScanner();
    area.append(video);
    const reader=new window.ZXingBrowser.BrowserQRCodeReader();
    me.scanner=reader;
    me.scanControls=await reader.decodeFromVideoDevice(undefined,video,x=>{if(x?.getText)action(()=>redeem(x.getText()));});
  }),btn('停止扫描',async()=>stopScanner(),'secondary')),result,row(manual,btn('手动核销动态码',()=>redeem(manual.value))));
}

refresh().catch(error=>announce('初始化失败：'+error.message,'error'));
