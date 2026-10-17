'use strict';
// Real-browser check of the Storyboard video step (mock provider, no cost): readiness → jump to the scene's "영상 클립 생성 · 승인" section →
// free cost check → explicit confirmation → generation → preview → approve → readiness moves on. Also: no auto-approval, nothing paid without the click.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes, approveAllLipsync, decideAllGates } = require('./helpers/scene-flow');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const cfg0 = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-flowb-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfg0().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = !pw ? 'playwright not installed' : !hasFfmpeg ? 'ffmpeg not installed' : false;


test('storyboard: notice click → audio panel → generate/listen/approve → clip → compose with sound effect → scene approval → revoke', { skip, timeout: 300000 }, async () => {
  const cfg = cfg0();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 });
  const s = createStudio({ cfg, provider: prov });
  const ID = 'EP01';
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(300 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true, 'test'); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(400 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  const target = s.store.episodes.get(ID).lines[0].sceneId;
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    // dialogue audio lives in Voice Studio (after the silent animation)
    await page.goto(`http://127.0.0.1:${app.address().port}/#/voice/${ID}`);
    await page.waitForSelector('[data-voice-scenes]');
    await page.locator(`[data-voice-scene="${target}"] summary`).click();
    await page.waitForSelector(`[data-audio-panel="${target}"]`);
    assert.equal(await page.locator(`[data-audio-panel="${target}"]`).isVisible(), true);
    assert.equal(await page.locator(`[data-audio-approve="${target}"]`).isDisabled(), true, 'no audio yet → cannot approve');
    await page.locator(`[data-audio-generate="${target}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: '생성', exact: true }).click();
    await page.waitForSelector(`[data-audio-panel="${target}"] audio`);
    assert.ok(await page.locator(`[data-audio-panel="${target}"] audio`).count() >= 1, 'each line can be played');
    await page.locator(`[data-audio-approve="${target}"]`).click();
    await page.waitForSelector(`[data-audio-revoke="${target}"]`);
    assert.equal(s.sceneFlow.audioState(s.store.episodes.get(ID), target).state, 'approved');
    // revoke → approve again
    await page.waitForTimeout(800); // let the post-approve re-render settle
    await page.locator(`[data-audio-revoke="${target}"]`).click();
    await page.waitForSelector('[role=dialog]');
    await page.locator('[role=dialog]').getByRole('button', { name: /승인 취소/ }).click();
    await page.waitForSelector(`[data-audio-approve="${target}"]`);
    await page.locator(`[data-audio-approve="${target}"]`).click();
    await page.waitForSelector(`[data-audio-revoke="${target}"]`);
    // clip (API; the UI path for clips is covered by scene-clips-browser)
    await decideAllGates(s, ID);
    const est = s.gen.estimate(ID, { sceneIds: [target] });
    const a = await s.gen.authorize(ID, { sceneIds: [target], confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null });
    await (await s.gen.run(ID, a.id)).done;
    await s.gen.review(ID, target, 1, 'approve');
    await approveAllLipsync(s, ID); // dialogue scenes are assembled from their approved lip-synced video
    await page.goto(`http://127.0.0.1:${app.address().port}/#/image/${ID}`);
    await page.waitForSelector('[data-sb-tab]');
    await page.locator(`[data-sb-tab="${target}"]`).click();
    await page.waitForSelector(`[data-sb-stepper="${target}"]`);
    await page.locator(`[data-sb-stepper="${target}"] [data-step="compose"]`).click();
    await page.waitForSelector(`[data-compose-panel="${target}"]`);
    await page.locator(`[data-sfx-add-builtin="${target}"]`).click();
    await page.waitForSelector(`[data-sfx]`);
    await page.locator(`[data-compose="${target}"]`).click();
    await page.waitForSelector(`[data-scene-composite="${target}"]`, { timeout: 120000 });
    await page.locator(`[data-final-approve="${target}"]`).click();
    await page.waitForSelector(`[data-final-revoke="${target}"]`);
    assert.equal(s.sceneFlow.sceneState(s.store.episodes.get(ID), target).state, 'approved');
    await page.locator(`[data-final-revoke="${target}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /승인 취소/ }).click();
    await page.waitForSelector(`[data-final-approve="${target}"]`);
    assert.equal(s.sceneFlow.sceneState(s.store.episodes.get(ID), target).state, 'built');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
