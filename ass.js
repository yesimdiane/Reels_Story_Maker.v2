// ASS overlay for the lifestyle template, matched to the reference Reel: short single-line Korean
// captions centred at template.subtitle.centerY (regular weight, white, thin dark edge + soft shadow).
// Optional: a persistent comment-keyword line and the Coupang Partners disclosure (both off by default).
// No headlines, no slides, no animations.
'use strict';
const { splitCaptions, captionMaxWidth, geometry } = require('./layout');

function ts(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}

/** Escapes user text for an ASS Dialogue line (no override tags can be injected). */
function esc(text) {
  return String(text || '')
    .replace(/\\/g, '＼')
    .replace(/[{}]/g, (c) => (c === '{' ? '｛' : '｝'))
    .replace(/\r?\n/g, '\\N');
}

/**
 * Highlights Gemini's planned emphasis words inside one caption piece (only words that sit entirely in
 * the piece). Off unless template.subtitle.emphasis.enabled — the reference Reel uses plain white text.
 */
function emphasize(text, words, color) {
  let out = esc(text);
  (words || []).forEach((w) => {
    const e = esc(w);
    if (e && out.includes(e)) out = out.replace(e, `{\\c${color}}${e}{\\r}`);
  });
  return out;
}

/**
 * Merges [start, end] intervals that touch, so the AI label is one continuous line across cuts.
 */
function mergeIntervals(list) {
  const out = [];
  list.slice().sort((a, b) => a.start - b.start).forEach((iv) => {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end + 1e-6) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  });
  return out;
}

function buildAss(timeline, template, { font, disclosureText, keyword = '', preview = false, aiIntervals = [] }) {
  const W = template.canvas.width;
  const H = template.canvas.height;
  const geo = geometry(template);
  const st = template.subtitle;
  const d = template.disclosure;
  const cta = template.persistentCta || { enabled: false };
  const face = st.font || font;
  const style = (name, size, bold, outline, shadow, align, mL, mR, mV) =>
    `Style: ${name},${face},${size},${st.color},&H000000FF,${st.outlineColor},${st.shadowColor || '&H80000000'},${bold ? -1 : 0},0,0,0,100,100,0,0,1,${outline},${shadow},${align},${mL},${mR},${mV},1`;
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Sub', st.size, st.bold, st.outline, st.shadow, 5, 0, 0, 0),
    style('Cta', cta.size || st.size, st.bold, st.outline, st.shadow, 5, 0, 0, 0),
    style('Disclosure', d.size, false, 2, 1, 8, geo.safe.left, W - geo.safe.right, geo.safe.top),
    style('Tag', d.persistentTag ? d.persistentTag.size : 30, false, 2, 1, 7, geo.safe.left, 0, geo.safe.top),
    style('Preview', 26, false, 2, 1, 9, 0, geo.safe.left, geo.safe.top),
    style('AiLabel', (template.aiLabel && template.aiLabel.size) || 30, false, 2, 1, 7, geo.safe.left, 0, geo.safe.top),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, a, b, s, text) => lines.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${s},,0,0,0,,${text}`);
  const pos = `{\\pos(${geo.centerX},${geo.centerY})}`;

  const emph = st.emphasis && st.emphasis.enabled ? st.emphasis : null;
  timeline.beats.forEach((b) => b.subtitle.captions.forEach((c) => ev(2, c.start, c.end, 'Sub', pos + (emph ? emphasize(c.text, b.emphasisWords, emph.color) : esc(c.text)))));

  if (cta.enabled) {
    ev(2, 0, timeline.total, 'Cta', `{\\pos(${geo.centerX},${Math.round(H * cta.centerY)})}` + esc(String(cta.text).split('{키워드}').join(keyword)));
  }
  if (timeline.disclosure.full.length) {
    const dLines = splitCaptions(disclosureText, d.size, captionMaxWidth(template) * 1.4).map(esc).join('\\N');
    timeline.disclosure.full.forEach((iv) => ev(3, iv.start, iv.end, 'Disclosure', dLines));
  }
  timeline.disclosure.tag.forEach((iv) => ev(3, iv.start, iv.end, 'Tag', esc(d.persistentTag.text)));
  if (preview) ev(4, 0, timeline.total, 'Preview', esc('미리보기 음성'));
  // "AI 시뮬레이션" over every AI-generated or AI-visualization shot (never removed by a template switch).
  const ai = template.aiLabel || { enabled: false };
  if (ai.enabled) mergeIntervals(aiIntervals).forEach((iv) => ev(3, iv.start, iv.end, 'AiLabel', esc(ai.text)));
  return lines.join('\n') + '\n';
}

module.exports = { buildAss, ts, esc, mergeIntervals, emphasize };
