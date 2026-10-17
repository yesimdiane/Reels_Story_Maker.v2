'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = fs.readFileSync(path.join(__dirname, '../studio/public/js/views/video-studio.js'), 'utf8');
test('all timeline draggables use pointer capture rather than Safari native HTML draggable', () => {
  assert.match(file, /addEventListener\('pointerdown'/);
  assert.match(file, /setPointerCapture\(e\.pointerId\)/);
  assert.match(file, /addEventListener\('pointermove'/);
  assert.match(file, /addEventListener\('pointerup'/);
  assert.match(file, /addEventListener\('pointercancel'/);
  assert.match(file, /draggable: false/);
  assert.doesNotMatch(file, /ondragstart:/);
});
test('voice drag retains grab offset, 0.3s snapping and API persistence', () => {
  assert.match(file, /it\.start \+ \(e\.clientX - x\) \/ PX/);
  assert.match(file, /onDrop\(it\.key, sec\)/);
  assert.match(file, /audio-timing\/\$\{id\}/);
  assert.match(file, /Math\.min\(30, snap\(targetSec - sceneStart\(line\.sceneId\)\)\)/);
  assert.match(file, /user-select:none/);
});
