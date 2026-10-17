// Timeline: beats keep their scripted length unless the narration needs more; each beat is split
// into its shots (hard cuts); subtitles follow the voice; disclosure at start and end.
'use strict';
const { splitCaptions, captionMaxWidth, textWidth } = require('./layout');

/**
 * storyboard: from buildStoryboard; narration: [{ file, duration }] one per beat (same order).
 * Returns the timeline in seconds.
 */
/** The line as short single-line captions, sharing the voice window in proportion to their length. */
function captionsFor(text, start, end, size, maxW) {
  const parts = splitCaptions(text, size, maxW);
  const total = parts.reduce((n, p) => n + textWidth(p, size), 0);
  let t = start;
  const captions = parts.map((p) => {
    const d = ((end - start) * textWidth(p, size)) / total;
    const c = { text: p, start: t, end: t + d };
    t += d;
    return c;
  });
  return { text, start, end, captions };
}

function buildTimeline(storyboard, narration, template) {
  const n = template.narration;
  const maxW = captionMaxWidth(template);
  let t = 0;
  const beats = storyboard.beats.map((b, i) => {
    const voice = narration[i];
    // pauseAfterSec: Gemini's planned pause after the line (production plan), else the template's tail.
    const dur = Math.max(b.scriptedSec, n.leadInSec + voice.duration + (b.pauseAfterSec != null ? b.pauseAfterSec : n.tailSec));
    const start = t;
    t += dur;
    const vStart = start + n.leadInSec;
    const per = dur / b.shots.length;
    return {
      sceneNo: b.sceneNo,
      beat: b.beat,
      emphasisWords: b.emphasisWords || [],
      start,
      end: start + dur,
      duration: dur,
      voice: { file: voice.file, start: vStart, end: vStart + voice.duration, duration: voice.duration },
      subtitle: captionsFor(b.subtitle, vStart, Math.min(vStart + voice.duration + template.subtitle.holdSec, start + dur), template.subtitle.size, maxW),
      shots: b.shots.map((sh, k) => ({ id: sh.id, framing: sh.framing, start: start + k * per, end: start + (k + 1) * per, duration: per })),
    };
  });
  const total = t;
  const d = template.disclosure;
  const last = beats[beats.length - 1];
  // Disclosure in the video is optional (default: caption only, decided by the operator).
  const full = [];
  let tag = [];
  if (d.inVideo) {
    full.push({ start: 0, end: Math.min(d.startSec, total) });
    if (d.onLastScene && last.start > d.startSec) full.push({ start: last.start, end: total });
    if (d.persistentTag && d.persistentTag.enabled && last.start > d.startSec) tag = [{ start: d.startSec, end: last.start }];
  }
  return {
    width: template.canvas.width,
    height: template.canvas.height,
    fps: template.canvas.fps,
    total,
    beats,
    shots: beats.flatMap((b) => b.shots),
    voice: beats.map((b) => b.voice), // for the narration track builder
    disclosure: { full, tag },
  };
}

module.exports = { buildTimeline };
