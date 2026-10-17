// Animation Studio: per-scene image-to-video clips (MuAPI). Scene navigation on top, then a two-column workspace:
//   left  = inputs & controls (approved start image, prompt, model, duration, resolution, cost)
//   right = generated clip (preview, versions, compare, approve / reject / regenerate)
// Nothing here starts a paid call by itself: opening the page or switching scenes only reads. A generation always goes through the free cost
// estimate and an explicit confirmation dialog (startGeneration). The shared 0.5 s beats (ep.motion) are only READ here.
import { h, chip, icon, confirmDialog, fmtUsd, toast } from '../ui.js';
import { state, act, hooks } from '../state.js';
import { api } from '../api.js';
import { startGeneration } from './animation.js';
import { goToScenePanel } from './scene-nav.js';
import { gatesPanel } from './anim-gates.js';

const uiState = () => { state.ui = state.ui || { open: {} }; state.ui.anim = state.ui.anim || {}; return state.ui.anim; };
const rerender = () => hooks.rerender();

export const STATUS = {
  notready: ['준비 안 됨', 'attention'], ready: ['준비됨', ''], queued: ['대기열', 'processing'], processing: ['생성 중', 'processing'],
  completed: ['완료 · 검토 대기', 'attention'], failed: ['실패', 'err'], approved: ['승인됨', 'done'], rejected: ['거절됨', 'err'],
};
const ACTIVE_JOB = new Set(['preparing', 'submitting', 'processing']);
const BAD_JOB = new Set(['failed', 'uncertain', 'download_failed', 'polling_interrupted']);

/** Not Ready · Ready · Queued · Processing · Completed · Failed · Approved · Rejected */
export function sceneStatus(ep, sc) {
  const vs = sc.clips.versions;
  const jobs = (ep.generation.jobs || []).filter((j) => j.sceneId === sc.id && !j.brollId);
  const running = jobs.find((j) => ACTIVE_JOB.has(j.status));
  if (running) return running.status === 'processing' ? 'processing' : 'queued';
  if (sc.clips.approvedVersion) return 'approved';
  const last = vs[vs.length - 1];
  const lastJob = jobs[jobs.length - 1];
  if (lastJob && BAD_JOB.has(lastJob.status) && (!last || (lastJob.createdAt || '') > (last.createdAt || ''))) return 'failed';
  if (last) return last.status === 'rejected' ? 'rejected' : 'completed';
  const r = ep.derived.renderReadiness;
  const blocked = r && r.items.some((i) => i.stage === 'generate' && i.sceneId === sc.id && (i.severity === 'block' || i.severity === 'pending'));
  const global = r && r.items.some((i) => i.stage === 'generate' && !i.sceneId && (i.severity === 'block' || i.severity === 'pending'));
  return blocked || global ? 'notready' : 'ready';
}

const sceneThumb = (sc) => {
  const img = sc.startImageInfo;
  return img && !img.error && img.url ? h('img', { src: img.url, alt: '', loading: 'lazy' }) : h('span', { class: 'gal-empty' }, '이미지 없음');
};

function nav(ep, cur) {
  return h('div', { class: 'scene-gallery-strip anim-nav', role: 'tablist', 'aria-label': '장면 선택', 'data-anim-nav': '' }, ep.scenes.map((sc) => {
    const st = sceneStatus(ep, sc);
    const [label, kind] = STATUS[st];
    const approvedImg = sc.startImageInfo && !sc.startImageInfo.error && sc.startImageInfo.approved;
    return h('button', { class: 'anim-card' + (sc.id === cur ? ' current' : '') + (st === 'approved' ? ' approved' : ''), type: 'button', role: 'tab', 'aria-selected': String(sc.id === cur), 'data-anim-scene': sc.id, 'data-anim-status': st,
      onclick: () => { uiState()[ep.id] = sc.id; rerender(); } },
      h('span', { class: 'gal-thumb' }, sceneThumb(sc), approvedImg ? h('span', { class: 'gal-badge ok' }, '✓') : null),
      h('b', null, sc.id), h('span', { class: 'small anim-title' }, (sc.title_ko || sc.title || '').slice(0, 14)), h('span', { class: 'small muted' }, `${sc.durationSec}초`), chip(label, kind));
  }));
}

const modelOf = (id) => (state.summary.models || []).find((m) => m.id === id) || (state.summary.models || [])[0];
function priceFor(model, sec) {
  const t = ((state.summary.settings.modelEstimates || {})[model.id] || {}).usdByDuration || {};
  const v = t[String(sec)];
  return v == null || v === '' ? null : Number(v);
}

function leftColumn(ep, sc) {
  const st = ep.derived;
  const set = sc.animationSettings || {};
  const model = modelOf(set.modelId || state.summary.settings.defaultModelId);
  const durs = model.durations || [];
  const planned = Number(sc.durationSec);
  const autoSec = durs.slice().sort((a, b) => a - b).find((d) => d >= planned - 1e-9) || durs[durs.length - 1];
  const chosen = set.durationSec || autoSec;
  const img = sc.startImageInfo;
  const imgOk = img && !img.error && img.url;
  const promptKey = 'animp:' + ep.id + ':' + sc.id;
  const d = (state.draft[promptKey] = state.draft[promptKey] || { video: sc.prompt ? sc.prompt.video : '', negative: sc.prompt ? sc.prompt.negative || '' : '', rev: sc.prompt ? sc.prompt.rev || 1 : 0 });
  if (d.rev !== (sc.prompt ? sc.prompt.rev || 1 : 0)) { d.video = sc.prompt ? sc.prompt.video : ''; d.negative = sc.prompt ? sc.prompt.negative || '' : ''; d.rev = sc.prompt ? sc.prompt.rev || 1 : 0; }
  const dirty = () => !!sc.prompt && (d.video !== sc.prompt.video || d.negative !== (sc.prompt.negative || ''));
  const saveSettings = (patch) => act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/animation`, patch), { ok: '이 장면의 생성 설정을 저장했습니다' });
  // Free, read-only estimate gate for the selected model. This is NOT a paid MuAPI test.
  const checkKey = 'animcheck:' + ep.id + ':' + sc.id;
  const checked = (state.draft[checkKey] = state.draft[checkKey] || {});
  // A new view's button begins disabled; recheck against current server state on every view open.
  checked.ok = false;
  const checkStatus = h('div', { class: 'small muted', 'data-anim-model-check': sc.id }, '모델 연결 사전 점검 필요 (무료 · 실제 영상 생성 아님)');
  const checkModel = async (id = model.id) => {
    checked.id = id;
    checked.ok = false;
    genBtn.disabled = true;
    checkStatus.textContent = '모델 설정 및 생성 조건 점검 중… (무료)';
    try {
      const result = await api.post(`/api/episodes/${ep.id}/generation/preflight`, { sceneId: sc.id, modelId: id });
      if (checked.id !== id) return;
      checked.ok = !!result.canGenerate;
      const blockers = result.blockers || [];
      checkStatus.textContent = checked.ok
        ? `✓ 무료 사전 점검 통과 · ${result.imageField} (${result.imageType}) · ${result.mode === 'live' ? 'MuAPI 계정 연결됨' : 'MOCK'} · 실제 모델 엔드포인트 미검증`
        : '사전 점검 실패: ' + (blockers.join(' / ') || '모델 설정을 확인하세요');
    } catch (e) {
      if (checked.id !== id) return;
      checked.ok = false;
      checkStatus.textContent = '사전 점검 실패: ' + e.message;
    }
    if (checked.id === id) genBtn.disabled = !canGenerate();
  };
  const costBox = h('div', { class: 'small', 'data-anim-cost': sc.id }, h('span', { class: 'muted' }, '예상 비용은 "비용 확인(무료)"을 누르면 계산합니다. 생성은 시작되지 않습니다.'));
  const showCost = async () => {
    costBox.textContent = '계산하는 중…';
    try {
      const est = await api.post(`/api/episodes/${ep.id}/generation/estimate`, { sceneIds: [sc.id], modelId: model.id });
      const it = (est.items || []).find((x) => x.sceneId === sc.id) || {};
      costBox.replaceChildren(
        h('div', null, h('b', null, est.mode === 'mock' ? '목업: 요금 없음' : it.cached ? '캐시 재사용: $0' : it.usd == null ? '예상 비용: 추정치 없음 (설정에서 가격 입력)' : '예상 비용: ' + fmtUsd(it.usd)), h('span', { class: 'muted' }, ` · ${est.model.label} · 클립 ${it.clipSec}초`)),
        est.blockers && est.blockers.length ? h('ul', { style: 'margin:6px 0 0 18px' }, est.blockers.map((b) => h('li', null, b.message))) : h('div', { style: 'color:var(--sage-deep)' }, '지금 생성할 수 있습니다.'));
    } catch (e) { costBox.replaceChildren(h('div', { class: 'issue err' }, e.message)); }
  };
  const taP = h('textarea', { rows: 7, 'data-anim-prompt': sc.id, 'aria-label': '애니메이션 프롬프트', oninput: (e) => { d.video = e.target.value; refreshSave(); } }, d.video);
  const taN = h('textarea', { rows: 2, 'data-anim-negative': sc.id, 'aria-label': '네거티브 프롬프트', oninput: (e) => { d.negative = e.target.value; refreshSave(); } }, d.negative);
  const saveBtn = h('button', { class: 'btn sm', type: 'button', 'data-anim-prompt-save': sc.id, onclick: async () => { await act(() => api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/prompt`, { video: d.video, negative: d.negative }), { ok: '프롬프트를 저장했습니다 (직접 수정은 자동으로 덮어쓰지 않습니다)' }); } }, '프롬프트 저장');
  const refreshSave = () => { saveBtn.disabled = !dirty(); genBtn.disabled = !canGenerate(); };
  const running = (ep.generation.jobs || []).some((j) => j.sceneId === sc.id && !j.brollId && ACTIVE_JOB.has(j.status));
  const gateInfo = ((ep.sceneFlow && ep.sceneFlow.scenes && ep.sceneFlow.scenes[sc.id]) || {}).gate;
  const gateReady = !gateInfo || gateInfo.ready;
  const canGenerate = () => checked.id === model.id && checked.ok === true && !running && !dirty() && !!sc.prompt && !!imgOk && gateReady;
  const genBtn = h('button', { class: 'btn clay', type: 'button', 'data-anim-generate': sc.id, disabled: !canGenerate(), title: !gateReady ? '"생성 전 단계" 점검 항목을 먼저 끝내세요' : dirty() ? '프롬프트를 먼저 저장하세요' : '비용 확인과 승인 단계를 거쳐야 시작됩니다', onclick: () => startGeneration(ep, [sc.id], { modelId: model.id }) }, icon('play'), sc.clips.versions.length ? '새 버전 생성…' : '생성…');
  refreshSave();
  void checkModel(model.id);
  return h('div', { class: 'stack', style: 'gap:12px', 'data-anim-left': sc.id },
    h('div', { class: 'card flat stack', style: 'gap:6px' }, h('b', { class: 'small' }, '시작 이미지 (스토리보드에서 승인된 이미지)'),
      h('div', { class: 'row', style: 'gap:10px;align-items:flex-start' },
        h('div', { class: 'gal-thumb', style: 'width:84px;flex:0 0 auto;cursor:default' }, imgOk ? h('img', { src: img.url, alt: sc.id }) : h('span', { class: 'gal-empty' }, '이미지 없음')),
        h('div', { class: 'small stack', style: 'gap:4px' }, imgOk ? (img.approved ? chip('이미지 승인됨', 'done') : chip('이미지 미승인', 'attention')) : chip('이미지 필요', 'err'),
          h('div', { class: 'muted' }, imgOk ? (img.fileName || img.label || '') : '스토리보드에서 시작 이미지를 만들고 승인하세요.'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => goToScenePanel(ep, sc.id, '') }, '스토리보드에서 열기')))),
    h('div', { class: 'card flat stack', style: 'gap:4px' }, h('b', { class: 'small' }, '끝 프레임 (선택)'),
      model.endImageField ? h('div', { class: 'small muted' }, '이 모델은 끝 프레임을 받을 수 있다고 선언되어 있지만 이 버전에서는 아직 연결되지 않았습니다.') : h('div', { class: 'small muted', 'data-anim-endimage': 'unsupported' }, `선택한 모델(${model.label})은 끝 프레임 지원이 선언되어 있지 않습니다. 지원 여부를 확인하지 못한 기능은 쓰지 않습니다.`)),
    h('div', { class: 'field' }, h('label', null, '애니메이션 프롬프트 (직접 수정 가능)'), taP,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, saveBtn, sc.prompt && sc.prompt.edited ? chip('직접 수정됨 — 자동으로 덮어쓰지 않음', 'mock') : null, sc.prompt ? h('span', { class: 'small muted' }, `r${sc.prompt.rev || 1}`) : h('span', { class: 'small muted' }, '스토리보드에서 프롬프트를 먼저 만드세요'))),
    h('details', { class: 'scene-section', 'data-anim-composed': sc.id }, h('summary', null, h('span', { class: 'section-title' }, '실제로 전송되는 프롬프트 (0.5초 비트 포함, 읽기 전용)')), h('div', { class: 'section-body' }, h('pre', { class: 'mono small', style: 'white-space:pre-wrap;margin:0' }, sc.animationPrompt || '(프롬프트 없음)'),
      h('div', { class: 'small muted' }, `공유 타임라인(ep.motion) ${sc.motion ? sc.motion.beats.length + '비트' : '없음'} — 편집은 대본 스튜디오/스토리보드의 같은 타임라인에서 합니다. 0.5초 비트는 모델에 주는 지시일 뿐 프레임 단위 타이밍을 보장하지 않습니다.`))),
    model.supportsNegativePrompt !== false ? h('div', { class: 'field' }, h('label', null, '네거티브 프롬프트'), taN) : h('div', { class: 'small muted' }, '선택한 모델은 네거티브 프롬프트를 지원한다고 선언되어 있지 않아 전송하지 않습니다.'),
    h('div', { class: 'card flat stack', style: 'gap:8px' }, h('b', { class: 'small' }, '모델 · 길이 · 해상도'),
      h('label', { class: 'field' }, h('span', { class: 'small' }, 'MuAPI 모델'), h('select', { 'data-anim-model': sc.id, onchange: async (e) => { checked.ok = false; checked.id = e.target.value; genBtn.disabled = true; checkStatus.textContent = '모델 변경 저장 및 무료 점검 중…'; await saveSettings({ modelId: e.target.value, durationSec: null, resolution: null }); } }, (state.summary.models || []).map((m) => h('option', { value: m.id, selected: m.id === model.id }, `${m.label}${m.custom ? ' (직접 추가)' : ''}`)))),
      h('div', { class: 'small muted' }, `지원 길이: ${durs.join(' / ') || '선언 없음'}초 · 시작 이미지: 지원 · 끝 프레임: ${model.endImageField ? '선언됨' : '미선언'} · 해상도: ${(model.resolutions || []).join(' / ') || '미선언'} · 검증 수준: ${model.verification}`),
      h('label', { class: 'field' }, h('span', { class: 'small' }, '클립 길이'), h('select', { 'data-anim-duration': sc.id, onchange: (e) => saveSettings({ durationSec: e.target.value === '' ? null : Number(e.target.value) }) }, [h('option', { value: '' }, `자동 (${autoSec}초)`)].concat(durs.map((x) => h('option', { value: x, selected: set.durationSec === x }, `${x}초`))))),
      h('div', { class: 'small', 'data-anim-duration-note': sc.id, style: chosen !== planned ? 'color:var(--clay)' : '' }, chosen === planned ? `장면 ${planned}초 = 클립 ${chosen}초` : `장면 ${planned}초 ≠ 클립 ${chosen}초 — 모델이 고정 길이만 지원하면 길이가 다릅니다. 비디오 스튜디오에서 자르거나 늘려 맞춥니다.`),
      (model.resolutions || []).length ? h('label', { class: 'field' }, h('span', { class: 'small' }, '해상도'), h('select', { 'data-anim-resolution': sc.id, onchange: (e) => saveSettings({ resolution: e.target.value || null }) }, [h('option', { value: '' }, '모델 기본값')].concat(model.resolutions.map((x) => h('option', { value: x, selected: set.resolution === x }, x))))) : h('div', { class: 'small muted' }, '해상도: 이 모델은 선택 가능한 해상도가 선언되어 있지 않습니다 (모델 기본값 사용).'),
      model.id === 'seedance-2.5' ? h('div', { class: 'card flat stack', style: 'gap:8px', 'data-seedance-workflow': sc.id },
        h('b', null, 'Seedance 2.5 · 저비용 초안 → 최종 렌더링'),
        h('label', { class: 'field' }, h('span', { class: 'small' }, '생성 단계'),
          h('select', { 'data-seedance-mode': sc.id, onchange: (e) => saveSettings({ seedanceMode: e.target.value, resolution: e.target.value === 'draft' ? '480p' : e.target.value === 'finalize' ? '1080p' : null }) },
            [['standard', '일반 생성 (선택한 해상도)'], ['draft', '① 480p 초안 생성 · 저비용'], ['finalize', '② 마음에 드는 초안 → 1080p 완성']].map(([v, label]) => h('option', { value: v, selected: (set.seedanceMode || 'standard') === v }, label)))),
        (set.seedanceMode || 'standard') === 'draft'
          ? h('div', { class: 'small muted' }, '480p로 초안을 생성합니다. 완료 후 오른쪽 영상 플레이어에서 확인하세요. 최종 렌더링은 자동으로 실행되지 않습니다.')
          : (set.seedanceMode || 'standard') === 'finalize'
            ? h('div', { class: 'stack', style: 'gap:6px' },
                h('div', { class: 'small muted' }, '완료된 480p 초안을 선택하면 같은 요청의 프롬프트·이미지·길이·시드를 재사용해 1080p로 완성합니다. 7일 이내 초안만 가능합니다.'),
                (() => {
                  const drafts = (ep.generation.jobs || []).filter(j => j.sceneId === sc.id && j.modelId === 'seedance-2.5' && j.seedanceMode === 'draft' && j.status === 'completed' && j.requestId && j.updatedAt && Date.now() - Date.parse(j.updatedAt) <= 7 * 86400000);
                  const selected = set.draftRequestId || (drafts.length ? drafts.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0].requestId : '');
                  return drafts.length
                    ? h('label', { class: 'field' }, h('span', { class: 'small' }, '완성할 초안'),
                        h('select', { 'data-seedance-draft-id': sc.id, onchange: (e) => saveSettings({ draftRequestId: e.target.value }) },
                          drafts.map(j => h('option', { value: j.requestId, selected: j.requestId === selected }, `초안 · ${String(j.updatedAt).slice(0, 16).replace('T', ' ')} · ${j.requestId.slice(0, 12)}…`))))
                    : h('div', { class: 'issue err' }, '완료된 초안이 없습니다. 먼저 ① 480p 초안을 생성하세요.');
                })(),
                h('div', { class: 'small', style: 'color:var(--clay)' }, '1080p 최종 렌더링은 별도 유료 작업입니다. 생성 전 비용 확인과 재승인이 필요합니다.'))
            : h('div', { class: 'small muted' }, '일반 생성은 초안 없이 바로 렌더링합니다. 비용 절약을 원하면 ① 초안 생성을 선택하세요.'))
        : null,
      h('div', { class: 'small muted' }, '화면 비율: 9:16 고정 (릴스 세로 영상)'),
      priceFor(model, chosen) != null ? h('div', { class: 'small' }, `내가 입력한 예상 단가: ${fmtUsd(priceFor(model, chosen))} / ${chosen}초 클립`) : h('div', { class: 'small', style: 'color:var(--clay)' }, '예상 단가가 입력되지 않았습니다 (설정 → 비용 한도와 가격 추정). 실제 모드에서는 단가가 없으면 생성이 막힙니다.')),
    checkStatus,
    costBox,
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, h('button', { class: 'btn ghost', type: 'button', 'data-anim-estimate': sc.id, onclick: showCost }, '비용 확인 (무료)'), genBtn),
    h('div', { class: 'small muted' }, '한 번에 이 장면 하나만 생성합니다. 생성은 비용 확인과 직접 승인 후에만 시작되며 실패해도 자동으로 다시 시도하지 않습니다.'));
}

function rightColumn(ep, sc) {
  const vs = sc.clips.versions;
  const key = 'animv:' + ep.id + ':' + sc.id;
  const sel = state.draft[key] != null && vs.some((v) => v.v === state.draft[key]) ? state.draft[key] : (sc.clips.approvedVersion || (vs.length ? vs[vs.length - 1].v : null));
  const cmpKey = 'animc:' + ep.id + ':' + sc.id;
  const cmp = state.draft[cmpKey] != null && vs.some((v) => v.v === state.draft[cmpKey]) && state.draft[cmpKey] !== sel ? state.draft[cmpKey] : null;
  const cur = vs.find((v) => v.v === sel);
  const other = vs.find((v) => v.v === cmp);
  const st = sceneStatus(ep, sc);
  const jobs = (ep.generation.jobs || []).filter((j) => j.sceneId === sc.id && !j.brollId).slice().reverse();
  const running = jobs.find((j) => ACTIVE_JOB.has(j.status));
  const review = (v, decision, ok) => act(() => api.post(`/api/episodes/${ep.id}/clips/${sc.id}/${v.v}/review`, { decision }), { ok });
  const player = (v, label) => h('div', { class: 'stack', style: 'gap:4px;align-items:center' }, h('div', { class: 'phone', style: 'max-width:240px;width:100%' }, h('video', { src: v.url, controls: true, playsinline: true, preload: 'metadata', muted: true, 'data-anim-video': v.v })), h('div', { class: 'small muted' }, label || `v${v.v} · ${v.durationSec}초 · ${v.width}×${v.height}`));
  const pick = (k, v) => { state.draft[k] = v; rerender(); };
  const fr = cur && cur.freshness;
  const meta = (v) => h('div', { class: 'small muted', 'data-anim-meta': v.v }, [`v${v.v}`, v.mock ? '목업' : v.manual ? '직접 업로드' : '', v.reused ? '캐시 재사용' : '', v.modelId ? '모델 ' + v.modelId : '', v.clipSec ? `${v.clipSec}초 요청` : '', v.requestId ? '요청 ' + v.requestId : '', v.estimatedUsd != null ? '예상 ' + fmtUsd(v.estimatedUsd) : '', v.createdAt ? String(v.createdAt).slice(0, 16).replace('T', ' ') : ''].filter(Boolean).join(' · '));
  return h('div', { class: 'stack', style: 'gap:12px', 'data-anim-right': sc.id },
    h('div', { class: 'row between' }, h('b', null, '생성된 영상'), chip(STATUS[st][0], STATUS[st][1])),
    running ? h('div', { class: 'banner', 'data-anim-running': sc.id }, h('div', null, h('b', null, '생성 중… '), '새로고침해도 작업은 이어집니다. 끝나면 자동으로 나타납니다.')) : null,
    cur ? (other ? h('div', { class: 'row', style: 'gap:10px;align-items:flex-start;flex-wrap:wrap;justify-content:center', 'data-anim-compare': '' }, player(cur, `v${cur.v} (${cur.status})`), player(other, `v${other.v} (${other.status})`)) : player(cur)) : h('div', { class: 'phone', style: 'max-width:240px;margin:0 auto' }, h('div', { class: 'ph' }, running ? '생성 중…' : '아직 생성된 영상이 없습니다')),
    cur ? meta(cur) : null,
    fr && fr.state === 'stale' ? h('div', { class: 'issue warn', 'data-anim-stale': sc.id }, fr.reason + ' 필요하면 다시 생성하세요 (승인은 자동으로 취소되지 않습니다).') : null,
    cur && cur.warnings && cur.warnings.length ? h('div', { class: 'small', style: 'color:var(--clay)' }, cur.warnings.join(' ')) : null,
    vs.length > 1 ? h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'versions' }, vs.map((v) => h('button', { 'aria-pressed': String(v.v === sel), 'data-anim-version': v.v, onclick: () => pick(key, v.v) }, 'v' + v.v + ({ approved: ' ✓', rejected: ' ✗' }[v.status] || '')))),
      h('div', { class: 'row small', style: 'gap:6px;align-items:center' }, '비교:', h('select', { 'data-anim-compare-select': sc.id, onchange: (e) => pick(cmpKey, e.target.value ? Number(e.target.value) : null) }, [h('option', { value: '' }, '(안 함)')].concat(vs.filter((v) => v.v !== sel).map((v) => h('option', { value: v.v, selected: v.v === cmp }, 'v' + v.v)))))) : null,
    cur ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      cur.status !== 'approved' ? h('button', { class: 'btn sage', type: 'button', 'data-anim-approve': sc.id, onclick: () => review(cur, 'approve', `${sc.id} 클립을 승인했습니다 — 비디오 스튜디오에서 쓸 수 있습니다`) }, icon('check'), '클립 승인') : h('button', { class: 'btn ghost', type: 'button', 'data-anim-unapprove': sc.id, onclick: async () => { if (await confirmDialog({ title: '클립 승인을 취소할까요?', body: '클립 파일은 지워지지 않습니다. 이 장면은 비디오 스튜디오의 조립에서 제외됩니다.', confirm: '승인 취소', tone: 'clay' })) review(cur, 'unapprove', '승인을 취소했습니다'); } }, '승인 취소'),
      cur.status !== 'rejected' ? h('button', { class: 'btn danger', type: 'button', 'data-anim-reject': sc.id, onclick: () => review(cur, 'reject', '거절했습니다 (파일은 보관됩니다)') }, '거절') : null) : null,
    jobs.length ? h('details', { class: 'scene-section', 'data-anim-jobs': sc.id }, h('summary', null, h('span', { class: 'section-title' }, '이 장면의 작업'), h('span', { class: 'small muted' }, `${jobs.length}개`)), h('div', { class: 'section-body stack', style: 'gap:6px' }, jobs.map((j) => h('div', { class: 'card flat stack', style: 'gap:2px' },
      h('div', { class: 'row between' }, h('span', { class: 'mono small' }, j.requestId || '(요청 ID 없음)'), chip({ preparing: '준비 중', submitting: '제출 중', processing: '생성 중', completed: '완료', failed: '실패', uncertain: '확인 필요', polling_interrupted: '확인 중단', download_failed: '다운로드 실패', dismissed: '닫음' }[j.status] || j.status, j.status === 'completed' ? 'done' : BAD_JOB.has(j.status) ? 'err' : '')),
      j.error ? h('div', { class: 'small', style: 'color:var(--rose)' }, j.error.message, j.error.recovery ? h('div', { class: 'muted' }, '→ ' + j.error.recovery) : null) : null,
      h('div', { class: 'small muted' }, j.mode === 'mock' ? '목업 $0' : `예상 ${fmtUsd(j.estimatedUsd)} / 실제 ${j.cost && j.cost.amountUsd != null ? fmtUsd(j.cost.amountUsd) : '—'}`),
      h('div', { class: 'row', style: 'gap:6px' },
        j.requestId && ['processing', 'polling_interrupted', 'download_failed'].includes(j.status) && !ep.derived.jobsRunning ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/jobs/${j.id}/resume`), { ok: '이어서 확인합니다 (추가 요금 없음)' }) }, '다시 확인 (무료)') : null,
        BAD_JOB.has(j.status) ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/jobs/${j.id}/dismiss`)) }, '닫기') : null))))) : null);
}

/** Short animated clips from APPROVED B-roll stills. Same provider, same cost confirmation; shown apart from the scene clip. */
async function startBrollClip(ep, b) {
  const modelId = state.summary.settings.brollModelId || state.summary.settings.defaultModelId;
  let est;
  try { est = await api.post(`/api/episodes/${ep.id}/broll/${b.id}/clip/estimate`, { modelId }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  if (!est.canGenerate) return toast(est.blockers[0] ? est.blockers[0].message : '지금은 만들 수 없습니다', { error: true, recovery: est.blockers[0] && est.blockers[0].recovery });
  const live = est.mode === 'live';
  const ok = await confirmDialog({ title: live ? 'B-roll 클립 유료 생성을 승인할까요?' : 'B-roll 목업 클립을 만들까요?', body: h('div', { class: 'stack small' },
    h('div', null, `${b.id} · 모델 ${est.model.label} · 클립 ${est.clipSec}초 (B-roll ${est.plannedSec}초)`),
    h('div', { style: 'font-family:var(--serif);font-size:26px;font-weight:600' }, live ? (est.totalUsd == null ? '예상 비용: 추정치 없음' : '예상 ' + fmtUsd(est.totalUsd)) : '요금 없음 (목업)'),
    h('div', { class: 'muted' }, '이 한 번의 생성에만 적용됩니다. 실패해도 자동으로 다시 시도하지 않습니다.')), confirm: live ? '승인하고 생성' : '시작', tone: live ? 'clay' : 'sage' });
  if (!ok) return;
  await act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/clip/generate`, { modelId, prompt: est.prompt, confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null }), { ok: 'B-roll 클립 생성을 시작했습니다' });
  [1200, 3500, 8000].forEach((ms) => setTimeout(() => { if (location.hash.startsWith('#/animation')) act(async () => null); }, ms));
}
function brollSection(ep, sc) {
  const list = (sc.broll || []).filter((b) => b.status === 'approved');
  const planned = (sc.broll || []).filter((b) => b.status !== 'removed').length;
  return h('section', { class: 'card stack', style: 'gap:8px', 'data-anim-broll': sc.id },
    h('div', { class: 'row between' }, h('b', null, 'B-roll 애니메이션'), h('span', { class: 'small muted' }, `승인된 B-roll ${list.length} / 전체 ${planned}`)),
    h('div', { class: 'small muted' }, '승인된 B-roll 정지 이미지를 짧은 클립으로 움직입니다. 장면 클립과 별개로 보관되며 장면 갤러리에는 섞이지 않습니다.'),
    list.length ? list.map((b) => {
      const c = b.clip || { versions: [], approvedVersion: null };
      const cur = c.versions.find((v) => v.v === c.approvedVersion) || c.versions[c.versions.length - 1];
      const running = (ep.generation.jobs || []).some((j) => j.brollId === b.id && ACTIVE_JOB.has(j.status));
      return h('div', { class: 'card flat row', style: 'gap:12px;flex-wrap:wrap;align-items:flex-start', 'data-anim-broll-item': b.id },
        b.imageUrl ? h('img', { src: b.imageUrl, alt: '', style: 'width:64px;aspect-ratio:9/16;object-fit:cover;border-radius:8px' }) : null,
        h('div', { class: 'stack', style: 'gap:4px;flex:1;min-width:160px' }, h('b', { class: 'small' }, `${b.id} · ${b.durationSec}초`), h('div', { class: 'small muted' }, b.note || b.effect || ''),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
            h('button', { class: 'btn sm clay', type: 'button', 'data-anim-broll-generate': b.id, disabled: running, onclick: () => startBrollClip(ep, b) }, c.versions.length ? '새 버전 생성…' : '클립 생성…'),
            cur && cur.status !== 'approved' ? h('button', { class: 'btn sm sage', type: 'button', 'data-anim-broll-approve': b.id, onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/clip/${cur.v}/review`, { decision: 'approve' }), { ok: 'B-roll 클립을 승인했습니다' }) }, '승인') : null,
            cur && cur.status === 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/clip/${cur.v}/review`, { decision: 'unapprove' }), { ok: '승인을 취소했습니다' }) }, '승인 취소') : null,
            cur && cur.status !== 'rejected' ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/broll/${b.id}/clip/${cur.v}/review`, { decision: 'reject' })) }, '거절') : null),
          running ? h('div', { class: 'small' }, '생성 중…') : null),
        cur ? h('div', { class: 'stack', style: 'gap:2px;align-items:center' }, h('div', { class: 'phone sm', style: 'max-width:110px' }, h('video', { src: cur.url, controls: true, playsinline: true, muted: true, preload: 'metadata' })), chip('v' + cur.v + ' · ' + ({ approved: '승인됨', pending_review: '검토 대기', rejected: '거절됨' }[cur.status] || cur.status), cur.status === 'approved' ? 'done' : '')) : null);
    }) : h('div', { class: 'small muted' }, '승인된 B-roll 이미지가 아직 없습니다. 스토리보드의 컷 · B-roll에서 이미지를 승인하세요.'));
}

function outfitLockPanel(ep) {
  const cast = (state.summary.characters || []).filter((c) => (ep.characters || []).includes(c.id));
  const selection = Object.fromEntries(Object.entries(ep.outfitLock || {}).map(([id,v]) => [id,{...v}]));
  return h('section', { class: 'card stack', 'data-outfit-lock': '', style: 'gap:10px' },
    h('h2', null, '이 에피소드 의상 고정 · Outfit Lock'),
    h('p', { class: 'small muted' }, '선택한 승인 캐릭터 사진을 이후 시작 이미지 생성에 실제 첨부합니다. 기존 이미지와 영상은 변경되지 않습니다. 의상 변경은 확인 후에만 적용됩니다.'),
    cast.map((c) => h('label', { class: 'field' }, h('span', null, c.name || c.id),
      h('select', { 'data-outfit-select': c.id, onchange: (e) => { if (e.target.value) selection[c.id] = { refId: e.target.value, description: selection[c.id]?.description || '' }; else delete selection[c.id]; } },
        [h('option', { value: '' }, '의상 잠금 없음')].concat((c.references || []).filter((r) => r.approved && !r.placeholder).map((r) => h('option', { value: r.id, selected: selection[c.id]?.refId === r.id }, r.label || r.id)))))),
    h('button', { type: 'button', class: 'btn clay', 'data-outfit-save': '', onclick: async () => {
      const ok = await confirmDialog({ title: '이 에피소드 의상을 승인할까요?', body: '앞으로 생성하는 시작 이미지에 선택한 승인 의상 사진을 실제 전달합니다. 이미 만든 이미지는 덮어쓰지 않으며 재생성에는 별도의 비용 승인이 필요합니다.', confirm: '의상 고정 승인' });
      if (ok) await act(() => api.put('/api/episodes/' + ep.id + '/outfit-lock', { selection, confirm: true }), { ok: '에피소드 의상 잠금이 승인됐습니다.' });
    } }, '의상 선택 승인 및 저장'));
}

export function animationStudio(ep) {
  const u = uiState();
  const cur = ep.scenes.some((s) => s.id === u[ep.id]) ? u[ep.id] : ((ep.scenes.find((s) => !s.clips.approvedVersion) || ep.scenes[0] || {}).id);
  if (!cur) return h('div', { class: 'empty' }, '장면이 없습니다. 대본 스튜디오에서 장면을 만드세요.');
  const sc = ep.scenes.find((s) => s.id === cur);
  return h('div', { class: 'stack', style: 'gap:14px', 'data-animation-studio': '' },
    nav(ep, cur),
    outfitLockPanel(ep),
    h('section', { class: 'card stack', style: 'gap:10px', 'data-anim-workspace': sc.id },
      h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' }, h('div', null, h('div', { class: 'eyebrow' }, `${sc.id} · 계획 ${sc.durationSec}초`), h('h2', { style: 'margin:2px 0 0' }, sc.title_ko || sc.title)), h('span', { class: 'small muted' }, '스토리보드의 승인된 이미지 → 이 장면의 클립 → 비디오 스튜디오에서 조립')),
      gatesPanel(ep, sc),
      h('div', { class: 'anim-cols' }, leftColumn(ep, sc), rightColumn(ep, sc))),
    brollSection(ep, sc));
}
