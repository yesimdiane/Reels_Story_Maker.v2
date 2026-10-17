'use strict';
// Reference selection: up to 3 selected images PER CHARACTER (never per scene), ordered (first = primary), persisted, filenames preserved;
// product references counted separately; per-model image-input limits validated before any paid request; exact files sent; nothing trimmed
// or swapped silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid, png } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const b64 = (b) => b.toString('base64');
async function setup(model = 'model-a') {
  const base = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 900;
  const factory = (name) => { const p = base.factory(name); const o = p.generateImage.bind(p); p.generateImage = async (req) => { await o(req); n += 1; return { images: [{ mimeType: 'image/png', data: png(n).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } }; }; return p; };
  const { s } = make({ ai: { factory, calls: base.calls } });
  const pid = await readyProduct(s); routePaid(s);
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model });
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  await approveWithScenes(s, id);
  // one scene with Jack + Diane + the product
  const sid = s.store.episodes.get(id).scenes[0].id;
  await s.store.episodes.update(id, (e) => { const sc = e.scenes.find((x) => x.id === sid); sc.characters = ['jack', 'diane']; sc.showsProduct = true; });
  return { s, id, sid, calls: () => base.calls.filter((c) => c.image) };
}
const NAMES = { jack: ['잭 정면 사진 (최종).png', 'jack side.png', 'jack back.png', 'jack extra.png'], diane: ['diane front.png', 'diane side.png', 'diane smile.png', 'diane extra.png'] };
function addRefs(s, cid, seed) {
  return NAMES[cid].map((fn, i) => { s.store.characters.addReference(cid, { buffer: png(seed + i), filename: fn, mime: 'image/png', label: fn }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true); return r; });
}
const setModelLimit = (s, model, o) => s.store.settings.save({ ai: Object.assign({}, s.store.settings.get().ai, { refLimits: { [model]: o } }) });
const sentChars = (call) => call.images.filter((i) => /Character reference \d+ of \d+ for/.test(i.label));
const view = (s, id, sid) => s.episodeView(id).scenes.find((x) => x.id === sid);

test('max 3 selected images PER CHARACTER: Jack 3 + Diane 3 in one scene; a 4th is refused; order and primary are kept; uploads are never deleted', async () => {
  const { s, id, sid } = await setup();
  const j = addRefs(s, 'jack', 200); const d = addRefs(s, 'diane', 300);
  s.store.characters.setReferenceSelection('jack', [j[2].id, j[0].id, j[1].id]);
  s.store.characters.setReferenceSelection('diane', [d[1].id, d[0].id, d[2].id]);
  assert.throws(() => s.store.characters.setReferenceSelection('jack', j.map((r) => r.id)), (e) => e.code === 'SELECTION_LIMIT' && /최대 3장/.test(e.message));
  assert.throws(() => s.store.characters.setReferenceSelection('jack', [j[0].id, j[0].id]), (e) => e.code === 'BAD_SELECTION');
  assert.deepEqual(s.store.characters.get('jack').referenceSelection, [j[2].id, j[0].id, j[1].id], 'a refused selection changed nothing; order preserved');
  assert.equal(s.store.characters.get('jack').references.length >= 4, true, 'unselected uploads are kept');
  const sc = view(s, id, sid);
  const jr = sc.charRefs.find((r) => r.characterId === 'jack'); const dr = sc.charRefs.find((r) => r.characterId === 'diane');
  assert.deepEqual(jr.selected.map((x) => x.refId), [j[2].id, j[0].id, j[1].id]); assert.equal(jr.selected[0].primary, true); assert.equal(jr.selectedCount, 3);
  assert.deepEqual(dr.selected.map((x) => x.refId), [d[1].id, d[0].id, d[2].id]); assert.equal(dr.refId, d[1].id, 'the first selected image is the primary reference');
  // deselect + replace
  s.store.characters.setReferenceSelection('jack', [j[2].id, j[3].id]);
  assert.deepEqual(view(s, id, sid).charRefs.find((r) => r.characterId === 'jack').selected.map((x) => x.refId), [j[2].id, j[3].id]);
  // revoking approval / deleting an image prunes it from the selection (the file of the others stays)
  s.store.characters.setReferenceApproved('jack', j[3].id, false);
  assert.deepEqual(s.store.characters.get('jack').referenceSelection, [j[2].id]);
  // an unapproved image cannot be selected
  assert.throws(() => s.store.characters.setReferenceSelection('jack', [j[3].id]), (e) => e.code === 'REF_NOT_APPROVED');
});

test('filenames are preserved exactly (Korean, spaces, parentheses) and the view carries them for the compact UI', async () => {
  const { s, id, sid } = await setup();
  const j = addRefs(s, 'jack', 210); addRefs(s, 'diane', 310);
  assert.equal(s.store.characters.get('jack').references.find((r) => r.id === j[0].id).originalName, '잭 정면 사진 (최종).png');
  const sc = view(s, id, sid);
  assert.equal(sc.charRefs.find((c) => c.characterId === 'jack').options.find((o) => o.refId === j[0].id).filename, '잭 정면 사진 (최종).png');
  assert.equal(s.summary().characters.find((c) => c.id === 'jack').references.find((r) => r.id === j[0].id).originalName, '잭 정면 사진 (최종).png');
});

test('the exact selected files are sent: 3 for Jack + 3 for Diane + product references, primary first; unselected images are not sent', async () => {
  const { s, id, sid, calls } = await setup();
  const j = addRefs(s, 'jack', 220); const d = addRefs(s, 'diane', 320);
  s.store.characters.setReferenceSelection('jack', [j[1].id, j[0].id, j[2].id]);
  s.store.characters.setReferenceSelection('diane', [d[0].id, d[3].id, d[2].id]);
  const bytes = (cid, r) => b64(fs.readFileSync(s.store.characters.refPath(cid, r)));
  const est = s.startImages.estimate(id, [sid]);
  assert.ok(est.scenes[0].images >= 7, 'six character images + at least one product image: ' + est.scenes[0].images);
  await s.startImages.generate(id, [sid], { confirm: CONFIRM });
  const call = calls()[0];
  const chars = sentChars(call).map((i) => i.data);
  assert.deepEqual(chars, [bytes('jack', j[1]), bytes('jack', j[0]), bytes('jack', j[2]), bytes('diane', d[0]), bytes('diane', d[3]), bytes('diane', d[2])], 'selected files, in order');
  assert.ok(!call.images.some((i) => i.data === bytes('jack', j[3]) || i.data === bytes('diane', d[1])), 'unselected library images are not sent');
  assert.ok(call.images.filter((i) => /product reference/i.test(i.label)).length >= 1, 'product references are added separately');
  assert.match(call.images[0].label, /PRIMARY/);
});

test('provider limits are per model: refused before any paid call with counts and the limit; nothing is dropped or swapped; library selection untouched', async () => {
  const { s, id, sid, calls } = await setup('gemini-2.5-flash-image'); // built-in limit 3
  const j = addRefs(s, 'jack', 230); const d = addRefs(s, 'diane', 330);
  s.store.characters.setReferenceSelection('jack', [j[0].id, j[1].id, j[2].id]);
  s.store.characters.setReferenceSelection('diane', [d[0].id, d[1].id, d[2].id]);
  const before = JSON.stringify([s.store.characters.get('jack').referenceSelection, s.store.characters.get('diane').referenceSelection]);
  await assert.rejects(async () => s.startImages.estimate(id, [sid]), (e) => {
    assert.equal(e.code, 'REF_LIMIT_EXCEEDED');
    assert.match(e.message, /\d+장\(캐릭터 6장 \+ 제품 \d장\)/); assert.match(e.message, /최대 3장/);
    assert.equal(e.details.limit.maxImages, 3); assert.equal(e.details.limit.source, 'built-in'); assert.equal(e.details.characterCount, 6);
    assert.deepEqual(e.details.perCharacter.map((c) => c.count), [3, 3]); assert.ok(e.details.refs.some((r) => r.type === 'product'));
    assert.ok(e.details.refs.every((r) => r.filename && r.assetId), 'the UI can list every reference by filename');
    return true;
  });
  await assert.rejects(s.startImages.generate(id, [sid], { confirm: CONFIRM }), (e) => e.code === 'REF_LIMIT_EXCEEDED');
  assert.equal(calls().length, 0, 'no paid request');
  assert.equal(JSON.stringify([s.store.characters.get('jack').referenceSelection, s.store.characters.get('diane').referenceSelection]), before, 'library selection preserved');
  // deselect for THIS request only → passes; exactly the remaining files are sent; nothing else changed
  const ep = s.store.episodes.get(id);
  const refs = (await (async () => { try { s.startImages.estimate(id, [sid]); } catch (e) { return e.details.refs; } })());
  const keep = refs.filter((r) => r.type === 'character' && r.characterId === 'jack').slice(0, 1).concat(refs.filter((r) => r.type === 'character' && r.characterId === 'diane').slice(0, 1));
  const exclude = refs.filter((r) => !keep.includes(r) && r.type === 'character').map((r) => r.assetId);
  const prodCount = refs.filter((r) => r.type === 'product').length;
  if (2 + prodCount > 3) exclude.push(...refs.filter((r) => r.type === 'product').slice(0, 2 + prodCount - 3).map((r) => r.assetId)); // product images are deselectable too
  const est = s.startImages.estimate(id, [sid], { exclude });
  assert.ok(est.scenes[0].images <= 3);
  await s.startImages.generate(id, [sid], { confirm: CONFIRM, exclude });
  const sent = calls()[0].images.map((i) => i.data);
  assert.equal(sent.length, est.scenes[0].images);
  assert.ok(keep.every((k) => { const [cid, rid] = k.assetId.split(':'); return sent.includes(b64(fs.readFileSync(s.store.characters.refPath(cid, s.store.characters.get(cid).references.find((r) => r.id === rid))))); }), 'the kept references were sent');
  assert.equal(JSON.stringify([s.store.characters.get('jack').referenceSelection, s.store.characters.get('diane').referenceSelection]), before, 'still preserved after the request');
  void ep;
  // excluding every reference of a participating character fails closed
  await assert.rejects(async () => s.startImages.estimate(id, [sid], { force: true, exclude: refs.filter((r) => r.characterId === 'jack').map((r) => r.assetId) }), (e) => e.code === 'NO_CHARACTER_REF' && /Character reference missing: Jack/.test(e.message));
});

test('limits are not universal: a 14-image model accepts 6 + product, an unknown model is "unverified" (not enforced), settings can override, size is checked', async () => {
  const big = await setup('gemini-3-pro-image-preview');
  [['jack', 240], ['diane', 340]].forEach(([c, seed]) => { const r = addRefs(big.s, c, seed); big.s.store.characters.setReferenceSelection(c, r.slice(0, 3).map((x) => x.id)); });
  assert.doesNotThrow(() => big.s.startImages.estimate(big.id, [big.sid]), '6 + product ≤ 14');
  const unk = await setup('model-a');
  [['jack', 250], ['diane', 350]].forEach(([c, seed]) => { const r = addRefs(unk.s, c, seed); unk.s.store.characters.setReferenceSelection(c, r.slice(0, 3).map((x) => x.id)); });
  assert.doesNotThrow(() => unk.s.startImages.estimate(unk.id, [unk.sid]));
  setModelLimit(unk.s, 'model-a', { maxImages: 5 });
  await assert.rejects(async () => unk.s.startImages.estimate(unk.id, [unk.sid]), (e) => e.code === 'REF_LIMIT_EXCEEDED' && e.details.limit.source === 'settings' && e.details.limit.maxImages === 5);
  setModelLimit(unk.s, 'model-a', { maxImages: 50, maxTotalBytes: 10 });
  await assert.rejects(async () => unk.s.startImages.estimate(unk.id, [unk.sid]), (e) => e.code === 'REF_TOO_LARGE');
  const lim = require('../studio/lib/reflimits');
  assert.equal(lim.limitFor('gemini', 'gemini-2.5-flash-image').maxImages, 3); assert.equal(lim.limitFor('gemini', 'gemini-3-pro-image-preview').maxImages, 14); assert.equal(lim.limitFor('gemini', 'something-new').maxImages, null);
});

test('B-roll requests use the same per-character selection and the same limit check', async () => {
  const { s, id, sid, calls } = await setup('gemini-2.5-flash-image');
  const j = addRefs(s, 'jack', 260); addRefs(s, 'diane', 360);
  s.store.characters.setReferenceSelection('jack', [j[0].id, j[1].id, j[2].id]);
  const b = await s.sba.saveBroll(id, { sceneId: sid, kind: 'reaction', insertAtSec: 0, durationSec: 1, effect: 'Jack reacts' });
  await s.sba.saveBroll(id, { id: b.id });
  await s.brollImages.savePrompt(id, b.id, { refCharacters: ['jack'], refProduct: false });
  await s.brollImages.generate(id, b.id, { confirm: CONFIRM }); // 3 images = limit 3 → ok
  assert.equal(sentChars(calls()[0]).length, 3);
  await s.brollImages.savePrompt(id, b.id, { refCharacters: ['jack', 'diane'], refProduct: false });
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM, force: true }), (e) => e.code === 'REF_LIMIT_EXCEEDED');
  assert.equal(calls().length, 1);
  await s.brollImages.generate(id, b.id, { confirm: CONFIRM, force: true, exclude: [`jack:${j[1].id}`, `jack:${j[2].id}`] });
  assert.equal(calls().length, 2);
});

test('scene-specific choice is an ordered list of 1–3 images, persists across reorder, and the library selection is untouched', async () => {
  const { s, id, sid } = await setup();
  const j = addRefs(s, 'jack', 270); addRefs(s, 'diane', 370);
  s.store.characters.setReferenceSelection('jack', [j[0].id]);
  await s.charRefs.setSceneRef(id, sid, 'jack', [j[2].id, j[0].id]);
  await assert.rejects(s.charRefs.setSceneRef(id, sid, 'jack', j.map((r) => r.id)), (e) => e.code === 'SELECTION_LIMIT');
  await assert.rejects(s.charRefs.setSceneRef(id, sid, 'jack', []), (e) => e.code === 'BAD_SELECTION');
  let jr = view(s, id, sid).charRefs.find((r) => r.characterId === 'jack');
  assert.deepEqual(jr.selected.map((x) => x.refId), [j[2].id, j[0].id]); assert.equal(jr.override, true); assert.equal(jr.selectionFrom, 'scene');
  await s.store.episodes.update(id, (e) => { e.scenes.reverse(); });
  jr = view(s, id, sid).charRefs.find((r) => r.characterId === 'jack');
  assert.deepEqual(jr.selected.map((x) => x.refId), [j[2].id, j[0].id], 'survives reorder');
  assert.deepEqual(s.store.characters.get('jack').referenceSelection, [j[0].id], 'library untouched');
  await s.charRefs.clearSceneRef(id, sid, 'jack');
  assert.equal(view(s, id, sid).charRefs.find((r) => r.characterId === 'jack').selectionFrom, 'library');
});
