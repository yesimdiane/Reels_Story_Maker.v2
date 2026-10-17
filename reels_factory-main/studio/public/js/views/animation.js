import { h, chip, icon, confirmDialog, fmtUsd, toast } from '../ui.js';
import { state, act, requireEpisode, go } from '../state.js';
import { api } from '../api.js';
import { videoSummary } from './video-summary.js';
import { animationStudio } from './animation-studio.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, modeBanner, issueList, lockedNotice, videoTabs, productRefStrip } from './common.js';

const JOB_LABEL = { preparing: '준비 중', submitting: '제출 중', processing: '생성 중', completed: '완료', failed: '실패', uncertain: '확인 필요', polling_interrupted: '확인 중단', download_failed: '다운로드 실패', dismissed: '닫음' };
const JOB_KIND = { completed: 'done', failed: 'err', uncertain: 'err', polling_interrupted: 'attention', download_failed: 'attention', processing: 'processing', submitting: 'processing', preparing: 'processing', dismissed: '' };

export function animation() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Animation Studio', '애니메이션 스튜디오', '승인된 캐릭터 이미지로 장면별 9:16 클립을 만듭니다. 생성 전 예상 비용을 확인·승인하고, 만들어진 클립은 하나씩 검토해 승인합니다.', episodePicker()));
  wrap.append(videoTabs('animation'));
  if (!ep.derived.storyboardApproved) wrap.append(lockedNotice('대본과 이미지 스튜디오 승인이 되어야 생성을 시작할 수 있습니다.', 'image', '이미지 스튜디오로 이동'));
  const studioEl = animationStudio(ep);
  wrap.append(studioEl);
  // everything below is the multi-scene overview (batch generation with one confirmation, all clips, job history) — collapsed by default
  const all = h('div', { class: 'stack', style: 'gap:16px' });
  all.append(videoSummary(ep, { startVideo: (sceneIds) => startGeneration(ep, sceneIds) }));

  const g = (state.draft.gen = state.draft.gen || {});
  if (g.forEpisode !== ep.id) { g.forEpisode = ep.id; g.sceneIds = ep.scenes.filter((s) => !s.clips.approvedVersion).map((s) => s.id); g.modelId = state.summary.settings.defaultModelId; g.estimate = null; }
  const panel = h('div', { class: 'card' }, h('div', { class: 'muted' }, '비용을 계산하는 중…'));
  all.append(h('details', { class: 'card', 'data-adv-prep': '' }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '생성 준비 · 모델 · 장면 선택'), h('span', { class: 'small muted' }, '고급')), panel));
  drawEstimate(ep, g, panel);

  const pendingReview = ep.scenes.reduce((n, sc) => n + sc.clips.versions.filter((v) => v.status === 'pending_review').length, 0);
  all.append(h('details', { class: 'card', 'data-clip-review': '', open: pendingReview > 0 || undefined }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '클립 검토'), pendingReview ? chip(`검토 대기 ${pendingReview}`, 'attention') : h('span', { class: 'small muted' }, '승인한 클립만 렌더에 쓰입니다')),
    h('div', { class: 'scene-grid', style: 'margin-top:12px' }, ep.scenes.map((sc) => clipCard(ep, sc, g)))));
  const jobs = (ep.generation.jobs || []).slice().reverse();
  all.append(h('details', { class: 'card', 'data-job-history': '' }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '작업 내역'), h('span', { class: 'small muted' }, '실패한 유료 작업은 자동으로 다시 실행되지 않습니다.')),
    jobs.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['장면', '상태', '요청 ID', '비용 (예상 / 실제)', ''].map((x) => h('th', null, x)))), h('tbody', null, jobs.map((j) => h('tr', null,
      h('td', null, j.sceneId + (j.reused ? ' · 재사용' : '')),
      h('td', null, chip(JOB_LABEL[j.status] || j.status, JOB_KIND[j.status] || ''), j.error && h('div', { class: 'small', style: 'color:var(--rose);margin-top:4px;max-width:420px' }, j.error.message, h('div', { class: 'muted' }, '→ ' + j.error.recovery))),
      h('td', { class: 'mono' }, j.requestId || '—'),
      h('td', null, (j.mode === 'mock' ? '목업 $0' : fmtUsd(j.estimatedUsd) + ' / ' + (j.cost && j.cost.amountUsd != null ? fmtUsd(j.cost.amountUsd) : '—'))),
      h('td', null, h('div', { class: 'row', style: 'gap:6px' },
        j.requestId && ['processing', 'polling_interrupted', 'download_failed'].includes(j.status) && !ep.derived.jobsRunning ? h('button', { class: 'btn sm ghost', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/jobs/${j.id}/resume`), { ok: '이어서 확인합니다 (추가 요금 없음)' }) }, '다시 확인') : null,
        ['failed', 'uncertain', 'polling_interrupted', 'download_failed'].includes(j.status) ? h('button', { class: 'btn sm ghost', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/jobs/${j.id}/dismiss`)) }, '닫기') : null))))))
      : h('div', { class: 'muted' }, '아직 생성 작업이 없습니다.')));
  // the multi-scene overview (batch generate / approve, summary, job history) comes first, right under the tabs
  wrap.insertBefore(h('details', { class: 'card', 'data-anim-overview': '' }, h('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px' }, h('b', null, '여러 장면 한꺼번에 · 전체 요약 · 작업 내역'), h('span', { class: 'small muted' }, '고급 (일괄 생성도 비용 확인과 승인이 필요합니다)')), h('div', { style: 'margin-top:12px' }, all)), studioEl);
  return wrap;
}

/** Cost review first (free estimate), then the explicit confirmation; used by the summary buttons and per-scene retries. */
export async function startGeneration(ep, sceneIds, opts = {}) {
  if (!sceneIds || !sceneIds.length) return toast('만들 장면이 없습니다', { error: true });
  const modelId = opts.modelId || state.summary.settings.defaultModelId;
  let est;
  try { est = await api.post(`/api/episodes/${ep.id}/generation/estimate`, { sceneIds, modelId }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  if (!est.canAuthorize) return toast(est.blockers[0] ? est.blockers[0].message : '지금은 생성할 수 없습니다', { error: true, recovery: est.blockers[0] && est.blockers[0].recovery });
  return authorizeAndRun(ep, { sceneIds, modelId }, est);
}

async function drawEstimate(ep, g, panel) {
  let est;
  try {
    est = await api.post(`/api/episodes/${ep.id}/generation/estimate`, { sceneIds: g.sceneIds, modelId: g.modelId });
  } catch (e) {
    panel.replaceChildren(h('div', { class: 'banner err' }, e.message));
    return;
  }
  g.estimate = est;
  const models = state.summary.models;
  const rerender = () => drawEstimate(ep, g, panel);
  const items = Object.fromEntries(est.items.map((i) => [i.sceneId, i]));
  const total = est.totalUsd;
  panel.replaceChildren(
    h('div', { class: 'card-head' }, h('h2', null, '생성 준비'), h('div', { class: 'row' }, chip(est.mode === 'mock' ? 'MOCK' : 'LIVE', est.mode === 'mock' ? 'mock' : 'live'), h('select', { style: 'width:auto', 'aria-label': '모델', onchange: (e) => { g.modelId = e.target.value; rerender(); } }, models.map((m) => h('option', { value: m.id, selected: m.id === g.modelId }, m.label))))),
    h('div', { class: 'grid side-l', style: 'grid-template-columns:minmax(0,1fr) 300px' },
      h('div', null,
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', '장면', '클립 길이', '시작 이미지', '예상 비용'].map((x) => h('th', null, x)))),
          h('tbody', null, ep.scenes.map((sc) => { const it = items[sc.id]; const on = g.sceneIds.includes(sc.id); return h('tr', null,
            h('td', null, h('input', { type: 'checkbox', checked: on, 'aria-label': sc.id + ' ' + (sc.title_ko || sc.title || '') + ' 선택', onchange: (e) => { g.sceneIds = e.target.checked ? [...g.sceneIds, sc.id] : g.sceneIds.filter((x) => x !== sc.id); rerender(); } })),
            h('td', null, h('b', null, sc.id), ' ', sc.title_ko || sc.title),
            h('td', null, sc.clipSec + '초'),
            h('td', null, sc.startImageInfo.error ? chip('없음', 'err') : sc.startImageInfo.placeholder ? chip('데모 임시', 'mock') : sc.startImageInfo.approved ? chip('승인됨', 'done') : chip('미승인', 'attention')),
            h('td', null, !on || !it ? '—' : it.cached ? chip('캐시 재사용 $0', 'done') : it.usd == null ? chip('추정치 없음', 'attention') : fmtUsd(it.usd))); }))),
        h('div', { style: 'margin-top:12px' }, issueList(est.blockers, 'err'))),
      h('div', { class: 'stack', style: 'gap:10px' },
        h('div', { class: 'card flat tight' }, h('div', { class: 'label' }, '예상 비용 (이번 실행)'), h('div', { style: 'font-family:var(--serif);font-size:30px;font-weight:600' }, est.mode === 'mock' ? '$0' : total == null ? '알 수 없음' : fmtUsd(total)),
          h('div', { class: 'small muted' }, est.mode === 'mock' ? (total == null ? '목업은 요금이 없습니다. 실제 모드용 가격 추정치는 설정에서 입력하세요.' : '목업은 요금이 없습니다 (아래는 입력한 추정치 기준).') : 'Muapi는 가격표를 공개하지 않아 입력하신 추정치로 계산합니다.'),
          est.mode === 'mock' && total != null ? h('div', { class: 'small' }, '실제 모드였다면 ' + fmtUsd(total)) : null),
        h('div', { class: 'card flat tight' }, h('div', { class: 'row between small' }, h('span', null, '릴스 한도'), h('b', null, fmtUsd(est.limitUsd))), h('div', { class: 'row between small' }, h('span', null, '지금까지 지출'), h('b', null, fmtUsd(est.spentUsd))), h('div', { class: 'row between small' }, h('span', null, '남은 한도'), h('b', null, fmtUsd(est.remainingUsd)))),
        h('button', { class: 'btn lg sage', disabled: !est.canAuthorize || !g.sceneIds.length, onclick: () => authorizeAndRun(ep, g, est) }, icon('play'), est.mode === 'mock' ? '목업 생성 시작' : '비용 확인 후 생성 승인'),
        est.mode === 'live' && est.unknown ? h('a', { class: 'small', href: '#/settings' }, '→ 설정에서 가격 추정치 입력') : null)));
}

async function authorizeAndRun(ep, g, est) {
  const live = est.mode === 'live';
  const ok = await confirmDialog({
    title: live ? '유료 생성을 승인할까요?' : '목업 생성을 시작할까요?',
    body: h('div', { class: 'stack small' },
      h('div', null, `${est.scenes.length}개 장면 · 모델 ${est.model.label}`),
      h('div', { style: 'font-family:var(--serif);font-size:26px;font-weight:600' }, live ? '예상 ' + fmtUsd(est.totalUsd) : '요금 없음 (목업)'),
      h('div', { class: 'muted' }, live ? `릴스 한도 ${fmtUsd(est.limitUsd)} 중 ${fmtUsd(est.remainingUsd)} 남음. 이 승인은 선택한 장면에 한 번만, 30분 동안 유효합니다. 실제 청구 금액은 달라질 수 있고, 실패한 작업이 청구될 수도 있습니다. 실패해도 자동으로 다시 실행하지 않습니다.` : '실제 Muapi 호출 없이 확인용 임시 클립을 만듭니다.')),
    confirm: live ? '승인하고 생성' : '시작', tone: live ? 'clay' : 'sage',
  });
  if (!ok) return;
  await act(async () => {
    const a = await api.post(`/api/episodes/${ep.id}/generation/authorize`, { sceneIds: g.sceneIds, modelId: g.modelId, confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null });
    await api.post(`/api/episodes/${ep.id}/generation/run`, { authorizationId: a.id });
    return null;
  }, { ok: '생성을 시작했습니다' });
  // a cache hit or a very fast job finishes before the first refresh shows it as running: look again shortly (free, read-only)
  [1200, 3500].forEach((ms) => setTimeout(() => { if (location.hash.startsWith('#/animation')) act(async () => null); }, ms));
}

/** opts.onRegenerate(sc): used by the Storyboard panel (it starts the cost review directly instead of selecting the scene on this page). */
export function clipCard(ep, sc, g, opts = {}) {
  const key = 'clip:' + sc.id;
  const vs = sc.clips.versions;
  const sel = state.draft[key] != null && vs.some((v) => v.v === state.draft[key]) ? state.draft[key] : (sc.clips.approvedVersion || (vs.length ? vs[vs.length - 1].v : null));
  const cur = vs.find((v) => v.v === sel);
  const running = (ep.generation.jobs || []).find((j) => j.sceneId === sc.id && !j.brollId && ['preparing', 'submitting', 'processing'].includes(j.status));
  // Clip-local animation fixes: no navigation back to Script or Image Studio.
  const editKey = 'clip-animation-fix:' + ep.id + ':' + sc.id;
  const draft = (state.draft[editKey] = state.draft[editKey] || {
    video: (sc.prompt && sc.prompt.video) || '',
    negative: (sc.prompt && sc.prompt.negative) || '',
    revision: sc.prompt && sc.prompt.rev || 0,
    open: false,
  });
  if (draft.revision !== (sc.prompt && sc.prompt.rev || 0) && !draft.open) {
    draft.video = (sc.prompt && sc.prompt.video) || '';
    draft.negative = (sc.prompt && sc.prompt.negative) || '';
    draft.revision = sc.prompt && sc.prompt.rev || 0;
  }
  const productGuard = 'PRODUCT IDENTITY LOCK: Keep the exact same physical product shown in the approved start image. Preserve its shape, color, material, proportions, display, buttons, and all distinctive details. Do not redesign, morph, substitute, or add product features. Animate only the requested action. Maintain unchanged room lighting unless the requested action explicitly changes it.';
  const saveFix = async (generate = false) => {
    if (!sc.prompt) return toast('애니메이션 프롬프트를 먼저 생성하세요.', { error: true });
    if (!draft.video.trim()) return toast('애니메이션 프롬프트를 입력하세요.', { error: true });
    const changed = draft.video !== sc.prompt.video || draft.negative !== (sc.prompt.negative || '');
    if (changed) {
      const saved = await act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/prompt`, { video: draft.video, negative: draft.negative }), { ok: '이 장면의 애니메이션 프롬프트만 저장했습니다' });
      if (!saved) return; // Failed saves must never trigger a paid generation.
    }
    if (generate) {
      if (changed) return toast('새 프롬프트를 저장했습니다. 갱신된 장면에서 비용 확인 후 다시 생성을 눌러주세요.');
      return startGeneration(ep, [sc.id]);
    }
  };
  const editor = h('details', { class: 'scene-section', open: draft.open || undefined, 'data-clip-anim-editor': sc.id },
    h('summary', { style: 'cursor:pointer', onclick: () => { draft.open = !draft.open; } }, '✎ 이 클립의 애니메이션만 수정'),
    h('div', { class: 'stack', style: 'gap:8px;padding:10px 0' },
      h('div', { class: 'small muted' }, '대본·이미지는 건드리지 않습니다. 이 장면의 영상 동작만 수정하고 새 버전을 만들 수 있어요.'),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '애니메이션 프롬프트'),
        h('textarea', { rows: 6, 'data-clip-anim-prompt': sc.id, oninput: (e) => { draft.video = e.target.value; } }, draft.video)),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '네거티브 프롬프트'),
        h('textarea', { rows: 2, 'data-clip-anim-negative': sc.id, oninput: (e) => { draft.negative = e.target.value; } }, draft.negative)),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn sm ghost', type: 'button', 'data-clip-product-lock': sc.id, onclick: () => {
          if (!draft.video.includes('PRODUCT IDENTITY LOCK:')) draft.video = (draft.video.trim() + '\n\n' + productGuard).trim();
          state.draft[editKey] = draft;
          const ta = document.querySelector('[data-clip-anim-prompt="' + sc.id + '"]');
          if (ta) ta.value = draft.video;
          toast('원본 제품 유지 지시를 프롬프트에 추가했습니다. 저장한 뒤 재생성하세요.');
        } }, '제품 디자인 고정 지시 추가'),
        h('button', { class: 'btn sm sage', type: 'button', 'data-clip-anim-save': sc.id, disabled: !sc.prompt, onclick: () => saveFix(false) }, '애니메이션만 저장'),
        h('button', { class: 'btn sm clay', type: 'button', 'data-clip-anim-save-generate': sc.id, disabled: !sc.prompt || !!running || !ep.derived.storyboardApproved, onclick: () => saveFix(true) }, '저장 · 이 장면만 재생성')),

      h('div', { class: 'small muted' }, '재생성 전 무료 예상 비용 확인과 유료 승인 절차가 유지됩니다. 기존 클립은 삭제되지 않습니다.')));
  const fileIn = h('input', { type: 'file', accept: 'video/mp4,video/quicktime', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await act(() => api.upload(`/api/episodes/${ep.id}/clips/${sc.id}/upload`, f), { ok: '클립을 올렸습니다 — 검토 후 승인하세요' }); } });
  return h('div', { class: 'clip-card' + (cur && cur.status === 'approved' ? ' approved' : ''), 'data-clip-card': sc.id, 'data-clip-status': cur ? cur.status : 'none' },
    h('div', { class: 'row between' }, h('b', null, sc.id + ' · ' + (sc.title_ko || sc.title || '').slice(0, 22)), cur ? chip(({ approved: '승인됨', pending_review: '검토 대기', rejected: '거절됨', superseded: '교체됨' })[cur.status] || cur.status, ({ approved: 'done', pending_review: 'attention', rejected: 'err' })[cur.status] || '') : chip(running ? '생성 중' : '클립 없음', running ? 'processing' : '')),
    h('div', { class: 'phone sm' }, cur ? h('video', { src: cur.url, controls: true, playsinline: true, preload: 'metadata', muted: true }) : h('div', { class: 'ph' }, running ? '생성 중… (자동으로 새로고침됩니다)' : '아직 클립이 없습니다')),
    cur ? h('div', { class: 'small muted' }, `v${cur.v} · ${cur.durationSec}초 · ${cur.width}×${cur.height}` + (cur.mock ? ' · 목업' : cur.manual ? ' · 직접 업로드' : '') + (cur.reused ? ' · 캐시 재사용' : '')) : null,
    cur && cur.warnings && cur.warnings.length ? h('div', { class: 'small', style: 'color:var(--clay)' }, cur.warnings.join(' ')) : null,
    editor,
    vs.length > 1 ? h('div', { class: 'versions' }, vs.map((v) => h('button', { 'aria-pressed': v.v === sel ? 'true' : 'false', onclick: () => { state.draft[key] = v.v; import('../state.js').then(({ hooks }) => hooks.rerender()); } }, 'v' + v.v + (v.status === 'approved' ? ' ✓' : '')))) : null,
    h('div', { class: 'row', style: 'gap:6px' },
      cur && cur.status !== 'approved' ? h('button', { class: 'btn sm sage', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/clips/${sc.id}/${cur.v}/review`, { decision: 'approve' }), { ok: sc.id + ' 클립을 승인했습니다' }) }, icon('check'), '승인') : null,
      cur && cur.status === 'approved' ? h('button', { class: 'btn sm ghost', 'data-clip-unapprove': sc.id, title: '승인만 취소합니다 (클립 파일은 그대로)', onclick: async () => { if (await confirmDialog({ title: '클립 승인을 취소할까요?', body: '클립 파일은 지워지지 않습니다. 이 장면은 최종 렌더와 씬 최종 승인에서 다시 제외됩니다.', confirm: '승인 취소', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/clips/${sc.id}/${cur.v}/review`, { decision: 'unapprove' }), { ok: sc.id + ' 클립 승인을 취소했습니다' }); } }, '승인 취소') : null,
      cur && cur.status !== 'rejected' ? h('button', { class: 'btn sm danger', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/clips/${sc.id}/${cur.v}/review`, { decision: 'reject' })) }, '거절') : null,
      h('button', { class: 'btn sm ghost', 'data-clip-regenerate': sc.id, title: '이 장면만 다시 생성 (새 승인 필요)', disabled: !!running || !ep.derived.storyboardApproved, onclick: () => { if (opts.onRegenerate) return opts.onRegenerate(sc); g.sceneIds = [sc.id]; import('../state.js').then(({ hooks }) => { hooks.rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast(sc.id + '만 선택했습니다. 위에서 비용을 확인하고 다시 생성하세요.'); }); } }, icon('refresh'), '재생성'),
      h('button', { class: 'btn sm ghost', title: 'Google Flow 등에서 직접 만든 클립 올리기', onclick: () => fileIn.click() }, icon('upload')), fileIn));
}
