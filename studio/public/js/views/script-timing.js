// Dialogue timing: ESTIMATE (words → seconds, free) vs ACTUAL (recorded / synthesized voice, once it exists).
// Preferred fix = shorten the dialogue (AI, paid, confirmed) or remove unnecessary lines. Extending the scene is an explicit last resort.
import { h, chip, icon, toast, confirmDialog } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { confirmPaid } from './common.js';

const STATUS = { ok: ['맞음', 'done'], tight: ['조금 초과', 'attention'], overflow: ['많이 초과', 'err'] };
export const fmt = (n) => (n == null ? '—' : `${(Math.round(n * 10) / 10).toFixed(1)}초`);

/** Chips that keep the two numbers apart: "추정 6.5초" (word-count estimate) and "실측 5.1초" (audio). */
export function timingChips(t) {
  const a = t.actual || {};
  return [chip('추정 ' + fmt(t.needSec), 'mock'), a.complete ? chip('실측 ' + fmt(a.needSec) + (a.mock ? ' (목업 음성)' : ''), a.overSec > 0.05 ? 'err' : 'done') : chip('실측 없음 — 음성 생성 후 표시', '')];
}

async function fit(ep, sceneIds) {
  let est;
  try { est = await api.post(`/api/episodes/${ep.id}/script/timing/estimate`, { sceneIds }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  const c = await confirmPaid({ title: `대사 줄이기 (${est.sceneIds.join(', ')})`, est, confirmLabel: '대사 줄이기',
    body: h('div', { class: 'small stack', style: 'gap:6px' }, h('div', null, '넘치는 장면의 대사만 짧게 고칩니다: 불필요한 줄을 먼저 빼고, 그다음 말을 다듬습니다. 장면 길이는 늘리지 않고 이야기 흐름·농담·화자는 그대로 둡니다.'), h('div', { class: 'muted' }, '엔딩(PART B) 컷은 건드리지 않습니다. 이전 대본은 버전 기록에 보관됩니다.')) });
  if (c === null) return;
  const call = (overwrite) => api.post(`/api/episodes/${ep.id}/script/timing/fit`, { sceneIds, confirm: c, overwrite });
  state.draft.script = null;
  let r;
  try { r = await call(false); } catch (e) {
    if (['MANUAL_EDITS', 'SCRIPT_APPROVED'].includes(e.code)) {
      if (!(await confirmDialog({ title: '정말 줄일까요?', body: h('div', { class: 'small stack' }, h('div', null, e.message)), confirm: '덮어쓰기', tone: 'clay' }))) return;
      try { r = await call(true); } catch (e2) { return toast(e2.message, { error: true, recovery: e2.recovery }); }
    } else return toast(e.message, { error: true, recovery: e.recovery });
  }
  const f = r.fitResult;
  toast(`대사를 줄였습니다: ${f.fitted.map((x) => `${x.sceneId} ${x.beforeSec}→${x.afterSec}초`).join(', ')}${f.stillOver.length ? ' · 아직 넘침: ' + f.stillOver.map((x) => x.sceneId).join(', ') : ''}`);
  await act(async () => null);
}

export function timingCard(ep, { d, dirty, redrawAll }) {
  const T = ep.derived.timing;
  const rows = T.scenes.filter((t) => t.lineCount);
  const bad = rows.filter((t) => t.status !== 'ok');
  const sceneOf = (id) => ep.scenes.find((s) => s.id === id) || {};
  const shortenable = bad.filter((t) => sceneOf(t.sceneId).part !== 'B');
  const card = h('div', { class: 'card stack' + (bad.length ? ' open' : ''), style: 'gap:10px;min-width:0;max-width:100%' });
  card.append(h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, '대사 시간'), h('h3', { style: 'margin:0' }, '대사 시간 점검')),
    bad.length ? chip(`${bad.length}개 장면 넘침 · 합계 ${fmt(T.totalOverSec)}`, T.overflowCount ? 'err' : 'attention') : chip('모든 장면에 들어감 (추정)', 'done')));
  card.append(h('div', { class: 'small muted' }, '"추정"은 단어 수로 계산한 값입니다(초당 약 2.7단어 + 줄 사이 여유). "실측"은 음성을 만든 뒤 실제 오디오 길이로 계산되며 Voice Studio에서 확인합니다. 넘치는 장면은 대사를 줄이는 것을 권장합니다 — 장면을 늘리는 것은 마지막 수단입니다.'));
  if (d && d.dirty) card.append(h('div', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 변경은 이 점검에 반영되지 않습니다. 저장하면 다시 계산됩니다.'));
  if (bad.length) {
    card.append(h('div', { class: 'tbl-wrap', style: 'overflow-x:auto;max-width:100%' }, h('table', { class: 'tbl', style: 'width:100%' }, h('thead', null, h('tr', null, ['장면', '대사 추정', '장면 길이', '초과', '실측(음성)', '해결'].map((x) => h('th', null, x)))),
      h('tbody', null, bad.map((t) => {
        const sc = sceneOf(t.sceneId);
        const ending = sc.part === 'B';
        const target = Math.ceil(t.needSec * 2) / 2;
        return h('tr', null,
          h('td', null, h('b', null, t.sceneId), ' ', t.title, ending ? h('div', { class: 'small muted' }, 'PART B 엔딩 컷') : null),
          h('td', null, h('div', null, fmt(t.needSec)), h('div', { class: 'small muted' }, `${t.words}단어 / 예산 ${t.wordBudget}단어`)),
          h('td', null, fmt(t.durationSec)),
          h('td', null, chip(`+${fmt(t.overSec)}`, STATUS[t.status][1])),
          h('td', null, t.actual.complete ? chip(fmt(t.actual.needSec) + (t.actual.mock ? ' (목업)' : ''), t.actual.overSec > 0.05 ? 'err' : 'done') : h('span', { class: 'small muted' }, '음성 전')),
          h('td', null, h('div', { class: 'stack', style: 'gap:6px;align-items:flex-start' },
            h('button', { class: 'btn sm clay', disabled: ending || !ep.derived.concept.approved, title: ending ? '엔딩 템플릿 컷은 AI가 줄이지 않습니다. 제품별 값을 짧게 고치거나 컷 길이를 늘리세요.' : '넘치는 대사를 AI가 줄입니다 (유료일 수 있음)', onclick: () => fit(ep, [t.sceneId]) }, '대사 줄이기 (AI)'),
            h('button', { class: 'btn sm ghost', title: '마지막 수단: 대사는 그대로 두고 장면 길이를 늘립니다 (저장 후 적용)', onclick: () => { const sc2 = d.scenes.find((x) => x.id === t.sceneId); if (sc2) { sc2.durationSec = Math.min(15, target); dirty(); redrawAll(); } } }, `장면을 ${target}초로 늘리기`))));
      })))));
    card.append(h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn', disabled: !shortenable.length || !ep.derived.concept.approved, onclick: () => fit(ep, shortenable.map((t) => t.sceneId)) }, icon('play'), `넘치는 장면 ${shortenable.length}개 대사 줄이기 (AI)`),
      h('span', { class: 'small muted' }, '직접 줄이려면 아래 장면에서 대사를 고치거나 줄을 삭제하세요.')));
  }
  return card;
}

/** Voice Studio: estimate vs actual per scene. */
export function timingTable(ep) {
  const rows = ep.derived.timing.scenes.filter((t) => t.lineCount);
  if (!rows.length) return null;
  return h('div', { class: 'card stack', style: 'gap:10px' },
    h('div', { class: 'card-head' }, h('h2', null, '대사 시간 — 추정 vs 실측'), chip(`${rows.filter((t) => t.actual.complete).length}/${rows.length} 장면 실측`, rows.every((t) => t.actual.complete) ? 'done' : 'attention')),
    h('div', { class: 'small muted' }, '추정은 단어 수로 계산한 값, 실측은 만들어진 음성 파일의 실제 길이입니다. 실측이 장면 길이를 넘으면 렌더 때 장면이 자동으로 늘어납니다 — 그 전에 Script Studio에서 대사를 줄이세요.'),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['장면', '장면 길이', '추정', '실측', '판정'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((t) => { const a = t.actual; const over = a.complete ? a.overSec > 0.05 : t.status !== 'ok'; return h('tr', null,
        h('td', null, h('b', null, t.sceneId), ' ', t.title), h('td', null, fmt(t.durationSec)),
        h('td', null, chip(fmt(t.needSec), 'mock')),
        h('td', null, a.complete ? chip(fmt(a.needSec) + (a.mock ? ' (목업)' : ''), over ? 'err' : 'done') : h('span', { class: 'small muted' }, `없음 (${a.syncedLines}/${a.totalLines}줄 음성)`)),
        h('td', null, over ? chip(a.complete ? '실측 기준 넘침' : '추정 기준 넘침', 'attention') : chip(a.complete ? '실측 기준 맞음' : '추정 기준 맞음', 'done'))); })))));
}
