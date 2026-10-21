'use strict';
// 상단 프로젝트 요약 카드: 5단계 스텝 바 + 진행률 + 단계별 이어하기 버튼; 개발용 메타데이터는 접힌 상세 정보 안에만.
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

test('header: five phases in order, exactly one current, progress is a 0-100 number', async () => {
  const { m, id } = await setup();
  const hd = m.s.episodeView(id).derived.header;
  assert.deepEqual(hd.phases.map((p) => p.label), ['대본', '이미지', '영상 제작', '최종 검토', '게시']);
  assert.equal(hd.phases.filter((p) => p.state === 'current').length, 1);
  const cur = hd.phases.findIndex((p) => p.state === 'current');
  hd.phases.forEach((p, i) => assert.equal(p.state, i < cur ? 'done' : i === cur ? 'current' : 'todo'));
  assert.ok(hd.progressPct >= 0 && hd.progressPct < 100);
  assert.match(hd.progressText, /\d+\/\d+/);
});

test('browser: stepper, progress bar and phase-specific resume button; metadata stays folded', { skip, timeout: 120000 }, async () => {
  const { m, id } = await setup();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const browser = await pw.chromium.launch({});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${app.address().port}/#/script/${id}`);
    await page.locator('[data-ep-stepper]').waitFor();
    assert.equal(await page.locator('[data-ep-stepper] [data-phase]').count(), 5);
    assert.equal(await page.locator('[data-ep-stepper] [data-state="current"]').count(), 1);
    const text = await page.locator('[data-episode-header]').innerText();
    assert.doesNotMatch(text, /승인 \d+\/\d+/);
    assert.doesNotMatch(text, /단계:/);
    assert.match(await page.locator('[data-resume-work]').innerText(), /이어하기/);
    assert.ok(Number(await page.locator('[data-ep-progress] [role=progressbar]').getAttribute('aria-valuenow')) >= 0);
    assert.equal(await page.locator('[data-ep-advanced]').evaluate((d) => d.open), false, 'dev metadata folded');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
