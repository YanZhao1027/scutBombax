'use strict';
const $=(id)=>document.getElementById(id);
const model={role:'student',stage:0,approved:false,checked:false,ticket:null,lastCode:0,reviewNote:'',uploaded:false};
const names=['活动报名','提交证明材料','主办方审核','模拟现场定位','出示动态签到码','工作人员核销','整理申报名单'];
function el(tag,cls,text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;}
function p(text,cls='muted'){return el('p',cls,text);}
function button(label,fn,kind=''){const x=el('button',kind,label);x.type='button';x.onclick=fn;return x;}
function card(title){const c=el('section','card'),h=el('h2','',title);c.append(h);return c;}
function row(...children){const r=el('div','row');r.append(...children);return r;}
function infoBox(message){return el('div','notice',message);}
function stateLabel(index){return index<model.stage?'完成':index===model.stage?'进行中':'待处理';}
function timeline(){
 const c=card('活动认证流程');
 const wrap=el('div','steps');
 names.forEach((title,i)=>{const item=el('div','step'),chip=el('span',i<model.stage?'tag green':'tag',stateLabel(i));item.append(el('strong','',String(i+1)+' · '+title),chip);wrap.append(item);});
 c.append(wrap);return c;
}
function completed(){return model.checked;}
function roles(){
 $('student-tab').className=model.role==='student'?'':'secondary';
 $('organizer-tab').className=model.role==='organizer'?'':'secondary';
}
function student(){
 const root=$('demo-view'),activity=card('校园活动 · 模拟报名');
 activity.append(p('本页所示均为演示数据，不代表真实学校活动或真实身份。'));
 activity.append(el('div','item','活动时间：演示模式 · 地点：模拟活动会场 · 定位要求：示意'));
 const fake=el('div','capsule','示例参与者：测试学生 A（虚构身份） · 示例学号：TEST-001');
 activity.append(fake);
 if(model.stage===0){
   activity.append(p('实际产品将提交姓名、学号和主办方要求的字段；此公开演示不采集任何身份数据。'));
   activity.append(button('模拟提交报名',()=>{model.stage=1;draw();}));
 }else activity.append(el('span','tag green','已创建模拟报名'));
 if(model.stage===1){
   const c=card('资料上传 · 演示');
   c.append(p('模拟集赞截图或报名材料审核：不需要上传真实照片。真实版才会有私有附件存储。'));
   c.append(button('使用虚构测试附件继续',()=>{model.uploaded=true;model.stage=2;draw();}));
   root.append(c);
 }
 if(model.stage===2){
   const c=card('等待主办方审核');
   c.append(p('切换到主办方角色，模拟审核通过或驳回。审核在服务端进行的真实版本已完成本地测试。'));
   c.append(button('切换至主办方',()=>{model.role='organizer';draw();}));
   root.append(c);
 }
 if(model.stage===3){
   const c=card('模拟现场定位');
   c.append(p('真实版本需要用户授权浏览器定位并在服务端验证距离。此公网演示不读取地理位置。'));
   c.append(button('模拟定位通过（不读取实际位置）',()=>{model.stage=4;draw();}));
   root.append(c);
 }
 if(model.stage===4){
   const c=card('动态签到码');
   c.append(p('这是演示凭证，不是真实有效的签到二维码。请把手机展示给现场核验员的流程仅为模拟。'));
   const token='DEMO-ONLY-NOT-A-REAL-TICKET';
   const code=el('div','fake-qr','▦');
   const label=el('strong','','演示核验码：BOMBAX-DEMO');
   c.append(code,label);
   c.append(p('真实服务端版本签发 45 秒随机凭证，核销一次即失效。'));
   c.append(button('切换至扫码工作人员',()=>{model.role='organizer';draw();}));
   root.append(c);
 }
 if(completed()){
   const done=card('认证结果');
   done.append(el('div','success-large','✓ 已模拟完成现场核销'));
   done.append(p('测试学生 A · 资料审核通过 · 模拟到场 · 模拟核销完成。'));
   root.append(done);
 }
 root.prepend(activity);
}
function organizer(){
 const root=$('demo-view'),panel=card('主办方后台 · 演示活动');
 panel.append(el('div','row',el('span','tag','报名人数 1'),el('span','tag',model.stage>=3?'资料通过 1':'资料通过 0'),el('span','tag green',model.checked?'签到人数 1':'签到人数 0')));
 panel.append(p('模拟三个现场核验窗口并行使用同一服务端核销状态。此演示只能在当前浏览器模拟，不能跨设备共享。'));
 const item=el('div','item');
 item.append(el('h3','','测试学生 A · TEST-001'),p('示例附件：演示证明图片（虚构，不实际存储）'));
 item.append(p('审核：'+(model.stage>=3?'已通过':model.stage===2?'待审核':'等待提交材料')));
 if(model.stage===2){
   item.append(row(button('模拟审核通过',()=>{model.approved=true;model.stage=3;draw();}),
     button('模拟驳回',()=>{model.reviewNote='演示：需补充材料';model.stage=1;draw();},'danger')));
 }else if(model.stage>=3)item.append(el('div','tag green','已审核通过'));
 else item.append(p('学生尚未完成模拟报名及附件提交。'));
 panel.append(item);
 if(model.stage===4){
   const c=el('div','item');
   c.append(el('h3','','现场快速核验'));
   c.append(p('模拟工作人员读到学生手机上的演示码，点击核销。不读取真实摄像头或支付/校园码。'));
   c.append(button('模拟扫码并完成核销',()=>{if(!model.checked){model.checked=true;model.stage=6;draw();}}));
   panel.append(c);
 }
 if(model.stage===6){
   const c=el('div','item');
   c.append(el('div','success-large','✓ 模拟核销成功'));
   c.append(p('已模拟防重复核销：再次点击不应产生第二条记录。'));
   c.append(button('再次模拟核销（检查防重复）',()=>{showMessage('已核销：重复提交被拒绝','error');},'secondary'));
   c.append(button('下载模拟 CSV',downloadCSV));
   panel.append(c);
 }
 root.append(panel);
}
function showMessage(message,kind){
 let notice=$('flow-notice');if(!notice){notice=el('div','notice');notice.id='flow-notice';$('demo-view').prepend(notice);}
 notice.textContent=message;notice.className='notice '+kind;
}
function downloadCSV(){
 const text='\uFEFF"姓名","学号","资料审核","签到情况"\r\n"测试学生 A","TEST-001","通过","已核销（演示）"\r\n';
 const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='活动速签-模拟名单.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function draw(){
 roles();
 const root=$('demo-view');root.replaceChildren();
 root.append(timeline());
 if(model.role==='student')student();else organizer();
 const bottom=card('说明与重置');
 bottom.append(p('当前是面向公众的交互展示。真实 Web API、SQLite 原子扫码及权限测试位于 Ubuntu 开发版，尚未部署到 Cloudflare。'));
 bottom.append(button('重置演示流程',()=>{Object.assign(model,{stage:0,approved:false,checked:false,ticket:null,uploaded:false,reviewNote:''});draw();},'secondary'));
 root.append(bottom);
}
$('student-tab').onclick=()=>{model.role='student';draw();};
$('organizer-tab').onclick=()=>{model.role='organizer';draw();};
draw();
