// Issue #12 — mobile Google Flow media workspace: reference photo upload, chunked clip upload (resumable Drive
// session), mapping, duplicates, versions and replacement, per-clip review, the render gate, and data preservation.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createEnv, prd001Row } = require('./helpers/apps-script-mock');
const { api } = require('./helpers/media');

const plain = (v) => JSON.parse(JSON.stringify(v));
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2000, 7)]);
const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(2000, 9)]);
const b64 = (b) => b.toString('base64');

function setup({ refColumn = true, mediaColumn = true, driveFault, extraEnv = {} } = {}) {
  let env;
  env = createEnv(Object.assign({
    driveFault,
    gemini: (n, body) => (body.generationConfig.responseSchema.properties.product_visual
      ? plain(env.gs('FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE'))
      : plain(env.gs('FIXTURE_PRD_001_GEMINI_RESPONSE'))),
  }, extraEnv));
  env.sheets.PRODUCTS.rows.push(prd001Row(env.gs, { permission: '자체 제작', affiliateUrl: 'https://link.coupang.com/a/x' }));
  // A second product that must never be touched.
  env.sheets.PRODUCTS.rows.push(['PRD-002', '다른 상품', '생활용품', '확인된 기능 하나', '', '', '', '', '']);
  if (refColumn) {
    env.sheets.PRODUCTS.rows[0].push('검증된 제품 이미지');
    env.sheets.PRODUCTS.rows[1].push('기존 메모: 정면 사진 필요');
    env.sheets.PRODUCTS.rows[2].push('');
  }
  env.gs('setupSheets()');
  if (!mediaColumn) {
    const sheet = env.sheets.REELS;
    const i = sheet.rows[0].indexOf('장면 클립(JSON)');
    sheet.rows.forEach((r) => r.splice(i, 1));
  }
  const m = api(env);
  m.refPhoto = (bytes, over = {}) => m.call('apiUploadReferencePhoto', 'PRD-001', Object.assign({ data: b64(bytes), rightsConfirmed: true }, over));
  m.reelRow = () => env.sheets.REELS.record(2);
  m.audit = () => env.sheets.AUDIT.rows.slice(1).map((r) => r[env.sheets.AUDIT.rows[0].indexOf('작업')]);
  return Object.assign({ env }, m);
}
// Approved script + Gemini plan (+ product images), ready for clips.
function ready(opts) {
  const s = setup(opts);
  const { env, call } = s;
  const img = env.drive.addImage('product-front.png');
  if (env.sheets.PRODUCTS.rows[0].includes('검증된 제품 이미지')) env.sheets.PRODUCTS.rows[1][9] = 'https://drive.google.com/file/d/' + img + '/view';
  assert.equal(call('apiGenerateScripts', 'PRD-001').ok, true);
  assert.equal(call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', Object.assign({ expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 })).ok, true);
  const g = s.guard();
  assert.equal(call('apiCreateProductionPlan', 'PRD-001-R01', g).ok, true);
  return s;
}

// ------------------------------------------------------------------ reference photos

test('reference photo: saved under the product folder, link APPENDED to that product row only, rights confirmation required', () => {
  const s = setup();
  const before = plain(s.env.sheets.PRODUCTS.rows);
  assert.match(s.refPhoto(PNG, { rightsConfirmed: false }).error, /권한을 확인한 사진/);
  assert.equal(s.env.drive.folderByPath('Reels Factory'), null, 'nothing created without the confirmation');
  const r = s.refPhoto(PNG);
  assert.equal(r.ok, true, r.error);
  const folder = s.env.drive.folderByPath('Reels Factory', 'PRD-001', 'references');
  assert.ok(folder, 'existing hierarchy: Reels Factory / <상품ID> / references');
  const file = s.env.drive.nodes[r.reference.fileId];
  assert.equal(file.parent, folder.id);
  assert.equal(file.mime, 'image/png');
  assert.match(file.name, /^ref-1-.*\.png$/);
  assert.equal(file.shared, undefined, 'never shared');
  // PRODUCTS: only the 검증된 제품 이미지 cell of PRD-001 changed; the existing note is kept; PRD-002 untouched.
  const after = s.env.sheets.PRODUCTS.rows;
  const diff = [];
  after.forEach((row, i) => row.forEach((v, j) => { if (v !== before[i][j]) diff.push([i, j]); }));
  assert.deepEqual(diff, [[1, 9]]);
  assert.equal(after[1][9], '기존 메모: 정면 사진 필요\nhttps://drive.google.com/file/d/' + r.reference.fileId + '/view');
  assert.ok(s.env.sheets.LOG.rows.some((row) => /제품 참고 사진 추가 \(권리 확인 체크함\)/.test(row.join(' '))));
  // The dashboard sees it, and the Gemini planner now accepts it as a verified image.
  assert.equal(s.call('apiGetReel', 'PRD-001-R01').ok, false, 'no reel yet');
  assert.equal(plain(s.env.gs('parseReferenceImages')(after[1][9])).length, 1);
});

test('reference photo: type from file bytes, size, 4 max, duplicates, missing column, other users', () => {
  const s = setup();
  assert.match(s.refPhoto(Buffer.from('<html>not an image</html>')).error, /PNG, JPEG, WebP/);
  assert.match(s.refPhoto(Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)])).error, /너무 큽니다/);
  assert.match(s.refPhoto(Buffer.alloc(0)).error, /비어/);
  assert.equal(s.refPhoto(PNG).ok, true);
  assert.match(s.refPhoto(PNG).error, /같은 사진이 이미 등록/);
  const ok = [1, 2, 3].map((i) => s.refPhoto(Buffer.concat([JPG, Buffer.alloc(10, i)])));
  assert.ok(ok.every((r) => r.ok), JSON.stringify(ok));
  assert.match(s.refPhoto(Buffer.concat([JPG, Buffer.alloc(10, 99)])).error, /최대 4장/);
  assert.equal(s.env.sheets.PRODUCTS.rows[1][9].split('\n').filter((l) => l.includes('drive.google.com')).length, 4);
  // Unknown product / PRODUCTS without the column (never added automatically).
  assert.match(s.call('apiUploadReferencePhoto', 'PRD-999', { data: b64(PNG), rightsConfirmed: true }).error, /찾을 수 없습니다/);
  const none = setup({ refColumn: false });
  const before = JSON.stringify(none.env.sheets.PRODUCTS.rows);
  assert.match(none.refPhoto(PNG).error, /"검증된 제품 이미지" 열이 없습니다/);
  assert.equal(JSON.stringify(none.env.sheets.PRODUCTS.rows), before, 'PRODUCTS structure untouched');
  // Not a reviewer → refused before anything is read or written.
  const x = setup();
  x.env.state.email = 'intruder@example.com';
  assert.match(x.refPhoto(PNG).error, /검토 권한이 없습니다/);
  assert.equal(x.env.drive.folderByPath('Reels Factory'), null);
});

// ------------------------------------------------------------------ clip upload

test('clip upload: auth, state and mapping are checked before Drive is touched', () => {
  const fresh = setup();
  fresh.call('apiGenerateScripts', 'PRD-001');
  const bytes = fresh.bytesFor('S1');
  const guards = new Map();
  const start = (s, over = {}, id = 'PRD-001-R01') => {
    if (!guards.has(s)) guards.set(s, s.guard(id)); // read before any account switch
    return s.call('apiStartClipUpload', id, Object.assign({ clip: 'S1', fileName: 'S1.mp4', mime: 'video/mp4', size: bytes.length, rightsConfirmed: true }, guards.get(s), over));
  };
  // Not approved yet → no upload session, nothing in Drive.
  assert.match(start(fresh).error, /대본 승인 후에만/);
  assert.equal(fresh.env.state.driveRequests.length, 0);

  const s = ready();
  const calls = () => s.env.state.driveRequests.length;
  let n = calls();
  assert.match(start(s, { rightsConfirmed: false }).error, /권한을 확인한 영상|권리/);
  assert.match(start(s, { clip: 'S9' }).error, /이 릴스에 없는 장면 클립입니다: S9/);
  assert.match(start(s, { clip: '../S1' }).error, /없는 장면 클립/);
  assert.match(start(s, { fileName: 'S1.exe' }).error, /MP4 또는 MOV/);
  assert.match(start(s, { fileName: 'S1' }).error, /MP4 또는 MOV/);
  assert.match(start(s, { mime: 'application/zip' }).error, /지원하지 않습니다/);
  assert.match(start(s, { size: 5 }).error, /크기가 올바르지 않습니다/);
  assert.match(start(s, { size: 101 * 1024 * 1024 }).error, /너무 큽니다/);
  assert.match(start(s, { size: 1000.5 }).error, /크기가 올바르지 않습니다/);
  assert.match(start(s, { expectedScriptVersion: 7 }).error, /이미 다른 곳에서 변경/);
  assert.match(s.call('apiStartClipUpload', 'PRD-404', { clip: 'S1' }).error, /찾을 수 없습니다/);
  assert.equal(calls(), n, 'every rejection happened before any Drive request');
  // Auth: only a registered reviewer.
  s.env.state.email = 'intruder@example.com';
  assert.match(start(s).error, /검토 권한이 없습니다/);
  s.env.state.email = 'owner@example.com';
  assert.equal(calls(), n);
  // Missing REELS column → asks for 시트 준비, no Drive call.
  const noCol = ready({ mediaColumn: false });
  n = noCol.env.state.driveRequests.length;
  assert.match(noCol.call('apiStartClipUpload', 'PRD-001-R01', Object.assign({ clip: 'S1', fileName: 'S1.mp4', mime: 'video/mp4', size: 20000, rightsConfirmed: true }, noCol.guard())).error, /REELS에 열이 없습니다 \(장면 클립\(JSON\)\).*시트 준비/);
  assert.equal(noCol.env.state.driveRequests.length, n);
});

test('clip upload: multi-chunk resumable upload lands privately in versions/, mapped to the right clip, with progress', () => {
  const s = ready();
  const bytes = crypto.randomBytes(3.2 * 1024 * 1024); // 3 chunks of 1.5 MiB (last one partial)
  const start = s.call('apiStartClipUpload', 'PRD-001-R01', Object.assign({ clip: 'S3', fileName: 'IMG_1234.MOV', mime: 'video/quicktime', size: bytes.length, rightsConfirmed: true }, s.guard()));
  assert.equal(start.ok, true, start.error);
  assert.equal(start.chunkBytes, 1572864);
  assert.equal(start.chunkBytes % 262144, 0);
  const progress = [];
  let off = 0;
  let last;
  while (off < bytes.length) {
    last = s.call('apiUploadClipChunk', start.uploadId, off, bytes.subarray(off, off + start.chunkBytes).toString('base64'));
    assert.equal(last.ok, true, last.error);
    progress.push(last.done ? 'done' : last.next);
    off = last.done ? bytes.length : last.next;
  }
  assert.deepEqual(progress, [1572864, 3145728, 'done']);
  assert.equal(last.clip, 'S3');
  assert.equal(last.version, 1);
  const folder = s.env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01', 'versions');
  assert.ok(folder);
  const file = Object.values(s.env.drive.nodes).find((f) => f.kind === 'file' && f.parent === folder.id);
  assert.equal(file.bytes.equals(bytes), true, 'bytes arrive intact');
  assert.match(file.name, /^S3_[0-9a-f]{8}\.mov$/, 'server-generated name; the client file name is not used');
  assert.equal(file.shared, undefined, 'file stays private');
  assert.deepEqual(s.env.state.driveRequests.filter((r) => r.method === 'put').map((r) => r.headers['Content-Range']), [
    'bytes 0-1572863/' + bytes.length, 'bytes 1572864-3145727/' + bytes.length, 'bytes 3145728-' + (bytes.length - 1) + '/' + bytes.length,
  ]);
  assert.ok(s.env.state.driveRequests.every((r) => r.url.startsWith('https://upload.mock/') || /Bearer mock-oauth-token/.test(r.headers.Authorization)), 'the OAuth token only goes to Google');
  const c = s.clips().find((x) => x.key === 'S3');
  assert.equal(c.status, 'PENDING_REVIEW');
  assert.equal(c.current.v, 1);
  assert.equal(c.current.size, bytes.length);
  assert.equal(s.clips().filter((x) => x.status !== 'MISSING').length, 1, 'only S3 changed');
  assert.ok(s.audit().includes('CLIP_UPLOADED'));
  assert.equal(s.env.cacheMap.size, 0, 'upload session cleared');
  assert.match(s.env.sheets.AUDIT.rows.at(-1).join(' '), /S3 v1 \(dashboard, 파일 ID .*md5 .*권리 확인 체크함\)/);
});

test('clip upload: resume after a failed chunk, protocol guards, expired session, other account', () => {
  let failOnce = true;
  const s = ready({ driveFault: (req, n) => (req.method === 'put' && /bytes 1572864-/.test(req.headers['Content-Range'] || '') && failOnce ? ((failOnce = false), 503) : 0) });
  const bytes = crypto.randomBytes(1572864 * 2 + 5000);
  const start = s.call('apiStartClipUpload', 'PRD-001-R01', Object.assign({ clip: 'S1', fileName: 'S1.mp4', mime: 'video/mp4', size: bytes.length, rightsConfirmed: true }, s.guard()));
  const send = (off, len) => s.call('apiUploadClipChunk', start.uploadId, off, bytes.subarray(off, off + len).toString('base64'));
  assert.equal(send(0, 1572864).next, 1572864);
  const bad = send(1572864, 1572864);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /^RETRY:/, 'a temporary Drive error is marked retryable');
  // Ask where to resume, then continue from there.
  const st = s.call('apiClipUploadStatus', start.uploadId);
  assert.deepEqual([st.ok, st.done, st.next], [true, false, 1572864]);
  assert.match(send(1572864, 100000).error, /256KiB의 배수/, 'a non-final chunk must be a multiple of 256 KiB');
  const again = send(1572864, 1572864);
  assert.equal(again.next, 3145728);
  // Protocol guards.
  assert.match(send(0, 1572864).error, /조각 위치가 맞지 않습니다 \(서버 기준 3145728\)/);
  assert.match(s.call('apiUploadClipChunk', start.uploadId, 3145728, bytes.subarray(0, 100000).toString('base64')).error, /파일 크기를 넘는 조각/);
  assert.match(s.call('apiUploadClipChunk', start.uploadId, 3145728, '').error, /조각 크기/);
  assert.match(s.call('apiUploadClipChunk', start.uploadId, 3145728, Buffer.alloc(1572864 * 2).toString('base64')).error, /조각 크기가 올바르지 않습니다/);
  // Another signed-in reviewer cannot continue someone else's upload.
  s.env.props.RF_REVIEWERS = 'owner@example.com,other@example.com';
  s.env.state.email = 'other@example.com';
  assert.match(s.call('apiUploadClipChunk', start.uploadId, 3145728, bytes.subarray(3145728).toString('base64')).error, /다른 계정에서 시작/);
  s.env.state.email = 'owner@example.com';
  const done = send(3145728, 5000);
  assert.equal(done.done, true, done.error);
  // Expired session → clear restart message.
  assert.match(s.call('apiUploadClipChunk', 'deadbeef', 0, 'AA==').error, /세션이 만료되었거나 없습니다/);
});

test('clip upload: a lost final response is recovered through the status call (no duplicate version)', () => {
  const s = ready();
  const bytes = s.bytesFor('S2');
  const start = s.call('apiStartClipUpload', 'PRD-001-R01', Object.assign({ clip: 'S2', fileName: 'S2.mp4', mime: 'video/mp4', size: bytes.length, rightsConfirmed: true }, s.guard()));
  // The chunk reaches Drive but the response is lost: send straight to the mock session instead.
  const sessionId = Object.keys(s.env.drive.sessions)[0];
  s.env.drive.sessions[sessionId].parts.push(bytes);
  s.env.drive.sessions[sessionId].got = bytes.length;
  const st = s.call('apiClipUploadStatus', start.uploadId);
  assert.equal(st.done, true, st.error);
  assert.equal(st.version, 1);
  assert.equal(s.clips().find((c) => c.key === 'S2').versions.length, 1);
});

test('duplicates: the same video cannot be uploaded twice (any scene); the duplicate is moved to the trash', () => {
  const s = ready();
  const bytes = s.bytesFor('S1');
  assert.equal(s.upload('S1', bytes).done, true);
  const again = s.upload('S1', bytes);
  assert.equal(again.ok, false);
  assert.match(again.error, /같은 영상이 이미 S1 v1\(으\)로 올라와 있습니다/);
  const other = s.upload('S2', bytes);
  assert.match(other.error, /이미 S1 v1/);
  const files = Object.values(s.env.drive.nodes).filter((f) => f.kind === 'file' && /^S\d_/.test(f.name));
  assert.equal(files.filter((f) => !f.trashed).length, 1, 'only the first copy is live');
  assert.equal(files.filter((f) => f.trashed).length, 2);
  assert.equal(s.clips().find((c) => c.key === 'S1').versions.length, 1);
  assert.equal(s.clips().find((c) => c.key === 'S2').status, 'MISSING');
});

// ------------------------------------------------------------------ review, versions, replacement

test('review: approve / reject (reason required) apply to the current version only and are audited', () => {
  const s = ready();
  const up = s.upload('S1', s.bytesFor('S1'));
  assert.match(s.review('S1', 1, 'REJECT', '').error, /다시 만들 이유/);
  assert.match(s.review('S1', 5, 'APPROVE').error, /새 버전이 올라왔습니다/);
  assert.match(s.review('S2', 1, 'APPROVE').error, /새 버전이 올라왔습니다/, 'a clip with no upload cannot be approved');
  assert.match(s.review('S1', 1, 'MAYBE').error, /승인 또는 반려/);
  const rej = s.review('S1', 1, 'REJECT', '제품 색이 밝은 회색으로 보임');
  assert.equal(rej.ok, true, rej.error);
  let c = s.clips().find((x) => x.key === 'S1');
  assert.deepEqual([c.status, c.current.note], ['REJECTED', '제품 색이 밝은 회색으로 보임']);
  // Remake: a new version replaces the rejected one; the rejected one stays in the history.
  const up2 = s.upload('S1', s.bytesFor('S1', 14 * 1024));
  assert.equal(up2.version, 2);
  c = s.clips().find((x) => x.key === 'S1');
  assert.deepEqual(c.versions.map((v) => [v.v, v.status]), [[1, 'REJECTED'], [2, 'PENDING_REVIEW']]);
  const ok = s.review('S1', 2, 'APPROVE');
  assert.equal(ok.ok, true, ok.error);
  assert.equal(s.clips().find((x) => x.key === 'S1').status, 'APPROVED');
  assert.deepEqual(s.audit().filter((a) => a.startsWith('CLIP_')), ['CLIP_UPLOADED', 'CLIP_REJECTED', 'CLIP_UPLOADED', 'CLIP_APPROVED']);
  assert.match(s.env.sheets.AUDIT.rows.at(-2).join(' '), /S1 v2 \(dashboard/);
  // Approving again is a no-op, not a second audit row.
  const n = s.audit().length;
  assert.equal(s.review('S1', 2, 'APPROVE').ok, true);
  assert.equal(s.audit().length, n);
  // Approval needs the Drive file to still be the uploaded bytes.
  const f = Object.values(s.env.drive.nodes).find((x) => x.kind === 'file' && x.name.startsWith('S1_') && x.bytes.length === 14 * 1024);
  const s2 = ready();
  const u = s2.upload('S4', s2.bytesFor('S4'));
  const node = Object.values(s2.env.drive.nodes).find((x) => x.kind === 'file' && x.name.startsWith('S4_'));
  node.bytes = Buffer.alloc(12 * 1024, 'tampered');
  assert.match(s2.review('S4', 1, 'APPROVE').error, /파일이 업로드한 뒤 바뀌었/);
  node.trashed = true;
  assert.match(s2.review('S4', 1, 'APPROVE').error, /휴지통|바뀌었/);
  assert.ok(f);
});

test('replacement invalidates the prior approval, keeps every version and file ID, and re-opens the gate', () => {
  const s = ready();
  s.approveAll();
  assert.equal(s.detail().media.allApproved, true);
  const before = s.clips().find((c) => c.key === 'S3');
  const firstFileId = Object.values(s.env.drive.nodes).find((f) => f.kind === 'file' && f.name.startsWith('S3_')).id;
  const rep = s.upload('S3', s.bytesFor('S3', 15 * 1024));
  assert.equal(rep.version, 2);
  assert.equal(rep.invalidated, true);
  const c = s.clips().find((x) => x.key === 'S3');
  assert.equal(c.status, 'PENDING_REVIEW', 'replacement needs a new approval');
  assert.deepEqual(c.versions.map((v) => [v.v, v.status]), [[1, 'SUPERSEDED'], [2, 'PENDING_REVIEW']]);
  assert.ok(before.versions[0].url.includes(firstFileId), 'version 1 keeps its Drive file ID');
  assert.equal(Object.values(s.env.drive.nodes).filter((f) => f.kind === 'file' && f.name.startsWith('S3_') && !f.trashed).length, 2, 'old file is not deleted');
  assert.equal(s.detail().media.allApproved, false);
  assert.match(s.env.sheets.AUDIT.rows.at(-1).join(' '), /이전 승인 v1 무효/);
  // The old version can no longer be approved by mistake.
  assert.match(s.review('S3', 1, 'APPROVE').error, /새 버전이 올라왔습니다/);
  assert.equal(s.review('S3', 2, 'APPROVE').ok, true);
  assert.equal(s.detail().media.allApproved, true);
});

test('approvals belong to one approval of the script: withdrawing it and approving a changed script voids them', () => {
  const s = ready();
  s.approveAll();
  assert.equal(s.detail().media.approved, s.detail().media.total);
  assert.equal(s.call('apiAction', 'PRD-001-R01', 'REOPEN_SCRIPT', Object.assign({}, s.guard(), { expectedVideoVersion: 0 })).ok, true);
  assert.match(s.upload('S1', s.bytesFor('S1', 13000)).error, /대본 승인 후에만/);
  // Edit the script (new fingerprint) and approve again → old clip approvals no longer count.
  const edit = s.call('apiAction', 'PRD-001-R01', 'EDIT_SCRIPT', Object.assign({}, s.guard(), { expectedVideoVersion: 0, edit: { cta: undefined, narration: undefined, concept: '비 오는 날 현관 (수정)' } }));
  assert.equal(edit.ok, true, edit.error);
  const ap = s.call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', Object.assign({}, s.guard(), { expectedVideoVersion: 0 }));
  assert.equal(ap.ok, true, ap.error);
  assert.ok(s.clips().every((c) => c.status === 'PENDING_REVIEW'), JSON.stringify(s.clips().map((c) => c.status)));
  assert.equal(s.detail().media.allApproved, false);
});

// ------------------------------------------------------------------ render gate

test('final render is enabled only when every clip is APPROVED; the signed job carries the approved manifest', () => {
  const s = ready();
  assert.equal(s.call('apiAction', 'PRD-001-R01', 'START_VIDEO', Object.assign({}, s.guard(), { expectedVideoVersion: 0 })).ok, true);
  const jobErr = () => s.call('apiGetRenderJob', 'PRD-001-R01');
  assert.match(jobErr().error, /모든 장면 클립이 승인되어야 최종 영상을 만들 수 있습니다 \(승인 0\/6\): S1 클립 없음, S2 클립 없음/);
  const clips = s.clips();
  clips.slice(0, 5).forEach((c) => {
    const up = s.upload(c.key, s.bytesFor(c.key));
    if (c.key !== 'S4') s.review(c.key, up.version, 'APPROVE');
  });
  assert.match(jobErr().error, /승인 4\/6\): S4 승인 대기, S6 클립 없음/);
  s.review('S4', 1, 'APPROVE');
  s.upload('S6', s.bytesFor('S6'));
  assert.match(jobErr().error, /승인 5\/6\): S6 승인 대기/);
  s.review('S6', 1, 'REJECT', '다시');
  assert.match(jobErr().error, /S6 다시 만들기 필요/);
  s.upload('S6', s.bytesFor('S6', 13000));
  s.review('S6', 2, 'APPROVE');
  const r = jobErr();
  assert.equal(r.ok, true, r.error);
  const payload = JSON.parse(JSON.parse(r.jobFile).payload);
  const m = payload.clipManifest;
  assert.equal(m.approvedHash, payload.approvedHash);
  assert.deepEqual([m.reelId, m.productId], ['PRD-001-R01', 'PRD-001']);
  assert.deepEqual(m.clips.map((c) => c.clip), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.deepEqual(m.clips.map((c) => c.scene), [1, 2, 3, 4, 5, 6]);
  assert.equal(m.clips[5].version, 2);
  m.clips.forEach((c) => {
    const f = s.env.drive.nodes[c.fileId];
    assert.equal(c.md5, s.env.drive.md5(f.bytes));
    assert.equal(c.size, f.bytes.length);
    assert.equal(c.approvedBy, 'owner@example.com');
  });
  assert.ok(!JSON.stringify(payload).includes('link.coupang.com'));
});

test('job issue re-checks Drive: an approved file that changed or was trashed afterwards blocks the job', () => {
  const s = ready();
  s.call('apiAction', 'PRD-001-R01', 'START_VIDEO', Object.assign({}, s.guard(), { expectedVideoVersion: 0 }));
  s.approveAll();
  assert.equal(s.call('apiGetRenderJob', 'PRD-001-R01').ok, true);
  const node = Object.values(s.env.drive.nodes).find((f) => f.kind === 'file' && f.name.startsWith('S2_'));
  node.bytes = Buffer.alloc(12 * 1024, 'edited later');
  const res = s.call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(res.ok, false);
  assert.match(res.error, /S2 \(파일이 바뀌었거나 휴지통에 있음\).*다시 업로드하고 승인/);
  node.bytes = Buffer.alloc(12 * 1024, 'S2-clip');
  assert.equal(s.call('apiGetRenderJob', 'PRD-001-R01').ok, true, 'restored bytes → OK again');
  node.trashed = true;
  assert.match(s.call('apiGetRenderJob', 'PRD-001-R01').error, /S2/);
});

test('reels without a production plan keep the earlier flow (no clip gate, no manifest)', () => {
  const s = setup();
  s.env.sheets.PRODUCTS.rows[1][9] = '';
  s.call('apiGenerateScripts', 'PRD-001');
  assert.equal(s.call('apiAction', 'PRD-001-R01', 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, expectedVideoVersion: 0 }).ok, true);
  assert.equal(s.call('apiAction', 'PRD-001-R01', 'START_VIDEO', Object.assign({}, s.guard(), { expectedVideoVersion: 0 })).ok, true);
  const r = s.call('apiGetRenderJob', 'PRD-001-R01');
  assert.equal(r.ok, true, r.error);
  const payload = JSON.parse(JSON.parse(r.jobFile).payload);
  assert.equal(payload.clipManifest, null);
  assert.equal(payload.productionPlan, null);
  assert.equal(s.detail().media.gated, false);
});

// ------------------------------------------------------------------ fallback: Drive app upload + attach

test('fallback: a clip uploaded with the Drive app is attached from the reel folder only; checks type, size, location, rights', () => {
  const s = ready();
  const g = s.guard();
  assert.equal(s.call('apiPrepareAssets', 'PRD-001-R01', g).ok, true);
  const folder = s.env.drive.folderByPath('Reels Factory', 'PRD-001', 'PRD-001-R01');
  const mine = s.env.drive.addFile(folder.id, 'S2.mp4', Buffer.alloc(20000, 'from drive app'));
  const elsewhere = s.env.drive.addFile('', 'S2.mp4', Buffer.alloc(20000, 'not in folder'));
  const wrongType = s.env.drive.addFile(folder.id, 'notes.mp4', Buffer.alloc(20000, 'x'), 'text/plain');
  const tiny = s.env.drive.addFile(folder.id, 'tiny.mp4', Buffer.alloc(100, 'x'));
  s.call('apiPrepareAssets', 'PRD-001-R01', s.guard());
  const view = s.clips().find((c) => c.key === 'S2');
  assert.deepEqual(view.attachable.map((a) => a.fileId), [mine], 'offered from the tracker: files in the reel folder only');
  const attach = (fileId, over = {}) => s.call('apiAttachDriveClip', 'PRD-001-R01', Object.assign({ clip: 'S2', fileId, rightsConfirmed: true }, s.guard(), over));
  assert.match(attach(mine, { rightsConfirmed: false }).error, /권리 확인/);
  assert.match(attach(elsewhere).error, /이 릴스의 Drive 폴더.*있는 파일만/);
  assert.match(attach(wrongType).error, /MP4 또는 MOV/);
  assert.match(attach(tiny).error, /크기가 허용 범위/);
  assert.match(attach('nope').error, /파일 ID가 올바르지 않습니다/);
  const ok = attach(mine);
  assert.equal(ok.ok, true, ok.error);
  const c = ok.detail.media.clips.find((x) => x.key === 'S2');
  assert.deepEqual([c.status, c.current.v, c.versions[0].source], ['PENDING_REVIEW', 1, 'drive-app']);
  assert.equal(c.attachable.length, 0, 'no longer offered once registered');
  // The same bytes cannot be attached again (duplicate), and the operator's own file is NOT trashed.
  const copy = s.env.drive.addFile(folder.id, 'S3.mp4', Buffer.alloc(20000, 'from drive app'));
  assert.match(attach(copy, { clip: 'S3' }).error, /이미 S2 v1/);
  assert.notEqual(s.env.drive.nodes[copy].trashed, true);
  assert.equal(s.review('S2', 1, 'APPROVE').ok, true);
});

// ------------------------------------------------------------------ existing data preservation

test('existing sheets are preserved: only the clip cell, AUDIT and LOG are written; PRODUCTS rows and other reels untouched', () => {
  const s = ready();
  const products = JSON.stringify(s.env.sheets.PRODUCTS.rows);
  const reelBefore = plain(s.reelRow());
  s.upload('S1', s.bytesFor('S1'));
  s.review('S1', 1, 'APPROVE');
  assert.equal(JSON.stringify(s.env.sheets.PRODUCTS.rows), products, 'PRODUCTS unchanged by clip work');
  const after = s.reelRow();
  const changed = Object.keys(after).filter((k) => JSON.stringify(plain(after)[k]) !== JSON.stringify(reelBefore[k]));
  assert.deepEqual(changed, ['장면 클립(JSON)'], 'the script, approval, hooks, plan and tracker cells are untouched');
  // 시트 준비 on a sheet that lacks the new column appends it without changing a cell.
  const old = setup({ mediaColumn: false });
  old.call('apiGenerateScripts', 'PRD-001');
  const rows = JSON.stringify(old.env.sheets.REELS.rows);
  old.env.gs('setupSheets()');
  const hdr = old.env.sheets.REELS.rows[0];
  assert.equal(hdr.at(-1), '장면 클립(JSON)');
  const sameCells = JSON.parse(rows).every((r, i) => r.every((v, j) => JSON.stringify(old.env.sheets.REELS.rows[i][j]) === JSON.stringify(v)));
  assert.equal(sameCells, true);
});

test('dashboard data: scenes, versions, flow link, limits; no Drive call to build the view', () => {
  const s = ready();
  s.upload('S1', s.bytesFor('S1'));
  const n = s.env.state.driveRequests.length;
  const d = s.detail();
  assert.equal(s.env.state.driveRequests.length, n, 'viewing the dashboard makes no Drive request');
  assert.equal(d.media.flowUrl, 'https://flow.google');
  assert.match(d.media.flowNote, /자동화하지 않습니다/);
  assert.deepEqual(d.media.limits, { clipMaxMB: 100, chunkBytes: 1572864, clipExtensions: ['mp4', 'mov', 'm4v'], refMax: 4, refMaxKB: 3072 });
  assert.deepEqual([d.media.approved, d.media.total, d.media.gated, d.media.references.columnPresent], [0, 6, true, true]);
  assert.deepEqual(d.media.clips.map((c) => c.status), ['PENDING_REVIEW', 'MISSING', 'MISSING', 'MISSING', 'MISSING', 'MISSING']);
  assert.match(d.media.clips[0].current.previewUrl, /drive\.google\.com\/file\/d\/.*\/preview/);
  s.env.props.RF_FLOW_URL = 'https://example.org/flow';
  assert.equal(s.detail().media.flowUrl, 'https://example.org/flow');
  s.env.props.RF_FLOW_URL = 'javascript:alert(1)';
  assert.equal(s.detail().media.flowUrl, 'https://flow.google', 'only https links are used');
});
