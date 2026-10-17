# Studio → Google Sheets mirror (deployment checklist)

This bridge **does not replace or edit the legacy PRODUCTS, REELS, or AUDIT sheets**. Studio is the authoritative store; `STUDIO_EPISODES` contains serialized episode snapshots for visibility and migration. It is not yet a two-way workflow sync.

1. Add `apps-script/StudioBridge.gs` to the Apps Script project connected to the spreadsheet. **Existing `doGet()` remains unchanged**; this file introduces `doPost()`.
2. In Apps Script Project Settings → Script Properties add `RF_STUDIO_BRIDGE_TOKEN` with a unique random 32+ character secret. Never share the token in chat, commit it, or put it in browser code.
3. Deploy a **new version** as a Web App, execute as the spreadsheet owner, with access `Anyone` (required for a headless Mac HTTP client). The POST handler rejects unauthenticated requests. Review the security implications before enabling this endpoint.
4. In local `renderer/.env`, set `RF_SHEETS_BRIDGE_URL` to the deployed `/exec` URL and `RF_SHEETS_BRIDGE_TOKEN` to the same secret.
5. Start Studio with `npm run studio`, open its UI, then invoke `POST /api/sheets/sync` locally with `X-RF-Studio: 1` to copy existing episodes. Check the `STUDIO_EPISODES` sheet.
6. Episode mutations are mirrored automatically in the background (best effort); use the manual sync endpoint to reconcile missed updates after network outages. Google Sheets edits do **not** modify Studio episodes. There is no automatic Drive mirroring in this bridge.

Muapi live mode remains opt-in: `RF_MUAPI_MODE=live`. The UI estimate/authorization gate remains required; enabling live mode does not mean free requests. API and Drive credentials are not packaged here.
