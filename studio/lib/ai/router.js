// AI router: picks provider+model per task from Settings (never auto-switches to another provider), checks the
// spend limits BEFORE the call, requires an explicit confirmation for billable calls, blocks duplicate in-flight
// jobs, records every call in the usage ledger and returns which provider/model produced the result.
//   Tasks: productUnderstanding | storyConcepts | scriptWriting | storyboardPrompts | imageGeneration | contentReview
//   Mock is used ONLY when the operator routed the task to "mock" (default for a fresh install, labelled as sample).
'use strict';
const { StudioError, sha256 } = require('../util');
const { AiError, createProvider } = require('./text');
const { createMockText } = require('./mock');
const { estimateText } = require('../usage');

const TASKS = ['productUnderstanding', 'storyConcepts', 'scriptWriting', 'storyboardPrompts', 'imageGeneration', 'contentReview'];
const TASK_LABELS = {
  productUnderstanding: '제품 이해',
  storyConcepts: '스토리 컨셉',
  scriptWriting: '대본 작성',
  storyboardPrompts: '스토리보드 프롬프트',
  imageGeneration: '제품 이미지 생성',
  contentReview: '콘텐츠 검토',
};
const TEXT_PROVIDERS = ['gemini', 'openai', 'anthropic'];
const DEFAULT_ROUTING = Object.fromEntries(TASKS.map((t) => [t, { provider: 'mock', model: '' }]));

function createAiRouter({ store, vault, usage, fetchFn = globalThis.fetch, providerFactory = null, log = () => {} }) {
  const mock = createMockText();
  const inflight = new Set();
  const cache = new Map();

  const aiSettings = () => Object.assign({ routing: {}, pricing: {}, limits: {}, models: {} }, store.settings.get().ai || {});

  function routeFor(task, override) {
    if (!TASKS.includes(task)) throw new StudioError('BAD_TASK', '알 수 없는 AI 작업: ' + task);
    const s = aiSettings();
    const r = Object.assign({}, DEFAULT_ROUTING[task], s.routing[task] || {}, override && override.provider ? override : {});
    return { provider: r.provider || 'mock', model: r.model || (s.models || {})[r.provider] || '' };
  }

  function client(name) {
    if (name === 'mock') return mock;
    if (providerFactory) return providerFactory(name);
    if (!cache.has(name)) cache.set(name, createProvider(name, { getKey: () => vault.get(name), fetchFn }));
    return cache.get(name);
  }

  /** Pre-call estimate. usd === null means "unknown" (price not entered) — never shown as zero. */
  function estimate(task, { inputChars = 0, outputTokens = 3000, images = 0, override } = {}) {
    const r = routeFor(task, override);
    if (r.provider === 'mock') return Object.assign({}, r, { mock: true, usd: 0, billable: false, note: '샘플 응답 (실제 AI 호출 없음)' });
    const e = estimateText(aiSettings().pricing, r.provider, r.model, inputChars, outputTokens, images);
    return Object.assign({}, r, { mock: false, billable: true, usd: e.usd, inputTokens: e.inputTokens, outputTokens: e.outputTokens, note: e.usd == null ? '가격 미입력 — 비용을 알 수 없습니다' : '추정치 (실제 청구서 아님)' });
  }

  function configuredStatus() {
    return Object.fromEntries(TEXT_PROVIDERS.map((p) => [p, vault.mask(p)]));
  }

  /**
   * opts: { system, prompt, images, json, maxTokens, override, confirm:{paid:true, unknownCost:false}, label, dedupeKey }
   * Returns { text, json, usage, provider, model, mock, estimate }.
   */
  async function run(task, opts) {
    const r = routeFor(task, opts.override);
    const est = estimate(task, { inputChars: String(opts.system || '').length + String(opts.prompt || '').length, outputTokens: opts.maxTokens || 3000, images: (opts.images || []).length, override: opts.override });
    const label = TASK_LABELS[task] || task;
    if (r.provider === 'mock') {
      const out = await mock.generate({ task, prompt: opts.prompt, images: opts.images || [], json: opts.json });
      usage.record({ kind: 'text', provider: 'mock', model: 'mock', task, mock: true, status: 'ok' });
      return Object.assign({}, out, { provider: 'mock', model: 'mock', mock: true, estimate: est });
    }
    if (!TEXT_PROVIDERS.includes(r.provider)) throw new StudioError('BAD_PROVIDER', `"${r.provider}"은(는) ${label}에 쓸 수 없는 제공자입니다.`, { status: 400 });
    if (!vault.get(r.provider)) throw new StudioError('NOT_CONFIGURED', `${label}: ${r.provider} API 키가 없습니다.`, { recovery: 'Settings → AI Integrations에서 키를 저장하거나, 이 작업의 제공자를 바꾸세요. (다른 제공자로 자동 전환하지 않습니다.)', status: 409 });
    if (!r.model) throw new StudioError('NO_MODEL', `${label}: ${r.provider} 모델이 선택되지 않았습니다.`, { recovery: 'Settings → AI Integrations에서 "연결 테스트"로 모델 목록을 불러와 선택하세요.', status: 409 });
    if (!(opts.confirm && opts.confirm.paid === true)) throw new StudioError('CONFIRM_REQUIRED', `${label}: ${r.provider}/${r.model} 호출은 유료일 수 있습니다. 확인 후 다시 실행하세요.`, { details: est, recovery: est.usd == null ? '예상 비용을 알 수 없습니다(가격 미입력).' : `예상 비용(추정) 약 $${est.usd}`, status: 409 });
    const dedupe = (opts.dedupeKey || '') + ':' + task + ':' + sha256(String(opts.prompt)).slice(0, 16);
    if (inflight.has(dedupe)) throw new StudioError('DUPLICATE_JOB', `${label}: 같은 요청이 이미 진행 중입니다.`, { status: 409 });
    usage.checkLimits(aiSettings().limits, est.usd, { confirmUnknownCost: !!(opts.confirm && opts.confirm.unknownCost), label });
    inflight.add(dedupe);
    try {
      const out = await client(r.provider).generate({ model: r.model, system: opts.system, prompt: opts.prompt, images: opts.images || [], json: !!opts.json, maxTokens: opts.maxTokens });
      const u = out.usage || {};
      const calc = u.inputTokens != null ? require('../usage').priceTokens(aiSettings().pricing, r.provider, r.model, u.inputTokens, u.outputTokens) : null;
      usage.record({ kind: 'text', provider: r.provider, model: r.model, task, status: 'ok', estimatedUsd: est.usd, actualUsd: calc, tokens: u });
      return Object.assign({}, out, { provider: r.provider, model: r.model, mock: false, estimate: est });
    } catch (e) {
      usage.record({ kind: 'text', provider: r.provider, model: r.model, task, status: 'error', estimatedUsd: null, error: (e.category || e.code || 'error') + ': ' + String(e.message).slice(0, 300) });
      if (e instanceof AiError) throw new StudioError('AI_' + e.category.toUpperCase(), `${r.provider}: ${e.message}`, { recovery: e.hint || '', status: e.category === 'rate_limited' ? 429 : 502, details: { category: e.category } });
      throw e;
    } finally {
      inflight.delete(dedupe);
    }
  }

  /** Image generation (Gemini image-capable models only). Same safeguards as run(); never mock. */
  async function runImage(task, opts) {
    const r = routeFor(task, opts.override);
    const label = TASK_LABELS[task] || task;
    if (r.provider !== 'gemini') throw new StudioError('NOT_CONFIGURED', `${label}: 이미지 생성 제공자가 연결되지 않았습니다.`, { recovery: 'Settings → AI Integrations에서 Gemini 키와 이미지 생성 가능한 모델을 선택하고, 작업 배정에서 "제품 이미지 생성"을 Gemini로 지정하세요.', status: 409 });
    if (!vault.get('gemini')) throw new StudioError('NOT_CONFIGURED', `${label}: Gemini API 키가 없습니다.`, { recovery: 'Settings → AI Integrations에서 키를 저장하세요.', status: 409 });
    if (!r.model) throw new StudioError('NO_MODEL', `${label}: 이미지 생성 모델이 선택되지 않았습니다.`, { status: 409 });
    const est = estimate(task, { inputChars: String(opts.prompt).length, outputTokens: 1500, images: (opts.images || []).length, override: opts.override });
    if (!(opts.confirm && opts.confirm.paid === true)) throw new StudioError('CONFIRM_REQUIRED', `${label}: ${r.model} 호출은 유료일 수 있습니다. 확인 후 다시 실행하세요.`, { details: est, recovery: est.usd == null ? '예상 비용을 알 수 없습니다(가격 미입력).' : `예상 비용(추정) 약 $${est.usd}`, status: 409 });
    usage.checkLimits(aiSettings().limits, est.usd, { confirmUnknownCost: !!opts.confirm.unknownCost, label });
    try {
      const out = await client('gemini').generateImage({ model: r.model, prompt: opts.prompt, images: opts.images || [] });
      const u = out.usage || {};
      const calc = u.inputTokens != null ? require('../usage').priceTokens(aiSettings().pricing, 'gemini', r.model, u.inputTokens, u.outputTokens) : null;
      usage.record({ kind: 'image', provider: 'gemini', model: r.model, task, status: 'ok', estimatedUsd: est.usd, actualUsd: calc, tokens: u });
      return Object.assign({}, out, { provider: 'gemini', model: r.model });
    } catch (e) {
      usage.record({ kind: 'image', provider: 'gemini', model: r.model, task, status: 'error', error: (e.category || 'error') + ': ' + String(e.message).slice(0, 300) });
      if (e instanceof AiError) throw new StudioError('AI_' + e.category.toUpperCase(), `gemini: ${e.message}`, { recovery: e.hint || '', status: 502 });
      throw e;
    }
  }

  return { run, runImage, estimate, routeFor, client, configuredStatus, TASKS, TASK_LABELS, TEXT_PROVIDERS, DEFAULT_ROUTING };
}

module.exports = { createAiRouter, TASKS, TASK_LABELS, TEXT_PROVIDERS, DEFAULT_ROUTING };
