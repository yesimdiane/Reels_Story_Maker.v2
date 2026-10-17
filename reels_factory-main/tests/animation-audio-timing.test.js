'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dialogueWindows, draftBeats } = require('../studio/lib/animdraft');
const { scriptFingerprint } = require('../studio/lib/episode');

const scene = { id: 's1', durationSec: 5, characters: ['diane', 'jack'], action: 'Diane presents the product' };
const chars = [{ id: 'diane', name: 'Diane' }, { id: 'jack', name: 'Jack' }];
const lines = [{ id: 'l1', sceneId: 's1', speaker: 'diane', en: 'Babyyyy! Look at this!' }, { id: 'l2', sceneId: 's1', speaker: 'jack', en: 'Really?' }];
function episode() { return { lines: lines.map(x => ({...x})), scenes: [scene] }; }
test('approved synthesized audio duration controls dialogue windows', () => {
  const ep = episode();
  const hash = scriptFingerprint(ep);
  ep.voice = { lines: { l1: { durationSec: 2.2, scriptHash: hash }, l2: { durationSec: 0.8, scriptHash: hash } } };
  const w = dialogueWindows(ep, ep.lines, 5, 5);
  assert.equal(w[0].source, 'synthesized-audio');
  assert.equal(w[0].t0, 0.5);
  assert.equal(w[0].audioEnd, 2.9, '2.2s audio rounds to 2.4s, starting at 0.5s');
  assert.equal(w[0].t1, 3);
  assert.equal(w[1].t0, 3);
  assert.equal(w[1].t1, 4);
  const beats = draftBeats(ep, scene, chars);
  assert.ok(beats.length);
  for (const b of beats) {
    assert.ok(b.t1 > b.t0 && b.t1 - b.t0 <= 0.5 + 1e-9, 'normal 0.5s beats with shorter audio-end cuts');
    assert.ok(b.emotion);
    assert.match(b.expression, /nose:.*mouth:/);
  }
  assert.ok(beats.some(b => b.characterId === 'diane' && Math.abs(b.t1 - 2.9) < 1e-9 && /mouth moves/.test(b.expression)));
  assert.ok(beats.filter(b => b.characterId === 'diane' && b.t0 >= 2.9 - 1e-9).every(b => /mouth closed/.test(b.expression)), 'no Diane lip motion after audio ends');
});
test('stale synthesized audio is ignored without paid regeneration', () => {
  const ep = episode();
  ep.voice = { lines: { l1: { durationSec: 4.9, scriptHash: 'stale' } } };
  const w = dialogueWindows(ep, ep.lines, 5, 5);
  assert.equal(w[0].source, 'estimated');
  assert.ok(w[0].t1 < 5);
});
