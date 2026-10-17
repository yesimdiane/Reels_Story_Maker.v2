// Settings → AI Integrations backend: encrypted key management, connection tests, model selection, per-task routing,
// operator-entered prices, spend limits and the live/mock switch. No method ever returns a secret.
//   Connection states: not_configured | connected | auth_failed | invalid_model | rate_limited | quota | unavailable | error
'use strict';
const fs = require('node:fs');
const { StudioError, nowIso, readJson, writeJsonAtomic } = require('./util');
const { testConnection, HINTS } = require('./ai/text');
const { TASKS, TASK_LABELS, TEXT_PROVIDERS } = require('./ai/router');
const { createMuapiProvider } = require('./providers/muapi');

const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', roles: ['제품 이해', '스토리 컨셉', '대본', '스토리보드 프롬프트', '이미지 이해', '이미지 생성(지원 모델)'], text: true },
  { id: 'openai', label: 'OpenAI GPT', roles: ['스토리 컨셉', '대본', '콘텐츠 검토'], text: true },
  { id: 'anthropic', label: 'Anthropic Claude', roles: ['스토리 컨셉', '대본', '콘텐츠 검토'], text: true },
  { id: 'muapi', label: 'Muapi (영상 생성)', roles: ['영상 생성'], text: false, mode: true },
  { id: 'heygen', label: 'HeyGen (음성/아바타)', roles: ['음성'], text: false, mode: true },
];
const STATE_LABEL = { not_configured: '미설정', connected: '연결됨', auth_failed: '인증 실패', invalid_model: '모델 오류', rate_limited: '한도/속도 제한', quota: '크레딧/한도 소진', unavailable: '제공자 응답 없음', error: '오류', untested: '테스트 전' };
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function createIntegrations({ store, vault, runtime, router, usage, cfg, fetchFn = globalThis.fetch, muapiFactory = (o) => createMuapiProvider(o), log = () => {} }) {
  const settings = () => store.settings.get();
  const lists = () => readJson(store.path('model-lists.json'), {});
  const auditFile = store.path('settings-audit.jsonl');
  const audit = (event, data = {}) => { try { fs.appendFileSync(auditFile, JSON.stringify({ at: nowIso(), event, ...data }) + '\n'); } catch (e) { log('audit failed: ' + e.message); } };
  const saveAi = (fn) => {
    const cur = settings();
    const ai = JSON.parse(JSON.stringify(cur.ai));
    fn(ai);
    store.settings.save({ ai });
  };
  const known = (id) => {
    if (!PROVIDERS.some((p) => p.id === id)) throw new StudioError('BAD_PROVIDER', '알 수 없는 제공자입니다: ' + id, { status: 400 });
    return id;
  };

  function modeInfo(id) {
    const req = id === 'muapi' ? runtime.muapiRequested() : runtime.voiceRequested();
    const eff = id === 'muapi' ? runtime.muapiMode() : runtime.voiceMode();
    const envForced = id === 'muapi' ? cfg.muapiMode === 'live' : cfg.studioMode === 'live';
    return { requested: req, effective: eff, envForced, liveWithoutKey: req === 'live' && eff !== 'live' };
  }

  function overview() {
    const s = settings();
    const ml = lists();
    return {
      vault: { keySource: vault.keySource, note: vault.keySource === 'file' ? '개발용 키 파일로 암호화 중입니다. 운영에서는 RF_MASTER_KEY를 설정하세요.' : 'RF_MASTER_KEY로 암호화됩니다.' },
      providers: PROVIDERS.map((p) => {
        const last = (s.ai.lastTest || {})[p.id];
        const key = vault.mask(p.id);
        const state = !key.configured ? 'not_configured' : last ? last.state : 'untested';
        return Object.assign({}, p, { key, model: (s.ai.models || {})[p.id] || '', state, stateLabel: STATE_LABEL[state] || state, lastTest: last || null, models: (ml[p.id] || []).slice(0, 300), modeInfo: p.mode ? modeInfo(p.id) : null });
      }),
      routing: TASKS.map((t) => { const r = router.routeFor(t); return { task: t, label: TASK_LABELS[t], provider: r.provider, model: r.model, explicit: !!(s.ai.routing || {})[t] }; }),
      textProviders: TEXT_PROVIDERS.concat(['mock']),
      pricing: s.ai.pricing || {},
      limits: s.ai.limits || {},
      usage: usage.summary(s.ai.limits),
      stateLabels: STATE_LABEL,
    };
  }

  function setKey(id, secret) {
    known(id);
    vault.set(id, secret);
    saveAi((ai) => { ai.lastTest = Object.assign({}, ai.lastTest); delete ai.lastTest[id]; });
    audit('key.set', { provider: id });
    return overview();
  }
  function removeKey(id) {
    known(id);
    vault.remove(id);
    saveAi((ai) => { ai.lastTest = Object.assign({}, ai.lastTest); delete ai.lastTest[id]; });
    // A provider without a key can never be "live".
    if (id === 'muapi' || id === 'heygen') { const providers = Object.assign({}, settings().providers); providers[id] = { mode: 'mock' }; store.settings.save({ providers }); }
    audit('key.removed', { provider: id });
    return overview();
  }

  async function test(id, model) {
    known(id);
    const s = settings();
    let result;
    if (TEXT_PROVIDERS.includes(id)) {
      const m = model !== undefined ? model : (s.ai.models || {})[id];
      result = await testConnection(router.client(id), m || '');
      if (result.models && result.models.length) { const ml = lists(); ml[id] = result.models; writeJsonAtomic(store.path('model-lists.json'), ml); }
    } else if (id === 'muapi') {
      const key = vault.get('muapi');
      if (!key) result = { state: 'not_configured', message: 'API 키가 없습니다.', hint: 'Settings에서 Muapi 키를 저장하세요.' };
      else {
        try {
          const b = await muapiFactory({ apiKey: key, baseUrl: cfg.muapiBaseUrl, fetchFn }).balance();
          result = { state: 'connected', message: '연결됨 · 잔액 조회 성공' + (b.balance != null ? ` (크레딧 ${b.balance})` : ''), hint: '영상 모델 ID는 Muapi 문서/플레이그라운드로 직접 확인하세요 (모델 목록 검증 API는 확인되지 않음).' };
        } catch (e) {
          const map = { AUTH: 'auth_failed', RATE_LIMIT: 'rate_limited', CREDITS: 'quota', NETWORK: 'unavailable', TIMEOUT: 'unavailable', SERVER: 'unavailable' };
          result = { state: map[e.code] || 'error', message: String(e.message).replace(key, '[redacted]').slice(0, 300), hint: HINTS[map[e.code]] || '' };
        }
      }
    } else if (id === 'heygen') {
      const key = vault.get('heygen');
      if (!key) result = { state: 'not_configured', message: 'API 키가 없습니다.', hint: 'Settings에서 HeyGen 키를 저장하세요.' };
      else {
        try {
          const res = await fetchFn('https://api.heygen.com/v3/voices?type=private&limit=1', { headers: { 'X-Api-Key': key } });
          if (res.ok) result = { state: 'connected', message: '연결됨 · 음성 목록 조회 성공', hint: '' };
          else result = { state: res.status === 401 || res.status === 403 ? 'auth_failed' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'unavailable' : 'error', message: `HeyGen 응답 HTTP ${res.status}`, hint: HINTS[res.status === 401 || res.status === 403 ? 'auth_failed' : 'unavailable'] || '' };
        } catch (e) { result = { state: 'unavailable', message: '연결하지 못했습니다: ' + String(e.message).replace(key, '[redacted]'), hint: HINTS.network || '' }; }
      }
    }
    const saved = { state: result.state, message: result.message, hint: result.hint || '', at: nowIso(), model: model || (s.ai.models || {})[id] || '' };
    saveAi((ai) => { ai.lastTest = Object.assign({}, ai.lastTest, { [id]: saved }); });
    return Object.assign({ provider: id, stateLabel: STATE_LABEL[result.state] }, saved, { models: (result.models || []).slice(0, 300) });
  }

  function validModel(id, model) {
    const l = lists()[id];
    if (l && l.length && !l.includes(model)) throw new StudioError('INVALID_MODEL', `모델 "${model}"은(는) ${id} 모델 목록에 없습니다.`, { recovery: '"연결 테스트"로 목록을 새로 불러오세요.', status: 400 });
    return !!(l && l.length); // true = verified against the provider's list
  }
  function setModel(id, model) {
    known(id);
    if (!TEXT_PROVIDERS.includes(id)) throw new StudioError('BAD_PROVIDER', '이 제공자는 텍스트 모델이 없습니다.', { status: 400 });
    const verified = model ? validModel(id, model) : false;
    saveAi((ai) => { ai.models = Object.assign({}, ai.models, { [id]: String(model || '') }); });
    audit('model.set', { provider: id, model });
    return Object.assign(overview(), { modelVerified: verified });
  }
  function setRouting(task, { provider, model }) {
    if (!TASKS.includes(task)) throw new StudioError('BAD_TASK', '알 수 없는 작업: ' + task, { status: 400 });
    if (!TEXT_PROVIDERS.concat(['mock']).includes(provider)) throw new StudioError('BAD_PROVIDER', '이 작업에 쓸 수 없는 제공자입니다.', { status: 400 });
    if (task === 'imageGeneration' && !['gemini', 'mock'].includes(provider)) throw new StudioError('BAD_PROVIDER', '이미지 생성은 현재 Gemini만 지원합니다.', { status: 400 });
    if (model && provider !== 'mock') validModel(provider, model);
    saveAi((ai) => { ai.routing = Object.assign({}, ai.routing, { [task]: { provider, model: provider === 'mock' ? '' : String(model || '') } }); });
    audit('routing.set', { task, provider, model });
    return overview();
  }
  function setPricing(id, model, p) {
    known(id);
    if (!model) throw new StudioError('NO_MODEL', '모델을 입력하세요.', { status: 400 });
    const i = num(p.inputPer1M);
    const o = num(p.outputPer1M);
    if ((i !== null && !(i >= 0)) || (o !== null && !(o >= 0))) throw new StudioError('BAD_VALUE', '가격은 0 이상의 숫자여야 합니다.', { status: 400 });
    saveAi((ai) => {
      ai.pricing = Object.assign({}, ai.pricing);
      if (i === null && o === null) delete ai.pricing[id + ':' + model];
      else ai.pricing[id + ':' + model] = { inputPer1M: i, outputPer1M: o, enteredAt: nowIso(), note: '운영자가 직접 입력한 값 (공식 가격표를 확인하세요)' };
    });
    return overview();
  }
  function setLimits({ dailyUsd, monthlyUsd }) {
    const d = num(dailyUsd);
    const m = num(monthlyUsd);
    if ((d !== null && !(d >= 0)) || (m !== null && !(m >= 0))) throw new StudioError('BAD_VALUE', '한도는 0 이상의 숫자여야 합니다.', { status: 400 });
    saveAi((ai) => { ai.limits = { dailyUsd: d, monthlyUsd: m }; });
    audit('limits.set', { dailyUsd: d, monthlyUsd: m });
    return overview();
  }

  /** mock → live needs the key AND the typed word LIVE. live → mock is always allowed. Never automatic. */
  function setMode(id, mode, { confirm } = {}) {
    if (!['muapi', 'heygen'].includes(id)) throw new StudioError('BAD_PROVIDER', '모드는 Muapi/HeyGen만 바꿀 수 있습니다.', { status: 400 });
    if (!['mock', 'live'].includes(mode)) throw new StudioError('BAD_VALUE', '모드는 mock 또는 live 여야 합니다.', { status: 400 });
    if (mode === 'live') {
      if (!vault.get(id)) throw new StudioError('NOT_CONFIGURED', `${id} API 키가 없어 실제(live) 모드로 바꿀 수 없습니다.`, { recovery: '먼저 키를 저장하고 연결 테스트를 통과시키세요.', status: 409 });
      if (confirm !== 'LIVE') throw new StudioError('CONFIRM_REQUIRED', '실제(유료) 모드로 바꾸려면 확인란에 LIVE 를 입력하세요.', { recovery: '실제 모드에서도 모든 생성은 화면에서 개별 승인 후에만 실행되며, 한도와 비용 확인을 거칩니다.', status: 409 });
    }
    const providers = Object.assign({}, settings().providers, { [id]: { mode, changedAt: nowIso() } });
    store.settings.save({ providers });
    audit('mode.set', { provider: id, mode });
    return overview();
  }

  const usageView = (limit = 100) => ({ summary: usage.summary(settings().ai.limits), entries: usage.list({ limit }), errors: usage.list({ limit: 500 }).filter((e) => e.status === 'error').slice(0, 50) });
  const auditLog = (limit = 50) => (fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l)).reverse() : []);

  return { overview, setKey, removeKey, test, setModel, setRouting, setPricing, setLimits, setMode, usageView, auditLog, STATE_LABEL, PROVIDERS };
}

module.exports = { createIntegrations, PROVIDERS, STATE_LABEL };
