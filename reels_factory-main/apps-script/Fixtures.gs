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
