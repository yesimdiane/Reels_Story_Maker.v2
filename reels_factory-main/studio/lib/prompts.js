// Scene prompt builder. Deterministic (no LLM, no API call): house style + character blocks + the scene action +
// the verified product summary. The operator can edit every prompt; edited prompts are never overwritten
// unless the operator asks to rebuild them.
'use strict';
const { SHEET_RULE, castDirective, identityLines } = require('./charrules');
const { claimsIn } = require('./claims');

function productBlock(ep) {
  const p = ep.product || {};
  const summary = p.visualSummary || (p.verifiedFeatures || []).join('; ');
  return `The product is: ${summary} Show only these verified features — do not add features, mechanisms or claims that are not listed.`;
}

/** Cinematic defaults per story beat (code-built, free). */
const CAMERA = ['Slow push-in, eye level', 'Gentle handheld follow, medium shot', 'Static medium-wide shot with a slight drift', 'Quick reaction close-up, then pull back'];

/**
 * Structured scene prompt (positive part). Returns { text, sections, usesSheet }.
 * sections: camera, actions, environment, lighting, continuity, duration, aspect, cast, identity, product.
 */
/** Product appearance chosen for the scene (structured fields; only used when 제품 등장 is ON). */
function placementLine(scene) {
  const pl = scene.productPlacement;
  if (!pl) return '';
  const bits = [pl.position && 'position: ' + pl.position, pl.scale && 'scale: ' + pl.scale, pl.orientation && 'orientation: ' + pl.orientation, pl.visibility && 'visibility: ' + pl.visibility, pl.interaction && 'character interaction: ' + pl.interaction].filter(Boolean);
  return bits.length ? '\nPRODUCT PLACEMENT FOR THIS SCENE (keep the verified product appearance): ' + bits.join('; ') + '.' : '';
}

function buildScenePromptParts(ep, scene, lib, clipSec, { usesSheet = true, prev = null, sections: over = null } = {}) {
  const style = lib.style;
  const ids = scene.characters || [];
  const lines = (ep.lines || []).filter((l) => l.sceneId === scene.id);
  const sections = Object.assign({
    camera: CAMERA[(Number(scene.beat) || 1) % CAMERA.length] + '. Smooth cinematic camera movement.',
    actions: scene.visual + (lines.length ? ' Dialogue beats (acting only, no on-screen text): ' + lines.map((l) => `${l.speaker}: "${l.en}"`).join(' / ') : ''),
    environment: 'Hand-drawn Korean apartment, entryway and home details appropriate to the scene description.',
    lighting: 'Soft natural light, warm muted beige and earthy colour palette, hand-drawn 2D Korean webtoon / anime look (not 3D, not Pixar).',
    continuity: prev ? `Continue directly from scene ${prev.id} (${prev.title}): same home, same outfits, same time of day, same character proportions.` : 'Establish the home, outfits and time of day that later scenes must keep.',
    duration: clipSec ? `${clipSec} seconds` : `${scene.durationSec} seconds`,
    aspect: 'Vertical 9:16',
  }, over || {});
  const cast = castDirective(ids, lib);
  const identity = identityLines(ids, lib);
  const parts = [
    style.promptBlock,
    `Scene ${scene.id} — ${scene.title}. ${scene.visual}`,
    cast,
  ];
  if (identity.length) parts.push('IDENTITY (keep exactly on-model): ' + identity.join(' '));
  if (scene.showsProduct) parts.push(productBlock(ep) + placementLine(scene));
  parts.push(`CAMERA: ${sections.camera}`, `CHARACTER ACTIONS: ${sections.actions}`, `ENVIRONMENT: ${sections.environment}`, `LIGHTING & STYLE: ${sections.lighting}`, `CONTINUITY: ${sections.continuity}`,
    `DURATION & FORMAT: ${sections.duration}, ${sections.aspect}. No on-screen text, subtitles, labels, speech bubbles or logos.`);
  if (ids.length && usesSheet) parts.push(SHEET_RULE);
  return { text: parts.join('\n'), sections: Object.assign({}, sections, { cast, identity: identity.join(' '), product: scene.showsProduct ? productBlock(ep) : '' }), usesSheet: !!(ids.length && usesSheet) };
}

function buildVideoPrompt(ep, scene, lib, clipSec, opts) {
  const idx = (ep.scenes || []).findIndex((s) => s.id === scene.id);
  const prev = idx > 0 ? ep.scenes[idx - 1] : null;
  return buildScenePromptParts(ep, scene, lib, clipSec, Object.assign({ prev }, opts || {})).text;
}

function buildNegativePrompt(ep, scene, lib) {
  const extra = scene.showsProduct ? ', screws, drill, suction cup, extra product parts, invented product features' : '';
  return lib.style.negativePrompt + extra;
}

/** Returns the unverified-claim words found in text (case-insensitive). */
function lintPrompt(text, ep) {
  return claimsIn(text, (ep.product && ep.product.forbiddenClaims) || []);
}

module.exports = { buildScenePromptParts, buildVideoPrompt, buildNegativePrompt, lintPrompt, productBlock };
