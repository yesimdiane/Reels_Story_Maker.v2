// Caption layout: width estimation, splitting a narration line into short single-line captions
// (as in the reference Reel), and Instagram safe-area geometry. Shared by the ASS builder and QC.
'use strict';

// Approximate advance widths (em) for a Korean UI sans font. Deliberately conservative.
function charEm(ch) {
  const c = ch.codePointAt(0);
  if (ch === ' ') return 0.3;
  if (c >= 0xac00 && c <= 0xd7a3) return 1.0; // Hangul syllables
  if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) return 1.0; // CJK / fullwidth
  if (/[0-9]/.test(ch)) return 0.62;
  if (/[A-Za-z]/.test(ch)) return 0.66;
  if (/[.,'"!?:;()\-·‘’]/.test(ch)) return 0.38;
  return 1.0;
}

function textWidth(text, size) {
  return [...text].reduce((w, ch) => w + charEm(ch) * size, 0) * 1.03;
}

/** Caption width limit for a template: the narrower of the reference ratio and the safe area. */
function captionMaxWidth(template) {
  const g = geometry(template);
  return Math.min(g.safe.right - g.safe.left - 2 * template.subtitle.outline, template.canvas.width * (template.subtitle.maxWidthRatio || 1));
}

/**
 * Splits a line into the fewest captions that each fit on one line, balancing their widths and
 * never splitting a word; a comma always ends a caption.
 */
function splitCaptions(text, size, maxWidth) {
  const out = [];
  for (const clause of text.split(/(?<=[,，])\s+/).filter(Boolean)) {
    const words = clause.split(' ').filter(Boolean);
    const w = (a, b) => textWidth(words.slice(a, b).join(' '), size);
    // Fewest chunks first, then the most balanced split (smallest widest caption).
    let best = null;
    for (let k = 1; k <= words.length && !best; k++) {
      const memo = new Map();
      const solve = (i, left) => {
        const key = i + ':' + left;
        if (memo.has(key)) return memo.get(key);
        let res = null;
        if (left === 1) res = { max: w(i, words.length), cuts: [] };
        else {
          for (let j = i + 1; j <= words.length - left + 1; j++) {
            const rest = solve(j, left - 1);
            if (!rest) continue;
            const m = Math.max(w(i, j), rest.max);
            if (!res || m < res.max) res = { max: m, cuts: [j].concat(rest.cuts) };
          }
        }
        memo.set(key, res);
        return res;
      };
      const r = solve(0, k);
      if (r && r.max <= maxWidth) best = r;
      if (k === words.length && !best) best = r; // a single word wider than the limit: QC reports it
    }
    let start = 0;
    for (const cut of best.cuts.concat([words.length])) {
      out.push(words.slice(start, cut).join(' '));
      start = cut;
    }
  }
  return out;
}

/** Safe-area rectangle and caption geometry (captions are centred on template.subtitle.centerY). */
function geometry(template) {
  const { width: W, height: H } = template.canvas;
  const sa = template.safeArea;
  const st = template.subtitle;
  const safe = { left: Math.round(W * sa.side), right: Math.round(W * (1 - sa.side)), top: Math.round(H * sa.top), bottom: Math.round(H * (1 - sa.bottom)) };
  const lineH = st.size * st.lineHeight;
  const cy = Math.round(H * st.centerY);
  return {
    safe,
    lineH,
    centerY: cy,
    centerX: Math.round(W / 2),
    captionBox: (lines) => ({ top: cy - (lines * lineH) / 2 - st.outline, bottom: cy + (lines * lineH) / 2 + st.outline + st.shadow }),
  };
}

module.exports = { textWidth, splitCaptions, captionMaxWidth, geometry, charEm };
