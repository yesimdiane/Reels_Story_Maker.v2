// Reels Factory v3 — Workflow Simplification tests
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));
const isPlanCall = (body) => !!(body && body.generationConfig && body.generationConfig.responseSchema && body.generationConfig.responseSchema.properties && body.generationConfig.responseSchema.properties.product_visual);

function createTestEnv(over = {}) {
  let env;
  env = createEnv(Object.assign({
    autoSelectHook: true,
    gemini: (n, body) => {
      if (isPlanCall(body)) return plain(env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE'));
      return plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
    },
  }, over));
  return env;
}

test('v3 Step 1: apiCreateProductProject creates or selects a product project from URL', () => {
  const env = createTestEnv();
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/PRD001' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));

  // 1. Missing URL throws error
  assert.match(call('apiCreateProductProject', {}).error, /상품 URL을 입력하세요/);

  // 2. Existing URL selects the existing project PRD-001
  const existRes = call('apiCreateProductProject', { url: 'https://link.coupang.com/a/PRD001' });
  assert.equal(existRes.ok, true, existRes.error);
  assert.equal(existRes.created, false);
  assert.equal(existRes.product.id, 'PRD-001');

  // 3. New URL creates PRD-002
  const newRes = call('apiCreateProductProject', {
    url: 'https://link.coupang.com/a/NEW123',
    name: '스마트 센서 무드등',
    features: '모션 감지 센서 3m\n자석 부착형 거치\nC타입 충전식 배터리',
    category: '인테리어 조명',
  });
  assert.equal(newRes.ok, true, newRes.error);
  assert.equal(newRes.created, true);
  assert.equal(newRes.product.id, 'PRD-002');
  assert.equal(newRes.product.name, '스마트 센서 무드등');
  assert.equal(newRes.product.permission, '자체 제작');

  // Check PRODUCTS sheet has the new row
  const prodSheet = env.sheets.PRODUCTS;
  const newRow = prodSheet.rows.find((r) => r[0] === 'PRD-002');
  assert.ok(newRow, 'PRD-002 exists in PRODUCTS sheet');
  assert.equal(newRow[7], '자체 제작');

  // Check AUDIT log has PRODUCT_PROJECT_CREATED
  const auditRows = env.sheets.AUDIT.rows.slice(1);
  assert.ok(auditRows.some((r) => r[2] === 'PRD-002' && r[3] === 'PRODUCT_PROJECT_CREATED'));

  // 4. Submitting the same URL again selects existing PRD-002
  const selectRes = call('apiCreateProductProject', { url: 'https://link.coupang.com/a/NEW123' });
  assert.equal(selectRes.ok, true);
  assert.equal(selectRes.created, false);
  assert.equal(selectRes.product.id, 'PRD-002');
});

test('v3 Action Label: START_VIDEO label is "최종 편집 시작"', () => {
  const env = createTestEnv();
  const label = env.gs('RF_ACTIONS').START_VIDEO.label;
  assert.equal(label, '최종 편집 시작');
});

test('v3 Permission Blocker Fix: rightsConfirmed unblocks final editing without manual sheet edits', () => {
  const env = createTestEnv();
  // PRD-001 with unverified permission ('미확인')
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '미확인', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));

  // Generate scripts and approve script
  assert.equal(call('apiGenerateScripts', 'PRD-001').ok, true);
  const ap = call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  assert.equal(ap.ok, true, ap.error);

  // START_VIDEO without rights confirmation is blocked
  const blocked = call('apiAction', 'PRD-001-R01', 'START_VIDEO', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /영상 사용 허가 상태/);

  // START_VIDEO with rightsConfirmed: true resolves blocker and sets permission to '자체 제작'
  const started = call('apiAction', 'PRD-001-R01', 'START_VIDEO', {
    expectedStatus: 'SCRIPT_APPROVED',
    expectedScriptVersion: 1,
    expectedVideoVersion: 0,
    rightsConfirmed: true,
  });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.detail.summary.status, 'VIDEO_IN_PRODUCTION');

  // Verify PRODUCTS sheet was updated to '자체 제작'
  const prodRow = env.sheets.PRODUCTS.rows.find((r) => r[0] === 'PRD-001');
  assert.equal(prodRow[7], '자체 제작');
});

test('v3 Action: CONFIRM_MEDIA_RIGHTS sets permission to 자체 제작 and stays in current status', () => {
  const env = createTestEnv();
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '미확인', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));

  assert.equal(call('apiGenerateScripts', 'PRD-001').ok, true);
  assert.equal(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 }).ok, true);

  // Operator confirms media rights from dashboard control
  const confirmed = call('apiAction', 'PRD-001-R01', 'CONFIRM_MEDIA_RIGHTS', {
    expectedStatus: 'SCRIPT_APPROVED',
    expectedScriptVersion: 1,
    expectedVideoVersion: 0,
  });
  assert.equal(confirmed.ok, true, confirmed.error);
  assert.equal(confirmed.detail.summary.status, 'SCRIPT_APPROVED');
  assert.equal(confirmed.detail.product.permission, '자체 제작');
  assert.equal(confirmed.detail.product.permissionOk, true);

  // START_VIDEO now proceeds directly
  const started = call('apiAction', 'PRD-001-R01', 'START_VIDEO', {
    expectedStatus: 'SCRIPT_APPROVED',
    expectedScriptVersion: 1,
    expectedVideoVersion: 0,
  });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.detail.summary.status, 'VIDEO_IN_PRODUCTION');
});

test('v3 Acceptance Criteria: PRD-001-R01 with uploaded Flow clips proceeds to final editing without Gemini image generation requirement', () => {
  const env = createTestEnv();
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const refImgId = env.drive.addImage('product-ref.png');
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push('https://drive.google.com/file/d/' + refImgId + '/view');

  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));

  // 1. Generate scripts and approve script
  assert.equal(call('apiGenerateScripts', 'PRD-001').ok, true);
  const ap = call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', {
    expectedStatus: 'SCRIPT_REVIEW_PENDING',
    expectedScriptVersion: 1,
    expectedVideoVersion: 0,
  });
  assert.equal(ap.ok, true, ap.error);

  // 2. Production plan & Drive asset tracking
  assert.equal(call('apiCreateProductionPlan', 'PRD-001-R01', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1 }).ok, true);
  call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1 });

  // 3. Simulate Flow clips uploaded to Drive (S1..S6 for PRD-001-R01)
  const reelFolder = env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01');
  const clipFiles = {};
  for (let s = 1; s <= 6; s++) {
    const fid = env.drive.addFile(reelFolder.id, 'S' + s + '.mp4', Buffer.alloc(15000, 'clip-' + s), 'video/mp4');
    clipFiles['S' + s] = fid;
  }

  // Attach and review clips via helper
  const mediaHelper = require('./helpers/media').api(env);
  mediaHelper.approveAll({
    reelId: 'PRD-001-R01',
    bytesFor: (key) => Buffer.alloc(15000, key + '-content'),
  });

  // Verify all 6 clips are APPROVED
  const d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.equal(d.media.approved, 6);
  assert.equal(d.media.allApproved, true);

  // 4. Start final editing (START_VIDEO) without any Gemini image generation call!
  const imageCallsBefore = env.state.fetches.filter((f) => f.url && f.url.includes('gemini-2.5-flash-image')).length;
  assert.equal(imageCallsBefore, 0, 'Zero Gemini image generation calls made');

  const startRes = call('apiAction', 'PRD-001-R01', 'START_VIDEO', {
    expectedStatus: 'SCRIPT_APPROVED',
    expectedScriptVersion: 1,
    expectedVideoVersion: 0,
  });
  assert.equal(startRes.ok, true, startRes.error);
  assert.equal(startRes.detail.summary.status, 'VIDEO_IN_PRODUCTION');

  // 5. Get render job for Mac worker (Claude-assisted instructions, FFmpeg, TTS)
  const jobRes = call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(jobRes.ok, true, jobRes.error);
  assert.ok(jobRes.fileName.includes('PRD-001-R01'));
  const payload = JSON.parse(JSON.parse(jobRes.jobFile).payload);
  assert.equal(payload.status, 'VIDEO_IN_PRODUCTION');
  assert.equal(payload.clipManifest.clips.length, 6);

  // Verify existing clips in Drive are untouched
  const driveFiles = env.drive.nodes;
  assert.ok(Object.values(driveFiles).some((n) => n.name === 'S1.mp4'));
  assert.ok(Object.values(driveFiles).some((n) => n.name === 'S6.mp4'));

  // Verify zero paid image generation calls occurred throughout
  const imageCallsAfter = env.state.fetches.filter((f) => f.url && f.url.includes('gemini-2.5-flash-image')).length;
  assert.equal(imageCallsAfter, 0, 'No paid image generation calls required to proceed to final editing');
});

test('v3 Bulk Clip Approval: apiApproveAllClips approves all pending clips in one call', () => {
  const env = createTestEnv();
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const refImgId = env.drive.addImage('product-ref.png');
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push('https://drive.google.com/file/d/' + refImgId + '/view');

  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));

  assert.equal(call('apiGenerateScripts', 'PRD-001').ok, true);
  assert.equal(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 }).ok, true);
  assert.equal(call('apiCreateProductionPlan', 'PRD-001-R01', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1 }).ok, true);

  // Upload S1 clip
  const helper = require('./helpers/media').api(env);
  const up = helper.upload('S1', Buffer.alloc(15000, 'clip1-bytes'));
  assert.equal(up.ok, true);

  let d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.equal(d.media.clips.find((c) => c.key === 'S1').status, 'PENDING_REVIEW');

  // Call apiApproveAllClips
  const bulkApp = call('apiApproveAllClips', 'PRD-001-R01', {});
  assert.equal(bulkApp.ok, true, bulkApp.error);
  assert.equal(bulkApp.approvedCount, 1);

  d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.equal(d.media.clips.find((c) => c.key === 'S1').status, 'APPROVED');
});

test('v3 Copyable Prompts: storyboardView provides copyable imagePrompt and motionPrompt for scenes without API calls', () => {
  const env = createTestEnv();
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const refImgId = env.drive.addImage('product-ref.png');
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push('https://drive.google.com/file/d/' + refImgId + '/view');

  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));

  assert.equal(call('apiGenerateScripts', 'PRD-001').ok, true);
  assert.equal(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 }).ok, true);

  const d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.ok(d.storyboard, 'Storyboard view is present');
  assert.ok(d.storyboard.images.length >= 5, 'Has at least 5 scenes');

  // Check scene 1 prompts
  const s1 = d.storyboard.images[0];
  assert.ok(s1.imagePrompt, 'Has copyable imagePrompt for ChatGPT/Gemini');
  assert.match(s1.imagePrompt, /Vertical 9:16 aspect ratio/i);
  assert.match(s1.imagePrompt, /리템 우산꽂이/);
  assert.ok(s1.motionPrompt, 'Has copyable motionPrompt for Google Flow');
  assert.match(s1.motionPrompt, /Google Flow/i);
});
