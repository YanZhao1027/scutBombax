'use strict';
const $=id=>document.getElementById(id);
const app={me:null,events:[],active:null,poll:null,scanner:null,qr:null,syntheticOnly:false};
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
  const signIn=form([label('用户名',inp('username')),label('密码',inp('password','password'))],'登录',
    async x=>{await request('/api/login',{method:'POST',data:x});await start();});
  const privacy=el('input',{type:'checkbox',name:'privacyAcknowledged',value:'yes'});
  const signUp=form([
    label('注册用户名',inp('username')),
    label('姓名（目前无法独立验证）',inp('displayName')),
    label('学号（自行填写）',inp('studentNumber')),
    label('12 位以上密码',inp('password','password')),
    el('label',{class:'check'},privacy,'我知悉活动报名会保存自填身份与证明材料，只有授权人员可以查看；正式部署前须公示数据保留及删除办法。')
  ],'注册学生账号',async x=>{
    if(!privacy.checked)throw new Error('须先确认了解个人信息处理规则');
    await request('/api/register',{method:'POST',data:{...x,privacyAcknowledged:true}});
    notice('学生账户已创建，请登录。所填学号尚未经学校认证。','success');
  });
  root.append(card('登录与学生注册',text('不读取学校一卡通、微信 Cookie 或校园码。'),
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
      if(!navigator.geolocation)throw new Error('浏览器不能定位');
      const pos=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,()=>no(new Error('定位失败')),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
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
        if(!navigator.geolocation)throw new Error('浏览器不支持定位');
        const pos=await new Promise((yes,no)=>navigator.geolocation.getCurrentPosition(yes,()=>no(new Error('定位失败，请进入人工通道')),{enableHighAccuracy:true,timeout:12000,maximumAge:0}));
        const ticket=await request('/api/events/'+event.id+'/ticket',{method:'POST',data:{
          latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracyM:pos.coords.accuracy
        }});
        const response=await request('/api/qr',{method:'POST',data:{token:ticket.token}});
        const svg=await response.blob();
        if(app.qr)URL.revokeObjectURL(app.qr);
        app.qr=URL.createObjectURL(svg);
        qrArea.replaceChildren(el('img',{class:'qr',src:app.qr,alt:'本次活动临时签到二维码'}),
          text('请在 '+stamp(ticket.expiresAt)+' 前出示给工作人员；用过即失效。'));
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
  const old=$('duty-body');if(old)old.remove();
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
    slot.append(text('仅扫描花工木棉活动二维码，不扫描学校支付或校园认证码。'));
    const video=el('video',{autoplay:'autoplay',playsinline:'playsinline',muted:'muted'}),status=el('div',{class:'status',text:'等待扫码…'});
    const token=el('input',{placeholder:'摄像头不可用时手工输入完整签到码'});
    let scanning=false;
    async function redeem(value){
      if(scanning)return;scanning=true;
      try{await request('/api/events/'+event.id+'/redeem',{method:'POST',data:{token:value}});
        status.textContent='✓ 核销成功，请下一位';token.value='';
      }catch(e){status.textContent='核销失败：'+e.message;}
      finally{setTimeout(()=>{scanning=false;},500);}
    }
    slot.append(el('div',{class:'row'},
      button('开启摄像头',async()=>{
        if(!window.ZXingBrowser)throw new Error('扫码模块尚未打包：请改用人工通道');
        cleanScanner();
        const reader=new window.ZXingBrowser.BrowserQRCodeReader();
        app.scanner=await reader.decodeFromVideoDevice(undefined,video,code=>{if(code?.getText)safe(()=>redeem(code.getText()));});
      }),button('停止',cleanScanner,'secondary')),video,status,
      el('div',{class:'row'},token,button('手工核销',()=>redeem(token.value))));
  }
}
function cleanScanner(){try{app.scanner?.stop();}catch{}app.scanner=null;}
safe(start);
