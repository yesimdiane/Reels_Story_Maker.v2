# Mac installation (renderer)

About 30 minutes, once. Everything here is free except Google Cloud Text-to-Speech, which is billed per character and stays inside the free monthly allowance at normal volume.

## 1. Tools

Open **Terminal** and run each line:

```bash
# Homebrew (skip if `brew --version` already works)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node git ffmpeg
brew install --cask font-nanum-square-round      # subtitle font (NanumSquareRound)
brew install --cask google-drive                 # Google Drive for desktop (sync folder)
```

**Font without Homebrew:** download 나눔스퀘어라운드 from <https://hangeul.naver.com/font>, double-click each `.ttf`, then click **Install** in Font Book. The renderer checks the font before every render. If it is missing, it stops with `FONT_MISSING` (exit 5) before any paid call.

## 2. Get the code

```bash
cd ~
git clone https://github.com/yesimdiane/reels_factory.git
cd reels_factory
npm test                     # optional: runs the full test suite (no keys needed)
npm run render:check
```

`render:check` must show:
- `✓ ffmpeg …`;
- `✓ 자막 글꼴 NanumSquareRound (…/Library/Fonts/NanumSquareRoundR.ttf)`.

If it reports that the `ass` filter is missing:

```bash
brew install ffmpeg-full
```

Then put these two lines in `renderer/.env` (step 5):

```
RF_FFMPEG=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
RF_FFPROBE=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe
```

## 3. Google Drive folder

1. Open **Google Drive** (installed in step 1) and sign in with the account that owns the spreadsheet.
2. In Drive (web or Finder), create these folders:
   ```
   My Drive/ReelsFactory/jobs
   My Drive/ReelsFactory/clips
   My Drive/ReelsFactory/output
   ```
3. In Finder they appear under `~/Library/CloudStorage/GoogleDrive-<your email>/My Drive/ReelsFactory`.

## 4. Google Cloud Text-to-Speech key

1. Go to <https://console.cloud.google.com/>, create a project, then open **Billing** and link a billing account.
2. Open **APIs & Services → Library**, find **Cloud Text-to-Speech API**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**, then **Edit key**. Under **API restrictions**, choose **Restrict key** and select only **Cloud Text-to-Speech API**. Save.
4. Recommended (10 minutes), following [cost-safety.md](cost-safety.md#recommended-google-cloud-settings-once-about-10-minutes):
   - Lower **Cloud Text-to-Speech API → Quotas → Requests per minute** to e.g. 30.
   - Create a budget (e.g. ₩5,000/month) with email alerts. A budget **only notifies**; it does not stop charges.
   - `npm run render:usage` is a local safety counter, not your bill. Real spend is in **Billing → Reports**.
5. Optional: check the Gemini model from the terminal, free: `GEMINI_API_KEY=<key> npm run gemini:check`. See [cost-safety.md](cost-safety.md#testing-the-model-against-the-real-api).

## 5. `renderer/.env`

```bash
cp renderer/.env.example renderer/.env
open -e renderer/.env
```

Fill in the following (use your own Mac user name and email in the paths):

```
RF_RENDER_SECRET=<Google Sheets menu: 릴스 팩토리 → 렌더 키 보기>
GOOGLE_TTS_API_KEY=<key from step 4>
RF_TTS_VOICE=ko-KR-Wavenet-A
RF_JOBS_DIR=/Users/<you>/Library/CloudStorage/GoogleDrive-<you>@gmail.com/My Drive/ReelsFactory/jobs
RF_CLIPS_DIR=/Users/<you>/Library/CloudStorage/GoogleDrive-<you>@gmail.com/My Drive/ReelsFactory/clips
RF_OUTPUT_DIR=/Users/<you>/Library/CloudStorage/GoogleDrive-<you>@gmail.com/My Drive/ReelsFactory/output
RF_DEFAULT_FOOTAGE_SOURCE=flow-generated
# Optional — Gemini's advisory check of the finished video (see docs/gemini-orchestration.md):
GEMINI_API_KEY=<your Gemini key>
```

For Drive import (`node renderer/cli.js fetch-clips --job <file>`) and Drive product images run once: `gcloud auth login --enable-gdrive-access`.

Run `npm run render:check` again. Every line should show ✓, and the render key should be listed as set.

## 6. Daily use

| Step | Who / where |
|---|---|
| 1. Product row in PRODUCTS (facts one per line, Coupang Partners link, `영상 사용 허가 상태` = `자체 제작`, optional `ManyChat 키워드` e.g. `우산`) | you, Google Sheets |
| 2. 상품 tab → 훅 5개 + 대본 생성 → 훅 선택 → review → **승인** | you, iPhone dashboard |
| 3. 영상 제작 시작. The **Google Flow 장면 프롬프트** (one per scene) appear automatically | iPhone dashboard |
| 4. Generate one 8-second clip per prompt in Google Flow. Save each as `S1.mp4`, `S2.mp4`, … into `ReelsFactory/clips/<릴스ID>/` | you, Flow → Drive |
| 5. Tap **렌더 작업 파일 (Mac)** and save the file into `ReelsFactory/jobs/` | iPhone (Files → Google Drive) |
| 6. The renderer assembles the video automatically (command below) | Mac |
| 7. Register the MP4 from `ReelsFactory/output/…` with **완성 MP4 등록** (Drive link), then review and **영상 승인** | iPhone |
| 8. Copy the publishing pack, post on Instagram yourself, set up ManyChat, then tap both confirmations | you |

Run the renderer automatically while the Mac is on:

```bash
cd ~/reels_factory
npm run render:pending -- --watch 10        # checks the Drive folders every 10 minutes
```

Each run checks every job:
- **Clips missing:** stops at `ASSETS_REQUIRED` (no cost). `SHOTLIST.md` and `FLOW_PROMPTS.md` are written next to the clips.
- **Clips present:** renders once.
- **Already rendered:** reused at no cost.

Narration (Google TTS) is paid **once per approved line** and cached.

Single job, by hand:
- `npm run render:estimate -- --job <file>` is free;
- `npm run render -- --job <file> --preview` is free (local voice);
- `npm run render -- --job <file>` is the final render.


## Studio V2 (optional)

```
node studio/server.js     # http://127.0.0.1:4173 — MOCK mode, no API keys needed
```

Put `MUAPI_API_KEY` (and optionally `HEYGEN_API_KEY`) in `renderer/.env` only when you are ready for real generation, and
set `RF_MUAPI_MODE=live` / `RF_STUDIO_VOICE_MODE=live` deliberately. Details: [studio-v2.md](studio-v2.md).
