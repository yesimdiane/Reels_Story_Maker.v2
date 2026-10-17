// Scene video-prompt generation.
//   template : free, deterministic (prompts.js). Never calls an API.
//   gemini   : multimodal. Sends the APPROVED character reference sheets (real image bytes, inlineData) of the
//              characters selected in each scene, plus the approved script/storyboard, and asks for the creative
//              sections only (camera, actions, environment, lighting, continuity, negative additions).
//              Code then assembles the final prompt: house style, exact cast count, identity, verified product block,
//              duration/format and the mandatory character-sheet rule are added by CODE, never trusted to the model.
// A Gemini call is billable (price not known to the Studio), so it needs an explicit operator click (confirmAi).
// Nothing is saved if validation fails; edited prompts are never overwritten unless force is set.
'use strict';
const sceneLook = require('./scenelook');
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256, uid } = require('./util');
const { describe: describeResponse } = require('./aidiag');
const { isScriptApproved } = require('./episode');
const { buildScenePromptParts, buildNegativePrompt, lintPrompt } = require('./prompts');
const { lintCast, SHEET_RULE } = require('./charrules');
const { clipSecFor, modelById } = require('./budget');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SECTION_KEYS = ['camera', 'actions', 'environment', 'lighting', 'continuity'];

/** Distinct, accurate failure categories (the user is told what actually went wrong — a missing field is not a rule violation). */
const CATEGORY_OF_RULE = { UNSELECTED_CHARACTER: 'AI_CAST_VIOLATION', DUPLICATE_CHARACTER: 'AI_CAST_VIOLATION', PRODUCT_CLAIM: 'AI_PRODUCT_CLAIM_VIOLATION', SHEET_IN_SCENE: 'AI_REFERENCE_SHEET_VIOLATION' };
const FORMAT_CATEGORIES = new Set(['AI_RESPONSE_INCOMPLETE', 'AI_RESPONSE_MALFORMED', 'AI_SCENE_ID_MISMATCH']);
const RECOVERY = {
  AI_RESPONSE_INCOMPLETE: 'Gemini 응답에 필요한 항목이 빠져 있습니다 (규칙 위반이 아니라 응답 형식 문제입니다). 다시 만들거나 "템플릿으로 만들기"(무료)를 사용하세요. 자동으로 다시 시도하지 않으며 기존 프롬프트는 그대로입니다.',
  AI_RESPONSE_MALFORMED: 'Gemini 응답을 해석할 수 없습니다 (잘렸거나 JSON 형식이 아님). 장면 수를 줄여 다시 만들거나 "템플릿으로 만들기"(무료)를 사용하세요. 자동으로 다시 시도하지 않으며 기존 프롬프트는 그대로입니다.',
  AI_SCENE_ID_MISMATCH: 'Gemini가 요청하지 않은 장면 ID를 돌려주었거나 요청한 장면 ID가 없습니다. 다시 만들거나 "템플릿으로 만들기"(무료)를 사용하세요. 기존 프롬프트는 그대로입니다.',
  AI_CAST_VIOLATION: 'AI가 만든 프롬프트가 장면의 출연 캐릭터 규칙을 어겼습니다 (선택되지 않은 캐릭터 등장 또는 같은 캐릭터 중복). 저장하지 않았고 기존 프롬프트는 그대로입니다.',
  AI_PRODUCT_CLAIM_VIOLATION: 'AI가 만든 프롬프트에 확인되지 않은 제품 주장이 있습니다. 저장하지 않았고 기존 프롬프트는 그대로입니다.',
  AI_REFERENCE_SHEET_VIOLATION: 'AI가 만든 프롬프트가 캐릭터 시트·콜라주·표정 그리드를 장면에 그리라고 지시합니다. 저장하지 않았고 기존 프롬프트는 그대로입니다.',
};

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_id: { type: 'STRING' },
          camera: { type: 'STRING' },
          actions: { type: 'STRING' },
          environment: { type: 'STRING' },
          lighting: { type: 'STRING' },
          continuity: { type: 'STRING' },
          negative_additions: { type: 'STRING' },
        },
        required: ['scene_id', 'camera', 'actions', 'environment', 'lighting', 'continuity'],
      },
    },
  },
  required: ['scenes'],
};

function geminiInstruction(ep, scenes, lib, clipSecOf) {
  const sceneBlocks = scenes.map((s) => {
    const lines = (ep.lines || []).filter((l) => l.sceneId === s.id);
    return [
      `SCENE ${s.id} — ${s.title_ko || s.title} (${s.durationSec}s planned, clip ${clipSecOf(s)}s)`,
      `Scene description (approved): ${s.visual}`,
      `Characters selected in the editor: ${(s.characters || []).length ? s.characters.map((c) => (lib.characters.find((x) => x.id === c) || { name: c }).name).join(' + ') : 'NONE'}`,
      `Product visible: ${s.showsProduct ? 'YES' : 'NO'}`,
      ...sceneLook.promptLines(s, lib),
      lines.length ? 'Approved dialogue in this scene (for acting/expressions only): ' + lines.map((l) => `${l.speaker}: "${l.en}"`).join(' / ') : 'No dialogue.',
    ].join('\n');
  }).join('\n\n');
  return [
    'You write image-to-video prompts for a hand-drawn 2D Korean webtoon / anime Instagram Reel (vertical 9:16). Output JSON only.',
    'For each scene return English text for: camera (movement and framing: e.g. quick punch-in zoom, whip-pan, slow push-in), actions (a vivid SECOND-BY-SECOND timeline of what each selected character does — \"0.0–1.2 s: …  1.2–2.5 s: …\" back to back until the clip length — body and facial animation with exaggerated cartoon motion such as squash-and-stretch, comic pops, widening eyes, eyebrows shooting up, with a clear start and end, never a one-line summary; if the approved scene description already has a timeline keep its timing), environment, lighting (light + visual style), continuity (what must match the previous scene), negative_additions (extra things to avoid, optional).',
    '',
    'CHARACTER REFERENCE SHEETS — CRITICAL:',
    '- The attached images are master character SHEETS. Each sheet shows ONE individual many times (portraits, expressions, outfits, close-ups, colour palette, poses, example scenes). They are identity guides, NOT scene layouts.',
    '- NEVER interpret multiple drawings on a sheet as several people. NEVER describe a sheet, collage, grid, turnaround, labels, flags, colour swatches or speech bubbles as part of the scene.',
    '- Do not mix outfits/poses/expressions from the sheet. Choose outfit, pose, expression and setting from the approved scene description only.',
    '- Include ONLY the characters selected for that scene: exactly one Diane and/or exactly one Jack; two people if both are selected; none if none are selected. Never mention an unselected character as present.',
    '- Do not invent product features. Only the product facts given below may be shown, and only when "Product visible" is YES.',
    '- Do not add on-screen text, subtitles, logos or speech bubbles.',
    '',
    'PRODUCT (verified): ' + (ep.product.visualSummary || (ep.product.verifiedFeatures || []).join('; ')),
    'Forbidden product claims: ' + ((ep.product.forbiddenClaims || []).join(', ') || 'none'),
    '',
    'APPROVED STORYBOARD:',
    sceneBlocks,
  ].join('\n');
}

function createPromptService({ store, diagnostics = null, cfg, geminiFactory = null, clientFactory = null, available = null, composeExtra = null, log = () => {} }) {
  const lib = () => store.characters.load();

  function usesSheetFor(scene, L) {
    return (scene.characters || []).some((id) => {
      const c = L.characters.find((x) => x.id === id);
      return c && c.references.some((r) => r.approved && r.isSheet !== false);
    });
  }

  function status() {
    return { template: true, gemini: { available: !!geminiFactory || (available ? !!available() : !!cfg.geminiApiKey), model: cfg.geminiModel, billable: true } };
  }

  function collectImages(ep, scenes, L) {
    const used = new Map(); // key → {label, mimeType, data, sha}
    const missing = [];
    scenes.forEach((s) => (s.characters || []).forEach((cid) => {
      const c = L.characters.find((x) => x.id === cid);
      const ref = c && c.references.find((r) => r.approved);
      if (!ref) return missing.push(`${s.id}: ${c ? c.name : cid}`);
      if (used.has(ref.id)) return;
      const file = store.characters.refPath(cid, ref);
      const buf = fs.readFileSync(file);
      used.set(ref.id, { label: `Character sheet for ${c.name} (ONE person, identity reference only):`, mimeType: MIME[path.extname(file).toLowerCase()] || 'image/png', data: buf.toString('base64'), sha: ref.sha256 });
    }));
    return { images: Array.from(used.values()), missing };
  }

  function compose(ep, scene, L, clipSec, over, negExtra, idx) {
    const prev = idx > 0 ? ep.scenes[idx - 1] : null;
    const parts = buildScenePromptParts(ep, scene, L, clipSec, { prev, usesSheet: usesSheetFor(scene, L), sections: over });
    const negBase = buildNegativePrompt(ep, scene, L);
    const sheetNeg = (scene.characters || []).length ? ', character sheet, reference sheet, collage, expression grid, turnaround, text labels, flags, color swatches, speech bubbles, duplicate characters, twins, extra people' : ', Diane, Jack, any human characters';
    return { video: parts.text, negative: negBase + sheetNeg + (negExtra ? ', ' + String(negExtra).replace(/^[,\s]+|[,\s]+$/g, '') : ''), sections: parts.sections };
  }

  /**
   * options: { sceneIds, mode: 'template'|'gemini', confirmAi, force }
   * Returns the list of {sceneId, source}; throws (saving nothing) when the AI output breaks a rule.
   */
  async function generate(epId, { sceneIds, mode = 'template', confirmAi = false, force = false, by = 'operator' } = {}) {
    const correlationId = uid('pg');
    const ep0 = store.episodes.get(epId);
    if (!isScriptApproved(ep0)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인된 뒤에 프롬프트를 만들 수 있습니다.', { recovery: '대본 스튜디오에서 대본을 승인하세요.', status: 409 });
    const L = lib();
    const settings = store.settings.get();
    const model = modelById(store.models(), settings.defaultModelId);
    const scenes = ep0.scenes.filter((s) => !sceneIds || !sceneIds.length || sceneIds.includes(s.id));
    if (!scenes.length) throw new StudioError('NO_SCENES', '대상 장면이 없습니다.');
    const clipSecOf = (s) => clipSecFor(model, s.durationSec);
    const todo = scenes.filter((s) => force || !(ep0.prompts[s.id] && ep0.prompts[s.id].edited));
    const skipped = scenes.filter((s) => !todo.includes(s)).map((s) => s.id);
    let ai = null;
    let aiMeta = null;
    let extra = null;
    let rawOut = null;
    let unexpected = [];
    const problems = [];
    const diag = (p, extraInfo = {}) => { if (diagnostics) diagnostics.record(Object.assign({ kind: 'prompt_generation', correlationId, epId, model: (aiMeta && aiMeta.model) || cfg.geminiModel, provider: (aiMeta && aiMeta.provider) || 'gemini', sceneId: p.sceneId, category: p.code, rule: p.rule || p.code, reason: p.message, missingFields: p.missingFields, responseShape: describeResponse(rawOut, SECTION_KEYS) }, extraInfo)); };
    if (mode === 'gemini') {
      if (!confirmAi) throw new StudioError('CONFIRM_REQUIRED', 'Gemini 호출은 유료일 수 있습니다. 확인 후 다시 실행하세요.', { recovery: '"AI로 만들기"에서 비용 안내를 확인하고 승인하세요.', status: 409 });
      if (!todo.length) throw new StudioError('NOTHING_TO_DO', '수정한 프롬프트만 있어 AI가 만들 장면이 없습니다.', { recovery: '덮어쓰기를 선택하거나 장면을 지정하세요.' });
      const { images, missing } = collectImages(ep0, todo, L);
      if (missing.length) throw new StudioError('NO_APPROVED_REFERENCE', '승인된 캐릭터 참조 이미지가 없는 장면이 있습니다: ' + missing.join(', '), { recovery: '설정 → 캐릭터 라이브러리에서 참조 이미지를 올리고 승인하세요. (참조 없이 AI가 캐릭터를 추측하게 하지 않습니다.)', status: 409 });
      const client = geminiFactory ? geminiFactory() : clientFactory ? clientFactory() : require('../../renderer/lib/gemini').createGeminiClient({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel });
      extra = composeExtra ? composeExtra() : null;
      let out;
      try {
        out = await client.generateJson({ prompt: geminiInstruction(ep0, todo, L, clipSecOf) + (extra && extra.text ? '\n\nOPERATOR PROMPT (editable in Settings → Prompt Manager; the CHARACTER SHEET and PRODUCT rules above always win):\n' + extra.text : ''), images, schema: SCHEMA });
      } catch (e) {
        const msg = String(e.message || e).replace(cfg.geminiApiKey || '\u0000', '[redacted]').slice(0, 400);
        if (e && e.kind === 'malformed') {
          const p = { code: 'AI_RESPONSE_MALFORMED', rule: 'parse', message: `Gemini 응답을 해석할 수 없습니다${e.truncated ? ' (출력 한도에서 잘림: MAX_TOKENS)' : ''}: ${msg}` };
          diag(p, { sceneId: todo.map((x) => x.id).join(',') , finishReason: e.finishReason });
          throw new StudioError('AI_RESPONSE_MALFORMED', `${p.message} (요청 ID ${correlationId})`, { details: [Object.assign({}, p, { correlationId })], recovery: RECOVERY.AI_RESPONSE_MALFORMED, status: 422, correlationId });
        }
        diag({ code: 'GEMINI_FAILED', rule: e && e.kind || 'request', message: msg }, { sceneId: todo.map((x) => x.id).join(',') });
        throw new StudioError('GEMINI_FAILED', msg, { recovery: 'Gemini API 키/모델을 확인하거나 "템플릿으로 만들기"(무료)를 사용하세요. 기존 프롬프트는 그대로이며 자동으로 다시 시도하지 않습니다.', status: 502, correlationId });
      }
      rawOut = out;
      aiMeta = { model: client.model || cfg.geminiModel, provider: client.provider || 'gemini' };
      // structure first: is this a scenes response at all, and do its scene ids line up with what was asked?
      if (!out || typeof out !== 'object' || !Array.isArray(out.scenes)) {
        const p = { code: 'AI_RESPONSE_MALFORMED', rule: 'structure', message: 'Gemini 응답에 scenes 배열이 없습니다.' };
        diag(p, { sceneId: todo.map((x) => x.id).join(',') });
        throw new StudioError('AI_RESPONSE_MALFORMED', `${p.message} (요청 ID ${correlationId})`, { details: [Object.assign({}, p, { correlationId })], recovery: RECOVERY.AI_RESPONSE_MALFORMED, status: 422, correlationId });
      }
      const norm = (id) => String(id == null ? '' : id).trim().toUpperCase();
      ai = new Map();
      out.scenes.forEach((x) => { const k = norm(x && x.scene_id); if (k && !ai.has(k)) ai.set(k, x); });
      const asked = new Set(todo.map((x) => norm(x.id)));
      unexpected = [...ai.keys()].filter((k) => !asked.has(k));
      aiMeta = { model: client.model || cfg.geminiModel, provider: client.provider || 'gemini', promptVersions: extra ? extra.versions : undefined, imageShas: images.map((i) => i.sha), at: nowIso() };
    }
    const results = [];
    const staged = {};
    todo.forEach((s) => {
      const idx = ep0.scenes.findIndex((x) => x.id === s.id);
      let over = null;
      let neg = '';
      let source = 'template';
      if (ai) {
        const g = ai.get(String(s.id).trim().toUpperCase());
        if (!g) {
          const p = unexpected.length
            ? { sceneId: s.id, code: 'AI_SCENE_ID_MISMATCH', rule: 'scene_id', message: `${s.id}: Gemini가 이 장면 ID를 돌려주지 않았고 요청하지 않은 ID(${unexpected.slice(0, 5).join(', ')})를 돌려주었습니다.` }
            : { sceneId: s.id, code: 'AI_RESPONSE_INCOMPLETE', rule: 'scene_missing', message: `${s.id}: Gemini 응답에 이 장면이 없습니다 (응답에는 ${ai.size}개 장면만 있음).` };
          problems.push(p); diag(p); return;
        }
        const bad0 = SECTION_KEYS.filter((k) => g[k] != null && typeof g[k] !== 'string');
        if (bad0.length) { const p = { sceneId: s.id, code: 'AI_RESPONSE_MALFORMED', rule: 'field_type', message: `${s.id}: 항목 형식이 올바르지 않습니다 (문자열이 아님): ${bad0.join(', ')}`, missingFields: bad0 }; problems.push(p); diag(p); return; }
        const missingFields = SECTION_KEYS.filter((k) => !String(g[k] || '').trim());
        if (missingFields.length) {
          const p = { sceneId: s.id, code: 'AI_RESPONSE_INCOMPLETE', rule: 'required_fields', message: `${s.id}: Gemini 응답에 다음 항목이 비어 있거나 없습니다: ${missingFields.join(', ')}`, missingFields };
          problems.push(p); diag(p, { excerpt: Object.fromEntries(SECTION_KEYS.filter((k) => !missingFields.includes(k)).map((k) => [k, g[k]])) });
          return;
        }
        over = Object.fromEntries(SECTION_KEYS.map((k) => [k, String(g[k]).trim()]));
        neg = g.negative_additions || '';
        source = 'gemini';
      }
      const c = compose(ep0, s, L, clipSecOf(s), over, neg, idx);
      if (source === 'gemini') {
        const body = SECTION_KEYS.map((k) => over[k]).join('\n');
        const found = lintPrompt(body + '\n' + neg, ep0).map((w) => ({ code: 'PRODUCT_CLAIM', message: `확인되지 않은 제품 주장 "${w}"` })).concat(lintCast(body, s, L, { negative: neg }));
        found.forEach((b) => { const p = { sceneId: s.id, code: CATEGORY_OF_RULE[b.code] || 'AI_OUTPUT_REJECTED', rule: b.code, message: `${s.id}: ${b.message}` }; problems.push(p); diag(p, { excerpt: { rule: b.code } }); });
      }
      staged[s.id] = { video: c.video, negative: c.negative, sections: c.sections, source, edited: false, builtAt: nowIso(), ai: source === 'gemini' ? aiMeta : undefined, castIds: (s.characters || []).slice(), usedSheetRule: c.video.includes(SHEET_RULE) };
      results.push({ sceneId: s.id, source });
    });
    if (problems.length) {
      const first = problems[0];
      const cats = [...new Set(problems.map((x) => x.code))];
      throw new StudioError(first.code, `${problems.map((x) => x.message).join(' / ')} (요청 ID ${correlationId})`, { details: problems.map((x) => Object.assign({ correlationId }, x)), recovery: cats.map((c) => RECOVERY[c] || '').filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' '), status: 422, correlationId });
    }
    await store.episodes.update(epId, (ep) => {
      Object.keys(staged).forEach((id) => {
        const cur = ep.prompts[id];
        const hist = (cur && cur.history ? cur.history : []).slice(-4);
        if (cur && cur.video) hist.push({ video: cur.video, negative: cur.negative, source: cur.source || 'template', edited: !!cur.edited, at: cur.editedAt || cur.builtAt });
        ep.prompts[id] = Object.assign({}, staged[id], { history: hist });
      });
    });
    store.episodes.audit(epId, 'storyboard.prompts_generated', { mode, scenes: results.map((r) => r.sceneId), skippedEdited: skipped, by });
    return { results, skippedEdited: skipped };
  }

  return { generate, status, usesSheetFor };
}

module.exports = { createPromptService, geminiInstruction, SCHEMA, CATEGORY_OF_RULE, FORMAT_CATEGORIES };
