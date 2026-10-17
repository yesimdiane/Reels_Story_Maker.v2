'use strict';
const { approveWithScenes } = require('./helpers/approve');
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, fakeAi, goodConcepts, goodScript, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const paidAi = (conceptFn) => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptFn(req), usage: { inputTokens: 1000, outputTokens: 500 } }) });

test('Story Lab: refuses unless product is ready (verified facts + approved reference set)', async () => {
  const { s } = make();
  const p = await s.products.create({ name: 'x' });
  await assert.rejects(s.storylab.generate(p.id, { category: 'all' }), (e) => e.code === 'PRODUCT_NOT_READY');
  await s.products.edit(p.id, { specs: [{ text: '사실', verified: true }] });
  await assert.rejects(s.storylab.generate(p.id, { category: 'all' }), (e) => e.code === 'PRODUCT_NOT_READY', 'still needs the approved reference set');
});

test('Story Lab: ≥3 distinct concepts via configured provider; inputs include facts, images, character refs, channel, editable prompt; trace stored', async () => {
  const ai = paidAi(() => goodConcepts(3));
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  s.loadDemoReferences && await s.loadDemoReferences();
  routePaid(s);
  await assert.rejects(s.storylab.generate(pid, { category: 'all' }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(ai.calls.length, 0);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  assert.equal(lab.concepts.length, 3);
  const call = ai.calls[0];
  assert.equal(call.provider, 'gemini');
  assert.match(call.prompt, /서울에서 집꾸미기/);
  assert.match(call.prompt, /자석으로 부착 가능/);
  assert.match(call.prompt, /FORBIDDEN_CLAIMS.*방수/);
  assert.ok(call.images.some((i) => /product reference/i.test(i.label)), 'approved product image sent');
  assert.ok(call.images.some((i) => /Character reference sheet for Jack/.test(i.label)) && call.images.some((i) => /for Diane/.test(i.label)), 'Jack & Diane refs sent as identity-only');
  const c = lab.concepts[0];
  assert.equal(c.source.provider, 'gemini');
  assert.equal(c.source.promptVersion, 1);
  assert.ok(c.source.referenceImageIds.length === 1);
});

test('Story Lab: editing the prompt in Settings changes the next generation and the recorded version', async () => {
  const ai = paidAi(() => goodConcepts(3));
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  s.prompts.save('storyConcept', { text: 'CUSTOM-HEAD-WRITER-MARKER for {{CHANNEL}}. Produce {{COUNT}} concepts as JSON {"concepts":[...]} {{EXTRA}}', note: 'test' });
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  assert.match(ai.calls[0].prompt, /CUSTOM-HEAD-WRITER-MARKER/);
  assert.equal(lab.concepts[0].source.promptVersion, 2);
  s.prompts.restore('storyConcept', { toDefault: true });
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  assert.ok(!/CUSTOM-HEAD-WRITER-MARKER/.test(ai.calls[1].prompt));
});

test('Story Lab: invalid AI output is rejected and nothing is saved (too few / duplicates / forbidden claims / "오빠")', async () => {
  for (const bad of [
    () => goodConcepts(2),
    () => { const c = goodConcepts(3); c.concepts[1] = Object.assign({}, c.concepts[0], { title: 'other' }); return c; },
    () => { const c = goodConcepts(3); c.concepts[0].storyline += ' 방수가 100% 됩니다'; return c; },
    () => { const c = goodConcepts(3); c.concepts[0].storyline += ' Diane이 오빠~ 하고 부른다'; return c; },
    () => { const c = goodConcepts(3); delete c.concepts[2].storyline; return c; },
  ]) {
    const ai = paidAi(bad);
    const { s } = make({ ai });
    const pid = await readyProduct(s);
    routePaid(s);
    await assert.rejects(s.storylab.generate(pid, { category: 'all', confirm: CONFIRM }), (e) => e.code === 'CONCEPTS_REJECTED');
    assert.equal(s.storylab.list(pid).concepts.length, 0);
  }
});

test('approval gate: only an approved concept (at its current revision) can create an episode / script; trace record is complete', async () => {
  const ai = paidAi(() => goodConcepts(3));
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const c = lab.concepts[0];
  await assert.rejects(s.createEpisodeFromConcept({ productId: pid, conceptId: c.id }), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  const ap = (await s.storylab.approve(pid, c.id)).concepts.find((x) => x.id === c.id);
  assert.equal(ap.approved, true);
  for (const k of ['productId', 'conceptId', 'revision', 'provider', 'model', 'storyPromptVersion', 'referenceSetId', 'referenceImageIds', 'status', 'by', 'at']) assert.ok(ap.approval[k] !== undefined, k);
  const epId = await s.createEpisodeFromConcept({ productId: pid, conceptId: c.id });
  let ep = s.episodeView(epId);
  assert.equal(ep.derived.concept.approved, true);
  assert.equal(ep.derived.steps.find((x) => x.key === 'concept').state, 'done');
  // generating the script: gated, confirmed, traced
  await assert.rejects(s.scriptgen.generate(epId, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  const r = await s.scriptgen.generate(epId, { confirm: CONFIRM });
  assert.ok(r.validation.ok, JSON.stringify(r.validation.errors));
  ep = s.episodeView(epId);
  assert.equal(ep.scriptSource.conceptId, c.id);
  assert.equal(ep.scriptSource.conceptRevision, 1);
  assert.equal(ep.scriptSource.promptVersion, 1);
  assert.equal(ep.scenes[0].action, 'Jack waves the umbrella away with a smug grin.');
  assert.equal(ep.scenes[0].part, 'A');
  assert.match(ai.calls.at(-1).prompt, /CONCEPT_TITLE/);
  assert.match(ai.calls.at(-1).prompt, /자석으로 부착 가능/);
  assert.ok(s.store.episodes.versions(epId).some((v) => /AI 대본/.test(v.note)), 'version history records the generation');
  // existing script is not silently overwritten
  await assert.rejects(s.scriptgen.generate(epId, { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_EXISTS');
  await s.scriptgen.generate(epId, { confirm: CONFIRM, overwrite: true });
});

test('changing an approved concept requires re-approval and flags the script for regeneration; script approval is blocked meanwhile', async () => {
  const ai = paidAi(() => goodConcepts(3));
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  const c = (await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM })).concepts[0];
  await s.storylab.approve(pid, c.id);
  const epId = await s.createEpisodeFromConcept({ productId: pid, conceptId: c.id });
  await s.scriptgen.generate(epId, { confirm: CONFIRM });
  await approveWithScenes(s, epId);
  assert.equal(s.episodeView(epId).derived.scriptApproved, true);
  await s.storylab.edit(pid, c.id, { storyline: '완전히 다른 결말로 끝나는 새로운 이야기입니다. 처음의 궁금증은 마지막에 풀립니다.' });
  const lab = s.storylab.list(pid).concepts.find((x) => x.id === c.id);
  assert.equal(lab.needsReapproval, true);
  assert.equal(lab.approved, false);
  assert.equal(lab.revision, 2);
  const cs = s.episodeView(epId).derived.concept;
  assert.equal(cs.regenerationRequired, true);
  assert.equal(cs.ok, false);
  await assert.rejects(approveWithScenes(s, epId), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  await assert.rejects(s.scriptgen.generate(epId, { confirm: CONFIRM, overwrite: true }), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  await s.storylab.approve(pid, c.id);
  assert.equal(s.episodeView(epId).derived.concept.regenerationRequired, true, 'still stale until the script is regenerated');
  await assert.rejects(approveWithScenes(s, epId), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  await s.scriptgen.generate(epId, { confirm: CONFIRM, overwrite: true });
  assert.equal(s.episodeView(epId).derived.concept.ok, true);
  await approveWithScenes(s, epId);
});

test('reject/reopen/regenerate keep history; approved concepts cannot be regenerated or rejected silently', async () => {
  let n = 0;
  const ai = paidAi(() => (++n === 1 ? goodConcepts(3) : { concepts: [{ ...goodConcepts(5, '', Array(5).fill('drama')).concepts[4] }] }));
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const [a, b, c] = lab.concepts;
  await s.storylab.reject(pid, b.id, '너무 평범');
  assert.equal(s.storylab.list(pid).concepts.find((x) => x.id === b.id).rejection.reason, '너무 평범');
  await s.storylab.reopen(pid, b.id);
  const after = await s.storylab.regenerate(pid, a.id, { feedback: '더 코믹하게', confirm: CONFIRM });
  assert.equal(after.concepts.find((x) => x.id === a.id).status, 'superseded');
  assert.equal(after.concepts.length, 4);
  assert.ok(/더 코믹하게/.test(ai.calls.at(-1).prompt));
  await s.storylab.approve(pid, c.id);
  await assert.rejects(s.storylab.regenerate(pid, c.id, { confirm: CONFIRM }), (e) => e.code === 'APPROVED_LOCKED');
  await assert.rejects(s.storylab.reject(pid, c.id, ''), (e) => e.code === 'APPROVED_LOCKED');
  await s.storylab.revoke(pid, c.id);
  assert.equal(s.storylab.list(pid).concepts.find((x) => x.id === c.id).status, 'candidate');
});

test('mock (sample) route works without keys, is labelled sample, and records no billable usage', async () => {
  const { s } = make();
  const pid = await readyProduct(s);
  const lab = await s.storylab.generate(pid, { category: 'all' });
  assert.ok(lab.concepts.length >= 3);
  assert.ok(lab.concepts.every((c) => c.sample && /\[Sample\]/.test(c.title) && /\[샘플\]/.test(c.ko.title)));
  await s.usage.flush();
  assert.ok(s.usage.list().every((e) => e.mock));
});

test('legacy migration: EP01 gets a product record, keeps IDs/approvals, is idempotent, and manual episode creation is flagged', async () => {
  const { s } = make();
  assert.ok(s.products.list().some((p) => p.id === 'PRD-001'));
  const before = JSON.stringify(s.store.episodes.get('EP01'));
  assert.deepEqual(s.migrateLegacy(), []);
  assert.equal(JSON.stringify(s.store.episodes.get('EP01')), before, 'episode untouched');
  const v = s.episodeView('EP01');
  assert.equal(v.derived.concept.legacy, true);
  assert.equal(v.derived.steps.find((x) => x.key === 'concept').state, 'done');
  await approveWithScenes(s, 'EP01'); // legacy approval path still works
  assert.equal(s.episodeView('EP01').derived.scriptApproved, true);
});
