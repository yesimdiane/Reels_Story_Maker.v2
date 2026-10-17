'use strict';
// Real-browser check: the B-roll card shows the actual saved image (decoded by the browser), its size and state, opens a larger preview,
// survives a reload, and says so — with approval blocked — when the file disappears.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { approveWithScenes } = require('./helpers/approve');
const { make, readyProduct } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

function crc(buf) { let c, crcv = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); }
/** A real, decodable 9x16 PNG. */
function realPng() { const w = 9, h = 16; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 9 + y * 5) & 255; } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }

test('B-roll card: real thumbnail, size, larger preview, reload persistence, and a missing file is reported and blocks approval', { skip, timeout: 120000 }, async () => {
  const m = make();
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  await approveWithScenes(m.s, id);
  const sid = m.s.store.episodes.get(id).scenes[0].id;
  const b = await m.s.sba.saveBroll(id, { sceneId: sid, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'inserting product to door', note: 'door close-up' });
  await m.s.sba.uploadBrollImage(id, b.id, realPng(), 'door.png');
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1300 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const open = async () => { await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${id}`); await page.waitForSelector(`[data-sb-tab="${sid}"]`); await page.locator(`[data-sb-tab="${sid}"]`).click(); const sum = page.locator('[data-panel="cuts"] > summary'); if (!(await page.locator('[data-panel="cuts"][open]').count())) await sum.click(); await page.waitForSelector(`[data-broll="${b.id}"]`); };
    await open();
    const thumb = `[data-broll="${b.id}"] [data-broll-thumb]`;
    await page.waitForFunction((sel) => { const im = document.querySelector(sel); return im && im.complete && im.naturalWidth > 0; }, thumb, { timeout: 8000 });
    const cardText = await page.locator(`[data-broll="${b.id}"]`).innerText();
    assert.doesNotMatch(cardText, /미리보기 이미지 없음/); assert.match(cardText, /9×16px/); assert.match(cardText, /이미지 준비됨/);
    assert.equal(await page.locator(`[data-broll="${b.id}"] [data-broll-image-state]`).first().getAttribute('data-broll-image-state'), 'ready');
    await page.locator(`[data-broll-fullscreen="${b.id}"]`).click();
    await page.waitForSelector(`[data-broll-full="${b.id}"]`);
    assert.ok(await page.locator(`[data-broll-full="${b.id}"]`).evaluate((im) => im.complete && im.naturalWidth === 9), 'the full image is the saved file');
    await page.getByRole('button', { name: /닫기/ }).first().click();
    await page.reload(); await open();
    await page.waitForFunction((sel) => { const im = document.querySelector(sel); return im && im.complete && im.naturalWidth > 0; }, thumb, { timeout: 8000 });
    // approve → then the file disappears: the approval is kept, the card says so, and approval of anything else needs a real image
    await page.locator(`[data-broll-approve="${b.id}"]`).click();
    await page.waitForSelector(`[data-broll-revoke="${b.id}"]`);
    fs.rmSync(m.s.sba.brollFile(m.s.store.episodes.get(id), m.s.store.episodes.get(id).broll.find((x) => x.id === b.id)));
    await page.reload(); await open();
    await page.waitForSelector(`[data-broll-attention="${b.id}"]`);
    const t = await page.locator(`[data-broll="${b.id}"]`).innerText();
    assert.match(t, /승인됨/); assert.match(t, /이미지 파일 없음/); assert.match(t, /승인 기록은 유지/);
    assert.equal(await page.locator(`[data-broll="${b.id}"] [data-broll-thumb]`).count(), 0, 'no broken image is rendered');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
