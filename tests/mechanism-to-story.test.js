'use strict';
// Approved, [VERIFIED] product mechanisms / sensory satisfaction reach the Story Lab and Script Studio prompts, and nothing else does.
// Fake AI only: nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRM, GOOD, visionRoute, setupProduct } = require('./helpers/product-analysis-fixtures');
const { routePaid, conceptsForPrompt, isScriptPrompt, png } = require('./helpers/v23');
const { verifiedBehavior } = require('../studio/lib/productanalysis');

const WITH_BEHAVIOR = Object.assign({}, GOOD, { items: GOOD.items.concat([
  { section: 'mechanisms', statement: 'The lid flips open with a hinge on the left edge.', status: 'verified' },
  { section: 'mechanisms', statement: 'A hidden latch may hold the lid shut.', status: 'uncertain' },
  { section: 'satisfaction', statement: 'The magnet pulls the cap flush against the base.', status: 'verified' },
  { section: 'satisfaction', statement: 'A loud click is probably heard when it snaps.', status: 'uncertain' },
]) });
const storyCalls = (a) => a.calls.filter((c) => /INPUT DATA \(authoritative\)/.test(c.prompt || ''));
const scriptCalls = (a) => a.calls.filter((c) => isScriptPrompt(c));

async function ready(opts = {}) {
  const x = await setupProduct(Object.assign({ analysis: () => WITH_BEHAVIOR, concepts: conceptsForPrompt }, opts));
  visionRoute(x.s); routePaid(x.s);
  await x.s.productAnalysis.generate(x.pid, { confirm: CONFIRM });
  return x;
}

test('verifiedBehavior: only [VERIFIED] lines under the mechanism and satisfaction headings', () => {
  const text = ['PRODUCT STRUCTURE DESCRIPTION — x (analysis v1)', '', 'OVERALL SHAPE AND GEOMETRY', '- [VERIFIED] A tall box.',
    '', 'MECHANICAL MOVING PARTS & ACTIONS (OPEN/CLOSE/CLICK/MAGNETIC)', '- [VERIFIED] The lid flips open.', '- [UNCERTAIN] Maybe a latch.',
    '', 'VISUAL & SENSORY SATISFACTION CLUES (CLEANING, SNAPPING, FITTING)', '- [VERIFIED] It snaps flush.',
    '', 'NOT VISIBLE IN THE PHOTOS (do NOT draw or assume):', '- [VERIFIED] not a behaviour line', '', 'NEGATIVE CONSTRAINTS (prevent product morphing):', '- Do not add buttons.'].join('\n');
  assert.deepEqual(verifiedBehavior(text), ['The lid flips open.', 'It snaps flush.']);
  assert.deepEqual(verifiedBehavior(''), []); assert.deepEqual(verifiedBehavior(null), []);
  assert.equal(verifiedBehavior('MECHANICAL MOVING PARTS & ACTIONS (OPEN/CLOSE/CLICK/MAGNETIC)\n' + Array.from({ length: 30 }, (_, i) => `- [VERIFIED] step ${i}`).join('\n')).length, 12, 'capped');
});

test('Story Lab: the approved verified behaviour is sent for the Product Bridge; uncertain and unrelated lines are not', async () => {
  const { s, a, pid } = await ready();
  await s.productAnalysis.approve(pid, 1);
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const prompt = storyCalls(a).slice(-1)[0].prompt;
  assert.match(prompt, /PRODUCT_MECHANISM_DATA \(operator-approved, verified/);
  assert.match(prompt, /- The lid flips open with a hinge on the left edge\./);
  assert.match(prompt, /- The magnet pulls the cap flush against the base\./);
  assert.doesNotMatch(prompt, /hidden latch|loud click/, 'uncertain lines never reach the story');
  assert.doesNotMatch(prompt, /softly rounded corners|Two round screw holes/, 'other analysis sections are not sent here');
});

test('Story Lab: a draft (unapproved) analysis sends no behaviour, only a "do not invent" instruction', async () => {
  const { s, a, pid } = await ready();
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const prompt = storyCalls(a).slice(-1)[0].prompt;
  assert.match(prompt, /PRODUCT_MECHANISM_DATA: none approved\. Do NOT invent/);
  assert.doesNotMatch(prompt, /lid flips open|magnet pulls/);
});

test('Story Lab: what the operator deleted before approving is not sent (the approved TEXT decides, not the stored JSON)', async () => {
  const { s, a, pid } = await ready();
  const text = s.productAnalysis.view(pid).latest.text.split('\n').filter((l) => !/lid flips open/.test(l)).join('\n');
  await s.productAnalysis.edit(pid, 1, text);
  await s.productAnalysis.approve(pid, 1);
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const prompt = storyCalls(a).slice(-1)[0].prompt;
  assert.doesNotMatch(prompt, /lid flips open/); assert.match(prompt, /magnet pulls the cap/);
});

test('Story Lab: when the product images changed after the analysis, its behaviour is not trusted any more', async () => {
  const { s, a, pid } = await ready();
  await s.productAnalysis.approve(pid, 1);
  const img = s.products.get(pid).images[0];
  await s.products.replace(pid, img.id, png(77), 'new.png', { confirm: true });
  const fresh = s.products.get(pid).images.find((i) => i.status === 'pending');
  await s.products.setStatus(pid, fresh.id, 'approved');
  await s.products.approveReferenceSet(pid, {});
  assert.equal(s.products.bindingFor(pid).visualStructure.imagesChanged, true);
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const prompt = storyCalls(a).slice(-1)[0].prompt;
  assert.match(prompt, /PRODUCT_MECHANISM_DATA: none approved/); assert.doesNotMatch(prompt, /lid flips open/);
});

test('Script Studio: the episode keeps the behaviour that was approved when it was created, and the script prompt carries it', async () => {
  const { s, a, pid } = await ready();
  await s.productAnalysis.approve(pid, 1);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  assert.deepEqual(s.store.episodes.get(id).product.verifiedBehavior, ['The lid flips open with a hinge on the left edge.', 'The magnet pulls the cap flush against the base.']);
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const prompt = scriptCalls(a).slice(-1)[0].prompt;
  assert.match(prompt, /PRODUCT_MECHANISM_DATA \(operator-approved/); assert.match(prompt, /The magnet pulls the cap/);
});
