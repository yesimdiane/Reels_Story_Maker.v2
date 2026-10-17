// Drag handle for scene cards: pointer-based (mouse AND touch), keyboard accessible (↑ / ↓ on the focused handle).
// It only reports "move scene X to position N"; the order is planned by scene-order-core.js and saved by the reorder endpoint.
import { h } from '../ui.js';
import { dropIndex } from '../scene-order-core.js';

/** Visually hidden live region for screen readers ("S3 moved to position 2"). */
export function announce(text) {
  let el = document.getElementById('rf-live');
  if (!el) { el = h('div', { id: 'rf-live', role: 'status', 'aria-live': 'polite', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' }); document.body.append(el); }
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

/**
 * handle: the grip button; card: the scene card; ctx.moveScene(sid, ±1) / ctx.dropScene(sid, index).
 * Cards of the same list carry data-scene-card; locked cards (fixed ending) carry data-scene-locked and are not drop targets.
 */
export function attachSceneDrag(handle, card, sid, ctx) {
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); ctx.moveScene(sid, e.key === 'ArrowUp' ? -1 : 1); }
  });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const list = card.parentElement;
    const cards = () => Array.from(list.querySelectorAll('[data-scene-card]')).filter((c) => !c.hasAttribute('data-scene-locked') && c !== card);
    const line = h('div', { class: 'scene-drop-line', 'aria-hidden': 'true' });
    let index = null;
    card.classList.add('scene-dragging');
    document.body.classList.add('scene-dragging-body');
    handle.setPointerCapture(e.pointerId);
    const place = (y) => {
      const others = cards();
      const centres = others.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
      index = dropIndex(centres, y);
      const ref = others[index];
      if (ref) ref.before(line); else if (others.length) others[others.length - 1].after(line);
      line.dataset.index = String(index);
    };
    const edge = (y) => { if (y < 80) window.scrollBy(0, -18); else if (y > innerHeight - 80) window.scrollBy(0, 18); };
    const move = (ev) => { edge(ev.clientY); place(ev.clientY); };
    const finish = (commit) => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', esc);
      card.classList.remove('scene-dragging'); document.body.classList.remove('scene-dragging-body'); line.remove();
      if (commit && index !== null) ctx.dropScene(sid, index);
    };
    const up = () => finish(true); const cancel = () => finish(false);
    const esc = (ev) => { if (ev.key === 'Escape') finish(false); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', esc);
    place(e.clientY);
  });
}
