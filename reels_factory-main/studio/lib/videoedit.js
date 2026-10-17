// Video Studio edit layer. It only changes how the finished video is presented (subtitles, mix); it never touches approved
// audio files, the dialogue timeline (buildTimeline) or any scene approval:
//   * subtitles : per spoken line — text override (ko / en), start/end shifts relative to the audio line, hidden flag.
//                 The audio under a subtitle keeps its approved timing; only the caption moves.
//   * style     : caption position (fraction of the frame height), font size override, language (ko / en / both)
//   * mix       : voice and effect balance in dB for the FINAL render (per-effect gain/offset/fades live on the effect itself)
// Everything is stored in ep.videoEdit; an edit hash goes into each render so a render made before an edit is shown as outdated.
'use strict';
const { StudioError, sha256, canonical, nowIso } = require('./util');

const STEP = 0.05;                 // stored precision (finer than the 0.3 s UI step)
const MIN_CUE = 0.3;               // shortest subtitle
const LIMITS = { yFrac: [0.3, 0.9], fontSize: [30, 120], dB: [-18, 12] };
const LANGS = ['ko', 'en', 'both'];
const q = (n) => Math.round(Number(n) / STEP) * STEP;
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const r3 = (n) => Math.round(n * 1000) / 1000;

const defaults = () => ({ style: { yFrac: 0.74, fontSize: null, lang: 'ko' }, mix: { voiceDb: 0, sfxDb: 0 }, subtitles: {}, transition: { type: 'cut', durationSec: 0.3 }, music: null });
function get(ep) {
  const e = ep.videoEdit || {};
  const d = defaults();
  return { style: Object.assign(d.style, e.style || {}), mix: Object.assign(d.mix, e.mix || {}), subtitles: e.subtitles || {}, transition: Object.assign(d.transition, e.transition || {}), music: e.music || null };
}
const editHash = (ep) => sha256(canonical(get(ep)));

function createVideoEdit({ store }) {
  const lineOf = (ep, id) => { const l = (ep.lines || []).find((x) => x.id === id); if (!l) throw new StudioError('NOT_FOUND', '대사를 찾을 수 없습니다: ' + id, { status: 404 }); return l; };
  const mutate = async (epId, fn, action, extra = {}) => {
    await store.episodes.update(epId, (ep) => { ep.videoEdit = get(ep); fn(ep.videoEdit, ep); });
    store.episodes.audit(epId, action, extra);
  };

  async function saveStyle(epId, patch) {
    await mutate(epId, (v) => {
      if (patch.yFrac !== undefined) v.style.yFrac = r3(clamp(Number(patch.yFrac) || 0.74, LIMITS.yFrac));
      if (patch.fontSize !== undefined) v.style.fontSize = patch.fontSize === null || patch.fontSize === '' ? null : Math.round(clamp(Number(patch.fontSize) || 60, LIMITS.fontSize));
      if (patch.lang !== undefined) { if (!LANGS.includes(patch.lang)) throw new StudioError('BAD_REQUEST', '자막 언어는 ko / en / both 입니다.', { status: 422 }); v.style.lang = patch.lang; }
    }, 'videoedit.style');
  }
  async function saveMix(epId, patch) {
    await mutate(epId, (v) => {
      ['voiceDb', 'sfxDb'].forEach((k) => { if (patch[k] !== undefined) v.mix[k] = r3(clamp(Number(patch[k]) || 0, LIMITS.dB)); });
    }, 'videoedit.mix');
  }
  /** Scene-to-scene transition: 'cut' (default) or 'dip' (short dip through black on the picture only — total length and audio timing never change). */
  async function saveTransition(epId, patch) {
    await mutate(epId, (v) => {
      if (patch.type !== undefined) { if (!['cut', 'dip'].includes(patch.type)) throw new StudioError('BAD_REQUEST', '전환은 cut 또는 dip 입니다.', { status: 422 }); v.transition.type = patch.type; }
      if (patch.durationSec !== undefined) v.transition.durationSec = r3(clamp(Number(patch.durationSec) || 0.3, [0.1, 0.9]));
    }, 'videoedit.transition');
  }
  /** Background music: one uploaded track (file kept by studio.uploadMusic); level, fades and start offset are editable. Not looped; plays under the dialogue at its own level. */
  async function saveMusic(epId, patch) {
    await mutate(epId, (v) => {
      if (patch === null || patch.remove) { v.music = null; return; }
      const cur = Object.assign({ volumeDb: -18, fadeInSec: 1, fadeOutSec: 2, offsetSec: 0 }, v.music || {});
      ['file', 'name', 'sha256'].forEach((k) => { if (patch[k] !== undefined) cur[k] = String(patch[k]).slice(0, 200); });
      if (patch.durationSec !== undefined) cur.durationSec = r3(Math.max(0, Number(patch.durationSec) || 0));
      if (patch.volumeDb !== undefined) cur.volumeDb = r3(clamp(Number(patch.volumeDb) || 0, [-40, 0]));
      if (patch.fadeInSec !== undefined) cur.fadeInSec = r3(clamp(Number(patch.fadeInSec) || 0, [0, 5]));
      if (patch.fadeOutSec !== undefined) cur.fadeOutSec = r3(clamp(Number(patch.fadeOutSec) || 0, [0, 5]));
      if (patch.offsetSec !== undefined) cur.offsetSec = r3(Math.max(0, q(patch.offsetSec) || 0));
      if (!cur.file) throw new StudioError('BAD_REQUEST', '음악 파일이 없습니다.', { status: 422 });
      v.music = cur;
    }, 'videoedit.music');
  }
  async function saveSubtitle(epId, lineId, patch) {
    await mutate(epId, (v, ep) => {
      lineOf(ep, lineId);
      const cur = Object.assign({}, v.subtitles[lineId] || {});
      if (patch.ko !== undefined) cur.ko = String(patch.ko).slice(0, 200);
      if (patch.en !== undefined) cur.en = String(patch.en).slice(0, 300);
      if (patch.startShift !== undefined) cur.startShift = r3(clamp(q(patch.startShift), [-5, 5]));
      if (patch.endShift !== undefined) cur.endShift = r3(clamp(q(patch.endShift), [-5, 5]));
      if (patch.hidden !== undefined) cur.hidden = !!patch.hidden;
      Object.keys(cur).forEach((k) => { if (cur[k] === '' || cur[k] === 0 || cur[k] === false) delete cur[k]; });
      if (Object.keys(cur).length) v.subtitles[lineId] = cur; else delete v.subtitles[lineId];
    }, 'videoedit.subtitle', { lineId });
  }
  async function resetSubtitle(epId, lineId) { await mutate(epId, (v) => { delete v.subtitles[lineId]; }, 'videoedit.subtitle.reset', { lineId }); }

  /** Effective subtitle cues for a built timeline: the audio line's own window, then the caption edits on top. */
  function cues(ep, tl) {
    const v = get(ep);
    const out = [];
    tl.lines.forEach((l) => {
      const e = v.subtitles[l.id] || {};
      const base = { lineId: l.id, sceneId: l.sceneId, speaker: l.speaker };
      const start = Math.max(0, r3(l.start + (e.startShift || 0)));
      let end = r3(l.end + 0.15 + (e.endShift || 0));
      if (end < start + MIN_CUE) end = r3(start + MIN_CUE);
      end = Math.min(end, tl.total);
      out.push(Object.assign(base, { ko: e.ko != null ? e.ko : l.ko, en: e.en != null ? e.en : l.en, start, end, hidden: !!e.hidden, edited: !!Object.keys(e).length, audioStart: l.start, audioEnd: l.end }));
    });
    return out;
  }

  /** Free checks on the subtitle track (warnings; the final render checklist shows them). */
  function checks(ep, tl) {
    const v = get(ep);
    const list = cues(ep, tl);
    const out = [];
    const shown = list.filter((c) => !c.hidden);
    shown.forEach((c, i) => {
      const text = v.style.lang === 'en' ? c.en : c.ko;
      if (!String(text || '').trim()) out.push({ code: 'SUBTITLE_EMPTY', lineId: c.lineId, message: `${c.lineId}: 자막 텍스트가 비어 있습니다.` });
      if ([...String(text || '')].length > 60) out.push({ code: 'SUBTITLE_LONG', lineId: c.lineId, message: `${c.lineId}: 자막이 너무 깁니다 (${[...String(text)].length}자 > 60자) — 줄바꿈 때문에 화면을 가릴 수 있습니다.` });
      const next = shown[i + 1];
      if (next && c.end > next.start + 0.01 && c.sceneId === next.sceneId) out.push({ code: 'SUBTITLE_OVERLAP', lineId: c.lineId, message: `${c.lineId}와 ${next.lineId} 자막이 겹칩니다.` });
    });
    const hidden = list.filter((c) => c.hidden).length;
    if (hidden) out.push({ code: 'SUBTITLE_HIDDEN', message: `자막 ${hidden}개가 숨겨져 있습니다 (의도한 경우 무시).` });
    return out;
  }

  return { get: (ep) => get(ep), saveStyle, saveMix, saveTransition, saveMusic, saveSubtitle, resetSubtitle, cues, checks, editHash };
}

module.exports = { createVideoEdit, get, editHash, defaults, MIN_CUE, STEP };
