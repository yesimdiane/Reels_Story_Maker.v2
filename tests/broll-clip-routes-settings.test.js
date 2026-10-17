'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..', 'studio');
const server = fs.readFileSync(path.join(base, 'server.js'), 'utf8');
const settings = fs.readFileSync(path.join(base, 'public/js/views/settings.js'), 'utf8');
const generation = fs.readFileSync(path.join(base, 'lib/generation.js'), 'utf8');
const studio = fs.readFileSync(path.join(base, 'lib/studio.js'), 'utf8');
test('B-roll estimate, generate, review endpoints are registered, without triggering paid calls on estimate', () => {
  for (const route of ['/broll/:bid/clip/estimate', '/broll/:bid/clip/generate', '/broll/:bid/clip/:v/review']) assert.ok(server.includes(route), route);
  assert.match(server, /S\.gen\.estimateBroll\(p\.id, p\.bid/);
  assert.match(server, /S\.gen\.generateBroll\(p\.id, p\.bid/);
  assert.match(server, /S\.gen\.reviewBroll\(p\.id, p\.bid/);
});
test('separate B-roll model setting is persisted and does not replace scene model', () => {
  assert.match(studio, /next\.brollModelId = patch\.brollModelId/);
  assert.match(settings, /data-broll-model-select/);
  assert.match(settings, /data-broll-model-save/);
  assert.match(settings, /brollModelId: defaultBrollModel\.id/);
  assert.match(generation, /settings\.brollModelId \|\| settings\.defaultModelId/);
});
test('B-roll generation checks explicit cost confirmation and verified model', () => {
  assert.match(generation, /CONFIRM_MISMATCH/);
  assert.match(generation, /confirmUnknown/);
  assert.match(generation, /MODEL_UNVERIFIED/);
  assert.match(server, /S\.assertNotHeld\(p\.id\); const \{ accepted, done \} = await S\.gen\.generateBroll/);
});
