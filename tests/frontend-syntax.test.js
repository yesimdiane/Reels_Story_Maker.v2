'use strict';
// Every browser module must at least parse: one syntax error in any imported view blanks the whole Studio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : [])); }

test('all studio/public/js modules parse as ES modules', () => {
  const root = path.join(__dirname, '..', 'studio', 'public', 'js');
  const files = walk(root);
  assert.ok(files.length > 20);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: fs.readFileSync(f), encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.relative(root, f)} has a syntax error: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
  }
});
