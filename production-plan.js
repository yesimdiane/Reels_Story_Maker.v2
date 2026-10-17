// Gemini's production plan (validated once in Apps Script, validated AGAIN here before use) applied to the
// storyboard: per-line speaking rate, pause after a line, subtitle emphasis words and the cut structure of a
// scene. Gemini decides; this module only executes within the limits below. The plan can never change the
// approved script: it is ignored if it does not belong to this approval or its spoken text differs.
'use strict';

const KEYWORD = '{키워드}';
const PICTO = /(\p{Extended_Pictographic}|️|‍)/gu;
const clean = (s) => String(s).replace(PICTO, '').replace(/\s+/g, ' ').trim();

const LIMITS = { rateMin: 0.9, rateMax: 1.15, pauseMax: 0.6, emphasisMax: 2 };

/**
 * Applies job.productionPlan to storyboard (mutates it) and returns a report:
 * { used, ignored: 'reason'|'', applied: { rates, pauses, emphasis, cuts }, problems: [] }.
 * Anything invalid is skipped (with a problem noted); the render continues with the template defaults.
 */
function applyProductionPlan(storyboard, job, template) {
  const plan = job.productionPlan;
  const report = { used: false, ignored: '', applied: { rates: 0, pauses: 0, emphasis: 0, cuts: 0 }, problems: [] };
  if (!plan) return report;
  if (plan.approvedHash !== job.approvedHash || Number(plan.scriptVersion) !== Number(job.scriptVersion)) {
    report.ignored = '제작 계획이 이 승인된 대본 버전의 것이 아니라서 사용하지 않습니다.';
    return report;
  }
  const keyword = storyboard.keyword;
  const spoken = (t) => clean(String(t).split(KEYWORD).join(keyword));
  const byScene = (list) => Object.fromEntries((Array.isArray(list) ? list : []).filter(Boolean).map((x) => [Number(x.scene_no), x]));
  const nar = byScene(plan.narration);
  // The spoken text must equal the approved narration for every scene — otherwise this is not our script.
  const mismatch = storyboard.beats.filter((b) => !nar[b.sceneNo] || spoken(nar[b.sceneNo].tts_text) !== b.ttsText);
  if (mismatch.length) {
    report.ignored = `제작 계획의 음성 문장이 승인된 대본과 다릅니다 (장면 ${mismatch.map((b) => b.sceneNo).join(', ')}) — 계획을 사용하지 않습니다.`;
    return report;
  }
  const subs = byScene(plan.subtitles);
  const edit = byScene(plan.edit);
  const { minSec, maxSec } = template.shots;
  storyboard.beats.forEach((b) => {
    const n = nar[b.sceneNo];
    const rate = Number(n.speaking_rate);
    if (rate >= LIMITS.rateMin && rate <= LIMITS.rateMax) {
      b.rate = rate;
      report.applied.rates++;
    } else report.problems.push(`장면 ${b.sceneNo}: 말하기 속도 ${n.speaking_rate}는 ${LIMITS.rateMin}~${LIMITS.rateMax} 밖이라 기본값을 씁니다.`);
    const pause = Number(n.pause_after_sec);
    if (pause >= 0 && pause <= LIMITS.pauseMax) {
      b.pauseAfterSec = pause;
      report.applied.pauses++;
    } else report.problems.push(`장면 ${b.sceneNo}: 쉼 ${n.pause_after_sec}초는 0~${LIMITS.pauseMax} 밖이라 기본값을 씁니다.`);
    const words = ((subs[b.sceneNo] || {}).emphasis_words || []).map((w) => String(w).trim()).filter(Boolean);
    const okWords = words.filter((w) => b.subtitle.includes(w)).slice(0, LIMITS.emphasisMax);
    if (okWords.length) {
      b.emphasisWords = okWords;
      report.applied.emphasis += okWords.length;
    }
    if (words.length !== okWords.length) report.problems.push(`장면 ${b.sceneNo}: 자막에 없는 강조 단어를 건너뜁니다.`);
    const cuts = (edit[b.sceneNo] || {}).cuts;
    if (Array.isArray(cuts) && cuts.length) {
      const per = b.scriptedSec / cuts.length;
      if (per >= minSec - 1e-9 && per <= maxSec + 1e-9 && cuts.every((c) => c && String(c.framing || '').trim())) {
        b.shots = cuts.map((c, k) => ({ id: `S${b.sceneNo}-${k + 1}`, scriptedSec: per, framing: String(c.framing).trim() }));
        b.plannedCuts = cuts.length;
        report.applied.cuts += cuts.length;
      } else report.problems.push(`장면 ${b.sceneNo}: 컷 ${cuts.length}개는 컷당 ${per.toFixed(1)}초라 기본 컷 구성을 씁니다 (${minSec}~${maxSec}초).`);
    }
  });
  report.used = true;
  return report;
}

module.exports = { applyProductionPlan, LIMITS };
