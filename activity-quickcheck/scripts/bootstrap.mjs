import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { openDB, newId, hashPassword } from '../db.mjs';
import path from 'node:path';
const dbPath = process.env.ACTIVITY_DB_PATH || path.resolve('var/activity.sqlite');
const terminal = readline.createInterface({ input, output });
try {
  console.log('初始化主办方账号（仅在本地终端运行；请勿把密码写入命令参数或仓库）');
  const username = (await terminal.question('登录名（字母、数字、下划线，3-32 位）：')).trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) throw new Error('登录名格式不符');
  const displayName = (await terminal.question('显示名称：')).trim();
  if (!displayName || displayName.length>40) throw new Error('显示名称格式不符');
  const password = await terminal.question('临时管理密码（>=12 字符，请确保屏幕无人窥视）：');
  const db = openDB(dbPath);
  db.prepare('INSERT INTO users (id,username,password_hash,role,display_name,created_at) VALUES (?,?,?,?,?,?)')
    .run(newId(),username,hashPassword(password),'organizer',displayName,Date.now());
  console.log('主办方账号已建立。数据库位于本地 var/ 且不提交 Git。');
  db.close();
} finally { terminal.close(); }
