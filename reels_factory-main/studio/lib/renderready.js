// Rendering Readiness: ONE free, read-only check with two SEPARATE stages and three kinds of findings.
//   Stage A — generate video clips: approved script, approved storyboard (per scene), approved start frame, valid animation, valid prompt,
//             character references, provider, readable files. It never asks for a clip that does not exist yet.
//   Stage B — final render: approved clips, audio, B-roll files, ordering/timing. It never blocks stage A.
//   severity 'pending' = a normal unfinished workflow step (neutral: nothing is wrong, the next step is just not done yet)
//            'block'   = something is actually wrong (invalid data, missing/unreadable file, broken approval link, unsupported setup)
//            'warn' / 'info' = notes
// Nothing here calls a provider or writes anything.
'use strict';
const fs = require('node:fs');
const { isScriptApproved, storyboardApprovalStatus } = require('./episode');
const { isGeneric } = require('./animdraft');

const CATS = [
  ['script', '승인된 대본'], ['storyboard', '승인된 스토리보드'], ['images', '장면 이미지 (시작 프레임)'], ['animation', '애니메이션 타임라인'], ['prompt', '영상 생성 프롬프트'],
  ['references', '캐릭터 참조 이미지'], ['provider', '렌더링 제공자'], ['assets', '파일 경로 · 권한'], ['audio', '오디오 확인 · 승인'], ['lipsync', '립싱크 영상'], ['clips', '영상 클립'], ['scenes', '씬 합본 · 최종 승인'],
];
/** generation-gate codes that are ordinary unfinished steps rather than errors */
const PENDING_CODES = new Set(['STORYBOARD_NOT_APPROVED', 'STORYBOARD_SCENE_CHANGED', 'STORYBOARD_CHANGED', 'NO_PROMPT', 'NO_START_IMAGE', 'START_IMAGE_NOT_APPROVED', 'SCRIPT_NOT_APPROVED', 'AUDIO_NOT_APPROVED', 'LIPSYNC_NOT_APPROVED']);
const CAT_OF = { SCRIPT_NOT_APPROVED: 'script', STORYBOARD_NOT_APPROVED: 'storyboard', STORYBOARD_SCENE_CHANGED: 'storyboard', STORYBOARD_CHANGED: 'storyboard', NO_PROMPT: 'prompt', NO_START_IMAGE: 'images', START_IMAGE_NOT_APPROVED: 'images', SHEET_AS_START_FRAME: 'images', PLACEHOLDER_IMAGE: 'images', AUDIO_NOT_APPROVED: 'audio', LIPSYNC_NOT_APPROVED: 'lipsync', MODEL_UNVERIFIED: 'provider' };

function createRenderReadiness({ store, gen, charRefs, animplan, sba, renderer, providerMode, getModel }) {
  const readable = (f) => { try { fs.accessSync(f, fs.constants.R_OK); return true; } catch (_) { return false; } };

  /** none → nothing generated yet · unapproved → clip(s) waiting for review · approved · broken → an approval that points at nothing/damaged */
  function clipState(ep, sc) {
    const c = (ep.clips || {})[sc.id];
    const versions = (c && c.versions) || [];
    if (!versions.length) return { state: 'none' };
    if (!c.approvedVersion) return { state: 'unapproved', versions: versions.length };
    const v = versions.find((x) => x.v === c.approvedVersion);
    if (!v) return { state: 'broken', problem: `승인된 버전(v${c.approvedVersion})을 찾을 수 없습니다 (승인 기록과 클립 목록이 맞지 않음).` };
    return { state: 'approved', v: v.v };
  }

  function check(ep) {
    const items = [];
    const add = (cat, severity, code, message, recovery = '', sceneId = '', stage = 'generate') => items.push({ cat, severity, code, message, recovery, sceneId, stage });
    const scenes = ep.scenes || [];
    const mode = providerMode();

    // ---------------------------------------------------------------- stage A: everything the video model needs (no clip required)
    let blockers = [];
    try { blockers = gen.blockers(ep, scenes, getModel()); } catch (e) { add('provider', 'block', 'MODEL_CHECK_FAILED', '영상 모델 설정을 확인하지 못했습니다: ' + e.message, 'Settings에서 영상 모델을 선택하세요.'); }
    blockers.forEach((b) => {
      if (/^CHARACTER_REF/.test(b.code)) return; // reported once below, for every mode
      const sid = (/^([A-Z]+\d+):/.exec(b.message) || [])[1] || '';
      add(CAT_OF[b.code] || 'provider', PENDING_CODES.has(b.code) ? 'pending' : 'block', b.code, b.message, b.recovery, sid);
    });
    if (!isScriptApproved(ep) && !items.some((i) => i.code === 'SCRIPT_NOT_APPROVED')) add('script', 'pending', 'SCRIPT_NOT_APPROVED', '대본이 승인되지 않았거나 승인 후 수정되었습니다.', 'Script Studio에서 대본을 승인하세요.');

    scenes.forEach((sc) => {
      const m = ep.motion && ep.motion[sc.id];
      if (!m || !m.beats || !m.beats.length) return add('animation', 'pending', 'NO_ANIMATION', `${sc.id}: 애니메이션 타임라인이 아직 없습니다.`, 'Storyboard → 애니메이션에서 "애니메이션 자동 생성"을 누르세요.', sc.id);
      const { problems } = sba.cleanBeats(m.beats, sc);
      problems.slice(0, 3).forEach((p) => add('animation', 'block', 'INVALID_ANIMATION', `${sc.id}: ${p.message}`, '비트를 고치거나 "애니메이션 자동 생성"으로 다시 만드세요.', sc.id));
      const covered = m.beats.reduce((mx, b) => Math.max(mx, b.t1), 0);
      if (!problems.length && covered < Number(sc.durationSec) - 1e-6) add('animation', 'warn', 'ANIMATION_SHORT', `${sc.id}: 타임라인이 ${covered}초에서 끝납니다 (장면 ${sc.durationSec}초). 마지막은 정지 유지로 처리됩니다.`, '', sc.id);
      const gen2 = m.beats.filter(isGeneric).length;
      if (gen2) add('animation', 'warn', 'ANIMATION_GENERIC', `${sc.id}: ${gen2}개 비트가 일반적인 자리표시 문구입니다 (neutral, holds the opening pose …).`, '"애니메이션 자동 생성"으로 대본에 맞는 비트를 만드세요.', sc.id);
    });
    scenes.forEach((sc) => {
      const p = ep.prompts && ep.prompts[sc.id];
      if (p && String(p.video || '').trim() && String(p.video).trim().length < 30) add('prompt', 'block', 'PROMPT_TOO_SHORT', `${sc.id}: 영상 프롬프트가 너무 짧습니다.`, 'Storyboard에서 프롬프트를 보강하세요.', sc.id);
    });
    // a missing / unapproved / demo reference is a step the user still has to do (pending); an image file that vanished is a real error
    charRefs.validate(ep, scenes).problems.forEach((p) => add('references', /^CHARACTER_REF_(MISSING|UNAPPROVED|PLACEHOLDER)$/.test(p.code) ? 'pending' : 'block', p.code, p.message, '캐릭터 라이브러리에서 실제 참조 이미지를 올리고 승인하거나 장면의 "캐릭터 참조 이미지"에서 고르세요.', p.sceneId));

    const caps = animplan.capabilities(mode);
    if (mode !== 'live') add('provider', 'warn', 'PROVIDER_MOCK', 'MOCK 모드입니다: 실제 캐릭터 애니메이션 없이 확인용 샘플 클립만 만들어집니다. ' + caps.providerAnimation.note, 'Settings에서 영상 제공자(Muapi) 키와 RF_STUDIO_VIDEO_MODE=live를 설정하세요.');
    add('provider', 'info', 'CAPABILITIES', `제공자 애니메이션: ${caps.providerAnimation.available ? '사용 가능' : '사용 불가(MOCK)'} · 로컬 효과: ${caps.localEffects.note}`);
    scenes.forEach((sc) => {
      const img = gen.startImage(ep, sc);
      if (!img.error && !readable(img.file)) add('assets', 'block', 'ASSET_UNREADABLE', `${sc.id}: 시작 이미지 파일을 읽을 수 없습니다 (경로 또는 권한).`, '파일을 다시 올리거나 서버 볼륨 권한을 확인하세요.', sc.id);
    });
    try { fs.accessSync(store.episodes.file(ep.id, '.'), fs.constants.W_OK); } catch (_) { add('assets', 'block', 'DIR_NOT_WRITABLE', '에피소드 폴더에 쓸 수 없습니다.', '서버의 /data 볼륨 권한을 확인하세요.'); }

    // ---------------------------------------------------------------- stage B: final render (clips, audio, B-roll files)
    const sceneRows = scenes.map((sc) => ({ sceneId: sc.id, clip: clipState(ep, sc) }));
    sceneRows.forEach(({ sceneId, clip }) => {
      if (clip.state === 'none') add('clips', 'pending', 'CLIP_NOT_GENERATED', `${sceneId}: 영상 클립 생성 대기 — 애니메이션 스튜디오에서 영상을 생성하거나 업로드하세요.`, '애니메이션 스튜디오에서 이 장면을 열어 영상을 만들거나 기존 클립을 올리세요.', sceneId, 'render');
      else if (clip.state === 'unapproved') add('clips', 'pending', 'CLIP_AWAITING_APPROVAL', `${sceneId}: 클립 승인 대기 (${clip.versions}개) — 애니메이션 스튜디오에서 미리보고 승인하세요.`, '애니메이션 스튜디오에서 클립을 확인하고 승인하세요.', sceneId, 'render');
      else if (clip.state === 'broken') add('clips', 'block', 'CLIP_APPROVAL_BROKEN', `${sceneId}: ${clip.problem}`, '애니메이션 스튜디오에서 클립을 다시 승인하세요 (파일은 지워지지 않았습니다).', sceneId, 'render');
    });
    scenes.forEach((sc) => { // an approved clip made from a start image that has since been replaced stays usable but is flagged (nothing is revoked silently)
      const c = (ep.clips || {})[sc.id];
      const v = c && c.approvedVersion && (c.versions || []).find((x) => x.v === c.approvedVersion);
      const fr = v && gen.freshness ? gen.freshness(ep, sc, v) : null;
      if (fr && fr.state === 'stale') add('clips', 'warn', 'CLIP_STALE_IMAGE', `${sc.id}: 승인된 클립(v${v.v})을 만든 뒤 시작 이미지가 바뀌었습니다. 영상이 새 이미지와 다를 수 있습니다.`, '애니메이션 스튜디오에서 새 이미지로 다시 생성하거나, 그대로 써도 되면 클립 승인을 유지하세요.', sc.id, 'render');
    });
    const known = new Set(scenes.map((s) => s.id));
    Object.keys(ep.clips || {}).filter((k) => !known.has(k) && ((ep.clips[k] || {}).versions || []).length).forEach((k) => add('clips', 'warn', 'ORPHAN_CLIPS', `장면 "${k}"에 연결된 클립이 있지만 현재 대본에는 그 장면이 없습니다 (삭제하지 않고 보관 중).`, '', k, 'render'));
    let plan = { problems: [] };
    try { plan = renderer.plan(ep.id); } catch (_) { /* readiness stays usable */ }
    plan.problems.forEach((p) => {
      if (p.code === 'SCRIPT_NOT_APPROVED' || p.code === 'CLIP_NOT_APPROVED') return; // covered above, with the exact state per scene
      const sid = (/^([A-Z]+\d+):/.exec(p.message) || [])[1] || '';
      const pending = p.code === 'NO_AUDIO' || p.code === 'CUTS_NOT_APPROVED' || p.code === 'SCENE_NOT_APPROVED' || p.code === 'LIPSYNC_NOT_APPROVED';
      add(p.code === 'NO_AUDIO' ? 'audio' : p.code === 'LIPSYNC_NOT_APPROVED' ? 'lipsync' : p.code === 'SCENE_NOT_APPROVED' ? 'scenes' : pending || /^CLIP|^CUTS|^BROLL/.test(p.code) ? 'clips' : 'assets', pending ? 'pending' : 'block', p.code, p.message, p.recovery || '', p.sceneId || sid, 'render');
    });

    // where to go: every finding points at the scene and the collapsible Storyboard section where it is fixed
    const PANEL = { CLIP_NOT_GENERATED: 'clips', CLIP_AWAITING_APPROVAL: 'clips', CLIP_APPROVAL_BROKEN: 'clips', CLIP_MISSING: 'clips', CLIP_CHECKSUM: 'clips', CUTS_NOT_APPROVED: 'cuts', BROLL_IMAGE_MISSING: 'cuts', CLIP_STALE_IMAGE: 'clips', NO_ANIMATION: 'motion', INVALID_ANIMATION: 'motion', ANIMATION_GENERIC: 'motion', ANIMATION_SHORT: 'motion', NO_PROMPT: 'prompt', PROMPT_TOO_SHORT: 'prompt', AUDIO_NOT_APPROVED: 'audio', NO_AUDIO: 'audio', SCENE_NOT_APPROVED: 'compose' };
    items.forEach((i) => {
      if (i.sceneId && /^CLIP_/.test(i.code)) i.action = { view: 'animation', sceneId: i.sceneId, label: '애니메이션 스튜디오로 이동' };
      else if (['AUDIO_NOT_APPROVED', 'NO_AUDIO'].includes(i.code)) i.action = { view: 'voice', sceneId: i.sceneId || '', label: '보이스 스튜디오로 이동' };
      else if (i.code === 'LIPSYNC_NOT_APPROVED') i.action = { view: 'lipsync', sceneId: i.sceneId || '', label: '립싱크 스튜디오로 이동' };
      else if (i.sceneId) i.action = { view: 'storyboard', sceneId: i.sceneId, panel: PANEL[i.code] || (/^CHARACTER_REF/.test(i.code) ? 'charrefs' : ''), label: '이 장면으로 이동' };
      else if (i.cat === 'script') i.action = { view: 'script', label: '대본으로 이동' };
      else if (i.cat === 'storyboard') i.action = { view: 'storyboard', sceneId: (storyboardApprovalStatus(ep).changedScenes || [])[0] || '', panel: '', label: 'Storyboard로 이동' };
      else if (i.cat === 'provider' || i.cat === 'assets') i.action = { view: 'settings', label: '설정으로 이동' };
      if (!i.action && (i.severity === 'block' || i.severity === 'pending')) i.action = { view: 'storyboard', sceneId: '', panel: '', label: 'Storyboard로 이동' };
    });

    // ---------------------------------------------------------------- summary
    const open = (stage) => items.filter((i) => i.stage === stage && (i.severity === 'block' || i.severity === 'pending'));
    const gate = open('generate');
    const generateStatus = gate.some((i) => i.severity === 'block') ? 'blocked' : gate.length ? 'pending' : 'ready';
    const none = sceneRows.filter((r) => r.clip.state === 'none').length;
    const unapproved = sceneRows.filter((r) => r.clip.state === 'unapproved').length;
    const broken = sceneRows.filter((r) => r.clip.state === 'broken').length;
    const approved = sceneRows.filter((r) => r.clip.state === 'approved').length;
    const renderOpen = open('render');
    const stages = {
      generate: { status: generateStatus, label: generateStatus === 'ready' ? '영상 생성 준비됨' : generateStatus === 'blocked' ? '영상 생성 막힘 (확인 필요)' : '영상 생성 전 단계 진행 중' },
      clipGeneration: { status: none === 0 ? 'done' : 'waiting', count: none, label: none === 0 ? '모든 장면에 클립 있음' : `영상 생성 대기 ${none}개 장면` },
      clipApproval: { status: unapproved === 0 && none === 0 ? 'done' : 'waiting', count: unapproved, label: unapproved === 0 ? (none === 0 ? '모든 클립 승인됨' : '승인할 클립 없음') : `클립 승인 대기 ${unapproved}개 장면` },
      render: { status: !renderOpen.length && !gate.length ? 'ready' : renderOpen.some((i) => i.severity === 'block') ? 'blocked' : 'waiting', label: !renderOpen.length && !gate.length ? '최종 렌더 준비됨' : renderOpen.some((i) => i.severity === 'block') ? '최종 렌더 막힘 (확인 필요)' : '최종 렌더 대기' },
    };
    const sceneStatus = scenes.map((sc) => {
      const mine = items.filter((i) => i.sceneId === sc.id && (i.severity === 'block' || i.severity === 'pending'));
      const row = sceneRows.find((r) => r.sceneId === sc.id);
      return { sceneId: sc.id, clip: row.clip.state, blocking: mine.filter((i) => i.severity === 'block').map((i) => ({ code: i.code, message: i.message })), pending: mine.filter((i) => i.severity === 'pending').map((i) => ({ code: i.code, message: i.message })) };
    });
    const blocking = items.filter((i) => i.severity === 'block');
    const pendingItems = items.filter((i) => i.severity === 'pending');
    const byCat = CATS.map(([key, label]) => ({ key, label, blocking: blocking.filter((i) => i.cat === key).length, pending: pendingItems.filter((i) => i.cat === key).length, warnings: items.filter((i) => i.cat === key && i.severity === 'warn').length }));
    return { canGenerateVideo: generateStatus === 'ready', canRender: stages.render.status === 'ready', blocking: blocking.length, pending: pendingItems.length, warnings: items.filter((i) => i.severity === 'warn').length, stages, clips: { none, unapproved, approved, broken, total: scenes.length }, scenes: sceneStatus, categories: byCat, items, mode, capabilities: caps, storyboard: (({ everApproved, legacy, reasons, changedScenes }) => ({ everApproved, legacy, reasons, changedScenes }))(storyboardApprovalStatus(ep)) };
  }
  return { check };
}

module.exports = { createRenderReadiness, CATS };
