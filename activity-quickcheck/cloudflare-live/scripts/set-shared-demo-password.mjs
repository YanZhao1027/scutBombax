// One-time, owner-executed setup for the isolated fictional-data Cloudflare Stage.
// ALL credentials touched are for demo_ accounts. Never run on a real student database.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.stage.jsonc'),'utf8'));
const stage='https://activity-stage.10273055.xyz';
const password='12341234'; // Intentionally public: only allowed for fictional trial identities.
const wrangler='/home/zyubuntu/Downloads/audition-lite-phase2/audition-lite/node_modules/.bin/wrangler';

if(config.name!=='scut-bombax-activity-stage'||
   config.d1_databases?.length!==1||
   config.d1_databases[0].database_name!=='scut-bombax-activity-stage'||
   config.vars?.SYNTHETIC_ONLY!=='true'||
   config.vars?.ENABLE_LIVE!=='true'||
   config.vars?.PUBLIC_ORIGIN!==stage||
   config.routes?.[0]?.pattern!=='activity-stage.10273055.xyz'){
  throw new Error('Refused: not the standalone fictional-data testing environment.');
}

function run(exe,args){
  try {
    return execFileSync(exe,args,{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
  }catch(err){
    throw new Error('Command failed: '+exe+' ('+args.slice(0,3).join(' ')+') '+String(err.stderr||err.message).slice(-1100));
  }
}
function modify(file,oldText,newText){
  let source=fs.readFileSync(file,'utf8');
  if(source.includes(oldText))fs.writeFileSync(file,source.replace(oldText,newText),'utf8');
  else if(!source.includes(newText))throw new Error('Unexpected source content: '+file);
}
const backend=path.join(root,'cloudflare-live/worker.mjs');
const frontend=path.join(root,'cloudflare-live/public/app.js');
const tests=path.join(root,'tests/cloudflare-live.test.mjs');
modify(backend,
  'const digest=await passwordHash(x.password,u.password_salt,Number(u.password_iterations));',
  'const digest=await passwordHash(x.password,u.password_salt,Number(u.password_iterations),true);');
modify(backend,
  "if(method==='POST'&&p.endsWith('/ai-review')){",
  "if(method==='POST'&&p.endsWith('/ai-review')){\n    need(env.SYNTHETIC_ONLY!=='true',503,'公开共用密码的演练站不开放计费 AI，请使用人工审核');");
modify(frontend,
  "label('密码',inp('password','password'))",
  "label('测试密码统一 12341234',inp('password','password','12341234'))");
modify(frontend,
  "label('12 位以上密码',inp('password','password'))",
  "label('测试密码统一 12341234',inp('password','password','12341234'))");
modify(frontend,
  "text('不读取学校一卡通、微信 Cookie 或校园码。')",
  "text('此站仅使用虚构资料；所有测试账号密码均为 12341234。')");

modify(tests,
  "const password='Synthetic-Local-Only-Password-2026';",
  "const password='12341234';");

function d1(args){
  const result=JSON.parse(run(wrangler,['d1','execute','scut-bombax-activity-stage','--remote','--json','--config','wrangler.stage.jsonc',...args]));
  if(!Array.isArray(result)||result.some(r=>r.success!==true))throw new Error('Cloudflare D1 command failed');
  return result;
}
const people=d1(['--command','SELECT username,role FROM activity_users ORDER BY username'])[0].results;
const staff=['demo_owner','demo_review','demo_scan','demo_manual'];
if(people.length<4||people.length>100||
   people.some(x=>!/^demo_[A-Za-z0-9_]+$/.test(x.username)||!['organizer','student'].includes(x.role))||
   staff.some(name=>!people.some(x=>x.username===name&&x.role==='organizer'))){
  throw new Error('Refused to reset non-demo users or unexpected database rows');
}
console.log('Scope verified: '+people.length+' fictional accounts and separate Stage database.');
run('node',['--check',backend]);
run('node',['--check',frontend]);
run('npm',['test']);
run('node',['scripts/stage-live-assets.mjs']);
run(wrangler,['deploy','--config','wrangler.stage.jsonc','--dry-run','--outdir','/tmp/bombax-stage-demo-build']);
run(wrangler,['deploy','--config','wrangler.stage.jsonc']);
console.log('Updated synthetic-only Worker and frontend. Now resetting demo hashes.');

const statements=[];
for(const person of people){
  const salt=randomBytes(16).toString('hex');
  const digest=pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
  statements.push("UPDATE activity_users SET password_salt='"+salt+"',password_digest='"+digest+
    "',password_iterations=100000 WHERE username='"+person.username+"';");
}
statements.push('DELETE FROM activity_sessions;');
const dir=path.join(process.env.HOME||'/home/zyubuntu','.local','share','bombax-activity-stage');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const sqlFile=path.join(dir,'stage-shared-password-once.sql');
fs.writeFileSync(sqlFile,statements.join('\n')+'\n',{mode:0o600});
try {
  // Wrangler prints human-readable upload progress before JSON for --file.
  // A zero exit code confirms application; inspect D1 separately below.
  run(wrangler,['d1','execute','scut-bombax-activity-stage','--remote','--config','wrangler.stage.jsonc','--file',sqlFile]);
} finally {
  fs.rmSync(sqlFile,{force:true});
}
const verified=d1(['--command',"SELECT COUNT(*) AS n FROM activity_users WHERE username GLOB 'demo_*' AND password_iterations=100000"])[0].results[0].n;
if(verified!==people.length)throw new Error('Post-update account count mismatch');
for(const old of ['test-accounts.pending','test-password-rotation.pending.sql','test-accounts.txt'])
  fs.rmSync(path.join(dir,old),{force:true});
console.log('Demo passwords rotated; previous login sessions invalidated.');
async function login(user){
  const response=await fetch(stage+'/api/login',{
    method:'POST',
    headers:{Origin:stage,'X-Bombax-Action':'1','Content-Type':'application/json'},
    body:JSON.stringify({username:user,password}),
    signal:AbortSignal.timeout(15000)
  });
  if(response.status!==200) {
    const body=await response.text();
    throw new Error('Public login smoke test failed for '+user+' (HTTP '+response.status+'): '+body.slice(0,200));
  }
  console.log('Public login smoke test '+user+' succeeded (HTTP 200).');
}
await login('demo_owner');
await login('demo_scan');
const student=people.find(x=>x.role==='student');
if(student)await login(student.username);
console.log('SUCCESS: all synthetic users use password 12341234 at '+stage);
