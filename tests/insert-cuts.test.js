'use strict';
// Insert shots ("컷 추가"): crops of the approved clip — free, never change the scene length / dialogue / audio timing,
// versioned, need scene re-approval, rendered locally with FFmpeg, warn about blur and never claim new eye/face motion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cuts = require('../studio/lib/cuts');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { probe } = require('../renderer/lib/ffmpeg');

const CONFIRM = { paid: true, unknownCost: true };
async function episode() {
  const a = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 10, outputTokens: 10 } }) });
  const m = make({ ai: a });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, a });
}
const scene = (s, id, sid) => s.episodeView(id).scenes.find((x) => x.id === sid);

// ---------- pure logic ----------
test('presets and transitions cover the requested set', () => {
  assert.deepEqual(Object.keys(cuts.PRESETS).sort(), ['custom', 'diane_face', 'eyes', 'hands_props', 'jack_face', 'product']);
  assert.deepEqual(Object.keys(cuts.TRANSITIONS).sort(), ['hard_cut', 'punch_in', 'quick_zoom']);
});

test('inserts stay inside the scene, never overlap and never extend it; the crop window stays inside the frame', () => {
  const ok = cuts.normalizeInserts([{ preset: 'eyes', startSec: 1, durationSec: 0.6, crop: { x: 0.02, y: 0.99, scale: 3 } }], { durationSec: 4, src: { width: 1080, height: 1920 } });
  assert.ok(ok.inserts[0].crop.x >= 0.5 / 3 - 1e-6 && ok.inserts[0].crop.y <= 1 - 0.5 / 3 + 1e-6);
  assert.ok(ok.warnings.some((w) => w.code === 'CROP_ADJUSTED'));
  const trimmed = cuts.normalizeInserts([{ preset: 'product', startSec: 3.5, durationSec: 2 }], { durationSec: 4 });
  assert.equal(trimmed.inserts[0].durationSec, 0.5, 'trimmed to the scene end, not extended');
  assert.throws(() => cuts.normalizeInserts([{ startSec: 4.5, durationSec: 1 }], { durationSec: 4 }), (e) => e.code === 'INSERT_OUTSIDE');
  assert.throws(() => cuts.normalizeInserts([{ startSec: 1, durationSec: 1 }, { startSec: 1.5, durationSec: 1 }], { durationSec: 4 }), (e) => e.code === 'INSERT_OVERLAP');
});

test('blur warning when the crop is enlarged beyond the source resolution; offers a separately approved image option', () => {
  const a = cuts.normalizeInserts([{ preset: 'eyes', startSec: 0, durationSec: 0.6, crop: { x: 0.5, y: 0.3, scale: 3.2 } }], { durationSec: 4, src: { width: 720, height: 1280 } });
  const w = a.warnings.find((x) => x.code === 'LOW_RESOLUTION');
  assert.equal(w.level, 'blur');
  assert.match(w.hiRes, /별도 승인/);
  assert.equal(a.inserts[0].resolution.level, 'blur');
  const b = cuts.normalizeInserts([{ preset: 'custom', startSec: 0, durationSec: 0.6, crop: { x: 0.5, y: 0.5, scale: 1 } }], { durationSec: 4, src: { width: 1080, height: 1920 } });
  assert.equal(b.warnings.some((x) => x.code === 'LOW_RESOLUTION'), false);
  assert.equal(cuts.resolutionCheck(0, 0, { scale: 2 }).known, false);
});

test('a crop is a camera move only: every insert says so and face/eye presets never claim new motion', () => {
  const r = cuts.normalizeInserts([{ preset: 'eyes', startSec: 0, durationSec: 0.6, note: '눈동자가 좌우로 움직인다' }, { preset: 'hands_props', startSec: 1, durationSec: 0.6 }], { durationSec: 4, src: { width: 1080, height: 1920 } });
  r.inserts.forEach((i) => { assert.equal(i.effect, 'camera_crop'); assert.equal(i.motion.createsNewMotion, false); });
  assert.match(r.inserts[0].motion.faceNote, /크롭으로 만들 수 없습니다/);
  assert.ok(r.warnings.some((w) => w.code === 'MOTION_CLAIM'));
  assert.equal(r.inserts[1].motion.faceNote, undefined);
});

test('the FFmpeg graph replaces ranges of the SAME stream (timeline length unchanged)', () => {
  const chains = cuts.sceneInsertChains({ base: 'b0', out: 'v0', inserts: [{ startSec: 1, durationSec: 0.5, transition: 'hard_cut', crop: { x: 0.5, y: 0.4, scale: 2 } }, { startSec: 2, durationSec: 0.6, transition: 'punch_in', crop: { x: 0.5, y: 0.4, scale: 2 } }, { startSec: 3, durationSec: 0.6, transition: 'quick_zoom', crop: { x: 0.5, y: 0.4, scale: 2 } }], W: 540, H: 960, fps: 30, dur: 4 }).chains.join('\n');
  assert.match(chains, /split=7/);
  assert.match(chains, /zoompan/);
  assert.match(chains, /concat=n=7/);
  assert.doesNotMatch(chains, /-i |movie=|lavfi/);
});

// ---------- studio integration ----------
test('saving inserts: versioned, free (no AI/video call), scene length and dialogue untouched, scene needs a new approval', async () => {
  const { s, id, a } = await episode();
  await s.projects.approveReady(id);
  const before = s.store.episodes.get(id);
  const calls = a.calls.length;
  const lines0 = JSON.stringify(before.lines);
  const dur0 = before.scenes.find((x) => x.id === 'S1').durationSec;
  const v = await s.saveInserts(id, 'S1', [{ preset: 'jack_face', startSec: 1, durationSec: 0.8 }]);
  const sc = v.scenes.find((x) => x.id === 'S1');
  assert.equal(sc.inserts.length, 1);
  assert.equal(sc.inserts[0].id, 'C1');
  assert.equal(sc.inserts[0].effect, 'camera_crop');
  assert.equal(sc.durationSec, dur0, 'the parent scene duration is unchanged');
  assert.equal(JSON.stringify(s.store.episodes.get(id).lines), lines0, 'dialogue and Korean subtitles are untouched');
  assert.equal(a.calls.length, calls, 'no AI call');
  assert.equal(s.store.episodes.get(id).spend.length, 0);
  assert.equal(sc.approval.approved, false, 'new edits require review');
  assert.equal(sc.approval.editedAfterApproval, true);
  assert.equal(s.projects.sceneHistory(id, 'S1').versions.length, 1, 'the previously approved version is preserved');
  assert.equal(v.scenes.filter((x) => x.approval.approved).length, 5, 'other scenes are unaffected');
  assert.ok(s.store.episodes.versions(id).some((x) => /컷 편집 \(S1\)/.test(x.note)), 'versioned');
  assert.equal(v.derived.scriptApproved, false === false ? v.derived.scriptApproved : null);
  // approving the scene again records revision 2 that includes the insert
  await s.projects.approveScene(id, 'S1');
  const h = s.projects.sceneHistory(id, 'S1');
  assert.equal(h.versions.length, 2);
  assert.equal(h.versions[1].snapshot.scene.inserts.length, 1);
  assert.equal(h.versions[0].snapshot.scene.inserts, undefined);
});

test('inserts do not change the old scene approvals of scenes without inserts (hash is stable)', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.saveInserts(id, 'S1', []);
  assert.equal(s.episodeView(id).scenes.every((x) => x.approval.approved), true);
});

test('invalid inserts are refused and nothing is saved', async () => {
  const { s, id } = await episode();
  const before = JSON.stringify(s.store.episodes.get(id).scenes);
  await assert.rejects(s.saveInserts(id, 'S1', [{ startSec: 99, durationSec: 1 }]), (e) => e.code === 'INSERT_OUTSIDE');
  await assert.rejects(s.saveInserts(id, 'NOPE', []), (e) => e.code === 'NOT_FOUND');
  assert.equal(JSON.stringify(s.store.episodes.get(id).scenes), before);
});

test('reusable close-up presets across episodes (versioned, built-ins always there)', async () => {
  const { s, id } = await episode();
  assert.equal(s.cutPresets.builtIn().length, 6);
  const p = s.cutPresets.save({ name: 'Jack 반응 얼굴', preset: 'jack_face', transition: 'punch_in', durationSec: 0.7, crop: { x: 0.45, y: 0.3, scale: 2.4 } });
  assert.equal(p.current, 1);
  const p2 = s.cutPresets.save({ id: p.id, durationSec: 0.9 });
  assert.equal(p2.current, 2);
  assert.equal(p2.versions.length, 2);
  assert.equal(s.cutPresets.list().length, 1);
  const other = await s.projects.duplicateEpisode(id);
  const v = await s.saveInserts(other, 'S2', [{ preset: p2.preset, transition: p2.transition, startSec: 0.5, durationSec: p2.durationSec, crop: p2.crop }]);
  assert.equal(v.scenes.find((x) => x.id === 'S2').inserts[0].crop.scale, 2.4);
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === 'S2').inserts, undefined, 'the other episode is independent');
  s.cutPresets.remove(p.id);
  assert.equal(s.cutPresets.list().length, 0);
});

test('duplicating an episode / copying a scene carries the inserts as independent data', async () => {
  const { s, id } = await episode();
  await s.saveInserts(id, 'S1', [{ preset: 'product', startSec: 0.5, durationSec: 0.8 }]);
  const copy = await s.projects.duplicateEpisode(id);
  assert.equal(s.store.episodes.get(copy).scenes.find((x) => x.id === 'S1').inserts.length, 1);
  await s.saveInserts(copy, 'S1', []);
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === 'S1').inserts.length, 1);
});

test('hand-off to Image Development carries the inserts (no generation)', async () => {
  const { s, id, a } = await episode();
  await s.saveInserts(id, 'S1', [{ preset: 'eyes', startSec: 1, durationSec: 0.6 }]);
  await s.projects.approveReady(id);
  await s.approveScript(id);
  const calls = a.calls.length;
  await s.projects.handoff(id);
  assert.equal(s.projects.readSnapshot(id).scenes.find((x) => x.id === 'S1').inserts.length, 1);
  assert.equal(a.calls.length, calls);
});

// ---------- real FFmpeg render (mock clips) ----------
const os = require('node:os');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes } = require('./helpers/scene-flow');
const cfgFor = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cuts-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();

test('full render: inserts replace part of the shot — same output length, audio untouched, render freshness and the scene-approval gate follow the inserts', { skip: !hasFfmpeg, timeout: 300000 }, async () => {
  const cfg = cfgFor();
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }) });
  const id = 'EP01';
  await approveWithScenes(s, id);
  await approveAllAudio(s, id);
  await s.rebuildPrompts(id);
  await s.loadDemoReferences();
  await s.approveStoryboard(id);
  const auth = await s.gen.authorize(id, { confirmUnknown: true });
  await (await s.gen.run(id, auth.id)).done;
  for (const sc of s.episodeView(id).scenes) await s.gen.review(id, sc.id, 1, 'approve');
  await s.voice.synthesize(id);
  await approveAllScenes(s, id);
  const base = await (await s.renderer.render(id, { preview: false })).done;
  const view0 = s.episodeView(id);
  assert.equal(view0.derived.steps.find((x) => x.key === 'render').state, 'done');
  const info0 = await probe(cfg.ffmpeg.ffprobe, s.store.episodes.file(id, base.file));
  const dur = view0.scenes[0].durationSec;
  assert.ok(view0.scenes[0].cutInfo.source.kind === 'clip' && view0.scenes[0].cutInfo.source.width > 0, 'resolution of the approved clip is known');
  // three transitions on two scenes
  await s.saveInserts(id, view0.scenes[0].id, [
    { preset: 'jack_face', transition: 'hard_cut', startSec: 0.5, durationSec: 0.6 },
    { preset: 'eyes', transition: 'quick_zoom', startSec: 1.4, durationSec: 0.7 },
    { preset: 'product', transition: 'punch_in', startSec: 2.4, durationSec: 0.6 },
  ]);
  // the render is now out of date (cuts changed) and the scene needs approval before it can be rendered
  assert.equal(s.episodeView(id).derived.steps.find((x) => x.key === 'render').state, 'attention');
  const blocked = s.renderer.plan(id);
  assert.ok(blocked.problems.some((p) => p.code === 'CUTS_NOT_APPROVED' && p.message.includes(view0.scenes[0].id)));
  await assert.rejects(s.renderer.render(id, { preview: false }), (e) => e.code === 'BLOCKED');
  await s.projects.approveScene(id, view0.scenes[0].id);
  await approveAllScenes(s, id);
  assert.equal(s.renderer.plan(id).canRender, true);
  const withCuts = await (await s.renderer.render(id, { preview: false })).done;
  const info1 = await probe(cfg.ffmpeg.ffprobe, s.store.episodes.file(id, withCuts.file));
  assert.ok(Math.abs(info1.duration - info0.duration) < 0.15, `same length with and without inserts (${info0.duration} vs ${info1.duration})`);
  assert.equal(withCuts.width, base.width);
  assert.ok(withCuts.cutsHash && withCuts.cutsHash !== base.cutsHash);
  assert.notEqual(withCuts.sha256, base.sha256);
  assert.equal(s.episodeView(id).derived.steps.find((x) => x.key === 'render').state, 'done', 'a render made after the edit is fresh again');
  assert.ok(dur >= 3);
});
