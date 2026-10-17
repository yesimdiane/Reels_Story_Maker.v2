# iPhone approval dashboard

A small web page that lives inside your Apps Script project. On your iPhone you can:

- review, edit, approve or reject the 3 scripts for each product;
- copy Google Flow prompts and register the finished MP4;
- watch the finished video and approve or reject it;
- copy the Instagram caption, ManyChat keyword and DM text, then confirm that you published.

Google Sheets stays the system of record. Every button writes to the **REELS** row and adds a line to **AUDIT**.

## Brand view (서울에서 집꾸미기)

- **① 상품 tab:** shows the brand name, tagline, current focus and the content-pillar mix against the targets.
- **Each script shows:**
  - its content pillar;
  - the problem-based hook (first 0–3 s);
  - the full narration and the scene-by-scene storyboard, with an **AI 시뮬레이션** chip on AI-visualization scenes;
  - the CTA and keyword, and the disclosure.
- **Verification flags:** if a script needs real-world checking (personal experience, product test, couple story, before/after, comparison, AI scene), a yellow **확인 필요** box lists the items. **승인** works only after ticking *모두 확인했습니다*.
- **직접 수정:** you can change the pillar, the hook, each scene line, the scene descriptions and Flow prompts, and tick *AI 시뮬레이션 장면* before approving.

- **① 훅 고르기** (shown first for every script under review): all five hooks with their types, each hook's opening scene, Gemini's ★추천 and its reason.
  - Pick one (or edit its wording), then tap *이 훅으로 정하기 (무료)*. The first scene's line, caption, visual and Flow prompt become that hook's. Or tap *대본 다시 쓰기 (Gemini)* to rewrite the script around it. The updated script appears below as a new version.
  - A script made before this feature shows **훅 5개 만들기 (Gemini 1회)** first. The script itself is not changed.
  - **② 대본 검토 → 승인** works only after you have chosen a hook and ticked *선택한 훅이 반영된 대본 vN을 끝까지 확인했습니다*.
  - Your choice is saved in REELS `선택한 훅`, with the script version, and in AUDIT (`SELECT_HOOK`, `SET_HOOKS`).
- **Header:** shows the deployed code version (`코드 …`). Compare it with **릴스 팩토리 → 코드 버전 확인** in Sheets; a different version means the web app needs a redeploy.
- **Scene view:** each scene shows its visual direction, subtitle emphasis and sound effect.

Details: [brand.md](brand.md), [five-hook-workflow.md](five-hook-workflow.md).

## Reels Factory v3 — 7-Step Production Pipeline

1. **상품 URL → 프로젝트 생성 / 선택:** 대시보드에서 쿠팡 또는 제품 URL을 입력하여 프로젝트를 바로 생성하거나 기존 프로젝트를 선택합니다.
2. **제품 참고 사진 4장 업로드:** 실제 제품 사진을 최대 4장 업로드하여 Google Drive에 저장합니다.
3. **대본 컨셉 3개 및 훅 5개 옵션 생성:** Gemini를 통해 5가지 유형(질문형, 숫자형, 통념 반박형, 상황 묘사용, 결론 제시형)의 훅과 대본 컨셉을 생성합니다.
4. **대본 및 훅 승인 → S1~S5 프롬프트 자동 생성:** 운영자가 훅과 대본을 검토 및 승인하면 장면별 프롬프트가 즉시 생성됩니다.
5. **장면별 이미지 & 영상 수동 제작 (무료):** 유료 API 호출 없이, 제공된 9:16 프롬프트를 복사하여 ChatGPT/Gemini에서 이미지, Google Flow에서 비디오 클립을 수동 제작합니다.
6. **5개 완성 클립 업로드 및 최종 편집 시작:** 완성된 클립을 Drive에 업로드하고, 권리 확인 컨트롤을 통해 인가 후 Mac 워커(Claude 편집 지시서 + FFmpeg + TTS)에서 최종 렌더링을 진행합니다.
7. **게시 자료 생성:** 인스타그램 캡션([광고] 표기, 후킹, AI 고지, CTA), ManyChat 댓글 키워드 및 상품 링크 포함 DM 문구를 복사하여 게시합니다.

## Your four manual steps (nothing else needs you)

| # | You do | Where | What the system blocks until you do it |
|---|---|---|---|
| ① | Pick the product. Enter the Coupang Partners link, the verified facts (one per line) and the media permission (or confirm user-created rights directly in dashboard). | Dashboard **상품** tab or Google Sheets → PRODUCTS | No scripts without facts. No video without permission. No publishing pack without a valid `link.coupang.com` / `coupa.ng` link. |
| ② | **Choose one of the five hooks** (edit its wording if you like). Then approve, edit, request changes, or reject the script. | **대본** tab → *훅 5개* | Video work starts only from the **exact approved script version**. If anyone edits the script afterwards (even directly in the sheet), video is blocked until the new version is approved. |
| ③ | Watch the finished video, then approve, request changes, or reject it. | **영상** tab | Only an approved video can become *게시 준비 완료* (ready to publish). |
| ④ | Post on Instagram, set up the ManyChat keyword, then tap both confirmations. | **게시** tab | Nothing is ever posted and no DM automation is ever switched on automatically. |

The **기록** tab and each reel's detail page show all four steps, with who did each one and when.

### 🎬 Production plan card (after approval)

On an approved reel (제작 tab) the **제작 계획** card shows: the number of verified product images, **제작 계획 만들기 (Gemini 1회)** (refused until the script is approved and product images are listed in PRODUCTS), then the planned product look with its "must match / never show" lists, risks, per-scene voice pace/pause, emphasis, cuts and what to verify in each clip. **Drive 폴더 준비/동기화** creates the reel's folder and shows which clips (`S1.mp4` …) are uploaded (`✓`/`○`). Google Flow has no public API, so you generate the clips in Flow from the prompts and upload them to that folder. Details: [gemini-orchestration.md](gemini-orchestration.md).

### 📱 Flow clip workspace (after approval)

Below the production plan card: add up to 4 verified product photos, then for each scene copy the prompt, open Google Flow, make the clip by hand, and upload it from the phone (progress bar, retry, preview). Approve or reject each clip (a replacement upload voids the old approval). **렌더 작업 파일 (Mac)** stays disabled until every clip is approved. If direct upload fails, upload with the Drive app and use *이 파일 연결*. Details, limits and what is not yet tested on real services: [media-workspace.md](media-workspace.md).

## Status flow

```
SCRIPT_REVIEW_PENDING ──approve──▶ SCRIPT_APPROVED ──start──▶ VIDEO_IN_PRODUCTION ──register MP4──▶ VIDEO_REVIEW_PENDING
   │  ▲   │                         │ (cancel approval)          │ error → VIDEO_FAILED (retry)           │
   │  │   └─reject─▶ SCRIPT_REJECTED                             ▲                                        ├─request changes─▶ VIDEO_CHANGES_REQUESTED ─▶ (start again)
   │  └─edit (v+1) / regenerate (v+1)                            │                                        ├─reject─▶ VIDEO_REJECTED
   └─request changes─▶ SCRIPT_CHANGES_REQUESTED ─────────────────┘ (no)                                   └─approve─▶ VIDEO_APPROVED
                                                                                                                       │ needs: permission, Partners link, disclosure, MP4, keyword
                                                                                                                       ▼
                                                                                    READY_TO_PUBLISH ──you confirm posted + ManyChat──▶ COMPLETED
```

## One-time setup (about 10 minutes, on a computer)

1. **Update the code.**
   - Open the workbook, then Extensions → Apps Script.
   - Replace the contents of `ReelsFactory` with the new [`dist/ReelsFactory.gs`](../dist/ReelsFactory.gs), then click Save.
   - The dashboard page is built into this one file; there is no separate HTML file to add.
2. **Prepare the sheets.** Reload the spreadsheet, then click **릴스 팩토리 → 시트 준비**.
   - The script asks before adding the new approval columns to the right end of REELS. Your existing scripts and columns are not changed.
   - It creates the **AUDIT** sheet.
   - It registers **your Google account** as the only allowed reviewer.
3. **Deploy the web app.**
   - In the Apps Script editor, click **Deploy → New deployment**.
   - Click the gear icon and choose **Web app**.
   - Description: `대시보드`.
   - **Execute as: User accessing the web app.**
   - **Who has access: Only myself.** Use *Anyone with Google account* only if a second reviewer needs access; see [Access model](#access-model).
   - Click **Deploy**, approve the permission prompt, and copy the **Web app URL** (it ends in `/exec`).
4. **Put it on your iPhone.**
   - Send yourself the URL. You can also see it later via the sheet menu **릴스 팩토리 → iPhone 대시보드 링크 보기**.
   - Open it in **Safari**, signed in to the same Google account that owns the workbook.
   - Tap **Share → Add to Home Screen**. It now opens like an app.

### After updating the code later

The `/exec` link keeps serving the **old version** until you redeploy:
Deploy → **Manage deployments** → ✏️ → Version: **New version** → Deploy. The URL stays the same.

## Access model

- **Who can open it:**
  - With *Only myself*, only the Google account that owns the script can reach the page. Everyone else is stopped by Google before any code runs.
  - The script also checks the signed-in email against the Script Property **`RF_REVIEWERS`** (comma-separated). *시트 준비* adds you automatically.
  - Anyone not on the list sees "접근할 수 없습니다" and gets no data. All write functions check this list again.
- **Adding a second reviewer:**
  - Share the workbook with them as an **editor**.
  - Add their email to `RF_REVIEWERS` (Apps Script → Project Settings → Script Properties).
  - Change the deployment to *Anyone with Google account*.
  - Their own account is used for every write, so AUDIT shows who did what.
- **What the page can see:**
  - The Gemini API key never leaves the server.
  - The Coupang Partners link appears only in the publishing pack of a reel that is ready to publish.
  - Every value from the sheet or Gemini is displayed as plain text, never as HTML.
- **No open endpoints:** there is no unauthenticated URL that can change data. Each change needs:
  - the reviewer's Google sign-in;
  - a matching current status and version (stale or double taps are rejected or ignored);
  - the document lock.

## Limitations (honest list)

- **Several Google accounts in Safari** can make Apps Script web apps fail with "Sorry, unable to open the file" or a blank page. Use a Safari profile signed in to only the workbook-owner account, or a private tab.
- **Video preview** is an embedded Google Drive player. If Safari blocks it (cross-site tracking prevention), tap **Google Drive에서 열기** and play it in the Drive app. The Drive file must be viewable by your account.
- **Google Flow is not automated.** No supported Flow API has been verified for this project. The dashboard gives you the per-scene prompts to paste into Flow by hand.
- **Rendering runs on your Mac** ([rendering.md](rendering.md)): tap *렌더 작업 파일 (Mac)*, render, upload the MP4 to Drive, then *완성 MP4 등록*. Automatic upload and registration are a later step.
- **Speed:** generating or regenerating scripts calls Gemini and can take up to about a minute. Other dashboard actions take 1–3 seconds (Apps Script is not instant).
- The dashboard does not edit PRODUCTS. Product data, links and permissions are entered in the sheet (touchpoint ①).
