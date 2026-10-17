// Cost estimation and spending limits. Prices are NEVER invented: Muapi publishes no price table, so a per-clip
// estimate is an operator-entered number (Settings). With an unknown estimate, live generation is blocked.
'use strict';
const { sha256, canonical, StudioError } = require('./util');

const round = (n) => Math.round(n * 1e6) / 1e6;

function modelById(models, id) {
  const m = models.find((x) => x.id === id);
  if (!m) throw new StudioError('MODEL', '알 수 없는 모델입니다: ' + id, { recovery: 'Settings에서 모델을 선택하세요.' });
  return m;
}

/** Smallest allowed clip length that covers the scene (never shorter than the scene). */
function clipSecFor(model, sceneSec) {
  const ds = (model.durations || []).slice().sort((a, b) => a - b);
  if (!ds.length) return Math.ceil(sceneSec);
  return ds.find((d) => d >= sceneSec - 1e-9) || ds[ds.length - 1];
}

function limitFor(ep, settings, cfg) {
  const v = ep.spendLimitUsd != null ? ep.spendLimitUsd : settings.reelSpendLimitUsd != null ? settings.reelSpendLimitUsd : cfg.reelSpendLimitUsd;
  return Number(v);
}

function spentUsd(ep) {
  return round((ep.spend || []).filter((s) => !s.mock).reduce((n, s) => n + (s.actualUsd != null ? s.actualUsd : s.estimatedUsd || 0), 0));
}

/** Content address of one generation: same inputs → same key → the cached clip is reused (no second charge). */
function jobKey({ model, prompt, negative, clipSec, aspectRatio, imageSha256 }) {
  return sha256(canonical({ m: model.id, e: model.endpoint, prompt, negative: negative || '', clipSec, aspectRatio, image: imageSha256 }));
}

/**
 * estimateRun: { items, totalUsd|null, unknown, spentUsd, limitUsd, remainingUsd, withinLimit }.
 * cached(sceneId) → true if a clip with the same job key already exists (free).
 */
function estimateRun({ ep, scenes, model, settings, cfg, cached = () => false }) {
  // Resolution-aware pricing. For models with resolution options, NEVER fall back to
  // legacy duration-only prices: that could understate the cost of 1080p/4K.
  const entry = (settings.modelEstimates && settings.modelEstimates[model.id]) || {};
  const table = entry.usdByDuration || {};
  const byResolution = entry.usdByResolution || {};
  const resolutions = model.resolutions || [];
  const priceFor = (sec, resolution) => {
    const source = resolutions.length ? (byResolution[resolution] || {}) : table;
    const value = source[String(sec)];
    return value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  };
  const sceneResolution = (scene) => {
    const anim = ep.animation && ep.animation[scene.id];
    if (model.id === 'seedance-2.5' && anim && anim.seedanceMode === 'draft') return '480p';
    if (model.id === 'seedance-2.5' && anim && anim.seedanceMode === 'finalize') return '1080p';
    const selected = anim && anim.resolution;
    const fallback = model.extraParams && model.extraParams[model.resolutionField || 'resolution'];
    return selected || (resolutions.includes(fallback) ? fallback : resolutions.length === 1 ? resolutions[0] : null);
  };
  const items = scenes.map((s) => {
    const clipSec = clipSecFor(model, s.durationSec);
    const isCached = cached(s.id);
    const resolution = sceneResolution(s);
    const price = priceFor(clipSec, resolution);
    return { sceneId: s.id, clipSec, resolution, cached: isCached, usd: isCached ? 0 : price != null ? round(price) : null };
  });
  const billable = items.filter((i) => !i.cached);
  const unknown = billable.some((i) => i.usd == null);
  const totalUsd = unknown ? null : round(billable.reduce((n, i) => n + i.usd, 0));
  const limitUsd = limitFor(ep, settings, cfg);
  const spent = spentUsd(ep);
  const remainingUsd = round(limitUsd - spent);
  return {
    modelId: model.id,
    items,
    billableClips: billable.length,
    totalUsd,
    unknown,
    priceTable: table,
    spentUsd: spent,
    limitUsd,
    remainingUsd,
    withinLimit: totalUsd == null ? null : totalUsd <= remainingUsd + 1e-9,
  };
}

module.exports = { modelById, clipSecFor, limitFor, spentUsd, jobKey, estimateRun, round };
