'use strict';
// Product reference images: validation, duplicates, multiple, order/primary, removal, approved-image protection,
// persistence, and "an upload never triggers AI image generation".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { make } = require('./helpers/v23');
const { makePng, jpegStub, webpStub } = require('./helpers/images');
const { createProductService } = require('../studio/lib/products');
const { imageSize } = require('../studio/lib/extract');
const { createApp } = require('../studio/server');

const fresh = async () => { const { s } = make(); const p = await s.products.create({ name: '우산꽂이', features: ['자석'] }); return { s, p }; };

test('image sizes are read from PNG, JPEG and WebP headers', () => {
  assert.deepEqual(imageSize(makePng(321, 123)), { width: 321, height: 123 });
  assert.deepEqual(imageSize(jpegStub(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageSize(webpStub(800, 600)), { width: 800, height: 600 });
  assert.equal(imageSize(Buffer.from('not an image')), null);
});

test('validation: type, size and dimensions are enforced on the server', async () => {
  const { s, p } = await fresh();
  await assert.rejects(s.products.upload(p.id, Buffer.from('GIF89a....'), 'a.gif'), (e) => e.code === 'BAD_TYPE');
  await assert.rejects(s.products.upload(p.id, makePng(99, 400, 1), 's.png'), (e) => e.code === 'TOO_SMALL');
  await assert.rejects(s.products.upload(p.id, makePng(8001, 120, 2), 'w.png'), (e) => e.code === 'TOO_BIG_DIMS');
  await assert.rejects(s.products.upload(p.id, Buffer.concat([makePng(200, 200, 3), Buffer.alloc(10 * 1024 * 1024)]), 'big.png'), (e) => e.code === 'TOO_LARGE');
  await assert.rejects(s.products.upload(p.id, Buffer.alloc(0), 'e.png'), (e) => e.code === 'EMPTY_FILE');
  const ok = await s.products.upload(p.id, makePng(1170, 2532, 4), 'screenshot.png');
  assert.equal(ok.images[0].width, 1170); assert.equal(ok.images[0].height, 2532);
  await s.products.upload(p.id, jpegStub(500, 500), 'photo.jpg');
  await s.products.upload(p.id, webpStub(500, 500), 'photo.webp');
  assert.equal(s.products.get(p.id).counts.uploaded, 3);
});

test('multiple images and duplicates: the same pasted image twice is stored once', async () => {
  const { s, p } = await fresh();
  const a = makePng(300, 300, 10);
  await s.products.upload(p.id, a, 'paste-1.png', { source: 'paste' });
  await assert.rejects(s.products.upload(p.id, Buffer.from(a), 'paste-2.png', { source: 'paste' }), (e) => e.code === 'DUPLICATE' && e.status === 409);
  await s.products.upload(p.id, makePng(300, 300, 11), 'other.png', { source: 'drop' });
  const v = s.products.get(p.id);
  assert.equal(v.images.length, 2);
  assert.deepEqual(v.images.map((i) => i.source), ['paste', 'drop']);
  assert.equal(new Set(v.images.map((i) => i.sha256)).size, 2);
});

test('order and primary image: persisted, reflected in the product picture, survive replace/remove', async () => {
  const { s, p } = await fresh();
  for (let i = 0; i < 3; i++) await s.products.upload(p.id, makePng(200, 200, 20 + i), `i${i}.png`);
  const ids = s.products.get(p.id).images.map((i) => i.id);
  let v = await s.products.reorderImages(p.id, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(v.images.map((i) => i.id), [ids[2], ids[0], ids[1]]);
  v = await s.products.reorderImages(p.id, [ids[1], 'img_unknown', ids[1]]);
  assert.deepEqual(v.images.map((i) => i.id), [ids[1], ids[2], ids[0]], 'unknown/duplicate ids ignored, the rest keep their order');
  assert.equal(v.mainImage.id, ids[1], 'with no primary the first usable image is shown');
  v = await s.products.setPrimary(p.id, ids[0]);
  assert.equal(v.mainImage.id, ids[0]); assert.equal(v.images.find((i) => i.id === ids[0]).primary, true);
  assert.equal(s.products.list().find((x) => x.id === p.id).mainImage.id, ids[0], 'the Products list uses the primary image');
  v = await s.products.replace(p.id, ids[0], makePng(200, 200, 90), 'new.png');
  const nu = v.images.find((i) => i.replaces === ids[0]);
  assert.equal(v.primaryImageId, nu.id, 'primary follows a replaced image');
  await assert.rejects(s.products.setPrimary(p.id, 'img_missing'), (e) => e.code === 'NOT_FOUND');
});

test('approved reference images are never replaced or removed without confirmation; order/primary changes do not invalidate approval', async () => {
  const { s, p } = await fresh();
  await s.products.upload(p.id, makePng(200, 200, 31), 'a.png');
  await s.products.upload(p.id, makePng(200, 200, 32), 'b.png');
  let v = s.products.get(p.id);
  const [a, b] = v.images.map((i) => i.id);
  await s.products.setStatus(p.id, a, 'approved'); await s.products.setStatus(p.id, b, 'approved');
  v = await s.products.approveReferenceSet(p.id, {});
  assert.equal(v.reference.state, 'approved');
  v = await s.products.reorderImages(p.id, [b, a]); v = await s.products.setPrimary(p.id, b);
  assert.equal(v.reference.state, 'approved', 'order and primary are presentation only');
  await assert.rejects(s.products.replace(p.id, a, makePng(200, 200, 33), 'x.png'), (e) => e.code === 'CONFIRM_APPROVED');
  await assert.rejects(s.products.removeImage(p.id, a), (e) => e.code === 'CONFIRM_APPROVED');
  assert.equal(s.products.get(p.id).images.length, 2, 'nothing changed without confirmation');
  v = await s.products.removeImage(p.id, a, { confirm: true });
  assert.equal(v.images.some((i) => i.id === a), false);
  assert.equal(v.reference.state, 'stale', 'the set must be approved again');
  // an unapproved image needs no confirmation
  await s.products.upload(p.id, makePng(200, 200, 34), 'c.png');
  const c = s.products.get(p.id).images.find((i) => i.label === 'c').id;
  assert.equal((await s.products.removeImage(p.id, c)).images.some((i) => i.id === c), false);
});

test('a removed image can be uploaded again (no duplicate record ids)', async () => {
  const { s, p } = await fresh();
  const buf = makePng(200, 200, 41);
  await s.products.upload(p.id, buf, 'a.png');
  const id = s.products.get(p.id).images[0].id;
  await s.products.removeImage(p.id, id);
  assert.equal(s.products.get(p.id).counts.uploaded, 0);
  await s.products.upload(p.id, buf, 'a-again.png');
  const v = s.products.get(p.id);
  assert.equal(v.images.length, 1); assert.equal(v.images[0].id, id); assert.equal(v.images[0].status, 'pending');
  const raw = s.products.raw(p.id);
  assert.equal(raw.images.filter((i) => i.id === id).length, 1, 'one record per id');
});

test('persistence: images, order and primary survive a restart and stay bound to the right product', async () => {
  const { s, p } = await fresh();
  const other = await s.products.create({ name: '다른 제품', features: ['f'] });
  await s.products.upload(p.id, makePng(220, 220, 51), 'one.png'); await s.products.upload(p.id, makePng(220, 220, 52), 'two.png');
  await s.products.upload(other.id, makePng(220, 220, 53), 'other.png');
  const [one, two] = s.products.get(p.id).images.map((i) => i.id);
  await s.products.reorderImages(p.id, [two, one]); await s.products.setPrimary(p.id, one);
  const again = createProductService({ store: s.store, router: s.router });
  const v = again.get(p.id);
  assert.deepEqual(v.images.map((i) => i.id), [two, one]); assert.equal(v.primaryImageId, one);
  assert.equal(again.get(other.id).images.length, 1);
  const dir = path.join(s.store.dir, 'products', p.id);
  v.images.forEach((i) => assert.ok(fs.existsSync(path.join(dir, i.file)) || fs.readdirSync(s.store.dir, { recursive: true }).some((f) => String(f).endsWith(i.file)), 'image file persisted on the data volume: ' + i.file));
  assert.notEqual(v.images[0].sha256, again.get(other.id).images[0].sha256);
});

test('uploads never call an AI image model', async () => {
  const { s, p } = await fresh();
  let calls = 0;
  const spy = new Proxy(s.router, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { if (/image|run|estimate/i.test(String(k))) calls++; return t[k](...a); } : t[k]) });
  const svc = createProductService({ store: s.store, router: spy });
  await svc.upload(p.id, makePng(200, 200, 61), 'p.png', { source: 'paste' });
  await svc.upload(p.id, makePng(200, 200, 62), 'q.png', { source: 'drop' });
  await svc.reorderImages(p.id, []); 
  const id = svc.get(p.id).images[0].id;
  await svc.setPrimary(p.id, id); await svc.replace(p.id, id, makePng(200, 200, 63), 'r.png', { source: 'crop' }); await svc.removeImage(p.id, svc.get(p.id).images[1].id);
  assert.equal(calls, 0);
  assert.ok(svc.get(p.id).images.every((i) => i.kind === 'uploaded'), 'only uploaded images exist');
  assert.equal(s.usage.summary({}).totalUsd || 0, 0);
});

test('HTTP: upload with source, duplicate 409, replace needs ?confirm=1 for approved, order/primary/remove routes', async () => {
  const { s, p } = await fresh();
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const data = Buffer.isBuffer(body) ? body : body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: Object.assign({ Host: '127.0.0.1:' + port, 'x-rf-studio': '1', Origin: 'http://127.0.0.1:' + port, 'content-type': Buffer.isBuffer(body) ? 'image/png' : 'application/json', 'content-length': data.length }, headers) }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    const up = (n, src) => call('POST', `/api/products/${p.id}/images?label=n${n}&source=${src}`, makePng(240, 240, n), { 'x-filename': encodeURIComponent(`n${n}.png`) });
    assert.equal((await up(70, 'paste')).status, 200);
    assert.equal((await up(70, 'paste')).status, 409, 'same pasted image again');
    assert.equal((await up(71, 'drop')).status, 200);
    const imgs = (await call('GET', '/api/products/' + p.id)).json.images;
    assert.deepEqual(imgs.map((i) => i.source), ['paste', 'drop']);
    assert.equal((await call('PUT', `/api/products/${p.id}/images/order`, { ids: [imgs[1].id, imgs[0].id] })).json.images[0].id, imgs[1].id);
    assert.equal((await call('POST', `/api/products/${p.id}/images/${imgs[0].id}/primary`)).json.primaryImageId, imgs[0].id);
    await call('POST', `/api/products/${p.id}/images/${imgs[0].id}/status`, { status: 'approved' });
    const hdr = { 'x-filename': 'r.png' };
    assert.equal((await call('POST', `/api/products/${p.id}/images/${imgs[0].id}/replace`, makePng(240, 240, 72), hdr)).status, 409);
    assert.equal((await call('POST', `/api/products/${p.id}/images/${imgs[0].id}/remove`, {})).status, 409);
    assert.equal((await call('POST', `/api/products/${p.id}/images/${imgs[0].id}/replace?confirm=1&source=crop`, makePng(240, 240, 72), hdr)).status, 200);
    assert.equal((await call('POST', `/api/products/${p.id}/images/${imgs[1].id}/remove`, {})).status, 200);
    assert.equal((await call('POST', `/api/products/${p.id}/images`, makePng(50, 50, 73), { 'x-filename': 'tiny.png' })).status, 422);
  } finally { app.close(); }
});
