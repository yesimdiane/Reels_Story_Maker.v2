'use strict';
// Mobile-first Script Studio backend: save ONE scene as a draft (never approves), add a scene (never overwrites), delete a scene safely,
// translations that arrive with the generated script (no second API call) and the second-by-second animation rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const T = require('../studio/lib/translate');
const presets = require('../studio/lib/scriptpresets');
const SA = require('../studio/lib/sceneapproval');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
const withKo = (json) => {
  const ko = (t) => 'KO::' + t;
  const scene = (s) => { ['visual', 'action', 'placement'].forEach((k) => { if (s[k]) s[k + '_ko'] = ko(s[k]); }); };
  const beat = (b) => { if (b.story_en) b.story_ko = ko(b.story_en); if (b.visual) b.visual_ko = ko(b.visual); (b.scenes || []).forEach(scene); };
  (json.scenes || []).forEach(scene);
  if (json.comedy_story) Object.values(json.comedy_story).forEach(beat);
  if (json.beat) beat(json.beat);
  return json;
};
async function episode({ ko = false } = {}) {
  const a = fakeAi({ '*': (req) => {
    if (/TRANSLATE_TO:/.test(req.prompt || '')) return { text: '', json: { translation: 'API-TRANSLATION' }, usage: { inputTokens: 1, outputTokens: 1 } };
    const json = isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3);
    return { text: '', json: ko && isScriptPrompt(req) ? withKo(JSON.parse(JSON.stringify(json))) : json, usage: { inputTokens: 10, outputTokens: 10 } };
  } });
  const m = make({ ai: a });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, a });
}
const view = (s, id) => s.episodeView(id);
const ids = (s, id) => s.store.episodes.get(id).scenes.map((x) => x.id);

// ---------- 씬 저장 ----------
test('씬 저장: saves only this scene as a draft, even when invalid; never approves; other scenes, ids, order and approvals are untouched', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  const before = s.store.episodes.get(id);
  const order0 = ids(s, id);
  const otherHash = JSON.stringify({ scenes: before.scenes.filter((x) => x.id !== 'S2'), lines: before.lines.filter((l) => l.sceneId !== 'S2') });
  const own = before.lines.filter((l) => l.sceneId === 'S2');
  // make S2 invalid (empty Korean subtitle + empty visual) and save it
  const v = await s.saveScene(id, 'S2', { scene: { title_ko: '고친 제목입니다', visual: '', durationSec: 4 }, lines: own.map((l, i) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: i === 0 ? '' : l.ko })) });
  const s2 = v.scenes.find((x) => x.id === 'S2');
  assert.equal(s2.title_ko, '고친 제목입니다');
  assert.equal(s2.approval.approved, false, 'saving never approves');
  assert.equal(s2.approval.status, 'needs_changes');
  assert.ok(s2.approval.errors.some((e) => e.code === 'LINE_KO'));
  assert.deepEqual(ids(s, id), order0, 'scene order and IDs are preserved');
  const after = s.store.episodes.get(id);
  assert.equal(JSON.stringify({ scenes: after.scenes.filter((x) => x.id !== 'S2'), lines: after.lines.filter((l) => l.sceneId !== 'S2') }), otherHash, 'every other scene and its dialogue is untouched');
  assert.equal(v.scenes.filter((x) => x.approval.approved).length, 5, 'other approvals stay');
  assert.deepEqual(after.lines.filter((l) => l.sceneId === 'S2').map((l) => l.id), own.map((l) => l.id), 'line ids are kept');
  assert.ok(s.store.episodes.versions(id).some((x) => /씬 저장 \(S2\)/.test(x.note)));
});

test('씬 저장 on an approved scene creates a new draft revision; the approved version stays in the history', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  const oldVisual = s.store.episodes.get(id).scenes.find((x) => x.id === 'S1').visual;
  const sc = view(s, id).scenes.find((x) => x.id === 'S1');
  await s.saveScene(id, 'S1', { scene: { visual: 'A completely new visual direction for scene one.', title_ko: sc.title_ko, durationSec: sc.durationSec } });
  const a = view(s, id).scenes.find((x) => x.id === 'S1').approval;
  assert.equal(a.approved, false);
  assert.equal(a.editedAfterApproval, true);
  const h = s.projects.sceneHistory(id, 'S1');
  assert.equal(h.versions.length, 1);
  assert.equal(h.versions[0].snapshot.scene.visual, oldVisual, 'the approved version is not overwritten');
  await s.projects.approveScene(id, 'S1');
  assert.equal(s.projects.sceneHistory(id, 'S1').versions.length, 2);
  assert.equal(view(s, id).scenes.find((x) => x.id === 'S1').approval.revision, 2);
});

test('씬 저장 adds new dialogue lines with fresh unique ids and keeps the others in place', async () => {
  const { s, id } = await episode();
  const own = s.store.episodes.get(id).lines.filter((l) => l.sceneId === 'S1');
  const all = s.store.episodes.get(id).lines.map((l) => l.id);
  await s.saveScene(id, 'S1', { lines: own.map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko })).concat([{ id: '', speaker: 'jack', en: 'Brand new line!', ko: '새 대사!' }]) });
  const lines = s.store.episodes.get(id).lines;
  const mine = lines.filter((l) => l.sceneId === 'S1');
  assert.equal(mine.length, own.length + 1);
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length, 'no duplicate ids');
  all.forEach((x) => assert.ok(lines.some((l) => l.id === x)), 'no line was lost');
  await assert.rejects(s.saveScene(id, 'NOPE', {}), (e) => e.code === 'NOT_FOUND');
});

// ---------- 씬 추가 / 삭제 ----------
test('씬 추가: a new empty draft scene right after the current one; nothing existing is overwritten; no Part B exists', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  const before = s.store.episodes.get(id);
  const order0 = ids(s, id);
  const v = await s.addScene(id, { afterSceneId: 'S2' });
  assert.equal(v.newSceneId, 'S7');
  const order1 = ids(s, id);
  assert.deepEqual(order1.filter((x) => x !== 'S7'), order0, 'existing scenes keep their ids and order');
  assert.equal(order1[order1.indexOf('S2') + 1], 'S7', 'inserted right after the current scene');
  const sc = v.scenes.find((x) => x.id === 'S7');
  assert.equal(sc.approval.status, 'draft');
  assert.equal(sc.beatKey, before.scenes.find((x) => x.id === 'S2').beatKey, 'stays inside the same story beat');
  assert.equal(v.scenes.filter((x) => x.part === 'B').length, 0, 'no ending scenes exist');
  assert.equal(v.scenes.filter((x) => x.approval.approved).length, 6, 'approvals of existing scenes are untouched');
  assert.equal(v.derived.sceneApproval.progress, '6/7 씬 승인');
  // after the last scene (product_bridge) the new scene stays in "제품 연결" and goes to the very end
  const last = ids(s, id).slice(-1)[0];
  const v2 = await s.addScene(id, { afterSceneId: last });
  const added = v2.scenes.find((x) => x.id === v2.newSceneId);
  assert.equal(added.part, 'A');
  assert.equal(added.beatKey, 'product_bridge');
  assert.equal(v2.scenes.slice(-1)[0].id, v2.newSceneId, 'appended at the end');
  await assert.rejects(s.addScene(id, { afterSceneId: 'S1', beatKey: 'shopping_excuse' }), (e) => e.code === 'BAD_BEAT');
});

test('씬 삭제: protects the last scene of a beat; ids of deleted scenes are never reused (their assets must not attach to a new scene)', async () => {
  const { s, id } = await episode();
  await assert.rejects(s.deleteScene(id, 'E1'), (e) => e.code === 'NOT_FOUND', 'there is no E1 ending scene any more');
  await assert.rejects(s.deleteScene(id, 'S1'), (e) => e.code === 'BEAT_EMPTY');
  const added = (await s.addScene(id, { afterSceneId: 'S1' })).newSceneId;
  await s.store.episodes.update(id, (ep) => { ep.clips[added] = { versions: [{ v: 1, file: 'x.mp4' }], approvedVersion: 1 }; });
  await s.deleteScene(id, added);
  assert.ok(!ids(s, id).includes(added));
  assert.ok(s.store.episodes.get(id).clips[added], 'clip data of the deleted scene is kept');
  const again = (await s.addScene(id, { afterSceneId: 'S1' })).newSceneId;
  assert.notEqual(again, added, 'the deleted id is not reused');
});

test('HTTP: PUT/POST/DELETE scene routes', async () => {
  const m = await episode();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    const add = await call('POST', `/api/episodes/${m.id}/scenes`, { afterSceneId: 'S1' });
    assert.equal(add.status, 200);
    const nid = add.json.newSceneId;
    const save = await call('PUT', `/api/episodes/${m.id}/scenes/${nid}`, { scene: { title_ko: '새 씬 제목', visual: '' }, lines: [] });
    assert.equal(save.status, 200);
    assert.equal(save.json.scenes.find((x) => x.id === nid).title_ko, '새 씬 제목');
    assert.equal(save.json.scenes.find((x) => x.id === nid).approval.approved, false);
    const bad = await call('POST', `/api/episodes/${m.id}/scenes/${nid}/approve`);
    assert.equal(bad.status, 409);
    assert.ok(Array.isArray(bad.json.error.details) && bad.json.error.details.length, 'the error lists the fields to highlight');
    const del = await call('DELETE', `/api/episodes/${m.id}/scenes/${nid}`);
    assert.equal(del.status, 200);
    assert.ok(!del.json.scenes.some((x) => x.id === nid));
  } finally { await new Promise((r) => app.close(r)); }
});

// ---------- translations with the generation ----------
test('the first AI generation also stores the Korean translations: 번역 보기 needs no second API call', async () => {
  const { s, id, a } = await episode({ ko: true });
  const ep = s.store.episodes.get(id);
  const sc = ep.scenes.find((x) => x.id === 'S1');
  const calls = a.calls.length;
  const est = s.translator.estimate(id, { text: sc.visual });
  assert.equal(est.cached, true, 'scene visual is already translated');
  assert.equal(est.translation, 'KO::' + sc.visual.trim());
  const r = await s.translator.translate(id, { text: sc.visual });
  assert.equal(r.cached, true);
  assert.equal(a.calls.length, calls, 'no API call');
  // beat level text too
  assert.equal(s.translator.estimate(id, { text: ep.comedy_story.setup.story_en }).cached, true);
  assert.equal(s.translator.estimate(id, { text: ep.comedy_story.setup.visual }).cached, true);
  // editing the English text makes a NEW text: that one is not cached (paid, confirmed)
  assert.equal(s.translator.estimate(id, { text: sc.visual + ' (edited)' }).cached, false);
});

test('mock AI (not connected) also stores marked sample translations with the generation', async () => {
  const { s } = make();
  const ep = s.store.episodes.get('EP01');
  const pairs = T.pairsFromScriptJson({ scenes: [{ visual: 'A', visual_ko: '가', action: 'B', action_ko: '나' }] });
  assert.deepEqual(pairs, [{ en: 'A', ko: '가' }, { en: 'B', ko: '나' }]);
  await s.store.episodes.update('EP01', (e) => { T.cachePairs(e, pairs, { mock: true }); });
  assert.equal(s.translator.estimate('EP01', { text: 'A' }).translation, '가');
  void ep;
});

// ---------- second-by-second animation ----------
test('every animation is planned in seconds: the locked prompt demands a timecoded visual and Korean translations; a missing timeline is advice, not a blocker', async () => {
  for (const mode of ['legacy', 'story', 'beat']) {
    const t = presets.lockedFor(mode);
    assert.match(t, /SECOND BY SECOND/, mode);
    assert.match(t, /0\.0–1\.2 s/);
    assert.match(t, /EXACTLY at durationSec/);
    assert.match(t, /visual_ko/);
  }
  assert.deepEqual(SA.timeline('0.0–1.0 s: a. 1.0–4.0 s: b.'), { segments: 2, end: 4 });
  assert.equal(SA.timeline('Diane smiles.').segments, 0);
  const { s, id } = await episode();
  const w = view(s, id).scenes.find((x) => x.id === 'S1').approval.warnings.find((x) => x.code === 'SCENE_NO_TIMELINE');
  assert.ok(w, 'a visual without a timeline gets advice');
  assert.equal(view(s, id).scenes.find((x) => x.id === 'S1').approval.status, 'ready', 'advice never blocks approval');
  const sc = view(s, id).scenes.find((x) => x.id === 'S1');
  await s.saveScene(id, 'S1', { scene: { title_ko: sc.title_ko, durationSec: sc.durationSec, visual: `0.0–${sc.durationSec - 1} s: Diane freezes. ${sc.durationSec - 1}–${sc.durationSec} s: eyes widen.` } });
  const w2 = view(s, id).scenes.find((x) => x.id === 'S1').approval.warnings;
  assert.equal(w2.some((x) => x.code === 'SCENE_NO_TIMELINE' || x.code === 'SCENE_TIMELINE_LENGTH'), false);
});
