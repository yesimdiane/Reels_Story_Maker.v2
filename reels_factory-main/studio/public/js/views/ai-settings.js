// Settings → AI 연동 / 프롬프트 매니저 / 사용량·한도. Keys are typed here once, sent over HTTPS to the server and never shown again
// (only "configured · last 4"). Nothing on this page can read a key back.
import { h, chip, icon, toast, modal, confirmDialog, fmtUsd } from '../ui.js';
import { act, state } from '../state.js';
import { api } from '../api.js';
import { asyncBlock } from './common.js';

const STATE_KIND = { connected: 'done', not_configured: '', untested: 'mock', auth_failed: 'err', invalid_model: 'err', rate_limited: 'attention', quota: 'attention', unavailable: 'attention', error: 'err' };
const TASK_HELP = { productUnderstanding: '제품 정보/이미지 이해', storyConcepts: 'Story Lab 컨셉 생성', scriptWriting: 'Script Studio 대본 작성', storyboardPrompts: '스토리보드 프롬프트(이미지 입력 포함)', imageGeneration: '제품 이미지 생성 (Gemini 이미지 지원 모델만)', contentReview: '콘텐츠 검토 (향후)' };

const redo = () => import('../state.js').then(({ hooks }) => hooks.rerender());
async function call(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return null; }
}

// ======================= AI integrations =======================
export function aiIntegrations() {
  return asyncBlock(() => api.get('/api/ai'), (ov) => drawAi(ov));
}

function drawAi(ov) {
  const wrap = h('div', { class: 'stack', style: 'gap:18px' });
  const reload = async () => { const fresh = await api.get('/api/ai'); box.replaceChildren(drawAi(fresh)); };
  const box = h('div');
  wrap.append(h('div', { class: 'banner' }, icon('lock'), h('div', null, h('b', null, 'API 키는 서버의 암호화 저장소(AES-256-GCM)에만 저장됩니다'), '입력한 키는 다시 표시되지 않고(끝 4자리만), 브라우저 코드·로그·응답에 포함되지 않습니다. ' + ov.vault.note)));

  ov.providers.forEach((p) => wrap.append(providerCard(p, ov, reload)));

  // MuAPI video belongs in the same task allocation table, not a separate card below it.
  const videoCfg = state.summary || {};
  const videoModels = videoCfg.models || [];
  const videoPick = { id: videoCfg.settings?.defaultModelId || videoModels[0]?.id || '' };
  const videoRow = h('tr', { 'data-ai-video-routing': '' },
    h('td', null, h('b', null, '애니메이션 영상 생성'), h('div', { class: 'small muted' }, 'Animation Studio 기본 모델 · 장면별 변경 가능')),
    h('td', { 'data-label': '제공자' }, h('span', null, 'muapi')),
    h('td', { 'data-label': '모델' }, h('select', { 'data-ai-video-model': '', 'aria-label': '애니메이션 기본 영상 모델', onchange: (e) => { videoPick.id = e.target.value; } },
      videoModels.map((m) => h('option', { value: m.id, selected: m.id === videoPick.id }, (m.label || m.id) + ' · ' + m.id)))),
    h('td', null, h('button', { class: 'btn sm', type: 'button', 'data-ai-video-save': '', disabled: !videoModels.length, onclick: async () => {
      if (await call(() => api.put('/api/settings', { defaultModelId: videoPick.id }), '애니메이션 기본 모델을 저장했습니다')) redo();
    } }, '저장')));

  // ---- routing ----
  const textProv = ov.textProviders;
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '작업별 AI 배정'), h('span', { class: 'small muted' }, '자동으로 다른 제공자로 바뀌지 않습니다. mock = 샘플 응답(요금 없음)')),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl-stack', 'data-ai-routing-table': '' }, h('thead', null, h('tr', null, ['작업', '제공자', '모델', ''].map((x) => h('th', null, x)))),
      h('tbody', null, ov.routing.map((r) => {
        const f = { provider: r.provider, model: r.model };
        const dl = 'models-' + r.task;
        const prov = ov.providers.find((p) => p.id === f.provider);
        return h('tr', null,
          h('td', null, h('b', null, r.label), h('div', { class: 'small muted' }, TASK_HELP[r.task] || '')),
          h('td', { 'data-label': '제공자' }, h('select', { 'aria-label': r.label + ' 제공자', onchange: (e) => (f.provider = e.target.value) }, textProv.filter((t) => r.task !== 'imageGeneration' || ['gemini', 'mock'].includes(t)).map((t) => h('option', { value: t, selected: t === f.provider }, t === 'mock' ? 'mock (샘플)' : t)))),
          h('td', { 'data-label': '모델' }, h('input', { type: 'text', list: dl, value: f.model, placeholder: '연결 테스트로 불러온 모델', 'aria-label': r.label + ' 모델', oninput: (e) => (f.model = e.target.value) }), h('datalist', { id: dl }, ov.providers.flatMap((p) => (p.models || []).map((m) => h('option', { value: m }))))),
          h('td', null, h('button', { class: 'btn sm', onclick: async () => { if (await call(() => api.put('/api/ai/routing/' + r.task, f), '저장했습니다')) reload(); } }, '저장')));
        void prov;
      }).concat(videoRow)))),
    h('p', { class: 'small muted', style: 'margin:0' }, '모델 ID는 하드코딩하지 않습니다. 각 제공자의 "연결 테스트"가 계정의 실제 모델 목록을 불러오고, 목록에 없는 모델은 저장되지 않습니다.')));

  // ---- pricing ----
  const pairs = new Set();
  ov.routing.forEach((r) => r.provider !== 'mock' && r.model && pairs.add(r.provider + ':' + r.model));
  Object.keys(ov.pricing).forEach((k) => pairs.add(k));
  ov.providers.forEach((p) => p.text && p.model && pairs.add(p.id + ':' + p.model));
  const pr = {};
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('h2', null, '모델 가격 (직접 입력, USD / 100만 토큰)'),
    h('p', { class: 'small muted', style: 'margin:0' }, '가격은 임의로 채우지 않습니다. 각 제공자의 공식 가격표를 보고 직접 입력하세요. 입력하지 않으면 비용은 "알 수 없음"으로 표시되고 한도 검사가 확인을 요구합니다. 이 값으로 계산한 금액은 추정치이며 실제 청구서가 아닙니다.'),
    pairs.size ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['제공자 : 모델', '입력 / 1M', '출력 / 1M', ''].map((x) => h('th', null, x)))), h('tbody', null, [...pairs].map((k) => {
      const cur = ov.pricing[k] || {};
      const [prov, ...rest] = k.split(':');
      const model = rest.join(':');
      pr[k] = { inputPer1M: cur.inputPer1M == null ? '' : cur.inputPer1M, outputPer1M: cur.outputPer1M == null ? '' : cur.outputPer1M };
      return h('tr', null, h('td', { class: 'mono small' }, k),
        h('td', null, h('input', { type: 'number', min: 0, step: 0.01, value: pr[k].inputPer1M, placeholder: '미입력', style: 'width:110px', oninput: (e) => (pr[k].inputPer1M = e.target.value) })),
        h('td', null, h('input', { type: 'number', min: 0, step: 0.01, value: pr[k].outputPer1M, placeholder: '미입력', style: 'width:110px', oninput: (e) => (pr[k].outputPer1M = e.target.value) })),
        h('td', null, h('button', { class: 'btn sm', onclick: async () => { if (await call(() => api.put('/api/ai/pricing', { provider: prov, model, ...pr[k] }), '가격을 저장했습니다')) reload(); } }, '저장')));
    })))) : h('p', { class: 'small muted', style: 'margin:0' }, '모델을 지정하면 여기에 가격 입력란이 나타납니다.')));

  // ---- limits ----
  const lim = { dailyUsd: ov.limits.dailyUsd == null ? '' : ov.limits.dailyUsd, monthlyUsd: ov.limits.monthlyUsd == null ? '' : ov.limits.monthlyUsd };
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '지출 한도'), h('button', { class: 'btn sm', onclick: async () => { if (await call(() => api.put('/api/ai/limits', lim), '한도를 저장했습니다')) reload(); } }, '저장')),
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '일일 한도 (USD, UTC 기준)'), h('input', { type: 'number', min: 0, step: 0.5, value: lim.dailyUsd, placeholder: '제한 없음', oninput: (e) => (lim.dailyUsd = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '월 한도 (USD, UTC 기준)'), h('input', { type: 'number', min: 0, step: 1, value: lim.monthlyUsd, placeholder: '제한 없음', oninput: (e) => (lim.monthlyUsd = e.target.value) }))),
    h('div', { class: 'small muted' }, `오늘 ${fmtUsd(ov.usage.today.usd)} · 이번 달 ${fmtUsd(ov.usage.month.usd)} (추정/계산 합계, ${ov.usage.period}) · 영상 지출은 에피소드 원장에서 함께 합산됩니다. 한도를 넘는 호출은 실행 전에 차단됩니다.`)));
  box.append(wrap);
  return box;
}

function providerCard(p, ov, reload) {
  const f = { key: '', model: p.model };
  const keyInput = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: p.key.configured ? `저장됨 · …${p.key.last4} (${p.key.source === 'vault' ? '암호화 저장소' : '서버 환경변수'}) — 바꾸려면 새 키 입력` : 'API 키 붙여넣기', 'aria-label': p.label + ' API 키', oninput: (e) => (f.key = e.target.value) });
  const out = h('div');
  const showResult = (r) => out.replaceChildren(h('div', { class: 'banner ' + (r.state === 'connected' ? 'ok' : r.state === 'rate_limited' || r.state === 'quota' || r.state === 'unavailable' ? 'warn' : 'err') }, chip(r.stateLabel || r.state, STATE_KIND[r.state] || ''), h('div', null, r.message, r.hint ? h('div', { class: 'small' }, '→ ' + r.hint) : null)));
  if (p.lastTest) showResult(Object.assign({ stateLabel: ov.stateLabels[p.lastTest.state] }, p.lastTest));
  const dl = 'dl-' + p.id;
  const modelInput = p.text ? h('div', { class: 'field' }, h('label', null, '기본 모델'), h('div', { class: 'row', style: 'flex-wrap:nowrap' },
    h('input', { type: 'text', list: dl, value: f.model, placeholder: '연결 테스트 후 목록에서 선택', 'aria-label': p.label + ' 모델', oninput: (e) => (f.model = e.target.value) }), h('datalist', { id: dl }, (p.models || []).map((m) => h('option', { value: m }))),
    h('button', { class: 'btn sm', onclick: async () => { if (await call(() => api.put('/api/ai/models/' + p.id, { model: f.model }), '모델을 저장했습니다')) reload(); } }, '저장'))) : null;
  return h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, p.label), h('div', { class: 'small muted' }, '용도: ' + p.roles.join(' · '))), chip(p.stateLabel, STATE_KIND[p.state] || '')),
    h('div', { class: 'field' }, h('label', null, 'API 키'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, keyInput,
      h('button', { class: 'btn sm', onclick: async () => { if (!f.key.trim()) return toast('키를 입력하세요', { error: true }); const r = await call(() => api.put('/api/ai/keys/' + p.id, { key: f.key.trim() }), '키를 안전하게 저장했습니다'); f.key = ''; keyInput.value = ''; if (r) reload(); } }, '저장'),
      p.key.configured && p.key.source === 'vault' ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog({ title: p.label + ' 키를 삭제할까요?', body: '저장된 키가 지워지고, 이 제공자를 쓰는 작업은 실행되지 않습니다(다른 제공자로 자동 전환되지 않습니다).', tone: 'clay', confirm: '삭제' })) { await call(() => api.del('/api/ai/keys/' + p.id), '삭제했습니다'); reload(); } } }, '삭제') : null)),
    modelInput,
    p.modeInfo ? modeRow(p, reload) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', disabled: !p.key.configured, onclick: async (e) => { e.target.disabled = true; const r = await call(() => api.post('/api/ai/test/' + p.id, { model: f.model || undefined })); e.target.disabled = !p.key.configured; if (r) { showResult(r); if (r.models && r.models.length) toast(`모델 ${r.models.length}개를 불러왔습니다`); reload(); } } }, icon('refresh'), '연결 테스트'),
      p.id === 'muapi' ? h('span', { class: 'small muted' }, '잔액 조회만 호출합니다(생성 호출 아님).') : p.id === 'heygen' ? h('span', { class: 'small muted' }, '음성 목록 1건 조회만 호출합니다.') : h('span', { class: 'small muted' }, '모델 목록 조회만 호출합니다(생성 호출 아님).')),
    out);
}

function modeRow(p, reload) {
  const m = p.modeInfo;
  const eff = m.effective === 'live';
  return h('div', { class: 'card flat stack', style: 'gap:8px' },
    h('div', { class: 'row between' }, h('b', null, '실행 모드'), h('div', { class: 'row', style: 'gap:6px' }, chip('요청: ' + m.requested.toUpperCase(), m.requested === 'live' ? 'live' : 'mock'), chip('실제 동작: ' + m.effective.toUpperCase(), eff ? 'live' : 'mock'))),
    m.liveWithoutKey ? h('div', { class: 'banner warn' }, 'LIVE가 요청됐지만 키가 없어 MOCK으로 동작합니다. 실제 호출은 발생하지 않습니다.') : null,
    m.envForced ? h('div', { class: 'small muted' }, '서버 환경변수로 LIVE가 강제되어 있습니다(화면에서 끌 수 없음).') : null,
    h('div', { class: 'row' },
      m.requested === 'live' && !m.envForced ? h('button', { class: 'btn sm ghost', onclick: async () => { if (await call(() => api.put('/api/ai/mode/' + p.id, { mode: 'mock' }), 'MOCK 모드로 바꿨습니다')) reload(); } }, 'MOCK으로 되돌리기') : null,
      m.requested !== 'live' ? h('button', { class: 'btn sm clay', disabled: !p.key.configured, title: p.key.configured ? '' : '먼저 키를 저장하세요', onclick: () => goLive(p, reload) }, '실제(LIVE) 모드 켜기…') : null),
    h('div', { class: 'small muted' }, 'LIVE에서도 모든 유료 생성은 개별 비용 확인과 승인 후에만 실행됩니다. 이 설정을 바꾸면 기록(감사 로그)됩니다.'));
}

function goLive(p, reload) {
  let typed = '';
  modal((close) => h('div', { class: 'stack' }, h('h2', null, p.label + ' 실제(LIVE) 모드'),
    h('div', { class: 'banner warn' }, h('div', null, h('b', null, '이후 승인한 생성 작업은 실제 요금이 발생할 수 있습니다'), '켜는 것만으로 호출하지는 않습니다. 각 생성은 비용 확인·승인 화면을 거치며, 일일/월 한도와 에피소드별 한도가 적용됩니다.')),
    h('div', { class: 'field' }, h('label', null, '확인을 위해 LIVE 를 입력하세요'), h('input', { type: 'text', autocomplete: 'off', oninput: (e) => (typed = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn clay', onclick: async () => { const r = await call(() => api.put('/api/ai/mode/' + p.id, { mode: 'live', confirm: typed.trim() }), 'LIVE 모드를 켰습니다'); if (r) { close(); reload(); } } }, 'LIVE 켜기'))));
}

// ======================= Prompt manager =======================
const view = { key: 'storyConcept' };
const USED_BY = { storyConcept: 'Story Lab (컨셉 생성)', script: 'Script Studio (대본 생성)', storyboard: '스토리보드 AI 프롬프트', characterConsistency: 'Story Lab · Script · Storyboard에 함께 적용', productAccuracy: 'Story Lab · Script · Storyboard에 함께 적용', ctaAffiliate: 'Story Lab · Script에 함께 적용' };

export function promptManager() {
  return asyncBlock(() => api.get('/api/prompts'), (d) => drawPrompts(d));
}

function drawPrompts(d) {
  const root = h('div');
  const reload = async () => { root.replaceChildren(drawPrompts(await api.get('/api/prompts'))); };
  const cur = d.prompts.find((p) => p.key === view.key) || d.prompts[0];
  const f = { text: cur.text, note: '', provider: cur.provider, model: cur.model };
  const ch = Object.assign({}, d.channel);
  const wrap = h('div', { class: 'stack', style: 'gap:18px' });
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, '채널 설정'), h('button', { class: 'btn sm', onclick: async () => { if (await call(() => api.put('/api/channel', ch), '채널 설정을 저장했습니다')) reload(); } }, '저장')),
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '채널 이름 ({{CHANNEL}})'), h('input', { type: 'text', value: ch.name, oninput: (e) => (ch.name = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '타깃 시청자 ({{AUDIENCE}})'), h('input', { type: 'text', value: ch.audience, oninput: (e) => (ch.audience = e.target.value) }))),
    h('div', { class: 'field' }, h('label', null, '브랜딩 ({{BRANDING}})'), h('textarea', { rows: 2, oninput: (e) => (ch.branding = e.target.value) }, ch.branding))));

  const list = h('div', { class: 'list' }, d.prompts.map((p) => h('div', { class: 'item', style: 'cursor:pointer;' + (p.key === cur.key ? 'background:var(--paper);border-radius:10px;padding-left:10px' : ''), onclick: () => { view.key = p.key; reload(); } }, h('div', { class: 'grow' }, h('div', { class: 't' }, p.title), h('div', { class: 'small muted' }, `v${p.current}${p.isDefault ? ' · 기본값' : ' · 수정됨'}`)))));
  const ta = h('textarea', { rows: 22, spellcheck: 'false', style: 'font-family:var(--mono);font-size:12.5px', 'aria-label': cur.title, oninput: (e) => (f.text = e.target.value) }, f.text);
  const prev = h('div');
  const editor = h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, cur.title), h('div', { class: 'small muted' }, cur.description)), chip('현재 v' + cur.current, 'done')),
    h('div', { class: 'small' }, '적용 위치: ' + USED_BY[cur.key] + ' — 저장하면 다음 생성부터 이 버전이 쓰이고, 결과에는 사용한 프롬프트 버전이 기록됩니다.'),
    ta,
    h('div', { class: 'grid three' },
      h('div', { class: 'field' }, h('label', null, '변경 메모'), h('input', { type: 'text', placeholder: '무엇을 왜 바꿨나요 (선택)', oninput: (e) => (f.note = e.target.value) })),
      h('div', { class: 'field' }, h('label', null, '이 프롬프트의 제공자 (선택, 비우면 작업 배정 사용)'), h('select', { onchange: (e) => (f.provider = e.target.value) }, [['', '작업 배정 따름'], ['gemini', 'gemini'], ['openai', 'openai'], ['anthropic', 'anthropic']].map(([v, l]) => h('option', { value: v, selected: v === f.provider }, l)))),
      h('div', { class: 'field' }, h('label', null, '이 프롬프트의 모델 (선택)'), h('input', { type: 'text', value: f.model, oninput: (e) => (f.model = e.target.value) }))),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { if (await call(() => api.put('/api/prompts/' + cur.key, { text: f.text, note: f.note, provider: f.provider, model: f.model }), '새 버전으로 저장했습니다')) reload(); } }, '저장 (새 버전)'),
      h('button', { class: 'btn ghost', onclick: async () => { const r = await call(() => api.post(`/api/prompts/${cur.key}/preview`, { vars: {} })); if (r) prev.replaceChildren(h('pre', { class: 'prompt' }, r.text)); } }, '미리보기 (변수 채움)'),
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: '기본값으로 복원할까요?', body: '기본 프롬프트가 새 버전으로 추가됩니다. 이전 버전은 기록에 남습니다.', tone: 'clay', confirm: '복원' })) { await call(() => api.post(`/api/prompts/${cur.key}/restore`, { toDefault: true }), '기본값을 새 버전으로 복원했습니다'); reload(); } } }, '기본값으로 복원')),
    prev,
    h('details', null, h('summary', { class: 'small' }, `버전 기록 (${cur.versions.length})`), h('div', { class: 'list' }, cur.versions.slice().reverse().map((v) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `v${v.v}${v.v === cur.current ? ' · 현재' : ''}${v.default ? ' · 기본값' : ''}`), h('div', { class: 'small muted' }, new Date(v.at).toLocaleString('ko-KR') + ' · ' + v.by + (v.note ? ' · ' + v.note : '') + ` · ${v.chars}자`)),
      h('button', { class: 'btn sm ghost', onclick: async () => { const r = await call(() => api.get(`/api/prompts/${cur.key}/versions/${v.v}`)); if (r) modal((close) => h('div', { class: 'stack' }, h('h2', null, `${cur.title} · v${v.v}`), h('pre', { class: 'prompt' }, r.text), h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '닫기'), v.v !== cur.current ? h('button', { class: 'btn', onclick: async () => { await call(() => api.post(`/api/prompts/${cur.key}/restore`, { version: v.v }), `v${v.v}을 새 버전으로 복원했습니다`); close(); reload(); } }, '이 버전으로 복원') : null)), { wide: true }); } }, '보기'))))));
  wrap.append(h('div', { class: 'split prompt-split' }, h('div', { class: 'card tight' }, list), editor));
  root.append(wrap);
  return root;
}

// ======================= Usage =======================
export function usagePanel() {
  return asyncBlock(() => Promise.all([api.get('/api/ai/usage'), api.get('/api/ai/audit')]), ([u, audit]) => {
    const s = u.summary;
    const row = (e) => h('tr', null,
      h('td', { class: 'small' }, new Date(e.at).toLocaleString('ko-KR')),
      h('td', null, e.kind), h('td', { class: 'mono small' }, e.mock ? '샘플' : e.provider + ' / ' + e.model), h('td', { class: 'small' }, e.task),
      h('td', null, e.status === 'ok' ? chip('성공', 'done') : e.status === 'error' ? chip('오류', 'err') : chip(e.status, '')),
      h('td', { class: 'small' }, e.mock ? '$0 (샘플)' : e.actualUsd != null ? fmtUsd(e.actualUsd) + ' (계산)' : e.estimatedUsd != null ? fmtUsd(e.estimatedUsd) + ' (추정)' : '알 수 없음'),
      h('td', { class: 'small', style: 'color:var(--rose)' }, e.error || ''));
    return h('div', { class: 'stack', style: 'gap:18px' },
      h('div', { class: 'stat-row' },
        stat(fmtUsd(s.today.usd), '오늘 (추정/계산)', s.limits.dailyUsd != null ? `일일 한도 ${fmtUsd(s.limits.dailyUsd)}` : '일일 한도 없음'),
        stat(fmtUsd(s.month.usd), '이번 달 (추정/계산)', s.limits.monthlyUsd != null ? `월 한도 ${fmtUsd(s.limits.monthlyUsd)}` : '월 한도 없음'),
        stat(String(s.today.unknownCostCalls), '오늘 비용 미상 호출', '가격 미입력 모델'),
        stat(String(u.errors.length), '최근 오류')),
      h('p', { class: 'small muted', style: 'margin:0' }, s.note + ' (' + s.period + ')  실제 청구는 각 제공자의 청구서/대시보드가 기준입니다.'),
      h('div', { class: 'card' }, h('h2', null, '사용 내역'), u.entries.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['시각', '종류', '제공자/모델', '작업', '상태', '비용', '오류'].map((x) => h('th', null, x)))), h('tbody', null, u.entries.map(row)))) : h('p', { class: 'muted' }, '아직 기록이 없습니다.')),
      h('div', { class: 'card' }, h('h2', null, '설정 변경 기록'), audit.length ? h('div', { class: 'list' }, audit.map((a) => h('div', { class: 'item' }, h('div', { class: 'grow small' }, new Date(a.at).toLocaleString('ko-KR') + ' · ' + a.event + ' ' + Object.entries(a).filter(([k]) => !['at', 'event'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' '))))) : h('p', { class: 'muted' }, '기록이 없습니다.')));
  });
}
const stat = (n, l, sub) => h('div', { class: 'stat' }, h('div', { class: 'n' }, String(n)), h('div', { class: 'l' }, l), sub && h('div', { class: 'small muted' }, sub));
void act;
