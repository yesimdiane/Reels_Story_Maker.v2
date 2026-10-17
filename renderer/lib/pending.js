// Batch mode: render every signed job in RF_JOBS_DIR whose footage is complete. Safe to run repeatedly
// (e.g. every 10 minutes over a Google Drive–synced folder): jobs without footage stop at
// ASSETS_REQUIRED before any paid call, finished jobs are reused, and TTS lines are cached.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./render');
const { loadJobFile } = require('./job');

async function processPending({ cfg, args, makeOptions, log }) {
  const dir = path.resolve(args.jobs || cfg.jobsDir);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.render-job.json')).sort() : [];
  const results = [];
  for (const f of files) {
    const name = f.replace('.render-job.json', '');
    try {
      const opts = makeOptions(loadJobFile(path.join(dir, f)));
      const quiet = Object.assign({}, opts, { log: () => {} });
      const m = await render(quiet);
      results.push({ job: name, status: m.reused ? 'DONE (재사용)' : 'RENDERED', detail: m.output.path });
    } catch (e) {
      results.push({ job: name, status: e.code || e.name || 'ERROR', detail: e.message.split('\n')[0] });
    }
  }
  log(`[${new Date().toLocaleString()}] 작업 ${files.length}개 확인 (${dir})`);
  results.forEach((r) => log(`  ${r.status.padEnd(16)} ${r.job} — ${r.detail}`));
  return results;
}

module.exports = { processPending };
