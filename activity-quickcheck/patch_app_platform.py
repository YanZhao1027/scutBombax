from pathlib import Path
p=Path('cloudflare-live/public/app.js')
s=p.read_text()
def replace(a,b):
 global s
 cnt=s.count(a)
 if cnt!=1:raise ValueError(f'anchor count {cnt}: {a[:95]!r}')
 s=s.replace(a,b)
replace('scannerPreviousFocus:null,scannerFeedback:null,qr:null,syntheticOnly:false};',
        'scannerPreviousFocus:null,scannerFeedback:null,reviewDispose:null,qr:null,syntheticOnly:false};')
replace("  app.scannerFeedback?.dispose();app.scannerFeedback=null;\n  if(app.qr)",
        "  app.scannerFeedback?.dispose();app.scannerFeedback=null;\n  app.reviewDispose?.();app.reviewDispose=null;\n  if(app.qr)")
replace("  renderAccount();home();\n  if(restoredEventId){",
        "  renderAccount();await home();\n  if(restoredEventId){")
begin=s.index('function renderAccount(){')
end=s.index('async function importPassImage(file){',begin)
replacement="""function page(){
  const path=location.pathname.replace(/\\/$/,'')||'/';
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
          button('查看详情 / 一码通报名',()=>viewEvent(event))))));
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
"""
s=s[:begin]+replacement+s[end:]
replace("  const head=card(event.title,button('← 返回活动列表',home,'secondary'),",
        "  const head=card(event.title,button('← 返回'+(app.me?.role==='organizer'?'管理后台':'活动列表'),()=>{location.assign(app.me?.role==='organizer'?'/admin':'/');},'secondary'),")
replace("""  if(duty==='owner'){
    const assign=form([""",
"""  if(duty==='owner'){
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
    const assign=form([""")
replace("""    if(duty==='owner'||duty==='scanner')return; // Keep the camera stream mounted during scanning.""",
"""    if(duty==='owner'||duty==='scanner'||duty==='reviewer')return;
    // Never redraw the spreadsheet while staff are selecting approval rows.""")
begin=s.index("  if(duty==='reviewer'){",s.index('async function renderDuty'))
end=s.index("  }else if(duty==='manual'){",begin)
replacement="""  if(duty==='reviewer'){
    slot.append(text('表格提供全选与 Shift 连续多选；勾「通过」后统一确认。图片会在右侧预览，支持前后顺序切换。'));
    if(!window.BombaxReviewGrid)throw new Error('批量审核组件尚未加载，请刷新后台');
    app.reviewDispose=window.BombaxReviewGrid.mount({
      root:slot,rows:all,eventId:event.id,request,
      notify:notice,onCommitted:()=>renderDuty(event,root,duty,owner)
    });
"""
s=s[:begin]+replacement+s[end:]
replace("  if(old)old.remove();\n  const slot=card(",
        "  if(old)old.remove();\n  app.reviewDispose?.();app.reviewDispose=null;\n  const slot=card(")
p.write_text(s)
print('Frontend: homepage event artwork cards, isolated admin/login, /my, organizer banner editor, spreadsheet reviewer')
