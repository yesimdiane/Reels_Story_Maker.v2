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
