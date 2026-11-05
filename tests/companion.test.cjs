const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createStore, validateSettings} = require('../src/store.cjs');
const {createSecretStore} = require('../src/secrets.cjs');
const {speechBounds, panelBounds, overlaps} = require('../src/appearance.cjs');
const {chooseDialogue} = require('../src/dialogue.cjs');

function withDirectory(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-v040-'));
  try {action(directory);} finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('companion-v040-')) throw new Error('Unsafe cleanup');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
}

test('默认在线EPT、开启本地气泡、不开启系统自启动', () => {
  withDirectory((directory) => {
    const state = createStore(directory).get();
    assert.equal(state.settings.sourceMode, 'ept');
    assert.equal(state.settings.speechEnabled, true);
    assert.equal(state.settings.autoStart, false);
    assert.equal(state.quota.remaining, null);
  });
});

test('旧manual/import/sample来源升级清除额度，但保留全部外观', () => {
  withDirectory((directory) => {
    for (const sourceMode of ['manual', 'import', 'sample']) {
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({settings: {sourceMode, character: 'momonga', petSize: 'large', alwaysOnTop: false, reducedMotion: true}, quota: {total: 600, used: 321, source: sourceMode}}));
      const store = createStore(directory);
      const state = store.get();
      assert.equal(state.settings.sourceMode, 'ept');
      assert.equal(state.settings.character, 'momonga');
      assert.equal(state.settings.petSize, 'large');
      assert.equal(state.settings.alwaysOnTop, false);
      assert.equal(state.settings.reducedMotion, true);
      assert.equal(state.quota.used, null);
      store.update({settings: state.settings});
      assert.equal(fs.existsSync(path.join(directory, 'state.json.tmp')), false);
    }
  });
});

test('来源与新增开关拒绝脚本、旧离线和字符串布尔值', () => {
  for (const sourceMode of ['manual', 'import', 'sample', 'finops']) assert.throws(() => validateSettings({sourceMode}));
  for (const field of ['autoStart', 'speechEnabled']) {
    assert.deepEqual(validateSettings({[field]: false}), {[field]: false});
    assert.throws(() => validateSettings({[field]: 'false'}));
  }
  assert.throws(() => validateSettings({eptExecutable: 'C:\\tools\\ept.exe --token secret'}));
});

test('第三方Key与DeepSeek Key文件与会话完全隔离', () => {
  withDirectory((directory) => {
    const safeStorage = {isEncryptionAvailable: () => true, encryptString: (key) => Buffer.from(key === 'deepseek-test' ? 'encrypted-deepseek' : 'encrypted-custom'), decryptString: () => 'fixture'};
    const deepseek = createSecretStore(directory, safeStorage);
    const custom = createSecretStore(directory, safeStorage, 'custom');
    deepseek.save('deepseek-test', true); custom.save('custom-test', true);
    assert.equal(deepseek.get(), 'deepseek-test');
    assert.equal(custom.get(), 'custom-test');
    assert.equal(fs.existsSync(path.join(directory, 'custom-api-key.bin')), true);
    custom.clear();
    assert.equal(deepseek.get(), 'deepseek-test');
    assert.equal(custom.available(), false);
    assert.throws(() => custom.get());
    assert.throws(() => custom.save('bad\tKey', true));
    custom.save('session-only', false);
    assert.equal(custom.persistent(), false);
  });
});

test('气泡在屏幕四角、多尺寸和负坐标不碰撞角色及额度卡', () => {
  for (const origin of [0, -1920]) for (const size of [124, 179, 249]) {
    const area = {x: origin, y: 0, width: 1920, height: 1080};
    for (const [x, y] of [[origin, 0], [origin + 1920 - size, 0], [origin, 1080 - size], [origin + 1920 - size, 1080 - size]]) {
      const pet = {x, y, width: size, height: size};
      const panel = panelBounds(pet, area);
      const bubble = speechBounds(pet, area, panel);
      assert.ok(bubble);
      assert.equal(overlaps(pet, bubble), false);
      assert.equal(overlaps(panel, bubble), false);
      assert.ok(bubble.x >= area.x && bubble.y >= area.y && bubble.x + bubble.width <= area.x + area.width && bubble.y + bubble.height <= area.y + area.height);
    }
  }
});

test('Key校验和加密准备不改变既有文件或会话，错误不暴露原文', () => {
  withDirectory((directory) => {
    const storage = {isEncryptionAvailable: () => true, encryptString: () => Buffer.from('encrypted-old'), decryptString: () => 'old-key'};
    const custom = createSecretStore(directory, storage, 'custom');
    custom.save('old-key', true);
    storage.isEncryptionAvailable = () => false;
    assert.throws(() => custom.prepare('new-key', true), /系统加密不可用/);
    assert.equal(custom.get(), 'old-key');
    assert.equal(custom.persistent(), true);
    storage.isEncryptionAvailable = () => true;
    storage.encryptString = () => {throw new Error('secret-new-key');};
    assert.throws(() => custom.prepare('new-key', true), (error) => !error.message.includes('secret'));
    const commit = custom.prepare(custom.get(), false);
    assert.equal(custom.persistent(), true);
    commit();
    assert.equal(custom.persistent(), false);
    assert.equal(custom.get(), 'old-key');
  });
});

test('小屏气泡无法无碰撞放置时不覆盖形象，非法几何拒绝', () => {
  assert.equal(speechBounds({x: 0, y: 0, width: 249, height: 249}, {x: 0, y: 0, width: 260, height: 260}), null);
  assert.throws(() => speechBounds({x: NaN, y: 0, width: 100, height: 100}, {x: 0, y: 0, width: 500, height: 500}));
});

test('八角色本地台词各不相同、持续轮换、不嵌入Key或实时数值', () => {
  const ids = ['chiikawa', 'hachiware', 'usagi', 'kurimanju', 'momonga', 'rakko', 'shisa', 'furuhonya'];
  assert.equal(new Set(ids.map((id) => chooseDialogue(id))).size, ids.length);
  for (const id of ids) assert.notEqual(chooseDialogue(id, null, 0), chooseDialogue(id, null, 1));
  assert.match(chooseDialogue('chiikawa', {kind: 'quota', percentage: 80}, 4), /额度/);
  assert.equal(chooseDialogue('invalid', null, NaN), chooseDialogue('custom'));
});
