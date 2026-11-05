const fs = require('node:fs');
const path = require('node:path');
const {emptyEptQuota, restoreEptQuota} = require('./providers/ept.cjs');
const {customDefaults, validateCustomConfig, emptyCustomQuota, restoreCustomQuota} = require('./providers/custom.cjs');
const {PET_SIZES, CHARACTER_IDS} = require('./appearance.cjs');

const defaults = () => ({
  settings: {eptExecutable: '', refreshMinutes: 5, alwaysOnTop: true, reducedMotion: false, speechEnabled: true, autoStart: false, character: 'chiikawa', petSize: 'medium', displayMode: 'hover', sourceMode: 'ept', customApi: customDefaults()},
  quota: emptyEptQuota(),
  sync: {status: 'idle', message: 'EPT 额度尚未查询', checkedAt: null}
});

function emptyForSource(settings) {
  if (settings.sourceMode === 'custom') return emptyCustomQuota(settings.customApi);
  if (settings.sourceMode === 'deepseek') return {kind: 'balance', source: 'deepseek', currency: 'CNY', remaining: null, total: null, used: null, percentage: null, available: null, updatedAt: null};
  return emptyEptQuota();
}

function createStore(directory) {
  const filename = path.join(directory, 'state.json');
  let state = defaults();
  try {
    const stored = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('设置无效');
    const migrated = {...stored.settings};
    const oldSource = ['manual', 'import', 'sample', 'finops'].includes(migrated.sourceMode) || !migrated.sourceMode && (Boolean(migrated.reportUrl) || stored.quota && !['ept', 'deepseek', 'custom'].includes(stored.quota.source));
    delete migrated.reportUrl; delete migrated.loginMode;
    if (oldSource) migrated.sourceMode = 'ept';
    if (!migrated.sourceMode && stored.quota?.source === 'deepseek') migrated.sourceMode = 'deepseek';
    state.settings = {...state.settings, ...validateSettings(migrated)};
    if (!migrated.petSize && migrated.compact) state.settings.petSize = 'small';
    state.quota = emptyForSource(state.settings);
    state.sync.message = state.settings.sourceMode === 'ept' ? 'EPT 额度尚未查询' : state.settings.sourceMode === 'deepseek' ? 'DeepSeek 余额尚未查询' : '第三方接口尚未查询';
    if (oldSource) state.sync.message = '手动及浏览器读取已移除，请重新查询 EPT';
    else if (stored.quota?.source === state.settings.sourceMode && stored.quota.updatedAt) {
      try {
        if (state.settings.sourceMode === 'ept') state.quota = restoreEptQuota(stored.quota);
        else if (state.settings.sourceMode === 'custom') state.quota = restoreCustomQuota(stored.quota, state.settings.customApi);
        else {
          const quota = stored.quota;
          if (quota.kind !== 'balance' || !['CNY', 'USD'].includes(quota.currency) || !Number.isFinite(quota.remaining) || quota.remaining < 0 || quota.remaining > Number.MAX_SAFE_INTEGER || typeof quota.available !== 'boolean' || typeof quota.updatedAt !== 'string' || !Number.isFinite(Date.parse(quota.updatedAt)) || new Date(quota.updatedAt).toISOString() !== quota.updatedAt) throw new Error('余额缓存无效');
          state.quota = {kind: 'balance', source: 'deepseek', currency: quota.currency, remaining: quota.remaining, total: null, used: null, percentage: null, available: quota.available, updatedAt: quota.updatedAt};
        }
        state.sync.message = '上次查询缓存 · 非实时，请刷新确认';
      } catch {state.sync.message = '缓存无效，额度未知；请重新查询';}
    }
  } catch (error) {
    state = defaults();
    if (error.code !== 'ENOENT') state.sync.message = '本地数据损坏，额度未知；请重新查询';
  }
  return {
    get: () => structuredClone(state),
    update: (partial) => {
      const next = {...state, ...partial};
      fs.mkdirSync(directory, {recursive: true});
      fs.writeFileSync(filename + '.tmp', JSON.stringify(next, null, 2), {mode: 0o600});
      fs.renameSync(filename + '.tmp', filename);
      state = next;
      return structuredClone(state);
    }
  };
}

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置无效');
  const result = {};
  if ('reportUrl' in input || 'loginMode' in input) throw new Error('浏览器读取已停用，请使用 EPT 来源');
  if ('eptExecutable' in input) {
    const filename = input.eptExecutable;
    if (typeof filename !== 'string' || filename.length > 2000 || filename !== '' && (!path.isAbsolute(filename) || !(/^[a-zA-Z]:[\\/]|^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(filename)) || path.basename(filename).toLowerCase() !== 'ept.exe' || /[\x00-\x1f]/.test(filename))) throw new Error('请选择完整的 ept.exe 路径，不支持脚本或附加参数');
    result.eptExecutable = filename;
  }
  if ('refreshMinutes' in input) {
    if (![1, 5, 15, 30].includes(input.refreshMinutes)) throw new Error('刷新间隔必须为 1、5、15 或 30 分钟');
    result.refreshMinutes = input.refreshMinutes;
  }
  for (const [field, choices] of [['character', CHARACTER_IDS], ['petSize', Object.keys(PET_SIZES)], ['displayMode', ['hover', 'always']], ['sourceMode', ['ept', 'deepseek', 'custom']]]) {
    if (field in input) {
      if (!choices.includes(input[field])) throw new Error('不支持的 ' + field + ' 设置');
      result[field] = input[field];
    }
  }
  if ('compact' in input && typeof input.compact !== 'boolean') throw new Error('旧迷你开关必须为布尔值');
  for (const field of ['alwaysOnTop', 'reducedMotion', 'speechEnabled', 'autoStart']) {
    if (field in input) {
      if (typeof input[field] !== 'boolean') throw new Error('开关必须为布尔值');
      result[field] = input[field];
    }
  }
  if ('customApi' in input) result.customApi = validateCustomConfig(input.customApi, {allowEmpty: true});
  return result;
}

module.exports = {createStore, validateSettings, defaults, emptyForSource};
