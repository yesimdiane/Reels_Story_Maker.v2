'use strict';
// Small real/stub images for upload tests. makePng() produces a fully valid, decodable PNG (pure JS, no ffmpeg).
const zlib = require('node:zlib');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
/** shade varies the pixel colour so each call can produce different bytes (= a different hash). */
function makePng(w = 200, h = 200, shade = 0) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = (x * 255 / w + shade) & 255; row[2 + x * 3] = (shade * 7) & 255; row[3 + x * 3] = 128; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Header-only JPEG (SOI + SOF0): enough for size checks. */
function jpegStub(w, h, tail = 0) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9, tail])]);
}
/** Header-only WebP (VP8X): enough for size checks. */
function webpStub(w, h, tail = 0) {
  const b = Buffer.alloc(30 + 1);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); b[30] = tail;
  return b;
}
module.exports = { makePng, jpegStub, webpStub };
