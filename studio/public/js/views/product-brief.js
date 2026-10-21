// Product Studio → "AI 분석 결과 보기": one popup to read the approved / latest structure description, correct it, approve it,
// or let the AI revise it from the operator's feedback ("AI 발전"). Edit and approve reuse /api/products/:id/analysis/:v; develop is paid
// and always goes through the cost confirmation. The approved version is never overwritten (edits and AI revisions become new drafts).
import { h, chip, toast, modal, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { confirmPaid } from './common.js';

const STATUS = { approved: ['승인됨', 'done'], draft: ['검토 대기 (초안)', 'attention'], superseded: ['이전 버전', 'mock'] };

/** onChanged() re-renders the product page after anything was saved. */
export async function openBriefModal(p, onChanged = () => {}) {
  let a;
  try { a = await api.get(`/api/products/${p.id}/analysis`); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  show(p, a, onChanged, null);
}

function show(p, a, onChanged, wantV) {
  const shown = a.versions.find((v) => v.v === wantV) || a.approved || a.latest;
  if (!shown) return toast('생성된 AI 분석 결과가 없습니다. 먼저 제품 이미지를 분석하세요.', { error: true });
  const reopen = async (v) => { const fresh = await api.get(`/api/products/${p.id}/analysis`); show(p, fresh, onChanged, v); onChanged(); };
  modal((close) => {
    const ta = h('textarea', { class: 'brief-editor', rows: 16, 'data-brief-text': shown.v, 'aria-label': '제품 분석 결과 (수정 가능)' });
    ta.value = shown.text;
    const fb = h('textarea', { rows: 2, maxlength: 1000, placeholder: '예: 유머 소재를 일상 갈등 중심으로 바꿔줘 (확인된 사실은 바뀌지 않습니다)', 'aria-label': 'AI 발전 요청', 'data-brief-feedback': '' });
    const dirty = () => ta.value !== shown.text;
    const save = h('button', { class: 'btn sm', type: 'button', 'data-brief-save': '', onclick: async () => {
      if (!dirty()) return toast('바뀐 내용이 없습니다.');
      try { const r = await api.put(`/api/products/${p.id}/analysis/${shown.v}`, { text: ta.value }); close(); toast(shown.status === 'draft' ? '수정을 저장했습니다.' : `새 버전 v${r.editedV}로 저장했습니다 (기존 버전은 그대로).`); await reopen(r.editedV); }
      catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    } }, '직접 수정 저장');
    const approve = h('button', { class: 'btn sage', type: 'button', 'data-brief-approve': shown.v, disabled: shown.status === 'approved', onclick: async () => {
      if (dirty()) return toast('먼저 수정 내용을 저장한 뒤 승인하세요.', { error: true });
      try { await api.post(`/api/products/${p.id}/analysis/${shown.v}/approve`); close(); toast(`v${shown.v}을 승인했습니다. 스토리 랩과 장면 이미지에 사용됩니다.`); await reopen(shown.v); }
      catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    } }, shown.status === 'approved' ? '승인됨' : `v${shown.v} 최종 승인`);
    const revoke = shown.status === 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-brief-revoke': shown.v, title: '승인만 취소합니다 (설명 내용은 초안으로 남습니다)', onclick: async () => {
      if (!(await confirmDialog({ title: `v${shown.v} 승인을 취소할까요?`, body: '설명 내용은 지워지지 않고 초안으로 돌아갑니다. 새 이미지 요청에는 더 이상 자동으로 들어가지 않습니다.', confirm: '승인 취소', tone: 'clay' }))) return;
      try { await api.post(`/api/products/${p.id}/analysis/${shown.v}/revoke`); close(); toast(`v${shown.v} 승인을 취소했습니다.`); await reopen(shown.v); }
      catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    } }, '승인 취소') : null;
    const develop = h('button', { class: 'btn clay', type: 'button', 'data-brief-develop': '', onclick: async (e) => {
      const feedback = fb.value.trim();
      if (!feedback) return toast('AI에게 요청할 수정 내용을 입력하세요.', { error: true });
      if (dirty()) return toast('직접 수정한 내용이 있습니다. 먼저 저장하거나 되돌린 뒤 요청하세요.', { error: true });
      const btn = e.currentTarget;
      let est;
      try { est = await api.post(`/api/products/${p.id}/analysis/${shown.v}/develop/estimate`, { feedback }); } catch (err) { return toast(err.message, { error: true, recovery: err.recovery }); }
      const c = await confirmPaid({ title: 'AI로 분석 결과 발전', est, confirmLabel: '반영하기',
        body: h('div', { class: 'small', style: 'display:grid;gap:6px' }, h('div', null, `v${shown.v}을 바탕으로 새 초안 v${est.nextV}을 만듭니다. 확인된 사실 줄이 바뀌면 저장하지 않습니다.`), h('div', { class: 'muted' }, '요청: ' + feedback)) });
      if (c === null) return;
      btn.disabled = true; btn.textContent = 'AI 반영 중…';
      try { const r = await api.post(`/api/products/${p.id}/analysis/${shown.v}/develop`, { feedback, confirm: c }); close(); toast(`새 초안 v${r.developedV}을 만들었습니다. 검토 후 승인하세요.`); await reopen(r.developedV); }
      catch (err) { btn.disabled = false; btn.textContent = 'AI 반영하기'; toast(err.message, { error: true, recovery: err.recovery }); }
    } }, 'AI 반영하기');
    return h('div', { class: 'stack brief-modal', 'data-brief-modal': p.id },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, '제품 분석 결과'), h('button', { class: 'btn sm ghost', type: 'button', onclick: close }, '닫기')),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        chip(...(STATUS[shown.status] || [shown.status, ''])),
        a.stale && shown.status === 'approved' ? chip('이미지가 바뀜 · 재분석 권장', 'attention') : null,
        shown.sample ? chip('샘플 · 실제 분석 아님', 'mock') : null,
        a.versions.length > 1 ? h('span', { class: 'row', style: 'gap:4px' }, a.versions.map((v) => h('button', { type: 'button', class: 'btn sm ' + (v.v === shown.v ? '' : 'ghost'), onclick: () => { close(); show(p, a, onChanged, v.v); } }, 'v' + v.v))) : null),
      ta,
      h('div', { class: 'row end', style: 'gap:8px' }, save, approve, revoke),
      h('div', { class: 'develop-box stack', style: 'gap:8px' }, h('b', { class: 'small' }, 'AI 발전 — 확인된 사실은 그대로 두고 표현·아이디어만 고칩니다 (유료, 비용 확인 후 실행)'), fb, h('div', { class: 'row end' }, develop)));
  }, { wide: true });
}
