// B-roll still images made by the image model ("이미지 만들기"): one still per B-roll item, 9:16, for the video editor to layer on top.
//   * paid → needs the script APPROVED, an explicit cost confirmation (estimate first), spend limits (router)
//   * close_up / reaction shots use the approved character references of the scene cast (real image bytes);
//     insert / broll shots use the approved product references only when the scene shows the product
//   * every B-roll has an EDITABLE image prompt (b.imageGen.prompt; a draft is prepared from the B-roll, scene, cast and product).
//     The reference rules (real character / product images + "authoritative reference" lines) are appended automatically and cannot be edited away
//   * references: character images when the shot is a close-up/reaction or names a cast member; product images when the scene shows the product
//     (both can be switched per B-roll). A missing/unapproved reference blocks generation with an actionable message — nothing is substituted
//   * the result is saved as an UNAPPROVED proposal. An existing image needs force; an APPROVED image is replaced only with overwriteApproved:true
//     (the approval is then withdrawn). Previous files stay on disk. Failed paid calls are recorded and never retried automatically
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256 } = require('./util');
const { isScriptApproved } = require('./episode');
const { sniffImage } = require('./extract');

const CHARACTER_KINDS = new Set(['close_up', 'reaction']);
const MAX_PRODUCT_REFS = 3;

function createBrollImages({ store, products, router, charRefs, sba, lib, productAnalysis = null }) {
  const find = (ep, bid) => {
    const b = (ep.broll || []).find((x) => x.id === bid && x.status !== 'removed');
    if (!b) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
    return b;
  };
  const sceneOf = (ep, b) => (ep.scenes || []).find((x) => x.id === b.sceneId);
  function gate(ep) {
    if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인되기 전에는 B-roll 이미지를 만들 수 없습니다 (유료 생성).', { status: 409, recovery: 'Script Studio에서 대본을 승인하세요.' });
  }
  function check(b, { force, overwriteApproved }) {
    if (b.status === 'approved' && !overwriteApproved) throw new StudioError('BROLL_APPROVED', '승인된 B-roll 이미지는 확인 없이 덮어쓰지 않습니다. 새로 만들면 기존 승인이 취소됩니다 (이전 파일은 보관됩니다).', { status: 409, recovery: '"승인된 이미지를 교체"를 확인하고 다시 실행하세요.' });
    if (b.imageRef && !force && !overwriteApproved) throw new StudioError('BROLL_HAS_IMAGE', '이미 이미지가 있습니다. 새로 만들려면 "재생성"을 선택하세요 (이전 파일은 보관됩니다).', { status: 409 });
  }

  /** Which references this B-roll uses (defaults from the shot, switchable per B-roll). */
  function refPlan(ep, b) {
    const sc = sceneOf(ep, b);
    const L = lib();
    const g = b.imageGen || {};
    const cast = [...new Set(sc.characters || [])].filter(Boolean);
    const named = cast.filter((cid) => { const c = L.characters.find((x) => x.id === cid); const hay = ((b.effect || '') + ' ' + (b.note || '') + ' ' + (g.prompt || '')).toLowerCase(); return c && (hay.includes(c.name.toLowerCase()) || hay.includes(cid.toLowerCase())); });
    const autoChars = CHARACTER_KINDS.has(b.kind) ? cast : named;
    const chars = Array.isArray(g.refCharacters) ? g.refCharacters.filter((c) => cast.includes(c)) : autoChars;
    const productRefIds = ((ep.productRefs || {}).imageIds || []).slice(0, MAX_PRODUCT_REFS);
    const autoProduct = !!sc.showsProduct && !CHARACTER_KINDS.has(b.kind);
    const useProduct = typeof g.refProduct === 'boolean' ? g.refProduct : autoProduct;
    return { sc, cast, chars, useProduct, productRefIds, autoChars, autoProduct };
  }

  function reflist(ep, b) {
    const rp = refPlan(ep, b);
    const out = [];
    rp.chars.forEach((cid) => { const r = charRefs.forCharacter(ep, rp.sc.id, cid); out.push({ type: 'character', characterId: cid, name: r.name, assetId: r.assetId, status: r.status, url: r.url, message: r.status === 'approved' ? '' : (r.status === 'missing' ? charRefs.missingMessage(r.name) : r.message) }); });
    if (rp.useProduct) {
      if (!rp.productRefIds.length) out.push({ type: 'product', name: (ep.product || {}).name || '제품', assetId: '', status: 'missing', url: '', message: 'Product reference missing. Product Studio에서 제품 참조 이미지를 승인하세요.' });
      else rp.productRefIds.forEach((iid) => out.push({ type: 'product', name: (ep.product || {}).name || '제품', assetId: `${ep.productId}:${iid}`, status: 'approved', url: `/media/product/${ep.productId}/${iid}` }));
    }
    return { refs: out, rp };
  }

  /** Free: the draft the operator edits (never contains the automatic reference rules). */
  function draftPrompt(ep, b) {
    const sc = sceneOf(ep, b);
    const L = lib();
    const rp = refPlan(ep, b);
    const names = rp.chars.map((cid) => (L.characters.find((x) => x.id === cid) || { name: cid }).name);
    return [
      `B-roll ${b.id} (${b.kind}) for scene ${sc.id}: ${sc.title_ko || sc.title || ''}.`,
      `Shot: ${b.effect || b.note || b.kind}.` + (b.note ? ` Note: ${b.note}.` : ''),
      names.length ? `Characters in frame: ${names.join(', ')}.` : 'No characters in frame.',
      rp.useProduct ? `The product (${(ep.product || {}).name || 'product'}) is shown clearly.` : 'The product is not shown.',
      `Scene visual direction: ${String(sc.visual || '').slice(0, 300)}`,
      'Composition: single still frame, subject centred with room for pan/zoom in editing; camera angle suited to the shot.',
      'Style: clean 2D anime / Korean webtoon (ink outlines, flat cel shading). Vertical 9:16.',
    ].join('\n');
  }
  const currentPrompt = (ep, b) => (b.imageGen && b.imageGen.prompt ? b.imageGen.prompt : draftPrompt(ep, b));

  /** Prompt actually sent: the (edited) text + the fixed reference rules + the real image bytes. */
  function inputs(ep, b, exclude = []) {
    const { refs, rp } = reflist(ep, b);
    const bad = refs.find((r) => r.status !== 'approved');
    if (bad) throw new StudioError(bad.type === 'product' ? 'NO_PRODUCT_REF' : 'NO_CHARACTER_REF', `${b.id}: ${bad.message}`, { status: 409, recovery: bad.type === 'product' ? 'Product Studio에서 참조 이미지를 올리고 승인하세요.' : '캐릭터 라이브러리에서 실제 참조 이미지를 올리고 승인하세요.', details: refs.filter((r) => r.status !== 'approved') });
    if (refs.length) charRefs.assertProvider();
    const images = []; const used = []; let productIds = []; let productContext = null; const lines = []; const charParts = []; const productParts = [];
    if (rp.chars.length) {
      const ci = charRefs.inputsFor(ep, Object.assign({}, rp.sc, { characters: rp.chars }), { exclude });
      ci.images.forEach((i) => images.push(i)); ci.used.forEach((u) => used.push(u)); ci.lines.forEach((l) => lines.push(l)); ci.chars.forEach((c) => charParts.push(c));
    }
    if (rp.useProduct) {
      const ex = new Set([].concat(exclude || []).map(String));
      const files = products.imageFiles(ep.productId, rp.productRefIds).filter((f) => !ex.has(`${ep.productId}:${f.id}`));
      if (!files.length) throw new StudioError('NO_PRODUCT_REF', `${b.id}: 이 요청에서 제품 참조 이미지를 모두 제외했습니다. 제품이 나오는 B-roll에는 제품 참조가 최소 1장 필요합니다.`, { status: 409 });
      files.forEach((f) => { const buf = fs.readFileSync(f.path); images.push({ label: 'APPROVED product reference (the product must match this exactly: shape, logo, colour, function):', mimeType: f.mimeType, data: buf.toString('base64') }); productParts.push({ assetId: `${ep.productId}:${f.id}`, filename: f.id, url: `/media/product/${ep.productId}/${f.id}`, bytes: buf.length, mime: f.mimeType, name: (ep.product || {}).name }); });
      productIds = files.map((f) => f.id);
      lines.push('Draw the product EXACTLY like the approved product reference image(s). Never add features. Verified facts only: ' + (((ep.product || {}).verifiedFeatures) || []).join('; '));
      // the approved structure description travels ONLY together with the real product images attached above
      const pctx = productAnalysis ? productAnalysis.contextFor(ep.productId, productIds) : null;
      if (pctx) { productContext = pctx.record; if (pctx.block) lines.push(pctx.block); }
    } else lines.push('Do NOT show the product.');
    if (images.length) charRefs.enforce({ chars: charParts, product: productParts }); // model input limits, before any paid call
    const prompt = ['Create ONE vertical 9:16 STILL image: a B-roll insert layered over a short animated comedy video.', currentPrompt(ep, b), ...lines, 'No text, captions, subtitles, speech bubbles, logos or watermarks anywhere in the image.'].join('\n');
    return { images, prompt, refs: used, productIds, productContext };
  }

  /** Free: everything the UI needs before the button is pressed (draft prompt, reference status, provider support, estimate when sendable). */
  function plan(epId, bid, opts = {}) {
    let limit = null;
    const ep = store.episodes.get(epId);
    const b = find(ep, bid);
    const { refs, rp } = reflist(ep, b);
    const route = router.routeFor('imageGeneration');
    const warnings = refs.filter((r) => r.status !== 'approved').map((r) => r.message);
    const supported = !refs.length || charRefs.supports(route.provider) || route.provider === 'mock' || !route.provider;
    if (!supported) warnings.push(`선택한 이미지 제공자(${route.provider})는 참조 이미지 입력을 지원하지 않습니다.`);
    let estimate = null;
    if (!warnings.length) { try { const q = inputs(ep, b, opts.exclude); estimate = Object.assign({}, router.estimate('imageGeneration', { inputChars: q.prompt.length, outputTokens: 1500, images: q.images.length }), { count: 1, images: q.images.length }); } catch (e) { warnings.push(e.message); if (e.code === 'REF_LIMIT_EXCEEDED' || e.code === 'REF_TOO_LARGE') limit = e.details; } }
    return { brollId: bid, prompt: currentPrompt(ep, b), edited: !!(b.imageGen && b.imageGen.prompt), draft: draftPrompt(ep, b), refs, options: { characters: rp.cast, selectedCharacters: rp.chars, product: rp.useProduct, productAvailable: !!rp.sc.showsProduct }, warnings, estimate, scriptApproved: isScriptApproved(ep), route: { provider: route.provider, model: route.model }, approved: b.status === 'approved', hasImage: !!b.imageRef, limit, excluded: [].concat(opts.exclude || []) };
  }

  async function savePrompt(epId, bid, { prompt, refCharacters, refProduct } = {}) {
    await store.episodes.update(epId, (ep) => {
      const b = find(ep, bid);
      const g = Object.assign({}, b.imageGen);
      if (prompt !== undefined) { const t = String(prompt).trim(); if (t.length > 4000) throw new StudioError('PROMPT_TOO_LONG', '프롬프트는 4000자 이하여야 합니다.', { status: 422 }); g.prompt = t; }
      if (refCharacters !== undefined) g.refCharacters = Array.isArray(refCharacters) ? refCharacters.map(String) : undefined;
      if (refProduct !== undefined) g.refProduct = refProduct === null ? undefined : !!refProduct;
      b.imageGen = g; // editing a prompt never changes the image or its approval
    });
    return plan(epId, bid);
  }
  async function resetPrompt(epId, bid) {
    await store.episodes.update(epId, (ep) => { const b = find(ep, bid); const g = Object.assign({}, b.imageGen); delete g.prompt; b.imageGen = g; });
    return plan(epId, bid);
  }

  function estimate(epId, bid, opts = {}) {
    const ep = store.episodes.get(epId);
    const b = find(ep, bid);
    check(b, opts);
    const q = inputs(ep, b, opts.exclude);
    const est = router.estimate('imageGeneration', { inputChars: q.prompt.length, outputTokens: 1500, images: q.images.length });
    return Object.assign({}, est, { count: 1, brollId: bid, images: q.images.length, replacesApproved: b.status === 'approved', note: 'B-roll 이미지 1장. ' + (est.note || '') });
  }

  /** Separate, actionable errors: not enough credits vs a model that cannot do this. Never retried automatically. */
  function classify(e) {
    const msg = String(e.message || '');
    if (e.code === 'AI_RATE_LIMITED' && /quota|billing|credit|exhaust|balance|resource/i.test(msg)) return { code: 'INSUFFICIENT_CREDITS', message: 'Gemini 크레딧/쿼터가 부족합니다. 요금제·결제 상태를 확인한 뒤 직접 다시 시도하세요 (자동 재시도하지 않습니다).' };
    if (e.code === 'AI_RATE_LIMITED') return { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 직접 다시 시도하세요 (자동 재시도하지 않습니다).' };
    if (e.code === 'AI_INVALID_MODEL' || (e.code === 'AI_BAD_REQUEST' && /image|modalit|not support|unsupported|response_modalities/i.test(msg))) return { code: 'UNSUPPORTED_MODEL', message: '선택한 모델은 이미지 생성 또는 참조 이미지 입력을 지원하지 않습니다. Settings → AI 연동에서 이미지 생성 가능한 Gemini 모델을 고르세요.' };
    if (e.code === 'AI_AUTH_FAILED') return { code: 'AUTH_FAILED', message: 'Gemini API 키가 거부되었습니다. Settings에서 키를 확인하세요.' };
    return { code: e.code || 'ERROR', message: msg };
  }

  async function generate(epId, bid, { confirm, force = false, overwriteApproved = false, exclude = [], by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    gate(ep0);
    const b0 = find(ep0, bid);
    check(b0, { force, overwriteApproved });
    const q = inputs(ep0, b0, exclude); // every pre-flight problem surfaces BEFORE the paid call
    let productContext = q.productContext;
    if (productContext && productContext.referenceImageIds.length && productAnalysis) { // free bookkeeping: number the exact product image set being attached
      try { const reg = await productAnalysis.registerImageSet(ep0.productId, productContext.referenceImageIds); productContext = Object.assign({}, productContext, { referenceImageSetVersion: reg.v, referenceImageSetHash: reg.hash }); } catch (_) { /* provenance is best effort */ }
    }
    let out;
    try {
      out = await router.runImage('imageGeneration', { prompt: q.prompt, images: q.images, confirm });
    } catch (e) {
      if (e.code === 'CONFIRM_REQUIRED' || e.code === 'NOT_CONFIGURED' || e.code === 'NO_MODEL' || /^(DAILY|MONTHLY)_LIMIT$|^COST_UNKNOWN$/.test(e.code || '')) throw e; // nothing was sent
      const c = classify(e);
      await store.episodes.update(epId, (x) => { const b = find(x, bid); b.imageGen = Object.assign({}, b.imageGen, { lastError: Object.assign({ at: nowIso() }, c) }); });
      store.episodes.audit(epId, 'broll.image.failed', { id: bid, code: c.code });
      throw new StudioError(c.code, c.message, { status: e.status || 502, recovery: e.recovery || '' });
    }
    const buf = Buffer.from(out.images[0].data, 'base64');
    const sn = sniffImage(buf);
    if (!sn) throw new StudioError('BAD_IMAGE', '이미지 모델이 올바른 이미지를 돌려주지 않았습니다.', { status: 502 });
    const hash = sha256(buf);
    const file = hash.slice(0, 12) + sn.ext;
    store.episodes.saveFile(epId, path.join('broll', file), buf);
    if (b0.status === 'approved') await sba.setBrollStatus(epId, bid, 'proposed', by); // replacing an approved image withdraws the approval (explicitly confirmed)
    const saved = await sba.saveBroll(epId, { id: bid, imageRef: { type: 'upload', file, sha256: hash } }, by);
    const health = sba.assetHealth(store.episodes.get(epId), store.episodes.get(epId).broll.find((y) => y.id === bid));
    if (health.state !== 'ready') {
      const e2 = { code: 'IMAGE_NOT_ACCESSIBLE', message: `이미지를 저장했지만 접근할 수 없습니다: ${health.problem}`, at: nowIso() };
      await store.episodes.update(epId, (x) => { const b = find(x, bid); b.imageGen = Object.assign({}, b.imageGen, { lastError: e2 }); });
      throw new StudioError('IMAGE_NOT_ACCESSIBLE', e2.message, { status: 500, recovery: '서버 저장소 권한/용량을 확인하고 다시 생성하세요 (자동 재시도하지 않습니다).' });
    }
    await store.episodes.update(epId, (e) => {
      const x = e.broll.find((y) => y.id === bid);
      x.imageGen = Object.assign({}, x.imageGen, { lastError: undefined });
      x.generated = { provider: out.provider, model: out.model, prompt: q.prompt, characterRefs: q.refs, characterRefAssetIds: q.refs.map((r) => r.assetId), productImageIds: q.productIds, productContext, at: nowIso(), by, replacedApproved: b0.status === 'approved' };
    });
    store.episodes.audit(epId, 'broll.image.generated', { id: bid, provider: out.provider, model: out.model, file, replacedApproved: b0.status === 'approved' });
    return saved;
  }
  /** Free: what a B-roll card shows next to the image — the prompt text and the reference images that would be attached. */
  function cardInfo(ep, b) {
    let refs = [];
    try { refs = reflist(ep, b).refs; } catch (_) { refs = []; }
    return { promptText: currentPrompt(ep, b), refs };
  }
  return { cardInfo, plan, savePrompt, resetPrompt, estimate, generate, draftPrompt, classify };
}

module.exports = { createBrollImages };
