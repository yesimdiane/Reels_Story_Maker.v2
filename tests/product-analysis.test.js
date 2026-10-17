'use strict';
// Automatic product visual analysis + reference prompt injection:
//   * a vision AI (faked here, no network) reads the product reference images → an editable English PRODUCT STRUCTURE DESCRIPTION
//   * versions are never overwritten; approving needs the operator; samples can't be approved; changed images make it stale
//   * every scene image of the product gets the ACTUAL approved reference image bytes AND the approved description (never text alone)
//   * frames record which reference image-set version + description version they used; V1/V2/V3 of a frame are kept; nothing regenerates by itself
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { png } = require('./helpers/v23');
const { CONFIRM, GOOD, ai, visionRoute, imageRoute, realRefs, setupProduct, setupEpisode } = require('./helpers/product-analysis-fixtures');

const productFileB64 = (s, pid) => { const set = s.products.raw(pid).referenceSet.imageIds; return s.products.imageFiles(pid, set).map((f) => fs.readFileSync(f.path).toString('base64')); };

test('analysis: free estimate first, nothing is sent or billed without confirmation, then the real reference images reach the vision AI', async () => {
  const { s, a, pid } = await setupProduct();
  visionRoute(s);
  const est = s.productAnalysis.estimate(pid);
  assert.equal(est.imageCount, 1); assert.equal(est.count, 1); assert.equal(est.mock, false); assert.equal(est.nextImageSetVersion, 1);
  assert.equal(a.analysisCalls().length, 0, 'estimating is free');
  await assert.rejects(s.productAnalysis.generate(pid, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(a.analysisCalls().length, 0, 'no paid call without confirmation');
  const v = await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  assert.equal(a.analysisCalls().length, 1);
  const sent = a.analysisCalls()[0];
  assert.deepEqual(sent.images.map((i) => i.data), productFileB64(s, pid), 'the ACTUAL image bytes are what the AI receives');
  assert.match(sent.images[0].label, /Product reference photo 1 of 1/);
  assert.match(sent.system, /Never invent dimensions/);
  assert.equal(v.latest.v, 1); assert.equal(v.latest.status, 'draft'); assert.equal(v.latest.imageSetVersion, 1); assert.equal(v.latest.productId, pid);
  assert.equal(v.approved, null, 'a fresh analysis is a draft until the operator approves');
});

test('analysis: the description covers every required topic, separates verified from uncertain, keeps explicit negatives, and persists with the product', async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  const v = (await s.productAnalysis.generate(pid, { confirm: CONFIRM })).latest;
  for (const h of ['OVERALL SHAPE AND GEOMETRY', 'EXACT VISIBLE COMPONENT COUNT', 'COLORS AND MATERIAL APPEARANCE', 'INTERNAL COMPARTMENTS AND DIVIDERS', 'RELATIVE PROPORTIONS', 'MOUNTING AND INSTALLATION FEATURES', 'DISTINGUISHING VISUAL DETAILS', 'NEGATIVE CONSTRAINTS']) assert.match(v.text, new RegExp(h), h);
  assert.match(v.text, /\[VERIFIED\] Visible component count: 3/);
  assert.match(v.text, /\[UNCERTAIN\] Matte charcoal/);
  assert.match(v.text, /NOT VISIBLE IN THE PHOTOS/);
  assert.match(v.text, /Do not add a fourth slot\./);
  assert.match(v.text, /Do not change the number, size or arrangement of any component/);
  assert.match(v.text, /Do not redesign, restyle/);
  // saved with the Product ID and the reference image version, and still there after reloading from disk
  const disk = JSON.parse(fs.readFileSync(path.join(s.store.path('products'), pid, 'product.json'), 'utf8'));
  assert.equal(disk.analyses.length, 1);
  assert.equal(disk.analyses[0].productId, pid); assert.equal(disk.analyses[0].imageSetVersion, 1);
  assert.equal(disk.analyses[0].text, v.text);
  assert.deepEqual(disk.analyses[0].imageIds, s.products.raw(pid).referenceSet.imageIds);
  assert.equal(disk.imageSets[0].v, 1);
});

test('analysis: an uncertain component count is never presented as fact; unusable AI answers are refused and nothing is saved', async () => {
  const { s, pid } = await setupProduct({ analysis: () => Object.assign({}, GOOD, { component_count: { count: null, basis: 'two slots are hidden behind the lid', certain: false } }) });
  visionRoute(s);
  const t = (await s.productAnalysis.generate(pid, { confirm: CONFIRM })).latest.text;
  assert.match(t, /\[UNCERTAIN\] The exact component count could not be determined/);
  assert.doesNotMatch(t, /\[VERIFIED\] Visible component count/);
  const bad = await setupProduct({ analysis: () => ({ items: [] }) });
  visionRoute(bad.s);
  await assert.rejects(bad.s.productAnalysis.generate(bad.pid, { confirm: CONFIRM }), (e) => e.code === 'BAD_ANALYSIS');
  assert.equal((bad.s.products.raw(bad.pid).analyses || []).length, 0, 'an unusable answer saves nothing');
  const junk = await setupProduct({ analysis: () => 'not json at all' });
  visionRoute(junk.s);
  await assert.rejects(junk.s.productAnalysis.generate(junk.pid, { confirm: CONFIRM }), (e) => e.code === 'BAD_ANALYSIS');
});

test('review: the description is editable and approval is explicit; editing an approved version creates a NEW version, history is kept', async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  let v = await s.productAnalysis.edit(pid, 1, s.productAnalysis.view(pid).latest.text + '\n- [VERIFIED] The slots are 3 cm wide, as printed on the label.');
  assert.equal(v.latest.v, 1, 'a draft is corrected in place'); assert.equal(v.latest.edits, 1); assert.equal(v.latest.edited, true);
  await assert.rejects(s.productAnalysis.edit(pid, 1, '   '), (e) => e.code === 'EMPTY_TEXT');
  assert.equal(v.approved, null);
  v = await s.productAnalysis.approve(pid, 1);
  assert.equal(v.approved.v, 1); assert.match(v.approved.text, /3 cm wide/); assert.ok(v.approved.approvedAt);
  // correcting the approved text → V2 draft; V1 stays approved and untouched
  const approvedText = v.approved.text;
  v = await s.productAnalysis.edit(pid, 1, approvedText.replace('three identical', 'three identical, evenly spaced'));
  assert.equal(v.latest.v, 2); assert.match(v.latest.text, /\(analysis v2,/, 'the copy names its own version');
  assert.match(v.approved.text, /\(analysis v1,/); assert.equal(v.latest.status, 'draft'); assert.equal(v.latest.basedOn, 1);
  assert.equal(v.approved.v, 1); assert.equal(v.approved.text, approvedText, 'the approved version was NOT overwritten');
  v = await s.productAnalysis.approve(pid, 2);
  assert.equal(v.approved.v, 2);
  assert.deepEqual(v.versions.map((x) => [x.v, x.status]), [[2, 'approved'], [1, 'superseded']], 'V1 is kept as history');
  assert.equal(s.products.raw(pid).analysisApprovedV, 2);
  // an older version can be approved again (rollback)
  v = await s.productAnalysis.approve(pid, 1);
  assert.equal(v.approved.v, 1);
});

test('samples: the free sample route works but a sample can never be approved as if it were a real analysis', async () => {
  const { s, a, pid } = await setupProduct(); // "productUnderstanding" stays routed to mock
  const est = s.productAnalysis.estimate(pid);
  assert.equal(est.mock, true); assert.equal(est.usd, 0);
  const v = await s.productAnalysis.generate(pid, {}); // free: no confirmation needed
  assert.equal(a.analysisCalls().length, 0, 'no paid AI call');
  assert.equal(v.latest.sample, true); assert.match(v.latest.text, /SAMPLE — NOT AN ANALYSIS OF THIS PRODUCT/);
  await assert.rejects(s.productAnalysis.approve(pid, 1), (e) => e.code === 'SAMPLE_NOT_APPROVABLE');
  // the operator writes the real description: the sample mark must be gone
  const marked = await s.productAnalysis.edit(pid, 1, v.latest.text + '\n- my own note');
  await assert.rejects(s.productAnalysis.approve(pid, marked.latest.v), (e) => e.code === 'SAMPLE_NOT_APPROVABLE');
  const real = await s.productAnalysis.edit(pid, marked.latest.v, 'PRODUCT STRUCTURE DESCRIPTION — written by the operator\n- [VERIFIED] Three vertical slots.');
  assert.equal((await s.productAnalysis.approve(pid, real.latest.v)).approved.v, real.latest.v);
});

test('versions: changed product images make the approved description stale; a new analysis gets a new image-set version; the approved one is preserved', async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  assert.equal(s.productAnalysis.view(pid).stale, false);
  // the reference image is replaced
  const im = s.products.raw(pid).images[0];
  await s.products.replace(pid, im.id, png(9), 'new.png', { confirm: true });
  let v = s.productAnalysis.view(pid);
  assert.equal(v.stale, true); assert.match(v.staleReason, /이미지가 바뀌었습니다/);
  assert.equal(v.approved.v, 1, 'the previously approved description is kept, not deleted or overwritten');
  // a new upload + approval → analyze again (same product, new image set)
  await s.products.upload(pid, png(20), 'b.png');
  const imgs = s.products.get(pid).images;
  await s.products.setStatus(pid, imgs[imgs.length - 1].id, 'approved');
  await s.products.approveReferenceSet(pid, {});
  v = await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  assert.equal(v.latest.v, 2); assert.equal(v.latest.imageSetVersion, 2, 'new images → reference image-set V2');
  assert.equal(v.approved.v, 1, 'V1 stays the approved one until the operator approves V2');
  v = await s.productAnalysis.approve(pid, 2);
  assert.equal(v.approved.v, 2); assert.equal(v.stale, false);
  assert.deepEqual(v.imageSets.map((x) => x.v), [1, 2]);
});

test('unsupported analysis model: a clear error, no call, no guessing from text alone', async () => {
  const { s, a, pid } = await setupProduct();
  s.integrations.setKey('gemini', 'k-123456789012');
  s.integrations.setRouting('productUnderstanding', { provider: 'gemini', model: 'model-a' });
  const orig = s.router.client;
  s.router.client = (name) => Object.assign(orig(name), { supportsImages: false });
  await assert.rejects(s.productAnalysis.generate(pid, { confirm: CONFIRM }), (e) => e.code === 'ANALYSIS_UNSUPPORTED' && /이미지 입력을 지원하지 않아/.test(e.message));
  assert.throws(() => s.productAnalysis.estimate(pid), (e) => e.code === 'ANALYSIS_UNSUPPORTED');
  assert.equal(a.analysisCalls().length, 0);
  assert.equal((s.products.raw(pid).analyses || []).length, 0);
});

test('storyboard: a scene that shows the product gets the ACTUAL reference image(s) AND the approved English description, plus character references and the scene direction', async () => {
  const { s, a, pid, id, sceneId } = await setupEpisode();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  const approved = (await s.productAnalysis.approve(pid, 1)).approved;
  const est = s.startImages.estimate(id, [sceneId]);
  assert.equal(est.scenes[0].structureVersion, 1); assert.equal(est.scenes[0].productImages, 1);
  assert.equal(a.imageCalls().length, 0, 'estimating is free');
  const r = await s.startImages.generate(id, [sceneId], { confirm: CONFIRM });
  assert.equal(r.generated.length, 1);
  const req = a.imageCalls()[0];
  // (1) the real approved product reference image bytes are image inputs
  const productImgs = req.images.filter((i) => /APPROVED product reference/.test(i.label || ''));
  assert.deepEqual(productImgs.map((i) => i.data), productFileB64(s, pid));
  // (2) the approved description is in the text prompt (with a pointer to the images as the source of truth)
  assert.ok(req.prompt.includes(approved.text), 'the approved text is injected verbatim');
  assert.match(req.prompt, /APPROVED PRODUCT STRUCTURE DESCRIPTION \(v1, from product reference image set V1\)/);
  assert.match(req.prompt, /PRIMARY source of truth/);
  // character references and the scene's own direction are still there
  assert.ok(req.images.some((i) => /Character reference/.test(i.label || '')), 'approved character references attached');
  const sc = s.store.episodes.get(id).scenes.find((x) => x.id === sceneId);
  assert.ok(req.prompt.includes('VISUAL: '), 'scene visual direction');
  // provenance is recorded on the frame
  const pc = sc.startImage.productContext;
  assert.equal(pc.productId, pid); assert.equal(pc.referenceImageSetVersion, 1); assert.equal(pc.structureVersion, 1); assert.equal(pc.structureImageSetVersion, 1); assert.equal(pc.structureStale, false);
  assert.deepEqual(pc.referenceImageIds, s.products.raw(pid).referenceSet.imageIds);
  assert.equal(pc.structureTextSha, require('../studio/lib/util').sha256(approved.text));
  assert.deepEqual(r.generated[0].productContext.structureVersion, 1);
});

test('storyboard: a scene WITHOUT the product gets no description and no product image', async () => {
  const { s, a, pid, id } = await setupEpisode();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  const other = s.store.episodes.get(id).scenes.find((x) => !x.showsProduct).id;
  await s.startImages.generate(id, [other], { confirm: CONFIRM });
  const req = a.imageCalls()[0];
  assert.doesNotMatch(req.prompt, /PRODUCT STRUCTURE DESCRIPTION/);
  assert.equal(req.images.filter((i) => /product reference/.test(i.label || '')).length, 0);
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === other).startImage.productContext, null);
});

test('storyboard: text never replaces the image — without attached product images the description is not sent either', async () => {
  const { s, a, pid, id, sceneId } = await setupEpisode();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  await s.store.episodes.update(id, (e) => { e.productRefs = Object.assign({}, e.productRefs, { imageIds: [] }); }); // no product reference attached to this episode
  await s.startImages.generate(id, [sceneId], { confirm: CONFIRM });
  const req = a.imageCalls()[0];
  assert.equal(req.images.filter((i) => /product reference/.test(i.label || '')).length, 0);
  assert.doesNotMatch(req.prompt, /PRODUCT STRUCTURE DESCRIPTION/, 'no text-only product injection');
  assert.match(req.prompt, /Do NOT show the product/);
  // and the excluded-image path refuses outright instead of silently dropping the reference
  const ep = s.store.episodes.get(id);
  await s.store.episodes.update(id, (e) => { e.productRefs = Object.assign({}, ep.productRefs, { imageIds: s.products.raw(pid).referenceSet.imageIds }); });
  const ref = s.products.raw(pid).referenceSet.imageIds[0];
  await assert.rejects(s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true, exclude: [`${pid}:${ref}`] }), (e) => e.code === 'NO_PRODUCT_REF');
});

test('storyboard: V1, V2, V3 of a frame are kept with the versions they used; approved frames are never regenerated, approving a description regenerates nothing', async () => {
  const { s, a, pid, id, sceneId } = await setupEpisode();
  const first = await s.startImages.generate(id, [sceneId], { confirm: CONFIRM }); // no description approved yet
  let sc = () => s.store.episodes.get(id).scenes.find((x) => x.id === sceneId);
  assert.equal(sc().startImage.productContext.structureVersion, null, 'no approved description yet → recorded as none');
  assert.equal(sc().startImage.productContext.referenceImageSetVersion, 1);
  assert.match((s.startImages.estimate(id, [sceneId], { force: true }).scenes[0].warnings || []).join(' '), /승인되지 않았습니다/, 'the missing description is surfaced as a warning, not hidden');
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  const calls = a.imageCalls().length;
  assert.equal(calls, 1, 'approving a description starts no image generation');
  await s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true });   // V2
  await s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true });   // V3
  const vers = sc().startImageVersions;
  assert.deepEqual(vers.map((x) => x.v), [1, 2, 3]);
  assert.equal(new Set(vers.map((x) => x.file)).size, 3, 'three different image files');
  vers.forEach((x) => assert.ok(fs.existsSync(s.store.episodes.file(id, 'startframes', x.file)), 'V' + x.v + ' file still on disk'));
  assert.deepEqual(vers.map((x) => x.productContext.structureVersion), [null, 1, 1]);
  assert.equal(sc().startImage.version, 3);
  assert.equal(sc().startImage.productContext.structureVersion, 1);
  // a NEW description version (V2) is approved later: the frame keeps recording V1 and the approved frame is never touched
  const edited = await s.productAnalysis.edit(pid, 1, s.productAnalysis.view(pid).approved.text + '\n- [VERIFIED] Extra detail.');
  await s.productAnalysis.approve(pid, edited.latest.v);
  await s.store.episodes.update(id, (e) => { e.scenes.find((x) => x.id === sceneId).startImage.approved = true; });
  const before = JSON.stringify(sc().startImage);
  const again = await s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true });
  assert.equal(again.generated.length, 0); assert.match(again.skipped[0].reason, /이미 승인된/);
  assert.equal(JSON.stringify(sc().startImage), before, 'an approved frame is not regenerated or changed');
  assert.equal(a.imageCalls().length, 3 + 0, 'no extra paid image call');
  // the episode view exposes versions and provenance for the UI (+ which description is approved now)
  const view = s.episodeView(id).scenes.find((x) => x.id === sceneId);
  assert.deepEqual(view.startImageVersions.map((x) => x.v), [1, 2, 3]);
  assert.equal(view.startImageVersions.filter((x) => x.current).length, 1);
  assert.equal(view.startImageInfo.productContext.structureVersion, 1);
  assert.equal(view.structureApprovedV, 2);
  void first;
});

test('storyboard: an earlier frame that was never recorded (manual upload / older data) becomes V1 before the first AI frame is added', async () => {
  const { s, id, sceneId } = await setupEpisode();
  await s.uploadStartFrame(id, sceneId, png(61), 'mine.png');
  await s.startImages.generate(id, [sceneId], { confirm: CONFIRM, force: true });
  const vers = s.store.episodes.get(id).scenes.find((x) => x.id === sceneId).startImageVersions;
  assert.deepEqual(vers.map((x) => [x.v, !!x.earlier, x.generated]), [[1, true, false], [2, false, true]]);
});

test('compatibility: a model that cannot take the required image references is refused with a clear error — nothing is dropped, nothing is billed', async () => {
  const { s, a, pid, id, sceneId } = await setupEpisode();
  await s.productAnalysis.generate(pid, { confirm: CONFIRM });
  await s.productAnalysis.approve(pid, 1);
  // 1) the image model allows fewer references than this scene needs (1 character + the product reference = 2)
  s.store.settings.save({ ai: Object.assign({}, s.store.settings.get().ai, { refLimits: { 'model-a': { maxImages: 1 } } }) });
  assert.throws(() => s.startImages.estimate(id, [sceneId]), (e) => e.code === 'REF_LIMIT_EXCEEDED' && /최대 1장/.test(e.message));
  await assert.rejects(s.startImages.generate(id, [sceneId], { confirm: CONFIRM }), (e) => e.code === 'REF_LIMIT_EXCEEDED');
  // 2) a provider that cannot accept reference images at all
  s.store.settings.save({ ai: Object.assign({}, s.store.settings.get().ai, { refLimits: {}, routing: Object.assign({}, s.store.settings.get().ai.routing, { imageGeneration: { provider: 'openai', model: 'x' } }) }) });
  await assert.rejects(s.startImages.generate(id, [sceneId], { confirm: CONFIRM }), (e) => e.code === 'REF_UNSUPPORTED' && /참조 이미지 입력을 지원하지 않습니다/.test(e.message));
  assert.equal(a.imageCalls().length, 0, 'no image request was sent');
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === sceneId).startImage, undefined, 'no frame was created');
});

test('HTTP: analysis estimate / generate (confirm required) / edit / approve through the API, product detail stays intact', async () => {
  const { s, pid } = await setupProduct();
  visionRoute(s);
  const { createApp } = require('../studio/server');
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json', 'x-rf-studio': '1' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    assert.equal((await call('GET', `/api/products/${pid}/analysis`)).body.versions.length, 0);
    const est = await call('POST', `/api/products/${pid}/analysis/estimate`, {});
    assert.equal(est.status, 200); assert.equal(est.body.imageCount, 1);
    const noConfirm = await call('POST', `/api/products/${pid}/analysis/generate`, {});
    assert.ok(noConfirm.status >= 400, 'refused without confirmation');
    const gen = await call('POST', `/api/products/${pid}/analysis/generate`, { confirm: CONFIRM });
    assert.equal(gen.status, 200); assert.equal(gen.body.latest.v, 1);
    const ed = await call('PUT', `/api/products/${pid}/analysis/1`, { text: gen.body.latest.text + '\n- [VERIFIED] edited via API' });
    assert.match(ed.body.latest.text, /edited via API/);
    const ap = await call('POST', `/api/products/${pid}/analysis/1/approve`);
    assert.equal(ap.body.approved.v, 1);
    const prod = await call('GET', `/api/products/${pid}`);
    assert.equal(prod.status, 200); assert.equal(prod.body.id, pid);
  } finally { app.close(); }
});
