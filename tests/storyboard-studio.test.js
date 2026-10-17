'use strict';
// Storyboard Studio: 0.5 s movement plan, 제품 등장 toggle + placement, separate B-roll library, revisions, no hidden paid generation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid, png } = require('./helpers/v23');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  m.s.loadDemoReferences && await m.s.loadDemoReferences();
  const lab = await m.s.storylab.generate(pid, { category: 'drama', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  await approveWithScenes(m.s, id);
  const ep = m.s.store.episodes.get(id);
  return Object.assign(m, { pid, id, ai, sid: ep.scenes[0].id, sid2: ep.scenes[1].id });
}
const beat = (t0, t1, over = {}) => Object.assign({ t0, t1, character: 'Diane', emotion: 'worried', body: 'raises her right hand', gaze: 'looks left, then right', expression: 'eyebrows lift', camera: '' }, over);

test('movement beats: 0.1 s precise grid (default drafts stay on 0.5 s), inside the scene, emotion + at least one motion field, no same-character overlap — scenes are never stretched', async () => {
  const m = await setup();
  const dur = m.s.store.episodes.get(m.id).scenes[0].durationSec;
  const bad = (beats, re) => assert.rejects(m.s.sba.saveMotion(m.id, m.sid, { beats }), (e) => e.code === 'INVALID_MOTION' && re.test(e.message), re.source);
  await bad([beat(0, 0.25)], /0\.1초 단위/); // off-grid: rejected with the precise-grid message
  assert.deepEqual(m.s.sba.cleanBeats([beat(0, 0.3)], m.s.store.episodes.get(m.id).scenes[0]).problems, [], '0.3s is a valid edit');
  await bad([beat(1, 1)], /끝 시간은 시작보다/);
  await bad([beat(0, dur + 0.5)], /장면 길이.*벗어납니다/);
  await bad([beat(0, 1, { emotion: '' })], /감정/);
  await bad([beat(0, 1, { body: '', gaze: '', expression: '' })], /하나는 필요/);
  await bad([beat(0, 1), beat(0.5, 1.5)], /겹칩니다/);
  await assert.rejects(m.s.sba.saveMotion(m.id, m.sid, { beats: 'nope' }), (e) => e.code === 'BAD_BEATS');
  const autoRev = JSON.stringify(m.s.store.episodes.get(m.id).motion[m.sid]);
  assert.equal(m.s.store.episodes.get(m.id).motion[m.sid].source, 'auto', 'script approval created a scene-specific plan');
  assert.equal(autoRev, JSON.stringify(m.s.store.episodes.get(m.id).motion[m.sid]), 'rejected saves changed nothing');
  assert.equal(m.s.store.episodes.get(m.id).scenes[0].durationSec, dur, 'the scene length never changed');
  // valid: different characters may overlap; a beat may span several steps; not every body part is required
  const saved = await m.s.sba.saveMotion(m.id, m.sid, { beats: [beat(0, 0.5), beat(0.5, 1.5, { character: 'Jack', body: '', gaze: 'looks at Diane', expression: '' }), beat(0.5, 1, { character: 'Diane', body: 'tilts her head toward Jack', emotion: 'skeptical' })] });
  assert.equal(saved.rev, 2); assert.equal(saved.beats.length, 3); assert.deepEqual(saved.beats.map((b) => b.t0), [0, 0.5, 0.5]);
});

test('motion revisions are kept; saving the plan changes neither the approved script nor other scenes', async () => {
  const m = await setup();
  const before = JSON.stringify(m.s.store.episodes.get(m.id).lines) + JSON.stringify(m.s.store.episodes.get(m.id).approvals);
  await m.s.sba.saveMotion(m.id, m.sid, { beats: [beat(0, 1)] });
  const r2 = await m.s.sba.saveMotion(m.id, m.sid, { beats: [beat(0, 1, { emotion: 'relieved' }), beat(1, 1.5, { emotion: 'happy' })] });
  assert.equal(r2.rev, 3); assert.equal(r2.history.length, 2); assert.equal(r2.history[1].rev, 2); assert.equal(r2.history[1].beats[0].emotion, 'worried');
  const ep = m.s.store.episodes.get(m.id);
  assert.equal(JSON.stringify(ep.lines) + JSON.stringify(ep.approvals), before, 'dialogue and approvals untouched');
  assert.equal(ep.motion[m.sid2].rev, 1, 'other scenes untouched (still their automatic plan)');
  assert.equal(m.s.episodeView(m.id).derived.scriptApproved, true);
  assert.equal(m.s.episodeView(m.id).scenes[0].motion.rev, 3);
});

test('the free draft is deterministic, on the 0.5 s grid and makes no AI call', async () => {
  const m = await setup();
  const calls = m.ai.calls.length;
  const r = await m.s.sba.draftMotion(m.id, m.sid);
  assert.equal(m.ai.calls.length, calls);
  assert.equal(r.source, 'template');
  const dur = m.s.store.episodes.get(m.id).scenes[0].durationSec;
  assert.ok(r.beats.length >= 2);
  r.beats.forEach((b) => { assert.ok(Math.abs(b.t0 / 0.5 - Math.round(b.t0 / 0.5)) < 1e-9); assert.ok(b.t1 <= dur && b.t1 > b.t0); assert.ok(b.emotion); });
  const again = m.s.sba.draftBeats(m.s.store.episodes.get(m.id), m.s.store.episodes.get(m.id).scenes[0]);
  assert.deepEqual(again, r.beats, 'same input, same draft');
});

test('the movement plan is appended to the video prompt at generation time (and a changed plan changes the prompt text)', async () => {
  const m = await setup();
  await m.s.store.episodes.update(m.id, (e) => { delete e.motion; });
  const ep0 = m.s.store.episodes.get(m.id);
  assert.equal(m.s.sba.composePrompt(ep0, m.sid, 'BASE'), 'BASE', 'no plan, no change');
  await m.s.sba.saveMotion(m.id, m.sid, { beats: [beat(0, 0.5), beat(0.5, 1.5, { character: 'Jack', emotion: 'annoyed', camera: 'slow push-in' })] });
  const text = m.s.sba.composePrompt(m.s.store.episodes.get(m.id), m.sid, 'BASE');
  assert.match(text, /^BASE\n\nANIMATION TIMELINE \(0\.5-second steps/);
  assert.match(text, /0\.0–0\.5s: Diane; raises her right hand; eyes: looks left, then right; face: eyebrows lift; emotion: worried\./);
  assert.match(text, /0\.5–1\.5s: Jack;[^\n]*emotion: annoyed; camera: slow push-in\./);
  const gen = fs.readFileSync(path.join(__dirname, '..', 'studio', 'lib', 'generation.js'), 'utf8');
  assert.match(gen, /composePrompt\(store\.episodes\.get\(epId\), sceneId, prompt\.video\)/, 'the provider receives the composed prompt');
  assert.match(gen, /prompt: videoPromptWithOutfit\(ep, scene, composePrompt\(ep, scene\.id, p\.video\)\)/, 'and the job key includes outfit continuity');
});

test('제품 등장 ON/OFF: ON adds the structured placement and the verified product block; OFF never forces the product', async () => {
  const m = await setup();
  const place = { position: 'left', scale: 'large', orientation: 'angled', visibility: 'hero', interaction: 'Diane holds it up', refImageId: 'x', bogus: 'ignored' };
  await m.s.saveScene(m.id, m.sid, { scene: { showsProduct: true, productPlacement: Object.assign({}, place, { position: 'sideways' }) } });
  let sc = m.s.store.episodes.get(m.id).scenes[0];
  assert.equal(sc.showsProduct, true);
  assert.equal(sc.productPlacement.position, undefined, 'an unknown option is dropped');
  assert.equal(sc.productPlacement.scale, 'large'); assert.equal(sc.productPlacement.bogus, undefined);
  await m.s.saveScene(m.id, m.sid, { scene: { productPlacement: place } });
  await m.s.rebuildPrompts(m.id, [m.sid], { force: true });
  const on = m.s.store.episodes.get(m.id).prompts[m.sid].video;
  assert.match(on, /PRODUCT PLACEMENT FOR THIS SCENE[^\n]*position: left; scale: large; orientation: angled; visibility: hero; character interaction: Diane holds it up/);
  assert.match(on, /자석으로 부착 가능|magnet|PRODUCT/i);
  await m.s.saveScene(m.id, m.sid, { scene: { showsProduct: false } });
  await m.s.rebuildPrompts(m.id, [m.sid], { force: true });
  const off = m.s.store.episodes.get(m.id).prompts[m.sid].video;
  assert.doesNotMatch(off, /PRODUCT PLACEMENT/);
  assert.ok(off.length < on.length, 'OFF drops the product block and the placement');
  assert.ok(!off.includes(m.s.store.episodes.get(m.id).product.verifiedFeatures[0]), 'the verified product feature text is not forced into the frame');
  sc = m.s.store.episodes.get(m.id).scenes[0];
  assert.equal(sc.showsProduct, false);
});

test('prompt edits keep numbered revisions', async () => {
  const m = await setup();
  await m.s.rebuildPrompts(m.id, [m.sid], { force: true });
  const base = m.s.store.episodes.get(m.id).prompts[m.sid].video;
  await m.s.savePrompt(m.id, m.sid, { video: base + ' Extra camera note.', negative: '' });
  await m.s.savePrompt(m.id, m.sid, { video: base + ' Another note.', negative: '' });
  const p = m.s.store.episodes.get(m.id).prompts[m.sid];
  assert.ok(p.rev >= 3); assert.equal(p.history.length >= 2, true);
  assert.equal(p.history[0].video, base, 'the first version is still readable');
});

test('B-roll is a separate still-image library: free suggestions, timing rules, review states, no video jobs, scenes untouched', async () => {
  const m = await setup();
  const scenesBefore = JSON.stringify(m.s.store.episodes.get(m.id).scenes);
  const calls = m.ai.calls.length;
  const made = await m.s.sba.suggestBroll(m.id);
  assert.ok(made.length >= 1);
  assert.equal(m.ai.calls.length, calls, 'suggestions are free');
  assert.equal((await m.s.sba.suggestBroll(m.id)).length, 0, 'never duplicates');
  const ep = m.s.store.episodes.get(m.id);
  assert.equal(JSON.stringify(ep.scenes), scenesBefore, 'the primary scenes are not changed');
  assert.deepEqual(ep.generation.jobs, [], 'B-roll never creates a video generation job');
  assert.ok(made.every((b) => b.status === 'proposed' && b.asset === 'needed' && b.origin === 'suggested'));
  const sc = ep.scenes.find((s) => s.id === made[0].sceneId);
  const bad = (raw, re) => assert.rejects(m.s.sba.saveBroll(m.id, raw), (e) => e.code === 'INVALID_BROLL' && re.test(e.message), re.source);
  await bad({ sceneId: sc.id, kind: 'broll', insertAtSec: sc.durationSec, durationSec: 1 }, /장면 길이/);
  await bad({ sceneId: sc.id, kind: 'broll', insertAtSec: 0, durationSec: 0.2 }, /0\.5초 이상/);
  await bad({ sceneId: sc.id, kind: 'broll', insertAtSec: made[0].insertAtSec, durationSec: 0.5 }, /겹칩니다/);
  await assert.rejects(m.s.sba.setBrollStatus(m.id, made[0].id, 'approved'), (e) => e.code === 'IMAGE_NEEDED', 'approval needs an image');
  // give it an image from the product references, then approve
  const prod = m.s.products.raw(m.pid);
  const b1 = await m.s.sba.saveBroll(m.id, { id: made[0].id, imageRef: { type: 'product', imageId: prod.images[0].id } });
  assert.equal(b1.asset, 'ready'); assert.equal(b1.rev, 2);
  await m.s.sba.setBrollStatus(m.id, b1.id, 'approved');
  assert.deepEqual(m.s.sba.approvedBroll(m.s.store.episodes.get(m.id)).map((b) => b.id), [b1.id]);
  // editing an approved item sends it back to review
  const b2 = await m.s.sba.saveBroll(m.id, { id: b1.id, durationSec: 0.5 });
  assert.equal(b2.status, 'proposed'); assert.equal(b2.rev, 3); assert.ok(b2.history.length >= 2);
  assert.deepEqual(m.s.sba.approvedBroll(m.s.store.episodes.get(m.id)), []);
  // uploads become numbered, stored images
  const up = await m.s.sba.uploadBrollImage(m.id, b1.id, png(9), 'insert.png');
  assert.equal(up.imageRef.type, 'upload'); assert.ok(fs.existsSync(m.s.mediaFile('broll', m.id, b1.id)));
  // removal is soft
  await m.s.sba.removeBroll(m.id, b1.id);
  assert.equal(m.s.sba.brollView(m.s.store.episodes.get(m.id)).some((b) => b.id === b1.id), false);
  assert.ok(m.s.store.episodes.get(m.id).broll.some((b) => b.id === b1.id && b.status === 'removed'), 'kept on disk');
  assert.deepEqual(m.s.store.episodes.get(m.id).generation.jobs, []);
});

test('per-scene approval and regeneration never touch other scenes; paid image generation still needs confirmation', async () => {
  const m = await setup();
  await m.s.uploadStartFrame(m.id, m.sid, png(2), 'a.png');
  await m.s.uploadStartFrame(m.id, m.sid2, png(3), 'b.png');
  await m.s.approveStartFrame(m.id, m.sid, true);
  const a = JSON.stringify(m.s.store.episodes.get(m.id).scenes.find((s) => s.id === m.sid).startImage);
  await m.s.approveStartFrame(m.id, m.sid2, true);
  await m.s.uploadStartFrame(m.id, m.sid2, png(4), 'c.png'); // "regenerate" scene 2 with a new frame
  const eps = m.s.store.episodes.get(m.id);
  assert.equal(JSON.stringify(eps.scenes.find((s) => s.id === m.sid).startImage), a, 'scene 1 keeps its approved frame');
  assert.equal(eps.scenes.find((s) => s.id === m.sid2).startImage.approved, false, 'the new frame of scene 2 needs its own approval');
  // without a real approved character reference the request stops first, with the exact message
  await assert.rejects(m.s.startImages.generate(m.id, [m.sid2], {}), (e) => /Character reference missing/.test(e.message));
  ['jack', 'diane'].forEach((cid, i) => { m.s.store.characters.addReference(cid, { buffer: png(120 + i), filename: cid + '.png', mime: 'image/png' }); const r = m.s.store.characters.get(cid).references.slice(-1)[0]; m.s.store.characters.setReferenceApproved(cid, r.id, true); });
  await assert.rejects(m.s.startImages.generate(m.id, [m.sid2], {}), (e) => /CONFIRM|확인|승인|연결/.test(e.code + e.message));
});

test('HTTP: motion, draft and B-roll routes', async () => {
  const m = await setup();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    const base = `/api/episodes/${m.id}`;
    assert.equal((await call('PUT', `${base}/scenes/${m.sid}/motion`, { beats: [beat(0, 0.25)] })).status, 422);
    assert.equal((await call('PUT', `${base}/scenes/${m.sid}/motion`, { beats: [beat(0, 0.3)] })).status, 200);
    assert.equal((await call('PUT', `${base}/scenes/${m.sid}/motion`, { beats: [beat(0, 1)] })).status, 200);
    assert.equal((await call('POST', `${base}/scenes/${m.sid2}/motion/draft`)).status, 200);
    const sg = await call('POST', `${base}/broll/suggest`);
    assert.equal(sg.status, 200); assert.ok(sg.json.suggested >= 1);
    const list = (await call('GET', `${base}/broll`)).json.broll;
    assert.equal((await call('POST', `${base}/broll/${list[0].id}/status`, { status: 'approved' })).status, 409);
    assert.equal((await call('DELETE', `${base}/broll/${list[0].id}`)).status, 200);
  } finally { await new Promise((r) => app.close(r)); }
});

test('the Storyboard screen is one scene at a time with the primary actions, a product toggle, 0.5 s beats and an Add Cut chooser', () => {
  const viewsDir = path.join(__dirname, '..', 'studio', 'public', 'js', 'views');
  const src = fs.readFileSync(path.join(viewsDir, 'storyboard.js'), 'utf8') + fs.readFileSync(path.join(viewsDir, 'beat-timeline.js'), 'utf8'); // the 0.5 s timeline editor is a shared component
  for (const k of ['data-sb-scene', 'data-sb-save', 'data-sb-approve-image', 'data-sb-regenerate', 'data-sb-next', 'data-sb-add-cut', 'data-product-toggle', 'data-motion-beats', 'data-broll-list']) assert.match(src, new RegExp(k), k);
  assert.match(src, /제품 등장/); assert.match(src, /\+ 컷 추가/); assert.match(src, /B-roll/);
  assert.match(src, /details/, 'advanced parts are collapsed');
});
