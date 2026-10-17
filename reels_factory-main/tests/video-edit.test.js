'use strict';
// Video Studio edit layer (mock providers, local FFmpeg only): subtitle edits never move approved audio, caption/mix settings reach the render,
// an edit after a render marks it outdated and blocks its final approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes } = require('./helpers/scene-flow');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { buildDialogueAss } = require('../studio/lib/render');

const cfgFor = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ve-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfgFor().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = hasFfmpeg ? false : 'ffmpeg not installed';
const ID = 'EP01';

async function ready(s) {
  await approveWithScenes(s, ID);
  await approveAllAudio(s, ID);
  await s.rebuildPrompts(ID);
  await s.loadDemoReferences();
  await s.approveStoryboard(ID);
}

test('subtitle edits change only the caption track: audio timeline is identical, shifts snap and clamp, hide/reset work, validation reports problems', { skip, timeout: 120000 }, async () => {
  const cfg = cfgFor();
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  await ready(s);
  const before = JSON.stringify(s.renderer.plan(ID).timeline);
  const lid = s.store.episodes.get(ID).lines[0].id;
  await s.videoEdit.saveSubtitle(ID, lid, { ko: '새 자막입니다', startShift: 0.31, endShift: 99, hidden: false });
  const sub = s.videoEdit.get(s.store.episodes.get(ID)).subtitles[lid];
  assert.equal(sub.ko, '새 자막입니다');
  assert.equal(sub.startShift, 0.3, 'snapped to the 0.05 s storage grid (UI steps by 0.3 s)');
  assert.equal(sub.endShift, 5, 'clamped');
  assert.equal(JSON.stringify(s.renderer.plan(ID).timeline), before, 'the approved audio timeline is untouched');
  const cue = s.renderer.plan(ID).cues.find((c) => c.lineId === lid);
  assert.equal(cue.ko, '새 자막입니다'); assert.ok(cue.start > cue.audioStart);
  await assert.rejects(s.videoEdit.saveSubtitle(ID, 'nope', { ko: 'x' }), (e) => e.code === 'NOT_FOUND');
  await s.videoEdit.saveSubtitle(ID, lid, { ko: '가'.repeat(80) });
  assert.ok(s.renderer.plan(ID).subtitleChecks.some((c) => c.code === 'SUBTITLE_LONG'));
  await s.videoEdit.saveSubtitle(ID, lid, { hidden: true });
  assert.ok(s.renderer.plan(ID).subtitleChecks.some((c) => c.code === 'SUBTITLE_HIDDEN'));
  await s.videoEdit.resetSubtitle(ID, lid);
  assert.equal(s.renderer.plan(ID).cues.find((c) => c.lineId === lid).edited, false);
  await assert.rejects(s.videoEdit.saveStyle(ID, { lang: 'fr' }), (e) => e.code === 'BAD_REQUEST');
  await s.videoEdit.saveStyle(ID, { yFrac: 5, fontSize: 500, lang: 'both' });
  const st = s.videoEdit.get(s.store.episodes.get(ID)).style;
  assert.deepEqual([st.yFrac, st.fontSize, st.lang], [0.9, 120, 'both']);
});

test('caption style reaches the ASS file: language, position, hidden cues, shifted window', () => {
  const tl = { total: 10, lines: [{ id: 'L1', speaker: 'jack', start: 1, end: 2, ko: '안녕', en: 'Hello' }], cta: { start: 10, end: 10, duration: 0, lines: [] } };
  const cue = (over) => Object.assign({ lineId: 'L1', speaker: 'jack', ko: '안녕', en: 'Hello', start: 1.3, end: 2.5, hidden: false }, over);
  const ass = (o) => buildDialogueAss(tl, Object.assign({ W: 1080, H: 1920, font: 'X', fontSize: 60, disclosure: '' }, o));
  const dflt = ass({});
  assert.match(dflt, /Dialogue: 2,0:00:01\.00,0:00:02\.15,Sub,,0,0,0,,\{\\pos\(540,1421\)/, 'default behaviour is unchanged');
  const edited = ass({ cues: [cue()], yFrac: 0.5, lang: 'both' });
  assert.match(edited, /0:00:01\.30,0:00:02\.50,Sub/); assert.match(edited, /\\pos\(540,960\)/); assert.match(edited, /안녕\\N\{\\fs42\}Hello/);
  assert.ok(!/Sub,,0,0,0,,/.test(ass({ cues: [cue({ hidden: true })] })), 'hidden cue is not drawn');
  assert.match(ass({ cues: [cue()], lang: 'en' }), /Hello/);
});

test('mix + edits flow into the final render; an edit after rendering makes that render outdated and unapprovable', { skip, timeout: 300000 }, async () => {
  const cfg = cfgFor();
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 }) });
  await ready(s);
  const a = await s.gen.authorize(ID, { confirmUnknown: true }).catch(async () => { const { decideAllGates } = require('./helpers/scene-flow'); await decideAllGates(s, ID); return s.gen.authorize(ID, { confirmUnknown: true }); });
  await (await s.gen.run(ID, a.id)).done;
  for (const sc of s.episodeView(ID).scenes) await s.gen.review(ID, sc.id, 1, 'approve');
  await approveAllScenes(s, ID);
  await s.videoEdit.saveMix(ID, { voiceDb: 3, sfxDb: -2 });
  await s.videoEdit.saveStyle(ID, { lang: 'en', yFrac: 0.6 });
  const rec = await (await s.renderer.render(ID, { preview: true })).done;
  assert.equal(rec.editHash, s.videoEdit.editHash(s.store.episodes.get(ID)));
  const fin = await (await s.renderer.render(ID, { preview: false })).done;
  assert.equal(s.episodeView(ID).renders.find((r) => r.v === fin.v).outdatedEdit, false);
  await s.videoEdit.saveSubtitle(ID, s.store.episodes.get(ID).lines[0].id, { ko: '렌더 뒤에 고침' });
  assert.equal(s.episodeView(ID).renders.find((r) => r.v === fin.v).outdatedEdit, true);
  await assert.rejects(s.renderer.approveFinal(ID, fin.v), (e) => e.code === 'STALE' && /자막/.test(e.message));
  const fin2 = await (await s.renderer.render(ID, { preview: false })).done;
  await s.renderer.approveFinal(ID, fin2.v);
  assert.equal(s.store.episodes.get(ID).approvals.final.v, fin2.v);
});

test('SFX fades and offsets are part of the scene hash: changing them invalidates the scene approval (never silently kept)', { skip, timeout: 120000 }, async () => {
  const cfg = cfgFor();
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  await ready(s);
  const sid = s.store.episodes.get(ID).scenes[0].id;
  await s.sfx.addBuiltin(ID, { name: 'pop', sceneId: sid, offsetSec: 0.3 });
  const fx = s.store.episodes.get(ID).sfx[0];
  const h0 = s.sceneFlow.sceneState(s.store.episodes.get(ID), sid).hash;
  await s.sfx.update(ID, fx.id, { fadeInSec: 0.2, fadeOutSec: 9 });
  const e2 = s.store.episodes.get(ID).sfx[0];
  assert.equal(e2.fadeInSec, 0.2); assert.equal(e2.fadeOutSec, 2, 'fade is capped');
  assert.notEqual(s.sceneFlow.sceneState(s.store.episodes.get(ID), sid).hash, h0);
});
