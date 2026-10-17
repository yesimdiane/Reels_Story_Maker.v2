// Five-hook workflow (reference: PRD-001): Gemini writes five hooks (H1–H5) + a recommended hook + one
// script that starts with it; the operator chooses the final hook (optionally edited), either swapping it
// in for free or having Gemini rewrite the script around it. The choice is stored with the script version
// and is required for approval. Scene timing is re-checked on the real TTS voice before rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');
const { verifyJob } = require('../renderer/lib/job');
const { buildStoryboard } = require('../renderer/lib/storyboard');
const { buildTimeline } = require('../renderer/lib/plan');
const { loadTemplate } = require('../renderer/lib/template');
const { createTtsService } = require('../renderer/lib/tts');
const { createLocalStorage } = require('../renderer/lib/storage/local');
const { silentWav } = require('../renderer/lib/wav');
const { render } = require('../renderer/lib/render');
const qc = require('../renderer/lib/qc');

const plain = (v) => JSON.parse(JSON.stringify(v));
const fixture = (env) => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
let hasFfmpeg = false;
try {
  hasFfmpeg = /\sass\s/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }));
} catch {
  hasFfmpeg = false;
}

// Real operator flow: the hook choice is NOT made automatically here.
function setup(gemini, extra = {}) {
  const env = createEnv(Object.assign({ autoSelectHook: false, gemini: gemini || (() => fixture(env)) }, extra));
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  env.gs('setupSheets()');
  const product = plain(env.gs('FIXTURE_PRD_001_PRODUCT'));
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const detail = (id = 'PRD-001-R01') => call('apiGetReel', id).detail;
  const act = (name, input = {}, id = 'PRD-001-R01') => {
    const d = detail(id);
    return call('apiAction', id, name, Object.assign({ expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion }, input));
  };
  const pick = (hookId, text, mode = 'keep', id = 'PRD-001-R01') => {
    const d = detail(id);
    return call('apiSelectHook', id, { hookId, text, mode, expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion });
  };
  const row = () => env.sheets.REELS.record(2);
  const hookErrs = (payload) => plain(env.gs('validateGeminiReels')(payload, product)).errors.join('\n');
  // Style warnings of one hook in the set (never block saving).
  const hookWarns = (payload, id) => (plain(env.gs('validateGeminiReels')(payload, product)).warnings[id] || []).join('\n');
  return { env, product, call, detail, act, pick, row, hookErrs, hookWarns };
}
function withHook(env, id, text) {
  const f = fixture(env);
  f.hooks.find((h) => h.id === id).text = text;
  // The script starts with the recommended hook (H4 in the fixture).
  if (f.recommended_hook.id === id) f.reels[0].hook = f.reels[0].scenes[0].narration = text;
  return f;
}

test('the reference output passes: five hook types, recommended hook with a reason, script starts with it', () => {
  const { env, product, hookErrs } = setup();
  const f = fixture(env);
  assert.deepEqual(f.hooks.map((h) => h.id + ':' + h.type), ['H1:QUESTION', 'H2:NUMBER', 'H3:MYTH', 'H4:SITUATION', 'H5:CONCLUSION']);
  assert.equal(hookErrs(f), '');
  const v = plain(env.gs('validateGeminiReels')(f, product));
  assert.equal(v.hookSet.recommended.id, 'H4');
  assert.match(v.hookSet.recommended.reason, /첫 프레임/);
  assert.equal(v.commentKeyword, '우산');
  assert.equal(v.reels[0].hook, f.hooks[3].text);
  // Every scene carries a visual direction, subtitle emphasis and sound-effect field.
  assert.ok(v.reels[0].scenes.every((s) => s.visual && typeof s.emphasis === 'string' && typeof s.sfx === 'string'));
});

test('each hook type is checked by meaning: weak fit is a warning, invented numbers are errors', () => {
  const { env, hookErrs, hookWarns } = setup();
  // Style / type fit → warning only (the hook is still safe to save, show and select).
  const soft = [
    ['H1', '급하게 출근할 때마다 우산 깜빡하는 사람', /질문처럼 들리지 않습니다/],
    ['H1', '현관 우산 정리, 어떻게 하시나요?', /뻔한 질문형/],
    ['H2', '문에 붙이면 바닥이 비어요', /숫자가 없습니다/],
    ['H3', '현관 우산 자리, 바닥이 좋아요', /흔한 생각을 뒤집는 느낌이 약합니다/],
    ['H3', '현관 우산 자리, 바닥이 아닐까요?', /질문처럼 들립니다/],
    ['H4', '우산꽂이 색이 세 가지예요', /제품 이름으로 시작합니다|언제·어디서/],
    ['H4', '정리가 깔끔해 보여요', /언제·어디서/],
    ['H5', '좁은 현관 우산 정리가 고민이에요', /해결책이 먼저 들리지 않습니다/],
  ];
  for (const [id, text, re] of soft) {
    const f = withHook(env, id, text);
    assert.equal(hookErrs(f), '', id + ' ' + text + ' must not be a hard error');
    assert.match(hookWarns(f, id), re, id + ' ' + text);
  }
  // Invented statistics and numbers not in the facts → hard errors.
  assert.match(hookErrs(withHook(env, 'H2', '10명 중 9명이 모르는 정리법')), /통계·비율처럼 보이는 "10명"/);
  assert.match(hookErrs(withHook(env, 'H2', '다섯 가지 색 중에 고르는 법')), /"다섯 가지"의 숫자 5는 확인된 기능에 없습니다/);
  // Genuine numbers from the facts are fine: "두 조각" (상단·하단), "세 가지 색" (다크그레이, 그레이, 화이트).
  for (const t of ['세 가지 색 중에 문 색 맞추기', '두 조각만 문에 붙이면 바닥이 비어요']) {
    assert.equal(hookErrs(withHook(env, 'H2', t)), '');
    assert.equal(hookWarns(withHook(env, 'H2', t), 'H2'), '');
  }
});

// Regression: the live PRD-001 run. Gemini returned five valid hooks, but H3 and H5 were rejected because
// the validator required the exact phrases "~아니에요"/"~말고" and "~하면 돼요".
test('regression (live PRD-001): H3 "원래 … 없어요" and H5 "그냥 문에 붙여요" pass without errors or warnings', () => {
  const { env, product, hookErrs, hookWarns } = setup();
  const f = fixture(env);
  f.hooks[2].text = '좁은 현관 바닥엔 원래 우산 자리 없어요';
  f.hooks[4].text = '정리 안 되는 우산은 그냥 문에 붙여요';
  assert.equal(hookErrs(f), '');
  assert.equal(hookWarns(f, 'H3'), '');
  assert.equal(hookWarns(f, 'H5'), '');
  const v = plain(env.gs('validateGeminiReels')(f, product));
  assert.deepEqual(v.hookSet.hooks.map((h) => h.id + ':' + h.type), ['H1:QUESTION', 'H2:NUMBER', 'H3:MYTH', 'H4:SITUATION', 'H5:CONCLUSION']);
  assert.equal(v.hookSet.hooks[2].text, '좁은 현관 바닥엔 원래 우산 자리 없어요');
  assert.equal(v.hookSet.hooks[4].text, '정리 안 되는 우산은 그냥 문에 붙여요');
  // Also with the operator's real PRODUCTS wording.
  const sheetProduct = Object.assign({}, product, { features: plain(env.gs('FIXTURE_PRD_001_SHEET_FEATURES')) });
  assert.deepEqual(plain(env.gs('validateGeminiReels')(f, sheetProduct)).errors, []);
  // Other natural wordings of the same meaning.
  for (const t of ['굳이 바닥에 우산꽂이 둘 필요 없어요', '우산 자리는 바닥 말고 문이에요', '사실 우산은 문에 두는 게 편해요']) {
    assert.equal(hookWarns(withHook(env, 'H3', t), 'H3'), '', t);
  }
  for (const t of ['우산은 문에 붙이면 끝이에요', '젖은 우산, 바로 문에 꽂아요', '우산 정리는 문에 걸어 두세요']) {
    assert.equal(hookWarns(withHook(env, 'H5', t), 'H5'), '', t);
  }
});

test('hook set rules: exactly five, distinct, facts only, recommended hook opens the script, simple keyword', () => {
  const { env, hookErrs, hookWarns } = setup();
  const four = fixture(env);
  four.hooks.pop();
  assert.match(hookErrs(four), /hooks는 정확히 5개\(H1~H5\)/);
  const dup = withHook(env, 'H5', '현관 우산 자리, 바닥이 아니에요');
  assert.match(hookErrs(dup), /훅 H5가 H3와 같습니다/);
  const sameOpen = withHook(env, 'H5', '비 오는 날 문에 붙이면 돼요');
  assert.equal(hookErrs(sameOpen), '', 'the same first words is a style warning');
  assert.match(hookWarns(sameOpen, 'H5'), /H4와 같은 말\("비 오는"\)로 시작합니다/);
  assert.match(hookErrs(withHook(env, 'H5', '')), /훅 H5의 text가 비어 있습니다/);
  assert.match(hookErrs(withHook(env, 'H5', '문에 붙이면 현관이 달라져요')), /결과 약속/);
  assert.match(hookErrs(withHook(env, 'H5', '최고의 우산 정리, 문에 붙여요')), /"최고"/);
  const badType = fixture(env);
  badType.hooks[2].type = 'QUESTION';
  assert.match(hookErrs(badType), /훅 H3의 type은 MYTH이어야 합니다/);
  const badId = fixture(env);
  badId.hooks[2].id = 'H9';
  assert.match(hookErrs(badId), /hooks의 id는 H1, H2, H3, H4, H5 중 하나/);
  assert.match(hookErrs(withHook(env, 'H5', '냉장고에도 붙이면 돼요')), /훅 H5: 확인되지 않은 호환성 주장 "냉장고"/);
  assert.match(hookErrs(withHook(env, 'H5', '문에 붙이면 30초면 돼요')), /수치/);
  const noRec = fixture(env);
  delete noRec.recommended_hook;
  assert.match(hookErrs(noRec), /recommended_hook\.id/);
  const noReason = fixture(env);
  noReason.recommended_hook.reason = '';
  assert.match(hookErrs(noReason), /추천 이유/);
  const mismatch = fixture(env);
  mismatch.recommended_hook.id = 'H1';
  assert.match(hookErrs(mismatch), /추천 훅 H1 .*으로 시작해야 합니다/);
  const badKw = fixture(env);
  badKw.comment_keyword = 'PRD001R01';
  assert.match(hookErrs(badKw), /comment_keyword "PRD001R01"는 .*내부 ID는 쓰지 마세요/);
});

test('generation stores five hooks and no selection; approval waits for the operator\'s hook choice', () => {
  const { env, call, detail, act, pick, row } = setup();
  const res = call('apiGenerateScripts', 'PRD-001');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 1, 'one Gemini call for five hooks + script');
  const r = row();
  assert.equal(JSON.parse(r['훅 후보(JSON)']).hooks.length, 5);
  assert.equal(r['선택한 훅'], '');
  assert.equal(r['ManyChat 키워드'], '우산', 'customer-facing keyword');
  assert.equal(r['릴스ID'], 'PRD-001-R01', 'internal ID kept for tracking');
  const d = detail();
  assert.equal(d.hooks.required, true);
  assert.equal(d.hooks.selectionValid, false);
  assert.equal(d.hooks.recommended.id, 'H4');
  assert.deepEqual(d.hooks.candidates.map((c) => c.label), ['질문형', '숫자로 시작하는형', '통념을 뒤집는 단정형', '상황 묘사형', '결론 먼저 던지는형']);
  // No approval, no Flow prompts, no render job until the operator picks.
  const refused = act('APPROVE_SCRIPT');
  assert.equal(refused.ok, false);
  assert.match(refused.error, /훅을 먼저 선택하세요/);
  assert.equal(r['Flow 장면 프롬프트'], '');
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, false);
  // Choose the recommended hook as is: no new version, no Gemini call.
  const kept = pick('H4', '비 오는 날, 현관에 젖은 우산이 굴러다녀요');
  assert.equal(kept.ok, true, kept.error);
  assert.equal(kept.detail.summary.scriptVersion, 1);
  const sel = JSON.parse(row()['선택한 훅']);
  assert.deepEqual([sel.id, sel.label, sel.mode, sel.edited, sel.recommended, sel.scriptVersion, sel.by], ['H4', '상황 묘사형', 'kept', false, true, 1, 'owner@example.com']);
  assert.equal(env.state.fetches.length, 1);
  assert.ok(env.sheets.AUDIT.rows.some((a) => a[3] === 'SELECT_HOOK' && /훅 H4 \(상황 묘사형\) 선택/.test(a[9])));
  // Approval also needs the explicit "reviewed the script with this hook" confirmation.
  assert.match(act('APPROVE_SCRIPT').error, /확인했다고 체크한 뒤 승인하세요/);
  const ap = act('APPROVE_SCRIPT', { hookReviewed: true });
  assert.equal(ap.ok, true, ap.error);
  assert.equal(ap.detail.flowScenePrompts.length, 6);
  assert.match(env.sheets.AUDIT.rows.filter((a) => a[3] === 'APPROVE_SCRIPT')[0][9], /훅 H4: "비 오는 날/);
  // After approval the hook cannot change without reopening (gate preserved).
  assert.match(pick('H1', '급하게 출근할 때마다 우산 깜빡하는 사람?').error, /대본 검토 중에만/);
});

test('choosing another hook swaps it in for free (new version); edited wording is allowed but fact-checked', () => {
  const { env, call, pick, row } = setup();
  call('apiGenerateScripts', 'PRD-001');
  const swapped = pick('H1', '급하게 출근할 때마다 우산 깜빡하는 사람?');
  assert.equal(swapped.ok, true, swapped.error);
  assert.equal(swapped.detail.summary.scriptVersion, 2);
  assert.equal(row()['후킹'], '급하게 출근할 때마다 우산 깜빡하는 사람?');
  assert.equal(JSON.parse(row()['장면(JSON)'])[0].narration, '급하게 출근할 때마다 우산 깜빡하는 사람?');
  assert.equal(row()['자막'].split('\n')[0], '급하게 출근할 때마다 우산 깜빡하는 사람?');
  assert.equal(JSON.parse(row()['선택한 훅']).mode, 'swapped');
  assert.equal(env.state.fetches.length, 1, 'no Gemini call');
  // Operator's own wording.
  const edited = pick('H5', '좁은 현관 우산, 문에 붙이면 돼요');
  assert.equal(edited.ok, true, edited.error);
  const sel = JSON.parse(row()['선택한 훅']);
  assert.deepEqual([sel.id, sel.edited, sel.text, sel.scriptVersion], ['H5', true, '좁은 현관 우산, 문에 붙이면 돼요', 3]);
  // An edit that invents a claim or number is refused before anything changes.
  const before = JSON.stringify(env.sheets.REELS.rows);
  assert.match(pick('H5', '냉장고에도 붙이면 돼요').error, /호환성 주장 "냉장고"/);
  assert.match(pick('H2', '10초면 설치 끝').error, /수치/);
  assert.equal(JSON.stringify(env.sheets.REELS.rows), before);
  // Stale request (double tap from an old screen) is refused.
  const stale = call('apiSelectHook', 'PRD-001-R01', { hookId: 'H1', mode: 'keep', expectedScriptVersion: 1 });
  assert.equal(stale.ok, false);
});

test('"rewrite with this hook" asks Gemini once for a script that starts with exactly that hook', () => {
  const rewritten = (env, hook) => {
    const r = fixture(env).reels[0];
    r.hook = hook;
    r.scenes[0].narration = hook;
    r.captions[0] = hook;
    r.scenes[1].narration = '아침마다 허둥대잖아요';
    return { reels: [r] };
  };
  const hook = '급하게 출근할 때마다 우산 깜빡하는 사람?';
  let env;
  const s = setup((n) => (n === 1 ? fixture(env) : rewritten(env, hook)));
  env = s.env;
  s.call('apiGenerateScripts', 'PRD-001');
  const res = s.pick('H1', hook, 'regenerate');
  assert.equal(res.ok, true, res.error);
  assert.equal(env.state.fetches.length, 2, 'one rewrite call');
  const body = env.state.fetches[1];
  const prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /## 운영자가 고른 훅 \(그대로 사용\)\n- "급하게 출근할 때마다 우산 깜빡하는 사람\?"/);
  assert.match(prompt, /## 현재 대본 \(JSON\)/);
  assert.equal(body.generationConfig.responseSchema.properties.hooks, undefined, 'hooks are not regenerated');
  assert.equal(res.detail.summary.scriptVersion, 2);
  assert.equal(s.row()['후킹'], hook);
  assert.match(s.row()['자막'], /아침마다 허둥대잖아요/);
  assert.equal(JSON.parse(s.row()['선택한 훅']).mode, 'regenerated');
  assert.ok(env.sheets.AUDIT.rows.some((a) => a[3] === 'SELECT_HOOK' && /Gemini로 대본 다시 씀/.test(a[9]) && /owner@example\.com \+ Gemini/.test(a[8])));
  assert.equal(s.act('APPROVE_SCRIPT', { hookReviewed: true }).ok, true, 'the chosen hook is valid for approval');
});

test('a rewrite that does not start with the chosen hook is retried once, then nothing changes', () => {
  let env;
  const s = setup((n) => (n === 1 ? fixture(env) : { reels: [fixture(env).reels[0]] }));
  env = s.env;
  s.call('apiGenerateScripts', 'PRD-001');
  const before = JSON.stringify(env.sheets.REELS.rows);
  const res = s.pick('H1', '급하게 출근할 때마다 우산 깜빡하는 사람?', 'regenerate');
  assert.equal(res.ok, false);
  assert.match(res.error, /선택한 훅으로 다시 쓴 대본이 검증을 통과하지 못했습니다[\s\S]*정확히 시작해야/);
  assert.equal(env.state.fetches.length, 3, 'first try + one corrective retry');
  assert.equal(JSON.stringify(env.sheets.REELS.rows), before, 'script and choice unchanged');
});

test('a regenerated script with a different hook needs the hook chosen again before approval', () => {
  let env;
  const s = setup((n) => {
    const f = fixture(env);
    if (n === 1) return f;
    const r = f.reels[0];
    r.hook = '좁은 현관 우산 정리, 문에 붙이면 돼요';
    r.scenes[0].narration = r.hook;
    r.captions[0] = r.hook;
    return { reels: [r] };
  });
  env = s.env;
  s.call('apiGenerateScripts', 'PRD-001');
  s.pick('H4', '비 오는 날, 현관에 젖은 우산이 굴러다녀요');
  s.act('REQUEST_SCRIPT_CHANGES', { note: '결론부터 말해 주세요' });
  const regen = s.call('apiRegenerateScript', 'PRD-001-R01', { expectedScriptVersion: 1 });
  assert.equal(regen.ok, true, regen.error);
  assert.equal(regen.detail.hooks.selectionValid, false);
  assert.match(s.act('APPROVE_SCRIPT').error, /선택한 훅 .*과 현재 대본의 훅이 다릅니다/);
  assert.equal(s.pick('H5', '좁은 현관 우산 정리, 문에 붙이면 돼요').ok, true);
  assert.equal(s.act('APPROVE_SCRIPT', { hookReviewed: true }).ok, true);
});

test('the prompt and schema ask for five hooks, a recommendation, the keyword, emphasis/SFX and 20–40 s', () => {
  const { env, product } = setup();
  const prompt = env.gs('buildGeminiPrompt')(product);
  for (const s of [
    '① 서로 다른 훅 5개(H1~H5)', 'recommended_hook', '최종 훅은 운영자가 고릅니다',
    'H1 QUESTION (질문형)', 'H2 NUMBER (숫자로 시작하는형)', '통계·수량·퍼센트를 지어내지 말 것', 'H3 MYTH (통념을 뒤집는 단정형)', 'H4 SITUATION (상황 묘사형)', 'H5 CONCLUSION (결론 먼저 던지는형)',
    '유치원생도 알아들을 쉬운 생활 언어', 'comment_keyword', '상품ID 같은 내부 코드는 쓰지 마세요',
    'emphasis: 자막 강조', 'sfx: 효과음', '20~40초', '억지로 늘리지 마세요', '실제 음성 길이로 다시 확인',
    'HOOK(= PROBLEM', 'DEMO(= DEMONSTRATION',
  ]) assert.ok(prompt.includes(s), s);
  const schema = plain(env.gs('RF_GEMINI_RESPONSE_SCHEMA'));
  assert.deepEqual(schema.required, ['hooks', 'recommended_hook', 'comment_keyword', 'reels']);
  assert.equal(schema.properties.hooks.minItems, 5);
  assert.deepEqual(schema.properties.hooks.items.properties.type.enum, ['QUESTION', 'NUMBER', 'MYTH', 'SITUATION', 'CONCLUSION']);
  const scene = schema.properties.reels.items.properties.scenes.items;
  for (const k of ['visual', 'emphasis', 'sfx', 'flow_prompt', 'fact_ids', 'duration_sec']) assert.ok(scene.required.includes(k), k);
  assert.equal(env.gs('RF_CONFIG.REELS_PER_PRODUCT'), 1);
});

test('choosing a hook swaps in its whole opening scene (line, caption, visual, Flow prompt, emphasis, SFX); later scenes stay', () => {
  const { env, call, pick, row, act } = setup();
  call('apiGenerateScripts', 'PRD-001');
  const before = JSON.parse(row()['장면(JSON)']);
  const h1 = JSON.parse(row()['훅 후보(JSON)']).hooks[0];
  assert.ok(h1.visual && h1.flow_prompt.length > 30, 'each hook carries its opening scene');
  const res = pick('H1', h1.text);
  assert.equal(res.ok, true, res.error);
  const after = JSON.parse(row()['장면(JSON)']);
  assert.deepEqual(
    [after[0].narration, after[0].visual, after[0].flow_prompt, after[0].emphasis, after[0].sfx],
    [h1.text, h1.visual, h1.flow_prompt, h1.emphasis, h1.sfx]
  );
  assert.equal(row()['자막'].split('\n')[0], h1.text);
  assert.match(row()['Flow 프롬프트'].split('\n')[0], new RegExp('^S1 \\(3s\\): ' + h1.flow_prompt.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(after.slice(1), before.slice(1), 'scenes 2+ unchanged (written to follow any hook)');
  // The updated script is what the dashboard shows for review, as a new version.
  assert.equal(res.detail.summary.scriptVersion, 2);
  assert.equal(res.detail.reel.scenes[0].visual, h1.visual);
  // A later edit that keeps the hook keeps the choice for the new version.
  const ed = act('EDIT_SCRIPT', { edit: { concept: '출근길 버전' } });
  assert.equal(ed.ok, true, ed.error);
  assert.equal(ed.detail.hooks.selectionValid, true);
  assert.equal(JSON.parse(row()['선택한 훅']).scriptVersion, 3);
  assert.equal(act('APPROVE_SCRIPT', { hookReviewed: true }).ok, true);
});

test('a script written before the five-hook workflow: "훅 5개 만들기" (1 call), choose, review, then approve', () => {
  // Gemini's answer for an existing script: five hooks with openings + recommendation (no script).
  const hooksOnly = (env) => {
    const f = fixture(env);
    return { hooks: f.hooks, recommended_hook: f.recommended_hook };
  };
  let env;
  const s = setup((n) => (n === 1 ? hooksOnly(env) : hooksOnly(env)));
  env = s.env;
  // An old row (like the live PRD-001-R01 v2): no hook candidates.
  const recs = env.gs('prepareReelRecords')(s.product, JSON.stringify(fixture(env)), [], [], { model: 'old', generatedAt: 'g' }).records;
  recs[0]['훅 후보(JSON)'] = '';
  recs[0]['대본 버전'] = 2;
  env.gs('appendRecords_')(env.sheets.REELS, recs, env.gs('RF_SCRIPT_FIELDS'));
  const scriptBefore = s.row()['장면(JSON)'];
  const d = s.detail();
  assert.deepEqual([d.hooks.required, d.hooks.candidates.length, d.hooks.canGenerate, d.hooks.canSelect], [true, 0, true, false]);
  assert.match(s.act('APPROVE_SCRIPT', { hookReviewed: true }).error, /훅 후보 5개가 없습니다[\s\S]*훅 5개 만들기/);
  // Make hooks: one Gemini call, hooks-only schema, current script in the prompt, script unchanged.
  const made = s.call('apiGenerateHooks', 'PRD-001-R01', { expectedStatus: d.summary.status, expectedScriptVersion: 2 });
  assert.equal(made.ok, true, made.error);
  assert.equal(env.state.fetches.length, 1);
  const body = env.state.fetches[0];
  assert.deepEqual(body.generationConfig.responseSchema.required, ['hooks', 'recommended_hook']);
  const prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /"현재 대본"에 쓸 서로 다른 훅 5개/);
  assert.match(prompt, /## 현재 대본 \(JSON\)/);
  assert.match(prompt, /각 훅마다 그 훅으로 시작할 때의 첫 장면/);
  assert.equal(s.row()['장면(JSON)'], scriptBefore, 'the script is not changed by making hooks');
  assert.equal(made.detail.summary.scriptVersion, 2);
  assert.equal(made.detail.hooks.candidates.length, 5);
  assert.ok(env.sheets.AUDIT.rows.some((a) => a[3] === 'SET_HOOKS'));
  // Choose H2, review, approve. No paid media before approval.
  const h2 = made.detail.hooks.candidates[1];
  const picked = s.pick('H2', h2.text);
  assert.equal(picked.ok, true, picked.error);
  assert.equal(picked.detail.summary.scriptVersion, 3);
  assert.equal(picked.detail.reel.scenes[0].narration, h2.text);
  assert.equal(picked.detail.reel.scenes[0].visual, h2.visual);
  assert.equal(s.call('apiGetRenderJob', 'PRD-001-R01').ok, false);
  assert.match(s.act('APPROVE_SCRIPT').error, /확인했다고 체크/);
  const ok = s.act('APPROVE_SCRIPT', { hookReviewed: true });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.detail.flowScenePrompts[0].prompt.includes(h2.flow_prompt.slice(0, 40)), true, 'Flow prompt for scene 1 follows the chosen hook');
});

test('without the hook columns: making hooks stops before Gemini, and approval says to run 시트 준비', () => {
  const env = createEnv({ autoSelectHook: false, gemini: () => fixture(env) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const { MockSheet } = require('./helpers/apps-script-mock');
  env.sheets.REELS = new MockSheet('REELS', [plain(env.gs('RF_CONFIG.REELS_HEADERS'))]);
  env.props.RF_REVIEWERS = 'owner@example.com';
  const recs = env.gs('prepareReelRecords')(plain(env.gs('FIXTURE_PRD_001_PRODUCT')), JSON.stringify(fixture(env)), [], [], { model: 'm', generatedAt: 'g' }).records;
  env.gs('appendRecords_')(env.sheets.REELS, recs, env.gs('RF_SCRIPT_FIELDS'));
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const d = call('apiGetReel', 'PRD-001-R01').detail;
  assert.equal(d.hooks.columnsMissing, true);
  const made = call('apiGenerateHooks', 'PRD-001-R01', { expectedScriptVersion: 1 });
  assert.match(made.error, /시트 준비/);
  assert.equal(env.state.fetches.length, 0, 'no paid call');
  const ap = call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: d.summary.status, expectedScriptVersion: 1, hookReviewed: true });
  assert.match(ap.error, /시트 준비/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Dashboard.html'), 'utf8');
  for (const k of ['훅 5개 만들기 (Gemini 1회)', "call('apiGenerateHooks'", "call('apiSelectHook'", 'hookReviewed: true', '끝까지 확인했습니다', '첫 장면: ', '시트 준비']) {
    assert.ok(html.includes(k), k);
  }
});

test('TTS timing: the real voice decides the scene lengths; a total beyond 40 s stops before rendering', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const template = loadTemplate('lifestyle-v1');
  // Unit: scenes stretch for the voice (warning); the total must stay within 20–40 s (error).
  const job0 = { reelId: 'X', script: { '장면(JSON)': JSON.stringify(plain(createEnv({}).gs('FIXTURE_PRD_001_GEMINI_RESPONSE')).reels[0].scenes), 'ManyChat 키워드': '우산' } };
  const sb0 = buildStoryboard(job0, template);
  const ok = qc.ttsTiming(sb0, buildTimeline(sb0, sb0.beats.map(() => ({ file: 'x', duration: 1.5 })), template), template);
  assert.equal(ok.ok, true);
  assert.match(ok.checks[0].detail, /실제 음성 기준 24\.0초 \(허용 20~40초, 대본 24초\)/);
  const stretched = qc.ttsTiming(sb0, buildTimeline(sb0, [1.5, 1.5, 6.5, 1.5, 1.5, 1.5].map((d) => ({ file: 'x', duration: d })), template), template);
  assert.equal(stretched.ok, true, 'a stretched scene is a warning');
  assert.equal(stretched.checks.find((c) => c.id === 'timing.S3').ok, false);
  const tooLong = qc.ttsTiming(sb0, buildTimeline(sb0, sb0.beats.map(() => ({ file: 'x', duration: 7 })), template), template);
  assert.equal(tooLong.ok, false);

  // Integration: approved job, footage present, voice too long → QC error after TTS, before FFmpeg.
  const { env, call, act } = setup();
  call('apiGenerateScripts', 'PRD-001');
  call('apiSelectHook', 'PRD-001-R01', { hookId: 'H4', mode: 'keep', expectedScriptVersion: 1 });
  act('APPROVE_SCRIPT', { hookReviewed: true });
  act('START_VIDEO');
  const jobFile = JSON.parse(call('apiGetRenderJob', 'PRD-001-R01').jobFile);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-5h-'));
  const reel = path.join(dir, 'clips', 'PRD-001-R01');
  fs.mkdirSync(reel, { recursive: true });
  for (let n = 1; n <= 6; n++) fs.writeFileSync(path.join(reel, 'S' + n + '.mp4'), 'x');
  const calls = [];
  const provider = { name: 'spy', paid: true, async synthesize(req) { calls.push(req.text); return silentWav(7); } };
  const tts = createTtsService({ provider, voice: 'ko-KR-Wavenet-A', speakingRate: 1, cacheDir: path.join(dir, 'cache'), ledgerFile: path.join(dir, 'usage.json') });
  const opts = { jobFile, secret: env.props.RF_RENDER_SECRET, template, tts, storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: path.join(dir, 'clips'), ffmpeg: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, font: 'NanumGothic', allowFontFallback: true, analyze: async () => ({ width: 1080, height: 1920, duration: 8, frames: 30, flatRatio: 0, motion: 3 }) };
  await assert.rejects(render(opts), (e) => e instanceof qc.QcError && /음성 길이 점검 \(렌더링 전\)/.test(e.message) && /timing\.total/.test(e.message));
  assert.equal(calls.length, 6);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false, 'nothing rendered');
  // Re-running costs no TTS (cached) and stops at the same check.
  await assert.rejects(render(opts), qc.QcError);
  assert.equal(calls.length, 6);
  assert.ok(verifyJob(jobFile, { secret: env.props.RF_RENDER_SECRET }));
});

test('complete workflow: generate → five hooks shown → choose H3 → updated script reviewed → approve → only then Flow prompts and render job', () => {
  const { env, call, detail, act, pick, row } = setup();
  const dash0 = call('apiGetDashboard');
  assert.equal(dash0.codeVersion, env.gs('RF_CONFIG.CODE_VERSION'), 'the dashboard shows the deployed code version');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'dist', 'ReelsFactory.gs'), 'utf8').includes(".addItem('코드 버전 확인 (대시보드와 비교)', 'showCodeVersion')"), 'menu: compare with the dashboard');
  call('apiGenerateScripts', 'PRD-001');
  const d = detail();
  assert.deepEqual(d.hooks.candidates.map((c) => c.id + ' ' + c.label), ['H1 질문형', 'H2 숫자로 시작하는형', 'H3 통념을 뒤집는 단정형', 'H4 상황 묘사형', 'H5 결론 먼저 던지는형']);
  assert.equal(d.hooks.recommended.id, 'H4');
  assert.ok(d.hooks.candidates.every((c) => c.visual && c.flow_prompt));
  assert.equal(d.hooks.selectionValid, false);
  assert.match(act('APPROVE_SCRIPT', { hookReviewed: true }).error, /훅을 먼저 선택하세요/);
  const h3 = d.hooks.candidates[2];
  const chosen = pick('H3', h3.text);
  assert.equal(chosen.ok, true, chosen.error);
  assert.equal(chosen.detail.reel.hook, h3.text);
  assert.equal(chosen.detail.reel.scenes[0].visual, h3.visual);
  assert.equal(chosen.detail.hooks.selectionValid, true);
  assert.equal(row()['Flow 장면 프롬프트'], '', 'no Flow prompts before approval');
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, false, 'no render job before approval');
  assert.match(act('APPROVE_SCRIPT').error, /확인했다고 체크/);
  const ap = act('APPROVE_SCRIPT', { hookReviewed: true });
  assert.equal(ap.ok, true, ap.error);
  assert.ok(ap.detail.flowScenePrompts[0].prompt.includes(h3.flow_prompt.slice(0, 40)));
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, false, 'approved but not in production → still no job');
  assert.equal(act('START_VIDEO').ok, true);
  assert.equal(call('apiGetRenderJob', 'PRD-001-R01').ok, true);
  const actions = env.sheets.AUDIT.rows.slice(1).map((r) => r[3]);
  assert.deepEqual(actions.filter((a) => /SCRIPT|HOOK/.test(a)), ['SCRIPTS_GENERATED', 'SELECT_HOOK', 'APPROVE_SCRIPT']);
  assert.equal(env.state.fetches.length, 1, 'one Gemini call for the whole review');
});
