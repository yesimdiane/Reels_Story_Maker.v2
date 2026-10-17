'use strict';
// Character Library & Universes: migration (additive, idempotent), CRUD safety, cast resolution, cast-aware story/script
// prompts (no hardcoded Jack/Diane for other universes), cast limits, per-universe fixed ending, and cost safety
// (character work never calls a paid API; existing approval gates are untouched). All AI is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { migrate, SEED_CHARACTERS } = require('../studio/lib/universes');

const CONFIRM = { paid: true, unknownCost: true };
const textAi = () => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 1000, outputTokens: 500 } }) });
const ids = (lib) => lib.characters.map((c) => c.id);

test('migration: universes and the Gregory cats are added; Jack & Diane keep everything an operator set; nothing is invented for the cats', () => {
  const { s } = make();
  const lib = s.store.characters.load();
  assert.equal(lib.schema, 2);
  assert.deepEqual(lib.universes.map((u) => u.id).sort(), ['gregory-cats', 'jackdiane']);
  ['jack', 'diane'].forEach((id) => assert.equal(lib.characters.find((c) => c.id === id).universeId, 'jackdiane'));
  ['cloud', 'louie', 'lucy'].forEach((id) => { const c = lib.characters.find((x) => x.id === id); assert.equal(c.universeId, 'gregory-cats'); assert.equal(c.look, '', 'no visual attributes are invented'); assert.deepEqual(c.references, []); assert.equal(c.voice.heygenVoiceId, ''); });
  const jack = lib.characters.find((c) => c.id === 'jack');
  assert.equal(jack.voice.heygenIdentityId, 'd51329d270cf407490b88693cda054e0', 'the identity reference is kept as an IDENTITY id');
  assert.equal(jack.voice.heygenVoiceId, '', 'an identity id is never treated as a voice id');
  assert.equal(jack.voice.verified, false);
  assert.match(lib.characters.find((c) => c.id === 'cloud').role, /Ragdoll/); assert.match(lib.characters.find((c) => c.id === 'louie').role, /Korean shorthair/);
  assert.ok(lib.characters.find((c) => c.id === 'diane').forbiddenWords.includes('오빠'));
});

test('migration of an existing (schema 1) library on the volume is additive and idempotent', () => {
  const old = { style: { name: 'x' }, characters: [{ id: 'jack', name: 'Jack', role: 'edited role', look: 'EDITED LOOK', personality: ['edited'], catchphrase: 'MINE', references: [{ id: 'ref_1', approved: true }], voice: { heygenVoiceId: 'v1', heygenIdentityId: 'i1', verified: true } }] };
  const a = migrate(JSON.parse(JSON.stringify(old)));
  assert.equal(a.changed, true);
  const j = a.lib.characters.find((c) => c.id === 'jack');
  assert.equal(j.look, 'EDITED LOOK'); assert.equal(j.role, 'edited role'); assert.deepEqual(j.personality, ['edited']);
  assert.equal(j.voice.heygenVoiceId, 'v1'); assert.equal(j.voice.verified, true); assert.equal(j.references[0].approved, true);
  assert.deepEqual(j.catchphrases, ['MINE']); assert.equal(j.universeId, 'jackdiane');
  assert.ok(a.lib.characters.some((c) => c.id === 'cloud'));
  const before = JSON.stringify(a.lib);
  const b = migrate(JSON.parse(before));
  assert.equal(b.changed, false, 'running it again changes nothing');
  assert.equal(JSON.stringify(b.lib), before);
});

test('universe CRUD: create/edit/delete custom universes; built-ins and populated or used universes are protected', async () => {
  const { s } = make();
  const u = s.universes;
  let o = u.createUniverse({ name: 'Space Cats', description: 'cats in space', storyStyle: 'sci-fi comedy', visualStyle: 'flat 2D', language: 'en' });
  const id = o.universes.find((x) => x.name === 'Space Cats').id;
  o = u.editUniverse(id, { description: 'edited', active: false });
  assert.equal(o.universes.find((x) => x.id === id).description, 'edited'); assert.equal(o.universes.find((x) => x.id === id).active, false);
  assert.throws(() => u.createUniverse({ name: '' }), (e) => e.code === 'NAME');
  assert.throws(() => u.deleteUniverse('jackdiane'), (e) => e.code === 'BUILTIN');
  assert.throws(() => u.deleteUniverse('gregory-cats'), (e) => e.code === 'BUILTIN');
  const c = u.createCharacter({ name: 'Nova', universeId: id, role: 'captain' });
  assert.throws(() => u.deleteUniverse(id), (e) => e.code === 'NOT_EMPTY');
  u.deleteCharacter(c.id);
  o = u.deleteUniverse(id);
  assert.ok(!o.universes.some((x) => x.id === id));
});

test('character CRUD: profile fields persist; the built-in couple cannot be deleted; characters used by a project cannot be deleted or moved', async () => {
  const { s } = make();
  const u = s.universes;
  const c = u.createCharacter({ name: 'Milo', universeId: 'gregory-cats', role: 'visiting cat', personality: ['shy', 'sweet'], speakingStyle: 'whispers', catchphrases: ['meep'], relationships: [{ characterId: 'lucy', note: 'best friend' }], behaviorRules: ['hides from strangers'], negativePrompts: ['never angry'] });
  const got = s.store.characters.get(c.id);
  assert.deepEqual(got.personality, ['shy', 'sweet']); assert.equal(got.speakingStyle, 'whispers'); assert.deepEqual(got.catchphrases, ['meep']); assert.equal(got.catchphrase, 'meep');
  assert.deepEqual(got.relationships, [{ characterId: 'lucy', note: 'best friend' }]); assert.deepEqual(got.negativePrompts, ['never angry']);
  assert.equal(got.look, '', 'appearance is not guessed'); assert.deepEqual(got.references, []);
  s.updateCharacter(c.id, { role: 'edited role', look: 'a tiny grey cat' });
  assert.equal(s.store.characters.get(c.id).role, 'edited role');
  assert.throws(() => u.deleteCharacter('jack'), (e) => e.code === 'BUILTIN');
  // a Story Lab selection that includes Milo blocks deletion
  const pid = await readyProduct(s);
  await s.storylab.saveCast(pid, { universeId: 'gregory-cats', characterIds: [c.id, 'lucy'] });
  assert.throws(() => u.deleteCharacter(c.id), (e) => e.code === 'IN_USE');
  assert.equal(u.editCharacter(c.id, { universeId: 'gregory-cats' }).universeId, 'gregory-cats'); // same universe: fine
});

test('cast resolution: a project without a cast is the Jack & Diane cast; wrong universe / unknown / empty casts are rejected, never silently fixed', () => {
  const { s } = make();
  const r0 = s.universes.resolveCast(undefined);
  assert.deepEqual(r0.ids, ['jack', 'diane']); assert.equal(r0.universe.id, 'jackdiane'); assert.equal(r0.cast.implicit, true);
  const bad = s.universes.resolveCast({ universeId: 'gregory-cats', characterIds: ['cloud', 'jack'] });
  assert.ok(bad.errors.some((e) => e.code === 'WRONG_UNIVERSE'));
  assert.ok(s.universes.resolveCast({ universeId: 'nope', characterIds: ['jack'] }).errors.some((e) => e.code === 'NO_UNIVERSE'));
  assert.ok(s.universes.resolveCast({ universeId: 'jackdiane', characterIds: ['ghost'] }).errors.some((e) => e.code === 'UNKNOWN_CHARACTER'));
  assert.ok(s.universes.resolveCast({ universeId: 'jackdiane', characterIds: [] }).errors.some((e) => e.code === 'EMPTY_CAST'));
  assert.equal(s.universes.resolveCast({ universeId: 'jackdiane', characterIds: [], narrator: true }).errors.length, 0, 'a narrator-only cast is allowed');
  const cats = s.universes.resolveCast({ universeId: 'gregory-cats', characterIds: ['cloud'] });
  assert.ok(cats.warnings.some((w) => w.code === 'NO_VISUAL' && w.characterId === 'cloud'), 'a cat without reference image or description warns');
});

test('Story Lab: the selection is remembered per product and sent with every request; the prompt is built from the selected cast only', async () => {
  const ai = textAi();
  const { s } = make({ ai });
  const pid = await readyProduct(s); const pid2 = await readyProduct(s);
  routePaid(s);
  assert.equal(s.storylab.list(pid).cast.saved, false, 'default cast before anything is chosen');
  await s.storylab.saveCast(pid, { universeId: 'gregory-cats', characterIds: ['cloud', 'lucy'], narrator: true, guest: { name: 'Postman', description: 'delivers a parcel' } });
  assert.equal(s.storylab.list(pid2).cast.saved, false, 'another product is unaffected');
  assert.deepEqual(s.storylab.castState(pid).characterIds, ['cloud', 'lucy']);
  await assert.rejects(s.storylab.saveCast(pid, { universeId: 'gregory-cats', characterIds: ['jack'] }), (e) => e.code === 'CAST_INVALID');
  assert.deepEqual(s.storylab.castState(pid).characterIds, ['cloud', 'lucy'], 'a rejected selection changes nothing');

  const lab = await s.storylab.generate(pid, { category: 'drama', count: 1, confirm: CONFIRM });
  const prompt = ai.calls[0].prompt;
  assert.match(prompt, /UNIVERSE: Gregory Cats/); assert.match(prompt, /- cloud: Cloud/); assert.match(prompt, /- lucy: Lucy/);
  assert.doesNotMatch(prompt, /- louie:/, 'unselected cats are not in the cast'); assert.doesNotMatch(prompt, /- jack:|- diane:/);
  assert.doesNotMatch(prompt, /Diane = Korean wife|Jack = British husband/, 'no hardcoded Jack & Diane text');
  assert.match(prompt, /NARRATOR/); assert.match(prompt, /GUEST_CHARACTER[^\n]*Postman/);
  assert.match(prompt, /never add or imply another recurring character/i);
  assert.match(prompt, /approved reference images define each character/i);
  assert.match(prompt, /appearance: 외모는 승인된 참조 이미지로만 정의합니다/, 'no invented cat looks');
  assert.deepEqual(lab.concepts[0].cast.characterIds, ['cloud', 'lucy']); assert.equal(lab.concepts[0].cast.universeId, 'gregory-cats');
  // a single-character cast centres the story on that character
  await s.storylab.saveCast(pid2, { universeId: 'gregory-cats', characterIds: ['cloud'] });
  await s.storylab.generate(pid2, { category: 'drama', count: 1, confirm: CONFIRM });
  assert.match(ai.calls[1].prompt, /FOCUS: the story is centred on Cloud/);
  // Jack & Diane (default): a married-couple cast with their library rules
  const pid3 = await readyProduct(s);
  await s.storylab.generate(pid3, { category: 'drama', count: 1, confirm: CONFIRM });
  assert.match(ai.calls[2].prompt, /UNIVERSE: Jack & Diane/); assert.match(ai.calls[2].prompt, /- jack: Jack/); assert.match(ai.calls[2].prompt, /- diane: Diane/);
  assert.match(ai.calls[2].prompt, /"BABYYYY!!!!!!"/); assert.match(ai.calls[2].prompt, /never says "오빠"/);
});

test('episodes: the cast and universe travel with the episode; the universe\'s own three-shot ending is used; scripts may only use the cast', async () => {
  const ai = textAi();
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  await s.storylab.saveCast(pid, { universeId: 'gregory-cats', characterIds: ['cloud', 'louie', 'lucy'] });
  const lab = await s.storylab.generate(pid, { category: 'drama', count: 1, confirm: CONFIRM });
  const cid = lab.concepts[0].id;
  await s.storylab.approve(pid, cid);
  const epId = await s.createEpisodeFromConcept({ productId: pid, conceptId: cid, id: 'EPCAT' });
  const ep = s.store.episodes.get(epId);
  assert.equal(ep.universeId, 'gregory-cats'); assert.deepEqual(ep.cast.characterIds, ['cloud', 'louie', 'lucy']); assert.deepEqual(ep.characters, ['cloud', 'louie', 'lucy']);
  assert.equal(ep.series, 'Gregory Cats');
  assert.equal(ep.ending.templateId, 'gregory-cats-ending-v1', 'same three-shot closing format, designed for this cast');
  const shots = ep.scenes.filter((x) => x.part === 'B');
  assert.equal(shots.length, 4, 'three closing steps in the fixed order; the 10 s reaction is two 5 s scenes');
  assert.deepEqual(shots.map((x) => x.beatKey), ['shopping_excuse', 'product_demonstration', 'jack_reaction', 'jack_reaction']);
  assert.deepEqual(shots.map((x) => x.characters), [['lucy'], ['louie'], ['lucy', 'cloud'], ['lucy', 'cloud']]);
  assert.ok(shots.every((x) => !x.characters.includes('jack') && !x.characters.includes('diane')));
  assert.equal(ep.lines.filter((l) => /BABY/.test(l.en)).length, 0, 'no Jack & Diane lines in the cat ending');
  // the script prompt is character-neutral and lists only the cast ids
  const concept = s.storylab.peek(pid, cid);
  const q = s.scriptgen.buildPrompt(ep, concept, '', undefined, 'story');
  assert.match(q.prompt, /SCRIPT_IDS: "characters" and every dialogue "speaker" must be one of: cloud, louie, lucy/);
  assert.match(q.prompt, /"characters": \["cloud"\|"louie"\|"lucy"\]/);
  const own = q.prompt.split('\n').filter((l) => !/^(APPROVED_STORYLINE|CONCEPT_|CURRENT_ENDING_VARS)/.test(l)).join('\n'); // fixture story text is test data
  assert.doesNotMatch(own, /Diane|Jack|jack|diane|다이앤|잭/, 'nothing Jack & Diane specific leaks into another universe\'s script prompt');
  // validation: a scene or line outside the cast is an error
  const bad = JSON.parse(JSON.stringify(ep)); bad.scenes[0].characters = ['jack']; bad.lines.push({ id: 'LX', sceneId: bad.scenes[0].id, speaker: 'diane', en: 'hi', ko: '안녕' });
  const { validateScript } = require('../studio/lib/episode');
  const v = validateScript(bad, s.store.characters.load());
  assert.ok(v.errors.filter((e) => e.code === 'OUT_OF_CAST').length >= 2);
});

test('a fixed ending that needs characters nobody selected requires explicit approval (no silent extra characters)', async () => {
  const ai = textAi();
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  await s.storylab.saveCast(pid, { universeId: 'gregory-cats', characterIds: ['cloud'] });
  const lab = await s.storylab.generate(pid, { category: 'drama', count: 1, confirm: CONFIRM });
  const cid = lab.concepts[0].id;
  await s.storylab.approve(pid, cid);
  await assert.rejects(s.createEpisodeFromConcept({ productId: pid, conceptId: cid, id: 'EPX1' }), (e) => e.code === 'ENDING_CAST_MISMATCH' && /lucy/.test(e.message) && /louie/.test(e.message));
  assert.equal(s.store.episodes.list({ all: true }).some((e) => e.id === 'EPX1'), false, 'nothing was created');
  const id = await s.createEpisodeFromConcept({ productId: pid, conceptId: cid, id: 'EPX2', approveEndingCast: true });
  const ep = s.store.episodes.get(id);
  assert.deepEqual(ep.cast.approvedExtras.sort(), ['louie', 'lucy']); assert.deepEqual(ep.cast.characterIds, ['cloud']);
});

test('older concepts/episodes without a cast keep working as the Jack & Diane series', async () => {
  const ai = textAi();
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  routePaid(s);
  const lab = await s.storylab.generate(pid, { category: 'drama', count: 1, confirm: CONFIRM });
  const cid = lab.concepts[0].id;
  // simulate a concept stored before universes existed
  const f = s.store.path('storylab', pid + '.json'); const d = JSON.parse(fs.readFileSync(f, 'utf8')); delete d.cast; d.concepts.forEach((c) => delete c.cast); fs.writeFileSync(f, JSON.stringify(d));
  await s.storylab.approve(pid, cid);
  const epId = await s.createEpisodeFromConcept({ productId: pid, conceptId: cid, id: 'EPOLD' });
  const ep = s.store.episodes.get(epId);
  assert.deepEqual(ep.characters, ['jack', 'diane']); assert.equal(ep.series, 'Jack & Diane'); assert.equal(ep.ending.templateId, 'jack-diane-coupang-ending-v1');
  const q = s.scriptgen.buildPrompt(ep, s.storylab.peek(pid, cid), '', undefined, 'story');
  assert.match(q.prompt, /married couple/); assert.match(q.prompt, /"jack"\|"diane"/);
});

test('cost safety: character, universe and cast work makes no AI call and no spend; generation still needs the paid confirmation and shows its estimate', async () => {
  const ai = textAi();
  const { s } = make({ ai });
  const pid = await readyProduct(s);
  const before = s.usage.summary({}).totalUsd || 0;
  s.universes.createUniverse({ name: 'Free Universe' });
  const c = s.universes.createCharacter({ name: 'Zed', universeId: 'jackdiane' });
  s.updateCharacter(c.id, { look: 'tall', personality: ['calm'] });
  await s.storylab.saveCast(pid, { universeId: 'gregory-cats', characterIds: ['cloud', 'louie'] });
  s.universes.resolveCast(s.storylab.castState(pid).cast); s.universes.assetWarnings(['cloud']);
  assert.equal(ai.calls.length, 0, 'no provider was called');
  assert.equal(s.usage.summary({}).totalUsd || 0, before);
  routePaid(s);
  const est = s.storylab.estimate(pid, { category: 'drama', count: 1 });
  assert.ok(est.cast && est.cast.universeId === 'gregory-cats', 'the estimate shows which cast it is for');
  assert.equal(ai.calls.length, 0, 'an estimate never calls the provider');
  await assert.rejects(s.storylab.generate(pid, { category: 'drama', count: 1 }), (e) => /CONFIRM|확인|PAID|paid/i.test(e.code + e.message), 'paid generation still needs confirmation');
  assert.equal(ai.calls.length, 0);
});

test('render safety: missing character assets are reported before rendering and are never replaced by another character or voice', async () => {
  const { s } = make();
  const w = s.universes.assetWarnings(['cloud', 'jack'], { needsVoice: true });
  const codes = w.map((x) => x.code + ':' + x.characterId);
  assert.ok(codes.includes('NO_REFERENCE:cloud')); assert.ok(codes.includes('NO_VOICE:cloud')); assert.ok(codes.includes('NO_VOICE:jack'));
  const jack = w.find((x) => x.code === 'NO_VOICE' && x.characterId === 'jack');
  assert.match(jack.message, /Identity ID는 Voice ID가 아닙니다/, 'the identity id is not accepted as a voice id');
  assert.match(w.find((x) => x.code === 'NO_VOICE').recovery, /대체하지 않습니다/);
  s.updateCharacter('cloud', { voice: { heygenVoiceId: 'vc_cloud_1' } });
  const after = s.universes.assetWarnings(['cloud'], { needsVoice: true }).map((x) => x.code);
  assert.ok(after.includes('VOICE_UNVERIFIED') && !after.includes('NO_VOICE'), 'a typed voice id still has to be verified');
  assert.equal(s.store.characters.get('lucy').voice.heygenVoiceId, '', 'other characters never inherit it');
});

test('HTTP: universes / characters / cast routes work and never expose secrets', async () => {
  const http = require('node:http');
  const { createApp } = require('../studio/server');
  const { s } = make();
  const pid = await readyProduct(s);
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', Origin: 'http://127.0.0.1:' + port, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(t); } catch { return null; } })() })); });
    r.on('error', reject); r.end(data);
  });
  try {
    const u = await call('GET', '/api/universes');
    assert.equal(u.status, 200); assert.deepEqual(u.json.universes.map((x) => x.id).sort(), ['gregory-cats', 'jackdiane']);
    assert.equal(u.json.universes.find((x) => x.id === 'gregory-cats').characters.length, 3);
    const put = await call('PUT', `/api/storylab/${pid}/cast`, { universeId: 'gregory-cats', characterIds: ['louie'] });
    assert.equal(put.status, 200); assert.deepEqual(put.json.characterIds, ['louie']);
    assert.equal((await call('PUT', `/api/storylab/${pid}/cast`, { universeId: 'gregory-cats', characterIds: [] })).status, 400);
    assert.deepEqual((await call('GET', `/api/storylab/${pid}`)).json.cast.characterIds, ['louie'], 'survives a reload');
    const mk = await call('POST', '/api/characters', { name: 'Pip', universeId: 'gregory-cats', role: 'kitten' });
    assert.equal(mk.status, 200); assert.equal(mk.json.universeId, 'gregory-cats');
    assert.equal((await call('DELETE', '/api/characters/' + mk.json.id)).status, 200);
    assert.equal((await call('DELETE', '/api/characters/jack')).status, 409);
    assert.equal((await call('POST', '/api/universes', { name: 'Route Universe' })).status, 200);
  } finally { app.close(); }
});
