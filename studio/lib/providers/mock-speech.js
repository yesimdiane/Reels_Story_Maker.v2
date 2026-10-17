// MOCK speech: a short, character-specific tone pattern with a realistic English speaking length. Never billed.
'use strict';
const crypto = require('node:crypto');
const { estimateSpeechSec } = require('../episode');

function createMockSpeech() {
  const calls = [];
  return {
    name: 'mock-speech',
    paid: false,
    calls,
    async synthesize({ text, voice, speakingRate = 1 }) {
      calls.push({ text, voice });
      const rate = 24000;
      const dur = Math.max(0.6, estimateSpeechSec(text) / (speakingRate || 1) - 0.1);
      const n = Math.round(dur * rate);
      const base = 140 + (parseInt(crypto.createHash('md5').update(String(voice)).digest('hex').slice(0, 2), 16) % 140);
      const pcm = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const syll = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.6 * t);
        const env = Math.min(1, t * 20, (dur - t) * 20) * syll;
        const s = Math.sin(2 * Math.PI * base * t) * 0.18 * env;
        pcm.writeInt16LE(Math.round(s * 32767), i * 2);
      }
      const h = Buffer.alloc(44);
      h.write('RIFF', 0, 'ascii');
      h.writeUInt32LE(36 + pcm.length, 4);
      h.write('WAVEfmt ', 8, 'ascii');
      h.writeUInt32LE(16, 16);
      h.writeUInt16LE(1, 20);
      h.writeUInt16LE(1, 22);
      h.writeUInt32LE(rate, 24);
      h.writeUInt32LE(rate * 2, 28);
      h.writeUInt16LE(2, 32);
      h.writeUInt16LE(16, 34);
      h.write('data', 36, 'ascii');
      h.writeUInt32LE(pcm.length, 40);
      return Buffer.concat([h, pcm]);
    },
  };
}
module.exports = { createMockSpeech };
