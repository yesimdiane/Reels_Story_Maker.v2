// The shared 0.5-second visual beat timeline editor. ONE component, used by Script Studio (Advanced) and Storyboard (Advanced):
// both read and write the same ep.motion[sid].beats through the same API, so there is never a second timeline.
// Beats are objective, observation-style descriptions (like reading CCTV footage): who is where, what the body does, the face, the camera,
// what changes in the environment. Start/end are validated by the server (0.5 s grid, inside the scene length, no overlaps per character).
import { h, icon, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { openAnimGenerate } from './anim-plan.js';

const refresh = () => act(async () => null);

export function motionPanel(ep, sc) {
  const key = `motion:${ep.id}:${sc.id}`;
  const base = (sc.motion && sc.motion.beats) || [];
  const draft = (state.draft[key] = state.draft[key] || { beats: base.map((b) => Object.assign({}, b)), rev: sc.motion ? sc.motion.rev : 0 });
  if (draft.rev !== (sc.motion ? sc.motion.rev : 0)) { draft.beats = base.map((b) => Object.assign({}, b)); draft.rev = sc.motion ? sc.motion.rev : 0; }
  const castOpts = (sc.characters || []).map((id) => ({ id, name: ((state.summary.characters.find((c) => c.id === id) || {}).name) || id }));
  const charNames = castOpts.map((c) => c.name);
  const list = h('div', { class: 'stack', style: 'gap:8px', 'data-motion-beats': sc.id });
  const err = h('div', { class: 'issue err', style: 'display:none' });
  const draw = () => {
    list.replaceChildren(...draft.beats.map((b, k) => h('div', { class: 'beat-row card flat', 'data-beat': k },
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        h('label', { class: 'small' }, '시작', h('input', { type: 'number', step: 0.3, min: 0, max: sc.durationSec, value: b.t0, style: 'width:70px', 'data-beat-t0': '', oninput: (e) => (b.t0 = Number(e.target.value)) })),
        h('label', { class: 'small' }, '끝', h('input', { type: 'number', step: 0.3, min: 0.1, max: sc.durationSec, value: b.t1, style: 'width:70px', 'data-beat-t1': '', oninput: (e) => (b.t1 = Number(e.target.value)) })), 's',
        h('select', { 'aria-label': '캐릭터', 'data-beat-char': '', onchange: (e) => { b.characterId = e.target.value; b.character = (castOpts.find((c) => c.id === e.target.value) || {}).name || b.character; } }, castOpts.map((c) => h('option', { value: c.id, selected: (b.characterId || (castOpts.find((x) => x.name === b.character) || {}).id) === c.id }, c.name))),
        h('button', { class: 'btn icon danger', type: 'button', 'aria-label': '비트 삭제', onclick: () => { draft.beats.splice(k, 1); draw(); } }, icon('trash'))),
      h('div', { class: 'grid two', style: 'gap:6px' }, [['emotion', '감정 (필수)'], ['body', '몸 동작'], ['gaze', '시선'], ['expression', '표정 (눈썹·눈꺼풀·입)'], ['camera', '카메라 (필요할 때만)']].map(([f, l]) => h('label', { class: 'field' }, h('span', { class: 'small' }, l), h('input', { type: 'text', value: b[f] || '', 'data-beat-field': f, oninput: (e) => (b[f] = e.target.value) })))))));
    if (!draft.beats.length) list.append(h('div', { class: 'small muted' }, '아직 비트가 없습니다. "애니메이션 자동 생성"으로 시작하거나 비트를 추가하세요. 모든 부위를 채울 필요는 없습니다.'));
  };
  draw();
  return h('div', { class: 'stack', style: 'gap:10px' },
    h('div', { class: 'small', 'data-cctv-hint': '' }, 'CCTV 영상을 분석하듯 객관적으로 적으세요: 누가 어디에 있고, 몸이 무엇을 하고, 표정·카메라·주변이 어떻게 바뀌는지 (감정 추측이나 평가는 쓰지 않습니다). 예) 0.0–0.5s: Jack이 우산을 들고 화면에 들어온다. 0.5–1.0s: 오른손이 문 쪽으로 움직인다.'),
    h('div', { class: 'small muted' }, `장면 길이 ${sc.durationSec}초 · 기본 0.5초, 음성 종료 시 0.3초 단위로 조정. 기존 시간도 유지됩니다. 자연스러운 정지·유지 구간을 남겨 두세요. 저장하면 영상 프롬프트 끝에 타임라인이 붙습니다.`),
    list, err,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', 'data-motion-add': sc.id, onclick: () => { const last = draft.beats[draft.beats.length - 1]; const t0 = last ? Math.min(last.t1, sc.durationSec - 0.5) : 0; draft.beats.push({ t0, t1: Math.min(sc.durationSec, t0 + 0.5), characterId: (castOpts[0] || {}).id || '', character: charNames[0] || '', emotion: '', body: '', gaze: '', expression: '', camera: '' }); draw(); } }, icon('plus'), '비트 추가'),
      h('button', { class: 'btn sm clay', type: 'button', 'data-motion-generate': sc.id, onclick: () => openAnimGenerate(ep, sc, { onDone: () => { delete state.draft[key]; } }) }, '애니메이션 자동 생성'),
      h('button', { class: 'btn sm', type: 'button', 'data-motion-save': sc.id, onclick: async () => { err.style.display = 'none'; try { await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/motion`, { beats: draft.beats }); delete state.draft[key]; toast('움직임 계획을 저장했습니다'); await refresh(); } catch (e) { err.textContent = e.message; err.style.display = ''; toast(e.message, { error: true }); } } }, '움직임 저장')),
    (sc.motion && (sc.motion.history || []).length) ? h('div', { class: 'small muted' }, `이전 버전 ${(sc.motion.history || []).length}개가 기록에 있습니다.`) : null);
}

