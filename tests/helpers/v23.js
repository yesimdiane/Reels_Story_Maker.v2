// Shared helpers for the V2.3 tests: a Studio in a temp dir with MOCK video, a fake paid AI provider (no network), tiny PNGs.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../../renderer/lib/config');
const { createStudio } = require('../../studio/lib/studio');
const { createMockVideoProvider } = require('../../studio/lib/providers/mock');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// Header-only stub reporting 400x400 (products require >=100px; nothing in the tests decodes it).
const PNG400 = Buffer.from(PNG); PNG400.writeUInt32BE(400, 16); PNG400.writeUInt32BE(400, 20);
const png = (n = 0) => Buffer.concat([PNG400, Buffer.from([n, n + 1, n + 2])]);

const CYCLE = ['drama', 'viral', 'info'];
/** A fake AI's concept answer. `plan` = categories per concept (default: one of each in order, repeating); every concept carries its category + Korean translations. */
const goodConcepts = (n = 3, tag = '', plan) => ({
  concepts: [
    ['현관 우산 대참사', '비 오는 날 현관이 물바다가 되어 Jack이 우산을 놓을 곳을 못 찾는다', '자석에 우산이 착 붙으며 Jack이 말을 잃는다'],
    ['절대 안 쓴다던 남편', 'Diane이 새 물건을 가져오자 Jack이 단호하게 거절한다', '결국 Jack이 가장 먼저 매일 사용한다'],
    ['정리 내기', '두 사람이 누가 더 빨리 정리하는지 내기를 한다', '정리가 끝난 현관을 보고 둘 다 놀란다'],
    ['택배 미스터리', '밤늦게 도착한 택배 상자를 두고 Jack이 추궁한다', '상자 속 물건이 오히려 Jack의 고민을 풀어준다'],
    ['아침 출근 전쟁', '출근 직전 우산을 찾느라 집이 난장판이 된다', '다음 날은 우산이 제자리에 있어 둘이 여유롭다'],
  ].slice(0, n).map((c, i) => ({ title: c[0] + tag, hook: c[1], situation: c[1] + ' ' + (i + 1), plot: c[1] + ' → ' + c[2] + ' (' + (i + 1) + ')', visualComedy: '과장된 표정 리액션 ' + (i + 1), estimatedScenes: 6, productRole: '확인된 기능 범위에서만 보여줌', characterUsage: i % 2 ? 'Diane 중심' : 'Jack 중심', payoff: c[2], viewerAppeal: '공감', ctaDirection: '댓글 키워드로 링크 안내', estimatedDurationSec: 40, storyline: c[1] + ' → ' + c[2] + ' (' + (i + 1) + ') — 그리고 마지막에 처음의 궁금증이 풀린다.', storyline_ko: c[1] + ' → ' + c[2] + ' (번역 ' + (i + 1) + ')', category: (plan || [])[i] || CYCLE[i % 3], title_ko: c[0] + tag + ' (번역)', hook_ko: c[1] + ' (번역)', situation_ko: c[1] + ' ' + (i + 1) + ' (번역)', plot_ko: c[1] + ' (번역)', productRole_ko: '확인된 기능 범위에서만 보여줌', characterUsage_ko: '번역', visualComedy_ko: '번역 ' + (i + 1), payoff_ko: c[2] + ' (번역)', viewerAppeal_ko: '공감', ctaDirection_ko: '댓글 키워드로 링크 안내' })),
});
/** Answers a concept request using the CATEGORY_PLAN line in the prompt (what a well-behaved AI would do). */
const conceptsForPrompt = (req, tag = '') => { const m = /CATEGORY_PLAN:\s*(.+)/.exec(req.prompt || ''); const plan = m ? m[1].split(',').map((x) => x.trim()) : undefined; const max = Number((/MAX_DURATION_SEC:\s*(\d+)/.exec(req.prompt || '') || [, 90])[1]); const out = goodConcepts(plan ? plan.length : 3, tag, plan); out.concepts.forEach((c) => { c.estimatedDurationSec = Math.min(c.estimatedDurationSec, max); }); return out; };

const goodScript = () => ({
  title: '현관 대참사', beats: ['문제', '발견', '반전'],
  scenes: [
    { id: 'S1', title_ko: '물바다가 된 현관', title: '물바다가 된 현관', beat: 1, durationSec: 5, characters: ['jack'], showsProduct: false, visual: 'Jack drips rainwater in the entryway', action: 'Jack sighs', narration: '', placement: '' },
    { id: 'S2', title_ko: '아내의 신문물 자랑', title: '아내의 신문물 자랑', beat: 2, durationSec: 5, characters: ['diane', 'jack'], showsProduct: true, visual: 'Diane shows the product', action: 'Diane points', narration: '', placement: '문 안쪽에 부착' },
  ],
  lines: [{ id: 'L1', sceneId: 'S2', speaker: 'diane', en: 'Look what I found!', ko: '내가 뭘 찾았게!' }],
  cta: { lines: ['댓글에 ‘우산’ 남겨주세요'], keyword: '우산', durationSec: 3.5 },
});

const umbrellaStory = () => JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'fixtures', 'umbrella-story.json'), 'utf8'));
/** A replacement for one beat (to prove a single-beat action changes only that beat). */
const goodBeat = (key, tag = 'NEW') => { const b = umbrellaStory().comedy_story[key]; return Object.assign({}, b, { title_ko: b.title_ko + tag, story_en: b.story_en + ' (' + tag + ')', scenes: b.scenes.map((s, i) => Object.assign({}, s, { title_ko: s.title_ko + tag })) }); };
/** What a fake script AI answers, by mode (story / single beat / ending variables / legacy flat script). */
function scriptResponse(req, { story = umbrellaStory, beat } = {}) {
  const p = req.prompt || '';
  const t = /TARGET_BEAT:\s*(\w+)/.exec(p);
  if (t) return { beat: beat ? beat(t[1]) : goodBeat(t[1]) };
  if (/"comedy_story": \{"setup"/.test(p)) return story();
  return goodScript();
}
const isScriptPrompt = (req) => /CONCEPT_TITLE/.test(req.prompt || '');

/** Fake AI text provider factory. `handlers[name]` may be a function (call) => result; calls are recorded. */
function fakeAi(handlers = {}) {
  const calls = [];
  const factory = (name) => ({
    name,
    supportsImages: true,
    async listModels() { return ['model-a', 'model-b']; },
    async generate(req) {
      calls.push(Object.assign({ provider: name }, req));
      const h = handlers[name] || handlers['*'];
      if (!h) throw new Error('no handler for ' + name);
      return h(req);
    },
    async generateImage(req) {
      calls.push(Object.assign({ provider: name, image: true }, req));
      return { images: [{ mimeType: 'image/png', data: png(77).toString('base64') }], usage: { inputTokens: 10, outputTokens: 10 } };
    },
  });
  return { factory, calls };
}

function make({ env = {}, ai = null, extractFn, downloadFn, vault, fetchFn } = {}) {
  const cfg = loadConfig(Object.assign({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-v23-')), RF_MASTER_KEY: 'test-master-key-for-unit-tests', RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, env), { dotenvFile: '/nonexistent' });
  const studio = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }), aiProviderFactory: ai ? ai.factory : null, extractFn, downloadFn, vault, fetchFn });
  // The fixed Jack & Diane format (6 beats + 21 s shopping ending) needs about 50 s; fixtures use the 60 s limit unless a test sets its own.
  const gen = studio.storylab.generate;
  studio.storylab.generate = (pid, o = {}) => gen(pid, Object.assign({ maxDurationSec: 60 }, o));
  return { cfg, s: studio };
}

/** A product that is READY for Story Lab: verified feature + one approved uploaded image + approved reference set. */
async function readyProduct(s, over = {}) {
  const code = 'UM' + String.fromCharCode(66 + s.products.list().filter((x) => s.products.raw(x.id).code).length); // UMB, UMC, UMD … (unique per studio)
  const p = await s.products.create(Object.assign({ name: '테스트 우산꽂이', code, features: ['자석으로 부착 가능', '장우산과 접이식 우산 수납'], forbiddenClaims: ['방수', '100%'] }, over));
  await s.products.upload(p.id, png(1), 'a.png');
  const view = s.products.get(p.id);
  await s.products.setStatus(p.id, view.images[0].id, 'approved');
  await s.products.approveReferenceSet(p.id, {});
  return p.id;
}

/** Route a text task to a (fake) paid provider with key + model so no real call is possible. */
function routePaid(s, provider = 'gemini', tasks = ['storyConcepts', 'scriptWriting']) {
  s.integrations.setKey(provider, 'test-key-' + provider + '-0000');
  tasks.forEach((t) => s.integrations.setRouting(t, { provider, model: 'model-a' }));
}

module.exports = { conceptsForPrompt, umbrellaStory, goodBeat, scriptResponse, isScriptPrompt, make, fakeAi, goodConcepts, goodScript, png, readyProduct, routePaid };
