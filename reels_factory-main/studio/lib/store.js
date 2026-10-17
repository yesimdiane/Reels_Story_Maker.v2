// Persistent Studio state on disk (JSON + media files). Single process; read-modify-write per episode is
// serialised with an in-process queue and every write is atomic (temp file + rename). Nothing here is ever
// deleted automatically: clip, audio and render versions are kept.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic, writeFileAtomic, sha256, nowIso, StudioError, safeName } = require('./util');

const SEED_DIR = path.join(__dirname, '..', 'seed');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;

const DEFAULT_SETTINGS = {
  reelSpendLimitUsd: null, // null → use RF_REEL_SPEND_LIMIT_USD
  modelEstimates: {}, // { [modelId]: { usdByDuration: { "5": number, "10": number } } }  operator-entered; never invented
  voiceUsdPer1kChars: null, // operator-entered HeyGen estimate; null = unknown
  defaultModelId: 'kling-master',
  customModels: [], // operator-entered video models (endpoint + declared capabilities); never auto-discovered
  render: { font: '', fontSize: 60, burnDisclosure: false, previewWidth: 540 },
  // V2.3: AI routing / models / operator-entered prices / spend limits (UTC day & month). Keys are NOT here (encrypted vault).
  ai: { routing: {}, models: {}, pricing: {}, limits: { dailyUsd: null, monthlyUsd: null } },
  providers: { muapi: { mode: 'mock' }, heygen: { mode: 'mock' } },
};

function createStore({ dir, seedDir = SEED_DIR }) {
  fs.mkdirSync(dir, { recursive: true });
  const queues = new Map();
  const p = (...parts) => path.join(dir, ...parts);

  function checkId(id, what = 'ID') {
    if (!ID_RE.test(String(id))) throw new StudioError('BAD_ID', `${what} 형식이 올바르지 않습니다: ${id}`);
    return String(id);
  }

  // ---------- settings ----------
  const settings = {
    get() {
      const s = readJson(p('settings.json'), {});
      const ai = Object.assign({}, DEFAULT_SETTINGS.ai, s.ai || {}, { limits: Object.assign({}, DEFAULT_SETTINGS.ai.limits, (s.ai || {}).limits || {}) });
      const providers = Object.assign({}, DEFAULT_SETTINGS.providers, s.providers || {});
      return Object.assign({}, DEFAULT_SETTINGS, s, { render: Object.assign({}, DEFAULT_SETTINGS.render, s.render || {}), ai, providers });
    },
    save(patch) {
      const cur = settings.get();
      const next = Object.assign({}, cur, patch, { render: Object.assign({}, cur.render, (patch && patch.render) || {}) });
      writeJsonAtomic(p('settings.json'), next);
      return next;
    },
  };

  // ---------- model registry (read-only seed) ----------
  // seed models + operator-entered models (settings.customModels, verification 'user-entered'); both go through the same provider adapter
  const models = () => {
    const st = settings.get(), ver = st.modelVerification || {};
    // a stored confirmation / real-job verification raises the level; it never lowers it
    const lift = (m) => { const v = ver[m.id]; return v && ['user-entered', 'verified'].includes(v.level) && v.level !== m.verification && (m.verification !== 'verified') ? Object.assign({}, m, { verification: v.level, verifiedAt: v.at }) : m; };
    return readJson(path.join(seedDir, 'models.json'), { models: [] }).models.concat((st.customModels || []).map((m) => Object.assign({}, m, { custom: true }))).map(lift);
  };

  // ---------- characters ----------
  const characters = {
    load() {
      let c = readJson(p('characters.json'));
      if (!c) {
        c = readJson(path.join(seedDir, 'characters.json'));
        writeJsonAtomic(p('characters.json'), c);
      }
      // schema 2 (universes + richer profiles): additive, idempotent, never overwrites edited values
      if (!c.schema || c.schema < 2) { const m = require('./universes').migrate(c); if (m.changed) writeJsonAtomic(p('characters.json'), m.lib); c = m.lib; }
      return c;
    },
    save(c) {
      writeJsonAtomic(p('characters.json'), c);
      return c;
    },
    get(id) {
      const c = characters.load().characters.find((x) => x.id === id);
      if (!c) throw new StudioError('NOT_FOUND', '캐릭터를 찾을 수 없습니다: ' + id, { status: 404 });
      return c;
    },
    update(id, fn) {
      const lib = characters.load();
      const c = lib.characters.find((x) => x.id === id);
      if (!c) throw new StudioError('NOT_FOUND', '캐릭터를 찾을 수 없습니다: ' + id, { status: 404 });
      fn(c, lib);
      characters.save(lib);
      return c;
    },
    /** The character's chosen reference images, in order (first = primary). At most 3 PER CHARACTER; only approved, real images. Uploads that are not selected are kept untouched. */
    setReferenceSelection(charId, refIds) {
      if (!Array.isArray(refIds)) throw new StudioError('BAD_SELECTION', '참조 이미지 목록이 필요합니다.', { status: 400 });
      const ids = refIds.map(String);
      if (new Set(ids).size !== ids.length) throw new StudioError('BAD_SELECTION', '같은 이미지가 두 번 선택되었습니다.', { status: 400 });
      if (ids.length > 3) throw new StudioError('SELECTION_LIMIT', `캐릭터당 참조 이미지는 최대 3장까지 선택할 수 있습니다 (선택 ${ids.length}장). 다른 이미지를 먼저 선택 해제하세요.`, { status: 409 });
      return characters.update(charId, (c) => {
        ids.forEach((id) => {
          const r = c.references.find((x) => x.id === id);
          if (!r) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다: ' + id, { status: 404 });
          if (!r.approved || r.placeholder) throw new StudioError('REF_NOT_APPROVED', `승인된 실제 이미지만 선택할 수 있습니다 (${r.originalName || id}).`, { status: 409, recovery: '먼저 이미지를 승인하세요.' });
        });
        c.referenceSelection = ids;
      });
    },
    refPath(charId, ref) {
      return p('characters', checkId(charId), ref.file);
    },
    addReference(charId, { buffer, filename, mime, placeholder = false, label = '', isSheet }) {
      if (!buffer || !buffer.length) throw new StudioError('EMPTY_FILE', '빈 파일입니다.');
      if (buffer.length > 10 * 1024 * 1024) throw new StudioError('TOO_LARGE', '참조 이미지는 10 MB 이하여야 합니다 (Muapi 이미지 업로드 한도).');
      const ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[mime] || path.extname(filename || '').toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new StudioError('BAD_TYPE', 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다.');
      const hash = sha256(buffer);
      return characters.update(charId, (c) => {
        if (c.references.some((r) => r.sha256 === hash)) throw new StudioError('DUPLICATE', '이미 올려진 같은 이미지입니다.', { status: 409 });
        const id = 'ref_' + hash.slice(0, 10);
        const file = id + ext;
        writeFileAtomic(p('characters', charId, file), buffer);
        c.references.push({ id, file, originalName: safeName(filename), label: label || safeName(filename).replace(/\.[^.]+$/, ''), sha256: hash, size: buffer.length, approved: false, placeholder, isSheet: isSheet === undefined ? !placeholder : !!isSheet, uploadedAt: nowIso() });
      });
    },
    setReferenceApproved(charId, refId, approved, by = 'operator') {
      return characters.update(charId, (c) => {
        const r = c.references.find((x) => x.id === refId);
        if (!r) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다.', { status: 404 });
        r.approved = !!approved;
        if (!approved && Array.isArray(c.referenceSelection)) c.referenceSelection = c.referenceSelection.filter((x) => x !== refId);
        r.approvedBy = approved ? by : '';
        r.approvedAt = approved ? nowIso() : '';
      });
    },
    setReferenceKind(charId, refId, isSheet) {
      return characters.update(charId, (c) => {
        const r = c.references.find((x) => x.id === refId);
        if (!r) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다.', { status: 404 });
        r.isSheet = !!isSheet;
      });
    },
    removeReference(charId, refId) {
      return characters.update(charId, (c) => {
        const i = c.references.findIndex((x) => x.id === refId);
        if (i < 0) throw new StudioError('NOT_FOUND', '참조 이미지를 찾을 수 없습니다.', { status: 404 });
        // The file stays on disk (nothing is deleted); only the library entry is removed.
        c.references.splice(i, 1);
        if (Array.isArray(c.referenceSelection)) c.referenceSelection = c.referenceSelection.filter((x) => x !== refId);
      });
    },
  };

  // ---------- episodes ----------
  const epDir = (id) => p('episodes', checkId(id, '에피소드 ID'));
  const epFile = (id) => path.join(epDir(id), 'episode.json');

  function emptyEpisode(seed) {
    return Object.assign(
      {
        status: 'draft',
        version: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        approvals: { script: null, storyboard: null, final: null },
        prompts: {},
        clips: {},
        generation: { authorizations: [], jobs: [] },
        spend: [],
        voice: { lines: {} },
        renders: [],
        sfx: [],
        spendLimitUsd: null,
        publishing: {},
      },
      seed
    );
  }

  const episodes = {
    /** Optional observers of every episode write (before/after the mutation); the Studio uses them to track scene-approval changes. */
    hooks: { before: null, after: null },
    exists: (id) => fs.existsSync(epFile(id)),
    /** Active episodes. `{ all: true }` also returns trashed ones (spend history, id uniqueness); `{ trashed: true }` only those. */
    list({ all = false, trashed = false } = {}) {
      const root = p('episodes');
      if (!fs.existsSync(root)) return [];
      return fs
        .readdirSync(root)
        .map((id) => readJson(path.join(root, id, 'episode.json')))
        .filter(Boolean)
        .filter((e) => all || (trashed ? !!e.trashedAt : !e.trashedAt))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    },
    get(id) {
      const ep = readJson(epFile(id));
      if (!ep) throw new StudioError('NOT_FOUND', '에피소드를 찾을 수 없습니다: ' + id, { status: 404 });
      return ep;
    },
    create(seed) {
      checkId(seed.id, '에피소드 ID');
      if (episodes.exists(seed.id)) throw new StudioError('DUPLICATE', '이미 있는 에피소드 ID입니다: ' + seed.id, { status: 409 });
      const ep = emptyEpisode(seed);
      writeJsonAtomic(epFile(ep.id), ep);
      episodes.audit(ep.id, 'created', { title: ep.title });
      return ep;
    },
    /** Loads Episode 01 (demo content) the first time the Studio starts. Never overwrites an existing episode. */
    seedDemo() {
      const seed = readJson(path.join(seedDir, 'episode-01.json'));
      if (seed && !episodes.exists(seed.id)) return episodes.create(seed);
      return null;
    },
    /**
     * Serialised read-modify-write. fn(ep) may mutate and return nothing, or throw (nothing is written).
     * opts.snapshot: store a numbered version file of the script/storyboard content (version history).
     */
    update(id, fn, opts = {}) {
      const prev = queues.get(id) || Promise.resolve();
      const run = prev.then(() => {
        const ep = episodes.get(id);
        const pre = episodes.hooks.before ? episodes.hooks.before(ep) : undefined;
        const out = fn(ep);
        if (episodes.hooks.after) episodes.hooks.after(ep, pre);
        ep.updatedAt = nowIso();
        if (opts.snapshot) {
          ep.version = (ep.version || 0) + 1;
          writeJsonAtomic(path.join(epDir(id), 'versions', 'v' + String(ep.version).padStart(4, '0') + '.json'), {
            version: ep.version,
            at: ep.updatedAt,
            by: opts.by || 'operator',
            note: opts.note || '',
            title: ep.title,
            scenes: ep.scenes,
            lines: ep.lines,
            cta: ep.cta,
            beats: ep.beats,
            publishing: ep.publishing,
          });
        }
        writeJsonAtomic(epFile(id), ep);
        return out === undefined ? ep : out;
      });
      queues.set(id, run.catch(() => {}));
      return run;
    },
    versions(id) {
      const d = path.join(epDir(id), 'versions');
      if (!fs.existsSync(d)) return [];
      return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => {
        const v = readJson(path.join(d, f));
        return { version: v.version, at: v.at, by: v.by, note: v.note, lines: (v.lines || []).length, scenes: (v.scenes || []).length };
      });
    },
    version(id, n) {
      const v = readJson(path.join(epDir(id), 'versions', 'v' + String(n).padStart(4, '0') + '.json'));
      if (!v) throw new StudioError('NOT_FOUND', '해당 버전이 없습니다: v' + n, { status: 404 });
      return v;
    },
    audit(id, event, data = {}) {
      fs.mkdirSync(epDir(id), { recursive: true });
      fs.appendFileSync(path.join(epDir(id), 'audit.jsonl'), JSON.stringify({ at: nowIso(), event, ...data }) + '\n');
    },
    auditLog(id, limit = 200) {
      const f = path.join(epDir(id), 'audit.jsonl');
      if (!fs.existsSync(f)) return [];
      return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l)).reverse();
    },
    file: (id, ...parts) => path.join(epDir(id), ...parts),
    saveFile(id, rel, buffer) {
      const f = path.join(epDir(id), rel);
      if (!f.startsWith(epDir(id) + path.sep)) throw new StudioError('BAD_PATH', '잘못된 경로입니다.');
      writeFileAtomic(f, buffer);
      return f;
    },
  };

  return { dir, settings, characters, episodes, models, cachePath: (...parts) => p('cache', ...parts), path: p };
}

module.exports = { createStore, DEFAULT_SETTINGS, SEED_DIR };
