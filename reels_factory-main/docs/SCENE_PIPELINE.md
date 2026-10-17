# 씬별 제작 흐름 (Scene pipeline)

Storyboard의 각 씬은 아래 순서로 진행합니다. 모든 승인은 **승인 취소**가 가능하며, 취소해도 파일은 지워지지 않습니다.

1. **이미지 · B컷** — 시작 이미지 승인, B컷(B-roll) 이미지 생성·승인(또는 거절). 이미지 승인 취소 버튼 있음.
2. **오디오 확인 · 승인** — 씬 단위로 대사 음성 생성(LIVE 모드는 글자 수 확인 후), 대사별 재생, 승인/승인 취소. 대사가 없는 씬은 승인이 필요 없음. 대사·목소리가 바뀌면 "수정됨"이 되어 다시 승인해야 함.
3. **애니메이션(영상 클립)** — 승인된 오디오가 있어야 생성 가능(`AUDIO_NOT_APPROVED`). 클립 승인 취소 가능(`decision: "unapprove"`).
4. **효과음 · 씬 합본** — 씬 안에서 효과음 추가(씬 시작 기준 초 단위 `offsetSec`, 볼륨 dB), 무료 로컬 FFmpeg로 합본 미리보기(영상 클립 + 오디오 + 컷/B컷 + 효과음) 생성.
5. **씬 최종 승인** — 합본을 확인한 뒤 승인. 이후 클립/오디오/컷·B컷/효과음 중 하나라도 바뀌면 "승인 후 바뀜"으로 표시하고 바뀐 부분 이름을 알려줌.
6. **최종 렌더 + 대사 자막** — 모든 씬이 최종 승인된 경우에만 가능(`SCENE_NOT_APPROVED`). 렌더 기록에 씬별 해시를 저장하며, 이후 씬이 바뀌면 최종 영상 승인이 거부됨.

## 효과음 출처
- **내장 기본음**: FFmpeg로 만든 whoosh/pop/click/ding/thud/snap/sparkle (무료, 로컬).
- **직접 업로드**: WAV/MP3/M4A/OGG, 5 MB 이하.
- **HeyGen 카탈로그 검색**: `GET /v3/audio/sounds?type=sound_effects` 검색 결과를 미리듣고 추가. **새로 생성하는 기능이 아닙니다.** 크레딧 사용·상업적 이용 조건은 HeyGen 계정에서 확인하세요(문서 확인 불가 상태). 다운로드 URL은 서버가 검색 응답에서만 가져오며(클라이언트가 준 URL은 받지 않음) https만 허용합니다. 키는 저장/노출되지 않습니다.

## 알림 클릭 → 해당 위치
렌더링 준비 상태의 모든 알림(대기/문제)은 카드 전체가 클릭·키보드로 동작하며 해당 씬의 정확한 섹션(audio / clips / cuts / compose / prompt / motion …)으로 이동합니다. 씬이 없는 항목은 대본·스토리보드·설정으로 이동합니다. 각 씬 상단의 5단계 표시 칩도 해당 섹션으로 이동합니다.

## API
`POST /api/episodes/:id/scenes/:sid/audio/{estimate,run,approve,revoke}`, `.../sfx/{builtin,upload,heygen}`, `POST /api/episodes/:id/sfx/search`, `POST /api/episodes/:id/sfx/:fid/update`, `.../scenes/:sid/compose`, `.../final/{approve,revoke}`, `POST /api/episodes/:id/storyboard/revoke`, `POST .../clips/:sid/:v/review {decision:"unapprove"}`.
