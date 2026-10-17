/**
 * Render jobs: the ONLY way the renderer (Mac now, cloud later) receives a script.
 *
 * A job is issued only for a reel that is VIDEO_IN_PRODUCTION, whose approved script is intact
 * and whose media permission is verified. The job is signed (HMAC-SHA256, Script Property
 * RF_RENDER_SECRET); the renderer refuses unsigned, tampered, expired or unapproved jobs
 * BEFORE making any paid API call (TTS). Pure functions here; signing lives in WebApp.gs.
 */

const RF_RENDER_JOB_VERSION = 1;
const RF_RENDER_JOB_TTL_HOURS = 72;

/** Returns '' if a render job may be issued for this row, otherwise the reason. */
function renderJobBlocker(row, product) {
  const status = reelStatus(row);
  if (status !== 'VIDEO_IN_PRODUCTION') {
    return '렌더 작업은 "영상 제작 중" 상태에서만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + '). 대본 승인 후 "영상 제작 시작"을 누르세요.';
  }
  if (!isApprovedScriptIntact(row)) {
    return '승인된 대본과 현재 대본이 다릅니다. 승인 취소 후 다시 승인하세요.';
  }
  if (!isPermissionApproved(product.permission)) {
    return 'PRODUCTS의 "영상 사용 허가 상태"가 확인되지 않았습니다.';
  }
  // Reels with a Gemini production plan: every Flow clip must be APPROVED in the dashboard (Media.gs).
  return clipGateBlocker_(row);
}

/**
 * Job payload (as a JSON string, so the signature covers exact bytes).
 * Contains only what rendering needs: no affiliate URL, no API keys.
 */
function buildRenderJobPayload(row, product, issuedAtIso, ttlHours) {
  const blocker = renderJobBlocker(row, product);
  if (blocker) throw new Error(blocker);
  const cells = {};
  RF_SCRIPT_FIELDS.forEach(function (f) {
    cells[f] = cellText_(row[f]);
  });
  const issued = new Date(issuedAtIso);
  const expires = new Date(issued.getTime() + (ttlHours || RF_RENDER_JOB_TTL_HOURS) * 3600 * 1000);
  return JSON.stringify({
    jobVersion: RF_RENDER_JOB_VERSION,
    reelId: cellText_(row['릴스ID']),
    productId: cellText_(row['상품ID']),
    productName: normalizeText(product.name),
    status: 'VIDEO_IN_PRODUCTION',
    scriptVersion: scriptVersionOf(row),
    approvedScriptVersion: parseInt(cellText_(row['승인 대본 버전']), 10),
    approvedHash: cellText_(row['승인 대본 해시']),
    nextVideoVersion: videoVersionOf(row) + 1,
    permission: normalizeText(product.permission),
    // What the renderer needs for the shot list; facts are already public product claims.
    product: {
      name: normalizeText(product.name),
      facts: parseConfirmedFeatures(product.features),
      appearance: normalizeText(product.appearance),
    },
    flowPrompts: (function () {
      try {
        const v = JSON.parse(cellText_(row['Flow 장면 프롬프트']) || '[]');
        if (Array.isArray(v) && v.length) return v;
      } catch (e) {
        // fall through: approved before prompts existed → generate now (free)
      }
      return buildFlowScenePrompts(row, product);
    })(),
    // Gemini's production plan (only if it belongs to THIS approved script): TTS rate/pauses, cuts,
    // subtitle emphasis, the product's visual spec and what to check in the finished video.
    productionPlan: validProductionPlan(row),
    // Every approved clip with its Drive file ID and checksum. The renderer refuses a job whose plan has no
    // complete manifest, and checks each local clip against it before any paid step.
    clipManifest: buildClipManifest_(row),
    // Verified product images (Drive file IDs) the renderer's final check compares the video against.
    referenceImages: parseReferenceImages(product.referenceImages),
    // Where the Flow clips live in Google Drive (tracked by the dashboard), for `fetch-clips`.
    drive: (function () {
      const a = parseAssetStatus_(row);
      if (!a || a.approvedHash !== cellText_(row['승인 대본 해시'])) return null;
      return {
        folderId: a.folderId,
        files: a.clips.filter(function (c) { return c.status === 'UPLOADED'; }).map(function (c) {
          return { clip: c.file, name: c.driveName, id: c.driveFileId, size: c.sizeBytes };
        }),
      };
    })(),
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
    script: cells,
  });
}

/** Hex encoding of a signed byte array (Apps Script Utilities returns -128..127). */
function bytesToHex_(bytes) {
  return bytes
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}
