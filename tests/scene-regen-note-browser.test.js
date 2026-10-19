'use strict';
// Scene editor in a real browser: a plain-language change request next to "씬 다시 생성하기" -> cost confirmation -> busy button -> reviewable proposal.
// The slow AI is simulated by holding the HTTP request; nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../studio/server');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

let pw = null;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (_) { /* next */ } }
const skip = pw ? false : 'playwright not installed';
const CONFIRM = { paid: true, unknownCost: true };
const answer = (req) => {
  const cur = JSON.parse(/CURRENT_SCENE: (\{.*\})/.exec(req.prompt)[1]);
  return { scene: { title_ko: '새로운 장면 제목', visual: `0.0–${cur.durationSec} s: NEW playful framing of the same moment with a clear beginning and end`, action: 'NEW action by ' + cur.characters.join(', '), narration: '', lines: cur.lines.slice(0, 1).map((l) => ({ speaker: l.speaker, en: 'Short new line.', ko: '새 자막' })) } };
};

test('scene card: change request -> cost confirmation -> busy -> proposal; the request is sent, the scene stays until applied; cancel keeps it', { skip, timeout: 180000 }, async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: /^SCENE_REGENERATION/.test(req.prompt) ? answer(req) : isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  const sid = m.s.store.episodes.get(id).scenes.find((x) => x.part !== 'B').id;
  const sceneJson = () => JSON.stringify(m.s.store.episodes.get(id).scenes.find((x) => x.id === sid));
  const before = sceneJson();
  const calls = () => ai.calls.filter((c) => /^SCENE_REGENERATION/.test(c.prompt || ''));

  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const bodies = [];
  page.on('request', (r) => { if (/\/regenerate(\/estimate)?$/.test(r.url())) bodies.push({ url: r.url(), body: r.postData() }); });
  const cost = () => page.locator('[role=dialog]', { hasText: '예상 비용' });
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    const note = page.locator(`[data-scene-note="${sid}"]`);
    await note.waitFor({ state: 'attached' });
    const btn = page.locator(`[data-scene-regenerate="${sid}"]`);
    await note.evaluate((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; }); // the visual section is folded by default
    await note.fill("다이앤의 표정을 더 장난스럽게");
    // cancel at the cost dialog: nothing sent, button back
    await btn.click();
    await cost().waitFor();
    assert.equal((await btn.evaluate((b) => b.disabled)), true, 'disabled while the cost dialog is open');
    await cost().getByRole('button', { name: /취소/ }).click();
    await page.waitForFunction(() => !document.querySelector('[data-scene-regenerate][aria-busy]'));
    assert.equal(calls().length, 0, 'cancelled -> no AI call');
    // confirm with the request held
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/scenes/*/regenerate', async (route) => { await gate; await route.continue(); });
    await btn.click();
    await cost().waitFor();
    await cost().locator('input[type=checkbox]').check();
    await cost().getByRole('button', { name: /생성/ }).last().click();
    await page.waitForFunction((s) => /씬 다시 만드는 중/.test(document.querySelector(`[data-scene-regenerate="${s}"]`).innerText), sid);
    assert.deepEqual(await btn.evaluate((b) => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy') })), { disabled: true, busy: 'true' });
    release();
    await page.locator(`[data-regen-panel="${sid}"]`).waitFor({ timeout: 30000 });
    assert.equal(calls().length, 1, 'exactly one paid request');
    assert.match(calls()[0].prompt, /CHANGE_REQUEST[^\n]*: 다이앤의 표정을 더 장난스럽게/);
    assert.ok(bodies.some((b) => /"note":"다이앤의 표정을 더 장난스럽게"/.test(b.body || '')), 'the note was sent with the request');
    assert.equal(sceneJson(), before, 'the scene is unchanged while the proposal is only a proposal');
    await page.locator(`[data-regen-cancel="${sid}"]`).click();
    await page.waitForFunction((s) => !document.querySelector(`[data-regen-panel="${s}"]`), sid);
    assert.equal(sceneJson(), before, 'cancel keeps the original scene');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
