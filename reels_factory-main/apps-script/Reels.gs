/**
 * Pure builders that turn validated Gemini output into REELS rows.
 */

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Returns `count` new reel IDs for a product, continuing after the highest existing one.
 * e.g. PRD-001 with existing [PRD-001-R01, PRD-001-R02] → [PRD-001-R03, ...].
 */
function nextReelIds(productId, existingIds, count) {
  const prefix = productId + '-R';
  let max = 0;
  existingIds.forEach(function (id) {
    const s = normalizeText(id);
    if (s.indexOf(prefix) !== 0) return;
    const suffix = s.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    const n = parseInt(suffix, 10);
    if (n > max) max = n;
  });
  const taken = {};
  existingIds.forEach(function (id) {
    taken[normalizeText(id)] = true;
  });
  const ids = [];
  let n = max;
  while (ids.length < count) {
    n += 1;
    const id = prefix + pad2_(n);
    if (!taken[id]) ids.push(id);
  }
  return ids;
}

/** Post-specific ManyChat keyword derived from the reel ID (e.g. PRD-001-R01 → PRD001R01). */
function buildManyChatKeyword(reelId) {
  return reelId.replace(/-/g, '');
}

function buildCta(keyword) {
  return '댓글에 "' + keyword + '" 남기면 상품 링크를 DM으로 보내드려요.';
}

function isPermissionApproved(permissionValue) {
  const v = normalizeText(permissionValue);
  return RF_CONFIG.PERMISSION_APPROVED_VALUES.indexOf(v) !== -1;
}

/** Normalised keyword entries: strings (product unknown) or { keyword, productId }. */
function keywordOwners_(existingKeywords) {
  const owners = {};
  existingKeywords.forEach(function (k) {
    const kw = normalizeText(typeof k === 'string' ? k : k.keyword).toUpperCase();
    if (!kw) return;
    (owners[kw] = owners[kw] || []).push(typeof k === 'string' ? '' : normalizeText(k.productId));
  });
  return owners;
}

function isInternalKeyword_(k) {
  return /^PRD\d+R\d+$/i.test(normalizeText(k));
}

function friendlyKeywordFor_(productId, existingKeywords, owners, suggested) {
  const mine = (existingKeywords || []).filter(function (k) {
    return k.productId === productId && !isInternalKeyword_(k.keyword);
  })[0];
  if (mine) return normalizeText(mine.keyword);
  const s = normalizeText(suggested);
  if (!s || commentKeywordError(s)) return '';
  const others = (owners[s.toUpperCase()] || []).filter(function (pid) {
    return pid !== productId;
  });
  return others.length ? '' : s;
}

/**
 * Builds REELS row objects keyed by REELS header names.
 * Keyword: PRODUCTS.'ManyChat 키워드' if the operator set one (shared by that product's reels),
 * otherwise a per-reel code (PRD001R01). Throws if an ID or keyword would collide with another product.
 */
function buildReelRecords(product, reels, existingIds, existingKeywords, meta) {
  const ids = nextReelIds(product.id, existingIds, reels.length);
  const owners = keywordOwners_(existingKeywords);
  // Customer-facing keyword (e.g. 우산): PRODUCTS column, else one this product already uses, else
  // Gemini's suggestion if no other product owns it. Internal codes (PRD001R01) only as a last resort.
  const productKeyword = normalizeText(product.keyword) || friendlyKeywordFor_(product.id, existingKeywords, owners, meta && meta.commentKeyword);
  const approved = isPermissionApproved(product.permission);

  return reels.map(function (reel, i) {
    const reelId = ids[i];
    const keyword = productKeyword || buildManyChatKeyword(reelId);
    const key = keyword.toUpperCase();
    const others = (owners[key] || []).filter(function (pid) {
      return !productKeyword || pid !== product.id;
    });
    if (others.length) {
      throw new Error('ManyChat 키워드 "' + keyword + '"가 이미 다른 릴스·상품에서 쓰이고 있습니다. 상품마다 다른 키워드를 쓰세요.');
    }
    (owners[key] = owners[key] || []).push(product.id);

    const notes = [];
    if (!approved) notes.push(RF_CONFIG.PERMISSION_UNVERIFIED_NOTE);
    if (!productKeyword) notes.push('댓글 키워드가 내부 코드입니다 — PRODUCTS "ManyChat 키워드"에 쉬운 단어(예: 우산)를 넣으세요.');
    notes.push('게시·DM 자동화 전 사람 검토 필요.');

    const record = {
      '릴스ID': reelId,
      '상품ID': product.id,
      '버전': i + 1,
      'Flow 생성': RF_CONFIG.FLOW_STATUS_MANUAL,
      'CTA': buildCta(keyword),
      'ManyChat 키워드': keyword,
      '광고 표기': RF_CONFIG.AFFILIATE_DISCLOSURE,
      '영상 사용 허가 상태': normalizeText(product.permission) || '미확인',
      '상태': RF_STATUS.SCRIPT_REVIEW_PENDING,
      '제작 상태': RF_STATUS_LABELS.SCRIPT_REVIEW_PENDING,
      '대본 버전': 1,
      '영상 버전': 0,
      '검토 메모': notes.join(' '),
      '생성 모델': meta.model,
      '생성일시': meta.generatedAt,
    };
    const cells = reelToScriptCells(reel);
    Object.keys(cells).forEach(function (k) {
      record[k] = cells[k];
    });
    // Optional columns (written only where 시트 준비 has added them).
    record['콘텐츠 기둥'] = pillarLabel(reel.pillar);
    // Five hook candidates + recommendation; the operator's choice is stored on selection.
    record['훅 후보(JSON)'] = meta && meta.hookSet ? JSON.stringify(meta.hookSet) : '';
    record['선택한 훅'] = '';
    const flags = formatVerificationFlags(verificationFlags(reel, reel.pillar));
    const asked = (Array.isArray(reel.needs_verification) ? reel.needs_verification : []).map(function (x) {
      return '[Gemini 요청] ' + normalizeText(x);
    }).filter(function (x) {
      return x.length > 13;
    });
    record['확인 필요'] = [flags].concat(asked).filter(Boolean).join('\n');
    if (record['확인 필요']) notes.push('확인 필요 항목이 있습니다 — 승인 전에 확인하세요.');
    record['검토 메모'] = notes.join(' ');
    return record;
  });
}

/**
 * Full pure pipeline: raw Gemini text → validated → REELS row objects.
 * Returns { errors: string[], records: object[] }.
 */
function prepareReelRecords(product, rawText, existingIds, existingKeywords, meta, options) {
  const parsed = parseModelJson(rawText);
  if (parsed.error) return { errors: [parsed.error], records: [], attempt: null };
  const result = validateGeminiReels(parsed.value, product, null, options);
  meta = Object.assign({}, meta, { hookSet: result.hookSet, commentKeyword: result.commentKeyword });
  // Kept so a later attempt can be combined with this one's valid reels (no extra paid call).
  const attempt = { reels: parsed.value && parsed.value.reels, reelErrors: result.reelErrors };
  // validation and payload let the caller rewrite only the hooks that need it (hookRevisionPlan).
  if (result.errors.length) return { errors: result.errors, records: [], attempt: attempt, validation: result, payload: parsed.value };
  return {
    errors: [],
    records: buildReelRecords(product, result.reels, existingIds, existingKeywords, meta),
    attempt: attempt,
    validation: result,
    payload: parsed.value,
  };
}
