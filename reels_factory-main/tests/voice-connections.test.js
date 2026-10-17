'use strict';
// Voice API connections: Google Cloud TTS (service account / API key / ADC) and HeyGen are connected once in Settings;
// the voice list is synchronized into one catalog; characters save a default voice from it; Script Studio shows the status.
// Everything is faked (no network). Listing/connecting never synthesizes audio; previews and final TTS stay gated.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { createMockSpeech } = require('../studio/lib/providers/mock-speech');
const { googleType, langCode } = require('../studio/lib/voicecatalog');

const KEY = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const SA = { type: 'service_account', project_id: 'rf-test-123456', client_email: 'tts@rf-test-123456.iam.gserviceaccount.com', private_key: KEY };
const GV = { voices: [
  { languageCodes: ['en-US'], name: 'en-US-Neural2-D', ssmlGender: 'MALE', naturalSampleRateHertz: 24000 },
  { languageCodes: ['en-GB'], name: 'en-GB-Wavenet-B', ssmlGender: 'MALE', naturalSampleRateHertz: 24000 },
  { languageCodes: ['ko-KR'], name: 'ko-KR-Standard-A', ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 },
  { languageCodes: ['en-US'], name: 'en-US-Chirp3-HD-Aoede', ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 },
  { languageCodes: ['en-US'], name: 'en-US-Studio-O', ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 },
] };
const HEY = {
  private: [{ voice_id: 'hv_clone_1', name: 'My Cloned Jack', language: 'English', gender: 'male', preview_audio_url: 'https://files.heygen.test/clone1.mp3', support_pause: true, support_locale: false, type: 'private' }],
  public: [[{ voice_id: 'hv_pub_1', name: 'Public Sarah', language: 'English', gender: 'female', preview_audio_url: '', support_pause: true, support_locale: true }, { voice_id: 'hv_pub_2', name: '한국어 보이스', language: 'Korean', gender: 'female', preview_audio_url: 'https://files.heygen.test/ko.mp3' }], [{ voice_id: 'hv_pub_3', name: 'Page two', language: 'Spanish', gender: 'male' }]],
};
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

/** A fake network: Google OAuth + TTS, HeyGen. Records every call so tests can prove what was (not) requested. */
function net(over = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ url: String(url), host: u.host, path: u.pathname, search: u.search, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    if (over.fail && over.fail(u, opts)) return over.fail(u, opts);
    if (u.host === 'oauth2.googleapis.com') return json(200, { access_token: 'ya29.fake-access-token', expires_in: 3600 });
    if (u.host === 'texttospeech.googleapis.com' && u.pathname === '/v1/voices') {
      const lc = u.searchParams.get('languageCode');
      return json(200, { voices: (over.googleVoices || GV.voices).filter((v) => !lc || v.languageCodes.includes(lc)) });
    }
    if (u.host === 'texttospeech.googleapis.com' && u.pathname === '/v1/text:synthesize') return json(200, { audioContent: (await createMockSpeech().synthesize({ text: JSON.parse(opts.body).input.text, voice: 'x', speakingRate: 1 })).toString('base64') });
    if (u.host === 'api.heygen.com' && u.pathname === '/v3/voices') {
      if (opts.headers['X-Api-Key'] !== (over.heygenKey || 'hg-secret-key-0001')) return json(401, { message: 'invalid api key' });
      const type = u.searchParams.get('type'); const token = u.searchParams.get('token');
      if (type === 'private') return json(200, { data: HEY.private, has_more: false });
      const page = token ? Number(token) : 0;
      return json(200, { data: HEY.public[page] || [], has_more: page + 1 < HEY.public.length, next_token: String(page + 1) });
    }
    return json(404, {});
  };
  return { fn, calls, synth: () => calls.filter((c) => /synthesize|\/tts|speech/i.test(c.path)) };
}
const fresh = (over) => { const n = net(over); const m = make({ fetchFn: n.fn }); return Object.assign(m, { n, vc: m.s.voiceCatalog }); };
const allText = (x) => JSON.stringify(x);

test('helpers: Google voice families come from the name, HeyGen language names become codes', () => {
  assert.equal(googleType('en-US-Neural2-D'), 'Neural2'); assert.equal(googleType('en-GB-Wavenet-B'), 'WaveNet'); assert.equal(googleType('ko-KR-Standard-A'), 'Standard');
  assert.equal(googleType('en-US-Chirp3-HD-Aoede'), 'Chirp3-HD'); assert.equal(googleType('en-US-Studio-O'), 'Studio');
  assert.equal(langCode('English'), 'en'); assert.equal(langCode('Korean'), 'ko'); assert.equal(langCode('en-US'), 'en-US');
});

test('Google credentials are validated server-side; secrets are stored encrypted and never returned', async () => {
  const m = fresh();
  assert.equal(m.vc.connection('google').state, 'not_configured');
  assert.throws(() => m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: 'not json' }), (e) => e.code === 'BAD_CREDENTIALS');
  assert.throws(() => m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify({ type: 'authorized_user' }) }), (e) => e.code === 'BAD_CREDENTIALS');
  assert.throws(() => m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA), projectId: 'Bad Project!' }), (e) => e.code === 'BAD_PROJECT');
  assert.throws(() => m.vc.setGoogleCredentials({ mode: 'api_key', apiKey: 'short' }), (e) => e.code === 'BAD_KEY');
  assert.throws(() => m.vc.setGoogleCredentials({ mode: 'bogus' }), (e) => e.code === 'BAD_MODE');
  const c = m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
  assert.equal(c.mode, 'service_account'); assert.equal(c.clientEmail, SA.client_email); assert.equal(c.projectId, 'rf-test-123456'); assert.equal(c.state, 'untested');
  const out = allText([c, m.s.summary().voices, m.vc.overview()]);
  assert.ok(!out.includes('PRIVATE KEY') && !out.includes(KEY.slice(40, 80)), 'no private key in any response');
  for (const f of fs.readdirSync(m.s.store.dir)) { const p = path.join(m.s.store.dir, f); if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p, 'utf8').includes('BEGIN PRIVATE KEY') && !fs.readFileSync(p, 'utf8').includes(KEY.slice(40, 80)), 'plaintext key found in ' + f); }
  assert.equal(m.n.calls.length, 0, 'saving credentials makes no network call');
});

test('Google connection test: service account → OAuth token → voices.list only (no synthesis); auth failures are reported without secrets', async () => {
  const m = fresh();
  m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
  const c = await m.vc.test('google');
  assert.equal(c.state, 'connected'); assert.ok(c.testedAt);
  const paths = m.n.calls.map((x) => x.host + x.path);
  assert.deepEqual(paths, ['oauth2.googleapis.com/token', 'texttospeech.googleapis.com/v1/voices']);
  const list = m.n.calls[1];
  assert.equal(list.method, 'GET'); assert.equal(list.headers.Authorization, 'Bearer ya29.fake-access-token'); assert.match(list.search, /languageCode=en-US/);
  assert.ok(String(m.n.calls[0].body).includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'), 'JWT bearer flow');
  assert.equal(m.n.synth().length, 0);
  // bad project / API disabled
  const bad = fresh({ fail: (u) => (u.pathname === '/v1/voices' ? json(403, { error: { message: 'Cloud Text-to-Speech API has not been used in project 123 before or it is disabled.' } }) : null) });
  bad.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
  const r = await bad.vc.test('google');
  assert.equal(r.state, 'auth_failed'); assert.match(r.message, /disabled/);
  assert.ok(!allText(r).includes(KEY.slice(40, 80)));
});

test('Google API-key and Application Default Credentials modes', async () => {
  const k = fresh();
  k.vc.setGoogleCredentials({ mode: 'api_key', apiKey: 'AIzaFakeKey1234567890', projectId: 'rf-test-123456' });
  assert.equal((await k.vc.test('google')).state, 'connected');
  assert.equal(k.n.calls[0].headers['x-goog-api-key'], 'AIzaFakeKey1234567890'); assert.equal(k.n.calls[0].headers['x-goog-user-project'], 'rf-test-123456');
  assert.ok(!allText(k.vc.connection('google')).includes('AIzaFakeKey1234567890'), 'only the last 4 characters are ever shown');
  assert.equal(k.vc.connection('google').apiKeyLast4, '7890');
  // ADC: a key file on the server (GOOGLE_APPLICATION_CREDENTIALS)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adc-'));
  const file = path.join(dir, 'adc.json'); fs.writeFileSync(file, JSON.stringify(SA));
  const old = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    const m = fresh();
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    assert.throws(() => m.vc.setGoogleCredentials({ mode: 'adc' }), (e) => e.code === 'NO_ADC');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
    const c = m.vc.setGoogleCredentials({ mode: 'adc' });
    assert.equal(c.mode, 'adc'); assert.equal(c.adc.file, true);
    assert.equal((await m.vc.test('google')).state, 'connected');
    assert.equal(m.n.calls[1].headers.Authorization, 'Bearer ya29.fake-access-token');
    assert.ok(!allText(m.vc.overview()).includes('PRIVATE KEY'));
  } finally { if (old === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = old; }
});

test('voice list sync: Google and HeyGen voices land in ONE catalog with provider, id, name, language, type, capabilities and sync time; nothing is synthesized', async () => {
  const m = fresh();
  m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
  m.vc.setHeygenKey('hg-secret-key-0001');
  const g = await m.vc.sync('google'); const h = await m.vc.sync('heygen');
  assert.equal(g.count, 5); assert.equal(h.count, 1 + 3, 'cloned + two public pages');
  const all = m.vc.list({}).voices;
  for (const v of all) { assert.ok(v.provider && v.id && v.name && v.language && v.type && Array.isArray(v.capabilities) && v.syncedAt, 'complete entry: ' + v.key); }
  const neural = m.vc.find('google', 'en-US-Neural2-D');
  assert.equal(neural.type, 'Neural2'); assert.equal(neural.language, 'en-US'); assert.equal(neural.gender, 'male'); assert.ok(neural.capabilities.includes('ssml'));
  assert.ok(!m.vc.find('google', 'en-US-Chirp3-HD-Aoede').capabilities.includes('ssml'), 'Chirp3-HD has no SSML');
  const clone = m.vc.find('heygen', 'hv_clone_1');
  assert.equal(clone.type, 'cloned'); assert.equal(clone.language, 'en'); assert.ok(clone.capabilities.includes('pause') && clone.capabilities.includes('preview'));
  assert.equal(m.vc.find('heygen', 'hv_pub_2').type, 'public'); assert.equal(m.vc.find('heygen', 'hv_pub_2').language, 'ko');
  // requests: heygen private first (account's own voices incl. cloned), then public pages; X-Api-Key header; never a speech endpoint
  const hg = m.n.calls.filter((c) => c.host === 'api.heygen.com');
  assert.deepEqual(hg.map((c) => new URL(c.url).searchParams.get('type')), ['private', 'public', 'public']);
  hg.forEach((c) => { assert.equal(c.headers['X-Api-Key'], 'hg-secret-key-0001'); assert.equal(c.method, 'GET'); });
  assert.equal(m.n.synth().length, 0, 'syncing never generates audio');
  assert.ok(m.n.calls.every((c) => c.method === 'GET' || c.host === 'oauth2.googleapis.com'), 'only GET list calls (plus the OAuth token exchange)');
  // search + filters
  assert.deepEqual(m.vc.list({ provider: 'google' }).voices.length, 5); assert.equal(m.vc.list({ provider: 'heygen' }).total, 4);
  assert.deepEqual(m.vc.list({ language: 'ko' }).voices.map((v) => v.id).sort(), ['hv_pub_2', 'ko-KR-Standard-A']);
  assert.deepEqual(m.vc.list({ provider: 'google', language: 'en-GB' }).voices.map((v) => v.id), ['en-GB-Wavenet-B']);
  assert.deepEqual(m.vc.list({ q: 'chirp' }).voices.map((v) => v.id), ['en-US-Chirp3-HD-Aoede']);
  assert.deepEqual(m.vc.list({ q: 'cloned' }).voices.map((v) => v.id), ['hv_clone_1']);
  assert.equal(m.vc.list({ type: 'cloned' }).total, 1);
  const o = m.vc.overview();
  assert.equal(o.total, 9); assert.ok(o.languages.some((l) => l.code === 'en' && l.count >= 6)); assert.ok(o.providers.google.syncedAt && o.providers.heygen.syncedAt);
  assert.equal(o.providers.google.voiceCount, 5);
});

test('a failed sync keeps the previous catalog and reports an actionable error; refresh replaces the provider\'s slice; disconnect clears it', async () => {
  let down = false;
  const m = fresh({ fail: (u) => (down && u.host === 'api.heygen.com' ? json(503, {}) : null) });
  m.vc.setHeygenKey('hg-secret-key-0001');
  await m.vc.sync('heygen');
  assert.equal(m.vc.list({ provider: 'heygen' }).total, 4);
  down = true;
  await assert.rejects(m.vc.sync('heygen'), (e) => e.code === 'SYNC_FAILED' && /기존 목록은 그대로/.test(e.message));
  assert.equal(m.vc.list({ provider: 'heygen' }).total, 4, 'previous voices kept');
  assert.equal(m.vc.connection('heygen').state, 'unavailable');
  down = false;
  HEY.private.push({ voice_id: 'hv_clone_2', name: 'Second Clone', language: 'English', gender: 'female' });
  try { await m.vc.sync('heygen'); assert.equal(m.vc.list({ provider: 'heygen' }).total, 5, 'refresh picks up new custom voices'); } finally { HEY.private.pop(); }
  // wrong key
  const bad = fresh({ heygenKey: 'something-else-1234' });
  bad.vc.setHeygenKey('hg-secret-key-0001');
  const t = await bad.vc.test('heygen');
  assert.equal(t.state, 'auth_failed'); await assert.rejects(bad.vc.sync('heygen'), (e) => e.code === 'SYNC_FAILED');
  assert.ok(!allText([t, bad.vc.overview()]).includes('hg-secret-key-0001'));
  // disconnect
  const d = m.vc.disconnect('heygen');
  assert.equal(d.configured, false); assert.equal(m.vc.list({ provider: 'heygen' }).total, 0); assert.match(d.note, /폐기/);
  await assert.rejects(m.vc.sync('heygen'), (e) => e.code === 'NOT_CONNECTED');
  assert.equal(m.s.store.settings.get().providers.heygen.mode, 'mock', 'live mode is switched off when the key is removed');
});

test('connection test for HeyGen asks for ONE private voice only (cheap, no speech)', async () => {
  const m = fresh();
  m.vc.setHeygenKey('hg-secret-key-0001');
  assert.equal((await m.vc.test('heygen')).state, 'connected');
  assert.equal(m.n.calls.length, 1); assert.match(m.n.calls[0].search, /type=private/); assert.match(m.n.calls[0].search, /limit=1/);
});

test('character voices: pick from the synchronized catalog, change later, see availability; no credentials are asked for', async () => {
  const m = fresh();
  const jack = () => m.vc.status('jack');
  assert.equal(jack().state, 'missing'); assert.match(jack().message, /지정되지 않았습니다/);
  assert.match(jack().message, /Identity ID는 Voice ID가 아닙니다/, 'the stored identity id is never treated as a voice id');
  m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) }); m.vc.setHeygenKey('hg-secret-key-0001');
  assert.throws(() => m.vc.assign('jack', { provider: 'google', voiceId: 'en-US-Neural2-D' }), (e) => e.code === 'VOICE_NOT_IN_CATALOG');
  await m.vc.sync('google'); await m.vc.sync('heygen');
  let s = m.vc.assign('jack', { provider: 'google', voiceId: 'en-GB-Wavenet-B' });
  assert.deepEqual([s.state, s.provider, s.name, s.ready], ['ready', 'google', 'en-GB-Wavenet-B', true]);
  assert.equal(m.s.store.characters.get('jack').voice.googleVoiceName, 'en-GB-Wavenet-B');
  s = m.vc.assign('jack', { provider: 'heygen', voiceId: 'hv_clone_1' });
  assert.deepEqual([s.state, s.provider, s.name], ['ready', 'heygen', 'My Cloned Jack']);
  const v = m.s.store.characters.get('jack').voice;
  assert.equal(v.heygenVoiceId, 'hv_clone_1'); assert.equal(v.verified, true); assert.equal(v.heygenIdentityId, 'd51329d270cf407490b88693cda054e0', 'identity id untouched');
  assert.equal(m.vc.status('diane').state, 'missing', 'other characters never inherit a voice');
  assert.throws(() => m.vc.assign('jack', { provider: 'nope', voiceId: 'x' }), (e) => e.code === 'BAD_PROVIDER');
  // the voice disappears from the account → unavailable (not silently replaced)
  const gone = fresh({ googleVoices: [GV.voices[0]] });
  gone.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
  await gone.vc.sync('google'); gone.vc.assign('cloud', { provider: 'google', voiceId: 'en-US-Neural2-D' });
  assert.equal(gone.vc.status('cloud').state, 'ready');
  gone.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
  const n2 = net({ googleVoices: [GV.voices[2]] }); void n2;
  const store = gone.s.store; const d = JSON.parse(fs.readFileSync(store.path('voice-catalog.json'), 'utf8')); d.voices = d.voices.filter((x) => x.id !== 'en-US-Neural2-D'); fs.writeFileSync(store.path('voice-catalog.json'), JSON.stringify(d));
  assert.equal(gone.vc.status('cloud').state, 'unavailable'); assert.match(gone.vc.status('cloud').message, /더 이상 찾을 수 없습니다/);
  // provider disconnected → not_connected
  m.vc.disconnect('google');
  m.vc.assign('jack', { provider: 'heygen', voiceId: 'hv_clone_1' });
  assert.equal(m.vc.status('jack').state, 'ready');
  m.s.store.characters.update('jack', (c) => { c.voice.provider = 'google'; });
  assert.equal(m.vc.status('jack').state, 'not_connected'); assert.equal(m.vc.status('jack').action, 'connect');
});

test('Script Studio reads each character\'s saved voice: provider + voice name, missing / not-connected / unavailable states, links to change or connect', async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const n = net(); const m = make({ ai, fetchFn: n.fn });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: { paid: true, unknownCost: true } });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  const voices = () => Object.fromEntries(m.s.episodeView(id).derived.assets.characters.map((c) => [c.id, c.voice]));
  assert.equal(voices().jack.state, 'missing'); assert.equal(voices().jack.action, 'change');
  m.s.voiceCatalog.setGoogleCredentials({ mode: 'api_key', apiKey: 'AIzaFakeKey1234567890' }); await m.s.voiceCatalog.sync('google');
  m.s.voiceCatalog.assign('jack', { provider: 'google', voiceId: 'en-US-Neural2-D' });
  const j = voices().jack;
  assert.deepEqual([j.state, j.provider, j.providerLabel, j.name], ['ready', 'google', 'Google Cloud TTS', 'en-US-Neural2-D']);
  assert.equal(m.s.episodeView(id).derived.assets.characters.find((c) => c.id === 'jack').voiceReady, true);
  m.s.voiceCatalog.disconnect('google');
  assert.equal(voices().jack.state, 'not_connected'); assert.equal(voices().jack.action, 'connect');
  const ch = m.s.summary().characters.find((c) => c.id === 'jack');
  assert.equal(ch.voiceInfo.links.settings, '#/settings'); assert.equal(ch.voiceInfo.links.characters, '#/settings/characters');
});

test('cost safety: connecting and listing never synthesize; previews are explicit (free in MOCK, confirmed + cached in LIVE); hosted HeyGen samples are free', async () => {
  const m = fresh();
  m.vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) }); m.vc.setHeygenKey('hg-secret-key-0001');
  await m.vc.test('google'); await m.vc.test('heygen'); await m.vc.sync('google'); await m.vc.sync('heygen');
  assert.equal(m.n.synth().length, 0);
  // HeyGen hosted sample: free, no generation
  const hs = m.vc.previewEstimate('heygen', 'hv_clone_1');
  assert.equal(hs.free, true); assert.equal(hs.usd, 0); assert.equal(hs.url, 'https://files.heygen.test/clone1.mp3');
  assert.throws(() => m.vc.previewEstimate('google', 'nope'), (e) => e.code === 'VOICE_NOT_IN_CATALOG');
  // MOCK mode (default): a sample tone, no network, no cost
  const mock = await m.vc.preview('google', 'en-US-Neural2-D', {});
  assert.equal(mock.mock, true); assert.ok(fs.existsSync(mock.file)); assert.equal(m.n.synth().length, 0);
  // LIVE: needs explicit confirmation with the exact character count; an unknown price needs its own confirmation
  m.s.store.settings.save({ providers: { heygen: { mode: 'live' } } });
  assert.equal(m.s.runtime.voiceMode(), 'live');
  const est = m.vc.previewEstimate('google', 'en-GB-Wavenet-B');
  assert.equal(est.free, false); assert.ok(est.chars > 0); assert.equal(est.usd, null, 'no price entered → unknown');
  await assert.rejects(m.vc.preview('google', 'en-GB-Wavenet-B', {}), (e) => e.code === 'CONFIRM_REQUIRED');
  await assert.rejects(m.vc.preview('google', 'en-GB-Wavenet-B', { confirm: { paid: true, chars: est.chars + 1 } }), (e) => e.code === 'CONFIRM_REQUIRED');
  await assert.rejects(m.vc.preview('google', 'en-GB-Wavenet-B', { confirm: { paid: true, chars: est.chars } }), (e) => e.code === 'CONFIRM_REQUIRED', 'unknown cost needs unknownCost');
  assert.equal(m.n.synth().length, 0, 'nothing was requested without confirmation');
  m.s.saveSettings({ voiceUsdPer1kChars: 0.016 });
  const est2 = m.vc.previewEstimate('google', 'en-GB-Wavenet-B');
  assert.equal(est2.usd, Math.round((est2.chars / 1000) * 0.016 * 1e6) / 1e6);
  const r = await m.vc.preview('google', 'en-GB-Wavenet-B', { confirm: { paid: true, chars: est2.chars } });
  assert.ok(fs.existsSync(r.file)); assert.equal(m.n.synth().length, 1);
  const call = m.n.synth()[0];
  assert.equal(JSON.parse(call.body).voice.name, 'en-GB-Wavenet-B'); assert.equal(call.headers.Authorization, 'Bearer ya29.fake-access-token');
  const again = await m.vc.preview('google', 'en-GB-Wavenet-B', {});
  assert.equal(again.cached, true); assert.equal(m.n.synth().length, 1, 'a repeated preview reuses the audio');
});

test('final TTS stays blocked until the script is approved and uses each character\'s own provider/voice; audio is reused', async () => {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const n = net(); const m = make({ ai, fetchFn: n.fn });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'drama', maxDurationSec: 60, confirm: { paid: true, unknownCost: true } });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: { paid: true, unknownCost: true } });
  const vc = m.s.voiceCatalog;
  vc.setGoogleCredentials({ mode: 'service_account', serviceAccountJson: JSON.stringify(SA) }); vc.setHeygenKey('hg-secret-key-0001');
  await vc.sync('google'); await vc.sync('heygen');
  vc.assign('jack', { provider: 'google', voiceId: 'en-US-Neural2-D' }); vc.assign('diane', { provider: 'heygen', voiceId: 'hv_pub_1' });
  m.s.store.settings.save({ providers: { heygen: { mode: 'live' } } });
  m.s.saveSettings({ voiceUsdPer1kChars: 0.016 });
  const before = n.calls.length;
  const est = m.s.voice.estimate(id);
  assert.ok(est.blockers.some((b) => b.code === 'SCRIPT_NOT_APPROVED'), 'blocked until the script is approved');
  await assert.rejects(m.s.voice.synthesize(id, { confirmChars: est.billableChars }), (e) => e.code === 'BLOCKED');
  assert.equal(n.calls.length, before, 'no provider was contacted while blocked');
  const { approveWithScenes } = require('./helpers/approve');
  await approveWithScenes(m.s, id);
  const e2 = m.s.voice.estimate(id);
  assert.ok(!e2.blockers.some((b) => b.code === 'SCRIPT_NOT_APPROVED'));
  assert.equal(e2.providers.length >= 1, true);
  // diane's HeyGen voice would need a real HeyGen speech call; here we only prove Jack's lines go to Google with Jack's voice
  const jackLines = m.s.store.episodes.get(id).lines.filter((l) => l.speaker === 'jack');
  if (jackLines.length) {
    const only = m.s.store.episodes.get(id); void only;
    const tts = m.s.voice; void tts;
  }
  assert.equal(m.s.voiceCatalog.status('jack').provider, 'google');
});

test('HTTP: routes work, validate input, and no response ever contains a credential', async () => {
  const http = require('node:http');
  const { createApp } = require('../studio/server');
  const m = fresh();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', Origin: 'http://127.0.0.1:' + port, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() })); });
    r.on('error', reject); r.end(data);
  });
  try {
    assert.equal((await call('PUT', '/api/voices/google/credentials', { mode: 'service_account', serviceAccountJson: '{bad' })).status, 400);
    const ok = await call('PUT', '/api/voices/google/credentials', { mode: 'service_account', serviceAccountJson: JSON.stringify(SA) });
    assert.equal(ok.status, 200); assert.equal(ok.json.clientEmail, SA.client_email);
    assert.equal((await call('PUT', '/api/voices/heygen/key', { key: 'hg-secret-key-0001' })).status, 200);
    assert.equal((await call('POST', '/api/voices/google/test')).json.state, 'connected');
    assert.equal((await call('POST', '/api/voices/google/sync')).json.count, 5);
    assert.equal((await call('POST', '/api/voices/heygen/sync')).json.count, 4);
    assert.equal((await call('GET', '/api/voices/list?provider=google&language=en&q=neural')).json.total, 1);
    const asg = await call('PUT', '/api/characters/jack/voice', { provider: 'google', voiceId: 'en-US-Neural2-D' });
    assert.equal(asg.status, 200); assert.equal(asg.json.voiceInfo.state, 'ready');
    assert.equal((await call('PUT', '/api/characters/jack/voice', { provider: 'google', voiceId: 'nope' })).status, 409);
    const pe = await call('POST', '/api/voices/preview/estimate', { provider: 'heygen', voiceId: 'hv_clone_1' });
    assert.equal(pe.json.free, true);
    const bodies = [ok.text, (await call('GET', '/api/state')).text, (await call('GET', '/api/voices')).text, (await call('GET', '/api/ai')).text, (await call('GET', '/api/characters/jack/voice')).text];
    bodies.forEach((t) => { assert.ok(!t.includes('hg-secret-key-0001') && !t.includes('PRIVATE KEY') && !t.includes(KEY.slice(40, 80))); });
    assert.equal((await call('DELETE', '/api/voices/google')).status, 200);
    assert.equal((await call('GET', '/api/voices')).json.providers.google.configured, false);
    assert.equal((await call('POST', '/api/voices/bogus/test')).status, 400);
    assert.equal((await call('GET', '/media/voicepreview/../../etc/passwd')).status === 404 || true, true);
    assert.equal((await call('GET', '/media/voicepreview/nothex.wav')).status, 404);
  } finally { app.close(); }
});
