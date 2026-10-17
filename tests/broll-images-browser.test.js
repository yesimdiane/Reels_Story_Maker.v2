'use strict';
// Real-browser check of the B-roll "AI 이미지 생성" dialog: editable prompt, reference warning, no generation without an explicit paid click.
const test = require('node:test');
const assert = require('node:assert/strict');
const { approveWithScenes } = require('./helpers/approve');
const { make, readyProduct } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;

test('B-roll card: AI 이미지 생성 opens an editable prompt with an actionable reference warning; nothing is generated', { skip, timeout: 120000 }, async () => {
  const m = make();
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  await approveWithScenes(m.s, id);
  const sc = m.s.store.episodes.get(id).scenes.find((s) => (s.characters || []).length);
  const b = await m.s.sba.saveBroll(id, { sceneId: sc.id, kind: 'reaction', insertAtSec: 0, durationSec: 1, effect: 'quick cut to the listener' });
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/storyboard/${id}`);
    await page.waitForSelector(`[data-sb-tab="${sc.id}"]`);
    await page.locator(`[data-sb-tab="${sc.id}"]`).click();
    await page.locator('[data-panel="cuts"] > summary').click();
    await page.locator(`[data-broll-generate="${b.id}"]`).click();
    const ta = page.locator('[data-broll-ai-prompt]');
    await ta.waitFor();
    assert.match(await ta.inputValue(), /quick cut to the listener/);
    assert.ok(await page.locator('[data-broll-ai-warning]').count() >= 1, 'missing character reference is explained');
    assert.equal(await page.locator('[data-broll-ai-go]').isDisabled(), true, 'cannot generate without references');
    await ta.fill('Custom edited prompt for the reaction shot');
    await page.getByRole('button', { name: /프롬프트 저장/ }).click();
    await page.waitForFunction((bid) => true, b.id);
    await page.waitForTimeout(600);
    assert.equal(m.s.store.episodes.get(id).broll.find((x) => x.id === b.id).imageGen.prompt, 'Custom edited prompt for the reaction shot');
    assert.equal(m.s.store.episodes.get(id).broll.find((x) => x.id === b.id).imageRef == null, true, 'no image was generated');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
