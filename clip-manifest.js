// The approved-clip manifest in the signed render job (issue #12). The dashboard approves each Flow clip; the job
// carries every approved clip's Drive file ID and MD5. The renderer does NOT trust that the right files are on
// disk: before any paid step it checks that every clip it is about to use is in the manifest and is byte-for-byte
// the approved file. Applies to jobs that carry a Gemini production plan (the media-workspace flow); jobs without
// a plan keep the earlier behaviour (local clips, no manifest).
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { GateError } = require('./job');

const KEY_RE = /^S\d+[a-z]?$/;
const ID_RE = /^[A-Za-z0-9_-]{10,}$/;
const MD5_RE = /^[0-9a-f]{32}$/;
const EXT_RE = /^\.(mp4|mov|m4v)$/i;

function md5File(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}
function md5Buffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/** Local file name of an approved clip: the clip key plus the uploaded file's extension (S3 + .mp4). */
function localName(c) {
  return c.clip + path.extname(String(c.driveName || c.file)).toLowerCase();
}

/**
 * Returns the validated manifest, or null for a job without a production plan (legacy local-clip flow).
 * Throws GateError (no cost) if a planned job has no complete, matching manifest.
 */
function requireManifest(job) {
  if (!job.productionPlan) return null;
  const m = job.clipManifest;
  if (!m || !Array.isArray(m.clips) || !m.clips.length) {
    throw new GateError('이 작업에는 승인된 클립 목록이 없습니다. 대시보드에서 모든 장면 클립을 승인한 뒤 작업 파일을 다시 받으세요.');
  }
  if (m.approvedHash !== job.approvedHash || m.reelId !== job.reelId || m.productId !== job.productId) {
    throw new GateError('클립 승인 정보가 이 작업(릴스·상품·승인된 대본)과 맞지 않습니다. 작업 파일을 다시 받으세요.');
  }
  const seen = new Set();
  m.clips.forEach((c) => {
    const bad = (why) => new GateError(`클립 목록이 올바르지 않습니다 (${c && c.clip}: ${why}).`);
    if (!c || !KEY_RE.test(String(c.clip))) throw bad('이름');
    if (seen.has(c.clip)) throw bad('중복');
    seen.add(c.clip);
    if (!ID_RE.test(String(c.fileId))) throw bad('Drive 파일 ID');
    if (!MD5_RE.test(String(c.md5))) throw bad('체크섬');
    if (!Number.isInteger(c.size) || c.size <= 0) throw bad('크기');
    if (!Number.isInteger(c.version) || c.version < 1) throw bad('버전');
    if (c.scene !== Number(String(c.clip).match(/^S(\d+)/)[1])) throw bad('장면 번호');
    if (!EXT_RE.test(path.extname(String(c.driveName || c.file)))) throw bad('파일 형식');
    if (!c.approvedBy) throw bad('승인자');
  });
  return m;
}

/**
 * After the footage was validated and BEFORE any TTS: every clip in the plan is approved, and every file the
 * render would use is an approved file with identical bytes (a file swapped on the Mac, a leftover older
 * version, or a per-cut override that nobody approved is refused).
 * assets: result of validateAssets ({ reqs, shots }). Throws GateError.
 */
function checkClipManifest(job, assets, { md5 = md5File } = {}) {
  const m = requireManifest(job);
  if (!m) return null;
  const byKey = Object.fromEntries(m.clips.map((c) => [c.clip, c]));
  const problems = [];
  assets.reqs.forEach((r) => {
    if (!byKey[r.id]) problems.push(`${r.id}: 승인된 클립이 목록에 없습니다`);
  });
  const checked = new Set();
  Object.values(assets.shots).forEach((a) => {
    if (checked.has(a.file)) return;
    checked.add(a.file);
    const name = path.basename(a.file);
    const c = byKey[name.replace(/\.[^.]+$/, '')];
    if (!c) return problems.push(`${name}: 승인된 클립이 아닙니다 (컷 단위 교체 파일은 승인 없이 쓸 수 없습니다)`);
    if (md5(a.file) !== c.md5) problems.push(`${name}: 로컬 파일이 승인된 파일(v${c.version})과 다릅니다 — fetch-clips로 다시 내려받으세요`);
  });
  if (problems.length) throw new GateError('승인된 클립과 맞지 않아 렌더링하지 않습니다 (비용 발생 없음):\n- ' + problems.join('\n- '));
  return m;
}

module.exports = { requireManifest, checkClipManifest, localName, md5File, md5Buffer };
