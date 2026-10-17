// Test provider: silent audio with a realistic Korean speaking length (~6.5 chars/sec). Never billed.
'use strict';
const { silentWav } = require('../wav');

function createSilentTts({ charsPerSec = 6.5 } = {}) {
  const calls = [];
  return {
    name: 'silent',
    paid: false,
    calls,
    async synthesize({ text, speakingRate }) {
      calls.push(text);
      return silentWav(Math.max(0.6, [...text].length / (charsPerSec * speakingRate)));
    },
  };
}

module.exports = { createSilentTts };
