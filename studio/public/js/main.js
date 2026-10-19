// Router, shell and shared state. Hash routes: #/<view>/<id>   (id = episode, or product for products / storylab)
import { h, icon, toast } from './ui.js';
import { api } from './api.js';
import { state, hooks, refresh, setProduct } from './state.js';
import { overview } from './views/overview.js';
import { products } from './views/products.js';
import { storylab } from './views/storylab.js';
import { characters } from './views/characters.js';
import { episodes } from './views/episodes.js';
import { script } from './views/script.js';
import { storyboard } from './views/storyboard.js';
import { animation } from './views/animation.js';
import { voice } from './views/voice.js';
import { lipsyncStudio } from './views/lipsync-studio.js';
import { render } from './views/render.js';
import { review } from './views/review.js';
import { publishing } from './views/publishing.js';
import { settings, isSettingsTab } from './views/settings.js';
import { guardLeave } from './views/leave-guard.js';
import { startBilingual } from './bilingual.js';
import { episodeHeader } from './views/episode-actions.js';
import { episodeFlow } from './views/episode-flow.js';
import { studioApprovals } from './views/studio-approvals.js';

// [key, ko, en, view, inRail]. Every route keeps working (deep links); only six of them are rail items.
// Production sequence: Product Studio → Story Lab → Episodes (episode workspace: Script → Image → Video → Review → Publishing) → Image Studio → Video Production → Settings.
export const NAV = [
  ['overview', '홈', 'Home', overview, false], // reached through the brand link (not part of the production sequence)
  ['products', '제품 스튜디오', 'Product Studio', products, true],
  ['storylab', '스토리 랩', 'Story Lab', storylab, true],
  ['episodes', '에피소드', 'Episodes', episodes, true],
  ['script', '대본 스튜디오', 'Script Studio', script, false], // lives inside the selected Episode workspace
  ['image', '이미지 스튜디오', 'Image Studio', storyboard, true],
  ['animation', '애니메이션', 'Animation', animation, false], // Video Production tabs …
  ['voice', '보이스', 'Voice', voice, false],
  ['lipsync', '립싱크', 'Lip Sync', lipsyncStudio, false],
  ['render', '편집', 'Editing', render, false],
  ['review', '최종 검토', 'Final Review', review, false], // Episode completion workflow
  ['publishing', '게시', 'Publishing', publishing, false],
  ['settings', '설정', 'Settings', settings, true],
];
// The six sidebar items. 'video' is a pseudo-route (#/video/EP01) that opens the last used Video Production tab.
export const RAIL = [
  ['products', '제품 스튜디오', 'Product Studio'],
  ['storylab', '스토리 랩', 'Story Lab'],
  ['episodes', '에피소드', 'Episodes'],
  ['image', '이미지 스튜디오', 'Image Studio'],
  ['video', '영상 제작', 'Animation · Voice · Lip Sync · Editing'],
  ['settings', '설정', 'Settings'],
];
export const VIDEO_TABS = ['animation', 'voice', 'lipsync', 'render'];
// which rail item a route belongs to (for the active state)
const RAIL_OF = { script: 'episodes', review: 'episodes', publishing: 'episodes', animation: 'video', voice: 'video', lipsync: 'video', render: 'video', autodm: 'settings' };
// old routes keep working: #/storyboard/EP01 → #/image/EP01, #/characters → #/settings/characters, #/autodm/EP01 → #/settings/autodm (Auto DM lives in Settings), #/video/EP01 → last Video Production tab
export const ROUTE_ALIAS = { storyboard: 'image', characters: 'settings', autodm: 'settings', video: 'animation' };
const ICON = { video: 'video', image: 'storyboard' };
const PRODUCT_VIEWS = ['products', 'storylab'];
const EP_HEADER_VIEWS = ['script', 'image', 'animation', 'voice', 'lipsync', 'render', 'review', 'publishing'];
const EPISODE_VIEWS = ['script', 'image', 'animation', 'voice', 'lipsync', 'render', 'review', 'publishing'];
const NO_ID_VIEWS = ['overview', 'episodes', 'settings'];

let poll = null;

function parseHash() {
  let [, view = 'overview', id = ''] = location.hash.split('/');
  const alias = ROUTE_ALIAS[view];
  if (alias) {
    // legacy route: rewrite the address bar in place (no history entry) and keep the episode id
    const was = view;
    if (was === 'characters') { state.settingsTab = 'characters'; id = ''; }
    if (was === 'autodm') { state.settingsTab = 'autodm'; if (id) { state.episodeId = id; state.draft = {}; } id = ''; }
    view = was === 'video' ? (VIDEO_TABS.includes(state.videoTab) ? state.videoTab : 'animation') : alias;
    history.replaceState(null, '', '#/' + view + (id ? '/' + id : view === 'settings' ? '/' + state.settingsTab : ''));
  }
  if (view === 'settings' && id) { if (isSettingsTab(id)) state.settingsTab = id; id = ''; }
  if (VIDEO_TABS.includes(view)) state.videoTab = view;
  return { view: NAV.some((n) => n[0] === view) ? view : 'overview', id };
}
const railKey = () => RAIL_OF[state.view] || state.view;
const active = (key) => railKey() === key;
// catalog pages (Product Studio, Story Lab) always open on the catalog; the editor is reached by clicking an item
const hrefFor = (key) => {
  if (PRODUCT_VIEWS.includes(key)) return '#/' + key;
  if (key === 'video') return '#/video' + (state.episodeId ? '/' + state.episodeId : '');
  return '#/' + key + (state.episodeId && !NO_ID_VIEWS.includes(key) ? '/' + state.episodeId : '');
};

function drawShell() {
  const rail = document.getElementById('rail');
  rail.replaceChildren(
    h('a', { class: 'brand', href: '#/overview', 'aria-label': 'Reels Factory 홈', 'data-brand-home': '' }, h('div', { class: 'brand-mark', html: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>' }), h('div', null, h('b', null, 'Reels Factory'), h('span', null, 'Studio · Jack & Diane'))),
    ...RAIL.flatMap(([key, ko, en]) => [key === 'settings' ? h('div', { class: 'nav-sep' }) : null, h('a', { class: 'nav-item', href: hrefFor(key), 'data-nav': key, 'aria-current': active(key) ? 'page' : null }, icon(ICON[key] || key), h('span', null, h('span', { class: 'ko' }, ko), h('span', { class: 'en' }, en)))]).filter(Boolean),
    h('div', { class: 'rail-foot' }, state.summary ? modePill() : '', authFoot(), state.summary && state.summary.build ? h('div', { class: 'small muted mono', 'data-build': '', title: '지금 실행 중인 코드의 버전 · 커밋 (배포가 최신인지 확인용)' }, `v${state.summary.build.version} · ${state.summary.build.shortSha || '커밋 정보 없음'}`) : null)
  );
  const tabs = document.getElementById('tabbar');
  // phone bottom bar: persistent Home access + the six sidebar items (the sidebar itself is hidden on phones)
  tabs.replaceChildren(...[['overview', '홈']].concat(RAIL.map(([k, ko]) => [k, ko])).map(([k, ko]) => h('button', { 'aria-current': (k === 'overview' ? state.view === 'overview' : active(k)) ? 'page' : null, 'data-tab-nav': k, onclick: () => { location.hash = hrefFor(k); } }, icon(ICON[k] || k), ko.replace(' 스튜디오', ''))));
}

function authFoot() {
  if (!state.auth || !state.auth.authRequired) return '';
  return h('button', { class: 'btn sm ghost', style: 'margin-top:8px;color:#d9ccb8;border-color:rgba(246,241,231,.3)', onclick: async () => { await api.post('/api/logout'); location.reload(); } }, '로그아웃');
}

function modePill() {
  const p = state.summary.providers;
  const v = p.video;
  const ai = (state.summary.ai && state.summary.ai.routing) || [];
  const sample = ai.some((r) => ['storyConcepts', 'scriptWriting'].includes(r.task) && r.provider === 'mock');
  return h('div', null,
    h('div', { class: 'small', style: 'margin-bottom:4px;color:#d9ccb8' }, v.mode === 'mock' ? '영상 목업 · 요금 없음' : '영상 실제 모드 · 유료 호출 가능'),
    sample ? h('div', { class: 'small', style: 'color:#d9ccb8' }, '스토리/대본 AI: 샘플 응답') : null,
    h('div', null, state.episodeId ? '작업 중: ' + state.episodeId : ''));
}

// Re-drawing the view that is already on screen (after a button action, or the 1.5 s job poll) must not flash.
//   * it is built off-screen and swapped in once its server-loaded blocks have arrived (≤ SETTLE_MS), so the "불러오는 중…" placeholder never shows
//   * scroll position and the folds (details[data-fold]) the operator opened are restored
// Navigating to another view keeps the old behaviour: the new view replaces the old one immediately.
const SETTLE_MS = 1200;
let shownKey = '';
let renderToken = 0;
const viewKey = () => [state.view, state.episodeId || '', state.productId || ''].join('|');

function captureUi() {
  return { y: window.scrollY, folds: Array.from(document.querySelectorAll('#stage details[data-fold]')).filter((d) => d.open).map((d) => d.dataset.fold) };
}
function restoreUi(ui) {
  const open = new Set(ui.folds);
  document.querySelectorAll('#stage details[data-fold]').forEach((d) => { if (open.has(d.dataset.fold)) d.open = true; }); // never force a fold shut: the view may want it open
  window.scrollTo({ top: ui.y, left: 0, behavior: 'instant' });
}
function whenSettled(root, ms, done) {
  const t0 = Date.now();
  const check = () => { if (!root.querySelector('.boot') || Date.now() - t0 >= ms) done(); else setTimeout(check, 30); };
  check();
}

export function rerender() {
  const token = ++renderToken;
  const key = viewKey();
  drawShell();
  const stage = document.getElementById('stage');
  const nav = NAV.find((n) => n[0] === state.view);
  const inPlace = key === shownKey && stage.children.length > 0 && !stage.querySelector(':scope > .boot');
  const target = inPlace ? document.createElement('div') : stage;
  const ui = inPlace ? captureUi() : null;
  if (!inPlace) stage.replaceChildren();
  try {
    if (state.episode && EP_HEADER_VIEWS.includes(state.view)) { const eh = episodeHeader(state.episode); if (eh) target.append(eh); }
    if (state.episode && EPISODE_VIEWS.includes(state.view)) target.append(episodeFlow(state.view, state.episode));
    if (state.episode && EPISODE_VIEWS.includes(state.view)) { const approvals = studioApprovals(state.view, state.episode); if (approvals) target.append(approvals); }
    target.append(nav[3](state));
  } catch (e) {
    console.error(e);
    target.append(h('div', { class: 'banner err' }, h('div', null, h('b', null, '화면을 그리지 못했습니다'), e.message)));
  }
  const finish = () => { schedulePoll(); placeActionBar(); };
  shownKey = key;
  if (!inPlace) return finish();
  whenSettled(target, SETTLE_MS, () => {
    if (token !== renderToken) return; // a newer render took over
    stage.replaceChildren(...Array.from(target.childNodes));
    restoreUi(ui);
    finish();
  });
}

function schedulePoll() {
  clearTimeout(poll);
  const ep = state.episode;
  const busy = ep && (ep.derived.jobsRunning || (ep.derived.render.job && ep.derived.render.job.status === 'running'));
  if (busy && ['animation', 'voice', 'lipsync', 'render', 'review', 'overview', 'image'].includes(state.view)) {
    poll = setTimeout(async () => {
      try {
        const activeEl = document.activeElement;
        await refresh();
        if (!(activeEl && /INPUT|TEXTAREA|SELECT/.test(activeEl.tagName))) rerender();
        else schedulePoll();
      } catch (e) { schedulePoll(); }
    }, 1500);
  }
}

function loginScreen() {
  const stage = document.getElementById('stage');
  document.getElementById('rail').replaceChildren();
  document.getElementById('tabbar').replaceChildren();
  const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '관리자 비밀번호', 'aria-label': '관리자 비밀번호' });
  const err = h('div', { class: 'small', style: 'color:var(--rose);min-height:1.4em' });
  const submit = async () => {
    try { await api.post('/api/login', { password: pw.value }); location.reload(); } catch (e) { err.textContent = e.message; }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  stage.replaceChildren(h('div', { class: 'card stack', style: 'max-width:380px;margin:12vh auto 0' }, h('h1', null, 'Reels Factory Studio'), h('p', { class: 'muted', style: 'margin:0' }, '이 스튜디오는 비밀번호로 보호됩니다.'), pw, err, h('button', { class: 'btn', onclick: submit }, '로그인')));
  pw.focus();
}

async function route() {
  if (state.auth === undefined) {
    try { state.auth = await api.get('/api/session'); } catch (e) { state.auth = { authRequired: false, authenticated: true }; }
  }
  if (state.auth.authRequired && !state.auth.authenticated) return loginScreen();
  const { view, id } = parseHash();
  state.view = view;
  if (PRODUCT_VIEWS.includes(view)) {
    if (id) setProduct(id); // only an explicit product in the address opens an editor; the bare route is the catalog
    try { await refresh(); } catch (e) { if (!state.summary) throw e; toast(e.message, { error: true }); }
  } else if (id && id !== state.episodeId) {
    state.episodeId = id;
    state.draft = {};
    try { await refresh(); } catch (e) { toast(e.message, { error: true }); }
  } else {
    // Always re-read the server state on navigation (another tab/device or a long-running job may have changed it).
    try { await refresh(); } catch (e) { if (!state.summary) throw e; toast(e.message, { error: true }); }
  }
  rerender();
  document.getElementById('stage').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

hooks.rerender = rerender;
// iPhone Safari: keep the sticky action bar above the tab bar (safe area) and above the on-screen keyboard (visualViewport).
function placeActionBar() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const tab = document.getElementById('tabbar');
  const tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.offsetHeight : 0;
  const root = document.documentElement.style;
  root.setProperty('--kb', kb + 'px');
  root.setProperty('--bar-bottom', (kb > 80 ? kb : tabH) + 'px');
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', placeActionBar); window.visualViewport.addEventListener('scroll', placeActionBar); }
window.addEventListener('resize', placeActionBar);
placeActionBar();
startBilingual(placeActionBar);
// Leaving the editor with unsaved edits: keep the current page and ask (save / discard / stay). beforeunload covers closing the tab.
let lastHash = location.hash;
let reverting = false;
window.addEventListener('hashchange', async () => {
  if (reverting) { reverting = false; lastHash = location.hash; return; }
  const target = location.hash;
  if (state.leaveGuard && state.leaveGuard.dirty()) {
    reverting = true;
    location.hash = lastHash;
    const go = await guardLeave({ dirty: true, what: '다른 화면으로', save: state.leaveGuard.save });
    if (!go) return;
    state.leaveGuard = null;
    reverting = false;
    location.hash = target;
    lastHash = target;
    return;
  }
  lastHash = target;
  if (state.view !== 'script') state.leaveGuard = null;
  route();
});
window.addEventListener('beforeunload', (e) => { if (state.leaveGuard && state.leaveGuard.dirty()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('rf-login-required', () => { state.auth = { authRequired: true, authenticated: false }; loginScreen(); });
route().catch((e) => {
  document.getElementById('stage').replaceChildren(h('div', { class: 'banner err' }, h('div', null, h('b', null, '서버에 연결하지 못했습니다'), e.message, h('div', { class: 'small' }, '서버가 실행 중인지 확인하세요 (로컬: node studio/server.js · 클라우드: 배포 상태와 /healthz).'))));
});
