// The fixed Jack & Diane episode formula (permanent series format).
//   PART A — a unique comedy story with six mandatory beats (a beat may contain several scenes)
//   (There is no PART B any more: the fixed product ending was removed. The product is shown in the product-bridge beat.)
// Scenes stay a flat list in ep.scenes (so Storyboard / Video / Render keep working); every scene carries
//   part: 'A'   and   beatKey: one of the keys below.
// ep.comedy_story holds the beat-level data (Korean title, story, visual direction, duration, linked scene IDs).
'use strict';
const { checkTitleKo } = require('./episode');

const BEATS = [
  { key: 'setup', ko: '도입', en: 'Setup', role: 'A normal everyday situation. Show Jack\'s behaviour, confidence or mistake.' },
  { key: 'problem', ko: '위기 1', en: 'Problem', role: 'A clear problem begins.' },
  { key: 'absurd_escalation', ko: '위기 2', en: 'Absurd Escalation', role: 'The SAME problem escalates to an impossible, cartoonishly exaggerated level.' },
  { key: 'unexpected_twist', ko: '절정', en: 'Unexpected Twist', role: 'A surprising reversal directly connected to the escalating problem (prefer background-world absurdity and unexpected character behaviour; never unrelated randomness).' },
  { key: 'resolution', ko: '결말', en: 'Resolution', role: 'Jack survives or exits the absurd situation; the main story reaches a recognisable conclusion.' },
  { key: 'product_bridge', ko: '제품 연결', en: 'Product Bridge', role: 'The consequences of the story create a believable problem at home, giving Diane a natural excuse to buy a product.' },
];
const ENDING = []; // kept (empty) so older callers keep working; the fixed ending no longer exists
const BEAT_KEYS = BEATS.map((b) => b.key);
const ENDING_KEYS = ENDING.map((b) => b.key);
const ALL_KEYS = BEAT_KEYS.concat(ENDING_KEYS);
const partOf = (key) => (ENDING_KEYS.includes(key) ? 'B' : BEAT_KEYS.includes(key) ? 'A' : '');
const isStructured = (ep) => !!(ep && ep.comedy_story);
const beatMeta = (key) => BEATS.find((b) => b.key === key) || ENDING.find((b) => b.key === key);

// A beat's Korean title starts EMPTY (the role label 도입/위기 1/… is only a label): the title must describe what happens.
const emptyBeat = () => ({ title_ko: '', story_en: '', visual: '', durationSec: 0, sceneIds: [], manual: false });

/** Recomputes sceneIds / duration of every beat from the scenes (they are derived, never typed). */
function syncBeats(ep) {
  ep.comedy_story = ep.comedy_story || {};
  BEAT_KEYS.forEach((k) => {
    const b = ep.comedy_story[k] || (ep.comedy_story[k] = emptyBeat(k));
    const sc = (ep.scenes || []).filter((s) => s.beatKey === k);
    b.sceneIds = sc.map((s) => s.id);
    b.durationSec = Math.round(sc.reduce((n, s) => n + (Number(s.durationSec) || 0), 0) * 10) / 10;
  });
  ep.beats = BEAT_KEYS.map((k) => (ep.comedy_story[k] || {}).title_ko).filter(Boolean);
  return ep;
}

/** Joined Korean subtitle text of a beat (display only). */
const beatSubtitles = (ep, key) => (ep.lines || []).filter((l) => ((ep.scenes || []).find((s) => s.id === l.sceneId) || {}).beatKey === key).map((l) => l.ko).filter(Boolean).join(' / ');

/**
 * Formula errors (block script approval). Only used for episodes that follow the formula.
 */
function validateFormula(ep) {
  const errors = [];
  const E = (code, message, extra = {}) => errors.push(Object.assign({ code, message }, extra));
  const scenes = ep.scenes || [];
  BEATS.forEach((b) => {
    if (!scenes.some((s) => s.beatKey === b.key)) E('BEAT_MISSING', `PART A: "${b.ko}" 단계 장면이 없습니다 (여섯 단계가 모두 필요합니다).`, { beatKey: b.key });
    const t = checkTitleKo((ep.comedy_story[b.key] || {}).title_ko);
    t.errors.forEach((m) => E('BEAT_TITLE', `PART A "${b.ko}" 제목: ${m}`, { beatKey: b.key, field: 'beat.title_ko', part: 'A' }));
  });
  const aOrder = scenes.filter((s) => s.part === 'A').map((s) => BEAT_KEYS.indexOf(s.beatKey));
  if (aOrder.some((v, i) => i && v < aOrder[i - 1])) E('BEAT_ORDER', 'PART A 장면은 도입 → 위기 1 → 위기 2 → 절정 → 결말 → 제품 연결 순서여야 합니다.');
  scenes.forEach((s) => { if (!partOf(s.beatKey) || partOf(s.beatKey) !== s.part) E('SCENE_BEAT', `${s.id}: 장면이 어떤 단계(beat)에도 속하지 않습니다.`, { sceneId: s.id, field: 'beatKey' }); });
  return errors;
}

/**
 * The fixed product ending (PART B) no longer exists. An episode saved before that keeps its old ending scenes / dialogue / settings
 * under `archivedEnding` (nothing is deleted, files on disk stay) and they disappear from every list, count and validation.
 * Pure + idempotent. Returns true when the episode was changed.
 */
function archiveEnding(ep) {
  if (!ep || typeof ep !== 'object') return false;
  const gone = (ep.scenes || []).filter((s) => s.part === 'B');
  if (!gone.length && !ep.product_ending && !ep.ending) return false;
  const ids = new Set(gone.map((s) => s.id));
  const prev = ep.archivedEnding || { at: new Date().toISOString(), scenes: [], lines: [], product_ending: null, ending: null };
  prev.scenes = (prev.scenes || []).concat(gone);
  prev.lines = (prev.lines || []).concat((ep.lines || []).filter((l) => ids.has(l.sceneId)));
  if (ep.product_ending) prev.product_ending = ep.product_ending;
  if (ep.ending) prev.ending = ep.ending;
  ep.archivedEnding = prev;
  ep.scenes = (ep.scenes || []).filter((s) => !ids.has(s.id));
  ep.lines = (ep.lines || []).filter((l) => !ids.has(l.sceneId));
  delete ep.product_ending;
  delete ep.ending;
  if (ep.comedy_story) syncBeats(ep);
  return true;
}

module.exports = { archiveEnding, BEATS, ENDING, BEAT_KEYS, ENDING_KEYS, ALL_KEYS, partOf, isStructured, beatMeta, emptyBeat, syncBeats, beatSubtitles, validateFormula };
