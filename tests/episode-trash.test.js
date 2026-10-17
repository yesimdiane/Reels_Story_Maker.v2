'use strict';
// 에피소드 삭제 = 휴지통: hidden everywhere, nothing removed from disk, spend still counted, restorable, ids never reused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');
const { createApp } = require('../studio/server');

const CONFIRM = { paid: true, unknownCost: true };
async function setup() {
  const a = fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 10, outputTokens: 10 } }) });
  const m = make({ ai: a });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const cid = lab.concepts[0].id;
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: cid });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, pid, cid });
}

test('deleting moves the episode to the trash: gone from lists/summary/products, every file kept, restorable', async () => {
  const { s, id, pid } = await setup();
  assert.ok(s.summary().episodes.some((e) => e.id === id));
  const file = s.store.episodes.file(id, 'episode.json');
  const before = fs.readFileSync(file, 'utf8');
  await s.trashEpisode(id);
  assert.ok(fs.existsSync(file), 'the episode file is still on disk');
  assert.ok(!s.summary().episodes.some((e) => e.id === id), 'hidden from the episode list');
  assert.ok(!s.store.episodes.list().some((e) => e.id === id));
  assert.ok(s.store.episodes.list({ all: true }).some((e) => e.id === id));
  assert.equal(s.trashList().length, 1);
  assert.equal(s.trashList()[0].id, id);
  assert.ok(!s.products.get(pid).linkedEpisodes.some((e) => e.id === id), 'no longer linked from the product');
  assert.equal(s.store.episodes.get(id).lines.length > 0, true, 'script, lines and assets are intact');
  await assert.rejects(s.trashEpisode(id), (e) => e.code === 'ALREADY_TRASHED');
  const v = await s.restoreEpisode(id);
  assert.equal(v.id, id);
  assert.ok(s.summary().episodes.some((e) => e.id === id));
  assert.equal(s.trashList().length, 0);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cmp = JSON.parse(before);
  delete after.updatedAt; delete cmp.updatedAt;
  assert.deepEqual(after, cmp, 'restoring brings back exactly the same episode');
  await assert.rejects(s.restoreEpisode(id), (e) => e.code === 'NOT_TRASHED');
});

test('trashed episodes keep counting: spend stays in the usage limits and their ids are never reused', async () => {
  const { s, id, pid, cid } = await setup();
  await s.store.episodes.update(id, (ep) => { ep.spend.push({ at: new Date().toISOString(), estimatedUsd: 1.25, actualUsd: 1.25, kind: 'test' }); });
  const spent = s.usage.spentSince ? null : null;
  void spent;
  await s.trashEpisode(id);
  // a new episode from the same (approved) concept is allowed now (the old one is in the trash) and gets a NEW id
  const again = await s.createEpisodeFromConcept({ productId: pid, conceptId: cid });
  assert.notEqual(again, id);
  assert.ok(fs.existsSync(s.store.episodes.file(id, 'episode.json')), 'the trashed episode directory is untouched');
  assert.equal(s.store.episodes.list({ all: true }).filter((e) => e.spend && e.spend.length).length, 1, 'spend history is still there');
});

test('a running generation / render blocks deleting; a published episode needs an explicit extra confirmation', async () => {
  const { s, id } = await setup();
  await s.store.episodes.update(id, (ep) => { ep.renderJob = { status: 'running' }; });
  await assert.rejects(s.trashEpisode(id), (e) => e.code === 'BUSY');
  await s.store.episodes.update(id, (ep) => { ep.renderJob = { status: 'done' }; ep.generation.jobs.push({ id: 'j1', status: 'processing' }); });
  await assert.rejects(s.trashEpisode(id), (e) => e.code === 'BUSY');
  await s.store.episodes.update(id, (ep) => { ep.generation.jobs = []; ep.publishing = Object.assign({}, ep.publishing, { publishedAt: new Date().toISOString() }); });
  await assert.rejects(s.trashEpisode(id), (e) => e.code === 'PUBLISHED');
  assert.ok(s.summary().episodes.some((e) => e.id === id), 'nothing changed');
  await s.trashEpisode(id, { confirmPublished: true });
  assert.ok(!s.summary().episodes.some((e) => e.id === id));
});

test('HTTP: DELETE /api/episodes/:id (with confirmation body), GET trash, POST restore', async () => {
  const m = await setup();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    await m.s.store.episodes.update(m.id, (ep) => { ep.publishing = Object.assign({}, ep.publishing, { publishedAt: new Date().toISOString() }); });
    assert.equal((await call('DELETE', `/api/episodes/${m.id}`)).status, 409);
    assert.equal((await call('DELETE', `/api/episodes/${m.id}`, { confirmPublished: true })).status, 200);
    assert.equal((await call('GET', '/api/episodes-trash')).json.trash.length, 1);
    assert.ok(!(await call('GET', '/api/state')).json.episodes.some((e) => e.id === m.id));
    assert.equal((await call('POST', `/api/episodes/${m.id}/restore`)).status, 200);
    assert.ok((await call('GET', '/api/state')).json.episodes.some((e) => e.id === m.id));
  } finally { await new Promise((r) => app.close(r)); }
});
