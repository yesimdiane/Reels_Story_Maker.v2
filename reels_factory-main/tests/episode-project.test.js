'use strict';
// Episode = persistent project: compact header, hold / edit / archive / duplicate / delete with safety, story revisions, idempotent creation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const ai = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
  const m = make({ ai });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', maxDurationSec: 60, confirm: CONFIRM });
  for (const c of lab.concepts) await m.s.storylab.approve(pid, c.id);
  const cids = lab.concepts.map((c) => c.id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: cids[0] });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { pid, cids, id, ai });
}
const serve = async (s) => {
  const app = createApp(s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  return { call, close: () => new Promise((r) => app.close(r)) };
};

test('the compact header carries code, title, product, category, stage, approvals and the resume target — and no advanced metadata', async () => {
  const m = await setup();
  const hd = m.s.episodeView(m.id).derived.header;
  assert.equal(hd.code, 'UMB-01-D');
  assert.equal(hd.title, m.s.store.episodes.get(m.id).title);
  assert.match(hd.productName, /우산꽂이/); assert.equal(hd.productCode, 'UMB'); assert.equal(hd.category, 'drama');
  assert.ok(hd.stage.label && hd.stage.key !== 'done');
  assert.equal(hd.resumeStep, hd.stage.key);
  assert.equal(hd.approvals.length, 4);
  assert.equal(hd.onHold, false); assert.equal(hd.archived, false);
  assert.ok(!('uuid' in hd) && !('version' in hd) && !('createdAt' in hd), 'advanced metadata stays out of the header');
  const row = m.s.summary().episodes.find((e) => e.id === m.id);
  assert.equal(row.header.code, 'UMB-01-D');
  await approveWithScenes(m.s, m.id);
  assert.equal(m.s.episodeView(m.id).derived.header.approvals.find((a) => a.key === 'script').ok, true);
  assert.ok(m.s.episodeView(m.id).derived.header.approvedCount >= 2);
});

test('hold pauses PAID actions only; nothing is removed; resume restores; a duplicate is never on hold', async () => {
  const m = await setup();
  const h = await serve(m.s);
  try {
    await m.s.holdEpisode(m.id, '나중에');
    assert.equal(m.s.episodeView(m.id).derived.header.onHold, true);
    assert.equal(m.s.summary().episodes.find((e) => e.id === m.id).onHold, true);
    assert.equal((await h.call('POST', `/api/episodes/${m.id}/script/generate`, { confirm: CONFIRM, overwrite: true })).json.error.code, 'EPISODE_ON_HOLD');
    assert.equal((await h.call('POST', `/api/episodes/${m.id}/generation/authorize`, {})).json.error.code, 'EPISODE_ON_HOLD');
    assert.equal((await h.call('POST', `/api/episodes/${m.id}/start-images/generate`, { sceneIds: [], confirm: CONFIRM })).json.error.code, 'EPISODE_ON_HOLD');
    await assert.rejects(m.s.holdEpisode(m.id), (e) => e.code === 'ALREADY_HOLD');
    const copy = await m.s.projects.duplicateEpisode(m.id, {});
    assert.equal(m.s.store.episodes.get(copy).holdAt, undefined);
    assert.ok(m.s.store.episodes.get(m.id).lines.length > 0, 'content untouched');
    assert.equal((await h.call('POST', `/api/episodes/${m.id}/resume`)).status, 200);
    await assert.rejects(m.s.resumeEpisode(m.id), (e) => e.code === 'NOT_HOLD');
    const after = await h.call('POST', `/api/episodes/${m.id}/script/generate`, { confirm: CONFIRM, overwrite: true });
    assert.ok(!after.json.error || after.json.error.code !== 'EPISODE_ON_HOLD', 'paid actions are allowed again');
  } finally { await h.close(); }
});

test('edit changes the title only: id, uuid, product, story snapshot and approvals are untouched', async () => {
  const m = await setup();
  const keep = () => { const e = m.s.store.episodes.get(m.id); return JSON.stringify([e.id, e.uuid, e.displayId, e.productId, e.story, e.approvals, e.version]); };
  const before = keep();
  await m.s.editEpisode(m.id, { title: '새 제목' });
  assert.equal(m.s.store.episodes.get(m.id).title, '새 제목');
  assert.equal(keep(), before);
  await assert.rejects(m.s.editEpisode(m.id, { title: '   ' }), (e) => e.code === 'NEED_TITLE');
  assert.ok(m.s.store.episodes.auditLog(m.id, 50).some((a) => a.event === 'episode.edited'));
});

test('deleting an episode never removes shared assets (product images, character references, another episode\'s frames)', async () => {
  const m = await setup();
  m.s.loadDemoReferences && await m.s.loadDemoReferences();
  const other = await m.s.createEpisodeFromConcept({ productId: m.pid, conceptId: m.cids[1] });
  const prod = m.s.products.raw(m.pid);
  const imgFiles = prod.images.map((i) => m.s.products.mediaFile(m.pid, i.id));
  const charFiles = m.s.store.characters.load().characters.flatMap((c) => c.references.map((r) => m.s.store.characters.refPath(c.id, r)));
  assert.ok(imgFiles.length && charFiles.length);
  const epDir = require('node:path').dirname(m.s.store.episodes.file(m.id, 'episode.json'));
  const filesBefore = fs.readdirSync(epDir, { recursive: true }).sort();
  await m.s.trashEpisode(m.id);
  imgFiles.concat(charFiles).forEach((f) => assert.ok(fs.existsSync(f), 'shared asset kept: ' + f));
  assert.deepEqual(fs.readdirSync(epDir, { recursive: true }).sort(), filesBefore, 'even the episode\'s own files stay');
  assert.ok(m.s.store.episodes.get(other).id === other && !m.s.store.episodes.get(other).trashedAt, 'other episodes untouched');
  assert.ok(m.s.products.raw(m.pid).images.length === prod.images.length);
  assert.ok(m.s.storylab.list(m.pid).concepts.every((c) => c.status === 'approved'), 'the stories stay approved');
  const imp = m.s.episodeImpact(other);
  assert.ok(imp && imp.scripts, 'impact still works for the others');
});

test('editing an approved story creates a NEW linked revision; completed downstream work is never overwritten', async () => {
  const m = await setup();
  await approveWithScenes(m.s, m.id);
  const ep0 = m.s.store.episodes.get(m.id);
  const work = JSON.stringify([ep0.scenes, ep0.lines, ep0.cta, ep0.approvals.script]);
  await m.s.storylab.edit(m.pid, m.cids[0], { storyline: 'A new storyline with a different ending that still keeps people curious until the last second.' });
  await m.s.storylab.approve(m.pid, m.cids[0]);
  const ep1 = m.s.store.episodes.get(m.id);
  assert.equal(JSON.stringify([ep1.scenes, ep1.lines, ep1.cta, ep1.approvals.script]), work, 'script, scenes and the approval are untouched by the story edit');
  assert.equal(ep1.story.revision, 1, 'the episode keeps the story it was built from until the script is regenerated on purpose');
  const cs = m.s.episodeView(m.id).derived.concept;
  assert.equal(cs.regenerationRequired, true);
  await m.s.scriptgen.generate(m.id, { confirm: CONFIRM, overwrite: true });
  const ep2 = m.s.store.episodes.get(m.id);
  assert.equal(ep2.story.revision, 2); assert.equal(ep2.storyHistory.length, 1); assert.equal(ep2.storyHistory[0].revision, 1);
  assert.equal(ep2.id, 'UMB-01-D');
  assert.ok(m.s.store.episodes.versions(m.id).length >= 2, 'the previous script stays in the version history');
});

test('episode creation on story approval is idempotent: parallel identical requests make ONE episode; unapproved/held stories make none', async () => {
  const m = await setup();
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => m.s.createEpisodeFromConcept({ productId: m.pid, conceptId: m.cids[2], requestId: 'same-click' })));
  assert.equal(new Set(rs).size, 1);
  assert.equal(rs[0], 'UMB-02-I');
  assert.equal(m.s.store.episodes.list({ all: true }).filter((e) => e.concept && e.concept.conceptId === m.cids[2]).length, 1);
  // a different request for the same story is refused unless it is an explicit new version
  await assert.rejects(m.s.createEpisodeFromConcept({ productId: m.pid, conceptId: m.cids[2], requestId: 'other' }), (e) => e.code === 'EPISODE_EXISTS');
  await m.s.storylab.hold(m.pid, m.cids[1], 'x', 'operator', { confirmApproved: true });
  await assert.rejects(m.s.createEpisodeFromConcept({ productId: m.pid, conceptId: m.cids[1] }), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  assert.equal(m.s.store.episodes.list({ all: true }).filter((e) => e.id.startsWith('UMB-')).length, 2, 'no stray episode was created');
});

test('migration: an old episode (no story snapshot, no hold fields) still gets a valid header', async () => {
  const m = make();
  const demo = m.s.store.episodes.list()[0];
  const hd = m.s.episodeView(demo.id).derived.header;
  assert.equal(hd.code, demo.id);
  assert.equal(hd.onHold, false);
  assert.ok(hd.stage && hd.approvals.length === 4);
});
