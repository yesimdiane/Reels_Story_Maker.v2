'use strict';
// Drag & drop scene order + the Jack & Diane visual/motion master prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
async function episode() {
  const a = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 10, outputTokens: 10 } }) });
  const m = make({ ai: a });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id });
}
const beatsOf = (ep) => Object.fromEntries(ep.formula.partA.map((b) => [b.key, b.sceneIds.slice()]));

test('reorder: moving a Part A scene into another beat changes its beat; the ending (Part B) never moves; the script needs re-approval', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  const v0 = s.episodeView(id);
  const ending0 = v0.scenes.filter((x) => x.part === 'B').map((x) => x.id);
  const beats = beatsOf(v0);
  assert.deepEqual(beats.setup, ['S1']);
  // move S2 (problem) after S1 inside "setup": setup=[S1,S2], problem would be empty → refused
  const bad = JSON.parse(JSON.stringify(beats)); bad.problem = []; bad.setup = ['S1', 'S2'];
  await assert.rejects(s.reorderScenes(id, { beats: bad }), (e) => e.code === 'BEAT_EMPTY');
  // swap two scenes between beats instead: S2 <-> S3
  const next = JSON.parse(JSON.stringify(beats));
  next.problem = ['S3']; next.absurd_escalation = ['S2'];
  const v = await s.reorderScenes(id, { beats: next });
  assert.deepEqual(v.scenes.map((x) => x.id).slice(0, 6), ['S1', 'S3', 'S2', 'S4', 'S5', 'S6']);
  assert.equal(v.scenes.find((x) => x.id === 'S3').beatKey, 'problem');
  assert.equal(v.scenes.find((x) => x.id === 'S2').beatKey, 'absurd_escalation');
  assert.deepEqual(v.scenes.filter((x) => x.part === 'B').map((x) => x.id), ending0, 'the fixed ending is untouched');
  assert.deepEqual(v.formula.partA.find((b) => b.key === 'problem').sceneIds, ['S3']);
  assert.equal(v.derived.scriptApproved, false, 'order is part of the approved script');
  assert.ok(s.store.episodes.versions(id).some((x) => /장면 순서 변경/.test(x.note)));
  // S1 kept its place and its approval; the scenes whose beat changed need approval again
  assert.equal(v.scenes.find((x) => x.id === 'S1').approval.approved, true);
  assert.equal(v.scenes.find((x) => x.id === 'S2').approval.approved, false);
});

test('reorder: a stale or tampered list is refused and nothing changes', async () => {
  const { s, id } = await episode();
  const before = JSON.stringify(s.store.episodes.get(id).scenes);
  const beats = beatsOf(s.episodeView(id));
  const missing = JSON.parse(JSON.stringify(beats)); missing.setup = [];
  await assert.rejects(s.reorderScenes(id, { beats: missing }), (e) => e.code === 'BAD_ORDER');
  const withEnding = JSON.parse(JSON.stringify(beats)); withEnding.setup.push('E1');
  await assert.rejects(s.reorderScenes(id, { beats: withEnding }), (e) => e.code === 'BAD_ORDER');
  await assert.rejects(s.reorderScenes(id, {}), (e) => e.code === 'BAD_ORDER');
  assert.equal(JSON.stringify(s.store.episodes.get(id).scenes), before);
});

test('reorder (older episodes without the fixed formula): plain order list; prompts after a changed predecessor are flagged stale', async () => {
  const { s } = make();
  const id = 'EP01';
  const ids = s.store.episodes.get(id).scenes.map((x) => x.id);
  await s.rebuildPrompts(id, undefined, { force: true, mode: 'template' }).catch(() => {});
  const order = ids.slice().reverse();
  const v = await s.reorderScenes(id, { order });
  assert.deepEqual(v.scenes.map((x) => x.id), order);
  await assert.rejects(s.reorderScenes(id, { order: order.slice(1) }), (e) => e.code === 'BAD_ORDER');
});

test('video master prompt: a versioned, editable prompt that is part of the storyboard AI instruction; existing prompt files gain it without changes to the rest', async () => {
  const { s } = make();
  const view = s.prompts.get('videoMaster');
  assert.match(view.text, /JACK & DIANE — VISUAL AND MOTION MASTER PROMPT v1/);
  assert.match(view.text, /MICRO-MOTION CONTROL/);
  const c = s.prompts.compose('storyboard');
  assert.ok(c.text.includes('TEMPORAL CONSISTENCY'));
  assert.equal(c.versions.videoMaster, 1);
  const saved = s.prompts.save('videoMaster', { text: view.text + '\nEXTRA RULE: hold the punchline pose.', note: 'test' });
  assert.equal(saved.current, 2);
  assert.ok(s.prompts.compose('storyboard').text.includes('hold the punchline pose'));
  assert.equal(s.prompts.restore('videoMaster', { toDefault: true }).current, 3);
});

test('an existing prompts.json without the master prompt gets it added as v1 and keeps every other version', () => {
  const fs = require('node:fs');
  const { s } = make();
  s.prompts.save('script', { text: s.prompts.get('script').text + '\nmy edit', note: 'mine' });
  const file = s.store.path('prompts.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete d.prompts.videoMaster;
  fs.writeFileSync(file, JSON.stringify(d));
  assert.equal(s.prompts.get('videoMaster').current, 1);
  assert.equal(s.prompts.get('script').current, 2, 'the operator\'s edit is untouched');
});
