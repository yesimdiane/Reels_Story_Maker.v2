// Episode IDs:  {PRODUCT_CODE}-{NN}-{CATEGORY}   e.g. UMB-01-D   (D = Drama, V = Viral, I = Information)
//   * the number is per PRODUCT, sequential from 01, whatever the category, and is allocated only when the Episode file is really created;
//   * allocation + creation happen in one synchronous section under a cross-process lock, so concurrent approvals, retries or a second
//     server process can never hand out the same number; a failed creation leaves the counter untouched;
//   * numbers are never reused (the counter only grows and trashed / archived episodes still count);
//   * the ID never changes afterwards: the current category is stored separately (ep.category), revisions keep the same ID;
//   * ep.uuid is an immutable internal key; the readable ID is the unique display identifier (ep.displayId).
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { StudioError, nowIso, readJson, writeJsonAtomic } = require('./util');

const CATEGORY_CODE = { drama: 'D', viral: 'V', info: 'I' };
const CODE_CATEGORY = { D: 'drama', V: 'viral', I: 'info' };
const ID_RE = /^([A-Z][A-Z0-9]{1,4})-(\d{2,})-([DVI])$/;
const pad = (n) => String(n).padStart(2, '0');
const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { const t = Date.now() + ms; while (Date.now() < t) { /* spin */ } } };

function createEpisodeIds({ store, products }) {
  const stateFile = () => store.path('episode-ids.json');
  const lockFile = () => store.path('episode-ids.lock');
  const readState = () => readJson(stateFile(), { products: {}, requests: {} });

  /** Cross-process mutex (exclusive-create lock file; a lock older than 15 s is considered abandoned). */
  function withLock(fn) {
    fs.mkdirSync(require('node:path').dirname(lockFile()), { recursive: true });
    const started = Date.now();
    let fd = null;
    for (;;) {
      try { fd = fs.openSync(lockFile(), 'wx'); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(lockFile()).mtimeMs > 15000) { fs.unlinkSync(lockFile()); continue; } } catch (_) { continue; }
        if (Date.now() - started > 10000) throw new StudioError('ID_LOCK_TIMEOUT', '에피소드 ID 발급이 잠겨 있습니다. 잠시 후 다시 시도하세요.', { status: 503 });
        sleepMs(15);
      }
    }
    try { return fn(); } finally { try { fs.closeSync(fd); } catch (_) { /* */ } try { fs.unlinkSync(lockFile()); } catch (_) { /* */ } }
  }

  /** Highest number already used for a product code: the counter file AND every episode on disk (trashed and archived included). */
  function highestUsed(code, state) {
    let max = (state.products[code] && state.products[code].last) || 0;
    store.episodes.list({ all: true }).forEach((e) => { const m = ID_RE.exec(String(e.id)); if (m && m[1] === code) max = Math.max(max, Number(m[2])); });
    return max;
  }

  /**
   * Allocates the next number for the product and creates the episode, atomically.
   * buildSeed({ id, uuid, productCode, number, category }) returns the episode seed (it may throw: nothing is allocated then).
   * requestKey makes a retry idempotent: the same key returns the episode it already created.
   */
  function createEpisode({ productId, category = 'drama', requestKey = '', buildSeed }) {
    const cat = CATEGORY_CODE[category] ? category : 'drama';
    return withLock(() => {
      const state = readState();
      if (requestKey && state.requests[requestKey]) {
        const id = state.requests[requestKey];
        if (store.episodes.exists(id)) return { id, reused: true };
      }
      const code = String((products.raw(productId) || {}).code || '').toUpperCase();
      if (!code) throw new StudioError('PRODUCT_CODE_REQUIRED', '제품 코드가 없어 에피소드 ID를 만들 수 없습니다.', { status: 422, recovery: '제품 스튜디오에서 제품 코드(예: UMB)를 정한 뒤 다시 시도하세요.' });
      let number = highestUsed(code, state) + 1;
      let id = `${code}-${pad(number)}-${CATEGORY_CODE[cat]}`;
      while (store.episodes.exists(id)) { number += 1; id = `${code}-${pad(number)}-${CATEGORY_CODE[cat]}`; }
      const uuid = crypto.randomUUID();
      const seed = buildSeed({ id, uuid, productCode: code, number, category: cat });
      Object.assign(seed, { id, uuid, displayId: id, productCode: code, episodeNumber: number, category: cat, idScheme: 'v2' });
      store.episodes.create(seed); // throws → nothing below runs, the counter is untouched
      const entry = state.products[code] || { last: 0, allocations: [] };
      entry.last = number;
      entry.allocations.push({ number, id, uuid, category: cat, productId, requestKey: requestKey || null, at: nowIso() });
      state.products[code] = entry;
      if (requestKey) state.requests[requestKey] = id;
      writeJsonAtomic(stateFile(), state);
      products.lockCodeSync(productId);
      return { id, uuid, number, reused: false };
    });
  }

  /** Startup migration: every existing episode gets an immutable uuid and a display ID; no identifier is renamed. Idempotent. */
  function migrate() {
    const done = [];
    store.episodes.list({ all: true }).forEach((e) => {
      if (e.uuid && e.displayId) return;
      const ep = JSON.parse(JSON.stringify(e));
      if (!ep.uuid) ep.uuid = crypto.randomUUID();
      if (!ep.displayId) ep.displayId = ep.id; // legacy ids (EP01, PRD-002-R02 …) are shown as they are
      if (!ep.idScheme) ep.idScheme = ID_RE.test(String(ep.id)) ? 'v2' : 'legacy';
      writeJsonAtomic(store.episodes.file(e.id, 'episode.json'), ep);
      done.push(e.id);
    });
    return done;
  }

  /** The episode a previous request (same idempotency key) already created, if it still exists. */
  const byRequest = (key) => { if (!key) return null; const id = readState().requests[key]; return id && store.episodes.exists(id) ? id : null; };
  const parse = (id) => { const m = ID_RE.exec(String(id)); return m ? { productCode: m[1], number: Number(m[2]), categoryCode: m[3], category: CODE_CATEGORY[m[3]] } : null; };
  return { createEpisode, migrate, byRequest, parse, withLock, highestUsed };
}

module.exports = { createEpisodeIds, CATEGORY_CODE, CODE_CATEGORY, ID_RE };
