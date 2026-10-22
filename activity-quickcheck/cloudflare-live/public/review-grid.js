/* Authorized staff-only evidence review sheet. All text uses textContent:
 * never place self-declared student content in innerHTML or analytics. */
(function(root){
  'use strict';
  const node=(tag,className='',text='')=>{
    const n=document.createElement(tag);
    if(className)n.className=className;
    if(text!==undefined)n.textContent=String(text);
    return n;
  };
  function createSelection(ids=[]){
    const selected=new Set(),decisions=new Map();
    let last=-1;
    const exists=new Set(ids);
    function choose(index,checked,shift=false){
      if(index<0||index>=ids.length)return;
      const begin=shift&&last>=0?Math.min(index,last):index;
      const end=shift&&last>=0?Math.max(index,last):index;
      for(let i=begin;i<=end;i++){
        const id=ids[i];
        if(checked)selected.add(id);
        else {selected.delete(id);decisions.delete(id);}
      }
      last=index;
    }
    function all(value){
      selected.clear();if(!value)decisions.clear();
      else ids.forEach(id=>selected.add(id));
      last=-1;
    }
    function setDecision(id,value){
      if(!exists.has(id))return;
      if(value==='approved'||value==='rejected'){
        selected.add(id);decisions.set(id,value);
      }else decisions.delete(id);
    }
    function setApproval(id,checked){setDecision(id,checked?'approved':null);}
    function setRejection(id,checked){setDecision(id,checked?'rejected':null);}
    return Object.freeze({
      choose,all,setApproval,setRejection,setDecision,
      get selected(){return new Set(selected);},
      get approved(){return new Set([...decisions].filter(([,v])=>v==='approved').map(([id])=>id));},
      get rejected(){return new Set([...decisions].filter(([,v])=>v==='rejected').map(([id])=>id));},
      get unassigned(){return [...selected].filter(id=>!decisions.has(id)).length;},
      get length(){return selected.size;},
      decisions(reasonFor){
        return ids.filter(id=>selected.has(id)&&decisions.has(id)).map(id=>({
          registrationId:id,state:decisions.get(id),
          reason:String(reasonFor(id)||'').slice(0,300)
        }));
      }
    });
  }
  function mount({root:target,rows,eventId,request,notify,onCommitted,aiAvailable=false}){
    const pending=rows.filter(r=>r.state==='pending');
    const selectable=pending.map(r=>r.id);
    const selection=createSelection(selectable);
    const reasonInputs=new Map(),selectorInputs=new Map(),approvedInputs=new Map(),rejectedInputs=new Map();
    const materialCache=new Map(),ordered=rows.filter(r=>r.material_count>0);
    const aiEligible=ordered.filter(r=>Boolean(r.ai_consent));
    let paneIndex=-1,imageIndex=0,closed=false,aiBusy=false;
    const shell=node('div','review-workspace');
    const sheet=node('section','review-sheet');
    const title=node('div','review-toolbar');
    title.append(node('h3','', '报名材料审核总表'),
      node('p','muted','点击图片在右侧预览；Shift+点击可连续多选。每条选中记录必须在「通过」或「驳回」两列明确勾选其一；两列互斥，未选择的报名绝不会被驳回。'));
    const toolbar=node('div','review-actions');
    const allBox=node('input');allBox.type='checkbox';allBox.setAttribute('aria-label','全选待审');
    const selectLabel=node('label','check');selectLabel.append(allBox,node('span','','全选待审'));
    const count=node('span','tag','本次待处理 0');
    toolbar.append(selectLabel,count);
    const markGood=node('button','secondary','所选设为通过');
    const markBad=node('button','secondary','所选设为驳回');
    const submit=node('button','','确认提交审核结果');
    const refresh=node('button','secondary','刷新表格');
    toolbar.append(markGood,markBad,submit,refresh);
    title.append(toolbar);
    // The AI entry must be discoverable before anyone clicks a picture.
    const aiPanel=node('div','review-ai-panel');
    const aiTitle=node('strong','',aiAvailable?'🤖 DeepSeek AI 辅助审核 · 已连接':'🤖 DeepSeek AI 辅助审核 · 未配置');
    const aiExplanation=node('p','muted',
      '当前报名 '+rows.length+' 条，上传图片 '+ordered.length+' 条，学生已授权 AI '+aiEligible.length+
      ' 条。AI 只识别可见点赞数，不自动批准报名。');
    const aiRun=node('button','secondary','识别已授权的报名截图');
    aiRun.disabled=!aiAvailable||!aiEligible.length;
    const aiActivity=node('p','muted',!aiAvailable?
      '尚未配置 DeepSeek API Key，可以继续人工审核。':
      !ordered.length?'暂无上传图片：请学生先打开自己的活动报名页，从手机相册选择截图并上传。':
      !aiEligible.length?'已有图片，但学生尚未勾选 AI 分析授权；请学生在自己的报名页开启授权。':
      '可以直接点击上方按钮识别；也可点击表格的“图片”查看证据后再识别。');
    aiActivity.setAttribute('role','status');
    aiActivity.setAttribute('aria-live','polite');
    aiPanel.append(aiTitle,aiExplanation,aiRun,aiActivity);
    title.append(aiPanel);
    const frame=node('div','review-scroll');
    const table=node('table','review-table');
    const head=node('thead');const headRow=node('tr');
    for(const t of ['选中','序号','报名者（自填）','自填学号','审核状态','材料','到场','报名说明','通过 ✓','驳回 ✕','驳回意见'])headRow.append(node('th','',t));
    head.append(headRow);table.append(head);
    const body=node('tbody');table.append(body);frame.append(table);
    sheet.append(title,frame);
    const pane=node('aside','review-preview');
    const caption=node('h3','','图片证据预览');
    const close=node('button','secondary','× 关闭');close.setAttribute('aria-label','关闭图片预览');
    const previewBar=node('div','row between');previewBar.append(caption,close);
    const who=node('p','review-preview-who muted','点击材料列查看图片');
    const photo=node('img','review-preview-photo');photo.alt='供审核员核对的材料截图';
    const footer=node('div','row between');
    const prev=node('button','secondary','← 上一张'),next=node('button','secondary','下一张 →');
    const progress=node('span','tag','0 / 0');
    footer.append(prev,progress,next);
    const aiButton=node('button','secondary','DeepSeek 辅助识别点赞数');
    const aiStatus=node('p','muted','选择报名图片后，可在取得学生授权时发起 AI 辅助审核。');
    aiButton.disabled=true;
    pane.append(previewBar,who,photo,footer,aiButton,aiStatus);
    pane.hidden=true;
    shell.append(sheet,pane);target.append(shell);
    function update(){
      const ids=selection.selected,approved=selection.approved,rejected=selection.rejected;
      count.textContent='本次选中 '+ids.size+'，通过 '+approved.size+
        '，驳回 '+rejected.size+'，未做决定 '+selection.unassigned;
      allBox.checked=ids.size===selectable.length&&ids.size>0;
      allBox.indeterminate=ids.size>0&&ids.size<selectable.length;
      for(const [id,input] of selectorInputs)input.checked=ids.has(id);
      for(const [id,input] of approvedInputs)input.checked=approved.has(id);
      for(const [id,input] of rejectedInputs)input.checked=rejected.has(id);
      submit.disabled=!ids.size||selection.unassigned>0;
      markGood.disabled=!ids.size;markBad.disabled=!ids.size;
    }
    pending.forEach((r,index)=>{selectorInputs.set(r.id,null);});
    for(let i=0;i<rows.length;i++){
      const r=rows[i],tr=node('tr',r.state==='pending'?'':'review-processed');
      const cell=(value,cls='')=>{const td=node('td',cls);if(value instanceof Node)td.append(value);else td.textContent=String(value??'');tr.append(td);return td;};
      if(r.state==='pending'){
        const select=node('input');select.type='checkbox';select.setAttribute('aria-label','选择第 '+(i+1)+' 行 '+r.display_name);
        const index=selectable.indexOf(r.id);
        select.addEventListener('click',event=>{selection.choose(index,select.checked,event.shiftKey);update();});
        selectorInputs.set(r.id,select);cell(select);
      }else cell('—');
      cell(i+1,'review-line-number');cell(r.display_name);cell(r.student_number);
      cell(r.state==='pending'?'待审核':r.state==='approved'?'已通过':'已驳回');
      const view=node('button','secondary review-view',r.material_count?'图片 '+r.material_count+' 张':'无材料');
      view.disabled=!r.material_count;
      view.addEventListener('click',()=>{void showFor(r.id).catch(error=>notify(error.message,'error'));});
      cell(view);cell(r.attended_at?'已到场'+(r.channel==='manual'?'（人工）':''):'未到场');
      cell(r.note||'—','review-note');
      if(r.state==='pending'){
        const approval=node('input');approval.type='checkbox';approval.setAttribute('aria-label','通过第 '+(i+1)+' 行');
        approval.addEventListener('change',()=>{selection.setApproval(r.id,approval.checked);update();});
        approvedInputs.set(r.id,approval);cell(approval);
        const rejection=node('input');rejection.type='checkbox';
        rejection.setAttribute('aria-label','驳回第 '+(i+1)+' 行');
        rejection.addEventListener('change',()=>{
          selection.setRejection(r.id,rejection.checked);update();
        });
        rejectedInputs.set(r.id,rejection);cell(rejection);
        const reason=node('input');reason.type='text';reason.maxLength=300;
        reason.placeholder='驳回时说明原因，学生可据此重新报名';
        reason.setAttribute('aria-label','第 '+(i+1)+' 行驳回原因');
        reasonInputs.set(r.id,reason);cell(reason,'review-reason');
      }else{cell('—');cell('—');cell('—');}
      body.append(tr);
    }
    async function materials(row){
      if(!materialCache.has(row.id)){
        const result=await request('/api/events/'+eventId+'/materials?registrationId='+encodeURIComponent(row.id));
        materialCache.set(row.id,result.materials||[]);
      }
      return materialCache.get(row.id);
    }
    async function showFor(id){
      const idx=ordered.findIndex(x=>x.id===id);
      if(idx<0)return;
      paneIndex=idx;imageIndex=0;pane.hidden=false;
      await show();
    }
    async function show(){
      if(closed||paneIndex<0||paneIndex>=ordered.length)return;
      const row=ordered[paneIndex],images=await materials(row);
      aiButton.disabled=!aiAvailable||!row.ai_consent||!images.length||aiBusy;
      aiStatus.textContent=!aiAvailable?'DeepSeek API 暂未配置；可继续人工审核。':
        row.ai_consent?'学生已同意第三方图片分析；建议先人工查看图片再进行识别。':
        '学生未同意第三方 AI 分析；可直接人工审核。';
      if(!images.length){who.textContent=row.display_name+'：暂无有效材料';photo.removeAttribute('src');return;}
      imageIndex=Math.min(images.length-1,Math.max(0,imageIndex));
      const pic=images[imageIndex];
      who.textContent='第 '+(rows.indexOf(row)+1)+' 行 · '+row.display_name+' · 自填学号 '+row.student_number;
      progress.textContent=(imageIndex+1)+' / '+images.length+' · 可切换报名者';
      photo.src='/api/materials/'+encodeURIComponent(pic.id);
    }
    async function advance(dir){
      if(!ordered.length||paneIndex<0)return;
      const here=await materials(ordered[paneIndex]);
      if(imageIndex+dir>=0&&imageIndex+dir<here.length){imageIndex+=dir;return show();}
      for(let tries=0;tries<ordered.length;tries++){
        paneIndex=(paneIndex+dir+ordered.length)%ordered.length;
        const list=await materials(ordered[paneIndex]);
        if(list.length){imageIndex=dir>0?0:list.length-1;return show();}
      }
    }
    async function runAi(row){
      if(closed||aiBusy||!aiAvailable||!row||!row.ai_consent||!row.material_count)return;
      aiBusy=true;aiButton.disabled=true;aiRun.disabled=true;
      aiStatus.textContent='正在向 DeepSeek 发送已获授权的材料，请稍候…';
      aiActivity.textContent='AI 正在识别该条报名的可见点赞数，请稍候（仍需人工确认）。';
      try{
        const result=await request('/api/events/'+eventId+'/ai-review',{
          method:'POST',data:{registrationId:row.id}});
        if(closed)return;
        const advice=result.advice||{};
        const count=Number.isInteger(advice.visibleLikeCount)?
          String(advice.visibleLikeCount)+'赞':'无法可靠识别';
        const threshold=Number.isInteger(advice.minimumLikes)?
          String(advice.minimumLikes)+'赞':'本活动未设置固定门槛';
        const match=advice.thresholdMet===true?'达到可见点赞门槛':
          advice.thresholdMet===false?'低于可见点赞门槛':'无法确定是否满足门槛';
        const caveats=Array.isArray(advice.concerns)?advice.concerns.join('；'):'';
        const summary='AI识别：'+count+'；门槛：'+threshold+'；'+match+
          '。可见证据：'+String(advice.visibleEvidence||'未说明')+
          (caveats?'；疑点：'+caveats:'')+
          '。结果仅供参考，无法确认截图真伪或本人身份；必须由工作人员手动提交审核决定。';
        aiActivity.textContent=summary;
        if(row===ordered[paneIndex])aiStatus.textContent=summary;
      }catch(e){
        const reason='AI 辅助识别未完成：'+(e.message||'请人工审核');
        aiActivity.textContent=reason;
        if(row===ordered[paneIndex])aiStatus.textContent=reason;
      }finally{
        aiBusy=false;
        aiRun.disabled=!aiAvailable||!aiEligible.length||closed;
        if(!closed&&paneIndex>=0){
          const current=ordered[paneIndex];
          aiButton.disabled=!aiAvailable||!current?.ai_consent||!current?.material_count;
        }
      }
    }
    aiButton.addEventListener('click',()=>{void runAi(ordered[paneIndex]);});
    aiRun.addEventListener('click',async()=>{
      if(closed||aiBusy||!aiAvailable)return;
      const row=aiEligible.find(x=>selection.selected.has(x.id))||aiEligible[0];
      if(!row)return;
      aiRun.disabled=true;
      try{await showFor(row.id);await runAi(row);}
      catch(e){aiActivity.textContent='无法打开报名图片：'+(e.message||'请刷新页面');}
      finally{if(!aiBusy&&!closed)aiRun.disabled=!aiEligible.length;}
    });
    prev.addEventListener('click',()=>advance(-1).catch(e=>notify(e.message,'error')));
    next.addEventListener('click',()=>advance(1).catch(e=>notify(e.message,'error')));
    close.addEventListener('click',()=>{pane.hidden=true;paneIndex=-1;photo.removeAttribute('src');});
    const keys=event=>{
      if(pane.hidden||closed)return;
      if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
      if(event.key==='ArrowRight'){event.preventDefault();void advance(1).catch(e=>notify(e.message,'error'));}
      if(event.key==='ArrowLeft'){event.preventDefault();void advance(-1).catch(e=>notify(e.message,'error'));}
      if(event.key==='Escape')close.click();
    };
    document.addEventListener('keydown',keys);
    allBox.addEventListener('change',()=>{selection.all(allBox.checked);update();});
    markGood.addEventListener('click',()=>{for(const id of selection.selected)selection.setDecision(id,'approved');update();});
    markBad.addEventListener('click',()=>{for(const id of selection.selected)selection.setDecision(id,'rejected');update();});
    submit.addEventListener('click',async()=>{
      if(selection.unassigned){
        notify('仍有 '+selection.unassigned+' 条已选报名没有勾选通过或驳回，请先明确决定。','error');
        return;
      }
      const decisions=selection.decisions(id=>reasonInputs.get(id)?.value);
      if(!decisions.length)return;
      const emptyReason=decisions.find(x=>x.state==='rejected'&&!x.reason.trim());
      if(emptyReason){notify('请先为每条驳回填写意见，方便学生重新填报。','error');return;}
      const approves=decisions.filter(x=>x.state==='approved').length;
      const rejects=decisions.length-approves;
      if(!window.confirm('确认提交 '+decisions.length+' 条审核结果？通过 '+approves+' 条，驳回 '+rejects+' 条。提交后将立即生效。'))return;
      submit.disabled=true;
      try{
        const result=await request('/api/events/'+eventId+'/review-batch',{method:'POST',data:{decisions}});
        notify('已完成 '+result.reviewed+' 条审核，逐条写入审计记录。','success');
        closed=true;document.removeEventListener('keydown',keys);
        await onCommitted();
      }catch(e){notify(e.message||'提交失败，请刷新核对','error');update();}
    });
    refresh.addEventListener('click',()=>{
      if(selection.length&&!window.confirm('尚有未提交的勾选。确定放弃并刷新审核队列？'))return;
      closed=true;document.removeEventListener('keydown',keys);onCommitted();
    });
    update();
    return ()=>{closed=true;document.removeEventListener('keydown',keys);};
  }
  root.BombaxReviewGrid=Object.freeze({createSelection,mount});
})(window);
