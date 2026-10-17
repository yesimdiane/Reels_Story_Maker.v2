'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '..', 'studio', 'public', 'js');

test('English button subtitles: lookup, patterns and nav labels', async () => {
  const { enFor, EN } = await import(path.join(VIEWS, 'bilingual-dict.js'));
  assert.equal(enFor('저장'), 'Save');
  assert.equal(enFor('✓ 승인됨'), 'Approved');
  assert.equal(enFor('비교 (3)'), 'Compare (3)');
  assert.equal(enFor('장면을 6.5초로 늘리기'), 'Extend scene to 6.5s');
  assert.equal(enFor('Save'), '', 'English-only labels get no subtitle');
  assert.equal(enFor('이름 모를 버튼'), '', 'unknown labels get none (reported by unknownLabels())');
  const main = fs.readFileSync(path.join(VIEWS, 'main.js'), 'utf8');
  for (const [, ko] of main.matchAll(/\['[a-z]+', '([^']+)', '[A-Za-z ]+', [a-z]+, (?:true|false)\]/g)) assert.ok(EN[ko], 'nav label missing: ' + ko);
});

test('the decorator is wired in and never touches button behaviour', () => {
  const main = fs.readFileSync(path.join(VIEWS, 'main.js'), 'utf8');
  assert.match(main, /startBilingual\(/);
  const src = fs.readFileSync(path.join(VIEWS, 'bilingual.js'), 'utf8');
  assert.match(src, /aria-hidden/, 'subtitle is hidden from screen readers (label is in aria-label)');
  assert.doesNotMatch(src, /addEventListener|onclick/, 'moves child nodes only; handlers stay on the button');
});
