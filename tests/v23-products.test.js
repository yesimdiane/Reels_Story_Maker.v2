'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractProduct, parseProductHtml, parseRobots, isPrivateIp, parseUrl, detectBlock, downloadImage } = require('../studio/lib/extract');
const { make, fakeAi, png, readyProduct } = require('./helpers/v23');

const html = (extra = '') => `<html><head><title>x</title><meta property="og:title" content="자석 우산꽂이"><meta property="og:image" content="/img/1.png"><meta name="description" content="현관용"><script type="application/ld+json">{"@type":"Product","name":"자석 우산꽂이","brand":{"name":"리템"},"color":"그레이","image":["https://cdn.example/a.jpg"],"offers":{"price":"9900"}}</script>${extra}</head><body>ok</body></html>`;
const R = (status, body, headers = {}) => ({ status, headers, body: Buffer.from(body), finalUrl: 'https://shop.example/p/1' });

test('SSRF guard: private/loopback/metadata addresses and odd ports/credentials are refused', () => {
  ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1'].forEach((ip) => assert.equal(isPrivateIp(ip), true, ip));
  ['8.8.8.8', '1.1.1.1', '2606:4700::1111'].forEach((ip) => assert.equal(isPrivateIp(ip), false, ip));
  ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest', 'http://[::1]/', 'ftp://x.com', 'https://u:p@x.com/', 'https://x.com:8443/', 'file:///etc/passwd', 'not a url'].forEach((u) => assert.throws(() => parseUrl(u), (e) => /BAD_URL|BLOCKED_HOST/.test(e.code), u));
  parseUrl('https://www.coupang.com/vp/products/1');
});

test('robots.txt: honoured; 5xx means do not fetch; 404 means allowed', async () => {
  const allow = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok');
  assert.equal(allow('/private/x'), false);
  assert.equal(allow('/private/ok'), true);
  assert.equal(allow('/public'), true);
  const calls = [];
  const mk = (robots, page) => async (u) => { calls.push(u); return /robots\.txt$/.test(u) ? robots : page; };
  let r = await extractProduct('https://shop.example/p/1', { fetcher: mk(R(200, 'User-agent: *\nDisallow: /p/'), R(200, html())) });
  assert.equal(r.status, 'blocked'); assert.equal(r.reason, 'robots');
  assert.ok(!calls.some((u) => /\/p\/1$/.test(u)), 'page must not be fetched when robots disallows');
  r = await extractProduct('https://shop.example/p/1', { fetcher: mk(R(503, ''), R(200, html())) });
  assert.equal(r.status, 'blocked');
  r = await extractProduct('https://shop.example/p/1', { fetcher: mk(R(404, ''), R(200, html())) });
  assert.equal(r.status, 'ok');
});

test('extraction: title/images/specs only from the page; price is NOT extracted; blocks/captcha fall back to manual', async () => {
  const d = parseProductHtml(html(), 'https://shop.example/p/1');
  assert.equal(d.title, '자석 우산꽂이');
  assert.ok(d.images.includes('https://shop.example/img/1.png') && d.images.includes('https://cdn.example/a.jpg'));
  assert.ok(d.specs.includes('브랜드: 리템') && d.specs.includes('색상: 그레이'));
  assert.ok(!JSON.stringify(d).includes('9900'), 'price must never be extracted');
  const fetcher = (res) => async (u) => (/robots\.txt$/.test(u) ? R(404, '') : res);
  for (const res of [R(403, 'Access Denied'), R(429, ''), R(200, '<html>Please verify you are human (captcha)</html>'), R(200, '<html><body></body></html>')]) {
    const r = await extractProduct('https://shop.example/p/1', { fetcher: fetcher(res) });
    assert.equal(r.status, 'blocked', res.status + res.body);
    assert.match(r.note, /직접 입력/);
  }
  assert.equal(detectBlock(R(200, html())), '');
  const failed = await extractProduct('https://shop.example/p/1', { fetcher: async (u) => { if (/robots/.test(u)) return R(404, ''); throw Object.assign(new Error('boom'), { code: 'FETCH_FAILED' }); } });
  assert.equal(failed.status, 'failed');
  await assert.rejects(downloadImage('https://x.example/a.png', { fetcher: async () => R(200, 'not an image') }), (e) => e.code === 'BAD_TYPE');
});

test('product flow: URL blocked → manual entry works; extraction adds UNVERIFIED specs and retrieved images', async () => {
  const blocked = make({ extractFn: async () => ({ status: 'blocked', reason: 'http-403', note: '차단 — 직접 입력', data: null, sourceUrl: 'https://www.coupang.com/x' }) });
  let p = await blocked.s.products.create({ name: '직접 입력 제품', url: 'https://www.coupang.com/vp/products/1', features: ['사용자가 확인한 기능'] });
  p = await blocked.s.products.extract(p.id);
  assert.equal(p.extraction.status, 'blocked');
  assert.deepEqual(p.verifiedFacts, ['사용자가 확인한 기능']);
  const ok = make({ extractFn: async () => ({ status: 'ok', reason: '', note: 'ok', sourceUrl: 'https://s.example/p', data: { title: '추출 제목', description: 'd', images: ['https://s.example/1.png'], specs: ['색상: 그레이'] } }), downloadFn: async () => ({ buffer: png(5), mime: 'image/png', ext: '.png' }) });
  let q = await ok.s.products.create({ url: 'https://s.example/p' });
  q = await ok.s.products.extract(q.id);
  assert.equal(q.name, '추출 제목');
  assert.equal(q.specs[0].verified, false);
  assert.deepEqual(q.verifiedFacts, [], 'extracted specs are not usable until confirmed');
  assert.equal(q.images[0].kind, 'retrieved');
  assert.match(q.images[0].licenseNote, /권한/);
  assert.equal(q.readiness.ok, false);
  const e = await ok.s.products.edit(q.id, { specs: [{ text: '색상: 그레이', verified: true }] });
  assert.deepEqual(e.verifiedFacts, ['색상: 그레이']);
});

test('reference images: max 10 uploads, approval, replace, set approval bound to hashes, stale detection', async () => {
  const { s } = make();
  const p = await s.products.create({ name: 'x', features: ['f'] });
  for (let i = 0; i < 10; i++) await s.products.upload(p.id, png(10 + i), `i${i}.png`);
  await assert.rejects(s.products.upload(p.id, png(99), 'six.png'), (e) => e.code === 'UPLOAD_LIMIT');
  await assert.rejects(s.products.upload(p.id, png(10), 'dup.png'), (e) => e.code === 'DUPLICATE' || e.code === 'UPLOAD_LIMIT');
  await assert.rejects(s.products.upload(p.id, Buffer.from('hello world not image'), 'x.png'), (e) => e.code === 'UPLOAD_LIMIT' || e.code === 'BAD_TYPE');
  let v = s.products.get(p.id);
  assert.equal(v.counts.uploaded, 10);
  await assert.rejects(s.products.approveReferenceSet(p.id, {}), (e) => e.code === 'NO_IMAGES');
  await s.products.setStatus(p.id, v.images[0].id, 'approved');
  await s.products.setStatus(p.id, v.images[1].id, 'approved');
  v = await s.products.approveReferenceSet(p.id, {});
  assert.equal(v.reference.state, 'approved');
  assert.equal(v.readiness.ok, true);
  assert.equal(v.reference.imageIds.length, 2);
  // replacing an approved image invalidates the set
  await assert.rejects(s.products.replace(p.id, v.images[0].id, png(200), 'new.png'), (e) => e.code === 'CONFIRM_APPROVED', 'approved images are not replaced without confirmation');
  v = await s.products.replace(p.id, v.images[0].id, png(200), 'new.png', { confirm: true });
  assert.equal(v.reference.state, 'stale');
  assert.equal(v.readiness.ok, false);
  assert.equal(v.counts.uploaded, 10, 'replace keeps the upload limit');
  const old = v.images.find((i) => i.status === 'replaced');
  assert.ok(old && old.replacedBy);
  await assert.rejects(s.products.approveReferenceSet(p.id, { imageIds: [v.images[2].id] }), (e) => e.code === 'NOT_APPROVED');
  await s.products.setStatus(p.id, old.replacedBy, 'approved');
  v = await s.products.approveReferenceSet(p.id, {});
  assert.equal(v.reference.state, 'approved');
  await s.products.setStatus(p.id, v.reference.imageIds[0], 'rejected');
  assert.equal(s.products.get(p.id).reference.state, 'stale');
});

test('AI product images: labelled AI-generated, derived from an approved original, paid + confirmed only', async () => {
  const ai = fakeAi({});
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  const v = s.products.get(pid);
  await assert.rejects(s.products.generateImage(pid, { basedOn: [v.images[0].id], confirm: { paid: true } }), (e) => e.code === 'NOT_CONFIGURED');
  s.integrations.setKey('gemini', 'gem-key-123456789');
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' });
  await assert.rejects(s.products.generateImage(pid, { basedOn: [v.images[0].id] }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(ai.calls.length, 0);
  await assert.rejects(s.products.generateImage(pid, { basedOn: [], confirm: { paid: true, unknownCost: true } }), (e) => e.code === 'NO_SOURCE');
  const out = await s.products.generateImage(pid, { basedOn: [v.images[0].id], prompt: '밝은 배경', confirm: { paid: true, unknownCost: true } });
  const gen = out.images.find((i) => i.kind === 'ai_generated');
  assert.ok(gen);
  assert.equal(gen.status, 'pending');
  assert.deepEqual(gen.derivedFrom, [v.images[0].id]);
  assert.match(gen.disclosure, /제조사 사진이 아닙니다/);
  assert.match(ai.calls[0].prompt, /Do NOT change the product shape/);
  assert.ok(ai.calls[0].images.length === 1);
});
