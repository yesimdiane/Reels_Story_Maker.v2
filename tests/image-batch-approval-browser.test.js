'use strict';
// Image Studio: pick cuts (unapproved / approved / all) and request images, approve or cancel the approval in one go;
// the phone bar shows "승인 취소" once the image is approved. Cancelling never deletes an image.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { CONFIRM, setupEpisode } = require('./helpers/product-analysis-fixtures');
const { gotoReady } = require('./helpers/route-ready');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';

test('Image Studio batch: select approved / unapproved cuts, approve and cancel in bulk (with confirmation); the bar offers 승인 취소', { skip, timeout: 240000 }, async () => {
  const { s, id } = await setupEpisode();
  const ids = s.store.episodes.get(id).scenes.map((x) => x.id);
  await s.startImages.generate(id, ids, { confirm: CONFIRM, force: true });
  const state = () => Object.fromEntries(s.store.episodes.get(id).scenes.map((x) => [x.id, !!(x.startImage && x.startImage.approved)]));
  await s.approveStartFrame(id, ids[0], true);
  await s.approveStartFrame(id, ids[1], true);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('[data-sb-image-batch]');
  try {
    await gotoReady(page, `http://127.0.0.1:${app.address().port}`, `image/${id}`);
    await panel.waitFor();
    const checked = () => page.locator('[data-sb-select-cut]').evaluateAll((els) => els.filter((e) => e.checked).map((e) => e.getAttribute('data-sb-select-cut')));
    // approved cuts can be selected now
    await panel.locator('[data-sb-pick-approved]').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-sb-select-cut]:checked').length === n, 2);
    assert.deepEqual((await checked()).sort(), [ids[0], ids[1]].sort());
    assert.match(await panel.locator('[data-sb-revoke-selected]').innerText(), /\(2\)/);
    assert.match(await panel.locator('[data-sb-generate-selected]').innerText(), /\(0\)/, 'approved cuts are protected from image requests');
    // unapproved + all + none
    await panel.locator('[data-sb-pick-unapproved]').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-sb-select-cut]:checked').length === n, ids.length - 2);
    await panel.locator('[data-sb-pick-all]').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-sb-select-cut]:checked').length === n, ids.length);
    await panel.locator('[data-sb-pick-none]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-sb-select-cut]:checked').length === 0);
    // cancel the two approvals in bulk: asks first
    await panel.locator('[data-sb-pick-approved]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-sb-select-cut]:checked').length === 2);
    await panel.locator('[data-sb-revoke-selected]').click();
    const dlg = page.locator('[role=dialog]', { hasText: '승인을 취소할까요' });
    await dlg.waitFor();
    await dlg.getByRole('button', { name: /^취소/ }).click(); // keep them
    assert.equal(state()[ids[0]], true, 'cancelling the dialog keeps the approval');
    await panel.locator('[data-sb-revoke-selected]').click();
    await dlg.waitFor();
    await dlg.getByRole('button', { name: /^승인 취소/ }).click();
    await page.waitForFunction((a) => { const t = document.querySelector(`[data-sb-image-batch] [data-sb-select-cut="${a}"]`); return t && !/승인됨/.test(t.parentElement.innerText); }, ids[0]);
    assert.equal(state()[ids[0]], false); assert.equal(state()[ids[1]], false);
    assert.ok(s.store.episodes.get(id).scenes.find((x) => x.id === ids[0]).startImage, 'the image itself is still there');
    // approve in bulk, then the phone/sticky bar shows the cancel button for an approved image
    await panel.locator('[data-sb-pick-unapproved]').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-sb-select-cut]:checked').length === n, ids.length);
    await panel.locator('[data-sb-approve-selected]').click();
    await page.waitForFunction(() => /승인했습니다/.test(document.body.innerText));
    assert.ok(Object.values(state()).every(Boolean), 'every cut with an image was approved');
    assert.ok(await page.locator('.sb-bar [data-sb-revoke-image]').count() >= 1, 'the bar offers 승인 취소 for an approved image');
    assert.equal(await page.locator('.sb-bar [data-sb-approve-image]').count(), 0, 'no dead approve button next to it');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
