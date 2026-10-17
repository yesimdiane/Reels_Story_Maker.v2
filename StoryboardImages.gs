/**
 * Image-First Reels Production v2 — 9:16 Storyboard Images via Gemini 2.5 Flash Image.
 *
 * Workflow:
 * 1. Operator uploads real product reference images through the dashboard (saved in Drive).
 * 2. Gemini analyzes approved script and product photos to plan scenes S1–S5.
 * 3. Uses `gemini-2.5-flash-image` through the Gemini API with reference image bytes to generate 9:16 vertical images.
 * 4. Saves generated images to Google Drive (storyboard/ folder) and displays them in the mobile dashboard.
 * 5. Scene-by-scene image approval, revision requests, and regeneration.
 * 6. Invalidates dependent video approvals (scene clips and reel video approval) whenever an approved image changes.
 * 7. Provides image downloads and motion prompts for manual Google Flow image-to-video generation.
 * 8. Preserves media rights checks, script approval gates, clip reviews, and final FFmpeg rendering.
 */

// ---------------------------------------------------------------- store helpers

function imageKeyOf_(sceneNo) {
  return 'S' + Number(sceneNo);
}

function parseImageStore_(row) {
  try {
    const v = JSON.parse(cellText_(row['장면 이미지(JSON)']) || 'null');
    if (v && typeof v === 'object' && v.images && typeof v.images === 'object') return v;
  } catch (e) {
    // fall through
  }
  return { version: 1, images: {} };
}

/**
 * Status of one scene image for the CURRENT approval: MISSING | PENDING_REVIEW | APPROVED | REJECTED.
 * An approval counts only for the approved-script fingerprint it was given under.
 */
function imageState_(entry, hash) {
  const versions = entry && Array.isArray(entry.versions) ? entry.versions : [];
  const cur = versions.filter(function (v) {
    return v.v === entry.current;
  })[0] || null;
  if (!cur) return { status: 'MISSING', current: null };
  if (cur.status === 'APPROVED' && cur.approvedHash === hash) return { status: 'APPROVED', current: cur };
  if (cur.status === 'REJECTED') return { status: 'REJECTED', current: cur };
  return { status: 'PENDING_REVIEW', current: cur };
}

function storyboardFolder_(product, reelId) {
  const reel = childFolder_(childFolder_(driveRootFolder_(), product.id), reelId);
  return childFolder_(reel, (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.FOLDER_NAME) || 'storyboard');
}

function findStoryboardFolderIfExists_(product, reelId) {
  try {
    const root = driveRootFolder_();
    if (!root) return null;
    const prodIt = root.getFoldersByName(product.id);
    if (!prodIt.hasNext()) return null;
    const prodFolder = prodIt.next();
    const reelIt = prodFolder.getFoldersByName(reelId);
    if (!reelIt.hasNext()) return null;
    const reelFolder = reelIt.next();
    const sbName = (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.FOLDER_NAME) || 'storyboard';
    const sbIt = reelFolder.getFoldersByName(sbName);
    if (!sbIt.hasNext()) return null;
    return sbIt.next();
  } catch (e) {
    return null;
  }
}

function findRecoverableStoryboardFiles_(product, reelId, currentStore) {
  const folder = findStoryboardFolderIfExists_(product, reelId);
  if (!folder) return [];
  const registeredFileIds = {};
  if (currentStore && currentStore.images) {
    Object.keys(currentStore.images).forEach(function (k) {
      const entry = currentStore.images[k];
      if (entry && Array.isArray(entry.versions)) {
        entry.versions.forEach(function (v) {
          if (v && v.fileId) registeredFileIds[v.fileId] = true;
        });
      }
    });
  }
  const recoverable = [];
  try {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();
      if (registeredFileIds[fileId]) continue;
      const name = file.getName();
      const m = name.match(/^(S[1-6])(?:_v(\d+))?\.(png|jpg|jpeg|webp)$/i);
      if (m) {
        const sceneNo = Number(m[1].slice(1));
        const version = m[2] ? Number(m[2]) : 1;
        recoverable.push({
          fileId: fileId,
          fileName: name,
          mimeType: file.getMimeType(),
          sceneNo: sceneNo,
          version: version,
          driveUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
        });
      }
    }
  } catch (e) {
    console.error('[Storyboard] Error scanning recoverable files: ' + (e && e.message ? e.message : String(e)));
  }
  return recoverable;
}

// ---------------------------------------------------------------- prompt builders

/** Motion prompt for Google Flow Image-to-Video handoff (starting from the still storyboard image). */
function buildSceneMotionPrompt_(scene, plan) {
  const ps = plan && plan.scenes ? plan.scenes.filter(function (x) { return x.scene_no === (scene.scene_no || 1); })[0] : null;
  const beat = scene.beat || 'DEMO';
  const camera = (RF_CONFIG.FLOW && RF_CONFIG.FLOW.CAMERA && RF_CONFIG.FLOW.CAMERA[beat]) ||
    'handheld medium shot at eye level, slight natural camera motion';
  const action = ps && ps.scene_prompt ? ps.scene_prompt : (scene.flow_prompt || scene.visual);
  return [
    'Google Flow Image-to-Video · Scene ' + scene.scene_no + ' · ' + beat + ' · 8s vertical 9:16 clip, photorealistic',
    'START FRAME: Use the approved 9:16 storyboard image as the starting visual frame.',
    'CAMERA MOTION: ' + camera + '.',
    'ACTION PROGRESSION: ' + normalizeText(action) + '.',
    ps && ps.continuity ? 'CONTINUITY: ' + normalizeText(ps.continuity) + '.' : '',
    'LIGHTING & STYLE: Real lived-in Korean apartment, natural daylight. Continuous single take, no cuts, no on-screen text, no logos.',
  ].filter(Boolean).join('\n');
}

/** 9:16 Storyboard image generation prompt for gemini-2.5-flash-image with reference images. */
function buildStoryboardImagePrompt_(scene, product, plan, revisionNote) {
  const facts = parseConfirmedFeatures(product.features);
  const ps = plan && plan.scenes ? plan.scenes.filter(function (x) { return x.scene_no === (scene.scene_no || 1); })[0] : null;
  const pv = plan && plan.productVisual ? plan.productVisual : null;
  const lines = [
    'Generate a high-quality photorealistic vertical 9:16 photograph for scene S' + scene.scene_no + ' of an Instagram Reel storyboard.',
    'PRODUCT: ' + normalizeText(product.name) + '.',
    'VERIFIED FACTS: ' + facts.join('; ') + '.',
    'The product MUST strictly match the attached verified product reference image(s) in shape, color, proportions, and details.',
  ];
  if (pv) {
    lines.push('PRODUCT LOOK: ' + pv.summary);
    if (pv.mustMatch && pv.mustMatch.length) lines.push('MUST MATCH: ' + pv.mustMatch.join('; '));
    if (pv.mustNotShow && pv.mustNotShow.length) lines.push('MUST NOT SHOW: ' + pv.mustNotShow.join('; '));
  }
  lines.push(
    'SCENE DETAILS: ' + (ps && ps.scene_prompt ? ps.scene_prompt : scene.visual),
    'NARRATION: "' + scene.narration + '"',
    'ENVIRONMENT: A real, lived-in small Korean apartment, natural daylight from a window, clean composition, high dynamic range.',
    'RULES: Vertical 9:16 aspect ratio portrait frame. NO on-screen text, NO Korean characters, NO English subtitles, NO watermarks, NO brand logos.'
  );
  if (revisionNote) {
    lines.push(
      '',
      'CRITICAL REVISION REQUEST: Please adjust this image to address this feedback: ' + normalizeText(revisionNote)
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- image list & invalidation

/** Storyboard images list for the reel: [{ key, scene, beat, duration_sec, narration, visual, status, current, versions, motionPrompt }]. */
function storyboardImageList_(row, product, plan, recoverableFiles) {
  const store = parseImageStore_(row);
  const hash = cellText_(row['승인 대본 해시']);
  const scenes = approvedScenes_(row);
  return scenes.map(function (s) {
    const key = imageKeyOf_(s.scene_no);
    const entry = store.images[key] || { scene: s.scene_no, current: 0, versions: [] };
    const st = imageState_(entry, hash);
    const cur = st.current;
    const motionPrompt = (cur && cur.motionPrompt) || buildSceneMotionPrompt_(s, plan);
    const rec = (recoverableFiles || []).filter(function (r) { return r.sceneNo === s.scene_no; });
    return {
      key: key,
      scene: s.scene_no,
      beat: s.beat,
      duration_sec: s.duration_sec,
      narration: s.narration,
      visual: s.visual,
      status: st.status,
      recoverable: rec,
      current: cur ? {
        v: cur.v,
        fileId: cur.fileId,
        name: cur.name,
        mime: cur.mime,
        prompt: cur.prompt,
        motionPrompt: cur.motionPrompt || motionPrompt,
        status: cur.status,
        generatedAt: cur.generatedAt,
        reviewedBy: cur.reviewedBy,
        reviewedAt: cur.reviewedAt,
        note: cur.note,
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + cur.fileId,
        url: driveViewUrl(cur.fileId),
        previewUrl: drivePreviewUrl(cur.fileId),
      } : null,
      versions: (entry.versions || []).map(function (v) {
        return {
          v: v.v,
          status: v.status,
          name: v.name,
          fileId: v.fileId,
          generatedAt: v.generatedAt,
          reviewedBy: v.reviewedBy,
          reviewedAt: v.reviewedAt,
          note: v.note,
          url: driveViewUrl(v.fileId),
        };
      }),
      motionPrompt: motionPrompt,
      imagePrompt: buildStoryboardImagePrompt_(s, product, plan),
    };
  });
}

/**
 * Invalidates dependent video approvals whenever an approved storyboard image is changed or rejected.
 * 1) Any approved video clip for that scene is marked SUPERSEDED (voiding clip approval).
 * 2) Any overall VIDEO_APPROVED / READY_TO_PUBLISH status is rolled back to VIDEO_IN_PRODUCTION.
 */
function invalidateDependentVideoApprovals_(ss, data, found, sceneKey, reason, user) {
  let clipInvalidated = false;
  let videoApprovalInvalidated = false;
  const id = normalizeText(found.row['릴스ID']);

  // 1. Invalidate scene clip if it was approved
  const clipStore = parseClipStore_(found.row);
  if (clipStore && clipStore.clips) {
    Object.keys(clipStore.clips).forEach(function (k) {
      if (k === sceneKey || k.indexOf(sceneKey) === 0) {
        const entry = clipStore.clips[k];
        const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
        if (cur && cur.status === 'APPROVED') {
          cur.status = 'SUPERSEDED';
          cur.approvedHash = '';
          cur.note = (cur.note ? cur.note + ' · ' : '') + '스토리보드 이미지 변경으로 클립 승인 무효 (' + reason + ')';
          clipInvalidated = true;
        }
      }
    });
    if (clipInvalidated) {
      updateRecord_(data.reelsSheet, found.row._row, { '장면 클립(JSON)': JSON.stringify(clipStore) });
      found.row['장면 클립(JSON)'] = JSON.stringify(clipStore);
      appendAudit_(ss, [{
        '일시': new Date(),
        '릴스ID': id,
        '상품ID': found.row['상품ID'],
        '작업': 'CLIP_APPROVAL_INVALIDATED',
        '이전 상태': reelStatus(found.row),
        '새 상태': reelStatus(found.row),
        '대본 버전': scriptVersionOf(found.row),
        '영상 버전': videoVersionOf(found.row),
        '작업자': user,
        '메모': sceneKey + ' 스토리보드 이미지 변경으로 클립 승인 취소 (' + reason + ')',
      }]);
    }
  }

  // 2. Invalidate overall video approval if VIDEO_APPROVED or READY_TO_PUBLISH
  const st = reelStatus(found.row);
  if (st === 'VIDEO_APPROVED' || st === 'READY_TO_PUBLISH') {
    const revertTo = 'VIDEO_IN_PRODUCTION';
    const updates = {
      '상태': revertTo,
      '제작 상태': RF_STATUS_LABELS[revertTo],
      '영상 검토자': '',
      '영상 검토일시': '',
      '영상 검토 메모': (cellText_(found.row['영상 검토 메모']) ? cellText_(found.row['영상 검토 메모']) + ' · ' : '') +
        sceneKey + ' 스토리보드 이미지 변경으로 영상 승인 취소 (' + reason + ')',
      '오류': sceneKey + ' 스토리보드 이미지가 변경되었습니다. 새 비디오 클립을 제작·검토하세요.',
    };
    updateRecord_(data.reelsSheet, found.row._row, updates);
    Object.assign(found.row, updates);
    appendAudit_(ss, [{
      '일시': new Date(),
      '릴스ID': id,
      '상품ID': found.row['상품ID'],
      '작업': 'VIDEO_APPROVAL_INVALIDATED',
      '이전 상태': st,
      '새 상태': revertTo,
      '대본 버전': scriptVersionOf(found.row),
      '영상 버전': videoVersionOf(found.row),
      '작업자': user,
      '메모': sceneKey + ' 스토리보드 이미지 변경으로 영상 승인 취소 (' + reason + ')',
    }]);
    videoApprovalInvalidated = true;
  }

  return { clipInvalidated: clipInvalidated, videoApprovalInvalidated: videoApprovalInvalidated };
}

// ---------------------------------------------------------------- image generation core

function generateSceneImageCore_(ss, data, found, scene, refs, plan, revisionNote, user) {
  const reelId = normalizeText(found.row['릴스ID']);
  const key = imageKeyOf_(scene.scene_no);
  const prompt = buildStoryboardImagePrompt_(scene, found.product, plan, revisionNote);
  const motionPrompt = buildSceneMotionPrompt_(scene, plan);

  console.info('[Storyboard] Calling Gemini Image API for scene S' + scene.scene_no + ' with ' + (refs || []).length + ' reference image(s)...');
  // Call gemini-2.5-flash-image with actual reference image bytes
  const res = callGeminiImage_(prompt, refs, { aspectRatio: '9:16' });
  console.info('[Storyboard] Gemini returned image bytes for scene S' + scene.scene_no + ' from model ' + res.model);

  // Save generated image to Drive
  const folder = storyboardFolder_(found.product, reelId);
  const store = parseImageStore_(found.row);
  const entry = store.images[key] || (store.images[key] = { scene: scene.scene_no, current: 0, versions: [] });
  const prev = entry.versions.filter(function (v) { return v.v === entry.current; })[0] || null;
  const prevWasApproved = prev && prev.status === 'APPROVED';

  const nextV = (entry.versions.reduce(function (max, v) { return Math.max(max, v.v); }, 0) || 0) + 1;
  const ext = res.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const fileName = key + '_v' + nextV + '.' + ext;
  const bytes = Utilities.base64Decode(res.data);
  const blob = Utilities.newBlob(bytes, res.mimeType, fileName);
  const file = folder.createFile(blob);
  console.info('[Storyboard] Saved image to Drive: fileId=' + file.getId() + ', fileName=' + fileName);

  if (prev && prev.status !== 'REJECTED') prev.status = 'SUPERSEDED';

  entry.versions.push({
    v: nextV,
    fileId: file.getId(),
    name: fileName,
    mime: res.mimeType,
    prompt: prompt,
    motionPrompt: motionPrompt,
    status: 'PENDING_REVIEW',
    generatedAt: new Date().toISOString(),
    reviewedBy: '',
    reviewedAt: '',
    approvedHash: '',
    note: revisionNote || '',
    model: res.model,
  });
  entry.current = nextV;

  updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
  found.row['장면 이미지(JSON)'] = JSON.stringify(store);
  console.info('[Storyboard] Updated REELS sheet for scene S' + scene.scene_no + ' v' + nextV);

  appendAudit_(ss, [{
    '일시': new Date(),
    '릴스ID': reelId,
    '상품ID': found.row['상품ID'],
    '작업': 'STORYBOARD_IMAGE_GENERATED',
    '이전 상태': reelStatus(found.row),
    '새 상태': reelStatus(found.row),
    '대본 버전': scriptVersionOf(found.row),
    '영상 버전': videoVersionOf(found.row),
    '작업자': user + ' + Gemini (' + res.model + ')',
    '메모': key + ' v' + nextV + ' (Drive ID: ' + file.getId() + ', 9:16)' + (revisionNote ? ' · 수정 반영: ' + revisionNote : ''),
  }]);
  console.info('[Storyboard] Appended AUDIT entry for scene S' + scene.scene_no + ' v' + nextV);

  if (prevWasApproved) {
    invalidateDependentVideoApprovals_(ss, data, found, key, '새 이미지 v' + nextV + ' 생성', user);
  }

  return { key: key, version: nextV, fileId: file.getId() };
}

// ---------------------------------------------------------------- billing & cost estimate

/**
 * Returns the configured per-image cost estimate in USD, or null if unconfigured.
 * Checked from Script Properties (GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE / RF_IMAGE_ESTIMATED_USD_PER_IMAGE)
 * or RF_CONFIG.STORYBOARD.ESTIMATED_USD_PER_IMAGE.
 */
function getStoryboardEstimatedCostPerImage_() {
  const prop = PropertiesService.getScriptProperties().getProperty('GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE') ||
    PropertiesService.getScriptProperties().getProperty('RF_IMAGE_ESTIMATED_USD_PER_IMAGE');
  if (prop != null && prop !== '') {
    const num = Number(prop);
    if (isFinite(num) && num > 0) return num;
  }
  const cfg = RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.ESTIMATED_USD_PER_IMAGE;
  if (cfg != null && cfg !== '') {
    const num = Number(cfg);
    if (isFinite(num) && num > 0) return num;
  }
  return null;
}

/**
 * Builds a transparent billing summary for generating N storyboard images.
 * Does NOT invent or hardcode a price if no verified estimate is configured.
 */
function storyboardBillingSummary_(imageCount) {
  const count = Math.max(1, Number(imageCount) || 1);
  const model = getGeminiImageModel();
  const perImageUsd = getStoryboardEstimatedCostPerImage_();
  let estimatedTotalUsd = null;
  let costText = 'Cost estimate unavailable';
  if (perImageUsd != null) {
    const total = count * perImageUsd;
    estimatedTotalUsd = total;
    costText = '~$' + ((total < 0.01 && total > 0) ? total.toFixed(4) : total.toFixed(2)) + ' USD (estimate)';
  }
  const warning = '실제 청구 금액은 다를 수 있으며, 실패하거나 재시도된 API 호출에도 요금이 발생할 수 있습니다 (Actual charges may differ and failed/retried calls may incur charges).';
  return {
    imageCount: count,
    model: model,
    perImageUsd: perImageUsd,
    estimatedTotalUsd: estimatedTotalUsd,
    costText: costText,
    warning: warning,
  };
}

// ---------------------------------------------------------------- dashboard view

function storyboardView_(row, product, data) {
  const status = reelStatus(row);
  const intact = isApprovedScriptIntact(row);
  const plan = validProductionPlan(row);
  const refs = parseReferenceImages(product.referenceImages);
  const approvedStatuses = RF_CONFIG.PRODUCTION.PLAN_STATUSES;
  const visible = approvedStatuses.indexOf(status) !== -1;
  const recoverable = (visible && intact)
    ? findRecoverableStoryboardFiles_(product, normalizeText(row['릴스ID']), parseImageStore_(row))
    : [];
  const list = intact ? storyboardImageList_(row, product, plan, recoverable) : [];
  const approvedCount = list.filter(function (img) { return img.status === 'APPROVED'; }).length;
  const totalCount = list.length;
  let blocker = '';
  if (!visible) blocker = '스토리보드 이미지는 대본 승인 후에만 생성할 수 있습니다.';
  else if (!intact) blocker = '승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.';
  else if (!refs.length) blocker = '검증된 제품 이미지가 없습니다. 제품 사진을 먼저 등록하세요.';

  const billing = storyboardBillingSummary_(totalCount || 5);

  return {
    visible: visible,
    canGenerate: visible && intact && refs.length > 0,
    blocker: blocker,
    referencesCount: refs.length,
    images: list,
    recoverable: recoverable,
    approvedCount: approvedCount,
    totalCount: totalCount,
    allApproved: totalCount > 0 && approvedCount === totalCount,
    flowUrl: flowUrl_(),
    flowNote: (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.FLOW_NOTE) ||
      '생성된 9:16 이미지를 다운로드하여 Google Flow에 업로드하고, 모션 프롬프트를 입력하여 비디오 클립을 생성하세요.',
    model: getGeminiImageModel(),
    billing: billing,
  };
}

// ---------------------------------------------------------------- public APIs

/**
 * Generates 9:16 storyboard images for scenes S1–S5 using gemini-2.5-flash-image and actual reference images.
 * input: { scene?: number (1..5), confirmedBilling: boolean, expectedStatus, expectedScriptVersion }
 */
function apiGenerateStoryboardImages(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) ||
          (input.expectedScriptVersion != null && Number(input.expectedScriptVersion) !== scriptVersionOf(found.row))) {
        throw staleError_(found.row, status);
      }
      if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
        throw new Error('스토리보드 이미지는 대본 승인 후에만 생성할 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.');
      }
      const refs = loadReferenceImages_(found.product);
      const plan = validProductionPlan(found.row);
      const scenes = approvedScenes_(found.row);
      const targetSceneNo = input.scene ? Number(input.scene) : null;
      const targets = targetSceneNo
        ? scenes.filter(function (s) { return s.scene_no === targetSceneNo; })
        : scenes;

      if (!targets.length) throw new Error('생성할 장면이 없습니다.');

      if (input.confirmedBilling !== true && input.confirmed !== true) {
        throw new Error('유료 API 호출(Gemini 이미지 생성) 확인이 필요합니다. 예상 비용과 청구 주의사항을 확인하고 승인하세요 (Billing confirmation required).');
      }

      targets.forEach(function (scene) {
        generateSceneImageCore_(ss, data, found, scene, refs, plan, input.note || '', user);
      });
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Scene-by-scene approval or revision request for a storyboard image.
 * input: { scene: number, version: number, decision: 'APPROVE' | 'REJECT', note?: string, expectedStatus, expectedScriptVersion }
 */
function apiReviewStoryboardImage(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) ||
          (input.expectedScriptVersion != null && Number(input.expectedScriptVersion) !== scriptVersionOf(found.row))) {
        throw staleError_(found.row, status);
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다.');
      }
      const sceneNo = Number(input.scene);
      const key = imageKeyOf_(sceneNo);
      const store = parseImageStore_(found.row);
      const entry = store.images[key];
      const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
      if (!cur || Number(input.version) !== cur.v) {
        throw new Error('이 장면에는 그사이 새 이미지가 생성되었습니다. 최신 버전을 검토하세요.');
      }
      const decision = input.decision === 'APPROVE' ? 'APPROVE' : input.decision === 'REJECT' ? 'REJECT' : '';
      if (!decision) throw new Error('승인 또는 수정 요청을 선택하세요.');
      const note = normalizeText(input.note);
      if (decision === 'REJECT' && !note) throw new Error('수정 요청 이유(무엇을 고칠지)를 적어 주세요.');

      const prevWasApproved = cur.status === 'APPROVED';
      const hash = cellText_(found.row['승인 대본 해시']);

      if (decision === 'APPROVE') {
        cur.status = 'APPROVED';
        cur.approvedHash = hash;
      } else {
        cur.status = 'REJECTED';
        cur.approvedHash = '';
      }
      cur.reviewedBy = user;
      cur.reviewedAt = new Date().toISOString();
      cur.note = note;

      updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
      found.row['장면 이미지(JSON)'] = JSON.stringify(store);

      appendAudit_(ss, [{
        '일시': new Date(),
        '릴스ID': id,
        '상품ID': found.row['상품ID'],
        '작업': decision === 'APPROVE' ? 'STORYBOARD_IMAGE_APPROVED' : 'STORYBOARD_IMAGE_REJECTED',
        '이전 상태': status,
        '새 상태': status,
        '대본 버전': scriptVersionOf(found.row),
        '영상 버전': videoVersionOf(found.row),
        '작업자': user,
        '메모': key + ' v' + cur.v + (decision === 'APPROVE' ? ' 승인' : ' 수정 요청: ' + note),
      }]);

      if (decision === 'REJECT' && prevWasApproved) {
        invalidateDependentVideoApprovals_(ss, data, found, key, '이미지 승인 취소·수정 요청: ' + note, user);
      }
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Regenerates one scene's 9:16 storyboard image using Gemini 2.5 Flash Image with feedback.
 * input: { scene: number, note?: string, expectedStatus, expectedScriptVersion }
 */
function apiRegenerateStoryboardImage(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) ||
          (input.expectedScriptVersion != null && Number(input.expectedScriptVersion) !== scriptVersionOf(found.row))) {
        throw staleError_(found.row, status);
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다.');
      }
      const sceneNo = Number(input.scene);
      const scenes = approvedScenes_(found.row);
      const scene = scenes.filter(function (s) { return s.scene_no === sceneNo; })[0];
      if (!scene) throw new Error('장면 ' + sceneNo + '을(를) 찾을 수 없습니다.');

      const refs = loadReferenceImages_(found.product);
      const plan = validProductionPlan(found.row);
      const store = parseImageStore_(found.row);
      const entry = store.images[imageKeyOf_(sceneNo)];
      const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
      const revisionNote = normalizeText(input.note) || (cur ? cur.note : '');

      if (input.confirmedBilling !== true && input.confirmed !== true) {
        throw new Error('유료 API 호출(Gemini 이미지 재생성) 확인이 필요합니다. 예상 비용과 청구 주의사항을 확인하고 승인하세요 (Billing confirmation required).');
      }

      generateSceneImageCore_(ss, data, found, scene, refs, plan, revisionNote, user);
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Recovers an already-generated 9:16 storyboard image file from Drive without calling Gemini API (0 tokens, free).
 * input: { scene: number, fileId: string }
 */
function apiRecoverStoryboardImage(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    const sceneNo = Number(input.scene);
    if (!sceneNo || sceneNo < 1 || sceneNo > 6) throw new Error('유효한 장면 번호가 필요합니다.');
    if (!input.fileId) throw new Error('복구할 Drive 파일 ID가 필요합니다.');

    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
        throw new Error('스토리보드 이미지는 대본 승인 후에만 복구할 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.');
      }

      let file;
      try {
        file = DriveApp.getFileById(input.fileId);
      } catch (e) {
        throw new Error('Drive 파일(' + input.fileId + ')을 열 수 없습니다: ' + e.message);
      }
      const mime = file.getMimeType();
      if (!/^image\/(png|jpeg|webp)$/.test(mime)) {
        throw new Error('선택한 파일은 이미지 파일이 아닙니다 (' + mime + ').');
      }

      const plan = validProductionPlan(found.row);
      const scenes = approvedScenes_(found.row);
      const scene = scenes.filter(function (s) { return s.scene_no === sceneNo; })[0];
      if (!scene) throw new Error('장면 S' + sceneNo + '를 대본에서 찾을 수 없습니다.');

      const key = imageKeyOf_(sceneNo);
      const store = parseImageStore_(found.row);
      const entry = store.images[key] || (store.images[key] = { scene: sceneNo, current: 0, versions: [] });

      // If already registered, ensure current points to it
      const already = entry.versions.filter(function (v) { return v.fileId === file.getId(); })[0];
      if (already) {
        entry.current = already.v;
        updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
        found.row['장면 이미지(JSON)'] = JSON.stringify(store);
        return;
      }

      const prev = entry.versions.filter(function (v) { return v.v === entry.current; })[0] || null;
      const prevWasApproved = prev && prev.status === 'APPROVED';
      const nextV = (entry.versions.reduce(function (max, v) { return Math.max(max, v.v); }, 0) || 0) + 1;
      const motionPrompt = buildSceneMotionPrompt_(scene, plan);

      if (prev && prev.status !== 'REJECTED') prev.status = 'SUPERSEDED';

      entry.versions.push({
        v: nextV,
        fileId: file.getId(),
        name: file.getName(),
        mime: mime,
        prompt: '(Drive에서 복구된 이미지)',
        motionPrompt: motionPrompt,
        status: 'PENDING_REVIEW',
        generatedAt: new Date().toISOString(),
        reviewedBy: '',
        reviewedAt: '',
        approvedHash: '',
        note: 'Drive 기존 이미지 복구 (' + file.getName() + ')',
        model: 'recovered-from-drive',
      });
      entry.current = nextV;

      updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
      found.row['장면 이미지(JSON)'] = JSON.stringify(store);

      appendAudit_(ss, [{
        '일시': new Date(),
        '릴스ID': id,
        '상품ID': found.row['상품ID'],
        '작업': 'STORYBOARD_IMAGE_RECOVERED',
        '이전 상태': reelStatus(found.row),
        '새 상태': reelStatus(found.row),
        '대본 버전': scriptVersionOf(found.row),
        '영상 버전': videoVersionOf(found.row),
        '작업자': user,
        '메모': key + ' v' + nextV + ' (Drive ID: ' + file.getId() + ' 복구 · Gemini API 호출 없음)',
      }]);

      if (prevWasApproved) {
        invalidateDependentVideoApprovals_(ss, data, found, key, 'Drive 이미지 v' + nextV + ' 복구', user);
      }
    });

    return { detail: reelDetail_(ss, id) };
  });
}
