// Pure scene-order planning for drag-and-drop / keyboard reordering. No DOM. The payload matches the existing reorder endpoint:
//   formula episodes: { beats: { setup: [ids], ... } } (Part A only — the fixed ending is never movable, every beat keeps a scene)
//   other episodes:   { order: [ids] }
// Scene IDs never change; only the order (and, in the formula, the beat a scene is placed in) does.
const BEAT_ORDER = ['setup', 'problem', 'absurd_escalation', 'unexpected_twist', 'resolution', 'product_bridge'];

export const movable = (ep) => (ep.formula && ep.formula.structured ? ep.scenes.filter((s) => s.part !== 'B') : ep.scenes);
export const canMove = (ep, id) => movable(ep).some((s) => s.id === id) && movable(ep).length > 1;

/** toIndex = position the scene should have in the list of movable scenes after the move. */
export function planReorder(ep, id, toIndex) {
  const mv = movable(ep);
  const from = mv.findIndex((s) => s.id === id);
  if (from < 0) return { error: { code: 'LOCKED', message: '고정 엔딩 컷은 옮길 수 없습니다.' } };
  const to = Math.max(0, Math.min(mv.length - 1, toIndex));
  if (to === from) return { noop: true };
  const list = mv.map((s) => s.id).filter((x) => x !== id);
  list.splice(to, 0, id);
  if (!(ep.formula && ep.formula.structured)) return { body: { order: list }, order: list };
  const beatOf = Object.fromEntries(mv.map((s) => [s.id, s.beatKey]));
  // The moved scene keeps its beat while it stays next to that beat; between two other beats it joins the one it moved towards.
  const prev = beatOf[list[to - 1]]; const next = beatOf[list[to + 1]];
  const src = beatOf[id];
  beatOf[id] = prev === src || next === src ? src : (to > from ? prev : next) || prev || next;
  const beats = Object.fromEntries(BEAT_ORDER.map((k) => [k, []]));
  list.forEach((sid) => beats[beatOf[sid]].push(sid));
  const empty = BEAT_ORDER.filter((k) => !beats[k].length);
  if (empty.length) return { error: { code: 'BEAT_EMPTY', message: `각 단계에는 최소 한 장면이 필요합니다. 이 씬은 "${src}" 단계의 유일한 장면이라 옮길 수 없습니다.` } };
  return { body: { beats }, order: list, beat: beatOf[id], beatChanged: beatOf[id] !== src };
}

/** One step up (-1) or down (+1). */
export function planStep(ep, id, delta) {
  const i = movable(ep).findIndex((s) => s.id === id);
  if (i < 0) return { error: { code: 'LOCKED', message: '고정 엔딩 컷은 옮길 수 없습니다.' } };
  return planReorder(ep, id, i + delta);
}

/** Index in the movable list for a pointer at `y`, given the other cards' vertical centres in order (the moving card excluded). */
export function dropIndex(centres, y) {
  const i = centres.findIndex((c) => y < c);
  return i < 0 ? centres.length : i;
}
