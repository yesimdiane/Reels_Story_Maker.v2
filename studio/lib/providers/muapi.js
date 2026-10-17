// Muapi video provider adapter.
//
// Verified against the official docs (https://muapi.ai/docs, checked 2026-10-11):
//   base URL         https://api.muapi.ai/api/v1
//   auth             header  x-api-key: <key>
//   submit           POST {base}/{model endpoint}   body = model-specific JSON  → { request_id, status, cost }
//   poll             GET  {base}/predictions/{request_id}/result → { id, status, outputs[], cost }
//                    status: queued | pending | processing | completed | failed | cancelled
//   upload           POST {base}/upload_file  (multipart, field "file") → { url }   (images ≤10 MB; URL expires in 1 h)
//   balance          GET  {base}/account/balance → { balance }
//   catalog          GET  {base}/models
//   cost             response `cost` object { amount_usd, amount_credits, bonus_credits_used, refunded }
//                    and headers X-MuAPI-Cost-USD / X-MuAPI-Cost-Credits
// NOT documented (so NOT assumed here): rate-limit numbers, error-code tables, refund rules for failed jobs,
// a per-model price list, a cost-estimate endpoint, and which model endpoints accept which parameters beyond the
// examples. Model endpoints/parameters therefore come from studio/seed/models.json and must be confirmed by the
// operator on the Muapi playground before the first live run.
//
// Billing-safety rules implemented here:
//   * submit is retried ONLY on HTTP 429 (the request was refused). A timeout, network error or 5xx after the
//     request was sent is reported as `uncertain` and is NEVER re-sent automatically (it might have been billed).
//   * polling (GET, free) is retried with backoff on transient errors.
//   * nothing in this file runs at import time; every network call is an explicit method call.
'use strict';
const { validateEndpoint, buildBody } = require('../modelcontract');
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic, sleep } = require('../util');

class ProviderError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code; // AUTH | CREDITS | RATE_LIMIT | BAD_REQUEST | SERVER | NETWORK | TIMEOUT | UNCERTAIN | FAILED | NO_OUTPUT
    this.status = extra.status || 0;
    this.retryable = !!extra.retryable;
    this.uncertain = !!extra.uncertain; // the request may have been accepted (and billed)
    this.requestId = extra.requestId || '';
  }
}

const IN_PROGRESS = new Set(['queued', 'pending', 'processing', 'running', 'starting', 'in_progress']);
const FAILED = new Set(['failed', 'cancelled', 'canceled', 'error']);

function mapHttpError(status, body, requestId) {
  const msg = (body && (body.detail || body.error || body.message)) || '';
  const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
  if (status === 401 || status === 403) return new ProviderError('AUTH', 'Muapi API 키가 거부되었습니다 (HTTP ' + status + '). renderer/.env의 MUAPI_API_KEY를 확인하세요. ' + text, { status });
  if (status === 402) return new ProviderError('CREDITS', 'Muapi 크레딧이 부족합니다 (HTTP 402). Muapi 대시보드 Billing에서 충전하세요. ' + text, { status });
  if (status === 429) return new ProviderError('RATE_LIMIT', 'Muapi 요청 한도에 걸렸습니다 (HTTP 429). 잠시 후 다시 시도하세요.', { status, retryable: true });
  if (status >= 400 && status < 500) return new ProviderError('BAD_REQUEST', 'Muapi가 요청을 거부했습니다 (HTTP ' + status + '): ' + text, { status });
  return new ProviderError('SERVER', 'Muapi 서버 오류 (HTTP ' + status + '). ' + text, { status, retryable: false, uncertain: true, requestId });
}

function parseCost(body, headers) {
  const c = (body && body.cost) || null;
  const h = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  const usdHeader = h('X-MuAPI-Cost-USD');
  const credHeader = h('X-MuAPI-Cost-Credits');
  const usd = c && c.amount_usd != null ? Number(c.amount_usd) : usdHeader != null ? Number(usdHeader) : null;
  const credits = c && c.amount_credits != null ? Number(c.amount_credits) : credHeader != null ? Number(credHeader) : null;
  if (usd == null && credits == null) return null;
  return {
    amountUsd: Number.isFinite(usd) ? usd : null,
    amountCredits: Number.isFinite(credits) ? credits : null,
    bonusCreditsUsed: c && c.bonus_credits_used != null ? Number(c.bonus_credits_used) : null,
    refunded: c && c.refunded != null ? !!c.refunded : null,
  };
}

function createMuapiProvider({
  apiKey,
  baseUrl = 'https://api.muapi.ai/api/v1',
  fetchFn = globalThis.fetch,
  timeoutMs = 60000,
  maxSubmitAttempts = 3,
  maxPollErrors = 5,
  pollIntervalMs = 5000,
  pollTimeoutMs = 10 * 60 * 1000,
  sleepFn = sleep,
  log = () => {},
} = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const need = () => {
    if (!apiKey) throw new ProviderError('AUTH', 'MUAPI_API_KEY가 없습니다. renderer/.env에 MUAPI_API_KEY=... 를 넣으세요 (키는 서버에서만 사용됩니다).');
  };

  async function request(method, url, { body, headers = {}, form } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const init = { method, headers: Object.assign({ 'x-api-key': apiKey }, headers), signal: ctl.signal };
      if (form) init.body = form;
      else if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
      return await fetchFn(url, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new ProviderError('TIMEOUT', 'Muapi 응답 시간이 초과되었습니다 (' + timeoutMs / 1000 + '초).', { uncertain: method === 'POST', retryable: method === 'GET' });
      throw new ProviderError('NETWORK', 'Muapi에 연결하지 못했습니다: ' + (e && e.message), { uncertain: method === 'POST', retryable: method === 'GET' });
    } finally {
      clearTimeout(timer);
    }
  }
  const readJson = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  const api = {
    name: 'muapi',
    mode: 'live',
    paid: true,

    capabilities() {
      return { imageToVideo: true, textToVideo: false, lipSync: false, lipSyncNote: 'Lip-sync is not enabled: it is not confirmed for the selected image-to-video models.' };
    },

    /** Free: account balance (credits). */
    async balance() {
      need();
      const res = await request('GET', base + '/account/balance');
      const j = await readJson(res);
      if (!res.ok) throw mapHttpError(res.status, j);
      return { balance: j && j.balance != null ? Number(j.balance) : null };
    },

    /** Free: model catalog (GET /models). */
    async listModels() {
      need();
      const res = await request('GET', base + '/models');
      const j = await readJson(res);
      if (!res.ok) throw mapHttpError(res.status, j);
      return j;
    },

    /** Uploads a local image so it can be used as `image_url` (uploads are free but need a positive balance). */
    async uploadImage(file) {
      need();
      const buf = fs.readFileSync(file);
      if (buf.length > 10 * 1024 * 1024) throw new ProviderError('BAD_REQUEST', '이미지가 10 MB를 넘습니다 (Muapi 이미지 업로드 한도).');
      const form = new FormData();
      form.append('file', new Blob([buf]), path.basename(file));
      const res = await request('POST', base + '/upload_file', { form });
      const j = await readJson(res);
      if (!res.ok) throw mapHttpError(res.status, j);
      if (!j || !j.url) throw new ProviderError('NO_OUTPUT', 'Muapi 업로드 응답에 url이 없습니다.');
      return { url: j.url, expiresInSec: 3600 };
    },

    /**
     * Starts ONE billable generation. Returns { requestId, status, cost }.
     * model: { endpoint, imageField?, promptField?, extraParams? } from the model registry.
     */
    async submit({ model, prompt, imageUrl, aspectRatio = '9:16', duration, negativePrompt, extra = {}, silent = false }) {
      need();
      if (!model || !model.endpoint) throw new ProviderError('BAD_REQUEST', '모델 엔드포인트가 설정되지 않았습니다.');
      const ep = validateEndpoint(model.endpoint);
      if (!ep) throw new ProviderError('BAD_REQUEST', '모델 엔드포인트 형식이 올바르지 않습니다 (MuAPI 기본 주소 아래의 경로만 허용).');
      const body = buildBody(model, { prompt, imageUrl, aspectRatio, duration, negativePrompt, extra, silent });
      const url = base + '/' + ep;
      let lastErr = null;
      for (let attempt = 1; attempt <= maxSubmitAttempts; attempt++) {
        let res;
        try {
          res = await request('POST', url, { body });
        } catch (e) {
          throw e; // network/timeout after send: uncertain, never re-sent
        }
        const j = await readJson(res);
        if (res.ok) {
          const id = j && (j.request_id || j.id);
          if (!id) throw new ProviderError('NO_OUTPUT', 'Muapi 응답에 request_id가 없습니다. 요금이 청구되었을 수 있으니 Muapi History를 확인하세요.', { uncertain: true });
          return { requestId: String(id), status: (j.status || 'queued').toLowerCase(), cost: parseCost(j, res.headers), raw: { status: j.status } };
        }
        lastErr = mapHttpError(res.status, j);
        if (res.status !== 429 || attempt === maxSubmitAttempts) throw lastErr;
        const ra = Number(res.headers && res.headers.get && res.headers.get('Retry-After'));
        await sleepFn(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * attempt);
      }
      throw lastErr;
    },

    /** One status check (free). */
    async pollOnce(requestId) {
      need();
      const res = await request('GET', base + '/predictions/' + encodeURIComponent(requestId) + '/result');
      const j = await readJson(res);
      if (!res.ok) throw mapHttpError(res.status, j, requestId);
      const status = String((j && j.status) || '').toLowerCase();
      const outputs = (j && Array.isArray(j.outputs) ? j.outputs : []).filter((o) => typeof o === 'string');
      return {
        status: status === 'completed' ? 'completed' : FAILED.has(status) ? 'failed' : IN_PROGRESS.has(status) || !status ? 'processing' : 'processing',
        rawStatus: status,
        outputs,
        error: (j && (j.error || j.detail)) || '',
        cost: parseCost(j, res.headers),
      };
    },

    /** Polls until completed/failed or the timeout. Transient poll errors are retried with backoff. */
    async waitForResult(requestId, { onProgress } = {}) {
      const started = Date.now();
      let errors = 0;
      for (;;) {
        let r;
        try {
          r = await this.pollOnce(requestId);
          errors = 0;
        } catch (e) {
          if (e.code === 'AUTH' || e.code === 'BAD_REQUEST' || e.code === 'CREDITS') throw e;
          errors += 1;
          if (errors > maxPollErrors) throw new ProviderError('NETWORK', 'Muapi 상태 확인이 계속 실패합니다: ' + e.message + ' (요청 ID ' + requestId + ' — 나중에 "다시 확인"을 누르세요)', { requestId, uncertain: true });
          await sleepFn(Math.min(30000, 1000 * 2 ** errors));
          continue;
        }
        if (onProgress) onProgress(r);
        if (r.status === 'completed') {
          if (!r.outputs.length) throw new ProviderError('NO_OUTPUT', 'Muapi가 완료로 응답했지만 결과 파일이 없습니다 (요청 ID ' + requestId + ').', { requestId });
          return r;
        }
        if (r.status === 'failed') throw new ProviderError('FAILED', 'Muapi 생성이 실패했습니다' + (r.error ? ': ' + (typeof r.error === 'string' ? r.error : JSON.stringify(r.error)) : '') + ' (요청 ID ' + requestId + ').', { requestId });
        if (Date.now() - started > pollTimeoutMs) throw new ProviderError('TIMEOUT', 'Muapi 생성이 ' + Math.round(pollTimeoutMs / 60000) + '분 안에 끝나지 않았습니다 (요청 ID ' + requestId + '). 작업은 계속 진행 중일 수 있으니 "다시 확인"으로 이어서 확인하세요.', { requestId });
        await sleepFn(pollIntervalMs);
      }
    },

    /** Downloads an output file (free) to dest, atomically. */
    async download(url, dest) {
      let res;
      try {
        res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs * 4) });
      } catch (e) {
        throw new ProviderError('NETWORK', '결과 파일을 내려받지 못했습니다: ' + e.message, { retryable: true });
      }
      if (!res.ok) throw new ProviderError('NETWORK', '결과 파일 다운로드 실패 (HTTP ' + res.status + ').', { status: res.status, retryable: true });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new ProviderError('NO_OUTPUT', '내려받은 파일이 너무 작습니다 (' + buf.length + ' bytes).');
      writeFileAtomic(dest, buf);
      return { size: buf.length };
    },
  };
  // Defence in depth: whatever a server echoes back, the API key is never part of an error we surface or log.
  const redact = (e) => {
    if (apiKey && e && typeof e.message === 'string') e.message = e.message.split(apiKey).join('[redacted]');
    return e;
  };
  for (const k of Object.keys(api)) {
    if (typeof api[k] !== 'function' || k === 'capabilities') continue;
    const fn = api[k];
    api[k] = async function (...a) {
      try {
        return await fn.apply(api, a);
      } catch (e) {
        throw redact(e);
      }
    };
  }
  return api;
}

module.exports = { createMuapiProvider, ProviderError, parseCost };
