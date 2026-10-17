# Jack & Diane — production integration contract

## Scope
This is an **opt-in** cinematic skit workflow alongside the existing Seoul Home Reels Factory home-decor workflow. It must never silently replace the current Google Flow/manual or Google Cloud Korean TTS routes.

## Character identity (approved)
- **Diane:** long jet-black hair, Korean woman, playful, impulsive, buys Coupang products when she finds a delightful excuse. When excitedly presenting an idea, she shouts **"BABYYYY!!!!!!"**, **never** "오빠".
- **Jack:** British husband, wavy brown hair, mustache, tattooed arms, rounded jaw, broad muscular/stocky physique (not skinny and not overweight), tender and indulgent toward Diane; dry humor, stubborn about not carrying an umbrella.
- Visuals: consistent hand-drawn 2D Korean webtoon/anime look, muted warm colors. User-approved character reference images are the source of truth, not AI reinterpretations.

## EP01 — PRD-001, magnetic door-mounted umbrella holder
Product claims must match verified **magnetic** attachment to compatible steel, separate upper and lower sections, and actual product variants; do not add unsupported no-drill strength/drainage claims. Keep precise product photography for final CTA. Confirm footage/source rights.
1. Jack: "I'm British. We don't need umbrellas."
2. Torrential Korean monsoon begins; leaks from a bus ceiling, clogged storm drain erupts, Jack: "Oh no... OH NO!"
3. Dramatic disaster parody: surge of water uphill toward Jack and Diane's hilltop home, Jack terrified ("I JUST WANNA GO HOME!"). Treat tsunami-scale wave as obvious fiction, not documentary depiction.
4. Doorway: drenched Jack; Diane throws him a towel, says "Korean rain is different! Don't come in! Dry yourself first!"
5. Diane spots a **shopping excuse**, gets excited, orders and attaches magnetic umbrella holder.
6. Diane: "BABYYYY!!!!!! LOOK WHAT I GOT!!!" Jack warmly: "Good job, baby! But I'm still not gonna use it."
7. End card EXACT Korean copy:
   - 남편은 못 고쳐도, 현관은 고칠 수 있다.
   - 문에 붙이는 우산꽂이 ☂️
   - 댓글에 ‘우산’ 남기면 링크 드림!
   - Include compliant affiliate disclosure. ManyChat comment → DM is a separately configured step, never claim configured unless confirmed.

## API implementation boundaries
- Muapi = generated clips **only after explicit script approval AND operator-confirmed per-asset spending**, with separate provider adapter, cost estimation, provider request IDs, async job polling, retries bounded with idempotency, rate limit and project quotas. Check official Muapi API schema/model access before implementing calls; never invent an endpoint.
- HeyGen = English dialogue as **separate speaker/line segments**, explicit speaker role, language `en`, and voice ID. Existing `renderer/lib/tts/heygen.js` defaults to Korean to preserve old workflow. Jack's supplied **Identity ID** is `d51329d270cf407490b88693cda054e0`; DO NOT treat as a confirmed Voice ID without checking capability. Obtain Diane voice ID separately from secret config. Keep keys in local/cloud secrets, never repository.
- Render with FFmpeg on Mac using provider-neutral assets/manifests and future cloud storage backend.
- The existing signed HMAC job + approved script fingerprint + per-clip approval/checksum gate MUST stay enforced before paid generation or voice synthesis.
- Human approvals: script → paid-asset request → clips → final video → publication. No paid provider calls when status is unapproved, script hash diverges, permission missing, or budget exhausted.
- English speech and Korean subtitle/CTA must be separate fields. Current `renderer/lib/storyboard.js` uses narration text as both spoken line and subtitle, so introduce a separate dialogue schema, translation field, per-speaker audio timeline and a compatible new template without breaking existing jobs.
- Track generation cost/credits, job outcomes and failed attempts; do not claim HeyGen rates from existing TTS character-price approximation as exact.

## Suggested next delivery order
1. Character/episode schema + tests and dashboard editing panels; approved references.
2. Per-line speaker TTS with identity-to-voice validation and budgeted async pipeline.
3. Muapi capability check, adapter, mock tests, paywall/approval gate.
4. Clip preview/approval + FFmpeg dialogue assembly.
5. CTA keyword/ManyChat settings, human final publishing.
