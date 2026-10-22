#!/usr/bin/env node
// Ubuntu campus node: one signed heartbeat per systemd timer tick.
// Local 127.0.0.1 health MUST succeed before reporting healthy to Cloudflare.
import {createHmac,randomBytes} from 'node:crypto';
const requireVar=n=>{const x=process.env[n];if(!x)throw Error('Missing '+n);return x;};
try{
  const local=requireVar('BOMBAX_LAN_LOCAL_HEALTH');
  const endpoint=requireVar('BOMBAX_CLOUD_HEARTBEAT');
  const secret=requireVar('BOMBAX_ROUTE_SECRET');
  const node=requireVar('BOMBAX_CAMPUS_NODE_ID');
  if(!local.startsWith('http://127.0.0.1:')||
    !endpoint.startsWith('https://activity.10273055.xyz/__route/heartbeat')||
    secret.length<32)throw Error('Heartbeat endpoint/configuration invalid');
  const health=await fetch(local,{signal:AbortSignal.timeout(2800),cache:'no-store'});
  if(!health.ok)throw Error('Local activity server is not ready');
  const j=await health.json();
  if(j.service!=='bombax-campus-lan'||j.healthy!==true)
    throw Error('Local readiness probe did not confirm the activity service');
  const stamp=String(Date.now()),nonce=randomBytes(16).toString('hex');
  const msg='v1\n'+node+'\n'+stamp+'\n'+nonce;
  const signature=createHmac('sha256',secret).update(msg).digest('hex');
  const response=await fetch(endpoint,{
    method:'POST',headers:{
      'X-Bombax-Node':node,'X-Bombax-Timestamp':stamp,
      'X-Bombax-Nonce':nonce,'X-Bombax-Signature':'v1='+signature
    },signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)throw Error('Cloudflare rejected heartbeat (status '+response.status+')');
  process.stdout.write('Campus node heartbeat acknowledged\n');
}catch(error){
  // Never print secret or user IP. A missing heartbeat naturally expires in KV.
  process.stderr.write('Campus heartbeat not sent: '+error.message+'\n');
  process.exitCode=1;
}
