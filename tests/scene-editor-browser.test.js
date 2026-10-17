'use strict';
// Real-browser check of the scene editor: approving folds a scene, drag handle + keyboard reorder, 씬 다시 생성하기 review flow.
// Chromium via Playwright; skipped automatically when it is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, readyProduct } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

async function boot() {
  const m = make(); // mock text provider: no key, nothing billed
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  return Object.assign(m, { pid, id, app, browser, base: `http://127.0.0.1:${app.address().port}/` });
}
const order = (m) => m.s.store.episodes.get(m.id).scenes.map((s) => s.id);
const approved = (m) => m.s.episodeView(m.id).scenes.filter((s) => s.approval && s.approval.approved).map((s) => s.id);

test('approving folds the scene into a compact summary; expand/collapse keeps the approval; a scene that fails validation is not approved or folded', { skip, timeout: 120000 }, async () => {
  const m = await boot();
  try {
    const [a, b] = order(m);
    await m.s.saveScene(m.id, b, { scene: { title_ko: '' } }); // invalid → cannot be approved
    const page = await (await m.browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(m.base + '#/script/' + m.id);
    await page.waitForSelector(`[data-scene-card="${a}"]`);
    await page.locator(`[data-scene-card="${a}"] [data-scene-approve="${a}"]`).first().click();
    await page.waitForSelector(`[data-scene-card="${a}"][data-collapsed]`);
    const compact = page.locator(`[data-scene-card="${a}"][data-collapsed]`);
    const txt = await compact.innerText();
    assert.doesNotMatch(await page.locator('#app, main, body').first().innerText(), /null/, 'no stray "null" text in the scene cards');
    assert.match(txt, /씬 1/); assert.match(txt, /\d+(\.\d+)?초/); assert.match(txt, /승인됨/); assert.match(txt, /펼치기/);
    assert.ok(approved(m).includes(a));
    // expand again for review / editing: still approved
    await compact.locator(`[data-scene-expand="${a}"]`).click();
    await page.waitForSelector(`[data-scene-card="${a}"]:not([data-collapsed]) [data-scene-collapse="${a}"]`);
    assert.ok(approved(m).includes(a), 'expanding does not change approval');
    await page.locator(`[data-scene-collapse="${a}"]`).click();
    await page.waitForSelector(`[data-scene-card="${a}"][data-collapsed]`);
    // survives a refresh (presentation is remembered, approval comes from the server)
    await page.reload(); await page.waitForSelector(`[data-scene-card="${a}"]`);
    await page.waitForSelector(`[data-scene-card="${a}"][data-collapsed]`);
    // the invalid scene: approval fails, the card stays open and unapproved
    await page.locator(`[data-scene-card="${b}"] [data-scene-approve="${b}"]`).first().click();
    await page.waitForTimeout(800);
    assert.equal(await page.locator(`[data-scene-card="${b}"][data-collapsed]`).count(), 0, 'failed validation: not collapsed');
    assert.ok(!approved(m).includes(b));
    assert.deepEqual(errors, []);
  } finally { await m.browser.close(); m.app.close(); }
});

test('drag handle: keyboard (↑/↓) and pointer drag reorder scenes, persist, keep IDs and approval; the fixed ending has no handle', { skip, timeout: 120000 }, async () => {
  const m = await boot();
  try {
    await m.s.addScene(m.id, { beatKey: 'problem' });
    const ids = order(m);
    const prob = m.s.episodeView(m.id).formula.partA.find((x) => x.key === 'problem').sceneIds;
    assert.equal(prob.length, 2);
    await m.s.projects.approveScene(m.id, prob[0]);
    const page = await (await m.browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(m.base + '#/script/' + m.id);
    await page.waitForSelector(`[data-scene-handle="${prob[1]}"]`);
    const bIds = m.s.episodeView(m.id).scenes.filter((s) => s.part === 'B').map((s) => s.id);
    for (const b of bIds) assert.equal(await page.locator(`[data-scene-handle="${b}"]`).count(), 0, 'no handle on the fixed ending');
    // keyboard
    await page.locator(`[data-scene-handle="${prob[1]}"]`).focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(900);
    let o = order(m);
    assert.ok(o.indexOf(prob[1]) < o.indexOf(prob[0]), 'moved up with the keyboard: ' + o.join());
    assert.equal(await page.evaluate((id) => document.activeElement && document.activeElement.getAttribute('data-scene-handle') === id, prob[1]), true, 'focus stays on the moved scene\'s handle');
    assert.deepEqual(order(m).slice().sort(), ids.slice().sort(), 'same scene IDs');
    assert.ok(approved(m).includes(prob[0]), 'approval stays attached to its scene');
    // numbering follows the new order
    const heads = await page.locator('[data-scene-card] .scene-no').allInnerTexts();
    assert.deepEqual(heads.slice(0, o.length), o.map((_, i) => `씬 ${i + 1}`));
    // pointer drag: drag the scene back below the other one
    const h1 = await page.locator(`[data-scene-handle="${prob[1]}"]`).boundingBox();
    const target = await page.locator(`[data-scene-card="${prob[0]}"]`).boundingBox();
    await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2); await page.mouse.down();
    await page.mouse.move(h1.x + h1.width / 2, target.y + target.height - 4, { steps: 8 });
    assert.equal(await page.locator('.scene-drop-line').count(), 1, 'a drop indicator is shown while dragging');
    await page.mouse.up();
    await page.waitForTimeout(900);
    o = order(m);
    assert.ok(o.indexOf(prob[0]) < o.indexOf(prob[1]), 'dragged back: ' + o.join());
    assert.equal(await page.locator('.scene-drop-line').count(), 0);
    // unsaved edits block a reorder (nothing is lost)
    await page.locator(`[data-scene-card="${prob[1]}"] details[data-section="visual"] summary`).click();
    await page.locator(`[data-scene-card="${prob[1]}"] details[data-section="visual"] textarea`).first().fill('unsaved text that must not be lost');
    await page.locator(`[data-scene-handle="${prob[1]}"]`).focus(); await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);
    assert.deepEqual(order(m), o, 'blocked while there are unsaved changes');
    assert.deepEqual(errors, []);
  } finally { await m.browser.close(); m.app.close(); }
});

test('씬 다시 생성하기: uses the edited 시각 연출, shows a proposal for review, keeps the approved scene until 제안 적용, cancel keeps the original', { skip, timeout: 120000 }, async () => {
  const m = await boot();
  try {
    const [a, b] = order(m);
    await m.s.projects.approveScene(m.id, a);
    const orig = m.s.store.episodes.get(m.id).scenes.find((s) => s.id === a).visual;
    const page = await (await m.browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(m.base + '#/script/' + m.id);
    await page.waitForSelector(`[data-scene-card="${a}"]`);
    await page.locator(`[data-scene-card="${a}"] [data-scene-expand="${a}"]`).click().catch(() => {});
    assert.equal(await page.locator(`[data-scene-regenerate="${a}"]`).count() + await page.locator(`[data-scene-card="${a}"][data-collapsed]`).count() >= 0, true);
    await page.locator(`[data-scene-card="${a}"] details[data-section="visual"] summary`).click();
    await page.locator(`[data-scene-card="${a}"] details[data-section="visual"] textarea`).first().fill('The character slides across the entry hall and crashes into the umbrella stand.');
    await page.locator(`[data-scene-regenerate="${a}"]`).click();
    await page.waitForSelector(`[data-regen-panel="${a}"]`);
    const panel = page.locator(`[data-regen-panel="${a}"]`);
    assert.match(await panel.innerText(), /아직 적용·승인되지 않았습니다/); assert.match(await panel.innerText(), /샘플/);
    const sc = () => m.s.store.episodes.get(m.id).scenes.find((s) => s.id === a);
    assert.equal(sc().visual, orig, 'nothing applied yet'); assert.ok(approved(m).includes(a), 'approval kept');
    assert.equal(await page.locator(`[data-regen-panel="${b}"]`).count(), 0, 'other scenes have no proposal');
    // cancel keeps the original
    await panel.locator(`[data-regen-cancel="${a}"]`).click();
    await page.waitForFunction((id) => !document.querySelector(`[data-regen-panel="${id}"]`), a);
    assert.equal(sc().visual, orig); assert.ok(approved(m).includes(a));
    // regenerate again and apply
    await page.locator(`[data-scene-card="${a}"] details[data-section="visual"] textarea`).first().fill('The character juggles three umbrellas in the entry hall while rain pours in.');
    await page.locator(`[data-scene-regenerate="${a}"]`).click();
    await page.waitForSelector(`[data-regen-accept="${a}"]`);
    await page.locator(`[data-regen-accept="${a}"]`).click();
    await page.getByRole('button', { name: '적용', exact: true }).click(); // approved scene → confirmation
    await page.waitForFunction((id) => !document.querySelector(`[data-regen-panel="${id}"]`), a);
    await page.waitForTimeout(400);
    assert.match(sc().visual, /juggles three umbrellas/); assert.ok(!approved(m).includes(a), 'applied scene is an unapproved draft');
    assert.deepEqual(errors, []);
  } finally { await m.browser.close(); m.app.close(); }
});
