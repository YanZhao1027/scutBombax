import test from 'node:test';
import assert from 'node:assert/strict';
import relay from '../worker.mjs';
const url='https://activity.10273055.xyz/__route/decision';
const check=async(endpoint,env)=>{
  const res=await relay.fetch(new Request(endpoint),env);
  return {status:res.status,body:await res.json()};
};
test('active campus preference is only a probe: no blind redirect',async()=>{
  const x=await check(url,{CAMPUS_ROUTE_ENABLED:'true'});
  assert.equal(x.status,200);
  assert.equal(x.body.mode,'probe');
  assert.equal(x.body.lanOrigin,'https://activity-lan.10273055.xyz:8443/');
  assert.equal(x.body.timeoutMs,1300);
});
test('disabled/test/noncanonical origins refuse routing',async()=>{
  assert.equal((await check(url,{})).body.mode,'cloud');
  assert.equal((await check(url,{CAMPUS_ROUTE_ENABLED:'false'})).body.mode,'cloud');
  assert.equal((await check('https://activity-relay-test.10273055.xyz/__route/decision',{CAMPUS_ROUTE_ENABLED:'true'})).body.mode,'cloud');
  assert.equal((await check('https://bombax-activity-relay-test.ryowenth.workers.dev/__route/decision',{CAMPUS_ROUTE_ENABLED:'true'})).body.mode,'cloud');
});
test('unknown hostname fails closed',async()=>{
  const response=await relay.fetch(new Request('https://unknown.example/__route/decision'),{CAMPUS_ROUTE_ENABLED:'true'});
  assert.equal(response.status,421);
});
