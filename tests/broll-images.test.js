'use strict';
// B-roll "이미지 만들기": paid image generation gated by script approval + confirmation; reaction/close-up shots carry the real approved
// character reference bytes, product inserts carry product references; never overwrites an approved item or an existing image without force.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, png, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const base = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 400;
  const factory = (name) => { const p = base.factory(name); const o = p.generateImage.bind(p); p.generateImage = async (req) => { await o(req); n += 1; return { images: [{ mimeType: 'image/png', data: png(n).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } }; }; return p; };
  const { s } = make({ ai: { factory, calls: base.calls } });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  return { s, id, calls: () => base.calls.filter((c) => c.image) };
}
const route = (s) => { s.integrations.setKey('gemini', 'gem-key-123456789'); s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' }); };
function ref(s, cid, seed) { s.store.characters.addReference(cid, { buffer: png(seed), filename: cid + seed + '.png', mime: 'image/png' }); const r = s.store.characters.get(cid).references.slice(-1)[0]; s.store.characters.setReferenceApproved(cid, r.id, true); return r; }

test('B-roll image: gated, confirmed, reaction shot carries the real character reference, saved unapproved, no silent overwrite', async () => {
  const { s, id, calls } = await setup();
  const sc = s.store.episodes.get(id).scenes.find((x) => (x.characters || []).length === 1) || s.store.episodes.get(id).scenes[0];
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'reaction', insertAtSec: 0, durationSec: 1, effect: 'quick cut to the listener\'s face' });
  route(s);
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_NOT_APPROVED');
  await approveWithScenes(s, id);
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM }), (e) => /Character reference missing|참조/.test(e.message), 'no real reference → stops before the paid call');
  assert.equal(calls().length, 0);
  const refs = {}; sc.characters.forEach((c, i) => { refs[c] = ref(s, c, 130 + i); });
  const est = s.brollImages.estimate(id, b.id);
  assert.equal(est.count, 1); assert.equal(est.images, sc.characters.length);
  await assert.rejects(s.brollImages.generate(id, b.id, {}), (e) => /CONFIRM|확인|승인/.test(e.code + e.message), 'needs the cost confirmation');
  assert.equal(calls().length, 0);
  const saved = await s.brollImages.generate(id, b.id, { confirm: CONFIRM });
  assert.equal(calls().length, 1);
  const sent = calls()[0].images.map((i) => i.data).sort();
  assert.deepEqual(sent, sc.characters.map((c) => fs.readFileSync(s.store.characters.refPath(c, refs[c])).toString('base64')).sort(), 'real approved reference bytes');
  assert.equal(saved.status, 'proposed'); assert.equal(saved.asset, 'ready');
  const first = saved.imageRef.file;
  // an existing image needs force; an approved item is never overwritten
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM }), (e) => e.code === 'BROLL_HAS_IMAGE');
  await s.sba.setBrollStatus(id, b.id, 'approved');
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM, force: true }), (e) => e.code === 'BROLL_APPROVED');
  await s.sba.setBrollStatus(id, b.id, 'proposed');
  const again = await s.brollImages.generate(id, b.id, { confirm: CONFIRM, force: true });
  assert.notEqual(again.imageRef.file, first);
  assert.ok(fs.existsSync(s.store.episodes.file(id, 'broll', first)), 'the previous file is kept');
  assert.equal(calls().length, 2);
});

test('B-roll product insert: no character images; product scenes need an approved product reference', async () => {
  const { s, id, calls } = await setup();
  route(s);
  await approveWithScenes(s, id);
  const sc = s.store.episodes.get(id).scenes.find((x) => !x.showsProduct);
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'steam rising from a cup' });
  await s.brollImages.generate(id, b.id, { confirm: CONFIRM });
  assert.equal(calls()[0].images.length, 0, 'a non-product, non-character shot attaches nothing');
  assert.match(calls()[0].prompt, /Do NOT show the product/);
});

// ---------------------------------------------------------------- full workflow (BR9: product insert with Diane)
const { AiError } = require('../studio/lib/ai/text');

async function setupWith(failWith) {
  const base = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 500;
  const factory = (name) => { const p = base.factory(name); const o = p.generateImage.bind(p); p.generateImage = async (req) => { await o(req); if (failWith && failWith.on) throw failWith.on; n += 1; return { images: [{ mimeType: 'image/png', data: png(n).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } }; }; return p; };
  const { s } = make({ ai: { factory, calls: base.calls } });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  return { s, id, calls: () => base.calls.filter((c) => c.image) };
}
const productScene = (s, id) => s.store.episodes.get(id).scenes.find((x) => x.showsProduct && (x.characters || []).includes('diane'));

test('BR9 workflow: draft prompt → edit → references (Diane + product) → estimate → generate → preview → approve with asset id → persists', async () => {
  const { s, id, calls } = await setupWith();
  route(s);
  const sc = productScene(s, id);
  assert.ok(sc, 'a scene with Diane and the product exists');
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'inserting product to door', note: 'Diane installs the holder' });
  // before approval of the script nothing is allowed; the plan itself is free and explains why
  let plan = s.brollImages.plan(id, b.id);
  assert.equal(plan.scriptApproved, false);
  assert.match(plan.draft, /inserting product to door/); assert.match(plan.draft, /9:16/);
  assert.deepEqual(plan.options.selectedCharacters, ['diane'], 'Diane is named in the shot → her reference is attached');
  assert.equal(plan.options.product, true);
  await approveWithScenes(s, id);
  plan = s.brollImages.plan(id, b.id);
  assert.ok(plan.warnings.some((w) => /Character reference missing: Diane/.test(w)), 'actionable warning instead of a silent substitute');
  assert.equal(calls().length, 0);
  const dr = ref(s, 'diane', 141);
  // edit the prompt; the reference rules are still appended automatically
  plan = await s.brollImages.savePrompt(id, b.id, { prompt: 'Diane clicks the magnetic holder onto the apartment door, close three-quarter angle.' });
  assert.equal(plan.edited, true);
  assert.equal(!s.store.episodes.get(id).broll.find((x) => x.id === b.id).imageRef, true, 'editing a prompt changes no image');
  assert.equal(plan.warnings.length, 0, plan.warnings.join(' | '));
  assert.ok(plan.estimate && plan.estimate.images >= 2, 'Diane + product reference images');
  const est = s.brollImages.estimate(id, b.id);
  assert.equal(est.count, 1);
  const saved = await s.brollImages.generate(id, b.id, { confirm: CONFIRM });
  const call = calls()[0];
  assert.match(call.prompt, /Diane clicks the magnetic holder/);
  assert.match(call.prompt, /authoritative visual reference/); assert.match(call.prompt, /Draw the product EXACTLY/);
  assert.ok(call.images.some((i) => i.data === fs.readFileSync(s.store.characters.refPath('diane', dr)).toString('base64')), 'Diane image bytes');
  assert.ok(call.images.some((i) => /product reference/i.test(i.label)), 'product image attached');
  // preview data + not auto-approved
  const view = s.sba.brollView(s.store.episodes.get(id)).find((x) => x.id === b.id);
  assert.equal(view.status, 'proposed'); assert.ok(view.imageUrl); assert.equal(view.imageGenerated, true); assert.equal(view.promptEdited, true);
  assert.equal(s.sba.approvedBroll(s.store.episodes.get(id)).length, 0);
  // approve → asset id saved and tied to the B-roll + scene; survives reload (re-read from disk) and is available to the editor
  await s.sba.setBrollStatus(id, b.id, 'approved');
  const ap = s.store.episodes.get(id).broll.find((x) => x.id === b.id);
  assert.equal(ap.approvedAssetId, `${b.id}:${saved.imageRef.sha256.slice(0, 12)}`);
  assert.equal(ap.sceneId, sc.id);
  const list = s.sba.approvedBroll(s.store.episodes.get(id));
  assert.equal(list.length, 1);
  assert.ok(s.sba.brollFile(s.store.episodes.get(id), list[0]) && fs.existsSync(s.sba.brollFile(s.store.episodes.get(id), list[0])));
  // regenerating an approved image needs explicit confirmation and withdraws the approval; the old file is kept
  const old = saved.imageRef.file;
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM, force: true }), (e) => e.code === 'BROLL_APPROVED');
  assert.equal(calls().length, 1);
  const rep = await s.brollImages.generate(id, b.id, { confirm: CONFIRM, force: true, overwriteApproved: true });
  assert.equal(rep.status, 'proposed'); assert.ok(fs.existsSync(s.store.episodes.file(id, 'broll', old)));
  assert.equal(s.store.episodes.get(id).broll.find((x) => x.id === b.id).approvedAssetId, undefined);
  // reject needs an image; no paid video was involved
  await s.sba.setBrollStatus(id, b.id, 'rejected');
  assert.equal(s.store.episodes.get(id).broll.find((x) => x.id === b.id).status, 'rejected');
});

test('failures are classified (credits vs unsupported model), recorded, never retried, and leave the existing image intact', async () => {
  const flag = { on: null };
  const { s, id, calls } = await setupWith(flag);
  route(s);
  await approveWithScenes(s, id);
  const sc = s.store.episodes.get(id).scenes.find((x) => !x.showsProduct);
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'steam rising from a cup' });
  flag.on = new AiError('rate_limited', 'Quota exceeded: billing credits exhausted (RESOURCE_EXHAUSTED)');
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM }), (e) => e.code === 'INSUFFICIENT_CREDITS');
  assert.equal(calls().length, 1, 'exactly one attempt, no automatic retry');
  flag.on = new AiError('bad_request', 'This model does not support image output modalities');
  await assert.rejects(s.brollImages.generate(id, b.id, { confirm: CONFIRM }), (e) => e.code === 'UNSUPPORTED_MODEL');
  const v = s.sba.brollView(s.store.episodes.get(id)).find((x) => x.id === b.id);
  assert.equal(v.imageError.code, 'UNSUPPORTED_MODEL'); assert.equal(v.asset, 'needed');
  // cost safety: no confirmation → nothing is sent, and no error is recorded as a provider failure
  flag.on = null;
  const before = calls().length;
  await assert.rejects(s.brollImages.generate(id, b.id, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(calls().length, before);
  // a success clears the recorded error
  await s.brollImages.generate(id, b.id, { confirm: CONFIRM });
  assert.equal(s.sba.brollView(s.store.episodes.get(id)).find((x) => x.id === b.id).imageError, null);
});

test('suggesting B-rolls never generates images', async () => {
  const { s, id, calls } = await setupWith();
  route(s);
  await approveWithScenes(s, id);
  await s.sba.suggestBroll(id);
  assert.equal(calls().length, 0);
});
