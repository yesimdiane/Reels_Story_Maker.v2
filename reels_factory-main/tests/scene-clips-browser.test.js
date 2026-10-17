'use strict';
// Real-browser check of the Storyboard video step (mock provider, no cost): readiness → jump to the scene's "영상 클립 생성 · 승인" section →
// free cost check → explicit confirmation → generation → preview → approve → readiness moves on. Also: no auto-approval, nothing paid without the click.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio, approveAllScenes } = require('./helpers/scene-flow');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const cfg0 = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-clips-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfg0().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = !pw ? 'playwright not installed' : !hasFfmpeg ? 'ffmpeg not installed' : false;

test('storyboard readiness → Animation Studio scene → generate → preview → approve → readiness moves on (S1–S7+)', { skip, timeout: 240000 }, async () => {
  const cfg = cfg0();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 });
  const s = createStudio({ cfg, provider: prov });
  const ID = 'EP01';
  await approveWithScenes(s, ID);
  await approveAllAudio(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(300 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(400 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1500 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${ID}`);
    await page.waitForSelector('[data-render-readiness]');
    // the card: separate stages, missing clips are a neutral "next step" (not red), with a working jump per scene
    assert.equal(await page.locator('[data-stage="generate"]').getAttribute('data-stage-status'), 'ready');
    assert.equal(await page.locator('[data-ready-block]').count(), 0, 'no red errors');
    assert.ok(ids.length >= 7);
    const txt = await page.locator('[data-ready-pend="CLIP_NOT_GENERATED"]').innerText();
    assert.match(txt, /영상 클립 생성 대기 — 애니메이션 스튜디오에서 영상을 생성하거나 업로드하세요/); assert.match(txt, /S7/);
    assert.doesNotMatch(await page.locator('[data-render-readiness]').innerText(), /Animation Studio/);
    const target = ids[2];
    await page.locator(`[data-ready-go="CLIP_NOT_GENERATED"][data-ready-scene="${target}"]`).click();
    await page.waitForSelector(`[data-anim-workspace="${target}"]`);
    assert.equal(await page.locator(`[data-anim-workspace="${target}"]`).isVisible(), true, 'the readiness link opens that scene in Animation Studio (video generation lives there)');
    // free estimate; nothing is generated yet
    await page.locator(`[data-anim-estimate="${target}"]`).click();
    await page.waitForFunction((sid) => /목업|예상 비용|캐시|추정치/.test(document.querySelector(`[data-anim-cost="${sid}"]`).innerText), target);
    assert.equal(prov.calls.submit, 0, 'estimating is free');
    // explicit confirmation → generation (mock) → preview
    await page.locator(`[data-anim-generate="${target}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /^시작/ }).click();
    await page.waitForSelector(`[data-anim-scene="${target}"][data-anim-status="completed"]`, { timeout: 60000 });
    assert.equal(await page.locator(`[data-anim-right="${target}"] video`).count(), 1, 'the generated clip can be previewed');
    assert.equal(s.store.episodes.get(ID).clips[target].approvedVersion, null, 'never auto-approved');
    assert.equal(prov.calls.submit, 1, 'exactly one generation, started by the click');
    // approve → readiness moves on
    await page.locator(`[data-anim-approve="${target}"]`).click();
    await page.waitForSelector(`[data-anim-scene="${target}"][data-anim-status="approved"]`);
    assert.equal(s.store.episodes.get(ID).clips[target].approvedVersion, 1);
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${ID}`);
    await page.reload();
    await page.waitForSelector('[data-render-readiness]');
    const t2 = await page.locator('[data-ready-pend="CLIP_NOT_GENERATED"]').innerText();
    assert.doesNotMatch(t2, new RegExp(`\\b${target}\\b`), 'the approved scene is no longer waiting');
    assert.equal(await page.locator('[data-stage="clipGeneration"]').innerText().then((x) => x.includes(`${ids.length - 1}개`)), true);
    // the other scenes were not touched
    assert.ok(ids.filter((x) => x !== target).every((sid) => !(s.store.episodes.get(ID).clips[sid] || { versions: [] }).versions.length));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
