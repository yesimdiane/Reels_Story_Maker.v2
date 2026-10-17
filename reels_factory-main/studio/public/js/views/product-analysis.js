// Product Studio → 제품 구조 설명 (AI 시각 분석): a vision AI reads the product reference images and drafts an English
// PRODUCT STRUCTURE DESCRIPTION. The operator reviews / corrects it and approves it. The approved text is attached, together with the
// actual reference images, to every scene image that shows the product. Nothing here bills without the cost confirmation.
import { h, chip, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { asyncBlock, confirmPaid } from './common.js';

const STATUS = { approved: ['승인됨', 'done'], draft: ['검토 대기 (초안)', 'attention'], superseded: ['이전 버전', 'mock'] };

/** The fold stays open once the operator has started working in it (every action re-renders the product page). */
export const analysisOpen = (p) => !!(state.draft['pa:' + p.id] && state.draft['pa:' + p.id].open);

export function analysisPanel(p) {
  const key = 'pa:' + p.id;
  const ui = (state.draft[key] = state.draft[key] || { v: null, text: null, ids: null, open: false });
  const rerender = () => act(async () => null);
  return asyncBlock(() => api.get(`/api/products/${p.id}/analysis`), (a) => draw(p, a, ui, rerender), { label: '제품 구조 설명을 불러오는 중…' });
}

function draw(p, a, ui, rerender) {
  const shown = a.versions.find((v) => v.v === ui.v) || a.latest || a.approved || null;
  if (shown && ui.v !== shown.v) { ui.v = shown.v; ui.text = null; }
  const text = shown ? (ui.text != null ? ui.text : shown.text) : '';
  const approvedHere = !!shown && shown.status === 'approved';
  const live = (p.images || []).filter((im) => !['rejected', 'replaced'].includes(im.status) && im.kind !== 'ai_generated');
  const defaultIds = (a.current && a.current.imageIds) || [];
  const picked = new Set(ui.ids || defaultIds);
  const wrap = h('div', { class: 'stack', style: 'gap:12px', 'data-product-analysis': p.id });

  const status = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
    a.approved ? chip(`승인됨 v${a.approved.v} · 이미지 세트 V${a.approved.imageSetVersion}`, a.stale ? 'attention' : 'done') : chip('승인된 설명 없음', 'attention'),
    a.stale ? chip('이미지가 바뀜 · 재분석 필요', 'attention') : null,
    chip(a.route.mock ? '분석 AI: 샘플(무료, 실제 분석 아님)' : `분석 AI: ${a.route.provider} · ${a.route.model || '모델 미선택'}`, a.route.mock ? 'mock' : ''));
  wrap.append(status);
  if (a.stale) wrap.append(h('div', { class: 'banner warn', 'data-analysis-stale': '' }, h('div', null, a.staleReason)));
  if (a.route.mock) wrap.append(h('div', { class: 'banner mock' }, h('div', null, h('b', null, '지금은 실제 이미지 분석을 하지 않습니다. '), 'Settings → AI 연동의 "제품 이해" 작업에 이미지를 읽을 수 있는 모델(예: Gemini)을 지정하면 제품 사진을 직접 분석합니다. 샘플 응답은 그대로 승인할 수 없습니다.')));

  // which photos are analysed
  wrap.append(h('div', { class: 'stack', style: 'gap:6px' },
    h('div', { class: 'small', style: 'font-weight:600' }, `분석에 쓸 제품 사진 (최대 ${a.limits.maxImages}장)`),
    live.length ? h('div', { class: 'ref-grid', style: 'grid-template-columns:repeat(auto-fill,minmax(96px,1fr))', 'data-analysis-images': '' }, live.map((im) => h('label', { class: 'ref', style: 'cursor:pointer' },
      h('img', { src: im.url, alt: im.label || '제품 이미지' }),
      h('figcaption', null, h('span', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', 'data-analysis-pick': im.id, checked: picked.has(im.id), onchange: (e) => { if (e.target.checked) { if (picked.size >= a.limits.maxImages) { e.target.checked = false; return toast(`분석에는 최대 ${a.limits.maxImages}장까지 쓸 수 있습니다`, { error: true }); } picked.add(im.id); } else picked.delete(im.id); ui.ids = [...picked]; } }), im.label || im.id))))) : h('div', { class: 'small muted' }, '분석할 제품 사진이 없습니다. 위 "참조 이미지"에서 사진을 올리거나 붙여넣으세요.')));

  const analyze = h('button', { class: 'btn clay', type: 'button', 'data-analysis-run': p.id, disabled: !live.length, onclick: async () => {
    ui.open = true;
    const ids = [...picked];
    let est;
    try { est = await api.post(`/api/products/${p.id}/analysis/estimate`, { imageIds: ids.length ? ids : undefined }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
    const c = await confirmPaid({ title: a.approved ? '제품 이미지를 다시 분석 (새 버전)' : '제품 이미지 AI 분석', est, confirmLabel: '분석하기',
      body: h('div', { class: 'stack small', style: 'gap:6px' }, h('div', null, `제품 사진 ${est.imageCount}장을 읽고 영어 구조 설명 초안(v${((a.latest && a.latest.v) || 0) + 1})을 만듭니다.`), h('div', { class: 'muted' }, '결과는 초안으로만 저장되며 승인하기 전에는 스토리보드 생성에 쓰이지 않습니다. 기존 승인본은 바뀌지 않습니다.')) });
    if (c === null) return;
    try { await api.post(`/api/products/${p.id}/analysis/generate`, { imageIds: ids.length ? ids : undefined, confirm: c }); ui.v = null; ui.text = null; toast('구조 설명 초안을 만들었습니다. 내용을 확인하고 틀린 부분을 고친 뒤 승인하세요.'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    await rerender();
  } }, a.versions.length ? '비용 확인 후 새로 분석하기' : '비용 확인 후 분석하기');
  wrap.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, analyze, h('span', { class: 'small muted' }, a.current ? `이미지 세트 ${a.current.imageSetVersion ? 'V' + a.current.imageSetVersion : '새 세트(V' + a.current.nextImageSetVersion + ')'} · 분석은 비용 확인 후에만 시작됩니다` : '')));

  if (!shown) { wrap.append(h('div', { class: 'empty small' }, '아직 구조 설명이 없습니다. 분석하면 영어 설명 초안이 만들어집니다. 직접 쓰고 싶다면 샘플 분석을 만든 뒤 고쳐 쓸 수 있습니다.')); return wrap; }

  // versions
  wrap.append(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', role: 'tablist', 'aria-label': '구조 설명 버전', 'data-analysis-versions': '' }, a.versions.map((v) => h('button', { type: 'button', role: 'tab', class: 'btn sm ' + (v.v === shown.v ? 'sage' : 'ghost'), 'data-analysis-version': v.v, 'aria-selected': v.v === shown.v ? 'true' : 'false', onclick: () => { ui.open = true; ui.v = v.v; ui.text = null; rerender(); } }, `v${v.v} · ${STATUS[v.status] ? STATUS[v.status][0] : v.status}${v.sample ? ' · 샘플' : ''}`))));

  const ta = h('textarea', { rows: 16, 'data-analysis-text': shown.v, 'aria-label': '영어 제품 구조 설명 (수정 가능)', style: 'font-family:var(--mono, ui-monospace, monospace);font-size:12.5px;line-height:1.5', oninput: (e) => { ui.text = e.target.value; dirty(); } }, text);
  const save = h('button', { class: 'btn sm', type: 'button', 'data-analysis-save': shown.v, disabled: true, onclick: async () => {
    ui.open = true;
    try { const r = await api.put(`/api/products/${p.id}/analysis/${shown.v}`, { text: ta.value }); ui.v = r.editedV; ui.text = null; toast(approvedHere || shown.status !== 'draft' ? `새 버전 v${r.editedV}으로 저장했습니다 (기존 버전은 그대로 보존됩니다)` : '수정 내용을 저장했습니다'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    await rerender();
  } }, approvedHere || shown.status !== 'draft' ? '수정본을 새 버전으로 저장' : '수정 저장');
  const dirty = () => { save.disabled = ta.value === shown.text; };
  const approve = h('button', { class: 'btn sage', type: 'button', 'data-analysis-approve': shown.v, disabled: approvedHere, onclick: async () => {
    ui.open = true;
    if (ta.value !== shown.text) return toast('먼저 수정 내용을 저장한 뒤 승인하세요.', { error: true });
    try { await api.post(`/api/products/${p.id}/analysis/${shown.v}/approve`); toast(`구조 설명 v${shown.v}을 승인했습니다. 이제 제품이 나오는 장면 이미지를 만들 때 제품 참조 이미지와 함께 자동으로 포함됩니다.`); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    await rerender();
  } }, approvedHere ? '승인됨' : `v${shown.v} 승인`);

  wrap.append(h('div', { class: 'stack', style: 'gap:8px' },
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, chip(...(STATUS[shown.status] || [shown.status, ''])), chip(`제품 ${shown.productId} · 이미지 세트 V${shown.imageSetVersion}`, 'mono'), shown.edited ? chip('직접 수정함', 'attention') : null, shown.basedOn ? chip(`v${shown.basedOn}을 고친 버전`, 'mock') : null,
      shown.ai ? h('span', { class: 'small muted' }, `${shown.ai.mock ? '샘플' : shown.ai.provider + ' / ' + shown.ai.model} · ${new Date(shown.createdAt).toLocaleString('ko-KR')}`) : null),
    shown.sample ? h('div', { class: 'banner warn', 'data-analysis-sample': '' }, h('div', null, '이 초안은 샘플입니다. 실제 제품 사진을 분석한 결과가 아니므로 샘플 문구를 지우고 직접 확인한 내용으로 고쳐 쓰기 전에는 승인할 수 없습니다.')) : null,
    !shown.intact ? h('div', { class: 'banner warn' }, h('div', null, `이 분석(v${shown.v})을 만든 뒤 제품 이미지가 바뀌었습니다. 새로 분석한 뒤 승인하세요.`)) : null,
    h('div', { class: 'small muted' }, '[VERIFIED] = 사진에서 분명히 보이는 것 · [UNCERTAIN] = 추정이거나 일부만 보이는 것(사실로 취급하지 않음). AI가 틀릴 수 있으니 제품 사진과 비교해 고쳐 주세요. 치수·소재·숨은 기능을 지어내지 마세요.'),
    ta,
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, save, approve),
    approvedHere ? h('div', { class: 'small', style: 'color:var(--sage-deep)' }, '이 승인본은 스토리보드 이미지(제품이 나오는 장면)를 만들 때 제품 참조 이미지와 함께 영어 프롬프트에 자동으로 들어갑니다. 이미 승인된 장면 이미지는 자동으로 다시 만들어지지 않습니다.') : null));
  return wrap;
}
