const element = (identifier) => document.getElementById(identifier);
const view = new URLSearchParams(location.search).get('view') || 'pet';
const desktop = Boolean(window.petAPI);
const amountFormatter = new Intl.NumberFormat('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false});
const formatAmount = (value) => amountFormatter.format(value);
let state;
let initialized = false;
let customDirty = false;
let eptDirty = false;
let toastTimer;
let pokeTimer;
let pointerStart;
let moved = false;
let characters = ['chiikawa', 'hachiware', 'usagi', 'kurimanju', 'momonga', 'rakko', 'shisa', 'furuhonya'].map((id, index) => ({id, name: ['吉伊', '小八', '乌萨奇', '栗子馒头', '飞鼠', '海獭', '狮萨', '古本屋'][index], nameEn: ['Chiikawa', 'Hachiware', 'Usagi', 'Kurimanju', 'Momonga', 'Rakko', 'Shisa', 'Furuhonya'][index], imageUrl: '../../assets/characters/' + id + '.png'}));
document.body.classList.toggle('settings-mode', view === 'settings');
document.body.classList.toggle('preview-mode', !desktop);
element('pet-view').hidden = view !== 'pet';
element('panel-view').hidden = view !== 'panel';
element('settings-view').hidden = view !== 'settings';
element('bubble-view').hidden = view !== 'bubble';
element('preview-notice').hidden = desktop;

function previewAPI() {
  const local = {settings: {eptExecutable: '', refreshMinutes: 5, alwaysOnTop: true, reducedMotion: false, speechEnabled: true, autoStart: false, character: 'chiikawa', petSize: 'medium', displayMode: 'hover', sourceMode: 'ept', customApi: {preset: 'generic', label: '第三方平台', endpoint: '', auth: 'bearer', headerName: 'X-API-Key', currency: 'CREDIT', mode: 'balance', remainingPath: 'data.balance', totalPath: 'data.total', usedPath: 'data.used', divisor: 1, confirmed: false}}, quota: {total: null, used: null, remaining: null, percentage: null, source: 'ept', updatedAt: null}, sync: {status: 'idle', message: '外观预览 · 不执行额度查询'}, startupStatus: {available: false, enabled: false, message: '请使用发行桌面程序设置自启动'}, characters};
  const result = () => ({ok: true, data: structuredClone(local)});
  const unsupported = () => ({ok: false, error: '请使用桌面程序运行此功能'});
  return {getState: result, onState: () => {}, onSpeech: () => {}, saveSettings: (input) => {Object.assign(local.settings, input); return result();}, openSettings: () => {location.search = '?view=settings'; return result();}, refresh: unsupported, selectEpt: unsupported, saveKey: unsupported, clearKey: unsupported, saveCustomKey: unsupported, clearCustomKey: unsupported, importCharacter: unsupported, hide: unsupported, quit: unsupported};
}
const api = desktop ? window.petAPI : previewAPI();

function notify(message) {
  element('toast').textContent = message;
  element('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {element('toast').hidden = true;}, 6000);
}

function buildCharacters() {
  element('character-grid').replaceChildren();
  for (const character of characters) {
    const button = document.createElement('button');
    button.className = 'character-choice';
    button.dataset.character = character.id;
    button.setAttribute('aria-label', '选择 ' + character.name);
    const image = document.createElement('img');
    image.src = character.imageUrl;
    image.alt = character.nameEn;
    const name = document.createElement('span');
    name.textContent = character.name;
    const english = document.createElement('small');
    english.textContent = character.nameEn;
    button.append(image, name, english);
    button.addEventListener('click', () => request(() => api.saveSettings({character: character.id})));
    element('character-grid').append(button);
  }
}

function render(next) {
  state = next;
  if (next.characters && JSON.stringify(characters) !== JSON.stringify(next.characters)) {characters = next.characters; buildCharacters();}
  const settings = state.settings;
  const quota = state.quota;
  const character = characters.find((item) => item.id === settings.character) || characters[0];
  for (const identifier of ['pet-image', 'settings-image']) {
    if (element(identifier).getAttribute('src') !== character.imageUrl) element(identifier).src = character.imageUrl;
    element(identifier).alt = character.name;
  }
  document.querySelectorAll('[data-character]').forEach((button) => {button.classList.toggle('selected', button.dataset.character === settings.character); button.setAttribute('aria-pressed', String(button.dataset.character === settings.character));});
  document.querySelectorAll('[data-size]').forEach((button) => {button.classList.toggle('active', button.dataset.size === settings.petSize); button.setAttribute('aria-pressed', String(button.dataset.size === settings.petSize));});
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  const balance = quota.kind === 'balance';
  const unavailable = balance && Number.isFinite(quota.remaining) && quota.available === false;
  document.body.classList.toggle('danger', !balance && quota.percentage >= 80 || unavailable);
  element('remaining').textContent = quota.remaining === null ? '—' : formatAmount(quota.remaining);
  element('currency').textContent = quota.currency === 'USD' ? '$' : quota.currency === 'CREDIT' ? '◈' : '¥';
  element('unit').textContent = quota.currency === 'USD' ? 'USD' : quota.currency === 'CREDIT' ? 'credit' : '元';
  const cycleName = {monthly: '本月', weekly: '本周', daily: '今日', yearly: '本年', none: ''}[quota.ept?.resetCycle] || '';
  element('panel-title').textContent = settings.sourceMode === 'deepseek' ? 'DeepSeek 余额' : settings.sourceMode === 'ept' ? 'EPT 额度' : settings.customApi.label + (balance ? '余额' : '额度');
  element('remaining-label').textContent = quota.custom?.scope === 'token' ? '令牌剩余额度 · 非账户余额' : balance ? '账户剩余余额' : cycleName + '可用额度';
  element('budget-info').hidden = balance;
  element('balance-info').hidden = !balance;
  element('balance-info').textContent = quota.remaining === null ? '尚未查询 · 不推测账户可用性或百分比' : unavailable ? '账户暂不可用 · 请以平台原站为准' : quota.source === 'custom' ? '按配置字段与单位显示 · 不推测总额度或比例' : '官方 API 不提供总限额 / 已用百分比';
  if (!balance) {
    element('used').textContent = quota.used === null ? '—' : formatAmount(quota.used);
    element('total').textContent = quota.total === null ? '—' : formatAmount(quota.total);
    element('percentage').textContent = quota.percentage === null ? '—' : quota.percentage.toFixed(2) + '%';
    element('progress-fill').style.width = Math.min(100, quota.percentage || 0) + '%';
  }
  const online = ['ept', 'deepseek', 'custom'].includes(quota.source);
  element('source').textContent = quota.remaining === null ? '待查询' : state.sync.status === 'success' ? quota.source === 'ept' ? 'EPT 查询' : quota.source === 'custom' ? '第三方查询' : '官方余额' : '上次缓存';
  element('source').classList.toggle('live', online && state.sync.status === 'success');
  element('status-text').textContent = state.sync.message;
  element('status-text').title = state.sync.message;
  element('status-dot').className = 'status-dot ' + state.sync.status;
  element('updated').textContent = quota.updatedAt ? new Date(quota.updatedAt).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false}) : '未同步';
  element('updated').title = quota.updatedAt || '没有真实采样时间';
  element('connection-status').textContent = state.sync.message;
  element('ept-diagnostic').textContent = state.eptStatus?.available ? '检测到 ' + state.eptStatus.executable : state.eptStatus?.message || '外观预览不执行命令';
  element('ept-diagnostic').classList.toggle('error', state.eptStatus?.available === false);
  element('ept-summary').textContent = quota.source === 'ept' && quota.ept ? '额度周期：' + ({monthly: '每月', weekly: '每周', daily: '每日', yearly: '每年', none: '无重置'}[quota.ept.resetCycle] || '未知') + (quota.ept.planName ? ' · 套餐：' + quota.ept.planName : '') + ' · 金额包含总花费，不仅是 AI Coding 分项' : '尚未获得 EPT 汇总；不假定总额度或已用金额。';
  element('always-top').checked = settings.alwaysOnTop;
  element('reduced-motion').checked = settings.reducedMotion;
  element('speech-enabled').checked = settings.speechEnabled;
  element('auto-start').checked = settings.autoStart;
  element('auto-start').disabled = state.startupStatus?.available !== true;
  element('startup-status').textContent = state.startupStatus?.message || '未读取系统自启动状态';
  element('display-mode').value = settings.displayMode;
  element('source-mode').value = settings.sourceMode;
  element('ept-settings').hidden = settings.sourceMode !== 'ept';
  element('deepseek-settings').hidden = settings.sourceMode !== 'deepseek';
  element('custom-settings').hidden = settings.sourceMode !== 'custom';
  element('key-status').textContent = state.keyStatus?.available ? state.keyStatus.persistent ? '已保存本机加密 Key · 不会显示原文' : 'Key 仅本次使用，退出后需重新输入' : '尚未设置 Key，不会传入桌宠状态或分享包。';
  element('custom-key-status').textContent = state.customKeyStatus?.available ? state.customKeyStatus.persistent ? '已保存此平台加密 Key · 不显示原文' : '此平台 Key 仅本次使用，退出后需重新输入' : '未设置第三方 Key；不会复用 DeepSeek Key。';
  element('refresh').disabled = state.sync.status === 'loading';
  element('read-now').disabled = state.sync.status === 'loading';
  element('save-custom').disabled = state.sync.status === 'loading';
  if (!customDirty) {
    for (const [identifier, field] of customFields) element(identifier).value = String(settings.customApi[field]);
    element('custom-confirm').checked = settings.customApi.confirmed;
    updateCustomFields();
  }
  if (!initialized || !eptDirty && document.activeElement !== element('ept-executable')) element('ept-executable').value = settings.eptExecutable;
  if (!initialized) {element('interval').value = String(settings.refreshMinutes); initialized = true;}
}

async function request(action, message) {
  try {
    const result = await action();
    if (!result.ok) throw new Error(result.error || '操作失败');
    if (result.data?.quota) render(result.data);
    if (message) notify(message);
    return true;
  } catch (error) {notify(error.message); return false;}
}

const customFields = [['custom-preset', 'preset'], ['custom-label', 'label'], ['custom-endpoint', 'endpoint'], ['custom-auth', 'auth'], ['custom-header', 'headerName'], ['custom-currency', 'currency'], ['custom-mode', 'mode'], ['custom-remaining', 'remainingPath'], ['custom-total', 'totalPath'], ['custom-used', 'usedPath'], ['custom-divisor', 'divisor']];
function customConfig() {
  return {...Object.fromEntries(customFields.map(([identifier, field]) => [field, element(identifier).value.trim()])), divisor: Number(element('custom-divisor').value), confirmed: element('custom-confirm').checked};
}
function updateCustomFields() {
  element('custom-header-field').hidden = element('custom-auth').value !== 'header';
  element('custom-key-fields').hidden = element('custom-auth').value === 'none';
  element('custom-balance-fields').hidden = element('custom-mode').value !== 'balance';
  element('custom-quota-fields').hidden = element('custom-mode').value !== 'quota';
  try {element('custom-target').textContent = 'Key 发送目标：' + new URL(element('custom-endpoint').value).origin + ' · 不跟随重定向';} catch {element('custom-target').textContent = '尚未配置有效目标；不会发送 Key';}
}
function connectionSettings() {const sourceMode = element('source-mode').value; return {refreshMinutes: Number(element('interval').value), sourceMode, ...(sourceMode === 'ept' ? {eptExecutable: element('ept-executable').value.trim()} : {}), ...(sourceMode === 'custom' ? {customApi: customConfig()} : {})};}
buildCharacters();
for (const button of document.querySelectorAll('[data-size]')) button.addEventListener('click', () => request(() => api.saveSettings({petSize: button.dataset.size})));
for (const [identifier, field] of [['always-top', 'alwaysOnTop'], ['reduced-motion', 'reducedMotion'], ['speech-enabled', 'speechEnabled'], ['auto-start', 'autoStart'], ['display-mode', 'displayMode'], ['source-mode', 'sourceMode']]) element(identifier).addEventListener('change', async () => {if (!await request(() => api.saveSettings({[field]: element(identifier).type === 'checkbox' ? element(identifier).checked : element(identifier).value}))) render(state);});
element('save-connection').addEventListener('click', async () => {const submitted = connectionSettings(); if (await request(() => api.saveSettings(submitted), '来源与连接已保存')) {if ('customApi' in submitted) customDirty = false; if ('eptExecutable' in submitted) eptDirty = false; render(state);}});
element('ept-executable').addEventListener('input', () => {eptDirty = true;});
element('read-now').addEventListener('click', async () => {element('read-now').disabled = true; if (await request(() => api.saveSettings(connectionSettings()))) {eptDirty = false; render(state); await request(() => api.refresh(), '已从 EPT 查询个人额度');} element('read-now').disabled = false;});
element('select-ept').addEventListener('click', async () => {if (await request(() => api.selectEpt())) {eptDirty = false; render(state);}});
element('auto-ept').addEventListener('click', async () => {if (await request(() => api.saveSettings({eptExecutable: '', sourceMode: 'ept'}))) {eptDirty = false; render(state);}});
element('refresh').addEventListener('click', () => request(() => api.refresh()));
element('settings').addEventListener('click', () => request(() => api.openSettings()));
element('hide').addEventListener('click', () => request(() => api.hide()));
element('quit').addEventListener('click', () => request(() => api.quit()));
element('import-character').addEventListener('click', () => request(() => api.importCharacter()));
element('save-key').addEventListener('click', async () => {
  const key = element('deepseek-key').value;
  const saved = await request(() => api.saveKey({key, persist: element('remember-key').checked}));
  element('deepseek-key').value = '';
  if (saved) await request(() => api.refresh(), '已查询 DeepSeek 官方余额');
});
element('clear-key').addEventListener('click', () => request(() => api.clearKey(), '本地 Key 已清除，不代表撤销平台 Key'));
for (const [identifier] of customFields) element(identifier).addEventListener('input', () => {customDirty = true; if (identifier !== 'custom-label') element('custom-confirm').checked = false; updateCustomFields();});
element('custom-confirm').addEventListener('change', () => {customDirty = true;});
element('custom-preset').addEventListener('change', () => {
  const preset = element('custom-preset').value;
  const values = preset === 'deepseek' ? {label: '兼容平台', mode: 'balance', currency: 'CNY', remainingPath: 'balance_infos.0.total_balance', totalPath: 'data.total', usedPath: 'data.used'} : preset === 'newapi' ? {label: '令牌额度', mode: 'quota', currency: 'CREDIT', remainingPath: 'data.total_available', totalPath: 'data.total_granted', usedPath: 'data.total_used'} : {label: '第三方平台', mode: 'balance', currency: 'CREDIT', remainingPath: 'data.balance', totalPath: 'data.total', usedPath: 'data.used'};
  values.divisor = 1; values.auth = 'bearer'; values.headerName = 'X-API-Key';
  for (const [identifier, field] of customFields) if (field in values) element(identifier).value = String(values[field]);
  customDirty = true; element('custom-confirm').checked = false; updateCustomFields();
});
element('save-custom').addEventListener('click', async () => {
  const saved = await request(() => api.saveCustomKey({key: element('custom-key').value, persist: element('custom-remember').checked, config: customConfig()}));
  element('custom-key').value = '';
  if (saved) {customDirty = false; render(state); await request(() => api.refresh(), '已查询第三方接口 · 请核对平台显示');}
});
element('clear-custom-key').addEventListener('click', () => request(() => api.clearCustomKey(), '已清除此平台本地 Key，不代表撤销平台 Key'));
element('pet-image').addEventListener('error', () => {if (!element('pet-image').src.endsWith('/chiikawa.png')) {element('pet-image').src = '../../assets/characters/chiikawa.png'; api.openSettings();}});

element('poke').addEventListener('pointerdown', (event) => {if (event.button !== 0) return; clearTimeout(pokeTimer); pointerStart = {x: event.screenX, y: event.screenY}; moved = false; element('poke').setPointerCapture(event.pointerId); if (desktop) api.startDrag();});
element('poke').addEventListener('pointermove', (event) => {
  if (pointerStart) {
    const dx = event.screenX - pointerStart.x;
    const dy = event.screenY - pointerStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) {moved = true; if (desktop) api.dragBy({dx, dy});}
  } else if (desktop) api.petHover(true);
});
element('poke').addEventListener('pointerleave', () => {if (!pointerStart && desktop) api.petHover(false);});
const finishDrag = () => {pointerStart = null; if (desktop) api.endDrag();};
element('poke').addEventListener('pointerup', finishDrag);
element('poke').addEventListener('pointercancel', finishDrag);
element('poke').addEventListener('click', (event) => {if (moved && event.detail !== 0) return; element('poke').classList.remove('poked'); void element('poke').offsetWidth; element('poke').classList.add('poked'); setTimeout(() => element('poke').classList.remove('poked'), 700); clearTimeout(pokeTimer); if (desktop && state.settings.speechEnabled) pokeTimer = setTimeout(() => api.poke(), 300);});
element('poke').addEventListener('dblclick', () => {clearTimeout(pokeTimer); if (!moved) request(() => api.openSettings());});
if (view === 'panel' && desktop) {document.body.addEventListener('pointerenter', () => api.panelHover(true)); document.body.addEventListener('pointerleave', () => api.panelHover(false));}
if (view === 'pet' && desktop) api.onCancelPoke(() => clearTimeout(pokeTimer));
if (view === 'bubble') api.onSpeech((speech) => {element('speech-name').textContent = speech.name; element('speech-text').textContent = speech.text;});
else {api.onState(render); request(() => api.getState());}
