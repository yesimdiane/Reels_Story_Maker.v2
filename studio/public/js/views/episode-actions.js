// Episode / script-version management: a compact ⋯ menu, 삭제 (soft, restorable), 복제, 보관, 대본 버전 관리.
// Nothing here removes files: the server hides items (trash / archive / deleted version) and keeps every linked asset.
import { h, icon, chip, modal, toast, confirmDialog, fmtUsd } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

let openMenu = null;
const closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target) && !(e.target.closest && e.target.closest('[data-kebab]'))) closeMenu(); }, true);
window.addEventListener('hashchange', closeMenu);
window.addEventListener('resize', closeMenu);

/**
 * ⋯ button. The menu is rendered on <body> (fixed), so cards with overflow:hidden never clip it; on phones it becomes a bottom sheet with
 * large tap targets (iOS Safari: no hover, no :focus reliance, 44px rows, safe-area padding).
 * items: [{ label, onClick, danger?, hint?, disabled?, key? }]
 */
export function kebab({ label = '더보기', items, id }) {
  const btn = h('button', { type: 'button', class: 'btn icon ghost kebab-btn', 'data-kebab': id || '', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: label }, '⋯');
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (openMenu && openMenu.dataset.owner === btn.dataset.kebab && openMenu.dataset.owner) { closeMenu(); btn.setAttribute('aria-expanded', 'false'); return; }
    closeMenu();
    const menu = h('div', { class: 'kebab-menu', role: 'menu', 'data-owner': id || '' },
      items.filter(Boolean).map((it) => h('button', { type: 'button', role: 'menuitem', class: 'kebab-item' + (it.danger ? ' danger' : ''), disabled: it.disabled, 'data-menu-key': it.key || '', onclick: (e) => { e.stopPropagation(); closeMenu(); btn.setAttribute('aria-expanded', 'false'); it.onClick(); } },
        h('span', null, it.label), it.hint ? h('span', { class: 'kebab-hint' }, it.hint) : null)),
      h('button', { type: 'button', class: 'kebab-item kebab-cancel', onclick: () => { closeMenu(); btn.setAttribute('aria-expanded', 'false'); } }, '닫기'));
    document.body.append(menu);
    openMenu = menu;
    btn.setAttribute('aria-expanded', 'true');
    if (window.matchMedia('(max-width: 640px)').matches) { menu.classList.add('sheet'); return; }
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth; const mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
    menu.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  });
  return btn;
}

const refresh = () => act(async () => null);

// ---------------- episode ----------------
export function episodeMenu(e, { archivedView = false } = {}) {
  return kebab({ id: 'ep-' + e.id, label: `${e.id} 메뉴`, items: [
    { key: 'duplicate', label: '에피소드 복제', hint: '대본만 새로 복사 (승인·영상은 복사 안 함)', onClick: () => duplicateEpisode(e) },
    archivedView ? { key: 'unarchive', label: '보관 해제', onClick: () => unarchiveEpisode(e) } : { key: 'archive', label: '에피소드 보관', hint: '목록에서만 치웁니다 (삭제 아님)', onClick: () => archiveEpisode(e) },
    { key: 'rename', label: '제목 수정', onClick: () => editTitle(e) },
    e.onHold ? { key: 'resume', label: '보류 해제', hint: '유료 생성을 다시 허용', onClick: () => resumeEpisode(e) } : { key: 'hold', label: '에피소드 보류', hint: '삭제 없이 멈춤 · 유료 생성 차단', onClick: () => holdEpisode(e) },
    { key: 'versions', label: '대본 버전 관리', hint: '버전 삭제·복원', onClick: () => versionManager(e) },
    { key: 'delete', label: '에피소드 삭제', hint: '휴지통으로 이동 (복원 가능)', danger: true, onClick: () => deleteEpisode(e) },
  ] });
}

async function duplicateEpisode(e) {
  let title = '';
  const ok = await confirmDialog({ title: `"${e.title}" 에피소드를 복제할까요?`, body: h('div', { class: 'stack small', style: 'gap:8px' },
    h('div', null, '대본(씬·대사·CTA)만 독립된 새 에피소드로 복사합니다. 승인 기록, 이미지, 영상, 음성, 렌더, 지출은 복사하지 않으며 원본은 바뀌지 않습니다.'),
    h('div', { class: 'field' }, h('label', null, '복제본 이름 (비워 두면 자동)'), h('input', { type: 'text', oninput: (ev) => (title = ev.target.value) }))), confirm: '복제', tone: 'sage' });
  if (!ok) return;
  try { const r = await api.post(`/api/episodes/${e.id}/duplicate`, { title }); toast(`${r.duplicatedId || '복제본'}을 만들었습니다`); await refresh(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
}

async function editTitle(e) {
  let title = e.title;
  const ok = await confirmDialog({ title: '에피소드 제목 수정', body: h('div', { class: 'stack small', style: 'gap:8px' }, h('div', { class: 'muted' }, '제목만 바뀝니다. 에피소드 코드, 스토리, 대본, 자료는 그대로입니다.'), h('div', { class: 'field' }, h('input', { type: 'text', value: e.title, 'aria-label': '제목', 'data-edit-title': '', oninput: (ev) => (title = ev.target.value) }))), confirm: '저장', tone: 'sage' });
  if (!ok) return;
  try { await api.put(`/api/episodes/${e.id}/meta`, { title }); toast('저장했습니다'); await refresh(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
}
async function holdEpisode(e) {
  let reason = '';
  const ok = await confirmDialog({ title: `"${e.title}" 에피소드를 보류할까요?`, body: h('div', { class: 'stack small', style: 'gap:8px' }, h('div', null, '삭제가 아닙니다. 모든 자료는 그대로 두고, 보류를 해제할 때까지 유료 생성(AI 대본·이미지·영상)만 막습니다.'), h('div', { class: 'field' }, h('label', null, '사유 (선택)'), h('input', { type: 'text', oninput: (ev) => (reason = ev.target.value) }))), confirm: '보류', tone: 'clay' });
  if (!ok) return;
  try { await api.post(`/api/episodes/${e.id}/hold`, { reason }); toast('보류했습니다'); await refresh(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
}
async function resumeEpisode(e) {
  try { await api.post(`/api/episodes/${e.id}/resume`); toast('보류를 해제했습니다'); await refresh(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
}

async function archiveEpisode(e) {
  const ok = await confirmDialog({ title: `"${e.title}" 에피소드를 보관할까요?`, body: h('div', { class: 'small' }, '삭제가 아닙니다. 작업 목록에서만 치우고, 대본·영상·승인 기록은 그대로 두며 "보관됨"에서 언제든 되돌릴 수 있습니다.'), confirm: '보관', tone: 'sage' });
  if (!ok) return;
  try { await api.post(`/api/episodes/${e.id}/archive`); if (state.episodeId === e.id) state.episodeId = ''; toast('보관했습니다'); await refresh(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
}
async function unarchiveEpisode(e) {
  try { await api.post(`/api/episodes/${e.id}/unarchive`); toast('보관을 해제했습니다'); await refresh(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
}

const row = (label, value, note) => h('div', { class: 'impact-row' }, h('span', { class: 'impact-k' }, label), h('span', { class: 'impact-v' }, value, note ? h('span', { class: 'small muted' }, ' ' + note) : null));

/** 삭제 = 휴지통. Shows exactly which scripts, storyboards, images and videos belong to the episode before anything moves. */
export async function deleteEpisode(e) {
  let imp;
  try { imp = await api.get(`/api/episodes/${e.id}/impact`); } catch (err) { return toast(err.message, { error: true, recovery: err.recovery }); }
  if (imp.busy) return toast('영상 생성이나 렌더링이 진행 중인 에피소드는 지울 수 없습니다. 끝난 뒤 다시 시도하세요.', { error: true });
  let sure = false;
  const go = h('button', { class: 'btn clay', type: 'button', disabled: imp.requiresApprovedConfirm, 'data-confirm-delete': '' }, '휴지통으로 이동');
  modal((close) => {
    go.onclick = async () => {
      go.disabled = true;
      try {
        await api.del('/api/episodes/' + e.id, { confirmPublished: !!imp.published && sure, confirmApproved: sure });
        if (state.episodeId === e.id) state.episodeId = '';
        close(); toast('휴지통으로 옮겼습니다'); await refresh();
      } catch (err) { go.disabled = false; toast(err.message, { error: true, recovery: err.recovery }); }
    };
    return h('div', { class: 'stack', style: 'gap:12px' },
      h('h2', null, `"${imp.title}" 에피소드를 삭제할까요?`),
      h('div', { class: 'small' }, '삭제하면 휴지통으로 이동합니다. 아래 항목은 파일이 지워지지 않고 이 에피소드와 함께 목록에서 숨겨지며, 복원하면 그대로 돌아옵니다.'),
      h('div', { class: 'card flat impact', 'data-impact': '' },
        h('div', { class: 'impact-h' }, '함께 영향 받는 항목'),
        row('대본', `${imp.scripts.versions}개 버전 · ${imp.scripts.scenes}개 씬 · ${imp.scripts.lines}개 대사`, imp.scripts.approved.length ? '(승인된 적 있음: ' + imp.scripts.approved.map((n) => 'v' + n).join(', ') + ')' : ''),
        row('스토리보드', `프롬프트 ${imp.storyboards.prompts}개`, imp.storyboards.approved ? '(승인됨)' : ''),
        row('이미지', `시작 이미지 ${imp.images.startImages}개`, imp.images.startImages ? `(승인 ${imp.images.approvedStartImages}개)` : ''),
        row('영상', `클립 ${imp.videos.clipVersions}개 · 렌더 ${imp.videos.renders}개 · 음성 ${imp.videos.voiceLines}줄`, imp.videos.finalApproved ? '(최종 승인됨)' : imp.videos.approvedClips ? `(승인 클립 ${imp.videos.approvedClips}개)` : ''),
        row('지출 기록', fmtUsd(imp.spentUsd), '(한도 계산에는 계속 포함)')),
      h('div', { class: 'small muted' }, '다른 에피소드, 제품, 스토리 컨셉, 캐릭터 라이브러리는 영향을 받지 않습니다.'),
      imp.requiresApprovedConfirm ? h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인된 기록이 있습니다'), h('div', { class: 'small' }, imp.protected.join(' · ')),
        h('label', { class: 'row small', style: 'gap:8px;margin-top:8px;align-items:flex-start' }, h('input', { type: 'checkbox', 'data-confirm-approved': '', onchange: (ev) => { sure = ev.target.checked; go.disabled = !sure; } }), '승인된 기록이 있는 에피소드를 삭제(휴지통 이동)하는 것을 확인합니다.'))) : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), go));
  });
}

// ---------------- script versions ----------------
export async function deleteScriptVersion(ep, v0, after) {
  let v = v0;
  try { v = (await api.get(`/api/episodes/${ep.id}/script-versions`)).versions.find((x) => x.version === v0.version) || v0; } catch (_) { /* the server re-checks everything */ }
  let sure = false;
  const go = h('button', { class: 'btn clay', type: 'button', 'data-confirm-delete-version': '' }, '버전 삭제');
  go.disabled = !!v.wasApproved;
  modal((close) => {
    go.onclick = async () => {
      go.disabled = true;
      try { await api.del(`/api/episodes/${ep.id}/script-versions/${v.version}`, { confirmApproved: sure }); close(); toast(`v${v.version}을 삭제했습니다 (복원할 수 있습니다)`); await after(); } catch (err) { go.disabled = false; toast(err.message, { error: true, recovery: err.recovery }); }
    };
    return h('div', { class: 'stack', style: 'gap:12px' },
      h('h2', null, `대본 v${v.version}을 삭제할까요?`),
      h('div', { class: 'small' }, '이 버전만 버전 기록에서 숨깁니다. 에피소드, 지금 쓰는 대본, 다른 버전과 이미지·영상 등 연결된 자료는 그대로이며, 삭제한 버전은 "대본 버전 관리"에서 복원할 수 있습니다.'),
      v.wasApproved ? h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인된 적이 있는 대본입니다'), h('div', { class: 'small' }, '이미지 디벨롭에 전달된 승인 스냅샷 파일은 지워지지 않습니다.'),
        h('label', { class: 'row small', style: 'gap:8px;margin-top:8px;align-items:flex-start' }, h('input', { type: 'checkbox', 'data-confirm-approved': '', onchange: (e) => { sure = e.target.checked; go.disabled = !sure; } }), '승인된 대본 버전을 삭제하는 것을 확인합니다.'))) : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), go));
  });
}

export function versionMenu(ep, v, after) {
  return kebab({ id: `ver-${ep.id}-${v.version}`, label: `v${v.version} 메뉴`, items: [
    v.deleted ? { key: 'undelete', label: '삭제 취소 (복원)', onClick: async () => { try { await api.post(`/api/episodes/${ep.id}/script-versions/${v.version}/undelete`); toast(`v${v.version}을 되살렸습니다`); await after(); } catch (err) { toast(err.message, { error: true, recovery: err.recovery }); } } }
      : { key: 'delete', label: '이 버전 삭제', hint: v.current ? '지금 쓰는 대본은 삭제할 수 없습니다' : '버전 기록에서 숨김 (복원 가능)', danger: true, disabled: !v.canDelete, onClick: () => deleteScriptVersion(ep, v, after) },
  ] });
}

/** Lists every saved script version (including deleted ones) with a ⋯ menu per version. */
export async function versionManager(e) {
  const box = h('div', { class: 'stack', style: 'gap:8px' });
  const draw = async () => {
    let list;
    try { list = (await api.get(`/api/episodes/${e.id}/script-versions`)).versions; } catch (err) { box.replaceChildren(h('div', { class: 'banner err' }, err.message)); return; }
    box.replaceChildren(...list.slice().reverse().map((v) => h('div', { class: 'item version-item' + (v.deleted ? ' is-deleted' : ''), 'data-version': v.version },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, 'v' + v.version, v.current ? ' · 현재' : '', v.approvedNow ? ' · 승인됨' : v.wasApproved ? ' · 승인된 적 있음' : '', v.deleted ? ' · 삭제됨' : ''),
        h('div', { class: 'small muted' }, `${new Date(v.at).toLocaleString('ko-KR')} · ${v.scenes}씬 · ${v.lines}대사${v.note ? ' · ' + v.note : ''}`)),
      versionMenu(e, v, async () => { await draw(); await refresh(); }))));
  };
  await draw();
  modal((close) => h('div', { class: 'stack' }, h('h2', null, `대본 버전 관리 · ${e.id}`),
    h('p', { class: 'small muted', style: 'margin:0' }, '삭제해도 에피소드와 연결된 자료는 그대로이며 파일은 지워지지 않습니다. 삭제된 버전은 ⋯ 메뉴에서 복원할 수 있습니다.'), box,
    h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, '닫기'))), { wide: true });
}

const CATS = { drama: '반전형 생활 개그', viral: '바이럴형', info: '신뢰·정보형' };
const STAGE_VIEW = { product: 'products', concept: 'storylab', script: 'script', approval: 'script', storyboard: 'image', estimate: 'animation', animation: 'animation', clips: 'animation', voice: 'voice', render: 'render', review: 'review', publish: 'publishing' };

const RESUME = { script: '대본 작업 이어하기', image: '이미지 작업 이어하기', video: '영상 제작 이어하기', review: '최종 검토 이어하기', publish: '게시 준비 이어하기' };
const resumeLabel = (hd) => { const cur = (hd.phases || []).find((p) => p.state === 'current'); return cur ? RESUME[cur.key] : '결과 보기'; };

/** 5-phase pipeline stepper: 대본 → 이미지 → 영상 제작 → 최종 검토 → 게시. */
function stepper(hd) {
  return h('ol', { class: 'ep-stepper', 'data-ep-stepper': '' }, (hd.phases || []).map((p, i) => h('li', { class: 'ep-step ' + p.state, 'data-phase': p.key, 'data-state': p.state, 'aria-current': p.state === 'current' ? 'step' : null },
    h('span', { class: 'ep-dot' }, p.state === 'done' ? '✓' : String(i + 1)), h('span', { class: 'ep-step-label' }, p.label))));
}

/** Compact Episode header: code · title · product · category · stage · approvals · Resume Work. Advanced metadata sits in a collapsed panel. */
export function episodeHeader(ep) {
  const hd = ep.derived && ep.derived.header;
  if (!hd) return null;
  const row = { id: ep.id, title: ep.title, onHold: hd.onHold };
  const target = hd.resumeStep ? STAGE_VIEW[hd.resumeStep] : 'review';
  return h('section', { class: 'ep-header', 'data-episode-header': ep.id },
    h('div', { class: 'ep-head-top' },
      h('div', { class: 'ep-head-id' }, h('span', { class: 'ep-code', 'data-code': '' }, hd.code), hd.onHold ? chip('보류 중', 'mock') : null, hd.archived ? chip('보관됨', 'mock') : null),
      episodeMenu(row, { archivedView: hd.archived })),
    h('div', { class: 'ep-title' }, hd.title),
    h('div', { class: 'ep-meta' }, [hd.productName + (hd.productCode ? ` (${hd.productCode})` : ''), CATS[hd.category] || null].filter(Boolean).join(' · ')),
    stepper(hd),
    h('div', { class: 'ep-progress', 'data-ep-progress': '' },
      h('div', { class: 'ep-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': hd.progressPct, 'aria-label': '진행률' }, h('span', { style: `width:${hd.progressPct}%` })),
      h('span', { class: 'ep-pct' }, hd.progressPct + '%')),
    h('div', { class: 'ep-actions' },
      h('button', { class: 'btn sage', type: 'button', 'data-resume-work': '', onclick: () => { location.hash = '#/' + target + '/' + (['products', 'storylab'].includes(target) ? ep.productId : ep.id); } }, resumeLabel(hd), ' ', icon('play'))),
    hd.onHold && hd.holdReason ? h('div', { class: 'small muted' }, '보류 사유: ' + hd.holdReason) : null,
    h('details', { class: 'small', 'data-ep-advanced': '' }, h('summary', { style: 'cursor:pointer;min-height:32px;display:flex;align-items:center' }, '상세 정보'),
      h('div', { class: 'stack', style: 'gap:2px;margin-top:4px' }, [`내부 ID: ${ep.uuid || '-'}`, `대본 v${ep.version || 0}${ep.story ? ' · 스토리 v' + ep.story.revision : ''}`, `생성: ${ep.createdAt ? new Date(ep.createdAt).toLocaleString('ko-KR') : '-'}`, `수정: ${ep.updatedAt ? new Date(ep.updatedAt).toLocaleString('ko-KR') : '-'}`].map((t) => h('div', { class: 'muted mono' }, t)))));
}
