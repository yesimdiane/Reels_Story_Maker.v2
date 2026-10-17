// Approved-scene gallery at the top of the Storyboard: every scene's starting image in story order, small 9:16 thumbnails, approval state,
// "+N" B-cut count. Click = open that scene; 🔍 = full-size preview; 비교 = side-by-side comparison of chosen scenes.
// Reuses stored assets only — nothing here generates an image or calls a provider.
import { h, chip, modal } from '../ui.js';
import { state, hooks } from '../state.js';
import { previewImage } from './common.js';

const uiState = () => { state.ui = state.ui || { open: {} }; return state.ui; };
const sbOf = (ep, sid) => (ep.derived.storyboardApproval && ep.derived.storyboardApproval.scenes && ep.derived.storyboardApproval.scenes[sid]) || null;

/** compact facts about one scene's starting image */
export function galleryItem(ep, sc, index) {
  const img = sc.startImageInfo || {};
  const hasImage = !!(img && !img.error && img.url);
  const bcuts = (sc.broll || []).filter((b) => b.status !== 'removed').length;
  const sb = sbOf(ep, sc.id);
  const state0 = !hasImage ? 'missing' : img.placeholder ? 'placeholder' : img.approved ? 'approved' : 'unapproved';
  return { id: sc.id, index, title: sc.title_ko || sc.title || '', url: hasImage ? img.url : '', name: img.fileName || img.label || '', state: state0, bcuts, storyboardOk: sb ? sb.approved : null, sceneFinal: ((ep.sceneFlow && ep.sceneFlow.scenes[sc.id]) || {}).final };
}
const STATE_LABEL = { approved: '이미지 승인됨', unapproved: '승인 대기', missing: '이미지 없음', placeholder: '데모 임시 이미지' };

export function openPreview(ep, items, startId, onOpenScene) {
  let cur = Math.max(0, items.findIndex((x) => x.id === startId));
  modal((close) => {
    const body = h('div', { class: 'stack', style: 'gap:10px;align-items:center' });
    const draw = () => {
      const it = items[cur];
      body.replaceChildren(
        h('div', { class: 'row between', style: 'width:100%' }, h('b', null, `${it.id} · ${it.title}`), chip(STATE_LABEL[it.state], it.state === 'approved' ? 'done' : it.state === 'missing' ? 'err' : 'attention')),
        it.url ? previewImage({ url: it.url, alt: it.id, tag: 'full-' + it.id, attrs: { 'data-gallery-full': it.id }, style: 'max-height:70vh;min-height:200px;max-width:100%;border-radius:10px;object-fit:contain' }) : h('div', { class: 'empty' }, '이 장면에는 아직 시작 이미지가 없습니다.'),
        h('div', { class: 'small muted' }, it.name ? `파일: ${it.name}` : ''),
        h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm ghost', type: 'button', disabled: cur === 0, onclick: () => { cur--; draw(); } }, '이전'),
          h('button', { class: 'btn sm ghost', type: 'button', disabled: cur === items.length - 1, onclick: () => { cur++; draw(); } }, '다음'),
          h('button', { class: 'btn sm sage', type: 'button', 'data-gallery-open-scene': it.id, onclick: () => { close(); onOpenScene(it.id); } }, '이 씬 편집'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: close }, '닫기')));
    };
    draw();
    return body;
  }, { wide: true });
}

export function openCompare(ep, items, onOpenScene) {
  const u = uiState();
  u.galleryCompare = u.galleryCompare || {};
  let picked = new Set(u.galleryCompare[ep.id] || items.filter((x) => x.state === 'approved').slice(0, 3).map((x) => x.id));
  if (!picked.size) picked = new Set(items.slice(0, 3).map((x) => x.id));
  modal((close) => {
    const grid = h('div', { 'data-compare-grid': '', style: 'display:flex;gap:10px;overflow-x:auto;padding-bottom:6px' });
    const chips = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
    const draw = () => {
      u.galleryCompare[ep.id] = [...picked];
      chips.replaceChildren(...items.map((it) => h('label', { class: 'chip' + (picked.has(it.id) ? ' done' : ''), style: 'cursor:pointer;gap:4px' },
        h('input', { type: 'checkbox', 'data-compare-pick': it.id, checked: picked.has(it.id), onchange: (e) => { if (e.target.checked) picked.add(it.id); else picked.delete(it.id); draw(); } }), it.id)));
      const chosen = items.filter((it) => picked.has(it.id));
      grid.replaceChildren(...chosen.map((it) => h('div', { class: 'stack', style: 'gap:4px;flex:0 0 ' + (chosen.length <= 2 ? '45%' : chosen.length === 3 ? '31%' : '220px') + ';min-width:150px', 'data-compare-col': it.id },
        it.url ? previewImage({ url: it.url, alt: it.id, style: 'width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:10px;border:2px solid ' + (it.state === 'approved' ? 'var(--sage)' : 'var(--rose)') }) : h('div', { class: 'empty', style: 'aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;border:2px dashed var(--rose);border-radius:10px' }, '이미지 없음'),
        h('div', { class: 'row between' }, h('b', null, it.id), chip(STATE_LABEL[it.state], it.state === 'approved' ? 'done' : it.state === 'missing' ? 'err' : 'attention')),
        h('div', { class: 'small muted', style: 'word-break:break-all' }, it.name || ''),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { close(); onOpenScene(it.id); } }, '이 씬 편집'))));
    };
    draw();
    return h('div', { class: 'stack', style: 'gap:10px' },
      h('h2', { style: 'margin:0' }, '장면 비교'),
      h('div', { class: 'small muted' }, '캐릭터 얼굴 · 비율 · 그림체 · 색감 · 배경 · 제품 모양이 장면마다 일관적인지 나란히 확인합니다. 저장된 이미지를 그대로 보여 주며 새로 만들지 않습니다.'),
      chips, grid, h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')));
  }, { wide: true });
}

export function sceneGallery(ep, onOpenScene) {
  const items = ep.scenes.map((sc, i) => galleryItem(ep, sc, i));
  const cur = (uiState().sbScene || {})[ep.id];
  const approved = items.filter((x) => x.state === 'approved').length;
  return h('section', { class: 'card stack', style: 'gap:8px', 'data-scene-gallery': '' },
    h('div', { class: 'row between', style: 'gap:8px;flex-wrap:wrap' },
      h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('b', null, '장면 이미지 갤러리'), chip(`승인 ${approved}/${items.length}`, approved === items.length ? 'done' : 'attention')),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-gallery-compare': '', onclick: () => openCompare(ep, items, onOpenScene) }, '비교')),
    h('div', { class: 'scene-gallery-strip', role: 'list', 'aria-label': '장면 시작 이미지' }, items.map((it) =>
      h('div', { class: `gal-item ${it.state}${cur === it.id || (!cur && it.index === 0) ? ' current' : ''}`, role: 'listitem', 'data-gallery-item': it.id, 'data-gallery-state': it.state },
        h('button', { class: 'gal-thumb', type: 'button', 'aria-label': `${it.id} 씬 열기 (${STATE_LABEL[it.state]})`, 'data-gallery-open': it.id, onclick: () => onOpenScene(it.id) },
          it.url ? previewImage({ url: it.url, compact: true, style: 'width:100%;height:100%' }) : h('span', { class: 'gal-empty' }, '이미지 없음'),
          it.state === 'approved' ? h('span', { class: 'gal-badge ok' }, '✓') : null,
          it.bcuts ? h('span', { class: 'gal-badge bc', 'data-gallery-bcuts': it.id }, `+${it.bcuts}`) : null),
        h('div', { class: 'gal-meta' }, h('b', null, it.id), h('button', { class: 'gal-zoom', type: 'button', 'aria-label': `${it.id} 크게 보기`, 'data-gallery-zoom': it.id, onclick: () => openPreview(ep, items, it.id, onOpenScene) }, '🔍'))))));
}
