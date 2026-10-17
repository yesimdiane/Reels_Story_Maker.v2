
## Scene start images (AI)
Dashboard (오늘의 제작 현황 → "장면별 시작 이미지") and Storyboard (모든 장면 / 장면별 "시작 이미지 만들기") create one 2D anime/webtoon first frame per scene with the Gemini image route ("제품 이미지 생성" task in Settings).
- Inputs: the scene's visual/action text, the approved **non-placeholder** character references of the scene's cast (exact head-count rules), and — only when the scene shows the product — the approved product reference images and verified facts.
- Backend gates: the script must be **approved**; the estimated cost is shown and must be confirmed; spend limits apply; all pre-flight problems (e.g. no real character reference) are reported before the first paid call.
- Results are saved as **unapproved** start frames; approve each one in Storyboard ("이 프레임 승인") before video generation can use it. An approved frame is never overwritten; a scene that already has an AI frame is skipped unless you pick "다시 만들기"; files are never deleted.
- Each scene is saved before the next paid call, so a failure part-way keeps (and never re-bills) the frames already made.
- Blocker: needs a Gemini key and an image-capable model; without them the buttons show the blocker (no placeholder frame is created).

## 이미지 붙여넣기 · 자르기 (Product Studio → 참조 이미지)

- **추가 방법:** `Cmd+V`(Mac) / `Ctrl+V`(Windows)로 스크린샷 붙여넣기, 끌어놓기(데스크톱), `클립보드에서 붙여넣기` 버튼, `사진 보관함 · 파일에서 선택`(iPhone Safari에서도 항상 동작하는 기본 방법).
- **저장 전 미리보기:** 즉시 썸네일이 보이고 앞/뒤 이동(←→), 대표 지정(★), 자르기(✂), 제거(✕)를 쓸 수 있습니다. `N장 저장`을 눌러야 서버에 올라갑니다.
- **자르기:** 8개 핸들 + 자유/1:1/4:5/9:16/원본 비율. 해상도는 줄이지 않고 원본 형식 그대로 저장합니다(PNG 무손실, JPEG/WebP 0.95). iOS는 약 1,670만 픽셀 이상 캔버스를 못 그려 그보다 큰 이미지는 자를 수 없다고 안내합니다.
- **검증(클라이언트+서버):** PNG/JPEG/WebP(내용으로 판별), 10 MB 이하, 짧은 변 100px 이상 · 긴 변 8000px 이하. 제품당 업로드 최대 10장.
- **중복:** 같은 바이트(SHA-256)는 한 번만 저장됩니다. 같은 스크린샷을 다시 붙여넣으면 건너뜁니다. 삭제한 이미지를 다시 올리면 같은 기록이 되살아납니다.
- **승인 보호:** 승인된 이미지(또는 승인된 참조 세트에 포함된 이미지)를 교체/삭제하려면 확인이 필요하고, 그러면 참조 세트를 다시 승인해야 합니다. 순서·대표 지정은 승인에 영향이 없습니다.
- **AI 없음:** 업로드/붙여넣기/자르기는 AI 이미지 생성을 호출하지 않습니다 (테스트로 확인).
- **알려진 한계:** 일부 브라우저는 `클립보드에서 붙여넣기` 버튼(Async Clipboard API)을 지원하지 않습니다. 이때는 Cmd/Ctrl+V 또는 파일 선택을 쓰세요. 실제 iPhone Safari에서의 붙여넣기 팝업은 직접 확인하지 못했습니다(Chromium 에뮬레이션만).

## Storyboard: AI B-roll images

B-roll suggestion → **AI 이미지 생성** → preview → edit prompt / regenerate → approve → video editor.

- The dialog loads an editable draft prompt (B-roll shot, scene visual direction, composition, 9:16, style). Reference rules are appended automatically: real approved **character** images (close-ups/reactions, or when the shot names a cast member) and real **product** images (scenes that show the product) — each switchable per B-roll. Missing references show an actionable warning and block the call; nothing is substituted.
- Paid image call only after: script approved, estimate shown, explicit click (+ unknown-cost checkbox if no price). Suggesting B-rolls never generates anything. Failures are recorded on the card and never retried automatically; *insufficient credits*, *rate limit*, *unsupported model* and *auth* are reported separately.
- Result = a still saved as **검토 대기** (never auto-approved). Click the thumbnail for a larger preview; upload replaces; **거절**, **삭제**, **승인** (needs an actual image; saves the approved asset id `BRn:<hash>` with the B-roll and scene). Regenerating over an approved image needs an explicit "replace" confirmation, withdraws the approval and keeps the old file.
- Approved stills are what the video editor layers (pan / zoom / crop / timing). No video is generated.

### B-roll preview and asset state (root cause + rules)
**Cause of "이미지 있음" + "미리보기 이미지 없음":** the Storyboard card read the scene's *raw stored* B-roll record (`scene.broll`), which has no `imageUrl` and a stored `asset: "ready"` flag set when a reference was saved. The enriched view (URL, asset id, errors) only existed in `derived.broll`, which the card did not use. A reference could also point at nothing (e.g. a scene start frame that did not exist) and still count as "ready".

**Now:** the card uses the enriched view. "Ready" is decided from the real file (`sba.assetHealth`): none · missing · inaccessible (unreadable, not an image, checksum mismatch) · ready (+ width×height, size) — never from the asset id alone. `imageUrl` is handed out only when ready (`/media/broll/<episode>/<id>?v=<hash>`, resolved server-side for every reference type; otherwise 404 with the reason). The card shows loading / ready / missing / inaccessible / generation failed, the prompt, reference thumbnails, a zoomable full-size preview with dimensions, generate/regenerate, upload/replace, approve/revoke, reject, delete. If the browser still cannot load the image the card says so instead of a broken picture.
- Approval requires an accessible image. An approved B-roll whose file disappears keeps its approval and `approvedAssetId`, is flagged "확인 필요", and blocks every render that needs it (`BROLL_IMAGE_MISSING` with the reason).
- AI generation shows its steps (save prompt → generate → verify the saved file), refuses to report success if the saved image is not accessible, then shows the result with 승인 / 다시 생성 / 닫기. It is never auto-approved and nothing is regenerated by viewing, refreshing or navigating.
