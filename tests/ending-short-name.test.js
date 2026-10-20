'use strict';
// 엔딩 대사용 짧은 이름: the fixed ending speaks the operator's short name; empty = the full product name; the AI cannot override it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { defaultVars } = require('../studio/lib/endingtemplates');
const SF = require('../studio/lib/scriptformula');

const LONG = '일본식 욕실 화장실 배수구 토네이도 필터 역류방지';
const CONFIRM = { paid: true, unknownCost: true };

test('defaultVars: short name is spoken, empty falls back to the full name', () => {
  assert.equal(defaultVars({ name: LONG, shortName: '배수구 필터' }).PRODUCT_NAME, '배수구 필터');
  assert.equal(defaultVars({ name: LONG, shortName: '배수구 필터' }).PRODUCT_NAME_KO, '배수구 필터');
  assert.equal(defaultVars({ name: LONG, shortName: '  ' }).PRODUCT_NAME, LONG);
  assert.equal(defaultVars({ name: LONG }).PRODUCT_NAME, LONG);
});

test('endingVars: the short name beats the AI value, but not a hand-typed variable', () => {
  const ep = { product: { name: LONG, shortName: '배수구 필터' }, ending: { vars: { PRODUCT_NAME: 'AI가 정한 긴 이름 여러 단어', PRODUCT_NAME_KO: 'AI 이름' }, manualVars: [] } };
  assert.equal(SF.endingVars(ep).PRODUCT_NAME, '배수구 필터');
  ep.ending.manualVars = ['PRODUCT_NAME'];
  assert.equal(SF.endingVars(ep).PRODUCT_NAME, 'AI가 정한 긴 이름 여러 단어', 'a hand-typed variable wins');
  assert.equal(SF.endingVars(ep).PRODUCT_NAME_KO, '배수구 필터');
  delete ep.product.shortName;
  assert.equal(SF.endingVars(ep).PRODUCT_NAME_KO, 'AI 이름', 'no short name: unchanged behaviour');
});

test('a new episode snapshots the short name and the ending line is built from it', async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  await m.s.products.edit(pid, { name: LONG, shortName: '배수구 필터' });
  assert.equal(m.s.products.get(pid).shortName, '배수구 필터');
  assert.equal(m.s.products.bindingFor(pid).identity.shortName, '배수구 필터');
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const ep = m.s.store.episodes.get(id);
  assert.equal(ep.product.shortName, '배수구 필터');
  const endLines = ep.lines.filter((l) => ep.scenes.find((s) => s.id === l.sceneId && s.part === 'B'));
  assert.ok(endLines.some((l) => /배수구 필터/.test(l.ko) || /배수구 필터/.test(l.en)), 'the ending speaks the short name');
  assert.ok(!endLines.some((l) => (l.ko + l.en).includes(LONG)), 'the full Coupang name is not spoken');
  // an over-long name is trimmed to 30 characters
  await m.s.products.edit(pid, { shortName: 'x'.repeat(50) });
  assert.equal(m.s.products.get(pid).shortName.length, 30);
});

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

test('Product Studio: the short-name field saves and is remembered', { skip, timeout: 120000 }, async () => {
  const { createApp } = require('../studio/server');
  const { gotoReady } = require('./helpers/route-ready');
  const m = make({ ai: fakeAi({ '*': () => ({ text: '', json: {}, usage: { inputTokens: 1, outputTokens: 1 } }) }) });
  const pid = await readyProduct(m.s);
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await gotoReady(page, `http://127.0.0.1:${app.address().port}`, `products/${pid}`);
    const input = page.locator('[data-product-short-name] input');
    await input.waitFor({ state: 'attached' });
    await input.evaluate((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
    await input.fill('배수구 필터');
    await page.locator('.card:has([data-product-short-name]) .row.end button').last().click();
    await page.waitForFunction(() => /저장했습니다/.test(document.body.innerText));
    assert.equal(m.s.products.get(pid).shortName, '배수구 필터');
    await page.reload();
    await page.locator('[data-product-short-name] input').waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-product-short-name] input').inputValue(), '배수구 필터');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
