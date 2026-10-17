# Setup — Sheets → Gemini → 3 reel scripts

## Easiest install (about 10 minutes, no tools)

You only paste **one file**. Nothing in your existing PRODUCTS tab is changed.

1. **Get a Gemini API key.** Go to [Google AI Studio → API keys](https://aistudio.google.com/apikey), click **Create API key**, and copy it.
   Keep it private: don't paste it into the sheet, a chat, or an email.
2. **Open the script editor.** Open your workbook, then go to **Extensions → Apps Script**. A new browser tab opens.
3. **Paste the code.**
   - In the left panel, click **＋** next to *Files* → **Script**, and name it `ReelsFactory`.
   - Open [`dist/ReelsFactory.gs`](../dist/ReelsFactory.gs) on GitHub, click **Copy raw file** (the copy icon), and paste it into the new file, replacing the empty `function myFunction() {}`.
   - Click **💾 Save**.
   - If the left panel already had a file with its own `function onOpen()`, see [Existing Apps Script code](#existing-apps-script-code) before continuing.
4. **Reload the spreadsheet tab.** After a few seconds a **릴스 팩토리** menu appears to the right of *Help*.
5. **Allow access.** Click **릴스 팩토리 → Gemini API 키 설정**. Google asks for permission the first time:
   - Choose your account.
   - If you see **"Google hasn't verified this app"**, click **Advanced → Go to (project name) (unsafe)**. This is normal: the script is your own, inside your workbook, and was never published.
   - Click **Allow**. Then click the menu item again, paste the API key, and press **OK**.
6. **Prepare the sheets.** Click **릴스 팩토리 → 시트 준비**. The result window should show ✓ PRODUCTS and ✓ for REELS / PERFORMANCE / LOG.
7. **Test without spending API calls.** Click **릴스 팩토리 → 테스트: PRD-001 오프라인 검증**. It should say **통과**.
8. **Use it.** Click any cell in a product row in PRODUCTS, then click **릴스 팩토리 → 선택한 상품으로 훅 5개 + 대본 생성**. After about 10–60 seconds, a new row appears in REELS with five hooks and a script. Choose the final hook in the iPhone dashboard.

**To update later**, follow [Updating an existing installation](#updating-an-existing-installation-keeps-all-sheet-data). It replaces only the code; your sheets are not touched.

**Next: approve on your iPhone.** Follow [iphone-dashboard.md](iphone-dashboard.md) to deploy the approval dashboard.

## Updating an existing installation (keeps all sheet data)

The code lives in the Apps Script project. Your data lives in the sheets. Replacing the code never deletes or rewrites PRODUCTS, REELS, AUDIT, LOG or PERFORMANCE. Script Properties are also kept: the Gemini key, `RF_REVIEWERS` and `RF_RENDER_SECRET`.

1. **Optional backup:** **File → Make a copy** of the workbook, or **File → Version history → Name current version**.
2. Open the workbook, then **Extensions → Apps Script**.
3. In the left panel, click the file `ReelsFactory` (the one you pasted before). **Do not delete the project, and do not create a second copy of the code.** Two files defining the same functions would conflict.
4. Click inside the code, press **⌘A** (Mac) or **Ctrl+A**, and then **Delete**. The file is now empty.
5. Open [`dist/ReelsFactory.gs`](../dist/ReelsFactory.gs) on GitHub (on the `main` branch after the PR is merged, or on the PR's branch to try it first). Click **Copy raw file**, paste it into the empty file, and click **💾 Save**.
   - To check you have the new code, run **릴스 팩토리 → 코드 버전 확인** after step 7. It shows the version (e.g. `2026-10-11 · flow-media-workspace 5`).
   - Always copy from the **`main`** branch after the PR is merged. A PR merged into another branch does not reach `main`.
6. The iPhone dashboard page is inside this same file, so there is nothing else to paste. Leave any other files in the project as they are.
7. Reload the spreadsheet tab. In the **릴스 팩토리** menu:
   - run **테스트: PRD-001 오프라인 검증**. It should say 통과, with no API call.
   - Optionally run **Gemini 모델 확인 (무료)**.
8. **If you use the iPhone dashboard:** **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same, but until you redeploy the dashboard keeps running the old code. Check it: the dashboard header must show the same `코드 …` version as step 5.
9. **Required once:** run **릴스 팩토리 → 시트 준비** and answer **예**. It adds the REELS columns `콘텐츠 기둥`, `확인 필요`, `훅 후보(JSON)`, `선택한 훅`, `제작 계획(JSON)`, `에셋 현황(JSON)` and `장면 클립(JSON)` at the right end of row 1. Existing cells are never changed.
   - Until you do, existing scripts can still be reviewed, approved and rendered. New generation stops **before** calling Gemini and asks for 시트 준비, so no paid hooks are lost.

Existing REELS rows keep working. Their `사용한 확인 기능` text still resolves to your facts, so they can still be approved, edited and rendered.

## Before you start: things that can block installation in an existing workbook

| Check | What goes wrong | Fix |
|---|---|---|
| The product tab is named **PRODUCTS** | *"PRODUCTS 시트를 찾을 수 없습니다"* | Rename the tab. Extra spaces and upper/lower case are tolerated (`Products ` works); a Korean name like `상품` is not. |
| Headers are in **row 1** of PRODUCTS | Missing-header error, even though the headers exist | Headers must be in row 1. A title row above them breaks lookup. Spaces inside a header are tolerated (`상품 ID` = `상품ID`), but the words must match. |
| **확인된 기능** has one fact per line | Script rejected as "확인되지 않은 기능" | Put each fact on its own line in the cell (Ctrl/⌘ + Enter inside the cell), or separate facts with `;`. |
| You are an **editor** of the workbook | The menu never appears | Viewers and commenters can't run scripts. |
| **Work / school Google account** | *"This app is blocked"*, or *Allow* is greyed out | Your Workspace admin restricts Apps Script or external requests. Ask them to allow Apps Script for your account, or use a personal Gmail copy of the workbook. |
| A tab named **REELS**, **PERFORMANCE** or **LOG** already exists with different headers | Generation stops with a missing-header error | Run **시트 준비**. It asks before adding only the missing headers to the right end of row 1. Existing cells are never changed. |
| Old Apps Script project (pre-2020) | `SyntaxError` on save | In **Project Settings ⚙**, tick **Enable Chrome V8 runtime**. |
| Gemini model retired | *"Gemini API 오류 HTTP 404 … 모델을 사용할 수 없습니다"* | The default is `gemini-3.5-flash`. On a 404 the script falls back to `gemini-flash-latest` once (a 404 is not billed) and logs a WARN. To pin another model, add the Script Property `GEMINI_MODEL`. Check with **Gemini 모델 확인 (무료)** — see [cost-safety.md](cost-safety.md#1-gemini-model). |

### Existing Apps Script code

If the workbook already has Apps Script code:

- **Another `function onOpen()`:** Apps Script keeps only one of them, so one menu would silently disappear.
  Delete the `onOpen` at the bottom of `ReelsFactory`, and add this line inside your existing `onOpen()`:
  ```js
  addReelsFactoryMenu();
  ```
- **Your project lists `oauthScopes` in `appsscript.json`** (you'd know if you set this up): add
  `"https://www.googleapis.com/auth/script.external_request"` and
  `"https://www.googleapis.com/auth/script.container.ui"` to that list. Otherwise the Gemini call fails with a permission error.
- All Reels Factory constants are prefixed `RF_` / `FIXTURE_` to avoid name clashes with your code.

## Settings (Script Properties)

These are under Apps Script → **Project Settings ⚙ → Script Properties**.

| Property | Required | Default | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | — | Set it via the menu or here. It is never stored in the sheet or in Git. |
| `GEMINI_MODEL` | no | `gemini-3.5-flash` | Any model ID that supports `generateContent` with a JSON `responseSchema`. |
| `GEMINI_IMAGE_MODEL` | no | `gemini-2.5-flash-image` | Model ID for 9:16 vertical storyboard image generation using reference image bytes. |
| `GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE` | no | — (Cost estimate unavailable) | Configurable estimated price per generated image in USD (e.g. `0.04`). Shown in confirmation warnings. |
| `RF_DRIVE_FOLDER_ID` | no | a folder named `Reels Factory` in My Drive (created if missing) | Pin the Drive root folder for the per-reel clip folders. |

## Permissions requested

- **See, edit… spreadsheets that this application has been installed in.** Only this workbook (`@OnlyCurrentDoc`).
- **Connect to an external service.** Used only to call `generativelanguage.googleapis.com` (Gemini).
- **Display and run third-party web content in prompts and sidebars.** Used for the menu dialogs.
- **See, edit, create and delete all of your Google Drive files** (`drive`, added with the production planner). It is needed to read the product images you list, to create the per-reel folder, and to see the clips you upload there (the narrower `drive.file` scope cannot see files you upload yourself). The code only reads images, creates folders and lists files; it never deletes or edits Drive files. After updating, open the menu once and **authorize again**; for the web app, redeploy a new version and approve the new permission.

## Developer install (clasp, multi-file)

```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID> --rootDir apps-script   # creates .clasp.json (git-ignored)
clasp push                                       # pushes apps-script/*.gs + appsscript.json
```

Use either the bundle **or** the multi-file sources in a given project, not both: duplicate `const` declarations would stop the whole project from loading.

After editing `apps-script/*.gs`, run `npm run build` to regenerate `dist/ReelsFactory.gs`. The tests fail if you forget.

## Tests

### Local (no Google account, no API key)

```bash
npm test
```

Requires Node.js ≥ 20 and has no dependencies. It runs three test files:

- `tests/reels.test.js`: validation, IDs, ManyChat keywords and the prompt, using the PRD-001 fixture.
- `tests/workflow.test.js`: the menu actions, run from the **installed bundle** against in-memory Sheets / Gemini mocks. It covers:
  - PRODUCTS is never modified.
  - Writes are done by header name.
  - Spaced headers and tab names are handled.
  - Retry and failure paths work, including network timeouts.
  - Duplicate checks run.
  - 시트 준비 behaves correctly.
- `tests/bundle.test.js`: `dist/ReelsFactory.gs` is up to date and has no duplicate top-level names.
- `tests/states.test.js`: every approval gate in the state machine.
- `tests/webapp.test.js`: the iPhone dashboard API, run from the bundle. It covers:
  - access control;
  - the full lifecycle through all 4 touchpoints;
  - the audit trail;
  - legacy MVP rows;
  - regeneration;
  - no key or link leaks.

### In the spreadsheet

- **테스트: PRD-001 오프라인 검증** validates the bundled sample response. It makes no API call and writes nothing to the sheets.
- **Gemini 모델 확인 (무료)** checks with `models.get` that the configured model and its fallback exist and support `generateContent`. It is not billed.
- **테스트: PRD-001 Gemini 실제 호출 (시트에 쓰지 않음)** calls Gemini with the PRD-001 fixture and validates the real response. It writes only to LOG.
- From a terminal: `GEMINI_API_KEY=<key> npm run gemini:check` (free) or `… -- --generate` (one paid call). See [cost-safety.md](cost-safety.md#testing-the-model-against-the-real-api).

### PRD-001 manual acceptance test

Add this row to PRODUCTS (if PRD-001 is not already there), select it, and run the generate menu:

| 상품ID | 상품명 | 확인된 기능 (one per line) | 영상 사용 허가 상태 |
|---|---|---|---|
| PRD-001 | 리템 우산꽂이 자석형 | 호환되는 철제 표면에 자석으로 부착 가능<br>상단·하단 분리형 (상단 190×55×50mm, 하단 188×55×82mm)<br>장우산과 접이식 우산 모두 수납 가능<br>색상: 다크그레이, 그레이, 화이트 | 미확인 |

Expected results:
- REELS gains `PRD-001-R01..R03` (or the next free numbers) with keywords `PRD001R01..R03`. Each row has:
  - the affiliate disclosure,
  - a CTA containing its keyword,
  - `Flow 생성 = 수동 생성 필요 …`,
  - a 검토 메모 warning that video permission is unverified.
- No number other than 190, 55, 50, 188 and 82 appears in hooks, narration, captions or on-screen text.
- PRODUCTS is unchanged.

If generation fails, open the **LOG** tab. The 상세 column lists every rejected rule and the raw Gemini response.
