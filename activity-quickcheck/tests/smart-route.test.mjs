import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import router,{cidrIncludes,campusAddress} from '../smart-route/router.mjs';
const origin='https://activity.10273055.xyz';
const key='Synthetic-Routing-HMAC-Key-Not-For-Production-1234567890';
const env=()=>{
  const mem=new Map();
  const store={
    async get(x){return mem.get(x)||null;},
    async put(x,value){mem.set(x,value);}
  };
  return {CAMPUS_ROUTE_ENABLED:'true',
    CAMPUS_NODE_ID:'uc-ubuntu-01',CAMPUS_HEARTBEAT_SECRET:key,
    CAMPUS_EGRESS_CIDRS:'203.0.113.0/24,2001:db8:abcd::/48',
    CAMPUS_LAN_ORIGIN:'https://activity-lan.10273055.xyz',
    CAMPUS_STATUS:store,mem};
};
const decision=(config,ip='203.0.113.23')=>router.fetch(new Request(origin+'/__route/decision',{
  headers:{'CF-Connecting-IP':ip}
}),config);
async function heartbeat(config,{nonce=randomBytes(16).toString('hex'),stamp=String(Date.now()),bad=false}={}){
 const node=config.CAMPUS_NODE_ID,msg='v1\n'+node+'\n'+stamp+'\n'+nonce;
 const signature=createHmac('sha256',bad?'wrong-secret':key).update(msg).digest('hex');
 return router.fetch(new Request(origin+'/__route/heartbeat',{method:'POST',
   headers:{'X-Bombax-Node':node,'X-Bombax-Timestamp':stamp,
     'X-Bombax-Nonce':nonce,'X-Bombax-Signature':'v1='+signature}
 }),config);
}
test('CIDRs use the trusted CF public egress IP, not arbitrary forwarded headers',()=>{
 assert.equal(cidrIncludes('203.0.113.44','203.0.113.0/24'),true);
 assert.equal(cidrIncludes('203.0.114.44','203.0.113.0/24'),false);
 assert.equal(cidrIncludes('203.0.113.77','0.0.0.0/0'),true);
 assert.equal(cidrIncludes('2001:db8:abcd:0:0:0:0:2','2001:db8:abcd::/48'),true);
 assert.equal(cidrIncludes('2001:db8:abce::2','2001:db8:abcd::/48'),false);
 for(const ip of ['192.168.1.1','10.12.13.14','1.2.3.4']){
   assert.equal(campusAddress(ip,'203.0.113.0/24'),false);
 }
 for(const cidr of ['203.0.113.0/35','203.0.113.0/-1','ab.cd.ef.gh/16','x/12'])assert.equal(cidrIncludes('203.0.113.2',cidr),false);
});
test('router is fail closed by default, requiring configured health and configured public CIDRs',async()=>{
 const c=env();
 assert.equal((await(await decision(c)).json()).mode,'cloud','no heartbeat => fallback');
 c.CAMPUS_ROUTE_ENABLED='false';
 assert.equal((await heartbeat(c)).status,503);
 assert.equal((await(await decision(c)).json()).mode,'cloud');
 c.CAMPUS_ROUTE_ENABLED='true';
 delete c.CAMPUS_HEARTBEAT_SECRET;
 assert.equal((await heartbeat(c)).status,503,'secret required');
 c.CAMPUS_HEARTBEAT_SECRET=key;
 c.CAMPUS_EGRESS_CIDRS='';
 assert.equal((await(await decision(c)).json()).mode,'cloud');
});
test('signed campus heartbeats are short-lived, replay-checked and IP scoped',async()=>{
 const c=env();
 assert.equal((await heartbeat(c,{bad:true})).status,403);
 assert.equal((await heartbeat(c,{stamp:String(Date.now()-120000)})).status,403);
 const nonce='a'.repeat(32);
 assert.equal((await heartbeat(c,{nonce})).status,200);
 assert.equal((await heartbeat(c,{nonce})).status,403);
 const response=await decision(c);
 assert.equal(response.status,200);
 const q=await response.json();
 assert.equal(q.mode,'probe');
 assert.equal(q.lanOrigin,'https://activity-lan.10273055.xyz');
 assert.equal((await(await decision(c,'203.0.114.2')).json()).mode,'cloud');
 assert.equal((await(await decision(c,'2001:db8:abcd::1')).json()).mode,'probe');
 assert.equal((await(await decision(c,'192.168.1.1')).json()).mode,'cloud');
 c.mem.set('healthy',JSON.stringify({node:'uc-ubuntu-01',at:Date.now()-150000}));
 assert.equal((await(await decision(c)).json()).mode,'cloud');
 c.mem.set('healthy',JSON.stringify({node:'unknown',at:Date.now()}));
 assert.equal((await(await decision(c)).json()).mode,'cloud');
 c.CAMPUS_LAN_ORIGIN='http://192.168.1.9:8080';
 assert.equal((await(await decision(c)).json()).mode,'cloud','HTTPS required');
});
test('client home-only route protects QR fragment, auth paths, and app vault',()=>{
 const code=readFileSync(new URL('../cloudflare-live/public/route-bootstrap.js',import.meta.url),'utf8');
 const makeWindow=({hostname='activity.10273055.xyz',pathname='/',hash='',search='',native=false}={})=>{
   const fetches=[];
   const win={location:{hostname,pathname,hash,search,replace(x){this.replaced=x;}},
     sessionStorage:{getItem(){return null;},setItem(){}},
     BombaxAppVault:{enabled:native},
     fetch(...args){fetches.push(args[0]);return Promise.resolve(new Response('x',{status:404}));}};
   vm.runInNewContext(code,{window:win,URL,AbortController,setTimeout,clearTimeout});
   return fetches;
 };
 assert.equal(makeWindow({hash:'#pass=bqx_abc'}).length,0);
 assert.equal(makeWindow({pathname:'/admin'}).length,0);
 assert.equal(makeWindow({pathname:'/adminlogin'}).length,0);
 assert.equal(makeWindow({pathname:'/my'}).length,0);
 assert.equal(makeWindow({search:'?force_cloud=1'}).length,0);
 assert.equal(makeWindow({hostname:'activity-stage.10273055.xyz'}).length,0);
 assert.equal(makeWindow({native:true}).length,0);
 assert.equal(makeWindow().length,1);
 assert.match(code,/redirect:'error'/);
 assert.match(code,/AbortController/);
 assert.match(code,/credentials:'omit'/);
 const watchdog=readFileSync(new URL('../smart-route/lan-watchdog.js',import.meta.url),'utf8');
 assert.match(watchdog,/force_cloud=1/);
 assert.match(watchdog,/count>=3/);
});
