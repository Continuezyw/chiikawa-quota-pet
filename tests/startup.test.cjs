const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const {createStartup} = require('../src/startup.cjs');

const EXECUTABLE = 'C:\\private-user\\桌宠目录\\ChiikawaQuotaPet.exe';
const APP_USER_MODEL_ID = 'electron.app.ChiikawaQuotaPet';
const PRIVATE_DETAILS = EXECUTABLE + ' --data-dir=C:\\private-data token=mock-secret native-registry-error';
const WINDOWS = {platform: 'win32'};

function launchItem(overrides = {}) {
  return {name: APP_USER_MODEL_ID, path: EXECUTABLE, args: [], enabled: true, scope: 'user', ...overrides};
}

function mockApp({isPackaged = true, executable = EXECUTABLE, settings = {openAtLogin: false}, read, write, pathError} = {}) {
  const calls = [];
  let current = settings;
  const app = {
    isPackaged,
    getPath(name) {
      calls.push({method: 'getPath', name});
      if (pathError) throw pathError;
      return executable;
    },
    getLoginItemSettings(options) {
      calls.push({method: 'getLoginItemSettings', options: structuredClone(options)});
      return read ? read(options, current) : current;
    },
    setLoginItemSettings(options) {
      calls.push({method: 'setLoginItemSettings', options: structuredClone(options)});
      if (write) {
        const updated = write(options, current);
        if (updated !== undefined) current = updated;
      } else {
        current = {openAtLogin: options.openAtLogin, executableWillLaunchAtLogin: options.openAtLogin,
          launchItems: options.openAtLogin ? [launchItem({path: executable})] : []};
      }
    }
  };
  return {app, calls, replaceSettings(value) {current = value;}};
}

function expectSafeError(pattern) {
  return (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, pattern);
    assert.equal(error.cause, undefined);
    for (const exposed of [error.message, error.stack, JSON.stringify(error)]) {
      for (const privateValue of [EXECUTABLE, 'private-data', 'mock-secret', 'native-registry-error']) assert.equal(exposed.includes(privateValue), false);
    }
    return true;
  };
}

function expectedWrite(enabled, executable = EXECUTABLE) {
  return {method: 'setLoginItemSettings', options: {openAtLogin: enabled, path: executable, args: []}};
}

function expectedRead(executable = EXECUTABLE) {
  return {method: 'getLoginItemSettings', options: {path: executable, args: []}};
}

test('仅导出 createStartup，返回固定的同步状态与开关接口', () => {
  assert.deepEqual(Object.keys(require('../src/startup.cjs')), ['createStartup']);
  const {app, calls} = mockApp();
  const startup = createStartup(app, WINDOWS);
  assert.deepEqual(Object.keys(startup), ['status', 'setEnabled']);
  assert.deepEqual(calls, []);
  const state = startup.status();
  assert.deepEqual(Object.keys(state), ['available', 'enabled', 'message']);
  assert.equal(state.available, true);
  assert.equal(state.enabled, false);
  assert.match(state.message, /关闭/);
  assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedRead()]);
});

for (const scenario of [
  {name: '开发版', isPackaged: false, options: WINDOWS, message: /开发版/},
  {name: '缺少明确打包标记', isPackaged: 'true', options: WINDOWS, message: /开发版/},
  {name: 'Windows 隔离 GUI 测试', isPackaged: true, options: {...WINDOWS, isolated: true}, message: /隔离/},
  {name: 'Linux', isPackaged: true, options: {platform: 'linux'}, message: /Windows/},
  {name: 'macOS', isPackaged: true, options: {platform: 'darwin'}, message: /Windows/}
]) {
  test(scenario.name + ' 禁止所有系统 API，包括关闭开关', () => {
    const {app, calls} = mockApp({isPackaged: scenario.isPackaged});
    const startup = createStartup(app, scenario.options);
    assert.deepEqual(calls, []);
    const state = startup.status();
    assert.equal(state.available, false);
    assert.equal(state.enabled, false);
    assert.match(state.message, scenario.message);
    for (const enabled of [true, false]) assert.throws(() => startup.setEnabled(enabled), expectSafeError(scenario.message));
    assert.deepEqual(calls, []);
  });
}

test('省略 options 或 platform 使用本机平台，创建不会默认启用或关闭', () => {
  for (const options of [undefined, {}, {isolated: false}]) {
    const {app, calls} = mockApp({settings: {openAtLogin: true}});
    const startup = createStartup(app, options);
    assert.deepEqual(calls, []);
    assert.equal(startup.status().available, process.platform === 'win32');
    assert.equal(calls.some((call) => call.method === 'setLoginItemSettings'), false);
  }
});

for (const argumentsList of [
  ['--data-dir=C:\\private-data'], ['--data-dir', 'C:\\private-data'], ['--data-dir=']
]) {
  test('实际 --data-dir 参数强制隔离，即使调用方未传 isolated：' + argumentsList[0], () => {
    const originalArguments = process.argv;
    try {
      process.argv = [...originalArguments, ...argumentsList];
      const {app, calls} = mockApp();
      const startup = createStartup(app, {...WINDOWS, isolated: false});
      assert.equal(startup.status().available, false);
      assert.match(startup.status().message, /隔离/);
      for (const enabled of [true, false]) assert.throws(() => startup.setEnabled(enabled), expectSafeError(/隔离/));
      assert.deepEqual(calls, []);
    } finally {process.argv = originalArguments;}
  });
}

test('status 尊重已有系统设置，重复读取和外部改变都不会写系统配置', () => {
  const fixture = mockApp({settings: {openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [launchItem()]}});
  const startup = createStartup(fixture.app, WINDOWS);
  assert.equal(startup.status().enabled, true);
  fixture.replaceSettings({openAtLogin: false, executableWillLaunchAtLogin: true, launchItems: [launchItem({args: ['--other']})]});
  assert.equal(startup.status().enabled, false);
  fixture.replaceSettings({openAtLogin: true});
  assert.equal(startup.status().enabled, true);
  assert.equal(fixture.calls.filter((call) => call.method === 'getLoginItemSettings').length, 3);
  assert.equal(fixture.calls.some((call) => call.method === 'setLoginItemSettings'), false);
});

test('用户启用和关闭都使用精确登录项参数，写完立即回读', () => {
  const {app, calls} = mockApp();
  const startup = createStartup(app, WINDOWS);
  assert.equal(startup.setEnabled(true).enabled, true);
  assert.equal(startup.setEnabled(false).enabled, false);
  assert.deepEqual(calls, [
    {method: 'getPath', name: 'exe'}, expectedWrite(true), expectedRead(),
    {method: 'getPath', name: 'exe'}, expectedWrite(false), expectedRead()
  ]);
});

test('native 契约：默认 AppUserModelID 写读一致，自定义 name 不会被 openAtLogin 回读', () => {
  const registry = new Map();
  const {app, calls} = mockApp({
    write: (options) => {
      const itemName = options.name ?? APP_USER_MODEL_ID;
      if (options.openAtLogin) registry.set(itemName, launchItem({name: itemName, path: options.path, args: options.args}));
      else registry.delete(itemName);
    },
    read: (options) => {
      const defaultItem = registry.get(APP_USER_MODEL_ID);
      const launchItems = [...registry.values()].filter((item) => item.path === options.path);
      return {
        openAtLogin: Boolean(defaultItem && defaultItem.path === options.path && JSON.stringify(defaultItem.args) === JSON.stringify(options.args)),
        executableWillLaunchAtLogin: launchItems.some((item) => item.enabled),
        launchItems
      };
    }
  });
  app.setLoginItemSettings({openAtLogin: true, path: EXECUTABLE, args: [], name: 'ChiikawaQuotaPet'});
  const customSettings = app.getLoginItemSettings({path: EXECUTABLE, args: []});
  assert.equal(customSettings.openAtLogin, false);
  assert.equal(customSettings.executableWillLaunchAtLogin, true);
  assert.equal(customSettings.launchItems[0].name, 'ChiikawaQuotaPet');
  app.setLoginItemSettings({openAtLogin: false, path: EXECUTABLE, args: [], name: 'ChiikawaQuotaPet'});
  calls.length = 0;

  const startup = createStartup(app, WINDOWS);
  assert.equal(startup.status().enabled, false);
  assert.equal(registry.size, 0);
  assert.equal(calls.some((call) => call.method === 'setLoginItemSettings'), false);
  assert.equal(startup.setEnabled(true).enabled, true);
  assert.deepEqual([...registry.keys()], [APP_USER_MODEL_ID]);
  assert.equal(startup.status().enabled, true);
  assert.equal(startup.setEnabled(false).enabled, false);
  assert.equal(registry.size, 0);
  assert.deepEqual(calls, [
    {method: 'getPath', name: 'exe'}, expectedRead(),
    {method: 'getPath', name: 'exe'}, expectedWrite(true), expectedRead(),
    {method: 'getPath', name: 'exe'}, expectedRead(),
    {method: 'getPath', name: 'exe'}, expectedWrite(false), expectedRead()
  ]);
});

test('即使系统已禁用或当前未注册，关闭也必须撤销本 app 登录项', () => {
  for (const settings of [
    {openAtLogin: false},
    {openAtLogin: true, executableWillLaunchAtLogin: false, launchItems: [launchItem({enabled: false})]}
  ]) {
    const {app, calls} = mockApp({settings});
    const startup = createStartup(app, WINDOWS);
    assert.equal(startup.status().enabled, false);
    calls.length = 0;
    assert.equal(startup.setEnabled(false).enabled, false);
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(false), expectedRead()]);
  }
});

test('双引号、空格和 shell 字符路径原样交给 Electron，绝不串 shell', (context) => {
  for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) {
    context.mock.method(childProcess, method, () => {throw new Error('Shell execution is forbidden');});
  }
  const executable = 'C:\\private-user\\目录 "双引号" & $(whoami)\\ChiikawaQuotaPet.exe';
  const {app, calls} = mockApp({executable});
  const startup = createStartup(app, WINDOWS);
  startup.setEnabled(true);
  startup.status();
  startup.setEnabled(false);
  assert.deepEqual(calls.filter((call) => call.method !== 'getPath'), [
    expectedWrite(true, executable), expectedRead(executable), expectedRead(executable),
    expectedWrite(false, executable), expectedRead(executable)
  ]);
  for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) assert.equal(childProcess[method].mock.callCount(), 0);
});

test('不继承 argv 或 options 中的凭据、路径、name、args', () => {
  const originalArguments = process.argv;
  try {
    process.argv = [...originalArguments, '--token=mock-secret', '--api-key=mock-secret'];
    const {app, calls} = mockApp();
    createStartup(app, {...WINDOWS, path: 'C:\\other.exe', name: 'OtherApp', args: ['--data-dir=C:\\private-data', '--token=mock-secret']}).setEnabled(true);
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(true), expectedRead()]);
  } finally {process.argv = originalArguments;}
});

for (const settings of [
  {openAtLogin: true, executableWillLaunchAtLogin: false},
  {openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [launchItem({enabled: false})]},
  {openAtLogin: true, launchItems: [launchItem({enabled: false})]},
  {openAtLogin: true, launchItems: [{enabled: false}]}
]) {
  test('注册存在但系统/任务管理器禁用时 enabled 为 false 并提示，不自动修复：' + JSON.stringify(settings), () => {
    const {app, calls} = mockApp({settings});
    const state = createStartup(app, WINDOWS).status();
    assert.equal(state.available, true);
    assert.equal(state.enabled, false);
    assert.match(state.message, /任务管理器.*禁用/);
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedRead()]);
  });
}

test('忽略其他路径和其他参数的禁用项，Windows 路径匹配不区分大小写', () => {
  for (const launchItems of [
    [launchItem(), launchItem({path: 'C:\\other.exe', enabled: false})],
    [launchItem(), launchItem({args: ['--other'], enabled: false})],
    [launchItem({path: EXECUTABLE.toUpperCase()})],
    [launchItem({enabled: false}), launchItem({name: 'AnotherCurrentEntry'})]
  ]) {
    const {app} = mockApp({settings: {openAtLogin: true, executableWillLaunchAtLogin: true, launchItems}});
    assert.equal(createStartup(app, WINDOWS).status().enabled, true);
  }
  const {app} = mockApp({settings: {openAtLogin: true, launchItems: [launchItem({path: EXECUTABLE.toUpperCase(), enabled: false})]}});
  assert.equal(createStartup(app, WINDOWS).status().enabled, false);
});

test('程序移动后提示手动重新启用，不自动注册或清理其他路径', () => {
  const executable = 'D:\\new-location\\ChiikawaQuotaPet.exe';
  const {app, calls} = mockApp({executable, settings: {openAtLogin: false, launchItems: [launchItem()]}});
  const startup = createStartup(app, WINDOWS);
  assert.equal(startup.status().enabled, false);
  assert.match(startup.status().message, /移动.*关闭开关.*重新开启.*重新启用/);
  assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedRead(executable), {method: 'getPath', name: 'exe'}, expectedRead(executable)]);
  calls.length = 0;
  assert.equal(startup.setEnabled(true).enabled, true);
  assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(true, executable), expectedRead(executable)]);
});

test('拒绝非 boolean 开关，不读取或写入系统项', () => {
  const {app, calls} = mockApp();
  const startup = createStartup(app, WINDOWS);
  for (const enabled of [undefined, null, 0, 1, '', 'false', 'true', {}, [], new Boolean(false)]) {
    assert.throws(() => startup.setEnabled(enabled), expectSafeError(/布尔值/));
  }
  assert.deepEqual(calls, []);
});

test('读取抛错净化为不可用状态，后续恢复能重新读取', () => {
  let failing = true;
  const {app, calls} = mockApp({read: () => {if (failing) throw new Error(PRIVATE_DETAILS); return {openAtLogin: true};}});
  const startup = createStartup(app, WINDOWS);
  assert.deepEqual(startup.status(), {available: false, enabled: false, message: '无法读取系统开机启动状态，请稍后重试。'});
  failing = false;
  assert.equal(startup.status().enabled, true);
  assert.equal(calls.some((call) => call.method === 'setLoginItemSettings'), false);
});

test('exe 读取抛错或返回空路径时净化错误，不写系统项', () => {
  for (const options of [{pathError: new Error(PRIVATE_DETAILS)}, {executable: ''}, {executable: null}]) {
    const {app, calls} = mockApp(options);
    const startup = createStartup(app, WINDOWS);
    assert.deepEqual(startup.status(), {available: false, enabled: false, message: '无法读取系统开机启动状态，请稍后重试。'});
    assert.throws(() => startup.setEnabled(true), expectSafeError(/无法读取/));
    assert.equal(calls.every((call) => call.method === 'getPath'), true);
  }
});

test('读 API 缺失或响应无效时不伪造关闭状态', () => {
  for (const settings of [undefined, null, {}, {openAtLogin: 'false'}, {openAtLogin: false, launchItems: {enabled: false}}]) {
    const {app} = mockApp({read: () => settings});
    assert.equal(createStartup(app, WINDOWS).status().available, false);
  }
  const {app} = mockApp();
  delete app.getLoginItemSettings;
  assert.equal(createStartup(app, WINDOWS).status().available, false);
});

test('系统写入抛错时开/关都抛净化中文错误，不继续回读或重试', () => {
  for (const enabled of [true, false]) {
    const {app, calls} = mockApp({write: () => {throw new Error(PRIVATE_DETAILS);}});
    assert.throws(() => createStartup(app, WINDOWS).setEnabled(enabled), expectSafeError(/无法修改/));
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(enabled)]);
  }
});

test('写后回读抛错时开/关都抛净化验证错误，不回滚或重试', () => {
  for (const enabled of [true, false]) {
    const {app, calls} = mockApp({read: () => {throw new Error(PRIVATE_DETAILS);}});
    assert.throws(() => createStartup(app, WINDOWS).setEnabled(enabled), expectSafeError(/回读验证/));
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(enabled), expectedRead()]);
  }
});

test('系统写入静默失败必须由回读发现，开启和关闭都不能虚报成功', () => {
  for (const enabled of [true, false]) {
    const {app, calls} = mockApp({settings: {openAtLogin: !enabled}, write: () => {}});
    assert.throws(() => createStartup(app, WINDOWS).setEnabled(enabled), expectSafeError(/回读验证/));
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(enabled), expectedRead()]);
  }
});

test('开启回读仍被任务管理器禁用时必须报错而非成功', () => {
  for (const settings of [
    {openAtLogin: true, executableWillLaunchAtLogin: false},
    {openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [launchItem({enabled: false})]}
  ]) {
    const {app, calls} = mockApp({write: () => settings});
    assert.throws(() => createStartup(app, WINDOWS).setEnabled(true), expectSafeError(/任务管理器.*禁用/));
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(true), expectedRead()]);
  }
});

test('关闭按同 path,args 回读确认，不因残留条目名称或旧路径误报', () => {
  for (const item of [launchItem({enabled: false}), launchItem({path: 'C:\\old-location\\ChiikawaQuotaPet.exe', enabled: false})]) {
    const {app, calls} = mockApp({write: () => ({openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [item]})});
    assert.equal(createStartup(app, WINDOWS).setEnabled(false).enabled, false);
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(false), expectedRead()]);
  }
});

test('关闭只验证本 app 登录项移除，不要求其他 app 或参数的系统项关闭', () => {
  const remaining = launchItem({name: 'OtherApp', args: ['--other']});
  const {app, calls} = mockApp({write: () => ({openAtLogin: false, executableWillLaunchAtLogin: true, launchItems: [remaining]})});
  assert.equal(createStartup(app, WINDOWS).setEnabled(false).enabled, false);
  assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(false), expectedRead()]);
});

test('恶意 getter 和非 Error 异常均不泄漏系统路径或异常详情', () => {
  const settings = {get openAtLogin() {throw new Error(PRIVATE_DETAILS);}};
  const {app} = mockApp({read: () => settings});
  const startup = createStartup(app, WINDOWS);
  assert.equal(startup.status().message.includes(PRIVATE_DETAILS), false);
  assert.throws(() => startup.setEnabled(true), expectSafeError(/回读验证/));
  for (const thrown of [PRIVATE_DETAILS, {message: PRIVATE_DETAILS}, null]) {
    const fixture = mockApp({write: () => {throw thrown;}});
    assert.throws(() => createStartup(fixture.app, WINDOWS).setEnabled(false), expectSafeError(/无法修改/));
  }
});

test('写 API 缺失时抛净化中文错误，不尝试其他系统操作', () => {
  const {app, calls} = mockApp();
  delete app.setLoginItemSettings;
  assert.throws(() => createStartup(app, WINDOWS).setEnabled(true), expectSafeError(/无法修改/));
  assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}]);
});

test('写后回读数据异常必须报验证错误，不能当作成功关闭', () => {
  for (const settings of [null, {}, {openAtLogin: 'false'}, {openAtLogin: false, launchItems: null}]) {
    const {app, calls} = mockApp({read: () => settings});
    assert.throws(() => createStartup(app, WINDOWS).setEnabled(false), expectSafeError(/回读验证/));
    assert.deepEqual(calls, [{method: 'getPath', name: 'exe'}, expectedWrite(false), expectedRead()]);
  }
});

test('状态、正常切换和系统异常都不输出路径、凭据或异常日志', (context) => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) context.mock.method(console, method, () => {});
  const {app} = mockApp();
  const startup = createStartup(app, WINDOWS);
  startup.status();
  startup.setEnabled(true);
  startup.setEnabled(false);
  const unreadable = mockApp({read: () => {throw new Error(PRIVATE_DETAILS);}});
  createStartup(unreadable.app, WINDOWS).status();
  assert.throws(() => createStartup(unreadable.app, WINDOWS).setEnabled(true), expectSafeError(/回读验证/));
  const unwritable = mockApp({write: () => {throw new Error(PRIVATE_DETAILS);}});
  assert.throws(() => createStartup(unwritable.app, WINDOWS).setEnabled(false), expectSafeError(/无法修改/));
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) assert.equal(console[method].mock.callCount(), 0);
});
