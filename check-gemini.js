#!/usr/bin/env node
// Checks the Gemini model against the REAL API from a terminal (Mac).
//   GEMINI_API_KEY=... node scripts/check-gemini.js             # free: models.get for default + fallbacks
//   GEMINI_API_KEY=... node scripts/check-gemini.js --generate  # 1 paid call: real PRD-001 script, validated
// Uses the same prompt, schema, model chain and validation as the Apps Script (apps-script/*.gs).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY 환경 변수가 필요합니다 (Google AI Studio 키). 예: GEMINI_API_KEY=... npm run gemini:check');
  process.exit(2);
}
const ctx = vm.createContext({});
for (const f of ['Config.gs', 'Validation.gs', 'States.gs', 'Reels.gs', 'Prompt.gs', 'Fixtures.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
}
const gs = (e) => vm.runInContext(e, ctx);
const base = gs('RF_CONFIG.GEMINI_API_BASE');
const chain = [process.env.GEMINI_MODEL || gs('RF_CONFIG.DEFAULT_GEMINI_MODEL')].concat(Array.from(gs('RF_CONFIG.GEMINI_FALLBACK_MODELS')));

(async () => {
  let use = '';
  for (const model of [...new Set(chain)]) {
    const r = await fetch(base + encodeURIComponent(model), { headers: { 'x-goog-api-key': key } });
    const j = await r.json().catch(() => ({}));
    const ok = r.ok && (j.supportedGenerationMethods || []).includes('generateContent');
    console.log(`${ok ? '✓' : '✗'} ${model} — ${r.ok ? j.displayName || j.name : 'HTTP ' + r.status + ' ' + ((j.error && j.error.message) || '')}`);
    if (ok && !use) use = model;
  }
  if (!use) {
    console.error('✗ 사용 가능한 모델이 없습니다. https://ai.google.dev/gemini-api/docs/models 에서 현재 Flash 모델 ID를 확인해 GEMINI_MODEL로 지정하세요.');
    process.exit(1);
  }
  console.log('사용할 모델: ' + use);
  if (!process.argv.includes('--generate')) {
    console.log('(무료 확인만 했습니다. 실제 JSON 생성까지 확인하려면 --generate — 1회 과금)');
    return;
  }
  const product = gs('FIXTURE_PRD_001_PRODUCT');
  const body = {
    contents: [{ role: 'user', parts: [{ text: gs('buildGeminiPrompt')(product) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: gs('RF_GEMINI_RESPONSE_SCHEMA') },
  };
  const t0 = Date.now();
  const r = await fetch(base + encodeURIComponent(use) + ':generateContent', { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) {
    console.error('✗ generateContent HTTP ' + r.status + ': ' + ((j.error && j.error.message) || ''));
    process.exit(1);
  }
  const text = ((j.candidates || [])[0] || {}).content.parts.map((p) => p.text || '').join('');
  const parsed = gs('parseModelJson')(text);
  const v = parsed.error ? { errors: [parsed.error] } : gs('validateGeminiReels')(parsed.value, product);
  console.log(`generateContent ${((Date.now() - t0) / 1000).toFixed(1)}s, 토큰: ${JSON.stringify(j.usageMetadata || {})}`);
  if (v.errors.length) {
    console.log('! JSON은 받았지만 검증 규칙에 걸렸습니다 (실제 운영에서는 1회 자동 재시도):\n- ' + v.errors.slice(0, 10).join('\n- '));
  } else {
    console.log('✓ 구조화 JSON: 훅 5개 + 대본 ' + v.reels.length + '개 생성 + 검증 통과');
    v.hookSet.hooks.forEach((h) => console.log('  ' + h.id + ' ' + h.label + (h.id === v.hookSet.recommended.id ? ' ★추천' : '') + ': ' + h.text));
    console.log('  추천 이유: ' + v.hookSet.recommended.reason);
    console.log('  댓글 키워드: ' + (v.commentKeyword || '(없음)') + ' · 대본 길이 ' + v.reels[0].scenes.reduce((n, sc) => n + sc.duration_sec, 0) + '초');
  }
})().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
