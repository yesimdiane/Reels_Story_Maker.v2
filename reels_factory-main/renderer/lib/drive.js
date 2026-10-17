// Google Drive import of the Flow clips (Google Flow has no public API: the operator generates clips in Flow
// and uploads them to the reel's Drive folder; the dashboard tracks them). Drive v3 REST with a bearer token.
// Read-only: files are downloaded, never changed or deleted. The folder ID comes from the signed render job.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLIP_RE = /^(S\d+[a-z]?(?:-\d+)?)\.(mp4|mov|m4v)$/i;
const IMAGE_MIME = /^image\/(png|jpeg|webp)$/;
const { requireManifest, localName, md5File, md5Buffer } = require('./clip-manifest');
const { GateError } = require('./job');

/** Token sources: RF_DRIVE_ACCESS_TOKEN, else `gcloud auth print-access-token` (user logged in with Drive access). */
function driveAuth(cfg, { exec = execFileSync } = {}) {
  return async () => {
    if (cfg.driveToken) return { Authorization: 'Bearer ' + cfg.driveToken };
    let token;
    try {
      token = exec('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
    } catch (e) {
      throw new Error('Drive 인증 토큰을 얻지 못했습니다. `gcloud auth login --enable-gdrive-access` 후 다시 시도하거나 RF_DRIVE_ACCESS_TOKEN을 설정하세요.');
    }
    return { Authorization: 'Bearer ' + token };
  };
}

function createDriveClient({ authHeaders, fetchImpl = fetch }) {
  async function get(url) {
    const res = await fetchImpl(url, { headers: await authHeaders() });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).error.message;
      } catch {}
      throw new Error(`Google Drive 오류 (HTTP ${res.status}) ${detail}`.trim() + (res.status === 401 || res.status === 403 ? ' — 토큰에 Drive 읽기 권한이 있는지 확인하세요.' : ''));
    }
    return res;
  }
  return {
    async listFolder(folderId) {
      if (!/^[A-Za-z0-9_-]{10,}$/.test(String(folderId || ''))) throw new Error('Drive 폴더 ID가 올바르지 않습니다.');
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fields = encodeURIComponent('files(id,name,size,mimeType,modifiedTime),nextPageToken');
      let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`;
      const files = [];
      for (let page = 0; page < 10 && url; page++) {
        const j = await (await get(url)).json();
        files.push(...(j.files || []));
        url = j.nextPageToken ? `${url.replace(/&pageToken=[^&]*/, '')}&pageToken=${encodeURIComponent(j.nextPageToken)}` : '';
      }
      return files;
    },
    async download(fileId) {
      const res = await get(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/**
 * Downloads the reel's clips from its Drive folder into clipsDir/<reelId>/ — only files named like the clips the
 * job needs (S1.mp4, S3b.mov, S2-1.mp4 …), newest upload wins, existing identical-size files are kept.
 * Returns { dir, downloaded: [names], kept: [names], missing: [names], ignored: [names] }.
 */
async function fetchClips({ drive, job, clipsDir, log = () => {} }) {
  // Media-workspace jobs (with a production plan): only the clips approved in the dashboard, by Drive file ID,
  // each verified against the approved checksum. No folder listing, so nothing unapproved can be picked up.
  if (job.productionPlan) return fetchApprovedClips({ drive, job, clipsDir, log });
  const folderId = job.drive && job.drive.folderId;
  if (!folderId) throw new Error('이 작업에는 Drive 폴더 정보가 없습니다. 대시보드의 "Drive 폴더 준비/동기화"를 누른 뒤 작업 파일을 다시 받으세요.');
  // canonical clip ids as the renderer expects them (S3b keeps its lower-case part letter)
  const canon = {};
  (Array.isArray(job.flowPrompts) ? job.flowPrompts : []).forEach((p) => {
    const base = String(p.file || '').replace(/\.[A-Za-z0-9]+$/, '');
    if (base) canon[base.toUpperCase()] = base;
  });
  const wanted = Object.keys(canon);
  const files = await drive.listFolder(folderId);
  const best = {};
  const ignored = [];
  files.forEach((f) => {
    const m = CLIP_RE.exec(f.name);
    if (!m || !wanted.includes(m[1].toUpperCase())) return ignored.push(f.name);
    const key = m[1].toUpperCase();
    if (!best[key] || best[key].modifiedTime < f.modifiedTime) best[key] = Object.assign({ ext: m[2].toLowerCase(), base: canon[key] }, f);
  });
  const dir = path.join(clipsDir, job.reelId);
  fs.mkdirSync(dir, { recursive: true });
  const out = { dir, downloaded: [], kept: [], missing: [], ignored };
  for (const key of wanted) {
    const f = best[key];
    if (!f) {
      out.missing.push(canon[key] + '.mp4');
      continue;
    }
    const name = f.base + '.' + f.ext;
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && f.size != null && fs.statSync(dest).size === Number(f.size)) {
      out.kept.push(name);
      continue;
    }
    log(`… Drive에서 ${name} 내려받는 중`);
    const buf = await drive.download(f.id);
    fs.writeFileSync(dest + '.part', buf);
    fs.renameSync(dest + '.part', dest);
    out.downloaded.push(name);
  }
  return out;
}

/**
 * Downloads exactly the approved clips of the signed manifest into clipsDir/<reelId>/. A file already there is
 * kept only if its MD5 is the approved one; a download that does not match the approved size/MD5 is refused
 * and never written. Returns { dir, downloaded, kept, missing: [], ignored: [] }.
 */
async function fetchApprovedClips({ drive, job, clipsDir, log }) {
  const m = requireManifest(job);
  const dir = path.join(clipsDir, job.reelId);
  fs.mkdirSync(dir, { recursive: true });
  const out = { dir, downloaded: [], kept: [], missing: [], ignored: [] };
  for (const c of m.clips) {
    const name = localName(c);
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size === c.size && md5File(dest) === c.md5) {
      out.kept.push(name);
      continue;
    }
    log(`… Drive에서 승인된 ${name} (v${c.version}) 내려받는 중`);
    const buf = await drive.download(c.fileId);
    if (buf.length !== c.size || md5Buffer(buf) !== c.md5) {
      throw new GateError(`${name}: 내려받은 파일이 승인된 파일(v${c.version})과 다릅니다 (크기·체크섬 불일치). Drive의 파일이 바뀌었을 수 있으니 대시보드에서 다시 확인하세요.`);
    }
    fs.writeFileSync(dest + '.part', buf);
    fs.renameSync(dest + '.part', dest);
    out.downloaded.push(name);
  }
  return out;
}

/** Verified product images for the final check: local refs/<productId>/ first, else the Drive IDs in the job. */
async function loadReferenceImages({ job, refsDir, drive, max = 4 }) {
  const out = [];
  const dir = refsDir ? path.join(refsDir, job.productId) : '';
  if (dir && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(f).toLowerCase()];
      if (mime && out.length < max) out.push({ name: f, mimeType: mime, data: fs.readFileSync(path.join(dir, f)).toString('base64') });
    }
  }
  if (!out.length && drive && Array.isArray(job.referenceImages)) {
    for (const r of job.referenceImages.slice(0, max)) {
      const buf = await drive.download(r.fileId);
      const name = ((job.productionPlan && job.productionPlan.references) || []).find((x) => x.fileId === r.fileId);
      out.push({ name: (name && name.name) || r.fileId, mimeType: sniffImage(buf), data: buf.toString('base64') });
    }
  }
  return out;
}

function sniffImage(buf) {
  if (buf.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.slice(0, 2).toString('hex') === 'ffd8') return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/png';
}

module.exports = { driveAuth, createDriveClient, fetchClips, fetchApprovedClips, loadReferenceImages, CLIP_RE, IMAGE_MIME };
