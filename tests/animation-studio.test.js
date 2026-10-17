'use strict';
// Animation Studio backend (mock MuAPI provider, no real calls): per-scene clip settings, operator models, status/freshness, B-roll clips,
// readiness, and the hand-off to the assembly (render) step.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio } = require('./helpers/scene-flow');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');

const cfgFor = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-anim-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = hasFfmpeg ? false : 'ffmpeg not installed';
const ID = 'EP01';
function make() { const cfg = cfgFor(); const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }); return { cfg, prov, s: createStudio({ cfg, provider: prov }) }; }
async function ready(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(30 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true, 'test'); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(60 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  await approveAllAudio(s, ID);
  return ids;
}
const authorize = (s, sceneIds, modelId) => { const est = s.gen.estimate(ID, { sceneIds, modelId }); return s.gen.authorize(ID, { sceneIds, modelId, confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null }); };

test('scene settings: model/duration/resolution are validated against the model and change only the estimate', { skip, timeout: 120000 }, async () => {
  const { s } = make();
  const ids = await ready(s);
  const sid = ids[0];
  const base = s.gen.estimate(ID, { sceneIds: [sid] });
  assert.ok(base.canAuthorize, JSON.stringify(base.blockers));
  const durs = s.store.models()[0].durations;
  await assert.rejects(s.saveAnimationSettings(ID, sid, { durationSec: 7 }), (e) => e.code === 'BAD_DURATION');
  await assert.rejects(s.saveAnimationSettings(ID, sid, { resolution: '4k' }), (e) => e.code === 'BAD_RESOLUTION', 'undeclared resolutions are refused');
  await s.saveAnimationSettings(ID, sid, { durationSec: Math.max(...durs) });
  assert.equal(s.gen.estimate(ID, { sceneIds: [sid] }).items[0].clipSec, Math.max(...durs));
  assert.equal(s.episodeView(ID).scenes.find((x) => x.id === sid).animationSettings.durationSec, Math.max(...durs));
  assert.ok(!('animationSettings' in s.store.episodes.get(ID).scenes.find((x) => x.id === sid)), 'the scene record itself is untouched');
  assert.equal(s.gen.estimate(ID, { sceneIds: [ids[1]] }).items[0].clipSec, base.items[0].clipSec === Math.max(...durs) ? base.items[0].clipSec : s.gen.estimate(ID, { sceneIds: [ids[1]] }).items[0].clipSec, 'other scenes keep their own setting');
  await s.saveAnimationSettings(ID, sid, { durationSec: null });
  assert.equal(s.gen.estimate(ID, { sceneIds: [sid] }).items[0].clipSec, base.items[0].clipSec);
});

test('operator-entered models use the same adapter, are marked user-entered, and cannot be removed while default', async () => {
  const { s } = make();
  assert.throws(() => s.addCustomModel({ id: 'Bad Id', endpoint: 'x', durations: [5] }), (e) => e.code === 'BAD_MODEL');
  assert.throws(() => s.addCustomModel({ id: 'm1', endpoint: '../evil', durations: [5] }), (e) => e.code === 'BAD_MODEL');
  assert.throws(() => s.addCustomModel({ id: 'm1', endpoint: 'ok/path', durations: [] }), (e) => e.code === 'BAD_MODEL');
  s.addCustomModel({ id: 'my-model', label: 'My model', endpoint: 'my-model', durations: [4, 8], resolutions: ['720p', '1080p'], supportsNegativePrompt: false, confirmed: true });
  const m = s.store.models().find((x) => x.id === 'my-model');
  assert.equal(m.verification, 'user-entered'); assert.equal(m.custom, true); assert.deepEqual(m.durations, [4, 8]); assert.deepEqual(m.resolutions, ['720p', '1080p']);
  await s.saveSettings({ defaultModelId: 'my-model' });
  assert.throws(() => s.removeCustomModel('my-model'), (e) => e.code === 'IN_USE');
  await s.saveSettings({ defaultModelId: 'kling-master' });
  s.removeCustomModel('my-model');
  assert.ok(!s.store.models().some((x) => x.id === 'my-model'));
  assert.throws(() => s.removeCustomModel('kling-master'), (e) => e.code === 'NOT_FOUND', 'built-in models cannot be removed');
});

test('MuAPI check is a free explicit call: mock mode answers locally without any network call', async () => {
  const { s, prov } = make();
  const r = await s.muapiCheck();
  assert.equal(r.mode, 'mock'); assert.equal(r.connected, false);
  assert.equal(prov.calls.submit, 0);
});

test('generate → completed → approved: version metadata, freshness, readiness and the hand-off; changing the image flags (not revokes) the clip', { skip, timeout: 240000 }, async () => {
  const { s, prov } = make();
  const ids = await ready(s);
  const sid = ids[0];
  assert.equal(prov.calls.submit, 0, 'nothing was generated while preparing');
  const a = await authorize(s, [sid]);
  await (await s.gen.run(ID, a.id)).done;
  assert.equal(prov.calls.submit, 1);
  let v = s.store.episodes.get(ID).clips[sid].versions[0];
  assert.ok(v.imageSha256 && v.modelId && v.clipSec && v.promptRev, 'the version records what it was made from: ' + JSON.stringify(Object.keys(v)));
  assert.equal(v.status, 'pending_review');
  let view = s.episodeView(ID).scenes.find((x) => x.id === sid);
  assert.equal(view.clips.versions[0].freshness.state, 'current');
  assert.match(view.animationPrompt, /./, 'the composed prompt (with the shared beats) is available read-only');
  await s.gen.review(ID, sid, 1, 'approve');
  // approved clip reaches the assembly step: readiness sees it, the render plan lists no missing clip for this scene
  const rd = s.renderReadiness.check(s.store.episodes.get(ID));
  assert.ok(!rd.items.some((i) => i.sceneId === sid && /^CLIP_/.test(i.code) && i.severity !== 'warn'));
  assert.ok(!s.renderer.plan(ID).problems.some((p) => p.code === 'CLIP_NOT_APPROVED' && p.message.startsWith(sid + ':')));
  // new start image → flagged stale, approval kept, other scenes untouched
  await s.uploadStartFrame(ID, sid, png(222), 'new.png');
  view = s.episodeView(ID).scenes.find((x) => x.id === sid);
  assert.equal(view.clips.versions[0].freshness.state, 'stale');
  assert.equal(s.store.episodes.get(ID).clips[sid].approvedVersion, 1, 'approval is not revoked silently');
  assert.ok(s.renderReadiness.check(s.store.episodes.get(ID)).items.some((i) => i.code === 'CLIP_STALE_IMAGE' && i.sceneId === sid && i.severity === 'warn'));
  assert.equal(s.episodeView(ID).scenes.find((x) => x.id === ids[1]).clips.versions.length, 0);
  // a second version never overwrites the approved one
  await s.approveStartFrame(ID, sid, true); await s.approveStoryboard(ID);
  const a2 = await authorize(s, [sid]);
  await (await s.gen.run(ID, a2.id)).done;
  const c = s.store.episodes.get(ID).clips[sid];
  assert.equal(c.versions.length, 2); assert.equal(c.approvedVersion, 1); assert.equal(c.versions[0].status, 'approved');
  assert.notEqual(c.versions[0].file, c.versions[1].file);
});

test('B-roll animation: only approved B-roll, explicit exact-amount confirmation, stored apart from scene clips, approve/unapprove', { skip, timeout: 240000 }, async () => {
  const { s, prov } = make();
  const ids = await ready(s);
  const sid = ids[0];
  const b = await s.sba.saveBroll(ID, { sceneId: sid, kind: 'broll', insertAtSec: 0, durationSec: 1, note: 'magnet snaps onto the door' });
  assert.equal(s.gen.estimateBroll(ID, b.id).canGenerate, false, 'proposed B-roll is not eligible');
  await s.sba.uploadBrollImage(ID, b.id, png(77), 'b.png');
  await s.sba.setBrollStatus(ID, b.id, 'approved');
  const est = s.gen.estimateBroll(ID, b.id);
  assert.equal(est.canGenerate, true, JSON.stringify(est.blockers));
  await assert.rejects(s.gen.generateBroll(ID, b.id, { confirmUsd: 999 }), (e) => e.code === 'CONFIRM_MISMATCH', 'the confirmed amount must match');
  assert.equal(prov.calls.submit, 0, 'nothing is submitted without the right confirmation');
  const r = await s.gen.generateBroll(ID, b.id, { confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null });
  await r.done;
  assert.equal(prov.calls.submit, 1);
  const bc = s.store.episodes.get(ID).brollClips[b.id];
  assert.equal(bc.versions.length, 1);
  assert.equal(s.store.episodes.get(ID).clips[sid], undefined, 'B-roll clips never enter the scene clip list');
  await s.gen.reviewBroll(ID, b.id, 1, 'approve');
  assert.equal(s.store.episodes.get(ID).brollClips[b.id].approvedVersion, 1);
  const card = s.episodeView(ID).scenes.find((x) => x.id === sid).broll.find((x) => x.id === b.id);
  assert.equal(card.clip.versions.length, 1); assert.match(card.clip.versions[0].url, /brollclip/);
  assert.equal(s.episodeView(ID).scenes.find((x) => x.id === sid).clips.versions.length, 0);
  await s.gen.reviewBroll(ID, b.id, 1, 'unapprove');
  assert.equal(s.store.episodes.get(ID).brollClips[b.id].approvedVersion, null);
});
