'use strict';
// Gemini prompt generation: precise failure categories, sanitized diagnostics, and no false positives for exclusions.
// Everything uses a mocked Gemini client — no real or paid call is ever made.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { lintCast, isExcludedMention } = require('../studio/lib/charrules');
const { GeminiError } = require('../renderer/lib/gemini');

const lib = require('../studio/seed/characters.json');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-gv-'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082', 'hex');
function make(client) {
  const cfg = loadConfig({ RF_STUDIO_DIR: tmp(), RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
  const seen = [];
  const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }), geminiFactory: () => ({ model: 'fake-gemini', async generateJson(req) { seen.push(req); return typeof client === 'function' ? client(req) : client; } }) });
  return { cfg, s, seen };
}
function addSheets(s) { ['jack', 'diane'].forEach((id) => { s.store.characters.addReference(id, { buffer: Buffer.concat([PNG, Buffer.from(id)]), filename: id + '.png', mime: 'image/png' }); const r = s.store.characters.get(id).references.slice(-1)[0]; s.store.characters.setReferenceApproved(id, r.id, true); }); }
const scene = (extra = {}) => ({ scene_id: 'S1', camera: 'Slow push-in at eye level', actions: 'Jack walks past the umbrella rack and shakes his head.', environment: 'Seoul street, grey sky', lighting: 'Soft overcast light, muted beige palette', continuity: 'Opening scene', negative_additions: 'lens flare', ...extra });
async function ready(client) { const m = make(client); await approveWithScenes(m.s, 'EP01'); addSheets(m.s); await m.s.rebuildPrompts('EP01', undefined, { force: true }); return m; }
const gen = (s, opts = {}) => s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true, ...opts });
const promptOf = (s) => s.episodeView('EP01').scenes[0].prompt;

test('a complete valid structured response is saved as a Gemini prompt (and leaves no failure record)', async () => {
  const { s } = await ready({ scenes: [scene()] });
  await gen(s);
  assert.equal(promptOf(s).source, 'gemini');
  assert.deepEqual(s.aiDiagnostics.recent(), []);
});

test('missing required field → AI_RESPONSE_INCOMPLETE naming the fields; not described as a rule violation; sanitized diagnostics recorded', async () => {
  const { s, seen } = await ready({ scenes: [scene({ lighting: undefined, continuity: '   ', negative_additions: 'AIzaSyA1234567890abcdefghijklmnopqrstuv' })] });
  const before = promptOf(s).video;
  await assert.rejects(gen(s), (e) => {
    assert.equal(e.code, 'AI_RESPONSE_INCOMPLETE');
    assert.match(e.message, /lighting, continuity/); assert.match(e.message, /요청 ID pg_/);
    assert.deepEqual(e.details[0].missingFields, ['lighting', 'continuity']); assert.equal(e.details[0].sceneId, 'S1');
    assert.doesNotMatch(e.recovery, /캐릭터 수, 제품 주장/); assert.match(e.recovery, /형식 문제/);
    assert.ok(e.correlationId && e.details[0].correlationId === e.correlationId);
    return true;
  });
  assert.equal(promptOf(s).video, before, 'nothing saved');
  const d = s.aiDiagnostics.recent().pop();
  assert.equal(d.category, 'AI_RESPONSE_INCOMPLETE'); assert.equal(d.sceneId, 'S1'); assert.equal(d.model, 'fake-gemini'); assert.equal(d.rule, 'required_fields');
  assert.deepEqual(d.missingFields, ['lighting', 'continuity']); assert.ok(d.at && d.correlationId.startsWith('pg_'));
  assert.deepEqual(d.responseShape.perScene.S1.empty, ['lighting', 'continuity']); assert.equal(d.responseShape.sceneCount, 1);
  assert.equal(seen.length, 1, 'one paid request, never retried automatically');
  const raw = fs.readFileSync(path.join(s.cfg.studioDir || s.store.path('.'), 'ai-diagnostics.jsonl'), 'utf8');
  assert.ok(!raw.includes('AIzaSy'), 'keys never reach the log'); assert.ok(!/base64|data:image/.test(raw));
});

test('malformed responses: no scenes array, wrong field type, unreadable/truncated JSON from the client', async () => {
  for (const [answer, re] of [[{ nope: 1 }, /scenes 배열이 없습니다/], [{ scenes: 'x' }, /scenes 배열이 없습니다/], [{ scenes: [scene({ camera: { a: 1 } })] }, /문자열이 아님\): camera/]]) {
    const { s } = await ready(answer);
    await assert.rejects(gen(s), (e) => e.code === 'AI_RESPONSE_MALFORMED' && re.test(e.message), JSON.stringify(answer));
  }
  const m = await ready(() => { throw new GeminiError('Gemini 응답을 읽을 수 없습니다: Unexpected end of JSON input', { kind: 'malformed', finishReason: 'MAX_TOKENS', truncated: true }); });
  await assert.rejects(gen(m.s), (e) => e.code === 'AI_RESPONSE_MALFORMED' && /MAX_TOKENS/.test(e.message));
  assert.equal(m.s.aiDiagnostics.recent().pop().finishReason, 'MAX_TOKENS');
  const net = await ready(() => { throw new GeminiError('Gemini API에 연결하지 못했습니다: x', { kind: 'network' }); });
  await assert.rejects(gen(net.s), (e) => e.code === 'GEMINI_FAILED', 'transport failures keep their own code');
});

test('scene ids: unexpected id → AI_SCENE_ID_MISMATCH; case/space differences are accepted; a missing scene is INCOMPLETE', async () => {
  const wrong = await ready({ scenes: [scene({ scene_id: 'S05' })] });
  await assert.rejects(gen(wrong.s), (e) => e.code === 'AI_SCENE_ID_MISMATCH' && /S05/.test(e.message) && /형식|ID/.test(e.recovery));
  const loose = await ready({ scenes: [scene({ scene_id: ' s1 ' })] });
  await gen(loose.s); assert.equal(promptOf(loose.s).source, 'gemini');
  const none = await ready({ scenes: [] });
  await assert.rejects(gen(none.s), (e) => e.code === 'AI_RESPONSE_INCOMPLETE' && /이 장면이 없습니다/.test(e.message));
});

test('cast rules: an EXCLUDED character is allowed, an included one is rejected; duplicates are rejected', async () => {
  for (const ok of ['Keep Diane outside the frame.', 'Jack walks alone, without Diane.', 'Do not show Diane in this shot.', 'Diane is not in this scene.']) {
    const { s } = await ready({ scenes: [scene({ actions: `Jack shakes his head. ${ok}` })] });
    await gen(s); assert.equal(promptOf(s).source, 'gemini', ok);
  }
  const negs = await ready({ scenes: [scene({ negative_additions: 'Diane, character sheet, collage, lens flare' })] });
  await gen(negs.s); assert.equal(promptOf(negs.s).source, 'gemini', 'everything listed in the negative additions is a prohibition');
  const incl = await ready({ scenes: [scene({ actions: 'Jack argues while Diane stands behind him holding the umbrella.' })] });
  await assert.rejects(gen(incl.s), (e) => e.code === 'AI_CAST_VIOLATION' && /Diane/.test(e.message));
  const dup = await ready({ scenes: [scene({ actions: 'Two Jack stand side by side.' })] });
  await assert.rejects(gen(dup.s), (e) => e.code === 'AI_CAST_VIOLATION');
});

test('reference sheets: an instruction to draw one is rejected; a prohibition is fine; product claims are their own category', async () => {
  const draw = await ready({ scenes: [scene({ environment: 'The character sheet with all expressions fills the frame as a collage.' })] });
  await assert.rejects(gen(draw.s), (e) => e.code === 'AI_REFERENCE_SHEET_VIOLATION' && /시트|콜라주/.test(e.message));
  const prohibit = await ready({ scenes: [scene({ environment: 'Seoul street. Do not draw a character sheet, collage or expression grid.' })] });
  await gen(prohibit.s); assert.equal(promptOf(prohibit.s).source, 'gemini');
  const claim = await ready({ scenes: [scene({ actions: 'The holder is waterproof and opens automatically.' })] });
  await assert.rejects(gen(claim.s), (e) => e.code === 'AI_PRODUCT_CLAIM_VIOLATION' && /제품 주장/.test(e.message));
});

test('edited prompts are never overwritten without explicit confirmation; no call is made when there is nothing to build', async () => {
  const { s, seen } = await ready({ scenes: [scene()] });
  await s.savePrompt('EP01', 'S1', { video: 'MY HAND-EDITED VIDEO PROMPT '.repeat(3), negative: 'mine' });
  assert.equal(promptOf(s).edited, true);
  await assert.rejects(s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true }), (e) => e.code === 'NOTHING_TO_DO');
  assert.equal(seen.length, 0, 'no paid request when only edited prompts are targeted');
  assert.match(promptOf(s).video, /MY HAND-EDITED/);
  await s.rebuildPrompts('EP01', ['S1'], { mode: 'gemini', confirmAi: true, force: true }); // the explicit confirmation
  assert.equal(promptOf(s).source, 'gemini');
  assert.ok(promptOf(s).history.some((h) => /MY HAND-EDITED/.test(h.video)), 'the edited version is kept in the history');
  // a failed paid request does not touch the saved prompt either
  const bad = await ready({ scenes: [scene({ actions: 'Diane appears next to Jack.' })] });
  const before = promptOf(bad.s).video;
  await assert.rejects(gen(bad.s), (e) => e.code === 'AI_CAST_VIOLATION');
  assert.equal(promptOf(bad.s).video, before); assert.equal(bad.seen.length, 1);
});

test('lintCast: exclusion / identity-only / prohibition vs. real violations (strict for real cast rules)', () => {
  const sc = { characters: ['jack'] };
  const flags = (t, o) => lintCast(t, sc, lib, o).map((x) => x.code);
  assert.deepEqual(flags('Keep Diane outside the frame.'), []);
  assert.deepEqual(flags('Use the Diane identity reference only.'), []);
  assert.deepEqual(flags('Diane stands behind Jack.'), ['UNSELECTED_CHARACTER']);
  assert.deepEqual(flags('Diane stands behind Jack, no umbrella.'), ['UNSELECTED_CHARACTER'], 'an unrelated "no" does not excuse showing Diane');
  assert.deepEqual(flags('Jack walks.', { negative: 'Diane, collage' }), []);
  assert.deepEqual(flags('Draw a turnaround sheet of Jack.'), ['SHEET_IN_SCENE']);
  assert.deepEqual(flags('Never show a character sheet.'), []);
  assert.equal(isExcludedMention('keep diane out of the shot', 'Diane'), true);
  assert.equal(isExcludedMention('diane holds the umbrella', 'Diane'), false);
});
