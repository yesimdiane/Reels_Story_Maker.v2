#!/usr/bin/env node
// Preflight for a cloud deploy. Run it in the deployed container (`railway run node scripts/deploy-check.js`, `fly ssh console`)
// or locally with the same variables. Prints PASS/WARN/FAIL; never prints a secret value.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const e = process.env;
const out = [];
const add = (level, msg) => out.push([level, msg]);
const need = (cond, ok, bad, level = 'FAIL') => add(cond ? 'PASS' : level, cond ? ok : bad);

need(e.RF_ENV === 'production', 'RF_ENV=production', 'RF_ENV가 production이 아닙니다 (Dockerfile 기본값)', 'WARN');
need((e.RF_MASTER_KEY || '').length >= 32, 'RF_MASTER_KEY 설정됨 (32자 이상)', 'RF_MASTER_KEY가 없거나 32자 미만입니다');
need((e.RF_ADMIN_PASSWORD || '').length >= 12, 'RF_ADMIN_PASSWORD 설정됨 (12자 이상)', 'RF_ADMIN_PASSWORD가 없거나 12자 미만입니다');
need(!!e.PORT, `PORT=${e.PORT} (호스트가 주입)`, 'PORT 없음 — 서버가 127.0.0.1:4173에 바인딩되어 외부에서 접속 불가', 'FAIL');
need(!!e.RF_PUBLIC_HOST, `RF_PUBLIC_HOST=${e.RF_PUBLIC_HOST}`, 'RF_PUBLIC_HOST 미설정 — 도메인 접속 시 HOST 오류가 날 수 있습니다 (예: myapp.up.railway.app)', 'WARN');
if (e.RF_PUBLIC_HOST) need(!/^https?:\/\//.test(e.RF_PUBLIC_HOST) && !e.RF_PUBLIC_HOST.includes('/'), 'RF_PUBLIC_HOST 형식 OK (스킴/경로 없음)', 'RF_PUBLIC_HOST에는 https:// 나 경로를 넣지 마세요 (호스트명만)');
const dir = e.RF_STUDIO_DIR || '/data/studio';
try {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, '.write-test'); fs.writeFileSync(f, 'x'); fs.unlinkSync(f);
  add('PASS', `데이터 디렉터리 쓰기 가능: ${dir}`);
  const st = fs.statfsSync ? fs.statfsSync(dir) : null;
  if (st) add('PASS', `여유 공간 약 ${Math.round((st.bavail * st.bsize) / 1e6)} MB`);
  if (!/^\/data(\/|$)/.test(dir) && e.RF_ENV === 'production') add('WARN', `RF_STUDIO_DIR(${dir})가 /data 볼륨 밖입니다 — 재배포 시 데이터가 사라질 수 있습니다`);
} catch (err) { add('FAIL', `데이터 디렉터리 쓰기 실패 (${dir}): ${err.code || err.message} — 볼륨을 /data 에 마운트했는지 확인`); }
const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
need(ff.status === 0, 'ffmpeg 사용 가능', 'ffmpeg 없음 — 렌더 불가 (Docker 이미지에는 포함됨)');
const fc = spawnSync('fc-list', [':', 'family'], { encoding: 'utf8' });
const font = e.RF_FONT_NAME || 'NanumGothic';
need(fc.status === 0 && fc.stdout.toLowerCase().replace(/[\s_-]/g, '').includes(font.toLowerCase().replace(/[\s_-]/g, '')), `자막 글꼴 설치됨: ${font}`, `자막 글꼴 "${font}" 없음 — 렌더가 FONT_MISSING으로 중단됩니다`, 'WARN');
for (const k of ['RF_MUAPI_MODE', 'RF_STUDIO_VOICE_MODE']) need(!e[k] || e[k] === 'mock', `${k}=${e[k] || 'mock(기본)'}`, `${k}=${e[k]} — 실제(유료) 모드가 환경변수로 강제됩니다. 처음엔 비우거나 mock 권장`, 'WARN');
for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MUAPI_API_KEY', 'HEYGEN_API_KEY']) add('INFO', `${k}: ${e[k] ? '환경변수로 설정됨 (…' + e[k].slice(-4) + ')' : '없음 — Settings → AI 연동에서 입력 가능'}`);
for (const [l, m] of out) console.log(l.padEnd(4), m);
const fail = out.filter((o) => o[0] === 'FAIL').length;
console.log(fail ? `\n✗ ${fail}개 문제 — 배포 전에 해결하세요.` : '\n✓ 필수 항목 통과');
process.exit(fail ? 1 : 0);
