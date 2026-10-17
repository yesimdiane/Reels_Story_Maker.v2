'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSelection } = require('../studio/lib/outfitlock');
const code = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const actors = [{ id: 'jack', references: [{ id: 'outfit-a', approved: true }, { id: 'unapproved', approved: false }] }];
test('outfit change accepts only explicitly approved character references', () => {
  assert.deepEqual(validateSelection({ jack: { refId: 'outfit-a', description: 'brown coat' } }, actors), { jack: { refId: 'outfit-a', description: 'brown coat' } });
  assert.throws(() => validateSelection({ jack: { refId: 'unapproved' } }, actors), /승인된/);
  assert.throws(() => validateSelection({ diane: { refId: 'outfit-a' } }, actors), /승인된/);
});
test('user-confirmed outfit endpoint never generates assets', () => {
  assert.match(code('studio/server.js'), /outfit-lock/);
  assert.match(code('studio/lib/studio.js'), /confirm !== true/);
  assert.match(code('studio/lib/studio.js'), /outfit\.lock\.approved/);
  assert.match(code('studio/public/js/views/animation-studio.js'), /data-outfit-save/);
});
test('start image attaches clothing reference bytes before paid generation and enforces total image limit', () => {
  const src = code('studio/lib/startimages.js');
  assert.match(src, /lockedOutfits\(ep, scene, store, L\.characters\)/);
  assert.match(src, /images\.push\(\.\.\.outfit\.images\)/);
  assert.match(src, /productParts\.concat\(outfit\.images/);
});
test('new animation clips keep original MP4 and browser-optimized copy', () => {
  const src = code('studio/lib/generation.js');
  assert.match(src, /browserMp4\(tmpFile, browserCopy, cfg\)/);
  assert.match(src, /original-v/);
  assert.match(src, /browserCompatibility/);
  const prep = code('studio/lib/browserclip.js');
  assert.match(prep, /\+faststart/);
  assert.match(prep, /libx264/);
  assert.match(prep, /yuv420p/);
});
