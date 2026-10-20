// Products: product info → compliant extraction (or manual) → reference images → approved reference set.
import { h, chip, icon, toast, modal, confirmDialog } from '../ui.js';
import { state, act, go, setProduct } from '../state.js';
import { api } from '../api.js';
import { pageHead, asyncBlock, confirmPaid } from './common.js';
import { imageIntake, savedControls } from './image-intake.js';
import { imagesFromTransfer } from '../image-intake-core.js';
import { parseCoupangShare } from '../coupang-share-core.js';
import { catalog } from './catalog.js';
import { analysisPanel, analysisOpen } from './product-analysis.js';
import { openBriefModal } from './product-brief.js';

const KIND_CHIP = { retrieved: ['원본 · 쇼핑몰 수집', 'mock'], uploaded: ['직접 업로드', ''], ai_generated: ['AI 생성 · 제조사 사진 아님', 'attention'] };
const STATUS_CHIP = { pending: ['검토 대기', ''], approved: ['승인', 'done'], rejected: ['거절', 'err'], replaced: ['교체됨', 'mock'] };
const EXTRACT_CHIP = { none: ['미수집', ''], ok: ['수집됨 · 확인 필요', 'done'], blocked: ['수집 차단 → 직접 입력', 'attention'], failed: ['수집 실패 → 직접 입력', 'attention'] };

export function products() {
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  const pid = state.productId;
  if (!pid || location.hash.split('/').length < 3) return list(wrap);
  return detail(wrap, pid);
}

/** Product code field shown on the always-visible cards (landing list and detail summary) while the code can still be set or changed. */
function codeBox(p) {
  if (p.codeLocked) return null;
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } await act(async () => null); };
  const cf = { code: p.code || '' };
  const inp = h('input', { type: 'text', value: cf.code, maxlength: 5, placeholder: p.suggestedCode || 'UMB', autocapitalize: 'characters', 'aria-label': '제품 코드', 'data-summary-code-input': '', style: 'width:110px;text-transform:uppercase', oninput: (e) => { cf.code = e.target.value.toUpperCase(); } });
  return h('div', { class: 'stack', style: 'gap:4px', 'data-summary-code': '' },
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inp,
      !p.code && p.suggestedCode ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { cf.code = p.suggestedCode; inp.value = p.suggestedCode; } }, '추천 ' + p.suggestedCode + ' 사용') : null,
      h('button', { class: 'btn sm sage', type: 'button', 'data-summary-code-save': '', onclick: () => run(() => api.put('/api/products/' + p.id, { code: cf.code }), '제품 코드를 저장했습니다') }, '코드 저장')),
    h('div', { class: 'small ' + (p.code ? 'muted' : ''), style: p.code ? '' : 'color:var(--clay)' }, p.code ? '첫 에피소드를 만들면 코드가 고정됩니다.' : '에피소드 ID(예: UMB-01-D)를 만들려면 제품 코드(영문 대문자 2~5자)가 필요합니다.'));
}

const REF_LABEL = { none: '없음', approved: '승인됨', waived: '이미지 없이 진행(기록됨)', stale: '재승인 필요' };
const PRODUCT_STATUS = [['ready', '스토리 준비 완료'], ['needs', '준비 필요'], ['noref', '참조 이미지 미승인'], ['inuse', '에피소드 있음']];

/** Product catalog landing page: real product images only (no placeholder art), opening a card just navigates to the existing editor. */
function list(wrap) {
  const items = (state.summary.products || []).map((p) => {
    const eps = (p.linkedEpisodes || []).filter((e) => !e.archived);
    const statuses = [p.readiness.ok ? 'ready' : 'needs'];
    if (!['approved', 'waived'].includes(p.reference)) statuses.push('noref');
    if (eps.length) statuses.push('inuse');
    return { id: p.id, code: p.code || '', name: p.name || '', thumb: p.mainImage ? p.mainImage.url : '', status: statuses[0], statuses,
      statusLabel: p.readiness.ok ? '스토리 준비 완료' : '준비 필요', tone: p.readiness.ok ? 'done' : 'attention', href: '#/products/' + p.id,
      meta: [`이미지 ${p.images}장 · 참조 ${REF_LABEL[p.reference] || p.reference}`, '에피소드 ' + (eps.length ? eps.length + '개' : '없음')],
      note: p.readiness.ok ? null : { text: '필요: ' + p.readiness.missing.join(', '), tone: 'warn' },
      createdAt: p.createdAt || '', updatedAt: p.updatedAt || '', attr: { 'data-product-card': p.id } };
  });
  wrap.append(pageHead('Product Studio', '제품 스튜디오', '제품 카탈로그에서 제품을 고르면 정보·참조 이미지 편집기가 열립니다. 확인된 사실과 승인된 참조 이미지만 스토리 생성에 사용됩니다.'));
  wrap.append(catalog({ id: 'products', items, statusOptions: PRODUCT_STATUS, searchPlaceholder: '제품 이름 · 코드로 검색', noImageText: '대표 이미지 없음',
    emptyTitle: '제품이 없습니다', emptyText: '"새 제품"으로 쿠팡/기타 URL이나 제품 정보를 입력하세요.', noMatchText: '조건에 맞는 제품이 없습니다.',
    create: { label: '새 제품', onClick: newProduct, attr: { 'data-new-product': '' } },
    onOpen: (it) => { setProduct(it.id); location.hash = '#/products/' + it.id; } }));
  return wrap;
}

function newProduct() {
  const f = { name: '', affiliateUrl: '', productNumber: '', itemNumber: '' };
  const inputs = {};
  let busy = false;
  const field = (label, placeholder, key, help = '') => h('div', { class: 'field' },
    h('label', null, label),
    (inputs[key] = h('input', { type: 'text', placeholder, 'aria-label': label, oninput: (e) => (f[key] = e.target.value.trim()) })),
    help ? h('div', { class: 'small muted' }, help) : null);
  // Coupang's own "공유" text ("상품명 + 링크"): split into name / link / numbers. Nothing is fetched; the operator's copied text is the source.
  const shareNote = h('div', { class: 'small muted', 'data-share-note': '' }, '쿠팡 앱·웹의 "공유하기"로 복사한 텍스트(상품명 + 링크)를 그대로 붙여넣으면 아래 칸이 채워집니다.');
  const sharePaste = h('textarea', { rows: 3, 'data-share-paste': '', 'aria-label': '쿠팡 공유 텍스트', placeholder: '예) 쿠쿠 스피드팟 멀티쿠커 5L\nhttps://link.coupang.com/a/...',
    oninput: (e) => {
      const r = parseCoupangShare(e.target.value);
      if (!r.url) { shareNote.textContent = e.target.value.trim() ? '쿠팡 링크(coupang.com)를 찾지 못했습니다. 링크가 포함되도록 복사해 주세요.' : ''; return; }
      f.name = r.name; f.affiliateUrl = r.url;
      inputs.affiliateUrl.value = r.url;
      if (r.productNumber) { f.productNumber = r.productNumber; inputs.productNumber.value = r.productNumber; }
      if (r.itemNumber) { f.itemNumber = r.itemNumber; inputs.itemNumber.value = r.itemNumber; }
      shareNote.textContent = (r.name ? `상품명 "${r.name}" · ` : '상품명 없음 · ') + '링크를 채웠습니다.' + (r.productNumber ? '' : ' 짧은 링크에는 상품번호가 없으니 아래 상품번호는 직접 입력하세요.');
    } });
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, 'AI 제품 등록'),
    h('p', { class: 'small muted', style: 'margin:0' }, '쿠팡 제휴 링크와 상품번호로 공개된 상품 페이지의 제품명·설명·이미지·사양을 가져와 봅니다. 차단되거나 수집할 수 없는 항목은 미확인으로 남겨 수동 보완할 수 있습니다.'),
    h('div', { class: 'field' }, h('label', null, '쿠팡 공유 텍스트 붙여넣기 (선택)'), sharePaste, shareNote),
    field('쿠팡 파트너스 제휴 링크', 'https://link.coupang.com/a/...', 'affiliateUrl', '릴스에 사용할 제휴 링크입니다. 원본 그대로 저장됩니다.'),
    field('쿠팡 상품번호', '예: 9738720085', 'productNumber', '쿠팡상품번호의 하이픈 앞 숫자를 입력하세요.'),
    field('옵션 / 판매자번호 (선택)', '예: 29146799836', 'itemNumber', '쿠팡상품번호의 하이픈 뒤 숫자입니다.'),
    h('p', { class: 'small muted', style: 'margin:0' }, '상품 정보는 자동 수집을 시도한 뒤 확인해야 합니다. 쿠팡 접근 제한을 우회하지 않으며 가격·후기·검증되지 않은 성능은 자동 확정하지 않습니다.'),
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: close }, '취소'),
      h('button', { class: 'btn', onclick: async (e) => {
        if (busy) return;
        const affiliateUrl = f.affiliateUrl.trim();
        const productNumber = f.productNumber.trim();
        const itemNumber = f.itemNumber.trim();
        if (!affiliateUrl || !/^https:\/\//i.test(affiliateUrl)) { toast('https://로 시작하는 제휴 링크를 입력하세요.', { error: true }); return; }
        try {
          const u = new URL(affiliateUrl);
          if (!['link.coupang.com', 'www.coupang.com', 'coupang.com'].includes(u.hostname) || u.username || u.password) throw new Error('쿠팡 제휴 링크만 입력할 수 있습니다.');
        } catch (err) { toast(err.message === 'Invalid URL' ? '올바른 쿠팡 링크를 입력하세요.' : err.message, { error: true }); return; }
        if (!/^\d{5,20}$/.test(productNumber)) { toast('쿠팡 상품번호를 숫자로 입력하세요.', { error: true }); return; }
        if (itemNumber && !/^\d{5,20}$/.test(itemNumber)) { toast('옵션/판매자번호는 숫자로 입력하세요.', { error: true }); return; }
        const url = 'https://www.coupang.com/vp/products/' + productNumber + (itemNumber ? '?itemId=' + itemNumber : '');
        busy = true;
        e.currentTarget.disabled = true;
        let r;
        try { r = await api.post('/api/products', { name: f.name, url, affiliateUrl }); }
        catch (err) { busy = false; e.currentTarget.disabled = false; toast(err.message, { error: true, recovery: err.recovery }); return; }
        if (!r || !r.id) { busy = false; e.currentTarget.disabled = false; return; }
        close();
        setProduct(r.id);
        location.hash = '#/products/' + r.id;
        try {
          const extracted = await api.post('/api/products/' + r.id + '/extract');
          if (extracted?.extraction?.status === 'ok') toast('상품 정보를 불러왔습니다. 항목을 확인하고 승인해 주세요.');
          else toast('제품은 등록됐지만 쇼핑몰 정보 수집이 차단되었거나 실패했습니다. 이미지와 사양을 직접 보완해 주세요.');
        } catch (err) { toast('제품은 등록됐습니다. 자동 수집에 실패해 직접 입력할 수 있습니다.', { error: true, recovery: err.recovery }); }
        await act(async () => null);
      } }, '제품 찾아서 등록하기'))));
}
const inp = (label, type, ph, on) => h('div', { class: 'field' }, h('label', null, label), h('input', { type, placeholder: ph, oninput: (e) => on(e.target.value) }));

function detail(wrap, pid) {
  return asyncBlock(() => api.get('/api/products/' + pid), (p) => draw(p));
}

function draw(p) {
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  const reload = () => import('../state.js').then(({ hooks }) => hooks.rerender());
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } await act(async () => null); };
  wrap.append(pageHead('Product Studio · ' + p.id, p.name || '제품', 'A 제품 정보 → B 참조 이미지 → C 승인. 모든 단계는 저장되고 다시 열어도 유지됩니다.',
    h('button', { class: 'btn ghost', onclick: () => { location.hash = '#/products'; } }, '목록'),
    h('button', { class: 'btn sage', disabled: !p.readiness.ok, onclick: () => { location.hash = '#/storylab/' + p.id; } }, '스토리 랩으로 →')));

  // ---- status & linked episodes ----
  wrap.append(h('div', { class: 'card row between', style: 'gap:12px;flex-wrap:wrap' },
    h('div', { class: 'row', style: 'gap:8px' }, chip(p.readiness.ok ? '스토리 준비 완료' : '준비 필요', p.readiness.ok ? 'done' : 'attention'), chip('참조 세트: ' + ({ none: '미승인', approved: '승인됨', waived: '이미지 없이 진행', stale: '재승인 필요' }[p.reference.state] || p.reference.state), p.reference.approved ? 'done' : 'attention')),
    h('div', { class: 'small' }, h('b', null, '연결된 에피소드: '), p.linkedEpisodes.length ? p.linkedEpisodes.map((e, i) => [i ? ', ' : '', h('a', { href: '#/script/' + e.id, onclick: () => { state.episodeId = e.id; } }, e.id)]) : '아직 없음 (스토리 승인 후 만들어집니다)')));

  // ---- A. info ----
  const f = { price: (p.price && p.price.text) || '', name: p.name, shortName: p.shortName || '', category: p.category, url: p.url, affiliateUrl: p.affiliateUrl, description: p.description, forbidden: (p.forbiddenClaims || []).join(', '), specs: p.specs.map((s) => ({ text: s.text, verified: s.verified, source: s.source })), code: p.code || '' };
  const ex = p.extraction || { status: 'none' };
  const specBox = h('div', { class: 'stack', style: 'gap:8px' });
  const drawSpecs = () => specBox.replaceChildren(...f.specs.map((s, i) => h('div', { class: 'row', style: 'flex-wrap:nowrap' },
    h('input', { type: 'text', value: s.text, 'aria-label': '사양/기능', oninput: (e) => (s.text = e.target.value) }),
    h('label', { class: 'small row', style: 'gap:6px;white-space:nowrap' }, h('input', { type: 'checkbox', checked: !!s.verified, onchange: (e) => (s.verified = e.target.checked) }), '확인됨'),
    chip(s.source === 'extracted' ? '추출됨' : '직접 입력', s.source === 'extracted' ? 'attention' : ''),
    h('button', { class: 'btn icon danger', 'aria-label': '삭제', onclick: () => { f.specs.splice(i, 1); drawSpecs(); } }, icon('trash')))), h('button', { class: 'btn sm ghost', onclick: () => { f.specs.push({ text: '', verified: true, source: 'manual' }); drawSpecs(); } }, icon('plus'), '기능/사양 추가'));
  drawSpecs();
  wrap.append(h('div', { class: 'card stack', style: 'gap:14px' },
    h('div', { class: 'card-head' }, h('h2', null, 'A · 제품 정보'), h('div', { class: 'row' }, chip(...EXTRACT_CHIP[ex.status] || EXTRACT_CHIP.none), h('button', { class: 'btn sm ghost', disabled: !p.url, onclick: () => run(() => api.post(`/api/products/${p.id}/extract`), 'URL 수집을 시도했습니다') }, icon('refresh'), 'URL에서 가져오기'))),
    ex.note ? h('div', { class: 'banner ' + (ex.status === 'ok' ? 'ok' : 'warn') }, h('div', null, ex.note, ex.imageFailures && ex.imageFailures.length ? h('div', { class: 'small' }, `이미지 ${ex.imageFailures.length}장은 가져오지 못했습니다.`) : null)) : null,
    h('div', { class: 'grid two' }, fld('제품 이름', f.name, (v) => (f.name = v)), fld('카테고리', f.category, (v) => (f.category = v)), fld('제품 URL', f.url, (v) => (f.url = v)), fld('쿠팡 파트너스(제휴) 링크', f.affiliateUrl, (v) => (f.affiliateUrl = v))),
    h('div', { class: 'field', 'data-product-short-name': '' }, h('label', null, '엔딩 대사용 짧은 이름 (선택)'), h('input', { type: 'text', value: f.shortName, maxlength: 30, placeholder: '예: 배수구 필터', 'aria-label': '엔딩 대사용 짧은 이름', oninput: (e) => (f.shortName = e.target.value) }), h('div', { class: 'small muted' }, '고정 엔딩 대사(5초 컷)에서 말하는 제품 이름입니다. 쿠팡 상품명이 길면 대사가 5초를 넘어 승인이 막히니, 짧게 적어 두세요. 비워 두면 제품 이름 전체를 씁니다. 새로 만드는 에피소드부터 적용됩니다.')),
    h('div', { class: 'field', 'data-product-code': '' }, h('label', null, '제품 코드 (에피소드 ID의 앞부분 · 예: UMB-01-D)'),
      h('div', { class: 'row', style: 'flex-wrap:nowrap' },
        h('input', { type: 'text', value: f.code, maxlength: 5, placeholder: p.suggestedCode || 'UMB', disabled: !!p.codeLocked, autocapitalize: 'characters', 'aria-label': '제품 코드', style: 'width:110px;text-transform:uppercase', oninput: (e) => (f.code = e.target.value.toUpperCase()) }),
        !p.code && p.suggestedCode ? h('button', { class: 'btn sm ghost', type: 'button', onclick: (e) => { f.code = p.suggestedCode; e.target.closest('.row').querySelector('input').value = p.suggestedCode; } }, '추천 ' + p.suggestedCode + ' 사용') : null),
      h('div', { class: 'small muted' }, p.codeLocked ? '이미 에피소드 ID에 쓰여 바꿀 수 없습니다.' : p.code ? '첫 에피소드를 만들면 코드가 고정됩니다.' : '에피소드를 만들려면 먼저 코드를 정하세요 (영문 대문자 2~5자). 첫 에피소드를 만들면 고정됩니다.')),
    h('div', { class: 'field' }, h('label', null, '가격 (직접 입력 · 선택)'), h('input', { type: 'text', value: f.price, placeholder: '예: 12,900원 (확인한 날짜 기준)', oninput: (e) => (f.price = e.target.value) }), h('div', { class: 'small muted' }, p.price ? `${p.price.note} · 입력: ${new Date(p.price.enteredAt).toLocaleDateString('ko-KR')}` : '가격은 자동 수집하지 않습니다. 입력하지 않으면 영상·대본에 가격을 쓰지 않습니다.')),
    h('div', { class: 'field' }, h('label', null, '제품 설명'), h('textarea', { rows: 2, oninput: (e) => (f.description = e.target.value) }, f.description)),
    h('div', { class: 'field' }, h('label', null, '확인된 기능·사양 — "확인됨"으로 표시된 것만 스토리 생성에 사용됩니다'), specBox),
    fld('금지 표현 (쉼표로 구분 — 영상/대본에서 쓰면 안 되는 제품 주장)', f.forbidden, (v) => (f.forbidden = v)),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => run(() => api.put('/api/products/' + p.id, { code: f.code, price: { text: f.price }, name: f.name, shortName: f.shortName, category: f.category, url: f.url, affiliateUrl: f.affiliateUrl, description: f.description, specs: f.specs, forbiddenClaims: f.forbidden.split(',').map((x) => x.trim()).filter(Boolean) }), '저장했습니다') }, '저장')),
    p.url ? h('p', { class: 'small muted', style: 'margin:0' }, '출처 URL: ' + p.url + ' · 가격·할인·평점은 수집하지 않으며 제품 사실은 직접 확인한 것만 사용합니다.') : null));

  // ---- Customer-review research (separate from product reference images) ----
  const rr = p.reviewResearch || { images: [], text: '', analysis: null, approved: false };
  const reviewText = h('textarea', { rows: 5, placeholder: '리뷰 원문을 붙여 넣어도 됩니다. 리뷰별로 구분해 주세요.', 'aria-label': '리뷰 원문' }, rr.text || '');
  // One path for the file picker, paste and drag-and-drop. Review screenshots are research, never product reference images.
  const addReviewFiles = async (files, source = 'file') => {
    files = files.filter((f) => /^image\//i.test(f.type || ''));
    if (!files.length) return toast('이미지 파일만 추가할 수 있습니다.', { error: true });
    if (files.length + (rr.images || []).length + p.images.filter((im) => im.kind === 'uploaded' && !im.removed && im.status !== 'replaced').length > 10) return toast('제품과 리뷰 스크린샷은 합쳐 최대 10장입니다.', { error: true });
    for (const [n, f] of files.entries()) {
      const file = source === 'file' ? f : new File([f], `${source === 'paste' ? '붙여넣은' : '끌어놓은'} 리뷰 ${new Date().toLocaleTimeString('ko-KR')} ${n + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type });
      try { await api.upload('/api/products/' + p.id + '/reviews/image', file); }
      catch (err) { toast(err.message, { error: true, recovery: err.recovery }); await act(async () => null); return; }
    }
    toast('리뷰 캡처를 추가했습니다.'); await act(async () => null);
  };
  const reviewFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, 'aria-label': '리뷰 스크린샷', onchange: async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    await addReviewFiles(files);
  } });
  // Click here, then Cmd/Ctrl+V. stopPropagation keeps the page-wide paste handler (which feeds PRODUCT images) out of it.
  const reviewDrop = h('div', { class: 'dropzone review-drop', tabindex: 0, role: 'button', 'data-review-dropzone': '', 'aria-label': '리뷰 스크린샷 추가: 클릭 후 붙여넣기 또는 끌어다 놓기',
    onpaste: (e) => { const files = imagesFromTransfer(e.clipboardData); if (!files.length) return; e.preventDefault(); e.stopPropagation(); addReviewFiles(files, 'paste'); },
    ondragover: (e) => { e.preventDefault(); reviewDrop.classList.add('over'); },
    ondragleave: () => reviewDrop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); reviewDrop.classList.remove('over'); const files = imagesFromTransfer(e.dataTransfer); if (files.length) addReviewFiles(files, 'drop'); },
    onclick: () => reviewDrop.focus() },
    h('div', { class: 'small' }, '여기를 클릭한 뒤 스크린샷을 붙여넣기(Cmd/Ctrl+V)하거나 이미지를 끌어다 놓으세요'),
    h('div', { class: 'small muted' }, '제품 이미지가 아니라 리뷰 자료로 저장됩니다.'));
  const saveReviewText = async () => {
    try { await api.put('/api/products/' + p.id + '/reviews', { text: reviewText.value }); toast('리뷰 원문을 저장했습니다.'); await act(async () => null); }
    catch (err) { toast(err.message, { error: true }); }
  };
  const reviewRun = async () => {
    if (reviewText.value !== (rr.text || '')) {
      toast('변경된 리뷰 원문을 먼저 저장해 주세요.', { error: true }); return;
    }
    let estimate;
    try { estimate = await api.post('/api/products/' + p.id + '/reviews/estimate'); }
    catch (err) { toast(err.message, { error: true }); return; }
    const confirm = await confirmPaid({ est: estimate, title: '리뷰 3개 AI 분석', body: h('p', { class: 'small' }, '리뷰 캡처와 원문을 AI 모델에 전송해 장점·단점·구매 동기·코미디 상황을 분석합니다.') });
    if (!confirm) return;
    try { await api.post('/api/products/' + p.id + '/reviews/analyze', { confirm }); toast('리뷰 분석 초안이 생성됐습니다. 내용을 확인하고 승인해 주세요.'); await act(async () => null); }
    catch (err) { toast(err.message, { error: true, recovery: err.recovery }); }
  };
  const reviewBlock = h('div', { class: 'stack', style: 'gap:12px', 'data-product-reviews': p.id },
    h('div', { class: 'card-head' }, h('h2', null, '리뷰 리서치 · 총 업로드 10장 이내'), chip(rr.approved ? '분석 승인' : '미승인', rr.approved ? 'done' : 'attention')),
    h('p', { class: 'small muted' }, '리뷰는 소비자 개인 경험입니다. 확인된 제품 사양이 아니므로 광고 문구에 사실처럼 사용하지 않습니다. 리뷰 캡처는 제품 레퍼런스 사진과 분리됩니다.'),
    h('div', { class: 'field' }, h('label', null, '리뷰 스크린샷 (제품 포함 총 10장)'), reviewFile, reviewDrop),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, ...(rr.images || []).map((im, i) =>
      h('figure', { style: 'margin:0;width:110px' }, h('img', { src: '/media/product-review/' + p.id + '/' + i, alt: '리뷰 캡처 ' + (i + 1), style: 'width:100%;height:110px;object-fit:contain' }), h('figcaption', { class: 'small muted' }, '리뷰 ' + (i + 1))))),
    h('div', { class: 'field' }, h('label', null, '리뷰 원문 (선택)'), reviewText),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn ghost', onclick: saveReviewText }, '리뷰 원문 저장'),
      h('button', { class: 'btn clay', disabled: !(rr.images || []).length && !(rr.text || '').trim(), onclick: reviewRun }, 'AI 리뷰 분석')),
    rr.analysis ? h('div', { class: 'stack', style: 'gap:8px' },
      h('h3', null, 'AI 분석 초안'),
      h('p', null, rr.analysis.summary || ''),
      ...[['pros','장점'],['cons','단점'],['purchaseMotivations','구매 동기'],['comicSituations','릴스 코미디 아이디어'],['cautions','주의사항']].map(([key,label]) =>
        h('div', { class: 'stack', style: 'gap:3px' }, h('b', null, label), h('p', { class: 'small', style: 'white-space:pre-wrap;margin:0' }, (rr.analysis[key] || []).map((x) => '• ' + x).join('\n') || '없음'))),
      h('button', { class: 'btn sage', disabled: !!rr.approved, onclick: async () => {
        try { await api.post('/api/products/' + p.id + '/reviews/approve', { approved: true }); toast('리뷰 분석이 승인되었습니다.'); await act(async () => null); }
        catch (err) { toast(err.message, { error: true }); }
      } }, rr.approved ? '승인됨' : '내용 확인 후 승인')) : null);

  // ---- B. images ----
  const dz = imageIntake({ product: p, run, rerender: () => act(async () => null) });
  const imgs = p.images;
  const card = (im) => {
    const inSet = (p.reference.imageIds || []).includes(im.id);
    const rep = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onchange: async (e) => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      const guarded = im.status === 'approved' || inSet;
      if (guarded && !(await confirmDialog({ title: '승인된 참조 이미지를 교체할까요?', body: '교체하면 참조 세트를 다시 승인해야 합니다. 기존 이미지는 "교체됨"으로 남습니다.', confirm: '교체', tone: 'danger' }))) return;
      await run(() => api.upload(`/api/products/${p.id}/images/${im.id}/replace${guarded ? '?confirm=1' : ''}`, file), '이미지를 교체했습니다');
    } });
    const set = (status) => run(() => api.post(`/api/products/${p.id}/images/${im.id}/status`, { status }));
    return h('figure', { class: 'ref' + (im.status === 'approved' ? ' ok' : ''), style: im.status === 'replaced' ? 'opacity:.5' : '' },
      h('img', { src: im.url, alt: im.label || '제품 이미지' }),
      h('figcaption', null,
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, chip(...KIND_CHIP[im.kind]), chip(...STATUS_CHIP[im.status]), im.primary ? chip('대표', 'done') : null),
        im.width ? h('div', { class: 'small muted' }, `${im.width}×${im.height}px`) : null,
        h('div', { class: 'small' }, im.label || ''),
        im.disclosure ? h('div', { class: 'small', style: 'color:var(--clay)' }, im.disclosure) : null,
        im.licenseNote ? h('div', { class: 'small muted' }, im.licenseNote) : null,
        im.kind === 'ai_generated' ? h('div', { class: 'small muted mono' }, (im.provider || '') + ' / ' + (im.model || '')) : null,
        im.status === 'replaced' ? null : h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm ' + (im.status === 'approved' ? 'ghost' : 'sage'), onclick: () => set(im.status === 'approved' ? 'pending' : 'approved') }, im.status === 'approved' ? '승인 취소' : '승인'),
          h('button', { class: 'btn sm danger', disabled: im.status === 'rejected', onclick: () => set('rejected') }, '거절'),
          rep, h('button', { class: 'btn sm ghost', onclick: () => rep.click() }, '교체'),
          im.kind === 'ai_generated' ? h('button', { class: 'btn sm ghost', onclick: () => compare(p, im) }, '원본과 비교') : null),
        im.status === 'replaced' ? null : savedControls(p, im, imgs.filter((i) => i.kind !== 'ai_generated' && i.status !== 'replaced'), run)));
  };
  const waitingUploaded = imgs.filter((i) => i.kind === 'uploaded' && i.status === 'pending' && !i.removed);
  const approveUploadedButton = h('button', { class: 'btn sm sage', type: 'button', disabled: !waitingUploaded.length, 'data-approve-uploaded-all': '',
    onclick: async () => {
      const ids = waitingUploaded.map((i) => i.id);
      if (!ids.length) return;
      const yes = await confirmDialog({ title: '제품 참조 이미지 전체 승인', body: '직접 업로드한 제품 이미지 ' + ids.length + '장을 모두 승인할까요? 리뷰와 AI 생성 이미지는 포함되지 않습니다.', confirm: '전체 승인' });
      if (!yes) return;
      await run(() => api.post('/api/products/' + p.id + '/images/approve-uploaded', { imageIds: ids }), ids.length + '장의 제품 참조 이미지를 승인했습니다.');
    } }, '업로드 이미지 전체 승인 (' + waitingUploaded.length + ')');
  const approvedOrig = imgs.filter((i) => i.kind !== 'ai_generated' && i.status === 'approved');
  wrap.append(h('div', { class: 'card stack', style: 'gap:14px' },
    h('div', { class: 'card-head' }, h('h2', null, 'B · 참조 이미지'), h('div', { class: 'row' }, chip('승인 ' + imgs.filter((i) => i.kind === 'uploaded' && i.status === 'approved').length + '/' + imgs.filter((i) => i.kind === 'uploaded' && !i.removed && i.status !== 'replaced').length), approveUploadedButton)),
    h('div', { class: 'banner' }, icon('lock'), h('div', null, '쇼핑몰에서 가져온 이미지는 광고·AI 변형 사용 권한이 확인되지 않았습니다. AI 생성 이미지는 항상 "AI 생성"으로 표시되며 제조사 사진으로 쓰이지 않습니다. 제품의 모양·로고·색상·기능을 바꾼 이미지는 승인하지 마세요.')),
    imgs.filter((i) => i.kind !== 'ai_generated').length ? h('div', { class: 'ref-grid', style: 'grid-template-columns:repeat(auto-fill,minmax(170px,1fr))' }, imgs.filter((i) => i.kind !== 'ai_generated').map(card)) : h('div', { class: 'empty' }, '이미지가 없습니다. 업로드하거나 URL에서 가져오세요.'),
    dz));

  // ---- B2. AI reference studio: generations side by side ----
  const gens = p.generations || [];
  const byId = (id) => imgs.find((i) => i.id === id);
  const chooseOne = (im) => run(() => api.post(`/api/products/${p.id}/images/${im.id}/choose`), `v${im.version}을 선택했습니다 (같은 요청의 나머지 대기 버전은 거절됨)`);
  const genBlock = (g, n) => {
    const vers = g.imageIds.map(byId).filter(Boolean);
    const srcs = (g.basedOn || []).map(byId).filter(Boolean);
    return h('div', { class: 'card flat stack', style: 'gap:10px' },
      h('div', { class: 'row between' }, h('b', null, `생성 #${gens.length - n} · ${g.style === 'product' ? '사실적 제품 사진' : '2D 애니/웹툰'}`), h('span', { class: 'small muted' }, g.prompt ? '요청: ' + g.prompt : '요청 문구 없음')),
      h('div', { class: 'ref-grid', style: 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr))' },
        srcs.map((o) => h('figure', { class: 'ref' }, h('img', { src: o.url, alt: '기준 원본' }), h('figcaption', null, chip('기준 원본', 'mock'), h('div', { class: 'small muted' }, o.label || '')))),
        vers.map((im) => h('figure', { class: 'ref' + (im.status === 'approved' ? ' ok' : ''), style: im.status === 'rejected' ? 'opacity:.55' : '' },
          h('img', { src: im.url, alt: `AI 생성 v${im.version}` }),
          h('figcaption', null,
            h('div', { class: 'row', style: 'gap:6px' }, chip(`v${im.version}`, 'attention'), chip(...STATUS_CHIP[im.status])),
            h('div', { class: 'small muted mono' }, (im.provider || '') + ' / ' + (im.model || '')),
            im.decisionNote ? h('div', { class: 'small muted' }, im.decisionNote) : null,
            h('div', { class: 'row', style: 'gap:6px' },
              h('button', { class: 'btn sm sage', disabled: im.status === 'approved' || im.status === 'rejected', onclick: () => chooseOne(im) }, '이 버전 선택'),
              h('button', { class: 'btn sm danger', disabled: im.status === 'rejected', onclick: () => run(() => api.post(`/api/products/${p.id}/images/${im.id}/status`, { status: 'rejected' })) }, '거절'),
              im.status === 'rejected' ? h('button', { class: 'btn sm ghost', onclick: () => run(() => api.post(`/api/products/${p.id}/images/${im.id}/status`, { status: 'pending' })) }, '되돌리기') : null))))),
      h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', disabled: !srcs.some((o) => o.status === 'approved'), onclick: () => genDialog(p, approvedOrig, g) }, '같은 설정으로 다시 생성…')));
  };
  wrap.append(h('div', { class: 'card stack', style: 'gap:14px' },
    h('div', { class: 'card-head' }, h('h2', null, 'B2 · AI 참조 이미지 (생성 이력)'), h('button', { class: 'btn sm', disabled: !approvedOrig.length, onclick: () => genDialog(p, approvedOrig) }, icon('plus'), '새로 생성…')),
    approvedOrig.length ? null : h('div', { class: 'banner warn' }, icon('lock'), h('div', null, '먼저 위에서 원본/업로드 이미지를 하나 이상 승인하세요. 승인된 이미지가 AI 생성의 기준(source of truth)입니다. 이미지 생성을 쓰지 않으려면 직접 업로드한 이미지를 승인하고 C 단계로 가면 됩니다.')),
    gens.length ? gens.map(genBlock) : h('div', { class: 'empty' }, '아직 AI로 만든 참조 이미지가 없습니다. 생성하지 않고 직접 업로드한 이미지만으로도 진행할 수 있습니다.')));

  // ---- C. reference set approval ----
  const r = p.reference;
  const approvedIds = imgs.filter((i) => i.status === 'approved').map((i) => i.id);
  wrap.append(h('div', { class: 'card stack', style: 'gap:12px' },
    h('div', { class: 'card-head' }, h('h2', null, 'C · 참조 세트 승인'), chip(({ none: '미승인', approved: '승인됨', stale: '재승인 필요', waived: '이미지 없이 진행' })[r.state], r.approved ? 'done' : 'attention')),
    r.state === 'approved' ? h('p', { class: 'small', style: 'margin:0' }, `${r.imageIds.length}장 승인 · ${new Date(r.at).toLocaleString('ko-KR')} · 세트 해시 ${r.hash.slice(0, 10)}. 이미지가 바뀌면 자동으로 무효가 됩니다.`) : null,
    r.state === 'stale' ? h('div', { class: 'banner warn' }, r.note) : null,
    r.state === 'waived' ? h('p', { class: 'small', style: 'margin:0' }, '사유: ' + r.waived) : null,
    p.readiness.ok ? h('div', { class: 'banner ok' }, '스토리 랩에서 사용할 준비가 되었습니다.') : h('div', { class: 'banner warn' }, h('div', null, '필요: ' + p.readiness.missing.join(', '))),
    h('div', { class: 'row' },
      h('button', { class: 'btn sage', disabled: !approvedIds.length, onclick: () => run(() => api.post(`/api/products/${p.id}/references/approve`, { imageIds: approvedIds }), '참조 이미지 세트를 승인했습니다') }, icon('check'), `승인된 이미지 ${approvedIds.length}장을 참조 세트로 승인`),
      h('button', { class: 'btn ghost', onclick: waive }, '이미지 없이 진행…'))));
  async function waive() {
    const reason = prompt('이미지 없이 진행하는 이유를 적으세요 (기록됩니다)');
    if (reason) await run(() => api.post(`/api/products/${p.id}/references/waive`, { reason }), '기록했습니다');
  }
  void reload;
  // ---- default view: summary first; everything else folded ----
  const [head, , A, B, B2, C] = Array.from(wrap.children);
  const fold = (title, badge, open, el) => h('details', { class: 'fold', open: open || undefined, 'data-fold': title }, h('summary', null, h('b', null, title), badge ? h('span', { class: 'small muted' }, badge) : null), el);
  const refChip = ({ none: ['참조 미승인', 'attention'], approved: ['참조 승인됨', 'done'], stale: ['참조 재승인 필요', 'attention'], waived: ['이미지 없이 진행', 'mock'] })[p.reference.state];
  const live = p.linkedEpisodes.filter((e) => !e.archived);
  const summary = h('section', { class: 'card prod-summary', 'data-product-summary': p.id },
    p.mainImage ? h('img', { class: 'prod-main', src: p.mainImage.url, alt: '대표 참조 이미지' }) : h('div', { class: 'prod-main empty' }, '대표 이미지 없음'),
    h('div', { class: 'stack', style: 'gap:8px;min-width:0' },
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('span', { class: 'ep-code' }, p.code || '코드 없음'), chip(...refChip), chip(p.readiness.ok ? '스토리 준비 완료' : '준비 필요', p.readiness.ok ? 'done' : 'attention'),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-brief-open': p.id, onclick: () => openBriefModal(p, () => act(async () => null)) }, 'AI 분석 결과 보기')),
      codeBox(p),
      h('h2', { style: 'margin:0;overflow-wrap:anywhere' }, p.name || '제품'),
      p.url ? h('a', { class: 'small', href: p.url, target: '_blank', rel: 'noopener', style: 'overflow-wrap:anywhere' }, p.url) : h('div', { class: 'small muted' }, '제품 링크 없음 (직접 입력)'),
      h('div', { class: 'small' }, h('b', null, '연결된 에피소드: '), live.length ? live.map((e, i) => [i ? ', ' : '', h('a', { href: '#/script/' + e.id, onclick: () => { state.episodeId = e.id; } }, e.displayId || e.id)]) : '없음'),
      p.readiness.ok ? null : h('div', { class: 'small', style: 'color:var(--clay)' }, '필요: ' + p.readiness.missing.join(', ')),
      h('div', { class: 'row' }, h('button', { class: 'btn sage', type: 'button', 'data-create-story': p.id, disabled: !p.readiness.ok, title: p.readiness.ok ? '' : '필요: ' + p.readiness.missing.join(', '), onclick: () => { location.hash = '#/storylab/' + p.id; } }, '스토리 만들기 →'))));
  // Streamlined workflow: one intake, analysis, editable image prompt, and story handoff.
  const productImages = imgs.filter((i) => i.kind !== 'ai_generated' && !['replaced','rejected'].includes(i.status));
  const productCount = productImages.filter((i) => i.kind === 'uploaded').length;
  const reviewCount = (rr.images || []).length;
  const totalCount = productCount + reviewCount;
  const defaultPrompt = [
    'Create an accurate, clean product reference image for use in animated storyboard generation.',
    'Product: ' + (p.name || 'unnamed product'),
    'Preserve the exact silhouette, dimensions, color, handles, controls, logo, and any readable text from the uploaded source photos.',
    ...((p.specs || []).filter((s) => s.verified).slice(0, 8).map((s) => 'Verified feature: ' + s.text)),
    ...((p.analyses || []).filter((a) => a.status === 'approved' && a.v === p.analysisApprovedV).map((a) => 'Approved visual structure analysis:\n' + (a.text || '').slice(0, 1500))),
    'Neutral background, clear front or three-quarter angle, no extra invented parts.',
    'Do not use customer review screenshots as product shape references.'
  ].join('\n');
  const promptText = h('textarea', { rows: 9, 'data-reference-prompt': '', 'aria-label': '이미지 생성 프롬프트 직접 수정', placeholder: 'AI 분석 후 제품 이미지 생성 프롬프트를 수정하세요.' }, p.referencePrompt || defaultPrompt);
  const promptSave = async () => {
    try { await api.put('/api/products/' + p.id, { referencePrompt: promptText.value }); toast('이미지 생성 프롬프트를 저장했습니다.'); }
    catch (e) { toast(e.message, { error: true }); }
  };
  const imageSection = h('div', { class: 'stack', style: 'gap:12px' },
    h('div', { class: 'row between', style: 'flex-wrap:wrap' }, h('h3', null, '제품 스크린샷'), chip(productCount + '장 · 제품/리뷰 합계 ' + totalCount + '/10')),
    h('p', { class: 'small muted', style: 'margin:0' }, '제품 사진은 3~5장 권장. 이미지 선택, 끌어놓기, Cmd+V 붙여넣기가 가능합니다. 저장 후 원본을 확인해 주세요.'),
    B);
  const reviewSection = h('div', { class: 'stack', style: 'gap:10px' },
    h('h3', null, '리뷰 캡처 · 텍스트'),
    h('p', { class: 'small muted', style: 'margin:0' }, '제품과 리뷰 이미지를 합쳐 최대 10장. 리뷰 자료는 참조 이미지 생성에 사용하지 않고 사용자 의견 분석에만 사용합니다.'),
    reviewBlock);
  const promptSection = h('div', { class: 'card stack', style: 'gap:12px', 'data-product-reference-prompt': '' },
    h('h2', null, '이미지 생성 프롬프트 · 직접 수정'),
    h('p', { class: 'small muted' }, '제품 분석을 확인한 다음 아래 문장을 원하는 대로 편집하세요. 제품의 실제 로고·형태·버튼은 업로드한 사진과 일치해야 합니다.'),
    promptText,
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn ghost', onclick: promptSave }, '프롬프트 저장'),
      h('button', { class: 'btn clay', disabled: !approvedOrig.length, onclick: async () => {
        await promptSave();
        genDialog(p, approvedOrig, null, promptText.value);
      } }, '이 프롬프트로 참조 이미지 생성…')));
  const analysisSection = h('div', { class: 'stack', style: 'gap:14px' },
    h('div', { class: 'card stack', style: 'gap:12px' },
      h('h2', null, 'AI 제품 분석'),
      h('p', { class: 'small muted' }, '제품 사진의 형태·기능·표기 문구는 시각 분석으로, 리뷰의 장단점은 별도의 리뷰 분석으로 정리합니다. AI 실행 전 각각 예상 비용을 확인합니다.'),
      analysisPanel(p)),
    rr.analysis ? h('div', { class: 'small muted' }, rr.approved ? '리뷰 분석 승인됨 · 스토리 랩에 반영됩니다.' : '리뷰 분석 초안 · 먼저 승인해 주세요.') : null,
    promptSection);
  const intake = h('section', { class: 'card stack', style: 'gap:20px', 'data-unified-product-intake': '' },
    h('div', { class: 'stack', style: 'gap:6px' }, h('h2', null, '1 · 제품 자료 모으기'), h('p', { class: 'small muted' }, '쿠팡 제휴 링크·상품번호로 등록한 제품에 스크린샷과 리뷰를 한 화면에서 추가하세요.')),
    fold('제품 링크 · 상품명 · 스펙 · 복붙 메모', '추출 정보 확인 및 수정', !p.name || !p.specs.some((s) => s.verified), A),
    imageSection, reviewSection);
  const results = h('section', { class: 'stack', style: 'gap:14px', 'data-product-analysis-results': '' },
    h('h2', null, '2 · AI 분석 결과와 프롬프트'), analysisSection,
    fold('참조 이미지 버전 기록 · 고급', '필요할 때만 열기', false, B2),
    fold('참조 이미지 승인 · 고급', p.reference.state === 'approved' ? '승인됨' : '확인 필요', false, C));
  wrap.replaceChildren(head, summary, intake, results);
  return wrap;
}

const fld = (label, value, on) => h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'text', value, oninput: (e) => on(e.target.value) }));

function compare(p, im) {
  const src = (im.derivedFrom || []).map((id) => p.images.find((x) => x.id === id)).filter(Boolean);
  modal((close) => h('div', { class: 'stack' }, h('h2', null, '원본 vs AI 생성'),
    h('div', { class: 'grid two' },
      h('div', { class: 'stack', style: 'gap:6px' }, h('b', null, '원본 (승인됨)'), src.map((s) => h('img', { src: s.url, alt: '원본', style: 'width:100%;border-radius:12px;border:1px solid var(--line)' }))),
      h('div', { class: 'stack', style: 'gap:6px' }, h('b', null, 'AI 생성'), h('img', { src: im.url, alt: 'AI 생성', style: 'width:100%;border-radius:12px;border:1px solid var(--line)' }))),
    h('p', { class: 'small muted', style: 'margin:0' }, '제품의 모양·비율·로고·글자·색상·기능이 원본과 같은지 확인한 뒤에만 승인하세요. 다르면 거절하세요.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, '닫기')), ), { wide: true });
}

async function genDialog(p, originals, prev = null, initialPrompt = '') {
  const sel = new Set(prev ? (prev.basedOn || []).filter((i) => originals.some((o) => o.id === i)) : originals.slice(0, 2).map((i) => i.id));
  const extra = new Set(prev ? prev.extraRefs || [] : []);
  const pool = p.images.filter((i) => i.kind !== 'ai_generated' && !['rejected', 'replaced'].includes(i.status) && !originals.some((o) => o.id === i.id && sel.has(o.id)));
  let prompt = initialPrompt || (prev ? prev.prompt || '' : '');
  let style = prev && prev.style ? prev.style : 'anime';
  const body = () => ({ basedOn: [...sel], extraImageIds: [...extra].filter((i) => !sel.has(i)), style, prompt });
  if (!sel.size && originals.length) sel.add(originals[0].id);
  const route = ((state.summary.ai || {}).routing || []).find((r) => r.task === 'imageGeneration') || { provider: 'mock' };
  const blocked = route.provider !== 'gemini';
  modal((close) => h('div', { class: 'stack' }, h('h2', null, prev ? 'AI 참조 이미지 다시 생성' : 'AI 참조 이미지 만들기'),
    h('p', { class: 'small muted', style: 'margin:0' }, '승인된 원본을 기준으로 2D 애니/웹툰 스타일의 제품 참조 이미지를 만듭니다. 제품 모양·비율·로고·색상·기능은 바꾸지 않도록 지시하지만 결과가 다를 수 있으므로 반드시 원본과 비교한 뒤 승인하세요. 결과는 항상 "AI 생성"으로 표시됩니다.'),
    h('div', { class: 'field' }, h('label', null, '기준이 될 승인된 원본 (필수)'),
      h('div', { class: 'ref-grid' }, originals.map((o) => h('label', { class: 'ref' }, h('img', { src: o.url, alt: '' }), h('figcaption', null, h('span', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: sel.has(o.id), onchange: (e) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id)) }), o.label || o.id)))))),
    h('div', { class: 'field' }, h('label', null, '추가 참조 이미지 (선택, 최대 5장 — 다른 각도·디테일)'),
      pool.length ? h('div', { class: 'ref-grid' }, pool.map((o) => h('label', { class: 'ref' }, h('img', { src: o.url, alt: '' }), h('figcaption', null, h('span', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: extra.has(o.id), onchange: (e) => { if (e.target.checked) { if (extra.size >= 5) { e.target.checked = false; return toast('추가 참조는 최대 5장입니다', { error: true }); } extra.add(o.id); } else extra.delete(o.id); } }), o.label || o.id))))) : h('div', { class: 'small muted' }, '추가로 쓸 이미지가 없습니다. 위 B 단계에서 이미지를 올리면 여기에 나타납니다.')),
    h('div', { class: 'field' }, h('label', null, '스타일'), h('select', { onchange: (e) => (style = e.target.value) }, h('option', { value: 'anime', selected: style === 'anime' }, '2D 애니/웹툰 (기본)'), h('option', { value: 'product', selected: style === 'product' }, '사실적 제품 사진'))),
    h('div', { class: 'field' }, h('label', null, '변형 요청 (배경/각도/조명만, 선택)'), h('textarea', { rows: 2, placeholder: '예: 밝은 원목 현관 벽 앞, 정면', oninput: (e) => (prompt = e.target.value) }, prompt)),
    blocked ? h('div', { class: 'banner warn' }, h('div', null, h('b', null, '이미지 생성 제공자가 연결되지 않았습니다. '), 'Settings → AI 연동에서 Gemini 키를 저장하고 이미지 생성이 가능한 모델을 "제품 이미지 생성" 작업에 지정하세요. 그 전까지는 직접 업로드한 이미지로 진행할 수 있습니다. (샘플 이미지로 성공한 것처럼 보이지 않습니다.)')) : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, '취소'), h('button', { class: 'btn clay', disabled: blocked, onclick: async () => {
      if (!sel.size) return toast('기준 원본을 하나 이상 선택하세요', { error: true });
      let est;
      try { est = await api.post(`/api/products/${p.id}/images/estimate`, body()); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
      const c = await confirmPaid({ title: 'AI 이미지 생성 (유료일 수 있음)', est, confirmLabel: '생성' });
      if (!c) return;
      close();
      try { await api.post(`/api/products/${p.id}/images/generate`, Object.assign(body(), { confirm: c })); toast('AI 이미지를 만들었습니다 (원본과 비교 후 한 버전을 선택하세요)'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
      await act(async () => null);
    } }, '비용 확인 후 생성…'))), { wide: true });
}

void go; void confirmDialog;
