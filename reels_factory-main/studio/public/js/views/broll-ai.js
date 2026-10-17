// B-roll "AI 이미지 생성": editable prompt, the real reference images that will be attached, cost estimate, then an explicit paid call.
// Generated images are saved as "검토 대기" — never approved automatically. Nothing is generated when B-rolls are suggested.
import { h, chip, modal, toast, fmtUsd } from '../ui.js';
import { act } from '../state.js';
import { refLimitDialog } from './common.js';
import { api } from '../api.js';

export function previewBroll(b) {
  const info = b.imageInfo;
  modal((close) => {
    let zoom = false;
    const img = h('img', { src: b.imageUrl, alt: b.id + ' 큰 미리보기', 'data-broll-full': b.id, style: 'max-width:100%;max-height:72vh;border-radius:12px;cursor:zoom-in' });
    const box = h('div', { style: 'max-width:100%;max-height:74vh;overflow:auto;text-align:center' }, img);
    img.onclick = () => { zoom = !zoom; img.style.maxWidth = zoom ? 'none' : '100%'; img.style.maxHeight = zoom ? 'none' : '72vh'; img.style.cursor = zoom ? 'zoom-out' : 'zoom-in'; };
    img.onerror = () => { box.replaceChildren(h('div', { class: 'issue err' }, '이미지를 불러오지 못했습니다 (접근 불가). 이미지를 다시 저장하세요.')); };
    return h('div', { class: 'stack', style: 'gap:10px;align-items:center' },
      h('h2', { style: 'margin:0' }, `${b.id}${b.assetId ? ' · ' + b.assetId : ''}`),
      box,
      h('div', { class: 'small muted' }, `${info && info.width ? info.width + '×' + info.height + 'px · ' : ''}${b.imageGenerated ? 'AI 생성' : '업로드'} · ${b.status === 'approved' ? '승인됨' : '검토 대기'} · 이미지를 누르면 원본 크기로 확대/축소`),
      h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기'));
  }, { wide: true });
}

export async function openBrollAi(ep, b) {
  let plan;
  try { plan = await api.get(`/api/episodes/${ep.id}/broll/${b.id}/image/plan`); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
  const st = { prompt: plan.prompt, chars: plan.options.selectedCharacters.slice(), product: plan.options.product, overwrite: false, exclude: [] };
  const replan = async () => api.get(`/api/episodes/${ep.id}/broll/${b.id}/image/plan?exclude=${encodeURIComponent(st.exclude.join(','))}`);
  modal((close) => {
    const status = h('div', { class: 'small', 'data-broll-ai-status': '' });
    const body = h('div', { class: 'stack', style: 'gap:10px' });
    const draw = (p) => {
      plan = p;
      const blocked = !p.scriptApproved || p.warnings.length > 0;
      const go = h('button', { class: 'btn clay', type: 'button', 'data-broll-ai-go': b.id, disabled: blocked, onclick: run }, p.hasImage ? '재생성' : '생성');
      body.replaceChildren(
        h('div', { class: 'small muted' }, `${b.kindLabel || b.kind} · ${b.insertAtSec}s에 ${b.durationSec}초. 이미지 한 장만 만듭니다 (영상은 만들지 않습니다). 결과는 "검토 대기"로 저장됩니다.`),
        !p.scriptApproved ? h('div', { class: 'issue err' }, '대본이 승인되어야 만들 수 있습니다 (유료 생성).') : null,
        ...p.warnings.map((w) => h('div', { class: 'issue err', 'data-broll-ai-warning': '' }, w)),
        p.limit ? h('button', { class: 'btn sm clay', type: 'button', 'data-broll-ai-limit': '', onclick: async () => { const r = await refLimitDialog(p.limit, st.exclude); if (r) { st.exclude = r; draw(await replan()); } } }, '참조 이미지 선택 해제 (이 요청만)…') : null,
        st.exclude.length ? h('div', { class: 'small muted' }, `이번 요청에서 제외: ${st.exclude.length}장 (라이브러리 선택은 그대로)`) : null,
        h('div', { class: 'field' }, h('label', null, '이미지 프롬프트 (수정 가능)'), h('textarea', { rows: 8, 'data-broll-ai-prompt': '', value: st.prompt, oninput: (e) => (st.prompt = e.target.value) }),
          h('div', { class: 'small muted' }, '참조 이미지 첨부 규칙(캐릭터·제품 그대로 유지, 글자 금지)은 자동으로 추가되며 지울 수 없습니다.')),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { draw(await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product })); toast('프롬프트·참조 선택을 저장했습니다 (이미지는 바뀌지 않음)'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '프롬프트 저장'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { const r = await api.del(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`); st.prompt = r.prompt; draw(r); } catch (e) { toast(e.message, { error: true }); } } }, '초안으로 되돌리기')),
        h('div', { class: 'small', style: 'font-weight:600' }, '첨부되는 참조 이미지'),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          p.options.characters.map((cid) => h('label', { class: 'chk-btn' }, h('input', { type: 'checkbox', checked: st.chars.includes(cid), onchange: async (e) => { st.chars = e.target.checked ? st.chars.concat(cid) : st.chars.filter((x) => x !== cid); draw(await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product })); } }), cid)),
          p.options.productAvailable ? h('label', { class: 'chk-btn' }, h('input', { type: 'checkbox', checked: st.product, onchange: async (e) => { st.product = e.target.checked; draw(await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product })); } }), '제품') : null),
        h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap', 'data-broll-ai-refs': '' }, p.refs.length ? p.refs.map((r) => h('div', { class: 'card flat stack', style: 'gap:4px;width:120px' },
          r.url && r.status === 'approved' ? h('img', { src: r.url, alt: r.name, style: 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px' }) : h('div', { class: 'sb-main-img empty', style: 'aspect-ratio:1' }, h('small', null, '없음')),
          h('div', { class: 'small' }, r.name), h('div', { class: 'small mono muted' }, r.assetId || '—'), chip(r.status === 'approved' ? '승인됨' : '필요', r.status === 'approved' ? 'done' : 'err'))) : [h('div', { class: 'small muted' }, '이 B-roll에는 참조 이미지를 붙이지 않습니다.')]),
        h('div', { class: 'card flat' }, h('div', { class: 'row between' }, h('span', { class: 'muted' }, '제공자 / 모델'), h('b', { class: 'mono' }, `${p.route.provider} / ${p.route.model || '(모델 미선택)'}`)),
          h('div', { class: 'row between' }, h('span', { class: 'muted' }, '예상 비용 (추정)'), h('b', null, p.estimate ? (p.estimate.usd == null ? '알 수 없음' : fmtUsd(p.estimate.usd)) : '—'))),
        p.approved ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', 'data-broll-ai-overwrite': '', onchange: (e) => { st.overwrite = e.target.checked; } }), '승인된 이미지를 교체합니다 (새 이미지가 생기면 승인이 취소되며, 이전 파일은 보관됩니다)') : null,
        p.estimate && p.estimate.usd == null ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', 'data-broll-ai-unknown': '', onchange: (e) => { st.unknown = e.target.checked; } }), '가격을 모르는 상태로 진행합니다') : null,
        h('div', { class: 'small muted' }, '실패해도 자동으로 다시 시도하지 않습니다. 버튼을 누를 때만 유료 호출이 한 번 일어납니다.'),
        status,
        h('div', { class: 'row end', style: 'gap:8px' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기'), go));
    };
    async function run() {
      if (plan.estimate && plan.estimate.usd == null && !st.unknown) return toast('가격을 모르는 상태로 진행하려면 체크하세요', { error: true });
      if (plan.approved && !st.overwrite) return toast('승인된 이미지를 교체하려면 체크하세요', { error: true });
      body.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        status.textContent = '1/3 프롬프트 저장 중…';
        await api.put(`/api/episodes/${ep.id}/broll/${b.id}/image/prompt`, { prompt: st.prompt, refCharacters: st.chars, refProduct: st.product });
        status.textContent = '2/3 이미지 생성 중… (이미지 모델 호출 1회, 수십 초 걸릴 수 있습니다)';
        const v = await api.post(`/api/episodes/${ep.id}/broll/${b.id}/image/generate`, { confirm: { paid: true, unknownCost: !!st.unknown }, force: plan.hasImage, overwriteApproved: plan.approved && st.overwrite, exclude: st.exclude });
        status.textContent = '3/3 저장된 이미지 확인 중…';
        const made = ((v.scenes || []).flatMap((x) => x.broll || [])).find((x) => x.id === b.id);
        if (!made || made.imageState !== 'ready') throw Object.assign(new Error(made && made.imageProblem ? made.imageProblem : '저장된 이미지를 확인하지 못했습니다.'), { recovery: '자동으로 다시 생성하지 않습니다. 확인 후 직접 다시 시도하세요.' });
        showResult(made);
        await act(async () => null);
        return;
      } catch (e) {
        status.textContent = '실패: ' + e.message + (e.recovery ? ' — ' + e.recovery : '');
        toast(e.message, { error: true, recovery: e.recovery });
        try { draw(await api.get(`/api/episodes/${ep.id}/broll/${b.id}/image/plan`)); status.textContent = '실패: ' + e.message; } catch (_) { /* keep */ }
      }
      await act(async () => null);
    }
    function showResult(made) {
      body.replaceChildren(
        h('div', { class: 'small', style: 'color:var(--sage-deep)' }, '이미지를 만들어 저장했고 접근 가능함을 확인했습니다. 자동으로 승인되지 않았습니다 — 확인 후 승인하거나 다시 생성하세요.'),
        h('img', { src: made.imageUrl, alt: made.id + ' 생성 결과', 'data-broll-ai-result': made.id, style: 'max-width:100%;max-height:60vh;border-radius:12px;display:block;margin:0 auto' }),
        h('div', { class: 'small muted', style: 'text-align:center' }, `${made.imageInfo && made.imageInfo.width ? made.imageInfo.width + '×' + made.imageInfo.height + 'px · ' : ''}${made.assetId}`),
        h('div', { class: 'row end', style: 'gap:8px' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기 (나중에 검토)'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); openBrollAi(ep, made); } }, '다시 생성'),
          h('button', { class: 'btn sage', type: 'button', 'data-broll-ai-approve': made.id, onclick: async () => { try { await api.post(`/api/episodes/${ep.id}/broll/${made.id}/status`, { status: 'approved' }); close(); toast('승인했습니다'); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } await act(async () => null); } }, '승인')));
    }
    draw(plan);
    return h('div', { class: 'stack' }, h('h2', { style: 'margin:0' }, `${b.id} · AI 이미지 생성`), body);
  }, { wide: true });
}
