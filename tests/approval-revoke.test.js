'use strict';
// Every approval can be cancelled: product structure description, reference-image set (and "continue without images"),
// caption / DM approval and the "published" record. Cancelling never deletes content (text, images, files stay).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, readyProduct } = require('./helpers/v23');
const { setupProduct, visionRoute, CONFIRM } = require('./helpers/product-analysis-fixtures');

test('product structure description: approve → 승인 취소 → draft again, text kept, no longer used for images', async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  assert.equal(s.products.raw(pid).analysisApprovedV, 1);
  const text = s.products.raw(pid).analyses.find((a) => a.v === 1).text;
  const v = await s.productAnalysis.revoke(pid, 1);
  const a = s.products.raw(pid).analyses.find((x) => x.v === 1);
  assert.equal(a.status, 'draft');
  assert.equal(a.text, text, 'the description itself is kept');
  assert.ok(a.revokedAt);
  assert.equal(s.products.raw(pid).analysisApprovedV, undefined);
  assert.ok(v, 'returns the product view');
  await s.productAnalysis.revoke(pid, 1); // idempotent
  await s.productAnalysis.approve(pid, 1); // and it can be approved again
  assert.equal(s.products.raw(pid).analysisApprovedV, 1);
  await assert.rejects(() => s.productAnalysis.revoke(pid, 99), (e) => e.code === 'NOT_FOUND');
});

test('reference-image set: approval and the "continue without images" record can be cancelled; images and their approvals stay', async () => {
  const m = make();
  const pid = await readyProduct(m.s);
  assert.equal(m.s.products.referenceState(m.s.products.raw(pid)).approved, true, 'the fixture starts approved');
  const imagesBefore = JSON.stringify(m.s.products.raw(pid).images.map((i) => [i.id, i.status]));
  await m.s.products.revokeReferenceSet(pid);
  assert.equal(m.s.products.referenceState(m.s.products.raw(pid)).state, 'none');
  assert.equal(m.s.products.readiness(m.s.products.raw(pid)).ok, false, 'Story Lab needs the set approved again');
  assert.equal(JSON.stringify(m.s.products.raw(pid).images.map((i) => [i.id, i.status])), imagesBefore, 'images and their approvals are untouched');
  await m.s.products.approveReferenceSet(pid, {});
  assert.equal(m.s.products.referenceState(m.s.products.raw(pid)).state, 'approved');
  await m.s.products.waiveReferences(pid, '테스트 사유');
  assert.equal(m.s.products.referenceState(m.s.products.raw(pid)).state, 'waived');
  await m.s.products.revokeReferenceSet(pid);
  assert.equal(m.s.products.referenceState(m.s.products.raw(pid)).state, 'none');
});

test('caption / DM approval and the published record: cancel approval, cancel the record, order is enforced', async () => {
  const { s } = make();
  await s.store.episodes.update('EP01', (ep) => { ep.publishing = Object.assign({}, ep.publishing, { caption: '[광고] 문구', approvedAt: '2026-01-01T00:00:00Z', approvedBy: 'operator', approvedHash: 'h', publishedAt: '2026-01-02T00:00:00Z', postUrl: 'https://www.instagram.com/reel/AAA/' }); });
  await assert.rejects(() => s.publishing.revoke('EP01'), (e) => e.code === 'ALREADY_PUBLISHED', 'a recorded post blocks cancelling the approval');
  await s.publishing.clearPublished('EP01');
  let pub = s.store.episodes.get('EP01').publishing;
  assert.equal(pub.publishedAt, ''); assert.equal(pub.postUrl, ''); assert.ok(pub.approvedAt, 'approval untouched by clearing the record');
  await s.publishing.revoke('EP01');
  pub = s.store.episodes.get('EP01').publishing;
  assert.equal(pub.approvedAt, ''); assert.equal(pub.caption, '[광고] 문구', 'the text is kept');
  await s.publishing.revoke('EP01'); await s.publishing.clearPublished('EP01'); // both idempotent
});
