/* Organizer/reviewer-only spreadsheet UI. Every change waits for explicit commit.
 * This file is loaded only by /admin/; backend always enforces staff permissions.
 */
(function(root){
  'use strict';
  const n=(tag,cls,txt)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(txt!==undefined)node.textContent=String(txt);
    return node;
  };
  const btn=(txt,fn,cls='')=>{
    const x=n('button',cls,txt);x.type='button';
    x.addEventListener('click',()=>void fn());
    return x;
  };
  async function render({slot,rows,event,api,notify,reload}){
    const pending=rows.filter(x=>x.state==='pending');
    slot.replaceChildren();
    slot.append(n('p','review-help','按表格顺序审核：单击材料在右侧预览，Shift 连选，勾选“通过”或选择“驳回”，最后确认提交。未确认的决定不会写入服务器。'));
    const selected=new Set(),decisions=new Map(),reasonInputs=new Map(),checks=new Map(),rowNodes=new Map();
    let lastIndex=-1,submitting=false,photoIndex=0,currentRow=-1,previewRun=0;
    const photoCache=new Map();
    const actionbar=n('div','review-toolbar');
    const counter=n('strong','review-counter','已选择 0 条 / 待审核 '+pending.length+' 条');
    const selectAll=btn('全选待审核',()=>{
      for(const [idx,row] of pending.entries()){selected.add(row.id);checks.get(row.id).checked=true;}
      update();
    },'secondary');
    const clear=btn('清空选择',()=>{
      selected.clear();decisions.clear();
      for(const c of checks.values())c.checked=false;
      update();
    },'secondary');
    function assignDecision(state){
      if(!selected.size){notify('请先选择需要处理的报名','error');return;}
      let unavailable=0;
      for(const row of pending){
        if(!selected.has(row.id))continue;
        if(state==='approved'&&event.require_photo&&row.material_count===0){unavailable++;continue;}
        decisions.set(row.id,state);
      }
      update();
      if(unavailable)notify(unavailable+' 条无材料报名不能标记通过，请驳回或等待补交','error');
    }
    const markApprove=btn('选中 → ✓ 通过',()=>assignDecision('approved'));
    const markReject=btn('选中 → 驳回',()=>assignDecision('rejected'),'danger');
    const commit=btn('确认提交（0）',async()=>{
      if(submitting)return;
      const pendingUpdates=pending.filter(x=>selected.has(x.id)&&decisions.has(x.id));
      if(!pendingUpdates.length){notify('请先选中并标记审核决定；暂未提交任何结果','error');return;}
      const unmarked=selected.size-pendingUpdates.length;
      if(unmarked){notify('还有 '+unmarked+' 条已选中但没有审核决定；请先打勾或驳回','error');return;}
      if(!root.confirm('确认将 '+pendingUpdates.length+' 条报名审核结果写入服务器？此操作由授权人员执行。'))return;
      submitting=true;commit.disabled=true;
      const results=[];
      try{
        // Explicit per-row server results. If a network problem interrupts
        // the operation, NEVER claim that all records were processed.
        for(let i=0;i<pendingUpdates.length;i+=60){
          const part=pendingUpdates.slice(i,i+60);
          const res=await api('/api/events/'+event.id+'/review-batch',{
            method:'POST',
            data:{decisions:part.map(row=>({
              registrationId:row.id,updatedAt:row.updated_at,
              state:decisions.get(row.id),
              reason:reasonInputs.get(row.id)?.value.trim()||
                (decisions.get(row.id)==='rejected'?'未达到活动要求，请补交证明材料':'')
            }))}
          });
          results.push(...res.results);
        }
      }catch(error){
        const nOk=results.filter(x=>x.ok).length;
        notify('网络错误：已确认完成 '+nOk+' 条，其他状态未知。请刷新核查，不要直接重复批量提交。'+(error.message||''),'error');
        return;
      }finally{
        submitting=false;commit.disabled=false;
      }
      const ok=results.filter(x=>x.ok),bad=results.filter(x=>!x.ok);
      for(const item of ok){selected.delete(item.registrationId);decisions.delete(item.registrationId);}
      if(bad.length){
        for(const item of bad){
          const row=rowNodes.get(item.registrationId);
          if(row){row.dataset.failed='true';row.title=item.error||'审核失败';}
        }
        notify('已成功 '+ok.length+' 条，失败 '+bad.length+' 条。失败行已标红，请刷新后处理冲突。','error');
      }else notify('已确认提交 '+ok.length+' 条审核结果，服务器已逐条记录。','success');
      await reload();
    });
    actionbar.append(counter,selectAll,clear,markApprove,markReject,commit);
    slot.append(actionbar);
    const wrap=n('div','review-workspace');
    const left=n('div','review-sheet-scroll');
    const table=n('table','review-sheet');
    const header=n('thead');const headRow=n('tr');
    for(const label of ['序号','选择','自填姓名','自填学号','材料','提交／更新','当前状态','✓ 通过','驳回','审核说明']){
      const th=n('th',null,label);th.scope='col';headRow.append(th);
    }
    header.append(headRow);table.append(header);
    const tbody=n('tbody');
    function update(){
      let count=0;
      for(const row of pending){
        const state=decisions.get(row.id);
        const node=rowNodes.get(row.id);
        if(node){
          node.dataset.selected=selected.has(row.id)?'true':'false';
          node.dataset.decision=state||'none';
        }
        if(selected.has(row.id))count++;
        const cell=node?.querySelector('[data-review-approval]');
        if(cell)cell.checked=state==='approved';
      }
      counter.textContent='已选择 '+count+' 条 / 待审核 '+pending.length+' 条';
      commit.textContent='确认提交（'+count+'）';
      commit.disabled=!count||submitting;
    }
    function onSelect(i,checked,shift){
      const begin=shift&&lastIndex>=0?Math.min(i,lastIndex):i;
      const end=shift&&lastIndex>=0?Math.max(i,lastIndex):i;
      for(let x=begin;x<=end;x++){
        const id=pending[x].id;
        if(checked)selected.add(id);
        else{selected.delete(id);decisions.delete(id);}
        checks.get(id).checked=checked;
      }
      lastIndex=i;
      update();
    }
    const preview=n('aside','review-preview');
    const previewHeader=n('div','review-preview-header');
    const previewTitle=n('strong',null,'点击材料查看大图');
    const previewClose=btn('×',()=>hidePreview(),'review-preview-close');
    previewClose.setAttribute('aria-label','关闭材料预览');
    previewHeader.append(previewTitle,previewClose);
    const previewImage=n('img','review-proof');
    previewImage.alt='选中的报名材料图片';previewImage.hidden=true;
    const previewStatus=n('p','review-preview-status','点表格中的“查看图片”即可预览；未经点击不加载私人材料。');
    const previewToolbar=n('div','review-preview-toolbar');
    const prev=btn('← 上一张',()=>void safeNav(-1),'secondary');
    const next=btn('下一张 →',()=>void safeNav(1),'secondary');
    const previewCount=n('span','review-preview-page','');
    previewToolbar.append(prev,previewCount,next);
    preview.append(previewHeader,previewImage,previewStatus,previewToolbar);
    preview.tabIndex=-1;preview.setAttribute('role','dialog');preview.setAttribute('aria-label','材料图片预览');
    preview.hidden=true;
    function hidePreview(){preview.hidden=true;previewImage.hidden=true;previewImage.removeAttribute('src');currentRow=-1;}
    async function getFiles(row){
      if(photoCache.has(row.id))return photoCache.get(row.id);
      const list=await api('/api/events/'+event.id+'/materials?registrationId='+encodeURIComponent(row.id));
      photoCache.set(row.id,list.materials||[]);
      return photoCache.get(row.id);
    }
    async function showPhoto(rowIndex,index=0){
      const seq=++previewRun;
      const row=pending[rowIndex];if(!row)return;
      preview.hidden=false;previewTitle.textContent='材料审核 · 第 '+(rowIndex+1)+' 条 · '+row.display_name;
      previewStatus.textContent='正在加载材料…';previewImage.hidden=true;
      preview.focus({preventScroll:true});
      const files=await getFiles(row);
      if(seq!==previewRun)return;
      if(!files.length){
        previewStatus.textContent='这条报名没有上传图片。';previewCount.textContent='0 / 0';
        currentRow=rowIndex;photoIndex=0;return;
      }
      photoIndex=Math.max(0,Math.min(index,files.length-1));currentRow=rowIndex;
      previewImage.src='/api/materials/'+files[photoIndex].id;
      previewImage.hidden=false;
      previewStatus.textContent='';previewCount.textContent=(photoIndex+1)+' / '+files.length;
    }
    async function safeNav(step){
      try{
        if(currentRow<0)return;
        const files=await getFiles(pending[currentRow]);
        const nextImage=photoIndex+step;
        if(nextImage>=0&&nextImage<files.length){await showPhoto(currentRow,nextImage);return;}
        let i=currentRow+step;
        while(i>=0&&i<pending.length){
          if(pending[i].material_count>0){
            const more=await getFiles(pending[i]);
            if(more.length){await showPhoto(i,step>0?0:more.length-1);return;}
          }
          i+=step;
        }
        previewStatus.textContent='已经到达本次待审核材料的末尾。';
      }catch(error){notify('图片预览失败：'+error.message,'error');}
    }
    preview.addEventListener('keydown',e=>{
      if(e.key==='Escape'){hidePreview();return;}
      if(e.key==='ArrowLeft'){e.preventDefault();void safeNav(-1);}
      if(e.key==='ArrowRight'){e.preventDefault();void safeNav(1);}
    });
    for(const [i,row] of pending.entries()){
      const tr=n('tr');tr.dataset.selected='false';rowNodes.set(row.id,tr);
      const cell=(txt,cls)=>{const c=n('td',cls,txt);tr.append(c);return c;};
      cell(i+1,'review-row-index');
      const choose=n('input');choose.type='checkbox';choose.setAttribute('aria-label','选择第 '+(i+1)+' 条报名');
      checks.set(row.id,choose);
      choose.addEventListener('click',e=>onSelect(i,choose.checked,e.shiftKey));
      cell('',null).append(choose);
      cell(row.display_name,'review-person');
      cell(row.student_number,'review-student-id');
      const materials=cell('',null);
      if(row.material_count>0)materials.append(btn('🖼 '+row.material_count+' 张 · 查看',async()=>{
        try{await showPhoto(i);}catch(e){notify('材料加载失败：'+e.message,'error');}
      },'review-photo-btn'));
      else materials.append(n('span','review-empty','无材料'));
      cell(new Date(row.updated_at).toLocaleString('zh-CN',{hour12:false}),'review-date');
      cell(row.channel==='manual'?'已人工到场待补审':'待审核','review-pending');
      const pass=n('input');
      pass.type='checkbox';pass.setAttribute('data-review-approval','1');
      pass.setAttribute('aria-label','通过第 '+(i+1)+' 条报名');
      pass.addEventListener('change',()=>{
        if(pass.checked&&event.require_photo&&row.material_count===0){
          pass.checked=false;notify('没有材料，不能审核通过','error');return;
        }
        selected.add(row.id);checks.get(row.id).checked=true;
        if(pass.checked)decisions.set(row.id,'approved');
        else decisions.delete(row.id);
        update();
      });
      cell('',null).append(pass);
      cell('',null).append(btn('驳回',()=>{
        selected.add(row.id);checks.get(row.id).checked=true;
        decisions.set(row.id,'rejected');update();
      },'review-reject'));
      const note=n('input','review-note');note.type='text';note.placeholder='意见（可选）';
      note.maxLength=300;note.setAttribute('aria-label','第 '+(i+1)+' 条审核原因');
      reasonInputs.set(row.id,note);cell('',null).append(note);
      tbody.append(tr);
    }
    table.append(tbody);left.append(table);wrap.append(left,preview);slot.append(wrap);
    if(!pending.length)slot.append(n('p','review-empty','当前没有待审核的材料，所有待处理事项已完成。'));
    update();
  }
  root.BombaxReviewGrid=Object.freeze({render});
})(window);
