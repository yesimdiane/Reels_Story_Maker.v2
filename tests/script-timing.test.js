'use strict';
const { approveWithScenes } = require('./helpers/approve');
// Regression tests: context-aware claim matching (CTA "드립니다" false positive) and realistic dialogue timing
// (prompt rules before generation, validation, shorten-not-extend fix action, estimate vs actual voice duration). All AI is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimHits } = require('../studio/lib/claims');
const E = require('../studio/lib/episode');
const publishing = require('../studio/lib/publishing');
const { lintPrompt } = require('../studio/lib/prompts');
const presets = require('../studio/lib/scriptpresets');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, umbrellaStory, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
/** Fake AI that also answers the dialogue-timing action: keeps each target's first line(s), trimmed to a few words. */
function ai({ fit, story } = {}) {
  return fakeAi({ '*': (req) => {
    const p = req.prompt || '';
    if (/TIMING_TARGETS/.test(p)) {
      const m = /TIMING_TARGETS[^\n]*\n(\[[\s\S]*?\n\])/.exec(p);
      const targets = JSON.parse(m[1]);
      return { text: '', json: fit ? fit(targets) : { scenes: targets.map((t) => ({ id: t.id, lines: t.lines.slice(0, 1).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en.split(/\s+/).slice(0, 3).join(' '), ko: l.ko.split(/\s+/).slice(0, 2).join(' ') })) })) }, usage: { inputTokens: 100, outputTokens: 50 } };
    }
    return { text: '', json: isScriptPrompt(req) ? scriptResponse(req, { story }) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } };
  } });
}
async function episode(a = ai(), { claims } = {}) {
  const m = make({ ai: a });
  const pid = await readyProduct(m.s);
  if (claims) await m.s.products.edit(pid, { forbiddenClaims: claims });
  routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, pid, a });
}
const LONG = 'Honestly baby I really truly believe that rain is simply a minor personal inconvenience for everybody else';
async function makeLong(s, id, sceneIds) {
  const ep = s.store.episodes.get(id);
  const lines = ep.lines.map((l) => ({ ...l, en: sceneIds.includes(l.sceneId) ? LONG : l.en }));
  await s.saveScript(id, { scenes: ep.scenes.map((x) => ({ ...x })), lines });
}
const snap = (ep, pred) => JSON.stringify({ scenes: ep.scenes.filter(pred), lines: ep.lines.filter((l) => ep.scenes.filter(pred).some((x) => x.id === l.sceneId)) });

// ---------- 1. claims: context-aware matching ----------
test('claims: the polite CTA verb 드리다 ("링크 드립니다", "링크 드림!") is not a product claim', () => {
  for (const [text, claim] of [['댓글에 ‘우산’ 남기면 링크 드립니다!', '드립'], ['댓글에 ‘우산’ 남기면 링크 드림!', '드림'], ['링크는 DM으로 알려드릴게요', '드릴'], ['바로 보내드려요~', '드려'], ['링크 드립니다', '드립']]) {
    assert.equal(claimHits(text, [claim]).length, 0, text + ' / ' + claim);
  }
});

test('claims: real unsupported claims are still found (no weakening) — bare words, compounds, suffixes, Latin terms', () => {
  const T = (text, claim) => claimHits(text, [claim]).length;
  assert.equal(T('아재 드립 칠 때', '드립'), 1, 'the bare noun is still flagged');
  assert.equal(T('방수드립 아님', '드립'), 1, 'a compound is still flagged');
  assert.equal(T('링크 드립니다 그리고 아재 드립', '드립'), 1, 'one harmless + one real occurrence → flagged');
  for (const t of ['이건 방수 됩니다', '완전방수예요', '방수성 우수', '100% 방수!']) assert.equal(T(t, '방수'), 1, t);
  assert.equal(T('IP68 등급', 'ip68'), 1);
  assert.equal(T('UVA 차단', 'UV'), 0, 'Latin terms match whole tokens');
  assert.equal(T('UV 차단', 'UV'), 1);
  assert.deepEqual(claimHits('이건 방수 됩니다', ['방수'])[0].context.includes('방수'), true, 'the hit carries its context');
  assert.equal(claimHits('아무 말', ['', '  ']).length, 0);
});

test('claims: CTA, dialogue, publishing and prompt lints all use the same context-aware check', async () => {
  const ep = { product: { forbiddenClaims: ['드립', '방수'] }, scenes: [{ id: 'S1', durationSec: 6 }], lines: [{ id: 'L1', sceneId: 'S1', speaker: 'jack', en: 'Hello there', ko: '안녕' }], cta: { keyword: '우산', lines: ['댓글에 ‘우산’ 남기면 링크 드립니다!'], durationSec: 3 }, publishing: { keyword: '우산' } };
  const claimErrs = (e) => E.validateScript(e, { characters: [{ id: 'jack', name: 'Jack', forbiddenWords: [] }] }).errors.filter((x) => x.code === 'PRODUCT_CLAIM');
  assert.equal(claimErrs(ep).length, 0, 'the standard CTA passes');
  const bad = JSON.parse(JSON.stringify(ep));
  bad.cta.lines = ['완전 방수! 댓글에 ‘우산’ 남겨요'];
  bad.lines[0].ko = '이건 방수예요';
  const errs = claimErrs(bad);
  assert.equal(errs.length, 2);
  assert.ok(errs.every((e) => /방수/.test(e.message) && /…/.test(e.message)), 'the message shows where the claim is');
  // publishing validation and storyboard prompt lint
  const caption = '[광고] 쿠팡 파트너스 활동의 일환으로 수수료를 받습니다. 댓글에 ‘우산’ 남기면 링크 드립니다!';
  const okPub = publishing.validate(ep, { caption, keyword: '우산', dmMessage: '링크 드립니다', hook: '', productDescription: '', cta: '' });
  assert.equal(okPub.errors.filter((x) => x.code === 'PRODUCT_CLAIM').length, 0);
  const badPub = publishing.validate(ep, { caption: caption + ' 완전 방수', keyword: '우산', dmMessage: '', hook: '', productDescription: '', cta: '' });
  assert.equal(badPub.errors.filter((x) => x.code === 'PRODUCT_CLAIM').length, 1);
  assert.deepEqual(lintPrompt('Diane says link 드립니다 to Jack', ep), []);
  assert.deepEqual(lintPrompt('A fully 방수 product', ep), ['방수']);
});

// ---------- 2. timing model + validation ----------
test('timing: the estimate, the word budgets and the three severities (ok / tight / overflow)', () => {
  assert.deepEqual([3, 4, 5, 6].map((d) => E.wordBudget(d, 1)), [5, 8, 11, 13]);
  assert.ok(E.wordBudget(4, 2) < E.wordBudget(4, 1), 'every extra line costs time');
  const mk = (dur, en) => ({ scenes: [{ id: 'S1', durationSec: dur }], lines: [{ id: 'L1', sceneId: 'S1', speaker: 'jack', en, ko: 'x' }] });
  assert.equal(E.dialogueTiming(mk(4, 'Short line here'))[0].status, 'ok');
  const t = E.dialogueTiming(mk(4, 'one two three four five six seven eight nine'))[0];
  assert.equal(t.status, 'tight', JSON.stringify(t));
  assert.ok(t.overSec > 0 && t.overSec <= E.OVERFLOW_OVER);
  assert.equal(E.dialogueTiming(mk(4, LONG))[0].status, 'overflow');
  assert.equal(E.dialogueTiming(mk(4, LONG))[0].wordBudget, 8);
});

test('timing validation: an overflowing scene blocks approval for fixed-formula episodes; legacy scripts only get a warning', async () => {
  const { s, id } = await episode();
  assert.equal(s.episodeView(id).derived.validation.ok, true);
  await makeLong(s, id, ['S1']);
  const v = s.episodeView(id).derived.validation;
  assert.equal(v.ok, false);
  const e = v.errors.find((x) => x.code === 'SCENE_OVERFLOW');
  assert.equal(e.sceneId, 'S1');
  assert.match(e.message, /초 초과/);
  assert.match(e.message, /줄이거나 불필요한 줄/);
  await assert.rejects(approveWithScenes(s, id), (x) => x.code === 'INVALID_SCRIPT');
  assert.equal(s.episodeView(id).derived.timing.scenes.find((t) => t.sceneId === 'S1').status, 'overflow');
  assert.equal(s.episodeView(id).derived.timing.overflowCount, 1);
  // legacy (pre-formula) episode: same overflow is only a warning
  const legacy = make({ ai: ai() });
  const made = await legacy.s.createEpisode({ id: 'EP93', title: '옛', productName: 'x', features: ['사실'] });
  const lid = made.id || made;
  await legacy.s.saveScript(lid, { lines: [{ id: 'L1', sceneId: 'S1', speaker: 'jack', en: LONG, ko: '긴 자막' }], cta: { lines: ['댓글에 ‘링크’ 남겨요'], keyword: '링크' } });
  const lv = legacy.s.episodeView(lid).derived.validation;
  assert.ok(lv.warnings.some((w) => w.code === 'SCENE_TIGHT'));
  assert.ok(!lv.errors.some((x) => x.code === 'SCENE_OVERFLOW'));
});

// ---------- 3. the prompt enforces timing BEFORE generation ----------
test('prompt: the realistic-timing rules and word budgets are in every generation prompt (locked, before the script is written)', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  const story = s.scriptgen.effectivePrompt(id, {}, '', 'story').parts.locked;
  for (const mode of ['story', 'beat']) assert.match(presets.lockedFor(mode), /DIALOGUE TIMING/);
  assert.match(story, /2\.7 words per second/);
  assert.match(story, /4 s → 8 words \(1 line\) \/ 7 words \(2 lines\)/);
  assert.match(story, /3 s → 5 words/);
  assert.match(story, /SHORTEN the dialogue or REMOVE unnecessary lines/);
  assert.match(story, /Never rely on scenes being extended/);
  assert.match(presets.LOCKED, /DIALOGUE TIMING/, 'legacy flat prompt too');
  // the prompt actually sent to the model carries it
  assert.match(a.calls.filter((c) => /CONCEPT_TITLE/.test(c.prompt || '')).pop().prompt, /Total English words that FIT a scene/);
  // there is no separate ending any more: no ending mode, no ending timing rule, and every scene (the six beats are the whole episode) is estimated
  assert.throws(() => s.scriptgen.effectivePrompt(id, {}, '', 'ending'), (e) => e.code === 'BAD_ACTION');
  assert.doesNotMatch(story, /ENDING_TIMING|ending_vars/);
  const t = s.episodeView(id).derived.timing.scenes;
  assert.ok(t.length > 0 && t.every((x) => !x.sceneId.startsWith('E')), 'no E-shots');
  assert.ok(t.every((x) => x.status === 'ok'), JSON.stringify(t));
});

// ---------- 4. shorten, don't extend ----------
// a story whose model wrote too much dialogue in two scenes (S1 setup, S5 resolution)
const overlong = () => { const g = umbrellaStory(); g.comedy_story.setup.scenes[0].lines = [{ speaker: 'jack', en: LONG, ko: '정말로 비는 남한테나 사소한 불편이지' }]; g.comedy_story.resolution.scenes[0].lines = [{ speaker: 'jack', en: LONG, ko: '정말로 비는 남한테나 사소한 불편이지' }]; return g; };

test('fix action: shortens the overflowing Part A scenes (no scene extension, story beats untouched), paid + confirmed', async () => {
  const a = ai({ story: overlong });
  const { s, id } = await episode(a);
  const before = s.store.episodes.get(id);
  const beatsBefore = JSON.stringify(before.comedy_story);
  assert.equal(before.scenes.filter((x) => x.part === 'B').length, 0, 'no ending part exists');
  const durationsBefore = before.scenes.map((x) => x.durationSec);
  const est = s.scriptgen.fitEstimate(id, []);
  assert.deepEqual(est.sceneIds, ['S1', 'S5']);
  const calls0 = a.calls.length;
  await assert.rejects(s.scriptgen.fitDialogue(id, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(a.calls.length, calls0, 'no paid call without confirmation');
  const r = await s.scriptgen.fitDialogue(id, { confirm: CONFIRM });
  assert.deepEqual(r.fitted.map((x) => x.sceneId), ['S1', 'S5']);
  r.fitted.forEach((x) => assert.ok(x.afterSec < x.beforeSec));
  assert.deepEqual(r.stillOver, [], 'the shortened scenes fit');
  const after = s.store.episodes.get(id);
  assert.deepEqual(after.scenes.map((x) => x.durationSec), durationsBefore, 'scene durations are NOT extended');
  assert.equal(JSON.stringify(after.comedy_story), beatsBefore, 'the six beats (titles, stories, scene links) are unchanged');
  assert.equal(after.scenes.filter((x) => x.part === 'B').length, 0, 'still no ending part');
  assert.ok(after.lines.filter((l) => l.sceneId === 'S1').length >= 1);
  assert.equal(s.episodeView(id).derived.validation.ok, true);
  assert.match(a.calls.at(-1).prompt, /TIMING_TARGETS/);
  assert.match(a.calls.at(-1).prompt, /wordBudget/);
  assert.ok(s.store.episodes.versions(id).some((v) => /대사 시간 맞추기/.test(v.note)), 'recorded as a version');
});

test('fix action: an approved script or hand edits are never changed without an explicit overwrite', async () => {
  const { s, id } = await episode();
  await approveWithScenes(s, id);
  await makeLong(s, id, ['S1']); // editing un-approves; re-fix to approve again below
  const sc = s.store.episodes.get(id).scenes.find((x) => x.id === 'S1');
  assert.equal(sc.manualEdit, true);
  await assert.rejects(s.scriptgen.fitDialogue(id, { confirm: CONFIRM }), (e) => e.code === 'MANUAL_EDITS');
  const ok = await s.scriptgen.fitDialogue(id, { confirm: CONFIRM, overwrite: true });
  assert.deepEqual(ok.fitted.map((x) => x.sceneId), ['S1']);
  // approved script: protected
  const second = await episode();
  await approveWithScenes(second.s, second.id);
  assert.equal(second.s.episodeView(second.id).derived.scriptApproved, true);
  await assert.rejects(second.s.scriptgen.fitDialogue(second.id, { confirm: CONFIRM }), (e) => e.code === 'NOTHING_TO_FIT');
  // there is no ending shot to protect any more: an E1 scene id does not exist
  const t = await episode();
  await assert.rejects(t.s.scriptgen.fitDialogue(t.id, { confirm: CONFIRM, sceneIds: ['E1'] }), (e) => e.code === 'NOTHING_TO_FIT');
});

test('fix action: an AI answer that adds lines, changes a speaker or uses a forbidden claim is rejected and nothing changes', async () => {
  for (const bad of [
    (t) => ({ scenes: t.map((x) => ({ id: x.id, lines: [{ id: 'L999', speaker: 'jack', en: 'New line', ko: '새 대사' }] })) }),
    (t) => ({ scenes: t.map((x) => ({ id: x.id, lines: [{ id: x.lines[0].id, speaker: x.lines[0].speaker === 'jack' ? 'diane' : 'jack', en: 'Hi', ko: '안녕' }] })) }),
    (t) => ({ scenes: t.map((x) => ({ id: x.id, lines: [{ id: x.lines[0].id, speaker: x.lines[0].speaker, en: 'Totally waterproof', ko: '완전 방수' }] })) }),
    (t) => ({ scenes: t.map((x) => ({ id: x.id, lines: x.lines.map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko })) })) }), // not shorter
  ]) {
    const { s, id } = await episode(ai({ fit: bad }), { claims: ['방수'] });
    await makeLong(s, id, ['S1']);
    const before = JSON.stringify(s.store.episodes.get(id).lines);
    await assert.rejects(s.scriptgen.fitDialogue(id, { confirm: CONFIRM, overwrite: true }), (e) => e.code === 'SCRIPT_REJECTED');
    assert.equal(JSON.stringify(s.store.episodes.get(id).lines), before);
  }
});

// ---------- 5. estimate vs actual voice duration ----------
test('UI data: estimated dialogue time is kept apart from the actual synthesized voice duration', async () => {
  const { s, id } = await episode();
  await approveWithScenes(s, id);
  let timing = s.episodeView(id).derived.timing.scenes;
  assert.ok(timing.every((t) => t.needSec > 0 && t.actual.needSec === null && t.actual.complete === false), 'before synthesis there is only an estimate');
  await s.voice.synthesize(id, {}); // mock mode: free
  timing = s.episodeView(id).derived.timing.scenes;
  const s1 = timing.find((t) => t.sceneId === 'S1');
  assert.equal(s1.actual.complete, true);
  assert.equal(s1.actual.syncedLines, s1.actual.totalLines);
  assert.ok(s1.actual.needSec > 0);
  assert.equal(s1.actual.mock, true, 'mock audio is labelled as such');
  assert.equal(typeof s1.actual.overSec, 'number');
  assert.notEqual(s1.actual.needSec, s1.needSec, 'estimate and actual are separate numbers');
});
