/**
 * Reels Factory — single-file Apps Script bundle. GENERATED FILE, do not edit by hand.
 * Source: apps-script/*.gs. Rebuild with `npm run build`.
 * Install: paste this whole file into Extensions → Apps Script (see docs/setup.md).
 *
 * @OnlyCurrentDoc  Limits spreadsheet access to this workbook when scopes are auto-detected.
 */
// ===== Config.gs =====
/**
 * Reels Factory — shared configuration.
 *
 * Secrets (GEMINI_API_KEY) are NOT stored here. They live in
 * Apps Script → Project Settings → Script Properties.
 */

const RF_CONFIG = {
  // Shown in the dashboard header and in 릴스 팩토리 → 코드 버전 확인. If the two differ, the web app
  // was not redeployed after the code was replaced (Deploy → Manage deployments → New version).
  CODE_VERSION: '2026-10-11 · image-first-reels-v2 2',

  // Instagram brand. Used in the Gemini prompt and shown in the dashboard; edit here to reuse the
  // factory for another account. See docs/brand.md.
  BRAND: {
    NAME: '서울에서 집꾸미기',
    POSITIONING: '일상의 불편을 해결하는 예쁘고 실용적인 홈 제품을 소개하는 계정 — 특히 작은 집을 위해, 불필요한 소비 없이',
    TAGLINE: '우리 집에 들이기 전에, 먼저 보여드릴게요.',
    PERSONALITY: '자연스럽고, 공감 가고, 실용적이고, 따뜻한 대화체. 뻔한 판매 멘트는 쓰지 않음.',
    DIFFERENTIATORS: [
      'AI 인테리어 시뮬레이션 (항상 "AI 시뮬레이션"으로 표시)',
      '실제로 쓸모 있는 생활용품',
      '서울에 사는 한국인 아내와 외국인 남편의 진짜 이야기 (가끔, 실제 있었던 일만)',
    ],
    // Editorial planning targets (share of all reels), not a rule for every product.
    PILLARS: {
      AI_MAKEOVER: { label: 'AI 공간 변신', target: 35, hint: 'AI로 공간이 어떻게 바뀔지 미리 보여 주기. AI 장면은 반드시 ai_visualization=true ("AI 시뮬레이션" 표시).' },
      PRODUCT_DISCOVERY: { label: '생활 꿀템 발견', target: 35, hint: '작은 집의 불편을 푸는 실용적인 물건. 상품 릴스의 기본.' },
      INTL_COUPLE: { label: '국제부부 한국살이', target: 20, hint: '한국인 아내와 외국인 남편의 서울 생활. 실제 있었던 일만 — 남편 반응·대사를 지어내지 말 것 (확인 필요로 표시됨).' },
      COMPARE: { label: '살까 말까 비교 연구소', target: 10, hint: '살지 말지 기준을 정리. 확인된 기능 밖의 비교·테스트 결과는 쓰지 말 것 (확인 필요로 표시됨).' },
    },
    // Current editorial priority (first month). Change when the focus changes.
    CURRENT_FOCUS: '첫 달 우선순위: 좁은 공간 생활과 실용적인 정리 수납',
    AI_LABEL: 'AI 시뮬레이션',
  },

  SHEETS: {
    PRODUCTS: 'PRODUCTS',
    REELS: 'REELS',
    PERFORMANCE: 'PERFORMANCE',
    LOG: 'LOG',
    AUDIT: 'AUDIT',
  },

  // Existing PRODUCTS columns (A–I). Matched by header name, never rewritten.
  PRODUCT_FIELDS: {
    id: '상품ID',
    name: '상품명',
    category: '카테고리',
    features: '확인된 기능',
    target: '타깃',
    affiliateUrl: '쿠팡파트너스 URL',
    sourceUrl: '영상 소스 URL',
    permission: '영상 사용 허가 상태',
    status: '제작 상태',
  },

  // Optional PRODUCTS columns the operator may add (right of column I). Never required, never written.
  PRODUCT_OPTIONAL_FIELDS: {
    keyword: 'ManyChat 키워드', // e.g. 우산 — shared by this product's reels, unique across products
    appearance: '제품 외형', // e.g. 슬림한 사각 두 조각, 무광 다크그레이 플라스틱 — used in Flow prompts
    // Google Drive links (or file IDs), one per line, of images the operator VERIFIED show the real product
    // and may be used as visual references. Required before Gemini plans the Flow prompts.
    referenceImages: '검증된 제품 이미지',
  },

  REELS_HEADERS: [
    '릴스ID',
    '상품ID',
    '버전',
    '컨셉',
    '후킹',
    '내레이션',
    '자막',
    '장면(JSON)',
    'Flow 프롬프트',
    'Flow 생성',
    'CTA',
    'ManyChat 키워드',
    '광고 표기',
    '사용한 확인 기능',
    '영상 사용 허가 상태',
    '제작 상태',
    '검토 메모',
    '생성 모델',
    '생성일시',
    // Approval workflow (appended after the MVP columns so existing rows keep their layout).
    '상태',
    '대본 버전',
    '승인 대본 버전',
    '승인 대본 해시',
    '대본 검토자',
    '대본 검토일시',
    '대본 검토 메모',
    '영상 버전',
    '영상 파일 URL',
    '영상 검토자',
    '영상 검토일시',
    '영상 검토 메모',
    '게시 확인일시',
    'ManyChat 설정 확인일시',
    '인스타그램 URL',
    '오류',
    // Written automatically on script approval (not part of the approved fingerprint).
    'Flow 장면 프롬프트',
  ],

  // Added by 시트 준비 when missing; never required, so older sheets and the live dashboard keep working.
  REELS_OPTIONAL_HEADERS: ['콘텐츠 기둥', '확인 필요', '훅 후보(JSON)', '선택한 훅', '제작 계획(JSON)', '에셋 현황(JSON)', '장면 클립(JSON)', '장면 이미지(JSON)'],
  // Production planning (after SCRIPT_APPROVED) needs these; checked before any Gemini call.
  REELS_PRODUCTION_HEADERS: ['제작 계획(JSON)', '에셋 현황(JSON)'],
  // Scene clip versions and per-clip approvals (Media.gs). Checked before any upload or review.
  REELS_MEDIA_HEADERS: ['장면 클립(JSON)'],
  // 9:16 Storyboard image versions and approvals (StoryboardImages.gs).
  REELS_IMAGE_HEADERS: ['장면 이미지(JSON)'],
  // New scripts need these to keep the five hooks and the operator's choice (checked before any Gemini call).
  REELS_HOOK_HEADERS: ['훅 후보(JSON)', '선택한 훅'],

  // Append-only history of every operator decision and system transition.
  AUDIT_HEADERS: ['일시', '릴스ID', '상품ID', '작업', '이전 상태', '새 상태', '대본 버전', '영상 버전', '작업자', '메모', '스냅샷(JSON)'],

  PERFORMANCE_HEADERS: [
    '릴스ID',
    '게시일',
    '인스타그램 URL',
    '조회수',
    '좋아요',
    '댓글',
    '저장',
    '공유',
    'ManyChat DM 발송수',
    '링크 클릭수',
    '주문수',
    '수익(원)',
    '메모',
  ],

  LOG_HEADERS: ['일시', '레벨', '작업', '상품ID', '메시지', '상세'],

  PRODUCT_ID_PATTERN: /^PRD-\d{3,}$/,
  // Scripts per generation run. Each run produces five hooks (H1–H5) and one script built on the
  // recommended hook; the operator picks the final hook. Run again for another script.
  REELS_PER_PRODUCT: 1,

  // Five hook types per product, in this order. All ≤ HOOK_STYLE.MAX_CHARS, problem-first, no ad tone.
  HOOK_TYPES: {
    H1: { type: 'QUESTION', label: '질문형', rule: '시청자에게 묻는 질문으로 끝남 (?). "~하시나요?"·"~다면?" 같은 뻔한 질문은 금지.' },
    H2: { type: 'NUMBER', label: '숫자로 시작하는형', rule: '확인된 기능에 근거한 숫자로 시작 (예: 2피스 → "두 조각"). 통계·수량·퍼센트를 지어내지 말 것.' },
    H3: { type: 'MYTH', label: '통념을 뒤집는 단정형', rule: '흔한 생각·습관을 뒤집는 단정. 정해진 말투는 없고 뜻이 중요 (예: "~아니에요", "원래 ~없어요", "굳이 ~안 해도 돼요"). 질문 아님.' },
    H4: { type: 'SITUATION', label: '상황 묘사형', rule: '시청자가 겪는 구체적인 순간을 묘사 (언제·어디서). 질문 아님.' },
    H5: { type: 'CONCLUSION', label: '결론 먼저 던지는형', rule: '해결책을 먼저 단정. 정해진 말투는 없고 뜻이 중요 (예: "~하면 돼요", "그냥 문에 붙여요"). 질문 아님.' },
  },

  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',
  // gemini-3.5-flash: GA Flash model with structured output (ai.google.dev/gemini-api/docs/models).
  // gemini-2.5-flash is scheduled for shutdown on 2026-10-16. Override with Script Property GEMINI_MODEL.
  DEFAULT_GEMINI_MODEL: 'gemini-3.5-flash',
  // Used only if the configured model returns 404 (not found → nothing generated or billed).
  GEMINI_FALLBACK_MODELS: ['gemini-flash-latest'],
  // 9:16 storyboard image generation model using actual product reference bytes.
  DEFAULT_IMAGE_MODEL: 'gemini-2.5-flash-image',
  GEMINI_IMAGE_FALLBACK_MODELS: ['gemini-2.5-flash-image'],
  MAX_GEMINI_ATTEMPTS: 2,
  // Upper bound on Gemini calls for one generation, including targeted hook revisions
  // (full generation + one hook revision + one full retry at most).
  MAX_GEMINI_CALLS_PER_RUN: 3,

  // Coupang Partners required disclosure wording. Inserted by code, never by the model.
  AFFILIATE_DISCLOSURE:
    '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',

  FLOW_STATUS_MANUAL: '수동 생성 필요 (Google Flow는 Gemini API로 호출되지 않음)',
  PERMISSION_UNVERIFIED_NOTE:
    '영상 사용 허가 미확인 — 쿠팡/판매처 미디어를 AI 편집·광고에 사용하기 전 허가를 확인하세요.',
  // Values in PRODUCTS.영상 사용 허가 상태 that count as verified permission.
  // '자체 제작' = only operator-shot or AI-generated footage is used, no marketplace media.
  PERMISSION_APPROVED_VALUES: ['허가', '허가됨', '승인', '승인됨', '확인 완료', '허가 완료', '자체 제작'],

  // Hosts accepted for PRODUCTS.쿠팡파트너스 URL before a reel can be marked ready to publish.
  AFFILIATE_URL_HOSTS: ['link.coupang.com', 'coupa.ng'],

  // Script Property holding comma-separated Google account emails allowed to use the dashboard.
  REVIEWERS_PROPERTY: 'RF_REVIEWERS',

  LIMITS: {
    HOOK_MAX_CHARS: 40,
    NARRATION_MAX_CHARS: 300,
    CAPTION_MAX_CHARS: 40,
    MIN_SCENES: 3,
    MAX_SCENES: 6,
    MIN_TOTAL_SEC: 10,
    MAX_TOTAL_SEC: 40,
    // New Gemini scripts: 20–40 s, as long as the content needs (never padded). Older rows keep 10–40.
    GENERATED_MIN_TOTAL_SEC: 20,
    MIN_FLOW_PROMPT_CHARS: 30,
    // Storyboard (video-first template): one narration line per scene = the subtitle.
    SCENE_MIN_SEC: 2,
    SCENE_MAX_SEC: 6,
    SCENE_NARRATION_MAX_CHARS: 30,
  },

  // Google Flow prompts generated (free, by code) after SCRIPT_APPROVED: one 8-second clip per scene.
  FLOW: {
    CLIP_SEC: 8,
    // Unused head/tail of each clip. A scene longer than CLIP_SEC − CLIP_MARGIN_SEC needs more clips.
    CLIP_MARGIN_SEC: 0.5,
    ENVIRONMENT: 'a real, lived-in small Korean apartment, natural daylight from a window or door, realistic everyday colours',
    CAMERA: {
      HOOK: 'handheld medium shot at eye level, slight natural movement; ends with a quick natural whip pan',
      PROBLEM: 'handheld medium shot that slowly moves closer to the problem detail',
      EMPATHY: 'handheld medium shot that slowly moves closer to the annoying detail, as if the viewer is standing there',
      SOLUTION: 'handheld medium shot; the product comes into frame naturally in the same place as the problem',
      DEMO: 'starts as a close-up of the hands using the product, then slowly pulls back to show the product in place; handheld, smooth',
      BENEFIT: 'slow handheld walk-through: wide view of the space first, then a closer look at the tidy result',
      CTA: 'slow push-in to a close-up of the product in place, then hold steady for the last 2 seconds',
    },
    INTERACTION: {
      HOOK: 'show the everyday situation; the product may be absent or only in the background',
      PROBLEM: 'show the problem clearly; do not show the product solving it yet',
      EMPATHY: 'show why the situation is annoying (clutter, no space, things in the way); no product yet',
      SOLUTION: 'a person\'s hands bring in or place the product in the space from the earlier scenes; calm and natural, no presenting gesture',
      DEMO: 'a person\'s hands use the product exactly as described, only in ways the verified features allow',
      BENEFIT: 'show the result with the product in place and being used naturally',
      CTA: 'the product is the clear subject, mounted or placed exactly as in the earlier scenes',
    },
  },

  // Gemini is the production planner AFTER SCRIPT_APPROVED (Production.gs); code and the renderer execute.
  // Gemini never writes commands: it returns a declarative plan that code validates against these limits.
  PRODUCTION: {
    PLAN_VERSION: 1,
    // Google Flow has no public API (Veo is available through the Gemini API, but that is a separate,
    // separately billed model). Clips are generated by hand in Flow and imported through Drive.
    FLOW_PROVIDER: 'manual',
    SPEAKING_RATE_MIN: 0.9,
    SPEAKING_RATE_MAX: 1.15,
    PAUSE_MAX_SEC: 0.6,
    EMPHASIS_MAX_WORDS: 2,
    // Same limits as renderer/templates/lifestyle-v1.json "shots" (the renderer re-checks them).
    CUT_MIN_SEC: 1.0,
    CUT_MAX_SEC: 3.5,
    SCENE_PROMPT_MIN_CHARS: 40,
    MAX_REFERENCE_IMAGES: 4,
    MAX_IMAGE_BYTES: 3 * 1024 * 1024,
    // Gemini limits a request with inline data to ~20 MB (base64 adds a third), so the images share a budget.
    MAX_TOTAL_IMAGE_BYTES: 10 * 1024 * 1024,
    DRIVE_ROOT_FOLDER_NAME: 'Reels Factory',
    CLIP_EXTENSIONS: ['mp4', 'mov', 'm4v'],
    // Statuses in which a production plan may be made / the Drive folder prepared.
    PLAN_STATUSES: ['SCRIPT_APPROVED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'],
    // Attributes a Flow scene description must never add (the verified facts are the only source).
    SCENE_PROMPT_FORBIDDEN: ['refrigerator', 'fridge', 'drill', 'screw', 'nail ', 'adhesive', 'glue', 'suction', 'waterproof', 'heavy-duty', 'brand name', 'price', 'discount', 'sale '],
  },

  // Mobile media workspace (Media.gs): reference photos, Flow clip uploads from iPhone Safari, per-clip review.
  // Google Flow stays manual: nothing here calls Flow or Veo.
  MEDIA: {
    // Flow lives at flow.google (labs.google/fx redirects there). Override with Script Property RF_FLOW_URL.
    FLOW_URL: 'https://flow.google',
    REF_PHOTOS_MAX: 4,
    REF_FOLDER_NAME: 'references',
    VERSIONS_FOLDER_NAME: 'versions',
    CLIP_MIN_BYTES: 10 * 1024,
    CLIP_MAX_BYTES: 100 * 1024 * 1024,
    CLIP_EXTENSIONS: ['mp4', 'mov', 'm4v'],
    CLIP_MIME: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
    // Each google.script.run call carries one chunk (base64 adds a third; a single call is limited to ~50 MB).
    // Drive's resumable protocol needs every non-final chunk to be a multiple of 256 KiB.
    CHUNK_BYTES: 6 * 256 * 1024,
    UPLOAD_TTL_SEC: 6 * 60 * 60,
    DRIVE_API: 'https://www.googleapis.com/drive/v3/files/',
    DRIVE_UPLOAD_API: 'https://www.googleapis.com/upload/drive/v3/files',
  },

  // 9:16 Storyboard image generation (gemini-2.5-flash-image) and Google Flow handoff.
  STORYBOARD: {
    FOLDER_NAME: 'storyboard',
    ASPECT_RATIO: '9:16',
    MODEL: 'gemini-2.5-flash-image',
    MAX_REVISION_NOTE_CHARS: 300,
    // Configurable per-image estimate in USD. Defaults to null (no verified price configured).
    // Operators can set via Script Property GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE or configure here.
    // If null/unconfigured, the system reports "Cost estimate unavailable" instead of inventing a price.
    ESTIMATED_USD_PER_IMAGE: null,
    FLOW_NOTE: '생성된 9:16 이미지를 다운로드하여 Google Flow에 업로드하고, 모션 프롬프트를 입력하여 비디오 클립을 생성하세요.',
  },

  // Story structure. New scripts: HOOK → EMPATHY → SOLUTION → DEMO → CTA (BENEFIT optional before CTA).
  // Older scripts (HOOK → PROBLEM → DEMO → BENEFIT → CTA) stay valid. PROBLEM and EMPATHY share a slot.
  BEATS: ['HOOK', 'PROBLEM', 'EMPATHY', 'SOLUTION', 'DEMO', 'BENEFIT', 'CTA'],
  BEAT_RANK: { HOOK: 0, PROBLEM: 1, EMPATHY: 1, SOLUTION: 2, DEMO: 3, BENEFIT: 4, CTA: 5 },
  // Beats where the product is on screen (Flow prompts and the renderer's footage check).
  PRODUCT_BEATS: ['SOLUTION', 'DEMO', 'BENEFIT', 'CTA'],

  // Creative angles: one reel each, so the three scripts never feel alike.
  ANGLES: {
    EVERYDAY_FRUSTRATION: 'A 일상 불편',
    SMALL_SPACE: 'B 좁은 공간',
    LIFESTYLE_SITUATION: 'C 생활 상황',
  },

  // Content that needs the operator to confirm it is real before approval (checked in every script,
  // shown in the dashboard and the 확인 필요 column). Pillar-based flags are added in Validation.gs.
  VERIFICATION_RULES: [
    { type: '개인 경험', pattern: /(저는|제가|저희|우리\s*집|직접\s*(?:써|사용|해|붙|사)|써\s*보니|써\s*봤|사용해\s*보니|사용해\s*봤|샀어요|샀는데|샀더니|구매했|주문했|바꿨더니|붙였더니)/, ask: '실제 경험·구매인지 확인' },
    { type: '제품 테스트', pattern: /(테스트|실험|직접\s*확인|측정|버텨\s*봤|해\s*봤더니)/, ask: '실제로 테스트했는지 확인' },
    { type: '국제부부 이야기', pattern: /(남편|신랑|아내|와이프|외국인\s*(?:남편|아내)|국제부부)/, ask: '실제 있었던 일인지 확인 (반응·대사를 지어내지 않았는지)' },
    { type: '전후 결과', pattern: /(비포|애프터|before|after|전후|달라졌|바뀌었|넓어졌|깔끔해졌|좋아졌)/i, ask: '실제 결과 영상·사진이 있는지 확인' },
    { type: '비교', pattern: /(비교|\bvs\b|보다\s*(?:더|훨씬|나아|좋))/i, ask: '비교 대상과 기준이 사실인지 확인' },
  ],

  // Hook style for new Gemini scripts (not applied to reviewer edits): a relatable problem, spoken in
  // the first ~2–3 seconds — not an ad. Each pattern is a common ad-style hook.
  // Hook checks are split in two (Validation.gs):
  //  - hard errors (never stored): invalid structure, empty text, unsupported claims/numbers, invented
  //    statistics, banned or misleading phrases (rules marked hard: true);
  //  - style warnings (stored, shown in the dashboard, the operator decides): length, product name
  //    first, ad tone, weak fit to the hook type. Types are judged by meaning cues, not exact phrases.
  HOOK_STYLE: {
    MAX_CHARS: 25,
    // After generation, one extra Gemini call may rewrite only the non-recommended hooks that have
    // style warnings (the recommended hook is never changed: the script starts with it).
    AUTO_REVISE_WEAK: true,
    AD_PATTERNS: [
      { pattern: /니다[.!?~…]*$/, why: '광고 문구 같은 "~니다" 말투' },
      { pattern: /(다면|라면|이라면)\s*[?？]*[.!~…]*$/, why: '"~다면?" 같은 뻔한 질문형' },
      { pattern: /(하시나요|시나요|신가요|있나요|아시나요|어떨까요|어떠세요|궁금하지\s*않|해\s*보셨나요)\s*[?？]*[.!~…]*$/, why: '"~하시나요?" 같은 뻔한 질문형' },
      { pattern: /(하세요|해\s*보세요|만나\s*보세요|확인하세요)[.!~…]*$/, why: '광고 같은 권유형' },
      { pattern: /(하나로|소개|추천|필수템|꿀템|신박템|강추|이것만|역대)/, why: '광고 문구' },
      { pattern: /달라(집니다|져요|졌어요|지는)/, why: '"~이 달라집니다" 같은 결과 약속', hard: true },
      { pattern: /\d+(?:\.\d+)?\s*(?:mm|cm|kg|[x×])|[x×]\s*\d/i, why: '치수·사양을 늘어놓는 기능 나열' },
    ],
  },
  // Written by Gemini in the CTA line; replaced with the reel's ManyChat keyword at render time.
  KEYWORD_PLACEHOLDER: '{키워드}',

  // Exaggerated / unverifiable claims that must not appear in viewer-facing text.
  BANNED_PHRASES: [
    '최저가',
    '100%',
    '무조건',
    '완벽',
    '평생',
    '절대',
    '1위',
    '역대급',
    '품절 임박',
    '마감 임박',
    '효과 보장',
    '보장합니다',
    '세상에서',
    '유일한',
  ],

  // Product claims that need support in 확인된 기능 (checked in hook, narration, captions, scene lines).
  // Group 1 is the claim term; it is allowed when the verified facts or product name contain it.
  // Natural paraphrases of verified facts ("자석으로 붙여요", "철제 현관문에 붙일 수 있어요") pass.
  CLAIM_RULES: [
    { type: '호환성', pattern: /(냉장고|세탁기|벽면|벽|타일|유리|나무|원목|목문|방화문|알루미늄|스테인리스|대리석|콘크리트|화이트보드|자동차|차량)(?:에도|에|면|문에|문에도)?\s*(?:다|도|잘)?\s*(?:붙|부착|달|설치|고정|쓸 수|사용 가능)/ },
    { type: '호환성', pattern: /((?:모든|어떤|어느|아무)\s*(?:문|현관|곳|표면|데|우산|사이즈))/ },
    { type: '호환성', pattern: /(어디(?:든|에나|서나|에든))/ },
    { type: '성능', pattern: /(튼튼|견고|단단|강력|강한\s*자석|자력|내구|하중|무게|버텨|버티|흔들림|안\s*떨어|떨어지지\s*않|미끄러지지|오래\s*(?:써|쓸|가))/ },
    { type: '기능', pattern: /(방수|방청|배수|물받이|물빠짐|물\s*빠|습기|곰팡이|항균|위생|녹(?:이|슬| 안)|접이식\s*거치대|회전|각도\s*조절|높이\s*조절|잠금)/ },
    { type: '설치', pattern: /(무타공|구멍|드릴|타공|나사|못\s*없이|공구\s*없이|설치\s*끝|\d+\s*초\s*만에)/ },
    { type: '소재', pattern: /(스테인리스|스텐|알루미늄|원목|플라스틱|실리콘|ABS|소재|재질|철제|금속)/ },
    { type: '수납 용량', pattern: /(대용량|여러\s*개|몇\s*개(?:든|라도)|가득|\d+\s*개까지)/ },
    { type: '가격', pattern: /(가격|할인|세일|쿠폰|특가|무료\s*배송|로켓|가성비|저렴|(?<![가-힣])싸(?:요|다|게|고)|(?:만|천)\s*원|공짜|이벤트|혜택)/ },
    { type: '후기·인기', pattern: /(후기|리뷰|별점|평점|구매평|만족도|재구매|판매량|인기|베스트|입소문|난리|품절|대박|핫한|다들\s*(?:사|쓰))/ },
    // Invented experiences, purchases, tests, husband reactions, results. Rejected in Gemini output;
    // in a reviewer's own edit they may be real, so they become verification flags instead.
    { type: '체험·결과', generatedOnly: true, pattern: /(써\s*보니|써\s*봤|써\s*본\s|사용해\s*보니|사용해\s*봤|\d+\s*(?:일|주|달|개월)\s*(?:째|동안|간)|한\s*달\s*(?:째|동안|간|써)|일주일\s*(?:째|동안|간|써)|바꿨더니|붙였더니|샀더니|샀어요|샀는데|구매했|주문했|테스트해\s*보니|테스트\s*결과|실험해\s*보니|(?:남편|신랑|아내|와이프)[가-힣]*\s*(?:[가-힣]+\s*)?(?:좋아했|놀랐|놀라|감탄|반했|웃었|말하더|하더라))/ },
    { type: '인증', pattern: /(특허|인증|KC|FDA|친환경|무독성|국내산|국산|최고|최강)/ },
  ],
};

// ===== Validation.gs =====
/**
 * Pure validation helpers (no Apps Script services) so they can be unit-tested in Node.
 */

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/[ \s]+/g, ' ')
    .trim();
}

/**
 * Splits the PRODUCTS "확인된 기능" cell into individual facts.
 * One fact per line or separated by ";". Commas are kept (e.g. colour lists).
 */
function parseConfirmedFeatures(text) {
  return String(text == null ? '' : text)
    .split(/[\n\r;]+/)
    .map(function (f) {
      return normalizeText(f.replace(/^[-•*]\s*/, ''));
    })
    .filter(function (f) {
      return f.length > 0;
    });
}

/** Returns a list of actionable errors for a PRODUCTS row object. */
function validateProduct(product) {
  const errors = [];
  const f = RF_CONFIG.PRODUCT_FIELDS;
  if (!normalizeText(product.id)) {
    errors.push('"' + f.id + '" 값이 비어 있습니다.');
  } else if (!RF_CONFIG.PRODUCT_ID_PATTERN.test(normalizeText(product.id))) {
    errors.push('"' + f.id + '" 형식이 올바르지 않습니다: "' + product.id + '" (예: PRD-001).');
  }
  if (!normalizeText(product.name)) {
    errors.push('"' + f.name + '" 값이 비어 있습니다.');
  }
  const kw = normalizeText(product.keyword);
  if (kw && !/^[^\s'"{}<>]{1,20}$/.test(kw)) {
    errors.push('"' + RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.keyword + '"는 공백·따옴표 없이 20자 이내 한 단어여야 합니다 (예: 우산).');
  }
  if (parseConfirmedFeatures(product.features).length === 0) {
    errors.push(
      '"' + f.features + '" 값이 비어 있습니다. 검증된 기능을 한 줄에 하나씩 입력하세요.'
    );
  }
  return errors;
}

/** Extracts all numeric tokens (e.g. "190", "5.5") from text. */
function extractNumbers(text) {
  return String(text == null ? '' : text).match(/\d+(?:\.\d+)?/g) || [];
}

/** Parses model output as JSON, tolerating a ```json fenced block. */
function parseModelJson(rawText) {
  let text = String(rawText == null ? '' : rawText).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1];
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: 'Gemini 응답이 올바른 JSON이 아닙니다: ' + e.message };
  }
}

function isNonEmptyString_(v) {
  return typeof v === 'string' && normalizeText(v).length > 0;
}

/** Viewer-facing text of a reel: everything that ends up on screen or in the voiceover. */
function viewerFacingTexts_(reel) {
  const texts = [reel.hook, reel.narration];
  (Array.isArray(reel.captions) ? reel.captions : []).forEach(function (c) {
    texts.push(c);
  });
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s) {
    if (s) {
      texts.push(s.on_screen_text);
      texts.push(s.narration);
    }
  });
  return texts.filter(function (t) {
    return typeof t === 'string';
  });
}

/** Loose form for matching references and measurements: no spaces or punctuation, × → x, lower case. */
function looseText_(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[×✕✖*]/g, 'x')
    .replace(/[\s·.,:;()\[\]{}'"`~!?\/\\|_\-–—]+/g, '');
}

/** Stable reference for the i-th (0-based) verified fact, as shown to Gemini: F1, F2, … */
function factId(i) {
  return 'F' + (i + 1);
}

/**
 * Measurements in text: tuples like 190x55x50mm (with an optional 상단/하단 label before them)
 * and single numbers with a unit (82mm, 9,900원, 30%). Korean unit words after a number are normalised.
 */
function extractMeasures_(text) {
  let t = String(text == null ? '' : text)
    .replace(/[×✕✖*]/g, 'x')
    .replace(/(\d)\s*(밀리미터|밀리|미리)/g, '$1mm')
    .replace(/(\d)\s*(센티미터|센티|센치)/g, '$1cm')
    .replace(/(\d)\s*(킬로그램|킬로|키로)/g, '$1kg')
    .replace(/(\d)\s*그램/g, '$1g')
    .replace(/(\d)\s*미터/g, '$1m')
    .replace(/(\d)\s*퍼센트/g, '$1%')
    .replace(/(\d),(\d{3})/g, '$1$2');
  const tuples = [];
  const tupleRe = /(상단|하단|윗부분|아랫부분|위쪽|아래쪽)?[\s:：]*(\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?){1,2})\s*(mm|cm|m(?![a-z])|kg|g(?![a-z]))?/g;
  t = t.replace(tupleRe, function (all, label, nums, unit) {
    tuples.push({ text: all.trim(), label: label ? label.charAt(0) : '', nums: nums.replace(/\s+/g, '').toLowerCase(), unit: (unit || '').toLowerCase() });
    return ' ';
  });
  const singles = [];
  const singleRe = /(\d+(?:\.\d+)?)\s*(mm|cm|kg|ml|원|%|m(?![a-z])|g(?![a-z])|l(?![a-z]))/gi;
  let m;
  while ((m = singleRe.exec(t))) singles.push({ text: m[0].trim(), num: m[1], unit: m[2].toLowerCase() });
  return { tuples: tuples, singles: singles };
}

/** Facts, IDs, numbers and measurements a script may rely on, from PRODUCTS.확인된 기능 and 상품명. */
function factContext_(product) {
  const facts = parseConfirmedFeatures(product.features);
  const factSet = {};
  const byLoose = {};
  facts.forEach(function (f, i) {
    factSet[f] = true;
    byLoose[looseText_(f)] = i;
  });
  const allowedNumbers = {};
  extractNumbers(facts.join(' ') + ' ' + product.name).forEach(function (n) {
    allowedNumbers[n] = true;
  });
  const measures = extractMeasures_(facts.join('\n') + '\n' + product.name);
  const unitNumbers = {};
  measures.singles.forEach(function (x) {
    unitNumbers[x.num + x.unit] = true;
  });
  measures.tuples.forEach(function (x) {
    if (x.unit) x.nums.split('x').forEach(function (n) {
      unitNumbers[n + x.unit] = true;
    });
  });
  return {
    facts: facts,
    factSet: factSet,
    byLoose: byLoose,
    allowedNumbers: allowedNumbers,
    tuples: measures.tuples,
    unitNumbers: unitNumbers,
    looseAll: looseText_(facts.join(' ') + ' ' + product.name),
  };
}

/**
 * Resolves a fact reference from Gemini or the sheet to the index of a verified fact, or -1.
 * Accepts the ID ("F2", "F2: …"), the exact sheet wording, or the same wording with different
 * spacing/punctuation. A paraphrase is NOT a reference: unknown references are rejected.
 */
function resolveFactRef_(ref, ctx) {
  const r = normalizeText(ref);
  const id = r.match(/^\[?F\s*(\d+)\]?(?:$|[\s:：.)\]-])/i);
  if (id) {
    const i = Number(id[1]) - 1;
    return i >= 0 && i < ctx.facts.length ? i : -1;
  }
  const loose = looseText_(r);
  return loose && ctx.byLoose[loose] !== undefined ? ctx.byLoose[loose] : -1;
}

/** Fact references of a scene: Gemini's fact_ids (IDs) or the stored facts (sheet wording). */
function sceneFactRefs_(scene) {
  if (!scene) return [];
  if (Array.isArray(scene.fact_ids)) return scene.fact_ids;
  if (Array.isArray(scene.facts)) return scene.facts;
  return [];
}

const RF_COLOR_GROUPS_ = [
  ['화이트', '흰색', '흰', '하얀', '하양', '백색'],
  ['그레이', '회색', '그레이색'],
  ['다크그레이', '진회색', '짙은 회색', '차콜'],
  ['블랙', '검정', '검은', '검은색', '흑색'],
  ['베이지'], ['아이보리'], ['네이비', '남색'], ['핑크', '분홍'], ['민트'], ['실버', '은색'], ['골드', '금색'],
  ['브라운', '갈색'], ['레드', '빨간', '빨강'], ['블루', '파란', '파랑'], ['그린', '초록'], ['옐로', '노란', '노랑'], ['퍼플', '보라'],
];

/**
 * Product claims in viewer-facing text that need support in 확인된 기능: invented features,
 * compatibility, performance, material, price, reviews, certifications, colours. A term that also
 * appears in the verified facts (or product name) is allowed. Returns error strings.
 */
function unsupportedClaims_(text, ctx, where, generated) {
  const errors = [];
  const t = normalizeText(text);
  if (!t) return errors;
  const hint = ' — "' + t + '". 확인된 기능(' + factId(0) + '~' + factId(Math.max(0, ctx.facts.length - 1)) + ')에 없는 내용이니 빼거나 확인된 기능만으로 다시 쓰세요.';
  RF_CONFIG.CLAIM_RULES.forEach(function (rule) {
    if (rule.generatedOnly && !generated) return; // a reviewer's real experience → verification flag instead
    const re = new RegExp(rule.pattern.source, 'g');
    let m;
    while ((m = re.exec(t))) {
      const term = m[1] || m[0];
      if (ctx.looseAll.indexOf(looseText_(term)) !== -1) continue;
      errors.push(where + '확인되지 않은 ' + rule.type + ' 주장 "' + term + '"' + hint);
    }
  });
  RF_COLOR_GROUPS_.forEach(function (group) {
    // Longest first, so "다크그레이" is not also read as "그레이".
    const words = group.slice().sort(function (a, b) {
      return b.length - a.length;
    });
    const hit = words.filter(function (w) {
      return t.indexOf(w) !== -1;
    })[0];
    if (!hit) return;
    if (hit === '그레이' && t.indexOf('다크그레이') !== -1 && t.replace(/다크그레이/g, '').indexOf('그레이') === -1) return;
    const known = group.some(function (w) {
      return ctx.looseAll.indexOf(looseText_(w)) !== -1;
    });
    if (!known) errors.push(where + '확인되지 않은 색상 "' + hit + '"' + hint);
  });
  return errors;
}

/** Dimensions, units, prices and percentages must match 확인된 기능 exactly (including 상단/하단). */
function measurementErrors_(text, ctx, where) {
  const errors = [];
  const found = extractMeasures_(text);
  found.tuples.forEach(function (x) {
    const same = ctx.tuples.filter(function (f) {
      return f.nums === x.nums;
    });
    if (!same.length) {
      errors.push(where + '확인된 기능과 다른 치수입니다: "' + x.text + '". 치수는 확인된 기능에 적힌 그대로만 쓰세요.');
      return;
    }
    if (x.unit && !same.some(function (f) { return !f.unit || f.unit === x.unit; })) {
      errors.push(where + '치수 단위가 확인된 기능과 다릅니다: "' + x.text + '" (확인된 단위: ' + same[0].unit + ').');
    }
    if (x.label && !same.some(function (f) { return !f.label || f.label === x.label; })) {
      errors.push(where + '상단/하단 치수가 바뀌었습니다: "' + x.text + '". 확인된 기능의 구분 그대로 쓰세요.');
    }
  });
  found.singles.forEach(function (x) {
    if (x.unit === '원') {
      errors.push(where + '확인되지 않은 가격입니다: "' + x.text + '". 가격·할인은 쓰지 마세요.');
    } else if (!ctx.unitNumbers[x.num + x.unit]) {
      errors.push(where + '확인된 기능에 없는 수치/단위입니다: "' + x.text + '".');
    }
  });
  return errors;
}

/** Viewer-facing texts with a label for error messages. */
function labelledViewerTexts_(reel) {
  const out = [{ where: 'hook', text: reel.hook }, { where: 'narration', text: reel.narration }];
  (Array.isArray(reel.captions) ? reel.captions : []).forEach(function (c, i) {
    out.push({ where: 'captions[' + i + ']', text: c });
  });
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s, i) {
    if (!s) return;
    out.push({ where: '장면 ' + (i + 1) + ' narration', text: s.narration });
    out.push({ where: '장면 ' + (i + 1) + ' on_screen_text', text: s.on_screen_text });
  });
  return out.filter(function (x) {
    return typeof x.text === 'string' && normalizeText(x.text);
  });
}

/**
 * Validates one reel script (generated, regenerated or edited by a human) against the schema
 * and the product's confirmed facts. `label` prefixes each error, e.g. "릴스 2".
 */
function validateReelContent(reel, product, label, options) {
  const errors = [];
  // Storyboard rules apply to every new script, and to older scripts once they have beats.
  const storyboard =
    (options && options.requireStoryboard) ||
    (reel && Array.isArray(reel.scenes) && reel.scenes.some(function (sc) {
      return sc && (sc.beat !== undefined || sc.narration !== undefined);
    }));
  const L = RF_CONFIG.LIMITS;
  const ctx = factContext_(product);
  const allowedNumbers = ctx.allowedNumbers;
  const p = label + ': ';
  if (!reel || typeof reel !== 'object') {
    errors.push(p + '객체가 아닙니다.');
    return errors;
  }
  ['concept', 'hook', 'narration'].forEach(function (k) {
    if (!isNonEmptyString_(reel[k])) errors.push(p + '"' + k + '" 값이 비어 있습니다.');
  });
  if (isNonEmptyString_(reel.hook) && reel.hook.length > L.HOOK_MAX_CHARS) {
    errors.push(p + 'hook이 ' + L.HOOK_MAX_CHARS + '자를 초과합니다.');
  }
  if (isNonEmptyString_(reel.narration) && reel.narration.length > L.NARRATION_MAX_CHARS) {
    errors.push(p + 'narration이 ' + L.NARRATION_MAX_CHARS + '자를 초과합니다.');
  }

  if (!Array.isArray(reel.captions) || reel.captions.length === 0) {
    errors.push(p + '"captions" 배열이 비어 있습니다.');
  } else {
    reel.captions.forEach(function (c, ci) {
      if (!isNonEmptyString_(c)) errors.push(p + 'captions[' + ci + ']가 비어 있습니다.');
      else if (c.length > L.CAPTION_MAX_CHARS)
        errors.push(p + 'captions[' + ci + ']가 ' + L.CAPTION_MAX_CHARS + '자를 초과합니다.');
    });
  }

  if (!Array.isArray(reel.scenes)) {
    errors.push(p + '"scenes" 배열이 없습니다.');
  } else {
    if (reel.scenes.length < L.MIN_SCENES || reel.scenes.length > L.MAX_SCENES) {
      errors.push(p + '장면 수는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개여야 합니다 (받은 개수: ' + reel.scenes.length + ').');
    }
    let total = 0;
    reel.scenes.forEach(function (s, si) {
      const sp = p + '장면 ' + (si + 1) + ': ';
      if (!s || typeof s !== 'object') {
        errors.push(sp + '객체가 아닙니다.');
        return;
      }
      if (s.scene_no !== si + 1) errors.push(sp + 'scene_no는 ' + (si + 1) + '이어야 합니다.');
      if (typeof s.duration_sec !== 'number' || !(s.duration_sec > 0)) {
        errors.push(sp + 'duration_sec는 양수여야 합니다.');
      } else {
        total += s.duration_sec;
      }
      if (!isNonEmptyString_(s.visual)) errors.push(sp + '"visual" 값이 비어 있습니다.');
      if (typeof s.on_screen_text !== 'string') errors.push(sp + '"on_screen_text"는 문자열이어야 합니다.');
      if (!isNonEmptyString_(s.flow_prompt) || s.flow_prompt.length < L.MIN_FLOW_PROMPT_CHARS) {
        errors.push(sp + '"flow_prompt"가 비어 있거나 너무 짧습니다 (' + L.MIN_FLOW_PROMPT_CHARS + '자 이상).');
      }
      if (storyboard) {
        if (RF_CONFIG.BEATS.indexOf(s.beat) === -1) errors.push(sp + '"beat"는 ' + RF_CONFIG.BEATS.join('/') + ' 중 하나여야 합니다.');
        if (!isNonEmptyString_(s.narration)) {
          errors.push(sp + '"narration"(이 장면의 내레이션·자막 한 줄)이 비어 있습니다.');
        } else if ([...normalizeText(s.narration)].length > L.SCENE_NARRATION_MAX_CHARS) {
          errors.push(sp + 'narration은 자막 2줄 이내(' + L.SCENE_NARRATION_MAX_CHARS + '자)여야 합니다.');
        }
        // A scene must fit one Google Flow clip (minus margin); the storyboard limit is never looser.
        const maxSec = Math.min(L.SCENE_MAX_SEC, RF_CONFIG.FLOW.CLIP_SEC - RF_CONFIG.FLOW.CLIP_MARGIN_SEC);
        if (typeof s.duration_sec === 'number' && (s.duration_sec < L.SCENE_MIN_SEC || s.duration_sec > maxSec)) {
          errors.push(sp + '장면 길이는 ' + L.SCENE_MIN_SEC + '~' + maxSec + '초여야 합니다 (Flow 클립 ' + RF_CONFIG.FLOW.CLIP_SEC + '초로 덮을 수 있는 길이).');
        }
      }
    });
    if (storyboard) storyboardErrors_(reel.scenes, options && options.newStructure).forEach(function (e) {
      errors.push(p + e);
    });
    const minTotal = options && options.generated ? L.GENERATED_MIN_TOTAL_SEC : L.MIN_TOTAL_SEC;
    if (total < minTotal || total > L.MAX_TOTAL_SEC) {
      errors.push(p + '총 길이는 ' + minTotal + '~' + L.MAX_TOTAL_SEC + '초여야 합니다 (현재 ' + total + '초). 내용에 맞게 조절하되 억지로 늘리지 마세요.');
    }
  }

  // Fact references: IDs (F1…) from Gemini or the sheet wording stored in REELS. Never free paraphrases.
  const idRange = factId(0) + '~' + factId(Math.max(0, ctx.facts.length - 1));
  if (!Array.isArray(reel.facts_used) || reel.facts_used.length === 0) {
    errors.push(p + '"facts_used"가 비어 있습니다. 확인된 기능 ID(' + idRange + ') 중 최소 1개를 넣으세요.');
  } else {
    reel.facts_used.forEach(function (fact) {
      if (resolveFactRef_(fact, ctx) === -1) {
        errors.push(p + '확인되지 않은 기능을 참조했습니다: "' + fact + '". facts_used에는 확인된 기능 ID(' + idRange + ')만 넣으세요.');
      }
    });
  }
  if (Array.isArray(reel.scenes)) {
    reel.scenes.forEach(function (s, si) {
      if (!s || typeof s !== 'object') return;
      const refs = sceneFactRefs_(s);
      refs.forEach(function (ref) {
        if (resolveFactRef_(ref, ctx) === -1) {
          errors.push(p + '장면 ' + (si + 1) + ': 확인되지 않은 기능을 참조했습니다: "' + ref + '". fact_ids에는 ' + idRange + '만 넣으세요.');
        }
      });
      if (options && options.requireFactRefs && (s.beat === 'DEMO' || s.beat === 'BENEFIT') && !refs.length) {
        errors.push(p + '장면 ' + (si + 1) + ' (' + s.beat + '): 이 장면이 근거로 삼는 확인된 기능 ID를 fact_ids에 넣으세요.');
      }
    });
  }

  labelledViewerTexts_(reel).forEach(function (x) {
    const where = p + x.where + ': ';
    unsupportedClaims_(x.text, ctx, where, options && options.generated).concat(measurementErrors_(x.text, ctx, where)).forEach(function (e) {
      errors.push(e);
    });
  });

  const viewerText = viewerFacingTexts_(reel).join('\n');
  extractNumbers(viewerText).forEach(function (n) {
    if (!allowedNumbers[n]) {
      errors.push(p + '확인된 기능에 없는 수치가 포함되어 있습니다: "' + n + '".');
    }
  });
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (viewerText.indexOf(phrase) !== -1) {
      errors.push(p + '과장/검증 불가 표현이 포함되어 있습니다: "' + phrase + '".');
    }
  });
  if (/https?:\/\/|www\.|coupang\.com|link\.coupang/i.test(viewerText)) {
    errors.push(p + '대본에 URL이 포함되어 있습니다. 링크는 ManyChat DM으로만 전달합니다.');
  }
  return errors;
}

/**
 * Validates the parsed Gemini payload: exactly `expectedCount` reels, each passing validateReelContent,
 * with distinct concepts and hooks, plus (unless options.requireHooks === false) the five hooks H1–H5,
 * the recommended hook the script is built on, and the comment keyword.
 * options.fixedHook: the operator's selected hook — the script must start with exactly this text
 * (hook-style rules are not re-applied to the operator's own wording).
 * Hook style is a warning, not an error (see validateHookSet); only hard problems fail validation.
 * Returns { errors, reels, reelErrors, hookSet, commentKeyword, setErrors, hookErrors, warnings,
 * otherErrors (errors not tied to one hook), recommendedId, reelWarnings }.
 */
function validateGeminiReels(payload, product, expectedCount, options) {
  const count = expectedCount || RF_CONFIG.REELS_PER_PRODUCT;
  const avoidHooks = (options && options.avoidHooks) || [];
  const errors = [];
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.reels)) {
    return { errors: ['응답에 "reels" 배열이 없습니다.'], reels: [], reelErrors: [] };
  }
  const reels = payload.reels;
  const requireHooks = !options || options.requireHooks !== false;
  const fixedHook = options && options.fixedHook ? normalizeText(options.fixedHook) : '';
  let hookSet = null;
  let hs = null;
  if (requireHooks) {
    hs = validateHookSet(payload, product, avoidHooks);
    hookSet = hs.errors.length ? null : hs.hookSet;
  }
  const otherErrors = [];
  const reelWarnings = [];
  const keywordError = commentKeywordError(payload.comment_keyword);
  if (keywordError) otherErrors.push(keywordError);
  if (reels.length !== count) {
    otherErrors.push('릴스 대본은 정확히 ' + count + '개여야 합니다 (받은 개수: ' + reels.length + ').');
  }
  const reelErrors = reels.map(function (reel, i) {
    const label = '릴스 ' + (i + 1);
    const opts = { requireStoryboard: true, requireFactRefs: true, newStructure: true, generated: true };
    let errs = validateReelContent(reel, product, label, opts);
    // With five hooks the script's hook is the recommended one, already checked in the hook set.
    // Without (a rewritten script), its style is checked here: misleading wording fails, style warns.
    if (!fixedHook && !requireHooks && reel && normalizeText(reel.hook)) {
      const st = hookStyleCheck_(reel.hook, product, avoidHooks);
      const p = label + ': hook "' + normalizeText(reel.hook) + '" — ';
      errs = errs.concat(st.errors.map(function (e) { return p + e; }));
      st.warnings.forEach(function (w) { reelWarnings.push(p + w); });
    }
    errs = errs.concat(hookLinkErrors_(reel, label, fixedHook, requireHooks ? payload : null));
    if (reel && !RF_CONFIG.BRAND.PILLARS[reel.pillar]) {
      errs.push(label + ': pillar는 ' + Object.keys(RF_CONFIG.BRAND.PILLARS).join(', ') + ' 중 하나여야 합니다.');
    }
    if (count > 1 && reel && !RF_CONFIG.ANGLES[reel.angle]) {
      errs.push(label + ': angle은 ' + Object.keys(RF_CONFIG.ANGLES).join(', ') + ' 중 하나여야 합니다.');
    }
    return dedupe_(errs);
  });
  reelErrors.forEach(function (list) {
    list.forEach(function (e) {
      otherErrors.push(e);
    });
  });

  // The three reels must be distinct concepts.
  const seenHooks = {};
  const seenConcepts = {};
  reels.forEach(function (reel, i) {
    if (!reel) return;
    const h = normalizeText(reel.hook).toLowerCase();
    const c = normalizeText(reel.concept).toLowerCase();
    if (h && seenHooks[h]) otherErrors.push('릴스 ' + (i + 1) + ': hook이 릴스 ' + seenHooks[h] + '와 중복됩니다.');
    if (c && seenConcepts[c]) otherErrors.push('릴스 ' + (i + 1) + ': concept이 릴스 ' + seenConcepts[c] + '와 중복됩니다.');
    if (h) seenHooks[h] = i + 1;
    if (c) seenConcepts[c] = i + 1;
  });
  // Three different angles and three different openings.
  if (count > 1) {
    const seenAngles = {};
    const seenOpenings = {};
    reels.forEach(function (reel, i) {
      if (!reel) return;
      if (RF_CONFIG.ANGLES[reel.angle] && seenAngles[reel.angle]) {
        otherErrors.push('릴스 ' + (i + 1) + ': angle ' + reel.angle + '이 릴스 ' + seenAngles[reel.angle] + '와 같습니다. 세 릴스는 A·B·C 각도를 하나씩 써야 합니다.');
      }
      if (reel.angle) seenAngles[reel.angle] = i + 1;
      const o = hookOpening_(reel.hook);
      if (o && seenOpenings[o]) {
        otherErrors.push('릴스 ' + (i + 1) + ': hook이 릴스 ' + seenOpenings[o] + '와 같은 말("' + o + '")로 시작합니다. 서로 다른 첫마디로 쓰세요.');
      }
      if (o) seenOpenings[o] = i + 1;
    });
  }

  // De-duplicate identical messages (e.g. the same number repeated).
  const unique = dedupe_(errors.concat(hs ? hs.errors : [], otherErrors));
  // The script's own first scene is the recommended hook's opening (so "keep" changes nothing).
  if (!unique.length && hookSet && reels[0] && reels[0].scenes && reels[0].scenes[0]) {
    const first = reels[0].scenes[0];
    hookSet.hooks.forEach(function (h) {
      if (h.id !== hookSet.recommended.id || h.text !== normalizeText(reels[0].hook)) return;
      h.visual = normalizeText(first.visual);
      h.flow_prompt = normalizeText(first.flow_prompt);
      h.emphasis = normalizeText(first.emphasis);
      h.sfx = normalizeText(first.sfx);
    });
  }
  return {
    errors: unique,
    reels: unique.length ? [] : reels.map(function (r) {
      return canonicalReel_(r, product);
    }),
    reelErrors: reelErrors,
    hookSet: unique.length ? null : hookSet,
    commentKeyword: normalizeText(payload.comment_keyword),
    setErrors: hs ? hs.setErrors : [],
    hookErrors: hs ? hs.hookErrors : {},
    warnings: hs ? hs.warnings : {},
    recommendedId: hs ? hs.recommendedId : '',
    otherErrors: dedupe_(otherErrors),
    reelWarnings: dedupe_(reelWarnings),
  };
}

/** The script's hook is its first spoken line; it must be the recommended (or operator-selected) hook. */
function hookLinkErrors_(reel, label, fixedHook, payload) {
  const errors = [];
  if (!reel || !Array.isArray(reel.scenes) || !reel.scenes[0]) return errors;
  const hook = normalizeText(reel.hook);
  if (normalizeText(reel.scenes[0].narration) !== hook) {
    errors.push(label + ': 첫 장면 narration은 hook과 똑같아야 합니다 ("' + hook + '").');
  }
  if (fixedHook && hook !== fixedHook) {
    errors.push(label + ': 운영자가 선택한 훅 "' + fixedHook + '"으로 정확히 시작해야 합니다 (hook과 첫 장면 narration).');
  }
  if (!fixedHook && payload && Array.isArray(payload.hooks) && payload.recommended_hook) {
    const rec = payload.hooks.filter(function (h) {
      return h && h.id === payload.recommended_hook.id;
    })[0];
    if (rec && normalizeText(rec.text) !== hook) {
      errors.push(label + ': 대본은 추천 훅 ' + rec.id + ' "' + normalizeText(rec.text) + '"으로 시작해야 합니다.');
    }
  }
  return errors;
}

/**
 * Facts check for a hook the operator selected or edited: no invented claims, numbers or
 * measurements (the hook-style rules are the operator's call).
 */
function hookTextErrors(text, product) {
  const ctx = factContext_(product);
  const t = normalizeText(text);
  const errors = unsupportedClaims_(t, ctx, '', false).concat(measurementErrors_(t, ctx, ''));
  extractNumbers(t).forEach(function (n) {
    if (!ctx.allowedNumbers[n]) errors.push('확인된 기능에 없는 수치가 포함되어 있습니다: "' + n + '".');
  });
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (t.indexOf(phrase) !== -1) errors.push('과장/검증 불가 표현이 포함되어 있습니다: "' + phrase + '".');
  });
  return dedupe_(errors);
}

/** Parses REELS "훅 후보(JSON)" → { hooks: [{id,type,label,text}], recommended: {id,reason}|null }. */
function parseHookSet(cell) {
  try {
    const v = JSON.parse(String(cell == null ? '' : cell) || 'null');
    if (v && Array.isArray(v.hooks)) {
      return {
        hooks: v.hooks.filter(function (h) { return h && RF_CONFIG.HOOK_TYPES[h.id] && normalizeText(h.text); }).map(function (h) {
          return {
            id: h.id, type: RF_CONFIG.HOOK_TYPES[h.id].type, label: RF_CONFIG.HOOK_TYPES[h.id].label, text: normalizeText(h.text),
            visual: normalizeText(h.visual), flow_prompt: normalizeText(h.flow_prompt),
            emphasis: normalizeText(h.emphasis), sfx: normalizeText(h.sfx),
          };
        }),
        recommended: v.recommended && v.recommended.id ? { id: v.recommended.id, reason: normalizeText(v.recommended.reason) } : null,
      };
    }
  } catch (e) {
    // fall through
  }
  return { hooks: [], recommended: null };
}

/** Parses REELS "선택한 훅" → { id, text, edited, scriptVersion, by, at } or null. */
function parseSelectedHook(cell) {
  try {
    const v = JSON.parse(String(cell == null ? '' : cell) || 'null');
    return v && normalizeText(v.text) ? v : null;
  } catch (e) {
    return null;
  }
}

/** A simple customer-facing comment keyword (e.g. 우산), never an internal ID. '' = OK or absent. */
function commentKeywordError(keyword) {
  const k = normalizeText(keyword);
  if (!k) return '';
  if (!/^[가-힣A-Za-z]{1,10}$/.test(k) || /^PRD/i.test(k)) {
    return 'comment_keyword "' + k + '"는 공백·숫자·기호 없는 10자 이내 한 단어여야 합니다 (예: 우산). 내부 ID는 쓰지 마세요.';
  }
  return '';
}

const RF_KOREAN_NUMBERS_ = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const RF_COUNTERS_ = '개|가지|조각|칸|단|번|명|분|층|배|쌍|피스|군데|곳|초|일|달|주';

/** Numbers in a hook: digits (with an optional counter) and Korean numerals followed by a counter. */
function hookNumbers_(text) {
  const t = normalizeText(text);
  const out = [];
  const digitRe = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(%|' + RF_COUNTERS_ + ')?', 'g');
  let m;
  while ((m = digitRe.exec(t))) out.push({ token: m[0].trim(), value: m[1], counter: m[2] || '' });
  const wordRe = new RegExp('(?:^|[^가-힣])(' + Object.keys(RF_KOREAN_NUMBERS_).join('|') + ')\\s*(' + RF_COUNTERS_ + ')', 'g');
  while ((m = wordRe.exec(t))) out.push({ token: (m[1] + ' ' + m[2]).trim(), value: String(RF_KOREAN_NUMBERS_[m[1]]), counter: m[2] });
  return out;
}

/**
 * Numbers a hook may use: numbers written in the verified facts / product name, plus the size of a list
 * in a fact ("다크그레이/그레이/화이트" → 3, "상·하단" → 2).
 */
function supportedNumbers_(ctx) {
  const set = {};
  Object.keys(ctx.allowedNumbers).forEach(function (n) {
    set[n] = true;
  });
  ctx.facts.forEach(function (f) {
    f.split(/[()（）:：]/).forEach(function (part) {
      const items = part.split(/[\/,·、]/).map(normalizeText).filter(Boolean);
      if (items.length >= 2) set[String(items.length)] = true;
    });
  });
  return set;
}

// Meaning cues per hook type. Any one cue is enough; a hook without one gets a style warning (never an
// error), so Gemini and the operator are free to word a hook naturally.
const RF_HOOK_CUES_ = {
  // Ends like a question: "?" or an interrogative ending.
  QUESTION: /([?？]|(까요|나요|니|냐|을까|를까|할까|는지)[.!~…]*)\s*$/,
  // Overturns a common belief: negation, contrast, "원래/사실/굳이…".
  MYTH: /(아니|않|안\s|없|말고|대신|오히려|사실|원래|굳이|틀렸|틀린|착각|의외|반대|보통|흔히|당연|오해|잘못|그게\s*아니|필요\s*없)/,
  // A concrete moment: when / where / what happens.
  SITUATION: /(때|날|마다|매일|맨날|항상|늘\s|순간|하면|살면|하는데|는데|하다가|면서|잖아요|아침|저녁|밤|주말|출근|퇴근|비\s|비가|장마|이사|손님|집에|현관|원룸|자취|방|부엌|주방|욕실|화장실|베란다|거실|들어오|나가|굴러|젖은)/,
  // States the fix first: "~면 돼요", "그냥/바로 …", or a declarative/suggestive action verb at the end.
  CONCLUSION_WORD: /(면\s*(돼|되|끝|해결|충분)|이\s*답|답이|정답|해결|결론|그냥|바로|이거면|하나면|이렇게|딱\s)/,
  CONCLUSION_END: /(붙여|붙이|걸어|걸면|꽂아|꽂으|둬|두세|두면|놔|놓아|놓으|넣어|넣으|세워|달아|바꿔|바꾸|써요|쓰세|쓰면|치워|정리해|옮겨|올려|매달아|끼워|모아)(요|요\.|세요|주세요|봐요|면\s*돼요)?[.!~…]*\s*$/,
};

function isQuestionHook_(text) {
  return RF_HOOK_CUES_.QUESTION.test(normalizeText(text));
}

/**
 * Style warnings for the meaning of each hook type (never errors): H1 asks, H2 has a number, H3 overturns
 * a common belief, H4 shows a concrete moment, H5 states the fix first. Judged by meaning cues, not by
 * exact phrases ("원래 우산 자리 없어요" overturns a belief as well as "~아니에요" does).
 */
function hookTypeWarnings_(id, text) {
  const t = normalizeText(text);
  const T = RF_CONFIG.HOOK_TYPES[id];
  const warnings = [];
  if (!T) return warnings;
  const q = isQuestionHook_(t);
  if (id === 'H1') {
    if (!q) warnings.push('질문형인데 질문처럼 들리지 않습니다. 시청자에게 묻는 말로 끝내 보세요.');
  } else if (q) {
    warnings.push(T.label + '인데 질문처럼 들립니다. 질문은 H1이 맡습니다.');
  }
  if (id === 'H2' && !hookNumbers_(t).length) warnings.push('숫자로 시작하는형인데 숫자가 없습니다 (확인된 기능의 숫자, 예: "두 조각").');
  if (id === 'H3' && !RF_HOOK_CUES_.MYTH.test(t)) warnings.push('흔한 생각을 뒤집는 느낌이 약합니다 (예: "~아니에요", "원래 ~없어요", "굳이 ~안 해도 돼요").');
  if (id === 'H4' && !RF_HOOK_CUES_.SITUATION.test(t)) warnings.push('언제·어디서 겪는 순간인지 잘 보이지 않습니다.');
  if (id === 'H5' && !RF_HOOK_CUES_.CONCLUSION_WORD.test(t) && !RF_HOOK_CUES_.CONCLUSION_END.test(t)) {
    warnings.push('해결책이 먼저 들리지 않습니다 (예: "~하면 돼요", "그냥 문에 붙여요").');
  }
  return warnings;
}

/**
 * Hook style, split in two. errors: misleading wording (HOOK_STYLE.AD_PATTERNS marked hard), banned
 * phrases and URLs — never stored. warnings: length, product name first, ad tone, repeating an earlier
 * hook of this product — stored, shown to the operator, and may be improved by one targeted Gemini call.
 * Messages carry no prefix. Returns { errors, warnings }.
 */
function hookStyleCheck_(text, product, avoidHooks) {
  const errors = [];
  const warnings = [];
  const hook = normalizeText(text);
  if (!hook) return { errors: errors, warnings: warnings };
  const H = RF_CONFIG.HOOK_STYLE;
  if ([...hook].length > H.MAX_CHARS) {
    warnings.push('첫 2~3초에 말하기엔 깁니다 (' + [...hook].length + '자). ' + H.MAX_CHARS + '자 이내로 줄여 보세요.');
  }
  // Problem first: the hook should not open with the product.
  const nameTokens = normalizeText(product && product.name).split(' ').filter(function (t) {
    return [...t].length >= 2;
  });
  const first = hook.split(' ')[0];
  if (nameTokens.some(function (t) { return first.indexOf(t) === 0; })) {
    warnings.push('제품 이름으로 시작합니다. 시청자가 겪는 상황·불편으로 시작해 보세요.');
  }
  H.AD_PATTERNS.forEach(function (rule) {
    if (!rule.pattern.test(hook)) return;
    if (rule.hard) errors.push(rule.why + '은(는) 쓸 수 없습니다 (확인되지 않은 결과를 약속합니다).');
    else warnings.push(rule.why + '입니다. 친구에게 말하듯 짧은 구어체로 바꿔 보세요.');
  });
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (hook.indexOf(phrase) !== -1) errors.push('과장/검증 불가 표현이 포함되어 있습니다: "' + phrase + '".');
  });
  if (/https?:\/\/|www\.|coupang\.com|link\.coupang/i.test(hook)) errors.push('훅에 URL이 있습니다.');
  (avoidHooks || []).forEach(function (old) {
    if (normalizeText(old) && looseText_(old) === looseText_(hook)) {
      warnings.push('이 상품의 기존 릴스 훅과 같습니다. 새로운 표현이면 더 좋습니다.');
    }
  });
  return { errors: dedupe_(errors), warnings: dedupe_(warnings) };
}

/**
 * Hard checks for one hook (errors block saving): verified facts and claims, numbers (H2: only numbers
 * backed by the facts, never invented statistics), banned or misleading phrases.
 */
function hookHardErrors_(id, text, ctx, product) {
  const t = normalizeText(text);
  const p = '훅 ' + id + ' "' + t + '" — ';
  const where = '훅 ' + id + ': ';
  const errors = unsupportedClaims_(t, ctx, where, true).concat(measurementErrors_(t, ctx, where));
  if (id === 'H2') {
    const ok = supportedNumbers_(ctx);
    hookNumbers_(t).forEach(function (n) {
      if (n.counter === '명' || n.counter === '%' || n.counter === '배') {
        errors.push(p + '통계·비율처럼 보이는 "' + n.token + '"는 지어낸 수치일 수 있어 쓸 수 없습니다.');
      } else if (!ok[n.value]) {
        errors.push(p + '"' + n.token + '"의 숫자 ' + n.value + '는 확인된 기능에 없습니다. 확인된 기능의 숫자만 쓰세요.');
      }
    });
  } else {
    extractNumbers(t).forEach(function (n) {
      if (!ctx.allowedNumbers[n]) errors.push(where + '확인된 기능에 없는 수치가 포함되어 있습니다: "' + n + '".');
    });
  }
  hookStyleCheck_(t, product, []).errors.forEach(function (e) {
    errors.push(p + e);
  });
  return errors;
}

/**
 * Style warnings for one hook text (type meaning + style), e.g. for a hook the operator edited.
 * Never blocks anything. Returns warning strings without prefix.
 */
function hookWarnings(id, text, product, avoidHooks) {
  if (!normalizeText(text)) return [];
  return dedupe_(hookTypeWarnings_(id, text).concat(hookStyleCheck_(text, product, avoidHooks).warnings));
}

/**
 * The five hooks. Hard errors (block saving): exactly H1–H5 once each with the right type, non-empty
 * text, verified facts / numbers / claims only, no banned or misleading phrases, each with its opening
 * scene, no two hooks identical, a recommended hook with a reason. Style warnings (do not block): length,
 * ad tone, product name first, weak fit to the hook type, the same first words as another hook, repeating
 * an earlier hook of this product.
 * Returns { errors, setErrors, hookErrors: {id: [...]}, warnings: {id: [...]}, recommendedId, hookSet }
 * (errors = setErrors + every hookErrors entry; hookSet only when there are no errors).
 */
function validateHookSet(payload, product, avoidHooks) {
  const setErrors = [];
  const hookErrors = {};
  const warnings = {};
  const ctx = factContext_(product);
  const T = RF_CONFIG.HOOK_TYPES;
  const ids = Object.keys(T);
  const hooks = Array.isArray(payload && payload.hooks) ? payload.hooks : [];
  if (hooks.length !== ids.length) setErrors.push('hooks는 정확히 ' + ids.length + '개(H1~H5)여야 합니다 (받은 개수: ' + hooks.length + ').');
  const byId = {};
  hooks.forEach(function (h) {
    if (!h || !T[h.id]) {
      setErrors.push('hooks의 id는 ' + ids.join(', ') + ' 중 하나여야 합니다: ' + JSON.stringify(h && h.id));
      return;
    }
    if (byId[h.id]) setErrors.push('훅 ' + h.id + '가 두 번 있습니다.');
    byId[h.id] = h;
    if (h.type && h.type !== T[h.id].type) setErrors.push('훅 ' + h.id + '의 type은 ' + T[h.id].type + '이어야 합니다.');
  });
  const seenText = {};
  const seenOpen = {};
  ids.forEach(function (id) {
    const h = byId[id];
    if (!h) {
      if (hooks.length === ids.length) setErrors.push('훅 ' + id + ' (' + T[id].label + ')이 없습니다.');
      return;
    }
    const errs = (hookErrors[id] = []);
    const warns = (warnings[id] = []);
    const text = normalizeText(h.text);
    if (!text) {
      errs.push('훅 ' + id + '의 text가 비어 있습니다.');
      return;
    }
    hookHardErrors_(id, text, ctx, product).forEach(function (e) {
      errs.push(e);
    });
    hookWarnings(id, text, product, avoidHooks).forEach(function (w) {
      warns.push(w);
    });
    // Its opening scene (scene 1 when this hook is chosen).
    if (!normalizeText(h.visual)) errs.push('훅 ' + id + ': visual(이 훅으로 시작할 때 첫 장면 연출)이 비어 있습니다.');
    if (normalizeText(h.flow_prompt).length < RF_CONFIG.LIMITS.MIN_FLOW_PROMPT_CHARS) {
      errs.push('훅 ' + id + ': flow_prompt(첫 장면 Google Flow 프롬프트)가 비어 있거나 너무 짧습니다.');
    }
    const key = looseText_(text);
    if (seenText[key]) errs.push('훅 ' + id + '가 ' + seenText[key] + '와 같습니다. 다섯 훅은 서로 달라야 합니다.');
    else seenText[key] = id;
    const o = hookOpening_(text);
    if (o && seenOpen[o]) warns.push(seenOpen[o] + '와 같은 말("' + o + '")로 시작합니다. 첫마디를 다르게 하면 더 좋습니다.');
    if (o && !seenOpen[o]) seenOpen[o] = id;
  });
  const rec = payload && payload.recommended_hook;
  if (!rec || !byId[rec.id]) setErrors.push('recommended_hook.id는 H1~H5 중 하나여야 합니다.');
  else if (!normalizeText(rec.reason)) setErrors.push('recommended_hook.reason(추천 이유)이 비어 있습니다.');
  Object.keys(hookErrors).forEach(function (id) {
    hookErrors[id] = dedupe_(hookErrors[id]);
  });
  Object.keys(warnings).forEach(function (id) {
    warnings[id] = dedupe_(warnings[id]);
  });
  let errors = setErrors.slice();
  ids.forEach(function (id) {
    errors = errors.concat(hookErrors[id] || []);
  });
  errors = dedupe_(errors);
  const hookSet = errors.length ? null : {
    hooks: ids.map(function (id) {
      const h = byId[id];
      return {
        id: id, type: T[id].type, label: T[id].label, text: normalizeText(h.text),
        visual: normalizeText(h.visual), flow_prompt: normalizeText(h.flow_prompt),
        emphasis: normalizeText(h.emphasis), sfx: normalizeText(h.sfx),
      };
    }),
    recommended: { id: rec.id, reason: normalizeText(rec.reason) },
  };
  return {
    errors: errors,
    setErrors: dedupe_(setErrors),
    hookErrors: hookErrors,
    warnings: warnings,
    recommendedId: rec && byId[rec.id] ? rec.id : '',
    hookSet: hookSet,
  };
}

/** Style warnings of a stored hook set (REELS "훅 후보(JSON)"), per hook id, for the dashboard. */
function hookSetWarnings(set, product, avoidHooks) {
  if (!set || !Array.isArray(set.hooks) || !set.hooks.length) return {};
  return validateHookSet({ hooks: set.hooks, recommended_hook: set.recommended }, product, avoidHooks).warnings;
}

function warningCount_(v, id) {
  return ((v.warnings && v.warnings[id]) || []).length;
}

/**
 * Which hooks one targeted Gemini call should rewrite, instead of regenerating everything:
 * hooks with hard errors, plus (includeWeak) hooks with style warnings. The recommended hook is never
 * rewritten automatically (the script starts with it). Returns null when a targeted rewrite cannot
 * help: a set-level or script error, or a hard error on the recommended hook (→ full retry).
 * v: validateHookSet / validateGeminiReels result. Returns { ids, problems: {id: [...]}, hard } or null.
 */
function hookRevisionPlan(v, includeWeak) {
  if (!v || !v.hookErrors || (v.setErrors || []).length || (v.otherErrors || []).length) return null;
  const rec = v.recommendedId;
  if (!rec || (v.hookErrors[rec] || []).length) return null;
  const ids = [];
  const problems = {};
  let hard = false;
  Object.keys(RF_CONFIG.HOOK_TYPES).forEach(function (id) {
    if (id === rec) return;
    const errs = v.hookErrors[id] || [];
    const warns = includeWeak ? (v.warnings && v.warnings[id]) || [] : [];
    if (!errs.length && !warns.length) return;
    if (errs.length) hard = true;
    ids.push(id);
    problems[id] = errs.concat(warns);
  });
  return { ids: ids, problems: problems, hard: hard };
}

/**
 * Merges rewritten hooks (revised.hooks, ids in targetIds only) into payload, one hook at a time. A
 * rewrite is taken when it has no hard errors and (the old hook had hard errors, or it has fewer style
 * warnings — opts.operator: no more warnings) without adding errors elsewhere in the set. Everything
 * else (other hooks, recommendation, script) is unchanged.
 * Returns { payload, revised: [ids], kept: [ids] }.
 */
function mergeHookRevisions(payload, revised, product, avoidHooks, targetIds, opts) {
  let base = JSON.parse(JSON.stringify(payload || {}));
  let before = validateHookSet(base, product, avoidHooks);
  const out = { payload: base, revised: [], kept: [] };
  const list = Array.isArray(revised && revised.hooks) ? revised.hooks : [];
  (targetIds || []).forEach(function (id) {
    const r = list.filter(function (h) {
      return h && h.id === id;
    })[0];
    const idx = (base.hooks || []).map(function (h) { return h && h.id; }).indexOf(id);
    if (!r || idx === -1 || !normalizeText(r.text)) {
      out.kept.push(id);
      return;
    }
    const old = base.hooks[idx];
    const cand = JSON.parse(JSON.stringify(base));
    cand.hooks[idx] = {
      id: id,
      type: RF_CONFIG.HOOK_TYPES[id].type,
      text: normalizeText(r.text),
      visual: normalizeText(r.visual) || old.visual,
      flow_prompt: normalizeText(r.flow_prompt) || old.flow_prompt,
      emphasis: normalizeText(r.emphasis) || old.emphasis || '',
      sfx: r.sfx == null ? old.sfx || '' : normalizeText(r.sfx),
    };
    const after = validateHookSet(cand, product, avoidHooks);
    const hadErrors = (before.hookErrors[id] || []).length > 0;
    const clean = !(after.hookErrors[id] || []).length &&
      after.errors.length <= before.errors.length - (before.hookErrors[id] || []).length;
    const better = hadErrors ||
      (opts && opts.operator ? warningCount_(after, id) <= warningCount_(before, id) : warningCount_(after, id) < warningCount_(before, id));
    if (clean && better && normalizeText(r.text) !== normalizeText(old.text)) {
      base = cand;
      before = after;
      out.revised.push(id);
    } else {
      out.kept.push(id);
    }
  });
  out.payload = base;
  return out;
}

function dedupe_(list) {
  return list.filter(function (e, idx) {
    return list.indexOf(e) === idx;
  });
}

/**
 * A validated reel with fact references replaced by the exact PRODUCTS wording, so REELS keeps
 * human-readable facts (and the same columns and fingerprint as before). Scene references go to
 * scene.facts; facts_used also includes every fact a scene relies on.
 */
function canonicalReel_(reel, product) {
  const ctx = factContext_(product);
  const out = JSON.parse(JSON.stringify(reel));
  // The creative angle is shown in 컨셉 (no new column), e.g. "A 일상 불편 · 출근길 우산".
  const angleLabel = RF_CONFIG.ANGLES[out.angle];
  if (angleLabel && normalizeText(out.concept).indexOf(angleLabel) !== 0) out.concept = angleLabel + ' · ' + normalizeText(out.concept);
  delete out.angle;
  applyAiLabel_(out);
  const used = [];
  const add = function (ref) {
    const i = resolveFactRef_(ref, ctx);
    if (i !== -1 && used.indexOf(i) === -1) used.push(i);
    return i;
  };
  (out.facts_used || []).forEach(add);
  (out.scenes || []).forEach(function (s) {
    if (!s) return;
    const idx = [];
    sceneFactRefs_(s).forEach(function (ref) {
      const i = add(ref);
      if (i !== -1 && idx.indexOf(i) === -1) idx.push(i);
    });
    delete s.fact_ids;
    s.facts = idx.map(function (i) {
      return ctx.facts[i];
    });
  });
  out.facts_used = used.sort(function (a, b) {
    return a - b;
  }).map(function (i) {
    return ctx.facts[i];
  });
  return out;
}

/**
 * Builds the best payload from several attempts without another paid call: for each position the
 * latest reel that passed on its own. Returns { errors, reels } like validateGeminiReels, or null.
 */
function combineValidReels(attempts, product, expectedCount, options) {
  const count = expectedCount || RF_CONFIG.REELS_PER_PRODUCT;
  // One script + its own five hooks: nothing to combine across attempts.
  if (count < 2 || !options || options.requireHooks !== false) return null;
  const picked = [];
  for (let i = 0; i < count; i++) {
    for (let a = attempts.length - 1; a >= 0; a--) {
      const at = attempts[a];
      if (at && at.reels && at.reels[i] && at.reelErrors && at.reelErrors[i] && !at.reelErrors[i].length) {
        picked[i] = at.reels[i];
        break;
      }
    }
    if (!picked[i]) return null;
  }
  const res = validateGeminiReels({ reels: picked }, product, count, options);
  return res.errors.length ? null : res;
}

/**
 * HOOK first, CTA last, beats in story order, keyword placeholder in the CTA.
 * New scripts (newStructure): HOOK → EMPATHY → SOLUTION → DEMO → CTA (BENEFIT optional).
 * Other scripts (older rows, reviewer edits): DEMO plus BENEFIT or SOLUTION.
 */
function storyboardErrors_(scenes, newStructure) {
  const errors = [];
  const beats = scenes.map(function (sc) {
    return sc ? sc.beat : '';
  });
  const rank = RF_CONFIG.BEAT_RANK;
  if (beats[0] !== 'HOOK') errors.push('첫 장면은 HOOK이어야 합니다.');
  if (beats[beats.length - 1] !== 'CTA') errors.push('마지막 장면은 CTA여야 합니다.');
  const has = function (b) {
    return beats.indexOf(b) !== -1;
  };
  if (newStructure) {
    if (!has('EMPATHY') && !has('PROBLEM')) errors.push('EMPATHY 장면(이 상황이 왜 불편한지)이 필요합니다.');
    if (!has('SOLUTION')) errors.push('SOLUTION 장면(제품을 자연스럽게 등장)이 필요합니다.');
    if (!has('DEMO')) errors.push('DEMO 장면(확인된 기능 시연)이 필요합니다.');
  } else {
    if (!has('DEMO')) errors.push('DEMO 장면이 필요합니다.');
    if (!has('BENEFIT') && !has('SOLUTION')) errors.push('BENEFIT 또는 SOLUTION 장면이 필요합니다.');
  }
  for (let i = 1; i < beats.length; i++) {
    if (rank[beats[i]] < rank[beats[i - 1]]) {
      errors.push('장면 순서는 HOOK → EMPATHY → SOLUTION → DEMO → (BENEFIT) → CTA여야 합니다.');
      break;
    }
  }
  const cta = scenes[scenes.length - 1];
  if (cta && typeof cta.narration === 'string' && cta.narration.indexOf(RF_CONFIG.KEYWORD_PLACEHOLDER) === -1) {
    errors.push('CTA 내레이션에 댓글 키워드 자리 "' + RF_CONFIG.KEYWORD_PLACEHOLDER + '"가 필요합니다.');
  }
  return errors;
}

/** Content pillar id from a stored label or id ('생활 꿀템 발견' or 'PRODUCT_DISCOVERY'), or ''. */
function pillarIdOf(value) {
  const v = normalizeText(value);
  if (!v) return '';
  const P = RF_CONFIG.BRAND.PILLARS;
  if (P[v]) return v;
  const ids = Object.keys(P).filter(function (id) {
    return looseText_(P[id].label) === looseText_(v);
  });
  return ids[0] || '';
}

function pillarLabel(id) {
  const p = RF_CONFIG.BRAND.PILLARS[id];
  return p ? p.label : '';
}

/** Scenes that show an AI visualization carry the on-screen label "AI 시뮬레이션" (renderer burns it in). */
function applyAiLabel_(reel) {
  const label = RF_CONFIG.BRAND.AI_LABEL;
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s) {
    if (!s) return;
    if (s.ai_visualization === true) {
      if (normalizeText(s.on_screen_text).indexOf(label) === -1) s.on_screen_text = normalizeText(label + ' ' + normalizeText(s.on_screen_text));
    } else {
      delete s.ai_visualization;
    }
  });
  return reel;
}

/**
 * Things the operator must confirm are real before approving: personal experience, product tests,
 * international-couple stories, before/after results, comparisons, AI visualizations. Detected in the
 * script text and from the content pillar. Returns [{ type, ask, where, text }] (deduplicated by type+where).
 */
function verificationFlags(reel, pillarId) {
  const flags = [];
  const seen = {};
  const add = function (type, ask, where, text) {
    const k = type + '|' + where;
    if (seen[k]) return;
    seen[k] = true;
    flags.push({ type: type, ask: ask, where: where, text: text || '' });
  };
  if (!reel) return flags;
  const texts = [{ where: 'hook', text: reel.hook }];
  (Array.isArray(reel.scenes) ? reel.scenes : []).forEach(function (s, i) {
    if (s) texts.push({ where: '장면 ' + (i + 1), text: s.narration }, { where: '장면 ' + (i + 1) + ' 화면', text: s.on_screen_text });
  });
  if (!(reel.scenes || []).some(function (s) { return s && s.narration; })) texts.push({ where: 'narration', text: reel.narration });
  texts.forEach(function (x) {
    const t = normalizeText(x.text);
    if (!t) return;
    RF_CONFIG.VERIFICATION_RULES.forEach(function (rule) {
      const m = t.match(rule.pattern);
      if (m) add(rule.type, rule.ask, x.where.replace(/ 화면$/, ''), '"' + t + '"');
    });
  });
  if (pillarId === 'INTL_COUPLE') add('국제부부 이야기', RF_CONFIG.VERIFICATION_RULES[2].ask, '콘텐츠 기둥', pillarLabel(pillarId));
  if (pillarId === 'COMPARE') add('비교', RF_CONFIG.VERIFICATION_RULES[4].ask, '콘텐츠 기둥', pillarLabel(pillarId));
  const aiScenes = (reel.scenes || []).map(function (s, i) {
    return s && s.ai_visualization === true ? i + 1 : 0;
  }).filter(Boolean);
  if (aiScenes.length || pillarId === 'AI_MAKEOVER') {
    add('AI 시뮬레이션', '영상에 "' + RF_CONFIG.BRAND.AI_LABEL + '" 표시가 보이는지, 실제 제품 장면과 구분되는지 확인', aiScenes.length ? '장면 ' + aiScenes.join(', ') : '콘텐츠 기둥', '');
  }
  return flags;
}

/** One line per flag, for the REELS "확인 필요" column. */
function formatVerificationFlags(flags) {
  return flags.map(function (f) {
    return '[' + f.type + '] ' + f.where + ': ' + f.ask + (f.text ? ' — ' + f.text : '');
  }).join('\n');
}

/** The first two words of a hook, for spotting three reels that open the same way. */
function hookOpening_(hook) {
  return normalizeText(hook).replace(/[^\s가-힣A-Za-z0-9]/g, '').split(' ').slice(0, 2).join(' ');
}

/** Finds duplicate values in a list (ignoring blanks). */
function findDuplicates(values) {
  const seen = {};
  const dups = [];
  values.forEach(function (v) {
    const k = normalizeText(v);
    if (!k) return;
    if (seen[k] && dups.indexOf(k) === -1) dups.push(k);
    seen[k] = true;
  });
  return dups;
}

// ===== States.gs =====
/**
 * Approval state machine for REELS rows. Pure functions only (no Apps Script services),
 * so every gate is unit-tested in Node.
 *
 * Operator touchpoints (Issue #2):
 *   1. Select products, enter affiliate URL / verified facts / media permission (PRODUCTS sheet)
 *   2. Approve, edit, request changes or reject scripts before any video work
 *   3. Approve or reject finished videos
 *   4. Publish to Instagram and configure ManyChat manually, then confirm both
 */

const RF_STATUS = {
  SCRIPT_REVIEW_PENDING: 'SCRIPT_REVIEW_PENDING',
  SCRIPT_CHANGES_REQUESTED: 'SCRIPT_CHANGES_REQUESTED',
  SCRIPT_REJECTED: 'SCRIPT_REJECTED',
  SCRIPT_APPROVED: 'SCRIPT_APPROVED',
  VIDEO_IN_PRODUCTION: 'VIDEO_IN_PRODUCTION',
  VIDEO_FAILED: 'VIDEO_FAILED',
  VIDEO_REVIEW_PENDING: 'VIDEO_REVIEW_PENDING',
  VIDEO_CHANGES_REQUESTED: 'VIDEO_CHANGES_REQUESTED',
  VIDEO_REJECTED: 'VIDEO_REJECTED',
  VIDEO_APPROVED: 'VIDEO_APPROVED',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  COMPLETED: 'COMPLETED',
};

const RF_STATUS_LABELS = {
  SCRIPT_REVIEW_PENDING: '대본 검토 대기',
  SCRIPT_CHANGES_REQUESTED: '대본 수정 요청됨',
  SCRIPT_REJECTED: '대본 반려',
  SCRIPT_APPROVED: '대본 승인',
  VIDEO_IN_PRODUCTION: '영상 제작 중',
  VIDEO_FAILED: '영상 제작 오류',
  VIDEO_REVIEW_PENDING: '영상 검토 대기',
  VIDEO_CHANGES_REQUESTED: '영상 수정 요청됨',
  VIDEO_REJECTED: '영상 반려',
  VIDEO_APPROVED: '영상 승인',
  READY_TO_PUBLISH: '게시 준비 완료',
  COMPLETED: '게시·ManyChat 확인 완료',
};

// Cells that make up "the script". The approved fingerprint covers all of them, so any later edit
// (in the dashboard or directly in the sheet) blocks video work until the new version is approved.
const RF_SCRIPT_FIELDS = [
  '컨셉',
  '후킹',
  '내레이션',
  '자막',
  '장면(JSON)',
  'Flow 프롬프트',
  'CTA',
  'ManyChat 키워드',
  '광고 표기',
  '사용한 확인 기능',
];

/**
 * touchpoint: 0 = system step, 1–4 = operator responsibility.
 * from: statuses the action is allowed from. to: resulting status (COMPUTED → decided in planTransition).
 */
const RF_ACTIONS = {
  APPROVE_SCRIPT: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING'], to: 'SCRIPT_APPROVED', label: '대본 승인' },
  REQUEST_SCRIPT_CHANGES: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING'], to: 'SCRIPT_CHANGES_REQUESTED', label: '대본 수정 요청', noteRequired: true },
  EDIT_SCRIPT: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REVIEW_PENDING', label: '대본 직접 수정' },
  REGENERATE_SCRIPT: { touchpoint: 0, from: ['SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REVIEW_PENDING', label: '대본 재생성 (Gemini)' },
  // The operator picks one of the five hooks (optionally edited); the script may be swapped or rewritten.
  SELECT_HOOK: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REVIEW_PENDING', label: '훅 선택' },
  // Five hooks made by Gemini for a script that has none yet (e.g. written before the five-hook workflow).
  SET_HOOKS: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REVIEW_PENDING', label: '훅 5개 만들기 (Gemini)' },
  // Gemini's production plan for an APPROVED script (Production.gs). Text only; status does not change.
  SET_PRODUCTION_PLAN: { touchpoint: 0, from: ['SCRIPT_APPROVED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'], to: 'COMPUTED', label: '제작 계획 (Gemini)' },
  REJECT_SCRIPT: { touchpoint: 2, from: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], to: 'SCRIPT_REJECTED', label: '대본 반려' },
  REOPEN_SCRIPT: { touchpoint: 2, from: ['SCRIPT_APPROVED'], to: 'SCRIPT_REVIEW_PENDING', label: '대본 승인 취소' },
  CONFIRM_MEDIA_RIGHTS: { touchpoint: 2, from: ['SCRIPT_APPROVED', 'SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'], to: 'COMPUTED', label: '영상 권리 확인' },
  START_VIDEO: { touchpoint: 0, from: ['SCRIPT_APPROVED', 'VIDEO_CHANGES_REQUESTED', 'VIDEO_FAILED'], to: 'VIDEO_IN_PRODUCTION', label: '최종 편집 시작' },
  REGISTER_VIDEO: { touchpoint: 0, from: ['VIDEO_IN_PRODUCTION'], to: 'VIDEO_REVIEW_PENDING', label: '완성 영상 등록' },
  MARK_VIDEO_FAILED: { touchpoint: 0, from: ['VIDEO_IN_PRODUCTION'], to: 'VIDEO_FAILED', label: '영상 제작 오류', noteRequired: true },
  APPROVE_VIDEO: { touchpoint: 3, from: ['VIDEO_REVIEW_PENDING'], to: 'VIDEO_APPROVED', label: '영상 승인' },
  REQUEST_VIDEO_CHANGES: { touchpoint: 3, from: ['VIDEO_REVIEW_PENDING'], to: 'VIDEO_CHANGES_REQUESTED', label: '영상 수정 요청', noteRequired: true },
  REJECT_VIDEO: { touchpoint: 3, from: ['VIDEO_REVIEW_PENDING'], to: 'VIDEO_REJECTED', label: '영상 반려' },
  MARK_READY_TO_PUBLISH: { touchpoint: 0, from: ['VIDEO_APPROVED'], to: 'READY_TO_PUBLISH', label: '게시 준비' },
  CONFIRM_PUBLISHED: { touchpoint: 4, from: ['READY_TO_PUBLISH'], to: 'COMPUTED', label: '인스타그램 게시 확인' },
  CONFIRM_MANYCHAT: { touchpoint: 4, from: ['READY_TO_PUBLISH'], to: 'COMPUTED', label: 'ManyChat 설정 확인' },
};

// Values written by the MVP before the 상태 column existed.
const RF_LEGACY_STATUS = { '대본 검토 대기': 'SCRIPT_REVIEW_PENDING' };

function cellText_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
}

/** 53-bit string hash (cyrb53). Detects edits; not a security primitive. */
function hash53_(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Fingerprint of the script cells of a REELS row (object keyed by header name). */
function scriptFingerprint(row) {
  return 'v1-' + hash53_(JSON.stringify(RF_SCRIPT_FIELDS.map(function (f) {
    return cellText_(row[f]);
  })));
}

/** Current status code of a row, understanding MVP-era rows that only have 제작 상태. */
function reelStatus(row) {
  const code = cellText_(row['상태']);
  if (RF_STATUS[code]) return code;
  const legacy = RF_LEGACY_STATUS[cellText_(row['제작 상태'])];
  return legacy || '';
}

function scriptVersionOf(row) {
  return parseInt(cellText_(row['대본 버전']), 10) || 1;
}

function videoVersionOf(row) {
  return parseInt(cellText_(row['영상 버전']), 10) || 0;
}

/** True if the row's current script is exactly the version that was approved. */
function isApprovedScriptIntact(row) {
  const approvedVersion = parseInt(cellText_(row['승인 대본 버전']), 10);
  return (
    !!cellText_(row['승인 대본 해시']) &&
    approvedVersion === scriptVersionOf(row) &&
    cellText_(row['승인 대본 해시']) === scriptFingerprint(row)
  );
}

/** Script cells → reel object in the Gemini schema. */
function rowToReel(row) {
  let scenes = [];
  try {
    scenes = JSON.parse(cellText_(row['장면(JSON)']) || '[]');
  } catch (e) {
    scenes = null;
  }
  return {
    pillar: pillarIdOf(row['콘텐츠 기둥']),
    concept: cellText_(row['컨셉']),
    hook: cellText_(row['후킹']),
    narration: cellText_(row['내레이션']),
    captions: cellText_(row['자막']).split('\n').map(normalizeText).filter(function (c) {
      return c.length > 0;
    }),
    scenes: scenes,
    facts_used: cellText_(row['사용한 확인 기능']).split('\n').map(normalizeText).filter(function (c) {
      return c.length > 0;
    }),
  };
}

/** Reel object → script cells (except keyword/CTA/disclosure, which are code-owned). */
function reelToScriptCells(reel) {
  // Storyboard scripts: the scene lines ARE the narration and the subtitles (single source).
  const lines = Array.isArray(reel.scenes) && reel.scenes.length && reel.scenes.every(function (sc) {
    return sc && typeof sc.narration === 'string' && sc.narration.trim();
  })
    ? reel.scenes.map(function (sc) {
        return normalizeText(sc.narration);
      })
    : null;
  return {
    '컨셉': normalizeText(reel.concept),
    '후킹': normalizeText(reel.hook),
    '내레이션': lines ? lines.join(' ') : normalizeText(reel.narration),
    '자막': (lines || reel.captions.map(normalizeText)).join('\n'),
    '장면(JSON)': JSON.stringify(reel.scenes),
    'Flow 프롬프트': reel.scenes
      .map(function (s) {
        return 'S' + s.scene_no + ' (' + s.duration_sec + 's): ' + normalizeText(s.flow_prompt);
      })
      .join('\n'),
    '사용한 확인 기능': reel.facts_used.map(normalizeText).join('\n'),
  };
}

/**
 * Applies a human edit to the current script. Only text fields are editable; scene count,
 * timing and facts_used stay as generated unless explicitly provided.
 */
/** "선택한 훅" cell: the operator's choice, stored with the script version it applies to. */
function selectedHookCell_(base, text, edited, recommended, scriptVersion, mode, actor, at) {
  return JSON.stringify({
    id: base.id,
    label: base.label,
    text: normalizeText(text),
    edited: !!edited,
    recommended: !!recommended,
    scriptVersion: scriptVersion,
    mode: mode,
    by: actor || '',
    at: at instanceof Date ? at.toISOString() : String(at || ''),
  });
}

/**
 * The current script opened by another hook: the hook line (first scene narration, first caption, hook)
 * and — when the hook carries one — its own opening scene (visual, Flow prompt, emphasis, SFX).
 * Scenes 2+ are unchanged (they are written to follow any of the five hooks).
 */
function swapHook_(reel, text, opening) {
  const out = JSON.parse(JSON.stringify(reel));
  const old = normalizeText(reel.hook);
  out.hook = text;
  const first = Array.isArray(out.scenes) ? out.scenes[0] : null;
  if (first && (normalizeText(first.narration) === old || first.beat === 'HOOK')) {
    first.narration = text;
    if (opening && normalizeText(opening.visual)) first.visual = normalizeText(opening.visual);
    if (opening && normalizeText(opening.flow_prompt)) first.flow_prompt = normalizeText(opening.flow_prompt);
    if (opening && opening.emphasis !== undefined) first.emphasis = normalizeText(opening.emphasis);
    if (opening && opening.sfx !== undefined) first.sfx = normalizeText(opening.sfx);
  }
  if (Array.isArray(out.captions) && normalizeText(out.captions[0]) === old) out.captions[0] = text;
  return out;
}

/** True if the hook's opening scene differs from the script's current first scene. */
function openingDiffers_(reel, opening) {
  const first = reel && Array.isArray(reel.scenes) ? reel.scenes[0] : null;
  if (!first || !opening) return false;
  return (!!normalizeText(opening.visual) && normalizeText(opening.visual) !== normalizeText(first.visual)) ||
    (!!normalizeText(opening.flow_prompt) && normalizeText(opening.flow_prompt) !== normalizeText(first.flow_prompt));
}

/**
 * Verification flags for a row's script: detected in the text and pillar, plus any "[Gemini 요청]"
 * lines Gemini added at generation (kept until the reviewer confirms them).
 */
function verificationLines_(reel, pillarId, row) {
  const lines = formatVerificationFlags(verificationFlags(reel, pillarId)).split('\n').filter(Boolean);
  cellText_(row && row['확인 필요']).split('\n').forEach(function (l) {
    if (l.indexOf('[Gemini 요청]') === 0 && lines.indexOf(l) === -1) lines.push(l);
  });
  return lines;
}

function mergeScriptEdit(current, edit) {
  const merged = JSON.parse(JSON.stringify(current));
  if (edit.pillar) {
    const pid = pillarIdOf(edit.pillar);
    if (!pid) throw new Error('콘텐츠 기둥은 ' + Object.keys(RF_CONFIG.BRAND.PILLARS).map(pillarLabel).join(', ') + ' 중 하나여야 합니다.');
    merged.pillar = pid;
  }
  ['concept', 'hook', 'narration'].forEach(function (k) {
    if (typeof edit[k] === 'string') merged[k] = edit[k];
  });
  if (Array.isArray(edit.captions)) merged.captions = edit.captions.map(String);
  if (Array.isArray(edit.facts_used)) merged.facts_used = edit.facts_used.map(String);
  if (Array.isArray(edit.scenes) && Array.isArray(merged.scenes)) {
    if (edit.scenes.length !== merged.scenes.length) {
      throw new Error('장면 개수는 수정할 수 없습니다. 장면 구성을 바꾸려면 "수정 요청"으로 재생성하세요.');
    }
    edit.scenes.forEach(function (es, i) {
      ['visual', 'on_screen_text', 'flow_prompt', 'narration'].forEach(function (k) {
        if (typeof es[k] === 'string') merged.scenes[i][k] = es[k];
      });
      if (typeof es.ai_visualization === 'boolean') {
        merged.scenes[i].ai_visualization = es.ai_visualization;
        // Unticking removes the automatic label (the reviewer's own on-screen text stays).
        if (!es.ai_visualization) {
          merged.scenes[i].on_screen_text = normalizeText(String(merged.scenes[i].on_screen_text || '').split(RF_CONFIG.BRAND.AI_LABEL).join(''));
        }
      }
    });
  }
  return merged;
}

function hostOf_(url) {
  const m = String(url).match(/^https:\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/** Returns '' if the Coupang Partners URL is acceptable, otherwise an actionable error. */
function affiliateUrlError(url) {
  const u = normalizeText(url);
  if (!u) return 'PRODUCTS의 "쿠팡파트너스 URL"이 비어 있습니다. 쿠팡 파트너스에서 만든 링크를 입력하세요.';
  if (RF_CONFIG.AFFILIATE_URL_HOSTS.indexOf(hostOf_(u)) === -1) {
    return '"쿠팡파트너스 URL"은 https://link.coupang.com/… 또는 https://coupa.ng/… 형식의 파트너스 링크여야 합니다: ' + u;
  }
  return '';
}

/** Extracts a Google Drive file ID from a share link or a bare ID. Returns '' if none. */
function parseDriveFileId(input) {
  const s = normalizeText(input);
  let m = s.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

function driveViewUrl(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/view';
}

function drivePreviewUrl(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/preview';
}

function disclosureError_(row) {
  const d = cellText_(row['광고 표기']);
  if (d.indexOf('쿠팡 파트너스') === -1 || d.indexOf('수수료') === -1) {
    return '"광고 표기"에 쿠팡 파트너스 활동 및 수수료 문구가 없습니다. 기본 문구로 되돌리세요: ' + RF_CONFIG.AFFILIATE_DISCLOSURE;
  }
  return '';
}

function staleError_(row, status) {
  return new Error(
    '이 릴스(' + row['릴스ID'] + ')는 이미 다른 곳에서 변경되었습니다 (현재: ' +
      (RF_STATUS_LABELS[status] || status || '알 수 없음') + ', 대본 v' + scriptVersionOf(row) +
      '). 새로고침 후 다시 확인하세요.'
  );
}

/**
 * Plans a transition. Pure: returns { updates, audit, status, noop } or throws an Error
 * with an actionable Korean message. The caller writes `updates` to the REELS row and `audit` to AUDIT.
 *
 * input: {
 *   expectedStatus, expectedScriptVersion, expectedVideoVersion,  // optimistic concurrency
 *   note, edit (EDIT_SCRIPT), reel (REGENERATE_SCRIPT), videoUrl (REGISTER_VIDEO), instagramUrl
 * }
 * ctx: { actor, now }
 */
function planTransition(row, product, action, input, ctx) {
  const def = RF_ACTIONS[action];
  if (!def) throw new Error('알 수 없는 작업입니다: ' + action);
  input = input || {};
  const status = reelStatus(row);
  const scriptVersion = scriptVersionOf(row);
  const videoVersion = videoVersionOf(row);
  let note = normalizeText(input.note);

  // Manual confirmations are idempotent: confirming twice changes nothing.
  if (
    (action === 'CONFIRM_PUBLISHED' && cellText_(row['게시 확인일시'])) ||
    (action === 'CONFIRM_MANYCHAT' && cellText_(row['ManyChat 설정 확인일시']))
  ) {
    return { noop: true, status: status, updates: {}, audit: null };
  }

  // Stale or duplicate request (e.g. double tap on iPhone, two open tabs).
  const versionsMatch =
    (input.expectedScriptVersion == null || Number(input.expectedScriptVersion) === scriptVersion) &&
    (input.expectedVideoVersion == null || Number(input.expectedVideoVersion) === videoVersion);
  if (input.expectedStatus && input.expectedStatus !== status) {
    if (def.to === status && versionsMatch && !/EDIT|REGENERATE|REGISTER|SELECT|SET_HOOKS|SET_PRODUCTION_PLAN/.test(action)) {
      return { noop: true, status: status, updates: {}, audit: null };
    }
    throw staleError_(row, status);
  }
  if (!versionsMatch) throw staleError_(row, status);

  if (def.from.indexOf(status) === -1) {
    throw new Error(
      '"' + def.label + '"은(는) 현재 상태(' + (RF_STATUS_LABELS[status] || status || '상태 없음') + ')에서 할 수 없습니다.'
    );
  }
  if (def.noteRequired && !note) throw new Error('"' + def.label + '"에는 메모(사유)가 필요합니다.');

  const now = ctx.now;
  const actor = ctx.actor || '';
  const updates = {};
  let snapshot = null;
  let to = def.to;
  let newScriptVersion = scriptVersion;
  let newVideoVersion = videoVersion;

  function reviewScript() {
    updates['대본 검토자'] = actor;
    updates['대본 검토일시'] = now;
    updates['대본 검토 메모'] = note;
  }
  function reviewVideo() {
    updates['영상 검토자'] = actor;
    updates['영상 검토일시'] = now;
    updates['영상 검토 메모'] = note;
  }
  function requireApprovedScript() {
    if (!isApprovedScriptIntact(row)) {
      throw new Error(
        '승인된 대본과 현재 대본이 다릅니다 (승인 후 시트에서 수정되었을 수 있음). ' +
          '"대본 승인 취소" 후 현재 버전을 다시 검토·승인하세요.'
      );
    }
  }
  function requirePermission() {
    if (!isPermissionApproved(product.permission)) {
      throw new Error(
        'PRODUCTS의 "영상 사용 허가 상태"가 확인되지 않았습니다 (현재: "' + (normalizeText(product.permission) || '비어 있음') + '"). ' +
          '대시보드에서 "자체 제작 / AI 생성 영상 권리 확인"에 체크하거나, ' +
          '판매처/제조사 미디어의 재사용·AI 편집 허가를 확인한 뒤 "허가 완료"로, 자체 촬영·AI 생성 영상만 쓴다면 "자체 제작"으로 입력하세요. ' +
          '마켓 등록만으로는 허가가 아닙니다.'
      );
    }
  }
  function replaceScript(newReel, label) {
    applyAiLabel_(newReel);
    const errors = validateReelContent(newReel, product, label);
    if (errors.length) throw new Error('수정한 대본이 검증 규칙에 맞지 않습니다:\n- ' + errors.join('\n- '));
    const cells = reelToScriptCells(newReel);
    Object.keys(cells).forEach(function (k) {
      updates[k] = cells[k];
    });
    newScriptVersion = scriptVersion + 1;
    updates['대본 버전'] = newScriptVersion;
    updates['승인 대본 버전'] = '';
    updates['승인 대본 해시'] = '';
    updates['Flow 장면 프롬프트'] = '';
    updates['제작 계획(JSON)'] = '';
    // Optional brand columns: pillar (if given) and the recomputed verification flags.
    if (newReel.pillar) updates['콘텐츠 기둥'] = pillarLabel(newReel.pillar);
    updates['확인 필요'] = verificationLines_(newReel, newReel.pillar || pillarIdOf(row['콘텐츠 기둥']), row).join('\n');
    snapshot = cells;
  }

  // An edit or revision that keeps the chosen hook keeps the choice (now for the new version).
  function carrySelection_() {
    const chosen = parseSelectedHook(row['선택한 훅']);
    if (chosen && newScriptVersion !== scriptVersion && updates['후킹'] !== undefined && normalizeText(updates['후킹']) === normalizeText(chosen.text)) {
      chosen.scriptVersion = newScriptVersion;
      updates['선택한 훅'] = JSON.stringify(chosen);
    }
  }

  switch (action) {
    case 'APPROVE_SCRIPT': {
      if (input.expectedScriptVersion == null) throw new Error('승인할 대본 버전이 지정되지 않았습니다. 새로고침 후 다시 시도하세요.');
      const reel = rowToReel(row);
      if (!reel.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. 대시보드에서 수정하거나 재생성하세요.');
      const errors = validateReelContent(reel, product, '대본');
      if (errors.length) throw new Error('현재 대본이 검증 규칙에 맞지 않아 승인할 수 없습니다:\n- ' + errors.join('\n- '));
      const dErr = disclosureError_(row);
      if (dErr) throw new Error(dErr);
      // The final hook is the operator's choice (one of five), made on THIS script version, and the
      // operator confirms they reviewed the script with it. Applies to every script under review.
      const hookSet = parseHookSet(row['훅 후보(JSON)']);
      if (!hookSet.hooks.length) {
        throw new Error('이 대본에는 훅 후보 5개가 없습니다. 대시보드 ②에서 "훅 5개 만들기"를 누른 뒤 훅을 고르세요 (REELS에 "훅 후보(JSON)" 열이 없으면 먼저 "시트 준비"를 실행하세요).');
      }
      const chosen = parseSelectedHook(row['선택한 훅']);
      if (!chosen) throw new Error('훅을 먼저 선택하세요. 대시보드 ②에서 훅 5개 중 하나를 고르면 승인할 수 있습니다 (최종 훅은 운영자가 고릅니다).');
      if (normalizeText(chosen.text) !== normalizeText(row['후킹'])) {
        throw new Error('선택한 훅 "' + normalizeText(chosen.text) + '"과 현재 대본의 훅이 다릅니다. 훅을 다시 선택하세요.');
      }
      if (Number(chosen.scriptVersion) !== scriptVersion) {
        throw new Error('훅을 고른 뒤 대본이 바뀌었습니다 (선택: v' + chosen.scriptVersion + ', 현재: v' + scriptVersion + '). 훅을 다시 확인해 선택하세요.');
      }
      if (input.hookReviewed !== true) {
        throw new Error('선택한 훅이 반영된 대본 v' + scriptVersion + '을(를) 확인했다고 체크한 뒤 승인하세요.');
      }
      note = (note ? note + ' · ' : '') + '훅 ' + chosen.id + ': "' + normalizeText(chosen.text) + '" (대본 v' + scriptVersion + ' 확인함)';
      // Personal experience, tests, couple stories, results, comparisons, AI scenes: the reviewer must
      // confirm they are real (or labelled) before approval.
      const flags = verificationLines_(reel, pillarIdOf(row['콘텐츠 기둥']), row);
      if (flags.length && input.flagsConfirmed !== true) {
        throw new Error('확인 필요 항목 ' + flags.length + '건을 실제로 확인한 뒤 "확인했습니다"에 체크하고 승인하세요:\n- ' + flags.join('\n- '));
      }
      if (flags.length) {
        note = (note ? note + ' · ' : '') + '확인 필요 ' + flags.length + '건 확인함: ' + flags.join(' / ');
        updates['확인 필요'] = flags.join('\n');
      }
      updates['승인 대본 버전'] = scriptVersion;
      updates['승인 대본 해시'] = scriptFingerprint(row);
      // Flow prompts exist only for an approved script (protects Flow credits). Generated by code, free.
      updates['Flow 장면 프롬프트'] = JSON.stringify(buildFlowScenePrompts(row, product));
      reviewScript();
      snapshot = {};
      RF_SCRIPT_FIELDS.forEach(function (f) {
        snapshot[f] = cellText_(row[f]);
      });
      break;
    }
    case 'REQUEST_SCRIPT_CHANGES':
    case 'REJECT_SCRIPT':
      reviewScript();
      break;
    case 'REOPEN_SCRIPT':
      updates['승인 대본 버전'] = '';
      updates['승인 대본 해시'] = '';
      updates['Flow 장면 프롬프트'] = '';
      updates['제작 계획(JSON)'] = '';
      reviewScript();
      break;
    case 'EDIT_SCRIPT': {
      const current = rowToReel(row);
      if (!current.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. "수정 요청" 후 재생성하세요.');
      const merged = mergeScriptEdit(current, input.edit || {});
      replaceScript(merged, '수정한 대본');
      // Writing the hook yourself is choosing it (stored with the new script version).
      if (normalizeText(merged.hook) !== normalizeText(current.hook) && parseHookSet(row['훅 후보(JSON)']).hooks.length) {
        updates['선택한 훅'] = selectedHookCell_({ id: 'CUSTOM', label: '직접 작성' }, merged.hook, true, false, newScriptVersion, 'edited', actor, now);
      } else {
        carrySelection_();
      }
      reviewScript();
      break;
    }
    case 'SELECT_HOOK': {
      const set = parseHookSet(row['훅 후보(JSON)']);
      if (!set.hooks.length) throw new Error('이 대본에는 훅 후보가 없습니다 (이전 버전에서 만든 대본). "직접 수정"으로 훅을 바꾸세요.');
      const base = set.hooks.filter(function (h) {
        return h.id === input.hookId;
      })[0];
      if (!base) throw new Error('훅은 ' + set.hooks.map(function (h) { return h.id; }).join(', ') + ' 중에서 고르세요.');
      const text = normalizeText(input.text || base.text);
      if (!text) throw new Error('훅 문장이 비어 있습니다.');
      const hookErrors = hookTextErrors(text, product);
      if (hookErrors.length) throw new Error('이 훅은 쓸 수 없습니다:\n- ' + hookErrors.join('\n- '));
      const current = rowToReel(row);
      if (!current.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. "수정 요청" 후 재생성하세요.');
      let mode = 'kept';
      if (input.reel) {
        // Rewritten by Gemini around the chosen hook (validated in apiSelectHook and again here).
        if (normalizeText(input.reel.hook) !== text) throw new Error('다시 쓴 대본이 선택한 훅으로 시작하지 않습니다.');
        replaceScript(input.reel, '훅으로 다시 쓴 대본');
        mode = 'regenerated';
      } else if (normalizeText(current.hook) !== text || openingDiffers_(current, base)) {
        // Free swap: the hook line and the hook's own opening scene (visual, Flow prompt, emphasis, SFX).
        replaceScript(swapHook_(current, text, base), '훅을 바꾼 대본');
        mode = 'swapped';
      }
      updates['선택한 훅'] = selectedHookCell_(base, text, text !== base.text, !!(set.recommended && set.recommended.id === base.id), newScriptVersion, mode, actor, now);
      note = (note ? note + ' · ' : '') + '훅 ' + base.id + ' (' + base.label + ') 선택' + (text !== base.text ? ' (수정)' : '') + ': "' + text + '"' +
        (mode === 'regenerated' ? ' — Gemini로 대본 다시 씀' : mode === 'swapped' ? ' — 훅만 교체' : '');
      to = mode === 'kept' ? status : 'SCRIPT_REVIEW_PENDING';
      if (!snapshot) snapshot = { '선택한 훅': text };
      break;
    }
    case 'REGENERATE_SCRIPT':
      replaceScript(input.reel, '재생성 대본');
      carrySelection_();
      break;
    case 'SET_HOOKS': {
      const hs = input.hookSet;
      if (!hs || !Array.isArray(hs.hooks) || hs.hooks.length !== Object.keys(RF_CONFIG.HOOK_TYPES).length) {
        throw new Error('훅 5개가 올바르지 않습니다.');
      }
      updates['훅 후보(JSON)'] = JSON.stringify(hs);
      if (Array.isArray(input.revisedIds)) {
        // Some hooks improved (apiReviseHook): the choice stays unless the chosen hook was rewritten.
        const sel = parseSelectedHook(row['선택한 훅']);
        if (sel && input.revisedIds.indexOf(sel.id) !== -1) updates['선택한 훅'] = '';
        note = (note ? note + ' · ' : '') + '훅 ' + input.revisedIds.join(', ') + ' 다듬기 (Gemini): ' +
          hs.hooks.filter(function (h) { return input.revisedIds.indexOf(h.id) !== -1; }).map(function (h) { return '"' + h.text + '"'; }).join(', ') +
          '. 대본은 바뀌지 않았습니다.';
      } else {
        updates['선택한 훅'] = '';
        note = (note ? note + ' · ' : '') + '훅 5개 생성 (추천 ' + (hs.recommended ? hs.recommended.id : '-') + '). 대본은 바뀌지 않았습니다.';
      }
      to = status;
      snapshot = { '훅 후보(JSON)': updates['훅 후보(JSON)'] };
      break;
    }
    case 'SET_PRODUCTION_PLAN': {
      // Gemini plans only for an approved, unchanged script; the plan is bound to its fingerprint.
      requireApprovedScript();
      const plan = input.plan;
      if (!plan || plan.approvedHash !== cellText_(row['승인 대본 해시']) || Number(plan.scriptVersion) !== scriptVersion) {
        throw new Error('제작 계획이 현재 승인된 대본 버전과 맞지 않습니다.');
      }
      if (!Array.isArray(input.flowPrompts) || !input.flowPrompts.length) throw new Error('Flow 장면 프롬프트가 비어 있습니다.');
      updates['제작 계획(JSON)'] = JSON.stringify(plan);
      updates['Flow 장면 프롬프트'] = JSON.stringify(input.flowPrompts);
      note = (note ? note + ' · ' : '') + '제작 계획 (Gemini): 장면 ' + plan.scenes.length + '개의 Flow 프롬프트·음성 속도/쉼·자막 강조·컷 구성. 제품 이미지 ' + plan.references.length + '장 기준. 대본은 바뀌지 않았습니다.';
      to = status;
      snapshot = { '제작 계획(JSON)': updates['제작 계획(JSON)'] };
      break;
    }
    case 'CONFIRM_MEDIA_RIGHTS':
      product.permission = '자체 제작';
      to = status;
      note = (note ? note + ' · ' : '') + '영상 사용 권리 확인 (자체 제작 / Google Flow AI 생성)';
      snapshot = { permission: '자체 제작' };
      break;
    case 'START_VIDEO':
      requireApprovedScript();
      if (input.rightsConfirmed === true) {
        product.permission = '자체 제작';
      }
      requirePermission();
      updates['오류'] = '';
      break;
    case 'REGISTER_VIDEO': {
      const fileId = parseDriveFileId(input.videoUrl);
      if (!fileId) throw new Error('Google Drive MP4 공유 링크(https://drive.google.com/file/d/…)를 입력하세요.');
      requireApprovedScript();
      newVideoVersion = videoVersion + 1;
      updates['영상 버전'] = newVideoVersion;
      updates['영상 파일 URL'] = driveViewUrl(fileId);
      updates['오류'] = '';
      snapshot = { video: driveViewUrl(fileId) };
      break;
    }
    case 'MARK_VIDEO_FAILED':
      updates['오류'] = note;
      break;
    case 'APPROVE_VIDEO':
      if (input.expectedVideoVersion == null) throw new Error('승인할 영상 버전이 지정되지 않았습니다. 새로고침 후 다시 시도하세요.');
      requireApprovedScript();
      reviewVideo();
      snapshot = { video: cellText_(row['영상 파일 URL']) };
      break;
    case 'REQUEST_VIDEO_CHANGES':
    case 'REJECT_VIDEO':
      reviewVideo();
      break;
    case 'MARK_READY_TO_PUBLISH': {
      requireApprovedScript();
      requirePermission();
      const errs = [affiliateUrlError(product.affiliateUrl), disclosureError_(row)];
      if (!parseDriveFileId(row['영상 파일 URL'])) errs.push('"영상 파일 URL"이 비어 있습니다.');
      if (!cellText_(row['ManyChat 키워드'])) errs.push('"ManyChat 키워드"가 비어 있습니다.');
      const real = errs.filter(function (e) {
        return e;
      });
      if (real.length) throw new Error('게시 준비 조건이 부족합니다:\n- ' + real.join('\n- '));
      updates['오류'] = '';
      break;
    }
    case 'CONFIRM_PUBLISHED':
    case 'CONFIRM_MANYCHAT': {
      const isPublish = action === 'CONFIRM_PUBLISHED';
      if (isPublish) {
        const ig = normalizeText(input.instagramUrl);
        if (ig && !/^https:\/\/(www\.)?instagram\.com\//i.test(ig)) {
          throw new Error('인스타그램 게시물 URL은 https://www.instagram.com/… 형식이어야 합니다.');
        }
        updates['게시 확인일시'] = now;
        if (ig) updates['인스타그램 URL'] = ig;
      } else {
        updates['ManyChat 설정 확인일시'] = now;
      }
      const published = isPublish || !!cellText_(row['게시 확인일시']);
      const manychat = !isPublish || !!cellText_(row['ManyChat 설정 확인일시']);
      to = published && manychat ? 'COMPLETED' : 'READY_TO_PUBLISH';
      break;
    }
  }

  updates['상태'] = to;
  updates['제작 상태'] = RF_STATUS_LABELS[to];

  return {
    noop: false,
    status: to,
    updates: updates,
    audit: {
      '일시': now,
      '릴스ID': row['릴스ID'],
      '상품ID': row['상품ID'],
      '작업': action,
      '이전 상태': status,
      '새 상태': to,
      '대본 버전': newScriptVersion,
      '영상 버전': newVideoVersion,
      '작업자': actor,
      '메모': note,
      '스냅샷(JSON)': snapshot ? JSON.stringify(snapshot) : '',
    },
  };
}

/** The four operator touchpoints for one reel, for display and audit. */
function touchpointSummary(row, product) {
  const status = reelStatus(row);
  const after = function (s) {
    const order = Object.keys(RF_STATUS);
    return order.indexOf(status) >= order.indexOf(s);
  };
  const scriptApproved = !!cellText_(row['승인 대본 해시']) && status !== 'SCRIPT_REJECTED';
  const videoApproved = ['VIDEO_APPROVED', 'READY_TO_PUBLISH', 'COMPLETED'].indexOf(status) !== -1;
  return [
    {
      n: 1,
      label: '상품·제휴 링크·허가 확인',
      done: !affiliateUrlError(product.affiliateUrl) && isPermissionApproved(product.permission) &&
        parseConfirmedFeatures(product.features).length > 0,
      detail: [
        affiliateUrlError(product.affiliateUrl) ? '제휴 링크 필요' : '제휴 링크 ✓',
        isPermissionApproved(product.permission) ? '영상 허가 ✓' : '영상 허가 미확인',
      ].join(' · '),
    },
    {
      n: 2,
      label: '대본 승인',
      done: scriptApproved,
      detail: scriptApproved
        ? 'v' + cellText_(row['승인 대본 버전']) + ' · ' + cellText_(row['대본 검토자']) + ' · ' + cellText_(row['대본 검토일시'])
        : RF_STATUS_LABELS[status] || '',
    },
    {
      n: 3,
      label: '영상 승인',
      done: videoApproved,
      detail: videoApproved
        ? 'v' + videoVersionOf(row) + ' · ' + cellText_(row['영상 검토자']) + ' · ' + cellText_(row['영상 검토일시'])
        : after('VIDEO_IN_PRODUCTION') ? RF_STATUS_LABELS[status] : '대본 승인 후',
    },
    {
      n: 4,
      label: '인스타그램 게시·ManyChat 설정',
      done: status === 'COMPLETED',
      detail: [
        cellText_(row['게시 확인일시']) ? '게시 ✓' : '게시 미확인',
        cellText_(row['ManyChat 설정 확인일시']) ? 'ManyChat ✓' : 'ManyChat 미확인',
      ].join(' · '),
    },
  ];
}

/** True if the approved script has an AI visualization scene or is in the AI 공간 변신 pillar. */
function hasAiScenes_(row) {
  const reel = rowToReel(row);
  return pillarIdOf(row['콘텐츠 기둥']) === 'AI_MAKEOVER' || (reel.scenes || []).some(function (s) {
    return s && s.ai_visualization === true;
  });
}

/** Text the operator pastes into Instagram and ManyChat. Only for READY_TO_PUBLISH / COMPLETED reels. */
function buildPublishingPack(row, product) {
  const status = reelStatus(row);
  if (['READY_TO_PUBLISH', 'COMPLETED'].indexOf(status) === -1) {
    throw new Error('게시 자료는 "게시 준비 완료" 상태에서만 볼 수 있습니다.');
  }
  const disclosure = cellText_(row['광고 표기']);
  const keyword = cellText_(row['ManyChat 키워드']);
  const fileId = parseDriveFileId(row['영상 파일 URL']);
  return {
    reelId: row['릴스ID'],
    videoUrl: driveViewUrl(fileId),
    videoDownloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId,
    // First line: Coupang Partners disclosure (required). AI visualization scenes are disclosed too.
    instagramCaption: ['[광고] ' + disclosure, '', cellText_(row['후킹'])]
      .concat(hasAiScenes_(row) ? ['', '※ 일부 장면은 ' + RF_CONFIG.BRAND.AI_LABEL + '이에요. 실제 제품 모습과 다를 수 있어요.'] : [])
      .concat(['', buildCta(keyword)]).join('\n'),
    manychatKeyword: keyword,
    manychatDm: '요청하신 상품 링크예요 👉 ' + normalizeText(product.affiliateUrl) + '\n\n' + disclosure,
    affiliateUrl: normalizeText(product.affiliateUrl),
    checklist: [
      'MP4를 iPhone에 저장 (Drive 앱 → ⋯ → 사본 보내기 → 동영상 저장)',
      '인스타그램에 릴스 업로드, 캡션 붙여넣기 (첫 줄 [광고] 표기 유지)',
      '"유료 광고 포함" 라벨 설정 (인스타그램 고급 설정)',
      'Google Flow 등 AI로 만든 장면이 있으면 인스타그램 "AI 정보" 라벨 켜기',
      'ManyChat에서 키워드 "' + keyword + '" → DM 문구 연결 후 활성화',
      '테스트 계정으로 댓글 달아 DM 링크가 맞는 상품인지 확인',
      '대시보드에서 "게시 확인", "ManyChat 확인" 누르기',
    ],
  };
}

// ===== Reels.gs =====
/**
 * Pure builders that turn validated Gemini output into REELS rows.
 */

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Returns `count` new reel IDs for a product, continuing after the highest existing one.
 * e.g. PRD-001 with existing [PRD-001-R01, PRD-001-R02] → [PRD-001-R03, ...].
 */
function nextReelIds(productId, existingIds, count) {
  const prefix = productId + '-R';
  let max = 0;
  existingIds.forEach(function (id) {
    const s = normalizeText(id);
    if (s.indexOf(prefix) !== 0) return;
    const suffix = s.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    const n = parseInt(suffix, 10);
    if (n > max) max = n;
  });
  const taken = {};
  existingIds.forEach(function (id) {
    taken[normalizeText(id)] = true;
  });
  const ids = [];
  let n = max;
  while (ids.length < count) {
    n += 1;
    const id = prefix + pad2_(n);
    if (!taken[id]) ids.push(id);
  }
  return ids;
}

/** Post-specific ManyChat keyword derived from the reel ID (e.g. PRD-001-R01 → PRD001R01). */
function buildManyChatKeyword(reelId) {
  return reelId.replace(/-/g, '');
}

function buildCta(keyword) {
  return '댓글에 "' + keyword + '" 남기면 상품 링크를 DM으로 보내드려요.';
}

function isPermissionApproved(permissionValue) {
  const v = normalizeText(permissionValue);
  return RF_CONFIG.PERMISSION_APPROVED_VALUES.indexOf(v) !== -1;
}

/** Normalised keyword entries: strings (product unknown) or { keyword, productId }. */
function keywordOwners_(existingKeywords) {
  const owners = {};
  existingKeywords.forEach(function (k) {
    const kw = normalizeText(typeof k === 'string' ? k : k.keyword).toUpperCase();
    if (!kw) return;
    (owners[kw] = owners[kw] || []).push(typeof k === 'string' ? '' : normalizeText(k.productId));
  });
  return owners;
}

function isInternalKeyword_(k) {
  return /^PRD\d+R\d+$/i.test(normalizeText(k));
}

function friendlyKeywordFor_(productId, existingKeywords, owners, suggested) {
  const mine = (existingKeywords || []).filter(function (k) {
    return k.productId === productId && !isInternalKeyword_(k.keyword);
  })[0];
  if (mine) return normalizeText(mine.keyword);
  const s = normalizeText(suggested);
  if (!s || commentKeywordError(s)) return '';
  const others = (owners[s.toUpperCase()] || []).filter(function (pid) {
    return pid !== productId;
  });
  return others.length ? '' : s;
}

/**
 * Builds REELS row objects keyed by REELS header names.
 * Keyword: PRODUCTS.'ManyChat 키워드' if the operator set one (shared by that product's reels),
 * otherwise a per-reel code (PRD001R01). Throws if an ID or keyword would collide with another product.
 */
function buildReelRecords(product, reels, existingIds, existingKeywords, meta) {
  const ids = nextReelIds(product.id, existingIds, reels.length);
  const owners = keywordOwners_(existingKeywords);
  // Customer-facing keyword (e.g. 우산): PRODUCTS column, else one this product already uses, else
  // Gemini's suggestion if no other product owns it. Internal codes (PRD001R01) only as a last resort.
  const productKeyword = normalizeText(product.keyword) || friendlyKeywordFor_(product.id, existingKeywords, owners, meta && meta.commentKeyword);
  const approved = isPermissionApproved(product.permission);

  return reels.map(function (reel, i) {
    const reelId = ids[i];
    const keyword = productKeyword || buildManyChatKeyword(reelId);
    const key = keyword.toUpperCase();
    const others = (owners[key] || []).filter(function (pid) {
      return !productKeyword || pid !== product.id;
    });
    if (others.length) {
      throw new Error('ManyChat 키워드 "' + keyword + '"가 이미 다른 릴스·상품에서 쓰이고 있습니다. 상품마다 다른 키워드를 쓰세요.');
    }
    (owners[key] = owners[key] || []).push(product.id);

    const notes = [];
    if (!approved) notes.push(RF_CONFIG.PERMISSION_UNVERIFIED_NOTE);
    if (!productKeyword) notes.push('댓글 키워드가 내부 코드입니다 — PRODUCTS "ManyChat 키워드"에 쉬운 단어(예: 우산)를 넣으세요.');
    notes.push('게시·DM 자동화 전 사람 검토 필요.');

    const record = {
      '릴스ID': reelId,
      '상품ID': product.id,
      '버전': i + 1,
      'Flow 생성': RF_CONFIG.FLOW_STATUS_MANUAL,
      'CTA': buildCta(keyword),
      'ManyChat 키워드': keyword,
      '광고 표기': RF_CONFIG.AFFILIATE_DISCLOSURE,
      '영상 사용 허가 상태': normalizeText(product.permission) || '미확인',
      '상태': RF_STATUS.SCRIPT_REVIEW_PENDING,
      '제작 상태': RF_STATUS_LABELS.SCRIPT_REVIEW_PENDING,
      '대본 버전': 1,
      '영상 버전': 0,
      '검토 메모': notes.join(' '),
      '생성 모델': meta.model,
      '생성일시': meta.generatedAt,
    };
    const cells = reelToScriptCells(reel);
    Object.keys(cells).forEach(function (k) {
      record[k] = cells[k];
    });
    // Optional columns (written only where 시트 준비 has added them).
    record['콘텐츠 기둥'] = pillarLabel(reel.pillar);
    // Five hook candidates + recommendation; the operator's choice is stored on selection.
    record['훅 후보(JSON)'] = meta && meta.hookSet ? JSON.stringify(meta.hookSet) : '';
    record['선택한 훅'] = '';
    const flags = formatVerificationFlags(verificationFlags(reel, reel.pillar));
    const asked = (Array.isArray(reel.needs_verification) ? reel.needs_verification : []).map(function (x) {
      return '[Gemini 요청] ' + normalizeText(x);
    }).filter(function (x) {
      return x.length > 13;
    });
    record['확인 필요'] = [flags].concat(asked).filter(Boolean).join('\n');
    if (record['확인 필요']) notes.push('확인 필요 항목이 있습니다 — 승인 전에 확인하세요.');
    record['검토 메모'] = notes.join(' ');
    return record;
  });
}

/**
 * Full pure pipeline: raw Gemini text → validated → REELS row objects.
 * Returns { errors: string[], records: object[] }.
 */
function prepareReelRecords(product, rawText, existingIds, existingKeywords, meta, options) {
  const parsed = parseModelJson(rawText);
  if (parsed.error) return { errors: [parsed.error], records: [], attempt: null };
  const result = validateGeminiReels(parsed.value, product, null, options);
  meta = Object.assign({}, meta, { hookSet: result.hookSet, commentKeyword: result.commentKeyword });
  // Kept so a later attempt can be combined with this one's valid reels (no extra paid call).
  const attempt = { reels: parsed.value && parsed.value.reels, reelErrors: result.reelErrors };
  // validation and payload let the caller rewrite only the hooks that need it (hookRevisionPlan).
  if (result.errors.length) return { errors: result.errors, records: [], attempt: attempt, validation: result, payload: parsed.value };
  return {
    errors: [],
    records: buildReelRecords(product, result.reels, existingIds, existingKeywords, meta),
    attempt: attempt,
    validation: result,
    payload: parsed.value,
  };
}

// ===== Prompt.gs =====
/**
 * Gemini prompt and structured-output schema.
 *
 * New product: five hooks (H1–H5) + a recommended hook with a reason + one script that starts with it
 * + a customer-facing comment keyword. The operator then picks the final hook in the dashboard; a
 * script can be rewritten around the chosen hook (buildHookScriptPrompt) for one more call.
 */

const RF_SCENE_SCHEMA_ = {
  type: 'OBJECT',
  properties: {
    scene_no: { type: 'INTEGER' },
    beat: { type: 'STRING', enum: ['HOOK', 'EMPATHY', 'SOLUTION', 'DEMO', 'BENEFIT', 'CTA'] },
    narration: { type: 'STRING' },
    duration_sec: { type: 'NUMBER' },
    visual: { type: 'STRING' },
    // Subtitle emphasis (which word, colour/effect) and sound effect — editing notes.
    emphasis: { type: 'STRING' },
    sfx: { type: 'STRING' },
    on_screen_text: { type: 'STRING' },
    flow_prompt: { type: 'STRING' },
    // IDs (F1, F2 …) of the verified facts this scene says or shows.
    fact_ids: { type: 'ARRAY', items: { type: 'STRING' } },
    // true when the scene shows an AI interior visualization (labelled "AI 시뮬레이션").
    ai_visualization: { type: 'BOOLEAN' },
  },
  required: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'emphasis', 'sfx', 'on_screen_text', 'flow_prompt', 'fact_ids'],
  propertyOrdering: ['scene_no', 'beat', 'narration', 'duration_sec', 'visual', 'emphasis', 'sfx', 'on_screen_text', 'flow_prompt', 'fact_ids'],
};

// Gemini `responseSchema` (OpenAPI subset). Validation.gs re-checks everything regardless.
const RF_GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    hooks: {
      type: 'ARRAY',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', enum: ['H1', 'H2', 'H3', 'H4', 'H5'] },
          type: { type: 'STRING', enum: ['QUESTION', 'NUMBER', 'MYTH', 'SITUATION', 'CONCLUSION'] },
          text: { type: 'STRING' },
          // The opening scene (scene 1) for this hook: what the first 2–3 s show and how.
          visual: { type: 'STRING' },
          flow_prompt: { type: 'STRING' },
          emphasis: { type: 'STRING' },
          sfx: { type: 'STRING' },
        },
        required: ['id', 'type', 'text', 'visual', 'flow_prompt', 'emphasis', 'sfx'],
        propertyOrdering: ['id', 'type', 'text', 'visual', 'flow_prompt', 'emphasis', 'sfx'],
      },
    },
    recommended_hook: {
      type: 'OBJECT',
      properties: { id: { type: 'STRING', enum: ['H1', 'H2', 'H3', 'H4', 'H5'] }, reason: { type: 'STRING' } },
      required: ['id', 'reason'],
    },
    // Simple customer-facing comment keyword for ManyChat (e.g. 우산), never an internal ID.
    comment_keyword: { type: 'STRING' },
    reels: {
      type: 'ARRAY',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'OBJECT',
        properties: {
          // Creative angle (only used when several scripts are generated at once).
          angle: { type: 'STRING', enum: ['EVERYDAY_FRUSTRATION', 'SMALL_SPACE', 'LIFESTYLE_SITUATION'] },
          // Content pillar (RF_CONFIG.BRAND.PILLARS).
          pillar: { type: 'STRING', enum: ['AI_MAKEOVER', 'PRODUCT_DISCOVERY', 'INTL_COUPLE', 'COMPARE'] },
          concept: { type: 'STRING' },
          hook: { type: 'STRING' },
          narration: { type: 'STRING' },
          captions: { type: 'ARRAY', items: { type: 'STRING' } },
          scenes: { type: 'ARRAY', items: RF_SCENE_SCHEMA_ },
          // IDs (F1, F2 …) of every verified fact the reel relies on.
          facts_used: { type: 'ARRAY', items: { type: 'STRING' } },
          // Anything the operator must confirm is real before approval (empty if none).
          needs_verification: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['pillar', 'concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used'],
        propertyOrdering: ['angle', 'pillar', 'concept', 'hook', 'narration', 'captions', 'scenes', 'facts_used', 'needs_verification'],
      },
    },
  },
  required: ['hooks', 'recommended_hook', 'comment_keyword', 'reels'],
  propertyOrdering: ['hooks', 'recommended_hook', 'comment_keyword', 'reels'],
};

/**
 * Response schema for `count` scripts. withHooks false (rewriting one existing script): no new hooks,
 * no keyword — only the script. withHooks 'only' (hooks for an existing script): hooks + recommendation.
 */
function geminiResponseSchema(count, withHooks) {
  const schema = JSON.parse(JSON.stringify(RF_GEMINI_RESPONSE_SCHEMA));
  if (withHooks === 'only') {
    delete schema.properties.reels;
    delete schema.properties.comment_keyword;
    schema.required = ['hooks', 'recommended_hook'];
    schema.propertyOrdering = ['hooks', 'recommended_hook'];
    return schema;
  }
  schema.properties.reels.minItems = count;
  schema.properties.reels.maxItems = count;
  if (withHooks === false) {
    delete schema.properties.hooks;
    delete schema.properties.recommended_hook;
    delete schema.properties.comment_keyword;
    schema.required = ['reels'];
    schema.propertyOrdering = ['reels'];
  }
  return schema;
}

/**
 * Prompt to rewrite ONE script after the reviewer requested changes. Same rules as a new script; the
 * reel keeps its hook unless the note asks otherwise. Costs one Gemini call.
 */
function buildRegenerationPrompt(product, currentReel, reviewerNote, previousErrors, previousResponse) {
  return buildGeminiPrompt(product, previousErrors, previousResponse, [], {
    mode: 'revise',
    currentReel: currentReel,
    note: reviewerNote,
  });
}

/**
 * Prompt to rewrite ONE script so it starts with the hook the operator selected (possibly edited).
 * The hook text is fixed: Gemini must use it word for word. Costs one Gemini call.
 */
function buildHookScriptPrompt(product, currentReel, selectedHook, previousErrors, previousResponse) {
  return buildGeminiPrompt(product, previousErrors, previousResponse, [], {
    mode: 'hook',
    currentReel: currentReel,
    selectedHook: selectedHook,
  });
}

/**
 * Prompt for five hooks (with their opening scenes) for a script that already exists — e.g. one
 * written before the five-hook workflow. The script itself is not changed. Costs one Gemini call.
 */
function buildHooksForScriptPrompt(product, currentReel, avoidHooks, previousErrors, previousResponse) {
  return buildGeminiPrompt(product, previousErrors, previousResponse, avoidHooks, { mode: 'hooks', currentReel: currentReel });
}

/**
 * Builds the Gemini prompt for one product.
 * `previousErrors` (optional) feeds validation failures back for a corrective retry, together with
 * the previous response (`previousResponse`, optional) so Gemini edits only what failed.
 * `avoidHooks`: this product's earlier hooks. `opts.mode`: 'new' (default), 'revise' or 'hook'.
 */
function buildGeminiPrompt(product, previousErrors, previousResponse, avoidHooks, opts) {
  opts = opts || {};
  const mode = opts.mode || 'new';
  const L = RF_CONFIG.LIMITS;
  const B = RF_CONFIG.BRAND;
  const H = RF_CONFIG.HOOK_TYPES;
  const count = mode === 'new' ? RF_CONFIG.REELS_PER_PRODUCT : 1;
  const facts = parseConfirmedFeatures(product.features);
  const task = {
    new: '아래 상품에 대해 ① 서로 다른 훅 5개(H1~H5)를 만들고, ② 그중 가장 좋은 훅 하나를 recommended_hook으로 고르고 이유를 쓰고, ③ 그 훅으로 시작하는 릴스 대본 ' + count + '개를 작성하세요. 최종 훅은 운영자가 고릅니다.',
    revise: '아래 "현재 대본"을 검토자 요청에 맞게 고쳐 릴스 대본을 정확히 1개 작성하세요. 훅은 바꾸라는 요청이 없으면 그대로 두세요.',
    hook: '운영자가 고른 훅으로 시작하는 릴스 대본을 정확히 1개 다시 작성하세요. 훅 문장은 한 글자도 바꾸지 마세요.',
    hooks: '아래 "현재 대본"에 쓸 서로 다른 훅 5개(H1~H5)와 각 훅의 첫 장면을 만들고, 가장 좋은 훅 하나를 recommended_hook으로 고르고 이유를 쓰세요. 대본은 출력하지 마세요. 최종 훅은 운영자가 고릅니다.',
  }[mode];
  const lines = [
    '당신은 인스타그램 계정 "' + B.NAME + '"의 릴스(9:16 세로 숏폼) 대본 작가입니다.',
    '- 계정 소개: ' + B.POSITIONING,
    '- 슬로건: "' + B.TAGLINE + '"',
    '- 말투: ' + B.PERSONALITY,
    '- 차별점: ' + B.DIFFERENTIATORS.join(' / '),
    '- ' + B.CURRENT_FOCUS,
    '광고 문구가 아니라 실제 한국 라이프스타일 크리에이터가 친구에게 말하듯 쓰세요. 유치원생도 알아들을 쉬운 생활 언어로, 전문 용어 없이.',
    task,
    '',
    '## 상품',
    '- 상품ID: ' + product.id,
    '- 상품명: ' + normalizeText(product.name),
    '- 카테고리: ' + (normalizeText(product.category) || '(미입력)'),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이 목록만 사실로 사용, ID로 참조)',
  ];
  facts.forEach(function (f, i) {
    lines.push('- ' + factId(i) + ': ' + f);
  });
  lines.push(
    '',
    '## 규칙',
    '1. 제품에 대한 사실은 위 확인된 기능(' + factId(0) + '~' + factId(facts.length - 1) + ')만 사용하세요. 목록에 없는 기능, 소재, 내구성·강도, 호환 표면(냉장고·벽·타일 등), 설치 방식(무타공·공구 등), 수납 개수, 가격, 할인, 순위, 후기, 인증, 색상, 수치는 절대 만들지 마세요.',
    '2. 확인된 기능을 자연스러운 한국어 구어체로 바꿔 말하세요. 기술 설명 문구를 그대로 읽지 마세요. 예: "자석 부착형 거치 방식" → "자석으로 붙여서 쓰는 우산꽂이", "철제 도어 부착" → "철제 현관문에 붙일 수 있어요". 뜻을 넓히거나 보태지는 마세요.',
    '3. 숫자·치수·단위는 확인된 기능에 적힌 그대로만 쓰세요. 상단/하단 치수를 바꾸거나 반올림·환산하지 마세요. 가격·할인·퍼센트·통계는 쓰지 마세요.',
    '4. 각 장면의 fact_ids에는 그 장면이 말하거나 보여 주는 확인된 기능 ID를 넣으세요 (예: ["' + factId(0) + '"]). DEMO·BENEFIT 장면은 최소 1개, SOLUTION은 기능을 말하면 넣고, HOOK·EMPATHY·CTA는 보통 []. facts_used에는 릴스 전체에서 사용한 ID를 넣으세요. 기능 문장을 직접 쓰지 말고 ID만 쓰세요.',
    '5. 과장 표현(최저가, 100%, 무조건, 완벽, 평생, 절대, 1위, 최고, 튼튼, 강력 등)과 후기·인기 표현(후기, 리뷰, 다들 사요, 품절 등)을 쓰지 마세요.',
    '6. URL, 가격, 광고 표기는 대본에 쓰지 마세요 (광고 표기는 캡션에 자동으로 들어갑니다). 댓글 키워드는 CTA 장면에서 자리표시자 ' + RF_CONFIG.KEYWORD_PLACEHOLDER + ' 로만 쓰세요.',
    '7. narration은 ' + L.NARRATION_MAX_CHARS + '자 이내의 자연스러운 한국어 구어체. captions는 화면 자막 줄 목록이며 각 ' + L.CAPTION_MAX_CHARS + '자 이내.',
    '8. scenes는 ' + L.MIN_SCENES + '~' + L.MAX_SCENES + '개, scene_no는 1부터 순서대로, duration_sec 합계는 ' + L.GENERATED_MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초. 내용에 맞게 정하고 억지로 늘리지 마세요 (짧으면 20~25초도 좋습니다).',
    '9. 훅과 대본은 서로 다른 첫마디·표현을 써서 반복을 피하세요.',
    '10. 시연은 실제로 가능한 사용 장면만 묘사하세요. 확인된 기능 밖의 성능을 보여 주는 AI 시연 장면은 만들지 마세요.',
    '11. 경험담·구매·테스트·남편 반응·전후 결과를 지어내지 마세요 ("한 달 써 보니", "샀는데", "테스트해 보니", "남편이 좋아했어요", "바꿨더니 ~됐어요" 금지). 상황은 시청자 입장에서 "~잖아요", "~죠", "~할 때"처럼 말하세요.',
    '12. 실제 경험이나 제품 테스트가 꼭 필요한 내용이면 지어내지 말고 needs_verification에 무엇을 확인해야 하는지 적으세요 (운영자가 승인 전에 확인합니다). 없으면 [].',
    '13. AI 인테리어 시뮬레이션 장면은 ai_visualization=true로 표시하세요 (영상에 "' + B.AI_LABEL + '"이 표시됩니다). 실제 제품 장면과 섞어 진짜처럼 보이게 하지 마세요.',
    '',
    '## 콘텐츠 기둥 (릴스마다 pillar 하나 — 목표 비율은 계정 전체 기준이며, 상품에 맞는 것을 고르세요)',
    Object.keys(B.PILLARS).map(function (id) {
      const pl = B.PILLARS[id];
      return '- ' + id + ' (' + pl.label + ', 목표 ' + pl.target + '%): ' + pl.hint;
    }).join('\n'),
    ''
  );
  if (mode === 'new' || mode === 'hooks') {
    lines.push(
      '## 훅 5개 (hooks — 첫 장면, 첫 0~3초)',
      '- 정확히 5개, 유형별로 하나씩. 모두 ' + RF_CONFIG.HOOK_STYLE.MAX_CHARS + '자 이내, 첫 2초 안에 "어, 나도 그래" 싶은 문제·상황 중심. 기능 나열 금지.'
    );
    Object.keys(H).forEach(function (id) {
      lines.push('- ' + id + ' ' + H[id].type + ' (' + H[id].label + '): ' + H[id].rule);
    });
    lines.push(
      '- 예시 (PRD-001 우산꽂이, 형식 참고용 — 다른 상품에 그대로 쓰지 말 것):',
      '  H1 "급하게 출근할 때마다 우산 깜빡하는 사람?" / H2 "두 조각만 문에 붙이면 바닥이 비어요" (2피스 → 두 조각) / H3 "현관 우산 자리, 바닥이 아니에요" / H4 "비 오는 날, 현관에 젖은 우산이 굴러다녀요" / H5 "좁은 현관 우산 정리, 문에 붙이면 돼요"',
      '- 유형은 뜻으로 판단합니다. 위 예시 말투("~아니에요", "~하면 돼요")를 꼭 쓸 필요는 없습니다 — 예: H3 "좁은 현관 바닥엔 원래 우산 자리 없어요", H5 "정리 안 되는 우산은 그냥 문에 붙여요"도 좋습니다.',
      '- 다섯 훅은 첫마디가 서로 달라야 합니다. 제품 이름으로 시작하지 마세요.',
      '- 쓰지 말 것: "~니다" 광고 말투, "~다면?"·"~하시나요?" 같은 뻔한 질문, "~하세요" 권유, "하나로", "소개", "추천", "필수템", "꿀템", "~이 달라집니다".',
      '- 나쁜 예: "현관이 좁아 우산 둘 곳이 없다면?", "우산꽂이 하나로 현관이 달라집니다.", "자석형 2피스 우산꽂이" (기능 나열로 시작하지 마세요).',
      '- 좋은 예: "급하게 출근할 때마다 우산 깜빡하는 사람?", "원룸 살면 우산꽂이 둘 자리도 애매하잖아요.", "비 오는 날마다 현관이 지저분해지는 이유."',
      '- 각 훅마다 그 훅으로 시작할 때의 첫 장면을 함께 쓰세요: visual(첫 프레임부터 보여 줄 장면 연출), flow_prompt(그 장면의 영어 Google Flow 프롬프트), emphasis(자막 강조), sfx(효과음, 없으면 빈 문자열). 운영자가 훅을 고르면 첫 장면이 이것으로 바뀝니다.',
      '- 두 번째 장면(EMPATHY)부터는 다섯 훅 중 어떤 것으로 시작해도 자연스럽게 이어지도록 쓰세요.',
      '- recommended_hook: 문제를 먼저 보여 주는(problem-first) 가장 강한 훅 — 첫 프레임에서 문제가 가장 잘 보이고 제품 해결책과 자연스럽게 이어지는 훅의 id와 짧은 이유.' + (mode === 'new' ? ' 대본의 hook과 첫 장면(narration·visual·flow_prompt)은 이 훅과 똑같아야 합니다.' : ''),
      ''
    );
    if (mode === 'new') {
      lines.push(
        '## 댓글 키워드 (comment_keyword)',
        '- 시청자가 댓글에 쉽게 쓸 수 있는 한 단어 (예: 우산). 공백·숫자·기호 없이 10자 이내. 상품ID 같은 내부 코드는 쓰지 마세요.',
        ''
      );
    }
  } else if (mode === 'hook') {
    lines.push(
      '## 운영자가 고른 훅 (그대로 사용)',
      '- "' + normalizeText(opts.selectedHook) + '"',
      '- 대본의 hook과 첫 장면 narration은 위 문장과 한 글자도 다르지 않아야 합니다. 나머지 장면은 이 훅에 자연스럽게 이어지도록 다시 쓰세요.',
      ''
    );
  }
  if (count > 1) {
    lines.push(
      '## 세 가지 각도 (릴스마다 하나씩, angle 필드에 표시)',
      '- EVERYDAY_FRUSTRATION (A 일상 불편), SMALL_SPACE (B 좁은 공간), LIFESTYLE_SITUATION (C 생활 상황) — 서로 다른 컨셉·hook.',
      ''
    );
  }
  lines.push(
    '## 스토리보드 (영상이 이야기를 이끌고, 자막은 보조)',
    '- 이야기 흐름: PROBLEM → EMPATHY → SOLUTION → DEMONSTRATION → CTA.',
    '- 장면 beat: HOOK(= PROBLEM, 훅 문장, 2~3초) → EMPATHY(왜 짜증 나는지) → SOLUTION(제품을 자연스럽게 등장) → DEMO(= DEMONSTRATION, 확인된 기능 시연, 1~2장면) → CTA(저장·댓글 유도, 마지막 2~3초). 필요하면 DEMO 뒤에 BENEFIT 1개를 더할 수 있습니다.',
    '- SOLUTION은 "그래서 ~"처럼 자연스럽게 이어 주세요. 제품을 광고처럼 소개하지 마세요.',
    '- 각 장면의 narration은 그 장면에서 말하는 한 문장이며 그대로 자막이 됩니다: ' + L.SCENE_NARRATION_MAX_CHARS + '자 이내, 짧고 자연스러운 구어체.',
    '- 장면 길이 ' + L.SCENE_MIN_SEC + '~' + L.SCENE_MAX_SEC + '초. hook = 첫 장면 narration. narration(전체) = 장면 narration을 순서대로 이은 것, captions = 장면 narration 목록. 장면 길이는 한국어 음성 길이(초당 약 6~7자)에 맞추세요 — 렌더링 전에 실제 음성 길이로 다시 확인합니다.',
    '- 말투: 크리에이터가 직접 말하듯 짧은 구어체 구절. 기업 광고 말투(~합니다, ~드립니다)는 쓰지 마세요.',
    '- visual: 연출 지시 — 실제 생활 공간에서 무엇을 어떻게 보여 줄지 구체적으로 (첫 프레임, 클로즈업/POV/와이드, 손 동작). 자연광, 핸드헬드. 글자만 있는 화면·단색 배경·그래픽 금지.',
    '- emphasis: 자막 강조 (어떤 단어를 어떤 색·효과로). sfx: 효과음 (예: "착", "쏙"). 없으면 빈 문자열.',
    '- on_screen_text는 빈 문자열로 두세요 (자막은 narration으로 충분합니다. AI 시뮬레이션 장면은 자동 표시).',
    '- CTA 장면 narration 예: "저장해 두고, 댓글에 \'' + RF_CONFIG.KEYWORD_PLACEHOLDER + '\' 남겨 주세요" — 과장 없이 자연스럽게.',
    '',
    '## flow_prompt (Google Flow 수동 생성용, 영어)',
    '- 각 장면마다 Google Flow에 붙여넣을 영어 영상 프롬프트를 작성하세요 (운영자가 승인 후 직접 생성).',
    '- 9:16 vertical, photorealistic, Korean apartment interior, natural light, 장면 길이에 맞는 단일 샷.',
    '- 브랜드 로고, 상표, 읽을 수 있는 글자, 실존 인물의 얼굴을 넣지 마세요.',
    '- 확인된 기능과 다른 동작(예: 확인되지 않은 부착 방식)을 묘사하지 마세요.',
    '',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  if (opts.currentReel) {
    lines.push('', '## 현재 대본 (JSON)', JSON.stringify(opts.currentReel));
  }
  if (mode === 'revise') {
    lines.push('', '## 검토자 수정 요청', normalizeText(opts.note) || '(메모 없음 — 전반적으로 개선)', '', '응답의 reels 배열에는 수정된 대본 1개만 넣으세요.');
  }
  if (avoidHooks && avoidHooks.length) {
    lines.push('', '## 이 상품에 이미 쓴 hook (비슷하게 쓰지 마세요)');
    avoidHooks.slice(-15).forEach(function (h) {
      lines.push('- ' + normalizeText(h));
    });
  }
  if (previousErrors && previousErrors.length) {
    lines.push(
      '',
      '## 이전 응답의 검증 오류 (반드시 수정)',
      '아래 문제만 고치세요. 지적된 문장은 확인된 기능만으로 다시 쓰거나 삭제하고, 문제가 없는 훅·장면은 그대로 두세요.'
    );
    previousErrors.slice(0, 25).forEach(function (e) {
      lines.push('- ' + e);
    });
    if (previousResponse) {
      lines.push('', '## 이전 응답 (JSON — 위 오류만 고쳐서 다시 출력)', String(previousResponse).slice(0, 12000));
    }
  }
  return lines.join('\n');
}

/** Response schema for a targeted hook rewrite: exactly the hooks in `ids`, nothing else. */
function hookRevisionSchema(ids) {
  const item = JSON.parse(JSON.stringify(RF_GEMINI_RESPONSE_SCHEMA.properties.hooks.items));
  item.properties.id = { type: 'STRING', enum: ids.slice() };
  return {
    type: 'OBJECT',
    properties: { hooks: { type: 'ARRAY', minItems: ids.length, maxItems: ids.length, items: item } },
    required: ['hooks'],
    propertyOrdering: ['hooks'],
  };
}

/**
 * Prompt to rewrite only some of the five hooks (plan.ids, with their problems in plan.problems), keeping
 * the other hooks, the recommendation and the script as they are. One Gemini call, text only.
 * payload: { hooks: [...5], recommended_hook } — the current set, so the rewrites stay distinct.
 */
function buildHookRevisionPrompt(product, payload, plan, avoidHooks) {
  const B = RF_CONFIG.BRAND;
  const H = RF_CONFIG.HOOK_TYPES;
  const facts = parseConfirmedFeatures(product.features);
  const hooks = (payload && payload.hooks) || [];
  const lines = [
    '당신은 인스타그램 계정 "' + B.NAME + '"의 릴스 훅 작가입니다. 말투: ' + B.PERSONALITY,
    '아래 훅 5개 중 ' + plan.ids.join(', ') + '만 다시 쓰세요. 다른 훅·추천 훅·대본은 바꾸지 않습니다.',
    '광고 문구가 아니라 친구에게 말하듯, 유치원생도 알아들을 쉬운 생활 언어로 쓰세요.',
    '',
    '## 상품',
    '- 상품명: ' + normalizeText(product.name),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이 목록만 사실로 사용)',
  ];
  facts.forEach(function (f, i) {
    lines.push('- ' + factId(i) + ': ' + f);
  });
  lines.push(
    '',
    '## 규칙',
    '- 확인된 기능에 없는 기능·소재·호환·수치·가격·후기·통계를 만들지 마세요. 과장 표현(최고, 완벽, 무조건, 튼튼 등)과 "~이 달라집니다" 같은 결과 약속도 쓰지 마세요.',
    '- 각 훅은 ' + RF_CONFIG.HOOK_STYLE.MAX_CHARS + '자 이내, 시청자가 겪는 문제·상황이 첫 2초에 들리게. 제품 이름으로 시작하지 마세요. "~니다" 광고 말투, "~하시나요?" 같은 뻔한 질문, "~하세요" 권유, "추천·소개·필수템·꿀템"은 쓰지 마세요.',
    '- 유형의 뜻만 지키면 되고 정해진 말투는 없습니다.',
    '- 다른 훅과 첫마디가 겹치지 않게 쓰세요.',
    '- 각 훅마다 그 훅으로 시작할 때의 첫 장면도 쓰세요: visual(장면 연출), flow_prompt(영어 Google Flow 프롬프트, 9:16 vertical, photorealistic, Korean apartment, natural light, 로고·글자·실존 인물 얼굴 없이), emphasis(자막 강조), sfx(효과음, 없으면 빈 문자열).',
    '',
    '## 현재 훅 5개'
  );
  hooks.forEach(function (h) {
    if (h && H[h.id]) lines.push('- ' + h.id + ' (' + H[h.id].label + '): "' + normalizeText(h.text) + '"');
  });
  lines.push('', '## 다시 쓸 훅과 고칠 점');
  plan.ids.forEach(function (id) {
    lines.push('- ' + id + ' ' + H[id].type + ' (' + H[id].label + '): ' + H[id].rule);
    (plan.problems[id] || []).forEach(function (p) {
      lines.push('  · ' + p);
    });
  });
  if (avoidHooks && avoidHooks.length) {
    lines.push('', '## 이 상품에 이미 쓴 훅 (비슷하게 쓰지 마세요)');
    avoidHooks.slice(-15).forEach(function (h) {
      lines.push('- ' + normalizeText(h));
    });
  }
  lines.push('', 'JSON 스키마에 맞춰 hooks 배열에 ' + plan.ids.join(', ') + '만 넣어 JSON만 출력하세요.');
  return lines.join('\n');
}

// ===== Gemini.gs =====
/**
 * Gemini API client (generateContent with JSON structured output).
 * API key is read from Script Properties: GEMINI_API_KEY. Optional: GEMINI_MODEL.
 *
 * Model choice: GEMINI_MODEL (if set) or RF_CONFIG.DEFAULT_GEMINI_MODEL. If Google answers 404
 * ("model not found" — nothing was generated, nothing billed), the call falls back to
 * RF_CONFIG.GEMINI_FALLBACK_MODELS in order. Any other error is never retried on another model.
 */

// Model that actually answered the last call (recorded in REELS.생성 모델 and AUDIT).
const RF_GEMINI_STATE = { lastModel: '' };

function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. 메뉴 "릴스 팩토리 → Gemini API 키 설정" 또는 ' +
        'Apps Script → 프로젝트 설정 → 스크립트 속성에서 설정하세요.'
    );
  }
  return key;
}

function getGeminiModel() {
  return (
    PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') ||
    RF_CONFIG.DEFAULT_GEMINI_MODEL
  );
}

function getGeminiImageModel() {
  return (
    PropertiesService.getScriptProperties().getProperty('GEMINI_IMAGE_MODEL') ||
    RF_CONFIG.DEFAULT_IMAGE_MODEL
  );
}

/** Configured model first, then the fallbacks (no duplicates). */
function geminiModelChain_() {
  const chain = [getGeminiModel()];
  RF_CONFIG.GEMINI_FALLBACK_MODELS.forEach(function (m) {
    if (chain.indexOf(m) === -1) chain.push(m);
  });
  return chain;
}

function geminiImageModelChain_() {
  const chain = [getGeminiImageModel()];
  (RF_CONFIG.GEMINI_IMAGE_FALLBACK_MODELS || []).forEach(function (m) {
    if (chain.indexOf(m) === -1) chain.push(m);
  });
  return chain;
}

/** One model, with retries for 429/5xx and network errors. Returns { code, text }. */
function requestGemini_(model, body) {
  const url = RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model) + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': getGeminiApiKey_() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  let response;
  let code;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.info('[Gemini Request] Attempt ' + attempt + ' calling model ' + model);
      response = UrlFetchApp.fetch(url, options);
      code = response.getResponseCode();
      console.info('[Gemini Request] Attempt ' + attempt + ' responded HTTP ' + code);
    } catch (e) {
      console.error('[Gemini Request Error] Attempt ' + attempt + ' failed: ' + e.message);
      // Network errors and UrlFetchApp timeouts throw even with muteHttpExceptions.
      if (attempt === 3) {
        throw new Error(
          'Gemini API에 연결하지 못했습니다 (' + e.message + '). 인터넷/Google 서비스 상태를 확인하고 다시 시도하세요. ' +
            '시간 초과가 반복되면 스크립트 속성 GEMINI_MODEL을 더 빠른 모델(예: Flash-Lite 계열)로 바꿔 보세요.'
        );
      }
      Utilities.sleep(2000 * attempt);
      continue;
    }
    if (code !== 429 && code < 500) break;
    if (attempt < 3) Utilities.sleep(2000 * attempt);
  }
  return { code: code, text: response.getContentText() };
}

/**
 * Calls Gemini once and returns the raw JSON text from the first candidate.
 * Throws an actionable Error on HTTP / safety / truncation problems.
 */
function callGemini_(promptText, responseSchema, extraParts) {
  const body = {
    // extraParts: optional inline images ({ inlineData: { mimeType, data } }) after the text.
    contents: [{ role: 'user', parts: [{ text: promptText }].concat(extraParts || []) }],
    // Temperature left at the model default: Gemini 3.x models are tuned for 1.0.
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema || RF_GEMINI_RESPONSE_SCHEMA,
    },
  };
  const chain = geminiModelChain_();
  let model;
  let res;
  for (let i = 0; i < chain.length; i++) {
    model = chain[i];
    res = requestGemini_(model, body);
    if (res.code !== 404 || i === chain.length - 1) break;
    logEvent_('WARN', 'geminiModel', '', '모델 "' + model + '"을 찾을 수 없어 "' + chain[i + 1] + '"로 대체합니다 (404, 과금 없음).', String(res.text).slice(0, 500));
  }
  const code = res.code;
  const text = res.text;
  if (code !== 200) {
    let detail = text;
    try {
      detail = JSON.parse(text).error.message;
    } catch (e) {
      // keep raw text
    }
    let hint = '';
    if (code === 400) hint = ' (요청 형식 또는 모델명 GEMINI_MODEL을 확인하세요)';
    if (code === 401 || code === 403) hint = ' (GEMINI_API_KEY가 유효한지 확인하세요)';
    if (code === 404) {
      hint = ' (모델 ' + chain.join(', ') + ' 모두 사용할 수 없습니다. "릴스 팩토리 → Gemini 모델 확인"으로 확인한 뒤 ' +
        '스크립트 속성 GEMINI_MODEL에 현재 Flash 모델 ID를 입력하세요)';
    }
    if (code === 429) hint = ' (요청 한도 초과 — 잠시 후 다시 시도하세요)';
    throw new Error('Gemini API 오류 HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
  }
  RF_GEMINI_STATE.lastModel = model;

  const json = JSON.parse(text);
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    throw new Error('Gemini가 요청을 차단했습니다: ' + json.promptFeedback.blockReason);
  }
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('Gemini 응답에 candidates가 없습니다: ' + text.slice(0, 500));
  }
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error('Gemini 응답이 완료되지 않았습니다 (finishReason=' + candidate.finishReason + ').');
  }
  return candidate.content.parts
    .map(function (p) {
      return p.text || '';
    })
    .join('');
}

/**
 * Calls gemini-2.5-flash-image with reference product image bytes and 9:16 aspect ratio.
 * Returns { model, mimeType, data (base64), text }.
 */
function callGeminiImage_(promptText, referenceImages, options) {
  options = options || {};
  const imageParts = (referenceImages || []).map(function (r) {
    return {
      inlineData: {
        mimeType: r.mimeType || 'image/jpeg',
        data: r.data,
      },
    };
  });
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: promptText }].concat(imageParts),
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: options.aspectRatio || (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.ASPECT_RATIO) || '9:16',
      },
    },
  };
  const chain = geminiImageModelChain_();
  let model;
  let res;
  for (let i = 0; i < chain.length; i++) {
    model = chain[i];
    res = requestGemini_(model, body);
    if (res.code !== 404 || i === chain.length - 1) break;
    logEvent_('WARN', 'geminiImageModel', '', '이미지 모델 "' + model + '"을 찾을 수 없어 "' + chain[i + 1] + '"로 대체합니다 (404).', String(res.text).slice(0, 500));
  }
  const code = res.code;
  const text = res.text;
  if (code !== 200) {
    let detail = text;
    try {
      detail = JSON.parse(text).error.message;
    } catch (e) {}
    let hint = '';
    if (code === 400) hint = ' (요청 형식 또는 모델명 GEMINI_IMAGE_MODEL을 확인하세요)';
    if (code === 401 || code === 403) hint = ' (GEMINI_API_KEY가 유효한지 확인하세요)';
    if (code === 404) hint = ' (모델 ' + chain.join(', ') + ' 모두 사용할 수 없습니다)';
    if (code === 429) hint = ' (요청 한도 초과 — 잠시 후 다시 시도하세요)';
    console.error('[Gemini Image Error] HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
    throw new Error('Gemini 이미지 생성 오류 HTTP ' + code + hint + ': ' + String(detail).slice(0, 500));
  }
  RF_GEMINI_STATE.lastModel = model;

  const json = JSON.parse(text);
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    console.error('[Gemini Image Error] Blocked by safety filter: ' + json.promptFeedback.blockReason);
    throw new Error('Gemini가 요청을 차단했습니다: ' + json.promptFeedback.blockReason);
  }
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    console.error('[Gemini Image Error] No candidates in response: ' + text.slice(0, 500));
    throw new Error('Gemini 응답에 candidates가 없습니다: ' + text.slice(0, 500));
  }
  let imagePart = null;
  let textPart = '';
  candidate.content.parts.forEach(function (p) {
    const d = p.inlineData || p.inline_data;
    if (d && d.data) {
      imagePart = d;
    } else if (p.text) {
      textPart += p.text;
    }
  });
  if (!imagePart) {
    console.error('[Gemini Image Error] No image data in response parts: ' + textPart.slice(0, 500));
    throw new Error('Gemini 이미지 응답에 이미지가 포함되지 않았습니다: ' + textPart.slice(0, 500));
  }
  console.info('[Gemini Image] Successfully received image data from ' + model + ' (' + (imagePart.mimeType || 'image/png') + ')');
  return {
    model: model,
    mimeType: imagePart.mimeType || 'image/png',
    data: imagePart.data,
    text: textPart,
  };
}

/**
 * Free check (models.get — no tokens, no charge): is each model in the chain available for
 * generateContent? Returns [{ model, ok, detail }].
 */
function checkGeminiModels_() {
  const key = getGeminiApiKey_();
  return geminiModelChain_().map(function (model) {
    const res = UrlFetchApp.fetch(RF_CONFIG.GEMINI_API_BASE + encodeURIComponent(model), {
      method: 'get',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) return { model: model, ok: false, detail: 'HTTP ' + code };
    const info = JSON.parse(res.getContentText());
    const methods = info.supportedGenerationMethods || [];
    const ok = methods.indexOf('generateContent') !== -1;
    return { model: model, ok: ok, detail: (info.displayName || info.name) + (ok ? '' : ' — generateContent 미지원') };
  });
}

/** Menu: shows which Gemini model will be used (free). */
function showGeminiModelCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    const rows = checkGeminiModels_();
    const use = rows.filter(function (r) {
      return r.ok;
    })[0];
    ui.alert(
      'Gemini 모델 확인 (무료 — 토큰 사용 없음)\n\n' +
        rows.map(function (r) {
          return (r.ok ? '✓ ' : '✗ ') + r.model + ' — ' + r.detail;
        }).join('\n') +
        '\n\n' + (use ? '사용할 모델: ' + use.model : '사용 가능한 모델이 없습니다. GEMINI_MODEL을 현재 Flash 모델 ID로 설정하세요.') +
        '\n실제 JSON 생성까지 확인하려면 "테스트: PRD-001 Gemini 실제 호출"을 실행하세요 (1회 과금).'
    );
  } catch (e) {
    ui.alert('Gemini 모델 확인 실패\n\n' + e.message);
  }
}

// ===== Sheets.gs =====
/**
 * Google Sheets I/O. Columns are always located by header name so existing
 * columns (and any extra columns the operator adds) are preserved.
 */

/** Header comparison key: ignores spaces, line breaks and letter case ("상품 ID" == "상품ID"). */
function headerKey_(name) {
  return normalizeText(name).replace(/\s+/g, '').toLowerCase();
}

/** Returns { headerKey: 1-based column index } for row 1. Use colOf_() to look up by header name. */
function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const map = {};
  if (lastCol === 0) return map;
  sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .forEach(function (h, i) {
      const key = headerKey_(h);
      if (key && !map[key]) map[key] = i + 1;
    });
  return map;
}

/** 1-based column index of a header name, or 0 if absent. */
function colOf_(map, headerName) {
  return map[headerKey_(headerName)] || 0;
}

function missingHeaders_(sheet, required) {
  const map = getHeaderMap_(sheet);
  return required.filter(function (h) {
    return !colOf_(map, h);
  });
}

function requireHeaders_(sheet, required) {
  const missing = missingHeaders_(sheet, required);
  if (missing.length) {
    let hint = '헤더를 직접 추가하거나 이름을 확인하세요.';
    if (sheet.getName() !== RF_CONFIG.SHEETS.PRODUCTS) {
      hint = '메뉴 "릴스 팩토리 → 시트 준비"를 실행하면 기존 데이터를 건드리지 않고 1행 오른쪽 빈 칸에 누락된 헤더를 추가할 수 있습니다.';
    }
    throw new Error(
      '"' + sheet.getName() + '" 시트 1행에 필요한 헤더가 없습니다: ' + missing.join(', ') +
        '. 기존 데이터는 자동으로 수정하지 않습니다 — ' + hint
    );
  }
  return getHeaderMap_(sheet);
}

/** Finds a sheet by name, tolerating surrounding spaces and letter case ("Products ", "products"). */
function findSheet_(ss, name) {
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const want = normalizeText(name).toLowerCase();
  const matches = ss.getSheets().filter(function (sh) {
    return normalizeText(sh.getName()).toLowerCase() === want;
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Appends missing headers to the first empty cells at the right end of row 1.
 * Existing headers and data are never moved or overwritten. Returns the headers added.
 */
function appendMissingHeaders_(sheet, headers) {
  const missing = missingHeaders_(sheet, headers);
  if (!missing.length) return [];
  const start = sheet.getLastColumn() + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  return missing;
}

/**
 * Creates the sheet with headers if it does not exist (or is completely empty).
 * Never modifies an existing header row; only verifies it.
 */
function ensureSheet_(ss, name, headers, optionalHeaders) {
  let sheet = findSheet_(ss, name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    const all = headers.concat(optionalHeaders || []);
    sheet.getRange(1, 1, 1, all.length).setValues([all]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  requireHeaders_(sheet, headers);
  return sheet;
}

function getProductsSheet_(ss) {
  const sheet = findSheet_(ss, RF_CONFIG.SHEETS.PRODUCTS);
  if (!sheet) {
    throw new Error(
      '"' + RF_CONFIG.SHEETS.PRODUCTS + '" 시트를 찾을 수 없습니다. 상품 시트 탭 이름을 PRODUCTS로 바꾸거나 ' +
        'Config의 RF_CONFIG.SHEETS.PRODUCTS를 실제 탭 이름으로 수정하세요.'
    );
  }
  return sheet;
}

/** Reads one PRODUCTS row into a product object. */
function readProduct_(sheet, rowNumber) {
  const fields = RF_CONFIG.PRODUCT_FIELDS;
  const headerNames = Object.keys(fields).map(function (k) {
    return fields[k];
  });
  const map = requireHeaders_(sheet, headerNames);
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const product = { rowNumber: rowNumber };
  Object.keys(fields).forEach(function (k) {
    product[k] = values[colOf_(map, fields[k]) - 1];
  });
  const optional = RF_CONFIG.PRODUCT_OPTIONAL_FIELDS;
  Object.keys(optional).forEach(function (k) {
    const col = colOf_(map, optional[k]);
    product[k] = col ? values[col - 1] : '';
  });
  product.id = normalizeText(product.id);
  return product;
}

/** All non-empty values in a column identified by header name (excluding header row). */
function readColumn_(sheet, map, headerName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, colOf_(map, headerName), lastRow - 1, 1)
    .getValues()
    .map(function (r) {
      return normalizeText(r[0]);
    })
    .filter(function (v) {
      return v.length > 0;
    });
}

/** Appends records (objects keyed by header) in one write, honouring the sheet's column order. */
function appendRecords_(sheet, records, textHeaders) {
  if (!records.length) return;
  const map = getHeaderMap_(sheet);
  const width = sheet.getLastColumn();
  const rows = records.map(function (rec) {
    const row = new Array(width).fill('');
    Object.keys(rec).forEach(function (h) {
      const col = colOf_(map, h);
      if (col) row[col - 1] = rec[h];
    });
    return row;
  });
  const startRow = sheet.getLastRow() + 1;
  // Plain-text format so Sheets never turns script text into numbers/dates (keeps fingerprints stable).
  (textHeaders || []).forEach(function (h) {
    const col = colOf_(map, h);
    if (col) sheet.getRange(startRow, col, rows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
}

/** Reads all data rows as objects keyed by the given header names, plus `_row` (1-based). */
function readRecords_(sheet, headers) {
  const map = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, lastCol)
    .getValues()
    .map(function (values, i) {
      const rec = { _row: i + 2 };
      headers.forEach(function (h) {
        const col = colOf_(map, h);
        rec[h] = col ? values[col - 1] : '';
      });
      return rec;
    });
}

/**
 * Writes only the changed cells of one row (never the whole row), so formulas or notes the
 * operator keeps in other columns are untouched.
 */
function updateRecord_(sheet, rowNumber, updates) {
  const map = getHeaderMap_(sheet);
  // Optional brand columns are skipped (not an error) until 시트 준비 adds them.
  Object.keys(updates).forEach(function (h) {
    if (!colOf_(map, h) && RF_CONFIG.REELS_OPTIONAL_HEADERS.indexOf(h) !== -1) delete updates[h];
  });
  const missing = Object.keys(updates).filter(function (h) {
    return !colOf_(map, h);
  });
  if (missing.length) {
    throw new Error(
      '"' + sheet.getName() + '" 시트에 헤더가 없습니다: ' + missing.join(', ') +
        '. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행하세요.'
    );
  }
  Object.keys(updates).forEach(function (h) {
    const cell = sheet.getRange(rowNumber, colOf_(map, h), 1, 1);
    if (RF_SCRIPT_FIELDS.indexOf(h) !== -1) cell.setNumberFormat('@');
    cell.setValues([[updates[h]]]);
  });
}

/** Appends entries to the append-only AUDIT sheet. */
function appendAudit_(ss, entries) {
  const list = entries.filter(function (e) {
    return e;
  });
  if (!list.length) return;
  const sheet = ensureSheet_(ss, RF_CONFIG.SHEETS.AUDIT, RF_CONFIG.AUDIT_HEADERS);
  appendRecords_(sheet, list);
}

/** Appends a row to the LOG sheet. Logging failures must never hide the original error. */
function logEvent_(level, action, productId, message, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ensureSheet_(ss, RF_CONFIG.SHEETS.LOG, RF_CONFIG.LOG_HEADERS);
    appendRecords_(sheet, [
      {
        '일시': new Date(),
        '레벨': level,
        '작업': action,
        '상품ID': productId || '',
        '메시지': message,
        '상세': detail ? String(detail).slice(0, 45000) : '',
      },
    ]);
  } catch (e) {
    console.error('LOG 기록 실패: ' + e.message);
  }
}

// ===== Fixtures.gs =====
/**
 * PRD-001 test fixture. Facts come only from README.md "First product".
 * Category/target are illustrative test inputs, not product claims.
 * URLs are intentionally blank and permission is "미확인" — they must be verified by the operator.
 *
 * FIXTURE_PRD_001_GEMINI_RESPONSE is the REFERENCE SPECIFICATION for new products (the five-hook
 * workflow the operator approved): five hooks H1–H5 (one per type), a recommended hook with a reason,
 * a customer-facing comment keyword, and one 24-second script that starts with the recommended hook
 * (HOOK → EMPATHY → SOLUTION → DEMO → DEMO → CTA) with visual directions, subtitle emphasis, sound
 * effects, Flow prompts and fact IDs. It is hand-written, NOT a recorded Gemini response.
 * Fact IDs follow the 확인된 기능 order (F1 = first line); the wording is true for both the README
 * facts below and the operator's sheet wording (FIXTURE_PRD_001_SHEET_FEATURES).
 */

const FIXTURE_PRD_001_SHEET_FEATURES = [
  '자석 부착형 거치 방식',
  '상·하단 분리형 2피스 구조 (상단 190x55x50mm, 하단 188x55x82mm)',
  '장우산/접이식 우산 분할 거치',
  '철제 도어 부착',
  '색상 옵션(다크그레이/그레이/화이트)',
].join('\n');

const FIXTURE_PRD_001_PRODUCT = {
  id: 'PRD-001',
  name: '리템 우산꽂이 자석형',
  category: '생활용품 > 현관 수납',
  features: [
    '호환되는 철제 표면에 자석으로 부착 가능',
    '상단·하단 분리형 (상단 190×55×50mm, 하단 188×55×82mm)',
    '장우산과 접이식 우산 모두 수납 가능',
    '색상: 다크그레이, 그레이, 화이트',
  ].join('\n'),
  target: '현관 공간이 좁은 집',
  affiliateUrl: '',
  sourceUrl: '',
  permission: '미확인',
  status: '',
};

const FIXTURE_PRD_001_GEMINI_RESPONSE = {
  hooks: [
    { id: 'H1', type: 'QUESTION', text: '급하게 출근할 때마다 우산 깜빡하는 사람?',
      visual: '현관문을 급히 나서다 멈칫하고 뒤돌아보는 사람, 신발장 구석에 세워 둔 우산',
      flow_prompt: 'Vertical 9:16 handheld shot, a person in work clothes hurrying out of a small Korean apartment front door, stopping and looking back at an umbrella leaning in the corner, natural light, no text.',
      emphasis: "'깜빡' 흔들림 효과", sfx: '문 닫히는 소리' },
    { id: 'H2', type: 'NUMBER', text: '두 조각만 문에 붙이면 바닥이 비어요',
      visual: '손이 상단·하단 두 조각을 하나씩 들어 보이는 클로즈업 → 우산이 널린 현관 바닥',
      flow_prompt: 'Vertical 9:16 close-up, two hands each holding one piece of a two-piece dark gray umbrella holder, then a quick tilt down to umbrellas cluttering the entryway floor, natural light, no text.',
      emphasis: "'두 조각' 노란색", sfx: '' },
    { id: 'H3', type: 'MYTH', text: '현관 우산 자리, 바닥이 아니에요',
      visual: '현관 바닥에 세워 둔 우산꽂이와 우산 더미를 내려다보는 POV',
      flow_prompt: 'Vertical 9:16 top-down POV, a bulky umbrella stand and several umbrellas taking up a small Korean apartment entryway floor, natural light, realistic, no text.',
      emphasis: "'바닥이 아니에요' 강조", sfx: '띵' },
    { id: 'H4', type: 'SITUATION', text: '비 오는 날, 현관에 젖은 우산이 굴러다녀요',
      visual: '첫 프레임부터 현관 바닥에 아무렇게나 놓인 젖은 우산 클로즈업 → 발이 우산을 피해 지나감',
      flow_prompt: 'Vertical 9:16 handheld close-up, wet umbrellas lying messily on a small Korean apartment entryway floor, a foot stepping around them, rainy-day light, realistic, no text, no logos.',
      emphasis: "'굴러다녀요' 흔들림 효과", sfx: '빗소리' },
    { id: 'H5', type: 'CONCLUSION', text: '좁은 현관 우산 정리, 문에 붙이면 돼요',
      visual: '좁은 현관 와이드 → 철제 현관문 아래쪽을 가리키는 손',
      flow_prompt: 'Vertical 9:16 handheld wide shot of a narrow Korean apartment entryway, then a hand pointing at the lower part of the steel front door, natural light, no text.',
      emphasis: "'문에 붙이면' 강조", sfx: '' },
  ],
  recommended_hook: {
    id: 'H4',
    reason: '첫 프레임부터 젖은 우산이 굴러다니는 현관을 보여 줄 수 있어 영상만 봐도 문제가 바로 보이고, 문에 붙여 바닥을 비우는 해결책과 자연스럽게 이어집니다. 지어낸 경험 없이 시청자 상황만 묘사합니다.',
  },
  comment_keyword: '우산',
  reels: [
    {
      pillar: 'PRODUCT_DISCOVERY',
      concept: '비 오는 날 현관',
      hook: '비 오는 날, 현관에 젖은 우산이 굴러다녀요',
      narration: '',
      captions: [],
      scenes: [
        { beat: 'HOOK', duration_sec: 3, narration: '비 오는 날, 현관에 젖은 우산이 굴러다녀요',
          visual: '첫 프레임부터 현관 바닥에 아무렇게나 놓인 젖은 우산 클로즈업 → 발이 우산을 피해 지나감',
          emphasis: "'굴러다녀요' 흔들림 효과", sfx: '빗소리',
          flow_prompt: 'Vertical 9:16 handheld close-up, wet umbrellas lying messily on a small Korean apartment entryway floor, a foot stepping around them, rainy-day light, realistic, no text, no logos.',
          fact_ids: [] },
        { beat: 'EMPATHY', duration_sec: 4, narration: '신발 둘 자리도 모자라잖아요',
          visual: '신발로 꽉 찬 좁은 현관을 위에서 내려다본 POV',
          emphasis: "'모자라잖아요' 빨간색", sfx: '',
          flow_prompt: 'Vertical 9:16 top-down POV, a tiny Korean apartment entryway floor crowded with shoes and no free space, natural light, realistic, no text.',
          fact_ids: [] },
        { beat: 'SOLUTION', duration_sec: 5, narration: '자석이라 철제 현관문에 붙이면 돼요',
          visual: '손이 우산꽂이를 철제 현관문 아래쪽에 자석으로 붙이는 순간 클로즈업',
          emphasis: "'현관문에' 강조", sfx: '착',
          flow_prompt: 'Vertical 9:16 close-up, a hand placing a slim dark gray magnetic umbrella holder onto the lower part of a steel apartment front door, natural light, realistic, no text.',
          fact_ids: ['F1'] },
        { beat: 'DEMO', duration_sec: 5, narration: '긴 우산도 접는 우산도 쏙 꽂아요',
          visual: '문에 붙은 우산꽂이에 장우산 → 접이식 우산을 차례로 꽂는 장면',
          emphasis: "'쏙' 통통 튀는 효과", sfx: '쏙 (두 번)',
          flow_prompt: 'Vertical 9:16 medium shot, a person sliding a long umbrella and then a folding umbrella into a slim dark gray holder attached to a steel front door, natural light, no text.',
          fact_ids: ['F3'] },
        { beat: 'DEMO', duration_sec: 4, narration: '위아래 두 조각으로 나뉘어 있어요',
          visual: '상단·하단 조각을 손으로 하나씩 들어 보여 주는 클로즈업',
          emphasis: "'두 조각' 노란색", sfx: '',
          flow_prompt: 'Vertical 9:16 close-up, two hands each holding one piece of a two-piece dark gray umbrella holder in a bright entryway, realistic, no text.',
          fact_ids: ['F2'] },
        { beat: 'CTA', duration_sec: 3, narration: "저장해 두고, 댓글에 '{키워드}' 남겨 주세요",
          visual: '문에 붙은 우산꽂이와 비어 있는 현관 바닥 와이드 → 제품 클로즈업',
          emphasis: '저장 아이콘 깜빡임', sfx: '띵',
          flow_prompt: 'Vertical 9:16 slow push-in to a slim dark gray umbrella holder on a steel door with one umbrella inside, clear entryway floor, soft light, no text.',
          fact_ids: [] },
      ].map(function (sc, i) {
        return Object.assign({ scene_no: i + 1, on_screen_text: '' }, sc);
      }),
      facts_used: ['F1', 'F2', 'F3'],
      needs_verification: [],
    },
  ],
};
FIXTURE_PRD_001_GEMINI_RESPONSE.reels.forEach(function (r) {
  r.captions = r.scenes.map(function (sc) { return sc.narration; });
  r.narration = r.captions.join(' ');
});

/**
 * Reference production plan for the PRD-001 storyboard above: what Gemini should return after the script
 * is approved (Production.gs). Hand-written to document and test the format — NOT a recorded response.
 * product_visual here is limited to what the verified facts say; with the operator's real product images
 * Gemini describes what those images show. Speaking rates: hook/CTA a little faster, explanations slower.
 */
const FIXTURE_PRD_001_PRODUCTION_PLAN_RESPONSE = {
  product_visual: {
    summary: 'A slim two-piece (upper and lower) umbrella holder in dark gray that attaches to a steel door with magnets.',
    must_match: ['two separate pieces, upper and lower', 'dark gray colour in every scene', 'slim body mounted flat on the lower part of a steel door'],
    must_not_show: ['screws, drills or adhesive', 'mounting on a refrigerator, wall or tile', 'any logo, brand name or printed text'],
  },
  scenes: [
    { scene_no: 1, scene_prompt: 'Handheld close-up of wet umbrellas lying on a small Korean apartment entryway floor, a foot stepping around them, rainy-day light.',
      continuity: 'same narrow entryway, same steel door and floor tiles in every scene', verify_in_clip: ['umbrellas are on the floor and the product is not yet visible'] },
    { scene_no: 2, scene_prompt: 'Top-down handheld POV of a tiny entryway floor crowded with shoes, no free space, natural daylight.',
      continuity: 'same entryway as scene 1', verify_in_clip: ['floor is crowded with shoes, no product yet'] },
    { scene_no: 3, scene_prompt: 'Close-up of a hand placing the holder onto the lower part of the steel apartment front door; the magnets click it into place.',
      continuity: 'same steel door as the earlier scenes', verify_in_clip: ['the product is attached to a steel door and looks like the reference images'] },
    { scene_no: 4, scene_prompt: 'Medium shot of a person sliding a long umbrella and then a folding umbrella into the holder on the steel door.',
      continuity: 'same person, same clothing, same holder position', verify_in_clip: ['both a long and a folding umbrella fit', 'the holder shape and colour match the reference images'] },
    { scene_no: 5, scene_prompt: 'Close-up of two hands each holding one piece of the two-piece holder in a bright entryway.',
      continuity: 'same hands and clothing as scene 4', verify_in_clip: ['exactly two separate pieces are shown'] },
    { scene_no: 6, scene_prompt: 'Slow push-in to the holder on the steel door with one umbrella inside and a clear entryway floor, soft light, hold steady at the end.',
      continuity: 'same door, floor and holder position', verify_in_clip: ['the floor is clear and the product matches the reference images'] },
  ],
  narration: [
    { scene_no: 1, tts_text: '비 오는 날, 현관에 젖은 우산이 굴러다녀요', speaking_rate: 1.05, pause_after_sec: 0.2 },
    { scene_no: 2, tts_text: '신발 둘 자리도 모자라잖아요', speaking_rate: 1.0, pause_after_sec: 0.3 },
    { scene_no: 3, tts_text: '자석이라 철제 현관문에 붙이면 돼요', speaking_rate: 0.98, pause_after_sec: 0.2 },
    { scene_no: 4, tts_text: '긴 우산도 접는 우산도 쏙 꽂아요', speaking_rate: 1.0, pause_after_sec: 0.2 },
    { scene_no: 5, tts_text: '위아래 두 조각으로 나뉘어 있어요', speaking_rate: 0.98, pause_after_sec: 0.2 },
    { scene_no: 6, tts_text: "저장해 두고, 댓글에 '{키워드}' 남겨 주세요", speaking_rate: 1.05, pause_after_sec: 0.1 },
  ],
  subtitles: [
    { scene_no: 1, emphasis_words: ['굴러다녀요'], note: '' },
    { scene_no: 2, emphasis_words: ['모자라잖아요'], note: '' },
    { scene_no: 3, emphasis_words: ['현관문에'], note: '' },
    { scene_no: 4, emphasis_words: ['쏙'], note: '' },
    { scene_no: 5, emphasis_words: ['두 조각'], note: '' },
    { scene_no: 6, emphasis_words: [], note: '' },
  ],
  edit: [
    { scene_no: 1, cuts: [{ framing: '클로즈업 — 젖은 우산' }, { framing: '미디엄 — 우산을 피해 지나가는 발' }] },
    { scene_no: 2, cuts: [{ framing: '위에서 내려다본 신발' }, { framing: '클로즈업 — 빈틈없는 바닥' }] },
    { scene_no: 3, cuts: [{ framing: '미디엄 — 손이 제품을 가져옴' }, { framing: '클로즈업 — 제품이 놓이는 순간' }, { framing: 'POV — 문에 붙은 제품' }] },
    { scene_no: 4, cuts: [{ framing: '클로즈업 — 장우산' }, { framing: '클로즈업 — 접이식 우산' }, { framing: '미디엄 — 사람과 제품' }] },
    { scene_no: 5, cuts: [{ framing: '클로즈업 — 상단 조각' }, { framing: '클로즈업 — 하단 조각' }] },
    { scene_no: 6, cuts: [{ framing: '제품 클로즈업' }, { framing: '와이드 — 비어 있는 현관 바닥' }] },
  ],
  risks: ['제품 색이 장면마다 달라질 수 있음 — 모든 클립에서 다크그레이인지 확인', '자석 부착 장면에서 문 재질이 철제로 보이는지 확인'],
};

// ===== FlowPrompts.gs =====
/**
 * Google Flow scene prompts, generated by code (no API call, no cost) from the APPROVED script and the
 * verified product facts. Written to REELS.'Flow 장면 프롬프트' on SCRIPT_APPROVED and cleared when the
 * script changes, so Flow credits are only ever spent on an approved storyboard.
 * One 8-second clip per scene; the renderer takes several short cuts from each clip.
 */

/** First colour listed in a "색상: …" fact, so every scene shows the same variant. */
function primaryColour_(facts) {
  for (let i = 0; i < facts.length; i++) {
    const m = facts[i].match(/^색상\s*[:：]\s*(.+)$/);
    if (m) return normalizeText(m[1].split(/[,，/]/)[0]);
  }
  return '';
}

function productAppearance_(product, facts) {
  const parts = [];
  if (normalizeText(product.appearance)) parts.push(normalizeText(product.appearance));
  const colour = primaryColour_(facts);
  if (colour) parts.push('주 색상 ' + colour + ' (모든 장면에서 같은 색)');
  facts.filter(function (f) {
    return /\d+\s*[×xX]\s*\d+/.test(f);
  }).forEach(function (f) {
    parts.push('크기: ' + f);
  });
  return parts.join('; ');
}

/** Clips needed so every part of a scene fits one clip (minus margin). 1 for valid storyboards. */
function flowClipParts(sceneSec) {
  const usable = RF_CONFIG.FLOW.CLIP_SEC - RF_CONFIG.FLOW.CLIP_MARGIN_SEC;
  return Math.max(1, Math.ceil(Number(sceneSec) / usable - 1e-9));
}

/** File name of part k (1-based) of scene n: S3.mp4, S3b.mp4, S3c.mp4 … */
function flowClipFile(sceneNo, part) {
  return 'S' + sceneNo + (part > 1 ? String.fromCharCode(96 + part) : '') + '.mp4';
}

/**
 * Returns [{ scene, part, parts, file, beat, clipSec, scriptedSec, coversSec, prompt }] for the reel's
 * current script — one entry per Flow clip (normally one per scene).
 * Uses only PRODUCTS.확인된 기능 (+ optional 제품 외형) — never invented attributes.
 * plan (optional, Production.gs): Gemini's validated production plan. Its scene description replaces the
 * script's flow_prompt and its product visual spec (from the operator's verified product images) is added;
 * the code-built product identity, verified features and no-text/no-logo rules stay in every prompt.
 */
function buildFlowScenePrompts(row, product, plan) {
  const reel = rowToReel(row);
  if (!reel.scenes || !reel.scenes.length) return [];
  const F = RF_CONFIG.FLOW;
  const facts = parseConfirmedFeatures(product.features);
  const appearance = productAppearance_(product, facts);
  const n = reel.scenes.length;
  const out = [];
  reel.scenes.forEach(function (s, i) {
    const beat = s.beat || (i === 0 ? 'HOOK' : i === n - 1 ? 'CTA' : 'DEMO');
    const parts = flowClipParts(s.duration_sec);
    const ps = plan && plan.scenes ? plan.scenes.filter(function (x) { return x.scene_no === (s.scene_no || i + 1); })[0] : null;
    for (let part = 1; part <= parts; part++) {
      const prompt = [
        'Google Flow · ' + cellText_(row['릴스ID']) + ' · scene ' + (i + 1) + '/' + n + ' · ' + beat + ' · ' + F.CLIP_SEC + '-second clip, vertical 9:16, photorealistic',
        'PRODUCT (identical in every scene): ' + normalizeText(product.name) + (appearance ? ' — ' + appearance : '') + '.',
        'Verified features only: ' + facts.join(' / ') + '. Do not add other features, logos, brand names or text on the product.',
        plan && plan.productVisual ? 'PRODUCT LOOK (from the verified product images — match exactly): ' + plan.productVisual.summary +
          (plan.productVisual.mustMatch.length ? ' Must match: ' + plan.productVisual.mustMatch.join('; ') + '.' : '') +
          (plan.productVisual.mustNotShow.length ? ' Never show: ' + plan.productVisual.mustNotShow.join('; ') + '.' : '') : '',
        'SCENE: ' + (ps ? normalizeText(ps.scene_prompt) : normalizeText(s.flow_prompt)) + ' (' + normalizeText(s.visual) + ')',
        ps && normalizeText(ps.continuity) ? 'CONTINUITY: ' + normalizeText(ps.continuity) : '',
        'PRODUCT INTERACTION: ' + F.INTERACTION[beat] + '.',
        'CAMERA: ' + F.CAMERA[beat] + '. One continuous take, no cuts, transitions or effects inside the clip.',
        'LIGHTING & ENVIRONMENT: ' + F.ENVIRONMENT + '. No on-screen text, subtitles, watermarks or logos.',
        parts > 1 ? 'PART ' + part + ' of ' + parts + ': ' + (part === 1 ? 'the beginning of this scene.' : 'continue the same action, place and lighting from where part ' + (part - 1) + ' ended.') : '',
        'DURATION: ' + F.CLIP_SEC + ' seconds. The editor uses about ' + +(Number(s.duration_sec) / parts).toFixed(1) + ' s of it as several short cuts, so let the framing change during the clip.',
        'CONSISTENCY: same product colour, shape and size as the other scenes; same location, door, floor and time of day; ' +
          'if a person appears, same clothing and hands in every scene. ' +
          (plan && plan.references && plan.references.length
            ? 'In Flow, add the verified product image(s) as the reference: ' + plan.references.map(function (r) { return r.name || r.fileId; }).join(', ') + '.'
            : 'If Flow accepts a reference image, use a photo of the real product you are allowed to use.'),
      ].filter(Boolean).join('\n');
      out.push({
        scene: i + 1, part: part, parts: parts, file: flowClipFile(i + 1, part), beat: beat, clipSec: F.CLIP_SEC,
        planned: !!ps,
        scriptedSec: Number(s.duration_sec), coversSec: +(Number(s.duration_sec) / parts).toFixed(2), prompt: prompt,
      });
    }
  });
  return out;
}

// ===== Production.gs =====
/**
 * Gemini as the production planner — AFTER SCRIPT_APPROVED only.
 *
 * Gemini decides: the scene-by-scene Google Flow prompts, how each line is spoken (rate, pause), which words
 * the subtitles stress, how each scene is cut, and what to check in the clips. It returns a declarative
 * plan; this file validates it and code executes it (Apps Script: Drive; renderer: Google Cloud TTS and
 * FFmpeg). Gemini never writes commands and never rewrites the approved script.
 *
 * Gates (all checked BEFORE the Gemini call):
 *   - the script is approved and unchanged since approval (SCRIPT_APPROVED fingerprint);
 *   - the REELS columns exist;
 *   - the operator listed verified product images in PRODUCTS and they can be read — product visuals must
 *     match real product images, never a guess.
 * Google Flow has no public API, so Flow generation stays manual; clips come back through Google Drive.
 */

// ---------------------------------------------------------------- schema and prompt

const RF_PRODUCTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    product_visual: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        must_match: { type: 'ARRAY', items: { type: 'STRING' } },
        must_not_show: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['summary', 'must_match', 'must_not_show'],
    },
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          scene_prompt: { type: 'STRING' },
          continuity: { type: 'STRING' },
          verify_in_clip: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['scene_no', 'scene_prompt', 'continuity', 'verify_in_clip'],
        propertyOrdering: ['scene_no', 'scene_prompt', 'continuity', 'verify_in_clip'],
      },
    },
    narration: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          tts_text: { type: 'STRING' },
          speaking_rate: { type: 'NUMBER' },
          pause_after_sec: { type: 'NUMBER' },
        },
        required: ['scene_no', 'tts_text', 'speaking_rate', 'pause_after_sec'],
        propertyOrdering: ['scene_no', 'tts_text', 'speaking_rate', 'pause_after_sec'],
      },
    },
    subtitles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          emphasis_words: { type: 'ARRAY', items: { type: 'STRING' } },
          note: { type: 'STRING' },
        },
        required: ['scene_no', 'emphasis_words', 'note'],
        propertyOrdering: ['scene_no', 'emphasis_words', 'note'],
      },
    },
    edit: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_no: { type: 'INTEGER' },
          cuts: { type: 'ARRAY', items: { type: 'OBJECT', properties: { framing: { type: 'STRING' } }, required: ['framing'] } },
        },
        required: ['scene_no', 'cuts'],
        propertyOrdering: ['scene_no', 'cuts'],
      },
    },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['product_visual', 'scenes', 'narration', 'subtitles', 'edit', 'risks'],
  propertyOrdering: ['product_visual', 'scenes', 'narration', 'subtitles', 'edit', 'risks'],
};

/** Verified product images listed in PRODUCTS ("검증된 제품 이미지"): [{ fileId }], at most MAX_REFERENCE_IMAGES. */
function parseReferenceImages(text) {
  const out = [];
  String(text == null ? '' : text).split(/[\n,;]+/).forEach(function (part) {
    const id = parseDriveFileId(part);
    if (id && !out.some(function (r) { return r.fileId === id; })) out.push({ fileId: id });
  });
  return out.slice(0, RF_CONFIG.PRODUCTION.MAX_REFERENCE_IMAGES);
}

/**
 * Reads the verified product images from Drive → [{ fileId, name, mimeType, data (base64) }].
 * Throws an actionable error (before any Gemini call) if there are none or one cannot be read.
 */
function loadReferenceImages_(product) {
  const P = RF_CONFIG.PRODUCTION;
  const refs = parseReferenceImages(product.referenceImages);
  const field = RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages;
  if (!refs.length) {
    throw new Error(
      '검증된 제품 이미지가 없습니다. 제품 모양·색·크기가 실제 제품과 같아야 하므로, PRODUCTS의 "' + field + '" 열(오른쪽에 직접 추가)에 ' +
        '실제 제품을 보여 주는 이미지의 Google Drive 링크를 줄마다 하나씩 넣으세요 (사용 권한이 확인된 이미지만). Gemini는 호출하지 않았습니다.'
    );
  }
  let total = 0;
  return refs.map(function (r) {
    let file;
    try {
      file = DriveApp.getFileById(r.fileId);
    } catch (e) {
      throw new Error('제품 이미지(' + r.fileId + ')를 Drive에서 열 수 없습니다. 링크와 공유 권한을 확인하세요. Gemini는 호출하지 않았습니다.');
    }
    const mime = String(file.getMimeType() || '');
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) {
      throw new Error('제품 이미지 "' + file.getName() + '"는 PNG/JPEG/WebP 이미지가 아닙니다 (' + mime + '). Gemini는 호출하지 않았습니다.');
    }
    const bytes = file.getBlob().getBytes();
    if (bytes.length > P.MAX_IMAGE_BYTES) {
      throw new Error('제품 이미지 "' + file.getName() + '"가 너무 큽니다 (' + Math.round(bytes.length / 1024) + 'KB, 최대 ' + Math.round(P.MAX_IMAGE_BYTES / 1024) + 'KB). 더 작은 이미지로 바꾸세요.');
    }
    total += bytes.length;
    if (total > P.MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('제품 이미지 전체 크기가 ' + Math.round(P.MAX_TOTAL_IMAGE_BYTES / 1024 / 1024) + 'MB를 넘습니다 (Gemini 요청 한도). 이미지를 줄이거나 개수를 줄이세요. Gemini는 호출하지 않았습니다.');
    }
    return { fileId: r.fileId, name: file.getName(), mimeType: mime, data: Utilities.base64Encode(bytes) };
  });
}

/** The approved storyboard, the only script Gemini plans for. */
function approvedScenes_(row) {
  const reel = rowToReel(row);
  return (reel.scenes || []).map(function (s, i) {
    return {
      scene_no: s.scene_no || i + 1,
      beat: s.beat || '',
      duration_sec: Number(s.duration_sec),
      narration: normalizeText(s.narration),
      visual: normalizeText(s.visual),
      flow_prompt: normalizeText(s.flow_prompt),
      ai_visualization: s.ai_visualization === true,
    };
  });
}

/** Prompt for the production plan. Costs one Gemini call (images attached separately). */
function buildProductionPlanPrompt(row, product, refs, previousErrors, previousResponse) {
  const P = RF_CONFIG.PRODUCTION;
  const L = RF_CONFIG.LIMITS;
  const facts = parseConfirmedFeatures(product.features);
  const scenes = approvedScenes_(row);
  const lines = [
    '당신은 인스타그램 계정 "' + RF_CONFIG.BRAND.NAME + '"의 릴스 제작 감독입니다. 대본은 이미 운영자가 승인했습니다. 승인된 대본은 한 글자도 바꾸지 말고, 영상 제작 계획만 세우세요.',
    '당신은 계획을 JSON으로 돌려줍니다. 실제 실행(Google Flow 클립 생성은 운영자가 수동, 음성 합성은 Google Cloud TTS, 편집은 FFmpeg 렌더러)은 코드가 하며, 코드가 이 계획을 검증합니다. 명령어·코드·셸은 쓰지 마세요.',
    '',
    '## 상품',
    '- 상품명: ' + normalizeText(product.name),
    '- 타깃: ' + (normalizeText(product.target) || '(미입력)'),
    '',
    '## 확인된 기능 (이것만 사실)',
  ];
  facts.forEach(function (f, i) {
    lines.push('- ' + factId(i) + ': ' + f);
  });
  lines.push(
    '',
    '## 검증된 제품 이미지 (첨부 ' + refs.length + '장: ' + refs.map(function (r) { return r.name; }).join(', ') + ')',
    '- 운영자가 실제 제품이라고 확인한 이미지입니다. 이 이미지에서 실제로 보이는 모양·색·비율·부착 위치만 product_visual에 쓰세요.',
    '- 이미지에 보이지 않거나 확인된 기능에 없는 것(소재, 질감, 부착 방식, 구성품 등)은 지어내지 말고, 헷갈리기 쉬운 것은 must_not_show에 쓰세요.',
    '',
    '## 승인된 대본 (장면별, 수정 금지)'
  );
  scenes.forEach(function (s) {
    lines.push('- 장면 ' + s.scene_no + ' [' + s.beat + '] ' + s.duration_sec + '초' + (s.ai_visualization ? ' (AI 시뮬레이션)' : '') +
      '\n  narration: ' + s.narration + '\n  연출: ' + s.visual + '\n  기존 Flow 프롬프트(참고): ' + s.flow_prompt);
  });
  lines.push(
    '',
    '## 규칙',
    '1. scenes: 장면마다 1개 (scene_no 그대로). scene_prompt는 영어로, 그 장면의 행동·장소·카메라 움직임만 쓰세요 (' + P.SCENE_PROMPT_MIN_CHARS + '자 이상). 제품 외형은 코드가 product_visual로 붙이므로 scene_prompt에서 제품 외형을 새로 묘사하지 마세요. 확인된 기능 밖의 부착 방식·호환 표면·성능을 보여 주지 마세요. 가격·브랜드·글자·로고 금지. continuity는 모든 장면에서 같아야 할 것(같은 문, 같은 바닥, 같은 옷 등). verify_in_clip은 생성된 클립에서 운영자가 확인할 것 1개 이상.',
    '2. narration: 장면마다 1개. tts_text는 승인된 narration과 한 글자도 다르지 않아야 합니다 ({키워드} 자리표시자 포함). speaking_rate는 ' + P.SPEAKING_RATE_MIN + '~' + P.SPEAKING_RATE_MAX + ' (훅·CTA는 또렷하고 약간 빠르게, 설명은 천천히), pause_after_sec는 0~' + P.PAUSE_MAX_SEC + '.',
    '3. subtitles: 장면마다 1개. emphasis_words는 그 장면 narration 안에 실제로 있는 단어(최대 ' + P.EMPHASIS_MAX_WORDS + '개, 없으면 []). note는 자막 편집 메모.',
    '4. edit: 장면마다 1개. cuts는 그 장면을 ' + P.CUT_MIN_SEC + '~' + P.CUT_MAX_SEC + '초 컷으로 나눈 구성입니다 (컷 길이 = 장면 길이 ÷ 컷 수가 이 범위 안). framing은 한국어 한 줄, 예: "클로즈업 — 손으로 제품 사용".',
    '5. product_visual.summary는 한 문장, must_match에는 모든 장면에서 실제 제품과 같아야 하는 시각적 특징(색·모양·비율·위치)을 1개 이상.',
    '6. risks: 생성된 클립에서 운영자가 특히 주의할 위험(제품 모양 불일치, 확인되지 않은 부착 장면 등). 없으면 [].',
    '7. 대본에 없는 경험담·테스트·후기·남편 반응·전후 결과를 만들지 마세요. AI 시뮬레이션 장면은 그대로 AI 시뮬레이션입니다.',
    '8. 길이 기준: 전체 ' + L.GENERATED_MIN_TOTAL_SEC + '~' + L.MAX_TOTAL_SEC + '초 (대본 그대로).',
    '',
    'JSON 스키마에 맞춰 JSON만 출력하세요.'
  );
  if (previousErrors && previousErrors.length) {
    lines.push('', '## 이전 응답의 검증 오류 (반드시 수정)', '아래 문제만 고치고 나머지는 그대로 두세요.');
    previousErrors.slice(0, 25).forEach(function (e) {
      lines.push('- ' + e);
    });
    if (previousResponse) lines.push('', '## 이전 응답 (JSON)', String(previousResponse).slice(0, 12000));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- validation

function normalizeTts_(text) {
  return normalizeText(text).replace(/\s+/g, ' ');
}

/**
 * Validates Gemini's production plan against the approved script. Gemini may plan, never rewrite:
 * the spoken text must equal the approved narration. Returns { errors, plan } (plan only when valid).
 */
function validateProductionPlan(raw, row, product, refs) {
  const P = RF_CONFIG.PRODUCTION;
  const errors = [];
  const scenes = approvedScenes_(row);
  if (!raw || typeof raw !== 'object') return { errors: ['제작 계획이 JSON 객체가 아닙니다.'], plan: null };
  const pv = raw.product_visual || {};
  const summary = normalizeText(pv.summary);
  const mustMatch = (Array.isArray(pv.must_match) ? pv.must_match : []).map(normalizeText).filter(Boolean);
  const mustNotShow = (Array.isArray(pv.must_not_show) ? pv.must_not_show : []).map(normalizeText).filter(Boolean);
  if (!summary) errors.push('product_visual.summary(제품 이미지에서 보이는 외형)가 비어 있습니다.');
  if (!mustMatch.length) errors.push('product_visual.must_match에 모든 장면에서 같아야 할 특징을 1개 이상 쓰세요.');
  const visualText = [summary].concat(mustMatch, mustNotShow).join(' ');
  if (/https?:\/\/|www\./i.test(visualText)) errors.push('product_visual에 URL이 있습니다.');
  RF_CONFIG.BANNED_PHRASES.forEach(function (phrase) {
    if (visualText.indexOf(phrase) !== -1) errors.push('product_visual에 과장/검증 불가 표현이 있습니다: "' + phrase + '".');
  });

  // Every list must have exactly one entry per approved scene, in order.
  const byScene = function (key) {
    const list = Array.isArray(raw[key]) ? raw[key] : [];
    if (list.length !== scenes.length) {
      errors.push(key + '는 장면 수(' + scenes.length + ')와 같아야 합니다 (받은 개수: ' + list.length + ').');
    }
    return scenes.map(function (s) {
      const item = list.filter(function (x) { return x && Number(x.scene_no) === s.scene_no; })[0];
      if (!item && list.length === scenes.length) errors.push(key + '에 장면 ' + s.scene_no + '이(가) 없습니다.');
      return item || null;
    });
  };
  const planScenes = byScene('scenes');
  const planNarration = byScene('narration');
  const planSubs = byScene('subtitles');
  const planEdit = byScene('edit');
  const out = { scenes: [], narration: [], subtitles: [], edit: [] };

  scenes.forEach(function (s, i) {
    const w = '장면 ' + s.scene_no + ': ';
    const sc = planScenes[i];
    if (sc) {
      const prompt = normalizeText(sc.scene_prompt);
      const letters = (prompt.match(/[A-Za-z]/g) || []).length;
      const visible = prompt.replace(/\s/g, '').length;
      if (prompt.length < P.SCENE_PROMPT_MIN_CHARS) errors.push(w + 'scene_prompt가 너무 짧습니다 (' + P.SCENE_PROMPT_MIN_CHARS + '자 이상).');
      else if (visible && letters / visible < 0.6) errors.push(w + 'scene_prompt는 Google Flow용 영어여야 합니다.');
      const lower = ' ' + prompt.toLowerCase() + ' ';
      P.SCENE_PROMPT_FORBIDDEN.forEach(function (term) {
        if (lower.indexOf(term) !== -1) errors.push(w + 'scene_prompt에 확인된 기능에 없는 내용이 있습니다: "' + term.trim() + '". 확인된 기능만으로 다시 쓰세요.');
      });
      if (/https?:\/\/|www\./i.test(prompt)) errors.push(w + 'scene_prompt에 URL이 있습니다.');
      const verify = (Array.isArray(sc.verify_in_clip) ? sc.verify_in_clip : []).map(normalizeText).filter(Boolean);
      if (!verify.length) errors.push(w + 'verify_in_clip(클립에서 확인할 것)이 비어 있습니다.');
      out.scenes.push({ scene_no: s.scene_no, scene_prompt: prompt, continuity: normalizeText(sc.continuity), verify_in_clip: verify });
    }
    const nr = planNarration[i];
    if (nr) {
      if (normalizeTts_(nr.tts_text) !== normalizeTts_(s.narration)) {
        errors.push(w + 'tts_text는 승인된 narration과 같아야 합니다 (대본은 수정할 수 없음). 승인된 문장: "' + s.narration + '"');
      }
      const rate = Number(nr.speaking_rate);
      const pause = Number(nr.pause_after_sec);
      if (!(rate >= P.SPEAKING_RATE_MIN && rate <= P.SPEAKING_RATE_MAX)) errors.push(w + 'speaking_rate는 ' + P.SPEAKING_RATE_MIN + '~' + P.SPEAKING_RATE_MAX + '여야 합니다 (받은 값: ' + nr.speaking_rate + ').');
      if (!(pause >= 0 && pause <= P.PAUSE_MAX_SEC)) errors.push(w + 'pause_after_sec는 0~' + P.PAUSE_MAX_SEC + '여야 합니다 (받은 값: ' + nr.pause_after_sec + ').');
      out.narration.push({ scene_no: s.scene_no, tts_text: s.narration, speaking_rate: +rate.toFixed(2), pause_after_sec: +pause.toFixed(2) });
    }
    const sb = planSubs[i];
    if (sb) {
      const words = (Array.isArray(sb.emphasis_words) ? sb.emphasis_words : []).map(normalizeText).filter(Boolean);
      if (words.length > P.EMPHASIS_MAX_WORDS) errors.push(w + 'emphasis_words는 최대 ' + P.EMPHASIS_MAX_WORDS + '개입니다.');
      words.forEach(function (word) {
        if (s.narration.indexOf(word) === -1) errors.push(w + 'emphasis_words "' + word + '"가 narration에 없습니다.');
      });
      out.subtitles.push({ scene_no: s.scene_no, emphasis_words: words, note: normalizeText(sb.note) });
    }
    const ed = planEdit[i];
    if (ed) {
      const cuts = Array.isArray(ed.cuts) ? ed.cuts : [];
      const per = cuts.length ? s.duration_sec / cuts.length : 0;
      if (!cuts.length) errors.push(w + 'cuts가 비어 있습니다.');
      else if (per < P.CUT_MIN_SEC - 1e-9 || per > P.CUT_MAX_SEC + 1e-9) {
        errors.push(w + '컷 ' + cuts.length + '개면 컷당 ' + per.toFixed(1) + '초입니다. ' + P.CUT_MIN_SEC + '~' + P.CUT_MAX_SEC + '초가 되도록 컷 수를 조정하세요.');
      }
      cuts.forEach(function (c, k) {
        if (!normalizeText(c && c.framing)) errors.push(w + '컷 ' + (k + 1) + '의 framing이 비어 있습니다.');
      });
      out.edit.push({ scene_no: s.scene_no, cuts: cuts.map(function (c) { return { framing: normalizeText(c && c.framing) }; }) });
    }
  });
  const risks = (Array.isArray(raw.risks) ? raw.risks : []).map(normalizeText).filter(Boolean);
  const uniq = dedupe_(errors);
  if (uniq.length) return { errors: uniq, plan: null };
  return {
    errors: [],
    plan: {
      planVersion: P.PLAN_VERSION,
      flowProvider: P.FLOW_PROVIDER,
      productVisual: { summary: summary, mustMatch: mustMatch, mustNotShow: mustNotShow },
      references: (refs || []).map(function (r) { return { fileId: r.fileId, name: r.name }; }),
      scenes: out.scenes,
      narration: out.narration,
      subtitles: out.subtitles,
      edit: out.edit,
      risks: risks,
    },
  };
}

/** The stored production plan if it belongs to the CURRENT approved script, else null. */
function validProductionPlan(row) {
  let plan = null;
  try {
    plan = JSON.parse(cellText_(row['제작 계획(JSON)']) || 'null');
  } catch (e) {
    return null;
  }
  if (!plan || !Array.isArray(plan.scenes)) return null;
  if (!isApprovedScriptIntact(row)) return null;
  if (plan.approvedHash !== cellText_(row['승인 대본 해시']) || Number(plan.scriptVersion) !== scriptVersionOf(row)) return null;
  return plan;
}

// ---------------------------------------------------------------- API: plan

/** Why a production plan cannot be made now ('' = it can). Checked before any Gemini or Drive call. */
function productionPlanBlocker_(row, columnsMissing) {
  const status = reelStatus(row);
  if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
    return '제작 계획은 대본 승인 후에만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + '). 대본을 승인하기 전에는 Flow 프롬프트·음성·렌더링을 준비하지 않습니다.';
  }
  if (!isApprovedScriptIntact(row)) {
    return '승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 현재 버전을 다시 검토·승인하세요.';
  }
  if (columnsMissing && columnsMissing.length) {
    return 'REELS에 제작 열이 없습니다 (' + columnsMissing.join(', ') + '). "릴스 팩토리 → 시트 준비"를 먼저 실행하세요 — 기존 데이터는 바뀌지 않습니다.';
  }
  return '';
}

/**
 * Gemini plans the production for an approved script: one Gemini call (+ at most one corrective retry),
 * text and the operator's verified product images only. No Flow generation, TTS or rendering happens here.
 */
function apiCreateProductionPlan(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      const blocker = productionPlanBlocker_(found.row, data.reelsSheet ? missingHeaders_(data.reelsSheet, RF_CONFIG.REELS_PRODUCTION_HEADERS) : RF_CONFIG.REELS_PRODUCTION_HEADERS);
      if (blocker) throw new Error(blocker);
      const refs = loadReferenceImages_(found.product); // throws before Gemini if none / unreadable
      const imageParts = refs.map(function (r) {
        return { inlineData: { mimeType: r.mimeType, data: r.data } };
      });
      let lastErrors = [];
      let lastRaw = '';
      let plan = null;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !plan; attempt++) {
        const raw = callGemini_(buildProductionPlanPrompt(found.row, found.product, refs, lastErrors, lastRaw), RF_PRODUCTION_SCHEMA, imageParts);
        const parsed = parseModelJson(raw);
        const result = parsed.error ? { errors: [parsed.error] } : validateProductionPlan(parsed.value, found.row, found.product, refs);
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'productionPlan', found.product.id, id + ' 제작 계획 검증 실패 (시도 ' + attempt + ')', result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          plan = result.plan;
        }
      }
      if (!plan) throw new Error('Gemini의 제작 계획이 검증을 통과하지 못했습니다. 아무것도 저장하지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      plan.scriptVersion = scriptVersionOf(found.row);
      plan.approvedHash = cellText_(found.row['승인 대본 해시']);
      plan.model = RF_GEMINI_STATE.lastModel || getGeminiModel();
      plan.createdAt = new Date().toISOString();
      applyTransition_(ss, id, 'SET_PRODUCTION_PLAN', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        plan: plan,
        flowPrompts: buildFlowScenePrompts(found.row, found.product, plan),
      }, user + ' + Gemini (' + plan.model + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

// ---------------------------------------------------------------- Google Drive: asset plan and tracker

function driveRootFolder_() {
  const configured = PropertiesService.getScriptProperties().getProperty('RF_DRIVE_FOLDER_ID');
  if (configured) {
    try {
      return DriveApp.getFolderById(configured);
    } catch (e) {
      throw new Error('스크립트 속성 RF_DRIVE_FOLDER_ID의 폴더를 열 수 없습니다. 폴더 ID와 권한을 확인하세요.');
    }
  }
  const it = DriveApp.getFoldersByName(RF_CONFIG.PRODUCTION.DRIVE_ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(RF_CONFIG.PRODUCTION.DRIVE_ROOT_FOLDER_NAME);
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Clip file names expected for the reel (from its Flow prompts): [{ file, scene, part, parts, beat, minSec }]. */
function expectedClips_(row) {
  return parseFlowScenePrompts_(row).map(function (p) {
    return { file: p.file, scene: p.scene, part: p.part || 1, parts: p.parts || 1, beat: p.beat || '', coversSec: p.coversSec || 0 };
  });
}

function parseAssetStatus_(row) {
  try {
    const v = JSON.parse(cellText_(row['에셋 현황(JSON)']) || 'null');
    return v && Array.isArray(v.clips) ? v : null;
  } catch (e) {
    return null;
  }
}

/** Matches Drive files to expected clip names (case-insensitive, mp4/mov/m4v). */
function matchClipFiles_(expected, files) {
  const exts = RF_CONFIG.PRODUCTION.CLIP_EXTENSIONS;
  const byBase = {};
  const extra = [];
  files.forEach(function (f) {
    const m = /^(.*)\.([A-Za-z0-9]+)$/.exec(f.name);
    if (m && exts.indexOf(m[2].toLowerCase()) !== -1) {
      const base = m[1].toUpperCase();
      // Newest upload wins if the same clip was uploaded twice.
      if (!byBase[base] || byBase[base].modified < f.modified) byBase[base] = f;
    } else {
      extra.push(f.name);
    }
  });
  const used = {};
  const clips = expected.map(function (c) {
    const base = c.file.replace(/\.[A-Za-z0-9]+$/, '').toUpperCase();
    const f = byBase[base];
    if (f) used[base] = true;
    return Object.assign({}, c, f
      ? { status: 'UPLOADED', driveFileId: f.id, driveName: f.name, sizeBytes: f.size, modified: f.modified }
      : { status: 'MISSING' });
  });
  Object.keys(byBase).forEach(function (b) {
    if (!used[b]) extra.push(byBase[b].name);
  });
  return { clips: clips, extra: extra };
}

function listFolderFiles_(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), name: f.getName(), size: f.getSize(), modified: f.getLastUpdated() instanceof Date ? f.getLastUpdated().toISOString() : String(f.getLastUpdated() || '') });
  }
  return out;
}

/**
 * Prepares the Drive folder for a reel's clips (Reels Factory / <상품ID> / <릴스ID>) and the asset tracker
 * (one row per Flow clip, with its expected file name), then reads the folder to see which clips have
 * been uploaded. No Gemini call; Drive only. Tracking data is not an operator decision, so it
 * is written to 에셋 현황(JSON) without an AUDIT entry.
 */
function syncAssets_(ss, id) {
  const data = loadData_(ss);
  const found = findReel_(data, id);
  const row = found.row;
  const blocker = productionPlanBlocker_(row, data.reelsSheet ? missingHeaders_(data.reelsSheet, RF_CONFIG.REELS_PRODUCTION_HEADERS) : RF_CONFIG.REELS_PRODUCTION_HEADERS);
  if (blocker) throw new Error(blocker);
  const expected = expectedClips_(row);
  if (!expected.length) throw new Error('Flow 프롬프트가 없습니다. 먼저 제작 계획을 만드세요.');
  const folder = childFolder_(childFolder_(driveRootFolder_(), found.product.id), id);
  const files = listFolderFiles_(folder);
  const m = matchClipFiles_(expected, files);
  const status = {
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    scriptVersion: scriptVersionOf(row),
    approvedHash: cellText_(row['승인 대본 해시']),
    syncedAt: new Date().toISOString(),
    clips: m.clips,
    extra: m.extra,
    uploaded: m.clips.filter(function (c) { return c.status === 'UPLOADED'; }).length,
    total: m.clips.length,
  };
  updateRecord_(data.reelsSheet, row._row, { '에셋 현황(JSON)': JSON.stringify(status) });
  logEvent_('INFO', 'assets', found.product.id, id + ' Drive 에셋 ' + status.uploaded + '/' + status.total + ' 업로드됨', status.extra.length ? '목록에 없는 파일: ' + status.extra.join(', ') : '');
  return status;
}

function apiPrepareAssets(reelId, input) {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const found = findReel_(loadData_(ss), id);
      if ((input.expectedStatus && input.expectedStatus !== reelStatus(found.row)) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, reelStatus(found.row));
      }
      syncAssets_(ss, id);
    });
    return { detail: reelDetail_(ss, id) };
  });
}

// ---------------------------------------------------------------- dashboard view

function productionView_(row, product, columnsMissing) {
  // columnsMissing: names of missing REELS production columns ([] when present).
  const status = reelStatus(row);
  const plan = validProductionPlan(row);
  const stored = (function () {
    try {
      return JSON.parse(cellText_(row['제작 계획(JSON)']) || 'null');
    } catch (e) {
      return null;
    }
  })();
  const assets = parseAssetStatus_(row);
  const blocker = productionPlanBlocker_(row, columnsMissing);
  const refs = parseReferenceImages(product.referenceImages);
  const approvedStatuses = RF_CONFIG.PRODUCTION.PLAN_STATUSES;
  return {
    visible: approvedStatuses.indexOf(status) !== -1,
    flowProvider: RF_CONFIG.PRODUCTION.FLOW_PROVIDER,
    flowNote: 'Google Flow에는 공식 공개 API가 없어 클립은 Flow에서 직접 만들어 Drive 폴더에 올립니다.',
    canPlan: !blocker && approvedStatuses.indexOf(status) !== -1,
    blocker: blocker,
    referenceImages: refs.length,
    referenceImagesField: RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages,
    plan: plan,
    stale: !!stored && !plan,
    assets: assets && assets.approvedHash === cellText_(row['승인 대본 해시']) ? assets : null,
    canPrepareAssets: !blocker && approvedStatuses.indexOf(status) !== -1,
  };
}

// ===== Media.gs =====
/**
 * Mobile media workspace (iPhone Safari): verified product reference photos, Google Flow clip uploads,
 * per-clip review, and the render gate. Google Flow stays MANUAL — nothing here calls Flow or Veo, and no
 * paid generation is started automatically.
 *
 * Upload design (see docs/media-workspace.md): a clip is sent from the browser in small chunks
 * (google.script.run carries ~50 MB at most per call, and base64 adds a third). Apps Script forwards each
 * chunk to a Drive *resumable upload session* it opened with the operator's own OAuth token, so no whole
 * file is ever held in Apps Script and no Drive token reaches the browser. Files stay private in the
 * operator's Drive (never shared). Fallback when direct upload fails or is too slow: upload the file with
 * the Drive app into the reel's folder and attach it from the dashboard.
 *
 * Rules enforced here (all server-side, the browser is not trusted):
 *  - uploads and reviews only for an approved, unchanged script; the target clip comes from the reel's own
 *    Flow clip list, never from a client-supplied name;
 *  - type, extension, size, duplicate content (Drive MD5) and the operator's media-rights confirmation;
 *  - every upload is a new version; a replacement voids the previous approval; versions and Drive file IDs
 *    are never deleted;
 *  - the final render (job file) needs every clip APPROVED, and the approved files must still be the same
 *    bytes in Drive.
 */

// ---------------------------------------------------------------- small helpers

function mediaUserCache_() {
  return CacheService.getUserCache();
}

/** Unsigned view of an Apps Script byte array. */
function ub_(b) {
  return b < 0 ? b + 256 : b;
}

function md5Hex_(bytes) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
}

/** 'image/png' | 'image/jpeg' | 'image/webp' from the file's own bytes (the claimed type is not trusted), or ''. */
function sniffImageMime_(bytes) {
  const b = bytes.slice(0, 12).map(ub_);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

function flowUrl_() {
  const custom = PropertiesService.getScriptProperties().getProperty('RF_FLOW_URL');
  return custom && /^https:\/\//.test(custom) ? custom : RF_CONFIG.MEDIA.FLOW_URL;
}

function driveAuthHeaders_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

/** Drive v3 file metadata: { id, name, size (string), mimeType, md5Checksum, parents, trashed }. */
function driveFileMeta_(fileId) {
  const fields = 'id,name,size,mimeType,md5Checksum,parents,trashed';
  const res = UrlFetchApp.fetch(RF_CONFIG.MEDIA.DRIVE_API + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=' + encodeURIComponent(fields), {
    method: 'get', headers: driveAuthHeaders_(), muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 404) throw new Error('Drive에서 파일을 찾을 수 없습니다 (삭제되었거나 권한이 없습니다).');
  if (code !== 200) throw new Error('Drive 파일 정보를 읽지 못했습니다 (HTTP ' + code + ').');
  return JSON.parse(res.getContentText());
}

function headerOf_(res, name) {
  const all = res.getAllHeaders ? res.getAllHeaders() : res.getHeaders();
  const k = Object.keys(all || {}).filter(function (h) {
    return h.toLowerCase() === name.toLowerCase();
  })[0];
  return k ? String(all[k]) : '';
}

// ---------------------------------------------------------------- clip store (REELS "장면 클립(JSON)")

function clipKeyOf_(file) {
  return String(file).replace(/\.[A-Za-z0-9]+$/, '');
}

function parseClipStore_(row) {
  try {
    const v = JSON.parse(cellText_(row['장면 클립(JSON)']) || 'null');
    if (v && typeof v === 'object' && v.clips && typeof v.clips === 'object') return v;
  } catch (e) {
    // fall through
  }
  return { version: 1, clips: {} };
}

/**
 * Status of one clip for the CURRENT approval: MISSING | PENDING_REVIEW | APPROVED | REJECTED.
 * An approval counts only for the approved-script fingerprint it was given under.
 */
function clipState_(entry, hash) {
  const versions = entry && Array.isArray(entry.versions) ? entry.versions : [];
  const cur = versions.filter(function (v) {
    return v.v === entry.current;
  })[0] || null;
  if (!cur) return { status: 'MISSING', current: null };
  if (cur.status === 'APPROVED' && cur.approvedHash === hash) return { status: 'APPROVED', current: cur };
  if (cur.status === 'REJECTED') return { status: 'REJECTED', current: cur };
  return { status: 'PENDING_REVIEW', current: cur };
}

/** [{ key, file, scene, part, parts, beat, status, current, versions }] for every Flow clip of the reel. */
function clipList_(row) {
  const store = parseClipStore_(row);
  const hash = cellText_(row['승인 대본 해시']);
  return expectedClips_(row).map(function (c) {
    const key = clipKeyOf_(c.file);
    const entry = store.clips[key] || { versions: [], current: 0 };
    const st = clipState_(entry, hash);
    return Object.assign({}, c, { key: key, status: st.status, current: st.current, versions: entry.versions || [] });
  });
}

/** Pure render gate: '' when every clip is APPROVED (only for reels with a production plan), else the reason. */
function clipGateBlocker_(row) {
  if (!validProductionPlan(row)) return '';
  const list = clipList_(row);
  if (!list.length) return '장면 클립 목록이 없습니다. 제작 계획과 Flow 프롬프트를 먼저 만드세요.';
  const label = { MISSING: '클립 없음', PENDING_REVIEW: '승인 대기', REJECTED: '다시 만들기 필요' };
  const open = list.filter(function (c) {
    return c.status !== 'APPROVED';
  });
  if (!open.length) return '';
  return '모든 장면 클립이 승인되어야 최종 영상을 만들 수 있습니다 (승인 ' + (list.length - open.length) + '/' + list.length + '): ' +
    open.map(function (c) { return c.key + ' ' + label[c.status]; }).join(', ');
}

/** Approved clips as the signed render job carries them. */
function buildClipManifest_(row) {
  if (!validProductionPlan(row)) return null;
  return {
    approvedHash: cellText_(row['승인 대본 해시']),
    reelId: cellText_(row['릴스ID']),
    productId: cellText_(row['상품ID']),
    clips: clipList_(row).filter(function (c) {
      return c.status === 'APPROVED';
    }).map(function (c) {
      return {
        clip: c.key, file: c.file, scene: c.scene, part: c.part, version: c.current.v,
        fileId: c.current.fileId, driveName: c.current.name, md5: c.current.md5, size: c.current.size,
        approvedBy: c.current.reviewedBy, approvedAt: c.current.reviewedAt,
      };
    }),
  };
}

/** Before a job file is issued: every approved file must still be the same bytes in Drive. '' = OK. */
function verifyApprovedClipFiles_(row) {
  const manifest = buildClipManifest_(row);
  if (!manifest) return '';
  const bad = [];
  manifest.clips.forEach(function (c) {
    try {
      const m = driveFileMeta_(c.fileId);
      if (m.trashed || String(m.md5Checksum) !== c.md5 || Number(m.size) !== c.size) bad.push(c.clip + ' (파일이 바뀌었거나 휴지통에 있음)');
    } catch (e) {
      bad.push(c.clip + ' (' + e.message + ')');
    }
  });
  return bad.length ? '승인된 클립 파일을 Drive에서 확인하지 못했습니다: ' + bad.join(', ') + '. 해당 장면을 다시 업로드하고 승인하세요.' : '';
}

// ---------------------------------------------------------------- common guards

function mediaBlocker_(row, columnsMissing) {
  const status = reelStatus(row);
  if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
    return '클립 업로드·검토는 대본 승인 후에만 할 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + ').';
  }
  if (!isApprovedScriptIntact(row)) return '승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.';
  if (columnsMissing && columnsMissing.length) {
    return 'REELS에 열이 없습니다 (' + columnsMissing.join(', ') + '). "릴스 팩토리 → 시트 준비"를 먼저 실행하세요 — 기존 데이터는 바뀌지 않습니다.';
  }
  return '';
}

/** Loads the reel, checks the optimistic-concurrency fields and the guards. Returns { data, found, clip }. */
function mediaContext_(ss, reelId, input, needClip) {
  const data = loadData_(ss);
  const found = findReel_(data, normalizeText(reelId));
  const status = reelStatus(found.row);
  if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
    throw staleError_(found.row, status);
  }
  const blocker = mediaBlocker_(found.row, data.mediaColumnsMissing);
  if (blocker) throw new Error(blocker);
  let clip = null;
  if (needClip) {
    clip = clipList_(found.row).filter(function (c) {
      return c.key === input.clip;
    })[0];
    if (!clip) throw new Error('이 릴스에 없는 장면 클립입니다: ' + normalizeText(input.clip));
  }
  return { data: data, found: found, clip: clip };
}

function clipFolder_(product, reelId, sub) {
  const reel = childFolder_(childFolder_(driveRootFolder_(), product.id), reelId);
  return sub ? childFolder_(reel, sub) : reel;
}

// ---------------------------------------------------------------- reference photos

function referenceLinks_(text) {
  const ids = [];
  String(text == null ? '' : text).split(/[\n,;]+/).forEach(function (part) {
    const id = parseDriveFileId(part);
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}

/**
 * Saves one verified product photo to the product's Drive folder (Reels Factory / <상품ID> / references) and
 * APPENDS its link to that product's PRODUCTS "검증된 제품 이미지" cell. Nothing else in PRODUCTS is touched
 * (other rows, other cells, existing links and notes stay). Needs the operator's rights confirmation.
 * input: { data: base64, rightsConfirmed: true }
 */
function apiUploadReferencePhoto(productId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(productId);
    input = input || {};
    const M = RF_CONFIG.MEDIA;
    let result = null;
    withLock_(function () {
      const data = loadData_(ss);
      const product = data.productById[id];
      if (!product || product === 'DUPLICATE') throw new Error('PRODUCTS에서 상품ID "' + id + '"를 하나만 찾을 수 없습니다.');
      if (input.rightsConfirmed !== true) {
        throw new Error('이 사진이 실제 제품을 보여 주고, 내가 직접 찍었거나 사용 권한을 확인한 사진이라는 확인에 체크하세요. 제품을 샀다고 해서 타인이 만든 이미지의 권리가 생기지는 않습니다.');
      }
      const sheet = getProductsSheet_(ss);
      const field = RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages;
      const col = colOf_(getHeaderMap_(sheet), field);
      if (!col) {
        throw new Error('PRODUCTS에 "' + field + '" 열이 없습니다. 열 머리글을 오른쪽에 직접 추가한 뒤 다시 시도하세요 (PRODUCTS 구조는 자동으로 바꾸지 않습니다).');
      }
      const bytes = Utilities.base64Decode(String(input.data || ''));
      if (!bytes.length) throw new Error('사진 데이터가 비어 있습니다.');
      if (bytes.length > RF_CONFIG.PRODUCTION.MAX_IMAGE_BYTES) {
        throw new Error('사진이 너무 큽니다 (' + Math.round(bytes.length / 1024) + 'KB, 최대 ' + Math.round(RF_CONFIG.PRODUCTION.MAX_IMAGE_BYTES / 1024) + 'KB). 더 작게 줄여 올리세요.');
      }
      const mime = sniffImageMime_(bytes);
      if (!mime) throw new Error('PNG, JPEG, WebP 사진만 올릴 수 있습니다 (파일 내용을 확인했습니다).');
      // The product row is re-read right here, so a row that moved in the meantime is never written.
      const idCol = colOf_(getHeaderMap_(sheet), RF_CONFIG.PRODUCT_FIELDS.id);
      if (normalizeText(sheet.getRange(product.rowNumber, idCol, 1, 1).getValues()[0][0]) !== id) {
        throw new Error('PRODUCTS의 행이 바뀌었습니다. 새로고침 후 다시 시도하세요.');
      }
      const cell = sheet.getRange(product.rowNumber, col, 1, 1);
      const current = String(cell.getValues()[0][0] == null ? '' : cell.getValues()[0][0]).trim();
      const existing = referenceLinks_(current);
      if (existing.length >= M.REF_PHOTOS_MAX) {
        throw new Error('제품 참고 사진은 최대 ' + M.REF_PHOTOS_MAX + '장입니다. PRODUCTS에서 쓰지 않을 사진 링크를 지운 뒤 올리세요 (Drive 파일은 지우지 않습니다).');
      }
      const md5 = md5Hex_(bytes);
      existing.forEach(function (fid) {
        let m = null;
        try {
          m = driveFileMeta_(fid);
        } catch (e) {
          return; // an unreadable old link is not this upload's problem
        }
        if (m && m.md5Checksum === md5) throw new Error('같은 사진이 이미 등록되어 있습니다 (' + m.name + ').');
      });
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
      const stamp = Utilities.formatDate ? Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss') : String(Date.now());
      const name = 'ref-' + (existing.length + 1) + '-' + stamp + '.' + ext;
      const folder = childFolder_(childFolder_(driveRootFolder_(), id), M.REF_FOLDER_NAME);
      const file = folder.createFile(Utilities.newBlob(bytes, mime, name));
      const link = driveViewUrl(file.getId());
      cell.setNumberFormat('@');
      cell.setValues([[current ? current + '\n' + link : link]]);
      logEvent_('INFO', 'referencePhoto', id, '제품 참고 사진 추가 (권리 확인 체크함): ' + name, '작업자 ' + user + ' · 파일 ID ' + file.getId() + ' · md5 ' + md5);
      result = { fileId: file.getId(), name: name, count: existing.length + 1 };
    });
    return { reference: result };
  });
}

// ---------------------------------------------------------------- clip upload (chunked, resumable via Drive)

/**
 * Step 1: validates the request and opens a Drive resumable session for ONE clip. Returns the upload id
 * and chunk size; the browser then sends apiUploadClipChunk calls.
 * input: { clip: 'S3', fileName, mime, size, rightsConfirmed: true, expectedStatus, expectedScriptVersion }
 */
function apiStartClipUpload(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    input = input || {};
    const M = RF_CONFIG.MEDIA;
    const ctx = mediaContext_(ss, reelId, input, true);
    if (input.rightsConfirmed !== true) {
      throw new Error('이 영상이 Google Flow로 직접 만들었거나 사용 권한을 확인한 영상이라는 확인에 체크하세요. 제품을 소유한다고 해서 제3자 영상의 권리가 생기지는 않습니다.');
    }
    const ext = (/\.([A-Za-z0-9]+)$/.exec(normalizeText(input.fileName)) || [])[1];
    if (!ext || M.CLIP_EXTENSIONS.indexOf(ext.toLowerCase()) === -1) throw new Error('MP4 또는 MOV 영상만 올릴 수 있습니다 (' + M.CLIP_EXTENSIONS.join(', ') + ').');
    const mime = normalizeText(input.mime).toLowerCase();
    if (M.CLIP_MIME.indexOf(mime) === -1) throw new Error('영상 형식(' + (mime || '알 수 없음') + ')을 지원하지 않습니다. MP4 또는 MOV로 올리세요.');
    const size = Number(input.size);
    if (!(size >= M.CLIP_MIN_BYTES) || !isFinite(size) || Math.floor(size) !== size) throw new Error('영상 크기가 올바르지 않습니다.');
    if (size > M.CLIP_MAX_BYTES) throw new Error('영상이 너무 큽니다 (' + Math.round(size / 1048576) + 'MB, 최대 ' + Math.round(M.CLIP_MAX_BYTES / 1048576) + 'MB). 8초 클립은 보통 이보다 훨씬 작습니다.');
    const uploadId = Utilities.getUuid().replace(/-/g, '');
    const folder = clipFolder_(ctx.found.product, normalizeText(reelId), M.VERSIONS_FOLDER_NAME);
    // The Drive name is generated here; nothing from the browser decides where the file goes or what it is called.
    const name = ctx.clip.key + '_' + uploadId.slice(0, 8) + '.' + ext.toLowerCase();
    const res = UrlFetchApp.fetch(M.DRIVE_UPLOAD_API + '?uploadType=resumable&supportsAllDrives=true&fields=' + encodeURIComponent('id,name,size,mimeType,md5Checksum,parents,trashed'), {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: Object.assign(driveAuthHeaders_(), { 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) }),
      payload: JSON.stringify({ name: name, parents: [folder.getId()], mimeType: mime, appProperties: { rfReel: normalizeText(reelId), rfClip: ctx.clip.key, rfUpload: uploadId } }),
      muteHttpExceptions: true,
    });
    const uri = headerOf_(res, 'Location');
    if (res.getResponseCode() !== 200 || !uri) {
      throw new Error('Drive 업로드를 시작하지 못했습니다 (HTTP ' + res.getResponseCode() + '). Drive 권한과 저장 공간을 확인하세요.');
    }
    const session = {
      uri: uri, reelId: normalizeText(reelId), clip: ctx.clip.key, name: name, mime: mime, size: size, next: 0,
      user: user, scriptVersion: scriptVersionOf(ctx.found.row), folderId: folder.getId(),
    };
    mediaUserCache_().put('rfup:' + uploadId, JSON.stringify(session), M.UPLOAD_TTL_SEC);
    return { uploadId: uploadId, chunkBytes: M.CHUNK_BYTES, size: size, clip: ctx.clip.key, next: 0 };
  });
}

function loadUploadSession_(uploadId, user) {
  const raw = mediaUserCache_().get('rfup:' + normalizeText(uploadId));
  if (!raw) throw new Error('업로드 세션이 만료되었거나 없습니다. 같은 장면에서 업로드를 처음부터 다시 시작하세요 (Drive에 올라간 일부 데이터는 완성되지 않은 임시 파일입니다).');
  const s = JSON.parse(raw);
  if (s.user !== user) throw new Error('이 업로드는 다른 계정에서 시작되었습니다.');
  return s;
}

/** Interprets a Drive resumable response. Returns { done, next, meta }. */
function readUploadResponse_(res, session, uploadId) {
  const code = res.getResponseCode();
  if (code === 308) {
    const range = headerOf_(res, 'Range');
    const m = /bytes=0-(\d+)/.exec(range);
    return { done: false, next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) return { done: true, meta: JSON.parse(res.getContentText()) };
  if (code === 404 || code === 410) {
    mediaUserCache_().remove('rfup:' + uploadId);
    throw new Error('Drive 업로드 세션이 만료되었습니다. 이 장면에서 업로드를 처음부터 다시 시작하세요.');
  }
  if (code === 429 || code >= 500) throw new Error('RETRY: Drive가 일시적으로 응답하지 않습니다 (HTTP ' + code + '). 잠시 후 이어서 다시 시도합니다.');
  throw new Error('Drive가 업로드를 거부했습니다 (HTTP ' + code + ').');
}

function finishUpload_(ss, session, uploadId, meta, user) {
  if (Number(meta.size) !== session.size) {
    throw new Error('업로드된 크기(' + meta.size + ')가 선택한 파일 크기(' + session.size + ')와 다릅니다. 다시 업로드하세요.');
  }
  mediaUserCache_().remove('rfup:' + uploadId);
  return registerClipVersion_(ss, session.reelId, session.clip, meta, 'dashboard', user);
}

/**
 * Step 2 (repeat): sends one chunk. offset must equal the bytes Drive already has; every chunk except the last
 * is a multiple of 256 KiB. Returns { done:false, next } or { done:true, ... } when the clip is registered.
 * A message starting with "RETRY:" means the same call may be repeated; after any other doubt call
 * apiClipUploadStatus to learn where to resume.
 */
function apiUploadClipChunk(uploadId, offset, base64) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const M = RF_CONFIG.MEDIA;
    const s = loadUploadSession_(uploadId, user);
    const bytes = Utilities.base64Decode(String(base64 || ''));
    const start = Number(offset);
    if (!bytes.length || bytes.length > M.CHUNK_BYTES) throw new Error('조각 크기가 올바르지 않습니다.');
    if (start !== s.next) throw new Error('조각 위치가 맞지 않습니다 (서버 기준 ' + s.next + '). 상태를 확인한 뒤 이어서 보내세요.');
    const end = start + bytes.length;
    if (end > s.size) throw new Error('파일 크기를 넘는 조각입니다.');
    if (end < s.size && bytes.length % (256 * 1024) !== 0) throw new Error('중간 조각은 256KiB의 배수여야 합니다.');
    const res = UrlFetchApp.fetch(s.uri, {
      method: 'put',
      headers: { 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + s.size },
      contentType: s.mime,
      payload: bytes,
      muteHttpExceptions: true,
    });
    const r = readUploadResponse_(res, s, normalizeText(uploadId));
    if (r.done) return Object.assign({ done: true }, finishUpload_(ss, s, normalizeText(uploadId), r.meta, user));
    s.next = r.next;
    mediaUserCache_().put('rfup:' + normalizeText(uploadId), JSON.stringify(s), M.UPLOAD_TTL_SEC);
    return { done: false, next: s.next, size: s.size };
  });
}

/** Where to resume (asks Drive), or — if Drive already has the whole file — registers the clip. */
function apiClipUploadStatus(uploadId) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const s = loadUploadSession_(uploadId, user);
    const res = UrlFetchApp.fetch(s.uri, { method: 'put', headers: { 'Content-Range': 'bytes */' + s.size }, payload: '', muteHttpExceptions: true });
    const r = readUploadResponse_(res, s, normalizeText(uploadId));
    if (r.done) return Object.assign({ done: true }, finishUpload_(ss, s, normalizeText(uploadId), r.meta, user));
    s.next = r.next;
    mediaUserCache_().put('rfup:' + normalizeText(uploadId), JSON.stringify(s), RF_CONFIG.MEDIA.UPLOAD_TTL_SEC);
    return { done: false, next: s.next, size: s.size };
  });
}

/**
 * Fallback: attach a clip that was uploaded with the Drive app into this reel's folder (or its versions folder).
 * The file must be in that folder, a supported video, within the size limit, with a Drive checksum.
 * input: { clip, fileId, rightsConfirmed, expectedStatus, expectedScriptVersion }
 */
function apiAttachDriveClip(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    input = input || {};
    const M = RF_CONFIG.MEDIA;
    let view = null;
    withLock_(function () {
      const ctx = mediaContext_(ss, reelId, input, true);
      if (input.rightsConfirmed !== true) throw new Error('영상 권리 확인에 체크하세요.');
      const fileId = parseDriveFileId(input.fileId);
      if (!fileId) throw new Error('Drive 파일 ID가 올바르지 않습니다.');
      const meta = driveFileMeta_(fileId);
      const reelFolder = clipFolder_(ctx.found.product, normalizeText(reelId));
      const versions = clipFolder_(ctx.found.product, normalizeText(reelId), M.VERSIONS_FOLDER_NAME);
      const parents = Array.isArray(meta.parents) ? meta.parents : [];
      if (parents.indexOf(reelFolder.getId()) === -1 && parents.indexOf(versions.getId()) === -1) {
        throw new Error('이 릴스의 Drive 폴더(' + normalizeText(reelId) + ')에 있는 파일만 연결할 수 있습니다.');
      }
      if (meta.trashed) throw new Error('휴지통에 있는 파일입니다.');
      const ext = (/\.([A-Za-z0-9]+)$/.exec(String(meta.name)) || [])[1];
      if (!ext || M.CLIP_EXTENSIONS.indexOf(ext.toLowerCase()) === -1 || M.CLIP_MIME.indexOf(String(meta.mimeType).toLowerCase()) === -1) {
        throw new Error('MP4 또는 MOV 영상만 연결할 수 있습니다.');
      }
      const size = Number(meta.size);
      if (!(size >= M.CLIP_MIN_BYTES) || size > M.CLIP_MAX_BYTES) throw new Error('영상 크기가 허용 범위(10KB~' + Math.round(M.CLIP_MAX_BYTES / 1048576) + 'MB)를 벗어납니다.');
      registerClipVersion_(ss, normalizeText(reelId), ctx.clip.key, meta, 'drive-app', user, true);
      view = true;
    });
    return { detail: reelDetail_(ss, normalizeText(reelId)), attached: view };
  });
}

/**
 * Records a new version of a clip (under the lock). The previous version is superseded — which voids its
 * approval — and nothing is ever deleted. A file with the same Drive checksum as any version of this reel is
 * refused (an upload we just made is moved to the trash; a file the operator put there is left alone).
 */
function registerClipVersion_(ss, reelId, key, meta, source, user, alreadyLocked) {
  const run = function () {
    const data = loadData_(ss);
    const found = findReel_(data, reelId);
    const blocker = mediaBlocker_(found.row, data.mediaColumnsMissing);
    if (blocker) throw new Error(blocker + ' (업로드한 파일은 Drive의 versions 폴더에 그대로 남아 있습니다.)');
    const clip = clipList_(found.row).filter(function (c) { return c.key === key; })[0];
    if (!clip) throw new Error('이 릴스에 없는 장면 클립입니다: ' + key);
    const store = parseClipStore_(found.row);
    const md5 = String(meta.md5Checksum || '');
    if (!md5) throw new Error('Drive가 파일 체크섬을 아직 계산하지 않았습니다. 잠시 후 다시 시도하세요.');
    const entry = store.clips[key] || (store.clips[key] = { versions: [], current: 0 });
    const same = entry.versions.filter(function (v) { return v.fileId === meta.id; })[0];
    if (same) return { clip: key, version: same.v, invalidated: false, duplicate: false }; // idempotent (retried finish)
    let dupOf = '';
    Object.keys(store.clips).forEach(function (k) {
      store.clips[k].versions.forEach(function (v) {
        if (v.md5 === md5 && !dupOf) dupOf = k + ' v' + v.v;
      });
    });
    if (dupOf) {
      if (source === 'dashboard') {
        try {
          DriveApp.getFileById(meta.id).setTrashed(true);
        } catch (e) {
          // the duplicate stays in versions/; it is not registered anywhere
        }
      }
      throw new Error('같은 영상이 이미 ' + dupOf + '(으)로 올라와 있습니다. 새로 만든 영상을 올리세요.');
    }
    const prev = entry.versions.filter(function (v) { return v.v === entry.current; })[0];
    const invalidated = !!prev && prev.status === 'APPROVED';
    if (prev && prev.status !== 'REJECTED') prev.status = 'SUPERSEDED';
    const v = entry.versions.reduce(function (n, x) { return Math.max(n, x.v); }, 0) + 1;
    entry.versions.push({
      v: v, fileId: meta.id, name: meta.name, mime: meta.mimeType, size: Number(meta.size), md5: md5, source: source,
      uploadedBy: user, uploadedAt: new Date().toISOString(), rightsConfirmed: true, status: 'PENDING_REVIEW',
      reviewedBy: '', reviewedAt: '', approvedHash: '', note: '',
    });
    entry.current = v;
    updateRecord_(data.reelsSheet, found.row._row, { '장면 클립(JSON)': JSON.stringify(store) });
    appendAudit_(ss, [{
      '일시': new Date(), '릴스ID': reelId, '상품ID': found.row['상품ID'], '작업': 'CLIP_UPLOADED',
      '이전 상태': reelStatus(found.row), '새 상태': reelStatus(found.row), '대본 버전': scriptVersionOf(found.row), '영상 버전': videoVersionOf(found.row),
      '작업자': user,
      '메모': key + ' v' + v + ' (' + source + ', 파일 ID ' + meta.id + ', md5 ' + md5 + ', 권리 확인 체크함)' + (invalidated ? ' — 이전 승인 v' + prev.v + ' 무효' : ''),
    }]);
    return { clip: key, version: v, invalidated: invalidated, duplicate: false };
  };
  return alreadyLocked ? run() : withLock_(run);
}

// ---------------------------------------------------------------- review

/**
 * Approves or rejects the CURRENT version of one clip. A rejection needs a reason (what to remake).
 * input: { clip, version, decision: 'APPROVE'|'REJECT', note, expectedStatus, expectedScriptVersion }
 */
function apiReviewClip(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const ctx = mediaContext_(ss, id, input, true);
      const store = parseClipStore_(ctx.found.row);
      const entry = store.clips[ctx.clip.key];
      const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
      if (!cur || Number(input.version) !== cur.v) {
        throw new Error('이 장면에는 그사이 새 버전이 올라왔습니다. 새로고침한 뒤 최신 버전을 검토하세요.');
      }
      const decision = input.decision === 'APPROVE' ? 'APPROVE' : input.decision === 'REJECT' ? 'REJECT' : '';
      if (!decision) throw new Error('승인 또는 반려를 선택하세요.');
      const note = normalizeText(input.note);
      if (decision === 'REJECT' && !note) throw new Error('다시 만들 이유(무엇을 고칠지)를 적어 주세요.');
      if (decision === 'APPROVE') {
        if (cur.rightsConfirmed !== true) throw new Error('권리 확인이 없는 영상은 승인할 수 없습니다.');
        const hash = cellText_(ctx.found.row['승인 대본 해시']);
        if (cur.status === 'APPROVED' && cur.approvedHash === hash) return; // already approved: nothing to do
        // The file must still be the bytes that were uploaded.
        const m = driveFileMeta_(cur.fileId);
        if (m.trashed || String(m.md5Checksum) !== cur.md5) throw new Error('Drive의 파일이 업로드한 뒤 바뀌었거나 휴지통에 있습니다. 다시 업로드하세요.');
        cur.status = 'APPROVED';
        cur.approvedHash = hash;
      } else {
        cur.status = 'REJECTED';
        cur.approvedHash = '';
      }
      cur.reviewedBy = user;
      cur.reviewedAt = new Date().toISOString();
      cur.note = note;
      updateRecord_(ctx.data.reelsSheet, ctx.found.row._row, { '장면 클립(JSON)': JSON.stringify(store) });
      appendAudit_(ss, [{
        '일시': new Date(), '릴스ID': id, '상품ID': ctx.found.row['상품ID'], '작업': decision === 'APPROVE' ? 'CLIP_APPROVED' : 'CLIP_REJECTED',
        '이전 상태': reelStatus(ctx.found.row), '새 상태': reelStatus(ctx.found.row), '대본 버전': scriptVersionOf(ctx.found.row), '영상 버전': videoVersionOf(ctx.found.row),
        '작업자': user, '메모': ctx.clip.key + ' v' + cur.v + (note ? ': ' + note : ''),
      }]);
    });
    return { detail: reelDetail_(ss, id) };
  });
}

// ---------------------------------------------------------------- dashboard view

function mediaView_(row, product, data) {
  const status = reelStatus(row);
  const blocker = mediaBlocker_(row, data.mediaColumnsMissing);
  const visible = RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) !== -1;
  const list = clipList_(row);
  const tracker = parseAssetStatus_(row);
  const registered = {};
  list.forEach(function (c) {
    c.versions.forEach(function (v) { registered[v.fileId] = true; });
  });
  const refIds = referenceLinks_(product.referenceImages);
  return {
    visible: visible,
    blocker: blocker,
    columnsMissing: data.mediaColumnsMissing,
    gated: !!validProductionPlan(row),
    flowUrl: flowUrl_(),
    flowNote: 'Google Flow는 자동화하지 않습니다. 프롬프트를 복사해 Flow에서 직접 만든 뒤 여기에 올리세요.',
    limits: {
      clipMaxMB: Math.round(RF_CONFIG.MEDIA.CLIP_MAX_BYTES / 1048576), chunkBytes: RF_CONFIG.MEDIA.CHUNK_BYTES,
      clipExtensions: RF_CONFIG.MEDIA.CLIP_EXTENSIONS, refMax: RF_CONFIG.MEDIA.REF_PHOTOS_MAX,
      refMaxKB: Math.round(RF_CONFIG.PRODUCTION.MAX_IMAGE_BYTES / 1024),
    },
    references: {
      count: refIds.length, max: RF_CONFIG.MEDIA.REF_PHOTOS_MAX, columnPresent: !!data.referenceColumnPresent,
      items: refIds.map(function (id) { return { fileId: id, url: driveViewUrl(id) }; }),
    },
    clips: list.map(function (c) {
      const cur = c.current;
      return {
        key: c.key, file: c.file, scene: c.scene, part: c.part, parts: c.parts, beat: c.beat, status: c.status,
        current: cur ? { v: cur.v, name: cur.name, size: cur.size, uploadedBy: cur.uploadedBy, uploadedAt: cur.uploadedAt, previewUrl: drivePreviewUrl(cur.fileId), url: driveViewUrl(cur.fileId), note: cur.note } : null,
        versions: c.versions.map(function (v) {
          return { v: v.v, status: v.status, name: v.name, size: v.size, source: v.source, uploadedBy: v.uploadedBy, uploadedAt: v.uploadedAt, reviewedBy: v.reviewedBy, note: v.note, url: driveViewUrl(v.fileId) };
        }),
        attachable: tracker && tracker.clips ? tracker.clips.filter(function (t) {
          return t.file === c.file && t.status === 'UPLOADED' && !registered[t.driveFileId];
        }).map(function (t) { return { fileId: t.driveFileId, name: t.driveName, size: t.sizeBytes }; }) : [],
      };
    }),
    approved: list.filter(function (c) { return c.status === 'APPROVED'; }).length,
    total: list.length,
    allApproved: list.length > 0 && list.every(function (c) { return c.status === 'APPROVED'; }),
  };
}

// ===== StoryboardImages.gs =====
/**
 * Image-First Reels Production v2 — 9:16 Storyboard Images via Gemini 2.5 Flash Image.
 *
 * Workflow:
 * 1. Operator uploads real product reference images through the dashboard (saved in Drive).
 * 2. Gemini analyzes approved script and product photos to plan scenes S1–S5.
 * 3. Uses `gemini-2.5-flash-image` through the Gemini API with reference image bytes to generate 9:16 vertical images.
 * 4. Saves generated images to Google Drive (storyboard/ folder) and displays them in the mobile dashboard.
 * 5. Scene-by-scene image approval, revision requests, and regeneration.
 * 6. Invalidates dependent video approvals (scene clips and reel video approval) whenever an approved image changes.
 * 7. Provides image downloads and motion prompts for manual Google Flow image-to-video generation.
 * 8. Preserves media rights checks, script approval gates, clip reviews, and final FFmpeg rendering.
 */

// ---------------------------------------------------------------- store helpers

function imageKeyOf_(sceneNo) {
  return 'S' + Number(sceneNo);
}

function parseImageStore_(row) {
  try {
    const v = JSON.parse(cellText_(row['장면 이미지(JSON)']) || 'null');
    if (v && typeof v === 'object' && v.images && typeof v.images === 'object') return v;
  } catch (e) {
    // fall through
  }
  return { version: 1, images: {} };
}

/**
 * Status of one scene image for the CURRENT approval: MISSING | PENDING_REVIEW | APPROVED | REJECTED.
 * An approval counts only for the approved-script fingerprint it was given under.
 */
function imageState_(entry, hash) {
  const versions = entry && Array.isArray(entry.versions) ? entry.versions : [];
  const cur = versions.filter(function (v) {
    return v.v === entry.current;
  })[0] || null;
  if (!cur) return { status: 'MISSING', current: null };
  if (cur.status === 'APPROVED' && cur.approvedHash === hash) return { status: 'APPROVED', current: cur };
  if (cur.status === 'REJECTED') return { status: 'REJECTED', current: cur };
  return { status: 'PENDING_REVIEW', current: cur };
}

function storyboardFolder_(product, reelId) {
  const reel = childFolder_(childFolder_(driveRootFolder_(), product.id), reelId);
  return childFolder_(reel, (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.FOLDER_NAME) || 'storyboard');
}

function findStoryboardFolderIfExists_(product, reelId) {
  try {
    const root = driveRootFolder_();
    if (!root) return null;
    const prodIt = root.getFoldersByName(product.id);
    if (!prodIt.hasNext()) return null;
    const prodFolder = prodIt.next();
    const reelIt = prodFolder.getFoldersByName(reelId);
    if (!reelIt.hasNext()) return null;
    const reelFolder = reelIt.next();
    const sbName = (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.FOLDER_NAME) || 'storyboard';
    const sbIt = reelFolder.getFoldersByName(sbName);
    if (!sbIt.hasNext()) return null;
    return sbIt.next();
  } catch (e) {
    return null;
  }
}

function findRecoverableStoryboardFiles_(product, reelId, currentStore) {
  const folder = findStoryboardFolderIfExists_(product, reelId);
  if (!folder) return [];
  const registeredFileIds = {};
  if (currentStore && currentStore.images) {
    Object.keys(currentStore.images).forEach(function (k) {
      const entry = currentStore.images[k];
      if (entry && Array.isArray(entry.versions)) {
        entry.versions.forEach(function (v) {
          if (v && v.fileId) registeredFileIds[v.fileId] = true;
        });
      }
    });
  }
  const recoverable = [];
  try {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();
      if (registeredFileIds[fileId]) continue;
      const name = file.getName();
      const m = name.match(/^(S[1-6])(?:_v(\d+))?\.(png|jpg|jpeg|webp)$/i);
      if (m) {
        const sceneNo = Number(m[1].slice(1));
        const version = m[2] ? Number(m[2]) : 1;
        recoverable.push({
          fileId: fileId,
          fileName: name,
          mimeType: file.getMimeType(),
          sceneNo: sceneNo,
          version: version,
          driveUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
        });
      }
    }
  } catch (e) {
    console.error('[Storyboard] Error scanning recoverable files: ' + (e && e.message ? e.message : String(e)));
  }
  return recoverable;
}

// ---------------------------------------------------------------- prompt builders

/** Motion prompt for Google Flow Image-to-Video handoff (starting from the still storyboard image). */
function buildSceneMotionPrompt_(scene, plan) {
  const ps = plan && plan.scenes ? plan.scenes.filter(function (x) { return x.scene_no === (scene.scene_no || 1); })[0] : null;
  const beat = scene.beat || 'DEMO';
  const camera = (RF_CONFIG.FLOW && RF_CONFIG.FLOW.CAMERA && RF_CONFIG.FLOW.CAMERA[beat]) ||
    'handheld medium shot at eye level, slight natural camera motion';
  const action = ps && ps.scene_prompt ? ps.scene_prompt : (scene.flow_prompt || scene.visual);
  return [
    'Google Flow Image-to-Video · Scene ' + scene.scene_no + ' · ' + beat + ' · 8s vertical 9:16 clip, photorealistic',
    'START FRAME: Use the approved 9:16 storyboard image as the starting visual frame.',
    'CAMERA MOTION: ' + camera + '.',
    'ACTION PROGRESSION: ' + normalizeText(action) + '.',
    ps && ps.continuity ? 'CONTINUITY: ' + normalizeText(ps.continuity) + '.' : '',
    'LIGHTING & STYLE: Real lived-in Korean apartment, natural daylight. Continuous single take, no cuts, no on-screen text, no logos.',
  ].filter(Boolean).join('\n');
}

/** 9:16 Storyboard image generation prompt for gemini-2.5-flash-image with reference images. */
function buildStoryboardImagePrompt_(scene, product, plan, revisionNote) {
  const facts = parseConfirmedFeatures(product.features);
  const ps = plan && plan.scenes ? plan.scenes.filter(function (x) { return x.scene_no === (scene.scene_no || 1); })[0] : null;
  const pv = plan && plan.productVisual ? plan.productVisual : null;
  const lines = [
    'Generate a high-quality photorealistic vertical 9:16 photograph for scene S' + scene.scene_no + ' of an Instagram Reel storyboard.',
    'PRODUCT: ' + normalizeText(product.name) + '.',
    'VERIFIED FACTS: ' + facts.join('; ') + '.',
    'The product MUST strictly match the attached verified product reference image(s) in shape, color, proportions, and details.',
  ];
  if (pv) {
    lines.push('PRODUCT LOOK: ' + pv.summary);
    if (pv.mustMatch && pv.mustMatch.length) lines.push('MUST MATCH: ' + pv.mustMatch.join('; '));
    if (pv.mustNotShow && pv.mustNotShow.length) lines.push('MUST NOT SHOW: ' + pv.mustNotShow.join('; '));
  }
  lines.push(
    'SCENE DETAILS: ' + (ps && ps.scene_prompt ? ps.scene_prompt : scene.visual),
    'NARRATION: "' + scene.narration + '"',
    'ENVIRONMENT: A real, lived-in small Korean apartment, natural daylight from a window, clean composition, high dynamic range.',
    'RULES: Vertical 9:16 aspect ratio portrait frame. NO on-screen text, NO Korean characters, NO English subtitles, NO watermarks, NO brand logos.'
  );
  if (revisionNote) {
    lines.push(
      '',
      'CRITICAL REVISION REQUEST: Please adjust this image to address this feedback: ' + normalizeText(revisionNote)
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- image list & invalidation

/** Storyboard images list for the reel: [{ key, scene, beat, duration_sec, narration, visual, status, current, versions, motionPrompt }]. */
function storyboardImageList_(row, product, plan, recoverableFiles) {
  const store = parseImageStore_(row);
  const hash = cellText_(row['승인 대본 해시']);
  const scenes = approvedScenes_(row);
  return scenes.map(function (s) {
    const key = imageKeyOf_(s.scene_no);
    const entry = store.images[key] || { scene: s.scene_no, current: 0, versions: [] };
    const st = imageState_(entry, hash);
    const cur = st.current;
    const motionPrompt = (cur && cur.motionPrompt) || buildSceneMotionPrompt_(s, plan);
    const rec = (recoverableFiles || []).filter(function (r) { return r.sceneNo === s.scene_no; });
    return {
      key: key,
      scene: s.scene_no,
      beat: s.beat,
      duration_sec: s.duration_sec,
      narration: s.narration,
      visual: s.visual,
      status: st.status,
      recoverable: rec,
      current: cur ? {
        v: cur.v,
        fileId: cur.fileId,
        name: cur.name,
        mime: cur.mime,
        prompt: cur.prompt,
        motionPrompt: cur.motionPrompt || motionPrompt,
        status: cur.status,
        generatedAt: cur.generatedAt,
        reviewedBy: cur.reviewedBy,
        reviewedAt: cur.reviewedAt,
        note: cur.note,
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + cur.fileId,
        url: driveViewUrl(cur.fileId),
        previewUrl: drivePreviewUrl(cur.fileId),
      } : null,
      versions: (entry.versions || []).map(function (v) {
        return {
          v: v.v,
          status: v.status,
          name: v.name,
          fileId: v.fileId,
          generatedAt: v.generatedAt,
          reviewedBy: v.reviewedBy,
          reviewedAt: v.reviewedAt,
          note: v.note,
          url: driveViewUrl(v.fileId),
        };
      }),
      motionPrompt: motionPrompt,
      imagePrompt: buildStoryboardImagePrompt_(s, product, plan),
    };
  });
}

/**
 * Invalidates dependent video approvals whenever an approved storyboard image is changed or rejected.
 * 1) Any approved video clip for that scene is marked SUPERSEDED (voiding clip approval).
 * 2) Any overall VIDEO_APPROVED / READY_TO_PUBLISH status is rolled back to VIDEO_IN_PRODUCTION.
 */
function invalidateDependentVideoApprovals_(ss, data, found, sceneKey, reason, user) {
  let clipInvalidated = false;
  let videoApprovalInvalidated = false;
  const id = normalizeText(found.row['릴스ID']);

  // 1. Invalidate scene clip if it was approved
  const clipStore = parseClipStore_(found.row);
  if (clipStore && clipStore.clips) {
    Object.keys(clipStore.clips).forEach(function (k) {
      if (k === sceneKey || k.indexOf(sceneKey) === 0) {
        const entry = clipStore.clips[k];
        const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
        if (cur && cur.status === 'APPROVED') {
          cur.status = 'SUPERSEDED';
          cur.approvedHash = '';
          cur.note = (cur.note ? cur.note + ' · ' : '') + '스토리보드 이미지 변경으로 클립 승인 무효 (' + reason + ')';
          clipInvalidated = true;
        }
      }
    });
    if (clipInvalidated) {
      updateRecord_(data.reelsSheet, found.row._row, { '장면 클립(JSON)': JSON.stringify(clipStore) });
      found.row['장면 클립(JSON)'] = JSON.stringify(clipStore);
      appendAudit_(ss, [{
        '일시': new Date(),
        '릴스ID': id,
        '상품ID': found.row['상품ID'],
        '작업': 'CLIP_APPROVAL_INVALIDATED',
        '이전 상태': reelStatus(found.row),
        '새 상태': reelStatus(found.row),
        '대본 버전': scriptVersionOf(found.row),
        '영상 버전': videoVersionOf(found.row),
        '작업자': user,
        '메모': sceneKey + ' 스토리보드 이미지 변경으로 클립 승인 취소 (' + reason + ')',
      }]);
    }
  }

  // 2. Invalidate overall video approval if VIDEO_APPROVED or READY_TO_PUBLISH
  const st = reelStatus(found.row);
  if (st === 'VIDEO_APPROVED' || st === 'READY_TO_PUBLISH') {
    const revertTo = 'VIDEO_IN_PRODUCTION';
    const updates = {
      '상태': revertTo,
      '제작 상태': RF_STATUS_LABELS[revertTo],
      '영상 검토자': '',
      '영상 검토일시': '',
      '영상 검토 메모': (cellText_(found.row['영상 검토 메모']) ? cellText_(found.row['영상 검토 메모']) + ' · ' : '') +
        sceneKey + ' 스토리보드 이미지 변경으로 영상 승인 취소 (' + reason + ')',
      '오류': sceneKey + ' 스토리보드 이미지가 변경되었습니다. 새 비디오 클립을 제작·검토하세요.',
    };
    updateRecord_(data.reelsSheet, found.row._row, updates);
    Object.assign(found.row, updates);
    appendAudit_(ss, [{
      '일시': new Date(),
      '릴스ID': id,
      '상품ID': found.row['상품ID'],
      '작업': 'VIDEO_APPROVAL_INVALIDATED',
      '이전 상태': st,
      '새 상태': revertTo,
      '대본 버전': scriptVersionOf(found.row),
      '영상 버전': videoVersionOf(found.row),
      '작업자': user,
      '메모': sceneKey + ' 스토리보드 이미지 변경으로 영상 승인 취소 (' + reason + ')',
    }]);
    videoApprovalInvalidated = true;
  }

  return { clipInvalidated: clipInvalidated, videoApprovalInvalidated: videoApprovalInvalidated };
}

// ---------------------------------------------------------------- image generation core

function generateSceneImageCore_(ss, data, found, scene, refs, plan, revisionNote, user) {
  const reelId = normalizeText(found.row['릴스ID']);
  const key = imageKeyOf_(scene.scene_no);
  const prompt = buildStoryboardImagePrompt_(scene, found.product, plan, revisionNote);
  const motionPrompt = buildSceneMotionPrompt_(scene, plan);

  console.info('[Storyboard] Calling Gemini Image API for scene S' + scene.scene_no + ' with ' + (refs || []).length + ' reference image(s)...');
  // Call gemini-2.5-flash-image with actual reference image bytes
  const res = callGeminiImage_(prompt, refs, { aspectRatio: '9:16' });
  console.info('[Storyboard] Gemini returned image bytes for scene S' + scene.scene_no + ' from model ' + res.model);

  // Save generated image to Drive
  const folder = storyboardFolder_(found.product, reelId);
  const store = parseImageStore_(found.row);
  const entry = store.images[key] || (store.images[key] = { scene: scene.scene_no, current: 0, versions: [] });
  const prev = entry.versions.filter(function (v) { return v.v === entry.current; })[0] || null;
  const prevWasApproved = prev && prev.status === 'APPROVED';

  const nextV = (entry.versions.reduce(function (max, v) { return Math.max(max, v.v); }, 0) || 0) + 1;
  const ext = res.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const fileName = key + '_v' + nextV + '.' + ext;
  const bytes = Utilities.base64Decode(res.data);
  const blob = Utilities.newBlob(bytes, res.mimeType, fileName);
  const file = folder.createFile(blob);
  console.info('[Storyboard] Saved image to Drive: fileId=' + file.getId() + ', fileName=' + fileName);

  if (prev && prev.status !== 'REJECTED') prev.status = 'SUPERSEDED';

  entry.versions.push({
    v: nextV,
    fileId: file.getId(),
    name: fileName,
    mime: res.mimeType,
    prompt: prompt,
    motionPrompt: motionPrompt,
    status: 'PENDING_REVIEW',
    generatedAt: new Date().toISOString(),
    reviewedBy: '',
    reviewedAt: '',
    approvedHash: '',
    note: revisionNote || '',
    model: res.model,
  });
  entry.current = nextV;

  updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
  found.row['장면 이미지(JSON)'] = JSON.stringify(store);
  console.info('[Storyboard] Updated REELS sheet for scene S' + scene.scene_no + ' v' + nextV);

  appendAudit_(ss, [{
    '일시': new Date(),
    '릴스ID': reelId,
    '상품ID': found.row['상품ID'],
    '작업': 'STORYBOARD_IMAGE_GENERATED',
    '이전 상태': reelStatus(found.row),
    '새 상태': reelStatus(found.row),
    '대본 버전': scriptVersionOf(found.row),
    '영상 버전': videoVersionOf(found.row),
    '작업자': user + ' + Gemini (' + res.model + ')',
    '메모': key + ' v' + nextV + ' (Drive ID: ' + file.getId() + ', 9:16)' + (revisionNote ? ' · 수정 반영: ' + revisionNote : ''),
  }]);
  console.info('[Storyboard] Appended AUDIT entry for scene S' + scene.scene_no + ' v' + nextV);

  if (prevWasApproved) {
    invalidateDependentVideoApprovals_(ss, data, found, key, '새 이미지 v' + nextV + ' 생성', user);
  }

  return { key: key, version: nextV, fileId: file.getId() };
}

// ---------------------------------------------------------------- billing & cost estimate

/**
 * Returns the configured per-image cost estimate in USD, or null if unconfigured.
 * Checked from Script Properties (GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE / RF_IMAGE_ESTIMATED_USD_PER_IMAGE)
 * or RF_CONFIG.STORYBOARD.ESTIMATED_USD_PER_IMAGE.
 */
function getStoryboardEstimatedCostPerImage_() {
  const prop = PropertiesService.getScriptProperties().getProperty('GEMINI_IMAGE_ESTIMATED_USD_PER_IMAGE') ||
    PropertiesService.getScriptProperties().getProperty('RF_IMAGE_ESTIMATED_USD_PER_IMAGE');
  if (prop != null && prop !== '') {
    const num = Number(prop);
    if (isFinite(num) && num > 0) return num;
  }
  const cfg = RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.ESTIMATED_USD_PER_IMAGE;
  if (cfg != null && cfg !== '') {
    const num = Number(cfg);
    if (isFinite(num) && num > 0) return num;
  }
  return null;
}

/**
 * Builds a transparent billing summary for generating N storyboard images.
 * Does NOT invent or hardcode a price if no verified estimate is configured.
 */
function storyboardBillingSummary_(imageCount) {
  const count = Math.max(1, Number(imageCount) || 1);
  const model = getGeminiImageModel();
  const perImageUsd = getStoryboardEstimatedCostPerImage_();
  let estimatedTotalUsd = null;
  let costText = 'Cost estimate unavailable';
  if (perImageUsd != null) {
    const total = count * perImageUsd;
    estimatedTotalUsd = total;
    costText = '~$' + ((total < 0.01 && total > 0) ? total.toFixed(4) : total.toFixed(2)) + ' USD (estimate)';
  }
  const warning = '실제 청구 금액은 다를 수 있으며, 실패하거나 재시도된 API 호출에도 요금이 발생할 수 있습니다 (Actual charges may differ and failed/retried calls may incur charges).';
  return {
    imageCount: count,
    model: model,
    perImageUsd: perImageUsd,
    estimatedTotalUsd: estimatedTotalUsd,
    costText: costText,
    warning: warning,
  };
}

// ---------------------------------------------------------------- dashboard view

function storyboardView_(row, product, data) {
  const status = reelStatus(row);
  const intact = isApprovedScriptIntact(row);
  const plan = validProductionPlan(row);
  const refs = parseReferenceImages(product.referenceImages);
  const approvedStatuses = RF_CONFIG.PRODUCTION.PLAN_STATUSES;
  const visible = approvedStatuses.indexOf(status) !== -1;
  const recoverable = (visible && intact)
    ? findRecoverableStoryboardFiles_(product, normalizeText(row['릴스ID']), parseImageStore_(row))
    : [];
  const list = intact ? storyboardImageList_(row, product, plan, recoverable) : [];
  const approvedCount = list.filter(function (img) { return img.status === 'APPROVED'; }).length;
  const totalCount = list.length;
  let blocker = '';
  if (!visible) blocker = '스토리보드 이미지는 대본 승인 후에만 생성할 수 있습니다.';
  else if (!intact) blocker = '승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.';
  else if (!refs.length) blocker = '검증된 제품 이미지가 없습니다. 제품 사진을 먼저 등록하세요.';

  const billing = storyboardBillingSummary_(totalCount || 5);

  return {
    visible: visible,
    canGenerate: visible && intact && refs.length > 0,
    blocker: blocker,
    referencesCount: refs.length,
    images: list,
    recoverable: recoverable,
    approvedCount: approvedCount,
    totalCount: totalCount,
    allApproved: totalCount > 0 && approvedCount === totalCount,
    flowUrl: flowUrl_(),
    flowNote: (RF_CONFIG.STORYBOARD && RF_CONFIG.STORYBOARD.FLOW_NOTE) ||
      '생성된 9:16 이미지를 다운로드하여 Google Flow에 업로드하고, 모션 프롬프트를 입력하여 비디오 클립을 생성하세요.',
    model: getGeminiImageModel(),
    billing: billing,
  };
}

// ---------------------------------------------------------------- public APIs

/**
 * Generates 9:16 storyboard images for scenes S1–S5 using gemini-2.5-flash-image and actual reference images.
 * input: { scene?: number (1..5), confirmedBilling: boolean, expectedStatus, expectedScriptVersion }
 */
function apiGenerateStoryboardImages(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) ||
          (input.expectedScriptVersion != null && Number(input.expectedScriptVersion) !== scriptVersionOf(found.row))) {
        throw staleError_(found.row, status);
      }
      if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
        throw new Error('스토리보드 이미지는 대본 승인 후에만 생성할 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.');
      }
      const refs = loadReferenceImages_(found.product);
      const plan = validProductionPlan(found.row);
      const scenes = approvedScenes_(found.row);
      const targetSceneNo = input.scene ? Number(input.scene) : null;
      const targets = targetSceneNo
        ? scenes.filter(function (s) { return s.scene_no === targetSceneNo; })
        : scenes;

      if (!targets.length) throw new Error('생성할 장면이 없습니다.');

      if (input.confirmedBilling !== true && input.confirmed !== true) {
        throw new Error('유료 API 호출(Gemini 이미지 생성) 확인이 필요합니다. 예상 비용과 청구 주의사항을 확인하고 승인하세요 (Billing confirmation required).');
      }

      targets.forEach(function (scene) {
        generateSceneImageCore_(ss, data, found, scene, refs, plan, input.note || '', user);
      });
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Scene-by-scene approval or revision request for a storyboard image.
 * input: { scene: number, version: number, decision: 'APPROVE' | 'REJECT', note?: string, expectedStatus, expectedScriptVersion }
 */
function apiReviewStoryboardImage(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) ||
          (input.expectedScriptVersion != null && Number(input.expectedScriptVersion) !== scriptVersionOf(found.row))) {
        throw staleError_(found.row, status);
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다.');
      }
      const sceneNo = Number(input.scene);
      const key = imageKeyOf_(sceneNo);
      const store = parseImageStore_(found.row);
      const entry = store.images[key];
      const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
      if (!cur || Number(input.version) !== cur.v) {
        throw new Error('이 장면에는 그사이 새 이미지가 생성되었습니다. 최신 버전을 검토하세요.');
      }
      const decision = input.decision === 'APPROVE' ? 'APPROVE' : input.decision === 'REJECT' ? 'REJECT' : '';
      if (!decision) throw new Error('승인 또는 수정 요청을 선택하세요.');
      const note = normalizeText(input.note);
      if (decision === 'REJECT' && !note) throw new Error('수정 요청 이유(무엇을 고칠지)를 적어 주세요.');

      const prevWasApproved = cur.status === 'APPROVED';
      const hash = cellText_(found.row['승인 대본 해시']);

      if (decision === 'APPROVE') {
        cur.status = 'APPROVED';
        cur.approvedHash = hash;
      } else {
        cur.status = 'REJECTED';
        cur.approvedHash = '';
      }
      cur.reviewedBy = user;
      cur.reviewedAt = new Date().toISOString();
      cur.note = note;

      updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
      found.row['장면 이미지(JSON)'] = JSON.stringify(store);

      appendAudit_(ss, [{
        '일시': new Date(),
        '릴스ID': id,
        '상품ID': found.row['상품ID'],
        '작업': decision === 'APPROVE' ? 'STORYBOARD_IMAGE_APPROVED' : 'STORYBOARD_IMAGE_REJECTED',
        '이전 상태': status,
        '새 상태': status,
        '대본 버전': scriptVersionOf(found.row),
        '영상 버전': videoVersionOf(found.row),
        '작업자': user,
        '메모': key + ' v' + cur.v + (decision === 'APPROVE' ? ' 승인' : ' 수정 요청: ' + note),
      }]);

      if (decision === 'REJECT' && prevWasApproved) {
        invalidateDependentVideoApprovals_(ss, data, found, key, '이미지 승인 취소·수정 요청: ' + note, user);
      }
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Regenerates one scene's 9:16 storyboard image using Gemini 2.5 Flash Image with feedback.
 * input: { scene: number, note?: string, expectedStatus, expectedScriptVersion }
 */
function apiRegenerateStoryboardImage(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) ||
          (input.expectedScriptVersion != null && Number(input.expectedScriptVersion) !== scriptVersionOf(found.row))) {
        throw staleError_(found.row, status);
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다.');
      }
      const sceneNo = Number(input.scene);
      const scenes = approvedScenes_(found.row);
      const scene = scenes.filter(function (s) { return s.scene_no === sceneNo; })[0];
      if (!scene) throw new Error('장면 ' + sceneNo + '을(를) 찾을 수 없습니다.');

      const refs = loadReferenceImages_(found.product);
      const plan = validProductionPlan(found.row);
      const store = parseImageStore_(found.row);
      const entry = store.images[imageKeyOf_(sceneNo)];
      const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
      const revisionNote = normalizeText(input.note) || (cur ? cur.note : '');

      if (input.confirmedBilling !== true && input.confirmed !== true) {
        throw new Error('유료 API 호출(Gemini 이미지 재생성) 확인이 필요합니다. 예상 비용과 청구 주의사항을 확인하고 승인하세요 (Billing confirmation required).');
      }

      generateSceneImageCore_(ss, data, found, scene, refs, plan, revisionNote, user);
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Recovers an already-generated 9:16 storyboard image file from Drive without calling Gemini API (0 tokens, free).
 * input: { scene: number, fileId: string }
 */
function apiRecoverStoryboardImage(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    const sceneNo = Number(input.scene);
    if (!sceneNo || sceneNo < 1 || sceneNo > 6) throw new Error('유효한 장면 번호가 필요합니다.');
    if (!input.fileId) throw new Error('복구할 Drive 파일 ID가 필요합니다.');

    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if (RF_CONFIG.PRODUCTION.PLAN_STATUSES.indexOf(status) === -1) {
        throw new Error('스토리보드 이미지는 대본 승인 후에만 복구할 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      if (!isApprovedScriptIntact(found.row)) {
        throw new Error('승인된 대본과 현재 대본이 다릅니다. "대본 승인 취소" 후 다시 승인하세요.');
      }

      let file;
      try {
        file = DriveApp.getFileById(input.fileId);
      } catch (e) {
        throw new Error('Drive 파일(' + input.fileId + ')을 열 수 없습니다: ' + e.message);
      }
      const mime = file.getMimeType();
      if (!/^image\/(png|jpeg|webp)$/.test(mime)) {
        throw new Error('선택한 파일은 이미지 파일이 아닙니다 (' + mime + ').');
      }

      const plan = validProductionPlan(found.row);
      const scenes = approvedScenes_(found.row);
      const scene = scenes.filter(function (s) { return s.scene_no === sceneNo; })[0];
      if (!scene) throw new Error('장면 S' + sceneNo + '를 대본에서 찾을 수 없습니다.');

      const key = imageKeyOf_(sceneNo);
      const store = parseImageStore_(found.row);
      const entry = store.images[key] || (store.images[key] = { scene: sceneNo, current: 0, versions: [] });

      // If already registered, ensure current points to it
      const already = entry.versions.filter(function (v) { return v.fileId === file.getId(); })[0];
      if (already) {
        entry.current = already.v;
        updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
        found.row['장면 이미지(JSON)'] = JSON.stringify(store);
        return;
      }

      const prev = entry.versions.filter(function (v) { return v.v === entry.current; })[0] || null;
      const prevWasApproved = prev && prev.status === 'APPROVED';
      const nextV = (entry.versions.reduce(function (max, v) { return Math.max(max, v.v); }, 0) || 0) + 1;
      const motionPrompt = buildSceneMotionPrompt_(scene, plan);

      if (prev && prev.status !== 'REJECTED') prev.status = 'SUPERSEDED';

      entry.versions.push({
        v: nextV,
        fileId: file.getId(),
        name: file.getName(),
        mime: mime,
        prompt: '(Drive에서 복구된 이미지)',
        motionPrompt: motionPrompt,
        status: 'PENDING_REVIEW',
        generatedAt: new Date().toISOString(),
        reviewedBy: '',
        reviewedAt: '',
        approvedHash: '',
        note: 'Drive 기존 이미지 복구 (' + file.getName() + ')',
        model: 'recovered-from-drive',
      });
      entry.current = nextV;

      updateRecord_(data.reelsSheet, found.row._row, { '장면 이미지(JSON)': JSON.stringify(store) });
      found.row['장면 이미지(JSON)'] = JSON.stringify(store);

      appendAudit_(ss, [{
        '일시': new Date(),
        '릴스ID': id,
        '상품ID': found.row['상품ID'],
        '작업': 'STORYBOARD_IMAGE_RECOVERED',
        '이전 상태': reelStatus(found.row),
        '새 상태': reelStatus(found.row),
        '대본 버전': scriptVersionOf(found.row),
        '영상 버전': videoVersionOf(found.row),
        '작업자': user,
        '메모': key + ' v' + nextV + ' (Drive ID: ' + file.getId() + ' 복구 · Gemini API 호출 없음)',
      }]);

      if (prevWasApproved) {
        invalidateDependentVideoApprovals_(ss, data, found, key, 'Drive 이미지 v' + nextV + ' 복구', user);
      }
    });

    return { detail: reelDetail_(ss, id) };
  });
}

// ===== RenderJob.gs =====
/**
 * Render jobs: the ONLY way the renderer (Mac now, cloud later) receives a script.
 *
 * A job is issued only for a reel that is VIDEO_IN_PRODUCTION, whose approved script is intact
 * and whose media permission is verified. The job is signed (HMAC-SHA256, Script Property
 * RF_RENDER_SECRET); the renderer refuses unsigned, tampered, expired or unapproved jobs
 * BEFORE making any paid API call (TTS). Pure functions here; signing lives in WebApp.gs.
 */

const RF_RENDER_JOB_VERSION = 1;
const RF_RENDER_JOB_TTL_HOURS = 72;

/** Returns '' if a render job may be issued for this row, otherwise the reason. */
function renderJobBlocker(row, product) {
  const status = reelStatus(row);
  if (status !== 'VIDEO_IN_PRODUCTION') {
    return '렌더 작업은 "영상 제작 중" 상태에서만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status || '상태 없음') + '). 대본 승인 후 "영상 제작 시작"을 누르세요.';
  }
  if (!isApprovedScriptIntact(row)) {
    return '승인된 대본과 현재 대본이 다릅니다. 승인 취소 후 다시 승인하세요.';
  }
  if (!isPermissionApproved(product.permission)) {
    return 'PRODUCTS의 "영상 사용 허가 상태"가 확인되지 않았습니다.';
  }
  // Reels with a Gemini production plan: every Flow clip must be APPROVED in the dashboard (Media.gs).
  return clipGateBlocker_(row);
}

/**
 * Job payload (as a JSON string, so the signature covers exact bytes).
 * Contains only what rendering needs: no affiliate URL, no API keys.
 */
function buildRenderJobPayload(row, product, issuedAtIso, ttlHours) {
  const blocker = renderJobBlocker(row, product);
  if (blocker) throw new Error(blocker);
  const cells = {};
  RF_SCRIPT_FIELDS.forEach(function (f) {
    cells[f] = cellText_(row[f]);
  });
  const issued = new Date(issuedAtIso);
  const expires = new Date(issued.getTime() + (ttlHours || RF_RENDER_JOB_TTL_HOURS) * 3600 * 1000);
  return JSON.stringify({
    jobVersion: RF_RENDER_JOB_VERSION,
    reelId: cellText_(row['릴스ID']),
    productId: cellText_(row['상품ID']),
    productName: normalizeText(product.name),
    status: 'VIDEO_IN_PRODUCTION',
    scriptVersion: scriptVersionOf(row),
    approvedScriptVersion: parseInt(cellText_(row['승인 대본 버전']), 10),
    approvedHash: cellText_(row['승인 대본 해시']),
    nextVideoVersion: videoVersionOf(row) + 1,
    permission: normalizeText(product.permission),
    // What the renderer needs for the shot list; facts are already public product claims.
    product: {
      name: normalizeText(product.name),
      facts: parseConfirmedFeatures(product.features),
      appearance: normalizeText(product.appearance),
    },
    flowPrompts: (function () {
      try {
        const v = JSON.parse(cellText_(row['Flow 장면 프롬프트']) || '[]');
        if (Array.isArray(v) && v.length) return v;
      } catch (e) {
        // fall through: approved before prompts existed → generate now (free)
      }
      return buildFlowScenePrompts(row, product);
    })(),
    // Gemini's production plan (only if it belongs to THIS approved script): TTS rate/pauses, cuts,
    // subtitle emphasis, the product's visual spec and what to check in the finished video.
    productionPlan: validProductionPlan(row),
    // Every approved clip with its Drive file ID and checksum. The renderer refuses a job whose plan has no
    // complete manifest, and checks each local clip against it before any paid step.
    clipManifest: buildClipManifest_(row),
    // Verified product images (Drive file IDs) the renderer's final check compares the video against.
    referenceImages: parseReferenceImages(product.referenceImages),
    // Where the Flow clips live in Google Drive (tracked by the dashboard), for `fetch-clips`.
    drive: (function () {
      const a = parseAssetStatus_(row);
      if (!a || a.approvedHash !== cellText_(row['승인 대본 해시'])) return null;
      return {
        folderId: a.folderId,
        files: a.clips.filter(function (c) { return c.status === 'UPLOADED'; }).map(function (c) {
          return { clip: c.file, name: c.driveName, id: c.driveFileId, size: c.sizeBytes };
        }),
      };
    })(),
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
    script: cells,
  });
}

/** Hex encoding of a signed byte array (Apps Script Utilities returns -128..127). */
function bytesToHex_(bytes) {
  return bytes
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

// ===== StudioBridge.gs =====
/** Studio snapshot bridge. Keeps legacy REELS/PRODUCTS untouched.
 * Deploy a new Apps Script web app running as owner with access Anyone.
 * Set RF_STUDIO_BRIDGE_TOKEN (random >=32 chars) in Script Properties.
 * Requests are authenticated with this token in POST JSON (never browser-side).
 * Snapshots are mirrored to STUDIO_EPISODES, not interpreted as legacy REELS rows.
 */
function doPost(e) {
  try {
    const input = JSON.parse(e && e.postData && e.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('RF_STUDIO_BRIDGE_TOKEN') || '';
    if (secret.length < 32 || String(input.token || '') !== secret) throw new Error('Unauthorized bridge request');
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('STUDIO_EPISODES') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('STUDIO_EPISODES');
    if (!sheet.getLastRow()) sheet.appendRow(['Episode ID','Updated At','Snapshot JSON','Snapshot Hash']);
    if (input.action === 'health') return studioBridgeJson_({ ok:true, status:'ready' });
    if (input.action === 'list') {
      const rows = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,4).getValues() : [];
      return studioBridgeJson_({ok:true,episodes:rows.map(function(r){return {id:r[0],updatedAt:r[1],hash:r[3]};})});
    }
    if (input.action === 'get') {
      const row = studioBridgeFind_(sheet, String(input.id || ''));
      return studioBridgeJson_({ok:true,snapshot:row ? JSON.parse(sheet.getRange(row,3).getValue()) : null});
    }
    if (input.action !== 'put') throw new Error('Unsupported bridge action');
    const snapshot = input.snapshot;
    if (!snapshot || !/^[A-Za-z0-9_-]{1,41}$/.test(String(snapshot.id || ''))) throw new Error('Invalid episode');
    const payload = JSON.stringify(snapshot);
    if (payload.length > 45000) throw new Error('Snapshot exceeds Sheets cell limit');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const row = studioBridgeFind_(sheet, snapshot.id) || sheet.getLastRow()+1;
      sheet.getRange(row,1,1,4).setValues([[snapshot.id, new Date().toISOString(), payload, String(input.hash || '')]]);
    } finally { lock.releaseLock(); }
    return studioBridgeJson_({ok:true,id:snapshot.id});
  } catch(err) { return studioBridgeJson_({ok:false,error:String(err.message || err)}); }
}
function studioBridgeFind_(sheet,id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  const ids = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
  for(let i=0;i<ids.length;i++) if(String(ids[i][0])===id) return i+2;
  return 0;
}
function studioBridgeJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== Code.gs =====
/**
 * Reels Factory — Google Sheets menu and workflow orchestration.
 *
 * @OnlyCurrentDoc
 */

/**
 * Simple trigger. If this Apps Script project already has its own onOpen(), delete this one
 * and add the line `addReelsFactoryMenu();` inside the existing onOpen() instead.
 */
function onOpen() {
  addReelsFactoryMenu();
}

function addReelsFactoryMenu() {
  SpreadsheetApp.getUi()
    .createMenu('릴스 팩토리')
    .addItem('선택한 상품으로 훅 5개 + 대본 생성', 'generateReelsForSelectedProduct')
    .addSeparator()
    .addItem('시트 준비 (REELS / PERFORMANCE / LOG / AUDIT)', 'setupSheets')
    .addItem('iPhone 대시보드 링크 보기', 'showDashboardLink')
    .addItem('렌더 키 보기 (Mac 렌더러 설정용)', 'showRenderSecret')
    .addItem('Gemini API 키 설정', 'promptForGeminiApiKey')
    .addItem('Gemini 모델 확인 (무료)', 'showGeminiModelCheck')
    .addItem('코드 버전 확인 (대시보드와 비교)', 'showCodeVersion')
    .addSeparator()
    .addItem('테스트: PRD-001 오프라인 검증', 'runOfflineFixtureTest')
    .addItem('테스트: PRD-001 Gemini 실제 호출 (시트에 쓰지 않음)', 'runLiveGeminiTestPRD001')
    .addToUi();
}

/**
 * Creates missing REELS / PERFORMANCE / LOG sheets and verifies PRODUCTS headers.
 * Never edits PRODUCTS. For existing REELS / PERFORMANCE / LOG sheets, missing headers are
 * appended to the right end of row 1 only after the user confirms.
 */
function setupSheets() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = [];
  try {
    const fields = RF_CONFIG.PRODUCT_FIELDS;
    const productHeaders = Object.keys(fields).map(function (k) {
      return fields[k];
    });
    const productsMissing = missingHeaders_(getProductsSheet_(ss), productHeaders);
    report.push(
      productsMissing.length
        ? '✗ PRODUCTS: 헤더 없음 → ' + productsMissing.join(', ') + ' (PRODUCTS는 자동 수정하지 않습니다. 1행 헤더 이름을 확인하세요.)'
        : '✓ PRODUCTS: 필요한 헤더 9개 확인'
    );

    const managed = [
      [RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS.concat(RF_CONFIG.REELS_OPTIONAL_HEADERS)],
      [RF_CONFIG.SHEETS.PERFORMANCE, RF_CONFIG.PERFORMANCE_HEADERS],
      [RF_CONFIG.SHEETS.LOG, RF_CONFIG.LOG_HEADERS],
      [RF_CONFIG.SHEETS.AUDIT, RF_CONFIG.AUDIT_HEADERS],
    ];
    const toFix = [];
    managed.forEach(function (m) {
      const existing = findSheet_(ss, m[0]);
      if (!existing || (existing.getLastRow() === 0 && existing.getLastColumn() === 0)) {
        ensureSheet_(ss, m[0], m[1]);
        report.push('✓ ' + m[0] + ': ' + (existing ? '빈 시트에 헤더 작성' : '새로 만듦'));
        return;
      }
      const missing = missingHeaders_(existing, m[1]);
      if (missing.length) toFix.push({ sheet: existing, headers: m[1], missing: missing });
      else report.push('✓ ' + m[0] + ': 기존 시트 확인');
    });

    if (toFix.length) {
      const answer = ui.alert(
        '기존 시트에 헤더 추가',
        toFix
          .map(function (t) {
            return t.sheet.getName() + ': ' + t.missing.join(', ');
          })
          .join('\n') +
          '\n\n위 헤더를 각 시트 1행 오른쪽 끝 빈 칸에 추가할까요? 기존 셀과 데이터는 바뀌지 않습니다.',
        ui.ButtonSet.YES_NO
      );
      toFix.forEach(function (t) {
        if (answer === ui.Button.YES) {
          appendMissingHeaders_(t.sheet, t.headers);
          report.push('✓ ' + t.sheet.getName() + ': 헤더 추가 → ' + t.missing.join(', '));
        } else {
          report.push('✗ ' + t.sheet.getName() + ': 헤더 없음 → ' + t.missing.join(', '));
        }
      });
    }
    report.push(registerSelfAsReviewer_());
    ui.alert('시트 준비 결과\n\n' + report.join('\n'));
  } catch (e) {
    logEvent_('ERROR', 'setupSheets', '', e.message, e.stack);
    ui.alert('시트 준비 실패\n\n' + report.concat([e.message]).join('\n'));
  }
}

/** Shows the pasted code's version; the dashboard header shows the deployed one. They must match. */
function showCodeVersion() {
  SpreadsheetApp.getUi().alert(
    '코드 버전: ' + RF_CONFIG.CODE_VERSION + '\n\n' +
      'iPhone 대시보드 맨 위에 같은 버전이 보여야 합니다. 다르면 웹 앱이 새 코드로 배포되지 않은 것입니다: ' +
      'Apps Script → 배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포.'
  );
}

/** Stores the Gemini API key in Script Properties (never in the sheet or Git). */
function promptForGeminiApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Gemini API 키 설정',
    'Google AI Studio에서 발급한 API 키를 입력하세요. 키는 스크립트 속성(GEMINI_API_KEY)에만 저장됩니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = normalizeText(res.getResponseText());
  if (!key) {
    ui.alert('빈 값은 저장하지 않았습니다.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('GEMINI_API_KEY 저장 완료. (모델 변경은 스크립트 속성 GEMINI_MODEL로 설정)');
}

/**
 * One targeted Gemini call that rewrites only plan.ids of the five hooks (see hookRevisionPlan) and
 * merges each rewrite only if it is better (mergeHookRevisions). Returns the merge result
 * { payload, revised, kept }, or null if the call failed (the caller keeps what it had).
 */
function reviseHooks_(product, payload, plan, avoidHooks, source, opts) {
  let raw = '';
  try {
    raw = callGemini_(buildHookRevisionPrompt(product, payload, plan, avoidHooks), hookRevisionSchema(plan.ids));
  } catch (e) {
    logEvent_('WARN', source, product.id, '훅 ' + plan.ids.join(', ') + ' 다듬기 호출 실패 — 기존 훅을 유지합니다.', String(e && e.message || e));
    return null;
  }
  const parsed = parseModelJson(raw);
  if (parsed.error) {
    logEvent_('WARN', source, product.id, '훅 다듬기 응답을 읽을 수 없습니다 — 기존 훅을 유지합니다.', parsed.error + '\n\n--- 원본 응답 ---\n' + raw);
    return null;
  }
  const merged = mergeHookRevisions(payload, parsed.value, product, avoidHooks, plan.ids, opts);
  logEvent_('INFO', source, product.id,
    '훅만 다듬기 (Gemini 1회): ' + (merged.revised.length ? merged.revised.join(', ') + ' 반영' : '반영 없음') +
      (merged.kept.length ? ' · ' + merged.kept.join(', ') + ' 유지' : ''),
    Object.keys(plan.problems).map(function (id) { return id + ': ' + plan.problems[id].join(' / '); }).join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
  return merged;
}

/**
 * Generates the five hooks and the script with as few Gemini calls as possible, then returns
 * { records, attempts, calls }. Throws with all validation errors otherwise.
 *  - Hook style issues are warnings, not failures: a safe hook with a warning is kept for the operator.
 *  - When only some non-recommended hooks have problems, one targeted call rewrites just those hooks
 *    (hard errors always; style warnings when HOOK_STYLE.AUTO_REVISE_WEAK) instead of regenerating all.
 *  - A full corrective retry happens only for script / set errors or a hard error on the recommended hook.
 *  - Never more than MAX_GEMINI_CALLS_PER_RUN calls.
 */
function generateValidatedRecords_(product, existingIds, existingKeywords, previousHooks) {
  const vopts = { avoidHooks: previousHooks || [] };
  const maxCalls = RF_CONFIG.MAX_GEMINI_CALLS_PER_RUN || RF_CONFIG.MAX_GEMINI_ATTEMPTS;
  let calls = 0;
  let lastErrors = [];
  let lastRaw = '';
  const attempts = [];
  const meta = function () {
    return { model: RF_GEMINI_STATE.lastModel || getGeminiModel(), generatedAt: new Date() };
  };
  for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && calls < maxCalls; attempt++) {
    // A retry gets the exact failing claims and the previous response, so Gemini fixes only those.
    let raw = callGemini_(buildGeminiPrompt(product, lastErrors, lastRaw, vopts.avoidHooks));
    calls++;
    let result = prepareReelRecords(product, raw, existingIds, existingKeywords, meta(), vopts);
    // Only some hooks need work → rewrite just those hooks (one call), keep everything else.
    const plan = hookRevisionPlan(result.validation, RF_CONFIG.HOOK_STYLE.AUTO_REVISE_WEAK);
    if (plan && plan.ids.length && calls < maxCalls) {
      calls++;
      const merged = reviseHooks_(product, result.payload, plan, vopts.avoidHooks, 'validateGemini');
      if (merged && merged.revised.length) {
        const mergedRaw = JSON.stringify(merged.payload);
        const again = prepareReelRecords(product, mergedRaw, existingIds, existingKeywords, meta(), vopts);
        // Use the rewrite when it passes; a passing original is never replaced by a failing merge.
        if (!again.errors.length || result.errors.length) {
          result = again;
          raw = mergedRaw;
        }
      }
    }
    if (!result.errors.length) {
      const warned = Object.keys(result.validation.warnings || {}).filter(function (id) {
        return result.validation.warnings[id].length;
      });
      if (warned.length) {
        logEvent_('INFO', 'validateGemini', product.id, '스타일 경고가 있는 훅 ' + warned.join(', ') + ' — 대시보드에 표시, 운영자가 판단합니다.',
          warned.map(function (id) { return id + ': ' + result.validation.warnings[id].join(' / '); }).join('\n'));
      }
      return { records: result.records, attempts: attempt, calls: calls };
    }
    attempts.push(result.attempt);
    lastErrors = result.errors;
    lastRaw = raw;
    logEvent_(
      attempt < RF_CONFIG.MAX_GEMINI_ATTEMPTS ? 'WARN' : 'ERROR',
      'validateGemini',
      product.id,
      '검증 실패 (시도 ' + attempt + '/' + RF_CONFIG.MAX_GEMINI_ATTEMPTS + '): ' + result.errors.length + '건',
      result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw
    );
    // Free rescue: if every position has a reel that passed in some attempt, use those.
    const combined = attempts.length > 1 ? combineValidReels(attempts, product, null, vopts) : null;
    if (combined) {
      logEvent_('INFO', 'validateGemini', product.id, '시도별로 검증을 통과한 대본을 합쳐 사용합니다 (추가 호출 없음).', '');
      return { records: buildReelRecords(product, combined.reels, existingIds, existingKeywords, meta()), attempts: attempt, calls: calls };
    }
  }
  throw new Error(
    'Gemini 응답이 검증에 실패했습니다 (Gemini 호출 ' + calls + '회). REELS에는 아무것도 기록하지 않았습니다.\n' +
      '자세한 내용은 LOG 시트를 확인하세요.\n\n- ' + lastErrors.slice(0, 8).join('\n- ')
  );
}

/** Document lock (falls back to the script lock where no document lock is available). */
function getLock_() {
  return LockService.getDocumentLock() || LockService.getScriptLock();
}

/** Email of the Google account running this call ('' if Google does not reveal it). */
function currentUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/** 1-based PRODUCTS row of a product ID; throws if missing or duplicated. */
function findProductRow_(productsSheet, productId) {
  const map = requireHeaders_(productsSheet, [RF_CONFIG.PRODUCT_FIELDS.id]);
  const lastRow = productsSheet.getLastRow();
  const ids = lastRow < 2 ? [] : productsSheet.getRange(2, colOf_(map, RF_CONFIG.PRODUCT_FIELDS.id), lastRow - 1, 1).getValues();
  const rows = [];
  ids.forEach(function (r, i) {
    if (normalizeText(r[0]) === productId) rows.push(i + 2);
  });
  if (!rows.length) throw new Error('PRODUCTS에서 상품ID "' + productId + '"를 찾을 수 없습니다.');
  if (rows.length > 1) throw new Error('PRODUCTS에 상품ID "' + productId + '"가 여러 번 있습니다. 중복을 정리한 뒤 다시 실행하세요.');
  return rows[0];
}

/**
 * Shared by the Sheets menu and the dashboard. Caller must hold getLock_().
 * Returns { needsConfirm: n } if the product already has n reels and allowAdditional is false,
 * otherwise { ids, product } after writing 3 validated REELS rows and AUDIT entries.
 */
function generateScriptsForProduct_(ss, rowNumber, options) {
  const productsSheet = getProductsSheet_(ss);
  const product = readProduct_(productsSheet, rowNumber);

  const productErrors = validateProduct(product);
  if (productErrors.length) {
    throw new Error('PRODUCTS ' + product.rowNumber + '행을 수정하세요:\n- ' + productErrors.join('\n- '));
  }
  findProductRow_(productsSheet, product.id); // duplicate 상품ID check

  const reelsSheet = ensureSheet_(ss, RF_CONFIG.SHEETS.REELS, RF_CONFIG.REELS_HEADERS, RF_CONFIG.REELS_OPTIONAL_HEADERS);
  // The five hooks and the operator's choice need their columns — checked before paying for Gemini.
  const hookMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HOOK_HEADERS);
  if (hookMissing.length) {
    throw new Error('REELS에 훅 저장 열이 없습니다 (' + hookMissing.join(', ') + '). "릴스 팩토리 → 시트 준비"를 먼저 실행하세요 — 기존 데이터는 바뀌지 않고 1행 오른쪽에 열만 추가됩니다. Gemini는 호출하지 않았습니다.');
  }
  const reelsMap = getHeaderMap_(reelsSheet);
  const existingIds = readColumn_(reelsSheet, reelsMap, '릴스ID');
  const existingKeywords = readRecords_(reelsSheet, ['ManyChat 키워드', '상품ID'])
    .map(function (r) {
      return { keyword: normalizeText(r['ManyChat 키워드']), productId: normalizeText(r['상품ID']) };
    })
    .filter(function (r) {
      return r.keyword;
    });
  const dupIds = findDuplicates(existingIds);
  if (dupIds.length) {
    throw new Error('REELS에 중복된 릴스ID가 있습니다: ' + dupIds.join(', ') + '. 정리한 뒤 다시 실행하세요.');
  }
  // A keyword may repeat within one product (same link) but must never point to two products.
  const byKeyword = {};
  existingKeywords.forEach(function (k) {
    const key = k.keyword.toUpperCase();
    (byKeyword[key] = byKeyword[key] || {})[k.productId] = true;
  });
  const clashes = Object.keys(byKeyword).filter(function (k) {
    return Object.keys(byKeyword[k]).length > 1;
  });
  if (clashes.length) {
    throw new Error('REELS에서 같은 ManyChat 키워드가 여러 상품에 쓰이고 있습니다: ' + clashes.join(', ') + '. 정리한 뒤 다시 실행하세요.');
  }

  // Check the product keyword before paying for Gemini: it must not belong to another product.
  const productKeyword = normalizeText(product.keyword).toUpperCase();
  if (productKeyword) {
    const owner = existingKeywords.filter(function (k) {
      return k.keyword.toUpperCase() === productKeyword && k.productId !== product.id;
    })[0];
    if (owner) {
      throw new Error('ManyChat 키워드 "' + product.keyword + '"가 이미 다른 릴스·상품(' + owner.productId + ')에서 쓰이고 있습니다. 상품마다 다른 키워드를 쓰세요.');
    }
  }

  const already = existingIds.filter(function (id) {
    return id.indexOf(product.id + '-R') === 0;
  }).length;
  if (already > 0 && !options.allowAdditional) return { needsConfirm: already, product: product };

  // Hooks this product already has: Gemini is asked not to repeat them, and exact repeats are refused.
  const previousHooks = [];
  readRecords_(reelsSheet, ['후킹', '상품ID', '훅 후보(JSON)'])
    .filter(function (r) {
      return normalizeText(r['상품ID']) === product.id;
    })
    .forEach(function (r) {
      if (normalizeText(r['후킹'])) previousHooks.push(normalizeText(r['후킹']));
      parseHookSet(r['훅 후보(JSON)']).hooks.forEach(function (h) {
        if (previousHooks.indexOf(h.text) === -1) previousHooks.push(h.text);
      });
    });
  const result = generateValidatedRecords_(product, existingIds, existingKeywords, previousHooks);
  appendRecords_(reelsSheet, result.records, RF_SCRIPT_FIELDS);

  const now = new Date();
  const actor = options.actor || '';
  const audit = [
    {
      '일시': now,
      '상품ID': product.id,
      '작업': 'PRODUCT_SUBMITTED',
      '작업자': actor,
      '메모': '터치포인트 1: 상품 선택 → 대본 생성 요청',
      '스냅샷(JSON)': JSON.stringify({
        상품명: normalizeText(product.name),
        확인된기능: parseConfirmedFeatures(product.features),
        제휴링크입력: !affiliateUrlError(product.affiliateUrl),
        영상사용허가: normalizeText(product.permission),
      }),
    },
  ];
  result.records.forEach(function (r) {
    const snap = {};
    RF_SCRIPT_FIELDS.forEach(function (f) {
      snap[f] = r[f];
    });
    audit.push({
      '일시': now,
      '릴스ID': r['릴스ID'],
      '상품ID': product.id,
      '작업': 'SCRIPTS_GENERATED',
      '새 상태': r['상태'],
      '대본 버전': 1,
      '영상 버전': 0,
      '작업자': 'Gemini (' + r['생성 모델'] + ')',
      '스냅샷(JSON)': JSON.stringify(snap),
    });
  });
  appendAudit_(ss, audit);

  const ids = result.records.map(function (r) {
    return r['릴스ID'];
  });
  logEvent_('INFO', 'generateReels', product.id, '릴스 대본 생성 완료: ' + ids.join(', '), '시도 횟수: ' + result.attempts);
  return { ids: ids, product: product };
}

/** Menu action: PRODUCTS selected row → Gemini → 3 validated REELS rows. */
function generateReelsForSelectedProduct() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  const range = active.getActiveRange();

  const productsTab = findSheet_(ss, RF_CONFIG.SHEETS.PRODUCTS);
  const onProducts = productsTab && active.getName() === productsTab.getName();
  if (!onProducts || !range || range.getNumRows() !== 1 || range.getRow() < 2) {
    ui.alert('PRODUCTS 시트에서 상품 행 하나(2행 이상)를 선택한 뒤 다시 실행하세요.');
    return;
  }

  const lock = getLock_();
  if (!lock.tryLock(30000)) {
    ui.alert('다른 생성 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }

  let productId = '';
  try {
    const opts = { actor: currentUserEmail_(), allowAdditional: false };
    let res = generateScriptsForProduct_(ss, range.getRow(), opts);
    productId = res.product.id;
    if (res.needsConfirm) {
      const ok = ui.alert(
        '추가 생성 확인',
        productId + '에 이미 릴스 ' + res.needsConfirm + '개가 있습니다. 새 훅 5개와 대본을 추가로 생성할까요?',
        ui.ButtonSet.YES_NO
      );
      if (ok !== ui.Button.YES) return;
      opts.allowAdditional = true;
      ss.toast('Gemini로 ' + productId + ' 대본 생성 중…', '릴스 팩토리', 60);
      res = generateScriptsForProduct_(ss, range.getRow(), opts);
    }

    let msg = 'REELS에 ' + res.ids.length + '개 행을 추가했습니다:\n' + res.ids.join('\n') +
      '\n\n다음 단계: iPhone 대시보드(또는 REELS 시트)에서 대본을 검토·승인하세요. 승인 전에는 영상 작업이 시작되지 않습니다.';
    if (!isPermissionApproved(res.product.permission)) msg += '\n\n⚠ ' + RF_CONFIG.PERMISSION_UNVERIFIED_NOTE;
    ui.alert(msg);
  } catch (e) {
    logEvent_('ERROR', 'generateReels', productId, e.message, e.stack);
    ui.alert('릴스 대본 생성 실패\n\n' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/** Validates the bundled PRD-001 fixture response without calling Gemini or writing to sheets. */
function runOfflineFixtureTest() {
  const result = prepareReelRecords(
    FIXTURE_PRD_001_PRODUCT,
    JSON.stringify(FIXTURE_PRD_001_GEMINI_RESPONSE),
    [],
    [],
    { model: 'fixture', generatedAt: new Date() }
  );
  const msg = result.errors.length
    ? '실패:\n- ' + result.errors.join('\n- ')
    : '통과: ' + result.records.map(function (r) {
        return r['릴스ID'] + ' / ' + r['ManyChat 키워드'];
      }).join(', ');
  SpreadsheetApp.getUi().alert('PRD-001 오프라인 테스트\n\n' + msg);
}

/** Calls Gemini for the PRD-001 fixture and validates the result. Writes only to LOG. */
function runLiveGeminiTestPRD001() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = generateValidatedRecords_(FIXTURE_PRD_001_PRODUCT, [], []);
    logEvent_('INFO', 'liveTestPRD001', 'PRD-001', '실제 Gemini 테스트 통과 (시도 ' + result.attempts + ')',
      JSON.stringify(result.records, null, 2));
    ui.alert('PRD-001 Gemini 테스트 통과 (시도 ' + result.attempts + '회).\n결과는 LOG 시트에 기록했습니다. REELS에는 쓰지 않았습니다.');
  } catch (e) {
    logEvent_('ERROR', 'liveTestPRD001', 'PRD-001', e.message, e.stack);
    ui.alert('PRD-001 Gemini 테스트 실패\n\n' + e.message);
  }
}

// ===== WebApp.gs =====
/**
 * iPhone-first approval dashboard (Apps Script HTML Service web app).
 *
 * Access model (see docs/iphone-dashboard.md):
 * - Deploy as web app with "Execute as: User accessing the web app" and "Who has access: Only myself"
 *   (or "Anyone with a Google account" for a team), so Google signs the user in.
 * - Every api* function additionally checks the signed-in email against Script Property RF_REVIEWERS.
 * - The Gemini API key never leaves the server. Affiliate URLs are returned only in the publishing pack
 *   of a READY_TO_PUBLISH reel.
 * - Google Sheets stays the system of record: every decision is written to REELS and AUDIT.
 */

const RF_CLIENT_ACTIONS = [
  'APPROVE_SCRIPT',
  'REQUEST_SCRIPT_CHANGES',
  'EDIT_SCRIPT',
  'REJECT_SCRIPT',
  'REOPEN_SCRIPT',
  'CONFIRM_MEDIA_RIGHTS',
  'START_VIDEO',
  'REGISTER_VIDEO',
  'MARK_VIDEO_FAILED',
  'APPROVE_VIDEO',
  'REQUEST_VIDEO_CHANGES',
  'REJECT_VIDEO',
  'MARK_READY_TO_PUBLISH',
  'CONFIRM_PUBLISHED',
  'CONFIRM_MANYCHAT',
  'GENERATE_STORYBOARD_IMAGES',
  'REVIEW_STORYBOARD_IMAGE',
  'REGENERATE_STORYBOARD_IMAGE',
  'RECOVER_STORYBOARD_IMAGE',
];

function doGet() {
  let html;
  try {
    requireReviewer_();
    html = typeof RF_DASHBOARD_HTML !== 'undefined'
      ? RF_DASHBOARD_HTML
      : HtmlService.createHtmlOutputFromFile('Dashboard').getContent();
  } catch (e) {
    html = '<!doctype html><meta charset="utf-8"><body style="font:16px -apple-system,sans-serif;padding:24px">' +
      '<h2>접근할 수 없습니다</h2><p>' + escapeHtml_(e.message) + '</p></body>';
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('릴스 팩토리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function reviewerList_() {
  const raw = PropertiesService.getScriptProperties().getProperty(RF_CONFIG.REVIEWERS_PROPERTY) || '';
  return raw
    .split(',')
    .map(function (e) {
      return normalizeText(e).toLowerCase();
    })
    .filter(function (e) {
      return e.length > 0;
    });
}

/** Throws unless the signed-in Google account is listed in RF_REVIEWERS. Returns the email. */
function requireReviewer_() {
  const list = reviewerList_();
  if (!list.length) {
    throw new Error('검토자가 등록되지 않았습니다. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행해 본인 계정을 등록하세요.');
  }
  const email = currentUserEmail_().toLowerCase();
  if (!email) {
    throw new Error('Google 계정을 확인할 수 없습니다. 웹 앱을 "실행 사용자: 웹 앱에 액세스하는 사용자"로 배포했는지 확인하세요.');
  }
  if (list.indexOf(email) === -1) {
    throw new Error('이 계정(' + email + ')은 검토 권한이 없습니다. 소유자가 스크립트 속성 RF_REVIEWERS에 추가해야 합니다.');
  }
  return email;
}

/** Adds the current user to RF_REVIEWERS. Returns a report line for 시트 준비. */
function registerSelfAsReviewer_() {
  const email = currentUserEmail_().toLowerCase();
  if (!email) return '✗ 대시보드 검토자: 현재 Google 계정 이메일을 확인할 수 없습니다.';
  const list = reviewerList_();
  if (list.indexOf(email) === -1) {
    list.push(email);
    PropertiesService.getScriptProperties().setProperty(RF_CONFIG.REVIEWERS_PROPERTY, list.join(','));
  }
  return '✓ 대시보드 검토자: ' + list.join(', ');
}

/** Menu: shows the deployed dashboard URL to open on iPhone. */
function showDashboardLink() {
  const ui = SpreadsheetApp.getUi();
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }
  if (!url) {
    ui.alert(
      '대시보드가 아직 배포되지 않았습니다.\n\nApps Script 편집기 → 배포 → 새 배포 → 유형: 웹 앱\n' +
        '실행 사용자: 웹 앱에 액세스하는 사용자 / 액세스 권한: 나만\n\n자세한 방법: docs/iphone-dashboard.md'
    );
    return;
  }
  const safe = escapeHtml_(url);
  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<p style="font:14px sans-serif">iPhone Safari에서 이 링크를 열고 <b>공유 → 홈 화면에 추가</b>를 누르세요.</p>' +
        '<p style="font:14px sans-serif;word-break:break-all"><a href="' + safe + '" target="_blank">' + safe + '</a></p>'
    ).setWidth(420).setHeight(180),
    'iPhone 대시보드 링크'
  );
}

/** Wraps an API call: auth check, error → { ok:false, error }, and Date → string for google.script.run. */
function api_(fn) {
  try {
    const user = requireReviewer_();
    const result = fn(user);
    return JSON.parse(JSON.stringify(Object.assign({ ok: true, user: user }, result || {})));
  } catch (e) {
    const errText = (e && e.stack) ? e.stack : (e && e.message ? e.message : String(e));
    console.error('[API Error] ' + errText);
    logEvent_('ERROR', 'api', '', (e && e.message) || String(e), errText);
    return { ok: false, error: e.message };
  }
}

function productFromRecord_(rec) {
  const f = Object.assign({}, RF_CONFIG.PRODUCT_FIELDS, RF_CONFIG.PRODUCT_OPTIONAL_FIELDS);
  const p = { rowNumber: rec._row };
  Object.keys(f).forEach(function (k) {
    p[k] = rec[f[k]];
  });
  p.id = normalizeText(p.id);
  return p;
}

/** Loads PRODUCTS and REELS as plain objects. */
function loadData_(ss) {
  const f = RF_CONFIG.PRODUCT_FIELDS;
  const productsSheet = getProductsSheet_(ss);
  const productHeaders = Object.keys(f).map(function (k) {
    return f[k];
  });
  requireHeaders_(productsSheet, productHeaders);
  const optionalHeaders = Object.keys(RF_CONFIG.PRODUCT_OPTIONAL_FIELDS).map(function (k) {
    return RF_CONFIG.PRODUCT_OPTIONAL_FIELDS[k];
  });
  const products = readRecords_(productsSheet, productHeaders.concat(optionalHeaders))
    .map(productFromRecord_)
    .filter(function (p) {
      return p.id;
    });
  const byId = {};
  products.forEach(function (p) {
    byId[p.id] = byId[p.id] ? 'DUPLICATE' : p;
  });

  const warnings = [];
  let hookColumnsMissing = true;
  let productionColumnsMissing = RF_CONFIG.REELS_PRODUCTION_HEADERS.slice();
  let mediaColumnsMissing = RF_CONFIG.REELS_MEDIA_HEADERS.slice();
  let imageColumnsMissing = RF_CONFIG.REELS_IMAGE_HEADERS.slice();
  const reelsSheet = findSheet_(ss, RF_CONFIG.SHEETS.REELS);
  let reels = [];
  if (reelsSheet && reelsSheet.getLastColumn() > 0) {
    const missing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HEADERS);
    if (missing.length) {
      warnings.push('REELS 시트에 승인 관리용 헤더가 없습니다 (' + missing.length + '개). Google Sheets에서 "릴스 팩토리 → 시트 준비"를 실행하세요.');
    }
    hookColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_HOOK_HEADERS).length > 0;
    productionColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_PRODUCTION_HEADERS);
    mediaColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_MEDIA_HEADERS);
    imageColumnsMissing = missingHeaders_(reelsSheet, RF_CONFIG.REELS_IMAGE_HEADERS);
    if (!missing.length && missingHeaders_(reelsSheet, RF_CONFIG.REELS_OPTIONAL_HEADERS).length) {
      warnings.push('REELS에 브랜드·훅·제작 열(' + missingHeaders_(reelsSheet, RF_CONFIG.REELS_OPTIONAL_HEADERS).join(', ') + ')이 없습니다. "릴스 팩토리 → 시트 준비"를 실행하세요 — 훅 5개 저장·대본 승인·제작 계획에 필요합니다. 기존 데이터는 바뀌지 않습니다.');
    }
    reels = readRecords_(reelsSheet, RF_CONFIG.REELS_HEADERS.concat(RF_CONFIG.REELS_OPTIONAL_HEADERS)).filter(function (r) {
      return normalizeText(r['릴스ID']);
    });
  }
  return { products: products, productById: byId, reels: reels, reelsSheet: reelsSheet, warnings: warnings, hookColumnsMissing: hookColumnsMissing, productionColumnsMissing: productionColumnsMissing, mediaColumnsMissing: mediaColumnsMissing, imageColumnsMissing: imageColumnsMissing,
    referenceColumnPresent: !!colOf_(getHeaderMap_(productsSheet), RF_CONFIG.PRODUCT_OPTIONAL_FIELDS.referenceImages) };
}

function findReel_(data, reelId) {
  const matches = data.reels.filter(function (r) {
    return normalizeText(r['릴스ID']) === reelId;
  });
  if (!matches.length) throw new Error('REELS에서 릴스ID "' + reelId + '"를 찾을 수 없습니다.');
  if (matches.length > 1) throw new Error('REELS에 릴스ID "' + reelId + '"가 여러 번 있습니다. 시트에서 중복을 정리하세요.');
  const row = matches[0];
  const product = data.productById[normalizeText(row['상품ID'])];
  if (!product) throw new Error('PRODUCTS에서 상품ID "' + row['상품ID'] + '"를 찾을 수 없습니다.');
  if (product === 'DUPLICATE') throw new Error('PRODUCTS에 상품ID "' + row['상품ID'] + '"가 여러 번 있습니다.');
  return { row: row, product: product };
}

function reelSummary_(row, data) {
  const status = reelStatus(row);
  const product = data.productById[normalizeText(row['상품ID'])];
  return {
    reelId: normalizeText(row['릴스ID']),
    productId: normalizeText(row['상품ID']),
    productName: product && product !== 'DUPLICATE' ? normalizeText(product.name) : '',
    variant: row['버전'],
    status: status,
    statusLabel: RF_STATUS_LABELS[status] || '상태 확인 필요',
    concept: cellText_(row['컨셉']),
    hook: cellText_(row['후킹']),
    pillar: pillarLabel(pillarIdOf(row['콘텐츠 기둥'])),
    scriptVersion: scriptVersionOf(row),
    videoVersion: videoVersionOf(row),
    error: cellText_(row['오류']),
  };
}

function hookView_(row, status, columnsMissing, product, avoidHooks) {
  const set = parseHookSet(row['훅 후보(JSON)']);
  const selected = parseSelectedHook(row['선택한 훅']);
  const current = normalizeText(row['후킹']);
  const reviewing = RF_ACTIONS.SELECT_HOOK.from.indexOf(status) !== -1;
  const valid = !!(selected && normalizeText(selected.text) === current && Number(selected.scriptVersion) === scriptVersionOf(row));
  return {
    candidates: set.hooks,
    recommended: set.recommended,
    selected: selected,
    selectionValid: valid,
    // Every script under review needs one of five hooks chosen by the operator before approval.
    required: true,
    columnsMissing: !!columnsMissing,
    canGenerate: reviewing && !columnsMissing,
    canSelect: reviewing && !columnsMissing && set.hooks.length > 0,
    scriptVersion: scriptVersionOf(row),
    types: RF_CONFIG.HOOK_TYPES,
    // Style warnings per hook id (never block; the operator may edit, select, or ask Gemini to improve one).
    warnings: product ? hookSetWarnings(set, product, avoidHooks || []) : {},
    // Warnings for the chosen wording when the operator edited it.
    selectedWarnings: product && selected && selected.id && RF_CONFIG.HOOK_TYPES[selected.id] && selected.edited
      ? hookWarnings(selected.id, selected.text, product, [])
      : [],
    canRevise: reviewing && !columnsMissing && set.hooks.length > 0,
  };
}

/** Brand settings the dashboard shows (name, tagline, pillars with targets, current focus). */
function brandSummary_() {
  const B = RF_CONFIG.BRAND;
  return {
    name: B.NAME,
    tagline: B.TAGLINE,
    focus: B.CURRENT_FOCUS,
    aiLabel: B.AI_LABEL,
    pillars: Object.keys(B.PILLARS).map(function (id) {
      return { id: id, label: B.PILLARS[id].label, target: B.PILLARS[id].target };
    }),
  };
}

/** Reels per content pillar vs the editorial targets (planning aid, not a rule). */
function pillarMix_(reels) {
  const counts = {};
  let tagged = 0;
  reels.forEach(function (r) {
    const id = pillarIdOf(r['콘텐츠 기둥']);
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
    tagged++;
  });
  return brandSummary_().pillars.map(function (p) {
    return { id: p.id, label: p.label, target: p.target, count: counts[p.id] || 0, share: tagged ? Math.round(((counts[p.id] || 0) * 100) / tagged) : 0 };
  });
}

function allowedActions_(status) {
  return RF_CLIENT_ACTIONS.filter(function (a) {
    return RF_ACTIONS[a] && RF_ACTIONS[a].from && RF_ACTIONS[a].from.indexOf(status) !== -1;
  });
}

function parseFlowScenePrompts_(row) {
  try {
    const v = JSON.parse(cellText_(row['Flow 장면 프롬프트']) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function reelDetail_(ss, reelId) {
  const data = loadData_(ss);
  const found = findReel_(data, reelId);
  const row = found.row;
  const product = found.product;
  const status = reelStatus(row);
  const reel = rowToReel(row);
  const fileId = parseDriveFileId(row['영상 파일 URL']);

  const auditSheet = findSheet_(ss, RF_CONFIG.SHEETS.AUDIT);
  const history = auditSheet && auditSheet.getLastColumn() > 0
    ? readRecords_(auditSheet, RF_CONFIG.AUDIT_HEADERS)
        .filter(function (a) {
          return normalizeText(a['릴스ID']) === reelId ||
            (!normalizeText(a['릴스ID']) && normalizeText(a['상품ID']) === product.id);
        })
        .slice(-40)
        .reverse()
        .map(function (a) {
          return {
            at: a['일시'],
            action: a['작업'],
            label: (RF_ACTIONS[a['작업']] && RF_ACTIONS[a['작업']].label) || a['작업'],
            to: RF_STATUS_LABELS[a['새 상태']] || a['새 상태'],
            scriptVersion: a['대본 버전'],
            videoVersion: a['영상 버전'],
            actor: a['작업자'],
            note: a['메모'],
          };
        })
    : [];

  return {
    summary: reelSummary_(row, data),
    reel: reel,
    scenesInvalid: !reel.scenes,
    cta: cellText_(row['CTA']),
    keyword: cellText_(row['ManyChat 키워드']),
    disclosure: cellText_(row['광고 표기']),
    flowPrompts: cellText_(row['Flow 프롬프트']),
    flowScenePrompts: parseFlowScenePrompts_(row),
    flowStatus: cellText_(row['Flow 생성']),
    approvedVersion: cellText_(row['승인 대본 버전']),
    approvedIntact: isApprovedScriptIntact(row),
    scriptReview: { by: cellText_(row['대본 검토자']), at: row['대본 검토일시'], note: cellText_(row['대본 검토 메모']) },
    videoReview: { by: cellText_(row['영상 검토자']), at: row['영상 검토일시'], note: cellText_(row['영상 검토 메모']) },
    video: fileId ? { url: driveViewUrl(fileId), previewUrl: drivePreviewUrl(fileId) } : null,
    product: {
      id: product.id,
      name: normalizeText(product.name),
      facts: parseConfirmedFeatures(product.features),
      target: normalizeText(product.target),
      permission: normalizeText(product.permission) || '미입력',
      permissionOk: isPermissionApproved(product.permission),
      affiliateUrlOk: !affiliateUrlError(product.affiliateUrl),
    },
    touchpoints: touchpointSummary(row, product),
    allowedActions: allowedActions_(status),
    canRegenerate: status === 'SCRIPT_CHANGES_REQUESTED',
    pillar: { id: reel.pillar, label: pillarLabel(reel.pillar) },
    // Five hooks (H1–H5), Gemini's recommendation, and the operator's choice (with script version).
    hooks: hookView_(row, status, data.hookColumnsMissing, product, productHooksExcept_(data, product.id, normalizeText(row['릴스ID']))),
    pillars: brandSummary_().pillars,
    // Gemini's production plan (after approval), Drive folder and clip tracker.
    production: productionView_(row, product, data.productionColumnsMissing),
    // 9:16 Storyboard images via Gemini 2.5 Flash Image and manual Google Flow handoff
    storyboard: storyboardView_(row, product, data),
    // Reference photos, per-scene clip uploads and review (the final render needs every clip approved).
    media: mediaView_(row, product, data),
    // Recomputed from the current script, so an edit made in the sheet is reflected too.
    verificationFlags: reel.scenes ? verificationLines_(reel, reel.pillar, row) : [],
    brand: brandSummary_(),
    history: history,
    warnings: data.warnings,
  };
}

function updateProductPermission_(ss, productId, value) {
  try {
    const sheet = getProductsSheet_(ss);
    const rowNumber = findProductRow_(sheet, productId);
    const map = getHeaderMap_(sheet);
    const col = colOf_(map, RF_CONFIG.PRODUCT_FIELDS.permission);
    if (col) {
      sheet.getRange(rowNumber, col, 1, 1).setValues([[value]]);
    }
  } catch (e) {
    // Non-fatal if sheet row cannot be updated
  }
}

/** Plans and writes one transition (caller holds the lock). Returns the plan. */
function applyTransition_(ss, reelId, action, input, actor) {
  const data = loadData_(ss);
  const found = findReel_(data, reelId);
  if (action === 'CONFIRM_MEDIA_RIGHTS' || (action === 'START_VIDEO' && input && input.rightsConfirmed === true)) {
    updateProductPermission_(ss, found.product.id, '자체 제작');
    found.product.permission = '자체 제작';
  }
  const plan = planTransition(found.row, found.product, action, input, { actor: actor, now: new Date() });
  if (!plan.noop) {
    updateRecord_(data.reelsSheet, found.row._row, plan.updates);
    appendAudit_(ss, [plan.audit]);
  }
  return plan;
}

function withLock_(fn) {
  const lock = getLock_();
  if (!lock.tryLock(20000)) throw new Error('다른 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- API (google.script.run)

function apiGetDashboard() {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = loadData_(ss);
    const reelCount = {};
    data.reels.forEach(function (r) {
      const id = normalizeText(r['상품ID']);
      reelCount[id] = (reelCount[id] || 0) + 1;
    });
    return {
      warnings: data.warnings,
      products: data.products.map(function (p) {
        return {
          id: p.id,
          name: normalizeText(p.name),
          factsCount: parseConfirmedFeatures(p.features).length,
          affiliateUrlOk: !affiliateUrlError(p.affiliateUrl),
          permission: normalizeText(p.permission) || '미입력',
          permissionOk: isPermissionApproved(p.permission),
          reelCount: reelCount[p.id] || 0,
          duplicate: data.productById[p.id] === 'DUPLICATE',
        };
      }),
      reels: data.reels.map(function (r) {
        return reelSummary_(r, data);
      }),
      brand: brandSummary_(),
      pillarMix: pillarMix_(data.reels),
      codeVersion: RF_CONFIG.CODE_VERSION,
    };
  });
}

function apiGetReel(reelId) {
  return api_(function () {
    return { detail: reelDetail_(SpreadsheetApp.getActiveSpreadsheet(), normalizeText(reelId)) };
  });
}

function apiAction(reelId, action, input) {
  return api_(function (user) {
    if (RF_CLIENT_ACTIONS.indexOf(action) === -1) throw new Error('허용되지 않은 작업입니다: ' + action);
    if (action === 'GENERATE_STORYBOARD_IMAGES') {
      const res = apiGenerateStoryboardImages(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    if (action === 'REVIEW_STORYBOARD_IMAGE') {
      const res = apiReviewStoryboardImage(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    if (action === 'REGENERATE_STORYBOARD_IMAGE') {
      const res = apiRegenerateStoryboardImage(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    if (action === 'RECOVER_STORYBOARD_IMAGE') {
      const res = apiRecoverStoryboardImage(reelId, input);
      if (!res.ok) throw new Error(res.error);
      return { detail: res.detail };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    let notice = '';
    const plan = withLock_(function () {
      const p = applyTransition_(ss, id, action, input || {}, user);
      // A video approval immediately tries to prepare publishing; missing prerequisites are recorded, not hidden.
      if (action === 'APPROVE_VIDEO' && !p.noop) {
        try {
          applyTransition_(ss, id, 'MARK_READY_TO_PUBLISH', {}, 'system');
        } catch (e) {
          const data = loadData_(ss);
          const found = findReel_(data, id);
          updateRecord_(data.reelsSheet, found.row._row, { '오류': e.message });
          appendAudit_(ss, [{
            '일시': new Date(),
            '릴스ID': id,
            '상품ID': found.row['상품ID'],
            '작업': 'READY_TO_PUBLISH_BLOCKED',
            '이전 상태': 'VIDEO_APPROVED',
            '새 상태': 'VIDEO_APPROVED',
            '대본 버전': scriptVersionOf(found.row),
            '영상 버전': videoVersionOf(found.row),
            '작업자': 'system',
            '메모': e.message,
          }]);
          notice = '영상은 승인되었지만 게시 준비를 마치지 못했습니다:\n' + e.message;
        }
      }
      return p;
    });
    return {
      noop: plan.noop,
      notice: notice || (plan.noop ? '이미 처리된 요청입니다.' : ''),
      detail: reelDetail_(ss, id),
    };
  });
}

/** Rewrites one script with Gemini after "수정 요청". One paid call (plus one corrective retry). */
function apiRegenerateScript(reelId, input) {
  return api_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if (status !== 'SCRIPT_CHANGES_REQUESTED' || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      const current = rowToReel(found.row);
      const note = cellText_(found.row['대본 검토 메모']);
      let lastErrors = [];
      let lastRaw = '';
      let newReel = null;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !newReel; attempt++) {
        // Rewrites the script only; the five hooks stay as they are.
        const raw = callGemini_(buildRegenerationPrompt(found.product, current, note, lastErrors, lastRaw), geminiResponseSchema(1, false));
        const parsed = parseModelJson(raw);
        const result = parsed.error ? { errors: [parsed.error] } : validateGeminiReels(parsed.value, found.product, 1, { requireHooks: false });
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'regenerateScript', found.product.id, id + ' 재생성 검증 실패 (시도 ' + attempt + ')',
            result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          newReel = result.reels[0];
        }
      }
      if (!newReel) {
        throw new Error('재생성된 대본이 검증을 통과하지 못했습니다. 대본은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      }
      applyTransition_(ss, id, 'REGENERATE_SCRIPT', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        reel: newReel,
        note: note,
      }, 'Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Touchpoint 2: the operator picks one of the five hooks (input.hookId), optionally edits it
 * (input.text), and either keeps the script with that hook line swapped in (mode 'keep', free) or has
 * Gemini rewrite the script around it (mode 'regenerate', one paid call + at most one retry).
 * The choice is stored in REELS "선택한 훅" with the script version and recorded in AUDIT.
 */
function apiSelectHook(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      if (RF_ACTIONS.SELECT_HOOK.from.indexOf(status) === -1) {
        throw new Error('훅은 대본 검토 중에만 고를 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + '). 승인된 대본은 "대본 승인 취소" 후 바꾸세요.');
      }
      const set = parseHookSet(found.row['훅 후보(JSON)']);
      const base = set.hooks.filter(function (h) {
        return h.id === input.hookId;
      })[0];
      if (!base) throw new Error('이 대본의 훅 후보에서 ' + (input.hookId || '훅') + '을(를) 찾을 수 없습니다.');
      const text = normalizeText(input.text || base.text);
      // Fact check before any paid call.
      const hookErrors = hookTextErrors(text, found.product);
      if (hookErrors.length) throw new Error('이 훅은 쓸 수 없습니다:\n- ' + hookErrors.join('\n- '));
      let reel = null;
      if (input.mode === 'regenerate') {
        const current = rowToReel(found.row);
        let lastErrors = [];
        let lastRaw = '';
        for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !reel; attempt++) {
          const raw = callGemini_(buildHookScriptPrompt(found.product, current, text, lastErrors, lastRaw), geminiResponseSchema(1, false));
          const parsed = parseModelJson(raw);
          const result = parsed.error ? { errors: [parsed.error] } : validateGeminiReels(parsed.value, found.product, 1, { requireHooks: false, fixedHook: text });
          if (result.errors.length) {
            lastErrors = result.errors;
            lastRaw = raw;
            logEvent_('WARN', 'selectHook', found.product.id, id + ' 훅 기반 재작성 검증 실패 (시도 ' + attempt + ')',
              result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
          } else {
            reel = result.reels[0];
          }
        }
        if (!reel) throw new Error('선택한 훅으로 다시 쓴 대본이 검증을 통과하지 못했습니다. 대본과 훅 선택은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      }
      applyTransition_(ss, id, 'SELECT_HOOK', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        hookId: base.id,
        text: text,
        reel: reel,
        note: input.note,
      }, user + (reel ? ' + Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')' : ''));
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Touchpoint 2: five hooks (with their opening scenes) for a script that has none — e.g. a script
 * written before the five-hook workflow. One Gemini call (+ at most one corrective retry). The script is
 * not changed; the operator then chooses a hook. Text only — no paid media.
 */
function apiGenerateHooks(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    withLock_(function () {
      const data = loadData_(ss);
      if (data.hookColumnsMissing) {
        throw new Error('REELS에 훅 저장 열(' + RF_CONFIG.REELS_HOOK_HEADERS.join(', ') + ')이 없습니다. Google Sheets에서 "릴스 팩토리 → 시트 준비"를 먼저 실행하세요. Gemini는 호출하지 않았습니다.');
      }
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      if (RF_ACTIONS.SET_HOOKS.from.indexOf(status) === -1) {
        throw new Error('훅은 대본 검토 중에만 만들 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      const current = rowToReel(found.row);
      if (!current.scenes) throw new Error('"장면(JSON)" 셀이 올바른 JSON이 아닙니다. "수정 요청" 후 재생성하세요.');
      // Hooks already used for this product (other reels) are avoided; this script's own hook may return.
      const avoid = productHooksExcept_(data, found.product.id, id);
      let lastErrors = [];
      let lastRaw = '';
      let hookSet = null;
      let calls = 0;
      const maxCalls = RF_CONFIG.MAX_GEMINI_CALLS_PER_RUN || RF_CONFIG.MAX_GEMINI_ATTEMPTS;
      for (let attempt = 1; attempt <= RF_CONFIG.MAX_GEMINI_ATTEMPTS && !hookSet && calls < maxCalls; attempt++) {
        let raw = callGemini_(buildHooksForScriptPrompt(found.product, current, avoid, lastErrors, lastRaw), geminiResponseSchema(1, 'only'));
        calls++;
        const parsed = parseModelJson(raw);
        let result = parsed.error ? { errors: [parsed.error] } : validateHookSet(parsed.value, found.product, avoid);
        // Only some hooks need work → rewrite just those (one call) instead of all five.
        const plan = parsed.error ? null : hookRevisionPlan(result, RF_CONFIG.HOOK_STYLE.AUTO_REVISE_WEAK);
        if (plan && plan.ids.length && calls < maxCalls) {
          calls++;
          const merged = reviseHooks_(found.product, parsed.value, plan, avoid, 'generateHooks');
          if (merged && merged.revised.length) {
            const again = validateHookSet(merged.payload, found.product, avoid);
            if (!again.errors.length || result.errors.length) {
              result = again;
              raw = JSON.stringify(merged.payload);
            }
          }
        }
        if (result.errors.length) {
          lastErrors = result.errors;
          lastRaw = raw;
          logEvent_('WARN', 'generateHooks', found.product.id, id + ' 훅 5개 검증 실패 (시도 ' + attempt + ')',
            result.errors.join('\n') + '\n\n--- 원본 응답 ---\n' + raw);
        } else {
          hookSet = result.hookSet;
        }
      }
      if (!hookSet) throw new Error('Gemini가 만든 훅 5개가 검증을 통과하지 못했습니다. 대본은 바뀌지 않았습니다.\n- ' + lastErrors.slice(0, 6).join('\n- '));
      applyTransition_(ss, id, 'SET_HOOKS', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        hookSet: hookSet,
      }, user + ' + Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
    });
    return { detail: reelDetail_(ss, id) };
  });
}

/**
 * Touchpoint 2: the operator asks Gemini to improve ONE hook (e.g. one with a style warning). One Gemini
 * call, no retry; only that hook (and its opening scene) changes, the other four hooks and the script do
 * not. The rewrite is kept only if it passes the hard checks and has no more warnings than before.
 * If the operator had chosen that hook, the choice is cleared so they confirm the new wording.
 */
function apiReviseHook(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    let notice = '';
    withLock_(function () {
      const data = loadData_(ss);
      if (data.hookColumnsMissing) throw new Error('REELS에 훅 저장 열이 없습니다. "릴스 팩토리 → 시트 준비"를 먼저 실행하세요. Gemini는 호출하지 않았습니다.');
      const found = findReel_(data, id);
      const status = reelStatus(found.row);
      if ((input.expectedStatus && input.expectedStatus !== status) || Number(input.expectedScriptVersion) !== scriptVersionOf(found.row)) {
        throw staleError_(found.row, status);
      }
      if (RF_ACTIONS.SET_HOOKS.from.indexOf(status) === -1) {
        throw new Error('훅은 대본 검토 중에만 다듬을 수 있습니다 (현재: ' + (RF_STATUS_LABELS[status] || status) + ').');
      }
      const set = parseHookSet(found.row['훅 후보(JSON)']);
      const hookId = normalizeText(input.hookId);
      if (!set.hooks.some(function (h) { return h.id === hookId; })) throw new Error('이 대본의 훅 후보에서 ' + (hookId || '훅') + '을(를) 찾을 수 없습니다.');
      const avoid = productHooksExcept_(data, found.product.id, id);
      const payload = { hooks: set.hooks, recommended_hook: set.recommended };
      const v = validateHookSet(payload, found.product, avoid);
      const problems = (v.hookErrors[hookId] || []).concat(v.warnings[hookId] || []);
      const plan = { ids: [hookId], problems: {}, hard: false };
      plan.problems[hookId] = problems.length ? problems : ['문제 상황이 첫 2초에 더 또렷하게 들리도록 다듬기'];
      const merged = reviseHooks_(found.product, payload, plan, avoid, 'reviseHook', { operator: true });
      if (!merged) throw new Error('Gemini 호출에 실패했습니다. 훅은 바뀌지 않았습니다. LOG 시트를 확인하세요.');
      if (!merged.revised.length) {
        notice = 'Gemini가 더 나은 ' + hookId + '를 만들지 못해 기존 훅을 그대로 두었습니다 (Gemini 1회 사용).';
        return;
      }
      const result = validateHookSet(merged.payload, found.product, avoid);
      if (!result.hookSet) throw new Error('다듬은 훅이 검증을 통과하지 못했습니다. 훅은 바뀌지 않았습니다.\n- ' + result.errors.slice(0, 6).join('\n- '));
      applyTransition_(ss, id, 'SET_HOOKS', {
        expectedStatus: status,
        expectedScriptVersion: scriptVersionOf(found.row),
        hookSet: result.hookSet,
        revisedIds: [hookId],
      }, user + ' + Gemini (' + (RF_GEMINI_STATE.lastModel || getGeminiModel()) + ')');
      notice = hookId + ' 훅을 다듬었습니다. 대본은 바뀌지 않았습니다 — 이 훅을 쓰려면 "이 훅으로 정하기"를 누르세요.';
    });
    return { notice: notice, detail: reelDetail_(ss, id) };
  });
}

/** Hooks already used by this product's other reels (the given reel's own hooks may return). */
function productHooksExcept_(data, productId, reelId) {
  const avoid = [];
  data.reels.forEach(function (r) {
    if (normalizeText(r['상품ID']) !== productId || normalizeText(r['릴스ID']) === reelId) return;
    if (normalizeText(r['후킹'])) avoid.push(normalizeText(r['후킹']));
    parseHookSet(r['훅 후보(JSON)']).hooks.forEach(function (h) {
      avoid.push(h.text);
    });
  });
  return avoid;
}

/** Touchpoint 1 from the phone: generate 3 scripts for a product already entered in PRODUCTS. */
function apiGenerateScripts(productId, allowAdditional) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return withLock_(function () {
      const row = findProductRow_(getProductsSheet_(ss), normalizeText(productId));
      const res = generateScriptsForProduct_(ss, row, { actor: user, allowAdditional: !!allowAdditional });
      return res.needsConfirm ? { needsConfirm: res.needsConfirm } : { ids: res.ids };
    });
  });
}

function apiGetPublishingPack(reelId) {
  return api_(function () {
    const data = loadData_(SpreadsheetApp.getActiveSpreadsheet());
    const found = findReel_(data, normalizeText(reelId));
    return { pack: buildPublishingPack(found.row, found.product) };
  });
}

// ---------------------------------------------------------------- render jobs

/** Shared HMAC key between this script and the renderer. Created on first use. */
function getRenderSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('RF_RENDER_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('RF_RENDER_SECRET', secret);
  }
  return secret;
}

function signRenderJob_(payload) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(payload, getRenderSecret_(), Utilities.Charset.UTF_8));
}

/**
 * Issues a signed render job for an approved reel in production. No paid API is called here;
 * the renderer spends TTS characters only after verifying this signature.
 */
function apiGetRenderJob(reelId) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = loadData_(ss);
    const found = findReel_(data, normalizeText(reelId));
    const gate = renderJobBlocker(found.row, found.product);
    if (gate) throw new Error(gate);
    // Approved clips must still be the same bytes in Drive (network check, only when the clip gate applies).
    const driveErr = verifyApprovedClipFiles_(found.row);
    if (driveErr) throw new Error(driveErr);
    const payload = buildRenderJobPayload(found.row, found.product, new Date().toISOString(), RF_RENDER_JOB_TTL_HOURS);
    const job = JSON.parse(payload);
    appendAudit_(ss, [{
      '일시': new Date(),
      '릴스ID': job.reelId,
      '상품ID': job.productId,
      '작업': 'RENDER_JOB_ISSUED',
      '이전 상태': job.status,
      '새 상태': job.status,
      '대본 버전': job.scriptVersion,
      '영상 버전': job.nextVideoVersion - 1,
      '작업자': user,
      '메모': '만료: ' + job.expiresAt,
    }]);
    return {
      fileName: job.reelId + '_v' + job.scriptVersion + '.render-job.json',
      jobFile: JSON.stringify({ payload: payload, signature: signRenderJob_(payload) }, null, 2),
    };
  });
}

/** Menu: shows the render key once so the operator can put it in renderer/.env on the Mac. */
function showRenderSecret() {
  const ui = SpreadsheetApp.getUi();
  const secret = escapeHtml_(getRenderSecret_());
  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<p style="font:14px sans-serif">Mac의 <code>renderer/.env</code> 파일에 아래 한 줄을 넣으세요. 이 키가 있어야 승인된 렌더 작업만 실행됩니다. 다른 사람과 공유하지 마세요.</p>' +
        '<pre style="font:13px monospace;white-space:pre-wrap;word-break:break-all;background:#f3f3f3;padding:8px">RF_RENDER_SECRET=' + secret + '</pre>'
    ).setWidth(460).setHeight(200),
    '렌더 키 (Mac 설정용)'
  );
}

/**
 * Step 1: Create or select a product project using a product URL.
 * input: { url, name, category, features, target }
 */
function apiCreateProductProject(input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    input = input || {};
    const url = normalizeText(input.url);
    if (!url) throw new Error('상품 URL을 입력하세요.');

    return withLock_(function () {
      const sheet = getProductsSheet_(ss);
      const data = loadData_(ss);
      const existingProducts = Object.keys(data.productById)
        .filter(function (id) { return id && data.productById[id] !== 'DUPLICATE'; })
        .map(function (id) { return data.productById[id]; });

      // Check if product with this URL already exists
      const match = existingProducts.filter(function (p) {
        return (normalizeText(p.affiliateUrl) && normalizeText(p.affiliateUrl) === url) ||
               (normalizeText(p.sourceUrl) && normalizeText(p.sourceUrl) === url);
      })[0];

      if (match) {
        return { product: match, created: false };
      }

      // Generate next product ID (e.g., PRD-001, PRD-002, ...)
      let maxNum = 0;
      existingProducts.forEach(function (p) {
        const m = /^PRD-(\d+)$/.exec(p.id);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      const nextNum = maxNum + 1;
      const nextId = 'PRD-' + (nextNum < 10 ? '00' : nextNum < 100 ? '0' : '') + nextNum;

      const isCoupang = url.indexOf('coupang') !== -1 || url.indexOf('coupa.ng') !== -1;
      const rec = {};
      rec[RF_CONFIG.PRODUCT_FIELDS.id] = nextId;
      rec[RF_CONFIG.PRODUCT_FIELDS.name] = normalizeText(input.name) || ('새 상품 ' + nextId);
      rec[RF_CONFIG.PRODUCT_FIELDS.category] = normalizeText(input.category) || '일반';
      rec[RF_CONFIG.PRODUCT_FIELDS.features] = normalizeText(input.features) || '';
      rec[RF_CONFIG.PRODUCT_FIELDS.target] = normalizeText(input.target) || '일반';
      rec[RF_CONFIG.PRODUCT_FIELDS.affiliateUrl] = isCoupang ? url : '';
      rec[RF_CONFIG.PRODUCT_FIELDS.sourceUrl] = !isCoupang ? url : '';
      rec[RF_CONFIG.PRODUCT_FIELDS.permission] = '자체 제작';
      rec[RF_CONFIG.PRODUCT_FIELDS.status] = '준비';

      appendRecords_(sheet, [rec]);

      appendAudit_(ss, [{
        '일시': new Date(),
        '상품ID': nextId,
        '작업': 'PRODUCT_PROJECT_CREATED',
        '작업자': user,
        '메모': 'Step 1: 상품 URL로 프로젝트 생성 (' + url + ')',
        '스냅샷(JSON)': JSON.stringify({ id: nextId, url: url, name: rec[RF_CONFIG.PRODUCT_FIELDS.name] })
      }]);

      logEvent_('INFO', 'createProductProject', nextId, '새 상품 프로젝트 생성: ' + nextId, url);

      return {
        product: {
          id: nextId,
          name: rec[RF_CONFIG.PRODUCT_FIELDS.name],
          category: rec[RF_CONFIG.PRODUCT_FIELDS.category],
          features: rec[RF_CONFIG.PRODUCT_FIELDS.features],
          target: rec[RF_CONFIG.PRODUCT_FIELDS.target],
          affiliateUrl: rec[RF_CONFIG.PRODUCT_FIELDS.affiliateUrl],
          sourceUrl: rec[RF_CONFIG.PRODUCT_FIELDS.sourceUrl],
          permission: '자체 제작',
          status: '준비',
        },
        created: true,
      };
    });
  });
}

/**
 * Step 6: Approves all uploaded/attached clips in PENDING_REVIEW for this reel.
 */
function apiApproveAllClips(reelId, input) {
  return api_(function (user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = normalizeText(reelId);
    input = input || {};
    return withLock_(function () {
      const data = loadData_(ss);
      const found = findReel_(data, id);
      const store = parseClipStore_(found.row);
      const hash = cellText_(found.row['승인 대본 해시']);
      const list = clipList_(found.row);
      let approvedCount = 0;

      list.forEach(function (c) {
        const entry = store.clips[c.key];
        const cur = entry && entry.versions.filter(function (v) { return v.v === entry.current; })[0];
        if (cur && cur.status !== 'APPROVED') {
          cur.status = 'APPROVED';
          cur.approvedHash = hash;
          cur.reviewedBy = user;
          cur.reviewedAt = new Date().toISOString();
          approvedCount++;
        }
      });

      if (approvedCount > 0) {
        updateRecord_(data.reelsSheet, found.row._row, { '장면 클립(JSON)': JSON.stringify(store) });
        appendAudit_(ss, [{
          '일시': new Date(),
          '릴스ID': id,
          '상품ID': found.row['상품ID'],
          '작업': 'CLIPS_APPROVED_ALL',
          '이전 상태': reelStatus(found.row),
          '새 상태': reelStatus(found.row),
          '대본 버전': scriptVersionOf(found.row),
          '영상 버전': videoVersionOf(found.row),
          '작업자': user,
          '메모': '전체 ' + approvedCount + '개 클립 일괄 승인',
        }]);
      }
      return { detail: reelDetail_(ss, id), approvedCount: approvedCount };
    });
  });
}

// ===== Dashboard.html (embedded) =====
const RF_DASHBOARD_HTML = "<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<base target=\"_top\">\n<title>릴스 팩토리</title>\n<style>\n  :root {\n    --bg: #f2f2f7; --card: #ffffff; --text: #1c1c1e; --muted: #6e6e73; --line: #d1d1d6;\n    --accent: #0a66d6; --ok: #1a7f37; --warn: #a15c00; --bad: #c62828; --chip: #e9e9ef;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root { --bg: #000; --card: #1c1c1e; --text: #f2f2f7; --muted: #a1a1a6; --line: #38383a;\n      --accent: #4c9aff; --ok: #3fb950; --warn: #e3a008; --bad: #ff6b6b; --chip: #2c2c2e; }\n  }\n  * { box-sizing: border-box; }\n  html, body { margin: 0; background: var(--bg); color: var(--text);\n    font: 16px/1.45 -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", \"Noto Sans KR\", sans-serif; }\n  header { position: sticky; top: 0; z-index: 5; background: var(--bg);\n    padding: calc(env(safe-area-inset-top) + 10px) 16px 8px; border-bottom: 1px solid var(--line); }\n  header h1 { font-size: 20px; margin: 0; display: flex; align-items: center; gap: 8px; }\n  header .user { font-size: 12px; color: var(--muted); }\n  main { padding: 12px 16px calc(env(safe-area-inset-bottom) + 90px); max-width: 720px; margin: 0 auto; }\n  nav { position: fixed; bottom: 0; left: 0; right: 0; z-index: 5; display: flex; background: var(--card);\n    border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }\n  nav button { flex: 1; border: 0; background: none; color: var(--muted); padding: 8px 2px 10px; font-size: 12px;\n    min-height: 56px; position: relative; }\n  nav button.on { color: var(--accent); font-weight: 600; }\n  nav .n { position: absolute; top: 4px; right: 18%; background: var(--bad); color: #fff; border-radius: 9px;\n    font-size: 11px; min-width: 18px; padding: 0 5px; }\n  nav .ico { display: block; font-size: 20px; line-height: 24px; }\n  .card { background: var(--card); border-radius: 14px; padding: 14px; margin: 0 0 12px; border: 1px solid var(--line); }\n  .card.tap { cursor: pointer; }\n  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }\n  .muted { color: var(--muted); font-size: 13px; }\n  .chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 2px 10px; font-size: 12px; }\n  .chip.ok { color: var(--ok); } .chip.warn { color: var(--warn); } .chip.bad { color: var(--bad); }\n  h2 { font-size: 17px; margin: 18px 0 8px; }\n  h3 { font-size: 15px; margin: 14px 0 6px; }\n  .hook { font-weight: 600; font-size: 17px; margin: 6px 0; }\n  .pre { white-space: pre-wrap; word-break: break-word; }\n  .scene { border-top: 1px solid var(--line); padding: 10px 0 2px; }\n  .flow { font-size: 15px; background: var(--chip); border-radius: 8px; padding: 8px; white-space: pre-wrap; word-break: break-word; }\n  .flow.mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }\n  .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }\n  .btns.one { grid-template-columns: 1fr; }\n  button.b { min-height: 48px; border-radius: 12px; border: 1px solid var(--line); background: var(--card);\n    color: var(--text); font-size: 16px; font-weight: 600; padding: 8px 12px; }\n  a.b { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 12px; border: 1px solid var(--line);\n    background: var(--card); color: var(--accent); font-size: 16px; font-weight: 600; padding: 8px 12px; text-decoration: none; }\n  button.b:disabled { opacity: .45; }\n  button.b.primary { background: var(--accent); color: #fff; border-color: var(--accent); }\n  button.b.ok { background: var(--ok); color: #fff; border-color: var(--ok); }\n  button.b.bad { color: var(--bad); }\n  button.b:disabled { opacity: .5; }\n  button.link { border: 0; background: none; color: var(--accent); font-size: 15px; padding: 8px 0; min-height: 44px; }\n  textarea, input[type=text], input[type=url] { width: 100%; font: inherit; font-size: 16px; color: var(--text);\n    background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }\n  textarea { min-height: 88px; }\n  label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }\n  .banner { border-radius: 12px; padding: 10px 12px; margin: 0 0 12px; font-size: 14px; white-space: pre-wrap; }\n  .banner.warn { background: rgba(227,160,8,.15); } .banner.bad { background: rgba(198,40,40,.13); }\n  .hookwarn { background: rgba(227,160,8,.12); border-radius: 10px; padding: 6px 10px; margin: 6px 0; font-size: 13px; }\n  .banner.ok { background: rgba(26,127,55,.13); }\n  .tp { display: grid; grid-template-columns: 28px 1fr; gap: 4px 8px; align-items: start; padding: 6px 0; }\n  .tp .dot { width: 24px; height: 24px; border-radius: 12px; display: grid; place-items: center; font-size: 13px;\n    background: var(--chip); }\n  .tp .dot.done { background: var(--ok); color: #fff; }\n  .video { position: relative; width: 100%; max-width: 360px; aspect-ratio: 9 / 16; margin: 8px auto;\n    background: #000; border-radius: 12px; overflow: hidden; }\n  .video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }\n  .tabs2 { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }\n  .tabs2 button { flex: none; min-height: 36px; border-radius: 999px; border: 1px solid var(--line);\n    background: var(--card); color: var(--text); padding: 4px 12px; font-size: 14px; }\n  .tabs2 button.on { background: var(--accent); color: #fff; border-color: var(--accent); }\n  details summary { min-height: 44px; display: flex; align-items: center; color: var(--accent); cursor: pointer; }\n  .hist { font-size: 13px; border-top: 1px solid var(--line); padding: 6px 0; }\n  .empty { text-align: center; color: var(--muted); padding: 32px 0; }\n  #toast { position: fixed; left: 16px; right: 16px; bottom: calc(env(safe-area-inset-bottom) + 72px); z-index: 9;\n    background: #333; color: #fff; border-radius: 12px; padding: 12px; font-size: 14px; display: none; white-space: pre-wrap; }\n  #busy { position: fixed; inset: 0; z-index: 8; background: rgba(0,0,0,.25); display: none; place-items: center; }\n  #busy div { background: var(--card); padding: 16px 20px; border-radius: 12px; }\n</style>\n</head>\n<body>\n<header>\n  <h1 id=\"title\">릴스 팩토리</h1>\n  <div class=\"user\" id=\"user\"></div>\n</header>\n<main id=\"main\"><div class=\"empty\">불러오는 중…</div></main>\n<nav id=\"nav\"></nav>\n<div id=\"toast\"></div>\n<div id=\"busy\"><div id=\"busyText\">처리 중…</div></div>\n\n<script>\n'use strict';\n// ---------------------------------------------------------------- helpers\n// All data is rendered with textContent / attributes, never parsed as HTML.\nfunction h(tag, attrs, children) {\n  const el = document.createElement(tag);\n  Object.keys(attrs || {}).forEach(function (k) {\n    const v = attrs[k];\n    if (v == null || v === false) return;\n    if (k === 'class') el.className = v;\n    else if (k === 'text') el.textContent = v;\n    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);\n    else el.setAttribute(k, v === true ? '' : v);\n  });\n  (children || []).forEach(function (c) {\n    if (c == null || c === false) return;\n    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);\n  });\n  return el;\n}\nfunction clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }\nfunction fmt(v) {\n  if (!v) return '';\n  const d = new Date(v);\n  if (isNaN(d)) return String(v);\n  const p = function (n) { return (n < 10 ? '0' : '') + n; };\n  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());\n}\nfunction toast(msg, ms) {\n  const t = document.getElementById('toast');\n  t.textContent = msg; t.style.display = 'block';\n  clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, ms || 3500);\n}\nfunction busy(on, text) {\n  document.getElementById('busyText').textContent = text || '처리 중…';\n  document.getElementById('busy').style.display = on ? 'grid' : 'none';\n}\nfunction call(name) {\n  const args = Array.prototype.slice.call(arguments, 1);\n  return new Promise(function (resolve) {\n    const runner = google.script.run\n      .withSuccessHandler(function (res) { resolve(res || { ok: false, error: '빈 응답' }); })\n      .withFailureHandler(function (err) { resolve({ ok: false, error: (err && err.message) || String(err) }); });\n    if (!runner) {\n      resolve({ ok: false, error: 'google.script.run 객체를 초기화할 수 없습니다.' });\n      return;\n    }\n    if (typeof runner[name] === 'function') {\n      try {\n        runner[name].apply(runner, args);\n      } catch (err) {\n        resolve({ ok: false, error: (err && err.message) || String(err) });\n      }\n      return;\n    }\n    // Fallback: If direct runner method is missing on client proxy, route storyboard actions via apiAction\n    if (typeof runner.apiAction === 'function') {\n      try {\n        if (name === 'apiGenerateStoryboardImages') {\n          runner.apiAction(args[0], 'GENERATE_STORYBOARD_IMAGES', args[1]);\n          return;\n        }\n        if (name === 'apiReviewStoryboardImage') {\n          runner.apiAction(args[0], 'REVIEW_STORYBOARD_IMAGE', args[1]);\n          return;\n        }\n        if (name === 'apiRegenerateStoryboardImage') {\n          runner.apiAction(args[0], 'REGENERATE_STORYBOARD_IMAGE', args[1]);\n          return;\n        }\n        if (name === 'apiRecoverStoryboardImage') {\n          runner.apiAction(args[0], 'RECOVER_STORYBOARD_IMAGE', args[1]);\n          return;\n        }\n      } catch (err) {\n        resolve({ ok: false, error: (err && err.message) || String(err) });\n        return;\n      }\n    }\n    resolve({\n      ok: false,\n      error: 'Apps Script 함수 \"' + name + '\"를 실행할 수 없습니다. 대시보드를 새로고침하거나 최신 버전으로 다시 배포하세요.'\n    });\n  });\n}\nfunction copyText(text) {\n  function fallback() {\n    const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });\n    ta.value = text; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);\n    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }\n    document.body.removeChild(ta); return ok;\n  }\n  const done = function (ok) { toast(ok ? '복사했습니다' : '복사하지 못했습니다. 길게 눌러 직접 복사하세요.'); };\n  if (navigator.clipboard && navigator.clipboard.writeText) {\n    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });\n  } else { done(fallback()); }\n}\nfunction copyBlock(label, text, mono) {\n  return h('div', {}, [\n    h('div', { class: 'row', style: 'justify-content:space-between' }, [\n      h('span', { class: 'muted', text: label }),\n      h('button', { class: 'link', type: 'button', onclick: function () { copyText(text); }, text: '복사' }),\n    ]),\n    h('div', { class: 'flow' + (mono ? ' mono' : ''), text: text }),\n  ]);\n}\n\n// ---------------------------------------------------------------- state\nconst TABS = [\n  { key: 'script', ico: '📝', label: '대본', statuses: ['SCRIPT_REVIEW_PENDING', 'SCRIPT_CHANGES_REQUESTED'], badge: ['SCRIPT_REVIEW_PENDING'] },\n  { key: 'make', ico: '🎬', label: '제작', statuses: ['SCRIPT_APPROVED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'], badge: ['VIDEO_FAILED'] },\n  { key: 'video', ico: '▶️', label: '영상', statuses: ['VIDEO_REVIEW_PENDING'], badge: ['VIDEO_REVIEW_PENDING'] },\n  { key: 'publish', ico: '📤', label: '게시', statuses: ['VIDEO_APPROVED', 'READY_TO_PUBLISH'], badge: ['READY_TO_PUBLISH', 'VIDEO_APPROVED'] },\n  { key: 'products', ico: '🛍️', label: '상품' },\n  { key: 'done', ico: '✅', label: '기록', statuses: ['COMPLETED', 'SCRIPT_REJECTED', 'VIDEO_REJECTED', ''] },\n];\nconst S = { tab: 'script', dash: null, detail: null, mode: 'view' };\n\nfunction tabFor(status) {\n  for (let i = 0; i < TABS.length; i++) if (TABS[i].statuses && TABS[i].statuses.indexOf(status) !== -1) return TABS[i].key;\n  return 'done';\n}\nfunction statusChip(status, label) {\n  const cls = /REJECTED|FAILED/.test(status) ? 'bad' : /APPROVED|READY|COMPLETED/.test(status) ? 'ok' : 'warn';\n  return h('span', { class: 'chip ' + cls, text: label || status || '상태 없음' });\n}\n\n// ---------------------------------------------------------------- loading\nfunction loadDashboard() {\n  return call('apiGetDashboard').then(function (res) {\n    if (!res.ok) { renderFatal(res.error); return; }\n    S.dash = res;\n    document.getElementById('user').textContent = res.user + ' · Google Sheets 기준 · 코드 ' + (res.codeVersion || '이전 버전');\n    renderNav(); if (!S.detail) renderList();\n  });\n}\nfunction openReel(reelId) {\n  busy(true, '불러오는 중…');\n  return call('apiGetReel', reelId).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 6000); return; }\n    S.detail = res.detail; S.mode = 'view'; renderDetail(); window.scrollTo(0, 0);\n  });\n}\n// Reloads list data (badges, sibling chips) without leaving the open reel.\nfunction refreshAround() {\n  return loadDashboard().then(function () { if (S.detail && S.mode === 'view') renderDetail(); });\n}\nfunction backToList() { S.detail = null; S.mode = 'view'; loadDashboard().then(renderList); window.scrollTo(0, 0); }\n\nfunction renderFatal(msg) {\n  clear(document.getElementById('main')).appendChild(h('div', { class: 'banner bad', text: msg }));\n}\n\n// ---------------------------------------------------------------- nav + lists\nfunction renderNav() {\n  const nav = clear(document.getElementById('nav'));\n  const reels = (S.dash && S.dash.reels) || [];\n  TABS.forEach(function (t) {\n    const n = t.badge ? reels.filter(function (r) { return t.badge.indexOf(r.status) !== -1; }).length : 0;\n    nav.appendChild(h('button', {\n      type: 'button', class: S.tab === t.key && !S.detail ? 'on' : '',\n      onclick: function () { S.tab = t.key; S.detail = null; renderNav(); renderList(); window.scrollTo(0, 0); },\n    }, [h('span', { class: 'ico', text: t.ico }), t.label, n ? h('span', { class: 'n', text: String(n) }) : null]));\n  });\n}\n\nfunction warningsBanner(list) {\n  return (list || []).map(function (w) { return h('div', { class: 'banner warn', text: '⚠ ' + w }); });\n}\n\nfunction renderList() {\n  const main = clear(document.getElementById('main'));\n  const tab = TABS.filter(function (t) { return t.key === S.tab; })[0];\n  document.getElementById('title').textContent = '릴스 팩토리 · ' + tab.label;\n  warningsBanner(S.dash.warnings).forEach(function (b) { main.appendChild(b); });\n  if (tab.key === 'products') { renderBrand(main); renderProducts(main); return; }\n  const reels = S.dash.reels.filter(function (r) { return tabFor(r.status) === tab.key; });\n  const intro = {\n    script: '② 대본을 검토하세요. 승인된 대본 버전만 영상 제작에 쓰입니다.',\n    make: 'Google Flow 클립은 수동 생성입니다. 프롬프트를 복사해 Flow에서 만든 뒤, 완성 MP4를 Drive에 올려 등록하세요.',\n    video: '③ 완성 영상을 재생해 보고 승인/수정 요청/반려하세요.',\n    publish: '④ 게시 자료를 복사해 직접 인스타그램에 올리고 ManyChat을 설정한 뒤 확인을 누르세요. 자동 게시는 하지 않습니다.',\n    done: '완료·반려된 릴스와 상태 확인이 필요한 행입니다.',\n  }[tab.key];\n  main.appendChild(h('p', { class: 'muted', text: intro }));\n  if (!reels.length) { main.appendChild(h('div', { class: 'empty', text: '항목이 없습니다' })); return; }\n  reels.forEach(function (r) {\n    main.appendChild(h('div', { class: 'card tap', role: 'button', tabindex: '0', onclick: function () { openReel(r.reelId); } }, [\n      h('div', { class: 'row', style: 'justify-content:space-between' }, [\n        h('strong', { text: r.reelId }), statusChip(r.status, r.statusLabel),\n      ]),\n      h('div', { class: 'muted', text: r.productName + ' · 대본 v' + r.scriptVersion + (r.videoVersion ? ' · 영상 v' + r.videoVersion : '') }),\n      h('div', { class: 'hook', text: r.hook }),\n      h('div', { class: 'muted', text: r.concept }),\n      r.pillar ? h('span', { class: 'chip', text: r.pillar }) : null,\n      r.error ? h('div', { class: 'banner bad', style: 'margin:8px 0 0', text: r.error }) : null,\n    ]));\n  });\n}\n\n// Brand and content-pillar mix (editorial targets are a planning aid, not a rule per product).\nfunction renderBrand(main) {\n  const b = S.dash.brand;\n  if (!b) return;\n  const mix = S.dash.pillarMix || [];\n  main.appendChild(h('div', { class: 'card' }, [\n    h('strong', { text: b.name }),\n    h('div', { class: 'muted', text: '“' + b.tagline + '”' }),\n    b.focus ? h('div', { class: 'banner ok', style: 'margin:8px 0', text: b.focus }) : null,\n    h('h3', { text: '콘텐츠 기둥 (현재 / 목표)' }),\n    h('div', {}, mix.map(function (m) {\n      return h('div', { class: 'row', style: 'justify-content:space-between' }, [\n        h('span', { text: m.label }),\n        h('span', { class: 'muted', text: m.count + '개 · ' + m.share + '% / ' + m.target + '%' }),\n      ]);\n    })),\n  ]));\n}\n\nfunction renderProducts(main) {\n  // Step 1: Product URL → create/select product project\n  const createCard = h('div', { class: 'card' });\n  createCard.appendChild(h('h3', { style: 'margin-top:0', text: '① 상품 URL로 프로젝트 생성 / 선택' }));\n  createCard.appendChild(h('div', { class: 'muted', text: '쿠팡 또는 제품 링크를 입력하여 새 상품 프로젝트를 만들거나 기존 프로젝트를 선택합니다.' }));\n\n  const urlInput = h('input', { type: 'url', placeholder: '상품 URL (예: https://link.coupang.com/… 또는 제품 링크)' });\n  const nameInput = h('input', { type: 'text', placeholder: '상품명 (예: 리템 우산꽂이 자석형, 비워두면 자동)' });\n  const featInput = h('textarea', { rows: '2', placeholder: '확인된 핵심 기능 (줄 단위, 선택 사항)' });\n  const createBtn = h('button', { class: 'b primary', type: 'button', text: '프로젝트 생성 / 선택' });\n\n  createBtn.addEventListener('click', function () {\n    const u = urlInput.value.trim();\n    if (!u) { toast('상품 URL을 입력하세요.'); return; }\n    busy(true, '프로젝트 생성/조회 중…');\n    call('apiCreateProductProject', { url: u, name: nameInput.value.trim(), features: featInput.value.trim() }).then(function (res) {\n      busy(false);\n      if (!res.ok) { toast(res.error, 8000); return; }\n      toast(res.created ? '새 상품 프로젝트 생성: ' + res.product.id : '기존 상품 프로젝트 선택: ' + res.product.id);\n      loadDashboard().then(function () { renderNav(); renderList(); });\n    });\n  });\n\n  createCard.appendChild(h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:10px' }, [\n    urlInput, nameInput, featInput, createBtn\n  ]));\n  main.appendChild(createCard);\n\n  main.appendChild(h('h3', { text: '등록된 상품 목록' }));\n  if (!S.dash.products.length) { main.appendChild(h('div', { class: 'empty', text: 'PRODUCTS에 상품이 없습니다' })); return; }\n  S.dash.products.forEach(function (p) {\n    const ready = p.factsCount > 0 && !p.duplicate;\n    main.appendChild(h('div', { class: 'card' }, [\n      h('div', { class: 'row', style: 'justify-content:space-between' }, [h('strong', { text: p.id }), h('span', { class: 'muted', text: '릴스 ' + p.reelCount + '개' })]),\n      h('div', { text: p.name }),\n      h('div', { class: 'row', style: 'margin-top:6px' }, [\n        h('span', { class: 'chip ' + (p.factsCount ? 'ok' : 'bad'), text: '확인된 기능 ' + p.factsCount }),\n        h('span', { class: 'chip ' + (p.affiliateUrlOk ? 'ok' : 'warn'), text: p.affiliateUrlOk ? '제휴 링크 ✓' : '제휴 링크 필요' }),\n        h('span', { class: 'chip ' + (p.permissionOk ? 'ok' : 'warn'), text: '영상 허가: ' + p.permission }),\n        p.duplicate ? h('span', { class: 'chip bad', text: '상품ID 중복' }) : null,\n      ]),\n      h('div', { class: 'btns one' }, [h('button', {\n        class: 'b', type: 'button', disabled: !ready,\n        onclick: function () { generate(p, false); },\n        text: p.reelCount ? '③ 대본 컨셉 및 훅 5개 추가 생성' : '③ 대본 컨셉 및 훅 5개 생성 (Gemini)',\n      })]),\n    ]));\n  });\n}\n\nfunction generate(p, allowAdditional) {\n  if (!allowAdditional && !confirm(p.id + ' 훅 5개와 대본 1개를 Gemini로 생성할까요? (API 호출 1~2회)')) return;\n  busy(true, 'Gemini로 대본 생성 중… (최대 1분)');\n  call('apiGenerateScripts', p.id, allowAdditional).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    if (res.needsConfirm) {\n      if (confirm('이미 릴스 ' + res.needsConfirm + '개가 있습니다. 새 훅 5개와 대본을 추가로 생성할까요?')) generate(p, true);\n      return;\n    }\n    toast('생성 완료: ' + res.ids.join(', '));\n    S.tab = 'script'; loadDashboard().then(function () { renderNav(); renderList(); });\n  });\n}\n\n// ---------------------------------------------------------------- detail\nfunction act(action, input, confirmText) {\n  const d = S.detail;\n  if (confirmText && !confirm(confirmText)) return;\n  const base = { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion, expectedVideoVersion: d.summary.videoVersion };\n  busy(true);\n  call('apiAction', d.summary.reelId, action, Object.assign(base, input || {})).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; S.mode = 'view'; renderDetail();\n    toast(res.notice || '저장했습니다 (REELS·AUDIT 기록)', res.notice ? 8000 : 2500);\n    refreshAround();\n  });\n}\nfunction askNote(promptText, required) {\n  const v = prompt(promptText, '');\n  if (v === null) return null;\n  if (required && !v.trim()) { toast('메모(사유)를 입력해야 합니다.'); return null; }\n  return v.trim();\n}\n\nfunction renderDetail() {\n  const d = S.detail;\n  const main = clear(document.getElementById('main'));\n  renderNav();\n  document.getElementById('title').textContent = d.summary.reelId;\n  main.appendChild(h('button', { class: 'link', type: 'button', onclick: backToList, text: '‹ 목록' }));\n  warningsBanner(d.warnings).forEach(function (b) { main.appendChild(b); });\n\n  // Sibling scripts generated for the same product.\n  const siblings = (S.dash ? S.dash.reels : []).filter(function (r) { return r.productId === d.product.id; });\n  if (siblings.length > 1) {\n    main.appendChild(h('div', { class: 'tabs2' }, siblings.map(function (r) {\n      return h('button', { type: 'button', class: r.reelId === d.summary.reelId ? 'on' : '', onclick: function () { openReel(r.reelId); }, text: r.reelId.replace(d.product.id + '-', '') + ' · ' + r.statusLabel });\n    })));\n  }\n\n  main.appendChild(h('div', { class: 'card' }, [\n    h('div', { class: 'row', style: 'justify-content:space-between' }, [h('strong', { text: d.product.name }), statusChip(d.summary.status, d.summary.statusLabel)]),\n    h('div', { class: 'muted', text: '대본 v' + d.summary.scriptVersion + (d.approvedVersion ? ' · 승인 v' + d.approvedVersion + (d.approvedIntact ? '' : ' (승인 후 변경됨!)') : '') + (d.summary.videoVersion ? ' · 영상 v' + d.summary.videoVersion : '') }),\n    d.summary.error ? h('div', { class: 'banner bad', style: 'margin:8px 0 0', text: d.summary.error }) : null,\n  ]));\n\n  if (S.mode === 'edit') { renderEditor(main); return; }\n\n  if (d.video && ['VIDEO_REVIEW_PENDING', 'VIDEO_APPROVED', 'READY_TO_PUBLISH', 'COMPLETED', 'VIDEO_CHANGES_REQUESTED', 'VIDEO_REJECTED'].indexOf(d.summary.status) !== -1) {\n    main.appendChild(h('div', { class: 'card' }, [\n      h('h3', { style: 'margin-top:0', text: '완성 영상 v' + d.summary.videoVersion }),\n      h('div', { class: 'video' }, [h('iframe', { src: d.video.previewUrl, allow: 'autoplay; fullscreen', title: '영상 미리보기' })]),\n      h('a', { href: d.video.url, target: '_blank', rel: 'noopener', text: 'Google Drive에서 열기 ↗' }),\n      h('div', { class: 'muted', text: '미리보기가 안 보이면 Drive에서 열어 재생하세요 (같은 Google 계정 로그인 필요).' }),\n    ]));\n  }\n\n  renderHooks(main);\n  renderProduction(main);\n  renderStoryboard(main);\n  renderMedia(main);\n  renderActions(main);\n\n  // Product facts (what the script may claim).\n  main.appendChild(h('div', { class: 'card' }, [\n    h('h3', { style: 'margin-top:0', text: '확인된 기능 (PRODUCTS)' }),\n    h('ul', { style: 'margin:0;padding-left:20px' }, d.product.facts.map(function (f) { return h('li', { text: f }); })),\n    h('div', { class: 'row', style: 'margin-top:8px' }, [\n      h('span', { class: 'chip ' + (d.product.permissionOk ? 'ok' : 'warn'), text: '영상 허가: ' + d.product.permission }),\n      h('span', { class: 'chip ' + (d.product.affiliateUrlOk ? 'ok' : 'warn'), text: d.product.affiliateUrlOk ? '제휴 링크 ✓' : '제휴 링크 필요' }),\n    ]),\n  ]));\n\n  // Full script.\n  const r = d.reel;\n  const scriptCard = h('div', { class: 'card' }, [\n    h('div', { class: 'row' }, [\n      h('span', { class: 'chip', text: '콘텐츠 기둥: ' + (d.pillar && d.pillar.label ? d.pillar.label : '미지정') }),\n      (d.verificationFlags || []).length ? h('span', { class: 'chip warn', text: '확인 필요 ' + d.verificationFlags.length }) : null,\n    ]),\n    h('div', { class: 'muted', text: r.concept }),\n    h('h3', { text: '후킹 (문제 제시 · 첫 0~3초)' }),\n    h('div', { class: 'hook', text: r.hook }),\n    h('h3', { text: '내레이션' }), h('div', { class: 'pre', text: r.narration }),\n    h('h3', { text: '자막' }), h('div', { class: 'pre', text: (r.captions || []).join('\\n') }),\n    h('h3', { text: '사용한 확인 기능' }), h('div', { class: 'pre muted', text: (r.facts_used || []).join('\\n') }),\n    h('h3', { text: 'CTA · ManyChat 키워드' }), h('div', { class: 'pre', text: d.cta + '\\n키워드: ' + d.keyword }),\n    h('h3', { text: '광고 표기' }), h('div', { class: 'pre', text: d.disclosure }),\n  ]);\n  if (d.scenesInvalid) scriptCard.appendChild(h('div', { class: 'banner bad', text: '장면(JSON) 셀이 손상되었습니다. 수정 요청 후 재생성하세요.' }));\n  (r.scenes || []).forEach(function (s) {\n    scriptCard.appendChild(h('div', { class: 'scene' }, [\n      h('strong', { text: '장면 ' + s.scene_no + (s.beat ? ' · ' + s.beat : '') + ' · ' + s.duration_sec + '초' }),\n      s.ai_visualization ? h('span', { class: 'chip warn', style: 'margin-left:6px', text: d.brand ? d.brand.aiLabel : 'AI 시뮬레이션' }) : null,\n      s.narration ? h('div', { class: 'hook', text: '“' + s.narration + '”' }) : null,\n      h('div', { class: 'muted', text: '화면 연출: ' + s.visual }),\n      s.emphasis ? h('div', { class: 'muted', text: '자막 강조: ' + s.emphasis }) : null,\n      s.sfx ? h('div', { class: 'muted', text: '효과음: ' + s.sfx }) : null,\n      s.on_screen_text ? h('div', { class: 'muted', text: '화면 문구: ' + s.on_screen_text }) : null,\n      d.approvedIntact\n        ? copyBlock('Google Flow 프롬프트 (수동 생성)', s.flow_prompt, true)\n        : h('div', {}, [h('div', { class: 'muted', text: 'Google Flow 프롬프트 — 대본 승인 후 복사·생성 (Flow 크레딧 보호)' }), h('div', { class: 'flow mono', text: s.flow_prompt })]),\n    ]));\n  });\n  main.appendChild(h('h2', { text: '대본' }));\n  main.appendChild(scriptCard);\n\n  // Touchpoints + history (audit).\n  main.appendChild(h('h2', { text: '운영자 확인 4단계' }));\n  main.appendChild(h('div', { class: 'card' }, d.touchpoints.map(function (t) {\n    return h('div', { class: 'tp' }, [\n      h('div', { class: 'dot' + (t.done ? ' done' : ''), text: t.done ? '✓' : String(t.n) }),\n      h('div', {}, [h('div', { text: t.label }), h('div', { class: 'muted', text: t.detail })]),\n    ]);\n  })));\n  main.appendChild(h('h2', { text: '기록 (AUDIT)' }));\n  main.appendChild(h('div', { class: 'card' }, d.history.length ? d.history.map(function (x) {\n    return h('div', { class: 'hist' }, [\n      h('div', {}, [h('strong', { text: x.label }), ' → ' + (x.to || ''), h('span', { class: 'muted', text: '  ' + fmt(x.at) })]),\n      h('div', { class: 'muted', text: [x.actor, x.scriptVersion ? '대본 v' + x.scriptVersion : '', x.videoVersion ? '영상 v' + x.videoVersion : ''].filter(Boolean).join(' · ') }),\n      x.note ? h('div', { class: 'pre', text: x.note }) : null,\n    ]);\n  }) : [h('div', { class: 'muted', text: '기록 없음' })]));\n}\n\nfunction renderActions(main) {\n  const d = S.detail;\n  const can = function (a) { return d.allowedActions.indexOf(a) !== -1; };\n  const card = h('div', { class: 'card' });\n  const st = d.summary.status;\n\n  if (st === 'SCRIPT_REVIEW_PENDING' || st === 'SCRIPT_CHANGES_REQUESTED') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '② 대본 검토' }));\n    if (st === 'SCRIPT_CHANGES_REQUESTED') {\n      card.appendChild(h('div', { class: 'banner warn', text: '수정 요청: ' + (d.scriptReview.note || '') }));\n    }\n    // Verification flags: the reviewer confirms they are real (or labelled) before approving.\n    const flags = d.verificationFlags || [];\n    let flagBox = null;\n    if (flags.length) {\n      flagBox = h('input', { type: 'checkbox', id: 'flagsOk' });\n      card.appendChild(h('div', { class: 'banner warn' }, [\n        h('strong', { text: '확인 필요 ' + flags.length + '건 — 승인 전에 실제 경험·테스트·AI 표시인지 확인하세요' }),\n        h('ul', { style: 'margin:6px 0;padding-left:20px' }, flags.map(function (f) { return h('li', { text: f }); })),\n        h('label', { style: 'display:flex;gap:8px;align-items:center' }, [flagBox, h('span', { text: '모두 확인했습니다' })]),\n      ]));\n    }\n    // The operator confirms they reviewed the script with the chosen hook (required by the server too).\n    let reviewedBox = null;\n    if (can('APPROVE_SCRIPT') && d.hooks && d.hooks.selectionValid) {\n      reviewedBox = h('input', { type: 'checkbox', id: 'hookReviewed' });\n      card.appendChild(h('label', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0 10px' }, [reviewedBox, h('span', { text: '선택한 훅이 반영된 대본 v' + d.summary.scriptVersion + '을(를) 끝까지 확인했습니다' })]));\n    }\n    const b = h('div', { class: 'btns' });\n    if (can('APPROVE_SCRIPT')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: '승인 (v' + d.summary.scriptVersion + ')',\n      onclick: function () {\n        if (d.hooks && d.hooks.required && !d.hooks.selectionValid) { alert('먼저 위 \"훅 고르기\"에서 훅을 하나 고르세요.'); return; }\n        if (!reviewedBox || !reviewedBox.checked) { alert('선택한 훅이 반영된 대본을 확인했다고 체크한 뒤 승인하세요.'); return; }\n        if (flagBox && !flagBox.checked) { alert('확인 필요 항목을 확인한 뒤 \"모두 확인했습니다\"에 체크하세요.'); return; }\n        act('APPROVE_SCRIPT', { note: '', flagsConfirmed: !!(flagBox && flagBox.checked), hookReviewed: true }, '대본 v' + d.summary.scriptVersion + '을(를) 승인합니다. 이 버전 그대로 영상 제작에 사용됩니다.');\n      } }));\n    if (can('EDIT_SCRIPT')) b.appendChild(h('button', { class: 'b', type: 'button', text: '직접 수정', onclick: function () { S.mode = 'edit'; renderDetail(); } }));\n    if (can('REQUEST_SCRIPT_CHANGES')) b.appendChild(h('button', { class: 'b', type: 'button', text: '수정 요청',\n      onclick: function () { const n = askNote('무엇을 바꿀까요? (재생성 시 Gemini에 전달)', true); if (n !== null) act('REQUEST_SCRIPT_CHANGES', { note: n }); } }));\n    if (d.canRegenerate) b.appendChild(h('button', { class: 'b primary', type: 'button', text: 'Gemini 재생성', onclick: regenerate }));\n    if (can('REJECT_SCRIPT')) b.appendChild(h('button', { class: 'b bad', type: 'button', text: '반려',\n      onclick: function () { const n = askNote('반려 사유 (선택)', false); if (n !== null) act('REJECT_SCRIPT', { note: n }, '이 대본을 반려할까요? 되돌릴 수 없습니다.'); } }));\n    card.appendChild(b);\n  } else if (['SCRIPT_APPROVED', 'VIDEO_IN_PRODUCTION', 'VIDEO_FAILED', 'VIDEO_CHANGES_REQUESTED'].indexOf(st) !== -1) {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '⑥ 최종 편집 (Mac 워커 · Claude 지시서 · FFmpeg)' }));\n    if (st === 'VIDEO_CHANGES_REQUESTED') card.appendChild(h('div', { class: 'banner warn', text: '영상 수정 요청: ' + (d.videoReview.note || '') }));\n    let rightsBox = null;\n    if (!d.product.permissionOk) {\n      rightsBox = h('input', { type: 'checkbox', id: 'rightsConfirmed' });\n      const confirmRightsBtn = h('button', {\n        class: 'b ok', type: 'button', style: 'margin-top:6px',\n        text: '영상 사용 권리 확인 (자체 제작 / Google Flow AI 생성)',\n        onclick: function () { act('CONFIRM_MEDIA_RIGHTS', {}); }\n      });\n      card.appendChild(h('div', { class: 'banner warn' }, [\n        h('strong', { text: '영상 사용 권리 미확인' }),\n        h('div', { style: 'margin:4px 0 6px', text: 'Google Flow AI 생성 또는 직접 촬영한 영상만 사용 시, 아래 체크 후 바로 최종 편집을 시작할 수 있습니다 (PRODUCTS 시트 직접 수정 불필요).' }),\n        h('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer' }, [\n          rightsBox,\n          h('span', { text: 'Google Flow 및 직접 제작(자체 촬영/AI 생성) 영상 권리를 확인합니다 (자체 제작)' })\n        ]),\n        confirmRightsBtn,\n      ]));\n    }\n    if (!d.approvedIntact && st !== 'VIDEO_IN_PRODUCTION') card.appendChild(h('div', { class: 'banner bad', text: '승인된 대본이 변경되었습니다. 승인 취소 후 다시 승인하세요.' }));\n\n    if (d.media && d.media.clips && d.media.clips.length) {\n      const upCount = d.media.clips.filter(function (c) { return c.current; }).length;\n      const totCount = d.media.clips.length;\n      const allExist = upCount === totCount;\n      card.appendChild(h('div', { class: 'row', style: 'margin:8px 0' }, [\n        h('span', { class: 'chip ' + (allExist ? 'ok' : 'warn'), text: '클립 업로드 현황: ' + upCount + '/' + totCount + (allExist ? ' (모두 준비됨 ✓)' : '') }),\n        h('span', { class: 'chip ' + (d.media.allApproved ? 'ok' : 'warn'), text: '클립 승인: ' + d.media.approved + '/' + totCount }),\n      ]));\n      if (!allExist) {\n        card.appendChild(h('div', { class: 'banner warn', text: '최종 편집을 진행하려면 5개 장면 클립이 모두 업로드되어야 합니다 (현재 ' + upCount + '/' + totCount + '). 아래 클립 작업실에서 미등록 클립을 업로드하세요.' }));\n      }\n    }\n\n    const b = h('div', { class: 'btns' });\n    if (can('START_VIDEO')) {\n      const startBtn = h('button', {\n        class: 'b primary', type: 'button', text: '최종 편집 시작',\n        disabled: (!d.product.permissionOk && (!rightsBox || !rightsBox.checked)) || !d.approvedIntact,\n        onclick: function () {\n          if (!d.product.permissionOk && (!rightsBox || !rightsBox.checked)) {\n            alert('Google Flow 및 직접 제작 영상 권리 확인에 체크하세요.');\n            return;\n          }\n          act('START_VIDEO', { rightsConfirmed: !!(rightsBox && rightsBox.checked) });\n        }\n      });\n      if (rightsBox) {\n        rightsBox.addEventListener('change', function () {\n          startBtn.disabled = (!d.product.permissionOk && !rightsBox.checked) || !d.approvedIntact;\n        });\n      }\n      b.appendChild(startBtn);\n    }\n    if (d.media && d.media.clips && d.media.clips.some(function (c) { return c.status === 'PENDING_REVIEW'; })) {\n      b.appendChild(h('button', {\n        class: 'b ok', type: 'button', text: '전체 클립 일괄 승인',\n        onclick: function () {\n          busy(true, '전체 클립 승인 중…');\n          call('apiApproveAllClips', d.summary.reelId, {}).then(function (res) {\n            busy(false);\n            if (!res.ok) { toast(res.error, 8000); return; }\n            S.detail = res.detail; renderDetail();\n            toast(res.approvedCount + '개 클립을 일괄 승인했습니다.');\n          });\n        }\n      }));\n    }\n    const clipGate = d.media && d.media.gated && !d.media.allApproved;\n    if (st === 'VIDEO_IN_PRODUCTION') b.appendChild(h('button', { class: 'b', type: 'button', text: '렌더 작업 파일 (Mac)' + (clipGate ? ' — 클립 ' + d.media.approved + '/' + d.media.total + ' 승인' : ''), disabled: clipGate, onclick: openRenderJob }));\n    if (can('REGISTER_VIDEO')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: '완성 MP4 등록',\n      onclick: function () { const u = askNote('Google Drive MP4 공유 링크를 붙여넣으세요', true); if (u !== null) act('REGISTER_VIDEO', { videoUrl: u }); } }));\n    if (can('MARK_VIDEO_FAILED')) b.appendChild(h('button', { class: 'b bad', type: 'button', text: '편집 오류 기록',\n      onclick: function () { const n = askNote('오류 내용', true); if (n !== null) act('MARK_VIDEO_FAILED', { note: n }); } }));\n    if (can('REOPEN_SCRIPT')) b.appendChild(h('button', { class: 'b', type: 'button', text: '대본 승인 취소',\n      onclick: function () { const n = askNote('승인 취소 사유 (선택)', false); if (n !== null) act('REOPEN_SCRIPT', { note: n }); } }));\n    card.appendChild(b);\n    // Detailed scene prompts are generated automatically on approval (free). One 8-second clip per scene.\n    const fp = d.flowScenePrompts || [];\n    card.appendChild(h('h3', { text: 'Google Flow 장면 프롬프트 (' + fp.length + '개 · 장면당 8초 클립 1개)' }));\n    if (!fp.length) {\n      card.appendChild(h('div', { class: 'banner warn', text: '대본 승인 후 자동으로 만들어집니다.' }));\n    } else {\n      card.appendChild(h('div', { class: 'muted', text: '각 프롬프트로 Flow에서 클립을 하나씩 만든 뒤, 위 \"제작 계획\" 카드의 Drive 폴더에 S1.mp4, S2.mp4 … 이름으로 올리세요 (Google Flow에는 공식 API가 없어 직접 만듭니다). \"Drive 동기화\"로 올린 클립을 확인하고, Mac 렌더러가 내려받아 편집합니다.' }));\n      fp.forEach(function (p) {\n        card.appendChild(h('details', { style: 'margin-top:8px' }, [\n          h('summary', { text: 'S' + p.scene + ' · ' + p.beat + ' → 파일 이름 S' + p.scene + '.mp4' }),\n          copyBlock('S' + p.scene + ' 프롬프트', p.prompt, true),\n        ]));\n      });\n    }\n  } else if (st === 'VIDEO_REVIEW_PENDING') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '③ 영상 검토 (v' + d.summary.videoVersion + ')' }));\n    card.appendChild(h('div', { class: 'btns' }, [\n      h('button', { class: 'b ok', type: 'button', text: '영상 승인',\n        onclick: function () { act('APPROVE_VIDEO', { note: '' }, '영상 v' + d.summary.videoVersion + '을(를) 승인할까요? 자동 게시는 되지 않습니다.'); } }),\n      h('button', { class: 'b', type: 'button', text: '수정 요청',\n        onclick: function () { const n = askNote('무엇을 고칠까요?', true); if (n !== null) act('REQUEST_VIDEO_CHANGES', { note: n }); } }),\n      h('button', { class: 'b bad', type: 'button', text: '반려',\n        onclick: function () { const n = askNote('반려 사유 (선택)', false); if (n !== null) act('REJECT_VIDEO', { note: n }, '이 릴스를 반려할까요?'); } }),\n    ]));\n  } else if (st === 'VIDEO_APPROVED') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '게시 준비' }));\n    card.appendChild(h('div', { class: 'muted', text: '위 오류를 PRODUCTS에서 해결한 뒤 다시 시도하세요 (예: 쿠팡 파트너스 링크 입력).' }));\n    card.appendChild(h('div', { class: 'btns one' }, [h('button', { class: 'b primary', type: 'button', text: '게시 준비 다시 시도', onclick: function () { act('MARK_READY_TO_PUBLISH', {}); } })]));\n  } else if (st === 'READY_TO_PUBLISH' || st === 'COMPLETED') {\n    card.appendChild(h('h3', { style: 'margin-top:0', text: '④ 게시 · ManyChat (수동)' }));\n    card.appendChild(h('div', { class: 'btns one' }, [h('button', { class: 'b primary', type: 'button', text: '게시 자료 열기', onclick: openPack })]));\n    const b = h('div', { class: 'btns' });\n    if (can('CONFIRM_PUBLISHED')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: '인스타그램 게시 완료',\n      onclick: function () { const u = askNote('게시물 URL (선택, https://www.instagram.com/…)', false); if (u !== null) act('CONFIRM_PUBLISHED', { instagramUrl: u }); } }));\n    if (can('CONFIRM_MANYCHAT')) b.appendChild(h('button', { class: 'b ok', type: 'button', text: 'ManyChat 설정 완료',\n      onclick: function () { act('CONFIRM_MANYCHAT', {}, '키워드 \"' + d.keyword + '\" 자동화를 직접 켜고, 테스트 댓글로 올바른 링크가 오는 것을 확인했나요?'); } }));\n    card.appendChild(b);\n    if (st === 'COMPLETED') card.appendChild(h('div', { class: 'banner ok', text: '게시와 ManyChat 설정이 확인되었습니다.' }));\n  } else {\n    return;\n  }\n  main.appendChild(card);\n}\n\n// 🎬 Production plan: Gemini plans (Flow prompts, voice pace, subtitle emphasis, cuts, what to check), code and\n// the renderer execute. Only after the script is approved. Product visuals follow the verified product images.\nfunction renderProduction(main) {\n  const d = S.detail;\n  const pr = d.production;\n  if (!pr || !pr.visible) return;\n  const card = h('div', { class: 'card' });\n  card.appendChild(h('h3', { style: 'margin-top:0', text: '🎬 제작 계획 (Gemini가 계획 · 코드가 실행)' }));\n  card.appendChild(h('div', { class: 'muted', text: '승인된 대본은 바꾸지 않습니다. ' + pr.flowNote }));\n  card.appendChild(h('div', { class: 'row', style: 'margin:8px 0' }, [\n    h('span', { class: 'chip ' + (pr.referenceImages ? 'ok' : 'warn'), text: '검증된 제품 이미지 ' + pr.referenceImages + '장' }),\n  ]));\n  if (!pr.plan) {\n    if (pr.stale) card.appendChild(h('div', { class: 'banner warn', text: '이전 제작 계획은 지금 승인된 대본과 맞지 않아 쓰지 않습니다. 새로 만드세요.' }));\n    if (pr.blocker) card.appendChild(h('div', { class: 'banner warn', text: pr.blocker }));\n    else if (!pr.referenceImages) card.appendChild(h('div', { class: 'banner warn', text: 'PRODUCTS의 \"' + pr.referenceImagesField + '\" 열(오른쪽에 직접 추가)에 실제 제품을 보여 주는 이미지의 Google Drive 링크를 줄마다 하나씩 넣으세요. 제품 모양·색은 이 이미지 기준으로 계획합니다.' }));\n    card.appendChild(h('div', { class: 'btns one' }, [\n      h('button', { class: 'b primary', type: 'button', text: '제작 계획 만들기 (Gemini 1회)', disabled: !pr.canPlan || !pr.referenceImages, onclick: makePlan }),\n    ]));\n  } else {\n    const pl = pr.plan;\n    card.appendChild(h('div', { class: 'banner ok', text: '계획 완료 · 대본 v' + pl.scriptVersion + ' 기준 · 제품 이미지 ' + pl.references.length + '장 · Flow 프롬프트는 아래 \"Google Flow 장면 프롬프트\"에 반영되었습니다.' }));\n    card.appendChild(h('h3', { text: '제품 모습 (검증된 이미지 기준)' }));\n    card.appendChild(h('div', { class: 'pre', text: pl.productVisual.summary }));\n    card.appendChild(h('div', { class: 'muted', text: '반드시 같아야 함: ' + pl.productVisual.mustMatch.join(' · ') }));\n    if (pl.productVisual.mustNotShow.length) card.appendChild(h('div', { class: 'muted', text: '보이면 안 됨: ' + pl.productVisual.mustNotShow.join(' · ') }));\n    if (pl.risks.length) card.appendChild(h('div', { class: 'banner warn', text: '클립 확인할 때 주의:\\n- ' + pl.risks.join('\\n- ') }));\n    pl.scenes.forEach(function (sc, i) {\n      const nr = pl.narration[i] || {}; const sb = pl.subtitles[i] || {}; const ed = pl.edit[i] || { cuts: [] };\n      card.appendChild(h('details', { style: 'margin-top:8px' }, [\n        h('summary', { text: '장면 ' + sc.scene_no + ' · 음성 ' + nr.speaking_rate + '배속 · 쉼 ' + nr.pause_after_sec + '초 · 컷 ' + ed.cuts.length + '개' }),\n        h('div', { class: 'muted', text: '자막 강조: ' + ((sb.emphasis_words || []).join(', ') || '없음') + ' (템플릿에서 강조를 켠 경우에만 화면에 표시)' }),\n        h('div', { class: 'muted', text: '컷: ' + ed.cuts.map(function (c) { return c.framing; }).join(' → ') }),\n        h('div', { class: 'muted', text: '클립에서 확인: ' + sc.verify_in_clip.join(' / ') }),\n        h('div', { class: 'muted', text: '이어짐: ' + sc.continuity }),\n      ]));\n    });\n  }\n  // Google Drive folder + clip tracker (Flow clips are generated by hand and uploaded here).\n  if (pr.canPrepareAssets) {\n    card.appendChild(h('h3', { text: 'Google Drive 에셋' }));\n    const a = pr.assets;\n    if (!a) card.appendChild(h('div', { class: 'muted', text: '폴더를 만들면 장면마다 올려야 할 파일 이름(S1.mp4 …)이 목록으로 정리됩니다.' }));\n    else {\n      card.appendChild(h('div', { class: 'row' }, [\n        h('span', { class: 'chip ' + (a.uploaded === a.total ? 'ok' : 'warn'), text: '클립 ' + a.uploaded + '/' + a.total }),\n        h('a', { href: a.folderUrl, target: '_blank', rel: 'noopener', text: 'Drive 폴더 열기' }),\n      ]));\n      card.appendChild(h('div', { class: 'pre' , text: a.clips.map(function (c) { return (c.status === 'UPLOADED' ? '✓ ' : '○ ') + c.file + ' — 장면 ' + c.scene + ' ' + c.beat + (c.parts > 1 ? ' (' + c.part + '/' + c.parts + ')' : ''); }).join('\\n') }));\n      if ((a.extra || []).length) card.appendChild(h('div', { class: 'muted', text: '목록에 없는 파일(무시됨): ' + a.extra.join(', ') }));\n      card.appendChild(h('div', { class: 'muted', text: '마지막 동기화: ' + fmt(a.syncedAt) }));\n    }\n    card.appendChild(h('div', { class: 'btns one' }, [\n      h('button', { class: 'b', type: 'button', text: a ? 'Drive 동기화' : 'Drive 폴더 준비', onclick: syncAssets }),\n    ]));\n  }\n  main.appendChild(h('h2', { text: '제작' }));\n  main.appendChild(card);\n}\n\nfunction makePlan() {\n  const d = S.detail;\n  if (!confirm('승인된 대본으로 제작 계획을 Gemini에게 만들게 할까요? (API 호출 1~2회, 제품 이미지가 함께 전송됩니다. 영상·음성은 만들지 않습니다)')) return;\n  busy(true, 'Gemini가 제작 계획 만드는 중… (최대 1분)');\n  call('apiCreateProductionPlan', d.summary.reelId, { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 9000); return; }\n    S.detail = res.detail; renderDetail();\n    toast('제작 계획을 만들었습니다. Flow 프롬프트가 갱신되었습니다.');\n  });\n}\n\nfunction syncAssets() {\n  const d = S.detail;\n  busy(true, 'Drive 확인 중…');\n  call('apiPrepareAssets', d.summary.reelId, { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 9000); return; }\n    S.detail = res.detail; renderDetail();\n    const a = res.detail.production.assets;\n    toast('Drive 클립 ' + a.uploaded + '/' + a.total + ' 확인');\n  });\n}\n\n// 📱 Media workspace: verified product photos, Google Flow clips (copy prompt → open Flow by hand → upload\n// from this phone), per-clip review. Flow is never automated. The server checks everything again.\nconst MEDIA_RETRIES = 3;\nconst CLIP_STATUS = { MISSING: ['clip', '클립 없음'], PENDING_REVIEW: ['warn', '검토 대기'], APPROVED: ['ok', '승인됨'], REJECTED: ['bad', '다시 만들기'] };\n\nfunction reloadDetail(msg) {\n  return call('apiGetReel', S.detail.summary.reelId).then(function (res) {\n    if (res.ok) { S.detail = res.detail; renderDetail(); }\n    if (msg) toast(msg, 5000);\n  });\n}\nfunction guardOf() {\n  const d = S.detail;\n  return { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion };\n}\nfunction readChunkB64(file, off, len) {\n  return new Promise(function (resolve, reject) {\n    const fr = new FileReader();\n    fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };\n    fr.onerror = function () { reject(fr.error || new Error('파일을 읽지 못했습니다')); };\n    fr.readAsDataURL(file.slice(off, off + len));\n  });\n}\nfunction sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }\n\n// Shrinks a phone photo (max 2048 px, JPEG) so it fits the size limit; returns a base64 string.\nfunction photoToB64(file, maxBytes) {\n  return new Promise(function (resolve, reject) {\n    const url = URL.createObjectURL(file);\n    const img = new Image();\n    img.onload = function () {\n      let side = 2048, q = 0.85;\n      for (let i = 0; i < 6; i++) {\n        const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));\n        const c = document.createElement('canvas');\n        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);\n        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);\n        const b64 = c.toDataURL('image/jpeg', q).split(',')[1];\n        if (b64.length * 0.75 <= maxBytes) { URL.revokeObjectURL(url); return resolve(b64); }\n        side = Math.round(side * 0.75); q = Math.max(0.6, q - 0.05);\n      }\n      URL.revokeObjectURL(url); reject(new Error('사진을 충분히 줄이지 못했습니다.'));\n    };\n    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이 사진을 열 수 없습니다. JPEG 또는 PNG로 올려 주세요.')); };\n    img.src = url;\n  });\n}\n\nasync function uploadPhoto(input, rights, ui) {\n  const md = S.detail.media;\n  const file = input.files && input.files[0];\n  if (!file) { toast('사진을 고르세요.'); return; }\n  if (!rights.checked) { toast('사진 권리 확인에 체크하세요.'); return; }\n  ui.disabled(true); ui.say('줄이는 중…');\n  try {\n    const data = await photoToB64(file, md.limits.refMaxKB * 1024 * 0.95);\n    ui.say('올리는 중…');\n    const res = await call('apiUploadReferencePhoto', S.detail.product.id, { data: data, rightsConfirmed: true });\n    if (!res.ok) { ui.say(res.error, true); ui.disabled(false); return; }\n    toast('제품 참고 사진을 저장했습니다 (' + res.reference.count + '장).', 5000);\n    await reloadDetail();\n  } catch (e) { ui.say(e.message, true); ui.disabled(false); }\n}\n\n// One clip, in chunks. Each chunk is retried; after a doubtful failure the server is asked where to resume.\nasync function uploadClip(c, file, rights, ui) {\n  if (!file) { toast('영상을 고르세요.'); return; }\n  if (!rights.checked) { toast('영상 권리 확인에 체크하세요.'); return; }\n  const mime = file.type || (/\\.mov$/i.test(file.name) ? 'video/quicktime' : /\\.mp4$/i.test(file.name) ? 'video/mp4' : '');\n  ui.disabled(true); ui.say('시작 중…'); ui.progress(0);\n  const start = await call('apiStartClipUpload', S.detail.summary.reelId, Object.assign({ clip: c.key, fileName: file.name, mime: mime, size: file.size, rightsConfirmed: true }, guardOf()));\n  if (!start.ok) { ui.say(start.error, true); ui.disabled(false); return; }\n  let off = 0, last = null;\n  while (off < file.size) {\n    const len = Math.min(start.chunkBytes, file.size - off);\n    let res = null;\n    for (let attempt = 1; attempt <= MEDIA_RETRIES; attempt++) {\n      const data = await readChunkB64(file, off, len);\n      res = await call('apiUploadClipChunk', start.uploadId, off, data);\n      if (res.ok) break;\n      if (/^RETRY:/.test(res.error)) { ui.say('다시 시도 중 (' + attempt + '/' + MEDIA_RETRIES + ')…'); await sleep(1500 * attempt); continue; }\n      // Unsure what Drive has: ask, then continue from its answer.\n      const st = await call('apiClipUploadStatus', start.uploadId);\n      if (st.ok && st.done) { res = st; break; }\n      if (st.ok && st.next !== off) { res = { ok: true, done: false, next: st.next }; break; }\n      if (!st.ok && !/RETRY:/.test(st.error)) break;\n    }\n    if (!res || !res.ok) {\n      ui.say((res && res.error ? res.error.replace(/^RETRY:\\s*/, '') : '업로드에 실패했습니다.') + '\\n같은 영상을 다시 고르고 올리면 처음부터 새로 시작합니다. 계속 실패하면 아래 \"Drive 앱으로 올린 파일 연결\"을 쓰세요.', true);\n      ui.disabled(false); return;\n    }\n    last = res;\n    off = res.done ? file.size : res.next;\n    ui.progress(Math.round(off * 100 / file.size));\n    ui.say(Math.round(off / 1048576 * 10) / 10 + ' / ' + Math.round(file.size / 1048576 * 10) / 10 + ' MB');\n  }\n  if (!last || !last.done) { ui.say('업로드가 끝났지만 등록되지 않았습니다. 새로고침 후 다시 확인하세요.', true); ui.disabled(false); return; }\n  toast(c.key + ' v' + last.version + ' 업로드 완료' + (last.invalidated ? ' — 이전 승인은 무효가 되었습니다' : '') + '. 미리보고 승인하세요.', 6000);\n  await reloadDetail();\n}\n\nfunction reviewClip(c, decision) {\n  let note = '';\n  if (decision === 'REJECT') { note = askNote(c.key + ' v' + c.current.v + ' — 무엇을 다시 만들까요? (필수)', true); if (note === null) return; }\n  else if (!confirm(c.key + ' v' + c.current.v + '을(를) 승인할까요? 제품 모양·색, 자막과 말이 대본과 맞는지, 권리 문제가 없는지 확인했나요?')) return;\n  busy(true, '저장 중…');\n  call('apiReviewClip', S.detail.summary.reelId, Object.assign({ clip: c.key, version: c.current.v, decision: decision, note: note }, guardOf())).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail();\n    toast(c.key + (decision === 'APPROVE' ? ' 승인됨' : ' 반려됨 — 다시 만들어 올리세요'));\n  });\n}\n\nfunction attachClip(c, a, rights) {\n  if (!rights.checked) { toast('영상 권리 확인에 체크하세요.'); return; }\n  busy(true, '연결 중…');\n  call('apiAttachDriveClip', S.detail.summary.reelId, Object.assign({ clip: c.key, fileId: a.fileId, rightsConfirmed: true }, guardOf())).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail(); toast(c.key + ' 연결됨 — 미리보고 승인하세요.');\n  });\n}\n\nfunction uiFor(box, controls) {\n  const msg = h('div', { class: 'muted', style: 'white-space:pre-wrap' });\n  const bar = h('progress', { max: '100', value: '0', style: 'width:100%;display:none' });\n  box.appendChild(bar); box.appendChild(msg);\n  return {\n    say: function (t, bad) { msg.textContent = t; msg.style.color = bad ? '#c62828' : ''; },\n    progress: function (n) { bar.style.display = 'block'; bar.value = n; },\n    disabled: function (on) { controls.forEach(function (el) { el.disabled = on; }); },\n  };\n}\n\nfunction confirmStoryboardBilling(count, isRegen, sceneNo) {\n  const sb = (S.detail && S.detail.storyboard) || {};\n  const model = sb.model || 'gemini-2.5-flash-image';\n  const billing = sb.billing || {};\n  const perImageUsd = billing.perImageUsd != null ? billing.perImageUsd : null;\n  let costLine = '예상 총 비용: 비용 추정치 미설정 (Cost estimate unavailable)';\n  if (perImageUsd != null && isFinite(perImageUsd)) {\n    const total = count * perImageUsd;\n    const totalStr = (total < 0.01 && total > 0) ? total.toFixed(4) : total.toFixed(2);\n    costLine = '예상 총 비용: ~$' + totalStr + ' USD (추정치 / Estimate, 확정 금액 아님)';\n  }\n\n  const title = isRegen\n    ? '장면 S' + sceneNo + ' 스토리보드 이미지 재생성 확인'\n    : (count === 1 ? '장면 S' + sceneNo + ' 스토리보드 이미지 생성 확인' : '전체(' + count + '개 장면) 스토리보드 이미지 생성 확인');\n\n  const warning = billing.warning ||\n    '실제 청구 금액은 다를 수 있으며, 실패하거나 재시도된 API 호출에도 요금이 발생할 수 있습니다 (Actual charges may differ and failed/retried calls may incur charges).';\n\n  const message = [\n    '[' + title + ']',\n    '',\n    '• 생성 이미지 수: ' + count + '장',\n    '• 사용 모델: ' + model,\n    '• ' + costLine,\n    '',\n    '⚠️ 주의사항:',\n    warning,\n    '',\n    '유료 Gemini API 호출을 진행할까요?'\n  ].join('\\n');\n\n  return confirm(message);\n}\n\nfunction generateStoryboard(sceneNo) {\n  if (S.generatingStoryboard) return;\n  const d = S.detail;\n  if (!d || !d.storyboard) return;\n  const count = sceneNo ? 1 : (d.storyboard.totalCount || 5);\n  if (!confirmStoryboardBilling(count, false, sceneNo)) return;\n\n  S.generatingStoryboard = true;\n  const label = sceneNo ? '장면 S' + sceneNo : '모든 장면(' + count + '개)';\n  busy(true, label + ' 이미지 생성 중… (최대 1분)');\n  call('apiGenerateStoryboardImages', d.summary.reelId, {\n    scene: sceneNo || undefined,\n    confirmedBilling: true,\n    expectedStatus: d.summary.status,\n    expectedScriptVersion: d.summary.scriptVersion\n  }).then(function (res) {\n    S.generatingStoryboard = false;\n    busy(false);\n    if (!res.ok) {\n      if (res.error && (res.error.indexOf('HTTP 0') !== -1 || res.error.indexOf('NetworkError') !== -1)) {\n        toast('네트워크 연결 끊김 (HTTP 0). 백엔드에서 생성되었을 수 있으니 화면을 새로고침하여 복구 이미지를 확인하세요. (중복 과금 방지를 위해 즉시 재시도하지 마세요)', 10000);\n      } else {\n        toast(res.error, 9000);\n      }\n      return;\n    }\n    S.detail = res.detail; renderDetail();\n    toast('스토리보드 이미지를 생성했습니다.');\n    refreshAround();\n  }).catch(function (err) {\n    S.generatingStoryboard = false;\n    busy(false);\n    toast(String(err), 9000);\n  });\n}\n\nfunction reviewStoryboard(c, decision) {\n  const d = S.detail;\n  let note = '';\n  if (decision === 'REJECT') {\n    note = askNote(c.key + ' v' + c.current.v + ' — 수정할 내용을 적어 주세요 (재생성에 반영됩니다):', true);\n    if (note === null) return;\n  } else if (!confirm(c.key + ' v' + c.current.v + ' 이미지를 승인할까요? 제품 외형과 연출이 대본 및 실제 제품과 일치하는지 확인했나요?')) {\n    return;\n  }\n  busy(true, '저장 중…');\n  call('apiReviewStoryboardImage', d.summary.reelId, {\n    scene: c.scene,\n    version: c.current.v,\n    decision: decision,\n    note: note,\n    expectedStatus: d.summary.status,\n    expectedScriptVersion: d.summary.scriptVersion\n  }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail();\n    toast(c.key + (decision === 'APPROVE' ? ' 이미지 승인됨' : ' 이미지 수정 요청됨 (종속 비디오 승인 취소)'));\n    refreshAround();\n  });\n}\n\nfunction regenerateStoryboard(c) {\n  if (S.generatingStoryboard) return;\n  const d = S.detail;\n  if (!d || !d.storyboard) return;\n  const note = askNote(c.key + ' 재생성 메모 (선택사항 — 비워두면 이전 메모 또는 대본을 바탕으로 재생성합니다):', false);\n  if (note === null) return;\n\n  if (!confirmStoryboardBilling(1, true, c.scene)) return;\n\n  S.generatingStoryboard = true;\n  busy(true, c.key + ' 이미지 재생성 중…');\n  call('apiRegenerateStoryboardImage', d.summary.reelId, {\n    scene: c.scene,\n    note: note || undefined,\n    confirmedBilling: true,\n    expectedStatus: d.summary.status,\n    expectedScriptVersion: d.summary.scriptVersion\n  }).then(function (res) {\n    S.generatingStoryboard = false;\n    busy(false);\n    if (!res.ok) { toast(res.error, 9000); return; }\n    S.detail = res.detail; renderDetail();\n    toast(c.key + ' 새 이미지가 생성되었습니다 (이전 승인은 무효화됨).');\n    refreshAround();\n  }).catch(function (err) {\n    S.generatingStoryboard = false;\n    busy(false);\n    toast(String(err), 9000);\n  });\n}\n\nfunction recoverStoryboard(sceneNo, fileId) {\n  const d = S.detail;\n  if (!d) return;\n  busy(true, '장면 S' + sceneNo + ' Drive 이미지 복구 중… (과금 없음)');\n  call('apiRecoverStoryboardImage', d.summary.reelId, { scene: sceneNo, fileId: fileId }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 9000); return; }\n    S.detail = res.detail; renderDetail();\n    toast('Drive 이미지를 복구했습니다 (Gemini API 호출 없음).');\n    refreshAround();\n  }).catch(function (err) {\n    busy(false);\n    toast(String(err), 9000);\n  });\n}\n\nconst STORYBOARD_STATUS = {\n  MISSING: ['chip', '이미지 없음'],\n  PENDING_REVIEW: ['chip warn', '검토 대기'],\n  APPROVED: ['chip ok', '승인됨'],\n  REJECTED: ['chip bad', '수정 요청됨'],\n};\n\nfunction renderStoryboard(main) {\n  const d = S.detail;\n  const sb = d.storyboard;\n  if (!sb || !sb.visible) return;\n  const card = h('div', { class: 'card' });\n  card.appendChild(h('h3', { style: 'margin-top:0', text: '⑤ 이미지(ChatGPT/Gemini) & 영상(Google Flow) 프롬프트 (수동 개발 · 무료)' }));\n  card.appendChild(h('div', { class: 'muted', text: '유료 이미지 생성 API 호출 없이, 각 장면에 최적화된 프롬프트를 복사하여 ChatGPT(DALL-E)나 Gemini에서 9:16 이미지를 만들고, Google Flow에서 비디오를 직접 제작하세요. 완성된 클립은 아래 6단계 클립 작업실에 업로드하면 됩니다.' }));\n\n  if (sb.blocker) {\n    card.appendChild(h('div', { class: 'banner warn', style: 'margin-top:8px', text: sb.blocker }));\n    main.appendChild(card);\n    return;\n  }\n\n  const billing = sb.billing || {};\n  card.appendChild(h('div', { class: 'row', style: 'margin:8px 0' }, [\n    h('span', { class: 'chip ' + (sb.referencesCount ? 'ok' : 'warn'), text: '참고 사진 ' + sb.referencesCount + '장' }),\n    h('span', { class: 'chip ' + (sb.allApproved ? 'ok' : 'warn'), text: '스토리보드 승인 ' + sb.approvedCount + '/' + sb.totalCount }),\n  ]));\n  card.appendChild(h('div', { class: 'muted', style: 'font-size:12px;margin:2px 0 10px 0', text: '💡 [선택] Gemini 자동 생성 모델: ' + (sb.model || 'gemini-2.5-flash-image') + ' · 예상 비용: ' + (billing.costText || 'Cost estimate unavailable') }));\n\n  if (sb.allApproved) {\n    card.appendChild(h('div', { class: 'banner ok', text: '모든 장면의 9:16 이미지가 승인되었습니다. 각 장면의 이미지를 다운로드하고 모션 프롬프트를 복사하여 Google Flow에서 영상을 제작하세요.' }));\n  }\n\n  card.appendChild(h('div', { class: 'btns one', style: 'margin-bottom:12px' }, [\n    h('button', {\n      class: 'b', type: 'button', disabled: !sb.canGenerate || !!S.generatingStoryboard,\n      onclick: function () { generateStoryboard(0); },\n      text: '전체 스토리보드 생성 (S1~S' + sb.totalCount + ' · 선택 사항)',\n    }),\n  ]));\n\n  (sb.images || []).forEach(function (c) {\n    const st = STORYBOARD_STATUS[c.status] || ['chip', c.status];\n    const box = h('div', { class: 'scene' });\n    box.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, [\n      h('strong', { text: c.key + ' · ' + c.beat + ' · ' + c.duration_sec + '초' }),\n      h('span', { class: st[0], text: st[1] + (c.current ? ' · v' + c.current.v : '') }),\n    ]));\n    if (c.narration) box.appendChild(h('div', { class: 'hook', text: '“' + c.narration + '”' }));\n    if (c.visual) box.appendChild(h('div', { class: 'muted', text: '연출: ' + c.visual }));\n\n    // Always provide copyable prompts for manual image and video generation\n    box.appendChild(h('div', { style: 'margin:8px 0' }, [\n      copyBlock('ChatGPT/Gemini 9:16 이미지 프롬프트 (무료 수동 생성용)', c.imagePrompt || c.visual),\n      copyBlock('Google Flow 모션/비디오 프롬프트', c.motionPrompt),\n      h('div', { class: 'row', style: 'margin-top:6px' }, [\n        h('a', { class: 'b', href: sb.flowUrl, target: '_blank', rel: 'noopener', text: 'Google Flow 열기 ↗' }),\n      ]),\n    ]));\n\n    if (c.current) {\n      const previewBox = h('div', { style: 'text-align:center;margin:8px 0' });\n      previewBox.appendChild(h('img', {\n        src: 'https://drive.google.com/thumbnail?id=' + c.current.fileId + '&sz=w800',\n        style: 'width:100%;max-width:220px;aspect-ratio:9/16;border-radius:12px;object-fit:cover;display:inline-block;background:#111;box-shadow:0 2px 8px rgba(0,0,0,.15)',\n        alt: c.key + ' 스토리보드 이미지',\n      }));\n      box.appendChild(previewBox);\n\n      box.appendChild(h('div', { class: 'muted', text: c.current.name + ' · 생성: ' + fmt(c.current.generatedAt) + (c.current.reviewedBy ? ' · 검토자: ' + c.current.reviewedBy : '') }));\n      if (c.current.note) {\n        box.appendChild(h('div', { class: 'banner warn', style: 'margin:6px 0', text: '수정 요청 메모: ' + c.current.note }));\n      }\n\n      const btnRow = h('div', { class: 'btns' });\n      if (c.status === 'PENDING_REVIEW') {\n        btnRow.appendChild(h('button', { class: 'b ok', type: 'button', text: '승인', onclick: function () { reviewStoryboard(c, 'APPROVE'); } }));\n        btnRow.appendChild(h('button', { class: 'b bad', type: 'button', text: '수정 요청', onclick: function () { reviewStoryboard(c, 'REJECT'); } }));\n        btnRow.appendChild(h('button', { class: 'b primary', type: 'button', disabled: !!S.generatingStoryboard, text: '재생성', onclick: function () { regenerateStoryboard(c); } }));\n      } else if (c.status === 'APPROVED') {\n        btnRow.appendChild(h('button', { class: 'b bad', type: 'button', text: '승인 취소·수정 요청', onclick: function () { reviewStoryboard(c, 'REJECT'); } }));\n        btnRow.appendChild(h('button', { class: 'b primary', type: 'button', disabled: !!S.generatingStoryboard, text: '재생성', onclick: function () { regenerateStoryboard(c); } }));\n      } else if (c.status === 'REJECTED') {\n        btnRow.appendChild(h('button', { class: 'b primary', type: 'button', disabled: !!S.generatingStoryboard, text: '수정 반영 재생성', onclick: function () { regenerateStoryboard(c); } }));\n      }\n      box.appendChild(btnRow);\n\n      box.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, [\n        h('a', { class: 'b', href: c.current.downloadUrl, target: '_blank', rel: 'noopener', text: '이미지 다운로드 ↓' }),\n      ]));\n\n      box.appendChild(h('details', { style: 'margin-top:8px' }, [\n        h('summary', { text: '버전 기록 (' + c.versions.length + ')' }),\n        h('div', { class: 'muted', style: 'white-space:pre-wrap;margin-top:6px', text: c.versions.map(function (v) {\n          return 'v' + v.v + ' · ' + v.status + ' · ' + fmt(v.generatedAt) + (v.reviewedBy ? ' · ' + v.reviewedBy : '') + (v.note ? ' · ' + v.note : '');\n        }).join('\\n') }),\n      ]));\n    } else {\n      if (c.recoverable && c.recoverable.length) {\n        c.recoverable.forEach(function (rec) {\n          box.appendChild(h('div', { class: 'banner info', style: 'margin-top:8px' }, [\n            h('div', { text: '💾 Drive에 생성된 이미지(' + rec.fileName + ')가 발견되었습니다.' }),\n            h('button', {\n              class: 'b ok', type: 'button', style: 'margin-top:6px;width:100%',\n              onclick: function () { recoverStoryboard(c.scene, rec.fileId); },\n              text: 'Drive 이미지 복구 (API 호출 없음)',\n            }),\n          ]));\n        });\n      }\n      box.appendChild(h('div', { class: 'btns one', style: 'margin-top:8px' }, [\n        h('button', {\n          class: 'b', type: 'button', disabled: !sb.canGenerate || !!S.generatingStoryboard,\n          onclick: function () { generateStoryboard(c.scene); },\n          text: c.key + ' 이미지 생성 (선택 · Gemini)',\n        }),\n      ]));\n    }\n    card.appendChild(box);\n  });\n\n  main.appendChild(card);\n}\n\nfunction renderMedia(main) {\n  const d = S.detail;\n  const md = d.media;\n  if (!md || !md.visible) return;\n  const card = h('div', { class: 'card' });\n  card.appendChild(h('h3', { style: 'margin-top:0', text: '📱 Flow 클립 작업실 (휴대폰에서 업로드·검토)' }));\n  card.appendChild(h('div', { class: 'muted', text: md.flowNote }));\n  if (md.blocker) { card.appendChild(h('div', { class: 'banner warn', text: md.blocker })); main.appendChild(card); return; }\n\n  // Verified product reference photos (max 4): saved in Drive, linked into this product's PRODUCTS cell.\n  const ref = md.references;\n  card.appendChild(h('h3', { text: '② 제품 참고 사진 ' + ref.count + '/' + ref.max + ' (Google Drive)' }));\n  (ref.items || []).forEach(function (it, i) {\n    card.appendChild(h('div', {}, [h('a', { href: it.url, target: '_blank', rel: 'noopener', text: '사진 ' + (i + 1) + ' 열기' })]));\n  });\n  if (!ref.columnPresent) {\n    card.appendChild(h('div', { class: 'banner warn', text: 'PRODUCTS에 \"' + d.production.referenceImagesField + '\" 열이 없어 사진을 올릴 수 없습니다. 열 머리글을 오른쪽에 직접 추가하세요.' }));\n  } else if (ref.count < ref.max) {\n    const pick = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });\n    const ok = h('input', { type: 'checkbox' });\n    const btn = h('button', { class: 'b', type: 'button', text: '사진 올리기' });\n    const box = h('div', {});\n    const ui = uiFor(box, [pick, ok, btn]);\n    btn.addEventListener('click', function () { uploadPhoto(pick, ok, ui); });\n    card.appendChild(h('div', { class: 'muted', text: '실제 제품을 보여 주는 사진만. 사진은 줄여서 비공개 Drive 폴더에 저장하고, 제품 모양·색은 이 사진 기준으로 계획·점검합니다.' }));\n    card.appendChild(pick);\n    card.appendChild(h('label', { style: 'display:flex;gap:8px;align-items:flex-start' }, [ok, h('span', { text: '내가 직접 찍었거나 사용 권한을 확인한 실제 제품 사진입니다 (제품을 샀다고 타인 이미지의 권리가 생기지는 않습니다)' })]));\n    card.appendChild(h('div', { class: 'btns one' }, [btn]));\n    card.appendChild(box);\n  }\n\n  // Scenes: prompt → Flow (manual) → upload → review.\n  card.appendChild(h('h3', { text: '장면 클립 ' + md.approved + '/' + md.total + ' 승인' + (md.gated ? '' : ' (제작 계획 전: 이 승인은 렌더 조건이 아님)') }));\n  if (md.gated && !md.allApproved) card.appendChild(h('div', { class: 'banner warn', text: '모든 장면이 승인되어야 렌더 작업 파일을 받을 수 있습니다. 클립을 교체하면 그 장면의 승인은 무효가 됩니다.' }));\n  if (md.gated && md.allApproved) card.appendChild(h('div', { class: 'banner ok', text: '모든 장면이 승인되었습니다. 이제 렌더 작업 파일을 받을 수 있습니다 (최종 영상 승인과 게시는 직접).' }));\n  const prompts = {};\n  (d.flowScenePrompts || []).forEach(function (p) { prompts[p.file] = p.prompt; });\n  md.clips.forEach(function (c) {\n    const st = CLIP_STATUS[c.status];\n    const box = h('div', { class: 'scene' });\n    box.appendChild(h('div', { class: 'row' }, [\n      h('strong', { text: c.key + ' · ' + c.beat + (c.parts > 1 ? ' (' + c.part + '/' + c.parts + ')' : '') }),\n      h('span', { class: 'chip ' + st[0], text: st[1] + (c.current ? ' · v' + c.current.v : '') }),\n    ]));\n    box.appendChild(h('div', { class: 'row', style: 'margin:6px 0' }, [\n      prompts[c.file] ? h('button', { class: 'b', type: 'button', text: '프롬프트 복사', onclick: function () { copyText(prompts[c.file]); } }) : null,\n      h('a', { class: 'b', href: md.flowUrl, target: '_blank', rel: 'noopener', text: 'Google Flow 열기' }),\n    ]));\n    if (c.current) {\n      const prev = h('div', {});\n      box.appendChild(h('div', { class: 'muted', text: c.current.name + ' · ' + Math.round(c.current.size / 1048576 * 10) / 10 + 'MB · ' + c.current.uploadedBy + ' · ' + fmt(c.current.uploadedAt) + (c.current.note ? '\\n메모: ' + c.current.note : '') }));\n      box.appendChild(h('div', { class: 'row' }, [\n        h('button', { class: 'b', type: 'button', text: '미리보기', onclick: function () {\n          if (prev.firstChild) { clear(prev); return; }\n          prev.appendChild(h('iframe', { src: c.current.previewUrl, style: 'width:100%;aspect-ratio:9/16;max-height:70vh;border:0;border-radius:10px', allow: 'autoplay', allowfullscreen: true }));\n        } }),\n        h('a', { href: c.current.url, target: '_blank', rel: 'noopener', text: 'Drive에서 열기' }),\n      ]));\n      box.appendChild(prev);\n      if (c.status === 'PENDING_REVIEW' || c.status === 'APPROVED') {\n        box.appendChild(h('div', { class: 'btns' }, [\n          c.status === 'PENDING_REVIEW' ? h('button', { class: 'b ok', type: 'button', text: '승인', onclick: function () { reviewClip(c, 'APPROVE'); } }) : null,\n          h('button', { class: 'b bad', type: 'button', text: c.status === 'APPROVED' ? '승인 취소·다시 만들기' : '반려·다시 만들기', onclick: function () { reviewClip(c, 'REJECT'); } }),\n        ]));\n      }\n    }\n    // Upload (or replace). The rights confirmation is required for every upload.\n    const pick = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,.mp4,.mov' });\n    const ok = h('input', { type: 'checkbox' });\n    const btn = h('button', { class: 'b primary', type: 'button', text: c.current ? '교체 업로드 (새 버전)' : '영상 업로드' });\n    const ubox = h('div', {});\n    const ui = uiFor(ubox, [pick, ok, btn]);\n    btn.addEventListener('click', function () { uploadClip(c, pick.files && pick.files[0], ok, ui); });\n    box.appendChild(h('div', { style: 'margin-top:8px' }, [pick]));\n    box.appendChild(h('label', { style: 'display:flex;gap:8px;align-items:flex-start' }, [ok, h('span', { text: 'Google Flow로 직접 만들었거나 사용 권한을 확인한 영상입니다' })]));\n    box.appendChild(h('div', { class: 'btns one' }, [btn]));\n    box.appendChild(ubox);\n    // Fallback: a file put into this reel's Drive folder with the Drive app.\n    (c.attachable || []).forEach(function (a) {\n      box.appendChild(h('div', { class: 'row', style: 'margin-top:6px' }, [\n        h('span', { class: 'muted', text: 'Drive 앱으로 올린 파일: ' + a.name }),\n        h('button', { class: 'b', type: 'button', text: '이 파일 연결', onclick: function () { attachClip(c, a, ok); } }),\n      ]));\n    });\n    if (c.versions.length > 1 || (c.versions[0] && c.versions[0].status !== 'PENDING_REVIEW')) {\n      box.appendChild(h('details', { style: 'margin-top:6px' }, [\n        h('summary', { text: '버전 기록 (' + c.versions.length + ')' }),\n        h('div', { class: 'muted', style: 'white-space:pre-wrap', text: c.versions.map(function (v) { return 'v' + v.v + ' · ' + v.status + ' · ' + fmt(v.uploadedAt) + ' · ' + v.source + (v.note ? ' · ' + v.note : ''); }).join('\\n') }),\n      ]));\n    }\n    card.appendChild(box);\n  });\n  card.appendChild(h('div', { class: 'muted', text: '업로드가 계속 실패하면 Drive 앱으로 \"Reels Factory/' + d.product.id + '/' + d.summary.reelId + '\" 폴더에 올린 뒤 위 \"이 파일 연결\"을 쓰세요 (제작 계획 카드의 \"Drive 동기화\" 후 표시).' }));\n  main.appendChild(card);\n}\n\n// ② Five hooks (H1–H5): Gemini recommends, the operator chooses (and may edit the wording).\n// Shown for every script under review — including scripts written before the five-hook workflow.\nfunction renderHooks(main) {\n  const d = S.detail;\n  const hk = d.hooks;\n  const st = d.summary.status;\n  const reviewing = st === 'SCRIPT_REVIEW_PENDING' || st === 'SCRIPT_CHANGES_REQUESTED';\n  if (!hk || (!reviewing && !(hk.candidates || []).length)) return;\n  const card = h('div', { class: 'card' });\n  card.appendChild(h('h3', { style: 'margin-top:0', text: '① 훅 고르기 (5개 중 1개 — 최종 선택은 직접)' }));\n  if (hk.columnsMissing) {\n    card.appendChild(h('div', { class: 'banner bad', text: 'REELS 시트에 \"훅 후보(JSON)\"·\"선택한 훅\" 열이 없습니다. Google Sheets에서 \"릴스 팩토리 → 시트 준비\"를 실행한 뒤 이 화면을 새로고침하세요. 기존 데이터는 바뀌지 않습니다. 훅을 고르기 전에는 승인할 수 없습니다.' }));\n    main.appendChild(card);\n    return;\n  }\n  if (!hk.candidates.length) {\n    card.appendChild(h('div', { class: 'banner warn', text: '이 대본에는 훅 후보가 없습니다 (훅 5개 기능 이전에 만든 대본). 훅 5개를 만들어 하나를 고른 뒤 승인할 수 있습니다. 대본 자체는 바뀌지 않습니다.' }));\n    if (hk.canGenerate) card.appendChild(h('div', { class: 'btns' }, [\n      h('button', { class: 'b primary', type: 'button', text: '훅 5개 만들기 (Gemini 1회)', onclick: makeHooks }),\n    ]));\n    main.appendChild(card);\n    return;\n  }\n  if (!hk.selectionValid) {\n    card.appendChild(h('div', { class: 'banner warn', text: '승인하려면 먼저 훅을 하나 고르세요. ★추천은 참고만 하세요.' }));\n  } else {\n    card.appendChild(h('div', { class: 'banner ok', text: '선택한 훅: ' + hk.selected.id + ' ' + (hk.selected.label || '') + (hk.selected.edited ? ' (수정)' : '') + ' · 대본 v' + hk.selected.scriptVersion + (hk.selected.by ? ' · ' + hk.selected.by : '') + '\\n아래 \"대본\"에서 바뀐 첫 장면과 전체 흐름을 확인한 뒤 승인하세요.' }));\n    if ((hk.selectedWarnings || []).length) {\n      card.appendChild(h('div', { class: 'banner warn', text: '⚠ 고친 훅 문장 참고 (승인은 막지 않음): ' + hk.selectedWarnings.join(' / ') }));\n    }\n  }\n  const edit = h('textarea', { rows: '2' });\n  let chosen = null;\n  hk.candidates.forEach(function (c) {\n    const isRec = hk.recommended && hk.recommended.id === c.id;\n    const isSel = hk.selected && hk.selected.id === c.id && hk.selectionValid;\n    const radio = h('input', { type: 'radio', name: 'hookPick', value: c.id });\n    if (isSel || (!hk.selectionValid && isRec)) { radio.checked = true; chosen = c; edit.value = isSel ? hk.selected.text : c.text; }\n    radio.addEventListener('change', function () { chosen = c; edit.value = c.text; });\n    card.appendChild(h('label', { class: 'scene', style: 'display:flex;gap:10px;align-items:flex-start' }, [\n      radio,\n      h('div', {}, [\n        h('div', { class: 'row' }, [\n          h('strong', { text: c.id + ' · ' + c.label }),\n          isRec ? h('span', { class: 'chip ok', text: '★ 추천' }) : null,\n          isSel ? h('span', { class: 'chip', text: '선택됨' }) : null,\n        ]),\n        h('div', { class: 'hook', text: c.text }),\n        // Style warnings: safe to use; the operator may still pick, edit, or have Gemini improve this one hook.\n        ((hk.warnings || {})[c.id] || []).length ? h('div', { class: 'hookwarn' }, [\n          h('div', { text: '⚠ 스타일 참고 (사용 가능 · 승인은 막지 않음)' }),\n          h('ul', { style: 'margin:4px 0;padding-left:20px' }, hk.warnings[c.id].map(function (w) { return h('li', { text: w }); })),\n          hk.canRevise ? h('button', { class: 'b', type: 'button', text: '이 훅만 다듬기 (Gemini 1회)', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); reviseHook(c); } }) : null,\n        ]) : null,\n        c.visual ? h('div', { class: 'muted', text: '첫 장면: ' + c.visual }) : null,\n        isRec && hk.recommended.reason ? h('div', { class: 'muted', text: '추천 이유: ' + hk.recommended.reason }) : null,\n      ]),\n    ]));\n  });\n  if (hk.canSelect) {\n    card.appendChild(h('label', { text: '훅 문장 (고칠 수 있음 · 확인된 기능 밖의 내용은 거부됩니다)' }));\n    card.appendChild(edit);\n    card.appendChild(h('div', { class: 'btns' }, [\n      h('button', { class: 'b ok', type: 'button', text: '이 훅으로 정하기 (무료)', onclick: function () { pickHook(chosen, edit.value, 'keep'); } }),\n      h('button', { class: 'b primary', type: 'button', text: '대본 다시 쓰기 (Gemini)', onclick: function () { pickHook(chosen, edit.value, 'regenerate'); } }),\n    ]));\n    card.appendChild(h('div', { class: 'muted', text: '\"정하기\"는 첫 장면(말·자막·화면 연출·Flow 프롬프트)을 이 훅의 것으로 바꿉니다 (무료). \"다시 쓰기\"는 이 훅에 맞게 대본 전체를 Gemini로 새로 씁니다 (호출 1~2회). 바뀐 대본은 새 버전이 되고, 확인 후 승인합니다.' }));\n  }\n  main.appendChild(h('h2', { text: '훅' }));\n  main.appendChild(card);\n}\n\nfunction makeHooks() {\n  const d = S.detail;\n  if (!confirm('이 대본에 쓸 훅 5개를 Gemini로 만들까요? (API 호출 1~3회, 대본은 바뀌지 않습니다)')) return;\n  busy(true, 'Gemini로 훅 5개 만드는 중… (최대 1분)');\n  call('apiGenerateHooks', d.summary.reelId, { expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail();\n    toast('훅 5개를 만들었습니다. 하나를 고르세요.');\n  });\n}\n\nfunction reviseHook(c) {\n  const d = S.detail;\n  if (!confirm(c.id + ' 훅 하나만 Gemini로 다듬을까요? (API 호출 1회, 다른 훅과 대본은 바뀌지 않습니다)')) return;\n  busy(true, 'Gemini로 ' + c.id + ' 다듬는 중… (최대 30초)');\n  call('apiReviseHook', d.summary.reelId, { hookId: c.id, expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail();\n    toast(res.notice || '훅을 다듬었습니다.', 6000);\n  });\n}\n\nfunction pickHook(chosen, text, mode) {\n  const d = S.detail;\n  if (!chosen) { toast('훅을 하나 고르세요.'); return; }\n  text = String(text || '').trim();\n  if (!text) { toast('훅 문장이 비어 있습니다.'); return; }\n  if (mode === 'regenerate' && !confirm('이 훅으로 대본 전체를 Gemini로 다시 쓸까요? (API 호출 1~2회, 새 대본 버전)')) return;\n  busy(true, mode === 'regenerate' ? 'Gemini로 대본 다시 쓰는 중… (최대 1분)' : '저장 중…');\n  call('apiSelectHook', d.summary.reelId, {\n    hookId: chosen.id, text: text, mode: mode,\n    expectedStatus: d.summary.status, expectedScriptVersion: d.summary.scriptVersion,\n  }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail();\n    toast('훅 ' + chosen.id + ' 선택 · 대본 v' + res.detail.summary.scriptVersion + ' (REELS·AUDIT 기록)');\n    refreshAround();\n  });\n}\n\nfunction regenerate() {\n  const d = S.detail;\n  if (!confirm('수정 요청 메모를 반영해 이 대본 1개를 Gemini로 다시 작성할까요? (API 호출 1~2회)')) return;\n  busy(true, 'Gemini로 재생성 중… (최대 1분)');\n  call('apiRegenerateScript', d.summary.reelId, { expectedScriptVersion: d.summary.scriptVersion }).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    S.detail = res.detail; renderDetail(); toast('새 버전 v' + res.detail.summary.scriptVersion + '이(가) 검토 대기 중입니다.');\n    refreshAround();\n  });\n}\n\n// Signed render job for the Mac/cloud renderer. Issued only for approved reels in production.\nfunction openRenderJob() {\n  busy(true);\n  call('apiGetRenderJob', S.detail.summary.reelId).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 8000); return; }\n    const main = clear(document.getElementById('main'));\n    main.appendChild(h('button', { class: 'link', type: 'button', onclick: renderDetail, text: '‹ ' + S.detail.summary.reelId }));\n    main.appendChild(h('div', { class: 'banner warn', text: '이 파일은 72시간 동안 유효합니다. Mac에서 renderer/jobs/' + res.fileName + ' 로 저장한 뒤:\\n\\nnpm run render:fetch-clips -- --job renderer/jobs/' + res.fileName + '\\n(승인한 클립을 Drive에서 내려받음)\\nnpm run render -- --job renderer/jobs/' + res.fileName + ' --dry-run\\n(비용·계획 확인 후) --dry-run 없이 다시 실행' }));\n    const a = h('a', { href: 'data:application/json;charset=utf-8,' + encodeURIComponent(res.jobFile), download: res.fileName, text: '파일 다운로드 ↓' });\n    main.appendChild(h('div', { class: 'card' }, [a, copyBlock(res.fileName, res.jobFile, true)]));\n    window.scrollTo(0, 0);\n  });\n}\n\nfunction openPack() {\n  busy(true);\n  call('apiGetPublishingPack', S.detail.summary.reelId).then(function (res) {\n    busy(false);\n    if (!res.ok) { toast(res.error, 6000); return; }\n    const p = res.pack;\n    const main = clear(document.getElementById('main'));\n    main.appendChild(h('button', { class: 'link', type: 'button', onclick: renderDetail, text: '‹ ' + p.reelId }));\n    main.appendChild(h('div', { class: 'banner warn', text: '자동 게시·자동 DM은 하지 않습니다. 아래 순서대로 직접 진행하세요.' }));\n    main.appendChild(h('div', { class: 'card' }, [\n      h('h3', { style: 'margin-top:0', text: '1. 영상' }),\n      h('a', { href: p.videoUrl, target: '_blank', rel: 'noopener', text: 'Drive에서 MP4 열기 ↗' }),\n      h('div', { class: 'muted', text: 'Drive 앱 → ⋯ → 사본 보내기 → 동영상 저장' }),\n    ]));\n    main.appendChild(h('div', { class: 'card' }, [h('h3', { style: 'margin-top:0', text: '2. 인스타그램 캡션' }), copyBlock('첫 줄 광고 표기 유지', p.instagramCaption)]));\n    main.appendChild(h('div', { class: 'card' }, [\n      h('h3', { style: 'margin-top:0', text: '3. ManyChat' }),\n      copyBlock('댓글 키워드', p.manychatKeyword, true),\n      copyBlock('DM 문구 (쿠팡 파트너스 링크 포함)', p.manychatDm),\n      copyBlock('쿠팡 파트너스 링크', p.affiliateUrl, true),\n    ]));\n    main.appendChild(h('div', { class: 'card' }, [h('h3', { style: 'margin-top:0', text: '체크리스트' }),\n      h('ol', { style: 'margin:0;padding-left:20px' }, p.checklist.map(function (c) { return h('li', { text: c }); }))]));\n    window.scrollTo(0, 0);\n  });\n}\n\n// ---------------------------------------------------------------- editor\nfunction renderEditor(main) {\n  const d = S.detail;\n  const r = d.reel;\n  // Storyboard scripts: each scene's line is the narration and the subtitle.\n  const storyboard = (r.scenes || []).some(function (s) { return s.beat || s.narration; });\n  const f = {};\n  function field(key, label, value, multiline) {\n    f[key] = multiline ? h('textarea', {}) : h('input', { type: 'text' });\n    f[key].value = value || '';\n    return h('div', {}, [h('label', { text: label }), f[key]]);\n  }\n  const card = h('div', { class: 'card' }, [\n    h('div', { class: 'banner warn', text: '수정하면 새 버전(v' + (d.summary.scriptVersion + 1) + ')이 되고 다시 승인해야 합니다. 숫자·기능은 PRODUCTS의 확인된 기능에 있는 것만 쓸 수 있습니다.' }),\n    d.pillars ? h('div', {}, [h('label', { text: '콘텐츠 기둥' }), (f.pillar = h('select', {}, [h('option', { value: '', text: '(그대로)' })].concat(d.pillars.map(function (p) {\n      const o = h('option', { value: p.id, text: p.label });\n      if (d.pillar && d.pillar.id === p.id) o.selected = true;\n      return o;\n    }))))]) : null,\n    field('concept', '컨셉', r.concept),\n    field('hook', '후킹 (40자 이내)', r.hook),\n    storyboard ? null : field('narration', '내레이션 (300자 이내)', r.narration, true),\n    storyboard ? null : field('captions', '자막 (한 줄에 하나, 각 40자 이내)', (r.captions || []).join('\\n'), true),\n  ]);\n  (r.scenes || []).forEach(function (s, i) {\n    card.appendChild(h('h3', { text: '장면 ' + s.scene_no + (s.beat ? ' · ' + s.beat : '') + ' · ' + s.duration_sec + '초' }));\n    if (storyboard) card.appendChild(field('s' + i + 'line', '내레이션 = 자막 (30자 이내, CTA에는 {키워드})', s.narration));\n    card.appendChild(field('s' + i + 'visual', '장면 설명', s.visual, true));\n    if (!storyboard) card.appendChild(field('s' + i + 'text', '화면 문구', s.on_screen_text));\n    card.appendChild(field('s' + i + 'flow', 'Flow 프롬프트 (영어)', s.flow_prompt, true));\n    f['s' + i + 'ai'] = h('input', { type: 'checkbox' });\n    f['s' + i + 'ai'].checked = !!s.ai_visualization;\n    card.appendChild(h('label', { style: 'display:flex;gap:8px;align-items:center' }, [f['s' + i + 'ai'], h('span', { text: 'AI 시뮬레이션 장면 (영상에 표시)' })]));\n  });\n  card.appendChild(field('note', '수정 메모 (선택)', '', true));\n  card.appendChild(h('div', { class: 'btns' }, [\n    h('button', { class: 'b', type: 'button', text: '취소', onclick: function () { S.mode = 'view'; renderDetail(); } }),\n    h('button', { class: 'b primary', type: 'button', text: '저장 (v' + (d.summary.scriptVersion + 1) + ')', onclick: function () {\n      const edit = {\n        concept: f.concept.value, hook: f.hook.value,\n        pillar: f.pillar && f.pillar.value ? f.pillar.value : undefined,\n        narration: storyboard ? undefined : f.narration.value,\n        captions: storyboard ? undefined : f.captions.value.split('\\n').map(function (x) { return x.trim(); }).filter(Boolean),\n        scenes: (r.scenes || []).map(function (s, i) {\n          const out = { visual: f['s' + i + 'visual'].value, flow_prompt: f['s' + i + 'flow'].value, ai_visualization: f['s' + i + 'ai'].checked };\n          if (storyboard) out.narration = f['s' + i + 'line'].value; else out.on_screen_text = f['s' + i + 'text'].value;\n          return out;\n        }),\n      };\n      act('EDIT_SCRIPT', { edit: edit, note: f.note.value });\n    } }),\n  ]));\n  main.appendChild(card);\n}\n\nloadDashboard();\n</script>\n</body>\n</html>\n";
