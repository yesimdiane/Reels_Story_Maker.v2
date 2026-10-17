// Loads a reusable visual template (renderer/templates/<name>.json). Product-independent.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'templates');

function loadTemplate(name = 'lifestyle-v1') {
  const file = path.join(DIR, name + '.json');
  if (!fs.existsSync(file)) throw new Error('템플릿이 없습니다: ' + name + ' (' + file + ')');
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['canvas', 'safeArea', 'shots', 'subtitle', 'disclosure', 'assets', 'narration', 'durationSec']) {
    if (!t[k]) throw new Error('템플릿 ' + name + '에 "' + k + '" 설정이 없습니다.');
  }
  return t;
}

module.exports = { loadTemplate };
