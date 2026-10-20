// Storyboard Studio: image and animation asset development, ONE scene at a time.
// Default view: scene title, main image, asset status and the primary actions (save / approve image / regenerate / next / + cut).
// Product appearance (ON/OFF + placement), prompts, the 0.5-second movement plan, cuts and B-roll live in collapsed panels.
// Nothing here starts a paid generation without its own cost review.
import { h, chip, icon, copyText, confirmDialog, toast, modal } from '../ui.js';
import { state, act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { imageDevCard } from './image-dev.js';
import { translateControl } from './translate-box.js';
import { openCutEditor } from './cut-editor.js';
import { charRefsPanelBody, charRefsBadge } from './scene-charrefs.js';
import { openBrollAi, previewBroll } from './broll-ai.js';
import { openAnimGenerate } from './anim-plan.js';
import { motionPanel } from './beat-timeline.js';
import { block, shotChips, dialoguePanelBody, animationHandoff, imagePromptBody, frameProvenance } from './storyboard-sections.js';
import { lookFields, characterRoles, poseFields, elementsBlock, seedElements } from './script-sections.js';
import { stepper, audioPanelBody, audioBadge, composePanelBody, composeBadge } from './scene-flow.js';
import { sceneGallery } from './scene-gallery.js';
import { readinessCard } from './render-readiness.js';
import { previewImage, pageHead, noEpisode, lockedNotice, productRefStrip, makeStartImages } from './common.js';

const PLACE = { position: [['', '—'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['foreground', '앞쪽'], ['background', '뒤쪽']], scale: [['', '—'], ['small', '작게'], ['medium', '보통'], ['large', '크게']], orientation: [['', '—'], ['front', '정면'], ['side', '옆면'], ['angled', '비스듬히'], ['top', '위에서'], ['back', '뒷면']], visibility: [['', '—'], ['partial', '일부만'], ['full', '전체'], ['hero', '주인공처럼']] };
const PLACE_LABEL = { position: '위치', scale: '크기', orientation: '방향', visibility: '노출' };
const BROLL_KIND = [['close_up', '클로즈업'], ['reaction', '리액션 컷'], ['insert', '인서트'], ['broll', 'B-roll']];
const BROLL_STATE = { proposed: ['검토 대기', 'attention'], approved: ['승인됨', 'done'], rejected: ['거절', 'err'] };

const uiState = () => { state.ui = state.ui || { open: {} }; return state.ui; };
const curIndex = (ep) => { const u = uiState(); const k = u.sbScene && u.sbScene[ep.id]; const i = ep.scenes.findIndex((s) => s.id === k); return i >= 0 ? i : 0; };
const setIndex = (ep, i) => { const u = uiState(); u.sbScene = u.sbScene || {}; u.sbScene[ep.id] = ep.scenes[Math.max(0, Math.min(ep.scenes.length - 1, i))].id; };
const refresh = () => act(async () => null);

export function storyboard() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const sbOk = ep.derived.storyboardApproved;
  const wrap = h('div', { class: 'stack', style: 'gap:16px' });
  wrap.append(pageHead('Image Studio', '이미지 스튜디오', '승인된 대본의 장면을 이미지와 애니메이션 에셋으로 개발합니다. 승인 전에는 어떤 유료 생성도 시작되지 않습니다.'));
  if (!ep.derived.scriptApproved) wrap.append(lockedNotice('대본이 승인되어야 스토리보드를 승인할 수 있습니다.', 'script', '대본으로 이동'));
  if (ep.derived.storyboardChangedSinceApproval) wrap.append(h('div', { class: 'banner warn', 'data-sb-changed': '' }, h('div', null, h('b', null, '승인 후 스토리보드가 수정되었습니다'), '바뀐 장면만 다시 확인하고 승인하면 됩니다 (바뀌지 않은 장면의 승인은 유지됩니다).', h('ul', { style: 'margin:6px 0 0 18px' }, (ep.derived.storyboardApproval.reasons || []).map((r) => h('li', null, r))))));
  autoBuild(ep);
  if (!ep.scenes.length) { wrap.append(h('div', { class: 'empty' }, '장면이 없습니다. 대본 스튜디오에서 장면을 만드세요.')); return wrap; }
  const i = curIndex(ep);
  const sc = ep.scenes[i];
  const go = (k) => { setIndex(ep, k); import('../state.js').then(({ hooks }) => hooks.rerender()); };
  // One explicit batch request for the cuts the operator has finished choosing.
  // Selection is UI-only; the existing server estimate, approval and paid-call gates remain authoritative.
  const selection = uiState();
  selection.sbImageBatch = selection.sbImageBatch || {};
  const existing = selection.sbImageBatch[ep.id];
  const eligible = ep.scenes.filter((s) => !(s.startImageInfo && s.startImageInfo.approved));
  const selected = new Set(Array.isArray(existing) ? existing.filter((id) => eligible.some((s) => s.id === id)) : eligible.map((s) => s.id));
  selection.sbImageForce = selection.sbImageForce || {};
  let regenerateExisting = !!selection.sbImageForce[ep.id];
  const batchButton = h('button', { class: 'btn clay', type: 'button', 'data-sb-generate-selected': ep.id,
    disabled: !ep.derived.scriptApproved || selected.size === 0,
    onclick: async () => {
      if (!selected.size) return;
      await makeStartImages(ep, [...selected], { force: regenerateExisting, after: refresh });
    } }, '선택한 컷 이미지 요청 (' + selected.size + ')');
  const selectionList = h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap', 'data-sb-image-selection': ep.id },
    ep.scenes.map((s) => {
      const approved = !!(s.startImageInfo && s.startImageInfo.approved);
      return h('label', { class: 'small row', style: 'gap:4px;cursor:pointer' },
        h('input', { type: 'checkbox', checked: selected.has(s.id), disabled: approved,
          'data-sb-select-cut': s.id, onchange: (e) => {
            if (e.target.checked) selected.add(s.id); else selected.delete(s.id);
            selection.sbImageBatch[ep.id] = [...selected];
            batchButton.textContent = '선택한 컷 이미지 요청 (' + selected.size + ')';
            batchButton.disabled = !ep.derived.scriptApproved || selected.size === 0;
          } }), s.id + (approved ? ' · 승인됨' : ''));
    }));
  wrap.append(h('section', { class: 'card stack', style: 'gap:10px', 'data-sb-image-batch': ep.id },
    h('div', { class: 'row between', style: 'gap:10px;flex-wrap:wrap' },
      h('div', null, h('b', null, '컷별 이미지 일괄 요청'),
        h('div', { class: 'small muted' }, '컷 구성을 저장한 후 요청하세요. 승인된 이미지는 보호됩니다. 기존 미승인 이미지도 재생성 옵션으로 새 버전을 만들 수 있습니다.')),
      batchButton),
    selectionList,
    h('label', { class: 'small row', style: 'gap:8px;align-items:center;cursor:pointer' },
      h('input', { type: 'checkbox', 'data-sb-force-existing': ep.id, checked: regenerateExisting, onchange: (e) => { regenerateExisting = e.target.checked; selection.sbImageForce[ep.id] = regenerateExisting; } }),
      '기존 미승인 이미지도 다시 생성 (추가 비용 발생 가능)'),
    h('div', { class: 'small muted' }, '기존 이미지를 건너뛰지 않고 새 이미지를 요청합니다. 실제 생성은 예상 비용 및 명시적 결제 승인 후 시작하며, 승인된 이미지는 덮어쓰지 않습니다.'),
    h('div', { class: 'row', style: 'gap:8px' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
        selected.clear(); eligible.forEach((s) => selected.add(s.id));
        selection.sbImageBatch[ep.id] = [...selected]; import('../state.js').then(({ hooks }) => hooks.rerender());
      } }, '미승인 컷 전체 선택'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
        selected.clear(); selection.sbImageBatch[ep.id] = []; import('../state.js').then(({ hooks }) => hooks.rerender());
      } }, '선택 해제')),
    h('div', { class: 'small muted' }, '클릭하면 먼저 예상 비용을 확인합니다. 비용 승인 전에는 AI 이미지 생성 요청을 보내지 않습니다.')));
  wrap.append(sceneGallery(ep, (sid) => { setIndex(ep, ep.scenes.findIndex((x) => x.id === sid)); import('../state.js').then(({ hooks }) => hooks.rerender()); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  wrap.append(h('div', { class: 'scene-tabs', role: 'tablist', 'aria-label': '장면 목록' }, ep.scenes.map((s, k) => {
    const img = s.startImageInfo;
    const ok = img && !img.error && img.approved;
    return h('button', { class: 'btn sm ghost scene-tab' + (k === i ? ' current' : ''), type: 'button', role: 'tab', 'aria-selected': k === i ? 'true' : 'false', 'data-sb-tab': s.id, onclick: () => go(k) }, s.id, ok ? h('span', { class: 'tab-badge ok' }, '✓') : null);
  })));
  const card = sceneCard(ep, sc, i, state.summary.characters, go);
  wrap.append(card.el);
  wrap.append(card.bar);
  wrap.append(readinessCard(ep));
  wrap.append(projectPanel(ep, sbOk));
  return wrap;
}

function sceneCard(ep, sc, i, chars, go) {
  const key = 'sb:' + sc.id;
  const d = (state.draft[key] = state.draft[key] || { visual: sc.visual, video: sc.prompt ? sc.prompt.video : '', negative: sc.prompt ? sc.prompt.negative : '', baseVideo: sc.prompt ? sc.prompt.video : '', baseNegative: sc.prompt ? sc.prompt.negative : '' });
  const serverVideo = sc.prompt ? sc.prompt.video : '';
  const serverNeg = sc.prompt ? sc.prompt.negative : '';
  if (d.video === d.baseVideo && d.baseVideo !== serverVideo) { d.video = serverVideo; d.baseVideo = serverVideo; }
  if (d.negative === d.baseNegative && d.baseNegative !== serverNeg) { d.negative = serverNeg; d.baseNegative = serverNeg; }
  const img = sc.startImageInfo;
  const hasImg = img && !img.error;
  const isFrame = hasImg && img.url && img.url.includes('/startframe/');
  const imgState = !hasImg ? ['이미지 필요', 'err'] : img.placeholder ? ['데모 임시', 'mock'] : img.approved ? ['이미지 승인됨', 'done'] : ['이미지 미승인', 'attention'];
  const mot = sc.motion;
  const cuts = (sc.inserts || []).length;
  const bro = (sc.broll || []).length;
  const nextScene = ep.scenes[i + 1];

  // ---- primary actions ----
  const saveBtn = h('button', { class: 'btn', type: 'button', 'data-sb-save': sc.id, onclick: () => saveAll() }, '저장');
  const revokeImgBtn = isFrame && img.approved ? h('button', { class: 'btn ghost', type: 'button', 'data-sb-revoke-image': sc.id, onclick: async () => { if (await confirmDialog({ title: '이미지 승인을 취소할까요?', body: '이미지는 지워지지 않습니다. 취소하면 이 장면의 영상 생성은 다시 이미지 승인을 기다립니다.', confirm: '승인 취소', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame/approve`, { approved: false }), { ok: '이미지 승인을 취소했습니다' }); } }, '이미지 승인 취소') : null;
  const approveBtn = h('button', { class: 'btn sage', type: 'button', 'data-sb-approve-image': sc.id, disabled: !isFrame || img.approved, title: !isFrame ? '업로드하거나 만든 이미지가 있어야 승인할 수 있습니다' : '', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame/approve`, { approved: true }), { ok: '이미지를 승인했습니다' }) }, icon('check'), '이미지 승인');
  const nextBtn = h('button', { class: 'btn ghost', type: 'button', 'data-sb-next': sc.id, disabled: !nextScene, onclick: () => go(i + 1) }, '다음 장면 →');
  const addCutBtn = h('button', { class: 'btn sm clay', type: 'button', 'data-sb-add-cut': sc.id, onclick: () => addCutChooser(ep, sc) }, '+ 컷 추가');

  // structured image fields (environment, roles, pose, elements): a working copy of the SAME scene fields Script Studio edits
  const sdKey = 'sbs:' + ep.id + ':' + sc.id;
  const sd = (state.draft[sdKey] = state.draft[sdKey] || { characters: (sc.characters || []).slice(), referenceOnly: (sc.referenceOnly || []).slice(), action: sc.action || '', emotion: sc.emotion || '', look: Object.assign({}, sc.look || {}), pose: Object.assign({}, sc.pose || {}), elements: Array.isArray(sc.elements) ? sc.elements.map((e) => Object.assign({}, e)) : undefined, dirty: false });
  sd.id = sc.id;
  const castList = chars.filter((c) => (ep.characters || []).includes(c.id));
  const structNote = h('span', { class: 'small', 'data-sb-dirty': sc.id, style: 'color:var(--clay)' });
  const sdDirty = () => { sd.dirty = true; structNote.textContent = '저장하지 않은 변경이 있습니다'; };
  if (sd.dirty) structNote.textContent = '저장하지 않은 변경이 있습니다';

  async function saveAll() {
    const place = readPlace();
    const scene = { id: sc.id, showsProduct: !!d.showsProduct };
    if (d.showsProduct) scene.productPlacement = place;
    if (sd.dirty) Object.assign(scene, { characters: sd.characters, referenceOnly: sd.referenceOnly, look: sd.look, pose: sd.pose, elements: sd.elements });
    const ops = [];
    if (sd.dirty || scene.showsProduct !== !!sc.showsProduct || d.showsProduct) ops.push(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}`, { scene }));
    await act(async () => { for (const o of ops) await o(); if (sc.prompt && (d.video !== serverVideo || d.negative !== serverNeg)) await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/prompt`, { video: d.video, negative: d.negative }); delete state.draft[sdKey]; return null; });
  }

  // ---- main image ----
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await act(() => api.upload(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame`, f), { ok: '프레임을 올렸습니다 (승인 전)' }); } });
  const main = hasImg ? previewImage({ url: img.url, alt: sc.id + ' 이미지', cls: 'sb-main-img', tag: sc.id }) : img && img.missingFile ? h('div', { class: 'sb-main-img empty', 'data-sb-missing-file': sc.id }, h('span', null, '저장된 이미지 파일이 없습니다'), h('small', null, (img.approved ? '승인 기록은 남아 있지만 ' : '') + '서버에서 파일을 찾지 못했습니다. 다시 올리거나 비용 확인 후 새로 만드세요 (자동으로 만들지 않습니다).')) : h('div', { class: 'sb-main-img empty' }, h('span', null, '이미지가 아직 없습니다'), h('small', null, '프레임을 올리거나 비용 확인 후 만드세요'));

  // ---- product appearance ----
  d.showsProduct = d.showsProduct === undefined ? !!sc.showsProduct : d.showsProduct;
  d.place = d.place || Object.assign({ position: '', scale: '', orientation: '', visibility: '', interaction: '', refImageId: '' }, sc.productPlacement || {});
  const placeBox = h('div', { class: 'stack', style: 'gap:8px', 'data-placement': '' });
  const readPlace = () => Object.assign({}, d.place);
  const drawPlace = () => {
    placeBox.replaceChildren();
    if (!d.showsProduct) { placeBox.append(h('div', { class: 'small muted' }, '제품 등장이 꺼져 있으면 이 장면에 제품을 억지로 넣지 않습니다.')); return; }
    const images = ep.productStudioImages || sc.productImages || ep.productRefImages || [];
    placeBox.append(h('div', { class: 'grid two', style: 'gap:8px' }, Object.keys(PLACE).map((k) => h('label', { class: 'field' }, h('span', { class: 'small' }, PLACE_LABEL[k]), h('select', { 'data-place': k, onchange: (e) => { d.place[k] = e.target.value; } }, PLACE[k].map(([v, l]) => h('option', { value: v, selected: d.place[k] === v }, l)))))));
    placeBox.append(h('label', { class: 'field' }, h('span', { class: 'small' }, '캐릭터와의 상호작용 (짧게)'), h('input', { type: 'text', value: d.place.interaction || '', placeholder: '예: Diane이 제품을 들어 보인다', oninput: (e) => (d.place.interaction = e.target.value) })));
    placeBox.append(h('div', { class: 'small', style: 'font-weight:600' }, '제품 참조 이미지 선택'));
    placeBox.append(images.length ? h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, images.map((im) => h('button', { type: 'button', class: 'ref-pick' + (d.place.refImageId === im.id ? ' on' : ''), 'data-ref': im.id, title: im.label || '', onclick: () => { d.place.refImageId = d.place.refImageId === im.id ? '' : im.id; drawPlace(); } }, h('img', { src: im.url, alt: im.label || '제품 참조', loading: 'lazy' })))) : h('div', { class: 'small muted' }, '제품 스튜디오에 이미지를 올리고 승인하면 여기서 고를 수 있습니다.'));
  };
  drawPlace();
  const toggle = h('label', { class: 'chk-btn', 'data-product-toggle': sc.id }, h('input', { type: 'checkbox', checked: d.showsProduct, onchange: (e) => { d.showsProduct = e.target.checked; drawPlace(); } }), '제품 등장');

  // ---- prompts ----
  const promptEl = h('textarea', { rows: 9, 'aria-label': '영상 프롬프트', oninput: (e) => (d.video = e.target.value) }, d.video);
  const tr = translateControl(ep, () => promptEl.value);
  const negEl = h('textarea', { rows: 2, 'aria-label': '네거티브 프롬프트', oninput: (e) => (d.negative = e.target.value) }, d.negative);

  // ---- ① 이미지 제작 ----
  const editKey = ep.id + ':' + sc.id;
  const ui0 = uiState(); ui0.sbEdit = ui0.sbEdit || {};
  const approvedImg = !!(hasImg && img.approved);
  const collapsed = approvedImg && !ui0.sbEdit[editKey];
  const rerender = () => import('../state.js').then(({ hooks }) => hooks.rerender());
  const zoom = () => { if (!img || !img.url) return; modal((close) => h('div', { class: 'stack', style: 'align-items:center;gap:8px' }, h('img', { src: img.url, alt: sc.id, 'data-sb-full': sc.id, style: 'max-height:75vh;max-width:100%;border-radius:10px' }), h('div', { class: 'small muted' }, img.fileName || img.label || ''), h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')), { wide: true }); };
  const delBtn = isFrame ? h('button', { class: 'btn ghost danger', type: 'button', 'data-sb-delete-image': sc.id, disabled: img.approved, title: img.approved ? '승인된 이미지는 먼저 승인을 취소하세요' : '이 이미지 파일만 지웁니다. 캐릭터·제품 참조 이미지는 지워지지 않습니다', onclick: async () => { if (await confirmDialog({ title: '이 시작 이미지를 삭제할까요?', body: '이 장면에 연결된 이미지만 목록에서 빼고 파일은 복구 가능한 보관 폴더로 옮깁니다. 캐릭터 라이브러리와 제품 사진은 그대로입니다.', confirm: '삭제', tone: 'clay' })) act(() => api.del(`/api/episodes/${ep.id}/scenes/${sc.id}/start-frame`), { ok: '시작 이미지를 삭제했습니다 (참조 이미지는 그대로)' }); } }, icon('trash'), '삭제') : null;
  const genBtn = h('button', { class: 'btn clay', type: 'button', 'data-sb-regenerate': sc.id, disabled: !ep.derived.scriptApproved || img && img.approved && isFrame, title: img && img.approved && isFrame ? '승인된 이미지는 먼저 승인을 취소하세요' : '비용 확인 후에만 생성됩니다', onclick: async () => {
    // The prompt editor may contain unsaved changes. Persist those first so the
    // server generates from the text the operator can currently see.
    const editor = document.querySelector('[data-image-prompt="' + sc.id + '"]');
    const saved = sc.imagePrompt && sc.imagePrompt.text || '';
    if (editor && editor.value !== saved) {
      try {
        await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/image-prompt`, { text: editor.value });
      } catch (e) { toast('프롬프트 저장에 실패하여 이미지를 생성하지 않았습니다: ' + e.message, { error: true }); return; }
    }
    await makeStartImages(ep, [sc.id], { force: true, after: refresh });
  } }, icon('play'), isFrame ? '다시 만들기' : '이미지 만들기');
  const uploadBtn = h('button', { class: 'btn ghost', type: 'button', 'data-sb-upload': sc.id, onclick: () => fileIn.click() }, icon('upload'), '올리기');
  const imageHead = h('div', { class: 'sb-image-head', 'data-sb-image': sc.id },
    h('div', { class: 'sb-image-preview' }, main),
    h('div', { class: 'stack', style: 'gap:8px;flex:1;min-width:200px' },
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, chip(imgState[0], imgState[1]), hasImg && img.fileName ? h('span', { class: 'small muted' }, img.fileName) : null),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, genBtn, uploadBtn, fileIn, hasImg ? h('button', { class: 'btn ghost', type: 'button', 'data-sb-zoom': sc.id, onclick: zoom }, '크게 보기') : null, delBtn),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, approveBtn, revokeImgBtn),
      h('div', { class: 'small muted' }, '생성은 비용 확인을 거친 뒤에만 시작되고 자동으로 다시 시도하지 않습니다. 삭제는 이 장면의 이미지 파일만 지우며 캐릭터·제품 참조는 건드리지 않습니다.'),
      sc.visual ? h('div', { class: 'small', 'data-scene-description': sc.id }, h('b', null, '장면 설명 (대본 스튜디오): '), sc.visual) : null));
  const rolesBox = h('div');
  const drawRoles = () => rolesBox.replaceChildren(characterRoles(ep, sd, castList, sdDirty, () => drawRoles()));
  drawRoles();
  seedElements(sd);
  const redrawCamera = () => rerender();
  for (const pk of ['look', 'charrefs']) { const u = uiState(); const k = `sb:${ep.id}:${sc.id}:${pk}`; if (u.open[k] === undefined) u.open[k] = true; } // the structured image fields are open by default
  const imageEditors = [
    panel(ep, sc, 'look', '환경 · 캐릭터 · 포즈 · 동작 · 감정', '', h('div', { class: 'stack', style: 'gap:10px' },
      h('div', { class: 'eyebrow' }, '환경'), lookFields(sd, sdDirty),
      h('div', { class: 'eyebrow' }, '캐릭터 (등장 / 참조만)'), rolesBox,
      h('div', { class: 'eyebrow' }, '포즈'), poseFields(sd, sdDirty),
      h('div', { class: 'eyebrow' }, '몸 동작 · 감정'), elementsBlock(sd, castList, sdDirty, ['body', 'emotion'], '동작 · 감정 추가'),
      h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('button', { class: 'btn sm', type: 'button', 'data-sb-save-struct': sc.id, onclick: () => saveAll() }, '이미지 설정 저장'), structNote))),
    panel(ep, sc, 'face', '얼굴 표정 (선택)', '눈 · 눈썹 · 입', elementsBlock(sd, castList, sdDirty, ['eyes', 'eyebrows', 'mouth', 'face'], '얼굴 세부 추가')),
    panel(ep, sc, 'camera', '카메라 · 샷 (선택)', '추천 샷', h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'small muted' }, '추천 샷을 누르면 카메라 지시로 들어갑니다 (한 번 더 누르면 해제).'), shotChips(sd, sdDirty, redrawCamera), elementsBlock(sd, castList, sdDirty, ['camera'], '카메라 지시 추가'))),
    panel(ep, sc, 'charrefs', '참조 이미지 (캐릭터 · 제품)', charRefsBadge(sc) + ' · 제품 ' + (d.showsProduct ? 'ON' : 'OFF'), h('div', { class: 'stack', style: 'gap:10px' }, charRefsPanelBody(ep, sc), h('div', { class: 'eyebrow' }, '제품'), toggle, placeBox)),
    panel(ep, sc, 'imageprompt', '이미지 프롬프트 (자동 합성 · 직접 수정 가능)', sc.imagePrompt && sc.imagePrompt.edited ? '수정됨' : '자동', imagePromptBody(ep, sc)),
  ];
  const summaryRow = h('div', { class: 'row', style: 'gap:10px;align-items:center;flex-wrap:wrap;border-left:4px solid var(--sage);padding-left:10px', 'data-sb-approved-summary': sc.id },
    img && img.url ? previewImage({ url: img.url, alt: '', compact: true, tag: sc.id, cls: 'sb-thumb', style: 'width:44px;aspect-ratio:9/16;object-fit:cover;border-radius:6px;flex:none' }) : img && img.missingFile ? h('span', { class: 'small', 'data-sb-missing-file': sc.id, title: '서버에서 이미지 파일을 찾지 못했습니다', style: 'width:44px;text-align:center;color:var(--clay)' }, '⚠ 파일없음') : null,
    h('div', { class: 'small', style: 'flex:1;min-width:160px' }, h('b', { style: 'color:var(--sage-deep)' }, '✓ 이미지 승인됨' + (img && img.placeholder ? ' (데모 임시 이미지)' : '')), h('div', { class: 'muted' }, `${(img && (img.fileName || img.label)) || ''} · 이미지 프롬프트 ${sc.imagePrompt && sc.imagePrompt.edited ? '수정됨' : '자동'} · 컷 ${cuts} · B-roll ${bro}`)),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: zoom }, '크게 보기'),
    revokeImgBtn ? revokeImgBtn.cloneNode(true) : null,
    h('button', { class: 'btn sm ghost', type: 'button', 'data-sb-reopen': sc.id, onclick: () => { ui0.sbEdit[editKey] = true; rerender(); } }, '이미지 편집 열기'));
  if (summaryRow.querySelector('[data-sb-revoke-image]')) summaryRow.querySelector('[data-sb-revoke-image]').addEventListener('click', () => revokeImgBtn.click());
  const imageSection = block('image', '①', '이미지 제작', '환경 · 캐릭터 · 참조 · 프롬프트 → 시작 이미지 만들기 · 올리기 · 승인',
    collapsed ? summaryRow : h('div', { class: 'stack', style: 'gap:10px' }, imageHead, frameProvenance(sc), ...imageEditors, approvedImg ? h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', type: 'button', 'data-sb-collapse': sc.id, onclick: () => { ui0.sbEdit[editKey] = false; rerender(); } }, '편집 접기')) : null));

  // ---- ② 애니메이션 · 오디오 준비 (video generation itself is Animation Studio) ----
  const prepSection = block('prep', '②', '애니메이션 · 오디오 준비', '애니메이션 프롬프트 · 0.5초 비트 · 대사 · 목소리 · 오디오 — 영상 생성은 애니메이션 스튜디오에서',
    panel(ep, sc, 'prompt', '애니메이션 프롬프트', sc.prompt ? `r${sc.prompt.rev || 1}${sc.prompt.edited ? ' · 수정됨' : ''}` : '아직 없음', h('div', { class: 'stack', style: 'gap:8px' },
      sc.prompt ? h('div', { class: 'row', style: 'gap:6px' }, chip(sc.prompt.source === 'gemini' ? 'Gemini 생성' : '템플릿', sc.prompt.source === 'gemini' ? 'done' : 'mock'), sc.prompt.edited ? chip('직접 수정함', 'attention') : null, (sc.prompt.history || []).length ? chip(`이전 버전 ${(sc.prompt.history || []).length}개`, '') : null) : null,
      sc.prompt ? [promptEl, tr.panel] : h('div', { class: 'empty' }, '아직 프롬프트가 없습니다. "템플릿으로 만들기"(무료)를 누르세요.'),
      sc.prompt && sc.prompt.sections ? sectionsView(sc.prompt.sections) : null,
      sc.castWarnings && sc.castWarnings.length ? h('div', { class: 'issue err' }, sc.castWarnings.map((w) => w.message).join(' ')) : null,
      sc.promptWarnings.length ? h('div', { class: 'issue err' }, '확인되지 않은 제품 주장: ' + sc.promptWarnings.join(', ')) : null,
      sc.prompt ? h('div', { class: 'field' }, h('label', null, 'Negative prompt'), negEl) : null,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, tr.btn,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => copyText(promptEl.value, sc.id + ' 프롬프트를 복사했습니다') }, icon('copy'), 'Copy Prompt'),
        h('button', { class: 'btn sm ghost', type: 'button', disabled: !ep.derived.scriptApproved, onclick: () => aiPrompts(ep, sc) }, icon('play'), 'AI로 다시 만들기'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { if (!sc.prompt || !sc.prompt.edited || await confirmDialog({ title: '수정한 프롬프트를 덮어쓸까요?', body: '이 장면의 프롬프트를 템플릿으로 다시 만듭니다. 이전 버전은 기록에 남습니다.', tone: 'clay' })) { delete state.draft[key]; act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: [sc.id], force: true }), { ok: '프롬프트를 다시 만들었습니다' }); } } }, '템플릿으로 만들기 (무료)')),
      animationHandoff(ep, sc))),
    panel(ep, sc, 'motion', '0.5초 비주얼 비트 (대본 스튜디오와 같은 타임라인)', mot ? `${mot.beats.length}비트 · r${mot.rev}` : '아직 없음', motionPanel(ep, sc)),
    panel(ep, sc, 'dialogue', '대사 · 목소리', `${(ep.lines || []).filter((l) => l.sceneId === sc.id).length}줄`, dialoguePanelBody(ep, sc)),
    panel(ep, sc, 'audio', '오디오 생성 · 미리듣기 · 승인', audioBadge(ep, sc), audioPanelBody(ep, sc)));

  // ---- ③ B-roll 제작 ----
  const brollSection = block('broll', '③', 'B-roll 제작', 'B-roll 개념 → 프롬프트 · 이미지 생성 · 미리보기 · 승인 (컷은 영상 크롭 편집)',
    panel(ep, sc, 'cuts', '컷 · B-roll', `컷 ${cuts} · B-roll ${bro}`, cutsPanel(ep, sc)));

  // ---- 마무리 + 고급 ----
  const tail = [
    panel(ep, sc, 'compose', '효과음 · 씬 합본 · 최종 승인', composeBadge(ep, sc), composePanelBody(ep, sc)),
    panel(ep, sc, 'advanced', '고급 설정', '', h('div', { class: 'stack', style: 'gap:8px' },
      h('div', { class: 'small' }, `장면 길이 ${sc.durationSec}초 (대본 스튜디오에서 수정 · 승인에 영향)`),
      h('div', { class: 'small', 'data-dialogue-estimate': sc.id }, (() => { const t = ((ep.derived.timing || {}).scenes || []).find((x) => x.sceneId === sc.id); const a = t && t.actual; return a && a.complete ? `실측 대사 ${a.needSec.toFixed(1)}초` : '대사 길이: 오디오를 만들면 실측으로 표시됩니다'; })()),
      h('div', { class: 'small muted' }, '0.5초 비트 타임라인은 ② 애니메이션 · 오디오 준비의 같은 편집기입니다. 장면 순서 변경과 시각 설명 수정은 대본 스튜디오에서 합니다.'))),
  ];
  const shownPanels = [imageSection, prepSection, brollSection, ...tail];

  const el = h('section', { class: 'card sb-scene', id: 'sb-scene-' + sc.id, 'data-sb-scene': sc.id },
    h('div', { class: 'row between' }, h('div', null, h('div', { class: 'eyebrow' }, `${sc.id} · ${sc.durationSec}초${sc.beatKey ? ' · ' + sc.beatKey : ''}`), h('h2', { style: 'margin:2px 0 0' }, sc.title_ko || sc.title)), addCutBtn),
    stepper(ep, sc),
    h('div', { class: 'scene-actions-bar inline sb-actions' }, h('div', { class: 'bar-buttons' }, saveBtn, nextBtn)),
    ...shownPanels);
  // mobile: the same actions as a sticky bar (the inline copy is hidden by CSS on phones)
  const bar = h('div', { class: 'scene-actions-bar sb-bar' }, h('div', { class: 'bar-buttons' }, saveBtn.cloneNode(true), approveBtn.cloneNode(true), nextBtn.cloneNode(true)));
  bar.querySelector('[data-sb-save]').addEventListener('click', () => saveAll());
  bar.querySelector('[data-sb-approve-image]').addEventListener('click', () => approveBtn.click());
  bar.querySelector('[data-sb-next]').addEventListener('click', () => nextBtn.click());
  return { el, bar };
}

function panel(ep, sc, key, title, badge, ...content) {
  const u = uiState();
  const k = `sb:${ep.id}:${sc.id}:${key}`;
  const det = h('details', { class: 'scene-section', 'data-panel': key, open: !!u.open[k] }, h('summary', null, h('span', { class: 'section-title' }, title), badge ? h('span', { class: 'small muted' }, badge) : null), h('div', { class: 'section-body stack', style: 'gap:10px' }, ...content));
  det.addEventListener('toggle', () => { u.open[k] = det.open; });
  return det;
}

function refPicker(ep, sc, chars) {
  const refs = [];
  sc.characters.forEach((cid) => { const c = chars.find((x) => x.id === cid); if (c) c.references.forEach((r) => refs.push({ c, r })); });
  if (!refs.length) return null;
  return h('select', { 'aria-label': '캐릭터 참조 이미지 선택', onchange: (e) => { if (!e.target.value) return; const [cid, rid] = e.target.value.split('|'); act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/start-image`, { type: 'reference', characterId: cid, refId: rid }), { ok: '참조 이미지를 시작 프레임으로 지정했습니다 (승인 전)' }); } },
    h('option', { value: '' }, '캐릭터 참조 이미지로 지정…'), refs.map(({ c, r }) => h('option', { value: c.id + '|' + r.id }, c.name + ' · ' + (r.label || r.id) + (r.approved ? ' (승인됨)' : ''))));
}

// ---------------- cuts + B-roll ----------------
function cutsPanel(ep, sc) {
  const ins = sc.inserts || [];
  const bro = sc.broll || [];
  return h('div', { class: 'stack', style: 'gap:10px' },
    h('div', { class: 'small muted' }, '컷은 이 장면의 영상을 크롭하는 편집이며 요금이 없습니다. B-roll은 별도의 정지 이미지로 먼저 만든 뒤 영상 편집에서 위에 얹습니다 (자동으로 유료 영상이 생성되지 않습니다).'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn sm clay', type: 'button', onclick: () => addCutChooser(ep, sc) }, '+ 컷 추가'), h('button', { class: 'btn sm ghost', type: 'button', 'data-broll-suggest': '', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/suggest`), { ok: '제안을 만들었습니다 (무료, 승인 전)' }) }, 'B-roll 제안 (무료)')),
    ins.length ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ins.map((x) => h('button', { type: 'button', class: 'chip', onclick: () => openCutEditor(ep, sc.id) }, `${x.preset || '컷'} ${x.startSec != null ? x.startSec + 's' : ''}`))) : h('div', { class: 'small muted' }, '영상 크롭 컷이 없습니다.'),
    h('div', { class: 'stack', style: 'gap:8px', 'data-broll-list': sc.id }, bro.length ? bro.map((b) => brollRow(ep, b)) : [h('div', { class: 'small muted' }, 'B-roll이 없습니다.')]));
}
const IMG_STATE = { ready: ['이미지 준비됨', 'done'], none: ['이미지 필요', 'attention'], missing: ['이미지 파일 없음', 'err'], inaccessible: ['이미지 접근 불가', 'err'], failed: ['생성 실패', 'err'], loading: ['이미지 불러오는 중', 'attention'] };
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function brollRow(ep, b) {
  const [stLabel0, stKind0] = BROLL_STATE[b.status] || [b.status, ''];
  const attn = b.status === 'approved' && b.imageState !== 'ready';
  const [stLabel, stKind] = attn ? ['승인됨 · 확인 필요', 'attention'] : [stLabel0, stKind0];
  const [imLabel, imKind] = IMG_STATE[b.imageState] || IMG_STATE.none;
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await act(() => api.upload(`/api/episodes/${ep.id}/broll/${b.id}/image`, f), { ok: '이미지를 올렸습니다 (검토 대기)' }); } });
  const imgChip = chip(imLabel, imKind); imgChip.setAttribute('data-broll-image-state', b.imageState || 'none');
  const stateBox = h('div', { class: 'small muted', 'data-broll-load': b.id });
  // the thumbnail is only requested when the server says the file is really there; if the browser still cannot load it, say so
  const img = b.imageUrl ? h('img', { src: b.imageUrl, alt: b.id + ' B-roll 이미지 미리보기', class: 'broll-thumb', 'data-broll-thumb': b.id, style: 'display:block;max-width:100%;max-height:220px;object-fit:contain;border-radius:10px' }) : null;
  if (img) {
    stateBox.textContent = '이미지 불러오는 중…';
    img.addEventListener('load', () => { stateBox.textContent = b.imageInfo && b.imageInfo.width ? `${b.imageInfo.width}×${b.imageInfo.height}px · ${kb(b.imageInfo.bytes)}${b.imageGenerated ? ' · AI 생성' : ' · 업로드'}` : ''; imgChip.setAttribute('data-broll-image-state', 'ready'); });
    img.addEventListener('error', () => { img.style.display = 'none'; stateBox.textContent = '브라우저가 이미지를 불러오지 못했습니다 (접근 불가). 새로고침하거나 이미지를 다시 저장하세요.'; stateBox.className = 'issue err'; imgChip.setAttribute('data-broll-image-state', 'inaccessible'); imgChip.textContent = IMG_STATE.inaccessible[0]; });
  } else stateBox.textContent = b.imageProblem || (b.imageState === 'failed' ? '' : '미리보기 이미지 없음 · AI 이미지 생성 또는 이미지 올리기');
  const refs = (b.refs || []);
  // green only when it is approved AND the image is really usable; an approved B-roll with a missing image is an attention state, never "ready"
  const cardState = b.status === 'approved' ? (b.imageState === 'ready' ? 'approved' : 'attention') : b.status === 'rejected' ? 'rejected' : 'pending';
  return h('div', { class: 'beat-row card flat broll-card', 'data-broll': b.id, 'data-broll-state': cardState },
    h('div', { class: 'row between' }, h('b', null, `${b.id} · ${b.kindLabel || b.kind}`), h('div', { class: 'row', style: 'gap:6px' }, chip(stLabel, stKind), imgChip)),
    h('div', { class: 'small muted' }, `${b.insertAtSec}s 에 ${b.durationSec}초 · ${b.effect || '효과 미지정'}${b.note ? ' · ' + b.note : ''} · r${b.rev}`),
    b.needsAttention ? h('div', { class: 'issue err', 'data-broll-attention': b.id }, h('b', null, b.status === 'approved' ? '승인된 B-roll의 이미지를 사용할 수 없습니다 — 확인이 필요합니다. ' : '이미지를 사용할 수 없습니다. '), (b.imageProblem || ''), b.status === 'approved' ? h('div', { class: 'small' }, '승인 기록은 유지되며, 이미지를 다시 저장하기 전까지 이 B-roll이 필요한 렌더링은 막힙니다.') : null) : null,
    b.promptText ? h('details', { class: 'small' }, h('summary', { style: 'cursor:pointer' }, '이미지 프롬프트' + (b.promptEdited ? ' (수정됨)' : '')), h('div', { class: 'muted', style: 'white-space:pre-wrap;margin-top:4px', 'data-broll-prompt': b.id }, b.promptText)) : null,
    refs.length ? h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap', 'data-broll-refs': b.id }, refs.map((r) => h('div', { class: 'small', style: 'width:64px;text-align:center' }, r.url && r.status === 'approved' ? h('img', { src: r.url, alt: r.name + ' 참조', loading: 'lazy', style: 'width:64px;height:64px;object-fit:cover;border-radius:8px' }) : h('div', { class: 'sb-main-img empty', style: 'width:64px;height:64px' }, h('small', null, '없음')), h('div', null, r.name)))) : null,
    img ? h('button', { type: 'button', class: 'broll-preview-trigger', 'data-broll-preview': b.id, 'aria-label': b.id + ' B-roll 이미지 크게 보기', onclick: () => previewBroll(b), style: 'display:block;padding:0;border:0;background:transparent;cursor:zoom-in;max-width:100%' }, img) : null,
    stateBox,
    b.imageError ? h('div', { class: 'issue err', 'data-broll-error': b.id }, b.imageError.message) : null,
    b.assetId && b.imageState === 'ready' ? h('div', { class: 'small mono muted', 'data-broll-asset': b.id }, `${b.status === 'approved' ? '승인된 에셋' : '에셋'}: ${b.assetId}${b.imageGenerated ? ' · AI 생성' : ' · 업로드'}`) : null,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => brollEditor(ep, ep.scenes.find((s) => s.id === b.sceneId), b) }, '수정'),
      h('button', { class: 'btn sm clay', type: 'button', 'data-broll-generate': b.id, onclick: () => openBrollAi(ep, b) }, b.imageState === 'ready' ? '재생성' : 'AI 이미지 생성'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => fileIn.click() }, icon('upload'), b.imageState === 'ready' ? '이미지 교체' : '이미지 올리기'), fileIn,
      img ? h('button', { class: 'btn sm ghost', type: 'button', 'data-broll-fullscreen': b.id, onclick: () => previewBroll(b) }, '전체 화면') : null,
      b.status === 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-broll-revoke': b.id, onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/status`, { status: 'proposed' })) }, '승인 취소') : h('button', { class: 'btn sm sage', type: 'button', 'data-broll-approve': b.id, disabled: b.imageState !== 'ready', title: b.imageState !== 'ready' ? '이미지가 저장되고 접근 가능해야 승인할 수 있습니다' : '', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/status`, { status: 'approved' }), { ok: '승인했습니다' }) }, '승인'),
      b.status !== 'rejected' && b.status !== 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-broll-reject': b.id, disabled: b.imageState !== 'ready', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/status`, { status: 'rejected' }), { ok: '거절했습니다' }) }, '거절') : null,
      h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: `${b.id}를 삭제할까요?`, body: '라이브러리에서만 사라지고 기록은 보관됩니다.', tone: 'clay' })) act(() => api.del(`/api/episodes/${ep.id}/broll/${b.id}`), { ok: '삭제했습니다' }); } }, '삭제')));
}

function addCutChooser(ep, sc) {
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '컷 추가'),
    h('p', { class: 'small muted', style: 'margin:0' }, `${sc.id} · ${sc.title_ko || sc.title} — 어떤 컷을 넣을까요?`),
    h('button', { class: 'btn', type: 'button', 'data-cut-kind': 'crop', onclick: () => { close(); openCutEditor(ep, sc.id); } }, '영상 크롭 컷 (클로즈업·리액션, 요금 없음)'),
    h('button', { class: 'btn ghost', type: 'button', 'data-cut-kind': 'broll', onclick: () => { close(); brollEditor(ep, sc, null); } }, 'B-roll (별도 정지 이미지, 영상 편집에서 얹음)'),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'))));
}
function brollEditor(ep, sc, b) {
  const f = { id: b && b.id, sceneId: sc.id, kind: b ? b.kind : 'broll', insertAtSec: b ? b.insertAtSec : 0, durationSec: b ? b.durationSec : 1, effect: b ? b.effect : '', note: b ? b.note : '' };
  modal((close) => h('div', { class: 'stack' }, h('h2', null, b ? 'B-roll 수정' : 'B-roll 추가'),
    b && b.status === 'approved' ? h('div', { class: 'banner warn' }, '승인된 B-roll을 수정하면 다시 검토해야 합니다.') : null,
    h('div', { class: 'small muted' }, `장면 ${sc.id} 길이 ${sc.durationSec}초 — 위치+길이가 장면 길이를 넘을 수 없고, 장면은 자동으로 늘어나지 않습니다.`),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '종류'), h('select', { onchange: (e) => (f.kind = e.target.value) }, BROLL_KIND.map(([v, l]) => h('option', { value: v, selected: f.kind === v }, l)))),
    h('div', { class: 'row' }, h('label', { class: 'small' }, '위치(초)', h('input', { type: 'number', step: 0.5, min: 0, value: f.insertAtSec, style: 'width:84px', 'data-broll-at': '', oninput: (e) => (f.insertAtSec = Number(e.target.value)) })), h('label', { class: 'small' }, '길이(초)', h('input', { type: 'number', step: 0.5, min: 0.5, value: f.durationSec, style: 'width:84px', 'data-broll-dur': '', oninput: (e) => (f.durationSec = Number(e.target.value)) }))),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '의도한 시각 효과'), h('input', { type: 'text', value: f.effect, oninput: (e) => (f.effect = e.target.value) })),
    h('label', { class: 'field' }, h('span', { class: 'small' }, '메모'), h('input', { type: 'text', value: f.note, oninput: (e) => (f.note = e.target.value) })),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), h('button', { class: 'btn', type: 'button', 'data-broll-save': '', onclick: async () => { try { await api.post(`/api/episodes/${ep.id}/broll`, f); close(); toast('저장했습니다'); await refresh(); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '저장'))));
}

// ---------------- whole-storyboard tools (collapsed) ----------------
function projectPanel(ep, sbOk) {
  const ready = ep.scenes.filter((s) => s.prompt && s.prompt.video).length;
  const approvedImgs = ep.scenes.filter((s) => s.startImageInfo && !s.startImageInfo.error && s.startImageInfo.approved).length;
  return h('details', { class: 'card', 'data-sb-project': '' }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '스토리보드 전체'), h('span', { class: 'small muted' }, `프롬프트 ${ready}/${ep.scenes.length} · 승인된 이미지 ${approvedImgs}/${ep.scenes.length}${sbOk ? ' · 승인됨' : ''}`)),
    h('div', { class: 'stack', style: 'gap:12px;margin-top:12px' },
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { force: false }), { ok: '비어 있는 장면의 프롬프트를 만들었습니다 (수정한 프롬프트는 그대로 둠)' }) }, '템플릿으로 만들기 (무료)'),
        h('button', { class: 'btn', type: 'button', disabled: !ep.derived.scriptApproved, onclick: () => aiPrompts(ep, null) }, icon('play'), 'AI로 프롬프트 만들기'),
        h('button', { class: 'btn clay', type: 'button', disabled: !ep.derived.scriptApproved, title: '비용 확인 후에만 생성됩니다', onclick: () => makeStartImages(ep, [], { after: refresh }) }, icon('plus'), '모든 장면 시작 이미지 만들기'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { const r = await api.get('/api/prompts/videoMaster'); await copyText(r.text, '영상 마스터 프롬프트를 복사했습니다'); } catch (e) { toast(e.message, { error: true }); } } }, icon('copy'), '영상 마스터 프롬프트 복사')),
      (() => { const strip = productRefStrip(ep); return strip || null; })(),
      imageDevCard(ep),
      h('div', { class: 'row between', style: 'gap:8px;flex-wrap:wrap' }, h('div', { class: 'small muted' }, '승인한 프롬프트와 시작 이미지로만 클립을 생성할 수 있습니다. 이후 수정하면 승인이 무효가 됩니다.'),
        h('div', { class: 'row' }, sbOk ? chip('승인됨', 'done') : null, ep.derived.storyboardApproval && ep.derived.storyboardApproval.everApproved ? h('button', { class: 'btn ghost', type: 'button', 'data-sb-revoke': '', onclick: async () => { if (await confirmDialog({ title: '스토리보드 승인을 취소할까요?', body: '프롬프트·이미지·클립은 지워지지 않습니다. 취소하면 새 영상 생성은 다시 스토리보드 승인을 기다립니다 (이미 만든 클립과 그 승인은 그대로).', confirm: '승인 취소', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/storyboard/revoke`), { ok: '스토리보드 승인을 취소했습니다' }); } }, '승인 취소') : null, h('button', { class: 'btn sage', type: 'button', disabled: sbOk || !ep.derived.scriptApproved || ready < ep.scenes.length, onclick: async () => {
          if (await confirmDialog({ title: '스토리보드와 프롬프트를 승인할까요?', body: '승인한 프롬프트와 시작 이미지로만 클립을 생성할 수 있습니다. 이후 수정하면 승인이 무효가 됩니다.' })) act(() => api.post(`/api/episodes/${ep.id}/storyboard/approve`), { ok: '스토리보드를 승인했습니다' });
        } }, '스토리보드 승인')))));
}

async function reorder(ep, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= ep.scenes.length) return toast('더 이상 이동할 수 없습니다');
  const order = ep.scenes.map((s) => ({ id: s.id }));
  [order[i], order[j]] = [order[j], order[i]];
  await act(() => api.put(`/api/episodes/${ep.id}/script`, { scenes: order, note: '장면 순서 변경' }), { ok: '순서를 바꿨습니다 (대본 승인이 필요할 수 있습니다)' });
}


const SECTION_LABEL = { camera: '카메라', actions: '캐릭터 동작', environment: '환경', lighting: '조명·스타일', continuity: '연속성', duration: '길이', aspect: '화면비', cast: '등장 인원', identity: '캐릭터 외형' };
function sectionsView(sections) {
  return h('details', { class: 'small', style: 'margin-top:6px' }, h('summary', { style: 'cursor:pointer;color:var(--muted)' }, '프롬프트 구성 요소 보기'),
    h('div', { class: 'stack', style: 'gap:4px;margin-top:6px' }, Object.keys(SECTION_LABEL).filter((k) => sections[k]).map((k) => h('div', null, h('b', null, SECTION_LABEL[k] + ': '), sections[k]))));
}

let autoTried = '';
function autoBuild(ep) {
  // Free + deterministic. Runs once per episode view when an approved script has scenes without any prompt.
  const missing = ep.scenes.filter((s) => !s.prompt).map((s) => s.id);
  const key = ep.id + ':' + missing.join();
  if (!ep.derived.scriptApproved || !missing.length || autoTried === key) return;
  autoTried = key;
  act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: missing, force: false }));
}

async function aiPrompts(ep, sc) {
  const g = state.summary.providers.gemini;
  const scenes = sc ? [sc] : ep.scenes;
  if (!g.configured) {
    toast('Gemini API 키가 서버에 설정되어 있지 않습니다.', { error: true, recovery: 'renderer/.env 에 GEMINI_API_KEY 를 넣고 Studio를 다시 시작하세요. 키 없이는 "템플릿으로 만들기"(무료)를 쓸 수 있습니다.' });
    return;
  }
  const missingRef = scenes.filter((s) => s.characters.some((cid) => !(state.summary.characters.find((c) => c.id === cid) || { references: [] }).references.some((r) => r.approved)));
  const edited = scenes.filter((s) => s.prompt && s.prompt.edited);
  let overwrite = false;
  const ok = await confirmDialog({
    title: sc ? sc.id + ' 프롬프트를 AI로 만들까요?' : '모든 장면의 프롬프트를 AI로 만들까요?',
    body: h('div', { class: 'stack small' },
      h('div', null, `Gemini(${g.model})에 승인된 대본·장면 설명과 선택된 캐릭터의 승인된 참조 이미지(이미지 내용 자체)를 보냅니다. Gemini 호출은 요금이 청구될 수 있으며 Studio는 가격을 알지 못합니다.`),
      missingRef.length ? h('div', { class: 'issue err' }, '승인된 참조 이미지가 없는 장면: ' + missingRef.map((s) => s.id).join(', ') + ' — 먼저 설정에서 참조를 승인하세요.') : null,
      edited.length ? h('label', { style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', onchange: (e) => (overwrite = e.target.checked) }), `직접 수정한 프롬프트(${edited.map((s) => s.id).join(', ')})도 덮어쓰기`) : null,
      h('div', { class: 'muted' }, '결과가 캐릭터 수·제품 주장·시트 재현 금지 규칙을 어기면 저장하지 않고 기존 프롬프트를 그대로 둡니다.')),
    confirm: 'AI로 만들기', tone: 'clay',
  });
  if (!ok) return;
  if (sc) delete state.draft['sb:' + sc.id]; else ep.scenes.forEach((s) => delete state.draft['sb:' + s.id]);
  const r = await act(() => api.post(`/api/episodes/${ep.id}/storyboard/prompts`, { sceneIds: sc ? [sc.id] : undefined, mode: 'gemini', confirmAi: true, force: overwrite }), { ok: 'AI 프롬프트를 만들었습니다' });
  return r;
}

