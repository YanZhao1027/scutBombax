'use strict';

// Executes the real checked-in ArkTS protocol implementation via TypeScript's
// CommonJS transpiler. No mocks of Protocol, no network or school credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ts = require('typescript');
const ets = path.resolve(__dirname, '../entry/src/main/ets');

function compile(file, resolver = () => { throw new Error('Unexpected import'); }) {
  const source = fs.readFileSync(path.resolve(ets, file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true
    },
    fileName: file.replace('.ets', '.ts'),
    reportDiagnostics: true
  });
  const errors = (js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js.outputText)(resolver, module, module.exports);
  return module.exports;
}

const types = compile('models/SchoolTypes.ets');
const { ProtocolFailure } = types;
const { Protocol } = compile('services/Protocol.ets', id => {
  assert.equal(id, '../models/SchoolTypes');
  return types;
});

function keyboard() {
  return {
    uuid: 'fixed-unit-test-uuid',
    numberKeyboard: 'ABCDEFGHIJ',
    lowerLetterKeyboard: 'abcdefghijklmnopqrstuvwxyz',
    upperLetterKeyboard: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    symbolKeyboard: 'abcdefghijklmnopqrstuvwxyzABC'
  };
}

test('digits/lowercase/uppercase/symbol order maps exactly as Android v1.0.1', () => {
  const k = keyboard();
  assert.equal(Protocol.encodeKeyboardPassword('0', k), 'A$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('9', k), 'J$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('q', k), 'a$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('z', k), 't$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('Q', k), 'A$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('Z', k), 'T$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('*', k), 'a$1$fixed-unit-test-uuid');
  assert.equal(Protocol.encodeKeyboardPassword('_', k), 'C$1$fixed-unit-test-uuid');
});

test('unsupported chars and malformed keyboards are explicitly rejected', () => {
  assert.throws(() => Protocol.encodeKeyboardPassword('密码', keyboard()), ProtocolFailure);
  assert.throws(() => Protocol.encodeKeyboardPassword('', keyboard()), ProtocolFailure);
  assert.throws(() => Protocol.encodeKeyboardPassword('1', { ...keyboard(), uuid: '' }), ProtocolFailure);
  assert.throws(() => Protocol.encodeKeyboardPassword('1', { ...keyboard(), symbolKeyboard: '' }), ProtocolFailure);
});

test('form uses loginFrom and campus-card captcha field names, encodes reserved chars', () => {
  const encoded = 'ENCODED$1$uuid';
  const result = Protocol.loginBody('student id', encoded, 'key+token', ' ab ', 'sno');
  const params = new URLSearchParams(result);
  assert.equal(params.get('username'), 'student id');
  assert.equal(params.get('password'), encoded);
  assert.equal(params.get('grant_type'), 'password');
  assert.equal(params.get('scope'), 'all');
  assert.equal(params.get('loginFrom'), 'h5');
  assert.equal(params.get('logintype'), 'sno');
  assert.equal(params.get('device_token'), 'h5');
  assert.equal(params.get('synAccessSource'), 'h5');
  assert.equal(params.get('captcha_header_code'), 'ab');
  assert.equal(params.get('captcha_header_key'), 'key+token');
  assert.equal(params.has('loginForm'), false);
});

test('redirect resolver permits only SCUT HTTPS and normalizes relative paths', () => {
  const base = 'https://ecardwxnew.scut.edu.cn/berserker-base/redirect?secret=STUB';
  assert.equal(Protocol.safeRedirect('/a/b?code=1', base), 'https://ecardwxnew.scut.edu.cn/a/b?code=1');
  assert.equal(Protocol.safeRedirect('https://dfyc.utc.scut.edu.cn/path', base), 'https://dfyc.utc.scut.edu.cn/path');
  assert.equal(Protocol.safeRedirect('http://dfyc.utc.scut.edu.cn/ok', base), 'https://dfyc.utc.scut.edu.cn/ok');
  assert.equal(Protocol.safeRedirect('//ecardwxnew.scut.edu.cn/path', base), 'https://ecardwxnew.scut.edu.cn/path');
  assert.equal(Protocol.safeRedirect('getCode?ticket=1', 'https://ecardwxnew.scut.edu.cn/oauth/authorize?redirect_uri=https://dfyc.utc.scut.edu.cn/a/b'), 'https://ecardwxnew.scut.edu.cn/oauth/getCode?ticket=1');
  for(const url of [
    'https://attacker.example.net/grab',
    'https://scut.edu.cn.attacker.net/grab',
    'https://user@dfyc.utc.scut.edu.cn/steal',
    'https://dfyc.utc.scut.edu.cn:8443/steal',
    'file:///private/var'
  ]) assert.throws(() => Protocol.safeRedirect(url, base), ProtocolFailure, url);
});

test('DXC parser reads resultObject.leftMoney and roomName, does not confuse money with degrees', () => {
  const result = Protocol.parseDxc(
    { statusCode: '200', resultObject: { roomName: 'TEST ROOM' } },
    { statusCode: '200', resultObject: { leftMoney: '29.50' } },
    { statusCode: '200', resultObject: { leftMoney: 48.7 } }
  );
  assert.equal(result.campus, 'DXC');
  assert.equal(result.room, 'TEST ROOM');
  assert.equal(result.electric, 29.5);
  assert.equal(result.water, 48.7);
  assert.equal(result.ac, null);
  assert.equal(result.electricText, '元');
});

test('DXC parser rejects stale/nonstandard replies and missing balances', () => {
  const good = { statusCode: '200', resultObject: { leftMoney: '12.1' } };
  assert.throws(() => Protocol.parseDxc(
    { statusCode: '401', resultObject: { roomName: 'TEST' } }, good, good
  ), ProtocolFailure);
  assert.throws(() => Protocol.parseDxc(
    { statusCode: '200', resultObject: { roomName: 'TEST' } }, good,
    { statusCode: '200', resultObject: { leftMoney: 'malformed' } }
  ), ProtocolFailure);
});

test('GZIC parser handles school feeitem text and water last-comma segment', () => {
  const item = (room, text) => ({
    code: 200,
    map: { data: { room }, showData: { '信息': text } }
  });
  const result = Protocol.parseGzic(
    item('TEST ROOM', '电费余额 23.45 元'),
    item('TEST ROOM', '空调费余额 9.00 元'),
    item('TEST ROOM', '本期累计 123.4, 剩余 5.67 元')
  );
  assert.equal(result.electric, 23.45);
  assert.equal(result.ac, 9);
  assert.equal(result.water, 5.67);
  assert.equal(result.room, 'TEST ROOM');
  assert.equal(result.campus, 'GZIC');
  assert.throws(() => Protocol.parseGzic(item('TEST', 'bad'), item('TEST', '0'), item('TEST', '0')),
    ProtocolFailure);
});

test('history projection stores balances only, never account, room or session tokens', () => {
  const reading = Protocol.parseDxc(
    { statusCode: '200', resultObject: { roomName: 'PRIVATE ROOM' } },
    { statusCode: '200', resultObject: { leftMoney: 15.1 } },
    { statusCode: '200', resultObject: { leftMoney: 10.5 } }
  );
  const history = Protocol.snapshot(reading);
  assert.deepEqual(Object.keys(history).sort(), ['ac', 'at', 'campus', 'electric', 'water'].sort());
  assert.equal(JSON.stringify(history).includes('PRIVATE ROOM'), false);
});
