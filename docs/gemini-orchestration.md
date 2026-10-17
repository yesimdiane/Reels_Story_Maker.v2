# Gemini as the production orchestrator

**Gemini plans. Code executes. Claude Code only develops this repository.** In normal operation Claude Code is not involved at all.

| Role | Who | What |
|---|---|---|
| Decision and planning engine | **Gemini** (API) | Five hooks + script, scene-by-scene Google Flow prompts, speaking pace and pauses, subtitle emphasis, cut structure, what to check in each clip, and the check of the finished video |
| Executors | **Apps Script** (Sheets, Drive, dashboard) and the **renderer** (Google Cloud TTS, FFmpeg) | All API calls, file operations, TTS and rendering. Gemini never runs anything and never writes commands |
| Decision-makers | **You** | The four checkpoints. Nothing publishes or sends links without you |
| Developer | Claude Code | Writes and maintains the code in `yesimdiane/reels_factory`; not part of production |

## The pipeline

```
① PRODUCTS row (verified facts, link, permission, verified product images)        ← you (checkpoint 1)
② Gemini: five hooks + recommended hook + script                                   [Apps Script → Gemini]
③ you choose the hook, review, approve → SCRIPT_APPROVED                          ← you (checkpoint 2)
══════════ cost gate: nothing below exists before SCRIPT_APPROVED ══════════
④ Gemini production plan (1 call, with the verified product images)               [Apps Script → Gemini]
     · scene-by-scene Google Flow prompts (match the product images)
     · voice: speaking rate and pause per line (the text cannot change)
     · subtitles: emphasis words · edit: cuts and framing per scene
     · what to verify in each generated clip, and risks
⑤ Drive: folder  Reels Factory / <상품ID> / <릴스ID>  + clip tracker (S1.mp4 … )  [Apps Script → Drive]
⑥ You generate the clips in Google Flow by hand and upload them to that folder
⑦ Renderer: fetch-clips (Drive → local) → TTS (Google Cloud) → timing check → FFmpeg → QC
⑧ Gemini final check: one frame per scene + the product images vs. the approved storyboard   [renderer → Gemini]
⑨ You review the video ← checkpoint 3 → publishing pack → Instagram + ManyChat by hand ← checkpoint 4
```

## What Gemini decides and what code enforces

Gemini returns a declarative **production plan** (JSON). Code validates it in Apps Script, stores it bound to the approval fingerprint, ships it inside the signed render job, and the renderer validates it **again** before use. Anything out of range is skipped, never trusted.

| Gemini decides | Hard limit enforced by code (twice) |
|---|---|
| Flow scene description (English, action/place/camera) | ≥ 40 characters, English, no URLs, none of the unverified attributes in `PRODUCTION.SCENE_PROMPT_FORBIDDEN` (e.g. refrigerator, drill, screw, adhesive, waterproof). The code-built scaffold stays in every prompt: product identity, verified features only, no text/logo/watermark |
| Product look (`product_visual`) | Written from the operator's verified images; non-empty, ≥ 1 "must match", no banned or exaggerated phrases |
| Speaking rate per line | 0.90–1.15. The **spoken text must equal the approved narration** exactly (`{키워드}` included) — Gemini cannot rewrite the script. A plan whose text differs is ignored entirely |
| Pause after a line | 0–0.6 s |
| Subtitle emphasis words | ≤ 2 per scene, must appear in that scene's line. Shown on screen only if `template.subtitle.emphasis.enabled` (off: the reference Reel uses plain white captions) |
| Cuts per scene | Cut length 1.0–3.5 s (same limits as the template); each framing non-empty |
| What to verify in each clip, risks | Shown in the dashboard and used by the final check |

If a plan is invalid, Gemini gets **one** corrective retry with the exact errors; if that fails nothing is saved. The code-built Flow prompts and the default render keep working without a plan (backward compatible).

### Gates before any Gemini planning call

1. The script is `SCRIPT_APPROVED` (or later in production) **and unchanged** since approval (fingerprint).
2. REELS has `제작 계획(JSON)` and `에셋 현황(JSON)` (run **시트 준비**).
3. PRODUCTS lists **verified product images** in `검증된 제품 이미지` and Apps Script can read them (PNG/JPEG/WebP, ≤ 3 MB each, ≤ 10 MB total, ≤ 4 images). **Product-specific visuals must match real product images**, so there is no plan without them. The images are the only source of the product's look.

Each failure is reported before Gemini is called. Withdrawing the approval (`대본 승인 취소`) or editing the script voids the plan.

## Google Flow: is there an official API?

**No public Flow API.** Third-party documentation says Google offers Flow as a web app only and issues no Flow API key ([Veo Flow API manager listing](https://chromewebstore.google.com/detail/veo-flow-api-%E2%80%94-google-flo/nhpbdcgjjbnoalanbgaeonkhbkbldmja), [useapi.net](https://useapi.net/docs/api-google-flow-v1)); the tools that automate Flow are unofficial UI automation (e.g. [gflow-cli](https://github.com/ffroliva/gflow-cli)) and can break or violate terms. I could not confirm Google's own position on its pages, so treat this as "no official API found".

The **official** programmatic route to the same model family is Veo through the Gemini API ([Veo 3.1 in the Gemini API](https://ai.google.dev/gemini-api/docs/veo), [video generation](https://ai.google.dev/gemini-api/docs/video)): asynchronous, separately billed, **not** covered by Flow credits.

Decision: Flow generation stays **manual** (`PRODUCTION.FLOW_PROVIDER = 'manual'`), and clips come back through Google Drive. Nothing here claims Flow is available through an API, and no paid video generation is wired in. Veo-by-API could be added later as an explicit, cost-gated provider; that needs your decision on budget and rights first.

> **Update (issue #12):** clips are now uploaded, versioned and approved per scene from the iPhone dashboard, and the render job needs every clip approved — see [media-workspace.md](media-workspace.md). The tracker below remains the fallback path (Drive app upload + *이 파일 연결*).

## Google Drive asset planning and tracking

- **Prepare:** *Drive 폴더 준비* creates `Reels Factory / <상품ID> / <릴스ID>` (root can be pinned with Script Property `RF_DRIVE_FOLDER_ID`) and lists one tracker row per Flow clip with its expected file name (`S1.mp4`, `S3b.mp4` …).
- **Sync:** *Drive 동기화* reads the folder: `✓` uploaded (any case, `.mp4/.mov/.m4v`, newest upload wins) or `○` missing; unexpected files are listed and ignored. Stored in `에셋 현황(JSON)` and shown with a folder link. Tracking is not an operator decision, so it adds no AUDIT rows (LOG only).
- **Import:** `node renderer/cli.js fetch-clips --job <file>` verifies the signed job, then downloads only the clips the job needs from the job's Drive folder into `renderer/clips/<릴스ID>/`. Read-only; names are matched against a strict pattern, so a file called `../x.mp4` is ignored.
- The renderer still analyses every clip (no solid colours, stills, low resolution) and still stops with `ASSETS_REQUIRED` if something is missing. Missing footage is never replaced by slides or generic or AI stand-ins.

## Voice (Google Cloud TTS)

Gemini plans the delivery; the renderer synthesises it. The per-line rate is part of the TTS cache key, so a new rate is a new recording while old recordings stay free. The text is always the approved narration, the cost estimate and budget guards (`RF_TTS_MAX_CHARS_PER_JOB`, monthly limit) are unchanged, and TTS still happens only after every other gate passes.

## Final check of the video (Gemini, advisory)

After a render that passed QC, the renderer extracts one frame per scene and asks Gemini to compare it with: the approved storyboard line and visual, the plan's "verify in clip" notes, the verified product images, and whether the "AI 시뮬레이션" label is visible. **Code decides the verdict** from what Gemini reports: `fail` (scene doesn't match, product missing in a product scene or different from the images, missing AI label), `review` (partial/unclear match, subtitle differs, or **no product image to compare — that can never pass**), else `pass`. It is written to `manifest.json` (`qc.geminiReview`) and into `reviewNote`.

It is **advisory**: it never approves a video, never fails a render, and your video approval (checkpoint ③) stays manual. It needs `GEMINI_API_KEY` in `renderer/.env` (never Git); it is skipped for `--preview` renders, with `--no-ai-check`, and when reused renders are returned. Product images come from `renderer/refs/<상품ID>/` or the Drive IDs in the signed job (Drive access as for `fetch-clips`).

## PRD-001

The reference storyboard is `FIXTURE_PRD_001_GEMINI_RESPONSE` (6 scenes, 24 s) and the reference plan is `FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE` in `apps-script/Fixtures.gs` — hand-written to document and test the format, **not recorded Gemini output**. **Before planning PRD-001 you must add the verified product image links** to PRODUCTS (`검증된 제품 이미지`). I did not have those images, so none are in the repository and the plan for PRD-001 cannot be generated until you add them.

## Costs

Planning is one Gemini text call (+ at most one corrective retry) with up to 4 small images; the final check is one call with ≤ ~10 small images. Both come after `SCRIPT_APPROVED`. Hook/script generation is unchanged. TTS cost guards are unchanged. Nothing here generates video.

## Not included (honest list)

- No Veo / Flow generation by API (see above).
- The final-check result is not pushed back to the dashboard (the web app has no inbound channel); it is in the renderer's `manifest.json` and printed in the terminal.
- Subtitle emphasis and per-scene `speaking_rate` accuracy depend on Google TTS; check the preview voice (`--preview`) before paying.
- Gemini's reading of the product images is checked by you: the dashboard shows the product look and the "must match / never show" lists next to the Flow prompts.
