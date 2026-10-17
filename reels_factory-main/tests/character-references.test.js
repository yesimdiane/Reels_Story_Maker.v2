'use strict';
// Mandatory character references: selecting Jack and Diane loads their saved Character Library images into the storyboard and every
// visual generation request carries the ACTUAL approved image bytes. Missing/unapproved/placeholder references stop generation before
// any paid call. Choosing a reference per scene survives reload/reordering/regeneration and never touches the library files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, png, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const b64 = (buf) => buf.toString('base64');

function ai() {
  const base = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 300;
  const factory = (name) => {
    const p = base.factory(name);
    const orig = p.generateImage.bind(p);
    p.generateImage = async (req) => { await orig(req); n += 1; return { images: [{ mimeType: 'image/png', data: b64(png(n)) }], usage: { inputTokens: 10, outputTokens: 10 } }; };
    return p;
  };
  return { factory, calls: base.calls, imageCalls: () => base.calls.filter((c) => c.image) };
}
async function setup() {
  const a = ai();
  const { s } = make({ ai: a });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  return { s, a, id };
}
const imageRoute = (s) => { s.integrations.setKey('gemini', 'gem-key-123456789'); s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' }); };
function addRef(s, cid, seed, { approve = true, label = cid + ' ref' } = {}) {
  s.store.characters.addReference(cid, { buffer: png(seed), filename: cid + seed + '.png', mime: 'image/png', label });
  const r = s.store.characters.get(cid).references.slice(-1)[0];
  if (approve) s.store.characters.setReferenceApproved(cid, r.id, true);
  return r;
}
const refBytes = (s, cid, r) => fs.readFileSync(s.store.characters.refPath(cid, r));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('Jack and Diane: saved references are attached to the project and shown per scene (only the characters in the scene)', async () => {
  const { s, id } = await setup();
  const jr = addRef(s, 'jack', 61); const dr = addRef(s, 'diane', 62);
  await s.charRefs.snapshot(id);
  const ep = s.episodeView(id);
  assert.equal(ep.cast.refAssets.jack.assetId, `jack:${jr.id}`);
  assert.equal(ep.cast.refAssets.diane.assetId, `diane:${dr.id}`);
  const solo = ep.scenes.find((x) => x.characters.length === 1 && x.characters[0] === 'jack');
  assert.ok(solo, 'a Jack-only scene exists');
  assert.deepEqual(solo.charRefs.map((r) => r.characterId), ['jack'], 'only participants are attached');
  const r = solo.charRefs[0];
  assert.equal(r.status, 'approved'); assert.equal(r.url, `/media/ref/jack/${jr.id}`); assert.equal(r.assetId, `jack:${jr.id}`);
  const both = ep.scenes.find((x) => x.characters.includes('jack') && x.characters.includes('diane'));
  assert.deepEqual(both.charRefs.map((x) => x.characterId).sort(), ['diane', 'jack']);
});

test('start-image requests carry the actual approved reference bytes for exactly the scene cast, plus the authoritative-reference instruction', async () => {
  const { s, a, id } = await setup();
  const jr = addRef(s, 'jack', 71); const dr = addRef(s, 'diane', 72);
  imageRoute(s);
  await approveWithScenes(s, id);
  await s.startImages.generate(id, ['S1', 'S2'], { confirm: CONFIRM });
  const calls = a.imageCalls();
  assert.equal(calls.length, 2);
  const ep = s.store.episodes.get(id);
  [['S1', calls[0]], ['S2', calls[1]]].forEach(([sid, call]) => {
    const cast = ep.scenes.find((x) => x.id === sid).characters;
    const refs = { jack: jr, diane: dr };
    const sent = call.images.filter((im) => /Character reference \d+ of \d+ for/.test(im.label)).map((im) => im.data);
    assert.deepEqual(sent.sort(), cast.map((c) => b64(refBytes(s, c, refs[c]))).sort(), `${sid}: the real image data of exactly the scene cast`);
    cast.forEach((c) => assert.match(call.prompt, new RegExp(`Use the attached ${c === 'jack' ? 'Jack' : 'Diane'} character image \\(${c}:${refs[c].id}\\) as the authoritative visual reference`)));
    assert.match(call.prompt, /Preserve the face, hairstyle/);
  });
  const frame = s.store.episodes.get(id).scenes[0].startImage;
  assert.deepEqual(frame.characterRefAssetIds.sort(), ep.scenes[0].characters.map((c) => `${c}:${(c === 'jack' ? jr : dr).id}`).sort(), 'asset ids are persisted with the frame');
});

test('missing / unapproved / placeholder / unsupported-provider: stops BEFORE any paid call with the exact message', async () => {
  const { s, a, id } = await setup();
  imageRoute(s);
  await approveWithScenes(s, id);
  addRef(s, 'diane', 81);
  addRef(s, 'jack', 82, { approve: false });
  await assert.rejects(async () => s.startImages.estimate(id, ['S1']), (e) => /승인되지 않았습니다/.test(e.message) && e.code === 'CHARACTER_REF_UNAPPROVED');
  const v = s.charRefs.validate(s.store.episodes.get(id));
  assert.ok(v.problems.some((p) => p.characterId === 'jack'));
  assert.equal(s.charRefs.missingMessage('Jack'), 'Character reference missing: Jack. Please upload or select a reference image.');
  const r = s.store.characters.get('jack').references.slice(-1)[0];
  s.store.characters.update('jack', (c) => { c.references = []; });
  await assert.rejects(() => s.startImages.generate(id, ['S1'], { confirm: CONFIRM }), (e) => /Character reference missing: Jack\. Please upload or select a reference image\./.test(e.message));
  assert.equal(a.imageCalls().length, 0, 'nothing was billed');
  void r;
  // a provider without reference-image input is refused (no silent substitute)
  addRef(s, 'jack', 83);
  assert.equal(s.charRefs.supports('gemini'), true); assert.equal(s.charRefs.supports('openai'), false);
  assert.throws(() => s.integrations.setRouting('imageGeneration', { provider: 'openai', model: 'x' }), (e) => e.code === 'BAD_PROVIDER', 'only reference-capable image providers can be selected');
  assert.equal(a.imageCalls().length, 0);
});

test('scene-specific reference: choose another approved image, it survives reload and reordering, and the library file is untouched', async () => {
  const { s, a, id } = await setup();
  const j1 = addRef(s, 'jack', 91, { label: 'front' }); const j2 = addRef(s, 'jack', 92, { label: 'side' }); addRef(s, 'diane', 93);
  imageRoute(s);
  await approveWithScenes(s, id);
  const before = sha(refBytes(s, 'jack', j1)) + sha(refBytes(s, 'jack', j2));
  await s.charRefs.setSceneRef(id, 'S1', 'jack', j2.id);
  let sc = s.episodeView(id).scenes.find((x) => x.id === 'S1');
  assert.equal(sc.charRefs.find((r) => r.characterId === 'jack').refId, j2.id);
  assert.equal(sc.charRefs.find((r) => r.characterId === 'jack').override, true);
  assert.ok(sc.charRefs.find((r) => r.characterId === 'jack').options.length === 2);
  // other scenes keep the default
  assert.equal(s.episodeView(id).scenes.find((x) => x.id === 'S3').charRefs.find((r) => r.characterId === 'jack').refId, j1.id);
  // unapproved image cannot be chosen; an unknown character cannot be added
  const j3 = addRef(s, 'jack', 94, { approve: false });
  await assert.rejects(() => s.charRefs.setSceneRef(id, 'S1', 'jack', j3.id), (e) => e.code === 'REF_NOT_APPROVED');
  await assert.rejects(() => s.charRefs.setSceneRef(id, 'S1', 'cloud', j1.id), (e) => e.code === 'NOT_IN_SCENE' || e.code === 'NOT_FOUND');
  // reorder: the override follows the scene id
  const order = s.store.episodes.get(id).scenes.map((x) => x.id);
  await s.store.episodes.update(id, (e) => { e.scenes.reverse(); });
  assert.notDeepEqual(s.store.episodes.get(id).scenes.map((x) => x.id), order);
  assert.equal(s.episodeView(id).scenes.find((x) => x.id === 'S1').charRefs.find((r) => r.characterId === 'jack').refId, j2.id);
  await s.store.episodes.update(id, (e) => { e.scenes.reverse(); });
  // generation (and an individual regeneration) uses the chosen image, leaves others unchanged and the library intact
  await s.startImages.generate(id, ['S1', 'S3'], { confirm: CONFIRM });
  const c1 = a.imageCalls();
  assert.ok(c1[0].images.some((im) => im.data === b64(refBytes(s, 'jack', j2))), 'S1 uses the side image');
  assert.ok(c1[1].images.some((im) => im.data === b64(refBytes(s, 'jack', j1))), 'S3 uses the default image');
  const s3Frame = s.store.episodes.get(id).scenes.find((x) => x.id === 'S3').startImage.sha256;
  await s.charRefs.clearSceneRef(id, 'S1', 'jack');
  assert.equal(s.episodeView(id).scenes.find((x) => x.id === 'S1').charRefsStale, true, 'frame made from the other reference is flagged');
  await s.startImages.generate(id, ['S1'], { confirm: CONFIRM, force: true });
  assert.ok(a.imageCalls()[2].images.some((im) => im.data === b64(refBytes(s, 'jack', j1))), 'regeneration reloads the references');
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === 'S3').startImage.sha256, s3Frame, 'other scenes unchanged');
  assert.equal(sha(refBytes(s, 'jack', j1)) + sha(refBytes(s, 'jack', j2)), before, 'Character Library files untouched');
  assert.equal(s.episodeView(id).scenes.find((x) => x.id === 'S1').charRefsStale, false);
});

test('cost safety and honesty: no generation before script approval; text models only get written appearance', async () => {
  const { s, a, id } = await setup();
  addRef(s, 'jack', 101); addRef(s, 'diane', 102);
  imageRoute(s);
  await assert.rejects(() => s.startImages.generate(id, ['S1'], { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_NOT_APPROVED');
  assert.equal(a.imageCalls().length, 0);
  const note = s.charRefs.textNote(s.store.episodes.get(id), ['jack', 'diane']);
  assert.match(note, /NOT been shown the reference images/);
  assert.match(note, /Jack \(jack\)/);
  // free: selecting/validating references never calls a provider
  const before = a.calls.length;
  s.charRefs.validate(s.store.episodes.get(id)); s.episodeView(id);
  assert.equal(a.calls.length, before);
});
