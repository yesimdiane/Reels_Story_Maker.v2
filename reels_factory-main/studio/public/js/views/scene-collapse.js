// Which approved scenes the operator has folded into a compact summary. Presentation only: it never touches approval data.
// Remembered per episode in the browser (survives refresh); storage may be unavailable, so every access is guarded.
const key = (epId) => 'rf.collapsed.' + epId;
function load(epId) { try { return new Set(JSON.parse(localStorage.getItem(key(epId)) || '[]')); } catch (_) { return new Set(); } }
export const isCollapsed = (epId, sid) => load(epId).has(sid);
export function setCollapsed(epId, sid, on) {
  const s = load(epId); if (on) s.add(sid); else s.delete(sid);
  try { localStorage.setItem(key(epId), JSON.stringify(Array.from(s))); } catch (_) { /* private mode: collapse lasts until reload */ memory.set(epId + sid, on); }
}
const memory = new Map();
export const collapsedNow = (epId, sid) => (memory.has(epId + sid) ? memory.get(epId + sid) : isCollapsed(epId, sid));
