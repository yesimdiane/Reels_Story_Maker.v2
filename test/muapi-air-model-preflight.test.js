'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBody } = require('../studio/lib/modelcontract');
const model = { id: 'kling-master', endpoint: 'kling-v2.1-master-i2v', promptField: 'prompt' };
const input = { prompt: 'Move slowly', imageUrl: 'https://example.test/frame.png' };
test('rejects a UI alias as the paid MuAPI model parameter', () => {
  assert.throws(() => buildBody({ ...model, extraParams: { model: 'kling-master' } }, input), /AIR identifier/);
});
test('rejects an endpoint slug as the paid MuAPI model parameter', () => {
  assert.throws(() => buildBody(model, { ...input, extra: { model: model.endpoint } }), /AIR identifier/);
});
test('rejects non-string model parameter', () => {
  assert.throws(() => buildBody({ ...model, extraParams: { model: 123 } }, input), /AIR identifier/);
});
test('keeps model field absent unless explicitly configured', () => {
  const body = buildBody(model, input);
  assert.equal(Object.hasOwn(body, 'model'), false);
});
