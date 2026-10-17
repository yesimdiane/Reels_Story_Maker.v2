// MOCK text provider. Only used when the operator explicitly routes a task to "mock" (demo/tests). Its output is
// labelled as a sample in the UI and is never billed. It makes no network calls.
'use strict';


/** Sample output for the fixed episode formula (clearly generic; real AI replaces it). */
function mockFormula(prompt) {
  const product = (/PRODUCT_NAME:\s*(.+)/.exec(prompt) || [, '제품'])[1].trim();
  const scene = (title, visual, lines) => ({ title_ko: title, durationSec: 4, characters: lines.some((l) => l[0] === 'diane') ? ['diane'] : ['jack'], showsProduct: false, visual, action: '[샘플] ' + visual, narration: '', placement: '', lines: lines.map(([speaker, en, ko]) => ({ speaker, en, ko })) });
  const beats = {
    setup: { title_ko: '영국인의 자신감', story_en: '[sample] Jack confidently ignores the obvious preparation.', visual: 'Jack strides down a busy Seoul street.', scenes: [scene('영국인의 자신감', 'Jack strides down a busy Seoul street.', [['jack', 'I do not need that.', '그건 필요 없어.']])] },
    problem: { title_ko: '서울이 잠긴 날', story_en: '[sample] A real problem starts.', visual: 'The problem begins around Jack.', scenes: [scene('서울이 잠긴 날', 'The problem begins around Jack.', [['jack', 'It is fine. Totally fine.', '괜찮아. 완전 괜찮아.']])] },
    absurd_escalation: { title_ko: '도시를 삼킨 대재앙', story_en: '[sample] The same problem becomes cartoon-sized.', visual: 'The problem grows to an absurd size.', scenes: [scene('도시를 삼킨 대재앙', 'The problem grows to an absurd size.', [['jack', 'Still fine!', '아직 괜찮아!']])] },
    unexpected_twist: { title_ko: '출근길의 보트', story_en: '[sample] The world around Jack acts unexpectedly normal.', visual: 'Commuters carry on as if nothing happened.', scenes: [scene('출근길의 보트', 'Commuters carry on as if nothing happened.', [['jack', 'Wait, what?', '잠깐, 뭐라고?']])] },
    resolution: { title_ko: '물에 빠진 생쥐', story_en: '[sample] Jack makes it home, soaked.', visual: 'Jack reaches the hilltop home.', scenes: [scene('물에 빠진 생쥐', 'Jack reaches the hilltop home.', [['jack', 'I made it.', '해냈어.']])] },
    product_bridge: { title_ko: '현관 출입 금지', story_en: '[sample] Jack drips everywhere; Diane has her excuse.', visual: 'Diane stops Jack at the door with a towel.', scenes: [scene('현관 출입 금지', 'Diane stops Jack at the door with a towel.', [['diane', 'Stop right there! Not one drop inside!', '거기 서! 한 방울도 안 돼!']])] },
  };
  const vars = { PRODUCT_NAME: product, PRODUCT_NAME_KO: product, USE_PHRASE: 'it', USE_PHRASE_KO: '그걸', DEMO_ACTION: `Diane uses ${product} as intended (sample).`, DEMO_ACTION_KO: `${product} 사용 (샘플)`, DEMO_LINE_EN: 'Look how easy that is!', DEMO_LINE_KO: '봐, 이렇게 쉬워!' };
  const target = /TARGET_BEAT:\s*(\w+)/.exec(prompt);
  if (target && beats[target[1]]) return { beat: beats[target[1]] };
  if (!/"comedy_story": \{"setup"/.test(prompt)) return { ending_vars: vars };
  return { title: '[샘플] ' + product, comedy_story: beats, ending_vars: vars, cta: { lines: ["댓글에 '링크' 남기면 링크 드림!"], keyword: '링크', durationSec: 3.5 } };
}


/** Sample dialogue shortening (generic: keeps the first lines, trims each to a few words; real AI rewrites properly). */
function mockTiming(prompt) {
  const m = /TIMING_TARGETS[^\n]*\n(\[[\s\S]*?\n\])/.exec(prompt);
  let targets = [];
  try { targets = JSON.parse(m[1]); } catch (_) { /* none */ }
  return { scenes: targets.map((t) => ({ id: t.id, lines: t.lines.slice(0, Math.max(1, Math.min(2, t.lines.length))).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en.split(/\s+/).slice(0, Math.max(2, Math.min(5, Math.floor(t.wordBudget / 2) || 2))).join(' '), ko: l.ko.split(/\s+/).slice(0, 3).join(' ') })) })) };
}

/** Sample Korean translations (clearly marked) so the mock path also has "번역 보기" data from generation. */
function addSampleKo(json) {
  const ko = (t) => '[샘플 번역] ' + t;
  const scene = (s) => { if (!s) return; ['visual', 'action', 'placement'].forEach((k) => { if (s[k] && !s[k + '_ko']) s[k + '_ko'] = ko(s[k]); }); };
  const beat = (b) => { if (!b) return; if (b.story_en && !b.story_ko) b.story_ko = ko(b.story_en); if (b.visual && !b.visual_ko) b.visual_ko = ko(b.visual); (b.scenes || []).forEach(scene); };
  if (!json || typeof json !== 'object') return json;
  (json.scenes || []).forEach(scene);
  if (json.comedy_story) Object.values(json.comedy_story).forEach(beat);
  if (json.beat) beat(json.beat);
  return json;
}

function createMockText() {
  const calls = [];
  return {
    name: 'mock',
    mock: true,
    supportsImages: true,
    calls,
    async listModels() { return ['mock-1']; },
    async generate({ task, prompt, images = [], json }) {
      calls.push({ task, promptChars: prompt.length, images: images.length });
      const product = (/PRODUCT_NAME:\s*(.+)/.exec(prompt) || [, '제품'])[1].trim();
      if (task === 'storyConcepts') {
        const plan = ((/CATEGORY_PLAN:\s*(.+)/.exec(prompt) || [, 'drama, drama, drama'])[1]).split(',').map((x) => x.trim()).filter(Boolean);
        const BANK = {
          drama: [
            ['The Entryway Disaster', 'Jack drips rainwater across the entryway while Diane holds a cleaning cloth.', 'A rainy-day entryway turns into a couple\'s standoff', '현관 대참사', '비 오는 날 현관이 물바다가 되는 부부 신경전'],
            ['Jack Swore He Would Never Use It', 'Diane brings home a new gadget; Jack insists he will never touch it.', 'A stubborn vow about a new household item', 'Jack은 안 쓴다고 했다', '새 물건을 두고 벌어지는 고집 대결'],
            ['The Tidy-Off', 'Diane and Jack race to tidy the living room before guests arrive.', 'A speedy cleanup bet with an unexpected finish', '정리 내기', '정리 내기에서 뜻밖의 반전'],
            ['The Midnight Parcel', 'A late-night parcel arrives and Jack suspects Diane\'s shopping habit.', 'A playful interrogation over a mystery box', '한밤의 택배', '택배 상자를 둘러싼 유쾌한 추궁'],
            ['Morning Rush Chaos', 'Jack hunts for his keys while Diane films the whole meltdown.', 'A frantic morning that fixes itself overnight', '아침 출근 전쟁', '난장판 아침이 하루 만에 달라진다'],
          ],
          viral: [
            ['Jack Dances With It', 'Jack dances in the living room while holding the product like a trophy.', 'An absurd dance that keeps the product in frame', 'Jack의 제품 댄스', '제품을 들고 춤추는 황당한 장면'],
            ['The Slow-Motion Reveal', 'Diane unboxes the product in dramatic slow motion while Jack gasps.', 'An over-the-top slow motion unboxing', '슬로모션 언박싱', '과장된 슬로모션 언박싱'],
            ['Diane Rates It Like a Judge', 'Diane holds up score cards while Jack performs a ridiculous audition.', 'A mock talent show judged from the sofa', '심사위원 Diane', '소파 위 가짜 오디션 쇼'],
            ['Freeze Frame Prank', 'Jack freezes mid-pose whenever the product appears behind him.', 'A freeze challenge with surprise cutaways', '얼음 땡 장난', '제품이 나타날 때마다 멈추는 챌린지'],
            ['The Echo Shout', 'Diane shouts a catchphrase and Jack echoes it from another room.', 'A shouting relay across the apartment', '메아리 외침', '집 안을 가로지르는 외침 릴레이'],
          ],
          info: [
            ['Three Smart Buys From Coupang', 'Diane lists three useful finds, with this product as the first.', 'A verified-facts recommendation list', '잘 산 쿠팡템 3가지', '확인된 사실로 소개하는 추천 리스트'],
            ['Does It Really Work? A Quick Test', 'Jack and Diane test the product exactly as its verified features describe.', 'A short honest demonstration', '진짜 될까? 짧은 시연', '확인된 기능만 보여주는 솔직한 시연'],
            ['Who Is This For?', 'Diane explains which households benefit, using only confirmed specifications.', 'A simple who-should-buy explainer', '이런 집에 추천', '확인된 사양으로 설명하는 추천 대상'],
            ['Size And Setup In 20 Seconds', 'Jack measures the product and installs it while Diane reads the verified dimensions.', 'A quick size and installation walkthrough', '크기와 설치 20초', '확인된 크기로 보여주는 설치 과정'],
            ['Before You Buy Checklist', 'Diane shares a short checklist of things to confirm before ordering.', 'A practical pre-purchase checklist', '구매 전 체크리스트', '주문 전 확인할 항목 정리'],
          ],
        };
        const maxSec = Number((/MAX_DURATION_SEC:\s*(\d+)/.exec(prompt) || [, 90])[1]);
        const used = { drama: 0, viral: 0, info: 0 };
        const concepts = plan.map((cat, i) => {
          const list = BANK[cat] || BANK.drama;
          const b = list[used[cat]++ % list.length];
          const dur = Math.max(10, Math.min(38 + i * 2, maxSec));
          return {
            category: cat, title: `[Sample] ${b[0]}`,
            storyline: `[Sample] ${b[1]} ${b[2]}. The product appears only within its verified features (${product}), and the closing beat pays off the question the opening raised (about ${dur}s).`,
            estimatedDurationSec: dur,
            title_ko: `[샘플] ${b[3]}`,
            storyline_ko: `[샘플] ${b[4]}. ${product}는 확인된 기능 범위에서만 등장하고, 마지막에 처음의 궁금증이 풀립니다 (약 ${dur}초).`,
          };
        });
        return { text: '', json: { concepts }, usage: { inputTokens: null, outputTokens: null } };
      }
      if (task === 'scriptWriting' && /^SCENE_REGENERATION/.test(prompt)) {
        let cur = {};
        try { cur = JSON.parse((/CURRENT_SCENE: (\{.*\})/.exec(prompt) || [, '{}'])[1]); } catch (_) { /* sample only */ }
        const vis = ((/VISUAL_DIRECTION: ([\s\S]*?)\nACTION: /.exec(prompt) || [, ''])[1] || cur.visual || '').trim();
        const act = ((/\nACTION: (.*)/.exec(prompt) || [, ''])[1] || cur.action || '').trim();
        const secs = Number(cur.durationSec) || 4;
        return { text: '', json: { scene: { title_ko: cur.title_ko || '샘플 장면', visual: `0.0–${secs} s: [sample] ${vis}`.slice(0, 900), action: '[sample] ' + (act || 'The characters act it out.'), narration: cur.narration || '', lines: (cur.lines || []).slice(0, 2).map((l) => ({ speaker: l.speaker, en: l.en.split(/\s+/).slice(0, 8).join(' '), ko: l.ko })) } }, usage: { inputTokens: null, outputTokens: null } };
      }
      if (task === 'scriptWriting' && /TRANSLATE_TO:/.test(prompt)) { const to = /TRANSLATE_TO:\s*(\w+)/.exec(prompt)[1]; const src = /<<<TEXT\n([\s\S]*?)\nTEXT>>>/.exec(prompt)[1]; return { text: '', json: { translation: (to === 'Korean' ? '[샘플 번역 — AI 미연결] ' : '[Sample translation — AI not connected] ') + src }, usage: { inputTokens: null, outputTokens: null } }; }
      if (task === 'scriptWriting' && /TIMING_TARGETS/.test(prompt)) return { text: '', json: mockTiming(prompt), usage: { inputTokens: null, outputTokens: null } };
      if (task === 'scriptWriting' && /"comedy_story": \{"setup"|\{"ending_vars"|\{"beat": BEAT/.test(prompt)) return { text: '', json: addSampleKo(mockFormula(prompt)), usage: { inputTokens: null, outputTokens: null } };
      if (task === 'scriptWriting') {
        const c = (/CONCEPT_TITLE:\s*(.+)/.exec(prompt) || [, '샘플'])[1].trim();
        return { text: '', json: addSampleKo({ title: c, beats: ['상황 제시', '문제 확대', '제품 발견', '반전'], scenes: [{ id: 'S1', title_ko: '문제에 빠진 남편', title: '문제에 빠진 남편', beat: 1, durationSec: 5, characters: ['jack'], showsProduct: false, visual: 'Jack faces the household problem at the entryway.', action: 'Jack sighs.', narration: '' }, { id: 'S2', title_ko: '아내의 신문물 자랑', title: '아내의 신문물 자랑', beat: 2, durationSec: 5, characters: ['diane', 'jack'], showsProduct: true, visual: 'Diane shows the product to Jack.', action: 'Diane points at the product.', narration: '' }], lines: [{ id: 'L1', sceneId: 'S2', speaker: 'diane', en: 'Look what I found!', ko: '내가 뭘 찾았게!' }], cta: { lines: ['댓글에 ‘링크’ 남기면 링크 드림!'], keyword: '링크', durationSec: 3.5 } }), usage: { inputTokens: null, outputTokens: null } };
      }
      return { text: 'MOCK', json: json ? {} : undefined, usage: { inputTokens: null, outputTokens: null } };
    },
    async generateImage() { throw Object.assign(new Error('mock does not generate images'), { category: 'bad_request' }); },
  };
}

module.exports = { createMockText };
