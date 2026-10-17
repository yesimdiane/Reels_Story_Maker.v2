#!/usr/bin/env node
'use strict';
// Read-only readiness report for one scene's animation clip (default: PRD-001 / EP01 / S1). It NEVER submits, authorizes or spends anything:
// it only runs the same free estimate the Animation Studio shows. Usage: node scripts/animation-preflight.js [episodeId] [sceneId]
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');

const epId = process.argv[2] || 'EP01';
const sceneId = process.argv[3] || 'S1';
const cfg = loadConfig(process.env);
const s = createStudio({ cfg });
const ep = s.store.episodes.get(epId);
const sc = ep.scenes.find((x) => x.id === sceneId);
if (!sc) { console.error(`장면을 찾을 수 없습니다: ${epId}/${sceneId}`); process.exit(2); }
const est = s.gen.estimate(epId, { sceneIds: [sceneId] });
const view = s.episodeView(epId).scenes.find((x) => x.id === sceneId);
const line = (k, v) => console.log(`${k.padEnd(18)} ${v}`);
console.log(`Animation preflight — ${epId} / ${sceneId} (${sc.title_ko || sc.title || ''})`);
line('모드', `${est.mode.toUpperCase()}${est.mode === 'live' ? ' (유료)' : ' (요금 없음)'}`);
line('모델', `${est.model.label} [검증: ${est.model.verification}]`);
line('클립 길이', `${est.items[0].clipSec}초 (장면 ${sc.durationSec}초)`);
line('예상 비용', est.mode === 'mock' ? '$0 (목업)' : est.totalUsd == null ? '추정치 없음 — Settings에서 단가 입력 필요' : `$${est.totalUsd}`);
line('시작 이미지', view.startImageInfo && !view.startImageInfo.error ? `${view.startImageInfo.fileName || view.startImageInfo.label} (${view.startImageInfo.approved ? '승인됨' : '미승인'})` : '없음');
line('프롬프트', view.prompt ? `r${view.prompt.rev || 1}${view.prompt.edited ? ' · 직접 수정됨' : ''}` : '없음');
line('타임라인 비트', view.motion ? `${view.motion.beats.length}개` : '없음');
line('API 키', cfg.muapiApiKey ? '서버에 설정됨' : '없음');
console.log(est.blockers.length ? '\n막힌 항목:\n' + est.blockers.map((b) => ` - ${b.message}${b.recovery ? '\n   → ' + b.recovery : ''}`).join('\n') : '\n막힌 항목 없음 — Animation Studio에서 비용 확인 후 직접 승인하면 생성할 수 있습니다.');
console.log('\n이 스크립트는 아무것도 제출하거나 승인하지 않았습니다.');
process.exit(0);
