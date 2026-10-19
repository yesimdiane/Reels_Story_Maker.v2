'use strict';
// "AI 발전": the operator's feedback revises the brief; verified facts must survive; a NEW draft is saved; the approved version is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRM, visionRoute, setupProduct } = require('./helpers/product-analysis-fixtures');

const revise = (req) => req.prompt.split('OPERATOR FEEDBACK:')[0].replace('EXISTING BRIEF (v1):\n', '').replace('[UNCERTAIN] Roughly three times taller than it is wide.', '[UNCERTAIN] Looks about three times taller than wide.');

async function ready(opts) {
  const x = await setupProduct(opts);
  visionRoute(x.s);
  await x.s.productAnalysis.generate(x.pid, { confirm: CONFIRM });
  return x;
}

test('develop: free estimate first; the paid call needs confirmation; a NEW draft is saved and the approved version is untouched', async () => {
  const { s, a, pid } = await ready({ develop: revise });
  await s.productAnalysis.approve(pid, 1);
  const approvedText = s.productAnalysis.view(pid).approved.text;
  const est = s.productAnalysis.developEstimate(pid, 1, 'make proportions less certain');
  assert.equal(est.basedOn, 1); assert.equal(est.nextV, 2); assert.equal(a.developCalls().length, 0, 'estimating is free');
  await assert.rejects(s.productAnalysis.develop(pid, 1, 'make proportions less certain', {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(a.developCalls().length, 0, 'no paid call without confirmation');
  const v = await s.productAnalysis.develop(pid, 1, 'make proportions less certain', CONFIRM);
  assert.equal(v.developedV, 2); assert.equal(v.latest.status, 'draft'); assert.equal(v.latest.source, 'ai_develop'); assert.equal(v.latest.basedOn, 1);
  assert.match(v.latest.text, /Looks about three times taller/); assert.match(v.latest.text, /\(analysis v2,/);
  assert.equal(v.approved.v, 1); assert.equal(v.approved.text, approvedText, 'the approved version was NOT overwritten');
  assert.match(a.developCalls()[0].prompt, /OPERATOR FEEDBACK:\nmake proportions less certain/);
});

test('develop: a response that changes or drops a verified fact is refused and nothing is saved', async () => {
  const { s, pid } = await ready({ develop: (req) => req.prompt.replace('[VERIFIED] A tall rectangular holder', '[VERIFIED] A short round holder') });
  await assert.rejects(s.productAnalysis.develop(pid, 1, 'punch it up', CONFIRM), (e) => e.code === 'DEVELOP_ALTERED_FACTS');
  const dropped = await ready({ develop: () => 'Only a hook, no facts.' });
  await assert.rejects(dropped.s.productAnalysis.develop(dropped.pid, 1, 'punch it up', CONFIRM), (e) => e.code === 'DEVELOP_ALTERED_FACTS');
  assert.equal(s.products.raw(pid).analyses.length, 1); assert.equal(dropped.s.products.raw(dropped.pid).analyses.length, 1);
});

test('develop: empty feedback, unknown version and an unconnected (sample) model are refused clearly', async () => {
  const { s, pid } = await ready({ develop: revise });
  await assert.rejects(s.productAnalysis.develop(pid, 1, '   ', CONFIRM), (e) => e.code === 'EMPTY_FEEDBACK');
  await assert.rejects(s.productAnalysis.develop(pid, 9, 'x', CONFIRM), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(s.productAnalysis.develop(pid, 1, 'x'.repeat(1001), CONFIRM), (e) => e.code === 'FEEDBACK_TOO_LONG');
  const { s: s2, pid: pid2 } = await setupProduct({ develop: revise });
  visionRoute(s2); await s2.productAnalysis.generate(pid2, { confirm: CONFIRM });
  s2.integrations.setRouting('productUnderstanding', { provider: 'mock', model: '' });
  await assert.rejects(s2.productAnalysis.develop(pid2, 1, 'x', CONFIRM), (e) => e.code === 'DEVELOP_MODEL_UNAVAILABLE');
});
