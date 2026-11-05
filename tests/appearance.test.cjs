const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {PET_SIZES, clampPet, panelBounds} = require('../src/appearance.cjs');
const {createStore, validateSettings} = require('../src/store.cjs');
const {createSecretStore} = require('../src/secrets.cjs');
const {parseEptJson, emptyEptQuota} = require('../src/providers/ept.cjs');

test('三档尺寸与无重叠侧卡在四角 / 负坐标屏幕均可用', () => {
  for (const origin of [0, -1920]) for (const size of Object.values(PET_SIZES)) {
    const area = {x: origin, y: 0, width: 1920, height: 1080};
    for (const [x, y] of [[origin, 0], [origin + 1920 - size, 0], [origin, 1080 - size], [origin + 1920 - size, 1080 - size]]) {
      const pet = {x, y, width: size, height: size};
      const panel = panelBounds(pet, area);
      assert.ok(panel);
      assert.ok(panel.x >= area.x && panel.y >= area.y && panel.x + panel.width <= area.x + area.width && panel.y + panel.height <= area.y + area.height);
      assert.ok(panel.x + panel.width <= pet.x || pet.x + pet.width <= panel.x || panel.y + panel.height <= pet.y || pet.y + pet.height <= panel.y);
    }
  }
});
test('无法放置侧卡时不遮挡，拖动不能越出工作区', () => {
  assert.equal(panelBounds({x: 400, y: 0, width: 179, height: 179}, {x: 0, y: 0, width: 1000, height: 180}), null);
  assert.equal(panelBounds({x: 0, y: 400, width: 179, height: 179}, {x: 0, y: 0, width: 180, height: 1000}), null);
  assert.throws(() => panelBounds({x: 100, y: 400, width: 179, height: 179}, {x: 0, y: 0, width: 1000, height: 600}, NaN), TypeError);
  assert.equal(panelBounds({x: 0, y: 0, width: 235, height: 235}, {x: 0, y: 0, width: 250, height: 250}), null);
  assert.deepEqual(clampPet({x: -50, y: 950, width: 110, height: 110}, {x: 0, y: 0, width: 800, height: 600}), {x: 0, y: 490, width: 110, height: 110});
});
test('角色 / 尺寸 / 来源 / EPT路径校验', () => {
  assert.equal(validateSettings({character: 'chiikawa', petSize: 'small'}).petSize, 'small');
  for (const input of [{character: '../../evil'}, {petSize: 99}, {displayMode: 'modal'}, {sourceMode: 'other'}, {loginMode: 'token'}]) assert.throws(() => validateSettings(input));
  assert.throws(() => validateSettings({sourceMode: 'finops'}));
  assert.throws(() => validateSettings({eptExecutable: 'ept usage'}));
  assert.throws(() => validateSettings({eptExecutable: 'C:\\tools\\ept.cmd'}));
});
test('旧Finops状态迁移为EPT且不保存旧报告和登录配置，外观保留', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chiikawa-migrate-'));
  try {
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({settings: {sourceMode: 'finops', reportUrl: 'private-old-report', loginMode: 'browser', character: 'hachiware', petSize: 'large'}, quota: {total: 600, used: 100, source: 'live'}}));
    const store = createStore(directory);
    assert.equal(store.get().settings.sourceMode, 'ept');
    assert.equal(store.get().settings.character, 'hachiware');
    assert.equal(store.get().settings.petSize, 'large');
    assert.equal(store.get().quota.remaining, null);
    assert.equal('reportUrl' in store.get().settings, false);
    store.update({settings: store.get().settings});
    assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8').includes('private-old-report'), false);
    const quota = parseEptJson({total_budget: 600, actual_cost: 179.30498902, usage_percentage: 29.884164836666667, reset_cycle: 'monthly'});
    store.update({quota});
    const restored = createStore(directory).get();
    assert.equal(restored.quota.used, 179.30498902);
    assert.equal(restored.quota.remaining, quota.remaining);
    assert.match(restored.sync.message, /缓存/);
    store.update({quota: emptyEptQuota()});
    assert.equal(createStore(directory).get().quota.total, null);
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('chiikawa-migrate-')) throw new Error('Unsafe cleanup');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
});
test('状态迁移与未知 DeepSeek 余额不冒充示例', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chiikawa-store-'));
  try {
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({settings: {reportUrl: '', compact: true}, quota: {total: 600, used: 121.32, source: 'sample'}}));
    assert.equal(createStore(directory).get().settings.petSize, 'small');
    const store = createStore(directory);
    store.update({settings: {...store.get().settings, sourceMode: 'deepseek'}, quota: {kind: 'balance', source: 'deepseek', currency: 'CNY', remaining: null, total: null, used: null, percentage: null, available: false, updatedAt: null}});
    assert.equal(createStore(directory).get().quota.remaining, null);
    assert.equal(createStore(directory).get().quota.kind, 'balance');
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('chiikawa-store-')) throw new Error('Unsafe cleanup');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
});
test('Key 不进 state，系统加密保存 / 会话 Key / 清除', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chiikawa-secret-'));
  try {
    const encrypted = Buffer.from('opaque-test-ciphertext');
    const safeStorage = {isEncryptionAvailable: () => true, encryptString: () => encrypted, decryptString: () => 'test-secret'};
    const secrets = createSecretStore(directory, safeStorage);
    secrets.save('test-secret', true);
    assert.equal(secrets.get(), 'test-secret');
    assert.ok(!fs.readFileSync(path.join(directory, 'deepseek-key.bin')).includes('test-secret'));
    assert.equal(createSecretStore(directory, safeStorage).get(), 'test-secret');
    secrets.save('session-only', false);
    assert.equal(secrets.persistent(), false);
    assert.equal(secrets.get(), 'session-only');
    secrets.clear();
    assert.equal(secrets.available(), false);
    fs.writeFileSync(path.join(directory, 'deepseek-key.bin.tmp'), encrypted);
    secrets.clear();
    assert.equal(fs.existsSync(path.join(directory, 'deepseek-key.bin.tmp')), false);
    assert.throws(() => secrets.save('bad\r\nkey', true));
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('chiikawa-secret-')) throw new Error('Unsafe cleanup');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
});
