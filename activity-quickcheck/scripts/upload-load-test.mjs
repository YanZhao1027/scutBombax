#!/usr/bin/env node
// Isolated upload-test load probe. Uses fictional registration fields and a
// locally generated image; it never logs cookies or the upload-test key.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';

const origin=(process.env.BOMBAX_UPLOAD_TEST_ORIGIN||'https://activity-upload-test.10273055.xyz').replace(/\/$/,'');
const password=process.env.BOMBAX_UPLOAD_TEST_PASSWORD||'12341234';
const keyPath=process.env.BOMBAX_UPLOAD_TEST_KEY_FILE||join(homedir(),'.config/scutbombax/upload-test-key');
const key=(process.env.BOMBAX_UPLOAD_TEST_KEY||await readFile(keyPath,'utf8')).trim();
const count=Number(process.env.BOMBAX_LOAD_COUNT||100);
const concurrency=Number(process.env.BOMBAX_LOAD_CONCURRENCY||20);
const imagePath=process.env.BOMBAX_LOAD_IMAGE||'/tmp/bombax-load.jpg';
if(!Number.isInteger(count)||count<1||count>300)throw Error('BOMBAX_LOAD_COUNT must be 1..300');
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>50)throw Error('BOMBAX_LOAD_CONCURRENCY must be 1..50');
if(key.length<32)throw Error('Upload-test access key is missing or invalid');
const image=await readFile(imagePath);
if(image.length<16||image.length>3*1024*1024||image[0]!==0xff||image[1]!==0xd8||image.at(-2)!==0xff||image.at(-1)!==0xd9)
  throw Error('Load fixture must be a valid-sized JPEG with JPEG boundary markers');
const jsonHeaders={'Content-Type':'application/json','Origin':origin,'X-Bombax-Action':'1'};
async function call(path,{method='GET',cookie='',data,raw,type,extraHeaders={}}={}){
  const headers={...extraHeaders};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){
    headers.Origin=origin;
    headers['X-Bombax-Action']='1';
  }
  let body;
  if(data!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(data);}
  if(raw!==undefined){headers['Content-Type']=type||'application/octet-stream';body=raw;}
  const start=performance.now();
  const response=await fetch(origin+path,{method,headers,body,signal:AbortSignal.timeout(Number(process.env.BOMBAX_LOAD_REQUEST_TIMEOUT_MS||60000))});
  const elapsed=performance.now()-start;
  const text=await response.text();
  let payload;
  try{payload=JSON.parse(text);}catch{payload={message:text.slice(0,160)};}
  if(!response.ok){
    const error=new Error('HTTP '+response.status+' '+path+': '+(payload.error||payload.message||'request failed'));
    error.status=response.status;error.elapsed=elapsed;throw error;
  }
  return {payload,response,elapsed,serverTiming:response.headers.get('Server-Timing')};
}
function parseServerTiming(value){
  if(!value)return null;
  const parsed={};
  for(const item of value.split(',')){
    const match=/^\s*([a-z0-9-]+);dur=([0-9.]+)/.exec(item);
    if(match)parsed[match[1]]=Number(match[2]);
  }
  return parsed;
}
function summary(samples){
  const sorted=[...samples].sort((a,b)=>a-b);
  const percentile=p=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
  return {count:sorted.length,avgMs:Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length),
    p50Ms:Math.round(percentile(.5)),p95Ms:Math.round(percentile(.95)),maxMs:Math.round(sorted.at(-1))};
}
async function mapLimit(items,limit,fn){
  const results=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){const i=next++;if(i>=items.length)return;results[i]=await fn(items[i],i);}
  }));
  return results;
}
const login=await call('/api/login',{method:'POST',data:{username:'demo_upload_owner',password},extraHeaders:jsonHeaders});
const staffCookie=(login.response.headers.get('set-cookie')||'').split(';')[0];
if(!/^bqx_live=[a-f0-9]{64}$/.test(staffCookie))throw Error('Synthetic staff login did not return a session');
const now=Date.now(),ends=now+2*60*60*1000,runId=now.toString(36).slice(-6);
const created=await call('/api/events',{method:'POST',cookie:staffCookie,data:{
  title:'测试上传压测 '+runId,guidelines:'仅用于隔离上传性能测试；虚构报名资料，人工审核。',
  latitude:23.1,longitude:113.3,radiusM:150,startsAt:now-60_000,endsAt:ends,
  joinStartsAt:now-30_000,joinEndsAt:ends,requirePhoto:true,bannerPreset:'lecture'
}});
const eventId=created.payload.id;
if(!eventId)throw Error('Could not create isolated load-test event');
const joinStarted=performance.now();
const joined=await mapLimit(Array.from({length:count},(_,i)=>i),Math.min(concurrency,20),async(i)=>{
  const studentNumber='TEST-LOAD-'+runId+'-'+i;
  const result=await call('/api/events/'+eventId+'/join',{method:'POST',data:{
    displayName:'测试压测'+String(i).padStart(3,'0'),studentNumber,
    note:'TEST ONLY upload throughput run '+runId,privacyAcknowledged:true,aiConsent:false
  }});
  const cookie=(result.response.headers.get('set-cookie')||'').split(';')[0];
  if(!cookie.startsWith('bqx_g_'))throw Error('Guest receipt cookie missing for test registration '+i);
  return {cookie,registrationId:result.payload.id,elapsed:result.elapsed};
});
const joinElapsed=performance.now()-joinStarted;
const probeSamples=[];let probing=true;
const probeLoop=(async()=>{
  while(probing){
    try{const result=await call('/api/events');probeSamples.push(result.elapsed);}
    catch(error){probeSamples.push({error:error.status||error.message});}
    await new Promise(resolve=>setTimeout(resolve,350));
  }
})();
const uploadStarted=performance.now();
const outcomes=await mapLimit(joined,concurrency,async(guest,i)=>{
  const start=performance.now();
  try{
    const result=await call('/api/events/'+eventId+'/upload',{
      method:'POST',cookie:guest.cookie,raw:image,type:'image/jpeg',
      extraHeaders:{'X-Bombax-Upload-Test-Key':key}
    });
    return {ok:true,elapsed:performance.now()-start,bytes:result.payload.bytes,mime:result.payload.mime,serverTiming:parseServerTiming(result.serverTiming)};
  }catch(error){return {ok:false,elapsed:performance.now()-start,status:error.status||0,error:error.message};}
});
const uploadElapsed=performance.now()-uploadStarted;
probing=false;await probeLoop;
const successes=outcomes.filter(x=>x.ok),failures=outcomes.filter(x=>!x.ok);
const probeLatencies=probeSamples.filter(x=>typeof x==='number');
const probeFailures=probeSamples.filter(x=>typeof x!=='number');
const latencies=successes.map(x=>x.elapsed);
const totalBytes=successes.reduce((n,x)=>n+x.bytes,0);
const serverTiming={};
for(const name of ['preflight','body-and-validate','r2-put','d1-commit','worker-total']){
  const samples=successes.map(x=>x.serverTiming?.[name]).filter(Number.isFinite);
  serverTiming[name]=samples.length?summary(samples):null;
}
const report={
  origin,eventId,registrations:joined.length,joinElapsedMs:Math.round(joinElapsed),
  joinLatency:summary(joined.map(x=>x.elapsed)),
  uploadsRequested:count,uploadsSucceeded:successes.length,uploadsFailed:failures.length,
  uploadConcurrency:concurrency,fixtureBytes:image.length,uploadedBytes:totalBytes,
  uploadElapsedMs:Math.round(uploadElapsed),uploadsPerSecond:Number((successes.length/(uploadElapsed/1000)).toFixed(2)),
  uploadLatency:latencies.length?summary(latencies):null,
  workerTimingMs:serverTiming,
  catalogProbeDuringUploads:{...summary(probeLatencies),failures:probeFailures.length,
    maxMs:probeLatencies.length?Math.round(Math.max(...probeLatencies)):null},
  failures:failures.slice(0,10).map(x=>({status:x.status,error:x.error})),
  cleanupEventId:eventId
};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
