import test from 'node:test';
import assert from 'node:assert/strict';
import {inCidrs,campusHeartbeat,maybeCampusAsset} from '../cloudflare-live/campus-router.mjs';
const release='a'.repeat(40),origin='https://activity.10273055.xyz';
const password='A'.repeat(48);
function fixture(){
  const state={last_seen_at:Date.now(),ready:1,release};
  let dbReads=0,cfReads=0;
  const env={
    PUBLIC_ORIGIN:origin,
    CAMPUS_ROUTING_ENABLED:'true',
    CAMPUS_STATIC_ORIGIN:'https://campus-static.example.org',
    CAMPUS_HEARTBEAT_SECRET:password,
    CAMPUS_EGRESS_CIDRS:'198.51.100.0/24,2001:db8:feed::/48',
    CAMPUS_RELEASE_SHA:release,
    DB:{prepare(sql){
      return {
        async first(){dbReads++;return state;},
        bind(...items){this.items=items;return this;},
        async run(){state.release=this.items[0];state.ready=this.items[1];state.last_seen_at=this.items[2];return {success:true};}
      };
    }},
    ASSETS:{async fetch(){cfReads++;return new Response('cloudflare',{headers:{'Content-Type':'text/html'}});}}
  };
  const incoming=(path='/',cookie='')=>new Request(origin+path,{
    headers:{'CF-Connecting-IP':'198.51.100.28','Sec-Fetch-Dest':'document',
      'Accept':'text/html',Cookie:cookie}
  });
  return {env,state,incoming,get reads(){return dbReads;},get fallback(){return cfReads;}};
}
test('CIDR matching supports strict IPv4/IPv6 and fails closed on invalid or spoofed literals',()=>{
  const ips='198.51.100.0/24,2001:db8:feed::/48';
  assert.equal(inCidrs('198.51.100.25',ips),true);
  assert.equal(inCidrs('198.51.101.1',ips),false);
  assert.equal(inCidrs('198.51.100.256',ips),false);
  assert.equal(inCidrs('127.0.0.1',ips),false);
  assert.equal(inCidrs('2001:db8:feed::7',ips),true);
  assert.equal(inCidrs('2001:db8:beef::7',ips),false);
  assert.equal(inCidrs('10.1.2.3','10.0.0.0/8'),true);
  assert.equal(inCidrs('8.8.8.8','10.0.0.0/8'),false);
  assert.equal(inCidrs('198.51.100.28','bad/24'),false);
});
test('unconfigured or Stage routing is strictly off and cannot accept heartbeats',async()=>{
  const x=fixture();
  x.env.CAMPUS_ROUTING_ENABLED='false';
  assert.equal(await maybeCampusAsset(x.incoming(),x.env,new URL(origin+'/')),null);
  assert.equal(x.reads,0);
  let r=await campusHeartbeat(new Request(origin+'/__campus/heartbeat',{method:'POST'}),x.env);
  assert.equal(r.status,404);
  x.env.CAMPUS_ROUTING_ENABLED='true';
  x.env.PUBLIC_ORIGIN='https://activity-stage.10273055.xyz';
  assert.equal(await maybeCampusAsset(x.incoming(),x.env,new URL(origin+'/')),null);
  r=await campusHeartbeat(new Request(origin+'/__campus/heartbeat',{method:'POST'}),x.env);
  assert.equal(r.status,404);
});
test('campus status changes only after valid secret and matching static release',async()=>{
  const x=fixture();x.state.ready=0;
  const url=origin+'/__campus/heartbeat';
  const api=(token,releaseId,ready=true)=>new Request(url,{method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({release:releaseId,ready})});
  assert.equal((await campusHeartbeat(api('wrong',release),x.env)).status,401);
  assert.equal(x.state.ready,0);
  assert.equal((await campusHeartbeat(api(password,'b'.repeat(40)),x.env)).status,409);
  assert.equal(x.state.ready,0);
  assert.equal((await campusHeartbeat(api(password,release),x.env)).status,200);
  assert.equal(x.state.ready,1);
});
test('static campus proxy keeps public hostname, never forwards Cookie or bearer session to campus',async()=>{
  const x=fixture();const original=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push({url,options});
    return new Response('campus',{status:200,headers:{'Content-Type':'text/html','X-Bombax-Static-Release':release,
      'Set-Cookie':'dangerous=not-allowed'}});
  };
  try{
    const nav=x.incoming();
    const served=await maybeCampusAsset(nav,x.env,new URL(nav.url));
    assert.equal(served.status,200);
    assert.equal(await served.text(),'campus');
    assert.equal(served.headers.get('X-Bombax-Route'),'campus');
    assert.equal(served.headers.get('Set-Cookie')?.includes('dangerous'),false,'upstream cookies stripped');
    assert.match(served.headers.get('Set-Cookie'),/bqx_route_refresh=/);
    assert.equal(requests.length,1);
    assert.equal(new URL(requests[0].url).origin,x.env.CAMPUS_STATIC_ORIGIN);
    assert.equal(requests[0].options.headers.has('Cookie'),false);
    assert.equal(requests[0].options.headers.has('Authorization'),false);
    const api=x.incoming('/api/events');
    assert.equal(await maybeCampusAsset(api,x.env,new URL(api.url)),null,'all D1/R2 API traffic stays on CF');
    assert.equal(requests.length,1);
    const outside=new Request(origin+'/',{headers:{'CF-Connecting-IP':'203.0.113.88'}});
    assert.equal(await maybeCampusAsset(outside,x.env,new URL(outside.url)),null);
  }finally{globalThis.fetch=original;}
});
test('campus unhealthy, wrong release or stale heartbeat always fall back to CF',async()=>{
  const x=fixture(),original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('older build',{headers:{'X-Bombax-Static-Release':'b'.repeat(40)}});
  try{
    const nav=x.incoming();
    const fallback=await maybeCampusAsset(nav,x.env,new URL(nav.url));
    assert.equal(await fallback.text(),'cloudflare');
    assert.match(fallback.headers.get('Set-Cookie'),/bqx_route_fallback=1/);
    x.state.last_seen_at=Date.now()-120000;
    assert.equal(await maybeCampusAsset(nav,x.env,new URL(nav.url)),null);
  }finally{globalThis.fetch=original;}
});
test('third quick navigation to campus route temporarily forces cloudflare fallback',async()=>{
  const x=fixture(),original=globalThis.fetch;
  let hits=0;
  globalThis.fetch=async()=>{hits++;return new Response('campus',{headers:{'X-Bombax-Static-Release':release}});};
  try{
    let cookie='';
    for(let n=0;n<3;n++){
      const nav=x.incoming('/',cookie);
      const resp=await maybeCampusAsset(nav,x.env,new URL(nav.url));
      const served=await resp.text();
      if(n<2){
        assert.equal(served,'campus');
        const item=resp.headers.get('Set-Cookie').split(';')[0];
        cookie=item;
      }else{
        assert.equal(served,'cloudflare');
        assert.match(resp.headers.get('Set-Cookie'),/bqx_route_fallback=1/);
      }
    }
    assert.equal(hits,2,'third navigation is never sent to failing campus');
  }finally{globalThis.fetch=original;}
});
