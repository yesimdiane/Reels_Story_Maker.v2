// Free, offline preview voices (no API, no cost): macOS `say` (Yuna) or Linux `espeak-ng`.
// Quality is for timing previews only — final reels use Google Cloud TTS.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createLocalTts({ platform = process.platform } = {}) {
  return {
    name: 'local-preview',
    paid: false,
    async synthesize({ text, speakingRate }) {
      const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-tts-')), 'seg.wav');
      if (platform === 'darwin') {
        execFileSync('say', ['-v', 'Yuna', '-r', String(Math.round(190 * speakingRate)), '--data-format=LEI16@24000', '-o', out, text]);
      } else {
        execFileSync('espeak-ng', ['-v', 'ko', '-s', String(Math.round(165 * speakingRate)), '-w', out, text]);
      }
      return fs.readFileSync(out);
    },
  };
}

module.exports = { createLocalTts };
