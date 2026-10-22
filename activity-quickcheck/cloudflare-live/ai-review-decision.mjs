/* Strict adapter between untrusted vision-model JSON and review suggestions.
 * Never let model text execute a database decision or override event criteria.
 * A recommendation only pre-selects staff UI. Human confirmation is mandatory.
 */
const assessments=new Set(['looks_sufficient','looks_insufficient','uncertain']);
const qualities=new Set(['clear','unclear','missing']);
export function normalizeVisionAdvice(raw,minLikes){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     !assessments.has(raw.assessment)){
    throw new TypeError('AI result has invalid assessment');
  }
  const threshold=Number.isInteger(minLikes)&&minLikes>=0&&minLikes<=100000?minLikes:null;
  const count=Number.isSafeInteger(raw.visible_like_count)&&raw.visible_like_count>=0&&
    raw.visible_like_count<100000000?raw.visible_like_count:null;
  // Missing/unknown quality NEVER auto-selects pass/reject.
  const evidenceQuality=qualities.has(raw.evidence_quality)?raw.evidence_quality:'unclear';
  const thresholdMet=threshold===null||count===null?null:count>=threshold;
  let suggestedDecision='uncertain';
  if(evidenceQuality==='clear'&&thresholdMet===true&&raw.assessment==='looks_sufficient'){
    suggestedDecision='approved';
  }else if(evidenceQuality==='clear'&&thresholdMet===false&&raw.assessment==='looks_insufficient'){
    suggestedDecision='rejected';
  }
  const evidence=typeof raw.visible_evidence==='string'?raw.visible_evidence.slice(0,300):'';
  const concerns=Array.isArray(raw.concerns)?raw.concerns
    .filter(x=>typeof x==='string').slice(0,5).map(x=>x.slice(0,120)):[];
  const suggestedReason=suggestedDecision==='approved'?
    '可见点赞数 '+count+' 达到活动门槛 '+threshold+'，请人工核对截图后确认。':
    suggestedDecision==='rejected'?
    '截图可见点赞数 '+count+'，未达到本活动要求的 '+threshold+' 赞。':
    threshold===null?
    '活动未设置最低点赞数，需人工复核。':
    count===null?
    '截图点赞数无法可靠辨认，需人工复核。':
    evidenceQuality!=='clear'?
    '截图证据不清晰或有歧义，需人工复核。':
    '模型判断与活动点赞门槛不一致，需人工复核。';
  return {
    assessment:raw.assessment,visibleLikeCount:count,minimumLikes:threshold,
    thresholdMet,evidenceQuality,visibleEvidence:evidence,concerns,
    suggestedDecision,suggestedReason,humanApprovalRequired:true,
    identityVerified:false,screenshotAuthenticityVerified:false,model:'deepseek-flash'
  };
}
