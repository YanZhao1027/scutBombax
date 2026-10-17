'use strict';
const $=id=>document.getElementById(id);
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
function notice(s,type=''){const n=$('notice');n.className='notice '+type;n.textContent=s;}
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
  // The QR opens this page with a private fragment: browsers never send it
  // in the HTTP request. Consume it immediately, then erase it from history.
  let restoredEventId=null;
  const fragment=location.hash;
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
  if(app.me?.role==='organizer'){
    root.append(card('工作人员已登录',el('div',{class:'row between'},el('div',{},
      el('strong',{text:app.me.displayName}),text('主办方或被授权岗位，负责创建、审核和核销活动')),
      button('退出工作人员账号',async()=>{
        await request('/api/logout',{method:'POST'});clean();app.me=null;renderAccount();home();
      },'secondary'))));
    return;
  }
  const signIn=form([
    label('主办方 / 工作人员用户名',inp('username')),
    label('工作人员密码',inp('password','password'))
  ],'工作人员登录',async x=>{
    await request('/api/login',{method:'POST',data:x});await start();
  });
  root.append(card('学生免登录',
    text('学生直接选择活动报名、上传材料及查看审核状态，无须注册账号或输入密码。'),
    text('学生报名后请保存一码通二维码；换手机可直接扫码恢复自己的报名与审核状态。二维码与本浏览器数据都丢失时，不能仅凭学号找回，需主办方现场核实。'),
    el('details',{},el('summary',{text:'主办方 / 审核员 / 扫码员登录'}),signIn)));
}
function home(){
  clean();app.active=null;
  const root=$('content');root.replaceChildren();
  if(app.me?.role==='organizer'){
    const create=form([
      label('活动标题',inp('title')),
      label('审核要求（例如集赞数量）',el('textarea',{name:'guidelines',maxlength:'1000'})),
      label('WGS84 纬度',el('input',{name:'latitude',type:'number',step:'any',required:'required'})),
      label('WGS84 经度',el('input',{name:'longitude',type:'number',step:'any',required:'required'})),
      label('定位半径（米，50–1000）',el('input',{name:'radiusM',type:'number',min:50,max:1000,step:1,value:150,required:'required'})),
      label('开始时间（按设备本地时间）',el('input',{name:'startsAt',type:'datetime-local',value:localInputTime(Date.now()-5*60000),required:'required'})),
      label('结束时间（按设备本地时间）',el('input',{name:'endsAt',type:'datetime-local',value:localInputTime(Date.now()+90*60000),required:'required'}))
    ],'创建活动',async x=>{
      const valid=validateEventInputs(x);
      await request('/api/events',{method:'POST',data:{
        title:x.title,guidelines:x.guidelines,latitude:Number(x.latitude),longitude:Number(x.longitude),
        radiusM:valid.radius,startsAt:valid.starts,endsAt:valid.ends,requirePhoto:true
      }});
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
  const list=card('活动列表');
  if(!app.events.length)list.append(text('暂时还没有活动。'));
  for(const event of app.events){
    const item=el('div',{class:'item'},el('h3',{text:event.title}),text(event.guidelines||'按主办方要求提交材料'),
      text(stamp(event.starts_at)+' 至 '+stamp(event.ends_at)),
      button(app.me?.role==='organizer'?'进入工作人员后台':'免登录报名 / 签到',
        ()=>viewEvent(event),app.me?'':'secondary'));
    list.append(item);
  }
  root.append(list);
}
async function viewEvent(event){
  clean();app.active=event.id;
  const root=$('content');root.replaceChildren();
  const head=card(event.title,button('← 返回活动列表',home,'secondary'),
    text('活动期间新报名与新上传材料仍可由后台实时审核；最终名单必须同时满足材料通过与到场。'));
  root.append(head);
  if(app.me?.role==='organizer')await organizerView(event,root);
  else await studentView(event,root);
}
async function studentView(event,root){
  const snapshot=await request('/api/events/'+event.id);
  const reg=snapshot.registration;
  const box=card('我的报名与审核状态');
  root.append(box);
  if(!reg){
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
    text('二维码相当于私密通行凭证，请勿转发或展示给陌生人；工作人员核销时仍需当面核实身份。'));
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
    text('最新状态每 5 秒刷新；如需填写审核意见，页面不会在输入期间自动重绘。'));
  root.append(panel);
  const totals=el('div',{class:'row'},
    el('span',{class:'tag',text:'报名 '+queue.length}),
    el('span',{class:'tag',text:'待审核 '+queue.filter(x=>x.state==='pending').length}),
    el('span',{class:'tag green',text:'已到场 '+queue.filter(x=>x.attended_at||x.attendedAt).length}));
  panel.append(totals);
  if(duty==='owner'){
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
    if(duty==='owner'||duty==='scanner')return; // Keep the camera stream mounted during scanning.
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
    const pending=all.filter(x=>x.state==='pending');
    slot.append(text('优先审核已经人工到场、后补截图的学生；AI 仅显示建议，不代替审核。'));
    for(const r of pending){
      const item=el('div',{class:'item'},el('h3',{text:r.display_name+'（自填学号：'+r.student_number+'）'}),
        el('span',{class:'tag',text:r.channel==='manual'?'人工已到场，待补审':'新提交待审'}),
        text('材料 '+r.material_count+' 张'));
      const photos=el('div');
      item.append(button('加载审核截图',async()=>{
        const m=await request('/api/events/'+event.id+'/materials?registrationId='+encodeURIComponent(r.id));
        photos.replaceChildren(...m.materials.map(f=>el('div',{},el('img',{class:'qr',src:'/api/materials/'+f.id,alt:'审核证明截图'}))));
      },'secondary'),photos);
      const advice=el('div');
      if(!app.syntheticOnly)item.append(button('DeepSeek V4.1 辅助初审（须获学生同意）',async()=>{
        const x=await request('/api/events/'+event.id+'/ai-review',{method:'POST',data:{registrationId:r.id}});
        advice.replaceChildren(text('AI 建议：'+x.advice.assessment+' · 可见点赞：'+(x.advice.visibleLikeCount??'不确定')),
          text('可见依据：'+x.advice.visibleEvidence),text('疑点：'+x.advice.concerns.join('；')),
          text('AI 不能验证截图真实性，必须人工确认。'));
      },'secondary'),advice);
      else item.append(text('虚构资料演练站禁用第三方 AI；请由审核员人工审核。'));
      const note=el('input',{placeholder:'审核说明/要求补充',maxlength:'300'});
      item.append(note,el('div',{class:'row'},
        button('人工审核通过',()=>review('approved')),
        button('驳回 / 补充材料',()=>review('rejected'),'danger')));
      async function review(state){
        await request('/api/events/'+event.id+'/review',{method:'POST',data:{registrationId:r.id,state,reason:note.value}});
        notice('审核结果已记录。','success');await renderDuty(event,root,duty,owner);
      }
      slot.append(item);
    }
    if(!pending.length)slot.append(text('当前没有待审核的新材料。'));
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
        item.textContent=feedback.soundEnabled?'🔔 成功铃声：开':'🔕 成功铃声：关';
        item.setAttribute('aria-checked',String(feedback.soundEnabled));
        item.setAttribute('aria-label',feedback.soundEnabled?'关闭成功核销提示音':'开启成功核销提示音');
      }
    }
    function soundSwitch(css='secondary'){
      const control=el('button',{
        type:'button',class:css,role:'switch','aria-checked':'false',
        'aria-label':'开启成功核销提示音'
      },'🔕 成功铃声：关');
      control.addEventListener('click',()=>safe(async()=>{
        const requested=!feedback.soundEnabled;
        const active=await feedback.setSound(requested);
        syncSoundControls();
        report(requested&&!active
          ? '浏览器无法开启提示音，请检查系统音量或改用文字计数'
          : active?'提示音已开启：每次成功核销响一声':'提示音已关闭：仅显示成功编号',
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
        el('p',{text:'每次成功编号加一、铃声至多响一次；失败或重复不加。继续扫描下一位的一码通。'}));
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
    slot.append(el('div',{class:'row scanner-action-row'},
        button('开启全屏摄像头扫码',openCamera),soundSwitch()),
      marker(),status,
      text('成功核销会显示新的 #001、#002… 编号；失败或重复不会加一。铃声默认关闭，开启后每次核销成功只响一声。扫码时先核对本人身份。'));
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
safe(start);
