// 씬 다시 생성하기: regenerate ONE scene from its (edited) 시각 연출 · 액션 → review the proposal → apply or cancel.
// The current scene and its approval stay untouched until 제안 적용; the applied scene is an unapproved draft. Only a paid TEXT call is made.
import { h, chip, toast, confirmDialog } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { confirmPaid } from './common.js';
import { setCollapsed } from './scene-collapse.js';

const base = (ep, sid) => `/api/episodes/${ep.id}/scenes/${sid}/regenerate`;

/** `note`: the operator's plain-language change request (optional). `busy`: the clicked button's busyButton, for the progress label. */
export async function startRegeneration(ep, sc, note = '', busy = null) {
  const body = { visual: sc.visual, action: sc.action, note };
  if (String(body.visual || '').trim().length < 10) return toast('"시각 연출 · 액션"에 연출을 먼저 적어 주세요 (이 내용이 재생성의 기준입니다)', { error: true });
  let est;
  try { est = await api.post(base(ep, sc.id) + '/estimate', body); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  if (busy) busy.label('비용 확인 중…');
  const c = await confirmPaid({ title: `${sc.id} 씬 다시 생성하기`, est, confirmLabel: '생성',
    body: h('div', { class: 'stack small', style: 'gap:6px' }, h('div', null, '입력한 시각 연출 · 액션을 기준으로 이 씬 하나만 다시 만듭니다 (앞뒤 씬 내용·출연 캐릭터·제품 정보를 참고).'), h('div', { class: 'muted' }, '결과는 검토용 제안으로만 보입니다. 현재 씬과 승인 상태는 "제안 적용"을 누를 때까지 그대로이며, 다른 씬은 바뀌지 않습니다. 이미지·영상·음성은 만들지 않습니다.')) });
  if (c === null) return;
  if (busy) busy.label('씬 다시 만드는 중… (수 초~수십 초)');
  await act(() => api.post(base(ep, sc.id), Object.assign({ confirm: c }, body)), { ok: '재생성 제안이 준비됐습니다 — 검토 후 적용하세요' });
}

/** The review panel shown inside the scene card while a proposal exists. */
export function regenPanel(ep, sc, ap, d) {
  const rec = (ep.sceneRegen || {})[sc.id];
  if (!rec) return null;
  const cur = ep.lines.filter((l) => l.sceneId === sc.id);
  const p = rec.proposal;
  const ko = (txt, key) => (txt ? h('div', { class: 'small muted', lang: 'ko', ['data-regen-' + key]: '' }, '한글 ' + txt) : null);
  const col = (title, t) => h('div', { class: 'regen-col stack', style: 'gap:6px' }, h('b', null, title),
    h('div', { class: 'small' }, h('span', { class: 'muted' }, '제목 '), t.title_ko), h('div', { class: 'small' }, h('span', { class: 'muted' }, '시각 연출 '), t.visual || '—'), ko(t.visual_ko, 'visual-ko'), h('div', { class: 'small' }, h('span', { class: 'muted' }, '액션 '), t.action || '—'), ko(t.action_ko, 'action-ko'),
    h('div', { class: 'small' }, h('span', { class: 'muted' }, '대사 '), (t.lines || []).length ? h('div', null, t.lines.map((l) => h('div', null, `${l.speaker}: ${l.en} / ${l.ko}`))) : '없음'));
  return h('div', { class: 'card flat stack regen-panel', style: 'gap:10px;border:1.5px solid var(--clay)', 'data-regen-panel': sc.id },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:6px' }, h('b', null, '재생성 제안 — 아직 적용·승인되지 않았습니다'), h('span', { class: 'row', style: 'gap:6px' }, chip('제안', 'attention'), rec.mock ? chip('샘플', 'mock') : null, ap && ap.approved ? chip(`현재 승인됨 r${ap.revision}`, 'done') : null)),
    h('div', { class: 'grid two regen-compare' }, col('현재 씬', { title_ko: sc.title_ko, visual: sc.visual, action: sc.action, lines: cur }), col('새 제안', p)),
    h('div', { class: 'small muted' }, `지시: ${String(rec.instruction.visual || '').slice(0, 160)}`),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn sage', type: 'button', 'data-regen-accept': sc.id, onclick: async () => {
        const unsaved = d && d.dirtyScenes && d.dirtyScenes.has(sc.id);
        if ((ap && ap.approved) || unsaved) {
          const ok = await confirmDialog({ title: '제안을 적용할까요?', body: [ap && ap.approved ? `현재 승인된 씬(r${ap.revision})이 미승인 초안으로 바뀌고 다시 승인해야 합니다. 이전 버전은 버전 기록에 남습니다.` : '', unsaved ? ' 저장하지 않은 변경은 제안으로 대체됩니다.' : ''].join(''), confirm: '적용' });
          if (!ok) return;
        }
        setCollapsed(ep.id, sc.id, false);
        if (d) { d.dirtyScenes.delete(sc.id); }
        state.draft.script = null;
        await act(() => api.post(base(ep, sc.id) + '/accept'), { ok: '제안을 적용했습니다 — 씬은 미승인 초안입니다. 검토 후 승인하세요' });
      } }, '제안 적용'),
      h('button', { class: 'btn ghost', type: 'button', 'data-regen-cancel': sc.id, onclick: () => act(() => api.post(base(ep, sc.id) + '/cancel'), { ok: '제안을 취소했습니다 — 원래 씬은 그대로입니다' }) }, '취소'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => startRegeneration(ep, d && d.scenes ? (d.scenes.find((x) => x.id === sc.id) || sc) : sc) }, '다시 생성')));
}
