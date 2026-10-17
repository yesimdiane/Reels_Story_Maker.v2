// Sound effects for a scene. Three sources, none of them "generates" anything with an AI:
//   upload   : the user's own file
//   builtin  : tiny synthesized sounds made locally with FFmpeg (free, deterministic): whoosh, pop, click, ding, thud, snap, sparkle
//   heygen   : search HeyGen's sound-effects CATALOG (GET /v3/audio/sounds?type=sound_effects&query=…). It is a search over existing sounds,
//              not text-to-sound generation. Credit use and licence terms are HeyGen's — verify them in your HeyGen account before commercial use.
// An entry is { id, sceneId, label, source, file, offsetSec, gainDb, sha256, durationSec?, heygenId? }; offsetSec is relative to the start of the scene
// (the absolute time is resolved at render time from the real audio timeline), so effects follow their scene when dialogue timing changes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StudioError, sha256, safeName } = require('./util');
const { run } = require('../../renderer/lib/ffmpeg');

const EXT = ['.wav', '.mp3', '.m4a', '.ogg'];
const MAX_BYTES = 5 * 1024 * 1024;
const HEYGEN_SOUNDS = 'https://api.heygen.com/v3/audio/sounds';

/** name → [label, ffmpeg args producing a short mono wav] */
const BUILTIN = {
  whoosh: ['휙 (whoosh)', ['-f', 'lavfi', '-i', 'anoisesrc=d=0.7:c=pink:a=0.6', '-af', 'highpass=f=300,lowpass=f=3200,afade=t=in:d=0.25,afade=t=out:st=0.3:d=0.4']],
  pop: ['뽕 (pop)', ['-f', 'lavfi', '-i', 'sine=f=700:d=0.14', '-af', 'afade=t=out:st=0.02:d=0.12,volume=0.9']],
  click: ['딸깍 (click)', ['-f', 'lavfi', '-i', 'sine=f=2400:d=0.05', '-af', 'afade=t=out:st=0.005:d=0.045']],
  ding: ['딩 (ding)', ['-f', 'lavfi', '-i', 'sine=f=1320:d=0.9', '-f', 'lavfi', '-i', 'sine=f=1980:d=0.9', '-filter_complex', 'amix=inputs=2:normalize=0,afade=t=out:st=0.05:d=0.85']],
  thud: ['쿵 (thud)', ['-f', 'lavfi', '-i', 'sine=f=70:d=0.32', '-af', 'afade=t=out:st=0.03:d=0.29,volume=1.3']],
  snap: ['찰칵 (snap)', ['-f', 'lavfi', '-i', 'sine=f=1800:d=0.06', '-f', 'lavfi', '-i', 'sine=f=90:d=0.2', '-filter_complex', 'amix=inputs=2:normalize=0,afade=t=out:st=0.02:d=0.18']],
  sparkle: ['반짝 (sparkle)', ['-f', 'lavfi', '-i', 'sine=f=2600:d=0.6', '-af', 'tremolo=f=18:d=0.7,afade=t=out:st=0.1:d=0.5']],
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function createSfx({ store, cfg, fetchFn = fetch, heygenKey = () => '', sceneExists, log = () => {} }) {
  const cache = new Map(); // HeyGen search results by id (short-lived): a download URL always comes from HeyGen's own response, never from the client
  const dirOf = (epId) => store.episodes.file(epId, 'sfx');
  const newId = () => 'fx_' + crypto.randomBytes(4).toString('hex');

  function assertScene(ep, sceneId) {
    if (sceneId && !(ep.scenes || []).some((s) => s.id === sceneId)) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + sceneId, { status: 404 });
  }
  async function addEntry(epId, base) {
    let out;
    await store.episodes.update(epId, (ep) => {
      assertScene(ep, base.sceneId);
      ep.sfx = ep.sfx || [];
      out = Object.assign({ id: newId(), sceneId: '', label: '', source: 'upload', file: '', offsetSec: 0, atSec: 0, gainDb: -6 }, base);
      ep.sfx.push(out);
    });
    store.episodes.audit(epId, 'sfx.added', { id: out.id, sceneId: out.sceneId, source: out.source });
    return out;
  }

  async function addUpload(epId, { buffer, filename, label, sceneId, offsetSec = 0 }) {
    const ext = path.extname(filename || '').toLowerCase();
    if (!EXT.includes(ext)) throw new StudioError('BAD_TYPE', 'WAV, MP3, M4A, OGG 오디오만 올릴 수 있습니다.');
    if (!buffer || !buffer.length) throw new StudioError('EMPTY_FILE', '빈 파일입니다.');
    if (buffer.length > MAX_BYTES) throw new StudioError('TOO_LARGE', '효과음은 5 MB 이하여야 합니다.');
    const hash = sha256(buffer).slice(0, 12);
    store.episodes.saveFile(epId, path.join('sfx', hash + ext), buffer);
    return addEntry(epId, { sceneId: sceneId || '', label: String(label || safeName(filename)).slice(0, 80), source: 'upload', file: path.join('sfx', hash + ext), offsetSec: Math.max(0, num(offsetSec, 0)), sha256: hash });
  }

  async function addBuiltin(epId, { name, sceneId, offsetSec = 0 }) {
    const def = BUILTIN[name];
    if (!def) throw new StudioError('BAD_SFX', `알 수 없는 기본 효과음입니다: ${name}`, { status: 400 });
    const rel = path.join('sfx', `builtin-${name}.wav`);
    const abs = store.episodes.file(epId, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) await run(cfg.ffmpeg.ffmpeg, ['-hide_banner', '-y', ...def[1], '-ac', '1', '-ar', '48000', abs]);
    const hash = sha256(fs.readFileSync(abs)).slice(0, 12);
    return addEntry(epId, { sceneId: sceneId || '', label: def[0], source: 'builtin', file: rel, offsetSec: Math.max(0, num(offsetSec, 0)), sha256: hash });
  }

  async function searchHeygen(query, { limit = 12 } = {}) {
    const key = heygenKey();
    if (!key) throw new StudioError('NOT_CONNECTED', 'HeyGen API 키가 없습니다.', { status: 409, recovery: 'Settings → 음성 연결에서 HeyGen 키를 저장하세요.' });
    const q = String(query || '').trim();
    if (q.length < 2) throw new StudioError('BAD_QUERY', '검색어를 2자 이상 입력하세요.', { status: 400 });
    let res;
    try { res = await fetchFn(`${HEYGEN_SOUNDS}?type=sound_effects&query=${encodeURIComponent(q)}&limit=${Math.min(25, Math.max(1, limit))}`, { headers: { 'X-Api-Key': key, accept: 'application/json' } }); } catch (e) { throw new StudioError('HEYGEN_UNREACHABLE', 'HeyGen에 연결하지 못했습니다.', { status: 502, recovery: '잠시 후 다시 시도하세요 (자동으로 다시 시도하지 않습니다).' }); }
    if (res.status === 401 || res.status === 403) throw new StudioError('HEYGEN_AUTH', 'HeyGen API 키가 거부되었습니다.', { status: 502, recovery: 'Settings → 음성 연결에서 키를 확인하세요.' });
    if (res.status === 429) throw new StudioError('HEYGEN_RATE_LIMIT', 'HeyGen 요청 한도에 걸렸습니다.', { status: 429, recovery: '잠시 후 직접 다시 시도하세요.' });
    if (!res.ok) throw new StudioError('HEYGEN_ERROR', `HeyGen 오류 (HTTP ${res.status}).`, { status: 502 });
    const body = await res.json();
    const items = (body && (body.data || body.sounds || body.results)) || [];
    const out = items.filter((x) => x && (x.id || x.sound_id) && (x.audio_url || x.url)).map((x) => ({ id: String(x.id || x.sound_id), name: String(x.name || x.title || x.description || '효과음').slice(0, 80), description: String(x.description || '').slice(0, 160), audioUrl: String(x.audio_url || x.url), durationSec: num(x.duration, null), score: num(x.score, null) }));
    out.forEach((x) => cache.set(x.id, { url: x.audioUrl, name: x.name, durationSec: x.durationSec, at: Date.now() }));
    for (const [k, v] of cache) if (Date.now() - v.at > 10 * 60 * 1000) cache.delete(k);
    return { query: q, results: out.map((x) => ({ id: x.id, name: x.name, description: x.description, durationSec: x.durationSec, score: x.score, previewUrl: x.audioUrl })), note: 'HeyGen 효과음 카탈로그 검색 결과입니다 (새로 생성하는 것이 아닙니다). 크레딧·라이선스는 HeyGen 계정 기준으로 확인하세요.' };
  }

  /** Downloads one sound found by searchHeygen (by id; the URL is looked up server-side) into the episode. */
  async function addHeygen(epId, { soundId, sceneId, offsetSec = 0 }) {
    const hit = cache.get(String(soundId));
    if (!hit) throw new StudioError('SFX_NOT_FOUND', '먼저 효과음을 검색하세요 (검색 결과가 만료되었거나 없는 ID입니다).', { status: 409 });
    let u;
    try { u = new URL(hit.url); } catch (_) { throw new StudioError('BAD_URL', '효과음 주소가 올바르지 않습니다.', { status: 502 }); }
    if (u.protocol !== 'https:') throw new StudioError('BAD_URL', 'https 주소만 받을 수 있습니다.', { status: 502 });
    let res;
    try { res = await fetchFn(u.toString()); } catch (_) { throw new StudioError('HEYGEN_UNREACHABLE', '효과음 파일을 받지 못했습니다.', { status: 502, recovery: '직접 다시 시도하세요 (자동으로 다시 시도하지 않습니다).' }); }
    if (!res.ok) throw new StudioError('HEYGEN_ERROR', `효과음 파일을 받지 못했습니다 (HTTP ${res.status}).`, { status: 502 });
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) throw new StudioError('TOO_LARGE', '효과음 파일이 비었거나 5 MB를 넘습니다.', { status: 502 });
    const ext = path.extname(u.pathname).toLowerCase();
    const useExt = EXT.includes(ext) ? ext : (/RIFF/.test(buffer.toString('latin1', 0, 4)) ? '.wav' : buffer[0] === 0x49 && buffer[1] === 0x44 ? '.mp3' : '.mp3');
    const hash = sha256(buffer).slice(0, 12);
    store.episodes.saveFile(epId, path.join('sfx', hash + useExt), buffer);
    return addEntry(epId, { sceneId: sceneId || '', label: hit.name, source: 'heygen', heygenId: String(soundId), file: path.join('sfx', hash + useExt), offsetSec: Math.max(0, num(offsetSec, 0)), sha256: hash, durationSec: hit.durationSec });
  }

  async function update(epId, sfxId, patch) {
    let out;
    await store.episodes.update(epId, (ep) => {
      const s = (ep.sfx || []).find((x) => x.id === sfxId);
      if (!s) throw new StudioError('NOT_FOUND', '효과음을 찾을 수 없습니다.', { status: 404 });
      if (patch.offsetSec !== undefined) s.offsetSec = Math.max(0, num(patch.offsetSec, s.offsetSec || 0));
      if (patch.atSec !== undefined) s.atSec = Math.max(0, num(patch.atSec, s.atSec || 0));
      if (patch.gainDb !== undefined) s.gainDb = Math.min(6, Math.max(-30, num(patch.gainDb, s.gainDb)));
      if (patch.fadeInSec !== undefined) s.fadeInSec = Math.min(2, Math.max(0, num(patch.fadeInSec, 0)));
      if (patch.fadeOutSec !== undefined) s.fadeOutSec = Math.min(2, Math.max(0, num(patch.fadeOutSec, 0)));
      if (patch.label !== undefined) s.label = String(patch.label).slice(0, 80);
      if (patch.sceneId !== undefined) { assertScene(ep, patch.sceneId); s.sceneId = patch.sceneId; }
      if (patch.remove) ep.sfx = ep.sfx.filter((x) => x.id !== sfxId);
      out = s;
    });
    store.episodes.audit(epId, patch.remove ? 'sfx.removed' : 'sfx.updated', { id: sfxId });
    return out;
  }

  return { addUpload, addBuiltin, searchHeygen, addHeygen, update, BUILTIN: Object.fromEntries(Object.entries(BUILTIN).map(([k, v]) => [k, v[0]])) };
}

module.exports = { createSfx, BUILTIN, EXT, MAX_BYTES };
