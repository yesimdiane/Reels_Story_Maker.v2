// Credentials for server-to-Google calls (Sheets + Drive). Two providers:
//   * refresh token (user-owned My Drive / personal Gmail): the owner authorizes ONCE (scripts/google-authorize.js); the
//     long-lived refresh token lives only in a server environment variable and is exchanged for short-lived access tokens.
//   * service account (Google Workspace Shared Drive): signs a JWT with its private key. Does NOT work for a personal My Drive
//     (files it creates are owned by the service account and count against its own quota).
// Secrets never appear in thrown errors or logs.
'use strict';
const crypto = require('node:crypto');
const { StudioError, sleep } = require('../util');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = {
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  driveFile: 'https://www.googleapis.com/auth/drive.file',
  driveFull: 'https://www.googleapis.com/auth/drive',
};
const WORKSPACE_SCOPES = [SCOPES.sheets, SCOPES.driveFile];

const b64u = (b) => Buffer.from(b).toString('base64url');

function tokenError(status, body) {
  const e = body && body.error;
  const code = typeof e === 'string' ? e : (e && (e.status || e.message)) || 'unknown';
  if (code === 'invalid_grant') {
    return new StudioError('GOOGLE_AUTH_REVOKED', 'Google 인증이 만료되었거나 취소되었습니다 (refresh token invalid_grant).', {
      recovery: 'OAuth 동의 화면이 "테스트" 상태면 refresh token이 7일 뒤 만료됩니다 — "프로덕션"으로 게시한 뒤 scripts/google-authorize.js 로 새 토큰을 받아 GOOGLE_REFRESH_TOKEN을 교체하세요.', status: 503,
    });
  }
  return new StudioError('GOOGLE_AUTH_FAILED', `Google 토큰 발급 실패 (HTTP ${status}, ${code}).`, { recovery: 'GOOGLE_OAUTH_CLIENT_ID / SECRET / GOOGLE_REFRESH_TOKEN 값을 확인하세요.', status: 503 });
}

/** Posts to the token endpoint; transient failures (network, 429, 5xx) are retried with backoff, invalid_grant never is. */
async function postToken(fetchFn, tokenUrl, form, sleepFn) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetchFn(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (attempt < 3) { await sleepFn(500 * 2 ** attempt); continue; }
      throw new StudioError('GOOGLE_AUTH_FAILED', 'Google 토큰 서버에 연결하지 못했습니다.', { status: 503 });
    }
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text); } catch (_) { /* leave empty */ }
    if (res.ok && body.access_token) return body;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleepFn(500 * 2 ** attempt); continue; }
    throw tokenError(res.status, body);
  }
}

/** Caches the access token until shortly before it expires; concurrent callers share one refresh. */
function cachedProvider(fetchToken, now) {
  let tok = null;
  let inflight = null;
  return {
    async getToken() {
      if (tok && tok.exp - 60000 > now()) return tok.value;
      if (!inflight) {
        inflight = fetchToken().then((t) => { tok = { value: t.access_token, exp: now() + (Number(t.expires_in) || 3600) * 1000 }; return tok.value; }).finally(() => { inflight = null; });
      }
      return inflight;
    },
    invalidate() { tok = null; },
  };
}

function createRefreshTokenProvider({ clientId, clientSecret, refreshToken, fetchFn = globalThis.fetch, now = () => Date.now(), tokenUrl = TOKEN_URL, sleepFn = sleep }) {
  if (!clientId || !clientSecret || !refreshToken) throw new StudioError('GOOGLE_NOT_CONFIGURED', 'Google Workspace 연결 설정(GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)이 없습니다.', { status: 500 });
  return Object.assign({ kind: 'oauth-refresh' }, cachedProvider(() => postToken(fetchFn, tokenUrl, { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, sleepFn), now));
}

function createServiceAccountProvider({ clientEmail, privateKey, scopes = WORKSPACE_SCOPES, subject = '', fetchFn = globalThis.fetch, now = () => Date.now(), tokenUrl = TOKEN_URL, sleepFn = sleep }) {
  if (!clientEmail || !privateKey) throw new StudioError('GOOGLE_NOT_CONFIGURED', '서비스 계정 설정(client_email / private_key)이 없습니다.', { status: 500 });
  const pem = String(privateKey).replace(/\\n/g, '\n');
  return Object.assign({ kind: 'service-account' }, cachedProvider(async () => {
    const iat = Math.floor(now() / 1000);
    const claims = { iss: clientEmail, scope: scopes.join(' '), aud: tokenUrl, iat, exp: iat + 3600 };
    if (subject) claims.sub = subject;
    const data = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claims));
    const sig = crypto.sign('RSA-SHA256', Buffer.from(data), pem).toString('base64url');
    return postToken(fetchFn, tokenUrl, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: data + '.' + sig }, sleepFn);
  }, now));
}

/** Picks the provider from config. cfg.googleAuthProvider: 'oauth' (default) | 'service_account'. */
function providerFromConfig(cfg, fetchFn) {
  if (cfg.googleAuthProvider === 'service_account') {
    let sa;
    try { sa = JSON.parse(cfg.googleServiceAccountJson || '{}'); } catch (_) { throw new StudioError('GOOGLE_NOT_CONFIGURED', 'GOOGLE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.', { status: 500 }); }
    return createServiceAccountProvider({ clientEmail: sa.client_email, privateKey: sa.private_key, fetchFn });
  }
  return createRefreshTokenProvider({ clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret, refreshToken: cfg.googleRefreshToken, fetchFn });
}

module.exports = { createRefreshTokenProvider, createServiceAccountProvider, providerFromConfig, SCOPES, WORKSPACE_SCOPES, TOKEN_URL };
