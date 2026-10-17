// The committed single-file bundle must match the sources, and must load as one Apps Script file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { build, OUT } = require('../scripts/build-bundle.js');

test('dist/ReelsFactory.gs is up to date (run `npm run build`)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), build());
});

test('bundle parses and defines no clashing top-level constants twice', () => {
  const src = fs.readFileSync(OUT, 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ReelsFactory.gs' }));
  const consts = [...src.matchAll(/^const (\w+)/gm)].map((m) => m[1]);
  assert.ok(consts.includes('RF_CONFIG') && consts.includes('RF_DASHBOARD_HTML'));
  for (const c of consts) assert.match(c, /^(RF_|FIXTURE_)/, 'top-level const must be prefixed: ' + c);
  assert.equal(new Set(consts).size, consts.length, 'duplicate top-level const');
  const fns = [...src.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  assert.equal(new Set(fns).size, fns.length, 'duplicate function names in bundle');
});

// Any page served by HtmlService can call ANY public (no trailing underscore) server function via
// google.script.run, so public functions that write data or spend API quota must be guarded:
// api* functions go through api_() (reviewer check); menu functions call SpreadsheetApp.getUi() first,
// which throws outside the spreadsheet UI.
test('public server functions that write or spend quota are guarded', () => {
  const src = fs.readFileSync(OUT, 'utf8');
  const fns = {};
  const re = /^function (\w+)\([^)]*\) \{\n([\s\S]*?)\n\}/gm;
  let m;
  while ((m = re.exec(src))) fns[m[1]] = m[2];
  const sensitive = /UrlFetchApp|callGemini_\(|setProperty\(|updateRecord_\(|appendRecords_\(|appendAudit_\(|generateScriptsForProduct_\(|generateValidatedRecords_\(|applyTransition_\(|appendMissingHeaders_\(|ensureSheet_\(|getRenderSecret_\(|signRenderJob_\(/;
  const exposed = Object.keys(fns).filter((n) => !n.endsWith('_') && sensitive.test(fns[n]));
  for (const n of exposed) {
    const body = fns[n];
    if (/^api[A-Z]/.test(n)) {
      assert.match(body, /^\s*return api_\(function/, n + ' must be wrapped in api_()');
    } else {
      const firstStatement = body.trim().split('\n')[0];
      assert.match(firstStatement, /SpreadsheetApp\.getUi\(\)/, n + ' must call getUi() before anything else');
    }
  }
  assert.ok(!('callGemini' in fns), 'callGemini must stay private');
  assert.ok(exposed.length >= 5, 'sanity: found ' + exposed.join(', '));
});

// The iPhone page only works if every server function it calls exists (a typo would fail only on the phone).
test('every google.script.run call in the dashboard exists in the bundle as a guarded api function', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Dashboard.html'), 'utf8');
  const src = fs.readFileSync(OUT, 'utf8');
  const called = [...new Set([...html.matchAll(/call\('(api\w+)'/g)].map((m) => m[1]))];
  assert.ok(called.includes('apiStartClipUpload') && called.includes('apiUploadClipChunk') && called.includes('apiReviewClip'));
  for (const n of called) assert.match(src, new RegExp('^function ' + n + '\\(', 'm'), n + ' is missing from the bundle');
  // The page script itself must parse.
  const js = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
  assert.doesNotThrow(() => new Function(js));
});

test('dashboard call wrapper defensively guards runner and falls back to apiAction for storyboard calls', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Dashboard.html'), 'utf8');
  const callFnMatch = html.match(/function call\(name\) \{[\s\S]*?\n\}/);
  assert.ok(callFnMatch, 'function call(name) must exist in Dashboard.html');
  const callSrc = callFnMatch[0];

  function createMockGoogle(runnerProps) {
    const runner = Object.assign({
      withSuccessHandler(sh) { this._success = sh; return this; },
      withFailureHandler(fh) { this._failure = fh; return this; },
    }, runnerProps);
    return {
      script: {
        run: {
          withSuccessHandler(sh) { runner._success = sh; return runner; },
          withFailureHandler(fh) { runner._failure = fh; return runner; },
        },
      },
    };
  }

  // 1. Direct call when runner[name] exists
  {
    let directCalled = false;
    const mockGoogle = createMockGoogle({
      apiGenerateStoryboardImages: function (reelId, input) {
        directCalled = true;
        this._success({ ok: true, reelId, input });
      },
    });
    const context = { google: mockGoogle, Promise: Promise };
    vm.createContext(context);
    vm.runInContext(callSrc, context);
    const res = await context.call('apiGenerateStoryboardImages', 'PRD-001-R01', { confirmedBilling: true });
    assert.equal(directCalled, true);
    assert.equal(res.ok, true);
  }

  // 2. Fallback to apiAction when runner[name] is undefined (the exact reported bug!)
  {
    let apiActionCalledWith = null;
    const mockGoogle = createMockGoogle({
      // apiGenerateStoryboardImages is undefined!
      apiAction: function (reelId, action, input) {
        apiActionCalledWith = { reelId, action, input };
        this._success({ ok: true, detail: { reelId } });
      },
    });
    const context = { google: mockGoogle, Promise: Promise };
    vm.createContext(context);
    vm.runInContext(callSrc, context);
    const res = await context.call('apiGenerateStoryboardImages', 'PRD-001-R01', { scene: 1, confirmedBilling: true });
    assert.deepEqual(apiActionCalledWith, {
      reelId: 'PRD-001-R01',
      action: 'GENERATE_STORYBOARD_IMAGES',
      input: { scene: 1, confirmedBilling: true },
    });
    assert.equal(res.ok, true);
  }

  // 3. Fallback for apiReviewStoryboardImage and apiRegenerateStoryboardImage
  {
    const calls = [];
    const mockGoogle = createMockGoogle({
      apiAction: function (reelId, action, input) {
        calls.push({ reelId, action, input });
        this._success({ ok: true });
      },
    });
    const context = { google: mockGoogle, Promise: Promise };
    vm.createContext(context);
    vm.runInContext(callSrc, context);
    await context.call('apiReviewStoryboardImage', 'PRD-001-R01', { scene: 1, version: 1, decision: 'APPROVE' });
    await context.call('apiRegenerateStoryboardImage', 'PRD-001-R01', { scene: 1, confirmedBilling: true });
    await context.call('apiRecoverStoryboardImage', 'PRD-001-R01', { scene: 1, fileId: 'DRIVE_FILE_123' });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].action, 'REVIEW_STORYBOARD_IMAGE');
    assert.equal(calls[1].action, 'REGENERATE_STORYBOARD_IMAGE');
    assert.equal(calls[2].action, 'RECOVER_STORYBOARD_IMAGE');
  }

  // 4. Missing runner function without apiAction resolves cleanly without throwing TypeError
  {
    const mockGoogle = createMockGoogle({});
    const context = { google: mockGoogle, Promise: Promise };
    vm.createContext(context);
    vm.runInContext(callSrc, context);
    const res = await context.call('apiUnknownFunction');
    assert.equal(res.ok, false);
    assert.match(res.error, /실행할 수 없습니다/);
  }
});
