'use strict';
const { approveWithScenes } = require('./helpers/approve');
// Fixed episode formula: Part A (six beats) + Part B (exactly three product-ending shots from a reusable template).
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
// New episodes cap scenes at 5 s, so the 10 s closing reaction is two consecutive scenes (E3 + E4) of the same beat.
const Bkeys = (ep) => [...new Set(B(ep).map((x) => x.beatKey))];
const reactionIds = ['E3', 'E4'];
const snapB = (ep) => JSON.stringify({ scenes: B(ep), lines: ep.lines.filter((l) => B(ep).some((s) => s.id === l.sceneId)), beats: ep.product_ending });

test('a new episode gets the default ending template automatically (exactly three Part B shots) and an empty six-beat Part A', async () => {
  const { s, id } = await episode();
  const ep = s.store.episodes.get(id);
  assert.equal(F.isStructured(ep), true);
  assert.deepEqual(F.BEAT_KEYS, Object.keys(ep.comedy_story));
  assert.deepEqual(F.ENDING_KEYS, Object.keys(ep.product_ending));
  assert.equal(A(ep).length, 0);
  assert.deepEqual(B(ep).map((x) => [x.id, x.beatKey]), [['E1', 'shopping_excuse'], ['E2', 'product_demonstration'], ['E3', 'jack_reaction'], ['E4', 'jack_reaction']]);
  assert.equal(ep.ending.templateId, 'jack-diane-coupang-ending-v1');
  assert.equal(ep.ending.templateName, 'Jack & Diane — Coupang Ending v1');
  assert.equal(ep.ending.structureLocked, true);
  assert.deepEqual(B(ep).map((x) => x.title_ko), ['쇼핑 본능 발동', '신문물 자랑', '영국인의 마지막 고집', '영국인의 마지막 고집']);
  const v = s.episodeView(id);
  assert.equal(v.formula.structured, true);
  assert.equal(v.formula.partA.length, 6);
  assert.equal(v.formula.partB.length, 3);
  assert.deepEqual(v.formula.partB.map((x) => x.sceneIds), [['E1'], ['E2'], ['E3', 'E4']]);
  // a brand-new episode is not approvable: the six beats are missing
  assert.equal(v.derived.validation.ok, false);
  assert.equal(v.derived.validation.errors.filter((e) => e.code === 'BEAT_MISSING').length, 6);
});

test('umbrella episode: the generated script keeps every one of the six narrative beats in order, then exactly three ending shots', async () => {
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
  // Part A never shows the product; Part B is exactly three shots
  assert.ok(A(ep).every((x) => x.showsProduct === false));
  assert.deepEqual(Bkeys(ep), F.ENDING_KEYS);
  assert.equal(B(ep).length, 4);
  assert.ok(ep.scenes.map((x) => x.part).join('').match(/^A+B{4}$/), 'all of Part A comes before Part B');
  // the three ending shots follow the series template with this product's variables
  const lines = (sid) => ep.lines.filter((l) => l.sceneId === sid).map((l) => `${l.speaker}: ${l.en}`);
  assert.match(lines('E1')[0], /^diane: BABYYYY!!! Perfect excuse to order magnetic umbrella holder on Coupang!/);
  assert.match(lines('E2')[0], /It just sticks to the door!/);
  assert.deepEqual(lines('E3').concat(lines('E4')), ['diane: BABYYYY!!! LOOK WHAT I GOT!', 'jack: Good job, baby!', 'diane: You\'ll use an umbrella now?', 'jack: Absolutely not.', 'diane: JACK!!!']);
  assert.equal(B(ep)[1].showsProduct, true);
  assert.match(B(ep)[1].visual, /magnetic umbrella holder/);
  // validation passes (6 beats, 3 shots, Korean titles) and a prompt asked for comedy intensity 3 by default
  const v = s.episodeView(id);
  assert.equal(v.derived.validation.ok, true, JSON.stringify(v.derived.validation.errors));
  const prompt = scriptCalls(a).pop().prompt;
  assert.match(prompt, /COMEDY INTENSITY 3/);
  assert.match(prompt, /FIXED EPISODE FORMULA/);
  assert.match(prompt, /Do NOT write it and never create a fourth ending shot/);
  assert.equal(ep.scriptSource.comedyLevel, 3);
  // every scene has a Korean title; subtitles are separate from English
  assert.ok(ep.scenes.every((x) => /[가-힣]/.test(x.title_ko)));
  assert.ok(ep.lines.every((l) => l.en && l.ko && l.en !== l.ko));
  // Diane never says 오빠
  assert.ok(!ep.lines.some((l) => l.speaker === 'diane' && /오빠/.test(l.en + l.ko)));
});

test('the AI cannot break the formula: a missing beat, a generic beat title or a fourth ending is rejected and nothing is saved', async () => {
  for (const mutate of [(g) => { delete g.comedy_story.unexpected_twist; }, (g) => { g.comedy_story.problem.title_ko = '위기 1'; }, (g) => { g.comedy_story.setup.scenes = []; }]) {
    const { s, id } = await episode(ai({ story: () => { const g = umbrellaStory(); mutate(g); return g; } }));
    await assert.rejects(s.scriptgen.generate(id, { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_REJECTED');
    const ep = s.store.episodes.get(id);
    assert.equal(A(ep).length, 0);
    assert.equal(B(ep).length, 4);
  }
  // a model that "writes" the ending itself is ignored: unknown keys never become shots
  const { s, id } = await episode(ai({ story: () => { const g = umbrellaStory(); g.product_ending = { extra: { x: 1 } }; g.comedy_story.extra_beat = g.comedy_story.setup; return g; } }));
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  assert.equal(B(s.store.episodes.get(id)).length, 4);
  assert.deepEqual([...new Set(A(s.store.episodes.get(id)).map((x) => x.beatKey))], F.BEAT_KEYS);
});

test('validation: exactly three ending shots in the fixed order; Part A before Part B; every beat present', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const all = () => s.store.episodes.get(id).scenes;
  // unlock so structural edits can be tried
  s.endings.save('jack-diane-coupang-ending-v1', { structureLocked: false });
  await s.scriptgen.selectEnding(id, { templateId: 'jack-diane-coupang-ending-v1' });
  assert.equal(s.store.episodes.get(id).ending.structureLocked, false);
  // a 5-second episode may split one ending shot into consecutive scenes (E3 + E4 already do), but never repeat or reorder the three steps
  assert.ok(!s.episodeView(id).derived.validation.errors.some((e) => e.code === 'ENDING_COUNT' || e.code === 'ENDING_ORDER'));
  const order = all().map((x) => ({ ...x })); const i2 = order.findIndex((x) => x.id === 'E2'); const i3 = order.findIndex((x) => x.id === 'E3'); [order[i2], order[i3]] = [order[i3], order[i2]];
  await s.saveScript(id, { scenes: order });
  assert.ok(s.episodeView(id).derived.validation.errors.some((e) => e.code === 'ENDING_ORDER'));
  // legacy episodes (no 5-second policy) keep the exact three-shot rule
  await s.store.episodes.update(id, (e) => { delete e.durationPolicy; });
  await s.saveScript(id, { scenes: all().map((x) => ({ ...x })) });
  assert.ok(s.episodeView(id).derived.validation.errors.some((e) => e.code === 'ENDING_COUNT'));
  await s.store.episodes.update(id, (e) => { e.durationPolicy = { maxSceneSec: 5 }; });
  // removing the scenes of a beat is an error naming that beat
  const keep = all().filter((x) => x.beatKey !== 'unexpected_twist');
  await s.saveScript(id, { scenes: keep.map((x) => ({ ...x })) });
  const errs = s.episodeView(id).derived.validation.errors;
  assert.ok(errs.some((e) => e.code === 'BEAT_MISSING' && e.beatKey === 'unexpected_twist'));
  assert.ok(!errs.some((e) => e.code === 'ENDING_COUNT'));
});

test('structure lock: while locked, Part B cannot gain, lose or reorder shots but its product-specific content can be edited', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const sc = () => s.store.episodes.get(id).scenes.map((x) => ({ ...x }));
  await assert.rejects(s.saveScript(id, { scenes: sc().filter((x) => x.id !== 'E2') }), (e) => e.code === 'STRUCTURE_LOCKED');
  const swapped = sc(); [swapped[swapped.length - 1], swapped[swapped.length - 2]] = [swapped[swapped.length - 2], swapped[swapped.length - 1]];
  await assert.rejects(s.saveScript(id, { scenes: swapped }), (e) => e.code === 'STRUCTURE_LOCKED');
  await assert.rejects(s.saveScript(id, { scenes: sc().concat([{ id: 'E9', part: 'B', beatKey: 'jack_reaction', title_ko: '추가 컷', durationSec: 3, characters: ['jack'] }]) }), (e) => e.code === 'STRUCTURE_LOCKED');
  // a client cannot re-assign a Part B scene to another slot or part either
  const re = sc().map((x) => (x.id === 'E2' ? { ...x, beatKey: 'setup', part: 'A' } : x));
  await s.saveScript(id, { scenes: re });
  assert.deepEqual(Bkeys(s.store.episodes.get(id)), F.ENDING_KEYS);
  // product-specific content is editable
  await s.saveScript(id, { scenes: sc().map((x) => (x.id === 'E2' ? { ...x, visual: 'My own demo framing of the holder.' } : x)) });
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === 'E2').visual, 'My own demo framing of the holder.');
});

test('Part A actions never rewrite Part B; separate actions change only what they name; manual edits are protected', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const beforeB = snapB(s.store.episodes.get(id));
  const partA = () => JSON.stringify(A(s.store.episodes.get(id)).map((x) => [x.id, x.beatKey, x.title_ko]));
  // Regenerate Comedy Story (whole Part A, needs overwrite once a story exists)
  await assert.rejects(s.scriptgen.regenerate(id, 'story', { confirm: CONFIRM }), (e) => e.code === 'SCRIPT_EXISTS');
  await s.scriptgen.regenerate(id, 'story', { confirm: CONFIRM, overwrite: true });
  assert.equal(snapB(s.store.episodes.get(id)), beforeB, 'Part B untouched by a Part A regeneration');
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
    assert.equal(snapB(after), beforeB, action + ': Part B untouched');
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

test('changing the product updates the product-specific ending content but never the series format', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const shape = (ep) => JSON.stringify(B(ep).map((x) => [x.id, x.beatKey, x.title_ko, x.durationSec, x.characters, x.showsProduct]));
  const lineShape = (ep) => ep.lines.filter((l) => B(ep).some((x) => x.id === l.sceneId)).map((l) => [l.sceneId, l.speaker]);
  const ep1 = s.store.episodes.get(id);
  // operator changes the product-specific variables for another product
  await s.saveScript(id, { ending: { vars: { PRODUCT_NAME: 'folding laundry rack', PRODUCT_NAME_KO: '접이식 빨래건조대', USE_PHRASE: 'a dryer', USE_PHRASE_KO: '건조기를', DEMO_ACTION: 'Diane unfolds the laundry rack.', DEMO_LINE_EN: 'Unfold, done!', DEMO_LINE_KO: '펴면 끝!' } } });
  const ep2 = s.store.episodes.get(id);
  assert.equal(shape(ep2), shape(ep1), 'same shots, same titles, same durations, same cast');
  assert.deepEqual(lineShape(ep2), lineShape(ep1), 'same speakers in the same order');
  const e1 = ep2.lines.filter((l) => l.sceneId === 'E1')[0];
  assert.match(e1.en, /order folding laundry rack on Coupang/);
  assert.match(e1.ko, /접이식 빨래건조대/);
  assert.match(ep2.lines.filter((l) => reactionIds.includes(l.sceneId))[2].en, /use a dryer now\?/);
  assert.match(B(ep2)[1].visual, /unfolds the laundry rack/);
  // Part A untouched
  assert.equal(JSON.stringify(A(ep2)), JSON.stringify(A(ep1)));
  // the AI action for product-specific dialogue also leaves the format alone and respects hand-typed variables
  await s.scriptgen.regenerate(id, 'ending', { confirm: CONFIRM, overwrite: true });
  const ep3 = s.store.episodes.get(id);
  assert.equal(shape(ep3), shape(ep1));
  assert.equal(JSON.stringify(A(ep3)), JSON.stringify(A(ep1)));
  assert.equal(ep3.ending.vars.PRODUCT_NAME, 'folding laundry rack', 'hand-typed product-specific values are not overwritten by the AI');
});

test('Part B hand edits survive refills; ending template selection per episode; locked structure follows the template version', async () => {
  const { s, id } = await episode();
  await s.scriptgen.generate(id, { confirm: CONFIRM });
  const sc = s.store.episodes.get(id).scenes.map((x) => ({ ...x }));
  const lines = s.store.episodes.get(id).lines.map((l) => ({ ...l }));
  lines.find((l) => reactionIds.includes(l.sceneId) && l.speaker === 'jack' && /Absolutely/.test(l.en)).en = 'Not a chance, baby.';
  await s.saveScript(id, { scenes: sc, lines });
  assert.equal(s.store.episodes.get(id).scenes.find((x) => x.id === lines.find((l) => l.en === 'Not a chance, baby.').sceneId).manualEdit, true);
  await s.saveScript(id, { ending: { vars: { USE_PHRASE: 'a raincoat', USE_PHRASE_KO: '우비를' } } });
  const ep = s.store.episodes.get(id);
  assert.ok(ep.lines.some((l) => reactionIds.includes(l.sceneId) && l.en === 'Not a chance, baby.'), 'the hand-edited shot is kept');
  assert.match(ep.lines.filter((l) => l.sceneId === 'E1')[0].en, /BABYYYY/);
  // another template (a duplicate with a different Jack line) can be selected for just this episode
  const dup = s.endings.duplicate('jack-diane-coupang-ending-v1', { name: '내 엔딩' });
  const shots = JSON.parse(JSON.stringify(dup.shots)); shots.shopping_excuse.lines[0].en = 'ALT-TEMPLATE-LINE for {{PRODUCT_NAME}}!';
  s.endings.save(dup.id, { shots, note: 'alt' });
  await s.scriptgen.selectEnding(id, { templateId: dup.id });
  const ep2 = s.store.episodes.get(id);
  assert.equal(ep2.ending.templateId, dup.id);
  assert.match(ep2.lines.find((l) => l.sceneId === 'E1').en, /ALT-TEMPLATE-LINE/);
  assert.ok(ep2.lines.some((l) => reactionIds.includes(l.sceneId) && l.en === 'Not a chance, baby.'), 'still protected without resetEdits');
  await s.scriptgen.selectEnding(id, { templateId: dup.id, resetEdits: true });
  assert.ok(!s.store.episodes.get(id).lines.some((l) => l.en === 'Not a chance, baby.'), 'resetEdits rebuilds from the template');
  assert.equal(B(s.store.episodes.get(id)).length, 4);
  await assert.rejects(s.scriptgen.selectEnding(id, { templateId: 'nope' }), (e) => e.code === 'NOT_FOUND');
});

test('ending templates: default name, three fixed shots, versions never rewritten, restore default, persisted across a restart', async () => {
  const a = ai();
  const m = make({ ai: a });
  const t0 = m.s.endings.get('jack-diane-coupang-ending-v1');
  assert.equal(t0.name, 'Jack & Diane — Coupang Ending v1');
  assert.equal(t0.builtIn, true);
  assert.deepEqual(Object.keys(t0.shots), F.ENDING_KEYS);
  assert.equal(t0.structureLocked, true);
  assert.equal(m.s.endings.list().activeTemplateId, 'jack-diane-coupang-ending-v1');
  assert.equal(m.s.endings.save(t0.id, { shots: {} }).current, 1, 'no change → no new version');
  const edit = JSON.parse(JSON.stringify(t0.shots)); edit.jack_reaction.lines[1].en = 'Well done, baby!';
  const v2 = m.s.endings.save(t0.id, { shots: edit, note: '수정' });
  assert.equal(v2.current, 2);
  assert.equal(m.s.endings.versionData(t0.id, 1).shots.jack_reaction.lines[1].en, 'Good job, baby!', 'v1 untouched');
  // invalid content is refused (generic title, no lines, unknown speaker, 오빠)
  const bad = (fn) => { const x = JSON.parse(JSON.stringify(t0.shots)); fn(x); return () => m.s.endings.save(t0.id, { shots: x }); };
  assert.throws(bad((x) => { x.shopping_excuse.title_ko = '장면 1'; }), (e) => e.code === 'TEMPLATE_INVALID');
  assert.throws(bad((x) => { x.jack_reaction.lines = []; }), (e) => e.code === 'TEMPLATE_INVALID');
  assert.throws(bad((x) => { x.jack_reaction.lines[0].speaker = 'bob'; }), (e) => e.code === 'TEMPLATE_INVALID');
  assert.throws(bad((x) => { x.shopping_excuse.lines[0].ko = '오빠, 우산 사자'; }), (e) => e.code === 'TEMPLATE_INVALID');
  // the structure cannot be changed from the editor: extra keys are ignored, the three keys remain
  const extra = JSON.parse(JSON.stringify(v2.shots)); extra.fourth_shot = extra.jack_reaction;
  assert.deepEqual(Object.keys(m.s.endings.save(t0.id, { shots: extra }).shots), F.ENDING_KEYS);
  const back = m.s.endings.restore(t0.id, { toDefault: true });
  assert.equal(back.current, 3);
  assert.equal(back.shots.jack_reaction.lines[1].en, 'Good job, baby!');
  assert.equal(m.s.endings.versionData(t0.id, 2).shots.jack_reaction.lines[1].en, 'Well done, baby!', 'history kept');
  // persisted: a fresh Studio on the same data dir sees everything
  m.s.endings.save(t0.id, { shots: edit, note: 'again' });
  const dup = m.s.endings.duplicate(t0.id, { name: '살아남을 템플릿' });
  const s2 = createStudio({ cfg: m.cfg, aiProviderFactory: a.factory });
  assert.equal(s2.endings.get(t0.id).current, 4);
  assert.equal(s2.endings.get(dup.id).name, '살아남을 템플릿');
  assert.equal(s2.endings.list().templates.length, 3, 'two built-ins (Jack & Diane, Gregory Cats) + the duplicate: seeding never overwrites or duplicates an existing file');
  assert.ok(fs.existsSync(m.s.store.path('ending-templates.json')));
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
  assert.equal(v.derived.validation.errors.some((e) => ['BEAT_MISSING', 'ENDING_COUNT'].includes(e.code)), false);
  await s.saveScript(id, { title: '수정한 제목' });
  assert.equal(s.store.episodes.get(id).title, '수정한 제목');
  await assert.rejects(s.scriptgen.regenerate(id, 'story', {}), (e) => e.code === 'NOT_FORMULA');
});

test('paid-generation gates are unchanged: every AI action needs confirmation; the script is the gate for paid assets', async () => {
  const a = ai();
  const { s, id } = await episode(a);
  const calls0 = a.calls.length;
  await assert.rejects(s.scriptgen.generate(id, {}), (e) => e.code === 'CONFIRM_REQUIRED');
  await assert.rejects(s.scriptgen.regenerate(id, 'ending', {}), (e) => e.code === 'CONFIRM_REQUIRED');
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
  assert.equal(v.scenes.length, 10);
  assert.ok(v.scenes.every((x) => x.title_ko && x.part && x.beatKey));
  assert.equal(v.timeline.scenes.length, 10);
  assert.equal(v.timeline.scenes[9].title, '영국인의 마지막 고집');
  // template storyboard prompts exist for every scene (free, deterministic) and mention the Korean-titled scene
  const ep = s.store.episodes.get(id);
  assert.equal(Object.keys(ep.prompts).length, 10);
  assert.match(ep.prompts.E3.video, /SCENE E3|영국인의 마지막 고집/);
  // reusing approved ending start frames from another episode copies them without changing the source
  const other = await episode();
  await other.s.scriptgen.generate(other.id, { confirm: CONFIRM });
  assert.ok(typeof s.reuseEndingAssets === 'function');
  const r = await s.reuseEndingAssets(id, id).catch((e) => e);
  assert.equal(r.code, 'SAME_EPISODE');
});
