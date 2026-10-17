'use strict';
// Animation Studio in a real browser (mock MuAPI, no cost): navigation names, scene cards with statuses, two-column workspace, nothing paid on load or
// when switching scenes, settings saved per scene, explicit confirmation → generation → preview → approve → compare versions → unapprove.
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
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const cfg0 = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-animb-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfg0().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = !pw ? 'playwright not installed' : !hasFfmpeg ? 'ffmpeg not installed' : false;

test('Animation Studio: names, scene cards, workspace, explicit generation, approve, compare', { skip, timeout: 240000 }, async () => {
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
  await approveAllAudio(s, ID);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1700 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/animation/${ID}`);
    await page.waitForSelector('[data-animation-studio]');
    const rail = await page.locator('#rail').innerText();
    assert.match(rail, /영상 제작/); assert.doesNotMatch(rail, /애니메이션 스튜디오/, 'Animation is a Video Production tab, not a sidebar item');
    assert.deepEqual(await page.locator('[data-video-tabs] button').allTextContents(), ['1. 애니메이션', '2. 보이스', '3. 립싱크', '4. 편집']);
    // every scene has a card in story order with a status
    const cards = await page.locator('[data-anim-scene]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-anim-scene'), e.getAttribute('data-anim-status')]));
    assert.deepEqual(cards.map((c) => c[0]), ids);
    assert.ok(cards.every(([, st]) => ['ready', 'notready'].includes(st)), JSON.stringify(cards));
    // opening the page and switching scenes spend nothing
    await page.locator(`[data-anim-scene="${ids[1]}"]`).click();
    await page.waitForSelector(`[data-anim-workspace="${ids[1]}"]`);
    await page.locator(`[data-anim-scene="${ids[0]}"]`).click();
    await page.waitForSelector(`[data-anim-workspace="${ids[0]}"]`);
    assert.equal(prov.calls.submit, 0); assert.equal(prov.calls.upload, 0);
    // two columns: inputs left, preview right
    assert.equal(await page.locator('[data-anim-left] ').count(), 1); assert.equal(await page.locator('[data-anim-right]').count(), 1);
    assert.equal(await page.locator('[data-anim-endimage="unsupported"]').count(), 1, 'an undeclared capability is shown as unsupported, not faked');
    // per-scene settings persist
    const sid = ids[0];
    const durs = s.store.models()[0].durations;
    await page.locator(`[data-anim-duration="${sid}"]`).selectOption(String(Math.max(...durs)));
    await page.waitForFunction((x) => !!document.querySelector(`[data-anim-duration="${x}"]`) && document.querySelector(`[data-anim-duration="${x}"]`).value !== '', sid);
    assert.equal(s.store.episodes.get(ID).animation[sid].durationSec, Math.max(...durs));
    // free cost check, still nothing submitted
    await page.locator(`[data-anim-estimate="${sid}"]`).click();
    await page.waitForFunction((x) => /목업|예상 비용|캐시|추정치/.test(document.querySelector(`[data-anim-cost="${x}"]`).innerText), sid);
    assert.equal(prov.calls.submit, 0);
    // explicit confirmation → generation
    await page.locator(`[data-anim-generate="${sid}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /^시작/ }).click();
    await page.waitForSelector(`[data-anim-scene="${sid}"][data-anim-status="completed"]`, { timeout: 90000 });
    assert.equal(prov.calls.submit, 1, 'exactly one generation, started by the confirmation');
    assert.equal(await page.locator(`[data-anim-right] video`).count(), 1, 'the result can be previewed');
    assert.equal(s.store.episodes.get(ID).clips[sid].approvedVersion, null, 'never auto-approved');
    await page.locator(`[data-anim-approve="${sid}"]`).click();
    await page.waitForSelector(`[data-anim-scene="${sid}"][data-anim-status="approved"]`);
    // second version → compare
    await page.locator(`[data-anim-generate="${sid}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /^시작/ }).click();

    await page.waitForSelector(`[data-anim-version="2"]`, { timeout: 90000 });
    assert.equal(s.store.episodes.get(ID).clips[sid].approvedVersion, 1, 'the approved clip is never replaced');
    await page.locator(`[data-anim-compare-select="${sid}"]`).selectOption('2');
    await page.waitForSelector('[data-anim-compare]');
    assert.equal(await page.locator('[data-anim-compare] video').count(), 2);
    // unapprove keeps the file
    await page.locator('[data-anim-version="1"]').click();
    await page.locator(`[data-anim-unapprove="${sid}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /승인 취소/ }).click();
    await page.waitForFunction((x) => !document.querySelector(`[data-anim-unapprove="${x}"]`), sid);
    assert.equal(s.store.episodes.get(ID).clips[sid].approvedVersion, null);
    assert.ok(fs.existsSync(s.store.episodes.file(ID, s.store.episodes.get(ID).clips[sid].versions[0].file)));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
