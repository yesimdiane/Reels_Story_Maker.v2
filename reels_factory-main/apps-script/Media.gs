/**
 * Mobile media workspace (iPhone Safari): verified product reference photos, Google Flow clip uploads,
 * per-clip review, and the render gate. Google Flow stays MANUAL — nothing here calls Flow or Veo, and no
 * paid generation is started automatically.
 *
 * Upload design (see docs/media-workspace.md): a clip is sent from the browser in small chunks
 * (google.script.run carries ~50 MB at most per call, and base64 adds a third). Apps Script forwards each
 * chunk to a Drive *resumable upload session* it opened with the operator's own OAuth token, so no whole
 * file is ever held in Apps Script and no Drive token reaches the browser. Files stay private in the
 * operator's Drive (never shared). Fallback when direct upload fails or is too slow: upload the file with
 * the Drive app into the reel's folder and attach it from the dashboard.
 *
 * Rules enforced here (all server-side, the browser is not trusted):
 *  - uploads and reviews only for an approved, unchanged script; the target clip comes from the reel's own
 *    Flow clip list, never from a client-supplied name;
 *  - type, extension, size, duplicate content (Drive MD5) and the operator's media-rights confirmation;
 *  - every upload is a new version; a replacement voids the previous approval; versions and Drive file IDs
 *    are never deleted;
 *  - the final render (job file) needs every clip APPROVED, and the approved files must still be the same
 *    bytes in Drive.
 */

// ---------------------------------------------------------------- small helpers

function mediaUserCache_() {
  return CacheService.getUserCache();
}

/** Unsigned view of an Apps Script byte array. */
function ub_(b) {
  return b < 0 ? b + 256 : b;
}

function md5Hex_(bytes) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
}

/** 'image/png' | 'image/jpeg' | 'image/webp' from the file's own bytes (the claimed type is not trusted), or ''. */
function sniffImageMime_(bytes) {
  const b = bytes.slice(0, 12).map(ub_);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

function flowUrl_() {
  const custom = PropertiesService.getScriptProperties().getProperty('RF_FLOW_URL');
  return custom && /^https:\/\//.test(custom) ? custom : RF_CONFIG.MEDIA.FLOW_URL;
}

function driveAuthHeaders_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

/** Drive v3 file metadata: { id, name, size (string), mimeType, md5Checksum, parents, trashed }. */
function driveFileMeta_(fileId) {
  const fields = 'id,name,size,mimeType,md5Checksum,parents,trashed';
  const res = UrlFetchApp.fetch(RF_CONFIG.MEDIA.DRIVE_API + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=' + encodeURIComponent(fields), {
    method: 'get', headers: driveAuthHeaders_(), muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 404) throw new Error('Drive에서 파일을 찾을 수 없습니다 (삭제되었거나 권한이 없습니다).');
  if (code !== 200) throw new Error('Drive 파일 정보를 읽지 못했습니다 (HTTP ' + code + ').');
  return JSON.parse(res.getContentText());
}

function headerOf_(res, name) {
  const all = res.getAllHeaders ? res.getAllHeaders() : res.getHeaders();
  const k = Object.keys(all || {}).filter(function (h) {
    return h.toLowerCase() === name.toLowerCase();
  })[0];
  return k ? String(all[k]) : '';
}

// ---------------------------------------------------------------- clip store (REELS "장면 클립(JSON)")

function clipKeyOf_(file) {
  return String(file).replace(/\.[A-Za-z0-9]+$/, '');
}

function parseClipStore_(row) {
  try {
    const v = JSON.parse(cellText_(row['장면 클립(JSON)']) || 'null');
    if (v && typeof v === 'object' && v.clips && typeof v.clips === 'object') return v;
  } catch (e) {
    // fall through
  }
  return { version: 1, clips: {} };
}

/**
 * Status of one clip for the CURRENT approval: MISSING | PENDING_REVIEW | APPROVED | REJECTED.
 * An approval counts only for the approved-script fingerprint it was given under.
 */
function clipState_(entry, hash) {
  const versions = entry && Array.isArray(entry.versions) ? entry.versions : [];
  const cur = versions.filter(function (v) {
    return v.v === entry.current;
  })[0] || null;
  if (!cur) return { status: 'MISSING', current: null };
  if (cur.status === 'APPROVED' && cur.approvedHash === hash) return { status: 'APPROVED', current: cur };
  if (cur.status === 'REJECTED') return { status: 'REJECTED', current: cur };
  return { status: 'PENDING_REVIEW', current: cur };
}

/** [{ key, file, scene, part, parts, beat, status, current, versions }] for every Flow clip of the reel. */
function clipList_(row) {
  const store = parseClipStore_(row);
  const hash = cellText_(row['승인 대본 해시']);
  return expectedClips_(row).map(function (c) {
    const key = clipKeyOf_(c.file);
    const entry = store.clips[key] || { versions: [], current: 0 };
    const st = clipState_(entry, hash);
    return Object.assign({}, c, { key: key, status: st.status, current: st.current, versions: entry.versions || [] });
  });
}

/** Pure render gate: '' when every clip is APPROVED (only for reels with a production plan), else the reason. */
function clipGateBlocker_(row) {
  if (!validProductionPlan(row)) return '';
  const list = clipList_(row);
  if (!list.length) return '장면 클립 목록이 없습니다. 제작 계획과 Flow 프롬프트를 먼저 만드세요.';
  const label = { MISSING: '클립 없음', PENDING_REVIEW: '승인 대기', REJECTED: '다시 만들기 필요' };
  const open = list.filter(function (c) {
    return c.status !== 'APPROVED';
  });
  if (!open.length) return '';
  return '모든 장면 클립이 승인되어야 최종 영상을 만들 수 있습니다 (승인 ' + (list.length - open.length) + '/' + list.length + '): ' +
    open.map(function (c) { return c.key + ' ' + label[c.status]; }).join(', ');
}

/** Approved clips as the signed render job carries them. */
function buildClipManifest_(row) {
  if (!validProductionPlan(row)) return null;
  return {
    approvedHash: cellText_(row['승인 대본 해시']),
    reelId: cellText_(row['릴스ID']),
    productId: cellText_(row['상품ID']),
    clips: clipList_(row).filter(function (c) {
      return c.status === 'APPROVED';
    }).map(function (c) {
      return {
        clip: c.key, file: c.file, scene: c.scene, part: c.part, version: c.current.v,
        fileId: c.current.fileId, driveName: c.current.name, md5: c.current.md5, size: c.current.size,
        approvedBy: c.current.reviewedBy, approvedAt: c.current.reviewedAt,
      };
    }),
  };
}

/** Before a job file is issued: every approved file must still be the same bytes in Drive. '' = OK. */
function verifyApprovedClipFiles_(row) {
  const manifest = buildClipManifest_(row);
  if (!manifest) return '';
  const bad = [];
  manifest.clips.forEach(function (c) {
    try {
      const m = driveFileMeta_(c.fileId);
      if (m.trashed || String(m.md5Checksum) !== c.md5 || Number(m.size) !== c.size) bad.push(c.clip + ' (파일이 바뀌었거나 휴지통에 있음)');
    } catch (e) {
      bad.push(c.clip + ' (' + e.message + ')');
    }
  });
  return bad.length ? '승인된 클립 파일을 Drive에서 확인하지 못했습니다: ' + bad.join(', ') + '. 해당 장면을 다시 업로드하고 승인하세요.' : '';
}

// ---------------------------------------------------------------- common guards

function mediaBlocker_(row, columnsMissing) {
  const status = reelStatus(row);
  if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
    return '클립 업로드·검토는 대본 승인 후에만 할 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + ').';
  }
  if (!isApprovedScriptIntact(row)) return '승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.';
  if (columnsMissing && columnsMissing.length) {
    return 'REELS에 열이 없습니다 (' + columnsMissing.join(', ') + '). "릴스 팩토리 → 시트 준비"를 먼저 실행하세요 — 기존 데이터는 바뀌지 않습니다.';
  }
  return '';
}

/** Loads the reel, checks the optimistic-concurrency fields and the guards. Returns { data, found, clip }. */
function mediaContext_(ss, reelId, input, needClip) {
  const data = loadData_(ss);
  const found = findReel_(data, normalizeText(reelId));
  const status = reelStatus(found.row);
  if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
    throw staleError_(found.row, status);
  }
  const blocker = mediaBlocker_(found.row, data.mediaColumnsMissing);
  if (blocker) throw new Error(blocker);
  let clip = null;
  if (needClip) {
    clip = clipList_(found.row).filter(function (c) {
      return c.key === input.clip;
    })[0];
    if (!clip) throw new Error('이 릴스에 없는 장면 클립입니다: ' + normalizeText(input.clip));
  }
  return { data: data, found: found, clip: clip };
}

function clipFolder_(product, reelId, sub) {
  const reel = childFolder_(childFolder_(driveRootFolder_(), product.id), reelId);
  return sub ? childFolder_(reel, sub) : reel;
}

// ---------------------------------------------------------------- reference photos

function referenceLinks_(text) {
  const ids = [];
  String(text == null ? '' : text).split(/[\n,;]+/).forEach(function (part) {
    const id = parseDriveFileId(part);
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}

/**
 * Saves one verified product photo to the product's Drive folder (Reels Factory / <상품ID> / references) and
 * APPENDS its link to that product's PRODUCTS "검증된 제품 이미지" cell. Nothing else in PRODUCTS is touched
 * (other rows, other cells, existing links and notes stay). Needs the operator's rights confirmation.
 * input: { data: base64, rightsConfirmed: true }
 */
function apiUploadReferencePhoto(productId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(productId);
    input = input || {};
    const M = RF_CONFIG.MEDIA;
    let result = null;
    withLock_(function () {
      const data = loadData_(ss);
      const product = data.productById[id];
      if (!product || product === 'DUPLICATE') throw new Error('PRODUCTS에서 상품ID "' + id + '"를 하나만 찾을 수 없습니다.');
      if (input.rightsConfirmed !== true) {
        throw new Error('이 사진이 실제 제품을 보여 주고, 내가 직접 찍었거나 사용 권한을 확인한 사진이라는 확인에 체크하세요. 제품을 샀다고 해서 타인이 만든 이미지의 권리가 생기지는 않습니다.');
      }
      const sheet = getProductsSheet_(ss);
      const field = RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages;
      const col = colOf_(getHeaderMap_(sheet), field);
      if (!col) {
        throw new Error('PRODUCTS에 "' + field + '" 열이 없습니다. 열 머리글을 오른쪽에 직접 추가한 뒤 다시 시도하세요 (PRODUCTS 구조는 자동으로 바꾸지 않습니다).');
      }
      const bytes = Utilities.base64Decode(String(input.data || ''));
      if (!bytes.length) throw new Error('사진 데이터가 비어 있습니다.');
      if (bytes.length > RF_CONFIG.PRODUCTION.MAX_IMAGE_BYTES) {
        throw new Error('사진이 너무 큽니다 (' + Math.round(bytes.length / 1024) + 'KB, 최대 ' + Math.round(RF_CONFIG.PRODUCTION.MAX_IMAGE_BYTES / 1024) + 'KB). 더 작게 줄여 올리세요.');
      }
      const mime = sniffImageMime_(bytes);
      if (!mime) throw new Error('PNG, JPEG, WebP 사진만 올릴 수 있습니다 (파일 내용을 확인했습니다).');
      // The product row is re-read right here, so a row that moved in the meantime is never written.
      const idCol = colOf_(getHeaderMap_(sheet), RF_CONFIG.PRODUCT_FIELDS.id);
      if (normalizeText(sheet.getRange(product.rowNumber, idCol, 1, 1).getValues()[0][0]) !== id) {
        throw new Error('PRODUCTS의 행이 바뀌었습니다. 새로고침 후 다시 시도하세요.');
      }
      const cell = sheet.getRange(product.rowNumber, col, 1, 1);
      const current = String(cell.getValues()[0][0] == null ? '' : cell.getValues()[0][0]).trim();
      const existing = referenceLinks_(current);
      if (existing.length >= M.REF_PHOTOS_MAX) {
        throw new Error('제품 참고 사진은 최대 ' + M.REF_PHOTOS_MAX + '장입니다. PRODUCTS에서 쓰지 않을 사진 링크를 지운 뒤 올리세요 (Drive 파일은 지우지 않습니다).');
      }
      const md5 = md5Hex_(bytes);
      existing.forEach(function (fid) {
        let m = null;
        try {
          m = driveFileMeta_(fid);
        } catch (e) {
          return; // an unreadable old link is not this upload's problem
        }
        if (m && m.md5Checksum === md5) throw new Error('같은 사진이 이미 등록되어 있습니다 (' + m.name + ').');
      });
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
      const stamp = Utilities.formatDate ? Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss') : String(Date.now());
      const name = 'ref-' + (existing.length + 1) + '-' + stamp + '.' + ext;
      const folder = childFolder_(childFolder_(driveRootFolder_(), id), M.REF_FOLDER_NAME);
      const file = folder.createFile(Utilities.newBlob(bytes, mime, name));
      const link = driveViewUrl(file.getId());
      cell.setNumberFormat('@');
      cell.setValues([[current ? current + '\n' + link : link]]);
      logEvent_('INFO', 'referencePhoto', id, '제품 참고 사진 추가 (권리 확인 체크함): ' + name, '작업자 ' + user + ' · 파일 ID ' + file.getId() + ' · md5 ' + md5);
      result = { fileId: file.getId(), name: name, count: existing.length + 1 };
    });
    return { reference: result };
  });
}

// ---------------------------------------------------------------- clip upload (chunked, resumable via Drive)

/**
 * Step 1: validates the request and opens a Drive resumable session for ONE clip. Returns the upload id
 * and chunk size; the browser then sends apiUploadClipChunk calls.
 * input: { clip: 'S3', fileName, mime, size, rightsConfirmed: true, expectedStatus, expectedScriptVersion }
 */
function apiStartClipUpload(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    input = input || {};
    const M = RF_CONFIG.MEDIA;
    const ctx = mediaContext_(ss, reelId, input, true);
    if (input.rightsConfirmed !== true) {
      throw new Error('이 영상이 Google Flow로 직접 만들었거나 사용 권한을 확인한 영상이라는 확인에 체크하세요. 제품을 소유한다고 해서 제3자 영상의 권리가 생기지는 않습니다.');
    }
    const ext = (/\.([A-Za-z0-9]+)$/.exec(normalizeText(input.fileName)) || [])[1];
    if (!ext || M.CLIP_EXTENSIONS.indexOf(ext.toLowerCase()) === -1) throw new Error('MP4 또는 MOV 영상만 올릴 수 있습니다 (' + M.CLIP_EXTENSIONS.join(', ') + ').');
    const mime = normalizeText(input.mime).toLowerCase();
    if (M.CLIP_MIME.indexOf(mime) === -1) throw new Error('영상 형식(' + (mime || '알 수 없음') + ')을 지원하지 않습니다. MP4 또는 MOV로 올리세요.');
    const size = Number(input.size);
    if (!(size >= M.CLIP_MIN_BYTES) || !isFinite(size) || Math.floor(size) !== size) throw new Error('영상 크기가 올바르지 않습니다.');
    if (size > M.CLIP_MAX_BYTES) throw new Error('영상이 너무 큽니다 (' + Math.round(size / 1048576) + 'MB, 최대 ' + Math.round(M.CLIP_MAX_BYTES / 1048576) + 'MB). 8초 클립은 보통 이보다 훨씬 작습니다.');
    const uploadId = Utilities.getUuid().replace(/-/g, '');
    const folder = clipFolder_(ctx.found.product, normalizeText(reelId), M.VERSIONS_FOLDER_NAME);
    // The Drive name is generated here; nothing from the browser decides where the file goes or what it is called.
    const name = ctx.clip.key + '_' + uploadId.slice(0, 8) + '.' + ext.toLowerCase();
    const res = UrlFetchApp.fetch(M.DRIVE_UPLOAD_API + '?uploadType=resumable&supportsAllDrives=true&fields=' + encodeURIComponent('id,name,size,mimeType,md5Checksum,parents,trashed'), {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: Object.assign(driveAuthHeaders_(), { 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) }),
      payload: JSON.stringify({ name: name, parents: [folder.getId()], mimeType: mime, appProperties: { rfReel: normalizeText(reelId), rfClip: ctx.clip.key, rfUpload: uploadId } }),
      muteHttpExceptions: true,
    });
    const uri = headerOf_(res, 'Location');
    if (res.getResponseCode() !== 200 || !uri) {
      throw new Error('Drive 업로드를 시작하지 못했습니다 (HTTP ' + res.getResponseCode() + '). Drive 권한과 저장 공간을 확인하세요.');
    }
    const session = {
      uri: uri, reelId: normalizeText(reelId), clip: ctx.clip.key, name: name, mime: mime, size: size, next: 0,
      user: user, scriptVersion: scriptVersionOf(ctx.found.row), folderId: folder.getId(),
    };
    mediaUserCache_().put('rfup:' + uploadId, JSON.stringify(session), M.UPLOAD_TTL_SEC);
    return { uploadId: uploadId, chunkBytes: M.CHUNK_BYTES, size: size, clip: ctx.clip.key, next: 0 };
  });
}

function loadUploadSession_(uploadId, user) {
  const raw = mediaUserCache_().get('rfup:' + normalizeText(uploadId));
  if (!raw) throw new Error('업로드 세션이 만료되었거나 없습니다. 같은 장면에서 업로드를 처음부터 다시 시작하세요 (Drive에 올라간 일부 데이터는 완성되지 않은 임시 파일입니다).');
  const s = JSON.parse(raw);
  if (s.user !== user) throw new Error('이 업로드는 다른 계정에서 시작되었습니다.');
  return s;
}

/** Interprets a Drive resumable response. Returns { done, next, meta }. */
function readUploadResponse_(res, session, uploadId) {
  const code = res.getResponseCode();
  if (code === 308) {
    const range = headerOf_(res, 'Range');
    const m = /bytes=0-(\d+)/.exec(range);
    return { done: false, next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) return { done: true, meta: JSON.parse(res.getContentText()) };
  if (code === 404 || code === 410) {
    mediaUserCache_().remove('rfup:' + uploadId);
    throw new Error('Drive 업로드 세션이 만료되었습니다. 이 장면에서 업로드를 처음부터 다시 시작하세요.');
  }
  if (code === 429 || code >= 500) throw new Error('RETRY: Drive가 일시적으로 응답하지 않습니다 (HTTP ' + code + '). 잠시 후 이어서 다시 시도합니다.');
  throw new Error('Drive가 업로드를 거부했습니다 (HTTP ' + code + ').');
}

function finishUpload_(ss, session, uploadId, meta, user) {
  if (Number(meta.size) !== session.size) {
    throw new Error('업로드된 크기(' + meta.size + ')가 선택한 파일 크기(' + session.size + ')와 다릅니다. 다시 업로드하세요.');
  }
  mediaUserCache_().remove('rfup:' + uploadId);
  return registerClipVersion_(ss, session.reelId, session.clip, meta, 'dashboard', user);
}

/**
 * Step 2 (repeat): sends one chunk. offset must equal the bytes Drive already has; every chunk except the last
 * is a multiple of 256 KiB. Returns { done:false, next } or { done:true, ... } when the clip is registered.
 * A message starting with "RETRY:" means the same call may be repeated; after any other doubt call
 * apiClipUploadStatus to learn where to resume.
 */
function apiUploadClipChunk(uploadId, offset, base64) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const M = RF_CONFIG.MEDIA;
    const s = loadUploadSession_(uploadId, user);
    const bytes = Utilities.base64Decode(String(base64 || ''));
    const start = Number(offset);
    if (!bytes.length || bytes.length > M.CHUNK_BYTES) throw new Error('조각 크기가 올바르지 않습니다.');
    if (start !== s.next) throw new Error('조각 위치가 맞지 않습니다 (서버 기준 ' + s.next + '). 상태를 확인한 뒤 이어서 보내세요.');
    const end = start + bytes.length;
    if (end > s.size) throw new Error('파일 크기를 넘는 조각입니다.');
    if (end < s.size && bytes.length % (256 * 1024) !== 0) throw new Error('중간 조각은 256KiB의 배수여야 합니다.');
    const res = UrlFetchApp.fetch(s.uri, {
      method: 'put',
      headers: { 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + s.size },
      contentType: s.mime,
      payload: bytes,
      muteHttpExceptions: true,
    });
    const r = readUploadResponse_(res, s, normalizeText(uploadId));
    if (r.done) return Object.assign({ done: true }, finishUpload_(ss, s, normalizeText(uploadId), r.meta, user));
    s.next = r.next;
    mediaUserCache_().put('rfup:' + normalizeText(uploadId), JSON.stringify(s), M.UPLOAD_TTL_SEC);
    return { done: false, next: s.next, size: s.size };
  });
}

/** Where to resume (asks Drive), or — if Drive already has the whole file — registers the clip. */
function apiClipUploadStatus(uploadId) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const s = loadUploadSession_(uploadId, user);
    const res = UrlFetchApp.fetch(s.uri, { method: 'put', headers: { 'Content-Range': 'bytes */' + s.size }, payload: '', muteHttpExceptions: true });
    const r = readUploadResponse_(res, s, normalizeText(uploadId));
    if (r.done) return Object.assign({ done: true }, finishUpload_(ss, s, normalizeText(uploadId), r.meta, user));
    s.next = r.next;
    mediaUserCache_().put('rfup:' + normalizeText(uploadId), JSON.stringify(s), RF_CONFIG.MEDIA.UPLOAD_TTL_SEC);
    return { done: false, next: s.next, size: s.size };
  });
}

/**
 * Fallback: attach a clip that was uploaded with the Drive app into this reel's folder (or its versions folder).
 * The file must be in that folder, a supported video, within the size limit, with a Drive checksum.
 * input: { clip, fileId, rightsConfirmed, expectedStatus, expectedScriptVersion }
 */
function apiAttachDriveClip(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    input = input || {};
    const M = RF_CONFIG.MEDIA;
    let view = null;
    withLock_(function () {
      const ctx = mediaContext_(ss, reelId, input, true);
      if (input.rightsConfirmed !== true) throw new Error('영상 권리 확인에 체크하세요.');
      const fileId = parseDriveFileId(input.fileId);
      if (!fileId) throw new Error('Drive 파일 ID가 올바르지 않습니다.');
      const meta = driveFileMeta_(fileId);
      const reelFolder = clipFolder_(ctx.found.product, normalizeText(reelId));
      const versions = clipFolder_(ctx.found.product, normalizeText(reelId), M.VERSIONS_FOLDER_NAME);
      const parents = Array.isArray(meta.parents) ? meta.parents : [];
      if (parents.indexOf(reelFolder.getId()) === -1 && parents.indexOf(versions.getId()) === -1) {
        throw new Error('이 릴스의 Drive 폴더(' + normalizeText(reelId) + ')에 있는 파일만 연결할 수 있습니다.');
      }
      if (meta.trashed) throw new Error('휴지통에 있는 파일입니다.');
      const ext = (/\.([A-Za-z0-9]+)$/.exec(String(meta.name)) || [])[1];
      if (!ext || M.CLIP_EXTENSIONS.indexOf(ext.toLowerCase()) === -1 || M.CLIP_MIME.indexOf(String(meta.mimeType).toLowerCase()) === -1) {
        throw new Error('MP4 또는 MOV 영상만 연결할 수 있습니다.');
      }
      const size = Number(meta.size);
      if (!(size >= M.CLIP_MIN_BYTES) || size > M.CLIP_MAX_BYTES) throw new Error('영상 크기가 허용 범위(10KB~' + Math.round(M.CLIP_MAX_BYTES / 1048576) + 'MB)를 벗어납니다.');
      registerClipVersion_(ss, normalizeText(reelId), ctx.clip.key, meta, 'drive-app', user, true);
      view = true;
    });
    return { detail: reelDetail_(ss, normalizeText(reelId)), attached: view };
  });
}

/**
 * Records a new version of a clip (under the lock). The previous version is superseded — which voids its
 * approval — and nothing is ever deleted. A file with the same Drive checksum as any version of this reel is
 * refused (an upload we just made is moved to the trash; a file the operator put there is left alone).
 */
function registerClipVersion_(ss, reelId, key, meta, source, user, alreadyLocked) {
  const run = function () {
    const data = loadData_(ss);
    const found = findReel_(data, reelId);
    const blocker = mediaBlocker_(found.row, data.mediaColumnsMissing);
    if (blocker) throw new Error(blocker + ' (업로드한 파일은 Drive의 versions 폴더에 그대로 남아 있습니다.)');
    const clip = clipList_(found.row).filter(function (c) { return c.key === key; })[0];
    if (!clip) throw new Error('이 릴스에 없는 장면 클립입니다: ' + key);
    const store = parseClipStore_(found.row);
    const md5 = String(meta.md5Checksum || '');
    if (!md5) throw new Error('Drive가 파일 체크섬을 아직 계산하지 않았습니다. 잠시 후 다시 시도하세요.');
    const entry = store.clips[key] || (store.clips[key] = { versions: [], current: 0 });
    const same = entry.versions.filter(function (v) { return v.fileId === meta.id; })[0];
    if (same) return { clip: key, version: same.v, invalidated: false, duplicate: false }; // idempotent (retried finish)
    let dupOf = '';
    Object.keys(store.clips).forEach(function (k) {
      store.clips[k].versions.forEach(function (v) {
        if (v.md5 === md5 && !dupOf) dupOf = k + ' v' + v.v;
      });
    });
    if (dupOf) {
      if (source === 'dashboard') {
        try {
          DriveApp.getFileById(meta.id).setTrashed(true);
        } catch (e) {
          // the duplicate stays in versions/; it is not registered anywhere
        }
      }
      throw new Error('같은 영상이 이미 ' + dupOf + '(으)로 올라와 있습니다. 새로 만든 영상을 올리세요.');
    }
    const prev = entry.versions.filter(function (v) { return v.v === entry.current; })[0];
    const invalidated = !!prev && prev.status === 'APPROVED';
    if (prev && prev.status !== 'REJECTED') prev.status = 'SUPERSEDED';
    const v = entry.versions.reduce(function (n, x) { return Math.max(n, x.v); }, 0) + 1;
    entry.versions.push({
      v: v, fileId: meta.id, name: meta.name, mime: meta.mimeType, size: Number(meta.size), md5: md5, source: source,
      uploadedBy: user, uploadedAt: new Date().toISOString(), rightsConfirmed: true, status: 'PENDING_REVIEW',
      reviewedBy: '', reviewedAt: '', approvedHash: '', note: '',
    });
    entry.current = v;
    updateRecord_(data.reelsSheet, found.row._row, { '장면 클립(JSON)': JSON.stringify(store) });
    appendAudit_(ss, [{
      '일시': new Date(), '릴스ID': reelId, '상품ID': found.row['상품ID'], '작업': 'CLIP_UPLOADED',
      '이전 상태': reelStatus(found.row), '새 상태': reelStatus(found.row), '대본 버전': scriptVersionOf(found.row), '영상 버전': videoVersionOf(found.row),
      '작업자': user,
      '메모': key + ' v' + v + ' (' + source + ', 파일 ID ' + meta.id + ', md5 ' + md5 + ', 권리 확인 체크함)' + (invalidated ? ' — 이전 승인 v' + prev.v + ' 무효' : ''),
    }]);
    return { clip: key, version: v, invalidated: invalidated, duplicate: false };
  };
  return alreadyLocked ? run() : withLock_(run);
}

// ---------------------------------------------------------------- review

/**
 * Approves or rejects the CURRENT version of one clip. A rejection needs a reason (what to remake).
 * input: { clip, version, decision: 'APPROVE'|'REJECT', note, expectedStatus, expectedScriptVersion }
 */
function apiReviewClip(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const ctx = mediaContext_(ss, id, input, true);
      const store = parseClipStore_(ctx.found.row);
      const entry = store.clips[ctx.clip.key];
      const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
      if (!cur || Number(input.version) !== cur.v) {
        throw new Error('이 장면에는 그사이 새 버전이 올라왔습니다. 새로고침한 뒤 최신 버전을 검토하세요.');
      }
      const decision = input.decision === 'APPROVE' ? 'APPROVE' : input.decision === 'REJECT' ? 'REJECT' : '';
      if (!decision) throw new Error('승인 또는 반려를 선택하세요.');
      const note = normalizeText(input.note);
      if (decision === 'REJECT' && !note) throw new Error('다시 만들 이유(무엇을 고칠지)를 적어 주세요.');
      if (decision === 'APPROVE') {
        if (cur.rightsConfirmed !== true) throw new Error('권리 확인이 없는 영상은 승인할 수 없습니다.');
        const hash = cellText_(ctx.found.row['승인 대본 해시']);
        if (cur.status === 'APPROVED' && cur.approvedHash === hash) return; // already approved: nothing to do
        // The file must still be the bytes that were uploaded.
        const m = driveFileMeta_(cur.fileId);
        if (m.trashed || String(m.md5Checksum) !== cur.md5) throw new Error('Drive의 파일이 업로드한 뒤 바뀌었거나 휴지통에 있습니다. 다시 업로드하세요.');
        cur.status = 'APPROVED';
        cur.approvedHash = hash;
      } else {
        cur.status = 'REJECTED';
        cur.approvedHash = '';
      }
      cur.reviewedBy = user;
      cur.reviewedAt = new Date().toISOString();
      cur.note = note;
      updateRecord_(ctx.data.reelsSheet, ctx.found.row._row, { '장면 클립(JSON)': JSON.stringify(store) });
      appendAudit_(ss, [{
        '일시': new Date(), '릴스ID': id, '상품ID': ctx.found.row['상품ID'], '작업': decision === 'APPROVE' ? 'CLIP_APPROVED' : 'CLIP_REJECTED',
        '이전 상태': reelStatus(ctx.found.row), '새 상태': reelStatus(ctx.found.row), '대본 버전': scriptVersionOf(ctx.found.row), '영상 버전': videoVersionOf(ctx.found.row),
        '작업자': user, '메모': ctx.clip.key + ' v' + cur.v + (note ? ': ' + note : ''),
      }]);
    });
    return { detail: reelDetail_(ss, id) };
  });
}

// ---------------------------------------------------------------- dashboard view

function mediaView_(row, product, data) {
  const status = reelStatus(row);
  const blocker = mediaBlocker_(row, data.mediaColumnsMissing);
  const visible = RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) !== -1;
  const list = clipList_(row);
  const tracker = parseAssetStatus_(row);
  const registered = {};
  list.forEach(function (c) {
    c.versions.forEach(function (v) { registered[v.fileId] = true; });
  });
  const refIds = referenceLinks_(product.referenceImages);
  return {
    visible: visible,
    blocker: blocker,
    columnsMissing: data.mediaColumnsMissing,
    gated: !!validProductionPlan(row),
    flowUrl: flowUrl_(),
    flowNote: 'Google Flow는 자동화하지 않습니다. 프롬프트를 복사해 Flow에서 직접 만든 뒤 여기에 올리세요.',
    limits: {
      clipMaxMB: Math.round(RF_CONFIG.MEDIA.CLIP_MAX_BYTES / 1048576), chunkBytes: RF_CONFIG.MEDIA.CHUNK_BYTES,
      clipExtensions: RF_CONFIG.MEDIA.CLIP_EXTENSIONS, refMax: RF_CONFIG.MEDIA.REF_PHOTOS_MAX,
      refMaxKB: Math.round(RF_CONFIG.PRODUCTION.MAX_IMAGE_BYTES / 1024),
    },
    references: {
      count: refIds.length, max: RF_CONFIG.MEDIA.REF_PHOTOS_MAX, columnPresent: !!data.referenceColumnPresent,
      items: refIds.map(function (id) { return { fileId: id, url: driveViewUrl(id) }; }),
    },
    clips: list.map(function (c) {
      const cur = c.current;
      return {
        key: c.key, file: c.file, scene: c.scene, part: c.part, parts: c.parts, beat: c.beat, status: c.status,
        current: cur ? { v: cur.v, name: cur.name, size: cur.size, uploadedBy: cur.uploadedBy, uploadedAt: cur.uploadedAt, previewUrl: drivePreviewUrl(cur.fileId), url: driveViewUrl(cur.fileId), note: cur.note } : null,
        versions: c.versions.map(function (v) {
          return { v: v.v, status: v.status, name: v.name, size: v.size, source: v.source, uploadedBy: v.uploadedBy, uploadedAt: v.uploadedAt, reviewedBy: v.reviewedBy, note: v.note, url: driveViewUrl(v.fileId) };
        }),
        attachable: tracker && tracker.clips ? tracker.clips.filter(function (t) {
          return t.file === c.file && t.status === 'UPLOADED' && !registered[t.driveFileId];
        }).map(function (t) { return { fileId: t.driveFileId, name: t.driveName, size: t.sizeBytes }; }) : [],
      };
    }),
    approved: list.filter(function (c) { return c.status === 'APPROVED'; }).length,
    total: list.length,
    allApproved: list.length > 0 && list.every(function (c) { return c.status === 'APPROVED'; }),
  };
}
