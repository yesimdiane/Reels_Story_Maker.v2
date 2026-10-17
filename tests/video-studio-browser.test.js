'use strict';
// Video Studio in a real browser (mock providers, local only): tabs, timeline tracks + item editing, subtitle editor + style + live preview,
// sound balance, pre-render checklist. Nothing is rendered or paid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio } = require('./helpers/scene-flow');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const cfg0 = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-vsb-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfg0().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = !pw ? 'playwright not installed' : !hasFfmpeg ? 'ffmpeg not installed' : false;
const ID = 'EP01';

test('Video Studio: five tabs, timeline tracks, SFX/subtitle editing at 0.3 s, style preview, mix, checklist; nothing paid or rendered', { skip, timeout: 240000 }, async () => {
  const cfg = cfg0();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg });
  const s = createStudio({ cfg, provider: prov });
  await approveWithScenes(s, ID);
  await approveAllAudio(s, ID);
  const sid = s.store.episodes.get(ID).scenes[0].id;
  await s.sfx.addBuiltin(ID, { name: 'pop', sceneId: sid, offsetSec: 0.3 });
  const fxId = s.store.episodes.get(ID).sfx[0].id;
  const lid = s.store.episodes.get(ID).lines[0].id;
  const timelineBefore = JSON.stringify(s.renderer.plan(ID).timeline);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 2000 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/render/${ID}`);
    await page.waitForSelector('[data-vs-tabs]');
    assert.deepEqual(await page.locator('[data-vs-tab]').evaluateAll((e) => e.map((x) => x.getAttribute('data-vs-tab'))), ['review', 'timeline', 'subtitles', 'sound', 'final']);
    await page.waitForSelector('[data-render-readiness]');
    // 1 review: every scene has a card
    await page.waitForSelector('[data-vs-review]');
    assert.equal(await page.locator('[data-vs-scene]').count(), s.store.episodes.get(ID).scenes.length);
    // 2 timeline: tracks present, music honestly absent
    await page.locator('[data-vs-tab="timeline"]').click();
    await page.waitForSelector('[data-vs-timeline]');
    const tracks = await page.locator('[data-vs-track]').allTextContents();
    assert.deepEqual(tracks, ['장면', '음성', '효과음', 'B-roll', '자막']);
    assert.match(await page.locator('[data-vs-music]').innerText(), /없음/);
    await page.locator(`[data-vs-item="sfx:${fxId}"]`).click();
    await page.waitForSelector(`[data-vs-sfx-offset="${fxId}"]`);
    await page.locator(`[data-vs-sfx-offset="${fxId}"]`).fill('0.9');
    await page.locator(`[data-vs-sfx-offset="${fxId}"]`).blur();
    await page.waitForTimeout(700);
    assert.equal(s.store.episodes.get(ID).sfx[0].offsetSec, 0.9);
    await page.locator(`[data-vs-item="line:${lid}"]`).click();
    await page.waitForSelector('[data-vs-editor="line"]');
    assert.match(await page.locator('[data-vs-editor="line"]').innerText(), /음성 파일은 그대로 유지/);
    // 3 subtitles: edit text, shift, hide, style preview
    await page.locator('[data-vs-tab="subtitles"]').click();
    await page.waitForSelector(`[data-vs-cue="${lid}"]`);
    await page.locator(`[data-vs-cue-ko="${lid}"]`).fill('브라우저에서 고친 자막');
    await page.locator(`[data-vs-cue-save="${lid}"]`).click();
    await page.waitForTimeout(700);
    assert.equal(s.videoEdit.get(s.store.episodes.get(ID)).subtitles[lid].ko, '브라우저에서 고친 자막');
    await page.locator(`[data-vs-cue-start="${lid}"]`).fill('0.3');
    await page.locator(`[data-vs-cue-start="${lid}"]`).blur();
    await page.waitForTimeout(700);
    assert.equal(s.videoEdit.get(s.store.episodes.get(ID)).subtitles[lid].startShift, 0.3);
    await page.locator('[data-vs-lang="en"]').click();
    await page.waitForTimeout(700);
    await page.locator('[data-vs-ypos]').fill('50');
    await page.locator('[data-vs-ypos]').blur();
    await page.waitForTimeout(700);
    assert.equal(s.videoEdit.get(s.store.episodes.get(ID)).style.lang, 'en');
    assert.equal(s.videoEdit.get(s.store.episodes.get(ID)).style.yFrac, 0.5);
    assert.match(await page.locator('[data-vs-caption]').getAttribute('style'), /top:50%/);
    // 4 sound
    await page.locator('[data-vs-tab="sound"]').click();
    await page.waitForSelector('[data-vs-sound]');
    await page.locator('[data-vs-mix-voice]').fill('2');
    await page.locator('[data-vs-mix-voice]').blur();
    await page.waitForTimeout(700);
    assert.equal(s.videoEdit.get(s.store.episodes.get(ID)).mix.voiceDb, 2);
    assert.equal(await page.locator('[data-vs-sfx-row]').count(), 1);
    // 5 final: checklist is incomplete (scenes not approved) and nothing was rendered
    await page.locator('[data-vs-tab="final"]').click();
    await page.waitForSelector('[data-vs-checklist]');
    assert.equal(await page.locator('[data-vs-checklist]').getAttribute('data-vs-ready'), '0');
    assert.equal(await page.locator('[data-vs-check="scenes"]').getAttribute('data-vs-check-ok'), '0');
    assert.equal(await page.locator('[data-vs-check="paid"]').getAttribute('data-vs-check-ok'), '1');
    assert.equal(s.store.episodes.get(ID).renders.length, 0, 'viewing and editing never renders');
    assert.equal(JSON.stringify(s.renderer.plan(ID).timeline), timelineBefore, 'approved audio timing untouched by all edits');
    assert.equal(prov.calls.submit, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
