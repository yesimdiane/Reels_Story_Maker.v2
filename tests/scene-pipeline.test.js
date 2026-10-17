'use strict';
// Per-scene production flow (mock voice + mock video, no paid calls):
//   image + B-cuts → audio (generate, listen, approve) → animation clip (needs approved audio) → scene composite with sound effects
//   → scene final approval → final render (only approved scenes). Every approval can be revoked; stale approvals name what changed.
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
const { createSfx } = require('../studio/lib/sfx');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-flow-'));
const cfgFor = () => loadConfig({ RF_STUDIO_DIR: tmp(), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = hasFfmpeg ? false : 'ffmpeg not installed';
const ID = 'EP01';
function make(extra = {}) { const cfg = cfgFor(); const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }); return { cfg, s: createStudio(Object.assign({ cfg, provider: prov }, extra)) }; }
const realRefs = (s) => ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(30 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true, 'test'); });
async function upToStoryboard(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  realRefs(s);
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(60 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  return ids;
}
const authorize = (s, sceneIds) => { const est = s.gen.estimate(ID, { sceneIds }); return s.gen.authorize(ID, { sceneIds, confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null }); };
async function clipFor(s, sid) { const a = await authorize(s, [sid]); await (await s.gen.run(ID, a.id)).done; const v = s.store.episodes.get(ID).clips[sid].versions.slice(-1)[0]; await s.gen.review(ID, sid, v.v, 'approve'); return v; }
const withLines = (s) => { const ep = s.store.episodes.get(ID); return ep.scenes.map((x) => x.id).filter((sid) => ep.lines.some((l) => l.sceneId === sid)); };

test('audio: per-scene generation, approval, stale detection, revoke; the silent animation does NOT wait for audio', { skip, timeout: 240000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  const talk = withLines(s);
  assert.ok(talk.length >= 2, 'the demo episode has dialogue');
  const sid = talk[0], other = talk[1];
  // before any audio: the silent animation is NOT blocked (voice, lip sync and SFX come after it)
  let est = s.gen.estimate(ID, { sceneIds: [sid] });
  assert.equal(est.canAuthorize, true, JSON.stringify(est.blockers));
  assert.ok(!est.blockers.some((b) => /AUDIO|SFX|LIPSYNC/.test(b.code)));
  const rd = s.renderReadiness.check(s.store.episodes.get(ID));
  assert.ok(!rd.items.some((i) => i.code === 'AUDIO_NOT_APPROVED' && i.stage === 'generate'));
  // a scene without dialogue never needs audio approval
  const silent = ids.find((x) => !talk.includes(x));
  if (silent) assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), silent).state, 'silent');
  // only this scene's lines are generated
  const e1 = s.voice.estimate(ID, { sceneIds: [sid] });
  assert.ok(e1.lines.length && e1.lines.every((l) => s.store.episodes.get(ID).lines.find((x) => x.id === l.lineId).sceneId === sid));
  await s.voice.synthesize(ID, { confirmChars: e1.billableChars, sceneIds: [sid] });
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'unapproved');
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), other).state, 'none');
  await assert.rejects(s.sceneFlow.approveAudio(ID, other), (e) => e.code === 'AUDIO_INCOMPLETE');
  await s.sceneFlow.approveAudio(ID, sid);
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'approved');
  est = s.gen.estimate(ID, { sceneIds: [sid] });
  assert.equal(est.canAuthorize, true, JSON.stringify(est.blockers));
  // revoke → back to "waiting for approval", audio files are kept; the animation gate is unaffected
  await s.sceneFlow.revokeAudio(ID, sid);
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'unapproved');
  assert.equal(s.gen.estimate(ID, { sceneIds: [sid] }).canAuthorize, true);
  await s.sceneFlow.approveAudio(ID, sid);
  // editing a line after approval → stale, never silently approved
  await s.store.episodes.update(ID, (e) => { const l = e.lines.find((x) => x.sceneId === sid); l.en += ' really'; });
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'none', 'changed text has no valid audio yet');
});

test('clip approval can be revoked without deleting the clip', { skip, timeout: 240000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  await approveAllAudio(s, ID);
  const v = await clipFor(s, ids[0]);
  assert.equal(s.store.episodes.get(ID).clips[ids[0]].approvedVersion, v.v);
  await s.gen.review(ID, ids[0], v.v, 'unapprove');
  const c = s.store.episodes.get(ID).clips[ids[0]];
  assert.equal(c.approvedVersion, null); assert.equal(c.versions.find((x) => x.v === v.v).status, 'pending_review');
  assert.ok(fs.existsSync(s.store.episodes.file(ID, c.versions[0].file)), 'the file is kept');
  await assert.rejects(s.gen.review(ID, ids[0], v.v, 'unapprove'), (e) => e.code === 'NOT_APPROVED');
});

test('scene composite, sound effects, scene final approval, stale detection and the final-render gate', { skip, timeout: 480000 }, async () => {
  const { s } = make();
  const ids = await upToStoryboard(s);
  await approveAllAudio(s, ID);
  for (const sid of ids) await clipFor(s, sid);
  let r = s.renderer.plan(ID);
  assert.ok(r.problems.some((p) => p.code === 'SCENE_NOT_APPROVED'), 'final render needs every scene approved');
  assert.equal(r.canRender, false);
  const [a] = ids;
  // composing needs approved parts; approval needs a composite
  await assert.rejects(s.sceneFlow.approveScene(ID, a), (e) => e.code === 'NO_COMPOSITE');
  // built-in sound effect, scene-relative
  await s.sfx.addBuiltin(ID, { name: 'whoosh', sceneId: a, offsetSec: 0.5 });
  await assert.rejects(s.sfx.addBuiltin(ID, { name: 'nope', sceneId: a }), (e) => e.code === 'BAD_SFX');
  await assert.rejects(s.sfx.addBuiltin(ID, { name: 'pop', sceneId: 'S99' }), (e) => e.code === 'NOT_FOUND');
  const st0 = await s.sceneFlow.buildComposite(ID, a);
  assert.equal(st0.state, 'built'); assert.ok(st0.composite.url.includes('/media/composite/'));
  const compFile = s.store.episodes.file(ID, st0.composite.file);
  assert.ok(fs.statSync(compFile).size > 1000);
  await s.sceneFlow.approveScene(ID, a);
  assert.equal(s.sceneFlow.sceneState(s.store.episodes.get(ID), a).state, 'approved');
  // adding another sound effect after approval → stale, and the changed part is named
  await s.sfx.addBuiltin(ID, { name: 'pop', sceneId: a, offsetSec: 1 });
  let st = s.sceneFlow.sceneState(s.store.episodes.get(ID), a);
  assert.equal(st.state, 'stale'); assert.deepEqual(st.changed, ['효과음']);
  assert.ok(s.sceneFlow.renderProblems(s.store.episodes.get(ID)).some((p) => p.sceneId === a && /효과음/.test(p.message)));
  // revoke keeps the composite file and records history
  await s.sceneFlow.revokeScene(ID, a);
  assert.ok(fs.existsSync(compFile));
  assert.equal(s.store.episodes.get(ID).sceneFinal[a].history.slice(-1)[0].action, 'revoked');
  // re-compose with the new effect, approve every scene, render
  await approveAllScenes(s, ID);
  r = s.renderer.plan(ID);
  assert.equal(r.canRender, true, JSON.stringify(r.problems));
  const out = await (await s.renderer.render(ID, { preview: true })).done;
  assert.ok(out.sceneHashes[a] && Object.keys(out.sceneHashes).length === ids.length, 'render records what each scene looked like');
  // a clip revoke makes the scene incomplete again and blocks the render
  const v = s.store.episodes.get(ID).clips[a].approvedVersion;
  await s.gen.review(ID, a, v, 'unapprove');
  st = s.sceneFlow.sceneState(s.store.episodes.get(ID), a);
  assert.equal(st.state, 'stale'); assert.ok(st.changed.includes('무음 애니메이션') || st.missing.includes('무음 애니메이션'));
  assert.equal(s.renderer.plan(ID).canRender, false);
});

test('readiness: every pending/blocking item is clickable (has an action to the exact scene and panel)', { skip, timeout: 240000 }, async () => {
  const { s } = make();
  await approveWithScenes(s, ID);
  const rd = s.renderReadiness.check(s.store.episodes.get(ID));
  const open = rd.items.filter((i) => i.severity === 'pending' || i.severity === 'block');
  assert.ok(open.length > 0);
  assert.deepEqual(open.filter((i) => !i.action).map((i) => i.code), [], 'no unclickable notice');
  assert.ok(open.filter((i) => i.sceneId).every((i) => (i.action.view === 'storyboard' || (i.action.view === 'animation' && /^CLIP_/.test(i.code)) || (i.action.view === 'voice' && /AUDIO/.test(i.code)) || (i.action.view === 'lipsync' && i.code === 'LIPSYNC_NOT_APPROVED')) && i.action.sceneId === i.sceneId));
  const nostory = open.find((i) => i.code === 'STORYBOARD_NOT_APPROVED');
  assert.equal(nostory.action.view, 'storyboard');
  await s.revokeStoryboard(ID);
  assert.equal(s.episodeView(ID).derived.storyboardApproved, false);
});

test('sound effects: upload checks, HeyGen catalog search is a search (not generation), downloads only what the search returned over https', async () => {
  const cfg = cfgFor();
  const s = createStudio({ cfg });
  const calls = [];
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)]);
  const fakeFetch = async (url, init) => {
    calls.push([String(url), init && init.headers]);
    if (String(url).startsWith('https://api.heygen.com/v3/audio/sounds')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'snd1', name: 'Door', audio_url: 'https://cdn.example.com/a/door.wav', duration: 1.2 }, { id: 'snd2', name: 'Plain http', audio_url: 'http://insecure.example.com/x.wav' }] }) };
    return { ok: true, status: 200, arrayBuffer: async () => wav };
  };
  const hasKey = createSfx({ store: s.store, cfg, fetchFn: fakeFetch, heygenKey: () => 'KEY' });
  const noKey = createSfx({ store: s.store, cfg, fetchFn: fakeFetch, heygenKey: () => '' });
  await assert.rejects(noKey.searchHeygen('door'), (e) => e.code === 'NOT_CONNECTED');
  await assert.rejects(hasKey.searchHeygen('x'), (e) => e.code === 'BAD_QUERY');
  const res = await hasKey.searchHeygen('door');
  assert.match(res.note, /생성하는 것이 아닙니다/);
  assert.equal(calls[0][1]['X-Api-Key'], 'KEY');
  assert.ok(calls[0][0].includes('type=sound_effects') && calls[0][0].includes('query=door'));
  assert.equal(res.results.length, 2);
  // an id that was not in a search result is refused (no client-supplied URL is ever fetched)
  await assert.rejects(hasKey.addHeygen(ID, { soundId: 'evil', sceneId: 'S1' }), (e) => e.code === 'SFX_NOT_FOUND');
  await assert.rejects(hasKey.addHeygen(ID, { soundId: 'snd2', sceneId: 'S1' }), (e) => e.code === 'BAD_URL');
  const sc = s.store.episodes.get(ID).scenes[0].id;
  const fx = await hasKey.addHeygen(ID, { soundId: 'snd1', sceneId: sc, offsetSec: 0.3 });
  assert.equal(fx.source, 'heygen'); assert.equal(fx.offsetSec, 0.3); assert.ok(fs.existsSync(s.store.episodes.file(ID, fx.file)));
  assert.ok(!JSON.stringify(s.store.episodes.get(ID)).includes('KEY'), 'the key is never stored in the episode');
  // uploads: type and size are checked, effects stay bound to their scene
  await assert.rejects(hasKey.addUpload(ID, { buffer: wav, filename: 'x.exe', sceneId: sc }), (e) => e.code === 'BAD_TYPE');
  await assert.rejects(hasKey.addUpload(ID, { buffer: Buffer.alloc(6 * 1024 * 1024), filename: 'x.wav', sceneId: sc }), (e) => e.code === 'TOO_LARGE');
  const up = await hasKey.addUpload(ID, { buffer: wav, filename: 'pop.wav', sceneId: sc, offsetSec: -5 });
  assert.equal(up.offsetSec, 0);
  const upd = await hasKey.update(ID, up.id, { gainDb: -99, offsetSec: 2 });
  assert.equal(upd.gainDb, -30); assert.equal(upd.offsetSec, 2);
  await hasKey.update(ID, up.id, { remove: true });
  assert.ok(!s.store.episodes.get(ID).sfx.some((x) => x.id === up.id));
});
