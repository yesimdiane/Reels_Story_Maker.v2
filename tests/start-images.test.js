'use strict';
const { approveWithScenes } = require('./helpers/approve');
// AI start images per scene: gated by script approval, explicit cost confirmation, real character references;
// results are unapproved frames; nothing approved is overwritten; a mid-way failure keeps what was made. AI is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, fakeAi, goodConcepts, goodScript, scriptResponse, isScriptPrompt, png, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };

function ai({ failOnImageCall = 0 } = {}) {
  const base = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 200;
  let calls = 0;
  const factory = (name) => {
    const p = base.factory(name);
    const orig = p.generateImage.bind(p);
    p.generateImage = async (req) => {
      await orig(req);
      calls += 1;
      if (failOnImageCall && calls === failOnImageCall) throw new Error('model unavailable');
      n += 1;
      return { images: [{ mimeType: 'image/png', data: png(n).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } };
    };
    return p;
  };
  return { factory, calls: base.calls, imageCalls: () => base.calls.filter((c) => c.image) };
}

/** Episode with an APPROVED script (scenes S1: Jack only, S2: Diane+Jack with product) and real approved character refs. */
async function setup(opts) {
  const a = ai(opts);
  const { s } = make({ ai: a });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  return { s, a, id, pid };
}
function realRefs(s) {
  ['jack', 'diane'].forEach((cid, i) => {
    s.store.characters.addReference(cid, { buffer: png(50 + i), filename: cid + '.png', mime: 'image/png', label: cid + ' sheet' });
    const r = s.store.characters.get(cid).references.slice(-1)[0];
    s.store.characters.setReferenceApproved(cid, r.id, true);
  });
}
function imageRoute(s) {
  s.integrations.setKey('gemini', 'gem-key-123456789');
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' });
}

test('start images: blocked until the script is approved, then needs confirmation, a provider and real character references — nothing is billed before', async () => {
  const { s, a, id } = await setup();
  realRefs(s);
  imageRoute(s);
  await assert.rejects(s.startImages.generate(id, [], { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_NOT_APPROVED');
  await approveWithScenes(s, id);
  await assert.rejects(s.startImages.generate(id, [], {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(a.imageCalls().length, 0);
  // placeholder / unapproved refs are not accepted as identity references
  const { s: s2, a: a2, id: id2 } = await setup();
  imageRoute(s2);
  await approveWithScenes(s2, id2);
  await assert.rejects(s2.startImages.generate(id2, [], { confirm: CONFIRM }), (e) => e.code === 'NO_CHARACTER_REF');
  assert.equal(a2.imageCalls().length, 0);
  // no image provider configured → blocked, no placeholder frame is created
  const { s: s3, id: id3 } = await setup();
  realRefs(s3);
  await approveWithScenes(s3, id3);
  await assert.rejects(s3.startImages.generate(id3, [], { confirm: CONFIRM }), (e) => e.code === 'NOT_CONFIGURED');
  assert.ok(s3.store.episodes.get(id3).scenes.every((sc) => !sc.startImage || sc.startImage.type !== 'upload'));
});

test('start images: one call per scene, unapproved AI frames, cast + product rules in the prompt, approval is separate', async () => {
  const { s, a, id } = await setup();
  realRefs(s);
  imageRoute(s);
  await approveWithScenes(s, id);
  const ids = s.store.episodes.get(id).scenes.map((x) => x.id);
  assert.deepEqual(ids, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  const est = s.startImages.estimate(id, []);
  assert.equal(est.count, 6);
  const r = await s.startImages.generate(id, [], { confirm: CONFIRM });
  assert.deepEqual(r.generated.map((g) => g.sceneId), ids);
  assert.equal(r.failed, null);
  const calls = a.imageCalls();
  assert.equal(calls.length, 6);
  assert.match(calls[0].prompt, /9:16/);
  assert.match(calls[0].prompt, /anime \/ Korean webtoon/);
  assert.match(calls[0].prompt, /Exactly TWO people/);
  assert.match(calls[0].prompt, /Do NOT show the product/);
  assert.equal(calls[0].images.length, 2, 'S1: Jack + Diane references only');
  assert.match(calls[5].prompt, /EXACTLY like the approved product reference/);
  assert.equal(calls[5].images.length, 1 + 1, 'S6 (product_bridge): Diane reference + the approved product reference');
  calls.slice(0, 5).forEach((c, i) => { assert.doesNotMatch(c.prompt, /EXACTLY like the approved product reference/, 'S' + (i + 1) + ': the product appears only in the product_bridge beat'); });
  const ep = s.store.episodes.get(id);
  ep.scenes.forEach((sc) => { assert.equal(sc.startImage.generated, true); assert.equal(sc.startImage.approved, false); });
  assert.equal(s.episodeView(id).scenes[0].startImageInfo.generated, true);
  await s.approveStartFrame(id, 'S1', true);
  assert.equal(s.episodeView(id).scenes[0].startImageInfo.approved, true);
  // repeat press: nothing is billed again; the approved frame is never overwritten, even when forced
  const again = await s.startImages.generate(id, [], { confirm: CONFIRM });
  assert.equal(again.generated.length, 0);
  assert.equal(a.imageCalls().length, 6);
  const forced = await s.startImages.generate(id, [], { confirm: CONFIRM, force: true });
  assert.deepEqual(forced.generated.map((g) => g.sceneId), ids.slice(1));
  assert.ok(forced.skipped.some((x) => x.sceneId === 'S1'));
  assert.equal(s.store.episodes.get(id).scenes[0].startImage.approved, true);
  assert.equal(a.imageCalls().length, 6 + 5);
});

test('start images: a failure part-way keeps the frames already made and reports the scene that stopped', async () => {
  const { s, a, id } = await setup({ failOnImageCall: 2 });
  realRefs(s);
  imageRoute(s);
  await approveWithScenes(s, id);
  const r = await s.startImages.generate(id, [], { confirm: CONFIRM });
  assert.deepEqual(r.generated.map((g) => g.sceneId), ['S1']);
  assert.equal(r.failed.sceneId, 'S2');
  assert.equal(s.store.episodes.get(id).scenes[0].startImage.generated, true);
  assert.ok(!s.store.episodes.get(id).scenes[1].startImage || s.store.episodes.get(id).scenes[1].startImage.type !== 'upload');
  // retry only pays for the scenes that are still missing
  const before = a.imageCalls().length;
  const r2 = await s.startImages.generate(id, [], { confirm: CONFIRM });
  assert.deepEqual(r2.generated.map((g) => g.sceneId), ['S2', 'S3', 'S4', 'S5', 'S6']);
  assert.equal(a.imageCalls().length, before + 5);
});
