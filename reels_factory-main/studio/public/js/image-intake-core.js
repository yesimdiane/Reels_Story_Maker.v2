// Pure helpers for Product Studio image intake (paste / drop / pick / crop). No DOM access: unit-tested in Node.
export const ACCEPT = 'image/png,image/jpeg,image/webp';
export const LIMITS = { maxBytes: 10 * 1024 * 1024, minSide: 100, maxSide: 8000, maxCanvasPixels: 16777216 };
const MIME_LABEL = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP' };

/** File type from the first bytes (the clipboard / Photos often report an empty or wrong type). */
export function sniffType(bytes) {
  const b = bytes;
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** { ok, code, message } for a decoded candidate: { type, size, width, height }. */
export function validate({ type, size, width, height }) {
  if (!MIME_LABEL[type]) return { ok: false, code: 'BAD_TYPE', message: 'PNG, JPG, WebP 이미지만 올릴 수 있습니다. (HEIC 사진은 사진 보관함에서 고르면 자동으로 JPG로 변환됩니다.)' };
  if (!size) return { ok: false, code: 'EMPTY', message: '빈 이미지입니다.' };
  if (size > LIMITS.maxBytes) return { ok: false, code: 'TOO_LARGE', message: `${(size / 1048576).toFixed(1)} MB — 10 MB 이하 이미지만 가능합니다.` };
  if (!width || !height) return { ok: false, code: 'BAD_IMAGE', message: '이미지를 읽을 수 없습니다.' };
  if (Math.min(width, height) < LIMITS.minSide) return { ok: false, code: 'TOO_SMALL', message: `너무 작습니다 (${width}×${height}px). 짧은 변이 ${LIMITS.minSide}px 이상이어야 합니다.` };
  if (Math.max(width, height) > LIMITS.maxSide) return { ok: false, code: 'TOO_BIG_DIMS', message: `너무 큽니다 (${width}×${height}px). 긴 변은 ${LIMITS.maxSide}px 이하여야 합니다.` };
  return { ok: true };
}

/** Image files from a paste / drop DataTransfer (or any object shaped like one). Same file never appears twice. */
export function imagesFromTransfer(dt) {
  if (!dt) return [];
  const out = [];
  const add = (f) => { if (f && (/^image\//i.test(f.type || '') || !f.type) && !out.includes(f)) out.push(f); };
  Array.from(dt.files || []).forEach(add);
  if (!out.length) Array.from(dt.items || []).forEach((it) => { if (it && it.kind === 'file' && /^image\//i.test(it.type || '')) add(it.getAsFile && it.getAsFile()); });
  return out.filter((f) => /^image\//i.test(f.type || '') || (f.name && /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name)) || !f.type);
}

/** Stable content fingerprint (SHA-256 when available — equals the server's hash for unmodified files). */
export async function fingerprint(buf) {
  if (globalThis.crypto && crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5; let h2 = 0;
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 16777619) >>> 0; h2 = (h2 + u[i] * (i + 1)) >>> 0; }
  return 'fnv-' + u.length + '-' + h1.toString(16) + h2.toString(16);
}

export function move(list, index, dir) {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list.slice();
  const a = list.slice();
  [a[index], a[to]] = [a[to], a[index]];
  return a;
}

/** Re-encode a crop in the SAME format as the source (PNG stays lossless; JPEG/WebP at 0.95) and never resize. */
export function outputFormat(mime) {
  if (mime === 'image/jpeg') return { type: 'image/jpeg', quality: 0.95, ext: '.jpg' };
  if (mime === 'image/webp') return { type: 'image/webp', quality: 0.95, ext: '.webp' };
  return { type: 'image/png', quality: undefined, ext: '.png' };
}
/** iOS Safari cannot draw canvases above ~16.7M pixels. */
export const cropFitsCanvas = (w, h) => w * h <= LIMITS.maxCanvasPixels;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const R = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

export function moveRect(r, dx, dy, W, H) {
  return R({ x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h), w: r.w, h: r.h });
}

/** Largest rect with aspect `ratio` (w/h) centred inside `r`. ratio 0 = free. */
export function fitRatio(r, ratio) {
  if (!ratio) return R(r);
  let w = r.w; let h = w / ratio;
  if (h > r.h) { h = r.h; w = h * ratio; }
  return R({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h });
}

/**
 * Drag handle `mode` (n s e w ne nw se sw) by (dx, dy) in image pixels. Stays inside the image, never smaller
 * than `min`, and keeps `ratio` (w/h, 0 = free) when set.
 */
export function resizeRect(mode, r, dx, dy, W, H, ratio = 0, min = 20) {
  let left = r.x; let top = r.y; let right = r.x + r.w; let bottom = r.y + r.h;
  if (mode.includes('w')) left = clamp(left + dx, 0, right - min);
  if (mode.includes('e')) right = clamp(right + dx, left + min, W);
  if (mode.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + min, H);
  if (!ratio) return R({ x: left, y: top, w: right - left, h: bottom - top });
  const vertical = mode === 'n' || mode === 's';
  let w = right - left; let h = bottom - top;
  if (vertical) w = h * ratio; else h = w / ratio;
  // anchor: the edge opposite the dragged one stays; edge-only drags stay centred on the other axis
  const cx = r.x + r.w / 2; const cy = r.y + r.h / 2;
  const maxW = Math.min(W, H * ratio);
  const fitW = (w0, h0, ax, ay) => { // shrink while outside bounds
    let ww = w0; let hh = h0;
    const bx = (x) => (ax === 'l' ? [x, x + ww] : ax === 'r' ? [x - ww, x] : [x - ww / 2, x + ww / 2]);
    const by = (y) => (ay === 't' ? [y, y + hh] : ay === 'b' ? [y - hh, y] : [y - hh / 2, y + hh / 2]);
    const ox = ax === 'l' ? left : ax === 'r' ? right : cx; const oy = ay === 't' ? top : ay === 'b' ? bottom : cy;
    for (let i = 0; i < 60; i++) {
      const [x0, x1] = bx(ox); const [y0, y1] = by(oy);
      if (x0 >= -0.5 && x1 <= W + 0.5 && y0 >= -0.5 && y1 <= H + 0.5) break;
      ww *= 0.98; hh = ww / ratio;
    }
    const [x0] = bx(ox); const [y0] = by(oy);
    return { x: clamp(x0, 0, W - ww), y: clamp(y0, 0, H - hh), w: ww, h: hh };
  };
  const ax = mode.includes('w') ? 'r' : mode.includes('e') ? 'l' : 'c';
  const ay = mode.includes('n') ? 'b' : mode.includes('s') ? 't' : 'c';
  const out = fitW(Math.min(w, maxW), Math.min(w, maxW) / ratio, ax, ay);
  if (out.w < min) return R({ x: out.x, y: out.y, w: min, h: min / ratio });
  return R(out);
}
