// Character reference images for scenes: ONE place that decides which approved Character Library image stands for each character
// of a scene, validates it before any visual generation, and builds the real multimodal inputs for the image provider.
//   * the Character Library owns the files; nothing is copied or regenerated here
//   * each character has up to 3 SELECTED reference images (c.referenceSelection, ordered; first = primary) — the limit is PER CHARACTER,
//     never per scene. No selection yet → the first approved, non-placeholder image. Unselected uploads are never deleted.
//   * a scene may use its own ordered subset/choice (ep.sceneRefs[sceneId][characterId] = refId | [refIds]); keyed by scene + character id,
//     so it survives reordering and edits. A single generation request may additionally EXCLUDE references (never persisted)
//   * before any image request the total (all participating characters' selections + product images) is checked against the model's input
//     limit (reflimits.js). Nothing is dropped or swapped silently: the request is refused with the counts and the choice goes to the user
//   * ep.cast.refAssets snapshots the references that were attached when the project was created (asset ids)
//   * text-only models never "see" images: they only get the written appearance (see textNote)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso } = require('./util');
const { limitFor } = require('./reflimits');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** (An unconfigured/mock route is left to the router, which refuses image calls with its own message.)
 * Image providers that accept reference images as multimodal input (the router's image route is Gemini-only today). */
const REF_CAPABLE = new Set(['gemini']);

const assetId = (cid, rid) => `${cid}:${rid}`;
const missingMessage = (name) => `Character reference missing: ${name}. Please upload or select a reference image.`;
const usable = (r) => !!r && r.approved && !r.placeholder;
const MAX_PER_CHARACTER = 3;
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);

function createCharRefs({ store, lib, router, aiSettings = () => ({}) }) {
  const L = () => lib();
  const charOf = (cid) => L().characters.find((x) => x.id === cid);

  function fileOf(cid, ref) {
    try { const f = store.characters.refPath(cid, ref); return fs.existsSync(f) ? f : ''; } catch (_) { return ''; }
  }

  const entry = (cid, r, order) => ({ refId: r.id, assetId: assetId(cid, r.id), label: r.label || r.id, filename: r.originalName || r.label || r.id, url: `/media/ref/${cid}/${r.id}`, order, primary: order === 1, size: r.size || 0 });

  /** The ordered, usable selection of a character: scene choice → library selection → first approved image. */
  function resolveSelection(ep, sceneId, c) {
    const refs = c.references || [];
    const pick = (ids) => ids.map((id) => refs.find((r) => r.id === id)).filter(usable).slice(0, MAX_PER_CHARACTER);
    const wanted = asList(((ep.sceneRefs || {})[sceneId] || {})[c.id]);
    const scene = pick(wanted);
    if (scene.length) return { list: scene, from: 'scene', staleOverride: scene.length < wanted.length };
    const lib0 = pick(asList(c.referenceSelection));
    if (lib0.length) return { list: lib0, from: 'library', staleOverride: wanted.length > 0 };
    const first = refs.find(usable);
    return { list: first ? [first] : [], from: 'default', staleOverride: wanted.length > 0 };
  }

  /** What stands for one character in one scene. Pure/free. */
  function forCharacter(ep, sceneId, cid) {
    const c = charOf(cid);
    const name = c ? c.name : cid;
    const base = { characterId: cid, name, nameKo: c ? c.nameKo || '' : '', look: c ? c.look || '' : '', consistency: c ? (c.promptBlock || '') : '', refId: '', assetId: '', status: 'missing', message: missingMessage(name), url: '', override: false, options: [], selected: [], selectedCount: 0, max: MAX_PER_CHARACTER, selectionFrom: 'default' };
    if (!c) return base;
    const refs = c.references || [];
    const sel = resolveSelection(ep, sceneId, c);
    base.selectionFrom = sel.from; base.override = sel.from === 'scene'; if (sel.staleOverride) base.staleOverride = true;
    base.selected = sel.list.map((r, i) => entry(cid, r, i + 1));
    base.selectedCount = base.selected.length;
    base.options = refs.filter(usable).map((r) => { const i = sel.list.indexOf(r); return Object.assign(entry(cid, r, i + 1), { selected: i >= 0, primary: i === 0 }); });
    const ref = sel.list[0];
    if (!ref) return Object.assign(base, refs.length ? { status: refs.some((r) => r.placeholder) && !refs.some((r) => !r.placeholder) ? 'placeholder' : 'unapproved', message: refs.some((r) => !r.placeholder) ? `${name}: 참조 이미지가 아직 승인되지 않았습니다. 캐릭터 라이브러리에서 승인하세요.` : missingMessage(name) } : {});
    Object.assign(base, { refId: ref.id, assetId: assetId(cid, ref.id), label: ref.label || ref.id, filename: ref.originalName || ref.label || ref.id, sha256: ref.sha256 });
    const gone = sel.list.find((r) => !fileOf(cid, r));
    if (gone) return Object.assign(base, { status: 'file_missing', message: `${name}: 참조 이미지 파일(${gone.originalName || gone.id})을 서버에서 찾을 수 없습니다. 다시 올려 주세요.` });
    return Object.assign(base, { status: 'approved', message: '', url: `/media/ref/${cid}/${ref.id}` });
  }

  /** The references of the characters that are IN this scene (no others). */
  function forScene(ep, scene) {
    return [...new Set(scene.characters || [])].filter(Boolean).map((cid) => forCharacter(ep, scene.id, cid));
  }

  /** Free pre-flight for visual generation. */
  function validate(ep, scenes) {
    const problems = [];
    (scenes || ep.scenes || []).forEach((s) => forScene(ep, s).forEach((r) => { if (r.status !== 'approved') problems.push({ sceneId: s.id, characterId: r.characterId, code: r.status === 'missing' ? 'CHARACTER_REF_MISSING' : 'CHARACTER_REF_' + r.status.toUpperCase(), message: `${s.id}: ${r.status === 'missing' ? missingMessage(r.name) : r.message}` }); }));
    return { ok: !problems.length, problems };
  }

  const supports = (provider) => REF_CAPABLE.has(String(provider || ''));
  function assertProvider() {
    const r = router.routeFor('imageGeneration');
    if (r.provider && r.provider !== 'mock' && !supports(r.provider)) throw new StudioError('REF_UNSUPPORTED', `선택한 이미지 제공자(${r.provider})는 참조 이미지 입력을 지원하지 않습니다. 참조 없이 생성하면 캐릭터가 달라질 수 있어 중단합니다.`, { status: 409, recovery: 'Settings → AI 연동에서 이미지 모델을 참조 이미지를 지원하는 Gemini 이미지 모델로 바꾸세요.' });
    return r;
  }

  /**
   * Real multimodal inputs: the actual bytes of EVERY selected reference of each participating character (≤3 each), primary first.
   * opts.exclude = assetIds left out of THIS request only (never persisted). Throws before any paid call if a character would have none left.
   */
  function inputsFor(ep, scene, opts = {}) {
    const exclude = new Set(asList(opts.exclude));
    const v = validate(ep, [scene]);
    if (!v.ok) { const p = v.problems[0]; throw new StudioError(p.code === 'CHARACTER_REF_MISSING' ? 'NO_CHARACTER_REF' : p.code, p.message, { recovery: '캐릭터 라이브러리에서 실제 참조 이미지를 올리고 승인하거나, 장면의 "캐릭터 참조 이미지"에서 다른 이미지를 고르세요.', status: 409, details: v.problems }); }
    assertProvider();
    const images = []; const used = []; const lines = []; const chars = [];
    forScene(ep, scene).forEach((r) => {
      const c = charOf(r.characterId);
      const keep = r.selected.filter((x) => !exclude.has(x.assetId));
      if (!keep.length) throw new StudioError('NO_CHARACTER_REF', `이 요청에서 ${r.name}의 참조 이미지를 모두 제외했습니다. ${missingMessage(r.name)}`, { status: 409, recovery: `${r.name}의 참조 이미지를 최소 1장은 남기세요.` });
      const parts = [];
      keep.forEach((x, i) => {
        const ref = c.references.find((q) => q.id === x.refId);
        const f = fileOf(r.characterId, ref);
        const buf = fs.readFileSync(f);
        const mime = MIME[path.extname(ref.file).toLowerCase()] || 'image/png';
        images.push({ label: `Character reference ${i + 1} of ${keep.length} for ${r.name} (id ${r.characterId}, asset ${x.assetId})${i === 0 ? ' — PRIMARY' : ''} — ONE person, identity only, never a scene layout:`, mimeType: mime, data: buf.toString('base64') });
        used.push({ characterId: r.characterId, refId: x.refId, assetId: x.assetId, sha256: ref.sha256, filename: x.filename, primary: i === 0 });
        parts.push({ assetId: x.assetId, filename: x.filename, url: x.url, bytes: buf.length, mime });
      });
      chars.push({ characterId: r.characterId, name: r.name, refs: parts });
      lines.push(`Use the attached ${r.name} character image${keep.length > 1 ? 's' : ''} (${keep.map((x) => x.assetId).join(', ')}) as the authoritative visual reference${keep.length > 1 ? ' (the first is primary; the others show the same character from other angles)' : ''}. Preserve the face, hairstyle, distinguishing features, body proportions and overall character design exactly. Change only the expression, pose, clothing condition, camera angle and environment as this scene requires.` + (r.look ? ` Approved appearance: ${r.look}` : ''));
    });
    return { images, used, lines, chars };
  }

  /**
   * The image-input limit check, run before every paid image request. Counts: all participating characters' selected references
   * (each up to 3) + the product reference images (separate). Never trims or swaps anything — it refuses and tells the user what to deselect.
   */
  function enforce({ chars = [], product = [] }) {
    const route = router.routeFor('imageGeneration');
    const lim = limitFor(route.provider, route.model, (aiSettings() || {}).refLimits);
    const charCount = chars.reduce((n, c) => n + c.refs.length, 0);
    const total = charCount + product.length;
    const all = chars.flatMap((c) => c.refs.map((r) => ({ type: 'character', characterId: c.characterId, name: c.name, assetId: r.assetId, filename: r.filename, url: r.url, bytes: r.bytes, mime: r.mime }))).concat(product.map((p) => ({ type: 'product', name: p.name || '제품', assetId: p.assetId, filename: p.filename || p.assetId, url: p.url || '', bytes: p.bytes, mime: p.mime })));
    const details = { limit: lim, total, characterCount: charCount, productCount: product.length, perCharacter: chars.map((c) => ({ characterId: c.characterId, name: c.name, count: c.refs.length })), refs: all };
    const bad = all.filter((r) => !lim.formats.includes(r.mime));
    if (bad.length) throw new StudioError('REF_FORMAT_UNSUPPORTED', `지원하지 않는 이미지 형식입니다: ${bad.map((b) => b.filename + ' (' + b.mime + ')').join(', ')}. 지원 형식: PNG, JPEG, WebP.`, { status: 409, details });
    const bytes = all.reduce((n, r) => n + (r.bytes || 0), 0);
    if (bytes > lim.maxTotalBytes) throw new StudioError('REF_TOO_LARGE', `선택한 참조 이미지의 합계 용량(${(bytes / 1048576).toFixed(1)} MB)이 요청 한도(${(lim.maxTotalBytes / 1048576).toFixed(0)} MB)를 넘습니다. 일부 참조를 이 요청에서 선택 해제하세요.`, { status: 409, details: Object.assign({ bytes }, details), recovery: '라이브러리의 선택은 바뀌지 않습니다.' });
    if (lim.maxImages != null && total > lim.maxImages) throw new StudioError('REF_LIMIT_EXCEEDED', `선택한 참조 이미지 ${total}장(캐릭터 ${charCount}장 + 제품 ${product.length}장)이 ${route.model || route.provider}의 최대 ${lim.maxImages}장을 넘습니다. 이 요청에서 ${total - lim.maxImages}장 이상 선택 해제하세요.`, { status: 409, details, recovery: '캐릭터 라이브러리의 선택은 바뀌지 않으며, 자동으로 빼거나 다른 이미지로 바꾸지 않습니다.' });
    return details;
  }

  /** Persist the reference assets attached to a project at creation (reopening a project keeps them). */
  async function snapshot(epId) {
    const ep = store.episodes.get(epId);
    const ids = [...new Set((ep.scenes || []).flatMap((s) => s.characters || []).concat(ep.characters || []))];
    const refAssets = {};
    ids.forEach((cid) => { const r = forCharacter(ep, '', cid); if (r.refId) refAssets[cid] = { refId: r.refId, assetId: r.assetId, assetIds: r.selected.map((x) => x.assetId), sha256: r.sha256 || '', status: r.status }; });
    await store.episodes.update(epId, (e) => { e.cast = Object.assign({}, e.cast, { refAssets, refAssetsAt: nowIso() }); });
    return refAssets;
  }

  /** This scene's own choice for one character: an ordered list of 1–3 approved images (first = primary). The library selection is untouched. */
  async function setSceneRef(epId, sceneId, cid, refIds, by = 'operator') {
    const ep = store.episodes.get(epId);
    const sc = (ep.scenes || []).find((x) => x.id === sceneId);
    if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sceneId, { status: 404 });
    if (!(sc.characters || []).includes(cid)) throw new StudioError('NOT_IN_SCENE', '이 장면에 등장하지 않는 캐릭터입니다.', { status: 409 });
    const ids = asList(refIds);
    if (!ids.length) throw new StudioError('BAD_SELECTION', '참조 이미지를 1장 이상 선택하세요 (기본으로 되돌리려면 "기본값"을 누르세요).', { status: 400 });
    if (new Set(ids).size !== ids.length) throw new StudioError('BAD_SELECTION', '같은 이미지가 두 번 선택되었습니다.', { status: 400 });
    if (ids.length > MAX_PER_CHARACTER) throw new StudioError('SELECTION_LIMIT', `캐릭터당 참조 이미지는 최대 ${MAX_PER_CHARACTER}장입니다 (선택 ${ids.length}장).`, { status: 409 });
    const c = charOf(cid);
    ids.forEach((refId) => {
      const ref = c && c.references.find((r) => r.id === refId);
      if (!ref) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다.', { status: 404 });
      if (!usable(ref)) throw new StudioError('REF_NOT_APPROVED', '승인된 실제 참조 이미지만 고를 수 있습니다.', { status: 409, recovery: '캐릭터 라이브러리에서 이미지를 승인하세요.' });
    });
    await store.episodes.update(epId, (e) => { e.sceneRefs = Object.assign({}, e.sceneRefs); e.sceneRefs[sceneId] = Object.assign({}, e.sceneRefs[sceneId], { [cid]: ids }); });
    store.episodes.audit(epId, 'scene.charref.set', { sceneId, characterId: cid, refIds: ids, by });
    return forScene(store.episodes.get(epId), sc);
  }
  async function clearSceneRef(epId, sceneId, cid, by = 'operator') {
    await store.episodes.update(epId, (e) => { const m = Object.assign({}, e.sceneRefs); if (m[sceneId]) { m[sceneId] = Object.assign({}, m[sceneId]); delete m[sceneId][cid]; } e.sceneRefs = m; });
    store.episodes.audit(epId, 'scene.charref.reset', { sceneId, characterId: cid, by });
    const ep = store.episodes.get(epId);
    return forScene(ep, ep.scenes.find((x) => x.id === sceneId));
  }

  /** For text-only models: written appearance only, and an honest statement that no image was seen. */
  function textNote(ep, characterIds) {
    const rows = [...new Set(characterIds || [])].map((cid) => { const c = charOf(cid); return c ? `- ${c.name} (${cid}): ${c.look || 'no written appearance yet'}` : null; }).filter(Boolean);
    return rows.length ? 'CHARACTER_APPEARANCE (written descriptions only — this text model has NOT been shown the reference images):\n' + rows.join('\n') : '';
  }

  /** True when the stored start frame was generated from other references than the scene currently resolves to. */
  function frameStale(ep, scene) {
    const si = scene.startImage;
    if (!si || !si.generated || !Array.isArray(si.characterRefs)) return false;
    const now = forScene(ep, scene).flatMap((r) => r.selected.map((x) => x.assetId)).sort().join(',');
    return si.characterRefs.map((r) => r.assetId || assetId(r.characterId, r.refId)).sort().join(',') !== now;
  }

  return { MAX_PER_CHARACTER, forCharacter, forScene, validate, inputsFor, enforce, snapshot, setSceneRef, clearSceneRef, textNote, frameStale, supports, assertProvider, missingMessage };
}

module.exports = { createCharRefs, missingMessage, REF_CAPABLE };
