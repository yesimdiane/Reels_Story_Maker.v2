'use strict';
// Scene card header: 접기/펼치기 (any scene), 씬 복제, 씬 추가, 삭제 (with confirmation; refuses a step's only scene).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { gotoReady } = require('./helpers/route-ready');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };

test('scene header: collapse/expand an unapproved scene, delete asks first, a step\'s only scene cannot be deleted', { skip, timeout: 180000 }, async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const eps = () => m.s.store.episodes.get(id);
  const aScenes = () => eps().scenes.filter((x) => x.part !== 'B');
  const sid = aScenes()[0].id;
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    await gotoReady(page, base, `script/${id}`);
    const head = page.locator(`[data-scene-card="${sid}"] .scene-head`);
    await head.waitFor();
    for (const sel of [`[data-scene-collapse="${sid}"]`, `[data-dup-scene="${sid}"]`, `[data-add-scene="${sid}"]`, `[data-scene-delete="${sid}"]`]) assert.equal(await head.locator(sel).count(), 1, sel + ' sits in the header');
    // collapse an UNAPPROVED scene, then expand it again
    await head.locator(`[data-scene-collapse="${sid}"]`).click();
    await page.locator(`[data-scene-card="${sid}"][data-collapsed]`).waitFor();
    await page.locator(`[data-scene-expand="${sid}"]`).click();
    await page.waitForFunction((s) => document.querySelector(`[data-scene-card="${s}"]`) && !document.querySelector(`[data-scene-card="${s}"][data-collapsed]`), sid);
    // a step's only scene cannot be deleted (no dialog, nothing changes)
    const lone = aScenes().find((x) => aScenes().filter((y) => y.beatKey === x.beatKey).length === 1);
    assert.ok(lone, 'fixture has a step with one scene');
    const n0 = eps().scenes.length;
    await page.locator(`[data-scene-delete="${lone.id}"]`).click();
    await page.waitForSelector('.toast.err');
    assert.match(await page.locator('.toast.err').first().innerText(), /최소 1개/);
    assert.equal(eps().scenes.length, n0);
    // a duplicate can be deleted, but only after confirming
    const r = await m.s.duplicateScene(id, sid);
    await page.reload();
    await page.locator(`[data-scene-delete="${r.newSceneId}"]`).waitFor();
    await page.locator(`[data-scene-delete="${r.newSceneId}"]`).click();
    const dlg = page.locator('[role=dialog]', { hasText: '삭제할까요' });
    await dlg.waitFor();
    await dlg.getByRole('button', { name: '취소' }).click();
    assert.equal(eps().scenes.length, n0 + 1, 'cancel keeps it');
    await page.locator(`[data-scene-delete="${r.newSceneId}"]`).click();
    await dlg.waitFor();
    await dlg.getByRole('button', { name: '삭제' }).click();
    await page.waitForFunction((x) => !document.querySelector(`[data-scene-card="${x}"]`), r.newSceneId);
    assert.equal(eps().scenes.length, n0, 'deleted after confirming');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('deleting the fixed ending: locked -> refused; unlocked -> only a scene that shares its ending shot can go, never the last one of a shot', async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const ep0 = m.s.store.episodes.get(id);
  const e = ep0.scenes.filter((x) => x.part === 'B');
  assert.ok(ep0.ending.structureLocked, 'the ending starts locked');
  await assert.rejects(() => m.s.deleteScene(id, e[0].id), /ENDING_LOCKED|삭제할 수 없습니다/);
  await m.s.store.episodes.update(id, (ep) => {
    ep.ending.structureLocked = false;
    // a shot that was split in two scenes (a long shot is split to stay under 5 s): E4 belongs to the same shot as E3
    ep.scenes.push({ ...JSON.parse(JSON.stringify(e[2])), id: 'E9', manualEdit: true });
  });
  await assert.rejects(() => m.s.deleteScene(id, e[0].id), /SHOT_EMPTY|최소 한 씬/);
  const before = m.s.store.episodes.get(id).scenes.length;
  await m.s.deleteScene(id, 'E9');
  assert.equal(m.s.store.episodes.get(id).scenes.length, before - 1);
  assert.equal(new Set(m.s.store.episodes.get(id).scenes.filter((x) => x.part === 'B').map((x) => x.beatKey)).size, 3, 'the three ending shots stay');
});
