// Approved script → storyboard: beats (HOOK → … → CTA), the line spoken and shown per beat, and the
// shots (hard cuts near the template's target length) each beat needs. Pure; no I/O.
'use strict';

const KEYWORD = '{키워드}';
// Pictographic emoji and variation selectors: unreadable by TTS, and not reliably renderable by libass.
const PICTO = /(\p{Extended_Pictographic}|️|‍)/gu;

class StoryboardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoryboardError';
    this.code = 'SCRIPT_FORMAT_UNSUPPORTED';
  }
}

function clean(s) {
  return String(s).replace(PICTO, '').replace(/\s+/g, ' ').trim();
}

function buildStoryboard(job, template) {
  let scenes;
  try {
    scenes = JSON.parse(job.script['장면(JSON)']);
  } catch (e) {
    throw new StoryboardError('장면(JSON)을 읽을 수 없습니다.');
  }
  if (!Array.isArray(scenes) || !scenes.length || scenes.some((s) => !s || !s.beat || !String(s.narration || '').trim())) {
    throw new StoryboardError('이 대본은 스토리보드 형식(장면별 beat·narration)이 아닙니다. 대시보드에서 "수정 요청" 후 Gemini로 재생성해 다시 승인하세요.');
  }
  const keyword = String(job.script['ManyChat 키워드'] || '').trim();
  const removedSymbols = new Set();
  const { minSec, maxSec } = template.shots;
  const target = template.shots.targetSec || maxSec;
  const framing = (template.shotlist && template.shotlist.framing) || {};
  const beats = scenes.map((s) => {
    const line = String(s.narration).split(KEYWORD).join(keyword);
    (line.match(PICTO) || []).forEach((m) => m !== '️' && removedSymbols.add(m));
    const sec = Number(s.duration_sec);
    // Cuts per scene: as close to the template's target cut length as possible, within min/max.
    let n = Math.max(1, Math.round(sec / target));
    n = Math.max(n, Math.ceil(sec / maxSec - 1e-9));
    n = Math.max(1, Math.min(n, Math.floor(sec / minSec + 1e-9)));
    const frames = framing[s.beat] || [];
    const shots = Array.from({ length: n }, (_, k) => ({ id: `S${s.scene_no}-${k + 1}`, scriptedSec: sec / n, framing: frames.length ? frames[k % frames.length] : '' }));
    return {
      sceneNo: s.scene_no,
      beat: s.beat,
      scriptedSec: sec,
      line,
      subtitle: clean(line),
      ttsText: clean(line),
      visual: s.visual,
      flowPrompt: s.flow_prompt,
      // Scene marked as an AI interior visualization in the approved script (labelled on screen).
      aiVisualization: s.ai_visualization === true,
      shots,
    };
  });
  return {
    reelId: job.reelId,
    keyword,
    beats,
    scriptedTotal: beats.reduce((n, b) => n + b.scriptedSec, 0),
    removedSymbols: [...removedSymbols],
    shortShots: beats.flatMap((b) => b.shots.filter((sh) => sh.scriptedSec < minSec - 1e-9).map((sh) => sh.id)),
  };
}

/**
 * Assigns cuts to Google Flow clips so every clip can cover its part of the scene — before any TTS.
 * Scene length is predicted from the narration: real duration if the line is already cached (free),
 * otherwise a conservative speaking rate. A scene that would outgrow one clip gets extra clips
 * (S3b.mp4 …) instead of an impossible render plan.
 * knownDurations[i]: cached narration seconds for beat i, or null.
 */
function planClips(storyboard, template, knownDurations = [], clipSecFromJob) {
  const fc = template.flowClip || { clipSec: 8, marginSec: 0.5 };
  const clipSec = clipSecFromJob || fc.clipSec;
  const usable = clipSec - fc.marginSec;
  const n = template.narration;
  storyboard.clipSec = clipSec;
  storyboard.beats.forEach((b, i) => {
    const minCps = n.minCharsPerSec * (b.rate || 1);
    const voice = knownDurations[i] != null ? knownDurations[i] : [...b.ttsText].length / minCps;
    b.predictedSec = Math.max(b.scriptedSec, n.leadInSec + voice + (b.pauseAfterSec != null ? b.pauseAfterSec : n.tailSec));
    b.voiceKnown = knownDurations[i] != null;
    const parts = Math.max(1, Math.ceil(b.predictedSec / usable - 1e-9));
    if (b.shots.length < parts) {
      // Every clip needs at least one cut. These cuts are sized by the voice, not the script.
      b.shots = Array.from({ length: parts }, (_, k) => ({ id: `S${b.sceneNo}-${k + 1}`, scriptedSec: b.scriptedSec / parts, framing: (b.shots[k] || b.shots[0]).framing, voiceSized: true }));
    }
    b.clips = Array.from({ length: parts }, (_, p) => ({
      id: `S${b.sceneNo}${p > 0 ? String.fromCharCode(97 + p) : ''}`,
      part: p + 1,
      parts,
      cutIds: [],
      coversSec: b.predictedSec / parts,
    }));
    b.shots.forEach((sh, k) => {
      const p = Math.floor((k * parts) / b.shots.length);
      sh.clip = b.clips[p].id;
      b.clips[p].cutIds.push(sh.id);
    });
  });
  return storyboard;
}

module.exports = { buildStoryboard, planClips, StoryboardError, KEYWORD };
