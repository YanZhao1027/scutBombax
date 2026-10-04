/**
 * Cross-check the DOM contract: every id main.ts looks up must exist in index.html,
 * and every id in index.html should be accounted for. main.ts throws at import time
 * on a missing id, so this catches a whole class of white-screen bug that tsc cannot see.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const classes = new Set(
  [...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
);
const names = new Set([...html.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]));

const referenced = new Set([
  ...[...main.matchAll(/\$\s*<[^>]*>\s*\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]),
  ...[...main.matchAll(/getElementById\(\s*'([^']+)'/g)].map((m) => m[1])
]);

const missing = [...referenced].filter((id) => !htmlIds.has(id));
console.log(`index.html ids: ${htmlIds.size}`);
console.log(`main.ts referenced ids: ${referenced.size}`);
console.log(missing.length ? `MISSING IDS: ${missing.join(', ')}` : 'missing ids: none');

const selectors = [...main.matchAll(/querySelector(?:HTML)?<[^>]*>\(\s*'([^']+)'\s*\)/g)].map(
  (m) => m[1]
);
for (const sel of new Set(selectors)) {
  const nameMatch = /\[name="([^"]+)"\]/.exec(sel);
  const classMatch = /\.([A-Za-z0-9_-]+)/.exec(sel);
  if (nameMatch && !names.has(nameMatch[1])) console.log(`MISSING name: ${nameMatch[1]} (${sel})`);
  if (classMatch && !classes.has(classMatch[1])) console.log(`MISSING class: ${classMatch[1]} (${sel})`);
  if (!nameMatch && !classMatch) console.log(`UNPARSED selector: ${sel}`);
}
console.log(selectors.length ? `selectors checked: ${new Set(selectors).size}` : 'selectors: none');

const unused = [...htmlIds].filter((id) => !referenced.has(id));
console.log(unused.length ? `unreferenced ids: ${unused.join(', ')}` : 'unreferenced ids: none');

// CSP: every asset the built page loads must be covered by the meta tag.
const csp = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] ?? '';
console.log(csp ? `CSP present (${csp.split(';').length} directives)` : 'CSP MISSING');
for (const directive of ['default-src', 'script-src', 'style-src', 'img-src', 'connect-src']) {
  if (!csp.includes(directive)) console.log(`CSP has no ${directive}`);
}
