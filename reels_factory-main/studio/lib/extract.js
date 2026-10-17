// Compliant product-page extraction.
//   * server-side only, http(s) only, public IPs only (SSRF guard, DNS-pinned), ≤3 redirects (each re-validated)
//   * honest User-Agent, robots.txt respected, hard time and size caps
//   * NO login/anti-bot bypass: a block / captcha / empty page is reported as "blocked" and the Studio falls back to manual entry
//   * only facts that are literally on the page are returned (title, description, JSON-LD, og:image …). Prices, discounts, ratings and
//     "selling points" are never extracted or invented; extracted specs are marked unverified until the operator confirms them.
'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { StudioError } = require('./util');

const UA = 'ReelsFactoryStudio/2.3 (product-research; operator-initiated; respects robots.txt)';
const MAX_HTML = 1.5 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const TIMEOUT_MS = 9000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}

function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new StudioError('BAD_URL', 'URL 형식이 올바르지 않습니다.', { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new StudioError('BAD_URL', 'http(s) 주소만 사용할 수 있습니다.', { status: 400 });
  if (u.username || u.password) throw new StudioError('BAD_URL', '아이디/비밀번호가 포함된 주소는 사용할 수 없습니다.', { status: 400 });
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (![80, 443].includes(port)) throw new StudioError('BAD_URL', '80/443 이외의 포트는 사용할 수 없습니다.', { status: 400 });
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ''))) throw new StudioError('BLOCKED_HOST', '내부 네트워크 주소는 가져올 수 없습니다.', { status: 400 });
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new StudioError('BLOCKED_HOST', '내부 네트워크 주소는 가져올 수 없습니다.', { status: 400 });
  return u;
}

/** Real fetcher. The DNS lookup is performed by the socket itself and validated, so a rebinding attacker cannot swap the address. */
function createFetcher({ lookup = dns.lookup } = {}) {
  const safeLookup = (host, opts, cb) => lookup(host, { all: false, family: opts && opts.family }, (err, address, family) => {
    if (err) return cb(err);
    if (isPrivateIp(address)) return cb(Object.assign(new Error('내부 네트워크 주소는 가져올 수 없습니다.'), { code: 'BLOCKED_HOST' }));
    cb(null, address, family);
  });
  return function get(rawUrl, { maxBytes = MAX_HTML, accept = 'text/html,*/*;q=0.5', redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = parseUrl(rawUrl); } catch (e) { return reject(e); }
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(u, { method: 'GET', lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'user-agent': UA, accept, 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new StudioError('TOO_MANY_REDIRECTS', '리디렉션이 너무 많습니다.', { status: 502 }));
          let next;
          try { next = new URL(res.headers.location, u).toString(); } catch { return reject(new StudioError('BAD_URL', '잘못된 리디렉션 주소입니다.', { status: 502 })); }
          return get(next, { maxBytes, accept, redirects: redirects - 1 }).then(resolve, reject);
        }
        const chunks = [];
        let n = 0;
        res.on('data', (c) => {
          n += c.length;
          if (n > maxBytes) { req.destroy(new StudioError('TOO_LARGE', '응답이 너무 큽니다.', { status: 502 })); return; }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: u.toString() }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new StudioError('TIMEOUT', '응답 시간이 초과되었습니다.', { status: 504 })));
      req.on('error', (e) => reject(e instanceof StudioError ? e : new StudioError(e.code === 'BLOCKED_HOST' ? 'BLOCKED_HOST' : 'FETCH_FAILED', e.code === 'BLOCKED_HOST' ? e.message : '페이지를 가져오지 못했습니다: ' + e.message, { status: 502 })));
      req.end();
    });
  };
}

// ---------- robots.txt ----------
function parseRobots(text, agent = 'reelsfactorystudio') {
  const groups = [];
  let cur = null;
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) return;
    const k = m[1].toLowerCase();
    if (k === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(m[2].toLowerCase());
    } else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push({ allow: k === 'allow', path: m[2] });
  });
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const use = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = use.flatMap((g) => g.rules).filter((r) => r.path);
  return function allowed(pathname) {
    let best = null;
    rules.forEach((r) => {
      const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
      if (re.test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    });
    return !best || best.allow;
  };
}

async function robotsAllows(fetcher, url) {
  const u = new URL(url);
  let r;
  try { r = await fetcher(u.origin + '/robots.txt', { maxBytes: 300 * 1024, accept: 'text/plain,*/*' }); } catch (e) {
    if (e.code === 'BLOCKED_HOST') throw e;
    return { allowed: true, note: 'robots.txt를 가져오지 못해 제한 없음으로 처리' };
  }
  if (r.status >= 500) return { allowed: false, note: 'robots.txt 서버 오류(5xx) — 안전하게 가져오지 않습니다' };
  if (r.status >= 400) return { allowed: true, note: 'robots.txt 없음' };
  const ok = parseRobots(r.body.toString('utf8'))(u.pathname + u.search);
  return { allowed: ok, note: ok ? 'robots.txt 허용' : 'robots.txt가 이 페이지의 자동 수집을 허용하지 않습니다' };
}

// ---------- HTML parsing ----------
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();

function metaContent(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = re.exec(html);
  if (!tag) return '';
  const c = /content=["']([^"']*)["']/i.exec(tag[0]);
  return c ? decode(c[1]) : '';
}
function allMeta(html, key) {
  const out = [];
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'gi');
  let m;
  while ((m = re.exec(html))) { const c = /content=["']([^"']*)["']/i.exec(m[0]); if (c) out.push(decode(c[1])); }
  return out;
}

const BLOCK_PATTERNS = /(access denied|captcha|robot check|are you a robot|verify you are human|unusual traffic|차단|접근이 거부|비정상적인 접근|보안 문자|자동 입력 방지)/i;

function detectBlock(res) {
  if (!res) return 'no-response';
  if ([401, 403, 407, 429, 451].includes(res.status)) return 'http-' + res.status;
  if (res.status >= 500) return 'http-' + res.status;
  if (res.status >= 400) return 'http-' + res.status;
  const text = res.body.toString('utf8');
  if (text.length < 400 && BLOCK_PATTERNS.test(text)) return 'block-page';
  if (BLOCK_PATTERNS.test(text.slice(0, 4000)) && !/<meta[^>]+og:title/i.test(text)) return 'block-page';
  return '';
}

function jsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        const t = [].concat(n['@type'] || []).map(String);
        if (t.includes('Product')) out.push(n);
        if (n['@graph']) walk(n['@graph']);
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore malformed JSON-LD */ }
  }
  return out;
}

function parseProductHtml(html, baseUrl) {
  const abs = (u) => { try { return new URL(decode(u), baseUrl).toString(); } catch { return ''; } };
  const ld = jsonLdProducts(html)[0] || {};
  const title = decode(ld.name) || metaContent(html, 'og:title') || decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ''])[1]);
  const description = decode(ld.description) || metaContent(html, 'og:description') || metaContent(html, 'description');
  const imgs = []
    .concat(allMeta(html, 'og:image'))
    .concat([].concat(ld.image || []).map((i) => (typeof i === 'string' ? i : i && i.url)))
    .filter(Boolean)
    .map(abs)
    .filter((u) => /^https?:/i.test(u));
  const specs = [];
  [].concat(ld.additionalProperty || []).forEach((p) => p && p.name && p.value != null && specs.push(`${decode(p.name)}: ${decode(String(p.value))}`));
  if (ld.brand && (ld.brand.name || typeof ld.brand === 'string')) specs.push('브랜드: ' + decode(ld.brand.name || ld.brand));
  if (ld.color) specs.push('색상: ' + decode(ld.color));
  if (ld.material) specs.push('소재: ' + decode(ld.material));
  return { title, description, images: Array.from(new Set(imgs)).slice(0, 12), specs };
}

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { mime: 'image/png', ext: '.png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

/** Returns { status:'ok'|'blocked'|'failed', reason, note, data:{title,description,images,specs}, sourceUrl } — never throws for page-level problems. */
async function extractProduct(rawUrl, { fetcher = createFetcher() } = {}) {
  const u = parseUrl(rawUrl);
  let robots;
  try { robots = await robotsAllows(fetcher, u.toString()); } catch (e) {
    return { status: 'failed', reason: e.code || 'ERROR', note: e.message, data: null, sourceUrl: u.toString() };
  }
  if (!robots.allowed) return { status: 'blocked', reason: 'robots', note: robots.note + ' — 직접 입력하거나 이미지를 업로드하세요.', data: null, sourceUrl: u.toString() };
  let res;
  try { res = await fetcher(u.toString()); } catch (e) {
    return { status: 'failed', reason: e.code || 'FETCH_FAILED', note: e.message + ' — 직접 입력으로 계속할 수 있습니다.', data: null, sourceUrl: u.toString() };
  }
  const block = detectBlock(res);
  if (block) return { status: 'blocked', reason: block, note: '쇼핑몰이 자동 수집을 막았습니다 (' + block + '). 우회하지 않습니다 — 상품 정보를 직접 입력하고 이미지를 업로드하세요.', data: null, sourceUrl: u.toString() };
  const data = parseProductHtml(res.body.toString('utf8'), res.finalUrl);
  if (!data.title && !data.images.length) return { status: 'blocked', reason: 'empty', note: '페이지에서 상품 정보를 찾지 못했습니다(동적 페이지이거나 차단됨). 직접 입력하세요.', data: null, sourceUrl: u.toString() };
  return { status: 'ok', reason: '', note: robots.note + '. 추출된 값은 "미확인" 상태이며 운영자가 확인해야 사용됩니다.', data, sourceUrl: res.finalUrl };
}

async function downloadImage(url, { fetcher = createFetcher() } = {}) {
  const res = await fetcher(url, { maxBytes: MAX_IMAGE, accept: 'image/*' });
  if (res.status !== 200) throw new StudioError('IMAGE_FETCH', `이미지를 가져오지 못했습니다 (HTTP ${res.status}).`, { status: 502 });
  const kind = sniffImage(res.body);
  if (!kind) throw new StudioError('BAD_TYPE', 'PNG/JPG/WEBP 이미지가 아닙니다.', { status: 415 });
  return Object.assign({ buffer: res.body }, kind);
}

/** Pixel size read from the file header (no decoding). null when the header cannot be parsed. */
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
      let p = 2;
      while (p + 9 < buf.length) {
        if (buf[p] !== 0xff) { p++; continue; }
        const m = buf[p + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
        const len = buf.readUInt16BE(p + 2);
        if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
        p += 2 + len;
      }
      return null;
    }
    if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      const t = buf.toString('latin1', 12, 16);
      if (t === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (t === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
  } catch (_) { /* fall through */ }
  return null;
}

module.exports = { imageSize, extractProduct, downloadImage, createFetcher, parseProductHtml, parseRobots, robotsAllows, detectBlock, isPrivateIp, parseUrl, sniffImage, UA };
