import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVisionAdvice as decide} from '../cloudflare-live/ai-review-decision.mjs';
const base={assessment:'looks_sufficient',visible_like_count:38,evidence_quality:'clear',visible_evidence:'可见38赞',concerns:[]};
test('clear aligned over threshold suggests approve',()=>{
  assert.equal(decide(base,28).suggestedDecision,'approved');
});
test('clear below threshold suggests reject',()=>{
  assert.equal(decide({...base,assessment:'looks_insufficient',visible_like_count:12},28).suggestedDecision,'rejected');
});
test('without criteria, uncertain quality, missing count or inconsistent assessment stays uncertain',()=>{
  for(const [raw,min] of [[base,null],[{...base,evidence_quality:'unclear'},28],[{...base,visible_like_count:null},28],[{...base,assessment:'uncertain'},28],[{...base,assessment:'looks_sufficient',visible_like_count:4},28]]){
    assert.equal(decide(raw,min).suggestedDecision,'uncertain');
  }
});
test('invalid JSON decision schema fails closed',()=>{
  assert.throws(()=>decide({assessment:'approved',visible_like_count:32},28));
});
