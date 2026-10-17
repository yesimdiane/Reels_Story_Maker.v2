// Storyboard approval: what exactly was approved, and whether it still holds — per scene, per field.
//   * The old approval was ONE hash over the whole storyboard, including the complete start-image record (approval flag, timestamps,
//     provider, generation prompt …) of EVERY scene. Any touch to any scene — even approving a frame or regenerating a different scene's
//     image — silently invalidated everything, and nothing said what had changed.
//   * v2 records the hash of each scene's MATERIAL content (characters, visual direction, product use, its script lines + length, the
//     video prompt, the identity of the start image) field by field. Cosmetic data (timestamps, who approved, generation provenance,
//     the frame's own "approved" flag, UI state, animation/B-roll edits, reference selections) is not part of it.
//   * A scene whose own content is unchanged stays approved when another scene changes; the changed field is named.
//   * Approvals made before v2 keep working exactly as before (legacy whole-object hash) until they are upgraded in place.
'use strict';
const { sha256, canonical } = require('./util');
const { lookHashPart } = require('./scenelook');

const FIELD_LABEL = { characters: '출연 캐릭터', visual: '시각 연출', product: '제품 등장·배치', script: '대사·장면 길이', prompt: '영상 프롬프트', startImage: '시작 이미지' };
const h = (v) => sha256(canonical(v));

/** Identity of a start image: which picture it is, never when/how it was made or whether it was approved. */
function frameIdentity(si) {
  if (!si) return null;
  if (si.type === 'upload') return { type: 'upload', sha256: si.sha256 || si.file || '' };
  if (si.type === 'reference') return { type: 'reference', characterId: si.characterId || '', refId: si.refId || '' };
  return { type: si.type || 'other', file: si.file || '', sha256: si.sha256 || '' };
}

/** field → hash for one scene. */
function sceneFields(ep, s) {
  const p = ep.prompts && ep.prompts[s.id];
  const lines = (ep.lines || []).filter((l) => l.sceneId === s.id).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko }));
  return {
    characters: h((s.referenceOnly || []).length ? { c: s.characters || [], ro: s.referenceOnly } : (s.characters || [])),
    visual: h(lookHashPart(s) ? { v: s.visual || '', l: lookHashPart(s) } : (s.visual || '')),
    product: h({ shows: !!s.showsProduct, placement: s.productPlacement || null }),
    script: h({ durationSec: s.durationSec, lines }),
    prompt: h(p ? { video: p.video, negative: p.negative } : null),
    startImage: h(frameIdentity(s.startImage)),
  };
}

/** The record stored when the storyboard is approved. */
function makeRecord(ep, by, at) {
  const scenes = {};
  (ep.scenes || []).forEach((s) => { scenes[s.id] = sceneFields(ep, s); });
  return { v: 2, by, at, order: (ep.scenes || []).map((s) => s.id), scenes, hash: sha256(canonical(scenes)) };
}

/** Legacy whole-storyboard hash (kept so approvals made before v2 stay valid). Exactly the old formula. */
function legacyHash(ep, scriptFingerprint) {
  return sha256(canonical({
    script: scriptFingerprint(ep),
    scenes: (ep.scenes || []).map((s) => ({ id: s.id, characters: s.characters, visual: s.visual, showsProduct: !!s.showsProduct, startImage: s.startImage || null, prompt: ep.prompts && ep.prompts[s.id] ? { video: ep.prompts[s.id].video, negative: ep.prompts[s.id].negative } : null })),
  }));
}

/**
 * { everApproved, approved, legacy, scenes: { id → { approved, isNew, changed: [{field,label}] } }, reasons: [korean text], changedScenes: [ids] }
 * approved = every current scene is approved and the record exists.
 */
function status(ep, scriptFingerprint) {
  const rec = ep.approvals && ep.approvals.storyboard;
  const out = { everApproved: !!rec, approved: false, legacy: false, scenes: {}, reasons: [], changedScenes: [] };
  if (!rec) { out.reasons.push('스토리보드가 아직 승인되지 않았습니다.'); return out; }
  if (rec.v === 2 && rec.scenes) {
    (ep.scenes || []).forEach((s) => {
      const was = rec.scenes[s.id];
      if (!was) { out.scenes[s.id] = { approved: false, isNew: true, changed: [] }; out.changedScenes.push(s.id); out.reasons.push(`${s.id}: 승인 이후에 추가된 장면입니다. 확인 후 다시 승인하세요.`); return; }
      const now = sceneFields(ep, s);
      const changed = Object.keys(FIELD_LABEL).filter((k) => was[k] !== now[k]).map((k) => ({ field: k, label: FIELD_LABEL[k] }));
      out.scenes[s.id] = { approved: !changed.length, isNew: false, changed };
      if (changed.length) { out.changedScenes.push(s.id); out.reasons.push(`${s.id}: ${changed.map((c) => c.label).join(', ')}이(가) 승인 후 바뀌었습니다. 다시 승인이 필요합니다.`); }
    });
    out.approved = !out.changedScenes.length;
    return out;
  }
  // legacy record: one hash for everything; it cannot say what changed
  out.legacy = true;
  const ok = rec.hash === legacyHash(ep, scriptFingerprint);
  (ep.scenes || []).forEach((s) => { out.scenes[s.id] = { approved: ok, isNew: false, changed: [] }; });
  out.approved = ok;
  if (!ok) { out.changedScenes = (ep.scenes || []).map((s) => s.id); out.reasons.push('이전 방식으로 승인된 스토리보드가 승인 후 바뀌었습니다 (이전 승인에는 바뀐 항목이 기록되어 있지 않습니다). 확인 후 다시 승인하세요.'); }
  return out;
}

/** Hash of exactly the given scenes' material content — what a paid-generation authorization is bound to. */
function sceneSetHash(ep, ids) {
  const set = new Set(ids);
  const parts = {};
  (ep.scenes || []).filter((s) => set.has(s.id)).forEach((s) => { parts[s.id] = sceneFields(ep, s); });
  return sha256(canonical(parts));
}

module.exports = { FIELD_LABEL, sceneFields, makeRecord, legacyHash, status, sceneSetHash, frameIdentity };
