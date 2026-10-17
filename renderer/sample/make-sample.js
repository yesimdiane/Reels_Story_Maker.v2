#!/usr/bin/env node
// PRD-001 sample: runs the real Apps Script approval flow against an in-memory Sheet (fixture
// storyboard, no Gemini call), issues a signed render job, then renders with the lifestyle template.
//
//   node renderer/sample/make-sample.js [--clips renderer/clips] [--out renderer/output] [--tts local|google]
//
// Footage is required: one Google Flow clip per scene (S1.mp4 … S5.mp4) — see the generated
// renderer/clips/PRD-001-R01/SHOTLIST.md and FLOW_PROMPTS.md.
// Without footage the job stops with ASSETS_REQUIRED (exit 3) — it never substitutes slides.
// --tts local (default) = free preview voice; --tts google = final voice (uses GOOGLE_TTS_API_KEY).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEnv, prd001Row } = require('../../tests/helpers/apps-script-mock');
const { createTtsService } = require('../lib/tts');
const { createLocalTts } = require('../lib/tts/local');
const { createGoogleTts, apiKeyAuth } = require('../lib/tts/google');
const { createLocalStorage } = require('../lib/storage/local');
const { loadConfig } = require('../lib/config');
const { loadTemplate } = require('../lib/template');
const { render } = require('../lib/render');
const { AssetsRequiredError } = require('../lib/assets');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : dflt;
}

async function main() {
  const root = path.join(__dirname, '..');
  const outDir = path.resolve(arg('out', path.join(root, 'output')));
  const clipsDir = path.resolve(arg('clips', path.join(root, 'clips')));
  const ttsName = arg('tts', 'local');
  const plain = (v) => JSON.parse(JSON.stringify(v));

  // 1. Sheet-side flow (same bundle you paste into Apps Script).
  const env = createEnv({ gemini: () => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  // The operator added the optional PRODUCTS column "ManyChat 키워드" = 우산 (used by all PRD-001 reels).
  env.sheets.PRODUCTS.rows[0].push('ManyChat 키워드');
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/sample' }).concat(['우산']));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const must = (r) => { if (!r.ok) throw new Error(r.error); return r; };
  must(call('apiGenerateScripts', 'PRD-001'));
  must(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 }));
  must(call('apiAction', 'PRD-001-R01', 'START_VIDEO', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1, expectedVideoVersion: 0 }));
  const jobRes = must(call('apiGetRenderJob', 'PRD-001-R01'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, jobRes.fileName), jobRes.jobFile);
  console.log('✓ 승인된 스토리보드로 서명된 렌더 작업: ' + path.join(outDir, jobRes.fileName));

  // 2. Renderer.
  const cfg = loadConfig();
  const state = ttsName === 'google' ? cfg.stateDir : fs.mkdtempSync(path.join(os.tmpdir(), 'rf-sample-'));
  const provider = ttsName === 'google' ? createGoogleTts({ auth: apiKeyAuth(cfg.googleApiKey) }) : createLocalTts();
  const manifest = await render({
    jobFile: JSON.parse(jobRes.jobFile),
    secret: env.props.RF_RENDER_SECRET,
    template: loadTemplate(),
    tts: createTtsService({
      provider, voice: ttsName === 'google' ? cfg.voice : 'local', speakingRate: cfg.speakingRate,
      cacheDir: path.join(state, 'cache', 'tts'), ledgerFile: path.join(state, 'tts-usage.json'),
      maxCharsPerJob: cfg.maxCharsPerJob, monthlyCharLimit: cfg.monthlyCharLimit,
    }),
    storage: createLocalStorage({ outputDir: outDir }),
    clipsDir,
    preview: ttsName !== 'google',
    ffmpeg: cfg.ffmpeg,
    font: cfg.font,
    fontsDir: cfg.fontsDir,
    defaultSource: cfg.defaultSource,
    allowFontFallback: cfg.allowFontFallback,
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify({ output: manifest.output.path, duration: manifest.output.duration, qc: manifest.qc.postRender.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.id}`) }, null, 2));
}

main().catch((e) => {
  if (e instanceof AssetsRequiredError) {
    console.error('✗ ASSETS_REQUIRED: ' + e.report.summary);
    e.report.problems.slice(0, 20).forEach((p) => console.error('  - ' + p));
    process.exit(3);
  }
  console.error('✗ ' + e.message);
  process.exit(1);
});
