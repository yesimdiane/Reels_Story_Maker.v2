# Claude Code instructions — Reels Factory

You are implementing the project in this repository. Work in small reviewable changes via branches and pull requests. Do not rewrite existing user data or invent successful integrations.

## MVP priority
1. Document the Google Sheets schema (PRODUCTS, REELS, PERFORMANCE).
2. Implement a Google Apps Script menu to generate 3 reel script rows from a selected PRODUCTS row, using a configurable Gemini API key stored in Script Properties.
3. Validate Gemini's JSON output and product facts, prevent duplicate IDs, record actionable errors.
4. Produce scene-specific Google Flow prompts and mark generation as a **manual** step; do not claim Google Flow is available through Gemini API.
5. Implement a low-cost FFmpeg render workflow for uploaded, approved MP4 clips plus narration, captions, affiliate disclosure and CTA.
6. Provide clear setup instructions and a test fixture for PRD-001.

## Existing PRODUCTS sheet columns
A 상품ID
B 상품명
C 카테고리
D 확인된 기능
E 타깃
F 쿠팡파트너스 URL
G 영상 소스 URL
H 영상 사용 허가 상태
I 제작 상태

Do not overwrite the existing sheet. Inspect before changing.

## Product and content safety
- Never assume media on Coupang is licensed for AI modification or social advertising.
- Only use verifiable product attributes and truthful demonstrations.
- Include a conspicuous Korean affiliate disclosure.
- Use post-specific ManyChat keywords mapped to the right product.
- Keep publishing and affiliate link sending under human review until tested.

## Technical expectations
- Prefer no-cost local tools and official APIs.
- Store credentials only in secret stores / Apps Script Properties; never in Git.
- Write reproducible setup steps and tests.
- Commit focused changes and open a PR for ChatGPT review.
