'use strict';
// Episode / script-version management: 삭제 (soft, restorable), 대본 버전 삭제, 복제, 보관 — and that nothing linked is lost.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { approveWithScenes } = require('./helpers/approve');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid, conceptsForPrompt } = require('./helpers/v23');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const a = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 10, outputTokens: 10 } }) });
  const m = make({ ai: a });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  const cid = lab.concepts[0].id;
  await m.s.storylab.approve(pid, cid);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: cid });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM }); // v1
  return Object.assign(m, { id, pid, cid });
}
/** v1 approved (with snapshot handoff), then a regenerated draft v2 → v1 is "approved history", v2 is the live script. */
async function withApprovedHistory(m) {
  await approveWithScenes(m.s, m.id);
  await m.s.projects.handoff(m.id);
  await m.s.scriptgen.generate(m.id, { confirm: CONFIRM, overwrite: true });
}
const snapshotFiles = (m) => { const d = m.s.store.episodes.file(m.id, 'approved-scripts', 'x').replace(/x$/, ''); return fs.existsSync(d) ? fs.readdirSync(d) : []; };
const versionFiles = (m) => fs.readdirSync(m.s.store.episodes.file(m.id, 'versions', 'x').replace(/x$/, '')).sort();

test('episode impact lists the linked scripts, storyboards, images and videos; protected history is flagged', async () => {
  const m = await setup();
  let imp = m.s.episodeImpact(m.id);
  assert.equal(imp.scripts.versions >= 1, true);
  assert.deepEqual(imp.scripts.approved, []);
  assert.equal(imp.requiresApprovedConfirm, false);
  assert.ok(imp.scripts.scenes > 0 && imp.scripts.lines > 0);
  assert.ok('prompts' in imp.storyboards && 'startImages' in imp.images && 'clipVersions' in imp.videos && 'renders' in imp.videos);
  await approveWithScenes(m.s, m.id);
  imp = m.s.episodeImpact(m.id);
  assert.equal(imp.requiresApprovedConfirm, true);
  assert.ok(imp.protected.some((x) => /승인된 대본 버전/.test(x)));
});

test('deleting an episode: plain draft goes to the trash directly; approved history needs explicit confirmation; every file stays and restore is exact', async () => {
  const m = await setup();
  const { s, id } = m;
  await withApprovedHistory(m);
  const file = s.store.episodes.file(id, 'episode.json');
  const before = fs.readFileSync(file, 'utf8');
  const filesBefore = { v: versionFiles(m), a: snapshotFiles(m) };
  assert.ok(filesBefore.a.length >= 1, 'an approved-script snapshot exists');
  await assert.rejects(s.trashEpisode(id), (e) => e.code === 'APPROVED_CONTENT' && e.details.length >= 1);
  assert.ok(s.summary().episodes.some((e) => e.id === id), 'refused → still listed');
  await s.trashEpisode(id, { confirmApproved: true });
  assert.ok(!s.summary().episodes.some((e) => e.id === id));
  assert.deepEqual({ v: versionFiles(m), a: snapshotFiles(m) }, filesBefore, 'versions and approved snapshots are untouched');
  assert.equal(s.trashList().length, 1);
  await s.restoreEpisode(id);
  const after = JSON.parse(fs.readFileSync(file, 'utf8')); const cmp = JSON.parse(before);
  delete after.updatedAt; delete cmp.updatedAt;
  assert.deepEqual(after, cmp, 'restoring brings back exactly the same episode (approvals, imageDev, versions)');
  const draft = await setup();
  await draft.s.trashEpisode(draft.id); // nothing approved → no extra confirmation
  assert.equal(draft.s.trashList().length, 1);
});

test('deleting a script version hides only that version: the episode, the live script and all linked assets are untouched', async () => {
  const m = await setup();
  const { s, id } = m;
  await withApprovedHistory(m);
  const ep0 = s.store.episodes.get(id);
  assert.equal(ep0.version, 2);
  const vers = s.scriptVersions(id);
  assert.deepEqual(vers.map((v) => [v.version, v.current, v.deleted]), [[1, false, false], [2, true, false]]);
  assert.equal(vers[0].wasApproved, true);
  await assert.rejects(s.deleteScriptVersion(id, 2), (e) => e.code === 'CURRENT_VERSION', 'the live script cannot be deleted');
  await assert.rejects(s.deleteScriptVersion(id, 1), (e) => e.code === 'APPROVED_VERSION', 'approved history needs explicit confirmation');
  await assert.rejects(s.deleteScriptVersion(id, 9), (e) => e.status === 404);
  const files = versionFiles(m); const snaps = snapshotFiles(m);
  const snapshot = (e) => JSON.stringify({ scenes: e.scenes, lines: e.lines, cta: e.cta, prompts: e.prompts, clips: e.clips, voice: e.voice, renders: e.renders, imageDev: e.imageDev, approvals: e.approvals, spend: e.spend, publishing: e.publishing, title: e.title, version: e.version });
  const r = await s.deleteScriptVersion(id, 1, { confirmApproved: true });
  assert.equal(r.deleted, true);
  const ep1 = s.store.episodes.get(id);
  assert.equal(snapshot(ep1), snapshot(ep0), 'scenes, lines, prompts, clips, voice, renders, imageDev, approvals, spend are identical');
  assert.ok(!ep1.trashedAt && !ep1.archivedAt, 'the parent episode is not deleted');
  assert.ok(s.summary().episodes.some((e) => e.id === id));
  assert.deepEqual(versionFiles(m), files, 'the version file is still on disk');
  assert.deepEqual(snapshotFiles(m), snaps, 'the approved-script snapshot used by Image Development is still on disk');
  assert.equal(s.episodeView(id).derived.versions.some((v) => v.version === 1), false, 'hidden from the history list');
  assert.equal(s.scriptVersions(id)[0].deleted, true, 'but listed for recovery');
  await assert.rejects(s.deleteScriptVersion(id, 1, { confirmApproved: true }), (e) => e.code === 'ALREADY_DELETED');
  await assert.rejects(s.restoreVersion(id, 1), (e) => e.code === 'VERSION_DELETED');
  await s.undeleteScriptVersion(id, 1);
  assert.equal(s.scriptVersions(id)[0].deleted, false);
  assert.equal(s.episodeView(id).derived.versions.some((v) => v.version === 1), true);
  assert.equal(snapshot(s.store.episodes.get(id)), snapshot(ep0));
  await assert.rejects(s.undeleteScriptVersion(id, 1), (e) => e.code === 'NOT_DELETED');
  // an unapproved old version deletes without the extra confirmation
  await s.scriptgen.generate(id, { confirm: CONFIRM, overwrite: true }); // v3 (live); v2 was never approved
  await s.deleteScriptVersion(id, 2);
  assert.equal(s.scriptVersions(id).find((v) => v.version === 2).deleted, true);
});

test('archiving keeps the episode and its links, is reversible, and is not inherited by a duplicate', async () => {
  const m = await setup();
  const { s, id, pid } = m;
  await s.archiveEpisode(id);
  const row = s.summary().episodes.find((e) => e.id === id);
  assert.ok(row && row.archived === true, 'still in the data, flagged archived');
  assert.ok(s.products.get(pid).linkedEpisodes.some((e) => e.id === id), 'still linked to its product / concept');
  await assert.rejects(s.archiveEpisode(id), (e) => e.code === 'ALREADY_ARCHIVED');
  const nid = await s.projects.duplicateEpisode(id, {});
  assert.equal(s.store.episodes.get(nid).archivedAt, undefined, 'the copy is active');
  assert.equal(s.store.episodes.get(nid).duplicatedFrom.episodeId, id);
  await s.unarchiveEpisode(id);
  assert.equal(s.summary().episodes.find((e) => e.id === id).archived, false);
  await assert.rejects(s.unarchiveEpisode(id), (e) => e.code === 'NOT_ARCHIVED');
  await s.trashEpisode(id);
  await assert.rejects(s.archiveEpisode(id), (e) => e.code === 'TRASHED');
  // duplicating never touches the source's versions, assets or approvals
  assert.ok(s.store.episodes.get(id).version >= 1);
});

test('an archived episode can be deleted (trash) and restored back to archived; deleting a script in one episode never touches another', async () => {
  const a = await setup();
  const { s, id } = a;
  await withApprovedHistory(a);
  const other = await s.projects.duplicateEpisode(id, {});
  await s.scriptgen.generate(other, { confirm: CONFIRM, overwrite: true });
  const otherBefore = JSON.stringify(s.scriptVersions(other));
  await s.deleteScriptVersion(id, 1, { confirmApproved: true });
  assert.equal(JSON.stringify(s.scriptVersions(other)), otherBefore, 'the other episode is unaffected');
  await s.archiveEpisode(id);
  await s.trashEpisode(id, { confirmApproved: true });
  await s.restoreEpisode(id);
  assert.equal(s.summary().episodes.find((e) => e.id === id).archived, true, 'restoring returns it exactly as it was (archived)');
  assert.equal(s.scriptVersions(id)[0].deleted, true, 'a deleted script version stays deleted through trash / restore');
});

test('HTTP: impact, archive, script-version delete / undelete and the approved-content confirmation', async () => {
  const m = await setup();
  await withApprovedHistory(m);
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  const id = m.id;
  try {
    const imp = await call('GET', `/api/episodes/${id}/impact`);
    assert.equal(imp.status, 200); assert.equal(imp.json.requiresApprovedConfirm, true);
    assert.equal((await call('GET', `/api/episodes/${id}/script-versions`)).json.versions.length, 2);
    assert.equal((await call('DELETE', `/api/episodes/${id}/script-versions/2`, {})).status, 409);
    assert.equal((await call('DELETE', `/api/episodes/${id}/script-versions/1`, {})).status, 409);
    assert.equal((await call('DELETE', `/api/episodes/${id}/script-versions/1`, { confirmApproved: true })).status, 200);
    assert.equal((await call('POST', `/api/episodes/${id}/script-versions/1/undelete`)).status, 200);
    assert.equal((await call('POST', `/api/episodes/${id}/archive`)).status, 200);
    assert.equal((await call('POST', `/api/episodes/${id}/unarchive`)).status, 200);
    assert.equal((await call('DELETE', `/api/episodes/${id}`, {})).status, 409);
    assert.equal((await call('DELETE', `/api/episodes/${id}`, { confirmApproved: true })).status, 200);
    assert.equal((await call('POST', `/api/episodes/${id}/restore`)).status, 200);
  } finally { await new Promise((r) => app.close(r)); }
});
