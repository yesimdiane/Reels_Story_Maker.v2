# Studio architecture (workflow order)

Sidebar (Korean primary, English subtitle), in production order:
제품 스튜디오 → 스토리 랩 → 에피소드 → 대본 스튜디오 → 이미지 스튜디오 → 애니메이션 스튜디오 → 비디오 스튜디오 → 최종 검토 → 게시 → 자동 DM → 설정.

| Route | Studio | Notes |
|---|---|---|
| `#/image/EP01` | Image Studio | formerly Storyboard; `#/storyboard/EP01` redirects here (episode id kept) |
| `#/settings/characters` | Settings → 캐릭터 라이브러리 | formerly `#/characters` (redirects); full library: universes, profiles, references, voices |
| `#/settings/<tab>` | Settings tabs | `general, ai, connections, voices, prompts, scriptprompts, endings, usage, characters` |

## MuAPI model contract (`studio/lib/modelcontract.js`)
* Every model declares its own request field names (`promptField, imageField, durationField, aspectField, negativeField, resolutionField`) and constant `extraParams`; nothing assumes two models share a body.
* Endpoints are relative paths under the fixed base `https://api.muapi.ai/api/v1` — no scheme/host/`//`/`..`/query.
* Verification levels: `unverified` (seed or catalog id; **live generation blocked**) → `user-entered` (operator ticked "confirmed in the MuAPI playground") → `verified` (a real job on that endpoint completed).
* The seed `kling-master` is *unverified* until confirmed. A balance/catalog check proves only API connectivity, never that an endpoint works.
* An unknown model id is an error, never a silent fallback to another model.

## Preview robustness
`previewImage()` (views/common.js) shows a loading state, diagnoses failures with a free HEAD request (missing file vs. auth vs. server), and offers *미리보기 다시 불러오기* which only re-fetches the picture. The server flags `startImageInfo.missingFile` when an approval record exists but the file is gone (e.g. a Railway deploy without a persistent volume).

## Regression guard
`tests/frontend-syntax.test.js` parses every browser module: one stray parenthesis in `ai-settings.js` had blanked the entire Studio.

## Animation Studio gates (PR-2)
Per scene, before any paid generation (`studio/lib/animgate.js`, UI `views/anim-gates.js`):
1. 대사 음성 — approved audio (or no dialogue).
2. 효과음 — approve the SFX plan, or explicitly choose "효과음 필요 없음". Changing the list afterwards makes the decision *stale*.
3. 립싱크 — no registered model takes audio, and no lip-sync provider is invented: the operator acknowledges that the approved audio is mixed in afterwards (no mouth sync). A model declaring `lipSync` + `audioField` is handled by the model.
4. 점검 — checklist (image, audio, SFX, lip-sync, prompt, model, endpoint, cost). The server adds `SFX_NOT_DECIDED` / `LIPSYNC_NOT_CHOSEN` to the generation blockers, so the API enforces the same gate as the button.

Per-character voice settings (`views/voice-settings.js`): provider (HeyGen / Google / **MuAPI TTS**), MuAPI `voice_id`, rate, style, emotion — stored on the character and reused by every episode. Only the rate is sent to providers today; style/emotion are saved notes and the UI says so.

MuAPI TTS (`providers/muapi-tts.js`, from #70) is wired into the voice service. In MuAPI live mode it is blocked until the operator confirms the endpoint in Settings (`TTS_UNVERIFIED`) and a voice_id exists; the exact character count must be confirmed; a failed paid line is never retried. Mock mode uses the mock voice.

## Video Studio (PR-3)
Five tabs on `#/render/EP01` (the readiness card stays on top): **1 장면 검토 → 2 타임라인 → 3 자막 → 4 사운드 → 5 최종 렌더**.
* Timeline: scene / voice / SFX / B-roll / subtitle lanes on a shared time axis (music lane shown as absent — no music is generated or imported). Items open an editor; UI step 0.3 s (storage grid 0.05 s). Voice lines are read-only: approved audio timing is never changed here.
* Subtitles (`studio/lib/videoedit.js`, `ep.videoEdit`): per-line text (ko/en), start/end shift, hide, reset; style = language (ko/en/both), position, font size. A phone preview shows the caption; real glyphs/wrapping are checked in the preview render. Checks: empty / >60 chars / overlap / hidden.
* Sound: voice and effect balance (dB) for the final render; per-effect offset, gain, fade in/out (fades and offsets are part of the scene hash, so changing them invalidates that scene's approval instead of being silently kept).
* Final render: checklist (all scenes approved, audio approved, SFX decided, no subtitle errors, no blocking problems, no paid call), preview/final render, versions with download. Each render stores an `editHash`; editing captions/mix afterwards marks the render *outdated* and blocks its final approval until re-rendered.
