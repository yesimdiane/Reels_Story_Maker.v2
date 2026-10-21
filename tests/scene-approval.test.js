'use strict';
// Scene approval, project approval, Image Development hand-off, reusable scenes/projects and error navigation.
// All AI is faked; the tests also prove that script approval / hand-off can never start a paid generation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('../studio/lib/studio');
const { createMockVideoProvider } = require('../studio/lib/providers/mock');
const { make, fakeAi, goodConcepts, scriptResponse, isScriptPrompt, readyProduct, routePaid } = require('./helpers/v23');

const CONFIRM = { paid: true, unknownCost: true };
const ai = () => fakeAi({ '*': (req) => ({ text: '', json: isScriptPrompt(req) ? scriptResponse(req) : goodConcepts(3), usage: { inputTokens: 1000, outputTokens: 500 } }) });

async function episode({ claims, env } = {}) {
  const a = ai();
  const m = make({ ai: a, env });
  const pid = await readyProduct(m.s);
  if (claims) await m.s.products.edit(pid, { forbiddenClaims: claims });
  routePaid(m.s);
  const lab = await m.s.storylab.generate(pid, { category: 'all', confirm: CONFIRM });
  await m.s.storylab.approve(pid, lab.concepts[0].id);
  const id = await m.s.createEpisodeFromConcept({ productId: pid, conceptId: lab.concepts[0].id });
  await m.s.scriptgen.generate(id, { confirm: CONFIRM });
  return Object.assign(m, { id, pid, a });
}
const view = (s, id) => s.episodeView(id);
const scene = (s, id, sid) => view(s, id).scenes.find((x) => x.id === sid);
const edit = (s, id, fn) => { const ep = s.store.episodes.get(id); const p = { scenes: ep.scenes.map((x) => ({ ...x })), lines: ep.lines.map((x) => ({ ...x })), cta: { ...ep.cta, lines: ep.cta.lines.slice() } }; fn(p); return s.saveScript(id, p); };
const importUi = () => import('../studio/public/js/views/script-validate.js');

// ---------- 1. inline errors + navigation ----------
test('errors carry the exact field to highlight: a missing Korean subtitle points at that dialogue\'s subtitle input', async () => {
  const { s, id } = await episode();
  const target = s.store.episodes.get(id).lines[2];
  await edit(s, id, (p) => { p.lines.find((l) => l.id === target.id).ko = ''; });
  const e = view(s, id).derived.validation.errors.find((x) => x.code === 'LINE_KO');
  assert.equal(e.lineId, target.id);
  assert.equal(e.sceneId, target.sceneId);
  assert.equal(e.field, 'ko');
  const { targetKey, errorIndex } = await importUi();
  assert.equal(targetKey(e), `L:${target.id}:ko`, 'maps to the exact subtitle input');
  const idx = errorIndex(view(s, id));
  assert.equal(idx.byKey[`L:${target.id}:ko`].length, 1);
  assert.equal(idx.bySceneCount[target.sceneId], 1, 'the scene tab badge counts it');
});

test('errors: invalid CTA claim → the CTA input; excessive dialogue → the scene duration/timing; empty required visual → the visual input', async () => {
  const { s, id } = await episode({ claims: ['방수'] });
  const { targetKey } = await importUi();
  await edit(s, id, (p) => { p.cta.lines = ['댓글에 ‘우산’ 남기면 방수 링크 드립니다']; p.scenes[0].visual = ''; p.lines.forEach((l) => { if (l.sceneId === 'S1') l.en = 'Honestly baby I really truly believe that rain is simply a minor personal inconvenience for everybody else'; }); });
  const errs = view(s, id).derived.validation.errors;
  const cta = errs.find((x) => x.code === 'PRODUCT_CLAIM' && x.field === 'cta.lines');
  assert.ok(cta, 'the unverified claim is reported on the CTA field');
  assert.match(cta.message, /방수/);
  assert.equal(targetKey(cta), 'cta:lines');
  assert.equal(errs.some((x) => x.field === 'cta.lines' && /드립/.test(x.message) && !/방수/.test(x.message)), false, '"링크 드립니다" is not flagged (real claims still are)');
  const timing = errs.find((x) => x.code === 'SCENE_OVERFLOW' && x.sceneId === 'S1');
  assert.equal(timing.field, 'timing');
  assert.equal(targetKey(timing), 'S:S1:durationSec');
  const vis = scene(s, id, 'S1').approval.errors.find((x) => x.code === 'SCENE_VISUAL');
  assert.equal(targetKey(vis), 'S:S1:visual');
});

test('optional empty fields (narration, action, placement) never produce a blocking error', async () => {
  const { s, id } = await episode();
  await edit(s, id, (p) => { p.scenes.forEach((x) => { x.narration = ''; x.action = ''; x.placement = ''; }); });
  const v = view(s, id);
  assert.equal(v.derived.validation.ok, true);
  v.scenes.forEach((x) => assert.equal(x.approval.errors.some((e) => ['narration', 'action', 'placement'].includes(e.field)), false, x.id));
});

test('errors update when the field is edited and saved', async () => {
  const { s, id } = await episode();
  const l = s.store.episodes.get(id).lines[0];
  await edit(s, id, (p) => { p.lines.find((x) => x.id === l.id).ko = ''; });
  assert.equal(view(s, id).derived.validation.errors.some((e) => e.code === 'LINE_KO'), true);
  await edit(s, id, (p) => { p.lines.find((x) => x.id === l.id).ko = '고친 자막'; });
  assert.equal(view(s, id).derived.validation.errors.some((e) => e.code === 'LINE_KO'), false);
  assert.equal(scene(s, id, l.sceneId).approval.status, 'ready');
});

// ---------- 2. individual scene approval ----------
test('a missing subtitle blocks ONLY its own scene; the other scenes stay approvable', async () => {
  const { s, id } = await episode();
  const bad = s.store.episodes.get(id).lines.find((l) => l.sceneId === 'S2');
  await edit(s, id, (p) => { p.lines.find((l) => l.id === bad.id).ko = ''; });
  const v = view(s, id);
  assert.equal(v.scenes.find((x) => x.id === 'S2').approval.status, 'needs_changes');
  v.scenes.filter((x) => x.id !== 'S2').forEach((x) => assert.equal(x.approval.status, 'ready', x.id));
  await assert.rejects(s.projects.approveScene(id, 'S2'), (e) => e.code === 'SCENE_INVALID');
  await s.projects.approveScene(id, 'S1');
  const r = await s.projects.approveReady(id);
  assert.deepEqual(r.skipped.map((x) => x.sceneId), ['S2']);
  assert.equal(r.approved.length, 4);
  assert.equal(view(s, id).derived.sceneApproval.progress, '5/6 씬 승인');
});

test('editing an approved scene keeps the approved version and requires a new approval; other scenes are untouched', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  const before = scene(s, id, 'S1').approval;
  assert.equal(before.status, 'approved');
  assert.equal(before.revision, 1);
  const oldLines = s.store.episodes.get(id).lines.filter((l) => l.sceneId === 'S1').map((l) => l.en);
  await edit(s, id, (p) => { p.lines.find((l) => l.sceneId === 'S1').en = 'A brand new line!'; });
  const v = view(s, id);
  const s1 = v.scenes.find((x) => x.id === 'S1').approval;
  assert.equal(s1.approved, false);
  assert.equal(s1.editedAfterApproval, true);
  assert.notEqual(s1.status, 'approved');
  assert.equal(s1.history.length, 1, 'the previously approved version is preserved');
  v.scenes.filter((x) => x.id !== 'S1').forEach((x) => assert.equal(x.approval.approved, true, x.id + ' stays approved'));
  const h = s.projects.sceneHistory(id, 'S1');
  assert.deepEqual(h.versions[0].snapshot.lines.map((l) => l.en), oldLines, 'the old approved text is kept verbatim');
  assert.ok(h.events.some((e) => e.type === 'edited'));
  await s.projects.approveScene(id, 'S1');
  const again = scene(s, id, 'S1').approval;
  assert.equal(again.revision, 2);
  assert.equal(s.projects.sceneHistory(id, 'S1').versions.length, 2);
  assert.deepEqual(s.projects.sceneHistory(id, 'S1').versions[0].snapshot.lines.map((l) => l.en), oldLines, 'revision 1 is never rewritten');
});

test('revoking a scene approval is explicit and recorded; a title-only edit does not un-approve', async () => {
  const { s, id } = await episode();
  await s.projects.approveScene(id, 'S1');
  await s.setSceneTitle(id, 'S1', '새로운 제목입니다');
  assert.equal(scene(s, id, 'S1').approval.approved, true);
  await s.projects.revokeScene(id, 'S1');
  assert.equal(scene(s, id, 'S1').approval.approved, false);
  assert.ok(s.projects.sceneHistory(id, 'S1').events.some((e) => e.type === 'revoked'));
  await assert.rejects(s.projects.revokeScene(id, 'S1'), (e) => e.code === 'NOT_APPROVED');
});

test('a scene with an unverified product claim in its direction text cannot be approved', async () => {
  const { s, id } = await episode({ claims: ['방수'] });
  await edit(s, id, (p) => { p.scenes[0].visual = 'Jack proudly shows the 방수 umbrella'; });
  const a = scene(s, id, 'S1').approval;
  assert.equal(a.status, 'needs_changes');
  assert.equal(a.errors.find((e) => e.code === 'PRODUCT_CLAIM').field, 'visual');
});

// ---------- 3. project approval ----------
test('the script can only be approved when every scene is approved; nothing is approved silently', async () => {
  const { s, id } = await episode();
  await assert.rejects(s.approveScript(id), (e) => e.code === 'SCENES_NOT_APPROVED' && /6개/.test(e.message));
  assert.equal(view(s, id).derived.scriptApproved, false);
  assert.equal(view(s, id).scenes.some((x) => x.approval.approved), false, 'approving the script attempt did not approve any scene');
  await s.projects.approveReady(id);
  await s.projects.revokeScene(id, 'S6');
  await assert.rejects(s.approveScript(id), (e) => e.code === 'SCENES_NOT_APPROVED');
  await s.projects.approveScene(id, 'S6');
  const v = await s.approveScript(id);
  assert.equal(v.derived.scriptApproved, true);
  assert.equal(v.derived.sceneApproval.progress, '6/6 씬 승인');
});

test('project approval also needs the six story beats; there is no ending or ending template to validate any more', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  // with the six beats and all scenes approved there is no ending-related blocker
  const r = view(s, id).derived.sceneApproval;
  assert.equal(r.canApproveProject, true);
  assert.ok(!r.blockers.some((b) => /^ENDING_/.test(b.code)), 'no ENDING_* blockers exist');
  assert.equal(s.store.episodes.get(id).ending, undefined, 'no ending object on a new episode');
  // a missing story beat is a project-level error
  const ep = s.store.episodes.get(id);
  await s.saveScript(id, { scenes: ep.scenes.filter((x) => x.beatKey !== 'twist' && x.beatKey !== 'unexpected_twist').map((x) => ({ ...x })), lines: ep.lines.filter((l) => !ep.scenes.find((x) => x.id === l.sceneId && x.beatKey === 'unexpected_twist')) });
  await s.projects.approveReady(id);
  await assert.rejects(s.approveScript(id), (e) => e.code === 'INVALID_SCRIPT');
});

test('editing a scene after the script was approved withdraws the script approval and that scene only', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await edit(s, id, (p) => { p.lines.find((l) => l.sceneId === 'S3').en = 'Changed!'; });
  const v = view(s, id);
  assert.equal(v.derived.scriptApproved, false);
  assert.equal(v.scenes.filter((x) => !x.approval.approved).map((x) => x.id).join(), 'S3');
  assert.equal(v.derived.sceneApproval.progress, '5/6 씬 승인');
});

// ---------- 4. Image Development hand-off ----------
test('hand-off: needs script + all scenes approved; saves an immutable snapshot and the workspace; never generates anything paid', async () => {
  const { s, id, a } = await episode();
  await s.loadDemoReferences(); // approved character references (mock placeholders)
  const callsBefore = a.calls.length;
  await assert.rejects(s.projects.handoff(id), (e) => e.code === 'SCRIPT_NOT_APPROVED');
  await s.projects.approveReady(id);
  await assert.rejects(s.projects.handoff(id), (e) => e.code === 'SCRIPT_NOT_APPROVED');
  await s.approveScript(id);
  assert.equal(view(s, id).derived.handoff.ready, true);
  const r = await s.projects.handoff(id);
  assert.equal(r.created, true);
  const ep = s.store.episodes.get(id);
  assert.equal(ep.imageDev.workspaceId, 'IMG-' + id);
  const snapPath = s.store.episodes.file(id, ep.imageDev.snapshot.file);
  assert.ok(fs.existsSync(snapPath));
  assert.equal(fs.statSync(snapPath).mode & 0o222, 0, 'snapshot file is read-only');
  const snap = s.projects.readSnapshot(id);
  assert.deepEqual(snap.scenes.map((x) => x.id), ep.scenes.map((x) => x.id), 'scene IDs carried over');
  snap.scenes.forEach((sc) => {
    const src = ep.scenes.find((x) => x.id === sc.id);
    assert.equal(sc.title_ko, src.title_ko);
    assert.equal(sc.visual, src.visual);
    assert.deepEqual(sc.dialogue.map((l) => [l.en, l.ko]), ep.lines.filter((l) => l.sceneId === sc.id).map((l) => [l.en, l.ko]));
    assert.ok(sc.sceneRevision >= 1);
  });
  assert.ok(snap.characterReferences.some((c) => c.characterId === 'jack' && c.references.length), 'approved character references are carried');
  assert.ok(Array.isArray(snap.productReferences) && snap.productReferences.length >= 1, 'product references are carried');
  assert.ok(ep.imageDev.scenes.S1.requiredAssets.some((x) => x.type === 'start_image'));
  // NOTHING paid happened
  assert.equal(a.calls.length, callsBefore, 'no AI call during approval or hand-off');
  assert.equal((ep.spend || []).length, 0);
  assert.equal(ep.generation.jobs.length, 0);
  assert.equal(ep.generation.authorizations.length, 0);
  assert.equal(ep.scenes.some((x) => x.startImage), false, 'no start image was generated');
  assert.equal(ep.imageDev.paidGeneration.started, false);
});

test('hand-off is repeatable: the same approved script reuses its snapshot; a changed script gets a NEW snapshot and the old one stays', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await s.projects.handoff(id);
  const first = s.store.episodes.get(id).imageDev.snapshot.file;
  const bytes = fs.readFileSync(s.store.episodes.file(id, first), 'utf8');
  const again = await s.projects.handoff(id);
  assert.equal(again.created, false);
  assert.equal(s.store.episodes.get(id).imageDev.snapshot.file, first);
  assert.equal(fs.readFileSync(s.store.episodes.file(id, first), 'utf8'), bytes);
  await edit(s, id, (p) => { p.lines.find((l) => l.sceneId === 'S4').en = 'Different!'; });
  assert.equal(view(s, id).derived.handoff.current, false, 'the workspace knows the script moved on');
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await s.projects.handoff(id);
  const iv = s.store.episodes.get(id).imageDev;
  assert.notEqual(iv.snapshot.file, first);
  assert.equal(iv.snapshots.length, 2);
  assert.equal(fs.readFileSync(s.store.episodes.file(id, first), 'utf8'), bytes, 'the old snapshot is untouched');
  assert.equal(iv.scenes.S4.changedSinceLastHandoff, true);
  assert.equal(iv.scenes.S1.changedSinceLastHandoff, false);
});

test('hand-off keeps existing image assets: a start image already in the episode is never removed or regenerated', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await s.store.episodes.update(id, (ep) => { ep.scenes.find((x) => x.id === 'S1').startImage = { type: 'upload', file: 'x.png', sha256: 'abc', approved: true }; });
  await s.projects.handoff(id);
  const ep = s.store.episodes.get(id);
  assert.equal(ep.scenes.find((x) => x.id === 'S1').startImage.approved, true);
  assert.equal(ep.imageDev.scenes.S1.requiredAssets.find((x) => x.type === 'start_image').status, 'approved');
});

// ---------- 5. reusable scenes and projects ----------
test('duplicating an episode makes an independent copy: no approvals/assets copied, editing the copy never changes the original', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  const newId = await s.projects.duplicateEpisode(id);
  const src = s.store.episodes.get(id);
  const copy = s.store.episodes.get(newId);
  assert.equal(copy.duplicatedFrom.episodeId, id);
  assert.equal(copy.projectId, src.projectId);
  assert.equal(copy.approvals.script, null);
  assert.deepEqual(copy.prompts, {});
  assert.equal(view(s, newId).derived.sceneApproval.approvedCount, 0, 'all scenes need approval again');
  assert.deepEqual(copy.scenes.map((x) => x.id), src.scenes.map((x) => x.id));
  assert.equal(copy.scenes.filter((x) => x.part === 'B').length, 0, 'no ending scenes are created in the copy');
  assert.equal(copy.ending, undefined);
  assert.equal(copy.scenes[0].origin.episodeId, id);
  assert.equal(copy.scenes[0].origin.linked, false);
  await edit(s, newId, (p) => { p.lines[0].en = 'Edited only in the copy!'; });
  assert.notEqual(s.store.episodes.get(id).lines[0].en, 'Edited only in the copy!');
  assert.equal(view(s, id).derived.scriptApproved, true, 'the original stays approved');
  assert.equal(view(s, id).derived.sceneApproval.approvedCount, 6);
});

test('copying a scene into another episode creates an independent copy that needs approval; a scene id that does not exist (the old E-scenes) cannot be copied', async () => {
  const one = await episode();
  const two = await episode({});
  // second episode in the same studio: use a copy of the first one as target
  const target = await one.s.projects.duplicateEpisode(one.id, { title: '대상' });
  await one.s.projects.approveScene(one.id, 'S2');
  const before = JSON.stringify(one.s.store.episodes.get(one.id).scenes.find((x) => x.id === 'S2'));
  const r = await one.s.projects.copyScene(one.id, 'S2', target, { beatKey: 'problem' });
  const t = one.s.store.episodes.get(target);
  const copied = t.scenes.find((x) => x.id === r.sceneId);
  assert.equal(copied.beatKey, 'problem');
  assert.equal(copied.origin.type, 'scene');
  assert.equal(copied.origin.episodeId, one.id);
  assert.equal(copied.origin.sceneId, 'S2');
  assert.equal(copied.origin.linked, false);
  assert.ok(t.lines.some((l) => l.sceneId === r.sceneId), 'dialogue copied too');
  assert.equal(view(one.s, target).scenes.find((x) => x.id === r.sceneId).approval.approved, false);
  assert.equal(JSON.stringify(one.s.store.episodes.get(one.id).scenes.find((x) => x.id === 'S2')), before, 'the source scene is untouched');
  await edit(one.s, target, (p) => { p.scenes.find((x) => x.id === r.sceneId).visual = 'only in the copy'; });
  assert.notEqual(one.s.store.episodes.get(one.id).scenes.find((x) => x.id === 'S2').visual, 'only in the copy');
  await assert.rejects(one.s.projects.copyScene(one.id, 'E2', target), (e) => e.code === 'NOT_FOUND');
  assert.ok(two.id);
});

test('scene templates: copies are independent by default; a linked template only updates when the operator asks', async () => {
  const { s, id } = await episode();
  const target = await s.projects.duplicateEpisode(id, { title: '템플릿 대상' });
  const t = await s.projects.saveTemplate(id, 'S1', { name: '영국인 자신감' });
  assert.equal(t.current, 1);
  const plain = await s.projects.applyTemplate(t.id, target, { beatKey: 'setup' });
  const linked = await s.projects.applyTemplate(t.id, target, { linked: true, beatKey: 'setup' });
  assert.equal(s.store.episodes.get(target).scenes.find((x) => x.id === plain.sceneId).origin.linked, false);
  assert.equal(s.store.episodes.get(target).scenes.find((x) => x.id === linked.sceneId).origin.linked, true);
  // the template moves on (new version); nothing changes by itself
  await edit(s, id, (p) => { p.lines.find((l) => l.sceneId === 'S1').en = 'Template v2 line'; });
  await s.projects.saveTemplate(id, 'S1', { templateId: t.id });
  const links = view(s, target).scenes.reduce((m, x) => Object.assign(m, { [x.id]: x.link }), {});
  assert.equal(links[linked.sceneId].updateAvailable, true);
  assert.equal(links[plain.sceneId].updateAvailable, false);
  assert.notEqual(s.store.episodes.get(target).lines.find((l) => l.sceneId === linked.sceneId).en, 'Template v2 line');
  await assert.rejects(s.projects.syncLinkedScene(target, plain.sceneId), (e) => e.code === 'NOT_LINKED');
  await s.projects.syncLinkedScene(target, linked.sceneId);
  assert.equal(s.store.episodes.get(target).lines.find((l) => l.sceneId === linked.sceneId).en, 'Template v2 line');
  assert.equal(s.store.episodes.get(target).lines.find((l) => l.sceneId === plain.sceneId).en !== 'Template v2 line', true, 'the independent copy never changes');
  await assert.rejects(s.projects.saveTemplate(id, 'E1', {}), (e) => e.code === 'NOT_FOUND');
});

// ---------- 6. persistence + migration ----------
test('scene approvals, history, templates and the Image Development workspace survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-persist-'));
  const { s, id } = await episode({ env: { RF_STUDIO_DIR: dir } });
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await s.projects.handoff(id);
  await s.projects.saveTemplate(id, 'S1', { name: '영구 템플릿' });
  const cfg = loadConfig({ RF_STUDIO_DIR: dir, RF_MASTER_KEY: 'test-master-key-for-unit-tests', RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
  const s2 = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  const v = s2.episodeView(id);
  assert.equal(v.derived.scriptApproved, true);
  assert.equal(v.derived.sceneApproval.progress, '6/6 씬 승인');
  assert.equal(v.derived.handoff.current, true);
  assert.equal(s2.projects.sceneHistory(id, 'S1').versions.length, 1);
  assert.equal(s2.projects.templates.list().length, 1);
  assert.ok(s2.projects.listProjects().some((p) => p.episodes.some((e) => e.id === id && e.handoff)));
});

test('migration: an episode whose script was approved before scene approvals existed keeps every scene approved; nothing is silently un-approved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-migrate-'));
  const { s, id } = await episode({ env: { RF_STUDIO_DIR: dir } });
  await s.projects.approveReady(id);
  await s.approveScript(id);
  // simulate the old data format: no scene approvals, no project
  const file = s.store.episodes.file(id, 'episode.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.sceneApprovals; delete raw.projectId;
  fs.writeFileSync(file, JSON.stringify(raw));
  const cfg = loadConfig({ RF_STUDIO_DIR: dir, RF_MASTER_KEY: 'test-master-key-for-unit-tests', RF_FONT_NAME: 'Noto Sans CJK KR', RF_ALLOW_FONT_FALLBACK: '1' }, { dotenvFile: '/nonexistent' });
  const s2 = createStudio({ cfg, provider: createMockVideoProvider({ ffmpeg: cfg.ffmpeg.ffmpeg }) });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.approvals.script.hash, raw.approvals.script.hash, 'the script approval is untouched');
  assert.equal(Object.keys(after.sceneApprovals).length, 6);
  assert.equal(after.sceneApprovals.S1.current.by, 'migration');
  assert.ok(after.projectId);
  const v = s2.episodeView(id);
  assert.equal(v.derived.scriptApproved, true);
  assert.equal(v.derived.sceneApproval.allScenesApproved, true);
  assert.equal(v.derived.handoff.ready, true);
  // idempotent
  assert.deepEqual(s2.projects.migrateAll(), []);
});

test('the demo/legacy episode (no concept link) can go through scene approval and project approval too', async () => {
  const { s } = make();
  const id = 'EP01';
  assert.equal(s.episodeView(id).derived.scriptApproved, false);
  assert.equal(s.episodeView(id).derived.sceneApproval.approvedCount, 0);
  await s.projects.approveReady(id);
  const v = await s.approveScript(id);
  assert.equal(v.derived.scriptApproved, true);
});

// ---------- 7. HTTP + no paid generation ----------
test('HTTP routes: approve scene → approve ready → approve script → hand-off; hand-off creates no spend and no job', async () => {
  const http = require('node:http');
  const { createApp } = require('../studio/server');
  const m = await episode();
  const app = createApp(m.s, { token: '', port: 0 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: '127.0.0.1:' + port, 'x-rf-studio': '1', 'content-type': 'application/json', Origin: 'http://127.0.0.1:' + port, 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch (_) { /* not json */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.end(data);
  });
  try {
    const id = m.id;
    assert.equal((await call('POST', `/api/episodes/${id}/script/handoff`)).status, 409);
    assert.equal((await call('POST', `/api/episodes/${id}/script/approve`)).status, 409);
    const one = await call('POST', `/api/episodes/${id}/scenes/S1/approve`);
    assert.equal(one.status, 200);
    assert.equal(one.json.scenes.find((x) => x.id === 'S1').approval.approved, true);
    const bulk = await call('POST', `/api/episodes/${id}/scenes/approve-ready`);
    assert.equal(bulk.json.approveResult.approved.length, 5);
    assert.equal((await call('POST', `/api/episodes/${id}/script/approve`)).status, 200);
    const ho = await call('POST', `/api/episodes/${id}/script/handoff`);
    assert.equal(ho.status, 200);
    assert.equal(ho.json.handoffResult.created, true);
    assert.equal(ho.json.imageDev.paidGeneration.started, false);
    assert.equal(ho.json.spend.length, 0);
    assert.equal(ho.json.generation.jobs.length, 0);
    const info = await call('GET', `/api/episodes/${id}/image-dev`);
    assert.equal(info.json.snapshot.episodeId, id);
    assert.equal((await call('GET', '/api/projects')).json.projects.length >= 1, true);
  } finally { await new Promise((r) => app.close(r)); }
});

test('paid image generation stays behind its own gates after hand-off: start images still need confirmation', async () => {
  const { s, id } = await episode();
  await s.projects.approveReady(id);
  await s.approveScript(id);
  await s.projects.handoff(id);
  const calls = m => m;
  await assert.rejects(s.startImages.generate(id, { sceneIds: ['S1'] }), (e) => !!e.code && e.status !== 200, 'no confirmation → refused');
  assert.equal(s.store.episodes.get(id).scenes.some((x) => x.startImage), false);
  assert.ok(calls);
});

// ---------- 8. pure UI mapping ----------
test('error → input mapping covers every kind of target', async () => {
  const { targetKey } = await importUi();
  assert.equal(targetKey({ field: 'ko', lineId: 'L3', sceneId: 'S2' }), 'L:L3:ko');
  assert.equal(targetKey({ field: 'cta.keyword' }), 'cta:keyword');
  assert.equal(targetKey({ field: 'beat.title_ko', beatKey: 'problem' }), 'B:problem:title_ko');
  assert.equal(targetKey({ field: 'timing', sceneId: 'S4' }), 'S:S4:durationSec');
  assert.equal(targetKey({ sceneId: 'S4' }), 'S:S4:block');
  assert.equal(targetKey({ beatKey: 'setup' }), 'B:setup:card');
  assert.equal(targetKey({ code: 'TOO_LONG' }), null);
});
