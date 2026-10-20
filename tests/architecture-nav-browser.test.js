'use strict';
// Studio navigation: exact workflow order, legacy routes, Character Library under Settings, AI task table video row.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { gotoReady } = require('./helpers/route-ready');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const ID = 'EP01';

async function withPage(fn) {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-nav-')) }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await fn({ page, base: `http://127.0.0.1:${app.address().port}`, s, errors });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
}

test('sidebar shows exactly six items in workflow order (no Script/Animation/Voice/Review/Publishing/Auto DM/Characters entries)', { skip, timeout: 120000 }, async () => {
  await withPage(async ({ page, base }) => {
    await page.goto(`${base}/#/products`);
    await page.waitForSelector('nav a.nav-item, #rail a.nav-item');
    const ko = await page.locator('#rail a.nav-item .ko').allTextContents();
    assert.deepEqual(ko, ['제품 스튜디오', '스토리 랩', '에피소드', '이미지 스튜디오', '영상 제작', '설정']);
    const en = await page.locator('#rail a.nav-item .en').allTextContents();
    assert.deepEqual(en, ['Product Studio', 'Story Lab', 'Episodes', 'Image Studio', 'Animation · Voice · Lip Sync · Editing', 'Settings']);
  });
});

test('every studio route renders without a console error', { skip, timeout: 180000 }, async () => {
  await withPage(async ({ page, base }) => {
    for (const v of ['products', 'storylab', 'episodes', 'script', 'image', 'animation', 'voice', 'lipsync', 'render', 'review', 'publishing', 'autodm', 'settings']) {
      await gotoReady(page, base, `${v}/${v === 'products' || v === 'storylab' || v === 'episodes' || v === 'settings' ? '' : ID}`);
      assert.equal(await page.locator('#stage .banner.err').count(), 0, v + ' rendered an error banner');
    }
  });
});

test('legacy #/storyboard keeps the episode id and lands on Image Studio; #/characters opens Settings → Character Library', { skip, timeout: 120000 }, async () => {
  await withPage(async ({ page, base }) => {
    await page.goto(`${base}/#/storyboard/${ID}`);
    await page.waitForSelector('#stage h1');
    assert.equal(await page.evaluate(() => location.hash), `#/image/${ID}`);
    assert.match(await page.locator('#rail a[aria-current=page]').innerText(), /이미지 스튜디오/);
    await page.goto(`${base}/#/characters`);
    await page.waitForSelector('[data-character-library]');
    assert.equal(await page.evaluate(() => location.hash), '#/settings/characters');
    assert.ok(await page.locator('[data-library-character]').count() >= 2, 'all characters are still manageable');
  });
});

test('Settings → AI 연동 task table has the animation video row with the registered MuAPI models; the default saves server-side', { skip, timeout: 120000 }, async () => {
  await withPage(async ({ page, base, s }) => {
    await page.goto(`${base}/#/settings/ai`);
    const row = page.locator('tr[data-ai-video-routing]');
    await row.waitFor();
    assert.match(await row.innerText(), /애니메이션 영상 생성/);
    assert.match(await row.innerText(), /muapi/);
    const opts = await row.locator('select[data-ai-video-model] option').allTextContents();
    assert.ok(opts.length >= 1);
    // it sits in the same table as the other task rows
    assert.ok(await page.locator('table:has(tr[data-ai-video-routing]) tr').count() >= 3);
    const pick = await row.locator('select[data-ai-video-model] option').last().getAttribute('value');
    await row.locator('select[data-ai-video-model]').selectOption(pick);
    await row.locator('[data-ai-video-save]').click();
    await page.waitForFunction(() => document.querySelector('tr[data-ai-video-routing]'));
    await page.waitForTimeout(500);
    assert.equal(s.store.settings.get().defaultModelId, pick);
  });
});

test('phone width: the AI task table stacks into cards, the animation video row is visible and its controls are usable', { skip, timeout: 120000 }, async () => {
  await withPage(async ({ page, base }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/#/settings/ai`);
    const row = page.locator('tr[data-ai-video-routing]');
    await row.waitFor();
    assert.match(await row.innerText(), /애니메이션 영상 생성/);
    const w = await row.locator('select[data-ai-video-model]').evaluate((e) => e.getBoundingClientRect().width);
    assert.ok(w > 220, 'model select is wide enough to read, was ' + w);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no sideways scroll');
  });
});

test('moving between the new studios in any order never breaks a view (shared UI state is initialised)', { skip, timeout: 180000 }, async () => {
  await withPage(async ({ page, base }) => {
    const order = ['voice', 'image', 'render', 'image', 'lipsync', 'animation', 'voice', 'image', 'render', 'script', 'lipsync', 'image'];
    for (const v of order) {
      await gotoReady(page, base, `${v}/${ID}`);
      assert.equal(await page.locator('#stage .banner.err').count(), 0, `${v} rendered an error banner after the previous studio`);
    }
  });
});
