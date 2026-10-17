// Regression: hook style and story structure for new Gemini scripts (Korean home-decor / small-space
// account). Hooks open with a relatable problem, not an ad; HOOK → EMPATHY → SOLUTION → DEMO → CTA.
// Fact validation, existing rows, reviewer edits and gates are unchanged. (Five-hook rules: fivehooks.test.js.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));
const fixture = (env) => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));

function setup(gemini) {
  const env = createEnv({ gemini: gemini || (() => fixture(env)) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const product = plain(env.gs('FIXTURE_PRD_001_PRODUCT'));
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const styleCheck = (hook, avoid) => plain(env.gs('hookStyleCheck_')(hook, product, avoid || []));
  const hookErrors = (hook, avoid) => { const c = styleCheck(hook, avoid); return c.errors.concat(c.warnings); };
  const validate = (payload, options) => plain(env.gs('validateGeminiReels')(payload, product, null, options));
  return { env, product, call, hookErrors, styleCheck, validate };
}
// Sets reel i's hook (first scene line, caption and hook stay the same text).
function setHook(payload, i, hook) {
  const r = payload.reels[i];
  r.hook = hook;
  r.scenes[0].narration = hook;
  r.captions[0] = hook;
  return payload;
}

test('relatable problem-first hooks (the account style) are accepted', () => {
  const { hookErrors } = setup();
  for (const h of [
    '급하게 출근하면 꼭 까먹는 우산!',
    '원룸 살 때 제일 애매한 게 우산꽂이였어요.',
    '좁은 현관에 우산꽂이까지 놓기 싫잖아요.',
    '비 오는 날 집에 오면 젖은 우산부터 문제',
    '신발장 옆에 우산 세우면 꼭 쓰러지죠',
  ]) {
    assert.deepEqual(hookErrors(h), [], h);
  }
});

test('generic advertising hooks get style warnings (misleading result promises are errors)', () => {
  const { hookErrors, styleCheck } = setup();
  const cases = [
    ['현관이 좁아 우산 둘 곳이 없다면?', /"~다면\?" 같은 뻔한 질문형/],
    ['우산꽂이 하나로 현관이 달라집니다.', /제품 이름으로 시작합니다/],
    ['우산꽂이 하나로 현관이 달라집니다.', /"~니다" 말투/],
    ['우산꽂이 하나로 현관이 달라집니다.', /광고 문구/],
    ['현관 정리 고민이신가요?', /"~하시나요\?" 같은 뻔한 질문형/],
    ['현관 우산 정리, 어떻게 하시나요?', /뻔한 질문형/],
    ['현관 정리 필수템 소개해요', /광고 문구/],
    ['지금 바로 확인하세요!', /권유형/],
    ['이거 붙이면 현관이 달라져요', /결과 약속/],
    ['리템 자석 우산꽂이로 정리해요', /제품 이름으로 시작합니다/],
    ['비 오는 날마다 젖은 우산을 어디에 둘지 매번 고민하게 되는 좁은 현관', /25자 이내/],
  ];
  for (const [hook, re] of cases) {
    const errs = hookErrors(hook).join('\n');
    assert.match(errs, re, hook);
  }
  // Only a misleading result promise is a hard error; the rest is editorial.
  assert.match(styleCheck('이거 붙이면 현관이 달라져요').errors.join('\n'), /결과 약속/);
  assert.deepEqual(styleCheck('현관 정리 필수템 소개해요').errors, []);
  assert.deepEqual(styleCheck('지금 바로 확인하세요!').errors, []);
});

test('several scripts at once (configurable): three distinct angles and openings; earlier hooks are not repeated', () => {
  const { env, validate } = setup();
  const three = () => {
    const f = fixture(env);
    const base = f.reels[0];
    f.reels = ['EVERYDAY_FRUSTRATION', 'SMALL_SPACE', 'LIFESTYLE_SITUATION'].map((angle, i) => {
      const r = plain(base);
      r.angle = angle;
      r.concept = base.concept + ' ' + i;
      return setHook({ reels: [r] }, 0, ['비 오는 날, 현관에 젖은 우산이 굴러다녀요', '원룸 현관은 신발만 둬도 꽉 차요', '손님 오기 전 현관 정리할 때'][i]).reels[0];
    });
    return f;
  };
  const opts = { requireHooks: false };
  const v3 = (p, o) => plain(env.gs('validateGeminiReels')(p, plain(env.gs('FIXTURE_PRD_001_PRODUCT')), 3, Object.assign({}, opts, o)));
  assert.deepEqual(v3(three()).errors, []);
  const sameAngle = three();
  sameAngle.reels[2].angle = 'SMALL_SPACE';
  assert.match(v3(sameAngle).errors.join('\n'), /angle SMALL_SPACE이 릴스 2와 같습니다/);
  const sameOpening = three();
  setHook(sameOpening, 2, '원룸 현관은 젖은 우산까지 있으면 답답해요');
  assert.match(v3(sameOpening).errors.join('\n'), /릴스 3: hook이 릴스 2와 같은 말\("원룸 현관은"\)로 시작합니다/);
  // Default (one script + five hooks): an earlier hook of this product is refused.
  const repeat = validate(fixture(env), { avoidHooks: ['비 오는 날 현관에 젖은 우산이 굴러다녀요'] });
  assert.deepEqual(repeat.errors, [], 'repeating an earlier hook is a style warning, not an error');
  assert.match(repeat.warnings.H4.join('\n'), /기존 릴스 훅과 같습니다/);
});

test('new scripts follow HOOK → EMPATHY → SOLUTION → DEMO → CTA', () => {
  const { env, validate, call } = setup();
  const noSolution = fixture(env);
  noSolution.reels[0].scenes[2].beat = 'DEMO';
  assert.match(validate(noSolution).errors.join('\n'), /릴스 1: SOLUTION 장면\(제품을 자연스럽게 등장\)이 필요합니다/);
  const noEmpathy = fixture(env);
  noEmpathy.reels[0].scenes[1].beat = 'SOLUTION';
  assert.match(validate(noEmpathy).errors.join('\n'), /릴스 1: EMPATHY 장면/);
  const wrongOrder = fixture(env);
  [wrongOrder.reels[0].scenes[1].beat, wrongOrder.reels[0].scenes[2].beat] = ['SOLUTION', 'EMPATHY'];
  assert.match(validate(wrongOrder).errors.join('\n'), /장면 순서는 HOOK → EMPATHY → SOLUTION → DEMO/);
  const tooShort = fixture(env);
  tooShort.reels[0].scenes.forEach((sc) => (sc.duration_sec = 2));
  assert.match(validate(tooShort).errors.join('\n'), /총 길이는 20~40초/, 'new scripts: 20–40 s');
  const res = call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  const rows = env.sheets.REELS.rows;
  assert.deepEqual(rows.slice(1).map((r) => r[rows[0].indexOf('컨셉')]), ['비 오는 날 현관']);
  assert.deepEqual(rows.slice(1).map((r) => r[rows[0].indexOf('후킹')]), ['비 오는 날, 현관에 젖은 우산이 굴러다녀요']);
});

test('invented personal experiences or results are rejected; fact rules still apply', () => {
  const { env, validate } = setup();
  const line = (i, text) => {
    const f = fixture(env);
    f.reels[0].scenes[i].narration = text;
    return validate(f).errors.join('\n');
  };
  assert.match(line(3, '한 달 써 보니 현관이 넓어졌어요'), /확인되지 않은 체험·결과 주장/);
  assert.match(line(2, '문에 붙였더니 바닥이 넓어졌어요'), /체험·결과 주장 "붙였더니"/);
  assert.match(line(2, '냉장고에도 붙일 수 있어요'), /호환성 주장 "냉장고"/);
  assert.match(line(4, '상단 188×55×50mm'), /확인된 기능과 다른 치수/);
});

test('the prompt asks for the account style: five hooks, structure, good and bad hooks, no invented experiences', () => {
  const { env, product } = setup();
  const prompt = env.gs('buildGeminiPrompt')(product, [], '', ['예전 hook 하나']);
  for (const s of [
    '서울에서 집꾸미기', '우리 집에 들이기 전에, 먼저 보여드릴게요.',
    '라이프스타일 크리에이터',
    'H1 QUESTION (질문형)', 'H2 NUMBER (숫자로 시작하는형)', 'H3 MYTH (통념을 뒤집는 단정형)', 'H4 SITUATION (상황 묘사형)', 'H5 CONCLUSION (결론 먼저 던지는형)',
    'PROBLEM → EMPATHY → SOLUTION → DEMONSTRATION → CTA',
    '나쁜 예: "현관이 좁아 우산 둘 곳이 없다면?", "우산꽂이 하나로 현관이 달라집니다."',
    '좋은 예: "급하게 출근할 때마다 우산 깜빡하는 사람?"',
    '25자 이내', '첫 2초',
    '경험담·구매·테스트·남편 반응·전후 결과를 지어내지 마세요',
    '## 이 상품에 이미 쓴 hook', '- 예전 hook 하나',
  ]) assert.ok(prompt.includes(s), s);
  assert.ok(!prompt.includes('## 세 가지 각도'), 'one script per run → no angle section');
  const schema = plain(env.gs('RF_GEMINI_RESPONSE_SCHEMA'));
  assert.ok(schema.properties.reels.items.properties.scenes.items.properties.beat.enum.includes('EMPATHY'));
  // Revision keeps the five hooks and only rewrites the script.
  const regen = env.gs('buildRegenerationPrompt')(product, { hook: 'x' }, '더 자연스럽게', []);
  assert.ok(regen.includes('현재 대본') && regen.includes('더 자연스럽게'));
  assert.ok(!regen.includes('## 훅 5개'));
});

test('a recommended hook with a misleading result promise costs one full corrective retry with the exact fix', () => {
  const bad = (env) => {
    const f = fixture(env);
    f.hooks[3].text = '이거 붙이면 현관이 달라져요';
    return setHook(f, 0, f.hooks[3].text);
  };
  let env;
  ({ env } = setup((n) => (n === 1 ? bad(env) : fixture(env))));
  const res = plain(env.gs('apiGenerateScripts')('PRD-001'));
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2, 'hard error on the recommended hook → full retry, no targeted call');
  const retry = env.state.fetches[1].contents[0].parts[0].text;
  assert.match(retry, /훅 H4 "이거 붙이면 현관이 달라져요" — .*결과 약속/);
  // Second batch for the same product: the prompt lists the existing hooks; repeats only warn.
  const again = plain(env.gs('apiGenerateScripts')('PRD-001', true));
  assert.equal(again.ok, true, again.error);
  const p3 = env.state.fetches[2].contents[0].parts[0].text;
  assert.match(p3, /## 이 상품에 이미 쓴 hook[\s\S]*- 급하게 출근할 때마다 우산 깜빡하는 사람\?/, 'all five earlier hooks are listed');
  assert.ok(env.state.fetches.length <= 5, 'at most 2 calls per run');
});

test('older scripts and reviewer edits keep working: old structure approves, hook style is the reviewer\'s call', () => {
  const { env, call, product } = setup();
  call('apiGenerateScripts', 'PRD-001');
  // A REELS row in the older structure (HOOK → DEMO → DEMO → BENEFIT → CTA), written before five hooks.
  const old = {
    concept: '문제 해결', hook: '현관 좁은 집은 우산 어디 둬요?', narration: '', captions: [],
    scenes: [
      ['HOOK', 3, '현관 좁은 집은 우산 어디 둬요?', []], ['DEMO', 4, '저는 그냥 문에 붙였어요.', ['호환되는 철제 표면에 자석으로 부착 가능']],
      ['DEMO', 6, '바닥 공간을 안 차지하니까', []], ['BENEFIT', 6, '현관이 훨씬 깔끔해져요.', []], ['CTA', 4, "제품 정보는 댓글에 '{키워드}'", []],
    ].map((s, i) => ({ scene_no: i + 1, beat: s[0], duration_sec: s[1], narration: s[2], visual: '현관 모습', on_screen_text: '', flow_prompt: 'Vertical 9:16 photorealistic entryway shot, natural light, no text.', facts: s[3] })),
    facts_used: ['호환되는 철제 표면에 자석으로 부착 가능'],
  };
  old.captions = old.scenes.map((s) => s.narration);
  old.narration = old.captions.join(' ');
  const recs = env.gs('buildReelRecords')(product, [old], plain(env.gs('readColumn_')(env.sheets.REELS, env.gs('getHeaderMap_')(env.sheets.REELS), '릴스ID')), [], { model: 'old', generatedAt: 'g' });
  env.gs('appendRecords_')(env.sheets.REELS, recs, env.gs('RF_SCRIPT_FIELDS'));
  const act = (id, name, input = {}) => {
    const d = call('apiGetReel', id).detail;
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  const before = JSON.stringify(env.sheets.REELS.rows.slice(0, 2));
  // The older row has no hook candidates: it is still shown and reviewable, its "저는 …" line is
  // flagged, and approval waits for five hooks + a choice (see fivehooks.test.js for that flow).
  const old2 = call('apiGetReel', 'PRD-001-R02').detail;
  assert.deepEqual([old2.hooks.required, old2.hooks.candidates.length, old2.hooks.canGenerate], [true, 0, true]);
  assert.match(old2.verificationFlags.join('\n'), /\[개인 경험\] 장면 2/);
  assert.match(act('PRD-001-R02', 'APPROVE_SCRIPT', { flagsConfirmed: true }).error, /훅 후보 5개가 없습니다/);
  assert.equal(JSON.stringify(env.sheets.REELS.rows.slice(0, 2)), before, 'other rows untouched');
  // The reviewer may write any hook (only fact rules apply to edits); writing it counts as choosing it.
  const edited = act('PRD-001-R01', 'EDIT_SCRIPT', { edit: { hook: '현관 우산 정리, 어떻게 하시나요?' } });
  assert.equal(edited.ok, true, edited.error);
  assert.equal(edited.detail.hooks.selected.id, 'CUSTOM');
  assert.equal(edited.detail.hooks.selectionValid, true);
  // A reviewer's own experience line is allowed in an edit but must be confirmed before approval.
  const own = act('PRD-001-R01', 'EDIT_SCRIPT', { edit: { hook: '한 달 써 보니 현관이 넓어졌어요' } });
  assert.equal(own.ok, true, own.error);
  assert.match(own.detail.verificationFlags.join('\n'), /\[개인 경험\] hook/);
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, false, 'no render job before approval');
  assert.match(act('PRD-001-R01', 'APPROVE_SCRIPT').error, /확인 필요 항목/);
  assert.equal(act('PRD-001-R01', 'APPROVE_SCRIPT', { flagsConfirmed: true }).ok, true);
  const flow = JSON.parse(env.sheets.REELS.rows[1][env.sheets.REELS.rows[0].indexOf('Flow 장면 프롬프트')]);
  assert.deepEqual(flow.map((p) => p.beat), ['HOOK', 'EMPATHY', 'SOLUTION', 'DEMO', 'DEMO', 'CTA']);
  assert.match(flow[2].prompt, /product comes into frame naturally/);
});
