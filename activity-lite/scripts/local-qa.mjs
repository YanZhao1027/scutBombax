// Standalone Lite phone QA: real Worker + ephemeral D1/R2, no campus data.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import backend from '../worker.mjs';
import {fixture} from '../tests/support.mjs';

const host='127.0.0.1',port=3319,origin='http://127.0.0.1:3319';
const f=fixture({origin,synthetic:true});
const event=await f.event({material:true});
const scanner=await f.member(event,{username:'qa_scan',permissions:{
  review:false,scan:true,export:false,manual:false}});
const reviewer=await f.member(event,{username:'qa_review',permissions:{
  review:true,scan:false,export:false,manual:false}});
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const files={
  '/':'index.html','/index.html':'index.html','/style.css':'style.css',
  '/app.js':'app.js','/qr-vendor.js':'qr-vendor.js','/scan-vendor.js':'scan-vendor.js'
};
function send(res,status,body,contentType='application/json; charset=utf-8'){
  res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==host+':'+port)return send(res,403,{error:'USB localhost only'});
    const url=new URL(req.url,origin);
    if(url.pathname==='/__qa/context'&&req.method==='GET')
      return send(res,200,{synthetic:true,rootToken:f.rootToken,
        eventId:event.id,shareUrl:event.shareUrl,manageUrl:event.manageUrl,scanUrl:event.scanUrl,
        // LOCALHOST-ONLY fictional credentials. Never route this fixture in production.
        demoAccounts:{
          admin:{username:event.adminUsername,password:event.adminPassword},
          review:{username:reviewer.username,password:reviewer.password},
          scan:{username:scanner.username,password:scanner.password}
        }});
    if(url.pathname==='/__qa/state'&&req.method==='GET'){
      const records=f.sqlite.prepare('SELECT status,checked_by,COUNT(*) count FROM registrations GROUP BY status,checked_by').all();
      const audits=f.sqlite.prepare('SELECT action,COUNT(*) count FROM audit GROUP BY action').all();
      return send(res,200,{synthetic:true,records,audits,storedMaterials:f.storage.size});
    }
    if(url.pathname.startsWith('/api/')){
      const chunks=[];let length=0;
      for await(const chunk of req){
        length+=chunk.length;
        if(length>3*1024*1024)return send(res,413,{error:'本地演练请求超出大小限制'});
        chunks.push(chunk);
      }
      const headers=new Headers(req.headers);
      headers.set('CF-Connecting-IP','127.0.0.1');
      const work=await backend.fetch(new Request(origin+url.pathname+url.search,{
        method:req.method,headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})
      }),f.env);
      const out=Buffer.from(await work.arrayBuffer());
      const type=work.headers.get('Content-Type')||'application/octet-stream';
      const headersOut={'Content-Type':type,'Cache-Control':'no-store',
        'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
      if(work.headers.has('Set-Cookie'))headersOut['Set-Cookie']=work.headers.get('Set-Cookie');
      if(work.headers.has('Content-Disposition'))headersOut['Content-Disposition']=work.headers.get('Content-Disposition');
      res.writeHead(work.status,headersOut);
      return res.end(out);
    }
    if(req.method==='GET'&&files[url.pathname]){
      const name=files[url.pathname],buf=fs.readFileSync(path.join(directory,name));
      const type=name.endsWith('html')?'text/html; charset=utf-8':
        name.endsWith('css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
      return send(res,200,buf,type);
    }
    return send(res,404,{error:'本机 Lite 演练没有此资源'});
  }catch(error){
    // Do not log student fields or QR/receipt tokens.
    console.error('Lite USB error:',String(error?.message).slice(0,90));
    return send(res,500,{error:'本机演练服务器错误'});
  }
});
server.listen(port,host,()=>console.log(
  'LITE QA running http://'+host+':'+port+' (isolated synthetic, Worker/D1/R2)'));
process.once('SIGINT',()=>{server.close();f.close();});
