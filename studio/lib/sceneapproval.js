// Per-scene approval: every scene is its own independently versioned unit inside the episode (= one persistent production project).
//   Statuses (derived, never stored): draft | needs_changes | ready | approved
//   An approval is bound to the scene's content fingerprint. Editing an approved scene never overwrites the approved version:
//   the approved snapshot stays in ep.sceneApprovals[sceneId].history and the scene falls back to "needs approval" until a new revision is approved.
// Pure functions over an episode object (callers persist).
'use strict';
const { sha256, canonical, nowIso, StudioError } = require('./util');
const { validateScript, sceneTitle } = require('./episode');
const { claimHits } = require('./claims');
const { insertsCore } = require('./cuts');
const F = require('./formula');

const STATUS_LABEL = { draft: '초안', needs_changes: '수정 필요', ready: '승인 가능', approved: '승인됨' };

const sceneOf = (ep, sid) => (ep.scenes || []).find((s) => s.id === sid);
const linesOf = (ep, sid) => (ep.lines || []).filter((l) => l.sceneId === sid);

/** The part of a scene an approval is bound to. Korean titles and beat metadata are excluded (a title edit does not un-approve, like the script approval). */
function sceneContent(ep, sid) {
  const s = sceneOf(ep, sid) || {};
  const ins = insertsCore(s); // insert shots (close-ups) are part of the scene version; omitted when empty so older approvals keep their hash
  return {
    scene: { id: s.id, part: s.part || '', beatKey: s.beatKey || '', durationSec: s.durationSec, characters: s.characters || [], showsProduct: !!s.showsProduct, visual: s.visual || '', action: s.action || '', narration: s.narration || '', placement: s.placement || '', ...(s.emotion ? { emotion: s.emotion } : {}), ...(ins.length ? { inserts: ins } : {}) },
    lines: linesOf(ep, sid).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko })),
  };
}
const sceneFingerprint = (ep, sid) => sha256(canonical(sceneContent(ep, sid)));

/** Snapshot kept in the approval history (includes the title so the old version can be read as it was). */
function sceneSnapshot(ep, sid) {
  const c = sceneContent(ep, sid);
  const s = sceneOf(ep, sid) || {};
  c.scene.title_ko = sceneTitle(s);
  return c;
}

const record = (ep, sid) => ((ep.sceneApprovals = ep.sceneApprovals || {})[sid] = ep.sceneApprovals[sid] || { current: null, history: [], events: [] });
const isSceneApproved = (ep, sid) => !!(ep.sceneApprovals && ep.sceneApprovals[sid] && ep.sceneApprovals[sid].current && ep.sceneApprovals[sid].current.hash === sceneFingerprint(ep, sid) && sceneOf(ep, sid));

// ---- validation of ONE scene ----
const TEXT_FIELDS = [['visual', '시각 연출'], ['action', '캐릭터 행동'], ['emotion', '캐릭터 감정'], ['narration', '내레이션'], ['placement', '제품 배치']];

/**
 * Errors/warnings that belong to one scene. Each carries { sceneId, field, lineId? } so the UI can jump to the exact input.
 * Project-level problems (CTA, total length, …) are NOT part of a scene: a missing subtitle blocks only its own scene.
 */
function validateScene(ep, lib, sid, whole) {
  const v = whole || validateScript(ep, lib);
  const s = sceneOf(ep, sid);
  const errors = [];
  const warnings = [];
  if (!s) return { errors: [{ code: 'NOT_FOUND', message: '장면을 찾을 수 없습니다.', sceneId: sid }], warnings, ok: false };
  const own = new Set(linesOf(ep, sid).map((l) => l.id));
  const mine = (e) => e.sceneId === sid || (e.lineId && own.has(e.lineId)) || (e.beatKey && e.beatKey === s.beatKey);
  v.errors.filter(mine).forEach((e) => errors.push(Object.assign({}, e, { sceneId: sid })));
  v.warnings.filter(mine).forEach((e) => warnings.push(Object.assign({}, e, { sceneId: sid })));
  const E = (code, message, field) => errors.push({ code, message, sceneId: sid, field });
  // Required scene fields (optional ones — narration, product placement, action — never produce a blocking error).
  if (!String(s.visual || '').trim()) E('SCENE_VISUAL', `${sid}: 시각 연출이 비어 있습니다. 이미지 제작에 쓰이므로 꼭 필요합니다.`, 'visual');
  if (!sceneTitle(s)) { if (!errors.some((e) => e.field === 'title_ko')) E('SCENE_TITLE', `${sid}: 한국어 장면 제목이 없습니다.`, 'title_ko'); }
  if (!(s.characters || []).length) warnings.push({ code: 'SCENE_CAST', message: `${sid}: 등장 캐릭터가 선택되지 않았습니다.`, sceneId: sid, field: 'characters' });
  // Animation is planned second by second: "0.0–1.2 s: ..." segments covering the scene (advice, never blocking).
  if (String(s.visual || '').trim()) {
    const tl = timeline(s.visual);
    if (!tl.segments) warnings.push({ code: 'SCENE_NO_TIMELINE', message: `${sid}: 애니메이션을 초 단위로 계획해 주세요 (예: "0.0–1.2 s: …  1.2–2.5 s: …"). 영상 모델이 장면 길이 안에서 정확히 움직일 수 있습니다.`, sceneId: sid, field: 'visual' });
    else if (Math.abs(tl.end - Number(s.durationSec)) > 0.6) warnings.push({ code: 'SCENE_TIMELINE_LENGTH', message: `${sid}: 애니메이션 타임라인이 ${tl.end}초에서 끝나는데 장면은 ${s.durationSec}초입니다.`, sceneId: sid, field: 'visual' });
  }
  // Story information of the beat this scene belongs to (Part A: the beat's story line; formula episodes only).
  if (F.isStructured(ep) && s.part === 'A') {
    const b = (ep.comedy_story || {})[s.beatKey] || {};
    if (!String(b.story_en || '').trim() && !String(s.action || '').trim() && !String(s.visual || '').trim()) E('SCENE_STORY', `${sid}: 이 장면이 속한 스토리 단계의 내용이 비어 있습니다.`, 'visual');
  }
  // Relevant product claims must be verified: the scene's own direction text is checked like its dialogue.
  const forbidden = (ep.product && ep.product.forbiddenClaims) || [];
  TEXT_FIELDS.forEach(([field, label]) => claimHits(s[field], forbidden).forEach((h) => E('PRODUCT_CLAIM', `${sid} ${label}: 확인되지 않은 제품 주장 "${h.claim}"가 있습니다 (…${h.context}…).`, field)));
  // A scene shown with the product needs at least one verified feature on the product to be truthful about.
  if (s.showsProduct && !((ep.product && ep.product.verifiedFeatures) || []).length) warnings.push({ code: 'SCENE_NO_VERIFIED_FEATURE', message: `${sid}: 제품이 나오지만 확인된 기능이 등록되어 있지 않습니다.`, sceneId: sid, field: 'showsProduct' });
  return { errors, warnings, ok: errors.length === 0 };
}

/** Reads "0.0–1.2 s:" style segments from a direction text: { segments, end }. */
function timeline(text) {
  const re = /(\d+(?:\.\d+)?)\s*[–\-~]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|초)\b/gi;
  let m; let n = 0; let end = 0;
  while ((m = re.exec(String(text || '')))) { n += 1; end = Math.max(end, Number(m[2])); }
  return { segments: n, end };
}

const hasContent = (ep, sid) => { const s = sceneOf(ep, sid) || {}; return linesOf(ep, sid).length > 0 || !!String(s.visual || '').trim() || !!String(s.action || '').trim() || !!sceneTitle(s); };

/** Status + details of one scene. */
function sceneState(ep, lib, sid, whole) {
  const val = validateScene(ep, lib, sid, whole);
  const rec = (ep.sceneApprovals || {})[sid] || { current: null, history: [], events: [] };
  const approved = isSceneApproved(ep, sid);
  const wasApproved = rec.history.length > 0;
  let status;
  if (approved) status = 'approved';
  else if (!hasContent(ep, sid) && !wasApproved) status = 'draft';
  else if (val.errors.length) status = 'needs_changes';
  else status = 'ready';
  const last = rec.history[rec.history.length - 1] || null;
  return {
    sceneId: sid, status, label: STATUS_LABEL[status], errors: val.errors, warnings: val.warnings, errorCount: val.errors.length,
    approved, revision: approved && rec.current ? rec.current.rev : null, nextRevision: rec.history.length + 1,
    editedAfterApproval: !approved && wasApproved && !!rec.current,
    approvedAt: approved && rec.current ? rec.current.at : null, approvedBy: approved && rec.current ? rec.current.by : '',
    history: rec.history.map((h) => ({ rev: h.rev, at: h.at, by: h.by, hash: h.hash, revokedAt: h.revokedAt || null, supersededAt: h.supersededAt || null, current: !!(rec.current && rec.current.rev === h.rev && approved) })),
    lastApprovedRev: last ? last.rev : null,
    events: rec.events.slice(-12),
  };
}

/** Project-level readiness: every scene approved + project validation + (formula) six beats, three-shot ending and a valid ending template. */
function projectReadiness(ep, lib) {
  const whole = validateScript(ep, lib);
  const scenes = (ep.scenes || []).map((s) => sceneState(ep, lib, s.id, whole));
  const approvedCount = scenes.filter((s) => s.approved).length;
  const blockers = [];
  const sceneIds = new Set((ep.scenes || []).map((s) => s.id));
  const own = (e) => (e.sceneId && sceneIds.has(e.sceneId)) || (e.lineId && (ep.lines || []).some((l) => l.id === e.lineId)) || (e.beatKey && (ep.scenes || []).some((s) => s.beatKey === e.beatKey));
  // problems that belong to no single scene
  whole.errors.filter((e) => !own(e) || e.code === 'BEAT_MISSING').forEach((e) => blockers.push({ code: e.code, message: e.message, field: e.field || '', scope: 'project' }));
  if (!(ep.scenes || []).length) blockers.push({ code: 'NO_SCENES', message: '장면이 없습니다.', scope: 'project' });
  const pending = scenes.filter((s) => !s.approved);
  if (pending.length) blockers.push({ code: 'SCENES_PENDING', message: `아직 승인되지 않은 장면 ${pending.length}개: ${pending.map((s) => s.sceneId).join(', ')}`, scope: 'scenes', sceneIds: pending.map((s) => s.sceneId) });
  return {
    sceneCount: scenes.length, approvedCount, progress: `${approvedCount}/${scenes.length} 씬 승인`,
    scenes, blockers, validationOk: whole.ok,
    allScenesApproved: scenes.length > 0 && approvedCount === scenes.length,
    readyScenes: scenes.filter((s) => s.status === 'ready').map((s) => s.sceneId),
    canApprove: blockers.length === 0,
  };
}

// ---- mutations (callers run them inside store.episodes.update) ----
function approveScene(ep, lib, sid, by = 'operator') {
  if (!sceneOf(ep, sid)) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sid, { status: 404 });
  const st = sceneState(ep, lib, sid);
  if (st.approved) return st;
  if (st.errors.length) throw new StudioError('SCENE_INVALID', `${sid} 장면을 승인할 수 없습니다: ${st.errors[0].message}`, { details: st.errors, recovery: '빨간 표시된 항목을 고친 뒤 저장하고 다시 승인하세요.', status: 409 });
  const rec = record(ep, sid);
  const rev = rec.history.length + 1;
  const at = nowIso();
  // The previous approved version stays in history; the new one is a new revision.
  const prev = rec.history[rec.history.length - 1];
  if (prev && !prev.supersededAt) prev.supersededAt = at;
  const entry = { rev, hash: sceneFingerprint(ep, sid), by, at, snapshot: sceneSnapshot(ep, sid) };
  rec.history.push(entry);
  rec.current = { rev, hash: entry.hash, by, at };
  rec.events.push({ type: 'approved', rev, at, by });
  return sceneState(ep, lib, sid);
}

function revokeScene(ep, sid, by = 'operator') {
  const rec = (ep.sceneApprovals || {})[sid];
  if (!rec || !rec.current) throw new StudioError('NOT_APPROVED', '승인된 장면이 아닙니다.', { status: 409 });
  const at = nowIso();
  const h = rec.history.find((x) => x.rev === rec.current.rev);
  if (h) h.revokedAt = at;
  rec.events.push({ type: 'revoked', rev: rec.current.rev, at, by });
  rec.current = null;
}

/** Before/after hooks of every episode write: notes scenes whose approved version was changed (the approved snapshot is kept in history). */
function approvedSet(ep) { return new Set((ep.scenes || []).map((s) => s.id).filter((id) => isSceneApproved(ep, id))); }
function noteEdits(ep, before) {
  if (!before || !before.size || !ep.sceneApprovals) return;
  const at = nowIso();
  before.forEach((sid) => {
    const rec = ep.sceneApprovals[sid];
    if (!rec) return;
    const gone = !sceneOf(ep, sid);
    if (gone || !isSceneApproved(ep, sid)) {
      const rev = rec.current ? rec.current.rev : null;
      rec.events.push({ type: gone ? 'removed' : 'edited', rev, at, by: 'operator' });
      if (gone) { const h = rec.history.find((x) => x.rev === rev); if (h) h.revokedAt = at; rec.current = null; }
    }
  });
}

/**
 * Old episodes: a script that was approved before scene approvals existed keeps every scene approved (by "migration"),
 * so nothing that was approved silently becomes unapproved. Idempotent; never touches ep.approvals.
 */
function migrateSceneApprovals(ep, lib) {
  if (ep.sceneApprovals || !ep.approvals || !ep.approvals.script) return false;
  const { isScriptApproved } = require('./episode');
  ep.sceneApprovals = {};
  if (!isScriptApproved(ep)) return true; // the approval is already stale; nothing to carry over
  const at = (ep.approvals.script && ep.approvals.script.at) || nowIso();
  (ep.scenes || []).forEach((s) => {
    const rec = record(ep, s.id);
    const hash = sceneFingerprint(ep, s.id);
    rec.history.push({ rev: 1, hash, by: 'migration', at, snapshot: sceneSnapshot(ep, s.id), migrated: true });
    rec.current = { rev: 1, hash, by: 'migration', at };
    rec.events.push({ type: 'migrated', rev: 1, at, by: 'migration' });
  });
  return true;
}

module.exports = { timeline, STATUS_LABEL, sceneContent, sceneFingerprint, sceneSnapshot, isSceneApproved, validateScene, sceneState, projectReadiness, approveScene, revokeScene, approvedSet, noteEdits, migrateSceneApprovals };
