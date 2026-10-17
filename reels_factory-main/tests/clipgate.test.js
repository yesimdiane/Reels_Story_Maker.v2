// Issue #12, renderer side: the Mac renderer independently checks the approved-clip manifest in the signed job
// (IDs, checksums, mapping) before any paid step, and fetch-clips downloads exactly the approved files by ID.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');
const { api } = require('./helpers/media');
const { verifyJob, GateError } = require('../renderer/lib/job');
const { requireManifest, checkClipManifest, localName, md5Buffer } = require('../renderer/lib/clip-manifest');
const { fetchApprovedClips, fetchClips } = require('../renderer/lib/drive');
const { createTtsService } = require('../renderer/lib/tts');
const { createSilentTts } = require('../renderer/lib/tts/silent');
const { createLocalStorage } = require('../renderer/lib/storage/local');
const { render } = require('../renderer/lib/render');
const { loadTemplate } = require('../renderer/lib/template');

const plain = (v) => JSON.parse(JSON.stringify(v));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-gate-'));
const template = loadTemplate('lifestyle-v1');
const FF = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
let hasFfmpeg = false;
try {
  hasFfmpeg = /\sass\s/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }));
} catch {
  hasFfmpeg = false;
}

// Full server flow with every clip uploaded and approved → signed job with a manifest.
function issue(clipBytes) {
  let env;
  env = createEnv({
    gemini: (n, body) => (body.generationConfig.responseSchema.properties.product_visual
      ? plain(env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE'))
      : plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'))),
  });
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  const img = env.drive.addImage('p.png');
  env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
  env.sheets.PRODUCTS.rows[1].push('https://drive.google.com/file/d/' + img + '/view');
  env.gs('setupSheets()');
  const m = api(env);
  m.call('apiGenerateScripts', 'PRD-001');
  m.call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 });
  m.call('apiCreateProductionPlan', 'PRD-001-R01', m.guard());
  m.approveAll({ bytesFor: clipBytes });
  m.call('apiAction', 'PRD-001-R01', 'START_VIDEO', Object.assign({}, m.guard(), { expectedVideoVersion: 0 }));
  const res = m.call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(res.ok, true, res.error);
  const jobFile = JSON.parse(res.jobFile);
  const job = verifyJob(jobFile, { secret: env.props.RF_RENDER_SECRET });
  return { env, m, job, jobFile, secret: env.props.RF_RENDER_SECRET };
}
const drive = (env) => ({ download: async (id) => { const f = env.drive.nodes[id]; if (!f) throw new Error('404'); return f.bytes; }, listFolder: async () => { throw new Error('must not list'); } });
const assetsFor = (job, dir, ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) => ({
  reqs: ids.map((id) => ({ id })),
  shots: Object.fromEntries(ids.map((id) => [id + '-1', { file: path.join(dir, id + '.mp4') }])),
});
function writeLocal(job, dir, over = {}) {
  fs.mkdirSync(dir, { recursive: true });
  job.clipManifest.clips.forEach((c) => fs.writeFileSync(path.join(dir, localName(c)), over[c.clip] || Buffer.alloc(c.size, c.clip + '-clip')));
}

test('manifest in the job: jobs with a plan need a complete manifest for THIS approval; legacy jobs have none', () => {
  const { job } = issue();
  const m = requireManifest(job);
  assert.equal(m.clips.length, 6);
  assert.equal(localName(m.clips[0]), 'S1.mp4');
  const bad = (mut) => { const j = plain(job); mut(j); return () => requireManifest(j); };
  assert.equal(requireManifest(Object.assign(plain(job), { productionPlan: null, clipManifest: null })), null, 'legacy local-clip job');
  assert.throws(bad((j) => { j.clipManifest = null; }), (e) => e instanceof GateError && /승인된 클립 목록이 없습니다/.test(e.message));
  assert.throws(bad((j) => { j.clipManifest.clips = []; }), /승인된 클립 목록이 없습니다/);
  assert.throws(bad((j) => { j.clipManifest.approvedHash = 'h:other'; }), /맞지 않습니다/);
  assert.throws(bad((j) => { j.clipManifest.reelId = 'PRD-001-R09'; }), /맞지 않습니다/);
  assert.throws(bad((j) => { j.clipManifest.clips[0].clip = '../S1'; }), /이름/);
  assert.throws(bad((j) => { j.clipManifest.clips[1].clip = 'S1'; }), /중복/);
  assert.throws(bad((j) => { j.clipManifest.clips[0].fileId = 'x'; }), /Drive 파일 ID/);
  assert.throws(bad((j) => { j.clipManifest.clips[0].md5 = 'ZZ'; }), /체크섬/);
  assert.throws(bad((j) => { j.clipManifest.clips[0].size = 0; }), /크기/);
  assert.throws(bad((j) => { j.clipManifest.clips[2].scene = 9; }), /장면 번호/);
  assert.throws(bad((j) => { j.clipManifest.clips[0].driveName = 'S1.exe'; }), /파일 형식/);
  assert.throws(bad((j) => { j.clipManifest.clips[0].approvedBy = ''; }), /승인자/);
});

test('local clips must be the approved files: wrong bytes, unapproved clip, extra part, per-cut override are all refused', () => {
  const { job } = issue();
  const dir = tmp();
  writeLocal(job, dir);
  const assets = assetsFor(job, dir);
  assert.ok(checkClipManifest(job, assets), 'identical bytes pass');
  // A file swapped on the Mac.
  fs.writeFileSync(path.join(dir, 'S3.mp4'), Buffer.alloc(job.clipManifest.clips[2].size, 'other video'));
  assert.throws(() => checkClipManifest(job, assets), (e) => e instanceof GateError && /S3\.mp4: 로컬 파일이 승인된 파일\(v1\)과 다릅니다 — fetch-clips/.test(e.message) && /비용 발생 없음/.test(e.message));
  writeLocal(job, dir);
  // The renderer needs a clip the dashboard never approved (longer voice → S3b).
  assert.throws(() => checkClipManifest(job, assetsFor(job, dir, ['S1', 'S2', 'S3', 'S3b', 'S4', 'S5', 'S6'])), /S3b: 승인된 클립이 목록에 없습니다/);
  // Per-cut override file (assets.json) that nobody approved.
  fs.writeFileSync(path.join(dir, 'S3-2.mp4'), 'x');
  const a2 = assetsFor(job, dir);
  a2.shots['S3-2'] = { file: path.join(dir, 'S3-2.mp4') };
  assert.throws(() => checkClipManifest(job, a2), /S3-2\.mp4: 승인된 클립이 아닙니다/);
  // A job whose plan has no manifest at all.
  assert.throws(() => checkClipManifest(Object.assign(plain(job), { clipManifest: null }), assets), /승인된 클립 목록이 없습니다/);
});

test('fetch-clips (planned jobs): exactly the approved files, by Drive file ID, verified by size and MD5; never lists the folder', async () => {
  const { env, job } = issue();
  const dir = tmp();
  const r = await fetchApprovedClips({ drive: drive(env), job, clipsDir: dir, log: () => {} });
  assert.deepEqual(r.downloaded, ['S1.mp4', 'S2.mp4', 'S3.mp4', 'S4.mp4', 'S5.mp4', 'S6.mp4']);
  job.clipManifest.clips.forEach((c) => assert.equal(md5Buffer(fs.readFileSync(path.join(dir, 'PRD-001-R01', localName(c)))), c.md5));
  // fetchClips routes planned jobs to the manifest path.
  const again = await fetchClips({ drive: drive(env), job, clipsDir: dir });
  assert.equal(again.kept.length, 6);
  assert.equal(again.downloaded.length, 0);
  // A local file with other bytes is replaced by the approved one.
  fs.writeFileSync(path.join(dir, 'PRD-001-R01', 'S2.mp4'), 'stale local copy');
  const fixed = await fetchApprovedClips({ drive: drive(env), job, clipsDir: dir, log: () => {} });
  assert.deepEqual(fixed.downloaded, ['S2.mp4']);
  // Drive returns different bytes than were approved → refused, nothing written.
  const dir2 = tmp();
  const evil = { download: async () => Buffer.from('not the approved video') };
  await assert.rejects(fetchApprovedClips({ drive: evil, job, clipsDir: dir2, log: () => {} }), (e) => e instanceof GateError && /S1\.mp4: 내려받은 파일이 승인된 파일\(v1\)과 다릅니다/.test(e.message));
  assert.deepEqual(fs.readdirSync(path.join(dir2, 'PRD-001-R01')), [], 'nothing written for a mismatching download');
  // A job without a manifest cannot be fetched.
  await assert.rejects(fetchApprovedClips({ drive: drive(env), job: Object.assign(plain(job), { clipManifest: null }), clipsDir: dir2, log: () => {} }), /승인된 클립 목록이 없습니다/);
});

test('a swapped local clip stops the render before TTS; the approved clips render', { skip: !hasFfmpeg && 'FFmpeg not installed' }, async () => {
  // Real distinct clips: uploaded + approved, then used by the renderer.
  const dir = tmp();
  const clips = path.join(dir, 'clips', 'PRD-001-R01');
  fs.mkdirSync(clips, { recursive: true });
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=8:r=30', '-metadata', 'comment=' + id, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(clips, id + '.mp4')]);
  }
  const { jobFile, secret } = issue((key) => fs.readFileSync(path.join(clips, key + '.mp4')));
  const calls = [];
  const inner = createSilentTts();
  const provider = { name: 'spy', paid: false, synthesize: async (a) => { calls.push(a.text); return inner.synthesize(a); } };
  const opts = {
    jobFile, secret, template,
    tts: createTtsService({ provider, voice: 'local', speakingRate: 1.05, cacheDir: path.join(dir, 'c'), ledgerFile: path.join(dir, 'l.json') }),
    storage: createLocalStorage({ outputDir: path.join(dir, 'out') }),
    clipsDir: path.join(dir, 'clips'), ffmpeg: FF, font: 'NanumGothic', preset: 'ultrafast', crf: 36,
  };
  // Replace S4 with a different (valid) video, as if it were copied over by hand.
  const good = fs.readFileSync(path.join(clips, 'S4.mp4'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=8:r=30', '-metadata', 'comment=swapped', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(clips, 'S4.mp4')]);
  await assert.rejects(render(opts), (e) => e instanceof GateError && /S4\.mp4: 로컬 파일이 승인된 파일/.test(e.message));
  assert.equal(calls.length, 0, 'no TTS (no cost) when the local clip is not the approved one');
  fs.writeFileSync(path.join(clips, 'S4.mp4'), good);
  const m = await render(opts);
  assert.equal(m.qc.postRender.ok, true, JSON.stringify(m.qc.postRender.checks.filter((c) => !c.ok)));
  assert.equal(calls.length, 6);
});
