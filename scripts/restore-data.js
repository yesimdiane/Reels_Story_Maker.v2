#!/usr/bin/env node
// Restore a backup made by backup-data.js. Refuses to touch a non-empty target unless --force; with --force the current
// contents are first moved to <dir>.before-restore-<time> (never deleted).
//   node scripts/restore-data.js backup.tar.gz /data/studio [--force]
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const [archive, target, flag] = process.argv.slice(2);
if (!archive || !target) { console.error('사용법: node scripts/restore-data.js <backup.tar.gz> <dataDir> [--force]'); process.exit(1); }
const dir = path.resolve(target);
const nonEmpty = fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
if (nonEmpty && flag !== '--force') { console.error(dir + ' 에 이미 데이터가 있습니다. 덮어쓰려면 --force (기존 데이터는 .before-restore-* 로 보관됩니다).'); process.exit(2); }
if (nonEmpty) { const keep = dir + '.before-restore-' + Date.now(); fs.renameSync(dir, keep); console.log('기존 데이터 보관: ' + keep); }
fs.mkdirSync(dir, { recursive: true });
execFileSync('tar', ['-xzf', path.resolve(archive), '-C', dir, '--strip-components=1'], { stdio: 'inherit' });
console.log('복원 완료: ' + dir + ' — 서버를 다시 시작하세요. 저장된 API 키는 같은 RF_MASTER_KEY가 있어야 읽힙니다.');
