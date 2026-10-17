'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateScript } = require('../studio/lib/episode');
const { buildTimeline } = require('../studio/lib/timeline');
const { normalizeBeat } = require('../studio/lib/scriptformula');

const fixture = (maxSceneSec) => ({
  scenes: [{ id: 'S1', title: '기존 장면', durationSec: 8 }],
  lines: [{ id: 'L1', sceneId: 'S1', speaker: 'jack', en: 'Hello', ko: '안녕' }],
  product: { forbiddenClaims: [] },
  cta: { keyword: '우산', lines: ['우산 댓글'] },
  ...(maxSceneSec ? { durationPolicy: { maxSceneSec } } : {}),
});
const lib = { characters: [{ id: 'jack', name: 'Jack' }] };
test('existing episodes without a policy still allow 8-second scenes', () => {
  const errors = validateScript(fixture(), lib).errors;
  assert.equal(errors.some((e) => e.code === 'SCENE_DURATION'), false);
});
test('new episodes reject scenes longer than 5 seconds without altering the script', () => {
  const ep = fixture(5);
  assert.ok(validateScript(ep, lib).errors.some((e) => e.code === 'SCENE_DURATION'));
  assert.equal(ep.scenes[0].durationSec, 8);
});
test('new episodes allow freely chosen scene lengths from 1 through 5 seconds', () => {
  for (const sec of [1, 2.3, 4.9, 5]) {
    const ep = fixture(5); ep.scenes[0].durationSec = sec;
    assert.equal(validateScript(ep, lib).errors.some((e) => e.code === 'SCENE_DURATION'), false, String(sec));
  }
});
test('AI beat validation permits split scenes but rejects oversized scenes under new policy', () => {
  const ids = new Set(['jack']);
  const mk = (sec) => ({ title_ko: '잭의 깜짝 실수', durationSec: sec, characters: ['jack'], lines: [{ speaker: 'jack', en: 'Oops!', ko: '앗!' }] });
  const beat = { title_ko: '끝없는 우산 사건', scenes: [mk(4), mk(4)] };
  assert.equal(normalizeBeat(beat, 'setup', ids, 5).scenes.length, 2);
  assert.throws(() => normalizeBeat({ ...beat, scenes: [mk(8)] }, 'setup', ids, 5), /1~5초/);
  assert.equal(normalizeBeat({ ...beat, scenes: [mk(8)] }, 'setup', ids, 15).scenes.length, 1);
});
test('recorded voice never gets cut when it extends a new scene past five seconds', () => {
  const ep = fixture(5); ep.scenes[0].durationSec = 5; ep.audioTiming = { L1: 4.2 };
  const tl = buildTimeline(ep, () => 1);
  assert.ok(tl.scenes[0].duration > 5);
  assert.ok(tl.lines[0].end > 5);
});
