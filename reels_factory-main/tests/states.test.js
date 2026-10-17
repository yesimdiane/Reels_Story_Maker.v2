// Approval state machine (apps-script/States.gs): every gate from Issue #2 as a unit test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext({ console });
for (const f of ['Config.gs', 'Validation.gs', 'States.gs', 'Reels.gs', 'Prompt.gs', 'Fixtures.gs', 'FlowPrompts.gs']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const gs = (expr) => vm.runInContext(expr, ctx);
const plan = gs('planTransition');
const plain = (v) => JSON.parse(JSON.stringify(v));

const DRIVE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing';
const AFFILIATE = 'https://link.coupang.com/a/abc123';
const T = { actor: 'owner@example.com', now: '2026-10-08T10:00:00Z' };

function product(over) {
  return Object.assign({}, gs('FIXTURE_PRD_001_PRODUCT'), over || {});
}
function freshRow(p) {
  const raw = JSON.stringify(gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
  const res = gs('prepareReelRecords')(p || product(), raw, [], [], { model: 'm', generatedAt: 'g' });
  assert.deepEqual(plain(res.errors), []);
  const row = Object.assign({ _row: 2 }, plain(res.records[0]));
  // The operator's hook choice (approval requires it); see the five-hook tests for the gate itself.
  row['선택한 훅'] = JSON.stringify({ id: 'H4', text: row['후킹'], scriptVersion: 1 });
  return row;
}
// Applies an action like the server does and returns the plan.
function run(row, p, action, input) {
  const status = gs('reelStatus')(row);
  const base = { expectedStatus: status, expectedScriptVersion: gs('scriptVersionOf')(row), expectedVideoVersion: gs('videoVersionOf')(row) };
  // The operator's "reviewed the script with the chosen hook" confirmation (gate tested in fivehooks.test.js).
  if (action === 'APPROVE_SCRIPT') base.hookReviewed = true;
  const out = plan(row, p, action, Object.assign(base, input || {}), T);
  Object.assign(row, out.updates);
  return out;
}
function toReadyToPublish(p) {
  const row = freshRow(p);
  run(row, p, 'APPROVE_SCRIPT');
  run(row, p, 'START_VIDEO');
  run(row, p, 'REGISTER_VIDEO', { videoUrl: DRIVE });
  run(row, p, 'APPROVE_VIDEO');
  run(row, p, 'MARK_READY_TO_PUBLISH');
  return row;
}
const ok = () => product({ permission: '허가 완료', affiliateUrl: AFFILIATE });

test('new reels start at SCRIPT_REVIEW_PENDING, script v1, video v0', () => {
  const row = freshRow();
  assert.equal(gs('reelStatus')(row), 'SCRIPT_REVIEW_PENDING');
  assert.equal(gs('scriptVersionOf')(row), 1);
  assert.equal(gs('videoVersionOf')(row), 0);
});

test('MVP-era rows (only 제작 상태 = 대본 검토 대기) are read as SCRIPT_REVIEW_PENDING', () => {
  const row = freshRow();
  row['상태'] = '';
  assert.equal(gs('reelStatus')(row), 'SCRIPT_REVIEW_PENDING');
  assert.equal(gs('scriptVersionOf')({}), 1);
});

test('no video work without explicit approval of the current script version', () => {
  const p = ok();
  const row = freshRow(p);
  assert.throws(() => run(row, p, 'START_VIDEO'), /현재 상태\(대본 검토 대기\)에서 할 수 없습니다/);
  assert.throws(() => plan(row, p, 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING' }, T), /버전이 지정되지/);
  const out = run(row, p, 'APPROVE_SCRIPT');
  assert.equal(out.status, 'SCRIPT_APPROVED');
  assert.equal(row['승인 대본 버전'], 1);
  assert.equal(row['승인 대본 해시'], gs('scriptFingerprint')(row));
  assert.equal(row['대본 검토자'], 'owner@example.com');
  assert.equal(JSON.parse(out.audit['스냅샷(JSON)'])['후킹'], row['후킹']);
  assert.equal(run(row, p, 'START_VIDEO').status, 'VIDEO_IN_PRODUCTION');
});

test('editing the approved script in the sheet blocks video until re-approved', () => {
  const p = ok();
  const row = freshRow(p);
  run(row, p, 'APPROVE_SCRIPT');
  row['내레이션'] += ' 추가 문장';
  assert.equal(gs('isApprovedScriptIntact')(row), false);
  assert.throws(() => run(row, p, 'START_VIDEO'), /승인된 대본과 현재 대본이 다릅니다/);
  run(row, p, 'REOPEN_SCRIPT');
  assert.equal(gs('reelStatus')(row), 'SCRIPT_REVIEW_PENDING');
  run(row, p, 'APPROVE_SCRIPT');
  assert.equal(run(row, p, 'START_VIDEO').status, 'VIDEO_IN_PRODUCTION');
});

test('changing Flow prompts, CTA, keyword or disclosure after approval also breaks the approval', () => {
  for (const field of ['Flow 프롬프트', 'CTA', 'ManyChat 키워드', '광고 표기', '장면(JSON)']) {
    const p = ok();
    const row = freshRow(p);
    run(row, p, 'APPROVE_SCRIPT');
    row[field] = String(row[field]) + 'x';
    assert.equal(gs('isApprovedScriptIntact')(row), false, field);
  }
});

test('unverified media permission blocks video production and publishing', () => {
  const p = product({ permission: '미확인', affiliateUrl: AFFILIATE });
  const row = freshRow(p);
  run(row, p, 'APPROVE_SCRIPT');
  assert.throws(() => run(row, p, 'START_VIDEO'), /영상 사용 허가 상태.*마켓 등록만으로는 허가가 아닙니다/s);
  assert.equal(run(row, product({ permission: '자체 제작', affiliateUrl: AFFILIATE }), 'START_VIDEO').status, 'VIDEO_IN_PRODUCTION');
});

test('EDIT_SCRIPT creates a new version, clears approval, and is validated like Gemini output', () => {
  const p = ok();
  const row = freshRow(p);
  const out = run(row, p, 'EDIT_SCRIPT', { edit: { hook: '현관 우산, 이제 문에 붙이세요' }, note: '후킹 다듬음' });
  assert.equal(out.status, 'SCRIPT_REVIEW_PENDING');
  assert.equal(row['대본 버전'], 2);
  assert.equal(row['후킹'], '현관 우산, 이제 문에 붙이세요');
  assert.equal(row['승인 대본 해시'], '');
  assert.equal(out.audit['대본 버전'], 2);
  assert.throws(() => run(row, p, 'EDIT_SCRIPT', { edit: { narration: '하중 5kg까지 버팁니다' } }), /수치.*"5"/);
  assert.throws(() => run(row, p, 'EDIT_SCRIPT', { edit: { hook: '최저가 우산꽂이' } }), /최저가/);
  assert.throws(() => run(row, p, 'EDIT_SCRIPT', { edit: { scenes: [{}] } }), /장면 개수는 수정할 수 없습니다/);
  assert.equal(row['대본 버전'], 2, 'failed edits do not change the row');
});

test('the approved version is exactly what was edited and reviewed', () => {
  const p = ok();
  const row = freshRow(p);
  const scenes = JSON.parse(row['장면(JSON)']).map((sc, i) => (i === 1 ? { narration: '저는 문에 붙여 썼어요.' } : {}));
  run(row, p, 'EDIT_SCRIPT', { edit: { scenes } });
  // "저는 …" is a personal experience: approval needs the reviewer to confirm it is real.
  assert.throws(() => run(row, p, 'APPROVE_SCRIPT'), /확인 필요 항목 1건[\s\S]*\[개인 경험\] 장면 2/);
  const approve = run(row, p, 'APPROVE_SCRIPT', { flagsConfirmed: true });
  assert.equal(row['승인 대본 버전'], 2);
  const snap = JSON.parse(approve.audit['스냅샷(JSON)']);
  assert.equal(snap['자막'].split('\n')[1], '저는 문에 붙여 썼어요.', 'subtitles follow the edited scene line');
  assert.match(snap['내레이션'], /저는 문에 붙여 썼어요\./);
  assert.equal(JSON.parse(snap['장면(JSON)'])[1].narration, '저는 문에 붙여 썼어요.');
});

test('request changes → regenerate → review again', () => {
  const p = ok();
  const row = freshRow(p);
  assert.throws(() => run(row, p, 'REQUEST_SCRIPT_CHANGES'), /메모\(사유\)가 필요/);
  run(row, p, 'REQUEST_SCRIPT_CHANGES', { note: '더 짧게' });
  assert.equal(gs('reelStatus')(row), 'SCRIPT_CHANGES_REQUESTED');
  assert.throws(() => run(row, p, 'APPROVE_SCRIPT'), /할 수 없습니다/);
  // A rewritten script (here: same scenes, starting with hook H1 instead).
  const ref = plain(gs('FIXTURE_PRD_001_GEMINI_RESPONSE'));
  const newReel = ref.reels[0];
  newReel.hook = ref.hooks[0].text;
  newReel.scenes[0].narration = newReel.hook;
  newReel.captions[0] = newReel.hook;
  const out = run(row, p, 'REGENERATE_SCRIPT', { reel: newReel });
  assert.equal(out.status, 'SCRIPT_REVIEW_PENDING');
  assert.equal(row['대본 버전'], 2);
  assert.equal(row['후킹'], newReel.hook);
  const bad = Object.assign({}, newReel, { facts_used: ['방수'] });
  run(row, p, 'REQUEST_SCRIPT_CHANGES', { note: '다시' });
  assert.throws(() => run(row, p, 'REGENERATE_SCRIPT', { reel: bad }), /확인되지 않은 기능/);
});

test('rejection is terminal', () => {
  const p = ok();
  const row = freshRow(p);
  run(row, p, 'REJECT_SCRIPT');
  for (const a of Object.keys(plain(gs('RF_ACTIONS')))) {
    assert.throws(() => run(row, p, a, { note: 'n', videoUrl: DRIVE }), /할 수 없습니다/, a);
  }
});

test('double taps are no-ops; stale requests are refused', () => {
  const p = ok();
  const row = freshRow(p);
  const first = { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 1, hookReviewed: true };
  Object.assign(row, plan(row, p, 'APPROVE_SCRIPT', first, T).updates);
  assert.equal(plan(row, p, 'APPROVE_SCRIPT', first, T).noop, true);
  assert.throws(() => plan(row, p, 'REJECT_SCRIPT', first, T), /이미 다른 곳에서 변경되었습니다/);
  assert.throws(() => plan(freshRow(p), p, 'APPROVE_SCRIPT', { expectedStatus: 'SCRIPT_REVIEW_PENDING', expectedScriptVersion: 3 }, T), /이미 다른 곳에서/);
});

test('video registration, review and versioning', () => {
  const p = ok();
  const row = freshRow(p);
  run(row, p, 'APPROVE_SCRIPT');
  run(row, p, 'START_VIDEO');
  assert.throws(() => run(row, p, 'REGISTER_VIDEO', { videoUrl: 'https://example.com/a.mp4' }), /Google Drive/);
  run(row, p, 'REGISTER_VIDEO', { videoUrl: DRIVE });
  assert.equal(row['영상 버전'], 1);
  assert.equal(row['영상 파일 URL'], 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view');
  assert.throws(() => plan(row, p, 'APPROVE_VIDEO', { expectedStatus: 'VIDEO_REVIEW_PENDING' }, T), /영상 버전이 지정되지/);
  assert.throws(() => run(row, p, 'REQUEST_VIDEO_CHANGES'), /메모/);
  run(row, p, 'REQUEST_VIDEO_CHANGES', { note: '자막 크게' });
  run(row, p, 'START_VIDEO');
  run(row, p, 'REGISTER_VIDEO', { videoUrl: DRIVE });
  assert.equal(row['영상 버전'], 2);
  const out = run(row, p, 'APPROVE_VIDEO');
  assert.equal(out.status, 'VIDEO_APPROVED');
  assert.equal(row['영상 검토자'], 'owner@example.com');
});

test('video failures are recorded and can be retried', () => {
  const p = ok();
  const row = freshRow(p);
  run(row, p, 'APPROVE_SCRIPT');
  run(row, p, 'START_VIDEO');
  run(row, p, 'MARK_VIDEO_FAILED', { note: 'FFmpeg: 폰트 없음' });
  assert.equal(gs('reelStatus')(row), 'VIDEO_FAILED');
  assert.equal(row['오류'], 'FFmpeg: 폰트 없음');
  run(row, p, 'START_VIDEO');
  assert.equal(row['오류'], '');
});

test('only VIDEO_APPROVED can enter READY_TO_PUBLISH, and only with a valid Coupang Partners link', () => {
  const actions = plain(gs('RF_ACTIONS'));
  const intoReady = Object.keys(actions).filter((a) => actions[a].to === 'READY_TO_PUBLISH');
  assert.deepEqual(intoReady, ['MARK_READY_TO_PUBLISH']);
  assert.deepEqual(actions.MARK_READY_TO_PUBLISH.from, ['VIDEO_APPROVED']);

  for (const [url, re] of [['', /비어 있습니다/], ['https://www.coupang.com/vp/products/1', /파트너스 링크여야/], ['http://link.coupang.com/a/x', /파트너스 링크여야/]]) {
    const p = product({ permission: '허가 완료', affiliateUrl: url });
    const row = freshRow(p);
    run(row, p, 'APPROVE_SCRIPT');
    run(row, p, 'START_VIDEO');
    run(row, p, 'REGISTER_VIDEO', { videoUrl: DRIVE });
    run(row, p, 'APPROVE_VIDEO');
    assert.throws(() => run(row, p, 'MARK_READY_TO_PUBLISH'), re);
    assert.equal(gs('reelStatus')(row), 'VIDEO_APPROVED');
  }
  const row = toReadyToPublish(product({ permission: '허가 완료', affiliateUrl: 'https://coupa.ng/abc' }));
  assert.equal(gs('reelStatus')(row), 'READY_TO_PUBLISH');
});

test('publishing and ManyChat are only ever confirmed manually (touchpoint 4)', () => {
  const actions = plain(gs('RF_ACTIONS'));
  const touch4 = Object.keys(actions).filter((a) => actions[a].touchpoint === 4).sort();
  assert.deepEqual(touch4, ['CONFIRM_MANYCHAT', 'CONFIRM_PUBLISHED']);
  const p = ok();
  const row = toReadyToPublish(p);
  assert.throws(() => run(row, p, 'CONFIRM_PUBLISHED', { instagramUrl: 'https://evil.example/p/1' }), /instagram\.com/);
  assert.equal(run(row, p, 'CONFIRM_PUBLISHED', { instagramUrl: 'https://www.instagram.com/reel/abc/' }).status, 'READY_TO_PUBLISH');
  assert.equal(run(row, p, 'CONFIRM_PUBLISHED').noop, true, 'confirming twice is a no-op');
  assert.equal(run(row, p, 'CONFIRM_MANYCHAT').status, 'COMPLETED');
  assert.equal(row['인스타그램 URL'], 'https://www.instagram.com/reel/abc/');
});

test('publishing pack: conspicuous disclosure, keyword and matching affiliate link; only when ready', () => {
  const p = ok();
  const row = freshRow(p);
  assert.throws(() => gs('buildPublishingPack')(row, p), /게시 준비 완료/);
  toReadyToPublish(p);
  const ready = toReadyToPublish(p);
  const pack = plain(gs('buildPublishingPack')(ready, p));
  assert.ok(pack.instagramCaption.startsWith('[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로'));
  assert.match(pack.instagramCaption, /댓글에 "우산"/, 'simple customer-facing keyword');
  assert.equal(pack.manychatKeyword, '우산');
  assert.match(pack.manychatDm, /link\.coupang\.com\/a\/abc123/);
  assert.match(pack.manychatDm, /수수료/);
  assert.match(pack.videoDownloadUrl, /uc\?export=download&id=1AbC/);
});

test('removing the affiliate disclosure blocks approval', () => {
  const p = ok();
  const row = freshRow(p);
  row['광고 표기'] = '';
  assert.throws(() => run(row, p, 'APPROVE_SCRIPT'), /광고 표기/);
});

test('touchpoint summary reflects the four operator responsibilities', () => {
  const p = ok();
  const row = toReadyToPublish(p);
  let tps = plain(gs('touchpointSummary')(row, p));
  assert.deepEqual(tps.map((t) => t.done), [true, true, true, false]);
  run(row, p, 'CONFIRM_PUBLISHED');
  run(row, p, 'CONFIRM_MANYCHAT');
  tps = plain(gs('touchpointSummary')(row, p));
  assert.deepEqual(tps.map((t) => t.done), [true, true, true, true]);
  const fresh = plain(gs('touchpointSummary')(freshRow(), product()));
  assert.deepEqual(fresh.map((t) => t.done), [false, false, false, false]);
});

test('parseDriveFileId accepts share links, open?id= links and bare IDs', () => {
  const f = gs('parseDriveFileId');
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.equal(f(DRIVE), id);
  assert.equal(f('https://drive.google.com/open?id=' + id), id);
  assert.equal(f(id), id);
  assert.equal(f('https://youtube.com/watch?v=abc'), '');
});

test('storyboard rules: beats in order, CTA keyword placeholder, scene length and subtitle length', () => {
  const v = (mut) => {
    const reel = plain(gs('FIXTURE_PRD_001_GEMINI_RESPONSE')).reels[0];
    mut(reel);
    return plain(gs('validateReelContent')(reel, product(), 'R', { requireStoryboard: true })).join('\n');
  };
  assert.equal(v(() => {}), '');
  assert.match(v((r) => (r.scenes[0].beat = 'DEMO')), /첫 장면은 HOOK/);
  assert.match(v((r) => (r.scenes[5].beat = 'BENEFIT')), /마지막 장면은 CTA/);
  assert.match(v((r) => ([r.scenes[1].beat, r.scenes[3].beat] = ['DEMO', 'EMPATHY'])), /순서/);
  assert.match(v((r) => (r.scenes[5].narration = '제품 정보는 댓글에')), /\{키워드\}/);
  assert.match(v((r) => (r.scenes[2].duration_sec = 8)), /2~6초/);
  assert.match(v((r) => (r.scenes[3].narration = '가'.repeat(31))), /자막 2줄 이내/);
  assert.match(v((r) => (r.scenes[3].narration = '3초 만에 설치 끝')), /수치.*"3"/);
});

test('Google Flow clip coverage: valid scenes fit one 8 s clip; a longer scene is split into S3 + S3b, never an impossible plan', () => {
  const F = plain(gs('RF_CONFIG.FLOW'));
  assert.equal(F.CLIP_SEC, 8);
  // The validator's scene maximum always fits one clip (minus margin).
  assert.ok(gs('RF_CONFIG.LIMITS.SCENE_MAX_SEC') <= F.CLIP_SEC - F.CLIP_MARGIN_SEC);
  const one = plain(gs('buildFlowScenePrompts')(freshRow(), product()));
  assert.equal(one.length, 6);
  assert.ok(one.every((p) => p.parts === 1 && p.coversSec <= F.CLIP_SEC - F.CLIP_MARGIN_SEC));
  assert.deepEqual(one.map((p) => p.file), ['S1.mp4', 'S2.mp4', 'S3.mp4', 'S4.mp4', 'S5.mp4', 'S6.mp4']);
  // With shorter clips (e.g. a Flow setting change), long scenes get more clip requirements.
  const row = freshRow();
  gs('RF_CONFIG.FLOW.CLIP_SEC = 4');
  try {
    const split = plain(gs('buildFlowScenePrompts')(row, product()));
    const s3 = split.filter((p) => p.scene === 3);
    assert.deepEqual(s3.map((p) => p.file), ['S3.mp4', 'S3b.mp4']);
    assert.ok(split.every((p) => p.coversSec <= 3.5), JSON.stringify(split.map((p) => [p.file, p.coversSec])));
    assert.match(s3[1].prompt, /PART 2 of 2: continue the same action/);
    // …and the validator now refuses scenes a single clip cannot cover.
    const reel = plain(gs('FIXTURE_PRD_001_GEMINI_RESPONSE')).reels[0];
    const errs = plain(gs('validateReelContent')(reel, product(), 'R', { requireStoryboard: true })).join('\n');
    assert.match(errs, /2~3\.5초여야 합니다 \(Flow 클립 4초/);
  } finally {
    gs('RF_CONFIG.FLOW.CLIP_SEC = 8');
  }
});
