// Script Studio for the episode formula: the six story beats (each beat may hold several scenes).
// The scene editors themselves are built by script.js and handed in; this file lays them out and adds the beat / template controls.
import { h, chip, icon, toast, confirmDialog, modal } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { confirmPaid, busyButton } from './common.js';
import { attach } from './script-validate.js';
import { withTranslate, translateControl } from './translate-box.js';

const ACTIONS = {
  story: ['코미디 스토리 다시 만들기', '여섯 단계 전체를 새로 씁니다.'],
  escalation: ['위기 2 개선 (Improve Escalation)', '같은 문제가 더 터무니없이 커지도록 "위기 2" 단계만 다시 씁니다.'],
  twist: ['절정 강화 (Strengthen Twist)', '반전이 더 놀랍고 문제와 직접 이어지도록 "절정" 단계만 다시 씁니다.'],
  bridge: ['제품 연결 개선 (Improve Product Bridge)', '이야기의 결과로 집에서 생기는 문제와 쇼핑 핑계가 더 자연스럽도록 "제품 연결" 단계만 다시 씁니다.'],
  setup: ['도입 수정 (Revise Setup)', '"도입" 단계만 적어 주신 지시문대로 다시 씁니다. 나머지 단계는 그대로입니다.'],
  problem: ['위기 1 수정 (Revise Problem)', '"위기 1" 단계만 적어 주신 지시문대로 다시 씁니다. 나머지 단계는 그대로입니다.'],
  resolution: ['결말 수정 (Revise Resolution)', '"결말" 단계만 적어 주신 지시문대로 다시 씁니다. 나머지 단계는 그대로입니다.'],
};
const BEAT_ACTION = { absurd_escalation: 'escalation', unexpected_twist: 'twist', product_bridge: 'bridge' };
// every story beat can be revised with a written instruction (the preset buttons in the card header stay as they are)
const BEAT_REFINE = { setup: 'setup', problem: 'problem', absurd_escalation: 'escalation', unexpected_twist: 'twist', resolution: 'resolution', product_bridge: 'bridge' };

const tag = (text, kind) => h('span', { class: 'chip ' + (kind || ''), style: 'font-size:11px' }, text);
const EPISODE = () => tag('에피소드 고유', 'attention');

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
  const root = h('div', { class: 'stack', style: 'gap:22px' });
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

  // Story-flow dialog: the six steps as tabs (free to move between them), each showing its Korean content first and taking its own written
  // instruction -> the same paid regenerate action for that ONE step (estimate -> cost confirmation -> request; a protected overwrite is asked again).
  // English story / visual stay what is stored and sent to the AI; a Korean translation is available on request (cost-confirmed, cached).
  const openStoryFlow = (startKey) => {
    const drafts = {};
    let active = startKey || F.partA[0].key;
    modal((close) => {
      const root = h('div', { class: 'stack story-flow', style: 'gap:12px', 'data-story-flow': '' });
      const draw = () => {
        const b = F.partA.find((x) => x.key === active);
        const action = BEAT_REFINE[b.key];
        const bd = d.comedy_story[b.key] || {};
        const tabs = h('div', { class: 'row', role: 'tablist', 'aria-label': '스토리 단계', style: 'gap:6px;flex-wrap:wrap' }, F.partA.map((x, i) => h('button', { class: 'btn sm ' + (x.key === active ? 'clay' : 'ghost'), type: 'button', role: 'tab', 'aria-selected': x.key === active ? 'true' : 'false', 'data-flow-tab': x.key, onclick: () => { keep(); active = x.key; draw(); } }, `${i + 1}. ${x.label}`)));
        const taKey = b.key;
        const ta = h('textarea', { rows: 4, maxlength: 1000, 'data-beat-instruction': b.key, 'aria-label': `${b.label} AI 수정 지시문`, placeholder: '이 단계에서 고치고 싶은 내용을 한국어로 적어 주세요. 예) 다이앤의 반응을 더 장난스럽게, 반전을 더 늦게 보여주기…' }, drafts[taKey] || '');
        function keep() { drafts[taKey] = ta.value; }
        const scenes = b.sceneIds.map((id) => {
          const sc = ep.scenes.find((x) => x.id === id) || {};
          const lines = (d.lines || []).filter((l) => l.sceneId === id && (l.ko || l.en));
          return h('div', { class: 'card flat stack', style: 'gap:4px', 'data-flow-scene': id },
            h('b', null, `${id} · ${sc.title_ko || sc.title || '제목 없음'}`),
            lines.length ? lines.map((l) => h('div', { class: 'small' }, h('span', { class: 'muted' }, l.speaker + ': '), l.ko || l.en)) : h('div', { class: 'small muted' }, '대사 없음'));
        });
        const en = h('div', { class: 'field' }, h('label', null, '이야기 · 비주얼 (English · AI에 전달되는 원문)'), h('div', { class: 'small muted', lang: 'en' }, bd.story_en || '—'), h('div', { class: 'small muted', lang: 'en' }, bd.visual || ''));
        const tr = translateControl(ep, () => [bd.story_en, bd.visual].filter(Boolean).join('\n\n'));
        const submit = h('button', { class: 'btn clay', type: 'button', 'data-beat-refine': b.key, disabled: !ep.derived.concept.approved || !b.sceneIds.length, onclick: async (ev) => {
          const instruction = ta.value.trim();
          if (!instruction) return toast('고치고 싶은 내용을 입력하세요', { error: true });
          if (d.dirty || d.epDirty) return toast('저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 AI 수정을 실행하세요 (이 단계의 장면이 새로 바뀝니다).', { error: true });
          const busy = busyButton(ev.currentTarget);
          if (!busy.begin('비용 계산 중…')) return;
          try { await run(action, { extra: instruction, busy }); close(); } finally { busy.end(); }
        } }, '🪄 이 단계 AI로 다시 쓰기');
        root.replaceChildren(
          h('h3', { style: 'margin:0' }, '스토리 플로우 · AI로 다듬기'),
          tabs,
          h('div', { class: 'grid two' },
            h('div', { class: 'stack', style: 'gap:8px' }, h('div', null, h('b', null, `${b.label} · ${b.labelEn}`), h('span', { class: 'small muted' }, ` ${b.durationSec || 0}초`)), h('div', { class: 'small' }, bd.title_ko || '(제목 없음)'), h('div', { class: 'small muted' }, b.role), scenes.length ? scenes : h('div', { class: 'small muted' }, '이 단계에 장면이 없습니다.'), en, h('div', { class: 'row' }, tr.btn), tr.panel),
            h('div', { class: 'stack', style: 'gap:8px', 'data-beat-refine-box': b.key }, h('b', null, `${b.label} 수정 지시`), h('div', { class: 'small muted' }, ACTIONS[action][1]), ta, h('div', { class: 'small muted' }, '유료 AI 호출입니다 (비용 확인 후 실행). 이 단계만 바뀌고 다른 단계와 PART B 엔딩은 그대로입니다.'), h('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), submit))));
        ta.focus();
      };
      draw();
      return root;
    }, { wide: true });
  };

  const field = (label, value, on, { rows = 2, kind = '', lang, rf } = {}) => {
    const input = rows === 1 ? h('input', { type: 'text', value, lang, maxLength: 24, oninput: (e) => { on(e.target.value); dirty(); } }) : h('textarea', { rows, lang, oninput: (e) => { on(e.target.value); dirty(); } }, value);
    const el = withKey(h('div', { class: 'field' }, h('label', null, label), input), rf);
    return rows === 1 ? el : withTranslate(el, ep, () => input.value);
  };

  // ---- the six beats ----
  root.append(h('div', { class: 'row between', style: 'align-items:flex-end;flex-wrap:wrap;gap:8px' },
    h('div', null, h('div', { class: 'eyebrow' }, '스토리'), h('h2', { style: 'margin:0' }, '이번 에피소드 이야기'), h('div', { class: 'small muted' }, '매 에피소드 새로 쓰는 이야기입니다. 여섯 단계가 순서대로 모두 있어야 합니다 (한 단계에 여러 컷 가능).')),
    h('div', { class: 'row' }, EPISODE(), actionBtn('story', 'btn sm'))));
  F.partA.forEach((b, i) => {
    const bd = d.comedy_story[b.key];
    const card = h('div', { class: 'card stack', style: 'gap:12px;border-left:4px solid var(--clay, #b4683a)', 'data-rf': `B:${b.key}:card` });
    card.append(h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' },
      h('div', { class: 'row' }, h('span', { class: 'eyebrow' }, `${i + 1}/6`), h('h3', { style: 'margin:0' }, `${b.label} · ${b.labelEn}`), EPISODE()),
      h('div', { class: 'row' }, chip(`${b.durationSec || 0}초`, ''), chip('장면 ' + (b.sceneIds.length ? b.sceneIds.join(', ') : '없음'), b.sceneIds.length ? '' : 'err'), BEAT_ACTION[b.key] ? actionBtn(BEAT_ACTION[b.key]) : null,
        h('button', { class: 'btn sm clay', type: 'button', 'data-beat-refine-open': b.key, disabled: !ep.derived.concept.approved || !b.sceneIds.length, title: !b.sceneIds.length ? '먼저 코미디 스토리를 만들어 이 단계에 장면이 있어야 합니다' : ACTIONS[BEAT_REFINE[b.key]][1], onclick: () => openStoryFlow(b.key) }, '🪄 AI로 다듬기'))));
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

  return root;
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
