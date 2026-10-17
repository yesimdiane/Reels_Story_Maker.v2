'use strict';
// Product Studio (simplified): code + name + link + main reference image + reference status + linked episodes + Create Story first;
// specs / history / extra references folded; verified facts stay apart from creative text; products feed the other studios by ID (no copies).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid, png } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const VIEWS = path.join(__dirname, '..', 'studio', 'public', 'js', 'views');

test('the main reference image: first image of the approved set, else the first approved, else the first usable upload — never a rejected or replaced one', async () => {
  const { s } = make();
  const p = await s.products.create({ name: '우산꽂이', code: 'UMB' });
  assert.equal(s.products.get(p.id).mainImage, null);
  await s.products.upload(p.id, png(21), 'a.png');
  await s.products.upload(p.id, png(22), 'b.png');
  let v = s.products.get(p.id);
  assert.equal(v.mainImage.id, v.images[0].id, 'the first usable upload');
  await s.products.setStatus(p.id, v.images[0].id, 'rejected');
  v = s.products.get(p.id);
  assert.equal(v.mainImage.id, v.images[1].id, 'a rejected image is never the main picture');
  await s.products.setStatus(p.id, v.images[1].id, 'approved');
  await s.products.upload(p.id, png(23), 'c.png');
  await s.products.approveReferenceSet(p.id, {});
  v = s.products.get(p.id);
  assert.equal(v.mainImage.id, v.images[1].id);
  assert.equal(v.mainImage.approved, true);
  assert.match(v.mainImage.url, new RegExp(`^/media/product/${p.id}/`));
  const row = s.products.list().find((x) => x.id === p.id);
  assert.equal(row.code, 'UMB'); assert.equal(row.mainImage.id, v.mainImage.id); assert.deepEqual(row.linkedEpisodes, []);
});

test('verified facts stay apart from creative text; nothing about specs or price is invented', async () => {
  const { s } = make();
  const pid = await readyProduct(s);
  const p = { id: pid };
  await s.products.edit(p.id, { description: '감성적인 AI 소개 문구: 비 오는 날의 로망', sellingPoints: [{ text: '현관이 한결 깔끔해 보입니다', verified: false }], specs: [{ text: '자석으로 부착 가능', verified: true }, { text: '방수 100%', verified: false }] });
  const v = s.products.get(p.id);
  assert.deepEqual(v.verifiedFacts, ['자석으로 부착 가능'], 'only confirmed specs are facts');
  assert.ok(!v.verifiedFacts.join(' ').includes('로망') && !v.verifiedFacts.join(' ').includes('깔끔'), 'creative text is never a fact');
  assert.equal(v.price, null, 'no price unless the operator typed one');
  assert.ok(!JSON.stringify(s.products.bindingFor(p.id).facts).includes('방수'), 'an unconfirmed claim never reaches the story inputs');
  await s.products.edit(p.id, { price: { text: '12,900원 (확인한 날짜 기준)' } });
  assert.equal(s.products.get(p.id).price.source, 'operator');
});

async function withEpisode() {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 1, outputTokens: 1 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  return Object.assign(m, { pid, id });
}

test('products feed the other studios by ID: episodes store references, not copies of the images, and follow later changes', async () => {
  const m = await withEpisode();
  const ep = m.s.store.episodes.get(m.id);
  assert.ok(ep.productRefs.imageIds.length >= 1, 'the approved reference ids are linked');
  const json = JSON.stringify(ep);
  assert.ok(!/base64|\/media\/product\//.test(json), 'no image bytes or URLs are copied into the episode');
  const v = m.s.episodeView(m.id);
  assert.ok(v.productRefImages.length >= 1);
  assert.match(v.productRefImages[0].url, new RegExp(`^/media/product/${m.pid}/`), 'Storyboard resolves the picture from the product');
  assert.equal(m.s.episodeView(m.id).derived.assets.product.ready, true, 'Script Studio sees the product photo as ready');
  assert.equal(m.s.storylab.list(m.pid).concepts.length, 1);
  // reject the image in Product Studio → the episode view follows without any write to the episode file
  const before = fs.readFileSync(m.s.store.episodes.file(m.id, 'episode.json'), 'utf8');
  const img = m.s.products.raw(m.pid).images[0];
  await m.s.products.setStatus(m.pid, img.id, 'rejected');
  assert.equal(fs.readFileSync(m.s.store.episodes.file(m.id, 'episode.json'), 'utf8'), before, 'the episode file is untouched');
  assert.equal(m.s.products.get(m.pid).readiness.ok, false);
  const after = m.s.episodeView(m.id);
  assert.ok(!after.productRefImages.some((i) => i.id === img.id) || after.productRefImages.length === 0, 'the rejected image is no longer offered downstream');
  // the product lists its episodes with the display code
  const row = m.s.products.list().find((x) => x.id === m.pid);
  assert.deepEqual(row.linkedEpisodes.map((e) => e.displayId), [m.id]);
});

test('reference approval and numbered versions: approving binds the exact set; changing an image invalidates it', async () => {
  const { s } = make();
  const pid = await readyProduct(s);
  const v1 = s.products.get(pid);
  assert.equal(v1.reference.state, 'approved');
  const hash = v1.reference.hash;
  await s.products.upload(pid, png(31), 'second.png');
  const second = s.products.get(pid).images.slice(-1)[0];
  await s.products.setStatus(pid, second.id, 'approved');
  assert.equal(s.products.get(pid).reference.state, 'approved', 'adding another approved image does not silently change the approved set');
  assert.deepEqual(s.products.get(pid).reference.imageIds, v1.reference.imageIds);
  await s.products.setStatus(pid, v1.reference.imageIds[0], 'rejected');
  assert.equal(s.products.get(pid).reference.state, 'stale', 'a member of the approved set changed → it needs re-approval');
  await s.products.approveReferenceSet(pid, {});
  const v3 = s.products.get(pid);
  assert.equal(v3.reference.state, 'approved');
  assert.notEqual(v3.reference.hash, hash);
  assert.ok(!v3.reference.imageIds.includes(v1.reference.imageIds[0]));
});

test('up to five additional uploaded references per generation; image generation stays behind confirmation', async () => {
  const ai = fakeAi({});
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  for (let i = 0; i < 4; i++) await s.products.upload(pid, png(40 + i), 'x' + i + '.png');
  const v = s.products.get(pid);
  const base = v.images[0].id;
  const four = v.images.slice(1, 5).map((i) => i.id);
  const six = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6']; // the limit is checked before the images are looked up
  s.integrations.setKey('gemini', 'gem-key-123456789');
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' });
  await assert.rejects(s.products.generateImage(pid, { basedOn: [base], extraImageIds: six, confirm: CONFIRM }), (e) => e.code === 'EXTRA_LIMIT');
  await assert.rejects(s.products.generateImage(pid, { basedOn: [base], extraImageIds: four }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(ai.calls.length, 0, 'nothing was generated or billed');
});

test('the Product Studio screen: summary first (code, name, link, main image, reference status, linked episodes, Create Story); the rest is folded; uploads work on phones', () => {
  const src = fs.readFileSync(path.join(VIEWS, 'products.js'), 'utf8');
  for (const k of ['data-product-summary', 'data-create-story', 'data-product-card', 'data-fold']) assert.match(src, new RegExp(k), k);
  assert.match(src, /스토리 만들기/); assert.match(src, /대표 참조 이미지/); assert.match(src, /연결된 에피소드/);
  for (const t of ['제품 정보 · 사양 · 금지 표현', '참조 이미지', 'AI 참조 이미지 생성 이력']) assert.match(src, new RegExp(t), 'folded: ' + t);
  const intake = fs.readFileSync(path.join(VIEWS, 'image-intake.js'), 'utf8');
  const core = fs.readFileSync(path.join(VIEWS, '..', 'image-intake-core.js'), 'utf8');
  assert.match(intake, /type: 'file', accept: ACCEPT, multiple: true/, 'a plain file input (works in mobile Safari)');
  assert.match(core, /ACCEPT = 'image\/png,image\/jpeg,image\/webp'/);
  assert.match(src, /imageIntake\(/);
  assert.match(src, /fold\(.*false, A\)/s, 'product info starts folded');
});
