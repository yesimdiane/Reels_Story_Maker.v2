'use strict';
// 씬 복제: copy of the scene right after itself, unapproved, new id, "(컷 N)" title; nothing else copied or changed. Plus a real-browser check of the button and the smooth refresh.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };

async function setup() {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return { m, id };
}

test('duplicateScene: copy lands right after the source, unapproved, with a cut title; the source and the ending are untouched', async () => {
  const { m, id } = await setup();
  const ep0 = m.s.store.episodes.get(id);
  const src = ep0.scenes.find((x) => x.part === 'A');
  const srcJson = JSON.stringify(src);
  const srcLines = ep0.lines.filter((l) => l.sceneId === src.id);
  const r = await m.s.duplicateScene(id, src.id);
  const ep = m.s.store.episodes.get(id);
  const copy = ep.scenes.find((x) => x.id === r.newSceneId);
  assert.ok(copy && copy.id !== src.id);
  assert.equal(ep.scenes.indexOf(copy), ep.scenes.indexOf(ep.scenes.find((x) => x.id === src.id)) + 1);
  assert.match(copy.title_ko, /\(컷 \d+\)$/);
  assert.ok(copy.title_ko.length <= 24);
  for (const k of ['visual', 'action', 'narration', 'characters', 'beatKey', 'part', 'durationSec', 'showsProduct']) assert.deepEqual(copy[k], src[k], k);
  assert.equal(JSON.stringify(ep.scenes.find((x) => x.id === src.id)), srcJson, 'source unchanged');
  const lines = ep.lines.filter((l) => l.sceneId === copy.id);
  assert.deepEqual(lines.map((l) => [l.speaker, l.en, l.ko]), srcLines.map((l) => [l.speaker, l.en, l.ko]));
  assert.equal(new Set(ep.lines.map((l) => l.id)).size, ep.lines.length, 'unique line ids');
  assert.ok(!(ep.sceneApprovals || {})[copy.id] || !ep.sceneApprovals[copy.id].approved, 'copy is not approved');
  assert.equal(r.scenes.find((x) => x.id === copy.id).sceneApproval ? r.scenes.find((x) => x.id === copy.id).sceneApproval.approved : false, false);
  // a second copy gets the next cut number; the ending cannot be copied
  const r2 = await m.s.duplicateScene(id, src.id);
  assert.notEqual(m.s.store.episodes.get(id).scenes.find((x) => x.id === r2.newSceneId).title_ko, copy.title_ko);
  const b = ep.scenes.find((x) => x.part === 'B');
  await assert.rejects(() => m.s.duplicateScene(id, b.id), /ENDING_LOCKED|엔딩/);
  await assert.rejects(() => m.s.duplicateScene(id, 'S999'), /찾을 수 없/);
});

test('browser: ⎘ 씬 복제 on a scene card adds an unapproved copy right after it without a full reload', { skip, timeout: 180000 }, async () => {
  const { m, id } = await setup();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    const sid = m.s.store.episodes.get(id).scenes.find((x) => x.part === 'A').id;
    const n0 = m.s.store.episodes.get(id).scenes.length;
    await page.evaluate(() => { window.__marker = 1; });
    await page.locator('[data-dup-scene],[data-dup-beat],[data-add-scene]').first().waitFor({ state: 'attached' });
    assert.ok(await page.locator('[data-dup-beat]').count() >= 1, 'beat-level duplicate button exists next to 이 단계에 씬 추가');
    assert.ok(await page.locator('[data-dup-scene]:visible').count() >= 1, 'scene card has a visible duplicate button');
    await page.locator(`[data-dup-scene="${sid}"]:visible`).first().click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-scene-card]').length > n, n0 - 1).catch(() => {});
    await page.waitForFunction(() => document.body.innerText.includes('씬을 복제해'));
    const ep = m.s.store.episodes.get(id);
    assert.equal(ep.scenes.length, n0 + 1);
    assert.equal(await page.evaluate(() => window.__marker), 1, 'no page reload');
    const dup = ep.scenes.find((x) => /\(컷 \d+\)$/.test(x.title_ko));
    assert.ok(dup);
    assert.equal(((ep.sceneApprovals || {})[dup.id] || {}).approved || false, false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
