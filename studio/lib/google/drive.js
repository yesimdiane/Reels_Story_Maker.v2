// Google Drive API v3 client: folders, resumable uploads with integrity verification (Drive's MD5 must equal ours), idempotent
// lookups by a content-hash property (so a crashed-after-upload retry finds the file instead of uploading it twice), and verified
// downloads. Every call passes supportsAllDrives=true so the same code works in a Shared Drive (service account) and My Drive.
// With the `drive.file` scope the app only sees files and folders it created itself.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { StudioError } = require('../util');

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,mimeType,size,md5Checksum,parents,trashed,appProperties,createdTime,modifiedTime,webViewLink';
const FOLDER = 'application/vnd.google-apps.folder';
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const lit = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function md5OfFile(file) {
  const h = crypto.createHash('md5');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function createDriveApi({ http, chunkBytes = CHUNK, log = () => {} }) {
  if (chunkBytes % (256 * 1024) !== 0) throw new Error('chunkBytes must be a multiple of 256 KiB');
  const folderCache = new Map();
  const inflight = new Map();

  const meta = (id) => http.request('GET', `${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`);

  async function list(query, { pageSize = 100 } = {}) {
    const out = [];
    let pageToken = '';
    do {
      const r = await http.request('GET', `${FILES}?q=${encodeURIComponent(query)}&pageSize=${pageSize}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${encodeURIComponent('nextPageToken,files(' + FIELDS + ')')}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
      out.push(...(r.files || []));
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  /** Finds or creates a folder (one creation at a time per parent/name, so concurrent callers never make duplicates). */
  async function ensureFolder(name, parentId) {
    const key = parentId + '/' + name;
    if (folderCache.has(key)) return folderCache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const run = (async () => {
      const found = await list(`name = '${lit(name)}' and '${lit(parentId)}' in parents and mimeType = '${FOLDER}' and trashed = false`);
      if (found.length) { found.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime))); return found[0].id; } // oldest wins if a duplicate ever exists
      const c = await http.request('POST', `${FILES}?supportsAllDrives=true&fields=id`, { json: { name, mimeType: FOLDER, parents: [parentId] } });
      return c.id;
    })().then((id) => { folderCache.set(key, id); return id; }).finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  }
  async function ensurePath(rootId, parts) {
    let id = rootId;
    for (const p of parts.filter(Boolean)) id = await ensureFolder(p, id);
    return id;
  }

  const findByAppProperty = (key, value, parentId) => list(`appProperties has { key='${lit(key)}' and value='${lit(value)}' } and trashed = false${parentId ? ` and '${lit(parentId)}' in parents` : ''}`);

  /**
   * Resumable upload of a Buffer or a file path. Verifies size and MD5 against Drive's answer; a mismatch trashes the bad copy
   * and throws. params: { name, parentId, mimeType, buffer | filePath, appProperties, md5 }
   */
  async function upload({ name, parentId, mimeType = 'application/octet-stream', buffer, filePath, appProperties = {}, md5 }) {
    const total = buffer ? buffer.length : fs.statSync(filePath).size;
    if (!total) throw new StudioError('EMPTY_FILE', '빈 파일은 Drive에 올리지 않습니다.');
    const localMd5 = md5 || (buffer ? crypto.createHash('md5').update(buffer).digest('hex') : md5OfFile(filePath));
    const init = await http.request('POST', `${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`, {
      json: { name, parents: [parentId], mimeType, appProperties },
      headers: { 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(total) }, as: 'response',
    });
    const session = init.headers.get('location');
    if (!session) throw new StudioError('DRIVE_UPLOAD', 'Drive가 업로드 세션을 만들지 못했습니다.', { status: 502 });
    const fd = buffer ? null : fs.openSync(filePath, 'r');
    const slice = (off, len) => {
      if (buffer) return buffer.subarray(off, off + len);
      const b = Buffer.allocUnsafe(len);
      fs.readSync(fd, b, 0, len, off);
      return b;
    };
    let offset = 0;
    let result = null;
    let resumes = 0;
    try {
      while (!result) {
        const len = Math.min(chunkBytes, total - offset);
        let res;
        try {
          res = await http.request('PUT', session, { body: slice(offset, len), headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${total}`, 'Content-Type': mimeType }, expect: [200, 201, 308], as: 'response' });
        } catch (e) {
          if (!e.retryable || resumes >= 3) throw e;
          resumes += 1; // ask Drive how much it really has, then continue from there
          const st = await http.request('PUT', session, { headers: { 'Content-Range': `bytes */${total}` }, expect: [200, 201, 308], as: 'response' });
          if (st.status === 308) { const m = /bytes=0-(\d+)/.exec(st.headers.get('range') || ''); offset = m ? Number(m[1]) + 1 : 0; continue; }
          res = st;
        }
        if (res.status === 308) {
          const m = /bytes=0-(\d+)/.exec(res.headers.get('range') || '');
          offset = m ? Number(m[1]) + 1 : 0;
        } else {
          result = JSON.parse(await res.text());
        }
      }
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    if (Number(result.size) !== total || (result.md5Checksum && result.md5Checksum !== localMd5)) {
      try { await trash(result.id); } catch (e) { log('could not trash corrupt upload ' + result.id + ': ' + e.message); }
      throw new StudioError('UPLOAD_INTEGRITY', `Drive에 올린 파일이 원본과 다릅니다 (${name}). 업로드를 무효 처리했습니다.`, { recovery: '다시 시도하세요. 원본 파일은 그대로입니다.', status: 502 });
    }
    return result;
  }

  const trash = (id) => http.request('PATCH', `${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, { json: { trashed: true } });

  const download = (id) => http.request('GET', `${FILES}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { as: 'buffer' });

  /** Streams to dest (atomic rename). If md5/size are given the download is verified before it becomes visible. */
  async function downloadToFile(id, dest, { md5, size } = {}) {
    const res = await http.request('GET', `${FILES}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { as: 'response' });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.' + process.pid + '.dl';
    const h = crypto.createHash('md5');
    let n = 0;
    const out = fs.createWriteStream(tmp);
    try {
      for await (const chunk of res.body) {
        h.update(chunk);
        n += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      if ((size != null && n !== Number(size)) || (md5 && h.digest('hex') !== md5)) {
        throw new StudioError('DOWNLOAD_INTEGRITY', 'Drive에서 내려받은 파일이 기록된 체크섬과 다릅니다.', { status: 502 });
      }
      fs.renameSync(tmp, dest);
    } catch (e) {
      out.destroy();
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return { size: n };
  }

  return { meta, list, ensureFolder, ensurePath, findByAppProperty, upload, download, downloadToFile, trash, md5OfFile };
}

module.exports = { createDriveApi, md5OfFile, FOLDER };
