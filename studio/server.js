#!/usr/bin/env node
// Reels Factory Studio — local web server (no dependencies).
//   node studio/server.js            → http://127.0.0.1:4173   (MOCK mode unless RF_MUAPI_MODE=live)
// API keys (MUAPI_API_KEY, HEYGEN_API_KEY) are read from renderer/.env or the environment by THIS process only.
// No response ever contains a key. Binds to 127.0.0.1 by default; mutating requests need a custom header and a
// same-origin Origin, and an optional RF_STUDIO_TOKEN protects everything else.
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../renderer/lib/config');
const { createStudio } = require('./lib/studio');
const { StudioError } = require('./lib/util');
const { ProviderError } = require('./lib/providers');
const { createSheetsBridge } = require('./lib/sheets-bridge');

const VERSION = require('../package.json').version;
const BUILD = require('./lib/buildinfo').read();

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const MAX_JSON = 2 * 1024 * 1024;
const MAX_UPLOAD = 60 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(new StudioError('TOO_LARGE', `요청이 너무 큽니다 (최대 ${Math.round(limit / 1048576)} MB).`, { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function sendFile(req, res, file, { download = false, filename = '' } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다.' } });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
  if (type.startsWith('text/html')) {
    headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    headers['X-Frame-Options'] = 'DENY';
    headers['Referrer-Policy'] = 'no-referrer';
  }
  if (download) headers['Content-Disposition'] = 'attachment; filename="' + String(filename || path.basename(file)).replace(/[^A-Za-z0-9._-]/g, '_') + '"';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
  fs.createReadStream(file).pipe(res);
}

// ---------- login (cloud) ----------
// A signed, HttpOnly, SameSite=Strict session cookie. The signing key is derived from RF_MASTER_KEY (or the admin password).
// Failed logins are rate-limited per client IP. Local use without RF_ADMIN_PASSWORD keeps the old behaviour (loopback only).
function createAuth({ password = '', secret = '', ttlMs = 12 * 3600 * 1000, now = () => Date.now() } = {}) {
  const enabled = !!password;
  const key = crypto.createHash('sha256').update('rf-session|' + (secret || password)).digest();
  const sign = (p) => crypto.createHmac('sha256', key).update(p).digest('base64url');
  const fails = new Map();
  const eq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(); const y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
  return {
    enabled,
    attempt(ip, supplied) {
      const f = fails.get(ip) || { n: 0, until: 0, first: now() };
      if (f.until > now()) throw new StudioError('RATE_LIMITED', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', { status: 429 });
      if (!eq(supplied || '', password)) {
        f.n += 1;
        if (now() - f.first > 10 * 60 * 1000) { f.n = 1; f.first = now(); }
        if (f.n >= 5) { f.until = now() + 10 * 60 * 1000; f.n = 0; f.first = now(); }
        fails.set(ip, f);
        throw new StudioError('LOGIN_FAILED', '비밀번호가 올바르지 않습니다.', { status: 401 });
      }
      fails.delete(ip);
      const payload = `${now() + ttlMs}.${crypto.randomBytes(8).toString('hex')}`;
      return payload + '.' + sign(payload);
    },
    verify(cookie) {
      if (!enabled) return true;
      const m = /^(\d+)\.([0-9a-f]+)\.([A-Za-z0-9_-]+)$/.exec(cookie || '');
      if (!m) return false;
      const payload = m[1] + '.' + m[2];
      return eq(sign(payload), m[3]) && Number(m[1]) > now();
    },
    ttlMs,
  };
}

const RAILWAY_HEALTHCHECK_HOST = 'healthcheck.railway.app'; // https://docs.railway.com/deployments/healthchecks

function createApp(studio, { token = '', port = 0, host = '127.0.0.1', log = () => {}, bridge = null, auth = createAuth(), publicHost = '' } = {}) {
  const S = studio;
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, '([^/]+)') + '$'), names: (pattern.match(/:[a-zA-Z]+/g) || []).map((s) => s.slice(1)), handler, opts });
  const ep = (id) => S.episodeView(id);
  const bg = (promise, label) => promise.catch((e) => log(label + ': ' + e.message)); // background work: errors are stored in the episode

  // ---- session / health ----
  route('GET', '/healthz', async () => ({ ok: true, version: VERSION, build: { sha: BUILD.sha, shortSha: BUILD.shortSha, source: BUILD.source, branch: BUILD.branch }, schemaVersion: (require('./lib/util').readJson(S.store.path('schema.json'), {}) || {}).schemaVersion || null, video: S.video.mode, voice: S.voice.mode, time: new Date().toISOString() }));
  route('GET', '/api/session', async ({ cookie }) => ({ authRequired: auth.enabled, authenticated: auth.verify(cookie) }));
  route('POST', '/api/login', async ({ body, ip, res, secure }) => {
    const v = auth.attempt(ip, body.password);
    res.setHeader('Set-Cookie', `rf_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(auth.ttlMs / 1000)}${secure ? '; Secure' : ''}`);
    return { ok: true };
  });
  route('POST', '/api/logout', async ({ res }) => { res.setHeader('Set-Cookie', 'rf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; });

  // ---- products / reference images ----
  route('GET', '/api/products', async () => S.products.list());
  route('POST', '/api/products', async ({ body }) => S.products.create(body));
  route('GET', '/api/products/:id', async ({ p }) => S.products.get(p.id));
  route('PUT', '/api/products/:id', async ({ p, body }) => S.products.edit(p.id, body));
  route('POST', '/api/products/:id/extract', async ({ p }) => S.products.extract(p.id));
  route('POST', '/api/products/:id/reviews/image', async ({ p, raw, headers }) => S.products.uploadReview(p.id, raw, decodeURIComponent(headers['x-filename'] || 'review.png')), { upload: true });
  route('PUT', '/api/products/:id/reviews', async ({ p, body }) => S.products.saveReviews(p.id, body.text));
  route('POST', '/api/products/:id/reviews/estimate', async ({ p }) => S.products.reviewsEstimate(p.id));
  route('POST', '/api/products/:id/reviews/analyze', async ({ p, body }) => S.products.analyzeReviews(p.id, body.confirm));
  route('POST', '/api/products/:id/reviews/approve', async ({ p, body }) => S.products.approveReviews(p.id, body.approved === true));
  route('POST', '/api/products/:id/images/approve-uploaded', async ({ p, body }) => S.products.approveUploadedImages(p.id, body.imageIds));
  route('POST', '/api/products/:id/images', async ({ p, raw, headers, query }) => S.products.upload(p.id, raw, decodeURIComponent(headers['x-filename'] || 'image.png'), { label: query.label, source: query.source }), { upload: true });
  route('POST', '/api/products/:id/images/generate', async ({ p, body }) => S.products.generateImage(p.id, { basedOn: body.basedOn || [], extraImageIds: body.extraImageIds || [], style: body.style || 'anime', prompt: body.prompt, confirm: body.confirm }));
  route('POST', '/api/products/:id/images/:iid/choose', async ({ p }) => S.products.chooseVersion(p.id, p.iid));
  route('POST', '/api/products/:id/images/estimate', async ({ p, body }) => S.router.estimate('imageGeneration', { inputChars: 1200, outputTokens: 1500, images: Math.max(1, (body.basedOn || body.extraImageIds) ? S.products.imageCount(p.id, { basedOn: body.basedOn || [], extraImageIds: body.extraImageIds || [] }) : 2) }));
  route('POST', '/api/products/:id/images/:iid/replace', async ({ p, raw, headers, query }) => S.products.replace(p.id, p.iid, raw, decodeURIComponent(headers['x-filename'] || 'image.png'), { confirm: query.confirm === '1', source: query.source }), { upload: true });
  route('PUT', '/api/products/:id/images/order', async ({ p, body }) => S.products.reorderImages(p.id, body.ids));
  route('POST', '/api/products/:id/images/:iid/primary', async ({ p }) => S.products.setPrimary(p.id, p.iid));
  route('POST', '/api/products/:id/images/:iid/remove', async ({ p, body }) => S.products.removeImage(p.id, p.iid, { confirm: body.confirm === true }));
  route('POST', '/api/products/:id/images/:iid/status', async ({ p, body }) => S.products.setStatus(p.id, p.iid, body.status));
  route('GET', '/api/products/:id/analysis', async ({ p }) => S.productAnalysis.view(p.id));
  route('POST', '/api/products/:id/analysis/estimate', async ({ p, body }) => S.productAnalysis.estimate(p.id, { imageIds: body.imageIds }));
  route('POST', '/api/products/:id/analysis/generate', async ({ p, body }) => S.productAnalysis.generate(p.id, { imageIds: body.imageIds, confirm: body.confirm }));
  route('PUT', '/api/products/:id/analysis/:v', async ({ p, body }) => S.productAnalysis.edit(p.id, Number(p.v), body.text));
  route('POST', '/api/products/:id/analysis/:v/approve', async ({ p }) => S.productAnalysis.approve(p.id, Number(p.v)));
  route('POST', '/api/products/:id/analysis/:v/develop/estimate', async ({ p, body }) => S.productAnalysis.developEstimate(p.id, Number(p.v), body.feedback));
  route('POST', '/api/products/:id/analysis/:v/develop', async ({ p, body }) => S.productAnalysis.develop(p.id, Number(p.v), body.feedback, body.confirm));
  route('POST', '/api/products/:id/references/approve', async ({ p, body }) => S.products.approveReferenceSet(p.id, { imageIds: body.imageIds }));
  route('POST', '/api/products/:id/references/waive', async ({ p, body }) => S.products.waiveReferences(p.id, body.reason));

  // ---- Story Lab ----
  route('GET', '/api/storylab/:pid', async ({ p }) => S.storylab.list(p.pid));
  // ---- character universes / library / cast (no AI calls anywhere in these routes) ----
  route('GET', '/api/universes', async () => S.universes.overview());
  route('POST', '/api/universes', async ({ body }) => S.universes.createUniverse(body));
  route('PUT', '/api/universes/:id', async ({ p, body }) => S.universes.editUniverse(p.id, body));
  route('DELETE', '/api/universes/:id', async ({ p }) => S.universes.deleteUniverse(p.id));
  route('POST', '/api/characters', async ({ body }) => S.characterView(S.universes.createCharacter(body)));
  route('DELETE', '/api/characters/:id', async ({ p }) => S.universes.deleteCharacter(p.id));
  route('GET', '/api/storylab/:pid/cast', async ({ p }) => S.storylab.castState(p.pid));
  route('PUT', '/api/storylab/:pid/cast', async ({ p, body }) => S.storylab.saveCast(p.pid, body));
  route('POST', '/api/storylab/:pid/preview', async ({ p, body }) => S.storylab.preview(p.pid, body));
  route('POST', '/api/storylab/:pid/estimate', async ({ p, body }) => S.storylab.estimate(p.pid, { category: body.category, cast: body.cast, count: body.count, maxDurationSec: body.maxDurationSec, extra: body.extra }));
  route('POST', '/api/storylab/:pid/generate', async ({ p, body }) => S.storylab.generate(p.pid, { category: body.category, cast: body.cast, count: body.count, maxDurationSec: body.maxDurationSec, extra: body.extra, confirm: body.confirm }));
  route('POST', '/api/storylab/:pid/concepts/:cid/regenerate', async ({ p, body }) => S.storylab.regenerate(p.pid, p.cid, { feedback: body.feedback, confirm: body.confirm }));
  route('PUT', '/api/storylab/:pid/concepts/:cid', async ({ p, body }) => S.storylab.edit(p.pid, p.cid, body));
  route('POST', '/api/storylab/:pid/concepts/:cid/refine/estimate', async ({ p, body }) => S.storylab.refineEstimate(p.pid, p.cid, body || {}));
  route('POST', '/api/storylab/:pid/concepts/:cid/refine', async ({ p, body }) => S.storylab.refine(p.pid, p.cid, body || {}));
  route('POST', '/api/storylab/:pid/concepts/:cid/approve', async ({ p }) => S.storylab.approve(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/revoke', async ({ p }) => S.storylab.revoke(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/reject', async ({ p, body }) => S.storylab.reject(p.pid, p.cid, body.reason));
  route('POST', '/api/storylab/:pid/concepts/:cid/hold', async ({ p, body }) => S.storylab.hold(p.pid, p.cid, body && body.reason, 'operator', { confirmApproved: !!(body && body.confirmApproved) }));
  route('POST', '/api/storylab/:pid/concepts/:cid/resume', async ({ p }) => S.storylab.resume(p.pid, p.cid));
  route('DELETE', '/api/storylab/:pid/concepts/:cid', async ({ p, body }) => S.storylab.remove(p.pid, p.cid, 'operator', { confirmApproved: !!(body && body.confirmApproved) }));
  route('POST', '/api/storylab/:pid/concepts/:cid/restore', async ({ p }) => S.storylab.restore(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/reopen', async ({ p }) => S.storylab.reopen(p.pid, p.cid));
  route('POST', '/api/storylab/:pid/concepts/:cid/episode', async ({ p, body }) => { const id = await S.createEpisodeFromConcept({ productId: p.pid, conceptId: p.cid, newVersion: body.newVersion === true, requestId: String(body.requestId || '').slice(0, 80), approveEndingCast: body.approveEndingCast === true }); return ep(id); });

  // ---- Settings: AI integrations / prompts ----
  route('GET', '/api/ai', async () => S.integrations.overview());
  route('PUT', '/api/ai/keys/:prov', async ({ p, body }) => S.integrations.setKey(p.prov, body.key));
  route('DELETE', '/api/ai/keys/:prov', async ({ p }) => S.integrations.removeKey(p.prov));
  route('POST', '/api/ai/test/:prov', async ({ p, body }) => S.integrations.test(p.prov, body.model));
  route('PUT', '/api/ai/models/:prov', async ({ p, body }) => S.integrations.setModel(p.prov, body.model));
  route('PUT', '/api/ai/routing/:task', async ({ p, body }) => S.integrations.setRouting(p.task, body));
  route('PUT', '/api/ai/pricing', async ({ body }) => S.integrations.setPricing(body.provider, body.model, body));
  route('PUT', '/api/ai/limits', async ({ body }) => S.integrations.setLimits(body));
  route('PUT', '/api/ai/mode/:prov', async ({ p, body }) => S.integrations.setMode(p.prov, body.mode, { confirm: body.confirm }));
  route('GET', '/api/ai/usage', async ({ query }) => S.integrations.usageView(Number(query.limit) || 100));
  route('GET', '/api/ai/audit', async () => S.integrations.auditLog());
  route('GET', '/api/prompts', async () => ({ channel: S.prompts.channel(), prompts: S.prompts.list() }));
  route('PUT', '/api/channel', async ({ body }) => S.prompts.saveChannel(body));
  route('GET', '/api/prompts/:key', async ({ p }) => S.prompts.get(p.key));
  route('PUT', '/api/prompts/:key', async ({ p, body }) => S.prompts.save(p.key, body));
  route('POST', '/api/prompts/:key/restore', async ({ p, body }) => S.prompts.restore(p.key, body));
  route('GET', '/api/prompts/:key/versions/:v', async ({ p }) => ({ key: p.key, v: Number(p.v), text: S.prompts.versionText(p.key, p.v) }));
  route('POST', '/api/prompts/:key/preview', async ({ p, body }) => ({ text: S.prompts.preview(p.key, body.vars || {}) }));

  // ---- script generation from the approved concept ----
  route('POST', '/api/episodes/:id/script/generate', async ({ p, body }) => { S.assertNotHeld(p.id); const r = await S.scriptgen.generate(p.id, { confirm: body.confirm, overwrite: body.overwrite === true, extra: body.extra }); const v = ep(p.id); v.generated = r; return v; });
  // ---- AI 프롬프트 관리: script prompt presets (editable creative text; safety constraints stay in code) ----
  route('GET', '/api/script-presets', async () => S.presets.list());
  route('PUT', '/api/script-presets/active', async ({ body }) => S.presets.setActive(body.presetId));
  route('GET', '/api/script-presets/:id', async ({ p }) => S.presets.get(p.id));
  route('GET', '/api/script-presets/:id/versions/:v', async ({ p }) => ({ sections: S.presets.versionSections(p.id, p.v) }));
  route('PUT', '/api/script-presets/:id', async ({ p, body }) => S.presets.save(p.id, { sections: body.sections, name: body.name, note: body.note }));
  route('POST', '/api/script-presets/:id/duplicate', async ({ p, body }) => S.presets.duplicate(p.id, { name: body.name }));
  route('POST', '/api/script-presets/:id/restore', async ({ p, body }) => S.presets.restore(p.id, { version: body.version, toDefault: body.toDefault === true }));
  route('PUT', '/api/episodes/:id/script/preset', async ({ p, body }) => { await S.scriptgen.selectPreset(p.id, body); return ep(p.id); });
  route('POST', '/api/episodes/:id/script/prompt', async ({ p, body }) => S.scriptgen.effectivePrompt(p.id, body.preset, body.extra, body.action));
  route('POST', '/api/episodes/:id/script/test', async ({ p, body }) => S.scriptgen.testPrompt(p.id, { sel: body.preset, confirm: body.confirm, extra: body.extra }));
  route('GET', '/api/episodes/:id/script/tests', async ({ p }) => ({ tests: S.scriptgen.listTests(p.id) }));
  // ---- fixed episode formula: ending templates + separate regeneration actions ----
  route('GET', '/api/ending-templates', async () => S.endings.list());
  route('PUT', '/api/ending-templates/active', async ({ body }) => S.endings.setActive(body.templateId));
  route('GET', '/api/ending-templates/:id', async ({ p }) => S.endings.get(p.id));
  route('GET', '/api/ending-templates/:id/versions/:v', async ({ p }) => S.endings.versionData(p.id, p.v));
  route('PUT', '/api/ending-templates/:id', async ({ p, body }) => S.endings.save(p.id, { shots: body.shots, structureLocked: body.structureLocked, name: body.name, note: body.note }));
  route('POST', '/api/ending-templates/:id/duplicate', async ({ p, body }) => S.endings.duplicate(p.id, { name: body.name }));
  route('POST', '/api/ending-templates/:id/restore', async ({ p, body }) => S.endings.restore(p.id, { version: body.version, toDefault: body.toDefault === true }));
  route('PUT', '/api/episodes/:id/script/ending', async ({ p, body }) => { await S.scriptgen.selectEnding(p.id, { templateId: body.templateId, version: body.version, resetEdits: body.resetEdits === true }); return ep(p.id); });
  route('POST', '/api/episodes/:id/script/ending/reuse', async ({ p, body }) => { const r = await S.reuseEndingAssets(p.id, body.fromEpisodeId); const v = ep(p.id); v.reuse = { copied: r.copied, skipped: r.skipped }; return v; });
  route('POST', '/api/episodes/:id/script/regenerate', async ({ p, body }) => { const r = await S.scriptgen.regenerate(p.id, body.action, { confirm: body.confirm, overwrite: body.overwrite === true, extra: body.extra }); const v = ep(p.id); v.generated = r; return v; });
  route('POST', '/api/episodes/:id/script/timing/estimate', async ({ p, body }) => S.scriptgen.fitEstimate(p.id, body.sceneIds, body.preset));
  route('POST', '/api/episodes/:id/script/timing/fit', async ({ p, body }) => { const r = await S.scriptgen.fitDialogue(p.id, { sceneIds: body.sceneIds, confirm: body.confirm, overwrite: body.overwrite === true, extra: body.extra, sel: body.preset }); const v = ep(p.id); v.fitResult = r; return v; });
  route('POST', '/api/episodes/:id/script/estimate', async ({ p, body }) => { const e = S.store.episodes.get(p.id); const c = S.storylab.requireApproved(e.concept && e.concept.productId, e.concept && e.concept.conceptId); const q = S.scriptgen.buildPrompt(e, c, body.extra, body.preset, body.action); return S.router.estimate('scriptWriting', { inputChars: q.prompt.length, outputTokens: 6000, override: q.composed.providerOverride || undefined }); });

  // ---- state ----
  route('GET', '/api/sheets/status', async () => ({ enabled: !!(bridge && bridge.enabled), note: 'Studio is authoritative; Sheets receives a read-only mirror of Studio episodes.' }));
  route('POST', '/api/sheets/sync', async () => {
    if (!bridge || !bridge.enabled) throw new StudioError('NOT_CONFIGURED', 'Sheets bridge URL/token are not configured.', {status:400});
    const episodes = S.store.episodes.list();
    const results = [];
    for (const e of episodes) {
      try { await bridge.push(e); results.push({id:e.id,ok:true}); }
      catch(err) { results.push({id:e.id,ok:false,error:err.message}); }
    }
    return { synced:results.filter(x=>x.ok).length, total:results.length, results };
  });
  route('GET', '/api/state', async () => S.summary());
  route('GET', '/api/episodes/:id', async ({ p }) => ep(p.id));
  route('POST', '/api/episodes', async ({ body }) => {
    if (body.conceptId) return ep(await S.createEpisodeFromConcept({ productId: body.productId, conceptId: body.conceptId, id: body.id }));
    if (body.manual !== true) throw new StudioError('CONCEPT_REQUIRED', '에피소드는 승인된 스토리 컨셉에서 시작해야 합니다 (제품 → 스토리 컨셉 → 대본).', { recovery: 'Story Lab에서 컨셉을 승인한 뒤 "이 컨셉으로 에피소드 만들기"를 누르세요.', status: 409 });
    await S.createEpisode(body);
    return ep(body.id);
  });

  // ---- script ----
  route('PUT', '/api/episodes/:id/script', async ({ p, body }) => S.saveScript(p.id, body, 'operator', body.note));
  route('POST', '/api/episodes/:id/script/approve', async ({ p }) => S.approveScript(p.id));
  // ---- projects, scene approval, Image Development hand-off (none of these can spend money) ----
  route('GET', '/api/projects', async () => ({ projects: S.projects.listProjects() }));
  // ---- 씬 다시 생성하기 (one scene, from its 시각 연출 · 액션): proposal → review → accept / cancel ----
  route('POST', '/api/episodes/:id/scenes/:sid/regenerate/estimate', async ({ p, body }) => S.sceneRegen.estimate(p.id, p.sid, { visual: body.visual, action: body.action }));
  route('POST', '/api/episodes/:id/scenes/:sid/regenerate', async ({ p, body }) => { await S.sceneRegen.regenerate(p.id, p.sid, { visual: body.visual, action: body.action, confirm: body.confirm }); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/regenerate/accept', async ({ p }) => { await S.sceneRegen.accept(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/regenerate/cancel', async ({ p }) => { await S.sceneRegen.cancel(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/approve', async ({ p }) => { await S.projects.approveScene(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/revoke', async ({ p }) => { await S.projects.revokeScene(p.id, p.sid); return ep(p.id); });
  route('GET', '/api/episodes/:id/scenes/:sid/history', async ({ p }) => S.projects.sceneHistory(p.id, p.sid));
  // ---- insert shots (컷 추가): crops of the approved clip; free ----
  route('GET', '/api/cut-presets', async () => ({ builtIn: S.cutPresets.builtIn(), custom: S.cutPresets.list(), transitions: require('./lib/cuts').TRANSITIONS, limits: require('./lib/cuts').LIMITS }));
  route('POST', '/api/cut-presets', async ({ body }) => S.cutPresets.save({ id: body.id, name: body.name, preset: body.preset, transition: body.transition, durationSec: body.durationSec, crop: body.crop }));
  route('DELETE', '/api/cut-presets/:id', async ({ p }) => S.cutPresets.remove(p.id));
  route('PUT', '/api/episodes/:id/scenes/:sid/inserts', async ({ p, body }) => S.saveInserts(p.id, p.sid, body.inserts));
  route('GET', '/media/cutframe/:a/:b', async ({ p, query }) => ({ file: await S.cutFrame(p.a, p.b, query.t) }));
  route('GET', '/api/episodes-trash', async () => ({ trash: S.trashList() }));
  route('DELETE', '/api/episodes/:id', async ({ p, body }) => S.trashEpisode(p.id, { confirmPublished: !!(body && body.confirmPublished), confirmApproved: !!(body && body.confirmApproved) }));
  route('POST', '/api/episodes/:id/hold', async ({ p, body }) => S.holdEpisode(p.id, body && body.reason));
  route('POST', '/api/episodes/:id/resume', async ({ p }) => S.resumeEpisode(p.id));
  route('PUT', '/api/episodes/:id/outfit-lock', async ({ p, body }) => S.saveOutfitLock(p.id, body && body.selection, body && body.confirm));
  route('PUT', '/api/episodes/:id/meta', async ({ p, body }) => S.editEpisode(p.id, { title: body && body.title }));
  route('PUT', '/api/episodes/:id/category', async ({ p, body }) => S.setEpisodeCategory(p.id, body.category));
  // ---- storyboard assets: 0.5 s movement plan + B-roll library (no AI / video calls) ----
  route('PUT', '/api/episodes/:id/scenes/:sid/motion', async ({ p, body }) => { await S.sba.saveMotion(p.id, p.sid, { beats: body.beats, source: 'manual' }); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/motion/estimate', async ({ p }) => S.animplan.estimateAi(p.id, p.sid));
  route('POST', '/api/episodes/:id/scenes/:sid/motion/generate', async ({ p, body }) => { S.assertNotHeld(p.id); if (body.mode === 'ai') await S.animplan.generateAi(p.id, p.sid, { replace: body.replace === true, confirm: body.confirm }); else await S.animplan.generateRules(p.id, p.sid, { replace: body.replace === true }); return ep(p.id); });
  route('GET', '/api/episodes/:id/render-readiness', async ({ p }) => S.renderReadiness.check(S.store.episodes.get(p.id)));
  route('POST', '/api/episodes/:id/scenes/:sid/motion/draft', async ({ p }) => { await S.sba.draftMotion(p.id, p.sid); return ep(p.id); });
  route('GET', '/api/episodes/:id/broll', async ({ p }) => ({ broll: S.sba.brollView(S.store.episodes.get(p.id)) }));
  route('POST', '/api/episodes/:id/broll', async ({ p, body }) => { await S.sba.saveBroll(p.id, body || {}); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/broll/order', async ({ p, body }) => { await S.sba.reorderBroll(p.id, p.sid, body.ids); return ep(p.id); });
  route('POST', '/api/episodes/:id/broll/:bid/duplicate', async ({ p }) => { await S.sba.duplicateBroll(p.id, p.bid); return ep(p.id); });
  route('POST', '/api/episodes/:id/broll/suggest', async ({ p }) => { const made = await S.sba.suggestBroll(p.id); const v = ep(p.id); v.suggested = made.length; return v; });
  route('POST', '/api/episodes/:id/broll/:bid/status', async ({ p, body }) => { await S.sba.setBrollStatus(p.id, p.bid, body.status); return ep(p.id); });
  route('DELETE', '/api/episodes/:id/broll/:bid', async ({ p }) => { await S.sba.removeBroll(p.id, p.bid); return ep(p.id); });
  route('GET', '/api/episodes/:id/broll/:bid/image/plan', async ({ p, query }) => S.brollImages.plan(p.id, p.bid, { exclude: String(query.exclude || '').split(',').filter(Boolean) }));
  route('PUT', '/api/episodes/:id/broll/:bid/image/prompt', async ({ p, body }) => S.brollImages.savePrompt(p.id, p.bid, body || {}));
  route('DELETE', '/api/episodes/:id/broll/:bid/image/prompt', async ({ p }) => S.brollImages.resetPrompt(p.id, p.bid));
  route('POST', '/api/episodes/:id/broll/:bid/image/estimate', async ({ p, body }) => S.brollImages.estimate(p.id, p.bid, { force: body.force === true, overwriteApproved: body.overwriteApproved === true, exclude: body.exclude }));
  route('POST', '/api/episodes/:id/broll/:bid/image/generate', async ({ p, body }) => { S.assertNotHeld(p.id); await S.brollImages.generate(p.id, p.bid, { confirm: body.confirm, force: body.force === true, overwriteApproved: body.overwriteApproved === true, exclude: body.exclude }); return ep(p.id); });
  route('POST', '/api/episodes/:id/broll/:bid/image', async ({ p, raw, headers }) => { await S.sba.uploadBrollImage(p.id, p.bid, raw, decodeURIComponent(headers['x-filename'] || 'broll.png')); return ep(p.id); }, { upload: true });
  // ---- Coupang Partners performance: imported reports only (no scraping, no invented numbers) ----
  route('GET', '/api/performance', async ({ query }) => S.performance.summary({ from: query.from || '', to: query.to || '' }));
  route('POST', '/api/performance/import', async ({ raw, headers, query }) => {
    const mapping = query.mapping ? JSON.parse(query.mapping) : {};
    const p = S.performance.preview({ buffer: raw, filename: decodeURIComponent(headers['x-filename'] || ''), mapping });
    if (query.dryRun === '1') return Object.assign({}, p, { rows: p.rows.slice(0, 5), rowCount: p.rows.length, errors: p.errors.slice(0, 10), errorCount: p.errors.length, committed: false });
    const id = S.performance.commit(p);
    return Object.assign(S.performance.summary(), { importId: id, rowCount: p.rows.length, skipped: p.errors.length, committed: true });
  }, { upload: true });
  route('DELETE', '/api/performance/imports/:id', async ({ p }) => S.performance.removeImport(p.id));
  route('GET', '/api/episodes/:id/impact', async ({ p }) => S.episodeImpact(p.id));
  route('POST', '/api/episodes/:id/archive', async ({ p }) => S.archiveEpisode(p.id));
  route('POST', '/api/episodes/:id/unarchive', async ({ p }) => S.unarchiveEpisode(p.id));
  route('GET', '/api/episodes/:id/script-versions', async ({ p }) => ({ versions: S.scriptVersions(p.id) }));
  route('DELETE', '/api/episodes/:id/script-versions/:n', async ({ p, body }) => S.deleteScriptVersion(p.id, Number(p.n), { confirmApproved: !!(body && body.confirmApproved) }));
  route('POST', '/api/episodes/:id/script-versions/:n/undelete', async ({ p }) => S.undeleteScriptVersion(p.id, Number(p.n)));
  route('POST', '/api/episodes/:id/restore', async ({ p }) => S.restoreEpisode(p.id));
  route('POST', '/api/episodes/:id/scenes', async ({ p, body }) => S.addScene(p.id, { afterSceneId: body.afterSceneId, beatKey: body.beatKey }));
  route('DELETE', '/api/episodes/:id/scenes/:sid', async ({ p }) => S.deleteScene(p.id, p.sid));
  route('PUT', '/api/episodes/:id/scenes/:sid', async ({ p, body }) => S.saveScene(p.id, p.sid, { scene: body.scene, lines: body.lines }));
  route('POST', '/api/episodes/:id/scenes/reorder', async ({ p, body }) => S.reorderScenes(p.id, { beats: body.beats, order: body.order }));
  route('POST', '/api/episodes/:id/scenes/approve-ready', async ({ p }) => { const r = await S.projects.approveReady(p.id); const v = ep(p.id); v.approveResult = r; return v; });
  // ---- review translation (read-only aid; the English text stays the source of truth) ----
  route('POST', '/api/episodes/:id/translate/estimate', async ({ p, body }) => S.translator.estimate(p.id, { text: body.text, to: body.to }));
  route('POST', '/api/episodes/:id/translate', async ({ p, body }) => S.translator.translate(p.id, { text: body.text, to: body.to, confirm: body.confirm }));
  route('POST', '/api/episodes/:id/script/handoff', async ({ p }) => { const r = await S.projects.handoff(p.id); const v = ep(p.id); v.handoffResult = r; return v; });
  route('GET', '/api/episodes/:id/image-dev', async ({ p }) => ({ imageDev: S.store.episodes.get(p.id).imageDev || null, snapshot: S.store.episodes.get(p.id).imageDev ? S.projects.readSnapshot(p.id) : null }));
  route('POST', '/api/episodes/:id/duplicate', async ({ p, body }) => { const nid = await S.projects.duplicateEpisode(p.id, { newId: body.newId, title: body.title }); const v = ep(nid); v.duplicatedId = nid; return v; });
  route('POST', '/api/episodes/:id/scenes/:sid/copy', async ({ p, body }) => S.projects.copyScene(p.id, p.sid, body.toEpisodeId, { beatKey: body.beatKey }));
  route('GET', '/api/scene-templates', async () => ({ templates: S.projects.templates.list() }));
  route('POST', '/api/episodes/:id/scenes/:sid/template', async ({ p, body }) => S.projects.saveTemplate(p.id, p.sid, { name: body.name, templateId: body.templateId }));
  route('POST', '/api/scene-templates/:tid/apply', async ({ p, body }) => S.projects.applyTemplate(p.tid, body.episodeId, { linked: body.linked === true, beatKey: body.beatKey }));
  route('POST', '/api/episodes/:id/scenes/:sid/template-sync', async ({ p }) => { await S.projects.syncLinkedScene(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/script/revoke', async ({ p }) => S.revokeScript(p.id));
  route('POST', '/api/episodes/:id/versions/:n/restore', async ({ p }) => S.restoreVersion(p.id, Number(p.n)));
  route('GET', '/api/episodes/:id/versions/:n', async ({ p }) => S.store.episodes.version(p.id, Number(p.n)));
  route('POST', '/api/episodes/:id/suggestions/:i/add', async ({ p }) => S.addSuggestion(p.id, Number(p.i)));

  // ---- storyboard ----
  route('POST', '/api/episodes/:id/storyboard/prompts', async ({ p, body }) => S.rebuildPrompts(p.id, body.sceneIds, { force: !!body.force, mode: body.mode === 'gemini' ? 'gemini' : 'template', confirmAi: body.confirmAi === true }));
  route('PUT', '/api/episodes/:id/scenes/:sid/prompt', async ({ p, body }) => S.savePrompt(p.id, p.sid, body));
  route('GET', '/api/episodes/:id/scenes/:sid/character-refs', async ({ p }) => { const e = S.store.episodes.get(p.id); const sc = e.scenes.find((x) => x.id === p.sid); if (!sc) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 }); return { refs: S.charRefs.forScene(e, sc), validation: S.charRefs.validate(e, [sc]) }; });
  route('PUT', '/api/episodes/:id/scenes/:sid/character-refs/:cid', async ({ p, body }) => { S.assertNotHeld(p.id); return { refs: await S.charRefs.setSceneRef(p.id, p.sid, p.cid, body.refIds || body.refId) }; });
  route('DELETE', '/api/episodes/:id/scenes/:sid/character-refs/:cid', async ({ p }) => { S.assertNotHeld(p.id); return { refs: await S.charRefs.clearSceneRef(p.id, p.sid, p.cid) }; });
  route('PUT', '/api/episodes/:id/scenes/:sid/start-image', async ({ p, body }) => S.setStartImage(p.id, p.sid, body));
  route('PUT', '/api/episodes/:id/scenes/:sid/title', async ({ p, body }) => S.setSceneTitle(p.id, p.sid, body.title_ko));
  route('POST', '/api/episodes/:id/scenes/:sid/start-frame', async ({ p, raw, headers }) => S.uploadStartFrame(p.id, p.sid, raw, decodeURIComponent(headers['x-filename'] || 'frame.png')), { upload: true });
  route('POST', '/api/episodes/:id/start-images/estimate', async ({ p, body }) => S.startImages.estimate(p.id, body.sceneIds, { force: body.force === true, exclude: body.exclude }));
  route('POST', '/api/episodes/:id/start-images/generate', async ({ p, body }) => { S.assertNotHeld(p.id); const r = await S.startImages.generate(p.id, body.sceneIds, { confirm: body.confirm, force: body.force === true, exclude: body.exclude }); const v = ep(p.id); v.startImageResult = r; return v; });
  route('DELETE', '/api/episodes/:id/scenes/:sid/start-frame', async ({ p }) => S.deleteStartFrame(p.id, p.sid));
  route('PUT', '/api/episodes/:id/scenes/:sid/image-prompt', async ({ p, body }) => S.saveImagePrompt(p.id, p.sid, body || {}));
  route('DELETE', '/api/episodes/:id/scenes/:sid/image-prompt', async ({ p }) => S.resetImagePrompt(p.id, p.sid));
  route('POST', '/api/episodes/:id/scenes/:sid/start-frame/approve', async ({ p, body }) => S.approveStartFrame(p.id, p.sid, body.approved !== false));
  route('POST', '/api/episodes/:id/storyboard/approve', async ({ p }) => S.approveStoryboard(p.id));
  route('PUT', '/api/episodes/:id/scenes/:sid/animation', async ({ p, body }) => S.saveAnimationSettings(p.id, p.sid, body || {}));
  route('POST', '/api/models', async ({ body }) => S.addCustomModel(body || {}));
  route('POST', '/api/models/:id/confirm', async ({ p }) => S.confirmModel(p.id));
  route('DELETE', '/api/models/:id', async ({ p }) => S.removeCustomModel(p.id));
  route('POST', '/api/muapi/tts/confirm', async ({ body }) => S.confirmMuapiTts(!(body && body.confirmed === false)));
  route('GET', '/api/muapi/cli-models', async () => S.muapiCliModels());
  route('POST', '/api/episodes/:id/lipsync/estimate', async ({ p, body }) => S.lipsync.estimate(p.id, body || {}));
  route('POST', '/api/episodes/:id/lipsync/authorize', async ({ p, body }) => S.lipsync.authorize(p.id, body || {}));
  route('POST', '/api/episodes/:id/lipsync/run', async ({ p, body }) => {
    const ids = ((body && body.sceneIds) || []).slice();
    // sequential, in the background (a live job can take minutes); each scene consumes its own single-use authorization; nothing is retried
    bg((async () => { for (const sid of ids) await S.lipsync.runScene(p.id, body.authorizationId, sid); })(), 'lipsync');
    return { status: 202, data: { accepted: true } };
  });
  route('POST', '/api/episodes/:id/scenes/:sid/lipsync/:v/review', async ({ p, body }) => { await S.lipsync.review(p.id, p.sid, p.v, body && body.action); return ep(p.id); });
  route('PUT', '/api/lipsync/default', async ({ body }) => { S.lipsync.modelById(body && body.modelId); S.store.settings.save({ lipsyncModelId: body.modelId }); return { ok: true }; });
  route('POST', '/api/lipsync/models', async ({ body }) => S.lipsync.addModel(body || {}));
  route('PUT', '/api/lipsync/models/:id/price', async ({ p, body }) => S.lipsync.setPrice(p.id, body && body.costEstimateUsd));
  route('PUT', '/api/episodes/:id/scenes/:sid/lipsync/skip', async ({ p, body }) => { S.assertNotHeld(p.id); const ep0 = S.store.episodes.get(p.id); if (!(ep0.scenes || []).some((x) => x.id === p.sid)) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 }); await S.store.episodes.update(p.id, (e) => { e.lipsyncSkipped = Object.assign({}, e.lipsyncSkipped || {}, { [p.sid]: body.skip === true }); }); return ep(p.id); });
  route('POST', '/api/lipsync/models/:id/confirm', async ({ p }) => { S.lipsync.confirmModel(p.id); return { ok: true }; });
  route('DELETE', '/api/lipsync/models/:id', async ({ p }) => { S.lipsync.removeModel(p.id); return { ok: true }; });
  route('POST', '/api/muapi/check', async () => S.muapiCheck());
  route('POST', '/api/episodes/:id/storyboard/revoke', async ({ p }) => S.revokeStoryboard(p.id));
  route('PUT', '/api/episodes/:id/spend-limit', async ({ p, body }) => S.setSpendLimit(p.id, body.usd));

  // ---- animation ----
  // Free model preflight: local payload contract + scene readiness, and a free MuAPI balance GET.
  // A successful balance GET proves credentials/network only, NOT that the paid video endpoint will accept a job.
  route('POST', '/api/episodes/:id/generation/preflight', async ({ p, body }) => {
    const modelId = String(body.modelId || '');
    const sceneId = String(body.sceneId || '');
    const model = S.store.models().find((m) => m.id === modelId);
    if (!model) throw new StudioError('BAD_MODEL', '선택한 모델을 찾을 수 없습니다.', { status: 422 });
    const ep = S.episodeView(p.id);
    const scene = ep.scenes.find((sc) => sc.id === sceneId);
    if (!scene) throw new StudioError('NOT_FOUND', '장면을 찾을 수 없습니다.', { status: 404 });
    const { buildBody, validateEndpoint } = require('./lib/modelcontract');
    const problems = [];
    const endpoint = validateEndpoint(model.endpoint);
    if (!endpoint) problems.push('MuAPI 모델 엔드포인트가 올바르지 않습니다.');
    const info = scene.startImageInfo || {};
    if (info.error || !info.approved || !info.url) problems.push('승인된 시작 이미지가 필요합니다.');
    let imageField = '';
    let imageType = '';
    if (endpoint) {
      try {
        const payload = buildBody(model, { prompt: scene.animationPrompt || scene.prompt?.video || 'preflight', imageUrl: 'https://preflight.invalid/approved.png', duration: (model.durations || [5])[0], aspectRatio: '9:16', silent: true });
        const imageKeys = ['images_list', 'image_url', model.imageField].filter(Boolean);
        imageField = imageKeys.find((key) => Object.hasOwn(payload, key)) || '';
        imageType = Array.isArray(payload[imageField]) ? 'array' : typeof payload[imageField];
        if (!imageField || !((imageType === 'array' && payload[imageField].length) || (imageType === 'string' && payload[imageField]))) problems.push('이미지 입력 필드가 생성되지 않았습니다.');
      } catch (e) { problems.push('모델 입력 형식 오류: ' + e.message); }
    }
    const estimate = S.gen.estimate(p.id, { sceneIds: [sceneId], modelId });
    for (const b of estimate.blockers || []) problems.push(b.message);
    let connected = S.video.mode !== 'live';
    if (S.video.mode === 'live') {
      try { await S.video.balance(); connected = true; } catch (e) { problems.push('MuAPI 무료 연결 확인 실패: ' + e.message); }
    }
    return { modelId, endpoint, imageField, imageType, connected, mode: S.video.mode, paidRequestSent: false, remoteEndpointVerified: false, checkedAt: new Date().toISOString(), blockers: [...new Set(problems)], canGenerate: connected && problems.length === 0 && !!estimate.canAuthorize };
  });
  route('POST', '/api/episodes/:id/broll/:bid/clip/estimate', async ({ p, body }) => S.gen.estimateBroll(p.id, p.bid, body || {}));
  route('POST', '/api/episodes/:id/broll/:bid/clip/generate', async ({ p, body }) => { S.assertNotHeld(p.id); const { accepted, done } = await S.gen.generateBroll(p.id, p.bid, body || {}); bg(done, 'broll-generation'); return { status: 202, data: { accepted } }; });
  route('POST', '/api/episodes/:id/broll/:bid/clip/:v/review', async ({ p, body }) => { S.assertNotHeld(p.id); await S.gen.reviewBroll(p.id, p.bid, Number(p.v), body && body.decision); return ep(p.id); });
  route('POST', '/api/episodes/:id/generation/estimate', async ({ p, body }) => S.gen.estimate(p.id, body));
  route('POST', '/api/episodes/:id/generation/authorize', async ({ p, body }) => { S.assertNotHeld(p.id); return S.gen.authorize(p.id, body); });
  route('POST', '/api/episodes/:id/generation/run', async ({ p, body }) => {
    const { accepted, done } = await S.gen.run(p.id, body.authorizationId);
    bg(done, 'generation');
    return { status: 202, data: { accepted } };
  });
  route('POST', '/api/episodes/:id/jobs/:jid/resume', async ({ p }) => {
    bg(S.gen.resume(p.id, p.jid), 'resume');
    return { status: 202, data: { accepted: true } };
  });
  route('POST', '/api/episodes/:id/jobs/:jid/dismiss', async ({ p }) => { await S.gen.dismissJob(p.id, p.jid); return ep(p.id); });
  route('POST', '/api/episodes/:id/clips/:sid/upload', async ({ p, raw, headers }) => { await S.gen.addManualClip(p.id, p.sid, raw, decodeURIComponent(headers['x-filename'] || 'clip.mp4')); return ep(p.id); }, { upload: true });
  route('POST', '/api/episodes/:id/clips/:sid/:v/review', async ({ p, body }) => { await S.gen.review(p.id, p.sid, Number(p.v), body.decision, { note: body.note }); return ep(p.id); });

  // ---- voice ----
  route('POST', '/api/episodes/:id/voice/estimate', async ({ p }) => S.voice.estimate(p.id));
  route('POST', '/api/episodes/:id/voice/run', async ({ p, body }) => { await S.voice.synthesize(p.id, { confirmChars: body.confirmChars }); return ep(p.id); });
  route('POST', '/api/characters/:id/voice/verify', async ({ p }) => { await S.voice.verify(p.id); return S.characterView(S.store.characters.get(p.id)); });

  // ---- render / review ----
  route('POST', '/api/episodes/:id/render', async ({ p, body }) => {
    const { done } = await S.renderer.render(p.id, { preview: !!body.preview });
    bg(done, 'render');
    return { status: 202, data: { accepted: true } };
  });
  route('POST', '/api/episodes/:id/renders/:v/approve', async ({ p }) => { await S.renderer.approveFinal(p.id, Number(p.v)); return ep(p.id); });
  route('POST', '/api/episodes/:id/final/revoke', async ({ p }) => { await S.renderer.revokeFinal(p.id); return ep(p.id); });
  route('POST', '/api/episodes/:id/sfx', async ({ p, raw, headers, query }) => S.uploadSfx(p.id, raw, decodeURIComponent(headers['x-filename'] || 'sfx.wav'), query.label, query.atSec), { upload: true });
  route('PUT', '/api/episodes/:id/sfx/:fid', async ({ p, body }) => S.updateSfx(p.id, p.fid, body));
  // ---- scene pipeline: audio check/approval, sound effects, scene composite, scene final approval, revoke ----
  route('POST', '/api/episodes/:id/scenes/:sid/audio/estimate', async ({ p }) => S.voice.estimate(p.id, { sceneIds: [p.sid] }));
  route('POST', '/api/episodes/:id/scenes/:sid/audio/run', async ({ p, body }) => { await S.voice.synthesize(p.id, { confirmChars: body.confirmChars, sceneIds: [p.sid] }); return ep(p.id); });
  route('PUT', '/api/episodes/:id/scenes/:sid/voice', async ({ p, body }) => { await S.voice.saveSceneVoice(p.id, p.sid, body || {}); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/audio/regenerate', async ({ p, body }) => { await S.voice.regenerate(p.id, p.sid, { confirmOverwrite: !!(body && body.confirmOverwrite) }); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/audio/approve', async ({ p }) => { await S.sceneFlow.approveAudio(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/audio/revoke', async ({ p }) => { await S.sceneFlow.revokeAudio(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/sfx/builtin', async ({ p, body }) => { await S.sfx.addBuiltin(p.id, { name: body.name, sceneId: p.sid, offsetSec: body.offsetSec }); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/sfx/upload', async ({ p, raw, headers, query }) => { await S.sfx.addUpload(p.id, { buffer: raw, filename: decodeURIComponent(headers['x-filename'] || 'sfx.wav'), label: query.label, sceneId: p.sid, offsetSec: query.offsetSec }); return ep(p.id); }, { upload: true });
  route('PUT', '/api/episodes/:id/video-edit/style', async ({ p, body }) => { await S.videoEdit.saveStyle(p.id, body || {}); return ep(p.id); });
  route('PUT', '/api/episodes/:id/audio-timing/:lid', async ({ p, body }) => {
    S.assertNotHeld(p.id);
    const raw = body && body.offsetSec;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 30 || Math.abs(raw / 0.3 - Math.round(raw / 0.3)) > 0.00001) throw new StudioError('BAD_OFFSET', '음성 위치는 0–30초 범위에서 0.3초 단위로 지정하세요.', { status: 422 });
    const ep0 = S.store.episodes.get(p.id);
    if (!(ep0.lines || []).some((l) => l.id === p.lid)) throw new StudioError('NOT_FOUND', '대사를 찾을 수 없습니다.', { status: 404 });
    const nextOffset = Math.round(raw * 10) / 10;
    if (ep0.durationPolicy && ep0.durationPolicy.maxSceneSec === 5) {
      const preview = Object.assign({}, ep0, { audioTiming: Object.assign({}, ep0.audioTiming || {}, { [p.lid]: nextOffset }) });
      const { buildTimeline } = require('./lib/timeline');
      const timeline = buildTimeline(preview, (lid) => {
        const line = (preview.lines || []).find((l) => l.id === lid);
        if (!line) return null;
        const audio = S.voice.lineAudio(preview, line);
        return audio && audio.valid ? audio.durationSec : null;
      });
      const scene = (ep0.lines || []).find((l) => l.id === p.lid).sceneId;
      const resulting = timeline.scenes.find((s) => s.id === scene);
      if (resulting && resulting.duration > 5.001) throw new StudioError('SCENE_OVER_5_SECONDS', '이 위치로 이동하면 씬이 5초를 초과합니다. 음성을 줄이거나 동일한 스토리 단계에서 씬을 나눠 주세요.', { status: 409 });
    }
    await S.store.episodes.update(p.id, (e) => { e.audioTiming = Object.assign({}, e.audioTiming || {}, { [p.lid]: nextOffset }); });
    return ep(p.id);
  });
  route('PUT', '/api/episodes/:id/video-edit/transition', async ({ p, body }) => { await S.videoEdit.saveTransition(p.id, body || {}); return ep(p.id); });
  route('PUT', '/api/episodes/:id/video-edit/music', async ({ p, body }) => { await S.videoEdit.saveMusic(p.id, body || {}); return ep(p.id); });
  route('DELETE', '/api/episodes/:id/video-edit/music', async ({ p }) => { await S.videoEdit.saveMusic(p.id, { remove: true }); return ep(p.id); });
  route('POST', '/api/episodes/:id/video-edit/music', async ({ p, raw, headers }) => S.uploadMusic(p.id, raw, decodeURIComponent(headers['x-filename'] || 'music.mp3')), { upload: true });
  route('GET', '/media/music/:a', async ({ p }) => ({ file: S.mediaFile('music', p.a) }));
  route('PUT', '/api/episodes/:id/video-edit/mix', async ({ p, body }) => { await S.videoEdit.saveMix(p.id, body || {}); return ep(p.id); });
  route('PUT', '/api/episodes/:id/video-edit/subtitles/:lid', async ({ p, body }) => { await S.videoEdit.saveSubtitle(p.id, p.lid, body || {}); return ep(p.id); });
  route('DELETE', '/api/episodes/:id/video-edit/subtitles/:lid', async ({ p }) => { await S.videoEdit.resetSubtitle(p.id, p.lid); return ep(p.id); });
  route('POST', '/api/episodes/:id/sfx/search', async ({ body }) => S.sfx.searchHeygen(body.query));
  route('POST', '/api/episodes/:id/scenes/:sid/sfx/heygen', async ({ p, body }) => { await S.sfx.addHeygen(p.id, { soundId: body.soundId, sceneId: p.sid, offsetSec: body.offsetSec }); return ep(p.id); });
  route('POST', '/api/episodes/:id/sfx/:fid/update', async ({ p, body }) => { await S.sfx.update(p.id, p.fid, body); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/compose', async ({ p }) => { await S.sceneFlow.buildComposite(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/final/approve', async ({ p }) => { await S.sceneFlow.approveScene(p.id, p.sid); return ep(p.id); });
  route('POST', '/api/episodes/:id/scenes/:sid/final/revoke', async ({ p }) => { await S.sceneFlow.revokeScene(p.id, p.sid); return ep(p.id); });
  route('GET', '/media/composite/:a/:b', async ({ p }) => ({ file: S.mediaFile('composite', p.a, p.b) }));
  route('GET', '/media/sfx/:a/:b', async ({ p }) => ({ file: S.mediaFile('sfx', p.a, p.b) }));

  // ---- ManyChat (token vault, connection test, Auto-DM campaign records; never creates anything in ManyChat) ----
  route('GET', '/api/manychat', async () => ({ connection: S.manychat.connection(), campaigns: S.manychat.list() }));
  route('PUT', '/api/manychat/token', async ({ body }) => S.manychat.setToken(body.token));
  route('DELETE', '/api/manychat/token', async () => S.manychat.disconnect());
  route('POST', '/api/manychat/test', async () => S.manychat.test());
  route('GET', '/api/episodes/:id/dm', async ({ p }) => S.manychat.forEpisode(p.id));
  route('PUT', '/api/episodes/:id/dm', async ({ p, body }) => S.manychat.save(p.id, body));
  route('POST', '/api/episodes/:id/dm/prepare', async ({ p }) => S.manychat.prepare(p.id));
  route('POST', '/api/episodes/:id/dm/configured', async ({ p, body }) => S.manychat.markConfigured(p.id, body));
  route('POST', '/api/episodes/:id/dm/verify', async ({ p, body }) => S.manychat.verify(p.id, body));
  route('POST', '/api/episodes/:id/dm/fail', async ({ p, body }) => S.manychat.fail(p.id, body));
  route('POST', '/api/episodes/:id/dm/reopen', async ({ p, body }) => S.manychat.reopen(p.id, body));
  route('DELETE', '/api/episodes/:id/dm', async ({ p }) => S.manychat.archive(p.id));
  route('GET', '/api/episodes/:id/dm/export', async ({ p }) => S.manychat.exportConfig(p.id));

  // ---- publishing ----
  route('POST', '/api/episodes/:id/publishing/generate', async ({ p, body }) => { await S.publishing.init(p.id, { force: !!body.force }); return ep(p.id); });
  route('PUT', '/api/episodes/:id/publishing', async ({ p, body }) => { await S.publishing.save(p.id, body); return ep(p.id); });
  route('POST', '/api/episodes/:id/publishing/approve', async ({ p }) => { await S.publishing.approve(p.id); return ep(p.id); });
  route('PUT', '/api/episodes/:id/publishing/checklist', async ({ p, body }) => { await S.publishing.setChecklist(p.id, body.key, body.value); return ep(p.id); });
  route('POST', '/api/episodes/:id/publishing/published', async ({ p, body }) => { await S.publishing.markPublished(p.id, body.postUrl); return ep(p.id); });

  // ---- characters / settings ----
  // ---- voice providers (Google Cloud TTS / HeyGen): connect once, sync the voice list, reuse everywhere. Secrets never leave the server. ----
  route('GET', '/api/voices', async () => S.voiceCatalog.overview());
  route('GET', '/api/voices/list', async ({ query }) => S.voiceCatalog.list({ provider: query.provider, language: query.language, q: query.q, type: query.type, limit: query.limit, offset: query.offset }));
  route('PUT', '/api/voices/google/credentials', async ({ body }) => S.voiceCatalog.setGoogleCredentials(body));
  route('PUT', '/api/voices/heygen/key', async ({ body }) => S.voiceCatalog.setHeygenKey(body.key));
  route('POST', '/api/voices/preview/estimate', async ({ body }) => S.voiceCatalog.previewEstimate(body.provider, body.voiceId, body.text));
  route('POST', '/api/voices/preview', async ({ body }) => { const r = await S.voiceCatalog.preview(body.provider, body.voiceId, { text: body.text, confirm: body.confirm }); return { estimate: r.estimate, cached: !!r.cached, mock: !!r.mock, url: r.url || '/media/voicepreview/' + require('node:path').basename(r.file) }; });
  route('GET', '/media/voicepreview/:name', async ({ p }) => { if (!/^[a-f0-9]{24}\.wav$/.test(p.name)) throw new StudioError('NOT_FOUND', '미리듣기를 찾을 수 없습니다.', { status: 404 }); return { file: require('node:path').join(S.voiceCatalog.previewDir(), p.name) }; });
  route('POST', '/api/voices/:provider/test', async ({ p }) => S.voiceCatalog.test(p.provider));
  route('POST', '/api/voices/:provider/sync', async ({ p }) => S.voiceCatalog.sync(p.provider));
  route('DELETE', '/api/voices/:provider', async ({ p }) => S.voiceCatalog.disconnect(p.provider));
  route('PUT', '/api/characters/:id/voice', async ({ p, body }) => { S.voiceCatalog.assign(p.id, { provider: body.provider, voiceId: body.voiceId }); return S.characterView(S.store.characters.get(p.id)); });
  route('DELETE', '/api/characters/:id/voice', async ({ p, body }) => { S.voiceCatalog.clear(p.id, body && body.provider); return S.characterView(S.store.characters.get(p.id)); });
  route('PUT', '/api/characters/:id/reference-selection', async ({ p, body }) => { S.store.characters.setReferenceSelection(p.id, body.refIds); return S.characterView(S.store.characters.get(p.id)); });
  route('PUT', '/api/characters/:id/references/:rid', async ({ p, body }) => { S.store.characters.setReferenceKind(p.id, p.rid, body.isSheet !== false); return S.characterView(S.store.characters.get(p.id)); });
  route('PUT', '/api/characters/:id', async ({ p, body }) => S.updateCharacter(p.id, body));
  route('POST', '/api/characters/:id/references', async ({ p, raw, headers, query }) => {
    S.store.characters.addReference(p.id, { buffer: raw, filename: decodeURIComponent(headers['x-filename'] || 'ref.png'), mime: (headers['content-type'] || '').split(';')[0], label: query.label || '' });
    return S.characterView(S.store.characters.get(p.id));
  }, { upload: true });
  route('POST', '/api/characters/:id/references/:rid/approve', async ({ p, body }) => { S.store.characters.setReferenceApproved(p.id, p.rid, body.approved !== false); return S.characterView(S.store.characters.get(p.id)); });
  route('DELETE', '/api/characters/:id/references/:rid', async ({ p }) => { S.store.characters.removeReference(p.id, p.rid); return S.characterView(S.store.characters.get(p.id)); });
  route('POST', '/api/demo/references', async () => ({ made: await S.loadDemoReferences() }));
  route('PUT', '/api/settings', async ({ body }) => S.saveSettings(body));

  // ---- media (ids only) ----
  route('GET', '/media/product/:a/:b', async ({ p }) => ({ file: S.mediaFile('product', p.a, p.b) }));
  route('GET', '/media/product-review/:a/:b', async ({ p }) => ({ file: S.products.reviewMediaFile(p.a, Number(p.b)) }));
  route('GET', '/media/ref/:a/:b', async ({ p }) => ({ file: S.mediaFile('ref', p.a, p.b) }));
  route('GET', '/media/lipsync/:a/:b/:c', async ({ p }) => ({ file: S.mediaFile('lipsync', p.a, p.b, p.c) }));
  route('GET', '/media/clip/:a/:b/:c', async ({ p }) => ({ file: S.mediaFile('clip', p.a, p.b, p.c) }));
  route('GET', '/media/render/:a/:b', async ({ p, query }) => { const file = S.mediaFile('render', p.a, p.b); return { file, download: query.download === '1', filename: S.exportName(p.a, file) }; });
  route('GET', '/media/audio/:a/:b', async ({ p }) => ({ file: S.mediaFile('audio', p.a, p.b) }));
  route('GET', '/media/broll/:a/:b', async ({ p }) => ({ file: S.mediaFile('broll', p.a, p.b) }));
  route('GET', '/media/startframev/:a/:b/:c', async ({ p }) => ({ file: S.mediaFile('startframev', p.a, p.b, p.c) }));
  route('GET', '/media/startframe/:a/:b', async ({ p }) => ({ file: S.mediaFile('startframe', p.a, p.b) }));

  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, host + ':' + port]);
  if (publicHost) { allowedHosts.add(publicHost); allowedHosts.add(publicHost + ':' + port); }
  const PUBLIC_API = new Set(['/api/session', '/api/login', '/api/logout']);

  // Last line of defence: no API key can ever leave in an error body, even if a provider echoed it.
  function scrubSecrets(obj) {
    let t = JSON.stringify(obj);
    try { S.vault.providers.forEach((pn) => { const k = S.vault.get(pn); if (k && k.length >= 8) t = t.split(k).join('[redacted]'); }); } catch (_) { /* vault unreadable: nothing to scrub */ }
    return JSON.parse(t);
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      const reqHost = String(req.headers.host || '');
      // Railway's deploy healthcheck calls GET /healthz with Host: healthcheck.railway.app. Only that exact request is exempt.
      const railwayHealthcheck = req.method === 'GET' && url.pathname === '/healthz' && reqHost === RAILWAY_HEALTHCHECK_HOST;
      if (port && (loopback || publicHost) && !railwayHealthcheck && !allowedHosts.has(reqHost)) return sendJson(res, 403, { error: { code: 'HOST', message: '허용되지 않은 호스트입니다.' } });
      const isApi = url.pathname.startsWith('/api/');
      const isMedia = url.pathname.startsWith('/media/');
      const cookies = req.headers.cookie || '';
      const sess = /(?:^|;\s*)rf_session=([^;]+)/.exec(cookies);
      if (auth.enabled && (isApi || isMedia) && !PUBLIC_API.has(url.pathname) && !auth.verify(sess && sess[1])) return sendJson(res, 401, { error: { code: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.', recovery: '관리자 비밀번호로 로그인하세요.' } });
      if (token && (isApi || isMedia)) {
        const cookie = /(?:^|;\s*)rf_token=([^;]+)/.exec(req.headers.cookie || '');
        const supplied = req.headers['x-rf-token'] || (cookie && decodeURIComponent(cookie[1])) || url.searchParams.get('t');
        if (supplied !== token) return sendJson(res, 401, { error: { code: 'TOKEN', message: '접근 토큰이 필요합니다.', recovery: '설정한 RF_STUDIO_TOKEN 값을 입력하세요.' } });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (req.headers['x-rf-studio'] !== '1') return sendJson(res, 403, { error: { code: 'CSRF', message: '잘못된 요청입니다.' } });
        let originHost = '';
        try { originHost = origin ? new URL(origin).host : ''; } catch (_) { originHost = '?'; }
        if (origin && port && originHost !== reqHost) return sendJson(res, 403, { error: { code: 'ORIGIN', message: '다른 출처의 요청입니다.' } });
      }
      if (isApi || isMedia || url.pathname === '/healthz') {
        const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
        if (!r) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '알 수 없는 경로입니다.' } });
        const m = r.re.exec(url.pathname);
        const p = {};
        r.names.forEach((n, i) => (p[n] = decodeURIComponent(m[i + 1])));
        let body = {};
        let raw = null;
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
          if (r.opts.upload) raw = await readBody(req, MAX_UPLOAD);
          else {
            const buf = await readBody(req, MAX_JSON);
            if (buf.length) {
              try {
                body = JSON.parse(buf.toString('utf8'));
              } catch {
                throw new StudioError('BAD_JSON', '요청 형식이 올바르지 않습니다.');
              }
            }
          }
        }
        const out = await r.handler({ p, body, raw, headers: req.headers, query: Object.fromEntries(url.searchParams), res, ip: req.socket.remoteAddress || '', cookie: sess && sess[1], secure: req.headers['x-forwarded-proto'] === 'https' });
        // Best-effort mirror after successful episode mutations. Never fail the primary operation if Sheets is offline.
        if (bridge && bridge.enabled && req.method !== 'GET' && p.id && !url.pathname.startsWith('/api/sheets/')) {
          try {
            const snapshot = S.store.episodes.get(p.id);
            bg(bridge.push(snapshot), 'sheets mirror ' + p.id);
          } catch (_) { /* Non-episode IDs (e.g. characters) are not mirrored. */ }
        }
        if (isMedia) return sendFile(req, res, out.file, { download: out.download, filename: out.filename });
        if (out && out.status && out.data !== undefined) return sendJson(res, out.status, out.data);
        return sendJson(res, 200, out);
      }
      // static files
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: { code: 'PATH', message: '잘못된 경로입니다.' } });
      if (!fs.existsSync(file)) return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
      return sendFile(req, res, file);
    } catch (e) {
      const known = e instanceof StudioError;
      const prov = e instanceof ProviderError;
      const status = known ? e.status : prov ? 502 : 500;
      if (!known && !prov) log('internal error: ' + (e && e.stack));
      return sendJson(res, status, scrubSecrets({ error: { code: e.code || 'ERROR', message: known || prov ? e.message : '서버 오류가 발생했습니다: ' + e.message, recovery: e.recovery || '', details: e.details } }));
    }
  }

  return http.createServer(handle);
}

function start(cfg = loadConfig(), opts = {}) {
  if (cfg.production) {
    const missing = [];
    if (!cfg.masterKey) missing.push('RF_MASTER_KEY');
    if (!cfg.adminPassword) missing.push('RF_ADMIN_PASSWORD');
    if (missing.length) throw new Error('운영 환경(RF_ENV=production)에는 ' + missing.join(', ') + ' 가 필요합니다. docs/DEPLOYMENT.md 를 참고하세요.');
    if (cfg.adminPassword.length < 12) throw new Error('RF_ADMIN_PASSWORD는 12자 이상이어야 합니다.');
  }
  const auth = createAuth({ password: cfg.adminPassword, secret: cfg.masterKey });
  const studio = opts.studio || createStudio({ cfg, log: (m) => console.log('[studio] ' + m) });
  const bridge = createSheetsBridge({ url: cfg.sheetsBridgeUrl, token: cfg.sheetsBridgeToken, log: (m) => console.log('[sheets] ' + m) });
  const server = createApp(studio, { token: cfg.studioToken, port: cfg.studioPort, host: cfg.studioHost, bridge, auth, publicHost: cfg.publicHost, log: (m) => console.log('[studio] ' + m) });
  return new Promise((resolve) => {
    server.listen(cfg.studioPort, cfg.studioHost, () => resolve({ server, studio, url: `http://${cfg.studioHost}:${server.address().port}` }));
  });
}

if (require.main === module) {
  const cfg = loadConfig();
  start(cfg).then(({ url, studio }) => {
    const st = studio.providerStatus();
    console.log(`Reels Factory Studio  ${url}`);
    console.log(`  영상 생성: ${st.video.mode.toUpperCase()}${st.video.mode === 'mock' ? ' (요금 없음)' : ' (실제 유료 호출 가능 — 모든 호출은 화면에서 승인해야 실행됩니다)'}`);
    console.log(`  Muapi 키: ${st.video.keyConfigured ? '설정됨' : '없음'} · 음성: ${st.voice.mode.toUpperCase()} · HeyGen 키: ${st.voice.keyConfigured ? '설정됨' : '없음'}`);
    console.log(`  데이터 폴더: ${cfg.studioDir}`);
  });
}

module.exports = { createApp, createAuth, start };
