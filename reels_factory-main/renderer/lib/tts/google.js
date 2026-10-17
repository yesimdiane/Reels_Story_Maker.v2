// Google Cloud Text-to-Speech (REST v1). Auth: API key (Mac) or OAuth token (cloud / gcloud ADC).
'use strict';
const { execFileSync } = require('node:child_process');

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** Auth strategies: { headers(): Promise<object> }. */
function apiKeyAuth(key) {
  return { kind: 'apiKey', headers: async () => ({ 'x-goog-api-key': key }) };
}
// Cloud Run / GCE / GKE: token from the metadata server for the attached service account.
function metadataAuth(fetchFn = fetch) {
  return {
    kind: 'metadata',
    headers: async () => {
      const r = await fetchFn('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
        headers: { 'Metadata-Flavor': 'Google' },
      });
      if (!r.ok) throw new Error('메타데이터 서버에서 토큰을 받지 못했습니다 (HTTP ' + r.status + ')');
      return { Authorization: 'Bearer ' + (await r.json()).access_token };
    },
  };
}
// Local Application Default Credentials via gcloud (alternative to an API key on the Mac).
function gcloudAuth(project) {
  return {
    kind: 'gcloud',
    headers: async () => {
      const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim();
      const h = { Authorization: 'Bearer ' + token };
      if (project) h['x-goog-user-project'] = project;
      return h;
    },
  };
}

function hintFor(status, message) {
  if (status === 400 && /voice/i.test(message)) return ' (RF_TTS_VOICE 이름을 확인하세요. 예: ko-KR-Wavenet-A)';
  if (status === 401 || status === 403) {
    return ' (Google Cloud 콘솔에서 Text-to-Speech API 사용 설정·결제 계정 연결·API 키 제한을 확인하세요)';
  }
  if (status === 429) return ' (요청 한도 초과 — 잠시 후 다시 시도)';
  return '';
}

// Retried only when Google refused the request before synthesising it (rate limit / temporarily
// unavailable). Other errors, including network failures after the request was sent, are NOT retried:
// a second paid request is never made automatically for audio that may already have been produced.
const RETRY_STATUSES = [429, 503];

function createGoogleTts({ auth, fetchFn = fetch, sampleRate = 24000, maxAttempts = 3, retryDelayMs = 1000 }) {
  return {
    name: 'google',
    paid: true,
    reportsAttempts: true,
    /** onAttempt(): called before every request that is sent, so the ledger counts each one. */
    async synthesize({ text, voice, speakingRate, onAttempt }) {
      const body = {
        input: { text },
        voice: { languageCode: voice.slice(0, 5), name: voice },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: sampleRate, speakingRate },
      };
      let lastErr;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, await auth.headers());
        if (onAttempt) onAttempt(attempt);
        const res = await fetchFn(ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.audioContent) return Buffer.from(json.audioContent, 'base64'); // LINEAR16 includes a WAV header
        const message = (json.error && json.error.message) || 'HTTP ' + res.status;
        lastErr = new Error('Google TTS 오류 HTTP ' + res.status + hintFor(res.status, message) + ': ' + message);
        if (!RETRY_STATUSES.includes(res.status) || attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      }
      throw lastErr;
    },
  };
}

module.exports = { createGoogleTts, apiKeyAuth, metadataAuth, gcloudAuth, ENDPOINT, RETRY_STATUSES };
