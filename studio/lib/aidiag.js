// Sanitized diagnostics for AI responses that were rejected: enough structure to explain WHY (which scene, which field, which rule,
// what the response looked like) without keys, credentials, images or long free text. Appended to ai-diagnostics.jsonl on the data volume.
'use strict';
const fs = require('node:fs');
const { nowIso } = require('./util');

const REDACT = [[/AIza[0-9A-Za-z_-]{20,}/g, '[key]'], [/\b(?:sk|key|tok|token|secret)[-_][A-Za-z0-9_-]{12,}/gi, '[key]'], [/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [key]'], [/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image]'], [/[A-Za-z0-9+/=]{120,}/g, '[omitted]']];
function scrub(text, max = 160) {
  let t = String(text == null ? '' : text);
  REDACT.forEach(([re, to]) => { t = t.replace(re, to); });
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** Shape of a Gemini scenes response: keys, counts and per-scene field presence/length — never the full text. */
function describe(out, sectionKeys) {
  const shape = { type: Array.isArray(out) ? 'array' : out === null ? 'null' : typeof out, topKeys: out && typeof out === 'object' ? Object.keys(out).slice(0, 12) : [], sceneCount: 0, sceneIds: [], perScene: {} };
  const list = out && Array.isArray(out.scenes) ? out.scenes : null;
  if (!list) return shape;
  shape.sceneCount = list.length;
  list.slice(0, 40).forEach((x, i) => {
    const id = scrub(x && x.scene_id != null ? x.scene_id : `#${i + 1}`, 24);
    shape.sceneIds.push(id);
    const o = x && typeof x === 'object' ? x : {};
    shape.perScene[id] = { present: Object.keys(o).filter((k) => sectionKeys.includes(k) || k === 'negative_additions'), empty: sectionKeys.filter((k) => !String(o[k] == null ? '' : o[k]).trim()), types: Object.fromEntries(sectionKeys.map((k) => [k, typeof o[k]])), lengths: Object.fromEntries(sectionKeys.map((k) => [k, String(o[k] == null ? '' : o[k]).length])) };
  });
  return shape;
}

function createAiDiagnostics({ store }) {
  const file = () => store.path('ai-diagnostics.jsonl');
  function record(entry) {
    const line = JSON.stringify(Object.assign({ at: nowIso() }, entry, { reason: scrub(entry.reason, 300), excerpt: entry.excerpt ? Object.fromEntries(Object.entries(entry.excerpt).map(([k, v]) => [k, scrub(v)])) : undefined }));
    try { fs.appendFileSync(file(), line + '\n'); } catch (_) { /* diagnostics must never break the request */ }
  }
  function recent(limit = 50) {
    try { return fs.readFileSync(file(), 'utf8').trim().split('\n').slice(-limit).map((l) => JSON.parse(l)); } catch (_) { return []; }
  }
  return { record, recent };
}

module.exports = { createAiDiagnostics, scrub, describe };
