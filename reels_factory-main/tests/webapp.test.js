// End-to-end tests of the iPhone dashboard API (WebApp.gs) running from the installed bundle,
// with Sheets as the system of record. Covers Issue #2 acceptance criteria.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const DRIVE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing';
const AFFILIATE = 'https://link.coupang.com/a/abc123';
const plain = (v) => JSON.parse(JSON.stringify(v));

function fixture(env) {
  return plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
}

// Fresh workbook with PRD-001 (permission 미확인, no affiliate URL), set up via the menu.
function setup(over = {}) {
  const env = createEnv(Object.assign({ gemini: (n) => fixture(env) }, over));
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs));
  env.gs('setupSheets()');
  return env;
}
const api = (env, fn, ...args) => plain(env.gs(fn).apply(null, args));
function action(env, reelId, name, input = {}) {
  const d = api(env, 'apiGetReel', reelId).detail;
  const base = { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion };
  return api(env, 'apiAction', reelId, name, Object.assign(base, input));
}
function auditActions(env) {
  return env.sheets.AUDIT.rows.slice(1).map((r) => r[3]);
}
function reelRow(env, reelId) {
  const i = env.sheets.REELS.rows.findIndex((r) => r[0] === reelId);
  return { n: i + 1, rec: env.sheets.REELS.record(i + 1) };
}

test('setup registers the sheet owner as the only reviewer and creates AUDIT', () => {
  const env = setup();
  assert.equal(env.props.RF_REVIEWERS, 'owner@example.com');
  assert.ok(env.sheets.AUDIT);
  assert.match(env.state.alerts.at(-1), /✓ 대시보드 검토자: owner@example\.com/);
});

test('unauthenticated or unlisted accounts get no data and cannot write', () => {
  const env = setup();
  env.state.email = 'intruder@example.com';
  const res = api(env, 'apiGetDashboard');
  assert.equal(res.ok, false);
  assert.match(res.error, /검토 권한이 없습니다/);
  assert.equal(api(env, 'apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', {}).ok, false);
  assert.equal(api(env, 'apiGenerateScripts', 'PRD-001').ok, false);
  const page = env.gs('doGet()').getContent();
  assert.match(page, /접근할 수 없습니다/);
  assert.doesNotMatch(page, /google\.script\.run/);

  env.state.email = '';
  assert.match(api(env, 'apiGetDashboard').error, /웹 앱에 액세스하는 사용자/);
  assert.equal(env.state.fetches.length, 0);
});

test('reviewers must be configured; the dashboard never runs open', () => {
  const env = createEnv({});
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs));
  assert.match(api(env, 'apiGetDashboard').error, /검토자가 등록되지 않았습니다/);
});

test('doGet serves the mobile dashboard to the reviewer', () => {
  const env = setup();
  const out = env.gs('doGet()');
  assert.equal(out.meta.viewport, 'width=device-width, initial-scale=1, viewport-fit=cover');
  assert.match(out.getContent(), /google\.script\.run/);
  assert.match(out.getContent(), /릴스 팩토리/);
});

test('full lifecycle on the phone: four touchpoints, gated and audited', () => {
  const env = setup();
  const productsBefore = JSON.stringify(env.sheets.PRODUCTS.rows);

  // ① Product → five hooks + one script from the dashboard.
  const gen = api(env, 'apiGenerateScripts', 'PRD-001');
  assert.equal(gen.ok, true, gen.error);
  assert.deepEqual(gen.ids, ['PRD-001-R01']);
  assert.equal(env.state.fetches.length, 1);
  const again = api(env, 'apiGenerateScripts', 'PRD-001');
  assert.equal(again.needsConfirm, 1, 'no paid call without confirmation');
  assert.equal(env.state.fetches.length, 1);

  const dash = api(env, 'apiGetDashboard');
  assert.equal(dash.reels.length, 1);
  assert.ok(dash.reels.every((r) => r.status === 'SCRIPT_REVIEW_PENDING'));

  // Video work is impossible before script approval.
  assert.match(action(env, 'PRD-001-R01', 'START_VIDEO').error, /할 수 없습니다/);

  // ② Approve script v1 (double tap is harmless).
  const ap = action(env, 'PRD-001-R01', 'APPROVE_SCRIPT');
  assert.equal(ap.ok, true, ap.error);
  assert.equal(ap.detail.summary.status, 'SCRIPT_APPROVED');
  const dbl = api(env, 'apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1 });
  assert.equal(dbl.noop, true);

  // Permission not verified → blocked. Operator fixes PRODUCTS (touchpoint 1).
  assert.match(action(env, 'PRD-001-R01', 'START_VIDEO').error, /영상 사용 허가/);
  env.sheets.PRODUCTS.set(2, '영상 사용 허가 상태', '허가 완료');
  assert.equal(action(env, 'PRD-001-R01', 'START_VIDEO').detail.summary.status, 'VIDEO_IN_PRODUCTION');

  // Manual Flow/FFmpeg placeholder: register the finished MP4.
  const reg = action(env, 'PRD-001-R01', 'REGISTER_VIDEO', { videoUrl: DRIVE });
  assert.equal(reg.detail.summary.status, 'VIDEO_REVIEW_PENDING');
  assert.equal(reg.detail.video.previewUrl, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview');

  // ③ Approve video → publishing prep is blocked by the missing affiliate link (recorded, not hidden).
  const av = action(env, 'PRD-001-R01', 'APPROVE_VIDEO');
  assert.equal(av.ok, true, av.error);
  assert.equal(av.detail.summary.status, 'VIDEO_APPROVED');
  assert.match(av.notice, /쿠팡파트너스 URL/);
  assert.ok(auditActions(env).includes('READY_TO_PUBLISH_BLOCKED'));
  assert.equal(api(env, 'apiGetPublishingPack', 'PRD-001-R01').ok, false);

  env.sheets.PRODUCTS.set(2, '쿠팡파트너스 URL', AFFILIATE);
  assert.equal(action(env, 'PRD-001-R01', 'MARK_READY_TO_PUBLISH').detail.summary.status, 'READY_TO_PUBLISH');

  // ④ Publishing pack, then manual confirmations.
  const pack = api(env, 'apiGetPublishingPack', 'PRD-001-R01').pack;
  assert.ok(pack.instagramCaption.startsWith('[광고] '));
  assert.equal(pack.manychatKeyword, '우산', 'customer-facing keyword');
  assert.match(pack.manychatDm, /link\.coupang\.com\/a\/abc123/);
  action(env, 'PRD-001-R01', 'CONFIRM_PUBLISHED', { instagramUrl: 'https://www.instagram.com/reel/xyz/' });
  const done = action(env, 'PRD-001-R01', 'CONFIRM_MANYCHAT');
  assert.equal(done.detail.summary.status, 'COMPLETED');
  assert.deepEqual(done.detail.touchpoints.map((t) => t.done), [true, true, true, true]);

  // Audit trail, in order, with the reviewer recorded.
  const rows = env.sheets.AUDIT.rows.slice(1).filter((r) => r[1] === 'PRD-001-R01' || r[3] === 'PRODUCT_SUBMITTED');
  assert.deepEqual(rows.map((r) => r[3]), [
    'PRODUCT_SUBMITTED', 'SCRIPTS_GENERATED', 'SELECT_HOOK', 'APPROVE_SCRIPT', 'START_VIDEO', 'REGISTER_VIDEO', 'APPROVE_VIDEO',
    'READY_TO_PUBLISH_BLOCKED', 'MARK_READY_TO_PUBLISH', 'CONFIRM_PUBLISHED', 'CONFIRM_MANYCHAT',
  ]);
  assert.ok(rows.filter((r) => /APPROVE|CONFIRM/.test(r[3])).every((r) => r[8] === 'owner@example.com'));
  assert.equal(done.detail.history[0].action, 'CONFIRM_MANYCHAT');

  // PRODUCTS: only the two cells the operator changed differ.
  const before = JSON.parse(productsBefore);
  before[1][7] = '허가 완료';
  before[1][5] = AFFILIATE;
  assert.deepEqual(env.sheets.PRODUCTS.rows, before);

  // Nothing was published or sent anywhere: the only outbound calls were Gemini.
  assert.equal(env.state.fetches.length, 1);
});

test('the dashboard never exposes the API key, and the affiliate URL only in the publishing pack', () => {
  const env = setup();
  env.sheets.PRODUCTS.set(2, '쿠팡파트너스 URL', AFFILIATE);
  api(env, 'apiGenerateScripts', 'PRD-001');
  const blob = JSON.stringify([api(env, 'apiGetDashboard'), api(env, 'apiGetReel', 'PRD-001-R01')]);
  assert.doesNotMatch(blob, /test-key/);
  assert.doesNotMatch(blob, /link\.coupang\.com/);
});

test('a script edited in the sheet after approval cannot go to video', () => {
  const env = setup();
  env.sheets.PRODUCTS.set(2, '영상 사용 허가 상태', '허가 완료');
  api(env, 'apiGenerateScripts', 'PRD-001');
  action(env, 'PRD-001-R01', 'APPROVE_SCRIPT');
  const { n } = reelRow(env, 'PRD-001-R01');
  env.sheets.REELS.set(n, '내레이션', '시트에서 몰래 바꾼 내레이션');
  const res = action(env, 'PRD-001-R01', 'START_VIDEO');
  assert.equal(res.ok, false);
  assert.match(res.error, /승인된 대본과 현재 대본이 다릅니다/);
  assert.equal(api(env, 'apiGetReel', 'PRD-001-R01').detail.approvedIntact, false);
});

test('edit on the phone → new version → approve exactly that version', () => {
  const env = setup();
  api(env, 'apiGenerateScripts', 'PRD-001');
  const ed = action(env, 'PRD-001-R01', 'EDIT_SCRIPT', { edit: { hook: '우산꽂이, 문에 붙이면 끝' }, note: '짧게' });
  assert.equal(ed.ok, true, ed.error);
  assert.equal(ed.detail.summary.scriptVersion, 2);
  const bad = action(env, 'PRD-001-R01', 'EDIT_SCRIPT', { edit: { narration: '10초면 설치 끝' } });
  assert.match(bad.error, /수치/);
  const ap = action(env, 'PRD-001-R01', 'APPROVE_SCRIPT');
  assert.equal(ap.detail.approvedVersion, '2');
  assert.equal(reelRow(env, 'PRD-001-R01').rec['후킹'], '우산꽂이, 문에 붙이면 끝');
});

test('request changes → Gemini regenerates one script (1-reel schema, reviewer note in prompt)', () => {
  const env = setup({
    gemini: (n, body) => {
      const f = plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
      return n === 1 ? f : { reels: [f.reels[0]] };
    },
  });
  api(env, 'apiGenerateScripts', 'PRD-001');
  assert.equal(api(env, 'apiRegenerateScript', 'PRD-001-R01', { expectedScriptVersion: 1 }).ok, false, 'needs 수정 요청 first');
  action(env, 'PRD-001-R01', 'REQUEST_SCRIPT_CHANGES', { note: '치수 이야기를 넣어 주세요' });
  const res = api(env, 'apiRegenerateScript', 'PRD-001-R01', { expectedScriptVersion: 1 });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.detail.summary.status, 'SCRIPT_REVIEW_PENDING');
  assert.equal(res.detail.summary.scriptVersion, 2);
  const body = env.state.fetches[1];
  assert.equal(body.generationConfig.responseSchema.properties.reels.maxItems, 1);
  assert.equal(body.generationConfig.responseSchema.properties.hooks, undefined, 'the five hooks are kept, not regenerated');
  assert.match(body.contents[0].parts[0].text, /치수 이야기를 넣어 주세요/);
  assert.match(body.contents[0].parts[0].text, /현재 대본/);
  assert.ok(auditActions(env).includes('REGENERATE_SCRIPT'));
});

test('failed regeneration leaves the script untouched', () => {
  const env = setup({
    gemini: (n) => {
      const f = plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
      if (n === 1) return f;
      f.reels[0].hook = '최저가 우산꽂이';
      return { reels: [f.reels[0]] };
    },
  });
  api(env, 'apiGenerateScripts', 'PRD-001');
  action(env, 'PRD-001-R01', 'REQUEST_SCRIPT_CHANGES', { note: 'x' });
  const before = reelRow(env, 'PRD-001-R01').rec;
  const res = api(env, 'apiRegenerateScript', 'PRD-001-R01', { expectedScriptVersion: 1 });
  assert.equal(res.ok, false);
  assert.match(res.error, /검증을 통과하지 못했습니다/);
  assert.equal(env.state.fetches.length, 3, '1 generate + 2 regenerate attempts');
  assert.deepEqual(reelRow(env, 'PRD-001-R01').rec, before);
});

test('only whitelisted actions are callable from the client', () => {
  const env = setup();
  api(env, 'apiGenerateScripts', 'PRD-001');
  action(env, 'PRD-001-R01', 'REQUEST_SCRIPT_CHANGES', { note: 'x' });
  const res = action(env, 'PRD-001-R01', 'REGENERATE_SCRIPT', { reel: fixture(env).reels[0] });
  assert.match(res.error, /허용되지 않은 작업/);
});

test('existing MVP REELS rows are preserved and become reviewable after 시트 준비', () => {
  const env = createEnv({ reviewers: 'owner@example.com', gemini: () => fixture(env) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs));
  // Simulate a REELS sheet written by PR #1 (MVP headers only) plus an operator column.
  const mvpHeaders = env.gs('RF_CONFIG.REELS_HEADERS').slice(0, 19).concat(['운영자 메모']);
  const recs = plain(env.gs('prepareReelRecords')(env.gs('FIXTURE_PRD_001_PRODUCT'), JSON.stringify(fixture(env)), [], [], { model: 'old', generatedAt: 'g' }).records);
  const legacyRows = recs.map((r) => mvpHeaders.map((h) => (h === '운영자 메모' ? '메모 유지' : h === '제작 상태' ? '대본 검토 대기' : r[h] ?? '')));
  env.sheets.REELS = new (require('./helpers/apps-script-mock').MockSheet)('REELS', [mvpHeaders, ...legacyRows]);
  const snapshot = JSON.stringify(env.sheets.REELS.rows);

  const dash = api(env, 'apiGetDashboard');
  assert.equal(dash.reels[0].status, 'SCRIPT_REVIEW_PENDING');
  assert.match(dash.warnings[0], /시트 준비/);
  const blocked = action(env, 'PRD-001-R01', 'APPROVE_SCRIPT');
  assert.match(blocked.error, /시트 준비/);
  assert.equal(JSON.stringify(env.sheets.REELS.rows), snapshot, 'nothing written while headers are missing');

  env.gs('setupSheets()');
  const header = env.sheets.REELS.rows[0];
  assert.deepEqual(header.slice(0, 20), mvpHeaders, 'existing headers untouched');
  assert.ok(header.includes('상태') && header.includes('승인 대본 해시') && header.includes('훅 후보(JSON)'));
  // An old script has no hook candidates: approval waits until five hooks are made and one is chosen.
  assert.match(action(env, 'PRD-001-R01', 'APPROVE_SCRIPT').error, /훅 후보 5개가 없습니다/);
  const d = api(env, 'apiGetReel', 'PRD-001-R01').detail;
  assert.equal(d.hooks.canGenerate, true);
  const made = api(env, 'apiGenerateHooks', 'PRD-001-R01', { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  assert.equal(made.ok, true, made.error);
  assert.equal(made.detail.hooks.candidates.length, 5);
  assert.equal(made.detail.summary.scriptVersion, d.summary.scriptVersion, 'the script itself is unchanged');
  const ok = action(env, 'PRD-001-R01', 'APPROVE_SCRIPT');
  assert.equal(ok.ok, true, ok.error);
  const rec = reelRow(env, 'PRD-001-R01').rec;
  assert.equal(rec['상태'], 'SCRIPT_APPROVED');
  assert.equal(rec['운영자 메모'], '메모 유지');
  assert.equal(rec['후킹'], legacyRows[0][mvpHeaders.indexOf('후킹')]);
});

test('menu: dashboard link shows deployment steps or the escaped URL', () => {
  const env = setup();
  env.gs('showDashboardLink()');
  assert.match(env.state.alerts.at(-1), /웹 앱에 액세스하는 사용자/);
  const env2 = setup({ serviceUrl: 'https://script.google.com/macros/s/AKfy"x/exec' });
  env2.gs('showDashboardLink()');
  assert.match(env2.state.alerts.at(-1), /AKfy&quot;x\/exec/);
});

test('dashboard HTML renders data without innerHTML', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Dashboard.html'), 'utf8');
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new (require('node:vm').Script)(script));
});

test('apiAction supports storyboard actions with full safeguards (billing, approval, rights)', () => {
  const env = createEnv({
    autoSelectHook: true,
    gemini: (n, body) => {
      const isImg = body.generationConfig &&
        Array.isArray(body.generationConfig.responseModalities) &&
        body.generationConfig.responseModalities.includes('IMAGE');
      if (isImg) {
        return {
          inlineData: {
            mimeType: 'image/png',
            data: Buffer.from('mock-bytes').toString('base64'),
          },
        };
      }
      return plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
    },
  });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작' }));
  const imgId = env.drive.addImage('product-ref-1.png');
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push('https://drive.google.com/file/d/' + imgId + '/view');
  env.gs('setupSheets()');
  api(env, 'apiGenerateScripts', 'PRD-001');

  // 1. Refused before script approval
  const resBefore = api(env, 'apiAction', 'PRD-001-R01', 'GENERATE_STORYBOARD_IMAGES', { scene: 1, confirmedBilling: true });
  assert.equal(resBefore.ok, false);
  assert.match(resBefore.error, /대본 승인 후에만/);

  // Approve script
  const ap = action(env, 'PRD-001-R01', 'APPROVE_SCRIPT');
  assert.equal(ap.ok, true);

  // 2. Refused if billing is not confirmed
  const noBilling = api(env, 'apiAction', 'PRD-001-R01', 'GENERATE_STORYBOARD_IMAGES', { scene: 1, confirmedBilling: false });
  assert.equal(noBilling.ok, false);
  assert.match(noBilling.error, /유료 API 호출/);

  // 3. Generation succeeds via apiAction when billing is confirmed
  const gen = api(env, 'apiAction', 'PRD-001-R01', 'GENERATE_STORYBOARD_IMAGES', { scene: 1, confirmedBilling: true });
  assert.equal(gen.ok, true, gen.error);
  assert.ok(gen.detail.storyboard);

  // 4. Review succeeds via apiAction
  const rev = api(env, 'apiAction', 'PRD-001-R01', 'REVIEW_STORYBOARD_IMAGE', { scene: 1, version: 1, decision: 'APPROVE' });
  assert.equal(rev.ok, true, rev.error);
  assert.equal(rev.detail.storyboard.images[0].status, 'APPROVED');

  // 5. Regeneration succeeds via apiAction
  const regen = api(env, 'apiAction', 'PRD-001-R01', 'REGENERATE_STORYBOARD_IMAGE', { scene: 1, confirmedBilling: true });
  assert.equal(regen.ok, true, regen.error);
  assert.equal(regen.detail.storyboard.images[0].current.v, 2);

  // 6. Recovery succeeds via apiAction without Gemini API call
  const sbFolder = env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01', 'storyboard');
  const orphanId = env.drive.addFile(sbFolder.id, 'S2_v1.png', 'orphan-bytes', 'image/png');
  const recover = api(env, 'apiAction', 'PRD-001-R01', 'RECOVER_STORYBOARD_IMAGE', { scene: 2, fileId: orphanId });
  assert.equal(recover.ok, true, recover.error);
  assert.equal(recover.detail.storyboard.images[1].current.fileId, orphanId);
  assert.equal(recover.detail.storyboard.images[1].status, 'PENDING_REVIEW');
});

test('api_ catches errors, logs to console.error and LOG sheet, and returns clean error object', () => {
  const env = createEnv({ reviewers: 'owner@example.com' });
  const loggedErrors = [];
  const origConsoleError = console.error;
  console.error = (msg) => { loggedErrors.push(msg); };

  try {
    // Calling an invalid action triggers an error inside api_
    const res = api(env, 'apiAction', 'PRD-001-R01', 'INVALID_ACTION_TEST', {});
    assert.equal(res.ok, false);
    assert.match(res.error, /허용되지 않은 작업/);

    // Verify error was logged to console.error
    assert.ok(loggedErrors.some((e) => String(e).includes('[API Error]') && String(e).includes('허용되지 않은 작업')));

    // Verify error was logged to LOG sheet
    const logRows = env.sheets.LOG ? env.sheets.LOG.rows.slice(1) : [];
    assert.ok(logRows.some((r) => r.includes('ERROR') && r.some((c) => String(c).includes('허용되지 않은 작업'))));
  } finally {
    console.error = origConsoleError;
  }
});

