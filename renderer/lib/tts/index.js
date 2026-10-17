// TTS orchestration: sentence segmentation, content-addressed cache, cost estimate and budget guard.
// The budget is checked BEFORE any request; cached sentences are never paid for twice.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseWav } = require('../wav');

// USD per 1M characters by voice family. Approximate — verify at cloud.google.com/text-to-speech/pricing and heygen.com.
const PRICE_PER_MILLION = { Standard: 4, Wavenet: 4, Neural2: 16, 'Chirp3-HD': 30, Studio: 160, HeyGen: 150 };

function voiceFamily(voice, providerName) {
  if (providerName === 'heygen') return 'HeyGen';
  if (voice && (/^[0-9a-f]{32}$/i.test(voice) || String(voice).startsWith('heygen_') || String(voice).length > 25)) return 'HeyGen';
  const m = /^[a-z]{2}-[A-Z]{2}-(Standard|Wavenet|Neural2|Chirp3-HD|Studio)/.exec(voice || '');
  return m ? m[1] : 'Unknown';
}

class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetError';
  }
}

/** Splits narration into sentences (each one TTS request and one subtitle block). */
function splitNarration(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Google bills every character including spaces. */
function billedChars(text) {
  return [...text].length;
}

// Exclusive lock files ('wx' fails if the file exists). A lock older than staleMs is from a crashed run.
const LOCK_STALE_MS = 5 * 60 * 1000;
function tryLock(lockFile, staleMs) {
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - fs.statSync(lockFile).mtimeMs > staleMs) fs.rmSync(lockFile, { force: true });
    } catch {}
    return false;
  }
}
function withLockSync(lockFile, fn, staleMs = 10000) {
  const until = Date.now() + 15000;
  while (!tryLock(lockFile, staleMs)) {
    if (Date.now() > until) throw new Error('사용량 기록 잠금을 얻지 못했습니다: ' + lockFile);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}
/** Waits for the lock (or until done() — another process produced the result). Returns release(). */
async function acquireLock(lockFile, done, { staleMs = LOCK_STALE_MS, pollMs = 200 } = {}) {
  while (!tryLock(lockFile, staleMs)) {
    if (done()) return () => {};
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return () => fs.rmSync(lockFile, { force: true });
}

function createTtsService({ provider, voice, language = 'ko', speakingRate = 1.0, cacheDir, ledgerFile, maxCharsPerJob = 1500, monthlyCharLimit = 500000, now = () => new Date() }) {
  // rate: per-line speaking rate from Gemini's production plan (default: the configured rate). A different
  // rate is a different recording, so it is part of the cache key.
  const keyOf = (text, rate = speakingRate) =>
    // Korean (the original workflow) keeps its original key so existing caches stay valid; other languages are keyed apart.
    crypto.createHash('sha256').update(JSON.stringify(language === 'ko' ? { p: provider.name, voice, speakingRate: rate, text } : { p: provider.name, voice, speakingRate: rate, text, l: language })).digest('hex');
  const cachePath = (text, rate) => path.join(cacheDir, keyOf(text, rate) + '.wav');
  const month = () => now().toISOString().slice(0, 7);

  function readLedger() {
    try {
      return JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    } catch {
      return {};
    }
  }
  /**
   * Local ledger: counts every request SENT to a paid provider (retries included), before the answer
   * arrives, so an interrupted run can only over-count. It is a local safety cap, not Google's bill.
   * Written atomically under a lock so parallel renders do not lose updates.
   */
  function addUsage(chars) {
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    withLockSync(ledgerFile + '.lock', () => {
      const l = readLedger();
      const m = month();
      l[m] = l[m] || { chars: 0, requests: 0 };
      l[m].chars += chars;
      l[m].requests += 1;
      fs.writeFileSync(ledgerFile + '.tmp', JSON.stringify(l, null, 2));
      fs.renameSync(ledgerFile + '.tmp', ledgerFile);
    });
  }

  /** What a render would cost, without calling anything. */
  function estimate(segments, rates = []) {
    const uncached = segments.filter((s, i) => !fs.existsSync(cachePath(s, rates[i])));
    const chars = uncached.reduce((n, s) => n + billedChars(s), 0);
    const family = voiceFamily(voice, provider.name);
    const price = PRICE_PER_MILLION[family];
    const usedThisMonth = (readLedger()[month()] || {}).chars || 0;
    return {
      provider: provider.name,
      paid: provider.paid,
      voice,
      voiceFamily: family,
      segments: segments.length,
      cachedSegments: segments.length - uncached.length,
      billableChars: provider.paid ? chars : 0,
      estimatedUsd: provider.paid && price != null ? (chars / 1e6) * price : 0,
      usedThisMonth,
      monthlyCharLimit,
    };
  }

  function assertBudget(est) {
    if (!provider.paid) return;
    if (est.billableChars > maxCharsPerJob) {
      throw new BudgetError('이 작업의 TTS 글자 수(' + est.billableChars + ')가 작업당 한도 RF_TTS_MAX_CHARS_PER_JOB(' + maxCharsPerJob + ')를 넘습니다.');
    }
    if (est.usedThisMonth + est.billableChars > monthlyCharLimit) {
      throw new BudgetError('이번 달 TTS 사용량 한도 RF_TTS_MONTHLY_CHAR_LIMIT(' + monthlyCharLimit + ')를 넘게 됩니다 (사용 ' + est.usedThisMonth + ' + 이번 ' + est.billableChars + ').');
    }
  }

  /**
   * Returns [{ text, file, duration, cached }] in order. Checks the budget first.
   * Each line is cached as soon as it arrives, so an interrupted or failed run pays again only for the
   * lines it never received. A per-line lock stops two renders (e.g. a watch pass and a manual run)
   * from requesting the same line at the same time; the second one waits and reuses the cached file.
   */
  async function synthesizeAll(segments, rates = []) {
    assertBudget(estimate(segments, rates));
    fs.mkdirSync(cacheDir, { recursive: true });
    const out = [];
    for (const [i, text] of segments.entries()) {
      const rate = rates[i] == null ? speakingRate : rates[i];
      const file = cachePath(text, rate);
      let cached = true;
      if (!fs.existsSync(file)) {
        const release = await acquireLock(file + '.lock', () => fs.existsSync(file));
        try {
          if (!fs.existsSync(file)) {
            cached = false;
            const attempt = () => {
              if (!provider.paid) return;
              const used = (readLedger()[month()] || {}).chars || 0;
              if (used + billedChars(text) > monthlyCharLimit) {
                throw new BudgetError('이번 달 TTS 사용량 한도 RF_TTS_MONTHLY_CHAR_LIMIT(' + monthlyCharLimit + ')에 도달했습니다 (재시도 포함 사용 ' + used + ').');
              }
              addUsage(billedChars(text));
            };
            // Counted before the request is sent. Providers that retry (Google) report each attempt.
            if (!provider.reportsAttempts) attempt();
            const audio = await provider.synthesize({ text, voice, language, speakingRate: rate, onAttempt: provider.reportsAttempts ? attempt : undefined });
            parseWav(audio); // validate before caching
            fs.writeFileSync(file + '.tmp', audio);
            fs.renameSync(file + '.tmp', file);
          }
        } finally {
          release();
        }
      }
      out.push({ text, file, duration: parseWav(fs.readFileSync(file)).duration, cached, rate });
    }
    return out;
  }

  /** Duration of an already-cached line (free), or null. */
  function cachedDuration(text, rate) {
    const f = cachePath(text, rate);
    try {
      return parseWav(fs.readFileSync(f)).duration;
    } catch {
      return null;
    }
  }

  return { estimate, synthesizeAll, cachePath, cachedDuration };
}

module.exports = { createTtsService, splitNarration, billedChars, voiceFamily, BudgetError, PRICE_PER_MILLION };
