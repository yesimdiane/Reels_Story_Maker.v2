// Gemini model selection: valid default, free model check, fallback only on 404 (nothing billed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');

const plain = (v) => JSON.parse(JSON.stringify(v));
function setup(opts = {}) {
  const env = createEnv(Object.assign({ gemini: () => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) }, opts));
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs));
  env.gs('setupSheets()');
  return env;
}

test('default model is the GA Flash model with structured output; fallback is the Flash alias', () => {
  const env = setup();
  assert.equal(env.gs('RF_CONFIG.DEFAULT_GEMINI_MODEL'), 'gemini-3.5-flash');
  assert.deepEqual(plain(env.gs('RF_CONFIG.GEMINI_FALLBACK_MODELS')), ['gemini-flash-latest']);
  const res = plain(env.gs('apiGenerateScripts')('PRD-001'));
  assert.equal(res.ok, true);
  assert.deepEqual(env.state.modelCalls, ['generate gemini-3.5-flash']);
  const body = env.state.fetches[0];
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.properties.reels.maxItems, 1);
  assert.equal(body.generationConfig.responseSchema.properties.hooks.maxItems, 5, 'five hooks per product');
  assert.equal(env.sheets.REELS.record(2)['생성 모델'], 'gemini-3.5-flash');
});

test('404 on the configured model → falls back to gemini-flash-latest once; records the model actually used', () => {
  const env = setup({ missingModels: ['gemini-3.5-flash'] });
  const res = plain(env.gs('apiGenerateScripts')('PRD-001'));
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(env.state.modelCalls, ['generate gemini-3.5-flash', 'generate gemini-flash-latest']);
  assert.equal(env.state.fetches.length, 1, 'only one generation actually ran');
  assert.equal(env.sheets.REELS.record(2)['생성 모델'], 'gemini-flash-latest');
  assert.ok(env.sheets.LOG.rows.some((r) => r[1] === 'WARN' && /gemini-flash-latest/.test(r[4])));
});

test('all models missing → clear error, nothing written', () => {
  const env = setup({ missingModels: ['gemini-3.5-flash', 'gemini-flash-latest'] });
  const res = plain(env.gs('apiGenerateScripts')('PRD-001'));
  assert.equal(res.ok, false);
  assert.match(res.error, /HTTP 404.*gemini-3\.5-flash, gemini-flash-latest 모두 사용할 수 없습니다.*Gemini 모델 확인/);
  assert.equal(env.sheets.REELS.rows.length, 1);
});

test('GEMINI_MODEL script property overrides the default; fallback still applies', () => {
  const env = setup({ missingModels: ['gemini-9-flash'] });
  env.props.GEMINI_MODEL = 'gemini-9-flash';
  assert.equal(plain(env.gs('apiGenerateScripts')('PRD-001')).ok, true);
  assert.deepEqual(env.state.modelCalls, ['generate gemini-9-flash', 'generate gemini-flash-latest']);
});

test('menu "Gemini 모델 확인" uses models.get only (free) and reports the model in use', () => {
  const env = setup({ missingModels: ['gemini-3.5-flash'] });
  env.gs('showGeminiModelCheck()');
  const msg = env.state.alerts.at(-1);
  assert.match(msg, /✗ gemini-3\.5-flash — HTTP 404/);
  assert.match(msg, /✓ gemini-flash-latest/);
  assert.match(msg, /사용할 모델: gemini-flash-latest/);
  assert.ok(env.state.modelCalls.every((c) => c.startsWith('get ')), 'no generateContent call');
  assert.equal(env.state.fetches.length, 0);
});
