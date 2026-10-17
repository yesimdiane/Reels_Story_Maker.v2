// Loads the Apps Script sources (single source of truth for the script fingerprint, disclosure text
// and permission rules) into a sandbox so the renderer and the Sheet can never disagree.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = process.env.RF_APPS_SCRIPT_DIR || path.join(__dirname, '..', '..', 'apps-script');
const FILES = ['Config.gs', 'Validation.gs', 'States.gs', 'Reels.gs'];

const ctx = vm.createContext({});
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
const get = (name) => vm.runInContext(name, ctx);

module.exports = {
  RF_CONFIG: get('RF_CONFIG'),
  RF_SCRIPT_FIELDS: Array.from(get('RF_SCRIPT_FIELDS')),
  scriptFingerprint: get('scriptFingerprint'),
  isPermissionApproved: get('isPermissionApproved'),
  normalizeText: get('normalizeText'),
};
