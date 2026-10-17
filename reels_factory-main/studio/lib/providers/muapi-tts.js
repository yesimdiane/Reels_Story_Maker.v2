// MuAPI ElevenLabs TTS adapter. No automatic paid retries.
// Docs: https://muapi.ai/playground/elevenlabs-tts-turbo-2-5/api
'use strict';
const { convertMp3ToWav } = require('../../../renderer/lib/tts/heygen');
const BASE = 'https://api.muapi.ai/api/v1';
const ENDPOINT = BASE + '/elevenlabs-tts-turbo-2-5';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createMuapiTts({ apiKey, fetchFn = globalThis.fetch, ffmpeg = 'ffmpeg', pollIntervalMs = 3000, maxPolls = 100 }) {
  return {
    name: 'muapi',
    paid: true,
    reportsAttempts: true,
    async synthesize({ text, voice, speakingRate = 1, onAttempt }) {
      if (!apiKey) throw new Error('MuAPI API 키가 설정되지 않았습니다.');
      if (!voice) throw new Error('MuAPI ElevenLabs voice_id가 설정되지 않았습니다.');
      if (!text || !text.trim()) throw new Error('음성 대사가 비어 있습니다.');
      if (onAttempt) onAttempt(); // Record potential spend before the ONLY paid POST.
      const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
      const sent = await fetchFn(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({
        prompt: text, voice_id: voice, speed: Math.max(0.7, Math.min(1.2, Number(speakingRate) || 1)),
      }) });
      if (!sent.ok) throw new Error('MuAPI TTS 요청 실패 (HTTP ' + sent.status + '). 자동 재시도하지 않습니다.');
      const submission = await sent.json();
      const id = submission.request_id;
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('MuAPI TTS 요청 ID를 확인할 수 없습니다. History에서 과금 여부를 확인하세요.');
      for (let n = 0; n < maxPolls; n++) {
        const res = await fetchFn(BASE + '/predictions/' + encodeURIComponent(id) + '/result', { headers: { 'x-api-key': apiKey } });
        if (!res.ok) throw new Error('MuAPI TTS 상태 확인 실패 (HTTP ' + res.status + ', request ' + id + '). 재생성하지 말고 History를 확인하세요.');
        const j = await res.json();
        if (j.status === 'failed') throw new Error('MuAPI TTS 생성 실패 (request ' + id + ').');
        if (j.status === 'completed') {
          const url = (Array.isArray(j.outputs) ? j.outputs[0] : j.outputs) || j.output_url;
          if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('MuAPI TTS 결과 오디오 URL을 찾지 못했습니다 (request ' + id + ').');
          const audio = await fetchFn(url);
          if (!audio.ok) throw new Error('MuAPI TTS 오디오 다운로드 실패 (HTTP ' + audio.status + ', request ' + id + ').');
          const bytes = Buffer.from(await audio.arrayBuffer());
          if (bytes.length < 128 || bytes.length > 32 * 1024 * 1024) throw new Error('MuAPI TTS 오디오 크기가 유효하지 않습니다.');
          return convertMp3ToWav(ffmpeg, bytes);
        }
        if (!['processing', 'pending', 'starting', 'queued'].includes(j.status)) throw new Error('알 수 없는 MuAPI TTS 상태: ' + String(j.status));
        await wait(pollIntervalMs);
      }
      throw new Error('MuAPI TTS 대기 시간 초과 (request ' + id + '). 재생성하지 말고 History에서 확인하세요.');
    },
  };
}
module.exports = { createMuapiTts, ENDPOINT };
