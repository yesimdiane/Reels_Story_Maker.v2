'use strict';
// Script Studio three-section editor in a real browser (mock data, no paid calls).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

test('three sections: roles, look, elements (add/duplicate), B-cut planning, shared beat timeline and SFX editor; saved to the canonical scene', { skip, timeout: 120000 }, async () => {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ssb-')) }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg });
  const ID = 'EP01';
  const ep0 = s.store.episodes.get(ID);
  const sid = ep0.scenes[1].id;
  const before = JSON.stringify(ep0.scenes.filter((x) => x.id !== sid));
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${ID}`);
    await page.waitForSelector('[data-scene-card]');
    const tab = page.locator(`[data-scene-tab="${sid}"], [data-sb-tab="${sid}"], button:has-text("${sid}")`).first();
    if (await page.locator(`[data-scene-card="${sid}"]`).count() === 0 && await tab.count()) await tab.click();
    await page.waitForSelector(`[data-scene-card="${sid}"]`);
    const card = page.locator(`[data-scene-card="${sid}"]`);
    const open = async (key) => { const d = card.locator(`details[data-section="${key}"]`); if (!(await d.evaluate((e) => e.open))) await d.locator(":scope > summary").click(); };
    // titles of the three sections
    assert.match(await card.locator('details[data-section="visual"] > summary').innerText(), /시각 연출/);
    assert.match(await card.locator('details[data-section="dialogue"] > summary').innerText(), /대사 · 자막 · 액션 · 효과음/);
    assert.match(await card.locator('details[data-section="advanced"] > summary').innerText(), /고급 설정/);
    assert.equal(await card.locator('details[data-section="acting"]').count(), 0, 'no separate duplicate acting section');
    // A: look + roles
    await open('visual');
    await card.locator('[data-look-field="background"]').fill('rainy doorway');
    const roleSel = card.locator('[data-role]');
    assert.ok(await roleSel.count() >= 2, 'cast roles come from the story cast');
    const visibleNow = s.store.episodes.get(ID).scenes.find((x) => x.id === sid).characters;
    const ref = ['jack', 'diane'].find((c) => !visibleNow.includes(c));
    await card.locator(`[data-role="${ref}"]`).selectOption('reference');
    // B-cut tab
    await card.locator('[data-vtab="bcut"]').click();
    await card.locator(`[data-bcut-add="${sid}"]`).click();
    await page.waitForSelector(`[data-bcut-planner="${sid}"] [data-bcut]`);
    await card.locator('[data-bcut-dup]').first().click();
    await page.waitForFunction((x) => document.querySelectorAll(`[data-bcut-planner="${x}"] [data-bcut]`).length === 2, sid);
    // B: elements
    await open('dialogue');
    await card.locator('[data-element-add="body"]').click();
    await card.locator('[data-element-text]').last().fill('Jack lifts the umbrella');
    await card.locator('[data-element-dup]').last().click();
    assert.equal(await card.locator('[data-elements="body"] [data-element]').count(), 2);
    assert.equal(await card.locator('[data-sfx-add-builtin]').count(), 1, 'the shared SFX editor is in section B');
    // C: shared timeline
    await open('advanced');
    assert.equal(await card.locator(`[data-motion-beats="${sid}"]`).count(), 1, 'the shared 0.5 s beat timeline');
    assert.ok(await card.locator('[data-cctv-hint]').count() === 1);
    // save → canonical data
    await card.locator(`[data-scene-save="${sid}"]`).first().click();
    await page.waitForFunction(() => /임시 저장|저장됨/.test(document.body.innerText));
    const sc = s.store.episodes.get(ID).scenes.find((x) => x.id === sid);
    assert.equal(sc.look.background, 'rainy doorway');
    assert.deepEqual(sc.referenceOnly, [ref]);
    assert.equal(sc.elements.filter((e) => e.type === 'body').length, 2);
    assert.equal(sc.action, 'Jack lifts the umbrella. Jack lifts the umbrella');
    assert.equal(s.store.episodes.get(ID).broll.filter((b) => b.sceneId === sid).length, 2);
    assert.equal(JSON.stringify(s.store.episodes.get(ID).scenes.filter((x) => x.id !== sid)), before, 'other scenes untouched');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
