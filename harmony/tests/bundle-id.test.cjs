'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Huawei signable app bundle ID avoids platform-reserved segments', () => {
  const app = fs.readFileSync(
    path.join(__dirname, '../AppScope/app.json5'), 'utf8'
  );
  const match = /"bundleName"\s*:\s*"([^"]+)"/.exec(app);
  assert.ok(match, 'AppScope/app.json5 must declare bundleName');
  const id = match[1];
  assert.equal(id, 'cn.scut.bombax.hmapp');
  assert.match(id, /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
  assert.ok(
    id.split('.').every(segment => !['harmony', 'huawei', 'ohos'].includes(segment)),
    'bundle ID must not use system-reserved names'
  );
});
