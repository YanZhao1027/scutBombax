'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const dir = path.resolve(__dirname, '../entry/src/main/ets');
function compile(file, resolver = () => { throw new Error('unknown dependency'); }) {
  const source = fs.readFileSync(path.resolve(dir, file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(resolver, module, module.exports);
  return module.exports;
}
const types = compile('models/SchoolTypes.ets');
const { Protocol } = compile('services/Protocol.ets', id => {
  assert.equal(id, '../models/SchoolTypes');
  return types;
});

const cardHost = 'https://ecardwxnew.scut.edu.cn';
const dxcHost = 'https://dfyc.utc.scut.edu.cn';
const keyboard = {
  uuid: 'mock-keyboard-session',
  numberKeyboard: 'ABCDEFGHIJ',
  lowerLetterKeyboard: 'abcdefghijklmnopqrstuvwxyz',
  upperLetterKeyboard: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  symbolKeyboard: 'abcdefghijklmnopqrstuvwxyzABC'
};

function json(content, status = 200, location = '') {
  return { status, text: JSON.stringify(content), location };
}

class FixtureSchoolHttp {
  constructor() {
    FixtureSchoolHttp.last = this;
    this.calls = [];
    this.cookies = { tgc: '', locSession: '', errorTimes: '', jsession: '' };
    this.failSessionOnce = false;
    this.returnError = false;
    this.closed = false;
  }

  async get(url, kind = 'card', headers = {}) {
    this.calls.push({ method: 'GET', url, kind, headers });
    assert.match(url, /^https:\/\/([a-z.-]+\.)?scut\.edu\.cn\//);
    if (url.includes('/berserker-app/frontInfo')) {
      return json({ code: 200, success: true, data: { platType: 'h5' } });
    }
    if (url.includes('/berserker-auth/oauth/captcha')) {
      return json({ key: 'mock-captcha-key', image: 'data:image/png;base64,aGVsbG8=' });
    }
    if (url.includes('/berserker-secure/keyboard')) {
      return json({ code: 200, success: true, data: keyboard });
    }
    if (url.includes('/charge/feeitem/getThirdDataByFeeItemId')) {
      assert.equal(headers['Synjones-Auth'], 'bearer MOCK_PRIVATE_TOKEN');
      const feeitem = new URL(url).searchParams.get('feeitemid');
      return json({
        code: 200,
        map: {
          data: { room: 'TEST-ROOM' },
          showData: { '信息': feeitem === '1' ? '电费 51.5' : feeitem === '2' ? '空调 9.5' : '水费, 21.0' }
        }
      });
    }
    if (url.includes('/berserker-base/redirect')) {
      assert.match(url, /synjones-auth=MOCK_PRIVATE_TOKEN/);
      assert.equal(kind, 'sso');
      this.cookies.jsession = '';
      return json({}, 302, cardHost + '/login/thirdLogin');
    }
    if (url.endsWith('/login/thirdLogin')) {
      this.cookies.jsession = 'mock-jsession';
      return json({}, 302, cardHost + '/berserker-auth/oauth/authorize');
    }
    if (url.endsWith('/berserker-auth/oauth/authorize')) {
      return json({}, 302, dxcHost + '/sdms-weixin-pay-sp/service/getCode');
    }
    if (url.endsWith('/sdms-weixin-pay-sp/service/getCode')) {
      return json({}, 302, dxcHost + '/sdms-weixin-pay-sp/newWeixin/index.html');
    }
    if (url.endsWith('/sdms-weixin-pay-sp/service/find/userinfo')) {
      if (this.failSessionOnce) {
        this.failSessionOnce = false;
        return json({}, 302, cardHost + '/login');
      }
      assert.equal(kind, 'dxc');
      assert.equal(this.cookies.jsession, 'mock-jsession');
      return json({ statusCode: '200', resultObject: { roomName: 'TEST-ROOM' } });
    }
    if (url.includes('ammeterBalance')) {
      assert.equal(kind, 'dxc');
      return json({ statusCode: '200', resultObject: { leftMoney: '23.44' } });
    }
    if (url.includes('waterBalance')) {
      assert.equal(kind, 'dxc');
      return json({ statusCode: '200', resultObject: { leftMoney: '50.99' } });
    }
    throw new Error('Unexpected SCUT request: ' + new URL(url).pathname);
  }

  async post(url, body, authorization) {
    this.calls.push({ method: 'POST', url, body, authorization: 'PUBLIC-CLIENT-BASIC' });
    assert.equal(url, cardHost + '/berserker-auth/oauth/token');
    assert.match(authorization, /^Basic /);
    const form = new URLSearchParams(body);
    assert.equal(form.get('username'), 'MOCK_STUDENT');
    assert.equal(form.get('password'), Protocol.encodeKeyboardPassword('P4ss*', keyboard));
    assert.equal(form.get('captcha_header_key'), 'mock-captcha-key');
    assert.equal(form.get('captcha_header_code'), '1234');
    assert.equal(form.get('logintype'), 'sno');
    assert.equal(form.has('passwordPlain'), false);
    if (this.returnError) return json({ code: 8000, message: 'mock invalid login' });
    this.cookies.tgc = 'mock-tgc';
    this.cookies.locSession = 'mock-loc-session';
    return json({ access_token: 'MOCK_PRIVATE_TOKEN', expires_in: 3600, token_type: 'bearer' });
  }

  close() {
    this.closed = true;
    this.cookies.jsession = '';
  }
}
FixtureSchoolHttp.last = null;

const { SchoolClient } = compile('services/SchoolClient.ets', id => {
  if (id === './SchoolHttp') return { SchoolHttp: FixtureSchoolHttp };
  if (id === './Protocol') return { Protocol };
  if (id === '../models/SchoolTypes') return types;
  if (id === '@kit.RemoteCommunicationKit') return {};
  throw new Error('Unexpected import ' + id);
});

test('DXC flow: captcha initialization -> keyboard login -> SSO -> balances, all SCUT-only', async () => {
  const client = new SchoolClient();
  const fixture = FixtureSchoolHttp.last;
  const image = await client.getCaptcha();
  assert.match(image, /^data:image\/png;base64,/);
  await client.login('MOCK_STUDENT', 'P4ss*', '1234', 'DXC', 'sno');
  assert.equal(client.isLoggedIn(), true);
  const reading = await client.query();
  assert.equal(reading.campus, 'DXC');
  assert.equal(reading.electric, 23.44);
  assert.equal(reading.water, 50.99);
  assert.equal(reading.ac, null);
  const before = fixture.calls.filter(c => c.url.includes('base/redirect')).length;
  await client.query();
  const after = fixture.calls.filter(c => c.url.includes('base/redirect')).length;
  assert.equal(after, before, 'should reuse live DFYC session');
  assert.equal(fixture.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(fixture.calls.some(c => c.url.includes('ubuntu') || c.url.includes('workers.dev')), false);
  client.logout();
  assert.equal(client.isLoggedIn(), false);
  await assert.rejects(client.query(), types.ProtocolFailure);
});

test('GZIC flow: same login but direct feeitem 1/2/3 authenticated balance queries', async () => {
  const client = new SchoolClient();
  const fixture = FixtureSchoolHttp.last;
  await client.getCaptcha();
  await client.login('MOCK_STUDENT', 'P4ss*', '1234', 'GZIC', 'sno');
  const reading = await client.query();
  assert.equal(reading.campus, 'GZIC');
  assert.equal(reading.electric, 51.5);
  assert.equal(reading.water, 21);
  assert.equal(reading.ac, 9.5);
  assert.equal(fixture.calls.filter(c => c.url.includes('/charge/feeitem/')).length, 3);
  assert.equal(fixture.calls.filter(c => c.url.includes('/berserker-base/redirect')).length, 0);
  client.logout();
});

test('rejected login never populates a token', async () => {
  const client = new SchoolClient();
  const fixture = FixtureSchoolHttp.last;
  fixture.returnError = true;
  await client.getCaptcha();
  await assert.rejects(
    client.login('MOCK_STUDENT', 'P4ss*', '1234', 'DXC', 'sno'),
    /账号、登录类型或查询密码/
  );
  assert.equal(client.isLoggedIn(), false);
});

test('stale DXC session is rebuilt once without credential resubmission', async () => {
  const client = new SchoolClient();
  const fixture = FixtureSchoolHttp.last;
  await client.getCaptcha();
  await client.login('MOCK_STUDENT', 'P4ss*', '1234', 'DXC', 'sno');
  await client.query();
  fixture.failSessionOnce = true;
  const reading = await client.query();
  assert.equal(reading.electric, 23.44);
  assert.equal(fixture.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(fixture.calls.filter(c => c.url.includes('/berserker-base/redirect')).length, 2);
});
