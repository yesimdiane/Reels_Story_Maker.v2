# MuAPI video generation price audit — 2026-10-15

**Purpose:** Reference values for Reels Factory Settings (USD). This is NOT a confirmed live billing quote. Never auto-fill uncertain prices as verified, or enable paid generation based on a documentation-only entry.

| Model ID | 5s USD | 10s USD | Other duration | Evidence / caveats |
|---|---:|---:|---|---|
| grok-imagine-image-to-video, 480p | N/A | 0.25 | 6–30s, $0.025/s (6s=$0.15, 30s=$0.75) | Official API docs; 5s unsupported |
| grok-imagine-image-to-video, 720p | N/A | 0.50 | 6–30s, $0.05/s (6s=$0.30, 30s=$1.50) | Official API docs; 5s unsupported |
| kling-v2.1-master-i2v | 0.30* | UNKNOWN | 5s and 10s supported in comparison schema | *Provider quotes $0.30 per generation / 0.3 credits per call, but does NOT establish whether 10s has same price. Verify actual 5s charge and 10s separately. |
| seedance-pro-i2v | $0.18 per generation (duration/resolution-specific amount UNKNOWN) | $0.18 per generation (duration/resolution-specific amount UNKNOWN) | Provider lists 5–10s and 480p/720p/1080p | Official model page says $0.18 per generation but does NOT confirm same billed amount across resolution/duration; do not treat $0.18 as validated 5s/10s price. |
| seedance-2.5-image-to-video | UNKNOWN | UNKNOWN | 480p, 720p, 1080p, 4k; draft and finalize flows | Main endpoint resolution-specific pricing not verified; do NOT substitute **seedance-2.5-intl-image-to-video** rates |
| runway-image-to-video | 0.15* | N/A | Official API duration options 5s or 8s; 10s unsupported; 1080p+8s unsupported | *Provider quotes $0.15 per request, not resolution-specific. Confirm 720p vs 1080p billing. |

## Separate model: Seedance Pro Fast (user-supplied provider screenshot)\n- Screenshot labeled Seedance Pro Fast, **not** seedance-pro-i2v. Published table: 480p 5s $0.10 / 10s $0.20; 720p 5s $0.15 / 10s $0.30; 1080p 5s $0.30 / 10s $0.60.\n- Do not assign Fast rates to seedance-pro-i2v without exact model ID confirmation.\n\n## User-entered Settings values in screenshot
- Kling Master: 5s $1.00, 10s $1.00; both **user-entered, not provider verified**.
- Runway: 5s $0.50; **user-entered, not provider verified**.
- Seedance 2.5: blank/unverified.
- Do not conflate user-entered figures with real API prices.

## Provider references
- Grok: https://muapi.ai/playground/grok-imagine-image-to-video/api
- Kling schema: https://muapi.ai/comparison/kling-v2.1-master-i2v
- Kling llms: https://muapi.ai/playground/kling-v2.1-master-i2v/llms.txt
- Seedance Pro: https://muapi.ai/playground/seedance-pro-i2v
- Seedance 2.5: https://muapi.ai/playground/seedance-2.5-image-to-video/api
- Runway: https://muapi.ai/runway
- Runway schema: https://muapi.ai/playground/runway-image-to-video/api
- **Do not use** the Intl Seedance 2.5 rates for standard endpoint: https://muapi.ai/playground/seedance-2.5-intl-image-to-video

## Implementation / verification rules
1. Model price table should be keyed by model ID **and resolution and duration**; do not use one model-wide 5s/10s price when resolution changes charges.
2. Store price, currency, unit (per-second/per-request), source URL, checked date, and verification status (official published / account billed / user-entered / unknown).
3. Keep unknown entries blank and disabled for automatic cost estimation; prompt for actual invoice/usage screenshots or live provider quote. Do not fabricate missing values.
4. Check current official pricing immediately before paid job; API response usage/billed amount (if present) is more reliable than static estimates.
5. Verify whether `credits` map 1:1 to USD in account billing; do not assume.
6. No paid API calls were made for this audit.
