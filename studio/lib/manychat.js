// ManyChat integration + Auto-DM campaign records.
//
// HONEST SCOPE (audited against ManyChat's public Page API: Bearer token, https://api.manychat.com):
//   The public API can read page info / flows / tags / custom fields and act on a subscriber (set fields, send a flow).
//   It has NO endpoint to create, edit, publish, pause or attach an Instagram comment-trigger automation to a post,
//   and none that reports whether such an automation is live. So this module:
//     - stores the token encrypted (vault) and can test the connection (GET /fb/page/getInfo) with retries;
//     - keeps a campaign RECORD per episode (what to configure in ManyChat) and guides the manual setup;
//     - never sends a DM, never calls a subscriber endpoint, never creates/changes anything in ManyChat;
//     - marks a campaign "active" only when the operator records verification evidence (a real test comment + DM).
//   ManyChat remains the only system that detects comments and delivers DMs.
'use strict';
const { StudioError, nowIso, readJson, writeJsonAtomic, uid } = require('./util');
const { affiliateUrlError, DISCLOSURE } = require('./publishing');

const BASE = 'https://api.manychat.com';
const DASHBOARD_URL = 'https://app.manychat.com/';
const STATUS = ['draft', 'setup_required', 'ready', 'active', 'failed'];
const STATUS_LABEL = { draft: '초안', setup_required: 'ManyChat 설정 필요', ready: '준비됨 (미검증)', active: '활성 (검증됨)', failed: '실패' };
const CAPABILITIES = {
  testConnection: { supported: true, how: 'GET /fb/page/getInfo' },
  readFlows: { supported: true, how: 'GET /fb/page/getFlows (이 스튜디오는 아직 사용하지 않음)' },
  createAutomation: { supported: false, note: '공개 API에 자동화(댓글 트리거) 생성 엔드포인트가 없습니다.' },
  attachToPost: { supported: false, note: '공개 API로 인스타그램 게시물에 트리거를 연결할 수 없습니다.' },
  activatePause: { supported: false, note: '공개 API로 자동화를 켜거나 멈출 수 없습니다.' },
  readAutomationStatus: { supported: false, note: '공개 API가 자동화의 실제 동작 상태를 알려주지 않습니다.' },
  readMetrics: { supported: false, note: '댓글 트리거별 DM 발송·클릭 지표를 API로 읽을 수 없어 표시하지 않습니다.' },
};
const norm = (s) => String(s || '').normalize('NFC').trim().toLowerCase();

function createManychat({ store, vault, fetchFn = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 2, timeoutMs = 10000, log = () => {} }) {
  const connFile = () => store.path('manychat-connection.json');
  const campFile = () => store.path('manychat-campaigns.json');
  const auditFile = () => store.path('manychat-audit.jsonl');
  const conn = () => readJson(connFile(), { state: 'untested' });
  const saveConn = (c) => writeJsonAtomic(connFile(), c);
  const camps = () => readJson(campFile(), { campaigns: [] }).campaigns;
  const saveCamps = (list) => writeJsonAtomic(campFile(), { campaigns: list });
  const audit = (event, data = {}) => { try { require('node:fs').appendFileSync(auditFile(), JSON.stringify({ at: nowIso(), event, ...data }) + '\n'); } catch (e) { log('manychat audit failed: ' + e.message); } };
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  // ---------- connection ----------
  const scrub = (text, token) => (token ? String(text).split(token).join('***') : String(text));
  async function call(path, token) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        let res;
        try { res = await fetchFn(BASE + path, { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ac.signal }); } finally { clearTimeout(t); }
        if (res.status === 401 || res.status === 403) return { state: 'auth_failed', httpStatus: res.status };
        if (res.status === 429 || res.status >= 500) { last = { state: res.status === 429 ? 'rate_limited' : 'unavailable', httpStatus: res.status }; }
        else if (!res.ok) return { state: 'error', httpStatus: res.status };
        else {
          let body = null;
          try { body = await res.json(); } catch { return { state: 'error', httpStatus: res.status, message: '응답을 해석하지 못했습니다.' }; }
          if (body && body.status && body.status !== 'success') return { state: 'error', httpStatus: res.status, message: scrub(String(body.message || body.status), token).slice(0, 200) };
          return { state: 'ok', data: (body && body.data) || {} };
        }
      } catch (e) {
        last = { state: 'unavailable', message: scrub(e.name === 'AbortError' ? '시간 초과' : e.message, token).slice(0, 200) };
      }
      if (attempt < retries) await sleep(300 * 2 ** attempt);
    }
    return last;
  }

  function connection() {
    const key = vault.mask('manychat');
    const c = conn();
    const state = !key.configured ? 'not_configured' : c.state || 'untested';
    return { configured: key.configured, last4: key.last4, source: key.source, state, testedAt: c.testedAt || '', page: c.page || null, message: c.message || '', dashboardUrl: DASHBOARD_URL, capabilities: CAPABILITIES };
  }
  function setToken(token) {
    vault.set('manychat', token);
    saveConn({ state: 'untested' });
    audit('token.set');
    return connection();
  }
  function disconnect() {
    vault.remove('manychat');
    saveConn({ state: 'untested' });
    audit('token.removed');
    return Object.assign(connection(), { note: '이 스튜디오에서 토큰을 삭제했습니다. 토큰 자체를 무효화하려면 ManyChat → Settings → API에서 새 토큰을 생성(재발급)하세요.' });
  }
  async function test() {
    const token = vault.get('manychat');
    if (!token) throw new StudioError('NO_TOKEN', 'ManyChat API 토큰이 없습니다.', { status: 400, recovery: 'ManyChat → Settings → API에서 토큰을 만들어 입력하세요. (Pro 플랜 필요)' });
    const r = await call('/fb/page/getInfo', token);
    const at = nowIso();
    if (r.state === 'ok') {
      const d = r.data;
      saveConn({ state: 'connected', testedAt: at, page: { id: d.id != null ? String(d.id) : '', name: String(d.name || ''), username: String(d.username || ''), timezone: String(d.timezone || '') }, message: '' });
    } else saveConn({ state: r.state, testedAt: at, page: null, message: r.state === 'auth_failed' ? '토큰이 거부되었습니다. 새 토큰을 입력하세요.' : r.message || ('연결 실패 (' + (r.httpStatus || r.state) + ')') });
    audit('test', { state: r.state === 'ok' ? 'connected' : r.state });
    return connection();
  }

  // ---------- campaigns ----------
  function episode(id) {
    const ep = store.episodes.get(id);
    if (!ep) throw new StudioError('NO_EPISODE', '에피소드를 찾을 수 없습니다.', { status: 404 });
    return ep;
  }
  function inheritedLink(ep) {
    const pub = ep.publishing || {};
    if (pub.affiliateUrl) return { url: pub.affiliateUrl, from: 'publishing' };
    const pr = ep.product || {};
    return { url: pr.affiliateUrl || '', from: pr.affiliateUrl ? 'product' : '' };
  }
  const clean = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  function parseKeywords(v) {
    const arr = Array.isArray(v) ? v : String(v || '').split(/[,\n]/);
    const out = []; for (const k of arr.map((x) => clean(x, 30))) if (k && !out.some((o) => norm(o) === norm(k))) out.push(k);
    return out.slice(0, 5);
  }
  function validate(c, { forSetup = false } = {}) {
    const errors = [];
    if (!c.keywords.length) errors.push({ code: 'KEYWORD', message: '댓글 트리거 키워드가 필요합니다.' });
    c.keywords.forEach((k) => { if (k.length < 2) errors.push({ code: 'KEYWORD_SHORT', message: `키워드 "${k}"가 너무 짧습니다(2자 이상).` }); if (/^PRD-?\d+/i.test(k)) errors.push({ code: 'KEYWORD_INTERNAL', message: '내부 상품 ID를 공개 키워드로 쓸 수 없습니다.' }); });
    if (forSetup) {
      if (!c.instagramAccount) errors.push({ code: 'IG_ACCOUNT', message: '인스타그램 계정을 입력하세요.' });
      if (!c.dmMessage) errors.push({ code: 'DM', message: 'DM 문구가 필요합니다.' });
      const link = affiliateUrlError(c.affiliateUrl); if (link) errors.push({ code: 'AFFILIATE_URL', message: link });
      if (c.dmMessage && !String(c.dmMessage).includes('[광고]')) errors.push({ code: 'DISCLOSURE', message: 'DM 문구에 [광고] 표기가 필요합니다.' });
    }
    if (c.buttonLabel && c.buttonLabel.length > 20) errors.push({ code: 'BUTTON', message: '버튼 문구는 20자 이내여야 합니다.' });
    return errors;
  }
  /** Same account + overlapping keyword (equal, or one contains the other — ManyChat matches "contains") across other open campaigns. */
  function conflicts(c, list) {
    const out = [];
    for (const o of list) {
      if (o.id === c.id || o.archivedAt) continue;
      if (norm(o.instagramAccount) !== norm(c.instagramAccount)) continue;
      for (const k of c.keywords) for (const ok of o.keywords) {
        const a = norm(k); const b = norm(ok);
        if (a && b && (a === b || a.includes(b) || b.includes(a))) out.push({ code: 'KEYWORD_CONFLICT', message: `키워드 "${k}"가 에피소드 ${o.episodeId}의 "${ok}"와 겹칩니다. 한 계정에서 겹치는 키워드는 서로의 자동화를 가로챌 수 있습니다.`, campaignId: o.id });
      }
    }
    return out;
  }
  const open = (list, epId) => list.filter((c) => c.episodeId === epId && !c.archivedAt);
  const view = (c, ep) => c && Object.assign({}, c, { statusLabel: STATUS_LABEL[c.status], issues: validate(c, { forSetup: c.status !== 'draft' }) });

  /** The campaign editor payload: the saved campaign, or a prefilled (unsaved) suggestion. */
  function forEpisode(epId) {
    const ep = episode(epId);
    const saved = open(camps(), epId)[0] || null;
    const link = inheritedLink(ep);
    const pub = ep.publishing || {};
    const suggestion = { episodeId: epId, instagramAccount: '', postUrl: '', postId: '', keywords: parseKeywords(pub.keyword || (ep.cta || {}).keyword), dmMessage: pub.dmMessage || '', affiliateUrl: link.url, buttonLabel: '링크 받기', affiliateFrom: link.from };
    return { campaign: saved && view(saved, ep), suggestion, finalApproved: !!(ep.approvals && ep.approvals.final), connection: connection(), capabilities: CAPABILITIES, disclosure: DISCLOSURE, statusLabels: STATUS_LABEL };
  }

  function save(epId, input = {}) {
    return serial(async () => {
      const ep = episode(epId);
      const list = camps();
      let c = open(list, epId)[0];
      const link = inheritedLink(ep);
      const isNew = !c;
      if (isNew) c = { id: uid('dm'), episodeId: epId, status: 'draft', evidence: null, history: [], createdAt: nowIso() };
      const was = c.status;
      const next = Object.assign({}, c, {
        instagramAccount: clean(input.instagramAccount !== undefined ? input.instagramAccount : c.instagramAccount, 80).replace(/^@/, ''),
        postUrl: clean(input.postUrl !== undefined ? input.postUrl : c.postUrl, 300),
        postId: clean(input.postId !== undefined ? input.postId : c.postId, 80),
        keywords: input.keywords !== undefined ? parseKeywords(input.keywords) : c.keywords || parseKeywords((ep.publishing || {}).keyword || (ep.cta || {}).keyword),
        dmMessage: clean(input.dmMessage !== undefined ? input.dmMessage : c.dmMessage, 1000),
        buttonLabel: clean(input.buttonLabel !== undefined ? input.buttonLabel : c.buttonLabel, 40),
        affiliateUrl: clean(input.affiliateUrl !== undefined ? input.affiliateUrl : c.affiliateUrl || link.url, 500),
        affiliateFrom: input.affiliateUrl !== undefined && clean(input.affiliateUrl, 500) !== link.url ? 'edited' : link.url ? link.from : '',
      });
      if (next.postUrl && !/^https:\/\/(www\.)?instagram\.com\//i.test(next.postUrl)) throw new StudioError('POST_URL', '인스타그램 게시물 주소(https://www.instagram.com/…)여야 합니다.', { status: 400 });
      const errs = validate(next).filter((e) => e.code !== 'KEYWORD');
      if (errs.length) throw new StudioError('INVALID', errs[0].message, { status: 400, details: errs });
      const conf = conflicts(next, list);
      if (conf.length) throw new StudioError('KEYWORD_CONFLICT', conf[0].message, { status: 409, details: conf });
      // Changing a campaign that is (believed) live needs explicit confirmation and drops it back to re-verification.
      const touched = ['instagramAccount', 'postUrl', 'postId', 'dmMessage', 'buttonLabel', 'affiliateUrl'].some((k) => next[k] !== (c[k] || '')) || JSON.stringify(next.keywords) !== JSON.stringify(c.keywords || []);
      if (!isNew && ['ready', 'active'].includes(was) && touched) {
        if (!input.confirmLive) throw new StudioError('CONFIRM_LIVE', '이미 설정/활성 상태인 캠페인입니다. 변경하면 ManyChat에서도 직접 고쳐야 하고, 다시 검증해야 합니다. 변경하려면 확인이 필요합니다.', { status: 409, details: [{ code: 'CONFIRM_LIVE', status: was }] });
        next.status = 'setup_required'; next.evidence = null;
        next.history = (c.history || []).concat([{ at: nowIso(), event: 'edited_live', from: was }]);
      }
      next.updatedAt = nowIso();
      const saved = isNew ? list.concat([next]) : list.map((x) => (x.id === c.id ? next : x));
      saveCamps(saved);
      audit('campaign.saved', { campaignId: next.id, episodeId: epId, status: next.status });
      return view(next, ep);
    });
  }

  function mutate(epId, fn) {
    return serial(async () => {
      const ep = episode(epId);
      const list = camps();
      const c = open(list, epId)[0];
      if (!c) throw new StudioError('NO_CAMPAIGN', '저장된 DM 캠페인이 없습니다. 먼저 초안을 저장하세요.', { status: 404 });
      const next = fn(JSON.parse(JSON.stringify(c)), ep, list);
      next.updatedAt = nowIso();
      saveCamps(list.map((x) => (x.id === c.id ? next : x)));
      audit('campaign.' + next.status, { campaignId: next.id, episodeId: epId });
      return view(next, ep);
    });
  }
  const push = (c, event, extra = {}) => { c.history = (c.history || []).concat([Object.assign({ at: nowIso(), event }, extra)]); };

  /** draft → setup_required: the campaign is complete; the operator must now configure it inside ManyChat. */
  const prepare = (epId) => mutate(epId, (c, ep, list) => {
    if (!ep.approvals || !ep.approvals.final) throw new StudioError('FINAL_NOT_APPROVED', '최종 영상이 승인된 에피소드만 DM 캠페인 설정으로 넘길 수 있습니다.', { status: 409 });
    const errs = validate(c, { forSetup: true });
    if (errs.length) throw new StudioError('INVALID', errs[0].message, { status: 409, details: errs });
    const conf = conflicts(c, list); if (conf.length) throw new StudioError('KEYWORD_CONFLICT', conf[0].message, { status: 409, details: conf });
    if (c.status !== 'draft' && c.status !== 'failed') throw new StudioError('BAD_STATE', '이미 설정 단계입니다.', { status: 409 });
    c.status = 'setup_required'; push(c, 'prepared'); return c;
  });
  /** setup_required → ready: operator says they configured it in ManyChat. NOT verified, so never "active". */
  const markConfigured = (epId, { confirm } = {}) => mutate(epId, (c) => {
    if (c.status !== 'setup_required') throw new StudioError('BAD_STATE', 'ManyChat 설정 필요 단계에서만 가능합니다.', { status: 409 });
    if (!confirm) throw new StudioError('CONFIRM', 'ManyChat에서 직접 설정을 마쳤다는 확인이 필요합니다.', { status: 409 });
    if (!c.postUrl && !c.postId) throw new StudioError('POST_NOT_LINKED', '인스타그램 게시물 주소(또는 ID)를 먼저 연결하세요.', { status: 409 });
    c.status = 'ready'; push(c, 'marked_configured'); return c;
  });
  /** ready → active only with recorded evidence of a real end-to-end test. API cannot verify this itself. */
  const verify = (epId, { confirm, note, testedBy } = {}) => mutate(epId, (c) => {
    if (c.status !== 'ready') throw new StudioError('BAD_STATE', '준비됨 단계에서만 검증할 수 있습니다.', { status: 409 });
    if (!confirm) throw new StudioError('CONFIRM', '실제 게시물에 테스트 댓글을 달아 DM이 도착한 것을 확인한 뒤 활성화하세요.', { status: 409 });
    const n = clean(note, 500);
    if (n.length < 10) throw new StudioError('EVIDENCE', '검증 근거를 10자 이상 적어주세요 (예: 테스트 계정으로 "키워드" 댓글 → DM 수신 확인).', { status: 400 });
    c.status = 'active'; c.evidence = { verifiedAt: nowIso(), source: 'operator_test', note: n, testedBy: clean(testedBy, 60) || 'operator', apiVerified: false };
    push(c, 'verified'); return c;
  });
  const fail = (epId, { reason } = {}) => mutate(epId, (c) => {
    const r = clean(reason, 300); if (!r) throw new StudioError('REASON', '실패 사유를 적어주세요.', { status: 400 });
    c.status = 'failed'; c.failure = { at: nowIso(), reason: r }; c.evidence = null; push(c, 'failed', { reason: r }); return c;
  });
  /** active/ready → setup_required after the operator paused/changed it in ManyChat (API can't pause). Needs confirmation. */
  const reopen = (epId, { confirm } = {}) => mutate(epId, (c) => {
    if (!['ready', 'active', 'failed'].includes(c.status)) throw new StudioError('BAD_STATE', '이미 설정 단계이거나 초안입니다.', { status: 409 });
    if (!confirm) throw new StudioError('CONFIRM_LIVE', '실제 운영 중일 수 있는 캠페인입니다. ManyChat에서 직접 멈추거나 수정한 뒤 확인하세요.', { status: 409 });
    c.status = 'setup_required'; c.evidence = null; push(c, 'reopened'); return c;
  });
  const archive = (epId) => mutate(epId, (c) => { c.archivedAt = nowIso(); push(c, 'archived'); return c; });

  /** Guided manual setup + exportable configuration (no secrets, no tokens). */
  function exportConfig(epId) {
    const ep = episode(epId);
    const c = open(camps(), epId)[0];
    if (!c) throw new StudioError('NO_CAMPAIGN', '저장된 DM 캠페인이 없습니다.', { status: 404 });
    const config = { episodeId: ep.displayId || ep.id, instagramAccount: c.instagramAccount, post: { url: c.postUrl, id: c.postId }, triggerKeywords: c.keywords, matchType: 'comment contains keyword', dmMessage: c.dmMessage, button: c.buttonLabel ? { label: c.buttonLabel, url: c.affiliateUrl } : null, linkInMessage: c.affiliateUrl, status: c.status, note: '이 파일은 ManyChat에 직접 입력하기 위한 설정 사본입니다. 자동 적용되지 않습니다.' };
    const steps = [
      `ManyChat 대시보드(${DASHBOARD_URL})를 엽니다.`,
      'Automation → New Automation → Instagram → "User comments on my Post or Reel" 트리거를 고릅니다.',
      `게시물을 선택합니다: ${c.postUrl || '(게시 후 연결)'}`,
      `키워드(포함): ${c.keywords.join(', ')}`,
      'DM 단계에 아래 문구를 붙여넣고 버튼을 추가합니다.',
      `DM 문구:\n${c.dmMessage}`,
      c.buttonLabel ? `버튼 "${c.buttonLabel}" → ${c.affiliateUrl}` : `링크: ${c.affiliateUrl}`,
      '저장 후 테스트 계정으로 실제 게시물에 키워드 댓글을 달아 DM이 오는지 확인합니다.',
      '확인되면 이 화면에서 "검증 기록"을 남겨 활성 상태로 바꿉니다.',
    ];
    return { config, steps, dashboardUrl: DASHBOARD_URL };
  }

  /** Per-episode status for the dashboard. Metrics are never invented: the API provides none. */
  function statusFor(epId) {
    const c = open(camps(), epId)[0];
    return c ? { status: c.status, label: STATUS_LABEL[c.status], keywords: c.keywords, postLinked: !!(c.postUrl || c.postId), verifiedAt: c.evidence ? c.evidence.verifiedAt : '', metrics: null } : { status: 'none', label: '미설정', keywords: [], postLinked: false, verifiedAt: '', metrics: null };
  }
  const list = () => camps().filter((c) => !c.archivedAt);

  return { connection, setToken, disconnect, test, forEpisode, save, prepare, markConfigured, verify, fail, reopen, archive, exportConfig, statusFor, list, validate, conflicts, STATUS, STATUS_LABEL, CAPABILITIES };
}

module.exports = { createManychat, CAPABILITIES, STATUS, STATUS_LABEL, DASHBOARD_URL };
