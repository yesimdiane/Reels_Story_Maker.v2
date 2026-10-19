import { h, chip, stateLabel, icon, modal, fmtUsd, toast } from '../ui.js';
import { state, go, selectEpisode } from '../state.js';
import { api } from '../api.js';
import { refTile, openFull } from './ref-gallery.js';

export const VIEW_FOR_STEP = { product: 'products', concept: 'storylab', script: 'script', approval: 'script', storyboard: 'image', estimate: 'animation', animation: 'animation', clips: 'animation', voice: 'voice', render: 'render', review: 'review', publish: 'publishing' };
const NEXT_LABEL = {
  product: '제품·참조 이미지 준비', concept: '스토리 컨셉 승인하기', script: '대본 완성하기', approval: '대본 승인하기', storyboard: '스토리보드 승인하기', estimate: '비용 확인하고 생성 승인', animation: '애니메이션 생성하기',
  clips: '클립 검토·승인', voice: '음성 생성하기', render: '렌더 시작하기', review: '최종 영상 승인하기', publish: '캡션·ManyChat 승인하기',
};

export function nextStep(ep) {
  return ep.derived.steps.find((s) => s.state !== 'done' && s.state !== 'blocked') || ep.derived.steps.find((s) => s.state !== 'done') || null;
}
export const nextLabel = (s) => (s ? NEXT_LABEL[s.key] : '모든 단계 완료');

export function pageHead(eyebrow, title, desc, ...actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, eyebrow), h('h1', null, title), desc && h('p', null, desc)), h('div', { class: 'row' }, actions));
}

export function pipelineBar(ep, { current } = {}) {
  return h('div', { class: 'pipe', role: 'list', 'aria-label': '제작 단계' }, ep.derived.steps.map((s, i) => h('a', {
    class: 'pipe-step ' + s.state, role: 'listitem', href: '#/' + VIEW_FOR_STEP[s.key] + '/' + (['product', 'concept'].includes(s.key) && ep.productId ? ep.productId : ep.id), title: s.labelEn + ' — ' + stateLabel[s.state],
  }, h('span', { class: 'no' }, String(i + 1).padStart(2, '0')), h('b', null, s.label), h('small', null, s.detail || stateLabel[s.state]))));
}

export function modeBanner(summary) {
  const v = summary.providers.video;
  const vc = summary.providers.voice;
  const notes = [];
  if (v.liveWithoutKey) notes.push('영상: 실제 모드가 요청됐지만 Muapi 키가 없어 목업으로 동작 중입니다.');
  if (vc.liveWithoutKey) notes.push('음성: 실제 모드가 요청됐지만 HeyGen 키가 없어 목업으로 동작 중입니다.');
  const warn = notes.length ? h('div', { class: 'banner warn' }, icon('lock'), h('div', null, h('b', null, '키 없이 실제 모드가 요청되었습니다 — 실제 호출은 하지 않습니다'), notes.join(' '), ' ', h('a', { href: '#/settings' }, 'Settings → AI 연동'))) : null;
  if (v.mode === 'mock') {
    return h('div', { class: 'stack', style: 'gap:10px' }, warn, h('div', { class: 'banner mock' }, chip('MOCK', 'mock'), h('div', null, h('b', null, '영상 목업 모드 — 실제 호출·요금이 없습니다'), '생성되는 클립은 확인용 임시 영상입니다. 실제(유료) 영상 생성은 Settings → AI 연동에서 Muapi 키를 저장하고 LIVE 확인을 거친 뒤에만 켜집니다. 켜도 모든 유료 호출은 비용을 확인·승인해야 실행됩니다.')));
  }
  return h('div', { class: 'stack', style: 'gap:10px' }, warn, h('div', { class: 'banner live' }, chip('LIVE', 'live'), h('div', null, h('b', null, '영상 실제 모드 — 유료 호출이 가능합니다'), '비용 확인과 명시적 승인 없이는 어떤 생성도 실행되지 않습니다. 실패한 유료 작업은 자동으로 다시 실행되지 않습니다.')));
}

/** Video Production tabs: Animation → Voice → Lip Sync → Editing (production order after the images). Shown at the top of each of the four studios. */
export function videoTabs(active) {
  const tabs = [['animation', '1. 애니메이션', 'Animation'], ['voice', '2. 보이스', 'Voice'], ['lipsync', '3. 립싱크', 'Lip Sync'], ['render', '4. 편집', 'Editing']];
  return h('div', { class: 'seg video-tabs', 'data-no-en': '', role: 'tablist', 'aria-label': '영상 제작 단계', 'data-video-tabs': '' }, tabs.map(([k, label, en]) => h('button', { role: 'tab', 'data-video-tab': k, title: en, 'aria-pressed': active === k ? 'true' : 'false', 'aria-selected': active === k ? 'true' : 'false', onclick: () => { location.hash = '#/' + k + (state.episodeId ? '/' + state.episodeId : ''); } }, label)));
}

/**
 * Per-generation confirmation for AI calls. est = router estimate { provider, model, mock, usd, note }.
 * Resolves to null (cancelled) or the `confirm` object the API expects. Mock (sample) routes need no confirmation.
 */
/**
 * Busy state for a button that starts a slow (or paid) request: disabled + a progress label while it runs, restored afterwards.
 * Keeps the button's own children (icons) and its original disabled state. `begin()` returns false when it is already busy.
 */
export function busyButton(btn) {
  const kids = Array.from(btn.childNodes);
  const wasDisabled = btn.disabled;
  return {
    begin(label) {
      if (btn.getAttribute('aria-busy') === 'true') return false;
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.replaceChildren(label);
      return true;
    },
    label(text) { btn.replaceChildren(text); },
    end() { btn.disabled = wasDisabled; btn.removeAttribute('aria-busy'); btn.replaceChildren(...kids); },
  };
}

export function confirmPaid({ title, est, body, confirmLabel = '실행' }) {
  if (est && est.mock) return Promise.resolve({});
  return new Promise((resolve) => {
    let unknown = false;
    const go = h('button', { class: 'btn clay', disabled: est.usd == null, onclick: () => { close(); resolve({ paid: true, unknownCost: unknown }); } }, confirmLabel);
    const close = modal((closeFn) => h('div', { class: 'stack' },
      h('h2', null, title),
      body || null,
      h('div', { class: 'card flat' },
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, '제공자 / 모델'), h('b', { class: 'mono' }, est.provider + ' / ' + (est.model || '(모델 미선택)'))),
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, '예상 비용 (추정)'), h('b', null, est.usd == null ? '알 수 없음' : fmtUsd(est.usd)))),
      h('p', { class: 'small muted', style: 'margin:0' }, (est.note || '') + ' 이 값은 직접 입력한 가격 기준의 추정치이며 실제 청구서가 아닙니다. 외부 AI 호출은 요금이 청구될 수 있습니다.'),
      est.usd == null ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', onchange: (e) => { unknown = e.target.checked; go.disabled = !unknown; } }), '가격을 모르는 상태로 진행합니다 (Settings → AI 연동에서 가격을 입력하면 한도 검사가 정확해집니다)') : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { closeFn(); resolve(null); } }, '취소'), go)));
  });
}

/** Run an async loader, show a placeholder, then draw. Keeps views synchronous for the router. */
export function asyncBlock(loader, draw, { label = '불러오는 중…' } = {}) {
  const box = h('div', null, h('div', { class: 'boot' }, label));
  loader().then((data) => box.replaceChildren(draw(data)), (e) => box.replaceChildren(h('div', { class: 'banner err' }, h('div', null, h('b', null, '불러오지 못했습니다'), e.message, e.recovery ? h('div', { class: 'small' }, '→ ' + e.recovery) : null))));
  return box;
}

export function noEpisode() {
  return h('div', { class: 'empty' }, h('h2', null, '에피소드가 없습니다'), h('p', null, '에피소드 메뉴에서 새 에피소드를 만드세요.'), h('button', { class: 'btn', onclick: () => go('episodes') }, '에피소드로 이동'));
}

export function episodePicker() {
  const s = state.summary;
  const live = s ? s.episodes.filter((e) => !e.archived) : [];
  if (!s || live.length < 2) return null;
  return h('select', { 'aria-label': '에피소드 선택', style: 'width:auto;padding:7px 12px;border-radius:999px', onchange: (e) => { selectEpisode(e.target.value).then(() => { location.hash = '#/' + state.view + '/' + state.episodeId; }); } }, live.map((e) => h('option', { value: e.id, selected: e.id === state.episodeId }, e.id + ' · ' + e.title.slice(0, 22))));
}

export function issueList(items, kind = 'err') {
  if (!items || !items.length) return null;
  return h('div', { class: 'stack', style: 'gap:8px' }, items.map((i) => h('div', { class: 'issue ' + kind }, i.message, i.recovery && h('div', { class: 'fix' }, '→ ' + i.recovery))));
}

export function charAvatar(c, big) {
  const ref = c.references && (c.references.find((r) => r.approved) || c.references[0]);
  return h('div', { class: 'avatar ' + c.id + (big ? ' lg' : '') }, ref ? h('img', { src: ref.url, alt: c.name }) : c.name[0]);
}

export function lockedNotice(text, view, label) {
  return h('div', { class: 'banner warn' }, icon('lock'), h('div', null, text, ' ', view && h('a', { href: '#/' + view + '/' + state.episodeId }, label || '이동')));
}

/** Approved product reference images that travelled with the episode from Product Studio (read-only strip). */
export function productRefStrip(ep) {
  const imgs = ep.productRefImages || [];
  if (!ep.productId) return null;
  if (!imgs.length) return h('div', { class: 'small muted' }, ep.productRefs && ep.productRefs.waived ? '제품 참조 이미지 없이 진행(사유 기록됨): ' + ep.productRefs.waived : '이 에피소드에는 연결된 제품 참조 이미지가 없습니다.');
  return h('div', { class: 'card stack', style: 'gap:8px' },
    h('div', { class: 'row between' }, h('b', null, '승인된 제품 참조 이미지'), h('a', { class: 'small', href: '#/products/' + ep.productId }, 'Product Studio에서 보기')),
    h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, imgs.map((im) => h('figure', { style: 'margin:0;width:96px' }, h('img', { src: im.url, alt: im.label || '제품 참조', style: 'width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--line)' }), h('figcaption', { class: 'small muted' }, im.kindLabel || im.kind)))),
    h('div', { class: 'small muted' }, '장면 프롬프트와 시작 이미지를 정할 때 제품의 모양·색·기능은 이 승인된 이미지를 기준으로 하세요.'));
}

/**
 * "시작 이미지 만들기": AI start frames for the given scenes (all scenes when sceneIds is empty).
 * Shows the cost, needs explicit confirmation, saves UNAPPROVED frames that the operator approves one by one.
 */
/**
 * Over the model's image-input limit: nothing is trimmed for the user. This dialog lists every reference that would be sent (by filename) and lets
 * the user deselect some FOR THIS REQUEST ONLY. Resolves with the assetIds to exclude, or null when cancelled. The Character Library is not touched.
 */
export function refLimitDialog(d, pre = []) {
  return new Promise((resolve) => {
    const ex = new Set(pre);
    const max = d.limit && d.limit.maxImages;
    modal((close) => {
      const body = h('div', { class: 'stack', style: 'gap:10px' });
      const draw = () => {
        const kept = d.refs.filter((r) => !ex.has(r.assetId));
        const perChar = {}; d.refs.filter((r) => r.type === 'character').forEach((r) => { perChar[r.characterId] = (perChar[r.characterId] || 0) + (ex.has(r.assetId) ? 0 : 1); });
        const emptyChar = Object.keys(perChar).find((k) => perChar[k] === 0);
        const productAll = d.refs.some((r) => r.type === 'product') && !d.refs.some((r) => r.type === 'product' && !ex.has(r.assetId));
        const ok = (max == null || kept.length <= max) && !emptyChar && !productAll;
        const group = (title, list) => list.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('b', { class: 'small' }, title), h('div', { class: 'ref-compact-grid' }, list.map((r) => refTile({ id: r.assetId, url: r.url, filename: r.filename, selected: !ex.has(r.assetId), onOpen: () => openFull(r.url, r.filename), onToggle: () => { if (ex.has(r.assetId)) ex.delete(r.assetId); else ex.add(r.assetId); draw(); } })))) : null;
        const chars = [...new Set(d.refs.filter((r) => r.type === 'character').map((r) => r.characterId))];
        body.replaceChildren(
          h('div', { class: 'issue warn', 'data-ref-limit-warning': '' }, `선택한 참조 이미지 ${kept.length}장 / 이 모델의 한도 ${max}장${d.limit && d.limit.model ? ' (' + d.limit.model + ')' : ''}. ${kept.length > max ? (kept.length - max) + '장 더 선택 해제해야 합니다.' : '한도 안입니다.'}`),
          h('div', { class: 'small muted' }, '체크를 해제한 이미지는 이번 요청에서만 빠집니다. 캐릭터 라이브러리의 선택은 바뀌지 않고, 자동으로 빼거나 다른 이미지로 바꾸지 않습니다. 각 캐릭터는 최소 1장, 제품은 최소 1장이 남아야 합니다.'),
          ...chars.map((cid) => group(`${(d.refs.find((r) => r.characterId === cid) || {}).name} · 선택 ${perChar[cid]}장`, d.refs.filter((r) => r.type === 'character' && r.characterId === cid))),
          group(`제품 참조 · ${d.refs.filter((r) => r.type === 'product' && !ex.has(r.assetId)).length}장`, d.refs.filter((r) => r.type === 'product')),
          h('div', { class: 'row end', style: 'gap:8px' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); resolve(null); } }, '취소'), h('button', { class: 'btn sage', type: 'button', 'data-ref-limit-apply': '', disabled: !ok, onclick: () => { close(); resolve([...ex]); } }, '이 요청에 적용')));
      };
      draw();
      return h('div', { class: 'stack' }, h('h2', { style: 'margin:0' }, '참조 이미지가 모델 한도를 넘습니다'), body);
    });
  });
}

export async function makeStartImages(ep, sceneIds = [], { force = false, after } = {}) {
  const route = ((state.summary.ai || {}).routing || []).find((r) => r.task === 'imageGeneration') || { provider: 'mock' };
  if (!ep.derived.scriptApproved) return toast('대본을 먼저 승인하세요. (유료 이미지 생성은 대본 승인 후에만 가능합니다)', { error: true });
  if (route.provider !== 'gemini') return toast('이미지 생성 제공자가 연결되지 않았습니다. Settings → AI 연동에서 Gemini 키와 이미지 생성 모델을 "제품 이미지 생성" 작업에 지정하세요.', { error: true });
  let est; let exclude = [];
  for (;;) {
    try { est = await api.post(`/api/episodes/${ep.id}/start-images/estimate`, { sceneIds, force, exclude }); break; } catch (e) {
      if (e.code === 'REF_LIMIT_EXCEEDED' && e.details && e.details.refs) { const r = await refLimitDialog(e.details, exclude); if (!r) return; exclude = r; continue; }
      return toast(e.message, { error: true, recovery: e.recovery });
    }
  }
  if (!est.count) return toast(est.skipped && est.skipped.length ? '새로 만들 장면이 없습니다: ' + est.skipped.map((x) => x.sceneId + ' (' + x.reason + ')').join(' / ') : '만들 장면이 없습니다.');
  const c = await confirmPaid({ title: `장면 ${est.count}개 시작 이미지 만들기 (유료일 수 있음)`, est, confirmLabel: '생성',
    body: h('div', { class: 'small stack', style: 'gap:6px' },
      h('div', null, '장면: ' + est.scenes.map((s) => s.sceneId).join(', ')),
      est.skipped.length ? h('div', { class: 'muted' }, '건너뜀: ' + est.skipped.map((x) => x.sceneId).join(', ') + ' (이미 승인되었거나 AI 프레임이 있음)') : null,
      h('div', { class: 'muted' }, '만들어진 이미지는 "미승인" 상태로 저장됩니다. 스토리보드에서 하나씩 확인하고 승인해야 영상 생성에 쓰입니다.')) });
  if (!c) return;
  try {
    const v = await api.post(`/api/episodes/${ep.id}/start-images/generate`, { sceneIds, force, confirm: c, exclude });
    const r = v.startImageResult || { generated: [], skipped: [], failed: null };
    if (r.failed) toast(`${r.generated.length}개 만들었고 ${r.failed.sceneId}에서 멈췄습니다: ${r.failed.message}`, { error: true, recovery: r.failed.recovery });
    else { const repeats = r.generated.filter((x) => x.sameAsPrevious); toast(`시작 이미지 ${r.generated.length}개를 만들었습니다.${repeats.length ? ' ⚠ 이전 이미지와 완전히 동일한 결과: ' + repeats.map((x) => x.sceneId).join(', ') + '. 새 API 요청은 실행되었습니다.' : ' 새 API 요청 완료.'} 스토리보드에서 확인 후 승인하세요.`); }
  } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
  if (after) await after();
}

/** Scene navigation: one chip per scene, "S1 · 영국인의 자신감", jumping to that scene's card (id = prefix + sceneId). */
export function sceneNav(ep, prefix, { badges = false, onJump = null } = {}) {
  if (!(ep.scenes || []).length) return null;
  return h('nav', { 'aria-label': '장면 이동', class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ep.scenes.map((sc) => {
    const t = sc.title_ko || sc.title || '';
    const ap = badges ? sc.approval : null;
    const badge = !ap ? null : ap.approved ? h('span', { class: 'tab-badge ok', title: `승인됨 (r${ap.revision})` }, '✓')
      : ap.errorCount ? h('span', { class: 'tab-badge err', title: `고쳐야 할 항목 ${ap.errorCount}개` }, String(ap.errorCount))
      : ap.editedAfterApproval ? h('span', { class: 'tab-badge stale', title: '승인 후 수정됨 — 다시 승인 필요' }, '↻')
      : ap.status === 'ready' ? h('span', { class: 'tab-badge ready', title: '승인 가능' }, '○')
      : h('span', { class: 'tab-badge draft', title: ap.label }, '·');
    return h('button', { class: 'btn sm ghost scene-tab' + (ap && ap.approved ? ' approved' : '') + (ap && ap.errorCount ? ' has-err' : ''), 'data-scene-tab': sc.id, title: t + (ap ? ' · ' + ap.label : ''), onclick: () => { const el = document.getElementById(prefix + sc.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } if (onJump) onJump(sc); } }, sc.id + ' · ' + (t.length > 14 ? t.slice(0, 13) + '…' : t) + (sc.titleKoMissing ? ' ⚠' : ''), badge);
  }));
}

/**
 * A preview <img> that never fails silently: shows a loading state, and on error asks the server (a free HEAD request) why,
 * then offers "미리보기 다시 불러오기" which only re-fetches the picture. It never regenerates anything or spends money.
 */
export function previewImage({ url, alt = '', cls = '', style = '', tag = '', compact = false, attrs = {} }) {
  const box = h('div', Object.assign({ class: 'preview-box ' + cls, 'data-preview': tag || '', style: 'position:relative;' + style }, attrs));
  let tries = 0;
  const load = () => {
    box.replaceChildren();
    const img = h('img', { class: cls, alt, style: 'width:100%;height:100%;object-fit:inherit;border-radius:inherit;display:block' });
    const note = h('div', { class: 'small muted', 'data-preview-loading': '', style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center' }, '불러오는 중…');
    img.addEventListener('load', () => { note.remove(); box.setAttribute('data-preview-state', 'ok'); });
    img.addEventListener('error', async () => {
      note.remove(); img.remove();
      box.setAttribute('data-preview-state', 'error');
      let why = '이미지를 불러오지 못했습니다.';
      try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (r.status === 404) why = '서버에서 이미지 파일을 찾을 수 없습니다 (파일이 지워졌거나 저장소가 초기화되었을 수 있습니다). 승인 기록은 그대로입니다.';
        else if (r.status === 401 || r.status === 403) why = '접근 권한이 없습니다. 다시 로그인한 뒤 새로 불러오세요.';
        else if (r.status >= 500) why = '서버 오류(' + r.status + ')로 이미지를 읽지 못했습니다.';
        else if (r.ok) why = '파일은 있지만 브라우저가 그림으로 읽지 못했습니다 (손상된 파일일 수 있습니다).';
        else why = '이미지 요청이 실패했습니다 (' + r.status + ').';
      } catch (_) { why = '서버에 연결하지 못했습니다. 네트워크를 확인하세요.'; }
      if (compact) { box.append(h('button', { class: 'btn sm ghost', type: 'button', 'data-preview-error': '', 'data-preview-retry': '', title: why + ' — 눌러서 미리보기만 다시 불러옵니다 (생성·비용 없음)', style: 'width:100%;height:100%;padding:2px;font-size:11px', onclick: (e) => { e.stopPropagation(); tries++; load(); } }, '⚠ 다시')); return; }
      box.append(h('div', { class: 'stack small', 'data-preview-error': '', style: 'gap:6px;padding:10px;align-items:center;text-align:center' }, h('span', null, why),
        h('button', { class: 'btn sm ghost', type: 'button', 'data-preview-retry': '', onclick: (e) => { e.stopPropagation(); tries++; load(); } }, '미리보기 다시 불러오기'),
        h('span', { class: 'muted' }, '이 버튼은 그림만 다시 불러옵니다. 새로 생성하지 않으며 비용이 들지 않습니다.')));
    });
    box.append(img, note);
    img.src = url + (tries ? (url.includes('?') ? '&' : '?') + 'r=' + Date.now() : '');
  };
  load();
  return box;
}
