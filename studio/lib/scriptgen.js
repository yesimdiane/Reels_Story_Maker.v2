// Script generation from an APPROVED story concept (Script Studio entry point).
//   * refuses unless the concept is approved at its current revision
//   * writes the draft into an episode (scene-by-scene dialogue, narration, actions, timing, visual direction, product placement, CTA)
//   * records ep.concept (traceability) and ep.scriptSource (provider/model/prompt versions); every generation is a numbered version
//   * never overwrites an existing script without overwrite:true; never approves anything itself
'use strict';
const { StudioError, nowIso } = require('./util');
const fs = require('node:fs');
const path = require('node:path');
const { validateScript, checkTitleKo, isScriptApproved, dialogueTiming, speechNeed, wordBudget, TIGHT_OVER } = require('./episode');
const { claimHits } = require('./claims');
const F = require('./formula');
const SF = require('./scriptformula');
const { sha256, uid } = require('./util');
const T = require('./translate');
const { behaviorLines } = require('./storylab');

function createScriptGen({ store, products, storylab, episodeIds, prompts, presets, endings, router, lib, universes: getUniverses = () => null }) {
  const U = () => getUniverses();
  const storylineText = (c) => c.storyline || [c.hook, c.situation, c.plot, c.payoff].filter(Boolean).join(' ');
  const storySnapshot = (c) => ({ conceptId: c.id, revision: c.revision, title: c.title, storyline: storylineText(c), ko: c.ko || {}, category: c.category || 'drama', maxDurationSec: c.maxDurationSec || null, approvedAt: c.approval && c.approval.at, by: c.approval && c.approval.by });
  /** When the approved story moved on (edited + re-approved), the episode gets the new snapshot as a NEW linked revision; the old one stays in storyHistory. */
  function syncStory(ep, concept) {
    if (ep.story && ep.story.revision === concept.revision) return;
    if (ep.story) ep.storyHistory = (ep.storyHistory || []).concat([ep.story]);
    ep.story = storySnapshot(concept);
    ep.maxDurationSec = concept.maxDurationSec || ep.maxDurationSec || null;
  }
  function episodeIdFor(pid) {
    const used = store.episodes.list({ all: true }).map((e) => e.id).filter((i) => i.startsWith(pid + '-R')).map((i) => Number(i.slice(pid.length + 2))).filter(Number.isFinite);
    return `${pid}-R${String((used.length ? Math.max(...used) : 1) + 1).padStart(2, '0')}`;
  }

  /** Character rules of a non-Jack&Diane universe come from the library (the Jack & Diane wording stays as it was for existing projects). */
  function neutralRules(rc) {
    const out = [`Spoken dialogue in ${rc.universe.language === 'ko' ? 'Korean' : 'English'}; subtitles in Korean.`, 'Keep the approved character references; never change a character\'s identity.'];
    rc.characters.forEach((c) => (c.negativePrompts || []).concat(c.behaviorRules || []).forEach((r) => out.push(`${c.name}: ${r}`)));
    return out;
  }

  /** Creates an (empty) episode bound to an approved concept. Product facts are copied from the verified product record. */
  async function createEpisodeFromConcept(pid, cid, { id, newVersion = false, requestId = '', approveEndingCast = false } = {}) {
    const concept = storylab.requireApproved(pid, cid);
    // Cast: the universe + characters this concept was written for (a concept from before universes = the Jack & Diane cast).
    const rc = U().resolveCast(concept.cast);
    if (rc.errors.length) throw new StudioError('CAST_INVALID', rc.errors[0].message, { status: 409, details: rc.errors, recovery: 'Story Lab에서 출연진을 확인한 뒤 컨셉을 다시 만들거나 승인하세요.' });
    const isDrama = true; // Every newly created episode uses the six-beat story + fixed product ending.
    const endingTemplateId = rc.universe.endingTemplateId || endings.forUniverse(rc.universe.id);
    // The fixed closing (Part B) belongs to the universe. It must not bring in characters nobody selected unless the operator approves it explicitly.
    const endingCast = isDrama ? endings.castOf({ templateId: endingTemplateId }) : [];
    const extras = endingCast.filter((c) => !rc.ids.includes(c));
    if (extras.length && !approveEndingCast) throw new StudioError('ENDING_CAST_MISMATCH', `이 유니버스의 고정 엔딩 3컷에는 선택하지 않은 캐릭터(${extras.join(', ')})가 나옵니다. 출연진에 추가하거나, 엔딩 출연을 명시적으로 승인해야 합니다.`, { status: 409, details: extras.map((c) => ({ code: 'ENDING_CAST_MISMATCH', characterId: c })), recovery: '에피소드 만들기 확인 창에서 엔딩 출연을 승인하세요.' });
    const b = products.bindingFor(pid);
    const p = b.product;
    // A concept that already produced an episode never silently produces another one, and an existing episode is never touched:
    // a repeat handoff is only allowed with an explicit confirmation and always creates a NEW episode (a version of the earlier one).
    if (!id && requestId) { const prior = episodeIds.byRequest(`${cid}:${requestId}`); if (prior) return prior; } // an exact retry of an earlier request returns that episode
    const existing = store.episodes.list().filter((e) => e.concept && e.concept.conceptId === cid);
    if (existing.length && !newVersion) throw new StudioError('EPISODE_EXISTS', `이 컨셉으로 만든 에피소드가 이미 있습니다: ${existing.map((e) => e.id).join(', ')}`, { details: existing.map((e) => e.id), recovery: '기존 에피소드를 열거나, 확인 후 새 버전 에피소드를 만드세요. 기존 에피소드는 변경되지 않습니다.', status: 409 });
    const build = ({ id: epId }) => {
    const seed = {
      id: epId, reelId: epId, productId: pid, title: concept.title, titleEn: '', series: rc.universe.name, universeId: rc.universe.id,
      cast: { universeId: rc.universe.id, characterIds: rc.ids, guest: rc.cast.guest, narrator: rc.cast.narrator, approvedExtras: extras },
      product: { id: pid, name: p.name, kind: p.category || '', verifiedFeatures: b.facts, verifiedBehavior: (b.visualStructure && b.visualStructure.verifiedBehavior) || [], forbiddenClaims: p.forbiddenClaims || [], affiliateUrl: p.affiliateUrl || '', visualSummary: p.description || '', sourceNote: '운영자가 확인한 사실만 사용합니다 (Products 화면).' },
      characters: rc.ids.concat(extras), beats: [],
      scenes: [], lines: [], suggestions: [],
      cta: { lines: [], durationSec: 3.5, keyword: '' },
      publishing: { keyword: '', affiliateUrl: p.affiliateUrl || '', disclosure: '[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
      concept: { productId: pid, conceptId: cid, revision: concept.revision, title: concept.title, approvedAt: concept.approval.at, storyline: storylineText(concept), maxDurationSec: concept.maxDurationSec || null, hook: concept.hook, ctaDirection: concept.ctaDirection, estimatedScenes: concept.estimatedScenes || null, category: concept.category || 'drama', categoryAssumed: !concept.category, versionOf: existing.length ? existing[0].id : null },
      // The approved story as an immutable snapshot (the editable draft lives in Story Lab; later revisions are appended to storyHistory, never overwritten).
      story: storySnapshot(concept), storyHistory: [], maxDurationSec: concept.maxDurationSec || null,
      // Approved product reference images travel with the episode so Storyboard / Animation can show and use the same images.
      productRefs: { referenceSetId: b.reference.waived ? 'waived' : (p.referenceSet || {}).id || '', imageIds: b.reference.imageIds || [], waived: b.reference.waived || '' },
      characterRules: rc.universe.id === 'jackdiane' ? ['Diane never calls Jack "오빠".', 'Spoken dialogue in English; subtitles in Korean.', 'Diane may shout "BABYYYY!!!!!!" when excited (not in every scene).', 'Keep the approved 2D character references; exactly one Jack and one Diane.'] : neutralRules(rc),
      scriptSource: null,
      // Persisted at creation: old episodes without this flag retain legacy durations.
      durationPolicy: { maxSceneSec: 5 },
      formula: 1,
    };
    // Every episode category uses the same six-beat Part A and product-ending Part B.
    // Preserve the selected category as metadata; do not rewrite older episode records.
    SF.seedFormula(seed, endings, endingTemplateId);
    return seed;
    };
    // Story approval → Episode: {PRODUCT_CODE}-{NN}-{D|V|I}. The number is allocated atomically, only when the episode file is really created;
    // a retry with the same requestId returns the episode it already made. (An explicit id is the legacy / test path and gets no number.)
    if (id) { const seed = build({ id }); store.episodes.create(seed); return id; }
    const r = episodeIds.createEpisode({ productId: pid, category: concept.category || 'drama', requestKey: requestId ? `${cid}:${requestId}` : '', buildSeed: build });
    return r.id;
  }

  const STORY_ACTIONS = {
    story: { mode: 'story', instruction: '' },
    escalation: { mode: 'beat', key: 'absurd_escalation', instruction: 'IMPROVE THE ESCALATION: rewrite ONLY the absurd_escalation beat so the SAME problem becomes even more impossible and cartoonishly exaggerated. Keep the setup, problem, twist and the rest as they are.' },
    twist: { mode: 'beat', key: 'unexpected_twist', instruction: 'STRENGTHEN THE UNEXPECTED TWIST: rewrite ONLY the unexpected_twist beat so the reversal is more surprising and stays directly connected to the escalating problem (background-world absurdity, unexpected character behaviour; never unrelated randomness).' },
    bridge: { mode: 'beat', key: 'product_bridge', instruction: 'IMPROVE THE PRODUCT BRIDGE: rewrite ONLY the product_bridge beat so the consequences of the story create a more believable problem at home and a natural excuse for Diane to buy the product. Do not advertise.' },
    ending: { mode: 'ending', instruction: '' },
  };


  /** Extra input data for the fixed formula: operator-written beats, context for a single beat and the ending the application will append. */
  function formulaData(ep, act) {
    const lines = ['--- FIXED FORMULA INPUT ---'];
    const user = F.BEATS.filter((b) => String((ep.comedy_story[b.key] || {}).story_en || '').trim());
    lines.push('USER_STORY_BEATS (operator-written; preserve each as that beat\'s premise):');
    lines.push(...(user.length ? user.map((b) => `- ${b.key} (${b.ko}): ${ep.comedy_story[b.key].story_en}`) : ['- (none written yet)']));
    if (act.mode === 'beat') {
      lines.push('TARGET_BEAT: ' + act.key, 'CURRENT_STORY (context; other beats stay as they are):');
      F.BEATS.forEach((b) => {
        const bb = ep.comedy_story[b.key] || {};
        const sc = ep.scenes.filter((s) => s.beatKey === b.key).map((s) => s.title_ko).join(' / ');
        lines.push(`- ${b.key}: ${bb.title_ko || '(empty)'} — ${bb.story_en || sc || '(empty)'}`);
      });
    }
    const v = SF.endingVars(ep);
    const neutralEp = !!(ep.universeId && ep.universeId !== 'jackdiane');
    lines.push(neutralEp ? 'ENDING (added by the application, Part B, three fixed shots): ' + F.ENDING_KEYS.map((k) => (ep.product_ending[k] || {}).title_ko || k).join(' → ') + '.' : 'ENDING (added by the application, Part B, three fixed shots): Diane\'s shopping excuse → product demonstration → Jack\'s recurring refusal.');
    lines.push('CURRENT_ENDING_VARS: ' + JSON.stringify(v));
    // the ending's fixed lines already use most of each shot's time: keep the product-specific words short so the shots still fit
    const demo = (ep.scenes.find((x) => x.beatKey === 'product_demonstration') || {}).durationSec || 5;
    lines.push(`ENDING_TIMING: keep PRODUCT_NAME and USE_PHRASE to at most 3 words each, and DEMO_LINE_EN to at most ${Math.min(8, wordBudget(demo, 1))} words (the demo shot lasts ${demo} s). Shorter is better.`);
    return lines;
  }

  function buildPrompt(ep, concept, extra, selOverride, action) {
    const structured = F.isStructured(ep);
    const act = structured ? STORY_ACTIONS[action || 'story'] : null;
    if (structured && !act) throw new StudioError('BAD_ACTION', '알 수 없는 대본 생성 동작: ' + action, { status: 400 });
    const L = lib();
    // Creative text comes from the selected preset version; the constraints below it are enforced by code (presets.LOCKED).
    const sel = Object.assign(structured ? { comedyLevel: 3 } : {}, ep.promptPreset || {}, selOverride || {}); // the fixed formula defaults to comedy intensity 3
    const ids = castIdList(ep);
    const rc = U().resolveCast({ universeId: (ep.cast && ep.cast.universeId) || 'jackdiane', characterIds: ids, guest: ep.cast && ep.cast.guest, narrator: ep.cast && ep.cast.narrator });
    const neutral = !!(rc.universe && rc.universe.id !== 'jackdiane');
    const pc = presets.compose(sel, Object.assign({ EXTRA: '' }, neutral ? { BRANDING: `${rc.universe.name} — ${rc.universe.description} ${rc.universe.storyStyle}` } : {}), { mode: structured ? act.mode : 'legacy', cast: { neutral, ids, universeName: rc.universe && rc.universe.name } });
    let legacyOverride = null;
    try { legacyOverride = prompts.compose('script', {}).providerOverride; } catch (_) { /* none */ }
    const chars = L.characters.filter((c) => ids.includes(c.id)).map((c) => `- ${c.id}: ${c.name} — ${c.promptBlock}${c.forbiddenWords && c.forbiddenWords.length ? ' (never says: ' + c.forbiddenWords.join(', ') + ')' : ''}`);
    const data = [
      '--- INPUT DATA (authoritative) ---',
      'CONCEPT_ID: ' + concept.id + ' (revision ' + concept.revision + ')',
      'CONCEPT_TITLE: ' + concept.title,
      'STORY_CATEGORY: ' + (concept.category || 'drama'),
      'APPROVED_STORYLINE: ' + storylineText(concept),
      ...(concept.maxDurationSec ? ['MAX_DURATION_SEC: ' + concept.maxDurationSec] : []),
      ...['hook', 'situation', 'plot', 'productRole', 'characterUsage', 'visualComedy', 'payoff', 'viewerAppeal', 'ctaDirection'].filter((k) => concept[k]).map((k) => `CONCEPT_${k.toUpperCase()}: ${concept[k]}`),
      ...(concept.estimatedScenes ? ['ESTIMATED_SCENES: ' + concept.estimatedScenes] : []),
      neutral ? `LANGUAGE: spoken dialogue in ${rc.universe.language === 'ko' ? 'KOREAN' : 'ENGLISH'}, subtitles in KOREAN.` : 'LANGUAGE: spoken dialogue in ENGLISH, subtitles in KOREAN. Diane never calls Jack "오빠".',
      ...(concept.estimatedDurationSec ? ['ESTIMATED_DURATION_SEC: ' + concept.estimatedDurationSec] : []),
      'PRODUCT_NAME: ' + ep.product.name,
      'VERIFIED_PRODUCT_FACTS (use ONLY these):',
      ...ep.product.verifiedFeatures.map((f) => '- ' + f),
      ...(Array.isArray(ep.product.verifiedBehavior) ? behaviorLines(ep.product.verifiedBehavior) : []), // episodes made before this field existed keep their old prompt
      'FORBIDDEN_CLAIMS: ' + (ep.product.forbiddenClaims.join(', ') || 'none'),
      'CHARACTERS (speaker/characters ids must be one of these):',
      ...chars,
      '',
      U().castPrompt(rc, { stage: 'script' }),
      ...(structured ? formulaData(ep, act) : []),
      ...(ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5 ? [
        'MANDATORY SCENE TIMING: every scene must last 1 to 5 seconds (inclusive). NEVER make a scene longer than 5 seconds.',
        'PART A MUST retain all six story beats in their required order. If a beat needs more than five seconds, split that beat into multiple consecutive scenes with the SAME beatKey; do not merge or delete beats.',
        'Split dialogue across those scenes at natural sentence boundaries, preserve speaking order and matching Korean subtitles. Keep each scene short enough for all spoken lines plus breathing room. Never cut audio or speed up narration.',
        'PART B remains exactly three ending shots; write brief product-specific lines that fit the existing ending timings.',
      ] : []),
    ].join('\n');
    const extraText = [structured && act.instruction ? 'ACTION: ' + act.instruction : '', extra ? 'ADDITIONAL INSTRUCTION FOR THIS RUN (operator):\n' + String(extra).slice(0, 2000) : ''].filter(Boolean).join('\n\n');
    const full = [pc.editable, extraText, data, pc.locked].filter(Boolean).join('\n\n');
    const composed = { text: pc.editable, versions: { script: pc.presetVersion }, providerOverride: legacyOverride, preset: pc };
    return { composed, prompt: full, parts: { editable: pc.editable + (extraText ? '\n\n' + extraText : ''), data, locked: pc.locked }, meta: { mode: structured ? act.mode : 'legacy', action: structured ? (action || 'story') : null, presetId: pc.presetId, presetName: pc.presetName, presetVersion: pc.presetVersion, comedyLevel: pc.comedyLevel, pinned: pc.pinned, promptHash: sha256(full).slice(0, 12) } };
  }

  function normalize(raw, ep) {
    if (!raw || typeof raw !== 'object') throw new StudioError('SCRIPT_REJECTED', 'AI가 대본 JSON을 반환하지 않았습니다.', { status: 422 });
    const L = lib();
    const ids = ep ? charIds(ep) : new Set(L.characters.map((c) => c.id));
    const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => ({
      id: String(s.id || 'S' + (i + 1)), title_ko: String(s.title_ko || '').trim(), title: String(s.title_ko || '').trim(), beat: Number(s.beat) || i + 1, durationSec: Number(s.durationSec) || 4,
      characters: (Array.isArray(s.characters) ? s.characters : []).map(String).filter((c) => ids.has(c)), showsProduct: !!s.showsProduct,
      visual: String(s.visual || ''), action: String(s.action || ''), narration: String(s.narration || ''), placement: String(s.placement || ''),
    }));
    const titleProblems = [];
    scenes.forEach((sc) => checkTitleKo(sc.title_ko).errors.forEach((m) => titleProblems.push(`${sc.id}: ${m}`)));
    if (titleProblems.length) throw new StudioError('SCRIPT_REJECTED', '한국어 장면 제목(title_ko) 규칙을 지키지 않은 응답이라 저장하지 않았습니다: ' + titleProblems[0], { details: titleProblems, recovery: '다시 생성하거나 프롬프트를 확인하세요. 제목은 장면의 핵심 행동·웃음 포인트를 나타내는 한국어여야 합니다.', status: 422 });
    const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((l, i) => ({ id: String(l.id || 'L' + (i + 1)), sceneId: String(l.sceneId || ''), speaker: String(l.speaker || ''), en: String(l.en || '').trim(), ko: String(l.ko || '').trim() }));
    const cta = raw.cta && typeof raw.cta === 'object' ? { lines: (raw.cta.lines || []).map(String), keyword: String(raw.cta.keyword || '').trim(), durationSec: Number(raw.cta.durationSec) || 3.5 } : null;
    if (!scenes.length || !lines.length || !cta) throw new StudioError('SCRIPT_REJECTED', 'AI 응답에 장면, 대사 또는 CTA가 없습니다. 저장하지 않았습니다.', { recovery: '다시 생성하거나 프롬프트를 확인하세요.', status: 422 });
    return { title: String(raw.title || ''), beats: (raw.beats || []).map(String), scenes, lines, cta };
  }

  /**
   * generate(epId, { confirm, overwrite, extra, override })
   * The episode must be bound to a concept (ep.concept) that is approved at its current revision.
   */
  async function generate(epId, { confirm, overwrite = false, extra = '', override, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (F.isStructured(ep0)) return generateFormula(epId, 'story', { confirm, overwrite, extra, override, by });
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 대본을 만들 수 없습니다.', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 그 컨셉으로 에피소드를 만드세요.', status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    if ((ep0.lines || []).length && !overwrite) throw new StudioError('SCRIPT_EXISTS', '이미 대본이 있습니다. 덮어쓰려면 확인하세요 (이전 버전은 버전 기록에 남습니다).', { recovery: '"덮어쓰기"를 선택하면 현재 대본이 버전 기록에 보관된 뒤 새 대본이 만들어집니다.', status: 409 });
    const { composed, prompt } = buildPrompt(ep0, concept, extra);
    const ov = override || composed.providerOverride || undefined;
    const res = await router.run('scriptWriting', { prompt, json: true, maxTokens: 6000, confirm, override: ov, dedupeKey: epId });
    const s = normalize(res.json, ep0);
    const source = { conceptId: concept.id, conceptRevision: concept.revision, productId: concept.productId, provider: res.provider, model: res.model, mock: !!res.mock, promptKey: 'script-preset', promptVersion: composed.versions.script, promptVersions: composed.versions, presetId: composed.preset.presetId, presetName: composed.preset.presetName, presetVersion: composed.preset.presetVersion, comedyLevel: composed.preset.comedyLevel, promptHash: sha256(prompt).slice(0, 12), titleKo: true, generatedAt: nowIso(), by };
    await store.episodes.update(epId, (ep) => {
      T.cachePairs(ep, T.pairsFromScriptJson(res.json), { provider: res.provider, model: res.model, mock: !!res.mock }); // Korean translations arrive with the script: "번역 보기" needs no second call
      if (ep.lines.length) ep.preAiScript = { at: nowIso(), lines: ep.lines.length, scenes: ep.scenes.length };
      ep.title = s.title || ep.title;
      ep.beats = s.beats;
      ep.scenes = s.scenes;
      ep.lines = s.lines;
      ep.cta = Object.assign({}, ep.cta, s.cta);
      ep.publishing = Object.assign({}, ep.publishing, { keyword: s.cta.keyword });
      ep.concept = Object.assign({}, ep.concept, { revision: concept.revision, title: concept.title });
      syncStory(ep, concept);
      ep.scriptSource = source;
      ep.approvals.script = null; // a regenerated script is a new draft: it must be approved again
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: `AI 대본 · 컨셉 ${concept.id} r${concept.revision} · ${res.mock ? '샘플' : res.provider + '/' + res.model} · 프롬프트 v${composed.versions.script}` });
    store.episodes.audit(epId, 'script.generated', { conceptId: concept.id, revision: concept.revision, provider: res.provider, model: res.model, mock: !!res.mock, promptVersion: composed.versions.script });
    return { validation: validateScript(store.episodes.get(epId), lib()), source };
  }


  // ---------- fixed formula: story / single beat / product-specific ending ----------
  /** The characters a script may use: the episode's cast (selected in Story Lab) — never the whole library. Legacy episodes keep their own list. */
  const castIdList = (ep) => { const all = lib().characters.map((c) => c.id); const own = ((ep && ep.characters) || []).filter((id) => all.includes(id)); return own.length ? own : all; };
  const charIds = (ep) => new Set(castIdList(ep));
  const ACTION_LABEL = { story: '코미디 스토리 다시 만들기', escalation: '위기 2(과장) 개선', twist: '절정(반전) 강화', bridge: '제품 연결 개선', ending: '제품별 엔딩 대사 다시 만들기' };

  /**
   * One paid AI action on a formula episode. Part B (the ending template) is never rewritten by Part A actions;
   * hand-edited content is protected: an action that would replace it needs overwrite:true.
   */
  async function generateFormula(epId, action, { confirm, overwrite = false, extra = '', override, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 대본을 만들 수 없습니다.', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 그 컨셉으로 에피소드를 만드세요.', status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    const q0 = buildPrompt(ep0, concept, extra, undefined, action); // throws BAD_ACTION early
    const hasA = ep0.scenes.some((s) => s.part === 'A');
    const keys = action === 'story' ? null : action === 'ending' ? [] : [STORY_ACTIONS[action].key];
    if (action === 'story' && hasA && !overwrite) throw new StudioError('SCRIPT_EXISTS', '이미 PART A 이야기가 있습니다. 다시 만들려면 확인하세요 (이전 버전은 버전 기록에 남습니다).', { recovery: '"덮어쓰기"를 선택하면 현재 대본이 버전 기록에 보관된 뒤 새로 만듭니다.', status: 409 });
    if (action !== 'story' && action !== 'ending' && !ep0.scenes.some((s) => s.beatKey === keys[0])) throw new StudioError('BEAT_EMPTY', '먼저 코미디 스토리를 만드세요. (이 단계가 비어 있습니다)', { status: 409 });
    if (action !== 'ending' && SF.partAHasEdits(ep0, keys) && !overwrite) throw new StudioError('MANUAL_EDITS', '직접 수정한 내용이 있는 단계입니다. 다시 만들면 그 수정이 사라집니다 (이전 버전은 보관됩니다).', { recovery: '확인한 뒤 "덮어쓰기"로 다시 실행하세요.', status: 409 });
    if (isScriptApproved(ep0) && !overwrite) throw new StudioError('SCRIPT_APPROVED', '승인된 대본입니다. 다시 만들면 승인이 취소됩니다 (이전 버전은 보관됩니다).', { recovery: '확인한 뒤 "덮어쓰기"로 다시 실행하세요.', status: 409 });
    const res = await router.run('scriptWriting', { prompt: q0.prompt, json: true, maxTokens: action === 'story' ? 8000 : 3000, confirm, override: override || q0.composed.providerOverride || undefined, dedupeKey: epId + ':' + action });
    // validate EVERYTHING before touching the episode (a bad answer changes nothing; the call is in the usage log)
    let story = null; let beat = null; let vars = {};
    if (action === 'story') { story = SF.normalizeStory(res.json, charIds(ep0), ep0.durationPolicy && ep0.durationPolicy.maxSceneSec === 5 ? 5 : 15); vars = story.vars; }
    else if (action === 'ending') { vars = SF.normalizeVars(res.json && res.json.ending_vars); if (!Object.keys(vars).length) throw new StudioError('SCRIPT_REJECTED', 'AI 응답에 ending_vars가 없습니다. 저장하지 않았습니다.', { status: 422 }); }
    else beat = SF.normalizeBeat(res.json && res.json.beat, keys[0], charIds(ep0), ep0.durationPolicy && ep0.durationPolicy.maxSceneSec === 5 ? 5 : 15);
    const meta = q0.meta;
    const source = { conceptId: concept.id, conceptRevision: concept.revision, productId: concept.productId, provider: res.provider, model: res.model, mock: !!res.mock, promptKey: 'script-preset', promptVersion: meta.presetVersion, promptVersions: { script: meta.presetVersion }, presetId: meta.presetId, presetName: meta.presetName, presetVersion: meta.presetVersion, comedyLevel: meta.comedyLevel, promptHash: meta.promptHash, titleKo: true, formula: 1, action, generatedAt: nowIso(), by };
    await store.episodes.update(epId, (ep) => {
      T.cachePairs(ep, T.pairsFromScriptJson(res.json), { provider: res.provider, model: res.model, mock: !!res.mock });
      if (ep.lines.length) ep.preAiScript = { at: nowIso(), lines: ep.lines.length, scenes: ep.scenes.length };
      if (story) {
        SF.replacePartA(ep, story.beats);
        if (story.title) ep.title = story.title;
        if (story.cta && story.cta.lines.length) { ep.cta = Object.assign({}, ep.cta, story.cta); ep.publishing = Object.assign({}, ep.publishing, { keyword: story.cta.keyword }); }
      } else if (beat) SF.replaceBeat(ep, keys[0], beat);
      // product-specific ending variables: AI values fill only what the operator has not typed by hand
      // Part B (the ending) is filled from the AI's variables ONCE (first generation) or when the ending action is asked for;
      // a later Part A regeneration never rewrites it.
      const manual = new Set((ep.ending.manualVars) || []);
      if (action === 'ending' || (story && !ep.ending.aiVarsApplied)) {
        Object.keys(vars).forEach((k) => { if (!manual.has(k)) ep.ending.vars[k] = vars[k]; });
        SF.applyEnding(ep, endings, { respectEdits: true });
        ep.ending.aiVarsApplied = true;
      }
      ep.concept = Object.assign({}, ep.concept, { revision: concept.revision, title: concept.title });
      syncStory(ep, concept);
      ep.scriptSource = source;
      ep.approvals.script = null; // any regenerated part is a new draft: approve again
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: `${action === 'story' ? 'AI 대본 · ' : ''}${ACTION_LABEL[action]} · ${meta.presetName} v${meta.presetVersion} · 강도 ${meta.comedyLevel} · ${res.mock ? '샘플' : res.provider + '/' + res.model}` });
    store.episodes.audit(epId, 'script.generated', { action, conceptId: concept.id, revision: concept.revision, provider: res.provider, model: res.model, mock: !!res.mock, presetId: meta.presetId, presetVersion: meta.presetVersion, comedyLevel: meta.comedyLevel });
    return { validation: validateScript(store.episodes.get(epId), lib()), source };
  }
  const regenerate = async (epId, action, opts) => {
    if (!F.isStructured(store.episodes.get(epId))) throw new StudioError('NOT_FORMULA', '이 에피소드는 고정 에피소드 포맷이 아닙니다 (이전에 만든 에피소드).', { status: 409 });
    return generateFormula(epId, action, opts);
  };

  /** Selects the ending template (and optionally resets hand-edited shots). Part A is never touched. */
  async function selectEnding(epId, { templateId, version, resetEdits = false, by = 'operator' } = {}) {
    if (!F.isStructured(store.episodes.get(epId))) throw new StudioError('NOT_FORMULA', '이 에피소드는 고정 에피소드 포맷이 아닙니다.', { status: 409 });
    endings.resolve({ templateId, version }); // throws NOT_FOUND
    await store.episodes.update(epId, (ep) => {
      ep.ending = Object.assign({}, ep.ending, { templateId: templateId || endings.activeId(), version: version ? Number(version) : null });
      SF.applyEnding(ep, endings, { respectEdits: !resetEdits });
      ep.approvals.script = null;
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: '엔딩 템플릿 선택' });
    store.episodes.audit(epId, 'script.ending_selected', { templateId, version: version || null, resetEdits });
    return store.episodes.get(epId).ending;
  }


  // ---------- dialogue timing: shorten (not extend) ----------
  const fitTargets = (ep, sceneIds) => {
    const structured = F.isStructured(ep);
    const all = dialogueTiming(ep).filter((t) => t.lineCount && t.status !== 'ok');
    const want = sceneIds && sceneIds.length ? all.filter((t) => sceneIds.includes(t.sceneId)) : all;
    const ending = want.filter((t) => structured && (ep.scenes.find((x) => x.id === t.sceneId) || {}).part === 'B');
    const targets = want.filter((t) => !ending.includes(t));
    return { targets, ending, all };
  };
  const timingSel = (ep, sel) => Object.assign(F.isStructured(ep) ? { comedyLevel: 3 } : {}, ep.promptPreset || {}, sel || {});
  function buildTimingPrompt(ep, concept, targets, extra, sel) {
    const pc = presets.compose(timingSel(ep, sel), { EXTRA: '' }, { mode: 'timing' });
    const data = [
      '--- INPUT DATA (authoritative) ---',
      'CONCEPT_TITLE: ' + concept.title,
      'PRODUCT_NAME: ' + ep.product.name,
      'FORBIDDEN_CLAIMS: ' + ((ep.product.forbiddenClaims || []).join(', ') || 'none'),
      'TIMING_TARGETS (scenes to shorten; the application estimates speech at about 2.7 words per second):',
      JSON.stringify(targets.map((t) => ({ id: t.sceneId, title: t.title, durationSec: t.durationSec, estimatedNeedSec: t.needSec, overSec: t.overSec, wordBudget: t.wordBudget, currentWords: t.words, lines: ep.lines.filter((l) => l.sceneId === t.sceneId).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko })) })), null, 1),
    ].join('\n');
    const extraText = extra ? 'ADDITIONAL INSTRUCTION FOR THIS RUN (operator):\n' + String(extra).slice(0, 1000) : '';
    const full = [pc.editable, extraText, data, pc.locked].filter(Boolean).join('\n\n');
    return { prompt: full, meta: { mode: 'timing', presetId: pc.presetId, presetName: pc.presetName, presetVersion: pc.presetVersion, comedyLevel: pc.comedyLevel, promptHash: sha256(full).slice(0, 12) } };
  }
  function requireConcept(ep) {
    if (!ep.concept || !ep.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI로 대사를 줄일 수 없습니다. 대사를 직접 줄이거나 장면 길이를 늘려 주세요.', { status: 409 });
    return storylab.requireApproved(ep.concept.productId, ep.concept.conceptId);
  }
  /** Free: which scenes would be shortened, and what it would cost. */
  function fitEstimate(epId, sceneIds, sel) {
    const ep = store.episodes.get(epId);
    const concept = requireConcept(ep);
    const { targets, ending } = fitTargets(ep, sceneIds);
    if (!targets.length) throw new StudioError('NOTHING_TO_FIT', ending.length ? '엔딩(PART B) 컷은 AI가 줄이지 않습니다. 컷 길이를 늘리거나 제품별 값을 짧게 고치세요.' : '시간이 넘치는 장면이 없습니다.', { status: 409 });
    const q = buildTimingPrompt(ep, concept, targets, '', sel);
    return Object.assign(router.estimate('scriptWriting', { inputChars: q.prompt.length, outputTokens: 1500, override: undefined }), { sceneIds: targets.map((t) => t.sceneId), skippedEnding: ending.map((t) => t.sceneId) });
  }
  /**
   * Shortens the dialogue of the scenes whose estimated speech does not fit (paid, confirmed). Lines are removed or tightened;
   * scene durations are NOT changed. A result that would not make a scene shorter is ignored. The ending template is never touched.
   */
  async function fitDialogue(epId, { sceneIds, confirm, overwrite = false, extra = '', sel, by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    const concept = requireConcept(ep0);
    const { targets, ending } = fitTargets(ep0, sceneIds);
    if (!targets.length) throw new StudioError('NOTHING_TO_FIT', ending.length ? '엔딩(PART B) 컷은 AI가 줄이지 않습니다. 컷 길이를 늘리거나 제품별 값을 짧게 고치세요.' : '시간이 넘치는 장면이 없습니다.', { status: 409 });
    const edited = targets.filter((t) => (ep0.scenes.find((x) => x.id === t.sceneId) || {}).manualEdit);
    if (edited.length && !overwrite) throw new StudioError('MANUAL_EDITS', `직접 수정한 장면의 대사를 줄이면 그 수정이 바뀝니다: ${edited.map((t) => t.sceneId).join(', ')} (이전 버전은 보관됩니다).`, { recovery: '확인한 뒤 "덮어쓰기"로 다시 실행하세요.', status: 409 });
    if (isScriptApproved(ep0) && !overwrite) throw new StudioError('SCRIPT_APPROVED', '승인된 대본입니다. 대사를 줄이면 승인이 취소됩니다 (이전 버전은 보관됩니다).', { recovery: '확인한 뒤 "덮어쓰기"로 다시 실행하세요.', status: 409 });
    const q = buildTimingPrompt(ep0, concept, targets, extra, sel);
    const res = await router.run('scriptWriting', { prompt: q.prompt, json: true, maxTokens: 3000, confirm, dedupeKey: epId + ':timing:' + q.meta.promptHash });
    // validate the whole answer first; a bad answer changes nothing (the call is in the usage log)
    const raw = res.json && Array.isArray(res.json.scenes) ? res.json.scenes : null;
    if (!raw) throw new StudioError('SCRIPT_REJECTED', 'AI 응답에 scenes가 없습니다. 저장하지 않았습니다.', { status: 422 });
    const forbidden = ep0.product.forbiddenClaims || [];
    const plan = [];
    const skipped = [];
    targets.forEach((t) => {
      const ans = raw.find((x) => x && x.id === t.sceneId);
      if (!ans || !Array.isArray(ans.lines)) { skipped.push({ sceneId: t.sceneId, reason: 'AI 응답에 이 장면이 없습니다.' }); return; }
      const orig = ep0.lines.filter((l) => l.sceneId === t.sceneId);
      const byId = new Map(orig.map((l) => [l.id, l]));
      const next = [];
      for (const l of ans.lines) {
        const o = byId.get(String(l && l.id));
        if (!o) throw new StudioError('SCRIPT_REJECTED', `${t.sceneId}: 없는 대사 ID (${l && l.id})입니다. 대사를 새로 만들 수 없습니다. 저장하지 않았습니다.`, { status: 422 });
        if (String(l.speaker) !== o.speaker) throw new StudioError('SCRIPT_REJECTED', `${t.sceneId}: 화자를 바꿀 수 없습니다 (${o.id}). 저장하지 않았습니다.`, { status: 422 });
        const en = String(l.en || '').trim(); const ko = String(l.ko || '').trim();
        if (!en || !ko || en === ko) throw new StudioError('SCRIPT_REJECTED', `${t.sceneId}: 영어 대사와 한국어 자막이 모두 있어야 하고 서로 달라야 합니다 (${o.id}). 저장하지 않았습니다.`, { status: 422 });
        if (claimHits(en + '\n' + ko, forbidden).length || (o.speaker === 'diane' && /오빠/.test(en + ko))) throw new StudioError('SCRIPT_REJECTED', `${t.sceneId}: 금지된 표현이 있습니다 (${o.id}). 저장하지 않았습니다.`, { status: 422 });
        next.push({ id: o.id, speaker: o.speaker, en, ko });
      }
      if (!next.length) { skipped.push({ sceneId: t.sceneId, reason: '모든 대사를 지울 수는 없습니다 (최소 한 줄 필요).' }); return; }
      const after = speechNeed(next);
      if (after >= t.needSec - 0.01) { skipped.push({ sceneId: t.sceneId, reason: '새 대사가 더 짧지 않아 적용하지 않았습니다.' }); return; }
      plan.push({ sceneId: t.sceneId, beforeSec: t.needSec, afterSec: Math.round(after * 100) / 100, durationSec: t.durationSec, lines: next, removed: orig.length - next.length });
    });
    if (!plan.length) throw new StudioError('SCRIPT_REJECTED', '적용할 수 있는 더 짧은 대사가 없었습니다. ' + (skipped[0] ? skipped[0].reason : ''), { details: skipped, recovery: '다시 시도하거나 대사를 직접 줄이세요. 이전 대본은 그대로입니다.', status: 422 });
    await store.episodes.update(epId, (ep) => {
      if (ep.lines.length) ep.preAiScript = { at: nowIso(), lines: ep.lines.length, scenes: ep.scenes.length };
      plan.forEach((p0) => {
        const keep = new Map(p0.lines.map((l) => [l.id, l]));
        ep.lines = ep.lines.filter((l) => l.sceneId !== p0.sceneId || keep.has(l.id));
        ep.lines.forEach((l) => { const k = keep.get(l.id); if (l.sceneId === p0.sceneId && k) { l.en = k.en; l.ko = k.ko; } });
      });
      ep.scriptSource = Object.assign({}, ep.scriptSource || {}, { fittedAt: nowIso(), fitPromptHash: q.meta.promptHash });
      ep.approvals.script = null; // shortened dialogue is a new draft: approve again
      ep.approvals.storyboard = null;
    }, { snapshot: true, by, note: `대사 시간 맞추기(AI) · ${plan.map((x) => x.sceneId).join(', ')} · ${res.mock ? '샘플' : res.provider + '/' + res.model}` });
    store.episodes.audit(epId, 'script.dialogue_fitted', { scenes: plan.map((x) => x.sceneId), provider: res.provider, model: res.model, mock: !!res.mock, presetId: q.meta.presetId, presetVersion: q.meta.presetVersion });
    const ep1 = store.episodes.get(epId);
    const stillOver = dialogueTiming(ep1).filter((t) => t.lineCount && t.overSec > TIGHT_OVER).map((t) => ({ sceneId: t.sceneId, overSec: t.overSec }));
    return { fitted: plan.map(({ lines, ...rest }) => rest), skipped, stillOver, validation: validateScript(ep1, lib()) };
  }

  /** Is the script still in sync with its concept? Used by the UI ("script regeneration required"). */
  function conceptStatus(ep) {
    if (!ep.concept || !ep.concept.conceptId) return { linked: false, legacy: true, note: '스토리 랩 이전에 만든 에피소드(연결된 컨셉 없음)' };
    const c = storylab.peek(ep.concept.productId, ep.concept.conceptId);
    if (!c) return { linked: true, ok: false, state: 'missing', note: '연결된 컨셉을 찾을 수 없습니다.' };
    const approved = storylab.isApproved(c);
    const usedRev = ep.scriptSource ? ep.scriptSource.conceptRevision : ep.concept.revision;
    const changed = usedRev !== c.revision;
    return {
      linked: true, conceptId: c.id, title: c.title, revision: c.revision, scriptRevision: usedRev, approved, scriptGenerated: !!ep.scriptSource,
      regenerationRequired: !!(ep.scriptSource && changed), ok: approved && !(ep.scriptSource && changed),
      state: !approved ? 'not_approved' : changed && ep.scriptSource ? 'script_stale' : 'ok',
      note: !approved ? '컨셉 승인이 취소되었거나 수정 후 재승인이 필요합니다.' : changed && ep.scriptSource ? `컨셉이 r${usedRev} → r${c.revision}로 바뀌었습니다. 대본을 다시 생성해야 합니다.` : '',
    };
  }


  // ---- selection, effective prompt and Test Prompt ----
  const testsDir = (epId) => store.episodes.file(epId, 'prompt-tests');

  /** Which preset/version/comedy level the episode will use for its NEXT generation (never changes an existing script). */
  async function selectPreset(epId, { presetId, version, comedyLevel } = {}) {
    const cur = store.episodes.get(epId).promptPreset || {};
    const next = { presetId: presetId || cur.presetId || presets.activeId(), version: version ? Number(version) : null, comedyLevel: [1, 2, 3].includes(Number(comedyLevel)) ? Number(comedyLevel) : cur.comedyLevel || (F.isStructured(store.episodes.get(epId)) ? 3 : 2) };
    presets.resolve(next); // throws NOT_FOUND for an unknown preset/version
    await store.episodes.update(epId, (ep) => { ep.promptPreset = next; });
    store.episodes.audit(epId, 'script.preset_selected', next);
    return next;
  }

  /** The full effective prompt exactly as it would be sent (editable text + input data + code-enforced constraints). */
  function effectivePrompt(epId, sel, extra, action) {
    const ep = store.episodes.get(epId);
    if (!ep.concept || !ep.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않아 AI 프롬프트를 만들 수 없습니다.', { status: 409 });
    const concept = storylab.requireApproved(ep.concept.productId, ep.concept.conceptId);
    const q = buildPrompt(ep, concept, extra, sel, action);
    return { parts: q.parts, full: q.prompt, meta: q.meta, chars: q.prompt.length };
  }

  /**
   * "Test Prompt": the same paid call as a real generation, but the result is stored as a separate test draft and the
   * episode (script, approvals, versions) is NOT touched. Needs the same explicit cost confirmation.
   */
  async function testPrompt(epId, { sel, confirm, extra = '', by = 'operator' } = {}) {
    const ep0 = store.episodes.get(epId);
    if (!ep0.concept || !ep0.concept.conceptId) throw new StudioError('NO_CONCEPT', '이 에피소드는 스토리 컨셉과 연결되어 있지 않습니다.', { status: 409 });
    const concept = storylab.requireApproved(ep0.concept.productId, ep0.concept.conceptId);
    const { composed, prompt, meta } = buildPrompt(ep0, concept, extra, sel);
    const ov = composed.providerOverride || undefined;
    const res = await router.run('scriptWriting', { prompt, json: true, maxTokens: 6000, confirm, override: ov, dedupeKey: epId + ':test:' + meta.promptHash });
    const rec = { id: uid('ptest'), at: nowIso(), by, epId, meta, mock: !!res.mock, provider: res.provider, model: res.model, extra: String(extra).slice(0, 2000), estimate: res.estimate || null, draft: null, validation: null, error: null, rawJson: null };
    try {
      if (F.isStructured(ep0)) {
        // formula episode: build the whole script on a COPY (Part A from the test + the selected ending); nothing is saved
        const st = SF.normalizeStory(res.json, charIds(ep0));
        const copy = JSON.parse(JSON.stringify(ep0));
        SF.replacePartA(copy, st.beats);
        Object.keys(st.vars).forEach((k) => { if (!(copy.ending.manualVars || []).includes(k)) copy.ending.vars[k] = st.vars[k]; });
        SF.applyEnding(copy, endings, { respectEdits: true });
        if (st.cta && st.cta.lines.length) copy.cta = Object.assign({}, copy.cta, st.cta);
        copy.publishing = Object.assign({}, copy.publishing, { keyword: copy.cta.keyword });
        rec.draft = { title: st.title || copy.title, scenes: copy.scenes, lines: copy.lines, cta: copy.cta, beats: copy.comedy_story, ending: copy.product_ending, formula: true };
        rec.validation = validateScript(copy, lib());
      } else {
      const s = normalize(res.json, ep0);
      const probe = Object.assign({}, ep0, { title: s.title || ep0.title, beats: s.beats, scenes: s.scenes, lines: s.lines, cta: s.cta, publishing: Object.assign({}, ep0.publishing, { keyword: s.cta.keyword }), scriptSource: { titleKo: true } });
      rec.draft = s;
      rec.validation = validateScript(probe, lib());
      }
    } catch (e) {
      rec.error = { code: e.code || 'ERROR', message: e.message, details: e.details || [] };
      rec.rawJson = JSON.stringify(res.json || null).slice(0, 20000);
    }
    store.episodes.saveFile(epId, path.join('prompt-tests', rec.id + '.json'), Buffer.from(JSON.stringify(rec, null, 1)));
    store.episodes.audit(epId, 'script.prompt_tested', { testId: rec.id, presetId: meta.presetId, presetVersion: meta.presetVersion, comedyLevel: meta.comedyLevel, ok: !rec.error });
    return rec;
  }
  function listTests(epId) {
    const dir = testsDir(epId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } }).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  return { createEpisodeFromConcept, generate, regenerate, selectEnding, fitEstimate, fitDialogue, conceptStatus, buildPrompt, episodeIdFor, selectPreset, effectivePrompt, testPrompt, listTests };
}

module.exports = { createScriptGen };
