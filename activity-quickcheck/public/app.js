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
  stopScanner();clearQR();
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
  if(reg.checkedAt){panel.append(el('div',{class:'tag green',text:'签到已完成：'+localDate(reg.checkedAt)}));return;}
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
  if(reg.state!=='approved')return;
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
  const root=$('main-content');root.replaceChildren();
  const pane=section(a.title,btn('← 返回活动列表',async()=>renderMain(),'secondary'),
    el('p',{class:'muted',text:'现场三通道可同时使用独立主办方账号扫码；同一报名只允许核销一次。'}));
  root.append(pane);
  const area=el('div',{class:'card'});root.append(area);
  const info=await call('/api/activities/'+a.id+'/registrations');
  const all=info.registrations;
  const accepted=all.filter(x=>x.state==='approved'),checked=all.filter(x=>x.checked_at);
  pane.append(el('div',{class:'tally'},el('strong',{text:'报名 '+all.length+' · 审核通过 '+accepted.length+' · 已签到 '+checked.length})),
    el('div',{class:'row'},btn('刷新统计',()=>organizerActivity(a),'secondary'),
      btn('导出已审核且已签到名单',async()=>{
        const r=await call('/api/activities/'+a.id+'/export');
        const blob=await r.blob(),href=URL.createObjectURL(blob);
        const link=el('a',{href,download:'花工木棉-活动签到名单.csv'});
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),1500);
        announce('仅已审核且已签到的数据已导出；提交学校前请核对官方模板。','success');
      })));
  const staffForm=formFieldsSubmit([field('添加现有主办方账号作为核验员','username')],'授权核验员',async data=>{
    await call('/api/activities/'+a.id+'/staff',{method:'POST',data});announce('核验员已授权','success');
  });
  const members=el('details',{},el('summary',{text:'添加扫码核验员（仅活动创建者）'}),staffForm);
  pane.append(members);
  const scanBox=el('div',{},el('h3',{text:'快速扫码窗口'}),
    el('p',{class:'muted',text:'扫码只核销花工木棉生成的本次活动码；不要扫描学校校园码或支付二维码。'}));
  const video=el('video',{id:'scanner-video',autoplay:'autoplay',muted:'muted',playsinline:'playsinline'});
  const scanResult=el('div',{class:'scan-result',role:'status',text:'等待扫码…'});
  const manual=el('input',{placeholder:'手动输入签到码（摄像头不可用时）',type:'text',autocomplete:'off'});
  let working=false;
  async function redeem(token){
    if(working)return;
    working=true;
    try{
      await call('/api/activities/'+a.id+'/redeem',{method:'POST',data:{token}});
      scanResult.textContent='✓ 核销成功，下一位';scanResult.style.color='#16884e';
      manual.value='';announce('该活动签到核销成功','success');
    }catch(e){scanResult.textContent='核销失败：'+e.message;scanResult.style.color='#ac5517';}
    finally{setTimeout(()=>{working=false;},350);}
  }
  scanBox.append(el('div',{class:'row'},btn('开启摄像头扫描',async()=>{
    if(!window.ZXingBrowser)throw new Error('扫码库尚未加载');
    stopScanner();
    scanBox.append(video);
    const reader=new window.ZXingBrowser.BrowserQRCodeReader();
    me.scanner=reader;
    me.scanControls=await reader.decodeFromVideoDevice(undefined,video,(result)=>{
      if(result?.getText)action(()=>redeem(result.getText()));
    });
  }),btn('停止扫描',async()=>stopScanner(),'secondary')),
    scanResult,el('div',{class:'spaced row'},manual,btn('手动核销',()=>redeem(manual.value))),el('hr'));
  area.append(scanBox,el('h3',{text:'报名与材料审核'}));
  if(!all.length)area.append(el('p',{class:'muted',text:'暂时没有报名。'}));
  for(const r of all){
    const item=el('div',{class:'item'},
      el('div',{class:'row between'},el('strong',{text:r.display_name}),el('span',{class:'tag',text:r.state==='approved'?'通过':r.state==='rejected'?'驳回':'待审核'})),
      el('p',{class:'muted',text:'学号（自填/未校方认证）：'+r.student_id+' · 附件 '+r.attachment_count+' 份'+(r.checked_at?' · 签到 '+localDate(r.checked_at):'')}),
      el('p',{class:'muted',text:'报名备注：'+(r.note||'无')}));
    const list=el('div',{class:'spaced'});
    item.append(btn('查看附件',async()=>{
      const {attachments}=await call('/api/registrations/'+r.id+'/attachments');
      list.replaceChildren(...attachments.map(file=>el('div',{},el('a',{href:'/api/attachments/'+file.id,target:'_blank',rel:'noopener noreferrer',text:file.filename}))));
    },'secondary'),list);
    if(!r.checked_at){
      const note=el('input',{placeholder:'审核意见（可选）',maxlength:'300'});
      item.append(el('div',{class:'row spaced'},note,
        btn('审核通过',async()=>{await call('/api/activities/'+a.id+'/review',{method:'POST',data:{registrationId:r.id,state:'approved',note:note.value}});await organizerActivity(a);},''),
        btn('驳回 / 补充',async()=>{await call('/api/activities/'+a.id+'/review',{method:'POST',data:{registrationId:r.id,state:'rejected',note:note.value}});await organizerActivity(a);},'danger')));
    }
    area.append(item);
  }
}
refresh().catch(error=>announce('初始化失败：'+error.message,'error'));
