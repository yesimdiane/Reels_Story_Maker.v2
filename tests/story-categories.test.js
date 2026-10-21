'use strict';
// Story Lab categories: required selector (drama / viral / info / all), count rules enforced in the backend,
// exact category distribution in the AI answer, per-concept category + Korean translation, nothing existing is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { make, fakeAi, goodConcepts, conceptsForPrompt, readyProduct, routePaid } = require('./helpers/v23');
const cats = require('../studio/lib/storycategories');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
const wellBehaved = () => fakeAi({ '*': (req) => ({ text: '', json: conceptsForPrompt(req), usage: { inputTokens: 1000, outputTokens: 500 } }) });
async function setup(ai = wellBehaved()) {
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  return Object.assign(m, { pid, ai });
}
const planOf = (prompt) => /CATEGORY_PLAN:\s*(.+)/.exec(prompt)[1].trim();

test('request rules: category required; 1–5 for a single category (default 1); "all" is always 3', () => {
  const bad = (req, code) => assert.throws(() => cats.resolveRequest(req), (e) => e.code === code, JSON.stringify(req));
  bad({}, 'CATEGORY_REQUIRED'); bad({ category: '' }, 'CATEGORY_REQUIRED'); bad({ count: 3 }, 'CATEGORY_REQUIRED');
  bad({ category: 'comedy' }, 'INVALID_CATEGORY');
  for (const n of [0, -1, 6, 2.5, 'abc', NaN]) bad({ category: 'viral', count: n }, 'INVALID_COUNT');
  assert.deepEqual(cats.resolveRequest({ category: 'drama' }).plan, ['drama'], 'default count is 1');
  for (let n = 1; n <= 5; n++) assert.equal(cats.resolveRequest({ category: 'info', count: n }).plan.length, n);
  assert.equal(cats.resolveRequest({ category: 'viral', count: '2' }).count, 2, 'numeric strings from JSON forms are accepted');
  assert.deepEqual(cats.resolveRequest({ category: 'all' }).plan, ['drama', 'viral', 'info']);
  assert.equal(cats.resolveRequest({ category: 'all', count: 3 }).count, 3);
  bad({ category: 'all', count: 1 }, 'INVALID_COUNT'); bad({ category: 'all', count: 5 }, 'INVALID_COUNT');
  const o = cats.options();
  assert.deepEqual(o.map((x) => x.key), ['drama', 'viral', 'info', 'all']);
  assert.ok(o.every((x) => x.ko && x.en && x.brief && x.goal));
  assert.equal(o[3].fixedCount, true);
});

test('backend refuses an invalid request BEFORE any AI call (no cost, nothing saved)', async () => {
  const { s, pid, ai } = await setup();
  for (const [req, code] of [[{}, 'CATEGORY_REQUIRED'], [{ category: 'drama', count: 0 }, 'INVALID_COUNT'], [{ category: 'drama', count: 6 }, 'INVALID_COUNT'], [{ category: 'all', count: 2 }, 'INVALID_COUNT'], [{ category: 'nope' }, 'INVALID_CATEGORY']]) {
    await assert.rejects(s.storylab.generate(pid, Object.assign({ confirm: CONFIRM }, req)), (e) => e.code === code && e.status === 422, JSON.stringify(req));
    assert.throws(() => s.storylab.estimate(pid, req), (e) => e.code === code, 'the estimate follows the same rules');
  }
  assert.equal(ai.calls.length, 0);
  assert.equal(s.storylab.list(pid).concepts.length, 0);
});

test('one category: default 1 concept; N concepts all carry that category and a Korean translation', async () => {
  const { s, pid, ai } = await setup();
  let lab = await s.storylab.generate(pid, { category: 'viral', confirm: CONFIRM });
  assert.equal(lab.concepts.length, 1);
  assert.equal(planOf(ai.calls[0].prompt), 'viral');
  lab = await s.storylab.generate(pid, { category: 'info', count: 5, confirm: CONFIRM });
  assert.equal(lab.concepts.length, 6);
  assert.equal(planOf(ai.calls[1].prompt), 'info, info, info, info, info');
  assert.deepEqual(lab.concepts.map((c) => c.category), ['viral', 'info', 'info', 'info', 'info', 'info']);
  const c = lab.concepts[1];
  assert.ok(c.ko.title && c.ko.storyline && c.koComplete, 'translations arrive in the same generation request');
  assert.equal(ai.calls.length, 2, 'no separate translation calls');
  assert.match(ai.calls[0].prompt, /VIRAL:/);
  assert.match(ai.calls[0].prompt, /ENGLISH/);
  assert.equal(lab.batches.at(-1).category, 'info');
  assert.deepEqual(lab.batches.at(-1).plan, ['info', 'info', 'info', 'info', 'info']);
  assert.ok(lab.categories.length === 4, 'the list returns the selector options');
});

test('"All": exactly three concepts, one Drama, one Viral, one Informational', async () => {
  const { s, pid, ai } = await setup();
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  assert.equal(planOf(ai.calls[0].prompt), 'drama, viral, info');
  assert.deepEqual(lab.concepts.map((c) => c.category).sort(), ['drama', 'info', 'viral']);
  assert.equal(new Set(lab.concepts.map((c) => c.batchId)).size, 1);
});

test('the AI answer must match the requested distribution exactly — otherwise nothing is saved', async () => {
  const cases = [
    ['all', undefined, () => goodConcepts(3, '', ['drama', 'drama', 'drama']), /카테고리 구성/],
    ['all', undefined, () => goodConcepts(3, '', ['drama', 'viral', 'viral']), /카테고리 구성/],
    ['all', undefined, () => goodConcepts(2, '', ['drama', 'viral']), /정확히 3개/],
    ['all', undefined, () => goodConcepts(4, '', ['drama', 'viral', 'info', 'info']), /정확히 3개/],
    ['all', undefined, () => { const c = goodConcepts(3); delete c.concepts[1].category; return c; }, /카테고리 누락/],
    ['all', undefined, () => { const c = goodConcepts(3); c.concepts[2].category = 'comedy'; return c; }, /알 수 없는 카테고리/],
    ['viral', 2, () => goodConcepts(2, '', ['viral', 'drama']), /카테고리 구성/],
    ['drama', 2, () => goodConcepts(3, '', ['drama', 'drama', 'drama']), /정확히 2개/],
    ['info', 1, () => goodConcepts(0), /정확히 1개/],
  ];
  for (const [category, count, answer, re] of cases) {
    const ai = fakeAi({ '*': () => ({ text: '', json: answer(), usage: { inputTokens: 1, outputTokens: 1 } }) });
    const { s, pid } = await setup(ai);
    await assert.rejects(s.storylab.generate(pid, { category, count, confirm: CONFIRM }), (e) => e.code === 'CONCEPTS_REJECTED' && re.test(e.details.join(' ')), String(re));
    assert.equal(s.storylab.list(pid).concepts.length, 0);
  }
});

test('single category: a missing category in the answer is filled from the request; missing translations do not reject a paid answer', async () => {
  const ai = fakeAi({ '*': () => { const c = goodConcepts(2, '', ['info', 'info']); c.concepts.forEach((x) => { delete x.category; delete x.title_ko; }); return { text: '', json: c, usage: { inputTokens: 1, outputTokens: 1 } }; } });
  const { s, pid } = await setup(ai);
  const lab = await s.storylab.generate(pid, { category: 'info', count: 2, confirm: CONFIRM });
  assert.deepEqual(lab.concepts.map((c) => c.category), ['info', 'info']);
  assert.equal(lab.concepts[0].koComplete, false);
});

test('existing concepts and approved story versions are preserved when generating more', async () => {
  const { s, pid } = await setup();
  const first = (await s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM })).concepts[0];
  await s.storylab.approve(pid, first.id);
  const before = JSON.stringify(s.storylab.list(pid).concepts[0]);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  assert.equal(lab.concepts.length, 4);
  assert.equal(JSON.stringify(lab.concepts[0]), before, 'the approved concept is untouched');
  assert.equal(lab.concepts[0].approved, true);
  assert.deepEqual(lab.batches.map((b) => b.id), ['B01', 'B02']);
});

test('estimate returns the plan summary and cost; the real call needs paid confirmation', async () => {
  const { s, pid, ai } = await setup();
  const e = s.storylab.estimate(pid, { category: 'all' });
  assert.equal(e.count, 3);
  assert.deepEqual(e.plan, ['drama', 'viral', 'info']);
  assert.match(e.summary, /반전형 생활 개그 1개/);
  assert.match(e.summary, /바이럴형 1개/);
  assert.match(e.summary, /신뢰·정보형 1개/);
  assert.ok(s.storylab.estimate(pid, { category: 'drama', count: 4 }).usd == null || s.storylab.estimate(pid, { category: 'drama', count: 4 }).usd > s.storylab.estimate(pid, { category: 'drama', count: 1 }).usd, 'cost grows with the count');
  await assert.rejects(s.storylab.generate(pid, { category: 'viral' }), (err) => err.code === 'CONFIRM_REQUIRED');
  assert.equal(ai.calls.length, 0);
});

test('regenerating one concept keeps its category (concepts from before categories are regenerated as Drama)', async () => {
  const fresh = () => goodConcepts(5, '', Array(5).fill('x')).concepts[4];
  const ai3 = fakeAi({ '*': (req) => (/Replace the concept/.test(req.prompt) ? { text: '', json: { concepts: [Object.assign(fresh(), { category: planOf(req.prompt) })] }, usage: { inputTokens: 1, outputTokens: 1 } } : { text: '', json: conceptsForPrompt(req), usage: { inputTokens: 1, outputTokens: 1 } }) });
  const m3 = await setup(ai3);
  const l3 = await m3.s.storylab.generate(m3.pid, { category: 'all', confirm: CONFIRM });
  const v3 = l3.concepts.find((c) => c.category === 'viral');
  const after = await m3.s.storylab.regenerate(m3.pid, v3.id, { confirm: CONFIRM });
  assert.equal(planOf(ai3.calls.at(-1).prompt), 'viral');
  assert.equal(after.concepts.at(-1).category, 'viral');
  assert.equal(after.concepts.find((c) => c.id === v3.id).status, 'superseded');
  // a concept stored before categories existed
  const file = path.join(m3.cfg.studioDir, 'storylab', m3.pid + '.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const legacy = d.concepts.find((c) => c.category === 'drama');
  delete legacy.category; delete legacy.ko;
  fs.writeFileSync(file, JSON.stringify(d));
  await m3.s.storylab.regenerate(m3.pid, legacy.id, { confirm: CONFIRM });
  assert.equal(planOf(ai3.calls.at(-1).prompt), 'drama');
});

test('the mock (sample) route honours categories and counts, in English with Korean sample translations', async () => {
  const { s } = make();
  const pid = await readyProduct(s);
  for (const [category, count, want] of [['viral', 5, Array(5).fill('viral')], ['drama', 1, ['drama']], ['all', undefined, ['drama', 'viral', 'info']]]) {
    const lab = await s.storylab.generate(pid, { category, count });
    const batch = lab.concepts.filter((c) => c.batchId === lab.batches.at(-1).id);
    assert.deepEqual(batch.map((c) => c.category), want);
    assert.ok(batch.every((c) => c.sample && /\[Sample\]/.test(c.title) && /\[샘플\]/.test(c.ko.title)));
  }
});

test('HTTP: estimate / generate enforce the same rules (422) and return categories', async () => {
  const { s, pid } = await setup();
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    assert.equal((await call('POST', `/api/storylab/${pid}/estimate`, {})).status, 422);
    assert.equal((await call('POST', `/api/storylab/${pid}/estimate`, { category: 'all', count: 4 })).status, 422);
    assert.equal((await call('POST', `/api/storylab/${pid}/generate`, { category: 'viral', count: 9, confirm: CONFIRM })).status, 422);
    const est = await call('POST', `/api/storylab/${pid}/estimate`, { category: 'all' });
    assert.equal(est.status, 200);
    assert.equal(est.json.count, 3);
    const gen = await call('POST', `/api/storylab/${pid}/generate`, { category: 'all', confirm: CONFIRM });
    assert.equal(gen.status, 200);
    assert.equal(gen.json.concepts.length, 3);
    assert.equal((await call('GET', `/api/storylab/${pid}`)).json.categories.length, 4);
  } finally { await new Promise((r) => app.close(r)); }
});

test('maximum video length: the operator types seconds (10–90, default 45); the AI is told, a longer concept is only a guide (kept, never refused), the value is stored', async () => {
  const bad = (v) => assert.throws(() => cats.resolveRequest({ category: 'drama', maxDurationSec: v }), (e) => e.code === 'INVALID_DURATION' && e.status === 422, String(v));
  [9, 91, 45.5, 'abc', -5, 0].forEach(bad);
  assert.equal(cats.resolveRequest({ category: 'drama' }).maxDurationSec, 45);
  assert.equal(cats.resolveRequest({ category: 'drama', maxDurationSec: '30' }).maxDurationSec, 30);
  const { s, pid, ai } = await setup();
  await assert.rejects(s.storylab.generate(pid, { category: 'drama', maxDurationSec: 5, confirm: CONFIRM }), (e) => e.code === 'INVALID_DURATION');
  assert.equal(ai.calls.length, 0, 'refused before any AI call');
  assert.equal(s.storylab.estimate(pid, { category: 'drama', maxDurationSec: 30 }).maxDurationSec, 30);
  const lab = await s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: CONFIRM });
  assert.match(ai.calls[0].prompt, /MAX_DURATION_SEC: 60/);
  assert.equal(lab.concepts[0].maxDurationSec, 60);
  assert.equal(lab.batches[0].maxDurationSec, 60);
  // an answer that overshoots the limit is NOT rejected: the maximum is a guide for the AI, the longer estimate is kept
  const ai2 = fakeAi({ '*': () => ({ text: '', json: goodConcepts(1, '', ['drama']), usage: { inputTokens: 1, outputTokens: 1 } }) }); // 40 s
  const m2 = await setup(ai2);
  const over = await m2.s.storylab.generate(m2.pid, { category: 'drama', maxDurationSec: 30, confirm: CONFIRM });
  assert.equal(over.concepts.length, 1, 'accepted although the estimate is above 30 s');
  assert.equal(over.concepts[0].maxDurationSec, 30);
  assert.ok(over.concepts[0].estimatedDurationSec > 30, 'the longer estimate is kept as it is');
  assert.match(ai2.calls[0].prompt, /MAX_DURATION_SEC: 30/, 'the AI is still told the limit');
  // the sample route honours it too
  const m3 = make();
  const p3 = await readyProduct(m3.s);
  const sample = await m3.s.storylab.generate(p3, { category: 'viral', count: 2, maxDurationSec: 20 });
  assert.ok(sample.concepts.every((c) => c.estimatedDurationSec <= 20));
});
