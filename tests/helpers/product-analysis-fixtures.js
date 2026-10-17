'use strict';
// Shared fixtures for the product visual analysis tests: a fake vision AI (no network), approved character refs, an episode with an approved script.
const { approveWithScenes } = require('./approve');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, png, readyProduct, routePaid } = require('./v23');

const CONFIRM = { paid: true, unknownCost: true };
const GOOD = {
  component_count: { count: 3, basis: 'three vertical slots in a row', certain: true },
  items: [
    { section: 'shape', statement: 'A tall rectangular holder with softly rounded corners.', status: 'verified' },
    { section: 'components', statement: 'One backplate and three identical vertical slots.', status: 'verified' },
    { section: 'color_material', statement: 'Matte charcoal surface that looks like plastic; exact material cannot be confirmed.', status: 'uncertain' },
    { section: 'compartments', statement: 'The three slots are separated by two thin dividers.', status: 'verified' },
    { section: 'proportions', statement: 'Roughly three times taller than it is wide.', status: 'uncertain' },
    { section: 'mounting', statement: 'Two round screw holes are visible near the top edge.', status: 'verified' },
    { section: 'details', statement: 'A small recessed notch sits at the bottom center.', status: 'verified' },
  ],
  not_visible: ['The back side and the underside are not visible in the photos.'],
  negative_constraints: ['Do not add a fourth slot.'],
};

/** Fake AI: answers the vision analysis, concepts and scripts; image generation returns a different image every call. */
function ai({ analysis = () => GOOD, imageBytes = null } = {}) {
  const base = fakeAi({ '*': (req) => (/product photo analyst/.test(req.system || '') ? { text: '', json: analysis(req), usage: { inputTokens: 900, outputTokens: 400 } } : { text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 300;
  const factory = (name) => {
    const p = base.factory(name);
    const orig = p.generateImage.bind(p);
    p.generateImage = async (req) => { await orig(req); n += 1; return { images: [{ mimeType: 'image/png', data: (imageBytes ? imageBytes(n) : png(n)).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } }; };
    return p;
  };
  return { factory, calls: base.calls, imageCalls: () => base.calls.filter((c) => c.image), analysisCalls: () => base.calls.filter((c) => !c.image && /product photo analyst/.test(c.system || '')) };
}
const visionRoute = (s) => routePaid(s, 'gemini', ['productUnderstanding']);
function imageRoute(s) { s.integrations.setKey('gemini', 'gem-key-123456789'); s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' }); }
function realRefs(s) {
  ['jack', 'diane'].forEach((cid, i) => {
    s.store.characters.addReference(cid, { buffer: png(50 + i), filename: cid + '.png', mime: 'image/png', label: cid + ' sheet' });
    const r = s.store.characters.get(cid).references.slice(-1)[0];
    s.store.characters.setReferenceApproved(cid, r.id, true);
  });
}
async function setupProduct(opts) {
  const a = ai(opts);
  const { s } = make({ ai: a });
  const pid = await readyProduct(s);
  return { s, a, pid };
}
/** Episode with an APPROVED script, real character refs, an image route; the second scene shows the product. */
async function setupEpisode(opts) {
  const { s, a, pid } = await setupProduct(opts);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  realRefs(s); imageRoute(s); visionRoute(s);
  await approveWithScenes(s, id);
  const sceneId = s.store.episodes.get(id).scenes.find((x) => x.showsProduct).id;
  return { s, a, pid, id, sceneId };
}

module.exports = { CONFIRM, GOOD, ai, visionRoute, imageRoute, realRefs, setupProduct, setupEpisode };
