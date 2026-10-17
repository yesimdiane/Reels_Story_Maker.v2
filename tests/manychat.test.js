'use strict';
// ManyChat integration: token never leaks, connection test with retries/auth/unavailable, honest capabilities,
// campaign persistence, conflict prevention, and "active" only with recorded verification evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { make } = require('./helpers/v23');
const { createManychat, CAPABILITIES } = require('../studio/lib/manychat');

const TOKEN = 'mc_SECRET_TOKEN_1234567890';
const LINK = 'https://link.coupang.com/a/abc123';
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function setup(fetchFn) {
  const { s } = make();
  const calls = [];
  const wrapped = async (url, opts) => { calls.push({ url, opts }); return fetchFn(url, opts, calls.length); };
  const mc = createManychat({ store: s.store, vault: s.vault, fetchFn: wrapped, sleep: async () => {}, retries: 2 });
  return { s, mc, calls };
}
const approveFinal = (s, id = 'EP01') => s.store.episodes.update(id, (ep) => { ep.approvals.final = { v: 1, sha256: 'x' }; });
const draft = { instagramAccount: '@jackanddiane', postUrl: 'https://www.instagram.com/reel/AAA/', keywords: ['우산', '우산꽂이링크'], dmMessage: '[광고] 링크 보내드려요 ' + LINK, affiliateUrl: LINK, buttonLabel: '링크 받기' };

test('capabilities are honest: no automation creation, attach, activate/pause, status or metrics via API', () => {
  for (const k of ['createAutomation', 'attachToPost', 'activatePause', 'readAutomationStatus', 'readMetrics']) assert.equal(CAPABILITIES[k].supported, false, k);
  assert.equal(CAPABILITIES.testConnection.supported, true);
});

test('token: stored encrypted, masked everywhere, never in responses, files or errors', async () => {
  const { s, mc } = setup(async () => json(401, {}));
  assert.equal(mc.connection().state, 'not_configured');
  const r = mc.setToken(TOKEN);
  assert.equal(r.configured, true); assert.equal(r.state, 'untested'); assert.equal(r.last4, TOKEN.slice(-4));
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  const dir = s.store.dir;
  for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p, 'utf8').includes(TOKEN), 'plaintext token found in ' + f); }
  const t = await mc.test();
  assert.ok(!JSON.stringify(t).includes(TOKEN));
  const d = mc.disconnect();
  assert.equal(d.configured, false); assert.match(d.note, /재발급|새 토큰/);
  await assert.rejects(() => mc.test(), (e) => e.code === 'NO_TOKEN');
});

test('connection test: success reads page info; sends Bearer token; only GET getInfo', async () => {
  const { mc, calls } = setup(async () => json(200, { status: 'success', data: { id: 123, name: 'Jack & Diane', username: 'jackanddiane', timezone: 'Asia/Seoul' } }));
  mc.setToken(TOKEN);
  const r = await mc.test();
  assert.equal(r.state, 'connected'); assert.equal(r.page.name, 'Jack & Diane'); assert.ok(r.testedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.manychat.com/fb/page/getInfo');
  assert.equal(calls[0].opts.method, 'GET'); assert.equal(calls[0].opts.headers.Authorization, 'Bearer ' + TOKEN);
});

test('connection test: 401 → auth_failed without retry; 5xx/429/network → retried then reported; recovery works', async () => {
  let a = setup(async () => json(401, {}));
  a.mc.setToken(TOKEN);
  assert.equal((await a.mc.test()).state, 'auth_failed'); assert.equal(a.calls.length, 1, 'auth errors are not retried');
  a = setup(async () => json(503, {}));
  a.mc.setToken(TOKEN);
  assert.equal((await a.mc.test()).state, 'unavailable'); assert.equal(a.calls.length, 3, '1 try + 2 retries');
  a = setup(async () => json(429, {}));
  a.mc.setToken(TOKEN);
  assert.equal((await a.mc.test()).state, 'rate_limited');
  a = setup(async (u, o, n) => { if (n < 3) throw new Error('boom ' + TOKEN); return json(200, { status: 'success', data: { id: 1, name: 'P' } }); });
  a.mc.setToken(TOKEN);
  const ok = await a.mc.test();
  assert.equal(ok.state, 'connected'); assert.equal(a.calls.length, 3);
  a = setup(async () => { throw new Error('network ' + TOKEN); });
  a.mc.setToken(TOKEN);
  const bad = await a.mc.test();
  assert.equal(bad.state, 'unavailable'); assert.ok(!JSON.stringify(bad).includes(TOKEN), 'token scrubbed from error text');
});

test('campaign persistence: draft prefilled from Episode/Product link; saved draft survives reload; rejects bad post URL', async () => {
  const { s, mc } = setup(async () => json(200, {}));
  await s.store.episodes.update('EP01', (ep) => { ep.publishing = Object.assign({}, ep.publishing, { affiliateUrl: LINK, keyword: '우산' }); });
  const f = mc.forEpisode('EP01');
  assert.equal(f.campaign, null); assert.equal(f.suggestion.affiliateUrl, LINK); assert.deepEqual(f.suggestion.keywords, ['우산']);
  await assert.rejects(() => mc.save('EP01', { postUrl: 'https://evil.example/x' }), (e) => e.code === 'POST_URL');
  const c = await mc.save('EP01', draft);
  assert.equal(c.status, 'draft'); assert.equal(c.instagramAccount, 'jackanddiane');
  const again = createManychat({ store: s.store, vault: s.vault }).forEpisode('EP01');
  assert.equal(again.campaign.id, c.id); assert.deepEqual(again.campaign.keywords, ['우산', '우산꽂이링크']);
  await mc.save('EP01', { dmMessage: '[광고] 수정 ' + LINK });
  assert.equal(mc.list().length, 1, 'one campaign per episode (no duplicates)');
});

test('conflicting keywords on the same Instagram account are blocked; different account is fine', async () => {
  const { s, mc } = setup(async () => json(200, {}));
  await mc.save('EP01', draft);
  const ep2 = JSON.parse(JSON.stringify(s.store.episodes.get('EP01'))); ep2.id = 'EP02'; ep2.displayId = 'EP02';
  s.store.episodes.create ? await s.store.episodes.create(ep2) : fs.writeFileSync(s.store.path('episodes/EP02.json'), JSON.stringify(ep2));
  await assert.rejects(() => mc.save('EP02', Object.assign({}, draft, { keywords: ['우산꽂이'] })), (e) => e.code === 'KEYWORD_CONFLICT', 'substring overlap');
  await assert.rejects(() => mc.save('EP02', Object.assign({}, draft, { keywords: ['우산'] })), (e) => e.code === 'KEYWORD_CONFLICT', 'identical');
  const ok = await mc.save('EP02', Object.assign({}, draft, { instagramAccount: 'other', keywords: ['우산'] }));
  assert.equal(ok.status, 'draft');
});

test('workflow gates: prepare needs approved final video + complete data; active only after configured + post linked + evidence', async () => {
  const { s, mc } = setup(async () => json(200, {}));
  await assert.rejects(() => mc.prepare('EP01'), (e) => e.code === 'NO_CAMPAIGN');
  await mc.save('EP01', draft);
  await assert.rejects(() => mc.prepare('EP01'), (e) => e.code === 'FINAL_NOT_APPROVED');
  await approveFinal(s);
  await mc.save('EP01', { dmMessage: '링크 보내드려요 ' + LINK });
  await assert.rejects(() => mc.prepare('EP01'), (e) => e.code === 'INVALID', 'missing [광고] disclosure');
  await mc.save('EP01', { dmMessage: '[광고] 링크 ' + LINK, affiliateUrl: 'https://example.com/x' });
  await assert.rejects(() => mc.prepare('EP01'), (e) => e.code === 'INVALID', 'non-Coupang link');
  await mc.save('EP01', { affiliateUrl: LINK });
  assert.equal((await mc.prepare('EP01')).status, 'setup_required');
  await assert.rejects(() => mc.verify('EP01', { confirm: true, note: 'x'.repeat(20) }), (e) => e.code === 'BAD_STATE', 'cannot skip configuration');
  await assert.rejects(() => mc.markConfigured('EP01', {}), (e) => e.code === 'CONFIRM');
  assert.equal((await mc.markConfigured('EP01', { confirm: true })).status, 'ready');
  assert.notEqual(mc.statusFor('EP01').status, 'active');
  await assert.rejects(() => mc.verify('EP01', { confirm: true, note: 'ok' }), (e) => e.code === 'EVIDENCE');
  await assert.rejects(() => mc.verify('EP01', { note: 'x'.repeat(20) }), (e) => e.code === 'CONFIRM');
  const a = await mc.verify('EP01', { confirm: true, note: '테스트 계정으로 우산 댓글 → DM 수신 확인' });
  assert.equal(a.status, 'active'); assert.equal(a.evidence.apiVerified, false); assert.equal(a.evidence.source, 'operator_test'); assert.ok(a.evidence.verifiedAt);
  assert.equal(mc.statusFor('EP01').metrics, null, 'no invented metrics');
});

test('post can be linked after the video is ready; ready requires the post link', async () => {
  const { s, mc } = setup(async () => json(200, {}));
  await approveFinal(s);
  await mc.save('EP01', Object.assign({}, draft, { postUrl: '' }));
  await mc.prepare('EP01');
  await assert.rejects(() => mc.markConfigured('EP01', { confirm: true }), (e) => e.code === 'POST_NOT_LINKED');
  await mc.save('EP01', { postUrl: 'https://www.instagram.com/reel/BBB/' });
  assert.equal((await mc.markConfigured('EP01', { confirm: true })).status, 'ready');
});

test('editing a live (ready/active) campaign needs explicit confirmation and drops back to re-verification', async () => {
  const { s, mc } = setup(async () => json(200, {}));
  await approveFinal(s);
  await mc.save('EP01', draft); await mc.prepare('EP01'); await mc.markConfigured('EP01', { confirm: true });
  await mc.verify('EP01', { confirm: true, note: '테스트 댓글 후 DM 수신 확인함' });
  await assert.rejects(() => mc.save('EP01', { dmMessage: '[광고] 새 문구 ' + LINK }), (e) => e.code === 'CONFIRM_LIVE');
  assert.equal(mc.statusFor('EP01').status, 'active', 'unchanged until confirmed');
  const c = await mc.save('EP01', { dmMessage: '[광고] 새 문구 ' + LINK, confirmLive: true });
  assert.equal(c.status, 'setup_required'); assert.equal(c.evidence, null);
  await assert.rejects(() => mc.reopen('EP01', {}), (e) => e.code === 'BAD_STATE');
});

test('failed state needs a reason, clears evidence, and can be re-prepared; reopen requires confirmation', async () => {
  const { s, mc } = setup(async () => json(200, {}));
  await approveFinal(s);
  await mc.save('EP01', draft); await mc.prepare('EP01'); await mc.markConfigured('EP01', { confirm: true });
  await assert.rejects(() => mc.fail('EP01', {}), (e) => e.code === 'REASON');
  const f = await mc.fail('EP01', { reason: 'DM이 오지 않음' });
  assert.equal(f.status, 'failed'); assert.equal(f.evidence, null);
  assert.equal((await mc.prepare('EP01')).status, 'setup_required');
  await mc.markConfigured('EP01', { confirm: true });
  await assert.rejects(() => mc.reopen('EP01', {}), (e) => e.code === 'CONFIRM_LIVE');
  assert.equal((await mc.reopen('EP01', { confirm: true })).status, 'setup_required');
});

test('guided setup export has no secrets, names the manual steps and the dashboard link', async () => {
  const { mc } = setup(async () => json(200, {}));
  mc.setToken(TOKEN);
  await mc.save('EP01', draft);
  const x = mc.exportConfig('EP01');
  assert.deepEqual(x.config.triggerKeywords, ['우산', '우산꽂이링크']);
  assert.equal(x.config.linkInMessage, LINK); assert.match(x.dashboardUrl, /manychat\.com/);
  assert.ok(x.steps.length >= 6);
  assert.ok(!JSON.stringify(x).includes(TOKEN));
});

test('this module can only read: no DM/subscriber/flow-sending call exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'studio', 'lib', 'manychat.js'), 'utf8');
  assert.ok(!/sendContent|sendFlow|setCustomField|addTag|subscriber/i.test(src.replace(/^\/\/.*$/gm, '')), 'no subscriber/sending endpoints are called');
  assert.ok(!/method:\s*'(POST|PUT|DELETE)'/.test(src));
});

test('Home dashboard exposes per-episode DM status (no invented metrics)', async () => {
  const { s } = make();
  const it = s.summary().home.items.find((i) => i.id === 'EP01');
  assert.equal(it.dm.status, 'none'); assert.equal(it.dm.metrics, null);
  await s.store.episodes.update('EP01', (ep) => { ep.approvals.final = { v: 1, sha256: 'x' }; });
  await s.manychat.save('EP01', draft);
  assert.equal(s.summary().home.items.find((i) => i.id === 'EP01').dm.status, 'draft');
});

test('HTTP: token is write-only (no response ever contains it); unsupported actions are not offered; routes persist campaigns', async () => {
  const http = require('node:http');
  const { createApp } = require('../studio/server');
  const { s } = make();
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', Origin: 'http://127.0.0.1:' + port, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() })); });
    r.on('error', reject); r.end(data);
  });
  try {
    const put = await call('PUT', '/api/manychat/token', { token: TOKEN });
    assert.equal(put.status, 200); assert.equal(put.json.configured, true);
    const all = [put.text, (await call('GET', '/api/manychat')).text, (await call('GET', '/api/state')).text, (await call('GET', '/api/ai')).text];
    all.forEach((t) => assert.ok(!t.includes(TOKEN), 'token leaked in a response'));
    assert.equal((await call('PUT', '/api/manychat/token', { token: 'short' })).status, 400, 'bad token rejected');
    const saved = await call('PUT', '/api/episodes/EP01/dm', draft);
    assert.equal(saved.status, 200); assert.equal(saved.json.status, 'draft');
    assert.equal((await call('GET', '/api/episodes/EP01/dm')).json.campaign.id, saved.json.id);
    assert.equal((await call('POST', '/api/episodes/EP01/dm/verify', { confirm: true, note: 'x'.repeat(20) })).status, 409, 'cannot jump to active');
    assert.equal((await call('POST', '/api/episodes/EP01/dm/activate', {})).status, 404, 'no activate/pause endpoint exists');
    const del = await call('DELETE', '/api/manychat/token');
    assert.equal(del.json.configured, false);
  } finally { app.close(); }
});
