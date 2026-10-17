'use strict';
// Client-side intake logic: clipboard extraction, validation, duplicate fingerprints, reorder, crop geometry, and the
// wiring that makes paste / drop / Photos-Files / crop available (no AI call in the intake code).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makePng, jpegStub, webpStub } = require('./helpers/images');

const JS = path.join(__dirname, '..', 'studio', 'public', 'js');
const core = () => import(path.join(JS, 'image-intake-core.js'));
const file = (buf, name, type) => ({ name, type, size: buf.length, arrayBuffer: async () => buf });

test('clipboard: images are taken from files and from items; text-only pastes are ignored; no duplicates', async () => {
  const { imagesFromTransfer } = await core();
  const png = file(makePng(200, 200), 'image.png', 'image/png');
  assert.deepEqual(imagesFromTransfer({ files: [png], items: [] }), [png]);
  const viaItem = { kind: 'file', type: 'image/png', getAsFile: () => png };
  assert.deepEqual(imagesFromTransfer({ files: [], items: [viaItem, { kind: 'string', type: 'text/plain' }] }), [png]);
  assert.deepEqual(imagesFromTransfer({ files: [png], items: [viaItem] }), [png], 'file listed twice by the browser counts once');
  assert.deepEqual(imagesFromTransfer({ files: [], items: [{ kind: 'string', type: 'text/plain' }] }), []);
  assert.deepEqual(imagesFromTransfer(null), []);
  const heic = file(Buffer.alloc(10), 'IMG_1.HEIC', '');
  assert.equal(imagesFromTransfer({ files: [heic] }).length, 1, 'files with an empty type (iOS) are still offered and validated by content');
});

test('type is detected from content (PNG, JPEG, WebP), not from the reported type', async () => {
  const { sniffType } = await core();
  assert.equal(sniffType(makePng(120, 120)), 'image/png');
  assert.equal(sniffType(jpegStub(300, 300)), 'image/jpeg');
  assert.equal(sniffType(webpStub(300, 300)), 'image/webp');
  assert.equal(sniffType(Buffer.from('GIF89a......')), null);
});

test('validation: type, size and dimensions with actionable messages', async () => {
  const { validate, LIMITS } = await core();
  const ok = { type: 'image/png', size: 1000, width: 800, height: 600 };
  assert.equal(validate(ok).ok, true);
  assert.equal(validate({ ...ok, type: '' }).code, 'BAD_TYPE');
  assert.match(validate({ ...ok, type: '' }).message, /HEIC/);
  assert.equal(validate({ ...ok, size: LIMITS.maxBytes + 1 }).code, 'TOO_LARGE');
  assert.equal(validate({ ...ok, size: 0 }).code, 'EMPTY');
  assert.equal(validate({ ...ok, width: 99 }).code, 'TOO_SMALL');
  assert.equal(validate({ ...ok, height: 8001 }).code, 'TOO_BIG_DIMS');
  assert.equal(validate({ ...ok, width: 0 }).code, 'BAD_IMAGE');
});

test('pasting the same image repeatedly yields the same fingerprint; different images differ; matches the server hash', async () => {
  const { fingerprint } = await core();
  const a = makePng(200, 200, 1); const b = makePng(200, 200, 2);
  const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const fa = await fingerprint(ab(a)); const fa2 = await fingerprint(ab(Buffer.from(a)));
  assert.equal(fa, fa2); assert.notEqual(fa, await fingerprint(ab(b)));
  assert.equal(fa, require('node:crypto').createHash('sha256').update(a).digest('hex'), 'client hash == server sha256 for unmodified files');
});

test('reorder helper moves one step, stays in range and never mutates', async () => {
  const { move } = await core();
  const l = ['a', 'b', 'c'];
  assert.deepEqual(move(l, 0, 1), ['b', 'a', 'c']); assert.deepEqual(move(l, 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(move(l, 0, -1), l); assert.deepEqual(move(l, 2, 1), l); assert.deepEqual(l, ['a', 'b', 'c']);
});

test('crop geometry: stays inside the image, keeps a minimum size, honours aspect ratios, never resizes the output', async () => {
  const { resizeRect, moveRect, fitRatio, outputFormat, cropFitsCanvas } = await core();
  const W = 1000; const H = 800; const full = { x: 0, y: 0, w: W, h: H };
  // trimming browser chrome off the top and a border off the right
  let r = resizeRect('n', full, 0, 120, W, H); assert.deepEqual(r, { x: 0, y: 120, w: 1000, h: 680 });
  r = resizeRect('e', r, -60, 0, W, H); assert.deepEqual(r, { x: 0, y: 120, w: 940, h: 680 });
  // cannot leave the image or collapse
  assert.deepEqual(resizeRect('nw', full, -500, -500, W, H), full);
  const tiny = resizeRect('se', { x: 100, y: 100, w: 200, h: 200 }, -900, -900, W, H, 0, 20);
  assert.ok(tiny.w >= 20 && tiny.h >= 20 && tiny.x === 100);
  // move is clamped
  assert.deepEqual(moveRect({ x: 800, y: 0, w: 200, h: 100 }, 500, -50, W, H), { x: 800, y: 0, w: 200, h: 100 });
  // aspect ratios (width/height)
  const sq = fitRatio(full, 1); assert.deepEqual(sq, { x: 100, y: 0, w: 800, h: 800 });
  const drag = resizeRect('se', { x: 0, y: 0, w: 400, h: 400 }, 200, 10, W, H, 1);
  assert.equal(drag.w, drag.h); assert.ok(drag.x + drag.w <= W && drag.y + drag.h <= H);
  const edge = resizeRect('s', { x: 100, y: 100, w: 400, h: 500 }, 0, 100, W, H, 0.8);
  assert.ok(Math.abs(edge.w / edge.h - 0.8) < 0.01 && edge.y + edge.h <= H);
  // quality: same format, PNG lossless, JPEG/WebP high quality
  assert.deepEqual(outputFormat('image/png'), { type: 'image/png', quality: undefined, ext: '.png' });
  assert.equal(outputFormat('image/jpeg').quality, 0.95); assert.equal(outputFormat('image/webp').type, 'image/webp');
  assert.equal(cropFitsCanvas(4000, 4000), true); assert.equal(cropFitsCanvas(8000, 8000), false);
});

test('wiring: Cmd/Ctrl+V listener, drag-and-drop, Photos/Files picker, clipboard button, crop, reorder, primary, remove', () => {
  const ui = fs.readFileSync(path.join(JS, 'views', 'image-intake.js'), 'utf8');
  const prod = fs.readFileSync(path.join(JS, 'views', 'products.js'), 'utf8');
  assert.match(ui, /addEventListener\('paste'/); assert.match(ui, /imagesFromTransfer\(e\.clipboardData\)/);
  assert.match(ui, /ondrop/); assert.match(ui, /type: 'file', accept: ACCEPT, multiple: true/);
  assert.match(ui, /사진 보관함 · 파일에서 선택/); assert.match(ui, /navigator\.clipboard\.read/);
  assert.match(ui, /cropDialog/); assert.match(ui, /aria-label': '대표 이미지'/); assert.match(ui, /aria-label': '제거'/);
  assert.match(ui, /touch-action|pointerdown/); assert.match(ui, /replace\?source=crop/);
  assert.match(ui, /confirm=1/, 'approved images need confirmation before they are replaced');
  assert.doesNotMatch(ui, /generate|imageGeneration|\/estimate/, 'intake never touches AI generation');
  assert.match(prod, /imageIntake\(/); assert.match(prod, /savedControls\(/);
  assert.doesNotMatch(ui, /Math\.min\([^)]*maxSide|canvas\.width = .*\* 0\./, 'crops are not downscaled');
});
