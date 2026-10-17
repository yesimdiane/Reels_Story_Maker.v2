'use strict';
// Video Studio: summary status, honest infrastructure report, cost gates, per-scene retries, B-roll overlay, output persistence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes } = require('./helpers/scene-flow');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createApp } = require('../studio/server');
const { png } = require('./helpers/v23');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-vs-'));
const cfgFor = (env = {}) => loadConfig({ RF_STUDIO_DIR: tmp(), RF_MASTER_KEY: 'test-master-key-for-unit-tests', RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1', ...env }, { dotenvFile: '/nonexistent' });
/** A real, decodable picture (the png() helper only makes a signature-sized stub). */
const realPng = (ffmpeg, color) => { const f = path.join(tmp(), 'c.png'); spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=96x96`, '-frames:v', '1', f]); return fs.readFileSync(f); };
const hasFfmpeg = (() => { try { return spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
function make({ env, failWhen } = {}) {
  const cfg = cfgFor(env);
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1, failWhen });
  return { cfg, prov, s: createStudio({ cfg, provider: prov }) };
}
async function ready(s) {
  await approveWithScenes(s, 'EP01');
  await approveAllAudio(s, 'EP01');
  await s.rebuildPrompts('EP01');
  await s.loadDemoReferences();
  await s.approveStoryboard('EP01');
}
const vs = (s) => s.episodeView('EP01').derived.videoStudio;

test('summary status: video / voice / B-roll / render / cost / next step — and nothing is started by reading it', async () => {
  const { s, prov } = make();
  let st = vs(s);
  assert.equal(st.clips.total, 8); assert.equal(st.clips.approved, 0); assert.deepEqual(st.clips.failed, []);
  assert.equal(st.voice.total, 4); assert.equal(st.voice.ready, 0);
  assert.equal(st.render.lastFinal, null); assert.equal(st.render.canRender, false);
  assert.equal(st.cost.mode, 'mock'); assert.match(st.cost.note, /요금이 없습니다/);
  assert.equal(st.next.key, 'storyboard', 'the first missing gate is named');
  assert.ok(st.compat && st.compat.items.length >= 4);
  await ready(s);
  st = vs(s);
  assert.equal(st.next.key, 'clips');
  assert.equal(prov.calls.submit, 0, 'reading the status never calls the provider');
});

test('infrastructure is reported honestly: what runs on this server, what needs an API key, what is manual', async () => {
  const mock = make();
  const infra = Object.fromEntries(vs(mock.s).infra.map((x) => [x.key, x]));
  assert.equal(infra.video.mode, 'mock'); assert.match(infra.video.runsOn, /목업/);
  assert.equal(infra.render.mode, 'local'); assert.match(infra.render.runsOn, /FFmpeg/);
  assert.equal(infra.flow.mode, 'manual'); assert.match(infra.flow.note, /API로 호출하지 않습니다/);
  assert.equal(infra.voice.available, true);
  // live voice requested without a HeyGen key → unavailable, not pretended
  const liveVoice = make({ env: { RF_STUDIO_VOICE_MODE: 'live' } });
  const v2 = vs(liveVoice.s);
  assert.equal(v2.voice.needsApi, true);
  assert.equal(v2.infra.find((x) => x.key === 'voice').available, false);
  assert.match(v2.infra.find((x) => x.key === 'voice').note, /API 키가 없습니다/);
  assert.ok(v2.unavailable.includes('voice'));
  // live video with a key: Muapi is an external API (not this server)
  const liveVideo = createStudio({ cfg: cfgFor({ RF_MUAPI_MODE: 'live', MUAPI_API_KEY: 'k-test' }) });
  const x = liveVideo.episodeView('EP01').derived.videoStudio.infra.find((i) => i.key === 'video');
  assert.equal(x.mode, 'live'); assert.match(x.runsOn, /Muapi/);
});

test('model compatibility is checked locally before any paid call; live mode blocks an incompatible model', async () => {
  const { s } = make();
  const scenes = s.store.episodes.get('EP01').scenes;
  const good = s.gen.compatibility({ id: 'm', endpoint: 'x', aspectRatios: ['9:16'], durations: [5, 10], mode: 'image-to-video', verification: 'docs-example' }, scenes);
  assert.equal(good.ok, true); assert.equal(good.verified, false); assert.match(good.note, /확인하세요/);
  const bad = s.gen.compatibility({ id: 'm', endpoint: '', aspectRatios: ['16:9'], durations: [1], mode: 'text-to-video', verification: 'verified' }, scenes);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.items.filter((i) => !i.ok).map((i) => i.code).sort(), ['ASPECT', 'DURATION', 'ENDPOINT', 'MODE']);
  assert.equal(bad.verified, true);
  assert.match(s.gen.estimate('EP01').compat.note, /공식 문서|실제 호출/);
});

test('paid generation stays behind approvals and an exact cost confirmation (authorizing is free)', async () => {
  const { s, prov } = make();
  await assert.rejects(s.gen.authorize('EP01', { confirmUnknown: true }), (e) => e.code === 'BLOCKED', 'storyboard not approved yet');
  await ready(s);
  await assert.rejects(s.gen.authorize('EP01', { confirmUsd: 999 }), (e) => ['CONFIRM_MISMATCH', 'CONFIRM_REQUIRED'].includes(e.code));
  const a = await s.gen.authorize('EP01', { confirmUnknown: true });
  assert.equal(prov.calls.submit, 0, 'authorization alone never submits');
  assert.equal(a.mode, 'mock');
  await assert.rejects(s.gen.run('EP01', 'nope'), (e) => e.code === 'NO_AUTH');
});

test('a failed scene retries on its own: other scenes keep their clips and jobs; uncertain (possibly billed) scenes are never retried automatically', { skip: !hasFfmpeg }, async () => {
  let failS3 = true;
  const { s, prov } = make({ failWhen: ({ prompt, phase }) => failS3 && phase === 'generate' && /Scene S3 /.test(prompt) });
  await ready(s);
  const a = await s.gen.authorize('EP01', { confirmUnknown: true });
  await (await s.gen.run('EP01', a.id)).done;
  let st = vs(s);
  assert.deepEqual(st.clips.failed.map((f) => f.sceneId), ['S3']);
  assert.ok(st.clips.failed[0].message, 'the error is shown to the operator');
  assert.deepEqual(st.clips.retryable, ['S3']);
  assert.equal(st.clips.generated, 7);
  assert.equal(prov.calls.submit, 8, 'no automatic retry');
  const before = JSON.stringify(s.episodeView('EP01').scenes.filter((x) => x.id !== 'S3').map((x) => x.clips.versions));
  const jobsBefore = s.episodeView('EP01').generation.jobs.filter((j) => j.sceneId !== 'S3').length;
  failS3 = false;
  const a2 = await s.gen.authorize('EP01', { confirmUnknown: true, sceneIds: ['S3'] });
  assert.deepEqual(a2.sceneIds, ['S3']);
  await (await s.gen.run('EP01', a2.id)).done;
  assert.equal(prov.calls.submit, 9, 'exactly one more provider call: only the failed scene');
  assert.equal(JSON.stringify(s.episodeView('EP01').scenes.filter((x) => x.id !== 'S3').map((x) => x.clips.versions)), before, 'successful scenes are untouched');
  assert.equal(s.episodeView('EP01').generation.jobs.filter((j) => j.sceneId !== 'S3').length, jobsBefore);
  assert.equal(s.episodeView('EP01').scenes.find((x) => x.id === 'S3').clips.versions.length, 1);
  assert.deepEqual(vs(s).clips.failed, []);
  // an uncertain job (the request may have been billed) is reported separately and is not offered as a retry
  await s.store.episodes.update('EP01', (ep) => { const j = ep.generation.jobs.filter((x) => x.sceneId === 'S5').slice(-1)[0]; j.status = 'uncertain'; j.error = { message: '응답을 받지 못했습니다' }; });
  st = vs(s);
  assert.deepEqual(st.clips.uncertain.map((u) => u.sceneId), ['S5']);
  assert.ok(!st.clips.retryable.includes('S5'));
});

async function throughVoiceAndClips(s) {
  await ready(s);
  const a = await s.gen.authorize('EP01', { confirmUnknown: true });
  await (await s.gen.run('EP01', a.id)).done;
  for (const sc of s.episodeView('EP01').scenes) await s.gen.review('EP01', sc.id, 1, 'approve');
  const est = s.voice.estimate('EP01');
  await s.voice.synthesize('EP01', { confirmChars: est.billableChars });
}

test('approved B-roll is layered over its scene in the render (real FFmpeg); edits make the render stale; a missing image blocks', { skip: !hasFfmpeg }, async () => {
  const { s, cfg } = make();
  await throughVoiceAndClips(s);
  await approveAllScenes(s, 'EP01');
  const plain = await (await s.renderer.render('EP01', { preview: true })).done;
  assert.equal(plain.cutsHash, '', 'no B-roll: the fingerprint is unchanged for older renders');
  // B-roll from an uploaded still image
  const b = await s.sba.saveBroll('EP01', { sceneId: 'S1', kind: 'broll', insertAtSec: 0.5, durationSec: 1, effect: 'cutaway' });
  await s.sba.uploadBrollImage('EP01', b.id, realPng(cfg.ffmpeg.ffmpeg, 'red'), 'cut.png');
  await s.sba.setBrollStatus('EP01', b.id, 'approved');
  assert.equal(vs(s).broll.approved, 1);
  await approveAllScenes(s, 'EP01');
  const withB = await (await s.renderer.render('EP01', { preview: true })).done;
  assert.ok(withB.cutsHash, 'the render records the B-roll in its fingerprint');
  const file = (v) => s.store.episodes.file('EP01', s.store.episodes.get('EP01').renders.find((r) => r.v === v).file);
  // similarity of the two renders at time t (PSNR in dB): high = same picture, low = different picture
  const psnr = (t) => { const r = spawnSync(cfg.ffmpeg.ffmpeg, ['-v', 'info', '-ss', String(t), '-i', file(plain.v), '-ss', String(t), '-i', file(withB.v), '-frames:v', '1', '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /average:([\d.]+|inf)/.exec(r.stderr); return m ? (m[1] === 'inf' ? 99 : Number(m[1])) : NaN; };
  assert.ok(psnr(1.0) < 25, 'inside the B-roll window the picture is clearly different (psnr ' + psnr(1.0) + ')');
  assert.ok(psnr(2.5) > 30, 'outside the window the scene is the same picture (psnr ' + psnr(2.5) + ')');
  assert.ok(Math.abs(withB.durationSec - plain.durationSec) < 0.2, 'the length never changes');
  // editing the approved B-roll sends it back to review → it is no longer layered, and the old final render is not "fresh"
  await s.sba.saveBroll('EP01', { id: b.id, durationSec: 0.5 });
  assert.equal(vs(s).broll.approved, 0);
  // an approved item whose image disappeared blocks the render instead of being skipped silently
  await s.sba.setBrollStatus('EP01', b.id, 'approved');
  fs.rmSync(s.mediaFile('broll', 'EP01', b.id));
  const plan = s.renderer.plan('EP01');
  assert.equal(plan.canRender, false);
  assert.ok(plan.problems.some((p) => p.code === 'BROLL_IMAGE_MISSING'));
  await assert.rejects(s.renderer.render('EP01', { preview: true }), (e) => e.code === 'BLOCKED');
});

test('outputs persist and download with the episode id in the filename; the summary offers them', { skip: !hasFfmpeg }, async () => {
  const { s, cfg } = make();
  await throughVoiceAndClips(s);
  await approveAllScenes(s, 'EP01');
  assert.equal(s.renderer.plan('EP01').canRender, true);
  const rec = await (await s.renderer.render('EP01', { preview: false })).done;
  const st = vs(s);
  assert.equal(st.render.lastFinal.v, rec.v);
  assert.match(st.render.lastFinal.downloadUrl, /\/media\/render\/EP01\/\d+\?download=1/);
  assert.ok(fs.existsSync(s.store.episodes.file('EP01', rec.file)), 'the file is on the volume');
  const s2 = createStudio({ cfg: loadConfig({ RF_STUDIO_DIR: cfg.studioDir, RF_MASTER_KEY: 'test-master-key-for-unit-tests', RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' }) });
  assert.equal(s2.episodeView('EP01').derived.videoStudio.render.lastFinal.v, rec.v, 'still there after a restart');
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const head = await new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path: st.render.lastFinal.downloadUrl, method: 'GET', headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1' } }, (res) => { res.resume(); res.on('end', () => resolve(res.headers)); }); r.on('error', reject); r.end(); });
  await new Promise((r) => app.close(r));
  assert.match(head['content-disposition'], /filename="EP01_v\d+\.mp4"/);
});

test('the Video Studio screen: summary on top, technical parts collapsed, retry per scene, cost-confirmed generation', () => {
  const root = path.join(__dirname, '..', 'studio', 'public', 'js', 'views');
  const sum = fs.readFileSync(path.join(root, 'video-summary.js'), 'utf8');
  const anim = fs.readFileSync(path.join(root, 'animation.js'), 'utf8');
  for (const k of ['data-video-summary', 'data-vs-player', 'data-vs-cost', 'data-vs-preview', 'data-vs-render', 'data-vs-download', 'data-vs-gen', 'data-vs-voice', 'data-retry', 'data-vs-infra']) assert.match(sum, new RegExp(k), k);
  assert.match(sum, /비용 확인/); assert.match(sum, /자동으로 다시 실행하지 않습니다/);
  for (const k of ['data-adv-prep', 'data-clip-review', 'data-job-history']) assert.match(anim, new RegExp(k), 'collapsed: ' + k);
  assert.match(anim, /startGeneration/); assert.match(anim, /estimate/);
});
