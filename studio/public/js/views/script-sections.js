// Script Studio building blocks for the three-section scene editor (A 시각 연출 · B 대사/자막/액션/효과음 · C 고급).
// Every control edits the canonical scene fields (ep.scenes[], ep.lines[], ep.broll[], ep.sfx[], ep.motion[]) — nothing is stored twice.
import { h, icon, toast, confirmDialog } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'small' }, label), input);
const inp = (value, on, attrs = {}) => h('input', Object.assign({ type: 'text', value: value || '', oninput: (e) => on(e.target.value) }, attrs));

/** 환경 · 조명 · 분위기 · 스타일 */
export function lookFields(sc, dirty) {
  sc.look = sc.look || {};
  const set = (k) => (v) => { sc.look[k] = v; dirty(); };
  return h('div', { class: 'grid two', style: 'gap:8px', 'data-look': sc.id },
    field('배경 · 장소', inp(sc.look.background, set('background'), { placeholder: '예: 비 오는 날 현관 앞, 아파트 복도', 'data-look-field': 'background' })),
    field('조명', inp(sc.look.lighting, set('lighting'), { placeholder: '예: 따뜻한 오후 햇빛', 'data-look-field': 'lighting' })),
    field('분위기', inp(sc.look.atmosphere, set('atmosphere'), { placeholder: '예: 아늑하고 약간 급한', 'data-look-field': 'atmosphere' })),
    field('그림체 · 스타일', inp(sc.look.style, set('style'), { placeholder: '비워 두면 기본 웹툰 스타일', 'data-look-field': 'style' })));
}

/** 출연(보임) / 참조만(장면에 나오지 않음) / 제외 — from the story's cast */
export function characterRoles(ep, sc, castList, dirty, onChange) {
  const role = (id) => ((sc.characters || []).includes(id) ? 'visible' : (sc.referenceOnly || []).includes(id) ? 'reference' : 'none');
  const apply = (id, r) => {
    const vis = new Set(sc.characters || []); const ref = new Set(sc.referenceOnly || []);
    vis.delete(id); ref.delete(id);
    if (r === 'visible') vis.add(id); else if (r === 'reference') ref.add(id);
    sc.characters = castList.map((c) => c.id).filter((x) => vis.has(x)).concat([...vis].filter((x) => !castList.some((c) => c.id === x)));
    sc.referenceOnly = castList.map((c) => c.id).filter((x) => ref.has(x));
    dirty(); onChange();
  };
  if (!castList.length) return h('div', { class: 'small muted' }, '이 에피소드에 선택된 캐릭터가 없습니다. 스토리 유니버스의 캐릭터를 먼저 고르세요.');
  return h('div', { class: 'stack', style: 'gap:6px', 'data-roles': sc.id },
    castList.map((c) => h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap', 'data-role-row': c.id },
      h('b', { style: 'min-width:70px' }, c.name),
      h('select', { 'aria-label': `${c.name} 역할`, 'data-role': c.id, onchange: (e) => apply(c.id, e.target.value) },
        [['visible', '장면에 등장 (보임)'], ['reference', '참조만 (장면에 나오지 않음)'], ['none', '이 장면에 없음']].map(([v, l]) => h('option', { value: v, selected: role(c.id) === v }, l))))),
    h('div', { class: 'small muted' }, '"참조만"은 외모 연속성을 위한 표시입니다. 이미지·영상 프롬프트에 "그리지 말 것"으로 전달되며 장면에 나오지 않습니다.'),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' },
      h('button', { class: 'btn sm ghost', type: 'button', 'data-cast-infer': sc.id, title: '이 씬의 대사 화자와 설명에 나온 이름으로 출연 캐릭터를 채웁니다', onclick: async () => {
        const d = state.draft && state.draft.script;
        if (d && (d.dirty || d.epDirty)) return toast('저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 눌러 주세요.', { error: true });
        await act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/cast/infer`), { ok: '대사·설명에 맞춰 출연 캐릭터를 채웠습니다' });
      } }, '대사·설명으로 출연 자동 채우기'),
      !(sc.characters || []).length ? h('span', { class: 'small', style: 'color:var(--rose)' }, '출연 캐릭터가 비어 있으면 캐릭터 참조 없이 엉뚱한 인물이 그려집니다.') : null));
}

export function poseFields(sc, dirty) {
  sc.pose = sc.pose || {};
  const set = (k) => (v) => { sc.pose[k] = v; dirty(); };
  return h('div', { class: 'grid two', style: 'gap:8px', 'data-pose': sc.id },
    field('몸의 위치 · 자세 배치', inp(sc.pose.body, set('body'), { placeholder: '예: Jack은 화면 왼쪽, 문을 향해 선다', 'data-pose-field': 'body' })),
    field('포즈', inp(sc.pose.pose, set('pose'), { placeholder: '예: 한 손에 우산을 들고 어깨를 으쓱', 'data-pose-field': 'pose' })));
}

// ------------------------------------------------------------------ B-cut planning (the same ep.broll[] records Storyboard develops into images)
const BCUT_KIND = [['close_up', '제품 클로즈업'], ['product_demo', '제품 시연'], ['reaction', '리액션 샷'], ['environment', '주변 디테일'], ['transition', '전환 샷'], ['insert', '인서트'], ['broll', 'B-roll']];
export function bcutPlanner(ep, sc) {
  const list = (sc.broll || []).filter((b) => b.status !== 'removed');
  const edit = async (b, patch) => { try { await api.post(`/api/episodes/${ep.id}/broll`, Object.assign({ id: b.id, sceneId: sc.id }, patch)); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } };
  const move = (i, dir) => { const ids = list.map((b) => b.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/broll/order`, { ids })); };
  return h('div', { class: 'stack', style: 'gap:8px', 'data-bcut-planner': sc.id },
    h('div', { class: 'small muted' }, 'B컷은 여기서 "무엇을 보여줄지"만 계획합니다. 이미지 만들기·업로드·승인은 Storyboard에서 같은 카드로 이어집니다 (유료 생성은 자동으로 시작되지 않습니다).'),
    list.length ? list.map((b, i) => h('div', { class: 'card flat stack', style: 'gap:6px', 'data-bcut': b.id },
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        h('select', { 'aria-label': 'B컷 종류', 'data-bcut-kind': b.id, onchange: (e) => edit(b, { kind: e.target.value }).then(() => act(async () => null)) }, BCUT_KIND.map(([v, l]) => h('option', { value: v, selected: b.kind === v }, l))),
        h('label', { class: 'small' }, '시작', h('input', { type: 'number', step: 0.5, min: 0, value: b.insertAtSec, style: 'width:64px', 'data-bcut-at': b.id, onchange: (e) => edit(b, { insertAtSec: Number(e.target.value) }).then(() => act(async () => null)) })),
        h('label', { class: 'small' }, '길이', h('input', { type: 'number', step: 0.5, min: 0.5, value: b.durationSec, style: 'width:64px', 'data-bcut-dur': b.id, onchange: (e) => edit(b, { durationSec: Number(e.target.value) }).then(() => act(async () => null)) })),
        b.status === 'approved' ? h('span', { class: 'chip done' }, '이미지 승인됨') : b.imageRef ? h('span', { class: 'chip attention' }, '이미지 있음') : null,
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn icon ghost', type: 'button', title: '위로', disabled: i === 0, onclick: () => move(i, -1) }, icon('up')),
        h('button', { class: 'btn icon ghost', type: 'button', title: '아래로', disabled: i === list.length - 1, onclick: () => move(i, 1) }, icon('down')),
        h('button', { class: 'btn icon ghost', type: 'button', title: '복제', 'data-bcut-dup': b.id, onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/duplicate`), { ok: 'B컷 계획을 복제했습니다' }) }, icon('copy')),
        h('button', { class: 'btn icon danger', type: 'button', title: '삭제', 'data-bcut-remove': b.id, onclick: async () => { if (await confirmDialog({ title: 'B컷 계획을 지울까요?', body: b.imageRef ? '연결된 이미지는 이 계획과 함께 목록에서 빠집니다 (파일은 지워지지 않습니다).' : '아직 이미지가 없는 계획입니다.', confirm: '삭제', tone: 'clay' })) act(() => api.del(`/api/episodes/${ep.id}/broll/${b.id}`), { ok: 'B컷 계획을 지웠습니다' }); } }, icon('trash'))),
      h('textarea', { rows: 2, placeholder: '무엇을 보여줄까요? 예: 우산 손잡이의 자석이 문에 딱 붙는 클로즈업', 'data-bcut-note': b.id, onchange: (e) => edit(b, { note: e.target.value }).then(() => act(async () => null)) }, b.note || ''))) : h('div', { class: 'small muted' }, '아직 B컷 계획이 없습니다.'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn sm clay', type: 'button', 'data-bcut-add': sc.id, onclick: async () => {
      const used = list.map((b) => [b.insertAtSec, b.insertAtSec + b.durationSec]);
      let at = 0; for (let g = 0; g < 40 && used.some(([a, z]) => at < z - 1e-6 && a < at + 1 - 1e-6); g++) at += 0.5;
      try { await api.post(`/api/episodes/${ep.id}/broll`, { sceneId: sc.id, kind: 'close_up', insertAtSec: at, durationSec: 1, note: '' }); await act(async () => null); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    } }, icon('plus'), 'B컷 계획 추가')));
}

// ------------------------------------------------------------------ performance elements (actions / expressions / camera)
const TYPE_LABEL = { body: '몸 동작', emotion: '감정', camera: '카메라', eyes: '눈', eyebrows: '눈썹', mouth: '입', face: '표정' };
export const MAIN = ['body', 'emotion', 'camera'];
export const FACIAL = ['eyes', 'eyebrows', 'mouth', 'face'];
const nid = (els) => { let n = els.length + 1; while (els.some((e) => e.id === 'E' + n)) n += 1; return 'E' + n; };

/** First open of an older scene: its single action/emotion texts become editable elements (the originals stay until the scene is saved). */
export function seedElements(sc) {
  if (Array.isArray(sc.elements)) return;
  const els = [];
  if ((sc.action || '').trim()) els.push({ id: 'E1', type: 'body', text: sc.action.trim() });
  if ((sc.emotion || '').trim()) els.push({ id: nid(els), type: 'emotion', text: sc.emotion.trim() });
  sc.elements = els;
}

export function elementsList(sc, castList, dirty, types, onKindChange = () => {}) {
seedElements(sc);
  const box = h('div', { class: 'stack', style: 'gap:6px', 'data-elements': types[0] });
  let dragId = null;
  const draw = () => {
    const mine = sc.elements.filter((e) => types.includes(e.type));
    box.replaceChildren(...mine.map((el) => {
      const row = h('div', { class: 'card flat row', draggable: 'true', style: 'gap:6px;flex-wrap:wrap;align-items:center', 'data-element': el.id, 'data-element-type': el.type,
        ondragstart: (e) => { dragId = el.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', el.id); } catch (_) { /* ignore */ } },
        ondragover: (e) => { if (dragId) e.preventDefault(); },
        ondrop: (e) => { e.preventDefault(); if (!dragId || dragId === el.id) return; const a = sc.elements.findIndex((x) => x.id === dragId); const [m] = sc.elements.splice(a, 1); sc.elements.splice(sc.elements.findIndex((x) => x.id === el.id), 0, m); dragId = null; dirty(); draw(); } },
        h('span', { class: 'muted', title: '끌어서 순서 바꾸기', style: 'cursor:grab' }, '⠿'),
        h('select', { 'aria-label': '종류', 'data-element-kind': el.id, onchange: (e) => { el.type = e.target.value; dirty(); draw(); onKindChange(); } }, types.map((t) => h('option', { value: t, selected: el.type === t }, TYPE_LABEL[t]))),
        castList.length ? h('select', { 'aria-label': '캐릭터', 'data-element-char': el.id, onchange: (e) => { el.characterId = e.target.value || undefined; dirty(); } }, [h('option', { value: '' }, '(전체)')].concat(castList.map((c) => h('option', { value: c.id, selected: el.characterId === c.id }, c.name)))) : null,
        h('input', { type: 'text', value: el.text, placeholder: el.type === 'camera' ? '예: 천천히 가까워지는 push-in' : '객관적으로 한 문장', style: 'flex:1;min-width:160px', 'data-element-text': el.id, oninput: (e) => { el.text = e.target.value; dirty(); } }),
        h('input', { type: 'number', step: 0.5, min: 0, value: el.t0 ?? '', placeholder: '시작', title: '시작(초, 선택)', style: 'width:62px', onchange: (e) => { el.t0 = e.target.value === '' ? undefined : Number(e.target.value); dirty(); } }),
        h('input', { type: 'number', step: 0.5, min: 0, value: el.t1 ?? '', placeholder: '끝', title: '끝(초, 선택)', style: 'width:62px', onchange: (e) => { el.t1 = e.target.value === '' ? undefined : Number(e.target.value); dirty(); } }),
        h('button', { class: 'btn icon ghost', type: 'button', title: '복제', 'data-element-dup': el.id, onclick: () => { const i = sc.elements.findIndex((x) => x.id === el.id); sc.elements.splice(i + 1, 0, Object.assign({}, el, { id: nid(sc.elements) })); dirty(); draw(); } }, icon('copy')),
        h('button', { class: 'btn icon danger', type: 'button', title: '삭제', 'data-element-remove': el.id, onclick: () => { sc.elements = sc.elements.filter((x) => x.id !== el.id); dirty(); draw(); } }, icon('trash')));
      return row;
    }));
    if (!mine.length) box.append(h('div', { class: 'small muted' }, '없음'));
  };
  draw();
  box._draw = draw;
  return box;
}

export function elementsEditor(ep, sc, castList, dirty) {
  seedElements(sc);
  const redrawOthers = () => { main._draw(); facial._draw(); };
  const main = elementsList(sc, castList, dirty, MAIN, redrawOthers);
  const facial = elementsList(sc, castList, dirty, FACIAL, redrawOthers);
  const add = (types, box) => h('button', { class: 'btn sm ghost', type: 'button', 'data-element-add': types[0], onclick: () => { sc.elements.push({ id: nid(sc.elements), type: types[0], text: '' }); dirty(); box._draw(); } }, icon('plus'), types === MAIN ? '액션 · 감정 · 카메라 추가' : '얼굴 세부 추가');
  return h('div', { class: 'stack', style: 'gap:8px', 'data-elements-editor': sc.id },
    h('div', { class: 'small muted' }, '몸 동작 · 감정 · 카메라를 각각 추가·복제·삭제·드래그 정렬할 수 있습니다. 시간은 선택입니다 (0.5초 비트는 "고급 설정"). 저장하면 기존 "캐릭터 행동/감정" 텍스트에 자동 반영됩니다.'),
    main, add(MAIN, main),
    h('details', { class: 'scene-section', 'data-facial': sc.id, open: sc.elements.some((e) => FACIAL.includes(e.type)) ? true : undefined }, h('summary', null, h('span', { class: 'section-title' }, '얼굴 세부 (눈 · 눈썹 · 입 · 표정)'), h('span', { class: 'small muted' }, '선택')), h('div', { class: 'section-body stack', style: 'gap:8px' }, facial, add(FACIAL, facial))));
}

/** A list of performance elements of the given types + its add button (used by Storyboard's image editor; same `scene.elements` as Script Studio). */
export function elementsBlock(sc, castList, dirty, types, addLabel) {
  const list = elementsList(sc, castList, dirty, types);
  return h('div', { class: 'stack', style: 'gap:6px', 'data-elements-block': types[0] }, list,
    h('button', { class: 'btn sm ghost', type: 'button', 'data-element-add': types[0], onclick: () => { sc.elements.push({ id: nid(sc.elements), type: types[0], text: '' }); dirty(); list._draw(); } }, icon('plus'), addLabel));
}
