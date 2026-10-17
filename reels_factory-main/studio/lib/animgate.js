// Animation Studio readiness: the animation is SILENT, so nothing about audio, sound effects or lip sync is required before it.
//   checklist: approved start image · animation prompt · model · valid endpoint · silent-audio setting (informational) · cost/budget
// Voice (Voice Studio) and lip sync (Lip Sync Studio) come AFTER an approved silent animation; sound effects are optional and live in Video Studio.
'use strict';
const { StudioError } = require('./util');

function createAnimGate({ store }) {
  const sceneOf = (ep, id) => { const s = (ep.scenes || []).find((x) => x.id === id); if (!s) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다: ' + id, { status: 404 }); return s; };

  /** Nothing extra blocks the paid animation call: no audio / SFX / lip-sync prerequisites. */
  function blockers() { return []; }

  /** Checklist for one scene. `est` is gen.estimate() for that scene (free). */
  function checklist(ep, sid, { model, est } = {}) {
    sceneOf(ep, sid);
    const prompt = ep.prompts && ep.prompts[sid];
    const codes = new Set(((est && est.blockers) || []).map((b) => b.code));
    const silentDeclared = !!(model && model.silentParams && Object.keys(model.silentParams).length);
    const items = [
      { key: 'image', label: '시작 이미지 승인', ok: !codes.has('START_IMAGE_NOT_APPROVED') && !codes.has('NO_START_IMAGE') && !codes.has('STORYBOARD_SCENE_CHANGED'), action: 'image' },
      { key: 'prompt', label: '애니메이션 프롬프트 준비', ok: !!(prompt && String(prompt.video || '').trim()), action: 'prompt' },
      { key: 'model', label: '영상 모델 선택', ok: !!model, detail: model ? model.label || model.id : '', action: 'model' },
      { key: 'endpoint', label: '모델 엔드포인트 유효', ok: !!(model && model.endpoint) && !codes.has('MODEL_UNVERIFIED'), detail: model ? model.verification : '', action: 'model' },
      { key: 'silent', label: silentDeclared ? '무음 설정 적용 (모델의 음성 끄기 파라미터)' : '무음 설정: 모델이 음성 끄기 파라미터를 선언하지 않았습니다 — 클립에 소리가 있어도 최종 영상에서는 쓰지 않습니다', ok: true, info: true, detail: silentDeclared ? JSON.stringify(model.silentParams) : '' },
      { key: 'cost', label: '비용·예산 확인', ok: !!est && !codes.has('ESTIMATE_UNKNOWN') && !codes.has('OVER_LIMIT'), detail: est && est.totalUsd != null ? '$' + est.totalUsd : '', action: 'cost' },
    ];
    return { sceneId: sid, ready: items.every((i) => i.ok), items };
  }

  return { blockers, checklist };
}

module.exports = { createAnimGate };
