// Dialogue timeline: places each spoken line inside its scene, extends a scene when its dialogue needs more time
// (never cuts a line, never overlaps two lines), and appends the CTA end card. Pure; no I/O.
'use strict';

const GAP = 0.18; // pause between two lines in the same scene
const LEAD = 0.25; // before the first line of a scene
const TAIL = 0.35; // after the last line of a scene

/**
 * audioSec(lineId) → seconds of recorded audio, or null if the line has no audio yet.
 * Returns { scenes, lines, cta, total, warnings, missing }.
 */
function buildTimeline(ep, audioSec) {
  const warnings = [];
  const missing = [];
  let t = 0;
  const scenes = [];
  const lines = [];
  (ep.scenes || []).forEach((s) => {
    const own = (ep.lines || []).filter((l) => l.sceneId === s.id);
    const planned = Number(s.durationSec);
    const sceneStart = t;
    let cursor = t + LEAD;
    const ownLines = [];
    own.forEach((l, i) => {
      const d = audioSec(l.id);
      if (d == null) { missing.push(l.id); return; }
      const savedOffset = (ep.audioTiming || {})[l.id];
      // An absent offset must use sequential default placement, never coerce undefined/null into zero.
      const offset = savedOffset == null ? NaN : Number(savedOffset);
      if (Number.isFinite(offset) && offset >= 0) cursor = Math.max(cursor, sceneStart + offset);
      ownLines.push({ id: l.id, sceneId: s.id, speaker: l.speaker, start: round(cursor), end: round(cursor + d), duration: d, en: l.en, ko: l.ko });
      cursor += d + GAP;
    });
    const need = ownLines.length ? cursor - t - GAP + TAIL : 0;
    const duration = Math.max(planned, round(need));
    if (duration > planned + 0.01) warnings.push({ code: 'SCENE_EXTENDED', sceneId: s.id, message: `${s.id}: 대사가 길어 ${planned}초 → ${duration}초로 늘어납니다.` });
    lines.push(...ownLines);
    scenes.push({ id: s.id, title: s.title_ko || s.title, start: round(t), end: round(t + duration), duration: round(duration), plannedSec: planned, extended: duration > planned + 0.01 });
    t += duration;
  });
  const ctaSec = Number((ep.cta && ep.cta.durationSec) || 0);
  const cta = { start: round(t), end: round(t + ctaSec), duration: ctaSec, lines: (ep.cta && ep.cta.lines) || [] };
  return { scenes, lines, cta, total: round(t + ctaSec), warnings, missing };
}

const round = (n) => Math.round(n * 1000) / 1000;

module.exports = { buildTimeline, GAP, LEAD, TAIL };
