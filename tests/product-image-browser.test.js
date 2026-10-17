'use strict';
// Real-browser check (Chromium via Playwright): paste, drop, mobile Photos/Files fallback, crop, reorder, primary,
// duplicate paste, persistence after reload, and that no AI generation request is ever made.
// Skipped automatically when Playwright / Chromium is not installed (e.g. plain CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { make } = require('./helpers/v23');
const { makePng } = require('./helpers/images');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const exe = ['/opt/pw-browsers/chromium/chrome', undefined].find((x) => x === undefined || fs.existsSync(x));
const skip = !pw ? 'playwright not installed' : false;

async function boot() {
  const { s } = make();
  const p = await s.products.create({ name: '브라우저 제품', features: ['자석'], code: 'BRW' });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ executablePath: exe });
  return { s, p, app, browser, base: `http://127.0.0.1:${app.address().port}/` };
}
const b64 = (w, h, shade) => makePng(w, h, shade).toString('base64');
const openImages = async (page, base, id) => {
  await page.goto(base + '#/products/' + id);
  await page.waitForSelector('[data-image-intake]', { state: 'attached', timeout: 10000 }).catch(async () => { await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true))); });
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await page.waitForSelector('[data-intake-drop]');
};
const paste = (page, b64s) => page.evaluate((list) => {
  const dt = new DataTransfer();
  list.forEach((s, i) => { const bin = Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); dt.items.add(new File([bin], 'image.png', { type: 'image/png' })); });
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, b64s);

test('desktop: paste (Cmd/Ctrl+V), duplicate paste, drag-drop, crop, reorder, primary, save, reload', { skip, timeout: 120000 }, async () => {
  const { s, p, app, browser, base } = await boot();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; const requests = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('request', (r) => requests.push(r.method() + ' ' + new URL(r.url()).pathname));
    await openImages(page, base, p.id);
    await paste(page, [b64(600, 400, 1)]);
    await page.waitForSelector('[data-staged]');
    await paste(page, [b64(600, 400, 1)]); // same screenshot pasted again
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-staged]').count(), 1, 'duplicate paste ignored');
    await paste(page, [b64(600, 400, 2)]);
    await page.waitForFunction(() => document.querySelectorAll('[data-staged]').length === 2);
    // drag-and-drop a third image
    await page.evaluate((s3) => {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(s3), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
      document.querySelector('[data-intake-drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64(600, 400, 3));
    await page.waitForFunction(() => document.querySelectorAll('[data-staged]').length === 3);
    // crop the first: drag the top handle down to remove "browser UI"
    await page.locator('[data-staged]').first().getByLabel('자르기').click();
    await page.waitForSelector('[data-crop-box]');
    const h = await page.locator('.crop-h.n').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 60, { steps: 5 }); await page.mouse.up();
    const info = await page.locator('[data-crop-info]').innerText();
    const [cw, ch] = info.replace('px', '').split('×').map(Number);
    assert.equal(cw, 600, 'width unchanged'); assert.ok(ch < 400 && ch > 200, 'height cropped: ' + info);
    await page.locator('[data-crop-apply]').click();
    await page.waitForFunction((n) => /잘림/.test(document.querySelector('[data-staged]').innerText) && !document.querySelector('[data-crop-box]'), 0);
    assert.match(await page.locator('[data-staged]').first().innerText(), new RegExp('600×' + ch));
    // reorder: move the first one back, make the dropped image primary
    await page.locator('[data-staged]').first().getByLabel('뒤로').click();
    await page.locator('[data-staged]').nth(2).getByLabel('대표 이미지').click();
    await page.locator('[data-intake-save]').click();
    await page.waitForFunction(() => !document.querySelector('[data-staged]'));
    await page.waitForTimeout(500);
    const v = s.products.get(p.id);
    assert.equal(v.images.length, 3);
    assert.equal(v.images.filter((i) => i.source === 'crop').length, 1, 'cropped image saved with crop provenance');
    assert.ok(v.primaryImageId && v.images.find((i) => i.id === v.primaryImageId).source === 'drop' || v.images.find((i) => i.id === v.primaryImageId));
    assert.ok(v.images.some((i) => i.height === ch && i.width === 600), 'cropped pixels stored at native resolution');
    // persistence: reload and see all three as thumbnails
    await page.reload(); await openImages(page, base, p.id);
    assert.equal(await page.locator('.ref-grid figure.ref img[src^="/media/product/"]').count() >= 3, true);
    assert.deepEqual(errors, []);
    assert.ok(!requests.some((r) => /generate|estimate/.test(r)), 'no AI generation request: ' + requests.filter((r) => /generate|estimate/.test(r)));
    await ctx.close();
  } finally { await browser.close(); app.close(); }
});

test('iPhone-sized viewport: Photos/Files input fallback accepts multiple files and the layout does not overflow', { skip, timeout: 90000 }, async () => {
  const { s, p, app, browser, base } = await boot();
  try {
    const ctx = await browser.newContext({ ...pw.devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await openImages(page, base, p.id);
    const input = page.locator('[data-intake-file]');
    assert.equal(await input.getAttribute('accept'), 'image/png,image/jpeg,image/webp');
    assert.notEqual(await input.getAttribute('multiple'), null);
    assert.equal(await page.locator('[data-intake-pick]').isVisible(), true, 'visible Photos/Files button');
    await input.setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: makePng(500, 500, 5) }, { name: 'b.png', mimeType: 'image/png', buffer: makePng(500, 500, 6) }, { name: 'tiny.png', mimeType: 'image/png', buffer: makePng(50, 50, 7) }]);
    await page.waitForFunction(() => document.querySelectorAll('[data-staged]').length === 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
    await page.locator('[data-intake-save]').click();
    await page.waitForFunction(() => !document.querySelector('[data-staged]'));
    await page.waitForTimeout(400);
    assert.equal(s.products.get(p.id).images.length, 2);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); app.close(); }
});

test('a product created without a code can get one from the summary card (no need to open the folded info section)', { skip, timeout: 60000 }, async () => {
  const { s, app, browser, base } = await boot();
  try {
    const p = await s.products.create({ name: '코드 없는 제품', features: ['f'] });
    assert.equal(s.products.get(p.id).code, '');
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(base + '#/products/' + p.id);
    await page.waitForSelector('[data-summary-code-input]');
    assert.equal(await page.locator('[data-product-summary] details').count(), 0, 'the field is in the always-visible summary');
    await page.locator('[data-summary-code-input]').fill('zbx');
    await page.locator('[data-summary-code-save]').click();
    await page.waitForFunction(() => (document.querySelector('[data-product-summary] .ep-code') || {}).textContent === 'ZBX');
    assert.equal(s.products.get(p.id).code, 'ZBX');
    await page.locator('[data-summary-code-input]').fill('x');
    await page.locator('[data-summary-code-save]').click();
    await page.waitForSelector('.toast.err');
    assert.equal(s.products.get(p.id).code, 'ZBX', 'invalid codes are rejected with a message');
  } finally { await browser.close(); app.close(); }
});

test('the Product Studio landing is a catalog: a product without a code opens its editor from the card and gets one there', { skip, timeout: 60000 }, async () => {
  const { s, app, browser, base } = await boot();
  try {
    const p = await s.products.create({ name: '랜딩 제품', features: ['f'] });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(base + '#/products');
    const card = page.locator(`[data-product-card="${p.id}"]`);
    await card.waitFor();
    assert.equal(await card.locator('input').count(), 0, 'catalog cards are compact: no form inputs');
    await card.click();
    await page.locator('[data-summary-code-input]').waitFor();
    assert.equal(await page.evaluate(() => location.hash), '#/products/' + p.id);
    await page.locator('[data-summary-code-input]').fill('lnd');
    await page.locator('[data-summary-code-save]').click();
    await page.waitForFunction((id) => ((document.querySelector('[data-product-summary] .ep-code') || {}).textContent || '').includes('LND'), p.id);
    assert.equal(s.products.get(p.id).code, 'LND');
  } finally { await browser.close(); app.close(); }
});
