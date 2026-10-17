// Muapi adapter tests with a mocked fetch. NOTHING here touches the network or any real key.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMuapiProvider, parseCost, ProviderError } = require('../studio/lib/providers/muapi');

const KEY = 'sk-test-SECRET-1234567890';
const hdr = (o = {}) => ({ get: (k) => o[k] ?? o[k.toLowerCase()] ?? null });
const res = (status, body, headers) => ({ ok: status >= 200 && status < 300, status, headers: hdr(headers), json: async () => body, arrayBuffer: async () => Buffer.from(body || '') });
const model = { endpoint: 'kling-master' };
const mk = (fetchFn, extra = {}) => createMuapiProvider({ apiKey: KEY, fetchFn, sleepFn: async () => {}, pollIntervalMs: 0, ...extra });

test('submit: documented endpoint, x-api-key header, 9:16 image-to-video body, cost parsed', async () => {
  const calls = [];
  const p = mk(async (url, init) => { calls.push({ url, init }); return res(200, { request_id: 'r1', status: 'queued', cost: { amount_usd: 0.5, amount_credits: 50, refunded: false } }); });
  const r = await p.submit({ model, prompt: 'hi', imageUrl: 'https://x/y.png', duration: 5, negativePrompt: 'bad' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.muapi.ai/api/v1/kling-master');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], KEY);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { prompt: 'hi', image_url: 'https://x/y.png', aspect_ratio: '9:16', duration: 5, negative_prompt: 'bad' });
  assert.equal(r.requestId, 'r1');
  assert.equal(r.cost.amountUsd, 0.5);
});

test('submit retries ONLY on HTTP 429', async () => {
  let n = 0;
  const p = mk(async () => (++n < 3 ? res(429, { detail: 'slow down' }, { 'Retry-After': '1' }) : res(200, { request_id: 'ok', status: 'queued' })));
  assert.equal((await p.submit({ model, prompt: 'x', imageUrl: 'u', duration: 5 })).requestId, 'ok');
  assert.equal(n, 3);
  let m = 0;
  const q = mk(async () => { m++; return res(429, {}); }, { maxSubmitAttempts: 2 });
  await assert.rejects(q.submit({ model, prompt: 'x', imageUrl: 'u' }), (e) => e.code === 'RATE_LIMIT');
  assert.equal(m, 2);
});

test('submit never re-sends after a 5xx, network error or timeout (a paid job may exist)', async () => {
  for (const f of [async () => res(500, { error: 'boom' }), async () => { throw new Error('ECONNRESET'); }]) {
    let n = 0;
    const p = mk(async (...a) => { n++; return f(...a); });
    await assert.rejects(p.submit({ model, prompt: 'x', imageUrl: 'u' }), (e) => e instanceof ProviderError && e.uncertain === true);
    assert.equal(n, 1);
  }
  let n = 0;
  const p = mk(async (_u, init) => { n++; return new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))); }, { timeoutMs: 20 });
  await assert.rejects(p.submit({ model, prompt: 'x', imageUrl: 'u' }), (e) => e.code === 'TIMEOUT' && e.uncertain);
  assert.equal(n, 1);
});

test('401/402 are mapped without retry and the key never appears in errors', async () => {
  for (const status of [401, 402, 400]) {
    let n = 0;
    const p = mk(async () => { n++; return res(status, { detail: 'nope ' + KEY }); });
    const e = await p.submit({ model, prompt: 'x', imageUrl: 'u' }).catch((x) => x);
    assert.ok(e instanceof ProviderError);
    assert.equal(n, 1);
    assert.ok(!e.message.includes(KEY), 'key leaked into error: ' + e.message);
  }
});

test('missing key fails before any request', async () => {
  let n = 0;
  const p = createMuapiProvider({ apiKey: '', fetchFn: async () => { n++; } });
  await assert.rejects(p.submit({ model, prompt: 'x', imageUrl: 'u' }), (e) => e.code === 'AUTH');
  assert.equal(n, 0);
});

test('poll: documented path, status mapping, outputs', async () => {
  const urls = [];
  const seq = [{ status: 'processing' }, { status: 'queued' }, { status: 'completed', outputs: ['https://cdn/x.mp4'], cost: { amount_usd: 0.4 } }];
  const p = mk(async (u) => { urls.push(u); return res(200, seq.shift()); });
  const r = await p.waitForResult('abc');
  assert.equal(urls[0], 'https://api.muapi.ai/api/v1/predictions/abc/result');
  assert.deepEqual(r.outputs, ['https://cdn/x.mp4']);
  assert.equal(urls.length, 3);
});

test('poll: failed and empty-output completions are errors; transient poll errors are retried', async () => {
  await assert.rejects(mk(async () => res(200, { status: 'failed', error: 'bad image' })).waitForResult('a'), (e) => e.code === 'FAILED' && /bad image/.test(e.message));
  await assert.rejects(mk(async () => res(200, { status: 'completed', outputs: [] })).waitForResult('a'), (e) => e.code === 'NO_OUTPUT');
  let n = 0;
  const p = mk(async () => (++n < 3 ? res(503, {}) : res(200, { status: 'completed', outputs: ['u'] })));
  assert.equal((await p.waitForResult('a')).status, 'completed');
  let m = 0;
  await assert.rejects(mk(async () => { m++; return res(502, {}); }, { maxPollErrors: 2 }).waitForResult('a'), (e) => e.uncertain === true && /a/.test(e.message));
  assert.equal(m, 3);
});

test('poll timeout leaves the job resumable', async () => {
  const p = mk(async () => res(200, { status: 'processing' }), { pollTimeoutMs: 5, pollIntervalMs: 2, sleepFn: (ms) => new Promise((r) => setTimeout(r, ms)) });
  await assert.rejects(p.waitForResult('zzz'), (e) => e.code === 'TIMEOUT' && /zzz/.test(e.message));
});

test('download writes atomically and rejects tiny files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-'));
  const big = Buffer.alloc(4096, 1);
  const p = mk(async () => ({ ok: true, status: 200, arrayBuffer: async () => big }));
  await p.download('https://cdn/x.mp4', path.join(dir, 'a.mp4'));
  assert.equal(fs.statSync(path.join(dir, 'a.mp4')).size, 4096);
  const q = mk(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') }));
  await assert.rejects(q.download('https://cdn/x.mp4', path.join(dir, 'b.mp4')), (e) => e.code === 'NO_OUTPUT');
  assert.ok(!fs.existsSync(path.join(dir, 'b.mp4')));
});

test('parseCost reads body or headers and tolerates absence', () => {
  assert.equal(parseCost({}, hdr()), null);
  assert.equal(parseCost({}, hdr({ 'X-MuAPI-Cost-USD': '0.25' })).amountUsd, 0.25);
  assert.equal(parseCost({ cost: { amount_usd: 1, amount_credits: 2, bonus_credits_used: 0, refunded: true } }).refunded, true);
});

test('upload enforces the 10 MB image limit before sending', async () => {
  let n = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-'));
  const f = path.join(dir, 'big.png');
  fs.writeFileSync(f, Buffer.alloc(10 * 1024 * 1024 + 1));
  const p = mk(async () => { n++; return res(200, { url: 'u' }); });
  await assert.rejects(p.uploadImage(f), (e) => e.code === 'BAD_REQUEST');
  assert.equal(n, 0);
});

test('Seedance image-to-video sends images_list even for stale saved image_url model settings', async () => {
  const calls = [];
  const p = mk(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return res(200, { request_id: 'seedance-job', status: 'queued' }); });
  const selected = { endpoint: 'seedance-2-image-to-video', imageField: 'image_url', imageAsList: false };
  const result = await p.submit({ model: selected, prompt: 'silent movement', imageUrl: 'https://cdn.example/approved.png', duration: 5 });
  assert.equal(result.requestId, 'seedance-job');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.images_list, ['https://cdn.example/approved.png']);
  assert.equal(Object.hasOwn(calls[0].body, 'image_url'), false);
});

test('MuAPI catalog preserves string image_url for Kling endpoints', async () => {
  let sent;
  const p = mk(async (_url, init) => { sent = JSON.parse(init.body); return res(200, { request_id: 'kling-job' }); });
  await p.submit({ model: { endpoint: 'kling-v2.1-master-i2v', imageAsList: true, imageField: 'images_list' }, prompt: 'motion', imageUrl: 'https://cdn.example/frame.png', duration: 5 });
  assert.equal(sent.image_url, 'https://cdn.example/frame.png');
  assert.equal(Object.hasOwn(sent, 'images_list'), false);
});

test('MuAPI rejects missing approved starting image before any paid submit', async () => {
  let calls = 0;
  const p = mk(async () => { calls++; return res(200, { request_id: 'unexpected' }); });
  await assert.rejects(p.submit({ model: { endpoint: 'seedance-2-image-to-video' }, prompt: 'test', imageUrl: '' }), /starting image URL/);
  assert.equal(calls, 0);
});

test('Grok image-to-video uses required images_list despite stale image_url saved model settings', async () => {
  let payload;
  const provider = mk(async (_url, init) => {
    payload = JSON.parse(init.body);
    return res(200, { request_id: 'grok-job-1', status: 'queued' });
  });
  const result = await provider.submit({
    model: { endpoint: 'grok-imagine-image-to-video', imageField: 'image_url', imageAsList: false },
    prompt: 'Animate Jack without dialogue',
    imageUrl: 'https://cdn.example/approved-jack.png',
    duration: 5,
  });
  assert.equal(result.requestId, 'grok-job-1');
  assert.deepEqual(payload.images_list, ['https://cdn.example/approved-jack.png']);
  assert.equal(Object.hasOwn(payload, 'image_url'), false);
});
