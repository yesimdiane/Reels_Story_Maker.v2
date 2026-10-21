// AI start images for scenes: one 2D anime/webtoon first frame per scene, built from the scene's own description,
// the approved character references of the cast and (only when the scene shows the product) the approved product references.
//   * paid (image model) → needs the script to be APPROVED (backend gate), an explicit cost confirmation, and spend limits
//   * results are saved as UNAPPROVED start frames; the operator approves each one (same flow as uploaded frames)
//   * never overwrites an approved frame; earlier files are kept on disk; a scene that already has a generated frame is skipped unless forced
//   * every scene is saved before the next paid call, so a failure part-way keeps (and never re-bills) what was already made
//   * a scene that shows the product gets BOTH the actual approved product reference image(s) AND the approved English product structure description
//     (never the text alone); every generated frame records which reference image-set version and description version it used, and each scene keeps V1, V2, V3 … of its frames
'use strict';
const sceneLook = require('./scenelook');
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256 } = require('./util');
const { isScriptApproved } = require('./episode');
const { castDirective, identityLines, SHEET_RULE } = require('./charrules');
const { sniffImage } = require('./extract');
const { lockedOutfits } = require('./outfitlock');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_PRODUCT_REFS = 3;

function createStartImages({ store, products, router, lib, charRefs, productAnalysis = null, log = () => {} }) {
  const hasFrame = (s) => !!(s.startImage && s.startImage.type === 'upload');

  /** Which scenes would be generated, and why the others are skipped. Pure: nothing is billed or changed. */
  function plan(ep, sceneIds, { force = false } = {}) {
    const wanted = sceneIds && sceneIds.length ? ep.scenes.filter((s) => sceneIds.includes(s.id)) : ep.scenes;
    if (sceneIds && sceneIds.length && wanted.length !== new Set(sceneIds).size) throw new StudioError('NOT_FOUND', '존재하지 않는 장면이 포함되어 있습니다.', { status: 404 });
    const targets = [];
    const skipped = [];
    wanted.forEach((s) => {
      if (hasFrame(s) && s.startImage.approved) skipped.push({ sceneId: s.id, reason: '이미 승인된 시작 프레임이 있습니다 (먼저 승인을 취소해야 바꿀 수 있습니다).' });
      else if (hasFrame(s) && s.startImage.generated && !force) skipped.push({ sceneId: s.id, reason: '이미 AI로 만든 시작 프레임이 있습니다 (다시 만들려면 "다시 생성"을 선택하세요).' });
      else targets.push(s);
    });
    return { targets, skipped };
  }

  function gate(ep) {
    if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인되기 전에는 AI 시작 이미지를 만들 수 없습니다 (유료 생성).', { recovery: 'Script Studio에서 대본을 승인하세요.', status: 409 });
  }

  /** The scene-describing part of the image prompt (built from the shared scene fields). The cast / identity / product / "no text" rules are appended by code and cannot be edited away. */
  function autoHead(ep, scene) {
    return [
      'Create ONE vertical 9:16 illustration: the FIRST FRAME of a short animated comedy scene, in a clean 2D anime / Korean webtoon style (ink outlines, flat cel shading, expressive faces).',
      `SCENE ${scene.id}: ${scene.title || ''}`,
      'VISUAL: ' + (scene.visual || '(not described)'),
      scene.action ? 'ACTION AT THE FIRST FRAME: ' + scene.action : '',
      ...sceneLook.promptLines(scene, lib(), { still: true }),
    ].filter(Boolean).join('\n');
  }
  /** What is sent: the operator's saved text when they edited it, otherwise the automatic text. */
  function headFor(ep, scene) {
    const o = ep.imagePrompts && ep.imagePrompts[scene.id];
    return o && o.edited && o.text ? o.text : autoHead(ep, scene);
  }
  const promptView = (ep, scene) => { const o = (ep.imagePrompts || {})[scene.id] || {}; return { text: headFor(ep, scene), auto: autoHead(ep, scene), edited: !!(o.edited && o.text), rev: o.rev || 0 }; };

  /** Inputs for one scene. Throws (before any paid call) when the cast has no approved, non-placeholder character reference. */
  function inputs(ep, scene, exclude = []) {
    const L = lib();
    const cast = scene.characters || [];
    // an empty cast tells the image model "no recurring characters": a scene where Diane / Jack speak or are named would be drawn with random people
    if (!cast.length) {
      const names = Object.fromEntries((L.characters || []).map((c) => [c.id, [c.name, c.nameKo].filter(Boolean)]));
      const guess = sceneLook.inferCast({ speakers: (ep.lines || []).filter((l) => l.sceneId === scene.id).map((l) => l.speaker), text: [scene.visual, scene.action].join('. ') }, new Set((L.characters || []).map((c) => c.id)), names);
      if (guess.length) throw new StudioError('SCENE_CAST_EMPTY', `${scene.id}: 출연 캐릭터가 비어 있는데 대사나 설명에 ${guess.map((id) => (names[id] || [id])[0]).join(', ')}이(가) 나옵니다. 이대로 만들면 캐릭터 참조 없이 엉뚱한 인물이 그려집니다.`, { status: 409, details: { sceneId: scene.id, suggested: guess }, recovery: '이미지 편집의 "캐릭터 출연"에서 출연자를 선택하거나 "대사·설명으로 출연 자동 채우기"를 누르세요.' });
    }
    // the ACTUAL approved image bytes of the characters in this scene (validated first; throws before any paid call)
    const ci = charRefs.inputsFor(ep, scene, { exclude });
    const images = ci.images.slice();
    const outfit = lockedOutfits(ep, scene, store, L.characters);
    images.push(...outfit.images);
    const used = ci.used;
    let productIds = []; const productParts = [];
    if (scene.showsProduct && ep.productId && ep.productRefs && (ep.productRefs.imageIds || []).length) {
      const ex = new Set([].concat(exclude || []).map(String));
      const files = products.imageFiles(ep.productId, ep.productRefs.imageIds.slice(0, MAX_PRODUCT_REFS)).filter((f) => !ex.has(`${ep.productId}:${f.id}`));
      if (!files.length) throw new StudioError('NO_PRODUCT_REF', `${scene.id}: 이 요청에서 제품 참조 이미지를 모두 제외했습니다. 제품이 나오는 장면에는 제품 참조가 최소 1장 필요합니다.`, { status: 409 });
      files.forEach((f) => { const buf = fs.readFileSync(f.path); images.push({ label: 'APPROVED product reference (the product must match this exactly: shape, logo, colour, function):', mimeType: f.mimeType, data: buf.toString('base64') }); productParts.push({ assetId: `${ep.productId}:${f.id}`, filename: f.id, url: `/media/product/${ep.productId}/${f.id}`, bytes: buf.length, mime: f.mimeType, name: (ep.product || {}).name }); });
      productIds = files.map((f) => f.id);
    }
    // SCENE CONTINUITY references: the already generated / uploaded image of other scenes the operator picked (same room, light, props).
    // A picked scene without a usable image is refused (nothing is dropped silently); the people in it must NOT be copied.
    const sceneParts = []; const sceneRefsUsed = [];
    (scene.sceneRefs || []).forEach((rid) => {
      const other = (ep.scenes || []).find((x) => x.id === rid);
      const si = other && other.startImage;
      const file = si && si.file ? store.episodes.file(ep.id, 'startframes', si.file) : '';
      if (!other || !si || si.placeholder || !file || !fs.existsSync(file)) throw new StudioError('SCENE_REF_MISSING', `${scene.id}: 참조로 고른 ${rid} 씬의 이미지가 없습니다. 그 씬의 이미지를 먼저 만들거나 참조에서 빼 주세요.`, { status: 409, details: { sceneId: scene.id, refSceneId: rid }, recovery: '이미지 편집의 "참조 이미지 → 씬 이미지"에서 선택을 바꾸세요.' });
      const buf = fs.readFileSync(file);
      const mime = (sniffImage(buf) || {}).mime || 'image/png';
      images.push({ label: `SCENE CONTINUITY reference: the image of scene ${rid}. Keep the SAME setting — room layout, wall / tile colours, lighting tone, props and where they are. Do NOT copy the people in it: the characters of THIS scene come only from their character references.`, mimeType: mime, data: buf.toString('base64') });
      sceneParts.push({ assetId: `scene:${rid}`, filename: si.file, url: `/media/startframe/${ep.id}/${rid}`, bytes: buf.length, mime, name: `${rid} 씬 이미지` });
      sceneRefsUsed.push({ sceneId: rid, sha256: si.sha256 || sha256(buf), approved: !!si.approved });
    });
    // The approved structure description rides along ONLY with the real product images that are attached (text alone never replaces the reference image).
    const pctx = productIds.length && productAnalysis ? productAnalysis.contextFor(ep.productId, productIds) : null;
    try { charRefs.enforce({ chars: ci.chars, scenes: sceneParts, product: productParts.concat(outfit.images.map((im, i) => ({ assetId: 'outfit-lock-' + i, name: im.label }))) }); } catch (e) { if (e.details) e.details.sceneId = scene.id; e.message = `${scene.id}: ${e.message}`; throw e; } // model input limits, before any paid call
    const facts = scene.showsProduct ? (ep.product.verifiedFeatures || []) : [];
    const prompt = [
      headFor(ep, scene),
      castDirective(cast, L),
      ...identityLines(cast, L),
      ...ci.lines,
      ...outfit.instructions,
      cast.length ? SHEET_RULE : '',
      sceneRefsUsed.length ? `SCENE CONTINUITY: ${sceneRefsUsed.length > 1 ? 'the attached scene images (' + sceneRefsUsed.map((r) => r.sceneId).join(', ') + ') show' : 'the attached scene image (' + sceneRefsUsed[0].sceneId + ') shows'} the SAME place as this scene. Match its setting, lighting and props; draw only the characters listed in CAST, with their own character references.` : '',
      pctx && pctx.block ? pctx.block : '',
      scene.showsProduct && productIds.length ? 'The product appears in this scene: draw it EXACTLY like the approved product reference(s). Never add features. Verified facts only: ' + (facts.join('; ') || 'none') : 'Do NOT show the product in this frame.',
      'No text, captions, subtitles, speech bubbles, logos or watermarks anywhere in the image.',
    ].filter(Boolean).join('\n');
    return { images, prompt, used, sceneRefsUsed, productIds, productContext: pctx ? pctx.record : null, productWarnings: pctx ? pctx.warnings : [] };
  }

  function estimate(epId, sceneIds, opts = {}) {
    const ep = store.episodes.get(epId);
    const { targets, skipped } = plan(ep, sceneIds, opts);
    let usd = 0;
    let unknown = false;
    let est = null;
    const scenes = targets.map((s) => {
      const q = inputs(ep, s, opts.exclude);
      est = router.estimate('imageGeneration', { inputChars: q.prompt.length, outputTokens: 1500, images: q.images.length });
      if (est.usd == null) unknown = true; else usd += est.usd;
      return { sceneId: s.id, images: q.images.length, productImages: q.productIds.length, structureVersion: q.productContext ? q.productContext.structureVersion : null, referenceImageSetVersion: q.productContext ? q.productContext.referenceImageSetVersion : null, warnings: q.productWarnings };
    });
    if (!est) return { count: 0, scenes, skipped, provider: router.routeFor('imageGeneration').provider, model: router.routeFor('imageGeneration').model, usd: 0, note: '만들 장면이 없습니다.' };
    return Object.assign({}, est, { usd: unknown ? null : Math.round(usd * 1e6) / 1e6, count: targets.length, scenes, skipped, note: `장면 ${targets.length}개 × 이미지 1장 (장면당 별도 호출). ` + (est.note || '') });
  }

  async function generate(epId, sceneIds, { confirm, force = false, exclude = [], by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    gate(ep0);
    const { targets, skipped } = plan(ep0, sceneIds, { force });
    if (!targets.length) return { generated: [], skipped, failed: null };
    targets.forEach((s) => inputs(ep0, s, exclude)); // all pre-flight problems surface BEFORE the first paid call
    const generated = [];
    let failed = null;
    for (const scene of targets) {
      const ep = store.episodes.get(epId);
      gate(ep);
      const cur = ep.scenes.find((x) => x.id === scene.id);
      if (!cur || (hasFrame(cur) && cur.startImage.approved)) { skipped.push({ sceneId: scene.id, reason: '진행 중에 승인된 프레임이 생겨 건너뜁니다.' }); continue; }
      const q = inputs(ep, cur, exclude);
      const requestFingerprint = sha256(JSON.stringify({ prompt: q.prompt, refs: q.images.map((img) => sha256(Buffer.from(img.data, 'base64'))), route: router.routeFor('imageGeneration') })).slice(0, 16);
      const previousImageHash = cur.startImage && cur.startImage.sha256 || null;
      let productContext = q.productContext;
      if (productContext && productContext.referenceImageIds.length && productAnalysis) { // free bookkeeping: number the exact reference image set that is about to be attached
        try { const reg = await productAnalysis.registerImageSet(ep.productId, productContext.referenceImageIds); productContext = Object.assign({}, productContext, { referenceImageSetVersion: reg.v, referenceImageSetHash: reg.hash }); } catch (_) { /* provenance is best effort; the images are attached either way */ }
      }
      let out;
      try {
        out = await router.runImage('imageGeneration', { prompt: q.prompt, images: q.images, confirm });
      } catch (e) {
        if (!generated.length) throw e;
        failed = { sceneId: scene.id, code: e.code || 'ERROR', message: e.message, recovery: e.recovery || '' };
        break;
      }
      try {
        const buf = Buffer.from(out.images[0].data, 'base64');
        const sn = sniffImage(buf);
        if (!sn) throw new StudioError('BAD_IMAGE', '이미지 모델이 올바른 이미지를 돌려주지 않았습니다.', { status: 502 });
        const hash = sha256(buf);
        const sameAsPrevious = !!previousImageHash && hash === previousImageHash;
        const file = hash.slice(0, 12) + sn.ext;
        store.episodes.saveFile(epId, path.join('startframes', file), buf);
        await store.episodes.update(epId, (e) => {
          const s = e.scenes.find((x) => x.id === scene.id);
          s.startImageVersions = s.startImageVersions || [];
          const vers = s.startImageVersions;
          // earlier frames are never lost: a frame that was never recorded (older data, manual upload) becomes the next version before the new one is added
          if (s.startImage && s.startImage.type === 'upload' && s.startImage.file && !vers.some((x) => x.file === s.startImage.file)) vers.push({ v: vers.length + 1, file: s.startImage.file, sha256: s.startImage.sha256 || null, name: s.startImage.name || '', generated: !!s.startImage.generated, provider: s.startImage.provider || '', model: s.startImage.model || '', createdAt: s.startImage.createdAt || null, productContext: s.startImage.productContext || null, earlier: true });
          const nv = vers.length + 1;
          vers.push({ v: nv, file, sha256: hash, name: `AI 시작 프레임 ${scene.id} V${nv}`, generated: true, provider: out.provider, model: out.model, createdAt: nowIso(), forced: !!force, requestFingerprint, sameAsPrevious, productContext, characterRefAssetIds: q.used.map((u) => u.assetId) });
          s.startImage = { type: 'upload', file, sha256: hash, approved: false, generated: true, version: nv, name: `AI 시작 프레임 ${scene.id}`, provider: out.provider, model: out.model, prompt: q.prompt, sceneRefs: q.sceneRefsUsed, characterRefs: q.used, characterRefAssetIds: q.used.map((u) => u.assetId), productImageIds: q.productIds, productContext, createdAt: nowIso(), createdBy: by, generationDiagnostics: { requestFingerprint, forced: !!force, submittedToProvider: true, sameAsPrevious } };
        });
        store.episodes.audit(epId, 'startimage.generated', { sceneId: scene.id, provider: out.provider, model: out.model, file, requestFingerprint, forced: !!force, submittedToProvider: true, sameAsPrevious, referenceImageSetVersion: productContext ? productContext.referenceImageSetVersion : null, structureVersion: productContext ? productContext.structureVersion : null });
        generated.push({ sceneId: scene.id, file, requestFingerprint, sameAsPrevious, provider: out.provider, model: out.model, productContext });
      } catch (e) {
        failed = { sceneId: scene.id, code: e.code || 'ERROR', message: e.message, recovery: e.recovery || '' };
        break;
      }
    }
    return { generated, skipped, failed };
  }

  return { estimate, generate, plan, promptView, autoHead };
}

module.exports = { createStartImages };
