import { h, chip, modal, fmtUsd, toast } from '../ui.js';
import { state, go, selectEpisode, act } from '../state.js';
import { api } from '../api.js';
import { pageHead, modeBanner, asyncBlock } from './common.js';
import { episodeMenu } from './episode-actions.js';

export function episodes() {
  const s = state.summary;
  const wrap = h('div', { class: 'stack', style: 'gap:22px' });
  wrap.append(pageHead('Episodes', '에피소드', '제품과 연결된 에피소드 라이브러리 — 초안, 제작 중, 게시 완료를 한곳에서 관리합니다.', h('button', { class: 'btn', onclick: newEpisode }, '+ 새 에피소드 (승인된 컨셉에서)')));
  const active = (s.episodes || []).filter((e) => !e.archived);
  const archived = (s.episodes || []).filter((e) => e.archived);
  const products = state.summary.products || [];
  const productMap = new Map(products.map((p) => [p.id, p]));
  const viewState = { mode: 'product' };
  const listing = h('div', { class: 'stack', style: 'gap:18px', 'data-episode-listing': '' });
  const groupEpisodes = (episodes) => {
    const groups = new Map();
    episodes.forEach((e) => {
      // The summary provides productId; use the name as a fallback for older episodes.
      const key = e.productId || 'name:' + (e.productName || '미지정 제품');
      if (!groups.has(key)) groups.set(key, { key, product: productMap.get(e.productId), name: e.productName || '미지정 제품', episodes: [] });
      groups.get(key).episodes.push(e);
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  };
  const groupCard = (group, archivedView = false) => {
    const p = group.product;
    const title = p && p.name || group.name;
    const thumb = p && p.mainImage && p.mainImage.url;
    return h('section', { class: 'card stack', style: 'gap:12px;min-width:0', 'data-episode-product': group.key },
      h('div', { class: 'row between', style: 'gap:10px;flex-wrap:wrap' },
        h('div', { class: 'row', style: 'gap:10px;min-width:0' },
          thumb ? h('img', { src: thumb, alt: title, loading: 'lazy', style: 'width:54px;height:54px;object-fit:cover;border-radius:10px' }) : null,
          h('div', { class: 'stack', style: 'gap:3px;min-width:0' },
            h('h3', { style: 'margin:0;overflow-wrap:anywhere' }, title),
            h('span', { class: 'small muted' }, group.episodes.length + '개 에피소드'))),
        p ? h('a', { class: 'btn sm ghost', href: '#/products/' + p.id }, '제품 보기') : null),
      h('div', { class: 'grid three' }, group.episodes.map((e) => episodeCard(e, { archivedView }))));
  };
  const renderListing = () => {
    listing.replaceChildren();
    listing.append(h('div', { class: 'row between', style: 'gap:10px;flex-wrap:wrap' },
      h('div', { class: 'small muted' }, active.length + '개 에피소드 · ' + groupEpisodes(active).length + '개 제품'),
      h('div', { class: 'row', style: 'gap:6px' },
        ...[['product', '제품별 보기'], ['all', '전체 보기']].map(([key, label]) =>
          h('button', { type: 'button', class: 'btn sm ' + (viewState.mode === key ? 'sage' : 'ghost'),
            'aria-pressed': viewState.mode === key ? 'true' : 'false',
            'data-episode-view': key, onclick: () => { viewState.mode = key; renderListing(); } }, label)))));
    if (active.length) {
      if (viewState.mode === 'product') listing.append(...groupEpisodes(active).map((g) => groupCard(g)));
      else listing.append(h('div', { class: 'grid three' }, active.map((e) => episodeCard(e))));
    } else listing.append(h('div', { class: 'empty' }, h('p', null, archived.length ? '진행 중인 에피소드가 없습니다. 보관된 에피소드는 아래에서 볼 수 있습니다.' : '에피소드가 없습니다.')));
    if (archived.length) listing.append(h('details', { class: 'card', 'data-archived': '1' },
      h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center;gap:8px' },
        h('b', null, '보관됨 (' + archived.length + ')'),
        h('span', { class: 'small muted' }, '삭제가 아닙니다 — 언제든 보관 해제할 수 있습니다')),
      h('div', { class: 'stack', style: 'margin-top:12px;gap:12px' },
        ...(viewState.mode === 'product'
          ? groupEpisodes(archived).map((g) => groupCard(g, true))
          : [h('div', { class: 'grid three' }, archived.map((e) => episodeCard(e, { archivedView: true })))]))));
  };
  renderListing();
  wrap.append(listing);
  wrap.append(trashBox());
  return wrap;
}


function episodeCard(e, { archivedView = false } = {}) {
  const done = e.steps.filter((x) => x.state === 'done').length;
  const status = e.published ? ['게시 완료', 'done'] : e.finalApproved ? ['최종 승인', 'done'] : done > 2 ? ['제작 중', 'attention'] : ['초안', ''];
  return h('article', { class: 'card ep-card', 'data-episode': e.id, style: 'padding:0;overflow:hidden;display:grid;grid-template-columns:120px 1fr' },
    h('div', { class: 'thumb', style: 'border-radius:0;border:0;border-right:1px solid var(--line)' }, e.thumb ? h('video', { src: e.thumb, poster: e.poster || undefined, muted: true, playsinline: true, preload: 'metadata', style: 'width:100%;height:100%;object-fit:cover;background:var(--surface)' }) : e.poster ? h('img', { src: e.poster, alt: e.title + ' 시작 이미지', loading: 'lazy', style: 'width:100%;height:100%;object-fit:cover' }) : h('div', { style: 'height:100%;display:grid;place-items:center;color:var(--muted);font-size:12px;text-align:center;padding:8px' }, '미리보기 없음')),
    h('div', { class: 'stack', style: 'padding:16px;gap:8px' },
      h('div', { class: 'row between' }, h('span', { class: 'eyebrow' }, e.id), h('div', { class: 'row', style: 'gap:6px' }, archivedView ? chip('보관됨', 'mock') : null, e.onHold ? chip('보류 중', 'mock') : null, chip(status[0], status[1]))),
      h('h3', { style: 'font-size:17px' }, e.title),
      h('div', { class: 'small muted' }, e.productName),
      e.concept && e.concept.linked ? h('div', { class: 'small' }, chip(e.concept.ok ? '컨셉 ' + e.concept.conceptId + ' r' + e.concept.revision : e.concept.state === 'script_stale' ? '컨셉 변경 · 대본 재생성 필요' : '컨셉 승인 필요', e.concept.ok ? 'done' : 'attention')) : e.concept && e.concept.legacy ? h('div', { class: 'small' }, chip('스토리 랩 이전', 'mock')) : null,
      h('div', { class: 'mini-dots' }, e.steps.map((st) => h('i', { class: st.state, title: st.label }))),
      h('div', { class: 'small muted' }, `${e.scenes}장면 · 약 ${Math.round(e.totalPlannedSec)}초 · 지출 ${fmtUsd(e.spentUsd)}`),
      h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('button', { class: 'btn sm', 'data-open-episode': e.id, onclick: async () => { await selectEpisode(e.id); go('script'); } }, '열기'), h('span', { style: 'margin-left:auto' }, episodeMenu(e, { archivedView })))));
}

/** Episodes start from an APPROVED story concept (Product → Story Lab → Episode). */
async function newEpisode() {
  const prods = (state.summary.storylab || []).filter((x) => x.approved > 0);
  let loaded = [];
  try { loaded = await Promise.all(prods.map(async (x) => ({ p: x, lab: await api.get('/api/storylab/' + x.productId) }))); } catch (e) { return toast(e.message, { error: true }); }
  const choices = loaded.flatMap(({ p, lab }) => lab.concepts.filter((c) => c.approved).map((c) => ({ productId: p.productId, name: p.name, c })));
  let pick = choices[0] || null;
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, '새 에피소드'),
    choices.length ? h('p', { class: 'muted small', style: 'margin:0' }, '승인된 스토리 컨셉을 선택하세요. 제품의 확인된 사실이 에피소드로 복사되고, 컨셉과의 연결이 기록됩니다.')
      : h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인된 스토리 컨셉이 없습니다'), '제품 → 스토리 랩에서 컨셉을 생성하고 승인한 뒤 에피소드를 만들 수 있습니다. ', h('a', { href: '#/storylab', onclick: close }, 'Story Lab으로'))),
    choices.map((x, i) => h('label', { class: 'card tight row', style: 'gap:10px;cursor:pointer;flex-wrap:nowrap' }, h('input', { type: 'radio', name: 'concept', checked: i === 0, onchange: () => (pick = x) }), h('div', null, h('b', null, x.c.title), h('div', { class: 'small muted' }, `${x.productId} · ${x.name} · ${x.c.id} r${x.c.revision}${x.c.sample ? ' · 샘플' : ''}`)))),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn', disabled: !choices.length, onclick: async () => {
      const r = await act(() => api.post('/api/episodes', { productId: pick.productId, conceptId: pick.c.id }), { ok: '에피소드를 만들었습니다' });
      if (r) { close(); await selectEpisode(r.id); go('script'); }
    } }, '이 컨셉으로 만들기'))));
}

function field(label, type, ph, on) {
  return h('div', { class: 'field' }, h('label', null, label), h('input', { type, placeholder: ph, oninput: (e) => on(e.target.value) }));
}

function trashBox() {
  return asyncBlock(() => api.get('/api/episodes-trash'), ({ trash }) => {
    if (!trash.length) return h('div', null);
    return h('details', { class: 'card', 'data-trash': '1' }, h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center;gap:8px' }, h('b', null, `휴지통 (${trash.length})`), h('span', { class: 'small muted' }, '삭제한 에피소드 — 복원할 수 있습니다')),
      h('div', { class: 'list', style: 'margin-top:10px' }, trash.map((t) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${t.id} · ${t.title}`), h('div', { class: 'small muted' }, `${t.productName} · ${t.scenes}장면 · ${new Date(t.trashedAt).toLocaleString('ko-KR')}에 삭제`)),
        h('button', { class: 'btn sm', type: 'button', 'data-restore-episode': t.id, onclick: async () => { try { await api.post(`/api/episodes/${t.id}/restore`); toast('복원했습니다'); await act(async () => null); } catch (err) { toast(err.message, { error: true }); } } }, '복원')))));
  }, { label: '' });
}
