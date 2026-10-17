# Rendering readiness, storyboard approval and Gemini prompt validation

## Rendering Readiness (two separate stages)
- **Stage A — generate video clips**: approved script, approved storyboard (per scene), approved start frame, valid animation timeline, valid prompt, character references, provider, readable files. It never requires a clip that does not exist yet.
- **Stage B — final render**: approved clips, audio, B-roll files, ordering/timing. It never blocks stage A.
- Findings are `pending` (a normal unfinished step — neutral, grouped by scene) or `block` (something is actually wrong: invalid data, vanished file, broken approval link). "No clip yet" is `영상 클립 생성 대기 — Storyboard에서 영상을 생성하거나 업로드하세요.`, never an error.
- Four statuses: ready to generate video · waiting for video generation (n scenes) · waiting for clip approval (n scenes) · ready for final rendering. Every finding carries an action that jumps to the scene and the collapsible section where it is done.
- Clips are looked up by scene id in `ep.clips`; a clip approval that points at a missing version is a real error (`CLIP_APPROVAL_BROKEN`, nothing deleted); clips filed under a scene id that no longer exists are kept and reported (`ORPHAN_CLIPS`).

## Where the video step lives
The page the readiness card used to name ("Animation Studio") exists as `#/animation`, but the navigation calls it **비디오 스튜디오** (sub-tab 애니메이션), so the instruction pointed at a name nobody could find. The same generation → review → approve workflow is now also in the Storyboard, per scene: **영상 클립 생성 · 승인** (provider/model, free cost check, explicit confirmation, progress/error, preview, approve / reject / regenerate, upload an existing clip). It uses the same APIs (`generation/estimate|authorize|run`, `clips/:sid/upload|:v/review`). Never automatic, never auto-approved, a regeneration is a new version, a failed job is never retried automatically.

## Storyboard approval
- Old: one hash over the whole storyboard including each scene's complete start-image record (approval flag, timestamps, provider, generation prompt …) — touching any scene invalidated everything and nothing said why.
- Now (`studio/lib/approvals.js`): the approval records each scene's **material content** field by field — characters, visual direction, product use/placement, the scene's script lines and length, the video prompt, the identity of the start image. Not part of it: timestamps, who approved, generation provenance, the frame's own approval flag (the generation gate still requires it), animation/B-roll edits, reference selections, scene order.
- A changed scene is held back **by itself**, with the field named ("S2: 시각 연출이(가) 승인 후 바뀌었습니다"); the other scenes keep their approval and can still generate. Nothing is ever approved silently or erased.
- Approvals made before this change keep working (legacy rule) and are upgraded in place at startup when still valid.
- A paid-generation authorization is bound to the material content of exactly the scenes it covers.

## Gemini prompt generation
Failure categories: `AI_RESPONSE_INCOMPLETE` (fields missing/empty — named), `AI_RESPONSE_MALFORMED` (no `scenes`, wrong types, unreadable/truncated JSON incl. `MAX_TOKENS`), `AI_SCENE_ID_MISMATCH`, `AI_CAST_VIOLATION`, `AI_PRODUCT_CLAIM_VIOLATION`, `AI_REFERENCE_SHEET_VIOLATION`; transport/HTTP errors stay `GEMINI_FAILED`. Each failure is written (sanitized: no keys, no images, short excerpts, response *shape* and field lengths) to `ai-diagnostics.jsonl` with scene, model, time, rule, missing fields and a request correlation id that is also in the error shown to the user.
Cast/sheet validation understands exclusions (`Keep Diane outside the frame`, `without Diane`, `do not show …`), identity-only mentions, prohibitions (`do not draw a character sheet`) and treats the whole negative prompt as prohibitions; showing an unselected character, duplicating a character or instructing a reference sheet is still rejected. Edited prompts are only replaced with the explicit `force`; failures save nothing and are never retried automatically.

**Historical cause of the earlier `S5` failure cannot be confirmed** — no response log of that request exists in the repository or on this machine. The code paths that could produce it were: a missing/empty section (reported then under a rule-violation message), a scene id that did not match, and sheet words or a character name inside `negative_additions` being treated as instructions. All three are now distinguished and logged.
