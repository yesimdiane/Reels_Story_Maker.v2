// Regression: Gemini fact validation for PRD-001 with the operator's real PRODUCTS wording.
// Facts are referenced by ID (F1…), paraphrases are allowed, invented claims / dimensions / prices
// are not, and existing sheet data, approvals and render gates keep working.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row, MockSheet, PRODUCT_HEADERS } = require('./helpers/apps-script-mock');
const { verifyJob } = require('../renderer/lib/job');
const { buildStoryboard } = require('../renderer/lib/storyboard');
const { loadTemplate } = require('../renderer/lib/template');

const plain = (v) => JSON.parse(JSON.stringify(v));
const FLOW = 'Vertical 9:16 photorealistic handheld shot in a Korean apartment entryway, natural light, no text.';

function setup(gemini) {
  const env = createEnv({ gemini: gemini || (() => paraphrasePayload()) });
  const sheetFeatures = env.gs('FIXTURE_PRD_001_SHEET_FEATURES');
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { features: sheetFeatures, permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const product = Object.assign({}, plain(env.gs('FIXTURE_PRD_001_PRODUCT')), { features: sheetFeatures });
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  return { env, product, call, facts: sheetFeatures.split('\n') };
}

// [beat, sec, narration, factIds]
function reel(angle, concept, scenes, factsUsed) {
  return {
    angle,
    pillar: 'PRODUCT_DISCOVERY',
    concept,
    hook: scenes[0][2],
    narration: scenes.map((s) => s[2]).join(' '),
    captions: scenes.map((s) => s[2]),
    scenes: scenes.map((s, i) => ({ scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: '현관에서 사람이 제품을 쓰는 모습', on_screen_text: '', flow_prompt: FLOW, fact_ids: s[3] })),
    facts_used: factsUsed,
  };
}

// Natural Korean paraphrases of the operator's verified facts (none copies the sheet wording), in
// the five-hook format: hooks H1–H5, the recommended hook (H4) opening one script.
function paraphrasePayload() {
  return withOpenings({
    hooks: [
      { id: 'H1', type: 'QUESTION', text: '매번 우산 어디 둘지 고민하는 사람?' },
      { id: 'H2', type: 'NUMBER', text: '세 가지 색 중에 문 색 맞추기' },
      { id: 'H3', type: 'MYTH', text: '우산 자리, 꼭 바닥일 필요 없어요' },
      { id: 'H4', type: 'SITUATION', text: '나갈 때마다 우산 찾느라 바빠요' },
      { id: 'H5', type: 'CONCLUSION', text: '현관 우산은 문에 붙이면 돼요' },
    ],
    recommended_hook: { id: 'H4', reason: '출근길 장면으로 바로 공감' },
    comment_keyword: '우산',
    reels: [
      reel('EVERYDAY_FRUSTRATION', '나갈 때 우산 찾기', [
        ['HOOK', 3, '나갈 때마다 우산 찾느라 바빠요', []],
        ['EMPATHY', 4, '구석에 두면 꼭 안 보이더라고요', []],
        ['SOLUTION', 5, '자석으로 붙여서 사용하는 우산꽂이', ['F1']],
        ['DEMO', 5, '철제 현관문에 부착할 수 있어요', ['F4']],
        ['DEMO', 4, '장우산이랑 접이식 따로 꽂아요', ['F3']],
        ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", []],
      ], ['F1', 'F3', 'F4']),
    ],
  });
}
// Each hook carries its own opening scene (shown and swapped in when the operator picks it).
function withOpenings(p) {
  p.hooks.forEach((h) => Object.assign(h, { visual: '현관에서 ' + h.text + ' 상황을 보여 주는 첫 장면', flow_prompt: FLOW, emphasis: '', sfx: '' }));
  return p;
}

function validate(env, product, payload) {
  return plain(env.gs('validateGeminiReels')(payload, product));
}
// Replaces one scene line of reel 1 (and keeps hook/captions/narration consistent).
function withLine(sceneIdx, line, factIds) {
  const p = paraphrasePayload();
  const r = p.reels[0];
  r.scenes[sceneIdx].narration = line;
  if (factIds) r.scenes[sceneIdx].fact_ids = factIds;
  r.captions = r.scenes.map((s) => s.narration);
  r.narration = r.captions.join(' ');
  r.hook = r.scenes[0].narration;
  return p;
}

test('natural Korean paraphrases of the verified facts are accepted; REELS stores the exact sheet wording', () => {
  const { env, product, facts, call } = setup();
  const v = validate(env, product, paraphrasePayload());
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.reels[0].facts_used, [facts[0], facts[2], facts[3]], 'IDs resolved to the PRODUCTS wording, in sheet order');
  assert.deepEqual(v.reels[0].scenes[3].facts, [facts[3]]);
  assert.equal(v.reels[0].scenes[3].fact_ids, undefined);
  assert.equal(v.reels[0].concept, 'A 일상 불편 · 나갈 때 우산 찾기', 'angle shown in 컨셉');
  // Through the real menu flow: one Gemini call, three rows, facts readable in the sheet.
  const res = call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 1);
  const rows = env.sheets.REELS.rows;
  const col = rows[0].indexOf('사용한 확인 기능');
  assert.equal(rows[1][col], [facts[0], facts[2], facts[3]].join('\n'));
  assert.match(rows[1][rows[0].indexOf('장면(JSON)')], /"facts":\["철제 도어 부착"\]/);
});

test('the prompt lists facts by ID, asks for natural Korean and structured fact references', () => {
  const { env, product } = setup();
  const prompt = env.gs('buildGeminiPrompt')(product);
  assert.match(prompt, /- F1: 자석 부착형 거치 방식/);
  assert.match(prompt, /- F5: 색상 옵션\(다크그레이\/그레이\/화이트\)/);
  assert.match(prompt, /자연스러운 한국어 구어체로 바꿔 말하세요/);
  assert.match(prompt, /기술 설명 문구를 그대로 읽지 마세요/);
  assert.match(prompt, /fact_ids/);
  assert.match(prompt, /ID만 쓰세요/);
  const schema = plain(env.gs('RF_GEMINI_RESPONSE_SCHEMA'));
  assert.ok(schema.properties.reels.items.properties.scenes.items.required.includes('fact_ids'));
});

test('older fact references still resolve: exact sheet wording or the same wording with other spacing', () => {
  const { env, product, facts } = setup();
  const p = paraphrasePayload();
  p.reels[0].facts_used = [facts[0], '철제도어 부착', 'F3'];
  assert.deepEqual(validate(env, product, p).errors, []);
});

test('invented features, compatibility, performance, material, colours, reviews and unknown fact IDs are rejected', () => {
  const { env, product } = setup();
  const cases = [
    [withLine(1, '방수 기능도 있어서 좋아요'), /확인되지 않은 기능 주장 "방수"/],
    [withLine(2, '냉장고에도 붙일 수 있어요'), /확인되지 않은 호환성 주장 "냉장고"/],
    [withLine(2, '어떤 문이든 다 붙어요'), /호환성 주장 "어떤 문"/],
    [withLine(1, '자력이 강력해서 안 떨어져요'), /성능 주장/],
    [withLine(1, '스테인리스라 녹 안 슬어요'), /소재 주장 "스테인리스"/],
    [withLine(3, '블랙 색상도 있어요'), /확인되지 않은 색상 "블랙"/],
    [withLine(3, '후기가 정말 좋아요'), /후기·인기 주장 "후기"/],
    [withLine(3, '우산 여러 개 꽂아도 돼요'), /수납 용량 주장/],
  ];
  for (const [payload, re] of cases) {
    const msg = validate(env, product, payload).errors.join('\n');
    assert.match(msg, re);
    assert.match(msg, /빼거나 확인된 기능만으로 다시 쓰세요/, 'correction instruction included');
  }
  const unknownId = paraphrasePayload();
  unknownId.reels[0].facts_used = ['F1', 'F9'];
  assert.match(validate(env, product, unknownId).errors.join('\n'), /확인되지 않은 기능을 참조했습니다: "F9"/);
  const inventedFact = paraphrasePayload();
  inventedFact.reels[0].facts_used = ['방수 기능'];
  assert.match(validate(env, product, inventedFact).errors.join('\n'), /확인되지 않은 기능을 참조했습니다: "방수 기능"/);
  const noSupport = withLine(3, '철제 현관문에 부착할 수 있어요', []);
  assert.match(validate(env, product, noSupport).errors.join('\n'), /장면 4 \(DEMO\): 이 장면이 근거로 삼는 확인된 기능 ID/);
});

test('incorrect dimensions are rejected: wrong tuple, swapped 상단/하단, wrong unit, unknown number', () => {
  const { env, product } = setup();
  const msg = (line) => validate(env, product, withLine(1, line)).errors.join('\n');
  assert.match(msg('상단 188x55x50mm 크기예요'), /확인된 기능과 다른 치수입니다: "상단 188x55x50mm"/);
  assert.match(msg('하단 190x55x50mm 크기예요'), /상단\/하단 치수가 바뀌었습니다/);
  assert.match(msg('높이가 82cm예요'), /수치\/단위입니다: "82cm"/);
  assert.match(msg('폭이 200mm예요'), /수치가 포함되어 있습니다: "200"/);
  assert.match(msg('190 곱하기 55 사이즈, 82센치'), /"82cm"/);
  // The verified values themselves are fine, with either × or x and with or without the label.
  assert.equal(msg('상단은 190×55×50mm예요'), '');
  assert.equal(msg('하단 높이 82mm'), '');
});

test('unsupported prices and discounts are rejected', () => {
  const { env, product } = setup();
  const msg = (line) => validate(env, product, withLine(3, line)).errors.join('\n');
  assert.match(msg('지금 9,900원이에요'), /확인되지 않은 가격입니다: "9900원"/);
  assert.match(msg('만 원대로 정리 끝'), /가격 주장 "만 원"/);
  assert.match(msg('오늘 30% 할인해요'), /가격 주장 "할인"/);
  assert.match(msg('가성비 최고 우산꽂이'), /가격 주장 "가성비"/);
});

test('retry: Gemini gets the exact failing claims and its previous response; a valid retry is used (2 calls)', () => {
  const bad = withLine(2, '냉장고에도 붙일 수 있어요');
  const { env, call } = setup((n) => (n === 1 ? bad : paraphrasePayload()));
  const res = call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2);
  const retryPrompt = env.state.fetches[1].contents[0].parts[0].text;
  assert.match(retryPrompt, /릴스 1: 장면 3 narration: 확인되지 않은 호환성 주장 "냉장고"/);
  assert.match(retryPrompt, /문제가 없는 훅·장면은 그대로 두세요/);
  assert.match(retryPrompt, /## 이전 응답 \(JSON/);
  assert.match(retryPrompt, /냉장고에도 붙일 수 있어요/);
});

test('retry: at most two paid calls; still invalid → nothing written, actionable error', () => {
  const first = withLine(2, '냉장고에도 붙일 수 있어요');
  const { env: env2, call: call2 } = setup(() => first);
  const res2 = call2('apiGenerateScripts', 'PRD-001');
  assert.equal(res2.ok, false);
  assert.match(res2.error, /검증에 실패했습니다[\s\S]*냉장고/);
  assert.equal(env2.state.fetches.length, 2);
  assert.equal((env2.sheets.REELS ? env2.sheets.REELS.rows.length : 1), 1);
});

test('existing PRODUCTS and REELS rows are not changed by generation', () => {
  const { env, call } = setup();
  env.sheets.PRODUCTS.rows.push(['PRD-002', '다른 상품', '', '확인된 기능 하나', '', '', '', '미확인', '진행 중']);
  env.gs('setupSheets()');
  // An existing reel written before this change (facts stored as sheet wording, no fact IDs).
  const legacy = createEnv({ gemini: () => plain(legacy.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  legacy.sheets.PRODUCTS.rows.push(prd001Row(legacy.gs, { permission: '자체 제작' }));
  legacy.gs('setupSheets()');
  plain(legacy.gs('apiGenerateScripts')('PRD-001'));
  const oldRow = legacy.sheets.REELS.rows[1].slice();
  oldRow[0] = 'PRD-001-R07';
  oldRow[legacy.sheets.REELS.rows[0].indexOf('ManyChat 키워드')] = 'PRD001R07';
  env.sheets.REELS.rows.push(oldRow);
  const productsBefore = JSON.stringify(env.sheets.PRODUCTS.rows);
  const reelsBefore = JSON.stringify(env.sheets.REELS.rows);
  const res = call('apiGenerateScripts', 'PRD-001', true);
  assert.equal(res.ok, true, res.error);
  assert.equal(JSON.stringify(env.sheets.PRODUCTS.rows), productsBefore, 'PRODUCTS never written');
  assert.equal(JSON.stringify(env.sheets.REELS.rows.slice(0, 2)), reelsBefore, 'existing REELS rows unchanged');
  assert.deepEqual(env.sheets.REELS.rows.slice(2).map((r) => r[0]), ['PRD-001-R08']);
});

test('approval and render gates still work for new and existing scripts; edits with invented claims are refused', () => {
  const { env, call } = setup();
  call('apiGenerateScripts', 'PRD-001');
  const act = (id, name, input = {}) => {
    const d = call('apiGetReel', id).detail;
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  // No render job before approval.
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, false);
  // A reviewer edit that invents a feature is refused; the script is unchanged.
  const refused = act('PRD-001-R01', 'EDIT_SCRIPT', { edit: { hook: '냉장고에도 붙는 우산꽂이' } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /호환성 주장 "냉장고"/);
  // Approve → Flow prompts → production → signed render job the renderer accepts.
  assert.equal(act('PRD-001-R01', 'APPROVE_SCRIPT').ok, true);
  const flowCol = env.sheets.REELS.rows[0].indexOf('Flow 장면 프롬프트');
  assert.equal(JSON.parse(env.sheets.REELS.rows[1][flowCol]).length, 6, 'one Flow prompt per scene');
  assert.equal(act('PRD-001-R01', 'START_VIDEO').ok, true);
  const job = call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(job.ok, true, job.error);
  const verified = verifyJob(JSON.parse(job.jobFile), { secret: env.props.RF_RENDER_SECRET });
  const sb = buildStoryboard(verified, loadTemplate('lifestyle-v1'));
  assert.deepEqual(sb.beats.map((b) => b.beat), ['HOOK', 'EMPATHY', 'SOLUTION', 'DEMO', 'DEMO', 'CTA']);
  assert.equal(sb.beats[3].subtitle, '철제 현관문에 부착할 수 있어요');
  // A REELS row created before this change (README wording, no fact IDs) can still be approved.
  const legacy = createEnv({ gemini: () => plain(legacy.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  legacy.sheets.PRODUCTS = new MockSheet('PRODUCTS', [PRODUCT_HEADERS, prd001Row(legacy.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/y' })]);
  legacy.gs('setupSheets()');
  plain(legacy.gs('apiGenerateScripts')('PRD-001'));
  const factsCol = legacy.sheets.REELS.rows[0].indexOf('사용한 확인 기능');
  assert.match(legacy.sheets.REELS.rows[1][factsCol], /호환되는 철제 표면에 자석으로 부착 가능/);
  const d = plain(legacy.gs('apiGetReel')('PRD-001-R01')).detail;
  const ok = plain(legacy.gs('apiAction')('PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }));
  assert.equal(ok.ok, true, ok.error);
});
