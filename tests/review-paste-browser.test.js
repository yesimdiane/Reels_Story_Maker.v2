'use strict';
// Customer-review screenshots can be pasted (click the box, Cmd/Ctrl+V) or dropped. They are saved as REVIEW research,
// never as product images, and the page-wide paste handler (product images) must not also take them. Providers are faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const zlib = require('node:zlib');
const { setupProduct } = require('./helpers/product-analysis-fixtures');


// A real, browser-decodable PNG (solid colour, 120x120) — the screenshots in this test must survive the page's own image decoding.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
function png(seed, size = 120) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [seed % 256, (seed * 7) % 256, (seed * 13) % 256]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

// A real paste/drop event carrying an image File (the clipboard itself cannot be driven headless).
const fire = (page, selector, type, b64, name) => page.evaluate(([sel, t, data, nm]) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], nm, { type: 'image/png' }));
  const ev = t === 'paste' ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  document.querySelector(sel).dispatchEvent(ev);
}, [selector, type, b64, name]);

test('review screenshots: paste and drop into the review box save review images only; the product images are untouched', { skip, timeout: 120000 }, async () => {
  const { s, pid } = await setupProduct();
  const productImages = s.products.raw(pid).images.length;
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/products/${pid}`);
    await page.waitForSelector('[data-review-dropzone]', { state: 'attached' });
    await fire(page, '[data-review-dropzone]', 'paste', png(201).toString('base64'), 'image.png');
    await page.waitForFunction(() => /리뷰 캡처를 추가/.test(document.body.innerText));
    let raw = s.products.raw(pid);
    assert.equal(raw.reviewResearch.images.length, 1, 'the pasted screenshot is a review image');
    assert.equal(raw.images.length, productImages, 'and NOT a product image (page-wide paste handler stayed out of it)');
    assert.doesNotMatch(await page.locator('body').innerText(), /저장하면 올라갑니다/, 'and it was not also staged in the product image intake');
    await page.waitForSelector('[data-review-dropzone]', { state: 'attached' });
    await fire(page, '[data-review-dropzone]', 'drop', png(202).toString('base64'), 'drop.png');
    await page.waitForFunction(() => document.querySelectorAll('[data-review-dropzone]').length === 1);
    await new Promise((r) => setTimeout(r, 500));
    raw = s.products.raw(pid);
    assert.equal(raw.reviewResearch.images.length, 2, 'drop works too');
    assert.equal(raw.images.length, productImages);
    // sanity: the page-wide handler IS live, so the check above really proves the review box kept the paste to itself
    await page.evaluate(() => document.body.focus());
    await fire(page, 'body', 'paste', png(203).toString('base64'), 'image.png');
    await page.waitForFunction(() => /저장하면 올라갑니다/.test(document.body.innerText));
    assert.equal(s.products.raw(pid).reviewResearch.images.length, 2, 'a paste outside the review box does not become a review image');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
