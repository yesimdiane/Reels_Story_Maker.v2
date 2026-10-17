// Paid animation generation, behind every gate.
//
//   estimate  (free, no network)  → what it would cost, what blocks it
//   authorize (free)              → the operator confirms the exact estimate; a short-lived authorization is stored
//   run       (BILLABLE in live)  → spends exactly the authorized scenes, once each
//   review                        → every generated clip waits for human approval (checksum-bound)
//
// Rules enforced here (tests cover each one):
//   * approved + unchanged script AND approved + unchanged storyboard are required
//   * a start image must be an approved reference (placeholders only work in mock mode)
//   * live mode needs a known price estimate and must fit the per-reel spending limit
//   * an authorization is bound to script/storyboard hashes, provider mode, model, scenes and expires
//   * identical inputs reuse the cached clip (no second charge)
//   * a failed or uncertain paid job is NEVER retried automatically; a new authorization is required
//   * "resume" only polls/downloads an already-submitted job (free)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, uid, nowIso, sha256File, writeFileAtomic } = require('./util');
const { isScriptApproved, isStoryboardApproved, storyboardApprovalStatus, scriptFingerprint } = require('./episode');
const { sceneSetHash } = require('./approvals');
const { modelById, clipSecFor, estimateRun, jobKey, spentUsd, limitFor, round } = require('./budget');
const { ProviderError } = require('./providers');
const { probe } = require('../../renderer/lib/ffmpeg');
const { browserMp4 } = require('./browserclip');

const AUTH_TTL_MS = 30 * 60 * 1000;
const ACTIVE = new Set(['preparing', 'submitting', 'processing']);
const RECOVERABLE = new Set(['processing', 'polling_interrupted', 'download_failed']);

// The animation is SILENT: speech and talking mouths are added later (Voice Studio, Lip Sync Studio), never generated here.
const SILENT_NEGATIVE = ', speech, talking, mouth moving as if speaking, lip movement, dialogue, singing, subtitles, captions, text overlay';

function createGenerationService({ store, provider, cfg, now = () => Date.now(), log = () => {}, composePrompt = (ep, sid, text) => text, charRefs = null, audioGate = null, extraBlockers = null, brollSource = null }) {
  const running = new Set();
  const lib = () => store.characters.load();

  /** The scene as the video model sees it: a per-scene clip-length choice (Animation Studio) replaces the planned duration for model selection only. */
  function clipTarget(ep, scene) {
    const o = ep && ep.animation && ep.animation[scene.id];
    return o && Number(o.durationSec) > 0 ? Object.assign({}, scene, { durationSec: Number(o.durationSec) }) : scene;
  }

  // Embed approved dialogue timing as motion guidance for 480p drafts.
  // This is prompt guidance, NOT an audio track: TTS remains the source of truth.
  function seedanceTimedPrompt(ep, sceneId, model, basePrompt) {
    const mode = ep.animation && ep.animation[sceneId] && ep.animation[sceneId].seedanceMode;
    if (!model || model.id !== 'seedance-2.5' || mode !== 'draft') return basePrompt;
    const lines = (ep.lines || []).filter(l => l.sceneId === sceneId && (l.en || l.ko));
    if (!lines.length) return basePrompt;
    const scene = (ep.scenes || []).find(sc => sc.id === sceneId);
    const total = Number(scene && scene.durationSec) || 5;
    const weights = lines.map(l => Math.max(1, String(l.en || l.ko).trim().split(/\\s+/).length));
    const sum = weights.reduce((a, b) => a + b, 0);
    let cursor = 0;
    const timed = lines.map((l, i) => {
      const end = i === lines.length - 1 ? total : Math.min(total, cursor + total * weights[i] / sum);
      const row = `[${cursor.toFixed(1)}s–${end.toFixed(1)}s] ${l.speaker || 'Narrator'}: "${String(l.en || l.ko).replace(/"/g, "'")}"`;
      cursor = end;
      return row;
    });
    return [basePrompt, 'Dialogue timing reference for character gestures and reactions (no generated audio, captions or text):', ...timed, 'Use the dialogue beats to time reactions; keep output silent. Actual approved voice audio is mixed separately.'].join('\\n');
  }

  function resolutionExtra(ep, sceneId, model) {
    const o = ep.animation && ep.animation[sceneId];
    const extra = o && o.resolution && (model.resolutions || []).includes(o.resolution) ? { [model.resolutionField || 'resolution']: o.resolution } : {};
    if (model.id !== 'seedance-2.5') return extra;
    const mode = o && o.seedanceMode || 'standard';
    if (mode === 'draft') return { resolution: '480p', draft: true };
    if (mode === 'finalize') {
      const drafts = (ep.generation && ep.generation.jobs || []).filter(j => j.modelId === model.id && j.sceneId === sceneId && j.requestId && j.seedanceMode === 'draft' && j.status === 'completed' && j.updatedAt && Date.now() - Date.parse(j.updatedAt) <= 7 * 86400000 && Date.parse(j.updatedAt) <= Date.now());
      const requestedId = o && o.draftRequestId;
      const prior = requestedId ? drafts.find(j => j.requestId === requestedId) : drafts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
      if (!prior) throw new StudioError('DRAFT_NOT_READY', '7일 이내 완료된 동일 장면의 Seedance 초안이 필요합니다.', { status: 409 });
      return { resolution: '1080p', draft: false, draft_request_id: prior.requestId };
    }
    return { draft: false, ...extra };
  }

  function sceneOf(ep, id) {
    const s = (ep.scenes || []).find((x) => x.id === id);
    if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + id, { status: 404 });
    return s;
  }

  /** The image used as the image-to-video start frame, or { error }. */
  function startImage(ep, scene) {
    const si = scene.startImage;
    if (si && si.type === 'upload') {
      const file = store.episodes.file(ep.id, 'startframes', si.file);
      if (!fs.existsSync(file)) return { error: '시작 이미지 파일이 없습니다.' };
      return { file, sha256: si.sha256, approved: !!si.approved, placeholder: false, generated: !!si.generated, label: si.generated ? 'AI 생성 시작 프레임' : '업로드한 시작 프레임' };
    }
    const l = lib();
    let charId = si && si.characterId;
    let ref = null;
    if (si && si.refId) {
      const c = l.characters.find((x) => x.id === charId);
      ref = c && c.references.find((r) => r.id === si.refId);
    }
    if (!ref) {
      for (const cid of scene.characters || []) {
        const c = l.characters.find((x) => x.id === cid);
        const r = c && c.references.find((x) => x.approved);
        if (r) {
          charId = cid;
          ref = r;
          break;
        }
      }
    }
    if (!ref) return { error: `이 장면(${scene.id})에 쓸 승인된 캐릭터 참조 이미지가 없습니다.` };
    return { file: store.characters.refPath(charId, ref), sha256: ref.sha256, approved: !!ref.approved, placeholder: !!ref.placeholder, label: `${charId} · ${ref.label}`, characterId: charId, refId: ref.id };
  }

  function blockers(ep, scenes, model) {
    const out = [];
    const add = (code, message, recovery) => out.push({ code, message, recovery });
    if (!isScriptApproved(ep)) add('SCRIPT_NOT_APPROVED', '대본이 승인되지 않았거나 승인 후 수정되었습니다.', 'Script Studio에서 대본을 다시 확인하고 승인하세요.');
    // storyboard approval is per scene and per field: only a scene whose OWN approved content changed is held back, and the changed field is named
    const sb = storyboardApprovalStatus(ep);
    if (!sb.everApproved) add('STORYBOARD_NOT_APPROVED', '스토리보드가 아직 승인되지 않았습니다.', 'Storyboard에서 프롬프트와 시작 이미지를 확인하고 "스토리보드 승인"을 누르세요.');
    else if (sb.legacy && !sb.approved) add('STORYBOARD_CHANGED', sb.reasons[0], 'Storyboard에서 확인한 뒤 다시 승인하세요.');
    else scenes.forEach((s) => { const st = sb.scenes[s.id]; if (st && !st.approved) add('STORYBOARD_SCENE_CHANGED', st.isNew ? `${s.id}: 승인 이후에 추가된 장면입니다.` : `${s.id}: ${st.changed.map((c) => c.label).join(', ')}이(가) 승인 후 바뀌었습니다.`, 'Storyboard에서 이 장면을 확인한 뒤 다시 승인하세요 (다른 장면의 승인은 유지됩니다).'); });
    if (charRefs && provider.mode === 'live') charRefs.validate(ep, scenes).problems.forEach((p) => add(p.code, p.message, '캐릭터 라이브러리에서 실제 참조 이미지를 올리고 승인하거나 장면의 "캐릭터 참조 이미지"에서 고르세요.'));
    if (audioGate) scenes.forEach((s) => { if (!audioGate(ep, s.id)) add('AUDIO_NOT_APPROVED', `${s.id}: 오디오가 승인되지 않았습니다 (영상은 승인된 오디오 길이에 맞춰 만듭니다).`, 'Storyboard의 "오디오 확인 · 승인"에서 오디오를 만들고 들어본 뒤 승인하세요.'); });
    if (extraBlockers) extraBlockers(ep, scenes, model).forEach((x) => out.push(x));
    scenes.forEach((s) => {
      const p = ep.prompts && ep.prompts[s.id];
      if (!p || !String(p.video || '').trim()) add('NO_PROMPT', `${s.id}: 영상 프롬프트가 없습니다.`, 'Storyboard에서 프롬프트를 만드세요.');
      const img = startImage(ep, s);
      if (img.error) add('NO_START_IMAGE', `${s.id}: ${img.error}`, 'Settings → 캐릭터 라이브러리에서 참조 이미지를 올리고 승인하세요.');
      else {
        const ref = img.refId ? (lib().characters.find((x) => x.id === img.characterId) || { references: [] }).references.find((r) => r.id === img.refId) : null;
        if (ref && ref.isSheet !== false) add('SHEET_AS_START_FRAME', `${s.id}: 캐릭터 시트(여러 그림이 있는 이미지)를 그대로 시작 프레임으로 쓸 수 없습니다. 결과 영상에 시트가 그대로 재현될 수 있습니다.`, '장면 구도의 시작 프레임을 올려 승인하거나, 단일 일러스트라면 설정 → 캐릭터 라이브러리에서 "단일 그림"으로 표시하세요.');
        if (!img.approved) add('START_IMAGE_NOT_APPROVED', `${s.id}: 시작 이미지가 승인되지 않았습니다.`, '캐릭터 라이브러리에서 이미지를 승인하세요.');
        if (img.placeholder && provider.mode === 'live') add('PLACEHOLDER_IMAGE', `${s.id}: 데모용 임시 이미지는 실제(유료) 생성에 쓸 수 없습니다.`, '실제 캐릭터 참조 이미지를 올리고 승인하세요.');
      }
    });
    if (provider.mode === 'live' && !['verified', 'user-entered'].includes(model.verification)) add('MODEL_UNVERIFIED', '모델 엔드포인트가 확인되지 않았습니다.', 'MuAPI 플레이그라운드에서 엔드포인트와 요청 파라미터를 확인한 뒤 Settings → Muapi 연결에서 "플레이그라운드에서 확인함"을 누르세요.');
    return out;
  }

  /** A real (live) job finished on this endpoint: that is the only thing that proves it works. */
  function markVerified(model) {
    if (!model || provider.mode !== 'live' || model.verification === 'verified') return;
    const cur = store.settings.get();
    store.settings.save({ modelVerification: Object.assign({}, cur.modelVerification || {}, { [model.id]: { level: 'verified', at: new Date().toISOString() } }) });
  }

  function cachedFor(ep, model) {
    return (sceneOrId) => {
      const scene = typeof sceneOrId === 'string' ? (ep.scenes || []).find((x) => x.id === sceneOrId) : sceneOrId;
      if (!scene) return false;
      const k = keyFor(ep, scene, model);
      return !!(k && fs.existsSync(store.cachePath('clips', k + '.mp4')));
    };
  }

  function videoPromptWithOutfit(ep, scene, prompt) {
    const locks = ep.outfitLock || {};
    const directives = (scene.characters || []).filter((id) => locks[id]).map((id) => 'OUTFIT CONTINUITY LOCK '+id+': same exact approved outfit as shown in the start frame; preserve colours, clothing silhouette, sleeves, accessories, no wardrobe changes. '+String(locks[id].description || '').slice(0,400));
    return [prompt, ...directives].filter(Boolean).join('\n');
  }

  function keyFor(ep, scene, model) {
    const p = ep.prompts && ep.prompts[scene.id];
    const img = startImage(ep, scene);
    if (!p || img.error) return '';
    const variant = model.id === 'seedance-2.5' ? JSON.stringify(ep.animation && ep.animation[scene.id] && { mode: ep.animation[scene.id].seedanceMode, draftId: ep.animation[scene.id].draftRequestId, resolution: ep.animation[scene.id].resolution }) : '';
    return jobKey({ model, prompt: videoPromptWithOutfit(ep, scene, composePrompt(ep, scene.id, p.video)) + variant, negative: p.negative, clipSec: clipSecFor(model, clipTarget(ep, scene).durationSec), aspectRatio: '9:16', imageSha256: img.sha256 });
  }

  function pickScenes(ep, sceneIds) {
    const ids = sceneIds && sceneIds.length ? sceneIds : (ep.scenes || []).map((s) => s.id);
    if (new Set(ids).size !== ids.length) throw new StudioError('DUPLICATE_SCENES', '같은 장면이 두 번 선택되었습니다.');
    return ids.map((id) => sceneOf(ep, id));
  }

  /**
   * Free, local check of the chosen model against what this episode needs (aspect ratio, clip length, image-to-video, endpoint set).
   * It cannot prove the remote endpoint works: 'verification' says how far the registry entry has been confirmed. In LIVE mode an
   * incompatibility blocks the paid call; in mock mode it is shown as information.
   */
  function compatibility(model, scenes) {
    const items = [];
    const add = (code, ok, message) => items.push({ code, ok, message });
    add('ENDPOINT', !!model.endpoint, model.endpoint ? `엔드포인트: ${model.endpoint}` : '이 모델에는 엔드포인트가 설정되어 있지 않습니다.');
    add('ASPECT', !model.aspectRatios || model.aspectRatios.includes('9:16'), !model.aspectRatios || model.aspectRatios.includes('9:16') ? '세로 9:16 지원' : `이 모델은 9:16을 지원하지 않습니다 (지원: ${model.aspectRatios.join(', ')})`);
    const maxClip = (model.durations && model.durations.length) ? Math.max(...model.durations) : null;
    const bad = maxClip ? scenes.filter((s) => Number(s.durationSec) > maxClip + 1e-6) : [];
    add('DURATION', bad.length === 0, bad.length ? `모델의 최대 클립 길이(${maxClip}초)보다 긴 장면: ${bad.map((s) => s.id + ' ' + s.durationSec + '초').join(', ')} — 장면을 나누거나 줄이세요` : '클립 길이 지원');
    add('MODE', !model.mode || model.mode === 'image-to-video', !model.mode || model.mode === 'image-to-video' ? '이미지→영상 방식 (시작 이미지 사용)' : `이 앱은 이미지→영상만 사용합니다 (모델 방식: ${model.mode})`);
    const verified = model.verification === 'verified';
    return { items, ok: items.every((i) => i.ok), verification: model.verification || 'unknown', verified, note: verified ? '실제 호출로 확인된 모델입니다.' : model.verification === 'user-entered' ? 'Settings에 직접 등록한 MuAPI 엔드포인트를 사용합니다. 실제 동작은 검증되지 않았으므로 플레이그라운드에서 경로와 파라미터를 확인하세요. 생성은 별도 비용 승인 후에만 실행됩니다.' : '공식 문서의 예시 기준 항목입니다. 첫 실제 실행 전에 Muapi 플레이그라운드에서 엔드포인트와 파라미터를 확인하세요 (이 앱은 실제 호출 없이 검증할 수 없습니다).' };
  }

  /** Free. Never touches the network. */
  function estimate(epId, { sceneIds, modelId } = {}) {
    const ep = store.episodes.get(epId);
    const settings = store.settings.get();
    const model = modelById(store.models(), modelId || settings.defaultModelId);
    const scenes = pickScenes(ep, sceneIds);
    const est = estimateRun({ ep, scenes: scenes.map((x) => ({ ...clipTarget(ep, x), id: x.id })), model, settings, cfg, cached: cachedFor(ep, model) });
    const b = blockers(ep, scenes, model);
    if (provider.mode === 'live' && est.unknown) b.push({ code: 'ESTIMATE_UNKNOWN', message: '선택한 해상도와 길이의 예상 비용이 없습니다.', recovery: 'Muapi 플레이그라운드의 모델 페이지에 표시된 가격을 Settings → 비용에 입력하세요.' });
    const compat = compatibility(model, scenes.map((x) => clipTarget(ep, x)));
    if (provider.mode === 'live' && !compat.ok) compat.items.filter((i) => !i.ok).forEach((i) => b.push({ code: 'MODEL_INCOMPATIBLE', message: i.message, recovery: '다른 모델을 고르거나 장면 길이를 조정하세요. 유료 호출은 시작하지 않았습니다.' }));
    if (est.withinLimit === false) b.push({ code: 'OVER_LIMIT', message: `예상 비용 $${est.totalUsd}이(가) 릴스 한도 남은 금액 $${est.remainingUsd}을(를) 넘습니다.`, recovery: 'Settings에서 릴스당 한도를 올리거나 장면 수를 줄이세요.' });
    return { mode: provider.mode, provider: provider.name, model: { id: model.id, label: model.label, verification: model.verification }, compat, scenes: scenes.map((s) => s.id), ...est, blockers: b, canAuthorize: b.length === 0 };
  }

  /** Free. The operator must pass the exact estimate they saw. */
  async function authorize(epId, { sceneIds, modelId, confirmUsd, confirmUnknown = false, by = 'operator' } = {}) {
    const est = estimate(epId, { sceneIds, modelId });
    if (est.blockers.length) throw new StudioError('BLOCKED', est.blockers[0].message, { recovery: est.blockers[0].recovery, details: est.blockers, status: 409 });
    if (est.totalUsd == null) {
      if (!confirmUnknown) throw new StudioError('CONFIRM_REQUIRED', '비용 추정치가 없습니다. 목업 모드에서만 "추정치 없음"을 확인하고 진행할 수 있습니다.', { recovery: '목업 모드이거나 가격 추정치를 입력하세요.' });
      if (provider.mode === 'live') throw new StudioError('ESTIMATE_UNKNOWN', '실제 생성에는 가격 추정치가 필요합니다.');
    } else if (confirmUsd == null || Math.abs(Number(confirmUsd) - est.totalUsd) > 1e-6) {
      throw new StudioError('CONFIRM_MISMATCH', `확인한 금액($${confirmUsd})이 현재 예상 비용($${est.totalUsd})과 다릅니다. 화면을 새로고침해 다시 확인하세요.`, { status: 409 });
    }
    const a = {
      id: uid('auth'),
      sceneIds: est.scenes.slice(),
      modelId: est.model.id,
      mode: provider.mode,
      estimatedUsd: est.totalUsd,
      seedanceConfig: est.scenes.map(id => [id, store.episodes.get(epId).animation && store.episodes.get(epId).animation[id] || null]),
      scriptHash: scriptFingerprint(store.episodes.get(epId)),
      storyboardHash: sceneSetHash(store.episodes.get(epId), est.scenes),
      createdAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + AUTH_TTL_MS).toISOString(),
      by,
      consumed: [],
    };
    await store.episodes.update(epId, (ep) => {
      ep.generation.authorizations.push(a);
    });
    store.episodes.audit(epId, 'generation.authorized', { authorizationId: a.id, scenes: a.sceneIds, modelId: a.modelId, mode: a.mode, estimatedUsd: a.estimatedUsd, by });
    return a;
  }

  function checkAuthorization(ep, a, sceneId, model) {
    if (!a) throw new StudioError('NO_AUTH', '유효한 생성 승인이 없습니다.', { recovery: '비용을 확인하고 "생성 승인"을 누르세요.', status: 403 });
    if (a.mode !== provider.mode) throw new StudioError('AUTH_MODE', `이 승인은 ${a.mode} 모드용입니다. 현재는 ${provider.mode} 모드입니다.`, { recovery: '다시 승인하세요.', status: 403 });
    if (new Date(a.expiresAt).getTime() < now()) throw new StudioError('AUTH_EXPIRED', '생성 승인이 만료되었습니다 (30분).', { recovery: '다시 승인하세요.', status: 403 });
    if (!a.sceneIds.includes(sceneId)) throw new StudioError('AUTH_SCENE', `${sceneId}는 이 승인에 포함되지 않았습니다.`, { status: 403 });
    if (a.consumed.includes(sceneId)) throw new StudioError('AUTH_USED', `${sceneId}에 대한 승인은 이미 사용되었습니다. 다시 생성하려면 새로 승인하세요.`, { status: 403 });
    if (a.scriptHash !== scriptFingerprint(ep) || a.storyboardHash !== sceneSetHash(ep, a.sceneIds)) throw new StudioError('AUTH_STALE', '승인 후 대본/이 장면들의 스토리보드가 바뀌었습니다.', { recovery: '다시 승인하세요.', status: 403 });
    if (a.seedanceConfig && JSON.stringify(a.seedanceConfig) !== JSON.stringify(a.sceneIds.map(id => [id, ep.animation && ep.animation[id] || null]))) throw new StudioError('AUTH_STALE', '승인 후 Seedance 설정이 변경되었습니다. 다시 승인하세요.', { status: 403 });
    if (a.modelId !== model.id) throw new StudioError('AUTH_MODEL', '승인된 모델과 다릅니다.', { status: 403 });
  }

  function setJob(epId, jobId, patch) {
    return store.episodes.update(epId, (ep) => {
      const j = ep.generation.jobs.find((x) => x.id === jobId);
      if (!j) throw new Error('job not found ' + jobId);
      Object.assign(j, patch, { updatedAt: nowIso() });
    });
  }

  function errInfo(e) {
    const recovery = {
      AUTH: 'renderer/.env의 MUAPI_API_KEY를 확인하세요. 자동 재시도하지 않았습니다.',
      CREDITS: 'Muapi 크레딧을 충전한 뒤 다시 승인하세요.',
      RATE_LIMIT: '잠시 후 다시 승인해서 시도하세요 (자동 재시도 3회 후 중단됨).',
      BAD_REQUEST: '프롬프트/이미지/모델 설정을 확인하세요. 요금은 청구되지 않았을 가능성이 높습니다.',
      SERVER: '요금이 청구되었는지 Muapi History에서 확인한 뒤 다시 승인하세요. 자동 재시도하지 않았습니다.',
      NETWORK: '연결을 확인하세요. 이미 제출된 작업이면 "다시 확인"으로 이어서 받을 수 있습니다.',
      TIMEOUT: '이미 제출된 작업이면 "다시 확인"으로 이어서 받을 수 있습니다 (추가 요금 없음).',
      FAILED: 'Muapi가 작업을 실패 처리했습니다. 환불 여부는 Muapi History에서 확인하세요. 다시 생성하려면 새로 승인해야 합니다.',
      NO_OUTPUT: 'Muapi History에서 요청 상태를 확인하세요.',
    }[e.code] || '오류 내용을 확인하고 다시 승인해서 시도하세요.';
    return { code: e.code || 'ERROR', message: e.message, recovery, uncertain: !!e.uncertain };
  }

  async function validateClip(file) {
    const p = await probe(cfg.ffmpeg.ffprobe, file);
    const v = p.streams.find((s) => s.codec_type === 'video');
    if (!v) throw new StudioError('BAD_CLIP', '영상 스트림이 없는 파일입니다.');
    if (!(p.duration > 0.5)) throw new StudioError('BAD_CLIP', '클립이 너무 짧습니다.');
    const aspect = v.width / v.height;
    const warnings = Math.abs(aspect - 9 / 16) > 0.03 ? [`세로 9:16이 아닙니다 (${v.width}×${v.height}). 렌더 때 중앙 크롭됩니다.`] : [];
    return { durationSec: Math.round(p.duration * 100) / 100, width: v.width, height: v.height, warnings };
  }

  async function addClipVersion(epId, sceneId, tmpFile, meta) {
    const info = await validateClip(tmpFile);
    const browserCopy = tmpFile + '.browser.mp4';
    const browserInfo = await browserMp4(tmpFile, browserCopy, cfg);
    try { return await store.episodes.update(epId, (ep) => {
      const c = (ep.clips[sceneId] = ep.clips[sceneId] || { versions: [], approvedVersion: null });
      const v = c.versions.length + 1;
      const rel = path.join('clips', sceneId, 'v' + v + '.mp4');
      fs.mkdirSync(path.dirname(store.episodes.file(epId, rel)), { recursive: true });
      fs.copyFileSync(tmpFile, store.episodes.file(epId, path.join('clips', sceneId, 'original-v' + v + '.mp4')));
      fs.copyFileSync(browserCopy, store.episodes.file(epId, rel));
      const hash = sha256File(store.episodes.file(epId, rel));
      const size = fs.statSync(store.episodes.file(epId, rel)).size;
      c.versions.push(Object.assign({ v, file: rel, originalFile: path.join('clips', sceneId, 'original-v' + v + '.mp4'), browserCompatibility: browserInfo.compatibility, sha256: hash, size, ...info, status: 'pending_review', createdAt: nowIso() }, meta));
      return v;
    }); } finally { fs.rmSync(browserCopy, { force: true }); }
  }

  async function finishDownload(epId, job, outputs) {
    const tmp = store.episodes.file(epId, 'tmp', job.id + '.mp4');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    try {
      await provider.download(outputs[0], tmp);
    } catch (e) {
      await setJob(epId, job.id, { status: 'download_failed', outputs, error: errInfo(e) });
      throw e;
    }
    try {
      const hash = sha256File(tmp);
      writeFileAtomic(store.cachePath('clips', job.key + '.mp4'), fs.readFileSync(tmp));
      const v = await addClipVersion(epId, job.sceneId, tmp, { jobId: job.id, key: job.key, requestId: job.requestId, mock: provider.mode === 'mock', reused: false, modelId: job.modelId, imageSha256: job.imageSha256, sourceImageLabel: job.sourceImageLabel, promptRev: job.promptRev, clipSec: job.clipSec, aspectRatio: job.aspectRatio, estimatedUsd: job.estimatedUsd, promptHash: job.promptHash });
      await setJob(epId, job.id, { status: 'completed', outputs, clipVersion: v, sha256: hash, error: null });
      return v;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  function applyCost(epId, job, cost) {
    if (!cost) return Promise.resolve();
    return store.episodes.update(epId, (ep) => {
      const sp = ep.spend.find((s) => s.jobId === job.id);
      if (sp && cost.amountUsd != null) sp.actualUsd = cost.amountUsd;
      const j = ep.generation.jobs.find((x) => x.id === job.id);
      if (j) j.cost = cost;
    });
  }

  async function generateScene(epId, authId, sceneId) {
    const gk = epId + ':' + sceneId;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', `${sceneId} 생성이 이미 진행 중입니다.`, { status: 409 });
    running.add(gk);
    let job = null;
    try {
      const ep0 = store.episodes.get(epId);
      const scene = sceneOf(ep0, sceneId);
      const auth = ep0.generation.authorizations.find((a) => a.id === authId);
      const model = modelById(store.models(), auth && auth.modelId);
      checkAuthorization(ep0, auth, sceneId, model);
      { const sbs = storyboardApprovalStatus(ep0); const st = sbs.scenes[sceneId]; if (!isScriptApproved(ep0) || !sbs.everApproved || (st ? !st.approved : !sbs.approved)) throw new StudioError('NOT_APPROVED', '대본과 이 장면의 스토리보드가 승인 상태여야 합니다.', { status: 403 }); }
      if ((ep0.generation.jobs || []).some((j) => j.sceneId === sceneId && !j.brollId && ACTIVE.has(j.status))) throw new StudioError('ALREADY_RUNNING', `${sceneId}에 진행 중인 작업이 있습니다.`, { status: 409 });
      const img = startImage(ep0, scene);
      const prompt = ep0.prompts[sceneId];
      const clipSec = clipSecFor(model, clipTarget(ep0, scene).durationSec);
      const seedanceExtra = resolutionExtra(ep0, sceneId, model); // validate draft provenance BEFORE billable submission
      const key = keyFor(ep0, scene, model);
      const est = estimateRun({ ep: ep0, scenes: [{ ...clipTarget(ep0, scene), id: scene.id }], model, settings: store.settings.get(), cfg, cached: cachedFor(ep0, model) });
      job = { id: uid('job'), sceneId, key, modelId: model.id, seedanceMode: model.id === 'seedance-2.5' ? (ep0.animation && ep0.animation[sceneId] && ep0.animation[sceneId].seedanceMode || 'standard') : undefined, mode: provider.mode, authorizationId: authId, status: 'preparing', estimatedUsd: est.totalUsd, promptHash: require('./util').sha256(prompt.video), imageSha256: img.sha256 || '', sourceImageLabel: img.label || '', promptRev: prompt.rev || 1, clipSec, aspectRatio: '9:16', requestId: '', error: null, createdAt: nowIso(), updatedAt: nowIso() };

      // 1) Cache hit: reuse, no network, no charge.
      const cachedFile = store.cachePath('clips', key + '.mp4');
      if (fs.existsSync(cachedFile)) {
        job.status = 'completed';
        job.reused = true;
        await store.episodes.update(epId, (ep) => {
          ep.generation.jobs.push(job);
          ep.generation.authorizations.find((a) => a.id === authId).consumed.push(sceneId);
        });
        const v = await addClipVersion(epId, sceneId, cachedFile, { jobId: job.id, key, mock: provider.mode === 'mock', reused: true, modelId: model.id, imageSha256: img.sha256 || '', sourceImageLabel: img.label || '', promptRev: prompt.rev || 1, clipSec, aspectRatio: '9:16' });
        await setJob(epId, job.id, { clipVersion: v });
        store.episodes.audit(epId, 'generation.reused', { sceneId, key, clipVersion: v });
        return { sceneId, status: 'reused', clipVersion: v };
      }

      // 2) Budget re-check right before spending.
      if (provider.mode === 'live') {
        if (est.totalUsd == null) throw new StudioError('ESTIMATE_UNKNOWN', '가격 추정치가 없습니다.');
        const ep1 = store.episodes.get(epId);
        const remaining = limitFor(ep1, store.settings.get(), cfg) - spentUsd(ep1);
        if (est.totalUsd > remaining + 1e-9) throw new StudioError('OVER_LIMIT', `릴스 한도를 넘습니다 (남은 금액 $${round(remaining)}).`, { status: 409 });
      }
      await store.episodes.update(epId, (ep) => {
        ep.generation.jobs.push(job);
      });

      // 3) Upload start image (free). Failure here has billed nothing and keeps the authorization usable.
      let imageUrl;
      try {
        imageUrl = (await provider.uploadImage(img.file)).url;
      } catch (e) {
        await setJob(epId, job.id, { status: 'failed', billed: false, error: errInfo(e) });
        throw e;
      }

      // 4) Submit — the first billable step. Persist "submitting" and consume the authorization BEFORE the call.
      await store.episodes.update(epId, (ep) => {
        ep.generation.authorizations.find((a) => a.id === authId).consumed.push(sceneId);
        ep.generation.jobs.find((j) => j.id === job.id).status = 'submitting';
      });
      let sub;
      try {
        sub = await provider.submit({ model, prompt: seedanceTimedPrompt(store.episodes.get(epId), sceneId, model, videoPromptWithOutfit(store.episodes.get(epId), scene, composePrompt(store.episodes.get(epId), sceneId, prompt.video))), imageUrl, aspectRatio: '9:16', duration: clipSec, negativePrompt: prompt.negative && model.supportsNegativePrompt !== false ? prompt.negative + SILENT_NEGATIVE : undefined, extra: seedanceExtra, silent: true });
      } catch (e) {
        const definitelyRefused = ['AUTH', 'BAD_REQUEST', 'CREDITS', 'RATE_LIMIT'].includes(e.code);
        await setJob(epId, job.id, { status: definitelyRefused ? 'failed' : 'uncertain', billed: definitelyRefused ? false : null, error: errInfo(e) });
        store.episodes.audit(epId, 'generation.submit_failed', { sceneId, code: e.code });
        throw e;
      }
      await store.episodes.update(epId, (ep) => {
        const j = ep.generation.jobs.find((x) => x.id === job.id);
        j.status = 'processing';
        j.requestId = sub.requestId;
        ep.spend.push({ at: nowIso(), kind: 'video', jobId: job.id, sceneId, requestId: sub.requestId, estimatedUsd: est.totalUsd, actualUsd: sub.cost && sub.cost.amountUsd != null ? sub.cost.amountUsd : null, mock: provider.mode === 'mock', modelId: model.id });
      });
      store.episodes.audit(epId, 'generation.submitted', { sceneId, requestId: sub.requestId, mode: provider.mode });
      job.requestId = sub.requestId;
      return await poll(epId, job, sceneId);
    } finally {
      running.delete(gk);
    }
  }

  async function poll(epId, job, sceneId) {
    let r;
    try {
      r = await provider.waitForResult(job.requestId);
    } catch (e) {
      const interrupted = ['TIMEOUT', 'NETWORK'].includes(e.code);
      await setJob(epId, job.id, { status: interrupted ? 'polling_interrupted' : 'failed', error: errInfo(e) });
      store.episodes.audit(epId, 'generation.' + (interrupted ? 'interrupted' : 'failed'), { sceneId, requestId: job.requestId, code: e.code });
      throw e;
    }
    await applyCost(epId, job, r.cost);
    const v = await finishDownload(epId, job, r.outputs);
    store.episodes.audit(epId, 'generation.completed', { sceneId, requestId: job.requestId, clipVersion: v });
    markVerified(store.models().find((m) => m.id === job.modelId));
    return { sceneId, status: 'completed', clipVersion: v };
  }

  /**
   * Runs the authorized scenes one after another. Returns { accepted, done } immediately after validation;
   * `done` resolves with per-scene results (errors are captured, never retried).
   */
  async function run(epId, authorizationId) {
    const ep = store.episodes.get(epId);
    const a = ep.generation.authorizations.find((x) => x.id === authorizationId);
    if (!a) throw new StudioError('NO_AUTH', '생성 승인을 찾을 수 없습니다.', { status: 403 });
    const model = modelById(store.models(), a.modelId);
    const todo = a.sceneIds.filter((id) => !a.consumed.includes(id));
    if (!todo.length) throw new StudioError('AUTH_USED', '이 승인은 이미 모두 사용되었습니다.', { status: 403 });
    todo.forEach((id) => checkAuthorization(ep, a, id, model)); // fail fast, before anything starts
    const done = (async () => {
      const results = [];
      for (const id of todo) {
        try {
          results.push(await generateScene(epId, authorizationId, id));
        } catch (e) {
          log('generation error ' + id + ': ' + e.message);
          results.push({ sceneId: id, status: 'error', error: errInfo(e) });
        }
      }
      return results;
    })();
    return { accepted: todo, done };
  }

  /** Free: continue an already-submitted job (poll + download). Never submits again. */
  async function resume(epId, jobId) {
    const ep = store.episodes.get(epId);
    const job = ep.generation.jobs.find((j) => j.id === jobId);
    if (!job) throw new StudioError('NOT_FOUND', '작업을 찾을 수 없습니다.', { status: 404 });
    if (!job.requestId) throw new StudioError('NO_REQUEST_ID', '요청 ID가 없어 이어서 확인할 수 없습니다.', { recovery: 'Muapi History에서 요금 청구 여부를 확인하세요. 필요하면 작업을 닫고 새로 승인해 생성하세요.' });
    if (!RECOVERABLE.has(job.status)) throw new StudioError('NOT_RESUMABLE', `이 작업은 이어서 확인할 수 없는 상태입니다 (${job.status}).`, { status: 409 });
    const gk = epId + ':' + job.sceneId;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', '이미 진행 중입니다.', { status: 409 });
    running.add(gk);
    try {
      if (job.status === 'download_failed' && job.outputs && job.outputs.length) {
        const v = await finishDownload(epId, job, job.outputs);
        return { sceneId: job.sceneId, status: 'completed', clipVersion: v };
      }
      await setJob(epId, job.id, { status: 'processing' });
      return await poll(epId, job, job.sceneId);
    } finally {
      running.delete(gk);
    }
  }

  /** Closes a failed/uncertain job so it stops blocking the scene. Does not delete anything. */
  async function dismissJob(epId, jobId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      const j = ep.generation.jobs.find((x) => x.id === jobId);
      if (!j) throw new StudioError('NOT_FOUND', '작업을 찾을 수 없습니다.', { status: 404 });
      if (j.status === 'completed') throw new StudioError('NOT_RESUMABLE', '완료된 작업입니다.', { status: 409 });
      j.status = 'dismissed';
      j.dismissedBy = by;
    });
    store.episodes.audit(epId, 'generation.dismissed', { jobId, by });
  }

  /** Operator uploads a clip made elsewhere (e.g. Google Flow). It enters the same review/approval path. */
  async function addManualClip(epId, sceneId, buffer, filename) {
    sceneOf(store.episodes.get(epId), sceneId);
    const tmp = store.episodes.file(epId, 'tmp', uid('upload') + '.mp4');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, buffer);
    try {
      const v = await addClipVersion(epId, sceneId, tmp, { manual: true, originalName: require('./util').safeName(filename), mock: false });
      store.episodes.audit(epId, 'clip.uploaded', { sceneId, clipVersion: v });
      return v;
    } catch (e) {
      throw e instanceof StudioError ? e : new StudioError('BAD_CLIP', '영상 파일을 읽을 수 없습니다: ' + e.message);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async function review(epId, sceneId, version, decision, { note = '', by = 'operator' } = {}) {
    await store.episodes.update(epId, (ep) => {
      const c = ep.clips[sceneId];
      const v = c && c.versions.find((x) => x.v === Number(version));
      if (!v) throw new StudioError('NOT_FOUND', '클립 버전을 찾을 수 없습니다.', { status: 404 });
      if (decision === 'approve') {
        const f = store.episodes.file(epId, v.file);
        if (!fs.existsSync(f) || sha256File(f) !== v.sha256) throw new StudioError('CHECKSUM', '클립 파일이 기록된 체크섬과 다릅니다. 승인할 수 없습니다.', { recovery: '클립을 다시 생성하거나 업로드하세요.', status: 409 });
        c.versions.forEach((x) => x.status === 'approved' && (x.status = 'superseded'));
        v.status = 'approved';
        v.approvedBy = by;
        v.approvedAt = nowIso();
        c.approvedVersion = v.v;
      } else if (decision === 'unapprove') {
        if (c.approvedVersion !== v.v) throw new StudioError('NOT_APPROVED', '이 버전은 승인된 상태가 아닙니다.', { status: 409 });
        v.status = 'pending_review';
        delete v.approvedBy; delete v.approvedAt;
        c.approvedVersion = null;
      } else if (decision === 'reject') {
        v.status = 'rejected';
        if (c.approvedVersion === v.v) c.approvedVersion = null;
      } else throw new StudioError('BAD_DECISION', '승인, 승인 취소 또는 거절만 가능합니다.');
      v.note = note;
    });
    store.episodes.audit(epId, 'clip.' + decision, { sceneId, version, by });
  }


  // ------------------------------------------------------------------ B-roll animation (same provider, same job list, same safety rules)
  // An approved B-roll still can be animated into a short clip. Clips are kept apart from the scene clip (ep.brollClips[brollId]) and never mix
  // into ep.clips. Billable generation needs the free estimate and an explicit confirmation of that exact amount, exactly like scene clips.
  const brollOf = (ep, bid) => {
    const b = (ep.broll || []).find((x) => x.id === bid && x.status !== 'removed');
    if (!b) throw new StudioError('NOT_FOUND', 'B-roll을 찾을 수 없습니다: ' + bid, { status: 404 });
    return b;
  };
  function brollPrompt(b, text) {
    const base = String(text || '').trim();
    if (base) return base.slice(0, 2000);
    return `Animate this still image with subtle, natural motion (${b.effect || b.note || 'gentle camera push-in'}). Keep the product's shape, colour and details and the illustration style exactly as in the image. No new objects, no text.`;
  }
  function brollBlockers(ep, b) {
    const out = [];
    if (!isScriptApproved(ep)) out.push({ code: 'SCRIPT_NOT_APPROVED', message: '대본이 승인되지 않았습니다.', recovery: '대본을 승인하세요.' });
    if (b.status !== 'approved') out.push({ code: 'BROLL_NOT_APPROVED', message: `${b.id}: B-roll 이미지가 승인되지 않았습니다.`, recovery: '스토리보드의 컷 · B-roll에서 이미지를 승인하세요.' });
    const src = brollSource ? brollSource(ep, b) : { file: '', problem: 'B-roll 이미지를 찾을 수 없습니다.' };
    if (!src.file || src.problem || !fs.existsSync(src.file)) out.push({ code: 'BROLL_IMAGE_MISSING', message: `${b.id}: 사용할 수 있는 B-roll 이미지가 없습니다${src.problem ? ' — ' + src.problem : ''}.`, recovery: '스토리보드에서 이미지를 다시 지정하세요.' });
    return { out, src };
  }
  function estimateBroll(epId, bid, { modelId } = {}) {
    const ep = store.episodes.get(epId);
    const b = brollOf(ep, bid);
    const settings = store.settings.get();
    const model = modelById(store.models(), modelId || settings.brollModelId || settings.defaultModelId);
    const { out } = brollBlockers(ep, b);
    if (provider.mode === 'live' && !['verified', 'user-entered'].includes(model.verification)) out.push({ code: 'MODEL_UNVERIFIED', message: 'B-roll 모델 엔드포인트가 확인되지 않았습니다.', recovery: '설정에서 MuAPI 모델의 입력 형식과 엔드포인트를 먼저 확인하세요.' });
    const est = estimateRun({ ep, scenes: [{ id: 'broll:' + bid, durationSec: b.durationSec }], model, settings, cfg, cached: () => false });
    if (provider.mode === 'mock') { est.totalUsd = 0; est.unknown = false; est.withinLimit = true; } // the mock provider never bills
    if (provider.mode === 'live' && est.unknown) out.push({ code: 'ESTIMATE_UNKNOWN', message: '이 모델의 클립당 가격 추정치가 없습니다.', recovery: 'Settings → 비용에 가격을 입력하세요.' });
    if (est.withinLimit === false) out.push({ code: 'OVER_LIMIT', message: `예상 비용 $${est.totalUsd}이(가) 릴스 한도 남은 금액 $${est.remainingUsd}을(를) 넘습니다.`, recovery: 'Settings에서 한도를 올리세요.' });
    return { mode: provider.mode, model: { id: model.id, label: model.label }, brollId: bid, clipSec: est.items[0].clipSec, plannedSec: b.durationSec, totalUsd: est.totalUsd, unknown: est.unknown, blockers: out, canGenerate: out.length === 0, prompt: brollPrompt(b, (ep.brollClips && ep.brollClips[bid] && ep.brollClips[bid].prompt) || '') };
  }
  /** Validates and checks the confirmation synchronously-ish, then runs in the background: { accepted, done } like run(). */
  async function generateBroll(epId, bid, opts = {}) {
    const gk = epId + ':broll:' + bid;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', `${bid} 생성이 이미 진행 중입니다.`, { status: 409 });
    const est = estimateBroll(epId, bid, { modelId: opts.modelId });
    if (est.blockers.length) throw new StudioError('BLOCKED', est.blockers[0].message, { recovery: est.blockers[0].recovery, details: est.blockers, status: 409 });
    if (est.totalUsd == null) { if (!opts.confirmUnknown) throw new StudioError('CONFIRM_REQUIRED', '가격 추정치가 없습니다. 실제 청구 금액을 알 수 없다는 점을 확인해야 합니다.', { status: 409 }); }
    else if (Math.abs(Number(opts.confirmUsd) - est.totalUsd) > 1e-9) throw new StudioError('CONFIRM_MISMATCH', `확인한 금액(${opts.confirmUsd})이 현재 예상(${est.totalUsd})과 다릅니다. 다시 확인하세요.`, { status: 409 });
    const done = runBroll(epId, bid, opts);
    done.catch(() => {});
    return { accepted: true, done };
  }
  async function runBroll(epId, bid, { modelId, prompt, confirmUsd, confirmUnknown = false, by = 'operator' } = {}) {
    const gk = epId + ':broll:' + bid;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', `${bid} 생성이 이미 진행 중입니다.`, { status: 409 });
    running.add(gk);
    let job = null;
    try {
      const est = estimateBroll(epId, bid, { modelId });
      if (est.blockers.length) throw new StudioError('BLOCKED', est.blockers[0].message, { recovery: est.blockers[0].recovery, details: est.blockers, status: 409 });
      if (est.totalUsd == null) { if (!confirmUnknown) throw new StudioError('CONFIRM_REQUIRED', '가격 추정치가 없습니다. 실제 청구 금액을 알 수 없다는 점을 확인해야 합니다.', { status: 409 }); }
      else if (Math.abs(Number(confirmUsd) - est.totalUsd) > 1e-9) throw new StudioError('CONFIRM_MISMATCH', `확인한 금액(${confirmUsd})이 현재 예상(${est.totalUsd})과 다릅니다. 다시 확인하세요.`, { status: 409 });
      const ep0 = store.episodes.get(epId);
      const b = brollOf(ep0, bid);
      const model = modelById(store.models(), modelId || store.settings.get().brollModelId || store.settings.get().defaultModelId);
      const src = brollBlockers(ep0, b).src;
      const text = brollPrompt(b, prompt);
      const imageSha = require('./util').sha256File(src.file);
      const key = jobKey({ model, prompt: text, negative: '', clipSec: est.clipSec, aspectRatio: '9:16', imageSha256: imageSha });
      job = { id: uid('job'), sceneId: b.sceneId, brollId: bid, key, modelId: model.id, mode: provider.mode, status: 'preparing', estimatedUsd: est.totalUsd, promptHash: require('./util').sha256(text), imageSha256: imageSha, clipSec: est.clipSec, aspectRatio: '9:16', requestId: '', error: null, createdAt: nowIso(), updatedAt: nowIso() };
      await store.episodes.update(epId, (ep) => { ep.generation.jobs.push(job); });
      let imageUrl;
      try { imageUrl = (await provider.uploadImage(src.file)).url; } catch (e) { await setJob(epId, job.id, { status: 'failed', billed: false, error: errInfo(e) }); throw e; }
      await store.episodes.update(epId, (ep) => { ep.generation.jobs.find((j) => j.id === job.id).status = 'submitting'; });
      let sub;
      try {
        sub = await provider.submit({ model, prompt: text, imageUrl, aspectRatio: '9:16', duration: est.clipSec });
      } catch (e) {
        const refused = ['AUTH', 'BAD_REQUEST', 'CREDITS', 'RATE_LIMIT'].includes(e.code);
        await setJob(epId, job.id, { status: refused ? 'failed' : 'uncertain', billed: refused ? false : null, error: errInfo(e) });
        throw e;
      }
      await store.episodes.update(epId, (ep) => {
        const j = ep.generation.jobs.find((x) => x.id === job.id);
        j.status = 'processing'; j.requestId = sub.requestId;
        ep.spend.push({ at: nowIso(), kind: 'video', jobId: job.id, sceneId: b.sceneId, brollId: bid, requestId: sub.requestId, estimatedUsd: est.totalUsd, actualUsd: sub.cost && sub.cost.amountUsd != null ? sub.cost.amountUsd : null, mock: provider.mode === 'mock' });
      });
      job.requestId = sub.requestId;
      let r;
      try { r = await provider.waitForResult(job.requestId); } catch (e) {
        await setJob(epId, job.id, { status: ['TIMEOUT', 'NETWORK'].includes(e.code) ? 'polling_interrupted' : 'failed', error: errInfo(e) });
        throw e;
      }
      await applyCost(epId, job, r.cost);
      const tmp = store.episodes.file(epId, 'tmp', job.id + '.mp4');
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      try {
        try { await provider.download(r.outputs[0], tmp); } catch (e) { await setJob(epId, job.id, { status: 'download_failed', outputs: r.outputs, error: errInfo(e) }); throw e; }
        const info = await validateClip(tmp);
        const browserCopy = tmp + '.browser.mp4';
        const browserInfo = await browserMp4(tmp, browserCopy, cfg);
        const hash = sha256File(browserCopy);
        const size = fs.statSync(tmp).size;
        const v = await store.episodes.update(epId, (ep) => {
          ep.brollClips = ep.brollClips || {};
          const c = (ep.brollClips[bid] = ep.brollClips[bid] || { versions: [], approvedVersion: null });
          const n = c.versions.length + 1;
          const rel = path.join('brollclips', bid, 'v' + n + '.mp4');
          fs.mkdirSync(path.dirname(store.episodes.file(epId, rel)), { recursive: true });
          fs.copyFileSync(tmp, store.episodes.file(epId, path.join('brollclips', bid, 'original-v' + n + '.mp4')));
          fs.copyFileSync(browserCopy, store.episodes.file(epId, rel));
          c.prompt = text;
          c.versions.push({ v: n, file: rel, originalFile: path.join('brollclips', bid, 'original-v' + n + '.mp4'), browserCompatibility: browserInfo.compatibility, sha256: hash, size: fs.statSync(browserCopy).size, ...info, status: 'pending_review', createdAt: nowIso(), jobId: job.id, requestId: job.requestId, mock: provider.mode === 'mock', modelId: model.id, imageSha256: imageSha, promptHash: job.promptHash, clipSec: est.clipSec, estimatedUsd: est.totalUsd });
          return n;
        });
        fs.rmSync(browserCopy, { force: true });
        await setJob(epId, job.id, { status: 'completed', outputs: r.outputs, clipVersion: v, sha256: hash, error: null });
        store.episodes.audit(epId, 'broll.clip.completed', { brollId: bid, version: v, by });
        return { brollId: bid, status: 'completed', version: v };
      } finally { fs.rmSync(tmp, { force: true }); }
    } finally { running.delete(gk); }
  }
  async function reviewBroll(epId, bid, version, decision, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      brollOf(ep, bid);
      const c = ep.brollClips && ep.brollClips[bid];
      const v = c && c.versions.find((x) => x.v === Number(version));
      if (!v) throw new StudioError('NOT_FOUND', '클립 버전을 찾을 수 없습니다.', { status: 404 });
      if (decision === 'approve') {
        const f = store.episodes.file(epId, v.file);
        if (!fs.existsSync(f) || sha256File(f) !== v.sha256) throw new StudioError('CHECKSUM', '클립 파일이 기록된 체크섬과 다릅니다.', { status: 409 });
        c.versions.forEach((x) => x.status === 'approved' && (x.status = 'superseded'));
        v.status = 'approved'; v.approvedBy = by; v.approvedAt = nowIso(); c.approvedVersion = v.v;
      } else if (decision === 'unapprove') {
        if (c.approvedVersion !== v.v) throw new StudioError('NOT_APPROVED', '승인된 버전이 아닙니다.', { status: 409 });
        v.status = 'pending_review'; c.approvedVersion = null;
      } else if (decision === 'reject') { v.status = 'rejected'; if (c.approvedVersion === v.v) c.approvedVersion = null; } else throw new StudioError('BAD_DECISION', '승인, 승인 취소 또는 거절만 가능합니다.');
    });
    store.episodes.audit(epId, 'broll.clip.' + decision, { brollId: bid, version, by });
  }

  /** Is the clip version still based on the scene's current start image? Versions made before this was recorded are 'unknown' (never reported stale). */
  function freshness(ep, scene, version) {
    if (!version || !version.imageSha256) return { state: 'unknown' };
    const img = startImage(ep, scene);
    if (img.error || !img.sha256) return { state: 'unknown' };
    return version.imageSha256 === img.sha256 ? { state: 'current' } : { state: 'stale', reason: '이 클립을 만든 뒤 시작 이미지가 바뀌었습니다.' };
  }

  return { estimateBroll, generateBroll, reviewBroll, freshness, estimate, authorize, run, resume, dismissJob, addManualClip, review, startImage, provider, compatibility, blockers };
}

module.exports = { createGenerationService };
