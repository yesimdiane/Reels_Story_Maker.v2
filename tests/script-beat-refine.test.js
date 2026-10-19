'use strict';
// Script Studio: the operator can revise ANY one of the six story beats with a written instruction. Only that beat changes (Part B and the other beats
// stay), the instruction reaches the AI, hand edits are protected, a paid call needs confirmation. All AI is faked; nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const ai = () => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
const scriptCalls = (a) => a.calls.filter((c) => /CONCEPT_TITLE/.test(c.prompt || ''));
async function episode() {
  const a = ai();
  const m = make({ ai: a });
  const pid = await readyProduct(m.s);
  routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, pid, a });
}
const partA = (ep) => ep.scenes.filter((x) => x.part === 'A');
const partB = (ep) => JSON.stringify({ scenes: ep.scenes.filter((x) => x.part === 'B'), beats: ep.product_ending });
const others = (ep, key) => JSON.stringify(partA(ep).filter((x) => x.beatKey !== key).map((x) => [x.id, x.beatKey, x.title_ko, x.visual]));
const BEATS = [['setup', 'setup'], ['problem', 'problem'], ['escalation', 'absurd_escalation'], ['twist', 'unexpected_twist'], ['resolution', 'resolution'], ['bridge', 'product_bridge']];

test('each of the six beats can be revised with an instruction: only that beat changes, Part B stays, the instruction reaches the AI', async () => {
  const { s, a, id } = await episode();
  const beforeB = partB(s.store.episodes.get(id));
  for (const [action, key] of BEATS) {
    const before = s.store.episodes.get(id);
    const keep = others(before, key);
    const text = `Make the ${key} beat funnier. (${action})`;
    await s.scriptgen.regenerate(id, action, { confirm: CONFIRM, extra: text });
    const after = s.store.episodes.get(id);
    assert.equal(others(after, key), keep, action + ': the other beats are unchanged');
    assert.equal(partB(after), beforeB, action + ': Part B is untouched');
    assert.match(after.comedy_story[key].title_ko, /NEW$/, action + ': the beat itself was rewritten');
    assert.ok(after.scenes.filter((x) => x.beatKey === key).length > 0 && after.scenes.filter((x) => x.beatKey === key).every((x) => /NEW$/.test(x.title_ko)));
    const prompt = scriptCalls(a).pop().prompt;
    assert.match(prompt, new RegExp('TARGET_BEAT: ' + key));
    assert.ok(prompt.includes('ADDITIONAL INSTRUCTION FOR THIS RUN (operator):\n' + text), action + ': the operator instruction is in the prompt');
  }
});

test('setup / problem / resolution need an instruction (refused before any AI call); the three preset actions do not', async () => {
  const { s, a, id } = await episode();
  const n = scriptCalls(a).length;
  for (const action of ['setup', 'problem', 'resolution']) {
    await assert.rejects(s.scriptgen.regenerate(id, action, { confirm: CONFIRM }), (e) => e.code === 'EMPTY_INSTRUCTION', action);
    await assert.rejects(s.scriptgen.regenerate(id, action, { confirm: CONFIRM, extra: '   \n ' }), (e) => e.code === 'EMPTY_INSTRUCTION', action + ' (blank)');
    const e = s.store.episodes.get(id); const c = s.storylab.requireApproved(e.concept.productId, e.concept.conceptId);
    assert.throws(() => s.scriptgen.buildPrompt(e, c, '', undefined, action), (x) => x.code === 'EMPTY_INSTRUCTION', action + ': the cost estimate refuses too');
  }
  assert.equal(scriptCalls(a).length, n, 'no AI call was made');
  await s.scriptgen.regenerate(id, 'twist', { confirm: CONFIRM }); // a preset needs no instruction
  assert.equal(scriptCalls(a).length, n + 1);
});

test('a paid call needs confirmation; hand edits in the beat are protected until the operator confirms the overwrite', async () => {
  const { s, a, id } = await episode();
  const n = scriptCalls(a).length;
  await assert.rejects(s.scriptgen.regenerate(id, 'setup', { extra: 'Make it quieter.' }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(scriptCalls(a).length, n, 'no paid call without confirmation');
  const sc = s.store.episodes.get(id).scenes.map((x) => ({ ...x }));
  const target = sc.find((x) => x.beatKey === 'setup');
  target.visual = 'MY HAND-WRITTEN SETUP VISUAL';
  await s.saveScript(id, { scenes: sc });
  await assert.rejects(s.scriptgen.regenerate(id, 'setup', { confirm: CONFIRM, extra: 'Make it quieter.' }), (e) => e.code === 'MANUAL_EDITS');
  assert.match(JSON.stringify(s.store.episodes.get(id).scenes), /MY HAND-WRITTEN SETUP VISUAL/, 'the hand edit survived the refusal');
  await s.scriptgen.regenerate(id, 'setup', { confirm: CONFIRM, extra: 'Make it quieter.', overwrite: true });
  assert.doesNotMatch(JSON.stringify(s.store.episodes.get(id).scenes), /MY HAND-WRITTEN SETUP VISUAL/, 'replaced only after the explicit overwrite');
});
