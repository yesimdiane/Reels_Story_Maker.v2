// Storyboard assets that are NOT the scene's script: the 0.5-second movement plan (acting timeline) and the B-roll library.
//   * motion  : ep.motion[sceneId] = { rev, beats[], source, history[] }  — beats on a 0.5 s grid inside the scene length.
//               Free template draft + manual editing; revisions are kept. The timeline text is appended to the video prompt at generation time.
//   * B-roll  : ep.broll[] — optional shots developed as separate STILL-image assets (reference or upload); they are layered during
//               video editing and never become extra paid video clips on their own. Edits send an approved item back to review.
// Nothing here calls an AI or video provider.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256, safeName } = require('./util');
const animdraft = require('./animdraft');
const { sniffImage } = require('./extract');

const STEP = 0.1; // permit precise audio-end cuts; normal motion remains 0.5s
const KINDS = ['close_up', 'reaction', 'insert', 'broll', 'product_demo', 'environment', 'transition'];
const KIND_LABEL = { close_up: '클로즈업', reaction: '리액션 컷', insert: '인서트', broll: 'B-roll' };
const FIELDS = ['character', 'emotion', 'body', 'gaze', 'expression', 'camera'];
const r1 = (n) => Math.round(n * 1000) / 1000;
const onGrid = (n) => Math.abs(n / STEP - Math.round(n / STEP)) < 1e-6;
const fmt = (n) => n.toFixed(1);


/** Pixel size from the file header (PNG / JPEG / WebP). null when it cannot be read. */
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      const t = buf.toString('latin1', 12, 16);
      if (t === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
      if (t === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  } catch (_) { /* unreadable header */ }
  return null;
}

function createStoryboardAssets({ store, dialogueTiming, lib, products }) {
  const sceneOf = (ep, sid) => {
    const s = (ep.scenes || []).find((x) => x.id === sid);
    if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sid, { status: 404 });
    return s;
  };

  // ---------------- movement beats (0.5 s grid) ----------------
  const castNames = (scene) => (scene.characters || []).map((id) => ({ id, name: ((lib().characters || []).find((c) => c.id === id) || { name: id }).name }));
  function cleanBeats(list, scene) {
    if (!Array.isArray(list)) throw new StudioError('BAD_BEATS', '비트 목록이 필요합니다.', { status: 422 });
    const dur = Number(scene.durationSec) || 0;
    const cast = castNames(scene);
    const out = [];
    const problems = [];
    list.forEach((b, i) => {
      const t0 = Number(b && b.t0); const t1 = Number(b && b.t1);
      const n = i + 1;
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return problems.push({ index: i, field: 't0', message: `비트 ${n}: 시작/끝 시간이 필요합니다.` });
      if (!onGrid(t0) || !onGrid(t1)) problems.push({ index: i, field: 't0', message: `비트 ${n}: 시간은 0.1초 단위여야 합니다 (${t0}–${t1}).` });
      if (!(t1 > t0)) problems.push({ index: i, field: 't1', message: `비트 ${n}: 끝 시간은 시작보다 커야 합니다.` });
      if (t0 < 0 || t1 > dur + 1e-6) problems.push({ index: i, field: 't1', message: `비트 ${n}: 장면 길이(${dur}초)를 벗어납니다 (${t0}–${t1}). 장면은 자동으로 늘어나지 않습니다.` });
      // character: by id (preferred) or by name; it must be in this scene's cast
      const raw = String((b && (b.characterId || b.character)) || '').trim();
      const hit = cast.find((c) => c.id === (b && b.characterId)) || cast.find((c) => c.id === raw.toLowerCase() || c.name.toLowerCase() === raw.toLowerCase());
      if (!raw) problems.push({ index: i, field: 'character', message: `비트 ${n}: 캐릭터가 필요합니다.` });
      else if (!hit) problems.push({ index: i, field: 'character', message: `비트 ${n}: 이 장면에 등장하지 않는 캐릭터입니다 (${raw}). 장면 캐릭터: ${cast.map((c) => c.name).join(', ') || '없음'}.` });
      const beat = { sceneId: scene.id, characterId: hit ? hit.id : '', character: hit ? hit.name : raw, t0: r1(t0), t1: r1(t1) };
      FIELDS.filter((k) => k !== 'character').forEach((k) => { beat[k] = String((b && b[k]) || '').trim().slice(0, 300); });
      if (!beat.emotion) problems.push({ index: i, field: 'emotion', message: `비트 ${n}: 감정을 적어 주세요.` });
      if (!beat.body && !beat.gaze && !beat.expression) problems.push({ index: i, field: 'body', message: `비트 ${n}: 몸 동작, 시선, 표정 중 하나는 필요합니다 (모든 부위를 채울 필요는 없습니다).` });
      out.push(beat);
    });
    const sorted = out.slice().sort((a, b) => a.t0 - b.t0);
    const lastEnd = {};
    sorted.forEach((x, i) => { const k = x.characterId || x.character; if (lastEnd[k] !== undefined && x.t0 < lastEnd[k].t1 - 1e-6) problems.push({ index: i, field: 't0', message: `같은 캐릭터(${x.character})의 비트가 겹칩니다 (${fmt(lastEnd[k].t0)}–${fmt(lastEnd[k].t1)} / ${fmt(x.t0)}–${fmt(x.t1)}). 서로 다른 캐릭터의 비트는 겹쳐도 됩니다.` }); if (!lastEnd[k] || x.t1 > lastEnd[k].t1) lastEnd[k] = x; });
    return { beats: sorted, problems };
  }

  /** Free, deterministic, scene-specific draft (dialogue, visual direction, action, camera cues). See animdraft.js. */
  function draftBeats(ep, sc) { return animdraft.draftBeats(ep, sc, lib().characters || []); }
  const estimateSpan = (line) => Math.max(1, String(line.en || '').trim().split(/\s+/).length / 2.7);

  /** Text appended to the video prompt: one line per beat, in time order. */
  function timelineText(beats) {
    if (!beats || !beats.length) return '';
    const lines = beats.map((b) => `${fmt(b.t0)}–${fmt(b.t1)}s: ${[b.character, b.body, b.gaze && 'eyes: ' + b.gaze, b.expression && 'face: ' + b.expression].filter(Boolean).join('; ')}; emotion: ${b.emotion}${b.camera ? '; camera: ' + b.camera : ''}.`);
    return 'ANIMATION TIMELINE (0.5-second steps; keep natural motion, pauses and holds; the approved 2D anime/webtoon character look stays unchanged):\n' + lines.join('\n');
  }
  const motionOf = (ep, sid) => (ep.motion && ep.motion[sid]) || null;
  /** What goes to the video model: the approved prompt + the movement plan (changing the plan changes this text, so spend must be re-approved). */
  function composePrompt(ep, sid, videoText) {
    const m = motionOf(ep, sid);
    const tl = m ? timelineText(m.beats) : '';
    return tl ? `${String(videoText || '').trim()}\n\n${tl}` : String(videoText || '');
  }

  async function saveMotion(id, sceneId, { beats, source = 'manual' } = {}, by = 'operator') {
    const ep0 = store.episodes.get(id);
    const sc = sceneOf(ep0, sceneId);
    const { beats: clean, problems } = cleanBeats(beats, sc);
    if (problems.length) throw new StudioError('INVALID_MOTION', problems[0].message, { status: 422, details: problems });
    await store.episodes.update(id, (ep) => {
      ep.motion = ep.motion || {};
      const prev = ep.motion[sceneId];
      const history = prev ? (prev.history || []).concat([{ rev: prev.rev, beats: prev.beats, source: prev.source, at: prev.at, by: prev.by }]).slice(-20) : [];
      ep.motion[sceneId] = { rev: (prev ? prev.rev : 0) + 1, beats: clean, source, at: nowIso(), by, history };
    });
    store.episodes.audit(id, 'motion.saved', { sceneId, by, source });
    return store.episodes.get(id).motion[sceneId];
  }
  async function draftMotion(id, sceneId, by = 'operator') {
    const ep = store.episodes.get(id);
    const sc = sceneOf(ep, sceneId);
    return saveMotion(id, sceneId, { beats: draftBeats(ep, sc), source: 'template' }, by);
  }

  // ---------------- B-roll library ----------------
  const brollOf = (ep) => (ep.broll || []);
  function cleanBroll(raw, ep, prev) {
    const sc = sceneOf(ep, String(raw.sceneId || (prev && prev.sceneId) || ''));
    const kind = KINDS.includes(raw.kind) ? raw.kind : (prev && prev.kind) || 'broll';
    const at = raw.insertAtSec != null ? Number(raw.insertAtSec) : prev ? prev.insertAtSec : 0;
    const dur = raw.durationSec != null ? Number(raw.durationSec) : prev ? prev.durationSec : 1;
    const problems = [];
    if (!Number.isFinite(at) || at < 0) problems.push('삽입 위치는 0초 이상이어야 합니다.');
    if (!(dur >= 0.5)) problems.push('길이는 0.5초 이상이어야 합니다.');
    if (Number.isFinite(at) && Number.isFinite(dur) && at + dur > Number(sc.durationSec) + 1e-6) problems.push(`위치+길이(${r1(at + dur)}초)가 장면 길이(${sc.durationSec}초)를 넘습니다. 장면은 자동으로 늘어나지 않습니다.`);
    const others = brollOf(ep).filter((b) => b.status !== 'removed' && b.sceneId === sc.id && (!prev || b.id !== prev.id));
    if (others.some((b) => at < b.insertAtSec + b.durationSec - 1e-6 && b.insertAtSec < at + dur - 1e-6)) problems.push('같은 장면의 다른 B-roll과 시간이 겹칩니다.');
    if (problems.length) throw new StudioError('INVALID_BROLL', problems[0], { status: 422, details: problems });
    return { sceneId: sc.id, kind, insertAtSec: r1(at), durationSec: r1(dur), effect: String(raw.effect != null ? raw.effect : (prev && prev.effect) || '').slice(0, 200), note: String(raw.note != null ? raw.note : (prev && prev.note) || '').slice(0, 300), imageRef: raw.imageRef !== undefined ? cleanRef(raw.imageRef, ep) : (prev && prev.imageRef) || null };
  }
  function cleanRef(ref, ep) {
    if (!ref) return null;
    if (ref.type === 'product') return { type: 'product', imageId: String(ref.imageId || '').slice(0, 80) };
    if (ref.type === 'scene_start') { sceneOf(ep, String(ref.sceneId)); return { type: 'scene_start', sceneId: String(ref.sceneId) }; }
    if (ref.type === 'upload') return { type: 'upload', file: String(ref.file || ''), sha256: String(ref.sha256 || '') };
    throw new StudioError('BAD_REF', '알 수 없는 이미지 참조입니다.', { status: 422 });
  }
  const nextBrollId = (ep) => 'BR' + (brollOf(ep).reduce((m, b) => Math.max(m, Number((/^BR(\d+)/.exec(b.id) || [0, 0])[1])), 0) + 1);
  /** Stable id of the image that was approved: B-roll id + content hash (or the product/frame it points at). */
  const assetIdOf = (b) => { const r = b.imageRef || {}; return r.type === 'upload' ? `${b.id}:${String(r.sha256 || '').slice(0, 12)}` : r.type === 'product' ? `product:${r.imageId}` : r.type === 'scene_start' ? `startframe:${r.sceneId}` : ''; };
  /**
   * Is the B-roll image REALLY usable? Decided from the file, never from the asset id alone:
   *   none → no image yet · missing → the reference points at nothing / the file is gone · inaccessible → exists but unreadable or not an image · ready
   */
  function assetHealth(ep, b) {
    const r = b.imageRef;
    if (!r) return { state: 'none', problem: '' };
    const file = brollFile(ep, b);
    if (!file) return { state: 'missing', problem: r.type === 'scene_start' ? `${r.sceneId}에 사용할 시작 프레임 파일이 없습니다.` : r.type === 'product' ? '참조한 제품 이미지를 찾을 수 없습니다.' : 'B-roll 이미지 파일 경로를 찾을 수 없습니다.' };
    let buf;
    try { fs.accessSync(file, fs.constants.R_OK); buf = fs.readFileSync(file); } catch (e) { return { state: e && e.code === 'ENOENT' ? 'missing' : 'inaccessible', problem: e && e.code === 'ENOENT' ? '저장된 이미지 파일이 서버에 없습니다.' : '이미지 파일을 읽을 수 없습니다 (권한 또는 경로).' }; }
    if (!buf.length || !sniffImage(buf)) return { state: 'inaccessible', problem: '저장된 파일이 올바른 이미지가 아닙니다 (비었거나 손상).' };
    if (r.type === 'upload' && r.sha256 && sha256(buf) !== r.sha256) return { state: 'inaccessible', problem: '이미지 파일이 저장된 체크섬과 다릅니다 (변경 또는 손상).' };
    const size = imageSize(buf) || {};
    return { state: 'ready', problem: '', bytes: buf.length, mime: sniffImage(buf).mime, width: size.width || null, height: size.height || null, v: String(r.sha256 || sha256(buf)).slice(0, 12) };
  }
  const assetStatus = (b, ep) => (ep ? (assetHealth(ep, b).state === 'ready' ? 'ready' : 'needed') : b.imageRef ? 'ready' : 'needed');

  async function saveBroll(id, raw, by = 'operator') {
    let out;
    await store.episodes.update(id, (ep) => {
      ep.broll = ep.broll || [];
      const prev = raw.id ? ep.broll.find((b) => b.id === raw.id) : null;
      if (raw.id && !prev) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + raw.id, { status: 404 });
      const c = cleanBroll(raw, ep, prev);
      if (prev) {
        prev.history = (prev.history || []).concat([{ rev: prev.rev, insertAtSec: prev.insertAtSec, durationSec: prev.durationSec, imageRef: prev.imageRef, status: prev.status, at: prev.updatedAt }]).slice(-20);
        Object.assign(prev, c, { rev: prev.rev + 1, updatedAt: nowIso() });
        if (prev.status === 'approved' || prev.status === 'removed') prev.status = prev.status === 'removed' ? 'removed' : 'proposed'; // an edit sends approved work back to review
        prev.asset = assetStatus(prev);
        out = prev;
      } else {
        out = Object.assign({ id: nextBrollId(ep), rev: 1, status: 'proposed', origin: raw.origin || 'manual', history: [], createdAt: nowIso(), updatedAt: nowIso(), by }, c);
        out.asset = assetStatus(out);
        ep.broll.push(out);
      }
    });
    store.episodes.audit(id, 'broll.saved', { by, id: out.id });
    return out;
  }
  /** Planning order of one scene's B-cut concepts (ids of that scene only); the records themselves are untouched. */
  async function reorderBroll(id, sceneId, ids, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      sceneOf(ep, sceneId);
      const all = brollOf(ep);
      const mine = all.filter((b) => b.sceneId === sceneId && b.status !== 'removed');
      const want = (ids || []).map(String);
      if (want.length !== mine.length || !mine.every((b) => want.includes(b.id))) throw new StudioError('BAD_ORDER', '이 장면의 B컷 목록과 순서가 맞지 않습니다.', { status: 422 });
      const slots = all.map((b, i) => (b.sceneId === sceneId && b.status !== 'removed' ? i : -1)).filter((i) => i >= 0);
      const byId = new Map(mine.map((b) => [b.id, b]));
      slots.forEach((slot, k) => { all[slot] = byId.get(want[k]); });
    });
    store.episodes.audit(id, 'broll.reordered', { sceneId, by });
  }
  /** A copy of a concept (kind, note, effect, length) in the first free time slot; the image/approval are NOT copied — it is a new proposal. */
  async function duplicateBroll(id, bid, by = 'operator') {
    const ep0 = store.episodes.get(id);
    const src = brollOf(ep0).find((b) => b.id === bid && b.status !== 'removed');
    if (!src) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
    const sc = sceneOf(ep0, src.sceneId);
    const taken = brollOf(ep0).filter((b) => b.status !== 'removed' && b.sceneId === src.sceneId).sort((a, b) => a.insertAtSec - b.insertAtSec);
    let at = 0;
    for (let guard = 0; guard < 40; guard++) {
      const hit = taken.find((b) => at < b.insertAtSec + b.durationSec - 1e-6 && b.insertAtSec < at + src.durationSec - 1e-6);
      if (!hit) break;
      at = r1(hit.insertAtSec + hit.durationSec);
    }
    if (at + src.durationSec > Number(sc.durationSec) + 1e-6) throw new StudioError('NO_ROOM', '장면 안에 같은 길이의 빈 구간이 없어 복제할 수 없습니다.', { status: 422, recovery: '길이를 줄이거나 다른 B컷의 시간을 옮긴 뒤 다시 복제하세요.' });
    return saveBroll(id, { sceneId: src.sceneId, kind: src.kind, insertAtSec: at, durationSec: src.durationSec, effect: src.effect, note: (src.note ? src.note + ' ' : '') + '(복제)', origin: 'duplicate' }, by);
  }
  async function setBrollStatus(id, bid, status, by = 'operator') {
    if (!['approved', 'proposed', 'rejected'].includes(status)) throw new StudioError('BAD_STATUS', '알 수 없는 상태입니다.', { status: 422 });
    let out;
    await store.episodes.update(id, (ep) => {
      const b = brollOf(ep).find((x) => x.id === bid);
      if (!b || b.status === 'removed') throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
      if (status === 'approved' && b.imageRef) { const hh = assetHealth(ep, b); if (hh.state !== 'ready') throw new StudioError('IMAGE_NOT_ACCESSIBLE', `이미지를 사용할 수 없어 승인할 수 없습니다: ${hh.problem}`, { status: 409, recovery: 'AI 이미지 생성 또는 이미지 올리기로 이미지를 다시 저장한 뒤 승인하세요.' }); }
      if (status === 'approved' && !b.imageRef) throw new StudioError('IMAGE_NEEDED', '승인하려면 먼저 이미지가 필요합니다 (참조 선택 또는 업로드).', { status: 409 });
      b.status = status; b.statusBy = by; b.statusAt = nowIso();
      if (status === 'approved') b.approvedAssetId = assetIdOf(b); else delete b.approvedAssetId;
      out = b;
    });
    store.episodes.audit(id, 'broll.' + status, { by, id: bid });
    return out;
  }
  /** Soft removal: the entry stays (history, uploaded image) but leaves the library and the render. */
  async function removeBroll(id, bid, by = 'operator') {
    await store.episodes.update(id, (ep) => {
      const b = brollOf(ep).find((x) => x.id === bid);
      if (!b) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
      b.status = 'removed'; b.removedAt = nowIso(); b.removedBy = by;
    });
    store.episodes.audit(id, 'broll.removed', { by, id: bid });
    return { id: bid, removed: true };
  }
  async function uploadBrollImage(id, bid, buffer, filename, by = 'operator') {
    const ext = path.extname(filename || '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new StudioError('BAD_TYPE', 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.');
    if (buffer.length > 10 * 1024 * 1024) throw new StudioError('TOO_LARGE', '10 MB 이하 이미지만 가능합니다.');
    const hash = sha256(buffer);
    const file = hash.slice(0, 12) + ext;
    store.episodes.saveFile(id, path.join('broll', file), buffer);
    return saveBroll(id, { id: bid, imageRef: { type: 'upload', file, sha256: hash } }, by);
  }
  /** Free, deterministic proposals (close-up on the first line, a reaction after the last one, an insert for product scenes). Never duplicates; never calls an AI. */
  async function suggestBroll(id, by = 'operator') {
    const ep0 = store.episodes.get(id);
    const made = [];
    for (const sc of ep0.scenes || []) {
      const have = (kind) => brollOf(store.episodes.get(id)).some((b) => b.sceneId === sc.id && b.kind === kind && b.status !== 'removed');
      const dur = Number(sc.durationSec) || 0;
      const lines = (ep0.lines || []).filter((l) => l.sceneId === sc.id);
      const add = async (kind, at, d, effect, note) => { if (have(kind) || at + d > dur + 1e-6 || d < STEP) return; try { made.push(await saveBroll(id, { sceneId: sc.id, kind, insertAtSec: at, durationSec: d, effect, note, origin: 'suggested' }, by)); } catch (_) { /* overlapping suggestion: skipped */ } };
      if (lines.length && dur >= 3) await add('reaction', r1(Math.max(0, dur - 1.5)), 1, 'quick cut to the listener\'s face', '말이 끝난 뒤 상대 반응');
      if (sc.showsProduct && dur >= 3) await add('insert', 0.5, 1, 'product close-up', '제품 클로즈업');
      if (lines.length > 1 && dur >= 5) await add('close_up', 1, 1, 'punch-in on the speaker\'s face', '핵심 대사 클로즈업');
    }
    return made;
  }
  /** Approved B-roll that a render should layer (ordered by scene then time). The renderer decides how; this only reports what is approved and complete. */
  function approvedBroll(ep) {
    return brollOf(ep).filter((b) => b.status === 'approved' && b.imageRef).sort((a, b) => String(a.sceneId).localeCompare(String(b.sceneId)) || a.insertAtSec - b.insertAtSec);
  }
  /** One URL for every kind of reference; the server resolves it through brollFile(). Only handed out when the file is really there. */
  function imageUrl(ep, b, health) {
    const hh = health || assetHealth(ep, b);
    return hh.state === 'ready' ? `/media/broll/${ep.id}/${b.id}?v=${hh.v}` : '';
  }
  /** Absolute path of a B-roll still image, or '' when it cannot be used as an overlay (e.g. a character reference sheet). */
  function brollFile(ep, b) {
    const r = b.imageRef;
    if (!r) return '';
    try {
      if (r.type === 'upload') return store.episodes.file(ep.id, path.join('broll', r.file));
      if (r.type === 'product') return products ? products.mediaFile(ep.productId, r.imageId) : '';
      if (r.type === 'scene_start') { const sc = (ep.scenes || []).find((x) => x.id === r.sceneId); return sc && sc.startImage && sc.startImage.type === 'upload' ? store.episodes.file(ep.id, path.join('startframes', sc.startImage.file)) : ''; }
    } catch (_) { return ''; }
    return '';
  }
  const brollView = (ep) => brollOf(ep).filter((b) => b.status !== 'removed').map((b) => {
    const hh = assetHealth(ep, b);
    const gen = b.imageGen || {};
    return Object.assign({}, b, {
      asset: hh.state === 'ready' ? 'ready' : 'needed', kindLabel: KIND_LABEL[b.kind], imageUrl: imageUrl(ep, b, hh), assetId: assetIdOf(b),
      imageState: gen.lastError && hh.state === 'none' ? 'failed' : hh.state, imageProblem: hh.problem, imageInfo: hh.state === 'ready' ? { width: hh.width, height: hh.height, bytes: hh.bytes, mime: hh.mime } : null,
      needsAttention: (b.status === 'approved' && hh.state !== 'ready') || hh.state === 'inaccessible',
      imageGenerated: !!b.generated, imageError: gen.lastError || null, promptEdited: !!gen.prompt, imagePrompt: gen.prompt || '',
    });
  });

  return { STEP, KINDS, assetHealth, cleanBeats, draftBeats, timelineText, composePrompt, motionOf, saveMotion, draftMotion, saveBroll, reorderBroll, duplicateBroll, setBrollStatus, removeBroll, uploadBrollImage, suggestBroll, approvedBroll, brollView, brollFile };
}

module.exports = { createStoryboardAssets, STEP, KINDS };
