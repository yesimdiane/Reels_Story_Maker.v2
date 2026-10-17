// Usage & spend ledger for every external AI call (text, image, video, voice) plus daily/monthly limits.
// ESTIMATES and ACTUALS are kept apart: estimatedUsd comes from operator-entered prices (never invented);
// actualUsd is only set when the provider reported a cost (video) or tokens × an operator-entered price (text, labelled "calculated").
// Nothing here is a bill: the provider's own invoice is the source of truth.
'use strict';
const path = require('node:path');
const { StudioError, uid, nowIso, readJson, writeJsonAtomic } = require('./util');

function createUsage({ store, log = () => {} }) {
  const file = store.path('usage.json');
  let queue = Promise.resolve();
  const read = () => readJson(file, { entries: [] });

  function record(entry) {
    const e = Object.assign({ id: uid('use'), at: nowIso(), kind: 'text', provider: '', model: '', task: '', status: 'ok', mock: false, estimatedUsd: null, actualUsd: null, tokens: null, error: '' }, entry);
    queue = queue.then(() => {
      const d = read();
      d.entries.push(e);
      if (d.entries.length > 5000) d.entries = d.entries.slice(-5000);
      writeJsonAtomic(file, d);
    }).catch((err) => log('usage write failed: ' + err.message));
    return e;
  }
  const flush = () => queue;

  const cost = (e) => (e.mock ? 0 : e.actualUsd != null ? e.actualUsd : e.estimatedUsd != null ? e.estimatedUsd : 0);

  /** Spend since `since` (ISO). Video spend recorded on episodes (ep.spend) is included so limits see everything. */
  function spentSince(since) {
    const t = new Date(since).getTime();
    let total = 0;
    let unknown = 0;
    read().entries.forEach((e) => {
      if (new Date(e.at).getTime() < t || e.status === 'blocked') return;
      if (e.kind === 'video') return; // video is counted from the episode ledger below (single source)
      total += cost(e);
      if (!e.mock && e.estimatedUsd == null && e.actualUsd == null && e.status === 'ok') unknown += 1;
    });
    store.episodes.list({ all: true }).forEach((ep) => (ep.spend || []).forEach((s) => {
      if (s.mock || new Date(s.at).getTime() < t) return;
      total += s.actualUsd != null ? s.actualUsd : s.estimatedUsd || 0;
    }));
    return { usd: Math.round(total * 1e6) / 1e6, unknownCostCalls: unknown };
  }
  const startOfDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();

  function summary(limits = {}) {
    const day = spentSince(startOfDay());
    const month = spentSince(startOfMonth());
    return { today: day, month, limits: { dailyUsd: limits.dailyUsd == null ? null : Number(limits.dailyUsd), monthlyUsd: limits.monthlyUsd == null ? null : Number(limits.monthlyUsd) }, period: 'UTC 기준', note: '추정치/계산치이며 실제 청구서가 아닙니다.' };
  }

  /** Throws when estimatedUsd would exceed a limit; unknown price + any limit set → needs explicit confirmation. */
  function checkLimits(limits, estimatedUsd, { confirmUnknownCost = false, label = 'AI 호출' } = {}) {
    const dailyOn = limits && limits.dailyUsd != null && limits.dailyUsd !== '';
    const monthlyOn = limits && limits.monthlyUsd != null && limits.monthlyUsd !== '';
    if (!dailyOn && !monthlyOn) return;
    if (estimatedUsd == null) {
      if (!confirmUnknownCost) throw new StudioError('COST_UNKNOWN', `${label}의 예상 비용을 알 수 없어 한도를 확인할 수 없습니다.`, { recovery: 'Settings → AI Integrations에서 이 모델의 가격(100만 토큰당)을 입력하거나, "비용을 모르는 상태로 진행"을 확인하세요.', status: 409 });
      return;
    }
    const d = spentSince(startOfDay()).usd;
    const m = spentSince(startOfMonth()).usd;
    if (dailyOn && d + estimatedUsd > Number(limits.dailyUsd) + 1e-9) throw new StudioError('DAILY_LIMIT', `일일 한도($${limits.dailyUsd})를 넘습니다 (오늘 사용 $${d} + 예상 $${estimatedUsd}).`, { recovery: 'Settings에서 한도를 올리거나 내일 다시 시도하세요.', status: 409 });
    if (monthlyOn && m + estimatedUsd > Number(limits.monthlyUsd) + 1e-9) throw new StudioError('MONTHLY_LIMIT', `월 한도($${limits.monthlyUsd})를 넘습니다 (이번 달 사용 $${m} + 예상 $${estimatedUsd}).`, { recovery: 'Settings에서 한도를 올리세요.', status: 409 });
  }

  function list({ limit = 100, kind } = {}) {
    return read().entries.filter((e) => !kind || e.kind === kind).slice(-limit).reverse();
  }

  return { record, flush, summary, checkLimits, list, spentSince };
}

/** Operator-entered token prices: settings.ai.pricing["provider:model"] = { inputPer1M, outputPer1M } (USD). */
function priceTokens(pricing, provider, model, inputTokens, outputTokens) {
  const p = pricing && pricing[provider + ':' + model];
  if (!p || p.inputPer1M == null || p.outputPer1M == null || p.inputPer1M === '' || p.outputPer1M === '') return null;
  const usd = (Number(inputTokens || 0) * Number(p.inputPer1M) + Number(outputTokens || 0) * Number(p.outputPer1M)) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
/** Pre-call estimate: ~2.5 chars per token (conservative for Korean), assumed output size from the caller. */
function estimateText(pricing, provider, model, inputChars, outputTokens = 3000, imageCount = 0) {
  const inTok = Math.ceil(Number(inputChars || 0) / 2.5) + imageCount * 1500;
  return { usd: priceTokens(pricing, provider, model, inTok, outputTokens), inputTokens: inTok, outputTokens };
}

module.exports = { createUsage, priceTokens, estimateText };
