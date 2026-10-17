// Animation Studio readiness: the animation is SILENT. Nothing about audio, sound effects or lip sync is required first —
// voice, lip sync and SFX come after the approved silent animation (Voice Studio → Lip Sync Studio → Video Studio).
import { h, chip } from '../ui.js';
import { flowOf } from './scene-flow.js';

export function gatesPanel(ep, sc) {
  const f = flowOf(ep, sc.id);
  if (!f || !f.gate) return null;
  const g = f.gate;
  const approved = !!(sc.clips && sc.clips.approvedVersion);
  const hasDialogue = f.audio.state !== 'silent';
  const list = h('ul', { class: 'stack', style: 'gap:4px;margin:0;padding-left:18px', 'data-gate-checklist': sc.id }, g.items.map((i) => h('li', { 'data-gate-item': i.key, 'data-gate-ok': i.ok ? '1' : '0', style: i.ok ? '' : 'color:var(--clay)' }, (i.ok ? '✓ ' : '✗ ') + i.label, i.detail ? h('span', { class: 'small muted' }, ' — ' + i.detail) : null)));
  return h('section', { class: 'card stack', style: 'gap:8px', 'data-anim-gates': sc.id, 'data-gates-ready': g.ready ? '1' : '0' },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:6px' }, h('h3', { style: 'margin:0' }, '무음 애니메이션 준비'), chip(g.ready ? '준비됨' : `${g.items.filter((i) => !i.ok).length}개 남음`, g.ready ? 'done' : 'attention')),
    list,
    h('div', { class: 'small muted', 'data-silent-note': '' }, '이 단계는 소리 없는 영상만 만듭니다. 대사 음성·립싱크·효과음은 애니메이션을 승인한 뒤 보이스 → 립싱크 → 비디오 스튜디오에서 진행하며, 여기서는 필요하지 않습니다. 프롬프트에는 "말하는 입 모양 금지" 규칙이 자동으로 들어갑니다.'),
    approved ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', 'data-anim-next': sc.id }, chip('무음 애니메이션 승인됨 — 원본으로 보존', 'done'),
      hasDialogue ? h('a', { class: 'btn sm', href: '#/voice/' + ep.id }, '다음: 보이스 스튜디오') : chip('대사 없는 장면 — 보이스·립싱크 건너뜀', 'done'),
      !hasDialogue ? h('a', { class: 'btn sm ghost', href: '#/render/' + ep.id }, '비디오 스튜디오') : null) : null);
}
