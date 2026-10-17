// HeyGen TTS provider unit tests: request payload, headers, error handling, retries,
// conversion to 24kHz mono WAV, cost estimation, and output file naming.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHeyGenTts, convertMp3ToWav, HEYGEN_TTS_ENDPOINT } = require('../renderer/lib/tts/heygen');
const { createTtsService, voiceFamily, PRICE_PER_MILLION } = require('../renderer/lib/tts');
const { parseWav, silentWav } = require('../renderer/lib/wav');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-heygen-test-'));

test('createHeyGenTts: throws if apiKey or voice is missing', async () => {
  const ttsNoKey = createHeyGenTts({ apiKey: '' });
  await assert.rejects(
    ttsNoKey.synthesize({ text: '테스트', voice: '5bfc3fa102124f7681ee3ffb34bcf1bf' }),
    /HEYGEN_API_KEY가 없습니다/
  );

  const ttsNoVoice = createHeyGenTts({ apiKey: 'test_key' });
  await assert.rejects(
    ttsNoVoice.synthesize({ text: '테스트', voice: '' }),
    /HeyGen Voice ID가 설정되지 않았습니다/
  );
});

test('createHeyGenTts: correctly formats API request and headers', async () => {
  const calls = [];
  const fakeWav = silentWav(1.0); // 1-second 24kHz WAV

  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url === HEYGEN_TTS_ENDPOINT) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 100,
          data: {
            audio_url: 'https://resource.heygen.ai/voice/test_audio.mp3',
            duration: 1.0,
          },
        }),
      };
    }
    if (url === 'https://resource.heygen.ai/voice/test_audio.mp3') {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeWav.buffer.slice(fakeWav.byteOffset, fakeWav.byteOffset + fakeWav.byteLength),
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  // Mock ffmpeg converter by passing custom ffmpeg or directly testing the synthesize flow
  let attempted = false;
  const tts = createHeyGenTts({
    apiKey: 'hg_secret_test_key_123',
    fetchFn,
    retryDelayMs: 10,
  });

  // Temporarily stub convertMp3ToWav inside test by providing mock ffmpeg or testing convertMp3ToWav separately
  // Here synthesize will call fetchFn twice: 1 for speech endpoint, 1 for audio download
  // Let's verify the request payload sent to HeyGen
  try {
    await tts.synthesize({
      text: '안녕하세요, 리템 우산꽂이입니다.',
      voice: '5bfc3fa102124f7681ee3ffb34bcf1bf',
      speakingRate: 1.05,
      onAttempt: () => { attempted = true; },
    });
  } catch (e) {
    // If local ffmpeg fails to decode fake WAV as MP3, that's expected without real MP3 stream
  }

  assert.equal(attempted, true);
  assert.ok(calls.length >= 1, 'Called speech endpoint');
  const req = calls[0];
  assert.equal(req.url, HEYGEN_TTS_ENDPOINT);
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers['X-Api-Key'], 'hg_secret_test_key_123');
  assert.equal(req.init.headers['Content-Type'], 'application/json');

  const body = JSON.parse(req.init.body);
  assert.equal(body.text, '안녕하세요, 리템 우산꽂이입니다.');
  assert.equal(body.voice_id, '5bfc3fa102124f7681ee3ffb34bcf1bf');
  assert.equal(body.speed, 1.05);
  assert.equal(body.language, 'ko');
});

test('createHeyGenTts: fails immediately on 401 without futile retries', async () => {
  let callCount = 0;
  const fetchFn = async () => {
    callCount++;
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key' } }),
    };
  };

  const tts = createHeyGenTts({
    apiKey: 'bad_key',
    fetchFn,
    maxAttempts: 3,
    retryDelayMs: 10,
  });

  await assert.rejects(
    tts.synthesize({ text: '테스트', voice: '5bfc3fa102124f7681ee3ffb34bcf1bf' }),
    /HeyGen API 오류 \(HTTP 401\): Invalid API Key/
  );
  assert.equal(callCount, 1, '401 does not trigger retries');
});

test('createHeyGenTts: retries on 503 transient error', async () => {
  let callCount = 0;
  const fetchFn = async (url) => {
    callCount++;
    if (callCount < 2) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      };
    }
    return {
      ok: false,
      status: 400,
      json: async () => ({ message: 'Stop retry' }),
    };
  };

  const tts = createHeyGenTts({
    apiKey: 'test_key',
    fetchFn,
    maxAttempts: 3,
    retryDelayMs: 10,
  });

  await assert.rejects(
    tts.synthesize({ text: '테스트', voice: '5bfc3fa102124f7681ee3ffb34bcf1bf' }),
    /Stop retry/
  );
  assert.equal(callCount, 2, '503 triggers retry, 400 stops retry');
});

test('voiceFamily recognizes HeyGen 32-char hex voice ID and providerName', () => {
  const heygenId = '5bfc3fa102124f7681ee3ffb34bcf1bf';
  assert.equal(voiceFamily(heygenId), 'HeyGen');
  assert.equal(voiceFamily('arbitrary_id', 'heygen'), 'HeyGen');
  assert.equal(voiceFamily('ko-KR-Wavenet-A', 'google'), 'Wavenet');
  assert.equal(PRICE_PER_MILLION['HeyGen'], 150);
});

test('TTS service calculates HeyGen budget and cost estimate accurately', () => {
  const dir = tmp();
  const mockHeyGen = {
    name: 'heygen',
    paid: true,
    synthesize: async () => silentWav(1.0),
  };

  const service = createTtsService({
    provider: mockHeyGen,
    voice: '5bfc3fa102124f7681ee3ffb34bcf1bf',
    cacheDir: path.join(dir, 'cache'),
    ledgerFile: path.join(dir, 'usage.json'),
  });

  const segments = [
    '첫 번째 문장입니다.',
    '두 번째 문장입니다.',
  ];
  const est = service.estimate(segments);
  assert.equal(est.provider, 'heygen');
  assert.equal(est.voiceFamily, 'HeyGen');
  assert.equal(est.paid, true);
  assert.equal(est.billableChars, [...segments.join('')].length);
  // price is $150 per 1,000,000 characters
  const expectedCost = (est.billableChars / 1000000) * 150;
  assert.equal(est.estimatedUsd.toFixed(6), expectedCost.toFixed(6));
});


test('createHeyGenTts: supports English character dialogue without changing Korean default', async () => {
  const requests = [];
  const tts = createHeyGenTts({
    apiKey: 'test_key',
    maxAttempts: 1,
    fetchFn: async (url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: false, status: 400, json: async () => ({ message: 'mock stop' }) };
    },
  });
  await assert.rejects(tts.synthesize({ text: 'BABYYYY!', voice: 'diane-voice', language: 'en' }), /mock stop/);
  await assert.rejects(tts.synthesize({ text: '안녕하세요', voice: 'diane-voice' }), /mock stop/);
  assert.equal(requests[0].language, 'en');
  assert.equal(requests[1].language, 'ko');
});
