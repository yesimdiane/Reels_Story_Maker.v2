/**
 * Gemini as the production planner — AFTER SCRIPT_APPROVED only.
 *
 * Gemini decides: the scene-by-scene Google Flow prompts, how each line is spoken (rate, pause), which words
 * the subtitles stress, how each scene is cut, and what to check in the clips. It returns a declarative
 * plan; this file validates it and code executes it (Apps Script: Drive; renderer: Google Cloud TTS and
 * FFmpeg). Gemini never writes commands and never rewrites the approved script.
 *
 * Gates (all checked BEFORE the Gemini call):
 *   - the script is approved and unchanged since approval (SCRIPT_APPROVED fingerprint);
 *   - the REELS columns exist;
 *   - the operator listed verified product images in PRODUCTS and they can be read — product visuals must
 *     match real product images, never a guess.
 * Google Flow has no public API, so Flow generation stays manual; clips come back through Google Drive.
 */

// ---------------------------------------------------------------- schema and prompt

const RF_PRODUCTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    product_visual: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        must_match: { type: 'ARRAY', items: { type: 'STRING' } },
        must_not_show: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['summary', 'must_match', 'must_not_show'],
    },
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          scene_prompt: { type: 'STRING' },
          continuity: { type: 'STRING' },
          verify_in_clip: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['scene_no', 'scene_prompt', 'continuity', 'verify_in_clip'],
        propertyOrdering: ['scene_no', 'scene_prompt', 'continuity', 'verify_in_clip'],
      },
    },
    narration: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          tts_text: { type: 'STRING' },
          speaking_rate: { type: 'NUMBER' },
          pause_after_sec: { type: 'NUMBER' },
        },
        required: ['scene_no', 'tts_text', 'speaking_rate', 'pause_after_sec'],
        propertyOrdering: ['scene_no', 'tts_text', 'speaking_rate', 'pause_after_sec'],
      },
    },
    subtitles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          emphasis_words: { type: 'ARRAY', items: { type: 'STRING' } },
          note: { type: 'STRING' },
        },
        required: ['scene_no', 'emphasis_words', 'note'],
        propertyOrdering: ['scene_no', 'emphasis_words', 'note'],
      },
    },
    edit: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          cuts: { type: 'ARRAY', items: { type: 'OBJECT', properties: { framing: { type: 'STRING' } }, required: ['framing'] } },
        },
        required: ['scene_no', 'cuts'],
        propertyOrdering: ['scene_no', 'cuts'],
      },
    },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['product_visual', 'scenes', 'narration', 'subtitles', 'edit', 'risks'],
  propertyOrdering: ['product_visual', 'scenes', 'narration', 'subtitles', 'edit', 'risks'],
};

/** Verified product images listed in PRODUCTS ("검증된 제품 이미지"): [{ fileId }], at most MAX_REFERENCE_IMAGES. */
function parseReferenceImages(text) {
  const out = [];
  String(text == null ? '' : text).split(/[\n,;]+/).forEach(function (part) {
    const id = parseDriveFileId(part);
    if (id && !out.some(function (r) { return r.fileId === id; })) out.push({ fileId: id });
  });
  return out.slice(0, RF_CONFIG.PRODUCTION.MAX_REFERENCE_IMAGES);
}

/**
 * Reads the verified product images from Drive → [{ fileId, name, mimeType, data (base64) }].
 * Throws an actionable error (before any Gemini call) if there are none or one cannot be read.
 */
function loadReferenceImages_(product) {
  const P = RF_CONFIG.PRODUCTION;
  const refs = parseReferenceImages(product.referenceImages);
  const field = RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages;
  if (!refs.length) {
    throw new Error(
      '검증된 제품 이미지가 없습니다. 제품 모양·색·크기가 실제 제품과 같아야 하므로, PRODUCTS의 "' + field + '" 열(오른쪽에 직접 추가)에 ' +
        '실제 제품을 보여 주는 이미지의 Google Drive 링크를 줄마다 하나씩 넣으세요 (사용 권한이 확인된 이미지만). Gemini는 호출하지 않았습니다.'
    );
  }
  let total = 0;
  return refs.map(function (r) {
    let file;
    try {
      file = DriveApp.getFileById(r.fileId);
    } catch (e) {
      throw new Error('제품 이미지(' + r.fileId + ')를 Drive에서 열 수 없습니다. 링크와 공유 권한을 확인하세요. Gemini는 호출하지 않았습니다.');
    }
    const mime = String(file.getMimeType() || '');
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) {
      throw new Error('제품 이미지 "' + file.getName() + '"는 PNG/JPEG/WebP 이미지가 아닙니다 (' + mime + '). Gemini는 호출하지 않았습니다.');
    }
    const bytes = file.getBlob().getBytes();
    if (bytes.length > P.MAX_IMAGE_BYTES) {
      throw new Error('제품 이미지 "' + file.getName() + '"가 너무 큽니다 (' + Math.round(bytes.length / 1024) + 'KB, 최대 ' + Math.round(P.MAX_IMAGE_BYTES / 1024) + 'KB). 더 작은 이미지로 바꾸세요.');
    }
    total += bytes.length;
    if (total > P.MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('제품 이미지 전체 크기가 ' + Math.round(P.MAX_TOTAL_IMAGE_BYTES / 1024 / 1024) + 'MB를 넘습니다 (Gemini 요청 한도). 이미지를 줄이거나 개수를 줄이세요. Gemini는 호출하지 않았습니다.');
    }
    return { fileId: r.fileId, name: file.getName(), mimeType: mime, data: Utilities.base64Encode(bytes) };
  });
}

/** The approved storyboard, the only script Gemini plans for. */
function approvedScenes_(row) {
  const reel = rowToReel(row);
  return (reel.scenes || []).map(function (s, i) {
    return {
      scene_no: s.scene_no || i + 1,
      beat: s.beat || '',
      duration_sec: Number(s.duration_sec),
      narration: normalizeText(s.narration),
      visual: normalizeText(s.visual),
      flow_prompt: normalizeText(s.flow_prompt),
      ai_visualization: s.ai_visualization === true,
    };
  });
}

/** Prompt for the production plan. Costs one Gemini call (images attached separately). */
function buildProductionPlanPrompt(row, product, refs, previousErrors, previousResponse) {
  const P = RF_CONFIG.PRODUCTION;
  const L = RF_CONFIG.LIMITS;
  const facts = parseConfirmedFeatures(product.features);
  const scenes = approvedScenes_(row);
  const lines = [
    '당신은 인스타그램 계정 "' + RF_CONFIG.BRAND.NAME + '"의 릴스 제작 감독입니다. 대본은 이미 운영자가 승인했습니다. 승인된 대본은 한 글자도 바꾸지 말고, 영상 제작 계획만 세우세요.',
    '당신은 계획을 JSON으로 돌려줍니다. 실제 실행(Google Flow 클립 생성은 운영자가 수동, 음성 합성은 Google Cloud TTS, 편집은 FFmpeg 렌더러)은 코드가 하며, 코드가 이 계획을 검증합니다. 명령어·코드·셸은 쓰지 마세요.',
    '',
    '## 상품',
    '- 상품명: ' + normalizeText(product.name),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이것만 사실)',
  ];
  facts.forEach(function (f, i) {
    lines.push('- ' + factId(i) + ': ' + f);
  });
  lines.push(
    '',
    '## 검증된 제품 이미지 (첨부 ' + refs.length + '장: ' + refs.map(function (r) { return r.name; }).join(', ') + ')',
    '- 운영자가 실제 제품이라고 확인한 이미지입니다. 이 이미지에서 실제로 보이는 모양·색·비율·부착 위치만 product_visual에 쓰세요.',
    '- 이미지에 보이지 않거나 확인된 기능에 없는 것(소재, 질감, 부착 방식, 구성품 등)은 지어내지 말고, 헷갈리기 쉬운 것은 must_not_show에 쓰세요.',
    '',
    '## 승인된 대본 (장면별, 수정 금지)'
  );
  scenes.forEach(function (s) {
    lines.push('- 장면 ' + s.scene_no + ' [' + s.beat + '] ' + s.duration_sec + '초' + (s.ai_visualization ? ' (AI 시뮬레이션)' : '') +
      '\n  narration: ' + s.narration + '\n  연출: ' + s.visual + '\n  기존 Flow 프롬프트(참고): ' + s.flow_prompt);
  });
  lines.push(
    '',
    '## 규칙',
    '1. scenes: 장면마다 1개 (scene_no 그대로). scene_prompt는 영어로, 그 장면의 행동·장소·카메라 움직임만 쓰세요 (' + P.SCENE_PROMPT_MIN_CHARS + '자 이상). 제품 외형은 코드가 product_visual로 붙이므로 scene_prompt에서 제품 외형을 새로 묘사하지 마세요. 확인된 기능 밖의 부착 방식·호환 표면·성능을 보여 주지 마세요. 가격·브랜드·글자·로고 금지. continuity는 모든 장면에서 같아야 할 것(같은 문, 같은 바닥, 같은 옷 등). verify_in_clip은 생성된 클립에서 운영자가 확인할 것 1개 이상.',
    '2. narration: 장면마다 1개. tts_text는 승인된 narration과 한 글자도 다르지 않아야 합니다 ({키워드} 자리표시자 포함). speaking_rate는 ' + P.SPEAKING_RATE_MIN + '~' + P.SPEAKING_RATE_MAX + ' (훅·CTA는 또렷하고 약간 빠르게, 설명은 천천히), pause_after_sec는 0~' + P.PAUSE_MAX_SEC + '.',
    '3. subtitles: 장면마다 1개. emphasis_words는 그 장면 narration 안에 실제로 있는 단어(최대 ' + P.EMPHASIS_MAX_WORDS + '개, 없으면 []). note는 자막 편집 메모.',
    '4. edit: 장면마다 1개. cuts는 그 장면을 ' + P.CUT_MIN_SEC + '~' + P.CUT_MAX_SEC + '초 컷으로 나눈 구성입니다 (컷 길이 = 장면 길이 ÷ 컷 수가 이 범위 안). framing은 한국어 한 줄, 예: "클로즈업 — 손으로 제품 사용".',
    '5. product_visual.summary는 한 문장, must_match에는 모든 장면에서 실제 제품과 같아야 하는 시각적 특징(색·모양·비율·위치)을 1개 이상.',
    '6. risks: 생성된 클립에서 운영자가 특히 주의할 위험(제품 모양 불일치, 확인되지 않은 부착 장면 등). 없으면 [].',
    '7. 대본에 없는 경험담·테스트·후기·남편 반응·전후 결과를 만들지 마세요. AI 시뮬레이션 장면은 그대로 AI 시뮬레이션입니다.',
    '8. 길이 기준: 전체 ' + L.GENERATED_MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초 (대본 그대로).',
    '',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  if (previousErrors && previousErrors.length) {
    lines.push('', '## 이전 응답의 검증 오류 (반드시 수정)', '아래 문제만 고치고 나머지는 그대로 두세요.');
    previousErrors.slice(0, 25).forEach(function (e) {
      lines.push('- ' + e);
    });
    if (previousResponse) lines.push('', '## 이전 응답 (JSON)', String(previousResponse).slice(0, 12000));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- validation

function normalizeTts_(text) {
  return normalizeText(text).replace(/\s+/g, ' ');
}

/**
 * Validates Gemini's production plan against the approved script. Gemini may plan, never rewrite:
 * the spoken text must equal the approved narration. Returns { errors, plan } (plan only when valid).
 */
function validateProductionPlan(raw, row, product, refs) {
  const P = RF_CONFIG.PRODUCTION;
  const errors = [];
  const scenes = approvedScenes_(row);
  if (!raw || typeof raw !== 'object') return { errors: ['제작 계획이 JSON 객체가 아닙니다.'], plan: null };
  const pv = raw.product_visual || {};
  const summary = normalizeText(pv.summary);
  const mustMatch = (Array.isArray(pv.must_match) ? pv.must_match : []).map(normalizeText).filter(Boolean);
  const mustNotShow = (Array.isArray(pv.must_not_show) ? pv.must_not_show : []).map(normalizeText).filter(Boolean);
  if (!summary) errors.push('product_visual.summary(제품 이미지에서 보이는 외형)가 비어 있습니다.');
  if (!mustMatch.length) errors.push('product_visual.must_match에 모든 장면에서 같아야 할 특징을 1개 이상 쓰세요.');
  const visualText = [summary].concat(mustMatch, mustNotShow).join(' ');
  if (/https?:\/\/|www\./i.test(visualText)) errors.push('product_visual에 URL이 있습니다.');
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (visualText.indexOf(phrase) !== -1) errors.push('product_visual에 과장/검증 불가 표현이 있습니다: "' + phrase + '".');
  });

  // Every list must have exactly one entry per approved scene, in order.
  const byScene = function (key) {
    const list = Array.isArray(raw[key]) ? raw[key] : [];
    if (list.length !== scenes.length) {
      errors.push(key + '는 장면 수(' + scenes.length + ')와 같아야 합니다 (받은 개수: ' + list.length + ').');
    }
    return scenes.map(function (s) {
      const item = list.filter(function (x) { return x && Number(x.scene_no) === s.scene_no; })[0];
      if (!item && list.length === scenes.length) errors.push(key + '에 장면 ' + s.scene_no + '이(가) 없습니다.');
      return item || null;
    });
  };
  const planScenes = byScene('scenes');
  const planNarration = byScene('narration');
  const planSubs = byScene('subtitles');
  const planEdit = byScene('edit');
  const out = { scenes: [], narration: [], subtitles: [], edit: [] };

  scenes.forEach(function (s, i) {
    const w = '장면 ' + s.scene_no + ': ';
    const sc = planScenes[i];
    if (sc) {
      const prompt = normalizeText(sc.scene_prompt);
      const letters = (prompt.match(/[A-Za-z]/g) || []).length;
      const visible = prompt.replace(/\s/g, '').length;
      if (prompt.length < P.SCENE_PROMPT_MIN_CHARS) errors.push(w + 'scene_prompt가 너무 짧습니다 (' + P.SCENE_PROMPT_MIN_CHARS + '자 이상).');
      else if (visible && letters / visible < 0.6) errors.push(w + 'scene_prompt는 Google Flow용 영어여야 합니다.');
      const lower = ' ' + prompt.toLowerCase() + ' ';
      P.SCENE_PROMPT_FORBIDDEN.forEach(function (term) {
        if (lower.indexOf(term) !== -1) errors.push(w + 'scene_prompt에 확인된 기능에 없는 내용이 있습니다: "' + term.trim() + '". 확인된 기능만으로 다시 쓰세요.');
      });
      if (/https?:\/\/|www\./i.test(prompt)) errors.push(w + 'scene_prompt에 URL이 있습니다.');
      const verify = (Array.isArray(sc.verify_in_clip) ? sc.verify_in_clip : []).map(normalizeText).filter(Boolean);
      if (!verify.length) errors.push(w + 'verify_in_clip(클립에서 확인할 것)이 비어 있습니다.');
      out.scenes.push({ scene_no: s.scene_no, scene_prompt: prompt, continuity: normalizeText(sc.continuity), verify_in_clip: verify });
    }
    const nr = planNarration[i];
    if (nr) {
      if (normalizeTts_(nr.tts_text) !== normalizeTts_(s.narration)) {
        errors.push(w + 'tts_text는 승인된 narration과 같아야 합니다 (대본은 수정할 수 없음). 승인된 문장: "' + s.narration + '"');
      }
      const rate = Number(nr.speaking_rate);
      const pause = Number(nr.pause_after_sec);
      if (!(rate >= P.SPEAKING_RATE_MIN && rate <= P.SPEAKING_RATE_MAX)) errors.push(w + 'speaking_rate는 ' + P.SPEAKING_RATE_MIN + '~' + P.SPEAKING_RATE_MAX + '여야 합니다 (받은 값: ' + nr.speaking_rate + ').');
      if (!(pause >= 0 && pause <= P.PAUSE_MAX_SEC)) errors.push(w + 'pause_after_sec는 0~' + P.PAUSE_MAX_SEC + '여야 합니다 (받은 값: ' + nr.pause_after_sec + ').');
      out.narration.push({ scene_no: s.scene_no, tts_text: s.narration, speaking_rate: +rate.toFixed(2), pause_after_sec: +pause.toFixed(2) });
    }
    const sb = planSubs[i];
    if (sb) {
      const words = (Array.isArray(sb.emphasis_words) ? sb.emphasis_words : []).map(normalizeText).filter(Boolean);
      if (words.length > P.EMPHASIS_MAX_WORDS) errors.push(w + 'emphasis_words는 최대 ' + P.EMPHASIS_MAX_WORDS + '개입니다.');
      words.forEach(function (word) {
        if (s.narration.indexOf(word) === -1) errors.push(w + 'emphasis_words "' + word + '"가 narration에 없습니다.');
      });
      out.subtitles.push({ scene_no: s.scene_no, emphasis_words: words, note: normalizeText(sb.note) });
    }
    const ed = planEdit[i];
    if (ed) {
      const cuts = Array.isArray(ed.cuts) ? ed.cuts : [];
      const per = cuts.length ? s.duration_sec / cuts.length : 0;
      if (!cuts.length) errors.push(w + 'cuts가 비어 있습니다.');
      else if (per < P.CUT_MIN_SEC - 1e-9 || per > P.CUT_MAX_SEC + 1e-9) {
        errors.push(w + '컷 ' + cuts.length + '개면 컷당 ' + per.toFixed(1) + '초입니다. ' + P.CUT_MIN_SEC + '~' + P.CUT_MAX_SEC + '초가 되도록 컷 수를 조정하세요.');
      }
      cuts.forEach(function (c, k) {
        if (!normalizeText(c && c.framing)) errors.push(w + '컷 ' + (k + 1) + '의 framing이 비어 있습니다.');
      });
      out.edit.push({ scene_no: s.scene_no, cuts: cuts.map(function (c) { return { framing: normalizeText(c && c.framing) }; }) });
    }
  });
  const risks = (Array.isArray(raw.risks) ? raw.risks : []).map(normalizeText).filter(Boolean);
  const uniq = dedupe_(errors);
  if (uniq.length) return { errors: uniq, plan: null };
  return {
    errors: [],
    plan: {
      planVersion: P.PLAN_VERSION,
      flowProvider: P.FLOW_PROVIDER,
      productVisual: { summary: summary, mustMatch: mustMatch, mustNotShow: mustNotShow },
      references: (refs || []).map(function (r) { return { fileId: r.fileId, name: r.name }; }),
      scenes: out.scenes,
      narration: out.narration,
      subtitles: out.subtitles,
      edit: out.edit,
      risks: risks,
    },
  };
}

/** The stored production plan if it belongs to the CURRENT approved script, else null. */
function validProductionPlan(row) {
  let plan = null;
  try {
    plan = JSON.parse(cellText_(row['제작 계획(JSON)']) || 'null');
  } catch (e) {
    return null;
  }
  if (!plan || !Array.isArray(plan.scenes)) return null;
  if (!isApprovedScriptIntact(row)) return null;
  if (plan.approvedHash !== cellText_(row['승인 대본 해시']) || Number(plan.scriptVersion) !== scriptVersionOf(row)) return null;
  return plan;
}

// ---------------------------------------------------------------- API: plan

/** Why a production plan cannot be made now ('' = it can). Checked before any Gemini or Drive call. */
function productionPlanBlocker_(row, columnsMissing) {
  const status = reelStatus(row);
  if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
    return '제작 계획은 대본 승인 후에만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + '). 대본을 승인하기 전에는 Flow 프롬프트·음성·렌더링을 준비하지 않습니다.';
  }
  if (!isApprovedScriptIntact(row)) {
    return '승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 현재 버전을 다시 검토·승인하세요.';
  }
  if (columnsMissing && columnsMissing.length) {
    return 'REELS에 제작 열이 없습니다 (' + columnsMissing.join(', ') + '). "릴스 팩토리 → 시트 준비"를 먼저 실행하세요 — 기존 데이터는 바뀌지 않습니다.';
  }
  return '';
}

/**
 * Gemini plans the production for an approved script: one Gemini call (+ at most one corrective retry),
 * text and the operator's verified product images only. No Flow generation, TTS or rendering happens here.
 */
function apiCreateProductionPlan(reelId, input) {
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
      const blocker = productionPlanBlocker_(found.row, data.reelsSheet ? missingHeaders_(data.reelsSheet, RF_CONFIG.REELS_PRODUCTION_HEADERS) : RF_CONFIG.REELS_PRODUCTION_HEADERS);
      if (blocker) throw new Error(blocker);
      const refs = loadReferenceImages_(found.product); // throws before Gemini if none / unreadable
      const imageParts = refs.map(function (r) {
        return { inlineData: { mimeType: r.mimeType, data: r.data } };
      });
      let lastErrors = [];
      let lastRaw = '';
      let plan = null;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !plan; attempt++) {
        const raw = callGemini_(buildProductionPlanPrompt(found.row, found.product, refs, lastErrors, lastRaw), RF_PRODUCTION_SCHEMA, imageParts);
        const parsed = parseModelJson(raw);
        const result = parsed.error ? { errors: [parsed.error] } : validateProductionPlan(parsed.value, found.row, found.product, refs);
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'productionPlan', found.product.id, id + ' 제작 계획 검증 실패 (시도 ' + attempt + ')', result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          plan = result.plan;
        }
      }
      if (!plan) throw new Error('Gemini의 제작 계획이 검증을 통과하지 못했습니다. 아무것도 저장하지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      plan.scriptVersion = scriptVersionOf(found.row);
      plan.approvedHash = cellText_(found.row['승인 대본 해시']);
      plan.model = RF_GEMINI_STATE.lastModel || getGeminiModel();
      plan.createdAt = new Date().toISOString();
      applyTransition_(ss, id, 'SET_PRODUCTION_PLAN', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        plan: plan,
        flowPrompts: buildFlowScenePrompts(found.row, found.product, plan),
      }, user + ' + Gemini (' + plan.model + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

// ---------------------------------------------------------------- Google Drive: asset plan and tracker

function driveRootFolder_() {
  const configured = PropertiesService.getScriptProperties().getProperty('RF_DRIVE_FOLDER_ID');
  if (configured) {
    try {
      return DriveApp.getFolderById(configured);
    } catch (e) {
      throw new Error('스크립트 속성 RF_DRIVE_FOLDER_ID의 폴더를 열 수 없습니다. 폴더 ID와 권한을 확인하세요.');
    }
  }
  const it = DriveApp.getFoldersByName(RF_CONFIG.PRODUCTION.DRIVE_ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(RF_CONFIG.PRODUCTION.DRIVE_ROOT_FOLDER_NAME);
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Clip file names expected for the reel (from its Flow prompts): [{ file, scene, part, parts, beat, minSec }]. */
function expectedClips_(row) {
  return parseFlowScenePrompts_(row).map(function (p) {
    return { file: p.file, scene: p.scene, part: p.part || 1, parts: p.parts || 1, beat: p.beat || '', coversSec: p.coversSec || 0 };
  });
}

function parseAssetStatus_(row) {
  try {
    const v = JSON.parse(cellText_(row['에셋 현황(JSON)']) || 'null');
    return v && Array.isArray(v.clips) ? v : null;
  } catch (e) {
    return null;
  }
}

/** Matches Drive files to expected clip names (case-insensitive, mp4/mov/m4v). */
function matchClipFiles_(expected, files) {
  const exts = RF_CONFIG.PRODUCTION.CLIP_EXTENSIONS;
  const byBase = {};
  const extra = [];
  files.forEach(function (f) {
    const m = /^(.*)\.([A-Za-z0-9]+)$/.exec(f.name);
    if (m && exts.indexOf(m[2].toLowerCase()) !== -1) {
      const base = m[1].toUpperCase();
      // Newest upload wins if the same clip was uploaded twice.
      if (!byBase[base] || byBase[base].modified < f.modified) byBase[base] = f;
    } else {
      extra.push(f.name);
    }
  });
  const used = {};
  const clips = expected.map(function (c) {
    const base = c.file.replace(/\.[A-Za-z0-9]+$/, '').toUpperCase();
    const f = byBase[base];
    if (f) used[base] = true;
    return Object.assign({}, c, f
      ? { status: 'UPLOADED', driveFileId: f.id, driveName: f.name, sizeBytes: f.size, modified: f.modified }
      : { status: 'MISSING' });
  });
  Object.keys(byBase).forEach(function (b) {
    if (!used[b]) extra.push(byBase[b].name);
  });
  return { clips: clips, extra: extra };
}

function listFolderFiles_(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), name: f.getName(), size: f.getSize(), modified: f.getLastUpdated() instanceof Date ? f.getLastUpdated().toISOString() : String(f.getLastUpdated() || '') });
  }
  return out;
}

/**
 * Prepares the Drive folder for a reel's clips (Reels Factory / <상품ID> / <릴스ID>) and the asset tracker
 * (one row per Flow clip, with its expected file name), then reads the folder to see which clips have
 * been uploaded. No Gemini call; Drive only. Tracking data is not an operator decision, so it
 * is written to 에셋 현황(JSON) without an AUDIT entry.
 */
function syncAssets_(ss, id) {
  const data = loadData_(ss);
  const found = findReel_(data, id);
  const row = found.row;
  const blocker = productionPlanBlocker_(row, data.reelsSheet ? missingHeaders_(data.reelsSheet, RF_CONFIG.REELS_PRODUCTION_HEADERS) : RF_CONFIG.REELS_PRODUCTION_HEADERS);
  if (blocker) throw new Error(blocker);
  const expected = expectedClips_(row);
  if (!expected.length) throw new Error('Flow 프롬프트가 없습니다. 먼저 제작 계획을 만드세요.');
  const folder = childFolder_(childFolder_(driveRootFolder_(), found.product.id), id);
  const files = listFolderFiles_(folder);
  const m = matchClipFiles_(expected, files);
  const status = {
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    scriptVersion: scriptVersionOf(row),
    approvedHash: cellText_(row['승인 대본 해시']),
    syncedAt: new Date().toISOString(),
    clips: m.clips,
    extra: m.extra,
    uploaded: m.clips.filter(function (c) { return c.status === 'UPLOADED'; }).length,
    total: m.clips.length,
  };
  updateRecord_(data.reelsSheet, row._row, { '에셋 현황(JSON)': JSON.stringify(status) });
  logEvent_('INFO', 'assets', found.product.id, id + ' Drive 에셋 ' + status.uploaded + '/' + status.total + ' 업로드됨', status.extra.length ? '목록에 없는 파일: ' + status.extra.join(', ') : '');
  return status;
}

function apiPrepareAssets(reelId, input) {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const found = findReel_(loadData_(ss), id);
      if ((input.expectedStatus && input.expectedStatus !== reelStatus(found.row)) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, reelStatus(found.row));
      }
      syncAssets_(ss, id);
    });
    return { detail: reelDetail_(ss, id) };
  });
}

// ---------------------------------------------------------------- dashboard view

function productionView_(row, product, columnsMissing) {
  // columnsMissing: names of missing REELS production columns ([] when present).
  const status = reelStatus(row);
  const plan = validProductionPlan(row);
  const stored = (function () {
    try {
      return JSON.parse(cellText_(row['제작 계획(JSON)']) || 'null');
    } catch (e) {
      return null;
    }
  })();
  const assets = parseAssetStatus_(row);
  const blocker = productionPlanBlocker_(row, columnsMissing);
  const refs = parseReferenceImages(product.referenceImages);
  const approvedStatuses = RF_CONFIG.PRODUCTION.PLAN_STATUSES;
  return {
    visible: approvedStatuses.indexOf(status) !== -1,
    flowProvider: RF_CONFIG.PRODUCTION.FLOW_PROVIDER,
    flowNote: 'Google Flow에는 공식 공개 API가 없어 클립은 Flow에서 직접 만들어 Drive 폴더에 올립니다.',
    canPlan: !blocker && approvedStatuses.indexOf(status) !== -1,
    blocker: blocker,
    referenceImages: refs.length,
    referenceImagesField: RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages,
    plan: plan,
    stale: !!stored && !plan,
    assets: assets && assets.approvedHash === cellText_(row['승인 대본 해시']) ? assets : null,
    canPrepareAssets: !blocker && approvedStatuses.indexOf(status) !== -1,
  };
}
