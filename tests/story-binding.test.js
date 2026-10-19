'use strict';
// Product Studio → Story Lab hand-off, checked with a fake AI (nothing is billed):
//   * bindingFor(): the 10-part record, legacy keys kept, only APPROVED material (analysis, review research) comes through
//   * the Story Lab prompt: verified facts only, approved review research only, approved reference images attached
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRM, visionRoute, setupProduct } = require('./helpers/product-analysis-fixtures');
const { routePaid } = require('./helpers/v23');

const REVIEW = { summary: '우산이 젖은 채로 놓이는 게 불만', pros: ['자석이라 간편'], cons: ['젖은 우산 물기'], purchaseMotivations: ['현관이 지저분해서'], comicSituations: ['비 오는 날 현관에서 우산이 쓰러지는 소동'], cautions: ['개인 후기'] };
const approveReview = (s, pid, approved) => s.products.mutate(pid, (p) => { p.reviewResearch = { images: [], text: 'x', analysis: REVIEW, approved }; });
const storyCalls = (a) => a.calls.filter((c) => /INPUT DATA \(authoritative\)/.test(c.prompt || ''));

test('bindingFor: 10-part record with the legacy keys; a DRAFT analysis and an unapproved review never come through', async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await approveReview(s, pid, false);
  let b = s.products.bindingFor(pid);
  for (const k of ['product', 'facts', 'reference', 'identity', 'verifiedFacts', 'visualStructure', 'painPoints', 'comedyOpportunities', 'forbidden', 'references']) assert.ok(k in b, k);
  assert.equal(b.identity.productId, pid); assert.deepEqual(b.verifiedFacts, b.facts);
  assert.equal(b.visualStructure.version, null, 'a draft analysis is not exposed'); assert.equal(b.visualStructure.descriptionText, '');
  assert.deepEqual(b.painPoints, []); assert.deepEqual(b.comedyOpportunities, []); assert.deepEqual(b.creativeContext.comicSituations, []);
  assert.ok(b.forbidden.visualNegatives.some((x) => /Never invent|Do not invent|Do not add/i.test(x)), 'fixed visual negatives travel with the binding');
  // approve both → they come through
  await s.productAnalysis.approve(pid, 1); await approveReview(s, pid, true);
  b = s.products.bindingFor(pid);
  assert.equal(b.visualStructure.version, 1); assert.match(b.visualStructure.descriptionText, /PRODUCT STRUCTURE DESCRIPTION/); assert.equal(b.visualStructure.imagesChanged, false);
  assert.deepEqual(b.comedyOpportunities, REVIEW.comicSituations);
  assert.deepEqual(b.painPoints, REVIEW.cons.concat(REVIEW.purchaseMotivations));
  assert.deepEqual(b.forbidden.claims, b.product.forbiddenClaims);
});

test('bindingFor: a product that is not ready is refused with what is missing', async () => {
  const { s } = await setupProduct();
  const p = await s.products.create({ name: '준비 안 된 제품' });
  assert.throws(() => s.products.bindingFor(p.id), (e) => e.code === 'PRODUCT_NOT_READY' && /확인된 기능|참조 이미지/.test(e.message));
});

test('Story Lab prompt: verified facts only, approved review research only, forbidden claims and the approved reference image attached', async () => {
  const { s, a, pid } = await setupProduct();
  routePaid(s);
  await s.products.edit(pid, { specs: s.products.raw(pid).specs.concat([{ text: '완전 방수 보장', verified: false }]) });
  await approveReview(s, pid, false);
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  let prompt = storyCalls(a).slice(-1)[0];
  assert.ok(prompt, 'the story request reached the AI');
  assert.match(prompt.prompt, /VERIFIED_PRODUCT_FACTS/); assert.match(prompt.prompt, /자석으로 부착 가능/);
  assert.doesNotMatch(prompt.prompt, /완전 방수 보장/, 'an unverified claim never reaches the story');
  assert.match(prompt.prompt, /FORBIDDEN_CLAIMS/);
  assert.doesNotMatch(prompt.prompt, /Possible comedy situation/, 'unapproved review research is not sent');
  assert.ok((prompt.images || []).some((i) => /Approved product reference/.test(i.label)), 'the approved reference image is attached');
  // approve the review research → it is sent, labelled as unverified opinion
  await approveReview(s, pid, true);
  await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  prompt = storyCalls(a).slice(-1)[0];
  assert.match(prompt.prompt, /CUSTOMER_REVIEW_RESEARCH \(unverified individual opinions/);
  assert.match(prompt.prompt, /Possible comedy situation: 비 오는 날 현관에서 우산이 쓰러지는 소동/);
  assert.match(prompt.prompt, /Review analysis does not expand VERIFIED_PRODUCT_FACTS/);
});

test('Story Lab requires a ready product: no verified facts or no approved reference set stops generation before any AI call', async () => {
  const { s, a } = await setupProduct();
  routePaid(s);
  const p = await s.products.create({ name: '사실 없는 제품' });
  const before = storyCalls(a).length;
  await assert.rejects(s.storylab.generate(p.id, { category: 'all', confirm: CONFIRM }), (e) => e.code === 'PRODUCT_NOT_READY');
  assert.equal(storyCalls(a).length, before, 'no AI call was made');
});
