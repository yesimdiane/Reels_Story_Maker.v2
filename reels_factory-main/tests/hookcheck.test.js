// Hook validation: hard errors vs. style warnings, semantic type checks, and targeted single-hook
// revision (minimal Gemini calls). Safe hooks with warnings are shown in the dashboard and stay selectable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));
const fixture = (env) => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
const REV_ID = (body) => body.generationConfig.responseSchema.properties.hooks.items.properties.id.enum;
const isRevision = (body) => {
  const e = body.generationConfig.responseSchema.properties.hooks.items.properties.id.enum;
  return e.length < 5;
};

function setup(gemini) {
  const env = createEnv({ autoSelectHook: false, gemini });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const detail = (id = 'PRD-001-R01') => call('apiGetReel', id).detail;
  const row = () => env.sheets.REELS.record(2);
  return { env, call, detail, row };
}
const weak = (f, id, text) => {
  f.hooks.find((h) => h.id === id).text = text;
  return f;
};
const revisionFor = (ids, texts) => ({
  hooks: ids.map((id, i) => ({
    id, type: { H1: 'QUESTION', H2: 'NUMBER', H3: 'MYTH', H4: 'SITUATION', H5: 'CONCLUSION' }[id], text: texts[i],
    visual: '현관문에 우산을 붙이는 손 클로즈업', flow_prompt: 'Vertical 9:16 photorealistic entryway, hand sticks an umbrella holder on a metal door, natural light, no text.', emphasis: '', sfx: '',
  })),
});

test('a safe hook with style warnings is stored without any retry; the dashboard shows the warning and it stays selectable', () => {
  let env;
  const f0 = () => weak(fixture(env), 'H5', '정리 안 되는 우산을 소개해요 추천해요');
  ({ env } = (() => { const s = setup((n, body) => (n === 1 ? f0() : revisionFor(['H5'], ['정리 안 되는 우산은 그냥 문에 붙여요']))); env = s.env; return s; })());
  const s = { env, call: (fn, ...a) => plain(env.gs(fn).apply(null, a)) };
  const res = s.call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  // One full call + one targeted call for H5 only (not five hooks again).
  assert.equal(env.state.fetches.length, 2);
  assert.deepEqual(REV_ID(env.state.fetches[1]), ['H5']);
  const prompt = env.state.fetches[1].contents[0].parts[0].text;
  assert.match(prompt, /H5만 다시 쓰세요/);
  const stored = JSON.parse(env.sheets.REELS.record(2)['훅 후보(JSON)']);
  assert.equal(stored.hooks.find((h) => h.id === 'H5').text, '정리 안 되는 우산은 그냥 문에 붙여요');
  assert.equal(stored.hooks.find((h) => h.id === 'H3').text, fixture(env).hooks[2].text, 'other hooks untouched');
});

test('failed targeted revision keeps the safe original with its warning (no extra calls) and the dashboard shows it', () => {
  let env;
  const f0 = () => weak(fixture(env), 'H3', '현관 우산 자리, 바닥이 좋아요');
  const s = setup((n, body) => (n === 1 ? f0() : revisionFor(['H3'], ['현관 우산 자리, 바닥이 좋아요 정말'])));
  env = s.env;
  const res = s.call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2, 'one full call + one targeted call; never a full retry');
  const d = s.detail();
  assert.equal(d.hooks.candidates.find((c) => c.id === 'H3').text, '현관 우산 자리, 바닥이 좋아요');
  assert.match((d.hooks.warnings.H3 || []).join('\n'), /뒤집는 느낌이 약합니다/);
  assert.equal(d.hooks.canRevise, true);
  assert.deepEqual(d.hooks.warnings.H1, []);
  // The operator can still select it (free), and approval is not blocked by the warning.
  const pick = s.call('apiSelectHook', 'PRD-001-R01', { hookId: 'H3', text: d.hooks.candidates[2].text, mode: 'keep', expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  assert.equal(pick.ok, true, pick.error);
});

test('hard errors on a non-recommended hook cost one targeted call, not a full regeneration', () => {
  let env;
  const f0 = () => weak(fixture(env), 'H2', '10명 중 9명이 모르는 정리법');
  const s = setup((n) => (n === 1 ? f0() : revisionFor(['H2'], ['두 조각만 문에 붙이면 바닥이 비어요 정말'.slice(0, 18)])));
  env = s.env;
  const res = s.call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2);
  assert.deepEqual(REV_ID(env.state.fetches[1]), ['H2']);
  assert.match(env.state.fetches[1].contents[0].parts[0].text, /통계·비율처럼 보이는/);
});

test('script errors or a hard error on the recommended hook still use the full corrective retry', () => {
  let env;
  const s = setup((n) => {
    const f = fixture(env);
    if (n === 1) f.reels[0].scenes[1].narration = '냉장고에도 붙일 수 있어요';
    return f;
  });
  env = s.env;
  const res = s.call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2);
  assert.ok(!isRevision(env.state.fetches[1]), 'second call is the full retry');
});

test('operator can ask Gemini to improve one hook (1 call); other hooks, script and choice are unchanged', () => {
  let env;
  // Call 1: full set with a weak H3. Call 2 (automatic): no improvement. Call 3 (operator button): better H3.
  const s = setup((n) => (n === 1 ? weak(fixture(env), 'H3', '현관 우산 자리, 바닥이 좋아요')
    : n === 2 ? revisionFor(['H3'], ['현관 우산 자리, 바닥이 좋아요']) : revisionFor(['H3'], ['좁은 현관 바닥엔 원래 우산 자리 없어요'])));
  env = s.env;
  assert.equal(s.call('apiGenerateScripts', 'PRD-001').ok, true);
  let d = s.detail();
  assert.ok((d.hooks.warnings.H3 || []).length > 0, 'warning remains after the automatic attempt');
  const before = plain(d.reel);
  const others = d.hooks.candidates.filter((c) => c.id !== 'H3').map((c) => c.text);
  const calls0 = env.state.fetches.length;
  const res = s.call('apiReviseHook', 'PRD-001-R01', { hookId: 'H3', expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, calls0 + 1);
  d = res.detail;
  assert.equal(d.hooks.candidates.find((c) => c.id === 'H3').text, '좁은 현관 바닥엔 원래 우산 자리 없어요');
  assert.deepEqual(d.hooks.candidates.filter((c) => c.id !== 'H3').map((c) => c.text), others);
  assert.deepEqual(plain(d.reel), before, 'the script is not changed');
});

test('approval gate is unchanged by warnings: a hook must still be chosen and the script reviewed', () => {
  let env;
  const s = setup((n) => weak(fixture(env), 'H3', '현관 우산 자리, 바닥이 좋아요'));
  env = s.env;
  assert.equal(s.call('apiGenerateScripts', 'PRD-001').ok, true);
  const d = s.detail();
  const act = (input) => s.call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  assert.match(act({}).error, /훅/);
  assert.equal(s.call('apiGetRenderJob', 'PRD-001-R01').ok, false, 'no render job before approval');
});

test('operator-edited hook keeps working: only facts are enforced, style shows as a warning', () => {
  let env;
  const s = setup((n) => fixture(env));
  env = s.env;
  assert.equal(s.call('apiGenerateScripts', 'PRD-001').ok, true);
  const d = s.detail();
  const mk = (text) => s.call('apiSelectHook', 'PRD-001-R01', { hookId: 'H3', text, mode: 'keep', expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  assert.match(mk('냉장고에도 붙이면 돼요').error, /쓸 수 없습니다/);
  const ok = mk('우산꽂이 하나로 정리 끝, 추천해요');
  assert.equal(ok.ok, true, ok.error);
  assert.ok(ok.detail.hooks.selectedWarnings.length > 0, 'warning shown for the edited wording');
});
