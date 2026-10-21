// Caption / ManyChat publishing pack. Deterministic text built only from the approved script and the VERIFIED
// product facts (no LLM, no invented claims). Everything is editable and must be approved by the operator.
// Nothing here posts to Instagram or touches ManyChat: the checklist items for ManyChat and the post itself are
// operator confirmations, and the Studio never claims they are done unless the operator says so.
'use strict';
const { StudioError, nowIso, sha256, canonical } = require('./util');
const { claimHits } = require('./claims');
const { isScriptApproved } = require('./episode');

const AFFILIATE_HOSTS = ['link.coupang.com', 'coupa.ng']; // same rule as the Apps Script (AFFILIATE_URL_HOSTS)
const DISCLOSURE = '[광고] 이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

function hostOf(url) {
  const m = String(url).match(/^https:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}
function affiliateUrlError(url) {
  const u = String(url || '').trim();
  if (!u) return '제휴 링크가 비어 있습니다.';
  if (!AFFILIATE_HOSTS.includes(hostOf(u))) return '쿠팡 파트너스 링크(https://link.coupang.com/… 또는 https://coupa.ng/…)여야 합니다.';
  return '';
}

function generate(ep) {
  const p = ep.product;
  const kw = ep.cta.keyword;
  const hook = ep.title;
  const features = (p.verifiedFeatures || []).map((f) => f.replace(/^[-•\s]+/, ''));
  const productDescription = `${p.name}\n${features.map((f) => '• ' + f).join('\n')}`;
  const ctaLine = (ep.cta.lines || []).find((l) => l.includes('댓글') && l.includes(kw)) || `댓글에 ‘${kw}’ 남기면 링크 드림!`;
  const hashtags = ['#우산꽂이', '#자석우산꽂이', '#현관정리', '#현관수납', '#쿠팡추천템', '#쿠팡파트너스', '#잭앤다이앤', '#부부웹툰', '#생활꿀템'];
  const disclosure = (ep.publishing && ep.publishing.disclosure) || DISCLOSURE;
  const caption = [disclosure, '', hook, '', productDescription, '', ctaLine, '', hashtags.join(' ')].join('\n');
  const dmMessage = `안녕하세요! ‘${kw}’ 댓글 남겨주셔서 감사해요 ☂️\n${p.name} 링크 보내드려요 👇\n{링크}\n\n${disclosure}`;
  return { hook, productDescription, cta: ctaLine, hashtags, caption, dmMessage, disclosure, keyword: kw };
}

function validate(ep, pub) {
  const errors = [];
  const warnings = [];
  const claims = (ep.product && ep.product.forbiddenClaims) || [];
  const all = [pub.caption, pub.dmMessage, pub.hook, pub.productDescription, pub.cta].join('\n').toLowerCase();
  claimHits(all, claims).forEach((h) => errors.push({ code: 'PRODUCT_CLAIM', message: `확인되지 않은 제품 주장 "${h.claim}"가 있습니다 (…${h.context}…).` }));
  if (!String(pub.caption || '').includes('[광고]')) errors.push({ code: 'DISCLOSURE', message: '캡션 첫 줄에 [광고] 표기가 필요합니다.' });
  if (!String(pub.caption || '').includes('쿠팡 파트너스')) errors.push({ code: 'DISCLOSURE', message: '캡션에 쿠팡 파트너스 활동 및 수수료 문구가 필요합니다.' });
  if (!pub.keyword) errors.push({ code: 'KEYWORD', message: '댓글 키워드가 없습니다.' });
  else if (/^PRD-?\d+/i.test(pub.keyword)) errors.push({ code: 'KEYWORD_INTERNAL', message: '내부 상품 ID를 공개 댓글 키워드로 쓸 수 없습니다.' });
  else if (pub.keyword !== ep.cta.keyword) errors.push({ code: 'KEYWORD_MISMATCH', message: `영상 CTA의 키워드(${ep.cta.keyword})와 다릅니다.` });
  if (!String(pub.caption || '').includes(pub.keyword || '\u0000')) errors.push({ code: 'CAPTION_KEYWORD', message: '캡션에 댓글 키워드가 들어 있어야 합니다.' });
  if (pub.affiliateUrl) {
    const e = affiliateUrlError(pub.affiliateUrl);
    if (e) errors.push({ code: 'AFFILIATE_URL', message: e });
  } else warnings.push({ code: 'NO_LINK', message: '제휴 링크가 아직 없습니다. DM에 보낼 링크를 입력하세요.' });
  if (!String(pub.dmMessage || '').includes('{링크}') && !pub.affiliateUrl) warnings.push({ code: 'DM_LINK', message: 'DM 문구에 {링크} 자리가 없습니다.' });
  return { ok: errors.length === 0, errors, warnings };
}

const MANUAL_ITEMS = [
  ['manychatKeyword', 'ManyChat에서 댓글 키워드를 직접 설정했습니다'],
  ['manychatDm', 'ManyChat DM 문구와 링크를 직접 설정하고 테스트했습니다'],
  ['rightsChecked', '영상·이미지 사용 권리를 확인했습니다'],
  ['aiLabel', 'AI 생성 콘텐츠 표시(인스타그램 설정)를 확인했습니다'],
];

/** Auto items come from real state; manual items are operator confirmations only. */
function checklist(ep) {
  const pub = ep.publishing || {};
  const finalOk = !!(ep.approvals.final && ep.renders.find((r) => r.v === ep.approvals.final.v && r.sha256 === ep.approvals.final.sha256));
  const auto = [
    { key: 'script', label: '대본 승인', ok: isScriptApproved(ep), auto: true },
    { key: 'final', label: '최종 영상 승인', ok: finalOk, auto: true },
    { key: 'caption', label: '캡션·DM 문구 승인', ok: !!pub.approvedAt, auto: true },
    { key: 'link', label: '제휴 링크 입력 (쿠팡 파트너스 형식)', ok: !!pub.affiliateUrl && !affiliateUrlError(pub.affiliateUrl), auto: true },
    { key: 'disclosure', label: '캡션 첫 줄 [광고] 표기', ok: String(pub.caption || '').startsWith('[광고]'), auto: true },
  ];
  const manual = MANUAL_ITEMS.map(([key, label]) => ({ key, label, ok: !!(pub.checklist && pub.checklist[key]), auto: false }));
  const items = auto.concat(manual);
  return { items, ready: items.every((i) => i.ok), posted: !!pub.publishedAt };
}

function createPublishingService({ store }) {
  const get = (id) => store.episodes.get(id);

  async function init(epId, { force = false } = {}) {
    await store.episodes.update(epId, (ep) => {
      const gen = generate(ep);
      const cur = ep.publishing || {};
      if (!force && cur.caption && cur.generatedAt) return;
      ep.publishing = Object.assign({}, cur, gen, { affiliateUrl: cur.affiliateUrl || '', generatedAt: nowIso(), approvedAt: '', checklist: cur.checklist || {} });
    });
    store.episodes.audit(epId, 'publishing.generated', { force });
    return get(epId).publishing;
  }

  async function save(epId, patch) {
    const allowed = ['hook', 'productDescription', 'cta', 'hashtags', 'caption', 'dmMessage', 'affiliateUrl', 'disclosure'];
    await store.episodes.update(epId, (ep) => {
      const pub = (ep.publishing = ep.publishing || {});
      allowed.forEach((k) => patch[k] !== undefined && (pub[k] = k === 'hashtags' && !Array.isArray(patch[k]) ? String(patch[k]).split(/\s+/).filter(Boolean) : patch[k]));
      pub.approvedAt = ''; // any edit needs a new approval
      pub.editedAt = nowIso();
    });
    return get(epId).publishing;
  }

  async function approve(epId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      if (!ep.approvals.final) throw new StudioError('FINAL_NOT_APPROVED', '최종 영상을 먼저 승인하세요.', { status: 409 });
      const f = ep.renders.find((r) => r.v === ep.approvals.final.v);
      if (!f || f.sha256 !== ep.approvals.final.sha256) throw new StudioError('FINAL_STALE', '승인된 최종 영상이 현재 상태와 다릅니다.', { status: 409 });
      const v = validate(ep, ep.publishing || {});
      if (!v.ok) throw new StudioError('INVALID', v.errors[0].message, { details: v.errors, status: 409 });
      ep.publishing.approvedAt = nowIso();
      ep.publishing.approvedBy = by;
      ep.publishing.approvedHash = sha256(canonical([ep.publishing.caption, ep.publishing.dmMessage, ep.publishing.affiliateUrl]));
    });
    store.episodes.audit(epId, 'publishing.approved', { by });
  }

  /** 승인 취소: the caption / DM approval is removed (the text stays); not possible once the post is recorded as published — clear that record first. */
  async function revoke(epId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      if (!ep.publishing || !ep.publishing.approvedAt) return;
      if (ep.publishing.publishedAt) throw new StudioError('ALREADY_PUBLISHED', '게시 완료로 기록된 뒤에는 승인을 취소할 수 없습니다. 먼저 게시 기록을 취소하세요.', { status: 409 });
      ep.publishing.approvedAt = '';
      ep.publishing.approvedBy = '';
      ep.publishing.approvedHash = '';
    });
    store.episodes.audit(epId, 'publishing.revoked', { by });
  }

  /** 게시 기록 취소: only removes the "published" note (a wrong address, a post that was taken down); nothing is posted or deleted anywhere. */
  async function clearPublished(epId, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      if (!ep.publishing || !ep.publishing.publishedAt) return;
      ep.publishing.publishedAt = '';
      ep.publishing.postUrl = '';
    });
    store.episodes.audit(epId, 'publishing.published_cleared', { by });
  }

  async function setChecklist(epId, key, value) {
    if (!MANUAL_ITEMS.some(([k]) => k === key)) throw new StudioError('BAD_ITEM', '운영자가 확인하는 항목이 아닙니다.');
    await store.episodes.update(epId, (ep) => {
      ep.publishing.checklist = Object.assign({}, ep.publishing.checklist, { [key]: !!value });
    });
    store.episodes.audit(epId, 'publishing.checklist', { key, value: !!value });
  }

  async function markPublished(epId, postUrl, by = 'operator') {
    await store.episodes.update(epId, (ep) => {
      const c = checklist(ep);
      if (!c.ready) throw new StudioError('NOT_READY', '체크리스트가 모두 완료되어야 게시 완료로 기록할 수 있습니다.', { status: 409 });
      if (!/^https:\/\/(www\.)?instagram\.com\//i.test(String(postUrl || ''))) throw new StudioError('BAD_URL', '게시물 주소(https://www.instagram.com/…)를 입력하세요. 이 스튜디오는 인스타그램에 직접 게시하지 않습니다.');
      ep.publishing.publishedAt = nowIso();
      ep.publishing.postUrl = postUrl;
    });
    store.episodes.audit(epId, 'publishing.marked_published', { postUrl, by });
  }

  return { init, save, approve, revoke, clearPublished, setChecklist, markPublished, validate: (ep) => validate(ep, ep.publishing || {}), checklist };
}

module.exports = { createPublishingService, generate, validate, checklist, affiliateUrlError, DISCLOSURE, MANUAL_ITEMS };
