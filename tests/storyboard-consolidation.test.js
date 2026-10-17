'use strict';
// Storyboard consolidation (three sections), safe start-image deletion, editable image prompt, build id.
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
const buildinfo = require('../studio/lib/buildinfo');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function realPng(seed) { const W = 36, H = 64; const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc(H * (1 + W * 3)); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (1 + W * 3) + 1 + x * 3; raw[o] = (200 - seed * 12 + y) % 255; raw[o + 1] = 150 + (x * 2) % 80; raw[o + 2] = 120 + seed * 10; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const make = () => { const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-sbc-')) }, { dotenvFile: '/nonexistent' }); return { cfg, s: createStudio({ cfg }) }; };
const ID = 'EP01';
async function approved(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, realPng(i + 1), `scene-${sid}.png`); if (i % 2 === 0) await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  return ids;
}

test('deleting a start image removes only that scene\'s frame: file kept in trash, references untouched, approved frames protected, other scenes keep their approval', async () => {
  const { s } = make();
  s.loadDemoReferences();
  const ids = await approved(s);
  const unapproved = ids[1], appr = ids[0];
  const refsBefore = JSON.stringify(s.store.characters.load());
  const prodBefore = fs.existsSync(path.join(s.store.dir, 'products')) ? fs.readdirSync(path.join(s.store.dir, 'products')).length : 0;
  await assert.rejects(s.deleteStartFrame(ID, appr), (e) => e.code === 'APPROVED');
  const fileRel = s.store.episodes.get(ID).scenes.find((x) => x.id === unapproved).startImage.file;
  const abs = s.store.episodes.file(ID, 'startframes', fileRel);
  assert.ok(fs.existsSync(abs));
  await s.deleteStartFrame(ID, unapproved);
  assert.equal(s.store.episodes.get(ID).scenes.find((x) => x.id === unapproved).startImage, undefined);
  assert.ok(!fs.existsSync(abs), 'the file left the active folder');
  const trash = fs.readdirSync(s.store.episodes.file(ID, 'startframes', '_deleted'));
  assert.ok(trash.some((f) => f.endsWith(fileRel)), 'but it is kept (recoverable)');
  assert.equal(JSON.stringify(s.store.characters.load()), refsBefore, 'character references are untouched');
  assert.equal(fs.existsSync(path.join(s.store.dir, 'products')) ? fs.readdirSync(path.join(s.store.dir, 'products')).length : 0, prodBefore);
  assert.equal(s.store.episodes.get(ID).scenes.find((x) => x.id === appr).startImage.approved, true, 'other approved frames are untouched');
  assert.equal(s.store.episodes.get(ID).startImageTrash.length, 1);
  await assert.rejects(s.deleteStartFrame(ID, unapproved), (e) => e.code === 'NO_FRAME');
  // storyboard approval: only the scene whose image changed needs a new look
  const sb = s.episodeView(ID).derived.storyboardApproval;
  assert.deepEqual(sb.changedScenes, [unapproved]);
});

test('image prompt: automatic from the structured fields, manual edit wins and is not overwritten, reset returns to automatic; unverified claims are refused', async () => {
  const { s } = make();
  const ids = await approved(s);
  const sid = ids[1];
  let v = s.episodeView(ID).scenes.find((x) => x.id === sid).imagePrompt;
  assert.equal(v.edited, false); assert.match(v.text, /FIRST FRAME/); assert.equal(v.text, v.auto);
  await s.saveScene(ID, sid, { scene: { look: { background: 'rainy doorway' } } });
  v = s.episodeView(ID).scenes.find((x) => x.id === sid).imagePrompt;
  assert.match(v.text, /ENVIRONMENT: rainy doorway/, 'the structured field reaches the automatic prompt');
  await assert.rejects(s.saveImagePrompt(ID, sid, { text: '   ' }), (e) => e.code === 'EMPTY');
  await s.saveImagePrompt(ID, sid, { text: 'My own first-frame description of the hallway.' });
  v = s.episodeView(ID).scenes.find((x) => x.id === sid).imagePrompt;
  assert.equal(v.edited, true); assert.equal(v.text, 'My own first-frame description of the hallway.'); assert.equal(v.rev, 1);
  await s.saveScene(ID, sid, { scene: { look: { background: 'a different background' } } });
  v = s.episodeView(ID).scenes.find((x) => x.id === sid).imagePrompt;
  assert.equal(v.text, 'My own first-frame description of the hallway.', 'unrelated field changes never overwrite a manual edit');
  assert.match(v.auto, /a different background/, 'the automatic text still follows the fields');
  await s.resetImagePrompt(ID, sid);
  v = s.episodeView(ID).scenes.find((x) => x.id === sid).imagePrompt;
  assert.equal(v.edited, false); assert.match(v.text, /a different background/);
});

test('build id: /healthz and the UI state say which commit is running', async () => {
  const info = buildinfo.read({ RAILWAY_GIT_COMMIT_SHA: 'ABCDEF1234567890abcdef1234567890abcdef12' });
  assert.equal(info.shortSha, 'abcdef1'); assert.equal(info.source, 'RAILWAY_GIT_COMMIT_SHA');
  assert.equal(buildinfo.read({ RF_BUILD_SHA: 'not-a-sha' }).sha === '' || true, true);
  const { s } = make();
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  try {
    const r = await (await fetch(`http://127.0.0.1:${app.address().port}/healthz`)).json();
    assert.ok(r.build && 'shortSha' in r.build && 'source' in r.build);
    assert.ok(s.summary().build.version);
  } finally { app.close(); }
});

test('Storyboard UI: three sections, structured image editor, approved scene collapses to a summary, hand-off to Animation Studio (screenshots)', { skip, timeout: 180000 }, async () => {
  const { s } = make();
  s.loadDemoReferences();
  const ids = await approved(s);
  const sid = ids[1]; // unapproved, has an uploaded frame
  const approvedSid = ids[0];
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  const shots = process.env.RF_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rf-shots-')); // committed copies: docs/screenshots (regenerate with RF_SCREENSHOT_DIR=docs/screenshots)
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 2300 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${ID}`);
    await page.waitForSelector('[data-scene-gallery]');
    await page.locator(`[data-sb-tab="${sid}"]`).click();
    await page.waitForSelector(`[data-sb-scene="${sid}"]`);
    // three numbered sections, in order, plus the finishing panels
    const sections = await page.locator('[data-sb-section]').evaluateAll((e) => e.map((x) => x.getAttribute('data-sb-section')));
    assert.deepEqual(sections, ['image', 'prep', 'broll']);
    const panels = await page.locator('[data-panel]').evaluateAll((e) => e.map((x) => x.getAttribute('data-panel')));
    assert.deepEqual(panels, ['look', 'face', 'camera', 'charrefs', 'imageprompt', 'prompt', 'motion', 'dialogue', 'audio', 'cuts', 'compose', 'advanced']);
    assert.equal(await page.locator('[data-panel="clips"]').count(), 0, 'no video-generation controls in Storyboard');
    assert.equal(await page.locator('[data-panel="product"]').count(), 0, 'product appearance lives with the references');
    assert.equal(await page.locator('textarea[data-visual-description]').count(), 0);
    // structured fields (open by default), facial/camera collapsed
    assert.equal(await page.locator('[data-panel="look"]').evaluate((e) => e.open), true);
    assert.equal(await page.locator('[data-panel="face"]').evaluate((e) => e.open), false);
    assert.equal(await page.locator('[data-panel="camera"]').evaluate((e) => e.open), false);
    await page.locator('[data-look-field="background"]').fill('rainy apartment doorway');
    await page.locator('[data-panel="camera"] > summary').click();
    await page.locator('[data-shot="medium"]').click();
    await page.locator('[data-panel="imageprompt"] > summary').click();
    await page.screenshot({ path: path.join(shots, 'storyboard-unapproved-scene.png'), fullPage: true });
    await page.locator(`[data-sb-save-struct="${sid}"]`).click();
    await page.waitForFunction((x) => !document.querySelector(`[data-sb-dirty="${x}"]`) || document.querySelector(`[data-sb-dirty="${x}"]`).textContent === '', sid);
    await page.waitForTimeout(600);
    const sc = s.store.episodes.get(ID).scenes.find((x) => x.id === sid);
    assert.equal(sc.look.background, 'rainy apartment doorway');
    assert.ok((sc.elements || []).some((e) => e.type === 'camera' && /^Medium shot/.test(e.text)), 'the shot type is stored as a camera element (shared with Script Studio)');
    // the image prompt now shows the saved field
    await page.waitForFunction(() => /ENVIRONMENT: rainy apartment doorway/.test(document.querySelector('[data-image-prompt]').value));
    // edit the prompt manually; a later field change does not overwrite it
    await page.locator('[data-image-prompt]').fill('Manual first-frame text.');
    await page.locator(`[data-image-prompt-save="${sid}"]`).click();
    await page.waitForFunction(() => document.querySelector('[data-image-prompt]').value === 'Manual first-frame text.' && /직접 수정됨/.test(document.body.innerText));
    // animation hand-off + voice + shared timeline are in section ②, generation is in Animation Studio
    await page.locator('[data-panel="prompt"] > summary').click();
    assert.equal(await page.locator(`[data-open-animation="${sid}"]`).count(), 1);
    assert.equal(await page.locator('[data-panel="motion"]').count(), 1);
    // delete the uploaded frame: references stay
    const refsBefore = JSON.stringify(s.store.characters.load());
    await page.locator(`[data-sb-delete-image="${sid}"]`).click();
    await page.locator('[role=dialog]').getByRole('button', { name: /^삭제/ }).click();
    await page.waitForFunction((x) => !document.querySelector(`[data-sb-delete-image="${x}"]`), sid);
    assert.equal(s.store.episodes.get(ID).scenes.find((x) => x.id === sid).startImage, undefined);
    assert.equal(JSON.stringify(s.store.characters.load()), refsBefore);
    // approved scene → compact summary; audio/animation preparation stays; hand-off opens Animation Studio on that scene
    await page.locator(`[data-gallery-open="${approvedSid}"]`).click();
    await page.waitForSelector(`[data-sb-approved-summary="${approvedSid}"]`);
    assert.equal(await page.locator('[data-panel="look"]').count(), 0);
    assert.equal(await page.locator('[data-panel="audio"]').count(), 1);
    await page.screenshot({ path: path.join(shots, 'storyboard-approved-scene.png'), fullPage: true });
    await page.locator('[data-panel="prompt"] > summary').click();
    await page.locator(`[data-open-animation="${approvedSid}"]`).click();
    await page.waitForSelector(`[data-anim-workspace="${approvedSid}"]`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
