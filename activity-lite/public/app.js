'use strict';
// Self-contained web UI. Link fragments hold capabilities; no student login
// and no server-produced QR images. Only browser QR canvas and HTTPS requests.
const $=id=>document.getElementById(id);
const mount=$('view'),banner=$('notice');
function node(tag,attrs={},...children){
  const v=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)){
    if(value==null)continue;
    if(key==='class')v.className=value;
    else if(key==='text')v.textContent=String(value);
    else if(key==='onclick')v.addEventListener('click',()=>safe(value));
    else if(key==='onchange')v.addEventListener('change',value);
    else if(key==='checked')v.checked=Boolean(value);
    else if(key==='value')v.value=value;
    else v.setAttribute(key,String(value));
  }
  for(const child of children.flat()){
    if(child==null)continue;
    v.append(child instanceof Node?child:document.createTextNode(String(child)));
  }
  return v;
}
const p=(s,cl='muted')=>node('p',{class:cl,text:s});
const h=(s,n=2)=>node('h'+n,{text:s});
const button=(s,action,cl='')=>node('button',{type:'button',class:cl,onclick:action},s);
const card=(title,...contents)=>node('section',{class:'card'},h(title),...contents);
const field=(labelText,control)=>node('label',{},labelText,control);
const input=(name,opts={})=>node('input',{name,type:'text',...opts});
const pretty=t=>new Date(t).toLocaleString('zh-CN',{hour12:false});
const stateLabel={pending:'审核中',approved:'审核通过',rejected:'审核未通过'};
function tell(message,kind=''){
  banner.textContent=message;banner.className=kind;
  if(message)banner.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function safe(fn){Promise.resolve().then(fn).catch(e=>tell(e.message||'操作失败','error'));}
async function request(path,{method='GET',data,headers={}}={}){
  const opts={method,credentials:'same-origin',headers:{...headers}};
  if(method!=='GET'){
    opts.headers['X-Lite-Action']='1';
    if(data instanceof FormData)opts.body=data;
    else{opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(data||{});}
  }
  const response=await fetch(path,opts);
  if(!response.ok){
    let problem='请求失败';
    try{problem=(await response.json()).error||problem;}catch{}
    const error=new Error(problem);error.status=response.status;throw error;
  }
  if((response.headers.get('Content-Type')||'').includes('application/json'))
    return response.json();
  return response;
}
function route(){
  const hash=decodeURIComponent(location.hash.slice(1));
  if(hash.startsWith('event=')&&/^[a-f0-9-]{36}$/.test(hash.slice(6)))
    return {type:'event',id:hash.slice(6)};
  if(hash.startsWith('receipt=')&&/^[a-f0-9]{64}$/.test(hash.slice(8)))
    return {type:'receipt',token:hash.slice(8)};
  if(hash.startsWith('checkin=')&&/^[a-f0-9]{64}$/.test(hash.slice(8)))
    return {type:'checkin'};
  for(const type of ['staff','scan','manage']){
    if(hash.startsWith(type+'=')){
      const id=hash.slice(type.length+1);
      if(/^[a-f0-9-]{36}$/.test(id))
        return {type:type==='manage'?'staff':type,id};
    }
  }
  return {type:'home'};
}
let screenEpoch=0;
function sameEpoch(epoch){return epoch===screenEpoch;}
function link(label,url){
  return node('a',{href:url,text:label,rel:'noreferrer'});
}
function linkDisplay(label,url){
  const text= node('div',{class:'linkbox code',text:url});
  return node('div',{class:'item'},
    node('strong',{text:label}),text,
    node('div',{class:'row'},
      button('复制链接',async()=>{
        await navigator.clipboard.writeText(url);
        tell('链接已复制，请注意保管其中的私密密钥','success');
      },'secondary'),
      link('打开',url)));
}
function stub(text){
  return node('div',{class:'status',text});
}
async function render(){
  const epoch=++screenEpoch;
  closeCamera();
  banner.replaceChildren();banner.className='';
  mount.replaceChildren(p('正在读取活动数据…'));
  const r=route();
  try{
    if(r.type==='home')await home(epoch);
    else if(r.type==='event')await eventPage(r.id,epoch);
    else if(r.type==='receipt')await receiptPage(r.token,epoch);
    else if(r.type==='staff'||r.type==='scan')await staffPage(r.id,r.type,epoch);
    else mount.replaceChildren(card('这是一张签到二维码链接',
      p('它不能自动签到。请由本场活动的授权工作人员扫描确认。'),
      link('返回活动主页','/')));
  }catch(error){if(sameEpoch(epoch))mount.replaceChildren(card('暂时无法打开',p(error.message),'',
    link('返回活动列表','/')));}
}
async function home(epoch){
  const list=await request('/api/events');
  if(!sameEpoch(epoch))return;
  const root=node('div',{},h('活动报名，不必注册账号',1),
    p('学生报名一次并保存私密回执链接；审核通过后，打开链接就能在本机生成签到二维码。'),
    node('div',{class:'status'},'无 GPS、无学生账号、无实时消息；材料存云端，现场扫码只请求一次服务器。'));
  const events=node('div',{class:'grid'});
  for(const e of list.events){
    events.append(card(e.title,
      p('地点：'+e.place),
      p('活动时间：'+pretty(e.startsAt)+' — '+pretty(e.endsAt)),
      node('div',{class:'row'},link('查看活动 / 提交材料','/#event='+e.id))));
  }
  root.append(h('可报名活动'),events.children.length?events:p('当前没有开放的活动。'));
  const form=node('form',{class:'card'},h('社团负责人 · 创建活动'),
    p('仅供持有管理员密钥的社团负责人使用。学生完全不需要账号。'),
    field('管理员创建密钥（仅用于创建活动）',input('root',{type:'password',minlength:64,maxlength:64,required:true,autocomplete:'off'})),
    field('初始管理员账号',input('adminUsername',{required:true,pattern:'[a-zA-Z0-9_.-]{3,32}',maxlength:32,
      placeholder:'如 club_admin',autocomplete:'username'})),
    field('负责人显示名称',input('adminDisplayName',{required:true,maxlength:60,placeholder:'例如：测试社团负责人'})),
    field('初始管理员密码（至少 12 位）',input('adminPassword',{type:'password',minlength:12,maxlength:128,
      required:true,autocomplete:'new-password'})),
    field('活动名称',input('title',{required:true,maxlength:90})),
    field('活动地点（纯文字）',input('place',{required:true,maxlength:120,placeholder:'例如：五山校区某教学楼一楼'})),
    field('活动说明',node('textarea',{name:'instructions',maxlength:800})),
    field('开始时间',input('startsAt',{type:'datetime-local',required:true})),
    field('结束时间',input('endsAt',{type:'datetime-local',required:true})),
    node('label',{class:'check'},input('requireMaterial',{type:'checkbox',checked:true}),'报名需提交截图材料'),
    node('button',{type:'submit'},'创建活动并生成分享链接'));
  const output=node('div');
  form.addEventListener('submit',ev=>{ev.preventDefault();safe(async()=>{
    const b=form.querySelector('button[type=submit]');b.disabled=true;
    try{
      const data=new FormData(form);
      const response=await request('/api/events',{method:'POST',
        headers:{'X-Lite-Root':String(data.get('root')||'')},
        data:{title:data.get('title'),place:data.get('place'),
          instructions:data.get('instructions'),startsAt:new Date(data.get('startsAt')).getTime(),
          endsAt:new Date(data.get('endsAt')).getTime(),
          requireMaterial:data.has('requireMaterial'),
          adminUsername:data.get('adminUsername'),adminDisplayName:data.get('adminDisplayName'),
          adminPassword:data.get('adminPassword')}});
      form.querySelector('input[name=adminPassword]').value='';
      form.querySelector('input[name=root]').value='';
      output.replaceChildren(card('活动创建成功 · 工作人员凭账号登录',
        linkDisplay('发给学生的报名链接（学生不用账号）',response.shareUrl),
        linkDisplay('负责人审批登录入口',response.manageUrl),
        linkDisplay('App / 网页扫码登录入口',response.scanUrl),
        p('这两个工作人员链接只是入口，不再包含权限密钥。请安全保管登录密码，由管理员为其他工作人员单独创建子账号。')));
      tell('活动已创建，无需地图定位','success');
    }finally{b.disabled=false;}
  });});
  // Keep students focused on events; organizer setup stays collapsed.
  root.append(node('details',{class:'card'},
    node('summary',{text:'负责人入口 · 创建新活动（需要密钥）'}),form,output));
  mount.replaceChildren(root);
}
async function eventPage(id,epoch){
  const data=await request('/api/events/'+id);
  if(!sameEpoch(epoch))return;
  const e=data.event;
  const intro=card(e.title,
    node('div',{class:'row'},node('span',{class:'step',text:'报名 → 审核 → 出示码 → 签到'})),
    p('活动地点：'+e.place),
    p('活动时间：'+pretty(e.startsAt)+' — '+pretty(e.endsAt)),
    e.instructions?p(e.instructions):null,
    p('无需注册。填写必要的联系方式方便社团在特殊情况下联系你。材料审核结果通过私密回执链接查看。'));
  const form=node('form',{class:'card narrow'},h('提交报名和材料'),
    field('姓名（自填）',input('name',{required:true,maxlength:60})),
    field('学号（自填，不代表官方认证）',input('studentNumber',{required:true,maxlength:40})),
    field('微信号或其他联系方式',input('contact',{required:true,maxlength:100})),
    field('留言（可选）',node('textarea',{name:'note',maxlength:400})),
    field(e.requireMaterial?'活动材料截图（必填，不超过 2MB）':'活动材料截图（可选，不超过 2MB）',
      input('material',{type:'file',accept:'image/png,image/jpeg',
        ...(e.requireMaterial?{required:true}:{})})),
    node('label',{class:'check'},input('privacyAck',{type:'checkbox',value:'yes',required:true}),
      '我同意社团负责人为本活动审核、签到与申报名单处理上述信息；链接需要自行保管。'),
    node('button',{type:'submit'},'提交报名 · 生成私密回执'));
  const result=node('div');
  form.addEventListener('submit',ev=>{ev.preventDefault();safe(async()=>{
    const submit=form.querySelector('button[type=submit]');
    const formData=new FormData(form);
    const f= formData.get('material');
    if(f?.size>2*1024*1024)throw new Error('图片不能超过 2MB');
    submit.disabled=true;submit.textContent='正在提交材料…';
    try{
      const response=await request('/api/events/'+id+'/apply',{method:'POST',data:formData});
      form.remove();
      result.replaceChildren(card('提交成功，请保存回执链接',
        node('div',{class:'status success'},'没有学生账号。审核结果稍后从私密链接查看。'),
        linkDisplay('你的个人回执（不要公开到群聊）',response.receiptUrl),
        p('建议通过微信“文件传输助手”或个人收藏保存。丢失链接需要联系社团负责人协助处理。')));
      tell('报名材料已提交，等待社团审核。','success');
    }finally{submit.disabled=false;submit.textContent='提交报名 · 生成私密回执';}
  });});
  mount.replaceChildren(intro,form,result);
}
async function receiptPage(token,epoch){
  const header={'X-Lite-Receipt':token};
  const holder=node('div');
  mount.replaceChildren(h('我的活动回执',1),holder);
  async function update(){
    const r=await request('/api/receipt',{headers:header});
    if(!sameEpoch(epoch))return;
    const e=r.event;
    const status=node('div',{class:'status '+(r.checkedIn?'success':r.state==='rejected'?'error':''),
      text:r.checkedIn?'已确认到场':stateLabel[r.state]||r.state});
    const inside=card(e.title,
      p('地点：'+e.place+' · '+pretty(e.startsAt)),
      status,r.decision?p('审核反馈：'+r.decision):null,
      p('此页面仅由私密回执链接打开；没有账号，也不会自动向你推送状态。'));
    const actions=node('div',{class:'row'},button('刷新审核结果',update,'secondary'));
    if(r.state==='approved'&&!r.checkedIn){
      const qrSlot=node('div',{class:'qr-card'});
      const generate=button('在本机生成签到二维码',async()=>{
        generate.disabled=true;
        try{
          const out=await request('/api/receipt/ticket',{method:'POST',headers:header});
          if(!sameEpoch(epoch))return;
          requireQR();
          const canvas=node('canvas',{class:'qr','aria-label':'活动签到二维码'});
          qrSlot.replaceChildren(h('向现场工作人员出示'),canvas,
            p('二维码由浏览器在本机生成；没有上传二维码图片。'),
            p('该码只可核销一次，截止活动结束；再次生成会让旧码失效。'),
            p('它不是你的私密回执链接，不含姓名和学号。'));
          await window.LiteQr.draw(canvas,out.checkinUrl);
          tell('二维码已在本机绘制，请出示给现场工作人员','success');
        }finally{generate.disabled=false;}
      });
      actions.append(generate);
      inside.append(qrSlot);
    }
    inside.append(actions);
    holder.replaceChildren(inside);
  }
  await update();
}
function requireQR(){if(!window.LiteQr?.draw)throw new Error('本地二维码组件未加载，请刷新页面');}
const RIGHTS=[
  ['review','材料审核与查看材料'],
  ['scan','现场扫码核销'],
  ['export','导出到场名单'],
  ['manual','异常人工登记']
];
const permName=p=>RIGHTS.find(x=>x[0]===p)?.[1]||p;
function permissionInputs(checked={}) {
  const fields=new Map();
  const box=node('div',{class:'permission-set'});
  for(const [key,labelText] of RIGHTS){
    const control=node('input',{type:'checkbox',checked:checked[key]===true,
      'aria-label':labelText});
    fields.set(key,control);
    box.append(node('label',{class:'check'},control,labelText));
  }
  return {box,read:()=>Object.fromEntries([...fields].map(([key,v])=>[key,v.checked]))};
}
async function staffPage(eventId,mode,epoch){
  const e=(await request('/api/events/'+eventId)).event;
  if(!sameEpoch(epoch))return;
  let me;
  try{
    me=await request('/api/staff/me?eventId='+eventId);
  }catch(error){
    if(error.status!==401)throw error;
    const form=node('form',{class:'card narrow staff-login'},h('活动方账号登录'),
      node('div',{class:'step',text:mode==='scan'?'APP / 网页扫码入口':'网页审批 / 管理入口'}),
      p('活动：'+e.title+' · '+e.place),
      p('学生不用登录；只有活动负责人和获得授权的工作人员需要账号。'),
      field('工作人员账号',input('username',{required:true,autocomplete:'username',
        pattern:'[a-zA-Z0-9_.-]{3,32}',maxlength:32})),
      field('登录密码',input('password',{type:'password',required:true,minlength:12,
        maxlength:128,autocomplete:'current-password'})),
      node('button',{type:'submit'},'登录活动工作台'));
    form.addEventListener('submit',event=>{event.preventDefault();safe(async()=>{
      const submit=form.querySelector('button[type=submit]');
      submit.disabled=true;
      try{
        const details=new FormData(form);
        await request('/api/staff/login',{method:'POST',data:{
          eventId,username:details.get('username'),password:details.get('password')}});
        form.querySelector('input[name=password]').value='';
        tell('活动工作人员已登录','success');
        await staffPage(eventId,mode,epoch);
      }finally{submit.disabled=false;}
    });});
    mount.replaceChildren(h(mode==='scan'?'现场扫码登录':'社团审批后台',1),form);
    return;
  }
  if(!sameEpoch(epoch))return;
  const {account}=me,permissions=account.permissions;
  const header=card('活动：'+e.title,
    node('div',{class:'row'},node('span',{class:'step',
      text:account.role==='admin'?'活动管理员':'活动子账号'}),
      node('strong',{text:account.displayName}),
      node('span',{class:'muted',text:'@'+account.username})),
    node('p',{class:'muted',
      text:'授权权限：'+(RIGHTS.filter(([p])=>permissions[p]).map(([p])=>permName(p)).join(' · ')||'无')}),
    node('div',{class:'row'},
      link('网页审批 / 管理','/#staff='+eventId),
      permissions.scan?link('手机扫码入口','/#scan='+eventId):null,
      button('退出当前账号',async()=>{
        await request('/api/staff/logout',{method:'POST'});
        tell('工作人员已退出','success');
        await staffPage(eventId,mode,epoch);
      },'outline')));
  const content=node('div');
  mount.replaceChildren(h(mode==='scan'?'现场全屏扫码':'活动方工作台',1),header,content);
  if(mode==='scan'){
    if(!permissions.scan){
      content.append(card('没有扫码权限',
        p('请活动管理员为你的子账号开启“现场扫码核销”，或使用其他已授权账号。')));
      return;
    }
    await scannerPage(eventId,epoch,content);
    return;
  }
  if(permissions.review||permissions.manual)
    await managerPage(eventId,epoch,permissions,content);
  if(permissions.export)
    content.append(card('名单导出',
      p('只有被授权的人员可导出。文件仅包含“已审核通过且已到场”的学生。'),
      button('下载到场名单 CSV',async()=>{
        const res=await request('/api/events/'+eventId+'/export');
        const url=URL.createObjectURL(await res.blob());
        const a=node('a',{href:url,download:'活动速签-到场名单.csv'});
        document.body.append(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),2500);
      },'secondary')));
  if(permissions.accounts)await accountManagement(eventId,epoch,content);
  if(!permissions.review&&!permissions.manual&&!permissions.export&&!permissions.accounts)
    content.append(card('已登录签到账号',
      p('你的权限仅允许扫码。请点击上方“手机扫码入口”，在花工木棉 App 中开启全屏摄像头。')));
}
async function managerPage(eventId,epoch,permissions,content){
  const view=node('div',{class:'workbench'});
  content.append(view);
  async function update(){
    const r=await request('/api/events/'+eventId+'/records');
    if(!sameEpoch(epoch))return;
    const pending=r.registrations.filter(x=>x.status==='pending');
    const present=r.registrations.filter(x=>x.checked_at);
    const tools=card('材料审核与人工处理',
      node('div',{class:'row'},
        node('span',{class:'step',text:'报名 '+r.registrations.length}),
        node('span',{class:'step',text:'待审核 '+pending.length}),
        node('span',{class:'step',text:'已到场 '+present.length})),
      button('刷新报名列表',update,'secondary'));
    const list=node('div',{class:'grid'});
    for(const r0 of r.registrations){
      const id=r0.id;
      const item=card(r0.name,
        p('学号（自填）：'+r0.student_number),
        p('联系：'+r0.contact),
        r0.note?p('备注：'+r0.note):null,
        node('div',{class:'row'},
          node('span',{class:'step',text:stateLabel[r0.status]}),
          node('span',{class:r0.checked_at?'good':'muted',text:r0.checked_at?'已到场':'未到场'})),
        r0.decision?p('审核反馈：'+r0.decision):null);
      if(permissions.review&&r0.hasMaterial){
        const preview=node('div');
        item.append(button('查看材料',async()=>{
          const res=await request('/api/events/'+eventId+'/material/'+id);
          const url=URL.createObjectURL(await res.blob());
          preview.replaceChildren(node('img',{src:url,class:'material-preview',alt:'社团报名材料截图'}));
          setTimeout(()=>{URL.revokeObjectURL(url);preview.replaceChildren();},45000);
        },'secondary'),preview);
      }
      if(permissions.review&&(r0.status==='pending'||r0.status==='rejected')){
        const comment=node('textarea',{placeholder:'审核反馈（可选）',maxlength:250});
        item.append(comment,node('div',{class:'row'},
          button('审核通过',()=>decision('approved')),
          button('驳回 / 补交',()=>decision('rejected'),'secondary')));
        async function decision(state){
          await request('/api/events/'+eventId+'/review',{method:'POST',
            data:{registrationId:id,state,decision:comment.value}});
          tell('材料审核结论已保存','success');await update();
        }
      }
      if(permissions.manual&&!r0.checked_at){
        const reason=node('input',{placeholder:'人工处理原因（不少于 8 字）',maxlength:250});
        item.append(node('details',{},
          node('summary',{text:'异常人工签到（须当面核实）'}),
          p('该操作会记录当前工作人员账号。自填学号不能代替独立身份证明。'),
          reason,
          button('人工确认到场',async()=>{
            if(reason.value.trim().length<8)throw new Error('请记录至少 8 字现场处理原因');
            if(!confirm('已完成面对面身份核对，确定要登记到场吗？'))return;
            await request('/api/events/'+eventId+'/manual',{method:'POST',
              data:{registrationId:id,reason:reason.value,identityChecked:true}});
            tell('人工到场记录已保存','success');await update();
          })));
      }
      list.append(item);
    }
    view.replaceChildren(tools,h('报名与审核记录'),
      list.children.length?list:p('目前没有报名记录。'));
  }
  await update();
}
async function accountManagement(eventId,epoch,content){
  const area=node('section',{class:'card'});
  content.append(area);
  async function refresh(){
    const res=await request('/api/staff/accounts?eventId='+eventId);
    if(!sameEpoch(epoch))return;
    const form=node('form',{class:'account-form'},
      h('活动子账号 · 新建'),
      p('只为活动方建立账号，不为学生建立账号。子账号只能处理你勾选的权限。'),
      field('账号（3–32 位字母或数字等）',input('username',{required:true,
        maxlength:32,pattern:'[a-zA-Z0-9_.-]{3,32}',autocomplete:'off'})),
      field('显示名称',input('displayName',{required:true,maxlength:60})),
      field('初始密码（至少 12 位，请通过安全渠道交给工作人员）',
        input('password',{type:'password',minlength:12,maxlength:128,required:true,
          autocomplete:'new-password'})));
    const controls=permissionInputs();
    form.append(controls.box,node('button',{type:'submit'},'创建子账号'));
    form.addEventListener('submit',ev=>{ev.preventDefault();safe(async()=>{
      const values=new FormData(form),btn=form.querySelector('button[type=submit]');
      btn.disabled=true;
      try{
        await request('/api/staff/accounts',{method:'POST',
          data:{eventId,username:values.get('username'),
            displayName:values.get('displayName'),password:values.get('password'),
            permissions:controls.read()}});
        form.querySelector('input[name=password]').value='';
        tell('子账号已创建，密码只应由负责人单独告知工作人员','success');
        await refresh();
      }finally{btn.disabled=false;}
    });});
    const list=node('div',{class:'account-list'});
    for(const a of res.accounts){
      const part=node('section',{class:'item account-row'},
        node('div',{class:'row between'},node('strong',{text:a.displayName+' · @'+a.username}),
          node('span',{class:'step',text:a.role==='admin'?'活动管理员':
            (a.enabled?'子账号 · 启用':'子账号 · 已停用')})));
      if(a.role==='admin'){part.append(p('管理员有全部权限；不允许通过子账号接口修改管理员。'));list.append(part);continue;}
      const inputs=permissionInputs(a.permissions);
      const reset=input('password',{type:'password',minlength:12,maxlength:128,
        autocomplete:'new-password',placeholder:'留空则不修改密码'});
      part.append(inputs.box,
        field('重置密码（可选）',reset),
        node('div',{class:'row'},
          button('保存权限 / 重置密码',async()=>{
            const data={eventId,permissions:inputs.read()};
            if(reset.value)data.password=reset.value;
            await request('/api/staff/accounts/'+a.id,{method:'PATCH',data});
            reset.value='';
            tell('权限已更新，该子账号的现有会话已经撤销','success');
            await refresh();
          }),
          button(a.enabled?'停用账号':'重新启用',async()=>{
            if(a.enabled&&!confirm('确定停用该账号？该账号会立即失去所有活动权限。'))return;
            await request('/api/staff/accounts/'+a.id,{method:'PATCH',
              data:{eventId,enabled:!a.enabled}});
            tell(a.enabled?'账号已停用':'账号已重新启用','success');
            await refresh();
          },'secondary')));
      list.append(part);
    }
    area.replaceChildren(h('工作人员与权限管理'),form,h('本活动的工作人员'),
      list.children.length?list:p('还没有分配子账号。'));
  }
  await refresh();
}
let stopCurrent=null;
function closeCamera(){if(stopCurrent){stopCurrent();stopCurrent=null;}}
function checkinToken(value){
  const raw=String(value||'').trim();
  if(/^[a-f0-9]{64}$/.test(raw))return raw;
  try{
    const url=new URL(raw,location.origin);
    if(url.origin!==location.origin)return null;
    const m=url.hash.match(/^#checkin=([a-f0-9]{64})$/);
    return m?.[1]||null;
  }catch{return null;}
}
async function scannerPage(eventId,epoch,content){
  const info=await request('/api/events/'+eventId);
  if(!sameEpoch(epoch))return;
  const state=node('div',{class:'status',text:'等待开始扫码…'});
  const scan=button('开启全屏摄像头扫码',()=>openScan());
  const manual=node('input',{placeholder:'或粘贴已读取的完整签到链接','aria-label':'完整签到链接'});
  let last='',at=0,busy=false;
  async function redeem(textValue,hud=state){
    const token=checkinToken(textValue);
    if(!token){hud.textContent='不是本系统的活动签到链接';hud.className='scan-result error';return;}
    if(busy||(token===last&&Date.now()-at<3000))return;
    last=token;at=Date.now();busy=true;
    try{
      await request('/api/events/'+eventId+'/redeem',{method:'POST',data:{token}});
      hud.textContent='✓ 签到成功 · 请下一位';
      hud.className='scan-result ok';
      if(!hud.isConnected){state.textContent='签到成功 · 请下一位';state.className='status success';}
      manual.value='';
      try{navigator.vibrate?.(65);}catch{}
    }catch(error){
      hud.textContent='核销失败：'+error.message+' · 请找负责人处理';
      hud.className='scan-result error';
      try{navigator.vibrate?.([70,50,70]);}catch{}
    }finally{setTimeout(()=>{busy=false;},550);}
  }
  function openScan(){
    if(!window.ZXingBrowser?.BrowserQRCodeReader)throw new Error('扫码组件加载失败');
    if(!window.isSecureContext)throw new Error('摄像头需在 HTTPS 或 USB 本机 localhost 打开');
    const video=node('video',{autoplay:'autoplay',playsinline:'playsinline',muted:'muted'});
    const result=node('div',{class:'scan-result',role:'status','aria-live':'polite',text:'正在开启后置摄像头…'});
    const overlay=node('section',{class:'fullscan',role:'dialog','aria-modal':'true',
      'aria-label':'全屏二维码扫码'},
      video,node('div',{class:'scan-shade'}),
      node('div',{class:'scan-top'},node('strong',{text:'活动速签 · 扫码中'}),
        button('✕ 关闭',()=>closeCamera())),
      node('div',{class:'scan-target'}),
      node('div',{class:'scan-bottom'},result,p('不显示姓名和学号 · 成功后继续扫描下一位')));
    document.body.append(overlay);document.body.classList.add('scanning');
    let stopped=false,controls=null;
    const exit=()=>{
      if(stopped)return;stopped=true;
      try{controls?.stop();}catch{}
      try{video.srcObject?.getTracks?.().forEach(track=>track.stop());}catch{}
      video.srcObject=null;overlay.remove();document.body.classList.remove('scanning');
      document.removeEventListener('keydown',escape);
      document.removeEventListener('visibilitychange',visible);
    };
    const escape=e=>{if(e.key==='Escape')exit();};
    const visible=()=>{if(document.hidden)exit();};
    stopCurrent=exit;
    document.addEventListener('keydown',escape);
    document.addEventListener('visibilitychange',visible);
    const reader=new window.ZXingBrowser.BrowserQRCodeReader();
    void reader.decodeFromVideoDevice(undefined,video,code=>{
      if(code?.getText&&!stopped)void redeem(code.getText(),result);
    }).then(started=>{
      if(stopped){started.stop();return;}
      controls=started;
      result.textContent='摄像头已就绪 · 对准学生的二维码';
    }).catch(error=>{
      if(!stopped){result.textContent='摄像头不可用：'+error.message;result.className='scan-result error';}
    });
  }
  content.append(card(info.event.title,
    node('div',{class:'status',text:'仅限本场活动 · 工作人员只看到核销结果，不查看学生身份。'}),
    p('手机摄像头读取二维码链接后，向服务器发起一次核销请求；不使用持续消息连接。'),
    scan,state,field('无法启动相机时：粘贴已读取的签到链接',manual),
    button('核销此链接',()=>redeem(manual.value,state),'secondary'),
    p('二维码无法核销请联系负责人做人工核验。此页没有学生查询权限。')));
}
window.addEventListener('hashchange',()=>safe(render));
window.addEventListener('pagehide',closeCamera);
safe(render);
