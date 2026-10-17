// Product Studio image intake: paste (Cmd/Ctrl+V), drag-and-drop, Photos/Files picker, thumbnails, crop, reorder, primary.
// Nothing here calls an AI model: files are only validated, optionally cropped in the browser, and uploaded.
import { h, icon, toast, modal, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { ACCEPT, LIMITS, sniffType, validate, imagesFromTransfer, fingerprint, move, outputFormat, cropFitsCanvas, moveRect, resizeRect, fitRatio } from '../image-intake-core.js';

const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const staged = { productId: '', items: [] }; // survives re-renders of the view
let live = null; // the intake currently on screen (target of the global paste handler)

function decode(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

// One global listener: pasted images go to the Product Studio intake on screen. Text fields keep their normal paste.
if (!window.__rfPasteBound) {
  window.__rfPasteBound = true;
  document.addEventListener('paste', (e) => {
    if (!live || !live.el.isConnected || state.view !== 'products') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const files = imagesFromTransfer(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    live.add(files, 'paste');
  });
}

export function imageIntake({ product: p, run, rerender }) {
  if (staged.productId !== p.id) { staged.items.forEach((s) => URL.revokeObjectURL(s.url)); staged.productId = p.id; staged.items = []; }
  const tray = h('div', { class: 'intake-tray', 'data-intake-tray': '' });
  const room = () => p.limits.uploads - p.counts.uploaded - staged.items.length;

  async function add(files, source) {
    let added = 0;
    for (const file of files) {
      if (room() <= 0) { toast(`업로드는 최대 ${p.limits.uploads}장입니다.`, { error: true, recovery: '기존 이미지를 삭제한 뒤 다시 시도하세요.' }); break; }
      try {
        const buf = await file.arrayBuffer();
        const type = sniffType(new Uint8Array(buf, 0, Math.min(32, buf.byteLength))) || '';
        const early = validate({ type, size: buf.byteLength, width: LIMITS.minSide, height: LIMITS.minSide }) /* type/size first; real dimensions are checked after decoding */;
        if (!early.ok) { toast(`${file.name || '이미지'}: ${early.message}`, { error: true }); continue; }
        const blob = new Blob([buf], { type });
        let dec;
        try { dec = await decode(blob); } catch { toast(`${file.name || '이미지'}: 이미지를 읽을 수 없습니다.`, { error: true }); continue; }
        const v = validate({ type, size: buf.byteLength, width: dec.width, height: dec.height });
        if (!v.ok) { URL.revokeObjectURL(dec.url); toast(`${file.name || '이미지'}: ${v.message}`, { error: true }); continue; }
        const hash = await fingerprint(buf);
        if (staged.items.some((s) => s.hash === hash) || p.images.some((i) => i.sha256 === hash && !i.removed && i.status !== 'replaced')) { URL.revokeObjectURL(dec.url); toast('이미 있는 같은 이미지입니다 — 건너뛰었습니다.'); continue; }
        const name = file.name && file.name !== 'image.png' ? file.name : `${source === 'paste' ? '붙여넣은 이미지' : '이미지'} ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
        staged.items.push({ key: hash.slice(0, 12) + staged.items.length, blob, url: dec.url, width: dec.width, height: dec.height, type, size: buf.byteLength, name, source, hash, primary: false, cropped: false });
        added++;
      } catch (e) { toast('이미지를 처리하지 못했습니다: ' + e.message, { error: true }); }
    }
    draw();
    if (added) toast(`${added}장을 추가했습니다 — 저장하면 올라갑니다`);
  }

  async function crop(item) {
    const r = await cropDialog(item.url, item.width, item.height, item.type, item.name);
    if (!r) return;
    const buf = await r.blob.arrayBuffer();
    const v = validate({ type: r.blob.type, size: buf.byteLength, width: r.width, height: r.height });
    if (!v.ok) { toast(v.message, { error: true }); return; }
    URL.revokeObjectURL(item.url);
    Object.assign(item, { blob: r.blob, url: URL.createObjectURL(r.blob), width: r.width, height: r.height, size: buf.byteLength, cropped: true, hash: await fingerprint(buf) });
    draw();
  }

  async function saveAll() {
    const items = staged.items.slice();
    let primaryId = '';
    for (const it of items) {
      const before = new Set(p.images.map((i) => i.id));
      let res;
      try { res = await api.upload(`/api/products/${p.id}/images?label=${encodeURIComponent(it.name.replace(/\.[^.]+$/, ''))}&source=${it.cropped ? 'crop' : it.source}`, new File([it.blob], it.name.replace(/\.[^.]+$/, '') + outputFormat(it.type).ext, { type: it.type })); } catch (e) {
        if (e.code === 'DUPLICATE') { toast('이미 있는 같은 이미지입니다 — 건너뛰었습니다.'); staged.items = staged.items.filter((s) => s !== it); URL.revokeObjectURL(it.url); continue; }
        toast(`${it.name}: ${e.message}`, { error: true, recovery: e.recovery }); continue;
      }
      staged.items = staged.items.filter((s) => s !== it); URL.revokeObjectURL(it.url);
      p = res; // fresh product view (also keeps `room()` correct)
      if (it.primary) { const nu = res.images.find((i) => !before.has(i.id)); if (nu) primaryId = nu.id; }
    }
    if (primaryId) { try { await api.post(`/api/products/${p.id}/images/${primaryId}/primary`); } catch (e) { toast(e.message, { error: true }); } }
    toast(staged.items.length ? '일부 이미지는 저장하지 못했습니다' : '이미지를 저장했습니다 (승인이 필요합니다)', { error: !!staged.items.length });
    draw();
    rerender();
  }

  function draw() {
    tray.replaceChildren();
    if (!staged.items.length) return;
    const list = staged.items;
    tray.append(
      h('div', { class: 'intake-grid' }, list.map((it, i) => h('figure', { class: 'intake-thumb' + (it.primary ? ' primary' : ''), 'data-staged': '' },
        h('img', { src: it.url, alt: it.name }),
        h('figcaption', null,
          h('div', { class: 'small', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, it.name),
          h('div', { class: 'small muted' }, `${it.width}×${it.height} · ${fmtSize(it.size)}${it.cropped ? ' · 잘림' : ''}`),
          h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' },
            h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': '앞으로', disabled: i === 0, onclick: () => { staged.items = move(list, i, -1); draw(); } }, '←'),
            h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': '뒤로', disabled: i === list.length - 1, onclick: () => { staged.items = move(list, i, 1); draw(); } }, '→'),
            h('button', { class: 'btn icon sm ' + (it.primary ? 'sage' : 'ghost'), type: 'button', 'aria-label': '대표 이미지', 'aria-pressed': it.primary ? 'true' : 'false', onclick: () => { list.forEach((x) => (x.primary = x === it && !it.primary)); draw(); } }, '★'),
            h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': '자르기', onclick: () => crop(it) }, '✂'),
            h('button', { class: 'btn icon sm danger', type: 'button', 'aria-label': '제거', onclick: () => { URL.revokeObjectURL(it.url); staged.items = list.filter((x) => x !== it); draw(); } }, '✕')))))),
      h('div', { class: 'row end', style: 'gap:8px' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { list.forEach((x) => URL.revokeObjectURL(x.url)); staged.items = []; draw(); } }, '모두 지우기'),
        h('button', { class: 'btn sage', type: 'button', 'data-intake-save': '', onclick: saveAll }, `${list.length}장 저장`)),
      h('div', { class: 'small muted' }, '저장해도 AI가 이미지를 만들거나 바꾸지 않습니다. 업로드한 이미지는 승인해야 참조 세트로 쓰입니다.'));
  }

  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, style: 'display:none', 'data-intake-file': '', onchange: async (e) => { const f = Array.from(e.target.files); e.target.value = ''; await add(f, 'file'); } });
  const pasteBtn = h('button', { class: 'btn ghost', type: 'button', 'data-intake-paste': '', onclick: async (e) => {
    e.stopPropagation();
    if (!navigator.clipboard || !navigator.clipboard.read) { toast('이 브라우저는 버튼 붙여넣기를 지원하지 않습니다', { recovery: 'Cmd+V (Mac) / Ctrl+V (Windows)로 붙여넣거나, 사진 보관함/파일에서 선택하세요.' }); return; }
    try {
      const out = [];
      for (const it of await navigator.clipboard.read()) { const t = it.types.find((x) => /^image\//.test(x)); if (t) out.push(new File([await it.getType(t)], 'image.png', { type: t })); }
      if (!out.length) { toast('클립보드에 이미지가 없습니다', { recovery: '스크린샷을 복사한 뒤 다시 눌러 주세요.' }); return; }
      await add(out, 'paste');
    } catch { toast('클립보드를 읽지 못했습니다', { recovery: '권한을 허용하거나 Cmd/Ctrl+V로 붙여넣으세요.' }); }
  } }, icon('upload'), '클립보드에서 붙여넣기');
  const pick = h('button', { class: 'btn', type: 'button', 'data-intake-pick': '', onclick: (e) => { e.stopPropagation(); input.click(); } }, '사진 보관함 · 파일에서 선택');
  const dz = h('div', { class: 'dropzone intake-drop', tabindex: 0, role: 'button', 'aria-label': '제품 이미지 추가: 붙여넣기, 끌어놓기 또는 선택', 'data-intake-drop': '',
    onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); }, ondragleave: () => dz.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); dz.classList.remove('over'); const f = imagesFromTransfer(e.dataTransfer); if (f.length) add(f, 'drop'); } },
    input, icon('upload'),
    h('div', null, '스크린샷을 ', h('b', null, 'Cmd+V / Ctrl+V'), '로 붙여넣거나 여기로 끌어놓으세요'),
    h('div', { class: 'small', style: 'margin-top:4px' }, `${p.counts.uploaded}/${p.limits.uploads}장 · PNG·JPG·WebP · 10 MB 이하 · ${LIMITS.minSide}~${LIMITS.maxSide}px`),
    h('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:10px;flex-wrap:wrap' }, pick, pasteBtn));
  const el = h('div', { class: 'stack', style: 'gap:12px', 'data-image-intake': '' }, dz, tray);
  draw();
  live = { el, add };
  return el;
}

/** Controls on an already-saved image: move, primary, crop, remove. */
export function savedControls(p, im, list, run) {
  const ids = list.map((i) => i.id);
  const at = ids.indexOf(im.id);
  const reorder = (dir) => run(() => api.put(`/api/products/${p.id}/images/order`, { ids: move(ids, at, dir) }));
  const needsConfirm = im.status === 'approved' || (p.reference && (p.reference.imageIds || []).includes(im.id));
  const sure = async (what) => (!needsConfirm || confirmDialog({ title: `승인된 참조 이미지를 ${what}할까요?`, body: `${what}하면 참조 세트를 다시 승인해야 합니다. 이 이미지로 만든 스토리·스토리보드는 바뀌지 않지만 새 작업에는 쓸 수 없게 됩니다.`, confirm: `${what}`, tone: 'danger' }));
  const cropSaved = async () => {
    let blob;
    try { blob = await (await fetch(im.url)).blob(); } catch { toast('이미지를 불러오지 못했습니다', { error: true }); return; }
    const r = await cropDialog(im.url, im.width || 0, im.height || 0, blob.type, im.label || 'image');
    if (!r) return;
    if (!(await sure('교체'))) return;
    const ext = outputFormat(r.blob.type).ext;
    await run(() => api.upload(`/api/products/${p.id}/images/${im.id}/replace?source=crop${needsConfirm ? '&confirm=1' : ''}`, new File([r.blob], (im.label || 'image') + ext, { type: r.blob.type })), '잘라서 교체했습니다 (다시 승인이 필요합니다)');
  };
  const uploaded = im.kind === 'uploaded';
  return h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' },
    h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': '앞으로', disabled: at <= 0, onclick: () => reorder(-1) }, '←'),
    h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': '뒤로', disabled: at < 0 || at >= ids.length - 1, onclick: () => reorder(1) }, '→'),
    h('button', { class: 'btn icon sm ' + (im.primary ? 'sage' : 'ghost'), type: 'button', 'aria-label': '대표 이미지', 'aria-pressed': im.primary ? 'true' : 'false', disabled: im.status === 'rejected', onclick: () => run(() => api.post(`/api/products/${p.id}/images/${im.id}/primary`)) }, '★'),
    uploaded ? h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': '자르기', onclick: cropSaved }, '✂') : null,
    uploaded ? h('button', { class: 'btn icon sm danger', type: 'button', 'aria-label': '삭제', onclick: async () => { if (await sure('삭제')) run(() => api.post(`/api/products/${p.id}/images/${im.id}/remove`, { confirm: true }), '삭제했습니다'); } }, '✕') : null);
}

/** Crop editor. Resolves { blob, width, height } or null. Works in image pixels; output is never resized. */
export function cropDialog(src, W, H, mime, name) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const img = new Image();
    const st = { rect: null, ratio: 0, scale: 1 };
    const box = h('div', { class: 'crop-box', 'data-crop-box': '' });
    const stage = h('div', { class: 'crop-stage' }, img, box);
    const info = h('div', { class: 'small muted', 'data-crop-info': '' });
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    HANDLES.forEach((m) => box.append(h('span', { class: 'crop-h ' + m, 'data-handle': m })));
    const sync = () => {
      const s = st.scale; const r = st.rect;
      Object.assign(box.style, { left: r.x * s + 'px', top: r.y * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px' });
      info.textContent = `${r.w}×${r.h}px`;
    };
    const init = () => {
      W = img.naturalWidth; H = img.naturalHeight;
      st.scale = img.clientWidth / W;
      st.rect = { x: 0, y: 0, w: W, h: H };
      sync();
    };
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const mode = (e.target.dataset && e.target.dataset.handle) || 'move';
      drag = { mode, x: e.clientX, y: e.clientY, rect: Object.assign({}, st.rect) };
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / st.scale; const dy = (e.clientY - drag.y) / st.scale;
      st.rect = drag.mode === 'move' ? moveRect(drag.rect, dx, dy, W, H) : resizeRect(drag.mode, drag.rect, dx, dy, W, H, st.ratio, 20);
      sync();
    });
    const end = () => { drag = null; };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    const setRatio = (r) => { st.ratio = r; if (r) st.rect = fitRatio(st.rect, r); sync(); };
    const ratios = [['자유', 0], ['1:1', 1], ['4:5', 4 / 5], ['9:16', 9 / 16], ['원본 비율', 0]];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '비율', style: 'flex-wrap:wrap' }, ratios.map(([l, r]) => h('button', { type: 'button', 'aria-pressed': l === '자유' ? 'true' : 'false', onclick: (e) => { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false')); setRatio(l === '원본 비율' ? img.naturalWidth / img.naturalHeight : r); } }, l)));
    const close = modal((closeFn) => h('div', { class: 'stack', style: 'gap:10px' },
      h('h2', { style: 'margin:0' }, '이미지 자르기'),
      h('p', { class: 'small muted', style: 'margin:0' }, '브라우저 주소창·메뉴나 불필요한 여백을 잘라내세요. 해상도는 줄이지 않고, 원본 형식(PNG는 무손실)으로 저장합니다.'),
      stage, info, seg,
      h('div', { class: 'row end', style: 'gap:8px' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { st.ratio = 0; st.rect = { x: 0, y: 0, w: W, h: H }; seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false')); sync(); } }, '초기화'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { closeFn(); finish(null); } }, '취소'),
        h('button', { class: 'btn sage', type: 'button', 'data-crop-apply': '', onclick: () => {
          const r = st.rect;
          if (!cropFitsCanvas(r.w, r.h)) { toast('이미지가 커서 이 기기에서는 자를 수 없습니다', { error: true, recovery: '자르지 않고 올리거나 더 작게 자르세요.' }); return; }
          const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
          c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          const f = outputFormat(mime);
          c.toBlob((b) => { if (!b) { toast('자르기에 실패했습니다', { error: true }); return; } closeFn(); finish({ blob: b, width: r.w, height: r.h }); }, f.type, f.quality);
        } }, '자르기 적용'))), { wide: true });
    const back = document.querySelector('#modal-root .modal-back:last-child');
    if (back) new MutationObserver(() => { if (!back.isConnected) finish(null); }).observe(document.getElementById('modal-root'), { childList: true });
    img.onload = init;
    img.alt = name || '';
    img.draggable = false;
    img.src = src;
    window.addEventListener('resize', () => { if (img.naturalWidth) { st.scale = img.clientWidth / img.naturalWidth; if (st.rect) sync(); } });
  });
}
