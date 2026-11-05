const test = require('node:test');
const assert = require('node:assert/strict');
const {fetchDeepSeekBalance, parseDeepSeekBalance} = require('../src/providers/deepseek.cjs');

const MOCK_KEY = 'mock-local-secret-do-not-send';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {throw new Error('Outbound network is forbidden in these tests');};
test.after(() => {globalThis.fetch = originalFetch;});

function balanceEntry(currency = 'CNY', total = '12.345678', granted = '2.000001', toppedUp = '10.345677') {
  return {currency, total_balance: total, granted_balance: granted, topped_up_balance: toppedUp};
}

function payload(entries = [balanceEntry()], available = true) {
  return {is_available: available, balance_infos: entries};
}

function jsonResponse(data = payload(), status = 200) {
  return {status, json: async () => data};
}

function expectCode(code) {
  return (error) => {
    assert.equal(error.name, 'DeepSeekBalanceError');
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    for (const exposed of [error.message, error.stack, JSON.stringify(error)]) {
      assert.equal(exposed.includes(MOCK_KEY), false);
      assert.equal(exposed.includes('untrusted-body'), false);
      assert.equal(exposed.includes('evil.example'), false);
    }
    return true;
  };
}

test('CommonJS exports only the two provider functions', () => {
  assert.deepEqual(Object.keys(require('../src/providers/deepseek.cjs')).sort(), ['fetchDeepSeekBalance', 'parseDeepSeekBalance']);
});

test('balance is remaining credit, not a 600 budget or a usage percentage', () => {
  const before = Date.now();
  const result = parseDeepSeekBalance(payload());
  assert.deepEqual({...result, updatedAt: null}, {
    kind: 'balance', source: 'deepseek', currency: 'CNY', remaining: 12.345678,
    total: null, used: null, percentage: null, updatedAt: null,
    details: {granted: 2.000001, toppedUp: 10.345677}, available: true
  });
  assert.equal(new Date(result.updatedAt).toISOString(), result.updatedAt);
  assert.ok(Date.parse(result.updatedAt) >= before && Date.parse(result.updatedAt) <= Date.now());
});

test('parser does not mutate frozen input and ignores unrelated extra fields', () => {
  const input = Object.freeze({
    is_available: true,
    balance_infos: Object.freeze([Object.freeze({...balanceEntry(), unknown: MOCK_KEY})]),
    total: 600, used: 123, percentage: 20, updatedAt: '2000-01-01T00:00:00.000Z'
  });
  const copy = JSON.stringify(input);
  const result = parseDeepSeekBalance(input);
  assert.equal(JSON.stringify(input), copy);
  assert.equal(JSON.stringify(result).includes(MOCK_KEY), false);
  assert.equal(result.total, null);
  assert.equal(result.used, null);
  assert.equal(result.percentage, null);
  assert.notEqual(result.updatedAt, input.updatedAt);
});

test('an explicit observation timestamp makes parsing deterministic without consulting the clock', () => {
  const updatedAt = '2026-11-04T00:00:00.000Z';
  assert.deepEqual(parseDeepSeekBalance(payload(), updatedAt), parseDeepSeekBalance(payload(), updatedAt));
  assert.equal(parseDeepSeekBalance(payload(), updatedAt).updatedAt, updatedAt);
  for (const invalid of [null, '', 'invalid', MOCK_KEY, 0, '2026-11-04', '2026-11-04T00:00:00+00:00']) {
    assert.throws(() => parseDeepSeekBalance(payload(), invalid), expectCode('INVALID_RESPONSE'));
  }
});

test('CNY wins over USD regardless of array order or a zero CNY balance', () => {
  const yuan = balanceEntry('CNY', '0', '0', '0');
  const dollar = balanceEntry('USD', '100', '10', '90');
  for (const entries of [[yuan, dollar], [dollar, yuan]]) {
    const result = parseDeepSeekBalance(payload(entries));
    assert.equal(result.currency, 'CNY');
    assert.equal(result.remaining, 0);
    assert.deepEqual(result.details, {granted: 0, toppedUp: 0});
  }
});

test('USD is supported when there is no CNY entry', () => {
  const result = parseDeepSeekBalance(payload([balanceEntry('USD', '10.50', '0.50', '10')]));
  assert.equal(result.currency, 'USD');
  assert.equal(result.remaining, 10.5);
  assert.deepEqual(result.details, {granted: 0.5, toppedUp: 10});
});

test('unavailable and zero balance remain explicit independent facts', () => {
  for (const available of [true, false]) {
    for (const entry of [balanceEntry(), balanceEntry('USD', '0.00', '0', '0.00')]) {
      const result = parseDeepSeekBalance(payload([entry], available));
      assert.equal(result.available, available);
      assert.equal(result.remaining, Number(entry.total_balance));
      assert.equal(result.percentage, null);
    }
  }
});

test('rejects missing, coerced, wrapped, empty and non-object response schemas', () => {
  for (const input of [null, undefined, [], 'json', 0, true, {}, {data: payload()},
    {balance_infos: [balanceEntry()]}, {is_available: true},
    payload([], false), payload(null), payload({}), payload([balanceEntry()], 'false'),
    payload([balanceEntry()], 1), payload([balanceEntry()], null)]) {
    assert.throws(() => parseDeepSeekBalance(input), expectCode('INVALID_RESPONSE'));
  }
});

test('rejects unsupported or duplicate currencies and validates unselected rows too', () => {
  for (const entries of [[balanceEntry('EUR')], [balanceEntry('cny')], [balanceEntry(' CNY')],
    [balanceEntry(), balanceEntry()], [balanceEntry('USD'), balanceEntry('USD')],
    [balanceEntry(), balanceEntry('EUR')], [balanceEntry(), balanceEntry('USD', 'NaN')],
    [balanceEntry(), balanceEntry('USD'), balanceEntry('CNY')], [null], [[]], ['CNY']]) {
    assert.throws(() => parseDeepSeekBalance(payload(entries)), expectCode('INVALID_RESPONSE'));
  }
});

test('every balance field is required and must be an own property', () => {
  for (const field of ['currency', 'total_balance', 'granted_balance', 'topped_up_balance']) {
    const entry = balanceEntry();
    delete entry[field];
    assert.throws(() => parseDeepSeekBalance(payload([entry])), expectCode('INVALID_RESPONSE'));
  }
  assert.throws(() => parseDeepSeekBalance(Object.create(payload())), expectCode('INVALID_RESPONSE'));
  assert.throws(() => parseDeepSeekBalance(payload([Object.create(balanceEntry())])), expectCode('INVALID_RESPONSE'));
});

test('amount strings are strict finite nonnegative decimals without coercion or cent rounding', () => {
  const invalid = ['', ' ', ' 1', '1 ', '-1', '+1', '1e3', '1e999', '0x10', 'Infinity', 'NaN',
    '1,000', '1.2.3', '.5', '5.', '1\n', '1\r', '￥10', '９', '9007199254740992', '9'.repeat(65),
    1, 0, NaN, Infinity, null, undefined, [], {}, true];
  for (const field of ['total_balance', 'granted_balance', 'topped_up_balance']) {
    for (const value of invalid) {
      assert.throws(() => parseDeepSeekBalance(payload([{...balanceEntry(), [field]: value}])), expectCode('INVALID_RESPONSE'));
    }
  }
  assert.equal(parseDeepSeekBalance(payload([balanceEntry('CNY', '0.3', '0.1', '0.2')])).remaining, 0.3);
});

test('parser errors do not expose payloads, even throwing property accessors', () => {
  assert.throws(() => parseDeepSeekBalance(payload([balanceEntry('CNY', MOCK_KEY)])), expectCode('INVALID_RESPONSE'));
  const input = {get is_available() {throw new Error(MOCK_KEY);}, balance_infos: []};
  assert.throws(() => parseDeepSeekBalance(input), expectCode('INVALID_RESPONSE'));
});

test('single fixed official GET; key only in Bearer header, cookies and redirects disabled', async () => {
  let calls = 0;
  let signal;
  const result = await fetchDeepSeekBalance(MOCK_KEY, {
    baseUrl: 'https://evil.example', url: 'https://evil.example/user/balance',
    fetchImpl: async (url, options) => {
      calls += 1;
      signal = options.signal;
      assert.equal(url, BALANCE_URL);
      assert.equal(url.includes(MOCK_KEY), false);
      assert.equal(options.method, 'GET');
      assert.deepEqual(options.headers, {Authorization: 'Bearer ' + MOCK_KEY, Accept: 'application/json'});
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(signal.aborted, false);
      return jsonResponse();
    }
  });
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  assert.equal(result.remaining, 12.345678);
  assert.equal(JSON.stringify(result).includes(MOCK_KEY), false);
});

test('default global fetch is replaceable without outbound network', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url) => {
    calls += 1;
    assert.equal(url, BALANCE_URL);
    return jsonResponse();
  });
  assert.equal((await fetchDeepSeekBalance(MOCK_KEY)).source, 'deepseek');
  assert.equal(calls, 1);
});

test('validates keys before fetch without assuming an sk prefix or exact length', async () => {
  let calls = 0;
  const fetchImpl = async () => {calls += 1; return jsonResponse();};
  for (const key of [undefined, null, 123, {}, [], '', ' ', '\t', MOCK_KEY + '\r', '\n' + MOCK_KEY, MOCK_KEY + '\r\nInjected: x']) {
    await assert.rejects(fetchDeepSeekBalance(key, {fetchImpl}), expectCode('INVALID_KEY'));
  }
  assert.equal(calls, 0);
  for (const key of ['x', 'not-sk-format', '  ' + MOCK_KEY + '  ']) {
    await fetchDeepSeekBalance(key, {fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer ' + key.trim());
      return jsonResponse();
    }});
  }
});

test('invalid fetch and timeout options fail without a request', async () => {
  let calls = 0;
  const fetchImpl = async () => {calls += 1; return jsonResponse();};
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 60001, '100', null, false]) {
    await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl, timeoutMs}), expectCode('INVALID_OPTIONS'));
  }
  for (const options of [null, [], 'options', {fetchImpl: null}, {fetchImpl: false}, {fetchImpl: {}},
    {get fetchImpl() {throw new Error(MOCK_KEY);}}]) {
    await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, options), expectCode('INVALID_OPTIONS'));
  }
  assert.equal(calls, 0);
  await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl, timeoutMs: 1});
  await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl, timeoutMs: 60000});
});

for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [429, 'RATE_LIMITED'],
  [402, 'HTTP_ERROR'], [500, 'HTTP_ERROR'], [503, 'HTTP_ERROR'], [204, 'HTTP_ERROR'], [302, 'HTTP_ERROR']]) {
  test('HTTP ' + status + ' yields sanitized ' + code + ' without reading error bodies or retrying', async () => {
    let calls = 0;
    let bodyReads = 0;
    await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => {
      calls += 1;
      return {status, statusText: MOCK_KEY, json: async () => {bodyReads += 1; throw new Error('untrusted-body ' + MOCK_KEY);}};
    }}), expectCode(code));
    assert.equal(calls, 1);
    assert.equal(bodyReads, 0);
  });
}

test('sync, rejected, aborted and non-Error transport failures are sanitized', async () => {
  for (const failure of [new Error(MOCK_KEY + ' https://evil.example'),
    Object.assign(new Error(MOCK_KEY), {name: 'AbortError'}), MOCK_KEY, null, {message: MOCK_KEY}]) {
    for (const fetchImpl of [() => {throw failure;}, async () => {throw failure;}]) {
      await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl}), expectCode('NETWORK'));
    }
  }
});

test('refuses malformed, redirected or off-origin responses', async () => {
  for (const response of [undefined, null, {}, {...jsonResponse(), status: '200'},
    {...jsonResponse(), status: NaN}, {...jsonResponse(), status: 600},
    {...jsonResponse(), redirected: true}, {...jsonResponse(), url: 'https://evil.example/' + MOCK_KEY},
    {status: 200}]) {
    await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => response}), expectCode('INVALID_RESPONSE'));
  }
});

test('invalid JSON, invalid schema and body failures never expose untrusted details', async () => {
  for (const response of [
    {status: 200, text: async () => 'untrusted-body ' + MOCK_KEY},
    {status: 200, json: async () => {throw new SyntaxError(MOCK_KEY);}},
    jsonResponse({error: MOCK_KEY}), jsonResponse(payload([balanceEntry('CNY', MOCK_KEY)]))
  ]) {
    await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => response}), expectCode('INVALID_RESPONSE'));
  }
  await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => ({
    status: 200, json: async () => {throw new Error(MOCK_KEY);}
  })}), expectCode('NETWORK'));
});

test('reads real Fetch Response streams and caps UTF-8 bytes at 64 KiB', async () => {
  const result = await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => new Response(JSON.stringify(payload()))});
  assert.equal(result.remaining, 12.345678);
  for (const response of [new Response(' '.repeat(65537)),
    {status: 200, text: async () => '界'.repeat(21846)}]) {
    await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => response}), expectCode('INVALID_RESPONSE'));
  }
  const padded = JSON.stringify(payload()).padEnd(65536, ' ');
  assert.equal((await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => new Response(padded)})).currency, 'CNY');
});

test('stream chunks are combined before parsing and read failures are sanitized', async () => {
  const content = Buffer.from(JSON.stringify(payload()));
  const body = new ReadableStream({start(controller) {
    controller.enqueue(content.subarray(0, 15));
    controller.enqueue(content.subarray(15));
    controller.close();
  }});
  assert.equal((await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => new Response(body)})).available, true);
  const failedBody = new ReadableStream({start(controller) {controller.error(new Error(MOCK_KEY));}});
  await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => new Response(failedBody)}), expectCode('NETWORK'));
});

test('timeout aborts and settles even when fetch ignores AbortSignal', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let signal;
  const promise = fetchDeepSeekBalance(MOCK_KEY, {timeoutMs: 10, fetchImpl: (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }});
  const rejection = assert.rejects(promise, expectCode('TIMEOUT'));
  context.mock.timers.tick(10);
  await rejection;
  assert.equal(signal.aborted, true);
});

test('default deadline is 10 seconds and abort-driven rejection still reports timeout', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let signal;
  const promise = fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: (url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(MOCK_KEY)), {once: true});
    });
  }});
  const rejection = assert.rejects(promise, expectCode('TIMEOUT'));
  context.mock.timers.tick(9999);
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await rejection;
  assert.equal(signal.aborted, true);
});

test('timeout includes hanging JSON body reads, not just response headers', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let signal;
  let bodyReads = 0;
  const promise = fetchDeepSeekBalance(MOCK_KEY, {timeoutMs: 10, fetchImpl: async (url, options) => {
    signal = options.signal;
    return {status: 200, json: () => {bodyReads += 1; return new Promise(() => {});}};
  }});
  const rejection = assert.rejects(promise, expectCode('TIMEOUT'));
  await new Promise(setImmediate);
  assert.equal(bodyReads, 1);
  context.mock.timers.tick(10);
  await rejection;
  assert.equal(signal.aborted, true);
});

test('timeout includes stalled real response streams', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const body = new ReadableStream({start(controller) {controller.enqueue(Buffer.from('{'));}});
  const promise = fetchDeepSeekBalance(MOCK_KEY, {timeoutMs: 10, fetchImpl: async () => new Response(body)});
  const rejection = assert.rejects(promise, expectCode('TIMEOUT'));
  await new Promise(setImmediate);
  context.mock.timers.tick(10);
  await rejection;
  await body.cancel();
});

test('late responses after timeout are not consumed and late failures are handled', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let resolveFetch;
  let rejectFetch;
  let bodyReads = 0;
  for (const failLate of [false, true]) {
    const promise = fetchDeepSeekBalance(MOCK_KEY, {timeoutMs: 10, fetchImpl: () => new Promise((resolve, reject) => {
      resolveFetch = resolve;
      rejectFetch = reject;
    })});
    const rejection = assert.rejects(promise, expectCode('TIMEOUT'));
    context.mock.timers.tick(10);
    await rejection;
    if (failLate) rejectFetch(new Error(MOCK_KEY));
    else resolveFetch({status: 200, json: async () => {bodyReads += 1; return payload();}});
    await new Promise(setImmediate);
  }
  assert.equal(bodyReads, 0);
});

test('finished requests clear their deadline timer', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const clearTimer = context.mock.method(globalThis, 'clearTimeout');
  await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => jsonResponse(), timeoutMs: 10});
  await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {
    fetchImpl: async () => jsonResponse(null, 401), timeoutMs: 10
  }), expectCode('UNAUTHORIZED'));
  assert.equal(clearTimer.mock.callCount(), 2);
  context.mock.timers.tick(1000);
  await new Promise(setImmediate);
});

test('successes and failures do not log keys, payloads or transport errors', async (context) => {
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => context.mock.method(console, method, () => {}));
  await fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => jsonResponse()});
  await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => {throw new Error(MOCK_KEY);}}), expectCode('NETWORK'));
  await assert.rejects(fetchDeepSeekBalance(MOCK_KEY, {fetchImpl: async () => jsonResponse({error: MOCK_KEY})}), expectCode('INVALID_RESPONSE'));
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
