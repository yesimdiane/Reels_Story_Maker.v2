// Multi-character English dialogue → per-character voices → cached audio per line.
//   * one HeyGen voice per character (Characters → voice settings); identity IDs are stored separately and are
//     NOT used as voice IDs
//   * language "en" for the speech request; the Korean subtitle is a separate field and is never spoken
//   * every line is cached per character (studio cache dir / voice / <character>); unchanged lines are never re-bought
//   * live synthesis needs: approved script, a *verified* voice ID for every speaker, the operator's confirmation
//     of the exact billable character count, and the character limits from the existing TTS budget
//   * the existing Korean narration path (renderer/lib/tts, provider heygen/google) is untouched
//   * lip-sync is not offered: it is not confirmed for the selected video models
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, sha256, nowIso } = require('./util');
const { isScriptApproved, scriptFingerprint } = require('./episode');
const { createTtsService, BudgetError } = require('../../renderer/lib/tts');
const { createHeyGenTts } = require('../../renderer/lib/tts/heygen');
const { createMockSpeech } = require('./providers/mock-speech');
const { findVoice } = require('./providers/heygen-voices');
const { createMuapiTts } = require('./providers/muapi-tts');
const { parseWav } = require('../../renderer/lib/wav');

function createVoiceService({ store, cfg, fetchFn = globalThis.fetch, speechProvider = null, runtime = null, voices = null }) {
  // Mode and key are resolved at call time (Settings can switch them without a restart). Live needs BOTH the request and a key.
  const modeNow = () => (runtime ? runtime.voiceMode() : cfg.studioMode);
  const keyNow = () => (runtime ? runtime.heygenKey() : cfg.heygenApiKey);
  const mock = createMockSpeech();
  const provider = () => speechProvider || (modeNow() === 'live' ? createHeyGenTts({ apiKey: keyNow(), ffmpeg: cfg.ffmpeg.ffmpeg, fetchFn }) : mock);
  // Each character speaks with the provider/voice saved in the Character Library (HeyGen or Google Cloud TTS); never another character's voice.
  const providerOf = (char) => (char.voice && ['google', 'muapi'].includes(char.voice.provider) ? char.voice.provider : 'heygen');
  const voiceIdOf = (char) => (providerOf(char) === 'google' ? (char.voice.googleVoiceName || '') : providerOf(char) === 'muapi' ? (char.voice.muapiVoiceId || '') : (char.voice.heygenVoiceId || ''));
  // MuAPI TTS is paid whenever MuAPI itself is in live mode (its own switch, independent of HeyGen/Google). Mock otherwise.
  const muapiLive = () => !!(runtime && runtime.muapiMode && runtime.muapiMode() === 'live');
  const isLive = (char) => (providerOf(char) === 'muapi' ? muapiLive() : modeNow() === 'live');
  const speechFor = (char) => {
    if (speechProvider) return speechProvider;
    if (providerOf(char) === 'google') return modeNow() === 'live' && voices ? voices.googleSpeech() : mock;
    if (providerOf(char) === 'muapi') return muapiLive() && store.settings.get().muapiTtsConfirmed ? createMuapiTts({ apiKey: runtime.muapiKey(), fetchFn, ffmpeg: cfg.ffmpeg.ffmpeg }) : mock;
    return provider();
  };

  // per-scene voice settings (Voice Studio): speaking rate override + a 'variant' counter that forces a genuinely new take on regeneration
  const sceneVoice = (ep, sceneId) => ((ep.voiceScene || {})[sceneId]) || null;
  const rateOf = (char, ov) => (ov && Number(ov.rate)) || Number(char.voice.speed) || 1;

  function ttsFor(char, ov) {
    const v = char.voice;
    return createTtsService({
      provider: speechFor(char),
      voice: voiceIdOf(char) || 'unset',
      language: providerOf(char) === 'google' ? (v.googleVoiceLanguage || 'en-US') : (v.language || 'en'),
      speakingRate: rateOf(char, ov),
      cacheDir: store.cachePath('voice', char.id),
      ledgerFile: store.path('voice-usage.json'),
      maxCharsPerJob: cfg.maxCharsPerJob,
      monthlyCharLimit: cfg.monthlyCharLimit,
    });
  }

  const lineKey = (char, line, ov) => { const base = [speechFor(char).name, voiceIdOf(char), char.voice.speed, providerOf(char) === 'google' ? char.voice.googleVoiceLanguage : char.voice.language, line.en]; return sha256(JSON.stringify(ov && (ov.rate || ov.variant) ? base.concat([[Number(ov.rate) || null, ov.variant || 0]]) : base)); };

  /** Is the stored audio for `line` current (text, speaker voice and provider unchanged, file present)? */
  function lineAudio(ep, line) {
    const e = ep.voice && ep.voice.lines && ep.voice.lines[line.id];
    if (!e) return { valid: false };
    let char;
    try {
      char = store.characters.get(line.speaker);
    } catch {
      return { valid: false };
    }
    const file = path.join(store.dir, e.file);
    const valid = e.key === lineKey(char, line, sceneVoice(ep, line.sceneId)) && fs.existsSync(file);
    return Object.assign({ valid, file }, valid ? { durationSec: e.durationSec, mock: e.mock } : {});
  }

  function blockersFor(ep, chars) {
    const b = [];
    if (!isScriptApproved(ep)) b.push({ code: 'SCRIPT_NOT_APPROVED', message: '대본이 승인되지 않았거나 승인 후 수정되었습니다.', recovery: 'Script Studio에서 대본을 승인하세요.' });
    chars.forEach((c) => {
      if (providerOf(c) === 'muapi') {
        if (!muapiLive()) return;
        if (!c.voice.muapiVoiceId) b.push({ code: 'NO_VOICE_ID', message: `${c.name}: MuAPI ElevenLabs voice_id가 없습니다.`, recovery: '캐릭터 라이브러리 → 음성에서 voice_id를 입력하세요.' });
        if (!store.settings.get().muapiTtsConfirmed) b.push({ code: 'TTS_UNVERIFIED', message: `${c.name}: MuAPI TTS 엔드포인트가 아직 확인되지 않았습니다.`, recovery: 'MuAPI 플레이그라운드(elevenlabs-tts-turbo-2-5)에서 경로와 파라미터를 확인한 뒤 Settings → 음성 연결에서 "확인함"을 누르세요.' });
        return;
      }
      if (modeNow() !== 'live') return;
      if (providerOf(c) === 'google') {
        const st = voices ? voices.status(c) : { ready: false, state: 'not_connected', message: 'Google Cloud TTS를 사용할 수 없습니다.' };
        if (!st.ready) b.push({ code: st.state === 'missing' ? 'NO_VOICE_ID' : st.state === 'unavailable' ? 'VOICE_UNAVAILABLE' : 'NOT_CONNECTED', message: st.message, recovery: st.state === 'not_connected' || st.state === 'unsynced' ? 'Settings → 음성 연결에서 Google Cloud를 연결·동기화하세요.' : '캐릭터 라이브러리에서 목소리를 지정하거나 바꾸세요. 다른 캐릭터의 목소리로 대체하지 않습니다.' });
        return;
      }
      if (!c.voice.heygenVoiceId) b.push({ code: 'NO_VOICE_ID', message: `${c.name}: HeyGen Voice ID가 없습니다.` + (c.voice.heygenIdentityId ? ' (Identity ID는 Voice ID가 아닙니다.)' : ''), recovery: 'Settings → 음성 연결에서 HeyGen을 연결하고 캐릭터 라이브러리에서 목소리를 고르세요.' });
      else if (!c.voice.verified) b.push({ code: 'VOICE_UNVERIFIED', message: `${c.name}: Voice ID가 HeyGen 목록에서 확인되지 않았습니다.`, recovery: '캐릭터 라이브러리에서 동기화된 목록의 목소리를 고르거나 "음성 확인"을 누르세요.' });
      else if (voices && voices.status(c).state === 'unavailable') b.push({ code: 'VOICE_UNAVAILABLE', message: voices.status(c).message, recovery: '캐릭터 라이브러리에서 목소리를 바꾸세요.' });
    });
    if (modeNow() === 'live' && chars.some((c) => providerOf(c) === 'heygen') && !keyNow()) b.push({ code: 'NO_KEY', message: 'HeyGen API 키가 없습니다.', recovery: 'Settings → 음성 연결에서 HeyGen을 연결하세요.' });
    return b;
  }

  /** Free, no network. */
  function estimate(epId, { sceneIds } = {}) {
    const ep0 = store.episodes.get(epId);
    const ep = ep0; // approvals are checked against the whole episode; only the lines to speak are filtered
    const wanted = ep0.lines.filter((l) => !sceneIds || !sceneIds.length || sceneIds.includes(l.sceneId));
    const lib = store.characters.load();
    const settings = store.settings.get();
    const speakers = [...new Set(wanted.map((l) => l.speaker))];
    const chars = speakers.map((id) => lib.characters.find((c) => c.id === id)).filter(Boolean);
    const lines = wanted.map((l) => {
      const c = chars.find((x) => x.id === l.speaker);
      const a = c ? lineAudio(ep, l) : { valid: false };
      return { lineId: l.id, speaker: l.speaker, chars: [...l.en].length, cached: a.valid, durationSec: a.valid ? a.durationSec : null };
    });
    const liveSpeaker = (id) => { const c = chars.find((x) => x.id === id); return !!c && isLive(c); };
    const billableChars = lines.filter((l) => !l.cached && liveSpeaker(l.speaker)).reduce((n, l) => n + l.chars, 0);
    const anyLive = chars.some(isLive);
    const rate = settings.voiceUsdPer1kChars;
    const usd = anyLive ? (rate != null && rate !== '' ? Math.round((billableChars / 1000) * Number(rate) * 1e6) / 1e6 : null) : 0;
    const blockers = blockersFor(ep, chars);
    if (anyLive && billableChars > cfg.maxCharsPerJob) blockers.push({ code: 'TOO_MANY_CHARS', message: `글자 수 ${billableChars}가 작업당 한도 ${cfg.maxCharsPerJob}를 넘습니다.`, recovery: 'RF_TTS_MAX_CHARS_PER_JOB을 조정하거나 대사를 줄이세요.' });
    const providers = [...new Set(chars.map((c) => speechFor(c).name))];
    return { mode: modeNow(), provider: providers.length > 1 ? 'mixed' : (providers[0] || provider().name), providers, lines, billableChars, usd, usdKnown: usd != null, cachedLines: lines.filter((l) => l.cached).length, blockers, canRun: blockers.length === 0 };
  }

  /** BILLABLE in live mode. confirmChars must equal the estimate the operator saw. */
  async function synthesize(epId, { confirmChars, by = 'operator', sceneIds } = {}) {
    const est = estimate(epId, { sceneIds });
    if (est.blockers.length) throw new StudioError('BLOCKED', est.blockers[0].message, { recovery: est.blockers[0].recovery, details: est.blockers, status: 409 });
    if (est.billableChars > 0 && Number(confirmChars) !== est.billableChars) throw new StudioError('CONFIRM_MISMATCH', `확인한 글자 수(${confirmChars})가 현재 예상(${est.billableChars})과 다릅니다. 새로고침 후 다시 확인하세요.`, { status: 409 });
    const ep0 = store.episodes.get(epId);
    const lib = store.characters.load();
    const results = [];
    for (const line of ep0.lines.filter((l) => !sceneIds || !sceneIds.length || sceneIds.includes(l.sceneId))) {
      const char = lib.characters.find((c) => c.id === line.speaker);
      if (lineAudio(ep0, line).valid) {
        results.push({ lineId: line.id, status: 'cached' });
        continue;
      }
      const ov = sceneVoice(ep0, line.sceneId);
      const tts = ttsFor(char, ov);
      let out;
      try {
        out = (await tts.synthesizeAll([line.en]))[0];
      } catch (e) {
        if (e instanceof BudgetError) throw new StudioError('BUDGET', e.message, { status: 409 });
        results.push({ lineId: line.id, status: 'error', error: e.message });
        store.episodes.audit(epId, 'voice.failed', { lineId: line.id, message: e.message });
        continue; // a failed paid line is NOT retried; the operator decides
      }
      await store.episodes.update(epId, (ep) => {
        ep.voice.lines[line.id] = { key: lineKey(char, line, ov), file: path.relative(store.dir, out.file), durationSec: Math.round(out.duration * 1000) / 1000, speaker: line.speaker, voiceId: voiceIdOf(char), provider: providerOf(char), mock: !isLive(char), cached: out.cached, at: nowIso(), scriptHash: scriptFingerprint(ep) };
        if (isLive(char) && !out.cached) ep.spend.push({ at: nowIso(), kind: 'voice', lineId: line.id, chars: [...line.en].length, estimatedUsd: est.usd == null ? null : Math.round((est.usd * [...line.en].length / Math.max(1, est.billableChars)) * 1e6) / 1e6, actualUsd: null, mock: false });
      });
      results.push({ lineId: line.id, status: out.cached ? 'cached' : 'synthesized', durationSec: out.duration });
    }
    store.episodes.audit(epId, 'voice.run', { mode: modeNow(), by, results: results.map((r) => r.status) });
    return { results, estimate: est };
  }

  /** Looks the configured voice ID up in HeyGen's catalog (live mode only). */
  async function verify(charId) {
    const c = store.characters.get(charId);
    if (modeNow() !== 'live') throw new StudioError('MOCK_MODE', '목업 모드에서는 HeyGen 음성을 확인할 수 없습니다 (RF_STUDIO_VOICE_MODE=live 필요).', { recovery: '실제 확인은 Mac의 renderer/.env에서 키를 설정한 뒤 live 모드로 서버를 시작하세요.' });
    if (!c.voice.heygenVoiceId) throw new StudioError('NO_VOICE_ID', 'Voice ID를 먼저 입력하세요.' + (c.voice.heygenIdentityId ? ' Identity ID는 Voice ID가 아닙니다.' : ''));
    const hit = await findVoice({ apiKey: keyNow(), fetchFn }, c.voice.heygenVoiceId);
    store.characters.update(charId, (x) => {
      x.voice.verified = !!hit;
      x.voice.verifiedAt = hit ? nowIso() : '';
      x.voice.verifiedName = hit ? hit.name || '' : '';
      x.voice.verifiedLanguage = hit ? hit.language || '' : '';
    });
    if (!hit) throw new StudioError('VOICE_NOT_FOUND', 'HeyGen 음성 목록에서 이 ID를 찾지 못했습니다. Identity ID와 Voice ID는 서로 다른 값입니다.', { recovery: 'HeyGen에서 클론한 음성의 Voice ID를 확인하세요.' });
    return hit;
  }

  const hasLines = (ep, sid) => (ep.lines || []).some((l) => l.sceneId === sid);

  /** Per-scene speaking rate (0.7–1.2, empty = the character's own) and emotion note. Changing the rate makes the scene's audio "needs regeneration" (never silently re-bought). */
  async function saveSceneVoice(epId, sceneId, patch) {
    await store.episodes.update(epId, (ep) => {
      if (!(ep.scenes || []).some((x) => x.id === sceneId)) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
      ep.voiceScene = ep.voiceScene || {};
      const cur = Object.assign({}, ep.voiceScene[sceneId] || {});
      if (patch.rate !== undefined) { const r = patch.rate === '' || patch.rate === null ? 0 : Number(patch.rate); if (r && !(r >= 0.7 && r <= 1.2)) throw new StudioError('BAD_RATE', '속도는 0.7–1.2 사이여야 합니다.', { status: 422 }); cur.rate = r || 0; }
      if (patch.emotion !== undefined) cur.emotion = String(patch.emotion).trim().slice(0, 80);
      if (!cur.rate && !cur.emotion && !cur.variant) delete ep.voiceScene[sceneId]; else ep.voiceScene[sceneId] = cur;
    });
    store.episodes.audit(epId, 'voice.scene.settings', { sceneId });
  }

  /**
   * Starts a genuinely NEW take for one scene without touching the animation: bumps the scene's variant so the next "음성 생성" is a new (paid in live mode) synthesis.
   * Approved audio is never replaced silently: it needs confirmOverwrite, which also drops that approval (and so the scene's lip sync / final approval become stale).
   */
  async function regenerate(epId, sceneId, { confirmOverwrite = false } = {}) {
    await store.episodes.update(epId, (ep) => {
      if (!hasLines(ep, sceneId)) throw new StudioError('NO_DIALOGUE', '대사가 없는 장면입니다.', { status: 409 });
      if ((ep.audioApprovals || {})[sceneId] && !confirmOverwrite) throw new StudioError('APPROVED_AUDIO', `${sceneId}: 승인된 음성이 있습니다. 덮어쓰려면 확인이 필요합니다.`, { status: 409, recovery: '승인된 음성은 자동으로 바뀌지 않습니다. 새로 만들 것을 확인하세요.' });
      ep.voiceScene = ep.voiceScene || {};
      const cur = Object.assign({}, ep.voiceScene[sceneId] || {});
      cur.variant = (cur.variant || 0) + 1;
      ep.voiceScene[sceneId] = cur;
      if (ep.audioApprovals) delete ep.audioApprovals[sceneId];
    });
    store.episodes.audit(epId, 'voice.scene.regenerate', { sceneId, confirmOverwrite: !!confirmOverwrite });
  }

  return { get mode() { return modeNow(); }, estimate, synthesize, verify, lineAudio, saveSceneVoice, regenerate, provider: () => provider() };
}

module.exports = { createVoiceService };
