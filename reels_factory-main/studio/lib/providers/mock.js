// MOCK video provider. Default for the whole Studio. It never touches the network and never costs anything.
// It really encodes a small 9:16 placeholder clip with FFmpeg (a coloured gradient with a moving block) so the
// review → approval → checksum → render pipeline can be exercised end to end.
'use strict';
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { ProviderError } = require('./muapi');

function hueOf(text) {
  return parseInt(crypto.createHash('md5').update(String(text)).digest('hex').slice(0, 4), 16) % 360;
}
function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return '0x' + hex(f(0)) + hex(f(8)) + hex(f(4));
}

function encodeMockClip(ffmpeg, dest, { seed, duration }) {
  const h = hueOf(seed);
  const c0 = hsl(h, 38, 62);
  const c1 = hsl((h + 40) % 360, 32, 38);
  const d = Math.max(1, Math.min(10, Number(duration) || 5));
  // Colour field + moving block + a thin frame, 360x640 @ 24 fps, H.264 yuv420p, silent.
  const vf = [
    `drawbox=x='(w-130)*abs(sin(t*0.9))':y='h*0.42':w=130:h=190:color=0xF4EDE0@0.55:t=fill`,
    `drawbox=x=12:y=12:w=iw-24:h=ih-24:color=0xF4EDE0@0.35:t=2`,
    'format=yuv420p',
  ].join(',');
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=360x640:d=${d}:r=24:c0=${c0}:c1=${c1}:speed=0.02`, '-vf', vf,
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-metadata', 'comment=REELS-FACTORY-MOCK-CLIP', '-f', 'mp4', dest];
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(new Error('목업 클립 생성 실패: ' + String(stderr).split('\n').slice(-5).join('\n'))) : resolve()));
  });
}

function createMockVideoProvider({ ffmpeg = 'ffmpeg', pollsUntilDone = 2, failWhen = null, latencyMs = 0 } = {}) {
  const jobs = new Map();
  const calls = { submit: 0, poll: 0, download: 0, upload: 0 };
  let n = 0;
  const wait = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : null);
  return {
    name: 'mock',
    mode: 'mock',
    paid: false,
    calls,
    capabilities() {
      return { imageToVideo: true, textToVideo: false, lipSync: false, lipSyncNote: 'Mock mode: no lip-sync.' };
    },
    async balance() {
      return { balance: null };
    },
    async listModels() {
      return { mock: true, models: [] };
    },
    async uploadFile(file) {
      calls.upload += 1;
      return { url: 'mock://upload/' + require('node:path').basename(file), expiresInSec: 3600 };
    },
    async uploadImage(file) {
      calls.upload += 1;
      return { url: 'mock://upload/' + require('node:path').basename(file), expiresInSec: 3600 };
    },
    async submit({ model, prompt, imageUrl, aspectRatio, duration }) {
      calls.submit += 1;
      await wait();
      if (failWhen && failWhen({ prompt, model })) throw new ProviderError('BAD_REQUEST', '목업: 의도된 제출 실패.');
      const id = 'mock_' + String(++n).padStart(4, '0') + '_' + crypto.randomBytes(3).toString('hex');
      jobs.set(id, { polls: 0, duration, seed: prompt + '|' + imageUrl + '|' + (model && model.id), fail: !!(failWhen && failWhen({ prompt, model, phase: 'generate' })) });
      return { requestId: id, status: 'queued', cost: { amountUsd: 0, amountCredits: 0, bonusCreditsUsed: 0, refunded: false, mock: true } };
    },
    async pollOnce(requestId) {
      calls.poll += 1;
      await wait();
      const j = jobs.get(requestId);
      if (!j) throw new ProviderError('BAD_REQUEST', '목업: 알 수 없는 요청 ID ' + requestId);
      j.polls += 1;
      if (j.fail && j.polls >= pollsUntilDone) return { status: 'failed', rawStatus: 'failed', outputs: [], error: '목업: 의도된 생성 실패', cost: { amountUsd: 0, mock: true } };
      if (j.polls < pollsUntilDone) return { status: 'processing', rawStatus: 'processing', outputs: [], error: '', cost: null };
      return { status: 'completed', rawStatus: 'completed', outputs: ['mock://' + requestId + '.mp4'], error: '', cost: { amountUsd: 0, amountCredits: 0, bonusCreditsUsed: 0, refunded: false, mock: true } };
    },
    async waitForResult(requestId, { onProgress } = {}) {
      for (;;) {
        const r = await this.pollOnce(requestId);
        if (onProgress) onProgress(r);
        if (r.status === 'completed') return r;
        if (r.status === 'failed') throw new ProviderError('FAILED', 'Muapi(목업) 생성이 실패했습니다: ' + r.error, { requestId });
      }
    },
    async download(url, dest) {
      calls.download += 1;
      const id = String(url).replace(/^mock:\/\//, '').replace(/\.mp4$/, '');
      const j = jobs.get(id);
      if (!j) throw new ProviderError('NO_OUTPUT', '목업: 알 수 없는 결과 ' + url);
      await encodeMockClip(ffmpeg, dest, { seed: j.seed, duration: j.duration });
      return { size: require('node:fs').statSync(dest).size };
    },
  };
}

module.exports = { createMockVideoProvider };
