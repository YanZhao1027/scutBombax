'use strict';
// Demonstration state is strictly in-memory. No names, uploads, location or code are submitted.
const $=id=>document.getElementById(id);
const state={role:'student',joined:false,uploaded:false,approved:false,arrival:null,rejected:false,revision:0,codeReady:false};
const fakeName='测试学生 A',fakeId='TEST-001';
const roles={student:'学生',reviewer:'后台审核',scanner:'扫码核验',manual:'人工通道'};
function node(tag,cls='',text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;}
function text(s){return node('p','muted',s);}
function card(title){const c=node('section','card');c.append(node('h2','',title));return c;}
function button(label,fn,style=''){const b=node('button',style,label);b.type='button';b.addEventListener('click',fn);return b;}
function row(...items){const r=node('div','row');r.append(...items);return r;}
function badge(s,color=''){return node('span','tag '+color,s);}
function message(s,variant=''){let x=$('flow-status');if(!x){x=node('div','notice');x.id='flow-status';$('demo-view').prepend(x);}x.className='notice '+variant;x.textContent=s;}
function selectRole(role){state.role=role;render();}
function approvedAndPresent(){return state.approved&&Boolean(state.arrival);}
function initial(){return {role:'student',joined:false,uploaded:false,approved:false,arrival:null,rejected:false,revision:0,codeReady:false};}
function renderOverview(){
 const c=card('活动实时看板 · 模拟数据');
 const cells=node('div','grid');
 const metrics=[
  ['报名人数',state.joined?'1':'0'],
  ['待审核',state.joined&&state.uploaded&&!state.approved?'1':'0'],
  ['审核通过',state.approved?'1':'0'],
  ['已确认到场',state.arrival?'1':'0'],
  ['待补审已到场',state.arrival&&!state.approved?'1':'0'],
  ['可导出名单',approvedAndPresent()?'1':'0']
 ];
 metrics.forEach(([label,value])=>{const x=node('div','capsule');x.append(node('div','muted',label),node('div','big',value));cells.append(x);});
 c.append(cells);
 const status=row(badge('扫码窗口 × 4'),badge('人工认证 × 1'),badge('后台审核持续开放','green'));
 c.append(node('p','muted','真实版岗位独立授权；新的报名或补交材料应立即出现在审核队列。'),status);
 return c;
}
function renderStudent(root){
 const c=card('学生端 · 模拟活动');
 c.append(node('div','capsule',fakeName+' · '+fakeId+'（完全虚构）'));
 c.append(text('学生即使到达活动现场才开始集赞，也能先报名，再选择等待审核或走人工通道。'));
 if(!state.joined)c.append(button('模拟现场报名',()=>{state.joined=true;message('已模拟报名。你可以先提交材料，也可以切换人工通道确认到场。','success');render();}));
 else{
  c.append(row(badge('报名已提交','green'),badge(state.approved?'资料通过':state.uploaded?'材料待审核':'尚未交材料',state.approved?'green':'')));
  if(!state.uploaded)c.append(button('提交虚构集赞截图（不上传文件）',()=>{state.uploaded=true;state.rejected=false;message('模拟材料已进入后台待审核队列。','success');render();}));
  else if(state.rejected&&!state.approved)c.append(button('模拟补交新截图',()=>{state.rejected=false;state.revision++;message('已模拟补交，重新进入审核队列。','success');render();}));
  else if(!state.approved)c.append(text('证明材料已提交，等待后台工作人员处理。'));
  if(state.approved&&!state.arrival)c.append(button('模拟定位通过并生成 45 秒签到码',()=>{state.codeReady=true;render();}));
  if(state.codeReady&&!state.arrival){c.append(node('div','fake-qr','▦'),node('p','muted','演示二维码（不可真实扫码）'));
    c.append(button('前往扫码窗口',()=>selectRole('scanner')));}
  if(state.arrival)c.append(node('div','success-large','✓ 已模拟记录现场到场（'+(state.arrival==='manual'?'人工':'扫码')+'）'));
  if(state.arrival&&!state.approved)c.append(text('你已到场，但还没有取得申报名单资格。请继续补齐集赞材料并等待审核。'));
  if(approvedAndPresent())c.append(badge('符合候选名单条件（非学校官方活动票）','green'));
 }
 root.append(c);
}
function renderReviewer(root){
 const c=card('后台审核员 · 新申请实时处理');
 c.append(text('真实系统每 5 秒刷新待审核队列，优先显示已人工到场但仍欠缺证明材料的申请。'));
 if(!state.joined)c.append(text('尚无学生报名。'));
 else if(!state.uploaded)c.append(node('div','item',fakeName+' · 已报名，尚未上传集赞截图'));
 else if(!state.approved){
  const i=node('div','item');i.append(node('h3','',fakeName+' · '+fakeId),badge(state.arrival==='manual'?'人工已到场 · 优先处理':'新提交 / 待审核'),
    text('演示证明截图 '+(state.revision+1)+'（不保存任何文件）'));
  if(state.rejected)i.append(badge('补充材料后才能审核'));
  else i.append(row(button('模拟审核通过',()=>{state.approved=true;state.rejected=false;render();}),button('驳回并要求补充',()=>{state.rejected=true;render();},'danger')));
  c.append(i);
 }else c.append(node('div','success-large','✓ 材料审核已通过'));
 root.append(c);
}
function renderScanner(root){
 const c=card('扫码员 · 3–4 个快速窗口');
 c.append(text('只处理资料审核通过且已准备好花工木棉动态签到码的学生。真实版核销操作由服务端保证原子性。'));
 if(!state.joined)c.append(text('尚无报名，无法签到。'));
 else if(!state.approved)c.append(badge('资料尚未审核通过，请转至后台审核或人工窗口'));
 else if(state.arrival)c.append(badge('该学生已确认到场，禁止重复核销','green'));
 else if(!state.codeReady)c.append(text('等待学生在定位通过后生成动态二维码。'));
 else c.append(button('模拟扫码核销（不启用相机）',()=>{if(state.arrival){message('重复核销被拒绝','error');return;}state.arrival='scan';render();}));
 root.append(c);
}
function renderManual(root){
 const c=card('人工认证 · 唯一线下兜底通道');
 c.append(text('仅在工作人员面对面核对身份之后，登记“已经到场”。不替代线上材料审核；不扫描校园支付码。'));
 if(!state.joined)c.append(text('尚无报名记录，先引导学生扫码报名。'));
 else if(state.arrival)c.append(badge('已登记到场（'+(state.arrival==='manual'?'人工通道':'扫码通道')+'），不允许重复登记','green'));
 else{
  const i=node('div','item');
  i.append(node('h3','',fakeName+' · '+fakeId),badge(state.approved?'材料已通过':'材料未审核'));
  const check=node('input');check.type='checkbox';check.id='verify';
  const label=node('label');label.append(check,' 已当面核对身份（演示）');
  i.append(label,button('登记人工到场',()=>{if(!check.checked){message('必须先确认已现场核对身份','error');return;}state.arrival='manual';render();}));
  c.append(i);
 }
 root.append(c);
}
function renderExport(root){
 const c=card('最终名单 · 两项条件缺一不可');
 c.append(text('资料审核通过 + 扫码/人工到场 → 纳入申报候选名单。人工已到场但截图待审核的学生暂不导出。'));
 c.append(badge(approvedAndPresent()?'符合筛选条件：1 人':'符合筛选条件：0 人',approvedAndPresent()?'green':''));
 if(approvedAndPresent())c.append(button('下载虚构 CSV',()=>{
  const csv='\uFEFF"姓名","学号","资料审核","到场记录"\r\n"'+fakeName+'","'+fakeId+'","通过","'+(state.arrival==='manual'?'人工':'扫码')+'（模拟）"\r\n';
  const u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=node('a');a.href=u;a.download='活动速签-模拟申报名单.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
 }));
 root.append(c);
}
function render(){
 const root=$('demo-view');root.replaceChildren();
 Object.keys(roles).forEach(role=>$(role+'-tab').className=state.role===role?'':'secondary');
 root.append(renderOverview());
 if(state.role==='student')renderStudent(root);
 if(state.role==='reviewer')renderReviewer(root);
 if(state.role==='scanner')renderScanner(root);
 if(state.role==='manual')renderManual(root);
 renderExport(root);
 const actions=card('切换现场场景');
 actions.append(text('建议试试：学生报名 → 不交截图先走人工通道 → 之后补材料 → 审核通过 → 导出。也可以选择先审核后扫码。'));
 actions.append(button('重置全部演示',()=>{Object.assign(state,initial());render();},'secondary'));
 root.append(actions);
}
for(const role of Object.keys(roles))$(role+'-tab').onclick=()=>selectRole(role);
render();
