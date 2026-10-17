'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const studio = fs.readFileSync(path.join(__dirname, '../studio/lib/studio.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../studio/public/js/views/episodes.js'), 'utf8');
test('episode listing returns separate clip URL and static poster for existing and unrendered episodes', () => {
  assert.match(studio, /function episodePreview\(e\)/);
  assert.match(studio, /startImageInfo\.approved/);
  assert.match(studio, /return \{ video: '', poster \}/);
  assert.match(studio, /poster: episodePreview\(e\)\.poster/);
});
test('Safari episode thumbnail uses poster and still-image fallback without autoplay or paid requests', () => {
  assert.match(ui, /poster: e\.poster \|\| undefined/);
  assert.match(ui, /e\.poster \? h\('img'/);
  assert.match(ui, /preload: 'metadata'/);
  assert.doesNotMatch(ui, /autoplay: true/);
});
