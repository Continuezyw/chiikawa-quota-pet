const test = require('node:test');
const assert = require('node:assert/strict');
const {customDefaults, validateCustomConfig, emptyCustomQuota, parseCustomResponse,
  restoreCustomQuota, fetchCustomQuota} = require('../src/providers/custom.cjs');

const MOCK_KEY = 'mock-custom-only-do-not-send';
const UPDATED_AT = '2026-11-04T00:00:00.000Z';
const ENDPOINT = 'https://quota.example.com/api/balance';
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {throw new Error('Outbound network is forbidden in custom tests');};
test.after(() => {globalThis.fetch = originalFetch;});

function config(overrides = {}) {
  return {...customDefaults(), endpoint: ENDPOINT, confirmed: true, ...overrides};
}

function quotaConfig(overrides = {}) {
  return config({mode: 'quota', ...overrides});
}

function newApiConfig(overrides = {}) {
  return quotaConfig({preset: 'newapi', label: 'New API 令牌', endpoint: 'https://quota.example.com/api/usage/token',
    totalPath: 'data.total_granted', usedPath: 'data.total_used', ...overrides});
}

function payload(balance = '12.345678901') {
  return {data: {balance, total: '20.123456789', used: '7.111111111'}};
}

function response(data = payload(), status = 200) {
  return {status, text: async () => JSON.stringify(data)};
}

function expectCode(code) {
  return (error) => {
    assert.equal(error.name, 'CustomQuotaError');
    assert.equal(error.code, code);
    assert.match(error.message, /[\u4e00-\u9fff]/);
    assert.equal(error.cause, undefined);
    for (const exposed of [error.message, error.stack, JSON.stringify(error)]) {
      for (const secret of [MOCK_KEY, 'untrusted-body', 'evil.example']) assert.equal(exposed.includes(secret), false);
    }
    return true;
  };
}

function tickTurn() {
  return new Promise(setImmediate);
}

test('exports exactly six functions and fresh fixed defaults', () => {
  assert.deepEqual(Object.keys(require('../src/providers/custom.cjs')).sort(), [
    'customDefaults', 'emptyCustomQuota', 'fetchCustomQuota', 'parseCustomResponse', 'restoreCustomQuota', 'validateCustomConfig'
  ]);
  assert.deepEqual(customDefaults(), {preset: 'generic', label: '第三方平台', endpoint: '', auth: 'bearer',
    headerName: 'X-API-Key', currency: 'CREDIT', mode: 'balance', remainingPath: 'data.balance',
    totalPath: 'data.total', usedPath: 'data.used', divisor: 1, confirmed: false});
  const first = customDefaults();
  first.label = 'changed';
  assert.equal(customDefaults().label, '第三方平台');
});

test('saving empty or unconfirmed sources is explicit; querying requires complete confirmed config', async () => {
  assert.deepEqual(validateCustomConfig({}, {allowEmpty: true}), customDefaults());
  assert.deepEqual(validateCustomConfig(customDefaults(), {allowEmpty: true}), customDefaults());
  assert.deepEqual(validateCustomConfig(config({confirmed: false}), {allowEmpty: true}), config({confirmed: false}));
  for (const input of [customDefaults(), config({confirmed: false}), config({endpoint: ''})]) {
    assert.throws(() => validateCustomConfig(input), expectCode('INVALID_CONFIG'));
    await assert.rejects(fetchCustomQuota(input, MOCK_KEY, {fetchImpl: () => assert.fail('must not fetch')}), expectCode('INVALID_CONFIG'));
  }
});

test('validation copies only fixed fields without reading other credentials or mutating input', () => {
  const input = Object.freeze({...config(), get token() {assert.fail('must not read token');},
    get apiKey() {assert.fail('must not read apiKey');}, method: 'POST', body: MOCK_KEY});
  assert.deepEqual(validateCustomConfig(input), config());
  assert.deepEqual(Object.keys(validateCustomConfig(input)), Object.keys(customDefaults()));
  assert.equal(validateCustomConfig(config({endpoint: 'HTTPS://QUOTA.EXAMPLE.COM'})).endpoint, 'https://quota.example.com/');
  assert.deepEqual(validateCustomConfig(Object.assign(Object.create(null), config())), config());
});

test('configuration types, enums, labels and divisors fail without coercion', () => {
  for (const input of [null, [], true, 'config', 123, Object.create(config())]) {
    assert.throws(() => validateCustomConfig(input), expectCode('INVALID_CONFIG'));
  }
  const invalidFields = {preset: ['unknown', '', null], label: ['', ' ', '\nlabel', 'x'.repeat(81), null],
    auth: ['basic', 'Bearer', null], currency: ['EUR', 'credit', null], mode: ['usage', '', null],
    divisor: [0, -1, Infinity, NaN, 1000000001, '100', null, false], confirmed: [1, 'true', null],
    remainingPath: [null, 123], totalPath: [null], usedPath: [null]};
  for (const [field, values] of Object.entries(invalidFields)) {
    for (const value of values) assert.throws(() => validateCustomConfig(config({[field]: value})), expectCode('INVALID_CONFIG'));
  }
  for (const options of [null, [], {allowEmpty: 'true'}, {allowEmpty: null}, {get allowEmpty() {throw new Error(MOCK_KEY);}}]) {
    assert.throws(() => validateCustomConfig(config(), options), expectCode('INVALID_CONFIG'));
  }
  assert.throws(() => validateCustomConfig({...config(), get endpoint() {throw new Error(MOCK_KEY);}}), expectCode('INVALID_CONFIG'));
  for (const divisor of [Number.MIN_VALUE, 0.001, 1, 1000000000]) assert.equal(validateCustomConfig(config({divisor})).divisor, divisor);
});

test('HTTPS URLs reject credentials, query/hash, IP spellings, local hosts and parser ambiguities', () => {
  const invalid = ['', 'http://quota.example.com/api', '//quota.example.com/api', 'https:quota.example.com',
    'https://user@quota.example.com/api', 'https://user:pass@quota.example.com/api',
    'https://quota.example.com/api?key=' + MOCK_KEY, 'https://quota.example.com/api?',
    'https://quota.example.com/api#fragment', 'https://quota.example.com/api#',
    'https://127.0.0.1/api', 'https://192.168.0.1/api', 'https://[::1]/api',
    'https://2130706433/api', 'https://0x7f000001/api', 'https://127.1/api',
    'https://localhost/api', 'https://foo.localhost/api', 'https://machine.local/api', 'https://QUOTA.LOCAL/api',
    'https://internal/api', 'https://quota.example.com./api', 'https://_quota.example.com/api',
    'https://-quota.example.com/api', 'https://quota-.example.com/api', 'https://quota..example.com/api',
    'https://quota.example.123/api', 'https://' + 'x'.repeat(64) + '.example.com/api',
    'https://quota.example.com:65536/api', 'https://quota.example.com\\@evil.example/api',
    ' https://quota.example.com/api', 'https://quota.example.com/api\r\nInjected: x',
    'https://quota.example.com/\u0000', 'https://quota.example.com/%0d%0aInjected',
    'https://quota.example.com/%00', 'https://quota.example.com/%7f', 'https://%71uota.example.com/api',
    'https://余额.example.com/api', 'https://quota.example.com/' + 'x'.repeat(2048)];
  for (const endpoint of invalid) assert.throws(() => validateCustomConfig(config({endpoint})), expectCode('INVALID_CONFIG'));
  for (const endpoint of [ENDPOINT, 'https://api-2.example.com:8443/v1/balance',
    'https://xn--bcher-kva.example.com/api', 'https://quota.example.com/a%20b']) {
    assert.equal(validateCustomConfig(config({endpoint})).endpoint, endpoint);
  }
});

test('only safe custom key/token headers are accepted, never transport or injected names', async () => {
  for (const headerName of ['X-API-Key', 'Api-Key', 'X-Custom-Key', 'X-Access-Token', 'Token']) {
    await fetchCustomQuota(config({auth: 'header', headerName}), MOCK_KEY, {fetchImpl: async (url, options) => {
      assert.deepEqual(options.headers, {Accept: 'application/json', [headerName]: MOCK_KEY});
      return response();
    }});
  }
  for (const headerName of ['Cookie', 'Host', 'Authorization', 'Accept', 'Connection', 'Content-Length',
    'Transfer-Encoding', 'Origin', 'Referer', 'Set-Cookie', 'Proxy-Authorization', 'Sec-Key',
    'X-Forwarded-Key', 'X-Original-Key', 'X-Rewrite-Key', 'X-HTTP-Method-Override',
    'X-API-Key\r\nCookie: x', 'X-API-Key: x', '__proto__', 'constructor', '', null, 'x'.repeat(65) + '-Key']) {
    assert.throws(() => validateCustomConfig(config({auth: 'header', headerName})), expectCode('INVALID_CONFIG'));
  }
});

test('dot paths reject code, prototype segments, ambiguous indices and excessive segments or length', () => {
  for (const remainingPath of ['', '.data', 'data.', 'data..balance', 'data[0].balance', 'data.01.balance',
    'data.-1.balance', 'data.*', 'data.balance()', 'data.balance;process.exit()',
    'data.__proto__.balance', '__proto__', 'data.constructor', 'prototype.balance',
    'data.balance\n', 'x'.repeat(257), Array(21).fill('x').join('.')]) {
    assert.throws(() => validateCustomConfig(config({remainingPath})), expectCode('INVALID_CONFIG'));
  }
  assert.equal(validateCustomConfig(config({remainingPath: 'x'.repeat(256)})).remainingPath.length, 256);
  assert.equal(validateCustomConfig(config({remainingPath: Array(20).fill('x').join('.')})).remainingPath.split('.').length, 20);
  assert.throws(() => validateCustomConfig(quotaConfig({totalPath: ''})), expectCode('INVALID_CONFIG'));
  assert.throws(() => validateCustomConfig(quotaConfig({usedPath: ''})), expectCode('INVALID_CONFIG'));
  assert.equal(validateCustomConfig(config({totalPath: '', usedPath: ''})).totalPath, '');
  assert.equal(validateCustomConfig(quotaConfig({remainingPath: ''})).remainingPath, '');
});

test('balance reads only its path, keeps precision and does not guess currency, totals or availability', () => {
  const input = Object.freeze({data: Object.freeze({balance: '12.345678901',
    get total() {assert.fail('unused total');}, get used() {assert.fail('unused used');}}),
  currency: 'USD', available: true, is_available: false, ignored: MOCK_KEY});
  assert.deepEqual(parseCustomResponse(input, config(), UPDATED_AT), {
    kind: 'balance', source: 'custom', currency: 'CREDIT', remaining: 12.345678901,
    total: null, used: null, percentage: null, available: null, updatedAt: UPDATED_AT,
    custom: {label: '第三方平台', scope: 'account'}
  });
  for (const currency of ['CREDIT', 'CNY', 'USD']) assert.equal(parseCustomResponse(input, config({currency})).currency, currency);
  assert.equal(JSON.stringify(parseCustomResponse(input, config())).includes(MOCK_KEY), false);
});

test('own-property traversal supports arrays and null-prototype records without invoking accessors', () => {
  const selected = config({remainingPath: 'data.wallets.0.amount'});
  assert.equal(parseCustomResponse({data: {wallets: [{amount: '3.123456789'}]}}, selected).remaining, 3.123456789);
  assert.equal(parseCustomResponse(Object.assign(Object.create(null), {data: Object.assign(Object.create(null), {balance: '2'})}), config()).remaining, 2);
  for (const input of [{data: Object.create({balance: '2'})}, {data: {balance: undefined}}, {data: null},
    {data: 2}, {data: []}, {get data() {throw new Error(MOCK_KEY);}},
    {data: {get balance() {throw new Error(MOCK_KEY);}}}]) {
    assert.throws(() => parseCustomResponse(input, config()), expectCode('INVALID_RESPONSE'));
  }
  assert.throws(() => parseCustomResponse({data: {wallets: []}}, selected), expectCode('INVALID_RESPONSE'));
  let getterCalls = 0;
  assert.throws(() => parseCustomResponse({data: {get balance() {getterCalls += 1; return '10';}}}, config()), expectCode('INVALID_RESPONSE'));
  assert.equal(getterCalls, 0);
  assert.throws(() => parseCustomResponse({data: {wallets: [1]}}, config({remainingPath: 'data.wallets.length'})), expectCode('INVALID_RESPONSE'));
  const nested = {};
  let parent = nested;
  for (let index = 0; index < 19; index += 1) {parent.x = {}; parent = parent.x;}
  parent.x = '9';
  assert.equal(parseCustomResponse(nested, config({remainingPath: Array(20).fill('x').join('.')})).remaining, 9);
});

test('invalid payloads and noncanonical observation times yield sanitized errors', () => {
  for (const input of [undefined, null, [], 1, false, 'json', {}, {error: MOCK_KEY}, {data: []}, Object.create(payload())]) {
    assert.throws(() => parseCustomResponse(input, config()), expectCode('INVALID_RESPONSE'));
  }
  for (const updatedAt of [null, '', 'invalid', MOCK_KEY, 0, '2026-11-04', '2026-11-04T00:00:00Z', '2026-11-04T00:00:00+00:00']) {
    assert.throws(() => parseCustomResponse(payload(), config(), updatedAt), expectCode('INVALID_RESPONSE'));
  }
  const before = Date.now();
  const result = parseCustomResponse(payload(), config());
  assert.ok(Date.parse(result.updatedAt) >= before && Date.parse(result.updatedAt) <= Date.now());
  assert.equal(parseCustomResponse(payload(), config(), UPDATED_AT).updatedAt, UPDATED_AT);
});

test('explicit top-level failures reject even valid zero amounts; unrelated generic fields remain ignored', async () => {
  for (const selected of [config(), quotaConfig(), newApiConfig()]) {
    const valid = selected.preset === 'newapi' ? {data: {total_granted: 0, total_used: 0}} : payload(0);
    for (const failure of [{success: false}, ...[{}, [], '', 0, undefined, 'bad', MOCK_KEY, true].map((error) => ({error}))]) {
      const input = {...valid, ...failure};
      assert.throws(() => parseCustomResponse(input, selected), expectCode('INVALID_RESPONSE'));
      if (failure.error !== undefined || !Object.hasOwn(failure, 'error')) {
        await assert.rejects(fetchCustomQuota(selected, MOCK_KEY, {fetchImpl: async () => response(input)}), expectCode('INVALID_RESPONSE'));
      }
    }
    for (const error of [null, false]) assert.equal(parseCustomResponse({...valid, success: true, error}, selected).remaining >= 0, true);
  }
  assert.equal(parseCustomResponse({...payload(0), success: 'false', status: 'error', message: MOCK_KEY, is_available: false}, config()).remaining, 0);
  assert.equal(parseCustomResponse({...payload(0), get unknown() {assert.fail('unknown field');}}, config()).remaining, 0);
});

test('amounts are strict nonnegative numbers or decimal strings, with safe raw and scaled bounds', () => {
  const invalid = ['', ' ', ' 1', '1 ', '-1', '+1', '1e3', '0x10', 'Infinity', 'NaN', '.5', '5.',
    '1,000', '1.2.3', '1\n', '１', '9'.repeat(257), NaN, Infinity, -Infinity, -1, undefined,
    null, {}, [], true, false, 1000000001, '1000000001'];
  for (const balance of invalid) assert.throws(() => parseCustomResponse({data: {balance}}, config()), expectCode('INVALID_RESPONSE'));
  for (const balance of [0, -0, 1, 0.123456789, '0', '0001.123456789', 1000000000, '1000000000']) {
    assert.equal(parseCustomResponse(payload(balance), config()).remaining, Number(balance) || 0);
  }
  assert.equal(parseCustomResponse(payload('123456789.123456789'), config({divisor: 1000})).remaining, Number('123456789.123456789') / 1000);
  assert.equal(parseCustomResponse(payload('0.00001'), config({divisor: 0.001})).remaining, 0.01);
  assert.equal(parseCustomResponse(payload(1e12), config({divisor: 1000})).remaining, 1e9);
  assert.equal(parseCustomResponse(payload(Number.MAX_SAFE_INTEGER), config({divisor: 1e9})).remaining, Number.MAX_SAFE_INTEGER / 1e9);
  for (const balance of [Number.MAX_SAFE_INTEGER + 1, 1e18, '9007199254740992',
    '9007199254740991.1', '0009007199254740991.00000001', '1000000000000000000']) {
    assert.throws(() => parseCustomResponse(payload(balance), config({divisor: 1e9})), expectCode('INVALID_RESPONSE'));
  }
  assert.equal(parseCustomResponse(payload('9007199254740991.0'), config({divisor: 1e9})).remaining, Number.MAX_SAFE_INTEGER / 1e9);
  assert.throws(() => parseCustomResponse(payload(1), config({divisor: Number.MIN_VALUE})), expectCode('INVALID_RESPONSE'));
  assert.throws(() => parseCustomResponse(payload(Number.MIN_VALUE), config({divisor: 1e9})), expectCode('INVALID_RESPONSE'));
  for (const field of ['total', 'used']) {
    for (const value of [...invalid, Number.MAX_SAFE_INTEGER + 1]) {
      const input = payload();
      input.data[field] = value;
      assert.throws(() => parseCustomResponse(input, quotaConfig()), expectCode('INVALID_RESPONSE'));
    }
    const input = payload();
    input.data[field] = Number.MAX_SAFE_INTEGER + 1;
    assert.throws(() => parseCustomResponse(input, quotaConfig({divisor: 1e9})), expectCode('INVALID_RESPONSE'));
  }
});

test('quota computes remaining, overage and unclamped percentages safely at zero total', () => {
  for (const [total, used, remaining, overage, percentage] of [[10, 3, 7, 0, 30], [10, 15, 0, 5, 150],
    [0, 0, 0, 0, 0], [0, 3, 0, 3, 100]]) {
    assert.deepEqual(parseCustomResponse({data: {total, used}}, quotaConfig(), UPDATED_AT), {
      kind: 'quota', source: 'custom', currency: 'CREDIT', total, used, remaining, overage, percentage,
      available: null, updatedAt: UPDATED_AT, custom: {label: '第三方平台', scope: 'account'}
    });
  }
  const precise = parseCustomResponse(payload(), quotaConfig({divisor: 100}));
  assert.equal(precise.total, 20.123456789 / 100);
  assert.equal(precise.used, 7.111111111 / 100);
  assert.equal(precise.remaining, precise.total - precise.used);
  assert.equal(precise.percentage, precise.used / precise.total * 100);
  assert.throws(() => parseCustomResponse({data: {total: Number.MIN_VALUE, used: 1}}, quotaConfig()), expectCode('INVALID_RESPONSE'));
  assert.equal(parseCustomResponse({data: {total: 10, used: 4, get balance() {assert.fail('unused balance');}}}, quotaConfig()).remaining, 6);
});

test('DeepSeek validates selected row currency and rejects unavailable payloads without changing cache shape', async () => {
  const input = {balance_infos: [{currency: 'USD', total_balance: '1.23456789'},
    {currency: 'CNY', total_balance: '9.87654321'}], is_available: true};
  const selected = config({preset: 'deepseek', currency: 'USD', remainingPath: 'balance_infos.0.total_balance'});
  assert.equal(parseCustomResponse(input, selected).remaining, 1.23456789);
  assert.equal(parseCustomResponse(input, {...selected, remainingPath: 'balance_infos.1.total_balance', currency: 'CNY'}).remaining, 9.87654321);
  for (const row of [{currency: 'CNY', total_balance: '5'}, {currency: 'usd', total_balance: '5'},
    {total_balance: '5'}, Object.create({currency: 'USD', total_balance: '5'})]) {
    assert.throws(() => parseCustomResponse({balance_infos: [row]}, selected), expectCode('INVALID_RESPONSE'));
  }
  assert.throws(() => parseCustomResponse(input, {...selected, currency: 'CNY'}), expectCode('INVALID_RESPONSE'));
  for (const changes of [{currency: 'CREDIT'}, {mode: 'quota'}, {remainingPath: 'data.balance'}]) {
    assert.throws(() => validateCustomConfig({...selected, ...changes}), expectCode('INVALID_CONFIG'));
  }
  assert.equal(parseCustomResponse({balance_infos: [input.balance_infos[0], {currency: MOCK_KEY}]}, selected).currency, 'USD');
  for (const failure of [{is_available: false}, {success: false}, {error: MOCK_KEY}]) {
    assert.throws(() => parseCustomResponse({...input, ...failure}, selected), expectCode('INVALID_RESPONSE'));
    await assert.rejects(fetchCustomQuota(selected, MOCK_KEY, {fetchImpl: async () => response({...input, ...failure})}), expectCode('INVALID_RESPONSE'));
  }
  assert.equal(parseCustomResponse(input, selected).available, null);
  assert.deepEqual(restoreCustomQuota(parseCustomResponse(input, selected, UPDATED_AT), selected), parseCustomResponse(input, selected, UPDATED_AT));
});

test('New API is token credit, reads only configured fields, and never guesses conversion units', () => {
  const input = {success: true, data: {total_granted: '1000000.123456789', total_used: '500000.012345678',
    unlimited_quota: false, get balance() {assert.fail('not account balance');},
    get total() {assert.fail('not configured');}, get used() {assert.fail('not configured');}}};
  const result = parseCustomResponse(input, newApiConfig());
  assert.equal(result.custom.scope, 'token');
  assert.equal(result.currency, 'CREDIT');
  assert.equal(result.total, 1000000.123456789);
  assert.equal(result.used, 500000.012345678);
  assert.equal(result.remaining, result.total - result.used);
  const mapping = newApiConfig({totalPath: 'wallet.cap', usedPath: 'wallet.spend', divisor: 1000, currency: 'USD'});
  assert.equal(parseCustomResponse({wallet: {cap: 2500, spend: 100}}, mapping).total, 2.5);
  assert.equal(parseCustomResponse({wallet: {cap: 2500, spend: 100}}, mapping).currency, 'USD');
  assert.throws(() => parseCustomResponse({data: {total: 10, used: 3}}, newApiConfig()), expectCode('INVALID_RESPONSE'));
  for (const data of [{total_granted: 10}, {total_used: 3}, {total_granted: null, total_used: 3}]) {
    assert.throws(() => parseCustomResponse({data}, newApiConfig()), expectCode('INVALID_RESPONSE'));
  }
});

test('New API explicitly rejects unlimited flags and negative or textual unlimited amount sentinels', () => {
  for (const field of ['unlimited_quota', 'unlimited']) {
    for (const flag of [true, 1, 'true', '1', 'yes', null, {}, []]) {
      for (const atRoot of [false, true]) {
        const input = {data: {total_granted: 10, total_used: 3}};
        (atRoot ? input : input.data)[field] = flag;
        assert.throws(() => parseCustomResponse(input, newApiConfig()), expectCode('INVALID_RESPONSE'));
      }
    }
    for (const flag of [false, 0, 'false', '0']) {
      assert.equal(parseCustomResponse({data: {total_granted: 10, total_used: 3, [field]: flag}}, newApiConfig()).remaining, 7);
    }
  }
  for (const total_granted of [-1, '-1', 'unlimited', '无限', Infinity]) {
    assert.throws(() => parseCustomResponse({data: {total_granted, total_used: 3}}, newApiConfig()), expectCode('INVALID_RESPONSE'));
  }
  assert.throws(() => parseCustomResponse({wallet: {cap: 10, spend: 2, unlimited_quota: true}},
    newApiConfig({totalPath: 'wallet.cap', usedPath: 'wallet.spend'})), expectCode('INVALID_RESPONSE'));
});

test('documented New API GetTokenUsage shape accepts code true without assuming success or account units', async () => {
  const input = {code: true, message: 'ok', data: {object: 'token_usage', total_granted: 1200000,
    total_used: 200000, total_available: 1000000, unlimited_quota: false,
    user_quota: {total_available: 9000000, total_used: 3000000}}};
  const selected = newApiConfig({endpoint: 'https://quota.example.com/api/usage/token/'});
  const result = await fetchCustomQuota(selected, MOCK_KEY, {fetchImpl: async (url) => {
    assert.equal(url, selected.endpoint);
    return response(input);
  }});
  assert.equal(result.total, 1200000);
  assert.equal(result.used, 200000);
  assert.equal(result.remaining, 1000000);
  assert.equal(result.currency, 'CREDIT');
  assert.equal(result.custom.scope, 'token');
  assert.throws(() => parseCustomResponse({object: 'credit_summary', total_granted: 1000000,
    total_used: 0, total_available: 1000000}, selected), expectCode('INVALID_RESPONSE'));
});

test('unknown quotas contain only null observations with explicit metadata and fresh objects', () => {
  for (const selected of [customDefaults(), quotaConfig(), newApiConfig()]) {
    const empty = emptyCustomQuota(selected);
    assert.equal(empty.kind, selected.mode);
    for (const field of ['remaining', 'total', 'used', 'percentage', 'available', 'updatedAt']) assert.equal(empty[field], null);
    if (selected.mode === 'quota') assert.equal(empty.overage, null);
    assert.equal(empty.custom.scope, selected.preset === 'newapi' ? 'token' : 'account');
    assert.deepEqual(restoreCustomQuota(empty, selected), empty);
    empty.custom.label = 'mutated';
    assert.equal(emptyCustomQuota(selected).custom.label, selected.label);
  }
});

test('restore validates source, config kind/currency/label/scope and canonical time', () => {
  for (const selected of [config(), quotaConfig(), newApiConfig()]) {
    const input = selected.preset === 'newapi' ? {data: {total_granted: '20.123456789', total_used: '7.111111111'}} : payload();
    const cached = parseCustomResponse(input, selected, UPDATED_AT);
    const stored = JSON.parse(JSON.stringify(cached));
    assert.deepEqual(restoreCustomQuota(stored, selected), cached);
    for (const source of ['deepseek', 'ept', 'manual', 'import', null]) {
      assert.throws(() => restoreCustomQuota({...stored, source}, selected), expectCode('INVALID_RESPONSE'));
    }
    for (const changes of [{kind: selected.mode === 'quota' ? 'balance' : 'quota'}, {currency: 'EUR'},
      {updatedAt: null}, {updatedAt: '2026-11-04'}, {updatedAt: MOCK_KEY}, {custom: null},
      {custom: {...stored.custom, label: '别的平台'}}, {custom: {...stored.custom, scope: 'other'}}]) {
      assert.throws(() => restoreCustomQuota({...stored, ...changes}, selected), expectCode('INVALID_RESPONSE'));
    }
    assert.throws(() => restoreCustomQuota(stored, {...selected, label: '别的平台'}), expectCode('INVALID_RESPONSE'));
    assert.throws(() => restoreCustomQuota(stored, {...selected, currency: selected.currency === 'USD' ? 'CNY' : 'USD'}), expectCode('INVALID_RESPONSE'));
    assert.throws(() => restoreCustomQuota(stored, {...selected, endpoint: ''}), expectCode('INVALID_RESPONSE'));
    assert.throws(() => restoreCustomQuota(Object.create(stored), selected), expectCode('INVALID_RESPONSE'));
    assert.throws(() => restoreCustomQuota({...stored, get custom() {throw new Error(MOCK_KEY);}}, selected), expectCode('INVALID_RESPONSE'));
  }
  assert.throws(() => restoreCustomQuota(parseCustomResponse(payload(), quotaConfig(), UPDATED_AT), newApiConfig()), expectCode('INVALID_RESPONSE'));
});

test('restore rejects corruption, partial unknowns and coercion without reapplying divisor or leaking extras', () => {
  for (const selected of [config({divisor: 100}), quotaConfig({divisor: 100})]) {
    const cached = parseCustomResponse(payload(), selected, UPDATED_AT);
    assert.deepEqual(restoreCustomQuota(Object.freeze(cached), selected), cached);
    for (const field of ['remaining', 'total', 'used', 'percentage', 'available', ...(selected.mode === 'quota' ? ['overage'] : [])]) {
      for (const value of [undefined, -1, NaN, Infinity, MOCK_KEY, 1000000001]) {
        assert.throws(() => restoreCustomQuota({...cached, [field]: value}, selected), expectCode('INVALID_RESPONSE'));
      }
      assert.throws(() => restoreCustomQuota({...emptyCustomQuota(selected), [field]: 0}, selected), expectCode('INVALID_RESPONSE'));
    }
    const numericField = selected.mode === 'quota' ? 'total' : 'remaining';
    assert.throws(() => restoreCustomQuota({...cached, [numericField]: String(cached[numericField])}, selected), expectCode('INVALID_RESPONSE'));
    assert.equal(JSON.stringify(restoreCustomQuota({...cached, token: MOCK_KEY, rawResponse: MOCK_KEY}, selected)).includes(MOCK_KEY), false);
  }
});

test('fixed GET keeps the isolated key out of URLs, bodies and caller-supplied overrides', async () => {
  let calls = 0;
  let requestSignal;
  const result = await fetchCustomQuota({...config(), method: 'POST', token: 'other-platform-token'}, '  ' + MOCK_KEY + '  ', {
    endpoint: 'https://evil.example', method: 'POST', headers: {Cookie: MOCK_KEY}, body: MOCK_KEY,
    fetchImpl: async (url, options) => {
      calls += 1;
      requestSignal = options.signal;
      assert.equal(url, ENDPOINT);
      assert.equal(url.includes(MOCK_KEY), false);
      assert.deepEqual(options.headers, {Accept: 'application/json', Authorization: 'Bearer ' + MOCK_KEY});
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.body, undefined);
      assert.equal(requestSignal.aborted, false);
      return response();
    }
  });
  assert.equal(calls, 1);
  assert.equal(requestSignal.aborted, true);
  assert.equal(result.remaining, 12.345678901);
  assert.equal(JSON.stringify(result).includes(MOCK_KEY), false);
});

test('none auth does not inspect or send a key; global fetch remains injectable without network', async (context) => {
  const unreadableKey = {toString() {assert.fail('must not inspect key');}};
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    return response();
  });
  assert.equal((await fetchCustomQuota(config({auth: 'none'}), unreadableKey)).source, 'custom');
  assert.equal((await fetchCustomQuota(config({auth: 'none'}))).source, 'custom');
});

test('invalid keys and options fail before requests and sanitize injected exceptions', async () => {
  let calls = 0;
  const fetchImpl = async () => {calls += 1; return response();};
  for (const key of [null, undefined, 123, {}, [], '', ' ', '\t', MOCK_KEY + '\n', MOCK_KEY + '\r\nCookie: x',
    MOCK_KEY + '\u0000', MOCK_KEY + '\u007f', MOCK_KEY + '\u0085', '中文', 'x'.repeat(8193)]) {
    await assert.rejects(fetchCustomQuota(config(), key, {fetchImpl}), expectCode('INVALID_KEY'));
  }
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 10001, 60000, '10', null, false]) {
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl, timeoutMs}), expectCode('INVALID_CONFIG'));
  }
  for (const options of [null, [], 'options', {fetchImpl: null}, {fetchImpl: false}, {fetchImpl: {}},
    {fetchImpl, signal: null}, {fetchImpl, signal: {}}, {fetchImpl, signal: 'signal'},
    {get fetchImpl() {throw new Error(MOCK_KEY);}}, {fetchImpl, get signal() {throw new Error(MOCK_KEY);}}]) {
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, options), expectCode('INVALID_CONFIG'));
  }
  assert.equal(calls, 0);
  await fetchCustomQuota(config(), 'x', {fetchImpl, timeoutMs: 1});
  await fetchCustomQuota(config(), 'not-sk-format', {fetchImpl, timeoutMs: 10000});
});

for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [429, 'RATE_LIMITED'],
  [204, 'HTTP_ERROR'], [302, 'HTTP_ERROR'], [402, 'HTTP_ERROR'], [500, 'HTTP_ERROR'], [503, 'HTTP_ERROR']]) {
  test('HTTP ' + status + ' maps to ' + code + ' without error body reads or retries', async () => {
    let calls = 0;
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => {
      calls += 1;
      return {status, statusText: MOCK_KEY, text: () => assert.fail('error body must not be read')};
    }}), expectCode(code));
    assert.equal(calls, 1);
  });
}

test('malformed responses, redirects and different destination URLs are rejected before body reads', async () => {
  for (const invalid of [undefined, null, {}, {status: '200'}, {status: NaN}, {status: 600},
    {status: 99}, {status: 200.5}, {status: 200}, {...response(), redirected: true},
    {...response(), url: 'https://evil.example/' + MOCK_KEY}, {status: 200, json: async () => payload()}]) {
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => invalid}), expectCode('INVALID_RESPONSE'));
  }
  assert.equal((await fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => ({...response(), url: ENDPOINT})})).source, 'custom');
});

test('transport failures, invalid JSON and body failures never expose raw errors', async () => {
  for (const failure of [new Error(MOCK_KEY + ' https://evil.example'), MOCK_KEY, null,
    Object.assign(new Error(MOCK_KEY), {name: 'AbortError'})]) {
    for (const fetchImpl of [() => {throw failure;}, async () => {throw failure;}]) {
      await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl}), expectCode('NETWORK'));
    }
  }
  for (const invalid of [{status: 200, text: async () => 'untrusted-body ' + MOCK_KEY},
    {status: 200, text: async () => null}, response({error: MOCK_KEY}), response(payload(MOCK_KEY))]) {
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => invalid}), expectCode('INVALID_RESPONSE'));
  }
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => ({
    status: 200, text: async () => {throw new Error(MOCK_KEY);}
  })}), expectCode('NETWORK'));
});

test('real Fetch streams and text test seams enforce the inclusive 64 KiB UTF-8 limit', async () => {
  const exact = JSON.stringify(payload()).padEnd(65536, ' ');
  for (const makeResponse of [() => new Response(exact), () => ({status: 200, text: async () => exact})]) {
    assert.equal((await fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => makeResponse()})).remaining, 12.345678901);
  }
  for (const invalid of [new Response(' '.repeat(65537)), {status: 200, text: async () => '界'.repeat(21846)},
    {status: 200, headers: new Headers({'Content-Length': '65537'}), text: () => assert.fail('overlarge declared body')},
    {status: 200, headers: new Headers({'Content-Length': 'invalid'}), text: () => assert.fail('invalid length')},
    new Response(JSON.stringify(payload()).padEnd(65537, ' '), {headers: {'Content-Length': '1'}})]) {
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => invalid}), expectCode('INVALID_RESPONSE'));
  }
});

test('stream decoding supports split UTF-8, rejects invalid bytes/chunks and cancels overflow', async () => {
  const bytes = Buffer.from(JSON.stringify({...payload(), ignored: '中文'}));
  const split = bytes.indexOf(Buffer.from('中')) + 1;
  const body = new ReadableStream({start(controller) {
    controller.enqueue(bytes.subarray(0, split));
    controller.enqueue(bytes.subarray(split));
    controller.close();
  }});
  assert.equal((await fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => new Response(body)})).remaining, 12.345678901);
  const invalidUtf8 = new Response(Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => invalidUtf8}), expectCode('INVALID_RESPONSE'));
  let cancelled = 0;
  let released = 0;
  for (const value of [Buffer.alloc(65537), 'not bytes', undefined]) {
    const reader = {read: async () => ({done: false, value}), cancel: () => {cancelled += 1;}, releaseLock: () => {released += 1;}};
    await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => ({status: 200, body: {getReader: () => reader}})}), expectCode('INVALID_RESPONSE'));
  }
  assert.equal(cancelled, 3);
  assert.equal(released, 3);
  const failed = new ReadableStream({start(controller) {controller.error(new Error(MOCK_KEY));}});
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => new Response(failed)}), expectCode('NETWORK'));
});

test('already cancelled signals never invoke fetch', async () => {
  const controller = new AbortController();
  controller.abort(new Error(MOCK_KEY));
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {
    signal: controller.signal, fetchImpl: () => assert.fail('already cancelled')
  }), expectCode('CANCELLED'));
});

for (const cooperative of [false, true]) {
  test('caller cancellation settles ' + (cooperative ? 'cooperative' : 'noncooperative') + ' fetch', async () => {
    const controller = new AbortController();
    let requestSignal;
    const pending = fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal, fetchImpl: (url, options) => {
      requestSignal = options.signal;
      return new Promise((resolve, reject) => {
        if (cooperative) requestSignal.addEventListener('abort', () => reject(new Error(MOCK_KEY)), {once: true});
      });
    }});
    const rejected = assert.rejects(pending, expectCode('CANCELLED'));
    controller.abort(new Error(MOCK_KEY));
    await rejected;
    assert.equal(requestSignal.aborted, true);
  });
}

test('default deadline is exactly ten seconds and settles a fetch ignoring AbortSignal', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let requestSignal;
  const pending = fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: (url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  }});
  const rejected = assert.rejects(pending, expectCode('TIMEOUT'));
  context.mock.timers.tick(9999);
  await Promise.resolve();
  assert.equal(requestSignal.aborted, false);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test('abort-driven fetch rejection at deadline remains TIMEOUT, not NETWORK or CANCELLED', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const pending = fetchCustomQuota(config(), MOCK_KEY, {timeoutMs: 10, fetchImpl: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(MOCK_KEY)), {once: true});
  })});
  const rejected = assert.rejects(pending, expectCode('TIMEOUT'));
  context.mock.timers.tick(10);
  await rejected;
});

for (const stage of ['text', 'stream']) {
  for (const code of ['TIMEOUT', 'CANCELLED']) {
    test(code + ' covers noncooperative ' + stage + ' body reads, without waiting for reader.cancel', async (context) => {
      context.mock.timers.enable({apis: ['setTimeout']});
      const controller = new AbortController();
      let reads = 0;
      let cancelled = 0;
      const hanging = () => {reads += 1; return new Promise(() => {});};
      const reader = {read: hanging, cancel: () => {cancelled += 1; return new Promise(() => {});}, releaseLock: () => {}};
      const pending = fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal, timeoutMs: 10,
        fetchImpl: async () => stage === 'text' ? {status: 200, text: hanging} : {status: 200, body: {getReader: () => reader}}});
      const rejected = assert.rejects(pending, expectCode(code));
      await tickTurn();
      assert.equal(reads, 1);
      if (code === 'TIMEOUT') context.mock.timers.tick(10);
      else controller.abort(new Error(MOCK_KEY));
      await rejected;
      if (stage === 'stream') assert.equal(cancelled, 1);
    });
  }
}

test('timeout covers stalled real Response streams and releases their locks', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const body = new ReadableStream({start(controller) {controller.enqueue(Buffer.from('{'));}});
  const pending = fetchCustomQuota(config(), MOCK_KEY, {timeoutMs: 10, fetchImpl: async () => new Response(body)});
  const rejected = assert.rejects(pending, expectCode('TIMEOUT'));
  await tickTurn();
  context.mock.timers.tick(10);
  await rejected;
  await tickTurn();
  assert.equal(body.locked, false);
});

test('late fetch results are not read and late fetch/body rejections are handled', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let bodyReads = 0;
  for (const code of ['TIMEOUT', 'CANCELLED']) {
    for (const lateFailure of [false, true]) {
      const controller = new AbortController();
      let resolveFetch;
      let rejectFetch;
      const pending = fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal, timeoutMs: 10,
        fetchImpl: () => new Promise((resolve, reject) => {resolveFetch = resolve; rejectFetch = reject;})});
      const rejected = assert.rejects(pending, expectCode(code));
      if (code === 'TIMEOUT') context.mock.timers.tick(10);
      else controller.abort();
      await rejected;
      if (lateFailure) rejectFetch(new Error(MOCK_KEY));
      else resolveFetch({status: 200, text: async () => {bodyReads += 1; return JSON.stringify(payload());}});
      await tickTurn();
    }
  }
  assert.equal(bodyReads, 0);
  for (const lateFailure of [false, true]) {
    let finishBody;
    let failBody;
    const pending = fetchCustomQuota(config(), MOCK_KEY, {timeoutMs: 10, fetchImpl: async () => ({status: 200,
      text: () => new Promise((resolve, reject) => {finishBody = resolve; failBody = reject;})})});
    const rejected = assert.rejects(pending, expectCode('TIMEOUT'));
    await tickTurn();
    context.mock.timers.tick(10);
    await rejected;
    if (lateFailure) failBody(new Error(MOCK_KEY));
    else finishBody(JSON.stringify(payload(999)));
    await tickTurn();
  }
});

test('parallel queries keep independent keys, controllers and cancellation results', async () => {
  const controller = new AbortController();
  let firstSignal;
  const first = fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal, fetchImpl: (url, options) => {
    firstSignal = options.signal;
    assert.equal(options.headers.Authorization, 'Bearer ' + MOCK_KEY);
    return new Promise(() => {});
  }});
  const rejected = assert.rejects(first, expectCode('CANCELLED'));
  const second = fetchCustomQuota(config({label: '其他平台', auth: 'header'}), 'separate-mock-key', {fetchImpl: async (url, options) => {
    assert.notEqual(options.signal, firstSignal);
    assert.equal(options.headers['X-API-Key'], 'separate-mock-key');
    return response(payload(7));
  }});
  controller.abort();
  await rejected;
  assert.equal((await second).remaining, 7);
});

test('success, failure and cancellation clear deadline timers and external signal listeners', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const clearTimer = context.mock.method(globalThis, 'clearTimeout');
  const controller = new AbortController();
  const removed = context.mock.method(controller.signal, 'removeEventListener');
  await fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal, fetchImpl: async () => response()});
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal,
    fetchImpl: async () => response({}, 401)}), expectCode('UNAUTHORIZED'));
  const pending = fetchCustomQuota(config(), MOCK_KEY, {signal: controller.signal, fetchImpl: () => new Promise(() => {})});
  const rejected = assert.rejects(pending, expectCode('CANCELLED'));
  controller.abort();
  await rejected;
  assert.equal(clearTimer.mock.callCount(), 3);
  assert.equal(removed.mock.callCount(), 3);
  context.mock.timers.tick(20000);
  await tickTurn();
});

test('provider never logs keys, payloads or raw exceptions on success or failure', async (context) => {
  const logs = ['log', 'info', 'warn', 'error', 'debug', 'trace'].map((method) => context.mock.method(console, method, () => {}));
  await fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => response({...payload(), ignored: MOCK_KEY})});
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => {throw new Error(MOCK_KEY);}}), expectCode('NETWORK'));
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => response({error: MOCK_KEY})}), expectCode('INVALID_RESPONSE'));
  await assert.rejects(fetchCustomQuota(config(), MOCK_KEY, {fetchImpl: async () => response({}, 401)}), expectCode('UNAUTHORIZED'));
  assert.throws(() => parseCustomResponse(payload(MOCK_KEY), config()), expectCode('INVALID_RESPONSE'));
  for (const logger of logs) assert.equal(logger.mock.callCount(), 0);
});
