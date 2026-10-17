// Centralized voice provider connections + unified voice catalog.
//   Google Cloud Text-to-Speech  — REST v1: GET https://texttospeech.googleapis.com/v1/voices (voices.list, no synthesis).
//     Auth: service-account JSON key (JWT → OAuth token, scope cloud-platform; recommended), API key, or Application Default
//     Credentials on the server (GOOGLE_APPLICATION_CREDENTIALS file or the metadata server). A bare API key is optional, not assumed.
//   HeyGen — GET https://api.heygen.com/v3/voices (X-Api-Key; type=private are the account's cloned voices, public the shared library;
//     cursor pagination with next_token). 
//   * Credentials live ONLY in the encrypted vault / server environment. Nothing here returns a secret; errors are scrubbed.
//   * Connecting, testing and syncing only call the voice-LIST endpoints: no audio is generated and nothing is billed.
//   * A voice preview that would synthesize audio needs an explicit request, a cost confirmation, and never runs in MOCK mode.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, readJson, writeJsonAtomic, sha256, sleep } = require('./util');
const { createServiceAccountProvider, createRefreshTokenProvider } = require('./google/auth');
const { createGoogleTts } = require('../../renderer/lib/tts/google');
const { createMockSpeech } = require('./providers/mock-speech');

const GOOGLE_VOICES = 'https://texttospeech.googleapis.com/v1/voices';
const HEYGEN_VOICES = 'https://api.heygen.com/v3/voices';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const MAX_PUBLIC_PAGES = 5; // 500 public HeyGen voices; the account's own (cloned) voices are always fetched in full
const SAMPLE = 'Hello! This is a short sample of my voice.';
const STATE_LABEL = { not_configured: '미설정', untested: '테스트 전', connected: '연결됨', auth_failed: '인증 실패', rate_limited: '요청 제한', unavailable: '응답 없음', error: '오류' };
const LANG_NAMES = { english: 'en', korean: 'ko', japanese: 'ja', chinese: 'zh', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', hindi: 'hi', arabic: 'ar', russian: 'ru', thai: 'th', vietnamese: 'vi', indonesian: 'id', turkish: 'tr' };

const primary = (lang) => String(lang || '').toLowerCase().split(/[-_]/)[0];
function langCode(raw) {
  const t = String(raw || '').trim();
  if (/^[a-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(t)) return t.replace('_', '-');
  const first = t.toLowerCase().split(/[\s(,-]/)[0];
  return LANG_NAMES[first] || t.toLowerCase();
}
/** Google voice family from its name (en-US-Neural2-D → Neural2). */
function googleType(name) {
  const m = /-(Chirp3-HD|Chirp-HD|Chirp|Studio|Neural2|Wavenet|WaveNet|Polyglot|News|Casual|Journey|Standard)(?:-|$)/i.exec(name);
  return m ? m[1].replace(/^wavenet$/i, 'WaveNet') : 'Standard';
}
const SSML_FAMILIES = new Set(['Standard', 'WaveNet', 'Neural2', 'Polyglot', 'News', 'Casual', 'Studio']);

function createVoiceCatalog({ store, vault, cfg, runtime, fetchFn = globalThis.fetch, env = process.env, now = () => Date.now(), sleepFn = sleep, log = () => {} }) {
  const connFile = () => store.path('voice-connections.json');
  const catFile = () => store.path('voice-catalog.json');
  const auditFile = () => store.path('voice-audit.jsonl');
  const conns = () => readJson(connFile(), {});
  const saveConns = (c) => writeJsonAtomic(connFile(), c);
  const cat = () => readJson(catFile(), { voices: [] });
  const audit = (event, data = {}) => { try { fs.appendFileSync(auditFile(), JSON.stringify({ at: nowIso(), event, ...data }) + '\n'); } catch (e) { log('voice audit failed: ' + e.message); } };
  const setConn = (p, patch) => { const c = conns(); c[p] = Object.assign({}, c[p], patch); saveConns(c); return c[p]; };
  const saProviders = new Map(); // service-account token providers (token cache only; the key is never stored here)

  /** Removes every secret we know about from a message before it can reach a response or a log. */
  const secrets = () => ['googletts', 'googletts_sa', 'heygen'].map((k) => { try { return vault.get(k); } catch (_) { return ''; } }).filter(Boolean)
    .concat((() => { try { const sa = JSON.parse(vault.get('googletts_sa') || '{}'); return sa.private_key ? [sa.private_key, String(sa.private_key).replace(/\n/g, '\\n')] : []; } catch (_) { return []; } })());
  const scrub = (text) => secrets().reduce((t, s) => (s && s.length > 6 ? t.split(s).join('***') : t), String(text == null ? '' : text));

  // ---------------------------------------------------------------- Google credentials
  function parseServiceAccount(text) {
    let sa;
    try { sa = JSON.parse(String(text || '')); } catch (_) { throw new StudioError('BAD_CREDENTIALS', '서비스 계정 키가 올바른 JSON이 아닙니다.', { status: 400, recovery: 'Google Cloud 콘솔 → IAM → 서비스 계정 → 키 → JSON 키 파일의 전체 내용을 붙여넣으세요.' }); }
    if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key || !/BEGIN [A-Z ]*PRIVATE KEY/.test(sa.private_key)) throw new StudioError('BAD_CREDENTIALS', '서비스 계정 JSON 키가 아닙니다 (type=service_account, client_email, private_key가 필요합니다).', { status: 400 });
    return sa;
  }
  const adcFile = () => { const f = env.GOOGLE_APPLICATION_CREDENTIALS; try { return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch (_) { return null; } };
  const adcInfo = () => { const j = adcFile(); return { file: !!j, kind: j ? j.type : '', clientEmail: j && j.client_email ? j.client_email : '', metadata: !j && !!(env.K_SERVICE || env.GCE_METADATA_HOST || env.GAE_ENV) }; };

  function saProvider(sa) {
    const k = sha256(sa.client_email + sa.private_key);
    if (!saProviders.has(k)) saProviders.set(k, createServiceAccountProvider({ clientEmail: sa.client_email, privateKey: sa.private_key, scopes: [CLOUD_SCOPE], fetchFn, now, sleepFn }));
    return saProviders.get(k);
  }
  /** Request headers for a Google TTS call. Resolved server-side only. */
  async function googleHeaders() {
    const c = conns().google || {};
    const mode = c.mode || (vault.mask('googletts_sa').configured ? 'service_account' : vault.mask('googletts').configured ? 'api_key' : '');
    const proj = c.projectId ? { 'x-goog-user-project': c.projectId } : {};
    if (mode === 'service_account') {
      const raw = vault.get('googletts_sa');
      if (!raw) throw new StudioError('NOT_CONNECTED', 'Google Cloud 서비스 계정이 설정되지 않았습니다.', { status: 409, recovery: 'Settings → 음성 연결에서 Google Cloud를 연결하세요.' });
      return Object.assign({ Authorization: 'Bearer ' + (await saProvider(parseServiceAccount(raw)).getToken()) }, proj);
    }
    if (mode === 'api_key') {
      const key = vault.get('googletts');
      if (!key) throw new StudioError('NOT_CONNECTED', 'Google Cloud API 키가 설정되지 않았습니다.', { status: 409, recovery: 'Settings → 음성 연결에서 Google Cloud를 연결하세요.' });
      return Object.assign({ 'x-goog-api-key': key }, proj);
    }
    if (mode === 'adc') {
      const j = adcFile();
      if (j && j.type === 'service_account') return Object.assign({ Authorization: 'Bearer ' + (await saProvider(j).getToken()) }, proj);
      if (j && j.type === 'authorized_user') {
        const key = 'adc:' + sha256(j.refresh_token || '');
        if (!saProviders.has(key)) saProviders.set(key, createRefreshTokenProvider({ clientId: j.client_id, clientSecret: j.client_secret, refreshToken: j.refresh_token, fetchFn, now, sleepFn }));
        return Object.assign({ Authorization: 'Bearer ' + (await saProviders.get(key).getToken()) }, j.quota_project_id ? { 'x-goog-user-project': j.quota_project_id } : {}, proj);
      }
      const r = await fetchFn('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (r && r.ok) return Object.assign({ Authorization: 'Bearer ' + (await r.json()).access_token }, proj);
      throw new StudioError('NO_ADC', '이 서버에서 Application Default Credentials를 찾지 못했습니다.', { status: 409, recovery: 'GOOGLE_APPLICATION_CREDENTIALS(키 파일 경로)를 설정하거나 서비스 계정 JSON을 Settings에 붙여넣으세요.' });
    }
    throw new StudioError('NOT_CONNECTED', 'Google Cloud가 연결되지 않았습니다.', { status: 409, recovery: 'Settings → 음성 연결에서 Google Cloud를 연결하세요.' });
  }

  /** GET with timeout + bounded retries on 429/5xx. Maps the outcome to a connection state (no secrets in messages). */
  async function getJson(url, headers) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchFn(url, { method: 'GET', headers: Object.assign({ Accept: 'application/json' }, headers), signal: AbortSignal.timeout(20000) });
        if (res.status === 401 || res.status === 403) { const body = await res.json().catch(() => ({})); return { state: 'auth_failed', httpStatus: res.status, message: scrub((body.error && body.error.message) || (body.message) || '인증이 거부되었습니다.').slice(0, 240) }; }
        if (res.status === 429 || res.status >= 500) last = { state: res.status === 429 ? 'rate_limited' : 'unavailable', httpStatus: res.status, message: `HTTP ${res.status}` };
        else if (!res.ok) { const body = await res.json().catch(() => ({})); return { state: 'error', httpStatus: res.status, message: scrub((body.error && body.error.message) || body.message || 'HTTP ' + res.status).slice(0, 240) }; }
        else { try { return { state: 'ok', json: await res.json() }; } catch (_) { return { state: 'error', message: '응답을 해석하지 못했습니다.' }; } }
      } catch (e) { last = { state: 'unavailable', message: scrub(e.name === 'TimeoutError' ? '시간 초과' : e.message).slice(0, 200) }; }
      if (attempt < 2) await sleepFn(400 * 2 ** attempt);
    }
    return last;
  }

  // ---------------------------------------------------------------- listing (free endpoints only)
  const normGoogle = (v, t) => {
    const type = googleType(v.name || '');
    return { key: 'google:' + v.name, provider: 'google', id: v.name, name: v.name, language: (v.languageCodes || [])[0] || '', languages: v.languageCodes || [], gender: String(v.ssmlGender || '').toLowerCase(), type,
      capabilities: ['speech', 'speakingRate'].concat(SSML_FAMILIES.has(type) ? ['ssml'] : []), meta: { sampleRateHz: v.naturalSampleRateHertz || null }, syncedAt: t };
  };
  const normHeygen = (v, kind, t) => ({ key: 'heygen:' + v.voice_id, provider: 'heygen', id: v.voice_id, name: v.name || v.voice_id, language: langCode(v.language), languages: [langCode(v.language)].filter(Boolean), languageLabel: v.language || '', gender: String(v.gender || '').toLowerCase(),
    type: kind === 'private' ? 'cloned' : 'public', capabilities: ['speech'].concat(v.support_pause ? ['pause'] : [], v.support_locale ? ['locale'] : [], v.preview_audio_url ? ['preview'] : []), previewUrl: v.preview_audio_url || '', meta: { engine: v.engine || '', supportPause: !!v.support_pause, supportLocale: !!v.support_locale }, syncedAt: t });

  async function listGoogle({ languageCode } = {}) {
    const headers = await googleHeaders();
    const r = await getJson(GOOGLE_VOICES + (languageCode ? '?languageCode=' + encodeURIComponent(languageCode) : ''), headers);
    if (r.state !== 'ok') return r;
    const t = nowIso();
    return { state: 'ok', voices: (r.json.voices || []).filter((v) => v && v.name).map((v) => normGoogle(v, t)) };
  }
  async function listHeygen({ limitOnly = false } = {}) {
    const key = runtime.heygenKey();
    if (!key) return { state: 'not_configured', message: 'HeyGen API 키가 없습니다.' };
    const t = nowIso(); const out = []; const notes = [];
    for (const kind of limitOnly ? ['private'] : ['private', 'public']) {
      let token = '';
      const cap = kind === 'public' ? MAX_PUBLIC_PAGES : 10;
      for (let page = 0; page < cap; page++) {
        const r = await getJson(HEYGEN_VOICES + '?type=' + kind + '&limit=' + (limitOnly ? 1 : 100) + (token ? '&token=' + encodeURIComponent(token) : ''), { 'X-Api-Key': key });
        if (r.state !== 'ok') return r;
        (r.json.data || []).forEach((v) => v && v.voice_id && out.push(normHeygen(v, kind, t)));
        if (limitOnly || !r.json.has_more || !r.json.next_token) break;
        token = r.json.next_token;
        if (kind === 'public' && page === cap - 1) notes.push(`공개 음성은 앞의 ${cap * 100}개만 가져왔습니다 (언어 필터로 좁혀 쓰세요).`);
      }
    }
    return { state: 'ok', voices: out, notes };
  }

  // ---------------------------------------------------------------- connection API
  const keyOf = (p) => (p === 'google' ? (conns().google || {}).mode : 'api_key');
  function connection(p) {
    const c = conns()[p] || {};
    if (p === 'google') {
      const mode = c.mode || '';
      const configured = mode === 'service_account' ? vault.mask('googletts_sa').configured : mode === 'api_key' ? vault.mask('googletts').configured : mode === 'adc' ? (adcInfo().file || adcInfo().metadata) : false;
      return { provider: 'google', label: 'Google Cloud Text-to-Speech', mode, configured, state: configured ? (c.state || 'untested') : 'not_configured', stateLabel: STATE_LABEL[configured ? (c.state || 'untested') : 'not_configured'], projectId: c.projectId || '', clientEmail: c.clientEmail || '', apiKeyLast4: mode === 'api_key' ? vault.mask('googletts').last4 : '', adc: adcInfo(), testedAt: c.testedAt || '', syncedAt: c.syncedAt || '', message: c.message || '', voiceCount: cat().voices.filter((v) => v.provider === 'google').length };
    }
    const m = vault.mask('heygen');
    const state = m.configured ? (c.state || 'untested') : 'not_configured';
    return { provider: 'heygen', label: 'HeyGen', configured: m.configured, state, stateLabel: STATE_LABEL[state], keyLast4: m.last4, keySource: m.source, testedAt: c.testedAt || '', syncedAt: c.syncedAt || '', message: c.message || '', voiceCount: cat().voices.filter((v) => v.provider === 'heygen').length, notes: c.notes || [] };
  }

  function setGoogleCredentials({ mode, serviceAccountJson, apiKey, projectId } = {}) {
    const proj = String(projectId || '').trim();
    if (proj && !/^[a-z][a-z0-9-]{4,60}[a-z0-9]$/.test(proj)) throw new StudioError('BAD_PROJECT', 'Google Cloud 프로젝트 ID 형식이 올바르지 않습니다 (예: my-project-123456).', { status: 400 });
    if (mode === 'service_account') {
      const sa = parseServiceAccount(serviceAccountJson);
      vault.set('googletts_sa', JSON.stringify(sa), { multiline: true });
      saProviders.clear();
      setConn('google', { mode, projectId: proj || sa.project_id || '', clientEmail: sa.client_email, state: 'untested', message: '', testedAt: '' });
    } else if (mode === 'api_key') {
      vault.set('googletts', apiKey);
      setConn('google', { mode, projectId: proj, clientEmail: '', state: 'untested', message: '', testedAt: '' });
    } else if (mode === 'adc') {
      const a = adcInfo();
      if (!a.file && !a.metadata) throw new StudioError('NO_ADC', '이 서버에서 Application Default Credentials를 찾지 못했습니다.', { status: 400, recovery: 'GOOGLE_APPLICATION_CREDENTIALS 환경변수(키 파일 경로)를 서버에 설정하거나, 서비스 계정 JSON을 붙여넣으세요.' });
      setConn('google', { mode, projectId: proj, clientEmail: a.clientEmail, state: 'untested', message: '', testedAt: '' });
    } else throw new StudioError('BAD_MODE', '인증 방식은 service_account, api_key, adc 중 하나입니다.', { status: 400 });
    audit('google.credentials.set', { mode });
    return connection('google');
  }
  function setHeygenKey(key) {
    vault.set('heygen', key);
    setConn('heygen', { state: 'untested', message: '', testedAt: '' });
    audit('heygen.key.set');
    return connection('heygen');
  }

  async function test(p) {
    if (p !== 'google' && p !== 'heygen') throw new StudioError('BAD_PROVIDER', '알 수 없는 제공자입니다.', { status: 400 });
    const at = nowIso();
    let r;
    if (p === 'google') {
      if (!connection('google').configured) throw new StudioError('NOT_CONNECTED', 'Google Cloud 자격 증명이 없습니다.', { status: 409, recovery: '먼저 자격 증명을 저장하세요.' });
      try { r = await listGoogle({ languageCode: 'en-US' }); } catch (e) { r = { state: e.code === 'NO_ADC' || e.code === 'NOT_CONNECTED' ? 'not_configured' : (/GOOGLE_AUTH/.test(e.code) ? 'auth_failed' : 'error'), message: scrub(e.message) }; }
    } else {
      if (!runtime.heygenKey()) throw new StudioError('NOT_CONNECTED', 'HeyGen API 키가 없습니다.', { status: 409, recovery: '먼저 API 키를 저장하세요.' });
      r = await listHeygen({ limitOnly: true });
    }
    const ok = r.state === 'ok';
    setConn(p, { state: ok ? 'connected' : r.state, testedAt: at, message: ok ? '' : (r.state === 'auth_failed' ? '인증이 거부되었습니다: ' : '') + scrub(r.message || '') });
    audit(p + '.test', { state: ok ? 'connected' : r.state });
    return connection(p);
  }

  /** Replaces this provider's slice of the catalog. A failed sync keeps the previous catalog and reports the error. Never synthesizes audio. */
  async function sync(p) {
    if (p !== 'google' && p !== 'heygen') throw new StudioError('BAD_PROVIDER', '알 수 없는 제공자입니다.', { status: 400 });
    if (!connection(p).configured) throw new StudioError('NOT_CONNECTED', '먼저 제공자를 연결하세요.', { status: 409, recovery: 'Settings → 음성 연결에서 자격 증명을 저장하세요.' });
    const at = nowIso();
    let r;
    try { r = p === 'google' ? await listGoogle() : await listHeygen(); } catch (e) { r = { state: /GOOGLE_AUTH/.test(e.code) ? 'auth_failed' : 'error', message: scrub(e.message) }; }
    if (r.state !== 'ok') {
      setConn(p, { state: r.state, message: scrub(r.message || '동기화에 실패했습니다.'), testedAt: at });
      audit(p + '.sync.failed', { state: r.state });
      throw new StudioError('SYNC_FAILED', `${p === 'google' ? 'Google Cloud' : 'HeyGen'} 음성 목록을 가져오지 못했습니다 (${STATE_LABEL[r.state] || r.state}): ${scrub(r.message || '')}. 기존 목록은 그대로입니다.`, { status: 502, recovery: '연결 테스트로 자격 증명·API 사용 설정을 확인한 뒤 다시 시도하세요.' });
    }
    const d = cat();
    d.voices = d.voices.filter((v) => v.provider !== p).concat(r.voices);
    d.updatedAt = at;
    writeJsonAtomic(catFile(), d);
    setConn(p, { state: 'connected', syncedAt: at, testedAt: at, message: '', notes: r.notes || [] });
    audit(p + '.sync', { count: r.voices.length });
    return { connection: connection(p), count: r.voices.length };
  }

  function disconnect(p) {
    if (p === 'google') { vault.remove('googletts'); vault.remove('googletts_sa'); saProviders.clear(); }
    else if (p === 'heygen') { vault.remove('heygen'); const prov = Object.assign({}, store.settings.get().providers); prov.heygen = { mode: 'mock' }; store.settings.save({ providers: prov }); }
    else throw new StudioError('BAD_PROVIDER', '알 수 없는 제공자입니다.', { status: 400 });
    const c = conns(); delete c[p]; saveConns(c);
    const d = cat(); d.voices = d.voices.filter((v) => v.provider !== p); writeJsonAtomic(catFile(), d);
    audit(p + '.disconnected');
    return Object.assign(connection(p), { note: p === 'heygen' ? 'HeyGen 키를 이 서버에서 삭제했습니다 (HeyGen 콘솔에서 키를 폐기하면 완전히 무효화됩니다). 실제 모드는 MOCK으로 돌아갔습니다.' : '서버에서 Google 자격 증명을 삭제했습니다 (서비스 계정 키는 Google Cloud 콘솔에서 폐기하세요).' });
  }

  // ---------------------------------------------------------------- catalog
  function list({ provider = '', language = '', q = '', type = '', limit = 200, offset = 0 } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    const all = cat().voices.filter((v) => (!provider || v.provider === provider) && (!language || (v.languages || []).some((l) => primary(l) === primary(language) && (!/[-_]/.test(language) || l.toLowerCase() === language.toLowerCase().replace('_', '-')))) && (!type || v.type === type)
      && (!needle || [v.name, v.id, v.language, v.languageLabel, v.type, v.gender].some((x) => String(x || '').toLowerCase().includes(needle))));
    return { total: all.length, voices: all.slice(Number(offset) || 0, (Number(offset) || 0) + Math.min(500, Number(limit) || 200)) };
  }
  const find = (provider, id) => cat().voices.find((v) => v.provider === provider && v.id === id) || null;
  function overview() {
    const voices = cat().voices;
    const langs = {};
    voices.forEach((v) => (v.languages || []).forEach((l) => { const k = primary(l); langs[k] = (langs[k] || 0) + 1; }));
    return { providers: { google: connection('google'), heygen: connection('heygen') }, total: voices.length, languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })), types: Array.from(new Set(voices.map((v) => v.type))).sort(), stateLabels: STATE_LABEL, updatedAt: cat().updatedAt || '' };
  }

  // ---------------------------------------------------------------- characters
  /** Saves a catalog voice as the character's default voice. The credential is never asked for here. */
  function assign(charId, { provider, voiceId } = {}) {
    if (provider !== 'google' && provider !== 'heygen') throw new StudioError('BAD_PROVIDER', '제공자는 google 또는 heygen이어야 합니다.', { status: 400 });
    const entry = find(provider, String(voiceId || ''));
    if (!entry) throw new StudioError('VOICE_NOT_IN_CATALOG', '동기화된 음성 목록에 없는 음성입니다.', { status: 409, recovery: 'Settings → 음성 연결에서 해당 제공자의 음성 목록을 새로고침하세요.' });
    store.characters.update(charId, (c) => {
      c.voice = Object.assign({}, c.voice, { provider });
      if (provider === 'heygen') Object.assign(c.voice, { heygenVoiceId: entry.id, verified: true, verifiedAt: nowIso(), verifiedName: entry.name, verifiedLanguage: entry.language });
      else Object.assign(c.voice, { googleVoiceName: entry.id, googleVoiceLanguage: entry.language, googleVoiceType: entry.type });
      c.voice.assignedAt = nowIso();
    });
    audit('character.voice.assigned', { characterId: charId, provider });
    return status(charId);
  }
  function clear(charId, provider) {
    store.characters.update(charId, (c) => {
      const p = provider || c.voice.provider || 'heygen';
      if (p === 'google') { delete c.voice.googleVoiceName; delete c.voice.googleVoiceLanguage; delete c.voice.googleVoiceType; }
      else Object.assign(c.voice, { heygenVoiceId: '', verified: false, verifiedAt: '', verifiedName: '', verifiedLanguage: '' });
    });
    return status(charId);
  }
  /** What Script Studio / Character Library show for a character's voice. Free; no network. */
  function status(charOrId) {
    const c = typeof charOrId === 'string' ? store.characters.get(charOrId) : charOrId;
    const v = c.voice || {};
    if (v.provider === 'muapi') {
      // MuAPI ElevenLabs TTS: the voice_id is entered by hand (no catalog is read), so readiness = id present + endpoint confirmed by the operator
      const confirmed = !!store.settings.get().muapiTtsConfirmed;
      const base = { characterId: c.id, provider: 'muapi', providerLabel: 'MuAPI TTS', voiceId: v.muapiVoiceId || '', connected: true, links: { settings: '#/settings/voices', characters: '#/settings/characters' } };
      if (!v.muapiVoiceId) return Object.assign(base, { state: 'missing', ready: false, name: '', message: `${c.name}: MuAPI voice_id가 지정되지 않았습니다.` });
      if (!confirmed) return Object.assign(base, { state: 'unverified', ready: false, name: v.muapiVoiceId, message: 'MuAPI TTS 엔드포인트가 아직 확인되지 않았습니다 (실제 호출 차단, 목업은 가능).', action: 'connect' });
      return Object.assign(base, { state: 'ready', ready: true, name: v.muapiVoiceId, message: 'MuAPI TTS · ' + v.muapiVoiceId });
    }
    const provider = v.provider === 'google' ? 'google' : 'heygen';
    const id = provider === 'google' ? (v.googleVoiceName || '') : (v.heygenVoiceId || '');
    const conn = connection(provider);
    const label = provider === 'google' ? 'Google Cloud TTS' : 'HeyGen';
    const base = { characterId: c.id, provider, providerLabel: label, voiceId: id, connected: conn.configured, links: { settings: '#/settings', characters: '#/settings/characters' } };
    if (!id) return Object.assign(base, { state: 'missing', ready: false, name: '', message: `${c.name}: 목소리가 지정되지 않았습니다.` + (provider === 'heygen' && v.heygenIdentityId ? ' (Identity ID는 Voice ID가 아닙니다.)' : ''), action: 'change' });
    if (!conn.configured) return Object.assign(base, { state: 'not_connected', ready: false, name: v.verifiedName || id, message: `${label}가 연결되어 있지 않습니다.`, action: 'connect' });
    const entry = find(provider, id);
    if (entry) return Object.assign(base, { state: 'ready', ready: true, name: entry.name, language: entry.language, type: entry.type, message: `${label} · ${entry.name}` });
    const synced = !!conn.syncedAt;
    if (!synced && provider === 'heygen' && v.verified) return Object.assign(base, { state: 'ready', ready: true, name: v.verifiedName || id, language: v.verifiedLanguage || '', message: `${label} · ${v.verifiedName || id} (이전에 확인됨 · 목록 동기화 전)`, legacy: true });
    if (!synced) return Object.assign(base, { state: 'unsynced', ready: false, name: id, message: `${label} 음성 목록이 아직 동기화되지 않아 이 음성을 확인할 수 없습니다.`, action: 'connect' });
    return Object.assign(base, { state: 'unavailable', ready: false, name: v.googleVoiceName || v.verifiedName || id, message: `${label} 계정에서 이 음성(${id})을 더 이상 찾을 수 없습니다.`, action: 'change' });
  }

  // ---------------------------------------------------------------- previews (explicit action; synthesized audio is paid in LIVE mode)
  const previewDir = () => store.cachePath('voice-preview');
  const previewKey = (provider, id, text) => sha256([provider, id, text].join('|')).slice(0, 24);
  const rate = () => store.settings.get().voiceUsdPer1kChars;
  function previewEstimate(provider, voiceId, text) {
    const entry = find(provider, voiceId);
    if (!entry) throw new StudioError('VOICE_NOT_IN_CATALOG', '동기화된 음성 목록에 없는 음성입니다.', { status: 409 });
    const t = String(text || SAMPLE).slice(0, 120);
    if (provider === 'heygen' && entry.previewUrl) return { provider, voiceId, free: true, source: 'hosted', url: entry.previewUrl, chars: 0, usd: 0, note: 'HeyGen이 제공하는 샘플 파일입니다 (음성 생성 없음 · 요금 없음).' };
    const cached = fs.existsSync(path.join(previewDir(), previewKey(provider, voiceId, t) + '.wav'));
    const live = runtime.voiceMode() === 'live';
    const r = rate();
    const chars = [...t].length;
    return { provider, voiceId, free: !live || cached, mock: !live, cached, chars, text: t, usd: !live || cached ? 0 : (r != null && r !== '' ? Math.round((chars / 1000) * Number(r) * 1e6) / 1e6 : null), note: !live ? 'MOCK 모드: 실제 음성이 아니라 샘플 톤이며 요금이 없습니다.' : cached ? '이미 만든 미리듣기를 다시 씁니다 (요금 없음).' : '실제 음성을 한 번 생성합니다 (유료).' };
  }
  async function preview(provider, voiceId, { text, confirm } = {}) {
    const est = previewEstimate(provider, voiceId, text);
    if (est.free && est.source === 'hosted') return { url: est.url, hosted: true, estimate: est };
    if (provider === 'heygen') throw new StudioError('NO_PREVIEW', '이 HeyGen 음성에는 샘플 파일이 없습니다. 실제 음성은 대본 승인 후 생성됩니다.', { status: 409 });
    const file = path.join(previewDir(), previewKey(provider, voiceId, est.text) + '.wav');
    if (est.cached) return { file, estimate: est, cached: true };
    if (est.mock) {
      fs.mkdirSync(previewDir(), { recursive: true });
      fs.writeFileSync(file, await createMockSpeech().synthesize({ text: est.text, voice: voiceId, speakingRate: 1 }));
      return { file, estimate: est, mock: true };
    }
    if (!confirm || confirm.paid !== true || Number(confirm.chars) !== est.chars) throw new StudioError('CONFIRM_REQUIRED', `미리듣기는 유료입니다. 글자 수 ${est.chars}자(예상 ${est.usd == null ? '비용 알 수 없음' : '$' + est.usd})를 확인해야 실행됩니다.`, { status: 409, details: [est] });
    if (est.usd == null && confirm.unknownCost !== true) throw new StudioError('CONFIRM_REQUIRED', '가격이 설정되지 않았습니다. 비용을 모르는 상태로 진행하려면 확인해야 합니다.', { status: 409, details: [est] });
    const tts = createGoogleTts({ auth: { headers: googleHeaders }, fetchFn });
    const wav = await tts.synthesize({ text: est.text, voice: voiceId, speakingRate: 1 });
    fs.mkdirSync(previewDir(), { recursive: true });
    fs.writeFileSync(file, wav);
    try { fs.appendFileSync(store.path('voice-preview-usage.jsonl'), JSON.stringify({ at: nowIso(), provider, voiceId, chars: est.chars, estimatedUsd: est.usd }) + '\n'); } catch (_) { /* ledger is best-effort */ }
    audit('voice.preview', { provider, chars: est.chars });
    return { file, estimate: est };
  }

  /** Server-side only: a Google TTS speech provider for the dialogue pipeline (credentials stay in this module). */
  const googleSpeech = (opts = {}) => createGoogleTts(Object.assign({ auth: { headers: googleHeaders }, fetchFn }, opts));
  const googleReady = () => connection('google').configured;

  return { overview, connection, setGoogleCredentials, setHeygenKey, test, sync, disconnect, list, find, assign, clear, status, previewEstimate, preview, googleSpeech, googleReady, googleHeaders, scrub, previewDir, CONSTANTS: { GOOGLE_VOICES, HEYGEN_VOICES, SAMPLE } };
}

module.exports = { createVoiceCatalog, googleType, langCode };
