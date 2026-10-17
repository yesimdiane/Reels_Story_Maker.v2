// Render orchestration, ordered so that nothing billable happens unless the render can succeed:
//   1 approval gate → 2 storyboard → 3 pre-flight QC → 4 footage (ASSETS_REQUIRED) → 5 font + FFmpeg
//   → 6 reuse → 7 TTS (budget-checked, cached) → 8 timeline + TTS timing check → overlay/audio/video
//   → 9 post-render QC.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyJob } = require('./job');
const { buildStoryboard, planClips } = require('./storyboard');
const { applyProductionPlan } = require('./production-plan');
const { checkClipManifest } = require('./clip-manifest');
const { buildTimeline } = require('./plan');
const { buildAss } = require('./ass');
const { loadAssetManifest, validateAssets, writeAssetsRequired, spreadIn, AssetsRequiredError } = require('./assets');
const { findFont, FontMissingError } = require('./fonts');
const qc = require('./qc');
const ffm = require('./ffmpeg');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * opts: { jobFile, secret, template, tts, ttsInfo, storage, clipsDir, preview, dryRun, force,
 *         ffmpeg: { ffmpeg, ffprobe }, font, fontsDir, crf, preset, now, log, analyze }
 */
async function render(opts) {
  const log = opts.log || (() => {});
  const template = opts.template;

  // 1. Approval gate.
  const job = verifyJob(opts.jobFile, { secret: opts.secret, now: opts.now });
  log(`✓ 승인 확인: ${job.reelId} 대본 v${job.scriptVersion} (지문 ${job.approvedHash})`);

  // 2–3. Storyboard, Google Flow clip plan, and pre-flight QC (text, structure, keyword, layout, coverage).
  // The clip plan predicts each scene's length from its narration (cached voice length if any — free —
  // else a slow speaking rate) and splits a scene over extra clips (S3b.mp4) before it can outgrow one.
  const clipSec = (Array.isArray(job.flowPrompts) && job.flowPrompts[0] && job.flowPrompts[0].clipSec) || undefined;
  const cachedVoice = (b) => (opts.tts.cachedDuration ? opts.tts.cachedDuration(b.ttsText, b.rate) : null);
  // Gemini's production plan (rates, pauses, cuts, emphasis) is applied within fixed limits; an invalid or
  // foreign plan is ignored and the template defaults are used.
  let planReport = null;
  const makeStoryboard = () => {
    const sb = buildStoryboard(job, template);
    const rep = applyProductionPlan(sb, job, template);
    planReport = planReport || rep;
    return sb;
  };
  let storyboard = makeStoryboard();
  planReport && planReport.ignored && log('! ' + planReport.ignored);
  (planReport ? planReport.problems : []).forEach((p) => log('! 제작 계획: ' + p));
  if (planReport && planReport.used) log(`✓ 제작 계획(Gemini) 적용: 속도 ${planReport.applied.rates}, 쉼 ${planReport.applied.pauses}, 컷 ${planReport.applied.cuts}, 강조 ${planReport.applied.emphasis}`);
  planClips(storyboard, template, storyboard.beats.map(cachedVoice), clipSec);
  const pre = qc.preflight(storyboard, template, job);
  const rates = () => storyboard.beats.map((b) => b.rate);
  const estimate = opts.tts.estimate(storyboard.beats.map((b) => b.ttsText), rates());

  // 4. Footage. Missing or invalid → ASSETS_REQUIRED with a shot list. Never substitute slides.
  const assetsRequired = (assets, extra) => {
    const files = writeAssetsRequired(opts.clipsDir, job, storyboard, template, assets);
    return new AssetsRequiredError({
      reelId: job.reelId,
      summary: (extra ? extra + ' ' : '') + `장면 클립 ${assets.reqs.length}개 필요 (편집 컷 ${assets.reqs.reduce((n, r) => n + r.cuts.length, 0)}개) — 목록: ${files.shotlist}, 프롬프트: ${files.flowPrompts}`,
      problems: assets.problems,
      shotlist: files.shotlist,
      assetsTemplate: files.template,
      flowPrompts: files.flowPrompts,
      required: assets.reqs.map((r) => ({ id: r.id, beat: r.beat, file: r.file, minClipSec: r.minClipSec, cuts: r.cuts.length, line: r.line, part: r.part, parts: r.parts })),
    });
  };
  let assets = await validateAssets(loadAssetManifest(opts.clipsDir, job.reelId), storyboard, template, opts.ffmpeg, opts.analyze, opts.defaultSource);
  if (opts.dryRun) return { dryRun: true, job, storyboard, preflight: pre, assets, estimate };
  if (!pre.ok) throw new qc.QcError(pre, '사전 점검');
  if (!assets.ok) throw assetsRequired(assets);
  // Media-workspace jobs: every clip used must be an approved file, byte for byte (before any paid step).
  checkClipManifest(job, assets);

  // 5. Subtitle font and FFmpeg capabilities (a wrong font would silently change the brand look).
  const font = template.subtitle.font || opts.font;
  if (!findFont(font, { fontsDir: opts.fontsDir }).found) {
    if (!opts.allowFontFallback) throw new FontMissingError(font);
    log(`! 글꼴 "${font}" 없음 — RF_ALLOW_FONT_FALLBACK=1 이므로 대체 글꼴로 진행합니다.`);
  }
  const ff = await ffm.checkFfmpeg(opts.ffmpeg);
  if (assets.autoManifest) {
    // Provenance is recorded next to the clips (source = the operator's declared default).
    fs.writeFileSync(path.join(assets.dir, 'assets.json'), JSON.stringify(assets.autoManifest, null, 2));
    log('= assets.json 자동 작성 (source: ' + (opts.defaultSource || template.assets.defaultSource) + ')');
  }

  // 6. Reuse: same approved script + same footage + same variant → nothing to pay or render.
  const fileHash = new Map();
  const hashOf = (f) => (fileHash.has(f) ? fileHash.get(f) : (fileHash.set(f, sha256File(f)), fileHash.get(f)));
  const footageKey = crypto.createHash('sha256').update(JSON.stringify(Object.entries(assets.shots).map(([id, a]) => [id, a.in, a.cutIndex, a.cutCount, hashOf(a.file)]))).digest('hex').slice(0, 8);
  const variant = opts.preview ? 'preview' : (opts.variant || (estimate.provider !== 'google' ? estimate.provider : 'final'));
  // Any template change (caption style, CTA option, pacing) must produce a new render, not reuse.
  const templateKey = crypto.createHash('sha256').update(JSON.stringify(template)).digest('hex').slice(0, 6);
  const key = `${job.reelId}/v${job.scriptVersion}-${job.approvedHash.slice(3, 11)}-${footageKey}-${template.name}.${templateKey}-${variant}`;
  const prev = !opts.force && opts.storage.exists(key + '/manifest.json') ? JSON.parse(opts.storage.read(key + '/manifest.json')) : null;
  if (prev && prev.qc && prev.qc.postRender && prev.qc.postRender.ok) {
    log('= 이미 렌더된 결과를 재사용합니다 (비용 0): ' + prev.output.path);
    return Object.assign(prev, { reused: true });
  }

  // 7. TTS, one line per beat (budget-checked inside; cached lines cost nothing).
  log(`… 음성: ${estimate.provider} ${estimate.voice} — 과금 글자 ${estimate.billableChars}, 예상 $${estimate.estimatedUsd.toFixed(4)}`);
  const narration = await opts.tts.synthesizeAll(storyboard.beats.map((b) => b.ttsText), rates());

  // 7b. Re-plan the Flow clips with the real voice lengths. If a scene now needs an extra clip, stop with
  // ASSETS_REQUIRED (the narration is cached, so the next run pays nothing for it).
  const replanned = planClips(makeStoryboard(), template, narration.map((v) => v.duration), clipSec);
  // Only ever add clips here: a plan with spare clips is still valid, and the operator may already have them.
  if (replanned.beats.some((b, i) => b.clips.length > storyboard.beats[i].clips.length)) {
    storyboard = replanned;
    assets = await validateAssets(loadAssetManifest(opts.clipsDir, job.reelId), storyboard, template, opts.ffmpeg, opts.analyze, opts.defaultSource);
    if (assets.ok) checkClipManifest(job, assets);
    if (!assets.ok) throw assetsRequired(assets, '실제 음성이 예상보다 길어 Flow 클립을 더 나눠야 합니다 (음성은 캐시됨 — 다시 실행해도 추가 비용 없음).');
  }

  // 8. Timeline → overlay → audio → video.
  const timeline = buildTimeline(storyboard, narration, template);
  // 8a. Scene timing validated against the actual Korean TTS duration, before any rendering.
  const timing = qc.ttsTiming(storyboard, timeline, template);
  timing.checks.filter((c) => !c.ok).forEach((c) => log(`! ${c.id}: ${c.detail}`));
  if (!timing.ok) throw new qc.QcError(timing, '음성 길이 점검 (렌더링 전)');
  // Every Flow clip must hold all of its cuts without reusing footage.
  for (const b of timeline.beats) {
    const plan = storyboard.beats.find((x) => x.sceneNo === b.sceneNo);
    for (const c of plan.clips) {
      const need = b.shots.filter((sh) => c.cutIds.includes(sh.id)).reduce((n, sh) => n + sh.duration, 0);
      const a = assets.shots[c.cutIds[0]];
      if (a && a.in === null && a.analysis.duration - 0.1 < need - 0.02) {
        throw new AssetsRequiredError({
          reelId: job.reelId,
          summary: `${c.id}.mp4 클립(${a.analysis.duration.toFixed(1)}초)이 이 장면의 음성 구간 ${need.toFixed(1)}초를 덮지 못합니다. 더 긴 클립으로 교체하세요 — 음성은 캐시되어 다시 실행해도 추가 비용이 없습니다.`,
          problems: [],
          required: [{ id: c.id, file: c.id + '.mp4', minClipSec: +(need + 0.2).toFixed(1) }],
        });
      }
    }
  }
  const resolved = {};
  for (const sh of timeline.shots) {
    const a = assets.shots[sh.id];
    resolved[sh.id] = Object.assign({}, a, { in: spreadIn(a, sh.duration) });
  }
  for (const sh of timeline.shots) {
    const a = resolved[sh.id];
    if (a.analysis.duration - a.in < sh.duration - 0.02) {
      throw new AssetsRequiredError({
        reelId: job.reelId,
        summary: `${sh.id} 클립이 음성 길이에 비해 짧습니다 (필요 ${sh.duration.toFixed(1)}초, 사용 가능 ${(a.analysis.duration - a.in).toFixed(1)}초). 더 긴 클립으로 교체 후 다시 실행하세요 — 음성은 캐시되어 추가 비용이 없습니다.`,
        problems: [],
        required: [],
      });
    }
  }
  // AI-generated footage and AI visualization scenes are labelled on screen (brand rule).
  const planBeat = (n) => storyboard.beats.find((x) => x.sceneNo === n) || {};
  timeline.beats.forEach((b) => { b.aiVisualization = !!planBeat(b.sceneNo).aiVisualization; });
  const aiIntervals = qc.aiShots(timeline, resolved).map((sh) => ({ start: sh.start, end: sh.end }));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-render-'));
  fs.writeFileSync(path.join(work, 'subs.ass'), buildAss(timeline, template, { font: opts.font, disclosureText: job.script['광고 표기'], keyword: storyboard.keyword, preview: !!opts.preview, aiIntervals }));
  await ffm.buildNarrationTrack(opts.ffmpeg, timeline, path.join(work, 'narration.wav'), work);
  const tmpOut = path.join(work, 'reel.mp4');
  const inputs = await ffm.composeVideo(opts.ffmpeg, timeline, resolved, {
    assFile: 'subs.ass', fontsDir: opts.fontsDir, narrationFile: 'narration.wav', outFile: tmpOut, cwd: work, crf: opts.crf, preset: opts.preset,
  });

  // 9. Post-render QC.
  const probed = await ffm.probe(opts.ffmpeg.ffprobe, tmpOut);
  const post = qc.postRender(probed, timeline, template, inputs, resolved, aiIntervals);

  // 9b. Gemini checks the finished video against the approved script/storyboard and the verified product
  // images. Advisory only (the operator approves the video); a failure of the check itself never fails a render.
  let review = null;
  if (post.ok && opts.finalCheck && !opts.preview) {
    try {
      review = await opts.finalCheck({ job, storyboard, timeline, videoFile: tmpOut, template });
      log(`${review.verdict === 'pass' ? '✓' : '!'} Gemini 영상 점검: ${review.verdict}${review.summary ? ' — ' + review.summary : ''}`);
      review.problems.filter((p) => p.level !== 'note').forEach((p) => log(`  · 장면 ${p.scene}: ${p.message}`));
    } catch (e) {
      review = { verdict: 'error', advisory: true, error: e.message };
      log('! Gemini 영상 점검을 건너뜁니다: ' + e.message);
    }
  }
  const variantSuffix = opts.preview ? '_PREVIEW' : (variant !== 'final' ? `_${variant}` : '');
  const fileName = `${job.reelId}_script-v${job.scriptVersion}${variantSuffix}${post.ok ? '' : '_QC_FAILED'}.mp4`;
  const stored = await opts.storage.publish(tmpOut, key + '/' + fileName);
  const manifest = {
    reelId: job.reelId,
    productId: job.productId,
    scriptVersion: job.scriptVersion,
    approvedHash: job.approvedHash,
    nextVideoVersion: job.nextVideoVersion,
    template: template.name,
    variant,
    previewWarning: opts.preview ? '미리보기 음성(무료 로컬 음성)입니다. 게시하거나 영상으로 등록하지 마세요.' : '',
    renderedAt: new Date().toISOString(),
    output: { path: stored.path, uri: stored.uri, sha256: sha256File(stored.path), duration: probed.duration, streams: probed.streams },
    qc: { preflight: pre, ttsTiming: timing, postRender: post, geminiReview: review },
    tts: Object.assign({}, estimate, opts.ttsInfo || {}, { lines: narration.map((n) => ({ text: n.text, duration: +n.duration.toFixed(3), cached: n.cached, rate: n.rate })) }),
    productionPlan: planReport ? { used: planReport.used, ignored: planReport.ignored, applied: planReport.applied, problems: planReport.problems } : null,
    footage: Object.fromEntries(Object.entries(resolved).map(([id, a]) => [id, { file: path.basename(a.file), in: +a.in.toFixed(2), source: a.source, aiGenerated: a.source === 'flow-generated', showsProduct: a.showsProduct, rights: a.rights }])),
    aiLabel: { text: template.aiLabel && template.aiLabel.enabled ? template.aiLabel.text : '', shots: qc.aiShots(timeline, resolved).map((s) => s.id) },
    aiGeneratedFootage: Object.values(resolved).some((a) => a.source === 'flow-generated'),
    reviewNote: [
      Object.values(resolved).some((a) => a.source === 'flow-generated')
        ? 'AI(Google Flow) 생성 장면 포함: 영상 검토(③)에서 제품 모양·색·크기가 실제 제품과 같은지 확인하고, 게시할 때 인스타그램 "AI 정보" 라벨을 켜세요.'
        : '',
      review && (review.verdict === 'fail' || review.verdict === 'review')
        ? `Gemini 영상 점검 결과: ${review.verdict === 'fail' ? '문제 있음' : '확인 필요'} — ${review.problems.filter((p) => p.level !== 'note').map((p) => `장면 ${p.scene}: ${p.message}`).join(' / ')} (참고용입니다. 승인은 직접 판단하세요.)`
        : '',
    ].filter(Boolean).join(' '),
    timeline: {
      total: +timeline.total.toFixed(3),
      beats: timeline.beats.map((b) => ({ scene: b.sceneNo, beat: b.beat, start: +b.start.toFixed(2), end: +b.end.toFixed(2), subtitle: b.subtitle.captions.map((c) => c.text), shots: b.shots.map((s) => s.id) })),
      disclosure: timeline.disclosure,
    },
    ffmpeg: ff.version,
  };
  const manifestTmp = path.join(work, 'manifest.json');
  fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2));
  await opts.storage.publish(manifestTmp, key + '/manifest.json');
  fs.rmSync(work, { recursive: true, force: true });
  if (!post.ok) throw new qc.QcError(post, '렌더 결과');
  log('✓ 완료: ' + stored.path);
  return manifest;
}

module.exports = { render };
