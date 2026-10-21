// Story Lab categories and the generation-request rules (shared by the API, the prompt and the validation).
//   drama  — everyday comedy with escalating absurdity and a twist; goal: purchase conversion
//   viral  — absurd, visually memorable concepts built for views / shares / discovery
//   info   — useful, verifiable recommendations; goal: follows, saves, shares
//   all    — exactly one of each (count is fixed to 3)
'use strict';
const { StudioError } = require('./util');

const CATEGORIES = {
  drama: {
    ko: '반전형 생활 개그', en: 'Drama',
    brief: '제품을 자연스럽게 녹인 생활 코미디. 황당함이 점점 커지다가 예상 밖의 반전으로 끝납니다.',
    goal: '구매 전환',
    rule: 'DRAMA: design a CURIOSITY-DRIVEN comedic everyday story, not a summary. Consider a cold open or a brief flash-forward that shows the single most surprising moment, then rewind; plant an unanswered question that makes viewers keep watching; use escalation, misdirection, reversals and an unexpected payoff; hide information until it pays off. Connect the product naturally (it should feel like part of the story, never an advertisement). Primary goal: purchase conversion.',
  },
  viral: {
    ko: '바이럴형', en: 'Viral',
    brief: '조회·공유·채널 발견을 노린 황당하고 눈에 남는 숏폼. 예: Jack이 제품을 들고 춤춘다.',
    goal: '조회·공유·채널 발견',
    rule: 'VIRAL: design a short-form concept for views, shares and channel discovery. Prioritise a striking first-frame visual, absurdity, suspense, novelty, replayability and visual contrast (example: an object slowly approaching a balloon while the narration keeps going, creating visual tension). One strong visual idea that works with the sound off; an ending that makes people watch again. Keep the product visible but never claim anything the verified facts do not support.',
  },
  info: {
    ko: '신뢰·정보형', en: 'Informational',
    brief: '확인된 사실로 보여주는 유용한 추천·시연·비교·리스트. 예: "잘 산 쿠팡템 3가지".',
    goal: '팔로우·저장·공유',
    rule: 'INFORMATIONAL: a useful product recommendation, verified demonstration, comparison or list (example: "잘 산 쿠팡템 3가지"). Show the useful or surprising RESULT early, then keep curiosity while delivering verified information; give viewers a genuine reason to save, share and follow. State ONLY facts from VERIFIED_PRODUCT_FACTS; never invent facts, statistics, rankings or comparisons about this or any other product. If the format is a list or comparison, items other than this product must be neutral placeholders for the operator to fill in. Jack and Diane may still present it in character.',
  },
};
const ORDER = ['drama', 'viral', 'info'];
const ALL = 'all';
const MIN_COUNT = 1;
const MAX_COUNT = 5;
const ALL_COUNT = 3;
const MIN_SEC = 10;
const MAX_SEC = 90;
const DEFAULT_SEC = 45;

const options = () => [
  ...ORDER.map((k) => ({ key: k, ko: CATEGORIES[k].ko, en: CATEGORIES[k].en, brief: CATEGORIES[k].brief, goal: CATEGORIES[k].goal, minCount: MIN_COUNT, maxCount: MAX_COUNT, defaultCount: 1 })),
  { key: ALL, ko: '모두 1개씩 만들기', en: 'One of Each', brief: '반전형 생활 개그 · 바이럴형 · 신뢰·정보형을 정확히 1개씩, 총 3개를 만듭니다.', goal: '세 가지 방향 비교', minCount: ALL_COUNT, maxCount: ALL_COUNT, defaultCount: ALL_COUNT, fixedCount: true },
];

/**
 * Validates a generation request and returns { category, count, plan } where plan lists the category of every concept to generate.
 * category is REQUIRED. 1–5 for a single category (default 1); "all" is always exactly 3 (a different count is refused, not silently changed).
 */
/** maxDurationSec: the operator types a number of seconds (10–90, default 45); the AI is told to stay within it; going over it is only a guide (never a block). */
function resolveDuration(v) {
  if (v == null || v === '') return DEFAULT_SEC;
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_SEC || n > MAX_SEC) throw new StudioError('INVALID_DURATION', `영상 최대 길이는 ${MIN_SEC}~${MAX_SEC}초의 정수여야 합니다 (입력: ${v}).`, { status: 422 });
  return n;
}

function resolveRequest({ category, count, maxDurationSec } = {}) {
  const maxSec = resolveDuration(maxDurationSec);
  if (category == null || category === '') throw new StudioError('CATEGORY_REQUIRED', '스토리 카테고리를 선택하세요.', { status: 422, recovery: '반전형 생활 개그 / 바이럴형 / 신뢰·정보형 / 모두 1개씩 중 하나를 고르세요.' });
  if (category !== ALL && !CATEGORIES[category]) throw new StudioError('INVALID_CATEGORY', '알 수 없는 스토리 카테고리입니다: ' + category, { status: 422 });
  if (category === ALL) {
    if (count != null && count !== '' && Number(count) !== ALL_COUNT) throw new StudioError('INVALID_COUNT', '"모두 1개씩 만들기"는 항상 3개입니다 (요청: ' + count + '개).', { status: 422 });
    return { category, count: ALL_COUNT, plan: ORDER.slice(), maxDurationSec: maxSec };
  }
  const n = count == null || count === '' ? 1 : Number(count);
  if (!Number.isInteger(n) || n < MIN_COUNT || n > MAX_COUNT) throw new StudioError('INVALID_COUNT', `컨셉 수는 ${MIN_COUNT}~${MAX_COUNT}개의 정수여야 합니다 (요청: ${count}).`, { status: 422 });
  return { category, count: n, plan: Array(n).fill(category), maxDurationSec: maxSec };
}

const tally = (list) => list.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const planText = (plan) => ORDER.map((k) => ({ k, n: plan.filter((x) => x === k).length })).filter((x) => x.n).map((x) => `${CATEGORIES[x.k].ko} ${x.n}개`).join(' · ');

module.exports = { CATEGORIES, ORDER, ALL, MIN_COUNT, MAX_COUNT, ALL_COUNT, MIN_SEC, MAX_SEC, DEFAULT_SEC, options, resolveRequest, tally, planText };
