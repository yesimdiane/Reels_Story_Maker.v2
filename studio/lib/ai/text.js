// Text/multimodal AI providers behind one interface: Gemini, OpenAI, Anthropic (plus an explicit MOCK for tests/demos).
//   generate({ model, system, prompt, images:[{mimeType,data(base64),label?}], json, maxTokens }) → { text, json?, usage }
//   listModels() → [id]       testConnection(model?) → { state, message, hint, models? }
// Model identifiers are never assumed: they come from Settings and are validated against the provider's own model list.
// All errors are mapped to a category (auth_failed | invalid_model | rate_limited | unavailable | bad_request | network)
// and never contain the API key.
'use strict';

class AiError extends Error {
  constructor(category, message, extra = {}) {
    super(message);
    this.name = 'AiError';
    this.category = category;
    this.status = extra.status || 0;
    this.hint = extra.hint || '';
  }
}

const HINTS = {
  auth_failed: 'API 키가 틀렸거나 만료/삭제되었는지, 해당 제공자 콘솔에서 키 권한을 확인하세요.',
  invalid_model: '모델 ID가 이 계정에서 사용할 수 없습니다. "모델 목록 불러오기"로 사용 가능한 ID를 선택하세요.',
  rate_limited: '요청 한도 또는 크레딧 한도에 도달했습니다. 잠시 후 다시 시도하거나 제공자 콘솔의 사용량/결제를 확인하세요.',
  unavailable: '제공자 서버 오류입니다. 잠시 후 다시 시도하거나 다른 제공자를 직접 선택하세요(자동 전환은 하지 않습니다).',
  bad_request: '요청 형식이 거부되었습니다. 모델이 이미지/JSON 출력을 지원하는지 확인하세요.',
  network: '제공자에 연결하지 못했습니다. 네트워크/방화벽 설정을 확인하세요.',
};

function categorize(status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429 || /quota|rate.?limit|insufficient_quota|credit balance/.test(t)) return 'rate_limited';
  if (status === 404 || /model.*(not found|does not exist|not supported|invalid)|invalid model/.test(t)) return 'invalid_model';
  if (status >= 500) return 'unavailable';
  if (status === 400 && /api key|api_key|authentication/.test(t)) return 'auth_failed';
  return 'bad_request';
}

function scrub(text, key) {
  let s = String(text || '');
  if (key) s = s.split(key).join('[redacted]');
  return s.slice(0, 400);
}

function makeHttp({ fetchFn, getKey, timeoutMs = 90000 }) {
  return async function http(method, url, { headers = {}, body } = {}) {
    const key = getKey();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(url, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers), body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      throw new AiError('network', '제공자에 연결하지 못했습니다: ' + scrub(e && e.message, key), { hint: HINTS.network });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) {
      const detail = (json && ((json.error && (json.error.message || json.error)) || json.message)) || text;
      const cat = categorize(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
      throw new AiError(cat, `HTTP ${res.status}: ${scrub(typeof detail === 'string' ? detail : JSON.stringify(detail), key)}`, { status: res.status, hint: HINTS[cat] });
    }
    return json;
  };
}

function parseJsonLoose(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* try fenced */ }
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { try { return JSON.parse(m[1]); } catch { /* fall through */ } }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new AiError('bad_request', 'AI 응답이 올바른 JSON이 아닙니다.', { hint: '다시 시도하거나 다른 모델을 선택하세요.' });
}

function createProvider(name, { getKey, fetchFn = globalThis.fetch, baseUrl = '' }) {
  const http = makeHttp({ fetchFn, getKey });
  const need = () => {
    if (!getKey()) throw new AiError('not_configured', 'API 키가 설정되지 않았습니다.', { hint: 'Settings → AI Integrations에서 키를 입력하세요.' });
  };

  if (name === 'gemini') {
    const base = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const h = () => ({ 'x-goog-api-key': getKey() });
    return {
      name,
      supportsImages: true,
      async listModels() {
        need();
        const j = await http('GET', base + '/models?pageSize=1000', { headers: h() });
        return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
      },
      async generate({ model, system, prompt, images = [], json = false, maxTokens }) {
        need();
        if (!model) throw new AiError('invalid_model', '모델이 선택되지 않았습니다.', { hint: HINTS.invalid_model });
        const parts = [{ text: prompt }];
        images.forEach((im) => { if (im.label) parts.push({ text: im.label }); parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } }); });
        const body = { contents: [{ role: 'user', parts }], generationConfig: {} };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        if (json) body.generationConfig.responseMimeType = 'application/json';
        if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
        const j = await http('POST', `${base}/models/${encodeURIComponent(model)}:generateContent`, { headers: h(), body });
        const c = (j.candidates || [])[0];
        const text = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('') : '';
        if (!text) throw new AiError('bad_request', '빈 응답입니다' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '') + '.', { hint: HINTS.bad_request });
        const u = j.usageMetadata || {};
        return { text, json: json ? parseJsonLoose(text) : undefined, usage: { inputTokens: u.promptTokenCount || null, outputTokens: u.candidatesTokenCount || null } };
      },
      /** Image output (where the model supports it). Returns [{mimeType, data}] */
      async generateImage({ model, prompt, images = [] }) {
        need();
        const parts = [{ text: prompt }];
        images.forEach((im) => { if (im.label) parts.push({ text: im.label }); parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } }); });
        const j = await http('POST', `${base}/models/${encodeURIComponent(model)}:generateContent`, { headers: h(), body: { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } } });
        const out = [];
        ((j.candidates || [])[0] || { content: { parts: [] } }).content.parts.forEach((p) => { const d = p.inlineData || p.inline_data; if (d && d.data) out.push({ mimeType: d.mimeType || d.mime_type || 'image/png', data: d.data }); });
        if (!out.length) throw new AiError('bad_request', '모델이 이미지를 반환하지 않았습니다.', { hint: '이미지 생성을 지원하는 모델 ID인지 확인하세요.' });
        const u = j.usageMetadata || {};
        return { images: out, usage: { inputTokens: u.promptTokenCount || null, outputTokens: u.candidatesTokenCount || null } };
      },
    };
  }

  if (name === 'openai') {
    const base = baseUrl || 'https://api.openai.com/v1';
    const h = () => ({ authorization: 'Bearer ' + getKey() });
    return {
      name,
      supportsImages: true,
      async listModels() {
        need();
        const j = await http('GET', base + '/models', { headers: h() });
        return (j.data || []).map((m) => m.id).sort();
      },
      async generate({ model, system, prompt, images = [], json = false, maxTokens }) {
        need();
        if (!model) throw new AiError('invalid_model', '모델이 선택되지 않았습니다.', { hint: HINTS.invalid_model });
        const content = [{ type: 'text', text: prompt }];
        images.forEach((im) => { if (im.label) content.push({ type: 'text', text: im.label }); content.push({ type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.data}` } }); });
        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content });
        const body = { model, messages };
        if (json) body.response_format = { type: 'json_object' };
        if (maxTokens) body.max_completion_tokens = maxTokens;
        const j = await http('POST', base + '/chat/completions', { headers: h(), body });
        const text = (((j.choices || [])[0] || {}).message || {}).content || '';
        if (!text) throw new AiError('bad_request', '빈 응답입니다.', { hint: HINTS.bad_request });
        const u = j.usage || {};
        return { text, json: json ? parseJsonLoose(text) : undefined, usage: { inputTokens: u.prompt_tokens || null, outputTokens: u.completion_tokens || null } };
      },
    };
  }

  if (name === 'anthropic') {
    const base = baseUrl || 'https://api.anthropic.com/v1';
    const h = () => ({ 'x-api-key': getKey(), 'anthropic-version': '2023-06-01' });
    return {
      name,
      supportsImages: true,
      async listModels() {
        need();
        const j = await http('GET', base + '/models?limit=1000', { headers: h() });
        return (j.data || []).map((m) => m.id);
      },
      async generate({ model, system, prompt, images = [], json = false, maxTokens }) {
        need();
        if (!model) throw new AiError('invalid_model', '모델이 선택되지 않았습니다.', { hint: HINTS.invalid_model });
        const content = [];
        images.forEach((im) => { if (im.label) content.push({ type: 'text', text: im.label }); content.push({ type: 'image', source: { type: 'base64', media_type: im.mimeType, data: im.data } }); });
        content.push({ type: 'text', text: prompt + (json ? '\n\nRespond with a single valid JSON object only, no commentary.' : '') });
        const body = { model, max_tokens: maxTokens || 8000, messages: [{ role: 'user', content }] };
        if (system) body.system = system;
        const j = await http('POST', base + '/messages', { headers: h(), body });
        const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (!text) throw new AiError('bad_request', '빈 응답입니다.', { hint: HINTS.bad_request });
        const u = j.usage || {};
        return { text, json: json ? parseJsonLoose(text) : undefined, usage: { inputTokens: u.input_tokens || null, outputTokens: u.output_tokens || null } };
      },
    };
  }
  throw new AiError('bad_request', '알 수 없는 AI 제공자: ' + name);
}

/** Connection test: key present → model list reachable → chosen model valid. Returns a UI-ready state. */
async function testConnection(provider, model) {
  let models;
  try {
    models = await provider.listModels();
  } catch (e) {
    if (!(e instanceof AiError)) throw e;
    if (e.category === 'not_configured') return { state: 'not_configured', message: e.message, hint: e.hint };
    return { state: e.category === 'auth_failed' ? 'auth_failed' : e.category === 'rate_limited' ? 'rate_limited' : e.category === 'unavailable' || e.category === 'network' ? 'unavailable' : e.category, message: e.message, hint: e.hint };
  }
  if (model && !models.includes(model)) {
    return { state: 'invalid_model', message: `모델 "${model}"은(는) 이 계정의 모델 목록에 없습니다.`, hint: HINTS.invalid_model, models };
  }
  return { state: 'connected', message: `연결됨 · 사용 가능한 모델 ${models.length}개` + (model ? ` · "${model}" 확인됨` : ' · 모델을 선택하세요'), hint: '', models };
}

module.exports = { AiError, createProvider, testConnection, categorize, parseJsonLoose, HINTS };
