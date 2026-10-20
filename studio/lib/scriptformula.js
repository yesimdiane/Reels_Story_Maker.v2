// Mechanics of the fixed episode formula: building/refreshing Part B from the ending template, replacing Part A (or one beat),
// validating AI output and tracking manual edits. Pure functions over an episode object (callers do the persistence).
'use strict';
const { StudioError } = require('./util');
const { checkTitleKo, speechNeed } = require('./episode');
const F = require('./formula');
const { defaultVars, VAR_KEYS } = require('./endingtemplates');

const SCENE_FIELDS = ['title_ko', 'visual', 'action', 'narration', 'placement', 'durationSec', 'showsProduct'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const endingVars = (ep) => {
  const v = Object.assign(defaultVars(ep.product, { neutral: !!(ep.universeId && ep.universeId !== 'jackdiane') }), (ep.ending && ep.ending.vars) || {});
  // the operator's short name beats whatever the AI proposed for the spoken product name (unless the operator typed that variable by hand)
  const short = String((ep.product && ep.product.shortName) || '').trim();
  const manual = (ep.ending && ep.ending.manualVars) || [];
  if (short) ['PRODUCT_NAME', 'PRODUCT_NAME_KO'].forEach((k) => { if (!manual.includes(k)) v[k] = short; });
  return v;
};

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
  return { id, part: F.partOf(key), beatKey: key, beat: order, title_ko: d.title_ko, title: d.title_ko, durationSec: d.durationSec, characters: d.characters.slice(), showsProduct: !!d.showsProduct, visual: d.visual || '', action: d.action || '', narration: d.narration || '', placement: d.placement || '', manualEdit: false };
}
function pushLines(ep, sceneId, lines) {
  const ids = nextLineIds(ep, lines.length);
  lines.forEach((l, i) => ep.lines.push({ id: ids[i], sceneId, speaker: l.speaker, en: l.en, ko: l.ko, edited: false }));
}
const dropScene = (ep, id) => { ep.scenes = ep.scenes.filter((s) => s.id !== id); ep.lines = ep.lines.filter((l) => l.sceneId !== id); };

/** Part A scenes first (their order is kept), then Part B in the fixed ending order. */
function orderScenes(ep) {
  const a = ep.scenes.filter((s) => s.part !== 'B');
  const b = [].concat(...F.ENDING_KEYS.map((k) => ep.scenes.filter((s) => s.part === 'B' && s.beatKey === k)));
  const rest = ep.scenes.filter((s) => s.part === 'B' && !F.ENDING_KEYS.includes(s.beatKey));
  ep.scenes = a.concat(b, rest);
}

/** A template shot longer than the episode's per-scene limit becomes consecutive scenes (same beat, equal length, lines kept in order). */
function splitShot(shot, maxSec) {
  const n = Math.max(1, Math.ceil(shot.durationSec / maxSec - 1e-9));
  if (n === 1) return [shot];
  const per = Math.round((shot.durationSec / n) * 100) / 100;
  // Contiguous line groups that balance the estimated speaking time (dialogue never changes order or wording).
  const L = shot.lines; const cuts = [0];
  const cost = (from, to) => speechNeed(L.slice(from, to));
  if (L.length >= n) {
    let best = null;
    const rec = (start, left, acc) => {
      if (left === 1) { const all = acc.concat([[start, L.length]]); const worst = Math.max(...all.map(([x, y]) => cost(x, y))); if (!best || worst < best.worst) best = { worst, all }; return; }
      for (let e = start + 1; e <= L.length - (left - 1); e++) rec(e, left - 1, acc.concat([[start, e]]));
    };
    rec(0, n, []);
    best.all.forEach(([, y]) => cuts.push(y));
  } else for (let i = 1; i <= n; i++) cuts.push(i <= L.length ? i : L.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const tag = i === 0 ? `Part 1 of ${n} (first ${per}s of the shot): ` : `Part ${i + 1} of ${n} (continues directly from the previous part, same setting and framing): `;
    out.push(Object.assign({}, shot, { durationSec: per, action: tag + (shot.action || ''), lines: L.slice(cuts[i], cuts[i + 1]) }));
  }
  return out;
}

/**
 * (Re)builds Part B from the selected ending template + the episode's product-specific variables.
 * A shot the operator edited by hand (manualEdit) is kept exactly as it is, unless respectEdits is false.
 */
function applyEnding(ep, endings, { respectEdits = true } = {}) {
  const sel = ep.ending || (ep.ending = { templateId: endings.activeId(), version: null, vars: {}, manualVars: [] });
  const inst = endings.instantiate({ templateId: sel.templateId, version: sel.version }, endingVars(ep));
  sel.structureLocked = inst.structureLocked;
  sel.templateName = inst.templateName;
  sel.templateVersion = inst.templateVersion;
  const kept = [];
  const maxSec = ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5 ? 5 : 0;
  inst.shots.forEach((shot) => {
    const existing = ep.scenes.filter((s) => s.part === 'B' && s.beatKey === shot.beatKey);
    if (existing.some((s) => s.manualEdit) && respectEdits) { kept.push(shot.beatKey); return; }
    const keepFrame = existing[0] && existing[0].startImage;
    existing.forEach((s) => dropScene(ep, s.id));
    const parts = maxSec && shot.durationSec > maxSec ? splitShot(shot, maxSec) : [shot];
    parts.forEach((part, pi) => {
      const used = new Set(ep.scenes.map((s) => s.id));
      const base = 'E' + (F.ENDING_KEYS.indexOf(shot.beatKey) + 1);
      const id = pi === 0 && !used.has(base) ? base : freeIds(used, 1, 'E')[0];
      const sc = mkScene(id, shot.beatKey, part);
      if (pi === 0 && keepFrame) sc.startImage = keepFrame; // a rebuilt shot keeps its start frame
      ep.scenes.push(sc);
      pushLines(ep, id, part.lines);
    });
    const beat = (ep.product_ending[shot.beatKey] = ep.product_ending[shot.beatKey] || F.emptyBeat());
    keepBeatMeta(beat, shot);
  });
  orderScenes(ep);
  F.syncBeats(ep);
  return { rebuilt: F.ENDING_KEYS.filter((k) => !kept.includes(k)), kept };
}

/** Creates the empty formula skeleton + the default-template Part B of a NEW episode. */
function seedFormula(ep, endings, templateId) {
  ep.comedy_story = {};
  ep.product_ending = {};
  F.BEAT_KEYS.forEach((k) => { ep.comedy_story[k] = F.emptyBeat(); });
  F.ENDING_KEYS.forEach((k) => { ep.product_ending[k] = F.emptyBeat(); });
  ep.scenes = [];
  ep.lines = [];
  ep.ending = { templateId: templateId || endings.activeId(), version: null, vars: {}, manualVars: [] };
  applyEnding(ep, endings, { respectEdits: false });
  return ep;
}

// ---------- AI output ----------
const bad = (message, details = []) => new StudioError('SCRIPT_REJECTED', message, { details, recovery: '다시 생성하거나 프롬프트를 확인하세요. 저장하지 않았습니다.', status: 422 });

function normalizeBeat(raw, key, charIds, maxSceneSec = 15) {
  const meta = F.beatMeta(key);
  if (!raw || typeof raw !== 'object') throw bad(`"${meta.ko}" 단계가 없습니다.`);
  const t = checkTitleKo(raw.title_ko);
  if (t.errors.length) throw bad(`"${meta.ko}" 단계 제목: ${t.errors[0]}`, t.errors);
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s) => ({
    title_ko: String(s.title_ko || '').trim(), durationSec: Number(s.durationSec) || 4,
    characters: (Array.isArray(s.characters) ? s.characters : []).map(String).filter((c) => charIds.has(c)),
    showsProduct: false, // the product never appears in Part A (it enters only through the ending)
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
function normalizeVars(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  VAR_KEYS.forEach((k) => { const v = String(raw[k] == null ? '' : raw[k]).trim().slice(0, 300); if (v) out[k] = v; });
  return out;
}
function normalizeStory(raw, charIds, maxSceneSec = 15) {
  if (!raw || typeof raw !== 'object' || !raw.comedy_story || typeof raw.comedy_story !== 'object') throw bad('AI 응답에 comedy_story가 없습니다.');
  const beats = {};
  F.BEAT_KEYS.forEach((k) => { beats[k] = normalizeBeat(raw.comedy_story[k], k, charIds, maxSceneSec); });
  const cta = raw.cta && typeof raw.cta === 'object' ? { lines: (raw.cta.lines || []).map(String), keyword: String(raw.cta.keyword || '').trim(), durationSec: Number(raw.cta.durationSec) || 3.5 } : null;
  return { title: String(raw.title || ''), beats, vars: normalizeVars(raw.ending_vars), cta };
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
/** Replaces the whole of Part A (six beats). Part B is untouched. */
function replacePartA(ep, beats) {
  ep.scenes.filter((s) => s.part !== 'B').map((s) => s.id).forEach((id) => dropScene(ep, id));
  F.BEAT_KEYS.forEach((k) => { placeBeat(ep, k, beats[k]); keepBeatMeta(ep.comedy_story[k], beats[k]); });
  orderScenes(ep);
  F.syncBeats(ep);
}
// Operator-written beat text does not block the FIRST generation (it is the input); it only counts once the beat already has scenes.
const partAHasEdits = (ep, keys) => ep.scenes.some((s) => s.part !== 'B' && (!keys || keys.includes(s.beatKey)) && s.manualEdit) || F.BEAT_KEYS.some((k) => (!keys || keys.includes(k)) && (ep.comedy_story[k] || {}).manual && ep.scenes.some((s) => s.beatKey === k));

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
  [['comedy_story', F.BEAT_KEYS], ['product_ending', F.ENDING_KEYS]].forEach(([g, keys]) => {
    if (!patch[g]) return;
    keys.forEach((k) => {
      const inc = patch[g][k];
      if (!inc) return;
      const cur = ep[g][k];
      ['title_ko', 'story_en', 'visual'].forEach((f) => { if (inc[f] !== undefined && String(inc[f]).trim() !== String(cur[f] || '')) { cur[f] = String(inc[f]).trim().slice(0, 1500); cur.manual = true; cur.manualFields = Array.from(new Set([...(cur.manualFields || []), f])); } });
    });
  });
}
function enforceLock(prev, nextScenes) {
  if (!prev.ending || !prev.ending.structureLocked) return;
  const a = (prev.scenes || []).filter((s) => s.part === 'B');
  const b = nextScenes.filter((s) => s.part === 'B');
  const fail = (m) => { throw new StudioError('STRUCTURE_LOCKED', m, { recovery: '설정 → 엔딩 템플릿에서 "구조 잠금"을 풀거나, 제품별 내용(대사·연출)만 수정하세요.', status: 409 }); };
  if (a.length !== b.length || a.some((s, i) => s.id !== b[i].id || s.beatKey !== b[i].beatKey)) fail('PART B(제품 엔딩) 구조는 잠겨 있어 컷을 추가·삭제·순서 변경할 수 없습니다.');
  const lastA = nextScenes.map((s) => s.part).lastIndexOf('A');
  const firstB = nextScenes.findIndex((s) => s.part === 'B');
  if (firstB >= 0 && lastA > firstB) fail('PART A 장면은 PART B(제품 엔딩)보다 앞에 있어야 합니다.');
}

module.exports = { endingVars, applyEnding, seedFormula, normalizeBeat, normalizeStory, normalizeVars, replaceBeat, replacePartA, partAHasEdits, markEdits, markBeatEdits, enforceLock, orderScenes, freeIds };
