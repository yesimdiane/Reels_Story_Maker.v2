// Automated quality control. Pre-flight checks run before any paid call; post-render checks
// verify the delivered file. A failed error-level check stops the job.
'use strict';
const { splitCaptions, captionMaxWidth, textWidth, geometry } = require('./layout');

class QcError extends Error {
  constructor(report, stage) {
    super('QC 실패 (' + stage + '): ' + report.checks.filter((c) => !c.ok && c.level === 'error').map((c) => c.id + ' — ' + c.detail).join(' / '));
    this.name = 'QcError';
    this.code = 'QC_FAILED';
    this.report = report;
  }
}

function report(checks) {
  return { ok: checks.every((c) => c.ok || c.level !== 'error'), checks };
}
const check = (id, ok, detail, level = 'error') => ({ id, ok: !!ok, level, detail });

/** Before TTS: story structure, keyword mapping, cut pacing, caption layout and safe area, disclosure. */
function preflight(storyboard, template, job) {
  const geo = geometry(template);
  const st = template.subtitle;
  const H = template.canvas.height;
  const maxW = captionMaxWidth(template);
  const beats = storyboard.beats;
  const checks = [];
  // New scripts: HOOK → EMPATHY → SOLUTION → DEMO → CTA; older ones: HOOK → (PROBLEM) → DEMO → BENEFIT → CTA.
  checks.push(check('story.structure', beats[0].beat === 'HOOK' && beats[beats.length - 1].beat === 'CTA' && beats.some((b) => b.beat === 'DEMO') && beats.some((b) => b.beat === 'BENEFIT' || b.beat === 'SOLUTION'),
    beats.map((b) => b.beat).join(' → ')));
  const cta = beats[beats.length - 1];
  checks.push(check('cta.keyword', storyboard.keyword && cta.subtitle.includes(storyboard.keyword),
    `CTA 자막 "${cta.subtitle}"에 이 릴스의 ManyChat 키워드 "${storyboard.keyword}" 포함`));

  const shots = beats.flatMap((b) => b.shots);
  const sh = template.shots;
  const bad = shots.filter((s) => !s.voiceSized).filter((s) => s.scriptedSec < sh.minSec - 1e-9 || s.scriptedSec > sh.maxSec + 1e-9);
  checks.push(check('shots.length', bad.length === 0, bad.length ? `${sh.minSec}~${sh.maxSec}초 밖의 컷: ` + bad.map((s) => `${s.id} ${s.scriptedSec.toFixed(1)}s`).join(', ') : `${shots.length}컷, 모두 ${sh.minSec}~${sh.maxSec}초`));
  const avg = storyboard.scriptedTotal / shots.length;
  checks.push(check('shots.pacing', !sh.targetSec || avg <= sh.targetSec * 1.35, `평균 컷 ${avg.toFixed(2)}초 (기준 약 ${sh.targetSec}초)`, 'warn'));
  if (storyboard.clipSec) {
    // Every Google Flow clip must be able to cover its share of the scene (see storyboard.planClips).
    const usable = storyboard.clipSec - ((template.flowClip && template.flowClip.marginSec) || 0);
    const clips = beats.flatMap((b) => (b.clips || []).map((c) => Object.assign({ beat: b }, c)));
    const over = clips.filter((c) => c.coversSec > usable + 1e-6 || !c.cutIds.length);
    const split = beats.filter((b) => b.clips && b.clips.length > 1);
    checks.push(check('flow.coverage', clips.length > 0 && over.length === 0,
      over.length ? '클립 길이를 넘는 장면: ' + over.map((c) => `${c.id} ${c.coversSec.toFixed(1)}s > ${usable}s`).join(', ')
        : `Flow 클립 ${clips.length}개 (각 ${storyboard.clipSec}초, 사용 ≤ ${usable}초)` + (split.length ? ' · 나눈 장면: ' + split.map((b) => b.clips.map((c) => c.id).join('+')).join(', ') : '')));
  }
  const tr = template.durationSec;
  checks.push(check('duration.scripted', storyboard.scriptedTotal >= tr.min && storyboard.scriptedTotal <= tr.max, `${storyboard.scriptedTotal}초 (허용 ${tr.min}~${tr.max}초)`));

  for (const b of beats) {
    const caps = splitCaptions(b.subtitle, st.size, maxW);
    const widest = Math.max(...caps.map((c) => textWidth(c, st.size)));
    const box = geo.captionBox(st.maxLines);
    checks.push(check(`subtitle.S${b.sceneNo}.lines`, widest <= maxW + 0.5, `"${b.subtitle}" → 한 줄 자막 ${caps.length}개 (${caps.join(' / ')}), 최대 폭 ${Math.round(widest)}/${Math.round(maxW)}px`));
    checks.push(check(`subtitle.S${b.sceneNo}.safeArea`, box.top >= geo.safe.top && box.bottom <= geo.safe.bottom && geo.centerX - widest / 2 >= geo.safe.left,
      `중심 y ${geo.centerY}px (${Math.round(st.centerY * 100)}%), 상자 ${Math.round(box.top)}~${Math.round(box.bottom)} ⊂ 안전영역 ${geo.safe.top}~${geo.safe.bottom}`));
  }
  const pc = template.persistentCta;
  if (pc && pc.enabled) {
    const text = String(pc.text).split('{키워드}').join(storyboard.keyword);
    const y = Math.round(H * pc.centerY);
    const half = (pc.size * st.lineHeight) / 2;
    checks.push(check('persistentCta', text.includes(storyboard.keyword) && y - half >= geo.safe.top && y + half <= geo.safe.bottom && textWidth(text, pc.size) <= maxW * 1.2,
      `"${text}" y ${y}px (${Math.round(pc.centerY * 100)}%)`));
  }
  const d = String(job.script['광고 표기'] || '');
  const where = template.disclosure.inVideo ? '영상 시작·끝 + 인스타그램 캡션' : '인스타그램 캡션 첫 줄 (영상에는 표시하지 않음)';
  checks.push(check('disclosure.text', d.includes('쿠팡 파트너스') && d.includes('수수료'), where + ': ' + (d || '(없음)')));
  if (storyboard.removedSymbols.length) {
    checks.push(check('subtitle.symbols', false, '자막·음성에서 제외한 이모지: ' + storyboard.removedSymbols.join(' ') + ' (글꼴·TTS 미지원). 인스타그램 캡션에는 그대로 쓸 수 있습니다.', 'warn'));
  }
  return report(checks);
}

/** After rendering: format, duration, and that every shot came from a validated asset. */
/** Shots that must carry the AI label: AI-generated footage or a scene marked as an AI visualization. */
function aiShots(timeline, shotAssets) {
  return timeline.beats.flatMap((b) => b.shots.filter((sh) => b.aiVisualization || (shotAssets[sh.id] && shotAssets[sh.id].source === 'flow-generated')));
}

function postRender(probe, timeline, template, inputs, shotAssets, aiIntervals = []) {
  const v = probe.streams.find((s) => s.codec_type === 'video') || {};
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const { width, height, fps } = template.canvas;
  const tol = template.shots.maxSec + template.shots.stretchToleranceSec;
  const long = timeline.shots.filter((s) => s.duration > tol);
  const tr = template.durationSec;
  return report([
    check('output.resolution', v.width === width && v.height === height, `${v.width}x${v.height}`),
    check('output.video', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p', `${v.codec_name} ${v.pix_fmt}`),
    check('output.fps', v.r_frame_rate === `${fps}/1`, String(v.r_frame_rate)),
    check('output.audio', a && a.codec_name === 'aac', a ? a.codec_name : '오디오 없음'),
    check('output.duration', Math.abs(probe.duration - timeline.total) < 0.15, `${probe.duration.toFixed(2)}s / 계획 ${timeline.total.toFixed(2)}s`),
    check('output.durationRange', timeline.total >= tr.min && timeline.total <= tr.max, `${timeline.total.toFixed(1)}초 (허용 ${tr.min}~${tr.max}초)`),
    check('visuals.everyShotHasAsset', inputs.length === timeline.shots.length && timeline.shots.every((s) => shotAssets[s.id] && inputs.some((i) => i.shot === s.id)), `${inputs.length}/${timeline.shots.length}컷`),
    check('visuals.noPlaceholders', inputs.every((i) => i.type === 'asset'), inputs.map((i) => i.type).join(',')),
    check('visuals.noFlatOrStill', Object.values(shotAssets).every((s) => s.analysis.flatRatio <= template.assets.maxFlatRatio && s.analysis.motion >= template.assets.minMotion), '모든 소스 클립 단색·정지 아님'),
    check('visuals.noRepeatedFootage', noRepeats(timeline, shotAssets), '같은 클립에서 자른 컷끼리 겹치지 않음', 'warn'),
    aiLabelCheck(timeline, template, shotAssets, aiIntervals),
    check('shots.finalLength', long.length === 0, long.length ? '음성 때문에 길어진 컷: ' + long.map((s) => `${s.id} ${s.duration.toFixed(1)}s`).join(', ') : '모든 컷 ' + tol + '초 이하', 'warn'),
  ]);
}

/** Cuts taken from the same clip should not show the same footage twice. */
function noRepeats(timeline, shotAssets) {
  const byFile = {};
  timeline.shots.forEach((sh) => {
    const a = shotAssets[sh.id];
    (byFile[a.file] = byFile[a.file] || []).push([a.in, a.in + sh.duration]);
  });
  return Object.values(byFile).every((iv) => {
    iv.sort((x, y) => x[0] - y[0]);
    return iv.every((v, i) => i === 0 || v[0] >= iv[i - 1][1] - 0.35);
  });
}

/** Every AI shot is covered by the on-screen AI label, so AI scenes are never shown as real footage. */
function aiLabelCheck(timeline, template, shotAssets, aiIntervals) {
  const need = aiShots(timeline, shotAssets);
  const covered = (sh) => aiIntervals.some((iv) => iv.start <= sh.start + 1e-6 && iv.end >= sh.end - 1e-6);
  const missing = need.filter((sh) => !covered(sh));
  const label = template.aiLabel || { enabled: false };
  if (!need.length) return check('ai.label', true, 'AI 장면 없음 (모두 실제 촬영·허가 영상)');
  return check('ai.label', label.enabled && missing.length === 0,
    label.enabled ? `"${label.text}" 표시: AI 컷 ${need.length - missing.length}/${need.length}` + (missing.length ? ' — 표시 없음: ' + missing.map((s) => s.id).join(', ') : '')
      : 'AI 장면이 있는데 템플릿 aiLabel이 꺼져 있습니다');
}

/**
 * After TTS, before rendering: scene timing against the real Korean voice. Each beat is at least as long
 * as its line (lead-in + voice + tail); the total must stay within the template range (20–40 s).
 * Errors stop the render before FFmpeg (the voice is cached, so fixing the script and re-running costs
 * nothing for unchanged lines).
 */
function ttsTiming(storyboard, timeline, template) {
  const tr = template.durationSec;
  const warnSec = (template.ttsTiming && template.ttsTiming.stretchWarnSec) || 1.0;
  const checks = [check('timing.total', timeline.total >= tr.min - 1e-6 && timeline.total <= tr.max + 1e-6,
    `실제 음성 기준 ${timeline.total.toFixed(1)}초 (허용 ${tr.min}~${tr.max}초, 대본 ${storyboard.scriptedTotal}초)`)];
  timeline.beats.forEach((b, i) => {
    const plan = storyboard.beats[i];
    const extra = b.duration - plan.scriptedSec;
    checks.push(check(`timing.S${b.sceneNo}`, extra <= warnSec + 1e-6,
      `음성 ${b.voice.duration.toFixed(2)}초 → 장면 ${b.duration.toFixed(2)}초 (대본 ${plan.scriptedSec}초${extra > 1e-6 ? ', +' + extra.toFixed(2) + '초 늘어남' : ''})`, 'warn'));
  });
  return report(checks);
}

module.exports = { preflight, postRender, ttsTiming, QcError, aiShots };
