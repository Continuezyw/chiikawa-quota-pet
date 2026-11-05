const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');
const {stripVTControlCharacters} = require('node:util');

const MAX_OUTPUT = 1024 * 1024;
const cycles = ['monthly', 'weekly', 'daily', 'yearly', 'none'];
const fail = (message) => new Error(message);

function numericAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000) throw fail('EPT 金额格式无效，请检查命令版本或改用手动来源');
  return value;
}

function emptyEptQuota() {
  return {kind: 'quota', source: 'ept', total: null, used: null, remaining: null, overage: null, percentage: null, updatedAt: null, ept: null};
}

function makeQuota(total, used, reportedPercentage, metadata, now) {
  numericAmount(total); numericAmount(used);
  const percentage = total === 0 ? used === 0 ? 0 : 100 : used / total * 100;
  if (!Number.isFinite(percentage)) throw fail('EPT 额度比例超出有效范围');
  if (reportedPercentage !== null && (typeof reportedPercentage !== 'number' || !Number.isFinite(reportedPercentage) || reportedPercentage < 0 || Math.abs(reportedPercentage - percentage) > 0.05)) throw fail('EPT 百分比与总花费 / 额度不一致，未更新旧记录');
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw fail('EPT 采样时间无效');
  return {kind: 'quota', source: 'ept', total, used, remaining: Math.max(0, total - used), overage: Math.max(0, used - total), percentage, updatedAt: now, ept: metadata};
}

function parseEptJson(input, now = new Date().toISOString()) {
  let payload = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_OUTPUT) throw fail('EPT 输出过大，未更新额度');
    try {payload = JSON.parse(stripVTControlCharacters(input).replace(/^\uFEFF/, '').trim());} catch {throw fail('EPT JSON 输出无法解析，请更新 EPT 或使用手动来源');}
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['total_budget', 'actual_cost', 'usage_percentage', 'reset_cycle'].every((field) => Object.hasOwn(payload, field))) throw fail('EPT JSON 缺少完整个人额度汇总');
  if (typeof payload.usage_percentage !== 'number' || !Number.isFinite(payload.usage_percentage)) throw fail('EPT JSON 百分比无效');
  if (!cycles.includes(payload.reset_cycle)) throw fail('EPT 更新周期无法识别，未更新额度');
  const planName = typeof payload.plan_name === 'string' && /^[a-zA-Z0-9 _.-]{1,80}$/.test(payload.plan_name) ? payload.plan_name : null;
  return makeQuota(payload.total_budget, payload.actual_cost, payload.usage_percentage, {planName, resetCycle: payload.reset_cycle, reportedPercentage: payload.usage_percentage, rangeStart: null, rangeEnd: null}, now);
}

function textAmount(value) {
  const cleaned = value.replace(/\s/g, '').replace(/，/g, ',');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned)) throw fail('EPT 文本金额格式无效');
  return numericAmount(Number(cleaned.replaceAll(',', '')));
}

function parseEptText(text, now = new Date().toISOString()) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_OUTPUT) throw fail('EPT 文本输出无效或过大');
  const normalized = stripVTControlCharacters(text).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[：]/g, ':');
  const sections = normalized.split(/^\s*##\s+使用情况汇总\s*$/m);
  if (sections.length !== 2) throw fail('未找到唯一的 EPT「使用情况汇总」，不读取工具分项');
  const personal = sections[1].split(/^\s*##\s+/m)[0].split(/部门额度|团队额度|组织额度/)[0];
  if (/^[ \t]*#{3,}[ \t]+(?!个人额度[ \t]*$)/m.test(personal)) throw fail('EPT 汇总包含工具分项，不能视为个人额度');
  const usedLabels = [...personal.matchAll(/^[ \t]*(?:[•·*-][ \t]*)?(?:本月|本周|今日|本日|本年)使用总金额[ \t]*:/gm)];
  const totalLabels = [...personal.matchAll(/^[ \t]*(?:[•·*-][ \t]*)?(?:月|周|日|年)额度[ \t]*:/gm)];
  if (usedLabels.length !== 1 || totalLabels.length !== 1) throw fail('EPT 个人汇总缺少唯一的总花费和总额度');
  const extract = (label) => {
    const tail = personal.slice(label.index + label[0].length);
    const unitIndex = tail.indexOf('元');
    if (unitIndex < 1 || unitIndex > 4096 || unitIndex + 1 < tail.length && !/\s/.test(tail[unitIndex + 1])) throw fail('EPT 个人金额必须以元为单位');
    return textAmount(tail.slice(0, unitIndex));
  };
  const prefix = /本月|本周|今日|本日|本年/.exec(usedLabels[0][0])[0];
  const resetCycle = {本月: 'monthly', 本周: 'weekly', 今日: 'daily', 本日: 'daily', 本年: 'yearly'}[prefix];
  const expectedLabel = {monthly: '月', weekly: '周', daily: '日', yearly: '年'}[resetCycle];
  if (!totalLabels[0][0].includes(expectedLabel + '额度')) throw fail('EPT 花费与额度周期不一致');
  const percentLabels = [...personal.matchAll(/^[ \t]*(?:[•·*-][ \t]*)?已使用百分比[ \t]*:/gm)];
  if (percentLabels.length > 1) throw fail('EPT 汇总包含多个个人百分比');
  let reportedPercentage = null;
  if (percentLabels.length) {
    const label = percentLabels[0];
    const tail = personal.slice(label.index + label[0].length);
    const percentIndex = tail.indexOf('%');
    if (percentIndex < 1 || percentIndex > 4096 || percentIndex + 1 < tail.length && !/\s/.test(tail[percentIndex + 1])) throw fail('EPT 百分比格式无效');
    reportedPercentage = textAmount(tail.slice(0, percentIndex));
  }
  return makeQuota(extract(totalLabels[0]), extract(usedLabels[0]), reportedPercentage, {planName: null, resetCycle, reportedPercentage, rangeStart: null, rangeEnd: null}, now);
}

function restoreEptQuota(quota) {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota) || quota.source !== 'ept' || quota.kind !== 'quota') throw fail('EPT 缓存来源无效');
  if (quota.total === null && quota.used === null && quota.remaining === null && quota.updatedAt === null) return emptyEptQuota();
  const metadata = quota.ept;
  if (!metadata || !cycles.includes(metadata.resetCycle)) throw fail('EPT 缓存周期无效');
  const restored = parseEptJson({total_budget: quota.total, actual_cost: quota.used, usage_percentage: metadata.reportedPercentage ?? quota.percentage, reset_cycle: metadata.resetCycle, plan_name: metadata.planName}, quota.updatedAt);
  if (metadata.reportedPercentage === null) restored.ept.reportedPercentage = null;
  return restored;
}

function resolveEptExecutable(configured = '', options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const exists = options.existsSync || fs.existsSync;
  const homeDirectory = options.homeDirectory || os.homedir();
  const environment = options.env || process.env;
  const basename = platform === 'win32' ? 'ept.exe' : 'ept';
  const absolute = (filename) => pathApi.isAbsolute(filename) && (platform !== 'win32' || /^[a-zA-Z]:[\\/]|^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(filename));
  const valid = (filename) => typeof filename === 'string' && absolute(filename) && pathApi.basename(filename).toLowerCase() === basename && !/[\x00-\x1f]/.test(filename);
  if (typeof configured !== 'string') throw fail('EPT 路径必须为字符串');
  if (configured) {
    if (!valid(configured)) throw fail('请选择完整的 ept.exe 文件路径，不能填写命令、脚本或参数');
    if (!exists(configured)) throw fail('配置的 EPT 文件不存在，请重新选择 ept.exe');
    return configured;
  }
  const variable = Object.keys(environment).find((key) => key.toLowerCase() === 'path');
  const directories = (environment[variable] || '').split(platform === 'win32' ? ';' : ':').map((directory) => directory.replace(/^"|"$/g, ''));
  const candidates = [pathApi.join(homeDirectory, '.ept', 'bin', basename), ...directories.filter(absolute).map((directory) => pathApi.join(directory, basename))];
  const found = candidates.find((filename) => valid(filename) && exists(filename));
  if (!found) throw fail('未找到 EPT。请先在本机安装并登录 EPT，确认 ept usage 可用；或在设置选择 ept.exe');
  return found;
}

async function fetchEptQuota(settings = {}, options = {}) {
  const executable = resolveEptExecutable(settings.eptExecutable || '', options);
  const executor = options.execFileImpl || childProcess.execFile;
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw fail('EPT 查询超时参数无效');
  const environment = {...(options.env || process.env), NO_COLOR: '1'};
  delete environment.ELECTRON_RUN_AS_NODE;
  const execute = (args) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) {reject(fail('EPT 查询已取消')); return;}
    let child;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(result);
    };
    const terminate = () => {try {child?.kill();} catch {}};
    const cancel = () => {finish(fail('EPT 查询已取消')); terminate();};
    const timer = setTimeout(() => {finish(fail('EPT 查询超时，请检查网络或在终端重新登录')); terminate();}, timeout);
    options.signal?.addEventListener('abort', cancel, {once: true});
    try {
      child = executor(executable, args, {cwd: options.homeDirectory || os.homedir(), env: environment, encoding: 'utf8', windowsHide: true, shell: false, timeout, maxBuffer: MAX_OUTPUT, signal: options.signal}, (error, stdout, stderr) => {
        if (settled) return;
        if (options.signal?.aborted || ['ABORT_ERR', 'ERR_ABORTED'].includes(error?.code) || error?.name === 'AbortError') {finish(fail('EPT 查询已取消')); return;}
        const outputBytes = (typeof stdout === 'string' ? Buffer.byteLength(stdout, 'utf8') : 0) + (typeof stderr === 'string' ? Buffer.byteLength(stderr, 'utf8') : 0);
        if (outputBytes > MAX_OUTPUT) {finish(fail('EPT 输出超过限制，未更新额度')); terminate(); return;}
        if (error) {
          const unsupported = typeof stderr === 'string' && /(?:^|\n)\s*(?:Error:\s*)?unknown flag:\s*--(?:json|summary-only)(?=\s|$)/.test(stderr);
          if (unsupported && typeof error.code === 'number' && error.code !== 0 && !error.killed && !error.signal) {finish(null, {unsupported: true}); return;}
          finish(fail(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'EPT 输出超过限制，未更新额度' : error.killed || error.code === 'ETIMEDOUT' ? 'EPT 查询超时，请检查网络或在终端重新登录' : error.code === 'ENOENT' ? 'EPT 程序无法启动，请检查安装和路径' : 'EPT 查询失败，请在终端运行 ept usage 检查登录、网络与版本')); return;
        }
        if (typeof stdout !== 'string') {finish(fail('EPT 输出为空，未更新额度')); return;}
        finish(null, {stdout});
      });
      if (options.signal?.aborted) cancel();
    } catch {finish(fail('EPT 程序无法启动，请检查安装和路径'));}
  });
  const structured = await execute(['usage', '--summary-only', '--json']);
  if (structured.unsupported) {
    const plain = await execute(['usage']);
    if (plain.unsupported) throw fail('当前 EPT 版本无法查询额度，请更新 EPT');
    return parseEptText(plain.stdout);
  }
  return parseEptJson(structured.stdout);
}

module.exports = {parseEptJson, parseEptText, restoreEptQuota, emptyEptQuota, resolveEptExecutable, fetchEptQuota};
