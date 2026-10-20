'use strict';
// Story map as a compact rail: per-step "+ 추가", scenes are INSERTED (never swapped) by drag, a beat's only scene cannot be dragged out,
// and a chip click unfolds + scrolls to its scene card.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };

test('rail: + 추가 per step, insert-by-drag keeps the others in order, lone scene stays, chip click unfolds and scrolls', { skip, timeout: 180000 }, async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const beatsOf = () => { const ep = m.s.store.episodes.get(id); const o = {}; ep.scenes.filter((s) => s.part !== 'B').forEach((s) => { (o[s.beatKey] = o[s.beatKey] || []).push(s.id); }); return o; };
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    await page.locator('[data-structure-map]').waitFor({ state: 'visible' });
    const keys = Object.keys(beatsOf());
    assert.equal(await page.locator('[data-beat-add]').count(), 6, 'one + 추가 per step');

    // + 추가 on the problem step adds a scene to that step
    const before = beatsOf();
    await page.locator('[data-beat-add="problem"]').click();
    await page.waitForFunction(() => /씬을 추가했습니다/.test(document.body.innerText));
    const afterAdd = beatsOf();
    assert.equal(afterAdd.problem.length, before.problem.length + 1);
    const added = afterAdd.problem.find((x) => !before.problem.includes(x));

    // drag the new scene into the setup step: inserted before the first setup scene, the others keep their order
    const firstSetup = before.setup[0];
    const src = page.locator(`[data-structure-map] .scene-chip[data-scene="${added}"]`);
    const dst = page.locator(`[data-structure-map] .scene-chip[data-scene="${firstSetup}"]`);
    await src.dragTo(dst, { targetPosition: { x: 4, y: 2 } });
    await page.waitForFunction(() => /장면 순서를 바꿨습니다/.test(document.body.innerText));
    const afterDrag = beatsOf();
    assert.deepEqual(afterDrag.setup, [added, ...before.setup], 'inserted at the pointer, nothing swapped');
    assert.deepEqual(afterDrag.problem, before.problem, 'the other step is unchanged');

    // a step's only scene cannot be dragged out (no swap, no change)
    const lone = keys.map((k) => afterDrag[k]).find((l) => l.length === 1);
    assert.ok(lone, 'the fixture has a step with a single scene');
    {
      const k = keys.find((x) => afterDrag[x] === lone || (afterDrag[x].length === 1 && afterDrag[x][0] === lone[0]));
      const other = keys.find((x) => x !== k && afterDrag[x].length > 1) || keys.find((x) => x !== k);
      const snapshot = JSON.stringify(beatsOf());
      await page.locator(`[data-structure-map] .scene-chip[data-scene="${lone[0]}"]`).dragTo(page.locator(`[data-structure-map] [data-beat="${other}"]`));
      await page.waitForSelector('.toast.err');
      assert.match(await page.locator('.toast.err').first().innerText(), /유일한 씬/);
      assert.equal(JSON.stringify(beatsOf()), snapshot, 'order unchanged');
    }

    // chip click: the card is unfolded and in view
    const target = before.setup[before.setup.length - 1];
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator(`[data-structure-map] .scene-chip[data-scene="${target}"]`).click();
    await page.waitForFunction((t) => { const c = document.getElementById('script-scene-' + t); if (!c) return false; const r = c.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, target);
    assert.equal(await page.locator(`#script-scene-${target}[data-collapsed]`).count(), 0, 'unfolded');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
