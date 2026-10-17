// "애니메이션 자동 생성": per-scene animation beats from the approved script. Free rules draft, or a low-cost text-AI plan (estimate + confirmation).
// Hand-edited beats are replaced only after an explicit confirmation (the previous version stays in the history).
import { h, chip, modal, toast, fmtUsd } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';

export async function openAnimGenerate(ep, sc, { onDone } = {}) {
  const manual = !!(sc.motion && sc.motion.source === 'manual');
  let est = null;
  try { est = await api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/motion/estimate`, {}); } catch (_) { est = null; }
  const st = { replace: false, unknown: false };
  modal((close) => {
    const status = h('div', { class: 'small', 'data-anim-status': '' });
    const run = async (mode) => {
      if (manual && !st.replace) return toast('직접 수정한 비트를 교체하려면 체크하세요', { error: true });
      if (mode === 'ai' && est && est.usd == null && !st.unknown) return toast('가격을 모르는 상태로 진행하려면 체크하세요', { error: true });
      status.textContent = mode === 'ai' ? '계획 만드는 중… (텍스트 모델 호출 1회)' : '만드는 중…';
      try {
        await api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/motion/generate`, { mode, replace: st.replace, confirm: mode === 'ai' ? { paid: true, unknownCost: st.unknown } : undefined });
        close(); toast('애니메이션 비트를 만들었습니다. 확인 후 저장된 계획이 영상 프롬프트에 붙습니다.'); if (onDone) onDone();
      } catch (e) { status.textContent = '실패: ' + e.message + (e.recovery ? ' — ' + e.recovery : ''); toast(e.message, { error: true, recovery: e.recovery }); }
      await act(async () => null);
    };
    return h('div', { class: 'stack', style: 'gap:12px' },
      h('h2', { style: 'margin:0' }, `${sc.id} · 애니메이션 자동 생성`),
      h('div', { class: 'small muted' }, `승인된 대본의 대사, 시각 연출, 액션, 장면 길이(${sc.durationSec}초)로 0.5초 단위 비트를 만듭니다. 영상은 만들지 않습니다.`),
      sc.animQuality && sc.animQuality.generic ? h('div', { class: 'issue warn' }, `현재 ${sc.animQuality.generic}개 비트가 일반적인 자리표시 문구입니다.`) : null,
      manual ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', 'data-anim-replace': '', onchange: (e) => { st.replace = e.target.checked; } }), '직접 수정한 비트를 교체합니다 (이전 버전은 기록에 남습니다)') : null,
      h('div', { class: 'card flat stack', style: 'gap:6px' }, h('b', null, '무료 · 규칙 기반'), h('div', { class: 'small muted' }, 'AI를 호출하지 않습니다. 대사 내용에 맞는 제스처·표정, 시각 연출의 시간 구간, 카메라 단어, 마지막 동작을 반영합니다.'),
        h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', 'data-anim-rules': sc.id, onclick: () => run('rules') }, '무료로 만들기'))),
      h('div', { class: 'card flat stack', style: 'gap:6px' }, h('b', null, 'AI 계획 (저비용 텍스트 모델)'),
        h('div', { class: 'small muted' }, est ? `${est.provider} / ${est.model || '(모델 미선택)'} · 예상 ${est.usd == null ? '알 수 없음' : fmtUsd(est.usd)} (추정). 버튼을 누를 때만 1회 호출하며 실패해도 자동 재시도하지 않습니다.` : '예상 비용을 계산하지 못했습니다.'),
        est && est.usd == null ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', onchange: (e) => { st.unknown = e.target.checked; } }), '가격을 모르는 상태로 진행합니다') : null,
        h('div', { class: 'row end' }, h('button', { class: 'btn clay', type: 'button', 'data-anim-ai': sc.id, disabled: !ep.derived.scriptApproved, title: ep.derived.scriptApproved ? '' : '대본 승인 후에만 가능합니다', onclick: () => run('ai') }, 'AI로 계획 (유료일 수 있음)'))),
      status,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')));
  });
}
