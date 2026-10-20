'use strict';
// Navigation / catalog / Settings UX refactor, in a real browser: six sidebar items, Product Studio + Story Lab catalog landing pages,
// episode workspace + Video Production tabs, three Settings groups (both prompt tools kept), legacy deep links, data left untouched.
// Nothing here makes a paid call (all providers are mock).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createApp } = require('../studio/server');
const { gotoReady, until } = require('./helpers/route-ready');
const zlib = require('node:zlib');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const ID = 'EP01';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A genuinely decodable PNG (the shared test stub is not), so the browser can really load the catalog thumbnail. */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
function validPng(w = 120, h = 120, rgb = [120, 150, 110]) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
async function readyWithImage(s, name) {
  const p = await s.products.create({ name, code: 'BRV', features: ['자석으로 부착 가능', '장우산과 접이식 우산 수납'], forbiddenClaims: ['방수', '100%'] });
  await s.products.upload(p.id, validPng(), 'a.png');
  await s.products.setStatus(p.id, s.products.get(p.id).images[0].id, 'approved');
  await s.products.approveReferenceSet(p.id, {});
  return p.id;
}

async function boot() {
  const cfg = loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cat-')) }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg });
  // PRD-001 is the seeded legacy product (no image). Add one with a real image + stories, and one without a code or image.
  const withImg = await readyWithImage(s, 'Bravo 우산꽂이');
  await pause(8);
  const plain = (await s.products.create({ name: 'Alpha 매트', features: ['f'] })).id;
  await pause(8);
  const zed = (await s.products.create({ name: 'Zulu 컵', features: ['f'] })).id;
  const lab = await s.storylab.generate(withImg, { category: 'drama', count: 2, maxDurationSec: 45, confirm: {} });
  await s.storylab.approve(withImg, lab.concepts[0].id);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  return { s, cfg, app, browser, ids: { legacy: 'PRD-001', withImg, plain, zed }, titles: lab.concepts.map((c) => c.title), base: `http://127.0.0.1:${app.address().port}` };
}
const newPage = async (browser, viewport = { width: 1280, height: 900 }) => { const page = await (await browser.newContext({ viewport })).newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.errors = errors; return page; };
// Expected name order is computed in the browser itself (same Intl collation the catalog uses; Node's ICU data can differ).
const nameOrder = (page, list, dir = 1) => page.evaluate(([rows, d]) => rows.slice().sort((a, b) => d * String(a.name).localeCompare(String(b.name), 'ko')).map((r) => r.id), [list.map((p) => ({ id: p.id, name: p.name })), dir]);
const items = (page) => page.locator('[data-catalog-item]').evaluateAll((e) => e.map((x) => x.getAttribute('data-catalog-item')));

function snapshot(dir) {
  const out = {};
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) return walk(f);
    out[path.relative(dir, f)] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  });
  walk(dir);
  return out;
}

test('sidebar has exactly six items; episode stages, Video Production tabs and Settings hold the rest, with the right active item', { skip, timeout: 180000 }, async () => {
  const { app, browser, base } = await boot();
  try {
    const page = await newPage(browser);
    await page.goto(`${base}/#/products`);
    await page.waitForSelector('#rail a.nav-item');
    assert.deepEqual(await page.locator('#rail a.nav-item').evaluateAll((e) => e.map((x) => x.getAttribute('data-nav'))), ['products', 'storylab', 'episodes', 'image', 'video', 'settings']);
    assert.deepEqual(await page.locator('#rail a.nav-item .en').allTextContents(), ['Product Studio', 'Story Lab', 'Episodes', 'Image Studio', 'Animation · Voice · Lip Sync · Editing', 'Settings']);
    // product / story rail links open the catalogs, never an editor
    assert.equal(await page.locator('#rail a[data-nav=products]').getAttribute('href'), '#/products');
    assert.equal(await page.locator('#rail a[data-nav=storylab]').getAttribute('href'), '#/storylab');
    // which rail item is active for each (legacy) route
    const activeFor = { [`products`]: 'products', storylab: 'storylab', episodes: 'episodes', [`script/${ID}`]: 'episodes', [`image/${ID}`]: 'image', [`animation/${ID}`]: 'video', [`voice/${ID}`]: 'video', [`lipsync/${ID}`]: 'video', [`render/${ID}`]: 'video', [`review/${ID}`]: 'episodes', [`publishing/${ID}`]: 'episodes', settings: 'settings' };
    for (const [route, key] of Object.entries(activeFor)) {
      await gotoReady(page, base, route);
      await until(page, (k) => { const a = document.querySelector('#rail a[aria-current=page]'); return a && a.getAttribute('data-nav') === k; }, key);
      assert.equal(await page.locator('#rail a[aria-current=page]').count(), 1, route);
      assert.equal(await page.locator('#rail a[aria-current=page]').getAttribute('data-nav'), key, route);
      assert.equal(await page.locator('#stage .banner.err').count(), 0, route + ' rendered an error');
    }
    // Auto DM moved into Settings: the old deep link still works and lands there (with its episode)
    await page.goto(`${base}/#/autodm/${ID}`);
    await page.waitForSelector('[data-autodm-panel]');
    assert.equal(await page.evaluate(() => location.hash), '#/settings/autodm');
    assert.equal(await page.locator('#rail a[aria-current=page]').getAttribute('data-nav'), 'settings');
    // Video Production: four tabs on each studio, rail link opens the last used tab
    for (const v of ['animation', 'voice', 'lipsync', 'render']) {
      await page.goto(`${base}/#/${v}/${ID}`);
      await until(page, (x) => { const b = document.querySelector('[data-video-tabs] button[aria-selected=true]'); return b && b.getAttribute('data-video-tab') === x; }, v);
      assert.deepEqual(await page.locator('[data-video-tabs] button').allTextContents(), ['1. 애니메이션', '2. 보이스', '3. 립싱크', '4. 편집'], v);
      assert.equal(await page.locator('[data-video-tabs] button[aria-selected=true]').getAttribute('data-video-tab'), v);
    }
    await page.goto(`${base}/#/video/${ID}`);
    await page.waitForSelector('[data-video-tabs]');
    assert.equal(await page.evaluate(() => location.hash), `#/render/${ID}`, 'last used tab (Editing)');
    await page.locator('[data-video-tab=voice]').click();
    await page.waitForFunction((id) => location.hash === `#/voice/${id}`, ID);
    await page.locator('#rail a[data-nav=image]').click();
    await page.waitForFunction((id) => location.hash === `#/image/${id}`, ID);
    await page.locator('#rail a[data-nav=video]').click();
    await page.waitForFunction((id) => location.hash === `#/voice/${id}`, ID);
    // Episode workspace: Script Studio, Final Review and Publishing are stages of the selected episode
    await page.goto(`${base}/#/episodes`);
    await page.locator(`[data-open-episode="${ID}"]`).click();
    await page.waitForFunction((id) => location.hash === `#/script/${id}`, ID);
    await page.waitForSelector('[data-episode-flow] a');
    assert.deepEqual(await page.locator('[data-episode-flow] a').evaluateAll((e) => e.map((x) => x.getAttribute('data-flow'))), ['script', 'image', 'video', 'review', 'publishing']);
    assert.equal(await page.locator('[data-episode-flow] a[aria-current=page]').getAttribute('data-flow'), 'script');
    await page.locator('[data-episode-flow] a[data-flow=review]').click();
    await page.waitForFunction((id) => location.hash === `#/review/${id}`, ID);
    await page.locator('[data-episode-flow] a[data-flow=publishing]').click();
    await page.waitForFunction((id) => location.hash === `#/publishing/${id}`, ID);
    await page.locator('[data-episode-flow] a[data-flow=video]').click();
    await page.waitForFunction((id) => /^#\/(animation|voice|lipsync|render)\//.test(location.hash) && location.hash.endsWith(id), ID);
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); app.close(); }
});

test('Product Studio opens the catalog first: real images, grid/list, search, sort, status filter, remembered preferences, opens the editor', { skip, timeout: 180000 }, async () => {
  const { s, app, browser, base, ids } = await boot();
  try {
    const page = await newPage(browser);
    await page.addInitScript((pid) => { try { if (!localStorage.getItem('rf.product')) localStorage.setItem('rf.product', pid); } catch (_) { /* ignore */ } }, ids.withImg);
    await page.goto(`${base}/#/products`);
    await page.waitForSelector('[data-catalog=products] [data-catalog-item]');
    assert.equal(await page.locator('[data-product-summary]').count(), 0, 'no editor opened automatically, even with a remembered product');
    assert.equal((await items(page)).length, 4);
    assert.equal(await page.locator('[data-new-product]').count(), 1, 'a clear create-new-product action');
    // real product image (an existing asset), no placeholder art; products without an image say so
    const card = page.locator(`[data-catalog-item="${ids.withImg}"]`);
    const src = await card.locator('img[data-catalog-img]').getAttribute('src');
    assert.equal(src, s.products.get(ids.withImg).mainImage.url);
    await page.waitForFunction((id) => { const i = document.querySelector(`[data-catalog-item="${id}"] img`); return i && i.complete && i.naturalWidth > 0; }, ids.withImg);
    assert.equal(await page.locator(`[data-catalog-item="${ids.plain}"] img`).count(), 0);
    assert.match(await page.locator(`[data-catalog-item="${ids.plain}"]`).innerText(), /대표 이미지 없음/);
    // grid ↔ list
    assert.equal(await page.locator('[data-catalog-grid]').count(), 1);
    await page.locator('[data-catalog=products] [data-view=list]').click();
    assert.equal(await page.locator('[data-catalog-list]').count(), 1);
    assert.equal(await page.locator('[data-catalog-grid]').count(), 0);
    // preferences survive navigation and reload
    await page.locator('[data-catalog=products] [data-catalog-sort]').selectOption('name-desc');
    assert.deepEqual(await items(page), await nameOrder(page, s.products.list(), -1));
    await page.goto(`${base}/#/episodes`); await page.waitForSelector('#stage h1');
    await page.goto(`${base}/#/products`); await page.waitForSelector('[data-catalog-list]');
    assert.equal(await page.locator('[data-catalog-sort]').inputValue(), 'name-desc');
    await page.reload(); await page.waitForSelector('[data-catalog-list]');
    assert.equal(await page.locator('[data-catalog-sort]').inputValue(), 'name-desc');
    assert.equal(await page.locator('[data-catalog=products] [data-view=list]').getAttribute('aria-pressed'), 'true');
    // sorting
    const sorted = async (k) => { await page.locator('[data-catalog-sort]').selectOption(k); return items(page); };
    assert.deepEqual(await sorted('name-asc'), await nameOrder(page, s.products.list()));
    assert.deepEqual(await sorted('name-desc'), await nameOrder(page, s.products.list(), -1));
    const byCreated = s.products.list().slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.name.localeCompare(b.name, 'ko')).map((p) => p.id);
    assert.deepEqual(await sorted('oldest'), byCreated);
    assert.deepEqual(await sorted('newest'), byCreated.slice().reverse());
    await s.products.edit(ids.legacy, { description: '바뀐 설명' }); // most recently updated goes first
    await page.reload(); await page.waitForSelector('[data-catalog-list]');
    assert.equal((await sorted('recent'))[0], ids.legacy);
    // search by name and by code
    const q = page.locator('[data-catalog-search]');
    await q.fill('bravo');
    assert.deepEqual(await items(page), [ids.withImg]);
    const code = s.products.get(ids.withImg).code;
    await q.fill(code.toLowerCase());
    assert.deepEqual(await items(page), [ids.withImg], 'search by product code');
    await q.fill('nothing-matches');
    await page.waitForSelector('[data-catalog-nomatch]');
    await page.locator('[data-catalog-reset]').click();
    assert.equal((await items(page)).length, 4);
    // status filter
    const readyIds = s.products.list().filter((p) => p.readiness.ok).map((p) => p.id).sort();
    const needsIds = s.products.list().filter((p) => !p.readiness.ok).map((p) => p.id).sort();
    assert.ok(readyIds.includes(ids.withImg) && needsIds.includes(ids.plain), 'fixture has both ready and not-ready products');
    await page.locator('[data-catalog-status]').selectOption('ready');
    assert.deepEqual((await items(page)).sort(), readyIds);
    await page.locator('[data-catalog-status]').selectOption('needs');
    assert.deepEqual((await items(page)).sort(), needsIds);
    await page.locator('[data-catalog-status]').selectOption('');
    // compact list on a card opens the existing editor (and the editor still lists back to the catalog)
    await page.locator(`[data-catalog-item="${ids.withImg}"]`).click();
    await page.waitForSelector('[data-product-summary]');
    assert.equal(await page.evaluate(() => location.hash), '#/products/' + ids.withImg);
    await page.getByRole('button', { name: /^목록/ }).first().click();
    await page.waitForSelector('[data-catalog=products]');
    assert.equal(await page.evaluate(() => location.hash), '#/products');
    // the create action still opens the existing dialog
    await page.locator('[data-new-product]').click();
    await page.waitForSelector('[role=dialog]');
    assert.equal(s.products.list().length, 4, 'opening the dialog creates nothing');
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); app.close(); }
});

test('Story Lab opens the catalog first: thumbnails, story counts, products without stories, search by story title, open editor, back without losing work', { skip, timeout: 180000 }, async () => {
  const { s, app, browser, base, ids, titles } = await boot();
  try {
    const page = await newPage(browser);
    await page.addInitScript((pid) => { try { localStorage.setItem('rf.product', pid); } catch (_) { /* ignore */ } }, ids.withImg);
    await page.goto(`${base}/#/storylab`);
    await page.waitForSelector('[data-catalog=storylab] [data-catalog-item]');
    assert.equal(await page.locator('[data-cast-picker]').count(), 0, 'no story editor opened automatically');
    assert.equal((await items(page)).length, 4);
    const withStories = page.locator(`[data-catalog-item="${ids.withImg}"]`);
    assert.equal(await withStories.getAttribute('data-concepts'), '2');
    assert.match(await withStories.innerText(), /스토리 2개/);
    assert.match(await withStories.innerText(), /승인 1/);
    assert.equal(await withStories.locator('img[data-catalog-img]').getAttribute('src'), s.products.get(ids.withImg).mainImage.url);
    const none = page.locator(`[data-catalog-item="${ids.plain}"]`);
    assert.equal(await none.getAttribute('data-concepts'), '0');
    assert.match(await none.innerText(), /스토리 없음/);
    // same shared component: grid/list, sort, status filter, search (including story titles)
    await page.locator('[data-catalog=storylab] [data-view=list]').click();
    assert.equal(await page.locator('[data-catalog-list]').count(), 1);
    await page.locator('[data-catalog-status]').selectOption('none');
    assert.deepEqual((await items(page)).sort(), [ids.legacy, ids.plain, ids.zed].sort(), 'products without stories are filterable');
    await page.locator('[data-catalog-status]').selectOption('approved');
    assert.deepEqual(await items(page), [ids.withImg]);
    await page.locator('[data-catalog-status]').selectOption('');
    await page.locator('[data-catalog-sort]').selectOption('name-asc');
    assert.deepEqual(await items(page), await nameOrder(page, s.products.list()));
    await page.locator('[data-catalog-search]').fill(titles[1].slice(0, 14));
    assert.deepEqual(await items(page), [ids.withImg], 'search by story title');
    await page.locator('[data-catalog-search]').fill('');
    const before = { products: s.products.list().length, concepts: s.storylab.list(ids.withImg).concepts.length, zedConcepts: s.storylab.list(ids.zed).concepts.length };
    // open a product: the existing Story Lab editor, nothing created
    await page.locator(`[data-catalog-item="${ids.withImg}"]`).click();
    await page.waitForSelector('[data-cast-picker]');
    assert.equal(await page.evaluate(() => location.hash), '#/storylab/' + ids.withImg);
    await page.locator('[data-advanced] summary').click();
    await page.locator('input[aria-label="추가 지시"]').fill('비 오는 날 상황 위주로 (저장 전 메모)');
    await page.locator('[data-cat="drama"]').click();
    // back to the catalog and into the same product: the unsaved form is still there
    await page.locator('[data-lab-back]').click();
    await page.waitForSelector('[data-catalog=storylab]');
    await page.locator(`[data-catalog-item="${ids.withImg}"]`).click();
    await page.waitForSelector('[data-cast-picker]');
    await page.locator('[data-advanced] summary').click();
    assert.equal(await page.locator('input[aria-label="추가 지시"]').inputValue(), '비 오는 날 상황 위주로 (저장 전 메모)');
    assert.equal(await page.locator('[data-cat="drama"]').getAttribute('aria-checked'), 'true');
    // opening a product that has no stories only shows the editor
    await page.locator('[data-lab-back]').click();
    await page.locator(`[data-catalog-item="${ids.zed}"]`).click();
    await page.waitForSelector('[data-cast-picker]');
    assert.deepEqual({ products: s.products.list().length, concepts: s.storylab.list(ids.withImg).concepts.length, zedConcepts: s.storylab.list(ids.zed).concepts.length }, before, 'opening catalog items created no product and no story');
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); app.close(); }
});

test('Settings has three groups with compact one-line secondary navs; both prompt tools and every old tab stay reachable', { skip, timeout: 240000 }, async () => {
  const { app, browser, base } = await boot();
  try {
    const page = await newPage(browser);
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-settings-groups]');
    assert.deepEqual(await page.locator('[data-settings-group]').evaluateAll((e) => e.map((x) => x.getAttribute('data-settings-group'))), ['general', 'ai', 'media']);
    assert.equal(await page.locator('[data-settings-groups] button[aria-selected=true]').getAttribute('data-settings-group'), 'general');
    // every leaf renders its content; the secondary nav never wraps onto a second line
    const leaves = {
      general: { tabs: ['general', 'costs', 'usage'], probe: { general: '인스턴스', costs: '비용 한도와 가격 추정', usage: null } },
      ai: { tabs: ['ai', 'connections', 'prompts', 'autodm'] },
      media: { tabs: ['characters', 'voices', 'endings'] },
    };
    const sel = { general: 'text=렌더링', costs: 'text=비용 한도와 가격 추정', ai: '[data-ai-routing-table]', connections: '[data-muapi-card]', prompts: '[data-prompt-management]', autodm: '[data-autodm-panel]', characters: '[data-character-library]', voices: '[data-voice-connections]', endings: 'text=엔딩' };
    for (const [g, def] of Object.entries(leaves)) {
      await page.locator(`[data-settings-group=${g}]`).click();
      await page.waitForSelector(`[data-settings-sub=${g}]`);
      const tops = await page.locator(`[data-settings-sub=${g}] button`).evaluateAll((e) => e.map((x) => Math.round(x.getBoundingClientRect().top)));
      assert.equal(new Set(tops).size, 1, g + ' secondary nav stays on one line: ' + tops);
      assert.deepEqual(await page.locator(`[data-settings-sub=${g}] button`).evaluateAll((e) => e.map((x) => x.getAttribute('data-settings-tab'))), def.tabs);
      for (const tab of def.tabs) {
        await page.locator(`[data-settings-sub=${g}] [data-settings-tab=${tab}]`).click();
        if (sel[tab]) await page.waitForSelector(sel[tab], { timeout: 20000 });
        assert.equal(await page.evaluate(() => location.hash.split('/')[2]), tab, 'address follows the tab');
        assert.equal(await page.locator('#stage .banner.err').count(), 0, tab + ' rendered an error banner');
      }
    }
    // Prompt Management: two distinct tools (shared AI prompts vs Script Studio presets)
    await page.goto(`${base}/#/settings/prompts`);
    await page.waitForSelector('[data-prompt-management]');
    assert.deepEqual(await page.locator('[data-prompt-tab]').allTextContents(), ['공용 AI 프롬프트', '대본 프리셋']);
    assert.equal(await page.locator('[data-prompt-pane=shared]').count(), 1);
    const sharedText = await page.locator('[data-prompt-pane=shared]').innerText();
    await page.locator('[data-prompt-tab=presets]').click();
    await page.waitForSelector('[data-prompt-pane=presets]');
    assert.equal(await page.locator('[data-prompt-pane=shared]').count(), 0);
    assert.notEqual(await page.locator('[data-prompt-pane=presets]').innerText(), sharedText, 'a different tool with its own data');
    // old deep links
    await page.goto(`${base}/#/settings/scriptprompts`);
    await page.waitForSelector('[data-prompt-pane=presets]');
    await until(page, () => { const b = document.querySelector('[data-settings-sub=ai] [data-settings-tab=prompts]'); return b && b.getAttribute('aria-selected') === 'true'; });
    for (const [old, group] of [['general', 'general'], ['ai', 'ai'], ['connections', 'ai'], ['voices', 'media'], ['prompts', 'ai'], ['endings', 'media'], ['usage', 'general'], ['characters', 'media']]) {
      await page.goto(`${base}/#/settings/${old}`);
      await until(page, ([g, t]) => { const b = document.querySelector(`[data-settings-sub=${g}] [data-settings-tab=${t}]`); return b && b.getAttribute('aria-selected') === 'true'; }, [group, old]).catch((e) => { throw new Error('#/settings/' + old + ': ' + e.message); });
    }
    await page.goto(`${base}/#/characters`);
    await page.waitForSelector('[data-character-library]');
    assert.equal(await page.evaluate(() => location.hash), '#/settings/characters');
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); app.close(); }
});

test('phone width: catalog toolbar, grid, Settings navs and Video Production tabs fit without sideways page scroll', { skip, timeout: 240000 }, async () => {
  const { app, browser, base, ids } = await boot();
  try {
    const page = await newPage(browser, { width: 390, height: 844 });
    const fits = async (what) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, what + ' overflows sideways');
    for (const route of ['products', 'storylab', `products/${ids.withImg}`, `storylab/${ids.withImg}`, 'settings', 'settings/ai', 'settings/prompts', 'settings/characters', `animation/${ID}`, `script/${ID}`]) {
      await gotoReady(page, base, route);
      await page.waitForTimeout(400);
      await fits(route);
    }
    await page.goto(`${base}/#/products`);
    await page.waitForSelector('[data-catalog-item]');
    assert.equal(await page.locator('#tabbar button').count(), 7, 'phone bottom bar: Home + the six sidebar items');
    const cols = await page.locator('[data-catalog-grid]').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 2, 'two-column grid on a phone');
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('[data-settings-groups]');
    const tops = await page.locator('[data-settings-groups] button').evaluateAll((e) => e.map((x) => Math.round(x.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, 'group buttons on one line');
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); app.close(); }
});

test('browsing every route leaves production data and assets exactly as they were', { skip, timeout: 240000 }, async () => {
  const { s, cfg, app, browser, base, ids } = await boot();
  try {
    const page = await newPage(browser);
    await page.goto(`${base}/#/products`); await page.waitForSelector('[data-catalog-item]');
    const before = snapshot(cfg.studioDir);
    const counts = { products: s.products.list().length, episodes: s.store.episodes.list().length, concepts: s.storylab.list(ids.withImg).concepts.length };
    for (const route of ['products', `products/${ids.withImg}`, 'storylab', `storylab/${ids.withImg}`, `storylab/${ids.zed}`, 'episodes', `script/${ID}`, `image/${ID}`, `animation/${ID}`, `voice/${ID}`, `lipsync/${ID}`, `render/${ID}`, `review/${ID}`, `publishing/${ID}`, 'settings', 'settings/ai', 'settings/prompts', 'settings/autodm', 'settings/characters', 'settings/voices']) {
      await gotoReady(page, base, route);
      await page.waitForTimeout(250);
    }
    await page.locator('[data-catalog-search]').count();
    const after = snapshot(cfg.studioDir);
    const changed = Object.keys(Object.assign({}, before, after)).filter((k) => before[k] !== after[k]);
    assert.deepEqual(changed, [], 'files changed by merely navigating');
    assert.deepEqual({ products: s.products.list().length, episodes: s.store.episodes.list().length, concepts: s.storylab.list(ids.withImg).concepts.length }, counts);
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); app.close(); }
});
