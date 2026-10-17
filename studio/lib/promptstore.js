// Prompt Manager storage: every generation prompt is versioned. Results record which prompt version produced them.
// Defaults live in seed/prompts.json (restorable as a new version); edits never overwrite history.
'use strict';
const path = require('node:path');
const { StudioError, nowIso, readJson, writeJsonAtomic } = require('./util');

const KEYS = ['storyConcept', 'script', 'storyboard', 'videoMaster', 'characterConsistency', 'productAccuracy', 'ctaAffiliate'];
// Which supporting prompts are appended to each task (so one edit of e.g. productAccuracy affects every task).
const COMPOSE = {
  storyConcept: ['storyConcept', 'characterConsistency', 'productAccuracy', 'ctaAffiliate'],
  script: ['script', 'characterConsistency', 'productAccuracy', 'ctaAffiliate'],
  storyboard: ['storyboard', 'videoMaster', 'characterConsistency', 'productAccuracy'],
};

function renderTemplate(text, vars) {
  return String(text).replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

function createPromptStore({ store, seedDir }) {
  const file = store.path('prompts.json');
  const seed = () => readJson(path.join(seedDir, 'prompts.json'));
  const read = () => {
    let d = readJson(file);
    if (!d) {
      const s = seed();
      d = { channel: s.channel, prompts: {}, updatedAt: nowIso() };
      KEYS.forEach((k) => {
        d.prompts[k] = { versions: [{ v: 1, text: s.prompts[k].text, at: nowIso(), by: 'default', note: '기본값', default: true }], current: 1, provider: '', model: '' };
      });
      writeJsonAtomic(file, d);
    }
    // prompts added in later releases are added as their default (v1); nothing existing is changed
    const missing = KEYS.filter((k) => !d.prompts[k]);
    if (missing.length) {
      const s = seed();
      missing.forEach((k) => { d.prompts[k] = { versions: [{ v: 1, text: s.prompts[k].text, at: nowIso(), by: 'default', note: '기본값', default: true }], current: 1, provider: '', model: '' }; });
      d.updatedAt = nowIso();
      writeJsonAtomic(file, d);
    }
    // An UNEDITED default whose text is older than the shipped default is upgraded as a NEW version (history kept; edited prompts are never touched).
    let upgraded = false;
    KEYS.forEach((k) => {
      const e = d.prompts[k];
      const cur = e && e.versions.find((x) => x.v === e.current);
      const sd = seed().prompts[k];
      if (cur && cur.default && sd && cur.text !== sd.text) {
        const v = Math.max(...e.versions.map((x) => x.v)) + 1;
        e.versions.push({ v, text: sd.text, at: nowIso(), by: 'default', note: '기본값 업데이트', default: true });
        e.current = v;
        upgraded = true;
      }
    });
    if (upgraded) { d.updatedAt = nowIso(); writeJsonAtomic(file, d); }
    return d;
  };
  const meta = (k) => seed().prompts[k];

  function view(k, d = read()) {
    const p = d.prompts[k];
    if (!p) throw new StudioError('NOT_FOUND', '알 수 없는 프롬프트: ' + k, { status: 404 });
    const cur = p.versions.find((x) => x.v === p.current);
    return { key: k, title: meta(k).title, description: meta(k).description, current: p.current, text: cur.text, provider: p.provider || '', model: p.model || '', versions: p.versions.map((x) => ({ v: x.v, at: x.at, by: x.by, note: x.note, default: !!x.default, chars: x.text.length })), isDefault: !!cur.default };
  }

  return {
    keys: KEYS,
    list() {
      const d = read();
      return KEYS.map((k) => view(k, d));
    },
    channel: () => read().channel,
    saveChannel(patch) {
      const d = read();
      ['name', 'audience', 'branding'].forEach((k) => patch[k] !== undefined && (d.channel[k] = String(patch[k]).slice(0, 1000)));
      d.updatedAt = nowIso();
      writeJsonAtomic(file, d);
      return d.channel;
    },
    get: (k) => view(k),
    versionText(k, v) {
      const p = read().prompts[k];
      const x = p && p.versions.find((y) => y.v === Number(v));
      if (!x) throw new StudioError('NOT_FOUND', '프롬프트 버전을 찾을 수 없습니다.', { status: 404 });
      return x.text;
    },
    save(k, { text, note = '', by = 'operator', provider, model }) {
      if (!KEYS.includes(k)) throw new StudioError('NOT_FOUND', '알 수 없는 프롬프트: ' + k, { status: 404 });
      const t = String(text || '');
      if (t.trim().length < 20) throw new StudioError('PROMPT_TOO_SHORT', '프롬프트가 너무 짧습니다 (20자 이상).');
      if (t.length > 20000) throw new StudioError('PROMPT_TOO_LONG', '프롬프트가 너무 깁니다 (20,000자 이하).');
      const d = read();
      const p = d.prompts[k];
      const cur = p.versions.find((x) => x.v === p.current);
      if (cur.text === t && provider === undefined && model === undefined) return view(k, d); // no-op: no empty versions
      if (cur.text !== t) {
        const v = Math.max(...p.versions.map((x) => x.v)) + 1;
        p.versions.push({ v, text: t, at: nowIso(), by, note: String(note).slice(0, 200) });
        p.current = v;
      }
      if (provider !== undefined) p.provider = String(provider);
      if (model !== undefined) p.model = String(model);
      d.updatedAt = nowIso();
      writeJsonAtomic(file, d);
      return view(k, d);
    },
    /** Restoring a default or an old version creates a NEW version (history is never rewritten). */
    restore(k, { version, toDefault = false, by = 'operator' }) {
      const d = read();
      const p = d.prompts[k];
      if (!p) throw new StudioError('NOT_FOUND', '알 수 없는 프롬프트: ' + k, { status: 404 });
      const text = toDefault ? seed().prompts[k].text : (p.versions.find((x) => x.v === Number(version)) || {}).text;
      if (!text) throw new StudioError('NOT_FOUND', '복원할 버전을 찾을 수 없습니다.', { status: 404 });
      const v = Math.max(...p.versions.map((x) => x.v)) + 1;
      p.versions.push({ v, text, at: nowIso(), by, note: toDefault ? '기본값으로 복원' : `v${version} 복원`, default: !!toDefault });
      p.current = v;
      d.updatedAt = nowIso();
      writeJsonAtomic(file, d);
      return view(k, d);
    },
    /**
     * Builds the final instruction for a task from the CURRENT versions of the prompts it uses.
     * Returns { text, versions: { storyConcept: 3, ... } } — the versions are stored with every result.
     */
    compose(task, vars = {}) {
      const d = read();
      const keys = COMPOSE[task];
      if (!keys) throw new StudioError('BAD_TASK', '알 수 없는 작업: ' + task);
      const all = Object.assign({ CHANNEL: d.channel.name, AUDIENCE: d.channel.audience, BRANDING: d.channel.branding, EXTRA: '' }, vars);
      const versions = {};
      const parts = keys.map((k) => {
        const p = d.prompts[k];
        versions[k] = p.current;
        return renderTemplate(p.versions.find((x) => x.v === p.current).text, all);
      });
      return { text: parts.join('\n\n'), versions, primaryKey: keys[0], providerOverride: d.prompts[keys[0]].provider ? { provider: d.prompts[keys[0]].provider, model: d.prompts[keys[0]].model } : null };
    },
    preview(k, vars = {}) {
      const d = read();
      const p = d.prompts[k];
      if (!p) throw new StudioError('NOT_FOUND', '알 수 없는 프롬프트: ' + k, { status: 404 });
      const sample = Object.assign({ CHANNEL: d.channel.name, AUDIENCE: d.channel.audience, BRANDING: d.channel.branding, COUNT: 3, EXTRA: '', PRODUCT_NAME: '(제품명 예시)' }, vars);
      return renderTemplate(p.versions.find((x) => x.v === p.current).text, sample);
    },
  };
}

module.exports = { createPromptStore, renderTemplate, KEYS, COMPOSE };
