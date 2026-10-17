// Insert shots ("컷 추가"): close-ups and reaction cuts made by CROPPING the scene's own approved clip. No AI/video call, no cost.
//   An insert REPLACES a time range of its scene's base shot (same timestamps: the action, dialogue and audio keep running underneath),
//   so the scene duration and the dialogue/subtitle/audio timing never change.
//   Inserts live on the scene (scene.inserts) → they are part of the scene's editable shot timeline, its version snapshots and its
//   approval fingerprint (editing them needs a new scene approval) and of the render freshness check.
//   A crop is a CAMERA move only: it can enlarge what the clip already shows but never creates new eye / face motion.
'use strict';
const { StudioError, sha256, canonical } = require('./util');

const PRESETS = {
  jack_face: { label: 'Jack 얼굴', character: 'jack', crop: { x: 0.5, y: 0.34, scale: 2.0 }, durationSec: 0.8, transition: 'punch_in', face: true },
  diane_face: { label: 'Diane 얼굴', character: 'diane', crop: { x: 0.5, y: 0.34, scale: 2.0 }, durationSec: 0.8, transition: 'punch_in', face: true },
  eyes: { label: '눈', character: '', crop: { x: 0.5, y: 0.31, scale: 3.2 }, durationSec: 0.6, transition: 'quick_zoom', face: true },
  hands_props: { label: '손 / 소품', character: '', crop: { x: 0.5, y: 0.62, scale: 2.0 }, durationSec: 1.0, transition: 'hard_cut', face: false },
  product: { label: '제품', character: '', crop: { x: 0.5, y: 0.55, scale: 1.8 }, durationSec: 1.0, transition: 'hard_cut', face: false },
  custom: { label: '직접 자르기', character: '', crop: { x: 0.5, y: 0.5, scale: 1.5 }, durationSec: 0.8, transition: 'hard_cut', face: false },
};
const TRANSITIONS = {
  hard_cut: { label: '하드 컷', note: '선택한 구도로 바로 컷이 바뀝니다.' },
  punch_in: { label: '즉시 펀치인', note: '첫 2프레임만 살짝 더 확대(임팩트)했다가 정해진 크기로 안착합니다.' },
  quick_zoom: { label: '퀵 줌', note: '약 0.3초 동안 빠르게 확대되어 정해진 크기에 도달합니다.' },
};
const LIMITS = { minDur: 0.2, maxDur: 4, minScale: 1, maxScale: 4, maxInserts: 8, punchOvershoot: 1.06, zoomSec: 0.3, punchFrames: 2 };
const OUT_W = 1080; // final render width (what the resolution check measures against)
const MOTION_CLAIM = /(눈동자|눈|표정)[^.\n]*(움직|깜빡|변화|애니메이션)|(blink|eye[s]? (move|motion|dart)|expression (change|animation|animate))/i;

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== undefined ? Number(v) : d);
const round = (n, p = 1000) => Math.round(n * p) / p;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The crop centre can never leave the frame: keep the whole crop window inside it. */
function clampCrop(c) {
  const scale = round(clamp(num(c && c.scale, 1.5), LIMITS.minScale, LIMITS.maxScale));
  const half = 0.5 / scale;
  return { x: round(clamp(num(c && c.x, 0.5), half, 1 - half)), y: round(clamp(num(c && c.y, 0.5), half, 1 - half)), scale };
}

/**
 * Blur warning: the crop window is srcW/scale pixels wide and is blown up to the 1080 px output.
 * ratio = output px per source px of the crop (>1 = upscaled). level: ok | soft | blur.
 */
function resolutionCheck(srcW, srcH, crop) {
  if (!srcW || !srcH) return { known: false, level: 'unknown', ratio: null, message: '원본 해상도를 알 수 없어 흐림 여부를 계산하지 못했습니다.' };
  const cropW = srcW / crop.scale;
  const ratio = round(OUT_W / cropW, 100);
  if (ratio <= 1.05) return { known: true, level: 'ok', ratio, srcW, srcH, cropW: Math.round(cropW), message: '' };
  const level = ratio > 1.6 ? 'blur' : 'soft';
  return { known: true, level, ratio, srcW, srcH, cropW: Math.round(cropW), message: `원본(${srcW}×${srcH})에서 ${Math.round(cropW)}px 폭만 잘라 1080px로 ${ratio.toFixed(2)}배 확대합니다. ${level === 'blur' ? '화면이 뚜렷하게 흐려질 수 있습니다.' : '약간 흐려질 수 있습니다.'}` };
}

/** What a crop can and cannot do. A crop only enlarges what the clip already shows. */
function motionNote(preset, note) {
  const p = PRESETS[preset] || PRESETS.custom;
  const out = { effect: 'camera_crop', createsNewMotion: false, text: '카메라 크롭입니다. 원본 영상에 이미 있는 움직임만 확대해서 보여주며, 새로운 연기는 만들지 않습니다.' };
  if (p.face) out.faceNote = '눈동자·표정의 새로운 움직임은 크롭으로 만들 수 없습니다. 그런 연기가 필요하면 별도의 AI 영상 생성(유료, 비용 확인과 승인 필요)을 해야 합니다.';
  if (p.face && MOTION_CLAIM.test(String(note || ''))) out.claimWarning = '메모에 눈/표정이 "움직인다"는 표현이 있습니다. 크롭만으로는 새 움직임이 생기지 않으니 표현을 바꾸거나 별도 애니메이션을 요청하세요.';
  return out;
}

/** Validates + normalises a scene's inserts. Returns { inserts, warnings }; throws StudioError for real mistakes. */
function normalizeInserts(list, { durationSec, src = null, sceneId = '' } = {}) {
  if (!Array.isArray(list)) throw new StudioError('BAD_INSERTS', '컷 목록이 올바르지 않습니다.', { status: 422 });
  if (list.length > LIMITS.maxInserts) throw new StudioError('TOO_MANY_INSERTS', `한 장면에는 컷을 ${LIMITS.maxInserts}개까지 넣을 수 있습니다.`, { status: 422 });
  const warnings = [];
  const used = new Set();
  let n = 0;
  const out = list.map((raw, i) => {
    raw = raw || {};
    const preset = PRESETS[raw.preset] ? raw.preset : 'custom';
    const base = PRESETS[preset];
    const transition = TRANSITIONS[raw.transition] ? raw.transition : base.transition;
    let id = String(raw.id || '').trim();
    if (!/^C\d+$/.test(id) || used.has(id)) { do { n += 1; id = 'C' + n; } while (used.has(id) || list.some((x) => x && x.id === id && x !== raw)); }
    used.add(id);
    const startSec = round(Math.max(0, num(raw.startSec, 0)));
    const dur = round(clamp(num(raw.durationSec, base.durationSec), LIMITS.minDur, LIMITS.maxDur));
    const requested = clampCrop(raw.crop || base.crop);
    const crop = clampCrop(requested);
    if (raw.crop && (round(num(raw.crop.x, crop.x)) !== crop.x || round(num(raw.crop.y, crop.y)) !== crop.y || round(num(raw.crop.scale, crop.scale)) !== crop.scale)) warnings.push({ code: 'CROP_ADJUSTED', insertId: id, message: `${id}: 크롭이 화면 밖으로 나가지 않도록 위치/배율을 조정했습니다.` });
    const note = String(raw.note || '').slice(0, 300);
    const ins = { id, kind: 'insert', preset, label: String(raw.label || base.label).slice(0, 40), character: base.character || String(raw.character || ''), transition, startSec, durationSec: dur, crop, source: 'clip', effect: 'camera_crop', note };
    if (raw.hiResRequested) ins.hiResRequested = true;
    const res = resolutionCheck(src && src.width, src && src.height, crop);
    ins.resolution = res;
    if (res.level === 'soft' || res.level === 'blur') warnings.push({ code: 'LOW_RESOLUTION', insertId: id, level: res.level, message: `${id}: ${res.message}`, hiRes: '더 선명한 컷이 필요하면 고해상도 이미지를 따로 만들 수 있습니다. 이 경우 스토리보드에서 비용 확인과 별도 승인을 거칩니다 (여기서는 아무것도 생성하지 않습니다).' });
    const mn = motionNote(preset, note);
    ins.motion = mn;
    if (mn.claimWarning) warnings.push({ code: 'MOTION_CLAIM', insertId: id, message: `${id}: ${mn.claimWarning}` });
    return ins;
  });
  // timing: inside the scene, no overlaps, never extends the scene
  const sorted = out.slice().sort((a, b) => a.startSec - b.startSec);
  const dur = Number(durationSec) || 0;
  sorted.forEach((x, i) => {
    if (dur && x.startSec >= dur) throw new StudioError('INSERT_OUTSIDE', `${x.id}: 시작 시간(${x.startSec}초)이 장면 길이(${dur}초) 밖입니다.`, { status: 422, details: [{ sceneId, insertId: x.id, field: 'startSec' }] });
    if (dur && x.startSec + x.durationSec > dur + 0.001) {
      x.durationSec = round(dur - x.startSec);
      warnings.push({ code: 'INSERT_TRIMMED', insertId: x.id, message: `${x.id}: 장면 길이를 늘리지 않도록 컷 길이를 ${x.durationSec}초로 줄였습니다.` });
      if (x.durationSec < LIMITS.minDur) throw new StudioError('INSERT_TOO_SHORT', `${x.id}: 장면 끝에 너무 가까워 컷을 넣을 수 없습니다.`, { status: 422, details: [{ sceneId, insertId: x.id, field: 'startSec' }] });
    }
    const prev = sorted[i - 1];
    if (prev && x.startSec < prev.startSec + prev.durationSec - 0.001) throw new StudioError('INSERT_OVERLAP', `${prev.id}와 ${x.id}가 겹칩니다. 시작 시간이나 길이를 조정하세요.`, { status: 422, details: [{ sceneId, insertId: x.id, field: 'startSec' }] });
  });
  return { inserts: sorted, warnings };
}

/** Hash of every insert of every scene (render freshness). '' when there are none, so old renders stay valid. */
function cutsFingerprint(ep) {
  const all = (ep.scenes || []).filter((s) => (s.inserts || []).length).map((s) => ({ id: s.id, inserts: s.inserts.map(core) }));
  // approved B-roll overlays change the picture too (only included when there are some, so older renders stay valid)
  const br = (ep.broll || []).filter((b) => b.status === 'approved' && b.imageRef).map((b) => ({ id: b.id, rev: b.rev, sceneId: b.sceneId, at: b.insertAtSec, d: b.durationSec, ref: b.imageRef }));
  return all.length || br.length ? sha256(canonical(br.length ? { cuts: all, broll: br } : all)) : '';
}
/** The parts of an insert that change the picture (used in fingerprints). */
function core(i) { return { id: i.id, preset: i.preset, transition: i.transition, startSec: i.startSec, durationSec: i.durationSec, crop: i.crop, source: i.source }; }
const insertsCore = (scene) => ((scene && scene.inserts) || []).map(core);

// ---------------- FFmpeg ----------------
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
/** One static crop → output size: [in] crop → scale. Window kept inside the frame. */
function cropFilter(W, H, crop) {
  const cw = even(W / crop.scale);
  const ch = even(H / crop.scale);
  const x = Math.round(clamp(crop.x * W - cw / 2, 0, W - cw));
  const y = Math.round(clamp(crop.y * H - ch / 2, 0, H - ch));
  return `crop=${cw}:${ch}:${x}:${y},scale=${W}:${H}:flags=lanczos,setsar=1`;
}
/** zoompan expressions for the quick zoom: ease-out from 1.0 to the crop scale in LIMITS.zoomSec, centred on the crop centre. */
function zoomExpr(W, H, crop, fps) {
  const k = crop.scale - 1;
  const ease = `(1-pow(1-min(1\\,on/${(LIMITS.zoomSec * fps).toFixed(2)})\\,3))`;
  const z = `1+${k.toFixed(4)}*${ease}`;
  const x = `max(0\\,min(iw-iw/zoom\\,${crop.x}*iw-iw/zoom/2))`;
  const y = `max(0\\,min(ih-ih/zoom\\,${crop.y}*ih-ih/zoom/2))`;
  return { z, x, y };
}

/**
 * Filter graph for ONE scene with inserts. `base` = label of the normalised, padded and trimmed scene stream ([W x H], fps, duration = dur).
 * Returns { chains:[...], out:'label' }: base segments and insert segments of the same stream in time order, concatenated.
 */
function sceneInsertChains({ base, out, inserts, W, H, fps, dur }) {
  const segs = [];
  let t = 0;
  inserts.slice().sort((a, b) => a.startSec - b.startSec).forEach((ins) => {
    const s = Math.min(dur, ins.startSec);
    const e = Math.min(dur, ins.startSec + ins.durationSec);
    if (e - s < 1 / fps) return;
    if (s > t + 1e-3) segs.push({ type: 'base', a: t, b: s });
    segs.push({ type: 'insert', a: s, b: e, ins });
    t = e;
  });
  if (!segs.length) return { chains: [`[${base}]null[${out}]`], out };
  if (t < dur - 1e-3) segs.push({ type: 'base', a: t, b: dur });
  const chains = [`[${base}]split=${segs.length}${segs.map((_, i) => `[${out}_s${i}]`).join('')}`];
  const labels = [];
  segs.forEach((sg, i) => {
    const lab = `${out}_p${i}`;
    const trim = `trim=start=${sg.a.toFixed(3)}:end=${sg.b.toFixed(3)},setpts=PTS-STARTPTS`;
    if (sg.type === 'base') { chains.push(`[${out}_s${i}]${trim}[${lab}]`); labels.push(`[${lab}]`); return; }
    const ins = sg.ins;
    if (ins.transition === 'quick_zoom') {
      const zx = zoomExpr(W, H, ins.crop, fps);
      chains.push(`[${out}_s${i}]${trim},zoompan=z='${zx.z}':x='${zx.x}':y='${zx.y}':d=1:s=${W}x${H}:fps=${fps},setsar=1[${lab}]`);
    } else if (ins.transition === 'punch_in') {
      // first frames slightly over-zoomed (impact), then settle on the crop scale
      const over = clampCrop({ x: ins.crop.x, y: ins.crop.y, scale: Math.min(LIMITS.maxScale, ins.crop.scale * LIMITS.punchOvershoot) });
      const punchSec = Math.min((sg.b - sg.a) / 2, LIMITS.punchFrames / fps);
      chains.push(`[${out}_s${i}]${trim},split=2[${lab}_a][${lab}_b]`);
      chains.push(`[${lab}_a]trim=end=${punchSec.toFixed(3)},setpts=PTS-STARTPTS,${cropFilter(W, H, over)}[${lab}_c]`);
      chains.push(`[${lab}_b]trim=start=${punchSec.toFixed(3)},setpts=PTS-STARTPTS,${cropFilter(W, H, ins.crop)}[${lab}_d]`);
      chains.push(`[${lab}_c][${lab}_d]concat=n=2:v=1:a=0[${lab}]`);
    } else {
      chains.push(`[${out}_s${i}]${trim},${cropFilter(W, H, ins.crop)}[${lab}]`);
    }
    labels.push(`[${lab}]`);
  });
  chains.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[${out}]`);
  return { chains, out };
}

module.exports = { PRESETS, TRANSITIONS, LIMITS, OUT_W, clampCrop, resolutionCheck, motionNote, normalizeInserts, cutsFingerprint, insertsCore, sceneInsertChains, cropFilter };
