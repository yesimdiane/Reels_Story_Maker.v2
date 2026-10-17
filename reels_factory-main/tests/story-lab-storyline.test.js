'use strict';
// Story Lab = storyline development only: title + one English storyline (+ Korean translation), category, max length;
// Edit / Approve / Hold / Delete; versioned approved storylines; safe handoff to the Episode (no paid downstream call).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { make, fakeAi, goodConcepts, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const mkAi = (fn) => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : (fn ? fn(req) : conceptsForPrompt(req)), usage: { inputTokens: 5, outputTokens: 5 } }) });
async function setup(ai = mkAi()) {
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  return Object.assign(m, { pid, ai });
}
const STORY_KEYS = ['title', 'storyline', 'ko', 'koComplete', 'category', 'maxDurationSec'];

test('generation is storyline-only: no hook / payoff / CTA / scene-count / placement fields are requested or stored', async () => {
  // the AI over-delivers the old fields; they must not be stored on a new concept
  const ai = mkAi((req) => { const c = conceptsForPrompt(req); c.concepts.forEach((x) => Object.assign(x, { hook: 'H', payoff: 'P', ctaDirection: 'C', estimatedScenes: 7, productRole: 'R', visualComedy: 'V' })); return c; });
  const { s, pid } = await setup(ai);
  const lab = await s.storylab.generate(pid, { category: 'all', maxDurationSec: 40, confirm: CONFIRM });
  const prompt = ai.calls[0].prompt;
  assert.match(prompt, /ONE polished, coherent English STORYLINE/);
  assert.match(prompt, /Do NOT write a summary, a list of beats, scene numbers, dialogue lines, shot lists, CTA lines or product placement/);
  assert.match(prompt, /MAX_DURATION_SEC: 40/);
  assert.doesNotMatch(prompt, /estimatedScenes|ctaDirection|visualComedy|productRole|FIRST 3 SECONDS/);
  for (const c of lab.concepts) {
    ['hook', 'payoff', 'ctaDirection', 'estimatedScenes', 'productRole', 'visualComedy', 'plot', 'situation'].forEach((k) => assert.equal(c[k], undefined, k + ' is not stored'));
    STORY_KEYS.forEach((k) => assert.notEqual(c[k], undefined, k));
    assert.ok(c.storyline.length >= 40);
  }
});

test('category storytelling strategies are in the request (curiosity, cold open, viral first frame, informational result first, no virality promises)', async () => {
  const { s, pid, ai } = await setup();
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const p = ai.calls[0].prompt;
  assert.match(p, /DRAMA:[^\n]*cold open or a brief flash-forward[^\n]*unanswered question[^\n]*escalation, misdirection, reversals/);
  assert.match(p, /VIRAL:[^\n]*striking first-frame visual[^\n]*replayability[^\n]*visual contrast/);
  assert.match(p, /INFORMATIONAL:[^\n]*useful or surprising RESULT early[^\n]*never invent facts, statistics/);
  assert.match(p, /never promise virality and never invent statistics/i);
  assert.match(p, /OUTPUT ONLY the polished storyline|output ONLY the polished storyline/i);
});

test('Korean translation is saved with the story and read back without another AI call', async () => {
  const { s, pid, ai } = await setup();
  await s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM });
  const calls = ai.calls.length;
  const c = s.storylab.list(pid).concepts[0];
  assert.ok(c.ko.title && c.ko.storyline && c.koComplete);
  assert.ok(fs.readFileSync(path.join(s.cfg.studioDir, 'storylab', pid + '.json'), 'utf8').includes(c.ko.storyline), 'persisted on disk');
  s.storylab.list(pid); s.storylab.list(pid);
  assert.equal(ai.calls.length, calls, 'the translation toggle needs no API call');
  // editing the English keeps the Korean but flags it as outdated
  await s.storylab.edit(pid, c.id, { storyline: c.storyline + ' One more surprising twist arrives at the very end of the story.' });
  const e = s.storylab.list(pid).concepts[0];
  assert.deepEqual(e.koStale, ['storyline']);
  assert.equal(e.ko.storyline, c.ko.storyline);
  assert.equal(ai.calls.length, calls);
});

test('Edit / Hold / Delete (soft) with guards; approved stories are protected', async () => {
  const { s, pid } = await setup();
  const [a, b, c] = (await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM })).concepts;
  await assert.rejects(s.storylab.edit(pid, a.id, { storyline: 'too short' }), (e) => e.code === 'INVALID_CONCEPT');
  await assert.rejects(s.storylab.edit(pid, a.id, { title: '' }), (e) => e.code === 'INVALID_CONCEPT');
  // hold
  await s.storylab.hold(pid, b.id, '나중에');
  assert.equal(s.storylab.list(pid).concepts.find((x) => x.id === b.id).status, 'hold');
  await assert.rejects(s.storylab.approve(pid, b.id), (e) => e.code === 'LOCKED');
  await s.storylab.resume(pid, b.id);
  assert.equal(s.storylab.list(pid).concepts.find((x) => x.id === b.id).status, 'candidate');
  // delete = soft; the record stays on disk and can be restored
  await s.storylab.remove(pid, c.id);
  assert.equal(s.storylab.list(pid).concepts.find((x) => x.id === c.id).status, 'deleted');
  await assert.rejects(s.storylab.approve(pid, c.id), (e) => e.code === 'LOCKED');
  await assert.rejects(s.storylab.remove(pid, c.id), (e) => e.code === 'ALREADY_DELETED');
  await s.storylab.restore(pid, c.id);
  assert.equal(s.storylab.list(pid).concepts.find((x) => x.id === c.id).status, 'candidate');
  // approved: hold / delete need an explicit confirmation; the approval record and approved versions are preserved
  await s.storylab.approve(pid, a.id);
  await assert.rejects(s.storylab.hold(pid, a.id), (e) => e.code === 'APPROVED_LOCKED');
  await assert.rejects(s.storylab.remove(pid, a.id), (e) => e.code === 'APPROVED_LOCKED');
  await s.storylab.hold(pid, a.id, 'why', 'operator', { confirmApproved: true });
  let h = s.storylab.list(pid).concepts.find((x) => x.id === a.id);
  assert.equal(h.status, 'hold'); assert.equal(h.storyVersions.length, 1, 'the approved version is kept'); assert.equal(h.approvalHistory.length, 1);
  await s.storylab.remove(pid, a.id);
  h = s.storylab.list(pid).concepts.find((x) => x.id === a.id);
  assert.equal(h.status, 'deleted'); assert.equal(h.storyVersions.length, 1);
  // a story that already produced an episode is never deleted
  await s.storylab.restore(pid, a.id); await s.storylab.resume(pid, a.id); await s.storylab.approve(pid, a.id);
  await s.createEpisodeFromConcept({ productId: pid, conceptId: a.id });
  await s.storylab.revoke(pid, a.id);
  await assert.rejects(s.storylab.remove(pid, a.id), (e) => e.code === 'IN_USE');
});

test('approved storylines are versioned and immutable; editing creates a new revision that needs a new approval', async () => {
  const { s, pid } = await setup();
  const a = (await s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM })).concepts[0];
  await s.storylab.approve(pid, a.id);
  let c = s.storylab.list(pid).concepts[0];
  assert.equal(c.storyVersions.length, 1);
  assert.equal(c.storyVersions[0].revision, 1);
  const v1 = JSON.stringify(c.storyVersions[0]);
  await s.storylab.edit(pid, a.id, { storyline: 'A completely rewritten storyline with a new twist that nobody saw coming at all.' });
  c = s.storylab.list(pid).concepts[0];
  assert.equal(c.revision, 2); assert.equal(c.approved, false); assert.equal(c.needsReapproval, true);
  assert.equal(JSON.stringify(c.storyVersions[0]), v1, 'the approved v1 snapshot is untouched by the edit');
  await s.storylab.approve(pid, a.id);
  c = s.storylab.list(pid).concepts[0];
  assert.deepEqual(c.storyVersions.map((v) => v.revision), [1, 2]);
  assert.equal(JSON.stringify(c.storyVersions[0]), v1);
  assert.match(c.storyVersions[1].storyline, /completely rewritten/);
});

test('handoff to the Episode is safe: snapshot + max length + category travel along, no AI call, revisions append to the history', async () => {
  const { s, pid, ai } = await setup();
  const a = (await s.storylab.generate(pid, { category: 'viral', maxDurationSec: 33, confirm: CONFIRM })).concepts[0];
  await s.storylab.approve(pid, a.id);
  const calls = ai.calls.length;
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: a.id, requestId: 'r1' });
  assert.equal(ai.calls.length, calls, 'creating the episode makes no AI / paid call');
  assert.equal(await s.createEpisodeFromConcept({ productId: pid, conceptId: a.id, newVersion: true, requestId: 'r1' }), id, 'idempotent retry');
  let ep = s.store.episodes.get(id);
  assert.equal(ep.id, 'UMB-01-V');
  assert.equal(ep.story.revision, 1); assert.equal(ep.story.category, 'viral'); assert.equal(ep.story.maxDurationSec, 33); assert.equal(ep.maxDurationSec, 33);
  assert.equal(ep.story.storyline, a.storyline); assert.ok(ep.story.ko.storyline);
  assert.deepEqual(ep.storyHistory, []);
  // edit + re-approve + regenerate the script → new linked revision; the old snapshot is kept
  await s.storylab.edit(pid, a.id, { storyline: 'Another version of the story that changes the ending and keeps viewers curious until the end.' });
  await s.storylab.approve(pid, a.id);
  await s.scriptgen.generate(id, { confirm: CONFIRM, overwrite: true });
  ep = s.store.episodes.get(id);
  assert.equal(ep.story.revision, 2);
  assert.equal(ep.storyHistory.length, 1); assert.equal(ep.storyHistory[0].revision, 1); assert.equal(ep.storyHistory[0].storyline, a.storyline);
  assert.equal(ep.id, 'UMB-01-V');
});

test('concepts written before storyline-only keep every old field and show a derived storyline (nothing is converted or deleted)', async () => {
  const { s, pid } = await setup();
  const a = (await s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM })).concepts[0];
  const file = path.join(s.cfg.studioDir, 'storylab', pid + '.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = d.concepts[0];
  delete c.storyline; delete c.ko; Object.assign(c, { hook: '첫 3초 훅', situation: '문제 상황', plot: '30~45초 줄거리', payoff: '결말', ctaDirection: 'CTA', estimatedScenes: 6 });
  fs.writeFileSync(file, JSON.stringify(d));
  const v = s.storylab.list(pid).concepts[0];
  assert.equal(v.storylineLegacy, true);
  assert.match(v.storyline, /첫 3초 훅/);
  assert.equal(v.payoff, '결말'); assert.equal(v.estimatedScenes, 6);
  // approving and handing off still works for such a story
  await s.storylab.approve(pid, a.id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: a.id });
  assert.match(s.store.episodes.get(id).story.storyline, /첫 3초 훅/);
  // editing the storyline of a legacy story stores the new text without touching the old fields
  await s.storylab.revoke(pid, a.id);
  await s.storylab.edit(pid, a.id, { storyline: '새로 다시 쓴 스토리라인입니다. 처음의 궁금증이 마지막에 풀리는 이야기로 이어집니다.' });
  const after = s.storylab.list(pid).concepts[0];
  assert.match(after.storyline, /새로 다시 쓴/); assert.equal(after.storylineLegacy, false);
  assert.equal(after.payoff, '결말');
});

test('HTTP: hold / resume / delete / restore routes', async () => {
  const http = require('node:http');
  const { createApp } = require('../studio/server');
  const { s, pid } = await setup();
  const a = (await s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM })).concepts[0];
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    const base = `/api/storylab/${pid}/concepts/${a.id}`;
    assert.equal((await call('POST', base + '/hold', { reason: 'x' })).status, 200);
    assert.equal((await call('POST', base + '/resume')).status, 200);
    assert.equal((await call('DELETE', base)).status, 200);
    assert.equal((await call('DELETE', base)).status, 409);
    assert.equal((await call('POST', base + '/restore')).status, 200);
    assert.equal((await call('PUT', base, { storyline: 'short' })).status, 422);
  } finally { await new Promise((r) => app.close(r)); }
});
