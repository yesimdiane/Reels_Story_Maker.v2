// Reusable close-up presets across episodes (built-in kinds live in cuts.js; these are the operator's own saved framings).
// Each save of the same preset adds a numbered version; nothing is ever rewritten. Stored on the persistent volume.
'use strict';
const { StudioError, nowIso, sha256, readJson, writeJsonAtomic } = require('./util');
const { PRESETS, TRANSITIONS, LIMITS, clampCrop } = require('./cuts');

function createCutPresets({ store }) {
  const file = store.path('cut-presets.json');
  const read = () => readJson(file, { schema: 1, presets: {} });
  const view = (p) => { const cur = p.versions.find((v) => v.v === p.current); return { id: p.id, name: p.name, current: p.current, versions: p.versions.map((v) => ({ v: v.v, at: v.at, by: v.by })), preset: cur.preset, transition: cur.transition, durationSec: cur.durationSec, crop: cur.crop, character: cur.character || '' }; };
  return {
    builtIn: () => Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, character: p.character, crop: p.crop, durationSec: p.durationSec, transition: p.transition, face: p.face })),
    list: () => Object.values(read().presets).filter((p) => !p.removed).map(view),
    /** New preset, or (with id) a new version of an existing one. */
    save({ id, name, preset = 'custom', transition, durationSec, crop, by = 'operator' } = {}) {
      const d = read();
      let p = id && d.presets[id];
      if (id && !p) throw new StudioError('NOT_FOUND', '저장된 컷 프리셋을 찾을 수 없습니다.', { status: 404 });
      // a new version starts from the current one: only the given fields change
      const prev = p ? p.versions.find((v) => v.v === p.current) : null;
      const kind = PRESETS[preset] && (preset !== 'custom' || !prev) ? preset : (prev ? prev.preset : 'custom');
      const base = prev || PRESETS[kind] || PRESETS.custom;
      const entry = { v: 1, at: nowIso(), by, preset: kind, transition: TRANSITIONS[transition] ? transition : base.transition, durationSec: Math.round(Math.min(LIMITS.maxDur, Math.max(LIMITS.minDur, Number(durationSec) || base.durationSec)) * 100) / 100, crop: clampCrop(crop || base.crop), character: (PRESETS[kind] || PRESETS.custom).character || '' };
      if (!p) {
        const nm = String(name || '').trim().slice(0, 60);
        if (!nm) throw new StudioError('NAME_REQUIRED', '프리셋 이름을 입력하세요.', { status: 422 });
        const nid = 'CP-' + sha256(nm + nowIso()).slice(0, 8);
        p = d.presets[nid] = { id: nid, name: nm, current: 0, versions: [] };
      } else if (name && String(name).trim()) p.name = String(name).trim().slice(0, 60);
      entry.v = p.versions.length + 1;
      p.versions.push(entry);
      p.current = entry.v;
      p.removed = false;
      writeJsonAtomic(file, d);
      return view(p);
    },
    remove(id) {
      const d = read();
      if (!d.presets[id]) throw new StudioError('NOT_FOUND', '저장된 컷 프리셋을 찾을 수 없습니다.', { status: 404 });
      d.presets[id].removed = true; // hidden, history kept
      writeJsonAtomic(file, d);
      return { id, removed: true };
    },
  };
}
module.exports = { createCutPresets };
