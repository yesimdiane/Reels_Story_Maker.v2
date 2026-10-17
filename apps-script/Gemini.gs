/**
 * Gemini API client (generateContent with JSON structured output).
 * API key is read from Script Properties: GEMINI_API_KEY. Optional: GEMINI_MODEL.
 *
 * Model choice: GEMINI_MODEL (if set) or RF_CONFIG.DEFAULT_GEMINI_MODEL. If Google answers 404
 * ("model not found" — nothing was generated, nothing billed), the call falls back to
 * RF_CONFIG.GEMINI_FALLBACK_MODELS in order. Any other error is never retried on another model.
 */

// Model that actually answered the last call (recorded in REELS.생성 모델 and AUDIT).
const RF_GEMINI_STATE = { lastModel: '' };

function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. 메뉴 "릴스 팩토리 → Gemini API 키 설정" 또는 ' +
        'Apps Script → 프로젝트 설정 → 스크립트 속성에서 설정하세요.'
    );
  }
  return key;
}

function getGeminiModel() {
  return (
    PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') ||
    RF_CONFIG.DEFAULT_GEMINI_MODEL
  );
}

function getGeminiImageModel() {
  return (
    PropertiesService.getScriptProperties().getProperty('GEMINI_IMAGE_MODEL') ||
    RF_CONFIG.DEFAULT_IMAGE_MODEL
  );
}

/** Configured model first, then the fallbacks (no duplicates). */
function geminiModelChain_() {
  const chain = [getGeminiModel()];
  RF_CONFIG.GEMINI_FALLBACK_MODELS.forEach(function (m) {
    if (chain.indexOf(m) === -1) chain.push(m);
  });
  return chain;
}

function geminiImageModelChain_() {
  const chain = [getGeminiImageModel()];
  (RF_CONFIG.GEMINI_IMAGE_FALLBACK_MODELS || []).forEach(function (m) {
    if (chain.indexOf(m) === -1) chain.push(m);
  });
  return chain;
}

/** One model, with retries for 429/5xx and network errors. Returns { code, text }. */
function requestGemini_(model, body) {
  const url = RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model) + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': getGeminiApiKey_() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  let response;
  let code;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.info('[Gemini Request] Attempt ' + attempt + ' calling model ' + model);
      response = UrlFetchApp.fetch(url, options);
      code = response.getResponseCode();
      console.info('[Gemini Request] Attempt ' + attempt + ' responded HTTP ' + code);
    } catch (e) {
      console.error('[Gemini Request Error] Attempt ' + attempt + ' failed: ' + e.message);
      // Network errors and UrlFetchApp timeouts throw even with muteHttpExceptions.
      if (attempt === 3) {
        throw new Error(
          'Gemini API에 연결하지 못했습니다 (' + e.message + '). 인터넷/Google 서비스 상태를 확인하고 다시 시도하세요. ' +
            '시간 초과가 반복되면 스크립트 속성 GEMINI_MODEL을 더 빠른 모델(예: Flash-Lite 계열)로 바꿔 보세요.'
        );
      }
      Utilities.sleep(2000 * attempt);
      continue;
    }
    if (code !== 429 && code < 500) break;
    if (attempt < 3) Utilities.sleep(2000 * attempt);
  }
  return { code: code, text: response.getContentText() };
}

/**
 * Calls Gemini once and returns the raw JSON text from the first candidate.
 * Throws an actionable Error on HTTP / safety / truncation problems.
 */
function callGemini_(promptText, responseSchema, extraParts) {
  const body = {
    // extraParts: optional inline images ({ inlineData: { mimeType, data } }) after the text.
    contents: [{ role: 'user', parts: [{ text: promptText }].concat(extraParts || []) }],
    // Temperature left at the model default: Gemini 3.x models are tuned for 1.0.
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema || RF_GEMINI_RESPONSE_SCHEMA,
    },
  };
  const chain = geminiModelChain_();
  let model;
  let res;
  for (let i = 0; i < chain.length; i++) {
    model = chain[i];
    res = requestGemini_(model, body);
    if (res.code !== 404 || i === chain.length - 1) break;
    logEvent_('WARN', 'geminiModel', '', '모델 "' + model + '"을 찾을 수 없어 "' + chain[i + 1] + '"로 대체합니다 (404, 과금 없음).', String(res.text).slice(0, 500));
  }
  const code = res.code;
  const text = res.text;
  if (code !== 200) {
    let detail = text;
    try {
      detail = JSON.parse(text).error.message;
    } catch (e) {
      // keep raw text
    }
    let hint = '';
    if (code === 400) hint = ' (요청 형식 또는 모델명 GEMINI_MODEL을 확인하세요)';
    if (code === 401 || code === 403) hint = ' (GEMINI_API_KEY가 유효한지 확인하세요)';
    if (code === 404) {
      hint = ' (모델 ' + chain.join(', ') + ' 모두 사용할 수 없습니다. "릴스 팩토리 → Gemini 모델 확인"으로 확인한 뒤 ' +
        '스크립트 속성 GEMINI_MODEL에 현재 Flash 모델 ID를 입력하세요)';
    }
    if (code === 429) hint = ' (요청 한도 초과 — 잠시 후 다시 시도하세요)';
    throw new Error('Gemini API 오류 HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
  }
  RF_GEMINI_STATE.lastModel = model;

  const json = JSON.parse(text);
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    throw new Error('Gemini가 요청을 차단했습니다: ' + json.promptFeedback.blockReason);
  }
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('Gemini 응답에 candidates가 없습니다: ' + text.slice(0, 500));
  }
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error('Gemini 응답이 완료되지 않았습니다 (finishReason=' + candidate.finishReason + ').');
  }
  return candidate.content.parts
    .map(function (p) {
      return p.text || '';
    })
    .join('');
}

/**
 * Calls gemini-2.5-flash-image with reference product image bytes and 9:16 aspect ratio.
 * Returns { model, mimeType, data (base64), text }.
 */
function callGeminiImage_(promptText, referenceImages, options) {
  options = options || {};
  const imageParts = (referenceImages || []).map(function (r) {
    return {
      inlineData: {
        mimeType: r.mimeType || 'image/jpeg',
        data: r.data,
      },
    };
  });
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: promptText }].concat(imageParts),
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: options.aspectRatio || (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.ASPECT_RATIO) || '9:16',
      },
    },
  };
  const chain = geminiImageModelChain_();
  let model;
  let res;
  for (let i = 0; i < chain.length; i++) {
    model = chain[i];
    res = requestGemini_(model, body);
    if (res.code !== 404 || i === chain.length - 1) break;
    logEvent_('WARN', 'geminiImageModel', '', '이미지 모델 "' + model + '"을 찾을 수 없어 "' + chain[i + 1] + '"로 대체합니다 (404).', String(res.text).slice(0, 500));
  }
  const code = res.code;
  const text = res.text;
  if (code !== 200) {
    let detail = text;
    try {
      detail = JSON.parse(text).error.message;
    } catch (e) {}
    let hint = '';
    if (code === 400) hint = ' (요청 형식 또는 모델명 GEMINI_IMAGE_MODEL을 확인하세요)';
    if (code === 401 || code === 403) hint = ' (GEMINI_API_KEY가 유효한지 확인하세요)';
    if (code === 404) hint = ' (모델 ' + chain.join(', ') + ' 모두 사용할 수 없습니다)';
    if (code === 429) hint = ' (요청 한도 초과 — 잠시 후 다시 시도하세요)';
    console.error('[Gemini Image Error] HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
    throw new Error('Gemini 이미지 생성 오류 HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
  }
  RF_GEMINI_STATE.lastModel = model;

  const json = JSON.parse(text);
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    console.error('[Gemini Image Error] Blocked by safety filter: ' + json.promptFeedback.blockReason);
    throw new Error('Gemini가 요청을 차단했습니다: ' + json.promptFeedback.blockReason);
  }
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    console.error('[Gemini Image Error] No candidates in response: ' + text.slice(0, 500));
    throw new Error('Gemini 응답에 candidates가 없습니다: ' + text.slice(0, 500));
  }
  let imagePart = null;
  let textPart = '';
  candidate.content.parts.forEach(function (p) {
    const d = p.inlineData || p.inline_data;
    if (d && d.data) {
      imagePart = d;
    } else if (p.text) {
      textPart += p.text;
    }
  });
  if (!imagePart) {
    console.error('[Gemini Image Error] No image data in response parts: ' + textPart.slice(0, 500));
    throw new Error('Gemini 이미지 응답에 이미지가 포함되지 않았습니다: ' + textPart.slice(0, 500));
  }
  console.info('[Gemini Image] Successfully received image data from ' + model + ' (' + (imagePart.mimeType || 'image/png') + ')');
  return {
    model: model,
    mimeType: imagePart.mimeType || 'image/png',
    data: imagePart.data,
    text: textPart,
  };
}

/**
 * Free check (models.get — no tokens, no charge): is each model in the chain available for
 * generateContent? Returns [{ model, ok, detail }].
 */
function checkGeminiModels_() {
  const key = getGeminiApiKey_();
  return geminiModelChain_().map(function (model) {
    const res = UrlFetchApp.fetch(RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model), {
      method: 'get',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) return { model: model, ok: false, detail: 'HTTP ' + code };
    const info = JSON.parse(res.getContentText());
    const methods = info.supportedGenerationMethods || [];
    const ok = methods.indexOf('generateContent') !== -1;
    return { model: model, ok: ok, detail: (info.displayName || info.name) + (ok ? '' : ' — generateContent 미지원') };
  });
}

/** Menu: shows which Gemini model will be used (free). */
function showGeminiModelCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    const rows = checkGeminiModels_();
    const use = rows.filter(function (r) {
      return r.ok;
    })[0];
    ui.alert(
      'Gemini 모델 확인 (무료 — 토큰 사용 없음)\n\n' +
        rows.map(function (r) {
          return (r.ok ? '✓ ' : '✗ ') + r.model + ' — ' + r.detail;
        }).join('\n') +
        '\n\n' + (use ? '사용할 모델: ' + use.model : '사용 가능한 모델이 없습니다. GEMINI_MODEL을 현재 Flash 모델 ID로 설정하세요.') +
        '\n실제 JSON 생성까지 확인하려면 "테스트: PRD-001 Gemini 실제 호출"을 실행하세요 (1회 과금).'
    );
  } catch (e) {
    ui.alert('Gemini 모델 확인 실패\n\n' + e.message);
  }
}
