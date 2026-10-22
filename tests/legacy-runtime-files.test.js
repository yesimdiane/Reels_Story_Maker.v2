'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../studio/lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-legacy-'));

test('leftover ending-templates.json is moved to _retired, not deleted', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ending-templates.json'), '{"keep":"me"}');
  createStore({ dir });
  assert.equal(fs.existsSync(path.join(dir, 'ending-templates.json')), false);
  assert.equal(fs.readFileSync(path.join(dir, '_retired', 'ending-templates.json'), 'utf8'), '{"keep":"me"}');
});

test('a second retire never overwrites an earlier retired copy; no file means no-op', () => {
  const dir = tmp();
  createStore({ dir }); // nothing to retire
  assert.equal(fs.existsSync(path.join(dir, '_retired')), false);
  for (const body of ['a', 'b']) {
    fs.writeFileSync(path.join(dir, 'ending-templates.json'), body);
    createStore({ dir });
  }
  assert.equal(fs.readFileSync(path.join(dir, '_retired', 'ending-templates.json'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(path.join(dir, '_retired', 'ending-templates.json.1'), 'utf8'), 'b');
});
