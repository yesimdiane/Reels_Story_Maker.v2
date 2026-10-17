// Character Universes + extended character profiles on top of characters.json (schema 2).
//   * universes[]: a "cast" with its own storytelling style / language / visual style (Jack & Diane, Gregory Cats, ...)
//   * characters[]: the existing profiles (look = appearance, references, voice) + universeId and richer personality data
//   * migrate(): idempotent, ADDITIVE ONLY — it never overwrites a value an operator already edited and never touches
//     references or voice settings. Existing projects (no cast stored) resolve to the Jack & Diane cast.
//   * castPrompt(): the cast block appended by CODE to story/script requests — character facts come from this data,
//     not from hardcoded prompt text.
// Nothing in this file calls an AI provider or any paid API.
'use strict';
const { StudioError, nowIso } = require('./util');

const DEFAULT_UNIVERSE = 'jackdiane';
const SCHEMA = 2;
const UNIVERSE_FIELDS = ['name', 'description', 'storyStyle', 'language', 'visualStyle', 'endingTemplateId'];
const REF_ONLY = '외모는 승인된 참조 이미지로만 정의합니다 (색·무늬를 지어내지 않음)';

const SEED_UNIVERSES = [
  { id: 'jackdiane', name: 'Jack & Diane', description: 'International married couple: a British husband and a Korean wife.', storyStyle: 'Korean and British cultural comedy about everyday life; warm, teasing married-couple chemistry.', language: 'en', visualStyle: 'Animated sitcom style (2D anime/webtoon, consistent character look).', endingTemplateId: 'jack-diane-coupang-ending-v1', builtin: true, active: true },
  { id: 'gregory-cats', name: 'Gregory Cats', description: 'Three cats living in the Gregory household.', storyStyle: 'Pet comedy and personality-driven storytelling.', language: 'en', visualStyle: 'Consistent animated character style across all episodes.', endingTemplateId: 'gregory-cats-ending-v1', builtin: true, active: true },
];

const voice = () => ({ provider: 'heygen', language: 'en', heygenVoiceId: '', heygenIdentityId: '', speed: 1.0, verified: false, verifiedAt: '' });
const SEED_CHARACTERS = [
  { id: 'cloud', name: 'Cloud', nameKo: 'Cloud', universeId: 'gregory-cats', role: 'Ragdoll cat — the responsible eldest brother', look: '', personality: ['responsible', 'calm', 'mature'], speakingStyle: 'Calm and measured.', promptBlock: 'Cloud: Ragdoll cat; calm, mature eldest brother (appearance from approved reference images only)', relationships: [{ characterId: 'louie', note: 'Eldest brother of Louie; keeps him in check.' }, { characterId: 'lucy', note: 'Eldest brother of Lucy; looks out for her.' }], behaviorRules: [], negativePrompts: [] },
  { id: 'louie', name: 'Louie', nameKo: 'Louie', universeId: 'gregory-cats', role: 'Korean shorthair cat — the mischievous middle brother', look: '', personality: ['mischievous', 'curious', 'chaotic'], speakingStyle: 'Excitable and impulsive.', promptBlock: 'Louie: Korean shorthair cat; mischievous, curious, chaotic middle brother (appearance from approved reference images only)', relationships: [{ characterId: 'cloud', note: 'Middle brother; younger brother of Cloud.' }, { characterId: 'lucy', note: 'Older brother of Lucy.' }], behaviorRules: [], negativePrompts: [] },
  { id: 'lucy', name: 'Lucy', nameKo: 'Lucy', universeId: 'gregory-cats', role: 'Korean shorthair cat — the youngest princess', look: '', personality: ['playful', 'demanding'], speakingStyle: 'Playful and demanding.', promptBlock: 'Lucy: Korean shorthair cat; playful, demanding youngest sibling (appearance from approved reference images only)', relationships: [{ characterId: 'cloud', note: 'Youngest sibling; Cloud is her eldest brother.' }, { characterId: 'louie', note: 'Youngest sibling; Louie is her middle brother.' }], behaviorRules: [], negativePrompts: [] },
];
const JD_EXTRAS = {
  jack: { speakingStyle: 'Dry British humour; sarcastic, stubborn.', relationships: [{ characterId: 'diane', note: 'Husband of Diane; affectionate, teasing, long-suffering.' }] },
  diane: { speakingStyle: 'Expressive, energetic, quick-witted.', relationships: [{ characterId: 'jack', note: 'Wife of Jack. She never calls him "Oppa".' }], negativePrompts: ['Never calls Jack "Oppa" (오빠).'] },
};

const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v, n = 1000) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
const list = (v, n = 20, len = 300) => arr(typeof v === 'string' ? v.split('\n') : v).map((x) => text(x, len)).filter(Boolean).slice(0, n);
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/** Brings a loaded library to schema 2 without changing anything an operator may have edited. Returns { lib, changed }. */
function migrate(lib) {
  let changed = false;
  const set = (o, k, v) => { if (o[k] === undefined) { o[k] = v; changed = true; } };
  if (!Array.isArray(lib.universes)) { lib.universes = []; changed = true; }
  SEED_UNIVERSES.forEach((u) => { if (!lib.universes.some((x) => x.id === u.id)) { lib.universes.push(Object.assign({ createdAt: nowIso(), updatedAt: nowIso() }, u)); changed = true; } });
  lib.characters = arr(lib.characters);
  lib.characters.forEach((c) => {
    set(c, 'universeId', DEFAULT_UNIVERSE);
    set(c, 'speakingStyle', (JD_EXTRAS[c.id] || {}).speakingStyle || '');
    set(c, 'catchphrases', c.catchphrase ? [c.catchphrase] : []);
    set(c, 'relationships', (JD_EXTRAS[c.id] || {}).relationships || []);
    set(c, 'behaviorRules', []);
    set(c, 'negativePrompts', (JD_EXTRAS[c.id] || {}).negativePrompts || []);
    if (typeof c.personality === 'string') { c.personality = [c.personality]; changed = true; }
  });
  SEED_CHARACTERS.forEach((s) => {
    if (lib.characters.some((c) => c.id === s.id)) return;
    lib.characters.push(Object.assign({ catchphrase: '', catchphraseNote: '', catchphrases: [], forbiddenWords: [], forbiddenNote: '', voice: voice(), references: [], seeded: true, createdAt: nowIso() }, JSON.parse(JSON.stringify(s))));
    changed = true;
  });
  if (lib.schema !== SCHEMA) { lib.schema = SCHEMA; changed = true; }
  return { lib, changed };
}

function createUniverseService({ store, episodes = () => [], storylabCasts = () => [] }) {
  const load = () => store.characters.load();
  const save = (lib) => store.characters.save(lib);
  const universeOf = (lib, id) => lib.universes.find((u) => u.id === id);

  function charView(c, lib) {
    const refOk = (c.references || []).some((r) => r.approved);
    return { id: c.id, name: c.name, nameKo: c.nameKo || c.name, role: c.role || '', universeId: c.universeId, hasApprovedReference: refOk, referenceCount: (c.references || []).length, hasAppearance: !!text(c.look), thumb: refOk ? { url: `/media/ref/${c.id}/${c.references.find((r) => r.approved).id}` } : (c.references || [])[0] ? { url: `/media/ref/${c.id}/${c.references[0].id}`, unapproved: true } : null };
  }
  function overview() {
    const lib = load();
    return {
      defaultUniverseId: DEFAULT_UNIVERSE,
      universes: lib.universes.map((u) => Object.assign({}, u, { characters: lib.characters.filter((c) => (c.universeId || DEFAULT_UNIVERSE) === u.id).map((c) => charView(c, lib)), usage: usageOfUniverse(u.id) })),
    };
  }

  // ---------- where is a universe / character used? (deletion safety) ----------
  function usageOfUniverse(id) {
    const eps = episodes().filter((e) => ((e.cast || {}).universeId || DEFAULT_UNIVERSE) === id && !e.trashedAt);
    return { episodes: eps.length, storylab: storylabCasts().filter((c) => c.universeId === id).length };
  }
  function usageOfCharacter(id) {
    const eps = episodes().filter((e) => !e.trashedAt && (((e.cast || {}).characterIds || e.characters || []).includes(id) || (e.scenes || []).some((s) => (s.characters || []).includes(id))));
    return { episodes: eps.map((e) => e.displayId || e.id), storylab: storylabCasts().filter((c) => (c.characterIds || []).includes(id)).length };
  }

  // ---------- universes ----------
  function cleanUniverse(i, base = {}) {
    const out = Object.assign({}, base);
    UNIVERSE_FIELDS.forEach((k) => { if (i[k] !== undefined) out[k] = text(i[k], k === 'name' ? 80 : k === 'endingTemplateId' ? 80 : 600); });
    if (i.active !== undefined) out.active = !!i.active;
    if (!out.name) throw new StudioError('NAME', '유니버스 이름이 필요합니다.', { status: 400 });
    if (!out.language) out.language = 'en';
    return out;
  }
  function createUniverse(input = {}) {
    const lib = load();
    let id = slug(input.name) || 'universe';
    while (universeOf(lib, id)) id += '-' + Math.random().toString(36).slice(2, 5);
    const u = cleanUniverse(input, { id, endingTemplateId: '', builtin: false, active: true, createdAt: nowIso() });
    u.updatedAt = nowIso();
    lib.universes.push(u); save(lib);
    return overview();
  }
  function editUniverse(id, patch = {}) {
    const lib = load();
    const u = universeOf(lib, id);
    if (!u) throw new StudioError('NOT_FOUND', '유니버스를 찾을 수 없습니다.', { status: 404 });
    Object.assign(u, cleanUniverse(patch, u), { updatedAt: nowIso() });
    save(lib);
    return overview();
  }
  function deleteUniverse(id) {
    const lib = load();
    const u = universeOf(lib, id);
    if (!u) throw new StudioError('NOT_FOUND', '유니버스를 찾을 수 없습니다.', { status: 404 });
    if (u.builtin) throw new StudioError('BUILTIN', '기본 유니버스는 삭제할 수 없습니다. 쓰지 않으려면 "비활성"으로 바꾸세요.', { status: 409 });
    const chars = lib.characters.filter((c) => c.universeId === id);
    if (chars.length) throw new StudioError('NOT_EMPTY', `이 유니버스에 캐릭터가 ${chars.length}명 있습니다. 먼저 캐릭터를 삭제하거나 다른 유니버스로 옮기세요.`, { status: 409 });
    const use = usageOfUniverse(id);
    if (use.episodes || use.storylab) throw new StudioError('IN_USE', `이 유니버스를 쓰는 에피소드 ${use.episodes}개 / 스토리 랩 선택 ${use.storylab}개가 있습니다. 삭제 대신 "비활성"으로 바꾸세요.`, { status: 409, recovery: '기존 프로젝트는 그대로 유지됩니다.' });
    lib.universes = lib.universes.filter((x) => x.id !== id); save(lib);
    return overview();
  }

  // ---------- characters ----------
  function applyProfile(c, i) {
    ['name', 'nameKo', 'role', 'look', 'speakingStyle', 'catchphraseNote', 'forbiddenNote'].forEach((k) => i[k] !== undefined && (c[k] = text(i[k], k === 'look' ? 1500 : 300)));
    if (i.personality !== undefined) c.personality = list(i.personality, 12, 80);
    if (i.catchphrases !== undefined) { c.catchphrases = list(i.catchphrases, 8, 120); c.catchphrase = c.catchphrases[0] || ''; }
    if (i.behaviorRules !== undefined) c.behaviorRules = list(i.behaviorRules, 20, 300);
    if (i.negativePrompts !== undefined) c.negativePrompts = list(i.negativePrompts, 20, 300);
    if (i.forbiddenWords !== undefined) c.forbiddenWords = list(i.forbiddenWords, 20, 40);
    if (i.relationships !== undefined) c.relationships = arr(i.relationships).map((r) => ({ characterId: text(r && r.characterId, 40), note: text(r && r.note, 300) })).filter((r) => r.characterId && r.note).slice(0, 12);
    if (i.promptBlock !== undefined) c.promptBlock = text(i.promptBlock, 600);
  }
  function createCharacter(input = {}) {
    const lib = load();
    const name = text(input.name, 80);
    if (!name) throw new StudioError('NAME', '캐릭터 이름이 필요합니다.', { status: 400 });
    const uid = text(input.universeId) || DEFAULT_UNIVERSE;
    if (!universeOf(lib, uid)) throw new StudioError('NO_UNIVERSE', '유니버스를 선택하세요.', { status: 400 });
    let id = slug(name) || 'character';
    while (lib.characters.some((c) => c.id === id)) id += '-' + Math.random().toString(36).slice(2, 5);
    const c = { id, name, nameKo: name, universeId: uid, role: '', look: '', personality: [], catchphrase: '', catchphraseNote: '', catchphrases: [], forbiddenWords: [], forbiddenNote: '', speakingStyle: '', relationships: [], behaviorRules: [], negativePrompts: [], promptBlock: '', voice: voice(), references: [], createdAt: nowIso() };
    applyProfile(c, input);
    if (!c.promptBlock) c.promptBlock = `${c.name}: ${c.role || 'character'}${c.look ? '; ' + c.look : ' (appearance from approved reference images only)'}`;
    lib.characters.push(c); save(lib);
    return c;
  }
  function editCharacter(id, patch = {}) {
    const lib = load();
    const c = lib.characters.find((x) => x.id === id);
    if (!c) throw new StudioError('NOT_FOUND', '캐릭터를 찾을 수 없습니다: ' + id, { status: 404 });
    if (patch.universeId !== undefined && patch.universeId !== c.universeId) {
      if (!universeOf(lib, patch.universeId)) throw new StudioError('NO_UNIVERSE', '유니버스를 찾을 수 없습니다.', { status: 400 });
      const u = usageOfCharacter(id);
      if (u.episodes.length) throw new StudioError('IN_USE', `에피소드 ${u.episodes.join(', ')}에서 쓰는 캐릭터의 유니버스는 바꿀 수 없습니다.`, { status: 409 });
      c.universeId = patch.universeId;
    }
    applyProfile(c, patch);
    save(lib);
    return c;
  }
  function deleteCharacter(id) {
    const lib = load();
    const c = lib.characters.find((x) => x.id === id);
    if (!c) throw new StudioError('NOT_FOUND', '캐릭터를 찾을 수 없습니다.', { status: 404 });
    if (c.id === 'jack' || c.id === 'diane') throw new StudioError('BUILTIN', 'Jack과 Diane은 기존 에피소드가 쓰는 기본 캐릭터라 삭제할 수 없습니다.', { status: 409 });
    const u = usageOfCharacter(id);
    if (u.episodes.length || u.storylab) throw new StudioError('IN_USE', `${c.name}을(를) 쓰는 에피소드 ${u.episodes.length}개 / 스토리 랩 선택 ${u.storylab}개가 있습니다. 삭제하면 기존 프로젝트가 깨집니다.`, { status: 409, recovery: '유니버스에서 빼려면 해당 프로젝트에서 먼저 캐릭터를 바꾸세요.' });
    lib.characters = lib.characters.filter((x) => x.id !== id); save(lib); // reference files stay on the volume
    return overview();
  }

  // ---------- cast: what a project / concept / episode is about ----------
  /** Normalises a stored or requested cast. A missing cast (every project from before this feature) = the Jack & Diane cast. */
  function normalizeCast(cast, lib = load()) {
    const c = cast && typeof cast === 'object' ? cast : null;
    if (!c || (!c.universeId && !arr(c.characterIds).length)) {
      return { universeId: DEFAULT_UNIVERSE, characterIds: ['jack', 'diane'].filter((id) => lib.characters.some((x) => x.id === id)).concat(lib.characters.filter((x) => (x.universeId || DEFAULT_UNIVERSE) === DEFAULT_UNIVERSE && !['jack', 'diane'].includes(x.id)).map((x) => x.id)), guest: null, narrator: false, implicit: true };
    }
    const universeId = text(c.universeId) || DEFAULT_UNIVERSE;
    const guest = c.guest && text(c.guest.name) ? { name: text(c.guest.name, 60), description: text(c.guest.description, 300) } : null;
    return { universeId, characterIds: Array.from(new Set(arr(c.characterIds).map(String))), guest, narrator: !!c.narrator };
  }
  /** Resolves a cast against the library: profiles, warnings, and hard errors. Never invents or substitutes characters. */
  function resolveCast(cast) {
    const lib = load();
    const n = normalizeCast(cast, lib);
    const universe = universeOf(lib, n.universeId);
    const errors = []; const warnings = [];
    if (!universe) errors.push({ code: 'NO_UNIVERSE', message: `유니버스를 찾을 수 없습니다: ${n.universeId}` });
    else if (universe.active === false) warnings.push({ code: 'UNIVERSE_INACTIVE', message: `${universe.name} 유니버스는 비활성 상태입니다.` });
    const characters = [];
    n.characterIds.forEach((id) => {
      const c = lib.characters.find((x) => x.id === id);
      if (!c) { errors.push({ code: 'UNKNOWN_CHARACTER', characterId: id, message: `캐릭터를 찾을 수 없습니다: ${id}` }); return; }
      if (universe && (c.universeId || DEFAULT_UNIVERSE) !== universe.id) { errors.push({ code: 'WRONG_UNIVERSE', characterId: id, message: `${c.name}은(는) ${universe.name} 유니버스의 캐릭터가 아닙니다.` }); return; }
      characters.push(c);
      if (!(c.references || []).some((r) => r.approved) && !text(c.look)) warnings.push({ code: 'NO_VISUAL', characterId: id, message: `${c.name}: 승인된 참조 이미지도 외모 설명도 없습니다. 참조 이미지를 올려 승인하세요.` });
      else if (!(c.references || []).some((r) => r.approved)) warnings.push({ code: 'NO_REFERENCE', characterId: id, message: `${c.name}: 승인된 참조 이미지가 없습니다 (텍스트 설명만 사용).` });
    });
    if (!characters.length && !n.guest && !n.narrator) errors.push({ code: 'EMPTY_CAST', message: '출연 캐릭터를 한 명 이상 선택하세요 (또는 게스트/내레이터).' });
    return { cast: n, universe: universe || null, characters, errors, warnings, ids: characters.map((c) => c.id) };
  }

  /** The cast block appended by code to story/script requests (profiles come from the library, not from prompt text). */
  function castPrompt(resolved, { stage = 'story' } = {}) {
    const { universe: u, characters: chars, cast } = resolved;
    const byId = Object.fromEntries(chars.map((c) => [c.id, c]));
    const lines = ['--- CAST & UNIVERSE (authoritative; overrides any other character or channel description above) ---'];
    if (u) lines.push(`UNIVERSE: ${u.name} — ${u.description}`, `STORY_STYLE: ${u.storyStyle}`, `DIALOGUE_LANGUAGE: ${u.language === 'ko' ? 'Korean' : 'English'} (subtitles/translations are produced separately)`, `VISUAL_STYLE: ${u.visualStyle}`);
    lines.push('SELECTED_CHARACTERS (these are the ONLY recurring characters; never add or imply another recurring character without explicit operator approval):');
    chars.forEach((c) => {
      const rel = arr(c.relationships).filter((r) => byId[r.characterId]).map((r) => `${byId[r.characterId].name}: ${r.note}`);
      const never = arr(c.negativePrompts).concat(arr(c.forbiddenWords).map((w) => `never says "${w}"`));
      lines.push(`- ${c.id}: ${c.name}${c.role ? ' — ' + c.role : ''}`);
      if (arr(c.personality).length) lines.push(`    personality: ${c.personality.join(', ')}`);
      lines.push(`    appearance: ${text(c.look) || REF_ONLY}`);
      if (text(c.speakingStyle)) lines.push(`    speaking style: ${c.speakingStyle}`);
      const cp = arr(c.catchphrases).length ? c.catchphrases : (c.catchphrase ? [c.catchphrase] : []);
      if (cp.length) lines.push(`    catchphrases (use sparingly, never in every scene): ${cp.map((x) => '"' + x + '"').join(' | ')}`);
      if (rel.length) lines.push(`    relationships: ${rel.join(' / ')}`);
      if (arr(c.behaviorRules).length) lines.push(`    behaviour rules: ${c.behaviorRules.join('; ')}`);
      if (never.length) lines.push(`    NEVER: ${never.join('; ')}`);
    });
    if (cast.guest) lines.push(`GUEST_CHARACTER (one-off, no saved identity, no dialogue by id): ${cast.guest.name}${cast.guest.description ? ' — ' + cast.guest.description : ''}`);
    if (cast.narrator) lines.push('NARRATOR: a voice-over narrator is allowed (narration text only; the narrator is not a character on screen).');
    if (chars.length === 1) lines.push(`FOCUS: the story is centred on ${chars[0].name}; no other recurring character appears.`);
    else if (chars.length > 1) lines.push(`FOCUS: write for exactly this cast (${chars.map((c) => c.name).join(', ')}); not every character needs equal screen time, but nobody outside the cast appears.`);
    lines.push('VISUAL_CONTINUITY: approved reference images define each character’s identity — never change species, breed, colouring, face, hairstyle, build or signature features between scenes.');
    if (stage === 'script') lines.push(`SCRIPT_IDS: "characters" and every dialogue "speaker" must be one of: ${chars.map((c) => c.id).join(', ') || '(none — use narration only)'}.`);
    return lines.join('\n');
  }

  /** Assets that must exist before rendering a cast's dialogue (reference image + a verified voice). Warnings only; the render gate decides. */
  function assetWarnings(ids, { needsVoice = true } = {}) {
    const lib = load();
    const out = [];
    arr(ids).forEach((id) => {
      const c = lib.characters.find((x) => x.id === id);
      if (!c) { out.push({ code: 'UNKNOWN_CHARACTER', characterId: id, message: `캐릭터 ${id}을(를) 라이브러리에서 찾을 수 없습니다.` }); return; }
      if (!(c.references || []).some((r) => r.approved)) out.push({ code: 'NO_REFERENCE', characterId: id, message: `${c.name}: 승인된 참조 이미지가 없습니다.`, recovery: '캐릭터 라이브러리에서 참조 이미지를 올리고 승인하세요.' });
      if (needsVoice && c.voice && c.voice.provider === 'muapi') {
        if (!c.voice.muapiVoiceId) out.push({ code: 'NO_VOICE', characterId: id, message: `${c.name}: MuAPI voice_id가 없습니다.` });
      } else if (needsVoice) {
        if (!c.voice || !c.voice.heygenVoiceId) out.push({ code: 'NO_VOICE', characterId: id, message: `${c.name}: Voice ID가 없습니다.` + (c.voice && c.voice.heygenIdentityId ? ' (Identity ID는 Voice ID가 아닙니다.)' : ''), recovery: 'HeyGen Voice ID를 입력하고 확인하세요. 다른 캐릭터의 목소리로 대체하지 않습니다.' });
        else if (!c.voice.verified) out.push({ code: 'VOICE_UNVERIFIED', characterId: id, message: `${c.name}: Voice ID가 확인되지 않았습니다.` });
      }
    });
    return out;
  }

  return { overview, createUniverse, editUniverse, deleteUniverse, createCharacter, editCharacter, deleteCharacter, normalizeCast, resolveCast, castPrompt, assetWarnings, usageOfUniverse, usageOfCharacter };
}

module.exports = { migrate, createUniverseService, DEFAULT_UNIVERSE, SEED_UNIVERSES, SEED_CHARACTERS, SCHEMA };
