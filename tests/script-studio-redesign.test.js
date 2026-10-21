'use strict';
// Script Studio redesign: scene-by-scene writing/acting/timing — no images or prompts here, compact asset indicators,
// hard timing limits (dialogue vs scene, total vs episode max), drama-only fixed ending, hand-off to the Storyboard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const PUBLIC = path.join(__dirname, '..', 'studio', 'public', 'js', 'views');
const LONG = 'This is a very long line of dialogue that keeps going and going so that nobody could possibly speak it in only a few seconds of screen time at all.';
async function setup(category = 'drama', maxSec = 60) {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category, maxDurationSec: maxSec, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { pid, id });
}

test('Script Studio shows no image previews, image prompts or generation controls; panels and compact indicators are in place', () => {
  const focus = fs.readFileSync(path.join(PUBLIC, 'script-focus.js'), 'utf8');
  const script = fs.readFileSync(path.join(PUBLIC, 'script.js'), 'utf8');
  const project = fs.readFileSync(path.join(PUBLIC, 'script-project.js'), 'utf8');
  assert.doesNotMatch(focus, /h\('img'|scene-preview|previewFor|startImageInfo|\/media\/cutframe/, 'no image previews');
  assert.doesNotMatch(focus, /이미지 · 애니메이션 프롬프트|prompt-view/, 'no prompt panel');
  assert.doesNotMatch(script + focus + project, /makeStartImages|start-images|프레임 올리기|시작 이미지 만들기/, 'no image generation controls');
  for (const key of ["'dialogue'", "'visual'", "'advanced'"]) // three sections: 시각 연출 · 대사/자막/액션/효과음 · 고급 (the old 캐릭터 연기 panel became the elements editor in section B)
   assert.match(focus, new RegExp("section\\(ep, sid, " + key), 'panel ' + key);
  assert.match(focus, /data-dialogue-summary/);
  assert.match(script, /data-asset-strip/);
  assert.match(script, /제품 사진/); assert.match(script, /캐릭터 데이터 완료/); assert.doesNotMatch(script, /목소리 API 필요/, 'generic voice text replaced'); assert.match(script, /providerLabel/); assert.match(script, /data-change-voice/); assert.match(script, /data-connect-provider/);
  assert.match(project, /스토리보드로 이동/);
});

test('asset readiness is compact data: product photos and per-character reference / voice (voice needs the API)', async () => {
  const m = await setup();
  m.s.loadDemoReferences && await m.s.loadDemoReferences();
  const a = m.s.episodeView(m.id).derived.assets;
  assert.equal(a.product.ready, true); assert.ok(a.product.count >= 1);
  assert.deepEqual(a.characters.map((c) => c.id).sort(), ['diane', 'jack']);
  a.characters.forEach((c) => { assert.equal(typeof c.referenceReady, 'boolean'); assert.equal(c.voiceReady, false); assert.equal(c.voice.state, 'missing', 'no voice assigned yet: the status names the real problem instead of a generic "API required"'); assert.match(c.voiceNote, /목소리 미지정/); });
  assert.ok(!JSON.stringify(a).includes('/media/'), 'no image URLs / galleries in the indicator data');
});

test('character emotion is saved with the scene and is part of the scene version (old hashes are unchanged when it is empty)', async () => {
  const m = await setup();
  const sid = m.s.store.episodes.get(m.id).scenes[0].id;
  const SA = require('../studio/lib/sceneapproval');
  const before = SA.sceneFingerprint(m.s.store.episodes.get(m.id), sid);
  await m.s.saveScene(m.id, sid, { scene: { emotion: '' } });
  assert.equal(SA.sceneFingerprint(m.s.store.episodes.get(m.id), sid), before, 'an empty emotion changes nothing');
  await m.s.projects.approveScene(m.id, sid);
  await m.s.saveScene(m.id, sid, { scene: { emotion: 'Diane: anxious, then relieved' } });
  const sc = m.s.store.episodes.get(m.id).scenes.find((x) => x.id === sid);
  assert.equal(sc.emotion, 'Diane: anxious, then relieved');
  assert.notEqual(SA.sceneFingerprint(m.s.store.episodes.get(m.id), sid), before);
  assert.notEqual(m.s.episodeView(m.id).scenes.find((x) => x.id === sid).approval.status, 'approved', 'editing an approved scene needs a new approval');
});

test('a scene cannot be approved while its dialogue does not fit — and scenes are never stretched silently', async () => {
  for (const category of ['drama', 'viral']) {
    const m = await setup(category);
    const ep = m.s.store.episodes.get(m.id);
    const line = ep.lines[0];
    const scene = ep.scenes.find((x) => x.id === line.sceneId);
    const dur = scene.durationSec;
    await m.s.store.episodes.update(m.id, (e) => { e.lines.find((l) => l.id === line.id).en = LONG; });
    const v = m.s.episodeView(m.id).derived.validation;
    const err = v.errors.find((x) => x.code === 'SCENE_OVERFLOW');
    assert.ok(err, category + ': overflow is an error');
    assert.equal(err.sceneId, scene.id);
    await assert.rejects(m.s.projects.approveScene(m.id, scene.id), (e) => e.code === 'SCENE_NOT_READY' || e.status === 409 || /초과|오류|승인/.test(e.message), category);
    assert.equal(m.s.store.episodes.get(m.id).scenes.find((x) => x.id === scene.id).durationSec, dur, 'the scene length is untouched');
    assert.equal(m.s.episodeView(m.id).scenes.find((x) => x.id === scene.id).approval.status === 'ready', false);
  }
});

test('the episode maximum video length is only a guide: going over warns but never blocks script approval', async () => {
  const m = await setup('drama', 60);
  const total = m.s.episodeView(m.id).derived.totalPlannedSec;
  const codes = (v) => ({ err: v.errors.some((e) => e.code === 'TOTAL_OVER_MAX'), warn: v.warnings.some((w) => w.code === 'TOTAL_OVER_MAX') });
  assert.deepEqual(codes(m.s.episodeView(m.id).derived.validation), { err: false, warn: false });
  await m.s.store.episodes.update(m.id, (e) => { e.maxDurationSec = Math.max(10, Math.floor(total) - 5); });
  const v = m.s.episodeView(m.id).derived.validation;
  assert.deepEqual(codes(v), { err: false, warn: true }, 'a warning, not an error');
  assert.match(v.warnings.find((x) => x.code === 'TOTAL_OVER_MAX').message, /권장 영상 길이/);
  await approveWithScenes(m.s, m.id); // approval is not blocked
  assert.equal(m.s.episodeView(m.id).derived.totalPlannedSec, total, 'nothing was trimmed automatically');
  await m.s.store.episodes.update(m.id, (x) => { x.maxDurationSec = Math.ceil(total) + 1; });
  assert.deepEqual(codes(m.s.episodeView(m.id).derived.validation), { err: false, warn: false });
});

test('every newly created episode category uses the six-beat story and no fixed ending', async () => {
  const d = await setup('drama');
  const dep = d.s.store.episodes.get(d.id);
  assert.ok(dep.comedy_story, 'drama: six-beat story');
  assert.equal(dep.product_ending, undefined, 'drama: no fixed ending');
  for (const category of ['viral', 'info']) {
    const m = await setup(category);
    const ep = m.s.store.episodes.get(m.id);
    assert.ok(ep.comedy_story, category + ': six beats');
    assert.equal(ep.product_ending, undefined, category + ': no fixed product ending');
    assert.equal(ep.ending, undefined, category + ': no ending settings');
    assert.deepEqual(Object.keys(ep.comedy_story).length, 6);
    assert.ok(ep.scenes.length > 0 && ep.lines.length > 0);
    assert.ok(ep.scenes.every((s) => s.part === 'A'), category + ': no Part B scenes');
    assert.ok(ep.scenes.some((s) => s.beatKey === 'product_bridge' && s.showsProduct), category + ': the product is shown in the product bridge');
    // and it can go all the way to the hand-off
    await approveWithScenes(m.s, m.id);
    const ho = await m.s.projects.handoff(m.id);
    assert.ok(ho);
  }
});

test('hand-off to the Storyboard needs the script and every scene approved; it starts nothing paid', async () => {
  const m = await setup('viral');
  const calls = () => m.ai ? m.ai.calls.length : 0;
  await assert.rejects(m.s.projects.handoff(m.id), (e) => e.code === 'SCRIPT_NOT_APPROVED');
  await m.s.projects.approveReady(m.id);
  await m.s.approveScript(m.id);
  const ho = await m.s.projects.handoff(m.id);
  assert.ok(ho);
  assert.equal(m.s.store.episodes.get(m.id).imageDev.paidGeneration.started, false);
  assert.equal((m.s.store.episodes.get(m.id).generation.jobs || []).length, 0);
  void calls;
});
