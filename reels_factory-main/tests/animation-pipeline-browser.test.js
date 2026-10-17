'use strict';
// Real-browser check: Storyboard shows the Rendering Readiness card with specific blockers, scene-specific beats in the animation panel,
// and "애니메이션 자동 생성" regenerates one scene (manual beats need an explicit replace confirmation).
const test = require('node:test');
const assert = require('node:assert/strict');
const { approveWithScenes } = require('./helpers/approve');
const { make, readyProduct } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

test('storyboard: readiness card + scene-specific animation + 애니메이션 자동 생성', { skip, timeout: 120000 }, async () => {
  const m = make();
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  await approveWithScenes(m.s, id);
  const sid = m.s.store.episodes.get(id).scenes[0].id;
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1200 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${id}`);
    await page.waitForSelector('[data-render-readiness]');
    const card = await page.locator('[data-render-readiness]').innerText();
    assert.match(card, /렌더링 준비 상태/); assert.match(card, /영상 생성/);
    assert.ok(await page.locator('[data-ready-pend="CLIP_NOT_GENERATED"]').count() >= 1, 'missing clips are a neutral next step');
    assert.equal(await page.locator('[data-ready-block="CLIP_NOT_GENERATED"]').count(), 0, 'and not a red error');
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.locator('[data-panel="motion"] summary').click();
    const rows = page.locator('[data-motion-beats] [data-beat]');
    assert.ok(await rows.count() >= 2, 'beats were created from the script');
    const body = await page.locator('[data-motion-beats]').innerText();
    assert.doesNotMatch(body, /holds the opening pose|settled/);
    // hand-edit one beat → generate asks for an explicit replace
    await m.s.sba.saveMotion(id, sid, { beats: [{ characterId: m.s.store.episodes.get(id).scenes[0].characters[0], t0: 0, t1: 1, emotion: 'proud', body: 'MY MANUAL BEAT', gaze: 'up', expression: 'grin' }], source: 'manual' });
    await page.reload();
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.locator('[data-panel="motion"] summary').click();
    await page.locator(`[data-motion-generate="${sid}"]`).click();
    await page.locator(`[data-anim-rules="${sid}"]`).click();
    await page.waitForTimeout(500);
    assert.equal(m.s.store.episodes.get(id).motion[sid].beats[0].body, 'MY MANUAL BEAT', 'not replaced without confirmation');
    await page.locator('[data-anim-replace]').check();
    await page.locator(`[data-anim-rules="${sid}"]`).click();
    await page.waitForFunction(([e, s]) => true, [id, sid]);
    await page.waitForTimeout(800);
    assert.equal(m.s.store.episodes.get(id).motion[sid].source, 'auto');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
