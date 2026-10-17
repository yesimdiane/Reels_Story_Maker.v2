'use strict';
// Rendering Readiness + storyboard approval lifecycle (mock video provider, no paid calls):
//   script → storyboard approval → start-image approval → video generation → clip approval → final render readiness.
// Root causes covered: whole-object approval hash (any touch to any scene — even approving a frame — silently invalidated everything),
// generate/render stages mixed together, unfinished steps shown as red errors, readiness pointing at a page by the wrong name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes, decideAllGates } = require('./helpers/scene-flow');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { storyboardFingerprint } = require('../studio/lib/episode');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ready-'));
const cfgFor = () => loadConfig({ RF_STUDIO_DIR: tmp(), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = hasFfmpeg ? false : 'ffmpeg not installed';
function make() { const cfg = cfgFor(); const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }); return { cfg, prov, s: createStudio({ cfg, provider: prov }) }; }
const ID = 'EP01';
const realRefs = (s) => ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(30 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true); });
async function upToStoryboard(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  realRefs(s);
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(60 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  return ids;
}
const R = (s) => s.renderReadiness.check(s.store.episodes.get(ID));
const open = (r, stage) => r.items.filter((i) => i.stage === stage && (i.severity === 'block' || i.severity === 'pending'));
const authorize = async (s, sceneIds) => { await decideAllGates(s, ID); const est = s.gen.estimate(ID, { sceneIds }); return s.gen.authorize(ID, { sceneIds, confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null }); };
async function generateAndApprove(s, sid) {
  const a = await authorize(s, [sid]);
  await (await s.gen.run(ID, a.id)).done;
  const v = s.store.episodes.get(ID).clips[sid].versions.slice(-1)[0];
  return v;
}

test('workflow: script → storyboard → images → generate (no clip required) → approve clip → final render ready', { skip, timeout: 240000 }, async () => {
  const { s } = make();
  await approveWithScenes(s, ID);
  let r = R(s);
  assert.equal(r.stages.generate.status, 'pending', 'unfinished steps are pending, not errors');
  assert.ok(open(r, 'generate').every((i) => i.severity === 'pending'), JSON.stringify(open(r, 'generate').map((i) => [i.code, i.severity])));
  const ids = await upToStoryboard(s);
  assert.ok(ids.length >= 7, 'the episode has S1–S7+: ' + ids.join());
  r = R(s);
  // the animation is SILENT: generation does not wait for audio (voice, lip sync and SFX come after it)
  assert.ok(!s.gen.estimate(ID, { sceneIds: [s.store.episodes.get(ID).lines[0].sceneId] }).blockers.some((b) => /AUDIO|SFX|LIPSYNC/.test(b.code)));
  assert.ok(!r.items.some((i) => i.code === 'AUDIO_NOT_APPROVED' && i.stage === 'generate'));
  assert.equal(r.canGenerateVideo, true, JSON.stringify(open(r, 'generate').map((i) => i.code + ':' + i.message)));
  assert.equal(r.stages.generate.status, 'ready');
  // no clip exists yet: every scene is "waiting for video generation" — neutral pending items, never a red error
  assert.equal(r.clips.none, ids.length); assert.equal(r.stages.clipGeneration.status, 'waiting'); assert.equal(r.stages.render.status, 'waiting');
  const pend = r.items.filter((i) => i.code === 'CLIP_NOT_GENERATED');
  assert.equal(pend.length, ids.length); assert.ok(pend.every((i) => i.severity === 'pending' && /영상 클립 생성 대기 — 애니메이션 스튜디오에서 영상을 생성하거나 업로드하세요\./.test(i.message) && i.action.view === 'animation' && i.action.sceneId), 'clip items open the scene in Animation Studio');
  assert.equal(r.items.filter((i) => i.severity === 'block').length, 0, 'no red errors for a normal unfinished workflow');
  assert.ok(!JSON.stringify(r.items).includes('Animation Studio'), 'no instruction points at a page that is not in the navigation');
  // generation does not need a previously generated clip
  const est = s.gen.estimate(ID, { sceneIds: [ids[0]] });
  assert.equal(est.canAuthorize, true, JSON.stringify(est.blockers));
  // generate every scene, then the state is "waiting for clip approval", then approve one by one
  for (const sid of ids) await generateAndApprove(s, sid);
  r = R(s);
  assert.equal(r.clips.unapproved, ids.length); assert.equal(r.stages.clipApproval.status, 'waiting'); assert.equal(r.canRender, false);
  for (const sid of ids) { const v = s.store.episodes.get(ID).clips[sid].versions.slice(-1)[0]; await s.gen.review(ID, sid, v.v, 'approve'); }
  r = R(s);
  assert.equal(r.clips.approved, ids.length); assert.equal(r.stages.clipGeneration.status, 'done'); assert.equal(r.stages.clipApproval.status, 'done');
  // voice comes AFTER the silent animation: now approve the dialogue audio; lip sync + scene finals are what is left
  await approveAllAudio(s, ID);
  r = R(s);
  assert.ok(open(r, 'render').every((i) => ['SCENE_NOT_APPROVED', 'LIPSYNC_NOT_APPROVED'].includes(i.code)), 'only lip sync and the scene finals are left: ' + JSON.stringify(open(r, 'render').map((i) => i.code)));
  assert.ok(r.items.filter((i) => i.code === 'SCENE_NOT_APPROVED').every((i) => i.severity === 'pending' && i.action.panel === 'compose'));
  await approveAllScenes(s, ID);
  r = R(s);
  assert.equal(r.canRender, true, JSON.stringify(open(r, 'render').map((i) => i.code + ':' + i.message)));
  assert.equal(r.stages.render.status, 'ready');
});

test('non-content changes keep the approval: frame approval flag, timestamps, provenance, animation, B-roll, reference selection, reorder', { skip, timeout: 120000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  const rec = s.store.episodes.get(ID).approvals.storyboard;
  assert.equal(rec.v, 2); assert.deepEqual(Object.keys(rec.scenes), ids);
  const ok = () => assert.equal(s.episodeView(ID).derived.storyboardApproved, true);
  ok();
  await s.store.episodes.update(ID, (e) => { const si = e.scenes[0].startImage; si.createdAt = '2030-01-01T00:00:00Z'; si.approvedBy = 'someone-else'; si.provider = 'x'; si.prompt = 'new provenance text'; si.name = 'renamed'; }); ok();
  await s.approveStartFrame(ID, ids[1], false); ok(); // the frame's own flag is not content (the generation gate still requires it)
  assert.ok(s.renderReadiness.check(s.store.episodes.get(ID)).items.some((i) => i.code === 'START_IMAGE_NOT_APPROVED' && i.sceneId === ids[1] && i.severity === 'pending'));
  await s.approveStartFrame(ID, ids[1], true); ok();
  await s.sba.saveMotion(ID, ids[2], { beats: [{ characterId: s.store.episodes.get(ID).scenes[2].characters[0], t0: 0, t1: 1, emotion: 'proud', body: 'raises a hand', gaze: 'up', expression: 'grin' }], source: 'manual' }); ok();
  await s.sba.saveBroll(ID, { sceneId: ids[0], kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'insert' }); ok();
  const jr = s.store.characters.get('jack').references.slice(-1)[0];
  s.store.characters.setReferenceSelection('jack', [jr.id]); ok();
  await s.store.episodes.update(ID, (e) => { e.scenes.reverse(); }); ok();
  await s.store.episodes.update(ID, (e) => { e.scenes.reverse(); });
  assert.deepEqual(s.store.episodes.get(ID).scenes.map((x) => x.id), ids, 'scene order preserved');
});

test('material edits invalidate only the changed scene, name the field, and never silently re-approve; other scenes can still generate', { skip, timeout: 120000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  const [a, b, c] = ids;
  await s.store.episodes.update(ID, (e) => { e.scenes.find((x) => x.id === b).visual += ' (edited)'; });
  let sb = s.episodeView(ID).derived.storyboardApproval;
  assert.equal(s.episodeView(ID).derived.storyboardApproved, false);
  assert.deepEqual(sb.changedScenes, [b]); assert.deepEqual(sb.scenes[b].changed.map((x) => x.field), ['visual']);
  assert.match(sb.reasons[0], new RegExp(`${b}: 시각 연출이\\(가\\) 승인 후 바뀌었습니다`));
  assert.equal(sb.scenes[a].approved, true); assert.equal(sb.scenes[c].approved, true, 'unrelated scenes keep their approval');
  await decideAllGates(s, ID);
  const blockers = s.gen.estimate(ID, { sceneIds: ids }).blockers.filter((x) => /STORYBOARD/.test(x.code));
  assert.deepEqual(blockers.map((x) => x.code), ['STORYBOARD_SCENE_CHANGED']); assert.match(blockers[0].message, new RegExp(`^${b}: 시각 연출`));
  assert.equal(s.gen.estimate(ID, { sceneIds: [a] }).canAuthorize, true, 'an unchanged approved scene still generates');
  assert.equal(s.gen.estimate(ID, { sceneIds: [b] }).canAuthorize, false);
  const r = R(s);
  assert.ok(r.items.some((i) => i.code === 'STORYBOARD_SCENE_CHANGED' && i.severity === 'pending' && i.sceneId === b && i.cat === 'storyboard'), 'reported as its own storyboard step, not under "script"');
  assert.equal(r.items.filter((i) => i.cat === 'script').length, 0);
  // a different scene's image changes (a new file) → that scene only, field = start image
  await s.uploadStartFrame(ID, c, png(200), 'new.png');
  sb = s.episodeView(ID).derived.storyboardApproval;
  assert.deepEqual(sb.scenes[c].changed.map((x) => x.field), ['startImage']); assert.deepEqual(sb.changedScenes.sort(), [b, c].sort());
  // nothing approves it silently: only an explicit approval records the new content, then everything is approved again
  assert.equal(s.episodeView(ID).derived.storyboardApproved, false);
  await s.approveStartFrame(ID, c, true);
  assert.equal(s.episodeView(ID).derived.storyboardApproved, false, 'approving a frame does not approve the storyboard');
  await s.approveStoryboard(ID);
  assert.equal(s.episodeView(ID).derived.storyboardApproved, true);
  assert.equal(s.store.episodes.get(ID).scenes.find((x) => x.id === a).startImage.type, 'upload', 'approved assets were not erased');
});

test('approvals made before the per-scene record keep working, and are upgraded in place without changing anything else', { skip, timeout: 120000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  await s.store.episodes.update(ID, (e) => { e.approvals.storyboard = { hash: storyboardFingerprint(e), by: 'operator', at: '2026-01-01T00:00:00Z' }; });
  assert.equal(s.episodeView(ID).derived.storyboardApproved, true, 'legacy approval is still valid');
  assert.equal(s.episodeView(ID).derived.storyboardApproval.legacy, true);
  s.projects.migrateAll();
  const rec = s.store.episodes.get(ID).approvals.storyboard;
  assert.equal(rec.v, 2); assert.equal(rec.upgradedFrom, 'v1'); assert.equal(rec.by, 'operator'); assert.equal(rec.at, '2026-01-01T00:00:00Z');
  assert.equal(s.episodeView(ID).derived.storyboardApproved, true);
  assert.deepEqual(Object.keys(rec.scenes), ids);
  // a legacy approval that is already invalid is NOT revived by the upgrade
  await s.store.episodes.update(ID, (e) => { e.approvals.storyboard = { hash: 'stale', by: 'operator', at: 'x' }; });
  s.projects.migrateAll();
  assert.equal(s.store.episodes.get(ID).approvals.storyboard.v, undefined);
  assert.equal(s.episodeView(ID).derived.storyboardApproved, false);
});

test('existing approved clips are recognised after reload; a broken approval link is a real error; orphan clips are kept and reported', { skip, timeout: 240000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  await generateAndApprove(s, ids[0]);
  const v = s.store.episodes.get(ID).clips[ids[0]].versions.slice(-1)[0];
  await s.gen.review(ID, ids[0], v.v, 'approve');
  // "reload": a fresh studio on the same data directory
  const again = createStudio({ cfg: s.cfg, provider: createMockVideoProvider({ ffmpeg: s.cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }) });
  const r = again.renderReadiness.check(again.store.episodes.get(ID));
  assert.equal(r.scenes.find((x) => x.sceneId === ids[0]).clip, 'approved');
  assert.equal(r.clips.approved, 1); assert.equal(r.clips.none, ids.length - 1);
  assert.equal(again.episodeView(ID).derived.storyboardApproved, true, 'approvals survive the reload');
  // approval points at a version that is not there → a real (red) problem with the exact reason, nothing deleted
  await again.store.episodes.update(ID, (e) => { e.clips[ids[0]].approvedVersion = 99; });
  const b = again.renderReadiness.check(again.store.episodes.get(ID)).items.find((i) => i.code === 'CLIP_APPROVAL_BROKEN');
  assert.ok(b && b.severity === 'block' && /v99/.test(b.message) && b.sceneId === ids[0]);
  assert.equal(again.store.episodes.get(ID).clips[ids[0]].versions.length >= 1, true);
  // clips filed under a scene id that no longer exists
  await again.store.episodes.update(ID, (e) => { e.clips.GONE = { versions: [{ v: 1, file: 'x.mp4', status: 'pending_review' }], approvedVersion: null }; });
  assert.ok(again.renderReadiness.check(again.store.episodes.get(ID)).items.some((i) => i.code === 'ORPHAN_CLIPS' && i.severity === 'warn' && /GONE/.test(i.message)));
});

test('generation failures never retry automatically; no clip is ever approved by itself; existing clips are kept (new versions)', { skip, timeout: 240000 }, async () => {
  const { s, prov } = make();
  const ids = await upToStoryboard(s);
  const a = await authorize(s, [ids[0]]);
  await (await s.gen.run(ID, a.id)).done;
  const first = s.store.episodes.get(ID).clips[ids[0]];
  assert.equal(first.approvedVersion, null, 'a generated clip is never auto-approved');
  const calls = prov.calls.submit;
  const a2 = await authorize(s, [ids[0]]);
  await (await s.gen.run(ID, a2.id)).done; // regenerate: a new version (or a cache reuse), the old file stays
  const second = s.store.episodes.get(ID).clips[ids[0]];
  assert.ok(second.versions.length >= first.versions.length && second.versions[0].file === first.versions[0].file, 'the earlier clip is untouched');
  assert.ok(prov.calls.submit <= calls + 1);
  await assert.rejects(s.gen.run(ID, a2.id), (e) => e.code === 'AUTH_USED', 'an authorization is single-use: no silent retry');
});
