// Review: the gates that must all be green before publishing, the latest render, and the final approval.
import { h, chip, icon, confirmDialog, fmtUsd } from '../ui.js';
import { act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { pageHead, pipelineBar, noEpisode, episodePicker } from './common.js';

export function review() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const d = ep.derived;
  const step = (k) => d.steps.find((s) => s.key === k);
  const renders = ep.renders.slice().sort((a, b) => b.v - a.v);
  const finals = renders.filter((x) => !x.preview);
  const lastFinal = finals[0];
  const shown = renders.find((x) => x.current) || renders[0];
  const approved = !!ep.approvals.final;
  const gates = [['concept', '스토리 컨셉 승인'], ['approval', '대본 승인'], ['storyboard', '스토리보드 승인'], ['clips', '클립 승인'], ['voice', '음성'], ['render', '최종 렌더 (최신 상태)']];
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Review', '최종 검토', '모든 승인 단계와 렌더 상태를 확인하고, 영상을 끝까지 본 뒤 최종 승인합니다. 승인은 영상 파일의 체크섬에 묶입니다.', episodePicker()));
  wrap.append(pipelineBar(ep));
  const left = h('div', { class: 'stack', style: 'gap:16px' });
  left.append(h('div', { class: 'card' }, h('h2', null, '승인 체크'), h('div', { class: 'list' }, gates.map(([k, l]) => { const s = step(k); return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l), h('div', { class: 'small muted' }, s.detail || '')), chip(s.state === 'done' ? '완료' : s.state === 'blocked' ? '잠김' : '확인 필요', s.state === 'done' ? 'done' : 'attention')); }))));
  left.append(h('div', { class: 'card' }, h('h2', null, '비용 요약'), h('div', { class: 'small' }, `이 에피소드 영상 지출 ${fmtUsd(d.spentUsd)} (목업 ${d.mockSpendCount}건 포함, 실제 청구서가 아닌 추정/보고값)`)));
  const right = h('div', { class: 'stack', style: 'gap:14px;align-items:center' });
  right.append(h('div', { style: 'width:min(100%,320px)' }, h('div', { class: 'phone' }, shown ? h('video', { src: shown.url, controls: true, playsinline: true, preload: 'metadata' }) : h('div', { class: 'ph' }, '렌더 후 여기에서 검토합니다'))));
  right.append(h('div', { class: 'card', style: 'width:100%' }, h('h3', null, '최종 승인'),
    approved ? h('p', { class: 'small' }, chip('v' + ep.approvals.final.v + ' 승인됨', 'done'), ' 파일이 바뀌면 승인이 무효가 됩니다.') : h('p', { class: 'small muted' }, lastFinal ? '최종 렌더 v' + lastFinal.v + '를 끝까지 본 뒤 승인하세요.' : '먼저 비디오 스튜디오에서 최종 렌더를 만드세요.'),
    h('div', { class: 'row' },
      approved ? h('button', { class: 'btn ghost', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/final/revoke`), { ok: '최종 승인을 취소했습니다' }) }, '승인 취소')
        : h('button', { class: 'btn sage', disabled: !lastFinal, onclick: async () => { if (await confirmDialog({ title: `v${lastFinal.v}를 최종 승인할까요?`, body: '승인 후에는 게시용 캡션·ManyChat 문구 단계로 넘어갑니다. 게시 자체는 항상 사람이 합니다.' })) act(() => api.post(`/api/episodes/${ep.id}/renders/${lastFinal.v}/approve`), { ok: '최종 영상을 승인했습니다' }); } }, icon('check'), lastFinal ? `v${lastFinal.v} 최종 승인` : '최종 승인'),
      h('a', { class: 'btn ghost', href: '#/render/' + ep.id }, '렌더로'),
      approved ? h('a', { class: 'btn', href: '#/publishing/' + ep.id }, '게시 정보로') : null)));
  wrap.append(h('div', { class: 'split' }, left, right));
  return wrap;
}
