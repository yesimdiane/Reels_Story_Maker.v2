#!/usr/bin/env node
'use strict';
// Read the same configuration as Studio, never print key values.
const path = require('node:path');
const fs = require('node:fs');
const { loadConfig } = require('../renderer/lib/config');
const file = process.env.RF_ENV_FILE || path.join(__dirname, '..', 'renderer', '.env');
if (!fs.existsSync(file)) {
  console.error('No API key file found. Create renderer/.env or set RF_ENV_FILE=/absolute/path/to/keys.env');
  process.exitCode = 1;
} else {
  const cfg = loadConfig();
  console.log('API key file: ' + path.resolve(file));
  for (const [name, value] of [
    ['GEMINI_API_KEY', cfg.geminiApiKey],
    ['OPENAI_API_KEY', cfg.openaiApiKey],
    ['ANTHROPIC_API_KEY', cfg.anthropicApiKey],
    ['MUAPI_API_KEY', cfg.muapiApiKey],
    ['HEYGEN_API_KEY', cfg.heygenApiKey],
  ]) console.log(name + ': ' + (value ? 'configured' : 'not configured'));
  console.log('Video mode: ' + cfg.muapiMode + ' (live requires explicit confirmation and may incur fees)');
  console.log('Voice mode: ' + cfg.studioMode);
}
