// Google API HTTP wrapper: bearer auth from a token provider, timeouts, and retries with exponential backoff + jitter for
// transient failures (429 / 5xx / network errors / Google rate-limit 403s). A 401 refreshes the token once and replays.
// Errors never contain the Authorization header or any token. fetch / sleep / random are injectable so tests never wait.
'use strict';
const { sleep } = require('../util');

class GoogleApiError extends Error {
  constructor(message, { status = 0, reason = '', retryable = false, url = '' } = {}) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.reason = reason;
    this.retryable = retryable;
    this.url = url;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

async function readError(res) {
  let text = '';
  try { text = await res.text(); } catch (_) { /* body unreadable */ }
  let message = text.slice(0, 300);
  let reason = '';
  try {
    const j = JSON.parse(text);
    if (j.error) {
      message = j.error.message || j.error_description || (typeof j.error === 'string' ? j.error : message);
      reason = (j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || j.error.status || (typeof j.error === 'string' ? j.error : '');
    }
  } catch (_) { /* not JSON */ }
  return { message, reason };
}

function createGoogleHttp({ tokenProvider, fetchFn = globalThis.fetch, sleepFn = sleep, random = Math.random, maxRetries = 5, baseDelayMs = 500, maxDelayMs = 20000, timeoutMs = 60000, minIntervalMs = 0, now = () => Date.now(), log = () => {} } = {}) {
  let lastCall = 0;
  const stats = { requests: 0, retries: 0 };

  async function throttle() {
    if (!minIntervalMs) return;
    const wait = lastCall + minIntervalMs - now();
    lastCall = Math.max(now(), lastCall + minIntervalMs);
    if (wait > 0) await sleepFn(wait);
  }

  /** as: 'json' (default) | 'text' | 'buffer' | 'response' (caller reads status/headers/body). */
  async function request(method, url, { json, body, headers = {}, expect = [200], as = 'json', auth = true, retry = true } = {}) {
    let refreshed = false;
    let attempt = 0;
    for (;;) {
      await throttle();
      const h = Object.assign({}, headers);
      if (auth) h.Authorization = 'Bearer ' + (await tokenProvider.getToken());
      let payload = body;
      if (json !== undefined) {
        payload = JSON.stringify(json);
        if (!h['Content-Type']) h['Content-Type'] = 'application/json; charset=UTF-8';
      }
      stats.requests += 1;
      let res;
      try {
        res = await fetchFn(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (retry && attempt < maxRetries) {
          attempt += 1; stats.retries += 1;
          const d = backoff(attempt, 0);
          log(`google ${method} network error, retry ${attempt}/${maxRetries} in ${d}ms`);
          await sleepFn(d);
          continue;
        }
        throw new GoogleApiError('Google API에 연결하지 못했습니다: ' + (e && e.message), { retryable: true, url: safeUrl(url) });
      }
      if (expect.includes(res.status)) {
        if (as === 'response') return res;
        if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
        if (as === 'text') return res.text();
        const t = await res.text();
        return t ? JSON.parse(t) : {};
      }
      if (res.status === 401 && auth && !refreshed) {
        refreshed = true;
        tokenProvider.invalidate && tokenProvider.invalidate();
        continue;
      }
      const { message, reason } = await readError(res);
      const retryable = RETRYABLE_STATUS.has(res.status) || (res.status === 403 && RETRYABLE_REASONS.has(reason));
      if (retry && retryable && attempt < maxRetries) {
        attempt += 1; stats.retries += 1;
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        const d = backoff(attempt, ra);
        log(`google ${method} ${res.status} (${reason || 'transient'}), retry ${attempt}/${maxRetries} in ${d}ms`);
        await sleepFn(d);
        continue;
      }
      throw new GoogleApiError(`Google API 오류 (HTTP ${res.status}${reason ? ' ' + reason : ''}): ${message}`, { status: res.status, reason, retryable, url: safeUrl(url) });
    }
  }

  function backoff(attempt, retryAfterSec) {
    if (retryAfterSec > 0) return Math.min(maxDelayMs, Math.round(retryAfterSec * 1000));
    const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    return Math.round(cap * (0.5 + random() / 2));
  }
  // Query strings can carry ids; they never carry tokens (those go in the header), but keep logs short anyway.
  const safeUrl = (u) => String(u).split('?')[0];

  return { request, stats };
}

module.exports = { createGoogleHttp, GoogleApiError };
