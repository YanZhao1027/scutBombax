import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createOrigin} from '../server.mjs';
function query(port,route,{method='GET',host='activity-lan.10273055.xyz:8443',headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,
      headers:{Host:host,...headers}},res=>{
      let chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end();
  });
}
test('LAN secure-origin probe CORS, private network preflight and wrong-host isolation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bombax-lan-route-test-'));
  const port=18974;
  const app=createOrigin({dataDir:dir,port});
  try{
    await app.listen();
    const headers={Origin:'https://activity.10273055.xyz'};
    const health=await query(port,'/__lan/health',{headers});
    assert.equal(health.status,200);
    assert.equal(health.headers['access-control-allow-origin'],headers.Origin);
    assert.equal(health.headers['access-control-allow-private-network'],'true');
    assert.equal(JSON.parse(health.body).healthy,true);
    assert.equal(JSON.parse(health.body).service,'bombax-campus-lan');
    const options=await query(port,'/__lan/health',{method:'OPTIONS',headers:{
      ...headers,'Access-Control-Request-Method':'GET',
      'Access-Control-Request-Private-Network':'true'
    }});
    assert.equal(options.status,204);
    assert.equal(options.headers['access-control-allow-private-network'],'true');
    assert.equal((await query(port,'/__lan/health',{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await query(port,'/__lan/health',{host:'activity.10273055.xyz'})).status,404);
    assert.equal((await query(port,'/__lan/health',{method:'POST'})).status,405);
    const lanHome=await query(port,'/');
    assert.equal(lanHome.status,200);
    assert.match(lanHome.body,/lan-watchdog\.js/);
    const publicHome=await query(port,'/',{host:'activity.10273055.xyz'});
    assert.equal(publicHome.status,200);
    assert.doesNotMatch(publicHome.body,/lan-watchdog\.js/);
  }finally{
    await app.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
