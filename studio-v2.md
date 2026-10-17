# Reels Factory Studio V2 — Muapi integration & redesigned dashboard

Studio is a small, dependency-free Node app (`studio/`) that runs **on your Mac** next to the renderer. It manages one
reel from product → script → approval → storyboard → cost estimate → animation → clip review → voices → render → final
review → publishing pack. The Apps Script / Google Sheets dashboard is **unchanged** and keeps working.

```
cd reels_factory-main
node studio/server.js          # or: npm run studio     → http://127.0.0.1:4173
```

Requires Node ≥ 20 and FFmpeg (same as the renderer, `node renderer/cli.js check`). No `npm install` is needed.

## Safety model (read this first)

| Rule | How it is enforced |
|---|---|
| **MOCK by default** | `RF_MUAPI_MODE` must be exactly `live` *and* `MUAPI_API_KEY` set, otherwise the mock provider is used. Live can't be switched on from the UI or the API. A key alone does nothing. |
| **No automatic billable call** | Estimating, authorizing, polling, downloading, reviewing are free. A submit only happens in `generation/run` after an authorization. |
| **Approved script + storyboard** | Authorization and every scene submit re-check the approval fingerprints. Editing the script/prompts/start images afterwards invalidates approvals *and* unused authorizations. |
| **Explicit authorization** | The operator sees the per-scene estimate and must confirm the exact total. Authorizations expire after 30 min, are tied to model + mode + scenes + hashes, and are single-use per scene. |
| **Spending limit** | Per reel (`RF_REEL_SPEND_LIMIT_USD`, overridable per reel). A run over the remaining limit is refused. Live runs need an operator-entered price (see below). |
| **No auto-retry of paid jobs** | Submit is retried **only** on HTTP 429 (request refused). A timeout/5xx/network error after sending is `uncertain` and never re-sent; the job keeps its request ID so *Resume* only polls/downloads. Failed jobs stay failed until the operator authorizes a new run. |
| **Cache** | Clips are cached by sha256 of (model, endpoint, prompt, negative prompt, duration, aspect, start-image hash). Same inputs → reused, no charge. |
| **Clip review is not bypassed** | Every generated/uploaded clip is `pending_review`. Approval records its sha256; render re-verifies the checksum. |
| **Keys stay on the server** | Read from `renderer/.env` / env by the server only; never in an API response, log or error (the adapter redacts the key from any upstream text). A test scans every public response for the key. |
| **No publishing** | The Studio never posts to Instagram or edits ManyChat. Those steps are operator checklist confirmations. |

Localhost only (`127.0.0.1`), Host allow-list, custom header + same-origin check on every mutation, optional `RF_STUDIO_TOKEN`.

## Environment variables

See `renderer/.env.example` (bottom section). `MUAPI_API_KEY`, `RF_MUAPI_MODE`, `RF_MUAPI_BASE_URL`,
`RF_REEL_SPEND_LIMIT_USD`, `HEYGEN_API_KEY`, `RF_STUDIO_VOICE_MODE`, `RF_STUDIO_DIR`, `RF_STUDIO_HOST`, `RF_STUDIO_PORT`,
`RF_STUDIO_TOKEN`. Data lives in `RF_STUDIO_DIR` (default `~/.reels-factory/studio`; JSON + media files, nothing deleted).

## Muapi adapter (`studio/lib/providers/muapi.js`)

Verified against the public docs at muapi.ai on 2026-10-11:

* Base `https://api.muapi.ai/api/v1`, header `x-api-key`.
* Submit `POST /{model endpoint}` → `request_id`, `status`, `cost`. Image-to-video example documented: `POST /kling-master`
  (`prompt`, `image_url`, `duration` 5|10, `aspect_ratio` incl. 9:16, `negative_prompt`).
* Poll `GET /predictions/{request_id}/result` (queued/pending/processing → completed/failed); outputs are URLs; download is free.
* Upload `POST /upload_file` (image ≤ 10 MB, URL valid ~1 h); balance `GET /account/balance`; catalog `GET /models`.
* Recorded per job: request ID, model, prompt hash, output path + sha256, cost object when returned (`amount_usd`, `amount_credits`, …).

**Not documented, therefore not invented:** a per-model price list, rate limits, error-code table, refund rules. The price
table in *Settings* starts empty: enter the price shown in your Muapi account per clip duration. Until then **live** generation is
blocked (mock works). Only the `kling-master` model is registered (`studio/seed/models.json`); adding others means adding
an entry with its documented endpoint/parameters. Lip-sync is not offered (not confirmed for the registered model).

## Characters & voices

Character Library (Settings): Jack and Diane with look/prompt blocks, forbidden words (Diane never says "오빠"),
catchphrase, and **approved reference images = source of truth** (only approved references can be start frames; demo
placeholders are refused for paid generation). Visual identity: hand-drawn 2D Korean webtoon/anime, muted beige/earthy, not 3D/Pixar.

Dialogue is English; Korean subtitles are stored separately per line. Each character has its own HeyGen **Voice ID** and a
separate audio cache. Jack's identity ID `d51329d270cf407490b88693cda054e0` is stored as reference only — **it is not a voice ID**
and is never used for synthesis. Live voice requires a Voice ID that was verified against HeyGen's voice list and an exact character-count confirmation.
The Korean narration path (`renderer/`) is untouched; the TTS cache key for Korean is unchanged.

## Storyboard prompts (templates + Gemini)

Why the prompt boxes were empty (audit, `apps-script/*` + `studio/*`): the Apps Script dashboard has **no** character selector,
negative prompt or Muapi field — that screen is the Studio's Storyboard. Two real causes were found and fixed there:
(1) prompts were only created when you clicked a button, so a new/approved episode showed empty boxes — they are now built
(free, deterministic) automatically when the script is approved and when a scene's cast changes; (2) the screen kept an old
empty *draft* of the textarea after prompts were created, so the box stayed blank until reload — the draft now only holds unsaved typing.
No API was missing or failing; the Apps Script `FlowPrompts.gs` / `StoryboardImages.gs` flow (Google Flow, photoreal Coupang product videos, Gemini image model)
is unchanged and is a different workflow.

* **Template** (free): house style + exact cast + identity + camera / actions / environment / lighting / continuity / duration / 9:16.
* **AI (Gemini)**: explicit click + confirmation (a Gemini call may be billed; the Studio doesn't know the price). `GEMINI_API_KEY` stays server-side.
  Sends the approved script/storyboard and the **actual bytes** (`inlineData`) of the approved character sheets of the characters selected in each scene
  (each sheet once; none for scenes without characters). Gemini writes only the creative sections; code adds style, cast count, identity, verified product block,
  duration/format and the mandatory sheet rule. Output that duplicates a character, adds an unselected one, draws the sheet/collage, or claims unverified features
  is rejected and nothing is saved. Characters without an approved reference are never guessed.
* **Character sheets**: references are marked "캐릭터 시트" by default. A sheet is identity-only: it cannot be used directly as the image-to-video start frame
  (blocker `SHEET_AS_START_FRAME`) — upload a composed scene start frame, or mark a reference as a single illustration.
* Prompts are editable and saved per scene; the sheet rule is re-appended if deleted; edited prompts are not overwritten without confirmation; previous versions are kept.

## Views

Overview · Episodes · Script Studio · Storyboard · Animation Studio · Voice Studio · Render Studio · Publishing · Settings.
Korean-first UI, English dialogue editing, ivory/espresso/charcoal/sage palette, responsive (rail on desktop, tab bar on phone).

## Episode 01 (PRD-001 magnetic umbrella holder)

Seeded from `studio/seed/episode-01.json`: exact title, 8 plot beats / scenes, 4 dialogue lines, CTA, Korean subtitles, caption
with the Coupang Partners disclosure on the first line. Only verified features are used for visuals and copy; forbidden
claims (e.g. waterproof/auto-opening) are validated out of script, prompts and caption. PR #19 suggestions appear under Script Studio → Suggestions.

## What is real, mock, or needs credentials

| Area | Status |
|---|---|
| Studio server/UI, approvals, versions, audit log, cost estimate/limit/authorization, cache, clip review + checksum | **Implemented, tested** |
| Muapi adapter (submit/poll/upload/download/retry/cost parsing) | **Implemented, tested with mocked HTTP only**; never run against the real API |
| Video generation | **MOCK** (real FFmpeg placeholder clips). Real needs `MUAPI_API_KEY`, `RF_MUAPI_MODE=live`, operator-entered prices, real approved reference images |
| Voices | **MOCK** tone audio. Real needs `HEYGEN_API_KEY`, `RF_STUDIO_VOICE_MODE=live`, a verified Voice ID per character |
| Subtitles / mixing / 9:16 render / QC | **Implemented** (FFmpeg + libass). Needs a Korean font on the Mac (`brew install --cask font-nanum-square-round`) |
| Sheets/Apps Script sync | **Not wired** (Studio has its own store). Documented as a follow-up |
| Instagram publishing, ManyChat | **Manual by design** |
| Hosting beyond your Mac | **Not provided.** Run locally; if you must expose it, set `RF_STUDIO_TOKEN` and put it behind HTTPS/VPN |

## Tests

`npm test` (all suites). New: `tests/studio-muapi.test.js` (adapter, mocked fetch), `tests/studio-pipeline.test.js`
(gates, cost controls, cache, no auto-retry, review checksum, voices, render, publishing), `tests/studio-server.test.js`
(CSRF/host/token, key secrecy, traversal). The suites need ffmpeg; font-dependent legacy tests need NanumSquareRound installed.
