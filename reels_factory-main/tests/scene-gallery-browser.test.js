'use strict';
// Storyboard gallery (real browser, mock data, no provider calls): story-ordered 9:16 thumbnails, approval states, +N B-cut count,
// click opens the scene, full-size preview, side-by-side comparison; an approved scene collapses its image/prompt editor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { approveWithScenes } = require('./helpers/approve');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function realPng(seed) { const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(9, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc(16 * (1 + 27)); for (let y = 0; y < 16; y++) for (let x = 0; x < 9; x++) { raw[y * 28 + 1 + x * 3] = (seed * 40) % 255; raw[y * 28 + 2 + x * 3] = 120; raw[y * 28 + 3 + x * 3] = 160; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }

test('gallery: order, states, B-cut count, open scene, full-size preview, comparison; approved scene collapses', { skip, timeout: 120000 }, async () => {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-gal-')) }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg });
  const ID = 'EP01';
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) if (i < 3) { await s.uploadStartFrame(ID, sid, realPng(i + 1), `scene-${sid}.png`); if (i < 2) await s.approveStartFrame(ID, sid, true); }
  await s.sba.saveBroll(ID, { sceneId: ids[0], kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'insert' });
  await s.sba.saveBroll(ID, { sceneId: ids[0], kind: 'broll', insertAtSec: 1, durationSec: 1, effect: 'insert' });
  const before = JSON.stringify(s.store.episodes.get(ID).scenes.map((x) => x.startImage));
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${ID}`);
    await page.waitForSelector('[data-scene-gallery]');
    const order = await page.locator('[data-gallery-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-gallery-item')));
    assert.deepEqual(order, ids, 'story order');
    assert.equal(await page.locator(`[data-gallery-item="${ids[0]}"]`).getAttribute('data-gallery-state'), 'approved');
    assert.equal(await page.locator(`[data-gallery-item="${ids[2]}"]`).getAttribute('data-gallery-state'), 'unapproved');
    assert.equal(await page.locator(`[data-gallery-item="${ids[4]}"]`).getAttribute('data-gallery-state'), 'missing', 'missing images are highlighted, not hidden');
    assert.equal(await page.locator(`[data-gallery-bcuts="${ids[0]}"]`).innerText(), '+2');
    assert.equal(await page.locator('[data-gallery-bcuts]').count(), 1, 'B-cut images are not listed in the gallery, only counted');
    // approved scene → compact summary, image/prompt editor hidden; reopen shows it
    await page.locator(`[data-gallery-open="${ids[0]}"]`).click();
    await page.waitForSelector(`[data-sb-approved-summary="${ids[0]}"]`);
    assert.equal(await page.locator('[data-panel="look"]').count(), 0, 'the image-production editor is collapsed');
    assert.equal(await page.locator('[data-panel="audio"]').count(), 1, 'audio / animation preparation stays available');
    assert.equal(await page.locator('[data-panel="prompt"]').count(), 1, 'the animation prompt stays available');
    await page.locator(`[data-sb-reopen="${ids[0]}"]`).click();
    await page.waitForSelector('[data-panel="look"]');
    // an unapproved scene is open by default
    await page.locator(`[data-gallery-open="${ids[2]}"]`).click();
    await page.waitForSelector('[data-panel="look"]');
    // full-size preview
    await page.locator(`[data-gallery-zoom="${ids[1]}"]`).click();
    await page.waitForSelector(`[data-gallery-full="${ids[1]}"]`);
    await page.getByRole('button', { name: /^닫기/ }).click();
    // comparison
    await page.locator('[data-gallery-compare]').click();
    await page.waitForSelector('[data-compare-grid]');
    assert.ok(await page.locator('[data-compare-col]').count() >= 2);
    await page.locator(`[data-compare-pick="${ids[2]}"]`).check();
    assert.equal(await page.locator(`[data-compare-col="${ids[2]}"]`).count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
  assert.equal(JSON.stringify(s.store.episodes.get(ID).scenes.map((x) => x.startImage)), before, 'viewing the gallery never changes stored images');
});
