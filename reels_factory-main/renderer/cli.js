#!/usr/bin/env node
// Reels Factory renderer CLI.
//   node renderer/cli.js check                       # FFmpeg/font/config sanity — no API calls
//   node renderer/cli.js estimate --job <file>       # verify approval + cost estimate — no API calls
//   node renderer/cli.js render   --job <file> [--preview] [--force] [--tts google|heygen|local|silent] [--voice <id>]
//   node renderer/cli.js fetch-clips --job <file>     # download the reel's Flow clips from its Google Drive folder
//   node renderer/cli.js pending [--watch <minutes>]  # render every job in RF_JOBS_DIR whose clips are ready
//   node renderer/cli.js usage                       # TTS characters used this month
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { loadConfig } = require('./lib/config');
const { loadJobFile, verifyJob, GateError } = require('./lib/job');
const { createGeminiClient } = require('./lib/gemini');
const { createFinalChecker } = require('./lib/final-check');
const { driveAuth, createDriveClient, fetchClips, loadReferenceImages } = require('./lib/drive');
const { createTtsService, BudgetError } = require('./lib/tts');
const { createGoogleTts, apiKeyAuth, metadataAuth, gcloudAuth } = require('./lib/tts/google');
const { createHeyGenTts } = require('./lib/tts/heygen');
const { createLocalTts } = require('./lib/tts/local');
const { createSilentTts } = require('./lib/tts/silent');
const { createLocalStorage } = require('./lib/storage/local');
const { checkFfmpeg } = require('./lib/ffmpeg');
const { render } = require('./lib/render');
const { loadTemplate } = require('./lib/template');
const { AssetsRequiredError } = require('./lib/assets');
const { QcError } = require('./lib/qc');
const { StoryboardError } = require('./lib/storyboard');
const { findFont, FontMissingError, INSTALL_HELP } = require('./lib/fonts');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function makeProvider(name, cfg) {
  if (name === 'local') return createLocalTts();
  if (name === 'silent') return createSilentTts();
  if (name === 'heygen') {
    return createHeyGenTts({
      apiKey: cfg.heygenApiKey,
      ffmpeg: cfg.ffmpeg.ffmpeg,
    });
  }
  if (name !== 'google') throw new Error('알 수 없는 TTS 제공자: ' + name);
  const auth = cfg.ttsAuth === 'apiKey'
    ? apiKeyAuth(cfg.googleApiKey)
    : cfg.ttsAuth === 'metadata' ? metadataAuth() : gcloudAuth(cfg.gcpProject);
  if (cfg.ttsAuth === 'apiKey' && !cfg.googleApiKey) throw new Error('GOOGLE_TTS_API_KEY가 없습니다 (renderer/.env).');
  return createGoogleTts({ auth });
}

/**
 * Gemini's advisory check of the finished video. Needs GEMINI_API_KEY in renderer/.env; skipped for preview
 * renders and with --no-ai-check. Verified product images: renderer/refs/<productId>/ or the job's Drive IDs.
 */
function makeFinalCheck(cfg, args, preview) {
  if (!cfg.geminiApiKey || args['no-ai-check'] || preview) return null;
  const drive = createDriveClient({ authHeaders: driveAuth(cfg) });
  return createFinalChecker({
    gemini: createGeminiClient({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel }),
    ffmpeg: cfg.ffmpeg,
    loadReferenceImages: async (job) => {
      try {
        return await loadReferenceImages({ job, refsDir: cfg.refsDir, drive });
      } catch (e) {
        console.log('! 제품 이미지를 불러오지 못했습니다 (영상 점검에서 제품 일치는 확인 불가): ' + e.message);
        return [];
      }
    },
  });
}

/** Render options shared by `render`, `estimate` and `pending`. */
function buildOptions(jobFile, args, cfg, dryRun) {
  const preview = !!args.preview;
  // --preview = same footage, free local voice (to check timing before paying for Google TTS).
  const providerName = args.tts || (preview ? 'local' : cfg.ttsProvider);
  const provider = makeProvider(providerName, cfg);
  const voice = providerName === 'heygen'
    ? (args.voice || cfg.heygenVoice)
    : providerName === 'google'
      ? (args.voice || cfg.voice)
      : providerName;
  return {
    jobFile,
    template: loadTemplate(args.template || process.env.RF_TEMPLATE || 'lifestyle-v1'),
    secret: cfg.secret,
    tts: createTtsService({
      provider,
      voice,
      speakingRate: cfg.speakingRate,
      cacheDir: cfg.cacheDir,
      ledgerFile: cfg.ledgerFile,
      maxCharsPerJob: cfg.maxCharsPerJob,
      monthlyCharLimit: cfg.monthlyCharLimit,
    }),
    storage: createLocalStorage({ outputDir: path.resolve(args.out || cfg.outputDir) }),
    clipsDir: path.resolve(args.clips || cfg.clipsDir),
    preview,
    dryRun,
    force: !!args.force,
    ffmpeg: cfg.ffmpeg,
    font: cfg.font,
    fontsDir: cfg.fontsDir,
    defaultSource: cfg.defaultSource,
    finalCheck: makeFinalCheck(cfg, args, preview),
    allowFontFallback: cfg.allowFontFallback,
    crf: cfg.crf,
    preset: cfg.preset,
    log: (m) => console.log(m),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const cfg = loadConfig();
  const log = (m) => console.log(m);

  if (cmd === 'check') {
    const ff = await checkFfmpeg(cfg.ffmpeg);
    log('✓ ' + ff.version);
    const tmpl = loadTemplate(args.template || process.env.RF_TEMPLATE || 'lifestyle-v1');
    const fam = tmpl.subtitle.font || cfg.font;
    const f = findFont(fam, { fontsDir: cfg.fontsDir });
    log((f.found ? '✓' : '✗') + ' 자막 글꼴 ' + fam + (f.found ? ' (' + (f.file || f.via) + ')' : ' 없음 — ' + (INSTALL_HELP[fam] || '설치 필요')));
    log('Gemini 영상 점검: ' + (cfg.geminiApiKey ? '켜짐 (' + cfg.geminiModel + ', 참고용)' : 'GEMINI_API_KEY 없음 — 건너뜀'));
    const activeVoice = cfg.ttsProvider === 'heygen' ? cfg.heygenVoice : cfg.voice;
    log('TTS: ' + cfg.ttsProvider + ' / ' + activeVoice + ' (HeyGen 키: ' + (cfg.heygenApiKey ? '설정됨' : '미설정') + ', Google 키: ' + (cfg.googleApiKey ? '설정됨' : '미설정') + ')');
    log('렌더 키: ' + (cfg.secret ? '설정됨' : '없음 — Sheets 메뉴 "렌더 키 보기"'));
    log('작업 폴더: ' + cfg.jobsDir + '\n클립 폴더: ' + cfg.clipsDir + '\n출력 폴더: ' + cfg.outputDir + '\n캐시/사용량: ' + cfg.stateDir);
    return;
  }
  if (cmd === 'usage') {
    const f = cfg.ledgerFile;
    log(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '아직 사용량이 없습니다.');
    log('월 한도(RF_TTS_MONTHLY_CHAR_LIMIT): ' + cfg.monthlyCharLimit);
    return;
  }
  if (cmd === 'pending') {
    const { processPending } = require('./lib/pending');
    const once = () => processPending({ cfg, args, makeOptions: (jobFile) => buildOptions(jobFile, args, cfg, false), log });
    await once();
    if (args.watch) {
      const minutes = Number(args.watch) || 10;
      log(`… ${minutes}분마다 다시 확인합니다 (Ctrl+C로 종료).`);
      // Never start a pass while the previous one is still rendering (it could request the same narration).
      let running = false;
      setInterval(() => {
        if (running) return log('… 이전 확인이 아직 진행 중이라 이번 회차는 건너뜁니다.');
        running = true;
        once().catch((e) => log('✗ ' + e.message)).finally(() => { running = false; });
      }, minutes * 60 * 1000);
    }
    return;
  }
  if (cmd === 'fetch-clips') {
    if (!args.job) throw new Error('--job <렌더 작업 파일> 이 필요합니다.');
    const job = verifyJob(loadJobFile(path.resolve(args.job)), { secret: cfg.secret });
    const r = await fetchClips({ drive: createDriveClient({ authHeaders: driveAuth(cfg) }), job, clipsDir: path.resolve(args.clips || cfg.clipsDir), log });
    log(`Drive → ${r.dir}\n내려받음 ${r.downloaded.length}: ${r.downloaded.join(', ') || '-'}\n이미 있음 ${r.kept.length}: ${r.kept.join(', ') || '-'}\n아직 Drive에 없음 ${r.missing.length}: ${r.missing.join(', ') || '-'}` + (r.ignored.length ? `\n목록에 없는 파일(무시): ${r.ignored.join(', ')}` : ''));
    return;
  }
  if (cmd !== 'render' && cmd !== 'estimate') {
    log('사용법: node renderer/cli.js check | estimate --job <file> | fetch-clips --job <file> | render --job <file> [--preview] [--force] [--no-ai-check] [--clips <dir>] [--template lifestyle-v1] [--tts google|heygen|local|silent] [--voice <id>] | pending [--watch <분>] | usage');
    return;
  }
  if (!args.job) throw new Error('--job <렌더 작업 파일> 이 필요합니다.');

  const result = await render(buildOptions(loadJobFile(path.resolve(args.job)), args, cfg, cmd === 'estimate' || !!args['dry-run']));
  if (result.dryRun) {
    const e = result.estimate;
    log('(점검만 — API 호출 없음)');
    log(`음성 ${e.segments}줄 (캐시 ${e.cachedSegments}) · 과금 글자 ${e.billableChars} · ${e.voice} · 예상 $${e.estimatedUsd.toFixed(4)} · 이번 달 ${e.usedThisMonth}/${e.monthlyCharLimit}`);
    result.preflight.checks.forEach((c) => log(`${c.ok ? '✓' : c.level === 'warn' ? '!' : '✗'} ${c.id}: ${c.detail}`));
    log(result.assets.ok ? `✓ 영상 소스 ${Object.keys(result.assets.shots).length}컷 확인` : '✗ 영상 소스: ' + result.assets.problems.join(' / '));
    return;
  }
  log(JSON.stringify({ output: result.output.path, duration: result.output.duration, tts: { billableChars: result.tts.billableChars, estimatedUsd: result.tts.estimatedUsd }, reused: !!result.reused }, null, 2));
}

// Exit codes: 2 = approval/budget gate, 3 = ASSETS_REQUIRED, 4 = QC failed, 5 = font missing, 1 = other.
main().catch((e) => {
  if (e instanceof FontMissingError) {
    console.error('✗ FONT_MISSING (비용 발생 없음): ' + e.message);
    process.exit(5);
  }
  if (e instanceof AssetsRequiredError) {
    console.error('✗ ASSETS_REQUIRED (비용 발생 없음): ' + e.report.summary);
    e.report.problems.slice(0, 20).forEach((p) => console.error('  - ' + p));
    console.error(JSON.stringify({ status: 'ASSETS_REQUIRED', reelId: e.report.reelId, shotlist: e.report.shotlist, flowPrompts: e.report.flowPrompts, required: e.report.required }, null, 2));
    process.exit(3);
  }
  if (e instanceof QcError) {
    console.error('✗ ' + e.message);
    process.exit(4);
  }
  const free = e instanceof GateError || e instanceof BudgetError || e instanceof StoryboardError;
  const kind = e instanceof GateError ? '승인 확인 실패' : e instanceof BudgetError ? '예산 한도' : e instanceof StoryboardError ? '대본 형식' : '오류';
  console.error('✗ ' + kind + (free ? ' (비용 발생 없음)' : '') + ': ' + e.message);
  process.exit(free ? 2 : 1);
});
