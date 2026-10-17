// Renderer: approval gate, cost guards, TTS cache, Google TTS request, timing plan, ASS overlay,
// and (when FFmpeg is installed) a real low-resolution render.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');
const { verifyJob, sign, GateError } = require('../renderer/lib/job');
const { createTtsService, splitNarration, BudgetError, voiceFamily } = require('../renderer/lib/tts');
const { createGoogleTts, apiKeyAuth, ENDPOINT } = require('../renderer/lib/tts/google');
const { createSilentTts } = require('../renderer/lib/tts/silent');
const { parseWav, silentWav } = require('../renderer/lib/wav');
const { buildTimeline } = require('../renderer/lib/plan');
const { buildAss, esc } = require('../renderer/lib/ass');
const { buildStoryboard, planClips, StoryboardError } = require('../renderer/lib/storyboard');
const { validateAssets, analyzeClip, AssetsRequiredError, sceneRequirements, writeAssetsRequired } = require('../renderer/lib/assets');
const { preflight, QcError } = require('../renderer/lib/qc');
const { loadTemplate } = require('../renderer/lib/template');
const { geometry } = require('../renderer/lib/layout');
const { createLocalStorage } = require('../renderer/lib/storage/local');
const { render } = require('../renderer/lib/render');

const plain = (v) => JSON.parse(JSON.stringify(v));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-test-'));

// Real server flow → signed job for PRD-001-R01 in VIDEO_IN_PRODUCTION.
function issueJob({ startVideo = true, permission = '자체 제작', keyword = '우산' } = {}) {
  const env = createEnv({ gemini: () => plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE')) });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission, affiliateUrl: 'https://link.coupang.com/a/secret-link' }));
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  call('apiGenerateScripts', 'PRD-001');
  if (keyword) env.sheets.REELS.set(env.sheets.REELS.rows.findIndex((r) => r[0] === 'PRD-001-R01') + 1, 'ManyChat 키워드', keyword);
  call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  if (startVideo) call('apiAction', 'PRD-001-R01', 'START_VIDEO', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  const res = call('apiGetRenderJob', 'PRD-001-R01');
  return { env, call, res, secret: env.props.RF_RENDER_SECRET, jobFile: res.ok ? JSON.parse(res.jobFile) : null };
}

// A provider that records calls and pretends to be paid.
function spyProvider() {
  const inner = createSilentTts();
  return { name: 'spy', paid: true, calls: inner.calls, synthesize: inner.synthesize };
}
function service(provider, dir, extra = {}) {
  return createTtsService(Object.assign({ provider, voice: 'ko-KR-Wavenet-A', speakingRate: 1, cacheDir: path.join(dir, 'cache'), ledgerFile: path.join(dir, 'usage.json') }, extra));
}

// ------------------------------------------------------------------ server side: issuing jobs

test('render jobs are issued only for approved reels in production, signed, without the affiliate link', () => {
  assert.match(issueJob({ startVideo: false }).res.error, /영상 제작 중/);
  const { res, env, secret } = issueJob();
  assert.equal(res.ok, true, res.error);
  assert.equal(res.fileName, 'PRD-001-R01_v1.render-job.json');
  const file = JSON.parse(res.jobFile);
  assert.equal(file.signature, sign(file.payload, secret), 'Apps Script and Node HMAC agree');
  assert.doesNotMatch(res.jobFile, /secret-link|test-key/);
  assert.ok(env.sheets.AUDIT.rows.some((r) => r[3] === 'RENDER_JOB_ISSUED'));
  env.state.email = 'intruder@example.com';
  assert.equal(plain(env.gs('apiGetRenderJob')('PRD-001-R01')).ok, false);
});

test('editing the approved script in the sheet stops new render jobs', () => {
  const { env, call } = issueJob();
  const i = env.sheets.REELS.rows.findIndex((r) => r[0] === 'PRD-001-R01');
  env.sheets.REELS.set(i + 1, '내레이션', '바뀐 내레이션');
  assert.match(call('apiGetRenderJob', 'PRD-001-R01').error, /승인된 대본과 현재 대본이 다릅니다/);
});

// ------------------------------------------------------------------ renderer gate (before any cost)

test('verifyJob accepts the server-issued job', () => {
  const { jobFile, secret } = issueJob();
  const job = verifyJob(jobFile, { secret });
  assert.equal(job.reelId, 'PRD-001-R01');
  assert.equal(job.status, 'VIDEO_IN_PRODUCTION');
});

test('verifyJob rejects missing secret, wrong secret, tampering, expiry, wrong status and fingerprint mismatch', () => {
  const { jobFile, secret } = issueJob();
  const p = JSON.parse(jobFile.payload);
  const resign = (mut) => {
    const q = JSON.parse(jobFile.payload);
    mut(q);
    const payload = JSON.stringify(q);
    return { payload, signature: sign(payload, secret) };
  };
  assert.throws(() => verifyJob(jobFile, { secret: '' }), GateError);
  assert.throws(() => verifyJob(jobFile, { secret: 'wrong' }), /서명이 맞지 않습니다/);
  const tampered = { payload: jobFile.payload.replace('현관', '거실'), signature: jobFile.signature };
  assert.throws(() => verifyJob(tampered, { secret }), /서명이 맞지 않습니다/);
  assert.throws(() => verifyJob(jobFile, { secret, now: new Date(Date.parse(p.expiresAt) + 1000) }), /만료/);
  assert.throws(() => verifyJob(resign((q) => (q.status = 'SCRIPT_REVIEW_PENDING')), { secret }), /영상 제작 중/);
  assert.throws(() => verifyJob(resign((q) => (q.script['내레이션'] += '!')), { secret }), /지문 불일치/);
  assert.throws(() => verifyJob(resign((q) => (q.permission = '미확인')), { secret }), /허가/);
  assert.throws(() => verifyJob({ hello: 1 }, { secret }), /형식/);
});

// ------------------------------------------------------------------ TTS service

test('TTS cache: each sentence is paid once; the ledger counts characters', async () => {
  const dir = tmp();
  const provider = spyProvider();
  const tts = service(provider, dir);
  const segs = ['첫 문장입니다.', '두 번째 문장.'];
  const est = tts.estimate(segs);
  assert.equal(est.billableChars, [...segs.join('')].length);
  assert.ok(est.estimatedUsd > 0 && est.estimatedUsd < 0.001);
  await tts.synthesizeAll(segs);
  await tts.synthesizeAll(segs);
  assert.equal(provider.calls.length, 2, 'second run is fully cached');
  assert.equal(tts.estimate(segs).billableChars, 0);
  const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
  const month = Object.values(ledger)[0];
  assert.equal(month.chars, est.billableChars);
  assert.equal(month.requests, 2);
});

test('TTS monthly limit blocks before calling the API', async () => {
  const dir = tmp();
  const provider = spyProvider();
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ [new Date().toISOString().slice(0, 7)]: { chars: 999990, requests: 1 } }));
  const tts = service(provider, dir, { monthlyCharLimit: 1000000 });
  await assert.rejects(tts.synthesizeAll(['열 글자 이상 되는 문장입니다.']), /이번 달 TTS 사용량 한도/);
  assert.equal(provider.calls.length, 0);
});

test('free providers are never counted against the paid budget', async () => {
  const dir = tmp();
  const tts = service(createSilentTts(), dir, { maxCharsPerJob: 1 });
  const out = await tts.synthesizeAll(['아주 긴 문장도 무료 제공자는 한도에 걸리지 않습니다.']);
  assert.equal(out.length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'usage.json')), false);
});

test('Google TTS request: ko-KR voice, LINEAR16, API key in header (not URL), retries 5xx', async () => {
  const calls = [];
  const wav = silentWav(0.5).toString('base64');
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return { ok: false, status: 503, json: async () => ({ error: { message: 'busy' } }) };
    return { ok: true, status: 200, json: async () => ({ audioContent: wav }) };
  };
  const g = createGoogleTts({ auth: apiKeyAuth('KEY123'), fetchFn });
  const audio = await g.synthesize({ text: '안녕하세요.', voice: 'ko-KR-Wavenet-A', speakingRate: 1.05 });
  assert.equal(Math.round(parseWav(audio).duration * 10), 5);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, ENDPOINT);
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'KEY123');
  assert.ok(!calls[1].url.includes('KEY123'));
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body.voice, { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-A' });
  assert.equal(body.audioConfig.audioEncoding, 'LINEAR16');
  assert.equal(body.input.text, '안녕하세요.');

  const bad = createGoogleTts({ auth: apiKeyAuth('x'), fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API disabled' } }) }) });
  await assert.rejects(bad.synthesize({ text: 'a', voice: 'ko-KR-Wavenet-A', speakingRate: 1 }), /Text-to-Speech API 사용 설정/);
});

test('TTS interruption: a run that fails mid-way pays again only for the lines it never received', async () => {
  const dir = tmp();
  const provider = spyProvider();
  let failOn = 2;
  const flaky = Object.assign({}, provider, {
    async synthesize(req) {
      if (provider.calls.length + 1 === failOn) {
        provider.calls.push(req.text);
        throw new Error('network down');
      }
      return provider.synthesize(req);
    },
  });
  const segs = ['첫 줄입니다.', '둘째 줄입니다.', '셋째 줄입니다.'];
  await assert.rejects(service(flaky, dir).synthesizeAll(segs), /network down/);
  assert.deepEqual(provider.calls, ['첫 줄입니다.', '둘째 줄입니다.']);
  failOn = 0;
  const out = await service(flaky, dir).synthesizeAll(segs);
  assert.deepEqual(provider.calls.slice(2), ['둘째 줄입니다.', '셋째 줄입니다.'], 'line 1 came from the cache');
  assert.deepEqual(out.map((o) => o.cached), [true, false, false]);
  // The ledger counted every request sent, including the failed one (it can over-count, never under-count).
  const month = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')))[0];
  assert.equal(month.requests, 4);
  assert.equal(month.chars, [...'첫 줄입니다.둘째 줄입니다.둘째 줄입니다.셋째 줄입니다.'].length);
});

test('TTS concurrency: two renders asking for the same lines at once pay for each line once', async () => {
  const dir = tmp();
  const provider = spyProvider();
  const slow = Object.assign({}, provider, {
    async synthesize(req) {
      await new Promise((r) => setTimeout(r, 150));
      return provider.synthesize(req);
    },
  });
  const segs = ['같은 줄 하나.', '같은 줄 둘.'];
  const [a, b] = await Promise.all([service(slow, dir).synthesizeAll(segs), service(slow, dir).synthesizeAll(segs)]);
  assert.equal(provider.calls.length, 2, provider.calls.join(' | '));
  assert.deepEqual(a.map((o) => o.file), b.map((o) => o.file));
  const month = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')))[0];
  assert.equal(month.requests, 2);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'cache')).filter((f) => f.endsWith('.lock')), [], 'locks released');
});

test('Google TTS retries only refused requests (429/503); 500 and network errors are never re-sent; each attempt is counted', async () => {
  const wav = silentWav(0.5).toString('base64');
  const run = async (responses) => {
    const sent = [];
    let attempts = 0;
    const g = createGoogleTts({
      auth: apiKeyAuth('k'), retryDelayMs: 1,
      fetchFn: async () => {
        const r = responses[sent.length];
        sent.push(r);
        if (r === 'net') throw new Error('socket hang up');
        return r === 200 ? { ok: true, status: 200, json: async () => ({ audioContent: wav }) } : { ok: false, status: r, json: async () => ({ error: { message: 'x' } }) };
      },
    });
    const res = await g.synthesize({ text: '가', voice: 'ko-KR-Wavenet-A', speakingRate: 1, onAttempt: () => attempts++ }).then(() => 'ok', (e) => e.message);
    return { res, sent: sent.length, attempts };
  };
  assert.deepEqual(await run([429, 503, 200]), { res: 'ok', sent: 3, attempts: 3 });
  assert.equal((await run([500, 200])).sent, 1, '500: maybe processed — not re-sent');
  assert.equal((await run(['net', 200])).sent, 1, 'network error after sending — not re-sent');
  assert.equal((await run([429, 429, 429, 200])).sent, 3, 'at most 3 attempts');
  // Through the service, each attempt is written to the ledger before the answer arrives.
  const dir = tmp();
  let n = 0;
  const g = createGoogleTts({ auth: apiKeyAuth('k'), retryDelayMs: 1, fetchFn: async () => (++n === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ audioContent: wav }) }) });
  await service(g, dir).synthesizeAll(['다섯 글자다']);
  const month = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')))[0];
  assert.deepEqual(month, { chars: 12, requests: 2 });
});

test('voice families map to prices; unknown voices are not guessed', () => {
  assert.equal(voiceFamily('ko-KR-Wavenet-A'), 'Wavenet');
  assert.equal(voiceFamily('ko-KR-Neural2-B'), 'Neural2');
  assert.equal(voiceFamily('ko-KR-Chirp3-HD-Aoede'), 'Chirp3-HD');
  assert.equal(voiceFamily('local'), 'Unknown');
});

// ------------------------------------------------------------------ video-first design (lifestyle-v1)

const template = loadTemplate('lifestyle-v1');
let hasFfmpeg = false;
try {
  hasFfmpeg = /\sass\s/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }));
} catch {
  hasFfmpeg = false;
}
const FF = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

function storyboardOf(opts) {
  const { jobFile, secret } = issueJob(opts);
  const job = verifyJob(jobFile, { secret });
  return { job, sb: buildStoryboard(job, template), jobFile, secret };
}

// Synthetic test footage (moving pattern) — only for tests; never shipped or used by the CLI.
function makeClip(file, { kind = 'moving', sec = 6, w = 720, h = 1280 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const src = kind === 'flat' ? `color=c=0x4a6fa5:s=${w}x${h}:d=${sec}:r=30` : `testsrc2=s=${w}x${h}:d=${sec}:r=30`;
  if (kind === 'still') {
    const png = file + '.png';
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:d=1`, '-frames:v', '1', png]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', String(sec), '-i', png, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
    return;
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
}
function writeFootage(clipsDir, reelId, ids, over = {}) {
  const dir = path.join(clipsDir, reelId);
  const shots = {};
  ids.forEach((id) => {
    makeClip(path.join(dir, id + '.mp4'));
    shots[id] = Object.assign({ file: id + '.mp4', source: 'own-footage', showsProduct: true, rights: '직접 촬영', in: 0 }, over[id] || {});
  });
  fs.writeFileSync(path.join(dir, 'assets.json'), JSON.stringify({ reelId, shots }, null, 2));
}
const okAnalysis = async () => ({ width: 1080, height: 1920, duration: 10, frames: 30, flatRatio: 0, motion: 3 });

test('storyboard: PRD-001 reference = HOOK → EMPATHY → SOLUTION → DEMO → DEMO → CTA, 24 s, 14 cuts at the reference pace, keyword in the CTA', () => {
  const { sb } = storyboardOf();
  assert.deepEqual(sb.beats.map((b) => b.beat), ['HOOK', 'EMPATHY', 'SOLUTION', 'DEMO', 'DEMO', 'CTA']);
  assert.equal(sb.scriptedTotal, 24);
  assert.deepEqual(sb.beats.map((b) => b.subtitle), [
    '비 오는 날, 현관에 젖은 우산이 굴러다녀요', '신발 둘 자리도 모자라잖아요', '자석이라 철제 현관문에 붙이면 돼요', '긴 우산도 접는 우산도 쏙 꽂아요', '위아래 두 조각으로 나뉘어 있어요', "저장해 두고, 댓글에 '우산' 남겨 주세요",
  ]);
  const shots = sb.beats.flatMap((b) => b.shots);
  assert.deepEqual(shots.map((s) => s.id), ['S1-1', 'S1-2', 'S2-1', 'S2-2', 'S3-1', 'S3-2', 'S3-3', 'S4-1', 'S4-2', 'S4-3', 'S5-1', 'S5-2', 'S6-1', 'S6-2']);
  assert.ok(shots.every((s) => s.scriptedSec >= template.shots.minSec && s.scriptedSec <= template.shots.maxSec));
  const avg = sb.scriptedTotal / shots.length;
  assert.ok(Math.abs(avg - template.shots.targetSec) < 0.3, 'average cut ' + avg + ' s ≈ reference ~1.8 s');
  assert.equal(shots[0].framing, '미디엄 — 사람이 카메라를 보며 반응');
  assert.equal(sb.beats[2].shots[1].framing, '클로즈업 — 제품이 놓이는 순간');
  assert.equal(sb.beats[3].shots[1].framing, 'POV — 사용하는 시점');
  assert.deepEqual(sb.removedSymbols, []);
  // Emoji are removed from burned subtitles and TTS (and reported).
  const emoji = storyboardOf().job;
  const sc = JSON.parse(emoji.script['장면(JSON)']);
  sc[5].narration += ' ☂️';
  const sbE = buildStoryboard(Object.assign({}, emoji, { script: Object.assign({}, emoji.script, { '장면(JSON)': JSON.stringify(sc) }) }), template);
  assert.deepEqual(sbE.removedSymbols, ['☂']);
  assert.ok(!sbE.beats[5].ttsText.includes('☂'));
});

test('scripts without a storyboard are refused before any cost', () => {
  const { jobFile, secret } = issueJob();
  const q = JSON.parse(jobFile.payload);
  const scenes = JSON.parse(q.script['장면(JSON)']).map(({ beat, narration, ...rest }) => rest);
  q.script['장면(JSON)'] = JSON.stringify(scenes);
  q.approvedHash = require('../renderer/lib/script-core').scriptFingerprint(q.script);
  const payload = JSON.stringify(q);
  const job = verifyJob({ payload, signature: sign(payload, secret) }, { secret });
  assert.throws(() => buildStoryboard(job, template), StoryboardError);
});

test('pre-flight QC: structure, keyword mapping, cut pacing, single-line captions inside the Instagram safe area', () => {
  const { sb, job } = storyboardOf();
  const ok = preflight(sb, template, job);
  assert.equal(ok.ok, true, JSON.stringify(ok.checks.filter((c) => !c.ok)));
  const geo = geometry(template);
  assert.deepEqual(geo.safe, { left: 65, right: 1015, top: 230, bottom: 1536 });
  assert.equal(geo.centerY, 1075, 'captions centred at 56% like the reference');
  assert.equal(ok.checks.filter((c) => /safeArea/.test(c.id)).length, 6);
  assert.match(ok.checks.find((c) => c.id === 'subtitle.S1.lines').detail, /비 오는 날, \/ 현관에 젖은 \/ 우산이 굴러다녀요/);
  assert.equal(ok.checks.find((c) => c.id === 'shots.pacing').ok, true);
  assert.equal(ok.checks.find((c) => c.id === 'subtitle.symbols'), undefined, 'no emoji in the reference script');

  const wrongKeyword = storyboardOf({ keyword: '다른키워드' });
  wrongKeyword.sb.beats[5].subtitle = '제품 정보는 댓글에';
  assert.equal(preflight(wrongKeyword.sb, template, wrongKeyword.job).checks.find((c) => c.id === 'cta.keyword').ok, false);

  const longWord = storyboardOf();
  longWord.sb.beats[1].subtitle = '가나다라마바사아자차카타파하가나다라마바사';
  const r = preflight(longWord.sb, template, longWord.job);
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.id === 'subtitle.S2.lines').ok, false, 'a caption that cannot fit one line fails');

  const shortShot = storyboardOf();
  shortShot.sb.beats[0].shots[0].scriptedSec = 0.6;
  assert.equal(preflight(shortShot.sb, template, shortShot.job).checks.find((c) => c.id === 'shots.length').ok, false);

  const slow = storyboardOf();
  slow.sb.beats.forEach((b) => (b.shots = [b.shots[0]]));
  assert.equal(preflight(slow.sb, template, slow.job).checks.find((c) => c.id === 'shots.pacing').ok, false, 'slideshow-like pacing is flagged');

  const withCta = JSON.parse(JSON.stringify(template));
  withCta.persistentCta.enabled = true;
  const c = preflight(sb, withCta, job).checks.find((x) => x.id === 'persistentCta');
  assert.equal(c.ok, true, c.detail);
  assert.match(c.detail, /댓글에 '우산' 남겨주세요/);
});

test('ASSETS_REQUIRED: no footage → one Flow clip per scene requested with the approved prompts, zero TTS calls', async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const provider = spyProvider();
  await assert.rejects(
    render({ jobFile, secret, template, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: path.join(dir, 'clips'), ffmpeg: FF, font: 'NanumGothic', analyze: okAnalysis }),
    (e) => e instanceof AssetsRequiredError && e.code === 'ASSETS_REQUIRED' && e.report.required.length === 6 && e.report.required.reduce((n, r) => n + r.cuts, 0) === 14
  );
  const reel = path.join(dir, 'clips', 'PRD-001-R01');
  const shotlist = fs.readFileSync(path.join(reel, 'SHOTLIST.md'), 'utf8');
  assert.match(shotlist, /Google Flow 클립 6개\*\* \(각 8초, 세로 9:16\)만 만들면 됩니다/);
  assert.match(shotlist, /\| S3\.mp4 \| SOLUTION · 제품 등장 \| 자석이라 철제 현관문에 붙이면 돼요 \|.*\| 3컷 \(/);
  assert.match(shotlist, /마켓\(쿠팡 등\) 상세페이지 영상은 사용 금지/);
  const flow = fs.readFileSync(path.join(reel, 'FLOW_PROMPTS.md'), 'utf8');
  assert.equal((flow.match(/^## S\d/gm) || []).length, 6);
  for (const k of ['PRODUCT (identical in every scene)', '190×55×50mm', 'CAMERA:', 'LIGHTING & ENVIRONMENT:', 'DURATION: 8 seconds', 'PRODUCT INTERACTION:', 'CONSISTENCY:']) assert.ok(flow.includes(k), k);
  const tmpl = JSON.parse(fs.readFileSync(path.join(reel, 'assets.template.json'), 'utf8'));
  assert.deepEqual(Object.keys(tmpl.scenes), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.equal(provider.calls.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false, 'nothing rendered, no slides substituted');
  // Writing the same shot list again does not touch the files (safe for repeated batch runs).
  const before = fs.statSync(path.join(reel, 'SHOTLIST.md')).mtimeMs;
  await assert.rejects(render({ jobFile, secret, template, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: path.join(dir, 'clips'), ffmpeg: FF, font: 'NanumGothic', analyze: okAnalysis }), AssetsRequiredError);
  assert.equal(fs.statSync(path.join(reel, 'SHOTLIST.md')).mtimeMs, before);
});

test('asset provenance: marketplace video rejected, licensed needs rights, product scenes must show the product, per-cut overrides allowed', async () => {
  const { sb } = storyboardOf();
  const dir = tmp();
  const reel = path.join(dir, 'PRD-001-R01');
  fs.mkdirSync(reel, { recursive: true });
  for (const f of ['S1', 'S2', 'S3', 'S4', 'S3-2']) fs.writeFileSync(path.join(reel, f + '.mp4'), 'x');
  fs.writeFileSync(path.join(reel, 'assets.json'), JSON.stringify({
    reelId: 'PRD-001-R01',
    scenes: { S1: { file: 'S1.mp4', source: 'flow-generated' }, S2: { file: 'S2.mp4', source: 'marketplace' }, S3: { file: 'S3.mp4', source: 'licensed' }, S4: { file: 'S4.mp4', source: 'flow-generated', showsProduct: false } },
    shots: { 'S3-2': { file: 'S3-2.mp4', source: 'own-footage' } },
  }));
  const { loadAssetManifest } = require('../renderer/lib/assets');
  const v = await validateAssets(loadAssetManifest(dir, 'PRD-001-R01'), sb, template, FF, okAnalysis);
  const msg = v.problems.join('\n');
  assert.equal(v.ok, false);
  assert.doesNotMatch(msg, /S1 /, 'AI-generated scene clips are allowed');
  assert.match(msg, /S2 \[EMPATHY\] source "marketplace"/);
  assert.match(msg, /S3 \[SOLUTION\] licensed 영상은 rights/);
  assert.match(msg, /S4 \[DEMO\] 이 장면은 제품이 보여야 합니다/);
  assert.match(msg, /S5 \[DEMO\] 클립이 없습니다: S5\.mp4/);
  assert.equal(v.shots['S3-2'].source, 'own-footage', 'per-cut override used');
  assert.equal(v.shots['S3-1'].file, path.join(reel, 'S3.mp4'));
});

test('asset analysis rejects solid-colour, still-image, low-res and too-short clips', async () => {
  const { sb } = storyboardOf();
  const dir = tmp();
  const reel = path.join(dir, 'PRD-001-R01');
  fs.mkdirSync(reel, { recursive: true });
  for (const f of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) fs.writeFileSync(path.join(reel, f + '.mp4'), 'x');
  const fake = { S1: { flatRatio: 0.9, motion: 0 }, S2: { flatRatio: 0, motion: 0.01 }, S3: { width: 480, height: 854 }, S4: { duration: 3 } };
  const analyze = async (_ff, file) => Object.assign({ width: 1080, height: 1920, duration: 8, frames: 40, flatRatio: 0, motion: 3 }, fake[path.basename(file, '.mp4')] || {});
  const { loadAssetManifest } = require('../renderer/lib/assets');
  const v = await validateAssets(loadAssetManifest(dir, 'PRD-001-R01'), sb, template, FF, analyze);
  const msg = v.problems.join('\n');
  assert.match(msg, /S1 .*단색\(솔리드 컬러\) 화면/);
  assert.match(msg, /S2 .*정지 이미지/);
  assert.match(msg, /S3 .*해상도가 낮습니다/);
  assert.match(msg, /S4 .*길이가 부족합니다 \(사용 가능 3\.0초, 필요 5\.5초\)/);
  assert.doesNotMatch(msg, /S5/);
  assert.ok(v.autoManifest, 'no assets.json → provenance will be recorded automatically');
  assert.equal(v.autoManifest.scenes.S5.source, 'flow-generated');
});

test('Flow clip plan: every scene fits its 8 s clip; a scene whose voice would outgrow one clip gets S3b — before any TTS', () => {
  const { sb, job } = storyboardOf();
  planClips(sb, template);
  assert.equal(sb.clipSec, 8);
  assert.deepEqual(sceneRequirements(sb, template).map((r) => r.file), ['S1.mp4', 'S2.mp4', 'S3.mp4', 'S4.mp4', 'S5.mp4', 'S6.mp4']);
  const cov = preflight(sb, template, job).checks.find((c) => c.id === 'flow.coverage');
  assert.equal(cov.ok, true, cov.detail);
  // A 9-second voice for scene 3 (e.g. known from the cache) cannot fit one 8 s clip (7.5 s usable).
  const { sb: long } = storyboardOf();
  planClips(long, template, [null, null, 9, null, null, null]);
  const reqs = sceneRequirements(long, template);
  assert.deepEqual(reqs.map((r) => r.id), ['S1', 'S2', 'S3', 'S3b', 'S4', 'S5', 'S6']);
  const s3 = reqs.filter((r) => r.sceneNo === 3);
  assert.ok(s3.every((r) => r.coversSec <= 7.5 && r.minClipSec <= 8 && r.cuts.length >= 1), JSON.stringify(s3));
  assert.deepEqual(s3.flatMap((r) => r.cuts).sort(), long.beats[2].shots.map((s) => s.id).sort(), 'every cut belongs to exactly one clip');
  assert.equal(preflight(long, template, job).checks.find((c) => c.id === 'flow.coverage').ok, true);
  const dir = tmp();
  const files = writeAssetsRequired(dir, job, long, template, { reqs, problems: [] });
  const flow = fs.readFileSync(files.flowPrompts, 'utf8');
  assert.match(flow, /## S3b/);
  assert.match(flow, /PART 2 of 2: continue the same action/);
  assert.match(fs.readFileSync(files.shotlist, 'utf8'), /S3\.mp4 \+ S3b\.mp4/);
  // A very short scene with a long voice still gets one cut per clip.
  const { sb: tiny } = storyboardOf();
  planClips(tiny, template, [20, null, null, null, null, null]);
  assert.equal(tiny.beats[0].clips.length, 3);
  assert.ok(tiny.beats[0].clips.every((c) => c.cutIds.length >= 1));
});

test('Flow coverage after TTS: a voice longer than predicted stops at ASSETS_REQUIRED for S3b; the rerun pays no TTS', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const clips = path.join(dir, 'clips');
  const reel = path.join(clips, 'PRD-001-R01');
  fs.mkdirSync(reel, { recursive: true });
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) fs.writeFileSync(path.join(reel, id + '.mp4'), 'x');
  const provider = spyProvider();
  const slowVoice = Object.assign({}, provider, {
    async synthesize(req) {
      provider.calls.push(req.text);
      return silentWav(req.text.startsWith('자석이라 철제') ? 9 : 1.5);
    },
  });
  const opts = { jobFile, secret, template, tts: service(slowVoice, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: clips, ffmpeg: FF, font: 'NanumGothic', analyze: async () => ({ width: 1080, height: 1920, duration: 8, frames: 30, flatRatio: 0, motion: 3 }) };
  await assert.rejects(render(opts), (e) => e instanceof AssetsRequiredError && /Flow 클립을 더 나눠야/.test(e.report.summary) && e.report.required.some((r) => r.file === 'S3b.mp4'));
  assert.equal(provider.calls.length, 6);
  assert.match(fs.readFileSync(path.join(reel, 'FLOW_PROMPTS.md'), 'utf8'), /## S3b/);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false, 'nothing rendered');
  // Rerun: the cached voice length is used up front → same answer, no TTS request.
  await assert.rejects(render(opts), (e) => e instanceof AssetsRequiredError && e.report.required.some((r) => r.file === 'S3b.mp4'));
  assert.equal(provider.calls.length, 6);
});

test('timeline: beats stretch only for the voice, hard cuts split evenly, short captions follow the voice, no disclosure in the video', () => {
  const { sb } = storyboardOf();
  const voice = [2.0, 2.2, 1.9, 1.8, 1.7, 7.0].map((d) => ({ file: 'x.wav', duration: d }));
  const tl = buildTimeline(sb, voice, template);
  assert.deepEqual(tl.beats.slice(0, 5).map((b) => b.duration), [3, 4, 5, 5, 4]);
  assert.ok(Math.abs(tl.beats[5].duration - (0.15 + 7 + 0.35)) < 1e-9, 'CTA stretched for a long line');
  assert.equal(tl.shots.length, 14);
  assert.deepEqual(tl.beats[2].shots.map((s) => +s.duration.toFixed(3)), [1.667, 1.667, 1.667]);
  assert.deepEqual(tl.beats[0].subtitle.captions.map((c) => c.text), ['비 오는 날,', '현관에 젖은', '우산이 굴러다녀요']);
  tl.beats.forEach((b) => {
    const caps = b.subtitle.captions;
    assert.ok(caps[0].start >= b.start && caps[caps.length - 1].end <= b.end + 1e-9);
    for (let i = 1; i < caps.length; i++) assert.ok(Math.abs(caps[i].start - caps[i - 1].end) < 1e-9, 'captions are back to back');
  });
  assert.deepEqual(tl.disclosure, { full: [], tag: [] }, 'default: disclosure only in the Instagram caption');

  const inVideo = JSON.parse(JSON.stringify(template));
  inVideo.disclosure.inVideo = true;
  inVideo.disclosure.persistentTag.enabled = true;
  const tl2 = buildTimeline(sb, voice, inVideo);
  assert.deepEqual(tl2.disclosure.full.map((i) => [i.start, +i.end.toFixed(2)]), [[0, 2.5], [21, +tl2.total.toFixed(2)]]);
  assert.deepEqual(tl2.disclosure.tag, [{ start: 2.5, end: 21 }]);
});

test('ASS matches the reference: regular-weight white single-line captions at 56%, small keyword CTA line at 74.5% for the whole video', () => {
  const { sb, job } = storyboardOf();
  const tl = buildTimeline(sb, sb.beats.map(() => ({ file: 'x.wav', duration: 1.5 })), template);
  const ass = buildAss(tl, template, { font: 'NanumGothic', disclosureText: job.script['광고 표기'], keyword: '우산' });
  const sub = ass.split('\n').find((l) => l.startsWith('Style: Sub,')).split(',');
  assert.equal(sub[1], 'NanumSquareRound', 'rounded Korean sans like the reference');
  assert.equal(sub[2], '48', '≈47 px measured in the reference');
  assert.equal(sub[3], '&H00FFFFFF', 'white');
  assert.equal(sub[5], '&H00000000', 'dark edge');
  assert.equal(sub[7], '0', 'regular weight, not bold');
  assert.equal(sub[16], '2', 'thin edge');
  assert.equal(sub[17], '1', 'soft shadow');
  const subs = ass.split('\n').filter((l) => /^Dialogue: .*,Sub,/.test(l));
  assert.equal(subs.length, tl.beats.reduce((n, b) => n + b.subtitle.captions.length, 0), 'one Dialogue per single-line caption');
  assert.ok(subs.length >= 5, '5 lines → at least 5 captions');
  assert.ok(subs.every((l) => l.includes('{\\pos(540,1075)}') && !l.includes('\\N')));
  assert.doesNotMatch(ass, /While|English/, 'Korean only');
  const cta = ass.split('\n').filter((l) => /^Dialogue: .*,Cta,/.test(l));
  assert.equal(cta.length, 1, 'persistent CTA on by default');
  assert.match(cta[0], /^Dialogue: 2,0:00:00\.00,.*\{\\pos\(540,1430\)\}댓글에 '우산' 남겨주세요$/);
  assert.equal(ass.split('\n').find((l) => l.startsWith('Style: Cta,')).split(',')[2], '38', 'small');
  assert.ok(1430 + 38 < geometry(template).safe.bottom, 'inside the lower safe area');
  assert.equal(ass.split('\n').filter((l) => /^Dialogue: .*,(Disclosure|Tag),/.test(l)).length, 0, 'disclosure stays in the caption');
  assert.doesNotMatch(ass, /쿠팡 파트너스/);
  assert.doesNotMatch(ass, /Headline|Placeholder|Keyword|Watermark|\\fad|\\move/);
  // The keyword follows each reel/product.
  assert.match(buildAss(tl, template, { font: 'X', disclosureText: '', keyword: '타일' }), /댓글에 '타일' 남겨주세요/);
  assert.equal(esc('a{b}\\c\nd'), 'a｛b｝＼c\\Nd');
});

test('compose refuses a shot without footage (no synthetic fallback exists)', async () => {
  const ffm = require('../renderer/lib/ffmpeg');
  const { sb } = storyboardOf();
  const tl = buildTimeline(sb, sb.beats.map(() => ({ file: 'x.wav', duration: 1 })), template);
  await assert.rejects(ffm.composeVideo(FF, tl, {}, { assFile: 'a.ass', narrationFile: 'n.wav', outFile: 'o.mp4', cwd: tmp() }), /영상 소스가 없는 컷: S1-1/);
});

test('real clip analysis: moving footage passes, solid colour and a still image are caught', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const dir = tmp();
  for (const kind of ['moving', 'flat', 'still']) makeClip(path.join(dir, kind + '.mp4'), { kind, sec: 3 });
  const moving = await analyzeClip(FF, path.join(dir, 'moving.mp4'), 0, 2);
  const flat = await analyzeClip(FF, path.join(dir, 'flat.mp4'), 0, 2);
  const still = await analyzeClip(FF, path.join(dir, 'still.mp4'), 0, 2);
  assert.ok(moving.flatRatio <= template.assets.maxFlatRatio && moving.motion >= template.assets.minMotion, JSON.stringify(moving));
  assert.ok(flat.flatRatio > template.assets.maxFlatRatio, JSON.stringify(flat));
  assert.ok(still.motion < template.assets.minMotion && still.flatRatio <= template.assets.maxFlatRatio, JSON.stringify(still));
});

test('full render from one Flow clip per scene: auto provenance, spread cuts, 1080x1920, QC passes, reuse and template change cost no TTS', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const clips = path.join(dir, 'clips');
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) makeClip(path.join(clips, 'PRD-001-R01', id + '.mp4'), { sec: 8 });
  const provider = spyProvider();
  const opts = { jobFile, secret, template, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: clips, ffmpeg: FF, font: 'NanumGothic', preset: 'ultrafast', crf: 34 };
  const m = await render(opts);
  assert.equal(m.qc.postRender.ok, true, JSON.stringify(m.qc.postRender.checks.filter((c) => !c.ok)));
  const v = m.output.streams.find((s) => s.codec_type === 'video');
  assert.equal(`${v.width}x${v.height}`, '1080x1920');
  assert.ok(m.output.duration >= 23.5 && m.output.duration <= 27, String(m.output.duration));
  assert.equal(Object.keys(m.footage).length, 14, '14 cuts from 6 clips');
  assert.deepEqual(['S3-1', 'S3-2', 'S3-3'].map((id) => m.footage[id].file), ['S3.mp4', 'S3.mp4', 'S3.mp4']);
  const ins = ['S3-1', 'S3-2', 'S3-3'].map((id) => m.footage[id].in);
  assert.ok(ins[0] < ins[1] && ins[1] < ins[2], 'cuts spread through the clip: ' + ins);
  assert.equal(m.qc.postRender.checks.find((c) => c.id === 'visuals.noRepeatedFootage').ok, true);
  assert.equal(m.aiGeneratedFootage, true);
  assert.match(m.reviewNote, /실제 제품과 같은지 확인/);
  const auto = JSON.parse(fs.readFileSync(path.join(clips, 'PRD-001-R01', 'assets.json'), 'utf8'));
  assert.equal(auto.scenes.S2.source, 'flow-generated', 'provenance recorded next to the clips');
  for (const id of ['visuals.noPlaceholders', 'visuals.everyShotHasAsset', 'output.resolution', 'output.fps']) {
    assert.equal(m.qc.postRender.checks.find((c) => c.id === id).ok, true, id);
  }
  assert.equal(provider.calls.length, 6, 'one TTS line per scene');
  const again = await render(opts);
  assert.equal(again.reused, true);
  assert.equal(provider.calls.length, 6);
  const noCta = JSON.parse(JSON.stringify(template));
  noCta.persistentCta.enabled = false;
  const changed = await render(Object.assign({}, opts, { template: noCta }));
  assert.equal(changed.reused, undefined);
  assert.notEqual(changed.output.path, m.output.path);
  assert.equal(provider.calls.length, 6, 'template change: new render, no new TTS spend');
});

test('missing subtitle font stops the render before TTS (FONT_MISSING), unless fallback is allowed', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const { FontMissingError, findFont } = require('../renderer/lib/fonts');
  assert.equal(findFont('NanumSquareRound').found, true);
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const clips = path.join(dir, 'clips');
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) makeClip(path.join(clips, 'PRD-001-R01', id + '.mp4'), { sec: 8 });
  const noFont = JSON.parse(JSON.stringify(template));
  noFont.subtitle.font = 'NotInstalledRoundFont';
  const provider = spyProvider();
  const opts = { jobFile, secret, template: noFont, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: clips, ffmpeg: FF, font: 'NanumGothic', preset: 'ultrafast', crf: 36 };
  await assert.rejects(render(opts), (e) => e instanceof FontMissingError && e.code === 'FONT_MISSING');
  assert.equal(provider.calls.length, 0);
  const ok = await render(Object.assign({}, opts, { allowFontFallback: true }));
  assert.equal(ok.qc.postRender.ok, true);
});

test('pending: renders every job whose clips are ready, leaves the rest at ASSETS_REQUIRED, never renders twice', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const { processPending } = require('../renderer/lib/pending');
  const a = issueJob();
  const dir = tmp();
  const jobs = path.join(dir, 'jobs');
  fs.mkdirSync(jobs);
  fs.writeFileSync(path.join(jobs, 'PRD-001-R01_v1.render-job.json'), JSON.stringify(a.jobFile));
  fs.writeFileSync(path.join(jobs, 'BROKEN.render-job.json'), JSON.stringify({ payload: '{}', signature: 'ab' }));
  const clips = path.join(dir, 'clips');
  const provider = spyProvider();
  const make = (jobFile) => ({ jobFile, secret: a.secret, template, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: clips, ffmpeg: FF, font: 'NanumGothic', preset: 'ultrafast', crf: 36 });
  const run = () => processPending({ cfg: { jobsDir: jobs }, args: {}, makeOptions: make, log: () => {} });
  let r = await run();
  assert.deepEqual(r.map((x) => [x.job, x.status]), [['BROKEN', 'GateError'], ['PRD-001-R01_v1', 'ASSETS_REQUIRED']]);
  assert.equal(provider.calls.length, 0, 'no footage → no TTS');
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) makeClip(path.join(clips, 'PRD-001-R01', id + '.mp4'), { sec: 8 });
  r = await run();
  assert.equal(r[1].status, 'RENDERED');
  r = await run();
  assert.equal(r[1].status, 'DONE (재사용)');
  assert.equal(provider.calls.length, 6, 'TTS paid once across all runs');
});

test('static or flat footage stops the render before TTS', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const { jobFile, secret } = issueJob();
  const dir = tmp();
  const clips = path.join(dir, 'clips');
  const ids = ['S1-1', 'S1-2', 'S2-1', 'S2-2', 'S3-1', 'S3-2', 'S3-3', 'S4-1', 'S4-2', 'S4-3', 'S5-1', 'S5-2', 'S6-1', 'S6-2'];
  writeFootage(clips, 'PRD-001-R01', ids);
  makeClip(path.join(clips, 'PRD-001-R01', 'S4-2.mp4'), { kind: 'flat' });
  const provider = spyProvider();
  await assert.rejects(
    render({ jobFile, secret, template, tts: service(provider, dir), storage: createLocalStorage({ outputDir: path.join(dir, 'out') }), clipsDir: clips, ffmpeg: FF, font: 'NanumGothic' }),
    (e) => e instanceof AssetsRequiredError && /S4-2 .*단색/.test(fs.readFileSync(e.report.shotlist, 'utf8'))
  );
  assert.equal(provider.calls.length, 0);
});
