'use strict';
// Script Studio consolidation (PR A): look / pose / reference-only characters / structured performance elements / B-cut planning share the
// canonical episode data; old episodes are untouched; approvals only change when a field with content changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approveWithScenes } = require('./helpers/approve');
const { png } = require('./helpers/v23');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const sceneLook = require('../studio/lib/scenelook');

const make = () => createStudio({ cfg: loadConfig({ RF_STUDIO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ssc-')) }, { dotenvFile: '/nonexistent' }) });
const ID = 'EP01';
async function approvedStoryboard(s) {
  await approveWithScenes(s, ID);
  await s.rebuildPrompts(ID);
  const ids = s.store.episodes.get(ID).scenes.map((x) => x.id);
  for (const [i, sid] of ids.entries()) { await s.uploadStartFrame(ID, sid, png(60 + i), sid + '.png'); await s.approveStartFrame(ID, sid, true); }
  await s.approveStoryboard(ID);
  return ids;
}

test('look, pose, reference-only and elements are saved on the canonical scene; old scenes have none', async () => {
  const s = make();
  const ids = await approvedStoryboard(s);
  const sc0 = s.store.episodes.get(ID).scenes.find((x) => x.id === ids[1]);
  assert.equal(sc0.look, undefined); assert.equal(sc0.referenceOnly, undefined); assert.equal(sc0.elements, undefined, 'old episodes are unchanged');
  const before = JSON.parse(JSON.stringify(s.store.episodes.get(ID).scenes));
  const sid = ids[1];
  const vis = s.store.episodes.get(ID).scenes.find((x) => x.id === sid).characters;
  const other = ['jack', 'diane'].find((c) => !vis.includes(c)) || 'diane';
  await s.saveScene(ID, sid, { scene: { look: { background: 'rainy doorway', lighting: 'warm afternoon', junk: 'x' }, pose: { body: 'left of frame', pose: 'shrugs' }, referenceOnly: [other, vis[0]], elements: [{ id: 'E1', type: 'body', text: 'Jack lifts the umbrella' }, { type: 'emotion', text: 'amused' }, { type: 'eyes', text: 'glances at the door', t0: 0.5, t1: 1 }, { type: 'bogus', text: '' }] } });
  const sc = s.store.episodes.get(ID).scenes.find((x) => x.id === sid);
  assert.deepEqual(sc.look, { background: 'rainy doorway', lighting: 'warm afternoon' }, 'unknown keys are dropped');
  assert.deepEqual(sc.pose, { body: 'left of frame', pose: 'shrugs' });
  assert.ok(!sc.referenceOnly.includes(vis[0]), 'a visible character is never also reference-only');
  assert.deepEqual(sc.characters, vis, 'visible characters unchanged');
  assert.equal(sc.elements.length, 3);
  assert.equal(sc.action, 'Jack lifts the umbrella'); assert.equal(sc.emotion, 'amused', 'legacy action/emotion mirror the elements');
  assert.deepEqual([sc.elements[2].t0, sc.elements[2].t1], [0.5, 1]);
  // other scenes are byte-identical
  const after = s.store.episodes.get(ID).scenes;
  before.forEach((b) => { if (b.id !== sid) assert.deepEqual(after.find((x) => x.id === b.id), b); });
});

test('approvals: only a scene whose look/pose/reference-only actually changed loses its storyboard approval, and the field is named', async () => {
  const s = make();
  const ids = await approvedStoryboard(s);
  assert.equal(s.episodeView(ID).derived.storyboardApproved, true);
  // empty / cosmetic saves do not invalidate
  await s.saveScene(ID, ids[0], { scene: { look: {}, pose: {}, elements: [] } });
  assert.equal(s.episodeView(ID).derived.storyboardApproved, true, 'saving empty new fields keeps the approval');
  await s.saveScene(ID, ids[2], { scene: { elements: [{ type: 'camera', text: 'slow push-in' }] } });
  assert.equal(s.episodeView(ID).derived.storyboardApproved, true, 'performance notes alone do not invalidate the storyboard');
  await s.saveScene(ID, ids[1], { scene: { look: { background: 'a brand new hallway' } } });
  const sb = s.episodeView(ID).derived.storyboardApproval;
  assert.deepEqual(sb.changedScenes, [ids[1]]);
  assert.deepEqual(sb.scenes[ids[1]].changed.map((c) => c.field), ['visual']);
  assert.equal(sb.scenes[ids[0]].approved, true);
});

test('prompt lines: environment, pose, facial details, camera; reference-only characters are named as NOT to be drawn', () => {
  const lib = { characters: [{ id: 'jack', name: 'Jack' }, { id: 'diane', name: 'Diane' }] };
  const lines = sceneLook.promptLines({ characters: ['jack'], referenceOnly: ['diane'], look: { background: 'doorway', style: 'webtoon' }, pose: { body: 'left', pose: 'shrug' }, emotion: 'amused', elements: [{ type: 'eyes', text: 'wide' }, { type: 'camera', text: 'close-up' }] }, lib);
  const text = lines.join('\n');
  assert.match(text, /ENVIRONMENT: doorway/); assert.match(text, /POSE: shrug/); assert.match(text, /EYES: wide/); assert.match(text, /CAMERA \/ SHOT: close-up/);
  assert.match(text, /Reference-only[^\n]*Diane[^\n]*do not draw/);
  assert.ok(!/Reference-only[^\n]*Jack/.test(text));
  assert.deepEqual(sceneLook.promptLines({ characters: ['jack'] }, lib), [], 'old scenes add nothing to prompts');
});

test('B-cut planning: new kinds, duplicate into a free slot, reorder, and the same record is what Storyboard develops', async () => {
  const s = make();
  const ids = await approvedStoryboard(s);
  const sid = ids[0];
  const a = await s.sba.saveBroll(ID, { sceneId: sid, kind: 'product_demo', insertAtSec: 0, durationSec: 1, note: '자석이 문에 붙는 장면' });
  const b = await s.sba.saveBroll(ID, { sceneId: sid, kind: 'environment', insertAtSec: 1, durationSec: 1, note: 'rain on the door' });
  assert.equal(a.kind, 'product_demo');
  const copy = await s.sba.duplicateBroll(ID, a.id);
  assert.ok(copy.insertAtSec >= 2 && copy.status === 'proposed' && !copy.imageRef, 'a duplicate is a new proposal in a free slot');
  assert.match(copy.note, /복제/);
  await s.sba.reorderBroll(ID, sid, [b.id, copy.id, a.id]);
  assert.deepEqual(s.store.episodes.get(ID).broll.filter((x) => x.sceneId === sid).map((x) => x.id), [b.id, copy.id, a.id]);
  await assert.rejects(s.sba.reorderBroll(ID, sid, [a.id]), (e) => e.code === 'BAD_ORDER');
  // the planning record is the asset card: same id shows up in the storyboard view
  assert.ok(s.episodeView(ID).scenes.find((x) => x.id === sid).broll.some((x) => x.id === a.id));
});

test('beat timeline is the single shared ep.motion timeline: saved from either studio, validated against the scene length', async () => {
  const s = make();
  const ids = await approvedStoryboard(s);
  const sid = ids[1];
  const ch = s.store.episodes.get(ID).scenes.find((x) => x.id === sid).characters[0];
  await s.sba.saveMotion(ID, sid, { beats: [{ characterId: ch, t0: 0, t1: 0.5, emotion: 'curious', body: 'Jack enters the frame holding an umbrella' }, { characterId: ch, t0: 0.5, t1: 1, emotion: 'curious', body: 'his right hand moves toward the door' }], source: 'manual' });
  assert.equal(s.store.episodes.get(ID).motion[sid].beats.length, 2);
  assert.equal(s.episodeView(ID).scenes.find((x) => x.id === sid).motion.beats[1].body, 'his right hand moves toward the door');
  const dur = s.store.episodes.get(ID).scenes.find((x) => x.id === sid).durationSec;
  await assert.rejects(s.sba.saveMotion(ID, sid, { beats: [{ characterId: ch, t0: dur, t1: dur + 1, emotion: 'x', body: 'too late' }], source: 'manual' }));
  assert.equal(s.store.episodes.get(ID).motion[sid].beats.length, 2, 'a rejected save changes nothing');
});
