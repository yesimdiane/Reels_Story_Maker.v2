'use strict';
// The 스토리 수정 dialog in a real browser: instruction -> cost confirmation -> (busy) -> proposal fills the fields -> nothing saved until 저장.
// The slow AI is simulated by holding the HTTP request; nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { gotoReady } = require('./helpers/route-ready');
const { CONFIRM, setupProduct } = require('./helpers/product-analysis-fixtures');
const { routePaid, conceptsForPrompt } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const NEW_STORY = 'Diane declares a duel: each of them scrubs their own bathroom drain, fits a fresh filter and takes a shower. Jack swears his is spotless, until the two filters are compared side by side.';

test('story edit dialog: AI proposal fills the fields, the button is busy meanwhile, nothing is saved until 저장', { skip, timeout: 150000 }, async () => {
  const { s, a, pid } = await setupProduct({ concepts: conceptsForPrompt, refine: () => ({ title: 'The Drain Duel', storyline: NEW_STORY }) });
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const cid = lab.concepts[0].id;
  await s.storylab.approve(pid, cid);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await gotoReady(page, `http://127.0.0.1:${app.address().port}`, `storylab/${pid}`);
    await page.locator('[data-tab=approved]').click();
    await page.waitForSelector('[data-story]');
    await page.waitForTimeout(400); // let the list finish drawing before deciding whether the card is already open
    if (!(await page.locator('[data-story-open]').count())) await page.locator('[data-story]').first().click(); // actions live in the opened card
    await page.locator('[data-act=edit]').first().click();
    await page.waitForSelector('[data-refine-box]');
    const cost = () => page.locator('[role=dialog]', { hasText: '예상 비용' }); // the cost confirmation, not the edit dialog under it
    const before = (await page.locator('[data-edit-storyline]').inputValue());
    // an empty instruction is refused on the spot
    await page.locator('[data-refine-run]').click();
    await page.waitForSelector('.toast.err');
    assert.equal(a.refineCalls().length, 0);
    // cancel at the cost dialog: nothing is sent, the button comes back
    await page.locator('[data-refine-instruction]').fill('대결을 바꿔줘. 각자 배수구를 청소하고…');
    await page.locator('[data-refine-run]').click();
    await cost().waitFor();
    await cost().getByRole('button', { name: /취소/ }).click();
    await page.waitForFunction(() => !document.querySelector('[data-refine-run][aria-busy]'));
    assert.equal(a.refineCalls().length, 0, 'cancelled -> nothing sent');
    // confirm, with the AI request held
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/concepts/*/refine', async (route) => { await gate; await route.continue(); });
    await page.locator('[data-refine-run]').click();
    await cost().waitFor();
    await cost().locator('input[type=checkbox]').check();
    await cost().getByRole('button', { name: /다시 쓰기/ }).click();
    await page.waitForFunction(() => /AI 반영 중/.test(document.querySelector('[data-refine-run]').innerText));
    const busy = await page.locator('[data-refine-run]').evaluate((b) => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy') }));
    assert.deepEqual(busy, { disabled: true, busy: 'true' });
    release();
    await page.waitForFunction((t) => document.querySelector('[data-edit-storyline]').value === t, NEW_STORY);
    assert.equal(await page.locator('[data-edit-title]').inputValue(), 'The Drain Duel');
    assert.notEqual(before, NEW_STORY);
    assert.equal(a.refineCalls().length, 1);
    assert.equal(s.storylab.list(pid).concepts.find((c) => c.id === cid).revision, 1, 'the proposal is not saved yet');
    assert.equal(await page.locator('[data-refine-run]').isDisabled(), false, 'the button is back');
    // 저장 -> goes through the normal edit: new revision, approval dropped, Korean outdated
    await page.locator('.modal').getByRole('button', { name: /^저장/ }).click();
    await page.waitForFunction((id) => !document.querySelector('[data-edit-storyline]'), cid);
    const c = s.storylab.list(pid).concepts.find((x) => x.id === cid);
    assert.equal(c.storyline, NEW_STORY); assert.equal(c.revision, 2); assert.equal(c.approved, false); assert.equal(c.needsReapproval, true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
