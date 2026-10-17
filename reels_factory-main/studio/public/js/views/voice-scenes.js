// Voice Studio · per-scene dialogue audio. Voice comes AFTER the silent animation: generate → listen → approve, regenerate without touching the animation.
// Prerequisite status is shown for every scene; the approved audio is what Lip Sync Studio and Video Studio use (exactly once).
import { h, chip, confirmDialog, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { flowOf, audioPanelBody } from './scene-flow.js';

const AUDIO = { none: ['음성 없음', 'attention'], partial: ['일부만 있음', 'attention'], unapproved: ['확인·승인 대기', 'attention'], approved: ['음성 승인됨', 'done'], stale: ['바뀜 · 다시 승인', 'err'], silent: ['대사 없음 (명시)', 'done'] };

export function voiceScenes(ep) {
  state.ui = state.ui || { open: {} }; state.ui.open = state.ui.open || {}; // the Image Studio expects ui.open to exist
  const open = (state.ui.voiceOpen = state.ui.voiceOpen || {});
  return h('div', { class: 'stack', style: 'gap:10px', 'data-voice-scenes': '' }, ep.scenes.map((sc) => {
    const f = flowOf(ep, sc.id);
    if (!f) return null;
    const a = f.audio;
    const anim = sc.clips && sc.clips.approvedVersion;
    const vs = f.voiceScene || {};
    const [label, kind] = AUDIO[a.state] || [a.state, ''];
    const base = `/api/episodes/${ep.id}/scenes/${sc.id}`;
    const rate = h('input', { type: 'number', step: 0.05, min: 0.7, max: 1.2, value: vs.rate || '', placeholder: '캐릭터 기본', 'data-voice-rate': sc.id, style: 'width:110px' });
    const emo = h('input', { type: 'text', value: vs.emotion || '', placeholder: '예: 놀람, 차분하게', 'data-voice-emotion': sc.id, style: 'width:180px' });
    const settings = a.state === 'silent' ? null : h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:flex-end' },
      h('label', { class: 'field' }, h('span', { class: 'small' }, '속도 (0.7–1.2)'), rate),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '감정 메모'), emo),
      h('button', { class: 'btn sm', type: 'button', 'data-voice-scene-save': sc.id, onclick: () => act(() => api.put(base + '/voice', { rate: rate.value, emotion: emo.value }), { ok: '장면 음성 설정을 저장했습니다 — 속도를 바꾸면 음성을 다시 만들어야 합니다' }) }, '설정 저장'),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-voice-regen': sc.id, title: '애니메이션은 건드리지 않고 이 장면의 음성만 새로 만듭니다', onclick: async () => {
        const approved = a.state === 'approved';
        if (!(await confirmDialog({ title: `${sc.id} 음성을 새로 만들까요?`, body: approved ? '승인된 음성이 있습니다. 새로 만들면 이 승인이 취소되고, 이 음성으로 만든 립싱크와 씬 승인도 다시 확인해야 합니다. 애니메이션은 그대로입니다. 실제 모드에서는 유료이며 다음 "오디오 생성"에서 글자 수를 다시 확인합니다.' : '애니메이션은 그대로 두고 이 장면의 음성을 새 테이크로 만들 준비를 합니다. 실제 모드에서는 다음 "오디오 생성"에서 글자 수를 확인한 뒤에만 비용이 듭니다.' }))) return;
        act(() => api.post(base + '/audio/regenerate', { confirmOverwrite: approved }), { ok: '새 테이크를 준비했습니다 — "오디오 생성"을 누르세요' });
      } }, '새로 만들기 (재생성)'));
    return h('details', { class: 'scene-section', 'data-voice-scene': sc.id, 'data-voice-state': a.state, open: !!open[sc.id], ontoggle: (e) => { open[sc.id] = e.target.open; } },
      h('summary', null, h('span', { class: 'section-title' }, `${sc.id} · ${sc.title_ko || sc.title || ''}`),
        h('span', { class: 'row', style: 'gap:6px' }, chip(anim ? '무음 애니메이션 승인됨' : '애니메이션 대기', anim ? 'done' : 'attention'), chip(label, kind))),
      h('div', { class: 'section-body stack', style: 'gap:10px' },
        !anim && a.state !== 'silent' ? h('div', { class: 'small muted', 'data-voice-prereq': sc.id }, '권장 순서: 이 장면의 무음 애니메이션을 먼저 승인하세요. 음성은 미리 만들 수 있지만 립싱크는 둘 다 승인된 뒤에만 시작됩니다.') : null,
        settings, audioPanelBody(ep, sc)));
  }));
}
