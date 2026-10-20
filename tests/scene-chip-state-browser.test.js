'use strict';
// Story-map chips: the state fills the chip, and the ✓ badge stays inside the chip even when the title is long.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };

test('approved chip is filled green and keeps its ✓ inside the chip with a long title', { skip, timeout: 150000 }, async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const sid = m.s.store.episodes.get(id).scenes.find((x) => x.part !== 'B').id;
  await m.s.store.episodes.update(id, (ep) => { ep.scenes.find((x) => x.id === sid).title_ko = '아주아주아주 긴 장면 제목입니다'; });
  await m.s.projects.approveScene(id, sid);
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    const chip = page.locator(`[data-structure-map] .scene-chip[data-scene="${sid}"]`);
    await chip.waitFor();
    const r = await chip.evaluate((el) => {
      const c = el.getBoundingClientRect(); const b = el.querySelector('.tab-badge.ok').getBoundingClientRect();
      return { badgeInside: b.left >= c.left && b.right <= c.right + 0.5 && b.width > 0, bg: getComputedStyle(el).backgroundColor, titleClipped: el.querySelector('.chip-title').scrollWidth > el.querySelector('.chip-title').clientWidth };
    });
    assert.equal(r.badgeInside, true, 'the ✓ is inside the chip');
    assert.equal(r.titleClipped, true, 'the long title is the part that gets clipped (…)');
    assert.equal(r.bg, 'rgb(85, 104, 76)', 'the chip is filled with the approval green');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
