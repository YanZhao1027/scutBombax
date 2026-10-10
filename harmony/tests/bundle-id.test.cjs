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

test('default product explicitly binds Huawei DevEco signing config', () => {
  const profile = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../build-profile.json5'), 'utf8'
  ));
  const selected = profile.app.products.find(product => product.name === 'default');
  assert.ok(selected, 'default product is required');
  assert.equal(
    selected.signingConfig, 'default',
    'missing signingConfig silently produces an unsigned HAP (9568320)'
  );
  // In git this array is intentionally empty. DevEco Studio fills signingConfigs
  // with developer-specific local material after the owner enables auto signing.
});
