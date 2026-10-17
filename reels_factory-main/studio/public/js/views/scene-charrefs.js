// Storyboard "캐릭터 참조 이미지": per participating character, the images that will be sent with this scene's image requests
// (up to 3 PER CHARACTER, first = primary). Compact thumbnails with the exact filenames, a selection counter, a full-size viewer, and a
// per-scene chooser. Choosing here never changes the Character Library's selection and never deletes anything. Free: no provider call.
import { h, chip, modal, toast } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';
import { refTile, openFull, MAX_SELECT } from './ref-gallery.js';

const STATUS = { approved: ['승인됨', 'done'], unapproved: ['승인 필요', 'attention'], placeholder: ['임시 이미지 — 실제 참조 필요', 'err'], missing: ['참조 없음', 'err'], file_missing: ['파일 없음', 'err'] };
const MISSING = (name) => `Character reference missing: ${name}. Please upload or select a reference image.`;

function chooser(ep, sc, r) {
  let picked = r.selected.map((x) => x.refId);
  modal((close) => {
    const body = h('div', { class: 'stack', style: 'gap:10px' });
    const draw = () => {
      body.replaceChildren(
        h('div', { class: 'row between' }, h('span', { class: 'small muted' }, '이 장면에서만 쓸 참조 이미지를 고릅니다 (1–3장, 먼저 고른 이미지가 대표). 라이브러리의 선택과 원본은 바뀌지 않습니다.'), h('b', { 'data-ref-picked-count': '' }, `선택 ${picked.length}/${MAX_SELECT}`)),
        r.options.length ? h('div', { class: 'ref-compact-grid' }, r.options.map((o) => {
          const i = picked.indexOf(o.refId);
          return refTile({ id: o.assetId, url: o.url, filename: o.filename, selected: i >= 0, order: i >= 0 ? i + 1 : 0, disabled: picked.length >= MAX_SELECT, hint: `캐릭터당 최대 ${MAX_SELECT}장`, onOpen: () => openFull(o.url, o.filename),
            onToggle: () => { picked = i >= 0 ? picked.filter((x) => x !== o.refId) : picked.concat(o.refId); draw(); } });
        })) : h('div', { class: 'issue err' }, MISSING(r.name)),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn sm', type: 'button', 'data-ref-save': r.characterId, disabled: !picked.length, onclick: async () => { close(); await act(async () => { await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/character-refs/${r.characterId}`, { refIds: picked }); return null; }, { ok: `${r.name}: 참조 이미지 ${picked.length}장을 이 장면에 지정했습니다 (시작 프레임은 다시 만들어야 반영됩니다)` }); } }, '이 장면에 저장'),
          r.override ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { close(); await act(async () => { await api.del(`/api/episodes/${ep.id}/scenes/${sc.id}/character-refs/${r.characterId}`); return null; }, { ok: '라이브러리 선택으로 되돌렸습니다' }); } }, '기본값 (라이브러리 선택)') : null,
          h('a', { class: 'btn sm ghost', href: '#/settings/characters', onclick: close }, '캐릭터 라이브러리에서 올리기 · 승인'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: close }, '닫기')));
    };
    draw();
    return h('div', { class: 'stack' }, h('h2', { style: 'margin:0' }, `${r.name} 참조 이미지`), body);
  }, { wide: true });
}

export function charRefsPanelBody(ep, sc) {
  const refs = sc.charRefs || [];
  if (!refs.length) return h('div', { class: 'small muted' }, '이 장면에 등장하는 캐릭터가 없습니다.');
  const total = refs.reduce((n, r) => n + r.selectedCount, 0);
  return h('div', { class: 'stack', style: 'gap:10px', 'data-char-refs': sc.id },
    sc.charRefsStale ? h('div', { class: 'issue warn' }, '시작 프레임이 지금 선택된 참조와 다른 이미지로 만들어졌습니다. 필요하면 "다시 생성"으로 새 참조를 반영하세요 (비용 확인 후 생성).') : null,
    h('div', { class: 'small muted' }, `캐릭터별 최대 ${MAX_SELECT}장 · 이 장면 합계 ${total}장 (제품 참조 이미지는 따로 추가됩니다). 모델의 입력 한도는 생성 전에 확인합니다.`),
    h('div', { class: 'stack', style: 'gap:10px' }, refs.map((r) => {
      const [label, kind] = STATUS[r.status] || ['확인 필요', 'attention'];
      return h('div', { class: 'card flat stack', style: 'gap:8px', 'data-char-ref': r.characterId, 'data-ref-status': r.status },
        h('div', { class: 'row between' }, h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, h('b', null, r.name), r.override ? h('span', { class: 'small muted' }, '이 장면 전용') : null, h('span', { class: 'small mono muted', 'data-ref-asset': '' }, r.assetId || '—')), h('div', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small', 'data-ref-count': r.characterId }, `선택 ${r.selectedCount}/${MAX_SELECT}`), chip(label, kind))),
        r.status !== 'approved' ? h('div', { class: 'small', style: 'color:#8a4e2c' }, r.status === 'missing' ? MISSING(r.name) : r.message) : null,
        r.selected.length ? h('div', { class: 'ref-compact-grid' }, r.selected.map((x) => refTile({ id: x.assetId, url: x.url, filename: x.filename, selected: true, order: x.order, onOpen: () => openFull(x.url, `${r.name} · ${x.filename}`) }))) : null,
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          r.url && r.status !== 'placeholder' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-ref-view': r.characterId, onclick: () => openFull(r.url, `${r.name} · ${r.filename}`) }, '원본 보기') : null,
          h('button', { class: 'btn sm ghost', type: 'button', 'data-ref-change': r.characterId, onclick: () => chooser(ep, sc, r) }, '참조 변경')));
    })));
}

export function charRefsBadge(sc) {
  const refs = sc.charRefs || [];
  const bad = refs.filter((r) => r.status !== 'approved').length;
  return refs.length ? (bad ? `${bad}명 참조 필요` : `${refs.length}명 · 참조 ${refs.reduce((n, r) => n + r.selectedCount, 0)}장`) : '';
}
