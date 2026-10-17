// Forbidden / unverified product-claim matching WITH context.
//   Plain substring matching flags harmless words: the forbidden term "드립" sits inside the polite verb "드립니다" of the
//   standard CTA ("링크 드립니다", "링크 드림!", "알려드릴게요"). Matching therefore looks at the whole word (eojeol) around a hit:
//   - Latin / digit terms must match whole tokens ("IP6" is not "IP68"... and "UV" is not "UVA").
//   - A hit is ignored ONLY when the surrounding word is a conjugated form of the honorific verb 드리다 and the claim term is
//     nothing but a fragment of that verb. The bare noun ("아재 드립"), compounds ("방수드립") and every other claim stay flagged.
//   Nothing else is exempt, so real unsupported claims ("방수", "100% 방수", "완전방수", "방수성") are still found.
'use strict';

const isAlnum = (c) => !!c && /[A-Za-z0-9]/.test(c);
const isWordChar = (c) => !!c && /[가-힣A-Za-z0-9]/.test(c);
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ');

// 드리다 (to give / offer, honorific): fragments that appear inside its conjugations
const DEURIDA_FRAGMENTS = ['드리', '드립', '드림', '드려', '드릴', '드렸', '드', '립', '림', '려', '릴', '렸'];
const DEURIDA_FORM = /^[가-힣]{0,10}?(?:드립니다|드립니까|드립니당|드립게요|드릴게요|드릴께요|드릴까요|드릴게|드려요|드려도|드려서|드렸어요|드렸습니다|드리겠습니다|드리겠어요|드리고|드리는|드리면|드림|드려)$/;

function eojeol(t, i, len) {
  let a = i;
  let b = i + len;
  while (a > 0 && isWordChar(t[a - 1])) a -= 1;
  while (b < t.length && isWordChar(t[b])) b += 1;
  return { word: t.slice(a, b), start: a, end: b };
}
function benign(claim, word) {
  if (!DEURIDA_FRAGMENTS.includes(claim) && !/^드[리립림려릴렸]/.test(claim)) return false;
  // the claim must be only a fragment of the verb: it may not contain anything outside the 드리다 form
  return DEURIDA_FORM.test(word) && word.includes(claim);
}

/** All places where `text` really makes one of the claims: [{ claim, index, context }]. */
function claimHits(text, claims) {
  const t = norm(text);
  const hits = [];
  (claims || []).forEach((raw) => {
    const claim = norm(raw).trim();
    if (!claim) return;
    let from = 0;
    for (;;) {
      const i = t.indexOf(claim, from);
      if (i < 0) break;
      from = i + 1;
      if (isAlnum(claim[0]) && isAlnum(t[i - 1])) continue;
      if (isAlnum(claim[claim.length - 1]) && isAlnum(t[i + claim.length])) continue;
      const w = eojeol(t, i, claim.length);
      if (benign(claim, w.word)) continue;
      hits.push({ claim: String(raw).trim(), index: i, context: t.slice(Math.max(0, w.start - 6), Math.min(t.length, w.end + 6)).trim() });
      break; // one hit per claim is enough for validation
    }
  });
  return hits;
}
const hasClaim = (text, claim) => claimHits(text, [claim]).length > 0;
/** The claims (original spelling) found in `text`. */
const claimsIn = (text, claims) => claimHits(text, claims).map((h) => h.claim);

module.exports = { claimHits, hasClaim, claimsIn };
