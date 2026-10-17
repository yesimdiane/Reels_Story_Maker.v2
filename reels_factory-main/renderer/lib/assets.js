// Scene assets: one clip per scene (Google Flow, 8 s) in clips/<릴스ID>/S<n>.mp4 — or per-cut overrides
// S<n>-<k>.mp4 — plus an optional assets.json with provenance. Clips are analysed (no solid colour,
// no stills, resolution, length). Missing or invalid footage → ASSETS_REQUIRED with a shot list and the
// approved Flow prompts. Runs entirely before any paid API call.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./ffmpeg');

const EXTS = ['.mp4', '.mov', '.m4v'];
const SOURCE_LABELS = {
  'flow-generated': 'Google Flow 생성 (승인 후)',
  'own-footage': '직접 촬영',
  licensed: '사용 허가받은 영상 (서면 허가 등)',
};

class AssetsRequiredError extends Error {
  constructor(report) {
    super('ASSETS_REQUIRED: 승인된 영상 소스가 부족합니다. ' + report.summary);
    this.name = 'AssetsRequiredError';
    this.code = 'ASSETS_REQUIRED';
    this.report = report;
  }
}

/**
 * One requirement per Google Flow clip (normally one per scene; more if a scene outgrows one clip —
 * see storyboard.planClips). Each clip covers its own cuts.
 */
function sceneRequirements(storyboard, template) {
  const clipSec = storyboard.clipSec || (template.flowClip && template.flowClip.clipSec) || 8;
  return storyboard.beats.flatMap((b) =>
    (b.clips || [{ id: `S${b.sceneNo}`, part: 1, parts: 1, cutIds: b.shots.map((s) => s.id), coversSec: b.scriptedSec }]).map((c) => ({
      id: c.id,
      file: c.id + '.mp4',
      sceneNo: b.sceneNo,
      part: c.part,
      parts: c.parts,
      beat: b.beat,
      line: b.subtitle,
      visual: b.visual,
      cuts: c.cutIds,
      framing: b.shots.filter((s) => c.cutIds.includes(s.id)).map((s) => s.framing).filter(Boolean),
      coversSec: +c.coversSec.toFixed(2),
      minClipSec: +Math.min(clipSec, Math.max(template.assets.sceneClipMinSec || 0, c.coversSec + 0.5)).toFixed(1),
      showsProduct: template.assets.realProductBeats.includes(b.beat),
    }))
  );
}

/** Flow prompt for a clip: the approved one from the job, or (extra part) derived from the scene's prompt. */
function promptFor(job, r) {
  const list = Array.isArray(job.flowPrompts) ? job.flowPrompts : [];
  const exact = list.find((p) => p.scene === r.sceneNo && (p.part || 1) === r.part && (p.parts || 1) === r.parts);
  if (exact) return exact.prompt;
  const base = list.find((p) => p.scene === r.sceneNo);
  if (!base) return '';
  return base.prompt.replace(/\nDURATION:[^\n]*/, '') +
    `\nPART ${r.part} of ${r.parts}: ${r.part === 1 ? 'the beginning of this scene.' : 'continue the same action, place and lighting from where part ' + (r.part - 1) + ' ended.'}` +
    `\nDURATION: ${base.clipSec || 8} seconds. The editor uses about ${r.coversSec} s of it as several short cuts.`;
}

function findFile(dir, base) {
  return EXTS.map((e) => path.join(dir, base + e)).find((f) => fs.existsSync(f)) || '';
}

function loadAssetManifest(clipsDir, reelId) {
  const dir = path.join(clipsDir, reelId);
  const file = path.join(dir, 'assets.json');
  if (!fs.existsSync(file)) return { file, dir, data: null };
  try {
    return { file, dir, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { file, dir, error: 'assets.json을 읽을 수 없습니다: ' + e.message };
  }
}

/** Frame statistics over the part of the clip that will be used. */
async function analyzeClip(ffmpegCfg, file, inSec, durSec) {
  const { stdout } = await run(ffmpegCfg.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const st = (j.streams || [])[0];
  if (!st) return { error: '영상 스트림이 없습니다' };
  const { stderr } = await run(ffmpegCfg.ffmpeg, [
    '-hide_banner', '-v', 'info', '-ss', String(inSec), '-t', String(durSec), '-i', file,
    '-vf', 'fps=5,scale=96:-2,signalstats,metadata=mode=print', '-an', '-f', 'null', '-',
  ]);
  const vals = (key) => [...stderr.matchAll(new RegExp('lavfi\\.signalstats\\.' + key + '=([0-9.]+)', 'g'))].map((m) => Number(m[1]));
  const ymin = vals('YMIN');
  const ymax = vals('YMAX');
  const ydif = vals('YDIF');
  const frames = Math.min(ymin.length, ymax.length);
  const flat = ymin.slice(0, frames).filter((v, i) => ymax[i] - v < 16).length;
  const motion = ydif.length > 1 ? ydif.slice(1).reduce((a, b) => a + b, 0) / (ydif.length - 1) : 0;
  return { width: st.width, height: st.height, duration: Number(j.format.duration), frames, flatRatio: frames ? flat / frames : 1, motion };
}

/**
 * Resolves and validates footage. Returns { ok, reqs, shots: { cutId: asset }, problems, autoManifest }.
 * asset = { file, in (null → spread at render time), cutIndex, cutCount, source, showsProduct, rights, analysis }.
 */
async function validateAssets(manifest, storyboard, template, ffmpegCfg, analyze = analyzeClip, defaultSource) {
  const reqs = sceneRequirements(storyboard, template);
  const problems = [];
  const shots = {};
  if (manifest.error) return { ok: false, reqs, shots, problems: [manifest.error] };
  const declared = (manifest.data && (manifest.data.scenes || {})) || {};
  const declaredCuts = (manifest.data && (manifest.data.shots || {})) || {};
  if (manifest.data && manifest.data.reelId && manifest.data.reelId !== storyboard.reelId) {
    problems.push(`assets.json의 reelId(${manifest.data.reelId})가 작업(${storyboard.reelId})과 다릅니다.`);
  }
  const fallbackSource = defaultSource || template.assets.defaultSource;
  const auto = { reelId: storyboard.reelId, scenes: {}, note: 'assets.json이 없어 렌더러가 자동 작성 (source = 기본값 ' + fallbackSource + ')' };
  const analysed = new Map();
  const analyseOnce = async (file, minSec) => {
    if (!analysed.has(file)) analysed.set(file, await analyze(ffmpegCfg, file, 0, minSec));
    return analysed.get(file);
  };
  const check = (p, info, minSec, inSec = 0) => {
    if (info.error) return problems.push(p + info.error);
    if (Math.min(info.width, info.height) < template.assets.minShortSide) problems.push(p + `해상도가 낮습니다 (${info.width}x${info.height}, 짧은 변 ${template.assets.minShortSide}px 이상).`);
    if (info.duration - inSec < minSec - 0.05) problems.push(p + `길이가 부족합니다 (사용 가능 ${(info.duration - inSec).toFixed(1)}초, 필요 ${minSec}초).`);
    if (info.flatRatio > template.assets.maxFlatRatio) problems.push(p + '단색(솔리드 컬러) 화면입니다. 실제 영상 클립이 필요합니다.');
    else if (info.motion < template.assets.minMotion) problems.push(p + '움직임이 없는 정지 이미지입니다. 실제 영상 클립이 필요합니다.');
  };
  const sourceOk = (p, meta) => {
    if (!template.assets.allowedSources.includes(meta.source)) {
      problems.push(p + `source "${meta.source || '없음'}"는 쓸 수 없습니다. 허용: ${template.assets.allowedSources.join(', ')} (마켓·쿠팡 상세페이지 영상 금지)`);
    }
    if (meta.source === 'licensed' && !String(meta.rights || '').trim()) problems.push(p + 'licensed 영상은 rights(허가 근거)를 적어야 합니다.');
  };

  for (const r of reqs) {
    const p = `${r.id} [${r.beat}] `;
    const dMeta = declared[r.id] || {};
    const sceneFile = dMeta.file ? path.resolve(manifest.dir, dMeta.file) : findFile(manifest.dir, r.id);
    for (let k = 0; k < r.cuts.length; k++) {
      const cutId = r.cuts[k];
      const cMeta = declaredCuts[cutId];
      const cutFile = cMeta && cMeta.file ? path.resolve(manifest.dir, cMeta.file) : findFile(manifest.dir, cutId);
      if (cutFile && fs.existsSync(cutFile)) {
        // Per-cut override (e.g. an extra close-up).
        const meta = Object.assign({ source: dMeta.source || fallbackSource, showsProduct: r.showsProduct }, cMeta || {});
        sourceOk(`${cutId} [${r.beat}] `, meta);
        const inSec = Number(meta.in || 0);
        const info = await analyseOnce(cutFile, 1.5);
        check(`${cutId} [${r.beat}] `, info, 1.5, inSec);
        shots[cutId] = { file: cutFile, in: inSec, cutIndex: 0, cutCount: 1, source: meta.source, showsProduct: !!meta.showsProduct, rights: meta.rights || '', analysis: info };
      } else if (sceneFile && fs.existsSync(sceneFile)) {
        const meta = Object.assign({ source: fallbackSource, showsProduct: r.showsProduct }, dMeta);
        if (k === 0) {
          sourceOk(p, meta);
          if (r.showsProduct && meta.showsProduct === false) problems.push(p + '이 장면은 제품이 보여야 합니다 (showsProduct).');
          auto.scenes[r.id] = { file: path.basename(sceneFile), source: meta.source, showsProduct: meta.showsProduct, rights: meta.rights || '' };
        }
        const info = await analyseOnce(sceneFile, r.minClipSec);
        if (k === 0) check(p, info, r.minClipSec);
        shots[cutId] = { file: sceneFile, in: null, cutIndex: k, cutCount: r.cuts.length, source: meta.source, showsProduct: !!meta.showsProduct, rights: meta.rights || '', analysis: info };
      } else if (k === 0) {
        problems.push(p + `클립이 없습니다: ${r.file} (FLOW_PROMPTS.md의 ${r.id} 프롬프트로 생성 → 이 폴더에 업로드)`);
      }
    }
  }
  const ok = problems.length === 0 && Object.keys(shots).length === reqs.reduce((n, r) => n + r.cuts.length, 0);
  return { ok, reqs, shots, problems, autoManifest: manifest.data ? null : auto, dir: manifest.dir };
}

/** In-points for cuts taken from one scene clip: spread evenly so cuts do not repeat footage. */
function spreadIn(asset, cutDuration) {
  if (asset.in !== null && asset.in !== undefined) return asset.in;
  const usable = Math.max(0, asset.analysis.duration - 0.1 - cutDuration);
  if (asset.cutCount <= 1) return Math.min(0.3, usable);
  return (usable * asset.cutIndex) / (asset.cutCount - 1);
}

/** SHOTLIST.md + FLOW_PROMPTS.md + assets.template.json for the operator (written once per change). */
function writeAssetsRequired(clipsDir, job, storyboard, template, validation) {
  const dir = path.join(clipsDir, job.reelId);
  fs.mkdirSync(dir, { recursive: true });
  const reqs = validation.reqs;
  const tmpl = {
    reelId: job.reelId,
    scenes: Object.fromEntries(reqs.map((r) => [r.id, { file: r.file, source: template.assets.defaultSource, showsProduct: r.showsProduct, rights: '' }])),
  };
  const md = [
    `# ${job.reelId} 영상 소스 (ASSETS_REQUIRED)`,
    '',
    `상품: ${job.productName} · 대본 v${job.scriptVersion} (승인됨) · 템플릿 ${template.name}`,
    '',
    `- **Google Flow 클립 ${reqs.length}개** (각 ${storyboard.clipSec || 8}초, 세로 9:16)만 만들면 됩니다 — 보통 장면당 1개. 렌더러가 클립마다 짧은 컷 여러 개를 잘라 편집합니다.` +
      (reqs.some((r) => r.parts > 1) ? ' 내레이션이 길어 한 클립으로 덮을 수 없는 장면은 클립을 나눴습니다 (예: S3.mp4 + S3b.mp4).' : ''),
    '- 프롬프트는 `FLOW_PROMPTS.md` (대시보드 "영상 제작" 탭에도 있음). 같은 제품 사진을 참고 이미지로 쓰면 장면 간 제품이 일정합니다.',
    '- 이 폴더에 아래 파일 이름으로 올리면 Mac 렌더러가 자동으로 편집합니다. assets.json은 없으면 자동 작성됩니다 (source = Flow 생성).',
    '- 마켓(쿠팡 등) 상세페이지 영상은 사용 금지. 직접 찍은 영상은 assets.json에서 source를 own-footage로 바꾸세요.',
    '',
    '| 파일 | 장면 | 자막(내레이션) | 장면 내용 | 컷 | 덮는 길이 | 최소 클립 길이 |',
    '|---|---|---|---|---|---|---|',
    ...reqs.map((r) => `| ${r.file} | ${r.beat}${r.parts > 1 ? ` (${r.part}/${r.parts})` : ''}${r.showsProduct ? ' · 제품 등장' : ''} | ${r.line} | ${r.visual} | ${r.cuts.length}컷 (${r.framing.join(' → ')}) | ${r.coversSec}초 | ${r.minClipSec}초 |`),
    '',
    validation.problems.length ? '## 현재 문제\n\n' + validation.problems.map((p) => '- ' + p).join('\n') : '',
  ].join('\n');
  const flow = [
    `# ${job.reelId} Google Flow 프롬프트 (승인된 대본 v${job.scriptVersion})`,
    '',
    ...reqs.map((r) => `## ${r.id} · ${r.beat}${r.parts > 1 ? ` · part ${r.part}/${r.parts}` : ''} → 파일 이름 ${r.file}\n\n\`\`\`\n${promptFor(job, r)}\n\`\`\`\n`),
  ].join('\n');
  const write = (name, text) => {
    const f = path.join(dir, name);
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text) fs.writeFileSync(f, text);
    return f;
  };
  return {
    dir,
    shotlist: write('SHOTLIST.md', md),
    flowPrompts: write('FLOW_PROMPTS.md', flow),
    template: write('assets.template.json', JSON.stringify(tmpl, null, 2)),
  };
}

module.exports = { promptFor, sceneRequirements, loadAssetManifest, analyzeClip, validateAssets, writeAssetsRequired, spreadIn, AssetsRequiredError, SOURCE_LABELS };
