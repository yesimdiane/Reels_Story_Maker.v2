// Storyboard prompt generation: template + Gemini (mocked client), character-sheet rules, cast counts, validation.
'use strict';
const { approveWithScenes } = require('./helpers/approve');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { SHEET_RULE, castDirective, lintCast } = require('../studio/lib/charrules');

const lib = require('../studio/seed/characters.json');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-pg-'));
const PNG_A = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082', 'hex');
const sheetBytes = { jack: Buffer.concat([PNG_A, Buffer.from('jack-sheet')]), diane: Buffer.concat([PNG_A, Buffer.from('diane-sheet')]) };

function make({ gemini = null, env = {} } = {}) {
  const cfg = loadConfig({ RF_STUDIO_DIR: tmp(), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1', ...env }, { dotenvFile: '/nonexistent' });
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }), geminiFactory: gemini });
  return { cfg, s };
}
function addSheets(s, ids = ['jack', 'diane']) {
  for (const id of ids) {
    s.store.characters.addReference(id, { buffer: sheetBytes[id], filename: id + '-sheet.png', mime: 'image/png', label: id + ' master sheet' });
    const ref = s.store.characters.get(id).references.slice(-1)[0];
    s.store.characters.setReferenceApproved(id, ref.id, true);
  }
}
const fakeClient = (answer, seen = []) => () => ({ model: 'fake-gemini', async generateJson(req) { seen.push(req); return typeof answer === 'function' ? answer(req) : answer; } });
const goodScene = (id, extra = {}) => ({ scene_id: id, camera: 'Slow push-in at eye level', actions: 'Jack walks past the umbrella rack and shakes his head.', environment: 'Seoul street, grey sky', lighting: 'Soft overcast light, muted beige palette', continuity: 'Opening scene', negative_additions: 'lens flare', ...extra });

test('cast directive: exactly one / exactly two / none', () => {
  assert.match(castDirective(['jack'], lib), /Exactly ONE person.*Jack/);
  assert.match(castDirective(['diane', 'jack'], lib), /Exactly TWO people: one Diane and one Jack/);
  assert.match(castDirective([], lib), /Do NOT introduce Diane or Jack/);
});

test('approving the script builds prompts for every scene — the Storyboard is never empty', async () => {
  const { s } = make();
  assert.ok(s.episodeView('EP01').scenes.every((x) => !x.prompt), 'seed has no prompts yet');
  await approveWithScenes(s, 'EP01');
  const ep = s.episodeView('EP01');
  assert.ok(ep.scenes.every((x) => x.prompt && x.prompt.video.length > 200 && x.prompt.negative), 'all scenes have prompts');
  const s1 = ep.scenes[0].prompt.video;
  assert.match(s1, /CAST: Exactly ONE person.*Jack/);
  assert.ok(!/Exactly TWO/.test(s1));
  assert.match(s1, /CAMERA:/);
  assert.match(s1, /CHARACTER ACTIONS:/);
  assert.match(s1, /ENVIRONMENT:/);
  assert.match(s1, /LIGHTING & STYLE:/);
  assert.match(s1, /CONTINUITY:/);
  assert.match(s1, /DURATION & FORMAT: 5 seconds, Vertical 9:16/);
  assert.match(ep.scenes[6].prompt.video, /Exactly TWO people: one Jack and one Diane|Exactly TWO people: one Diane and one Jack/);
});

test('the mandatory character-sheet rule is appended by code whenever a sheet is used (and only then)', async () => {
  const { s } = make();
  await approveWithScenes(s, 'EP01');
  assert.ok(!s.episodeView('EP01').scenes[0].prompt.video.includes(SHEET_RULE), 'no approved sheet → no sheet rule');
  addSheets(s);
  await s.rebuildPrompts('EP01', undefined, { force: true });
  const ep = s.episodeView('EP01');
  ep.scenes.forEach((sc) => assert.equal(sc.prompt.video.includes(SHEET_RULE), sc.characters.length > 0, sc.id));
  assert.match(SHEET_RULE, /^IMPORTANT CHARACTER REFERENCE RULE: The provided character sheet contains multiple depictions of the SAME individual for identity reference only\. Generate exactly one instance/);
  assert.match(ep.scenes[0].prompt.negative, /collage|character sheet/);
});

test('Gemini: needs explicit confirmation and sends the real image bytes of ONLY the selected characters\' approved sheets', async () => {
  const seen = [];
  const { s } = make({ gemini: fakeClient((req) => ({ scenes: [goodScene('S1')] }), seen) });
  await approveWithScenes(s, 'EP01');
  addSheets(s);
  await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', force: true }), (e) => e.code === 'CONFIRM_REQUIRED');
  assert.equal(seen.length, 0, 'no call without confirmation');
  const v = await s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true });
  assert.equal(seen.length, 1);
  const req = seen[0];
  assert.equal(req.images.length, 1, 'S1 has only Jack selected → only Jack\'s sheet is sent');
  assert.equal(req.images[0].data, sheetBytes.jack.toString('base64'), 'actual image content (base64), not a filename/URL');
  assert.equal(req.images[0].mimeType, 'image/png');
  assert.ok(!JSON.stringify(req.images).includes(sheetBytes.diane.toString('base64')));
  assert.match(req.prompt, /NEVER interpret multiple drawings on a sheet as several people/);
  assert.match(req.prompt, /Characters selected in the editor: Jack/);
  const p = v.scenes[0].prompt;
  assert.equal(p.source, 'gemini');
  assert.ok(p.video.includes('Slow push-in at eye level'));
  assert.ok(p.video.includes(SHEET_RULE), 'rule added by code even though the model never wrote it');
  assert.match(p.video, /CAST: Exactly ONE person/);
  assert.match(p.negative, /lens flare/);
  assert.deepEqual(p.ai.imageShas.length, 1);
});

test('Gemini: both characters → both sheets once each; scene with nobody → no images and no characters', async () => {
  const seen = [];
  const { s } = make({ gemini: fakeClient((req) => ({ scenes: [goodScene('S7', { actions: 'Diane points at the holder; Jack looks on.' })] }), seen) });
  await approveWithScenes(s, 'EP01');
  addSheets(s);
  await s.rebuildPrompts('EP01', ['S7'], { mode: 'gemini', confirmAi: true, force: true });
  assert.equal(seen[0].images.length, 2);
  // a scene with no characters selected
  await s.saveScript('EP01', { scenes: s.episodeView('EP01').scenes.map((x) => ({ id: x.id, characters: x.id === 'S3' ? [] : x.characters })) });
  await approveWithScenes(s, 'EP01');
  const p = s.episodeView('EP01').scenes.find((x) => x.id === 'S3').prompt;
  assert.ok(!p.stale, 'untouched template prompt is rebuilt automatically when the cast changes');
  assert.match(p.video, /Do NOT introduce Diane or Jack/);
  assert.ok(!p.video.includes(SHEET_RULE));
  assert.match(p.negative, /Diane, Jack/);
});

test('Gemini output that breaks the rules is rejected and nothing is saved', async () => {
  const bad = [
    [goodScene('S1', { actions: 'Two Jack stand side by side in the street.' }), 'AI_CAST_VIOLATION'],
    [goodScene('S1', { actions: 'Jack and Diane argue under the umbrella rack.' }), 'AI_CAST_VIOLATION'],
    [goodScene('S1', { environment: 'The character sheet with all expressions fills the frame as a collage.' }), 'AI_REFERENCE_SHEET_VIOLATION'],
    [goodScene('S1', { actions: 'The holder is waterproof and opens automatically.' }), 'AI_PRODUCT_CLAIM_VIOLATION'],
    [{ scene_id: 'S1', camera: '', actions: '', environment: '', lighting: '', continuity: '' }, 'AI_RESPONSE_INCOMPLETE'],
  ];
  for (const [b, category] of bad) {
    const { s } = make({ gemini: fakeClient({ scenes: [b] }) });
    await approveWithScenes(s, 'EP01');
    addSheets(s);
    await s.rebuildPrompts('EP01', undefined, { force: true });
    const before = s.episodeView('EP01').scenes[0].prompt.video;
    await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true }), (e) => e.code === category && e.details[0].code === category && !!e.correlationId, JSON.stringify(b));
    assert.equal(s.episodeView('EP01').scenes[0].prompt.video, before, 'existing prompt untouched');
  }
});

test('Gemini: refuses to guess characters without an approved reference; failures keep old prompts', async () => {
  let called = 0;
  const { s } = make({ gemini: () => ({ model: 'm', async generateJson() { called++; throw new Error('HTTP 500 boom'); } }) });
  await approveWithScenes(s, 'EP01');
  await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true }), (e) => e.code === 'NO_APPROVED_REFERENCE');
  assert.equal(called, 0);
  addSheets(s);
  const before = s.episodeView('EP01').scenes[0].prompt.video;
  await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true }), (e) => e.code === 'GEMINI_FAILED');
  assert.equal(s.episodeView('EP01').scenes[0].prompt.video, before);
});

test('no Gemini key and no factory: AI mode is unavailable but templates keep working', async () => {
  const { s } = make();
  await approveWithScenes(s, 'EP01');
  assert.equal(s.providerStatus().gemini.configured, false);
  addSheets(s);
  await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true }), (e) => /GEMINI_API_KEY/.test(e.message) || e.code === 'GEMINI_FAILED');
});

test('edited prompts are preserved unless forced; history is kept', async () => {
  const { s } = make({ gemini: fakeClient({ scenes: [goodScene('S1')] }) });
  await approveWithScenes(s, 'EP01');
  addSheets(s);
  await s.savePrompt('EP01', 'S1', { video: 'My own S1 prompt. Jack runs.', negative: 'nothing' });
  assert.equal(s.episodeView('EP01').scenes[0].prompt.edited, true);
  await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true }), (e) => e.code === 'NOTHING_TO_DO');
  await s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true });
  const p = s.episodeView('EP01').scenes[0].prompt;
  assert.equal(p.edited, false);
  assert.ok(p.history.some((h) => h.video.startsWith('My own S1 prompt')));
});

test('saving an edited prompt keeps the sheet rule, rejects duplicate characters, flags unselected ones', async () => {
  const { s } = make();
  await approveWithScenes(s, 'EP01');
  addSheets(s);
  await s.rebuildPrompts('EP01', undefined, { force: true });
  await s.savePrompt('EP01', 'S1', { video: 'Jack walks by the rack, slowly.', negative: 'x' });
  assert.ok(s.episodeView('EP01').scenes[0].prompt.video.includes(SHEET_RULE), 'rule re-appended after the operator deleted it');
  await assert.rejects(s.savePrompt('EP01', 'S1', { video: 'two Jack in the hallway', negative: '' }), (e) => e.code === 'CAST_RULE');
  await s.savePrompt('EP01', 'S1', { video: 'Jack walks while Diane waves from the door.', negative: '' });
  assert.ok(s.episodeView('EP01').scenes[0].castWarnings.some((w) => w.code === 'UNSELECTED_CHARACTER'));
});

test('lintCast ignores the negations in the rule text itself', () => {
  const sc = { characters: ['jack'] };
  assert.deepEqual(lintCast('CAST: x\n' + SHEET_RULE + '\nJack walks.', sc, lib), []);
});

test('a multi-illustration sheet can never be the i2v start frame; "single illustration" or an uploaded frame can', async () => {
  const { s } = make();
  await approveWithScenes(s, 'EP01');
  addSheets(s);
  await s.approveStoryboard('EP01');
  let est = s.gen.estimate('EP01', { sceneIds: ['S1'] });
  assert.ok(est.blockers.some((b) => b.code === 'SHEET_AS_START_FRAME'), JSON.stringify(est.blockers));
  const ref = s.store.characters.get('jack').references[0];
  s.store.characters.setReferenceKind('jack', ref.id, false);
  est = s.gen.estimate('EP01', { sceneIds: ['S1'] });
  assert.ok(!est.blockers.some((b) => b.code === 'SHEET_AS_START_FRAME'));
});

test('changing a scene\'s cast rebuilds untouched template prompts and flags edited/AI ones as stale', async () => {
  const { s } = make();
  await approveWithScenes(s, 'EP01');
  await s.savePrompt('EP01', 'S2', { video: 'My S2. Jack stares at the rain.', negative: '' });
  const scenes = s.episodeView('EP01').scenes.map((x) => ({ id: x.id, characters: x.id === 'S2' || x.id === 'S3' ? ['jack', 'diane'] : x.characters }));
  await s.saveScript('EP01', { scenes });
  const ep = s.episodeView('EP01');
  assert.match(ep.scenes[2].prompt.video, /Exactly TWO people/);
  assert.equal(ep.scenes[1].prompt.stale, true);
  assert.ok(ep.scenes[1].castWarnings !== undefined);
});
