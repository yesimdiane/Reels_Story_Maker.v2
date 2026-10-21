// Storyboard scene editor: the three consolidated sections (① 이미지 제작 · ② 애니메이션 · 오디오 준비 · ③ B-roll 제작).
// These blocks only EDIT the shared episode data (ep.scenes[] look/pose/elements, ep.imagePrompts, ep.prompts, ep.motion, ep.lines voices, ep.broll);
// video generation itself lives in Animation Studio.
import { h, chip, icon, confirmDialog, toast, modal } from '../ui.js';
import { state, act, go } from '../state.js';
import { api } from '../api.js';

export const SHOTS = [['wide', 'Wide shot', '넓은 전체 샷'], ['medium', 'Medium shot', '허리 위 샷'], ['close', 'Close-up', '얼굴 클로즈업'], ['xclose', 'Extreme close-up', '아주 가까운 디테일'], ['ots', 'Over-the-shoulder', '어깨 너머'], ['product', 'Product detail shot', '제품 디테일'], ['low', 'Low angle', '아래에서 올려보는'], ['high', 'High angle', '위에서 내려보는']];

/** a section wrapper: numbered title, one-line purpose, children */
export function block(key, no, title, hint, ...kids) {
  return h('section', { class: 'sb-block', 'data-sb-section': key },
    h('div', { class: 'sb-block-head' }, h('span', { class: 'sb-no' }, no), h('div', null, h('h3', { style: 'margin:0' }, title), h('div', { class: 'small muted' }, hint))),
    ...kids);
}

// Camera MOVEMENT (for the video): same camera element mechanism, text "Camera movement: <name>"; one movement per scene, "Static" is the default (nothing stored)
export const MOVES = [['static', 'Static', '고정'], ['pan_left', 'Pan Left', '패닝 왼쪽'], ['pan_right', 'Pan Right', '패닝 오른쪽'], ['tilt_up', 'Tilt Up', '틸트 위'], ['tilt_down', 'Tilt Down', '틸트 아래'], ['zoom_in', 'Zoom In', '줌 인'], ['zoom_out', 'Zoom Out', '줌 아웃'], ['dolly_in', 'Dolly In', '돌리 인'], ['dolly_out', 'Dolly Out', '돌리 아웃'], ['tracking', 'Tracking Shot', '트래킹'], ['handheld', 'Handheld', '핸드헬드']];
const MOVE_PREFIX = 'Camera movement: ';
export function moveChips(sc, dirty, redraw) {
  const cur = (sc.elements || []).find((e) => e.type === 'camera' && String(e.text || '').startsWith(MOVE_PREFIX));
  const curKey = cur ? (MOVES.find(([, en]) => cur.text === MOVE_PREFIX + en) || [])[0] : 'static';
  return h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', 'data-move-chips': sc.id }, MOVES.map(([k, en, ko]) => h('button', { class: 'chip' + (curKey === k ? ' done' : ''), type: 'button', 'data-move-chip': k, title: ko, 'aria-pressed': curKey === k ? 'true' : 'false', onclick: () => {
    sc.elements = (sc.elements || []).filter((e) => e !== cur);
    if (k !== 'static') { let n = sc.elements.length + 1; while (sc.elements.some((e) => e.id === 'E' + n)) n += 1; sc.elements.push({ id: 'E' + n, type: 'camera', text: MOVE_PREFIX + en }); }
    dirty(); redraw();
  } }, `${en} · ${ko}`)));
}

/** shot-type chips: they add/replace one camera element on the scene (same `scene.elements` as Script Studio) */
export function shotChips(sc, dirty, redraw) {
  const cur = (sc.elements || []).find((e) => e.type === 'camera' && SHOTS.some((s) => e.text.startsWith(s[1])));
  return h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', 'data-shot-chips': sc.id }, SHOTS.map(([k, en, ko]) => h('button', { class: 'chip' + (cur && cur.text.startsWith(en) ? ' done' : ''), type: 'button', 'data-shot': k, title: ko, onclick: () => {
    sc.elements = sc.elements || [];
    const same = cur && cur.text.startsWith(en);
    sc.elements = sc.elements.filter((e) => e !== cur);
    if (!same) { let n = sc.elements.length + 1; while (sc.elements.some((e) => e.id === 'E' + n)) n += 1; sc.elements.push({ id: 'E' + n, type: 'camera', text: en }); }
    dirty(); redraw();
  } }, `${en}`)));
}

// ------------------------------------------------------------------ dialogue + voice selection
function voiceLabel(c) {
  const v = c.voice || {};
  if (v.provider === 'google' && v.googleVoiceName) return `Google · ${v.googleVoiceName}`;
  if (v.heygenVoiceId) return `HeyGen · ${v.voiceName || v.verifiedName || v.heygenVoiceId.slice(0, 10)}${v.verified ? '' : ' (미확인)'}`;
  return '목소리 미지정';
}
async function pickVoice(c) {
  const provider = (c.voice && c.voice.provider) || 'heygen';
  modal((close) => {
    const list = h('div', { class: 'stack', style: 'gap:6px;max-height:50vh;overflow:auto', 'data-voice-list': c.id });
    const q = h('input', { type: 'text', placeholder: '이름 · 언어로 검색', 'data-voice-search': '' });
    const draw = async () => {
      let r;
      try { r = await api.get(`/api/voices/list?provider=${provider}&q=${encodeURIComponent(q.value)}&limit=40`); } catch (e) { list.replaceChildren(h('div', { class: 'issue err' }, e.message)); return; }
      list.replaceChildren(...(r.voices.length ? r.voices.map((v) => h('div', { class: 'card flat row', style: 'gap:8px;align-items:center' }, h('div', { style: 'flex:1' }, h('b', null, v.name || v.id), h('div', { class: 'small muted' }, [v.languageLabel || v.language, v.gender, v.type].filter(Boolean).join(' · '))),
        h('button', { class: 'btn sm sage', type: 'button', 'data-voice-pick': v.id, onclick: async () => { await act(() => api.put(`/api/characters/${c.id}/voice`, { provider, voiceId: v.id }).then(() => null), { ok: `${c.name}의 목소리를 바꿨습니다 (새 음성은 직접 생성해야 합니다)` }); close(); } }, '선택'))) : [h('div', { class: 'small muted' }, '동기화된 목소리가 없습니다. 설정 → 음성 연결에서 목소리 목록을 동기화하세요.')]));
    };
    q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(draw, 250); });
    draw();
    return h('div', { class: 'stack', style: 'gap:10px' }, h('h2', { style: 'margin:0' }, `${c.name} 목소리 선택 (${provider === 'google' ? 'Google Cloud TTS' : 'HeyGen'})`), q, list, h('div', { class: 'small muted' }, '목소리를 바꿔도 음성이 자동으로 다시 만들어지지 않습니다 (유료 생성은 직접 시작).'), h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')));
  }, { wide: true });
}
export function dialoguePanelBody(ep, sc) {
  const lines = (ep.lines || []).filter((l) => l.sceneId === sc.id);
  const chars = state.summary.characters || [];
  const speakers = [...new Set(lines.map((l) => l.speaker))];
  if (!lines.length) return h('div', { class: 'small muted', 'data-dialogue-lines': sc.id }, '이 장면에는 대사가 없습니다. 대사는 대본 스튜디오에서 만듭니다.');
  return h('div', { class: 'stack', style: 'gap:8px', 'data-dialogue-lines': sc.id },
    lines.map((l) => { const c = chars.find((x) => x.id === l.speaker) || { name: l.speaker }; return h('div', { class: 'card flat stack', style: 'gap:2px', 'data-dialogue-line': l.id }, h('div', { class: 'row', style: 'gap:6px' }, h('b', null, c.name), h('span', { class: 'small muted' }, l.id)), h('div', null, l.en), h('div', { class: 'small muted' }, l.ko)); }),
    h('div', { class: 'stack', style: 'gap:6px' }, h('b', { class: 'small' }, '목소리'), speakers.map((id) => { const c = chars.find((x) => x.id === id); return c ? h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap', 'data-voice-row': id }, h('b', null, c.name), h('span', { class: 'small muted' }, voiceLabel(c)), h('button', { class: 'btn sm ghost', type: 'button', 'data-voice-change': id, onclick: () => pickVoice(c) }, '목소리 선택')) : null; })),
    h('div', { class: 'row', style: 'gap:6px' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => go('script') }, '대사 수정 (대본 스튜디오)')));
}

// ------------------------------------------------------------------ animation hand-off (generation itself is Animation Studio)
export function openAnimationStudio(ep, sid) {
  state.ui = state.ui || { open: {} };
  state.ui.anim = state.ui.anim || {};
  state.ui.anim[ep.id] = sid;
  location.hash = `#/animation/${ep.id}`;
}
export function animationHandoff(ep, sc) {
  const c = sc.clips || { versions: [], approvedVersion: null };
  const label = c.approvedVersion ? `클립 v${c.approvedVersion} 승인됨` : c.versions.length ? `클립 ${c.versions.length}개 · 검토 대기` : '아직 클립 없음';
  return h('div', { class: 'card flat row', style: 'gap:10px;align-items:center;flex-wrap:wrap', 'data-anim-handoff': sc.id },
    h('div', { style: 'flex:1;min-width:180px' }, h('b', { class: 'small' }, '영상 만들기'), h('div', { class: 'small muted' }, `${label} — 여기서는 프롬프트와 타임라인을 준비하고, 모델 선택·비용 확인·생성·승인은 애니메이션 스튜디오에서 합니다.`)),
    chip(label, c.approvedVersion ? 'done' : ''),
    h('button', { class: 'btn sm clay', type: 'button', 'data-open-animation': sc.id, onclick: () => openAnimationStudio(ep, sc.id) }, '애니메이션 스튜디오에서 열기 →'));
}

// ------------------------------------------------------------------ editable image prompt
export function imagePromptBody(ep, sc) {
  const ip = sc.imagePrompt || { text: '', auto: '', edited: false };
  const ta = h('textarea', { rows: 8, 'data-image-prompt': sc.id, 'aria-label': '이미지 프롬프트' }, ip.text);
  const save = h('button', { class: 'btn sm', type: 'button', 'data-image-prompt-save': sc.id, onclick: () => act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/image-prompt`, { text: ta.value }), { ok: '이미지 프롬프트를 저장했습니다 (직접 수정은 자동으로 덮어쓰지 않습니다)' }) }, '프롬프트 저장');
  return h('div', { class: 'stack', style: 'gap:8px' },
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, chip(ip.edited ? '직접 수정됨' : '자동 합성', ip.edited ? 'attention' : 'mock'), ip.rev ? h('span', { class: 'small muted' }, `r${ip.rev}`) : null),
    h('div', { class: 'small muted' }, '위의 환경·캐릭터·포즈·동작·감정·카메라 선택과 장면 설명이 자동으로 합쳐진 문장입니다. 직접 고치면 그 글이 우선하며, 다른 항목을 바꿔도 덮어쓰지 않습니다. 캐릭터 고정·제품·"글자 넣지 않기" 규칙은 생성할 때 코드가 자동으로 붙입니다.'),
    ta,
    ip.edited && ip.auto !== ta.value ? h('details', { class: 'small' }, h('summary', null, '현재 자동 합성 문장 보기'), h('pre', { class: 'mono small', style: 'white-space:pre-wrap' }, ip.auto)) : null,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, save,
      h('button', { class: 'btn sm ghost', type: 'button', 'data-image-prompt-reset': sc.id, disabled: !ip.edited, onclick: async () => { if (await confirmDialog({ title: '자동 합성으로 되돌릴까요?', body: '직접 수정한 글은 기록에 남고 이후 생성에는 자동 합성 문장이 쓰입니다.', confirm: '되돌리기', tone: 'clay' })) act(() => api.del(`/api/episodes/${ep.id}/scenes/${sc.id}/image-prompt`), { ok: '자동 합성으로 되돌렸습니다' }); } }, '자동으로 되돌리기')));
}

/**
 * Which product reference image set and which product structure description a frame was made with, plus every earlier frame (V1, V2, V3 …).
 * Read-only: nothing is regenerated when a newer description is approved — the operator decides whether to press "다시 만들기".
 */
export function frameProvenance(sc) {
  const info = sc.startImageInfo || {};
  const pc = info.productContext || null;
  const vers = sc.startImageVersions || [];
  if (!pc && !vers.length) return null;
  const items = [];
  if (info.generated || pc) {
    const v = info.version ? `이 이미지 V${info.version}` : '이 이미지';
    items.push(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center', 'data-frame-provenance': sc.id },
      chip(v, 'mono'),
      pc ? chip('제품 참조 이미지 세트 ' + (pc.referenceImageSetVersion ? 'V' + pc.referenceImageSetVersion : '기록 없음'), '') : chip('제품이 없는 장면', 'mock'),
      pc ? chip(pc.structureVersion ? `제품 구조 설명 v${pc.structureVersion}` : '구조 설명 없이 생성', pc.structureVersion ? 'done' : 'attention') : null,
      pc && pc.structureVersion && sc.structureApprovedV && sc.structureApprovedV !== pc.structureVersion ? chip(`현재 승인 v${sc.structureApprovedV}`, 'attention') : null));
    if (pc && pc.structureStale) items.push(h('div', { class: 'small', style: 'color:var(--clay)' }, '이 이미지를 만들 때 구조 설명은 현재 첨부된 제품 이미지와 다른 이미지 세트로 만들어진 것이었습니다.'));
    if (pc && pc.structureVersion && sc.structureApprovedV && sc.structureApprovedV !== pc.structureVersion) items.push(h('div', { class: 'small muted' }, '이후 새 구조 설명이 승인되었습니다. 이 이미지는 자동으로 다시 만들어지지 않습니다 — 필요하면 직접 "다시 만들기"를 누르세요(비용 확인 후).'));
  }
  if (vers.length) {
    items.push(h('details', { class: 'small', 'data-frame-versions': sc.id }, h('summary', { style: 'cursor:pointer;min-height:32px;display:flex;align-items:center' }, `이전 이미지 버전 (${vers.length}) — 모두 보존됩니다`),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:flex-start;margin-top:6px' }, vers.slice().reverse().map((v) => h('figure', { class: 'ref' + (v.current ? ' ok' : ''), style: 'width:116px;margin:0', 'data-frame-version': v.v },
        h('img', { src: v.url, alt: `${sc.id} V${v.v}`, loading: 'lazy', style: 'width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px' }),
        h('figcaption', { class: 'small' }, h('b', null, `V${v.v}`), v.current ? ' · 현재' : '', h('div', { class: 'muted' }, v.generated ? `${v.provider || 'AI'}` : (v.earlier ? '이전 이미지' : '올린 이미지')),
          v.productContext ? h('div', { class: 'muted' }, `세트 V${v.productContext.referenceImageSetVersion || '–'} · 설명 ${v.productContext.structureVersion ? 'v' + v.productContext.structureVersion : '없음'}`) : null))))));
  }
  return h('div', { class: 'stack', style: 'gap:6px' }, items);
}
