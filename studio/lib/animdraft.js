// Scene-specific animation beats (0.5 s grid) from the approved script: dialogue, visual direction, action, emotion, camera cues, duration.
// Deterministic and FREE (no AI call). Pure functions: nothing here touches the store or a provider.
//   * timed visual text ("0.0–1.5 s: …") becomes the beats' time windows; untimed text is split over the scene
//   * dialogue lines get a speaking beat (gesture/expression chosen from the line's content) and a reaction beat for the listener
//   * camera words (whip-pan, push-in, zoom, close-up …) go to the camera field; a deliberate hold is a beat of its own, not filler
//   * placeholder phrases ("neutral", "holds the opening pose", "settled", "static" …) are never produced; isGeneric() detects them
'use strict';

const STEP = 0.5;
const r1 = (n) => Math.round(n * 1000) / 1000;
const snap = (n) => Math.round(n / STEP) * STEP;

const GENERIC = new Set(['neutral', 'holds the opening pose', 'looks at the camera', 'settled', 'static', 'holds the pose', 'steady', 'reaction', 'stays still', 'listening', 'mouth moves with the dialogue', 'slight forward lean while speaking', 'small head tilt while speaking', 'looks at the listener', 'looks at the speaker', 'slow push-in']);
const isGenericText = (t) => { const v = String(t || '').trim().toLowerCase(); return !v || GENERIC.has(v); };
/** A beat is a placeholder when fewer than two of emotion / body / gaze / expression say anything specific. */
const isGeneric = (b) => ['emotion', 'body', 'gaze', 'expression'].filter((k) => !isGenericText(b && b[k])).length < 2;

const EMOTIONS = [
  [/smug|confident|confidently|proud|boast|brag|don't use|never use|grin/i, { emotion: 'smug confidence', expression: 'smug half-smile, one eyebrow raised', stance: 'stands tall with chin lifted' }],
  [/surpris|gasp|shock|lightbulb|realiz|idea|sudden/i, { emotion: 'surprise turning into realisation', expression: 'eyes widen, brows shoot up, mouth opens', stance: 'freezes, then leans in' }],
  [/angry|annoy|furious|irritat|scold/i, { emotion: 'annoyed', expression: 'brows pulled together, tight lips', stance: 'squares the shoulders' }],
  [/rain|soaked|wet|cold|shiver|storm|monsoon|struggl/i, { emotion: 'dismay', expression: 'wincing, squinting against the rain', stance: 'hunches slightly' }],
  [/happy|delight|joy|laugh|cheer|excited|thrilled/i, { emotion: 'delight', expression: 'wide smile, bright eyes', stance: 'bounces lightly on the spot' }],
  [/embarrass|awkward|blush|sheepish/i, { emotion: 'embarrassment', expression: 'flushed cheeks, eyes glancing away', stance: 'shrinks a little' }],
  [/worr|nervous|anxious|afraid|scared/i, { emotion: 'worry', expression: 'brows knit upward, lips pressed', stance: 'fidgets with both hands' }],
  [/skeptic|doubt|suspic|unconvinced/i, { emotion: 'scepticism', expression: 'one brow arched, flat mouth', stance: 'folds the arms' }],
];
const CAMERA = /((?:quick|slow|slight|fast|gentle|smooth)\s+)?(whip[- ]?pan|push[- ]?in(?:\s+zoom)?|pull[- ]?out|zoom(?:s|ing)?(?: in| out)?|dolly|tilt(?:s)?(?: up| down)?|pan(?:s)?(?: left| right)?|close[- ]?up|medium shot|wide shot|over[- ]the[- ]shoulder|low angle|high angle|handheld|static shot|camera holds?)/i;
const GAZE = /(?:looks?|glances?|stares?|turns? (?:his|her|their) head) (?:at|toward|towards|to)\s+([^.,;]+)/i;
const EXIT = /(turn(?:s|ing)? away|walk(?:s|ing)? (?:off|away|into|out)|exit|leave|leaves|head(?:s|ing)? (?:off|out))/i;

function cuesFor(text) {
  for (const [re, v] of EMOTIONS) if (re.test(text)) return v;
  return null;
}
function gestureFor(line) {
  const t = String(line.en || '');
  if (/\b(don't|do not|never|no|not|nobody)\b/i.test(t)) return { body: 'makes a dismissive hand gesture, chin lifts slightly', expression: 'one eyebrow raised, confident smirk' };
  if (/\?\s*$/.test(t)) return { body: 'tilts the head and lifts a palm in a questioning gesture', expression: 'brows lift, eyes wide with curiosity' };
  if (/!\s*$/.test(t)) return { body: 'leans in with an emphatic hand gesture', expression: 'brows lift, eyes bright, mouth wide on the stress words' };
  if (/\b(look|see|here|this)\b/i.test(t)) return { body: 'points or presents with an open hand', expression: 'raised brows, engaged smile' };
  return { body: 'nods once while speaking, small head movement', expression: 'brows rise on the key word, relaxed mouth' };
}


// Personality cues are limited to performance direction; they never override script dialogue.
// Deliberately deterministic, free, and safe for scenes without Jack or Diane.
const PERSONA = {
  jack: {
    question: { body: 'pauses, tilts his head and gives a restrained palm-up gesture', expression: 'one eyebrow lifts; skeptical side-eye' },
    excited: { body: 'recoils a fraction, then leans closer to inspect', expression: 'eyes widen under raised brows; surprised half-smile' },
    negative: { body: 'folds his arms briefly and shakes his head once', expression: 'dry, unimpressed look with lips pressed together' },
    default: { body: 'makes a small, measured hand gesture', expression: 'subtle eyebrow movement and a dry half-smile' },
    listen: { emotion: 'deadpan curiosity', body: 'brief stillness, then a delayed head tilt', expression: 'one eyebrow rises after a beat; mouth remains closed' }
  },
  diane: {
    question: { body: 'leans forward and opens both hands toward the listener', expression: 'bright, inquisitive eyes and raised eyebrows' },
    excited: { body: 'bursts forward with an enthusiastic presenting gesture', expression: 'eyes sparkle, eyebrows rise high, delighted open smile' },
    negative: { body: 'waves one hand emphatically and shakes her head', expression: 'expressive brows, firm mouth and a playful glare' },
    default: { body: 'gestures energetically while presenting the idea', expression: 'animated eyebrows and an engaged smile' },
    listen: { emotion: 'playful anticipation', body: 'leans in, holding an eager response for a beat', expression: 'expectant smile, eyes following the speaker' }
  }
};
function personaOf(cid, name) {
  const key = [cid, name].map((v) => String(v || '').toLowerCase()).join(' ');
  if (/\bjack\b/.test(key)) return PERSONA.jack;
  if (/\bdiane\b/.test(key)) return PERSONA.diane;
  return null;
}
function dialogueKind(line) {
  const t = String(line.en || '');
  if (/\b(don't|do not|never|no|not|nobody)\b/i.test(t)) return 'negative';
  if (/!|\b(baby+y+|wow|amazing|look at this|check this out|love it)\b/i.test(t)) return 'excited';
  if (/\?\s*$/.test(t)) return 'question';
  return 'default';
}
function listenerCue(cid, name, index) {
  const persona = personaOf(cid, name);
  if (persona) return persona.listen;
  return { emotion: index % 2 ? 'amused' : 'sceptical interest', body: 'reacts with a brief head movement after listening', expression: 'eyebrows flicker and lips settle into a considered expression' };
}

/** "0.0–1.5 s: …" segments from visual text, or null. */
function timedSegments(text, dur) {
  const re = /(\d+(?:\.\d+)?)\s*(?:–|—|-|~|to)\s*(\d+(?:\.\d+)?)\s*s?\s*[:：]\s*([\s\S]*?)(?=(?:\d+(?:\.\d+)?\s*(?:–|—|-|~|to)\s*\d+(?:\.\d+)?\s*s?\s*[:：])|$)/gi;
  const out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    const t0 = Math.max(0, snap(Number(m[1]))); const t1 = Math.min(dur, snap(Number(m[2])));
    const body = m[3].replace(/\s+/g, ' ').trim().replace(/[.;]\s*$/, '');
    if (t1 > t0 && body) out.push({ t0, t1, text: body });
  }
  return out.length ? out : null;
}
function sentences(text) { return String(text || '').split(/(?<=[.!?])\s+|;\s+|,?\s+then\s+/i).map((x) => x.trim().replace(/[.]+$/, '')).filter(Boolean); }

/** Splits [0,dur] into n windows on the 0.5 grid (the last takes the remainder). */
function windows(dur, n) {
  const total = Math.round(dur / STEP);
  const k = Math.max(1, Math.min(n, total));
  const out = []; let cur = 0;
  for (let i = 0; i < k; i++) { const end = i === k - 1 ? total : cur + Math.max(1, Math.round((total - cur) / (k - i))); out.push({ t0: cur * STEP, t1: end * STEP }); cur = end; }
  return out;
}


// Each saved beat represents one 0.5-second interval. Nose/mouth directions live
// inside the existing expression field so the persisted schema and renderer remain compatible.
function facialMicroPrompt(beat, stepIndex) {
  const speaking = !!beat._speak;
  const listening = !!beat._listen;
  const phases = ['mouth opens on the stressed syllable', 'mouth narrows for consonants', 'mouth opens naturally on the vowel', 'lips close briefly between words'];
  const mouth = speaking ? phases[stepIndex % phases.length] : listening ? 'mouth closed, subtle lip reaction' : 'mouth rests naturally, no speech lip-sync';
  const nose = speaking ? 'subtle nostril movement with breathing' : 'nose remains stable with natural breathing';
  return [beat.expression, 'nose: ' + nose, 'mouth: ' + mouth].filter(Boolean).join('; ').slice(0, 300);
}
// Compact per-character performance tracks. Only split at 0.1s precision
// when speech actually ends between regular 0.5s motion boundaries.
function compactCharacterBeats(beats, duration, speechWindows) {
  const result = [];
  const tenths = (n) => Math.round(n * 10) / 10; // store 0.3s audio cuts on a 0.1s-compatible timeline
  const audioEnd = new Map();
  for (const w of speechWindows) {
    const key = String(w.line.speaker);
    if (!audioEnd.has(key)) audioEnd.set(key, []);
    audioEnd.get(key).push({ start: w.t0, end: w.audioEnd });
  }
  for (const beat of beats) {
    const ranges = audioEnd.get(String(beat.characterId)) || [];
    const cutPoints = [beat.t0, beat.t1];
    // Spoken scenes use regular 0.5s motion beats; only speech endings add fractional cuts.
    if (speechWindows.length) for (let t = Math.ceil((beat.t0 + 0.000001) / STEP) * STEP; t < beat.t1 - 0.000001; t += STEP) cutPoints.push(t);
    for (const w of ranges) if (w.end > beat.t0 + 0.001 && w.end < beat.t1 - 0.001) cutPoints.push(w.end);
    cutPoints.sort((x, y) => x - y);
    const uniqueCuts = cutPoints.filter((x, i) => !i || x - cutPoints[i - 1] > 0.000001);
    for (let i = 0; i < uniqueCuts.length - 1; i++) {
      const t0 = tenths(uniqueCuts[i]), t1 = tenths(uniqueCuts[i + 1]);
      if (t1 <= t0) continue;
      const speaking = ranges.some(w => t0 >= w.start - 0.001 && t0 < w.end - 0.001);
      const { _speak, _listen, _exit, ...clean } = beat;
      const mouth = speaking ? 'mouth moves naturally while audio plays' : 'mouth closed; no lip movement';
      const nose = 'nose remains steady with natural breathing';
      result.push({ ...clean, t0, t1, emotion: String(beat.emotion || 'attentive').trim(),
        expression: [String(beat.expression || '').replace(/; mouth shapes the line/gi, '').replace(/; nose:.*$/i, ''), 'nose: ' + nose, 'mouth: ' + mouth].filter(Boolean).join('; ').slice(0, 300),
        body: String(beat.body || 'maintains the established pose').slice(0, 300) });
    }
  }
  return result.sort((x, y) => x.t0 - y.t0 || String(x.characterId).localeCompare(String(y.characterId)));
}

// Read-only audio timing: use synthesized duration only for audio matching the
// currently approved script. No TTS generation, file IO, or billable calls here.
function audioDuration(ep, line) {
  const saved = ep && ep.voice && ep.voice.lines && ep.voice.lines[line.id];
  if (!saved || !Number.isFinite(Number(saved.durationSec)) || Number(saved.durationSec) <= 0) return null;
  if (!saved.scriptHash) return null;
  try {
    const { scriptFingerprint } = require('./episode');
    if (saved.scriptHash !== scriptFingerprint(ep)) return null;
  } catch (_) { return null; }
  return Number(saved.durationSec);
}
function dialogueWindows(ep, lines, duration, exitFrom) {
  const out = [];
  let cursor = Math.min(0.5, Math.max(0, duration - STEP));
  for (const line of lines) {
    if (cursor >= duration - 1e-6 || cursor >= exitFrom - 1e-6) break;
    const measured = audioDuration(ep, line);
    const estimated = Math.max(1, snap(String(line.en).trim().split(/\\s+/).length / 2.7));
    const seconds = measured == null ? estimated : Math.max(0.1, Math.ceil(measured / 0.3) * 0.3);
    const t0 = snap(cursor);
    const audioEnd = Math.min(duration, exitFrom, Math.round((t0 + seconds) * 10) / 10);
    const t1 = Math.min(duration, exitFrom, Math.ceil(audioEnd / STEP) * STEP);
    if (t1 - t0 < STEP - 1e-6) break;
    out.push({ line, t0, t1, audioEnd, source: measured == null ? 'estimated' : 'synthesized-audio', measuredSec: measured });
    cursor = t1;
  }
  return out;
}

function draftBeats(ep, scene, characters) {
  const dur = Number(scene.durationSec) || 4;
  const cast = (scene.characters && scene.characters.length ? scene.characters : []).filter(Boolean);
  const byId = (id) => characters.find((c) => c.id === id) || { id, name: id };
  const nameOf = (cid) => byId(cid).name;
  const mention = (text) => cast.find((cid) => new RegExp('\\b' + nameOf(cid) + '\\b', 'i').test(text)) || null;
  const other = (cid) => (cast.length > 1 ? cast.find((c) => c !== cid) : null);
  const lines = (ep.lines || []).filter((l) => l.sceneId === scene.id && l.en);
  const sceneCue = cuesFor([scene.emotion, scene.action, scene.visual].filter(Boolean).join(' '));
  const sceneCam = (String(scene.visual || '').match(CAMERA) || [])[0] || '';
  const beats = [];
  const push = (b) => { if (b.t1 - b.t0 >= STEP - 1e-6) beats.push(Object.assign({ sceneId: scene.id }, b, { t0: r1(b.t0), t1: r1(b.t1) })); };

  // 1) structure: timed visual segments, else the ACTION clauses spread over the duration (the visual text then only supplies setting/camera)
  let segs = timedSegments(scene.visual, dur);
  if (!segs) {
    const parts = sentences(scene.action || scene.visual).slice(0, 4);
    segs = parts.length ? windows(dur, parts.length).map((w, i) => Object.assign(w, { text: parts[i] })) : [];
  }
  const exitFrom = segs.filter((sg) => EXIT.test(sg.text)).reduce((m, sg) => Math.min(m, sg.t0), dur);
  let prev = lines[0] && cast.includes(lines[0].speaker) ? lines[0].speaker : cast[0];
  segs.forEach((sg, i) => {
    const named = mention(sg.text);
    const cid = named || (/\b(she|her|he|his|they|their)\b/i.test(sg.text) && i > 0 ? prev : (i === 0 ? prev : cast[i % Math.max(1, cast.length)] || prev));
    if (!cid) return;
    prev = cid;
    const cam = (sg.text.match(CAMERA) || [])[0] || '';
    const cue = cuesFor(sg.text) || sceneCue || { emotion: 'composed attention', expression: 'attentive eyes, relaxed mouth', stance: 'stands naturally' };
    let body = sg.text.replace(CAMERA, ' ').replace(new RegExp('^\\s*(?:to\\s+)?' + nameOf(cid) + '\\b(?:\\s+with)?\\s*', 'i'), '').replace(/\s{2,}/g, ' ').replace(/^[\s,:-]+|[\s,:-]+$/g, '');
    const fragment = !body || body.length < 6 || (/^(in|on|at|stable|steady|quick|slow|slowly|then|and|with|as)\b/i.test(body) && body.split(/\s+/).length < 6);
    if (fragment) body = i === 0 ? cue.stance : 'holds the moment, letting the previous beat land';
    else if (/^(a|an|the)\b/i.test(body)) body = 'shows ' + body;
    else if (/^as\s/i.test(body)) body = body.replace(/^as\s+(?:he|she|they)\s+/i, '');
    const isExit = EXIT.test(sg.text);
    if (i === 0 && sg.t0 === 0 && !isExit && cue.stance && !fragment) body = cue.stance + '; ' + body;
    const gz = (sg.text.match(GAZE) || [])[1];
    const tgt = other(cid);
    push({ t0: sg.t0, t1: sg.t1, characterId: cid, character: nameOf(cid), emotion: cue.emotion, body: body.slice(0, 200), gaze: gz ? gz.trim() : isExit ? 'away from the camera, toward where they are heading' : tgt && lines.length ? `toward ${nameOf(tgt)}` : lines.length ? 'toward the camera' : 'at the action in the scene', expression: isExit ? 'faint satisfied smile' : cue.expression, camera: cam.toLowerCase() || (isExit ? 'camera holds as they exit' : i === 0 ? (sceneCam.toLowerCase() || 'medium shot') : ''), _exit: isExit });
  });

  // 2) dialogue: a speaking beat (gesture from the line's content) + a reaction beat for the listener, before any exit
  const speechWindows = dialogueWindows(ep, lines, dur, exitFrom);
  speechWindows.forEach(({ line: l, t0, t1 }, n) => {
    const cid = cast.includes(l.speaker) ? l.speaker : cast[0];
    if (!cid) return;
    const persona = personaOf(cid, nameOf(cid));
    const g = persona ? persona[dialogueKind(l)] : gestureFor(l);
    const cue = cuesFor(l.en) || sceneCue || { emotion: 'engaged' };
    const tgt = other(cid);
    push({ t0, t1, characterId: cid, character: nameOf(cid), emotion: cue.emotion, body: g.body, gaze: tgt ? `toward ${nameOf(tgt)}` : 'toward the camera', expression: g.expression + '; mouth shapes the line', camera: '', _speak: true });
    if (tgt) {
      const react = listenerCue(tgt, nameOf(tgt), n);
      push({ t0, t1, characterId: tgt, character: nameOf(tgt), emotion: react.emotion, body: react.body, gaze: `toward ${nameOf(cid)}`, expression: react.expression, camera: '', _listen: true });
    }
  });

  // 3) resolve overlaps per character: speaking > exit > other structure; trimmed beats keep their text, drop only when < 0.5 s remain
  const rank = (b) => (b._speak ? 3 : b._exit ? 2 : b._listen ? 0 : 1);
  const out = [];
  Array.from(new Set(beats.map((b) => b.characterId))).forEach((cid) => {
    const mine = beats.filter((b) => b.characterId === cid).sort((a, b) => rank(b) - rank(a) || a.t0 - b.t0);
    const kept = [];
    mine.forEach((b) => {
      let cur = { t0: b.t0, t1: b.t1 };
      let pieces = [cur];
      kept.forEach((k) => { pieces = pieces.flatMap((p) => { if (k.t1 <= p.t0 + 1e-6 || k.t0 >= p.t1 - 1e-6) return [p]; const o = []; if (k.t0 - p.t0 >= STEP - 1e-6) o.push({ t0: p.t0, t1: k.t0 }); if (p.t1 - k.t1 >= STEP - 1e-6) o.push({ t0: k.t1, t1: p.t1 }); return o; }); });
      pieces.slice(0, 1).forEach((p) => kept.push(Object.assign({}, b, p)));
    });
    kept.forEach((k) => out.push(k));
  });

  // 4) a deliberate closing hold when nothing covers the end of the scene
  const last = out.reduce((m, b) => Math.max(m, b.t1), 0);
  if (last < dur - 1e-6 && out.length) {
    const tail = out.slice().sort((a, b) => a.t1 - b.t1).pop();
    out.push({ sceneId: scene.id, t0: r1(last), t1: r1(dur), characterId: tail.characterId, character: tail.character, emotion: tail.emotion, body: 'holds the final pose deliberately, letting the moment land', gaze: tail.gaze, expression: 'a held, knowing look', camera: 'camera holds' });
  }
  return compactCharacterBeats(out, dur, speechWindows);
}

module.exports = { draftBeats, dialogueWindows, audioDuration, isGeneric, isGenericText, timedSegments, GENERIC, STEP };
