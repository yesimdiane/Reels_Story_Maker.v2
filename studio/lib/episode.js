// Pure episode logic: fingerprints (what an approval is bound to), validation, and the production pipeline state.
// No I/O here, so it is easy to test.
'use strict';
const { sha256, canonical } = require('./util');
const { claimHits } = require('./claims');
const { cutsFingerprint } = require('./cuts');

const STEP_KEYS = ['product', 'concept', 'script', 'approval', 'storyboard', 'estimate', 'animation', 'clips', 'voice', 'render', 'review', 'publish'];
const STEP_LABELS = {
  product: ['제품·참조', 'Product'],
  concept: ['스토리 컨셉', 'Story concept'],
  script: ['대본', 'Script'],
  approval: ['대본 승인', 'Approval'],
  storyboard: ['스토리보드', 'Storyboard'],
  estimate: ['비용 승인', 'Cost estimate'],
  animation: ['애니메이션 생성', 'Generate animation'],
  clips: ['클립 승인', 'Clip approval'],
  voice: ['음성 생성', 'Generate voices'],
  render: ['렌더', 'Render'],
  review: ['최종 검토', 'Final review'],
  publish: ['게시', 'Publish'],
};

// ---- Korean scene titles (title_ko) ----
const HANGUL = /[가-힣]/;
const GENERIC_TITLES = new Set(['장면', '씬', '컷', '샷', '제품소개', '제품', '소개', '오프닝', '엔딩', '인트로', '아웃트로', '시작', '끝', '마무리', '결말', '도입', '전개', '결론', '클로징', 'cta', '첫장면', '마지막장면', '다음장면', '위기', '절정', '제품연결', '이야기', '엔딩이야기']);
/** Problems with a Korean scene title. errors block (new scripts); warnings are advice (3–12 characters preferred). */
function checkTitleKo(raw) {
  const t = String(raw == null ? '' : raw).trim();
  const errors = [];
  const warnings = [];
  if (!t) { errors.push('한국어 장면 제목이 없습니다.'); return { errors, warnings }; }
  if (!HANGUL.test(t)) errors.push('장면 제목은 한국어여야 합니다.');
  const flat = t.replace(/[\s\d.\-_:·]/g, '').toLowerCase();
  if (/^(장면|씬|scene|shot|cut|s)\d*$/i.test(flat) || GENERIC_TITLES.has(flat)) errors.push(`"${t}"은(는) 너무 일반적인 제목입니다. 장면의 핵심 행동이나 웃음 포인트를 적어 주세요.`);
  const len = [...t].length;
  if (len > 24) errors.push('장면 제목이 너무 깁니다 (24자 이하).');
  else if (len > 12) warnings.push('장면 제목은 3~12자가 보기 좋습니다.');
  else if (len < 3) warnings.push('장면 제목은 3~12자가 보기 좋습니다.');
  return { errors, warnings };
}
/** The title shown everywhere: title_ko, falling back to the legacy `title` of episodes made before title_ko existed. */
const sceneTitle = (s) => String((s && (s.title_ko || s.title)) || '').trim();
/** Strict (blocking) title checks apply to episodes that already use title_ko, i.e. every newly generated script. */
const titlesStrict = (ep) => !!((ep.scenes || []).some((s) => s.title_ko) || (ep.scriptSource && ep.scriptSource.titleKo));

/** What the script approval is bound to: dialogue, Korean subtitles, pacing and the CTA copy. */
function scriptFingerprint(ep) {
  return sha256(
    canonical({
      product: ep.product && ep.product.name,
      lines: (ep.lines || []).map((l) => ({ id: l.id, sceneId: l.sceneId, speaker: l.speaker, en: l.en, ko: l.ko })),
      scenes: (ep.scenes || []).map((s) => ({ id: s.id, durationSec: s.durationSec })),
      cta: { lines: (ep.cta && ep.cta.lines) || [], keyword: ep.cta && ep.cta.keyword, durationSec: ep.cta && ep.cta.durationSec },
    })
  );
}

/** What the storyboard approval is bound to: the approved script plus every scene's visuals, prompts and start image. */
function storyboardFingerprint(ep) {
  return sha256(
    canonical({
      script: scriptFingerprint(ep),
      scenes: (ep.scenes || []).map((s) => ({ id: s.id, characters: s.characters, visual: s.visual, showsProduct: !!s.showsProduct, startImage: s.startImage || null, prompt: ep.prompts && ep.prompts[s.id] ? { video: ep.prompts[s.id].video, negative: ep.prompts[s.id].negative } : null })),
    })
  );
}

const isScriptApproved = (ep) => !!(ep.approvals && ep.approvals.script && ep.approvals.script.hash === scriptFingerprint(ep));
const approvals = require('./approvals');
/** Per-scene, per-field storyboard approval (see approvals.js). Pre-v2 approvals keep the old whole-hash rule. */
const storyboardApprovalStatus = (ep) => approvals.status(ep, scriptFingerprint);
const isStoryboardApproved = (ep) => storyboardApprovalStatus(ep).approved;

/** Rough English speaking time (no API call). Elongated words (BABYYYY) get extra time. */
function estimateSpeechSec(text) {
  const t = String(text || '');
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const stretch = (t.match(/(.)\1{2,}/g) || []).reduce((n, m) => n + (m.length - 2) * 0.045, 0);
  const bangs = Math.min(3, (t.match(/[!?]/g) || []).length) * 0.06;
  return Math.round((words / 2.7 + 0.25 + stretch + bangs) * 100) / 100;
}

// ---- dialogue timing (ESTIMATE; the real recorded duration comes from voice synthesis) ----
const LINE_GAP = 0.18; // pause between two lines of one scene
const SCENE_TAIL = 0.6; // breathing room after the last line
const TIGHT_OVER = 0.05; // above this the scene is "tight" (warning)
const OVERFLOW_OVER = 0.75; // above this the scene is an "overflow" (blocks approval for scripts that follow the fixed formula)

/** Estimated seconds of speech a scene needs for these lines (same model the validator and the prompt use). */
const speechNeed = (lines) => (lines.length ? lines.reduce((n, l) => n + estimateSpeechSec(l.en), 0) + LINE_GAP * (lines.length - 1) + SCENE_TAIL : 0);

/** Maximum total English words that fit a scene of `durationSec` seconds with `nLines` lines (about 2.7 words/s). */
const wordBudget = (durationSec, nLines) => Math.max(0, Math.floor((Number(durationSec) - SCENE_TAIL - LINE_GAP * Math.max(0, nLines - 1) - 0.25 * nLines) * 2.7));

/**
 * Per-scene dialogue timing (estimate). status: ok | tight (a little over) | overflow (clearly over).
 * `overSec` > 0 means the dialogue needs more time than the scene has; the renderer would otherwise extend the scene.
 */
function dialogueTiming(ep) {
  return (ep.scenes || []).map((sc) => {
    const own = (ep.lines || []).filter((l) => l.sceneId === sc.id);
    const need = speechNeed(own);
    const over = Math.round((need - Number(sc.durationSec)) * 100) / 100;
    return { sceneId: sc.id, title: sc.title_ko || sc.title || '', durationSec: Number(sc.durationSec), lineCount: own.length, lineIds: own.map((l) => l.id), words: own.reduce((n, l) => n + String(l.en || '').trim().split(/\s+/).filter(Boolean).length, 0), wordBudget: wordBudget(sc.durationSec, own.length), needSec: Math.round(need * 100) / 100, overSec: over, status: over > OVERFLOW_OVER ? 'overflow' : over > TIGHT_OVER ? 'tight' : 'ok' };
  });
}

function mentions(text, needle) {
  return String(text || '').toLowerCase().includes(String(needle).toLowerCase());
}

/**
 * Validates the script. `lib` is the character library ({ characters: [...] }).
 * errors block approval; warnings do not.
 */
function validateScript(ep, lib) {
  const errors = [];
  const warnings = [];
  const E = (code, message, extra = {}) => errors.push(Object.assign({ code, message }, extra));
  const W = (code, message, extra = {}) => warnings.push(Object.assign({ code, message }, extra));
  const chars = Object.fromEntries(((lib && lib.characters) || []).map((c) => [c.id, c]));
  const scenes = ep.scenes || [];
  // Only episodes explicitly opted into the new policy are restricted to 5s.
  // Existing episodes without this persisted policy keep their historical 15s allowance.
  const maxSceneSec = ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5 ? 5 : 15;
  const sceneIds = new Set();
  scenes.forEach((s) => {
    if (sceneIds.has(s.id)) E('SCENE_DUP', `장면 ID가 중복됩니다: ${s.id}`, { sceneId: s.id, field: 'id' });
    sceneIds.add(s.id);
    const tk = checkTitleKo(s.title_ko);
    if (titlesStrict(ep)) { tk.errors.forEach((m) => E('SCENE_TITLE', `${s.id}: ${m}`, { sceneId: s.id, field: 'title_ko' })); tk.warnings.forEach((m) => W('SCENE_TITLE_LEN', `${s.id}: ${m}`, { sceneId: s.id })); }
    else if (!s.title_ko) W('SCENE_TITLE_MISSING', `${s.id}: 한국어 장면 제목(title_ko)이 없습니다 (이전에 만든 에피소드). 제목을 입력해 두면 모든 화면에서 쓰입니다.`, { sceneId: s.id });
    if (!(s.durationSec >= 1 && s.durationSec <= maxSceneSec)) E('SCENE_DURATION', `${s.id}: 장면 길이는 1~${maxSceneSec}초여야 합니다.`, { sceneId: s.id, field: 'durationSec' });
  });
  if (!scenes.length) E('NO_SCENES', '장면이 없습니다.');
  if (!(ep.lines || []).length) E('NO_LINES', '대사가 없습니다.');
  // Cast: an episode made for a selected cast may only use those characters (older episodes have no cast and keep working as before).
  if (ep.cast && Array.isArray(ep.characters) && ep.characters.length) {
    const allowed = new Set(ep.characters);
    const nm = (id) => (chars[id] ? chars[id].name : id);
    scenes.forEach((s) => (s.characters || []).forEach((id) => { if (!allowed.has(id)) E('OUT_OF_CAST', `${s.id}: ${nm(id)}은(는) 이 에피소드의 출연진이 아닙니다.`, { sceneId: s.id, field: 'characters' }); }));
    (ep.lines || []).forEach((l) => { if (l.speaker && !allowed.has(l.speaker) && chars[l.speaker]) E('OUT_OF_CAST', `${l.sceneId}: 화자 ${nm(l.speaker)}은(는) 이 에피소드의 출연진이 아닙니다.`, { lineId: l.id, sceneId: l.sceneId, field: 'speaker' }); });
  }
  const lineIds = new Set();
  const forbiddenClaims = (ep.product && ep.product.forbiddenClaims) || [];
  const perScene = {};
  (ep.lines || []).forEach((l, i) => {
    const tag = `대사 ${i + 1}`;
    if (lineIds.has(l.id)) E('LINE_DUP', `${tag}: 대사 ID가 중복됩니다 (${l.id}).`, { lineId: l.id, sceneId: l.sceneId, field: 'en' });
    lineIds.add(l.id);
    if (!sceneIds.has(l.sceneId)) E('LINE_SCENE', `${tag}: 존재하지 않는 장면입니다 (${l.sceneId}).`, { lineId: l.id, sceneId: l.sceneId, field: 'en' });
    const c = chars[l.speaker];
    if (!c) E('LINE_SPEAKER', `${tag}: 알 수 없는 화자입니다 (${l.speaker}).`, { lineId: l.id, sceneId: l.sceneId, field: 'speaker' });
    if (!String(l.en || '').trim()) E('LINE_EN', `${tag}: 영어 대사가 비어 있습니다.`, { lineId: l.id, sceneId: l.sceneId, field: 'en' });
    if (!String(l.ko || '').trim()) E('LINE_KO', `${tag}: 한국어 자막이 비어 있습니다 (영어 대사와 자막은 따로 저장됩니다).`, { lineId: l.id, sceneId: l.sceneId, field: 'ko' });
    else if (String(l.ko).trim() === String(l.en).trim()) W('LINE_KO_SAME', `${tag}: 한국어 자막이 영어 대사와 같습니다.`, { lineId: l.id, sceneId: l.sceneId, field: 'ko' });
    if (c) {
      (c.forbiddenWords || []).forEach((w) => {
        if (mentions(l.en, w) || mentions(l.ko, w)) E('FORBIDDEN_WORD', `${tag}: ${c.name}는 "${w}"라고 말하지 않습니다 (캐릭터 규칙).`, { lineId: l.id, sceneId: l.sceneId, field: mentions(l.en, w) ? 'en' : 'ko' });
      });
    }
    [['en', l.en], ['ko', l.ko]].forEach(([field, text]) => claimHits(text, forbiddenClaims).forEach((h) => E('PRODUCT_CLAIM', `${tag}: 확인되지 않은 제품 주장 "${h.claim}"가 있습니다 (…${h.context}…).`, { lineId: l.id, sceneId: l.sceneId, field })));
    (perScene[l.sceneId] = perScene[l.sceneId] || []).push(l);
  });
  // Dialogue must fit its scene. Preferred fix: shorten / drop lines (not extend the scene).
  const formulaEp = require('./formula').isStructured(ep);
  dialogueTiming(ep).forEach((t) => {
    if (t.status === 'ok' || !t.lineCount) return;
    const msg = `${t.sceneId}: 대사가 약 ${t.needSec}초(추정) 필요한데 장면은 ${t.durationSec}초입니다 (${t.overSec}초 초과). 대사를 줄이거나 불필요한 줄을 빼 주세요 — 장면을 늘리는 것은 마지막 수단입니다.`;
    if (t.status === 'overflow' && (formulaEp || ep.timingStrict)) E('SCENE_OVERFLOW', msg, { sceneId: t.sceneId, overSec: t.overSec, field: 'timing', lineId: t.lineIds[t.lineIds.length - 1] });
    else W('SCENE_TIGHT', msg, { sceneId: t.sceneId, overSec: t.overSec, field: 'timing', lineId: t.lineIds[t.lineIds.length - 1] });
  });
  const cta = ep.cta || {};
  const kw = String(cta.keyword || '').trim();
  if (!kw) E('KEYWORD', 'ManyChat 댓글 키워드가 없습니다.', { field: 'cta.keyword' });
  else if (/^PRD-?\d+/i.test(kw)) E('KEYWORD_INTERNAL', `내부 상품 ID("${kw}")를 공개 댓글 키워드로 쓸 수 없습니다.`, { field: 'cta.keyword' });
  if (!(cta.lines || []).length) E('CTA', 'CTA 문구가 없습니다.', { field: 'cta.lines' });
  else if (kw && !(cta.lines || []).some((l) => mentions(l, kw))) E('CTA_KEYWORD', `CTA 문구에 댓글 키워드 "${kw}"가 들어 있어야 합니다.`, { field: 'cta.lines' });
  (cta.lines || []).forEach((l) => claimHits(l, forbiddenClaims).forEach((h) => E('PRODUCT_CLAIM', `CTA: 확인되지 않은 제품 주장 "${h.claim}"가 있습니다 (…${h.context}…).`, { field: 'cta.lines' })));
  if (ep.publishing && ep.publishing.keyword && ep.publishing.keyword !== kw) E('KEYWORD_MISMATCH', 'CTA 키워드와 게시 키워드가 다릅니다.', { field: 'cta.keyword' });
  const total = totalPlannedSec(ep);
  if (total > 300) E('TOO_LONG', `총 길이 ${total.toFixed(1)}초가 인스타그램 릴스 한도(5분 = 300초)를 넘습니다.`);
  else if (total > 60) W('LONG', `총 길이 ${total.toFixed(1)}초 — 릴스는 보통 60초 이하가 좋습니다.`);
  // The episode's maximum video length (set in Story Lab) is a guide, not a gate: going over only warns; scenes are never stretched or trimmed silently.
  const maxSec = Number(ep.maxDurationSec);
  if (maxSec >= 10 && total > maxSec + 0.001) W('TOTAL_OVER_MAX', `참고: 총 길이 ${total.toFixed(1)}초가 이 에피소드의 권장 영상 길이 ${maxSec}초를 넘습니다. 필요하면 장면 길이를 줄이거나 장면을 줄여 보세요 (승인과 다음 단계 진행은 막지 않습니다).`, { field: 'durationSec' });
  // Episodes that follow the fixed formula (Part A: six beats, Part B: exactly three product-ending shots) are checked structurally too.
  const formula = require('./formula');
  if (formula.isStructured(ep)) formula.validateFormula(ep).forEach((e) => errors.push(e));
  return { ok: errors.length === 0, errors, warnings, totalSec: total };
}

function totalPlannedSec(ep) {
  return (ep.scenes || []).reduce((n, s) => n + Number(s.durationSec || 0), 0) + Number((ep.cta && ep.cta.durationSec) || 0);
}

/** Story concept gate. No ctx.concept → pure-logic callers (tests) are not blocked; legacy episodes (no linked concept) stay valid. */
function conceptState(c) {
  if (!c) return { done: true, detail: '' };
  if (c.legacy) return { done: true, detail: '스토리 랩 이전 에피소드' };
  if (c.ok) return { done: true, detail: `${c.conceptId} r${c.revision} 승인됨` };
  if (c.canProceed) return { done: true, detail: c.note || '컨셉이 바뀌었지만 기존 대본으로 진행할 수 있습니다' }; // the script already exists: a later concept edit never blocks it
  return { done: false, attention: true, detail: c.note || '스토리 컨셉 승인 필요' };
}

/**
 * Derived production pipeline. ctx: { jobsRunning:boolean, voiceValid(lineId):boolean, renderState }.
 * Returns [{ key, label, labelEn, state, detail }] with state one of
 * done | current | todo | blocked | attention | processing.
 */
function pipeline(ep, lib, ctx = {}) {
  const v = validateScript(ep, lib);
  const scriptOk = isScriptApproved(ep);
  const sbOk = isStoryboardApproved(ep);
  const scenes = ep.scenes || [];
  const clips = ep.clips || {};
  const anyClip = scenes.some((s) => (clips[s.id] || { versions: [] }).versions.length);
  const allClips = scenes.length > 0 && scenes.every((s) => (clips[s.id] || { versions: [] }).versions.length);
  const allApproved = scenes.length > 0 && scenes.every((s) => clips[s.id] && clips[s.id].approvedVersion);
  const lines = ep.lines || [];
  const voiceDone = lines.length > 0 && lines.every((l) => (ctx.voiceValid ? ctx.voiceValid(l.id) : false));
  const finalRender = (ep.renders || []).filter((r) => !r.preview);
  const lastFinal = finalRender[finalRender.length - 1];
  const clipsMatch = (r) => scenes.length > 0 && scenes.every((s) => {
    const c = clips[s.id];
    const v = c && c.approvedVersion && c.versions.find((x) => x.v === c.approvedVersion);
    const ls = ep.lipsync && ep.lipsync[s.id];
    const lv = ls && ls.approvedVersion && (ls.versions || []).find((x) => x.v === ls.approvedVersion);
    // a dialogue scene is rendered from its approved lip-synced video, a silent scene from the approved animation
    return !!(v && r.clipRefs && r.clipRefs[s.id] && (r.clipRefs[s.id].sha256 === v.sha256 || (lv && r.clipRefs[s.id].sha256 === lv.sha256)));
  });
  const renderFresh = !!(lastFinal && lastFinal.scriptHash === scriptFingerprint(ep) && clipsMatch(lastFinal) && (lastFinal.cutsHash || '') === cutsFingerprint(ep));
  const finalOk = !!(ep.approvals && ep.approvals.final && lastFinal && ep.approvals.final.sha256 === lastFinal.sha256 && renderFresh);
  const pub = ep.publishing || {};
  const states = {
    product: { done: !!(ep.product && ep.product.name && (ep.product.verifiedFeatures || []).length) && ctx.productReady !== false, attention: ctx.productReady === false, detail: ctx.productReady === false ? '참조 이미지/확인된 기능 승인 필요' : ep.product && ep.product.name },
    concept: conceptState(ctx.concept),
    script: { done: v.ok && lines.length > 0, attention: !v.ok && lines.length > 0, detail: v.ok ? `${lines.length}개 대사 · ${v.totalSec.toFixed(0)}초` : `${v.errors.length}개 오류` },
    approval: { done: scriptOk, attention: !!(ep.approvals && ep.approvals.script && !scriptOk), detail: scriptOk ? 'v' + ep.approvals.script.version + ' 승인됨' : ep.approvals && ep.approvals.script ? '승인 후 수정됨 — 다시 승인 필요' : '승인 대기' },
    storyboard: { done: sbOk, attention: !!(ep.approvals && ep.approvals.storyboard && !sbOk), detail: sbOk ? '승인됨' : '승인 대기' },
    estimate: { done: !!(anyClip || (ep.generation.authorizations || []).some((a) => !a.consumed)), detail: anyClip ? '비용 승인됨' : '비용 승인 필요' },
    animation: { done: allClips, processing: !!ctx.jobsRunning, detail: `${scenes.filter((s) => (clips[s.id] || { versions: [] }).versions.length).length}/${scenes.length} 장면` },
    clips: { done: allApproved, detail: `${scenes.filter((s) => clips[s.id] && clips[s.id].approvedVersion).length}/${scenes.length} 승인` },
    voice: { done: voiceDone, detail: `${lines.filter((l) => ctx.voiceValid && ctx.voiceValid(l.id)).length}/${lines.length} 대사` },
    render: { done: renderFresh, attention: !!(lastFinal && !renderFresh), processing: ctx.renderState === 'running', detail: lastFinal ? 'v' + lastFinal.v + (renderFresh ? '' : ' (오래됨)') : '렌더 없음' },
    review: { done: finalOk, detail: finalOk ? '최종 승인됨' : '검토 대기' },
    publish: { done: !!pub.publishedAt, detail: pub.approvedAt ? '문구 승인됨' : '문구 승인 대기' },
  };
  // A step is only reachable when the previous gating steps are done.
  const gate = { script: ['concept'], approval: ['script'], storyboard: ['approval'], estimate: ['storyboard'], animation: ['estimate'], clips: ['animation'], voice: ['approval'], render: ['clips', 'voice'], review: ['render'], publish: ['review'] };
  let currentSet = false;
  return STEP_KEYS.map((key) => {
    const s = states[key];
    const needs = gate[key] || [];
    const blocked = needs.some((k) => !states[k].done);
    let state = s.done ? 'done' : s.processing ? 'processing' : s.attention ? 'attention' : blocked ? 'blocked' : 'todo';
    if (state !== 'done' && state !== 'blocked' && !currentSet) {
      currentSet = true;
      if (state === 'todo') state = 'current';
    }
    return { key, label: STEP_LABELS[key][0], labelEn: STEP_LABELS[key][1], state, detail: s.detail || '' };
  });
}

module.exports = { dialogueTiming, speechNeed, wordBudget, TIGHT_OVER, OVERFLOW_OVER, checkTitleKo, sceneTitle, titlesStrict, scriptFingerprint, storyboardFingerprint, storyboardApprovalStatus, isScriptApproved, isStoryboardApproved, validateScript, estimateSpeechSec, totalPlannedSec, pipeline, STEP_KEYS };
