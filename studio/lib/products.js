// Product workspace: product info, compliant extraction, reference images (retrieved / uploaded / AI-generated),
// image approval and the approved reference set that Story Lab is bound to.
//   Provenance is always visible: AI-generated images are never presented as manufacturer photos.
//   Extracted specs are "unverified" until the operator confirms them; nothing is invented.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256, safeName, canonical, readJson, writeJsonAtomic, writeFileAtomic } = require('./util');
const { extractProduct, downloadImage, sniffImage, imageSize } = require('./extract');

const MAX_UPLOADS = 10;
const MIN_SIDE = 100; // px — smaller images are unusable as product references
const MAX_SIDE = 8000;
const MAX_RETRIEVED = 8;
const MAX_GENERATED = 8;
const MAX_SET = 8;
const KIND_LABEL = { retrieved: '원본 (쇼핑몰에서 수집)', uploaded: '직접 업로드', ai_generated: 'AI 생성 (제조사 사진 아님)' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const PID_RE = /^PRD-[A-Za-z0-9-]{1,30}$/;

/** Price is ONLY what the operator typed (never scraped or guessed). Prices change: it always carries the date it was entered. */
function cleanPrice(v) {
  if (!v || typeof v !== 'object') return null;
  const text = String(v.text || '').trim().slice(0, 60);
  if (!text) return null;
  return { text, source: 'operator', note: '운영자가 직접 입력한 값 · 가격과 재고는 수시로 바뀌므로 게시 전에 쿠팡에서 다시 확인하세요', enteredAt: String(v.enteredAt || '') || nowIso() };
}

// Product code: short, unique and PERSISTENT (it is the first part of every Episode ID, e.g. UMB-01-D). Editable until the first Episode uses it.
const CODE_RE = /^[A-Z][A-Z0-9]{1,4}$/;
const CODE_STOP = new Set(['the', 'and', 'for', 'with', 'magnetic', 'door', 'mounted', 'wall', 'type', 'set', 'new', 'home', 'smart', 'mini', 'pro', 'large', 'small', 'black', 'white', 'gray', 'grey', 'portable', 'foldable', 'folding']);
function normCode(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

function createProductService({ store, router, extractFn = extractProduct, downloadFn = downloadImage, log = () => {} }) {
  const root = () => store.path('products');
  const dirOf = (id) => {
    if (!PID_RE.test(String(id))) throw new StudioError('BAD_ID', '상품 ID 형식이 올바르지 않습니다: ' + id, { status: 400 });
    return path.join(root(), id);
  };
  const fileOf = (id) => path.join(dirOf(id), 'product.json');
  const queues = new Map();

  function get(id) {
    const p = readJson(fileOf(id));
    if (!p) throw new StudioError('NOT_FOUND', '상품을 찾을 수 없습니다: ' + id, { status: 404 });
    return p;
  }
  function update(id, fn) {
    const prev = queues.get(id) || Promise.resolve();
    const run = prev
      .then(async () => {
        const p = get(id);
        const out = await fn(p);
        p.updatedAt = nowIso();
        writeJsonAtomic(fileOf(id), p);
        return out === undefined ? p : out;
      })
      .finally(() => {
        // Drop the queue entry once this is the last pending task for the id (no unbounded Map growth).
        if (queues.get(id) === tail) queues.delete(id);
      });
    const tail = run.catch(() => {});
    queues.set(id, tail);
    return run;
  }
  const allCodes = (exceptId) => ids().filter((i) => i !== exceptId).map((i) => normCode(get(i).code)).filter(Boolean);
  function checkCode(code, exceptId) {
    const c = normCode(code);
    if (!CODE_RE.test(c)) throw new StudioError('BAD_PRODUCT_CODE', '제품 코드는 영문 대문자로 시작하는 2~5자의 영문 대문자/숫자여야 합니다 (예: UMB).', { status: 422 });
    if (allCodes(exceptId).includes(c)) throw new StudioError('PRODUCT_CODE_TAKEN', `제품 코드 ${c}은(는) 다른 제품이 이미 쓰고 있습니다.`, { status: 409 });
    return c;
  }
  /** A suggestion only (never applied silently): first meaningful English word of the category / name, 3 letters, made unique. */
  function suggestCode(p) {
    const words = (String(p.category || '') + ' ' + String(p.name || '')).match(/[A-Za-z]{3,}/g) || [];
    const w = words.map((x) => x.toLowerCase()).find((x) => !CODE_STOP.has(x));
    const taken = new Set(allCodes(p.id));
    let base = (w ? w.slice(0, 3) : 'PRD').toUpperCase();
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i += 1) { const c = base.slice(0, 3) + i; if (!taken.has(c)) return c; }
    return base;
  }
  /** Called by Episode ID allocation (synchronously, inside its lock): from now on the code can no longer change. */
  function lockCodeSync(pid) {
    const p = get(pid);
    if (p.codeLockedAt) return;
    p.codeLockedAt = nowIso();
    writeJsonAtomic(fileOf(pid), p);
  }
  function ids() {
    if (!fs.existsSync(root())) return [];
    return fs.readdirSync(root()).filter((d) => PID_RE.test(d) && fs.existsSync(path.join(root(), d, 'product.json'))).sort();
  }
  const nextId = () => {
    const n = ids().map((i) => /^PRD-(\d+)$/.exec(i)).filter(Boolean).map((m) => Number(m[1]));
    return 'PRD-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0');
  };

  const setHash = (p, imageIds) => sha256(canonical(imageIds.slice().sort().map((i) => { const im = p.images.find((x) => x.id === i); return im ? [im.id, im.sha256] : [i, null]; })));
  function referenceState(p) {
    const s = p.referenceSet;
    if (!s) return { state: 'none', approved: false };
    if (s.waived) return { state: 'waived', approved: true, waived: s.waived, by: s.by, at: s.at };
    const ok = s.imageIds.every((i) => { const im = p.images.find((x) => x.id === i); return im && im.status === 'approved'; }) && setHash(p, s.imageIds) === s.hash;
    return ok ? { state: 'approved', approved: true, imageIds: s.imageIds, hash: s.hash, by: s.by, at: s.at } : { state: 'stale', approved: false, note: '승인 후 이미지가 바뀌었습니다. 참조 세트를 다시 승인하세요.' };
  }
  function verifiedFacts(p) {
    return (p.specs || []).filter((s) => s.verified).map((s) => s.text).concat((p.sellingPoints || []).filter((s) => s.verified).map((s) => s.text));
  }

  /** Saved order first (imageOrder), everything else after in creation order. Removed images are hidden. */
  function orderedImages(p) {
    const vis = p.images.filter((i) => !i.removed);
    const rank = (i) => { const n = (p.imageOrder || []).indexOf(i.id); return n < 0 ? 1e6 : n; };
    return vis.map((im, n) => ({ im, n })).sort((a, b) => rank(a.im) - rank(b.im) || a.n - b.n).map((x) => x.im);
  }

  /** Did the images behind the APPROVED structure description change since it was analyzed? (cheap flag for the product page; the full check is in productanalysis.js) */
  function analysisImagesChanged(p) {
    const a = (p.analyses || []).find((x) => x.v === p.analysisApprovedV && x.status === 'approved');
    if (!a) return false;
    const L = (p.images || []).filter((i) => !i.removed && !['rejected', 'replaced'].includes(i.status));
    return !(a.imageHashes || []).every((h) => { const im = L.find((i) => i.id === h.id); return im && im.sha256 === h.sha256; });
  }

  function view(p) {
    const refs = referenceState(p);
    return Object.assign({}, p, {
      images: orderedImages(p).map((im) => Object.assign({}, im, { kindLabel: KIND_LABEL[im.kind], url: `/media/product/${p.id}/${im.id}`, primary: p.primaryImageId === im.id })),
      primaryImageId: p.primaryImageId || '',
      analysisImagesChanged: analysisImagesChanged(p),
      reference: refs,
      verifiedFacts: verifiedFacts(p),
      reviewResearch: p.reviewResearch || { images: [], text: '', analysis: null, approved: false },
      limits: { uploads: MAX_UPLOADS, retrieved: MAX_RETRIEVED, generated: MAX_GENERATED, extraRefs: 5 },
      counts: { uploaded: p.images.filter((i) => i.kind === 'uploaded' && i.status !== 'replaced').length, retrieved: p.images.filter((i) => i.kind === 'retrieved' && !i.removed).length, generated: p.images.filter((i) => i.kind === 'ai_generated').length },
      codeLocked: !!p.codeLockedAt, suggestedCode: p.code ? '' : suggestCode(p),
      readiness: readiness(p, refs),
      generations: generationsOf(p),
      linkedEpisodes: linkedEpisodes(p.id),
      mainImage: mainImageOf(p, refs),
    });
  }
  /** The picture shown for the product: the first image of the APPROVED reference set, else the first approved image, else the first usable upload. Read-only. */
  function mainImageOf(p, refs) {
    const usable = orderedImages(p).filter((i) => !['rejected', 'replaced'].includes(i.status));
    const pick = usable.find((i) => i.id === p.primaryImageId) || (refs && refs.imageIds || []).map((id) => usable.find((i) => i.id === id)).filter(Boolean)[0] || usable.find((i) => i.status === 'approved') || usable[0];
    return pick ? { id: pick.id, url: `/media/product/${p.id}/${pick.id}`, kind: pick.kind, label: pick.label || '', approved: pick.status === 'approved' } : null;
  }
  /** Episodes created for this product (any state). Read-only: nothing is created or changed here. */
  function linkedEpisodes(pid) {
    try {
      return store.episodes.list().filter((e) => e.productId === pid).map((e) => ({ id: e.id, displayId: e.displayId || e.id, title: e.title || '', conceptId: (e.concept || {}).conceptId || '', category: e.category || '', archived: !!e.archivedAt }));
    } catch (_) { return []; }
  }
  /** AI image versions grouped by the generation request that produced them (history, newest first). */
  function generationsOf(p) {
    const by = new Map();
    p.images.filter((i) => i.kind === 'ai_generated').forEach((i) => {
      const g = by.get(i.generationId || i.id) || { id: i.generationId || i.id, at: i.createdAt || '', prompt: (i.params || {}).prompt || '', style: (i.params || {}).style || '', basedOn: i.derivedFrom || [], extraRefs: (i.params || {}).extraRefs || [], imageIds: [] };
      g.imageIds.push(i.id);
      by.set(g.id, g);
    });
    return Array.from(by.values()).reverse();
  }
  function readiness(p, refs = referenceState(p)) {
    const missing = [];
    if (!p.name || !String(p.name).trim()) missing.push('상품명');
    if (!verifiedFacts(p).length) missing.push('확인된 기능/특징(최소 1개)');
    if (!refs.approved) missing.push('승인된 참조 이미지 세트');
    return { ok: missing.length === 0, missing };
  }

  const list = () => ids().map((i) => { const p = get(i); return { id: p.id, code: p.code || '', name: p.name, url: p.url, affiliateUrl: p.affiliateUrl || '', mainImage: mainImageOf(p, referenceState(p)), linkedEpisodes: linkedEpisodes(p.id), codeLocked: !!p.codeLockedAt, suggestedCode: p.code ? '' : suggestCode(p), extraction: p.extraction && p.extraction.status, reference: referenceState(p).state, images: p.images.length, readiness: readiness(p), createdAt: p.createdAt || '', updatedAt: p.updatedAt }; });

  async function create({ id, name, url = '', affiliateUrl = '', description = '', category = '', features = [], forbiddenClaims = [], legacy = false, price = null, code = '' } = {}) {
    if (!String(name || '').trim() && !String(url || '').trim()) throw new StudioError('NEED_INPUT', '상품명이나 상품 URL 중 하나는 필요합니다.', { status: 400 });
    if (url) require('./extract').parseUrl(url);
    const pid = id || nextId();
    const productCode = String(code || '').trim() ? checkCode(code) : '';
    if (fs.existsSync(fileOf(pid))) throw new StudioError('DUPLICATE', '이미 있는 상품 ID입니다: ' + pid, { status: 409 });
    const p = {
      id: pid, name: String(name || '').trim().slice(0, 200), url: String(url || '').trim(), affiliateUrl: String(affiliateUrl || '').trim(), description: String(description || '').slice(0, 3000), category: String(category || '').slice(0, 100),
      specs: (features || []).map(String).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, source: 'manual', verified: true, at: nowIso() })),
      sellingPoints: [], reviewResearch: { images: [], text: '', analysis: null, approved: false }, forbiddenClaims: (forbiddenClaims || []).map(String).filter(Boolean),
      price: cleanPrice(price), code: productCode, codeLockedAt: null, extraction: { status: 'none', note: '', at: '' }, images: [], referenceSet: null, legacy: !!legacy, createdAt: nowIso(), updatedAt: nowIso(),
    };
    fs.mkdirSync(dirOf(pid), { recursive: true });
    writeJsonAtomic(fileOf(pid), p);
    return view(p);
  }

  async function edit(id, patch) {
    const p = await update(id, (p) => {
      if (patch.code !== undefined) {
        const next = String(patch.code).trim() ? checkCode(patch.code, id) : '';
        if (next !== normCode(p.code)) {
          if (p.codeLockedAt) throw new StudioError('PRODUCT_CODE_LOCKED', `제품 코드 ${p.code}은(는) 이미 에피소드 ID에 쓰여 바꿀 수 없습니다.`, { status: 409, recovery: '기존 에피소드 ID는 바뀌지 않습니다.' });
          p.code = next;
        }
      }
      ['name', 'category', 'description', 'url', 'affiliateUrl', 'referencePrompt'].forEach((k) => patch[k] !== undefined && (p[k] = String(patch[k]).trim().slice(0, ['description','referencePrompt'].includes(k) ? 3000 : 300)));
      if (patch.url) require('./extract').parseUrl(patch.url);
      if (patch.price !== undefined) p.price = cleanPrice(patch.price);
      if (Array.isArray(patch.forbiddenClaims)) p.forbiddenClaims = patch.forbiddenClaims.map(String).filter(Boolean);
      // specs: [{text, verified}] — a text the operator types or confirms is "verified"; changing text re-sets source to manual.
      if (Array.isArray(patch.specs)) {
        p.specs = patch.specs.filter((s) => s && String(s.text || '').trim()).map((s) => {
          const old = p.specs.find((o) => o.text === s.text);
          return { text: String(s.text).trim().slice(0, 300), source: old ? old.source : 'manual', verified: !!s.verified, at: old ? old.at : nowIso() };
        });
      }
      if (Array.isArray(patch.sellingPoints)) p.sellingPoints = patch.sellingPoints.filter((s) => s && String(s.text || '').trim()).map((s) => ({ text: String(s.text).trim().slice(0, 300), verified: !!s.verified }));
    });
    return view(p);
  }

  async function extract(id) {
    const p0 = get(id);
    if (!p0.url) throw new StudioError('NO_URL', '상품 URL이 없습니다. URL을 입력하거나 직접 입력하세요.', { status: 400 });
    const r = await extractFn(p0.url);
    const downloaded = [];
    const failed = [];
    if (r.status === 'ok') {
      for (const imgUrl of r.data.images.slice(0, MAX_RETRIEVED)) {
        try { downloaded.push(Object.assign(await downloadFn(imgUrl), { sourceUrl: imgUrl })); } catch (e) { failed.push({ url: imgUrl, reason: e.message }); }
      }
    }
    const p = await update(id, (p) => {
      p.extraction = { status: r.status, reason: r.reason || '', note: r.note, at: nowIso(), sourceUrl: r.sourceUrl, imageFailures: failed };
      if (r.status !== 'ok') return;
      if (!p.name && r.data.title) p.name = r.data.title.slice(0, 200);
      if (!p.description && r.data.description) p.description = r.data.description.slice(0, 3000);
      r.data.specs.forEach((t) => { if (!p.specs.some((s) => s.text === t)) p.specs.push({ text: t, source: 'extracted', verified: false, at: nowIso() }); });
      p.extracted = { title: r.data.title, description: r.data.description, at: nowIso() };
      downloaded.forEach((d) => {
        if (p.images.filter((i) => i.kind === 'retrieved').length >= MAX_RETRIEVED) return;
        const hash = sha256(d.buffer);
        if (p.images.some((i) => i.sha256 === hash)) return;
        const imgId = 'img_' + hash.slice(0, 10);
        writeFileAtomic(path.join(dirOf(id), imgId + d.ext), d.buffer);
        p.images.push({ id: imgId, file: imgId + d.ext, kind: 'retrieved', sha256: hash, size: d.buffer.length, status: 'pending', label: '수집 이미지', sourceUrl: d.sourceUrl, licenseNote: '쇼핑몰 이미지의 광고/AI 변형 사용 권한은 확인되지 않았습니다. 사용 전 권리를 확인하세요.', createdAt: nowIso() });
      });
    });
    return view(p);
  }

  function saveImage(p, id, { buffer, filename, kind, label, extra = {} }) {
    const sn = sniffImage(buffer);
    if (!sn) throw new StudioError('BAD_TYPE', 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.', { status: 415 });
    if (buffer.length > 10 * 1024 * 1024) throw new StudioError('TOO_LARGE', '10 MB 이하 이미지만 가능합니다.', { status: 413 });
    const dim = imageSize(buffer);
    if (!dim) throw new StudioError('BAD_IMAGE', '이미지 크기를 읽을 수 없습니다. 손상된 파일일 수 있습니다.', { status: 415 });
    if (Math.min(dim.width, dim.height) < MIN_SIDE) throw new StudioError('TOO_SMALL', `이미지가 너무 작습니다 (${dim.width}×${dim.height}px). 짧은 변이 ${MIN_SIDE}px 이상이어야 합니다.`, { status: 422 });
    if (Math.max(dim.width, dim.height) > MAX_SIDE) throw new StudioError('TOO_BIG_DIMS', `이미지가 너무 큽니다 (${dim.width}×${dim.height}px). 긴 변은 ${MAX_SIDE}px 이하여야 합니다.`, { status: 422 });
    const hash = sha256(buffer);
    if (p.images.some((i) => i.sha256 === hash && i.status !== 'replaced')) throw new StudioError('DUPLICATE', '이미 있는 같은 이미지입니다.', { status: 409 });
    const imgId = 'img_' + hash.slice(0, 10);
    writeFileAtomic(path.join(dirOf(id), imgId + sn.ext), buffer);
    const fresh = Object.assign({ id: imgId, file: imgId + sn.ext, kind, sha256: hash, size: buffer.length, width: dim.width, height: dim.height, status: 'pending', label: label || safeName(filename || '').replace(/\.[^.]+$/, '') || KIND_LABEL[kind], originalName: safeName(filename || ''), createdAt: nowIso() }, extra);
    // The same bytes were removed/replaced earlier: bring that record back instead of adding a second record with the same id.
    const gone = p.images.findIndex((i) => i.id === imgId);
    if (gone >= 0) p.images[gone] = fresh; else p.images.push(fresh);
    return fresh;
  }

  async function upload(id, buffer, filename, { label, source } = {}) {
    const p = await update(id, (p) => {
      if (!buffer || !buffer.length) throw new StudioError('EMPTY_FILE', '빈 파일입니다.', { status: 400 });
      if (p.images.filter((i) => i.kind === 'uploaded' && i.status !== 'replaced').length >= MAX_UPLOADS) throw new StudioError('UPLOAD_LIMIT', `업로드는 최대 ${MAX_UPLOADS}장입니다. 기존 이미지를 삭제하거나 교체하세요.`, { status: 409 });
      if (p.images.filter((i) => i.kind === 'uploaded' && !i.removed && i.status !== 'replaced').length + (p.reviewResearch?.images || []).length >= 10) throw new StudioError('UPLOAD_LIMIT', '제품과 리뷰 이미지는 합쳐 최대 10장입니다.', { status: 409 });
      saveImage(p, id, { buffer, filename, kind: 'uploaded', label, extra: { source: ['paste', 'drop', 'file', 'crop'].includes(source) ? source : 'file' } });
    });
    return view(p);
  }

  /** Replacing or removing an APPROVED image (or one in the approved reference set) changes what Story Lab is bound to: needs confirmation. */
  function guardApproved(p, im, confirm, what) {
    const inSet = !!(p.referenceSet && (p.referenceSet.imageIds || []).includes(im.id));
    if ((im.status === 'approved' || inSet) && !confirm) throw new StudioError('CONFIRM_APPROVED', `승인된 참조 이미지입니다. ${what}하면 참조 세트를 다시 승인해야 합니다. 계속하려면 확인이 필요합니다.`, { status: 409, details: [{ code: 'CONFIRM_APPROVED', imageId: im.id }] });
  }

  async function replace(id, imgId, buffer, filename, { confirm = false, source = 'file' } = {}) {
    const p = await update(id, (p) => {
      const old = p.images.find((i) => i.id === imgId);
      if (!old) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
      guardApproved(p, old, confirm, '교체');
      const nu = saveImage(p, id, { buffer, filename, kind: 'uploaded', label: old.label, extra: { replaces: old.id, source: source === 'crop' ? 'crop' : 'file' } });
      old.status = 'replaced';
      old.replacedBy = nu.id;
      p.imageOrder = (p.imageOrder || []).map((x) => (x === old.id ? nu.id : x));
      if (p.primaryImageId === old.id) p.primaryImageId = nu.id;
    });
    return view(p);
  }

  /** Soft remove (uploaded images only). The file stays on the volume; the record is hidden and its bytes can be uploaded again. */
  async function removeImage(id, imgId, { confirm = false } = {}) {
    const p = await update(id, (p) => {
      const im = p.images.find((i) => i.id === imgId);
      if (!im || im.status === 'replaced') throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
      if (im.kind !== 'uploaded') throw new StudioError('NOT_REMOVABLE', '직접 업로드한 이미지만 삭제할 수 있습니다. 다른 이미지는 거절하세요.', { status: 409 });
      guardApproved(p, im, confirm, '삭제');
      im.status = 'replaced'; im.removed = true; im.removedAt = nowIso();
      p.imageOrder = (p.imageOrder || []).filter((x) => x !== im.id);
      if (p.primaryImageId === im.id) p.primaryImageId = '';
    });
    return view(p);
  }

  /** Display order of the reference images (does not affect approval: the approved set hash ignores order). */
  async function reorderImages(id, orderIds) {
    const p = await update(id, (p) => {
      const live = orderedImages(p).filter((i) => i.status !== 'replaced').map((i) => i.id);
      const given = Array.isArray(orderIds) ? orderIds.filter((x, n, a) => live.includes(x) && a.indexOf(x) === n) : [];
      p.imageOrder = given.concat(live.filter((x) => !given.includes(x)));
    });
    return view(p);
  }
  /** The product's primary picture (shown on cards / the Products list). Any usable image can be primary. */
  async function setPrimary(id, imgId) {
    const p = await update(id, (p) => {
      const im = p.images.find((i) => i.id === imgId);
      if (!im || ['replaced', 'rejected'].includes(im.status)) throw new StudioError('NOT_FOUND', '대표로 쓸 수 있는 이미지가 아닙니다.', { status: 404 });
      p.primaryImageId = im.id;
    });
    return view(p);
  }

  async function setStatus(id, imgId, status, by = 'operator') {
    if (!['approved', 'rejected', 'pending'].includes(status)) throw new StudioError('BAD_VALUE', '상태가 올바르지 않습니다.', { status: 400 });
    const p = await update(id, (p) => {
      const im = p.images.find((i) => i.id === imgId);
      if (!im) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
      if (im.status === 'replaced') throw new StudioError('REPLACED', '교체된 이미지입니다.', { status: 409 });
      im.status = status;
      im.decidedBy = by;
      im.decidedAt = nowIso();
    });
    return view(p);
  }

  async function approveUploadedImages(id, imageIds) {
    const ids = Array.isArray(imageIds) ? imageIds : [];
    if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new StudioError('BAD_IMAGES', '승인할 업로드 이미지 1~10장을 선택하세요.', { status: 422 });
    await update(id, (p) => {
      for (const iid of ids) {
        const im = p.images.find((x) => x.id === iid);
        if (!im || im.kind !== 'uploaded' || im.removed || im.status !== 'pending') throw new StudioError('BAD_IMAGES', '승인 대기 중인 직접 업로드 제품 이미지만 전체 승인할 수 있습니다.', { status: 409 });
      }
      for (const im of p.images) if (ids.includes(im.id)) {
        im.status = 'approved'; im.decidedBy = 'operator'; im.decidedAt = nowIso();
      }
    });
    return view(get(id));
  }

  const MAX_EXTRA_REFS = 5;
  const STYLES = {
    anime: 'Render it as a clean 2D anime / Korean webtoon illustration: confident ink outlines, flat cel shading, soft studio lighting, simple uncluttered background. It must still be recognisably the SAME product.',
    product: 'Render it as a clean, realistic product image on a neutral light background.',
  };
  /** Picks the source images for a request. Returns { srcs (approved originals), extras (up to 5 additional references) }. */
  function pickSources(p, basedOn, extraImageIds) {
    const srcs = p.images.filter((i) => (basedOn || []).includes(i.id) && i.kind !== 'ai_generated' && i.status === 'approved');
    if (!srcs.length) throw new StudioError('NO_SOURCE', '기준이 될 승인된 원본/업로드 이미지를 선택하세요. (제품 모양을 임의로 만들지 않습니다.)', { status: 409 });
    const extraIds = Array.from(new Set(extraImageIds || [])).filter((i) => !srcs.some((s) => s.id === i));
    if (extraIds.length > MAX_EXTRA_REFS) throw new StudioError('EXTRA_LIMIT', `추가 참조 이미지는 한 번에 최대 ${MAX_EXTRA_REFS}장입니다.`, { status: 409 });
    const extras = extraIds.map((i) => {
      const im = p.images.find((x) => x.id === i);
      if (!im || im.kind === 'ai_generated' || ['rejected', 'replaced'].includes(im.status)) throw new StudioError('BAD_EXTRA', '추가 참조로 쓸 수 없는 이미지입니다: ' + i, { status: 409 });
      return im;
    });
    return { srcs, extras };
  }
  /** Number of images that will be sent (drives the cost estimate). */
  function imageCount(id, { basedOn = [], extraImageIds = [] } = {}) {
    const { srcs, extras } = pickSources(get(id), basedOn, extraImageIds);
    return srcs.length + extras.length;
  }

  /**
   * AI product reference image (Gemini image-capable model). Always labelled AI-generated; needs explicit paid confirmation.
   * Each call is one "generation" (numbered version) whose parameters are stored so it can be regenerated or compared.
   */
  async function generateImage(id, { basedOn = [], extraImageIds = [], prompt = '', style = 'anime', confirm } = {}) {
    const p0 = get(id);
    if (!STYLES[style]) throw new StudioError('BAD_STYLE', '알 수 없는 스타일입니다: ' + style, { status: 400 });
    if (p0.images.filter((i) => i.kind === 'ai_generated' && i.status !== 'rejected').length >= MAX_GENERATED) throw new StudioError('GEN_LIMIT', `거절하지 않은 AI 생성 이미지는 최대 ${MAX_GENERATED}장입니다. 마음에 들지 않는 버전은 거절하면 다시 만들 수 있습니다.`, { status: 409 });
    const { srcs, extras } = pickSources(p0, basedOn, extraImageIds);
    const read = (im) => fs.readFileSync(path.join(dirOf(id), im.file)).toString('base64');
    const mime = (im) => MIME[path.extname(im.file)] || 'image/png';
    const images = srcs.map((s) => ({ label: 'APPROVED product reference photo (source of truth: keep exact shape, logo, colour and function):', mimeType: mime(s), data: read(s) }))
      .concat(extras.map((s) => ({ label: 'Additional reference (extra angle/detail of the SAME product):', mimeType: mime(s), data: read(s) })));
    const instruction = [
      'Create a product reference image of EXACTLY the product shown in the reference photo(s).',
      'Do NOT change the product shape, proportions, logo, text, colour, materials or functionality. Do not add features or accessories. No people, no extra text.',
      STYLES[style],
      prompt ? 'Requested variation (background/angle/lighting only): ' + String(prompt).slice(0, 500) : 'Variation: front view, product centered.',
    ].join('\n');
    const out = await router.runImage('imageGeneration', { prompt: instruction, images, confirm });
    const generationId = 'gen_' + sha256(instruction + nowIso() + Math.random()).slice(0, 8);
    const p = await update(id, (p) => {
      const version = p.images.filter((i) => i.kind === 'ai_generated').reduce((m, i) => Math.max(m, i.version || 0), 0) + 1;
      out.images.forEach((g, n) => {
        const buf = Buffer.from(g.data, 'base64');
        saveImage(p, id, { buffer: buf, filename: 'ai.png', kind: 'ai_generated', label: `AI 생성 v${version + n}`, extra: { version: version + n, generationId, derivedFrom: srcs.map((s) => s.id), provider: out.provider, model: out.model, prompt: instruction, params: { prompt: String(prompt).slice(0, 500), style, extraRefs: extras.map((e) => e.id) }, disclosure: 'AI가 만든 이미지입니다. 제조사 사진이 아닙니다.' } });
      });
    });
    return view(p);
  }

  /** Approve exactly one AI version; its still-pending siblings from the same generation are rejected (history is kept). */
  async function chooseVersion(id, imgId, by = 'operator') {
    const p = await update(id, (p) => {
      const im = p.images.find((i) => i.id === imgId);
      if (!im || im.kind !== 'ai_generated') throw new StudioError('NOT_FOUND', 'AI 생성 이미지를 찾을 수 없습니다.', { status: 404 });
      if (im.status === 'rejected' || im.status === 'replaced') throw new StudioError('REJECTED', '거절된 이미지는 선택할 수 없습니다. 먼저 승인 대기로 되돌리세요.', { status: 409 });
      im.status = 'approved';
      im.decidedBy = by;
      im.decidedAt = nowIso();
      p.images.filter((i) => i.kind === 'ai_generated' && i.generationId === im.generationId && i.id !== im.id && i.status === 'pending').forEach((i) => { i.status = 'rejected'; i.decidedBy = by; i.decidedAt = nowIso(); i.decisionNote = `v${im.version} 선택으로 자동 거절`; });
    });
    return view(p);
  }

  async function approveReferenceSet(id, { imageIds, by = 'operator' } = {}) {
    const p = await update(id, (p) => {
      const sel = imageIds && imageIds.length ? imageIds : p.images.filter((i) => i.status === 'approved').map((i) => i.id);
      if (!sel.length) throw new StudioError('NO_IMAGES', '승인된 이미지가 없습니다. 먼저 이미지를 하나 이상 승인하세요.', { status: 409 });
      if (sel.length > MAX_SET) throw new StudioError('SET_LIMIT', `참조 세트는 최대 ${MAX_SET}장입니다.`, { status: 409 });
      sel.forEach((i) => { const im = p.images.find((x) => x.id === i); if (!im || im.status !== 'approved') throw new StudioError('NOT_APPROVED', '승인되지 않은 이미지가 포함되어 있습니다: ' + i, { status: 409 }); });
      p.referenceSet = { id: 'refset_' + sha256(sel.slice().sort().join()).slice(0, 8), imageIds: sel, hash: setHash(p, sel), by, at: nowIso(), kinds: Array.from(new Set(sel.map((i) => p.images.find((x) => x.id === i).kind))) };
    });
    return view(p);
  }

  async function waiveReferences(id, reason, by = 'operator') {
    if (!String(reason || '').trim()) throw new StudioError('NEED_REASON', '이미지 없이 진행하는 이유를 입력하세요.', { status: 400 });
    const p = await update(id, (p) => { p.referenceSet = { id: 'refset_waived', waived: String(reason).slice(0, 300), imageIds: [], hash: '', by, at: nowIso() }; });
    return view(p);
  }

  /** Customer review screenshots are research, NEVER product reference images. */
  async function uploadReview(id, buffer, filename) {
    const sn = sniffImage(buffer);
    if (!sn || !buffer || buffer.length > 10 * 1024 * 1024) throw new StudioError('BAD_REVIEW_IMAGE', '리뷰 이미지는 PNG/JPG/WEBP, 10MB 이하만 가능합니다.', { status: 422 });
    const dim = imageSize(buffer);
    if (!dim || Math.min(dim.width, dim.height) < 100 || Math.max(dim.width, dim.height) > MAX_SIDE) throw new StudioError('BAD_REVIEW_IMAGE', '유효한 리뷰 이미지가 아닙니다.', { status: 422 });
    const p = await update(id, (p) => {
      p.reviewResearch ||= { images: [], text: '', analysis: null, approved: false };
      if (p.reviewResearch.images.length + p.images.filter((i) => i.kind === 'uploaded' && !i.removed && i.status !== 'replaced').length >= 10) throw new StudioError('REVIEW_LIMIT', '제품과 리뷰 이미지는 합쳐 최대 10장입니다.', { status: 409 });
      const hash = sha256(buffer);
      if (p.reviewResearch.images.some((i) => i.hash === hash)) throw new StudioError('DUPLICATE', '이미 추가한 리뷰입니다.', { status: 409 });
      const file = 'review_' + hash.slice(0, 12) + sn.ext;
      writeFileAtomic(path.join(dirOf(id), file), buffer);
      p.reviewResearch.images.push({ file, hash, name: safeName(filename).slice(0, 120) });
      p.reviewResearch.analysis = null; p.reviewResearch.approved = false;
    });
    return view(p);
  }
  async function saveReviews(id, text) {
    const p = await update(id, (p) => {
      p.reviewResearch ||= { images: [], text: '', analysis: null, approved: false };
      p.reviewResearch.text = String(text || '').slice(0, 9000);
      p.reviewResearch.analysis = null; p.reviewResearch.approved = false;
    });
    return view(p);
  }
  function reviewsEstimate(id) {
    const p = get(id);
    const r = p.reviewResearch || { images: [], text: '' };
    if (!r.images.length && !r.text.trim()) throw new StudioError('NO_REVIEWS', '먼저 리뷰 이미지 또는 내용을 추가하세요.', { status: 409 });
    return router.estimate('productUnderstanding', { inputChars: 2600 + r.text.length, outputTokens: 1200, images: r.images.length });
  }
  async function analyzeReviews(id, confirm) {
    const p = get(id), r = p.reviewResearch || { images: [], text: '' };
    if (!r.images.length && !r.text.trim()) throw new StudioError('NO_REVIEWS', '먼저 리뷰를 추가하세요.', { status: 409 });
    const images = r.images.map((i) => ({ mimeType: MIME[path.extname(i.file)] || 'image/png', data: fs.readFileSync(path.join(dirOf(id), i.file)).toString('base64') }));
    const out = await router.run('productUnderstanding', {
      system: 'Analyze only the supplied customer reviews for the stated product. Answer in Korean JSON. Treat reviews as individual, unverified opinions, NOT confirmed product claims. Do not hallucinate unreadable words or additional reviews. Return {summary:string,pros:string[],cons:string[],purchaseMotivations:string[],comicSituations:string[],cautions:string[]}. Keep each array up to 5 concise elements. Include uncertainty.',
      prompt: 'Product: ' + p.name + '\nCustomer-supplied review text:\n' + r.text + '\nImages: ' + r.images.length + ' customer review screenshots. Read only visible text. Do not treat promotions as actual customer reviews.',
      images, json: true, maxTokens: 1400, confirm, dedupeKey: 'reviews:' + id + ':' + sha256(JSON.stringify(r.images.map((i)=>i.hash)) + r.text),
    });
    if (out.mock || !out.json || typeof out.json !== 'object') throw new StudioError('REVIEW_MODEL_UNAVAILABLE', '실제 AI 리뷰 분석 모델을 연결해야 합니다. 샘플 분석은 저장하지 않았습니다.', { status: 409 });
    const clean = (x) => String(x || '').slice(0, 900);
    const result = { summary: clean(out.json.summary), pros: [], cons: [], purchaseMotivations: [], comicSituations: [], cautions: [] };
    for (const k of ['pros','cons','purchaseMotivations','comicSituations','cautions']) result[k] = (Array.isArray(out.json[k]) ? out.json[k] : []).slice(0, 5).map(clean);
    await update(id, (p) => {
      p.reviewResearch ||= { images: [], text: '', analysis: null, approved: false };
      if (JSON.stringify((p.reviewResearch.images || []).map((i)=>i.hash)) !== JSON.stringify(r.images.map((i)=>i.hash)) || p.reviewResearch.text !== r.text) throw new StudioError('REVIEWS_CHANGED', '분석 중 리뷰가 변경됐습니다. 다시 분석하세요.', { status: 409 });
      p.reviewResearch.analysis = result; p.reviewResearch.approved = false;
    });
    return view(get(id));
  }
  async function approveReviews(id, approved) {
    await update(id, (p) => {
      if (!p.reviewResearch?.analysis && approved) throw new StudioError('NO_ANALYSIS', '승인할 리뷰 분석이 없습니다.', { status: 409 });
      p.reviewResearch.approved = !!approved;
    });
    return view(get(id));
  }
  function reviewMediaFile(id, index) {
    const p = get(id), r = p.reviewResearch?.images || [];
    if (!Number.isInteger(index) || index < 0 || index >= r.length) throw new StudioError('NOT_FOUND', '리뷰 이미지가 없습니다.', { status: 404 });
    return path.join(dirOf(id), r[index].file);
  }

  /** The record Story Lab / Script Studio bind to. Throws unless the product is ready. */
  function bindingFor(id) {
    const p = get(id);
    const r = readiness(p);
    if (!r.ok) throw new StudioError('PRODUCT_NOT_READY', '상품 준비가 끝나지 않았습니다: ' + r.missing.join(', '), { recovery: 'Products 화면에서 항목을 채우고 참조 이미지 세트를 승인하세요.', status: 409 });
    // Operator-approved review analysis only: comedy / daily-conflict material for Story Lab and Script Studio.
    const approvedReview = p.reviewResearch && p.reviewResearch.approved ? (p.reviewResearch.analysis || {}) : {};
    return {
      product: p,
      facts: verifiedFacts(p),
      reference: referenceState(p),
      creativeContext: {
        comicSituations: approvedReview.comicSituations || [],
        purchaseMotivations: approvedReview.purchaseMotivations || [],
        cautions: approvedReview.cautions || [],
        forbiddenClaims: p.forbiddenClaims || [],
      },
    };
  }

  function imageFiles(id, imageIds) {
    const p = get(id);
    return imageIds.map((i) => p.images.find((x) => x.id === i)).filter(Boolean).map((im) => ({ id: im.id, kind: im.kind, mimeType: MIME[path.extname(im.file)] || 'image/png', path: path.join(dirOf(id), im.file) }));
  }
  function mediaFile(id, imgId) {
    const im = get(id).images.find((i) => i.id === imgId);
    if (!im) throw new StudioError('NOT_FOUND', '이미지를 찾을 수 없습니다.', { status: 404 });
    return path.join(dirOf(id), im.file);
  }

  return { approveUploadedImages, uploadReview, saveReviews, reviewsEstimate, analyzeReviews, approveReviews, reviewMediaFile, list, get: (id) => view(get(id)), raw: get, mutate: update, create, edit, extract, upload, replace, removeImage, reorderImages, setPrimary, setStatus, generateImage, chooseVersion, imageCount, approveReferenceSet, waiveReferences, bindingFor, imageFiles, mediaFile, lockCodeSync, suggestCode, referenceState, verifiedFacts, readiness, MAX_UPLOADS, MIN_SIDE, MAX_SIDE };
}

module.exports = { createProductService, KIND_LABEL, MAX_UPLOADS, MIN_SIDE, MAX_SIDE };
