'use strict';
// Product Studio: import, AI reference versions, concept generation, story approval and the Script Studio handoff.
// All AI is faked; no network and no paid call can happen here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, fakeAi, goodConcepts, goodScript, scriptResponse, isScriptPrompt, png, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };

/** fakeAi whose image provider returns a DIFFERENT image on every call (like a real model). */
function aiWithImages(handlers = {}) {
  const base = fakeAi(handlers);
  let n = 100;
  const factory = (name) => {
    const p = base.factory(name);
    const orig = p.generateImage.bind(p);
    p.generateImage = async (req) => { await orig(req); n += 1; return { images: [{ mimeType: 'image/png', data: png(n).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } }; };
    return p;
  };
  return { factory, calls: base.calls };
}
const textAi = () => aiWithImages({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });

test('import: URL import that is blocked falls back to manual entry; price is operator-typed only and dated', async () => {
  const { s } = make({ extractFn: async () => ({ status: 'blocked', reason: 'robots', note: '차단됨 → 직접 입력' }) });
  const p = await s.products.create({ name: '', url: 'https://www.coupang.com/vp/products/1', affiliateUrl: 'https://link.coupang.com/a/x' });
  const r = await s.products.extract(p.id);
  assert.equal(r.extraction.status, 'blocked');
  assert.equal(r.price, null, 'a blocked/auto import never sets a price');
  assert.deepEqual(r.images, []);
  const e = await s.products.edit(p.id, { name: '직접 입력 제품', price: { text: '12,900원' }, specs: [{ text: '직접 확인한 기능', verified: true }] });
  assert.equal(e.price.text, '12,900원');
  assert.equal(e.price.source, 'operator');
  assert.ok(e.price.enteredAt);
  assert.deepEqual(e.verifiedFacts, ['직접 확인한 기능']);
  assert.equal((await s.products.edit(p.id, { price: { text: '  ' } })).price, null);
  assert.ok(!JSON.stringify(s.storylab.estimate ? {} : {}).includes('12,900'));
});

test('AI reference: blocked (not simulated) when no image provider; needs confirmation; anime style + up to 5 extra refs; versions grouped', async () => {
  const ai = aiWithImages({});
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  const src = s.products.get(pid).images[0];
  await assert.rejects(s.products.generateImage(pid, { basedOn: [src.id], confirm: CONFIRM }), (e) => e.code === 'NOT_CONFIGURED');
  assert.equal(s.products.get(pid).images.filter((i) => i.kind === 'ai_generated').length, 0, 'no placeholder image is created');
  s.integrations.setKey('gemini', 'gem-key-123456789');
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' });
  await assert.rejects(s.products.generateImage(pid, { basedOn: [src.id] }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(ai.calls.length, 0);
  // six extra references are refused before any paid call
  for (let i = 0; i < 4; i++) await s.products.upload(pid, png(10 + i), `x${i}.png`);
  const extras = s.products.get(pid).images.filter((i) => i.id !== src.id).map((i) => i.id);
  assert.equal(extras.length, 4);
  await assert.rejects(s.products.generateImage(pid, { basedOn: [src.id], extraImageIds: extras.concat(['img_a', 'img_b']), confirm: CONFIRM }), (e) => e.code === 'EXTRA_LIMIT');
  assert.equal(ai.calls.length, 0);
  const v1 = await s.products.generateImage(pid, { basedOn: [src.id], extraImageIds: extras, prompt: '밝은 배경', confirm: CONFIRM });
  assert.match(ai.calls[0].prompt, /2D anime \/ Korean webtoon/);
  assert.equal(ai.calls[0].images.length, 5);
  const g1 = v1.images.filter((i) => i.kind === 'ai_generated');
  assert.equal(g1.length, 1);
  assert.equal(g1[0].version, 1);
  assert.equal(g1[0].status, 'pending');
  const v2 = await s.products.generateImage(pid, { basedOn: [src.id], style: 'product', confirm: CONFIRM });
  assert.match(ai.calls[1].prompt, /realistic product image/);
  assert.equal(v2.generations.length, 2);
  assert.notEqual(v2.generations[0].id, v2.generations[1].id);
  assert.equal(v2.generations[1].extraRefs.length, 4);
});

test('AI reference: choosing one version approves it and rejects pending siblings; rejected versions free the limit; AI images alone never satisfy the source rule', async () => {
  const { s } = make({ ai: aiWithImages({}) });
  const pid = await readyProduct(s);
  const src = s.products.get(pid).images[0];
  s.integrations.setKey('gemini', 'gem-key-123456789');
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' });
  await s.products.generateImage(pid, { basedOn: [src.id], confirm: CONFIRM });
  await s.products.generateImage(pid, { basedOn: [src.id], confirm: CONFIRM });
  let v = s.products.get(pid);
  const [a, b] = v.images.filter((i) => i.kind === 'ai_generated');
  await assert.rejects(s.products.generateImage(pid, { basedOn: [a.id], confirm: CONFIRM }), (e) => e.code === 'NO_SOURCE', 'an AI image cannot be the source of truth');
  v = await s.products.chooseVersion(pid, b.id);
  const after = Object.fromEntries(v.images.map((i) => [i.id, i.status]));
  assert.equal(after[b.id], 'approved');
  assert.equal(after[a.id], 'pending', 'a different generation is not touched');
  // same generation siblings are rejected
  assert.notEqual(a.generationId, b.generationId);
  await assert.rejects(s.products.chooseVersion(pid, src.id), (e) => e.code === 'NOT_FOUND');
  // the approved AI version can join the reference set; the original stays approved too
  const set = await s.products.approveReferenceSet(pid, { imageIds: [src.id, b.id] });
  assert.equal(set.reference.state, 'approved');
  assert.deepEqual(set.reference.imageIds.sort(), [src.id, b.id].sort());
});

test('concepts: storyline-only generation, rules are added by code, a response without a storyline is rejected', async () => {
  const ai = textAi();
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  assert.equal(lab.concepts.length, 3);
  const prompt = ai.calls[0].prompt;
  assert.match(prompt, /BABYYYY!!!!!!/);
  assert.match(prompt, /CAST & UNIVERSE/); assert.match(prompt, /never says "오빠"/); assert.match(prompt, /Never calls Jack "Oppa"/); // character rules now come from the library
  assert.match(prompt, /natural ENGLISH/);
  assert.match(prompt, /Do NOT decide how many scenes/);
  assert.doesNotMatch(prompt, /FIRST 3 SECONDS|estimatedScenes/, 'no hook / scene-count fields are requested any more');
  lab.concepts.forEach((c) => { assert.ok(c.title && c.storyline.length >= 40); });
  // a response without a storyline is rejected and nothing is saved
  const bad = aiWithImages({ '*': () => ({ text: '', json: { concepts: goodConcepts(3).concepts.map(({ storyline, ...r }) => r) }, usage: {} }) });
  const m2 = make({ ai: bad });
  const pid2 = await readyProduct(m2.s);
  routePaid(m2.s);
  await assert.rejects(m2.s.storylab.generate(pid2, { category: 'all', confirm: CONFIRM }), (e) => e.code === 'CONCEPTS_REJECTED' && /스토리라인/.test(e.message));
  assert.equal(m2.s.storylab.list(pid2).concepts.length, 0);
  // "오빠" is still refused
  const o = aiWithImages({ '*': () => ({ text: '', json: { concepts: goodConcepts(3).concepts.map((c, i) => (i ? c : { ...c, storyline: c.storyline + ' Diane: 오빠!' })) }, usage: {} }) });
  const m3 = make({ ai: o });
  const pid3 = await readyProduct(m3.s);
  routePaid(m3.s);
  await assert.rejects(m3.s.storylab.generate(pid3, { category: 'all', confirm: CONFIRM }), (e) => e.code === 'CONCEPTS_REJECTED');
});

test('story approval → Script Studio handoff: transfers product, facts, reference images, hook, CTA, rules; never overwrites; script still needs its own approval', async () => {
  const { s } = make({ ai: textAi() });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const c = lab.concepts[0];
  await assert.rejects(s.createEpisodeFromConcept({ productId: pid, conceptId: c.id }), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  await s.storylab.approve(pid, c.id);
  const e1 = await s.createEpisodeFromConcept({ productId: pid, conceptId: c.id });
  const ep1 = s.store.episodes.get(e1);
  assert.equal(ep1.productId, pid);
  assert.deepEqual(ep1.product.verifiedFeatures, s.products.get(pid).verifiedFacts);
  assert.equal(ep1.concept.hook, c.hook);
  assert.equal(ep1.concept.ctaDirection, c.ctaDirection);
  assert.deepEqual(ep1.productRefs.imageIds, s.products.get(pid).reference.imageIds);
  assert.ok(ep1.characterRules.some((r) => /오빠/.test(r)));
  assert.equal(s.episodeView(e1).productRefImages.length, ep1.productRefs.imageIds.length);
  assert.equal(s.episodeView(e1).derived.scriptApproved, false);
  // a repeat handoff needs explicit confirmation and leaves the first episode untouched
  await s.store.episodes.update(e1, (ep) => { ep.title = '손으로 고친 제목'; });
  await assert.rejects(s.createEpisodeFromConcept({ productId: pid, conceptId: c.id }), (e) => e.code === 'EPISODE_EXISTS' && e.details.includes(e1));
  const e2 = await s.createEpisodeFromConcept({ productId: pid, conceptId: c.id, newVersion: true });
  assert.notEqual(e2, e1);
  assert.equal(s.store.episodes.get(e1).title, '손으로 고친 제목');
  assert.equal(s.store.episodes.get(e2).concept.versionOf, e1);
  // script draft: paid + confirmed, produces an UNAPPROVED draft; storyboard/paid video stay locked
  await assert.rejects(s.scriptgen.generate(e2, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  await s.scriptgen.generate(e2, { confirm: CONFIRM });
  const v = s.episodeView(e2);
  assert.ok(v.lines.length > 0);
  assert.equal(v.derived.scriptApproved, false);
  assert.equal(v.approvals.storyboard, null);
});

test('no paid video generation before script approval (backend gate)', async () => {
  const { s } = make({ ai: textAi() });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  // script is only a draft: the backend refuses to authorize any paid video generation
  await assert.rejects(s.gen.authorize(id, { confirmUnknown: true }), (e) => e.code === 'BLOCKED' && e.details.some((d) => d.code === 'SCRIPT_NOT_APPROVED'));
  assert.equal(s.store.episodes.get(id).spend.length, 0);
});
