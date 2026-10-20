'use strict';
// Script Studio: the ManyChat keyword (required by the server) is visible right under the last story beat; the CTA lines / card length are folded
// and open by themselves on a validation error; the structure map sits at the top of the page. Fake AI: nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { setupEpisode } = require('./helpers/product-analysis-fixtures');
const { conceptsForPrompt } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

async function open(s, id) {
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${app.address().port}`;
  await page.goto(`${base}/#/script/${id}`);
  await page.waitForSelector('[data-cta-box]');
  return { app, browser, page, errors, base };
}

test('the CTA box sits between the last story beat and the fixed ending; only the keyword is open; the structure map is at the top', { skip, timeout: 150000 }, async () => {
  const { s, id } = await setupEpisode({ concepts: conceptsForPrompt });
  const { app, browser, page, errors } = await open(s, id);
  try {
    const layout = await page.evaluate(() => {
      const box = document.querySelector('[data-cta-box]');
      const prev = box.previousElementSibling; const next = box.nextElementSibling;
      const closed = (el) => !!el.closest('details:not([open])');
      return {
        inList: !!box.parentElement.querySelector('[data-scene-card]'),
        prevIsScene: !!prev && prev.hasAttribute('data-scene-card'), nextIsScene: !!next && next.hasAttribute('data-scene-card'),
        prevId: prev && (prev.getAttribute('data-scene-card') || prev.id), nextLocked: !!next && next.hasAttribute('data-scene-locked'),
        keywordHidden: closed(document.querySelector('[data-cta-keyword]')),
        ctaLinesHidden: closed(document.querySelector('[data-cta-details] textarea')),
        ctaDetailsOpen: document.querySelector('[data-cta-details]').open,
        toolsOpen: document.querySelector('[data-episode-tools]').open,
        mapInClosedTools: closed(document.querySelector('[data-structure-map]')),
        keywordCountOnPage: Array.from(document.querySelectorAll('label')).filter((l) => /ManyChat/.test(l.textContent)).length,
      };
    });
    assert.equal(layout.inList, true); assert.equal(layout.prevIsScene, true, 'right after a scene card (the last story beat)');
    assert.equal(layout.nextIsScene, true, 'the ending scenes follow'); assert.equal(layout.nextLocked, true, 'the next card is the fixed ending (locked)');
    assert.equal(layout.keywordHidden, false, 'the keyword is visible without opening anything');
    assert.equal(layout.ctaDetailsOpen, false); assert.equal(layout.ctaLinesHidden, true, 'CTA lines are folded');
    assert.equal(layout.toolsOpen, false); assert.equal(layout.mapInClosedTools, false, 'the structure map is now at the top, not inside the folded tools');
    assert.equal(layout.keywordCountOnPage, 1, 'the keyword field exists once (moved, not duplicated)');
    const lastA = s.store.episodes.get(id).scenes.filter((x) => x.part !== 'B' && x.beatKey === 'product_bridge').pop();
    assert.ok(lastA, 'the fixture has a product bridge scene');
    assert.equal(await page.evaluate((sid) => document.querySelector('[data-cta-box]').previousElementSibling.querySelector(`[data-scene-handle="${sid}"], [data-rf^="S:${sid}:"]`) !== null || document.querySelector('[data-cta-box]').previousElementSibling.id === 'script-scene-' + sid, lastA.id), true, 'the card before the box is the last product-bridge scene');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('editing the keyword saves from the box itself; a CTA line without the keyword opens the folded CTA lines', { skip, timeout: 150000 }, async () => {
  const { s, id } = await setupEpisode({ concepts: conceptsForPrompt });
  const { app, browser, page, errors } = await open(s, id);
  try {
    assert.equal(await page.locator('[data-cta-save]').isDisabled(), true, 'nothing to save yet');
    await page.locator('[data-cta-keyword]').fill('배수');
    assert.equal(await page.locator('[data-cta-save]').isDisabled(), false);
    await page.locator('[data-cta-details] summary').click();
    await page.locator('[data-cta-details] textarea').fill('댓글에 ‘배수’ 남겨주세요');
    await page.locator('[data-cta-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-cta-save]') && document.querySelector('[data-cta-save]').disabled);
    const saved = s.store.episodes.get(id).cta;
    assert.equal(saved.keyword, '배수'); assert.deepEqual(saved.lines, ['댓글에 ‘배수’ 남겨주세요']);
    // a CTA line that does not contain the keyword is a server validation error (CTA_KEYWORD) → the folded lines open by themselves
    // sent from inside the page (same origin): the server's CSRF check rejects bare Node requests
    const r = await page.evaluate(async ([eid]) => {
      const res = await fetch(`/api/episodes/${eid}/script`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-rf-studio': '1' }, body: JSON.stringify({ cta: { lines: ['링크는 설명란에서 확인하세요'], keyword: '배수', durationSec: 3.5 } }) });
      return { ok: res.ok, text: await res.text() };
    }, [id]);
    assert.equal(r.ok, true, r.text);
    await page.reload();
    await page.waitForSelector('[data-cta-box]');
    assert.equal(await page.evaluate(() => document.querySelector('[data-cta-details]').open), true, 'folded CTA lines open when they carry a validation error');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
