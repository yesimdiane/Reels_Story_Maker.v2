'use strict';
// Home: counters + queue by production stage (actionable first), deep links, empty states; Coupang performance from imported reports only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { approveWithScenes } = require('./helpers/approve');
const { make } = require('./helpers/v23');
const { createPerformance, parseCsv } = require('../studio/lib/performance');
const { createApp } = require('../studio/server');

const VIEWS = path.join(__dirname, '..', 'studio', 'public', 'js');
const home = (s) => s.summary().home;
const item = (s, id) => home(s).items.find((i) => i.id === id);

test('queue calculations: every active episode appears once with code, title, product, stage, status, next action and a valid deep-link target', async () => {
  const { s } = make();
  const h0 = home(s);
  const it = h0.items.find((i) => i.id === 'EP01');
  assert.ok(it); assert.equal(it.code, 'EP01'); assert.ok(it.title && it.productName && it.stage && it.next && it.statusLabel);
  const navKeys = fs.readFileSync(path.join(VIEWS, 'main.js'), 'utf8').match(/\['([a-z]+)', '[^']+', '[^']+', [a-z]+, (?:true|false)\]/g).map((x) => /\['([a-z]+)'/.exec(x)[1]);
  h0.items.forEach((i) => assert.ok(navKeys.includes(i.view), 'deep link target is a real studio: ' + i.view));
  assert.equal(h0.groups.flatMap((g) => g.items).length, h0.items.filter((i) => !i.published).length, 'grouped items = active items');
  // script written and valid but not approved → waiting for MY approval
  assert.equal(it.status, 'approval');
  assert.deepEqual(it.awaiting, ['script']);
  assert.equal(h0.counts.approvals, 1);
  assert.equal(h0.counts.active, 1);
  // after the script is approved the next approval is the storyboard
  await approveWithScenes(s, 'EP01');
  assert.deepEqual(item(s, 'EP01').awaiting, ['storyboard']);
  assert.equal(item(s, 'EP01').group, 'storyboard');
  assert.equal(item(s, 'EP01').view, 'storyboard');
  assert.match(item(s, 'EP01').next, /스토리보드/);
});

test('statuses: hold, running, failed, completed; archived and trashed episodes stay out of the queue', async () => {
  const { s } = make();
  await s.holdEpisode('EP01', 'later');
  let c = home(s).counts;
  assert.equal(item(s, 'EP01').status, 'hold'); assert.equal(c.onHold, 1); assert.equal(c.active, 0, 'a held episode is not "active work"');
  await s.resumeEpisode('EP01');
  await s.store.episodes.update('EP01', (ep) => { ep.renderJob = { status: 'running', startedAt: new Date().toISOString() }; });
  assert.equal(item(s, 'EP01').status, 'running'); assert.equal(home(s).counts.running, 1);
  await s.store.episodes.update('EP01', (ep) => { delete ep.renderJob; ep.generation.jobs.push({ id: 'job_x', sceneId: 'S1', status: 'failed', billed: false, error: { message: '실패 사유' } }); });
  assert.equal(item(s, 'EP01').status, 'failed'); assert.equal(home(s).counts.failed, 1);
  assert.match(item(s, 'EP01').statusLabel, /생성 실패 1/);
  await s.store.episodes.update('EP01', (ep) => { ep.generation.jobs = []; ep.approvals.final = { v: 1, sha256: 'x', at: new Date().toISOString() }; });
  assert.equal(home(s).counts.completed, 1);
  await s.archiveEpisode('EP01');
  assert.equal(item(s, 'EP01'), undefined, 'archived episodes are not in the queue');
  assert.equal(home(s).counts.completed, 0);
  await s.unarchiveEpisode('EP01');
  await s.trashEpisode('EP01', { confirmApproved: true });
  assert.equal(home(s).items.length, 0, 'trashed episodes are not in the queue');
});

test('empty state: no episodes → zero counters, no groups, performance "no data" (never invented)', async () => {
  const { s } = make();
  await s.trashEpisode('EP01');
  const h0 = home(s);
  assert.deepEqual(h0.counts, { active: 0, approvals: 0, running: 0, failed: 0, completed: 0, onHold: 0 });
  assert.deepEqual(h0.groups, []);
  assert.equal(h0.performance.hasData, false);
  assert.deepEqual(h0.performance.totals, { clicks: null, orders: null, commissionEst: null, commissionFinal: null });
  assert.equal(h0.performance.lastSync, null);
  assert.equal(h0.performance.integration.status, 'not_configured');
});

const CSV = '날짜,클릭수,주문수,예상 수익,확정 수익\n2026-10-01,120,3,"4,500원","3,900원"\n2026-10-02,80,1,"1,200원",\n2026/10/03,x,2,500,0\n';
function perf(clock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-perf-'));
  const store = { path: (...p) => path.join(dir, ...p) };
  return createPerformance({ store, now: () => clock.t });
}

test('CSV import: Korean headers, thousands separators, unreadable rows reported (not zeroed), metrics missing from the file are "none" (null)', () => {
  const clock = { t: Date.parse('2026-10-05T00:00:00Z') };
  const p = perf(clock);
  const pv = p.preview({ buffer: Buffer.from(CSV), filename: 'report.csv' });
  assert.deepEqual(pv.present.sort(), ['clicks', 'commissionEst', 'commissionFinal', 'orders']);
  assert.equal(pv.rows.length, 2); assert.equal(pv.errors.length, 1); assert.match(pv.errors[0].message, /clicks 값을 읽을 수 없습니다/);
  p.commit(pv);
  const sm = p.summary();
  assert.equal(sm.totals.clicks, 200); assert.equal(sm.totals.orders, 4);
  assert.equal(sm.totals.commissionEst, 5700); assert.equal(sm.totals.commissionFinal, 3900, 'an empty cell is not 0');
  assert.equal(sm.dateFrom, '2026-10-01'); assert.equal(sm.dateTo, '2026-10-02');
  // a report without a commission column → commission is not available, not 0
  const only = perf(clock);
  only.commit(only.preview({ buffer: Buffer.from('date,clicks\n2026-10-01,5\n'), filename: 'c.csv' }));
  const t = only.summary().totals;
  assert.equal(t.clicks, 5); assert.equal(t.orders, null); assert.equal(t.commissionEst, null); assert.equal(t.commissionFinal, null);
  assert.deepEqual(parseCsv('a,b\n"x,1",2\n'), [['a', 'b'], ['x,1', '2']]);
});

test('re-importing a report never double counts; the same file is refused; imports can be removed; the date range filter works', () => {
  const clock = { t: Date.parse('2026-10-05T00:00:00Z') };
  const p = perf(clock);
  p.commit(p.preview({ buffer: Buffer.from('날짜,클릭수\n2026-10-01,10\n2026-10-02,20\n'), filename: 'a.csv' }));
  assert.throws(() => p.commit(p.preview({ buffer: Buffer.from('날짜,클릭수\n2026-10-01,10\n2026-10-02,20\n'), filename: 'a-again.csv' })), (e) => e.code === 'DUPLICATE_IMPORT');
  const id2 = p.commit(p.preview({ buffer: Buffer.from('날짜,클릭수\n2026-10-02,25\n2026-10-03,5\n'), filename: 'b.csv' }));
  assert.equal(p.summary().totals.clicks, 10 + 25 + 5, 'the newer value for 10-02 replaces the older one');
  assert.equal(p.summary({ from: '2026-10-02', to: '2026-10-02' }).totals.clicks, 25);
  const after = p.removeImport(id2);
  assert.equal(after.totals.clicks, 10, 'removing an import removes its rows');
  assert.equal(after.imports.length, 1);
});

test('data freshness: last sync, age in days, stale after a week', () => {
  const clock = { t: Date.parse('2026-10-05T00:00:00Z') };
  const p = perf(clock);
  assert.equal(p.summary().lastSync, null); assert.equal(p.summary().stale, false);
  p.commit(p.preview({ buffer: Buffer.from('date,clicks\n2026-10-01,5\n'), filename: 'c.csv' }));
  assert.equal(p.summary().ageDays, 0); assert.equal(p.summary().stale, false);
  assert.match(p.summary().lastSync, /^2026-10-05/);
  clock.t += 6 * 86400000; assert.equal(p.summary().stale, false);
  clock.t += 2 * 86400000; assert.equal(p.summary().ageDays, 8); assert.equal(p.summary().stale, true);
});

test('invalid reports are refused with actionable errors (no date column, no metrics, empty, legacy .xls)', () => {
  const p = perf({ t: Date.now() });
  const code = (buf, name) => { try { p.preview({ buffer: Buffer.from(buf), filename: name }); return null; } catch (e) { return e.code; } };
  assert.equal(code('a,b\n1,2\n', 'x.csv'), 'NO_DATE_COLUMN');
  assert.equal(code('date,note\n2026-10-01,hi\n', 'x.csv'), 'NO_METRIC_COLUMNS');
  assert.equal(code('date,clicks\n', 'x.csv'), 'EMPTY_REPORT');
  assert.equal(code('x', 'old.xls'), 'UNSUPPORTED_XLS');
  // an explicit column mapping rescues unknown headers
  const pv = p.preview({ buffer: Buffer.from('일시,Hits\n2026-10-01,7\n'), filename: 'm.csv', mapping: { date: '일시', clicks: 'Hits' } });
  assert.equal(pv.rows[0].clicks, 7);
});

/** A tiny ZIP writer (stored entries) so the XLSX reader can be tested without any library. */
function zip(files) {
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = []; const central = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name); const d = Buffer.from(data); const comp = zlib.deflateRawSync(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc(d), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc(d), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
test('XLSX import (dependency-free reader): shared strings, numbers and Excel date serials', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2"><v>46296</v></c><c r="B2"><v>50</v></c><c r="C2"><v>2</v></c></row></sheetData></worksheet>';
  const strings = '<sst><si><t>날짜</t></si><si><t>클릭수</t></si><si><t>주문수</t></si></sst>';
  const xlsx = zip({ 'xl/worksheets/sheet1.xml': sheet, 'xl/sharedStrings.xml': strings });
  const p = perf({ t: Date.now() });
  const pv = p.preview({ buffer: xlsx, filename: 'report.xlsx' });
  assert.equal(pv.rows.length, 1); assert.equal(pv.rows[0].date, '2026-10-01'); assert.equal(pv.rows[0].clicks, 50); assert.equal(pv.rows[0].orders, 2);
});

test('no scraping and no secrets: the performance module opens no network connection', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'studio', 'lib', 'performance.js'), 'utf8');
  assert.doesNotMatch(src, /require\('node:(http|https|net|tls)'\)|fetch\(|XMLHttpRequest|puppeteer|playwright/);
  assert.match(src, /integration: \{ status: 'not_configured'/);
});

test('HTTP: dry run previews without saving, the import commits, removal works', async () => {
  const { s } = make();
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body || '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: Object.assign({ Host: '127.0.0.1:' + port, 'x-rf-studio': '1', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) }, headers) }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    const hdr = { 'x-filename': encodeURIComponent('r.csv'), 'content-type': 'text/csv' };
    const dry = await call('POST', '/api/performance/import?dryRun=1', CSV, hdr);
    assert.equal(dry.status, 200); assert.equal(dry.json.committed, false); assert.equal(dry.json.rowCount, 2);
    assert.equal((await call('GET', '/api/performance')).json.hasData, false, 'nothing saved by the preview');
    const real = await call('POST', '/api/performance/import', CSV, hdr);
    assert.equal(real.status, 200); assert.equal(real.json.committed, true); assert.equal(real.json.totals.orders, 4);
    assert.equal((await call('POST', '/api/performance/import', CSV, hdr)).status, 409, 'same file twice');
    assert.equal((await call('DELETE', `/api/performance/imports/${real.json.importId}`)).json.hasData, false);
    assert.equal((await call('POST', '/api/performance/import', 'a,b\n1,2\n', hdr)).status, 422);
  } finally { await new Promise((r) => app.close(r)); }
});

test('Home screen: default route and first menu item, logo returns Home, counters / queue / performance, deep links, mobile tab', () => {
  const main = fs.readFileSync(path.join(VIEWS, 'main.js'), 'utf8');
  const ov = fs.readFileSync(path.join(VIEWS, 'views', 'overview.js'), 'utf8');
  assert.match(main, /NAV = \[\s*\['overview', '홈', 'Home'/, 'Home is the first menu item');
  assert.match(main, /view = 'overview'/, 'and the default route');
  assert.match(main, /class: 'brand', href: '#\/overview'/, 'the logo links to Home');
  assert.match(main, /\['overview', '홈'\]\]\.concat\(RAIL/, 'persistent Home access in the mobile tab bar');
  for (const k of ['data-home-counters', 'data-home-queue', 'data-queue-group', 'data-home-item', 'data-performance', 'data-perf-import']) assert.match(ov, new RegExp(k), k);
  assert.match(ov, /'#\/' \+ item\.view \+ '\/'/, 'items deep-link to the right studio and episode');
  assert.match(ov, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/, 'XLSX accepted');
  // actionable work first, analytics after
  assert.ok(ov.indexOf('counters(s.home)') < ov.indexOf('queue(s.home)') && ov.indexOf('queue(s.home)') < ov.indexOf('performanceSection('), 'queue before performance');
});
