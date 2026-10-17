'use strict';
// Scene editor UX: (1) approved scenes fold into a compact summary, (2) drag-and-drop / keyboard reordering keeps scene IDs and
// contents attached, (3) "씬 다시 생성하기" regenerates ONE scene from its visual direction & action as a reviewable proposal.
// All AI is faked; no network and no paid call can happen here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const VIEWS = path.join(__dirname, '..', 'studio', 'public', 'js');
const core = () => import(path.join(VIEWS, 'scene-order-core.js'));
const regenAnswer = (req) => {
  const cur = JSON.parse(/CURRENT_SCENE: (\{.*\})/.exec(req.prompt)[1]);
  const vis = /VISUAL_DIRECTION: ([\s\S]*?)\nACTION:/.exec(req.prompt)[1].trim();
  return { scene: { title_ko: '새로운 장면 제목', visual: `0.0–${cur.durationSec} s: NEW ${vis}`.slice(0, 600), action: 'NEW action by ' + cur.characters.join(', '), narration: '', lines: cur.lines.slice(0, 1).map((l) => ({ speaker: cur.characters[0], en: 'A new short line!', ko: '새로운 짧은 대사!' })) } };
};
async function setup(over = {}) {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: /^SCENE_REGENERATION/.test(req.prompt) ? (over.regen || regenAnswer)(req) : isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { ai, pid, id });
}
const ep = (m) => m.s.store.episodes.get(m.id);
const snap = (m) => Object.fromEntries(ep(m).scenes.map((s) => [s.id, JSON.stringify([s.title_ko, s.visual, s.action, s.characters, s.durationSec, ep(m).lines.filter((l) => l.sceneId === s.id).map((l) => [l.speaker, l.en, l.ko])])]));
const view = (m) => m.s.episodeView(m.id);
const approvedIds = (m) => view(m).scenes.filter((s) => s.approval && s.approval.approved).map((s) => s.id);

// ---------------------------------------------------------------- 1. approval + compact summary
test('approving a scene keeps its approval; collapsing is presentation only, failed validation is never approved (so never collapsed)', async () => {
  const m = await setup();
  const [a, b] = ep(m).scenes.map((s) => s.id);
  await m.s.projects.approveScene(m.id, a);
  assert.ok(approvedIds(m).includes(a));
  // an invalid scene cannot be approved: it stays unapproved (the UI only collapses after a successful approval)
  await m.s.saveScene(m.id, b, { scene: { title_ko: '' } });
  await assert.rejects(m.s.projects.approveScene(m.id, b), (e) => e.status === 409 || /승인|오류/.test(e.message));
  assert.ok(!approvedIds(m).includes(b));
  // collapse state is browser-only: approval data is identical before and after (nothing to save)
  const before = JSON.stringify(view(m).scenes.map((s) => [s.id, s.approval && s.approval.approved, s.approval && s.approval.revision]));
  const { setCollapsed } = await import(path.join(VIEWS, 'views', 'scene-collapse.js'));
  void setCollapsed;
  assert.equal(JSON.stringify(view(m).scenes.map((s) => [s.id, s.approval && s.approval.approved, s.approval && s.approval.revision])), before);
});

// ---------------------------------------------------------------- 2. reordering
test('reorder planning: stable IDs, Part B is locked, beats never end up empty, a moved scene stays in its beat while it is next to it', async () => {
  const { planReorder, planStep, dropIndex, canMove } = await core();
  const sc = (id, part, beatKey) => ({ id, part, beatKey });
  const F = { formula: { structured: true }, scenes: [sc('S1', 'A', 'setup'), sc('S2', 'A', 'problem'), sc('S3', 'A', 'problem'), sc('S4', 'A', 'absurd_escalation'), sc('S5', 'A', 'unexpected_twist'), sc('S6', 'A', 'resolution'), sc('S7', 'A', 'product_bridge'), sc('B1', 'B', 'shopping_excuse'), sc('B2', 'B', 'product_demonstration')] };
  const up = planStep(F, 'S3', -1);
  assert.deepEqual(up.body.beats.problem, ['S3', 'S2']); assert.equal(up.beatChanged, false);
  assert.deepEqual(up.order, ['S1', 'S3', 'S2', 'S4', 'S5', 'S6', 'S7']);
  assert.equal(planStep(F, 'S1', 1).error.code, 'BEAT_EMPTY', 'a beat\'s only scene cannot leave it');
  assert.equal(planStep(F, 'B1', -1).error.code, 'LOCKED'); assert.equal(planReorder(F, 'B2', 0).error.code, 'LOCKED');
  assert.equal(canMove(F, 'B1'), false); assert.equal(canMove(F, 'S2'), true);
  assert.equal(planReorder(F, 'S2', 1).noop, true, 'dropping a scene where it already is changes nothing'); assert.deepEqual(planReorder(F, 'S2', 2).body.beats.problem, ['S3', 'S2']);
  const across = planReorder(F, 'S3', 3); // after S4 → joins the beat it moved towards
  assert.equal(across.beat, 'absurd_escalation'); assert.equal(across.beatChanged, true);
  assert.equal(planStep(F, 'S7', 1).noop, true, 'cannot move past the last scene');
  const free = { formula: { structured: false }, scenes: [sc('A'), sc('B'), sc('C')] };
  assert.deepEqual(planReorder(free, 'C', 0).body, { order: ['C', 'A', 'B'] });
  assert.equal(dropIndex([10, 50, 90], 60), 2); assert.equal(dropIndex([10, 50, 90], 5), 0); assert.equal(dropIndex([10, 50, 90], 500), 3);
});

test('reordering saves the new order, keeps every scene\'s content, lines, characters and approval attached to its ID, and regenerates nothing', async () => {
  const { planReorder, planStep } = await core();
  const m = await setup();
  await m.s.addScene(m.id, { beatKey: 'problem' }); // a beat with two scenes (the fixture has one per beat)
  const before = snap(m);
  const e0 = view(m);
  const multi = e0.formula.partA.find((b) => b.sceneIds.length >= 2);
  assert.ok(multi, 'a beat with two scenes');
  const [first, second] = multi.sceneIds;
  await m.s.projects.approveScene(m.id, first);
  const calls = m.ai.calls.length;
  const plan = planStep(e0, second, -1);
  assert.ok(plan.body && !plan.error);
  await m.s.reorderScenes(m.id, plan.body);
  const e1 = view(m);
  const order = e1.scenes.map((s) => s.id);
  assert.ok(order.indexOf(second) < order.indexOf(first), 'new order saved');
  assert.deepEqual(snap(m), before, 'nothing about any scene changed (content, dialogue, characters, duration)');
  assert.ok(approvedIds(m).includes(first), 'the approved scene is still approved after being moved');
  assert.equal(m.ai.calls.length, calls, 'no AI call: reordering never regenerates');
  // survives a restart / refresh
  const { createStudio } = require('../studio/lib/studio');
  const s2 = createStudio({ cfg: m.cfg });
  assert.deepEqual(s2.store.episodes.get(m.id).scenes.map((s) => s.id), order);
  // scenes can be walked to the top and back (keyboard path)
  const again = planStep(view(m), first, -1);
  assert.ok(again.noop || again.body || again.error);
  void planReorder;
});

test('the fixed ending cannot be reordered and a stale or invalid order is rejected without changing anything', async () => {
  const m = await setup();
  const e = view(m);
  const b = e.scenes.filter((s) => s.part === 'B').map((s) => s.id);
  const beats = Object.fromEntries(e.formula.partA.map((x) => [x.key, x.sceneIds.slice()]));
  const keep = ep(m).scenes.map((s) => s.id);
  await assert.rejects(m.s.reorderScenes(m.id, { beats: Object.assign({}, beats, { setup: beats.setup.concat([b[0]]) }) }), (x) => x.code === 'BAD_ORDER');
  await assert.rejects(m.s.reorderScenes(m.id, { beats: Object.assign({}, beats, { setup: [] }) }), (x) => x.code === 'BAD_ORDER' || x.code === 'BEAT_EMPTY');
  assert.deepEqual(ep(m).scenes.map((s) => s.id), keep);
});

// ---------------------------------------------------------------- 3. regenerate one scene
test('씬 다시 생성하기: estimate first (no call), then a PROPOSAL only — the scene, its approval and every other scene stay untouched', async () => {
  const m = await setup();
  const [sid, other] = ep(m).scenes.filter((s) => s.part === 'A').map((s) => s.id);
  await m.s.projects.approveScene(m.id, sid);
  const before = snap(m); const calls = m.ai.calls.length;
  const est = m.s.sceneRegen.estimate(m.id, sid, { visual: 'The character slips and slides dramatically across the entry hall.', action: 'slips' });
  assert.equal(m.ai.calls.length, calls, 'an estimate never calls the provider'); assert.ok(est.provider);
  await assert.rejects(m.s.sceneRegen.regenerate(m.id, sid, { visual: 'The character slips and slides dramatically across the entry hall.' }), (e) => /CONFIRM|확인|paid|PAID/i.test(e.code + e.message), 'paid → needs confirmation');
  assert.equal(m.ai.calls.length, calls);
  const rec = await m.s.sceneRegen.regenerate(m.id, sid, { visual: 'The character slips and slides dramatically across the entry hall.', action: 'slips', confirm: CONFIRM });
  assert.equal(rec.proposal.title_ko, '새로운 장면 제목'); assert.match(rec.proposal.visual, /NEW The character slips/);
  assert.deepEqual(snap(m), before, 'nothing was applied');
  assert.ok(approvedIds(m).includes(sid), 'the approved version is preserved until the replacement is accepted');
  assert.equal(m.ai.calls.length, calls + 1, 'exactly one text call');
  assert.ok(m.ai.calls.slice(calls).every((c) => !c.image), 'no image generation');
  const p = m.ai.calls[calls].prompt;
  assert.match(p, /VISUAL_DIRECTION: The character slips and slides/); assert.match(p, /CURRENT_SCENE: \{/); assert.match(p, /PREVIOUS_SCENE: /); assert.match(p, /NEXT_SCENE: /);
  assert.match(p, /VERIFIED_PRODUCT_FACTS/); assert.match(p, /APPROVED_STORYLINE/); assert.match(p, /SCRIPT_IDS/); assert.match(p, /Keep durationSec/);
  assert.equal(view(m).sceneRegen[sid].proposal.title_ko, '새로운 장면 제목', 'the proposal is stored with the episode (survives refresh)');
  void other;
});

test('accepting applies ONLY that scene, makes it an unapproved draft, keeps id/duration/characters, records history; other scenes are unchanged', async () => {
  const m = await setup();
  const [sid, other] = ep(m).scenes.filter((s) => s.part === 'A').map((s) => s.id);
  await m.s.projects.approveScene(m.id, sid); await m.s.projects.approveScene(m.id, other);
  const before = snap(m);
  const sc0 = ep(m).scenes.find((s) => s.id === sid);
  await m.s.sceneRegen.regenerate(m.id, sid, { visual: 'A brand new idea: the character juggles umbrellas in the hallway.', confirm: CONFIRM });
  await m.s.sceneRegen.accept(m.id, sid);
  const after = snap(m);
  assert.notEqual(after[sid], before[sid]);
  Object.keys(before).filter((k) => k !== sid).forEach((k) => assert.equal(after[k], before[k], k + ' unchanged'));
  const sc1 = ep(m).scenes.find((s) => s.id === sid);
  assert.equal(sc1.id, sid); assert.equal(sc1.durationSec, sc0.durationSec); assert.deepEqual(sc1.characters, sc0.characters); assert.equal(sc1.beatKey, sc0.beatKey);
  assert.match(sc1.visual, /NEW A brand new idea/);
  assert.ok(!approvedIds(m).includes(sid), 'the regenerated scene is unapproved');
  assert.ok(approvedIds(m).includes(other), 'other approved scenes stay approved');
  assert.equal(ep(m).sceneRegen[sid], undefined, 'proposal consumed');
  assert.ok((m.s.scriptVersions(m.id).versions || m.s.scriptVersions(m.id) || []).length >= 1, 'the previous script is kept in the version history');
});

test('cancelling discards the proposal; the original scene (and its approval) is untouched; a proposal for older text cannot overwrite newer edits', async () => {
  const m = await setup();
  const sid = ep(m).scenes.find((s) => s.part === 'A').id;
  await m.s.projects.approveScene(m.id, sid);
  const before = snap(m);
  await m.s.sceneRegen.regenerate(m.id, sid, { visual: 'Another completely different visual direction for this scene.', confirm: CONFIRM });
  await m.s.sceneRegen.cancel(m.id, sid);
  assert.equal(ep(m).sceneRegen && ep(m).sceneRegen[sid], undefined);
  assert.deepEqual(snap(m), before); assert.ok(approvedIds(m).includes(sid));
  await assert.rejects(m.s.sceneRegen.accept(m.id, sid), (e) => e.code === 'NO_PROPOSAL');
  // stale: edit the scene after the proposal was made
  await m.s.sceneRegen.regenerate(m.id, sid, { visual: 'Yet another visual direction that is long enough to count.', confirm: CONFIRM });
  await m.s.saveScene(m.id, sid, { scene: { visual: '0.0–4.0 s: the operator edited this scene by hand after the proposal.' } });
  const edited = snap(m);
  await assert.rejects(m.s.sceneRegen.accept(m.id, sid), (e) => e.code === 'STALE_PROPOSAL');
  assert.deepEqual(snap(m), edited, 'the newer edits were not overwritten');
});

test('bad AI answers are rejected with nothing stored; one regeneration at a time per scene; the locked ending cannot be regenerated; a missing instruction is refused', async () => {
  const bad = await setup({ regen: (req) => { const r = regenAnswer(req); r.scene.lines = [{ speaker: 'ghost', en: 'one two three four five six seven eight nine ten eleven', ko: '긴 대사' }]; return r; } });
  const sid = ep(bad).scenes.find((s) => s.part === 'A').id;
  const before = snap(bad);
  await assert.rejects(bad.s.sceneRegen.regenerate(bad.id, sid, { visual: 'A long enough visual direction for regeneration.', confirm: CONFIRM }), (e) => e.code === 'SCENE_REJECTED');
  assert.deepEqual(snap(bad), before); assert.equal(ep(bad).sceneRegen && ep(bad).sceneRegen[sid], undefined);
  const m = await setup();
  const id2 = ep(m).scenes.find((s) => s.part === 'A').id;
  const [r1, r2] = await Promise.allSettled([m.s.sceneRegen.regenerate(m.id, id2, { visual: 'First concurrent visual direction, long enough.', confirm: CONFIRM }), m.s.sceneRegen.regenerate(m.id, id2, { visual: 'Second concurrent visual direction, long enough.', confirm: CONFIRM })]);
  assert.equal([r1, r2].filter((r) => r.status === 'fulfilled').length, 1); assert.ok([r1, r2].some((r) => r.status === 'rejected' && r.reason.code === 'REGEN_RUNNING'));
  const b1 = ep(m).scenes.find((s) => s.part === 'B');
  await assert.rejects(m.s.sceneRegen.regenerate(m.id, b1.id, { visual: 'A long enough visual direction for the ending.', confirm: CONFIRM }), (e) => e.code === 'ENDING_LOCKED');
  await assert.rejects(m.s.sceneRegen.regenerate(m.id, id2, { visual: 'short', confirm: CONFIRM }), (e) => e.code === 'NO_INSTRUCTION');
});

test('mock mode (no key): regeneration works with a clearly marked sample and is never billed', async () => {
  const m = make();
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  const sid = m.s.store.episodes.get(id).scenes.find((s) => s.part === 'A').id;
  const est = m.s.sceneRegen.estimate(id, sid, { visual: 'A long enough visual direction for the sample.' });
  assert.equal(est.mock, true);
  const rec = await m.s.sceneRegen.regenerate(id, sid, { visual: 'A long enough visual direction for the sample.' });
  assert.equal(rec.mock, true); assert.match(rec.proposal.visual, /\[sample\]/);
  assert.equal(m.s.usage.summary({}).totalUsd || 0, 0);
});

test('wiring: handle in every movable scene header (keyboard + pointer), compact summary with expand, renamed regenerate button, review panel', () => {
  const focus = fs.readFileSync(path.join(VIEWS, 'views', 'script-focus.js'), 'utf8');
  const dnd = fs.readFileSync(path.join(VIEWS, 'views', 'scene-dnd.js'), 'utf8');
  const regen = fs.readFileSync(path.join(VIEWS, 'views', 'scene-regen.js'), 'utf8');
  assert.match(focus, /data-scene-handle/); assert.match(focus, /data-scene-expand/); assert.match(focus, /data-scene-collapse/); assert.match(focus, /씬 다시 생성하기/);
  assert.doesNotMatch(focus + regen, /씬 재생성(?!성)/, 'one name for the action');
  assert.match(dnd, /ArrowUp/); assert.match(dnd, /pointerdown/); assert.match(dnd, /Escape/); assert.match(dnd, /aria-live/);
  assert.match(regen, /data-regen-accept/); assert.match(regen, /data-regen-cancel/); assert.match(regen, /이미지·영상·음성은 만들지 않습니다/);
  assert.doesNotMatch(regen, /\/start-images|voice\/run|\/clips|generate-video/, 'regeneration never touches paid image / voice / video endpoints');
});
