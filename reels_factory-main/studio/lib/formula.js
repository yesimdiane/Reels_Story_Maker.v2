// The fixed Jack & Diane episode formula (permanent series format).
//   PART A — a unique comedy story with six mandatory beats (a beat may contain several scenes)
//   PART B — a fixed three-shot product ending built from a reusable ending template (only product-specific content changes)
// Scenes stay a flat list in ep.scenes (so Storyboard / Video / Render keep working); every scene carries
//   part: 'A' | 'B'   and   beatKey: one of the keys below.
// ep.comedy_story / ep.product_ending hold the beat-level data (Korean title, story, visual direction, duration, linked scene IDs).
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
const ENDING = [
  { key: 'shopping_excuse', ko: '다이앤의 쇼핑 핑계', en: "Diane's Shopping Excuse" },
  { key: 'product_demonstration', ko: '제품 시연', en: 'Product Demonstration' },
  { key: 'jack_reaction', ko: '잭의 한결같은 반응', en: "Jack's Recurring Reaction" },
];
const BEAT_KEYS = BEATS.map((b) => b.key);
const ENDING_KEYS = ENDING.map((b) => b.key);
const ALL_KEYS = BEAT_KEYS.concat(ENDING_KEYS);
const partOf = (key) => (ENDING_KEYS.includes(key) ? 'B' : BEAT_KEYS.includes(key) ? 'A' : '');
const isStructured = (ep) => !!(ep && ep.comedy_story && ep.product_ending);
const beatMeta = (key) => BEATS.find((b) => b.key === key) || ENDING.find((b) => b.key === key);

// A beat's Korean title starts EMPTY (the role label 도입/위기 1/… is only a label): the title must describe what happens.
const emptyBeat = () => ({ title_ko: '', story_en: '', visual: '', durationSec: 0, sceneIds: [], manual: false });

/** Recomputes sceneIds / duration of every beat from the scenes (they are derived, never typed). */
function syncBeats(ep) {
  ['comedy_story', 'product_ending'].forEach((group) => {
    const keys = group === 'comedy_story' ? BEAT_KEYS : ENDING_KEYS;
    ep[group] = ep[group] || {};
    keys.forEach((k) => {
      const b = ep[group][k] || (ep[group][k] = emptyBeat(k));
      const sc = (ep.scenes || []).filter((s) => s.beatKey === k);
      b.sceneIds = sc.map((s) => s.id);
      b.durationSec = Math.round(sc.reduce((n, s) => n + (Number(s.durationSec) || 0), 0) * 10) / 10;
    });
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
  const ending = scenes.filter((s) => s.part === 'B');
  const splitOk = !!(ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5); // 5 s episodes may split one ending shot into consecutive scenes
  const endKeys = ending.map((s) => s.beatKey).filter((k, i, a) => !i || k !== a[i - 1]);
  if (!splitOk && ending.length !== 3) E('ENDING_COUNT', `PART B 제품 엔딩은 정확히 3컷이어야 합니다 (현재 ${ending.length}컷).`);
  else if (splitOk && ending.length < 3) E('ENDING_COUNT', `PART B 제품 엔딩은 세 단계(쇼핑 핑계 → 제품 시연 → 잭의 반응)가 모두 필요합니다 (현재 ${ending.length}컷).`);
  else if (endKeys.length !== 3 || endKeys.some((k, i) => k !== ENDING_KEYS[i])) E('ENDING_ORDER', 'PART B는 쇼핑 핑계 → 제품 시연 → 잭의 반응 순서여야 합니다.');
  const aOrder = scenes.filter((s) => s.part === 'A').map((s) => BEAT_KEYS.indexOf(s.beatKey));
  if (aOrder.some((v, i) => i && v < aOrder[i - 1])) E('BEAT_ORDER', 'PART A 장면은 도입 → 위기 1 → 위기 2 → 절정 → 결말 → 제품 연결 순서여야 합니다.');
  const firstB = scenes.findIndex((s) => s.part === 'B');
  if (firstB >= 0 && scenes.slice(firstB).some((s) => s.part !== 'B')) E('PART_ORDER', 'PART A 장면은 모두 PART B(제품 엔딩)보다 앞에 있어야 합니다.');
  scenes.forEach((s) => { if (!partOf(s.beatKey) || partOf(s.beatKey) !== s.part) E('SCENE_BEAT', `${s.id}: 장면이 어떤 단계(beat)에도 속하지 않습니다.`, { sceneId: s.id, field: 'beatKey' }); });
  const demo = ending.find((s) => s.beatKey === 'product_demonstration');
  if (demo && !demo.showsProduct) E('ENDING_DEMO_PRODUCT', '제품 시연 컷에는 제품이 보여야 합니다 ("이 장면에 제품이 보임" 체크).', { sceneId: demo.id, field: 'showsProduct' });
  const ep0 = (ep.product_ending || {});
  ENDING_KEYS.forEach((k) => { if (ep0[k] && !String(ep0[k].title_ko || '').trim()) E('BEAT_TITLE', `PART B "${beatMeta(k).ko}" 제목이 비어 있습니다.`, { beatKey: k, field: 'beat.title_ko', part: 'B' }); });
  return errors;
}

module.exports = { BEATS, ENDING, BEAT_KEYS, ENDING_KEYS, ALL_KEYS, partOf, isStructured, beatMeta, emptyBeat, syncBeats, beatSubtitles, validateFormula };
