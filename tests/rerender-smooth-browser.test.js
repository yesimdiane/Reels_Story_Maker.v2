'use strict';
// A button action re-draws the view that is already on screen. That used to blank it: the "불러오는 중…" placeholder showed for a few frames,
// the page jumped to the top and every opened fold closed. Now the new view is built off-screen and swapped in once ready.
// Navigating to another view must still replace the old one at once (no stale page, nothing carried over).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { CONFIRM, setupProduct, visionRoute } = require('./helpers/product-analysis-fixtures');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

async function open(s, pid) {
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 700 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${app.address().port}`;
  await page.goto(`${base}/#/products/${pid}`);
  await page.waitForSelector('[data-product-summary]');
  await page.waitForFunction(() => !document.querySelector('#stage .boot'));
  return { app, browser, page, errors, base };
}

test('an action on the product page: no placeholder frame, scroll position and opened folds are kept', { skip, timeout: 120000 }, async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  const { app, browser, page, errors } = await open(s, pid);
  try {
    await page.evaluate(() => { document.querySelectorAll('details.fold').forEach((d) => { d.open = true; }); window.scrollTo(0, 400); });
    await page.waitForFunction(() => window.scrollY >= 390);
    const before = await page.evaluate(() => ({ open: document.querySelectorAll('details.fold[open]').length, total: document.querySelectorAll('details.fold').length }));
    assert.ok(before.total >= 2 && before.open === before.total, 'precondition: several folds are open');
    await page.evaluate(() => {
      window.__log = { frames: 0, boot: 0, empty: 0, minScroll: window.scrollY };
      const tick = () => { const L = window.__log; L.frames += 1; const st = document.getElementById('stage');
        if (!st || !st.children.length) L.empty += 1; if (document.querySelector('#stage .boot')) L.boot += 1; L.minScroll = Math.min(L.minScroll, window.scrollY);
        window.__raf = requestAnimationFrame(tick); };
      tick();
    });
    // click from script: a Playwright click would first scroll the (top-of-page) button into view and move the page itself
    await page.evaluate(() => document.querySelector('[data-summary-code-save]').click()); // act() -> refresh -> rerender
    await page.waitForTimeout(1200);
    const L = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return Object.assign({}, window.__log, { scroll: window.scrollY, open: document.querySelectorAll('details.fold[open]').length }); });
    assert.ok(L.frames > 20, 'frames were sampled during the action');
    assert.equal(L.boot, 0, 'the loading placeholder never showed');
    assert.equal(L.empty, 0, 'the stage was never empty');
    assert.ok(L.minScroll >= 390 && Math.abs(L.scroll - 400) <= 2, `scroll position kept (min ${L.minScroll}, end ${L.scroll})`);
    assert.equal(L.open, before.open, 'opened folds stayed open');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('navigating to another view still replaces the page at once and carries nothing over', { skip, timeout: 120000 }, async () => {
  const { s, pid } = await setupProduct();
  const { app, browser, page, base, errors } = await open(s, pid);
  try {
    await page.evaluate(() => { document.querySelectorAll('details.fold').forEach((d) => { d.open = true; }); window.scrollTo(0, 300); });
    await page.goto(`${base}/#/storylab/${pid}`);
    await page.waitForSelector('[data-gen-summary], [data-lab-card], .story-list, h1', { timeout: 15000 });
    assert.equal(await page.locator('[data-product-summary]').count(), 0, 'the product page is gone');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'a new view starts at the top');
    await page.goto(`${base}/#/products/${pid}`);
    await page.waitForSelector('[data-product-summary]');
    await page.waitForFunction(() => !document.querySelector('#stage .boot'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('details.fold[open]').length) < await page.evaluate(() => document.querySelectorAll('details.fold').length), true, 'folds opened on the earlier visit are not carried into a fresh visit');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
