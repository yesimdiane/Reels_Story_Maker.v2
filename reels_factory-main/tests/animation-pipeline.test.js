'use strict';
// Script Studio → Storyboard → Renderer: scene-specific animation beats, validation, per-scene regeneration, prompt compilation,
// and the Rendering Readiness validator that names the exact blockers. Cost: the free rules draft calls no AI; the AI plan is gated.
const test = require('node:test');
const assert = require('node:assert/strict');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio } = require('./helpers/scene-flow');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid, png } = require('./helpers/v23');
const { draftBeats, isGeneric } = require('../studio/lib/animdraft');

const CONFIRM = { paid: true, unknownCost: true };
const CHARS = [{ id: 'jack', name: 'Jack' }, { id: 'diane', name: 'Diane' }];
let aiBeats = null;
async function setup() {
  const ai = fakeAi({ '*': (req) => (/^ANIMATION_BEATS/.test(req.prompt || '') ? { text: '', json: aiBeats, usage: { inputTokens: 5, outputTokens: 5 } } : { text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  await approveWithScenes(m.s, id);
  const ep = m.s.store.episodes.get(id);
  return Object.assign(m, { pid, id, ai, sid: ep.scenes[0].id, sid2: ep.scenes[1].id });
}
const refs = (s) => ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(150 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true); });

test('Jack and the monsoon (3.5 s): dialogue + action become specific 0.5 s beats — no generic placeholders', () => {
  const ep = { lines: [{ sceneId: 'S1', speaker: 'jack', en: "British people don't use umbrellas!" }] };
  const sc = { id: 'S1', durationSec: 3.5, characters: ['jack'], action: 'Jack declares it confidently, then turns away and walks into the rain.', visual: 'Jack in a medium shot on a rainy Seoul street.' };
  const beats = draftBeats(ep, sc, CHARS);
  assert.ok(beats.length >= 3);
  assert.equal(beats[0].t0, 0); assert.equal(Math.max(...beats.map((b) => b.t1)), 3.5, 'covers the whole scene');
  beats.forEach((b) => { assert.equal(b.sceneId, 'S1'); assert.equal(b.characterId, 'jack'); assert.ok(b.t0 * 2 === Math.round(b.t0 * 2) && b.t1 * 2 === Math.round(b.t1 * 2)); assert.ok(!isGeneric(b), JSON.stringify(b)); });
  const text = JSON.stringify(beats);
  assert.match(text, /smug/); assert.match(text, /folds his arms briefly and shakes his head once/); assert.match(text, /walks into the rain/); assert.match(text, /camera holds as they exit/); assert.match(text, /medium shot/);
  // same character never overlaps
  const sorted = beats.slice().sort((a, b) => a.t0 - b.t0);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].t0 >= sorted[i - 1].t1 - 1e-9);
});

test('timed visual text ("0.0–1.5 s: …") drives the windows, the right character and the camera field', () => {
  const sc = { id: 'S2', durationSec: 4, characters: ['jack', 'diane'], action: '', visual: '0.0–1.5 s: Stable medium shot. 1.5–3.0 s: Whip-pan to Diane with a glowing lightbulb popping above her head. 3.0–4.0 s: Quick push-in zoom as she snaps the two magnetic pieces onto the metal door.' };
  const b = draftBeats({ lines: [] }, sc, CHARS);
  assert.deepEqual(b.map((x) => [x.t0, x.t1]), [[0, 1.5], [1.5, 3], [3, 4]]);
  assert.equal(b[1].characterId, 'diane'); assert.match(b[1].camera, /whip-pan/); assert.match(b[1].body, /lightbulb/);
  assert.equal(b[2].characterId, 'diane', '"she" continues with the previous character'); assert.match(b[2].camera, /push-in/);
  b.forEach((x) => assert.ok(!isGeneric(x)));
});

test('approving the script fills every scene with a persisted, valid plan; the old generic template phrases are gone', async () => {
  const m = await setup();
  const ep = m.s.store.episodes.get(m.id);
  ep.scenes.forEach((sc) => {
    const mo = ep.motion[sc.id];
    assert.ok(mo && mo.beats.length, sc.id + ' has beats'); assert.equal(mo.source, 'auto');
    const { problems } = m.s.sba.cleanBeats(mo.beats, sc);
    assert.deepEqual(problems, [], sc.id);
    mo.beats.forEach((b) => { assert.equal(b.sceneId, sc.id); assert.ok(sc.characters.includes(b.characterId)); assert.ok(b.t1 <= sc.durationSec); assert.ok(!isGeneric(b), sc.id + ' ' + JSON.stringify(b)); });
  });
  // persisted + scene order preserved after a reorder
  const order = m.s.store.episodes.get(m.id).scenes.map((x) => x.id);
  const view = m.s.episodeView(m.id);
  assert.deepEqual(view.scenes.map((x) => x.id), order);
  assert.ok(view.scenes.every((x) => x.animQuality.ok));
});

test('validation: character ids belong to the scene, bounds, order, per-character overlap (also between non-adjacent beats)', async () => {
  const m = await setup();
  const sc = m.s.store.episodes.get(m.id).scenes[0];
  const b = (t0, t1, o = {}) => Object.assign({ characterId: sc.characters[0], t0, t1, emotion: 'smug', body: 'raises a hand', gaze: 'at Diane', expression: 'smirk', camera: '' }, o);
  const bad = (beats, re) => assert.rejects(m.s.sba.saveMotion(m.id, m.sid, { beats }), (e) => e.code === 'INVALID_MOTION' && re.test(e.message), re.source);
  await bad([b(0, 1, { characterId: 'cloud' })], /등장하지 않는 캐릭터/);
  await bad([b(0, 1, { characterId: '', character: '' })], /캐릭터가 필요/);
  await bad([b(1, 0.5)], /끝 시간은 시작보다/);
  await bad([b(0, sc.durationSec + 1)], /벗어납니다/);
  await bad([b(0, 2), b(0.5, 1, { characterId: sc.characters[1] }), b(1, 3)], /겹칩니다/);
  const ok = await m.s.sba.saveMotion(m.id, m.sid, { beats: [b(0, 1), b(0.5, 1, { characterId: sc.characters[1], body: 'listens', gaze: 'at Jack' }), b(1, 2)] });
  assert.deepEqual(ok.beats.map((x) => x.sceneId), [m.sid, m.sid, m.sid]);
  assert.equal(ok.beats[0].character, 'Jack');
});

test('per-scene regeneration: manual beats survive unless replacement is confirmed; the free draft calls no AI', async () => {
  const m = await setup();
  const calls = m.ai.calls.length;
  await m.s.sba.saveMotion(m.id, m.sid, { beats: [{ characterId: 'jack', t0: 0, t1: 1, emotion: 'proud', body: 'MY MANUAL BEAT', gaze: 'up', expression: 'grin' }], source: 'manual' });
  await assert.rejects(m.s.animplan.generateRules(m.id, m.sid), (e) => e.code === 'MOTION_MANUAL_EXISTS');
  assert.equal(m.s.store.episodes.get(m.id).motion[m.sid].beats[0].body, 'MY MANUAL BEAT');
  const r = await m.s.animplan.generateRules(m.id, m.sid, { replace: true });
  assert.equal(r.source, 'auto'); assert.ok(r.history.some((h) => h.beats[0].body === 'MY MANUAL BEAT'), 'old version kept in history');
  assert.equal(m.ai.calls.length, calls, 'no AI call');
  assert.equal(m.s.store.episodes.get(m.id).motion[m.sid2].rev, 1, 'other scenes untouched');
});

test('AI plan: estimate first, explicit confirmation, rejected/generic output never overwrites, no automatic retry', async () => {
  const m = await setup();
  m.s.integrations.setRouting('storyboardPrompts', { provider: 'gemini', model: 'model-a' });
  const est = m.s.animplan.estimateAi(m.id, m.sid);
  assert.equal(est.sceneId, m.sid);
  const before = JSON.stringify(m.s.store.episodes.get(m.id).motion[m.sid]);
  await assert.rejects(m.s.animplan.generateAi(m.id, m.sid, {}), (e) => /CONFIRM|확인/.test(e.code + e.message));
  const n0 = m.ai.calls.length;
  aiBeats = { beats: [{ characterId: 'jack', t0: 0, t1: 1, emotion: 'neutral', body: 'holds the opening pose', gaze: 'looks at the camera', expression: 'settled', camera: 'static' }] };
  await assert.rejects(m.s.animplan.generateAi(m.id, m.sid, { confirm: CONFIRM }), (e) => e.code === 'ANIMATION_REJECTED');
  assert.equal(m.ai.calls.length, n0 + 1, 'exactly one call, not retried');
  assert.equal(JSON.stringify(m.s.store.episodes.get(m.id).motion[m.sid]), before, 'rejected output changed nothing');
  const sc = m.s.store.episodes.get(m.id).scenes[0];
  aiBeats = { beats: [{ characterId: sc.characters[0], t0: 0, t1: 0.5, emotion: 'smug confidence', body: 'plants both feet and lifts the chin', gaze: 'down the street', expression: 'smirk', camera: 'medium shot' }, { characterId: sc.characters[0], t0: 0.5, t1: sc.durationSec, emotion: 'dismay', body: 'ducks under the rain, hugging the bag', gaze: 'at the sky', expression: 'squinting wince', camera: 'camera holds' }] };
  const r = await m.s.animplan.generateAi(m.id, m.sid, { confirm: CONFIRM });
  assert.equal(r.source, 'ai'); assert.equal(r.beats.length, 2);
});

test('video prompt compilation: start frame, character references, timeline, camera, expressions, continuity — unchanged without a plan', async () => {
  const m = await setup();
  refs(m.s);
  const ep = m.s.store.episodes.get(m.id);
  const text = m.s.animplan.compose(ep, m.sid2, 'BASE PROMPT');
  assert.match(text, /^BASE PROMPT/); assert.match(text, /START FRAME: the approved image/); assert.match(text, /CHARACTER REFERENCES .*\(jack:|CHARACTER REFERENCES .*\(diane:/);
  assert.match(text, /ANIMATION TIMELINE/); assert.match(text, /face: /); assert.match(text, /CONTINUITY: continues from /); assert.match(text, /leads into /);
  await m.s.store.episodes.update(m.id, (e) => { delete e.motion; });
  assert.ok(m.s.animplan.compose(m.s.store.episodes.get(m.id), m.sid2, 'BASE PROMPT').startsWith('BASE PROMPT'), 'without a plan the approved prompt stays first (only the silent-animation rule is appended)');
  // the generation service uses the compiled text (job key follows it)
  const fs = require('node:fs'); const path = require('node:path');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'studio', 'lib', 'studio.js'), 'utf8'), /composePrompt: \(ep, sid, text\) => animplan\.compose/);
  const caps = m.s.animplan.capabilities('mock');
  assert.equal(caps.providerAnimation.available, false); assert.match(caps.localEffects.note, /AI 애니메이션은 로컬 렌더러에 없습니다/);
});

test('Rendering Readiness names the exact blockers, then clears them step by step (PRD flow)', async () => {
  const m = await setup();
  const codes = () => m.s.renderReadiness.check(m.s.store.episodes.get(m.id)).items.filter((i) => i.severity === 'block' || i.severity === 'pending').map((i) => i.code);
  let r = m.s.renderReadiness.check(m.s.store.episodes.get(m.id));
  assert.equal(r.canGenerateVideo, false); assert.equal(r.canRender, false);
  assert.ok(codes().includes('NO_START_IMAGE') || codes().includes('CHARACTER_REF_MISSING'), codes().join());
  assert.ok(codes().includes('STORYBOARD_NOT_APPROVED'));
  assert.ok(codes().includes('CLIP_NOT_GENERATED'), 'no clips yet: a neutral pending step, not an error');
  assert.equal(r.items.filter((i) => i.code === 'CLIP_NOT_GENERATED').every((i) => i.severity === 'pending'), true);
  assert.ok(r.items.some((i) => i.stage === 'render') && r.items.some((i) => i.stage === 'generate'));
  assert.equal(r.items.some((i) => i.severity === 'block' && i.code === 'CLIP_NOT_GENERATED'), false);
  assert.equal(r.categories.find((c) => c.key === 'animation').blocking, 0, 'animation exists thanks to the script approval');
  // missing animation (older approved storyboard) is a specific blocker, nothing else is touched
  await m.s.store.episodes.update(m.id, (e) => { delete e.motion[m.sid]; });
  assert.ok(codes().includes('NO_ANIMATION'));
  await m.s.animplan.generateRules(m.id, m.sid);
  assert.ok(!codes().includes('NO_ANIMATION'));
  // references + start frames + storyboard approval clear the generation-stage blockers
  refs(m.s);
  for (const sc of m.s.store.episodes.get(m.id).scenes) { await m.s.uploadStartFrame(m.id, sc.id, png(160 + sc.id.length), sc.id + '.png'); await m.s.approveStartFrame(m.id, sc.id, true); }
  await m.s.approveStoryboard(m.id);
  await approveAllAudio(m.s, m.id);
  r = m.s.renderReadiness.check(m.s.store.episodes.get(m.id));
  assert.equal(r.canGenerateVideo, true, JSON.stringify(r.items.filter((i) => (i.severity === 'block' || i.severity === 'pending') && i.stage === 'generate').map((i) => i.code + ':' + i.message)));
  assert.equal(r.canRender, false, 'clips and audio are still missing');
  assert.ok(codes().every((c) => /CLIP|AUDIO|SCENE|LIPSYNC/.test(c)), codes().join());
  // a deleted start-frame file is reported specifically (not a generic failure)
  const sc0 = m.s.store.episodes.get(m.id).scenes[0];
  require('node:fs').rmSync(m.s.store.episodes.file(m.id, 'startframes', sc0.startImage.file));
  assert.ok(m.s.renderReadiness.check(m.s.store.episodes.get(m.id)).items.some((i) => i.sceneId === sc0.id && i.code === 'NO_START_IMAGE'));
});

test('compatibility: legacy beats (name only) display with ids; an approved storyboard stays approved', async () => {
  const m = await setup();
  await m.s.store.episodes.update(m.id, (e) => { e.motion[m.sid] = { rev: 1, source: 'template', beats: [{ t0: 0, t1: 1, character: 'Diane', emotion: 'worried', body: 'raises her hand', gaze: '', expression: '', camera: '' }], history: [] }; });
  const v = m.s.episodeView(m.id).scenes.find((x) => x.id === m.sid);
  assert.equal(v.motion.beats[0].characterId, 'diane'); assert.equal(v.motion.beats[0].sceneId, m.sid);
  assert.equal(m.s.store.episodes.get(m.id).motion[m.sid].beats[0].characterId, undefined, 'viewing never rewrites stored data');
  assert.equal(v.animQuality.generic, 0);
});

test('HTTP: motion/generate, motion/estimate and render-readiness routes', async () => {
  const m = await setup();
  const { createApp } = require('../studio/server');
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'x-rf-studio': '1', Origin: base, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
    const rd = await call('GET', `/api/episodes/${m.id}/render-readiness`);
    assert.equal(rd.status, 200); assert.ok(rd.json.items.length && rd.json.categories.length);
    const est = await call('POST', `/api/episodes/${m.id}/scenes/${m.sid}/motion/estimate`, {});
    assert.equal(est.status, 200); assert.equal(est.json.sceneId, m.sid);
    const gen = await call('POST', `/api/episodes/${m.id}/scenes/${m.sid}/motion/generate`, { mode: 'rules' });
    assert.equal(gen.status, 200);
    assert.ok(gen.json.derived.renderReadiness);
  } finally { app.close(); }
});
