// Which code is actually running? Commit id from the host's environment (Railway sets RAILWAY_GIT_COMMIT_SHA), an explicit RF_BUILD_SHA, or the
// local git checkout. Shown in /healthz and at the bottom of the app so "is the deployed UI the latest?" can be answered by looking.
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const VERSION = require('../../package.json').version;

function read(env = process.env) {
  let sha = env.RF_BUILD_SHA || env.RAILWAY_GIT_COMMIT_SHA || env.SOURCE_COMMIT || '';
  let source = env.RF_BUILD_SHA ? 'RF_BUILD_SHA' : env.RAILWAY_GIT_COMMIT_SHA ? 'RAILWAY_GIT_COMMIT_SHA' : env.SOURCE_COMMIT ? 'SOURCE_COMMIT' : '';
  if (!sha) {
    try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim(); source = 'git'; } catch (_) { /* no git checkout (container image) */ }
  }
  sha = /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : '';
  return { version: VERSION, sha, shortSha: sha.slice(0, 7), source: sha ? source : 'unknown', branch: env.RAILWAY_GIT_BRANCH || '' };
}
module.exports = { read };
