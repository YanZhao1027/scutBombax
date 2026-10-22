'use strict';
const $=id=>document.getElementById(id);
const app={me:null,events:[],active:null,poll:null,scanner:null,scannerOverlay:null,scannerVideo:null,scannerEpoch:0,scannerHistory:false,scannerFullscreenEntered:false,scannerPreviousFocus:null,qr:null,manualCleanup:null,syntheticOnly:false};
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
    return '位置权限被拒绝。请在系统设置 → Via 浏览器 → 位置信息中允许定位，再检查浏览器的网站权限。'+fallback;
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
  app.manualCleanup?.();app.manualCleanup=null;
  if(app.poll){clearInterval(app.poll);app.poll=null;}
  try{app.scanner?.stop();}catch{}app.scanner=null;
  if(app.qr){URL.revokeObjectURL(app.qr);app.qr=null;}
}
async function start(){
  const me=await request('/api/me');app.me=me.user;
  const ready=await request('/api/health');app.syntheticOnly=Boolean(ready.syntheticOnly);
  if(!ready.ready){notice('生产 API 尚未开放。请使用公开演示站；不要填写真实学生资料。','error');$('account').replaceChildren();$('content').replaceChildren(
    card('正在安全验收',text('此环境目前禁用真实报名、附件和 DeepSeek 处理。'),
      el('a',{href:'https://activity-demo.10273055.xyz/',text:'打开无个人信息的交互演示'})));
    return;
  }
  app.events=(await request('/api/events')).events;
  renderAccount();home();
  notice('活动速签已连接；请按提示确认资料用途。');
}
function renderAccount(){
  const root=$('account');root.replaceChildren();
  if(app.me){
    root.append(card('我的账号',el('div',{class:'row between'},el('div',{},
      el('strong',{text:app.me.displayName}),text(app.me.role==='student'?'学号自行填写（未官方认证）':'主办方账户')),
      button('退出登录',async()=>{
        await request('/api/logout',{method:'POST'});clean();app.me=null;renderAccount();home();
      },'secondary'))));
    return;
  }
  const signIn=form([label('用户名',inp('username')),label('测试密码统一 12341234',inp('password','password','12341234'))],'登录',
    async x=>{await request('/api/login',{method:'POST',data:x});await start();});
  const privacy=el('input',{type:'checkbox',name:'privacyAcknowledged',value:'yes'});
  const signUp=form([
    label('注册用户名',inp('username')),
    label('姓名（目前无法独立验证）',inp('displayName')),
    label('学号（自行填写）',inp('studentNumber')),
    label('测试密码统一 12341234',inp('password','password','12341234')),
    el('label',{class:'check'},privacy,'我知悉活动报名会保存自填身份与证明材料，只有授权人员可以查看；正式部署前须公示数据保留及删除办法。')
  ],'注册学生账号',async x=>{
    if(!privacy.checked)throw new Error('须先确认了解个人信息处理规则');
    await request('/api/register',{method:'POST',data:{...x,privacyAcknowledged:true}});
    notice('学生账户已创建，请登录。所填学号尚未经学校认证。','success');
  });
  root.append(card('登录与学生注册',text('此站仅使用虚构资料；所有测试账号密码均为 12341234。'),
    el('div',{class:'grid'},el('div',{},el('h3',{text:'登录'}),signIn),
      el('div',{},el('h3',{text:'学生注册'}),signUp))));
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
      notice('已根据 GPS 填入测试活动中心。手机需在此区域才能领取签到码。','success');
    },'secondary');
    const fillTrialTime=button('一键设置：开始前 5 分钟，结束后 90 分钟',async()=>{
      create.elements.namedItem('startsAt').value=localInputTime(Date.now()-5*60000);
      create.elements.namedItem('endsAt').value=localInputTime(Date.now()+90*60000);
      create.elements.namedItem('radiusM').value='150';
      notice('已填入合法的演练时间和 150 米半径（以本设备时间为准）。','success');
    },'secondary');
    root.append(card('主办方：创建活动',
      text('请在现场点击 GPS 获取活动中心。半径 50–1000 米；开始须早于结束；活动不超过 7 天；结束时间必须在未来。'),
      el('details',{},el('summary',{text:'展开创建表单'}),
        el('div',{class:'row'},useGps,fillTrialTime),
        text('当前设备时区：'+(Intl.DateTimeFormat().resolvedOptions().timeZone||'本地')+'。时间已预填，可直接创建 90 分钟模拟活动。'),
        create)));
  }
  const list=card('活动列表');
  if(!app.events.length)list.append(text('暂时还没有活动。'));
  for(const event of app.events){
    const item=el('div',{class:'item'},el('h3',{text:event.title}),text(event.guidelines||'按主办方要求提交材料'),
      text(stamp(event.starts_at)+' 至 '+stamp(event.ends_at)),
      button(app.me?.role==='organizer'?'进入工作台':app.me?.role==='student'?'报名 / 签到':'请先登录',
        ()=>viewEvent(event),app.me?'':'secondary'));
    list.append(item);
  }
  root.append(list);
}
async function viewEvent(event){
  if(!app.me)throw new Error('请先登录');
  clean();app.active=event.id;
  const root=$('content');root.replaceChildren();
  const head=card(event.title,button('← 返回活动列表',home,'secondary'),
    text('活动期间新报名与新上传材料仍可由后台实时审核；最终名单必须同时满足材料通过与到场。'));
  root.append(head);
  if(app.me.role==='student')await studentView(event,root);
  else await organizerView(event,root);
}
async function studentView(event,root){
  const snapshot=await request('/api/events/'+event.id);
  const reg=snapshot.registration;
  const box=card('我的报名与审核状态');
  root.append(box);
  if(!reg){
    const consent=el('input',{type:'checkbox',name:'aiConsent',value:'yes'});
    const join=form([
      label('补充说明',el('textarea',{name:'note',maxlength:'500'})),
      el('label',{class:'check'},consent,'可选：我同意在审核员主动请求时，将本活动证明截图发送至 DeepSeek V4.1 Flash 辅助阅读；不同意也可人工审核。')
    ],'提交报名',async v=>{
      await request('/api/events/'+event.id+'/join',{method:'POST',data:{note:v.note,aiConsent:consent.checked}});
      notice('报名成功；可在活动现场继续上传集赞截图。','success');await studentViewReload(event);
    });
    box.append(join);return;
  }
  const attendance=reg.attendance;
    box.append(el('div',{class:'item student-recovery'},
      el('strong',{text:'人工核验编号：'+(reg.recoveryCode||'待刷新')}),
      text('仅在扫码失败时向授权人工窗口出示。本编号不能代替身份核验，也不能直接签到。')));
  box.append(el('div',{class:'row'},
    el('span',{class:'tag',text:reg.state==='approved'?'材料通过':reg.state==='pending'?'待审核':'待补充材料'}),
    el('span',{class:'tag '+(attendance?'green':''),text:attendance?'已到场（'+(attendance.channel==='manual'?'人工通道':'扫码')+'）':'尚未到场'})));
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
    const qrArea=el('div');
    box.append(el('hr'),el('h3',{text:'快速现场签到'}),
      text('资料通过后，抵达现场并授权定位，即可生成 45 秒有效二维码。'),
      button('现场定位并生成二维码',async()=>{
        const pos=await requestPhoneLocation(true);
        if(!Number.isFinite(pos.coords.accuracy)||pos.coords.accuracy>120)
          throw new Error('当前定位精度不足（约 '+Math.round(pos.coords.accuracy||0)+' 米）。请移至开阔区域重试或走人工通道。');
        const ticket=await request('/api/events/'+event.id+'/ticket',{method:'POST',data:{
          latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracyM:pos.coords.accuracy
        }});
        const response=await request('/api/qr',{method:'POST',data:{token:ticket.token}});
        const svg=await response.blob();
        if(app.qr)URL.revokeObjectURL(app.qr);
        app.qr=URL.createObjectURL(svg);
        qrArea.replaceChildren(el('img',{class:'qr',src:app.qr,alt:'本次活动临时签到二维码'}),
          text('请在 '+stamp(ticket.expiresAt)+' 前出示给工作人员；用过即失效。'),
          el('div',{class:'item'},el('strong',{text:'二维码异常备用编号：'+(reg.recoveryCode||'待刷新')}),
            text('此编号不包含姓名学号，只有授权人工窗口可以按原因调取报名信息。')));
        notice('定位符合要求，请出示二维码。','success');
      }),qrArea);
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
  if(duty==='owner')panel.append(button('导出已审核且已到场 CSV（仅负责人）',async()=>{
    const response=await request('/api/events/'+event.id+'/export');
    const url=URL.createObjectURL(await response.blob()),anchor=el('a',{href:url,download:'花工木棉-活动申报名单.csv'});
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  },'secondary'));
  app.poll=setInterval(async()=>{
    if(document.visibilityState!=='visible'||app.active!==event.id)return;
    const focused=document.activeElement;
    if(focused&&['INPUT','TEXTAREA'].includes(focused.tagName))return;
    if(['owner','scanner','manual'].includes(duty))return; // Never redraw an ongoing manual exception or camera stream.
    await safe(()=>renderDuty(event,root,duty,false));
  },5000);
}
async function renderDuty(event,root,duty,owner){
  app.manualCleanup?.();app.manualCleanup=null;
  const old=$('duty-body');if(old?.dataset.duty==='scanner')cleanScanner();if(old)old.remove();
  const slot=card(duty==='reviewer'?'待审核队列':duty==='scanner'?'扫码通道':'人工认证窗口');
  slot.id='duty-body';root.append(slot);
  const response=await request('/api/events/'+event.id+'/queue');
  const all=response.registrations;
  if(duty==='reviewer'){
    const pending=all.filter(x=>x.state==='pending');
    slot.append(text('优先审核已经人工到场、后补截图的学生；AI 仅显示建议，不代替审核。'));
    for(const r of pending){
      const item=el('div',{class:'item'},el('h3',{text:'匿名报名 · '+r.id.slice(0,8).toUpperCase()}),
        el('span',{class:'tag',text:r.channel==='manual'?'人工已到场，待补审':'新提交待审'}),
        text('材料 '+r.material_count+' 张'));
      const photos=el('div');
      item.append(button('加载审核截图',async()=>{
        const m=await request('/api/events/'+event.id+'/materials?registrationId='+encodeURIComponent(r.id));
        photos.replaceChildren(...m.materials.map(f=>el('div',{},el('img',{class:'qr',src:'/api/materials/'+f.id,alt:'审核证明截图'}))));
      },'secondary'),photos);
      const advice=el('div');
      item.append(button('DeepSeek V4.1 辅助初审（须获学生同意）',async()=>{
        const x=await request('/api/events/'+event.id+'/ai-review',{method:'POST',data:{registrationId:r.id}});
        advice.replaceChildren(text('AI 建议：'+x.advice.assessment+' · 可见点赞：'+(x.advice.visibleLikeCount??'不确定')),
          text('可见依据：'+x.advice.visibleEvidence),text('疑点：'+x.advice.concerns.join('；')),
          text('AI 不能验证截图真实性，必须人工确认。'));
      },'secondary'),advice);
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
    slot.classList.add('manual-lane');
    const intro=el('div',{class:'manual-intro'},
      el('strong',{text:'特殊情况 · 人工核验'}),
      el('p',{text:'日常匿名签到。只有学生本人在场并主动求助，才允许按单条二维码或备用编号调取身份。所有查询均会留下审计记录。'}));
    const progress=el('div',{class:'manual-steps','aria-label':'人工核验操作步骤'},
      el('span',{class:'manual-step current',text:'① 查找线索'}),
      el('span',{class:'manual-step',text:'② 当面核对'}),
      el('span',{class:'manual-step',text:'③ 记录到场'}));
    const reference=el('input',{type:'text',maxlength:90,autocomplete:'off',
      autocorrect:'off',autocapitalize:'off',spellcheck:'false',
      placeholder:'BM-XXXX-XXXX-XXXX',
      'aria-label':'学生主动出示的备用编号或二维码原始码值'});
    const reason=el('select',{'aria-label':'人工核验原因'},
      el('option',{value:'',text:'请选择实际异常原因'}),
      el('option',{value:'unreadable_qr',text:'二维码模糊 / 无法识别'}),
      el('option',{value:'expired_qr',text:'二维码已过期或已使用'}),
      el('option',{value:'camera_failure',text:'摄像头故障 / 权限异常'}),
      el('option',{value:'network_issue',text:'现场网络异常'}),
      el('option',{value:'other',text:'其他特殊情况'}));
    const explanation=el('textarea',{maxlength:250,rows:'3',
      placeholder:'例：二维码多次扫描不成功，学生本人已到场并请求人工协助'});
    const studentPresent=el('input',{type:'checkbox'});
    const details=el('div',{'data-manual-disclosure':'','aria-live':'polite'});
    let expireTimer=null,inFlight=false,sequence=0,visibleUntil=0;
    function resetSteps(){
      progress.querySelectorAll('.manual-step').forEach((node,i)=>{
        node.className='manual-step'+(i===0?' current':'');
      });
    }
    function clearDisclosure(showMessage=false){
      if(expireTimer!==null){clearTimeout(expireTimer);expireTimer=null;}
      visibleUntil=0;
      details.replaceChildren();
      if(showMessage)details.append(el('p',{class:'manual-result-status',
        text:'身份资料已自动隐藏。再次处理前，请重新确认学生在场并发起审计查询。'}));
      resetSteps();
    }
    const onHide=()=>{if(document.hidden)clearDisclosure(true);};
    document.addEventListener('visibilitychange',onHide);
    app.manualCleanup=()=>{
      sequence++;
      clearDisclosure(false);
      document.removeEventListener('visibilitychange',onHide);
    };
    const query=button('查询一条异常报名记录',async()=>{
      if(inFlight)return;
      const run=++sequence;
      clearDisclosure(false);
      if(!studentPresent.checked)throw new Error('请先确认学生本人在现场主动请求协助');
      if(!reason.value)throw new Error('请选择本次异常原因');
      if(explanation.value.trim().length<8)throw new Error('请填写至少 8 字的现场问题说明');
      if(!reference.value.trim())throw new Error('请填写学生出示的备用编号或二维码');
      inFlight=true;query.disabled=true;query.textContent='安全查询中…';
      try{
        const lookup=await request('/api/events/'+event.id+'/assist-lookup',{method:'POST',
          data:{reference:reference.value.trim(),reasonCode:reason.value,
            reasonNote:explanation.value.trim(),studentPresent:true}});
        if(run!==sequence||!slot.isConnected||document.hidden)return;
        reference.value=''; // Never leave the complete QR bearer token in a field.
        const r=lookup.registration;
        visibleUntil=Date.now()+60_000;
        const identity=el('dl',{class:'manual-identity'},
          el('div',{},el('dt',{text:'本人自填姓名'}),el('dd',{text:r.displayName})),
          el('div',{},el('dt',{text:'本人自填学号'}),el('dd',{text:r.studentNumber})),
          el('div',{},el('dt',{text:'材料状态'}),el('dd',{text:r.state==='approved'?'审核通过':r.state==='pending'?'待审核':'待补充材料'})),
          el('div',{},el('dt',{text:'到场情况'}),el('dd',{text:r.attendance?'已经到场，不得重复登记':'尚无到场记录'})));
        const privateCard=el('section',{class:'manual-private','data-sensitive-lookup':'','aria-label':'本次异常核对信息'},
          el('div',{class:'manual-disclosure',text:'限本次面对面核对使用 · 60 秒后自动隐藏 · 自填学号并非学校实名认证'}),
          el('h3',{text:'核对学生提供的独立身份证明'}),identity);
        const actions=el('div',{class:'manual-actions'});
        const dismiss=button('隐藏身份资料',()=>{sequence++;clearDisclosure(true);},'secondary');
        actions.append(dismiss);
        if(!r.attendance){
          const confirmed=el('input',{type:'checkbox'});
          privateCard.append(el('label',{class:'manual-checkbox'},confirmed,
            '已当面核对学生提供的独立身份证明；本编号本身不是身份凭据'));
          const record=button('确认登记人工到场',async()=>{
            if(inFlight||run!==sequence||Date.now()>=visibleUntil)
              throw new Error('本次核验已过期，请重新查询');
            if(!confirmed.checked)throw new Error('必须实际完成面对面身份核对');
            inFlight=true;record.disabled=true;record.textContent='正在登记…';
            try{
              await request('/api/events/'+event.id+'/manual-checkin',{method:'POST',
                data:{registrationId:r.id,reason:explanation.value.trim(),identityChecked:true}});
              if(run!==sequence)return;
              sequence++;clearDisclosure(false);
              reference.value='';reason.value='';explanation.value='';studentPresent.checked=false;
              details.append(el('div',{class:'manual-complete',role:'status'},
                el('strong',{text:'✓ 到场登记完成'}),
                el('p',{text:'本次身份资料已清除。材料审核仍独立进行，可继续协助下一位学生。'})));
              notice('人工到场记录已保存，学生身份已从页面隐藏。','success');
            }finally{
              inFlight=false;record.disabled=false;record.textContent='确认登记人工到场';
            }
          });
          actions.prepend(record);
        }else{
          privateCard.append(el('p',{class:'manual-result-status',
            text:'该学生已有到场记录，不能再次核销。请核对记录并告知学生。'}));
        }
        privateCard.append(actions);
        details.replaceChildren(privateCard);
        progress.querySelectorAll('.manual-step').forEach((node,i)=>{
          node.className='manual-step'+(i===1?' current':i===0?' done':'');
        });
        expireTimer=setTimeout(()=>{sequence++;clearDisclosure(true);},60_000);
        privateCard.scrollIntoView({behavior:'smooth',block:'nearest'});
      }finally{
        inFlight=false;query.disabled=false;query.textContent='查询一条异常报名记录';
      }
    },'manual-action');
    slot.append(intro,progress,el('div',{class:'manual-panel'},
      label('学生出示的线索',reference),
      el('p',{class:'manual-field-hint',
        text:'支持 BM-XXXX-XXXX-XXXX，也可粘贴已解出的完整 bqx_ 动态二维码。不能按姓名批量搜索。'}),
      label('失败原因',reason),
      label('现场处理说明',explanation),
      el('label',{class:'manual-checkbox'},studentPresent,
        '确认学生本人在场，且主动请求人工协助'),
      query,el('p',{class:'manual-privacy-note',
        text:'读取个人信息前由服务器验证岗位并记审计；未完成独立身份核验时，禁止直接登记。'})),
      details);
    // Go straight to the active station on a phone; account/header cards stay above.
    requestAnimationFrame(()=>{if(slot.isConnected)slot.scrollIntoView({behavior:'smooth',block:'start'});});
  }else if(duty==='scanner'){
    slot.dataset.duty='scanner';
    slot.append(text('扫码员不接触姓名和学号；仅识别花工木棉签到二维码。无法核销时请学生出示备用编号，前往独立的授权人工窗口。学校校园认证码和支付码无效。'));
    const status=el('div',{class:'status',role:'status','aria-live':'polite',text:'摄像头尚未开启。'});
    const token=el('input',{type:'text',placeholder:'备用：粘贴完整 bqx_ 签到码',maxlength:68,
      autocomplete:'off',autocapitalize:'off',spellcheck:'false','aria-label':'完整花工木棉签到码'});
    let scanning=false,lastAccepted='',lastAttempt='',lastAttemptAt=0;
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
    async function redeem(value){
      const checkin=String(value||'').trim();
      if(scanning||checkin===lastAccepted)return;
      if(!window.BombaxScanner?.validToken(checkin)){
        if(lastAttempt!==checkin||Date.now()-lastAttemptAt>2000)
          report('不是花工木棉签到码；请勿扫描学校支付或认证二维码。','error');
        lastAttempt=checkin;lastAttemptAt=Date.now();
        return;
      }
      // A continuously visible already-redeemed/expired QR must not cause
      // repeated requests against the high-throughput onsite check-in API.
      if(checkin===lastAttempt&&Date.now()-lastAttemptAt<3000)return;
      lastAttempt=checkin;lastAttemptAt=Date.now();
      scanning=true;
      try{
        await request('/api/events/'+event.id+'/redeem',{method:'POST',data:{token:checkin}});
        lastAccepted=checkin;
        report('✓ 核销成功 · 请下一位','ok');
        token.value='';
        try{navigator.vibrate?.(75);}catch{}
      }catch(e){
        report('核销失败：'+e.message+'。请让学生去人工窗口出示备用编号。','error');
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
          el('span',{text:'仅限本场活动二维码'})),close);
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
        // Invalidate an earlier pending camera startup before retrying.
        epoch=++app.scannerEpoch;
        void startCamera(video,overlay,epoch);
      },'scanner-fullscreen-retry');
      const bottom=el('div',{class:'scanner-fullscreen-footer'},hud,
        el('p',{text:'扫描成功后无需退出；继续对准下一位同学的动态二维码。'}),retry);
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
      let epoch=++app.scannerEpoch;
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
    slot.append(button('开启全屏摄像头扫码',openCamera),
      status,text('摄像头将进入全屏扫码取景界面。底部显示扫码结果；顶部退出。没有相机权限时请改走人工认证通道。'));
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
      button('备用：核销已读取的完整签到码',()=>redeem(token.value),'secondary')));
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
