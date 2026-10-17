# v2.2 → v2.3 감사 요약 및 마이그레이션

## 감사 결과 (v2.2 zip)
- 동작 중: 의존성 없는 Node Studio(`studio/`), 에피소드 파이프라인, Muapi/HeyGen 목업·실제 이중 모드, Apps Script/Sheets 브리지, Mac 렌더러(FFmpeg).
- 한계: localhost 전용·인증 없음, 키를 로컬 `.env`에만 보관(UI 설정 불가), 제품→대본 직행, Gemini 단일 제공자, 제품/참조 이미지/컨셉 개념 없음, 배포 설정 없음.
- 기존 이슈: `StudioBridge.gs`가 번들 ORDER에서 빠져 bundle 테스트 실패 → v2.3에서 수정.
- 샌드박스에 NanumSquareRound 폰트가 없어 렌더 관련 테스트 7개가 `FONT_MISSING`으로 실패(환경 문제, 코드 아님; 폰트가 있으면 통과).

## 데이터 마이그레이션 (가산식, 비파괴)
- `schema.json` v2 → v3. 기존 파일은 삭제/덮어쓰기 없음.
- 기존 에피소드(EP01 등)는 "레거시"로 제품 레코드가 연결되고 참조 이미지는 사유와 함께 면제 처리되며, 대본은 그대로 승인 가능.
- 새 설정 키(`ai`, `providers`)는 기본값(mock)으로 채워짐 → 기존 동작은 그대로 mock.
- 승인·체크섬 보호는 그대로 유지.

## 백업 / 롤백
1. 업그레이드 전: `npm run backup` (master.key 제외 tar.gz).
2. 문제 시: 이전 배포로 복귀 후 `node scripts/restore-data.js <파일> --force` (기존 data는 `.before-restore-*`로 보존).
