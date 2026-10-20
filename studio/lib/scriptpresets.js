// Script prompt presets ("AI 프롬프트 관리"): the creative instructions used by Script Studio, editable without touching code.
//   A preset is a named set of text sections with numbered, never-rewritten versions. The built-in "Comedy Engine v3" preset is the
//   default and can always be restored (as a NEW version). Presets live in <data dir>/script-presets.json — the same persistent
//   volume as every other Studio file — and are seeded only when the file does not exist yet, so a redeploy never overwrites them.
//   Application safety constraints (output schema, Korean scene titles, verified claims, CTA rules …) are NOT part of any preset:
//   they are appended by code (LOCKED) after the editable text and cannot be edited or removed from here.
'use strict';
const path = require('node:path');
const { StudioError, nowIso, readJson, writeJsonAtomic, sha256 } = require('./util');
const { renderTemplate } = require('./promptstore');
const { wordBudget } = require('./episode');

const DEFAULT_ID = 'comedy-engine-v3';
const SECTIONS = [
  ['systemPrompt', 'Script Studio 시스템 프롬프트', '작가의 역할과 채널 톤. {{CHANNEL}} {{AUDIENCE}} {{BRANDING}} 를 쓸 수 있습니다.'],
  ['generationInstructions', '대본 생성 지침', '대본을 어떻게 쓸지에 대한 창작 지침.'],
  ['comedyLevel1', '코미디 강도 1 (잔잔)', '강도 1을 고르면 들어가는 지침.'],
  ['comedyLevel2', '코미디 강도 2 (기본)', '강도 2를 고르면 들어가는 지침.'],
  ['comedyLevel3', '코미디 강도 3 (고에너지)', '강도 3을 고르면 들어가는 지침.'],
  ['characterRules', '캐릭터 성격·대사 규칙', 'Jack과 Diane의 성격, 말투, 금지 표현.'],
  ['subtitleStyle', '한국어 자막 스타일', '한국어 자막을 쓰는 방식.'],
  ['sceneStructure', '장면 구성·출력 요구', '장면 수, 길이, 구성 방식.'],
  ['productIntegration', '제품 연결 지침', '제품을 이야기에 자연스럽게 넣는 방식.'],
];
const SECTION_KEYS = SECTIONS.map((s) => s[0]);
const MAX_SECTION = 8000;

/** Constraints enforced by the application. Shown read-only in the UI; always appended; never stored in a preset. */
const LOCKED = [
  '--- NON-EDITABLE APPLICATION CONSTRAINTS (always applied; they override any instruction above) ---',
  'OUTPUT: return ONLY valid JSON of this exact shape:',
  '{"title": "Korean hook title", "beats": ["short beat", "..."],',
  ' "scenes": [{"id": "S1", "title_ko": "Korean scene title", "beat": 1, "durationSec": 4, "characters": ["jack"|"diane"], "showsProduct": true|false, "visual": "second-by-second animation timeline (English)", "action": "character actions", "visual_ko": "Korean translation of visual", "action_ko": "Korean translation of action", "narration": "optional Korean narration", "placement": "product placement note", "placement_ko": "Korean translation of placement"}],',
  ' "lines": [{"id": "L1", "sceneId": "S1", "speaker": "jack"|"diane", "en": "English dialogue as spoken", "ko": "Korean subtitle"}],',
  ' "cta": {"lines": ["Korean CTA line"], "keyword": "short Korean ManyChat keyword", "durationSec": 3.5}}',
  'SCENE TITLES (required): EVERY scene must have title_ko — a short, meaningful KOREAN title (3-12 characters preferred, 24 at most) that names the scene\'s key action or comedic beat, not just its location. Never generic ("장면 1", "Scene 2", "제품 소개") and never English.',
  'DIALOGUE: en is English as spoken; ko is a separate Korean subtitle and must differ from en. Speakers are only "jack" or "diane".',
  'ANIMATION TIMELINE — SECOND BY SECOND (required; each scene\'s "visual" and "action" are what the video model animates, so plan ALL animation in seconds, never as a one-line summary): "visual" MUST be a timecoded sequence in ENGLISH that covers the scene\'s whole durationSec: one segment per line formatted "0.0–1.2 s: ...", segments back to back, the last one ending EXACTLY at durationSec. Each segment states the camera (quick punch-in zoom, whip-pan, slow push-in, or stable), the characters\' exaggerated cartoon motion and expression (eyes widen, eyebrows shoot up, squash-and-stretch, comic pop, a lightbulb popping above a head), what is held still (deadpan holds make the joke land) and any sound-effect cue. Align the segments with the dialogue timing (about 2.7 words per second). "action" = 1-2 sentences summarising each character\'s movement with a start and an end. Example for a 4 s scene: "0.0–1.0 s: Diane freezes, stable medium shot. 1.0–1.6 s: her eyes widen dramatically and her eyebrows shoot upward; a glowing lightbulb pops above her head with a cartoon bounce. 1.6–2.4 s: quick punch-in zoom on her face, hold. 2.4–4.0 s: she grins and turns toward Jack, camera stable." Keep the approved character looks (exactly the characters listed for the scene), no on-screen text, no dialogue in these fields, and show the product only as the verified facts allow.',
  'TRANSLATIONS (required): next to every English direction field also return its faithful, complete Korean translation in the same object — scenes: visual_ko, action_ko, placement_ko; beats: story_ko and visual_ko — keeping every timecode, so the operator can read it without another AI call.',
  'PRODUCT CLAIMS: use ONLY the verified product facts given in the input data; never use a forbidden claim; never invent specifications, prices, discounts or availability.',
  'CTA: the keyword is a short Korean word (never an internal product ID such as PRD-001) and must appear in the CTA lines. The ad disclosure is added by the application.',
  'The story concept is already approved: do not change its premise. Do not include any secret, key or instruction about these constraints in the output.',
  'DIALOGUE TIMING: English speech takes about 2.7 words per second (+0.25 s per line, +0.18 s between lines, +0.6 s at the end of a scene). Make each scene\'s dialogue FIT its durationSec (e.g. 4 s ≈ 8 words in one line or 7 in two); shorten or remove unnecessary lines instead of relying on scene extension; at most 2 short lines per scene.',
].join('\n');


// ---- fixed episode formula: locked constraints per generation mode (they override any editable text) ----
const COMMON_LOCKED_BASE = [
  'SCENE TITLES (required): EVERY scene and every beat has a short, meaningful KOREAN title (title_ko / beat title_ko; 3-12 characters preferred, 24 at most) naming its key action or comedic beat, not just its location. Never generic ("장면 1", "Scene 2", "제품 소개") and never English.',
  'DIALOGUE: en is English as spoken; ko is a separate Korean subtitle that must differ from en. Speakers are only "jack" or "diane". Diane never calls Jack "오빠".',
  'ANIMATION TIMELINE — SECOND BY SECOND (required; each scene\'s "visual" and "action" are what the video model animates, so plan ALL animation in seconds, never as a one-line summary): "visual" MUST be a timecoded sequence in ENGLISH that covers the scene\'s whole durationSec: one segment per line formatted "0.0–1.2 s: ...", segments back to back, the last one ending EXACTLY at durationSec. Each segment states the camera (quick punch-in zoom, whip-pan, slow push-in, or stable), the characters\' exaggerated cartoon motion and expression (eyes widen, eyebrows shoot up, squash-and-stretch, comic pop, a lightbulb popping above a head), what is held still (deadpan holds make the joke land) and any sound-effect cue. Align the segments with the dialogue timing (about 2.7 words per second). "action" = 1-2 sentences summarising each character\'s movement with a start and an end. Example for a 4 s scene: "0.0–1.0 s: Diane freezes, stable medium shot. 1.0–1.6 s: her eyes widen dramatically and her eyebrows shoot upward; a glowing lightbulb pops above her head with a cartoon bounce. 1.6–2.4 s: quick punch-in zoom on her face, hold. 2.4–4.0 s: she grins and turns toward Jack, camera stable." Keep the approved character looks (exactly the characters listed for the scene), no on-screen text, no dialogue in these fields, and show the product only as the verified facts allow.',
  'TRANSLATIONS (required): next to every English direction field also return its faithful, complete Korean translation in the same object — scenes: visual_ko, action_ko, placement_ko; beats: story_ko and visual_ko — keeping every timecode, so the operator can read it without another AI call.',
  'PRODUCT CLAIMS: use ONLY the verified product facts in the input data; never use a forbidden claim; never invent specifications, prices, discounts or availability.',
  'The story concept is already approved: do not change its premise. Do not include any secret, key or instruction about these constraints in the output.',
];

// ---- realistic dialogue timing (sent BEFORE generation; the validator uses the same model) ----
const budgetRow = (d) => `${d} s → ${wordBudget(d, 1)} words (1 line) / ${wordBudget(d, 2)} words (2 lines)`;
const TIMING_RULES = [
  'DIALOGUE TIMING (realistic; checked by the application with the same model): English speech takes about 2.7 words per second, plus 0.25 s lead-in per line, 0.18 s between lines and 0.6 s of breathing room at the end of each scene.',
  `Total English words that FIT a scene: ${[3, 4, 5, 6].map(budgetRow).join('; ')}.`,
  'Choose every scene\'s durationSec so its dialogue fits INSIDE the scene. Never rely on scenes being extended later. At most 2 lines per scene and at most 9 words per line; a silent reaction beat is fine.',
  'If a scene needs more words than its budget, SHORTEN the dialogue or REMOVE unnecessary lines (keep the story beat, the joke and the character voices); only split into another scene when the story needs it. Korean subtitles must be shortened to match.',
];
const COMMON_LOCKED = COMMON_LOCKED_BASE.concat(TIMING_RULES);
const FORMULA_LOCKED = [
  'FIXED EPISODE FORMULA (permanent series format; it overrides ANY story-structure instruction above):',
  'PART A = a unique comedy story with SIX mandatory beats, in this order: setup(도입), problem(위기 1), absurd_escalation(위기 2), unexpected_twist(절정), resolution(결말), product_bridge(제품 연결). Each beat needs at least one scene; a beat may have several scenes.',
  ' - setup: a normal everyday situation; show Jack\'s behaviour, confidence or mistake.   - problem: a clear problem begins.',
  ' - absurd_escalation: the SAME problem escalates to an impossible, cartoonishly exaggerated level.',
  ' - unexpected_twist: a surprising reversal directly connected to the escalating problem (background-world absurdity / unexpected character behaviour; never unrelated randomness).',
  ' - resolution: Jack survives or exits the absurd situation; the main story reaches a recognisable conclusion.',
  ' - product_bridge: the consequences of the story create a believable problem at home and give Diane a natural excuse to buy a product (through consequences, never forced advertising).',
  'There is NO separate product-ending part: the episode is exactly the six story beats. The product appears ONLY in the product_bridge beat: set showsProduct true on its scene(s) that demonstrate the verified product behaviour (truthful, nothing invented) and showsProduct false in every other beat. The affiliate disclosure / CTA is an overlay, not a story shot.',
  'Preserve every operator-written story beat (USER_STORY_BEATS) as the premise of that beat; build on it, do not replace it.',
];
const BEAT_SHAPE = '{"title_ko": "Korean beat title", "story_en": "English description of what happens", "story_ko": "Korean translation of story_en", "visual": "beat-level visual direction", "visual_ko": "Korean translation of the beat visual", "scenes": [{"title_ko": "Korean scene title", "durationSec": 4, "characters": ["jack"|"diane"], "showsProduct": false, "visual": "second-by-second animation timeline (English)", "action": "character actions", "visual_ko": "Korean translation of visual", "action_ko": "Korean translation of action", "narration": "optional Korean narration", "placement": "", "lines": [{"speaker": "jack"|"diane", "en": "English dialogue as spoken", "ko": "Korean subtitle"}]}]}';
const CTA_SHAPE = '"cta": {"lines": ["Korean CTA line"], "keyword": "short Korean ManyChat keyword (never an internal product ID), included in the CTA lines", "durationSec": 3.5}';
const HEAD = '--- NON-EDITABLE APPLICATION CONSTRAINTS (always applied; they override any instruction above) ---';
/** Character-neutral wording for universes other than Jack & Diane (the shapes list the cast's ids instead of "jack"|"diane"). */
const NEUTRAL_FORMULA = FORMULA_LOCKED.map((l) => l
  .replace("show Jack\'s behaviour, confidence or mistake.", 'show a main character\'s behaviour, confidence or mistake.')
  .replace("resolution: Jack survives or exits the absurd situation;", 'resolution: the cast survives or exits the absurd situation;')
  .replace('give Diane a natural excuse to buy a product', 'give the cast a natural excuse to buy a product')
  .replace(/Part A scenes never show the product/, 'Part A scenes never show the product'));
function neutralize(text, ids) {
  const quoted = (ids.length ? ids : ['character']).map((i) => `"${i}"`).join('|');
  return String(text)
    .replace(/\["jack"\|"diane"\]/g, `[${quoted}]`)
    .replace(/"jack"\|"diane"/g, quoted)
    .replace(/Speakers are only "jack" or "diane"\./g, `Speakers are only ${ids.map((i) => '"' + i + '"').join(', ') || 'the cast ids'}.`)
    .replace(/what Jack refuses to use, English/g, 'what the cast resists or struggles with, English')
    .replace(/how Diane installs\/uses the REAL product/g, 'how a cast member installs/uses the REAL product')
    .replace(/Diane's short demo line/g, 'a short demo line')
    .replace(/the recurring Jack refusal gag/g, 'the recurring closing gag')
    .replace(/ Diane never calls Jack "오빠"\./g, '')
    .replace(/Diane freezes, stable medium shot\. 1\.0–1\.6 s: her eyes widen dramatically and her eyebrows shoot upward; a glowing lightbulb pops above her head with a cartoon bounce\. 1\.6–2\.4 s: quick punch-in zoom on her face, hold\. 2\.4–4\.0 s: she grins and turns toward Jack, camera stable\./, 'A character freezes, stable medium shot. 1.0–1.6 s: their eyes widen dramatically and their eyebrows shoot upward; a glowing lightbulb pops above their head with a cartoon bounce. 1.6–2.4 s: quick punch-in zoom on the face, hold. 2.4–4.0 s: they grin and turn toward another cast member, camera stable.')
}
function lockedFor(mode = 'legacy', ctx = null) {
  if (ctx && ctx.neutral) { const out = lockedForBase(mode); return neutralize(out, ctx.ids || []).replace(FORMULA_LOCKED.join('\n'), NEUTRAL_FORMULA.join('\n')); }
  return lockedForBase(mode);
}
function lockedForBase(mode = 'legacy') {
  if (mode === 'legacy') return LOCKED;
  const out = {
    story: ['OUTPUT: return ONLY valid JSON of this exact shape:', `{"title": "Korean hook title", "comedy_story": {"setup": BEAT, "problem": BEAT, "absurd_escalation": BEAT, "unexpected_twist": BEAT, "resolution": BEAT, "product_bridge": BEAT}, ${CTA_SHAPE}}`, `where BEAT = ${BEAT_SHAPE}`],
    beat: ['OUTPUT: return ONLY valid JSON of this exact shape:', '{"beat": BEAT}', `where BEAT = ${BEAT_SHAPE}`, 'Write ONLY the requested beat (the other beats stay exactly as they are); it must still connect to the neighbouring beats given in the input data.'],
    timing: ['OUTPUT: return ONLY valid JSON of this exact shape:', '{"scenes": [{"id": "S1", "lines": [{"id": "L1", "speaker": "jack"|"diane", "en": "shortened English", "ko": "shortened Korean subtitle"}]}]}', 'TASK: shorten ONLY the scenes listed in TIMING_TARGETS so that each fits its wordBudget. First REMOVE unnecessary lines (leave them out), then tighten the wording. Keep the same story beat, the same joke and the same speakers/character voices. Keep the id of every line you keep; never add lines, never change a speaker, never change scene durations. Shorten the Korean subtitle to match. Keep "BABYYYY" if a line has it.'],
  }[mode];
  if (!out) throw new StudioError('BAD_MODE', '알 수 없는 생성 모드: ' + mode);
  const rules = mode === 'timing' ? COMMON_LOCKED.filter((x) => !x.startsWith('SCENE TITLES') && !x.startsWith('ANIMATION') && !x.startsWith('TRANSLATIONS') && !x.startsWith('DIALOGUE TIMING') && !x.startsWith('Total English') && !x.startsWith('Choose every') && !x.startsWith('If a scene needs')) : COMMON_LOCKED;
  return [HEAD, ...out, ...(mode === 'timing' ? [] : FORMULA_LOCKED), ...rules].join('\n');
}

/** Editable sections that are universe-specific in the Jack & Diane preset are replaced (by code) for other universes: the cast comes from the library. */
function NEUTRAL_SECTIONS(cast) {
  const u = cast.universeName || 'the series';
  return {
    systemPrompt: `You are the head comedy writer for the Korean short-form video channel "{{CHANNEL}}". You write complete reel scripts for the cast of "${u}" described in the CAST & UNIVERSE block below.\nAUDIENCE: {{AUDIENCE}}\nBRANDING: {{BRANDING}}\nYour job is to turn an APPROVED story concept into a scene-by-scene script that is genuinely funny, character-driven and natural. The product must feel like part of the story, never like an advertisement.`,
    generationInstructions: 'Write the script from the approved concept without changing its premise. The episode follows the FIXED SERIES FORMULA (the application enforces its structure):\nPART A — a unique, escalating, absurd comedy story with SIX mandatory beats in order: 도입(setup), 위기 1(problem), 위기 2(absurd escalation), 절정(unexpected twist), 결말(resolution), 제품 연결(product bridge). A beat may use several scenes.\n- Preserve every story beat the operator already wrote (USER_STORY_BEATS) as the premise of that beat.\n- The first 3 seconds contain the hook. Each beat has one clear comedic purpose; the escalation must be the SAME problem pushed to a cartoonish extreme.\n- The twist must be directly connected to the escalating problem; never unrelated randomness.\n- Connect the story to the product only through CONSEQUENCES in the product bridge, never through forced advertising. The product is shown only in the product bridge, demonstrating its verified behaviour.\n- Keep every character\'s personality, speaking style and relationships exactly as given in the CAST block.',
    comedyLevel3: "COMEDY INTENSITY 3 (high energy): big escalation, exaggerated reactions, fast cuts and visual absurdity (still anchored in a real household problem). Strong running gag and callback. The cast's defining personality traits are pushed to the extreme, but the product facts stay accurate.",
    characterRules: 'CHARACTERS\n- Use ONLY the characters in the CAST & UNIVERSE block, with the personalities, speaking styles, relationships, rules and NEVER-lists given there.\n- Never add a recurring character that is not in the cast. Keep each character\'s identity consistent in every scene.',
    productIntegration: 'PRODUCT INTEGRATION\n- The story reaches the product only in the product bridge, as a believable household consequence that gives the cast a natural reason to get it.\n- Product facts come only from the verified facts provided. Never invent specifications, prices, discounts, availability or performance claims. Do not change the product\'s shape, logo or colour.\n- In the product bridge, show the product doing only what the verified facts say; use the real product name and only verified, visible functionality.',
  };
}

function createScriptPresets({ store, prompts, seedDir }) {
  const file = store.path('script-presets.json');
  const seed = () => readJson(path.join(seedDir, 'script-presets.json'));

  function read() {
    let d = readJson(file);
    if (d && (d.schema || 1) < 2) {
      // Safe migration to the fixed episode formula: an UNMODIFIED built-in default gets the formula text as a NEW version (v1 stays);
      // an operator-edited preset is left exactly as it is (the formula itself is enforced by the locked constraints, not by this text).
      const sd = seed();
      Object.values(d.presets).forEach((p) => {
        const cur = p.versions.find((x) => x.v === p.current);
        if (p.builtIn && cur && cur.default) {
          const v = Math.max(...p.versions.map((x) => x.v)) + 1;
          p.versions.push({ v, sections: Object.assign({}, sd.sections), at: nowIso(), by: 'migration', note: '고정 에피소드 포맷 적용 (이전 버전은 보존)', default: true });
          p.current = v;
        }
      });
      d.schema = 2;
      writeJsonAtomic(file, d);
    }
    if (!d) {
      const s = seed();
      d = { schema: 2, activePresetId: s.presetId, presets: {}, updatedAt: nowIso() };
      d.presets[s.presetId] = { id: s.presetId, name: s.name, description: s.description, builtIn: true, createdAt: nowIso(), current: 1, versions: [{ v: 1, sections: Object.assign({}, s.sections), at: nowIso(), by: 'default', note: '기본값', default: true }] };
      // Keep an operator's customised Prompt-Manager script prompt available (it is no longer used for generation by itself).
      try {
        const legacy = prompts.get('script');
        if (legacy && !legacy.isDefault) {
          d.presets['legacy-script'] = { id: 'legacy-script', name: `이전 대본 프롬프트 (v${legacy.current})`, description: '프롬프트 매니저에서 직접 수정했던 대본 프롬프트를 보존한 프리셋입니다 (생성 지침 칸에 들어 있습니다).', builtIn: false, createdAt: nowIso(), current: 1, derivedFrom: { presetId: s.presetId, version: 1 }, versions: [{ v: 1, sections: Object.assign({}, s.sections, { generationInstructions: prompts.versionText('script', legacy.current) }), at: nowIso(), by: 'migration', note: '이전 프롬프트 보존' }] };
        }
      } catch (_) { /* no legacy prompt */ }
      writeJsonAtomic(file, d);
    }
    return d;
  }
  const write = (d) => { d.updatedAt = nowIso(); writeJsonAtomic(file, d); };
  const find = (d, id) => {
    const p = d.presets[id];
    if (!p) throw new StudioError('NOT_FOUND', '프롬프트 프리셋을 찾을 수 없습니다: ' + id, { status: 404 });
    return p;
  };
  const ver = (p, v) => {
    const x = p.versions.find((y) => y.v === Number(v));
    if (!x) throw new StudioError('NOT_FOUND', '프리셋 버전을 찾을 수 없습니다.', { status: 404 });
    return x;
  };
  const meta = (p, d) => ({ id: p.id, name: p.name, description: p.description || '', builtIn: !!p.builtIn, active: d.activePresetId === p.id, current: p.current, versions: p.versions.map((x) => ({ v: x.v, at: x.at, by: x.by, note: x.note, default: !!x.default })), derivedFrom: p.derivedFrom || null });

  function cleanSections(input, base) {
    const out = Object.assign({}, base);
    SECTION_KEYS.forEach((k) => {
      if (input && input[k] !== undefined) {
        const t = String(input[k]).replace(/\r\n/g, '\n');
        if (t.length > MAX_SECTION) throw new StudioError('PROMPT_TOO_LONG', `"${k}" 칸이 너무 깁니다 (${MAX_SECTION}자 이하).`);
        out[k] = t;
      }
    });
    SECTION_KEYS.forEach((k) => {
      if (!String(out[k] || '').trim()) throw new StudioError('PROMPT_EMPTY', `"${SECTIONS.find((s) => s[0] === k)[1]}" 칸은 비워 둘 수 없습니다.`, { recovery: '내용을 입력하거나 기본값으로 복원하세요.' });
    });
    return out;
  }

  function view(id) {
    const d = read();
    const p = find(d, id);
    const cur = ver(p, p.current);
    return Object.assign(meta(p, d), { sections: cur.sections, sectionInfo: SECTIONS.map(([key, label, help]) => ({ key, label, help })) });
  }

  const api = {
    SECTIONS, LOCKED, DEFAULT_ID,
    list() { const d = read(); return { activePresetId: d.activePresetId, presets: Object.values(d.presets).map((p) => meta(p, d)), sectionInfo: SECTIONS.map(([key, label, help]) => ({ key, label, help })), locked: LOCKED, lockedFormula: { story: lockedFor('story'), beat: lockedFor('beat'), ending: lockedFor('ending') } }; },
    get: view,
    versionSections(id, v) { const p = find(read(), id); return ver(p, v).sections; },
    /** Saves a NEW version (history is never rewritten). Unchanged text creates nothing. */
    save(id, { sections, name, note = '', by = 'operator' } = {}) {
      const d = read();
      const p = find(d, id);
      const cur = ver(p, p.current);
      const next = cleanSections(sections, cur.sections);
      const changed = SECTION_KEYS.some((k) => next[k] !== cur.sections[k]);
      if (name !== undefined && String(name).trim() && String(name).trim() !== p.name) p.name = String(name).trim().slice(0, 80);
      if (changed) {
        const v = Math.max(...p.versions.map((x) => x.v)) + 1;
        p.versions.push({ v, sections: next, at: nowIso(), by, note: String(note).slice(0, 200) });
        p.current = v;
      }
      write(d);
      return view(id);
    },
    duplicate(id, { name, by = 'operator' } = {}) {
      const d = read();
      const src = find(d, id);
      let n = 2;
      let nid;
      do { nid = (id.replace(/-copy\d*$/, '') + '-copy' + (n > 2 ? n : '')).slice(0, 60); n += 1; } while (d.presets[nid]);
      const cur = ver(src, src.current);
      d.presets[nid] = { id: nid, name: String(name || '').trim().slice(0, 80) || `${src.name} 복제본`, description: `${src.name} v${cur.v}에서 복제`, builtIn: false, createdAt: nowIso(), current: 1, derivedFrom: { presetId: id, version: cur.v }, versions: [{ v: 1, sections: Object.assign({}, cur.sections), at: nowIso(), by, note: `${src.name} v${cur.v}에서 복제` }] };
      write(d);
      return view(nid);
    },
    /** Restoring an old version or the original default creates a NEW version. */
    restore(id, { version, toDefault = false, by = 'operator' } = {}) {
      const d = read();
      const p = find(d, id);
      let sections;
      let note;
      if (toDefault) {
        if (!p.builtIn) throw new StudioError('NO_DEFAULT', '기본값은 기본 제공 프리셋에만 있습니다. 이전 버전으로 복원하세요.', { status: 409 });
        sections = Object.assign({}, seed().sections);
        note = '기본값으로 복원';
      } else { sections = Object.assign({}, ver(p, version).sections); note = `v${version} 복원`; }
      const v = Math.max(...p.versions.map((x) => x.v)) + 1;
      p.versions.push({ v, sections, at: nowIso(), by, note, default: !!toDefault });
      p.current = v;
      write(d);
      return view(id);
    },
    setActive(id) { const d = read(); find(d, id); d.activePresetId = id; write(d); return api.list(); },
    activeId: () => read().activePresetId,
    /** { presetId, version|null, comedyLevel } → what will actually be used (latest version when none is pinned). */
    resolve(sel = {}) {
      const d = read();
      const p = find(d, sel.presetId || d.activePresetId);
      const v = ver(p, sel.version || p.current);
      const level = [1, 2, 3].includes(Number(sel.comedyLevel)) ? Number(sel.comedyLevel) : 2;
      return { preset: p, version: v, comedyLevel: level, pinned: !!sel.version };
    },
    /** The full effective prompt = editable creative text (with variables filled in) + the code-enforced constraints. */
    compose(sel = {}, vars = {}, { mode = 'legacy', cast = null } = {}) {
      const r = api.resolve(sel);
      const ch = prompts.channel();
      const all = Object.assign({ CHANNEL: ch.name, AUDIENCE: ch.audience, BRANDING: ch.branding, EXTRA: '' }, vars);
      let s = r.version.sections;
      if (cast && cast.neutral) s = Object.assign({}, s, NEUTRAL_SECTIONS(cast));
      const parts = [s.systemPrompt, s.generationInstructions, s['comedyLevel' + r.comedyLevel], s.characterRules, s.subtitleStyle, s.sceneStructure, s.productIntegration];
      const editable = parts.map((t) => renderTemplate(t, all)).join('\n\n');
      return { editable, locked: lockedFor(mode, cast), mode, presetId: r.preset.id, presetName: r.preset.name, presetVersion: r.version.v, comedyLevel: r.comedyLevel, pinned: r.pinned, sectionsHash: sha256(JSON.stringify(s)).slice(0, 12) };
    },
  };
  return api;
}

module.exports = { createScriptPresets, SECTIONS, SECTION_KEYS, LOCKED, lockedFor, DEFAULT_ID };
