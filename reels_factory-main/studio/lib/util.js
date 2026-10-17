// Small shared helpers for the Studio: hashing, atomic JSON writes, ids, sleeping.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sha256File = (file) => sha256(fs.readFileSync(file));
const uid = (prefix) => prefix + '_' + crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error('JSON을 읽을 수 없습니다: ' + file + ' (' + e.message + ')');
  }
}
function writeFileAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** Stable JSON (sorted keys) so equal data always hashes equally. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Safe file name: keeps Hangul/letters/digits, drops path separators and control characters. */
function safeName(name, fallback = 'file') {
  const base = path.basename(String(name || '')).replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim();
  return (base || fallback).slice(0, 120);
}

class StudioError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.status = extra.status || 400;
    this.recovery = extra.recovery || '';
    this.details = extra.details;
    if (extra.correlationId) this.correlationId = extra.correlationId;
  }
}

module.exports = { sha256, sha256File, uid, sleep, nowIso, writeJsonAtomic, readJson, writeFileAtomic, canonical, safeName, StudioError };
