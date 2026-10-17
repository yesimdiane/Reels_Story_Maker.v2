// Google Sheets API v4 client — only what the Studio needs: add tabs (never remove or rewrite existing ones), read whole
// tabs, append rows, and update rows. Values are written RAW so Sheets never reinterprets text as formulas, dates or numbers.
// Header rows are strictly ADDITIVE: missing headers are appended on the right; an existing column is never renamed or moved.
'use strict';
const { StudioError } = require('../util');

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_CELL = 50000;

function colName(n) { // 1 -> A
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const q = (tab) => "'" + String(tab).replace(/'/g, "''") + "'";

function createSheetsApi({ http, spreadsheetId, baseUrl = BASE }) {
  if (!spreadsheetId) throw new StudioError('GOOGLE_NOT_CONFIGURED', 'RF_SPREADSHEET_ID가 설정되지 않았습니다.', { status: 500 });
  const url = (suffix = '') => `${baseUrl}/${encodeURIComponent(spreadsheetId)}${suffix}`;
  const range = (tab, a1) => encodeURIComponent(`${q(tab)}!${a1}`);

  function checkCells(rows) {
    rows.forEach((r) => r.forEach((c) => {
      if (typeof c === 'string' && c.length > MAX_CELL) throw new StudioError('CELL_TOO_LARGE', `Sheets 셀 한도(${MAX_CELL}자)를 넘는 값입니다.`, { status: 500 });
    }));
  }

  async function titles() {
    const m = await http.request('GET', url('?fields=' + encodeURIComponent('sheets.properties(sheetId,title,gridProperties)')));
    return (m.sheets || []).map((s) => s.properties);
  }

  /** defs: [{ name, headers }]. Creates missing tabs; appends missing headers; never alters existing headers/data. */
  async function ensureTabs(defs) {
    const have = await titles();
    const names = new Set(have.map((t) => t.title));
    const add = defs.filter((d) => !names.has(d.name));
    if (add.length) {
      await http.request('POST', url(':batchUpdate'), { json: { requests: add.map((d) => ({ addSheet: { properties: { title: d.name, gridProperties: { rowCount: 1000, columnCount: Math.max(26, d.headers.length + 2), frozenRowCount: 1 } } } })) } });
    }
    const existing = defs.filter((d) => names.has(d.name));
    const heads = existing.length ? await batchRead(existing.map((d) => ({ tab: d.name, a1: '1:1' }))) : [];
    const writes = [];
    defs.forEach((d) => {
      const idx = existing.indexOf(d);
      const cur = idx >= 0 ? (heads[idx][0] || []).map(String) : [];
      // Existing columns must match the expected ones in order; only extra columns may be appended.
      for (let i = 0; i < cur.length && i < d.headers.length; i += 1) {
        if (cur[i] !== d.headers[i]) throw new StudioError('SCHEMA_CONFLICT', `탭 ${d.name}의 ${i + 1}번째 열 머리글이 "${cur[i]}"입니다 (예상: "${d.headers[i]}"). 기존 탭을 덮어쓰지 않기 위해 중단합니다.`, { recovery: '탭 이름을 바꾸거나 머리글을 원래대로 되돌리세요.', status: 500 });
      }
      if (cur.length < d.headers.length) writes.push({ range: `${q(d.name)}!${colName(cur.length + 1)}1:${colName(d.headers.length)}1`, values: [d.headers.slice(cur.length)] });
    });
    if (writes.length) await http.request('POST', url('/values:batchUpdate'), { json: { valueInputOption: 'RAW', data: writes } });
    return { created: add.map((d) => d.name) };
  }

  /** Reads several ranges in one request. items: [{ tab, a1 }]. Returns an array of row arrays (trailing empties trimmed by Sheets). */
  async function batchRead(items) {
    const qs = items.map((i) => 'ranges=' + range(i.tab, i.a1)).join('&');
    const r = await http.request('GET', url(`/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`));
    return (r.valueRanges || []).map((v) => v.values || []);
  }
  async function readTab(tab) {
    return (await batchRead([{ tab, a1: 'A1:ZZ' }]))[0];
  }

  /** Appends rows; returns the 1-based row number of the first appended row. */
  async function appendRows(tab, rows) {
    if (!rows.length) return 0;
    checkCells(rows);
    const r = await http.request('POST', url(`/values/${range(tab, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`), { json: { majorDimension: 'ROWS', values: rows } });
    const m = /!([A-Z]+)(\d+):/.exec((r.updates && r.updates.updatedRange) || '');
    return m ? Number(m[2]) : 0;
  }

  /** updates: [{ row, values }] (1-based sheet rows). One request. */
  async function updateRows(tab, updates) {
    if (!updates.length) return;
    checkCells(updates.map((u) => u.values));
    await http.request('POST', url('/values:batchUpdate'), { json: { valueInputOption: 'RAW', data: updates.map((u) => ({ range: `${q(tab)}!A${u.row}:${colName(Math.max(1, u.values.length))}${u.row}`, majorDimension: 'ROWS', values: [u.values] })) } });
  }

  async function readRows(tab, rows) {
    return batchRead(rows.map((r) => ({ tab, a1: `A${r}:ZZ${r}` }))).then((x) => x.map((v) => v[0] || []));
  }

  return { ensureTabs, readTab, batchRead, appendRows, updateRows, readRows, titles, spreadsheetId, MAX_CELL };
}

module.exports = { createSheetsApi, colName, MAX_CELL };
