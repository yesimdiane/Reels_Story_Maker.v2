// Compact reference-image selection for ONE character (Character Library): up to 3 selected images PER CHARACTER, in order (first = primary).
// Thumbnails ~92px with the exact uploaded filename beneath (ellipsis, full name on hover/focus). Selecting never deletes or hides the
// other uploads. Only approved real images can be selected.
import { h, modal, confirmDialog, toast, icon } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';

export const MAX_SELECT = 3;

export function openFull(url, title) {
  modal((close) => h('div', { class: 'stack', style: 'gap:10px;align-items:center' },
    h('h2', { style: 'margin:0;word-break:break-all' }, title),
    h('img', { src: url, alt: title, 'data-ref-full': '', style: 'max-width:100%;max-height:72vh;border-radius:12px' }),
    h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')), { wide: true });
}

/** A selectable tile; used by the library gallery and by the per-scene chooser. */
export function refTile({ url, filename, selected, order, disabled, hint, onToggle, onOpen, extra, id }) {
  const fn = h('div', { class: 'ref-fn', tabindex: 0, title: filename, 'aria-label': '파일명: ' + filename, 'data-ref-filename': '' }, filename);
  return h('div', { class: 'ref-tile' + (selected ? ' selected' : ''), 'data-ref-tile': id || '', 'data-selected': selected ? '1' : '0' },
    h('button', { type: 'button', class: 'ref-thumb', title: '크게 보기 · ' + filename, 'aria-label': filename + ' 크게 보기', onclick: onOpen }, h('img', { src: url, alt: filename, loading: 'lazy' }),
      selected ? h('span', { class: 'ref-check', 'aria-hidden': 'true' }, '✓' + (order ? ' ' + order : '')) : null),
    fn,
    onToggle ? h('button', { type: 'button', class: 'btn sm ' + (selected ? 'sage' : 'ghost'), 'data-ref-toggle': id || '', disabled: !!disabled && !selected, title: disabled && !selected ? hint : '', 'aria-pressed': selected ? 'true' : 'false', onclick: onToggle }, selected ? (order === 1 ? '대표 ✓' : '선택됨 ✓') : '선택') : null,
    extra || null);
}

export function refGallery(c) {
  const usable = (r) => r.approved && !r.placeholder;
  const explicit = (c.referenceSelection || []).filter((id) => c.references.some((r) => r.id === id && usable(r)));
  const firstApproved = c.references.find(usable);
  const current = explicit.length ? explicit : firstApproved ? [firstApproved.id] : [];
  const save = (ids, ok) => act(async () => { await api.put(`/api/characters/${c.id}/reference-selection`, { refIds: ids }); return null; }, { ok });
  const toggle = (r) => {
    const on = current.includes(r.id);
    if (on) return save(current.filter((x) => x !== r.id), `${r.originalName || r.label} 선택 해제`);
    if (current.length >= MAX_SELECT) return toast(`캐릭터당 최대 ${MAX_SELECT}장까지 선택할 수 있습니다. 다른 이미지를 먼저 선택 해제하세요.`, { error: true });
    return save(current.concat(r.id), `${r.originalName || r.label} 선택 (첫 번째 선택이 대표 이미지)`);
  };
  return h('div', { class: 'stack', style: 'gap:8px', 'data-ref-gallery-lib': c.id },
    h('div', { class: 'row between' }, h('b', { class: 'small' }, '참조 이미지'), h('span', { class: 'small muted', 'data-ref-counter': c.id }, `선택 ${current.length}/${MAX_SELECT}` + (explicit.length ? '' : current.length ? ' (자동: 첫 승인 이미지)' : ''))),
    h('div', { class: 'small muted' }, `캐릭터당 최대 ${MAX_SELECT}장 · 첫 번째 선택이 대표 이미지 · 선택하지 않은 이미지도 삭제되지 않습니다.`),
    c.references.length ? h('div', { class: 'ref-compact-grid' }, c.references.map((r) => {
      const idx = current.indexOf(r.id);
      const fname = r.originalName || r.label || r.id;
      const extra = h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' },
        h('button', { class: 'btn sm ' + (r.approved ? 'ghost' : 'sage'), type: 'button', title: r.approved ? '승인 취소' : '승인해야 선택할 수 있습니다', onclick: () => act(async () => { await api.post(`/api/characters/${c.id}/references/${r.id}/approve`, { approved: !r.approved }); return null; }) }, r.approved ? '승인됨' : '승인'),
        h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': '삭제', onclick: async () => { if (await confirmDialog({ title: `${fname}을(를) 삭제할까요?`, body: '이 이미지를 시작 프레임으로 쓰는 장면은 다시 지정해야 합니다.', confirm: '삭제', tone: 'clay' })) act(async () => { await api.del(`/api/characters/${c.id}/references/${r.id}`); return null; }); } }, icon('trash')),
        h('label', { class: 'small', style: 'display:flex;gap:4px;align-items:center', title: '여러 그림이 모인 시트이면 체크 (시작 프레임으로 직접 쓸 수 없음)' }, h('input', { type: 'checkbox', checked: r.isSheet !== false, onchange: (e) => act(async () => { await api.put(`/api/characters/${c.id}/references/${r.id}`, { isSheet: e.target.checked }); return null; }) }), '시트'));
      return refTile({ id: r.id, url: r.url, filename: fname, selected: idx >= 0, order: idx >= 0 ? idx + 1 : 0, disabled: !usable(r) || current.length >= MAX_SELECT, hint: !usable(r) ? '승인된 실제 이미지만 선택할 수 있습니다' : `캐릭터당 최대 ${MAX_SELECT}장`, onToggle: usable(r) || idx >= 0 ? () => toggle(r) : null, onOpen: () => openFull(r.url, fname), extra });
    })) : h('div', { class: 'small muted' }, '업로드된 참조 이미지가 없습니다.'));
}
