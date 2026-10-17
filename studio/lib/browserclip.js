'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { probe } = require('../../renderer/lib/ffmpeg');
/** Keep the provider original intact. Only derived copies are used by browser preview. */
async function browserMp4(source, destination, cfg) {
  const original = await probe(cfg.ffmpeg.ffprobe, source);
  const video = (original.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error('No video stream');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = destination + '.processing.mp4';
  const audio = (original.streams || []).find((s) => s.codec_type === 'audio');
  const safeVideo = video.codec_name === 'h264' && video.pix_fmt === 'yuv420p';
  const args = safeVideo
    ? ['-hide_banner','-loglevel','error','-y','-i',source,'-map','0:v:0','-map','0:a:0?','-c:v','copy','-c:a',audio && audio.codec_name === 'aac' ? 'copy' : 'aac','-movflags','+faststart',temp]
    : ['-hide_banner','-loglevel','error','-y','-i',source,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-pix_fmt','yuv420p','-preset','medium','-crf','20','-c:a','aac','-b:a','128k','-movflags','+faststart',temp];
  try {
    await run(cfg.ffmpeg.ffmpeg, args, { timeout: 120000 });
    const checked = await probe(cfg.ffmpeg.ffprobe, temp);
    const out = checked.streams.find((s) => s.codec_type === 'video');
    if (out.codec_name !== 'h264' || out.pix_fmt !== 'yuv420p') throw new Error('Browser MP4 codec verification failed');
    fs.renameSync(temp, destination);
    return { compatibility: safeVideo ? 'faststart-remux' : 'h264-transcode', originalCodec: video.codec_name, originalPixelFormat: video.pix_fmt };
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); }
}
module.exports = { browserMp4 };
