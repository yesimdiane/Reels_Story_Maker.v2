'use strict';
// Episode IDs: {PRODUCT_CODE}-{NN}-{D|V|I}. Numbering, atomic allocation (in-process and across processes), retries, deletion, revisions, migration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { make, fakeAi, conceptsForPrompt, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const ai = () => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : conceptsForPrompt(req), usage: { inputTokens: 5, outputTokens: 5 } }) });
/** A studio with a ready product (code UMB) and three approved concepts: [0] Drama, [1] Viral, [2] Informational. */
async function setup() {
  const m = make({ ai: ai() });
  const pid = await readyProduct(m.s); routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  for (const c of lab.concepts) await m.s.storylab.approve(pid, c.id);
  return Object.assign(m, { pid, cids: lab.concepts.map((c) => c.id), cats: lab.concepts.map((c) => c.category) });
}
const create = (m, i, extra = {}) => m.s.createEpisodeFromConcept(Object.assign({ productId: m.pid, conceptId: m.cids[i] }, extra));

test('product code: unique, validated, persistent (locked by the first episode); the suggestion is never applied silently', async () => {
  const m = make({ ai: ai() });
  const a = await m.s.products.create({ name: '우산꽂이', category: 'magnetic door-mounted umbrella holder' });
  assert.equal(a.code, '', 'no code is invented');
  assert.equal(a.suggestedCode, 'UMB');
  for (const bad of ['u', 'umbrella1', '1AB', 'AB CD', 'A_B']) await assert.rejects(m.s.products.edit(a.id, { code: bad }), (e) => e.code === 'BAD_PRODUCT_CODE', bad);
  assert.equal((await m.s.products.edit(a.id, { code: 'umb' })).code, 'UMB', 'normalised to upper case');
  const b = await m.s.products.create({ name: '다른 제품' });
  await assert.rejects(m.s.products.edit(b.id, { code: 'UMB' }), (e) => e.code === 'PRODUCT_CODE_TAKEN');
  await assert.rejects(m.s.products.create({ name: 'x', code: 'UMB' }), (e) => e.code === 'PRODUCT_CODE_TAKEN');
  assert.equal(m.s.products.get(b.id).suggestedCode, 'PRD');
  assert.equal((await m.s.products.edit(a.id, { code: 'UMX' })).code, 'UMX', 'still editable before the first episode');
  assert.equal(m.s.products.get(a.id).codeLocked, false);
});

test('numbering: per product, sequential from 01, whatever the category; code locks after the first episode', async () => {
  const m = await setup();
  assert.deepEqual(m.cats, ['drama', 'viral', 'info']);
  const ids = [await create(m, 0), await create(m, 1), await create(m, 2)];
  assert.deepEqual(ids, ['UMB-01-D', 'UMB-02-V', 'UMB-03-I']);
  const eps = ids.map((id) => m.s.store.episodes.get(id));
  assert.deepEqual(eps.map((e) => e.episodeNumber), [1, 2, 3]);
  assert.deepEqual(eps.map((e) => e.category), ['drama', 'viral', 'info']);
  assert.ok(eps.every((e) => e.productCode === 'UMB' && e.displayId === e.id && e.idScheme === 'v2'));
  assert.equal(new Set(eps.map((e) => e.uuid)).size, 3, 'each episode has its own immutable uuid');
  assert.ok(eps.every((e) => /^[0-9a-f-]{36}$/.test(e.uuid)));
  await assert.rejects(m.s.products.edit(m.pid, { code: 'NEW' }), (e) => e.code === 'PRODUCT_CODE_LOCKED');
  // a second product has its own counter
  const pid2 = await readyProduct(m.s);
  const lab2 = await m.s.storylab.generate(pid2, { category: 'viral', confirm: CONFIRM });
  await m.s.storylab.approve(pid2, lab2.concepts[0].id);
  assert.equal(await m.s.createEpisodeFromConcept({ productId: pid2, conceptId: lab2.concepts[0].id }), 'UMC-01-V');
  assert.match(m.s.summary().episodes.find((e) => e.id === 'UMB-02-V').displayId, /^UMB-02-V$/);
});

test('a number is allocated only when the episode is really created (failures burn nothing)', async () => {
  const m = await setup();
  await assert.rejects(m.s.createEpisodeFromConcept({ productId: m.pid, conceptId: 'nope' }), (e) => e.status === 404);
  await m.s.storylab.revoke(m.pid, m.cids[1]);
  await assert.rejects(create(m, 1), (e) => e.code === 'CONCEPT_NOT_APPROVED');
  assert.equal(await create(m, 0), 'UMB-01-D');
  await assert.rejects(create(m, 0), (e) => e.code === 'EPISODE_EXISTS');
  const noCode = make({ ai: ai() });
  const p = await noCode.s.products.create({ name: '코드 없음', features: ['자석으로 부착 가능'] });
  await noCode.s.products.upload(p.id, require('./helpers/v23').png(1), 'a.png');
  await noCode.s.products.setStatus(p.id, noCode.s.products.get(p.id).images[0].id, 'approved');
  await noCode.s.products.approveReferenceSet(p.id, {});
  routePaid(noCode.s);
  const lab = await noCode.s.storylab.generate(p.id, { category: 'drama', confirm: CONFIRM });
  await noCode.s.storylab.approve(p.id, lab.concepts[0].id);
  await assert.rejects(noCode.s.createEpisodeFromConcept({ productId: p.id, conceptId: lab.concepts[0].id }), (e) => e.code === 'PRODUCT_CODE_REQUIRED' && e.status === 422);
  await noCode.s.products.edit(p.id, { code: 'COD' });
  assert.equal(await noCode.s.createEpisodeFromConcept({ productId: p.id, conceptId: lab.concepts[0].id }), 'COD-01-D', 'the failed attempts did not use number 01');
  await m.s.storylab.approve(m.pid, m.cids[1]);
  assert.equal(await create(m, 1), 'UMB-02-V', 'the refused attempts did not use number 02');
});

test('concurrent approvals: unique, gap-free numbers; a double click creates one episode; a retry with the same requestId returns it', async () => {
  const m = await setup();
  const r = await Promise.allSettled([create(m, 0), create(m, 1), create(m, 2), create(m, 0), create(m, 1)]);
  const ok = r.filter((x) => x.status === 'fulfilled').map((x) => x.value).sort();
  assert.deepEqual(ok, ['UMB-01-D', 'UMB-02-V', 'UMB-03-I'].sort().map((x) => x), 'three distinct concepts → three numbers (order may vary by category letter)');
  assert.equal(new Set(ok.map((id) => id.split('-')[1])).size, 3, 'numbers are unique');
  assert.deepEqual(ok.map((id) => Number(id.split('-')[1])).sort(), [1, 2, 3], 'and gap-free');
  assert.equal(r.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'EPISODE_EXISTS'), true, 'the duplicate clicks were refused, not numbered');
  // idempotent retry: same requestId → same episode, no new number (even with newVersion)
  const again = await Promise.all([create(m, 0, { newVersion: true, requestId: 'req-1' }), create(m, 0, { newVersion: true, requestId: 'req-1' })]);
  assert.equal(again[0], again[1]);
  assert.equal(again[0], 'UMB-04-D');
  assert.equal(await create(m, 0, { newVersion: true, requestId: 'req-1' }), 'UMB-04-D');
  assert.equal(await create(m, 0, { newVersion: true, requestId: 'req-2' }), 'UMB-05-D', 'a different request is a new episode');
  assert.equal(m.s.store.episodes.get('UMB-04-D').concept.versionOf, 'UMB-01-D');
});

test('concurrent processes (file lock): no duplicate numbers across separate Node processes', async () => {
  const m = await setup();
  const dir = m.cfg.studioDir;
  const worker = path.join(m.cfg.studioDir, 'alloc-worker.js');
  fs.writeFileSync(worker, `
    const { loadConfig } = require(${JSON.stringify(path.join(__dirname, '..', 'renderer', 'lib', 'config'))});
    const { createStudio } = require(${JSON.stringify(path.join(__dirname, '..', 'studio', 'lib', 'studio'))});
    const { createMockVideoProvider } = require(${JSON.stringify(path.join(__dirname, '..', 'studio', 'lib', 'providers', 'mock'))});
    const cfg = loadConfig({ RF_STUDIO_DIR: ${JSON.stringify(dir)}, RF_MASTER_KEY: 'test-master-key-for-unit-tests', RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
    const s = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
    const out = [];
    for (let i = 0; i < 6; i++) out.push(s.episodeIds.createEpisode({ productId: ${JSON.stringify(m.pid)}, category: 'drama', buildSeed: ({ id }) => ({ id, title: 'w', productId: ${JSON.stringify(m.pid)}, product: { name: 'x' }, scenes: [], lines: [] }) }).id);
    console.log(JSON.stringify(out));
  `);
  const { spawn } = require('node:child_process');
  const runs = await Promise.all([1, 2, 3].map(() => new Promise((resolve) => { const c = spawn(process.execPath, [worker]); let o = ''; let e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('close', (code) => resolve({ code, o, e })); })));
  runs.forEach((r) => assert.equal(r.code, 0, r.e));
  const all = runs.flatMap((r) => JSON.parse(r.o.trim().split('\n').pop()));
  assert.equal(all.length, 18);
  assert.equal(new Set(all).size, 18, 'no id handed out twice');
  assert.deepEqual(all.map((id) => Number(id.split('-')[1])).sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i + 1), 'numbers 01..18 exactly once');
});

test('deleted and archived episodes never give their number back (even if the files are removed by hand)', async () => {
  const m = await setup();
  const a = await create(m, 0); const b = await create(m, 1); const c = await create(m, 2);
  await m.s.trashEpisode(c);
  await m.s.archiveEpisode(b);
  assert.equal(await create(m, 0, { newVersion: true }), 'UMB-04-D', 'trashed / archived numbers stay taken');
  fs.rmSync(path.dirname(m.s.store.episodes.file('UMB-04-D', 'episode.json')), { recursive: true, force: true });
  assert.equal(await create(m, 0, { newVersion: true }), 'UMB-05-D', 'the counter file remembers a number even when its folder is gone');
  const state = JSON.parse(fs.readFileSync(m.s.store.path('episode-ids.json'), 'utf8'));
  assert.equal(state.products.UMB.last, 5);
  assert.deepEqual(state.products.UMB.allocations.map((x) => x.number), [1, 2, 3, 4, 5]);
  void a;
});

test('revisions keep the same Episode ID; category and product-name edits never change it', async () => {
  const m = await setup();
  const id = await create(m, 0);
  const keep = () => { const e = m.s.store.episodes.get(id); return JSON.stringify([e.id, e.uuid, e.displayId, e.productCode, e.episodeNumber]); };
  const before = keep();
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM, overwrite: true });
  await m.s.restoreVersion(id, 1);
  await m.s.storylab.edit(m.pid, m.cids[0], { payoff: '완전히 다른 결말' });
  await m.s.storylab.approve(m.pid, m.cids[0]);
  await m.s.scriptgen.generate(id, { confirm: CONFIRM, overwrite: true });
  assert.equal(keep(), before, 'script rewrites, version restores and concept re-approval keep id / uuid / number');
  assert.deepEqual(m.s.store.episodes.list().map((e) => e.id).filter((x) => x.startsWith('UMB-')), ['UMB-01-D'], 'no new episode appeared');
  await m.s.setEpisodeCategory(id, 'viral');
  const e = m.s.store.episodes.get(id);
  assert.equal(e.category, 'viral'); assert.equal(e.id, 'UMB-01-D'); assert.equal(e.categoryHistory[0].from, 'drama');
  await m.s.products.edit(m.pid, { name: '완전히 새 이름', category: 'something else' });
  assert.equal(keep(), before);
  await assert.rejects(m.s.setEpisodeCategory(id, 'comedy'), (er) => er.code === 'INVALID_CATEGORY');
  assert.equal(m.s.episodeView(id).displayId || m.s.store.episodes.get(id).displayId, 'UMB-01-D');
});

test('duplicating an episode creates a NEW episode with the next number and the same category', async () => {
  const m = await setup();
  const id = await create(m, 1);
  await create(m, 0);
  const copy = await m.s.projects.duplicateEpisode(id, {});
  assert.equal(copy, 'UMB-03-V');
  const c = m.s.store.episodes.get(copy);
  assert.notEqual(c.uuid, m.s.store.episodes.get(id).uuid);
  assert.equal(c.duplicatedFrom.episodeId, id);
  assert.equal(m.s.store.episodes.get(id).id, 'UMB-01-V');
});

test('migration keeps every existing identifier and link; adds an immutable uuid + display id; idempotent', async () => {
  const m = make({ ai: ai() });
  const demo = m.s.store.episodes.list()[0];
  assert.ok(demo, 'the demo episode exists');
  const ep = m.s.store.episodes.get(demo.id);
  assert.equal(ep.displayId, demo.id, 'legacy ids are displayed as they are');
  assert.equal(ep.idScheme, 'legacy');
  assert.match(ep.uuid, /^[0-9a-f-]{36}$/);
  // an older episode without the new fields (as written by a previous version)
  const f = m.s.store.episodes.file(demo.id, 'episode.json');
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const links = JSON.stringify([raw.id, raw.reelId, raw.productId, raw.concept || null]);
  delete raw.uuid; delete raw.displayId; delete raw.idScheme;
  fs.writeFileSync(f, JSON.stringify(raw));
  const done = m.s.episodeIds.migrate();
  assert.deepEqual(done, [demo.id]);
  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(after.id, demo.id);
  assert.equal(JSON.stringify([after.id, after.reelId, after.productId, after.concept || null]), links, 'ids and links untouched');
  assert.ok(after.uuid && after.displayId === demo.id);
  assert.deepEqual(m.s.episodeIds.migrate(), [], 'second run changes nothing');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).uuid, after.uuid, 'the uuid never changes');
});

test('export filenames start with the Episode ID', async () => {
  const m = await setup();
  const id = await create(m, 2);
  assert.equal(m.s.exportName(id, '/data/episodes/x/renders/final_v1.mp4'), 'UMB-01-I_final_v1.mp4');
  assert.equal(m.s.exportName('EP01', '/x/final_v2.mp4'), 'EP01_final_v2.mp4');
});
