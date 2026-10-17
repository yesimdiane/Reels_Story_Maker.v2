# Production pipeline (final)

`Image Studio → Animation Studio → Voice Studio → Lip Sync Studio → Video Studio → Final Review → Publishing`

This supersedes the earlier rule "voice and sound effects before animation". Nothing about audio, SFX or lip sync is required before an animation.

| Stage | Input | Output (stored separately) | Gate |
|---|---|---|---|
| Animation (MuAPI) | approved scene image + prompt | **silent** clip `ep.clips[scene]` (versions, one approved = the reusable original) | approved image, prompt, model, valid endpoint, cost confirmation |
| Voice (HeyGen / Google / MuAPI ElevenLabs) | script lines, per-character voice | approved scene audio `ep.voice.lines`, `ep.audioApprovals[scene]` | approved script; live: exact character count |
| Lip Sync (MuAPI lip-sync endpoints) | approved silent clip + approved scene audio | `ep.lipsync[scene].versions` (never overwrites the clip) | both approved, provider limits, verified endpoint, price known, exact amount |
| Video | approved lip-synced video (dialogue scenes) or approved silent clip (no-dialogue scenes) + voice + SFX + music + subtitles | `ep.renders` | every scene approved, subtitle checks |

## Rules
* **Silent animation.** The prompt carries a "no speech / no talking mouth" rule and the negative prompt forbids speech. If a model declares its own audio-off switch (`silentParams`, e.g. `{"generate_audio":false}`) it is sent; otherwise the clip may contain sound, which is never used in the final video.
* **Regeneration is independent.** Voice (`새로 만들기`), lip sync and animation can each be redone without re-running the others. Approved audio / lip sync is never replaced silently: it needs confirmation / "승인 취소" first, and anything built on it turns *stale* (flagged, never auto-revoked or auto-regenerated).
* **Lip sync providers.** Endpoints (`sync-lipsync`, `latentsync-video`, `creatify-lipsync`, `veed-lipsync`, `ltx-2-19b-lipsync`, `ltx-2.3-lipsync`) come from the official muapi-cli registry, read statically; all start `unverified` and live calls stay blocked until the operator confirms them. Speaker support is **not assumed**: `speakers: unknown` counts as one speaker; a two-speaker scene is refused unless the model is declared `multi`. Price and max duration are operator-entered.
* **Voice exactly once.** The final render takes the lip-synced video's picture only and mixes the approved voice audio itself (plus SFX/music). The video's own audio track is ignored (test: swapping it for noise does not change the output audio).
* **Backward compatibility.** Existing clips, audio approvals and scene approvals are untouched. A dialogue scene whose scene approval predates the lip-sync stage keeps using its approved clip + audio (`legacy`) until a lip sync is approved for it; that change then marks the scene approval stale for re-approval.
* **Paid calls** (animation, TTS, lip sync) each need a free estimate, an explicit exact-amount confirmation, are single use, and are never retried automatically. Mock mode muxes locally and costs nothing.

## Video Studio additions
Background music (own upload; level, offset at 0.3 s, fades; not looped), `dip` transition (picture only; total length and audio timing unchanged), SFX (optional, edited here).
