/* Owner-only spreadsheet for granting/revoking 3 independent event duties.
 * The service returns only staff public labels, never password hashes. */
(function(root){
'use strict';
const dutyNames=[['reviewer','材料审核'],['scanner','扫码核销'],['manual','人工确认']];
function diff(original,draft){
 return [...draft].filter(x=>!original.has(x)).length+
   [...original].filter(x=>!draft.has(x)).length;
}
function mount({root:target,eventId,request,notify}){
 const wrap=document.createElement('div');wrap.className='staff-permissions-workspace';
 const intro=document.createElement('p');
 intro.textContent='直接勾选每位测试工作人员的岗位；同一账号可以拥有多个岗位。活动负责人固定拥有全部权限且不可修改。修改后需点击“保存岗位授权”，取消勾选会撤销该岗位的服务端权限。';
 const actions=document.createElement('div');actions.className='review-actions';
 const summary=document.createElement('span');summary.className='tag';
 const submit=document.createElement('button');submit.type='button';submit.textContent='保存岗位授权';
 const reload=document.createElement('button');reload.type='button';reload.className='secondary';reload.textContent='重新载入';
 actions.append(summary,submit,reload);
 const scrolling=document.createElement('div');scrolling.className='review-scroll';
 const table=document.createElement('table');table.className='review-table staff-roles-table';
 const thead=document.createElement('thead'),tr=document.createElement('tr');
 for(const h of ['序号','工作人员用户名','姓名 / 标注','负责人','材料审核 ✓','扫码核销 ✓','人工确认 ✓','状态']){
  const th=document.createElement('th');th.textContent=h;tr.append(th);
 }
 thead.append(tr);table.append(thead);const tbody=document.createElement('tbody');
 table.append(tbody);scrolling.append(table);
 wrap.append(intro,actions,scrolling);target.append(wrap);
 let original=new Map(),draft=new Map(),locked=false,removed=false;
 const addCell=(row,value)=>{
   const cell=document.createElement('td');
   if(value instanceof Node)cell.append(value);
   else cell.textContent=String(value??'');
   row.append(cell);return cell;
 };
 function changes(){
   return [...draft].filter(([id,roles])=>diff(original.get(id)||new Set(),roles)>0)
     .map(([userId,duties])=>({userId,duties:[...duties].sort()}));
 }
 function refreshBadge(){
   const list=changes();
   summary.textContent='已修改 '+list.length+' 名工作人员（未保存）';
   submit.disabled=locked||!list.length;
 }
 async function populate(){
   locked=true;submit.disabled=true;
   const result=await request('/api/events/'+eventId+'/staff-roles');
   original=new Map();draft=new Map();tbody.replaceChildren();
   let index=0;
   for(const account of result.accounts||[]){
     index++;
     const fixed=Boolean(account.owner);
     const current=new Set(fixed?dutyNames.map(x=>x[0]):(account.duties||[]));
     original.set(account.id,new Set(current));draft.set(account.id,current);
     const row=document.createElement('tr');
     addCell(row,index);addCell(row,account.username);addCell(row,account.display_name);
     addCell(row,fixed?'负责人（固定）':'工作人员');
     const label=document.createElement('span');label.className='tag';label.textContent=fixed?'不可修改':'未更改';
     const checkboxes=[];
     for(const [duty,title] of dutyNames){
       const input=document.createElement('input');input.type='checkbox';
       input.checked=current.has(duty);input.disabled=fixed;
       input.setAttribute('aria-label',account.username+' · '+title);
       input.addEventListener('change',()=>{
         if(input.checked)current.add(duty);else current.delete(duty);
         label.textContent=diff(original.get(account.id),current)>0?'等待保存':'未更改';
         refreshBadge();
       });
       checkboxes.push(input);addCell(row,input);
     }
     addCell(row,label);
     tbody.append(row);
   }
   locked=false;refreshBadge();
 }
 submit.addEventListener('click',async()=>{
   const assignments=changes();
   if(!assignments.length)return;
   if(!window.confirm('确认修改 '+assignments.length+' 名工作人员的岗位？取消勾选将立即撤销对应授权。'))return;
   locked=true;submit.disabled=true;
   try{
     const saved=await request('/api/events/'+eventId+'/staff-roles',{
       method:'POST',data:{assignments}
     });
     notify('岗位授权已保存：'+saved.updated+' 名工作人员。','success');
     await populate();
   }catch(error){notify(error.message||'岗位保存失败','error');locked=false;refreshBadge();}
 });
 reload.addEventListener('click',()=>{
   if(changes().length&&!window.confirm('存在未保存的授权修改，确认放弃后刷新？'))return;
   populate().catch(error=>notify(error.message,'error'));
 });
 populate().catch(error=>notify(error.message,'error'));
 return ()=>{removed=true;wrap.remove();};
}
root.BombaxStaffRoles=Object.freeze({mount,diff});
})(window);
