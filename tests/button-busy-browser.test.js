'use strict';
// The two slow, paid buttons give feedback and cannot be double-fired: disabled + a progress label while the AI request runs, restored after
// a cancel or when the request is done. The slow AI is simulated by holding the HTTP request in the browser; nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { CONFIRM, setupProduct, visionRoute } = require('./helpers/product-analysis-fixtures');
const { routePaid, conceptsForPrompt } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

async function open(s, route) {
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.address().port}/#/${route}`);
  return { app, browser, page, errors };
}
/** Holds matching requests until release() is called. */
async function hold(page, pattern) {
  let release; const gate = new Promise((r) => { release = r; }); const seen = [];
  await page.route(pattern, async (route) => { seen.push(route.request().url()); await gate; await route.continue(); });
  return { release, seen };
}
const state = (btn) => btn.evaluate((b) => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy'), text: b.innerText.trim() }));

test('[스토리 컨셉 생성]: disabled with progress text while the paid request runs; cancel restores it; a second click cannot start another run', { skip, timeout: 150000 }, async () => {
  const { s, pid } = await setupProduct({ concepts: conceptsForPrompt });
  routePaid(s);
  const { app, browser, page, errors } = await open(s, `storylab/${pid}`);
  const dialog = page.locator('[role=dialog]');
  try {
    const btn = () => page.getByRole('button', { name: /스토리 컨셉 생성|비용 계산 중|비용 확인 중|스토리 생성 중/ });
    await btn().waitFor();
    if (!(await page.locator('.cat-opt.on').count())) await page.locator('.cat-opt').first().click();
    // cancel: the button comes back
    await btn().click();
    await dialog.waitFor();
    const during = await state(btn());
    assert.equal(during.disabled, true, 'disabled while the cost dialog is open'); assert.match(during.text, /비용 확인 중/);
    await dialog.getByRole('button', { name: /취소/ }).click();
    await page.waitForFunction(() => { const b = document.querySelector('[aria-busy]'); return !b; });
    const back = await state(btn());
    assert.equal(back.disabled, false); assert.match(back.text, /스토리 컨셉 생성/);
    // confirm, with the AI request held
    const held = await hold(page, '**/api/storylab/*/generate');
    await btn().click();
    await dialog.locator('input[type=checkbox]').check();
    await dialog.getByRole('button', { name: /^생성$/ }).click();
    await page.waitForFunction(() => /스토리 생성 중/.test(document.body.innerText));
    const busy = await state(btn());
    assert.equal(busy.disabled, true); assert.equal(busy.busy, 'true'); assert.match(busy.text, /스토리 생성 중/);
    await page.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (/스토리 생성 중/.test(b.innerText)) { b.click(); b.click(); } }); }); // double click while busy
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 0, 'no second cost dialog');
    assert.equal(held.seen.length, 1, 'exactly one generate request');
    held.release();
    await page.waitForSelector('[data-story]', { timeout: 30000 });
    const done = await state(btn());
    assert.equal(done.disabled, false); assert.match(done.text, /스토리 컨셉 생성/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('[비용 확인 후 분석하기]: disabled with progress text while the analysis runs, restored afterwards, no second run', { skip, timeout: 150000 }, async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  const { app, browser, page, errors } = await open(s, `products/${pid}`);
  const dialog = page.locator('[role=dialog]');
  try {
    const run = page.locator(`[data-analysis-run="${pid}"]`);
    await run.waitFor({ state: 'attached' });
    await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => { d.open = true; }));
    const held = await hold(page, '**/analysis/generate');
    await run.click();
    await dialog.waitFor();
    assert.equal((await state(run)).disabled, true, 'disabled while the cost dialog is open');
    await dialog.locator('input[type=checkbox]').check();
    await dialog.getByRole('button', { name: /분석하기/ }).last().click();
    await page.waitForFunction(() => /분석 중/.test(document.body.innerText));
    const busy = await state(run);
    assert.equal(busy.disabled, true); assert.equal(busy.busy, 'true'); assert.match(busy.text, /분석 중/);
    await run.evaluate((b) => { b.click(); b.click(); });
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 0, 'no second cost dialog');
    assert.equal(held.seen.length, 1, 'exactly one analysis request');
    held.release();
    await page.waitForSelector('[data-analysis-text="1"]', { timeout: 30000 });
    const done = await state(page.locator(`[data-analysis-run="${pid}"]`));
    assert.equal(done.disabled, false); assert.match(done.text, /새로 분석하기/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
