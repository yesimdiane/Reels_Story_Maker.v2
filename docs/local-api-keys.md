# Load local API keys from Terminal (Reels Story Maker v2)

No keys should be committed to GitHub. The app reads `renderer/.env` automatically, or any file selected using `RF_ENV_FILE`.

## One-time setup on Mac
```bash
cd /path/to/Reels_Story_Maker.v2
cp renderer/.env.example renderer/.env
chmod 600 renderer/.env
open -e renderer/.env
```
Fill in the keys you need, for example:
```dotenv
GEMINI_API_KEY=your_key_here
MUAPI_API_KEY=your_key_here
HEYGEN_API_KEY=your_key_here
RF_MUAPI_MODE=mock
RF_STUDIO_VOICE_MODE=mock
```
Start the local Studio:
```bash
npm run studio:keys
npm run studio
```
Or use a file **outside** the repository:
```bash
RF_ENV_FILE="$HOME/.config/reels-factory/keys.env" npm run studio:keys
RF_ENV_FILE="$HOME/.config/reels-factory/keys.env" npm run studio
```
The check prints only whether keys were loaded, never their values. Shell-provided variables override file values.

**Railway v2** runs remotely and cannot read a file on your Mac. Set corresponding keys in Railway → v2 service → Variables, or use the app's secure provider key settings backed by a persistent encrypted store. Keep `RF_MASTER_KEY` and `RF_ADMIN_PASSWORD` in Railway Variables; don't put credentials in GitHub.

Keys alone do not switch the product understanding model or other tasks from mock: choose a live image-capable model in Studio → Settings → AI 연동. Video/voice mode stays mock until explicitly enabled. Check costs before running paid generations.
