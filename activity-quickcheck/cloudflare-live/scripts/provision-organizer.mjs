// Usage: printf '%s' "$PASSWORD" | node provision-organizer.mjs username "Display Name" > private.sql
// The generated SQL must never be committed or shared.
import {randomBytes,pbkdf2Sync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const [username,name]=process.argv.slice(2);
if(!/^[A-Za-z0-9_]{3,32}$/.test(username||'')||typeof name!=='string'||name.trim().length<1||name.length>40)
  throw new Error('Usage: node provision-organizer.mjs <username> <display-name>, password from stdin');
const pass=readFileSync(0,'utf8').replace(/\r?\n$/,'');
if(pass.length<12||pass.length>256)throw new Error('Password must be 12-256 characters');
// Synthetic-only trial uses the highest PBKDF2 iteration count currently accepted
// by Workers Web Crypto. Do not use synthetic-stage credentials for real students.
const iterations=Number(process.env.BOMBAX_PBKDF2_ITERATIONS||240000);
if(![100000,240000].includes(iterations))throw new Error('Unsupported PBKDF2 iteration count');
const salt=randomBytes(16).toString('hex'),digest=pbkdf2Sync(pass,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
const sqlQuote=s=>"'"+String(s).replaceAll("'","''")+"'";
process.stdout.write('INSERT INTO activity_users (id,username,password_salt,password_digest,password_iterations,role,student_number,display_name,created_at) VALUES ('+
  [randomUUID(),username,salt,digest,iterations,'organizer',null,name,Date.now()].map(x=>x===null?'NULL':typeof x==='number'?x:sqlQuote(x)).join(',')+');\n');
