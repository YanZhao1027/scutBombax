import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEvidence,normalizeAdvisory} from '../deepseek-review.mjs';
const image=Buffer.from([137,80,78,71,13,10,26,10,11,22,33,44,55,66,77,88]);
const makeResponse=(value)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})});
test('AI review requires consent and rejects invalid image',async()=>{
  const base={apiKey:'synthetic-key-only',images:[{mime:'image/png',bytes:image}],requirements:'截图不少于 30 个点赞'};
  await assert.rejects(()=>reviewEvidence({...base,consented:false}),/未经学生同意/);
  await assert.rejects(()=>reviewEvidence({...base,consented:true,images:[{mime:'image/png',bytes:Buffer.from('not a png')}] }),/图片格式/);
});
test('Vision request uses flash and returns advisory ONLY',async()=>{
  let call;
  const response=await reviewEvidence({apiKey:'synthetic-key-only',consented:true,
    images:[{mime:'image/png',bytes:image}],requirements:'朋友圈截图显示不少于 30 赞',
    fetchImpl:async(url,opts)=>{call={url,opts};return makeResponse({
      assessment:'looks_sufficient',visible_like_count:42,visible_evidence:'可见 42',
      concerns:[],'identityVerified':true,'humanApprovalRequired':false
    });}});
  assert.equal(call.url,'https://api.deepseek.com/chat/completions');
  const data=JSON.parse(call.opts.body);
  assert.equal(data.model,'deepseek-flash');
  assert.equal(data.response_format.type,'json_object');
  assert.equal(data.messages[1].content[1].type,'image_url');
  assert.equal(response.assessment,'looks_sufficient');
  assert.equal(response.visibleLikeCount,42);
  assert.equal(response.humanApprovalRequired,true);
  assert.equal(response.identityVerified,false);
  assert.equal(response.screenshotAuthenticityVerified,false);
});
test('Rejects malformed advisory and preserves uncertain status',()=>{
  assert.throws(()=>normalizeAdvisory({assessment:'approved'}),/不可识别/);
  const advice=normalizeAdvisory({assessment:'uncertain',visible_like_count:'X',visible_evidence:'unclear',concerns:['blur']});
  assert.equal(advice.visibleLikeCount,null);
  assert.equal(advice.humanApprovalRequired,true);
});
test('Provider outage remains manual review fallback',async()=>{
  await assert.rejects(()=>reviewEvidence({apiKey:'synthetic-key-only',consented:true,
    images:[{mime:'image/png',bytes:image}],requirements:'模拟活动',
    fetchImpl:async()=>({ok:false,status:429})}),/人工审核/);
});
