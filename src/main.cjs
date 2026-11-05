const {app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, Notification, safeStorage, net} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createStore, validateSettings, emptyForSource} = require('./store.cjs');
const {PET_SIZES, clampPet, panelBounds, pointInside, speechBounds} = require('./appearance.cjs');
const {createSecretStore} = require('./secrets.cjs');
const {fetchEptQuota, resolveEptExecutable} = require('./providers/ept.cjs');
const {fetchDeepSeekBalance} = require('./providers/deepseek.cjs');
const {fetchCustomQuota, validateCustomConfig} = require('./providers/custom.cjs');
const {createStartup} = require('./startup.cjs');
const {chooseDialogue} = require('./dialogue.cjs');
const manifest = require('../assets/characters/manifest.json');

const directoryArgument = process.argv.find((argument) => argument.startsWith('--data-dir='));
const dataDirectory = directoryArgument ? path.resolve(directoryArgument.slice(11)) : path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..'), app.isPackaged ? 'user-data' : '.local-data');
app.setPath('userData', dataDirectory);
app.setPath('sessionData', path.join(dataDirectory, 'browser-session'));
app.setName('ChiikawaQuotaPet');
const rendererFile = path.join(__dirname, 'renderer', 'index.html');
const rendererUrl = pathToFileURL(rendererFile).href;
let petWindow;
let panelWindow;
let settingsWindow;
let bubbleWindow;
let tray;
let store;
let secretStore;
let customSecretStore;
let startup;
let speechTimer;
let speechSequence = 0;
let refreshTimer;
let cursorTimer;
let pendingRefresh;
let mutationQueue = Promise.resolve();
let accountGeneration = 0;
let quitting = false;
let dragOrigin;
let hoverUntil = 0;
let lastWarning = '';

function invalidateSource() {accountGeneration += 1; pendingRefresh?.controller.abort();}

function eptStatus() {
  try {return {available: true, executable: resolveEptExecutable(store.get().settings.eptExecutable), message: '将调用本机 EPT 已有账号 · 不读取或复制登录凭据'};}
  catch (error) {return {available: false, executable: null, message: error.message};}
}

function mutate(action) {
  const operation = mutationQueue.then(action);
  mutationQueue = operation.catch(() => {});
  return operation;
}

function characters() {
  const result = manifest.map((entry) => ({...entry, imageUrl: pathToFileURL(path.join(__dirname, '..', 'assets', 'characters', entry.file)).href}));
  try {
    const custom = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'custom-character.json'), 'utf8'));
    if (typeof custom.imageUrl === 'string' && /^data:image\/(png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(custom.imageUrl) && custom.imageUrl.length < 3000000) result.push({id: 'custom', name: '自定义', nameEn: 'Custom', imageUrl: custom.imageUrl, notice: '用户自行导入的本地素材'});
  } catch {}
  return result;
}

function snapshot() {
  const state = store.get();
  const startupStatus = startup.status();
  return {...state, settings: {...state.settings, autoStart: startupStatus.enabled}, characters: characters(), keyStatus: {available: secretStore.available(), persistent: secretStore.persistent()}, customKeyStatus: {available: customSecretStore.available(), persistent: customSecretStore.persistent()}, startupStatus, eptStatus: eptStatus()};
}

function publish() {
  const state = snapshot();
  for (const window of [petWindow, panelWindow, settingsWindow]) if (window && !window.isDestroyed()) window.webContents.send('pet:state', state);
  if (tray) tray.setToolTip('Chiikawa · 剩余 ' + (state.quota.currency === 'USD' ? '$' : state.quota.currency === 'CREDIT' ? 'credit ' : '¥') + (state.quota.remaining === null ? '待查询' : state.quota.remaining.toFixed(2)) + ' · ' + state.sync.message);
  return state;
}

function localPreferences() {return {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true};}
function protectLocal(window) {
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function updatePanelPosition() {
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const position = panelBounds(bounds, display.workArea);
  if (!position) {panelWindow.hide(); return false;}
  panelWindow.setBounds(position);
  return true;
}

function showPanel() {
  if (quitting || !petWindow.isVisible() || !updatePanelPosition()) return;
  if (bubbleWindow?.isVisible()) {
    const bounds = petWindow.getBounds();
    const position = speechBounds(bounds, screen.getDisplayMatching(bounds).workArea, panelWindow.getBounds());
    if (!position) {panelWindow.hide(); return;}
    bubbleWindow.setBounds(position);
  }
  panelWindow.showInactive();
}

function hideSpeech() {clearTimeout(speechTimer); bubbleWindow?.hide();}

function repositionSpeech() {
  if (!bubbleWindow?.isVisible()) return;
  const bounds = petWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  let position = speechBounds(bounds, area, panelWindow.isVisible() ? panelWindow.getBounds() : null);
  if (!position) {panelWindow.hide(); position = speechBounds(bounds, area);}
  if (position) bubbleWindow.setBounds(position); else hideSpeech();
}

function speak() {
  if (quitting || !store.get().settings.speechEnabled || !petWindow.isVisible() || dragOrigin || bubbleWindow.webContents.isLoading()) return;
  const settings = store.get().settings;
  const bounds = petWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  let position = speechBounds(bounds, area, panelWindow.isVisible() ? panelWindow.getBounds() : null);
  if (!position) {panelWindow.hide(); position = speechBounds(bounds, area);}
  if (!position) return;
  bubbleWindow.setBounds(position);
  bubbleWindow.webContents.send('pet:speech', {text: chooseDialogue(settings.character, store.get().quota, speechSequence++), name: characters().find((entry) => entry.id === settings.character)?.name || '桌宠'});
  bubbleWindow.showInactive();
  clearTimeout(speechTimer);
  speechTimer = setTimeout(hideSpeech, 4200);
}

function resizePet(initial = false) {
  const size = PET_SIZES[store.get().settings.petSize] + 14;
  const previous = petWindow.getBounds();
  const display = initial ? screen.getPrimaryDisplay() : screen.getDisplayMatching(previous);
  const workArea = display.workArea;
  const next = initial ? {x: workArea.x + workArea.width - size - 28, y: workArea.y + workArea.height - size - 22, width: size, height: size} : {...previous, x: previous.x + previous.width / 2 - size / 2, y: previous.y + previous.height - size, width: size, height: size};
  petWindow.setBounds(clampPet(next, workArea));
  updatePanelPosition();
  repositionSpeech();
}

function createWindows() {
  petWindow = new BrowserWindow({width: 179, height: 179, transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, maximizable: false, alwaysOnTop: store.get().settings.alwaysOnTop, skipTaskbar: true, show: false, webPreferences: localPreferences()});
  panelWindow = new BrowserWindow({width: 300, height: 194, transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, maximizable: false, alwaysOnTop: store.get().settings.alwaysOnTop, skipTaskbar: true, show: false, webPreferences: localPreferences()});
  bubbleWindow = new BrowserWindow({width: 220, height: 94, transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, maximizable: false, alwaysOnTop: store.get().settings.alwaysOnTop, skipTaskbar: true, show: false, focusable: false, webPreferences: localPreferences()});
  bubbleWindow.setIgnoreMouseEvents(true);
  for (const window of [petWindow, panelWindow, bubbleWindow]) {
    protectLocal(window);
    window.on('close', (event) => {if (!quitting) {event.preventDefault(); petWindow.hide(); panelWindow.hide(); hideSpeech();}});
  }
  petWindow.loadFile(rendererFile);
  panelWindow.loadFile(rendererFile, {query: {view: 'panel'}});
  bubbleWindow.loadFile(rendererFile, {query: {view: 'bubble'}});
  resizePet(true);
  petWindow.once('ready-to-show', () => {petWindow.show(); publish();});
  panelWindow.webContents.once('did-finish-load', publish);
  petWindow.webContents.on('context-menu', () => tray.popUpContextMenu());
  petWindow.on('move', () => {if (panelWindow.isVisible()) updatePanelPosition(); repositionSpeech();});
  screen.on('display-removed', () => resizePet(true));
  screen.on('display-metrics-changed', () => resizePet());
  cursorTimer = setInterval(() => {
    if (!petWindow.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const overPet = pointInside(cursor, petWindow.getBounds());
    const overPanel = panelWindow.isVisible() && pointInside(cursor, panelWindow.getBounds());
    petWindow.setIgnoreMouseEvents(!overPet && !dragOrigin, {forward: true});
    if (overPet || overPanel || dragOrigin) hoverUntil = Date.now() + 350;
    if (store.get().settings.displayMode === 'always' || Date.now() < hoverUntil && !dragOrigin) showPanel();
    else panelWindow.hide();
  }, 90);
}

function openSettings() {
  hideSpeech();
  petWindow.webContents.send('pet:cancel-poke');
  if (settingsWindow && !settingsWindow.isDestroyed()) {settingsWindow.show(); settingsWindow.focus(); return;}
  settingsWindow = new BrowserWindow({width: 650, height: 850, minWidth: 550, minHeight: 580, title: 'Chiikawa · 形象与额度设置', backgroundColor: '#f7f7f2', autoHideMenuBar: true, webPreferences: localPreferences()});
  protectLocal(settingsWindow);
  settingsWindow.loadFile(rendererFile, {query: {view: 'settings'}});
  settingsWindow.on('closed', () => {settingsWindow = null;});
}

function updateTrayImage() {
  const entry = manifest.find((item) => item.id === store.get().settings.character) || manifest[0];
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'characters', entry.file));
  tray.setImage(image.resize({width: 22, height: 22}));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'characters', manifest[0].file)).resize({width: 22, height: 22}));
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: '显示桌宠', click: () => petWindow.show()},
    {label: '形象 / 大小 / 额度设置', click: openSettings},
    {label: '刷新额度', click: () => refreshQuota().catch(() => {})},
    {type: 'separator'}, {label: '退出', click: () => app.quit()}
  ]));
  tray.on('click', () => petWindow.show());
}


function translateDeepSeek(error) {
  return {UNAUTHORIZED: 'DeepSeek Key 无效或过期，请重新输入', FORBIDDEN: 'DeepSeek 不允许查询此账户余额', RATE_LIMITED: 'DeepSeek 查询过于频繁，请稍后重试', TIMEOUT: 'DeepSeek 查询超时，请检查网络', INVALID_RESPONSE: 'DeepSeek 返回了无法识别的余额格式', NETWORK: '无法连接 DeepSeek 官方接口，请检查网络'}[error.code] || 'DeepSeek 查询失败，请检查 Key 与网络';
}

async function refreshQuota() {
  const generation = accountGeneration;
  await mutationQueue;
  if (generation !== accountGeneration) throw new Error('来源已变更，请重新同步');
  if (pendingRefresh?.generation === generation) return pendingRefresh.promise;
  const operation = {generation, promise: null, controller: new AbortController()};
  operation.promise = (async () => {
    try {
      const settings = store.get().settings;
      const sourceLabel = settings.sourceMode === 'ept' ? 'EPT 查询' : settings.sourceMode === 'deepseek' ? 'DeepSeek 查询' : '第三方查询';
      store.update({sync: {status: 'loading', message: settings.sourceMode === 'ept' ? '正在执行 ept usage 查询个人额度…' : settings.sourceMode === 'deepseek' ? '正在读取 DeepSeek 官方余额…' : '正在读取已配置第三方接口…', checkedAt: new Date().toISOString()}});
      publish();
      let quota;
      if (settings.sourceMode === 'deepseek') {
        try {quota = await fetchDeepSeekBalance(secretStore.get(), {fetchImpl: (url, options) => net.fetch(url, {...options, signal: AbortSignal.any([options.signal, operation.controller.signal])})});} catch (error) {throw new Error(error.code ? translateDeepSeek(error) : error.message);}
      } else if (settings.sourceMode === 'custom') {
        quota = await fetchCustomQuota(settings.customApi, settings.customApi.auth === 'none' ? '' : customSecretStore.get(), {signal: operation.controller.signal, fetchImpl: (url, options) => net.fetch(url, options)});
      } else {
        quota = await fetchEptQuota(settings, {signal: operation.controller.signal});
      }
      if (generation !== accountGeneration) throw new Error('来源已变更，旧同步结果已丢弃');
      store.update({quota, sync: {status: 'success', message: sourceLabel + ' · 本地读取 ' + new Date(quota.updatedAt).toLocaleTimeString('zh-CN'), checkedAt: quota.updatedAt}});
      if (quota.source === 'ept' && quota.percentage >= 80 && lastWarning !== quota.updatedAt.slice(0, 10) && Notification.isSupported()) {new Notification({title: 'Chiikawa：额度快用完啦', body: '剩余 ¥' + quota.remaining.toFixed(2)}).show(); lastWarning = quota.updatedAt.slice(0, 10);}
      return publish();
    } catch (error) {
      if (generation === accountGeneration) {store.update({sync: {status: 'error', message: error.message + ' · 保留旧值，非实时', checkedAt: new Date().toISOString()}}); publish();}
      throw error;
    }
  })();
  pendingRefresh = operation;
  try {return await operation.promise;} finally {if (pendingRefresh === operation) pendingRefresh = null;}
}

function canQuery(state) {
  return state.settings.sourceMode === 'ept' || state.settings.sourceMode === 'deepseek' && secretStore.available() || state.settings.sourceMode === 'custom' && state.settings.customApi.confirmed && Boolean(state.settings.customApi.endpoint) && (state.settings.customApi.auth === 'none' || customSecretStore.available());
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    const state = store.get();
    if (canQuery(state) && state.sync.status !== 'loading') refreshQuota().catch(() => {});
  }, store.get().settings.refreshMinutes * 60000);
}

async function saveSettings(input) {
  const previous = store.get().settings;
  const next = {...previous, ...validateSettings(input)};
  if (next.character === 'custom' && !characters().some((entry) => entry.id === 'custom')) throw new Error('请先导入本地角色图片');
  if ('autoStart' in input) startup.setEnabled(next.autoStart);
  const customChanged = JSON.stringify(next.customApi) !== JSON.stringify(previous.customApi);
  const targetChanged = ['endpoint', 'auth', 'headerName'].some((field) => next.customApi[field] !== previous.customApi[field]);
  const changed = next.sourceMode !== previous.sourceMode || next.eptExecutable !== previous.eptExecutable || customChanged;
  if (targetChanged) customSecretStore.clear();
  if (changed) {
    invalidateSource();
    store.update({settings: next, quota: emptyForSource(next), sync: {status: 'idle', message: next.sourceMode === 'deepseek' ? '余额尚未查询 · 不推测额度百分比' : next.sourceMode === 'ept' ? 'EPT 额度尚未查询' : '第三方接口尚未查询 · 请核对接口与单位', checkedAt: null}});
  }
  else store.update({settings: next});
  for (const window of [petWindow, panelWindow, bubbleWindow]) window.setAlwaysOnTop(next.alwaysOnTop);
  if (!next.speechEnabled || next.character !== previous.character) hideSpeech();
  resizePet(); updateTrayImage(); scheduleRefresh();
  if (next.displayMode === 'always') showPanel(); else panelWindow.hide();
  if (changed && next.sourceMode === 'ept') setImmediate(() => refreshQuota().catch(() => {}));
  return publish();
}

function registerIPC() {
  const authorized = (event) => [petWindow, panelWindow, settingsWindow].some((window) => window && !window.isDestroyed() && window.webContents === event.sender) && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.split('?')[0] === rendererUrl;
  const handle = (channel, action, settingsOnly = false) => ipcMain.handle(channel, async (event, payload) => {
    if (!authorized(event) || settingsOnly && event.sender !== settingsWindow?.webContents) return {ok: false, error: '来源未授权'};
    try {return {ok: true, data: await action(payload)};} catch (error) {return {ok: false, error: error.message};}
  });
  handle('pet:get-state', snapshot);
  handle('pet:save-settings', (input) => mutate(() => saveSettings(input)), true);
  handle('pet:select-ept', async () => {
    const selected = await dialog.showOpenDialog(settingsWindow, {title: '选择本机 ept.exe（不是命令或脚本）', filters: [{name: 'EPT 程序', extensions: ['exe']}], properties: ['openFile']});
    if (selected.canceled) return snapshot();
    const executable = resolveEptExecutable(selected.filePaths[0]);
    return mutate(() => saveSettings({eptExecutable: executable, sourceMode: 'ept'}));
  }, true);
  handle('pet:refresh', refreshQuota);
  handle('pet:save-key', (input) => mutate(() => {
    if (!input || typeof input.persist !== 'boolean') throw new Error('Key 设置无效');
    secretStore.save(input.key, input.persist); invalidateSource();
    const settings = {...store.get().settings, sourceMode: 'deepseek'};
    store.update({settings, quota: emptyForSource(settings), sync: {status: 'idle', message: 'Key 已保存，余额尚未查询', checkedAt: null}});
    scheduleRefresh();
    return publish();
  }), true);
  handle('pet:clear-key', () => mutate(() => {secretStore.clear(); if (store.get().settings.sourceMode === 'deepseek') {invalidateSource(); store.update({quota: emptyForSource(store.get().settings), sync: {status: 'idle', message: 'Key 已清除，余额未查询', checkedAt: null}});} return publish();}), true);
  handle('pet:save-custom-key', (input) => mutate(async () => {
    if (!input || typeof input.persist !== 'boolean') throw new Error('第三方 Key 设置无效');
    const config = validateCustomConfig(input.config);
    const targetChanged = ['endpoint', 'auth', 'headerName'].some((field) => config[field] !== store.get().settings.customApi[field]);
    let commitKey = () => customSecretStore.clear();
    if (config.auth !== 'none') {
      const supplied = typeof input.key === 'string' && input.key.trim();
      if (!supplied && (targetChanged || !customSecretStore.available())) throw new Error('请填写此平台自己的 API Key');
      commitKey = customSecretStore.prepare(supplied ? input.key : customSecretStore.get(), input.persist);
    }
    await saveSettings({sourceMode: 'custom', customApi: config});
    commitKey();
    invalidateSource();
    store.update({quota: emptyForSource(store.get().settings), sync: {status: 'idle', message: '第三方配置已保存，尚未查询', checkedAt: null}});
    return publish();
  }), true);
  handle('pet:clear-custom-key', () => mutate(() => {
    customSecretStore.clear();
    if (store.get().settings.sourceMode === 'custom') {invalidateSource(); store.update({quota: emptyForSource(store.get().settings), sync: {status: 'idle', message: '第三方 Key 已清除，尚未查询', checkedAt: null}});}
    return publish();
  }), true);
  handle('pet:import-character', async () => {
    const selected = await dialog.showOpenDialog(settingsWindow, {title: '选择你有权使用的透明角色图', filters: [{name: '角色图片', extensions: ['png', 'gif', 'webp']}], properties: ['openFile']});
    if (selected.canceled) return snapshot();
    const filename = selected.filePaths[0];
    if (fs.statSync(filename).size > 2000000) throw new Error('图片最多 2 MB');
    const buffer = fs.readFileSync(filename);
    if (nativeImage.createFromBuffer(buffer).isEmpty()) throw new Error('无法解码该图片');
    const extension = path.extname(filename).slice(1).toLowerCase();
    if (!['png', 'gif', 'webp'].includes(extension)) throw new Error('不支持的图片格式');
    fs.writeFileSync(path.join(dataDirectory, 'custom-character.json'), JSON.stringify({imageUrl: 'data:image/' + extension + ';base64,' + buffer.toString('base64')}));
    return mutate(() => saveSettings({character: 'custom'}));
  }, true);
  handle('pet:open-settings', openSettings);
  handle('pet:hide', () => {petWindow.hide(); panelWindow.hide(); hideSpeech();});
  handle('pet:quit', () => app.quit());
  for (const [channel, action] of [
    ['pet:hover', (active) => {if (active === true) {hoverUntil = Date.now() + 350; showPanel();}}],
    ['pet:poke', speak],
    ['pet:panel-hover', (active) => {if (active === true) hoverUntil = Date.now() + 350;}],
    ['pet:drag-start', () => {dragOrigin = petWindow.getBounds(); panelWindow.hide(); hideSpeech();}],
    ['pet:drag', (delta) => {if (!dragOrigin || !Number.isFinite(delta?.dx) || !Number.isFinite(delta?.dy) || Math.abs(delta.dx) > 20000 || Math.abs(delta.dy) > 20000) return; petWindow.setBounds(clampPet({...dragOrigin, x: dragOrigin.x + delta.dx, y: dragOrigin.y + delta.dy}, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));}],
    ['pet:drag-end', () => {dragOrigin = null;}]
  ]) ipcMain.on(channel, (event, payload) => {if (authorized(event) && (channel === 'pet:panel-hover' ? event.sender === panelWindow.webContents : event.sender === petWindow.webContents)) action(payload);});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (petWindow) petWindow.show();});
  app.whenReady().then(() => {
    fs.mkdirSync(dataDirectory, {recursive: true});
    store = createStore(dataDirectory); secretStore = createSecretStore(dataDirectory, safeStorage); customSecretStore = createSecretStore(dataDirectory, safeStorage, 'custom'); startup = createStartup(app, {isolated: Boolean(directoryArgument)});
    createTray(); createWindows(); registerIPC(); scheduleRefresh();
    if (canQuery(store.get())) setImmediate(() => refreshQuota().catch(() => {}));
  }).catch((error) => {dialog.showErrorBox('桌宠启动失败', error.message + '\n请解压到有写入权限的文件夹'); app.quit();});
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault(); quitting = true; clearInterval(refreshTimer); clearInterval(cursorTimer); clearTimeout(speechTimer); invalidateSource(); setImmediate(() => app.quit());
  });
  app.on('window-all-closed', () => {});
}
