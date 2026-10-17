import { state } from '../state.js';

// The editor's working copy of the script (per episode). dirtyScenes = scenes with unsaved edits; epDirty = unsaved episode-level fields.
export function draftOf(ep) {
  if (!state.draft.script || state.draft.script.forEpisode !== ep.id) {
    state.draft.script = {
      forEpisode: ep.id, dirty: false, dirtyScenes: new Set(),
      title: ep.title, titleEn: ep.titleEn || '',
      beats: ep.beats.slice(),
      scenes: ep.scenes.map((s) => ({ id: s.id, part: s.part, beatKey: s.beatKey, title: s.title, title_ko: s.titleKoMissing ? '' : s.title_ko, legacyTitle: s.title, durationSec: s.durationSec, characters: s.characters.slice(), showsProduct: s.showsProduct, visual: s.visual, beat: s.beat, action: s.action || '', emotion: s.emotion || '', look: Object.assign({}, s.look || {}), pose: Object.assign({}, s.pose || {}), referenceOnly: (s.referenceOnly || []).slice(), elements: Array.isArray(s.elements) ? s.elements.map((e) => Object.assign({}, e)) : undefined, narration: s.narration || '', placement: s.placement || '' })),
      lines: ep.lines.map((l) => ({ ...l })),
      comedy_story: ep.formula.structured ? Object.fromEntries(ep.formula.partA.map((b) => [b.key, { title_ko: b.title_ko, story_en: b.story_en, visual: b.visual }])) : null,
      product_ending: ep.formula.structured ? Object.fromEntries(ep.formula.partB.map((b) => [b.key, { title_ko: b.title_ko, story_en: b.story_en, visual: b.visual }])) : null,
      endingVars: ep.formula.structured ? Object.assign({}, ep.formula.ending.vars) : null,
      cta: { lines: ep.cta.lines.slice(), keyword: ep.cta.keyword, durationSec: ep.cta.durationSec },
    };
  }
  return state.draft.script;
}

/**
 * After saving some scenes: rebuild the working copy from the server, but KEEP the unsaved edits of every other scene
 * (and of the episode-level fields) — saving one scene must never discard another scene's typing.
 */
export function resetDraftAfterSave(ep, old, savedSids) {
  state.draft.script = null;
  const nd = draftOf(ep);
  if (!old) return nd;
  const saved = new Set(savedSids);
  (old.dirtyScenes ? Array.from(old.dirtyScenes) : []).forEach((sid) => {
    if (saved.has(sid)) return;
    const os = old.scenes.find((x) => x.id === sid);
    const at = nd.scenes.findIndex((x) => x.id === sid);
    if (!os || at < 0) return;
    nd.scenes[at] = os;
    nd.lines = nd.lines.filter((l) => l.sceneId !== sid).concat(old.lines.filter((l) => l.sceneId === sid));
    nd.dirtyScenes.add(sid);
    nd.dirty = true;
  });
  if (old.epDirty) { ['title', 'titleEn', 'beats', 'cta', 'comedy_story', 'product_ending', 'endingVars'].forEach((k) => { nd[k] = old[k]; }); nd.epDirty = true; }
  return nd;
}
