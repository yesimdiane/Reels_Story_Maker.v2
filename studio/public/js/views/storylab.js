// Story Lab: develop and approve ONE overall storyline per concept (title + English storyline + Korean translation).
// Scenes, dialogue, hooks, CTAs, prompts and shot counts belong to the later studios.
import { h, chip, icon, toast, modal, confirmDialog } from '../ui.js';
import { state, act, setProduct } from '../state.js';
import { api } from '../api.js';
import { pageHead, asyncBlock, confirmPaid } from './common.js';
import { castSection } from './cast-picker.js';
import { catalog } from './catalog.js';

const fresh = () => ({ tab: 'candidate', open: '', ko: new Set(), category: '', count: 1, maxSec: 45, extra: '' });
// Each product keeps its own unsaved generation form (category, count, length, extra instruction, open tab/story) while the user
// goes back to the catalog and opens it again; nothing here is written to the server until a button is pressed.
const drafts = {};
let view = fresh();
// Count rules mirror the backend (studio/lib/storycategories.js): 1–5 for one category, always 3 for "all". The server enforces them too.
const isAll = () => view.category === 'all';
const effCount = () => (isAll() ? 3 : view.count);
const catName = (cats, k) => { const o = (cats || []).find((x) => x.key === k); return o ? o.ko : ''; };
const TABS = [['candidate', '후보', (c) => c.status === 'candidate'], ['approved', '승인됨', (c) => c.status === 'approved'], ['hold', '보류', (c) => c.status === 'hold'], ['archive', '보관·삭제', (c) => ['deleted', 'rejected', 'superseded'].includes(c.status)]];

const LAB_STATUS = [['none', '스토리 없음'], ['candidate', '후보 있음'], ['approved', '승인됨'], ['reapprove', '재승인 필요'], ['hold', '보류']];

/** Story Lab landing page: products with their story concepts. Opening a card only navigates; it never creates a story or a product. */
function labCatalog(s) {
  const lab = new Map((s.storylab || []).map((x) => [x.productId, x]));
  const items = (s.products || []).map((p) => {
    const l = lab.get(p.id) || { concepts: 0, approved: 0, candidates: 0, needsReapproval: 0, hold: 0, titles: [], lastAt: '' };
    const statuses = [];
    if (!l.concepts) statuses.push('none');
    if (l.candidates) statuses.push('candidate');
    if (l.approved) statuses.push('approved');
    if (l.needsReapproval) statuses.push('reapprove');
    if (l.hold) statuses.push('hold');
    const [label, tone] = !l.concepts ? ['스토리 없음', 'attention'] : l.needsReapproval ? ['재승인 필요', 'attention'] : l.approved ? ['승인 ' + l.approved, 'done'] : l.candidates ? ['후보 ' + l.candidates, ''] : ['보류', 'mock'];
    return { id: p.id, code: p.code || '', name: p.name || '', thumb: p.mainImage ? p.mainImage.url : '', status: statuses[0] || 'hold', statuses, statusLabel: label, tone, href: '#/storylab/' + p.id,
      meta: [l.concepts ? `스토리 ${l.concepts}개 · 승인 ${l.approved} · 후보 ${l.candidates}` : '아직 만든 스토리가 없습니다'],
      note: !l.concepts ? { text: p.readiness.ok ? '스토리를 만들어 보세요' : '필요: ' + p.readiness.missing.join(', '), tone: 'warn' } : null,
      search: l.titles || [], createdAt: p.createdAt || '', updatedAt: l.lastAt || p.updatedAt || '', attr: { 'data-lab-card': p.id, 'data-concepts': String(l.concepts) } };
  });
  return catalog({ id: 'storylab', items, statusOptions: LAB_STATUS, searchPlaceholder: '제품 이름 · 코드 · 스토리 제목으로 검색', noImageText: '대표 이미지 없음',
    emptyTitle: '제품을 먼저 만드세요', emptyText: '제품 스튜디오에서 제품을 만들면 여기에 나타납니다.', noMatchText: '조건에 맞는 제품 또는 스토리가 없습니다.',
    onOpen: (it) => { setProduct(it.id); location.hash = '#/storylab/' + it.id; } });
}

export function storylab() {
  const s = state.summary;
  const wrap = h('div', { class: 'stack', style: 'gap:16px' });
  const hashId = location.hash.split('/')[2] || '';
  if (!hashId) { // catalog first: no product (and no editor) is opened automatically
    wrap.append(pageHead('Story Lab', '스토리 랩', '제품을 고르면 그 제품의 스토리 컨셉을 만들고 승인하는 화면이 열립니다. 목록을 열어 보는 것만으로는 아무것도 만들어지지 않습니다.'));
    wrap.append(labCatalog(s));
    return wrap;
  }
  const pid = hashId;
  view = drafts[pid] || (drafts[pid] = fresh());
  const items = s.products || [];
  const picker = items.length > 1 ? h('select', { 'aria-label': '제품 선택', 'data-lab-product-select': '', style: 'width:auto;padding:7px 12px;border-radius:999px', onchange: (e) => { setProduct(e.target.value); location.hash = '#/storylab/' + e.target.value; } }, items.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.id + ' · ' + (p.name || '').slice(0, 24)))) : null;
  wrap.append(pageHead('Story Lab', '스토리 랩', '어떤 이야기로 사람들의 관심을 끌까? 전체 스토리라인만 만들고 승인합니다.', h('button', { class: 'btn ghost', type: 'button', 'data-lab-back': '', onclick: () => { location.hash = '#/storylab'; } }, icon('back'), '스토리 랩 목록'), picker));
  if (!items.some((p) => p.id === pid)) { wrap.append(h('div', { class: 'empty' }, h('h2', null, '제품을 찾을 수 없습니다'), h('button', { class: 'btn', onclick: () => { location.hash = '#/storylab'; } }, '목록으로'))); return wrap; }
  wrap.append(asyncBlock(() => Promise.all([api.get('/api/storylab/' + pid), api.get('/api/products/' + pid)]), ([lab, prod]) => body(lab, prod)));
  return wrap;
}

function routeInfo() { return (state.summary.ai.routing || []).find((x) => x.task === 'storyConcepts') || { provider: 'mock', model: '' }; }

function body(lab, prod) {
  const box = h('div', { class: 'stack', style: 'gap:16px' });
  const pid = prod.id;
  const route = routeInfo();
  const ready = prod.readiness;
  const cats = lab.categories || [];
  const redraw = () => import('../state.js').then(({ hooks }) => hooks.rerender());
  const genSummary = () => (view.category ? '만들 내용: ' + summaryText() + ` · 최대 ${view.maxSec || '?'}초 · 영어 스토리라인 + 한국어 번역 (한 번의 요청)` : '카테고리를 먼저 선택하세요.');
  function summaryText() {
    const o = cats.find((x) => x.key === view.category);
    return !o ? '' : isAll() ? '반전형 생활 개그 1개 · 바이럴형 1개 · 신뢰·정보형 1개 (총 3개)' : `${o.ko} ${view.count}개`;
  }

  // ---- header: product name + code, gate, provider ----
  box.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, prod.id + (prod.code ? ' · ' + prod.code : '')), h('h2', null, prod.name)),
      prod.code ? chip('코드 ' + prod.code, 'mono') : h('a', { class: 'chip attention', href: '#/products/' + pid }, '제품 코드 필요')),
    ready.ok ? null : h('div', { class: 'banner warn' }, icon('lock'), h('div', null, h('b', null, '스토리를 만들기 전에 필요한 것: ' + ready.missing.join(', ')), h('a', { href: '#/products/' + pid }, 'Products에서 채우기'))),
    route.provider === 'mock'
      ? h('div', { class: 'banner mock' }, chip('샘플', 'mock'), h('div', null, h('b', null, '스토리 AI가 연결되지 않아 샘플 응답을 씁니다'), '실제 생성은 Settings → AI 연동에서 키·모델을 지정하세요. ', h('a', { href: '#/settings' }, '설정으로')))
      : h('div', { class: 'banner' }, chip(route.provider, 'done'), h('div', null, h('b', null, `${route.provider} · ${route.model || '(모델 미선택)'}`), '실행 전에 예상 비용(추정)을 보여드리고 확인을 받습니다.')),
    castSection(pid, lab.cast, redraw),
    categoryPicker(cats, redraw),
    h('div', { class: 'row' },
      h('label', { class: 'row small', style: 'gap:6px' }, '영상 최대 길이', h('input', { type: 'number', inputmode: 'numeric', min: 10, max: 90, step: 1, value: view.maxSec, 'aria-label': '영상 최대 길이(초)', 'data-max-sec': '', style: 'width:84px', oninput: (e) => { view.maxSec = e.target.value === '' ? '' : Number(e.target.value); const el = document.querySelector('[data-gen-summary]'); if (el) el.textContent = genSummary(); } }), '초'),
      h('label', { class: 'row small', style: 'gap:6px' }, '콘셉트 수', h('select', { 'aria-label': '콘셉트 수', disabled: isAll(), title: isAll() ? '"모두 1개씩 만들기"는 항상 3개입니다' : null, onchange: (e) => { view.count = Number(e.target.value); redraw(); } }, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: n === effCount() }, n))), isAll() ? h('span', { class: 'muted' }, '(고정)') : null)),
    h('details', { class: 'small', 'data-advanced': '' }, h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, '고급 설정'),
      h('div', { class: 'field', style: 'margin-top:6px' }, h('input', { type: 'text', 'aria-label': '추가 지시', placeholder: '추가 지시 (선택) — 예: 비 오는 날 상황 위주로', value: view.extra, oninput: (e) => (view.extra = e.target.value) }))),
    h('div', { class: 'small', 'data-gen-summary': '' }, genSummary()),
    h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !ready.ok || !view.category || !!(lab.cast.errors && lab.cast.errors.length), onclick: generate }, icon('plus'), '스토리 컨셉 생성'))));

  async function generate() {
    if (!view.category) return toast('카테고리를 선택하세요', { error: true });
    const sec = Number(view.maxSec);
    if (!Number.isInteger(sec) || sec < 10 || sec > 90) return toast('영상 최대 길이는 10~90초의 정수로 입력하세요', { error: true });
    if (lab.cast.errors && lab.cast.errors.length) return toast(lab.cast.errors[0].message, { error: true });
    const req = { category: view.category, count: effCount(), maxDurationSec: sec, extra: view.extra, cast: lab.cast.cast };
    let est;
    try { est = await api.post(`/api/storylab/${pid}/estimate`, req); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
    const c = await confirmPaid({ title: `스토리 ${est.count}개 생성`, est, confirmLabel: '생성', body: h('div', { class: 'stack', style: 'gap:8px' },
      h('div', { class: 'card flat stack', style: 'gap:4px', 'data-confirm-summary': '' }, h('div', { class: 'small muted' }, '만들 내용'), h('b', null, est.summary), h('div', { class: 'small' }, `총 ${est.count}개 · 최대 ${est.maxDurationSec}초 · 영어 스토리라인과 한국어 번역을 한 번에 생성`), view.extra ? h('div', { class: 'small muted' }, '추가 지시: ' + view.extra) : null),
      h('p', { class: 'small muted', style: 'margin:0' }, '장면·대사·이미지 프롬프트는 만들지 않습니다. 기존 스토리와 승인된 버전은 바뀌지 않고 새 스토리만 추가됩니다.')) });
    if (c === null) return;
    await act(async () => { await api.post(`/api/storylab/${pid}/generate`, Object.assign({}, req, { confirm: c })); return null; }, { ok: '스토리를 만들었습니다' });
  }

  // ---- tabs + collapsed story list (one expanded at a time) ----
  const all = lab.concepts;
  const inTab = (k) => all.filter(TABS.find((t) => t[0] === k)[2]).slice().sort((x, y) => (y.batchId || '').localeCompare(x.batchId || '') || x.id.localeCompare(y.id));
  const shown = inTab(view.tab);
  box.append(h('div', { class: 'seg', role: 'tablist', 'data-tabs': '' }, TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'data-tab': k, 'aria-pressed': view.tab === k ? 'true' : 'false', onclick: () => { view.tab = k; view.open = ''; redraw(); } }, `${l} ${inTab(k).length}`))));
  if (!shown.length) box.append(h('div', { class: 'empty' }, view.tab === 'candidate' ? '아직 스토리가 없습니다. 위에서 생성하세요.' : '비어 있습니다.'));
  box.append(h('div', { class: 'story-list', 'data-story-list': '' }, shown.map((c) => storyCard(c, pid, cats, redraw))));
  return box;
}

/** Required category selector: four compact, tappable options with a one-line explanation each (stacked on phones). */
function categoryPicker(cats, redraw) {
  return h('div', { class: 'cat-picker', role: 'radiogroup', 'aria-label': '영상 카테고리 (필수)' },
    h('div', { class: 'small', style: 'font-weight:600' }, '영상 카테고리 ', h('span', { style: 'color:var(--rose)' }, '(필수)')),
    h('div', { class: 'cat-grid' }, cats.map((o) => h('button', { type: 'button', class: 'cat-opt' + (view.category === o.key ? ' on' : ''), role: 'radio', 'aria-checked': view.category === o.key ? 'true' : 'false', 'data-cat': o.key, onclick: () => { view.category = o.key; if (o.fixedCount) view.count = 3; else if (view.count < 1) view.count = 1; redraw(); } },
      h('span', { class: 'cat-name' }, o.ko, h('span', { class: 'cat-en' }, ' · ' + o.en)),
      h('span', { class: 'cat-brief' }, o.brief),
      h('span', { class: 'cat-goal' }, '목표: ' + o.goal)))));
}

function storyCard(c, pid, cats, redraw) {
  const open = view.open === c.id;
  const used = (state.summary.episodes || []).filter((e) => e.concept && e.concept.conceptId === c.id);
  const showKo = view.ko.has(c.id);
  const stateChip = c.approved ? chip('승인됨 v' + c.revision, 'done') : c.needsReapproval ? chip('수정됨 · 재승인 필요', 'attention') : c.status === 'hold' ? chip('보류', 'mock') : c.status === 'deleted' ? chip('삭제됨', 'err') : c.status === 'rejected' ? chip('거절됨', 'err') : c.status === 'superseded' ? chip('교체됨', 'mock') : chip('후보', '');
  const run = (fn, ok) => act(async () => { await fn(); return null; }, { ok });
  const head = h('button', { type: 'button', class: 'story-head', 'aria-expanded': open ? 'true' : 'false', 'data-story': c.id, onclick: () => { view.open = open ? '' : c.id; redraw(); } },
    h('span', { class: 'story-title' }, (showKo && c.ko && c.ko.title) || c.title),
    h('span', { class: 'row', style: 'gap:6px;flex:0 0 auto' }, c.category ? chip(catName(cats, c.category) || c.category, '') : null, stateChip, h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▴' : '▾')));
  if (!open) return h('article', { class: 'card story-card' + (c.approved ? ' approved' : '') }, head);

  const koText = c.ko && c.ko.storyline;
  const stale = c.koStale && c.koStale.length;
  const meta = [c.id, c.category ? catName(cats, c.category) : null, c.maxDurationSec ? '최대 ' + c.maxDurationSec + '초' : null, 'Story v' + c.revision, c.sample ? '샘플 응답' : null].filter(Boolean).join(' · ');
  const actions = [];
  if (['superseded', 'rejected'].includes(c.status)) { if (c.status === 'rejected') actions.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/reopen`), '후보로 되살렸습니다') }, '후보로 되살리기')); }
  else if (c.status === 'deleted') actions.push(h('button', { class: 'btn', type: 'button', 'data-act': 'restore', onclick: () => run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/restore`), '되살렸습니다') }, '삭제 취소 (복원)'));
  else {
    if (c.status === 'hold') actions.push(h('button', { class: 'btn', type: 'button', 'data-act': 'resume', onclick: () => run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/resume`), '보류를 해제했습니다') }, '보류 해제'));
    else if (c.approved) actions.push(h('button', { class: 'btn sage', type: 'button', 'data-act': 'handoff', onclick: () => handoff(c, pid, used) }, used.length ? '새 버전 에피소드로 대본 스튜디오 열기' : '대본 스튜디오로 보내기'));
    else actions.push(h('button', { class: 'btn sage', type: 'button', 'data-act': 'approve', onclick: () => approve(c, pid, run) }, icon('check'), c.needsReapproval ? '수정본 재승인' : '스토리 승인'));
    actions.push(h('button', { class: 'btn ghost', type: 'button', 'data-act': 'edit', onclick: () => editModal(c, pid, cats) }, '수정'));
    if (c.status === 'candidate' || c.approved) actions.push(h('button', { class: 'btn ghost', type: 'button', 'data-act': 'hold', onclick: () => holdStory(c, pid, run) }, '보류'));
    actions.push(h('button', { class: 'btn danger', type: 'button', 'data-act': 'delete', onclick: () => deleteStory(c, pid, run, used) }, '삭제'));
  }
  return h('article', { class: 'card story-card open' + (c.approved ? ' approved' : ''), 'data-story-open': c.id }, head,
    h('div', { class: 'stack', style: 'gap:10px;margin-top:10px' },
      h('div', { class: 'small muted' }, meta),
      h('div', { class: 'story-text', 'data-storyline': '' }, showKo ? (koText || '번역이 아직 없습니다 (이전에 만든 스토리)') : c.storyline),
      stale && showKo ? h('div', { class: 'small', style: 'color:var(--clay)' }, '영문이 수정되어 번역이 오래되었습니다 (읽기 전용).') : null,
      c.storylineLegacy ? h('div', { class: 'small muted' }, '이전 형식으로 만든 스토리입니다 (기존 필드는 그대로 보관되어 있습니다).') : null,
      h('div', { class: 'row between' },
        h('button', { class: 'btn sm ghost', type: 'button', 'data-ko-toggle': '', onclick: () => { if (showKo) view.ko.delete(c.id); else view.ko.add(c.id); redraw(); } }, icon('refresh'), showKo ? 'English' : '한국어 번역'),
        c.status === 'hold' && c.hold && c.hold.reason ? h('span', { class: 'small muted' }, '보류 사유: ' + c.hold.reason) : null),
      used.length ? h('div', { class: 'small' }, '이 스토리로 만든 에피소드: ' + used.map((e) => e.displayId || e.id).join(', ')) : null,
      h('div', { class: 'story-actions' }, actions),
      details(c)));
}

function details(c) {
  const src = c.source || {};
  const vers = c.storyVersions || [];
  return h('details', { class: 'small', 'data-details': '' }, h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, '자세히 보기'),
    h('div', { class: 'stack', style: 'gap:6px;margin-top:6px' },
      h('div', { class: 'muted' }, `${src.mock ? '샘플 응답' : (src.provider || '?') + '/' + (src.model || '?')} · 스토리 프롬프트 v${src.promptVersion || '?'}`),
      vers.length ? h('div', null, h('b', null, '승인된 버전'), vers.slice().reverse().map((v) => h('div', { class: 'muted' }, `v${v.revision} · ${new Date(v.at).toLocaleString('ko-KR')} · ${v.by || ''}`))) : h('div', { class: 'muted' }, '아직 승인된 버전이 없습니다.'),
      c.approval ? h('div', { class: 'mono', style: 'white-space:pre-wrap' }, [`제품: ${c.approval.productId}`, `스토리: ${c.approval.conceptId} (v${c.approval.revision})`, `참조 세트: ${c.approval.referenceSetId}`, `참조 이미지: ${(c.approval.referenceImageIds || []).join(', ') || '(없음)'}`].join('\n')) : null));
}

async function approve(c, pid, run) {
  const ok = await confirmDialog({ title: '이 스토리를 승인할까요?', body: h('div', { class: 'small stack' }, h('div', null, c.title), h('div', { class: 'muted' }, `승인하면 이 내용이 Story v${c.revision}로 저장됩니다. 승인 자체는 어떤 유료 생성도 시작하지 않습니다.`), c.sample ? h('div', { style: 'color:var(--clay)' }, '이 스토리는 샘플 응답입니다 (실제 AI가 만든 것이 아님).') : null), confirm: '승인' });
  if (ok) run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/approve`), '승인했습니다');
}
async function holdStory(c, pid, run) {
  let reason = '';
  const ok = await confirmDialog({ title: '이 스토리를 보류할까요?', body: h('div', { class: 'small stack' }, c.approved ? h('div', { class: 'banner warn' }, h('div', null, '승인된 스토리입니다. 보류하면 승인이 해제되지만 승인 기록과 승인된 버전은 보존됩니다. 이미 만든 에피소드는 바뀌지 않습니다.')) : null, h('div', { class: 'field' }, h('label', null, '보류 사유 (선택)'), h('input', { type: 'text', oninput: (e) => (reason = e.target.value) }))), confirm: '보류', tone: 'clay' });
  if (ok) run(() => api.post(`/api/storylab/${pid}/concepts/${c.id}/hold`, { reason, confirmApproved: !!c.approved }), '보류했습니다');
}
async function deleteStory(c, pid, run, used) {
  if (used.length) return toast(`이 스토리로 만든 에피소드가 있어 삭제할 수 없습니다: ${used.map((e) => e.displayId || e.id).join(', ')}`, { error: true });
  const ok = await confirmDialog({ title: '이 스토리를 삭제할까요?', body: h('div', { class: 'small stack' }, h('div', null, c.title), c.approved ? h('div', { class: 'banner warn' }, h('div', null, '승인된 스토리입니다. 승인이 해제되며 승인된 버전은 보존됩니다.')) : null, h('div', { class: 'muted' }, '삭제해도 파일은 지워지지 않고 "보관·삭제" 탭에서 복원할 수 있습니다.')), confirm: '삭제', tone: 'clay' });
  if (ok) run(() => api.del(`/api/storylab/${pid}/concepts/${c.id}`, { confirmApproved: !!c.approved }), '삭제했습니다 (복원할 수 있습니다)');
}

function editModal(c, pid, cats) {
  const f = { title: c.title, storyline: c.storyline, maxDurationSec: c.maxDurationSec || 45, category: c.category || '' };
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '스토리 수정'),
    c.approved ? h('div', { class: 'banner warn' }, '승인된 스토리를 수정하면 새 버전(Story v' + (c.revision + 1) + ')이 되고 재승인이 필요합니다. 이전에 승인된 버전과 이미 만든 에피소드는 바뀌지 않습니다.') : null,
    h('div', { class: 'field' }, h('label', null, '제목 (English)'), h('input', { type: 'text', value: f.title, oninput: (e) => (f.title = e.target.value) })),
    h('div', { class: 'field' }, h('label', null, '스토리라인 (English)'), h('textarea', { rows: 8, oninput: (e) => (f.storyline = e.target.value) }, f.storyline)),
    c.ko && c.ko.storyline ? h('div', { class: 'small muted' }, '한국어 번역은 읽기 전용이며, 영문을 고치면 "오래됨"으로 표시됩니다.') : null,
    h('div', { class: 'row' },
      h('label', { class: 'row small', style: 'gap:6px' }, '카테고리', h('select', { onchange: (e) => (f.category = e.target.value) }, cats.filter((o) => !o.fixedCount).map((o) => h('option', { value: o.key, selected: o.key === f.category }, o.ko)))),
      h('label', { class: 'row small', style: 'gap:6px' }, '최대 길이', h('input', { type: 'number', inputmode: 'numeric', min: 10, max: 90, value: f.maxDurationSec, style: 'width:84px', oninput: (e) => (f.maxDurationSec = e.target.value) }), '초')),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api.put(`/api/storylab/${pid}/concepts/${c.id}`, { title: f.title, storyline: f.storyline, maxDurationSec: Number(f.maxDurationSec), category: f.category || undefined }); close(); await act(async () => null, { ok: '저장했습니다 (변경이 있으면 새 버전)' }); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '저장'))));
}

/**
 * Approved story → Script Studio. Never touches an existing episode: when this concept already has one, a NEW episode
 * (a version) is created only after confirmation. The AI script draft is a separate, paid step the operator may skip.
 */
async function handoff(c, pid, used) {
  let newVersion = false;
  if (used.length) {
    const ok = await confirmDialog({ title: '이 컨셉의 에피소드가 이미 있습니다', body: h('div', { class: 'small stack' }, h('div', null, '기존: ' + used.map((e) => e.id).join(', ')), h('div', { class: 'muted' }, '기존 에피소드는 바꾸지 않고, 같은 컨셉으로 새 버전 에피소드를 하나 더 만듭니다.')), confirm: '새 버전 만들기', tone: 'sage' });
    if (!ok) return;
    newVersion = true;
  }
  let ep;
  const requestId = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  const post = (approveEndingCast) => api.post(`/api/storylab/${pid}/concepts/${c.id}/episode`, { newVersion, requestId, approveEndingCast });
  try { ep = await post(false); } catch (e0) {
    if (e0.code !== 'ENDING_CAST_MISMATCH') { return toast(e0.message, { error: true, recovery: e0.recovery }); }
    const okExtra = await confirmDialog({ title: '엔딩에 선택하지 않은 캐릭터가 나옵니다', body: e0.message, confirm: '엔딩 출연을 승인하고 만들기' });
    if (!okExtra) return;
    try { ep = await post(true); } catch (e1) { return toast(e1.message, { error: true, recovery: e1.recovery }); }
  }
  state.episodeId = ep.id;
  toast(`에피소드 ${ep.id}를 만들었습니다 (대본은 아직 승인되지 않았습니다)`);
  let draft = false;
  try {
    const est = await api.post(`/api/episodes/${ep.id}/script/estimate`, {});
    const want = await confirmPaid({ title: 'AI 대본 초안도 지금 만들까요?', est, confirmLabel: '초안 생성', body: h('p', { class: 'small muted', style: 'margin:0' }, '건너뛰면 대본 스튜디오에서 나중에 만들 수 있습니다. 초안을 만들어도 대본 승인 전에는 스토리보드·유료 영상 생성이 열리지 않습니다.') });
    if (want) { await api.post(`/api/episodes/${ep.id}/script/generate`, { confirm: want }); draft = true; }
  } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
  if (draft) toast('대본 초안을 만들었습니다. 검토 후 승인하세요.');
  location.hash = '#/script/' + ep.id;
}
