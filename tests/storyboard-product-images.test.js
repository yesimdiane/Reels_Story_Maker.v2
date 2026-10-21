'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { make, png } = require('./helpers/v23');

test('existing storyboard resolves current Product Studio uploads without a reference snapshot', async (t) => {
  const { s } = make();
  t.after(() => fs.rmSync(s.store.dir, { recursive: true, force: true }));
  const p = await s.products.create({ name: '우산꽂이' });
  await s.products.upload(p.id, png(10), 'umbrella.png');
  const image = s.products.get(p.id).images[0];
  const ep = s.store.episodes.list()[0];
  await s.store.episodes.update(ep.id, (e) => {
    e.productId = p.id;
    delete e.productRefs;
    e.scenes[0].showsProduct = true;
  });
  const before = s.store.episodes.get(ep.id);
  const view = s.episodeView(ep.id);
  assert.equal(view.productStudioImages[0].url, `/media/product/${p.id}/${image.id}`);
  assert.equal(view.scenes[0].productImages[0].status, 'pending');
  assert.deepEqual(view.productRefImages, [], 'preview does not approve the upload');
  assert.deepEqual(s.store.episodes.get(ep.id), before, 'reading the storyboard does not rewrite user data');
  const off = await s.saveScript(ep.id, { scenes: before.scenes.map((sc, i) => i ? { id: sc.id } : { id: sc.id, showsProduct: false }) });
  assert.deepEqual(off.scenes[0].productImages, []);
  assert.equal(off.productStudioImages.length, 1);
  assert.deepEqual(off.scenes[0].startImage, before.scenes[0].startImage);
});

test('storyboard follows replacement uploads and excludes rejected images and other products', async (t) => {
  const { s } = make();
  t.after(() => fs.rmSync(s.store.dir, { recursive: true, force: true }));
  const p = await s.products.create({ name: '제품 A' });
  await s.products.upload(p.id, png(11), 'old.png');
  const old = s.products.get(p.id).images[0];
  await s.products.replace(p.id, old.id, png(12), 'new.png');
  await s.products.upload(p.id, png(13), 'rejected.png');
  const images = s.products.get(p.id).images;
  await s.products.setStatus(p.id, images.find((im) => im.label === 'rejected').id, 'rejected');
  const other = await s.products.create({ name: '제품 B' });
  await s.products.upload(other.id, png(14), 'other.png');
  const ep = s.store.episodes.list()[0];
  await s.store.episodes.update(ep.id, (e) => { e.productId = p.id; e.scenes[0].showsProduct = true; });
  const view = s.episodeView(ep.id);
  assert.equal(view.scenes[0].productImages.length, 1);
  assert.equal(view.scenes[0].productImages[0].id, images.find((im) => im.id !== old.id && im.status !== 'replaced' && im.label !== 'rejected').id);
  await s.store.episodes.update(ep.id, (e) => { e.productId = 'PRD-missing'; });
  assert.deepEqual(s.episodeView(ep.id).scenes[0].productImages, []);
});

test('제품 등장 toggle immediately previews the product images and placement controls; saving sends the scene; a failed save keeps the draft', async () => {
  const nodes = [];
  const h = (tag, attrs, ...children) => {
    const node = { tag, attrs: attrs || {}, children: children.flat(Infinity).filter(Boolean), append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; }, addEventListener() {}, querySelector: () => ({ addEventListener() {} }), cloneNode() { return { querySelector: () => ({ addEventListener() {} }) }; }, click() {} };
    nodes.push(node);
    return node;
  };
  const ep = { id: 'E1', productId: 'P1', productStudioImages: [{ id: 'im1', url: '/media/product/P1/im1', status: 'pending' }], lines: [], derived: { scriptApproved: true }, scenes: [], inserts: [] };
  const sc = { id: 'S1', characters: [], visual: 'v', showsProduct: false, clips: {}, promptWarnings: [], durationSec: 4, title_ko: '제목', inserts: [], broll: [] };
  ep.scenes = [sc];
  const state = { draft: {}, summary: { characters: [] }, ui: { open: {} } };
  const calls = [];
  let fail = false;
  const context = { h, state, translateControl: () => ({ btn: null, panel: null }), charRefsPanelBody: () => null, charRefsBadge: () => '', clipsPanelBody: () => null, clipsBadge: () => '', motionPanel: () => null, sceneGallery: () => null, frameProvenance: () => null, block: (k, n, t, hint, ...kids) => h('section', null, ...kids), shotChips: () => null, moveChips: () => null, dialoguePanelBody: () => null, animationHandoff: () => null, imagePromptBody: () => null, lookFields: () => null, characterRoles: () => null, poseFields: () => null, elementsBlock: () => null, seedElements() {}, stepper: () => null, audioPanelBody: () => null, audioBadge: () => '', composePanelBody: () => null, composeBadge: () => '', chip: () => null, icon: () => null, api: { put: async (url, body) => { calls.push({ url, body }); if (fail) throw Error('failed'); return ep; } }, act: async (fn) => { try { return await fn(); } catch { return null; } }, toast() {}, confirmDialog: async () => true, copyText() {}, modal() {}, openCutEditor() {}, imageDevCard: () => null, productRefStrip: () => null, makeStartImages() {}, lockedNotice: () => null, pageHead: () => null, noEpisode: () => null, requireEpisode: () => ep };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../studio/public/js/views/storyboard.js'), 'utf8').replace(/^import [\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  context.sceneCard(ep, sc, 0, [], () => {});
  const toggle = nodes.find((n) => n.attrs['data-product-toggle']);
  const input = toggle.children.find((c) => c.tag === 'input');
  const placeBox = nodes.find((n) => n.attrs['data-placement'] !== undefined);
  assert.ok(!JSON.stringify(placeBox.children).includes('/media/product/P1/im1'), 'OFF: no product images are forced into the scene');
  input.attrs.onchange({ target: { checked: true } });
  assert.ok(JSON.stringify(placeBox.children).includes('/media/product/P1/im1'), 'ON: the product studio images are offered');
  assert.ok(nodes.some((n) => n.attrs['data-place'] === 'position'), 'ON: placement controls appear');
  const save = nodes.find((n) => n.attrs['data-sb-save']);
  await save.attrs.onclick();
  assert.equal(calls[0].url, '/api/episodes/E1/scenes/S1');
  assert.equal(calls[0].body.scene.showsProduct, true);
  assert.ok(calls[0].body.scene.productPlacement, 'the placement travels with the scene');
  fail = true;
  await save.attrs.onclick();
  assert.equal(state.draft['sb:S1'].showsProduct, true, 'the draft is kept when saving fails');
});
