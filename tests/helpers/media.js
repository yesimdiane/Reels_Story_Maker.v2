// Drives the media-workspace API the way the iPhone dashboard does (chunked upload, review), for tests.
'use strict';
const plain = (v) => JSON.parse(JSON.stringify(v));

function api(env) {
  const call = (fn, ...a) => plain(env.gs(fn).apply(null, a));
  const detail = (id = 'PRD-001-R01') => call('apiGetReel', id).detail;
  const guard = (id) => {
    const d = detail(id);
    return { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion };
  };
  /** Uploads bytes as clip `key` in chunks; returns the last API result ({ ok, done, ... } or the failing result). */
  function upload(key, bytes, over = {}) {
    const id = over.reelId || 'PRD-001-R01';
    const start = call('apiStartClipUpload', id, Object.assign({ clip: key, fileName: key + '.mp4', mime: 'video/mp4', size: bytes.length, rightsConfirmed: true }, guard(id), over.start || {}));
    if (!start.ok) return start;
    let off = 0;
    let last = start;
    while (off < bytes.length) {
      const piece = bytes.subarray(off, Math.min(bytes.length, off + start.chunkBytes));
      last = call('apiUploadClipChunk', start.uploadId, off, piece.toString('base64'));
      if (!last.ok) return Object.assign(last, { uploadId: start.uploadId });
      off = last.done ? bytes.length : last.next;
    }
    return Object.assign(last, { uploadId: start.uploadId });
  }
  const review = (key, version, decision, note = '', id = 'PRD-001-R01') =>
    call('apiReviewClip', id, Object.assign({ clip: key, version, decision, note }, guard(id)));
  const clips = (id = 'PRD-001-R01') => detail(id).media.clips;
  const bytesFor = (key, n = 12 * 1024) => Buffer.alloc(n, key + '-clip');
  /** Uploads and approves every Flow clip of the reel (bytes from bytesFor(key)). */
  function approveAll(over = {}) {
    const id = over.reelId || 'PRD-001-R01';
    clips(id).forEach((c) => {
      const up = upload(c.key, (over.bytesFor || bytesFor)(c.key), { reelId: id });
      if (!up.ok || !up.done) throw new Error('upload failed: ' + JSON.stringify(up));
      const r = review(c.key, up.version, 'APPROVE', '', id);
      if (!r.ok) throw new Error('approve failed: ' + r.error);
    });
  }
  return { call, detail, guard, upload, review, clips, bytesFor, approveAll };
}

module.exports = { api };
