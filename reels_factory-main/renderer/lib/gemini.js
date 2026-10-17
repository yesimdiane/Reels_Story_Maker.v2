// Minimal Gemini API client for the renderer (the final video check). The key comes from the environment
// (renderer/.env, never Git). Text and inline images in, structured JSON out.
'use strict';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

class GeminiError extends Error {
  /** kind: 'network' | 'http' | 'malformed' (unreadable/empty/truncated JSON) · finishReason when the API reported one */
  constructor(message, extra = {}) {
    super(message);
    this.name = 'GeminiError';
    Object.assign(this, extra);
  }
}

/** opts: { apiKey, model, fetchImpl, timeoutMs }. generateJson({ prompt, images: [{mimeType,data}], schema }) → object. */
function createGeminiClient({ apiKey, model, fetchImpl = fetch, timeoutMs = 120000 }) {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY가 없습니다 (renderer/.env).');
  return {
    model,
    async generateJson({ prompt, images = [], schema }) {
      const parts = [{ text: prompt }];
      images.forEach((im) => {
        if (im.label) parts.push({ text: im.label });
        parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } });
      });
      const body = { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(BASE + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (e) {
        throw new GeminiError('Gemini API에 연결하지 못했습니다: ' + e.message, { kind: 'network' });
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      if (!res.ok) {
        let detail = text;
        try {
          detail = JSON.parse(text).error.message;
        } catch {}
        throw new GeminiError(`Gemini API 오류 (HTTP ${res.status}): ${String(detail).slice(0, 300)}`, { kind: 'http', status: res.status });
      }
      let out;
      let finishReason = '';
      try {
        const j = JSON.parse(text);
        const c = (j.candidates || [])[0];
        finishReason = (c && c.finishReason) || '';
        if (!c || !c.content || !c.content.parts || !c.content.parts[0]) throw new Error('빈 응답' + (finishReason ? ' (' + finishReason + ')' : ''));
        out = JSON.parse(c.content.parts.map((p) => p.text || '').join(''));
      } catch (e) {
        throw new GeminiError('Gemini 응답을 읽을 수 없습니다: ' + e.message, { kind: 'malformed', finishReason, truncated: finishReason === 'MAX_TOKENS' });
      }
      return out;
    },
  };
}

module.exports = { createGeminiClient, GeminiError };
