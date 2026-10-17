// Episode workspace navigation: the selected episode's work stages in one compact line — Script → Image → Video Production → Final Review → Publishing.
// Script Studio, Final Review and Publishing are no longer sidebar items; they live here, inside the episode they belong to.
import { h } from '../ui.js';
import { state } from '../state.js';

const STAGES = [
  ['script', '대본', 'Script', ['script', 'approval']],
  ['image', '이미지', 'Image', ['storyboard']],
  ['video', '영상 제작', 'Video Production', ['animation', 'clips', 'voice', 'render']],
  ['review', '최종 검토', 'Final Review', ['review']],
  ['publishing', '게시', 'Publishing', ['publish']],
];
const STAGE_OF = { script: 'script', image: 'image', animation: 'video', voice: 'video', lipsync: 'video', render: 'video', review: 'review', publishing: 'publishing' };

export function episodeFlow(view, ep) {
  const cur = STAGE_OF[view];
  const steps = (ep.derived && ep.derived.steps) || [];
  const done = (keys) => keys.every((k) => { const st = steps.find((x) => x.key === k); return !st || st.state === 'done'; }) && keys.some((k) => steps.some((x) => x.key === k));
  const href = (k) => '#/' + (k === 'video' ? 'video' : k) + '/' + ep.id;
  return h('nav', { class: 'sub-nav ep-flow', 'data-no-en': '', 'aria-label': '에피소드 작업 단계', 'data-episode-flow': ep.id },
    STAGES.map(([k, ko, en, keys]) => h('a', { href: href(k), 'data-flow': k, 'aria-current': cur === k ? 'page' : null, title: en, onclick: () => { state.episodeId = ep.id; } }, (done(keys) ? '✓ ' : '') + ko)));
}
