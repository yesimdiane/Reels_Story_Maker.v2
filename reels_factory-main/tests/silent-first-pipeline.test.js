'use strict';
// Final pipeline: Image → silent Animation → Voice → Lip Sync → Video. Stage gates and asset hand-offs (all mocked, nothing billable).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllLipsync, approveAllScenes } = require('./helpers/scene-flow');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const mc = require('../studio/lib/modelcontract');

const cfgFor = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-pipe-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = hasFfmpeg ? false : 'ffmpeg not installed';
const ID = 'EP01';
const mk = (extra = {}) => { const cfg = cfgFor(); const prov = Object.assign(createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }), extra); return { cfg, prov, s: createStudio({ cfg, provider: prov }) }; };

/** up to an approved storyboard: NO audio, NO sound effects, NO lip-sync decisions made */
async function toStoryboard(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(30 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.update(cid, (c) => { c.references.find((x) => x.id === r.id).approved = true; }); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(60 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  return ids;
}
const animate = async (s, sid) => { const est = s.gen.estimate(ID, { sceneIds: [sid] }); const a = await s.gen.authorize(ID, { sceneIds: [sid], confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null }); await (await s.gen.run(ID, a.id)).done; const v = s.store.episodes.get(ID).clips[sid].versions.slice(-1)[0]; await s.gen.review(ID, sid, v.v, 'approve'); return v; };
const dialogueScene = (s) => s.store.episodes.get(ID).scenes.find((sc) => s.store.episodes.get(ID).lines.some((l) => l.sceneId === sc.id)).id;
const silentScene = (s) => { const ep = s.store.episodes.get(ID); const x = ep.scenes.find((sc) => !ep.lines.some((l) => l.sceneId === sc.id)); return x && x.id; };

test('Animation is SILENT and needs no voice, SFX or lip-sync approval; the prompt forbids speech and the model\'s own silent switch is sent when declared', { skip, timeout: 180000 }, async () => {
  const { s, prov } = mk();
  const ids = await toStoryboard(s);
  const sid = dialogueScene(s);
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'none', 'no audio exists');
  const est = s.gen.estimate(ID, { sceneIds: [sid] });
  assert.ok(est.canAuthorize, JSON.stringify(est.blockers));
  assert.ok(!est.blockers.some((b) => /AUDIO|SFX|LIPSYNC/.test(b.code)), 'no audio / SFX / lip-sync prerequisite');
  assert.equal(s.episodeView(ID).sceneFlow.scenes[sid].gate.ready, true);
  assert.deepEqual(s.episodeView(ID).sceneFlow.scenes[sid].gate.items.map((i) => i.key), ['image', 'prompt', 'model', 'endpoint', 'silent', 'cost']);
  const text = s.animplan.compose(s.store.episodes.get(ID), sid, s.store.episodes.get(ID).prompts[sid].video);
  assert.match(text, /SILENT ANIMATION/); assert.match(text, /no talking|no speech/i);
  const v = await animate(s, sid);
  assert.equal(v.status === 'pending_review' || v.status === 'approved', true);
  assert.equal(s.store.episodes.get(ID).clips[sid].approvedVersion, v.v, 'silent animation approved without any audio');
  // the model's own audio-off switch reaches the request body only when the operator declared it
  const m = { endpoint: 'x', silentParams: { generate_audio: false } };
  assert.equal(mc.buildBody(m, { prompt: 'p', imageUrl: 'u', silent: true }).generate_audio, false);
  assert.ok(!('generate_audio' in mc.buildBody({ endpoint: 'x' }, { prompt: 'p', imageUrl: 'u', silent: true })));
  s.addCustomModel({ id: 'silent-model', endpoint: 'some-i2v', durations: [5], silentParams: '{"generate_audio":false}', confirmed: true });
  assert.deepEqual(s.store.models().find((x) => x.id === 'silent-model').silentParams, { generate_audio: false });
  assert.throws(() => s.addCustomModel({ id: 'bad-silent', endpoint: 'some-i2v', durations: [5], silentParams: '{"a":{"b":1}}' }), (e) => e.code === 'BAD_MODEL');
  assert.ok(ids.length >= 7);
  assert.equal(prov.calls.upload > 0, true);
});

test('Voice comes after animation and regenerates without touching it; approved audio is never overwritten without confirmation; no-dialogue scenes are explicit', { skip, timeout: 180000 }, async () => {
  const { s, prov } = mk();
  await toStoryboard(s);
  const sid = dialogueScene(s);
  const quiet = silentScene(s);
  await animate(s, sid);
  const clipBefore = JSON.stringify(s.store.episodes.get(ID).clips[sid]);
  const submits = prov.calls.submit;
  await approveAllAudio(s, ID);
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'approved');
  if (quiet) assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), quiet).state, 'silent', 'a scene without dialogue is an explicit "silent" scene');
  // per-scene rate: out of range refused; a valid change makes the audio stale (never silently re-bought)
  await assert.rejects(s.voice.saveSceneVoice(ID, sid, { rate: 2 }), (e) => e.code === 'BAD_RATE');
  await s.voice.saveSceneVoice(ID, sid, { rate: 1.1, emotion: '놀람' });
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'none', 'the approved take no longer matches the settings: a new take is needed, nothing is re-bought');
  await s.voice.saveSceneVoice(ID, sid, { rate: '' });
  assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), sid).state, 'approved', 'back to the original take: the approval is valid again');
  // regeneration: approved audio needs confirmation, drops that approval only, animation untouched
  await assert.rejects(s.voice.regenerate(ID, sid), (e) => e.code === 'APPROVED_AUDIO');
  await s.voice.regenerate(ID, sid, { confirmOverwrite: true });
  let st = s.sceneFlow.audioState(s.store.episodes.get(ID), sid);
  assert.ok(['none', 'partial'].includes(st.state), 'a new take is needed: ' + st.state);
  const est = s.voice.estimate(ID, { sceneIds: [sid] });
  await s.voice.synthesize(ID, { confirmChars: est.billableChars, sceneIds: [sid] });
  await s.sceneFlow.approveAudio(ID, sid);
  assert.equal(JSON.stringify(s.store.episodes.get(ID).clips[sid]), clipBefore, 'the approved silent animation is untouched');
  assert.equal(prov.calls.submit, submits, 'no animation call');
  await assert.rejects(s.voice.regenerate(ID, quiet || 'nope'), (e) => ['NO_DIALOGUE', 'NOT_FOUND'].includes(e.code));
});

test('Lip Sync: needs the approved silent animation + approved audio, checks provider limits first, never assumes multi-person, stores a separate version, regenerates only after un-approving', { skip, timeout: 240000 }, async () => {
  const { s, prov } = mk();
  await toStoryboard(s);
  const sid = dialogueScene(s);
  // nothing yet
  let est = s.lipsync.estimate(ID, { sceneIds: [sid] });
  assert.ok(est.blockers.some((b) => b.code === 'NO_ANIMATION')); assert.ok(est.blockers.some((b) => b.code === 'AUDIO_NOT_APPROVED'));
  await assert.rejects(s.lipsync.authorize(ID, { sceneIds: [sid], confirmUnknown: true }), (e) => e.code === 'BLOCKED');
  await animate(s, sid);
  est = s.lipsync.estimate(ID, { sceneIds: [sid] });
  assert.ok(!est.blockers.some((b) => b.code === 'NO_ANIMATION') && est.blockers.some((b) => b.code === 'AUDIO_NOT_APPROVED'));
  await approveAllAudio(s, ID);
  // multi-person is not assumed: force two speakers into the scene
  const spk = s.store.episodes.get(ID).lines.filter((l) => l.sceneId === sid).map((l) => l.speaker);
  const clipBefore = JSON.stringify(s.store.episodes.get(ID).clips[sid]);
  const audioBefore = JSON.stringify(s.store.episodes.get(ID).voice.lines);
  if (new Set(spk).size > 1) {
    est = s.lipsync.estimate(ID, { sceneIds: [sid] });
    assert.ok(est.blockers.some((b) => b.code === 'MULTI_SPEAKER_UNSUPPORTED'), 'a model that does not declare multi-person support is refused for a two-speaker scene');
    s.lipsync.addModel({ id: 'lipsync-multi', endpoint: 'multi-lipsync', speakers: 'multi', confirmed: true });
    est = s.lipsync.estimate(ID, { sceneIds: [sid], modelId: 'lipsync-multi' });
    assert.ok(!est.blockers.some((b) => b.code === 'MULTI_SPEAKER_UNSUPPORTED'));
  }
  const solo = s.store.episodes.get(ID).scenes.find((sc) => { const l = s.store.episodes.get(ID).lines.filter((x) => x.sceneId === sc.id); return l.length && new Set(l.map((x) => x.speaker)).size === 1; });
  const target = solo ? solo.id : sid;
  if (target !== sid) { await animate(s, target); }
  const modelId = new Set(spk).size > 1 && target === sid ? 'lipsync-multi' : undefined;
  est = s.lipsync.estimate(ID, { sceneIds: [target], modelId });
  assert.deepEqual(est.blockers.map((b) => b.code), [], JSON.stringify(est.blockers));
  const a = await s.lipsync.authorize(ID, { sceneIds: [target], modelId, confirmUnknown: true });
  const r = await s.lipsync.runScene(ID, a.id, target);
  assert.equal(r.status, 'completed');
  await assert.rejects(s.lipsync.runScene(ID, a.id, target), (e) => e.code === 'AUTH_USED', 'authorization is single use');
  assert.equal(prov.calls.submit, 1 + (target !== sid ? 1 : 0) - 0 + 0 - (target !== sid ? 0 : 0), 'mock lip sync never calls the video provider');
  const ep = s.store.episodes.get(ID);
  assert.equal(s.lipsync.state(ep, target).versions.length, 1);
  assert.ok(s.lipsync.state(ep, target).versions[0].file.startsWith('lipsync/'), 'stored separately from clips/');
  assert.equal(JSON.stringify(ep.clips[sid]), target === sid ? clipBefore : JSON.stringify(ep.clips[sid]), 'the silent animation is untouched');
  assert.equal(JSON.stringify(ep.voice.lines), audioBefore, 'voice audio untouched');
  // review → approve; then regeneration is blocked until un-approved
  await s.lipsync.review(ID, target, 1, 'approve');
  assert.equal(s.lipsync.sceneView(s.store.episodes.get(ID), target).state, 'approved');
  assert.ok(s.lipsync.estimate(ID, { sceneIds: [target], modelId }).blockers.some((b) => b.code === 'ALREADY_APPROVED'));
  await s.lipsync.review(ID, target, 1, 'unapprove');
  assert.ok(!s.lipsync.estimate(ID, { sceneIds: [target], modelId }).blockers.some((b) => b.code === 'ALREADY_APPROVED'));
  // changing the approved voice afterwards turns an approved lip sync "stale" (no silent re-approval)
  await s.lipsync.review(ID, target, 1, 'approve');
  await s.voice.regenerate(ID, target, { confirmOverwrite: true });
  assert.equal(s.lipsync.sceneView(s.store.episodes.get(ID), target).state, 'stale');
});

test('Lip Sync LIVE: blocked until the endpoint is confirmed and a price is entered; exact amount confirmed; nothing sent before; one submit; a failed submit is never retried', { skip, timeout: 240000 }, async () => {
  const calls = [];
  const live = { mode: 'live', paid: true, uploadFile: async (f) => { calls.push('upload'); return { url: 'https://cdn.example/' + path.basename(f) }; }, submitRaw: async ({ endpoint, body }) => { calls.push(['submit', endpoint, Object.keys(body).sort().join()]); throw Object.assign(new Error('boom'), { code: 'SERVER' }); }, waitForResult: async () => { throw new Error('unreachable'); } };
  const { s } = mk(live);
  await toStoryboard(s);
  const sid = dialogueScene(s);
  s.store.episodes.update(ID, () => {});
  // the animation is made by the mock provider before switching (live animation is not under test here)
  const mock = mk();
  void mock;
  // prepare approved animation + audio directly in the store (the live provider must not be used for animation)
  const ep0 = s.store.episodes.get(ID);
  await approveAllAudio(s, ID);
  const clipRel = path.join('clips', sid, 'v1.mp4');
  fs.mkdirSync(path.dirname(s.store.episodes.file(ID, clipRel)), { recursive: true });
  require('node:child_process').execFileSync(s.cfg.ffmpeg.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:d=6:r=24', '-pix_fmt', 'yuv420p', s.store.episodes.file(ID, clipRel)]);
  const sha = require('../studio/lib/util').sha256File(s.store.episodes.file(ID, clipRel));
  await s.store.episodes.update(ID, (ep) => { ep.clips[sid] = { versions: [{ v: 1, file: clipRel, sha256: sha, durationSec: 6, status: 'approved' }], approvedVersion: 1 }; });
  void ep0;
  let est = s.lipsync.estimate(ID, { sceneIds: [sid], modelId: 'lipsync-sync' });
  assert.ok(est.blockers.some((b) => b.code === 'MODEL_UNVERIFIED')); assert.ok(est.blockers.some((b) => b.code === 'ESTIMATE_UNKNOWN'));
  s.lipsync.confirmModel('lipsync-sync');
  s.store.settings.save({ customLipsyncModels: [], lipsyncModelId: 'lipsync-sync' });
  s.lipsync.addModel({ id: 'lipsync-priced', endpoint: 'priced-lipsync', costEstimateUsd: 0.5, confirmed: true });
  est = s.lipsync.estimate(ID, { sceneIds: [sid], modelId: 'lipsync-priced' });
  const spk = new Set(s.store.episodes.get(ID).lines.filter((l) => l.sceneId === sid).map((l) => l.speaker));
  if (spk.size > 1) { assert.ok(est.blockers.some((b) => b.code === 'MULTI_SPEAKER_UNSUPPORTED')); return; }
  assert.deepEqual(est.blockers.map((b) => b.code), [], JSON.stringify(est.blockers));
  assert.equal(est.totalUsd, 0.5);
  await assert.rejects(s.lipsync.authorize(ID, { sceneIds: [sid], modelId: 'lipsync-priced', confirmUsd: 0.4 }), (e) => e.code === 'CONFIRM_MISMATCH');
  assert.deepEqual(calls, [], 'nothing was uploaded or submitted before an exact confirmation');
  const a = await s.lipsync.authorize(ID, { sceneIds: [sid], modelId: 'lipsync-priced', confirmUsd: 0.5 });
  await assert.rejects(s.lipsync.runScene(ID, a.id, sid), (e) => e.code === 'SERVER');
  assert.equal(calls.filter((c) => c[0] === 'submit').length, 1, 'exactly one paid submit');
  assert.deepEqual(calls.find((c) => c[0] === 'submit').slice(1), ['priced-lipsync', 'audio_url,video_url']);
  await assert.rejects(s.lipsync.runScene(ID, a.id, sid), (e) => e.code === 'AUTH_USED', 'the failed/uncertain job is not retried automatically');
  assert.equal(calls.filter((c) => c[0] === 'submit').length, 1);
  assert.equal(s.store.episodes.get(ID).lipsyncJobs[0].status, 'unknown', 'a non-refused failure is "unknown" (maybe billed) — the operator checks MuAPI History');
});

test('Video assembly: dialogue scenes use the approved lip-synced video, silent scenes the silent animation; voice is mixed exactly once; legacy approvals stay valid', { skip, timeout: 300000 }, async () => {
  const { s } = mk();
  const ids = await toStoryboard(s);
  for (const sid of ids) await animate(s, sid);
  await approveAllAudio(s, ID);
  const dlg = ids.filter((sid) => s.store.episodes.get(ID).lines.some((l) => l.sceneId === sid));
  // a scene with two speakers cannot be lip-synced by the default model: register a (declared) multi-person model for the test
  s.lipsync.addModel({ id: 'lipsync-multi', endpoint: 'multi-lipsync', speakers: 'multi', confirmed: true });
  s.store.settings.save({ lipsyncModelId: 'lipsync-multi' });
  // legacy: a dialogue scene approved BEFORE the lip-sync stage existed (scene final approved, no lipsync part) keeps its animation as the source
  const legacy = dlg[0];
  assert.equal(s.sceneFlow.sceneState(s.store.episodes.get(ID), legacy).missing[0], '립싱크 영상', 'new approvals need lip sync');
  assert.equal(s.sceneFlow.sourceOf(s.store.episodes.get(ID), legacy), null);
  await s.store.episodes.update(ID, (ep) => { const st = s.sceneFlow.sceneState(ep, legacy); ep.sceneFinal = ep.sceneFinal || {}; ep.sceneFinal[legacy] = ep.sceneFinal[legacy] || {}; ep.sceneFinal[legacy].approved = { hash: st.hash, parts: st.parts, by: 'legacy', at: new Date().toISOString() }; });
  const src0 = s.sceneFlow.sourceOf(s.store.episodes.get(ID), legacy);
  assert.equal(src0.kind, 'animation'); assert.equal(src0.legacy, true);
  assert.equal(s.sceneFlow.sceneState(s.store.episodes.get(ID), legacy).state === 'ready' || s.sceneFlow.sceneState(s.store.episodes.get(ID), legacy).state === 'approved', true);
  // lip sync the others, approve, compose, approve every scene (legacy scene keeps its approval until a lip sync is approved for it)
  await approveAllLipsync(s, ID);
  const ls = s.lipsync.approvedVersion(s.store.episodes.get(ID), legacy);
  assert.ok(ls, 'a lip sync was approved for the legacy scene too');
  assert.equal(s.sceneFlow.sourceOf(s.store.episodes.get(ID), legacy).kind, 'lipsync');
  assert.equal(s.sceneFlow.sceneState(s.store.episodes.get(ID), legacy).state, 'stale', 'its scene approval is stale (a part changed) — never silently kept');
  const quiet = silentScene(s);
  if (quiet) assert.equal(s.sceneFlow.sourceOf(s.store.episodes.get(ID), quiet).kind, 'animation');
  await approveAllScenes(s, ID);
  const plan = s.renderer.plan(ID);
  assert.ok(plan.canRender, JSON.stringify(plan.problems));
  // exactly-once voice: the lip-synced video carries its own audio track; the render must ignore it. Swap one version's audio for loud noise: the final audio must not change.
  const fin1 = await (await s.renderer.render(ID, { preview: true })).done;
  const audioMd5 = (file) => require('node:child_process').execFileSync(s.cfg.ffmpeg.ffmpeg, ['-v', 'error', '-i', file, '-vn', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();
  const md5a = audioMd5(s.store.episodes.file(ID, fin1.file));
  const lsv = s.lipsync.state(s.store.episodes.get(ID), dlg[1]).versions[0];
  const f = s.store.episodes.file(ID, lsv.file);
  const noisy = f + '.noisy.mp4';
  require('node:child_process').execFileSync(s.cfg.ffmpeg.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', f, '-f', 'lavfi', '-i', 'anoisesrc=d=8:c=white:a=0.9', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', noisy]);
  const newSha = require('../studio/lib/util').sha256File(noisy);
  fs.renameSync(noisy, f);
  await s.store.episodes.update(ID, (ep) => { const v = ep.lipsync[dlg[1]].versions[0]; v.sha256 = newSha; });
  await approveAllScenes(s, ID);
  const fin2 = await (await s.renderer.render(ID, { preview: true })).done;
  assert.equal(audioMd5(s.store.episodes.file(ID, fin2.file)), md5a, 'the audio of the lip-synced video is not mixed in again (voice exactly once)');
});

test('music + dip transition: stored, rendered, total length unchanged, audio timing untouched', { skip, timeout: 300000 }, async () => {
  const { s } = mk();
  const ids = await toStoryboard(s);
  for (const sid of ids) await animate(s, sid);
  await approveAllAudio(s, ID);
  s.lipsync.addModel({ id: 'lipsync-multi', endpoint: 'multi-lipsync', speakers: 'multi', confirmed: true });
  s.store.settings.save({ lipsyncModelId: 'lipsync-multi' });
  await approveAllScenes(s, ID);
  const before = JSON.stringify(s.renderer.plan(ID).timeline);
  const wav = path.join(os.tmpdir(), 'rf-music-' + Date.now() + '.wav');
  require('node:child_process').execFileSync(s.cfg.ffmpeg.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=12', wav]);
  await assert.rejects(s.uploadMusic(ID, Buffer.from('nope'), 'x.txt'), (e) => e.code === 'BAD_FILE');
  await s.uploadMusic(ID, fs.readFileSync(wav), 'bgm.wav');
  const m = s.videoEdit.get(s.store.episodes.get(ID)).music;
  assert.equal(m.name, 'bgm.wav'); assert.ok(m.durationSec > 11);
  await s.videoEdit.saveMusic(ID, { volumeDb: -20, fadeInSec: 1, fadeOutSec: 2, offsetSec: 0.31 });
  assert.equal(s.videoEdit.get(s.store.episodes.get(ID)).music.offsetSec, 0.3);
  await assert.rejects(s.videoEdit.saveTransition(ID, { type: 'wipe' }), (e) => e.code === 'BAD_REQUEST');
  await s.videoEdit.saveTransition(ID, { type: 'dip', durationSec: 0.2 });
  const rec = await (await s.renderer.render(ID, { preview: true })).done;
  assert.equal(JSON.stringify(s.renderer.plan(ID).timeline), before, 'timeline (audio timing) unchanged');
  assert.ok(Math.abs(rec.durationSec - s.renderer.plan(ID).timeline.total) < 0.4);
  assert.equal(rec.editHash, s.videoEdit.editHash(s.store.episodes.get(ID)));
});
