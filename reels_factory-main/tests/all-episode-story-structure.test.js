'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../studio/lib/scriptgen.js'),'utf8');
const formula = require('../studio/lib/formula');
test('every new episode category uses six-beat Part A and fixed Part B', () => {
  assert.match(source, /SF\.seedFormula\(seed, endings, endingTemplateId\)/);
  assert.doesNotMatch(source, /if \(isDrama\) SF\.seedFormula/);
  assert.deepEqual(formula.BEAT_KEYS, ['setup','problem','absurd_escalation','unexpected_twist','resolution','product_bridge']);
  assert.equal(formula.ENDING_KEYS.length,3);
});
test('legacy episodes stay unmodified until explicitly migrated', () => {
  assert.equal(formula.isStructured({ scenes:[{id:'S1'}] }),false);
});
