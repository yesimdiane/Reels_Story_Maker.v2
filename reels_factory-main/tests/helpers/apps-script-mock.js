// In-memory stand-ins for the Apps Script services the bundle uses. Not a test file itself.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const BUNDLE = path.join(__dirname, '..', '..', 'dist', 'ReelsFactory.gs');
const PRODUCT_HEADERS = ['상품ID', '상품명', '카테고리', '확인된 기능', '타깃', '쿠팡파트너스 URL', '영상 소스 URL', '영상 사용 허가 상태', '제작 상태'];

class MockSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((r) => r.slice());
    this.activeRow = 1;
    this.writes = 0;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((r) => (r || []).forEach((v, i) => { if (v !== '' && v != null) max = Math.max(max, i + 1); }));
    return max;
  }
  getRange(row, col, nr = 1, nc = 1) {
    const sheet = this;
    return {
      getRow: () => row,
      getNumRows: () => nr,
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => ((sheet.rows[row - 1 + i] || [])[col - 1 + j] ?? ''))),
      setValues(values) {
        sheet.writes++;
        values.forEach((vals, i) => {
          const r = (sheet.rows[row - 1 + i] = sheet.rows[row - 1 + i] || []);
          vals.forEach((v, j) => { r[col - 1 + j] = v; });
        });
        return this;
      },
      setFontWeight() { return this; },
      setNumberFormat() { return this; },
    };
  }
  getActiveRange() { return this.getRange(this.activeRow, 1, 1, 1); }
  setFrozenRows() {}
  // Test helper: row as { header: value }.
  record(rowNumber) {
    const out = {};
    this.rows[0].forEach((h, i) => { out[h] = (this.rows[rowNumber - 1] || [])[i] ?? ''; });
    return out;
  }
  set(rowNumber, header, value) {
    const col = this.rows[0].indexOf(header);
    if (col === -1) throw new Error('no header ' + header);
    this.rows[rowNumber - 1][col] = value;
  }
}


/** In-memory Google Drive: folders, files (with bytes), DriveApp-style iterators. IDs satisfy parseDriveFileId. */
function createDrive() {
  const nodes = {};
  let n = 0;
  const newId = () => 'DRIVEID' + String(++n).padStart(20, '0');
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const fileApi = (f) => ({
    getId: () => f.id, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.bytes.length,
    getLastUpdated: () => new Date(f.modified), getUrl: () => 'https://drive.google.com/file/d/' + f.id + '/view',
    getBlob: () => ({ getBytes: () => Array.from(f.bytes), getContentType: () => f.mime }),
    setTrashed: (v) => { f.trashed = !!v; return fileApi(f); },
  });
  const folderApi = (d) => ({
    getId: () => d.id, getName: () => d.name, getUrl: () => 'https://drive.google.com/drive/folders/' + d.id,
    getFoldersByName: (name) => iter(Object.values(nodes).filter((x) => x.kind === 'folder' && x.parent === d.id && x.name === name).map(folderApi)),
    createFolder: (name) => folderApi(addFolder(name, d.id)),
    getFiles: () => iter(Object.values(nodes).filter((x) => x.kind === 'file' && x.parent === d.id && !x.trashed).map(fileApi)),
    createFile: (blob) => fileApi(nodes[addFile(d.id, blob.getName(), Buffer.from(blob.getBytes().map((b) => b & 255)), blob.getContentType())]),
  });
  const addFolder = (name, parent = '') => (nodes[newId()] = { kind: 'folder', name, parent, id: undefined }, fixId(Object.keys(nodes).pop()));
  const fixId = (id) => { nodes[id].id = id; return nodes[id]; };
  const addFile = (parent, name, bytes, mime, modified) => {
    const id = newId();
    nodes[id] = { kind: 'file', id, name, parent, mime: mime || 'video/mp4', bytes: Buffer.from(bytes || 'x'), modified: modified || '2026-10-10T00:00:00.000Z' };
    return id;
  };
  // Drive REST (v3 metadata + resumable upload sessions), as the web app reaches it through UrlFetchApp.
  const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('hex');
  const sessions = {};
  const metaOf = (f) => ({ id: f.id, name: f.name, size: String(f.bytes.length), mimeType: f.mime, md5Checksum: md5(f.bytes), parents: f.parent ? [f.parent] : [], trashed: !!f.trashed });
  const toBuf = (p) => (Array.isArray(p) ? Buffer.from(p.map((b) => b & 255)) : Buffer.from(p || ''));
  return {
    nodes,
    sessions,
    md5,
    metaOf,
    toBuf,
    addFile,
    addImage: (name, mime = 'image/png') => addFile('', name, Buffer.from('fake-image-' + name), mime),
    folderByPath: (...names) => {
      let cur = Object.values(nodes).find((x) => x.kind === 'folder' && x.name === names[0] && !x.parent);
      for (const nm of names.slice(1)) cur = cur && Object.values(nodes).find((x) => x.kind === 'folder' && x.parent === cur.id && x.name === nm);
      return cur || null;
    },
    api: {
      getFileById: (id) => { const f = nodes[id]; if (!f || f.kind !== 'file') throw new Error('not found: ' + id); return fileApi(f); },
      getFolderById: (id) => { const f = nodes[id]; if (!f || f.kind !== 'folder') throw new Error('not found: ' + id); return folderApi(f); },
      getFoldersByName: (name) => iter(Object.values(nodes).filter((x) => x.kind === 'folder' && !x.parent && x.name === name).map(folderApi)),
      createFolder: (name) => folderApi(addFolder(name)),
    },
  };
}

/**
 * opts: { products: [[...row]], email, reviewers, gemini: payload | (n, body) => payload | Error, serviceUrl }
 */
function createEnv(opts = {}) {
  const sheets = { PRODUCTS: new MockSheet('PRODUCTS', [PRODUCT_HEADERS, ...(opts.products || [])]) };
  const props = Object.assign({ GEMINI_API_KEY: 'test-key' }, opts.reviewers ? { RF_REVIEWERS: opts.reviewers } : {});
  const drive = createDrive();
  const cacheMap = new Map();
  const cache = { get: (k) => (cacheMap.has(k) ? cacheMap.get(k) : null), put: (k, v) => { cacheMap.set(k, v); }, remove: (k) => { cacheMap.delete(k); } };
  const state = { email: opts.email ?? 'owner@example.com', driveRequests: [], fetches: [], modelCalls: [], alerts: [], locks: 0 };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new MockSheet(n, [])),
    getSheets: () => Object.values(sheets),
    getActiveSheet: () => sheets.PRODUCTS,
    toast() {},
  };
  const ui = {
    Button: { YES: 'YES', NO: 'NO', OK: 'OK' },
    ButtonSet: { YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    alert: (...args) => { state.alerts.push(args.length > 1 ? args[1] : args[0]); return 'YES'; },
    showModalDialog: (out) => state.alerts.push(out.getContent()),
  };
  const htmlOutput = (content) => {
    const o = { content, title: '', meta: {} };
    o.setTitle = (t) => { o.title = t; return o; };
    o.addMetaTag = (k, v) => { o.meta[k] = v; return o; };
    o.setWidth = () => o; o.setHeight = () => o;
    o.getContent = () => o.content;
    return o;
  };
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss },
    LockService: {
      getDocumentLock: () => ({ tryLock: () => (state.locks++, true), releaseLock() {} }),
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }),
    },
    DriveApp: drive.api,
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    ScriptApp: { getService: () => ({ getUrl: () => opts.serviceUrl || '' }), getOAuthToken: () => 'mock-oauth-token' },
    CacheService: { getUserCache: () => cache },
    HtmlService: { createHtmlOutput: htmlOutput, createHtmlOutputFromFile: () => htmlOutput('') },
    UrlFetchApp: {
      fetch(url, o) {
        // ---- Google Drive REST (metadata + resumable upload), used by Media.gs
        if (/^https:\/\/(www\.googleapis\.com\/(upload\/)?drive\/v3\/files|upload\.mock\/)/.test(url)) {
          const req = { method: String((o && o.method) || 'get').toLowerCase(), url, headers: (o && o.headers) || {}, payload: o && o.payload };
          state.driveRequests.push(req);
          const fault = opts.driveFault && opts.driveFault(req, state.driveRequests.length);
          const resp = (code, body, headers) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body || {})), getAllHeaders: () => headers || {}, getHeaders: () => headers || {} });
          if (fault) return resp(fault, { error: { message: 'injected ' + fault } });
          if (!/^Bearer \S+/.test(String(req.headers.Authorization || '')) && !url.startsWith('https://upload.mock/')) return resp(401, { error: { message: 'no token' } });
          let mm;
          if ((mm = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)/))) {
            const f = drive.nodes[decodeURIComponent(mm[1])];
            return f && f.kind === 'file' ? resp(200, drive.metaOf(f)) : resp(404, { error: { message: 'File not found' } });
          }
          if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files') && req.method === 'post') {
            const meta = JSON.parse(req.payload);
            const id = 'sess' + Object.keys(drive.sessions).length;
            drive.sessions[id] = { meta, size: Number(req.headers['X-Upload-Content-Length']), mime: req.headers['X-Upload-Content-Type'], parts: [], got: 0, done: null };
            return resp(200, {}, { Location: 'https://upload.mock/' + id });
          }
          if ((mm = url.match(/^https:\/\/upload\.mock\/(.+)$/)) && req.method === 'put') {
            const sess = drive.sessions[mm[1]];
            if (!sess) return resp(404, {});
            const cr = String(req.headers['Content-Range'] || '');
            const finish = () => {
              if (!sess.done) sess.done = drive.metaOf(drive.nodes[drive.addFile(sess.meta.parents[0], sess.meta.name, Buffer.concat(sess.parts), sess.mime)]);
              return resp(200, sess.done);
            };
            if (/^bytes \*\//.test(cr)) return sess.got === sess.size ? finish() : resp(308, {}, sess.got ? { Range: 'bytes=0-' + (sess.got - 1) } : {});
            const r = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr);
            const buf = drive.toBuf(req.payload);
            if (!r || Number(r[3]) !== sess.size || Number(r[1]) !== sess.got || Number(r[2]) - Number(r[1]) + 1 !== buf.length) return resp(400, { error: { message: 'bad range ' + cr } });
            if (sess.got + buf.length < sess.size && buf.length % 262144 !== 0) return resp(400, { error: { message: 'chunk must be a multiple of 256 KiB' } });
            sess.parts.push(buf);
            sess.got += buf.length;
            return sess.got === sess.size ? finish() : resp(308, {}, { Range: 'bytes=0-' + (sess.got - 1) });
          }
          return resp(400, { error: { message: 'unsupported mock request ' + req.method + ' ' + url } });
        }
        const m = url.match(/\/models\/([^:/?]+)(:generateContent)?$/);
        const model = m ? decodeURIComponent(m[1]) : '';
        state.modelCalls.push((m && m[2] ? 'generate ' : 'get ') + model);
        if ((opts.missingModels || []).includes(model)) {
          const t = JSON.stringify({ error: { code: 404, message: `models/${model} is not found for API version v1beta` } });
          return { getResponseCode: () => 404, getContentText: () => t };
        }
        if (m && !m[2]) {
          const t = JSON.stringify({ name: 'models/' + model, displayName: model, supportedGenerationMethods: ['generateContent', 'countTokens'] });
          return { getResponseCode: () => 200, getContentText: () => t };
        }
        const body = JSON.parse(o.payload);
        state.fetches.push(body);
        let payload = typeof opts.gemini === 'function' ? opts.gemini(state.fetches.length, body) : opts.gemini;
        if (payload instanceof Error) throw payload;
        if (payload && payload.candidates) {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(payload) };
        }
        const isImageCall = body.generationConfig &&
          Array.isArray(body.generationConfig.responseModalities) &&
          body.generationConfig.responseModalities.indexOf('IMAGE') !== -1;
        if (isImageCall) {
          const imgPart = (payload && (payload.inlineData || payload.image))
            ? (payload.inlineData || { mimeType: 'image/png', data: payload.image })
            : { mimeType: 'image/png', data: Buffer.from('mock-storyboard-image-' + state.fetches.length).toString('base64') };
          const text = JSON.stringify({
            candidates: [{
              finishReason: 'STOP',
              content: {
                parts: [
                  { text: 'Mock 9:16 storyboard image' },
                  { inlineData: imgPart },
                ],
              },
            }],
          });
          return { getResponseCode: () => 200, getContentText: () => text };
        }
        const text = JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] });
        return { getResponseCode: () => 200, getContentText: () => text };
      },
    },
    Utilities: {
      sleep() {},
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      getUuid: () => crypto.randomUUID(),
      base64Decode: (str) => Array.from(Buffer.from(String(str), 'base64')).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (alg, bytes) => Array.from(crypto.createHash(alg).update(Buffer.from(bytes.map((b) => b & 255))).digest()).map((b) => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, mime, name) => ({ getBytes: () => bytes, getContentType: () => mime, getName: () => name }),
      Charset: { UTF_8: 'UTF-8' },
      // Like Apps Script: returns signed bytes (-128..127).
      computeHmacSha256Signature: (value, key) =>
        Array.from(crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(value, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
  });
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'ReelsFactory.gs' });
  const gs = (expr) => vm.runInContext(expr, ctx);
  // Approval requires the operator's hook choice and a "reviewed" confirmation. Most tests are about other
  // steps, so by default the harness does both first (the current script's hook, no script change), like
  // an operator tapping a hook and ticking the box. Tests of the hook gate pass { autoSelectHook: false }.
  if (opts.autoSelectHook !== false) {
    const approve = ctx.apiAction;
    ctx.apiAction = function (reelId, action, input) {
      if (action === 'APPROVE_SCRIPT') {
        const r = ctx.apiGetReel(reelId);
        const h = r && r.ok && r.detail.hooks;
        if (h && h.required && !h.selectionValid && h.canSelect) {
          ctx.apiSelectHook(reelId, {
            hookId: (h.recommended && h.recommended.id) || h.candidates[0].id,
            text: r.detail.reel.hook,
            mode: 'keep',
            expectedStatus: r.detail.summary.status,
            expectedScriptVersion: r.detail.summary.scriptVersion,
          });
        }
      }
      // …and confirms having reviewed the script with that hook (the approve-screen checkbox).
      if (action === 'APPROVE_SCRIPT') input = Object.assign({ hookReviewed: true }, input || {});
      return approve(reelId, action, input);
    };
  }
  return { ctx, gs, sheets, props, state, ss, drive, cacheMap };
}

function prd001Row(gs, over = {}) {
  const p = Object.assign({}, gs('FIXTURE_PRD_001_PRODUCT'), over);
  return [p.id, p.name, p.category, p.features, p.target, p.affiliateUrl, p.sourceUrl, p.permission, p.status];
}

module.exports = { createEnv, prd001Row, MockSheet, PRODUCT_HEADERS };
