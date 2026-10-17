# Brand strategy — 서울에서 집꾸미기

These are the brand rules the factory applies to every script. They live in **`RF_CONFIG.BRAND`** (`apps-script/Config.gs`), so the factory can be reused for another account by editing that block. Rebuild with `npm run build` and update the Apps Script.

## Identity

| | |
|---|---|
| Name | 서울에서 집꾸미기 |
| Positioning | Beautiful and practical home products that solve everyday problems, especially for small living spaces, without unnecessary purchases |
| Tagline | 우리 집에 들이기 전에, 먼저 보여드릴게요. |
| Personality | Natural, relatable, practical, warm, conversational. No generic sales pitch. |
| Differentiators | AI interior visualization (always labelled "AI 시뮬레이션"), practical home products, and occasional real stories of a Korean wife and her foreign husband in Seoul |
| Current focus (`CURRENT_FOCUS`) | First month: small-space living and practical home organization |

## Content pillars

Each reel has one pillar. Gemini picks one, and the reviewer can change it in the dashboard editor. It is stored in REELS `콘텐츠 기둥`.

| Id | Pillar | Target share | Notes |
|---|---|---|---|
| `AI_MAKEOVER` | AI 공간 변신 | 35% | AI scenes are marked `ai_visualization` and labelled "AI 시뮬레이션" on screen and in the caption. |
| `PRODUCT_DISCOVERY` | 생활 꿀템 발견 | 35% | The default for product reels. |
| `INTL_COUPLE` | 국제부부 한국살이 | 20% | Real events only. Always flagged for manual verification. |
| `COMPARE` | 살까 말까 비교 연구소 | 10% | No comparisons or test results beyond verified facts. Always flagged. |

The percentages are **editorial planning targets for the whole account**, not a rule for each product. The dashboard's ① 상품 tab shows the current mix next to the targets.

## Script logic

Every product reel follows **PROBLEM → EMPATHY → SOLUTION → DEMONSTRATION → CTA**.

| Story step | Scene `beat` | What it does |
|---|---|---|
| PROBLEM | `HOOK` | A relatable problem in the first 0–3 s, ≤ 25 characters. Not a feature list, not the product name. |
| EMPATHY | `EMPATHY` | Why the situation is annoying. |
| SOLUTION | `SOLUTION` | The product appears naturally. |
| DEMONSTRATION | `DEMO` | Verified features only, each scene citing fact IDs (`F1`…). |
| CTA | `CTA` | Asks viewers to comment the keyword (`{키워드}`). |

- **Five hooks per product, the final pick is yours:** H1 질문형, H2 숫자로 시작하는형, H3 통념을 뒤집는 단정형, H4 상황 묘사형 and H5 결론 먼저 던지는형.
  - Gemini recommends one and explains why, and the script starts with it.
  - You choose (and may edit) the final hook in the dashboard. Approval requires that choice.
  - Full specification and the PRD-001 reference: [five-hook-workflow.md](five-hook-workflow.md).
- **PRD-001 example hooks:**
  - 급하게 출근할 때마다 우산 깜빡하는 사람?
  - 원룸 살면 우산꽂이 둘 자리도 애매하잖아요.
  - 비 오는 날마다 현관이 지저분해지는 이유.
- **Length:** 20–40 s, set by the content and never padded. Timing is re-checked on the real Korean TTS voice before rendering.
- **Rejected hook styles:** ad style (`~니다`), generic questions (`~다면?`, `~하시나요?`), sales words (`하나로`, `소개`, `추천`, `필수템`), result promises, and numbers or specs.

Older rows (HOOK → PROBLEM → DEMO → BENEFIT → CTA) stay valid.

## Truthfulness and compliance

| Rule | How it is enforced |
|---|---|
| Only verified product features | Fact IDs; claim rules (features, compatibility, performance, material, price, reviews, colours); exact dimensions. See [sheets-schema.md](sheets-schema.md#validation-rules-applied-to-gemini-output). |
| Don't invent experiences, purchases, tests, husband reactions or before/after results | Rejected in Gemini output (`체험·결과`): 써 보니, 샀는데, 테스트해 보니, 남편이 … 놀랐어요, 붙였더니 … |
| Content that needs real experience or testing is checked before approval | **Verification flags** (below). Approval is refused until the reviewer ticks *모두 확인했습니다*. |
| AI visualization is labelled "AI 시뮬레이션" | Scenes with `ai_visualization` get the on-screen text automatically. The renderer burns a small label over every AI-generated shot (Google Flow footage) and every AI-visualization scene. Post-render QC `ai.label` fails if any AI shot lacks it. The caption adds "※ 일부 장면은 AI 시뮬레이션이에요." |
| AI scenes are distinguished from real product footage | The render manifest records `aiGenerated` per cut. Own footage is not labelled unless the scene is an AI visualization. |
| No third-party footage without permission | Unchanged. Marketplace sources are rejected; `licensed` needs `rights`; PRODUCTS `영상 사용 허가 상태` is checked before production. |
| Coupang Partners disclosure in captions | Unchanged. The caption's first line is `[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로 …`. |
| No placeholder slides | Unchanged. Missing footage → `ASSETS_REQUIRED`. |

### Verification flags

Flags are computed from the current script every time, so an edit made in the sheet is seen too. They are written to REELS `확인 필요` and shown in the dashboard.

| Flag | Triggered by |
|---|---|
| 개인 경험 | 저는, 제가, 우리 집, 직접 써…, 샀어요, 구매했 … |
| 제품 테스트 | 테스트, 실험, 측정 … |
| 국제부부 이야기 | 남편, 아내, 와이프, 국제부부 …, or the 국제부부 한국살이 pillar |
| 전후 결과 | 비포/애프터, 달라졌, 넓어졌, 깔끔해졌 … |
| 비교 | 비교, vs, …보다 더, or the 살까 말까 비교 연구소 pillar |
| AI 시뮬레이션 | an `ai_visualization` scene, or the AI 공간 변신 pillar |
| Gemini 요청 | anything Gemini listed in `needs_verification` |

A reviewer may write a real personal line in an edit, such as their own experience. It is not rejected, but it is flagged and has to be confirmed. The confirmation is recorded in AUDIT.

## Four manual checkpoints (unchanged)

1. Product selection and affiliate URL (PRODUCTS).
2. Script review, editing and approval (dashboard ②), including confirming the flags.
3. Final video review and approval (dashboard ③).
4. Instagram publishing and ManyChat setup (dashboard ④).

Nothing paid happens before `SCRIPT_APPROVED`. Google Flow stays a manual step. Narration uses Google Cloud TTS and rendering uses FFmpeg. Google Sheets remains the database.
