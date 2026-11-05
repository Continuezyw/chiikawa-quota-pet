const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {parseEptJson, parseEptText, restoreEptQuota, emptyEptQuota, resolveEptExecutable, fetchEptQuota} = require('../src/providers/ept.cjs');

const NOW = '2026-11-04T08:00:00.000Z';
const MOCK_KEY = 'sk-ept-fixture-secret-do-not-expose';
const PRIVATE_IDENTITY = 'fixture-only-private-identity';
const HOME_DIRECTORY = 'C:\\Users\\Synthetic Ept User';
const HOME_EXECUTABLE = path.win32.join(HOME_DIRECTORY, '.ept', 'bin', 'ept.exe');
const PATH_DIRECTORY = 'C:\\Synthetic Ept Tools';
const PATH_EXECUTABLE = path.win32.join(PATH_DIRECTORY, 'ept.exe');
const MAX_BUFFER = 1024 * 1024;
const JSON_ARGS = ['usage', '--summary-only', '--json'];
const TEXT_ARGS = ['usage'];
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'ept-usage.txt'), 'utf8');

function payload(overrides = {}) {
  return {
    plan_name: 'ultra', total_budget: 600, actual_cost: 179.30498902,
    usage_percentage: 29.884164836666667, reset_cycle: 'monthly', ...overrides
  };
}

function expectedQuota(total = 600, used = 179.30498902, reportedPercentage = 29.884164836666667) {
  return {
    kind: 'quota', source: 'ept', total, used, remaining: Math.max(0, total - used),
    overage: Math.max(0, used - total),
    percentage: total === 0 ? (used === 0 ? 0 : 100) : used / total * 100,
    updatedAt: NOW,
    ept: {planName: 'ultra', resetCycle: 'monthly', reportedPercentage, rangeStart: null, rangeEnd: null}
  };
}

function approximately(actual, expected, tolerance = 1e-10) {
  assert.equal(typeof actual, 'number');
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= tolerance, 'Amount or percentage must retain the agreed precision');
}

function sanitizedError(error) {
  assert.ok(error instanceof Error);
  assert.equal(error.cause, undefined);
  assert.equal(error.stdout, undefined);
  assert.equal(error.stderr, undefined);
  for (const exposed of [error.message, error.stack, JSON.stringify(error), ...Object.values(error).map(String)]) {
    for (const privateValue of [MOCK_KEY, PRIVATE_IDENTITY, 'untrusted-ept-output']) {
      assert.equal(String(exposed).includes(privateValue), false, 'Provider errors must not expose subprocess or identity data');
    }
  }
  return true;
}

function assertNoSnapshot(value) {
  if (value === null || value === undefined) return;
  assert.equal(value.updatedAt, null);
  for (const field of ['total', 'used', 'remaining', 'percentage']) assert.equal(value[field], null);
  assert.ok(value.overage === null || value.overage === 0);
  assert.equal(JSON.stringify(value).includes(MOCK_KEY), false);
  assert.equal(JSON.stringify(value).includes(PRIVATE_IDENTITY), false);
}

function windowsOptions(overrides = {}) {
  return {
    env: {PATH: PATH_DIRECTORY}, homeDirectory: HOME_DIRECTORY, platform: 'win32',
    existsSync: (filename) => filename === HOME_EXECUTABLE || filename === PATH_EXECUTABLE,
    ...overrides
  };
}

function fakeExecution(responses, {stall = false} = {}) {
  const calls = [];
  const execFileImpl = (executable, args, options, callback) => {
    const call = {executable, args: [...args], options, callback, kills: 0};
    calls.push(call);
    const child = new EventEmitter();
    child.kill = () => {call.kills += 1; return true;};
    call.child = child;
    const response = responses[calls.length - 1];
    if (response) queueMicrotask(() => callback(response.error || null, response.stdout || '', response.stderr || ''));
    else if (!stall) queueMicrotask(() => callback(new Error('Unexpected test subprocess call'), '', ''));
    return child;
  };
  return {calls, execFileImpl};
}

function commandFailure(code = 1) {
  return Object.assign(new Error('untrusted-ept-output ' + MOCK_KEY), {code, stdout: MOCK_KEY, stderr: PRIVATE_IDENTITY});
}

function personalText(used = '175.79', total = '600', percentage = '29.30') {
  return '## 使用情况汇总\n个人额度\n本月使用总金额: ' + used + ' 元\n月额度: ' + total + ' 元\n' +
    (percentage === null ? '' : '已使用百分比: ' + percentage + '%\n');
}

test('EPT CommonJS exports the six agreed provider functions', () => {
  for (const name of ['parseEptJson', 'parseEptText', 'restoreEptQuota', 'emptyEptQuota', 'resolveEptExecutable', 'fetchEptQuota']) {
    assert.equal(typeof require('../src/providers/ept.cjs')[name], 'function', name);
  }
});

test('known EPT JSON string and object produce the exact unrounded personal quota', () => {
  for (const input of [payload(), JSON.stringify(payload())]) {
    const quota = parseEptJson(input, NOW);
    assert.deepEqual(quota, expectedQuota());
    assert.equal(quota.used, 179.30498902);
    assert.notEqual(quota.used, 179.30);
    assert.equal(quota.percentage, quota.used / quota.total * 100);
  }
});

test('JSON ignores all unknown fields and identity without mutating frozen input', () => {
  const input = Object.freeze(payload({
    username: PRIVATE_IDENTITY, api_key: MOCK_KEY, raw: 'untrusted-ept-output',
    data: {total_budget: 999999, actual_cost: 0}, department: {total_budget: 999999},
    remaining: 999999, updatedAt: '2000-01-01T00:00:00.000Z'
  }));
  const original = JSON.stringify(input);
  const quota = parseEptJson(input, NOW);
  assert.deepEqual(quota, expectedQuota());
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(quota).includes(PRIVATE_IDENTITY), false);
  assert.equal(JSON.stringify(quota).includes(MOCK_KEY), false);
});

test('missing required budget, cost, percentage or reset cycle is rejected', () => {
  for (const field of ['total_budget', 'actual_cost', 'usage_percentage', 'reset_cycle']) {
    const input = payload();
    delete input[field];
    assert.throws(() => parseEptJson(input, NOW), sanitizedError, field);
  }
});

test('JSON rejects malformed strings, wrappers, arrays and scalar schemas', () => {
  for (const input of [null, undefined, false, 0, [], {}, '', ' ', '{broken ' + MOCK_KEY,
    '```json\n' + JSON.stringify(payload()) + '\n```', {data: payload()}, {quota: payload()},
    {summary: payload()}, JSON.stringify({data: payload()}), JSON.stringify([payload()])]) {
    assert.throws(() => parseEptJson(input, NOW), sanitizedError);
  }
});

test('JSON budget and actual cost require finite nonnegative numeric amounts up to one billion', () => {
  for (const field of ['total_budget', 'actual_cost']) {
    for (const value of [-1, -0.01, NaN, Infinity, -Infinity, 1000000001, '600', '0', '', null, undefined, true, [], {}, MOCK_KEY]) {
      assert.throws(() => parseEptJson(payload({[field]: value}), NOW), sanitizedError, field);
    }
  }
  assert.deepEqual(parseEptJson(payload({total_budget: 1000000000, actual_cost: 1000000000, usage_percentage: 100}), NOW),
    expectedQuota(1000000000, 1000000000, 100));
  const decimal = parseEptJson(payload({total_budget: 0.3, actual_cost: 0.1, usage_percentage: 100 / 3}), NOW);
  assert.equal(decimal.used, 0.1);
  approximately(decimal.remaining, 0.2);
});

test('reported JSON percentage is required, numeric, finite, nonnegative and agrees within 0.05 percentage points', () => {
  for (const value of [-1, NaN, Infinity, '29.88', null, undefined, true, [], {}, 0, 29, 30, MOCK_KEY]) {
    assert.throws(() => parseEptJson(payload({usage_percentage: value}), NOW), sanitizedError);
  }
  const arithmetic = 179.30498902 / 600 * 100;
  for (const difference of [-0.049, 0, 0.049]) {
    const quota = parseEptJson(payload({usage_percentage: arithmetic + difference}), NOW);
    assert.equal(quota.percentage, arithmetic);
    assert.equal(quota.ept.reportedPercentage, arithmetic + difference);
  }
  for (const difference of [-0.051, 0.051]) {
    assert.throws(() => parseEptJson(payload({usage_percentage: arithmetic + difference}), NOW), sanitizedError);
  }
});

test('zero usage, zero budget and overage retain valid bounded remaining amounts', () => {
  for (const [total, used, percentage] of [[600, 0, 0], [0, 0, 0], [0, 1, 100], [600, 700.125, 700.125 / 600 * 100]]) {
    const quota = parseEptJson(payload({total_budget: total, actual_cost: used, usage_percentage: percentage}), NOW);
    assert.deepEqual(quota, expectedQuota(total, used, percentage));
    assert.ok(Number.isFinite(quota.percentage));
    assert.ok(quota.remaining >= 0);
  }
});

test('JSON reset cycle cannot be missing, empty or coerced', () => {
  for (const reset_cycle of ['', ' ', null, undefined, 0, false, [], {}]) {
    assert.throws(() => parseEptJson(payload({reset_cycle}), NOW), sanitizedError);
  }
});

test('JSON and text observation timestamps are deterministic and valid ISO strings', () => {
  assert.equal(parseEptJson(payload(), NOW).updatedAt, NOW);
  assert.equal(parseEptText(FIXTURE, NOW).updatedAt, NOW);
  for (const parser of [() => parseEptJson(payload()), () => parseEptText(FIXTURE)]) {
    const before = Date.now();
    const quota = parser();
    assert.equal(new Date(quota.updatedAt).toISOString(), quota.updatedAt);
    assert.ok(Date.parse(quota.updatedAt) >= before && Date.parse(quota.updatedAt) <= Date.now());
  }
});

test('plain personal text labels remain supported independently of markdown formatting', () => {
  const quota = parseEptText(personalText().replaceAll('**', ''), NOW);
  assert.equal(quota.used, 175.79);
  assert.equal(quota.total, 600);
  approximately(quota.percentage, 175.79 / 600 * 100);
  assert.equal(quota.ept.reportedPercentage, 29.30);
});

test('user text sample reads 175.79 used, 424.21 remaining and approximately 29.30 percent', () => {
  const quota = parseEptText(FIXTURE, NOW);
  assert.equal(quota.kind, 'quota');
  assert.equal(quota.source, 'ept');
  assert.equal(quota.total, 600);
  assert.equal(quota.used, 175.79);
  approximately(quota.remaining, 424.21);
  approximately(quota.percentage, 29.298333333333336);
  assert.equal(quota.percentage.toFixed(2), '29.30');
  assert.equal(quota.overage, 0);
  assert.equal(quota.updatedAt, NOW);
  assert.equal(JSON.stringify(quota).includes(PRIVATE_IDENTITY), false);
});

test('department, Coding, LiWork, models and groups never replace or add to the personal amount', () => {
  const adversarial = FIXTURE.replace('170.50', '170,050').replace('5.29', '52,900').replace('9,999.98', '999,999,999');
  const quota = parseEptText(adversarial, NOW);
  assert.equal(quota.used, 175.79);
  assert.equal(quota.total, 600);
  approximately(quota.remaining, 424.21);
});

test('a percentage after the department boundary is ignored and personal arithmetic remains exact', () => {
  const input = (personalText('175.79', '600', null) +
    '**部门额度**\n**月额度**: 100,000 元\n**已使用百分比**: 29.30%\n').replaceAll('**', '');
  const quota = parseEptText(input, NOW);
  assert.equal(quota.used, 175.79);
  assert.equal(quota.total, 600);
  approximately(quota.remaining, 424.21);
  approximately(quota.percentage, 175.79 / 600 * 100);
  assert.equal(quota.ept.reportedPercentage, null);
});

test('text summary ends at the next level-two heading, not at a later personal-looking row', () => {
  assert.equal(parseEptText(personalText() + '\n## 明细\n' + personalText().replace('## 使用情况汇总\n', ''), NOW).used, 175.79);
  const missingPersonal = '## 使用情况汇总\nCoding: 170.50 元\nLiWork: 5.29 元\n## 明细\n' + personalText().replace('## 使用情况汇总\n', '');
  assert.throws(() => parseEptText(missingPersonal, NOW), sanitizedError);
});

test('ANSI, CRLF and irrelevant markdown-escaped underscores do not alter the personal quota', () => {
  const colored = '\u001b[32m' + FIXTURE.replaceAll('\n', '\r\n').replace('175.79', '\u001b[1m175.79\u001b[0m') + '\u001b[0m';
  const quota = parseEptText(colored, NOW);
  assert.equal(quota.used, 175.79);
  assert.equal(quota.total, 600);
  approximately(quota.remaining, 424.21);
});

test('amounts wrapped across whitespace and decimal newlines are parsed without summing detail rows', () => {
  for (const used of ['175.\n79', '175.\r\n  79', '\n175.79\n']) {
    const quota = parseEptText(personalText(used, '\n600\n'), NOW);
    assert.equal(quota.used, 175.79);
    assert.equal(quota.total, 600);
  }
});

test('text supports valid thousand separators and rejects malformed separators or non-yuan units', () => {
  const quota = parseEptText(personalText('1,175.79', '2,000', null), NOW);
  assert.equal(quota.used, 1175.79);
  assert.equal(quota.total, 2000);
  approximately(quota.remaining, 824.21);
  for (const amount of ['17,5.79', '1,,175.79', '175.79 USD', '175.79 万', '-175.79', '1e2', 'NaN', 'Infinity', '1,000,000,001', MOCK_KEY]) {
    assert.throws(() => parseEptText(personalText(amount, '600', null), NOW), sanitizedError);
  }
  for (const unit of ['万元', '美元', 'USD', '元/次']) {
    assert.throws(() => parseEptText(personalText().replaceAll(' 元', ' ' + unit), NOW), sanitizedError);
  }
});

test('optional text percentage is verified when present, not used as the arithmetic source', () => {
  const absent = parseEptText(personalText('175.79', '600', null), NOW);
  approximately(absent.percentage, 175.79 / 600 * 100);
  for (const percentage of ['29.25', '29.30', '29.34']) {
    approximately(parseEptText(personalText('175.79', '600', percentage), NOW).percentage, 175.79 / 600 * 100);
  }
  for (const percentage of ['29.24', '29.35', '0', '-1', 'NaN', 'Infinity', MOCK_KEY]) {
    assert.throws(() => parseEptText(personalText('175.79', '600', percentage), NOW), sanitizedError);
  }
});

test('text zero budget and overage do not produce negative remaining or infinite percentages', () => {
  for (const [used, total, percentage] of [['0', '0', '0'], ['1', '0', '100'], ['700.125', '600', null]]) {
    const quota = parseEptText(personalText(used, total, percentage), NOW);
    assert.equal(quota.used, Number(used));
    assert.equal(quota.total, Number(total));
    assert.equal(quota.remaining, 0);
    approximately(quota.overage, Math.max(0, Number(used) - Number(total)));
    assert.ok(Number.isFinite(quota.percentage));
  }
});

test('text rejects wrappers, missing or duplicate summaries, and incomplete personal amounts', () => {
  for (const input of [null, undefined, [], {}, '', MOCK_KEY, JSON.stringify(FIXTURE), JSON.stringify(payload()),
    FIXTURE.replace('## 使用情况汇总', '## 未知汇总'), FIXTURE + '\n' + FIXTURE,
    '## 使用情况汇总\n**部门额度**\n' + personalText().replace('## 使用情况汇总\n', ''),
    personalText().replace('本月使用总金额: 175.79 元\n', ''),
    personalText().replace('月额度: 600 元\n', ''),
    personalText().replace('175.79 元', '元'), personalText().replace('600 元', '元'),
    personalText().replace('175.79 元', '175.79'), personalText().replace('600 元', '600'),
    personalText() + '本月使用总金额: 175.79 元\n', personalText() + '月额度: 600 元\n']) {
    assert.throws(() => parseEptText(input, NOW), sanitizedError);
  }
});

test('empty quota has no sample budget, fabricated usage or observation timestamp', () => {
  const first = emptyEptQuota();
  assert.equal(first.kind, 'quota');
  assert.equal(first.source, 'ept');
  assertNoSnapshot(first);
  const second = emptyEptQuota();
  assert.notEqual(first, second);
  first.used = 123;
  assertNoSnapshot(second);
});

test('restoring EPT quota retains raw precision and timestamp but discards unknown or cached derived fields', () => {
  const input = Object.freeze({...expectedQuota(), remaining: 999999, percentage: 0, overage: 999999,
    username: PRIVATE_IDENTITY, stdout: MOCK_KEY, ept: Object.freeze({...expectedQuota().ept, username: PRIVATE_IDENTITY})});
  const original = JSON.stringify(input);
  const restored = restoreEptQuota(input);
  assert.deepEqual(restored, expectedQuota());
  assert.equal(JSON.stringify(input), original);
});

test('absent ranges are null and are never fabricated from the observation time or unknown stats', () => {
  const quotas = [parseEptJson(payload({stats: {rangeStart: NOW, rangeEnd: NOW}}), NOW),
    parseEptText(personalText().replaceAll('**', ''), NOW), restoreEptQuota(expectedQuota())];
  for (const quota of quotas) {
    assert.equal(quota.ept.rangeStart, null);
    assert.equal(quota.ept.rangeEnd, null);
    assert.equal(quota.updatedAt, NOW);
  }
});

test('restoring invalid, foreign or untimestamped data never invents a valid snapshot', () => {
  for (const input of [null, undefined, {}, [], payload(), {...expectedQuota(), source: 'manual'},
    {...expectedQuota(), source: 'deepseek'}, {...expectedQuota(), kind: 'balance'},
    {...expectedQuota(), used: -1}, {...expectedQuota(), used: '179.30498902'},
    {...expectedQuota(), total: Infinity}, {...expectedQuota(), total: 1000000001},
    {...expectedQuota(), updatedAt: null}, {...expectedQuota(), updatedAt: MOCK_KEY}]) {
    let restored;
    try {restored = restoreEptQuota(input);} catch (error) {sanitizedError(error); continue;}
    assertNoSnapshot(restored);
  }
});

test('automatic Windows resolution prefers home .ept/bin/ept.exe over absolute PATH', () => {
  const checked = [];
  const executable = resolveEptExecutable('', windowsOptions({existsSync: (filename) => {
    checked.push(filename);
    return filename === HOME_EXECUTABLE || filename === PATH_EXECUTABLE;
  }}));
  assert.equal(executable, HOME_EXECUTABLE);
  assert.equal(checked[0], HOME_EXECUTABLE);
});

test('Windows falls back to absolute PATH and supports the case-insensitive Path environment name', () => {
  for (const environmentKey of ['PATH', 'Path']) {
    assert.equal(resolveEptExecutable('', windowsOptions({
      env: {[environmentKey]: 'relative-tools;;' + PATH_DIRECTORY},
      existsSync: (filename) => filename === PATH_EXECUTABLE
    })), PATH_EXECUTABLE);
  }
});

test('explicit absolute ept.exe wins and is checked without appending or parsing shell arguments', () => {
  const executable = 'D:\\Synthetic Tools & Pets\\ept.exe';
  const checked = [];
  assert.equal(resolveEptExecutable(executable, windowsOptions({existsSync: (filename) => {
    checked.push(filename);
    return filename === executable;
  }})), executable);
  assert.deepEqual(checked, [executable]);
});

test('explicit executable rejects relative, wrong-basename, batch and shell command inputs without automatic fallback', () => {
  for (const executable of ['ept', 'ept.exe', '.\\ept.exe', 'C:ept.exe', '\\ept.exe',
    'C:\\Tools\\ept.cmd', 'C:\\Tools\\ept.bat', 'C:\\Tools\\powershell.exe',
    'C:\\Tools\\other.exe', 'C:\\Tools\\ept.exe --json', '"C:\\Tools\\ept.exe"',
    'C:\\Tools\\ept.exe & whoami', '%USERPROFILE%\\.ept\\bin\\ept.exe', null, 123, {}, []]) {
    assert.throws(() => resolveEptExecutable(executable, windowsOptions({existsSync: () => true})), sanitizedError);
  }
  assert.throws(() => resolveEptExecutable('D:\\Missing\\ept.exe', windowsOptions()), sanitizedError);
});

test('automatic discovery never accepts current-directory, relative PATH or batch executable shims', () => {
  const checked = [];
  assert.throws(() => resolveEptExecutable('', windowsOptions({env: {PATH: '.;relative-tools;C:drive-relative'},
    existsSync: (filename) => {checked.push(filename); return filename !== HOME_EXECUTABLE;}
  })), sanitizedError);
  assert.deepEqual(checked, [HOME_EXECUTABLE]);
  assert.throws(() => resolveEptExecutable('', windowsOptions({existsSync: () => false})), sanitizedError);
});

test('Unix explicit executable is absolute and named ept, never ept.exe or a shell wrapper', () => {
  const options = {platform: 'linux', homeDirectory: '/synthetic/home', env: {PATH: '/synthetic/bin'}, existsSync: () => true};
  assert.equal(resolveEptExecutable('/synthetic/bin/ept', options), '/synthetic/bin/ept');
  for (const executable of ['ept', './ept', '/synthetic/bin/ept.exe', '/synthetic/bin/ept.sh', '/bin/sh', '/synthetic/bin/ept --json']) {
    assert.throws(() => resolveEptExecutable(executable, options), sanitizedError);
  }
});

test('fetch uses one fixed JSON command with shell disabled, hidden window, home cwd and bounded output', async () => {
  const execution = fakeExecution([{stdout: JSON.stringify(payload()), stderr: MOCK_KEY + ' ' + PRIVATE_IDENTITY}]);
  const quota = await fetchEptQuota({eptExecutable: '', args: ['--token', MOCK_KEY], command: 'whoami'},
    windowsOptions({execFileImpl: execution.execFileImpl}));
  assert.equal(execution.calls.length, 1);
  const call = execution.calls[0];
  assert.equal(call.executable, HOME_EXECUTABLE);
  assert.deepEqual(call.args, JSON_ARGS);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.cwd, HOME_DIRECTORY);
  assert.equal(call.options.timeout, 30000);
  assert.ok(Number.isInteger(call.options.maxBuffer) && call.options.maxBuffer > 0 && call.options.maxBuffer <= MAX_BUFFER);
  assert.equal(quota.used, 179.30498902);
  assert.equal(quota.source, 'ept');
  assert.equal(JSON.stringify(quota).includes(MOCK_KEY), false);
  assert.equal(JSON.stringify(quota).includes(PRIVATE_IDENTITY), false);
});

test('fetch passes a configured safe executable verbatim and honors an explicit timeout', async () => {
  const executable = 'D:\\Synthetic Tools & Pets\\ept.exe';
  const execution = fakeExecution([{stdout: JSON.stringify(payload())}]);
  await fetchEptQuota({eptExecutable: executable}, windowsOptions({execFileImpl: execution.execFileImpl,
    timeoutMs: 1250, existsSync: (filename) => filename === executable}));
  assert.equal(execution.calls[0].executable, executable);
  assert.equal(execution.calls[0].options.timeout, 1250);
  assert.deepEqual(execution.calls[0].args, JSON_ARGS);
});

for (const diagnostic of ['unknown flag: --json', 'unknown flag: --summary-only']) {
    test('only an unsupported fixed flag allows one fixed text fallback: ' + diagnostic, async () => {
      const execution = fakeExecution([
        {error: commandFailure(), stdout: MOCK_KEY, stderr: diagnostic + '\n' + MOCK_KEY},
        {stdout: FIXTURE, stderr: PRIVATE_IDENTITY}
      ]);
      const quota = await fetchEptQuota({eptExecutable: ''}, windowsOptions({execFileImpl: execution.execFileImpl}));
      assert.equal(execution.calls.length, 2);
      assert.deepEqual(execution.calls.map((call) => call.args), [JSON_ARGS, TEXT_ARGS]);
      for (const call of execution.calls) {
        assert.equal(call.executable, HOME_EXECUTABLE);
        assert.equal(call.options.shell, false);
        assert.equal(call.options.windowsHide, true);
        assert.equal(call.options.cwd, HOME_DIRECTORY);
        assert.ok(call.options.maxBuffer <= MAX_BUFFER);
      }
      assert.equal(quota.used, 175.79);
      approximately(quota.remaining, 424.21);
      assert.equal(JSON.stringify(quota).includes(MOCK_KEY), false);
      assert.equal(JSON.stringify(quota).includes(PRIVATE_IDENTITY), false);
    });
}

test('execution forces NO_COLOR and removes ELECTRON_RUN_AS_NODE without mutating the injected environment', async () => {
  const env = Object.freeze({PATH: PATH_DIRECTORY, NO_COLOR: '0', ELECTRON_RUN_AS_NODE: '1'});
  const execution = fakeExecution([{stdout: JSON.stringify(payload())}]);
  await fetchEptQuota({}, windowsOptions({env, execFileImpl: execution.execFileImpl}));
  assert.equal(execution.calls[0].options.env.NO_COLOR, '1');
  assert.equal(Object.hasOwn(execution.calls[0].options.env, 'ELECTRON_RUN_AS_NODE'), false);
  assert.deepEqual(env, {PATH: PATH_DIRECTORY, NO_COLOR: '0', ELECTRON_RUN_AS_NODE: '1'});
});

test('exit, permission, auth, unknown command and other flag errors never fall back even with plausible stdout', async () => {
  for (const stderr of ['', 'permission denied ' + MOCK_KEY, 'authentication failed ' + MOCK_KEY,
    'unknown command: usage', 'unknown flag: --token', 'unknown flag: --json-extra',
    'unknown flag: --summary-only-extra', 'failed to parse --json', 'usage --json --summary-only']) {
    const execution = fakeExecution([{error: commandFailure(), stdout: JSON.stringify(payload()), stderr}, {stdout: FIXTURE}]);
    await assert.rejects(fetchEptQuota({eptExecutable: ''}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
    assert.equal(execution.calls.length, 1);
  }
  const execution = fakeExecution([{error: commandFailure('ENOENT'), stderr: MOCK_KEY}, {stdout: FIXTURE}]);
  await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
  assert.equal(execution.calls.length, 1);
});

test('unsupported flags in stdout or error.message, rather than stderr, cannot trigger fallback', async () => {
  const error = Object.assign(new Error('unknown flag: --json ' + MOCK_KEY), {code: 1});
  const execution = fakeExecution([{error, stdout: 'unknown flag: --json', stderr: 'authentication failed ' + MOCK_KEY}, {stdout: FIXTURE}]);
  await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
  assert.equal(execution.calls.length, 1);
});

test('successful non-JSON, invalid JSON, wrapper and invalid-schema output cannot silently use text fallback', async () => {
  for (const stdout of [FIXTURE, '', 'untrusted-ept-output ' + MOCK_KEY, '{broken', JSON.stringify({data: payload()}),
    JSON.stringify(payload({actual_cost: -1})), JSON.stringify(payload({usage_percentage: 0}))]) {
    const execution = fakeExecution([{stdout, stderr: 'unknown flag: --json'}, {stdout: FIXTURE}]);
    await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
    assert.equal(execution.calls.length, 1);
  }
});

test('failed or malformed fallback never yields a snapshot and cannot trigger a third command', async () => {
  for (const response of [{error: commandFailure(), stdout: FIXTURE, stderr: 'unknown flag: --json ' + MOCK_KEY},
    {stdout: FIXTURE.replace('## 使用情况汇总', '## 其他')}, {stdout: FIXTURE + FIXTURE}, {stdout: MOCK_KEY}]) {
    const execution = fakeExecution([{error: commandFailure(), stderr: 'unknown flag: --json'}, response, {stdout: FIXTURE}]);
    await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
    assert.equal(execution.calls.length, 2);
    assert.deepEqual(execution.calls[1].args, TEXT_ARGS);
  }
});

test('oversized ASCII and UTF-8 output are rejected even when an injected executor bypasses maxBuffer', async () => {
  for (const stdout of [JSON.stringify(payload({padding: 'x'.repeat(MAX_BUFFER)})),
    JSON.stringify(payload({padding: '界'.repeat(Math.ceil(MAX_BUFFER / 3))}))]) {
    assert.ok(Buffer.byteLength(stdout, 'utf8') > MAX_BUFFER);
    const execution = fakeExecution([{stdout}, {stdout: FIXTURE}]);
    await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
    assert.equal(execution.calls.length, 1);
  }
  const error = commandFailure('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  const execution = fakeExecution([{error, stdout: JSON.stringify(payload()), stderr: 'unknown flag: --json ' + MOCK_KEY}]);
  await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
  assert.equal(execution.calls.length, 1);
});

test('oversized fallback output and stderr cannot bypass the cap or trigger another command', async () => {
  const fallback = fakeExecution([{error: commandFailure(), stderr: 'unknown flag: --json'},
    {stdout: FIXTURE + ' '.repeat(MAX_BUFFER)}]);
  await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: fallback.execFileImpl})), sanitizedError);
  assert.equal(fallback.calls.length, 2);
  for (const error of [null, commandFailure()]) {
    const execution = fakeExecution([{error, stdout: JSON.stringify(payload()),
      stderr: 'unknown flag: --json\n' + MOCK_KEY + ' '.repeat(MAX_BUFFER)}, {stdout: FIXTURE}]);
    await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
    assert.equal(execution.calls.length, 1);
  }
});

test('invalid deadlines reject before subprocess execution', async () => {
  const execution = fakeExecution([{stdout: JSON.stringify(payload())}]);
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, '30000']) {
    await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl, timeoutMs})), sanitizedError);
  }
  assert.equal(execution.calls.length, 0);
});

test('synchronous injected executor failures are sanitized and never retried', async () => {
  let calls = 0;
  await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: () => {
    calls += 1;
    throw commandFailure();
  }})), sanitizedError);
  assert.equal(calls, 1);
});

test('unsafe or nonexistent configured executables fail before any subprocess call', async () => {
  const execution = fakeExecution([{stdout: JSON.stringify(payload())}]);
  for (const eptExecutable of ['ept.exe', 'C:\\Tools\\ept.cmd', 'C:\\Tools\\ept.exe & whoami', 'D:\\Missing\\ept.exe']) {
    await assert.rejects(fetchEptQuota({eptExecutable}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
  }
  assert.equal(execution.calls.length, 0);
});

test('pre-aborted requests never execute or return a cached-looking quota', async () => {
  const controller = new AbortController();
  controller.abort(new Error(MOCK_KEY));
  const execution = fakeExecution([{stdout: JSON.stringify(payload())}]);
  await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl, signal: controller.signal})), sanitizedError);
  assert.equal(execution.calls.length, 0);
});

test('cancellation settles without waiting for an uncooperative executor and late callbacks do not produce a quota', {timeout: 1000}, async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const controller = new AbortController();
  const execution = fakeExecution([], {stall: true});
  const operation = fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl, signal: controller.signal}));
  const rejection = assert.rejects(operation, sanitizedError);
  await new Promise(setImmediate);
  assert.equal(execution.calls.length, 1);
  controller.abort(new Error(MOCK_KEY));
  await rejection;
  execution.calls[0].callback(null, JSON.stringify(payload()), MOCK_KEY);
  await new Promise(setImmediate);
  assert.equal(execution.calls.length, 1);
});

test('the default 30-second deadline settles even when an injected executor never calls back', {timeout: 1000}, async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const execution = fakeExecution([], {stall: true});
  let settled = false;
  const operation = fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl}));
  const rejection = assert.rejects(operation, sanitizedError).then(() => {settled = true;});
  await new Promise(setImmediate);
  assert.equal(execution.calls.length, 1);
  context.mock.timers.tick(29999);
  await Promise.resolve();
  assert.equal(settled, false);
  context.mock.timers.tick(1);
  await rejection;
  execution.calls[0].callback(null, JSON.stringify(payload()), MOCK_KEY);
  await new Promise(setImmediate);
  assert.equal(execution.calls.length, 1);
});

test('a killed or timed-out process never activates unknown-flag fallback', async () => {
  for (const properties of [{killed: true, signal: 'SIGTERM'}, {code: 'ETIMEDOUT'}, {code: 'ABORT_ERR', name: 'AbortError'}]) {
    const execution = fakeExecution([{error: Object.assign(commandFailure(), properties), stdout: JSON.stringify(payload()), stderr: 'unknown flag: --json ' + MOCK_KEY}]);
    await assert.rejects(fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl})), sanitizedError);
    assert.equal(execution.calls.length, 1);
  }
});

test('JSON success, text fallback, failed stderr and malformed output never log raw streams or identities', async (context) => {
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => context.mock.method(console, method, () => {}));
  const responses = [
    [{stdout: JSON.stringify(payload({username: PRIVATE_IDENTITY, api_key: MOCK_KEY})), stderr: MOCK_KEY}],
    [{error: commandFailure(), stderr: 'unknown flag: --json ' + MOCK_KEY}, {stdout: FIXTURE}],
    [{error: commandFailure(), stderr: 'permission denied ' + MOCK_KEY}],
    [{stdout: 'untrusted-ept-output ' + MOCK_KEY}]
  ];
  for (const [index, response] of responses.entries()) {
    const execution = fakeExecution(response);
    const operation = fetchEptQuota({}, windowsOptions({execFileImpl: execution.execFileImpl}));
    if (index < 2) await operation;
    else await assert.rejects(operation, sanitizedError);
  }
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
