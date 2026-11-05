const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 60000;
const MAX_BODY_BYTES = 65536;
const ERROR_MESSAGES = {
  INVALID_KEY: 'A nonempty DeepSeek API key without CR/LF is required.',
  INVALID_OPTIONS: 'DeepSeek requires a fetch function and an integer timeout from 1 to 60000 ms.',
  UNAUTHORIZED: 'DeepSeek authentication failed (401). Check the API key.',
  FORBIDDEN: 'DeepSeek balance access was denied (403).',
  RATE_LIMITED: 'DeepSeek rate limit reached (429). Retry later.',
  HTTP_ERROR: 'DeepSeek balance request failed.',
  NETWORK: 'DeepSeek balance could not be retrieved. Check the network.',
  TIMEOUT: 'DeepSeek balance request timed out.',
  INVALID_RESPONSE: 'DeepSeek returned an invalid or unsupported balance response.'
};

class DeepSeekBalanceError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = 'DeepSeekBalanceError';
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function parseAmount(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    throw new DeepSeekBalanceError('INVALID_RESPONSE');
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER) {
    throw new DeepSeekBalanceError('INVALID_RESPONSE');
  }
  return amount;
}

function parseDeepSeekBalance(payload, updatedAt = new Date().toISOString()) {
  try {
    if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) ||
        new Date(updatedAt).toISOString() !== updatedAt) {
      throw new DeepSeekBalanceError('INVALID_RESPONSE');
    }
    if (!isRecord(payload) || !Object.hasOwn(payload, 'is_available') ||
        typeof payload.is_available !== 'boolean' || !Object.hasOwn(payload, 'balance_infos') ||
        !Array.isArray(payload.balance_infos) || payload.balance_infos.length < 1 || payload.balance_infos.length > 2) {
      throw new DeepSeekBalanceError('INVALID_RESPONSE');
    }
    const balances = new Map();
    for (const entry of payload.balance_infos) {
      if (!isRecord(entry) || !['currency', 'total_balance', 'granted_balance', 'topped_up_balance']
        .every((field) => Object.hasOwn(entry, field)) ||
        (entry.currency !== 'CNY' && entry.currency !== 'USD') || balances.has(entry.currency)) {
        throw new DeepSeekBalanceError('INVALID_RESPONSE');
      }
      balances.set(entry.currency, {
        remaining: parseAmount(entry.total_balance),
        granted: parseAmount(entry.granted_balance),
        toppedUp: parseAmount(entry.topped_up_balance)
      });
    }
    const currency = balances.has('CNY') ? 'CNY' : 'USD';
    const selected = balances.get(currency);
    return {
      kind: 'balance',
      source: 'deepseek',
      currency,
      remaining: selected.remaining,
      total: null,
      used: null,
      percentage: null,
      updatedAt,
      details: {granted: selected.granted, toppedUp: selected.toppedUp},
      available: payload.is_available
    };
  } catch {
    throw new DeepSeekBalanceError('INVALID_RESPONSE');
  }
}

async function readPayload(response, signal) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let byteCount = 0;
    const cancel = () => {
      try {Promise.resolve(reader.cancel()).catch(() => {});} catch {}
    };
    signal.addEventListener('abort', cancel, {once: true});
    try {
      while (true) {
        const chunk = await reader.read();
        if (signal.aborted) throw new DeepSeekBalanceError('TIMEOUT');
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > MAX_BODY_BYTES - byteCount) {
          throw new DeepSeekBalanceError('INVALID_RESPONSE');
        }
        byteCount += chunk.value.byteLength;
        chunks.push(Buffer.from(chunk.value));
      }
      return JSON.parse(Buffer.concat(chunks, byteCount).toString('utf8'));
    } catch (error) {
      cancel();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      throw new DeepSeekBalanceError('INVALID_RESPONSE');
    }
    return JSON.parse(text);
  }
  if (typeof response.json === 'function') return response.json();
  throw new DeepSeekBalanceError('INVALID_RESPONSE');
}

async function fetchDeepSeekBalance(apiKey, options = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    throw new DeepSeekBalanceError('INVALID_KEY');
  }
  let fetchImpl;
  let timeoutMs;
  try {
    if (!isRecord(options)) throw new DeepSeekBalanceError('INVALID_OPTIONS');
    fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
    timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new DeepSeekBalanceError('INVALID_OPTIONS');
    }
  } catch {
    throw new DeepSeekBalanceError('INVALID_OPTIONS');
  }
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new DeepSeekBalanceError('TIMEOUT'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      let response;
      try {
        response = await fetchImpl(BALANCE_URL, {
          method: 'GET',
          headers: {Authorization: 'Bearer ' + apiKey.trim(), Accept: 'application/json'},
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal
        });
      } catch {
        throw new DeepSeekBalanceError('NETWORK');
      }
      if (controller.signal.aborted) throw new DeepSeekBalanceError('TIMEOUT');
      if (!response || typeof response.status !== 'number' || !Number.isInteger(response.status) ||
          response.status < 100 || response.status > 599 || response.redirected === true ||
          (response.url && response.url !== BALANCE_URL)) {
        throw new DeepSeekBalanceError('INVALID_RESPONSE');
      }
      if (response.status !== 200) {
        const code = {401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 429: 'RATE_LIMITED'}[response.status] || 'HTTP_ERROR';
        throw new DeepSeekBalanceError(code);
      }
      let payload;
      try {
        payload = await readPayload(response, controller.signal);
      } catch (error) {
        if (error instanceof DeepSeekBalanceError) throw error;
        throw new DeepSeekBalanceError(error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK');
      }
      if (controller.signal.aborted) throw new DeepSeekBalanceError('TIMEOUT');
      return parseDeepSeekBalance(payload, new Date().toISOString());
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    const code = error instanceof DeepSeekBalanceError && Object.hasOwn(ERROR_MESSAGES, error.code) ? error.code : 'NETWORK';
    throw new DeepSeekBalanceError(code);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

module.exports = {fetchDeepSeekBalance, parseDeepSeekBalance};
