// Product visual analysis: a vision-capable AI reads the product's reference images and writes an English PRODUCT STRUCTURE
// DESCRIPTION that the operator reviews, corrects and approves. The approved text travels with the product reference images into
// every scene image that shows the product (never instead of them).
//   * everything is versioned: analyses V1, V2 … (each bound to the product id and a numbered reference-IMAGE-SET version)
//   * a new analysis / an edit of an approved one is a NEW version; the approved version is never overwritten (approving another one supersedes it)
//   * the AI is asked to separate VISIBLE facts from uncertain ones; nothing is presented as verified unless the model marked it so, and the operator edits freely
//   * a sample (mock) answer can never be approved as-is — it is not an analysis of the product
//   * paid analysis needs the router's explicit cost confirmation (nothing here bills by itself)
'use strict';
const fs = require('node:fs');
const { StudioError, nowIso, sha256, canonical } = require('./util');

const MAX_ANALYSIS_IMAGES = 5;
const MAX_TEXT = 8000;
const MAX_ITEM = 400;
const SECTIONS = [
  ['shape', 'OVERALL SHAPE AND GEOMETRY'],
  ['components', 'EXACT VISIBLE COMPONENT COUNT'],
  ['color_material', 'COLORS AND MATERIAL APPEARANCE'],
  ['compartments', 'INTERNAL COMPARTMENTS AND DIVIDERS'],
  ['proportions', 'RELATIVE PROPORTIONS'],
  ['mounting', 'MOUNTING AND INSTALLATION FEATURES'],
  ['details', 'DISTINGUISHING VISUAL DETAILS'],
  ['labels_text', 'EXACT VISIBLE BRAND LOGO AND CONTROL LABELS'],
  ['usage', 'DOCUMENTED PRODUCT FUNCTIONS (WITH SOURCE AND UNCERTAINTY)'],
];
const FIXED_NEGATIVES = [
  'Do not change the number, size or arrangement of any component, compartment or divider listed above.',
  'Do not change the product colors, material finish or proportions.',
  'Do not add handles, buttons, logos, text, patterns, accessories or any feature that is not listed as verified.',
  'Do not redesign, restyle, simplify, merge or substitute a different product, and do not "improve" the product.',
];
const SAMPLE_MARK = '[SAMPLE — NOT AN ANALYSIS OF THIS PRODUCT]';

const SYSTEM = [
  'ROLE: Senior product research analyst and image-reference art director for a short-form shopping reel.',
  'INPUT: 1-5 product screenshots plus optional product name, product description and operator-confirmed specifications. Analyze all screenshots as one product. A screenshot may be a collage or contain sales claims. Never guess unreadable text.',
  'GOAL A — VISUAL LOCK: Precisely describe the product for consistent image generation: silhouette, proportions, finish, color, handles, lid, seams, control-panel geometry, screen, buttons, logo position and camera-view differences. Record exact visible Korean/English labels where legible; otherwise mark unreadable, never invent.',
  'GOAL B — FUNCTIONS: Separate visible controls/text, operator-provided verified specifications, and unverified marketing claims. A control label is not proof of a performance claim. Never infer hidden hardware, inner materials, safety certifications, speed, warranty or recipe quantities.',
  'GOAL C — CREATIVE VALUE: Identify visual details worth preserving and realistic everyday usage context. Do not confuse screenshot review quotes with manufacturer facts. Do not claim to have independently tested the product.',
  'EVIDENCE: For every item label status as "verified" only if directly visible in supplied photos or explicitly present in operator-confirmed specs; otherwise "uncertain". Include a concise source clue in each statement, e.g. "front close-up" or "provided specs".',
  'PRIORITY: PRODUCT ACCURACY over marketing language. Distinguish photograph content from claims printed on a page. Treat reviews as subjective accounts, not product facts.',
  'OUTPUT: English, concise but detailed; ONE JSON object (no markdown) exactly compatible with this schema:',
  '{"component_count":{"count":<integer or null>,"basis":"<what was counted>","certain":<true|false>},',
  ' "items":[{"section":"shape|components|color_material|compartments|proportions|mounting|details|labels_text|usage","statement":"<specific short sentence including source clue>","status":"verified|uncertain"}],',
  ' "not_visible":["<important unseen geometry or unreadable label>"],',
  ' "negative_constraints":["<product-specific generation mistake to avoid>"]}',
  'Provide 4-8 shape/details observations and 2-6 label/control observations when visible. If evidence is thin, return fewer items instead of hallucinating.',
  'Negative constraints must explicitly prevent hallucinated buttons, fake logos/text, altered lid/handle shapes and wrong colors. Do not put unsupported capabilities into verified items.',
].join('\n');

const clean = (v, n = MAX_ITEM) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function createProductAnalysis({ products, router, log = () => {} }) {
  const raw = (pid) => products.raw(pid);
  const live = (p) => (p.images || []).filter((i) => !i.removed && !['rejected', 'replaced'].includes(i.status));
  const setHash = (p, ids) => sha256(canonical(ids.slice().sort().map((id) => { const im = (p.images || []).find((x) => x.id === id); return im ? [im.id, im.sha256] : [id, null]; })));

  /** The images an analysis uses: the operator's choice, else the approved reference set, else approved originals, else usable originals (never AI-generated ones unless chosen). */
  function selectImages(p, requested) {
    const L = live(p);
    let ids;
    if (requested && requested.length) {
      requested.forEach((id) => { if (!L.some((i) => i.id === id)) throw new StudioError('BAD_IMAGE', `분석할 수 없는 이미지입니다 (없거나 거절/교체됨): ${id}`, { status: 422 }); });
      ids = Array.from(new Set(requested));
    } else {
      const set = p.referenceSet && !p.referenceSet.waived ? (p.referenceSet.imageIds || []).filter((id) => L.some((i) => i.id === id)) : [];
      ids = set.length ? set : L.filter((i) => i.status === 'approved' && i.kind !== 'ai_generated').map((i) => i.id);
      if (!ids.length) ids = L.filter((i) => i.kind !== 'ai_generated').map((i) => i.id);
    }
    if (!ids.length) throw new StudioError('NO_IMAGES', '분석할 제품 이미지가 없습니다. 먼저 제품 참조 이미지를 올리세요.', { status: 409, recovery: '제품 스튜디오 → 참조 이미지에서 이미지를 올리거나 붙여넣으세요.' });
    if (ids.length > MAX_ANALYSIS_IMAGES) ids = ids.slice(0, MAX_ANALYSIS_IMAGES);
    return ids;
  }

  /** Numbered version of an image SET (ids + content hashes). Same set → same number. Allocates (persists) only via registerImageSet. */
  const peekSetVersion = (p, ids) => { const h = setHash(p, ids); const r = (p.imageSets || []).find((x) => x.hash === h); return r ? r.v : null; };
  function allocSet(p, ids) {
    p.imageSets = p.imageSets || [];
    const h = setHash(p, ids);
    let r = p.imageSets.find((x) => x.hash === h);
    if (!r) { r = { v: p.imageSets.length + 1, hash: h, imageIds: ids.slice().sort(), imageHashes: ids.slice().sort().map((id) => { const im = p.images.find((x) => x.id === id); return { id, sha256: im ? im.sha256 : null }; }), at: nowIso() }; p.imageSets.push(r); }
    return r;
  }
  async function registerImageSet(pid, ids) {
    let out = null;
    await products.mutate(pid, (p) => { const r = allocSet(p, ids); out = { v: r.v, hash: r.hash }; });
    return out;
  }

  /** Do the analyzed images still exist unchanged? (a replaced / removed / rejected image makes the description stale) */
  function imagesIntact(p, a) {
    const L = live(p);
    return (a.imageHashes || []).every((h) => { const im = L.find((i) => i.id === h.id); return im && im.sha256 === h.sha256; });
  }
  /** Does the analysis cover the images that are attached to a request? */
  function covers(p, a, attachedIds) {
    const have = new Map((a.imageHashes || []).map((h) => [h.id, h.sha256]));
    return (attachedIds || []).every((id) => { const im = (p.images || []).find((x) => x.id === id); return im && have.get(id) === im.sha256; });
  }
  const approvedOf = (p) => (p.analyses || []).find((a) => a.v === p.analysisApprovedV && a.status === 'approved') || null;

  function present(p, a) {
    if (!a) return null;
    const intact = imagesIntact(p, a);
    return {
      v: a.v, status: a.status, text: a.text, sample: !!a.sample, source: a.source, basedOn: a.basedOn || null, edits: a.edits || 0, edited: a.text !== a.originalText,
      productId: p.id, imageSetVersion: a.imageSetVersion, imageIds: a.imageIds, intact,
      ai: a.ai || null, sections: a.sections || null, createdAt: a.createdAt, updatedAt: a.updatedAt, approvedAt: a.approvedAt || null, approvedBy: a.approvedBy || null,
    };
  }
  /** Everything the UI needs (free). */
  function view(pid) {
    const p = raw(pid);
    const list = (p.analyses || []).slice().sort((x, y) => y.v - x.v);
    const ap = approvedOf(p);
    let sel = [];
    try { sel = selectImages(p); } catch (_) { sel = []; }
    const route = router.routeFor('productUnderstanding');
    const approved = present(p, ap);
    const current = sel.length ? { imageIds: sel, imageSetVersion: peekSetVersion(p, sel), nextImageSetVersion: (p.imageSets || []).length + 1 } : null;
    const stale = !!(ap && (!imagesIntact(p, ap) || !covers(p, ap, sel.filter((id) => (p.referenceSet && p.referenceSet.imageIds || []).includes(id)))));
    return {
      productId: p.id, route: { provider: route.provider, model: route.model, mock: route.provider === 'mock' },
      approved, stale, staleReason: stale ? '분석한 이후 제품 이미지가 바뀌었습니다. 새 분석을 만들어 검토·승인하세요 (기존 승인본은 그대로 보존됩니다).' : '',
      versions: list.map((a) => present(p, a)), latest: present(p, list[0] || null), current,
      imageSets: (p.imageSets || []).map((r) => ({ v: r.v, imageIds: r.imageIds, at: r.at })),
      limits: { maxImages: MAX_ANALYSIS_IMAGES, maxText: MAX_TEXT },
    };
  }

  function userPrompt(p, ids) {
    const known = (p.specs || []).filter((s) => s.verified).slice(0, 20).map((s) => '- ' + String(s.text || '').slice(0, 300));
    const review = p.reviewResearch?.approved ? p.reviewResearch.analysis : null;
    return [
      'PRODUCT NAME (operator/retailer, not proof of visible label): ' + (p.name || '(unknown)'),
      'CATEGORY: ' + (p.category || '(unknown)'),
      'OPERATOR-CONFIRMED SPECS (source: operator; do not label as photo-visible):', ...(known.length ? known : ['none']),
      'PRODUCT DESCRIPTION (potential marketing claims; verify independently before promotion): ' + (p.description || '(none)').slice(0, 1400),
      'APPROVED CUSTOMER REVIEW THEMES (subjective research only, not verified product facts): ' + (review ? [review.summary, ...(review.pros || []), ...(review.cons || [])].filter(Boolean).join('; ').slice(0, 900) : '(none)'),
      'There are ' + ids.length + ' source product screenshots attached. Read their visible geometry, text and control layout before relying on product name or sales copy.',
      'Output the specified JSON, suitable for a precise image-reference description. If an image contains a collage, identify distinct viewpoints without assuming separate products.',
    ].join('\n');
  }
  function imageInputs(p, ids) {
    const files = products.imageFiles(p.id, ids);
    return files.map((f, i) => ({ label: `Product reference photo ${i + 1} of ${files.length} (id ${f.id}):`, mimeType: f.mimeType, data: fs.readFileSync(f.path).toString('base64') }));
  }
  function assertVision() {
    const r = router.routeFor('productUnderstanding');
    if (r.provider === 'mock') return r;
    let c = null;
    try { c = router.client(r.provider); } catch (_) { c = null; }
    if (!c || c.supportsImages === false) throw new StudioError('ANALYSIS_UNSUPPORTED', `선택한 AI(${r.provider}${r.model ? ' / ' + r.model : ''})는 이미지 입력을 지원하지 않아 제품 이미지를 분석할 수 없습니다. 이미지 없이 추측해서 설명을 만들지 않고 중단합니다.`, { status: 409, recovery: 'Settings → AI 연동에서 "제품 이해" 작업에 이미지를 읽을 수 있는 모델(예: Gemini)을 지정하세요.' });
    return r;
  }

  /** Free: what an analysis would use and cost. Nothing is sent. */
  function estimate(pid, { imageIds } = {}) {
    const p = raw(pid);
    const ids = selectImages(p, imageIds);
    const r = assertVision();
    const est = router.estimate('productUnderstanding', { inputChars: SYSTEM.length + userPrompt(p, ids).length, outputTokens: 2000, images: ids.length });
    return Object.assign({}, est, { productId: pid, imageIds: ids, count: 1, imageCount: ids.length, imageSetVersion: peekSetVersion(p, ids), nextImageSetVersion: (p.imageSets || []).length + 1, mock: r.provider === 'mock', note: `제품 이미지 ${ids.length}장 시각 분석 1회. ` + (est.note || '') });
  }

  /** Turn the model's JSON into the editable text. Throws (and saves nothing) when the answer is unusable. */
  function assemble(p, json, meta) {
    if (!json || typeof json !== 'object' || !Array.isArray(json.items)) throw new StudioError('BAD_ANALYSIS', 'AI가 올바른 형식의 분석을 돌려주지 않았습니다. 다시 시도하세요 (자동 재시도하지 않습니다).', { status: 502 });
    const items = json.items.map((it) => ({ section: SECTIONS.some((s) => s[0] === it.section) ? it.section : 'details', statement: clean(it.statement), status: it.status === 'verified' ? 'verified' : 'uncertain' })).filter((it) => it.statement).slice(0, 40);
    if (items.length < 3) throw new StudioError('BAD_ANALYSIS', 'AI의 분석 내용이 너무 적어 저장하지 않았습니다. 다시 시도하세요.', { status: 502 });
    const cc = json.component_count && typeof json.component_count === 'object' ? json.component_count : {};
    const count = Number.isInteger(cc.count) && cc.count >= 0 && cc.count <= 200 ? cc.count : null;
    const countCertain = count != null && cc.certain === true;
    const countLine = count == null ? '[UNCERTAIN] The exact component count could not be determined from the photos. ' + (clean(cc.basis) || '') : `[${countCertain ? 'VERIFIED' : 'UNCERTAIN'}] Visible component count: ${count}${clean(cc.basis) ? ' — ' + clean(cc.basis) : ''}`;
    const notVisible = (Array.isArray(json.not_visible) ? json.not_visible : []).map((x) => clean(x)).filter(Boolean).slice(0, 12);
    const negatives = (Array.isArray(json.negative_constraints) ? json.negative_constraints : []).map((x) => clean(x)).filter(Boolean).slice(0, 12);
    const lines = [`PRODUCT STRUCTURE DESCRIPTION — ${p.name || 'product'} (analysis v${meta.v}, reference image set V${meta.imageSetVersion}, ${meta.imageCount} photo${meta.imageCount === 1 ? '' : 's'})`,
      'Describes ONLY what is visible in the attached product reference photos. [VERIFIED] = clearly visible; [UNCERTAIN] = inferred or partly visible — do not treat as fact.'];
    SECTIONS.forEach(([key, title]) => {
      const own = items.filter((it) => it.section === key);
      const extra = key === 'components' ? [countLine] : [];
      if (!own.length && !extra.length) return;
      lines.push('', title);
      extra.forEach((l) => lines.push('- ' + l));
      own.forEach((it) => lines.push(`- [${it.status === 'verified' ? 'VERIFIED' : 'UNCERTAIN'}] ${it.statement}`));
    });
    if (notVisible.length) { lines.push('', 'NOT VISIBLE IN THE PHOTOS (do NOT draw or assume):'); notVisible.forEach((x) => lines.push('- ' + x)); }
    lines.push('', 'NEGATIVE CONSTRAINTS (prevent product morphing):');
    negatives.concat(FIXED_NEGATIVES).forEach((x) => lines.push('- ' + x));
    const text = lines.join('\n').slice(0, MAX_TEXT);
    return { text, sections: { items, componentCount: { count, certain: countCertain, basis: clean(cc.basis) }, notVisible, negatives } };
  }

  /** Paid (unless the AI task is routed to the free sample). A NEW version is saved; the approved version is untouched. */
  async function generate(pid, { imageIds, confirm } = {}) {
    const p0 = raw(pid);
    const ids = selectImages(p0, imageIds);
    assertVision();
    const images = imageInputs(p0, ids);
    const out = await router.run('productUnderstanding', { system: SYSTEM, prompt: userPrompt(p0, ids), images, json: true, maxTokens: 2500, confirm, dedupeKey: 'analysis:' + pid });
    let rec = null;
    await products.mutate(pid, (p) => {
      p.analyses = p.analyses || [];
      const set = allocSet(p, ids);
      const v = p.analyses.reduce((m, a) => Math.max(m, a.v), 0) + 1;
      let body;
      if (out.mock) {
        body = { text: [`PRODUCT STRUCTURE DESCRIPTION — ${p.name || 'product'} (analysis v${v}, reference image set V${set.v})`, SAMPLE_MARK, 'The AI task "제품 이해" is routed to the free sample, so no real image analysis ran. Replace this text with a description you verified yourself, or connect a vision AI in Settings and analyze again.'].join('\n'), sections: null, sample: true };
      } else body = Object.assign(assemble(p, out.json, { v, imageSetVersion: set.v, imageCount: ids.length }), { sample: false });
      p.analyses.forEach((a) => { if (a.status === 'draft') a.status = 'superseded'; }); // older unapproved drafts are history; the approved one is untouched
      rec = { v, productId: pid, status: 'draft', source: 'ai', basedOn: null, sample: body.sample, text: body.text, originalText: body.text, sections: body.sections, imageSetVersion: set.v, imageSetHash: set.hash, imageIds: ids.slice(), imageHashes: ids.map((id) => { const im = p.images.find((x) => x.id === id); return { id, sha256: im ? im.sha256 : null }; }),
        ai: { provider: out.provider, model: out.model, mock: !!out.mock, usage: out.usage || null, at: nowIso() }, edits: 0, createdAt: nowIso(), updatedAt: nowIso() };
      p.analyses.push(rec);
    });
    log('product.analysis.generated', { productId: pid, v: rec.v, provider: rec.ai.provider });
    return view(pid);
  }

  /** The operator corrects the text. A draft is edited in place; an approved/superseded version is never changed — the edit becomes a NEW draft. */
  async function edit(pid, v, text, by = 'operator') {
    const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
    if (!t) throw new StudioError('EMPTY_TEXT', '설명이 비어 있습니다.', { status: 422 });
    if (t.length > MAX_TEXT) throw new StudioError('TEXT_TOO_LONG', `설명은 ${MAX_TEXT}자 이하여야 합니다.`, { status: 422 });
    let outV = v;
    await products.mutate(pid, (p) => {
      const a = (p.analyses || []).find((x) => x.v === Number(v));
      if (!a) throw new StudioError('NOT_FOUND', `분석 v${v}을(를) 찾을 수 없습니다.`, { status: 404 });
      if (t === a.text) return;
      if (a.status === 'draft') { a.text = t; a.edits = (a.edits || 0) + 1; a.updatedAt = nowIso(); a.editedBy = by; return; }
      const nv = p.analyses.reduce((m, x) => Math.max(m, x.v), 0) + 1;
      p.analyses.forEach((x) => { if (x.status === 'draft') x.status = 'superseded'; });
      // the heading names its own version: keep it truthful for the copy (the operator's other edits are untouched)
      const retitled = t.replace(new RegExp(`\\(analysis v${a.v}\\b`), `(analysis v${nv}`);
      p.analyses.push(Object.assign({}, a, { v: nv, status: 'draft', source: 'edit', basedOn: a.v, text: retitled, originalText: a.text, edits: 1, editedBy: by, sample: false, approvedAt: undefined, approvedBy: undefined, approvedTextSha: undefined, createdAt: nowIso(), updatedAt: nowIso() }));
      outV = nv;
    });
    return Object.assign(view(pid), { editedV: outV });
  }

  async function approve(pid, v, by = 'operator') {
    await products.mutate(pid, (p) => {
      const a = (p.analyses || []).find((x) => x.v === Number(v));
      if (!a) throw new StudioError('NOT_FOUND', `분석 v${v}을(를) 찾을 수 없습니다.`, { status: 404 });
      if (a.status === 'approved') return;
      if (a.sample && a.text === a.originalText) throw new StudioError('SAMPLE_NOT_APPROVABLE', '샘플 응답은 실제 이미지 분석이 아니므로 그대로 승인할 수 없습니다. 직접 확인한 내용으로 고쳐 쓰거나, 비전 AI로 분석하세요.', { status: 409 });
      if (/\[SAMPLE — NOT AN ANALYSIS/.test(a.text)) throw new StudioError('SAMPLE_NOT_APPROVABLE', '샘플 표시가 남아 있습니다. 샘플 문구를 지우고 직접 확인한 설명으로 고친 뒤 승인하세요.', { status: 409 });
      if (!imagesIntact(p, a)) throw new StudioError('ANALYSIS_STALE', `이 분석(v${a.v})을 만든 뒤 제품 이미지가 바뀌었습니다. 새로 분석한 뒤 승인하세요.`, { status: 409, recovery: '제품 이미지가 바뀌었으므로 "새로 분석하기"를 누르세요.' });
      p.analyses.forEach((x) => { if (x.status === 'approved') x.status = 'superseded'; });
      a.status = 'approved'; a.approvedAt = nowIso(); a.approvedBy = by; a.approvedTextSha = sha256(a.text); a.updatedAt = nowIso();
      p.analysisApprovedV = a.v;
    });
    log('product.analysis.approved', { productId: pid, v: Number(v) });
    return view(pid);
  }

  /**
   * What a scene image request gets: the approved description as prompt text — ONLY together with the actual attached product images.
   * Returns { block, record, warnings }. Never writes anything (the caller registers the image set when it really generates).
   */
  function contextFor(pid, attachedIds) {
    const p = raw(pid);
    const ids = (attachedIds || []).slice();
    const a = approvedOf(p);
    const base = { productId: pid, referenceImageIds: ids, referenceImageSetVersion: peekSetVersion(p, ids), structureVersion: null, structureTextSha: null, structureImageSetVersion: null, structureStale: false };
    if (!ids.length) return { block: '', record: base, warnings: [] }; // text alone never replaces the images
    if (!a) return { block: '', record: base, warnings: ['제품 구조 설명이 아직 승인되지 않았습니다 (제품 스튜디오에서 분석·승인하면 자동으로 포함됩니다).'] };
    const stale = !covers(p, a, ids);
    const header = `APPROVED PRODUCT STRUCTURE DESCRIPTION (v${a.v}, from product reference image set V${a.imageSetVersion}). The attached product reference image(s) are the PRIMARY source of truth; this text adds precision. If they ever disagree, follow the images. Do not add any feature that is not listed as verified.`;
    return { block: header + '\n' + a.text, record: Object.assign(base, { structureVersion: a.v, structureTextSha: sha256(a.text), structureImageSetVersion: a.imageSetVersion, structureStale: stale }),
      warnings: stale ? [`승인된 제품 구조 설명(v${a.v})은 현재 첨부된 제품 이미지와 다른 이미지 세트(V${a.imageSetVersion})로 만들어졌습니다. 새로 분석하는 것을 권장합니다.`] : [] };
  }

  return { view, estimate, generate, edit, approve, contextFor, registerImageSet, peekSetVersion, selectImages, SYSTEM, SECTIONS, FIXED_NEGATIVES, SAMPLE_MARK, MAX_ANALYSIS_IMAGES };
}

module.exports = { createProductAnalysis, SAMPLE_MARK };
