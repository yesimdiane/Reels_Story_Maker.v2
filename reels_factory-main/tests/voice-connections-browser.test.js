'use strict';
// Real-browser check of the voice UI: Settings → 음성 연결 never shows secrets, Character Library picks a synced voice,
// Script Studio shows the connected voice with the right links. Faked network; skipped when Playwright is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, readyProduct } = require('./helpers/v23');
const { createApp } = require('../studio/server');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = !pw ? 'playwright not installed' : false;
const KEY = 'hg-secret-key-0001';
const json = (body) => ({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) });
const calls = [];
const fetchFn = async (url, opts = {}) => {
  calls.push(String(url));
  const u = new URL(url);
  if (u.host === 'api.heygen.com') return u.searchParams.get('type') === 'private'
    ? json({ data: [{ voice_id: 'hv_clone_1', name: 'My Cloned Jack', language: 'English', gender: 'male', type: 'private' }], has_more: false })
    : json({ data: [{ voice_id: 'hv_pub_1', name: 'Public Sarah', language: 'English', gender: 'female' }], has_more: false });
  return { status: 404, ok: false, json: async () => ({}), text: async () => '{}' };
};

test('voice settings, character picker and Script Studio status in a browser', { skip, timeout: 120000 }, async () => {
  const m = make({ fetchFn });
  const pid = await readyProduct(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60 });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, {});
  m.s.voiceCatalog.setHeygenKey(KEY);
  await m.s.voiceCatalog.test('heygen'); await m.s.voiceCatalog.sync('heygen');
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await pw.chromium.launch({}); } catch (e) { app.close(); throw e; }
  try {
    const base = `http://127.0.0.1:${app.address().port}/`;
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '#/settings');
    await page.getByRole('tab', { name: /캐릭터 · 미디어/ }).click();
    await page.getByRole('tab', { name: /음성 연결/ }).click();
    await page.waitForSelector('[data-voice-connections] [data-voice-row]');
    const text = await page.locator('body').innerText();
    assert.ok(!text.includes(KEY), 'API key is never shown');
    assert.match(text, /My Cloned Jack/); assert.match(text, /Public Sarah/);
    assert.ok(!(await page.content()).includes(KEY));
    // character picker: choose a synced voice and save it
    await page.goto(base + '#/characters');
    const char = m.s.listCharacters ? m.s.listCharacters()[0] : { id: 'jack' };
    const picker = page.locator(`[data-voice-picker="${char.id}"]`);
    await picker.waitFor();
    await picker.getByRole('button', { name: 'HeyGen', exact: true }).click();
    await picker.locator('[data-voice-select]').selectOption('hv_clone_1');
    await picker.locator('[data-voice-save]').click();
    await page.waitForFunction((cid) => { const el = document.querySelector(`[data-voice-picker="${cid}"]`); return el && /HeyGen · My Cloned Jack/.test(el.innerText); }, char.id);
    assert.equal(m.s.voiceCatalog.status(char.id).state, 'ready');
    assert.equal(await picker.locator('input[type=password], textarea').count(), 0, 'no credential inputs in the Character Library');
    // Script Studio shows provider + voice name, and the link for a character without a voice
    await page.goto(base + '#/script/' + id);
    await page.waitForSelector('[data-asset-strip]');
    const strip = await page.locator('[data-asset-strip]').innerText();
    assert.match(strip, /HeyGen · My Cloned Jack/);
    assert.ok(await page.locator('[data-asset-strip] [data-change-voice]').count() >= 1, 'a character without a voice offers "목소리 변경"');
    assert.deepEqual(errors, []);
    assert.ok(calls.every((u) => !/synthes|speech|tts/i.test(u)), 'no audio was generated');
  } finally { await browser.close(); app.close(); }
});
