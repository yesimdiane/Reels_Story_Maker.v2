// Reusable project structure on top of the existing episode store:
//   Project → Episode → Script version → Scene → Scene version (approval history) → Dialogue → Image assets → Animation assets
// An episode IS the persistent production project; scenes are independently approved (see sceneapproval.js).
// This service adds: project registry, scene approval actions, the immutable approved-script snapshot + Image Development
// hand-off, episode / scene duplication and reusable scene templates.
// It never calls an AI or video provider: nothing here can spend money.
'use strict';
const approvalsMod = require('./approvals');
const fs = require('node:fs');
const path = require('node:path');
const { StudioError, nowIso, sha256, canonical, readJson, writeJsonAtomic } = require('./util');
const { isScriptApproved, scriptFingerprint, validateScript, sceneTitle } = require('./episode');
const SA = require('./sceneapproval');
const F = require('./formula');

const clone = (x) => JSON.parse(JSON.stringify(x));
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;

function createProjects({ store, episodeIds, lib, products, log = () => {} }) {
  const registryFile = store.path('projects.json');
  const templatesFile = store.path('scene-templates.json');

  // ---------- project registry ----------
  const readRegistry = () => readJson(registryFile, { schema: 1, projects: {} });
  function projectIdFor(ep) { return ep.projectId || 'PRJ-' + (ep.productId || 'manual'); }
  function ensureProject(ep) {
    const pid = projectIdFor(ep);
    const reg = readRegistry();
    if (!reg.projects[pid]) {
      reg.projects[pid] = { id: pid, name: (ep.product && ep.product.name) ? `${ep.product.name} 프로젝트` : '수동 프로젝트', productId: ep.productId || '', createdAt: nowIso() };
      writeJsonAtomic(registryFile, reg);
    }
    return reg.projects[pid];
  }
  function listProjects() {
    const reg = readRegistry();
    const eps = store.episodes.list();
    eps.forEach((e) => { const pid = projectIdFor(e); if (!reg.projects[pid]) reg.projects[pid] = { id: pid, name: (e.product && e.product.name) ? `${e.product.name} 프로젝트` : '수동 프로젝트', productId: e.productId || '', createdAt: nowIso() }; });
    return Object.values(reg.projects).map((p) => ({
      ...p,
      episodes: eps.filter((e) => projectIdFor(e) === p.id).map((e) => {
        const ep = clone(e); SA.migrateSceneApprovals(ep, lib());
        const r = SA.projectReadiness(ep, lib());
        return { id: e.id, title: e.title, scenes: r.sceneCount, scenesApproved: r.approvedCount, scriptApproved: isScriptApproved(e), handoff: !!(e.imageDev && e.imageDev.snapshot), duplicatedFrom: e.duplicatedFrom || null };
      }),
    }));
  }

  // ---------- readiness (read-only; works on a copy so old episodes show migrated scene approvals without a write) ----------
  function readiness(ep) {
    const copy = clone(ep);
    SA.migrateSceneApprovals(copy, lib());
    return SA.projectReadiness(copy, lib());
  }

  /** Hooks used by the store on every write: migrate old episodes once, remember which approved scenes get edited. */
  const hooks = {
    before(ep) { SA.migrateSceneApprovals(ep, lib()); if (!ep.projectId) { ep.projectId = projectIdFor(ep); } return SA.approvedSet(ep); },
    after(ep, pre) { SA.noteEdits(ep, pre); },
  };

  /** Startup: persists the migration for every episode (idempotent; ep.approvals is never touched). */
  function migrateAll() {
    const done = store.episodes.archiveOldEndings(); // the fixed product ending was removed: old ending scenes move to ep.archivedEnding (nothing deleted)
    store.episodes.list().forEach((e) => {
      const ep = clone(e);
      let changed = SA.migrateSceneApprovals(ep, lib());
      // storyboard approvals made before the per-scene record: still valid → upgraded in place (same approver/time), nothing else changes
      const sb = ep.approvals && ep.approvals.storyboard;
      if (sb && sb.v !== 2 && approvalsMod.status(ep, scriptFingerprint).approved) { ep.approvals.storyboard = Object.assign(approvalsMod.makeRecord(ep, sb.by, sb.at), { upgradedFrom: 'v1' }); changed = true; }
      const needsProject = !e.projectId;
      if (!changed && !needsProject) return;
      const file = store.episodes.file(e.id, 'episode.json');
      ep.projectId = projectIdFor(ep);
      ensureProject(ep);
      writeJsonAtomic(file, ep);
      done.push(e.id);
    });
    return done;
  }

  // ---------- scene approval actions ----------
  async function approveScene(id, sid, by = 'operator') {
    await store.episodes.update(id, (ep) => { SA.approveScene(ep, lib(), sid, by); });
    store.episodes.audit(id, 'scene.approved', { sceneId: sid, by });
  }
  async function revokeScene(id, sid, by = 'operator') {
    await store.episodes.update(id, (ep) => { SA.revokeScene(ep, sid, by); });
    store.episodes.audit(id, 'scene.revoked', { sceneId: sid, by });
  }
  /** Explicit bulk action chosen by the operator: approves only scenes that already pass every check; nothing else is touched. */
  async function approveReady(id, by = 'operator') {
    const approved = [];
    const skipped = [];
    await store.episodes.update(id, (ep) => {
      const whole = validateScript(ep, lib());
      ep.scenes.forEach((s) => {
        const st = SA.sceneState(ep, lib(), s.id, whole);
        if (st.approved) return;
        if (st.status === 'ready') { SA.approveScene(ep, lib(), s.id, by); approved.push(s.id); } else skipped.push({ sceneId: s.id, status: st.status, reason: (st.errors[0] || {}).message || '' });
      });
    });
    store.episodes.audit(id, 'scene.approved_ready', { approved, skipped: skipped.map((s) => s.sceneId), by });
    return { approved, skipped };
  }
  const sceneHistory = (id, sid) => {
    const ep = store.episodes.get(id);
    const rec = (ep.sceneApprovals || {})[sid];
    if (!rec) return { sceneId: sid, versions: [], events: [] };
    return { sceneId: sid, current: rec.current, versions: rec.history.map((h) => ({ rev: h.rev, at: h.at, by: h.by, hash: h.hash, revokedAt: h.revokedAt || null, supersededAt: h.supersededAt || null, snapshot: h.snapshot })), events: rec.events };
  };

  // ---------- project gate used by the script approval ----------
  /** Throws unless every required scene is approved and the project checks pass. */
  function assertProjectReady(ep) {
    const r = SA.projectReadiness(ep, lib());
    if (r.blockers.length) throw new StudioError('SCENES_NOT_APPROVED', r.blockers[0].message, { details: r.blockers, recovery: '장면별로 "씬 승인"을 누른 뒤(또는 "승인 가능한 씬 모두 승인") 대본을 승인하세요.', status: 409 });
    return r;
  }

  // ---------- Image Development hand-off ----------
  const REF_FIELDS = ['id', 'label', 'isSheet', 'sha256'];
  function characterRefs(ep, ids) {
    const L = lib();
    return ids.map((cid) => {
      const c = (L.characters || []).find((x) => x.id === cid);
      if (!c) return { characterId: cid, name: cid, references: [], missing: true };
      const refs = (c.references || []).filter((r) => r.approved).map((r) => Object.fromEntries(REF_FIELDS.map((k) => [k, r[k]])));
      return { characterId: cid, name: c.name, references: refs, missing: refs.length === 0 };
    });
  }
  function productRefs(ep) {
    const ids = (ep.productRefs && ep.productRefs.imageIds) || [];
    if (!ids.length || !ep.productId) return [];
    try {
      const raw = products.raw(ep.productId);
      return ids.map((i) => raw.images.find((x) => x.id === i)).filter(Boolean).map((im) => ({ id: im.id, kind: im.kind, label: im.label, sha256: im.sha256 }));
    } catch (_) { return []; }
  }

  /** The complete, frozen content of the approved script (what Image Development works from). */
  function buildSnapshot(ep) {
    const cast = Array.from(new Set(ep.scenes.flatMap((s) => s.characters || [])));
    const charRefs = characterRefs(ep, cast);
    const pRefs = productRefs(ep);
    const scenes = ep.scenes.map((s) => {
      const st = (ep.sceneApprovals[s.id] || {}).current || {};
      return {
        id: s.id, part: s.part || '', beatKey: s.beatKey || '', title_ko: sceneTitle(s), durationSec: s.durationSec,
        visual: s.visual || '', action: s.action || '', narration: s.narration || '', placement: s.placement || '',
        characters: s.characters || [], showsProduct: !!s.showsProduct, inserts: s.inserts || [], sceneRevision: st.rev || null, sceneHash: st.hash || '',
        dialogue: ep.lines.filter((l) => l.sceneId === s.id).map((l) => ({ id: l.id, speaker: l.speaker, en: l.en, ko: l.ko })),
        origin: s.origin || null,
      };
    });
    return {
      schema: 1, episodeId: ep.id, projectId: ep.projectId || projectIdFor(ep), title: ep.title, titleEn: ep.titleEn || '',
      scriptVersion: ep.version || 0, scriptHash: scriptFingerprint(ep), scenes,
      cta: ep.cta,
      product: { id: ep.productId || '', name: ep.product && ep.product.name, verifiedFeatures: (ep.product && ep.product.verifiedFeatures) || [], forbiddenClaims: (ep.product && ep.product.forbiddenClaims) || [] },
      characterReferences: charRefs, productReferences: pRefs,
      approvals: { script: ep.approvals.script, scenes: Object.fromEntries(ep.scenes.map((s) => [s.id, ((ep.sceneApprovals[s.id] || {}).current) || null])) },
    };
  }

  /** What each scene still needs before images can be made. Informational only — it never blocks and never spends. */
  function requiredAssets(ep, snap, s) {
    const out = [{ type: 'start_image', label: `${s.id} 시작 이미지`, status: s.startImage ? (s.startImage.approved ? 'approved' : 'unapproved') : 'missing' }];
    snap.characterReferences.filter((c) => (s.characters || []).includes(c.characterId)).forEach((c) => out.push({ type: 'character_reference', characterId: c.characterId, label: `${c.name} 승인된 참조 이미지`, status: c.missing ? 'missing' : 'ok', refIds: c.references.map((r) => r.id) }));
    if (s.showsProduct) out.push({ type: 'product_reference', label: '제품 참조 이미지', status: snap.productReferences.length ? 'ok' : 'missing', refIds: snap.productReferences.map((r) => r.id) });
    return out;
  }

  /**
   * Save an immutable approved-script snapshot and create/update the Image Development workspace for the episode.
   * Requires: script approved + every scene approved. NEVER generates anything (no AI/video call, no spend).
   */
  async function handoff(id, by = 'operator') {
    let result;
    await store.episodes.update(id, (ep) => {
      if (!isScriptApproved(ep)) throw new StudioError('SCRIPT_NOT_APPROVED', '대본이 승인되지 않았습니다. 대본을 승인한 뒤 이동하세요.', { status: 409 });
      const r = SA.projectReadiness(ep, lib());
      if (!r.allScenesApproved) throw new StudioError('SCENES_NOT_APPROVED', `${r.progress} — 모든 씬이 승인되어야 합니다.`, { details: r.blockers, status: 409 });
      const snap = buildSnapshot(ep);
      const body = JSON.stringify(snap, null, 2);
      const digest = sha256(canonical(snap));
      const dir = path.dirname(store.episodes.file(id, 'approved-scripts', 'x'));
      fs.mkdirSync(dir, { recursive: true });
      const name = `script-v${String(snap.scriptVersion).padStart(4, '0')}-${snap.scriptHash.slice(0, 12)}.json`;
      const file = path.join(dir, name);
      // Write-once: an existing snapshot of the same approved script is verified and reused, never rewritten.
      if (fs.existsSync(file)) {
        const old = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (sha256(canonical(old)) !== digest) throw new StudioError('SNAPSHOT_CONFLICT', '같은 버전의 승인 스냅샷이 이미 있고 내용이 다릅니다. 덮어쓰지 않았습니다.', { status: 409 });
      } else {
        fs.writeFileSync(file, body, { flag: 'wx', mode: 0o444 });
      }
      const at = nowIso();
      const prev = ep.imageDev || null;
      const entry = { file: 'approved-scripts/' + name, sha256: digest, scriptVersion: snap.scriptVersion, scriptHash: snap.scriptHash, at, by };
      const snapshots = ((prev && prev.snapshots) || []).filter((x) => x.file !== entry.file).concat([entry]);
      const scenes = {};
      snap.scenes.forEach((s) => {
        const sc = ep.scenes.find((x) => x.id === s.id);
        const old = prev && prev.scenes && prev.scenes[s.id];
        scenes[s.id] = {
          sceneId: s.id, part: s.part, beatKey: s.beatKey, title_ko: s.title_ko, durationSec: s.durationSec, visual: s.visual, action: s.action, characters: s.characters, showsProduct: s.showsProduct,
          lineIds: s.dialogue.map((l) => l.id), sceneRevision: s.sceneRevision, sceneHash: s.sceneHash,
          characterRefs: snap.characterReferences.filter((c) => s.characters.includes(c.characterId)).map((c) => ({ characterId: c.characterId, refIds: c.references.map((r) => r.id) })),
          productRefIds: s.showsProduct ? snap.productReferences.map((r) => r.id) : [],
          requiredAssets: requiredAssets(ep, snap, sc),
          changedSinceLastHandoff: !!(old && old.sceneHash !== s.sceneHash),
        };
      });
      ep.imageDev = {
        workspaceId: 'IMG-' + ep.id, createdAt: (prev && prev.createdAt) || at, updatedAt: at,
        scriptHash: snap.scriptHash, snapshot: entry, snapshots, scenes,
        paidGeneration: { started: false, note: '이미지 생성은 별도의 비용 확인과 승인 후에만 시작됩니다. 이 이동은 어떤 유료 호출도 하지 않았습니다.' },
      };
      result = { entry, created: !prev, scenes: Object.keys(scenes).length };
    });
    store.episodes.audit(id, 'imagedev.handoff', { by, snapshot: result.entry.file, created: result.created });
    return result;
  }
  function readSnapshot(id, rel) {
    const ep = store.episodes.get(id);
    const e = ep.imageDev && (rel ? ep.imageDev.snapshots.find((x) => x.file === rel) : ep.imageDev.snapshot);
    if (!e) throw new StudioError('NOT_FOUND', '승인 스냅샷이 없습니다.', { status: 404 });
    return JSON.parse(fs.readFileSync(store.episodes.file(id, e.file), 'utf8'));
  }
  /** Whether the Image Development workspace still matches the approved script (false → re-approve and hand off again). */
  function handoffState(ep) {
    const iv = ep.imageDev;
    if (!iv) return { done: false, current: false };
    return { done: true, current: iv.scriptHash === scriptFingerprint(ep) && isScriptApproved(ep), snapshot: iv.snapshot };
  }

  // ---------- duplication ----------
  const RUNTIME_KEYS = ['approvals', 'prompts', 'clips', 'generation', 'spend', 'voice', 'renders', 'sfx', 'renderJob', 'sceneApprovals', 'imageDev', 'suggestions', 'status', 'version', 'createdAt', 'updatedAt', 'spendLimitUsd', 'duplicatedFrom', 'trashedAt', 'trashedBy', 'archivedAt', 'archivedBy', 'holdAt', 'holdBy', 'holdReason', 'deletedVersions', 'uuid', 'displayId', 'productCode', 'episodeNumber', 'idScheme'];
  function freeEpisodeId(srcId) {
    const base = srcId.replace(/-C\d+$/, '').slice(0, 34);
    for (let n = 1; n < 1000; n += 1) { const cand = `${base}-C${n}`; if (!store.episodes.exists(cand)) return cand; }
    throw new StudioError('NO_ID', '새 에피소드 ID를 만들 수 없습니다.');
  }
  /** Independent copy of an episode's script (scenes, dialogue, CTA). Approvals, prompts, images, clips, voices and renders are NOT copied. */
  async function duplicateEpisode(srcId, { newId, title, by = 'operator' } = {}) {
    const src = store.episodes.get(srcId);
    // A copy is a NEW episode: with the product-based scheme it takes the next number of the product (never a reused one).
    const scheme = !newId && src.productCode && src.productId && episodeIds;
    const id = scheme ? 'PENDING' : (newId || freeEpisodeId(srcId));
    if (!scheme && !ID_OK.test(id)) throw new StudioError('BAD_ID', '에피소드 ID 형식이 올바르지 않습니다.');
    if (!scheme && store.episodes.exists(id)) throw new StudioError('DUPLICATE', '이미 있는 에피소드 ID입니다: ' + id, { status: 409 });
    const makeSeed = (ids) => {
    const id = ids ? ids.id : newId || freeEpisodeId(srcId);
    const seed = clone(src);
    RUNTIME_KEYS.forEach((k) => delete seed[k]);
    Object.assign(seed, { id, reelId: id, title: String(title || '').trim() || `${src.title} (복제)`, projectId: projectIdFor(src), duplicatedFrom: { episodeId: srcId, scriptVersion: src.version || 0, at: nowIso(), by } });
    seed.publishing = { keyword: (src.publishing || {}).keyword || '', affiliateUrl: (src.publishing || {}).affiliateUrl || '', disclosure: (src.publishing || {}).disclosure || '' };
    seed.scenes = seed.scenes.map((s) => { const c = clone(s); delete c.startImage; c.origin = { type: 'episode', episodeId: srcId, sceneId: s.id, linked: false, copiedAt: nowIso() }; return c; });
    return seed;
    };
    let newEpId = id;
    if (scheme) newEpId = episodeIds.createEpisode({ productId: src.productId, category: src.category || 'drama', buildSeed: makeSeed }).id;
    else store.episodes.create(makeSeed(null));
    await store.episodes.update(newEpId, () => {}, { snapshot: true, by, note: `복제본 (원본 ${srcId})` });
    store.episodes.audit(newEpId, 'episode.duplicated', { from: srcId, by });
    return newEpId;
  }

  // ---------- scene copy / templates ----------
  const nextSceneId = (ep, prefix = 'S') => { const used = new Set(ep.scenes.map((s) => s.id)); let n = ep.scenes.length + 1; while (used.has(prefix + n)) n += 1; return prefix + n; };
  const nextLineId = (ep, taken) => { let max = 0; ep.lines.concat(taken).forEach((l) => { const m = /^L(\d+)/.exec(l.id); if (m) max = Math.max(max, Number(m[1])); }); return 'L' + (max + 1); };

  /** Inserts a copied scene (+dialogue) into an episode. */
  function insertScene(ep, content, origin, { beatKey } = {}) {
    const structured = F.isStructured(ep);
    let key = '';
    if (structured) {
      key = beatKey || content.scene.beatKey;
      if (!F.BEAT_KEYS.includes(key)) throw new StudioError('BAD_BEAT', '이 에피소드는 고정 포맷입니다. 복사할 PART A 단계(beat)를 선택하세요.', { status: 422 });
    }
    const id = nextSceneId(ep, 'S');
    const sc = Object.assign({}, clone(content.scene), { id, part: structured ? 'A' : '', beatKey: structured ? key : '', title_ko: content.scene.title_ko || '', title: content.scene.title_ko || '', origin, manualEdit: true });
    delete sc.startImage;
    if (structured) {
      let at = -1;
      ep.scenes.forEach((s, i) => { if (s.part === 'A' && F.BEAT_KEYS.indexOf(s.beatKey) <= F.BEAT_KEYS.indexOf(key)) at = i; });
      ep.scenes.splice(at + 1, 0, sc);
    } else ep.scenes.push(sc);
    const added = [];
    content.lines.forEach((l) => { const lid = nextLineId(ep, added); const nl = { id: lid, sceneId: id, speaker: l.speaker, en: l.en, ko: l.ko, edited: true }; ep.lines.push(nl); added.push(nl); });
    if (structured) F.syncBeats(ep);
    return id;
  }

  async function copyScene(fromId, sceneId, toId, { beatKey, by = 'operator' } = {}) {
    const src = store.episodes.get(fromId);
    if (!src.scenes.some((s) => s.id === sceneId)) throw new StudioError('NOT_FOUND', '복사할 장면을 찾을 수 없습니다.', { status: 404 });
    const content = SA.sceneSnapshot(src, sceneId);
    const rev = ((src.sceneApprovals || {})[sceneId] || {}).current;
    let newId;
    await store.episodes.update(toId, (ep) => {
      newId = insertScene(ep, content, { type: 'scene', episodeId: fromId, sceneId, sourceRevision: rev ? rev.rev : null, linked: false, copiedAt: nowIso() }, { beatKey });
    }, { snapshot: true, by, note: `씬 복사 (${fromId}/${sceneId})` });
    store.episodes.audit(toId, 'scene.copied', { from: `${fromId}/${sceneId}`, to: newId, by });
    return { sceneId: newId };
  }

  const readTemplates = () => readJson(templatesFile, { schema: 1, templates: {} });
  const tplView = (t) => ({ id: t.id, name: t.name, current: t.current, part: t.versions[t.versions.length - 1].scene.part || '', beatKey: t.versions[t.versions.length - 1].scene.beatKey || '', titleKo: t.versions[t.versions.length - 1].scene.title_ko, source: t.source || null, versions: t.versions.map((v) => ({ v: v.v, at: v.at, by: v.by })), lines: t.versions[t.versions.length - 1].lines.length });
  const templates = {
    list: () => Object.values(readTemplates().templates).map(tplView),
    get(id) { const t = readTemplates().templates[id]; if (!t) throw new StudioError('NOT_FOUND', '씬 템플릿을 찾을 수 없습니다.', { status: 404 }); return t; },
  };
  async function saveTemplate(epId, sceneId, { name, templateId, by = 'operator' } = {}) {
    const ep = store.episodes.get(epId);
    if (!ep.scenes.some((s) => s.id === sceneId)) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
    const content = SA.sceneSnapshot(ep, sceneId);
    const d = readTemplates();
    const at = nowIso();
    let t = templateId && d.templates[templateId];
    if (templateId && !t) throw new StudioError('NOT_FOUND', '씬 템플릿을 찾을 수 없습니다.', { status: 404 });
    if (!t) {
      const nm = String(name || '').trim() || `${sceneTitle(ep.scenes.find((s) => s.id === sceneId)) || sceneId} 템플릿`;
      let id = 'TPL-' + sha256(nm + at).slice(0, 8);
      t = d.templates[id] = { id, name: nm.slice(0, 80), createdAt: at, current: 0, versions: [], source: { episodeId: epId, sceneId } };
    }
    const v = t.versions.length + 1;
    t.versions.push({ v, at, by, scene: content.scene, lines: content.lines.map((l) => ({ speaker: l.speaker, en: l.en, ko: l.ko })) });
    t.current = v;
    writeJsonAtomic(templatesFile, d);
    store.episodes.audit(epId, 'scene.template_saved', { sceneId, templateId: t.id, version: v, by });
    return tplView(t);
  }
  /** Applies a template as an independent copy; linked:true is an explicit choice that keeps a link (updates are manual, never automatic). */
  async function applyTemplate(templateId, epId, { linked = false, beatKey, by = 'operator' } = {}) {
    const t = templates.get(templateId);
    const cur = t.versions[t.versions.length - 1];
    let newId;
    await store.episodes.update(epId, (ep) => {
      newId = insertScene(ep, { scene: cur.scene, lines: cur.lines }, { type: 'template', templateId, templateVersion: cur.v, linked: !!linked, copiedAt: nowIso() }, { beatKey });
    }, { snapshot: true, by, note: `씬 템플릿 적용 (${t.name} v${cur.v}${linked ? ', 링크' : ''})` });
    store.episodes.audit(epId, 'scene.template_applied', { templateId, version: cur.v, linked: !!linked, sceneId: newId, by });
    return { sceneId: newId };
  }
  /** Pulls the newest template version into a LINKED scene (explicit; the scene becomes a new revision that needs approval again). */
  async function syncLinkedScene(epId, sceneId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      const s = ep.scenes.find((x) => x.id === sceneId);
      if (!s || !s.origin || s.origin.type !== 'template' || !s.origin.linked) throw new StudioError('NOT_LINKED', '링크된 템플릿 씬이 아닙니다. (복사본은 원본과 독립적입니다.)', { status: 409 });
      const t = templates.get(s.origin.templateId);
      const cur = t.versions[t.versions.length - 1];
      if (cur.v === s.origin.templateVersion) throw new StudioError('UP_TO_DATE', '이미 최신 버전입니다.', { status: 409 });
      Object.assign(s, clone(cur.scene), { id: s.id, part: s.part, beatKey: s.beatKey, title: cur.scene.title_ko, origin: Object.assign({}, s.origin, { templateVersion: cur.v, syncedAt: nowIso() }) });
      ep.lines = ep.lines.filter((l) => l.sceneId !== sceneId);
      const added = [];
      cur.lines.forEach((l) => { const nl = { id: nextLineId(ep, added), sceneId, speaker: l.speaker, en: l.en, ko: l.ko, edited: true }; ep.lines.push(nl); added.push(nl); });
      if (F.isStructured(ep)) F.syncBeats(ep);
    }, { snapshot: true, by, note: '링크된 템플릿 최신 버전 적용' });
    store.episodes.audit(epId, 'scene.template_synced', { sceneId, by });
  }
  /** For the UI: has the template of a linked scene moved on? */
  function sceneLinks(ep) {
    const reg = readTemplates().templates;
    const out = {};
    (ep.scenes || []).forEach((s) => {
      if (!s.origin) return;
      const o = s.origin;
      const t = o.type === 'template' ? reg[o.templateId] : null;
      out[s.id] = { type: o.type, linked: !!o.linked, episodeId: o.episodeId || '', sceneId: o.sceneId || '', templateId: o.templateId || '', templateName: t ? t.name : '', templateVersion: o.templateVersion || null, updateAvailable: !!(o.linked && t && t.current > o.templateVersion) };
    });
    return out;
  }

  return { hooks, migrateAll, listProjects, ensureProject, readiness, assertProjectReady, approveScene, revokeScene, approveReady, sceneHistory, handoff, handoffState, readSnapshot, duplicateEpisode, copyScene, templates, saveTemplate, applyTemplate, syncLinkedScene, sceneLinks };
}

module.exports = { createProjects };
