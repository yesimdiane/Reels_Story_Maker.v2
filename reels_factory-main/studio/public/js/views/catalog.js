// Reusable catalog landing page (Product Studio, Story Lab): compact toolbar (search · view mode · sort · status filter) and a
// real-image grid or a compact name list. View mode, sort and status filter are remembered per catalog in localStorage;
// the search text lives only for the browser session. Opening an item is plain navigation: it never creates or changes a record.
import { h, chip, icon } from '../ui.js';

export const SORTS = [['recent', '최근 수정순'], ['newest', '최신 등록순'], ['oldest', '오래된 순'], ['name-asc', '이름 A–Z'], ['name-desc', '이름 Z–A']];
const searches = {}; // session-only search text per catalog

const KEY = (id) => 'rf.catalog.' + id;
export function loadPrefs(id) {
  const d = { view: 'grid', sort: 'recent', status: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY(id)) || 'null'); if (v && typeof v === 'object') { if (['grid', 'list'].includes(v.view)) d.view = v.view; if (SORTS.some((x) => x[0] === v.sort)) d.sort = v.sort; if (typeof v.status === 'string') d.status = v.status; } } catch { /* private mode / bad json */ }
  return d;
}
function savePrefs(id, p) { try { localStorage.setItem(KEY(id), JSON.stringify(p)); } catch { /* private mode */ } }

const t = (v) => String(v == null ? '' : v);
const norm = (v) => t(v).toLowerCase().normalize('NFC');
const byName = (a, b) => t(a.name).localeCompare(t(b.name), 'ko');
const CMP = {
  recent: (a, b) => t(b.updatedAt).localeCompare(t(a.updatedAt)) || byName(a, b),
  newest: (a, b) => t(b.createdAt).localeCompare(t(a.createdAt)) || byName(a, b),
  oldest: (a, b) => t(a.createdAt).localeCompare(t(b.createdAt)) || byName(a, b),
  'name-asc': (a, b) => byName(a, b),
  'name-desc': (a, b) => byName(b, a),
};
export function filterSort(items, { q = '', sort = 'recent', status = '' } = {}) {
  const needle = norm(q).trim();
  return items
    .filter((it) => !status || (it.statuses || [it.status]).includes(status))
    .filter((it) => !needle || norm([it.name, it.code, it.id].concat(it.search || []).join('\n')).includes(needle))
    .slice().sort(CMP[sort] || CMP.recent);
}

/**
 * opts: { id, noun, items, statusOptions: [[key, label]], onOpen(item), create?: { label, onClick, attr? }, emptyText, noMatchText }
 * item: { id, name, code, thumb: url|'' , status, statuses?, statusLabel, tone, meta: [text], note?: {text, tone}, search: [text], createdAt, updatedAt, attr? }
 */
export function catalog(opts) {
  const prefs = loadPrefs(opts.id);
  if (prefs.status && !(opts.statusOptions || []).some((o) => o[0] === prefs.status)) prefs.status = '';
  let q = searches[opts.id] || '';
  const root = h('section', { class: 'catalog', 'data-catalog': opts.id });
  const results = h('div', { class: 'catalog-results', 'aria-live': 'polite' });
  const count = h('span', { class: 'small muted', 'data-catalog-count': '' });

  const search = h('input', { type: 'text', inputmode: 'search', enterkeyhint: 'search', class: 'catalog-search', value: q, placeholder: opts.searchPlaceholder || '이름 · 코드로 검색', 'aria-label': '검색', 'data-catalog-search': '', autocomplete: 'off', oninput: (e) => { q = e.target.value; searches[opts.id] = q; draw(); } });
  const seg = h('div', { class: 'seg catalog-view', 'data-no-en': '', role: 'group', 'aria-label': '보기 방식' });
  const drawSeg = () => seg.replaceChildren(...[['grid', '이미지 보기', 'grid'], ['list', '이름 목록', 'list']].map(([k, label, ic]) => h('button', { type: 'button', 'data-view': k, 'aria-pressed': prefs.view === k ? 'true' : 'false', 'aria-label': label, title: label, onclick: () => { prefs.view = k; savePrefs(opts.id, prefs); drawSeg(); draw(); } }, icon(ic), h('span', { class: 'catalog-view-label' }, label))));
  const sort = h('select', { class: 'catalog-select', 'aria-label': '정렬', 'data-catalog-sort': '', onchange: (e) => { prefs.sort = e.target.value; savePrefs(opts.id, prefs); draw(); } }, SORTS.map(([k, l]) => h('option', { value: k, selected: prefs.sort === k }, l)));
  const status = (opts.statusOptions || []).length ? h('select', { class: 'catalog-select', 'aria-label': '상태 필터', 'data-catalog-status': '', onchange: (e) => { prefs.status = e.target.value; savePrefs(opts.id, prefs); draw(); } }, [['', '모든 상태']].concat(opts.statusOptions).map(([k, l]) => h('option', { value: k, selected: prefs.status === k }, l))) : null;

  function open(it) { opts.onOpen(it); }
  const thumb = (it) => (it.thumb
    ? h('img', { class: 'catalog-thumb', src: it.thumb, alt: it.name || '', loading: 'lazy', 'data-catalog-img': '' })
    : h('div', { class: 'catalog-thumb empty', 'aria-hidden': 'true' }, opts.noImageText || '이미지 없음'));
  const card = (it) => h('a', Object.assign({ class: 'catalog-card', href: it.href || '#', 'data-catalog-item': it.id, onclick: (e) => { e.preventDefault(); open(it); } }, it.attr || {}),
    thumb(it),
    h('div', { class: 'catalog-body' },
      h('div', { class: 'row between catalog-top' }, h('span', { class: 'eyebrow catalog-code' }, it.id + (it.code ? ' · ' + it.code : '')), chip(it.statusLabel, it.tone || '')),
      h('div', { class: 'catalog-name' }, it.name || '(이름 없음)'),
      ...(it.meta || []).map((m) => h('div', { class: 'small muted catalog-meta' }, m)),
      it.note ? h('div', { class: 'small catalog-note', style: it.note.tone === 'warn' ? 'color:var(--clay)' : '' }, it.note.text) : null));
  const row = (it) => h('a', Object.assign({ class: 'catalog-row', href: it.href || '#', 'data-catalog-item': it.id, onclick: (e) => { e.preventDefault(); open(it); } }, it.attr || {}),
    thumb(it),
    h('span', { class: 'catalog-row-main' }, h('b', { class: 'catalog-name' }, it.name || '(이름 없음)'), h('span', { class: 'small muted' }, it.id + (it.code ? ' · ' + it.code : '') + ((it.meta || [])[0] ? ' · ' + it.meta[0] : ''))),
    h('span', { class: 'catalog-row-status' }, it.note ? h('span', { class: 'small', style: it.note.tone === 'warn' ? 'color:var(--clay)' : '' }, it.note.text) : null, chip(it.statusLabel, it.tone || '')));

  function draw() {
    const shown = filterSort(opts.items, { q, sort: prefs.sort, status: prefs.status });
    count.textContent = shown.length === opts.items.length ? `${opts.items.length}개` : `${shown.length} / ${opts.items.length}개`;
    results.dataset.resultsView = prefs.view;
    if (!opts.items.length) { results.replaceChildren(h('div', { class: 'empty', 'data-catalog-empty': '' }, h('h2', null, opts.emptyTitle || '항목이 없습니다'), h('p', null, opts.emptyText || ''))); return; }
    if (!shown.length) { results.replaceChildren(h('div', { class: 'empty', 'data-catalog-nomatch': '' }, opts.noMatchText || '조건에 맞는 항목이 없습니다.', ' ', h('button', { type: 'button', class: 'btn sm ghost', 'data-catalog-reset': '', onclick: () => { q = ''; searches[opts.id] = ''; search.value = ''; prefs.status = ''; if (status) status.value = ''; savePrefs(opts.id, prefs); draw(); } }, '필터 지우기'))); return; }
    results.replaceChildren(h('div', { class: prefs.view === 'grid' ? 'catalog-grid' : 'catalog-list', [prefs.view === 'grid' ? 'data-catalog-grid' : 'data-catalog-list']: '' }, shown.map(prefs.view === 'grid' ? card : row)));
  }
  drawSeg();
  root.append(h('div', { class: 'catalog-toolbar', role: 'search' }, h('label', { class: 'catalog-search-wrap' }, icon('search'), search), status, sort, seg, count,
    opts.create ? h('button', Object.assign({ type: 'button', class: 'btn catalog-create', onclick: opts.create.onClick }, opts.create.attr || {}), icon('plus'), opts.create.label) : null), results);
  draw();
  return root;
}
