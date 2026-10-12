import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'node_modules/@zxing/browser/umd/zxing-browser.min.js');
const target=path.join(root,'cloudflare-live/public/zxing.js');
if(!fs.existsSync(source))throw new Error('Missing local scanner library. Run npm ci first.');
fs.copyFileSync(source,target);
console.log('Prepared self-hosted QR scanner library ('+fs.statSync(target).size+' bytes)');
