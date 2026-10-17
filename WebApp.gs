/**
 * iPhone-first approval dashboard (Apps Script HTML Service web app).
 *
 * Access model (see docs/iphone-dashboard.md):
 * - Deploy as web app with "Execute as: User accessing the web app" and "Who has access: Only myself"
 *   (or "Anyone with a Google account" for a team), so Google signs the user in.
 * - Every api* function additionally checks the signed-in email against Script Property RF_REVIEWERS.
 * - The Gemini API key never leaves the server. Affiliate URLs are returned only in the publishing pack
 *   of a READY_TO_PUBLISH reel.
 * - Google Sheets stays the system of record: every decision is written to REELS and AUDIT.
 */

const RF_CLIENT_ACTIONS = [
  'APPROVE_SCRIPT',
  'REQUEST_SCRIPT_CHANGES',
  'EDIT_SCRIPT',
  'REJECT_SCRIPT',
  'REOPEN_SCRIPT',
  'CONFIRM_MEDIA_RIGHTS',
  'START_VIDEO',
  'REGISTER_VIDEO',
  'MARK_VIDEO_FAILED',
  'APPROVE_VIDEO',
  'REQUEST_VIDEO_CHANGES',
  'REJECT_VIDEO',
  'MARK_READY_TO_PUBLISH',
  'CONFIRM_PUBLISHED',
  'CONFIRM_MANYCHAT',
  'GENERATE_STORYBOARD_IMAGES',
  'REVIEW_STORYBOARD_IMAGE',
  'REGENERATE_STORYBOARD_IMAGE',
  'RECOVER_STORYBOARD_IMAGE',
];

function doGet() {
  let html;
  try {
    requireReviewer_();
    html = typeof RF_DASHBOARD_HTML !== 'undefined'
      ? RF_DASHBOARD_HTML
      : HtmlService.createHtmlOutputFromFile('Dashboard').getContent();
  } catch (e) {
    html = '<!doctype html><meta charset="utf-8"><body style="font:16px -apple-system,sans-serif;padding:24px">' +
      '<h2>접근할 수 없습니다</h2><p>' + escapeHtml_(e.message) + '</p></body>';
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('릴스 팩토리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function reviewerList_() {
  const raw = PropertiesService.getScriptProperties().getProperty(RF_CONFIG.REVIEWERS_PROPERTY) || '';
  return raw
    .split(',')
    .map(function (e) {
      return normalizeText(e).toLowerCase();
    })
    .filter(function (e) {
      return e.length > 0;
    });
}

/** Throws unless the signed-in Google account is listed in RF_REVIEWERS. Returns the email. */
function requireReviewer_() {
  const list = reviewerList_();
  if (!list.length) {
    throw new Error('검토자가 등록되지 않았습니다. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행해 본인 계정을 등록하세요.');
  }
  const email = currentUserEmail_().toLowerCase();
  if (!email) {
    throw new Error('Google 계정을 확인할 수 없습니다. 웹 앱을 "실행 사용자: 웹 앱에 액세스하는 사용자"로 배포했는지 확인하세요.');
  }
  if (list.indexOf(email) === -1) {
    throw new Error('이 계정(' + email + ')은 검토 권한이 없습니다. 소유자가 스크립트 속성 RF_REVIEWERS에 추가해야 합니다.');
  }
  return email;
}

/** Adds the current user to RF_REVIEWERS. Returns a report line for 시트 준비. */
function registerSelfAsReviewer_() {
  const email = currentUserEmail_().toLowerCase();
  if (!email) return '✗ 대시보드 검토자: 현재 Google 계정 이메일을 확인할 수 없습니다.';
  const list = reviewerList_();
  if (list.indexOf(email) === -1) {
    list.push(email);
    PropertiesService.getScriptProperties().setProperty(RF_CONFIG.REVIEWERS_PROPERTY, list.join(','));
  }
  return '✓ 대시보드 검토자: ' + list.join(', ');
}

/** Menu: shows the deployed dashboard URL to open on iPhone. */
function showDashboardLink() {
  const ui = SpreadsheetApp.getUi();
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }
  if (!url) {
    ui.alert(
      '대시보드가 아직 배포되지 않았습니다.\n\nApps Script 편집기 → 배포 → 새 배포 → 유형: 웹 앱\n' +
        '실행 사용자: 웹 앱에 액세스하는 사용자 / 액세스 권한: 나만\n\n자세한 방법: docs/iphone-dashboard.md'
    );
    return;
  }
  const safe = escapeHtml_(url);
  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<p style="font:14px sans-serif">iPhone Safari에서 이 링크를 열고 <b>공유 → 홈 화면에 추가</b>를 누르세요.</p>' +
        '<p style="font:14px sans-serif;word-break:break-all"><a href="' + safe + '" target="_blank">' + safe + '</a></p>'
    ).setWidth(420).setHeight(180),
    'iPhone 대시보드 링크'
  );
}

/** Wraps an API call: auth check, error → { ok:false, error }, and Date → string for google.script.run. */
function api_(fn) {
  try {
    const user = requireReviewer_();
    const result = fn(user);
    return JSON.parse(JSON.stringify(Object.assign({ ok: true, user: user }, result || {})));
  } catch (e) {
    const errText = (e && e.stack) ? e.stack : (e && e.message ? e.message : String(e));
    console.error('[API Error] ' + errText);
    logEvent_('ERROR', 'api', '', (e && e.message) || String(e), errText);
    return { ok: false, error: e.message };
  }
}

function productFromRecord_(rec) {
  const f = Object.assign({}, RF_CONFIG.PRODUCT_FIELDS, RF_CONFIG.PRODUCT_OPTIONAL_FIELDS);
  const p = { rowNumber: rec._row };
  Object.keys(f).forEach(function (k) {
    p[k] = rec[f[k]];
  });
  p.id = normalizeText(p.id);
  return p;
}

/** Loads PRODUCTS and REELS as plain objects. */
function loadData_(ss) {
  const f = RF_CONFIG.PRODUCT_FIELDS;
  const productsSheet = getProductsSheet_(ss);
  const productHeaders = Object.keys(f).map(function (k) {
    return f[k];
  });
  requireHeaders_(productsSheet, productHeaders);
  const optionalHeaders = Object.keys(RF_CONFIG.PRODUCT_OPTIONAL_FIELDS).map(function (k) {
    return RF_CONFIG.PRODUCT_OPTIONAL_FIELDS[k];
  });
  const products = readRecords_(productsSheet, productHeaders.concat(optionalHeaders))
    .map(productFromRecord_)
    .filter(function (p) {
      return p.id;
    });
  const byId = {};
  products.forEach(function (p) {
    byId[p.id] = byId[p.id] ? 'DUPLICATE' : p;
  });

  const warnings = [];
  let hookColumnsMissing = true;
  let productionColumnsMissing = RF_CONFIG.REELS_PRODUCTION_HEADERS.slice();
  let mediaColumnsMissing = RF_CONFIG.REELS_MEDIA_HEADERS.slice();
  let imageColumnsMissing = RF_CONFIG.REELS_IMAGE_HEADERS.slice();
  const reelsSheet = findSheet_(ss, RF_CONFIG.SHEETS.REELS);
  let reels = [];
  if (reelsSheet && reelsSheet.getLastColumn() > 0) {
    const missing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HEADERS);
    if (missing.length) {
      warnings.push('REELS 시트에 승인 관리용 헤더가 없습니다 (' + missing.length + '개). Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행하세요.');
    }
    hookColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HOOK_HEADERS).length > 0;
    productionColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_PRODUCTION_HEADERS);
    mediaColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_MEDIA_HEADERS);
    imageColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_IMAGE_HEADERS);
    if (!missing.length && missingHeaders_(reelsSheet, RF_CONFIG.REELS_OPTIONAL_HEADERS).length) {
      warnings.push('REELS에 브랜드·훅·제작 열(' + missingHeaders_(reelsSheet, RF_CONFIG.REELS_OPTIONAL_HEADERS).join(', ') + ')이 없습니다. "릴스 팩토리 → 시트 준비"를 실행하세요 — 훅 5개 저장·대본 승인·제작 계획에 필요합니다. 기존 데이터는 바뀌지 않습니다.');
    }
    reels = readRecords_(reelsSheet, RF_CONFIG.REELS_HEADERS.concat(RF_CONFIG.REELS_OPTIONAL_HEADERS)).filter(function (r) {
      return normalizeText(r['릴스ID']);
    });
  }
  return { products: products, productById: byId, reels: reels, reelsSheet: reelsSheet, warnings: warnings, hookColumnsMissing: hookColumnsMissing, productionColumnsMissing: productionColumnsMissing, mediaColumnsMissing: mediaColumnsMissing, imageColumnsMissing: imageColumnsMissing,
    referenceColumnPresent: !!colOf_(getHeaderMap_(productsSheet), RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages) };
}

function findReel_(data, reelId) {
  const matches = data.reels.filter(function (r) {
    return normalizeText(r['릴스ID']) === reelId;
  });
  if (!matches.length) throw new Error('REELS에서 릴스ID "' + reelId + '"를 찾을 수 없습니다.');
  if (matches.length > 1) throw new Error('REELS에 릴스ID "' + reelId + '"가 여러 번 있습니다. 시트에서 중복을 정리하세요.');
  const row = matches[0];
  const product = data.productById[normalizeText(row['상품ID'])];
  if (!product) throw new Error('PRODUCTS에서 상품ID "' + row['상품ID'] + '"를 찾을 수 없습니다.');
  if (product === 'DUPLICATE') throw new Error('PRODUCTS에 상품ID "' + row['상품ID'] + '"가 여러 번 있습니다.');
  return { row: row, product: product };
}

function reelSummary_(row, data) {
  const status = reelStatus(row);
  const product = data.productById[normalizeText(row['상품ID'])];
  return {
    reelId: normalizeText(row['릴스ID']),
    productId: normalizeText(row['상품ID']),
    productName: product && product !== 'DUPLICATE' ? normalizeText(product.name) : '',
    variant: row['버전'],
    status: status,
    statusLabel: RF_STATUS_LABELS[status] || '상태 확인 필요',
    concept: cellText_(row['컨셉']),
    hook: cellText_(row['후킹']),
    pillar: pillarLabel(pillarIdOf(row['콘텐츠 기둥'])),
    scriptVersion: scriptVersionOf(row),
    videoVersion: videoVersionOf(row),
    error: cellText_(row['오류']),
  };
}

function hookView_(row, status, columnsMissing, product, avoidHooks) {
  const set = parseHookSet(row['훅 후보(JSON)']);
  const selected = parseSelectedHook(row['선택한 훅']);
  const current = normalizeText(row['후킹']);
  const reviewing = RF_ACTIONS.SELECT_HOOK.from.indexOf(status) !== -1;
  const valid = !!(selected && normalizeText(selected.text) === current && Number(selected.scriptVersion) === scriptVersionOf(row));
  return {
    candidates: set.hooks,
    recommended: set.recommended,
    selected: selected,
    selectionValid: valid,
    // Every script under review needs one of five hooks chosen by the operator before approval.
    required: true,
    columnsMissing: !!columnsMissing,
    canGenerate: reviewing && !columnsMissing,
    canSelect: reviewing && !columnsMissing && set.hooks.length > 0,
    scriptVersion: scriptVersionOf(row),
    types: RF_CONFIG.HOOK_TYPES,
    // Style warnings per hook id (never block; the operator may edit, select, or ask Gemini to improve one).
    warnings: product ? hookSetWarnings(set, product, avoidHooks || []) : {},
    // Warnings for the chosen wording when the operator edited it.
    selectedWarnings: product && selected && selected.id && RF_CONFIG.HOOK_TYPES[selected.id] && selected.edited
      ? hookWarnings(selected.id, selected.text, product, [])
      : [],
    canRevise: reviewing && !columnsMissing && set.hooks.length > 0,
  };
}

/** Brand settings the dashboard shows (name, tagline, pillars with targets, current focus). */
function brandSummary_() {
  const B = RF_CONFIG.BRAND;
  return {
    name: B.NAME,
    tagline: B.TAGLINE,
    focus: B.CURRENT_FOCUS,
    aiLabel: B.AI_LABEL,
    pillars: Object.keys(B.PILLARS).map(function (id) {
      return { id: id, label: B.PILLARS[id].label, target: B.PILLARS[id].target };
    }),
  };
}

/** Reels per content pillar vs the editorial targets (planning aid, not a rule). */
function pillarMix_(reels) {
  const counts = {};
  let tagged = 0;
  reels.forEach(function (r) {
    const id = pillarIdOf(r['콘텐츠 기둥']);
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
    tagged++;
  });
  return brandSummary_().pillars.map(function (p) {
    return { id: p.id, label: p.label, target: p.target, count: counts[p.id] || 0, share: tagged ? Math.round(((counts[p.id] || 0) * 100) / tagged) : 0 };
  });
}

function allowedActions_(status) {
  return RF_CLIENT_ACTIONS.filter(function (a) {
    return RF_ACTIONS[a] && RF_ACTIONS[a].from && RF_ACTIONS[a].from.indexOf(status) !== -1;
  });
}

function parseFlowScenePrompts_(row) {
  try {
    const v = JSON.parse(cellText_(row['Flow 장면 프롬프트']) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function reelDetail_(ss, reelId) {
  const data = loadData_(ss);
  const found = findReel_(data, reelId);
  const row = found.row;
  const product = found.product;
  const status = reelStatus(row);
  const reel = rowToReel(row);
  const fileId = parseDriveFileId(row['영상 파일 URL']);

  const auditSheet = findSheet_(ss, RF_CONFIG.SHEETS.AUDIT);
  const history = auditSheet && auditSheet.getLastColumn() > 0
    ? readRecords_(auditSheet, RF_CONFIG.AUDIT_HEADERS)
        .filter(function (a) {
          return normalizeText(a['릴스ID']) === reelId ||
            (!normalizeText(a['릴스ID']) && normalizeText(a['상품ID']) === product.id);
        })
        .slice(-40)
        .reverse()
        .map(function (a) {
          return {
            at: a['일시'],
            action: a['작업'],
            label: (RF_ACTIONS[a['작업']] && RF_ACTIONS[a['작업']].label) || a['작업'],
            to: RF_STATUS_LABELS[a['새 상태']] || a['새 상태'],
            scriptVersion: a['대본 버전'],
            videoVersion: a['영상 버전'],
            actor: a['작업자'],
            note: a['메모'],
          };
        })
    : [];

  return {
    summary: reelSummary_(row, data),
    reel: reel,
    scenesInvalid: !reel.scenes,
    cta: cellText_(row['CTA']),
    keyword: cellText_(row['ManyChat 키워드']),
    disclosure: cellText_(row['광고 표기']),
    flowPrompts: cellText_(row['Flow 프롬프트']),
    flowScenePrompts: parseFlowScenePrompts_(row),
    flowStatus: cellText_(row['Flow 생성']),
    approvedVersion: cellText_(row['승인 대본 버전']),
    approvedIntact: isApprovedScriptIntact(row),
    scriptReview: { by: cellText_(row['대본 검토자']), at: row['대본 검토일시'], note: cellText_(row['대본 검토 메모']) },
    videoReview: { by: cellText_(row['영상 검토자']), at: row['영상 검토일시'], note: cellText_(row['영상 검토 메모']) },
    video: fileId ? { url: driveViewUrl(fileId), previewUrl: drivePreviewUrl(fileId) } : null,
    product: {
      id: product.id,
      name: normalizeText(product.name),
      facts: parseConfirmedFeatures(product.features),
      target: normalizeText(product.target),
      permission: normalizeText(product.permission) || '미입력',
      permissionOk: isPermissionApproved(product.permission),
      affiliateUrlOk: !affiliateUrlError(product.affiliateUrl),
    },
    touchpoints: touchpointSummary(row, product),
    allowedActions: allowedActions_(status),
    canRegenerate: status === 'SCRIPT_CHANGES_REQUESTED',
    pillar: { id: reel.pillar, label: pillarLabel(reel.pillar) },
    // Five hooks (H1–H5), Gemini's recommendation, and the operator's choice (with script version).
    hooks: hookView_(row, status, data.hookColumnsMissing, product, productHooksExcept_(data, product.id, normalizeText(row['릴스ID']))),
    pillars: brandSummary_().pillars,
    // Gemini's production plan (after approval), Drive folder and clip tracker.
    production: productionView_(row, product, data.productionColumnsMissing),
    // 9:16 Storyboard images via Gemini 2.5 Flash Image and manual Google Flow handoff
    storyboard: storyboardView_(row, product, data),
    // Reference photos, per-scene clip uploads and review (the final render needs every clip approved).
    media: mediaView_(row, product, data),
    // Recomputed from the current script, so an edit made in the sheet is reflected too.
    verificationFlags: reel.scenes ? verificationLines_(reel, reel.pillar, row) : [],
    brand: brandSummary_(),
    history: history,
    warnings: data.warnings,
  };
}

function updateProductPermission_(ss, productId, value) {
  try {
    const sheet = getProductsSheet_(ss);
    const rowNumber = findProductRow_(sheet, productId);
    const map = getHeaderMap_(sheet);
    const col = colOf_(map, RF_CONFIG.PRODUCT_FIELDS.permission);
    if (col) {
      sheet.getRange(rowNumber, col, 1, 1).setValues([[value]]);
    }
  } catch (e) {
    // Non-fatal if sheet row cannot be updated
  }
}

/** Plans and writes one transition (caller holds the lock). Returns the plan. */
function applyTransition_(ss, reelId, action, input, actor) {
  const data = loadData_(ss);
  const found = findReel_(data, reelId);
  if (action === 'CONFIRM_MEDIA_RIGHTS' || (action === 'START_VIDEO' && input && input.rightsConfirmed === true)) {
    updateProductPermission_(ss, found.product.id, '자체 제작');
    found.product.permission = '자체 제작';
  }
  const plan = planTransition(found.row, found.product, action, input, { actor: actor, now: new Date() });
  if (!plan.noop) {
    updateRecord_(data.reelsSheet, found.row._row, plan.updates);
    appendAudit_(ss, [plan.audit]);
  }
  return plan;
}

function withLock_(fn) {
  const lock = getLock_();
  if (!lock.tryLock(20000)) throw new Error('다른 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- API (google.script.run)

function apiGetDashboard() {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = loadData_(ss);
    const reelCount = {};
    data.reels.forEach(function (r) {
      const id = normalizeText(r['상품ID']);
      reelCount[id] = (reelCount[id] || 0) + 1;
    });
    return {
      warnings: data.warnings,
      products: data.products.map(function (p) {
        return {
          id: p.id,
          name: normalizeText(p.name),
          factsCount: parseConfirmedFeatures(p.features).length,
          affiliateUrlOk: !affiliateUrlError(p.affiliateUrl),
          permission: normalizeText(p.permission) || '미입력',
          permissionOk: isPermissionApproved(p.permission),
          reelCount: reelCount[p.id] || 0,
          duplicate: data.productById[p.id] === 'DUPLICATE',
        };
      }),
      reels: data.reels.map(function (r) {
        return reelSummary_(r, data);
      }),
      brand: brandSummary_(),
      pillarMix: pillarMix_(data.reels),
      codeVersion: RF_CONFIG.CODE_VERSION,
    };
  });
}

function apiGetReel(reelId) {
  return api_(function () {
    return { detail: reelDetail_(SpreadsheetApp.getActiveSpreadsheet(), normalizeText(reelId)) };
  });
}

function apiAction(reelId, action, input) {
  return api_(function (user) {
    if (RF_CLIENT_ACTIONS.indexOf(action) === -1) throw new Error('허용되지 않은 작업입니다: ' + action);
    if (action === 'GENERATE_STORYBOARD_IMAGES') {
      const res = apiGenerateStoryboardImages(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    if (action === 'REVIEW_STORYBOARD_IMAGE') {
      const res = apiReviewStoryboardImage(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    if (action === 'REGENERATE_STORYBOARD_IMAGE') {
      const res = apiRegenerateStoryboardImage(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    if (action === 'RECOVER_STORYBOARD_IMAGE') {
      const res = apiRecoverStoryboardImage(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    let notice = '';
    const plan = withLock_(function () {
      const p = applyTransition_(ss, id, action, input || {}, user);
      // A video approval immediately tries to prepare publishing; missing prerequisites are recorded, not hidden.
      if (action === 'APPROVE_VIDEO' && !p.noop) {
        try {
          applyTransition_(ss, id, 'MARK_READY_TO_PUBLISH', {}, 'system');
        } catch (e) {
          const data = loadData_(ss);
          const found = findReel_(data, id);
          updateRecord_(data.reelsSheet, found.row._row, { '오류': e.message });
          appendAudit_(ss, [{
            '일시': new Date(),
            '릴스ID': id,
            '상품ID': found.row['상품ID'],
            '작업': 'READY_TO_PUBLISH_BLOCKED',
            '이전 상태': 'VIDEO_APPROVED',
            '새 상태': 'VIDEO_APPROVED',
            '대본 버전': scriptVersionOf(found.row),
            '영상 버전': videoVersionOf(found.row),
            '작업자': 'system',
            '메모': e.message,
          }]);
          notice = '영상은 승인되었지만 게시 준비를 마치지 못했습니다:\n' + e.message;
        }
      }
      return p;
    });
    return {
      noop: plan.noop,
      notice: notice || (plan.noop ? '이미 처리된 요청입니다.' : ''),
      detail: reelDetail_(ss, id),
    };
  });
}

/** Rewrites one script with Gemini after "수정 요청". One paid call (plus one corrective retry). */
function apiRegenerateScript(reelId, input) {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if (status !== 'SCRIPT_CHANGES_REQUESTED' || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      const current = rowToReel(found.row);
      const note = cellText_(found.row['대본 검토 메모']);
      let lastErrors = [];
      let lastRaw = '';
      let newReel = null;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !newReel; attempt++) {
        // Rewrites the script only; the five hooks stay as they are.
        const raw = callGemini_(buildRegenerationPrompt(found.product, current, note, lastErrors, lastRaw), geminiResponseSchema(1, false));
        const parsed = parseModelJson(raw);
        const result = parsed.error ? { errors: [parsed.error] } : validateGeminiReels(parsed.value, found.product, 1, { requireHooks: false });
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'regenerateScript', found.product.id, id + ' 재생성 검증 실패 (시도 ' + attempt + ')',
            result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          newReel = result.reels[0];
        }
      }
      if (!newReel) {
        throw new Error('재생성된 대본이 검증을 통과하지 못했습니다. 대본은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      }
      applyTransition_(ss, id, 'REGENERATE_SCRIPT', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        reel: newReel,
        note: note,
      }, 'Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Touchpoint 2: the operator picks one of the five hooks (input.hookId), optionally edits it
 * (input.text), and either keeps the script with that hook line swapped in (mode 'keep', free) or has
 * Gemini rewrite the script around it (mode 'regenerate', one paid call + at most one retry).
 * The choice is stored in REELS "선택한 훅" with the script version and recorded in AUDIT.
 */
function apiSelectHook(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      if (RF_ACTIONS.SELECT_HOOK.from.indexOf(status) === -1) {
        throw new Error('훅은 대본 검토 중에만 고를 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + '). 승인된 대본은 "대본 승인 취소" 후 바꾸세요.');
      }
      const set = parseHookSet(found.row['훅 후보(JSON)']);
      const base = set.hooks.filter(function (h) {
        return h.id === input.hookId;
      })[0];
      if (!base) throw new Error('이 대본의 훅 후보에서 ' + (input.hookId || '훅') + '을(를) 찾을 수 없습니다.');
      const text = normalizeText(input.text || base.text);
      // Fact check before any paid call.
      const hookErrors = hookTextErrors(text, found.product);
      if (hookErrors.length) throw new Error('이 훅은 쓸 수 없습니다:\n- ' + hookErrors.join('\n- '));
      let reel = null;
      if (input.mode === 'regenerate') {
        const current = rowToReel(found.row);
        let lastErrors = [];
        let lastRaw = '';
        for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !reel; attempt++) {
          const raw = callGemini_(buildHookScriptPrompt(found.product, current, text, lastErrors, lastRaw), geminiResponseSchema(1, false));
          const parsed = parseModelJson(raw);
          const result = parsed.error ? { errors: [parsed.error] } : validateGeminiReels(parsed.value, found.product, 1, { requireHooks: false, fixedHook: text });
          if (result.errors.length) {
            lastErrors = result.errors;
            lastRaw = raw;
            logEvent_('WARN', 'selectHook', found.product.id, id + ' 훅 기반 재작성 검증 실패 (시도 ' + attempt + ')',
              result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
          } else {
            reel = result.reels[0];
          }
        }
        if (!reel) throw new Error('선택한 훅으로 다시 쓴 대본이 검증을 통과하지 못했습니다. 대본과 훅 선택은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      }
      applyTransition_(ss, id, 'SELECT_HOOK', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        hookId: base.id,
        text: text,
        reel: reel,
        note: input.note,
      }, user + (reel ? ' + Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')' : ''));
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Touchpoint 2: five hooks (with their opening scenes) for a script that has none — e.g. a script
 * written before the five-hook workflow. One Gemini call (+ at most one corrective retry). The script is
 * not changed; the operator then chooses a hook. Text only — no paid media.
 */
function apiGenerateHooks(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      if (data.hookColumnsMissing) {
        throw new Error('REELS에 훅 저장 열(' + RF_CONFIG.REELS_HOOK_HEADERS.join(', ') + ')이 없습니다. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 먼저 실행하세요. Gemini는 호출하지 않았습니다.');
      }
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      if (RF_ACTIONS.SET_HOOKS.from.indexOf(status) === -1) {
        throw new Error('훅은 대본 검토 중에만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      const current = rowToReel(found.row);
      if (!current.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. "수정 요청" 후 재생성하세요.');
      // Hooks already used for this product (other reels) are avoided; this script's own hook may return.
      const avoid = productHooksExcept_(data, found.product.id, id);
      let lastErrors = [];
      let lastRaw = '';
      let hookSet = null;
      let calls = 0;
      const maxCalls = RF_CONFIG.MAX_GEMINI_CALLS_PER_RUN || RF_CONFIG.MAX_GEMINI_ATTEMPTS;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !hookSet && calls < maxCalls; attempt++) {
        let raw = callGemini_(buildHooksForScriptPrompt(found.product, current, avoid, lastErrors, lastRaw), geminiResponseSchema(1, 'only'));
        calls++;
        const parsed = parseModelJson(raw);
        let result = parsed.error ? { errors: [parsed.error] } : validateHookSet(parsed.value, found.product, avoid);
        // Only some hooks need work → rewrite just those (one call) instead of all five.
        const plan = parsed.error ? null : hookRevisionPlan(result, RF_CONFIG.HOOK_STYLE.AUTO_REVISE_WEAK);
        if (plan && plan.ids.length && calls < maxCalls) {
          calls++;
          const merged = reviseHooks_(found.product, parsed.value, plan, avoid, 'generateHooks');
          if (merged && merged.revised.length) {
            const again = validateHookSet(merged.payload, found.product, avoid);
            if (!again.errors.length || result.errors.length) {
              result = again;
              raw = JSON.stringify(merged.payload);
            }
          }
        }
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'generateHooks', found.product.id, id + ' 훅 5개 검증 실패 (시도 ' + attempt + ')',
            result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          hookSet = result.hookSet;
        }
      }
      if (!hookSet) throw new Error('Gemini가 만든 훅 5개가 검증을 통과하지 못했습니다. 대본은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      applyTransition_(ss, id, 'SET_HOOKS', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        hookSet: hookSet,
      }, user + ' + Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Touchpoint 2: the operator asks Gemini to improve ONE hook (e.g. one with a style warning). One Gemini
 * call, no retry; only that hook (and its opening scene) changes, the other four hooks and the script do
 * not. The rewrite is kept only if it passes the hard checks and has no more warnings than before.
 * If the operator had chosen that hook, the choice is cleared so they confirm the new wording.
 */
function apiReviseHook(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    let notice = '';
    withLock_(function () {
      const data = loadData_(ss);
      if (data.hookColumnsMissing) throw new Error('REELS에 훅 저장 열이 없습니다. "릴스 팩토리 → 시트 준비"를 먼저 실행하세요. Gemini는 호출하지 않았습니다.');
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      if (RF_ACTIONS.SET_HOOKS.from.indexOf(status) === -1) {
        throw new Error('훅은 대본 검토 중에만 다듬을 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      const set = parseHookSet(found.row['훅 후보(JSON)']);
      const hookId = normalizeText(input.hookId);
      if (!set.hooks.some(function (h) { return h.id === hookId; })) throw new Error('이 대본의 훅 후보에서 ' + (hookId || '훅') + '을(를) 찾을 수 없습니다.');
      const avoid = productHooksExcept_(data, found.product.id, id);
      const payload = { hooks: set.hooks, recommended_hook: set.recommended };
      const v = validateHookSet(payload, found.product, avoid);
      const problems = (v.hookErrors[hookId] || []).concat(v.warnings[hookId] || []);
      const plan = { ids: [hookId], problems: {}, hard: false };
      plan.problems[hookId] = problems.length ? problems : ['문제 상황이 첫 2초에 더 또렷하게 들리도록 다듬기'];
      const merged = reviseHooks_(found.product, payload, plan, avoid, 'reviseHook', { operator: true });
      if (!merged) throw new Error('Gemini 호출에 실패했습니다. 훅은 바뀌지 않았습니다. LOG 시트를 확인하세요.');
      if (!merged.revised.length) {
        notice = 'Gemini가 더 나은 ' + hookId + '를 만들지 못해 기존 훅을 그대로 두었습니다 (Gemini 1회 사용).';
        return;
      }
      const result = validateHookSet(merged.payload, found.product, avoid);
      if (!result.hookSet) throw new Error('다듬은 훅이 검증을 통과하지 못했습니다. 훅은 바뀌지 않았습니다.\n- ' + result.errors.slice(0, 6).join('\n- '));
      applyTransition_(ss, id, 'SET_HOOKS', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        hookSet: result.hookSet,
        revisedIds: [hookId],
      }, user + ' + Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
      notice = hookId + ' 훅을 다듬었습니다. 대본은 바뀌지 않았습니다 — 이 훅을 쓰려면 "이 훅으로 정하기"를 누르세요.';
    });
    return { notice: notice, detail: reelDetail_(ss, id) };
  });
}

/** Hooks already used by this product's other reels (the given reel's own hooks may return). */
function productHooksExcept_(data, productId, reelId) {
  const avoid = [];
  data.reels.forEach(function (r) {
    if (normalizeText(r['상품ID']) !== productId || normalizeText(r['릴스ID']) === reelId) return;
    if (normalizeText(r['후킹'])) avoid.push(normalizeText(r['후킹']));
    parseHookSet(r['훅 후보(JSON)']).hooks.forEach(function (h) {
      avoid.push(h.text);
    });
  });
  return avoid;
}

/** Touchpoint 1 from the phone: generate 3 scripts for a product already entered in PRODUCTS. */
function apiGenerateScripts(productId, allowAdditional) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return withLock_(function () {
      const row = findProductRow_(getProductsSheet_(ss), normalizeText(productId));
      const res = generateScriptsForProduct_(ss, row, { actor: user, allowAdditional: !!allowAdditional });
      return res.needsConfirm ? { needsConfirm: res.needsConfirm } : { ids: res.ids };
    });
  });
}

function apiGetPublishingPack(reelId) {
  return api_(function () {
    const data = loadData_(SpreadsheetApp.getActiveSpreadsheet());
    const found = findReel_(data, normalizeText(reelId));
    return { pack: buildPublishingPack(found.row, found.product) };
  });
}

// ---------------------------------------------------------------- render jobs

/** Shared HMAC key between this script and the renderer. Created on first use. */
function getRenderSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('RF_RENDER_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('RF_RENDER_SECRET', secret);
  }
  return secret;
}

function signRenderJob_(payload) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(payload, getRenderSecret_(), Utilities.Charset.UTF_8));
}

/**
 * Issues a signed render job for an approved reel in production. No paid API is called here;
 * the renderer spends TTS characters only after verifying this signature.
 */
function apiGetRenderJob(reelId) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = loadData_(ss);
    const found = findReel_(data, normalizeText(reelId));
    const gate = renderJobBlocker(found.row, found.product);
    if (gate) throw new Error(gate);
    // Approved clips must still be the same bytes in Drive (network check, only when the clip gate applies).
    const driveErr = verifyApprovedClipFiles_(found.row);
    if (driveErr) throw new Error(driveErr);
    const payload = buildRenderJobPayload(found.row, found.product, new Date().toISOString(), RF_RENDER_JOB_TTL_HOURS);
    const job = JSON.parse(payload);
    appendAudit_(ss, [{
      '일시': new Date(),
      '릴스ID': job.reelId,
      '상품ID': job.productId,
      '작업': 'RENDER_JOB_ISSUED',
      '이전 상태': job.status,
      '새 상태': job.status,
      '대본 버전': job.scriptVersion,
      '영상 버전': job.nextVideoVersion - 1,
      '작업자': user,
      '메모': '만료: ' + job.expiresAt,
    }]);
    return {
      fileName: job.reelId + '_v' + job.scriptVersion + '.render-job.json',
      jobFile: JSON.stringify({ payload: payload, signature: signRenderJob_(payload) }, null, 2),
    };
  });
}

/** Menu: shows the render key once so the operator can put it in renderer/.env on the Mac. */
function showRenderSecret() {
  const ui = SpreadsheetApp.getUi();
  const secret = escapeHtml_(getRenderSecret_());
  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<p style="font:14px sans-serif">Mac의 <code>renderer/.env</code> 파일에 아래 한 줄을 넣으세요. 이 키가 있어야 승인된 렌더 작업만 실행됩니다. 다른 사람과 공유하지 마세요.</p>' +
        '<pre style="font:13px monospace;white-space:pre-wrap;word-break:break-all;background:#f3f3f3;padding:8px">RF_RENDER_SECRET=' + secret + '</pre>'
    ).setWidth(460).setHeight(200),
    '렌더 키 (Mac 설정용)'
  );
}

/**
 * Step 1: Create or select a product project using a product URL.
 * input: { url, name, category, features, target }
 */
function apiCreateProductProject(input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    input = input || {};
    const url = normalizeText(input.url);
    if (!url) throw new Error('상품 URL을 입력하세요.');

    return withLock_(function () {
      const sheet = getProductsSheet_(ss);
      const data = loadData_(ss);
      const existingProducts = Object.keys(data.productById)
        .filter(function (id) { return id && data.productById[id] !== 'DUPLICATE'; })
        .map(function (id) { return data.productById[id]; });

      // Check if product with this URL already exists
      const match = existingProducts.filter(function (p) {
        return (normalizeText(p.affiliateUrl) && normalizeText(p.affiliateUrl) === url) ||
               (normalizeText(p.sourceUrl) && normalizeText(p.sourceUrl) === url);
      })[0];

      if (match) {
        return { product: match, created: false };
      }

      // Generate next product ID (e.g., PRD-001, PRD-002, ...)
      let maxNum = 0;
      existingProducts.forEach(function (p) {
        const m = /^PRD-(\d+)$/.exec(p.id);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      const nextNum = maxNum + 1;
      const nextId = 'PRD-' + (nextNum < 10 ? '00' : nextNum < 100 ? '0' : '') + nextNum;

      const isCoupang = url.indexOf('coupang') !== -1 || url.indexOf('coupa.ng') !== -1;
      const rec = {};
      rec[RF_CONFIG.PRODUCT_FIELDS.id] = nextId;
      rec[RF_CONFIG.PRODUCT_FIELDS.name] = normalizeText(input.name) || ('새 상품 ' + nextId);
      rec[RF_CONFIG.PRODUCT_FIELDS.category] = normalizeText(input.category) || '일반';
      rec[RF_CONFIG.PRODUCT_FIELDS.features] = normalizeText(input.features) || '';
      rec[RF_CONFIG.PRODUCT_FIELDS.target] = normalizeText(input.target) || '일반';
      rec[RF_CONFIG.PRODUCT_FIELDS.affiliateUrl] = isCoupang ? url : '';
      rec[RF_CONFIG.PRODUCT_FIELDS.sourceUrl] = !isCoupang ? url : '';
      rec[RF_CONFIG.PRODUCT_FIELDS.permission] = '자체 제작';
      rec[RF_CONFIG.PRODUCT_FIELDS.status] = '준비';

      appendRecords_(sheet, [rec]);

      appendAudit_(ss, [{
        '일시': new Date(),
        '상품ID': nextId,
        '작업': 'PRODUCT_PROJECT_CREATED',
        '작업자': user,
        '메모': 'Step 1: 상품 URL로 프로젝트 생성 (' + url + ')',
        '스냅샷(JSON)': JSON.stringify({ id: nextId, url: url, name: rec[RF_CONFIG.PRODUCT_FIELDS.name] })
      }]);

      logEvent_('INFO', 'createProductProject', nextId, '새 상품 프로젝트 생성: ' + nextId, url);

      return {
        product: {
          id: nextId,
          name: rec[RF_CONFIG.PRODUCT_FIELDS.name],
          category: rec[RF_CONFIG.PRODUCT_FIELDS.category],
          features: rec[RF_CONFIG.PRODUCT_FIELDS.features],
          target: rec[RF_CONFIG.PRODUCT_FIELDS.target],
          affiliateUrl: rec[RF_CONFIG.PRODUCT_FIELDS.affiliateUrl],
          sourceUrl: rec[RF_CONFIG.PRODUCT_FIELDS.sourceUrl],
          permission: '자체 제작',
          status: '준비',
        },
        created: true,
      };
    });
  });
}

/**
 * Step 6: Approves all uploaded/attached clips in PENDING_REVIEW for this reel.
 */
function apiApproveAllClips(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    return withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const store = parseClipStore_(found.row);
      const hash = cellText_(found.row['승인 대본 해시']);
      const list = clipList_(found.row);
      let approvedCount = 0;

      list.forEach(function (c) {
        const entry = store.clips[c.key];
        const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
        if (cur && cur.status !== 'APPROVED') {
          cur.status = 'APPROVED';
          cur.approvedHash = hash;
          cur.reviewedBy = user;
          cur.reviewedAt = new Date().toISOString();
          approvedCount++;
        }
      });

      if (approvedCount > 0) {
        updateRecord_(data.reelsSheet, found.row._row, { '장면 클립(JSON)': JSON.stringify(store) });
        appendAudit_(ss, [{
          '일시': new Date(),
          '릴스ID': id,
          '상품ID': found.row['상품ID'],
          '작업': 'CLIPS_APPROVED_ALL',
          '이전 상태': reelStatus(found.row),
          '새 상태': reelStatus(found.row),
          '대본 버전': scriptVersionOf(found.row),
          '영상 버전': videoVersionOf(found.row),
          '작업자': user,
          '메모': '전체 ' + approvedCount + '개 클립 일괄 승인',
        }]);
      }
      return { detail: reelDetail_(ss, id), approvedCount: approvedCount };
    });
  });
}
