// Final check of the rendered video against the approved script and storyboard, done by Gemini from sampled
// frames (one per scene) plus the operator's verified product images. Gemini reports what it SEES; this code
// turns the answers into a verdict. The check is advisory: it never approves a video and never fails a render —
// the operator's video approval (checkpoint ③) stays manual. It runs only after a render that passed QC.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffm = require('./ffmpeg');

const YES_NO = ['yes', 'partly', 'no'];
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          matches_storyboard: { type: 'STRING', enum: YES_NO },
          subtitle_matches: { type: 'STRING', enum: ['yes', 'no', 'unreadable'] },
          product_visible: { type: 'STRING', enum: ['yes', 'no'] },
          product_matches_reference: { type: 'STRING', enum: ['yes', 'unclear', 'no', 'not_shown', 'no_reference'] },
          ai_label_visible: { type: 'STRING', enum: ['yes', 'no', 'not_needed'] },
          issues: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['scene_no', 'matches_storyboard', 'subtitle_matches', 'product_visible', 'product_matches_reference', 'ai_label_visible', 'issues'],
      },
    },
    summary: { type: 'STRING' },
  },
  required: ['scenes', 'summary'],
};

/** Middle of each scene (where its subtitle is on screen), clamped inside the video. */
function frameTimes(timeline) {
  return timeline.beats.map((b) => ({ scene: b.sceneNo, t: +Math.min(timeline.total - 0.1, b.voice.start + b.voice.duration * 0.5).toFixed(2) }));
}

function buildPrompt({ job, storyboard, timeline, plan, refCount, template }) {
  const productBeats = template.assets.realProductBeats;
  const lines = [
    '당신은 인스타그램 릴스의 최종 영상 검수자입니다. 아래는 승인된 대본/스토리보드와, 완성된 영상에서 장면마다 뽑은 프레임 1장입니다.',
    '프레임에서 실제로 보이는 것만 판단하세요. 추측하거나 좋게 봐주지 마세요. 명령어·코드는 쓰지 마세요.',
    '',
    '## 제품 이미지',
    refCount
      ? `- 앞의 이미지 ${refCount}장은 운영자가 실제 제품이라고 검증한 사진입니다. 프레임 속 제품의 모양·색·비율·구성(조각 수)·부착 위치가 이 사진과 같은지 판단하세요.`
      : '- 검증된 제품 이미지가 없습니다. product_matches_reference는 제품이 보이면 "no_reference", 안 보이면 "not_shown"으로 답하세요.',
  ];
  if (plan && plan.productVisual) {
    lines.push('- 제품 외형 기준: ' + plan.productVisual.summary);
    plan.productVisual.mustMatch.forEach((m) => lines.push('  · 반드시 같아야 함: ' + m));
    plan.productVisual.mustNotShow.forEach((m) => lines.push('  · 보이면 안 됨: ' + m));
  }
  lines.push('', '## 승인된 스토리보드와 프레임');
  storyboard.beats.forEach((b) => {
    lines.push(`- 장면 ${b.sceneNo} [${b.beat}] 자막/내레이션: "${b.subtitle}"\n  연출: ${b.visual}\n  제품이 보여야 하는 장면: ${productBeats.includes(b.beat) ? '예' : '아니오'}\n  AI 시뮬레이션 표시가 필요한 장면: ${b.aiVisualization ? '예' : '아니오'}`);
    if (plan) {
      const sc = (plan.scenes || []).find((x) => x.scene_no === b.sceneNo);
      (sc ? sc.verify_in_clip : []).forEach((v) => lines.push('  확인할 것: ' + v));
    }
  });
  lines.push(
    '',
    '## 답변 방식',
    '- matches_storyboard: 프레임이 그 장면의 연출과 같은 내용이면 yes, 일부만이면 partly, 아니면 no.',
    '- subtitle_matches: 화면 자막이 위 자막/내레이션과 같으면 yes, 다르면 no, 읽을 수 없으면 unreadable.',
    '- product_visible: 프레임에 제품이 보이는가.',
    '- product_matches_reference: yes / unclear / no / not_shown / no_reference.',
    '- ai_label_visible: AI 시뮬레이션 표시가 필요한 장면이면 화면에 표시가 보이는지(yes/no), 필요 없으면 not_needed.',
    '- issues: 문제가 있으면 한국어로 구체적으로 (없으면 []). summary는 한 문장.',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  return lines.join('\n');
}

/** Code decides the verdict from what Gemini saw. fail > review > pass; no reference images can never pass. */
function evaluate(answer, { storyboard, template, refCount }) {
  const productBeats = template.assets.realProductBeats;
  const problems = [];
  const scenes = Array.isArray(answer && answer.scenes) ? answer.scenes : [];
  let level = 0; // 0 pass, 1 review, 2 fail
  const bump = (n, scene, msg) => {
    level = Math.max(level, n);
    problems.push({ scene, level: n === 2 ? 'fail' : 'review', message: msg });
  };
  const rows = storyboard.beats.map((b) => {
    const s = scenes.find((x) => Number(x.scene_no) === b.sceneNo);
    if (!s) {
      bump(1, b.sceneNo, '이 장면에 대한 점검 결과가 없습니다.');
      return { scene: b.sceneNo, result: 'review' };
    }
    if (s.matches_storyboard === 'no') bump(2, b.sceneNo, '화면이 승인된 스토리보드의 장면과 다릅니다.');
    else if (s.matches_storyboard === 'partly') bump(1, b.sceneNo, '화면이 스토리보드와 일부만 맞습니다.');
    if (s.subtitle_matches === 'no') bump(1, b.sceneNo, '화면 자막이 승인된 대본과 다릅니다.');
    if (productBeats.includes(b.beat) && s.product_visible === 'no') bump(2, b.sceneNo, '제품이 보여야 하는 장면에 제품이 보이지 않습니다.');
    if (s.product_matches_reference === 'no') bump(2, b.sceneNo, '제품 모양·색·구성이 검증된 제품 이미지와 다릅니다.');
    else if (s.product_matches_reference === 'unclear') bump(1, b.sceneNo, '제품이 검증된 이미지와 같은지 확실하지 않습니다.');
    else if (s.product_matches_reference === 'no_reference' || (!refCount && s.product_visible === 'yes')) bump(1, b.sceneNo, '비교할 검증된 제품 이미지가 없어 제품 일치를 확인할 수 없습니다.');
    if (b.aiVisualization && s.ai_label_visible === 'no') bump(2, b.sceneNo, 'AI 시뮬레이션 표시가 보이지 않습니다.');
    (s.issues || []).forEach((m) => problems.push({ scene: b.sceneNo, level: 'note', message: String(m) }));
    const mine = problems.filter((p) => p.scene === b.sceneNo && p.level !== 'note');
    return { scene: b.sceneNo, result: mine.some((p) => p.level === 'fail') ? 'fail' : mine.length ? 'review' : 'pass' };
  });
  return {
    verdict: ['pass', 'review', 'fail'][level],
    scenes: rows,
    problems: dedupe(problems),
    summary: String((answer && answer.summary) || ''),
  };
}
function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => !seen.has(p.scene + p.level + p.message) && seen.add(p.scene + p.level + p.message));
}

/**
 * Builds the checker used by render(): ({ job, storyboard, timeline, videoFile, template }) → review.
 * deps: { gemini: { generateJson }, ffmpeg: { ffmpeg, ffprobe }, loadReferenceImages: async job => images, log, extractFrames }
 */
function createFinalChecker(deps) {
  const extract = deps.extractFrames || extractFrames;
  return async function check(ctx) {
    const plan = ctx.job.productionPlan || null;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-check-'));
    try {
      const refs = deps.loadReferenceImages ? await deps.loadReferenceImages(ctx.job) : [];
      const times = frameTimes(ctx.timeline);
      const frames = await extract(deps.ffmpeg, ctx.videoFile, times, dir);
      const images = refs.map((r, i) => ({ mimeType: r.mimeType, data: r.data, label: `[검증된 제품 이미지 ${i + 1}: ${r.name}]` }))
        .concat(frames.map((f) => ({ mimeType: 'image/jpeg', data: f.data, label: `[완성 영상 프레임 — 장면 ${f.scene}, ${f.t}초]` })));
      const prompt = buildPrompt({ job: ctx.job, storyboard: ctx.storyboard, timeline: ctx.timeline, plan, refCount: refs.length, template: ctx.template });
      const answer = await deps.gemini.generateJson({ prompt, images, schema: SCHEMA });
      const review = evaluate(answer, { storyboard: ctx.storyboard, template: ctx.template, refCount: refs.length });
      return Object.assign(review, { model: deps.gemini.model, referenceImages: refs.length, frames: frames.map((f) => ({ scene: f.scene, t: f.t })), advisory: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function extractFrames(ffmpegCfg, videoFile, times, dir) {
  const out = [];
  for (const { scene, t } of times) {
    const file = path.join(dir, `f${scene}.jpg`);
    await ffm.run(ffmpegCfg.ffmpeg, ['-hide_banner', '-v', 'error', '-ss', String(t), '-i', videoFile, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', '-y', file]);
    out.push({ scene, t, data: fs.readFileSync(file).toString('base64') });
  }
  return out;
}

module.exports = { createFinalChecker, evaluate, buildPrompt, frameTimes, SCHEMA };
