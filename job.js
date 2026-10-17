// The approval gate. Every check here runs BEFORE any paid API call.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const core = require('./script-core');

class GateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GateError';
  }
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(payload, 'utf8').digest('hex');
}

/**
 * Verifies a job file ({ payload, signature }) and returns the parsed job.
 * Throws GateError unless the job is signed by the Sheet, unexpired, VIDEO_IN_PRODUCTION,
 * and its script cells still match the approved fingerprint.
 */
function verifyJob(jobFile, opts) {
  const secret = opts.secret;
  const now = opts.now || new Date();
  if (!secret) {
    throw new GateError('RF_RENDER_SECRET이 없습니다. Google Sheets 메뉴 "릴스 팩토리 → 렌더 키 보기"의 값을 renderer/.env에 넣으세요.');
  }
  if (!jobFile || typeof jobFile.payload !== 'string' || typeof jobFile.signature !== 'string') {
    throw new GateError('렌더 작업 파일 형식이 아닙니다. 대시보드의 "렌더 작업 파일 (Mac)"에서 받은 파일을 사용하세요.');
  }
  const expected = sign(jobFile.payload, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(jobFile.signature, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new GateError('서명이 맞지 않습니다. 파일이 수정되었거나 RF_RENDER_SECRET이 다릅니다. 대시보드에서 새 작업 파일을 받으세요.');
  }
  const job = JSON.parse(jobFile.payload);
  if (job.jobVersion !== 1) throw new GateError('지원하지 않는 작업 버전입니다: ' + job.jobVersion);
  if (job.status !== 'VIDEO_IN_PRODUCTION') throw new GateError('승인 후 "영상 제작 중"인 릴스만 렌더링합니다 (현재: ' + job.status + ').');
  if (new Date(job.expiresAt) < now) throw new GateError('작업 파일이 만료되었습니다 (' + job.expiresAt + '). 대시보드에서 새 파일을 받으세요.');
  if (job.approvedScriptVersion !== job.scriptVersion) throw new GateError('승인된 대본 버전과 작업의 대본 버전이 다릅니다.');
  const fp = core.scriptFingerprint(job.script);
  if (!job.approvedHash || fp !== job.approvedHash) {
    throw new GateError('대본 내용이 승인된 버전과 다릅니다 (지문 불일치). 렌더링하지 않습니다.');
  }
  if (!core.isPermissionApproved(job.permission)) throw new GateError('영상 사용 허가가 확인되지 않은 상품입니다.');
  return job;
}

function loadJobFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new GateError('작업 파일을 읽을 수 없습니다: ' + file + ' (' + e.message + ')');
  }
}

module.exports = { verifyJob, loadJobFile, sign, GateError };
