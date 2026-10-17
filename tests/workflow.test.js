// End-to-end test of the menu action with in-memory Apps Script service mocks.
// Verifies PRODUCTS is never modified and REELS rows are written by header name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Runs against the single-file bundle that users paste into Apps Script (see scripts/build-bundle.js).
const BUNDLE = path.join(__dirname, '..', 'dist', 'ReelsFactory.gs');
const PRODUCT_HEADERS = ['상품ID', '상품명', '카테고리', '확인된 기능', '타깃', '쿠팡파트너스 URL', '영상 소스 URL', '영상 사용 허가 상태', '제작 상태'];

class MockSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((r) => r.slice());
    this.activeRow = 1;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((r) => r.forEach((v, i) => { if (v !== '' && v != null) max = Math.max(max, i + 1); }));
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
}

function setup({ productRows, reelsRows, geminiPayload, alertAnswer = 'YES', productsName = 'PRODUCTS', productHeaders = PRODUCT_HEADERS, extraSheets = {} }) {
  const products = new MockSheet(productsName, [productHeaders, ...productRows]);
  const sheets = { [productsName]: products };
  if (reelsRows) sheets.REELS = new MockSheet('REELS', reelsRows);
  for (const [n, rows] of Object.entries(extraSheets)) sheets[n] = new MockSheet(n, rows);
  const alerts = [];
  let fetchCount = 0;
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new MockSheet(n, [])),
    getSheets: () => Object.values(sheets),
    getActiveSheet: () => products,
    toast() {},
  };
  const ui = {
    Button: { YES: 'YES', NO: 'NO', OK: 'OK' },
    ButtonSet: { YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    alert: (...args) => { alerts.push(args.length > 1 ? args[1] : args[0]); return alertAnswer; },
  };
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => ({ GEMINI_API_KEY: 'test-key' })[k] || null }),
    },
    UrlFetchApp: {
      fetch(url, opts) {
        fetchCount++;
        assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
        assert.equal(opts.headers['x-goog-api-key'], 'test-key');
        assert.ok(!url.includes('test-key'), 'API key must not be in the URL');
        const body = JSON.parse(opts.payload);
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        const payload = typeof geminiPayload === 'function' ? geminiPayload(fetchCount) : geminiPayload;
        if (payload instanceof Error) throw payload;
        const text = JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] });
        return { getResponseCode: () => 200, getContentText: () => text };
      },
    },
    Utilities: { sleep() {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  });
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'ReelsFactory.gs' });
  return { ctx, sheets, products, alerts, fetches: () => fetchCount };
}

function prd001Row(ctx) {
  const p = vm.runInContext('FIXTURE_PRD_001_PRODUCT', ctx);
  return [p.id, p.name, p.category, p.features, p.target, p.affiliateUrl, p.sourceUrl, p.permission, p.status];
}

function fixturePayload() {
  const { ctx } = setup({ productRows: [] });
  return JSON.parse(JSON.stringify(vm.runInContext('FIXTURE_PRD_001_GEMINI_RESPONSE', ctx)));
}

test('generates one REELS row (five hooks + script) for PRD-001 without touching PRODUCTS', () => {
  const env = setup({ productRows: [], geminiPayload: fixturePayload() });
  const row = prd001Row(env.ctx);
  env.products.rows.push(row);
  const before = JSON.stringify(env.products.rows);
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(JSON.stringify(env.products.rows), before, 'PRODUCTS must be unchanged');
  const reels = env.sheets.REELS.rows;
  assert.equal(reels.length, 2);
  assert.equal(reels[0][0], '릴스ID');
  assert.deepEqual(reels.slice(1).map((r) => r[0]), ['PRD-001-R01']);
  assert.equal(JSON.parse(reels[1][reels[0].indexOf('훅 후보(JSON)')]).hooks.length, 5);
  assert.equal(env.fetches(), 1);
  assert.match(env.alerts.at(-1), /REELS에 1개 행을 추가/);
  assert.match(env.alerts.at(-1), /허가 미확인/);
  const log = env.sheets.LOG.rows;
  assert.equal(log.at(-1)[1], 'INFO');
});

test('writes by header name into an existing REELS sheet with reordered/extra columns', () => {
  const headers = vm.runInContext('RF_CONFIG.REELS_HEADERS.concat(RF_CONFIG.REELS_HOOK_HEADERS)', setup({ productRows: [] }).ctx).slice();
  const reordered = ['운영자 메모', ...headers.reverse()];
  const existing = new Array(reordered.length).fill('');
  existing[0] = '기존 메모 유지';
  existing[reordered.indexOf('릴스ID')] = 'PRD-001-R01';
  existing[reordered.indexOf('ManyChat 키워드')] = 'PRD001R01';
  const env = setup({ productRows: [], reelsRows: [reordered, existing], geminiPayload: fixturePayload() });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  const rows = env.sheets.REELS.rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], '기존 메모 유지');
  const idCol = reordered.indexOf('릴스ID');
  assert.deepEqual(rows.slice(2).map((r) => r[idCol]), ['PRD-001-R02']);
  assert.equal(rows[2][0], '');
});

test('an existing REELS sheet without the hook columns: generation asks for 시트 준비 before any Gemini call', () => {
  const headers = vm.runInContext('RF_CONFIG.REELS_HEADERS', setup({ productRows: [] }).ctx).slice();
  const env = setup({ productRows: [], reelsRows: [headers], geminiPayload: fixturePayload() });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;
  const before = JSON.stringify(env.sheets.REELS.rows);
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.equal(env.fetches(), 0, 'no paid call');
  assert.match(env.alerts.at(-1), /훅 저장 열이 없습니다[\s\S]*시트 준비/);
  assert.equal(JSON.stringify(env.sheets.REELS.rows), before, 'REELS unchanged');
});

test('retries once with validation errors, then writes nothing if still invalid', () => {
  const bad = fixturePayload();
  bad.reels[0].facts_used = ['방수 기능'];
  const env = setup({ productRows: [], geminiPayload: bad });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(env.fetches(), 2);
  assert.equal(env.sheets.REELS.rows.length, 1, 'only the header row');
  assert.match(env.alerts.at(-1), /검증에 실패/);
  assert.match(env.alerts.at(-1), /방수 기능/);
  const levels = env.sheets.LOG.rows.slice(1).map((r) => r[1]);
  assert.deepEqual(levels, ['WARN', 'ERROR', 'ERROR']);
});

test('second attempt succeeds after a corrective retry', () => {
  const bad = fixturePayload();
  bad.reels[0].hook = '최저가 우산꽂이';
  const good = fixturePayload();
  const env = setup({ productRows: [], geminiPayload: (n) => (n === 1 ? bad : good) });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(env.fetches(), 2);
  assert.equal(env.sheets.REELS.rows.length, 2);
});

test('blocks duplicate product IDs in PRODUCTS before calling Gemini', () => {
  const env = setup({ productRows: [], geminiPayload: fixturePayload() });
  env.products.rows.push(prd001Row(env.ctx), prd001Row(env.ctx));
  env.products.activeRow = 2;

  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);

  assert.equal(env.fetches(), 0);
  assert.match(env.alerts.at(-1), /여러 번/);
});

test('rejects header row selection and missing features', () => {
  const env = setup({ productRows: [], geminiPayload: fixturePayload() });
  const row = prd001Row(env.ctx);
  row[3] = '';
  env.products.rows.push(row);

  env.products.activeRow = 1;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.match(env.alerts.at(-1), /상품 행 하나/);

  env.products.activeRow = 2;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.match(env.alerts.at(-1), /확인된 기능/);
  assert.equal(env.fetches(), 0);
});

test('tolerates spaced headers and a tab name with trailing space / different case', () => {
  const spaced = ['상품 ID', '상품명', '카테고리', '확인된 기능 ', '타깃', '쿠팡파트너스 URL', '영상 소스 URL', '영상 사용 허가 상태', '제작 상태'];
  const env = setup({ productRows: [], productsName: 'Products ', productHeaders: spaced, geminiPayload: fixturePayload() });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.equal(env.sheets.REELS.rows.length, 2, env.alerts.at(-1));
});

test('setupSheets appends missing headers to an existing REELS sheet only after confirmation', () => {
  const existing = [['릴스ID', '운영자 메모'], ['OLD-1', '보존']];
  const env = setup({ productRows: [], reelsRows: existing, alertAnswer: 'NO' });
  vm.runInContext('setupSheets()', env.ctx);
  assert.deepEqual(env.sheets.REELS.rows[0], ['릴스ID', '운영자 메모'], 'declined → unchanged');
  assert.match(env.alerts.at(-1), /✗ REELS/);

  const env2 = setup({ productRows: [], reelsRows: existing, alertAnswer: 'YES' });
  vm.runInContext('setupSheets()', env2.ctx);
  const header = env2.sheets.REELS.rows[0];
  assert.deepEqual(header.slice(0, 2), ['릴스ID', '운영자 메모']);
  assert.equal(header.length, 2 + vm.runInContext('RF_CONFIG.REELS_HEADERS.length + RF_CONFIG.REELS_OPTIONAL_HEADERS.length', env2.ctx) - 1);
  assert.deepEqual(header.slice(-8), ['콘텐츠 기둥', '확인 필요', '훅 후보(JSON)', '선택한 훅', '제작 계획(JSON)', '에셋 현황(JSON)', '장면 클립(JSON)', '장면 이미지(JSON)'], 'optional brand, hook, production and media columns added last');
  assert.deepEqual(env2.sheets.REELS.rows[1], ['OLD-1', '보존']);
  assert.ok(env2.sheets.PERFORMANCE && env2.sheets.LOG);
  assert.match(env2.alerts.at(-1), /✓ PRODUCTS/);
});

test('setupSheets never edits PRODUCTS and reports its missing headers', () => {
  const env = setup({ productRows: [], productHeaders: ['상품ID', '상품명'] });
  const before = JSON.stringify(env.products.rows);
  vm.runInContext('setupSheets()', env.ctx);
  assert.equal(JSON.stringify(env.products.rows), before);
  assert.match(env.alerts.at(-1), /✗ PRODUCTS.*확인된 기능/);
});

test('network/timeout errors from UrlFetchApp are retried, then reported clearly', () => {
  const env = setup({ productRows: [], geminiPayload: () => new Error('Timeout: https://generativelanguage.googleapis.com') });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.equal(env.fetches(), 3);
  assert.match(env.alerts.at(-1), /Gemini API에 연결하지 못했습니다/);
  assert.equal(env.sheets.REELS.rows.length, 1);
});

test('a transient network error followed by success still writes the row', () => {
  const good = fixturePayload();
  const env = setup({ productRows: [], geminiPayload: (n) => (n === 1 ? new Error('Address unavailable') : good) });
  env.products.rows.push(prd001Row(env.ctx));
  env.products.activeRow = 2;
  vm.runInContext('generateReelsForSelectedProduct()', env.ctx);
  assert.equal(env.sheets.REELS.rows.length, 2);
});

test('onOpen builds the menu via addReelsFactoryMenu', () => {
  const env = setup({ productRows: [] });
  const items = [];
  const menu = { addItem: (l, f) => (items.push(f), menu), addSeparator: () => menu, addToUi: () => {} };
  vm.runInContext('SpreadsheetApp.getUi', env.ctx)().createMenu = () => menu;
  vm.runInContext('onOpen()', env.ctx);
  for (const fn of items) assert.equal(vm.runInContext(`typeof ${fn}`, env.ctx), 'function', fn);
  assert.ok(items.includes('generateReelsForSelectedProduct'));
});
