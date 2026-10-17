// Brand strategy "서울에서 집꾸미기": brand config, content pillars, problem-first script rules,
// truthfulness flags (manual verification before approval), AI 시뮬레이션 labelling, dashboard data,
// and compatibility with sheets that do not have the new optional columns yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEnv, prd001Row, MockSheet } = require('./helpers/apps-script-mock');
const { buildStoryboard } = require('../renderer/lib/storyboard');
const { buildTimeline } = require('../renderer/lib/plan');
const { buildAss } = require('../renderer/lib/ass');
const qc = require('../renderer/lib/qc');
const { loadTemplate } = require('../renderer/lib/template');

const plain = (v) => JSON.parse(JSON.stringify(v));
const fixture = (env) => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));

function setup(gemini, { prepare = true } = {}) {
  const env = createEnv({ gemini: gemini || (() => fixture(env)) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  if (prepare) env.gs('setupSheets()');
  const product = plain(env.gs('FIXTURE_PRD_001_PRODUCT'));
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const act = (id, name, input = {}) => {
    const d = call('apiGetReel', id).detail;
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  const validate = (payload) => plain(env.gs('validateGeminiReels')(payload, product));
  const col = (name) => env.sheets.REELS.rows[0].indexOf(name);
  return { env, product, call, act, validate, col };
}

test('brand config: name, tagline, positioning, personality and four pillars with editorial targets', () => {
  const { env } = setup(null, { prepare: false });
  const B = plain(env.gs('RF_CONFIG.BRAND'));
  assert.equal(B.NAME, '서울에서 집꾸미기');
  assert.equal(B.TAGLINE, '우리 집에 들이기 전에, 먼저 보여드릴게요.');
  assert.match(B.POSITIONING, /작은 집/);
  assert.match(B.PERSONALITY, /뻔한 판매 멘트는 쓰지 않음/);
  assert.deepEqual(Object.values(B.PILLARS).map((p) => [p.label, p.target]), [
    ['AI 공간 변신', 35], ['생활 꿀템 발견', 35], ['국제부부 한국살이', 20], ['살까 말까 비교 연구소', 10],
  ]);
  assert.equal(Object.values(B.PILLARS).reduce((n, p) => n + p.target, 0), 100);
  assert.match(B.CURRENT_FOCUS, /좁은 공간.*정리 수납/);
  assert.equal(B.AI_LABEL, 'AI 시뮬레이션');
});

test('the Gemini prompt carries the brand, pillars, PROBLEM → EMPATHY → SOLUTION → DEMONSTRATION → CTA and the new example hooks', () => {
  const { env, product } = setup(null, { prepare: false });
  const prompt = env.gs('buildGeminiPrompt')(product);
  for (const s of [
    '"서울에서 집꾸미기"', '우리 집에 들이기 전에, 먼저 보여드릴게요.', '첫 달 우선순위: 좁은 공간 생활과 실용적인 정리 수납',
    'AI_MAKEOVER (AI 공간 변신, 목표 35%)', 'PRODUCT_DISCOVERY (생활 꿀템 발견, 목표 35%)', 'INTL_COUPLE (국제부부 한국살이, 목표 20%)', 'COMPARE (살까 말까 비교 연구소, 목표 10%)',
    'PROBLEM → EMPATHY → SOLUTION → DEMONSTRATION → CTA',
    '"급하게 출근할 때마다 우산 깜빡하는 사람?"', '"원룸 살면 우산꽂이 둘 자리도 애매하잖아요."', '"비 오는 날마다 현관이 지저분해지는 이유."',
    '기능 나열로 시작하지 마세요', '남편 반응', 'needs_verification', 'ai_visualization=true', '"AI 시뮬레이션"',
  ]) assert.ok(prompt.includes(s), s);
  const items = plain(env.gs('RF_GEMINI_RESPONSE_SCHEMA')).properties.reels.items;
  assert.deepEqual(items.properties.pillar.enum, ['AI_MAKEOVER', 'PRODUCT_DISCOVERY', 'INTL_COUPLE', 'COMPARE']);
  assert.ok(items.required.includes('pillar'));
  assert.equal(items.properties.scenes.items.properties.ai_visualization.type, 'BOOLEAN');
  assert.equal(items.properties.needs_verification.type, 'ARRAY');
});

test('the new example hooks pass; feature-list hooks get a style warning (not an error)', () => {
  const { env, product } = setup(null, { prepare: false });
  const check = (hook) => plain(env.gs('hookStyleCheck_')(hook, product, []));
  for (const h of ['급하게 출근할 때마다 우산 깜빡하는 사람?', '원룸 살면 우산꽂이 둘 자리도 애매하잖아요.', '비 오는 날마다 현관이 지저분해지는 이유.']) {
    assert.deepEqual(check(h), { errors: [], warnings: [] }, h);
  }
  assert.deepEqual(check('190x55x50mm 자석 2피스 구조').errors, []);
  assert.match(check('190x55x50mm 자석 2피스 구조').warnings.join('\n'), /치수·사양을 늘어놓는 기능 나열/);
  assert.match(check('자석형 2피스 우산꽂이예요').warnings.join('\n'), /제품 이름으로 시작합니다|기능 나열/);
});

test('Gemini output: a pillar is required; invented purchases, tests and husband reactions are rejected', () => {
  const { env, validate } = setup(null, { prepare: false });
  assert.deepEqual(validate(fixture(env)).errors, []);
  const noPillar = fixture(env);
  delete noPillar.reels[0].pillar;
  assert.match(validate(noPillar).errors.join('\n'), /릴스 1: pillar는 AI_MAKEOVER, PRODUCT_DISCOVERY, INTL_COUPLE, COMPARE 중 하나/);
  for (const line of ['지난주에 샀는데 너무 좋아요', '테스트해 보니 잘 붙어요', '남편이 보고 놀랐어요', '붙였더니 현관이 넓어졌어요']) {
    const p = fixture(env);
    p.reels[0].scenes[1].narration = line;
    assert.match(validate(p).errors.join('\n'), /확인되지 않은 체험·결과 주장/, line);
  }
});

test('verification flags: personal experience, couple stories, comparisons, AI visualizations and Gemini requests', () => {
  const { env } = setup(null, { prepare: false });
  const flags = (reel, pillar) => plain(env.gs('verificationFlags')(reel, pillar)).map((f) => f.type + ' @ ' + f.where);
  const base = fixture(env).reels[0];
  assert.deepEqual(flags(base, 'PRODUCT_DISCOVERY'), [], 'the PRD-001 fixture needs no manual verification');
  const own = plain(base);
  own.scenes[1].narration = '우리 집 현관도 늘 이랬어요';
  assert.deepEqual(flags(own, 'PRODUCT_DISCOVERY'), ['개인 경험 @ 장면 2']);
  assert.deepEqual(flags(base, 'INTL_COUPLE'), ['국제부부 이야기 @ 콘텐츠 기둥']);
  assert.deepEqual(flags(base, 'COMPARE'), ['비교 @ 콘텐츠 기둥']);
  const ai = plain(base);
  ai.scenes[2].ai_visualization = true;
  assert.deepEqual(flags(ai, 'PRODUCT_DISCOVERY'), ['AI 시뮬레이션 @ 장면 3']);
  const husband = plain(base);
  husband.scenes[1].narration = '외국인 남편은 우산을 꼭 바닥에 둬요';
  assert.deepEqual(flags(husband, 'PRODUCT_DISCOVERY'), ['국제부부 이야기 @ 장면 2']);
});

test('generation writes pillar and flags; AI scenes get the on-screen label; approval needs explicit confirmation', () => {
  const payload = (env) => {
    const p = fixture(env);
    p.reels[0].pillar = 'AI_MAKEOVER';
    p.reels[0].scenes[2].ai_visualization = true;
    p.reels[0].needs_verification = ['비 오는 날 현관 사진이 실제 우리 집인지'];
    return p;
  };
  let env;
  const s = setup(() => payload(env));
  env = s.env;
  const { call, act, col } = s;
  const res = call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  const row = env.sheets.REELS.rows[1];
  assert.equal(row[col('콘텐츠 기둥')], 'AI 공간 변신');
  assert.match(row[col('확인 필요')], /\[AI 시뮬레이션\] 장면 3: 영상에 "AI 시뮬레이션" 표시/);
  assert.match(row[col('확인 필요')], /\[Gemini 요청\] 비 오는 날 현관 사진이 실제 우리 집인지/);
  assert.match(row[col('장면(JSON)')], /"on_screen_text":"AI 시뮬레이션"[^}]*"ai_visualization":true/);
  assert.match(row[col('검토 메모')], /확인 필요 항목이 있습니다/);

  // Flagged script: refused until the reviewer confirms; the confirmation is recorded in AUDIT.
  const refused = act('PRD-001-R01', 'APPROVE_SCRIPT');
  assert.equal(refused.ok, false);
  assert.match(refused.error, /확인 필요 항목 2건[\s\S]*\[AI 시뮬레이션\] 장면 3[\s\S]*\[Gemini 요청\]/);
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, false, 'no paid step before approval');
  const ok = act('PRD-001-R01', 'APPROVE_SCRIPT', { flagsConfirmed: true });
  assert.equal(ok.ok, true, ok.error);
  const audit = env.sheets.AUDIT.rows.filter((r) => r[1] === 'PRD-001-R01' && r[3] === 'APPROVE_SCRIPT');
  assert.match(audit[0][9], /확인 필요 2건 확인함: \[AI 시뮬레이션\]/);
});

test('dashboard data: pillar, problem hook, flags, brand, pillar mix; edits change the pillar and AI scenes', () => {
  const { env, call, act } = setup();
  call('apiGenerateScripts', 'PRD-001');
  const dash = call('apiGetDashboard');
  assert.equal(dash.brand.name, '서울에서 집꾸미기');
  assert.deepEqual(dash.pillarMix.map((m) => [m.label, m.count, m.target]), [['AI 공간 변신', 0, 35], ['생활 꿀템 발견', 1, 35], ['국제부부 한국살이', 0, 20], ['살까 말까 비교 연구소', 0, 10]]);
  assert.equal(dash.reels[0].pillar, '생활 꿀템 발견');
  const d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.deepEqual(d.pillar, { id: 'PRODUCT_DISCOVERY', label: '생활 꿀템 발견' });
  assert.equal(d.reel.hook, '비 오는 날, 현관에 젖은 우산이 굴러다녀요');
  assert.deepEqual(d.verificationFlags, []);
  assert.equal(d.pillars.length, 4);
  assert.ok(d.allowedActions.includes('EDIT_SCRIPT') && d.allowedActions.includes('APPROVE_SCRIPT') && d.allowedActions.includes('REJECT_SCRIPT'));
  // Edit before approval: switch pillar, mark scene 3 as an AI visualization.
  const scenes = d.reel.scenes.map((s, i) => ({ ai_visualization: i === 2 }));
  const edited = act('PRD-001-R01', 'EDIT_SCRIPT', { edit: { pillar: 'AI_MAKEOVER', scenes } });
  assert.equal(edited.ok, true, edited.error);
  assert.equal(edited.detail.pillar.label, 'AI 공간 변신');
  assert.equal(edited.detail.reel.scenes[2].on_screen_text, 'AI 시뮬레이션');
  assert.match(edited.detail.verificationFlags.join('\n'), /\[AI 시뮬레이션\] 장면 3/);
  assert.equal(edited.detail.summary.scriptVersion, 2);
  // The dashboard page has the new controls.
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Dashboard.html'), 'utf8');
  for (const s of ['콘텐츠 기둥', '모두 확인했습니다', 'flagsConfirmed', 'AI 시뮬레이션 장면 (영상에 표시)', 'renderBrand']) {
    assert.ok(html.includes(s), s);
  }
});

test('sheets without the new columns: existing scripts stay reviewable and editable; generation and approval ask for 시트 준비', () => {
  const env = createEnv({ gemini: () => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.sheets.REELS = new MockSheet('REELS', [plain(env.gs('RF_CONFIG.REELS_HEADERS'))]);
  env.props.RF_REVIEWERS = 'owner@example.com';
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  // A script written by the previous version (only the standard columns exist).
  const product = plain(env.gs('FIXTURE_PRD_001_PRODUCT'));
  const recs = env.gs('prepareReelRecords')(product, JSON.stringify(fixture(env)), [], [], { model: 'm', generatedAt: 'g' }).records;
  env.gs('appendRecords_')(env.sheets.REELS, recs, env.gs('RF_SCRIPT_FIELDS'));
  assert.ok(!env.sheets.REELS.rows[0].includes('콘텐츠 기둥'), 'no column added without 시트 준비');
  // New generation stops before any Gemini call and says what to do.
  const res = call('apiGenerateScripts', 'PRD-001', true);
  assert.equal(res.ok, false);
  assert.match(res.error, /훅 저장 열이 없습니다[\s\S]*시트 준비/);
  assert.equal(env.state.fetches.length, 0);
  const dash = call('apiGetDashboard');
  assert.match(dash.warnings.join('\n'), /REELS에 브랜드·훅·제작 열\(콘텐츠 기둥, 확인 필요, 훅 후보\(JSON\), 선택한 훅, 제작 계획\(JSON\), 에셋 현황\(JSON\), 장면 클립\(JSON\), 장면 이미지\(JSON\)\)이 없습니다[\s\S]*시트 준비/);
  const d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.equal(d.hooks.columnsMissing, true, 'the dashboard tells the operator to run 시트 준비');
  const act = (name, input = {}) => call('apiAction', 'PRD-001-R01', name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: 0 }, input));
  // Flags are computed from the script itself, so they still gate approval without the column.
  const edited = act('EDIT_SCRIPT', { edit: { hook: '우리 집 현관이 늘 이랬어요' } });
  assert.equal(edited.ok, true, edited.error);
  assert.match(edited.detail.verificationFlags.join('\n'), /\[개인 경험\] hook/);
  const d2 = edited.detail;
  const approve = (input) => call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', Object.assign({ expectedStatus: d2.summary.status, expectedScriptVersion: d2.summary.scriptVersion, expectedVideoVersion: 0 }, input));
  assert.equal(approve({}).ok, false);
  // Approval now also needs a chosen hook, which needs the hook columns → 시트 준비 first.
  assert.match(approve({ flagsConfirmed: true, hookReviewed: true }).error, /시트 준비/);
});

test('publishing caption keeps the Coupang Partners disclosure first and discloses AI visualization scenes', () => {
  const { env } = setup(null, { prepare: false });
  const headers = plain(env.gs('RF_CONFIG.REELS_HEADERS.concat(RF_CONFIG.REELS_OPTIONAL_HEADERS)'));
  const product = plain(env.gs('FIXTURE_PRD_001_PRODUCT'));
  product.affiliateUrl = 'https://link.coupang.com/a/x';
  const rec = plain(env.gs('prepareReelRecords')(product, JSON.stringify(fixture(env)), [], [], { model: 'm', generatedAt: 'g' })).records[0];
  const row = Object.assign({}, rec, { '상태': 'READY_TO_PUBLISH', '영상 파일 URL': 'https://drive.google.com/file/d/abc123/view' });
  const pack = plain(env.gs('buildPublishingPack')(row, product));
  assert.match(pack.instagramCaption, /^\[광고\] 이 게시물은 쿠팡 파트너스 활동의 일환으로/);
  assert.doesNotMatch(pack.instagramCaption, /AI 시뮬레이션/);
  const aiRow = Object.assign({}, row, { '콘텐츠 기둥': 'AI 공간 변신' });
  assert.match(plain(env.gs('buildPublishingPack')(aiRow, product)).instagramCaption, /※ 일부 장면은 AI 시뮬레이션이에요/);
  assert.ok(headers.includes('콘텐츠 기둥'));
});

test('renderer: "AI 시뮬레이션" is burned over AI-generated footage and AI visualization scenes, and QC checks it', () => {
  const template = loadTemplate('lifestyle-v1');
  assert.deepEqual([template.aiLabel.enabled, template.aiLabel.text], [true, 'AI 시뮬레이션']);
  const scenes = [['HOOK', 3, '급하게 출근하면 꼭 까먹는 우산!'], ['EMPATHY', 4, '구석에 두면 안 보여요'], ['SOLUTION', 6, '그래서 문에 붙이는 우산꽂이'], ['DEMO', 6, '장우산도 접이식도 쏙'], ['CTA', 4, "정보는 댓글에 '{키워드}'"]]
    .map((s, i) => ({ scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: 'v', on_screen_text: '', flow_prompt: 'p', ai_visualization: i === 2 }));
  const job = { reelId: 'PRD-001-R01', script: { '장면(JSON)': JSON.stringify(scenes), 'ManyChat 키워드': '우산', '광고 표기': '' } };
  const sb = buildStoryboard(job, template);
  assert.equal(sb.beats[2].aiVisualization, true);
  const tl = buildTimeline(sb, sb.beats.map(() => ({ file: 'x.wav', duration: 1.5 })), template);
  tl.beats.forEach((b, i) => { b.aiVisualization = sb.beats[i].aiVisualization; });
  const assets = (source) => Object.fromEntries(tl.shots.map((s) => [s.id, { source, file: s.id + '.mp4', in: 0, analysis: { flatRatio: 0, motion: 3 } }]));
  const labelLines = (ass) => ass.split('\n').filter((l) => /^Dialogue: .*,AiLabel,/.test(l));

  // All footage from Google Flow → one continuous label for the whole video.
  const flow = assets('flow-generated');
  const ivFlow = qc.aiShots(tl, flow).map((s) => ({ start: s.start, end: s.end }));
  const assFlow = buildAss(tl, template, { font: 'X', keyword: '우산', aiIntervals: ivFlow });
  assert.equal(labelLines(assFlow).length, 1);
  assert.match(labelLines(assFlow)[0], /^Dialogue: 3,0:00:00\.00,0:00:23\.00,AiLabel,,0,0,0,,AI 시뮬레이션$/);
  assert.match(assFlow, /Style: AiLabel,NanumSquareRound,30,.*,7,65,0,230,1/, 'small, top-left inside the safe area');

  // Own footage: only the AI visualization scene (scene 3) is labelled; real product shots are not.
  const own = assets('own-footage');
  const ivOwn = qc.aiShots(tl, own).map((s) => ({ start: s.start, end: s.end }));
  const lines = labelLines(buildAss(tl, template, { font: 'X', keyword: '우산', aiIntervals: ivOwn }));
  assert.deepEqual(lines.map((l) => l.split(',').slice(1, 3).join('–')), ['0:00:07.00–0:00:13.00']);

  // Post-render QC: missing label on an AI shot fails; real footage with no AI scenes needs none.
  const probe = { duration: tl.total, streams: [] };
  const check = (a, iv) => qc.postRender(probe, tl, template, [], a, iv).checks.find((c) => c.id === 'ai.label');
  assert.equal(check(flow, ivFlow).ok, true);
  assert.equal(check(flow, []).ok, false);
  tl.beats.forEach((b) => { b.aiVisualization = false; });
  assert.equal(check(own, []).ok, true);
});
