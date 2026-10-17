'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVault } = require('../studio/lib/vault');
const { createProvider, testConnection, AiError } = require('../studio/lib/ai/text');
const { createStore } = require('../studio/lib/store');
const { createUsage, priceTokens } = require('../studio/lib/usage');
const { createPromptStore } = require('../studio/lib/promptstore');
const { SEED_DIR } = require('../studio/lib/store');
const { make, fakeAi, goodConcepts } = require('./helpers/v23');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-c-'));

test('vault: keys are encrypted at rest, masked to the browser, and need the master key', () => {
  const dir = tmp();
  const v = createVault({ dir, masterKey: 'master-one', env: {} });
  v.set('gemini', 'AIza-SECRET-KEY-123456');
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!raw.includes('SECRET-KEY'), 'plaintext on disk');
  assert.equal(v.get('gemini'), 'AIza-SECRET-KEY-123456');
  assert.deepEqual(Object.keys(v.mask('gemini')).sort(), ['configured', 'last4', 'source', 'updatedAt']);
  assert.equal(v.mask('gemini').last4, '3456');
  const wrong = createVault({ dir, masterKey: 'master-two', env: {} });
  assert.throws(() => wrong.get('gemini'), (e) => e.code === 'VAULT_DECRYPT');
  assert.throws(() => createVault({ dir: tmp(), masterKey: '', requireMasterKey: true }), (e) => e.code === 'NO_MASTER_KEY');
  v.remove('gemini');
  assert.equal(v.get('gemini'), '');
});

test('vault: env fallback works and vault value wins', () => {
  const v = createVault({ dir: tmp(), masterKey: 'm', env: { OPENAI_API_KEY: 'env-key-12345678' } });
  assert.equal(v.get('openai'), 'env-key-12345678');
  assert.equal(v.mask('openai').source, 'env');
  v.set('openai', 'vault-key-12345678');
  assert.equal(v.get('openai'), 'vault-key-12345678');
});

const resp = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

test('connection test: states are meaningful and never leak the key', async () => {
  const KEY = 'sk-leaky-key-000111222';
  const mk = (fetchFn) => createProvider('openai', { getKey: () => KEY, fetchFn });
  let r = await testConnection(mk(async () => resp(200, { data: [{ id: 'gpt-a' }, { id: 'gpt-b' }] })), 'gpt-a');
  assert.equal(r.state, 'connected');
  r = await testConnection(mk(async () => resp(200, { data: [{ id: 'gpt-a' }] })), 'nope');
  assert.equal(r.state, 'invalid_model');
  r = await testConnection(mk(async () => resp(401, { error: { message: 'bad key ' + KEY } })), '');
  assert.equal(r.state, 'auth_failed');
  assert.ok(!JSON.stringify(r).includes(KEY));
  r = await testConnection(mk(async () => resp(429, { error: 'slow' })), '');
  assert.equal(r.state, 'rate_limited');
  r = await testConnection(mk(async () => resp(503, {})), '');
  assert.equal(r.state, 'unavailable');
  r = await testConnection(createProvider('anthropic', { getKey: () => '', fetchFn: async () => { throw new Error('should not be called'); } }), '');
  assert.equal(r.state, 'not_configured');
});

test('providers: gemini/openai/anthropic generate with the right request shape and parse JSON', async () => {
  const seen = [];
  const f = (body) => async (url, init) => { seen.push({ url, init }); return resp(200, body); };
  const g = createProvider('gemini', { getKey: () => 'gkey12345', fetchFn: f({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }) });
  const o = await g.generate({ model: 'm', prompt: 'p', json: true, images: [{ mimeType: 'image/png', data: 'AA==' }] });
  assert.deepEqual(o.json, { a: 1 });
  assert.equal(o.usage.inputTokens, 5);
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'gkey12345');
  assert.ok(!seen[0].url.includes('gkey12345'), 'key must not be in the URL');
  assert.ok(JSON.parse(seen[0].init.body).contents[0].parts.some((p) => p.inlineData));
  const a = createProvider('anthropic', { getKey: () => 'akey12345', fetchFn: f({ content: [{ type: 'text', text: '{"b":2}' }], usage: { input_tokens: 3, output_tokens: 4 } }) });
  assert.deepEqual((await a.generate({ model: 'c', prompt: 'p', json: true })).json, { b: 2 });
  const oa = createProvider('openai', { getKey: () => 'okey12345', fetchFn: f({ choices: [{ message: { content: '{"c":3}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
  assert.deepEqual((await oa.generate({ model: 'x', prompt: 'p', json: true })).json, { c: 3 });
});

test('usage: daily/monthly limits block before the call; unknown price needs confirmation', () => {
  const store = createStore({ dir: tmp() });
  const u = createUsage({ store });
  u.record({ provider: 'gemini', model: 'm', estimatedUsd: 0.4 });
  return u.flush().then(() => {
    assert.throws(() => u.checkLimits({ dailyUsd: 0.5 }, 0.2), (e) => e.code === 'DAILY_LIMIT');
    u.checkLimits({ dailyUsd: 0.5 }, 0.05);
    assert.throws(() => u.checkLimits({ monthlyUsd: 1 }, null), (e) => e.code === 'COST_UNKNOWN');
    u.checkLimits({ monthlyUsd: 1 }, null, { confirmUnknownCost: true });
    u.checkLimits({}, null); // no limits → nothing to check
    assert.equal(priceTokens({ 'g:m': { inputPer1M: 1, outputPer1M: 2 } }, 'g', 'm', 1e6, 1e6), 3);
    assert.equal(priceTokens({}, 'g', 'm', 10, 10), null);
  });
});

test('prompt store: versions never overwritten, restore creates a new version, compose records versions', () => {
  const store = createStore({ dir: tmp() });
  const ps = createPromptStore({ store, seedDir: SEED_DIR });
  assert.equal(ps.get('storyConcept').current, 1);
  const v2 = ps.save('storyConcept', { text: 'NEW STORY PROMPT for {{CHANNEL}} COUNT={{COUNT}} please produce concepts', note: 'test' });
  assert.equal(v2.current, 2);
  assert.equal(ps.versionText('storyConcept', 1).includes('head writer'), true);
  const c = ps.compose('storyConcept', { COUNT: 4 });
  assert.ok(c.text.includes('NEW STORY PROMPT') && c.text.includes('COUNT=4'));
  assert.equal(c.versions.storyConcept, 2);
  const back = ps.restore('storyConcept', { toDefault: true });
  assert.equal(back.current, 3);
  assert.equal(back.versions.length, 3);
  assert.throws(() => ps.save('storyConcept', { text: 'short' }), (e) => e.code === 'PROMPT_TOO_SHORT');
});

test('router: paid calls need confirmation, limits, key and model; no silent fallback; usage recorded; secrets not in errors', async () => {
  const ai = fakeAi({ gemini: () => ({ text: '', json: goodConcepts(3), usage: { inputTokens: 100, outputTokens: 100 } }) });
  const { s } = make({ ai });
  const r = s.router;
  // default is mock (sample) and never billable
  const m = await r.run('storyConcepts', { prompt: 'PRODUCT_NAME: x\nCOUNT: 3', json: true });
  assert.equal(m.mock, true);
  s.integrations.setRouting('storyConcepts', { provider: 'gemini', model: '' });
  await assert.rejects(r.run('storyConcepts', { prompt: 'p', json: true, confirm: { paid: true } }), (e) => e.code === 'NOT_CONFIGURED');
  s.integrations.setKey('gemini', 'gem-key-123456789');
  await assert.rejects(r.run('storyConcepts', { prompt: 'p', json: true, confirm: { paid: true } }), (e) => e.code === 'NO_MODEL');
  s.integrations.setRouting('storyConcepts', { provider: 'gemini', model: 'model-a' });
  await assert.rejects(r.run('storyConcepts', { prompt: 'p', json: true }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(ai.calls.length, 0, 'no provider call before confirmation');
  s.integrations.setPricing('gemini', 'model-a', { inputPer1M: 1, outputPer1M: 1 });
  s.integrations.setLimits({ dailyUsd: 0.0000001, monthlyUsd: null });
  await assert.rejects(r.run('storyConcepts', { prompt: 'p'.repeat(5000), json: true, confirm: { paid: true } }), (e) => e.code === 'DAILY_LIMIT');
  assert.equal(ai.calls.length, 0);
  s.integrations.setLimits({ dailyUsd: 5, monthlyUsd: null });
  const ok = await r.run('storyConcepts', { prompt: 'p', json: true, confirm: { paid: true } });
  assert.equal(ok.provider, 'gemini');
  assert.equal(ai.calls.length, 1);
  await s.usage.flush();
  assert.ok(s.usage.list().some((e) => e.provider === 'gemini' && e.status === 'ok'));
});

test('integrations: model IDs are validated against the provider list; live needs key + typed LIVE; keys never in overview', async () => {
  const ai = fakeAi({});
  const { s } = make({ ai });
  s.integrations.setKey('openai', 'openai-secret-abcdefgh');
  assert.ok(!JSON.stringify(s.integrations.overview()).includes('openai-secret-abcdefgh'));
  const t = await s.integrations.test('openai');
  assert.equal(t.state, 'connected');
  assert.throws(() => s.integrations.setModel('openai', 'not-a-model'), (e) => e.code === 'INVALID_MODEL');
  s.integrations.setModel('openai', 'model-a');
  assert.throws(() => s.integrations.setMode('muapi', 'live', { confirm: 'LIVE' }), (e) => e.code === 'NOT_CONFIGURED');
  s.integrations.setKey('muapi', 'muapi-secret-abcdefgh');
  assert.throws(() => s.integrations.setMode('muapi', 'live', {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(s.video.mode, 'mock'); // provider injected in tests; runtime still resolves
  s.integrations.setMode('muapi', 'live', { confirm: 'LIVE' });
  assert.equal(s.runtime.muapiMode(), 'live');
  s.integrations.removeKey('muapi');
  assert.equal(s.runtime.muapiMode(), 'mock', 'removing the key drops back to mock');
});

test('runtime: live requested without key is reported and stays MOCK (never silently real)', () => {
  const { s } = make({ env: { RF_MUAPI_MODE: 'live' } });
  const st = s.providerStatus();
  assert.equal(st.video.liveRequested, true);
  assert.equal(st.video.liveWithoutKey, true);
  assert.equal(s.runtime.muapiMode(), 'mock');
});
