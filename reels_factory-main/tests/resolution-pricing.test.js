'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateRun } = require('../studio/lib/budget');
const model = { id: 'seedance-2.5', endpoint: 'seedance-2.5-image-to-video', durations: [5,10], resolutions: ['480p','720p','1080p'], extraParams: { resolution: '480p' } };
const cfg = { reelSpendLimitUsd: 10 };
const base = { spend: [], animation: {} };
const settings = { modelEstimates: { 'seedance-2.5': { usdByDuration: { '5': 0.01 }, usdByResolution: { '480p': { '5': 0.1 }, '720p': { '5': 0.3 }, '1080p': { '5': 0.6 } } } } };
function estimate(ep, scenes, override = settings) { return estimateRun({ ep, scenes, model, settings: override, cfg }); }
test('uses selected resolution instead of unsafe legacy duration-only price', () => {
  const ep = { ...base, animation: { s1: { resolution: '720p' } } };
  const r = estimate(ep, [{ id: 's1', durationSec: 4 }]);
  assert.equal(r.totalUsd, 0.3);
  assert.equal(r.items[0].resolution, '720p');
});
test('unknown resolution-duration price blocks live generation estimates', () => {
  const ep = { ...base, animation: { s1: { resolution: '1080p' } } };
  const r = estimate(ep, [{ id: 's1', durationSec: 9 }]);
  assert.equal(r.unknown, true);
  assert.equal(r.totalUsd, null);
});
test('draft/finalize use effective resolution', () => {
  const draft = estimate({ ...base, animation: { s1: { seedanceMode: 'draft', resolution: '1080p' } } }, [{ id: 's1', durationSec: 5 }]);
  assert.equal(draft.totalUsd, 0.1);
  const fin = estimate({ ...base, animation: { s1: { seedanceMode: 'finalize', resolution: '480p' } } }, [{ id: 's1', durationSec: 5 }]);
  assert.equal(fin.totalUsd, 0.6);
});
test('models without resolutions retain legacy duration-only estimates', () => {
  const r = estimateRun({ ep: base, scenes: [{ id: 's1', durationSec: 4 }], model: { id: 'basic', durations: [5] }, settings: { modelEstimates: { basic: { usdByDuration: { '5': 0.5 } } } }, cfg });
  assert.equal(r.totalUsd, 0.5);
});
test('cached scenes cost zero even with unknown price', () => {
  const r = estimateRun({ ep: base, scenes: [{ id: 's1', durationSec: 9 }], model, settings, cfg, cached: () => true });
  assert.equal(r.unknown, false);
  assert.equal(r.totalUsd, 0);
});
