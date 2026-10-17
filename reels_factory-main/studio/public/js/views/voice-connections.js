// Settings → 음성 연결: provider credentials (write-only), connection tests, voice sync and the unified voice library.
// Also exports the shared voice picker used by the Character Library. Nothing here generates audio unless the
// user presses a preview button and (in LIVE mode) confirms the exact cost.
import { h, chip, toast, confirmDialog, fmtUsd } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { confirmPaid } from './common.js';

const KIND = { connected: 'done', untested: 'attention', not_configured: '', auth_failed: 'err', rate_limited: 'attention', unavailable: 'attention', error: 'err' };
const when = (t) => (t ? new Date(t).toLocaleString('ko-KR') : '아직 없음');
const call = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } await act(async () => null); };

function statusBlock(c) {
  return h('div', { class: 'stack', style: 'gap:4px' },
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, chip(c.stateLabel || c.state, KIND[c.state] || ''), chip(`음성 ${c.voiceCount}개`, '')),
    c.message ? h('div', { class: 'small', style: 'color:#8a4e2c' }, c.message) : null,
    h('div', { class: 'small muted' }, '마지막 연결 테스트: ' + when(c.testedAt) + ' · 마지막 동기화: ' + when(c.syncedAt)));
}
function actions(c, extra) {
  const busy = { v: false };
  const run = (label, fn, ok, cls = 'ghost') => h('button', { class: 'btn sm ' + cls, type: 'button', disabled: !c.configured, onclick: () => call(fn, ok) }, label);
  return h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, extra || null,
    run('연결 테스트', () => api.post(`/api/voices/${c.provider}/test`), (r) => r.stateLabel || '테스트 완료'),
    run('음성 목록 가져오기', () => api.post(`/api/voices/${c.provider}/sync`), (r) => `음성 ${r.count}개를 동기화했습니다 (요금 없음)`),
    h('button', { class: 'btn sm ghost danger', type: 'button', disabled: !c.configured, onclick: async () => { if (await confirmDialog({ title: `${c.label} 연결을 해제할까요?`, body: '서버에 저장된 자격 증명과 이 제공자의 음성 목록이 삭제됩니다. 캐릭터에 지정된 목소리는 "사용 불가"로 표시됩니다.', confirm: '연결 해제', tone: 'danger' })) call(() => api.del('/api/voices/' + c.provider), '연결을 해제했습니다'); } }, '연결 해제'));
}

function googleCard(c) {
  const f = { mode: c.mode || 'service_account', json: '', key: '', project: c.projectId || '' };
  const body = h('div', { class: 'stack', style: 'gap:10px' });
  const draw = () => {
    body.replaceChildren(
      h('div', { class: 'field' }, h('label', null, '인증 방식'), h('select', { 'data-google-mode': '', onchange: (e) => { f.mode = e.target.value; draw(); } },
        [['service_account', '서비스 계정 JSON (권장)'], ['adc', '서버 기본 자격 증명 (ADC)'], ['api_key', 'API 키']].map(([v, l]) => h('option', { value: v, selected: f.mode === v }, l)))),
      h('div', { class: 'field' }, h('label', null, '프로젝트 ID (선택)'), h('input', { type: 'text', class: 'mono', value: f.project, placeholder: 'my-project-123456', oninput: (e) => (f.project = e.target.value) })),
      f.mode === 'service_account' ? h('div', { class: 'field' }, h('label', null, '서비스 계정 키 JSON'), h('textarea', { rows: 4, class: 'mono', 'data-google-json': '', autocomplete: 'off', placeholder: c.mode === 'service_account' && c.configured ? `저장됨 (${c.clientEmail}) — 바꾸려면 새 JSON을 붙여넣으세요` : '{ "type": "service_account", ... }', oninput: (e) => (f.json = e.target.value) }), h('div', { class: 'small muted' }, '붙여넣은 키는 서버 암호화 저장소에만 저장되고 다시 표시되지 않습니다.')) : null,
      f.mode === 'api_key' ? h('div', { class: 'field' }, h('label', null, 'Google Cloud API 키'), h('input', { type: 'password', class: 'mono', 'data-google-key': '', autocomplete: 'off', placeholder: c.mode === 'api_key' && c.configured ? '저장됨 …' + c.apiKeyLast4 : '', oninput: (e) => (f.key = e.target.value) })) : null,
      f.mode === 'adc' ? h('div', { class: 'small muted' }, c.adc && (c.adc.file || c.adc.metadata) ? '이 서버에서 기본 자격 증명을 찾았습니다.' : '이 서버에서 기본 자격 증명을 찾지 못했습니다. GOOGLE_APPLICATION_CREDENTIALS 환경변수를 설정하세요.') : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn sm', type: 'button', 'data-google-save': '', onclick: () => call(async () => { const r = await api.put('/api/voices/google/credentials', { mode: f.mode, serviceAccountJson: f.json, apiKey: f.key, projectId: f.project }); f.json = ''; f.key = ''; return r; }, '자격 증명을 저장했습니다 — 연결 테스트를 실행하세요') }, '저장')));
  };
  draw();
  return h('section', { class: 'card stack', style: 'gap:12px', 'data-voice-provider': 'google' },
    h('div', { class: 'card-head' }, h('h2', null, 'Google Cloud Text-to-Speech'), chip(c.stateLabel || c.state, KIND[c.state] || '')),
    statusBlock(c), body, actions(c));
}
function heygenCard(c) {
  const f = { key: '' };
  return h('section', { class: 'card stack', style: 'gap:12px', 'data-voice-provider': 'heygen' },
    h('div', { class: 'card-head' }, h('h2', null, 'HeyGen'), chip(c.stateLabel || c.state, KIND[c.state] || '')),
    statusBlock(c),
    h('div', { class: 'field' }, h('label', null, 'HeyGen API 키'), h('input', { type: 'password', class: 'mono', 'data-heygen-key': '', autocomplete: 'off', placeholder: c.configured ? '저장됨 …' + (c.keyLast4 || '') + (c.keySource === 'env' ? ' (서버 환경변수)' : '') : '', oninput: (e) => (f.key = e.target.value) }), h('div', { class: 'small muted' }, '내 음성(클론)과 공개 음성을 가져옵니다. 목록 조회는 음성을 생성하지 않아 요금이 없습니다.')),
    (c.notes || []).map((n) => h('div', { class: 'small muted' }, n)),
    actions(c, h('button', { class: 'btn sm', type: 'button', 'data-heygen-save': '', onclick: () => call(async () => { const r = await api.put('/api/voices/heygen/key', { key: f.key }); f.key = ''; return r; }, 'API 키를 저장했습니다 — 연결 테스트를 실행하세요') }, '키 저장')));
}

/** Preview one catalog voice. Hosted samples and MOCK tones are free; LIVE synthesis needs an exact-cost confirmation. */
export async function previewVoice(v, audio) {
  try {
    const est = await api.post('/api/voices/preview/estimate', { provider: v.provider, voiceId: v.id });
    let confirm;
    if (!est.free) {
      const c = await confirmPaid({ title: '미리듣기는 실제 음성을 한 번 생성합니다', est: { provider: v.provider === 'google' ? 'Google Cloud TTS' : 'HeyGen', model: v.name, usd: est.usd, note: `${est.chars}자. ${est.note}` }, confirmLabel: '미리듣기 생성' });
      if (!c.paid) return;
      confirm = { paid: true, chars: est.chars, unknownCost: !!c.unknownCost };
    }
    const r = await api.post('/api/voices/preview', { provider: v.provider, voiceId: v.id, confirm });
    audio.src = r.url; await audio.play().catch(() => {});
    if (!r.estimate.free) toast('미리듣기 생성 ' + (r.estimate.usd != null ? fmtUsd(r.estimate.usd) : ''));
  } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
}

function library(ov) {
  const q = state.voiceFilter || (state.voiceFilter = { provider: '', language: '', type: '', q: '' });
  const out = h('div', { class: 'stack', style: 'gap:6px' });
  const audio = h('audio', { controls: true, preload: 'none', style: 'height:34px;max-width:100%' });
  const load = async () => {
    const r = await api.get('/api/voices/list?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, x]) => x))).toString());
    out.replaceChildren(h('div', { class: 'small muted' }, `${r.total}개 중 ${r.voices.length}개 표시`),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['제공자', '이름', 'Voice ID', '언어', '유형', '기능', '동기화', ''].map((x) => h('th', null, x)))),
        h('tbody', null, r.voices.map((v) => h('tr', { 'data-voice-row': v.id },
          h('td', null, v.provider === 'google' ? 'Google' : 'HeyGen'), h('td', null, v.name), h('td', { class: 'mono small' }, v.id), h('td', null, v.languageLabel || v.language), h('td', null, v.type),
          h('td', { class: 'small muted' }, (v.capabilities || []).join(', ')), h('td', { class: 'small muted' }, when(v.syncedAt)),
          h('td', null, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => previewVoice(v, audio) }, '미리듣기'))))))));
  };
  const input = (key, ph) => h('input', { type: 'search', placeholder: ph, value: q[key], oninput: (e) => { q[key] = e.target.value; clearTimeout(input.t); input.t = setTimeout(load, 200); } });
  const sel = (key, opts, label) => h('select', { 'aria-label': label, onchange: (e) => { q[key] = e.target.value; load(); } }, h('option', { value: '' }, label + ' 전체'), opts.map(([v, l]) => h('option', { value: v, selected: q[key] === v }, l)));
  load().catch((e) => toast(e.message, { error: true }));
  return h('section', { class: 'card stack', style: 'gap:10px', 'data-voice-library': '' },
    h('div', { class: 'card-head' }, h('h2', null, '음성 라이브러리'), h('span', { class: 'small muted' }, `${ov.total}개 · 목록 조회와 동기화는 음성을 생성하지 않습니다.`)),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, input('q', '이름·ID·언어 검색'), sel('provider', [['google', 'Google'], ['heygen', 'HeyGen']], '제공자'), sel('language', ov.languages.map((l) => [l.code, `${l.code} (${l.count})`]), '언어'), sel('type', ov.types.map((t) => [t, t]), '유형')),
    out, audio);
}

export function voiceConnections() {
  const ov = state.summary.voices;
  return h('div', { class: 'stack', style: 'gap:20px', 'data-voice-connections': '' },
    h('div', { class: 'banner mock' }, h('div', null, h('b', null, '자격 증명은 서버에만 저장됩니다. '), '연결 테스트와 음성 목록 동기화는 무료이며 오디오를 만들지 않습니다. 미리듣기는 직접 누를 때만 실행되고, 유료일 때는 비용 확인 창이 먼저 나옵니다. 실제 대사 음성은 대본 승인 후에만 생성됩니다.')),
    h('div', { class: 'grid two' }, googleCard(ov.providers.google), heygenCard(ov.providers.heygen)),
    library(ov));
}

/** Character Library voice settings: pick from the synced catalog. No credential inputs here. */
export function voicePicker(c) {
  const info = c.voiceInfo || {};
  const sel = { provider: info.provider || 'heygen', voiceId: info.voiceId || '', q: '' };
  const holder = h('div', { class: 'stack', style: 'gap:8px' });
  const audio = h('audio', { controls: true, preload: 'none', style: 'height:32px;max-width:100%' });
  let voices = [];
  const KINDS = { ready: 'done', missing: 'attention', not_connected: 'err', unsynced: 'attention', unavailable: 'err' };
  const draw = () => {
    const conn = state.summary.voices.providers[sel.provider];
    const shown = voices.filter((v) => !sel.q || (v.name + ' ' + v.id + ' ' + v.language).toLowerCase().includes(sel.q.toLowerCase())).slice(0, 200);
    holder.replaceChildren(
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, chip(info.state === 'ready' ? `${info.providerLabel} · ${info.name}` : (info.message || '목소리 미지정'), KINDS[info.state] || 'attention'),
        info.action === 'connect' ? h('a', { class: 'btn sm ghost', href: '#/settings', 'data-connect-provider': '', onclick: () => (state.settingsTab = 'voices') }, '제공자 연결') : null),
      h('div', { class: 'seg' }, [['google', 'Google Cloud TTS'], ['heygen', 'HeyGen']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': sel.provider === k ? 'true' : 'false', onclick: () => { sel.provider = k; sel.voiceId = k === info.provider ? info.voiceId : ''; load(); } }, l))),
      !conn.configured ? h('div', { class: 'small muted' }, `${conn.label}가 연결되어 있지 않습니다. `, h('a', { href: '#/settings', onclick: () => (state.settingsTab = 'voices') }, 'Settings에서 연결')) :
        !voices.length ? h('div', { class: 'small muted' }, '동기화된 음성이 없습니다. Settings → 음성 연결에서 "음성 목록 가져오기"를 누르세요.') :
          h('div', { class: 'stack', style: 'gap:6px' },
            h('input', { type: 'search', placeholder: '음성 검색', value: sel.q, oninput: (e) => { sel.q = e.target.value; draw(); } }),
            h('select', { 'data-voice-select': '', size: 1, onchange: (e) => (sel.voiceId = e.target.value) }, h('option', { value: '' }, '— 음성 선택 —'), shown.map((v) => h('option', { value: v.id, selected: v.id === sel.voiceId }, `${v.name} · ${v.language} · ${v.type}`)))),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn sm', type: 'button', 'data-voice-save': '', disabled: !conn.configured, onclick: () => { if (!sel.voiceId) return toast('음성을 먼저 고르세요', { error: true }); call(() => api.put(`/api/characters/${c.id}/voice`, { provider: sel.provider, voiceId: sel.voiceId }), `${c.name}의 기본 목소리를 저장했습니다`); } }, '기본 목소리로 저장'),
        h('button', { class: 'btn sm ghost', type: 'button', disabled: !sel.voiceId, onclick: () => { const v = voices.find((x) => x.id === sel.voiceId); if (v) previewVoice(v, audio); } }, '미리듣기'),
        info.voiceId ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => call(() => api.del(`/api/characters/${c.id}/voice`), '목소리 지정을 해제했습니다') }, '지정 해제') : null),
      audio);
  };
  const load = async () => {
    const conn = state.summary.voices.providers[sel.provider];
    voices = [];
    if (conn.configured) { try { voices = (await api.get('/api/voices/list?limit=500&provider=' + sel.provider)).voices; } catch (_) { /* shown as empty */ } }
    draw();
  };
  load();
  return h('div', { class: 'stack', style: 'gap:6px', 'data-voice-picker': c.id }, h('b', null, '목소리 설정'), holder);
}
