// Character-reference rules shared by the template builder, the Gemini prompt generator and the validators.
// A character reference "sheet" shows ONE person many times (expressions, outfits, poses, example panels).
// It is an identity guide, never a scene layout. These rules are appended by CODE to every prompt that uses a sheet,
// so they never depend on the model remembering them.
'use strict';

const SHEET_RULE = 'IMPORTANT CHARACTER REFERENCE RULE: The provided character sheet contains multiple depictions of the SAME individual for identity reference only. ' +
  'Generate exactly one instance of that character in the scene (never a duplicate, twin or crowd). ' +
  'Extract only the consistent identity (face shape, hairstyle, skin tone, body type, distinctive features, illustration style). ' +
  'Do NOT recreate the reference sheet, collage, expression grid, turnaround, panels, labels, Korean/English text, flags, colour swatches or speech bubbles. ' +
  'Do NOT combine different outfits, poses or expressions; take the outfit, action, expression and environment from the scene description only. ' +
  'Example comic panels on the sheet are not scene content.';

const IDENTITY = {
  jack: 'Jack (exactly ONE): British male, wavy light-brown hair, neatly groomed mustache, stocky solid build, distinctive tattoos on the arms when the arms are visible.',
  diane: 'Diane (exactly ONE): Korean female, long dark hair, expressive eyes, consistent facial proportions.',
};

/** Exact head-count instruction for the characters selected in the scene editor (and nobody else). */
function castDirective(characterIds, lib) {
  const ids = Array.from(new Set(characterIds || []));
  const names = (id) => {
    const c = lib && lib.characters.find((x) => x.id === id);
    return c ? c.name : id;
  };
  if (!ids.length) return 'CAST: No recurring characters in this scene. Do NOT introduce Diane or Jack, or anyone resembling them.';
  if (ids.length === 1) return `CAST: Exactly ONE person is a main character: ${names(ids[0])}. Do not add any other recurring character (the other one of Diane/Jack must not appear).`;
  return `CAST: Exactly ${ids.length === 2 ? 'TWO' : ids.length} people: ${ids.map((i) => 'one ' + names(i)).join(' and ')}. Do not duplicate either character and do not add anyone else.`;
}

function identityLines(characterIds, lib) {
  return (characterIds || []).map((id) => {
    const c = lib && lib.characters.find((x) => x.id === id);
    const base = IDENTITY[id] || (c ? `${c.name}: ${c.look}` : '');
    return c && c.look && !IDENTITY[id] ? `${c.name}: ${c.look}` : base;
  }).filter(Boolean);
}

const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clausesOf = (text) => String(text || '').toLowerCase().split(/[.\n;!?]+|,\s*(?=(?:but|and|while|so)\b)/).map((x) => x.trim()).filter(Boolean);

/**
 * Is this clause an EXCLUSION of the character (e.g. "Keep Diane outside the frame", "without Diane", "Diane is not in this scene",
 * "do not show Diane") or an identity-only mention — as opposed to a request to show them?
 */
function isExcludedMention(clause, name) {
  const n = esc(name.toLowerCase());
  const W = '(?:\\w+[\\s,\'-]+){0,4}';
  return new RegExp(`\\b(?:no|not|never|without|exclude|excluding|except|avoid|omit|omitting|minus)\\s+${W}${n}\\b`).test(clause)
    || new RegExp(`\\bkeep\\s+${n}\\b[^.]*\\b(?:out|outside|away|off)\\b`).test(clause)
    || new RegExp(`\\b${n}\\b\\s+${W}(?:is|are|stays|remains|must stay|should stay|will stay)?\\s*(?:not|never)?\\s*(?:outside|out of|off[- ]?screen|absent|excluded|not (?:in|visible|present|shown|appear\\w*)|nowhere)`).test(clause)
    || new RegExp(`\\b(?:do not|don't|never|must not|should not|shouldn't|cannot|can't)\\s+${W}(?:show|include|add|introduce|render|draw|depict|feature|bring|put)\\s+${W}${n}\\b`).test(clause)
    || new RegExp(`\\b(?:leave|leaving)\\s+${n}\\s+out\\b`).test(clause)
    || new RegExp(`\\b${n}\\b[^.]*\\b(?:identity|appearance)\\s+(?:reference|only)\\b`).test(clause)
    || new RegExp(`\\b(?:identity|appearance)\\s+(?:reference|only)\\b[^.]*\\b${n}\\b`).test(clause);
}
const SHEET_TERMS = '(?:character sheet|reference sheet|turnaround|expression grid|collage|colou?r swatch(?:es)?)';
/** A reference-sheet term inside a prohibition ("do not draw a character sheet", "no collage", "keep the sheet out of frame") is fine; inside an instruction it is not. */
function isSheetProhibition(clause) {
  return /\b(?:no|not|never|without|avoid|don't|do not|must not|should not|shouldn't|instead of|rather than|isn't|aren't)\b/.test(clause) || /\bkeep\b[^.]*\b(?:out|outside|away|off)\b/.test(clause) || /\b(?:forbidden|prohibited|banned)\b/.test(clause);
}

/**
 * Problems in a prompt that would break the cast / sheet rules. Returns [{code,message}].
 *   text      : the prompt body (positive sections)
 *   opts.negative : the negative prompt / "negative additions". Everything in it is a prohibition: characters and sheet words listed there are not requests.
 * Exclusions ("Keep Diane outside the frame"), identity-only mentions and prohibitions never count as violations; a character who is not in the
 * scene but is described as present, a duplicated character, and an instruction to draw a reference sheet / collage do.
 */
function lintCast(text, scene, lib, opts = {}) {
  const sel = new Set(scene.characters || []);
  const out = [];
  const body = String(text || '').replace(/important character reference rule:[\s\S]*?example comic panels on the sheet are not scene content\./i, '');
  const clauses = clausesOf(body.split('\n').filter((l) => !/^\s*cast:/i.test(l)).join('\n'));
  (lib.characters || []).forEach((c) => {
    const n = esc(c.name.toLowerCase());
    const named = new RegExp(`\\b${n}\\b`);
    if (!sel.has(c.id) && clauses.some((cl) => named.test(cl) && !isExcludedMention(cl, c.name))) out.push({ code: 'UNSELECTED_CHARACTER', message: `${c.name}는 이 장면에서 선택되지 않았는데 프롬프트에 등장합니다.` });
    if (clauses.some((cl) => new RegExp(`(two|2|twin|duplicate|another|second)\\s+${n}\\b`).test(cl) && !/\b(?:no|not|never|without|avoid|don't|do not)\b/.test(cl))) out.push({ code: 'DUPLICATE_CHARACTER', message: `${c.name}가 두 명 이상 등장하도록 쓰여 있습니다.` });
  });
  if (clauses.some((cl) => new RegExp(SHEET_TERMS).test(cl) && !isSheetProhibition(cl))) {
    out.push({ code: 'SHEET_IN_SCENE', message: '레퍼런스 시트·콜라주·표정 그리드를 장면에 그리라는 표현이 있습니다.' });
  }
  return out;
}

module.exports = { SHEET_RULE, IDENTITY, castDirective, identityLines, lintCast, isExcludedMention };
