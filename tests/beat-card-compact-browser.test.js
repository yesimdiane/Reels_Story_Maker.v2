'use strict';
// Compact beat cards: one "🪄 AI로 다듬기" button instead of an instruction box, the big text areas folded (still editable), scene buttons carry the real title.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };

test('beat card: AI button only, folded fields stay editable, scene buttons show titles', { skip, timeout: 150000 }, async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    await page.waitForSelector('[data-episode-tools]');
    await page.locator('[data-episode-tools] > summary').click();
    const card = page.locator('[data-rf="B:setup:card"]');
    await card.waitFor();
    assert.equal(await card.locator('[data-beat-refine-open="setup"]').count(), 1);
    assert.equal(await card.locator('textarea[data-beat-instruction]').count(), 0, 'no instruction box inside the card');
    const fields = card.locator('details[data-beat-fields]');
    assert.equal(await fields.evaluate((d) => d.open), false, 'big text areas folded by default');
    // scene buttons show the real title
    const first = m.s.store.episodes.get(id).scenes.find((x) => x.beatKey === 'setup');
    const link = card.locator('button.chip', { hasText: first.id }).first();
    assert.match(await link.innerText(), new RegExp('✏️ ' + first.id + ' ' + (first.title_ko || '').slice(0, 4)));
    // the folded fields are still editable
    await fields.locator('summary').click();
    assert.ok(await fields.locator('textarea').count() >= 2, 'story + visual are reachable');
    // the dialog opens from the button
    await card.locator('[data-beat-refine-open="setup"]').click();
    await page.locator('[data-beat-instruction="setup"]').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
