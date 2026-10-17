'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBody } = require('../studio/lib/modelcontract');
const model = require('../studio/seed/models.json').models.find(m => m.id === 'seedance-2.5');
test('Seedance 2.5 matches the supplied MuAPI request contract without paid calls', () => {
  assert.ok(model);
  assert.equal(model.endpoint, 'seedance-2.5-image-to-video');
  const body = buildBody(model, { prompt: 'Animate a park', imageUrl: 'https://example.test/park.jpg', aspectRatio: '9:16', duration: 5, negativePrompt: 'none' });
  assert.deepEqual(body, {
    resolution: '480p', seed: -1, high_bitrate: false, draft: false,
    prompt: 'Animate a park', image_url: 'https://example.test/park.jpg', duration: 5,
  });
  assert.equal(model.verification, 'unverified');
  assert.equal(model.costEstimateUsd, undefined);
});

test('480p draft payload uses explicit draft flag', () => {
  const body = buildBody(model, { prompt: 'move', imageUrl: 'https://example.test/a.jpg', duration: 5, extra: { resolution: '480p', draft: true } });
  assert.equal(body.draft, true);
  assert.equal(body.resolution, '480p');
  assert.equal(body.draft_request_id, undefined);
});
test('1080p finalization uses the completed draft request ID', () => {
  const body = buildBody(model, { prompt: 'move', imageUrl: 'https://example.test/a.jpg', duration: 5, extra: { resolution: '1080p', draft: false, draft_request_id: 'completed_draft_123' } });
  assert.equal(body.resolution, '1080p');
  assert.equal(body.draft, false);
  assert.equal(body.draft_request_id, 'completed_draft_123');
});
test('reject invalid combinations locally before billable submission', () => {
  const input = { prompt: 'move', imageUrl: 'https://example.test/a.jpg', duration: 5 };
  assert.throws(() => buildBody(model, { ...input, extra: { resolution: '720p', draft: true } }), /requires 480p/);
  assert.throws(() => buildBody(model, { ...input, extra: { resolution: '480p', draft_request_id: 'abc' } }), /requires 1080p/);
  assert.throws(() => buildBody(model, { ...input, extra: { resolution: '1080p', draft: true, draft_request_id: 'abc' } }), /cannot run together/);
});
