# Seoul Home Reels Factory

> **v2.3**: 클라우드 배포(Docker) + Story Lab 파이프라인 — `docs/DEPLOYMENT.md`, `docs/STUDIO-V2.3.md`, `docs/MIGRATION-V2.3.md` 참고.

Instagram account: **서울에서 집꾸미기** — "우리 집에 들이기 전에, 먼저 보여드릴게요." Brand rules, content pillars and script logic: [docs/brand.md](docs/brand.md). Five-hook script workflow (H1–H5, operator picks the hook): [docs/five-hook-workflow.md](docs/five-hook-workflow.md). **Gemini is the production orchestrator** (plans; code and the renderer execute; Claude Code only maintains the code): [docs/gemini-orchestration.md](docs/gemini-orchestration.md).

Low-cost Instagram home-decor affiliate reels production workflow.

## Objective
Turn a verified product entry into three distinct 9:16 short-form video concepts, assemble approved assets with voiceover and captions, and prepare for human-reviewed Instagram publishing and ManyChat comment-to-DM.

## Stack
- Google Sheets: PRODUCTS, REELS, PERFORMANCE
- Gemini: production orchestrator — hooks and script, then (after approval) Flow scene prompts, voice pacing, subtitle/edit plan and the final video check
- Google Flow: clips generated **manually** (no public API) and imported through Drive
- Google Drive: per-reel clip folder with an upload tracker, plus licensed source assets and outputs
- Google Apps Script: Sheets menus and workflow coordination
- FFmpeg: low-cost final rendering
- ManyChat: post-specific keyword-to-affiliate-link automation

## MVP workflow
1. Enter a product in PRODUCTS.
2. Generate three distinct REELS records using verified facts only.
3. Review source permissions and create scene prompts.
4. Generate Flow clips manually and upload MP4 files to Drive.
5. Assemble clips, narration, subtitles, disclosure and CTA.
6. Review the finished MP4 before publishing.
7. Match the Instagram post with its correct ManyChat keyword and affiliate link.

## Implementation status
- [x] Sheets schema — [docs/sheets-schema.md](docs/sheets-schema.md)
- [x] Apps Script menu: selected PRODUCTS row → Gemini → 3 validated REELS rows — [`apps-script/`](apps-script)
- [x] Fact / number / duplicate-ID validation with errors recorded in the LOG sheet
- [x] Scene-level Google Flow prompts (Flow generation stays **manual**)
- [x] Approval state machine + AUDIT log; four human checkpoints (Issue #2)
- [x] iPhone approval dashboard (Apps Script web app) — [docs/iphone-dashboard.md](docs/iphone-dashboard.md)
- [x] FFmpeg renderer (Mac now, container later): Google Cloud TTS Korean narration, voice-synced subtitles, disclosure, CTA — [docs/rendering.md](docs/rendering.md)
- [x] Gemini production planner after `SCRIPT_APPROVED`: Flow prompts matched to verified product images, voice rate/pauses, subtitle emphasis, cuts; Drive folder + clip tracker; `fetch-clips`; advisory Gemini check of the final video — [docs/gemini-orchestration.md](docs/gemini-orchestration.md)
- [x] Mobile Flow media workspace: product photo upload, per-scene prompt/Flow link, chunked clip upload from iPhone, per-clip approval with versions, render only when every clip is approved (Mac re-checks IDs and checksums) — [docs/media-workspace.md](docs/media-workspace.md)
- [ ] ManyChat: stays a manual, operator-confirmed step

Cost safety (Gemini model check, 8 s Flow clip coverage, TTS ledger vs Google billing, quotas and alerts): [docs/cost-safety.md](docs/cost-safety.md).

Install: paste [`dist/ReelsFactory.gs`](dist/ReelsFactory.gs) into Extensions → Apps Script — step-by-step in [docs/setup.md](docs/setup.md). Mac renderer: [docs/mac-install.md](docs/mac-install.md).
Developers: `npm test` (Node ≥ 20, no dependencies); `npm run build` after editing `apps-script/`.

## First product
PRD-001 — 리템 우산꽂이 자석형 (magnetic umbrella holder).
Confirmed features: magnetic attachment to compatible steel surfaces; separate top and bottom pieces (190×55×50 mm and 188×55×82 mm); accommodates long and folding umbrellas; dark gray, gray, white variants.
Asset URL and actual reuse/AI-edit permissions must be verified, not inferred from marketplace availability.

## Collaboration
- ChatGPT: requirements, architecture, issue tracking, reviews.
- Claude Code: implementation and pull requests.
- Gemini: script and scene prompt generation.
- Operator: Flow generation, permissions, final content approval.

Never commit API keys, tokens, private customer data, or affiliate account credentials.

## Studio V2 (Muapi + redesigned dashboard)

`npm run studio` starts the local Studio at http://127.0.0.1:4173 (MOCK mode by default, no costs). It covers script →
storyboard → animation (Muapi image-to-video) → clip review → multi-character voices → 9:16 render → publishing pack, with
approval gates and cost controls. See [docs/studio-v2.md](docs/studio-v2.md) for the safety model, env variables and what is mock vs real.
