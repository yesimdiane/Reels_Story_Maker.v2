'use strict';
// Product Studio: the structure description and the reference-image set each have a 승인 취소 button next to their approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { CONFIRM, setupProduct, visionRoute } = require('./helpers/product-analysis-fixtures');
const { gotoReady } = require('./helpers/route-ready');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

test('Product Studio: 승인 취소 for the structure description and for the reference-image set (confirmation first, nothing deleted)', { skip, timeout: 180000 }, async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const confirm = async (name) => { const d = page.locator('[role=dialog]', { hasText: name }); await d.waitFor(); await d.getByRole('button', { name: /^승인 취소/ }).click(); };
  try {
    await gotoReady(page, `http://127.0.0.1:${app.address().port}`, `products/${pid}`);
    // structure description
    const rev = page.locator('[data-analysis-revoke="1"]');
    await rev.waitFor({ state: 'attached' });
    await rev.evaluate((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
    await rev.click();
    await confirm('구조 설명 v1 승인을 취소');
    await page.waitForFunction(() => !document.querySelector('[data-analysis-revoke="1"]'));
    assert.equal(s.products.raw(pid).analysisApprovedV, undefined);
    assert.equal(s.products.raw(pid).analyses.find((a) => a.v === 1).status, 'draft');
    // reference-image set
    const ref = page.locator(`[data-reference-revoke="${pid}"]`);
    await ref.waitFor({ state: 'attached' });
    await ref.evaluate((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
    const imagesBefore = s.products.raw(pid).images.length;
    await ref.click();
    await confirm('참조 이미지 세트 승인을 취소');
    await page.waitForFunction(() => !document.querySelector('[data-reference-revoke]'));
    assert.equal(s.products.referenceState(s.products.raw(pid)).state, 'none');
    assert.equal(s.products.raw(pid).images.length, imagesBefore, 'no image was deleted');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
