import { h, chip, icon, toast, confirmDialog } from '../ui.js';
import { state, act, requireEpisode, refresh, hooks } from '../state.js';
import { api } from '../api.js';
import { pipelineBar, noEpisode, episodePicker, confirmPaid } from './common.js';
import { presetPanel } from './script-prompt.js';
import { formulaLayout } from './script-formula.js';
import { timingCard } from './script-timing.js';
import { errorIndex, attach, summary as errorSummary, jumpTo } from './script-validate.js';
import { structureMap } from './structure-map.js';
import { planStep, planReorder } from '../scene-order-core.js';
import { announce } from './scene-dnd.js';
import { projectPanel } from './script-project.js';
import { sceneFocus, sceneNavigator, currentSceneId, setFocus, switchScene, addScene, duplicateScene, saveAllDirty } from './script-focus.js';
import { guardLeave } from './leave-guard.js';
import { versionMenu, versionManager } from './episode-actions.js';
import { draftOf } from './script-draft.js';
import { collapsedNow, setCollapsed } from './scene-collapse.js';

// Wide screens (PC) show EVERY scene, S1 … last, as stacked cards; narrow screens (phone) show one scene at a time.
const WIDE = window.matchMedia('(min-width: 901px)');
WIDE.addEventListener('change', () => { if (state.view === 'script') hooks.rerender(); });

export function script() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const d = draftOf(ep);
  const chars = state.summary.characters; // all library characters (names/avatars); scene pickers use ep.characters
  const v = ep.derived.validation;
  const index = errorIndex(ep);
  const sid = currentSceneId(ep);

  // ---- episode-level fields (title, story beats, CTA, ending values) are saved separately from scenes ----
  const dirtyEp = () => { d.epDirty = true; for (const b of [epSave, ctaSave]) { b.disabled = false; b.textContent = '에피소드 설정 저장'; } };
  const epSave = h('button', { class: 'btn sm', type: 'button', disabled: !d.epDirty, onclick: () => saveEpisode() }, d.epDirty ? '에피소드 설정 저장' : '저장됨');
  // the CTA box lives outside the folded episode tools, so it carries its own save button (same action)
  const ctaSave = h('button', { class: 'btn sm', type: 'button', 'data-cta-save': '', disabled: !d.epDirty, onclick: () => saveEpisode() }, d.epDirty ? '에피소드 설정 저장' : '저장됨');
  async function saveEpisode() {
    try {
      const patch = { title: d.title, titleEn: d.titleEn, beats: d.beats, cta: d.cta, ...(d.comedy_story ? { comedy_story: d.comedy_story, product_ending: d.product_ending, ending: { vars: d.endingVars } } : {}) };
      const r = await api.put(`/api/episodes/${ep.id}/script`, patch);
      state.draft.script = null;
      state.episode = r;
      toast('에피소드 설정을 저장했습니다');
      await refresh();
      hooks.rerender();
      return true;
    } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return false; }
  }
  const ctx = { index, chars, saveEpisode, onChangeOuter: null };
  // reorder (drag handle / keyboard): plan with scene-order-core, save with the existing reorder endpoint; scene IDs and contents never change
  ctx.moveScene = (sid0, delta) => reorderWith(ep, d, planStep(ep, sid0, delta), sid0);
  ctx.dropScene = (sid0, toIndex) => reorderWith(ep, d, planReorder(ep, sid0, toIndex), sid0);
  const addSceneHere = (beatKey) => addScene(ep, d, ctx, beatKey);
  ctx.duplicateScene = (sid) => duplicateScene(ep, d, ctx, sid);
  ctx.addScene = (afterSid) => addScene(ep, d, ctx, undefined, afterSid);
  const wide = WIDE.matches;
  const focusScene = (id) => switchScene(ep, d, id, ctx);
  // chip click on the story map: phone = switch to that scene; PC = unfold its card, scroll to it and flash it
  const openSceneFromMap = async (sceneId) => {
    if (!wide) return focusScene(sceneId);
    if (collapsedNow(ep.id, sceneId)) { setCollapsed(ep.id, sceneId, false); await hooks.rerender(); }
    const card = document.getElementById('script-scene-' + sceneId);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('highlight-flash'); void card.offsetWidth; card.classList.add('highlight-flash');
    setTimeout(() => card.classList.remove('highlight-flash'), 1300);
  };
  // leaving this page with unsaved edits asks first (see main.js)
  state.leaveGuard = { dirty: () => !!(d.dirty || d.epDirty), save: () => saveAllDirty(ep, d, ctx) };

  const cards = wide ? ep.scenes.map((s) => sceneFocus(ep, d, ctx, s.id, { inline: true })) : null;
  const focus = wide ? null : sceneFocus(ep, d, ctx);
  const onJump = async (e) => {
    if (wide) return jumpTo(e); // every scene is on the page
    const target = e.sceneId || ((d.lines.find((l) => l.id === e.lineId) || {}).sceneId) || ((ep.scenes.find((s) => s.beatKey === e.beatKey) || {}).id);
    if (target && target !== sid) { await switchScene(ep, d, target, ctx); setTimeout(() => jumpTo(e), 200); return true; }
    return jumpTo(e);
  };

  const wrap = h('div', { class: 'stack script-studio', style: 'gap:14px' });
  const picker = episodePicker(); // the title / intro banner is gone; keep the episode switch
  if (picker) wrap.append(h('div', { class: 'row', style: 'justify-content:flex-end' }, picker));
  wrap.append(structureMap(ep, { dirty: () => d.dirty || d.epDirty, addSceneIn: ep.formula.structured ? addSceneHere : null, openScene: openSceneFromMap })); // story map first: the whole episode at a glance
  wrap.append(assetStrip(ep));
  wrap.append(projectPanel(ep, d, errorSummary(ep, index, { onJump })));
  if (ep.derived.scriptChangedSinceApproval) wrap.append(h('div', { class: 'banner warn' }, h('div', null, h('b', null, '승인 후 대본이 수정되었습니다'), '유료 생성·음성·렌더가 잠겼습니다. 바뀐 씬을 다시 확인하고 승인하세요.')));
  wrap.append(sceneNavigator(ep, d, ctx, { list: wide }));

  // ---- episode tools (collapsed): everything that is not about the current scene ----
  const presetBox = ep.derived.concept.linked ? presetPanel(ep) : null;
  if (presetBox) presetBox.style.display = 'contents';
  const panelRow = h('div', { class: 'panel-row' }, conceptPanel(ep, d), presetBox, timingCard(ep, { d, dirty: dirtyEp, redrawAll: () => hooks.rerender() }));
  panelRow.addEventListener('click', (e) => {
    const head = e.target.closest('.card-head');
    if (!head || e.target.closest('a,button,select,input,textarea')) return;
    head.closest('.card').classList.toggle('open');
  });
  const episodeCard = h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'grid two' },
      h('div', { class: 'field' }, h('label', null, '제목 (한국어)'), h('input', { type: 'text', value: d.title, oninput: (e) => { d.title = e.target.value; dirtyEp(); } })),
      h('div', { class: 'field' }, h('label', null, 'Title (English)'), h('input', { type: 'text', value: d.titleEn, oninput: (e) => { d.titleEn = e.target.value; dirtyEp(); } }))),
    h('div', { class: 'field' }, h('label', null, '스토리 비트 (한 줄에 하나)'), h('textarea', { rows: 4, oninput: (e) => { d.beats = e.target.value.split('\n').filter((x) => x.trim()); dirtyEp(); } }, d.beats.join('\n'))));
  // End card / CTA: the ManyChat keyword (required by the server: KEYWORD / CTA_KEYWORD / KEYWORD_MISMATCH) is always visible under the last story beat;
  // the CTA lines and card length are folded and open by themselves when they carry a validation error.
  const ctaHasError = ['cta:lines', 'cta:durationSec'].some((k) => (index.byKey[k] || []).length);
  const ctaBox = h('div', { class: 'card stack', style: 'gap:10px', 'data-cta-box': '' },
    h('div', { class: 'card-head' }, h('h3', null, '엔드 카드 · CTA'), chip('한국어', '')),
    attach(index, h('div', { class: 'field' }, h('label', null, 'ManyChat 댓글 키워드 (공개)'), h('input', { type: 'text', value: d.cta.keyword, 'data-cta-keyword': '', oninput: (e) => { d.cta.keyword = e.target.value; dirtyEp(); } })), 'cta:keyword'),
    h('details', { 'data-cta-details': '', open: ctaHasError },
      h('summary', null, 'CTA 문구 · 엔드 카드 길이'),
      h('div', { class: 'stack', style: 'gap:12px;margin-top:10px' },
        attach(index, h('div', { class: 'field' }, h('label', null, 'CTA 문구 (한 줄에 하나 — 영상 마지막에 표시)'), h('textarea', { rows: 4, lang: 'ko', oninput: (e) => { d.cta.lines = e.target.value.split('\n').filter((x) => x.trim()); dirtyEp(); } }, d.cta.lines.join('\n'))), 'cta:lines'),
        attach(index, h('div', { class: 'field' }, h('label', null, '엔드 카드 길이 (초)'), h('input', { type: 'number', min: 0, max: 8, step: 0.5, value: d.cta.durationSec, oninput: (e) => { d.cta.durationSec = Number(e.target.value); dirtyEp(); } })), 'cta:durationSec'),
        h('p', { class: 'small muted', style: 'margin:0' }, 'CTA 문구에는 위 키워드가 들어 있어야 합니다. 이모지(☂️ 등)는 캡션에는 남지만 영상 자막으로는 그려지지 않습니다. 내부 상품 ID는 공개 키워드로 쓸 수 없습니다.'))),
    h('div', { class: 'row' }, ctaSave, d.epDirty ? h('span', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 에피소드 설정이 있습니다') : null));
  if (wide) {
    // the CTA box sits right after the card of the last story beat (product bridge); the fixed ending scenes follow it
    const els = cards.map((c) => c.el);
    const lastBeat = ep.scenes.reduce((at, x, k) => (x.beatKey === 'product_bridge' && x.part !== 'B' ? k : at), -1);
    els.splice((lastBeat >= 0 ? lastBeat : els.length - 1) + 1, 0, ctaBox);
    wrap.append(h('div', { class: 'stack scene-list', style: 'gap:16px' }, els));
  }
  else { wrap.append(focus.el); wrap.append(ctaBox); }
  const tools = h('details', { class: 'card episode-tools', 'data-episode-tools': '1', open: !!(state.ui && state.ui.toolsOpen) },
    h('summary', null, h('b', null, '에피소드 도구'), h('span', { class: 'small muted' }, ' 스토리 컨셉 · 프롬프트 · 대사 시간 · 제목 · 엔딩')),
    h('div', { class: 'stack', style: 'gap:14px;margin-top:12px' },
      panelRow, episodeCard,
      ep.formula.structured ? formulaLayout({ ep, d, blocks: [], dirty: dirtyEp, redrawAll: () => hooks.rerender(), v, index, addSceneIn: addSceneHere, dupScene: ctx.duplicateScene, focusScene }) : null,
      h('div', { class: 'row' }, epSave, d.epDirty ? h('span', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 에피소드 설정이 있습니다') : null)));
  tools.addEventListener('toggle', () => { state.ui = state.ui || { open: {} }; state.ui.toolsOpen = tools.open; });
  wrap.append(tools);

  // version history of the whole script (compact)
  wrap.append(h('details', { class: 'card' }, h('summary', null, h('b', null, '버전 기록'), h('span', { class: 'small muted' }, ` ${ep.derived.versions.length}개`)),
    ep.derived.versions.length ? h('div', { class: 'list', style: 'margin-top:10px' }, ep.derived.versions.slice().reverse().slice(0, 8).map((vv) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'v' + vv.version + (ep.approvals.script && ep.approvals.script.version === vv.version ? ' · 승인됨' : '')), h('div', { class: 'small muted' }, new Date(vv.at).toLocaleString('ko-KR') + (vv.note ? ' · ' + vv.note : ''))), h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, vv.version === ep.version ? chip('현재', 'done') : h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { if (isUnsaved()) return toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', { error: true }); if (await confirmDialog({ title: `v${vv.version}로 되돌릴까요?`, body: '현재 내용은 새 버전으로 남습니다. 대본 승인은 무효가 될 수 있습니다.', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/versions/${vv.version}/restore`), { ok: `v${vv.version}을 복원했습니다` }); } }, '복원'), versionMenu(ep, { version: vv.version, current: vv.version === ep.version, canDelete: vv.version !== ep.version, wasApproved: !!(ep.approvals.script && ep.approvals.script.version === vv.version) || !!vv.wasApproved }, () => act(async () => null)))))) : h('div', { class: 'muted small' }, '저장하면 버전이 쌓입니다.'),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm ghost', type: 'button', 'data-version-manager': '', onclick: () => versionManager(ep) }, '삭제한 버전 포함 모두 보기'))));
  function isUnsaved() { return !!(d.dirty || d.epDirty); }

  // sticky bottom action bar (mobile: full width above the tab bar, safe-area and keyboard aware; desktop: floating bottom-right)
  if (!wide) wrap.append(focus.bar);
  return wrap;
}

/** Concept → script traceability + AI script generation (only from an approved concept). */
function conceptPanel(ep, d) {
  const c = ep.derived.concept;
  if (!c.linked) return h('div', { class: 'banner mock' }, chip('레거시', 'mock'), h('div', null, h('b', null, '스토리 랩 이전에 만든 에피소드입니다'), c.note + '. 이 에피소드의 대본은 기존 방식대로 편집·승인할 수 있습니다. 새 에피소드는 Story Lab에서 컨셉을 승인한 뒤 시작합니다.'));
  const src = ep.scriptSource;
  const route = (state.summary.ai.routing || []).find((r) => r.task === 'scriptWriting') || { provider: 'mock' };
  const generate = async (overwrite) => {
    let est;
    try { est = await api.post(`/api/episodes/${ep.id}/script/estimate`, {}); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
    const confirm = await confirmPaid({ title: overwrite ? 'AI로 대본 다시 만들기' : 'AI로 대본 만들기', est, confirmLabel: '대본 생성', body: h('p', { class: 'small muted', style: 'margin:0' }, '승인된 컨셉 "' + c.title + '" (r' + c.revision + ')와 확인된 제품 사실, 캐릭터 규칙, Prompt Manager의 대본 프롬프트로 장면별 대사·행동·내레이션·타이밍·제품 배치·CTA를 만듭니다. ' + (overwrite ? '현재 대본은 버전 기록에 남고, 새 대본은 다시 승인해야 합니다.' : '결과는 초안이며 승인 전에는 아무것도 진행되지 않습니다.')) });
    if (confirm === null) return;
    state.draft.script = null;
    await act(() => api.post(`/api/episodes/${ep.id}/script/generate`, { confirm, overwrite }), { ok: '대본 초안을 만들었습니다 (검토 후 승인하세요)' });
  };
  return h('div', { class: 'card stack', style: 'gap:10px' },
    h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, '스토리 컨셉 → 대본'), h('h3', null, c.title || ep.concept.title)), c.ok ? chip(`${c.conceptId} r${c.revision} 승인됨`, 'done') : chip(c.state === 'script_stale' ? '컨셉이 바뀜 · 대본 재생성 필요' : '컨셉 승인 필요', 'attention')),
    !c.ok ? h('div', { class: 'banner warn' }, h('div', null, c.note, ' ', h('a', { href: '#/storylab/' + ep.productId }, 'Story Lab에서 확인'))) : null,
    src ? h('div', { class: 'small muted' }, `생성: ${src.mock ? '샘플 응답' : src.provider + ' / ' + src.model} · ${src.presetId ? '프리셋 ' + src.presetName + ' v' + src.presetVersion + ' · 강도 ' + src.comedyLevel : '대본 프롬프트 v' + src.promptVersion} · 컨셉 r${src.conceptRevision} · ${new Date(src.generatedAt).toLocaleString('ko-KR')}`) : h('div', { class: 'small muted' }, '아직 AI 대본이 없습니다. 직접 작성하거나 아래 버튼으로 초안을 만드세요.'),
    route.provider === 'mock' ? h('div', { class: 'small', style: 'color:var(--clay)' }, '대본 AI가 연결되지 않아 샘플 대본이 만들어집니다 (Settings → AI 연동).') : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !c.approved, onclick: () => generate(ep.formula.structured ? ep.scenes.some((x) => x.part === 'A') : ep.lines.length > 0) }, ep.formula.structured ? (ep.scenes.some((x) => x.part === 'A') ? 'AI로 코미디 스토리 다시 만들기 (PART A)' : 'AI로 코미디 스토리 만들기 (PART A)') : (ep.lines.length ? 'AI로 대본 다시 만들기' : 'AI로 대본 만들기')), d.dirty ? h('span', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 변경은 다시 만들면 사라집니다') : null));
}


/** Compact asset availability (no galleries, no previews): product reference photos and per-character reference / voice readiness. */
function assetStrip(ep) {
  const a = ep.derived.assets;
  if (!a) return h('div', null);
  const item = (label, ok, okText, needText) => h('span', { class: 'asset-chip ' + (ok ? 'ok' : 'need'), 'data-asset': label }, h('b', null, label + ': '), ok ? okText : needText);
  return h('div', { class: 'asset-strip', 'data-asset-strip': '' },
    item('제품 사진', a.product.ready, '준비 완료', '필요'),
    ...a.characters.map((c) => { const v = c.voice || {}; const vok = c.voiceReady; return h('span', { class: 'asset-chip ' + (c.referenceReady && vok ? 'ok' : 'need'), 'data-asset': c.name }, h('b', null, c.name + ': '), c.referenceReady ? '캐릭터 데이터 완료' : '캐릭터 이미지 필요', ' / ',
      vok ? `${v.providerLabel || ''} · ${v.name || ''}` : (v.message || c.voiceNote || '목소리 미지정'),
      !vok && v.action === 'connect' ? h('a', { href: '#/settings', 'data-connect-provider': '', style: 'margin-left:6px', onclick: () => (state.settingsTab = 'voices') }, '제공자 연결') : null,
      v.state && v.state !== 'ready' ? h('a', { href: '#/settings/characters', 'data-change-voice': '', style: 'margin-left:6px' }, '목소리 변경') : null); }));
}

let ordering = false;
/** Saves a planned scene move. One move at a time; unsaved text edits must be saved first (a reorder reloads the page state). */
async function reorderWith(ep, d, plan, sid) {
  if (plan.noop) return;
  if (plan.error) return toast(plan.error.message, { error: true });
  if (d.dirty || d.epDirty) return toast('저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 순서를 바꾸세요.', { error: true });
  if (ordering) return;
  ordering = true;
  try {
    state.draft.script = null;
    await act(() => api.post(`/api/episodes/${ep.id}/scenes/reorder`, plan.body), { ok: '장면 순서를 바꿨습니다 (대본 승인은 다시 필요합니다)' });
    const pos = plan.order.indexOf(sid) + 1;
    announce(`${sid} 씬이 ${pos}번째로 이동했습니다`);
    requestAnimationFrame(() => { const hnd = document.querySelector(`[data-scene-handle="${sid}"]`); if (hnd) hnd.focus({ preventScroll: false }); });
  } finally { ordering = false; }
}
