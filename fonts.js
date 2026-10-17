// Font detection: the template's subtitle font must be installed, otherwise libass silently falls back
// to another font and the reel no longer matches the brand. Checked before any paid call.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const norm = (s) => String(s).toLowerCase().replace(/[\s_\-]+/g, '');

const INSTALL_HELP = {
  NanumSquareRound:
    'Mac: brew install --cask font-nanum-square-round  (또는 https://hangeul.naver.com/font 에서 나눔스퀘어라운드 다운로드 → .ttf 더블클릭 → 서체 설치)',
};

class FontMissingError extends Error {
  constructor(family) {
    super(`자막 글꼴 "${family}"이(가) 설치되어 있지 않습니다. ${INSTALL_HELP[family] || '글꼴을 설치하거나 RF_FONTS_DIR에 글꼴 파일 폴더를 지정하세요.'}`);
    this.name = 'FontMissingError';
    this.code = 'FONT_MISSING';
  }
}

function fontDirs(fontsDir, platform = process.platform) {
  const home = os.homedir();
  const dirs = [];
  if (fontsDir) dirs.push(fontsDir);
  if (platform === 'darwin') dirs.push(path.join(home, 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts', '/System/Library/Fonts/Supplemental');
  else dirs.push(path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts'), '/usr/share/fonts', '/usr/local/share/fonts');
  return dirs.filter((d) => fs.existsSync(d));
}

function walk(dir, depth = 4, out = []) {
  if (depth < 0) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth - 1, out);
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Returns { found, file, via } for a font family name. */
function findFont(family, { fontsDir = '', platform = process.platform } = {}) {
  const want = norm(family);
  for (const dir of fontDirs(fontsDir, platform)) {
    const hit = walk(dir).find((f) => norm(path.basename(f)).startsWith(want));
    if (hit) return { found: true, file: hit, via: 'file' };
  }
  try {
    // fontconfig (Linux, cloud image; also present if installed via Homebrew on macOS)
    const fams = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (fams.split('\n').some((l) => l.split(',').some((n) => norm(n) === want))) return { found: true, file: '', via: 'fontconfig' };
  } catch {
    // fc-list not available
  }
  return { found: false };
}

module.exports = { findFont, FontMissingError, INSTALL_HELP };
