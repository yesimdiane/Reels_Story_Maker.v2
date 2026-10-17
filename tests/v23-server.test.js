'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, createAuth, start } = require('../studio/server');
const { make, png } = require('./helpers/v23');

const KEYS = ['gemini-SECRET-0123456789', 'muapi-SECRET-0123456789'];
async function boot({ password = '', env = {} } = {}) {
  const { cfg, s } = make({ env: Object.assign({ GEMINI_API_KEY: KEYS[0], MUAPI_API_KEY: KEYS[1] }, env) });
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
  const auth = createAuth({ password, secret: 'k' });
  const app = createApp(s, { port, auth });
  await new Promise((r) => app.listen(port, '127.0.0.1', r));
  return { s, port, auth, close: () => new Promise((r) => app.close(r)) };
}
const req = (port, method, url, { headers = {}, body, raw } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: Object.assign({ Host: '127.0.0.1:' + port }, headers) }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, headers: res.headers, text: t, json: j }); });
  });
  r.on('error', reject);
  if (raw) r.write(raw); else if (body !== undefined) r.write(JSON.stringify(body));
  r.end();
});
const H = { 'x-rf-studio': '1', 'content-type': 'application/json' };

test('healthz is public, secret-free and reports schema/mode', async () => {
  const t = await boot({ password: 'a-long-admin-password' });
  try {
    const r = await req(t.port, 'GET', '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true); assert.equal(r.json.video, 'mock'); assert.equal(r.json.schemaVersion, 3);
    KEYS.forEach((k) => assert.ok(!r.text.includes(k)));
  } finally { await t.close(); }
});

test('login: API and media are protected; wrong password rate-limited; cookie is HttpOnly/SameSite=Strict; logout works', async () => {
  const t = await boot({ password: 'a-long-admin-password' });
  try {
    assert.equal((await req(t.port, 'GET', '/api/state')).status, 401);
    assert.equal((await req(t.port, 'GET', '/media/ref/jack/x')).status, 401);
    assert.equal((await req(t.port, 'GET', '/api/session')).json.authenticated, false);
    assert.equal((await req(t.port, 'GET', '/')).status, 200, 'static shell (login screen) is reachable');
    for (let i = 0; i < 5; i++) assert.equal((await req(t.port, 'POST', '/api/login', { headers: H, body: { password: 'nope' } })).status, 401);
    assert.equal((await req(t.port, 'POST', '/api/login', { headers: H, body: { password: 'a-long-admin-password' } })).status, 429, 'locked after 5 failures');
  } finally { await t.close(); }
  const t2 = await boot({ password: 'a-long-admin-password' });
  try {
    const ok = await req(t2.port, 'POST', '/api/login', { headers: H, body: { password: 'a-long-admin-password' } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const c = cookie.split(';')[0];
    assert.equal((await req(t2.port, 'GET', '/api/state', { headers: { cookie: c } })).status, 200);
    assert.equal((await req(t2.port, 'GET', '/api/state', { headers: { cookie: c.slice(0, -3) + 'abc' } })).status, 401, 'tampered cookie');
    assert.equal((await req(t2.port, 'POST', '/api/products', { headers: Object.assign({ cookie: c }, { 'content-type': 'application/json' }), body: { name: 'x' } })).status, 403, 'CSRF header still required');
  } finally { await t2.close(); }
  const exp = createAuth({ password: 'p', secret: 's', ttlMs: 1000, now: () => 1e12 });
  const tok = exp.attempt('ip', 'p');
  assert.equal(createAuth({ password: 'p', secret: 's', now: () => 1e12 + 5000 }).verify(tok), false, 'expired session');
  assert.equal(createAuth({ password: 'p', secret: 'other', now: () => 1e12 }).verify(tok), false, 'different signing secret');
});

test('production start refuses without RF_MASTER_KEY / RF_ADMIN_PASSWORD (and short passwords)', () => {
  const { loadConfig } = require('../renderer/lib/config');
  const c = (env) => loadConfig(Object.assign({ RF_ENV: 'production' }, env), { dotenvFile: '/nonexistent' });
  assert.throws(() => start(c({})), /RF_MASTER_KEY, RF_ADMIN_PASSWORD/);
  assert.throws(() => start(c({ RF_MASTER_KEY: 'x'.repeat(20) })), /RF_ADMIN_PASSWORD/);
  assert.throws(() => start(c({ RF_MASTER_KEY: 'x'.repeat(20), RF_ADMIN_PASSWORD: 'short' })), /12자/);
});

test('API: key management never returns a key; errors are scrubbed; full Story Lab flow over HTTP in sample mode', async () => {
  const t = await boot();
  try {
    const put = await req(t.port, 'PUT', '/api/ai/keys/openai', { headers: H, body: { key: 'openai-VERY-SECRET-0099887766' } });
    assert.equal(put.status, 200);
    assert.ok(!put.text.includes('VERY-SECRET'));
    const ov = await req(t.port, 'GET', '/api/ai');
    assert.ok(!ov.text.includes('VERY-SECRET') && !ov.text.includes(KEYS[0]) && !ov.text.includes(KEYS[1]));
    assert.equal(ov.json.providers.find((p) => p.id === 'openai').key.last4, '7766');
    for (const u of ['/api/state', '/api/products', '/api/ai/usage', '/api/prompts']) {
      const r = await req(t.port, 'GET', u);
      assert.ok(!r.text.includes('VERY-SECRET') && !r.text.includes(KEYS[0]), u);
    }
    // manual episode creation without a concept is refused
    const bad = await req(t.port, 'POST', '/api/episodes', { headers: H, body: { id: 'EP9', title: 't' } });
    assert.equal(bad.status, 409); assert.equal(bad.json.error.code, 'CONCEPT_REQUIRED');
    // product → images → reference set → concepts → approve → episode → script
    const p = (await req(t.port, 'POST', '/api/products', { headers: H, body: { name: '우산꽂이', code: 'UMB', features: ['자석 부착'] } })).json;
    const up = await req(t.port, 'POST', `/api/products/${p.id}/images`, { headers: { 'x-rf-studio': '1', 'x-filename': 'a.png', 'content-type': 'image/png' }, raw: png(3) });
    assert.equal(up.status, 200);
    const iid = up.json.images[0].id;
    assert.equal((await req(t.port, 'GET', `/media/product/${p.id}/${iid}`)).status, 200);
    await req(t.port, 'POST', `/api/products/${p.id}/images/${iid}/status`, { headers: H, body: { status: 'approved' } });
    assert.equal((await req(t.port, 'POST', `/api/products/${p.id}/references/approve`, { headers: H, body: {} })).json.reference.state, 'approved');
    const lab = (await req(t.port, 'POST', `/api/storylab/${p.id}/generate`, { headers: H, body: { category: 'all' } })).json;
    assert.ok(lab.concepts.length >= 3);
    const cid = lab.concepts[0].id;
    assert.equal((await req(t.port, 'POST', `/api/storylab/${p.id}/concepts/${cid}/episode`, { headers: H, body: {} })).status, 409, 'unapproved concept cannot start an episode');
    await req(t.port, 'POST', `/api/storylab/${p.id}/concepts/${cid}/approve`, { headers: H, body: {} });
    const ep = (await req(t.port, 'POST', `/api/storylab/${p.id}/concepts/${cid}/episode`, { headers: H, body: {} })).json;
    assert.equal(ep.derived.concept.approved, true);
    const g = await req(t.port, 'POST', `/api/episodes/${ep.id}/script/generate`, { headers: H, body: {} });
    assert.equal(g.status, 200); assert.equal(g.json.scriptSource.mock, true);
    // prompt manager over HTTP
    const sv = await req(t.port, 'PUT', '/api/prompts/script', { headers: H, body: { text: 'Custom script prompt text for {{CHANNEL}} with enough length {{EXTRA}}', note: 'n' } });
    assert.equal(sv.json.current, 2);
    assert.equal((await req(t.port, 'POST', '/api/prompts/script/restore', { headers: H, body: { toDefault: true } })).json.current, 3);
    // live without confirmation is refused over HTTP
    await req(t.port, 'PUT', '/api/ai/keys/muapi', { headers: H, body: { key: 'muapi-another-key-123456' } });
    assert.equal((await req(t.port, 'PUT', '/api/ai/mode/muapi', { headers: H, body: { mode: 'live' } })).status, 409);
  } finally { await t.close(); }
});
