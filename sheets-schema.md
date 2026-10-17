# Google Sheets schema

The Apps Script code finds every column **by its row-1 header name**, not by position.
Columns can be reordered and extra operator columns can be added. Header matching ignores spaces and letter case
(`상품 ID` = `상품ID`), and tab names tolerate surrounding spaces / case (`Products ` = `PRODUCTS`); otherwise the words must match.

The script **never edits the PRODUCTS sheet** and never rewrites an existing header row.
If a required header is missing it stops with an error naming the missing header.

## PRODUCTS (existing — read only)

| Col | Header | Required for generation | Notes |
|---|---|---|---|
| A | 상품ID | yes | Format `PRD-###` (e.g. `PRD-001`). Must be unique in the sheet. |
| B | 상품명 | yes | |
| C | 카테고리 | no | Context for the prompt only. |
| D | 확인된 기능 | yes | **One verified fact per line** (or separated by `;`). These are the only facts Gemini may use. Commas are kept, so `색상: 다크그레이, 그레이, 화이트` is one fact. |
| E | 타깃 | no | Context for the prompt only. |
| F | 쿠팡파트너스 URL | no | Never sent to Gemini, never placed in scripts. Used later by ManyChat. |
| G | 영상 소스 URL | no | Not sent to Gemini. |
| H | 영상 사용 허가 상태 | no | Copied to REELS. Only `허가`, `허가됨`, `승인`, `승인됨`, `확인 완료`, `허가 완료` count as verified; anything else adds a warning to the reel's 검토 메모. Marketplace availability is **not** permission. |
| I | 제작 상태 | no | Not modified by the script. |

### Optional PRODUCTS columns (add them yourself, right of column I)

| Header | Used for |
|---|---|
| ManyChat 키워드 | A product-level comment keyword (e.g. `우산`). All reels of this product use it in the CTA line, caption and ManyChat. It must be one word (≤20 chars, no spaces or quotes) and is never reused by another product; this is checked **before** any Gemini call. Without it, each reel gets a code like `PRD001R01`. |
| 제품 외형 | A short visual description (e.g. `슬림한 사각 두 조각, 무광 플라스틱`) added to the Google Flow prompts. Only describe what is true of the real product. |
| 검증된 제품 이미지 | Google Drive links (or file IDs), one per line, of images you verified show the **real** product and may be used as references (max 4; PNG/JPEG/WebP, ≤ 3 MB each and ≤ 10 MB total; the Apps Script user needs access). **Required before Gemini plans the production**: product visuals must match these images. Sent to Gemini only for the production plan. The dashboard can **append** a link to this one cell of one product row when you upload a reference photo (existing text, other cells and other rows are never changed); the column itself is never created for you. |

## REELS (created by the script if missing)

If a REELS tab already exists without some of these headers, **시트 준비** offers to append only the missing headers
to the right end of row 1 (after confirmation; existing cells are never changed).

One row per reel script. One row (five hooks + one script) is appended per generation run (`REELS_PER_PRODUCT`), only after it passes validation.

| Header | Source | Description |
|---|---|---|
| 릴스ID | code | `{상품ID}-R{nn}` e.g. `PRD-001-R01`. Continues after the highest existing number for that product; never reused. |
| 상품ID | PRODUCTS | |
| 버전 | code | 1–3 within the generation run. |
| 컨셉 | Gemini | Distinct per reel. New scripts start with their creative angle: `A 일상 불편 · …`, `B 좁은 공간 · …`, `C 생활 상황 · …`. |
| 후킹 | Gemini | ≤ 40 chars (new Gemini scripts: ≤ 25, spoken in the first 2–3 s). Distinct per reel and from the product's earlier hooks. |
| 내레이션 | Gemini | ≤ 300 chars voiceover. |
| 자막 | Gemini | On-screen caption lines, newline separated, each ≤ 40 chars. |
| 장면(JSON) | Gemini | JSON array of `{scene_no, beat, narration, duration_sec, visual, on_screen_text, flow_prompt, facts}`; 3–6 scenes, 10–40 s total. `facts` holds the exact 확인된 기능 lines the scene relies on (Gemini sends IDs such as `F1`; they are converted before writing). Rows written before this change have no `facts` and remain valid. |
| Flow 프롬프트 | Gemini | `S{n} ({sec}s): <English prompt>` per line, for pasting into Google Flow. |
| Flow 생성 | code | Always `수동 생성 필요 …`. Google Flow is **not** called through the Gemini API; an operator generates clips manually. |
| CTA | code | `댓글에 "{키워드}" 남기면 상품 링크를 DM으로 보내드려요.` |
| ManyChat 키워드 | code | Post-specific keyword, `{릴스ID without dashes}` e.g. `PRD001R01`. Must be unique across REELS (checked case-insensitively). The operator may change it before publishing but must keep it unique and update ManyChat to match. |
| 광고 표기 | code | Fixed Coupang Partners disclosure: `이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.` |
| 사용한 확인 기능 | Gemini (validated) | Exact lines from PRODUCTS.확인된 기능 the reel relies on. Gemini refers to facts by ID (`F1` = first line …), and the script writes the matching sheet wording here, so the column reads as before. |
| 영상 사용 허가 상태 | PRODUCTS | Snapshot of column H at generation time (`미확인` if blank). |
| 제작 상태 | code | Korean label of 상태 (e.g. `대본 검토 대기`). MVP-era rows with only this column are read as `SCRIPT_REVIEW_PENDING`. |
| 검토 메모 | code | Permission warning (if unverified) and the human-review reminder. |
| 생성 모델 | code | Gemini model ID used. |
| 생성일시 | code | Timestamp. |

### Approval columns (appended after the MVP columns by 시트 준비)

| Header | Written by | Description |
|---|---|---|
| 상태 | state machine | Status code. See [iphone-dashboard.md](iphone-dashboard.md#status-flow) for the flow. |
| 대본 버전 | state machine | Starts at 1. Each edit or regeneration adds 1. |
| 승인 대본 버전 | ② approve | The version that was approved. It is cleared when the script changes or the approval is cancelled. |
| 승인 대본 해시 | ② approve | Fingerprint of all script cells (컨셉 … 사용한 확인 기능, Flow 프롬프트, CTA, ManyChat 키워드, 광고 표기). Video and publishing steps require it to match the current cells. |
| 대본 검토자 / 대본 검토일시 / 대본 검토 메모 | ② | Who decided, when, and why. |
| 영상 버전 | registering an MP4 | Adds 1 for each MP4 registered for review. |
| 영상 파일 URL | registering an MP4 | Google Drive link to the MP4 being reviewed. |
| 영상 검토자 / 영상 검토일시 / 영상 검토 메모 | ③ | Who decided, when, and why. |
| 게시 확인일시 / ManyChat 설정 확인일시 | ④ | Manual confirmations. The reel becomes `COMPLETED` once both are set. |
| 인스타그램 URL | ④ | Optional link to the published post. |
| 오류 | system | Last blocking error, e.g. a missing Partners link or a render failure. |
| Flow 장면 프롬프트 | ② approve | JSON list: one Google Flow prompt per scene, generated by code on approval and cleared when the script changes. Not part of the approved fingerprint. |

### Brand and hook columns (added by 시트 준비)

| Header | Written by | Description |
|---|---|---|
| 콘텐츠 기둥 | Gemini / reviewer edit | `AI 공간 변신`, `생활 꿀템 발견`, `국제부부 한국살이` or `살까 말까 비교 연구소` (see [brand.md](brand.md)). Not part of the approved fingerprint. |
| 훅 후보(JSON) | Gemini (validated) | The five hooks H1–H5 (질문형, 숫자로 시작하는형, 통념을 뒤집는 단정형, 상황 묘사형, 결론 먼저 던지는형), each with its opening scene (`visual`, `flow_prompt`, `emphasis`, `sfx`), and the recommended hook with its reason. Written at generation, or by **훅 5개 만들기** for an older script. **Generation and approval require this column.** |
| 선택한 훅 | operator (dashboard ②) | The operator's final hook: `{id, label, text, edited, recommended, scriptVersion, mode, by, at}`. Approval requires it on the current script version (후킹 must equal its text), plus the operator's review confirmation. |
| 확인 필요 | code | Verification flags, one per line, e.g. `[개인 경험] 장면 2: 실제 경험·구매인지 확인 — "…"`. They are recomputed from the script on every edit and approval, so a missing or outdated cell never hides a flag. On approval the reviewer confirms them, and AUDIT records the confirmation. |

### Production columns (added by 시트 준비)

| Header | Written by | Description |
|---|---|---|
| 제작 계획(JSON) | Gemini (validated), after `SCRIPT_APPROVED` | The production plan: product look (from the verified images), per-scene Flow description / continuity / what to verify, voice rate and pause per line, subtitle emphasis, cut framing, risks, plus `scriptVersion` and `approvedHash`. A plan whose hash is not the current approval is ignored; it is cleared when the approval is withdrawn or the script changes. AUDIT: `SET_PRODUCTION_PLAN`. |
| 에셋 현황(JSON) | code (Drive sync) | Drive folder ID/URL and one row per Flow clip: `MISSING` / `UPLOADED` (+ Drive file ID, size, modified), unexpected files, last sync. Tracking only: no AUDIT rows. |

### Media and storyboard columns (added by 시트 준비)

| Header | Written by | Description |
|---|---|---|
| 장면 클립(JSON) | code (dashboard uploads and reviews) | Per Flow clip (`S1` …): every uploaded version with Drive file ID, MD5, size, uploader, rights confirmation, and its status (`PENDING_REVIEW` / `APPROVED` / `REJECTED` / `SUPERSEDED`), reviewer and note. An approval counts only for the approved-script fingerprint it was given under. Needed before any upload or review (checked before Drive is touched). AUDIT: `CLIP_UPLOADED`, `CLIP_APPROVED`, `CLIP_REJECTED`. See [media-workspace.md](media-workspace.md). |
| 장면 이미지(JSON) | Gemini 2.5 Flash Image & operator reviews | Per scene (`S1` …): generated 9:16 vertical storyboard image versions with Drive file ID, prompt, motion prompt, mime, reviewer status (`PENDING_REVIEW` / `APPROVED` / `REJECTED` / `SUPERSEDED`), reviewer note. Modifying or regenerating an approved image invalidates dependent video clip approvals. AUDIT: `STORYBOARD_IMAGE_GENERATED`, `STORYBOARD_IMAGE_APPROVED`, `STORYBOARD_IMAGE_REJECTED`, `CLIP_APPROVAL_INVALIDATED`, `VIDEO_APPROVAL_INVALIDATED`. |

Both production columns are needed before the production plan or the Drive folder (checked before any Gemini or Drive call). Existing scripts keep working without them. The `Flow 장면 프롬프트` cell is overwritten with the plan-based prompts when a plan is made (it is not part of the approved fingerprint).

If `콘텐츠 기둥` / `확인 필요` are missing, the dashboard and approvals keep working, and the dashboard shows a warning. If the two hook columns are missing, **new generation** stops before calling Gemini and asks you to run 시트 준비. Existing rows keep working. `장면(JSON)` may also carry `ai_visualization: true` for AI interior-visualization scenes. Their `on_screen_text` then includes `AI 시뮬레이션`.

Script cells are written with plain-text number format, so Sheets never turns script text into numbers or dates.

## AUDIT (created by the script; append-only)

| Header | Description |
|---|---|
| 일시 | Timestamp |
| 릴스ID / 상품ID | |
| 작업 | One of: `PRODUCT_SUBMITTED` (①), `SCRIPTS_GENERATED`, `SET_HOOKS`, `SELECT_HOOK`, `APPROVE_SCRIPT`, `EDIT_SCRIPT`, `REQUEST_SCRIPT_CHANGES`, `REGENERATE_SCRIPT`, `REJECT_SCRIPT`, `REOPEN_SCRIPT`, `STORYBOARD_IMAGE_GENERATED`, `STORYBOARD_IMAGE_APPROVED`, `STORYBOARD_IMAGE_REJECTED`, `CLIP_APPROVAL_INVALIDATED`, `VIDEO_APPROVAL_INVALIDATED`, `START_VIDEO`, `REGISTER_VIDEO`, `MARK_VIDEO_FAILED`, `APPROVE_VIDEO`, `REQUEST_VIDEO_CHANGES`, `REJECT_VIDEO`, `READY_TO_PUBLISH_BLOCKED`, `RENDER_JOB_ISSUED`, `MARK_READY_TO_PUBLISH`, `CONFIRM_PUBLISHED`, `CONFIRM_MANYCHAT` |
| 이전 상태 / 새 상태 | Status codes |
| 대본 버전 / 영상 버전 | Versions after the action |
| 작업자 | Google account email, `Gemini (<model>)`, or `system` |
| 메모 | Reviewer note or blocking reason |
| 스냅샷(JSON) | For script actions, the exact script cells (the approved snapshot is kept here). For video actions, the video link. |

## PERFORMANCE (created by the script if missing; filled manually for now)

| Header | Description |
|---|---|
| 릴스ID | Links to REELS.릴스ID |
| 게시일 | Instagram publish date |
| 인스타그램 URL | |
| 조회수 / 좋아요 / 댓글 / 저장 / 공유 | Instagram insights |
| ManyChat DM 발송수 | DMs sent for this reel's keyword |
| 링크 클릭수 | Coupang Partners clicks |
| 주문수 | |
| 수익(원) | |
| 메모 | |

## LOG (created by the script if missing)

| Header | Description |
|---|---|
| 일시 | Timestamp |
| 레벨 | `INFO`, `WARN` (validation failed, retrying), `ERROR` |
| 작업 | `generateReels`, `validateGemini`, `setupSheets`, `liveTestPRD001` |
| 상품ID | |
| 메시지 | Short actionable summary |
| 상세 | All validation errors plus the raw Gemini response, or a stack trace |

## Validation rules applied to Gemini output

A run writes nothing to REELS unless **all** of these pass. On failure, one corrective retry is made. That retry sends Gemini the exact failing sentences and its previous response, and asks it to change only those.

### Structure
- Valid JSON with five hooks, a recommended hook, a comment keyword and exactly `REELS_PER_PRODUCT` (1) script, with all required fields.
- Length limits for hook, narration and captions.
- 3–6 scenes numbered 1..n, with a total duration of 10–40 s. Every scene has a Flow prompt (≥ 30 chars).
- **Five hooks (H1–H5), one per type, ≤ 25 characters each:**
  - H1 ends with a question;
  - H2 uses a number backed by the facts (no invented statistics);
  - H3 overturns a common belief;
  - H4 describes a concrete moment;
  - H5 states the solution first.

  All five must be distinct and must not repeat the product's earlier hooks. The fact, claim and number rules apply. The script starts with the recommended hook, whose reason is required. See [five-hook-workflow.md](five-hook-workflow.md).
- **One script per run** (`REELS_PER_PRODUCT`). New scripts are 20–40 s. Older rows keep 10–40 s.
- `comment_keyword` is one simple word (e.g. `우산`), never an internal ID.
- **Story (new scripts):** HOOK (a relatable problem) → EMPATHY (why it is annoying) → SOLUTION (the product appears naturally) → DEMO (verified features) → CTA (comment keyword). An optional BENEFIT may follow DEMO. Older rows (HOOK → PROBLEM → DEMO → BENEFIT → CTA) stay valid for approval and rendering.
- If `REELS_PER_PRODUCT` is set above 1, each script also needs one of three angles (`EVERYDAY_FRUSTRATION`, `SMALL_SPACE`, `LIFESTYLE_SITUATION`), and distinct concepts and hooks.
- New 릴스ID / ManyChat 키워드 do not collide with existing rows. Existing duplicates in REELS, or a duplicate 상품ID in PRODUCTS, stop the run.

### Facts: references, not wording
- Gemini sees 확인된 기능 as `F1: …`, `F2: …` (one ID per line of the cell).
- It returns `facts_used` (IDs for the whole reel) and `fact_ids` per scene. Every DEMO and BENEFIT scene must cite at least one ID; SOLUTION cites one when it states a feature.
- References must resolve to a verified fact. Accepted forms:
  - an ID;
  - the exact sheet wording;
  - the same wording with different spacing or punctuation (for rows written before this change).

  Anything else is rejected, e.g. `F9` or `방수 기능`.
- **Viewer-facing text may paraphrase freely.** For example, `자석 부착형 거치 방식` can be said as *자석으로 붙여서 사용하는 우산꽂이*, and `철제 도어 부착` as *철제 현관문에 부착할 수 있어요*.

### Claims (hook, narration, captions and every scene line)
Each of these needs support in 확인된 기능. A term that also appears in the facts or the product name is allowed. Rules are in `CONFIG.CLAIM_RULES`.

| Kind | Examples rejected for PRD-001 |
|---|---|
| Invented features | 방수, 물받이, 항균, 회전, 각도 조절 |
| Compatibility | 냉장고에도 붙어요, 벽·타일·유리, 어떤 문이든, 어디든 |
| Performance | 튼튼, 강력한 자석, 자력, 하중, 안 떨어져요 |
| Installation | 무타공, 구멍, 드릴, 공구 없이, 3초 만에 |
| Material | 스테인리스, 알루미늄, 플라스틱, 소재 |
| Capacity | 대용량, 여러 개 |
| Price | 가격, 할인, 쿠폰, 가성비, 만 원 |
| Reviews / popularity | 후기, 리뷰, 별점, 인기, 품절, 다들 사요 |
| Certification | 특허, 인증, KC, 친환경, 최고 |
| Colours | any colour not in the facts (synonyms count: 흰색 = 화이트, 회색 = 그레이) |

### Hook style (new Gemini scripts only)
The account is about Korean home decor, small-space living and organization. A hook should sound like a lifestyle creator describing a moment the viewer recognises, not like an ad. Rules are in `CONFIG.HOOK_STYLE`. Each failure tells Gemini how to fix it on the retry.

| Rejected | Example |
|---|---|
| Starts with the product name | 우산꽂이 하나로 현관이 달라집니다. |
| Corporate "~니다" ending | …달라집니다. / …해결합니다. |
| Generic rhetorical question | …없다면? / …고민이신가요? / …하시나요? |
| Ad wording | 하나로, 소개, 추천, 필수템, 꿀템, ~하세요, ~이 달라져요 |
| Too long for the first 2–3 s | more than 25 characters |
| Same as one of this product's earlier hooks | the prompt also lists them so Gemini avoids them |

Accepted examples: 급하게 출근하면 꼭 까먹는 우산! · 원룸 살 때 제일 애매한 게 우산꽂이였어요. · 좁은 현관에 우산꽂이까지 놓기 싫잖아요.

Invented experiences or results (한 달 써 보니, 붙였더니 …, 바꿨더니 …) are rejected anywhere in the script. Reviewer edits are not held to the hook-style rules, because the reviewer decides; fact and claim rules still apply to edits.

### Numbers and measurements (strict)
- Every number must appear in 확인된 기능 or 상품명.
- Dimension tuples must match a verified tuple exactly. `190x55x50mm` and `190×55×50mm` are the same tuple.
- 상단 and 하단 values must not be swapped.
- Units must match: `82cm` is rejected when the fact says `82mm`. Korean unit words such as 센치 and 밀리 are read as units.
- Any amount in 원 is rejected.

### Wording
- No exaggerated phrases (`최저가`, `100%`, `무조건`, `완벽`, `1위`, `품절 임박`, …). See `CONFIG.BANNED_PHRASES`.
- No URLs in viewer-facing text (links go via ManyChat DM only).

### Same rules everywhere
The same rules apply when a reviewer edits a script, when a script is regenerated and when it is approved.

### Avoiding extra paid calls
If neither attempt is fully valid, but every position has a reel that passed in one of the attempts, those reels are combined and used. This needs no third call.
