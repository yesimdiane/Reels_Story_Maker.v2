'use strict';
// Detailed animation direction in the script prompt + review translation (EN <-> KO): read-only, cost-confirmed, cached, never changes the English source.
const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('../studio/lib/scriptpresets');
const { targetFor } = require('../studio/lib/translate');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const a = fakeAi({ '*': (req) => {
    const p = req.prompt || '';
    if (/TRANSLATE_TO:/.test(p)) { const to = /TRANSLATE_TO:\s*(\w+)/.exec(p)[1]; return { text: '', json: { translation: to === 'Korean' ? '번역된 한국어' : 'Translated English' }, usage: { inputTokens: 10, outputTokens: 10 } }; }
    return { text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 100, outputTokens: 50 } };
  } });
  const m = make({ ai: a });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, a });
}

test('the script prompt always demands vivid, multi-sentence animation direction (camera, exaggerated motion, expressions)', () => {
  for (const mode of ['story', 'beat', 'legacy']) {
    const t = presets.lockedFor(mode);
    assert.match(t, /ANIMATION TIMELINE/, mode);
    assert.match(t, /camera/i);
    assert.match(t, /squash-and-stretch/);
    assert.match(t, /eyebrows/);
    assert.match(t, /never as a one-line summary/);
  }
  assert.doesNotMatch(presets.lockedFor('timing'), /ANIMATION TIMELINE/, 'the timing fix prompt does not carry it');
});

test('translation target: Korean text → English, everything else → Korean', () => {
  assert.equal(targetFor('Diane freezes, eyes widen'), 'ko');
  assert.equal(targetFor('다이앤이 얼어붙는다'), 'en');
});

test('translation is cost-confirmed, cached per text, read-only and never changes the English source', async () => {
  const { s, id, a } = await setup();
  const text = 'Diane freezes for a split second, then her eyes widen dramatically.';
  const est = s.translator.estimate(id, { text });
  assert.equal(est.cached, false);
  assert.equal(est.to, 'ko');
  const before = JSON.stringify(s.store.episodes.get(id).scenes) + JSON.stringify(s.store.episodes.get(id).lines);
  const calls0 = a.calls.length;
  await assert.rejects(s.translator.translate(id, { text }), (e) => !!e.code, 'a paid call needs the operator\'s confirmation');
  assert.equal(a.calls.length, calls0);
  const r = await s.translator.translate(id, { text, confirm: CONFIRM });
  assert.equal(r.translation, '번역된 한국어');
  assert.equal(a.calls.length, calls0 + 1);
  assert.match(a.calls.at(-1).prompt, /<<<TEXT\nDiane freezes/);
  const again = await s.translator.translate(id, { text });
  assert.equal(again.cached, true);
  assert.equal(a.calls.length, calls0 + 1, 'the second read is free');
  assert.equal(s.translator.estimate(id, { text }).cached, true);
  const after = JSON.stringify(s.store.episodes.get(id).scenes) + JSON.stringify(s.store.episodes.get(id).lines);
  assert.equal(after, before, 'the English text is untouched');
  const ko = await s.translator.translate(id, { text: '다이앤이 놀란다', confirm: CONFIRM });
  assert.equal(ko.to, 'en');
  assert.throws(() => s.translator.estimate(id, { text: '   ' }), (e) => e.code === 'EMPTY_TEXT');
});

test('translating does not touch approvals (the script stays approved)', async () => {
  const { s, id } = await setup();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await s.translator.translate(id, { text: 'Jack smirks.', confirm: CONFIRM });
  assert.equal(s.episodeView(id).derived.scriptApproved, true);
  assert.equal(s.episodeView(id).derived.sceneApproval.progress, '10/10 씬 승인');
});

test('mock AI (not connected) gives a clearly marked sample translation', async () => {
  const { s } = make();
  const r = await s.translator.translate('EP01', { text: 'Jack sighs.' });
  assert.match(r.translation, /샘플 번역/);
  assert.equal(r.mock, true);
});
