// Coupang Partners performance: numbers come ONLY from a report the operator imports (CSV / XLSX exported from the Partners
// dashboard) — nothing is scraped, no private page is opened, no value is invented. A metric whose column is not in the file is
// reported as "not available" (null), never as 0. Imports are kept (history); a newer import replaces the rows of the same
// date (+ sub id) so re-importing a report never double counts.
// An authorised reporting API is NOT wired: `integration.status` says so plainly.
'use strict';
const zlib = require('node:zlib');
const { StudioError, nowIso, readJson, writeJsonAtomic, sha256 } = require('./util');

const METRICS = ['clicks', 'orders', 'commissionEst', 'commissionFinal'];
const ALIASES = {
  date: ['date', '날짜', '일자', '일', '기간', '조회일', '클릭일', '주문일'],
  subId: ['subid', 'sub id', '서브id', '서브 id', '채널', '채널id', 'channel'],
  clicks: ['clicks', 'click', '클릭', '클릭수', '클릭 수'],
  orders: ['orders', 'order', 'conversions', 'conversion', '주문', '주문수', '주문 수', '구매', '구매수', '구매 수', '전환', '전환수', '전환 수'],
  commissionEst: ['estimated commission', 'est. commission', 'estimated earnings', '예상 수익', '예상수익', '예상 수수료', '예상 커미션', '예상수수료'],
  commissionFinal: ['finalized commission', 'final commission', 'confirmed commission', 'confirmed earnings', '확정 수익', '확정수익', '확정 수수료', '확정수수료', '확정 커미션'],
};
const norm = (s) => String(s == null ? '' : s).replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

// ---------------- parsing ----------------
function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  const delim = (s.split('\n')[0].match(/\t/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

/** Minimal dependency-free XLSX reader: first worksheet, shared + inline strings, numbers. */
function parseXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    for (const si of files['xl/sharedStrings.xml'].toString('utf8').match(/<si[\s\S]*?<\/si>/g) || []) shared.push(decodeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  }
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new StudioError('BAD_XLSX', '워크시트를 찾을 수 없습니다.', { status: 422 });
  const rows = [];
  for (const r of files[sheetName].toString('utf8').match(/<row[\s\S]*?<\/row>/g) || []) {
    const cells = [];
    for (const c of r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = /r="([A-Z]+)\d+"/.exec(c);
      const col = ref ? colIndex(ref[1]) : cells.length;
      const type = (/t="([^"]+)"/.exec(c) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
      const inline = (/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c) || [])[1];
      cells[col] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? decodeXml(inline || '') : v == null ? '' : decodeXml(v);
    }
    rows.push(Array.from(cells, (x) => (x == null ? '' : x)));
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
const colIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const decodeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function unzip(buf) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new StudioError('BAD_XLSX', 'XLSX 파일이 아닙니다 (ZIP 구조를 찾을 수 없음).', { status: 422 });
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30); const cmtLen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lh = off; const lnl = buf.readUInt16LE(lh + 26); const lel = buf.readUInt16LE(lh + 28);
    const data = buf.slice(lh + 30 + lnl + lel, lh + 30 + lnl + lel + csize);
    out[name] = method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

const num = (v) => {
  const t = String(v == null ? '' : v).replace(/[₩원$,\s%]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
function isoDate(v) {
  const t = String(v == null ? '' : v).trim();
  let m = /^(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})/.exec(t);
  if (!m && /^\d{8}$/.test(t)) m = [t, t.slice(0, 4), t.slice(4, 6), t.slice(6, 8)];
  if (!m) { const serial = Number(t); if (Number.isFinite(serial) && serial > 20000 && serial < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000); return d.toISOString().slice(0, 10); } return ''; }
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Detects the columns; an explicit mapping {metric: headerName} overrides the aliases. */
function detect(table, mapping = {}) {
  const header = (table[0] || []).map((h) => String(h == null ? '' : h).trim());
  const lower = header.map(norm);
  const idx = {};
  Object.keys(ALIASES).forEach((k) => {
    if (mapping[k]) { const i = lower.indexOf(norm(mapping[k])); if (i >= 0) idx[k] = i; return; }
    const i = lower.findIndex((h) => ALIASES[k].includes(h));
    if (i >= 0) idx[k] = i;
  });
  const used = new Set(Object.values(idx));
  return { header, idx, unmapped: header.filter((_, i) => !used.has(i) && header[i]) };
}

function createPerformance({ store, now = () => Date.now() }) {
  const file = () => store.path('performance.json');
  const read = () => readJson(file(), { imports: [], rows: {} });
  const write = (d) => writeJsonAtomic(file(), d);

  /** Parses and validates a report WITHOUT saving it (what the operator sees before committing). */
  function preview({ buffer, filename = '', mapping = {} }) {
    const name = String(filename || '').toLowerCase();
    let table;
    if (/\.xlsx$/.test(name) || (buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50)) table = parseXlsx(buffer);
    else if (/\.xls$/.test(name)) throw new StudioError('UNSUPPORTED_XLS', '예전 .xls 형식은 읽을 수 없습니다. .xlsx 또는 .csv로 저장해 올려 주세요.', { status: 422 });
    else table = parseCsv(buffer.toString('utf8'));
    if (table.length < 2) throw new StudioError('EMPTY_REPORT', '데이터 행이 없습니다.', { status: 422 });
    const det = detect(table, mapping);
    if (det.idx.date == null) throw new StudioError('NO_DATE_COLUMN', '날짜 열을 찾지 못했습니다. 아래 열 이름 중 날짜 열을 지정해 주세요.', { status: 422, details: [{ headers: det.header }], recovery: '열 이름을 직접 지정해 다시 시도하세요 (mapping.date).' });
    const present = METRICS.filter((m) => det.idx[m] != null);
    if (!present.length) throw new StudioError('NO_METRIC_COLUMNS', '클릭·주문·수익 열을 하나도 찾지 못했습니다.', { status: 422, details: [{ headers: det.header }], recovery: '열 이름을 직접 지정해 다시 시도하세요.' });
    const rows = []; const errors = [];
    table.slice(1).forEach((r, i) => {
      const date = isoDate(r[det.idx.date]);
      if (!date) return errors.push({ row: i + 2, message: '날짜를 읽을 수 없습니다: ' + r[det.idx.date] });
      const row = { date, subId: det.idx.subId != null ? String(r[det.idx.subId] || '').trim() : '' };
      for (const m of present) { const v = num(r[det.idx[m]]); if (Number.isNaN(v)) { errors.push({ row: i + 2, message: `${m} 값을 읽을 수 없습니다: ${r[det.idx[m]]}` }); return; } row[m] = v; }
      rows.push(row);
    });
    const dates = rows.map((r) => r.date).sort();
    return { filename, rows, errors, present, missingMetrics: METRICS.filter((m) => !present.includes(m)), headers: det.header, unmapped: det.unmapped, dateFrom: dates[0] || null, dateTo: dates[dates.length - 1] || null, sha256: sha256(buffer) };
  }

  function commit(p, by = 'operator') {
    if (!p.rows.length) throw new StudioError('NO_VALID_ROWS', '저장할 수 있는 행이 없습니다.' + (p.errors[0] ? ' ' + p.errors[0].message : ''), { status: 422 });
    const d = read();
    if (d.imports.some((x) => x.sha256 === p.sha256 && !x.removed)) throw new StudioError('DUPLICATE_IMPORT', '같은 파일을 이미 가져왔습니다.', { status: 409 });
    const id = 'IMP' + String(d.imports.length + 1).padStart(3, '0');
    d.imports.push({ id, at: new Date(now()).toISOString(), filename: String(p.filename || '').slice(0, 120), sha256: p.sha256, rows: p.rows.length, skipped: p.errors.length, dateFrom: p.dateFrom, dateTo: p.dateTo, metrics: p.present, by });
    p.rows.forEach((r) => { d.rows[`${r.date}|${r.subId}`] = Object.assign({}, r, { importId: id }); }); // same day + sub id: the newer import replaces the older value
    write(d);
    return id;
  }

  function removeImport(id) {
    const d = read();
    const imp = d.imports.find((x) => x.id === id);
    if (!imp || imp.removed) throw new StudioError('NOT_FOUND', '가져온 파일을 찾을 수 없습니다: ' + id, { status: 404 });
    imp.removed = true; imp.removedAt = new Date(now()).toISOString();
    Object.keys(d.rows).forEach((k) => { if (d.rows[k].importId === id) delete d.rows[k]; });
    write(d);
    return summary();
  }

  /** Totals over the stored rows. A metric no import ever contained is null ("not available"), not 0. */
  function summary({ from = '', to = '' } = {}) {
    const d = read();
    const live = d.imports.filter((x) => !x.removed);
    const rows = Object.values(d.rows).filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
    const totals = {};
    METRICS.forEach((m) => { const has = rows.filter((r) => r[m] != null); totals[m] = has.length ? Math.round(has.reduce((n, r) => n + r[m], 0) * 100) / 100 : null; });
    const dates = rows.map((r) => r.date).sort();
    const last = live.length ? live[live.length - 1].at : null;
    const ageDays = last ? Math.floor((now() - new Date(last).getTime()) / 86400000) : null;
    return {
      source: 'import', hasData: rows.length > 0,
      totals, dateFrom: dates[0] || null, dateTo: dates[dates.length - 1] || null, days: new Set(dates).size,
      lastSync: last, ageDays, stale: ageDays != null && ageDays > 7,
      imports: live.slice().reverse().slice(0, 20),
      integration: { status: 'not_configured', note: '쿠팡 파트너스 보고서 API 연동은 설정되어 있지 않습니다. 대시보드에서 내려받은 CSV/XLSX 보고서를 가져오세요. 로그인이 필요한 페이지는 읽어 오지 않습니다.' },
      note: '이 숫자는 가져온 보고서의 합계입니다. 보고서에 없는 항목은 "없음"으로 표시하며 추정하지 않습니다. 예상 수익은 확정 수익과 다를 수 있습니다.',
    };
  }

  return { preview, commit, removeImport, summary, parseCsv, parseXlsx, METRICS };
}

module.exports = { createPerformance, parseCsv, parseXlsx, METRICS };
