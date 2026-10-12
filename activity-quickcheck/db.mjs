import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function newId() { return randomBytes(18).toString('hex'); }
export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('密码至少需要 12 个字符，最多 256 个');
  const salt = randomBytes(16);
  return 'scrypt$' + salt.toString('hex') + '$' + scryptSync(password, salt, 64).toString('hex');
}
export function validPassword(password, stored) {
  try {
    const [method,saltHex,hashHex] = stored.split('$');
    if (method !== 'scrypt') return false;
    const test = scryptSync(password, Buffer.from(saltHex,'hex'),64);
    const expected = Buffer.from(hashHex,'hex');
    return expected.length===test.length && timingSafeEqual(test,expected);
  } catch { return false; }
}
export function openDB(dbPath) {
  fs.mkdirSync(path.dirname(dbPath),{recursive:true,mode:0o700});
  const db=new DatabaseSync(dbPath);
  fs.chmodSync(dbPath,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN (\'student\',\'organizer\')), student_id TEXT UNIQUE, display_name TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, radius_m INTEGER NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, require_attachment INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS staff (activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(activity_id,user_id))',
    'CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), note TEXT NOT NULL DEFAULT \'\', state TEXT NOT NULL CHECK(state IN (\'pending\',\'approved\',\'rejected\')), review_note TEXT NOT NULL DEFAULT \'\', reviewed_by TEXT REFERENCES users(id), reviewed_at INTEGER, created_at INTEGER NOT NULL, UNIQUE(activity_id,user_id))',
    'CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, issued_at INTEGER NOT NULL, UNIQUE(registration_id))',
    'CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id), activity_id TEXT NOT NULL REFERENCES activities(id), staff_id TEXT NOT NULL REFERENCES users(id), checked_at INTEGER NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_registrations_activity ON registrations(activity_id,state)',
    'CREATE INDEX IF NOT EXISTS idx_staff_user ON staff(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_checkins_activity ON checkins(activity_id)'
  ].join(';\n')+';');
  return db;
}
export function safeUser(user) {
  return user ? { id:user.id, username:user.username, displayName:user.display_name,
    role:user.role, studentId:user.student_id ?? undefined,
    identityStatus: user.role==='student'?'self_declared':undefined } : null;
}
export function distanceMeters(lat1,lon1,lat2,lon2) {
  const rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*6371000*Math.asin(Math.min(1,Math.sqrt(a)));
}
export function csvCell(value) {
  let str=String(value??'');
  if (/^[\s\uFEFF]*[=+\-@]/u.test(str)) str="'"+str;
  return '"'+str.replaceAll('"','""')+'"';
}
export function makeCsv(rows) {
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
