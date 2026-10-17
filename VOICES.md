# Voice API connections

Voice providers are connected **once**, in **Settings → 음성 연결**. Characters then pick a default voice from the synced catalog (Character Library → 목소리 설정). Script Studio, Storyboard, Voice Studio and Render all read the character's saved voice; no screen other than Settings asks for credentials.

## What costs money (and what never does)
| Action | Audio generated? | Cost |
|---|---|---|
| Save credentials, 연결 테스트, 음성 목록 가져오기 | No | Free (Google `voices.list`, HeyGen `GET /v3/voices`) |
| 미리듣기 — HeyGen hosted sample / MOCK mode | No new audio | Free |
| 미리듣기 — Google in LIVE mode | Yes (≤120 chars) | Paid; needs explicit confirmation of the exact character count; cached afterwards |
| Final line TTS | Yes | Blocked until the script is approved; per-character cache reuse; existing billable-char confirmation |

## Google Cloud Text-to-Speech
1. In Google Cloud, create/select a project, enable **Cloud Text-to-Speech API** and billing.
2. IAM → Service accounts → create one → Keys → add key → JSON. (No special role is needed for listing; synthesis uses the API enablement.)
3. Settings → 음성 연결 → Google → 인증 방식 **서비스 계정 JSON** → paste the JSON → 저장 → 연결 테스트 → 음성 목록 가져오기.
   Alternatives: **ADC** (server env `GOOGLE_APPLICATION_CREDENTIALS` = path to a key file, or a Google-hosted runtime) or **API key** (`GOOGLE_TTS_API_KEY`-style key pasted in Settings). A plain API key is supported but not assumed.

## HeyGen
1. HeyGen → Settings → API → create an API key.
2. Settings → 음성 연결 → HeyGen → paste key → 키 저장 → 연결 테스트 → 음성 목록 가져오기.
   The catalog contains all your private/cloned voices plus up to 500 public voices (filter by language). The existing `HEYGEN_API_KEY` env var is still honored.
   Remember: a HeyGen *Identity ID* is not a *Voice ID*; only synced Voice IDs can be assigned.

## Environment variables
| Variable | Needed | Purpose |
|---|---|---|
| `RF_MASTER_KEY` | Yes (already set) | Encrypts stored credentials (AES-256-GCM vault on `/data`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | ADC key-file path for the "ADC" mode |
| `GOOGLE_TTS_SERVICE_ACCOUNT_JSON`, `GOOGLE_TTS_API_KEY` | Optional | Env fallbacks for the vault entries |
| `HEYGEN_API_KEY` | Optional | Env fallback for the HeyGen key |
| `RF_STUDIO_VOICE_MODE=live` | For real audio | Default is MOCK (free tones) |

## Security
Credentials are server-side only (encrypted vault); responses show only status, e-mail of the service account and the last 4 characters of a key. Nothing is stored in the browser. Errors are scrubbed of keys/tokens before logging. Disconnect deletes the stored credential and that provider's catalog slice; revoke the key in the provider console for full invalidation.

## Missing voices
If a character's voice is missing, its provider is disconnected, or the voice disappeared from the account, Script Studio shows the reason with **목소리 변경** (→ Character Library) and **제공자 연결** (→ Settings). Final TTS refuses to run for those characters.
