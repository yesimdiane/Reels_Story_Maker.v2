// Lip Sync Studio: input = the APPROVED SILENT animation + the APPROVED scene voice audio → one lip-synced video per scene.
//   * the result is stored separately (ep.lipsync[scene].versions) — the silent animation and the audio files are never touched
//   * a provider's limits are checked BEFORE anything is sent: approvals present, speaker count vs model capability, duration, price, verification
//   * multi-person lip sync is NOT assumed: a model must declare `speakers: 'multi'` (operator-entered); 'unknown' counts as one speaker
//   * paid calls: free estimate → exact-amount confirmation (single use, 30 min) → ONE submit; failed/uncertain jobs are never auto-retried
//   * an approved lip-sync result is never replaced silently: regenerate only after "승인 취소"
//   * mock mode muxes the silent clip with the scene audio locally (FFmpeg, free) so the whole hand-off can be exercised
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, uid, nowIso, sha256File, sha256, canonical, writeFileAtomic } = require('./util');
const { spentUsd, limitFor, round } = require('./budget');
const { validateEndpoint } = require('./modelcontract');
const { buildTimeline } = require('./timeline');
const { buildAudioTrack } = require('./render');
const { run, probe } = require('../../renderer/lib/ffmpeg');

const AUTH_TTL_MS = 30 * 60 * 1000;
const seedFile = path.join(__dirname, '..', 'seed', 'lipsync-models.json');

function createLipSync({ store, cfg, provider, voice, sceneFlow, now = () => Date.now(), log = () => {} }) {
  const running = new Set();
  const h = (v) => sha256(canonical(v));
  const sceneOf = (ep, id) => { const s = (ep.scenes || []).find((x) => x.id === id); if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + id, { status: 404 }); return s; };

  // ------------------------------------------------------------ models
  function models() {
    const st = store.settings.get();
    const ver = st.modelVerification || {};
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')).models;
    return seed.concat((st.customLipsyncModels || []).map((m) => Object.assign({}, m, { custom: true }))).map((m) => {
      const v = ver[m.id];
      const price = st.lipsyncPrices && Object.prototype.hasOwnProperty.call(st.lipsyncPrices, m.id) ? st.lipsyncPrices[m.id] : m.costEstimateUsd;
      m = Object.assign({}, m, { costEstimateUsd: price == null ? null : Number(price) });
      return v && ['user-entered', 'verified'].includes(v.level) && m.verification !== 'verified' ? Object.assign({}, m, { verification: v.level, verifiedAt: v.at }) : m;
    });
  }
  const modelById = (id) => { const m = models().find((x) => x.id === id); if (!m) throw new StudioError('MODEL', '알 수 없는 립싱크 모델입니다: ' + id, { recovery: 'Settings에서 립싱크 모델을 선택하세요.' }); return m; };
  const defaultModelId = () => store.settings.get().lipsyncModelId || models()[0].id;
  function setPrice(id, raw) {
    modelById(id);
    if (raw !== null && raw !== '' && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) throw new StudioError('BAD_PRICE', '가격은 0 이상의 USD 숫자이거나 미입력이어야 합니다.', { status: 422 });
    const st = store.settings.get();
    store.settings.save({ lipsyncPrices: Object.assign({}, st.lipsyncPrices || {}, { [id]: raw === '' ? null : raw }) });
    return { modelId: id, costEstimateUsd: raw === '' ? null : raw };
  }

  function addModel(spec) {
    const id = String(spec.id || '').trim();
    if (!/^lipsync-[a-z0-9][a-z0-9._-]{1,40}$/.test(id)) throw new StudioError('BAD_MODEL', '립싱크 모델 ID는 "lipsync-" 로 시작하는 영문 소문자·숫자·-_. 입니다.', { status: 422 });
    if (models().some((m) => m.id === id)) throw new StudioError('BAD_MODEL', '이미 있는 모델 ID입니다.', { status: 409 });
    const endpoint = validateEndpoint(spec.endpoint);
    if (!endpoint) throw new StudioError('BAD_MODEL', '엔드포인트는 MuAPI 플레이그라운드의 경로여야 합니다 (주소·"//"·".." 불가).', { status: 422 });
    const field = (v, d) => { const s = String(v || d).trim(); if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(s)) throw new StudioError('BAD_MODEL', '요청 필드 이름이 올바르지 않습니다.', { status: 422 }); return s; };
    const cost = spec.costEstimateUsd == null || spec.costEstimateUsd === '' ? null : Number(spec.costEstimateUsd);
    if (cost != null && !(cost >= 0)) throw new StudioError('BAD_MODEL', '예상 비용은 0 이상이어야 합니다.', { status: 422 });
    const m = { id, label: String(spec.label || id).slice(0, 80), provider: 'muapi', mode: 'video-to-video', endpoint, videoField: field(spec.videoField, 'video_url'), audioField: field(spec.audioField, 'audio_url'),
      speakers: spec.speakers === 'multi' ? 'multi' : spec.speakers === 'single' ? 'single' : 'unknown', verification: spec.confirmed ? 'user-entered' : 'unverified', notes: String(spec.notes || '').slice(0, 300) };
    if (spec.maxDurationSec) m.maxDurationSec = Math.max(1, Number(spec.maxDurationSec) || 0);
    if (cost != null) m.costEstimateUsd = cost;
    store.settings.save({ customLipsyncModels: (store.settings.get().customLipsyncModels || []).concat(m) });
    return m;
  }
  function confirmModel(id) {
    modelById(id);
    const cur = store.settings.get();
    store.settings.save({ modelVerification: Object.assign({}, cur.modelVerification || {}, { [id]: { level: 'user-entered', at: nowIso() } }) });
  }
  function removeModel(id) {
    const cur = store.settings.get();
    if (!(cur.customLipsyncModels || []).some((m) => m.id === id)) throw new StudioError('NOT_FOUND', '직접 추가한 모델이 아닙니다.', { status: 404 });
    if (cur.lipsyncModelId === id) throw new StudioError('IN_USE', '기본 모델은 지울 수 없습니다.', { status: 409 });
    store.settings.save({ customLipsyncModels: cur.customLipsyncModels.filter((m) => m.id !== id) });
  }

  // ------------------------------------------------------------ inputs
  const dialogueLines = (ep, sid) => (ep.lines || []).filter((l) => l.sceneId === sid);
  const speakersOf = (ep, sid) => [...new Set(dialogueLines(ep, sid).map((l) => l.speaker).filter(Boolean))];
  function approvedAnimation(ep, sid) {
    const c = (ep.clips || {})[sid];
    return (c && c.approvedVersion && c.versions.find((x) => x.v === c.approvedVersion)) || null;
  }
  function state(ep, sid) { return (ep.lipsync || {})[sid] || { versions: [], approvedVersion: null }; }
  const approvedVersion = (ep, sid) => { const s = state(ep, sid); return (s.approvedVersion && s.versions.find((x) => x.v === s.approvedVersion)) || null; };

  /** Everything the provider will receive, plus why it cannot be sent yet. Free; no network. */
  function inputs(ep, sid, model) {
    sceneOf(ep, sid);
    const lines = dialogueLines(ep, sid);
    const anim = approvedAnimation(ep, sid);
    const au = sceneFlow.audioState(ep, sid);
    const speakers = speakersOf(ep, sid);
    const problems = [];
    const warnings = [];
    if (!lines.length) return { dialogue: false, problems, warnings, speakers, anim, audio: au };
    if (!anim) problems.push({ code: 'NO_ANIMATION', message: `${sid}: 승인된 무음 애니메이션이 없습니다.`, recovery: '애니메이션 스튜디오에서 클립을 만들고 승인하세요.' });
    if (au.state !== 'approved') problems.push({ code: 'AUDIO_NOT_APPROVED', message: `${sid}: 승인된 대사 음성이 없습니다 (${au.state}).`, recovery: '보이스 스튜디오에서 음성을 만들고 승인하세요.' });
    if (speakers.length > 1 && model.speakers !== 'multi') problems.push({ code: 'MULTI_SPEAKER_UNSUPPORTED', message: `${sid}: 말하는 인물이 ${speakers.length}명(${speakers.join(', ')})인데 선택한 모델은 다인 립싱크를 지원한다고 선언되어 있지 않습니다.`, recovery: '다인 립싱크를 지원하는 모델을 등록·선택하거나, 장면을 화자별로 나누세요. 이 앱은 다인 립싱크를 가정하지 않습니다.' });
    if (anim && model.maxDurationSec && anim.durationSec > model.maxDurationSec + 1e-6) problems.push({ code: 'CLIP_TOO_LONG', message: `${sid}: 애니메이션(${anim.durationSec}초)이 이 모델의 최대 길이(${model.maxDurationSec}초)보다 깁니다.`, recovery: '다른 모델을 고르거나 장면을 줄이세요.' });
    if (anim && au.totalSec && au.totalSec > anim.durationSec + 0.3) warnings.push({ code: 'AUDIO_LONGER', message: `${sid}: 음성(${au.totalSec}초)이 애니메이션(${anim.durationSec}초)보다 깁니다. 제공자가 영상을 늘리거나 음성을 자를 수 있습니다.` });
    return { dialogue: true, problems, warnings, speakers, anim, audio: au };
  }

  function estimate(epId, { sceneIds, modelId } = {}) {
    const ep = store.episodes.get(epId);
    const model = modelById(modelId || defaultModelId());
    const ids = (sceneIds && sceneIds.length ? sceneIds : (ep.scenes || []).map((s) => s.id)).filter((sid) => dialogueLines(ep, sid).length);
    const items = ids.map((sid) => ({ sceneId: sid, usd: model.costEstimateUsd != null ? model.costEstimateUsd : null, ...(() => { const i = inputs(ep, sid, model); return { problems: i.problems, warnings: i.warnings, speakers: i.speakers }; })(), hasApproved: !!approvedVersion(ep, sid) }));
    const blockers = [];
    items.forEach((i) => i.problems.forEach((p) => blockers.push(p)));
    items.filter((i) => i.hasApproved).forEach((i) => blockers.push({ code: 'ALREADY_APPROVED', message: `${i.sceneId}: 승인된 립싱크가 이미 있습니다.`, recovery: '다시 만들려면 먼저 "승인 취소"를 누르세요. 승인된 결과는 자동으로 덮어쓰지 않습니다.' }));
    const unknown = items.some((i) => i.usd == null);
    const total = unknown ? null : round(items.reduce((n, i) => n + i.usd, 0));
    if (provider.mode === 'live') {
      if (!['verified', 'user-entered'].includes(model.verification)) blockers.push({ code: 'MODEL_UNVERIFIED', message: '립싱크 모델 엔드포인트가 확인되지 않았습니다.', recovery: 'MuAPI 플레이그라운드에서 경로와 요청 파라미터를 확인한 뒤 Settings에서 "플레이그라운드에서 확인함"을 누르세요.' });
      if (unknown) blockers.push({ code: 'ESTIMATE_UNKNOWN', message: '이 립싱크 모델의 장면당 가격 추정치가 없습니다.', recovery: 'Settings에서 예상 비용(USD)을 직접 입력하세요. 가격은 임의로 채우지 않습니다.' });
      const settings = store.settings.get();
      const remaining = round(limitFor(ep, settings, cfg) - spentUsd(ep));
      if (total != null && total > remaining + 1e-9) blockers.push({ code: 'OVER_LIMIT', message: `예상 비용 $${total}이(가) 남은 한도 $${remaining}을(를) 넘습니다.`, recovery: 'Settings에서 릴스당 한도를 올리거나 장면 수를 줄이세요.' });
    }
    if (!items.length) blockers.push({ code: 'NO_DIALOGUE_SCENES', message: '립싱크할 대사 장면이 없습니다.', recovery: '대사가 없는 장면은 이 단계를 건너뜁니다.' });
    return { mode: provider.mode, model: { id: model.id, label: model.label, verification: model.verification, speakers: model.speakers, endpoint: model.endpoint }, scenes: items.map((i) => i.sceneId), items, totalUsd: total, unknown, blockers, canAuthorize: blockers.length === 0 };
  }

  async function authorize(epId, { sceneIds, modelId, confirmUsd, confirmUnknown = false, by = 'operator' } = {}) {
    const est = estimate(epId, { sceneIds, modelId });
    if (est.blockers.length) throw new StudioError('BLOCKED', est.blockers[0].message, { recovery: est.blockers[0].recovery, details: est.blockers, status: 409 });
    if (est.totalUsd == null) {
      if (provider.mode === 'live') throw new StudioError('ESTIMATE_UNKNOWN', '실제 립싱크에는 가격 추정치가 필요합니다.');
      if (!confirmUnknown) throw new StudioError('CONFIRM_REQUIRED', '비용 추정치가 없습니다. 목업 모드에서만 "추정치 없음"을 확인하고 진행할 수 있습니다.', { status: 409 });
    } else if (confirmUsd == null || Math.abs(Number(confirmUsd) - est.totalUsd) > 1e-6) {
      throw new StudioError('CONFIRM_MISMATCH', `확인한 금액($${confirmUsd})이 현재 예상 비용($${est.totalUsd})과 다릅니다. 새로고침 후 다시 확인하세요.`, { status: 409 });
    }
    const ep = store.episodes.get(epId);
    const a = { id: uid('lsauth'), sceneIds: est.scenes.slice(), modelId: est.model.id, mode: provider.mode, estimatedUsd: est.totalUsd, inputHash: h(est.scenes.map((sid) => [sid, (approvedAnimation(ep, sid) || {}).sha256, sceneFlow.audioState(ep, sid).hash])), createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + AUTH_TTL_MS).toISOString(), by, consumed: [] };
    await store.episodes.update(epId, (e) => { e.lipsyncAuth = (e.lipsyncAuth || []).concat(a); });
    store.episodes.audit(epId, 'lipsync.authorized', { authorizationId: a.id, scenes: a.sceneIds, modelId: a.modelId, mode: a.mode, estimatedUsd: a.estimatedUsd, by });
    return a;
  }

  // ------------------------------------------------------------ run
  async function buildSceneAudio(ep, sid, work) {
    const au = sceneFlow.audioState(ep, sid);
    const audio = {};
    au.lines.forEach((r) => { audio[r.id] = voice.lineAudio(ep, { id: r.id, speaker: r.speaker, en: r.en }); });
    const tl = buildTimeline(ep, (id) => (audio[id] && audio[id].valid ? audio[id].durationSec : null));
    const ts = tl.scenes.find((x) => x.id === sid);
    const items = tl.lines.filter((l) => l.sceneId === sid && audio[l.id]).map((l) => ({ file: audio[l.id].file, start: Math.max(0, l.start - ts.start), gainDb: 0 }));
    const out = path.join(work, 'scene-audio.wav');
    await buildAudioTrack(cfg.ffmpeg.ffmpeg, items, Math.max(0.5, ts.duration), out, work);
    return { file: out, durationSec: ts.duration };
  }

  async function mockLipSync(clipFile, audioFile, out, work) {
    // free local stand-in: the silent clip with the scene audio laid under it (no mouth sync — it only exercises the hand-off)
    await run(cfg.ffmpeg.ffmpeg, ['-hide_banner', '-y', '-i', clipFile, '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out], { cwd: work });
  }

  async function addVersion(epId, sid, tmp, meta) {
    const p = await probe(cfg.ffmpeg.ffprobe, tmp);
    const v = p.streams.find((s) => s.codec_type === 'video');
    if (!v) throw new StudioError('BAD_CLIP', '립싱크 결과에 영상 스트림이 없습니다.');
    const hash = sha256File(tmp);
    return store.episodes.update(epId, (ep) => {
      ep.lipsync = ep.lipsync || {};
      const s = (ep.lipsync[sid] = ep.lipsync[sid] || { versions: [], approvedVersion: null });
      const n = s.versions.length + 1;
      const rel = path.join('lipsync', sid, 'v' + n + '.mp4');
      fs.mkdirSync(path.dirname(store.episodes.file(epId, rel)), { recursive: true });
      fs.copyFileSync(tmp, store.episodes.file(epId, rel));
      s.versions.push(Object.assign({ v: n, file: rel, sha256: hash, size: fs.statSync(tmp).size, durationSec: Math.round(p.duration * 100) / 100, hasAudio: p.streams.some((x) => x.codec_type === 'audio'), status: 'pending_review', createdAt: nowIso() }, meta));
      return n;
    });
  }

  function setJob(epId, id, patch) {
    return store.episodes.update(epId, (ep) => { const j = (ep.lipsyncJobs || []).find((x) => x.id === id); if (j) Object.assign(j, patch, { updatedAt: nowIso() }); });
  }
  const errInfo = (e) => ({ code: e.code || 'ERROR', message: e.message, recovery: e.recovery || '' });

  /** Runs ONE scene. The authorization is consumed before the paid submit; nothing here retries. */
  async function runScene(epId, authId, sid) {
    const gk = epId + ':' + sid;
    if (running.has(gk)) throw new StudioError('ALREADY_RUNNING', `${sid} 립싱크가 이미 진행 중입니다.`, { status: 409 });
    running.add(gk);
    const work = store.episodes.file(epId, 'tmp', 'ls-' + Date.now());
    fs.mkdirSync(work, { recursive: true });
    let job = null;
    try {
      const ep0 = store.episodes.get(epId);
      const a = (ep0.lipsyncAuth || []).find((x) => x.id === authId);
      if (!a) throw new StudioError('NO_AUTH', '유효한 립싱크 승인이 없습니다.', { recovery: '비용을 확인하고 승인하세요.', status: 403 });
      if (a.mode !== provider.mode) throw new StudioError('AUTH_MODE', `이 승인은 ${a.mode} 모드용입니다.`, { status: 403 });
      if (new Date(a.expiresAt).getTime() < now()) throw new StudioError('AUTH_EXPIRED', '립싱크 승인이 만료되었습니다 (30분).', { status: 403 });
      if (!a.sceneIds.includes(sid)) throw new StudioError('AUTH_SCENE', `${sid}는 이 승인에 포함되지 않았습니다.`, { status: 403 });
      if (a.consumed.includes(sid)) throw new StudioError('AUTH_USED', `${sid}에 대한 승인은 이미 사용되었습니다. 다시 하려면 새로 승인하세요.`, { status: 403 });
      const model = modelById(a.modelId);
      const inp = inputs(ep0, sid, model);
      if (inp.problems.length) throw new StudioError('BLOCKED', inp.problems[0].message, { recovery: inp.problems[0].recovery, details: inp.problems, status: 409 });
      if (approvedVersion(ep0, sid)) throw new StudioError('ALREADY_APPROVED', `${sid}: 승인된 립싱크가 있습니다. 먼저 승인을 취소하세요.`, { status: 409 });
      const clipFile = store.episodes.file(epId, inp.anim.file);
      if (!fs.existsSync(clipFile) || sha256File(clipFile) !== inp.anim.sha256) throw new StudioError('CLIP_CHECKSUM', `${sid}: 승인된 애니메이션 파일이 없거나 바뀌었습니다.`, { status: 409 });
      const aud = await buildSceneAudio(ep0, sid, work);
      const audioHash = inp.audio.hash;
      job = { id: uid('lsjob'), sceneId: sid, modelId: model.id, authorizationId: authId, mode: provider.mode, status: 'preparing', estimatedUsd: model.costEstimateUsd != null ? model.costEstimateUsd : null, clipRef: { v: inp.anim.v, sha256: inp.anim.sha256 }, audioHash, requestId: '', error: null, createdAt: nowIso(), updatedAt: nowIso() };
      await store.episodes.update(epId, (e) => { e.lipsyncJobs = (e.lipsyncJobs || []).concat(job); });
      const out = path.join(work, 'out.mp4');
      if (provider.mode === 'mock') {
        await store.episodes.update(epId, (e) => { e.lipsyncAuth.find((x) => x.id === authId).consumed.push(sid); });
        await mockLipSync(clipFile, aud.file, out, work);
        job.requestId = 'mock_lipsync';
      } else {
        // free uploads first: a failure here bills nothing and keeps the authorization usable
        let videoUrl; let audioUrl;
        try {
          videoUrl = (await provider.uploadFile(clipFile)).url;
          audioUrl = (await provider.uploadFile(aud.file, { maxBytes: 50 * 1024 * 1024 })).url;
        } catch (e) { await setJob(epId, job.id, { status: 'failed', billed: false, error: errInfo(e) }); throw e; }
        await store.episodes.update(epId, (e) => { e.lipsyncAuth.find((x) => x.id === authId).consumed.push(sid); (e.lipsyncJobs.find((x) => x.id === job.id)).status = 'submitting'; });
        let sub;
        try {
          sub = await provider.submitRaw({ endpoint: model.endpoint, body: { [model.videoField]: videoUrl, [model.audioField]: audioUrl } });
        } catch (e) {
          const refused = ['AUTH', 'BAD_REQUEST', 'CREDITS', 'RATE_LIMIT'].includes(e.code);
          await setJob(epId, job.id, { status: refused ? 'failed' : 'unknown', billed: refused ? false : 'unknown', error: errInfo(e) });
          throw e;
        }
        job.requestId = sub.requestId;
        await store.episodes.update(epId, (e) => {
          const j = e.lipsyncJobs.find((x) => x.id === job.id); j.status = 'processing'; j.requestId = sub.requestId;
          e.spend.push({ at: nowIso(), kind: 'lipsync', jobId: job.id, sceneId: sid, requestId: sub.requestId, estimatedUsd: model.costEstimateUsd, actualUsd: sub.cost && sub.cost.amountUsd != null ? sub.cost.amountUsd : null, mock: false, modelId: model.id });
        });
        let r;
        try { r = await provider.waitForResult(sub.requestId); } catch (e) { await setJob(epId, job.id, { status: ['TIMEOUT', 'NETWORK'].includes(e.code) ? 'polling_interrupted' : 'failed', error: errInfo(e) }); throw e; }
        try { await provider.download(r.outputs[0], out); } catch (e) { await setJob(epId, job.id, { status: 'download_failed', outputs: r.outputs, error: errInfo(e) }); throw e; }
      }
      const v = await addVersion(epId, sid, out, { jobId: job.id, requestId: job.requestId, modelId: model.id, mock: provider.mode === 'mock', clipRef: job.clipRef, audioHash });
      await setJob(epId, job.id, { status: 'completed', version: v, error: null });
      store.episodes.audit(epId, 'lipsync.completed', { sceneId: sid, version: v, mode: provider.mode });
      return { sceneId: sid, status: 'completed', version: v };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      running.delete(gk);
    }
  }

  async function review(epId, sid, v, action, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      sceneOf(ep, sid);
      const s = state(ep, sid);
      const ver = s.versions.find((x) => x.v === Number(v));
      if (!ver) throw new StudioError('NOT_FOUND', '립싱크 버전을 찾을 수 없습니다.', { status: 404 });
      if (action === 'approve') {
        const f = store.episodes.file(epId, ver.file);
        if (!fs.existsSync(f) || sha256File(f) !== ver.sha256) throw new StudioError('CHECKSUM', '파일이 기록된 체크섬과 다릅니다.', { status: 409 });
        const anim = approvedAnimation(ep, sid);
        if (!anim || anim.sha256 !== ver.clipRef.sha256) throw new StudioError('STALE', '이 립싱크는 현재 승인된 애니메이션으로 만든 것이 아닙니다.', { status: 409 });
        if (sceneFlow.audioState(ep, sid).hash !== ver.audioHash) throw new StudioError('STALE', '이 립싱크는 현재 승인된 음성으로 만든 것이 아닙니다.', { status: 409 });
        s.versions.forEach((x) => { if (x.status === 'approved') x.status = 'pending_review'; });
        ver.status = 'approved'; ver.approvedBy = by; ver.approvedAt = nowIso(); s.approvedVersion = ver.v;
      } else if (action === 'unapprove') {
        if (s.approvedVersion === ver.v) s.approvedVersion = null;
        ver.status = 'pending_review';
      } else if (action === 'reject') {
        if (s.approvedVersion === ver.v) s.approvedVersion = null;
        ver.status = 'rejected';
      } else throw new StudioError('BAD_REQUEST', 'action은 approve/unapprove/reject 입니다.', { status: 422 });
      ep.lipsync = ep.lipsync || {}; ep.lipsync[sid] = s;
    });
    store.episodes.audit(epId, 'lipsync.' + action, { sceneId: sid, version: v, by });
  }

  /** Per-scene summary for the UI and the Video Studio hand-off. */
  function sceneView(ep, sid, model) {
    const m = model || modelById(defaultModelId());
    const inp = inputs(ep, sid, m);
    const s = state(ep, sid);
    const av = approvedVersion(ep, sid);
    const stale = !!av && (!inp.anim || inp.anim.sha256 !== av.clipRef.sha256 || inp.audio.hash !== av.audioHash);
    return { sceneId: sid, dialogue: inp.dialogue, speakers: inp.speakers, problems: inp.problems, warnings: inp.warnings, approvedVersion: s.approvedVersion, stale,
      state: !inp.dialogue ? 'not-needed' : av ? (stale ? 'stale' : 'approved') : s.versions.length ? 'pending' : inp.problems.length ? 'blocked' : 'ready',
      versions: s.versions.map((x) => Object.assign({}, x, { url: `/media/lipsync/${ep.id}/${sid}/${x.v}` })) };
  }

  return { models, modelById, defaultModelId, setPrice, addModel, confirmModel, removeModel, inputs, estimate, authorize, runScene, review, sceneView, approvedVersion, state };
}

module.exports = { createLipSync };
