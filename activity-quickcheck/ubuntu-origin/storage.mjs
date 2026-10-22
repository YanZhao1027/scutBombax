/* Local D1 and R2 adapters for the Ubuntu-authoritative business logic.
 * Exactly ONE SQLite writer process; never point a second process at this data.
 * No Cloudflare D1/R2 data is imported automatically. */
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

class BoundStatement {
  constructor(native, values=[]) {this.native=native;this.values=values;}
  bind(...values){return new BoundStatement(this.native,values);}
  async first(columnName){
    const row=this.native.get(...this.values)??null;
    return columnName&&row?row[columnName]??null:row;
  }
  async all(){return {success:true,results:this.native.all(...this.values)};}
  async run(){return this.runSync();}
  runSync(){
    const info=this.native.run(...this.values);
    return {success:true,meta:{changes:Number(info.changes),last_row_id:Number(info.lastInsertRowid)}};
  }
}
function localDB(dataDir,migrationsDir){
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const filename=path.join(dataDir,'activity.sqlite');
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const migrationFiles=fs.readdirSync(migrationsDir).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
  for(const name of migrationFiles){
    if(db.prepare('SELECT 1 FROM _local_migrations WHERE name=?').get(name))continue;
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec(fs.readFileSync(path.join(migrationsDir,name),'utf8'));
      db.prepare('INSERT INTO _local_migrations(name,applied_at) VALUES (?,?)').run(name,Date.now());
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');db.close();throw new Error('Migration '+name+': '+e.message);}
  }
  return {
    filename,
    prepare(sql){return new BoundStatement(db.prepare(sql));},
    async batch(statements){
      db.exec('BEGIN IMMEDIATE');
      try{
        const result=statements.map(stmt=>stmt.runSync());
        db.exec('COMMIT');return result;
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    close(){db.close();},
    inspect(sql,...values){return db.prepare(sql).all(...values);}
  };
}
class LocalMaterials{
  constructor(dataDir){this.root=path.join(dataDir,'materials');fs.mkdirSync(this.root,{recursive:true,mode:0o700});}
  full(key){
    if(typeof key!=='string'||!key||key.length>300||key.includes('..')||
       !/^[A-Za-z0-9_./-]+$/.test(key)||key.startsWith('/'))throw Error('Invalid material key');
    return path.join(this.root,key);
  }
  async put(key,value){
    const dest=this.full(key);
    await fsp.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    const bytes=new Uint8Array(await new Response(value).arrayBuffer());
    const temp=dest+'.tmp-'+crypto.randomUUID();
    try{await fsp.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fsp.rename(temp,dest);}
    finally{await fsp.rm(temp,{force:true}).catch(()=>{});}
    return {key,size:bytes.byteLength};
  }
  async get(key){
    let buf;
    try{buf=await fsp.readFile(this.full(key));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
    return {body:new Uint8Array(buf),size:buf.length,async arrayBuffer(){
      return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
    }};
  }
  async delete(key){await fsp.rm(this.full(key),{force:true});}
}
function rateLimit(max,periodMs){
  const attempts=new Map();
  return {async limit({key}){
    const now=Date.now(),entry=attempts.get(key);
    const next=entry&&entry.until>now?entry:{until:now+periodMs,count:0};
    next.count++;
    attempts.set(key,next);
    if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);
    return {success:next.count<=max};
  }};
}
export function localBindings({dataDir,migrationsDir,publicDir,liveMode=false}){
  const DB=localDB(dataDir,migrationsDir);
  const MATERIALS=new LocalMaterials(dataDir);
  const expectedImage=fs.readFileSync(path.join(publicDir,'demo-proof.png'));
  return {DB,MATERIALS,AUTH_RATE_LIMIT:rateLimit(8,60_000),
    AI_RATE_LIMIT:rateLimit(5,60_000),ENABLE_LIVE:'true',
    SYNTHETIC_ONLY:liveMode?'false':'true',ALLOW_REAL_SUBMISSIONS:liveMode?'true':'false',ALLOW_TEST_IMAGE_UPLOAD:'false',
    SYNTHETIC_IMAGE_SHA256:undefined,
    close(){DB.close();},demoImage:expectedImage};
}
