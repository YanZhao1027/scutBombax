// Usage: printf '%s' "$PASSWORD" | node provision-organizer.mjs username "Display Name" > private.sql
// The generated SQL must never be committed or shared.
import {randomBytes,pbkdf2Sync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const [username,name]=process.argv.slice(2);
if(!/^[A-Za-z0-9_]{3,32}$/.test(username||'')||typeof name!=='string'||name.trim().length<1||name.length>40)
  throw new Error('Usage: node provision-organizer.mjs <username> <display-name>, password from stdin');
const pass=readFileSync(0,'utf8').replace(/\r?\n$/,'');
if(pass.length<12||pass.length>256)throw new Error('Password must be 12-256 characters');
const salt=randomBytes(16).toString('hex'),digest=pbkdf2Sync(pass,Buffer.from(salt,'hex'),240000,32,'sha256').toString('hex');
const sqlQuote=s=>"'"+String(s).replaceAll("'","''")+"'";
process.stdout.write('INSERT INTO activity_users (id,username,password_salt,password_digest,role,student_number,display_name,created_at) VALUES ('+
  [randomUUID(),username,salt,digest,'organizer',null,name,Date.now()].map(x=>x===null?'NULL':typeof x==='number'?x:sqlQuote(x)).join(',')+');\n');
