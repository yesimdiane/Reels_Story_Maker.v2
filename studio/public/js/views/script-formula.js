// Script Studio for the fixed episode formula: PART A (six beats, unique to the episode) and PART B (three reusable ending shots).
// The scene editors themselves are built by script.js and handed in; this file lays them out and adds the beat / template controls.
import { h, chip, icon, toast, confirmDialog, modal } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { confirmPaid, busyButton } from './common.js';
import { attach } from './script-validate.js';
import { withTranslate } from './translate-box.js';

const ACTIONS = {
  story: ['코미디 스토리 다시 만들기', 'PART A 전체(여섯 단계)를 새로 씁니다. PART B 엔딩은 건드리지 않습니다.'],
  escalation: ['위기 2 개선 (Improve Escalation)', '같은 문제가 더 터무니없이 커지도록 "위기 2" 단계만 다시 씁니다.'],
  twist: ['절정 강화 (Strengthen Twist)', '반전이 더 놀랍고 문제와 직접 이어지도록 "절정" 단계만 다시 씁니다.'],
  bridge: ['제품 연결 개선 (Improve Product Bridge)', '이야기의 결과로 집에서 생기는 문제와 쇼핑 핑계가 더 자연스럽도록 "제품 연결" 단계만 다시 씁니다.'],
  setup: ['도입 수정 (Revise Setup)', '"도입" 단계만 적어 주신 지시문대로 다시 씁니다. 나머지 단계와 PART B 엔딩은 그대로입니다.'],
  problem: ['위기 1 수정 (Revise Problem)', '"위기 1" 단계만 적어 주신 지시문대로 다시 씁니다. 나머지 단계와 PART B 엔딩은 그대로입니다.'],
  resolution: ['결말 수정 (Revise Resolution)', '"결말" 단계만 적어 주신 지시문대로 다시 씁니다. 나머지 단계와 PART B 엔딩은 그대로입니다.'],
  ending: ['제품별 엔딩 대사 다시 만들기', '3컷 엔딩의 제품별 값(제품 이름·시연 동작·대사)만 다시 만듭니다. 구조와 잭의 거부 개그는 그대로입니다.'],
};
const BEAT_ACTION = { absurd_escalation: 'escalation', unexpected_twist: 'twist', product_bridge: 'bridge' };
// every story beat can be revised with a written instruction (the preset buttons in the card header stay as they are)
const BEAT_REFINE = { setup: 'setup', problem: 'problem', absurd_escalation: 'escalation', unexpected_twist: 'twist', resolution: 'resolution', product_bridge: 'bridge' };

const tag = (text, kind) => h('span', { class: 'chip ' + (kind || ''), style: 'font-size:11px' }, text);
const EPISODE = () => tag('에피소드 고유', 'attention');
const SERIES = () => tag('시리즈 템플릿', 'done');

/** Runs one AI action: cost estimate → explicit confirmation → request; asks again with overwrite when hand edits / an approved script would be replaced. */
export async function runFormulaAction(ep, action, { extra = '' } = {}) {
  const route = (state.summary.ai.routing || []).find((r) => r.task === 'scriptWriting') || { provider: 'mock' };
  let est;
  try { est = await api.post(`/api/episodes/${ep.id}/script/estimate`, { action }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  const c = await confirmPaid({ title: ACTIONS[action][0] + (route.provider === 'mock' ? ' (샘플)' : ' (유료일 수 있음)'), est, confirmLabel: '실행', body: h('p', { class: 'small muted', style: 'margin:0' }, ACTIONS[action][1] + ' 이전 대본은 버전 기록에 보관됩니다.') });
  if (c === null) return;
  state.draft.script = null;
  const call = (overwrite) => api.post(`/api/episodes/${ep.id}/script/regenerate`, { action, confirm: c, overwrite, extra });
  try { await act(() => call(false), { ok: ACTIONS[action][0] + ' 완료 (검토 후 승인하세요)' }); } catch (_) { /* act toasts */ }
  // act() swallows the error into a toast; re-check the state to see whether a protected overwrite is needed
}

export function formulaLayout({ ep, d, blocks, dirty, redrawAll, v, index, addSceneIn, dupScene, focusScene }) {
  const F = ep.formula;
  const fx = ep.formula.ending;
  const root = h('div', { class: 'stack', style: 'gap:22px' });
  const locked = !!fx.structureLocked;
  const hasA = ep.scenes.some((s) => s.part === 'A');
  const withKey = (el, rf) => (rf ? attach(index, el, rf) : el);
  const sceneLinks = (ids) => h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ids.map((id) => { const sc = ep.scenes.find((x) => x.id === id) || {}; return h('button', { class: 'chip', type: 'button', title: `${id} 씬 편집`, onclick: () => focusScene(id) }, `✏️ ${id} ${sc.title_ko || sc.title || '씬 편집'}`); }));
  const blockOf = (id) => (blocks.find((b) => b.sc.id === id) || {}).block;

  const run = async (action, { extra = '', busy = null } = {}) => {
    // protected overwrite: ask once when the server says hand edits / an approved script would be replaced
    const route = (state.summary.ai.routing || []).find((r) => r.task === 'scriptWriting') || { provider: 'mock' };
    let est;
    try { est = await api.post(`/api/episodes/${ep.id}/script/estimate`, { action, extra }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
    if (busy) busy.label('비용 확인 중…');
    const c = await confirmPaid({ title: ACTIONS[action][0] + (route.provider === 'mock' ? ' (샘플)' : ' (유료일 수 있음)'), est, confirmLabel: '실행', body: h('p', { class: 'small muted', style: 'margin:0' }, ACTIONS[action][1] + ' 이전 대본은 버전 기록에 보관됩니다.') });
    if (c === null) return;
    if (busy) busy.label('다시 쓰는 중… (수 초~수십 초)');
    const call = (overwrite) => api.post(`/api/episodes/${ep.id}/script/regenerate`, { action, confirm: c, overwrite, extra });
    state.draft.script = null;
    try { await call(false); } catch (e) {
      if (['SCRIPT_EXISTS', 'MANUAL_EDITS', 'SCRIPT_APPROVED'].includes(e.code)) {
        if (!(await confirmDialog({ title: '정말 다시 만들까요?', body: h('div', { class: 'small stack' }, h('div', null, e.message), h('div', { class: 'muted' }, '이전 대본은 버전 기록에 남아 복원할 수 있고, PART B 엔딩은 바뀌지 않습니다.')), confirm: '덮어쓰기', tone: 'clay' }))) return;
        try { await call(true); } catch (e2) { return toast(e2.message, { error: true, recovery: e2.recovery }); }
      } else return toast(e.message, { error: true, recovery: e.recovery });
    }
    toast(ACTIONS[action][0] + ' 완료 (검토 후 승인하세요)');
    await act(async () => null);
  };
  const actionBtn = (action, cls = 'btn sm ghost') => h('button', { class: cls, title: ACTIONS[action][1], disabled: !ep.derived.concept.approved || (action !== 'story' && action !== 'ending' && !hasA), onclick: () => run(action) }, ACTIONS[action][0]);

  // Written instruction for ONE beat -> the same paid regenerate action (estimate -> cost confirmation -> request; a protected overwrite is asked again).
  // The card only carries one "🪄 AI로 다듬기" button; the instruction is written in a small dialog.
  const openRefine = (b) => {
    const action = BEAT_REFINE[b.key];
    modal((close) => {
      const ta = h('textarea', { rows: 2, maxlength: 1000, 'data-beat-instruction': b.key, 'aria-label': `${b.label} AI 수정 지시문`, placeholder: '이 단계에서 고치고 싶은 내용을 적어 주세요. 예) 다이앤의 반응을 더 장난스럽게, 반전을 더 늦게 보여주기…' });
      const btn = h('button', { class: 'btn clay', type: 'button', 'data-beat-refine': b.key, onclick: async (ev) => {
        const instruction = ta.value.trim();
        if (!instruction) return toast('고치고 싶은 내용을 입력하세요', { error: true });
        if (d.dirty || d.epDirty) return toast('저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 AI 수정을 실행하세요 (이 단계의 장면이 새로 바뀝니다).', { error: true });
        const busy = busyButton(ev.currentTarget);
        if (!busy.begin('비용 계산 중…')) return;
        try { await run(action, { extra: instruction, busy }); close(); } finally { busy.end(); }
      } }, '🪄 이 단계 AI로 다시 쓰기');
      return h('div', { class: 'stack', style: 'gap:10px', 'data-beat-refine-box': b.key },
        h('h3', { style: 'margin:0' }, `${b.label} · ${b.labelEn} — AI로 다듬기`),
        h('div', { class: 'small muted' }, ACTIONS[action][1]),
        ta,
        h('div', { class: 'small muted' }, '유료 AI 호출입니다 (비용 확인 후 실행). 이전 대본은 버전 기록에 남습니다.'),
        h('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), btn));
    });
  };

  const field = (label, value, on, { rows = 2, kind = '', lang, rf } = {}) => {
    const input = rows === 1 ? h('input', { type: 'text', value, lang, maxLength: 24, oninput: (e) => { on(e.target.value); dirty(); } }) : h('textarea', { rows, lang, oninput: (e) => { on(e.target.value); dirty(); } }, value);
    const el = withKey(h('div', { class: 'field' }, h('label', null, label), input), rf);
    return rows === 1 ? el : withTranslate(el, ep, () => input.value);
  };

  // ---- PART A ----
  root.append(h('div', { class: 'row between', style: 'align-items:flex-end;flex-wrap:wrap;gap:8px' },
    h('div', null, h('div', { class: 'eyebrow' }, 'PART A'), h('h2', { style: 'margin:0' }, 'PART A — 이번 에피소드 이야기'), h('div', { class: 'small muted' }, '매 에피소드 새로 쓰는 이야기입니다. 여섯 단계가 순서대로 모두 있어야 합니다 (한 단계에 여러 컷 가능).')),
    h('div', { class: 'row' }, EPISODE(), actionBtn('story', 'btn sm'))));
  F.partA.forEach((b, i) => {
    const bd = d.comedy_story[b.key];
    const card = h('div', { class: 'card stack', style: 'gap:12px;border-left:4px solid var(--clay, #b4683a)', 'data-rf': `B:${b.key}:card` });
    card.append(h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' },
      h('div', { class: 'row' }, h('span', { class: 'eyebrow' }, `${i + 1}/6`), h('h3', { style: 'margin:0' }, `${b.label} · ${b.labelEn}`), EPISODE()),
      h('div', { class: 'row' }, chip(`${b.durationSec || 0}초`, ''), chip('장면 ' + (b.sceneIds.length ? b.sceneIds.join(', ') : '없음'), b.sceneIds.length ? '' : 'err'), BEAT_ACTION[b.key] ? actionBtn(BEAT_ACTION[b.key]) : null,
        h('button', { class: 'btn sm clay', type: 'button', 'data-beat-refine-open': b.key, disabled: !ep.derived.concept.approved || !b.sceneIds.length, title: !b.sceneIds.length ? '먼저 코미디 스토리를 만들어 이 단계에 장면이 있어야 합니다' : ACTIONS[BEAT_REFINE[b.key]][1], onclick: () => openRefine(b) }, '🪄 AI로 다듬기'))));
    card.append(h('div', { class: 'small muted' }, b.role));
    card.append(h('div', { class: 'small' }, h('b', null, bd.title_ko || '(제목 없음)'), h('span', { class: 'muted' }, b.subtitle_ko ? ' · ' + b.subtitle_ko : '')));
    const fieldBox = h('div', { class: 'stack', style: 'gap:12px;margin-top:10px' });
    fieldBox.append(h('div', { class: 'grid two' },
      field('단계 제목 (한국어)', bd.title_ko, (x) => (bd.title_ko = x), { rows: 1, lang: 'ko', rf: `B:${b.key}:title_ko` }),
      h('div', { class: 'field' }, h('label', null, '한국어 자막 요약 (대사에서 자동)'), h('div', { class: 'small', style: 'min-height:38px' }, b.subtitle_ko || '—'))));
    fieldBox.append(h('div', { class: 'grid two' }, field('이야기 설명 (English) — 직접 쓰면 AI가 그대로 살립니다', bd.story_en, (x) => (bd.story_en = x), { rows: 2, lang: 'en' }), field('비주얼 방향', bd.visual, (x) => (bd.visual = x), { rows: 2 })));
    card.append(h('details', { 'data-beat-fields': b.key }, h('summary', null, '단계 내용 직접 수정 (제목 · 이야기 · 비주얼)'), fieldBox));
    b.sceneIds.forEach((id) => { const bl = blockOf(id); if (bl) card.append(bl); });
    if (focusScene) card.append(sceneLinks(b.sceneIds));
    card.append(h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => addSceneIn && addSceneIn(b.key) }, icon('plus'), '이 단계에 씬 추가'), b.sceneIds.length && dupScene ? h('button', { class: 'btn sm ghost', type: 'button', 'data-dup-beat': b.key, title: '이 단계의 마지막 씬을 그대로 복사해 바로 뒤에 미승인 상태로 만듭니다', onclick: () => dupScene(b.sceneIds[b.sceneIds.length - 1]) }, '⎘ 씬 복제') : null));
    root.append(card);
  });

  // ---- PART B ----
  root.append(h('div', { class: 'row between', style: 'align-items:flex-end;flex-wrap:wrap;gap:8px;margin-top:8px' },
    h('div', null, h('div', { class: 'eyebrow' }, 'PART B'), h('h2', { style: 'margin:0' }, 'PART B — 고정 제품 엔딩 (3컷)'), h('div', { class: 'small muted' }, '모든 에피소드가 같은 3컷으로 끝납니다. 구조와 캐릭터 구도는 시리즈 템플릿이고, 제품·시연 동작·제품별 대사만 이 에피소드 값입니다. CTA·제휴 고지는 이야기 컷이 아니라 엔드 카드로 올라갑니다.')),
    h('div', { class: 'row' }, SERIES(), locked ? chip('🔒 구조 잠김', 'done') : chip('구조 잠금 해제됨', 'attention'))));
  root.append(endingControls());
  F.partB.forEach((b, i) => {
    const bd = d.product_ending[b.key];
    const card = h('div', { class: 'card stack', style: 'gap:12px;border-left:4px solid var(--sage-deep, #5f7a5a)', 'data-rf': `B:${b.key}:card` });
    card.append(h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' },
      h('div', { class: 'row' }, h('span', { class: 'eyebrow' }, `엔딩 컷 ${i + 1}/3`), h('h3', { style: 'margin:0' }, `${b.label} · ${b.labelEn}`), SERIES()),
      h('div', { class: 'row' }, chip(`${b.durationSec || 0}초`, ''), chip('장면 ' + b.sceneIds.join(', '), ''))));
    card.append(h('div', { class: 'small muted' }, '템플릿 제공: 컷 순서·구성·캐릭터 구도 · 에피소드별: 제품 이름·시연 동작·제품별 대사·연출'));
    card.append(h('div', { class: 'grid two' }, field('컷 제목 (한국어)', bd.title_ko, (x) => (bd.title_ko = x), { rows: 1, lang: 'ko', rf: `B:${b.key}:title_ko` }), h('div', { class: 'field' }, h('label', null, '한국어 자막 요약'), h('div', { class: 'small', style: 'min-height:38px' }, b.subtitle_ko || '—'))));
    card.append(h('div', { class: 'grid two' }, field('컷 설명 (English)', bd.story_en, (x) => (bd.story_en = x), { rows: 2, lang: 'en' }), field('비주얼 방향', bd.visual, (x) => (bd.visual = x), { rows: 2 })));
    b.sceneIds.forEach((id) => { const bl = blockOf(id); if (bl) card.append(bl); });
    if (focusScene) card.append(sceneLinks(b.sceneIds));
    root.append(card);
  });
  return root;

  function endingControls() {
    const list = state.endingTemplates;
    const box = h('div', { class: 'card stack', style: 'gap:12px' });
    box.append(h('div', { class: 'card-head' }, h('h3', { style: 'margin:0' }, '엔딩 템플릿 · 제품별 값'), h('a', { class: 'small', href: '#/settings', onclick: () => { state.settingsTab = 'endings'; } }, '템플릿 편집 (설정 → 엔딩 템플릿)')));
    const sel = h('select', { 'aria-label': '엔딩 템플릿', style: 'width:auto' }, h('option', { value: fx.templateId }, `${fx.templateName || fx.templateId} v${fx.templateVersion}${fx.pinnedVersion ? ' (고정)' : ''}`));
    box.append(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' }, h('label', { class: 'row small', style: 'gap:6px' }, '이 에피소드의 엔딩 템플릿', sel)));
    api.get('/api/ending-templates').then((l) => {
      sel.replaceChildren(...l.templates.map((t) => h('option', { value: t.id, selected: t.id === fx.templateId }, t.name + (t.active ? ' ★기본' : '') + (t.id === fx.templateId ? ` (현재 v${fx.templateVersion})` : ` v${t.current}`))));
      sel.onchange = async () => {
        const reset = await confirmDialog({ title: '엔딩 템플릿을 바꿀까요?', body: h('div', { class: 'small stack' }, h('div', null, 'PART B 세 컷이 선택한 템플릿으로 다시 채워집니다. PART A는 바뀌지 않습니다.'), h('div', { class: 'muted' }, '직접 수정한 컷은 그대로 유지됩니다. 모두 템플릿으로 되돌리려면 "수정까지 초기화"를 누르세요.')), confirm: '수정은 유지하고 적용', cancel: '취소' });
        if (!reset) { sel.value = fx.templateId; return; }
        await act(async () => { await api.put(`/api/episodes/${ep.id}/script/ending`, { templateId: sel.value }); state.draft.script = null; return null; }, { ok: '엔딩 템플릿을 바꿨습니다 (대본 승인은 다시 필요합니다)' });
      };
    }).catch(() => {});
    const vars = ['PRODUCT_NAME', 'PRODUCT_NAME_KO', 'USE_PHRASE', 'USE_PHRASE_KO', 'DEMO_ACTION', 'DEMO_ACTION_KO', 'DEMO_LINE_EN', 'DEMO_LINE_KO'];
    const labels = { PRODUCT_NAME: '제품 이름 (영어 대사)', PRODUCT_NAME_KO: '제품 이름 (한국어 자막)', USE_PHRASE: '잭이 거부하는 것 (영어, 예: an umbrella)', USE_PHRASE_KO: '잭이 거부하는 것 (한국어, 예: 우산을)', DEMO_ACTION: '시연 동작 (영어 연출)', DEMO_ACTION_KO: '시연 동작 (한국어 메모)', DEMO_LINE_EN: '시연 컷 대사 (영어)', DEMO_LINE_KO: '시연 컷 자막 (한국어)' };
    box.append(h('div', { class: 'small muted' }, '제품별 값 — 바꾸면 PART B의 같은 자리 문구가 바뀌고 구조는 그대로입니다. 직접 입력한 값은 AI가 덮어쓰지 않습니다. (직접 수정한 컷은 유지됩니다)'));
    box.append(h('div', { class: 'grid two' }, vars.map((k) => h('div', { class: 'field' }, h('label', null, labels[k], fx.manualVars.includes(k) ? h('span', { class: 'small muted' }, ' · 직접 입력') : null), h('input', { type: 'text', value: d.endingVars[k] || '', oninput: (e) => { d.endingVars[k] = e.target.value; dirty(); } })))));
    box.append(h('div', { class: 'row', style: 'flex-wrap:wrap' }, actionBtn('ending', 'btn sm'), reuseBtn()));
    return box;
  }
  function reuseBtn() {
    const others = (state.summary.episodes || []).filter((e) => e.id !== ep.id);
    return h('button', { class: 'btn sm ghost', title: '같은 시리즈 템플릿 칸의 승인된 시작 프레임을 다른 에피소드에서 복사합니다. 제품이 보이는 컷은 같은 제품일 때만 복사됩니다.', disabled: !others.length, onclick: async () => {
      const from = prompt('승인된 엔딩 시작 프레임을 가져올 에피소드 ID (예: ' + (others[0] ? others[0].id : '') + ')', others[0] ? others[0].id : '');
      if (!from) return;
      try { const r = await api.post(`/api/episodes/${ep.id}/script/ending/reuse`, { fromEpisodeId: from }); toast(`재사용 ${r.reuse.copied.length}컷 · 건너뜀 ${r.reuse.skipped.length}컷`); await act(async () => null); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    } }, '승인된 엔딩 에셋 재사용');
  }
}

function newId(d, prefix) {
  const used = new Set(d.scenes.map((s) => s.id));
  let i = 1;
  while (used.has(prefix + i)) i += 1;
  return prefix + i;
}
const BEAT_ORDER = ['setup', 'problem', 'absurd_escalation', 'unexpected_twist', 'resolution', 'product_bridge'];
function firstIndexAfter(d, key) {
  const earlier = BEAT_ORDER.slice(0, BEAT_ORDER.indexOf(key));
  let last = -1;
  d.scenes.forEach((s, i) => { if (earlier.includes(s.beatKey)) last = i; });
  return last + 1;
}
