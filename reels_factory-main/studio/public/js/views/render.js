import { h, chip, icon, confirmDialog, fmtSec, toast } from '../ui.js';
import { act, requireEpisode } from '../state.js';
import { api } from '../api.js';
import { readinessCard } from './render-readiness.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, issueList, lockedNotice, videoTabs } from './common.js';
import { timelineBar } from './voice.js';
import { hooks } from '../state.js';
import { VIDEO_TABS, videoTab, setVideoTab, reviewTab, timelineTab, subtitlesTab, soundTab, checklistCard } from './video-studio.js';

function fileButton(label, accept, onFile) {
  const input = h('input', { type: 'file', accept, style: 'display:none', onchange: (e) => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; } });
  return h('span', null, input, h('button', { class: 'btn sm ghost', onclick: () => input.click() }, icon('upload'), label));
}

export function render() {
  const ep = requireEpisode();
  if (!ep) return noEpisode();
  const plan = ep.derived.render.plan;
  const running = ep.derived.render.running;
  const job = ep.derived.render.job;
  const renders = ep.renders.slice().sort((a, b) => b.v - a.v);
  const finals = renders.filter((r) => !r.preview);
  const shown = renders.find((r) => r.current) || renders[0];
  const wrap = h('div', { class: 'stack', style: 'gap:20px' });
  wrap.append(pageHead('Video Studio', '비디오 스튜디오', '장면 검토 → 타임라인 → 자막 → 사운드 → 최종 렌더. 승인된 클립과 음성으로 9:16 영상을 만듭니다. 렌더는 항상 새 버전으로 저장되어 이전 영상을 덮어쓰지 않습니다.', episodePicker()));
  wrap.append(videoTabs('render'));
  wrap.append(pipelineBar(ep));
  wrap.append(readinessCard(ep));
  if (!plan.canRender) wrap.append(lockedNotice('렌더하려면 아래 항목을 먼저 해결해야 합니다.'));
  const tab = videoTab(ep);
  wrap.append(h('div', { class: 'seg', role: 'tablist', 'aria-label': '비디오 스튜디오 단계', 'data-vs-tabs': '', style: 'align-self:flex-start;flex-wrap:wrap' }, VIDEO_TABS.map(([k, l], i) => h('button', { role: 'tab', type: 'button', 'data-vs-tab': k, 'aria-pressed': String(tab === k), onclick: () => setVideoTab(ep, k, hooks.rerender) }, `${i + 1}. ${l}`))));
  if (tab === 'review') { wrap.append(reviewTab(ep)); return wrap; }
  if (tab === 'timeline') { wrap.append(timelineTab(ep, hooks.rerender)); return wrap; }
  if (tab === 'subtitles') { wrap.append(subtitlesTab(ep, hooks.rerender)); return wrap; }
  if (tab === 'sound') { wrap.append(soundTab(ep, hooks.rerender)); return wrap; }
  wrap.append(checklistCard(ep));

  const start = (preview) => async () => {
    if (!preview) {
      const ok = await confirmDialog({ title: '최종 렌더(1080×1920)를 시작할까요?', body: '로컬에서 FFmpeg로 영상을 만듭니다(요금 없음). 약 30초~수 분이 걸릴 수 있습니다.', confirm: '렌더 시작' });
      if (!ok) return;
    }
    await act(() => api.post(`/api/episodes/${ep.id}/render`, { preview }), { ok: preview ? '미리보기 렌더를 시작했습니다' : '최종 렌더를 시작했습니다' });
  };

  const left = h('div', { class: 'stack', style: 'gap:16px' });
  left.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, '타임라인'), h('span', { class: 'small muted' }, `총 ${fmtSec(plan.timeline.total)} · ${plan.timeline.scenes.length}개 장면 + CTA`)),
    plan.timeline.lines.length ? timelineBar(plan.timeline) : h('p', { class: 'muted' }, '음성을 만들면 타임라인이 표시됩니다.'),
    plan.timeline.warnings.length ? h('div', { style: 'margin-top:10px' }, issueList(plan.timeline.warnings, 'warn')) : null));
  left.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, '렌더 실행'), running ? chip('렌더 중…', 'processing') : null),
    plan.problems.length ? issueList(plan.problems, 'err') : h('p', { class: 'muted', style: 'margin:0 0 10px' }, '모든 조건이 충족되었습니다. 승인된 클립의 체크섬이 렌더 직전에 다시 검증됩니다.'),
    job && job.status === 'failed' ? h('div', { style: 'margin-top:10px' }, issueList([{ message: job.error.message, recovery: job.error.recovery }], 'err')) : null,
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn ghost', disabled: !plan.canRender || running, onclick: start(true) }, icon('play'), '미리보기 (540×960)'),
      h('button', { class: 'btn sage', disabled: !plan.canRender || running, onclick: start(false) }, icon('render'), '최종 렌더 (1080×1920)'))));

  left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '렌더 버전')),
    renders.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['버전', '종류', '체크섬', '상태', ''].map((x) => h('th', null, x)))), h('tbody', null, renders.map((r) => h('tr', null,
      h('td', null, 'v' + r.v),
      h('td', null, chip(r.preview ? '미리보기' : '최종', r.preview ? 'mock' : 'done')),
      h('td', { class: 'mono small' }, (r.sha256 || '').slice(0, 10)),
      h('td', null, r.current ? chip('승인됨', 'done') : r.stale ? chip('이전 상태', 'attention') : r.outdatedEdit ? chip('자막·믹스 변경됨 — 다시 렌더', 'attention') : '—'),
      h('td', null, h('div', { class: 'row end', style: 'gap:6px' },
        h('a', { class: 'btn sm ghost', href: r.url, target: '_blank', rel: 'noopener' }, '보기'),
        h('a', { class: 'btn sm ghost', href: r.url + '?download=1' }, icon('download'), '다운로드'))))))))
      : h('p', { class: 'muted', style: 'margin:0' }, '아직 렌더가 없습니다.')));

  const right = h('div', { class: 'stack', style: 'gap:14px;align-items:center' });
  right.append(h('div', { style: 'width:min(100%,300px)' }, h('div', { class: 'phone' }, shown ? h('video', { src: shown.url, controls: true, playsinline: true, preload: 'metadata', key: shown.sha256 }) : h('div', { class: 'ph' }, '렌더 후 여기에 9:16 미리보기가 표시됩니다'))));
  if (shown) right.append(h('div', { class: 'small muted' }, `v${shown.v} · ${shown.preview ? '미리보기' : '최종'}`));
  const lastFinal = finals[0];
  const approved = !!ep.approvals.final;
  right.append(h('div', { class: 'card', style: 'width:100%' },
    h('h3', null, '최종 승인'),
    approved ? h('p', { class: 'small' }, chip('v' + ep.approvals.final.v + ' 승인됨', 'done'), ' 영상 체크섬에 묶여 있어 파일이 바뀌면 승인이 무효가 됩니다.')
      : h('p', { class: 'small muted' }, lastFinal ? '최종 렌더(v' + lastFinal.v + ')를 끝까지 본 뒤 승인하세요.' : '최종 렌더가 있어야 승인할 수 있습니다.'),
    h('div', { class: 'row' },
      approved ? h('button', { class: 'btn ghost', onclick: () => act(() => api.post(`/api/episodes/${ep.id}/final/revoke`), { ok: '최종 승인을 취소했습니다' }) }, '승인 취소')
        : h('button', { class: 'btn sage', disabled: !lastFinal || running, onclick: () => act(() => api.post(`/api/episodes/${ep.id}/renders/${lastFinal.v}/approve`), { ok: '최종 영상을 승인했습니다' }) }, icon('check'), lastFinal ? `v${lastFinal.v} 최종 승인` : '최종 승인'))));
  wrap.append(h('div', { class: 'split' }, left, right));
  return wrap;
}
