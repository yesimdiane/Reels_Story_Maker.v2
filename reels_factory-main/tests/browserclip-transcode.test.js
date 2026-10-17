'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { browserMp4 } = require('../studio/lib/browserclip');
const { probe } = require('../renderer/lib/ffmpeg');
test('browser conversion makes playable H264/yuv420p faststart derivative and preserves source', { timeout: 45000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-pr98-'));
  const source = path.join(dir,'original.mp4'), output = path.join(dir,'browser.mp4');
  try {
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=160x284:r=12:d=1','-c:v','mpeg4',source], { timeout: 15000 });
    const oldHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const info = await browserMp4(source,output,{ffmpeg:{ffmpeg:'ffmpeg',ffprobe:'ffprobe'}});
    assert.equal(info.compatibility,'h264-transcode');
    const p = await probe('ffprobe',output);
    const v = p.streams.find(x=>x.codec_type==='video');
    assert.equal(v.codec_name,'h264');
    assert.equal(v.pix_fmt,'yuv420p');
    assert.ok(p.duration > 0.5);
    assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex'),oldHash);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
