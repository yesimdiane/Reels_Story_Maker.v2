// Animation planning for the storyboard: automatic scene-specific beats, per-scene regeneration (free rules or low-cost text AI),
// and compilation of the beats into the video-generation prompt.
//   * rules draft = free (animdraft.js). AI planning = the existing text pipeline ('storyboardPrompts' route): estimate first, explicit
//     confirmation, spend limits, never retried automatically, rejected output never overwrites anything.
//   * manually edited beats (source 'manual') are kept unless the caller passes replace:true
//   * the beats are INSTRUCTIONS to a provider that animates an approved start frame — they are not keyframes and cannot animate an
//     image by themselves. See capabilities().
'use strict';
const { StudioError } = require('./util');
const { isScriptApproved } = require('./episode');
const { isGeneric } = require('./animdraft');

function createAnimPlan({ store, router, sba, charRefs, lib }) {
  const sceneOf = (ep, sid) => {
    const s = (ep.scenes || []).find((x) => x.id === sid);
    if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sid, { status: 404 });
    return s;
  };

  /** Honest split between what each renderer can do. */
  function capabilities(providerMode) {
    return {
      providerAnimation: { available: providerMode === 'live', label: '제공자 생성 캐릭터 애니메이션 (이미지→영상 모델)', note: providerMode === 'live' ? '승인된 시작 프레임과 이 프롬프트를 영상 모델이 받아 움직임을 만듭니다. 비트는 지시문이며 정확한 키프레임이 아닙니다.' : 'MOCK 모드: 실제 캐릭터 애니메이션은 만들어지지 않고 확인용 샘플 클립만 만들어집니다.' },
      localEffects: { available: true, label: '로컬(FFmpeg) 편집 효과', note: '크롭·컷·B-roll 얹기·자막·음성·팬/줌만 가능합니다. 캐릭터를 움직이는 AI 애니메이션은 로컬 렌더러에 없습니다.' },
    };
  }

  function quality(ep, sc) {
    const m = ep.motion && ep.motion[sc.id];
    const beats = (m && m.beats) || [];
    const generic = beats.filter(isGeneric).length;
    return { beats: beats.length, generic, ok: beats.length > 0 && generic === 0, source: m ? m.source : null };
  }

  function replaceCheck(ep, sid, replace) {
    const cur = ep.motion && ep.motion[sid];
    if (cur && cur.source === 'manual' && !replace) throw new StudioError('MOTION_MANUAL_EXISTS', `${sid}: 직접 수정한 애니메이션 비트가 있습니다. 덮어쓰려면 교체를 확인하세요 (이전 버전은 기록에 남습니다).`, { status: 409, recovery: '"교체" 확인 후 다시 실행하세요.' });
  }

  /** Free rules-based generation for one scene. */
  async function generateRules(epId, sid, { replace = false, by = 'operator', source = 'auto' } = {}) {
    const ep = store.episodes.get(epId);
    const sc = sceneOf(ep, sid);
    replaceCheck(ep, sid, replace);
    return sba.saveMotion(epId, sid, { beats: sba.draftBeats(ep, sc), source }, by);
  }

  /** Free: scenes of an approved script that have no animation yet get a scene-specific draft (never touches existing beats). */
  async function autoFill(epId, by = 'operator') {
    const ep = store.episodes.get(epId);
    const made = [];
    for (const sc of ep.scenes || []) {
      if (ep.motion && ep.motion[sc.id]) continue;
      try { await generateRules(epId, sc.id, { by, source: 'auto' }); made.push(sc.id); } catch (_) { /* a scene whose draft fails validation stays empty; readiness reports it */ }
    }
    return made;
  }

  // ---------------------------------------------------------------- AI planning (existing low-cost text route)
  function aiPrompt(ep, sc) {
    const L = lib();
    const i = ep.scenes.findIndex((x) => x.id === sc.id);
    const brief = (s) => (s ? `${s.id} (${s.durationSec}s): ${String(s.visual || '').slice(0, 160)}` : 'none');
    const lines = (ep.lines || []).filter((l) => l.sceneId === sc.id).map((l) => `${l.speaker}: "${l.en}"`);
    const cast = (sc.characters || []).map((cid) => { const c = L.characters.find((x) => x.id === cid); return `- ${cid} = ${c ? c.name : cid}${c && c.look ? ': ' + c.look : ''}`; });
    return [
      'ANIMATION_BEATS',
      'Plan the character animation of ONE scene as beats on a 0.5-second grid. Use ONLY the approved script information below.',
      `SCENE ${sc.id} duration: ${sc.durationSec}s. Beats must stay inside 0–${sc.durationSec}s, start before they end, and every time is a multiple of 0.5.`,
      'VISUAL_DIRECTION: ' + String(sc.visual || ''),
      'ACTION: ' + String(sc.action || ''),
      'DIALOGUE: ' + (lines.join(' | ') || '(silent)'),
      'PREVIOUS_SCENE: ' + brief(ep.scenes[i - 1]), 'NEXT_SCENE: ' + brief(ep.scenes[i + 1]),
      'CAST (use these ids):', ...cast,
      charRefs.textNote(ep, sc.characters),
      'RULES: Every beat names a characterId from the cast and gives a SPECIFIC emotion, body action, gaze, facial expression and (when useful) camera instruction. Never use placeholders such as "neutral", "holds the opening pose", "looks at the camera", "settled" or "static". A deliberate pause is allowed but must say what the character does (e.g. "holds the smug pose while the line lands"). Beats of the same character must not overlap; different characters may overlap. Cover the whole scene.',
      'OUTPUT: ONLY valid JSON: {"beats":[{"characterId":"jack","t0":0,"t1":0.5,"emotion":"…","body":"…","gaze":"…","expression":"…","camera":"…"}]}',
    ].filter(Boolean).join('\n');
  }
  function estimateAi(epId, sid) {
    const ep = store.episodes.get(epId);
    const sc = sceneOf(ep, sid);
    return Object.assign({ sceneId: sid }, router.estimate('storyboardPrompts', { inputChars: aiPrompt(ep, sc).length, outputTokens: 1500 }));
  }
  async function generateAi(epId, sid, { replace = false, confirm, by = 'operator' } = {}) {
    const ep = store.episodes.get(epId);
    const sc = sceneOf(ep, sid);
    if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인되기 전에는 AI 애니메이션 계획을 만들 수 없습니다.', { status: 409, recovery: 'Script Studio에서 대본을 승인하세요.' });
    replaceCheck(ep, sid, replace);
    const res = await router.run('storyboardPrompts', { prompt: aiPrompt(ep, sc), json: true, maxTokens: 2500, confirm, dedupeKey: `${epId}:${sid}:anim` });
    if (res.mock) return generateRules(epId, sid, { replace, by, source: 'auto' }); // no real model configured: the free rules draft, labelled as such
    const raw = res.json && (res.json.beats || res.json);
    const { beats, problems } = sba.cleanBeats(Array.isArray(raw) ? raw : [], sc);
    const generic = beats.filter(isGeneric).length;
    if (!beats.length || problems.length || generic) throw new StudioError('ANIMATION_REJECTED', problems.length ? problems[0].message : generic ? `AI가 일반적인 자리표시 문구(${generic}개 비트)를 돌려주어 저장하지 않았습니다.` : 'AI가 비트를 돌려주지 않았습니다.', { status: 422, details: problems, recovery: '기존 애니메이션은 그대로입니다. 규칙 기반 초안을 쓰거나 직접 수정하세요 (자동으로 다시 시도하지 않습니다).' });
    return sba.saveMotion(epId, sid, { beats: raw, source: 'ai' }, by);
  }

  // ---------------------------------------------------------------- video prompt compilation
  /** What the video model receives: the approved prompt + start frame/reference rules + the beat timeline + continuity. Unchanged when a scene has no beats. */
  const SILENT_RULE = 'SILENT ANIMATION: no speech and no sound. Mouths stay closed or relaxed — no talking or lip-movement; express emotion with eyes, brows, head and body. Dialogue and lip sync are added in later steps.';
  function compose(ep, sid, videoText) {
    const base = String(videoText || '');
    const m = ep.motion && ep.motion[sid];
    if (!m || !m.beats || !m.beats.length) return [base.trim(), SILENT_RULE].filter(Boolean).join('\n\n');
    const sc = (ep.scenes || []).find((x) => x.id === sid);
    const i = (ep.scenes || []).findIndex((x) => x.id === sid);
    const refs = sc ? charRefs.forScene(ep, sc).filter((r) => r.status === 'approved') : [];
    const lastBeat = (s) => { const mm = s && ep.motion && ep.motion[s.id]; const b = mm && mm.beats[mm.beats.length - 1]; return b ? `${b.character} ${b.body}`.slice(0, 120) : ''; };
    const prev = ep.scenes[i - 1]; const next = ep.scenes[i + 1];
    return [
      base.trim(),
      'START FRAME: the approved image of this scene is the first frame. Keep its composition, the characters\' design, clothing and the product exactly as shown, and animate from it.',
      refs.length ? 'CHARACTER REFERENCES (identity must not change): ' + refs.map((r) => `${r.name} (${r.assetId})`).join(', ') + '.' : '',
      sba.timelineText(m.beats),
      SILENT_RULE,
      'CONTINUITY: ' + [prev ? `continues from ${prev.id}${lastBeat(prev) ? ` (${lastBeat(prev)})` : ''}` : 'opening scene', next ? `leads into ${next.id}` : 'closing scene', 'same art style, lighting and character proportions throughout'].join('; ') + '.',
    ].filter(Boolean).join('\n\n');
  }

  return { capabilities, quality, generateRules, generateAi, estimateAi, autoFill, compose, aiPrompt };
}

module.exports = { createAnimPlan };
