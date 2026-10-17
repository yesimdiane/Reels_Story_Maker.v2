# Cost safety: Gemini model, Google Flow clip length, Google Cloud TTS

Three things that cost money, and what protects each one.

## 1. Gemini model

**Default:** `gemini-3.5-flash` (`RF_CONFIG.DEFAULT_GEMINI_MODEL`). It is a generally available Flash model that supports `generateContent` with `responseMimeType: application/json` and a `responseSchema` (structured output). Override it with the Script Property `GEMINI_MODEL`.

**If the model disappears:** when Google answers **HTTP 404** for the configured model, the script tries `gemini-flash-latest` (the alias that always points at the current Flash model) and writes a `WARN` to LOG naming both models. Only 404 triggers this. A 404 means nothing was generated, so nothing was billed. Other errors (quota, safety block, bad key) are never retried on another model, so one request is never paid twice. The model actually used is written to REELS `생성 모델` and AUDIT.

### Testing the model against the real API

From cheapest to most complete:

1. **In the spreadsheet (free):** **릴스 팩토리 → Gemini 모델 확인 (무료)**. This calls `models.get` for the configured model and each fallback. It shows whether each model exists and supports `generateContent`. `models.get` does not generate anything and is not billed.
2. **From the Mac terminal (free):**
   ```bash
   GEMINI_API_KEY=<your AI Studio key> npm run gemini:check
   ```
   This makes the same `models.get` check, using the same model chain as the Apps Script. Add `GEMINI_MODEL=<id>` to try another model.
3. **One real generation (one paid call, about 2–4k tokens):**
   ```bash
   GEMINI_API_KEY=<key> npm run gemini:check -- --generate
   ```
   This sends the real PRD-001 prompt and JSON schema, then runs the same validation as the sheet: five hooks, the recommended hook, one script, facts, numbers, storyboard and keyword. It prints the five hooks (★ = recommended) or any errors. Nothing is written to the sheet.
4. **In the spreadsheet (one paid call):** **테스트: PRD-001 Gemini 실제 호출 (시트에 쓰지 않음)**. The same check runs inside Apps Script. The result goes to LOG only.

Equivalent raw requests, for debugging. The key goes in a header, never in the URL:
```bash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' \
  https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent \
  -d '{"contents":[{"parts":[{"text":"JSON으로 {\"ok\": true} 만 답하세요"}]}],
       "generationConfig":{"responseMimeType":"application/json",
       "responseSchema":{"type":"OBJECT","properties":{"ok":{"type":"BOOLEAN"}},"required":["ok"]}}}'
```
Do not paste the key into chats or commit it. In Apps Script it lives only in Script Properties (`GEMINI_API_KEY`).

### Gemini production planning and the final check

Both are text/image calls that happen **only after `SCRIPT_APPROVED`**: the production plan (1 call, +1 corrective retry at most, product images attached) and the renderer's advisory final check (1 call, one small frame per scene). Before any planning call the code checks: approved and unchanged script, REELS columns present, product images readable — each failure costs nothing. See [gemini-orchestration.md](gemini-orchestration.md).

### Gemini 2.5 Flash Image storyboard generation (9:16)

Storyboard image generation uses `gemini-2.5-flash-image` with actual reference photo bytes inline:
- **Transparent confirmation warning:** Before calling the paid image API, the dashboard displays a confirmation dialog showing:
  - Exact count of images to generate (1 for single scene, or batch count);
  - Model name (`gemini-2.5-flash-image` or configured model);
  - Estimated total cost in USD (from configurable `GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE`, labeled as estimate), or *"Cost estimate unavailable"* if unconfigured (never an invented price);
  - Warning that actual charges may differ and failed/retried calls may incur charges.
- **Explicit confirmation gate:** Cancelling in the dialog results in zero generation calls. The server requires `confirmedBilling: true`.
- **In-flight duplicate guard:** Accidental double submissions are prevented while generation is running.

## 2. Google Flow clips are 8 seconds

A scene has to be covered by its clip, otherwise the cuts would have to repeat footage. Coverage is enforced at three points, so an impossible render plan cannot be built:

| When | Check | On failure |
|---|---|---|
| Gemini output validation (before anything is written) | Every scene is 2–6 s. The cap is `min(SCENE_MAX_SEC, CLIP_SEC − CLIP_MARGIN_SEC)` = min(6, 8 − 0.5), so it always fits one clip. | One corrective retry, then the error goes to LOG and nothing is written. |
| Flow prompts on approval | `flowClipParts(sec) = ceil(sec / 7.5)` clips per scene, normally 1. If `CLIP_SEC` is ever lowered, a long scene gets `S3.mp4` + `S3b.mp4`, each with a `PART k of N` prompt. | — |
| Renderer, **before TTS** | The scene length is predicted from its narration: the real cached voice length if the line was already synthesised (free), otherwise a slow 4.5 chars/s. A scene that would outgrow 7.5 s is split into extra clips (`S3b.mp4`) in `SHOTLIST.md` / `FLOW_PROMPTS.md`. QC check `flow.coverage`. | `ASSETS_REQUIRED` (exit 3), zero TTS calls |
| Renderer, **after TTS** | The plan is checked again with the real voice lengths. Then each clip must hold all of its cuts (the sum of its cut durations ≤ clip length − 0.1 s). | `ASSETS_REQUIRED` naming the extra or longer clip. The narration is already cached, so the rerun costs $0. |

Clip checks also require each clip to be at least its covered length + 0.5 s (and ≥ 4 s), at most the full 8 s.

## 3. Google Cloud Text-to-Speech

### What the renderer does

- **TTS happens only after the paid-step gates pass:** a signed job, the approved fingerprint, the storyboard, pre-flight QC, complete footage, the font, and an FFmpeg check. Paid narration is never generated for a render that would fail anyway.
- **Per-line cache:** `~/.reels-factory/cache/<sha256(provider, voice, rate, text)>.wav`. Each line is saved **as soon as it arrives**, through a temp file plus an atomic rename. A run that crashes or loses the network half-way pays again only for the lines it never received. Re-renders, template changes and new footage cost $0 in TTS.
- **Retries:** Google TTS is retried only on **429** and **503**, the cases where Google refused the request before synthesising it. It makes at most 3 attempts. A **500**, or a network error after the request was sent, is **not** re-sent automatically. The audio may already have been produced and billed, so the error is shown and the next run decides.
- **No double requests:** an exclusive per-line lock file (`<line>.wav.lock`) means that if two renders need the same line at the same time, one calls Google and the other waits and reuses its file. Two renders could be, for example, a `pending --watch` pass and a manual `render`. A lock left by a crashed run expires after 5 minutes. `pending --watch` also never starts a new pass while the previous one is still running.
- **Local caps:** `RF_TTS_MAX_CHARS_PER_JOB` (default 1500) and `RF_TTS_MONTHLY_CHAR_LIMIT` (default 500,000) are checked **before** the first request. The monthly cap is checked again before every retry.

### The local ledger is NOT your Google Cloud bill

`~/.reels-factory/tts-usage.json` (`npm run render:usage`) is a **local safety counter**, not billing data.

- **What it records:** every request this machine **sent** to a paid voice, written before the answer arrives. Retries and failed requests are included, so it can only over-count this machine's usage.
- **What it does not know:**
  - other machines, the cloud renderer (unless `RF_STATE_DIR` is shared), or anything else using the same Google Cloud project or key;
  - Google's free tier, rounding, price changes and taxes.
- **Deleting it** resets the local cap. Google keeps billing.
- **The real numbers are in Google Cloud:**
  - **Billing → Reports**: filter *Service = Cloud Text-to-Speech API*. It is usually delayed by a few hours.
  - **APIs & Services → Cloud Text-to-Speech API → Metrics**: requests per method and errors.

### Recommended Google Cloud settings (once, about 10 minutes)

1. **A separate project for the renderer.** Then its bill, quotas and key affect nothing else.
2. **Restrict the API key:**
   - **APIs & Services → Credentials → your key → API restrictions → Restrict key**, and select only **Cloud Text-to-Speech API**.
   - For a Mac with a fixed IP, you can also add **Application restrictions → IP addresses**.
3. **Lower the API quota** so that a runaway script cannot make many requests:
   - Open **APIs & Services → Cloud Text-to-Speech API → Quotas & System Limits** (or **IAM & Admin → Quotas**, filter *Text-to-Speech*).
   - Select **Requests per minute** (per project), then **Edit quota**, and set a low value, e.g. **30**. One reel needs about 5 requests.
   - TTS quotas count **requests, not characters**. The character limit is the renderer's local cap above, together with Google's per-request size limit.
4. **Budget and alerts:**
   - Open **Billing → Budgets & alerts → Create budget**.
   - Scope it to this project and the *Cloud Text-to-Speech API* service.
   - Set an amount such as ₩5,000 per month, with alert thresholds at 50%, 90% and 100% (actual) plus 100% (forecasted), and email to billing admins.
   - **A budget only notifies. It does not stop spending**, and alerts can arrive hours after the usage.
5. **Optional hard stop:** in the budget, connect a **Pub/Sub topic** under *Manage notifications*. Then deploy Google's documented Cloud Run function that **disables billing on the project** when the cost exceeds the budget. Search for "Disable billing usage with notifications" in the Cloud Billing docs. This stops **all** paid services in that project, which is another reason to use a separate project. Some accounts also offer a project-level spend cap (preview). If yours does, prefer it.
6. **Check monthly:** compare `npm run render:usage` with **Billing → Reports**. If Google shows more than the ledger, something else is using the project or key. Rotate the key.
