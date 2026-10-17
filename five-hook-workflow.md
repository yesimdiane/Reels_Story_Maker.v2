# Five-hook short-form workflow (reference: PRD-001)

Every product reel is made this way. The reference output is `FIXTURE_PRD_001_GEMINI_RESPONSE` in `apps-script/Fixtures.gs`. It is the PRD-001 umbrella-holder result the operator approved.

```
① PRODUCTS row (verified facts, affiliate URL)            ← operator (checkpoint 1)
② Gemini: five hooks H1–H5 + recommended hook + reason
          + one script built on the recommended hook        ← 1 call (+ at most 1 corrective retry)
③ Dashboard: operator picks the final hook, may edit it     ← operator (checkpoint 2)
     · "이 훅으로 정하기" — free: the whole first scene becomes that hook's opening
                          (line, caption, visual, Flow prompt, emphasis, SFX); scenes 2+ stay
     · "대본 다시 쓰기"   — 1 Gemini call: the whole script is rewritten around the hook
   Scripts written before this workflow: "훅 5개 만들기" (1 Gemini call, script unchanged) first.
④ Operator reviews the updated script, ticks "끝까지 확인했습니다", approves → SCRIPT_APPROVED
   (approval needs: five hooks, a choice made on THIS script version, and the review tick)
   (only now: Flow prompts, Google Flow by hand, paid TTS, rendering)
⑤ Gemini production plan (after approval; Flow prompts matched to verified product images, voice pace, cuts) → Drive clip folder → Flow clips by hand
   → see [gemini-orchestration.md](gemini-orchestration.md)
⑤ Renderer: TTS → scene timing checked on the real voice → FFmpeg → QC → Gemini's advisory final check
⑥ Final video review → publishing pack (caption with [광고]) → ManyChat   ← checkpoints 3 and 4
```

## The five hooks

All five hooks are ≤ 25 characters, so they can be said in the first 2–3 seconds. Each one opens with a relatable problem in plain spoken Korean that a child could follow: no jargon, no product name first, no feature list.

Each type is judged by its **meaning**, not by exact phrases. A hook that does not clearly fit its type gets a *style warning*; it is never rejected for that.

| Id | Type | Meaning looked for (a warning if absent) | Examples |
|---|---|---|---|
| H1 | Question (질문형) | Sounds like a question to the viewer. | 급하게 출근할 때마다 우산 깜빡하는 사람? |
| H2 | Number-led (숫자로 시작하는형) | Contains a number backed by the facts: a number written in 확인된 기능, or the size of a list in a fact (`상단·하단` → 두, `다크그레이, 그레이, 화이트` → 세). **Invented numbers or statistics (`10명 중 9명`, `%`, `배`) are errors.** | 두 조각만 문에 붙이면 바닥이 비어요 |
| H3 | Myth-busting (통념을 뒤집는 단정형) | Overturns a common belief or habit: negation, contrast, 원래/사실/굳이/말고/필요 없어요 … | 현관 우산 자리, 바닥이 아니에요 · 좁은 현관 바닥엔 원래 우산 자리 없어요 |
| H4 | Relatable situation (상황 묘사형) | A concrete moment: when and where. | 비 오는 날, 현관에 젖은 우산이 굴러다녀요 ★ |
| H5 | Conclusion-first (결론 먼저 던지는형) | States the solution first: `~면 돼요`, `그냥/바로 …`, or an action ending (붙여요, 걸어요 …). | 좁은 현관 우산 정리, 문에 붙이면 돼요 · 정리 안 되는 우산은 그냥 문에 붙여요 |

### Hard errors vs. style warnings

| | Hard errors (block saving) | Style warnings (stored, shown in the dashboard) |
|---|---|---|
| Structure | invalid JSON, not exactly H1–H5 once each, wrong `type`, empty text, missing opening `visual`/`flow_prompt`, two identical hooks, no recommended hook or reason | — |
| Truthfulness | claims, compatibility, measurements or numbers not in the verified facts; invented statistics; banned or exaggerated phrases; URLs; result promises (`~이 달라져요`) | — |
| Editorial | — | longer than 25 characters, opens with the product name, ad tone (`~니다`, `~하세요`, 추천/소개/필수템), generic questions, weak fit to the hook type, same first words as another hook, repeats an earlier hook of this product |

### Fewest possible Gemini calls

1. One call writes five hooks + the script.
2. Style warnings alone **never** trigger a retry. If `HOOK_STYLE.AUTO_REVISE_WEAK` is on, one *targeted* call rewrites only the non-recommended hooks that have a warning or hard error (prompt lists just those hooks and their problems; schema allows only those ids). A rewrite replaces a hook only if it has no hard errors and fewer warnings. Otherwise the original safe hook is kept.
3. The full corrective retry is used only for script errors, set-level errors, or a hard error on the **recommended** hook (the script starts with it).
4. At most `MAX_GEMINI_CALLS_PER_RUN` (3) calls per generation.
5. In the dashboard, a hook with a ⚠ warning has **이 훅만 다듬기 (Gemini 1회)**. Only that hook changes; the other four hooks, the script and a choice on another hook stay.

The set must also pass these checks:
- **No identical hooks.** Hooks opening with the same two words, or repeating an earlier hook of this product (listed in the prompt), only get a warning.
- **Facts:** the fact, claim and number rules apply, so there are no invented features, compatibility, prices or dimensions.

Each hook also carries **its own opening scene**: `visual`, `flow_prompt`, `emphasis` and `sfx` for scene 1. Gemini writes scenes 2 onward so that they follow any of the five hooks.

Gemini recommends one hook (`recommended_hook.id` plus a reason), and its script starts with exactly that hook and its opening. **The final choice is the operator's.** Approval is refused unless:
1. the script has five hook candidates;
2. a hook was chosen on the current script version, and the script's first line equals it;
3. the operator ticked *선택한 훅이 반영된 대본 vN을 끝까지 확인했습니다* (`hookReviewed`).

An edit that keeps the hook carries the choice over to the new version.

## The script

The story is HOOK (= PROBLEM) → EMPATHY → SOLUTION → DEMO (= DEMONSTRATION, 1–2 scenes) → CTA. A BENEFIT scene after DEMO is optional.

| Field (per scene) | Content |
|---|---|
| `narration` | The line spoken in this scene, which is also its subtitle (≤ 30 characters) |
| `duration_sec` | 2–6 s. The total is **20–40 s, set by the content and never padded** |
| `visual` | Visual direction: first frame, close-up / POV / wide, hand action |
| `emphasis` | Subtitle emphasis, e.g. `'쏙' 통통 튀는 효과` |
| `sfx` | Sound effect, e.g. `착`, `쏙`, or empty |
| `flow_prompt` | English Google Flow prompt, generated by hand after approval |
| `fact_ids` | Verified facts this scene uses (`F1`…). DEMO and BENEFIT need at least one |
| `ai_visualization` | `true` for an AI interior visualization. The video is labelled "AI 시뮬레이션" |

Per reel, the script also carries `pillar`, `facts_used` and `needs_verification`, plus the comment keyword.

- **Comment keyword:** a simple customer-facing word (`우산`). The order of preference is:
  1. PRODUCTS `ManyChat 키워드`;
  2. this product's existing simple keyword;
  3. Gemini's suggestion, if no other product uses it;
  4. only otherwise, the internal code (`PRD001R01`) with a review note.

  The internal 릴스ID (`PRD-001-R01`) stays for tracking.
- **Affiliate disclosure:** added by code. The publishing caption's first line is `[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로 …`.

### Timing on the real voice

Scene lengths in the script are estimates. The renderer runs these steps, in this order, and only after approval:

1. **Predict clips (before TTS):** each scene's length is predicted from its narration, to plan Flow clip coverage.
2. **TTS:** the voice is synthesised (cached per line).
3. **`ttsTiming` QC, before FFmpeg:**
   - Each scene is stretched to fit its real voice; a stretch over 1 s is a warning.
   - The total must stay within 20–40 s. Outside that range, the render stops before anything is rendered. The cached voice makes a re-run free.
4. **Render and post-render QC.**

The free local preview voice (`--preview`) shows the timing before paying for Google TTS.

## Storage (Google Sheets, REELS)

| Column | Content |
|---|---|
| `훅 후보(JSON)` | `{ hooks: [{id, type, label, text} ×5], recommended: {id, reason} }`, written at generation |
| `선택한 훅` | `{ id, label, text, edited, recommended, scriptVersion, mode, by, at }`, where `mode` is `kept`, `swapped`, `regenerated` or `edited` (written by 직접 수정). Written when the operator chooses, and stored with the script version it applies to |
| `후킹` | The script's hook, the first spoken line |
| AUDIT `SELECT_HOOK` | Who chose which hook, the text, and how (kept, swapped, or rewritten by Gemini) |

Both hook columns are added by **시트 준비**, which appends them without touching existing cells. Generation checks for them **before** calling Gemini and asks for 시트 준비 if they are missing. Older REELS rows without hook candidates keep working; they need no hook choice.

## Troubleshooting: "the script review screen has no hook section"

| Check | Fix |
|---|---|
| The dashboard header shows `코드 2026-10-09 · hook-check 3` (or newer) | If it shows `코드 이전 버전`, an older version is deployed. Paste the current `dist/ReelsFactory.gs` from **`main`**, then **Deploy → Manage deployments → ✏️ → New version → Deploy**. The `/exec` URL keeps serving the old version until you redeploy. |
| The menu **릴스 팩토리 → 코드 버전 확인** shows the same version as the dashboard | A different version means the code was pasted but the web app was not redeployed. |
| REELS has the `훅 후보(JSON)` and `선택한 훅` columns | Run **시트 준비** once. Until then the hook section shows a red banner and approval is blocked. |
| The script has no hook candidates (written before this workflow) | The hook section shows **훅 5개 만들기 (Gemini 1회)**. Tap it, choose a hook, review, approve. |

## Cost and safety

- **Generation:** one Gemini call (plus at most one corrective retry) for five hooks and the script. Choosing or editing a hook is free. "대본 다시 쓰기" and "훅 5개 만들기" are one call each (plus at most one retry). All of these are text only.
- **No paid steps before approval:** nothing paid or video-related happens before `SCRIPT_APPROVED`. That covers Flow prompts, Flow generation, TTS and rendering.
- **No substitute footage:** missing footage is never replaced by slides or invented product demos. Missing clips → `ASSETS_REQUIRED`. AI footage is labelled "AI 시뮬레이션" on screen.
