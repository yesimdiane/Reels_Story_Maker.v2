'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimeline } = require('../studio/lib/timeline');

const fixture = () => ({
  scenes: [{ id: 'S1', durationSec: 3 }, { id: 'S2', durationSec: 2 }],
  lines: [{ id: 'L1', sceneId: 'S1', speaker: 'diane' }, { id: 'L2', sceneId: 'S1', speaker: 'jack' }],
  cta: { durationSec: 0 },
});
test('saved dialogue offsets preserve defaults and move audio with the rest of the timeline', () => {
  const ep = fixture();
  const original = buildTimeline(ep, () => 1);
  assert.equal(original.lines[0].start, 0.25);
  assert.equal(original.lines[1].start, 1.43);
  ep.audioTiming = { L2: 3 };
  const shifted = buildTimeline(ep, () => 1);
  assert.equal(shifted.lines[0].start, 0.25);
  assert.equal(shifted.lines[1].start, 3);
  assert.equal(shifted.lines[1].end, 4);
  assert.ok(shifted.scenes[0].duration > original.scenes[0].duration);
  assert.equal(shifted.scenes[1].start, shifted.scenes[0].end);
});
test('overlapping requested voice positions never overlap existing speech', () => {
  const ep = fixture();
  ep.audioTiming = { L2: 0 };
  const tl = buildTimeline(ep, () => 1);
  assert.ok(tl.lines[1].start >= tl.lines[0].end + 0.18 - 0.001);
});
test('unchanged scenes remain in order and correctly preserve the total duration', () => {
  const tl = buildTimeline(fixture(), () => 1);
  assert.deepEqual(tl.scenes.map((s) => s.id), ['S1', 'S2']);
  assert.equal(tl.scenes[1].start, tl.scenes[0].end);
  assert.equal(tl.total, tl.scenes[1].end);
});
