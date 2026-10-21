'use strict';
// Scenes always carry who is in them and where they are: the script step fills cast + look, an empty cast is never sent to the image model silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const sceneLook = require('../studio/lib/scenelook');
const SF = require('../studio/lib/scriptformula');
const { CONFIRM, setupEpisode } = require('./helpers/product-analysis-fixtures');
const { approveWithScenes } = require('./helpers/approve');

const IDS = new Set(['jack', 'diane']);
const NAMES = { jack: ['Jack'], diane: ['Diane', '다이앤'] };

test('inferCast: listed characters + speakers; names in the text only when nobody is listed; exclusions do not count; unknown ids ignored', () => {
  assert.deepEqual(sceneLook.inferCast({ characters: ['diane'], speakers: ['jack'] }, IDS, NAMES), ['diane', 'jack']);
  assert.deepEqual(sceneLook.inferCast({ characters: ['nobody'], speakers: ['jack', 'ghost'] }, IDS, NAMES), ['jack']);
  assert.deepEqual(sceneLook.inferCast({ text: 'Diane points at the drain. Jack stares.' }, IDS, NAMES).sort(), ['diane', 'jack']);
  assert.deepEqual(sceneLook.inferCast({ text: 'Close-up of the drain without Diane in the frame.' }, IDS, NAMES), [], 'an exclusion is not a mention');
  assert.deepEqual(sceneLook.inferCast({ text: '다이앤이 소리친다' }, IDS, NAMES), ['diane'], 'Korean display names count');
  assert.deepEqual(sceneLook.inferCast({}, IDS, NAMES), []);
});

test('normalizeBeat: the AI forgot "characters" but people speak → the cast is filled; look (place / lighting / mood) is kept, empty stays empty', () => {
  const beat = (scene) => ({ title_ko: '샤워 배수구', story_en: 'x', visual: 'y', scenes: [Object.assign({ title_ko: '배수구 앞', durationSec: 4, visual: '0.0–4.0 s: bathroom', action: 'points', lines: [{ speaker: 'diane', en: 'Look!', ko: '봐!' }] }, scene)] });
  const a = SF.normalizeBeat(beat({ look: { background: 'apartment bathroom in front of the sink', lighting: 'white ceiling light', atmosphere: 'flustered comic standoff' } }), 'setup', IDS, 15, NAMES);
  assert.deepEqual(a.scenes[0].characters, ['diane'], 'filled from the speaker');
  assert.deepEqual(a.scenes[0].look, { background: 'apartment bathroom in front of the sink', lighting: 'white ceiling light', atmosphere: 'flustered comic standoff' });
  const b = SF.normalizeBeat(beat({ characters: ['jack'] }), 'setup', IDS, 15, NAMES);
  assert.deepEqual(b.scenes[0].characters, ['jack', 'diane'], 'listed + speaker');
  assert.equal(b.scenes[0].look, undefined, 'no look from the AI → nothing invented');
});

test('a scene with an empty cast but speakers is refused BEFORE any paid image call; 출연 자동 채우기 fixes it; then the references are attached', async () => {
  const { s, a, id } = await setupEpisode();
  const ep = s.store.episodes.get(id);
  const sc = ep.scenes.find((x) => (x.characters || []).length && !x.showsProduct);
  await s.store.episodes.update(id, (e) => { e.scenes.find((x) => x.id === sc.id).characters = []; });
  await approveWithScenes(s, id);
  const before = a.calls.length;
  await assert.rejects(() => s.startImages.generate(id, [sc.id], { confirm: CONFIRM, force: true }), (e) => e.code === 'SCENE_CAST_EMPTY' && /출연 캐릭터가 비어/.test(e.message));
  assert.equal(a.calls.filter((c) => c.image).length - a.calls.slice(0, before).filter((c) => c.image).length, 0, 'no image call was made');
  await s.inferSceneCast(id, sc.id);
  assert.ok(s.store.episodes.get(id).scenes.find((x) => x.id === sc.id).characters.length >= 1, 'cast filled from the dialogue');
  await approveWithScenes(s, id);
  const n0 = a.calls.length;
  await s.startImages.generate(id, [sc.id], { confirm: CONFIRM, force: true });
  const call = a.calls.slice(n0).find((c) => c.image);
  assert.ok(call && (call.images || []).length >= 1, 'the character reference images ride along');
  assert.match(String(call.prompt), /CAST: Exactly/);
});

test('scene duplicate: a long title is kept whole (only the stored 60-character limit applies)', async () => {
  const { s, id } = await setupEpisode();
  const sc = s.store.episodes.get(id).scenes[0];
  const long = '하수구에서 머리카락을 꺼낸다 (반응과 놀람)';
  await s.store.episodes.update(id, (e) => { e.scenes.find((x) => x.id === sc.id).title_ko = long; });
  const r = await s.duplicateScene(id, sc.id);
  const copy = s.store.episodes.get(id).scenes.find((x) => x.id === r.newSceneId);
  assert.equal(copy.title_ko, long + ' (컷 2)');
});
