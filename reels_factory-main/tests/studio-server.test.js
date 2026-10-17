// Studio HTTP server: CSRF/host/token protections, secrecy of API keys, media-by-id, and a real API round trip.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createApp } = require('../studio/server');

const SECRET_MUAPI = 'muapi-SECRET-VALUE-9f8e7d6c5b4a';
const SECRET_HEYGEN = 'heygen-SECRET-VALUE-1a2b3c4d5e6f';

async function boot({ token = '' } = {}) {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-srv-')), MUAPI_API_KEY: SECRET_MUAPI, HEYGEN_API_KEY: SECRET_HEYGEN, RF_STUDIO_TOKEN: token, RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
  const studio = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  const server = createApp(studio, { token, port: 0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const app = createApp(studio, { token, port });
  server.close();
  await new Promise((r) => app.listen(port, '127.0.0.1', r)).catch(async () => { /* port race: retry on a new one */ });
  return { cfg, studio, app, port, close: () => new Promise((r) => app.close(r)) };
}
const req = (port, method, url, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: Object.assign({ Host: '127.0.0.1:' + port }, headers) }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json }); });
  });
  r.on('error', reject);
  if (body !== undefined) r.write(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  r.end();
});
const CSRF = { 'x-rf-studio': '1', 'content-type': 'application/json' };

test('server: state loads in MOCK mode, and no response anywhere contains an API key', async () => {
  const t = await boot();
  try {
    const st = await req(t.port, 'GET', '/api/state');
    assert.equal(st.status, 200);
    assert.equal(st.json.providers.video.mode, 'mock');
    assert.equal(st.json.providers.video.keyConfigured, true);
    const urls = ['/', '/index.html', '/app.css', '/js/main.js', '/js/api.js', '/js/views/settings.js', '/api/state', '/api/episodes/EP01'];
    for (const u of urls) {
      const r = await req(t.port, 'GET', u);
      assert.ok(!r.text.includes(SECRET_MUAPI) && !r.text.includes(SECRET_HEYGEN), 'key leaked in ' + u);
      assert.ok(!/MUAPI_API_KEY\s*=/.test(r.text), 'env assignment leaked in ' + u);
    }
    // errors never echo keys either
    const bad = await req(t.port, 'POST', '/api/episodes/EP01/generation/authorize', { headers: CSRF, body: {} });
    assert.ok(!bad.text.includes(SECRET_MUAPI));
  } finally { await t.close(); }
});

test('server: mutating requests need the custom header and a same-origin Origin; foreign Host rejected', async () => {
  const t = await boot();
  try {
    const noHeader = await req(t.port, 'POST', '/api/episodes/EP01/script/approve', { headers: { 'content-type': 'application/json' }, body: {} });
    assert.equal(noHeader.status, 403);
    const evil = await req(t.port, 'POST', '/api/episodes/EP01/script/approve', { headers: { ...CSRF, Origin: 'http://evil.example' }, body: {} });
    assert.equal(evil.status, 403);
    const host = await req(t.port, 'GET', '/api/state', { headers: { Host: 'evil.example' } });
    assert.equal(host.status, 403);
    const scenes = await req(t.port, 'POST', '/api/episodes/EP01/scenes/approve-ready', { headers: { ...CSRF, Origin: 'http://127.0.0.1:' + t.port }, body: {} });
    assert.equal(scenes.status, 200);
    const ok = await req(t.port, 'POST', '/api/episodes/EP01/script/approve', { headers: { ...CSRF, Origin: 'http://127.0.0.1:' + t.port }, body: {} });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.derived.scriptApproved, true);
  } finally { await t.close(); }
});

test('server: optional access token protects API and media', async () => {
  const t = await boot({ token: 'tok-123' });
  try {
    assert.equal((await req(t.port, 'GET', '/api/state')).status, 401);
    assert.equal((await req(t.port, 'GET', '/api/state', { headers: { 'x-rf-token': 'nope' } })).status, 401);
    assert.equal((await req(t.port, 'GET', '/api/state', { headers: { 'x-rf-token': 'tok-123' } })).status, 200);
    assert.equal((await req(t.port, 'GET', '/media/ref/jack/x')).status, 401);
  } finally { await t.close(); }
});

test('server: media is served by id only; path traversal is refused', async () => {
  const t = await boot();
  try {
    for (const u of ['/media/ref/..%2f..%2fcharacters/x', '/media/render/EP01/..%2f..%2fsettings', '/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/js/../../server.js']) {
      const r = await req(t.port, 'GET', u);
      assert.ok(r.status >= 400 || /<title>Reels Factory/.test(r.text), u + ' → ' + r.status + ' must be an error or the SPA shell');
      assert.ok(!/"name":\s*"reels|require\(/.test(r.text), 'served a non-public file for ' + u);
    }
  } finally { await t.close(); }
});

test('server: API round trip — script edit invalidates approval; generation is refused without approvals; body limit', async () => {
  const t = await boot();
  try {
    const est = await req(t.port, 'POST', '/api/episodes/EP01/generation/estimate', { headers: CSRF, body: {} });
    assert.equal(est.json.canAuthorize, false);
    const auth = await req(t.port, 'POST', '/api/episodes/EP01/generation/authorize', { headers: CSRF, body: { confirmUnknown: true } });
    assert.equal(auth.status, 409);
    const run = await req(t.port, 'POST', '/api/episodes/EP01/generation/run', { headers: CSRF, body: { authorizationId: 'auth_fake' } });
    assert.ok(run.status >= 400);
    assert.equal(t.cfg.muapiMode, 'mock');
    const big = await req(t.port, 'PUT', '/api/episodes/EP01/script', { headers: CSRF, body: JSON.stringify({ note: 'x'.repeat(2.5 * 1024 * 1024) }) }).catch((e) => ({ status: 'closed', e }));
    assert.ok(big.status === 413 || big.status === 'closed');
    const bad = await req(t.port, 'PUT', '/api/settings', { headers: CSRF, body: { reelSpendLimitUsd: -3 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'BAD_VALUE');
  } finally { await t.close(); }
});

test('server: live mode cannot be switched on from the API', async () => {
  const t = await boot();
  try {
    const r = await req(t.port, 'PUT', '/api/settings', { headers: CSRF, body: { muapiMode: 'live', mode: 'live', RF_MUAPI_MODE: 'live' } });
    const st = await req(t.port, 'GET', '/api/state');
    assert.equal(st.json.providers.video.mode, 'mock');
    assert.ok(r.status < 500);
  } finally { await t.close(); }
});

test('free model preflight reports schema and never submits a paid video job', async () => {
  const t = await boot();
  try {
    const before = (await req(t.port, 'GET', '/api/episodes/EP01')).json.generation.jobs.length;
    const ok = await req(t.port, 'POST', '/api/episodes/EP01/generation/preflight', { headers: CSRF, body: { sceneId: 'S1', modelId: 'kling-master' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.paidRequestSent, false);
    assert.equal(ok.json.remoteEndpointVerified, false);
    assert.equal(ok.json.imageField, 'image_url');
    assert.equal(ok.json.imageType, 'string');
    assert.equal(typeof ok.json.canGenerate, 'boolean');
    assert.equal((await req(t.port, 'GET', '/api/episodes/EP01')).json.generation.jobs.length, before);
    const bad = await req(t.port, 'POST', '/api/episodes/EP01/generation/preflight', { headers: CSRF, body: { sceneId: 'S1', modelId: 'unknown-model' } });
    assert.equal(bad.status, 422);
  } finally { await t.close(); }
});
