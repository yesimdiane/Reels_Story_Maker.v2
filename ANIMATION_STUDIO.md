# Animation Studio (MuAPI image-to-video)

**Pipeline:** Script Studio → Storyboard → **Animation Studio** (clips) → **Video Studio** (voice + assembly/render) → Review → Publishing.
Animation Studio only generates, reviews and approves individual clips. Assembly, timing, subtitles and SFX stay in Video Studio (`render`), which already consumes approved clips; there is no second editor.

## What a scene workspace does
- Top: S1–S7 cards in story order (9:16 thumbnail, id, title, planned seconds, status). Statuses: 준비 안 됨 · 준비됨 · 대기열 · 생성 중 · 완료(검토 대기) · 실패 · 승인됨 · 거절됨. Job state is stored in the episode (`ep.generation.jobs`), so a browser refresh loses nothing.
- Left (inputs): the approved Storyboard start image, end frame (shown as *unsupported* unless a model declares it), editable animation prompt (`ep.prompts[sid]`; manual edits are flagged and never overwritten), the read-only composed prompt including the shared 0.5 s beats (`ep.motion`), negative prompt (only if the model supports it), model, clip length, resolution (only if the model declares options), 9:16 fixed, free cost check, generate.
- Right (result): 9:16 preview, version list, side-by-side compare, approve / reject / unapprove, job list (resume = free re-check, dismiss), stale-image warning.
- Per-scene settings live in `ep.animation[sid] = { modelId?, durationSec?, resolution? }` (validated against the model; the scene record itself is not changed).
- B-roll animation: approved B-roll stills can be animated with the same provider, job list and confirmation rules. Clips are kept in `ep.brollClips[brollId]`, never in the scene clip list or the Storyboard gallery.

## Planned vs generated duration
A 0.5 s beat is an instruction to the model, not a frame-accurate guarantee. Models offer fixed clip lengths; the UI shows "장면 4초 ≠ 클립 5초" when they differ. Trimming/stretching is done later in Video Studio.

## Safety (all enforced server-side)
Nothing paid happens on page load or when switching scenes. A generation needs: approved script/storyboard/start image/audio, the free estimate, then an explicit confirmation of the exact amount (single use, 30 min). Failed or uncertain jobs are never retried automatically. A new version never overwrites an approved clip. Changing a scene's start image after a clip was made flags the clip (`CLIP_STALE_IMAGE` warning, "stale" chip) — it does not silently revoke the approval. Tests use the mock provider; CI never submits real requests.

## MuAPI endpoints used (`studio/lib/providers/muapi.js`)
Base `https://api.muapi.ai/api/v1`, header `x-api-key` (server only): `POST /{model endpoint}` (submit → `request_id`), `GET /predictions/{request_id}/result` (poll), `POST /upload_file` (start image), `GET /account/balance`, `GET /models` (catalog; Settings "연결 확인", explicit button, free).
**Verification note:** these were checked against the official docs on 2026-10-11. In this session the docs sites were not reachable from the sandbox, so they were NOT re-verified. Confirm endpoint/parameters on the MuAPI playground before the first live run.

## Models
Built in: `kling-master` (verification `docs-example`: durations 5/10 s, 9:16, negative prompt). MuAPI publishes no price table, so no price is invented: enter your own per-clip price in Settings (required for live mode). Add more models under Settings → *Muapi 연결 · 영상 모델* → *모델 직접 추가* (verification `user-entered`; only fill in values you confirmed — resolution options and end-frame support are used only when declared). No economical/quality default was chosen because pricing and compatibility could not be checked.

## Environment variables (no new ones)
`MUAPI_API_KEY` (server only, never logged/sent to the browser), `RF_MUAPI_MODE=live` to allow real calls (default mock), optional `RF_MUAPI_BASE_URL`.

## First real clip (PRD-001 / S1)
`npm run animation:preflight -- EP01 S1` prints the read-only readiness report (it submits nothing). When it shows no blockers: Animation Studio → S1 → 비용 확인 → 생성… → confirm. Review, then approve; repeat for S2–S7; assemble in Video Studio.
