// Google sign-in: OAuth 2.0 authorization-code flow with PKCE + OpenID Connect, verified on the SERVER.
//   * the browser only ever carries a one-time `state`/`code`; the client secret and tokens never reach it;
//   * the ID token's RS256 signature is checked against Google's published keys (JWKS), plus iss, aud, exp, iat, nonce, email_verified;
//   * the e-mail address that is trusted is the one INSIDE the verified token — never anything the client sends.
// This proves WHO signed in. Whether that person may use the Studio is decided separately by the allowlist (access.js).
'use strict';
const crypto = require('node:crypto');
const { StudioError } = require('../util');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const b64u = (b) => Buffer.from(b).toString('base64url');
const eq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const denied = (message, code = 'LOGIN_DENIED') => new StudioError(code, message, { status: 401, recovery: '다시 로그인해 보세요.' });

function createGoogleLogin({ clientId, clientSecret, redirectUri, fetchFn = globalThis.fetch, now = () => Date.now(), authUrl = AUTH_URL, tokenUrl = TOKEN_URL, jwksUrl = JWKS_URL, stateTtlMs = 10 * 60 * 1000, clockSkewSec = 120 }) {
  if (!clientId || !clientSecret || !redirectUri) throw new StudioError('GOOGLE_LOGIN_NOT_CONFIGURED', 'Google 로그인 설정(GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / 리디렉션 URI)이 없습니다.', { status: 500 });
  const pending = new Map(); // state -> { nonce, verifier, bind, at }
  let jwks = { keys: [], at: 0, maxAgeMs: 0 };
  let lastForcedRefresh = 0;

  function sweep() {
    for (const [k, v] of pending) if (now() - v.at > stateTtlMs) pending.delete(k);
    if (pending.size > 500) pending.delete(pending.keys().next().value); // bound memory under abuse
  }

  /** Returns { url, bind }: redirect the browser to `url` and set `bind` in an HttpOnly cookie (binds the flow to this browser). */
  function start() {
    sweep();
    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const bind = crypto.randomBytes(24).toString('base64url');
    pending.set(state, { nonce, verifier, bind, at: now() });
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email',
      state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      access_type: 'online', prompt: 'select_account', include_granted_scopes: 'false',
    });
    return { url: authUrl + '?' + q.toString(), bind, state };
  }

  async function loadJwks(force) {
    if (!force && jwks.keys.length && now() - jwks.at < jwks.maxAgeMs) return jwks.keys;
    const res = await fetchFn(jwksUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new StudioError('GOOGLE_JWKS', 'Google 서명 키를 가져오지 못했습니다.', { status: 503 });
    const body = await res.json();
    const m = /max-age=(\d+)/.exec((res.headers && res.headers.get && res.headers.get('cache-control')) || '');
    jwks = { keys: body.keys || [], at: now(), maxAgeMs: (m ? Number(m[1]) : 3600) * 1000 };
    return jwks.keys;
  }

  /** Verifies signature + claims. Returns the claims, or throws LOGIN_DENIED. */
  async function verifyIdToken(idToken, { nonce } = {}) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw denied('로그인 토큰 형식이 올바르지 않습니다.');
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (_) { throw denied('로그인 토큰을 읽을 수 없습니다.'); }
    if (header.alg !== 'RS256') throw denied('지원하지 않는 서명 방식입니다.'); // blocks alg=none / HS256 confusion
    let keys = await loadJwks(false);
    let jwk = keys.find((k) => k.kid === header.kid && (!k.alg || k.alg === 'RS256'));
    if (!jwk && now() - lastForcedRefresh > 60000) { // Google rotates keys: look again once a minute at most
      lastForcedRefresh = now();
      keys = await loadJwks(true);
      jwk = keys.find((k) => k.kid === header.kid && (!k.alg || k.alg === 'RS256'));
    }
    if (!jwk) throw denied('로그인 토큰의 서명 키를 찾을 수 없습니다.');
    let ok = false;
    try {
      ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch (_) { ok = false; }
    if (!ok) throw denied('로그인 토큰의 서명이 올바르지 않습니다.');
    const t = Math.floor(now() / 1000);
    if (!ISSUERS.has(claims.iss)) throw denied('로그인 토큰의 발급자가 Google이 아닙니다.');
    if (claims.aud !== clientId) throw denied('로그인 토큰이 이 앱을 위한 것이 아닙니다.');
    if (claims.azp && claims.azp !== clientId) throw denied('로그인 토큰이 이 앱을 위한 것이 아닙니다.');
    if (!(claims.exp > t - clockSkewSec)) throw denied('로그인 토큰이 만료되었습니다.');
    if (claims.iat && claims.iat > t + clockSkewSec) throw denied('로그인 토큰의 발급 시각이 올바르지 않습니다.');
    if (nonce !== undefined && !eq(claims.nonce || '', nonce)) throw denied('로그인 요청이 일치하지 않습니다 (nonce).');
    if (!claims.sub) throw denied('로그인 토큰에 사용자 식별자가 없습니다.');
    if (!claims.email || claims.email_verified !== true) throw denied('이메일이 확인된 Google 계정만 로그인할 수 있습니다.');
    return claims;
  }

  /** Completes the flow from the callback query. Returns { email, sub, name }. */
  async function finish({ code, state, error, bind }) {
    sweep();
    if (error) throw denied('Google 로그인이 취소되었거나 거부되었습니다 (' + String(error).slice(0, 40) + ').');
    const p = pending.get(String(state || ''));
    pending.delete(String(state || '')); // single use, even on failure
    if (!p) throw denied('로그인 요청이 만료되었거나 이미 사용되었습니다. 처음부터 다시 시도하세요.');
    if (now() - p.at > stateTtlMs) throw denied('로그인 요청이 만료되었습니다. 다시 시도하세요.');
    if (!bind || !eq(bind, p.bind)) throw denied('이 브라우저에서 시작한 로그인 요청이 아닙니다.');
    if (!code) throw denied('인증 코드가 없습니다.');
    const res = await fetchFn(tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30000),
      body: new URLSearchParams({ code: String(code), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: p.verifier }).toString(),
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* leave empty */ }
    if (!res.ok || !body.id_token) throw denied('Google이 로그인 코드를 받아들이지 않았습니다 (' + (body.error || res.status) + ').');
    const claims = await verifyIdToken(body.id_token, { nonce: p.nonce });
    return { email: String(claims.email).trim().toLowerCase(), sub: String(claims.sub), name: String(claims.name || '').slice(0, 120) };
  }

  return { start, finish, verifyIdToken, pendingCount: () => pending.size };
}

module.exports = { createGoogleLogin, AUTH_URL, TOKEN_URL, JWKS_URL };
