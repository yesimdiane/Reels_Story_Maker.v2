'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');

test('RF_ENV_FILE loads local keys, but explicit process env wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-local-env-'));
  try {
    const file = path.join(dir, 'keys.env');
    fs.writeFileSync(file, 'GEMINI_API_KEY=local-test-key\nMUAPI_API_KEY=mu-test-key\nRF_MUAPI_MODE=mock\n');
    const cfg = loadConfig({ RF_ENV_FILE: file, GEMINI_API_KEY: 'override' });
    assert.equal(cfg.geminiApiKey, 'override');
    assert.equal(cfg.muapiApiKey, 'mu-test-key');
    assert.equal(cfg.muapiMode, 'mock');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('bad RF_ENV_FILE fails clearly', () => {
  assert.throws(() => loadConfig({RF_ENV_FILE:'/nonexistent/test-reels-keys-file'}), /RF_ENV_FILE does not exist/);
});
