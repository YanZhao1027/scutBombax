import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../cloudflare-live/public/review-grid.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../cloudflare-live/public/app.js',import.meta.url),'utf8');
class FakeNode{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.attributes=new Map();
    this.className='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;this.value='';}
  append(...children){this.children.push(...children);return this;}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  removeAttribute(key){this.attributes.delete(key);}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  removeEventListener(type){this.listeners.delete(type);}
  async click(){return this.listeners.get('click')?.({shiftKey:false,preventDefault(){}});}
}
const visit=(node,results=[])=>{
  results.push(node);
  for(const child of node.children||[])if(child instanceof FakeNode)visit(child,results);
  return results;
};
function fixture(rows,{aiAvailable=true}={}){
  const document={
    createElement:(tag)=>new FakeNode(tag),
    addEventListener(){},
    removeEventListener(){},
    activeElement:null
  };
  const window={confirm:()=>true};
  vm.runInNewContext(source,{window,document,Node:FakeNode});
  const root=new FakeNode('div'),apiCalls=[];
  const request=async(path,options)=>{
    apiCalls.push({path,options});
    if(path.includes('/materials?'))return {materials:[{id:'ea4c5cfa-18e8-41e8-aaf0-0812a5f49099'}]};
    if(path.endsWith('/ai-review'))return {advice:{visibleLikeCount:38,minimumLikes:28,
      thresholdMet:true,suggestedDecision:'approved',suggestedReason:'38赞达到28赞门槛',visibleEvidence:'图像中可见赞数 38',concerns:['截图真实性未验证']}};
    throw new Error('unexpected API call: '+path);
  };
  const dispose=window.BombaxReviewGrid.mount({
    root,rows,eventId:'test-event',request,aiAvailable,notify:()=>{},onCommitted:()=>{}
  });
  const all=visit(root);
  const panel=all.find(x=>x.className==='review-ai-panel');
  const button=all.find(x=>x.tagName==='BUTTON'&&x.textContent==='识别已授权的报名截图');
  const status=all.find(x=>x.attributes.get('role')==='status');
  return {root,apiCalls,dispose,panel,button,status};
}
const row=(opts={})=>({
  id:'abc',updated_at:123456789,display_name:'学生（自填）',student_number:'2025012345',state:'pending',
  material_count:0,ai_consent:0,note:'',...opts
});
test('DeepSeek entry is visible without a picture, but disabled and explains missing evidence',()=>{
  const f=fixture([row()]);
  assert.ok(f.panel,'AI launch panel must be visible in review toolbar');
  assert.equal(f.panel.hidden,false);
  assert.equal(f.button.disabled,true);
  assert.match(f.status.textContent,/暂无上传图片/);
  assert.equal(f.apiCalls.length,0);
  f.dispose();
});
test('uploaded photo without student consent has a visible disabled AI action',()=>{
  const f=fixture([row({material_count:1})]);
  assert.equal(f.button.disabled,true);
  assert.match(f.status.textContent,/尚未勾选 AI 分析授权/);
  assert.equal(f.apiCalls.length,0);
  f.dispose();
});
test('configured DeepSeek opens permitted image, calls advisory API and does not approve anything',async()=>{
  const f=fixture([row({material_count:1,ai_consent:1})]);
  assert.equal(f.button.disabled,false);
  assert.equal(f.apiCalls.length,0,'mounting toolbar does not send student image');
  await f.button.click();
  assert.equal(f.apiCalls.filter(x=>x.path.endsWith('/ai-review')).length,1);
  assert.match(f.status.textContent,/AI识别：38赞/);
  assert.match(f.status.textContent,/达到可见点赞门槛/);
  assert.match(f.status.textContent,/工作人员手动提交审核决定/);
  assert.equal(f.apiCalls.filter(x=>x.path.includes('/review-batch')).length,0);
  f.dispose();
});
test('AI entry indicates missing key and forbids calls',async()=>{
  const f=fixture([row({material_count:1,ai_consent:1})],{aiAvailable:false});
  assert.equal(f.button.disabled,true);
  assert.match(f.status.textContent,/未配置/);
  assert.equal(f.apiCalls.length,0);
  f.dispose();
});
test('staff app visibly links owner dashboard to AI and passes readiness to reviewer',()=>{
  assert.match(app,/DeepSeek 图片辅助审核 · /);
  assert.match(app,/进入材料审核 \/ AI 识别/);
  assert.match(app,/aiAvailable:app\.aiReviewAvailable/);
  assert.match(app,/保存点赞门槛/);
  assert.match(app,/\/review-settings/);
});
