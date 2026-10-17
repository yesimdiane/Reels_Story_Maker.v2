'use strict';
// Image Studio preview robustness: a missing/unreadable file is diagnosed in the UI, retry only re-fetches, and nothing paid runs.
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
function realPng(seed) { const W = 36, H = 64; const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc(H * (1 + W * 3)); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (1 + W * 3) + 1 + x * 3; raw[o] = (200 - seed * 12 + y) % 255; raw[o + 1] = 150 + (x * 2) % 80; raw[o + 2] = 120 + seed * 10; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const ID = 'EP01';

test('approved frame renders; when its file disappears the UI explains it, offers preview-only retry, and no generation is triggered', { skip, timeout: 120000 }, async () => {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-prev-')) }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg });
  s.loadDemoReferences();
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  const sid = s.store.episodes.get(ID).scenes[0].id;
  await s.uploadStartFrame(ID, sid, realPng(3), 'a.png');
  await s.approveStartFrame(ID, sid, true);
  const file = s.store.episodes.file(ID, 'startframes', s.store.episodes.get(ID).scenes[0].startImage.file);
  const keep = fs.readFileSync(file);
  const jobsBefore = JSON.stringify(s.store.episodes.get(ID).generation.jobs);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/image/${ID}`);
    await page.waitForSelector('[data-scene-gallery]');
    // 1) healthy: the preview loads
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.waitForSelector(`[data-preview="${sid}"][data-preview-state="ok"]`);
    // 2) the file vanishes while the browser still has the page open → diagnostic + retry (HEAD says 404 -> useful reason)
    fs.unlinkSync(file);
    await page.reload();
    await page.waitForSelector('[data-scene-gallery]');
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.waitForSelector(`[data-sb-missing-file="${sid}"]`);
    assert.match(await page.locator(`[data-sb-missing-file="${sid}"]`).innerText(), /파일을 찾지 못했습니다/);
    // 3) the file comes back: a preview-only retry is possible after restoring (served again), nothing was regenerated
    fs.writeFileSync(file, keep);
    await page.reload();
    await page.waitForSelector('[data-scene-gallery]');
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.waitForSelector(`[data-preview="${sid}"][data-preview-state="ok"]`);
    assert.equal(JSON.stringify(s.store.episodes.get(ID).generation.jobs), jobsBefore, 'no job was created');
    assert.equal(s.store.episodes.get(ID).scenes[0].startImage.approved, true, 'the approval survived');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('previewImage: broken URL shows a diagnosis and a retry that only re-fetches', { skip, timeout: 60000 }, async () => {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-prev2-')) }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`http://127.0.0.1:${app.address().port}/`);
    await page.waitForSelector('#rail');
    const reqs = [];
    page.on('request', (r) => reqs.push(r.method() + ' ' + r.url()));
    await page.evaluate(async () => { const { previewImage } = await import('/js/views/common.js'); document.body.append(previewImage({ url: '/media/startframe/EP01/NOPE', tag: 'x', style: 'width:100px;height:160px' })); });
    await page.waitForSelector('[data-preview="x"] [data-preview-error]');
    assert.match(await page.locator('[data-preview-error]').innerText(), /찾을 수 없습니다|불러오지 못했습니다/);
    const n = reqs.length;
    await page.locator('[data-preview-retry]').click();
    await page.waitForSelector('[data-preview-error]');
    assert.ok(reqs.slice(n).every((r) => r.startsWith('GET') || r.startsWith('HEAD')), 'retry issues only reads: ' + reqs.slice(n).join(','));
    assert.ok(!reqs.some((r) => r.startsWith('POST')), 'no POST (nothing generated)');
  } finally { await browser.close(); app.close(); }
});
