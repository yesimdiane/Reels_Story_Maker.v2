'use strict';
// Script Studio beat cards in a real browser: a written instruction for ONE beat -> cost confirmation -> busy button -> only that beat changes.
// The slow AI is simulated by holding the HTTP request; nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };
const scriptCalls = (a) => a.calls.filter((c) => /CONCEPT_TITLE/.test(c.prompt || ''));

test('beat card: instruction required, unsaved changes block it, cost confirmation, busy button, only that beat is rewritten', { skip, timeout: 180000 }, async () => {
  const a = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  const { s } = make({ ai: a });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const beatTitles = () => { const ep = s.store.episodes.get(id); return Object.fromEntries(Object.entries(ep.comedy_story).map(([k, v]) => [k, v.title_ko])); };
  const before = beatTitles();

  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const cost = () => page.locator('[role=dialog]', { hasText: '예상 비용' });
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    await page.waitForSelector('[data-episode-tools]');
    await page.locator('[data-episode-tools] > summary').click();
    for (const k of ['setup', 'problem', 'absurd_escalation', 'unexpected_twist', 'resolution', 'product_bridge']) assert.equal(await page.locator(`[data-beat-refine="${k}"]`).count(), 1, k + ' has its own instruction box');
    const btn = page.locator('[data-beat-refine="resolution"]');
    // no instruction -> refused on the spot, no AI call
    const n0 = scriptCalls(a).length;
    await btn.click();
    await page.waitForSelector('.toast.err');
    assert.equal(scriptCalls(a).length, n0);
    // unsaved changes in the script block it (the beat's scenes are replaced)
    await page.locator('[data-beat-instruction="resolution"]').fill('결말을 더 따뜻하게 바꿔줘');
    await page.locator('[data-cta-keyword]').fill('다른키워드');
    await btn.click();
    await page.waitForFunction(() => /저장하지 않은 변경/.test(document.body.innerText));
    assert.equal(scriptCalls(a).length, n0, 'blocked by the unsaved change');
    await page.locator('[data-cta-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-cta-save]') && document.querySelector('[data-cta-save]').disabled);
    // cancel at the cost dialog: nothing is sent, the button comes back
    await page.locator('[data-episode-tools] > summary').evaluate((e) => { if (!e.parentElement.open) e.click(); });
    await page.locator('[data-beat-instruction="resolution"]').fill('결말을 더 따뜻하게 바꿔줘');
    await btn.click();
    await cost().waitFor();
    await cost().getByRole('button', { name: /취소/ }).click();
    await page.waitForFunction(() => !document.querySelector('[data-beat-refine][aria-busy]'));
    assert.equal(scriptCalls(a).length, n0, 'cancelled -> nothing sent');
    // confirm, request held -> busy
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/script/regenerate', async (route) => { await gate; await route.continue(); });
    await btn.click();
    await cost().waitFor();
    await cost().locator('input[type=checkbox]').check();
    await cost().getByRole('button', { name: /실행/ }).click();
    await page.waitForFunction(() => /다시 쓰는 중/.test(document.querySelector('[data-beat-refine="resolution"]').innerText));
    assert.deepEqual(await btn.evaluate((b) => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy') })), { disabled: true, busy: 'true' });
    release();
    await page.waitForFunction(() => !document.querySelector('[data-beat-refine][aria-busy]'));
    const last = scriptCalls(a).pop();
    assert.equal(scriptCalls(a).length, n0 + 1, 'exactly one paid request');
    assert.match(last.prompt, /TARGET_BEAT: resolution/); assert.match(last.prompt, /결말을 더 따뜻하게 바꿔줘/);
    const after = beatTitles();
    assert.match(after.resolution, /NEW$/, 'the chosen beat was rewritten');
    for (const k of Object.keys(before)) if (k !== 'resolution') assert.equal(after[k], before[k], k + ' is unchanged');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
