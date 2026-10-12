import test from 'node:test';
import assert from 'node:assert/strict';
import backend from '../cloudflare-live/worker.mjs';
const makeEnv=()=>({
  DB:{prepare(){throw new Error('D1 must not be accessed by anonymous health and closed-gate routes');}},
  ENABLE_LIVE:'false',PUBLIC_ORIGIN:'https://activity-stage.10273055.xyz',
  ASSETS:{fetch:async()=>new Response('static demo',{status:200})}
});
test('Cloudflare live backend only responds with readiness until explicitly enabled',async()=>{
  const env=makeEnv();
  const health=await backend.fetch(new Request('https://activity-stage.10273055.xyz/api/health'),env);
  assert.equal(health.status,200);
  const x=await health.json();
  assert.equal(x.ready,false);
  assert.equal(x.ok,true);
  const write=await backend.fetch(new Request('https://activity-stage.10273055.xyz/api/register',{
    method:'POST',headers:{'Origin':'https://activity-stage.10273055.xyz','X-Bombax-Action':'1'},
    body:JSON.stringify({username:'invalid'})}),env);
  assert.equal(write.status,503);
  const empty=await backend.fetch(new Request('https://activity-stage.10273055.xyz/'),env);
  assert.equal(empty.status,200);
});
