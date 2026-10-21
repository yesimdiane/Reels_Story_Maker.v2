'use strict';
// Camera MOVEMENT choices (video) and SCENE CONTINUITY references (other scenes' generated images ride along with the character / product references).
const test = require('node:test');
const assert = require('node:assert/strict');
const sceneLook = require('../studio/lib/scenelook');
const { CONFIRM, setupEpisode } = require('./helpers/product-analysis-fixtures');
const { approveWithScenes } = require('./helpers/approve');
const { createApp } = require('../studio/server');
const { gotoReady } = require('./helpers/route-ready');

test('promptLines: shot and movement are separate; movement goes to the video prompt, never to a still image', () => {
  const scene = { id: 'S1', elements: [{ id: 'E1', type: 'camera', text: 'Close-up' }, { id: 'E2', type: 'camera', text: 'Camera movement: Dolly In' }] };
  const video = sceneLook.promptLines(scene, { characters: [] });
  assert.ok(video.some((l) => l === 'CAMERA / SHOT: Close-up'));
  assert.ok(video.some((l) => /^CAMERA MOVEMENT .*Dolly In — the camera moves forward/.test(l)));
  const still = sceneLook.promptLines(scene, { characters: [] }, { still: true });
  assert.ok(still.some((l) => l === 'CAMERA / SHOT: Close-up'));
  assert.ok(!still.some((l) => /MOVEMENT|Dolly/.test(l)), 'a still frame never gets a movement');
  assert.equal(sceneLook.CAMERA_MOVES.length, 11);
});

test('cleanSceneRefs: known scenes only, never itself, at most two', () => {
  const known = new Set(['S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(sceneLook.cleanSceneRefs(['S1', 'S1', 'S9', 'S3', 'S4'], 'S3', known), ['S1', 'S4']);
  assert.equal(sceneLook.cleanSceneRefs([], 'S3', known), undefined);
  assert.deepEqual(sceneLook.cleanSceneRefs(undefined, 'S3', known, ['S2']), ['S2'], 'omitted = keep the previous choice');
});

test('a picked scene image is sent as a continuity reference (counted against the model limit); a scene without an image is refused before any call', async () => {
  const { s, a, id } = await setupEpisode();
  const scenes = s.store.episodes.get(id).scenes;
  const [first, second] = [scenes[0].id, scenes[1].id];
  await approveWithScenes(s, id);
  // the saved choice is cleaned: itself and unknown scenes are dropped
  await s.saveScene(id, second, { scene: { sceneRefs: [second, 'S99', first] } });
  assert.deepEqual(s.store.episodes.get(id).scenes.find((x) => x.id === second).sceneRefs, [first]);
  await approveWithScenes(s, id);
  // the picked scene has no image yet → refused up front
  const n0 = a.calls.filter((c) => c.image).length;
  await assert.rejects(() => s.startImages.generate(id, [second], { confirm: CONFIRM, force: true }), (e) => e.code === 'SCENE_REF_MISSING' && /S1/.test(e.message));
  assert.equal(a.calls.filter((c) => c.image).length, n0, 'no paid call');
  // make the first scene's image, then the second one with and without the reference
  await s.startImages.generate(id, [first], { confirm: CONFIRM, force: true });
  const m1 = a.calls.length;
  await s.startImages.generate(id, [second], { confirm: CONFIRM, force: true });
  const withRef = a.calls.slice(m1).find((c) => c.image);
  await s.saveScene(id, second, { scene: { sceneRefs: [] } });
  await approveWithScenes(s, id);
  const m2 = a.calls.length;
  await s.startImages.generate(id, [second], { confirm: CONFIRM, force: true });
  const without = a.calls.slice(m2).find((c) => c.image);
  assert.equal((withRef.images || []).length, (without.images || []).length + 1, 'exactly one more reference image');
  assert.match(String(withRef.prompt), /SCENE CONTINUITY: the attached scene image \(S1\)/);
  assert.ok(!/SCENE CONTINUITY/.test(String(without.prompt)));
  assert.doesNotMatch(String(withRef.prompt), /MOVEMENT/);
});

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

test('Image Studio: camera movement chips and scene-image references are chosen, saved and shown', { skip, timeout: 240000 }, async () => {
  const { s, id } = await setupEpisode();
  const ids = s.store.episodes.get(id).scenes.map((x) => x.id);
  await s.startImages.generate(id, ids.slice(0, 2), { confirm: CONFIRM, force: true });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await gotoReady(page, `http://127.0.0.1:${app.address().port}`, `image/${id}`);
    await page.locator(`[data-sb-tab="${ids[1]}"]`).click();
    const open = (sel) => page.locator(sel).first().evaluate((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
    await page.locator('[data-move-chips]').waitFor({ state: 'attached' });
    await open('[data-move-chips]');
    assert.equal(await page.locator('[data-move-chip]').count(), 11);
    assert.equal(await page.locator('[data-move-chip="static"]').getAttribute('aria-pressed'), 'true', 'static is the default');
    await page.locator('[data-move-chip="pan_left"]').click();
    await page.waitForFunction(() => document.querySelector('[data-move-chip="pan_left"]').getAttribute('aria-pressed') === 'true');
    // scene-image reference: the previous scene is offered as a one-click toggle
    await page.locator('[data-scene-refs]').waitFor({ state: 'attached' });
    await open('[data-scene-refs]');
    await page.locator(`[data-scene-ref-prev="${ids[0]}"]`).check();
    await page.locator(`[data-sb-save-struct="${ids[1]}"]`).click();
    await page.waitForFunction((sid) => { const sc = (window.__ep || {}); return true; }, ids[1]);
    await page.waitForFunction(() => /저장|적용/.test(document.body.innerText) || true);
    for (let k = 0; k < 40; k += 1) { const sc = s.store.episodes.get(id).scenes.find((x) => x.id === ids[1]); if ((sc.sceneRefs || []).length) break; await new Promise((r) => setTimeout(r, 250)); }
    const sc = s.store.episodes.get(id).scenes.find((x) => x.id === ids[1]);
    assert.deepEqual(sc.sceneRefs, [ids[0]]);
    assert.ok((sc.elements || []).some((e) => e.type === 'camera' && e.text === 'Camera movement: Pan Left'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
