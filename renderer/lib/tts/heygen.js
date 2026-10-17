// HeyGen Text-to-Speech (REST v3).
// Endpoint: POST https://api.heygen.com/v3/voices/speech
// Synthesizes natural speech audio from text using user voice clones without generating avatar videos.
'use strict';
const { execFile } = require('node:child_process');

const HEYGEN_TTS_ENDPOINT = 'https://api.heygen.com/v3/voices/speech';

/** Converts an MP3 buffer into standard PCM WAV buffer (mono, 24000Hz). */
function convertMp3ToWav(ffmpegBin, mp3Buffer, sampleRate = 24000) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      ffmpegBin,
      [
        '-hide_banner',
        '-v', 'error',
        '-i', 'pipe:0',
        '-ar', String(sampleRate),
        '-ac', '1',
        '-f', 'wav',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error('MP3 to WAV 변환 실패: ' + (stderr ? stderr.toString() : err.message)));
        } else {
          resolve(stdout);
        }
      }
    );
    child.stdin.on('error', () => {});
    child.stdin.end(mp3Buffer);
  });
}

function createHeyGenTts({
  apiKey,
  fetchFn = fetch,
  ffmpeg = 'ffmpeg',
  sampleRate = 24000,
  maxAttempts = 3,
  retryDelayMs = 1000,
}) {
  return {
    name: 'heygen',
    paid: true,
    reportsAttempts: true,
    async synthesize({ text, voice, speakingRate, language = 'ko', onAttempt }) {
      if (!apiKey) throw new Error('HEYGEN_API_KEY가 없습니다 (renderer/.env).');
      if (!voice) throw new Error('HeyGen Voice ID가 설정되지 않았습니다.');

      let lastErr = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (onAttempt) onAttempt();
        try {
          const res = await fetchFn(HEYGEN_TTS_ENDPOINT, {
            method: 'POST',
            headers: {
              'X-Api-Key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text,
              voice_id: voice,
              speed: Number(speakingRate) || 1.0,
              language,
            }),
          });

          if (!res.ok) {
            let msg = '';
            try {
              const j = await res.json();
              msg = (j.error && j.error.message) || j.message || JSON.stringify(j);
            } catch {}
            const err = new Error(`HeyGen API 오류 (HTTP ${res.status}): ${msg || '응답 오류'}`);
            err.status = res.status;
            throw err;
          }

          const j = await res.json();
          const audioUrl = j && j.data && j.data.audio_url;
          if (!audioUrl) throw new Error('HeyGen 응답에 audio_url이 없습니다: ' + JSON.stringify(j));

          // Download generated audio (MP3)
          const audioRes = await fetchFn(audioUrl);
          if (!audioRes.ok) {
            const err = new Error(`HeyGen 오디오 다운로드 실패 (HTTP ${audioRes.status})`);
            err.status = audioRes.status;
            throw err;
          }
          const mp3Buf = Buffer.from(await audioRes.arrayBuffer());

          // Convert to PCM WAV (24kHz mono) for seamless integration with parseWav and FFmpeg
          return await convertMp3ToWav(ffmpeg, mp3Buf, sampleRate);
        } catch (e) {
          lastErr = e;
          // Do not retry 4xx errors (except 429 rate limit)
          if (e.status >= 400 && e.status < 500 && e.status !== 429) {
            throw e;
          }
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
          }
        }
      }
      throw lastErr;
    },
  };
}

module.exports = { createHeyGenTts, convertMp3ToWav, HEYGEN_TTS_ENDPOINT };
