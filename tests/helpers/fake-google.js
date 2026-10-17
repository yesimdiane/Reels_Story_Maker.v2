// In-memory fake of the Google services the Studio talks to: OAuth token endpoint (refresh / authorization-code+PKCE / JWT bearer),
// OpenID JWKS, Sheets v4 (tabs, A1 ranges, RAW values, 50k cell limit) and Drive v3 (folders, queries, resumable upload with
// 256 KiB chunk rules, md5, media download). Used by CI. It is a MOCK: tests built on it prove our logic, not Google's behaviour
// (see tests/integration/google-real.test.js for the opt-in real-service checks).
'use strict';
const crypto = require('node:crypto');

const colNum = (s) => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

function parseA1(a1) {
  let m;
  if ((m = /^([A-Z]+)(\d*):([A-Z]+)(\d*)$/.exec(a1))) return { c1: colNum(m[1]), r1: m[2] ? Number(m[2]) : 1, c2: colNum(m[3]), r2: m[4] ? Number(m[4]) : Infinity };
  if ((m = /^(\d+):(\d+)$/.exec(a1))) return { c1: 1, r1: Number(m[1]), c2: Infinity, r2: Number(m[2]) };
  if ((m = /^([A-Z]+)(\d+)$/.exec(a1))) return { c1: colNum(m[1]), r1: Number(m[2]), c2: colNum(m[1]), r2: Number(m[2]) };
  throw new Error('fake: unsupported A1 ' + a1);
}
function parseRange(r) {
  const m = /^'((?:[^']|'')+)'!(.+)$/.exec(r);
  if (!m) throw new Error('fake: unsupported range ' + r);
  return { tab: m[1].replace(/''/g, "'"), ...parseA1(m[2]) };
}

class FakeGoogle {
  constructor({ keepSeed = false } = {}) {
    this.clientId = 'test-client.apps.googleusercontent.com';
    this.clientSecret = 'test-client-secret-value';
    this.refreshToken = 'test-refresh-token-value';
    this.redirectUris = new Set(['https://studio.example.com/auth/google/callback']);
    this.tokenTtlSec = 3600;
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.signing = { kid: 'kid-1', privateKey: kp.privateKey, jwk: Object.assign(kp.publicKey.export({ format: 'jwk' }), { kid: 'kid-1', alg: 'RS256', use: 'sig' }) };
    this.wrongKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    this.serviceAccounts = new Map(); // email -> public key pem
    this.accessTokens = new Map(); // token -> expiry ms
    this.codes = new Map();
    this.spreadsheets = new Map();
    this.files = new Map();
    this.sessions = new Map();
    this.requests = [];
    this.fault = null; // (req, n) => status number | undefined
    this.idTokenMutator = null; // (claims, header) => void ; tweak or break the next ID token
    this.signWithWrongKey = false;
    this.corruptNextUpload = false;
    this.driveScope = 'file'; // 'file': only files the app created are visible (like the drive.file scope); 'full': everything
    this.now = () => Date.now();
    this.seq = 0;
    this.fetch = this.fetch.bind(this);
  }

  // ---------- test helpers ----------
  addSpreadsheet(id, tabs = {}) {
    const m = new Map();
    Object.entries(tabs).forEach(([name, rows], i) => m.set(name, { id: 100 + i, rows: rows.map((r) => r.slice()), cols: 26 }));
    this.spreadsheets.set(id, m);
    return id;
  }
  rows(id, tab) { const t = this.spreadsheets.get(id).get(tab); return t ? t.rows.map((r) => r.slice()) : null; }
  editCell(id, tab, row, col, value) { const t = this.spreadsheets.get(id).get(tab); (t.rows[row - 1] = t.rows[row - 1] || [])[col - 1] = value; }
  seedDriveFile({ name, bytes = 'x', mimeType = 'application/octet-stream', parents = [] }) {
    const id = this.newId('seed'); const b = Buffer.from(bytes);
    this.files.set(id, { id, name, mimeType, parents, bytes: b, appProperties: {}, trashed: false, createdTime: new Date(this.now()).toISOString(), createdByApp: false });
    return id;
  }
  driveFiles() { return [...this.files.values()]; }
  count(re) { return this.requests.filter((r) => re.test(r.method + ' ' + r.url)).length; }
  newId(p = 'id') { this.seq += 1; return `${p}${String(this.seq).padStart(6, '0')}${crypto.randomBytes(6).toString('hex')}`; }
  registerServiceAccount(email, publicKeyPem) { this.serviceAccounts.set(email, publicKeyPem); }
  /** Simulates the user consenting at Google: returns the redirect URL (code + state) for an authorization URL. */
  authorize(authUrl, { email, sub, name = 'Test User', emailVerified = true } = {}) {
    const u = new URL(authUrl);
    const p = u.searchParams;
    if (p.get('client_id') !== this.clientId) throw new Error('fake: bad client_id');
    if (!this.redirectUris.has(p.get('redirect_uri'))) throw new Error('fake: redirect_uri not registered');
    const code = this.newId('code');
    this.codes.set(code, { nonce: p.get('nonce'), challenge: p.get('code_challenge'), redirectUri: p.get('redirect_uri'), email, sub: sub || 'sub-' + email, name, emailVerified });
    return p.get('redirect_uri') + '?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(p.get('state'));
  }

  // ---------- plumbing ----------
  res(status, body, headers = {}) {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    return new Response(status === 204 ? null : isStr ? body : JSON.stringify(body === undefined ? {} : body), { status, headers: Object.assign(isStr ? {} : { 'content-type': 'application/json' }, headers) });
  }
  err(status, message, reason = '') { return this.res(status, { error: { code: status, message, errors: reason ? [{ reason }] : [], status: reason } }); }
  signJwt(claims, header = {}) {
    const h = Object.assign({ alg: 'RS256', typ: 'JWT', kid: this.signing.kid }, header);
    if (this.idTokenMutator) this.idTokenMutator(claims, h);
    const data = Buffer.from(JSON.stringify(h)).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = h.alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(data), this.signWithWrongKey ? this.wrongKey : this.signing.privateKey).toString('base64url');
    return data + '.' + sig;
  }
  mintToken() {
    const t = 'ya29.' + crypto.randomBytes(16).toString('hex');
    this.accessTokens.set(t, this.now() + this.tokenTtlSec * 1000);
    return t;
  }
  authed(headers) {
    const m = /^Bearer (\S+)$/.exec(headers.authorization || headers.Authorization || '');
    return !!m && (this.accessTokens.get(m[1]) || 0) > this.now();
  }

  async fetch(input, init = {}) {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    Object.entries(init.headers || {}).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    const req = { method, url, headers, body: init.body };
    this.requests.push({ method, url, headers });
    const injected = this.fault && this.fault(req, this.requests.length);
    if (injected) return typeof injected === 'number' ? this.err(injected, 'injected fault', injected === 429 ? 'rateLimitExceeded' : 'backendError') : injected;
    const u = new URL(url);
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') return this.token(req);
    if (u.host === 'www.googleapis.com' && u.pathname === '/oauth2/v3/certs') return this.res(200, { keys: [this.signing.jwk] }, { 'cache-control': 'public, max-age=3600' });
    if (!this.authed(headers) && u.host !== 'upload.fake') return this.err(401, 'Invalid Credentials', 'authError');
    if (u.host === 'sheets.googleapis.com') return this.sheetsApi(req, u);
    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/drive/v3/files')) return this.driveApi(req, u);
    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/upload/drive/v3/files')) return this.uploadInit(req, u);
    if (u.host === 'upload.fake') return this.uploadPut(req, u);
    return this.err(404, 'fake: no route for ' + method + ' ' + url);
  }

  // ---------- OAuth ----------
  token(req) {
    const f = Object.fromEntries(new URLSearchParams(String(req.body)));
    const bad = (error, status = 400) => this.res(status, { error, error_description: error });
    if (f.grant_type === 'refresh_token') {
      if (f.client_id !== this.clientId || f.client_secret !== this.clientSecret) return bad('invalid_client', 401);
      if (f.refresh_token !== this.refreshToken) return bad('invalid_grant');
      return this.res(200, { access_token: this.mintToken(), expires_in: this.tokenTtlSec, token_type: 'Bearer' });
    }
    if (f.grant_type === 'authorization_code') {
      if (f.client_id !== this.clientId || f.client_secret !== this.clientSecret) return bad('invalid_client', 401);
      const c = this.codes.get(f.code);
      this.codes.delete(f.code); // single use
      if (!c || c.redirectUri !== f.redirect_uri) return bad('invalid_grant');
      if (crypto.createHash('sha256').update(String(f.code_verifier || '')).digest('base64url') !== c.challenge) return bad('invalid_grant');
      const iat = Math.floor(this.now() / 1000);
      const claims = { iss: 'https://accounts.google.com', aud: this.clientId, azp: this.clientId, sub: c.sub, email: c.email, email_verified: c.emailVerified, name: c.name, nonce: c.nonce, iat, exp: iat + 3600 };
      return this.res(200, { access_token: this.mintToken(), expires_in: 3600, id_token: this.signJwt(claims), token_type: 'Bearer' });
    }
    if (f.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      const [h, c, s] = String(f.assertion).split('.');
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      const pem = this.serviceAccounts.get(claims.iss);
      if (!pem || !crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), pem, Buffer.from(s, 'base64url'))) return bad('invalid_grant');
      return this.res(200, { access_token: this.mintToken(), expires_in: this.tokenTtlSec, token_type: 'Bearer' });
    }
    return bad('unsupported_grant_type');
  }

  // ---------- Sheets ----------
  sheetsApi(req, u) {
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(u.pathname);
    const id = decodeURIComponent(m[1]);
    const sp = this.spreadsheets.get(id);
    if (!sp) return this.err(404, 'Requested entity was not found.', 'notFound');
    const rest = decodeURIComponent(m[2]);
    const json = () => JSON.parse(String(req.body || '{}'));
    if (req.method === 'GET' && rest === '') return this.res(200, { sheets: [...sp].map(([title, t]) => ({ properties: { sheetId: t.id, title, gridProperties: { rowCount: t.rows.length, columnCount: t.cols } } })) });
    if (req.method === 'POST' && rest === ':batchUpdate') {
      const replies = [];
      for (const r of json().requests) {
        if (r.addSheet) {
          const title = r.addSheet.properties.title;
          if (sp.has(title)) return this.err(400, `A sheet with the name "${title}" already exists. Please enter another name.`, 'badRequest');
          const t = { id: 1000 + sp.size, rows: [], cols: (r.addSheet.properties.gridProperties || {}).columnCount || 26 };
          sp.set(title, t);
          replies.push({ addSheet: { properties: { sheetId: t.id, title } } });
        } else return this.err(400, 'fake: unsupported batchUpdate request');
      }
      return this.res(200, { replies });
    }
    if (req.method === 'GET' && rest === '/values:batchGet') {
      const ranges = u.searchParams.getAll('ranges');
      return this.res(200, { valueRanges: ranges.map((r) => { const a = this.read(sp, r); if (a.error) return a; return { range: r, majorDimension: 'ROWS', values: a.values }; }) });
    }
    if (req.method === 'POST' && rest === '/values:batchUpdate') {
      const b = json();
      for (const d of b.data) { const e = this.write(sp, d.range, d.values); if (e) return e; }
      return this.res(200, { totalUpdatedCells: b.data.reduce((n, d) => n + d.values.flat().length, 0) });
    }
    const am = /^\/values\/(.+):append$/.exec(rest);
    if (req.method === 'POST' && am) {
      const r = parseRange(am[1]);
      const t = sp.get(r.tab);
      if (!t) return this.err(400, 'Unable to parse range: ' + am[1], 'badRequest');
      const rows = json().values;
      for (const row of rows) for (const c of row) if (typeof c === 'string' && c.length > 50000) return this.err(400, 'Your input contains more than the maximum of 50000 characters in a single cell.', 'badRequest');
      let last = t.rows.length;
      while (last > 0 && !(t.rows[last - 1] || []).some((c) => c !== '' && c !== undefined)) last -= 1;
      const first = last + 1;
      rows.forEach((row, i) => { t.rows[last + i] = row.slice(); });
      const width = Math.max(...rows.map((x) => x.length));
      return this.res(200, { updates: { updatedRange: `'${r.tab}'!A${first}:${colName(width)}${first + rows.length - 1}`, updatedRows: rows.length } });
    }
    return this.err(400, 'fake: unsupported sheets request ' + req.method + ' ' + rest);
  }
  read(sp, range) {
    let r;
    try { r = parseRange(range); } catch (e) { return { error: { code: 400, message: e.message } }; }
    const t = sp.get(r.tab);
    if (!t) return { error: { code: 400, message: 'Unable to parse range: ' + range } };
    let end = Math.min(r.r2, t.rows.length);
    const values = [];
    for (let i = r.r1; i <= end; i += 1) {
      const row = (t.rows[i - 1] || []).slice(r.c1 - 1, r.c2 === Infinity ? undefined : r.c2);
      while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === undefined)) row.pop();
      values.push(row);
    }
    while (values.length && !values[values.length - 1].length) values.pop();
    return { values };
  }
  write(sp, range, values) {
    const r = parseRange(range);
    const t = sp.get(r.tab);
    if (!t) return this.err(400, 'Unable to parse range: ' + range, 'badRequest');
    for (const row of values) for (const c of row) if (typeof c === 'string' && c.length > 50000) return this.err(400, 'Your input contains more than the maximum of 50000 characters in a single cell.', 'badRequest');
    values.forEach((row, i) => { const rr = (t.rows[r.r1 - 1 + i] = t.rows[r.r1 - 1 + i] || []); row.forEach((c, j) => { rr[r.c1 - 1 + j] = c; }); });
    return null;
  }

  // ---------- Drive ----------
  visible(f) { return this.driveScope === 'full' || f.createdByApp; }
  meta(f, fields) {
    const all = { id: f.id, name: f.name, mimeType: f.mimeType, size: f.bytes ? String(f.bytes.length) : undefined, md5Checksum: f.bytes ? crypto.createHash('md5').update(f.bytes).digest('hex') : undefined, parents: f.parents, trashed: f.trashed, appProperties: f.appProperties, createdTime: f.createdTime, modifiedTime: f.createdTime, webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view' };
    if (!fields) return all;
    const want = new Set(String(fields).replace(/files\(|\)/g, '').split(',').map((s) => s.trim()));
    return Object.fromEntries(Object.entries(all).filter(([k]) => want.has(k)));
  }
  match(f, q) {
    const preds = [];
    let rest = q;
    const take = (re, fn) => { rest = rest.replace(re, (...a) => { preds.push(fn(a)); return ''; }); };
    take(/appProperties has \{ key='((?:[^'\\]|\\.)*)' and value='((?:[^'\\]|\\.)*)' \}/, (a) => (x) => (x.appProperties || {})[a[1].replace(/\\(.)/g, '$1')] === a[2].replace(/\\(.)/g, '$1'));
    take(/name = '((?:[^'\\]|\\.)*)'/, (a) => (x) => x.name === a[1].replace(/\\(.)/g, '$1'));
    take(/'((?:[^'\\]|\\.)*)' in parents/, (a) => (x) => (x.parents || []).includes(a[1].replace(/\\(.)/g, '$1')));
    take(/mimeType = '([^']*)'/, (a) => (x) => x.mimeType === a[1]);
    take(/trashed = false/, () => (x) => !x.trashed);
    if (rest.replace(/\s*and\s*/g, '').trim()) throw new Error('fake: unsupported Drive query remainder: ' + rest);
    return preds.every((p) => p(f));
  }
  driveApi(req, u) {
    const mm = /^\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
    const id = mm && mm[1] ? decodeURIComponent(mm[1]) : '';
    const fields = u.searchParams.get('fields');
    if (!id && req.method === 'GET') {
      const files = [...this.files.values()].filter((f) => this.visible(f) && this.match(f, u.searchParams.get('q') || 'trashed = false'));
      return this.res(200, { files: files.map((f) => this.meta(f, fields)) });
    }
    if (!id && req.method === 'POST') {
      const b = JSON.parse(String(req.body));
      const f = { id: this.newId('fld'), name: b.name, mimeType: b.mimeType, parents: b.parents || [], appProperties: b.appProperties || {}, trashed: false, createdTime: new Date(this.now()).toISOString(), createdByApp: true };
      this.files.set(f.id, f);
      return this.res(200, this.meta(f, fields));
    }
    const f = this.files.get(id);
    if (!f || !this.visible(f)) return this.err(404, 'File not found: ' + id + '.', 'notFound');
    if (req.method === 'GET' && u.searchParams.get('alt') === 'media') return this.res(200, f.bytes, { 'content-type': f.mimeType });
    if (req.method === 'GET') return this.res(200, this.meta(f, fields));
    if (req.method === 'PATCH') { const b = JSON.parse(String(req.body)); if (b.trashed !== undefined) f.trashed = !!b.trashed; return this.res(200, this.meta(f, 'id')); }
    return this.err(400, 'fake: unsupported drive request');
  }
  uploadInit(req) {
    const b = JSON.parse(String(req.body));
    const id = this.newId('sess');
    this.sessions.set(id, { meta: b, size: Number(req.headers['x-upload-content-length']), mime: req.headers['x-upload-content-type'], parts: [], got: 0, file: null });
    return this.res(200, {}, { location: 'https://upload.fake/' + id });
  }
  uploadPut(req, u) {
    const s = this.sessions.get(u.pathname.slice(1));
    if (!s) return this.err(404, 'session not found');
    const cr = String(req.headers['content-range'] || '');
    const finish = () => {
      if (!s.file) {
        let bytes = Buffer.concat(s.parts);
        if (this.corruptNextUpload) { this.corruptNextUpload = false; bytes = Buffer.from(bytes); bytes[0] ^= 0xff; }
        s.file = { id: this.newId('file'), name: s.meta.name, mimeType: s.meta.mimeType || s.mime, parents: s.meta.parents || [], appProperties: s.meta.appProperties || {}, bytes, trashed: false, createdTime: new Date(this.now()).toISOString(), createdByApp: true };
        this.files.set(s.file.id, s.file);
      }
      return this.res(200, this.meta(s.file));
    };
    if (/^bytes \*\//.test(cr)) return s.got === s.size ? finish() : this.res(308, '', s.got ? { range: 'bytes=0-' + (s.got - 1) } : {});
    const r = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!r || Number(r[3]) !== s.size || Number(r[1]) !== s.got || Number(r[2]) - Number(r[1]) + 1 !== buf.length) return this.err(400, 'bad range ' + cr);
    if (s.got + buf.length < s.size && buf.length % 262144 !== 0) return this.err(400, 'chunk must be a multiple of 256 KiB');
    s.parts.push(Buffer.from(buf));
    s.got += buf.length;
    return s.got === s.size ? finish() : this.res(308, '', { range: 'bytes=0-' + (s.got - 1) });
  }
}

module.exports = { FakeGoogle, colName };
