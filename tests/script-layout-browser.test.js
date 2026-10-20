'use strict';
// Script Studio layout: the story map (장면 순서) is the first block, the title banner and the scene-approval chip box are gone on this tab,
// and the regeneration proposal shows a Korean translation next to visual / action.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };

test('script tab: story map first, no title banner / approval chip box; proposal shows Korean visual + action', { skip, timeout: 180000 }, async () => {
  const answer = (req) => {
    const cur = JSON.parse(/CURRENT_SCENE: (\{.*\})/.exec(req.prompt)[1]);
    return { scene: { title_ko: '새로운 장면 제목', visual: `0.0–${cur.durationSec} s: NEW playful framing of the same moment with a clear beginning and end`, visual_ko: `0.0–${cur.durationSec}초: 같은 순간을 새로운 장난스러운 구도로`, action: 'NEW action', action_ko: '새로운 동작', narration: '', lines: cur.lines.slice(0, 1).map((l) => ({ speaker: l.speaker, en: 'Short new line.', ko: '새 자막' })) } };
  };
  const ai = fakeAi({ '*': (req) => ({ text: '', json: /^SCENE_REGENERATION/.test(req.prompt) ? answer(req) : isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const sid = m.s.store.episodes.get(id).scenes.find((x) => x.part !== 'B').id;
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    await page.locator('[data-structure-map]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-studio-approval-overview]').count(), 0, 'no approval chip box on the script tab');
    assert.equal(await page.getByText('PC에서는 S1부터 마지막 씬까지').count(), 0, 'no intro banner');
    const order = await page.evaluate(() => {
      const map = document.querySelector('[data-structure-map]'); const card = document.querySelector('[data-scene-card]');
      return !!(map.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(order, true, 'story map is above the scene cards');
    assert.equal(await page.evaluate(() => !!document.querySelector('[data-episode-tools] [data-structure-map]')), false, 'not duplicated inside the tools fold');
    // Korean translation in the proposal (the paid call still goes through the cost dialog)
    const note = page.locator(`[data-scene-note="${sid}"]`);
    await note.evaluate((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
    await note.fill('더 장난스럽게');
    await page.locator(`[data-scene-regenerate="${sid}"]`).click();
    const cost = page.locator('[role=dialog]', { hasText: '예상 비용' });
    await cost.waitFor();
    await cost.locator('input[type=checkbox]').check();
    await cost.getByRole('button', { name: /생성/ }).last().click();
    await page.locator(`[data-regen-panel="${sid}"]`).waitFor();
    assert.match(await page.locator(`[data-regen-panel="${sid}"] [data-regen-visual-ko]`).innerText(), /새로운 장난스러운 구도/);
    assert.match(await page.locator(`[data-regen-panel="${sid}"] [data-regen-action-ko]`).innerText(), /새로운 동작/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
