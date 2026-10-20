'use strict';
// Product visual analysis in a real browser: analyze (cost confirmation) → editable English description → approve; samples cannot be approved;
// storyboard frames show which reference image-set and description version they used and keep V1/V2/V3. Providers are faked: nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { CONFIRM, setupProduct, setupEpisode, visionRoute } = require('./helpers/product-analysis-fixtures');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

async function serve(s, viewport = { width: 1280, height: 1000 }) {
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  const page = await (await browser.newContext({ viewport })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { app, browser, page, errors, base: `http://127.0.0.1:${app.address().port}` };
}
const dialog = (page) => page.locator('[role=dialog]');

test('Product Studio: analyze with cost confirmation, edit the English description, approve; editing an approved version makes a new version', { skip, timeout: 180000 }, async () => {
  const { s, a, pid } = await setupProduct();
  visionRoute(s);
  const { app, browser, page, errors, base } = await serve(s);
  try {
    await page.goto(`${base}/#/products/${pid}`);
    await page.waitForSelector(`[data-product-analysis="${pid}"]`);
    assert.equal(await page.locator('[data-analysis-text]').count(), 0, 'nothing is analyzed until the operator asks');
    assert.match(await page.locator('[data-product-analysis]').innerText(), /승인된 설명 없음/);
    assert.equal(a.analysisCalls().length, 0);
    // cost confirmation comes first; cancelling sends nothing
    await page.locator('[data-analysis-run]').click();
    await dialog(page).waitFor();
    assert.match(await dialog(page).innerText(), /예상 비용/);
    await dialog(page).getByRole('button', { name: /취소/ }).click();
    assert.equal(a.analysisCalls().length, 0, 'cancelled → nothing sent');
    await page.locator('[data-analysis-run]').click();
    await dialog(page).locator('input[type=checkbox]').check(); // the fake provider has no price entered
    await dialog(page).getByRole('button', { name: /분석하기/ }).last().click();
    await page.waitForSelector('[data-analysis-text="1"]');
    assert.equal(a.analysisCalls().length, 1);
    assert.equal(a.analysisCalls()[0].images.length, 1, 'the product photo itself was sent to the vision AI');
    const ta = page.locator('[data-analysis-text="1"]');
    const text = await ta.inputValue();
    assert.match(text, /PRODUCT STRUCTURE DESCRIPTION/); assert.match(text, /\[VERIFIED\]/); assert.match(text, /\[UNCERTAIN\]/); assert.match(text, /NEGATIVE CONSTRAINTS/);
    assert.match(await page.locator('[data-product-analysis]').innerText(), /검토 대기/);
    assert.equal(await page.locator('[data-analysis-save="1"]').isDisabled(), true, 'nothing to save yet');
    // correct it
    await ta.fill(text + '\n- [VERIFIED] The label reads "A-100" on the lower right.');
    assert.equal(await page.locator('[data-analysis-save="1"]').isDisabled(), false);
    await page.locator('[data-analysis-approve="1"]').click(); // unsaved edits must be saved first
    await page.waitForSelector('.toast.err');
    assert.equal(s.products.raw(pid).analysisApprovedV, undefined);
    await page.locator('[data-analysis-save="1"]').click();
    await page.waitForFunction((id) => !!(document.querySelector('[data-analysis-save="1"]') && document.querySelector('[data-analysis-save="1"]').disabled), pid);
    assert.match(s.products.raw(pid).analyses[0].text, /A-100/);
    // approve
    await page.locator('[data-analysis-approve="1"]').click();
    await page.waitForFunction(() => /승인됨 v1/.test(((document.querySelector('[data-product-analysis]') || { innerText: '' }).innerText)));
    assert.equal(s.products.raw(pid).analysisApprovedV, 1);
    assert.match(await page.locator('[data-product-analysis]').innerText(), /스토리보드 이미지.*자동으로 들어갑니다/s);
    // editing the approved text → a NEW version; v1 stays approved and untouched
    const approvedText = s.products.raw(pid).analyses[0].text;
    await page.locator('[data-analysis-text="1"]').fill(approvedText + '\n- [UNCERTAIN] The finish may be slightly glossy.');
    await page.locator('[data-analysis-save="1"]').click();
    await page.waitForSelector('[data-analysis-version="2"]');
    assert.match(await page.locator('[data-analysis-version="1"]').innerText(), /승인됨/);
    assert.match(await page.locator('[data-analysis-version="2"]').innerText(), /검토 대기/);
    const rec = s.products.raw(pid);
    assert.equal(rec.analysisApprovedV, 1); assert.equal(rec.analyses[0].text, approvedText, 'the approved version was not overwritten');
    assert.equal(rec.analyses.length, 2);
    // the saved record knows its product and reference image version
    assert.equal(rec.analyses[1].productId, pid); assert.equal(rec.analyses[1].imageSetVersion, 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('Product Studio: the free sample can be created but never approved as an analysis; stale images are flagged', { skip, timeout: 180000 }, async () => {
  const { s, a, pid } = await setupProduct(); // "제품 이해" stays on the free sample route
  const { app, browser, page, errors, base } = await serve(s);
  try {
    await page.goto(`${base}/#/products/${pid}`);
    await page.waitForSelector(`[data-product-analysis="${pid}"]`);
    assert.match(await page.locator('[data-product-analysis]').innerText(), /실제 이미지 분석을 하지 않습니다/);
    await page.locator('[data-analysis-run]').click(); // free: no cost dialog
    await page.waitForSelector('[data-analysis-sample]');
    assert.equal(await dialog(page).count(), 0);
    assert.equal(a.analysisCalls().length, 0, 'no AI call at all');
    await page.locator('[data-analysis-approve="1"]').click();
    await page.waitForSelector('.toast.err');
    assert.match(await page.locator('.toast.err').first().innerText(), /샘플/);
    assert.equal(s.products.raw(pid).analysisApprovedV, undefined);
    // the operator writes a real description and approves it; then a replaced image flags it as stale
    await page.locator('[data-analysis-text="1"]').fill('PRODUCT STRUCTURE DESCRIPTION — written by me\n- [VERIFIED] Three vertical slots.');
    await page.locator('[data-analysis-save="1"]').click();
    await page.waitForFunction(() => !!(document.querySelector('[data-analysis-save="1"]') && document.querySelector('[data-analysis-save="1"]').disabled));
    await page.locator('[data-analysis-approve="1"]').click();
    await page.waitForFunction(() => /승인됨 v1/.test(((document.querySelector('[data-product-analysis]') || { innerText: '' }).innerText)));
    const im = s.products.raw(pid).images[0];
    await s.products.replace(pid, im.id, require('./helpers/v23').png(9), 'new.png', { confirm: true });
    await page.reload();
    await page.waitForSelector('[data-analysis-stale]');
    assert.match(await page.locator('[data-analysis-stale]').innerText(), /이미지가 바뀌었습니다/);
    assert.equal(s.products.raw(pid).analysisApprovedV, 1, 'the approved version is preserved');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('Storyboard: each frame shows its reference image-set and description versions; V1/V2/V3 are kept; a newer description does not regenerate anything', { skip, timeout: 240000 }, async () => {
  const { s, a, pid, id, sceneId } = await setupEpisode();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  for (let i = 0; i < 3; i += 1) await s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true });
  const { app, browser, page, errors, base } = await serve(s);
  try {
    await page.goto(`${base}/#/image/${id}`);
    await page.waitForSelector('[data-sb-tab]');
    await page.locator(`[data-sb-tab="${sceneId}"]`).click();
    await page.waitForSelector(`[data-frame-provenance="${sceneId}"]`);
    const txt = await page.locator(`[data-frame-provenance="${sceneId}"]`).innerText();
    assert.match(txt, /이 이미지 V3/); assert.match(txt, /제품 참조 이미지 세트 V1/); assert.match(txt, /제품 구조 설명 v1/);
    await page.locator(`[data-frame-versions="${sceneId}"] summary`).click();
    assert.equal(await page.locator(`[data-frame-version]`).count(), 3);
    assert.match(await page.locator('[data-frame-version="2"]').innerText(), /세트 V1 · 설명 v1/);
    assert.match(await page.locator('[data-frame-version="3"]').innerText(), /현재/);
    // a newer description is approved: the frame keeps its recorded version, says so, and nothing is regenerated
    const edited = await s.productAnalysis.edit(pid, 1, s.productAnalysis.view(pid).approved.text + '\n- [VERIFIED] extra');
    await s.productAnalysis.approve(pid, edited.latest.v);
    const calls = a.imageCalls().length;
    await page.reload();
    await page.waitForSelector('[data-sb-tab]');
    await page.locator(`[data-sb-tab="${sceneId}"]`).click();
    await page.waitForSelector(`[data-frame-provenance="${sceneId}"]`);
    assert.match(await page.locator(`[data-frame-provenance="${sceneId}"]`).innerText(), /제품 구조 설명 v1.*현재 승인 v2/s);
    assert.match(await page.locator('[data-sb-section=image]').first().innerText(), /자동으로 다시 만들어지지 않습니다/);
    assert.equal(a.imageCalls().length, calls, 'no image was requested by viewing or approving');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('phone width: the analysis panel and the frame provenance fit without sideways scroll', { skip, timeout: 240000 }, async () => {
  const { s, pid, id, sceneId } = await setupEpisode();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  await s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true });
  const { app, browser, page, errors, base } = await serve(s, { width: 390, height: 844 });
  try {
    await page.goto(`${base}/#/products/${pid}`);
    await page.waitForSelector(`[data-product-analysis="${pid}"]`, { state: 'attached' });
    await page.waitForSelector('[data-analysis-text]');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'product analysis overflows');
    await page.goto(`${base}/#/image/${id}`);
    await page.waitForSelector('[data-sb-tab]');
    await page.locator(`[data-sb-tab="${sceneId}"]`).click();
    await page.waitForSelector(`[data-frame-provenance="${sceneId}"]`);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'frame provenance overflows');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
