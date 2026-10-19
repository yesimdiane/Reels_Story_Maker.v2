// Pure helper (no DOM): turns the text Coupang puts on the clipboard when an operator taps "공유" ("<상품명>\n<링크>") into form values.
// Nothing is fetched: the operator's own copied text is the source. Only coupang.com links are accepted.
const URL_RE = /https?:\/\/[^\s<>"']+/i;
const HOSTS = new Set(['link.coupang.com', 'www.coupang.com', 'm.coupang.com', 'coupang.com']);

export function parseCoupangShare(text) {
  const out = { name: '', url: '', productNumber: '', itemNumber: '' };
  const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  const m = URL_RE.exec(raw);
  if (!m) return out;
  let u;
  try { u = new URL(m[0].replace(/[),.;]+$/, '')); } catch { return out; }
  if (u.username || u.password || !HOSTS.has(u.hostname.toLowerCase())) return out;
  out.url = u.toString();
  const pn = /\/(?:vp|vm)\/products\/(\d{5,20})/.exec(u.pathname);
  if (pn) out.productNumber = pn[1];
  const it = u.searchParams.get('itemId') || u.searchParams.get('vendorItemId') || '';
  if (/^\d{5,20}$/.test(it)) out.itemNumber = it;
  out.name = (raw.slice(0, m.index) + ' ' + raw.slice(m.index + m[0].length)).split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 200);
  return out;
}
