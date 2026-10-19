'use strict';
// Story Lab in a real browser, fake AI (nothing is billed): pick a category → cost confirmation (cancel sends nothing) →
// confirm → story cards render → approve. The approved story is what Script Studio hands off from.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { setupProduct } = require('./helpers/product-analysis-fixtures');
const { routePaid, conceptsForPrompt } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const storyCalls = (a) => a.calls.filter((c) => /INPUT DATA \(authoritative\)/.test(c.prompt || ''));

test('Story Lab UI chain: generate asks for cost confirmation first, then renders the stories, then approval is recorded', { skip, timeout: 150000 }, async () => {
  const { s, a, pid } = await setupProduct({ concepts: conceptsForPrompt }); // the fake AI answers with as many stories as were requested
  routePaid(s);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const dialog = page.locator('[role=dialog]');
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storylab/${pid}`);
    await page.getByRole('button', { name: /스토리 컨셉 생성/ }).waitFor();
    if (!(await page.locator('.cat-opt.on').count())) await page.locator('.cat-opt').first().click();
    await page.getByRole('button', { name: /스토리 컨셉 생성/ }).click();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /예상 비용/);
    assert.equal(storyCalls(a).length, 0, 'the estimate / preview step makes no AI call');
    await dialog.getByRole('button', { name: /취소/ }).click();
    assert.equal(storyCalls(a).length, 0, 'cancelled → nothing sent');
    await page.getByRole('button', { name: /스토리 컨셉 생성/ }).click();
    await dialog.locator('input[type=checkbox]').check(); // the fake provider has no price entered
    await dialog.getByRole('button', { name: /^생성$/ }).click();
    await page.waitForSelector('[data-story]', { timeout: 30000 });
    assert.equal(storyCalls(a).length, 1, 'exactly one paid request after confirming');
    assert.ok((await page.locator('[data-story]').count()) >= 1, 'story cards are shown');
    assert.ok(s.storylab.list(pid).concepts.length >= 1);
    assert.deepEqual(errors, []);
    // approve the first card
    if (!(await page.locator('[data-story-open]').count())) await page.locator('[data-story]').first().click(); // actions live in the opened card
    await page.locator('[data-act=approve]').first().click();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /승인할까요/);
    await dialog.getByRole('button', { name: /승인|확인/ }).last().click();
    await page.waitForFunction(() => /승인했습니다/.test(document.body.innerText), null, { timeout: 15000 });
    assert.ok(s.storylab.list(pid).concepts.some((c) => c.approved), 'the approval is stored');
    await page.locator('[data-tab=approved]').click(); // an approved story moves to the 승인됨 tab, where it offers the Script Studio hand-off
    await page.locator('[data-story]').first().click();
    await page.waitForSelector('[data-act=handoff]', { timeout: 15000 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
