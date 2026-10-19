'use strict';
// "AI 분석 결과 보기" popup in a real browser: read → correct → AI revision (cost confirmation first) → approve. Providers are faked: nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { CONFIRM, setupProduct, visionRoute } = require('./helpers/product-analysis-fixtures');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const revise = (req) => req.prompt.split('OPERATOR FEEDBACK:')[0].replace('EXISTING BRIEF (v1):\n', '').replace('Roughly three times taller than it is wide.', 'Looks about three times taller than wide.');

test('Product Studio brief popup: open, AI revision needs cost confirmation and makes a new draft, approve', { skip, timeout: 180000 }, async () => {
  const { s, a, pid } = await setupProduct({ develop: revise });
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/products/${pid}`);
    await page.locator(`[data-brief-open="${pid}"]`).click();
    const modal = page.locator(`[data-brief-modal="${pid}"]`);
    await modal.waitFor();
    assert.match(await page.locator('[data-brief-text="1"]').inputValue(), /PRODUCT STRUCTURE DESCRIPTION/);
    // AI revision: empty feedback is refused; cancelling the cost dialog sends nothing
    await page.locator('[data-brief-develop]').click();
    await page.waitForSelector('.toast.err');
    assert.equal(a.developCalls().length, 0);
    await page.locator('[data-brief-feedback]').fill('proportions less certain');
    await page.locator('[data-brief-develop]').click();
    await page.locator('[role=dialog]').last().getByRole('button', { name: /취소/ }).click();
    assert.equal(a.developCalls().length, 0, 'cancelled → nothing sent');
    await page.locator('[data-brief-develop]').click();
    await page.locator('[role=dialog]').last().locator('input[type=checkbox]').check();
    await page.locator('[role=dialog]').last().getByRole('button', { name: /반영하기/ }).last().click();
    await page.waitForFunction(() => !!document.querySelector('[data-brief-text="2"]'));
    assert.equal(a.developCalls().length, 1);
    assert.match(await page.locator('[data-brief-text="2"]').inputValue(), /Looks about three times taller/);
    assert.equal(s.products.raw(pid).analyses.length, 2);
    // approve the new draft
    await page.locator('[data-brief-approve="2"]').click();
    await page.waitForFunction(() => document.querySelector('[data-brief-approve="2"]') && document.querySelector('[data-brief-approve="2"]').disabled);
    assert.equal(s.products.raw(pid).analysisApprovedV, 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
