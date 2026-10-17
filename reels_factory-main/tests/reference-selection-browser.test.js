'use strict';
// Real-browser check: compact per-character reference selection (max 3 each, filenames preserved, persistence), the storyboard summary,
// the over-limit dialog (nothing trimmed silently, library untouched, no paid call) and the green approved B-roll card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

function crc(buf) { let c, crcv = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); }
function realPng(seed) { const w = 9, h = 16; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 9 + y * 5 + seed) & 255; } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const NAMES = { jack: ['잭 정면 사진 (최종).png', 'jack side.png', 'jack back.png', 'a-very-long-original-filename-that-must-never-stretch-the-layout-of-the-reference-grid-0001.png'], diane: ['diane front.png', 'diane side.png', 'diane smile.png', 'diane extra.png'] };

test('reference selection, limit dialog and green B-roll card in a browser', { skip, timeout: 180000 }, async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  const m = make({ ai }); m.ai = ai;
  const pid = await readyProduct(m.s); routePaid(m.s);
  m.s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'gemini-2.5-flash-image' });
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: { paid: true, unknownCost: true } });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: { paid: true, unknownCost: true } });
  await approveWithScenes(m.s, id);
  const sid = m.s.store.episodes.get(id).scenes[0].id;
  await m.s.store.episodes.update(id, (e) => { const sc = e.scenes.find((x) => x.id === sid); sc.characters = ['jack', 'diane']; sc.showsProduct = true; });
  const refs = {};
  ['jack', 'diane'].forEach((cid, ci) => { refs[cid] = NAMES[cid].map((fn, i) => { m.s.store.characters.addReference(cid, { buffer: realPng(ci * 40 + i * 7), filename: fn, mime: 'image/png', label: fn }); const r = m.s.store.characters.get(cid).references.slice(-1)[0]; m.s.store.characters.setReferenceApproved(cid, r.id, true); return r; }); });
  const b = await m.s.sba.saveBroll(id, { sceneId: sid, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'door insert' });
  await m.s.sba.uploadBrollImage(id, b.id, realPng(99), 'door.png');
  const imageCalls = () => m.ai.calls.filter((c) => c.image).length;
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const base = `http://127.0.0.1:${app.address().port}/`;

    // ---- Character Library: per-character selection
    await page.goto(base + '#/characters');
    for (const cid of ['jack', 'diane']) {
      await page.locator(`[data-library-character="${cid}"] summary`).first().click();
      const gal = page.locator(`[data-ref-gallery-lib="${cid}"]`);
      await gal.waitFor();
      for (let i = 0; i < 3; i++) await gal.locator(`[data-ref-toggle="${refs[cid][i].id}"]`).click(), await page.waitForFunction(([c, n]) => { const el = document.querySelector(`[data-ref-counter="${c}"]`); return el && el.textContent.includes(`선택 ${n}/3`); }, [cid, i + 1]);
      await page.locator(`[data-library-character="${cid}"] summary`).first().evaluate((el) => { if (!el.parentElement.open) el.click(); });
    }
    const jg = page.locator('[data-ref-gallery-lib="jack"]');
    assert.equal(await jg.locator(`[data-ref-toggle="${refs.jack[3].id}"]`).isDisabled(), true, 'a 4th selection is disabled');
    assert.deepEqual(m.s.store.characters.get('jack').referenceSelection, refs.jack.slice(0, 3).map((r) => r.id));
    assert.deepEqual(m.s.store.characters.get('diane').referenceSelection, refs.diane.slice(0, 3).map((r) => r.id), 'Diane has her own 3');
    assert.equal(m.s.store.characters.get('jack').references.length >= 4, true, 'unselected uploads are kept');
    // filenames: exact, ellipsis, full name on hover (title), thumbnails compact
    const fn = jg.locator(`[data-ref-tile="${refs.jack[0].id}"] [data-ref-filename]`);
    assert.equal(await fn.textContent(), '잭 정면 사진 (최종).png'); assert.equal(await fn.getAttribute('title'), '잭 정면 사진 (최종).png');
    const long = jg.locator(`[data-ref-tile="${refs.jack[3].id}"] [data-ref-filename]`);
    assert.equal(await long.getAttribute('title'), NAMES.jack[3]);
    const css = await long.evaluate((el) => { const c = getComputedStyle(el); return { ov: c.textOverflow, w: el.getBoundingClientRect().width, scroll: el.scrollWidth }; });
    assert.equal(css.ov, 'ellipsis'); assert.ok(css.w <= 100 && css.scroll > css.w, 'long names are truncated, not stretched');
    const tw = await jg.locator(`[data-ref-tile="${refs.jack[0].id}"] .ref-thumb`).evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(tw >= 80 && tw <= 100, 'compact thumbnail ' + tw);
    assert.equal(await jg.locator(`[data-ref-tile="${refs.jack[0].id}"] .ref-check`).count(), 1, 'selected tile has a checkmark');
    await page.reload();
    await page.locator('[data-library-character="jack"] summary').first().click();
    assert.match(await page.locator('[data-ref-counter="jack"]').textContent(), /선택 3\/3/, 'selection survives refresh');

    // ---- Storyboard: 3 + 3 shown, then the limit dialog (model max 3)
    await page.goto(base + `#/storyboard/${id}`);
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.waitForSelector(`[data-sb-scene="${sid}"]`);
    { const reopen = page.locator(`[data-sb-reopen="${sid}"]`); if (await reopen.count()) await reopen.click(); } // approved start image collapses the editor
    await page.waitForSelector(`[data-char-refs="${sid}"]`);
    assert.match(await page.locator('[data-ref-count="jack"]').textContent(), /선택 3\/3/); assert.match(await page.locator('[data-ref-count="diane"]').textContent(), /선택 3\/3/);
    const before = JSON.stringify([m.s.store.characters.get('jack').referenceSelection, m.s.store.characters.get('diane').referenceSelection]);
    await page.locator(`[data-sb-regenerate="${sid}"]`).click();
    await page.waitForSelector('[data-ref-limit-warning]');
    assert.match(await page.locator('[data-ref-limit-warning]').innerText(), /한도 3장/);
    assert.equal(await page.locator('[data-ref-limit-apply]').isDisabled(), true, 'cannot proceed while over the limit');
    assert.equal(imageCalls(), 0, 'no paid request');
    // deselect (this request only) until valid: keep 1 per character + (product refs ≤ remaining)
    const toggles = page.locator('[data-ref-tile] [data-ref-toggle]');
    const n = await toggles.count();
    for (let i = n - 1; i >= 0 && await page.locator('[data-ref-limit-apply]').isDisabled(); i--) { const t = toggles.nth(i); if ((await t.getAttribute('aria-pressed')) === 'true') await t.click(); if (await page.locator('[data-ref-limit-warning]').innerText().then((x) => /한도 안입니다/.test(x))) break; }
    await page.waitForFunction(() => { const b = document.querySelector('[data-ref-limit-apply]'); return b && !b.disabled; }, null, { timeout: 5000 }).catch(() => {});
    if (!(await page.locator('[data-ref-limit-apply]').isDisabled())) await page.locator('[data-ref-limit-apply]').click();
    assert.equal(JSON.stringify([m.s.store.characters.get('jack').referenceSelection, m.s.store.characters.get('diane').referenceSelection]), before, 'library selection preserved');
    assert.equal(imageCalls(), 0, 'still no paid request (cost confirmation comes next)');
    await page.keyboard.press('Escape');

    // ---- B-roll card: green when approved, beige when pending, persists, attention when the file vanishes
    await page.goto(base + `#/storyboard/${id}`);
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    if (!(await page.locator('[data-panel="cuts"][open]').count())) await page.locator('[data-panel="cuts"] > summary').click();
    const card = page.locator(`[data-broll="${b.id}"]`);
    await card.waitFor();
    const bg = () => card.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(await card.getAttribute('data-broll-state'), 'pending'); const beige = await bg();
    await card.locator(`[data-broll-approve="${b.id}"]`).click();
    await page.waitForSelector(`[data-broll="${b.id}"][data-broll-state="approved"]`);
    assert.equal(await bg(), 'rgb(228, 235, 220)', 'soft sage green (the existing approval colour)');
    assert.match(await card.innerText(), /승인됨/);
    await page.reload(); await page.locator(`[data-sb-tab="${sid}"]`).click();
    if (!(await page.locator('[data-panel="cuts"][open]').count())) await page.locator('[data-panel="cuts"] > summary').click();
    await page.waitForSelector(`[data-broll="${b.id}"][data-broll-state="approved"]`);
    await page.locator(`[data-broll-revoke="${b.id}"]`).click();
    await page.waitForSelector(`[data-broll="${b.id}"][data-broll-state="pending"]`);
    assert.equal(await bg(), beige, 'back to the original cream/beige');
    await card.locator(`[data-broll-approve="${b.id}"]`).click();
    await page.waitForSelector(`[data-broll="${b.id}"][data-broll-state="approved"]`);
    fs.rmSync(m.s.sba.brollFile(m.s.store.episodes.get(id), m.s.store.episodes.get(id).broll.find((x) => x.id === b.id)));
    await page.reload(); await page.locator(`[data-sb-tab="${sid}"]`).click();
    if (!(await page.locator('[data-panel="cuts"][open]').count())) await page.locator('[data-panel="cuts"] > summary').click();
    await page.waitForSelector(`[data-broll="${b.id}"][data-broll-state="attention"]`);
    assert.notEqual(await bg(), 'rgb(228, 235, 220)', 'a missing image never shows the green ready state');
    assert.equal(m.s.store.episodes.get(id).broll.find((x) => x.id === b.id).status, 'approved', 'approval history preserved');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
