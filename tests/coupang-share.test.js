'use strict';
// Coupang "공유" text → form values. Pure parsing of what the operator copied; nothing is fetched. Plus the real dialog in a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp } = require('../studio/server');
const { setupProduct } = require('./helpers/product-analysis-fixtures');

const core = () => import(path.join(__dirname, '..', 'studio', 'public', 'js', 'coupang-share-core.js'));

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

test('share text: name on the lines around the link, link kept as copied, numbers read from a full product URL', async () => {
  const { parseCoupangShare } = await core();
  assert.deepEqual(parseCoupangShare('쿠쿠 스피드팟 멀티쿠커 5L\nhttps://link.coupang.com/a/cAbCd1'), { name: '쿠쿠 스피드팟 멀티쿠커 5L', url: 'https://link.coupang.com/a/cAbCd1', productNumber: '', itemNumber: '' });
  const full = parseCoupangShare('자석 우산걸이 https://www.coupang.com/vp/products/9738720085?itemId=29146799836&vendorItemId=1 (공유)');
  assert.equal(full.productNumber, '9738720085'); assert.equal(full.itemNumber, '29146799836'); assert.equal(full.name, '자석 우산걸이 (공유)');
  assert.equal(parseCoupangShare('https://m.coupang.com/vm/products/123456789').productNumber, '123456789');
  assert.equal(parseCoupangShare('이름\n\n  https://link.coupang.com/a/x,  \n').url, 'https://link.coupang.com/a/x');
});

test('share text: only coupang.com links are accepted; text without a link, bad URLs and credentials give nothing', async () => {
  const { parseCoupangShare } = await core();
  const none = { name: '', url: '', productNumber: '', itemNumber: '' };
  assert.deepEqual(parseCoupangShare('그냥 상품명만'), none);
  assert.deepEqual(parseCoupangShare('이름 https://evil.example/coupang.com/vp/products/12345'), none);
  assert.deepEqual(parseCoupangShare('이름 https://www.coupang.com.evil.example/a'), none);
  assert.deepEqual(parseCoupangShare('이름 https://user:pw@www.coupang.com/vp/products/12345'), none);
  assert.deepEqual(parseCoupangShare(null), none);
  assert.equal(parseCoupangShare('a'.repeat(500) + ' https://link.coupang.com/a/x').name.length, 200);
});

test('new-product dialog: pasting the share text fills name / link / numbers and the product is created with that name', { skip, timeout: 120000 }, async () => {
  const { s } = await setupProduct();
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/products`);
    await page.locator('[data-new-product]').click();
    await page.locator('[data-share-paste]').fill('쿠쿠 스피드팟 멀티쿠커 5L\nhttps://www.coupang.com/vp/products/9738720085?itemId=29146799836');
    assert.equal(await page.getByLabel('쿠팡 파트너스 제휴 링크').inputValue(), 'https://www.coupang.com/vp/products/9738720085?itemId=29146799836');
    assert.equal(await page.getByLabel('쿠팡 상품번호').inputValue(), '9738720085');
    assert.equal(await page.getByLabel('옵션 / 판매자번호 (선택)').inputValue(), '29146799836');
    assert.match(await page.locator('[data-share-note]').innerText(), /쿠쿠 스피드팟 멀티쿠커 5L/);
    await page.locator('[data-share-paste]').fill('링크 없는 텍스트');
    assert.match(await page.locator('[data-share-note]').innerText(), /링크.*찾지 못했습니다/);
    await page.locator('[data-share-paste]').fill('쿠쿠 스피드팟 멀티쿠커 5L\nhttps://www.coupang.com/vp/products/9738720085?itemId=29146799836');
    const before = s.products.list().length;
    await page.getByRole('button', { name: /제품 찾아서 등록하기/ }).click();
    await page.waitForFunction(() => /#\/products\/PRD-/.test(location.hash));
    const created = s.products.list().find((p) => p.name === '쿠쿠 스피드팟 멀티쿠커 5L');
    assert.ok(created, 'the product was created with the name from the share text, even if the page fetch is blocked');
    assert.equal(s.products.list().length, before + 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
