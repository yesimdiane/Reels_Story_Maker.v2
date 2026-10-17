// Tiny DOM helpers: h(), icons, toast, modal, confirm, copy.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  kids.flat(Infinity).forEach((c) => {
    if (c == null || c === false) return;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return el;
}

const P = {
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>',
  episodes: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5v4M13 5v4M18 5v4"/>',
  script: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  storyboard: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="6" rx="1.5"/><path d="M14 17h7"/>',
  animation: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  render: '<path d="M4 7h16v10H4zM8 7v10M16 7v10M4 12h16"/>',
  publishing: '<path d="M4 12l16-8-6 16-3-7z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  products: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>',
  storylab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M8 15h8"/>',
  review: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

export function toast(message, { error = false, recovery = '', ms } = {}) {
  const t = h('div', { class: 'toast' + (error ? ' err' : ''), role: error ? 'alert' : 'status' }, h('div', null, message), recovery && h('div', { class: 'fix' }, '→ ' + recovery));
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms || (error ? 9000 : 3200));
}

export function modal(build, { wide = false } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => back.remove();
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
  const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && close() }, box);
  box.append(build(close));
  root.append(back);
  const first = box.querySelector('input,textarea,select,button');
  if (first) first.focus();
  const esc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  return close;
}

export function confirmDialog({ title, body, confirm = '확인', cancel = '취소', tone = 'sage' }) {
  return new Promise((resolve) => {
    modal((close) => h('div', { class: 'stack' },
      h('h2', null, title),
      typeof body === 'string' ? h('p', { class: 'muted', style: 'margin:0' }, body) : body,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { close(); resolve(false); } }, cancel),
        h('button', { class: 'btn ' + tone, onclick: () => { close(); resolve(true); } }, confirm))));
  });
}

export async function copyText(text, label = '복사했습니다') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

export const fmtUsd = (n) => (n == null ? '—' : '$' + (Math.round(n * 10000) / 10000).toString());
export const fmtSec = (n) => (n == null ? '—' : (Math.round(n * 10) / 10) + '초');
export const stateLabel = { done: '완료', current: '지금 할 일', todo: '대기', blocked: '잠김', attention: '확인 필요', processing: '진행 중' };

export function chip(text, kind = '') {
  return h('span', { class: 'chip ' + kind }, kind === 'processing' ? h('span', { class: 'dot' }) : null, text);
}
