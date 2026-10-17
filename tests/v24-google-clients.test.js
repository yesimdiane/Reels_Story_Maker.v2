// Google API layer (MOCKED with tests/helpers/fake-google.js): HTTP retry/backoff, token providers, OIDC ID-token verification,
// Sheets and Drive clients. These prove our client logic; they do not prove Google's behaviour (see tests/integration/).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FakeGoogle } = require('./helpers/fake-google');
const { createGoogleHttp, GoogleApiError } = require('../studio/lib/google/http');
const { createRefreshTokenProvider, createServiceAccountProvider, providerFromConfig } = require('../studio/lib/google/auth');
const { createGoogleLogin } = require('../studio/lib/google/oidc');
const { createSheetsApi, colName } = require('../studio/lib/google/sheets');
const { createDriveApi } = require('../studio/lib/google/drive');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rf-g-'));
function env(over = {}) {
  const g = new FakeGoogle();
  const sleeps = [];
  const fetchFn = g.fetch;
  const provider = createRefreshTokenProvider({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken, fetchFn, now: () => g.now() });
  const http = createGoogleHttp(Object.assign({ tokenProvider: provider, fetchFn, sleepFn: async (ms) => { sleeps.push(ms); }, random: () => 0.5 }, over));
  return { g, http, sleeps, provider, fetchFn };
}

// ------------------------------------------------------------------ http
test('http: transient errors (429/503/network) are retried with exponential backoff + jitter; permanent errors are not', async () => {
  const { g, http, sleeps } = env();
  g.addSpreadsheet('S1', { A: [['x']] });
  let n = 0;
  g.fault = (req) => (/sheets/.test(req.url) && n++ < 3 ? [429, 503, 500][n - 1] : 0);
  const r = await http.request('GET', 'https://sheets.googleapis.com/v4/spreadsheets/S1');
  assert.ok(r.sheets);
  assert.equal(sleeps.length, 3);
  assert.deepEqual(sleeps, [375, 750, 1500], 'base 500ms doubling, jittered by 0.75 (random=0.5)');
  assert.equal(http.stats.retries, 3);
  // Retry-After wins over the computed delay.
  sleeps.length = 0;
  let k = 0;
  g.fault = (req) => (/sheets/.test(req.url) && k++ === 0 ? new Response('{}', { status: 429, headers: { 'retry-after': '7' } }) : 0);
  await http.request('GET', 'https://sheets.googleapis.com/v4/spreadsheets/S1');
  assert.deepEqual(sleeps, [7000]);
  // 404 / 400 are permanent: one attempt, clear error without any token.
  g.fault = null;
  await assert.rejects(http.request('GET', 'https://sheets.googleapis.com/v4/spreadsheets/NOPE'), (e) => e instanceof GoogleApiError && e.status === 404 && !e.retryable && !/ya29|Bearer/.test(e.message + e.url));
  // Gives up after maxRetries.
  const t = env({ maxRetries: 2 });
  t.g.fault = (req) => (/sheets/.test(req.url) ? 503 : 0);
  await assert.rejects(t.http.request('GET', 'https://sheets.googleapis.com/v4/spreadsheets/S1'), (e) => e.status === 503 && e.retryable);
  assert.equal(t.sleeps.length, 2);
  // Network failure retried, then reported as retryable.
  const net = env({ maxRetries: 1, fetchFn: async () => { throw new TypeError('socket hang up'); } });
  await assert.rejects(net.http.request('GET', 'https://sheets.googleapis.com/x', { auth: false }), (e) => e.retryable && /연결하지 못했습니다/.test(e.message));
});

test('http: an expired/invalid access token (401) is refreshed once and the request replayed', async () => {
  const { g, http, provider } = env();
  g.addSpreadsheet('S1', { A: [['x']] });
  await provider.getToken();
  g.accessTokens.clear(); // server forgets the token (revoked / expired)
  const r = await http.request('GET', 'https://sheets.googleapis.com/v4/spreadsheets/S1');
  assert.ok(r.sheets);
  assert.equal(g.count(/oauth2\.googleapis\.com\/token/), 2, 'one refresh at start, one after the 401');
  // A second 401 is reported, not looped.
  g.fault = (req) => (/sheets/.test(req.url) ? 401 : 0);
  await assert.rejects(http.request('GET', 'https://sheets.googleapis.com/v4/spreadsheets/S1'), (e) => e.status === 401);
});

// ------------------------------------------------------------------ auth providers
test('refresh-token provider: caches the access token, refreshes before expiry, shares concurrent refreshes, never leaks secrets', async () => {
  const { g, provider } = env();
  const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);
  assert.equal(a, b);
  assert.equal(g.count(/oauth2\.googleapis\.com\/token/), 1);
  await provider.getToken();
  assert.equal(g.count(/oauth2\.googleapis\.com\/token/), 1, 'cached');
  g.now = () => Date.now() + 3600 * 1000; // an hour later → expired
  const c = await createRefreshTokenProvider({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken, fetchFn: g.fetch, now: () => g.now() }).getToken();
  assert.ok(c);
  // Wrong refresh token → actionable error that does not contain any secret.
  const bad = createRefreshTokenProvider({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: 'revoked-token-123456', fetchFn: g.fetch });
  await assert.rejects(bad.getToken(), (e) => e.code === 'GOOGLE_AUTH_REVOKED' && /프로덕션/.test(e.recovery) && !e.message.includes('revoked-token-123456') && !e.message.includes(g.clientSecret));
  const wrongClient = createRefreshTokenProvider({ clientId: g.clientId, clientSecret: 'nope', refreshToken: g.refreshToken, fetchFn: g.fetch });
  await assert.rejects(wrongClient.getToken(), (e) => e.code === 'GOOGLE_AUTH_FAILED' && !e.message.includes('nope'));
  assert.throws(() => createRefreshTokenProvider({ clientId: 'x' }), (e) => e.code === 'GOOGLE_NOT_CONFIGURED');
});

test('token endpoint hiccups (503 / network) are retried with backoff; a revoked grant is not retried', async () => {
  const g = new FakeGoogle();
  const waits = [];
  let n = 0;
  g.fault = (req) => (/oauth2\.googleapis\.com/.test(req.url) && n++ < 2 ? 503 : 0);
  const p = createRefreshTokenProvider({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken, fetchFn: g.fetch, sleepFn: async (ms) => waits.push(ms) });
  assert.match(await p.getToken(), /^ya29\./);
  assert.deepEqual(waits, [500, 1000]);
  let calls = 0;
  const flaky = async (...a) => { calls += 1; if (calls === 1) throw new TypeError('ECONNRESET'); return g.fetch(...a); };
  assert.match(await createRefreshTokenProvider({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken, fetchFn: flaky, sleepFn: async () => {} }).getToken(), /^ya29\./);
  g.fault = null;
  const before = g.count(/oauth2/);
  await assert.rejects(createRefreshTokenProvider({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: 'revoked-xxxxxxxx', fetchFn: g.fetch, sleepFn: async () => {} }).getToken(), (e) => e.code === 'GOOGLE_AUTH_REVOKED');
  assert.equal(g.count(/oauth2/) - before, 1, 'invalid_grant is final');
});

test('service-account provider signs a JWT with its private key (for Google Workspace Shared Drives)', async () => {
  const g = new FakeGoogle();
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
  g.registerServiceAccount('sa@proj.iam.gserviceaccount.com', kp.publicKey.export({ type: 'spki', format: 'pem' }));
  const p = createServiceAccountProvider({ clientEmail: 'sa@proj.iam.gserviceaccount.com', privateKey: pem.replace(/\n/g, '\\n'), fetchFn: g.fetch });
  const tok = await p.getToken();
  assert.match(tok, /^ya29\./);
  const bad = createServiceAccountProvider({ clientEmail: 'other@proj.iam.gserviceaccount.com', privateKey: pem, fetchFn: g.fetch });
  await assert.rejects(bad.getToken(), (e) => e.code === 'GOOGLE_AUTH_REVOKED' || e.code === 'GOOGLE_AUTH_FAILED');
  // Selection from config.
  const viaCfg = providerFromConfig({ googleAuthProvider: 'service_account', googleServiceAccountJson: JSON.stringify({ client_email: 'sa@proj.iam.gserviceaccount.com', private_key: pem }) }, g.fetch);
  assert.equal(viaCfg.kind, 'service-account');
  assert.equal(providerFromConfig({ googleClientId: g.clientId, googleClientSecret: g.clientSecret, googleRefreshToken: g.refreshToken }, g.fetch).kind, 'oauth-refresh');
  assert.throws(() => providerFromConfig({ googleAuthProvider: 'service_account', googleServiceAccountJson: '{bad' }, g.fetch), (e) => e.code === 'GOOGLE_NOT_CONFIGURED');
});

// ------------------------------------------------------------------ OIDC
function login(over = {}) {
  const g = new FakeGoogle();
  const redirectUri = 'https://studio.example.com/auth/google/callback';
  const L = createGoogleLogin(Object.assign({ clientId: g.clientId, clientSecret: g.clientSecret, redirectUri, fetchFn: g.fetch, now: () => g.now() }, over));
  const go = async (who = { email: 'Admin@Example.com' }, tweak = {}) => {
    const s = L.start();
    const redirect = new URL(g.authorize(s.url, who));
    return L.finish({ code: redirect.searchParams.get('code'), state: redirect.searchParams.get('state'), bind: s.bind, ...tweak });
  };
  return { g, L, go };
}

test('Google login: authorization-code + PKCE; the e-mail comes from the verified ID token (lower-cased)', async () => {
  const { g, L, go } = login();
  const s = L.start();
  const u = new URL(s.url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'openid email', 'only the scopes needed to identify the user');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.ok(u.searchParams.get('state').length >= 32 && u.searchParams.get('nonce').length >= 32);
  assert.ok(!s.url.includes(g.clientSecret), 'the client secret never goes to the browser');
  const who = await go({ email: 'Admin@Example.com', name: 'Admin' });
  assert.equal(who.email, 'admin@example.com');
  assert.ok(who.sub);
  assert.ok(g.requests.some((r) => /oauth2\/v3\/certs/.test(r.url)), 'signature checked against Google keys');
});

test('Google login: every way an ID token or flow can be wrong is rejected', async () => {
  const mutate = (fn) => async () => { const t = login(); t.g.idTokenMutator = fn; return t.go(); };
  const cases = [
    ['wrong audience', mutate((c) => { c.aud = 'someone-elses-client'; }), /이 앱을 위한 것이 아닙니다/],
    ['wrong azp', mutate((c) => { c.azp = 'other'; }), /이 앱을 위한 것이 아닙니다/],
    ['wrong issuer', mutate((c) => { c.iss = 'https://evil.example.com'; }), /발급자/],
    ['expired', mutate((c) => { c.exp = Math.floor(Date.now() / 1000) - 3600; }), /만료/],
    ['issued in the future', mutate((c) => { c.iat = Math.floor(Date.now() / 1000) + 3600; }), /발급 시각/],
    ['wrong nonce', mutate((c) => { c.nonce = 'replayed'; }), /nonce/],
    ['e-mail not verified', mutate((c) => { c.email_verified = false; }), /이메일이 확인된/],
    ['no e-mail', mutate((c) => { delete c.email; }), /이메일이 확인된/],
    ['no subject', mutate((c) => { delete c.sub; }), /식별자/],
    ['alg=none', mutate((c, h) => { h.alg = 'none'; }), /서명 방식/],
    ['HS256 confusion', mutate((c, h) => { h.alg = 'HS256'; }), /서명 방식/],
    ['unknown key id', mutate((c, h) => { h.kid = 'unknown'; }), /서명 키/],
    ['signed by another key', async () => { const t = login(); t.g.signWithWrongKey = true; return t.go(); }, /서명이 올바르지 않습니다/],
  ];
  for (const [name, fn, re] of cases) await assert.rejects(fn(), (e) => e.code === 'LOGIN_DENIED' && re.test(e.message) && e.status === 401, name);
  // Garbage / tampered tokens.
  const { L, g } = login();
  await assert.rejects(L.verifyIdToken('a.b'), /형식/);
  await assert.rejects(L.verifyIdToken('x.y.z'), /읽을 수 없습니다/);
  const good = g.signJwt({ iss: 'https://accounts.google.com', aud: g.clientId, sub: '1', email: 'a@b.c', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 });
  const [h, p, s] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'evil@x.y' })).toString('base64url');
  await assert.rejects(L.verifyIdToken(h + '.' + forged + '.' + s), /서명이 올바르지 않습니다/);
  assert.ok((await L.verifyIdToken(good)).email);
});

test('Google login: state is single-use, bound to the browser, expires; denied/cancelled and missing code are rejected', async () => {
  const t = login();
  // replay of the same callback
  const s = t.L.start();
  const redirect = new URL(t.g.authorize(s.url, { email: 'a@example.com' }));
  const args = { code: redirect.searchParams.get('code'), state: redirect.searchParams.get('state'), bind: s.bind };
  await t.L.finish(args);
  await assert.rejects(t.L.finish(args), /만료되었거나 이미 사용/);
  // another browser (wrong bind cookie): login CSRF
  const s2 = t.L.start();
  const r2 = new URL(t.g.authorize(s2.url, { email: 'a@example.com' }));
  await assert.rejects(t.L.finish({ code: r2.searchParams.get('code'), state: r2.searchParams.get('state'), bind: 'attacker-cookie' }), /이 브라우저에서 시작한/);
  await assert.rejects(t.L.finish({ code: 'x', state: 'unknown-state', bind: 'x' }), /만료되었거나 이미 사용/);
  // user pressed cancel at Google
  const s3 = t.L.start();
  await assert.rejects(t.L.finish({ error: 'access_denied', state: new URL(s3.url).searchParams.get('state'), bind: s3.bind }), /취소되었거나 거부/);
  // no code
  const s4 = t.L.start();
  await assert.rejects(t.L.finish({ state: new URL(s4.url).searchParams.get('state'), bind: s4.bind }), /인증 코드가 없습니다/);
  // code exchange with a wrong PKCE verifier / used code is refused by Google
  const s5 = t.L.start();
  const r5 = new URL(t.g.authorize(s5.url, { email: 'a@example.com' }));
  const code5 = r5.searchParams.get('code');
  await t.L.finish({ code: code5, state: r5.searchParams.get('state'), bind: s5.bind });
  const s6 = t.L.start();
  await assert.rejects(t.L.finish({ code: code5, state: new URL(s6.url).searchParams.get('state'), bind: s6.bind }), /받아들이지 않았습니다/);
  // expiry of the pending state
  let clock = Date.now();
  const e = login({ now: () => clock });
  const s7 = e.L.start();
  const r7 = new URL(e.g.authorize(s7.url, { email: 'a@example.com' }));
  clock += 11 * 60 * 1000;
  await assert.rejects(e.L.finish({ code: r7.searchParams.get('code'), state: r7.searchParams.get('state'), bind: s7.bind }), /만료/);
  assert.throws(() => createGoogleLogin({ clientId: 'x' }), (er) => er.code === 'GOOGLE_LOGIN_NOT_CONFIGURED');
});

test('Google login: Google signing keys are cached, and re-fetched once when a new key id appears (key rotation)', async () => {
  const t = login();
  await t.go();
  await t.go();
  assert.equal(t.g.count(/oauth2\/v3\/certs/), 1, 'JWKS cached');
  // Google rotates: new key id with a new key pair.
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  t.g.signing = { kid: 'kid-2', privateKey: kp.privateKey, jwk: Object.assign(kp.publicKey.export({ format: 'jwk' }), { kid: 'kid-2', alg: 'RS256' }) };
  const who = await t.go({ email: 'a@example.com' });
  assert.equal(who.email, 'a@example.com');
  assert.equal(t.g.count(/oauth2\/v3\/certs/), 2);
});

// ------------------------------------------------------------------ Sheets
const HEAD = { name: 'ST_T', headers: ['id', 'rev', 'json_0'] };

test('Sheets: tabs are created, headers only ever extended, an incompatible existing tab is never overwritten', async () => {
  const { g, http } = env();
  g.addSpreadsheet('S1', { PRODUCTS: [['상품ID', '상품명'], ['PRD-001', '우산']], REELS: [['릴스ID']] });
  const sheets = createSheetsApi({ http, spreadsheetId: 'S1' });
  const r = await sheets.ensureTabs([HEAD]);
  assert.deepEqual(r.created, ['ST_T']);
  assert.deepEqual(g.rows('S1', 'ST_T')[0], ['id', 'rev', 'json_0']);
  assert.equal(g.spreadsheets.get('S1').get('ST_T').cols >= 26, true);
  // Idempotent.
  assert.deepEqual((await sheets.ensureTabs([HEAD])).created, []);
  // Additive: a newer schema adds a column on the right.
  await sheets.ensureTabs([{ name: 'ST_T', headers: ['id', 'rev', 'json_0', 'json_1'] }]);
  assert.deepEqual(g.rows('S1', 'ST_T')[0], ['id', 'rev', 'json_0', 'json_1']);
  // Legacy tabs are untouched.
  assert.deepEqual(g.rows('S1', 'PRODUCTS'), [['상품ID', '상품명'], ['PRD-001', '우산']]);
  // An existing tab whose headers conflict is refused, not rewritten.
  await assert.rejects(sheets.ensureTabs([{ name: 'PRODUCTS', headers: ['id', 'rev'] }]), (e) => e.code === 'SCHEMA_CONFLICT');
  assert.deepEqual(g.rows('S1', 'PRODUCTS')[0], ['상품ID', '상품명']);
});

test('Sheets: RAW append / update / read; row numbers; Korean text; 50k-character cell limit surfaces before the request', async () => {
  const { g, http } = env();
  g.addSpreadsheet('S1', {});
  const sheets = createSheetsApi({ http, spreadsheetId: 'S1' });
  await sheets.ensureTabs([HEAD]);
  const first = await sheets.appendRows('ST_T', [['a', 1, '{"한글":"값"}'], ['b', 2, '=1+1']]);
  assert.equal(first, 2);
  assert.equal(await sheets.appendRows('ST_T', [['c', 3, '']]), 4);
  await sheets.updateRows('ST_T', [{ row: 3, values: ['b', 9, '+SUM(1)'] }]);
  const all = await sheets.readTab('ST_T');
  assert.deepEqual(all, [['id', 'rev', 'json_0'], ['a', 1, '{"한글":"값"}'], ['b', 9, '+SUM(1)'], ['c', 3]]);
  assert.equal(g.rows('S1', 'ST_T')[2][2], '+SUM(1)', 'RAW: never interpreted as a formula');
  assert.deepEqual(await sheets.readRows('ST_T', [2, 4]), [['a', 1, '{"한글":"값"}'], ['c', 3]]);
  await assert.rejects(sheets.appendRows('ST_T', [['x', 1, 'y'.repeat(50001)]]), (e) => e.code === 'CELL_TOO_LARGE');
  assert.equal(colName(1), 'A');
  assert.equal(colName(27), 'AA');
  assert.equal(colName(52), 'AZ');
  assert.throws(() => createSheetsApi({ http, spreadsheetId: '' }), (e) => e.code === 'GOOGLE_NOT_CONFIGURED');
});

// ------------------------------------------------------------------ Drive
test('Drive: folders are found or created once, even when requested concurrently; paths nest', async () => {
  const { g, http } = env();
  const drive = createDriveApi({ http });
  const root = (await http.request('POST', 'https://www.googleapis.com/drive/v3/files?fields=id', { json: { name: 'root', mimeType: 'application/vnd.google-apps.folder' } })).id;
  const ids = await Promise.all([drive.ensureFolder('products', root), drive.ensureFolder('products', root), drive.ensureFolder('products', root)]);
  assert.equal(new Set(ids).size, 1);
  assert.equal(g.driveFiles().filter((f) => f.name === 'products').length, 1);
  // a second process instance finds it instead of creating another
  const other = createDriveApi({ http });
  assert.equal(await other.ensureFolder('products', root), ids[0]);
  assert.equal(g.driveFiles().filter((f) => f.name === 'products').length, 1);
  const leaf = await drive.ensurePath(root, ['episodes', 'EP01', 'clips']);
  assert.equal(g.files.get(leaf).name, 'clips');
  assert.equal(await drive.ensurePath(root, ['episodes', 'EP01', 'clips']), leaf);
  // names with quotes are escaped in queries
  const q = await drive.ensureFolder("Diane's \\ folder", root);
  assert.equal(await createDriveApi({ http }).ensureFolder("Diane's \\ folder", root), q);
});

test('Drive: resumable upload in 256 KiB-multiple chunks, MD5 verified; a corrupted upload is trashed and reported', async () => {
  const { g, http } = env();
  const drive = createDriveApi({ http, chunkBytes: 256 * 1024 });
  const parent = await drive.ensureFolder('p', (await http.request('POST', 'https://www.googleapis.com/drive/v3/files?fields=id', { json: { name: 'r', mimeType: 'application/vnd.google-apps.folder' } })).id);
  const data = crypto.randomBytes(600 * 1024);
  const meta = await drive.upload({ name: 'clip.mp4', parentId: parent, mimeType: 'video/mp4', buffer: data, appProperties: { rfSha256: 'abc' } });
  assert.equal(meta.md5Checksum, crypto.createHash('md5').update(data).digest('hex'));
  assert.equal(Number(meta.size), data.length);
  assert.deepEqual(g.requests.filter((r) => r.method === 'PUT').map((r) => r.headers['content-range']), [`bytes 0-262143/${data.length}`, `bytes 262144-524287/${data.length}`, `bytes 524288-${data.length - 1}/${data.length}`]);
  assert.deepEqual(g.files.get(meta.id).parents, [parent]);
  // from a file path (no whole-file read into memory)
  const f = path.join(tmp(), 'a.bin');
  fs.writeFileSync(f, data);
  const m2 = await drive.upload({ name: 'a.bin', parentId: parent, filePath: f });
  assert.equal(g.files.get(m2.id).bytes.equals(data), true);
  // Drive stores different bytes than we sent → integrity error, bad copy trashed
  g.corruptNextUpload = true;
  await assert.rejects(drive.upload({ name: 'bad.bin', parentId: parent, buffer: data }), (e) => e.code === 'UPLOAD_INTEGRITY');
  assert.equal(g.driveFiles().find((x) => x.name === 'bad.bin').trashed, true);
  await assert.rejects(drive.upload({ name: 'e', parentId: parent, buffer: Buffer.alloc(0) }), (e) => e.code === 'EMPTY_FILE');
});

test('Drive: an upload interrupted mid-way asks Drive where it stopped and resumes (no restart, no duplicate)', async () => {
  const { g, http } = env({ maxRetries: 0 });
  const drive = createDriveApi({ http, chunkBytes: 256 * 1024 });
  const parent = (await http.request('POST', 'https://www.googleapis.com/drive/v3/files?fields=id', { json: { name: 'r', mimeType: 'application/vnd.google-apps.folder' } })).id;
  const data = crypto.randomBytes(700 * 1024);
  let failed = false;
  g.fault = (req) => (req.method === 'PUT' && /bytes 262144-/.test(req.headers['content-range'] || '') && !failed ? ((failed = true), 503) : 0);
  const meta = await drive.upload({ name: 'resume.bin', parentId: parent, buffer: data });
  assert.equal(g.files.get(meta.id).bytes.equals(data), true);
  assert.equal(g.driveFiles().filter((f) => f.name === 'resume.bin').length, 1);
  assert.ok(g.requests.some((r) => r.method === 'PUT' && r.headers['content-range'] === `bytes */${data.length}`), 'status query was sent');
});

test('Drive: lookup by content-hash property (idempotent re-upload), verified downloads, drive.file visibility', async () => {
  const { g, http } = env();
  const drive = createDriveApi({ http, chunkBytes: 256 * 1024 });
  const root = (await http.request('POST', 'https://www.googleapis.com/drive/v3/files?fields=id', { json: { name: 'r', mimeType: 'application/vnd.google-apps.folder' } })).id;
  const data = crypto.randomBytes(300 * 1024);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const meta = await drive.upload({ name: 'x.png', parentId: root, mimeType: 'image/png', buffer: data, appProperties: { rfSha256: sha } });
  assert.deepEqual((await drive.findByAppProperty('rfSha256', sha)).map((f) => f.id), [meta.id]);
  assert.deepEqual(await drive.findByAppProperty('rfSha256', 'nothing'), []);
  assert.equal((await drive.download(meta.id)).equals(data), true);
  const dest = path.join(tmp(), 'sub', 'x.png');
  await drive.downloadToFile(meta.id, dest, { md5: meta.md5Checksum, size: data.length });
  assert.equal(fs.readFileSync(dest).equals(data), true);
  // Wrong checksum: nothing is left behind.
  const dest2 = path.join(tmp(), 'y.png');
  await assert.rejects(drive.downloadToFile(meta.id, dest2, { md5: '0'.repeat(32) }), (e) => e.code === 'DOWNLOAD_INTEGRITY');
  assert.equal(fs.existsSync(dest2), false);
  assert.deepEqual(fs.readdirSync(path.dirname(dest2)), []);
  // With the drive.file scope the app cannot see files it did not create (e.g. the legacy Apps Script folders).
  const legacy = g.seedDriveFile({ name: 'S1.mp4', bytes: 'legacy' });
  await assert.rejects(drive.meta(legacy), (e) => e.status === 404);
  assert.equal((await drive.list(`name = 'S1.mp4' and trashed = false`)).length, 0);
  g.driveScope = 'full';
  assert.equal((await drive.meta(legacy)).name, 'S1.mp4');
  assert.throws(() => createDriveApi({ http, chunkBytes: 1000 }), /256 KiB/);
});
