// How many reference images each image model accepts. NOT one universal number: looked up per provider + model.
//   * built-in table (Gemini image models; counts reported by third-party documentation — confirm in Google's official docs)
//   * an unknown model is "unverified": nothing is enforced and the UI says so (we never invent a limit, and never silently drop images)
//   * ai settings may override per model: settings.aiSettings.refLimits[model] = { maxImages, maxTotalBytes }
'use strict';

const FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
const RULES = [
  { provider: 'gemini', match: /gemini-3[\w.-]*image|nano-banana-pro/i, maxImages: 14, note: '최대 14장 (사람 5장·사물 6장 권장 구성)' },
  { provider: 'gemini', match: /gemini-2\.5-flash-image|nano-banana(?!-pro)/i, maxImages: 3, note: '최대 3장 권장' },
];
const TOTAL_BYTES = 14 * 1024 * 1024; // raw bytes; the request body is base64 (~33% larger) and Gemini's inline request cap is ~20 MB

function limitFor(provider, model, overrides) {
  const o = overrides && overrides[model];
  if (o && Number(o.maxImages) > 0) return { provider, model, maxImages: Number(o.maxImages), maxTotalBytes: Number(o.maxTotalBytes) || TOTAL_BYTES, formats: FORMATS, source: 'settings', note: '설정에서 지정한 한도' };
  const r = RULES.find((x) => x.provider === provider && x.match.test(String(model || '')));
  if (r) return { provider, model, maxImages: r.maxImages, maxTotalBytes: TOTAL_BYTES, formats: FORMATS, source: 'built-in', note: r.note };
  return { provider, model, maxImages: null, maxTotalBytes: TOTAL_BYTES, formats: FORMATS, source: 'unverified', note: '이 모델의 참조 이미지 한도를 확인할 수 없습니다 (개수는 검사하지 않고, 형식·용량만 검사합니다).' };
}

module.exports = { limitFor, FORMATS, TOTAL_BYTES, RULES };
