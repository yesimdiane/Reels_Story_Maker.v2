# Reels Factory Studio v2.1 — Start Here

This package contains the existing Apps Script dashboard, the Mac renderer, and a separate local Studio dashboard.

## Start on Mac

1. Back up your existing `/Users/diane/reels_factory` directory before replacing any files.
2. Extract this archive into a NEW directory, for example `/Users/diane/reels_factory_v2_1`.
3. From Terminal, run:

```bash
cd /Users/diane/reels_factory_v2_1
node studio/server.js
```

4. Open http://127.0.0.1:4173 in your Mac browser.

Requires Node.js >=20. The server listens on localhost only by default.

## Safety and limitations

- Studio uses MOCK video generation unless `RF_MUAPI_MODE=live` and a real `MUAPI_API_KEY` are configured. Do not switch to live until the provider account and per-clip prices have been verified.
- Voice Studio also defaults to MOCK; live voice needs its own explicit settings and verified character voice IDs.
- Existing renderer credentials in `renderer/.env` are **not included** in this ZIP. Do not share them. If testing live features, configure locally only.
- New Studio and existing Apps Script/Sheets are **separate stores**; automatic two-way sync is not yet implemented.
- Google Flow, Instagram posting, and ManyChat publishing are manual steps.
- This package has not been deployed to the user's Mac or to Apps Script.
- The Studio-related automated test suite passed 40/40 in the review environment; external API live calls were not tested.

For full details see `docs/studio-v2.md`.
