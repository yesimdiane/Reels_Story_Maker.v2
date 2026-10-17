'use strict';
// B-roll preview and asset state. Root cause of "이미지 있음 + 미리보기 이미지 없음": the storyboard card reads the scene's raw stored
// B-roll records, which carry neither imageUrl nor any file check, while the chip came from a stored "asset" flag. The card now gets the
// enriched view, and "ready" is decided from the real file (exists, readable, a real image, checksum), never from the asset id alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid, png } = require('./helpers/v23');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const base = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
  let n = 700;
  const factory = (name) => { const p = base.factory(name); const o = p.generateImage.bind(p); p.generateImage = async (req) => { await o(req); n += 1; return { images: [{ mimeType: 'image/png', data: png(n).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } }; }; return p; };
  const { s } = make({ ai: { factory, calls: base.calls } });
  const pid = await readyProduct(s); routePaid(s);
  s.integrations.setRouting('imageGeneration', { provider: 'gemini', model: 'model-a' });
  const lab = await s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await s.storylab.approve(pid, lab.concepts[0].id);
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  await approveWithScenes(s, id);
  const sc = s.store.episodes.get(id).scenes.find((x) => !x.showsProduct) || s.store.episodes.get(id).scenes[0];
  return { s, id, sc };
}
const card = (s, id, bid) => s.episodeView(id).scenes.flatMap((x) => x.broll).find((x) => x.id === bid);
const get = (app, url) => new Promise((resolve, reject) => { const port = app.address().port; http.get({ host: '127.0.0.1', port, path: url, headers: { Host: '127.0.0.1:' + port } }, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(c), type: r.headers['content-type'] })); }).on('error', reject); });
async function serve(s) { const app = createApp(s, { token: '', port: 0 }); await new Promise((r) => app.listen(0, '127.0.0.1', r)); return app; }

test('uploaded image: the scene card gets a working URL, dimensions and state; the server returns the saved bytes', async () => {
  const { s, id, sc } = await setup();
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'steam from a cup' });
  assert.equal(card(s, id, b.id).imageState, 'none'); assert.equal(card(s, id, b.id).imageUrl, '');
  await s.sba.uploadBrollImage(id, b.id, png(7), 'a.png');
  const c = card(s, id, b.id);
  assert.equal(c.imageState, 'ready'); assert.equal(c.asset, 'ready'); assert.ok(c.imageUrl.startsWith(`/media/broll/${id}/${b.id}?v=`));
  assert.ok(c.imageInfo.width > 0 && c.imageInfo.height > 0 && c.imageInfo.bytes > 0, JSON.stringify(c.imageInfo));
  assert.match(c.assetId, new RegExp(`^${b.id}:`)); assert.equal(c.imageGenerated, false);
  const app = await serve(s);
  try {
    const r = await get(app, c.imageUrl);
    assert.equal(r.status, 200); assert.match(r.type, /image\//);
    assert.deepEqual(r.body, fs.readFileSync(s.sba.brollFile(s.store.episodes.get(id), s.store.episodes.get(id).broll.find((x) => x.id === b.id))), 'the exact saved file');
  } finally { app.close(); }
});

test('generated image: saved, verified accessible, previewable, NOT auto-approved', async () => {
  const { s, id, sc } = await setup();
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'steam from a cup' });
  const saved = await s.brollImages.generate(id, b.id, { confirm: CONFIRM });
  assert.equal(saved.status, 'proposed');
  const c = card(s, id, b.id);
  assert.equal(c.imageState, 'ready'); assert.equal(c.imageGenerated, true); assert.ok(c.imageUrl); assert.equal(c.needsAttention, false);
  assert.ok(c.promptText && /steam from a cup/.test(c.promptText), 'the card shows the prompt');
  assert.ok(Array.isArray(c.refs));
});

test('missing / unreadable / corrupt / altered files are told apart — never "ready" from the asset id alone', async () => {
  const { s, id, sc } = await setup();
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'x' });
  await s.sba.uploadBrollImage(id, b.id, png(8), 'a.png');
  const file = () => s.sba.brollFile(s.store.episodes.get(id), s.store.episodes.get(id).broll.find((x) => x.id === b.id));
  const orig = fs.readFileSync(file());
  fs.rmSync(file());
  let c = card(s, id, b.id);
  assert.equal(c.imageState, 'missing'); assert.equal(c.asset, 'needed'); assert.equal(c.imageUrl, ''); assert.match(c.imageProblem, /서버에 없습니다/);
  assert.ok(s.store.episodes.get(id).broll.find((x) => x.id === b.id).imageRef, 'the asset id/reference is still there — that alone does not make it ready');
  fs.writeFileSync(file(), Buffer.from('not an image at all'));
  assert.equal(card(s, id, b.id).imageState, 'inaccessible');
  fs.writeFileSync(file(), Buffer.concat([orig, Buffer.from([1])])); // valid image header but different content
  assert.equal(card(s, id, b.id).imageState, 'inaccessible'); assert.match(card(s, id, b.id).imageProblem, /체크섬/);
  fs.writeFileSync(file(), orig);
  assert.equal(card(s, id, b.id).imageState, 'ready', 'restoring the file restores the state');
});

test('a reference that points at nothing (scene start frame that does not exist) is "missing", with the reason', async () => {
  const { s, id, sc } = await setup();
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'x', imageRef: { type: 'scene_start', sceneId: sc.id } });
  const c = card(s, id, b.id);
  assert.equal(c.imageState, 'missing'); assert.equal(c.imageUrl, ''); assert.match(c.imageProblem, /시작 프레임/);
  await assert.rejects(s.sba.setBrollStatus(id, b.id, 'approved'), (e) => e.code === 'IMAGE_NOT_ACCESSIBLE');
});

test('approval needs a saved, accessible image; an approved B-roll whose file disappears keeps its approval, is flagged, and blocks the render', async () => {
  const { s, id, sc } = await setup();
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'x' });
  await assert.rejects(s.sba.setBrollStatus(id, b.id, 'approved'), (e) => e.code === 'IMAGE_NEEDED');
  await s.sba.uploadBrollImage(id, b.id, png(9), 'a.png');
  await s.sba.setBrollStatus(id, b.id, 'approved');
  const ap = s.store.episodes.get(id).broll.find((x) => x.id === b.id);
  const assetId = ap.approvedAssetId; assert.ok(assetId);
  assert.equal(s.renderer.plan(id).problems.some((p) => p.code === 'BROLL_IMAGE_MISSING'), false, 'a healthy approved B-roll does not block');
  fs.rmSync(s.sba.brollFile(s.store.episodes.get(id), ap));
  const c = card(s, id, b.id);
  assert.equal(c.status, 'approved', 'approval history preserved'); assert.equal(c.needsAttention, true); assert.equal(c.imageState, 'missing');
  assert.equal(s.store.episodes.get(id).broll.find((x) => x.id === b.id).approvedAssetId, assetId);
  const p = s.renderer.plan(id).problems.find((x) => x.code === 'BROLL_IMAGE_MISSING');
  assert.ok(p && /서버에 없습니다/.test(p.message), p && p.message);
  const rr = s.renderReadiness.check(s.store.episodes.get(id)).items.find((i) => i.code === 'BROLL_IMAGE_MISSING');
  assert.ok(rr && rr.severity === 'block' && rr.stage === 'render');
});

test('invalid asset URLs are 404 with a reason, never a blank 200', async () => {
  const { s, id, sc } = await setup();
  const b = await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'x' });
  const app = await serve(s);
  try {
    assert.equal((await get(app, `/media/broll/${id}/${b.id}`)).status, 404, 'no image yet');
    assert.equal((await get(app, `/media/broll/${id}/BR999`)).status, 404, 'unknown B-roll');
    assert.equal((await get(app, `/media/broll/NOPE-EP/${b.id}`)).status, 404, 'unknown episode');
    await s.sba.uploadBrollImage(id, b.id, png(10), 'a.png');
    assert.equal((await get(app, `/media/broll/${id}/${b.id}`)).status, 200);
    await s.sba.removeBroll(id, b.id);
    assert.equal((await get(app, `/media/broll/${id}/${b.id}`)).status, 404, 'removed B-roll');
  } finally { app.close(); }
});

test('persistence: previews survive reload, scene reordering, storyboard approval and a fresh read of the stored data', async () => {
  const { s, id, sc } = await setup();
  const b = await s.brollImages.generate(id, (await s.sba.saveBroll(id, { sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 1, effect: 'x' })).id, { confirm: CONFIRM });
  const url = card(s, id, b.id).imageUrl;
  assert.ok(url);
  await s.store.episodes.update(id, (e) => { e.scenes.reverse(); });
  assert.equal(card(s, id, b.id).imageUrl, url, 'reorder');
  await s.store.episodes.update(id, (e) => { e.scenes.reverse(); });
  assert.equal(card(s, id, b.id).imageState, 'ready', 'second read (reload)');
  const stored = JSON.parse(JSON.stringify(s.store.episodes.get(id)));
  assert.equal(stored.broll.find((x) => x.id === b.id).imageRef.type, 'upload', 'only the reference is stored; the file is the source of truth');
  // never regenerated by viewing/refreshing/navigating
  const before = fs.readdirSync(s.store.episodes.file(id, 'broll')).length;
  for (let i = 0; i < 3; i++) s.episodeView(id);
  assert.equal(fs.readdirSync(s.store.episodes.file(id, 'broll')).length, before, 'no new image was created by reading');
});
