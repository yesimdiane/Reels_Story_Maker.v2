# 캐릭터 라이브러리 & 유니버스

시리즈마다 다른 출연진을 쓰기 위한 구조화 데이터입니다. 프롬프트에 캐릭터를 박아 넣지 않고, 선택한 유니버스와 캐릭터 프로필에서 코드가 프롬프트 블록을 만듭니다.

## 데이터 (`/data/characters.json`, schema 2)
- **universes[]**: id, 이름, 설명, 기본 스토리 스타일, 기본 언어, 시각 스타일, 활성/비활성. 기본 제공: `jackdiane`(Jack & Diane), `gregory-cats`(Gregory Cats). 새 유니버스는 만들기·수정·삭제 가능(기본 제공·캐릭터가 있는·프로젝트가 쓰는 유니버스는 삭제 불가, 비활성화만).
- **characters[]**: 기존 필드(외모=`look`, 참조 이미지, 음성) + `universeId`, 역할, 성격, 말투, 말버릇(`catchphrases`), 관계(`relationships`), 행동 규칙, 금지 행동(`negativePrompts`).
- 초기 캐릭터: Jack, Diane(기존 그대로), Cloud(Ragdoll, 책임감 있는 장남), Louie(Korean shorthair, 장난꾸러기 둘째), Lucy(Korean shorthair, 막내 공주). **고양이 외모는 지어내지 않고** 승인된 참조 이미지로만 정의합니다.
- Jack의 HeyGen `d51329d2…`는 **Identity ID** 칸에 저장됩니다. Voice ID로 취급하지 않으며, Voice ID는 직접 입력하고 HeyGen 목록으로 확인해야 쓰입니다.

## 마이그레이션
기존 볼륨 파일을 읽을 때 한 번 schema 2로 올립니다. **추가만** 하고 이미 있는 값(수정한 외모·성격·참조 이미지·음성 설정)은 덮어쓰지 않으며 여러 번 실행해도 결과가 같습니다. `cast`가 없는 기존 컨셉·에피소드는 Jack & Diane 출연진으로 동작합니다.

## Story Lab
"캐릭터 & 유니버스 선택"(카테고리 선택 앞): 유니버스 카드 → 캐릭터 카드(복수 선택, 썸네일·이름·역할) → 게스트/내레이터(고급) → 프로필 추가·편집. 선택은 제품별로 서버에 저장되고 모든 스토리 요청과 컨셉에 `cast`로 기록됩니다. 선택하지 않은 반복 캐릭터는 프롬프트에서 금지됩니다.

## 에피소드 · 대본 · 스토리보드
- 에피소드에 `universeId`, `cast`, `characters`가 저장되고 대본의 장면 출연·대사 화자는 그 출연진으로 제한됩니다(밖의 캐릭터는 검증 오류 `OUT_OF_CAST`). 장면마다 출연 캐릭터를 바꿀 수 있습니다(씬 저장으로 반영).
- Jack & Diane 외 유니버스의 대본 프롬프트는 캐릭터 중립 문구(코드)로 바뀌고 화자 ID 목록은 출연진에서 만듭니다.

## 렌더 · 음성
음성은 화자별 캐릭터의 Voice ID를 라이브러리에서 읽으며 다른 캐릭터의 목소리로 대체하지 않습니다. 화면에 나오는/말하는 캐릭터의 참조 이미지·Voice ID가 없으면 비디오 스튜디오에 렌더 전 경고가 표시되고, 음성 생성은 기존대로 차단됩니다.

## 비용 안전
프로필·유니버스·출연진 저장은 AI/유료 호출이 없습니다. 스토리 생성은 기존처럼 예상 비용 확인과 유료 확인이 필요하며(견적에 출연진 표시), 대본 승인 전 이미지·영상·음성 생성 게이트는 바뀌지 않았습니다.

## Mandatory character references in the Storyboard

The approved Character Library images are the single source of visual identity for every scene.

- **Default reference** = the character's first *approved, non-placeholder* image. Placeholder or AI-substitute images are never shown or used when an approved image exists; if none exists, generation stops.
- **Attached per scene**: only the characters in that scene. At project creation the chosen asset ids are stored in `ep.cast.refAssets` (`characterId:refId`). A scene-specific choice is stored in `ep.sceneRefs[sceneId][characterId]`, so it survives refresh, editing, reordering, regeneration and reopening (and future cloud rendering — only ids/hashes are stored; files stay in the library, nothing is duplicated).
- **Storyboard → 캐릭터 참조 이미지** (open by default): thumbnail, name, asset id, status (승인됨 / 승인 필요 / 임시 이미지 / 참조 없음 / 파일 없음), **원본 보기**, **참조 변경** (choose another approved image for this scene only; the library original is never modified). A generated start frame made from other references is flagged as out of date.
- **Validation before any visual generation** (`studio/lib/charrefs.js`): references exist, are approved, the files are readable, and the image provider accepts reference images. Otherwise: `Character reference missing: Jack. Please upload or select a reference image.` — nothing is billed and no substitute is generated.
- **What the image model receives**: the real image bytes (multimodal inline data) of the scene's characters, labelled with the asset id, plus per-character instructions ("Use the attached Jack character image (jack:ref_x) as the authoritative visual reference … change only expression, pose, clothing condition, camera angle and environment") and the approved appearance text. Product reference images are added only when the scene shows the product.
- **Text-only models** (story/script/scene rewrite) get written appearance only, labelled "this text model has NOT been shown the reference images". Images are never claimed as inspected by a text model.
- **Regenerating one scene's image** reloads that scene's references, leaves other scenes and the library files unchanged. Video (image-to-video) uses the approved start frame built from these references; in live mode the video gate also requires the references.
- **Cost**: choosing/viewing references is free. Image/video generation keeps its gates: script approval, cost estimate and confirmation.

## Reference selection: up to 3 images PER CHARACTER

- Each character selects **1–3 approved images** (`referenceSelection`, ordered; the first is the primary). The limit is per character, not per scene: a Jack + Diane scene sends up to 3 + 3 character images, plus the product's own reference images (counted separately). Unselected uploads are never deleted; revoking approval or deleting an image removes it from the selection. No selection yet → the first approved image.
- Character Library: compact ~92 px thumbnails, the exact uploaded filename beneath (ellipsis, full name on hover/focus), full-size viewer, sage border + ✓ + order on selected images, a counter "선택 n/3", further selection disabled at 3. Storyboard → 캐릭터 참조 이미지 shows each character's selected images and lets a scene use its own ordered 1–3 choice (library untouched).
- **Model input limits are per model** (`studio/lib/reflimits.js`): `gemini-2.5-flash-image` 3, `gemini-3-*-image` 14 (counts reported by third-party documentation — confirm in Google's official docs); an unknown model is "unverified" (not enforced, and said so); override per model in `settings.ai.refLimits[model] = { maxImages, maxTotalBytes }`. Before every image request (start frames, B-roll) the total of selected character images + product images, the formats (PNG/JPEG/WebP) and the total size are checked. Over the limit: the request is refused with the counts and nothing is trimmed or swapped; a dialog lists every reference by filename so the user can deselect **for this request only** (each character and the product keep ≥ 1). The Character Library selection is never changed, and no paid call happens before the check passes.
- Video generation (Muapi image-to-video) receives one image — the approved start frame built from these references.

## B-roll approval colours
An approved B-roll card turns soft sage green (the approval palette) with a green 승인됨 badge immediately; revoking restores the cream card; pending stays cream. Green appears only when the image file is really accessible — an approved B-roll with a missing/inaccessible image shows an attention state (approval history kept, warning, render blocked).
