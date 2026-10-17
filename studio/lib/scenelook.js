// Scene look & performance planning that Script Studio edits and Storyboard reads (same fields on ep.scenes[], no second record):
//   look          { background, lighting, atmosphere, style }  environment of the scene
//   pose          { body, pose }                               body positioning / pose (physical action stays in `action`, emotional intent in `emotion`)
//   referenceOnly [characterId]                                characters supplied for appearance CONTINUITY only; they are never depicted
// `characters` (existing) = the VISIBLE characters. Everything is optional and absent on old episodes (no migration needed; approvals only
// change when one of these fields actually has content).
'use strict';

const LOOK_KEYS = ['background', 'lighting', 'atmosphere', 'style'];
const POSE_KEYS = ['body', 'pose'];
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

function cleanLook(raw, prev) {
  const base = Object.assign({}, prev || {});
  if (raw && typeof raw === 'object') LOOK_KEYS.forEach((k) => { if (raw[k] !== undefined) base[k] = clip(raw[k], 400); });
  const out = {};
  LOOK_KEYS.forEach((k) => { if (base[k]) out[k] = base[k]; });
  return Object.keys(out).length ? out : undefined;
}
function cleanPose(raw, prev) {
  const base = Object.assign({}, prev || {});
  if (raw && typeof raw === 'object') POSE_KEYS.forEach((k) => { if (raw[k] !== undefined) base[k] = clip(raw[k], 400); });
  const out = {};
  POSE_KEYS.forEach((k) => { if (base[k]) out[k] = base[k]; });
  return Object.keys(out).length ? out : undefined;
}
/** reference-only characters: known ids, de-duplicated, never also visible */
function cleanReferenceOnly(raw, visible, prev) {
  const src = Array.isArray(raw) ? raw : prev || [];
  const vis = new Set((visible || []).map(String));
  const out = [...new Set(src.map(String))].filter((id) => id && !vis.has(id));
  return out.length ? out : undefined;
}

const ELEMENT_TYPES = ['body', 'emotion', 'camera', 'eyes', 'eyebrows', 'mouth', 'face'];
/** structured performance notes (add / delete / duplicate / reorder, optional timing + character). `action` and `emotion` stay in sync as derived text so every older reader keeps working. */
function cleanElements(raw, prev, durationSec) {
  if (raw === undefined) return prev;
  if (!Array.isArray(raw)) return prev;
  const seen = new Set();
  const dur = Number(durationSec) || 0;
  const out = raw.slice(0, 60).map((e, i) => {
    let id = String((e && e.id) || '').trim() || 'E' + (i + 1);
    while (seen.has(id)) id += '_';
    seen.add(id);
    const type = ELEMENT_TYPES.includes(e && e.type) ? e.type : 'body';
    const el = { id, type, text: clip(e && e.text, 300) };
    if (e && e.characterId) el.characterId = String(e.characterId).slice(0, 60);
    const t0 = e && e.t0 !== '' && e.t0 != null ? Number(e.t0) : null;
    const t1 = e && e.t1 !== '' && e.t1 != null ? Number(e.t1) : null;
    if (t0 != null && Number.isFinite(t0) && t0 >= 0 && (!dur || t0 <= dur)) el.t0 = Math.round(t0 * 10) / 10;
    if (t1 != null && Number.isFinite(t1) && el.t0 != null && t1 > el.t0 && (!dur || t1 <= dur + 1e-6)) el.t1 = Math.round(t1 * 10) / 10;
    return el;
  }).filter((e) => e.text);
  return out;
}
/** derived legacy text; undefined when there are no elements (the stored text is then left alone) */
function deriveText(elements) {
  if (!elements || !elements.length) return undefined;
  const join = (types) => elements.filter((e) => types.includes(e.type)).map((e) => e.text).join('. ').slice(0, 1500);
  return { action: join(['body']), emotion: join(['emotion', 'face']).slice(0, 200) };
}

/** English lines for image / video prompts. Reference-only characters are named as NOT to be depicted. */
function promptLines(scene, lib) {
  const name = (id) => ((lib.characters || []).find((c) => c.id === id) || { name: id }).name;
  const l = scene.look || {};
  const p = scene.pose || {};
  const out = [];
  if (l.background) out.push('ENVIRONMENT: ' + l.background);
  if (l.lighting) out.push('LIGHTING: ' + l.lighting);
  if (l.atmosphere) out.push('ATMOSPHERE: ' + l.atmosphere);
  if (l.style) out.push('ART STYLE: ' + l.style);
  if (p.body) out.push('BODY POSITIONING: ' + p.body);
  if (p.pose) out.push('POSE: ' + p.pose);
  if (scene.emotion) out.push('EMOTIONAL INTENT: ' + scene.emotion);
  const els = scene.elements || [];
  const of = (t) => els.filter((e) => e.type === t).map((e) => e.text);
  if (of('eyes').length) out.push('EYES: ' + of('eyes').join('; '));
  if (of('eyebrows').length) out.push('EYEBROWS: ' + of('eyebrows').join('; '));
  if (of('mouth').length) out.push('MOUTH: ' + of('mouth').join('; '));
  if (of('camera').length) out.push('CAMERA / SHOT: ' + of('camera').join('; '));
  if ((scene.referenceOnly || []).length) out.push(`Reference-only characters (${scene.referenceOnly.map(name).join(', ')}) are for appearance continuity only and are NOT in this scene: do not draw them.`);
  return out;
}

/** content for the storyboard approval hash; empty → null so approvals made before these fields existed keep their hash */
const lookHashPart = (s) => (s.look || s.pose ? { look: s.look || null, pose: s.pose || null } : null);

module.exports = { cleanElements, deriveText, ELEMENT_TYPES, cleanLook, cleanPose, cleanReferenceOnly, promptLines, lookHashPart, LOOK_KEYS, POSE_KEYS };
