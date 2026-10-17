// FFmpeg/FFprobe wrappers. Capability check runs before any paid step.
'use strict';
const { execFile } = require('node:child_process');

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').split('\n').slice(-15).join('\n');
        reject(new Error(bin + ' 실패 (' + (err.code ?? err.message) + '):\n' + tail));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Ensures the FFmpeg build can burn ASS subtitles and encode H.264/AAC. */
async function checkFfmpeg({ ffmpeg, ffprobe }) {
  let filters;
  let encoders;
  try {
    filters = (await run(ffmpeg, ['-hide_banner', '-filters'])).stdout;
    encoders = (await run(ffmpeg, ['-hide_banner', '-encoders'])).stdout;
    await run(ffprobe, ['-version']);
  } catch (e) {
    throw new Error('FFmpeg를 실행할 수 없습니다. Mac: brew install ffmpeg (자막 필터가 없으면 brew install ffmpeg-full 후 RF_FFMPEG/RF_FFPROBE를 그 경로로 설정).\n' + e.message);
  }
  const missing = [];
  if (!/\sass\s/.test(filters)) missing.push('ass 필터 (libass)');
  if (!/libx264/.test(encoders)) missing.push('libx264 인코더');
  if (!/\saac\s/.test(encoders)) missing.push('aac 인코더');
  if (missing.length) {
    throw new Error(
      '이 FFmpeg 빌드에 필요한 기능이 없습니다: ' + missing.join(', ') +
        '\nMac: brew install ffmpeg-full 후 renderer/.env에 RF_FFMPEG=$(brew --prefix ffmpeg-full)/bin/ffmpeg, RF_FFPROBE=$(brew --prefix ffmpeg-full)/bin/ffprobe 설정'
    );
  }
  const version = (await run(ffmpeg, ['-hide_banner', '-version'])).stdout.split('\n')[0];
  return { version };
}

async function probe(ffprobe, file) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,pix_fmt', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  return { duration: Number(j.format.duration), streams: j.streams };
}

/** Places each narration sentence at its planned start, pads to the full length, normalises loudness. */
async function buildNarrationTrack({ ffmpeg }, plan, outFile, cwd) {
  const args = ['-hide_banner', '-y'];
  plan.voice.forEach((v) => args.push('-i', v.file));
  const parts = plan.voice.map((v, i) => {
    const ms = Math.round(v.start * 1000);
    return `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=${ms}:all=1[a${i}]`;
  });
  const mix = plan.voice.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${plan.voice.length}:normalize=0:dropout_transition=0`;
  const filter = parts.concat([mix + `,apad=whole_dur=${plan.total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`]).join(';');
  args.push('-filter_complex', filter, '-map', '[out]', '-t', plan.total.toFixed(3), '-ac', '1', '-ar', '48000', outFile);
  await run(ffmpeg, args, { cwd });
}

/**
 * Composes the reel from real footage only: one input per shot (trimmed from its `in` point),
 * scaled/cropped to fill 9:16, hard cuts, ASS overlay, narration. There is no code path that
 * generates synthetic visuals. Returns the list of inputs for QC.
 */
async function composeVideo({ ffmpeg }, timeline, shotAssets, { assFile, fontsDir, narrationFile, outFile, cwd, crf = 20, preset = 'medium' }) {
  const { width: W, height: H, fps } = timeline;
  const args = ['-hide_banner', '-y'];
  const inputs = [];
  timeline.shots.forEach((sh) => {
    const a = shotAssets[sh.id];
    if (!a || !a.file) throw new Error('영상 소스가 없는 컷: ' + sh.id);
    args.push('-ss', a.in.toFixed(3), '-t', sh.duration.toFixed(3), '-i', a.file);
    inputs.push({ type: 'asset', shot: sh.id, file: a.file });
  });
  args.push('-i', narrationFile);
  const audioIdx = inputs.length;
  const chains = timeline.shots.map(
    (sh, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,format=yuv420p,trim=duration=${sh.duration.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
  );
  const assArg = fontsDir ? `ass=${assFile}:fontsdir=${fontsDir.replace(/([:\\'])/g, '\\$1')}` : `ass=${assFile}`;
  chains.push(timeline.shots.map((_, i) => `[v${i}]`).join('') + `concat=n=${timeline.shots.length}:v=1:a=0[vc]`, `[vc]${assArg}[vout]`);
  args.push(
    '-filter_complex', chains.join(';'),
    '-map', '[vout]', '-map', `${audioIdx}:a`,
    '-t', timeline.total.toFixed(3),
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    outFile
  );
  if (args.includes('lavfi')) throw new Error('합성 입력(lavfi)은 허용되지 않습니다.');
  await run(ffmpeg, args, { cwd });
  return inputs;
}

module.exports = { run, checkFfmpeg, probe, buildNarrationTrack, composeVideo };
