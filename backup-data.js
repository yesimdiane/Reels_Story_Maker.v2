#!/usr/bin/env node
// Backup of the Studio data dir (episodes, products, story lab, settings, prompts, encrypted secrets, usage) into one .tar.gz.
// secrets.json stays ENCRYPTED (it is useless without RF_MASTER_KEY); master.key (dev only) is excluded on purpose.
//   node scripts/backup-data.js [dataDir] [outFile]
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const dir = path.resolve(process.argv[2] || process.env.RF_STUDIO_DIR || '/data/studio');
if (!fs.existsSync(dir)) { console.error('데이터 폴더가 없습니다: ' + dir); process.exit(1); }
const out = path.resolve(process.argv[3] || `reels-factory-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`);
execFileSync('tar', ['-czf', out, '--exclude=master.key', '--exclude=tmp-*', '-C', path.dirname(dir), path.basename(dir)], { stdio: 'inherit' });
console.log('백업 완료: ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
console.log('복원: node scripts/restore-data.js ' + path.basename(out) + ' ' + dir);
