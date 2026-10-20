'use strict';
const { approveWithScenes } = require('./helpers/approve');
// Fixed episode formula: six story beats only (the fixed product ending / Part B was removed; the product appears in the product_bridge beat).
// All AI is faked; the umbrella-holder episode uses the exact narrative of the series brief. Nothing is billed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createStudio } = require('../studio/lib/studio');
const F = require('../studio/lib/formula');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, umbrellaStory, goodBeat, png, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const ai = (opts) => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req, opts) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });
const scriptCalls = (a) => a.calls.filter((c) => /CONCEPT_TITLE/.test(c.prompt || ''));
async function episode(a = ai()) {
  const m = make({ ai: a });
  const pid = await readyProduct(m.s);
  routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  return Object.assign(m, { id, pid, a });
}
const A = (ep) => ep.scenes.filter((s) => s.part === 'A');
const B = (ep) => ep.scenes.filter((s) => s.part === 'B');

test('a new episode has an empty six-beat story and no Part B / ending at all', async () => {
  const { s, id } = await episode();
  const ep = s.store.episodes.get(id);
  assert.equal(F.isStructured(ep), true);
  assert.deepEqual(F.BEAT_KEYS, Object.keys(ep.comedy_story));
  assert.deepEqual(F.BEAT_KEYS, ['setup', 'problem', 'absurd_escalation', 'unexpected_twist', 'resolution', 'product_bridge']);
  assert.deepEqual(F.ENDING_KEYS, []);
  assert.equal(ep.product_ending, undefined);
  assert.equal(ep.ending, undefined);
  assert.equal(ep.archivedEnding, undefined);
  assert.equal(A(ep).length, 0);
  assert.equal(B(ep).length, 0);
  assert.equal(ep.scenes.length, 0);
  const v = s.episodeView(id);
  assert.equal(v.formula.structured, true);
  assert.equal(v.formula.partA.length, 6);
  assert.equal(v.formula.partB, undefined);
  // a brand-new episode is not approvable: the six beats are missing
  assert.equal(v.derived.validation.ok, false);
  assert.equal(v.derived.validation.errors.filter((e) => e.code === 'BEAT_MISSING').length, 6);
});

test('umbrella episode: the generated script keeps every one of the six narrative beats in order, and no ending after them', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const ep = s.store.episodes.get(id);
  const fx = umbrellaStory();
  // the six beats, in order, each with its scenes and the exact narrative of the brief
  assert.deepEqual(A(ep).map((x) => x.beatKey).filter((k, i, arr) => arr.indexOf(k) === i), F.BEAT_KEYS);
  F.BEAT_KEYS.forEach((k) => {
    assert.ok(ep.scenes.some((x) => x.beatKey === k), k);
    assert.equal(ep.comedy_story[k].story_en, fx.comedy_story[k].story_en, k);
    assert.equal(ep.comedy_story[k].title_ko, fx.comedy_story[k].title_ko, k);
    assert.ok(ep.comedy_story[k].sceneIds.length >= 1);
    assert.ok(ep.comedy_story[k].durationSec > 0);
  });
  assert.match(ep.comedy_story.setup.story_en, /refuses an umbrella while walking in Gangnam/);
  assert.match(ep.comedy_story.problem.story_en, /absurd Korean monsoon/);
  assert.match(ep.comedy_story.absurd_escalation.story_en, /cartoon-scale tsunami/);
  assert.match(ep.comedy_story.unexpected_twist.story_en, /commuting by boat/);
  assert.match(ep.comedy_story.resolution.story_en, /hilltop home completely soaked/);
  assert.match(ep.comedy_story.product_bridge.story_en, /walking puddle.*towel/);
  // the product is shown ONLY in the product_bridge beat; there is no Part B
  assert.ok(ep.scenes.every((x) => x.part === 'A'));
  assert.equal(B(ep).length, 0);
  assert.ok(ep.scenes.filter((x) => x.showsProduct).length >= 1);
  assert.ok(ep.scenes.filter((x) => x.showsProduct).every((x) => x.beatKey === 'product_bridge'));
  assert.ok(ep.scenes.filter((x) => x.beatKey !== 'product_bridge').every((x) => x.showsProduct === false));
  assert.equal(ep.product_ending, undefined);
  assert.equal(ep.ending, undefined);
  assert.equal(ep.scenes.length, 6);
  // validation passes (6 beats, Korean titles) and a prompt asked for comedy intensity 3 by default
  const v = s.episodeView(id);
  assert.equal(v.derived.validation.ok, true, JSON.stringify(v.derived.validation.errors));
  const prompt = scriptCalls(a).pop().prompt;
  assert.match(prompt, /COMEDY INTENSITY 3/);
  assert.match(prompt, /FIXED EPISODE FORMULA/);
  assert.doesNotMatch(prompt, /Part B|PART B|ending shot|E1\.\.E4/);
  assert.equal(ep.scriptSource.comedyLevel, 3);
  // every scene has a Korean title; subtitles are separate from English
  assert.ok(ep.scenes.every((x) => /[가-힣]/.test(x.title_ko)));
  assert.ok(ep.lines.every((l) => l.en && l.ko && l.en !== l.ko));
  // Diane never says 오빠
  assert.ok(!ep.lines.some((l) => l.speaker === 'diane' && /오빠/.test(l.en + l.ko)));
});

test('the AI cannot break the formula: a missing beat, a generic beat title or an empty beat is rejected and nothing is saved', async () => {
  for (const mutate of [(g) => { delete g.comedy_story.unexpected_twist; }, (g) => { g.comedy_story.problem.title_ko = '위기 1'; }, (g) => { g.comedy_story.setup.scenes = []; }]) {
    const { s, id } = await episode(ai({ story: () => { const g = umbrellaStory(); mutate(g); return g; } }));
    await assert.rejects(s.scriptgen.generate(id, { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_REJECTED');
    const ep = s.store.episodes.get(id);
    assert.equal(A(ep).length, 0);
    assert.equal(B(ep).length, 0);
  }
  // a model that "writes" an ending itself is ignored: unknown keys / a product_ending never become shots or episode data
  const { s, id } = await episode(ai({ story: () => { const g = umbrellaStory(); g.product_ending = { extra: { x: 1 } }; g.ending = { templateId: 'x' }; g.comedy_story.extra_beat = g.comedy_story.setup; return g; } }));
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const ep = s.store.episodes.get(id);
  assert.equal(B(ep).length, 0);
  assert.equal(ep.product_ending, undefined);
  assert.equal(ep.ending, undefined);
  assert.deepEqual([...new Set(A(ep).map((x) => x.beatKey))], F.BEAT_KEYS);
  assert.ok(!('extra_beat' in ep.comedy_story));
});

test('validation: every beat present, Part A scenes in beat order; no ending rules exist any more', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const all = () => s.store.episodes.get(id).scenes;
  const codes = () => s.episodeView(id).derived.validation.errors.map((e) => e.code);
  assert.deepEqual(codes(), []);
  // scenes out of beat order are an error
  const order = all().map((x) => ({ ...x })); [order[0], order[1]] = [order[1], order[0]];
  await s.saveScript(id, { scenes: order });
  assert.ok(codes().includes('BEAT_ORDER'));
  assert.ok(!codes().some((c) => /^ENDING_/.test(c)));
  await s.saveScript(id, { scenes: all().slice().sort((a, b) => F.BEAT_KEYS.indexOf(a.beatKey) - F.BEAT_KEYS.indexOf(b.beatKey)).map((x) => ({ ...x })) });
  assert.ok(!codes().includes('BEAT_ORDER'));
  // removing the scenes of a beat is an error naming that beat
  const keep = all().filter((x) => x.beatKey !== 'unexpected_twist');
  await s.saveScript(id, { scenes: keep.map((x) => ({ ...x })) });
  const errs = s.episodeView(id).derived.validation.errors;
  assert.ok(errs.some((e) => e.code === 'BEAT_MISSING' && e.beatKey === 'unexpected_twist'));
  assert.ok(!errs.some((e) => /^ENDING_/.test(e.code)));
});

test('no structure lock any more: scenes can be added, removed and reordered freely; a scene can never be (re)assigned to Part B', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const sc = () => s.store.episodes.get(id).scenes.map((x) => ({ ...x }));
  const n = sc().length;
  // removing a scene is allowed (no STRUCTURE_LOCKED)
  await s.saveScript(id, { scenes: sc().filter((x) => x.id !== 'S3') });
  assert.equal(s.store.episodes.get(id).scenes.length, n - 1);
  // a client cannot create a Part B scene: it is coerced to a Part A beat or dropped
  await s.saveScript(id, { scenes: sc().concat([{ id: 'E9', part: 'B', beatKey: 'jack_reaction', title_ko: '추가 컷', durationSec: 3, characters: ['jack'] }]) });
  assert.equal(B(s.store.episodes.get(id)).length, 0);
  assert.ok(s.store.episodes.get(id).scenes.every((x) => F.BEAT_KEYS.includes(x.beatKey) && x.part === 'A'));
  // ordinary content edits still work and are flagged as manual edits
  await s.saveScript(id, { scenes: sc().map((x) => (x.id === 'S1' ? { ...x, visual: 'My own framing of the opening.' } : x)) });
  const e1 = s.store.episodes.get(id).scenes.find((x) => x.id === 'S1');
  assert.equal(e1.visual, 'My own framing of the opening.');
  assert.equal(e1.manualEdit, true);
});

test('story actions change only what they name; manual edits are protected', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const partA = () => JSON.stringify(A(s.store.episodes.get(id)).map((x) => [x.id, x.beatKey, x.title_ko]));
  // Regenerate Comedy Story (whole Part A, needs overwrite once a story exists)
  await assert.rejects(s.scriptgen.regenerate(id, 'story', { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_EXISTS');
  await s.scriptgen.regenerate(id, 'story', { confirm: CONFIRM, overwrite: true });
  assert.equal(B(s.store.episodes.get(id)).length, 0, 'regeneration never creates a Part B');
  // Improve Escalation / Strengthen Twist / Improve Bridge: only that beat changes
  const cases = [['escalation', 'absurd_escalation'], ['twist', 'unexpected_twist'], ['bridge', 'product_bridge']];
  for (const [action, key] of cases) {
    const before = s.store.episodes.get(id);
    const others = JSON.stringify(before.scenes.filter((x) => x.beatKey !== key && x.part === 'A').map((x) => [x.id, x.title_ko, x.visual]));
    const calls0 = scriptCalls(a).length;
    await assert.rejects(s.scriptgen.regenerate(id, action, {}), (e) => e.code === 'CONFIRM_REQUIRED' || e.code === 'SCRIPT_APPROVED');
    assert.equal(scriptCalls(a).length, calls0, 'no paid call without confirmation');
    await s.scriptgen.regenerate(id, action, { confirm: CONFIRM });
    const after = s.store.episodes.get(id);
    assert.equal(JSON.stringify(after.scenes.filter((x) => x.beatKey !== key && x.part === 'A').map((x) => [x.id, x.title_ko, x.visual])), others, action + ': other beats unchanged');
    assert.match(after.comedy_story[key].title_ko, /NEW$/);
    assert.ok(after.scenes.filter((x) => x.beatKey === key).every((x) => /NEW$/.test(x.title_ko)));
    assert.equal(B(after).length, 0, action + ': still no Part B');
    assert.match(scriptCalls(a).pop().prompt, new RegExp('TARGET_BEAT: ' + key));
  }
  // manual edit inside a beat is protected: replacing it needs explicit overwrite
  const sc = s.store.episodes.get(id).scenes.map((x) => ({ ...x }));
  const target = sc.find((x) => x.beatKey === 'absurd_escalation');
  target.visual = 'MY HAND-WRITTEN ESCALATION VISUAL';
  await s.saveScript(id, { scenes: sc });
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === target.id).manualEdit, true);
  await assert.rejects(s.scriptgen.regenerate(id, 'escalation', { confirm: CONFIRM }), (e) => e.code === 'MANUAL_EDITS');
  assert.match(JSON.stringify(s.store.episodes.get(id).scenes), /MY HAND-WRITTEN ESCALATION VISUAL/);
  // an untouched beat can still be regenerated without overwrite
  await s.scriptgen.regenerate(id, 'twist', { confirm: CONFIRM });
  assert.match(JSON.stringify(s.store.episodes.get(id).scenes), /MY HAND-WRITTEN ESCALATION VISUAL/);
  assert.ok(partA().length > 0);
});

test('operator-written story beats are preserved: they are sent to the AI and survive generation', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  await s.saveScript(id, { comedy_story: { setup: { story_en: 'MY OWN SETUP: Jack refuses the umbrella in Gangnam.' }, resolution: { title_ko: '젖은 쥐의 귀환', story_en: 'MY OWN RESOLUTION: Jack gets home soaked.' } } });
  assert.equal(s.store.episodes.get(id).comedy_story.setup.manual, true);
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const prompt = scriptCalls(a).pop().prompt;
  assert.match(prompt, /USER_STORY_BEATS/);
  assert.match(prompt, /MY OWN SETUP: Jack refuses the umbrella in Gangnam\./);
  assert.match(prompt, /MY OWN RESOLUTION/);
  const ep = s.store.episodes.get(id);
  assert.equal(ep.comedy_story.setup.story_en, 'MY OWN SETUP: Jack refuses the umbrella in Gangnam.', 'the operator\'s text is kept');
  assert.equal(ep.comedy_story.resolution.title_ko, '젖은 쥐의 귀환');
  assert.equal(ep.comedy_story.problem.story_en, umbrellaStory().comedy_story.problem.story_en, 'beats the operator did not write come from the AI');
  assert.equal(ep.comedy_story.setup.title_ko, '영국인의 자신감', 'fields the operator left empty are filled by the AI');
  assert.equal(s.episodeView(id).derived.validation.ok, true, JSON.stringify(s.episodeView(id).derived.validation.errors));
});

test('product shown only in the product_bridge beat; changing the product never changes the series format', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const ep = s.store.episodes.get(id);
  const shown = ep.scenes.filter((x) => x.showsProduct);
  assert.ok(shown.length >= 1);
  assert.ok(shown.every((x) => x.beatKey === 'product_bridge'), 'the product appears only in the product_bridge beat');
  // an AI that marks other beats as showing the product is corrected (normalizeBeat keeps showsProduct only for product_bridge)
  const lie = ai({ story: () => { const g = umbrellaStory(); g.comedy_story.setup.scenes[0].showsProduct = true; g.comedy_story.resolution.scenes[0].showsProduct = true; return g; } });
  const m2 = await episode(lie);
  await m2.s.scriptgen.generate(m2.id, { confirm: CONFIRM });
  assert.ok(m2.s.store.episodes.get(m2.id).scenes.filter((x) => x.showsProduct).every((x) => x.beatKey === 'product_bridge'));
  // regenerating the bridge changes only that beat; the format (six beats, no ending, no ending vars) stays
  const shape = (e) => JSON.stringify(e.scenes.filter((x) => x.beatKey !== 'product_bridge').map((x) => [x.id, x.beatKey, x.title_ko, x.durationSec, x.characters]));
  await s.scriptgen.regenerate(id, 'bridge', { confirm: CONFIRM });
  const ep2 = s.store.episodes.get(id);
  assert.equal(shape(ep2), shape(ep));
  assert.deepEqual(Object.keys(ep2.comedy_story), F.BEAT_KEYS);
  assert.equal(B(ep2).length, 0);
  assert.equal(ep2.ending, undefined);
  assert.ok(ep2.scenes.filter((x) => x.showsProduct).every((x) => x.beatKey === 'product_bridge'));
});

test('the removed AI actions are rejected: "ending" is no longer an action and there are no ending selectors', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  await assert.rejects(s.scriptgen.regenerate(id, 'ending', { confirm: CONFIRM, overwrite: true }), (e) => e.code === 'BAD_ACTION');
  assert.equal(s.scriptgen.selectEnding, undefined);
  assert.equal(s.reuseEndingAssets, undefined);
});

test('archiveEnding: an old episode with Part B scenes / product_ending / ending is archived, nothing deleted, validates clean, idempotent', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const fresh = JSON.parse(JSON.stringify(s.store.episodes.get(id)));
  // build the JSON an old (pre-removal) episode would have: Part B scenes E1..E4 with lines, product_ending and ending settings
  const oldB = [['E1', 'shopping_excuse'], ['E2', 'product_demonstration'], ['E3', 'jack_reaction'], ['E4', 'jack_reaction']].map(([sid, beatKey]) => ({ id: sid, part: 'B', beatKey, title_ko: '옛 엔딩 ' + sid, durationSec: 5, characters: ['jack', 'diane'], showsProduct: sid === 'E2', visual: 'old ' + sid }));
  const oldLines = oldB.map((x) => ({ id: 'L' + x.id, sceneId: x.id, speaker: 'diane', en: 'old ' + x.id, ko: '옛 ' + x.id }));
  const old = Object.assign(JSON.parse(JSON.stringify(fresh)), { product_ending: { shopping_excuse: { sceneIds: ['E1'] } }, ending: { templateId: 'jack-diane-coupang-ending-v1', structureLocked: true } });
  old.scenes = old.scenes.concat(oldB);
  old.lines = old.lines.concat(oldLines);
  const nA = fresh.scenes.length; const nL = fresh.lines.length;
  assert.equal(F.archiveEnding(old), true);
  assert.equal(old.scenes.length, nA);
  assert.equal(old.lines.length, nL);
  assert.ok(old.scenes.every((x) => x.part === 'A'));
  assert.ok(!old.lines.some((l) => /^E\d/.test(l.sceneId)));
  assert.equal(old.product_ending, undefined);
  assert.equal(old.ending, undefined);
  assert.deepEqual(old.archivedEnding.scenes.map((x) => x.id), ['E1', 'E2', 'E3', 'E4']);
  assert.deepEqual(old.archivedEnding.lines.map((l) => l.sceneId), ['E1', 'E2', 'E3', 'E4']);
  assert.deepEqual(old.archivedEnding.product_ending, { shopping_excuse: { sceneIds: ['E1'] } });
  assert.equal(old.archivedEnding.ending.templateId, 'jack-diane-coupang-ending-v1');
  assert.deepEqual(Object.keys(old.comedy_story), F.BEAT_KEYS);
  // idempotent: a second call changes nothing
  const snap = JSON.stringify(old);
  assert.equal(F.archiveEnding(old), false);
  assert.equal(JSON.stringify(old), snap);
  // and an episode without any ending data is untouched
  assert.equal(F.archiveEnding(JSON.parse(JSON.stringify(fresh))), false);
  assert.equal(F.archiveEnding(null), false);
});

test('store.episodes.get() returns an old episode already archived (in memory on every read) and it validates clean', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const nA = s.store.episodes.get(id).scenes.length;
  // write an old-shaped episode straight into the store (what a pre-removal data file looks like)
  await s.store.episodes.update(id, (e) => {
    e.scenes.push({ id: 'E1', part: 'B', beatKey: 'shopping_excuse', title_ko: '쇼핑 본능 발동', durationSec: 5, characters: ['diane'], visual: 'old' });
    e.lines.push({ id: 'LE1', sceneId: 'E1', speaker: 'diane', en: 'old line', ko: '옛 대사' });
    e.product_ending = { shopping_excuse: { sceneIds: ['E1'] } };
    e.ending = { templateId: 'jack-diane-coupang-ending-v1', structureLocked: true };
  });
  const ep = s.store.episodes.get(id);
  assert.equal(ep.scenes.length, nA);
  assert.equal(B(ep).length, 0);
  assert.ok(!ep.lines.some((l) => l.sceneId === 'E1'));
  assert.equal(ep.product_ending, undefined);
  assert.equal(ep.ending, undefined);
  assert.deepEqual(ep.archivedEnding.scenes.map((x) => x.id), ['E1']);
  assert.equal(ep.archivedEnding.lines[0].en, 'old line');
  assert.equal(ep.archivedEnding.ending.templateId, 'jack-diane-coupang-ending-v1');
  // views/validation never see the ending
  const v = s.episodeView(id);
  assert.equal(v.derived.validation.ok, true, JSON.stringify(v.derived.validation.errors));
  assert.ok(!v.scenes.some((x) => x.id === 'E1'));
  // reading repeatedly never duplicates the archive
  assert.equal(s.store.episodes.get(id).archivedEnding.scenes.length, 1);
  // saving the episode keeps the archive
  await s.saveScript(id, { title: '수정한 제목' });
  assert.equal(s.store.episodes.get(id).archivedEnding.scenes.length, 1);
});

test('safe migration: an unmodified built-in preset gets the formula text as a NEW version; an edited one is left alone', async () => {
  const a = ai();
  const m = make({ ai: a });
  const file = m.s.store.path('script-presets.json');
  m.s.presets.list(); // creates the file (schema 2)
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  // simulate a production file written before this feature (schema 1, v1 = old default text)
  d.schema = 1;
  d.presets['comedy-engine-v3'].versions[0].sections.sceneStructure = 'OLD sceneStructure text (before the fixed formula).';
  fs.writeFileSync(file, JSON.stringify(d));
  const s2 = createStudio({ cfg: m.cfg, aiProviderFactory: a.factory });
  const p = s2.presets.get('comedy-engine-v3');
  assert.equal(p.current, 2);
  assert.match(p.sections.sceneStructure, /fixed formula/i);
  assert.match(s2.presets.versionSections('comedy-engine-v3', 1).sceneStructure, /^OLD sceneStructure/, 'v1 preserved');
  // an operator-edited preset keeps its text
  const e = s2.presets.save('comedy-engine-v3', { sections: { subtitleStyle: 'MY OWN SUBTITLE STYLE for the series.' } });
  const d2 = JSON.parse(fs.readFileSync(file, 'utf8')); d2.schema = 1; fs.writeFileSync(file, JSON.stringify(d2));
  const s3 = createStudio({ cfg: m.cfg, aiProviderFactory: a.factory });
  assert.equal(s3.presets.get('comedy-engine-v3').current, e.current, 'edited preset not migrated');
  assert.match(s3.presets.get('comedy-engine-v3').sections.subtitleStyle, /MY OWN SUBTITLE STYLE/);
  // either way the locked constraints enforce the formula
  assert.match(s3.presets.compose({}, {}, { mode: 'story' }).locked, /FIXED EPISODE FORMULA/);
});

test('legacy episodes keep working: no formula is forced onto an existing script, approvals and edits are unchanged', async () => {
  const { s } = make({ ai: ai() });
  const made = await s.createEpisode({ id: 'EP91', title: '옛 에피소드', productName: 'x', features: ['사실'] });
  const id = made.id || made;
  const v = s.episodeView(id);
  assert.equal(v.formula.structured, false);
  assert.equal(v.derived.validation.errors.some((e) => ['BEAT_MISSING'].includes(e.code) || /^ENDING_/.test(e.code)), false);
  await s.saveScript(id, { title: '수정한 제목' });
  assert.equal(s.store.episodes.get(id).title, '수정한 제목');
  await assert.rejects(s.scriptgen.regenerate(id, 'story', {}), (e) => e.code === 'NOT_FORMULA');
});

test('paid-generation gates are unchanged: every AI action needs confirmation; the script is the gate for paid assets', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  const calls0 = a.calls.length;
  await assert.rejects(s.scriptgen.generate(id, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  await assert.rejects(s.scriptgen.regenerate(id, 'twist', {}), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(a.calls.length, calls0, 'no AI call without explicit confirmation');
  await assert.rejects(s.scriptgen.regenerate(id, 'bogus', { confirm: CONFIRM }), (e) => e.code === 'BAD_ACTION');
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  await approveWithScenes(s, id);
  // an approved script is not replaced without an explicit overwrite
  await assert.rejects(s.scriptgen.regenerate(id, 'twist', { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_APPROVED');
  assert.equal(s.episodeView(id).derived.scriptApproved, true);
  // and paid video stays blocked for an unapproved script
  await s.scriptgen.regenerate(id, 'twist', { confirm: CONFIRM, overwrite: true });
  assert.equal(s.episodeView(id).derived.scriptApproved, false);
  await assert.rejects(s.gen.authorize(id, { confirmUnknown: true }), (e) => e.code === 'BLOCKED' && e.details.some((d) => d.code === 'SCRIPT_NOT_APPROVED'));
});

test('storyboard / video / render stay compatible: flat scenes with titles, timeline and prompts work for the new structure', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  await approveWithScenes(s, id);
  const v = s.episodeView(id);
  assert.equal(v.scenes.length, 6);
  assert.ok(v.scenes.every((x) => x.title_ko && x.part === 'A' && x.beatKey));
  assert.equal(v.timeline.scenes.length, 6);
  assert.equal(v.timeline.scenes[5].title, '현관 출입 금지');
  // template storyboard prompts exist for every scene (free, deterministic) and mention the Korean-titled scene
  const ep = s.store.episodes.get(id);
  assert.equal(Object.keys(ep.prompts).length, 6);
  assert.match(ep.prompts.S4.video, /SCENE S4|출근길의 보트/);
});
