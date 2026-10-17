// Gemini-orchestrated production, renderer side: the production plan is applied within hard limits (never
// changing the approved script), Drive clip import, per-line TTS rates, and Gemini's advisory final check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');
const { api } = require('./helpers/media');
const { verifyJob } = require('../renderer/lib/job');
const { buildStoryboard, planClips } = require('../renderer/lib/storyboard');
const { applyProductionPlan } = require('../renderer/lib/production-plan');
const { buildTimeline } = require('../renderer/lib/plan');
const { buildAss, emphasize } = require('../renderer/lib/ass');
const { loadTemplate } = require('../renderer/lib/template');
const { createTtsService } = require('../renderer/lib/tts');
const { createSilentTts } = require('../renderer/lib/tts/silent');
const { createLocalStorage } = require('../renderer/lib/storage/local');
const { silentWav } = require('../renderer/lib/wav');
const { render } = require('../renderer/lib/render');
const { createDriveClient, driveAuth, fetchClips, loadReferenceImages, CLIP_RE } = require('../renderer/lib/drive');
const { createGeminiClient, GeminiError } = require('../renderer/lib/gemini');
const { createFinalChecker, evaluate, buildPrompt, SCHEMA } = require('../renderer/lib/final-check');

const plain = (v) => JSON.parse(JSON.stringify(v));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-orch-'));
const template = loadTemplate('lifestyle-v1');
const FF = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
let hasFfmpeg = false;
try {
  hasFfmpeg = /\sass\s/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }));
} catch {
  hasFfmpeg = false;
}

// Real server flow: approve → Gemini production plan (verified product image) → Drive folder → job.
function issueJob({ withPlan = true, uploads = [], clipBytes } = {}) {
  let env;
  env = createEnv({
    gemini: (n, body) => (body.generationConfig.responseSchema.properties.product_visual
      ? plain(env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE'))
      : plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'))),
  });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/secret-link' }));
  const img = env.drive.addImage('product-front.png');
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push('https://drive.google.com/file/d/' + img + '/view');
  env.gs('setupSheets()');
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  call('apiGenerateScripts', 'PRD-001');
  assert.equal(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 }).ok, true);
  const state = () => call('apiGetReel', 'PRD-001-R01').detail.summary;
  if (withPlan) {
    const s = state();
    assert.equal(call('apiCreateProductionPlan', 'PRD-001-R01', { expectedStatus: s.status, expectedScriptVersion: s.scriptVersion }).ok, true);
    call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: s.status, expectedScriptVersion: s.scriptVersion });
    const folder = env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01');
    uploads.forEach((n) => env.drive.addFile(folder.id, n, 'clip-' + n));
    if (uploads.length) call('apiPrepareAssets', 'PRD-001-R01', { expectedStatus: s.status, expectedScriptVersion: s.scriptVersion });
    // Every clip must be uploaded and APPROVED in the dashboard before a job file is issued.
    api(env).approveAll({ bytesFor: clipBytes });
  }
  assert.equal(call('apiAction', 'PRD-001-R01', 'START_VIDEO', { expectedStatus: 'SCRIPT_APPROVED', expectedScriptVersion: 1, expectedVideoVersion: 0 }).ok, true);
  const res = call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(res.ok, true, res.error);
  return { env, jobFile: JSON.parse(res.jobFile), secret: env.props.RF_RENDER_SECRET, img };
}

function board(over = {}) {
  const j = issueJob(over);
  const job = verifyJob(j.jobFile, { secret: j.secret });
  return Object.assign(j, { job, sb: buildStoryboard(job, template) });
}

// ------------------------------------------------------------------ the plan is applied within limits

test('production plan is applied: rates, pauses, emphasis and cut framing come from Gemini; the script does not change', () => {
  const { job, sb } = board();
  const baseline = buildStoryboard(job, template);
  const rep = applyProductionPlan(sb, job, template);
  assert.equal(rep.used, true);
  assert.deepEqual(rep.problems, []);
  assert.deepEqual(sb.beats.map((b) => b.rate), [1.05, 1.0, 0.98, 1.0, 0.98, 1.05]);
  assert.deepEqual(sb.beats.map((b) => b.pauseAfterSec), [0.2, 0.3, 0.2, 0.2, 0.2, 0.1]);
  assert.deepEqual(sb.beats.map((b) => b.emphasisWords || []), [['굴러다녀요'], ['모자라잖아요'], ['현관문에'], ['쏙'], ['두 조각'], []]);
  assert.deepEqual(sb.beats.map((b) => b.shots.length), [2, 2, 3, 3, 2, 2]);
  assert.equal(sb.beats[2].shots[1].framing, '클로즈업 — 제품이 놓이는 순간');
  assert.deepEqual(rep.applied, { rates: 6, pauses: 6, emphasis: 5, cuts: 14 });
  // The spoken/subtitle text and timing are exactly the approved script's.
  assert.deepEqual(sb.beats.map((b) => [b.ttsText, b.subtitle, b.scriptedSec]), baseline.beats.map((b) => [b.ttsText, b.subtitle, b.scriptedSec]));
  assert.match(sb.beats[5].ttsText, /댓글에 '우산' 남겨 주세요/, '{키워드} resolved to the reel keyword');
});

test('a plan for another approval, or with different spoken text, is ignored entirely', () => {
  const stale = board();
  stale.job.productionPlan.approvedHash = 'h:other';
  assert.match(applyProductionPlan(stale.sb, stale.job, template).ignored, /이 승인된 대본 버전의 것이 아니라서/);
  assert.equal(stale.sb.beats[0].rate, undefined);

  const changed = board();
  changed.job.productionPlan.narration[2].tts_text = '자석이라 어디든 붙여요';
  const rep = applyProductionPlan(changed.sb, changed.job, template);
  assert.equal(rep.used, false);
  assert.match(rep.ignored, /음성 문장이 승인된 대본과 다릅니다 \(장면 3\)/);
  assert.ok(changed.sb.beats.every((b) => b.rate === undefined && b.pauseAfterSec === undefined));

  const none = board({ withPlan: false });
  assert.equal(none.job.productionPlan, null);
  assert.equal(applyProductionPlan(none.sb, none.job, template).used, false);
});

test('out-of-range plan values are skipped one by one (defense in depth), never trusted', () => {
  const { job, sb } = board();
  job.productionPlan.narration[0].speaking_rate = 2;
  job.productionPlan.narration[1].pause_after_sec = 5;
  job.productionPlan.subtitles[3].emphasis_words = ['없는단어'];
  job.productionPlan.edit[3].cuts = [{ framing: 'x' }]; // 5 s in one cut
  job.productionPlan.edit[4].cuts = [{ framing: 'a' }, { framing: ' ' }];
  const rep = applyProductionPlan(sb, job, template);
  assert.equal(rep.used, true);
  assert.equal(sb.beats[0].rate, undefined);
  assert.equal(sb.beats[1].pauseAfterSec, undefined);
  assert.equal(sb.beats[3].emphasisWords, undefined);
  assert.equal(sb.beats[3].shots.length > 1, true, 'default cuts kept');
  assert.equal(sb.beats[4].plannedCuts, undefined);
  assert.equal(rep.problems.length, 5);
  assert.match(rep.problems.join('\n'), /말하기 속도 2는 0\.9~1\.15 밖/);
  assert.match(rep.problems.join('\n'), /컷 1개는 컷당 5\.0초/);
});

test('planned pause lengthens a scene only when the template default would be shorter; clip planning uses it', () => {
  const { job, sb } = board();
  applyProductionPlan(sb, job, template);
  const narr = sb.beats.map((b) => ({ file: 'x', duration: 1 }));
  const base = buildTimeline(buildStoryboard(job, template), narr, template);
  const planned = buildTimeline(sb, narr, template);
  assert.equal(planned.total, base.total, 'scripted lengths dominate short voices');
  const longVoice = sb.beats.map(() => ({ file: 'x', duration: 6 }));
  sb.beats[0].pauseAfterSec = 0.6;
  const t = buildTimeline(sb, longVoice, template);
  assert.ok(Math.abs(t.beats[0].duration - (template.narration.leadInSec + 6 + 0.6)) < 1e-9);
  assert.deepEqual(t.beats.map((b) => b.emphasisWords).slice(0, 2), [['굴러다녀요'], ['모자라잖아요']]);
  planClips(sb, template, longVoice.map((v) => v.duration));
  assert.ok(Math.abs(sb.beats[0].predictedSec - t.beats[0].duration) < 1e-9);
});

// ------------------------------------------------------------------ per-line TTS rate

test('TTS: each line is requested at its planned rate; a different rate is a separate cache entry; defaults unchanged', async () => {
  const dir = tmp();
  const seen = [];
  const inner = createSilentTts();
  const provider = { name: 'spy', paid: true, synthesize: async (a) => { seen.push([a.text, a.speakingRate]); return inner.synthesize(a); } };
  const svc = createTtsService({ provider, voice: 'ko-KR-Wavenet-A', speakingRate: 1.05, cacheDir: path.join(dir, 'c'), ledgerFile: path.join(dir, 'l.json') });
  const texts = ['첫 줄이에요', '둘째 줄이에요', '셋째 줄이에요'];
  const est = svc.estimate(texts, [0.95, undefined, 1.1]);
  assert.equal(est.cachedSegments, 0);
  const out = await svc.synthesizeAll(texts, [0.95, undefined, 1.1]);
  assert.deepEqual(seen, [['첫 줄이에요', 0.95], ['둘째 줄이에요', 1.05], ['셋째 줄이에요', 1.1]]);
  assert.deepEqual(out.map((o) => o.rate), [0.95, 1.05, 1.1]);
  // Same text at the same rate: cached. Same text at another rate: a new recording.
  seen.length = 0;
  await svc.synthesizeAll(texts, [0.95, undefined, 1.1]);
  assert.equal(seen.length, 0);
  assert.equal(svc.estimate(texts, [1.0, undefined, 1.1]).cachedSegments, 2);
  assert.equal(svc.cachedDuration(texts[0], 0.95) > 0, true);
  assert.equal(svc.cachedDuration(texts[0], 1.0), null);
  // Without rates (older jobs) the cache key is the configured rate, exactly as before.
  assert.equal(svc.cachePath(texts[1]), svc.cachePath(texts[1], 1.05));
});

// ------------------------------------------------------------------ subtitle emphasis (off by default)

test('subtitle emphasis: plain white captions by default (reference style); highlight only when the template turns it on', () => {
  const { job, sb } = board();
  applyProductionPlan(sb, job, template);
  const narr = sb.beats.map(() => ({ file: 'x', duration: 2 }));
  const tl = buildTimeline(sb, narr, template);
  const plainAss = buildAss(tl, template, { font: 'NanumGothic', disclosureText: 'd', keyword: '우산' });
  assert.ok(!plainAss.includes('{\\c&H00E6FF&}'));
  const on = plain(template);
  on.subtitle.emphasis.enabled = true;
  const ass = buildAss(tl, on, { font: 'NanumGothic', disclosureText: 'd', keyword: '우산' });
  assert.match(ass, /\{\\c&H00E6FF&\}굴러다녀요\{\\r\}/);
  assert.equal(emphasize('긴 우산도 쏙 꽂아요', ['쏙', '없음'], '&H00E6FF&'), '긴 우산도 {\\c&H00E6FF&}쏙{\\r} 꽂아요');
  assert.equal(emphasize('{x}\\N', ['x'], 'C'), '｛{\\cC}x{\\r}｝＼N', 'text is escaped: no injected override tags');
});

// ------------------------------------------------------------------ Google Drive clip import

function fakeDrive(files, contents = {}) {
  const calls = [];
  return {
    calls,
    async listFolder(id) { calls.push(['list', id]); return files; },
    async download(id) { calls.push(['get', id]); return Buffer.from(contents[id] || 'video-' + id); },
  };
}

test('fetch-clips (jobs without a production plan): only the clips the job needs are downloaded from its Drive folder; newest upload wins; existing files are kept', async () => {
  const { job: planned } = board({ uploads: ['S1.mp4'] });
  const job = Object.assign({}, planned, { productionPlan: null, clipManifest: null });
  assert.ok(job.drive.folderId);
  const dir = tmp();
  const drive = fakeDrive([
    { id: 'a1', name: 'S1.mp4', size: '8', modifiedTime: '2026-10-10T01:00:00Z' },
    { id: 'a2', name: 'S1.mp4', size: '8', modifiedTime: '2026-10-10T05:00:00Z' },
    { id: 'b1', name: 's2.MOV', size: '8', modifiedTime: '2026-10-10T01:00:00Z' },
    { id: 'c1', name: 'S3b.mp4', size: '7', modifiedTime: '2026-10-10T01:00:00Z' }, // not needed (no S3b clip)
    { id: 'd1', name: 'notes.txt', size: '3', modifiedTime: '2026-10-10T01:00:00Z' },
    { id: 'e1', name: '../../evil.mp4', size: '3', modifiedTime: '2026-10-10T01:00:00Z' },
  ]);
  const r = await fetchClips({ drive, job, clipsDir: dir });
  assert.deepEqual(r.downloaded.sort(), ['S1.mp4', 'S2.mov']);
  assert.deepEqual(r.missing, ['S3.mp4', 'S4.mp4', 'S5.mp4', 'S6.mp4']);
  assert.deepEqual(r.ignored.sort(), ['../../evil.mp4', 'S3b.mp4', 'notes.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'PRD-001-R01', 'S1.mp4'), 'utf8'), 'video-a2', 'newest upload');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'PRD-001-R01')).sort(), ['S1.mp4', 'S2.mov']);
  drive.calls.length = 0;
  const again = await fetchClips({ drive, job, clipsDir: dir });
  assert.deepEqual(again.downloaded, []);
  assert.deepEqual(again.kept.sort(), ['S1.mp4', 'S2.mov']);
  assert.ok(drive.calls.every((c) => c[0] === 'list'));
  await assert.rejects(fetchClips({ drive, job: Object.assign({}, job, { drive: null }), clipsDir: dir }), /Drive 폴더 정보가 없습니다/);
  assert.ok(CLIP_RE.test('S2-1.mp4') && !CLIP_RE.test('x/S1.mp4') && !CLIP_RE.test('S1.exe'));
});

test('Drive client: query by folder, pagination, auth header; clear errors; token sources', async () => {
  const urls = [];
  const fetchImpl = async (url, opts) => {
    urls.push([url, opts.headers.Authorization]);
    if (url.includes('alt=media')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('abc').buffer };
    if (url.includes('pageToken')) return { ok: true, json: async () => ({ files: [{ name: 'S2.mp4' }] }) };
    return { ok: true, json: async () => ({ files: [{ name: 'S1.mp4' }], nextPageToken: 'T2' }) };
  };
  const client = createDriveClient({ authHeaders: async () => ({ Authorization: 'Bearer tok' }), fetchImpl });
  const files = await client.listFolder('FOLDERID1234567890');
  assert.deepEqual(files.map((f) => f.name), ['S1.mp4', 'S2.mp4']);
  assert.match(decodeURIComponent(urls[0][0]), /'FOLDERID1234567890' in parents and trashed = false/);
  assert.equal(urls[0][1], 'Bearer tok');
  assert.equal((await client.download('fid')).toString(), 'abc');
  await assert.rejects(client.listFolder("x' or '1'='1"), /폴더 ID가 올바르지 않습니다/);
  const denied = createDriveClient({ authHeaders: async () => ({}), fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'no' } }) }) });
  await assert.rejects(denied.listFolder('FOLDERID1234567890'), /HTTP 403.*Drive 읽기 권한/);
  assert.deepEqual(await driveAuth({ driveToken: 'envtok' })(), { Authorization: 'Bearer envtok' });
  await assert.rejects(driveAuth({}, { exec: () => { throw new Error('x'); } })(), /enable-gdrive-access/);
  assert.deepEqual(await driveAuth({}, { exec: () => 'gtok\n' })(), { Authorization: 'Bearer gtok' });
});

test('reference images for the final check: local refs/<productId>/ first, else the Drive IDs in the signed job', async () => {
  const { job } = board();
  const dir = tmp();
  const drive = fakeDrive([], { [job.referenceImages[0].fileId]: Buffer.from('89504e47', 'hex') });
  let imgs = await loadReferenceImages({ job, refsDir: dir, drive });
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].mimeType, 'image/png');
  assert.equal(imgs[0].name, 'product-front.png');
  fs.mkdirSync(path.join(dir, 'PRD-001'));
  fs.writeFileSync(path.join(dir, 'PRD-001', 'b.jpg'), 'jpg');
  fs.writeFileSync(path.join(dir, 'PRD-001', 'a.png'), 'png');
  fs.writeFileSync(path.join(dir, 'PRD-001', 'notes.txt'), 'x');
  drive.calls.length = 0;
  imgs = await loadReferenceImages({ job, refsDir: dir, drive });
  assert.deepEqual(imgs.map((i) => i.name), ['a.png', 'b.jpg']);
  assert.equal(drive.calls.length, 0, 'local images need no Drive access');
});

// ------------------------------------------------------------------ Gemini final check

const goodScene = (n) => ({ scene_no: n, matches_storyboard: 'yes', subtitle_matches: 'yes', product_visible: 'yes', product_matches_reference: 'yes', ai_label_visible: 'yes', issues: [] });

test('final check verdict is decided by code from what Gemini saw (fail > review > pass); no reference image can never pass', () => {
  const { sb } = board();
  const ctx = { storyboard: sb, template, refCount: 1 };
  const all = (mut) => ({ scenes: sb.beats.map((b) => { const s = goodScene(b.sceneNo); mut && mut(s, b); return s; }), summary: '요약' });
  assert.equal(evaluate(all(), ctx).verdict, 'pass');
  assert.equal(evaluate(all((s, b) => { if (b.sceneNo === 3) s.product_matches_reference = 'no'; }), ctx).verdict, 'fail');
  assert.equal(evaluate(all((s, b) => { if (b.sceneNo === 4) s.product_matches_reference = 'unclear'; }), ctx).verdict, 'review');
  assert.equal(evaluate(all((s, b) => { if (b.sceneNo === 1) s.matches_storyboard = 'no'; }), ctx).verdict, 'fail');
  assert.equal(evaluate(all((s, b) => { if (b.sceneNo === 2) s.matches_storyboard = 'partly'; }), ctx).verdict, 'review');
  assert.equal(evaluate(all((s, b) => { if (b.sceneNo === 5) s.subtitle_matches = 'no'; }), ctx).verdict, 'review');
  // The product must be on screen in product scenes (SOLUTION/DEMO/BENEFIT/CTA), not in the problem scenes.
  assert.equal(evaluate(all((s, b) => { if (b.beat === 'DEMO') s.product_visible = 'no'; }), ctx).verdict, 'fail');
  assert.equal(evaluate(all((s, b) => { if (b.beat === 'EMPATHY') s.product_visible = 'no'; }), ctx).verdict, 'pass');
  // AI visualization scenes need the on-screen label.
  sb.beats[1].aiVisualization = true;
  assert.equal(evaluate(all((s, b) => { if (b.sceneNo === 2) s.ai_label_visible = 'no'; }), ctx).verdict, 'fail');
  sb.beats[1].aiVisualization = false;
  // Missing scenes / garbage → review; no reference images → at best review.
  assert.equal(evaluate({ scenes: [goodScene(1)], summary: '' }, ctx).verdict, 'review');
  assert.equal(evaluate(null, ctx).verdict, 'review');
  const noRef = evaluate(all((s) => { s.product_matches_reference = 'no_reference'; }), { storyboard: sb, template, refCount: 0 });
  assert.equal(noRef.verdict, 'review');
  assert.match(noRef.problems[0].message, /검증된 제품 이미지가 없어/);
  const failed = evaluate(all((s, b) => { if (b.sceneNo === 3) { s.product_matches_reference = 'no'; s.issues = ['색이 밝은 회색']; } }), ctx);
  assert.deepEqual(failed.scenes.map((s) => s.result), ['pass', 'pass', 'fail', 'pass', 'pass', 'pass']);
  assert.ok(failed.problems.some((p) => p.level === 'note' && p.message === '색이 밝은 회색'));
});

test('final checker sends the verified product images first, one frame per scene, and the approved storyboard — and never changes anything', async () => {
  const { job, sb } = board();
  applyProductionPlan(sb, job, template);
  const narr = sb.beats.map(() => ({ file: 'x', duration: 2.2 }));
  const timeline = buildTimeline(sb, narr, template);
  const sent = [];
  const gemini = { model: 'gemini-test', generateJson: async (req) => { sent.push(req); return { scenes: sb.beats.map((b) => goodScene(b.sceneNo)), summary: '대본과 일치' }; } };
  const frames = [];
  const check = createFinalChecker({
    gemini, ffmpeg: FF,
    loadReferenceImages: async () => [{ name: 'product-front.png', mimeType: 'image/png', data: 'UkVG' }],
    extractFrames: async (ff, file, times) => { frames.push(times); return times.map((t) => ({ scene: t.scene, t: t.t, data: 'RlJB' })); },
  });
  const review = await check({ job, storyboard: sb, timeline, videoFile: '/nonexistent.mp4', template });
  assert.equal(review.verdict, 'pass');
  assert.equal(review.advisory, true);
  assert.equal(review.referenceImages, 1);
  assert.equal(frames[0].length, 6);
  assert.ok(frames[0].every((f, i) => f.t > timeline.beats[i].start && f.t < timeline.beats[i].end), 'each frame is inside its own scene');
  const req = sent[0];
  assert.equal(req.images.length, 7);
  assert.match(req.images[0].label, /검증된 제품 이미지 1: product-front\.png/);
  assert.match(req.images[1].label, /완성 영상 프레임 — 장면 1/);
  assert.match(req.prompt, /자막\/내레이션: "비 오는 날, 현관에 젖은 우산이 굴러다녀요"/);
  assert.match(req.prompt, /제품 외형 기준: A slim two-piece/);
  assert.match(req.prompt, /반드시 같아야 함: two separate pieces/);
  assert.match(req.prompt, /확인할 것: exactly two separate pieces are shown/);
  assert.equal(req.schema, SCHEMA);
  assert.ok(!/link\.coupang|test-key|GEMINI/.test(req.prompt + JSON.stringify(req.images)));
});

test('Gemini client: key in a header (not the URL), JSON out, clear errors', async () => {
  const calls = [];
  const ok = createGeminiClient({ apiKey: 'K', model: 'm', fetchImpl: async (url, o) => { calls.push([url, o]); return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) }; } });
  assert.deepEqual(await ok.generateJson({ prompt: 'p', images: [{ mimeType: 'image/png', data: 'x', label: 'L' }], schema: {} }), { a: 1 });
  assert.ok(!calls[0][0].includes('K') && calls[0][1].headers['x-goog-api-key'] === 'K');
  const body = JSON.parse(calls[0][1].body);
  assert.deepEqual(body.contents[0].parts.map((p) => Object.keys(p)[0]), ['text', 'text', 'inlineData']);
  assert.throws(() => createGeminiClient({ apiKey: '', model: 'm' }), GeminiError);
  const bad = createGeminiClient({ apiKey: 'K', model: 'm', fetchImpl: async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'quota' } }) }) });
  await assert.rejects(bad.generateJson({ prompt: 'p', schema: {} }), /HTTP 429.*quota/);
  const junk = createGeminiClient({ apiKey: 'K', model: 'm', fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ candidates: [] }) }) });
  await assert.rejects(junk.generateJson({ prompt: 'p', schema: {} }), /읽을 수 없습니다/);
});

// ------------------------------------------------------------------ full render with FFmpeg

function makeClip(file, sec = 8) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Same picture, different container metadata: each clip is a distinct file (identical files are refused as duplicates).
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=720x1280:d=${sec}:r=30`, '-metadata', 'comment=' + path.basename(file), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
}

test('render with a production plan: planned rates reach TTS, cuts follow the plan, Gemini review is recorded and advisory', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  const dir = tmp();
  const clips = path.join(dir, 'clips');
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) makeClip(path.join(clips, 'PRD-001-R01', id + '.mp4'));
  // The very same files are uploaded and approved in the dashboard; the job's manifest carries their checksums.
  const { jobFile, secret } = issueJob({ clipBytes: (key) => fs.readFileSync(path.join(clips, 'PRD-001-R01', key + '.mp4')) });
  const rates = [];
  const inner = createSilentTts();
  const provider = { name: 'spy', paid: false, synthesize: async (a) => { rates.push(a.speakingRate); return inner.synthesize(a); } };
  const reviews = [];
  const finalCheck = async (ctx) => { reviews.push(ctx.videoFile); return { verdict: 'review', advisory: true, summary: '확인 필요', problems: [{ scene: 3, level: 'review', message: '제품이 확실하지 않습니다.' }], scenes: [] }; };
  const opts = {
    jobFile, secret, template,
    tts: createTtsService({ provider, voice: 'local', speakingRate: 1.05, cacheDir: path.join(dir, 'c'), ledgerFile: path.join(dir, 'l.json') }),
    storage: createLocalStorage({ outputDir: path.join(dir, 'out') }),
    clipsDir: clips, ffmpeg: FF, font: 'NanumGothic', preset: 'ultrafast', crf: 36, finalCheck,
  };
  const m = await render(opts);
  assert.deepEqual(rates, [1.05, 1.0, 0.98, 1.0, 0.98, 1.05]);
  assert.equal(m.productionPlan.used, true);
  assert.deepEqual(m.productionPlan.applied, { rates: 6, pauses: 6, emphasis: 5, cuts: 14 });
  assert.equal(Object.keys(m.footage).length, 14);
  assert.equal(m.qc.postRender.ok, true, JSON.stringify(m.qc.postRender.checks.filter((c) => !c.ok)));
  assert.equal(reviews.length, 1);
  assert.equal(m.qc.geminiReview.verdict, 'review');
  assert.match(m.reviewNote, /Gemini 영상 점검 결과: 확인 필요 — 장면 3: 제품이 확실하지 않습니다\. \(참고용입니다/);
  assert.deepEqual(m.tts.lines.map((l) => l.rate), rates);
  // Reuse costs nothing and does not call Gemini again.
  assert.equal((await render(opts)).reused, true);
  assert.equal(reviews.length, 1);
  // A failing review call never fails the render.
  const broken = await render(Object.assign({}, opts, { force: true, finalCheck: async () => { throw new Error('quota'); } }));
  assert.equal(broken.qc.geminiReview.verdict, 'error');
  assert.equal(broken.qc.postRender.ok, true);
  // Preview renders (free voice, not publishable) skip the check.
  reviews.length = 0;
  await render(Object.assign({}, opts, { preview: true, force: true }));
  assert.equal(reviews.length, 0);
});
