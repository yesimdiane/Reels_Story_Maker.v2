// Minimal PCM WAV helpers (no dependencies): duration, silence, and concatenation-free probing.
'use strict';

/** Parses a RIFF/WAVE buffer and returns { sampleRate, channels, bitsPerSample, dataBytes, duration }. */
function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt chunk');
      // Streaming writers (e.g. espeak to stdout) may leave size as 0 or 0xFFFFFFFF.
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      return Object.assign({}, fmt, { dataBytes: size, duration: size / fmt.byteRate });
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** 16-bit mono silent WAV of the given length. */
function silentWav(seconds, sampleRate = 24000) {
  const samples = Math.round(seconds * sampleRate);
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  return b;
}

module.exports = { parseWav, silentWav };
