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
