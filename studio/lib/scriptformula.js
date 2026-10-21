// Mechanics of the episode formula (six beats): replacing the story (or one beat),
// validating AI output and tracking manual edits. Pure functions over an episode object (callers do the persistence).
'use strict';
const { StudioError } = require('./util');
const { checkTitleKo } = require('./episode');
const F = require('./formula');
const sceneLook = require('./scenelook');

const SCENE_FIELDS = ['title_ko', 'visual', 'action', 'narration', 'placement', 'durationSec', 'showsProduct'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function freeIds(used, n, prefix) {
  const out = [];
  let i = 1;
  while (out.length < n) { const id = prefix + i; if (!used.has(id)) { out.push(id); used.add(id); } i += 1; }
  return out;
}
function nextLineIds(ep, n) {
  let max = 0;
  (ep.lines || []).forEach((l) => { const m = /^L(\d+)/.exec(l.id); if (m) max = Math.max(max, Number(m[1])); });
  return Array.from({ length: n }, (_, i) => 'L' + (max + i + 1));
}
function mkScene(id, key, d) {
  const order = F.ALL_KEYS.indexOf(key) + 1;
  return { id, part: F.partOf(key), beatKey: key, beat: order, title_ko: d.title_ko, title: d.title_ko, durationSec: d.durationSec, characters: d.characters.slice(), ...(d.look ? { look: d.look } : {}), showsProduct: !!d.showsProduct, visual: d.visual || '', action: d.action || '', narration: d.narration || '', placement: d.placement || '', manualEdit: false };
}
function pushLines(ep, sceneId, lines) {
  const ids = nextLineIds(ep, lines.length);
  lines.forEach((l, i) => ep.lines.push({ id: ids[i], sceneId, speaker: l.speaker, en: l.en, ko: l.ko, edited: false }));
}
const dropScene = (ep, id) => { ep.scenes = ep.scenes.filter((s) => s.id !== id); ep.lines = ep.lines.filter((l) => l.sceneId !== id); };

/** Scenes stay in beat order (there is no Part B any more). Kept as a function so callers do not change. */
function orderScenes(ep) {
  ep.scenes = ep.scenes.filter((s) => s.part !== 'B');
}

/** Creates the empty formula skeleton of a NEW episode (six beats, no scenes yet). */
function seedFormula(ep) {
  ep.comedy_story = {};
  F.BEAT_KEYS.forEach((k) => { ep.comedy_story[k] = F.emptyBeat(); });
  ep.scenes = [];
  ep.lines = [];
  return ep;
}

// ---------- AI output ----------
const bad = (message, details = []) => new StudioError('SCRIPT_REJECTED', message, { details, recovery: '다시 생성하거나 프롬프트를 확인하세요. 저장하지 않았습니다.', status: 422 });

function normalizeBeat(raw, key, charIds, maxSceneSec = 15, names = {}) {
  const meta = F.beatMeta(key);
  if (!raw || typeof raw !== 'object') throw bad(`"${meta.ko}" 단계가 없습니다.`);
  const t = checkTitleKo(raw.title_ko);
  if (t.errors.length) throw bad(`"${meta.ko}" 단계 제목: ${t.errors[0]}`, t.errors);
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s) => ({
    title_ko: String(s.title_ko || '').trim(), durationSec: Number(s.durationSec) || 4,
    // who is in the scene: the listed characters + everyone who speaks (+ names found in the scene text when nobody is listed)
    characters: sceneLook.inferCast({ characters: s.characters, speakers: (Array.isArray(s.lines) ? s.lines : []).map((l) => l && l.speaker), text: [s.visual, s.action].join('. ') }, charIds, names),
    // environment the image generator needs: place / lighting / mood (English); empty stays empty, never invented here
    look: sceneLook.cleanLook({ background: s.look && s.look.background, lighting: s.look && s.look.lighting, atmosphere: s.look && s.look.atmosphere }),
    showsProduct: key === 'product_bridge' && !!s.showsProduct, // the product is shown only in the product-bridge beat
    visual: String(s.visual || ''), action: String(s.action || ''), narration: String(s.narration || ''), placement: '',
    lines: (Array.isArray(s.lines) ? s.lines : []).map((l) => ({ speaker: String(l.speaker || ''), en: String(l.en || '').trim(), ko: String(l.ko || '').trim() })),
  }));
  if (!scenes.length) throw bad(`"${meta.ko}" 단계에 장면이 없습니다 (단계마다 최소 한 장면이 필요합니다).`);
  const problems = [];
  scenes.forEach((s, i) => {
    if (!(s.durationSec >= 1 && s.durationSec <= maxSceneSec)) problems.push(`${meta.ko} 장면 ${i + 1}: 길이는 1~${maxSceneSec}초여야 합니다. 동일한 스토리 단계에서 여러 씬으로 나눠 주세요.`);
    checkTitleKo(s.title_ko).errors.forEach((m) => problems.push(`${meta.ko} 장면 ${i + 1}: ${m}`));
    if (!s.characters.length) problems.push(`${meta.ko} 장면 ${i + 1}: 등장 캐릭터가 없습니다.`);
    s.lines.forEach((l) => { if (!charIds.has(l.speaker)) problems.push(`${meta.ko} 장면 ${i + 1}: 알 수 없는 화자 (${l.speaker}).`); });
  });
  if (problems.length) throw bad(problems[0], problems);
  return { title_ko: String(raw.title_ko).trim(), story_en: String(raw.story_en || '').trim().slice(0, 1500), visual: String(raw.visual || '').trim().slice(0, 1500), scenes };
}
function normalizeStory(raw, charIds, maxSceneSec = 15, names = {}) {
  if (!raw || typeof raw !== 'object' || !raw.comedy_story || typeof raw.comedy_story !== 'object') throw bad('AI 응답에 comedy_story가 없습니다.');
  const beats = {};
  F.BEAT_KEYS.forEach((k) => { beats[k] = normalizeBeat(raw.comedy_story[k], k, charIds, maxSceneSec, names); });
  const cta = raw.cta && typeof raw.cta === 'object' ? { lines: (raw.cta.lines || []).map(String), keyword: String(raw.cta.keyword || '').trim(), durationSec: Number(raw.cta.durationSec) || 3.5 } : null;
  return { title: String(raw.title || ''), beats, cta };
}

function placeBeat(ep, key, data) {
  const used = new Set(ep.scenes.map((s) => s.id));
  const ids = freeIds(used, data.scenes.length, 'S');
  const made = data.scenes.map((s, i) => ({ sc: mkScene(ids[i], key, s), lines: s.lines }));
  // insertion point: where this beat's scenes were, else after the previous beat, else at the start of Part A
  let at = ep.scenes.findIndex((s) => s.beatKey === key);
  if (at < 0) {
    const prevKeys = F.BEAT_KEYS.slice(0, F.BEAT_KEYS.indexOf(key));
    let last = -1;
    ep.scenes.forEach((s, i) => { if (prevKeys.includes(s.beatKey)) last = i; });
    at = last + 1;
  }
  ep.scenes.splice(at, 0, ...made.map((m) => m.sc));
  made.forEach((m) => pushLines(ep, m.sc.id, m.lines));
}
// Per-field: only the fields the operator typed themselves are kept; every other field comes from the AI.
const keepBeatMeta = (beat, data) => {
  const mf = beat.manualFields || [];
  if (!mf.includes('title_ko')) beat.title_ko = data.title_ko;
  if (!mf.includes('story_en')) beat.story_en = data.story_en || beat.story_en;
  if (!mf.includes('visual')) beat.visual = data.visual || beat.visual;
  return beat;
};

/** Replaces ONE beat's scenes and lines (everything else, incl. the whole of Part B, stays untouched). */
function replaceBeat(ep, key, data) {
  const olds = ep.scenes.filter((s) => s.beatKey === key).map((s) => s.id);
  // place first (new ids avoid every existing id), then drop the old ones: the new scenes sit where the old ones were
  const at = ep.scenes.findIndex((s) => s.beatKey === key);
  placeBeat(ep, key, data);
  olds.forEach((id) => dropScene(ep, id));
  void at;
  keepBeatMeta(ep.comedy_story[key], data);
  F.syncBeats(ep);
}
/** Replaces the whole story (six beats). */
function replacePartA(ep, beats) {
  ep.scenes.map((s) => s.id).forEach((id) => dropScene(ep, id));
  F.BEAT_KEYS.forEach((k) => { placeBeat(ep, k, beats[k]); keepBeatMeta(ep.comedy_story[k], beats[k]); });
  orderScenes(ep);
  F.syncBeats(ep);
}
// Operator-written beat text does not block the FIRST generation (it is the input); it only counts once the beat already has scenes.
const partAHasEdits = (ep, keys) => ep.scenes.some((s) => (!keys || keys.includes(s.beatKey)) && s.manualEdit) || F.BEAT_KEYS.some((k) => (!keys || keys.includes(k)) && (ep.comedy_story[k] || {}).manual && ep.scenes.some((s) => s.beatKey === k));

// ---------- manual-edit tracking + structure lock (used by saveScript) ----------
function markEdits(prev, ep) {
  const pLines = new Map((prev.lines || []).map((l) => [l.id, l]));
  const pScenes = new Map((prev.scenes || []).map((s) => [s.id, s]));
  ep.lines.forEach((l) => {
    const p = pLines.get(l.id);
    if (!p) { l.edited = true; return; }
    l.edited = !!p.edited || p.speaker !== l.speaker || p.en !== l.en || p.ko !== l.ko || p.sceneId !== l.sceneId;
  });
  ep.scenes.forEach((s) => {
    const p = pScenes.get(s.id);
    if (!p) { s.manualEdit = true; return; }
    const linesChanged = !same((prev.lines || []).filter((l) => l.sceneId === s.id).map((l) => l.id), ep.lines.filter((l) => l.sceneId === s.id).map((l) => l.id)) || ep.lines.some((l) => l.sceneId === s.id && l.edited);
    s.manualEdit = !!p.manualEdit || SCENE_FIELDS.some((f) => !same(p[f], s[f])) || !same(p.characters, s.characters) || linesChanged;
  });
}
function markBeatEdits(prev, ep, patch) {
  [['comedy_story', F.BEAT_KEYS]].forEach(([g, keys]) => {
    if (!patch[g]) return;
    keys.forEach((k) => {
      const inc = patch[g][k];
      if (!inc) return;
      const cur = ep[g][k];
      ['title_ko', 'story_en', 'visual'].forEach((f) => { if (inc[f] !== undefined && String(inc[f]).trim() !== String(cur[f] || '')) { cur[f] = String(inc[f]).trim().slice(0, 1500); cur.manual = true; cur.manualFields = Array.from(new Set([...(cur.manualFields || []), f])); } });
    });
  });
}
module.exports = { seedFormula, normalizeBeat, normalizeStory, replaceBeat, replacePartA, partAHasEdits, markEdits, markBeatEdits, orderScenes, freeIds };
