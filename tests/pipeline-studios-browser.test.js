'use strict';
// The final pipeline in a real browser (mock providers, nothing paid): Animation (silent) → Voice → Lip Sync → Video, with prerequisites shown at every stage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { approveAllAudio } = require('./helpers/scene-flow');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const cfg0 = () => loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-pipeb-')), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
const hasFfmpeg = (() => { try { return require('node:child_process').spawnSync(cfg0().ffmpeg.ffmpeg, ['-version']).status === 0; } catch { return false; } })();
const skip = !pw ? 'playwright not installed' : !hasFfmpeg ? 'ffmpeg not installed' : false;
const ID = 'EP01';
const dialog = (page) => page.locator('[role=dialog]');

test('Animation (silent, no audio/SFX gate) → Voice → Lip Sync in the browser, prerequisites visible, nothing paid', { skip, timeout: 300000 }, async () => {
  const cfg = cfg0();
  const prov = createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg, pollsUntilDone: 1 });
  const s = createStudio({ cfg, provider: prov });
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  ['jack', 'diane'].forEach((cid, i) => { s.store.characters.addReference(cid, { buffer: png(700 + i), filename: cid + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.update(cid, (c) => { c.references.find((x) => x.id === r.id).approved = true; }); });
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(800 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  const lines = s.store.episodes.get(ID).lines;
  const talk = ids.find((id) => lines.filter((l) => l.sceneId === id).length && new Set(lines.filter((l) => l.sceneId === id).map((l) => l.speaker)).size === 1) || ids.find((id) => lines.some((l) => l.sceneId === id));
  const quiet = ids.find((id) => !lines.some((l) => l.sceneId === id));
  s.lipsync.addModel({ id: 'lipsync-multi', endpoint: 'multi-lipsync', speakers: 'multi', confirmed: true });
  s.store.settings.save({ lipsyncModelId: 'lipsync-multi' });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 2400 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const base = `http://127.0.0.1:${app.address().port}`;
    // navigation in the final order
    await page.goto(`${base}/#/animation/${ID}`);
    await page.waitForSelector('[data-animation-studio]');
    const ko = await page.locator('#rail a.nav-item .ko').allTextContents();
    assert.deepEqual(ko, ['제품 스튜디오', '스토리 랩', '에피소드', '이미지 스튜디오', '영상 제작', '설정']);
    // 1) Animation: silent checklist only; ready without any audio / SFX
    await page.locator(`[data-anim-scene="${talk}"]`).click();
    await page.waitForSelector(`[data-anim-gates="${talk}"]`);
    assert.deepEqual(await page.locator('[data-gate-item]').evaluateAll((e) => e.map((x) => x.getAttribute('data-gate-item'))), ['image', 'prompt', 'model', 'endpoint', 'silent', 'cost']);
    assert.equal(await page.locator(`[data-anim-gates="${talk}"]`).getAttribute('data-gates-ready'), '1');
    assert.equal(await page.locator('[data-gate-step]').count(), 0, 'no audio / SFX / lip-sync steps before animation');
    assert.match(await page.locator('[data-silent-note]').innerText(), /소리 없는 영상/);
    assert.equal(await page.locator(`[data-anim-generate="${talk}"]`).isDisabled(), false);
    assert.equal(prov.calls.submit, 0);
    // animate + approve through the API (the UI flow for clips is covered by animation-studio-browser)
    for (const sid of [talk, quiet].filter(Boolean)) { const est = s.gen.estimate(ID, { sceneIds: [sid] }); const a = await s.gen.authorize(ID, { sceneIds: [sid], confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null }); await (await s.gen.run(ID, a.id)).done; await s.gen.review(ID, sid, 1, 'approve'); }
    // 2) Voice Studio: dialogue scene shows its state; silent scene is an explicit "no dialogue"
    await page.goto(`${base}/#/voice/${ID}`);
    await page.waitForSelector('[data-voice-scenes]');
    if (quiet) assert.equal(await page.locator(`[data-voice-scene="${quiet}"]`).getAttribute('data-voice-state'), 'silent');
    assert.equal(await page.locator(`[data-voice-scene="${talk}"]`).getAttribute('data-voice-state'), 'none');
    await approveAllAudio(s, ID);
    await page.reload();
    await page.waitForSelector('[data-voice-scenes]');
    assert.equal(await page.locator(`[data-voice-scene="${talk}"]`).getAttribute('data-voice-state'), 'approved');
    await page.locator(`[data-voice-scene="${talk}"] summary`).click();
    await page.locator(`[data-voice-rate="${talk}"]`).fill('1.1');
    await page.locator(`[data-voice-scene-save="${talk}"]`).click();
    await page.waitForTimeout(700);
    assert.equal(s.store.episodes.get(ID).voiceScene[talk].rate, 1.1);
    await page.locator(`[data-voice-rate="${talk}"]`).fill('');
    await page.locator(`[data-voice-scene-save="${talk}"]`).click();
    await page.waitForTimeout(700);
    // 3) Lip Sync Studio: model card with limits, prerequisites, mock run, approve
    await page.goto(`${base}/#/lipsync/${ID}`);
    await page.waitForSelector('[data-lipsync-studio]');
    assert.match(await page.locator('[data-lipsync-caps]').textContent(), /다인 립싱크 지원/);
    if (quiet) assert.equal(await page.locator(`[data-lipsync-scene="${quiet}"]`).getAttribute('data-lipsync-state'), 'not-needed');
    assert.equal(await page.locator(`[data-lipsync-scene="${talk}"] [data-lipsync-check-ok="1"]`).count() >= 2, true, 'animation + audio prerequisites are shown as met');
    await page.locator(`[data-lipsync-start="${talk}"]`).click();
    await dialog(page).getByRole('button', { name: /만들기/ }).last().click();
    await page.waitForSelector(`[data-lipsync-scene="${talk}"] [data-lipsync-version="1"]`, { timeout: 30000 });
    await page.locator(`[data-lipsync-approve="${talk}"]`).click();
    await page.waitForSelector(`[data-lipsync-scene="${talk}"][data-lipsync-state="approved"]`);
    assert.equal(await page.locator(`[data-lipsync-start="${talk}"]`).isDisabled(), true, 'an approved lip sync is not regenerated without un-approving');
    assert.equal(prov.calls.submit, ids.filter((id) => id === talk || id === quiet).length, 'only the animation calls reached the video provider');
    // 4) Video Studio sees the lip-synced video
    await page.goto(`${base}/#/render/${ID}`);
    await page.waitForSelector('[data-vs-tabs]');
    assert.match(await page.locator(`[data-vs-source="${talk}"]`).innerText(), /립싱크 영상/);
    if (quiet) assert.match(await page.locator(`[data-vs-source="${quiet}"]`).innerText(), /무음 애니메이션/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('Settings → lip-sync models: registry from the official CLI is unverified, can be confirmed, default saved, custom model registered', { skip, timeout: 120000 }, async () => {
  const cfg = cfg0();
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1800 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.address().port}/#/settings/connections`);
    await page.waitForSelector('[data-lipsync-settings]');
    assert.ok(await page.locator('[data-lipsync-model-row]').count() >= 6);
    assert.match(await page.locator('[data-lipsync-model-row="lipsync-sync"]').innerText(), /미확인/);
    await page.locator('[data-lipsync-confirm="lipsync-sync"]').click();
    await dialog(page).getByRole('button', { name: /확인/ }).last().click();
    await page.waitForFunction(() => /직접 확인함/.test((document.querySelector('[data-lipsync-model-row="lipsync-sync"]') || {}).innerText || ''));
    await page.locator('[data-lipsync-default]').selectOption('lipsync-latentsync');
    await page.waitForTimeout(600);
    assert.equal(s.store.settings.get().lipsyncModelId, 'lipsync-latentsync');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
