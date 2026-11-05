const {isIP} = require('node:net');

const MAX_AMOUNT = 1000000000;
const MAX_BODY_BYTES = 65536;
const DEFAULT_TIMEOUT_MS = 10000;
const ERROR_MESSAGES = {
  INVALID_CONFIG: '第三方接口配置无效，请核对 HTTPS 地址、认证头、字段路径、单位并确认接口。',
  INVALID_KEY: '第三方 API Key 无效，请使用不含控制字符的独立 Key。',
  INVALID_RESPONSE: '第三方接口响应无效、超出限制或单位不匹配，未更新额度。',
  UNAUTHORIZED: '第三方接口认证失败（401），请检查该平台的独立 Key。',
  FORBIDDEN: '第三方接口拒绝访问（403），请核对权限。',
  RATE_LIMITED: '第三方接口请求过于频繁（429），请稍后重试。',
  HTTP_ERROR: '第三方接口请求失败，请检查平台服务状态。',
  NETWORK: '第三方接口无法连接或读取，请检查网络。',
  TIMEOUT: '第三方接口查询超时，未更新额度。',
  CANCELLED: '第三方接口查询已取消，未更新额度。'
};
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/;
const FORBIDDEN_SEGMENTS = new Set(['prototype', '__proto__', 'constructor']);

class CustomQuotaError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = 'CustomQuotaError';
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function ownValue(object, field) {
  if (object === null || typeof object !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, field);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw new CustomQuotaError('INVALID_RESPONSE');
  return descriptor.value;
}

function customDefaults() {
  return {
    preset: 'generic', label: '第三方平台', endpoint: '', auth: 'bearer', headerName: 'X-API-Key',
    currency: 'CREDIT', mode: 'balance', remainingPath: 'data.balance', totalPath: 'data.total',
    usedPath: 'data.used', divisor: 1, confirmed: false
  };
}

function pathSegments(path, required = true) {
  if (path === '' && !required) return [];
  if (typeof path !== 'string' || !path || path.length > 256) throw new CustomQuotaError('INVALID_CONFIG');
  const segments = path.split('.');
  if (segments.length > 20 || segments.some((segment) =>
    !/^(?:[A-Za-z_][A-Za-z0-9_-]*|0|[1-9][0-9]*)$/.test(segment) || FORBIDDEN_SEGMENTS.has(segment))) {
    throw new CustomQuotaError('INVALID_CONFIG');
  }
  return segments;
}

function validateEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048 ||
      !/^https:\/\//i.test(endpoint) || /[\s\\?#]/.test(endpoint) || CONTROL_CHARACTERS.test(endpoint) ||
      /%(?:0[0-9a-f]|1[0-9a-f]|7f|8[0-9a-f]|9[0-9a-f])/i.test(endpoint)) {
    throw new CustomQuotaError('INVALID_CONFIG');
  }
  const authority = endpoint.slice(8).split('/')[0];
  if (!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(authority)) throw new CustomQuotaError('INVALID_CONFIG');
  const url = new URL(endpoint);
  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
      hostname.length > 253 || labels.length < 2 || labels.some((label) =>
        label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1))) {
    throw new CustomQuotaError('INVALID_CONFIG');
  }
  return url.href;
}

function safeHeaderName(headerName) {
  return typeof headerName === 'string' && headerName.length <= 64 &&
    /^(?:[A-Za-z0-9]+-)*(?:Key|Token)$/i.test(headerName) &&
    !/^(?:proxy-|sec-|x-forwarded-|x-original-|x-rewrite-|x-http-|access-control-)/i.test(headerName);
}

function validateCustomConfig(input, options = {}) {
  try {
    if (!isRecord(input) || !isRecord(options)) throw new CustomQuotaError('INVALID_CONFIG');
    const optionValue = ownValue(options, 'allowEmpty');
    const allowEmpty = optionValue === undefined ? false : optionValue;
    if (typeof allowEmpty !== 'boolean') throw new CustomQuotaError('INVALID_CONFIG');
    const config = customDefaults();
    for (const field of Object.keys(config)) {
      if (Object.hasOwn(input, field)) config[field] = ownValue(input, field);
    }
    if (!['generic', 'deepseek', 'newapi'].includes(config.preset) ||
        typeof config.label !== 'string' || !config.label.trim() || config.label.length > 80 ||
        CONTROL_CHARACTERS.test(config.label) || !['bearer', 'header', 'none'].includes(config.auth) ||
        !safeHeaderName(config.headerName) || !['CREDIT', 'CNY', 'USD'].includes(config.currency) ||
        !['balance', 'quota'].includes(config.mode) || typeof config.divisor !== 'number' ||
        !Number.isFinite(config.divisor) || config.divisor <= 0 || config.divisor > MAX_AMOUNT ||
        typeof config.confirmed !== 'boolean') {
      throw new CustomQuotaError('INVALID_CONFIG');
    }
    pathSegments(config.remainingPath, config.mode === 'balance');
    pathSegments(config.totalPath, config.mode === 'quota');
    pathSegments(config.usedPath, config.mode === 'quota');
    if (config.preset === 'deepseek' && (config.mode !== 'balance' ||
        !['CNY', 'USD'].includes(config.currency) ||
        !/^balance_infos\.(?:0|[1-9][0-9]*)\.total_balance$/.test(config.remainingPath))) {
      throw new CustomQuotaError('INVALID_CONFIG');
    }
    if (config.endpoint === '' && allowEmpty) return config;
    config.endpoint = validateEndpoint(config.endpoint);
    if (!allowEmpty && !config.confirmed) throw new CustomQuotaError('INVALID_CONFIG');
    return config;
  } catch {
    throw new CustomQuotaError('INVALID_CONFIG');
  }
}

function mappedValue(payload, path) {
  let value = payload;
  for (const segment of pathSegments(path)) {
    if (Array.isArray(value) && !/^(?:0|[1-9][0-9]*)$/.test(segment)) {
      throw new CustomQuotaError('INVALID_RESPONSE');
    }
    value = ownValue(value, segment);
    if (value === undefined) throw new CustomQuotaError('INVALID_RESPONSE');
  }
  return value;
}

function amountValue(value, divisor = 1) {
  if (typeof value === 'string') {
    if (value.length > 256 || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) throw new CustomQuotaError('INVALID_RESPONSE');
    const [integer, fraction = ''] = value.split('.');
    const significant = integer.replace(/^0+/, '') || '0';
    const safeLimit = String(Number.MAX_SAFE_INTEGER);
    if (significant.length > safeLimit.length || significant.length === safeLimit.length &&
        (significant > safeLimit || significant === safeLimit && /[1-9]/.test(fraction))) {
      throw new CustomQuotaError('INVALID_RESPONSE');
    }
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new CustomQuotaError('INVALID_RESPONSE');
  }
  const amount = value / divisor;
  if (!Number.isFinite(amount) || amount > MAX_AMOUNT || value > 0 && amount === 0) {
    throw new CustomQuotaError('INVALID_RESPONSE');
  }
  return amount === 0 ? 0 : amount;
}

function validTimestamp(updatedAt) {
  return typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt)) &&
    new Date(updatedAt).toISOString() === updatedAt;
}

function makeEmptyQuota(config) {
  const quota = {
    kind: config.mode, source: 'custom', currency: config.currency, remaining: null,
    total: null, used: null, percentage: null, available: null, updatedAt: null,
    custom: {label: config.label, scope: config.preset === 'newapi' ? 'token' : 'account'}
  };
  if (config.mode === 'quota') quota.overage = null;
  return quota;
}

function emptyCustomQuota(config) {
  return makeEmptyQuota(validateCustomConfig(config, {allowEmpty: true}));
}

function makeQuota(config, total, used, remaining, updatedAt) {
  const quota = makeEmptyQuota(config);
  quota.updatedAt = updatedAt;
  if (config.mode === 'balance') {
    quota.remaining = remaining;
    return quota;
  }
  const percentage = total === 0 ? used === 0 ? 0 : 100 : used / total * 100;
  if (!Number.isFinite(percentage)) throw new CustomQuotaError('INVALID_RESPONSE');
  return {...quota, total, used, remaining: Math.max(0, total - used),
    overage: Math.max(0, used - total), percentage};
}

function rejectUnlimited(payload, config) {
  const parents = new Set(['', 'data']);
  for (const path of config.mode === 'balance' ? [config.remainingPath] : [config.totalPath, config.usedPath]) {
    parents.add(path.split('.').slice(0, -1).join('.'));
  }
  for (const path of parents) {
    let parent = payload;
    if (path) {
      try {parent = mappedValue(payload, path);} catch {continue;}
    }
    for (const field of ['unlimited_quota', 'unlimited']) {
      const flag = ownValue(parent, field);
      if (flag !== undefined && flag !== false && flag !== 0 && flag !== 'false' && flag !== '0') {
        throw new CustomQuotaError('INVALID_RESPONSE');
      }
    }
  }
}

function parseCustomResponse(payload, config, updatedAt = new Date().toISOString()) {
  const validated = validateCustomConfig(config, {allowEmpty: true});
  try {
    if (!isRecord(payload) || !validTimestamp(updatedAt)) throw new CustomQuotaError('INVALID_RESPONSE');
    const error = ownValue(payload, 'error');
    if (ownValue(payload, 'success') === false ||
        Object.hasOwn(payload, 'error') && error !== null && error !== false) {
      throw new CustomQuotaError('INVALID_RESPONSE');
    }
    if (validated.preset === 'newapi') rejectUnlimited(payload, validated);
    if (validated.preset === 'deepseek') {
      if (ownValue(payload, 'is_available') === false) throw new CustomQuotaError('INVALID_RESPONSE');
      const rowPath = validated.remainingPath.split('.').slice(0, -1).join('.');
      const row = mappedValue(payload, rowPath);
      if (!isRecord(row) || ownValue(row, 'currency') !== validated.currency) {
        throw new CustomQuotaError('INVALID_RESPONSE');
      }
    }
    if (validated.mode === 'balance') {
      return makeQuota(validated, null, null, amountValue(mappedValue(payload, validated.remainingPath), validated.divisor), updatedAt);
    }
    return makeQuota(validated,
      amountValue(mappedValue(payload, validated.totalPath), validated.divisor),
      amountValue(mappedValue(payload, validated.usedPath), validated.divisor), null, updatedAt);
  } catch {
    throw new CustomQuotaError('INVALID_RESPONSE');
  }
}

function restoreCustomQuota(quota, config) {
  const validated = validateCustomConfig(config, {allowEmpty: true});
  try {
    const expected = makeEmptyQuota(validated);
    if (!isRecord(quota) || ownValue(quota, 'source') !== 'custom' ||
        ownValue(quota, 'kind') !== validated.mode || ownValue(quota, 'currency') !== validated.currency) {
      throw new CustomQuotaError('INVALID_RESPONSE');
    }
    const metadata = ownValue(quota, 'custom');
    if (!isRecord(metadata) || ownValue(metadata, 'label') !== expected.custom.label ||
        ownValue(metadata, 'scope') !== expected.custom.scope) throw new CustomQuotaError('INVALID_RESPONSE');
    const updatedAt = ownValue(quota, 'updatedAt');
    if (updatedAt === null) {
      for (const field of Object.keys(expected).filter((field) => !['kind', 'source', 'currency', 'custom'].includes(field))) {
        if (ownValue(quota, field) !== null) throw new CustomQuotaError('INVALID_RESPONSE');
      }
      return expected;
    }
    if (!validated.endpoint || !validTimestamp(updatedAt)) throw new CustomQuotaError('INVALID_RESPONSE');
    let restored;
    if (validated.mode === 'balance') {
      restored = makeQuota(validated, null, null, amountValue(ownValue(quota, 'remaining')), updatedAt);
    } else {
      restored = makeQuota(validated, amountValue(ownValue(quota, 'total')), amountValue(ownValue(quota, 'used')), null, updatedAt);
    }
    for (const field of ['remaining', 'total', 'used', 'percentage', 'available', ...(validated.mode === 'quota' ? ['overage'] : [])]) {
      if (typeof ownValue(quota, field) !== typeof restored[field] || ownValue(quota, field) !== restored[field]) {
        throw new CustomQuotaError('INVALID_RESPONSE');
      }
    }
    return restored;
  } catch {
    throw new CustomQuotaError('INVALID_RESPONSE');
  }
}

function cancelReader(reader) {
  try {Promise.resolve(reader.cancel()).catch(() => {});} catch {}
}

async function readPayload(response, signal) {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength !== undefined && declaredLength !== null &&
      (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new CustomQuotaError('INVALID_RESPONSE');
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let byteCount = 0;
    const cancel = () => cancelReader(reader);
    signal.addEventListener('abort', cancel, {once: true});
    try {
      while (true) {
        if (signal.aborted) throw new CustomQuotaError('CANCELLED');
        const chunk = await reader.read();
        if (signal.aborted) throw new CustomQuotaError('CANCELLED');
        if (!chunk || typeof chunk.done !== 'boolean') throw new CustomQuotaError('INVALID_RESPONSE');
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > MAX_BODY_BYTES - byteCount) {
          throw new CustomQuotaError('INVALID_RESPONSE');
        }
        byteCount += chunk.value.byteLength;
        chunks.push(Buffer.from(chunk.value));
      }
      let text;
      try {text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, byteCount));}
      catch {throw new CustomQuotaError('INVALID_RESPONSE');}
      return JSON.parse(text);
    } catch (error) {
      cancel();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      try {reader.releaseLock();} catch {}
    }
  }
  if (typeof response.text !== 'function') throw new CustomQuotaError('INVALID_RESPONSE');
  const text = await response.text();
  if (signal.aborted) throw new CustomQuotaError('CANCELLED');
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new CustomQuotaError('INVALID_RESPONSE');
  }
  return JSON.parse(text);
}

async function fetchCustomQuota(config, key, options = {}) {
  const validated = validateCustomConfig(config);
  let apiKey;
  if (validated.auth !== 'none') {
    if (typeof key !== 'string' || !key.trim() || key.length > 8192 || CONTROL_CHARACTERS.test(key) || /[^\x20-\x7e]/.test(key)) {
      throw new CustomQuotaError('INVALID_KEY');
    }
    apiKey = key.trim();
  }
  let fetchImpl;
  let timeoutMs;
  let signal;
  try {
    if (!isRecord(options)) throw new CustomQuotaError('INVALID_CONFIG');
    fetchImpl = ownValue(options, 'fetchImpl');
    if (fetchImpl === undefined) fetchImpl = globalThis.fetch;
    timeoutMs = ownValue(options, 'timeoutMs');
    if (timeoutMs === undefined) timeoutMs = DEFAULT_TIMEOUT_MS;
    signal = ownValue(options, 'signal');
    if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS ||
        signal !== undefined && !(signal instanceof AbortSignal)) throw new CustomQuotaError('INVALID_CONFIG');
  } catch {
    throw new CustomQuotaError('INVALID_CONFIG');
  }
  if (signal?.aborted) throw new CustomQuotaError('CANCELLED');
  const controller = new AbortController();
  let timer;
  let stop;
  let stopCode;
  const stopped = new Promise((resolve, reject) => {
    stop = (code) => {
      if (stopCode) return;
      stopCode = code;
      reject(new CustomQuotaError(code));
      controller.abort();
    };
  });
  const cancel = () => stop('CANCELLED');
  const checkStopped = () => {if (stopCode) throw new CustomQuotaError(stopCode);};
  try {
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const request = (async () => {
      checkStopped();
      const headers = {Accept: 'application/json'};
      if (validated.auth === 'bearer') headers.Authorization = 'Bearer ' + apiKey;
      if (validated.auth === 'header') headers[validated.headerName] = apiKey;
      let response;
      try {
        response = await fetchImpl(validated.endpoint, {
          method: 'GET', headers, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal
        });
      } catch {
        checkStopped();
        throw new CustomQuotaError('NETWORK');
      }
      checkStopped();
      if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 ||
          response.redirected === true || response.url && response.url !== validated.endpoint) {
        throw new CustomQuotaError('INVALID_RESPONSE');
      }
      if (response.status !== 200) {
        throw new CustomQuotaError({401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 429: 'RATE_LIMITED'}[response.status] || 'HTTP_ERROR');
      }
      let payload;
      try {payload = await readPayload(response, controller.signal);} catch (error) {
        checkStopped();
        if (error instanceof CustomQuotaError) throw error;
        throw new CustomQuotaError(error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK');
      }
      checkStopped();
      return parseCustomResponse(payload, validated);
    })();
    return await Promise.race([request, stopped]);
  } catch (error) {
    const code = stopCode || (error instanceof CustomQuotaError && Object.hasOwn(ERROR_MESSAGES, error.code) ? error.code : 'NETWORK');
    throw new CustomQuotaError(code);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

module.exports = {customDefaults, validateCustomConfig, emptyCustomQuota, parseCustomResponse, restoreCustomQuota, fetchCustomQuota};
