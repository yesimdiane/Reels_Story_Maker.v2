# Implementation report — Reels Factory (PR #1, #3, #4)

Status on 2026-10-08: none of the PRs is merged. They are stacked. Merge in this order, retargeting each to `main` after the previous one merges:

1. yesimdiane/reels_factory#1
2. yesimdiane/reels_factory#3
3. yesimdiane/reels_factory#4

## Test results (each PR at its own head)

| PR | Branch @ commit | `npm test` |
|---|---|---|
| #1 MVP | `claude/festive-mccarthy-idbmrn` @ 9aabad9 | 33 / 33 pass |
| #3 approvals + iPhone dashboard | `claude/approval-dashboard` @ f1e0dbb | 67 / 67 pass |
| #4 Flow prompts + renderer | `claude/render-pipeline` (latest) | 108 / 108 pass |

`tests/acceptance.test.js` (in #4) runs the operator's final checklist end to end. It uses the installed Apps Script bundle with in-memory Google services, and the real renderer with FFmpeg.

| Checklist item | Result |
|---|---|
| Existing Google Sheets data is preserved | ✓ PRODUCTS, including operator-added columns, is byte-identical after generation and dashboard use. MVP-era REELS rows and operator columns survive *시트 준비* and approvals (`webapp.test.js`). |
| Script approval works | ✓ |
| Flow prompts are generated after approval | ✓ None before approval; 5 after (one per scene). They are cleared when the script is reopened or edited. No extra API call. |
| Missing footage stops rendering | ✓ `ASSETS_REQUIRED` (exit 3), with `SHOTLIST.md` and `FLOW_PROMPTS.md` written. Zero TTS calls. |
| TTS is generated only after approval | ✓ No render job exists before approval and production start. Forged or unapproved jobs are refused (`GateError`). TTS is called once per line, only after footage passes, and is cached. |
| Final video approval works | ✓ Register MP4 → `VIDEO_REVIEW_PENDING` → approve → `READY_TO_PUBLISH` |
| No automatic Instagram publishing | ✓ The flow ends with a publishing pack and two manual confirmations. The only outbound call in the whole flow was the single Gemini script request. A static test shows there is no Instagram, Facebook Graph or ManyChat API anywhere in the code. |

## What each PR contains

### #1 — Sheets → Gemini → 3 validated scripts (Apps Script)
- **Menu:** a *릴스 팩토리* menu. Gemini `generateContent` with a JSON schema; the key is kept in Script Properties; the model is configurable (default `gemini-3.5-flash`).
- **PRODUCTS is read-only:** all columns are matched by header name (spaces and case ignored).
- **Validation:**
  - only verified facts may be used;
  - numbers in viewer-facing text must come from the facts;
  - exaggerated phrases and URLs are banned;
  - IDs and keywords must not be duplicated.

  On failure there is one corrective retry. Nothing is written, and the errors go to LOG.
- **Install:** one-file bundle `dist/ReelsFactory.gs`. The install review (blockers, missing-header migration) is documented in `docs/setup.md`.

### #3 — Approval state machine, AUDIT, iPhone dashboard
- **Statuses:** `SCRIPT_REVIEW_PENDING → SCRIPT_APPROVED → VIDEO_IN_PRODUCTION → VIDEO_REVIEW_PENDING → VIDEO_APPROVED → READY_TO_PUBLISH → COMPLETED`, plus changes-requested, rejected and failed branches.
- **Approval fingerprint:** approval stores the version and a fingerprint of every script cell. Any later edit, including one made directly in the sheet, blocks video work until the script is re-approved.
- **AUDIT sheet:** append-only, recording who, when, versions and a snapshot.
- **iPhone dashboard:** an Apps Script web app. Access is limited to reviewers in `RF_REVIEWERS`, and every public server function that writes or spends is guarded.
- **Manual publishing only:** the publishing pack puts the caption's first line as `[광고]` + the disclosure.

### #4 — Flow prompts, video-first renderer (Mac now, container later)
- **Storyboard:** each scene has a beat (HOOK→…→CTA) and one spoken line, which is also the subtitle.
- **Template matched to the operator's reference Reel**, measured from the actual video:
  - a cut every ~1.8 s;
  - single-line Korean captions, 48 px NanumSquareRound, regular weight, white with a thin dark edge, centered at 56%;
  - a small `댓글에 '{키워드}' 남겨주세요` line at 74.5%, **on**;
  - **Korean only**;
  - the disclosure in the caption only.
- **Flow prompts on approval:** written by code, one per scene (8 s clip). Each covers product appearance and dimensions (verified facts plus optional `제품 외형`), scene, interaction, camera, lighting and environment, duration, and consistency.
- **Footage:** one Flow clip per scene, so PRD-001 needs 5 clips, not 12 filmed cuts. The renderer takes evenly spread cuts from each clip.
  - Provenance is recorded automatically; marketplace sources are rejected.
  - AI footage is flagged so the operator checks it against the real product at video review (③). The publishing checklist adds Instagram's AI label.
- **Keyword:** optional PRODUCTS column `ManyChat 키워드` (e.g. `우산`), shared by one product's reels. A clash with another product is refused **before** the Gemini call.
- **Renderer order:**
  1. signed job;
  2. approved fingerprint;
  3. storyboard and pre-flight QC;
  4. footage (`ASSETS_REQUIRED`);
  5. **font check (`FONT_MISSING`)** and FFmpeg check;
  6. reuse of an existing render;
  7. TTS — budget-capped and cached per line;
  8. render;
  9. post-render QC: 1080×1920, H.264/AAC, 30 fps, every cut from a real asset, no solid-color or still clips, no repeated footage.
- **Batch mode:** `npm run render:pending -- --watch 10` renders every ready job in the Drive-synced folder. Repeated runs cost nothing.

## Pre-merge fixes (in #4)
1. **Gemini model:**
   - The default `gemini-3.5-flash` is a current GA Flash model with structured JSON output.
   - On HTTP 404 only (not billed), the script falls back once to `gemini-flash-latest` and logs a WARN.
   - Free check: menu **Gemini 모델 확인 (무료)** or `npm run gemini:check`. One real generation: `npm run gemini:check -- --generate`.
2. **8 s Google Flow clips:**
   - Scenes are capped at 2–6 s, which is ≤ 7.5 s usable per clip.
   - Flow prompts are generated per clip (`S3b.mp4` if a scene ever needs two).
   - The renderer plans clips from the narration before TTS (QC `flow.coverage`) and re-checks with the real voice after TTS. An uncovered scene is `ASSETS_REQUIRED`, never a render with repeated or missing footage.
3. **TTS cost safety:**
   - Lines are cached as they arrive, so an interrupted run repays only missing lines.
   - Google is retried only on 429/503, never on a 500 or a dropped connection.
   - Every sent attempt is written to the ledger before the answer.
   - Per-line locks stop parallel runs from buying the same line, and `pending --watch` passes never overlap.
   - The ledger is documented as a local counter, not the Google bill, along with quota, budget-alert and hard-stop guidance.

   See [cost-safety.md](cost-safety.md).

## Cost safety (unchanged by every change)
- **Gemini:** only for scripts (one call, plus at most one retry).
- **Flow prompts:** generated by code.
- **Google TTS:** only after a signed, approved, in-production job with complete, valid footage and an installed font. Cached per line, with per-job and monthly character caps. Re-renders and template changes cost $0 in TTS.
- **Google Flow credits:** the operator's manual step, only after approval, one 8 s clip per scene.

## Not verified yet (needs the operator's accounts or Mac)
- **Google services:** no real Google Cloud TTS call and no real Gemini call have been made from this environment (no keys here). Both are tested with request-shape mocks. Run `npm run gemini:check` on the Mac to verify the model against the real API.
- **Mac and cloud:** not run on macOS; the Dockerfile has not been built.
- **Dashboard:** not deployed to a real Google account.
- **Footage:** no real PRD-001 footage exists yet, so the sample stops at `ASSETS_REQUIRED` as designed.
- **Flow prompts:** the prompts follow Flow's documented 8 s clip length. Real Flow output may need wording tweaks after the first products.

## Mac installation
See [mac-install.md](mac-install.md). Google Sheets / Apps Script install: [setup.md](setup.md). iPhone dashboard: [iphone-dashboard.md](iphone-dashboard.md).
