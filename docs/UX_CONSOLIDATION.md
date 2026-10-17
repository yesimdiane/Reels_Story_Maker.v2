# Script Studio & Storyboard UX consolidation — audit and progress

## Phase 1 — audit (what exists today)
**There is already one copy of each piece of scene data.** The two studios are different views over the same episode record, so no schema merge or data migration is needed for the work below.

| Data | Where it lives | Edited in | Notes |
|---|---|---|---|
| scene id/order/title/duration, `visual`, `action`, `emotion`, `placement`, `showsProduct`, `characters`, `inserts`, `startImage` | `ep.scenes[]` | Script Studio (all), Storyboard (visual text in 고급 설정, product toggle/placement, start image, refs) | `visual` can be edited in both places → duplicate control, one field |
| dialogue / subtitles | `ep.lines[]` (`en` spoken, `ko` subtitle, `speaker`) | Script Studio | generation uses the speaker's voice |
| image/video prompt | `ep.prompts[sid]` (`video`, `negative`, `rev`, `edited`, `source`) | Storyboard | manual edits are flagged `edited` and kept |
| 0.5 s timeline | `ep.motion[sid].beats` (+history) | Storyboard (고급) | single timeline; also used by prompt composition (`animplan.compose`), readiness and generation → already shared |
| B-cuts | `ep.scenes[].inserts` (crop cuts) and `ep.broll[]` (B-roll stills, AI image generation, approval) | Storyboard | |
| audio | `ep.voice.lines[lineId]` + `ep.audioApprovals[sid]` | Storyboard (오디오 확인 · 승인) | |
| sound effects | `ep.sfx[]` (scene-bound, `offsetSec`) | Storyboard (효과음 · 씬 합본) | HeyGen: catalog **search** only (no generation) |
| approvals | `approvals.script`, `approvals.storyboard` (v2 per scene/field), scene approval, `audioApprovals`, `sceneFinal`, clip `approvedVersion` | | unrelated metadata/UI changes do not invalidate (tests: `readiness-workflow`) |

## Done in this PR
- **Approved scene gallery** (Storyboard top): story-ordered 9:16 thumbnails, approval state (sage ✓ approved / clay unapproved / dashed rose missing — missing ones are highlighted, never hidden), compact `+N` B-cut count (B-cut images are not listed), click opens the scene, 🔍 full-size preview with prev/next, **비교** side-by-side comparison with scene pickers and the original uploaded filename. Reuses stored assets only; it never generates anything.
- **Approval UX**: a scene with an approved start image collapses its image/prompt editors (참조 이미지, 제품, 프롬프트, 고급) into a compact sage summary with `이미지·프롬프트 수정 열기`; the later production steps (오디오, 애니메이션, 컷, 효과음·합본) stay available. Readiness/jump links reopen the collapsed section automatically.
- Mobile: the gallery scrolls horizontally with snap; one scene editor at a time (existing).
- Tests: `tests/scene-gallery-browser.test.js`.

## Not done yet (honest list)
- Script Studio three-section redesign (Visual Direction with visible vs reference-only characters and B-cut concept tab; reorderable dialogue/subtitle/action/expression/camera/SFX assets with duplicate + drag; 0.5 s CCTV-style beat editor inside Script Studio).
- Script-side SFX library with preview (the search/upload/built-in sources already exist in the Storyboard scene panel and can be reused).
- Removing the duplicated `visual` text control from Storyboard 고급 설정.
- Storyboard image-prompt builder with structured sections (background, characters, body actions, emotions, optional facial/camera panels, recommended shot types), start-image "delete generated image" (must keep reference assets), voice selection per scene in the audio panel.
- Dedicated regression run of the PRD-001 episode through every step.

These are separate PRs; each keeps `ep.*` as the single source of truth and adds no paid call without its existing confirmation dialog.

## PR A — Script Studio consolidation (this branch)
Script Studio's scene editor now has three sections over the same canonical episode data:
1. **① 시각 연출** — tabs *장면 연출* / *B컷 계획*. Fields: `scene.look {background, lighting, atmosphere, style}`, `scene.pose {body, pose}`, character **roles** per cast member (등장 = `scene.characters`, 참조만 = `scene.referenceOnly`, 없음) taken from the story's cast, the existing `visual`/`placement`/product toggle and 씬 다시 생성하기. A *reference-only* character is never also visible, is named in image/video prompts as "do not draw", and no reference image of it is attached (attaching would risk it appearing). B-cut planning edits the **same `ep.broll[]` records** Storyboard develops into images (kinds extended: 제품 시연, 주변 디테일, 전환 샷; add / edit / duplicate into a free slot / delete / reorder). No image is generated here.
2. **② 대사 · 자막 · 액션 · 효과음** — dialogue + subtitles (`ep.lines`, now with duplicate and drag-reorder), optional narration, **performance elements** (`scene.elements`: 몸 동작 · 감정 · 카메라, and collapsed 눈 · 눈썹 · 입 · 표정; add / duplicate / delete / drag-reorder, optional timing + character). `scene.action`/`emotion` are kept in sync from the elements so every older reader (prompts, generation, approvals) is unchanged; older scenes get their action/emotion text shown as elements on first open. Sound effects use the **same editor component and `ep.sfx[]` records** as Storyboard (`sfx-editor.js`): built-in, upload, HeyGen catalog *search* (no SFX generation exists).
3. **③ 고급 설정** — duration, estimated dialogue time with overflow warning, and the **shared 0.5 s beat timeline** (`beat-timeline.js`, the same component and `ep.motion[sid].beats` as Storyboard) with an objective, CCTV-style writing hint.

Migration impact: none. New scene fields are optional; absent on existing episodes (PRD-001 scenes unchanged). Storyboard approval hashes include `look`/`pose`/`referenceOnly` only when they have content, so existing approvals stay valid; performance elements alone do not invalidate storyboard approval.

Tests: `script-studio-consolidation.test.js`, `script-studio-consolidation-browser.test.js`.
Limitations: element timing is stored but not yet turned into beats automatically (PR C); template (free) video prompts do not yet include look/pose lines (Gemini and start-image prompts do).

## PR (Storyboard consolidation) — what actually changed in the Storyboard
**Why the UI looked unchanged:** two separate causes were found by reproducing the app from `main` with a headless browser (`before-*` runs):
1. *The running deployment was older than the merged work.* The reported layout (참조 이미지 · 제품 등장 · 이미지/영상 프롬프트 · 애니메이션 · 컷/B-roll · 고급) has none of the panels added by #60/#61 (오디오 확인 · 영상 클립 생성 · 효과음 · 합본), so it predates even those. To make this checkable the app now shows its build id: bottom of the left rail (`v2.3.0 · <commit>`), `GET /healthz → build.shortSha`, `/api/state → build`. On Railway the commit comes from `RAILWAY_GIT_COMMIT_SHA` (or `RF_BUILD_SHA`).
2. *A real bug in the #62 collapse:* scenes whose approved start image is a character reference marked as a demo/placeholder were never collapsed (`!img.placeholder`), so their editors stayed open. Collapse now applies to every approved start image (the summary shows a "데모 임시 이미지" note). A readiness/jump link that reopens an editor also keeps it open for that session (by design).

**New scene editor (3 sections, replacing the flat panel list):**
- **① 이미지 제작** — start image (preview, 만들기/다시 만들기 [cost-confirmed as before], 올리기, 크게 보기, 삭제, 승인/취소) · 환경·캐릭터(등장/참조만)·포즈·몸동작·감정 (the same `scene.look/pose/referenceOnly/elements` Script Studio edits) · 얼굴 표정 and 카메라·샷 (collapsed; 8 recommended shot types) · 참조 이미지 (character + product, merged) · 이미지 프롬프트 (automatic from the fields; manual edits are kept and never overwritten; code re-adds cast/identity/product/"no text" rules on generation).
  - Delete = removes only that scene's start-frame record; the file moves to `startframes/_deleted/` (recoverable); an approved frame must be un-approved first; character library and product images are never touched (test-covered).
  - Approved start image → the whole section collapses to a sage summary (크게 보기 · 승인 취소 · 이미지 편집 열기).
- **② 애니메이션 · 오디오 준비** — animation prompt (+ hand-off card to Animation Studio, which owns model/cost/generation/approval) · the shared 0.5 s beats · 대사 · 목소리 (per-speaker voice picker from the synced catalog; never regenerates audio by itself) · 오디오 생성·미리듣기·승인.
- **③ B-roll 제작** — 컷 · B-roll (concept, prompt, image generation, preview, approval; existing cards).
- Below: 효과음·씬 합본·최종 승인 and a slim 고급 설정 (read-only duration / measured dialogue; the duplicated 시각 설명 textarea, frame upload, reorder arrows and the duplicate reference picker were removed — the data is untouched and edited in Script Studio).
- The Storyboard no longer contains video-generation controls; readiness items for clips now open the scene in Animation Studio.

Screenshots: `docs/screenshots/storyboard-unapproved-scene.png` (editor open), `storyboard-approved-scene.png` (approved → summary).

**Remaining work (not done):** separate product-reference chooser beyond the existing product toggle/placement; per-line voice preview from the catalog (only the audio panel's generated audio can be played); B-roll concept editing still uses the existing B-roll cards (Script Studio has the concept planner); resolution of the deployed app's version needs the Railway deploy to be refreshed on your side.
