// Render Studio: approved clips + cached dialogue audio + Korean subtitles + CTA end card → 9:16 MP4 with FFmpeg.
// Reuses the existing FFmpeg wrappers, ASS helpers and font detection. Source clips are never modified; every
// render is saved as a NEW version. Gates (all checked before FFmpeg starts):
//   approved + unchanged script · every scene has an approved clip whose bytes still match the approved checksum ·
//   every line has current audio · FFmpeg has libass/x264/aac · the subtitle font is installed.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, sha256File, nowIso } = require('./util');
const { isScriptApproved, scriptFingerprint } = require('./episode');
const { buildTimeline } = require('./timeline');
const { checkFfmpeg, probe, run } = require('../../renderer/lib/ffmpeg');
const { findFont, FontMissingError } = require('../../renderer/lib/fonts');
const { ts, esc } = require('../../renderer/lib/ass');
const { sceneInsertChains, cutsFingerprint } = require('./cuts');
const { isSceneApproved } = require('./sceneapproval');

const PICTO = /(\p{Extended_Pictographic}|️|‍)/gu; // libass cannot draw emoji; they stay in the caption text
const clean = (s) => String(s).replace(PICTO, '').replace(/\s+/g, ' ').trim();
const assColor = (hex) => '&H00' + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
const SPEAKER_COLOR = { diane: '#F6DCC8', jack: '#DDEBD2' };

/** Visual width in em: full-width (Hangul/CJK) = 1, other characters ≈ 0.55. */
const emWidth = (t) => [...String(t)].reduce((n, c) => n + (c.codePointAt(0) >= 0x2e80 ? 1 : 0.55), 0);

/** Balanced wrap: one line if it fits, otherwise split at the space that makes the two halves most even. */
function wrap(text, maxEm, maxLines = 2) {
  const t = clean(text);
  if (emWidth(t) <= maxEm) return [t];
  const words = t.split(' ');
  if (words.length < 2) return [t];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const score = Math.max(emWidth(a), emWidth(b));
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  if (maxLines < 2) return [t];
  return best.lines;
}

function buildDialogueAss(tl, { W, H, font, fontSize, disclosure, cues = null, yFrac = 0.74, lang = 'ko' }) {
  const cx = Math.round(W / 2);
  const subEm = (W * 0.86) / fontSize;
  const out = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${font},${fontSize},&H00FFFFFF,&H000000FF,&H00202A3B,&H80000000,0,0,0,0,100,100,0,0,1,4,1,5,0,0,0,1`,
    `Style: Cta,${font},${fontSize},&H00F2F6FA,&H000000FF,&H00202A3B,&H00202A3B,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Disc,${font},${Math.round(fontSize * 0.5)},&H00F2F6FA,&H000000FF,&H00202A3B,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},${Math.round(H * 0.045)},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, a, b, style, text) => out.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${style},,0,0,0,,${text}`);
  // default: one Korean caption per audio line; the Video Studio passes edited cues (text, shifted windows, hidden, language)
  const rows = cues ? cues.filter((c) => !c.hidden).map((c) => ({ speaker: c.speaker, start: c.start, end: c.end, ko: c.ko, en: c.en })) : tl.lines.map((l) => ({ speaker: l.speaker, start: l.start, end: l.end + 0.15, ko: l.ko, en: l.en }));
  rows.forEach((l) => {
    const col = assColor(SPEAKER_COLOR[l.speaker] || '#FFFFFF');
    const main = lang === 'en' ? l.en : l.ko;
    let body = wrap(main, subEm).map(esc).join('\\N');
    if (lang === 'both' && l.en) body += `\\N{\\fs${Math.round(fontSize * 0.7)}}` + wrap(l.en, (W * 0.86) / (fontSize * 0.7)).map(esc).join('\\N');
    ev(2, l.start, l.end, 'Sub', `{\\pos(${cx},${Math.round(H * yFrac)})\\c${col}}${body}`);
  });
  const ctaLines = tl.cta.lines.map(clean).filter(Boolean);
  if (ctaLines.length && tl.cta.duration > 0) {
    const sizes = [Math.round(fontSize * 1.18), Math.round(fontSize * 0.98), Math.round(fontSize * 0.9)];
    const rows = [];
    ctaLines.forEach((l, i) => {
      const sz = sizes[Math.min(i, sizes.length - 1)];
      wrap(l, (W * 0.84) / sz).forEach((part) => rows.push({ text: part, size: sz }));
    });
    const pad = fontSize * 0.7;
    const width = Math.min(W * 0.92, Math.max(...rows.map((r) => emWidth(r.text) * r.size)) + pad * 2);
    const height = rows.reduce((n, r) => n + r.size * 1.3, 0) + pad * 1.2;
    const cy = Math.round(H * 0.5);
    const hw = Math.round(width / 2);
    const hh = Math.round(height / 2);
    const t0 = tl.cta.start + 0.1;
    ev(3, t0, tl.cta.end, 'Cta', `{\\an7\\pos(${cx - hw},${cy - hh})\\1c&H202A3B&\\1a&H38&\\bord0\\shad0\\fad(250,0)\\p1}m 0 0 l ${2 * hw} 0 ${2 * hw} ${2 * hh} 0 ${2 * hh}{\\p0}`);
    const body = rows.map((r) => `{\\fs${r.size}}${esc(r.text)}`).join('\\N');
    ev(4, t0, tl.cta.end, 'Cta', `{\\an5\\pos(${cx},${cy})\\fad(250,0)}${body}`);
  }
  if (disclosure) ev(5, 0, tl.total, 'Disc', esc(clean(disclosure)));
  return out.join('\n') + '\n';
}

/** Optional per-item fades (sound effects): afade in at the start, out ending at the item's own end. */
function fadeFilter(it) {
  let f = '';
  if (it.fadeIn > 0) f += `,afade=t=in:st=0:d=${Number(it.fadeIn).toFixed(2)}`;
  if (it.fadeOut > 0 && it.durationSec > it.fadeOut) f += `,afade=t=out:st=${(it.durationSec - it.fadeOut).toFixed(2)}:d=${Number(it.fadeOut).toFixed(2)}`;
  return f;
}

async function buildAudioTrack(ffmpeg, items, total, outFile, cwd) {
  const args = ['-hide_banner', '-y'];
  items.forEach((i) => args.push('-i', i.file));
  const parts = items.map((it, k) => `[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,volume=${(it.gainDb || 0).toFixed(1)}dB${fadeFilter(it)},adelay=${Math.round(it.start * 1000)}:all=1[a${k}]`);
  const mix = items.map((_, k) => `[a${k}]`).join('') + `amix=inputs=${items.length}:normalize=0:dropout_transition=0`;
  const filter = parts.concat([`${mix},apad=whole_dur=${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`]).join(';');
  args.push('-filter_complex', filter, '-map', '[out]', '-t', total.toFixed(3), '-ac', '1', '-ar', '48000', outFile);
  await run(ffmpeg, args, { cwd });
}

/**
 * Video filter chains of ONE scene: the approved clip scaled/padded/trimmed to the scene length, the insert (close-up) cuts cropped from
 * the same clip, then the approved B-roll stills laid over their time windows. Scene length, dialogue and audio timing never change.
 * Shared by the final render and the per-scene composite, so what is approved per scene is what gets rendered.
 */
function sceneVideoChains({ i, clipIn, dur, clipDurationSec, inserts, overlays, overlayIn, W, H, fps }) {
  const chains = [];
  const pad = Math.max(0, dur - clipDurationSec) + 0.05;
  const baseLabel = inserts.length ? `b${i}` : `v${i}`;
  chains.push(`[${clipIn}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[${baseLabel}]`);
  if (inserts.length) chains.push(...sceneInsertChains({ base: baseLabel, out: `v${i}`, inserts, W, H, fps, dur }).chains);
  let from = `v${i}`;
  overlays.forEach((o, k) => {
    const to = `v${i}o${k}`;
    chains.push(`[${overlayIn(o)}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p,fps=${fps},trim=duration=${o.dur.toFixed(3)},setpts=PTS-STARTPTS+${o.at.toFixed(3)}/TB[bro${i}_${k}]`);
    chains.push(`[${from}][bro${i}_${k}]overlay=enable='between(t,${o.at.toFixed(3)},${(o.at + o.dur).toFixed(3)})':eof_action=pass:format=auto[${to}]`);
    from = to;
  });
  return { chains, label: from };
}

function createRenderService({ store, cfg, voice, log = () => {}, broll = { approved: () => [], file: () => '', problem: () => '' }, sceneGate = null, videoEdit = null }) {
  const active = new Set();

  function gather(ep) {
    const problems = [];
    if (!isScriptApproved(ep)) problems.push({ code: 'SCRIPT_NOT_APPROVED', message: '대본이 승인되지 않았거나 승인 후 수정되었습니다.', recovery: 'Script Studio에서 승인하세요.' });
    const clips = {};
    (ep.scenes || []).forEach((s) => {
      const hasDialogue = (ep.lines || []).some((l) => l.sceneId === s.id);
      const v = sceneGate && sceneGate.source ? sceneGate.source(ep, s.id) : (() => { const c = ep.clips[s.id]; return c && c.approvedVersion && c.versions.find((x) => x.v === c.approvedVersion); })();
      if (!v) return problems.push(hasDialogue
        ? { code: 'LIPSYNC_NOT_APPROVED', sceneId: s.id, message: `${s.id}: 승인된 립싱크 영상이 없습니다.`, recovery: '립싱크 스튜디오에서 무음 애니메이션과 승인된 음성으로 립싱크를 만들고 승인하세요.' }
        : { code: 'CLIP_NOT_APPROVED', sceneId: s.id, message: `${s.id}: 승인된 클립이 없습니다.`, recovery: '애니메이션 스튜디오에서 클립을 생성·업로드·승인하세요.' });
      const f = store.episodes.file(ep.id, v.file);
      if (!fs.existsSync(f)) return problems.push({ code: 'CLIP_MISSING', message: `${s.id}: 클립 파일이 없습니다.`, recovery: '클립을 다시 생성하거나 업로드하세요.' });
      if (sha256File(f) !== v.sha256) return problems.push({ code: 'CLIP_CHECKSUM', message: `${s.id}: 클립 파일이 승인된 파일과 다릅니다 (체크섬 불일치).`, recovery: '클립을 다시 승인하세요.' });
      if ((s.inserts || []).length && !isSceneApproved(ep, s.id)) problems.push({ code: 'CUTS_NOT_APPROVED', message: `${s.id}: 컷(클로즈업) 편집이 승인되지 않았습니다. 컷을 바꾸면 씬을 다시 검토·승인해야 합니다.`, recovery: 'Script Studio에서 이 씬을 확인하고 "씬 승인"을 누르세요.' });
      clips[s.id] = { file: f, v: v.v, sha256: v.sha256, durationSec: v.durationSec, mock: !!v.mock, kind: v.kind || 'animation' }; // a lip-synced video's own audio track is never used: the approved voice audio is mixed exactly once (doRender)
    });
    // Approved B-roll stills are layered over their scene; one without a usable image blocks the render instead of being skipped silently.
    const overlays = [];
    broll.approved(ep).forEach((b) => {
      const f = broll.file(ep, b);
      if (!f || !fs.existsSync(f) || (broll.problem && broll.problem(ep, b))) return problems.push({ code: 'BROLL_IMAGE_MISSING', message: `${b.id}: 승인된 B-roll 이미지를 사용할 수 없습니다${broll.problem ? ' — ' + broll.problem(ep, b) : ''}.`, recovery: 'Storyboard의 컷·B-roll에서 이미지를 다시 지정하거나 B-roll 승인을 취소하세요.' });
      overlays.push({ id: b.id, sceneId: b.sceneId, at: b.insertAtSec, dur: b.durationSec, file: f });
    });
    const audio = {};
    (ep.lines || []).forEach((l) => {
      const a = voice.lineAudio(ep, l);
      if (!a.valid) problems.push({ code: 'NO_AUDIO', sceneId: l.sceneId, message: `대사 ${l.id}: 현재 대본에 맞는 음성이 없습니다.`, recovery: 'Voice Studio에서 음성을 생성하세요.' });
      else audio[l.id] = a;
    });
    // every scene needs its own final approval (clip + audio + cuts + sound effects) — see sceneflow.js
    if (sceneGate) sceneGate.renderProblems(ep).forEach((p) => problems.push(p));
    return { problems, clips, audio, overlays };
  }

  function plan(epId) {
    const ep = store.episodes.get(epId);
    const g = gather(ep);
    const tl = buildTimeline(ep, (id) => (g.audio[id] ? g.audio[id].durationSec : null));
    const cues = videoEdit ? videoEdit.cues(ep, tl) : [];
    return { problems: g.problems, timeline: tl, canRender: g.problems.length === 0, cues, subtitleChecks: videoEdit ? videoEdit.checks(ep, tl) : [] };
  }

  async function doRender(epId, { preview, by }) {
    const ep = store.episodes.get(epId);
    const g = gather(ep);
    if (g.problems.length) throw new StudioError('BLOCKED', g.problems[0].message, { recovery: g.problems[0].recovery, details: g.problems, status: 409 });
    const settings = store.settings.get();
    await checkFfmpeg(cfg.ffmpeg);
    const fontName = settings.render.font || cfg.font;
    if (!findFont(fontName, { fontsDir: cfg.fontsDir }).found && !cfg.allowFontFallback) {
      throw new StudioError('FONT_MISSING', new FontMissingError(fontName).message, { recovery: 'Mac: brew install --cask font-nanum-square-round, 또는 Settings → 렌더링에서 설치된 글꼴 이름을 지정하세요. (RF_ALLOW_FONT_FALLBACK=1 로 임시 허용 가능)' });
    }
    const tl = buildTimeline(ep, (id) => g.audio[id].durationSec);
    const W = preview ? settings.render.previewWidth || 540 : 1080;
    const H = Math.round((W * 16) / 9);
    const fps = 30;
    const work = store.episodes.file(epId, 'tmp', 'render-' + Date.now());
    fs.mkdirSync(work, { recursive: true });
    try {
      const fontSize = settings.render.fontSize || 60; // ASS PlayRes is 1080x1920; libass scales it to the output size
      const ed = videoEdit ? videoEdit.get(ep) : null;
      const ass = buildDialogueAss(tl, { W: 1080, H: 1920, font: fontName, fontSize: (ed && ed.style.fontSize) || fontSize, cues: videoEdit ? videoEdit.cues(ep, tl) : null, yFrac: ed ? ed.style.yFrac : 0.74, lang: ed ? ed.style.lang : 'ko', disclosure: settings.render.burnDisclosure ? (ep.publishing && ep.publishing.disclosure) || '' : '' });
      fs.writeFileSync(path.join(work, 'subs.ass'), ass);
      // Dialogue + sound effects on one continuous track (no artificial silence is inserted between lines).
      const mixEd = ed ? ed.mix : { voiceDb: 0, sfxDb: 0 };
      const items = tl.lines.map((l) => ({ file: g.audio[l.id].file, start: l.start, gainDb: mixEd.voiceDb }));
      (ep.sfx || []).forEach((s) => {
        const f = store.episodes.file(epId, s.file);
        const sc0 = s.sceneId && tl.scenes.find((x) => x.id === s.sceneId);
        const at = s.sceneId ? (sc0 ? sc0.start + Number(s.offsetSec || 0) : -1) : Number(s.atSec || 0); // scene-bound effects follow their scene
        if (fs.existsSync(f) && at >= 0 && at < tl.total) items.push({ file: f, start: at, gainDb: Number(s.gainDb || -6) + mixEd.sfxDb, fadeIn: Number(s.fadeInSec || 0), fadeOut: Number(s.fadeOutSec || 0), durationSec: Number(s.durationSec || 0) });
      });
      // background music: one track under everything, own level + fades; skipped silently only if the file is gone (reported by plan())
      if (ed && ed.music && ed.music.file) {
        const mf = store.episodes.file(epId, ed.music.file);
        if (fs.existsSync(mf)) {
          const room = Math.max(0, tl.total - (ed.music.offsetSec || 0));
          const len = ed.music.durationSec ? Math.min(ed.music.durationSec, room) : room;
          items.push({ file: mf, start: ed.music.offsetSec || 0, gainDb: ed.music.volumeDb, fadeIn: ed.music.fadeInSec, fadeOut: ed.music.fadeOutSec, durationSec: len });
        }
      }
      await buildAudioTrack(cfg.ffmpeg.ffmpeg, items, tl.total, path.join(work, 'audio.wav'), work);

      const args = ['-hide_banner', '-y'];
      tl.scenes.forEach((s) => args.push('-i', g.clips[s.id].file));
      args.push('-i', 'audio.wav');
      // B-roll stills become extra looped inputs after the audio input
      const overlays = g.overlays.filter((o) => tl.scenes.some((s) => s.id === o.sceneId));
      overlays.forEach((o) => { args.push('-loop', '1', '-framerate', String(fps), '-t', o.dur.toFixed(3), '-i', o.file); });
      let chains = [];
      const sceneOut = {};
      tl.scenes.forEach((s, i) => {
        const last = i === tl.scenes.length - 1;
        const dur = s.duration + (last ? tl.cta.duration : 0);
        const sc = (ep.scenes || []).find((x) => x.id === s.id) || {};
        const mine = overlays.filter((o) => o.sceneId === s.id);
        const r = sceneVideoChains({ i, clipIn: i, dur, clipDurationSec: g.clips[s.id].durationSec, inserts: sc.inserts || [], overlays: mine, overlayIn: (o) => tl.scenes.length + 1 + overlays.indexOf(o), W, H, fps });
        chains.push(...r.chains);
        sceneOut[i] = r.label;
        // 'dip' transition: fade the picture through black at scene boundaries (length unchanged; sound is not touched)
        if (ed && ed.transition.type === 'dip' && tl.scenes.length > 1) {
          const d = Math.min(ed.transition.durationSec, dur / 3);
          const fx = [];
          if (i > 0) fx.push(`fade=t=in:st=0:d=${d.toFixed(3)}`);
          if (!last) fx.push(`fade=t=out:st=${(dur - d).toFixed(3)}:d=${d.toFixed(3)}`);
          if (fx.length) { chains.push(`[${r.label}]${fx.join(',')}[vt${i}]`); sceneOut[i] = 'vt' + i; }
        }
      });
      const fontsArg = cfg.fontsDir ? `:fontsdir=${cfg.fontsDir.replace(/([:\\'])/g, '\\$1')}` : '';
      chains.push(tl.scenes.map((_, i) => `[${sceneOut[i] || 'v' + i}]`).join('') + `concat=n=${tl.scenes.length}:v=1:a=0[vc]`, `[vc]ass=subs.ass${fontsArg}[vout]`);
      const out = path.join(work, 'out.mp4');
      args.push('-filter_complex', chains.join(';'), '-map', '[vout]', '-map', `${tl.scenes.length}:a`, '-t', tl.total.toFixed(3),
        '-c:v', 'libx264', '-preset', preview ? 'veryfast' : cfg.preset, '-crf', String(preview ? 28 : cfg.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out);
      await run(cfg.ffmpeg.ffmpeg, args, { cwd: work });

      // QC on the finished file.
      const info = await probe(cfg.ffmpeg.ffprobe, out);
      const v = info.streams.find((s) => s.codec_type === 'video');
      const a = info.streams.find((s) => s.codec_type === 'audio');
      if (!v || v.width !== W || v.height !== H) throw new StudioError('QC', `출력 해상도가 ${W}×${H}이 아닙니다.`);
      if (!a) throw new StudioError('QC', '출력에 오디오가 없습니다.');
      if (Math.abs(info.duration - tl.total) > 0.4) throw new StudioError('QC', `출력 길이(${info.duration.toFixed(2)}초)가 타임라인(${tl.total}초)과 다릅니다.`);

      const hash = sha256File(out);
      const rec = await store.episodes.update(epId, (e) => {
        const n = (e.renders.reduce((m, r) => Math.max(m, r.v), 0)) + 1;
        const rel = path.join('renders', 'v' + n + (preview ? '-preview' : '') + '.mp4');
        fs.mkdirSync(path.dirname(store.episodes.file(epId, rel)), { recursive: true });
        fs.copyFileSync(out, store.episodes.file(epId, rel));
        const r = { v: n, file: rel, sha256: hash, size: fs.statSync(out).size, durationSec: Math.round(info.duration * 100) / 100, width: W, height: H, preview: !!preview, scriptHash: scriptFingerprint(e), cutsHash: cutsFingerprint(e), clipRefs: Object.fromEntries(Object.entries(g.clips).map(([k, c]) => [k, { v: c.v, sha256: c.sha256 }])), sceneHashes: sceneGate ? sceneGate.hashes(e) : {}, editHash: videoEdit ? videoEdit.editHash(e) : '', hasMockClips: Object.values(g.clips).some((c) => c.mock), mockVoice: Object.values(g.audio).some((x) => x.mock), warnings: tl.warnings.map((w) => w.message), font: fontName, createdAt: nowIso(), by };
        e.renders.push(r);
        e.renderJob = { status: 'done', v: n, finishedAt: nowIso() };
        return r;
      });
      store.episodes.audit(epId, 'render.done', { v: rec.v, preview: !!preview, sha256: hash });
      return rec;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  /** Starts a render. Returns { accepted, done } after the gates pass. */
  async function render(epId, { preview = false, by = 'operator' } = {}) {
    if (active.has(epId)) throw new StudioError('ALREADY_RUNNING', '이 에피소드는 이미 렌더링 중입니다.', { status: 409 });
    const ep = store.episodes.get(epId);
    const g = gather(ep);
    if (g.problems.length) throw new StudioError('BLOCKED', g.problems[0].message, { recovery: g.problems[0].recovery, details: g.problems, status: 409 });
    active.add(epId);
    await store.episodes.update(epId, (e) => {
      e.renderJob = { status: 'running', preview: !!preview, startedAt: nowIso() };
    });
    const done = doRender(epId, { preview, by })
      .catch(async (e) => {
        await store.episodes.update(epId, (x) => {
          x.renderJob = { status: 'failed', error: { code: e.code || 'ERROR', message: e.message, recovery: e.recovery || '' }, finishedAt: nowIso() };
        });
        store.episodes.audit(epId, 'render.failed', { message: e.message });
        throw e;
      })
      .finally(() => active.delete(epId));
    done.catch(() => {}); // surfaced through ep.renderJob; callers may also await `done`
    return { accepted: true, done };
  }

  async function approveFinal(epId, v, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      const r = ep.renders.find((x) => x.v === Number(v));
      if (!r) throw new StudioError('NOT_FOUND', '렌더 버전을 찾을 수 없습니다.', { status: 404 });
      if (r.preview) throw new StudioError('PREVIEW', '미리보기 렌더는 최종 승인할 수 없습니다. 최종 렌더를 만드세요.', { status: 409 });
      if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본 승인이 유효하지 않습니다.', { status: 409 });
      if (r.scriptHash !== scriptFingerprint(ep)) throw new StudioError('STALE', '이 렌더는 현재 대본과 다릅니다. 다시 렌더하세요.', { status: 409 });
      if (sceneGate && r.sceneHashes) {
        const now = sceneGate.hashes(ep);
        const bad = Object.keys(now).filter((k) => r.sceneHashes[k] !== now[k]);
        if (bad.length) throw new StudioError('STALE', `이 렌더 이후 장면(${bad.join(', ')})이 바뀌었습니다. 다시 렌더하세요.`, { status: 409 });
      }
      if (videoEdit && r.editHash !== undefined && r.editHash !== videoEdit.editHash(ep)) throw new StudioError('STALE', '이 렌더 이후 자막·믹스 설정이 바뀌었습니다. 다시 렌더하세요.', { status: 409 });
      const f = store.episodes.file(epId, r.file);
      if (!fs.existsSync(f) || sha256File(f) !== r.sha256) throw new StudioError('CHECKSUM', '렌더 파일이 기록된 체크섬과 다릅니다.', { status: 409 });
      ep.approvals.final = { v: r.v, sha256: r.sha256, by, at: nowIso() };
    });
    store.episodes.audit(epId, 'final.approved', { v, by });
  }

  async function revokeFinal(epId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      ep.approvals.final = null;
      if (ep.publishing) ep.publishing.approvedAt = '';
    });
    store.episodes.audit(epId, 'final.revoked', { by });
  }

  return { plan, render, approveFinal, revokeFinal };
}

module.exports = { createRenderService, buildDialogueAss, buildAudioTrack, sceneVideoChains, wrap, clean };
