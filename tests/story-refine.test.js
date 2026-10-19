'use strict';
// Story Lab "AI 부분 수정": the AI rewrites ONE story from the operator's instruction. It only PROPOSES (nothing is saved); saving goes through the
// normal edit(), so history, re-approval of an approved story and the "outdated" Korean translation behave as they always did. Fake AI: nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRM, GOOD, visionRoute, setupProduct } = require('./helpers/product-analysis-fixtures');
const { routePaid, conceptsForPrompt } = require('./helpers/v23');

const NEW_TITLE = 'The Drain Duel';
const NEW_STORY = 'Diane declares a duel: each of them scrubs their own bathroom drain, fits a fresh filter and takes a shower. Jack swears his is spotless, until the two filters are compared side by side and the evidence is hard to argue with.';
const WITH_BEHAVIOR = Object.assign({}, GOOD, { items: GOOD.items.concat([{ section: 'mechanisms', statement: 'The lid flips open with a hinge on the left edge.', status: 'verified' }]) });

async function ready(opts = {}) {
  const x = await setupProduct(Object.assign({ concepts: conceptsForPrompt, refine: () => ({ title: NEW_TITLE, storyline: NEW_STORY }), analysis: () => WITH_BEHAVIOR }, opts));
  routePaid(x.s); visionRoute(x.s);
  const lab = await x.s.storylab.generate(x.pid, { category: 'all', confirm: CONFIRM });
  return Object.assign(x, { cid: lab.concepts[0].id });
}
const concept = (s, pid, cid) => s.storylab.list(pid).concepts.find((c) => c.id === cid);

test('refine: free estimate, paid call needs confirmation, the answer is a proposal and NOTHING is saved', async () => {
  const { s, a, pid, cid } = await ready();
  const before = concept(s, pid, cid);
  const est = s.storylab.refineEstimate(pid, cid, { instruction: '대결을 바꿔줘' });
  assert.equal(est.conceptId, cid); assert.equal(a.refineCalls().length, 0, 'estimating is free');
  await assert.rejects(s.storylab.refine(pid, cid, { instruction: '대결을 바꿔줘' }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(a.refineCalls().length, 0, 'no paid call without confirmation');
  const r = await s.storylab.refine(pid, cid, { instruction: '대결을 바꿔줘', confirm: CONFIRM });
  assert.equal(a.refineCalls().length, 1); assert.equal(r.title, NEW_TITLE); assert.equal(r.storyline, NEW_STORY); assert.equal(r.changed, true);
  const after = concept(s, pid, cid);
  assert.equal(after.title, before.title); assert.equal(after.storyline, before.storyline); assert.equal(after.revision, before.revision, 'not saved, no new revision');
});

test('refine prompt: the text in the dialog (even unsaved), the instruction, verified facts + approved behaviour, forbidden claims and the story rules', async () => {
  const { s, a, pid, cid } = await ready();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM }); await s.productAnalysis.approve(pid, 1);
  await s.products.edit(pid, { specs: s.products.raw(pid).specs.concat([{ text: '완전 방수 보장', verified: false }]) });
  await s.storylab.refine(pid, cid, { instruction: 'Make the duel about the drains.', title: 'My unsaved title', storyline: 'My unsaved storyline that Jack and Diane argue about all evening long.', confirm: CONFIRM });
  const prompt = a.refineCalls().slice(-1)[0].prompt;
  assert.match(prompt, /TITLE: My unsaved title/); assert.match(prompt, /STORYLINE: My unsaved storyline/, 'refines what the operator sees, not the stored text');
  assert.match(prompt, /OPERATOR INSTRUCTION ---\nMake the duel about the drains\./);
  assert.match(prompt, /VERIFIED_PRODUCT_FACTS/); assert.match(prompt, /PRODUCT_MECHANISM_DATA \(operator-approved/); assert.match(prompt, /lid flips open/);
  assert.match(prompt, /FORBIDDEN_CLAIMS/); assert.match(prompt, /STORY RULES \(mandatory/); assert.match(prompt, /never overrides the rules/);
  assert.doesNotMatch(prompt, /완전 방수 보장/, 'an unverified claim never reaches the AI');
});

test('refine: bad input and unusable answers are refused clearly and nothing is saved', async () => {
  const { s, pid, cid } = await ready();
  await assert.rejects(s.storylab.refine(pid, cid, { instruction: '   ', confirm: CONFIRM }), (e) => e.code === 'EMPTY_INSTRUCTION');
  await assert.rejects(s.storylab.refine(pid, cid, { instruction: 'x'.repeat(1001), confirm: CONFIRM }), (e) => e.code === 'INSTRUCTION_TOO_LONG');
  const short = await ready({ refine: () => ({ title: 'T', storyline: 'too short' }) });
  await assert.rejects(short.s.storylab.refine(short.pid, short.cid, { instruction: 'shorter', confirm: CONFIRM }), (e) => e.code === 'REFINE_REJECTED');
  const junk = await ready({ refine: () => 'not json' });
  await assert.rejects(junk.s.storylab.refine(junk.pid, junk.cid, { instruction: 'x', confirm: CONFIRM }), (e) => e.code === 'REFINE_REJECTED');
  const claim = await ready({ refine: () => ({ title: 'Dry', storyline: 'The umbrella stand is 방수 and Jack is proud of how dry the whole entryway stays all day long, even in heavy rain.' }) });
  await assert.rejects(claim.s.storylab.refine(claim.pid, claim.cid, { instruction: 'x', confirm: CONFIRM }), (e) => e.code === 'REFINE_REJECTED', 'a forbidden claim in the answer is refused');
  s.integrations.setRouting('storyConcepts', { provider: 'mock', model: '' });
  await assert.rejects(s.storylab.refine(pid, cid, { instruction: 'x', confirm: CONFIRM }), (e) => e.code === 'REFINE_MODEL_UNAVAILABLE');
  assert.equal(concept(s, pid, cid).revision, 1, 'nothing was saved');
});

test('approved story: saving the AI proposal makes a new revision, drops the approval (re-approval needed) and marks the Korean text outdated', async () => {
  const { s, pid, cid } = await ready();
  await s.storylab.approve(pid, cid);
  let c = concept(s, pid, cid);
  assert.equal(c.approved, true); assert.ok(c.ko && c.ko.storyline, 'the fixture story has a Korean translation');
  const r = await s.storylab.refine(pid, cid, { instruction: '대결을 바꿔줘', confirm: CONFIRM });
  assert.equal(concept(s, pid, cid).approved, true, 'a proposal alone changes nothing');
  await s.storylab.edit(pid, cid, { title: r.title, storyline: r.storyline }); // what the dialog's 저장 does
  c = concept(s, pid, cid);
  assert.equal(c.storyline, NEW_STORY); assert.equal(c.revision, 2);
  assert.equal(c.approved, false); assert.equal(c.needsReapproval, true);
  assert.ok((c.koStale || []).includes('storyline'), 'Korean translation is marked outdated, not re-translated');
  assert.throws(() => s.storylab.requireApproved(pid, cid), (e) => e.code === 'CONCEPT_NOT_APPROVED');
});
