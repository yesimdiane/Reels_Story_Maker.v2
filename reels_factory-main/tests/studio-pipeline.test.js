// Studio V2: gates, cost controls, caching, review/checksum, voice rules, render and publishing — all in MOCK mode.
'use strict';
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes } = require('./helpers/scene-flow');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createVideoProvider } = require('../studio/lib/providers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-studio-'));
const cfgFor = (env = {}) => loadConfig({ RF_STUDIO_DIR: tmp(), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1', ...env }, { dotenvFile: '/nonexistent' });
function make({ env, provider } = {}) {
  const cfg = cfgFor(env);
  const prov = provider || createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 });
  return { cfg, prov, s: createStudio({ cfg, provider: prov }) };
}
async function readyForGeneration(s) {
  await approveWithScenes(s, 'EP01');
  await approveAllAudio(s, 'EP01');
  await s.rebuildPrompts('EP01');
  await s.loadDemoReferences();
  await s.approveStoryboard('EP01');
}
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();

test('defaults to MOCK: a key alone, or a missing live flag, never enables paid calls', () => {
  assert.equal(cfgFor().muapiMode, 'mock');
  const withKey = cfgFor({ MUAPI_API_KEY: 'k-1' });
  assert.equal(withKey.muapiMode, 'mock');
  assert.equal(createVideoProvider(withKey).mode, 'mock');
  assert.throws(() => createVideoProvider(cfgFor({ RF_MUAPI_MODE: 'live' })), /MUAPI_API_KEY/, 'live without a key refuses to start');
  assert.equal(createVideoProvider(cfgFor({ RF_MUAPI_MODE: 'live', MUAPI_API_KEY: 'k-1' })).mode, 'live');
  assert.equal(cfgFor({ RF_MUAPI_MODE: 'yes' }).muapiMode, 'mock');
});

test('seed: Episode 01 matches the brief and characters follow the rules', () => {
  const { s } = make();
  const ep = s.episodeView('EP01');
  assert.equal(ep.title, '남편은 못 고쳐도, 현관은 고칠 수 있다.');
  assert.equal(ep.scenes.length, 8);
  assert.deepEqual(ep.lines.map((l) => l.speaker + ':' + l.en), ['diane:BABYYYY!!!!!! LOOK WHAT I GOT!!!', 'jack:Good job, baby!', "jack:But I'm still not gonna use it.", 'diane:BABE!!!']);
  assert.ok(ep.lines.every((l) => l.ko && l.ko !== l.en), 'Korean subtitles are stored separately');
  assert.equal(ep.cta.keyword, '우산');
  assert.ok(ep.derived.validation.ok, JSON.stringify(ep.derived.validation.errors));
  const jack = s.summary().characters.find((c) => c.id === 'jack');
  assert.equal(jack.voice.heygenVoiceId, '', 'identity ID must not be treated as a voice ID');
  assert.equal(jack.voiceStatus, 'identity-only');
});

test('script validation: Diane never says 오빠; unverified product claims are rejected; edits revoke approval', async () => {
  const { s } = make();
  await approveWithScenes(s, 'EP01');
  await approveAllAudio(s, 'EP01');
  assert.equal(s.episodeView('EP01').derived.scriptApproved, true);
  const lines = s.episodeView('EP01').lines.map((l) => ({ ...l }));
  lines[0].ko = '오빠 이것 봐!';
  await s.saveScript('EP01', { lines });
  const v = s.episodeView('EP01');
  assert.equal(v.derived.scriptApproved, false);
  assert.equal(v.derived.scriptChangedSinceApproval, true);
  assert.ok(v.derived.validation.errors.some((e) => e.code === 'FORBIDDEN_WORD'));
  await assert.rejects(approveWithScenes(s, 'EP01'), (e) => e.code === 'INVALID_SCRIPT');
  lines[0].ko = '자기야 이것 봐!';
  lines[1].en = 'This one is waterproof and super strong!';
  await s.saveScript('EP01', { lines });
  const bad = s.episodeView('EP01').derived.validation.errors;
  assert.ok(bad.some((e) => e.code === 'PRODUCT_CLAIM'), JSON.stringify(bad));
});

test('estimate is free and blocked until script + storyboard are approved and references are approved', async () => {
  const { s, prov } = make();
  let est = s.gen.estimate('EP01');
  assert.equal(est.canAuthorize, false);
  assert.ok(est.blockers.length > 0);
  await assert.rejects(s.gen.authorize('EP01', { confirmUnknown: true }), (e) => e.code === 'BLOCKED');
  assert.equal(prov.calls.submit, 0);
  await readyForGeneration(s);
  est = s.gen.estimate('EP01');
  assert.equal(est.canAuthorize, true, JSON.stringify(est.blockers));
  assert.equal(prov.calls.submit, 0, 'estimate must not call the provider');
});

test('authorization: needs explicit confirmation, is single-use per scene, and dies when the script/storyboard changes', async () => {
  const { s, prov } = make();
  await readyForGeneration(s);
  await assert.rejects(s.gen.authorize('EP01', {}), (e) => e.code === 'CONFIRM_REQUIRED');
  const a = await s.gen.authorize('EP01', { confirmUnknown: true, sceneIds: ['S1'] });
  await (await s.gen.run('EP01', a.id)).done;
  assert.equal(prov.calls.submit, 1);
  await assert.rejects(s.gen.run('EP01', a.id), (e) => e.code === 'AUTH_USED');
  assert.equal(prov.calls.submit, 1);
  // stale after an edit
  const a2 = await s.gen.authorize('EP01', { confirmUnknown: true, sceneIds: ['S2'] });
  const scenes = s.episodeView('EP01').scenes.map((x) => ({ id: x.id, visual: x.id === 'S2' ? x.visual + ' (edited)' : x.visual }));
  await s.saveScript('EP01', { scenes });
  await assert.rejects(s.gen.run('EP01', a2.id), (e) => ['AUTH_STALE', 'NOT_APPROVED'].includes(e.code));
  assert.equal(prov.calls.submit, 1, 'no billable call after approval was invalidated');
});

test('authorization expires after 30 minutes', async () => {
  const cfg = cfgFor();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg });
  const { createStore } = require('../studio/lib/store');
  const { createGenerationService } = require('../studio/lib/generation');
  let t = Date.now();
  const store = createStore({ dir: cfg.studioDir });
  const s = createStudio({ cfg, store, provider: prov });
  const gen = createGenerationService({ store, provider: prov, cfg, now: () => t });
  await readyForGeneration(s);
  const a = await gen.authorize('EP01', { confirmUnknown: true, sceneIds: ['S1'] });
  t += 31 * 60 * 1000;
  await assert.rejects(gen.run('EP01', a.id), (e) => e.code === 'AUTH_EXPIRED');
  assert.equal(prov.calls.submit, 0);
});

test('live mode: unknown price blocks; limit enforced; confirmed amount must match', async () => {
  const cfg = cfgFor();
  const { createStore } = require('../studio/lib/store');
  const store = createStore({ dir: cfg.studioDir });
  await readyForGeneration(createStudio({ cfg, store, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) })); // prepared in mock mode
  const prov = Object.assign(createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }), { mode: 'live', paid: true });
  const s = createStudio({ cfg, store, provider: prov });
  s.confirmModel('kling-master'); // live generation needs the operator's playground confirmation
  let est = s.gen.estimate('EP01');
  assert.ok(est.blockers.some((b) => b.code === 'ESTIMATE_UNKNOWN'));
  await assert.rejects(s.gen.authorize('EP01', { confirmUnknown: true }), (e) => e.code === 'BLOCKED');
  s.saveSettings({ modelEstimates: { 'kling-master': { usdByDuration: { 5: 1, 10: 2 } } } });
  assert.ok(s.gen.estimate('EP01').blockers.some((b) => b.code === 'PLACEHOLDER_IMAGE'), 'demo placeholders can never be sent to a paid provider');
  // an operator uploads and approves "real" references (same bytes here; the point is the placeholder flag)
  for (const c of s.summary().characters.filter((x) => x.references.length)) {
    const ph = c.references[0];
    const buf = fs.readFileSync(s.mediaFile('ref', c.id, ph.id));
    store.characters.removeReference(c.id, ph.id);
    store.characters.addReference(c.id, { buffer: buf, filename: 'real.png', mime: 'image/png', label: 'approved reference', isSheet: false });
    store.characters.setReferenceApproved(c.id, store.characters.get(c.id).references.slice(-1)[0].id, true);
  }
  await s.rebuildPrompts('EP01', undefined, { force: true });
  await s.approveStoryboard('EP01');
  s.saveSettings({ reelSpendLimitUsd: 5 });
  est = s.gen.estimate('EP01');
  assert.equal(est.totalUsd, 8);
  assert.ok(est.blockers.some((b) => b.code === 'OVER_LIMIT'));
  s.saveSettings({ reelSpendLimitUsd: 20 });
  est = s.gen.estimate('EP01');
  assert.equal(est.canAuthorize, true, JSON.stringify(est.blockers));
  await assert.rejects(s.gen.authorize('EP01', { confirmUsd: 1 }), (e) => e.code === 'CONFIRM_MISMATCH');
  const a = await s.gen.authorize('EP01', { confirmUsd: 8 });
  assert.equal(a.estimatedUsd, 8);
  assert.equal(prov.calls.submit, 0, 'authorizing is free');
  // a mock-mode authorization is not valid for live (and vice versa)
});

test('generation → review → cache reuse; failed jobs are never auto-retried', { skip: !hasFfmpeg }, async () => {
  const cfg = cfgFor();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1, failWhen: ({ prompt, phase }) => phase === 'generate' && /Scene S3 /.test(prompt) });
  const s = createStudio({ cfg, provider: prov });
  await readyForGeneration(s);
  const a = await s.gen.authorize('EP01', { confirmUnknown: true });
  const res = await (await s.gen.run('EP01', a.id)).done;
  assert.equal(prov.calls.submit, 8, 'exactly one submit per scene, no automatic retry of the failed one');
  const byScene = Object.fromEntries(res.map((r) => [r.sceneId, r.status]));
  assert.notEqual(byScene.S3, 'completed');
  assert.equal(s.episodeView('EP01').generation.jobs.filter((j) => j.sceneId === 'S3').map((j) => j.status).join(), 'failed');
  assert.equal(byScene.S1, 'completed');
  const ep = s.episodeView('EP01');
  assert.equal(ep.scenes.find((x) => x.id === 'S3').clips.versions.length, 0);
  const v = ep.scenes[0].clips.versions[0];
  assert.equal(v.status, 'pending_review', 'clips need explicit review');
  assert.ok(v.sha256 && v.requestId);
  // cached scenes are not billed again
  const est2 = s.gen.estimate('EP01');
  assert.equal(est2.items.filter((i) => i.cached).length, 7);
  const again = await s.gen.authorize('EP01', { confirmUsd: 0, sceneIds: ['S1'] });
  await (await s.gen.run('EP01', again.id)).done;
  assert.equal(prov.calls.submit, 8, 'a cached scene is reused without a second provider call');
  // approval records the checksum; tampering is caught
  await s.gen.review('EP01', 'S1', 1, 'approve');
  assert.equal(s.episodeView('EP01').scenes[0].clips.approvedVersion, 1);
  const clipFile = path.join(cfg.studioDir, 'episodes', 'EP01', 'clips', 'S1');
  const f = path.join(clipFile, 'v1.mp4');
  fs.appendFileSync(f, 'tamper');
  const f2 = path.join(cfg.studioDir, 'episodes', 'EP01', 'clips', 'S2', 'v1.mp4');
  fs.appendFileSync(f2, 'tamper');
  await assert.rejects(s.gen.review('EP01', 'S2', 1, 'approve'), (e) => e.code === 'CHECKSUM');
  const stored = JSON.stringify(s.episodeView('EP01'));
  assert.ok(!/MUAPI_API_KEY|x-api-key/i.test(stored));
});

test('voice: identity ID is not a voice ID; live mode needs a verified Voice ID and exact char confirmation', async () => {
  const { s } = make({ env: { RF_STUDIO_VOICE_MODE: 'live', HEYGEN_API_KEY: 'hg-test' } });
  await approveWithScenes(s, 'EP01');
  const est = s.voice.estimate('EP01');
  assert.equal(est.mode, 'live');
  assert.equal(est.canRun, false);
  assert.ok(est.blockers.some((b) => /Jack|잭/.test(b.message)), JSON.stringify(est.blockers));
  await assert.rejects(s.voice.synthesize('EP01', { confirmChars: est.billableChars }), (e) => e.code === 'BLOCKED');
  s.updateCharacter('jack', { voice: { heygenVoiceId: 'abc123' } });
  assert.equal(s.summary().characters.find((c) => c.id === 'jack').voiceStatus, 'unverified');
  assert.ok(s.voice.estimate('EP01').blockers.length > 0, 'unverified voices stay blocked');
});

test('end to end in mock mode: voices cached per character, render, final approval bound to checksum, publishing', { skip: !hasFfmpeg, timeout: 180000 }, async () => {
  const { s, cfg } = make();
  await readyForGeneration(s);
  const a = await s.gen.authorize('EP01', { confirmUnknown: true });
  await (await s.gen.run('EP01', a.id)).done;
  for (const sc of s.episodeView('EP01').scenes) await s.gen.review('EP01', sc.id, 1, 'approve');
  const r1 = await s.voice.synthesize('EP01');
  assert.equal(r1.results.length, 4);
  const again = s.voice.estimate('EP01');
  assert.equal(again.cachedLines, 4, 'second run would reuse every cached line');
  assert.equal(again.billableChars, 0);
  const dirs = fs.readdirSync(path.join(cfg.studioDir, 'cache', 'voice'));
  assert.ok(dirs.includes('jack') && dirs.includes('diane'), 'separate cache per character: ' + dirs);
  await approveAllScenes(s, 'EP01');
  const plan = s.renderer.plan('EP01');
  assert.ok(plan.canRender, JSON.stringify(plan.problems));
  assert.ok(plan.timeline.total > 30);
  await approveAllScenes(s, 'EP01');
  const rec = await (await s.renderer.render('EP01', { preview: true })).done;
  assert.equal(rec.width, 540);
  assert.equal(rec.height, 960);
  await assert.rejects(s.publishing.approve('EP01'), (e) => e.code === 'FINAL_NOT_APPROVED');
  await s.renderer.approveFinal('EP01', rec.v).catch((e) => assert.ok(e.code)); // previews cannot be approved as final
  assert.equal(s.episodeView('EP01').approvals.final, null, 'a preview render can not be the approved final');
  await approveAllScenes(s, 'EP01');
  const fin = await (await s.renderer.render('EP01', { preview: false })).done;
  assert.equal(fin.v, 2, 'renders are new versions, never overwrites');
  assert.equal(fin.height, 1920);
  await s.renderer.approveFinal('EP01', fin.v);
  const pub = await s.publishing.init('EP01');
  assert.ok(pub.caption.startsWith('[광고]'), 'disclosure is the first caption line');
  assert.ok(pub.caption.includes('우산'));
  assert.ok(!/방수|자동/.test(pub.caption), 'no unverified features in caption');
  await s.publishing.save('EP01', { affiliateUrl: 'https://evil.example.com/x' });
  await assert.rejects(s.publishing.approve('EP01'), (e) => e.code === 'INVALID');
  await s.publishing.save('EP01', { affiliateUrl: 'https://link.coupang.com/a/abc' });
  await s.publishing.approve('EP01');
  await assert.rejects(s.publishing.markPublished('EP01', 'https://www.instagram.com/reel/x'), (e) => e.code === 'NOT_READY');
  // editing a clip checksum after final approval invalidates the pipeline step
  assert.equal(s.episodeView('EP01').derived.steps.find((x) => x.key === 'render').state, 'done');
});
