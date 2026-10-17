// Gemini as the production planner (after SCRIPT_APPROVED only): the plan, its gates and validation,
// product-image grounding, Drive asset tracking, and what the signed render job carries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));
const isPlanCall = (body) => !!body.generationConfig.responseSchema.properties.product_visual;

function setup({ images = 1, planFor, extraProductCols = true } = {}) {
  let env;
  const planCalls = [];
  env = createEnv({
    autoSelectHook: true,
    gemini: (n, body) => {
      if (isPlanCall(body)) {
        planCalls.push(body);
        return planFor ? planFor(planCalls.length, body) : plain(env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE'));
      }
      return plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
    },
  });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const ids = [];
  for (let i = 0; i < images; i++) ids.push(env.drive.addImage('product-' + (i + 1) + '.png'));
  if (extraProductCols) {
    env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
    env.sheets.PRODUCTS.rows[1].push(ids.map((id) => 'https://drive.google.com/file/d/' + id + '/view').join('\n'));
  }
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const detail = (id = 'PRD-001-R01') => call('apiGetReel', id).detail;
  const act = (name, input = {}, id = 'PRD-001-R01') => {
    const d = detail(id);
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  const plan = (id = 'PRD-001-R01') => {
    const d = detail(id);
    return call('apiCreateProductionPlan', id, { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  };
  const row = () => env.sheets.REELS.record(2);
  const audit = () => env.sheets.AUDIT.rows.slice(1).map((r) => r[env.sheets.AUDIT.rows[0].indexOf('작업')]);
  return { env, call, detail, act, plan, row, planCalls, imageIds: ids, audit, geminiCalls: () => env.state.fetches.length };
}
function approved(s) {
  assert.equal(s.call('apiGenerateScripts', 'PRD-001').ok, true);
  const r = s.act('APPROVE_SCRIPT');
  assert.equal(r.ok, true, r.error);
  return s;
}

test('no Gemini planning, no Drive read before SCRIPT_APPROVED', () => {
  const s = setup();
  s.call('apiGenerateScripts', 'PRD-001');
  const callsBefore = s.geminiCalls();
  const res = s.plan();
  assert.equal(res.ok, false);
  assert.match(res.error, /대본 승인 후에만/);
  assert.equal(s.geminiCalls(), callsBefore, 'no Gemini call');
  assert.equal(s.row()['제작 계획(JSON)'], '');
  const d = s.detail();
  assert.equal(d.production.visible, false);
  assert.equal(d.production.canPlan, false);
  assert.ok(!s.audit().includes('SET_PRODUCTION_PLAN'));
  // …nor through the generic action endpoint.
  assert.equal(s.call('apiAction', 'PRD-001-R01', 'SET_PRODUCTION_PLAN', {}).ok, false);
});

test('product visuals need verified product images: none listed or unreadable → refused before Gemini', () => {
  const none = approved(setup({ extraProductCols: false }));
  let before = none.geminiCalls();
  let res = none.plan();
  assert.equal(res.ok, false);
  assert.match(res.error, /검증된 제품 이미지가 없습니다.*검증된 제품 이미지" 열/);
  assert.equal(none.geminiCalls(), before);

  const bad = approved(setup({ images: 0 }));
  bad.env.sheets.PRODUCTS.rows[1][9] = 'https://drive.google.com/file/d/' + 'ZZZZZZZZZZZZZZZZZZZZZZZZ' + '/view';
  before = bad.geminiCalls();
  res = bad.plan();
  assert.equal(res.ok, false);
  assert.match(res.error, /Drive에서 열 수 없습니다/);
  assert.equal(bad.geminiCalls(), before);

  const notImage = approved(setup({ images: 0 }));
  const clip = notImage.env.drive.addFile('', 'demo.mp4', 'x', 'video/mp4');
  notImage.env.sheets.PRODUCTS.rows[1][9] = clip;
  res = notImage.plan();
  assert.match(res.error, /이미지가 아닙니다/);
});

test('approved script → one Gemini call with the product images; plan is bound to the approved fingerprint', () => {
  const s = approved(setup({ images: 2 }));
  const before = s.row();
  const calls = s.geminiCalls();
  const res = s.plan();
  assert.equal(res.ok, true, res.error);
  assert.equal(s.geminiCalls(), calls + 1, 'exactly one planning call');
  // The images travel with the request; the script is quoted but may not change.
  const parts = s.planCalls[0].contents[0].parts;
  assert.equal(parts.filter((p) => p.inlineData).length, 2);
  assert.ok(parts[0].text.includes('승인된 대본은 한 글자도 바꾸지 말고'));
  assert.ok(parts[0].text.includes('product-1.png'));
  assert.ok(!parts[0].text.includes('link.coupang.com'), 'no affiliate URL is sent to Gemini');

  const r = s.row();
  const plan = JSON.parse(r['제작 계획(JSON)']);
  assert.equal(plan.approvedHash, r['승인 대본 해시']);
  assert.equal(plan.scriptVersion, 1);
  assert.equal(plan.flowProvider, 'manual');
  assert.equal(plan.references.length, 2);
  // Script, status and approval are untouched; only the plan and the Flow scene prompts were written.
  for (const k of ['컨셉', '후킹', '내레이션', '자막', '장면(JSON)', 'Flow 프롬프트', 'CTA', 'ManyChat 키워드', '광고 표기', '사용한 확인 기능', '상태', '승인 대본 해시', '승인 대본 버전', '대본 버전']) {
    assert.equal(r[k], before[k], k);
  }
  assert.equal(s.detail().summary.status, 'SCRIPT_APPROVED');
  assert.ok(s.audit().includes('SET_PRODUCTION_PLAN'));
  // Scene-by-scene Flow prompts now use Gemini's scene text AND the verified product look, with the
  // code-built identity/feature/no-logo scaffold intact.
  const prompts = JSON.parse(r['Flow 장면 프롬프트']);
  assert.equal(prompts.length, 6);
  assert.ok(prompts.every((p) => p.planned));
  assert.match(prompts[2].prompt, /PRODUCT LOOK \(from the verified product images/);
  assert.match(prompts[2].prompt, /Must match: two separate pieces/);
  assert.match(prompts[2].prompt, /Never show: screws, drills or adhesive/);
  assert.match(prompts[2].prompt, /SCENE: Close-up of a hand placing the holder onto the lower part of the steel apartment front door/);
  assert.match(prompts[2].prompt, /Verified features only:/);
  assert.match(prompts[2].prompt, /product-1\.png, product-2\.png/);
  assert.match(prompts[2].prompt, /No on-screen text, subtitles, watermarks or logos/);
  // The dashboard shows the plan, the manual-Flow note and the next step.
  const d = s.detail();
  assert.equal(d.production.plan.scenes.length, 6);
  assert.match(d.production.flowNote, /공식 공개 API가 없어/);
  assert.equal(d.production.flowProvider, 'manual');
  assert.equal(d.production.referenceImages, 2);
});

test('plan validation: verbatim narration, bounded rates/pauses, real emphasis words, cut lengths, no unverified scene attributes', () => {
  const base = () => {
    const s = setup();
    return Object.assign(s, { fx: () => plain(s.env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE')) });
  };
  const s = approved(base());
  const row = s.env.sheets.REELS.record(2);
  const product = plain(s.env.gs('FIXTURE_PRD_001_PRODUCT'));
  const refs = [{ fileId: 'a', name: 'p.png' }];
  const check = (mut) => {
    const p = s.fx();
    mut(p);
    const rowObj = plain(row);
    return plain(s.env.gs('validateProductionPlan')(p, rowObj, product, refs)).errors.join('\n');
  };
  assert.equal(check(() => {}), '');
  assert.match(check((p) => { p.narration[2].tts_text = '자석이라 어디든 붙여요'; }), /장면 3: tts_text는 승인된 narration과 같아야 합니다/);
  assert.match(check((p) => { p.narration[0].speaking_rate = 1.5; }), /speaking_rate는 0\.9~1\.15/);
  assert.match(check((p) => { p.narration[0].speaking_rate = 0.5; }), /speaking_rate/);
  assert.match(check((p) => { p.narration[1].pause_after_sec = 2; }), /pause_after_sec는 0~0\.6/);
  assert.match(check((p) => { p.subtitles[3].emphasis_words = ['없는단어']; }), /emphasis_words "없는단어"가 narration에 없습니다/);
  assert.match(check((p) => { p.subtitles[3].emphasis_words = ['긴', '우산도', '쏙']; }), /최대 2개/);
  assert.match(check((p) => { p.edit[3].cuts = [{ framing: 'a' }]; }), /컷 1개면 컷당 5\.0초/);
  assert.match(check((p) => { p.edit[0].cuts = Array.from({ length: 4 }, () => ({ framing: 'x' })); }), /컷당 0\.8초/);
  assert.match(check((p) => { p.scenes[2].scene_prompt = 'A hand drills two screws into the refrigerator door to hang the holder in the kitchen.'; }), /확인된 기능에 없는 내용이 있습니다: "(refrigerator|drill|screw)"/);
  assert.match(check((p) => { p.scenes[0].scene_prompt = '비 오는 날 현관에 젖은 우산이 굴러다니는 장면을 한국어로 길게 길게 설명합니다 정말로'; }), /영어여야 합니다/);
  assert.match(check((p) => { p.scenes[0].verify_in_clip = []; }), /verify_in_clip/);
  assert.match(check((p) => { p.scenes.pop(); }), /scenes는 장면 수\(6\)와 같아야 합니다/);
  assert.match(check((p) => { p.product_visual.summary = ''; }), /product_visual\.summary/);
  assert.match(check((p) => { p.product_visual.must_match = []; }), /must_match/);
  assert.match(check((p) => { p.product_visual.summary = '최저가 우산꽂이'; }), /과장\/검증 불가 표현/);
});

test('invalid plan costs one corrective retry (with the exact errors); two bad answers save nothing', () => {
  let fx;
  const retry = approved(setup({
    planFor: (n) => {
      const p = plain(fx());
      if (n === 1) p.narration[2].tts_text = '자석이라 어디든 붙여요';
      return p;
    },
  }));
  fx = () => retry.env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE');
  const res = retry.plan();
  assert.equal(res.ok, true, res.error);
  assert.equal(retry.planCalls.length, 2);
  const text = retry.planCalls[1].contents[0].parts[0].text;
  assert.match(text, /이전 응답의 검증 오류/);
  assert.match(text, /장면 3: tts_text는 승인된 narration과 같아야 합니다/);

  let fx2;
  const bad = approved(setup({ planFor: () => { const p = plain(fx2()); p.narration[0].speaking_rate = 3; return p; } }));
  fx2 = () => bad.env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE');
  const before = JSON.stringify(bad.row());
  const r2 = bad.plan();
  assert.equal(r2.ok, false);
  assert.match(r2.error, /검증을 통과하지 못했습니다. 아무것도 저장하지 않았습니다/);
  assert.equal(bad.planCalls.length, 2, 'at most 2 calls');
  assert.equal(JSON.stringify(bad.row()), before, 'REELS unchanged');
});

test('the plan is void after the approval is withdrawn or the script changes; no stale plan reaches a job', () => {
  const s = approved(setup());
  assert.equal(s.plan().ok, true);
  assert.ok(JSON.parse(s.row()['Flow 장면 프롬프트']).length);
  const r = s.act('REOPEN_SCRIPT');
  assert.equal(r.ok, true, r.error);
  assert.equal(s.row()['제작 계획(JSON)'], '');
  assert.equal(s.row()['Flow 장면 프롬프트'], '');
  assert.equal(s.detail().production.visible, false);
  // Re-approving does not resurrect a plan: Gemini must plan again for the new approval.
  assert.equal(s.act('APPROVE_SCRIPT').ok, true);
  assert.equal(s.detail().production.plan, null);
  // A plan whose fingerprint no longer matches (e.g. sheet edit after approval) is ignored.
  assert.equal(s.plan().ok, true);
  const rowNum = 2;
  const col = s.env.sheets.REELS.rows[0].indexOf('내레이션');
  s.env.sheets.REELS.rows[rowNum - 1][col] = '바뀐 내레이션';
  assert.equal(s.detail().production.plan, null);
  assert.equal(s.plan().ok, false, 'approved script changed → no planning');
});

test('Drive: folder per reel, one tracker row per Flow clip, upload sync, unexpected files listed; no AUDIT noise', () => {
  const s = approved(setup());
  assert.equal(s.plan().ok, true);
  const auditBefore = s.audit().length;
  let d = s.detail();
  const prep = s.call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  assert.equal(prep.ok, true, prep.error);
  const folder = s.env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01');
  assert.ok(folder, 'Reels Factory / PRD-001 / PRD-001-R01 created');
  let a = prep.detail.production.assets;
  assert.deepEqual(a.clips.map((c) => c.file), ['S1.mp4', 'S2.mp4', 'S3.mp4', 'S4.mp4', 'S5.mp4', 'S6.mp4']);
  assert.ok(a.clips.every((c) => c.status === 'MISSING'));
  assert.equal(a.uploaded + '/' + a.total, '0/6');
  assert.match(a.folderUrl, /drive\.google\.com\/drive\/folders\//);
  // Operator generates two clips in Flow and uploads them (one with a different case/extension), plus a stray file.
  s.env.drive.addFile(folder.id, 'S1.mp4', 'clip1');
  s.env.drive.addFile(folder.id, 's2.MOV', 'clip2');
  s.env.drive.addFile(folder.id, 'notes.txt', 'n', 'text/plain');
  s.env.drive.addFile(folder.id, 'S9.mp4', 'clip9');
  d = s.detail();
  const sync = s.call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  a = sync.detail.production.assets;
  assert.deepEqual(a.clips.map((c) => c.status), ['UPLOADED', 'UPLOADED', 'MISSING', 'MISSING', 'MISSING', 'MISSING']);
  assert.deepEqual(a.extra.sort(), ['S9.mp4', 'notes.txt']);
  assert.equal(a.uploaded, 2);
  assert.equal(s.audit().length, auditBefore, 'tracking is not an operator decision → no AUDIT rows');
  // Second prepare reuses the folder.
  assert.equal(Object.values(s.env.drive.nodes).filter((n) => n.kind === 'folder' && n.name === 'PRD-001-R01').length, 1);
});

test('render job carries the plan, product images and Drive clips — and only for the current approval', () => {
  const s = approved(setup());
  assert.equal(s.plan().ok, true);
  let d = s.detail();
  s.call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  const folder = s.env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01');
  s.env.drive.addFile(folder.id, 'S1.mp4', 'clip1');
  d = s.detail();
  s.call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  assert.equal(s.act('START_VIDEO').ok, true);
  // The clip gate: no job file until every Flow clip is uploaded and approved in the dashboard.
  assert.match(s.call('apiGetRenderJob', 'PRD-001-R01').error, /모든 장면 클립이 승인되어야/);
  require('./helpers/media').api(s.env).approveAll();
  const job = s.call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(job.ok, true, job.error);
  const payload = JSON.parse(JSON.parse(job.jobFile).payload);
  assert.equal(payload.productionPlan.approvedHash, payload.approvedHash);
  assert.equal(payload.productionPlan.narration.length, 6);
  assert.equal(payload.referenceImages.length, 1);
  assert.equal(payload.drive.folderId, folder.id);
  assert.deepEqual(payload.drive.files.map((f) => f.clip), ['S1.mp4']);
  assert.equal(payload.flowPrompts.length, 6);
  assert.ok(payload.flowPrompts.every((p) => p.planned));
  assert.equal(payload.clipManifest.clips.length, 6);
  assert.ok(!JSON.stringify(payload).includes('link.coupang.com'), 'no affiliate URL in the job');
});

test('without a plan the existing code-built Flow prompts and render job still work (backward compatible)', () => {
  const s = approved(setup());
  assert.equal(s.act('START_VIDEO').ok, true);
  const payload = JSON.parse(JSON.parse(s.call('apiGetRenderJob', 'PRD-001-R01').jobFile).payload);
  assert.equal(payload.productionPlan, null);
  assert.equal(payload.drive, null);
  assert.equal(payload.flowPrompts.length, 6);
  assert.ok(payload.flowPrompts.every((p) => !p.planned));
});

test('production columns are required before any Gemini call (시트 준비)', () => {
  const s = approved(setup());
  const sheet = s.env.sheets.REELS;
  const idx = sheet.rows[0].indexOf('제작 계획(JSON)');
  sheet.rows.forEach((r) => r.splice(idx, 1));
  const before = s.geminiCalls();
  const res = s.plan();
  assert.equal(res.ok, false);
  assert.match(res.error, /REELS에 제작 열이 없습니다 \(제작 계획\(JSON\)\).*시트 준비/);
  assert.equal(s.geminiCalls(), before);
});

test('product images are capped (per image and in total) before any Gemini call', () => {
  const big = approved(setup({ images: 0 }));
  const d = big.env.drive;
  const mk = (n, bytes) => d.addFile('', n, Buffer.alloc(bytes, 1), 'image/png');
  const link = (id) => 'https://drive.google.com/file/d/' + id + '/view';
  big.env.sheets.PRODUCTS.rows[1][9] = link(mk('huge.png', 3 * 1024 * 1024 + 1));
  let before = big.geminiCalls();
  let res = big.plan();
  assert.match(res.error, /너무 큽니다/);
  assert.equal(big.geminiCalls(), before);
  big.env.sheets.PRODUCTS.rows[1][9] = [1, 2, 3, 4].map((i) => link(mk('p' + i + '.png', 3 * 1024 * 1024))).join('\n');
  res = big.plan();
  assert.match(res.error, /전체 크기가 10MB를 넘습니다/);
  assert.equal(big.geminiCalls(), before);
  // At most 4 images are ever read, extra links are ignored.
  const six = Array.from({ length: 6 }, (_, i) => link(mk('s' + i + '.png', 10))).join('\n');
  assert.equal(plain(big.env.gs('parseReferenceImages')(six)).length, 4);
});
