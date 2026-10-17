// Adds a small English subtitle under every button (Korean label stays the main text).
// Runs on a MutationObserver so buttons created by any view/modal get one without per-view code.
import { enFor } from './bilingual-dict.js';

const SEL = 'button, a.btn, [role="button"].btn';
const unknown = new Set();
export const unknownLabels = () => [...unknown];

function labelOf(el) {
  let t = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) t += n.textContent;
    else if (n.nodeType === 1 && !n.classList.contains('btn-en') && !n.classList.contains('kebab-hint') && !(n instanceof SVGElement) && !n.querySelector('svg')) t += n.textContent;
  });
  return t.replace(/\s+/g, ' ').trim();
}

function decorate(el) {
  if (el.querySelector(':scope > .btn-en')) return;
  if (el.closest('[data-no-en]')) return;
  const label = labelOf(el);
  if (!label || !/[가-힣]/.test(label)) return;
  const en = enFor(label);
  if (!en) { unknown.add(label); return; }
  const main = document.createElement('span');
  main.className = 'btn-main';
  while (el.firstChild) main.append(el.firstChild);
  const sub = document.createElement('span');
  sub.className = 'btn-en';
  sub.setAttribute('aria-hidden', 'true');
  sub.textContent = en;
  el.append(main, sub);
  el.classList.add('has-en');
  if (!el.title && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label + ' (' + en + ')');
}

export function decorateAll(root = document.body) {
  if (root.nodeType !== 1) return;
  if (root.matches && root.matches(SEL)) decorate(root);
  root.querySelectorAll(SEL).forEach(decorate);
}

export function startBilingual(onDone) {
  let queued = false;
  const run = () => { queued = false; observer.disconnect(); try { decorateAll(); } finally { observer.observe(document.body, { childList: true, subtree: true, characterData: true }); if (onDone) onDone(); } };
  const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  run();
}
