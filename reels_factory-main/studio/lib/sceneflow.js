// Per-scene production flow after the start image and the B-cuts are approved:
//   audio (generate → listen → approve)  →  video clip (needs approved audio)  →  scene composite (clip + audio + B-cuts + sound effects)
//   → scene final approval  →  final render (only approved scenes).
// Every approval is bound to a hash of exactly what was approved; when a part changes the approval turns "stale" and the changed
// part is named. Every approval can be revoked ("승인 취소") without deleting anything.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, sha256, sha256File, canonical, nowIso } = require('./util');
const { buildTimeline } = require('./timeline');
const { buildAudioTrack, sceneVideoChains } = require('./render');
const { run, probe } = require('../../renderer/lib/ffmpeg');

const h = (v) => sha256(canonical(v));
const PART_LABEL = { clip: '무음 애니메이션', lipsync: '립싱크 영상', audio: '오디오', cuts: '컷·B컷', sfx: '효과음' };

function createSceneFlow({ store, cfg, voice, broll, log = () => {} }) {
  const sceneOf = (ep, id) => {
    const s = (ep.scenes || []).find((x) => x.id === id);
    if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + id, { status: 404 });
    return s;
  };
  const linesOf = (ep, sid) => (ep.lines || []).filter((l) => l.sceneId === sid);

  // ------------------------------------------------------------------ audio
  /** none (no audio yet) · partial · unapproved · approved · stale (approved, then lines/voice changed) · silent (scene has no dialogue: nothing to approve) */
  function audioState(ep, sid) {
    const lines = linesOf(ep, sid);
    if (!lines.length) return { state: 'silent', lines: [], hash: h([]) };
    const rows = lines.map((l) => {
      const a = voice.lineAudio(ep, l);
      const e = (ep.voice && ep.voice.lines && ep.voice.lines[l.id]) || {};
      return { id: l.id, speaker: l.speaker, en: l.en, ko: l.ko, valid: !!a.valid, durationSec: a.valid ? a.durationSec : null, mock: !!a.mock, key: a.valid ? e.key : '' };
    });
    const hash = h(rows.map((r) => [r.id, r.speaker, r.en, r.key, r.durationSec]));
    const ok = rows.filter((r) => r.valid).length;
    const rec = (ep.audioApprovals || {})[sid];
    let state;
    if (!ok) state = 'none';
    else if (ok < rows.length) state = 'partial';
    else if (!rec) state = 'unapproved';
    else state = rec.hash === hash ? 'approved' : 'stale';
    return { state, lines: rows, hash, approval: rec || null, totalSec: Math.round(rows.reduce((n, r) => n + (r.durationSec || 0), 0) * 100) / 100 };
  }
  /** true when the scene may be animated: no dialogue, or its audio is approved and current */
  const audioOk = (ep, sid) => ['silent', 'approved'].includes(audioState(ep, sid).state);

  async function approveAudio(epId, sid, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      sceneOf(ep, sid);
      const st = audioState(ep, sid);
      if (st.state === 'silent') throw new StudioError('NO_DIALOGUE', '이 장면에는 대사가 없어 오디오 승인이 필요 없습니다.', { status: 409 });
      if (['none', 'partial'].includes(st.state)) throw new StudioError('AUDIO_INCOMPLETE', `${sid}: 모든 대사의 음성이 있어야 승인할 수 있습니다.`, { status: 409, recovery: '"오디오 생성"을 먼저 누르세요.' });
      ep.audioApprovals = ep.audioApprovals || {};
      ep.audioApprovals[sid] = { hash: st.hash, by, at: nowIso() };
    });
    store.episodes.audit(epId, 'audio.approved', { sceneId: sid, by });
  }
  async function revokeAudio(epId, sid, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      sceneOf(ep, sid);
      if (ep.audioApprovals) delete ep.audioApprovals[sid];
    });
    store.episodes.audit(epId, 'audio.revoked', { sceneId: sid, by });
  }

  // ------------------------------------------------------------------ parts of a scene
  function approvedClip(ep, sid) {
    const c = (ep.clips || {})[sid];
    const v = c && c.approvedVersion && c.versions.find((x) => x.v === c.approvedVersion);
    return v || null;
  }
  /** The approved lip-synced version of a dialogue scene (stored apart from the silent animation, ep.lipsync). */
  function approvedLipsync(ep, sid) {
    const l = (ep.lipsync || {})[sid];
    return (l && l.approvedVersion && l.versions.find((x) => x.v === l.approvedVersion)) || null;
  }
  /**
   * Which approved video this scene is assembled from:
   *   - no dialogue            → the approved silent animation
   *   - dialogue + approved lip sync → the lip-synced video
   *   - dialogue approved BEFORE the lip-sync stage existed (scene final approved without a lipsync part) → the approved animation (legacy, kept valid)
   * null = something is missing (the scene needs an approved lip sync).
   */
  function sourceOf(ep, sid) {
    const anim = approvedClip(ep, sid);
    if (!linesOf(ep, sid).length) return anim ? Object.assign({ kind: 'animation' }, anim) : null;
    const ls = approvedLipsync(ep, sid);
    if ((ep.lipsyncSkipped || {})[sid] === true && anim) return Object.assign({ kind: 'animation', skippedLipsync: true }, anim);
    if (ls && anim) return Object.assign({ kind: 'lipsync' }, ls);
    const rec = ((ep.sceneFinal || {})[sid]) || {};
    if (!ls && anim && ((ep.lipsyncSkipped || {})[sid] === true || (rec.approved && rec.approved.parts && rec.approved.parts.lipsync === undefined))) return Object.assign({ kind: 'animation', legacy: true }, anim);
    return null;
  }
  function cutsOf(ep, sid) {
    const sc = sceneOf(ep, sid);
    const items = broll.approved(ep).filter((b) => b.sceneId === sid).map((b) => {
      const f = broll.file(ep, b);
      return { id: b.id, at: b.insertAtSec, dur: b.durationSec, file: f, sha: f && fs.existsSync(f) ? sha256File(f).slice(0, 16) : '' };
    });
    return { inserts: sc.inserts || [], broll: items };
  }
  function sfxOf(ep, sid) { return (ep.sfx || []).filter((x) => x.sceneId === sid); }

  function partHashes(ep, sid) {
    const clip = approvedClip(ep, sid);
    const cuts = cutsOf(ep, sid);
    const ls = approvedLipsync(ep, sid);
    const parts = {
      clip: clip ? h([clip.v, clip.sha256]) : '',
      audio: (() => { const offsets = (ep.lines || []).filter((l) => l.sceneId === sid && Number((ep.audioTiming || {})[l.id]) > 0).map((l) => [l.id, (ep.audioTiming || {})[l.id]]); const original = audioState(ep, sid).hash; return offsets.length ? h([original, offsets]) : original; })(),
      cuts: h([cuts.inserts, cuts.broll.map((b) => [b.id, b.at, b.dur, b.sha])]),
      sfx: h(sfxOf(ep, sid).map((x) => [x.id, x.sha256, x.offsetSec, x.gainDb].concat(x.fadeInSec || x.fadeOutSec ? [x.fadeInSec || 0, x.fadeOutSec || 0] : []))),
    };
    // only present when a lip-synced video is in use, so scenes approved before the lip-sync stage keep their hash
    if (linesOf(ep, sid).length) {
      if ((ep.lipsyncSkipped || {})[sid] === true) parts.lipsync = 'skipped';
      else if (ls) parts.lipsync = h([ls.v, ls.sha256]);
    }
    return parts;
  }
  const sceneHash = (parts) => h(parts);

  /**
   * incomplete  : clip not approved or audio not ready/approved
   * ready       : all parts approved, no composite yet (or the composite is out of date)
   * built       : composite matches the current parts, waiting for the approval
   * approved    : approved composite matches the current parts
   * stale       : was approved, a part changed since (changed parts listed)
   */
  function sceneState(ep, sid) {
    sceneOf(ep, sid);
    const rec = ((ep.sceneFinal || {})[sid]) || {};
    const parts = partHashes(ep, sid);
    const hash = sceneHash(parts);
    const missing = [];
    if (!parts.clip) missing.push('clip');
    if (parts.clip && !sourceOf(ep, sid)) missing.push('lipsync');
    if (!audioOk(ep, sid)) missing.push('audio');
    const changed = (old) => old ? Object.keys(PART_LABEL).filter((k) => (old[k] || '') !== (parts[k] || '')) : [];
    const comp = rec.composite && rec.composite.hash === hash && rec.composite.file && fs.existsSync(store.episodes.file(ep.id, rec.composite.file)) ? rec.composite : null;
    let state;
    if (missing.length) state = rec.approved ? 'stale' : 'incomplete';
    else if (rec.approved && rec.approved.hash === hash) state = comp ? 'approved' : 'ready';
    else if (rec.approved) state = 'stale';
    else state = comp ? 'built' : 'ready';
    const changedParts = state === 'stale' ? (missing.length ? missing : changed(rec.approved.parts)) : [];
    return { sceneId: sid, state, hash, parts, missing: missing.map((k) => PART_LABEL[k]), changed: changedParts.map((k) => PART_LABEL[k]), composite: comp ? { file: comp.file, durationSec: comp.durationSec, url: `/media/composite/${ep.id}/${sid}?v=${comp.hash.slice(0, 12)}`, builtAt: comp.builtAt } : null, approval: rec.approved || null, history: (rec.history || []).slice(-5) };
  }
  const allStates = (ep) => (ep.scenes || []).map((s) => sceneState(ep, s.id));

  // ------------------------------------------------------------------ composite (preview-quality, free, local FFmpeg)
  const building = new Set();
  async function buildComposite(epId, sid) {
    const key = epId + ':' + sid;
    if (building.has(key)) throw new StudioError('ALREADY_RUNNING', '이 장면은 이미 합치는 중입니다.', { status: 409 });
    building.add(key);
    try {
      const ep = store.episodes.get(epId);
      const sc = sceneOf(ep, sid);
      const st = sceneState(ep, sid);
      if (st.missing.length) throw new StudioError('SCENE_INCOMPLETE', `${sid}: ${st.missing.join(', ')} 승인이 먼저 필요합니다.`, { status: 409, recovery: '장면의 단계 표시에서 비어 있는 단계로 이동하세요.' });
      const clip = sourceOf(ep, sid);
      const clipFile = store.episodes.file(epId, clip.file);
      if (!fs.existsSync(clipFile) || sha256File(clipFile) !== clip.sha256) throw new StudioError('CLIP_CHECKSUM', `${sid}: 승인된 클립 파일이 없거나 바뀌었습니다.`, { status: 409, recovery: '클립을 다시 승인하세요.' });
      const au = audioState(ep, sid);
      const audio = {};
      au.lines.forEach((r) => { audio[r.id] = voice.lineAudio(ep, { id: r.id, speaker: r.speaker, en: r.en }); });
      const tl = buildTimeline(ep, (id) => (audio[id] && audio[id].valid ? audio[id].durationSec : null));
      const ts = tl.scenes.find((x) => x.id === sid);
      const dur = Math.max(0.5, ts ? ts.duration : Number(sc.durationSec));
      if (ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5 && dur > 5.001) throw new StudioError('SCENE_OVER_5_SECONDS', `${sid}: 승인된 음성 길이까지 합치면 ${dur.toFixed(2)}초입니다. 최대 5초에 맞게 대사를 짧게 하거나 씬을 나누세요.`, { status: 409 });
      const cuts = cutsOf(ep, sid);
      const overlays = cuts.broll.filter((b) => b.file && fs.existsSync(b.file)).map((b) => ({ id: b.id, at: b.at, dur: b.dur, file: b.file }));
      const items = tl.lines.filter((l) => l.sceneId === sid && audio[l.id]).map((l) => ({ file: audio[l.id].file, start: Math.max(0, l.start - ts.start), gainDb: 0 }));
      sfxOf(ep, sid).forEach((x) => { const f = store.episodes.file(epId, x.file); if (fs.existsSync(f) && x.offsetSec < dur) items.push({ file: f, start: x.offsetSec, gainDb: Number(x.gainDb || -6), fadeIn: Number(x.fadeInSec || 0), fadeOut: Number(x.fadeOutSec || 0), durationSec: Number(x.durationSec || 0) }); });
      const work = store.episodes.file(epId, 'tmp', 'comp-' + Date.now());
      fs.mkdirSync(work, { recursive: true });
      try {
        const W = 540, H = 960, fps = 30;
        let audioIn = [];
        if (items.length) { await buildAudioTrack(cfg.ffmpeg.ffmpeg, items, dur, path.join(work, 'audio.wav'), work); audioIn = ['-i', 'audio.wav']; }
        else audioIn = ['-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=48000:cl=mono'];
        const args = ['-hide_banner', '-y', '-i', clipFile, ...audioIn];
        overlays.forEach((o) => args.push('-loop', '1', '-framerate', String(fps), '-t', o.dur.toFixed(3), '-i', o.file));
        const r = sceneVideoChains({ i: 0, clipIn: 0, dur, clipDurationSec: clip.durationSec || dur, inserts: sc.inserts || [], overlays, overlayIn: (o) => 2 + overlays.indexOf(o), W, H, fps });
        const out = path.join(work, 'scene.mp4');
        args.push('-filter_complex', r.chains.join(';'), '-map', `[${r.label}]`, '-map', '1:a', '-t', dur.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out);
        await run(cfg.ffmpeg.ffmpeg, args, { cwd: work });
        const info = await probe(cfg.ffmpeg.ffprobe, out);
        if (!info.streams.some((s) => s.codec_type === 'audio')) throw new StudioError('QC', '합본에 오디오가 없습니다.');
        const rel = path.join('composites', `${sid}-${st.hash.slice(0, 12)}.mp4`);
        fs.mkdirSync(path.dirname(store.episodes.file(epId, rel)), { recursive: true });
        fs.copyFileSync(out, store.episodes.file(epId, rel));
        const rec = { hash: st.hash, parts: st.parts, file: rel, sha256: sha256File(out), durationSec: Math.round(info.duration * 100) / 100, builtAt: nowIso() };
        await store.episodes.update(epId, (e) => {
          e.sceneFinal = e.sceneFinal || {};
          e.sceneFinal[sid] = Object.assign(e.sceneFinal[sid] || {}, { composite: rec });
        });
        store.episodes.audit(epId, 'scene.composite', { sceneId: sid, hash: st.hash.slice(0, 12) });
        return sceneState(store.episodes.get(epId), sid);
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    } finally {
      building.delete(key);
    }
  }

  async function approveScene(epId, sid, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      const st = sceneState(ep, sid);
      if (st.state === 'incomplete' || st.missing.length) throw new StudioError('SCENE_INCOMPLETE', `${sid}: ${st.missing.join(', ')} 승인이 먼저 필요합니다.`, { status: 409 });
      if (!st.composite) throw new StudioError('NO_COMPOSITE', `${sid}: 먼저 "씬 합치기"로 합본을 만들고 확인하세요.`, { status: 409, recovery: '합본을 재생해 본 뒤 승인하세요.' });
      ep.sceneFinal[sid].approved = { hash: st.hash, parts: st.parts, by, at: nowIso() };
      ep.sceneFinal[sid].history = (ep.sceneFinal[sid].history || []).concat({ action: 'approved', at: nowIso(), by, hash: st.hash.slice(0, 12) });
    });
    store.episodes.audit(epId, 'scene.approved', { sceneId: sid, by });
  }
  async function revokeScene(epId, sid, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      sceneOf(ep, sid);
      const r = (ep.sceneFinal || {})[sid];
      if (r && r.approved) {
        r.history = (r.history || []).concat({ action: 'revoked', at: nowIso(), by, hash: r.approved.hash.slice(0, 12) });
        r.approved = null;
      }
    });
    store.episodes.audit(epId, 'scene.revoked', { sceneId: sid, by });
  }

  // ------------------------------------------------------------------ gates
  /** problems for the final render: every scene must have an approved, current scene final */
  function renderProblems(ep) {
    const out = [];
    const realTimeline = buildTimeline(ep, (id) => {
      const line = (ep.lines || []).find((l) => l.id === id);
      if (!line) return null;
      const item = voice.lineAudio(ep, line);
      return item && item.valid ? item.durationSec : null;
    });
    (ep.scenes || []).forEach((s) => {
      const actual = realTimeline.scenes.find((x) => x.id === s.id);
      if (ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5 && actual && actual.duration > 5.001) out.push({ code: 'SCENE_AUDIO_OVER_5_SECONDS', sceneId: s.id, message: `${s.id}: 오디오 포함 길이 ${actual.duration.toFixed(2)}초가 최대 5초를 초과합니다. 대사를 줄이거나 씬을 나누세요.` });
      if (ep.durationPolicy && ep.durationPolicy.maxSceneSec === 5 && Number(s.durationSec) > 5) out.push({ code: 'SCENE_OVER_5_SECONDS', sceneId: s.id, message: `${s.id}: 씬 길이는 최대 5초입니다. 대본에서 씬을 나누거나 줄여주세요.` });
      const st = sceneState(ep, s.id);
      if (st.state === 'approved') return;
      const why = st.state === 'stale' ? `승인 후 ${st.changed.join('·') || '내용'}이(가) 바뀌었습니다` : st.state === 'incomplete' ? `${st.missing.join('·')} 승인 대기` : st.state === 'built' ? '합본 확인·승인 대기' : '씬 합치기 대기';
      out.push({ code: 'SCENE_NOT_APPROVED', sceneId: s.id, state: st.state, message: `${s.id}: 씬 최종 승인이 필요합니다 (${why}).`, recovery: 'Storyboard의 "씬 합본 · 최종 승인"에서 합본을 만들고 승인하세요.' });
    });
    return out;
  }
  const hashes = (ep) => Object.fromEntries((ep.scenes || []).map((s) => [s.id, sceneState(ep, s.id).hash]));

  return { sourceOf, approvedLipsync, audioState, audioOk, approveAudio, revokeAudio, sceneState, allStates, buildComposite, approveScene, revokeScene, renderProblems, hashes, PART_LABEL };
}

module.exports = { createSceneFlow, PART_LABEL };
