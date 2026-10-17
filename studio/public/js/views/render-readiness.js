// Rendering Readiness card. Two separate stages (generate video / final render); unfinished workflow steps are shown neutrally
// ("다음 단계") and only real validation failures are red ("확인 필요"). Identical pending steps are grouped by scene range.
import { h, chip } from '../ui.js';
import { go } from '../state.js';
import { goToScenePanel } from './scene-nav.js';

const STAGE_KIND = { ready: 'done', done: 'done', pending: '', waiting: '', blocked: 'err' };
const ranges = (ids) => ids.join(', ');
const jump = (ep, a) => {
  if ((a.view === 'storyboard' || a.view === 'image')) goToScenePanel(ep, a.sceneId, a.panel);
  else if (a.view === 'animation' && a.sceneId) goToScenePanel(ep, a.sceneId, 'clips'); // opens that scene in Animation Studio
  else go(a.view, ep.id); // voice / lipsync / settings / script …
};
// the whole notice is clickable (keyboard too), not only its button
const clickable = (ep, a, attrs, ...kids) => h('div', Object.assign({}, attrs, a ? { role: 'button', tabindex: '0', style: (attrs.style || '') + ';cursor:pointer', title: (a.label || '이동') + ' — 클릭하면 해당 부분으로 이동합니다', onclick: (e) => { if (e.target.closest('button')) return; jump(ep, a); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(ep, a); } } } : {}), ...kids);
const goBtn = (ep, a, code, sceneId) => (a ? h('button', { class: 'btn sm ghost', type: 'button', 'data-ready-go': code, 'data-ready-scene': sceneId || '', onclick: () => jump(ep, a) }, a.label || '이동') : null);

function groupBy(items) {
  const m = new Map();
  items.forEach((i) => { const k = i.code + '|' + i.message.replace(/^[A-Z]+\d+:\s*/, ''); const g = m.get(k) || { code: i.code, text: i.message.replace(/^[A-Z]+\d+:\s*/, ''), recovery: i.recovery, scenes: [], stage: i.stage, action: i.action }; if (i.sceneId) g.scenes.push(i.sceneId); m.set(k, g); });
  return [...m.values()];
}

export function readinessCard(ep) {
  const r = ep.derived && ep.derived.renderReadiness;
  if (!r) return h('div');
  const blocks = r.items.filter((i) => i.severity === 'block');
  const pend = r.items.filter((i) => i.severity === 'pending');
  const warns = r.items.filter((i) => i.severity === 'warn');
  const info = r.items.filter((i) => i.severity === 'info');
  const st = r.stages;
  const stageBox = (key, title, s, extra) => h('div', { class: 'card flat stack', style: 'gap:4px;min-width:150px;flex:1', 'data-stage': key, 'data-stage-status': s.status }, h('div', { class: 'small muted' }, title), chip(s.label, STAGE_KIND[s.status] || ''), extra || null);
  return h('section', { class: 'card stack', style: 'gap:12px', 'data-render-readiness': '' },
    h('div', { class: 'card-head' }, h('h2', null, '렌더링 준비 상태'), h('span', { class: 'small muted' }, '영상 생성과 최종 렌더는 따로 확인합니다 — 클립이 아직 없는 것은 오류가 아니라 다음 단계입니다.')),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:stretch' },
      stageBox('generate', '① 영상 생성 준비', st.generate),
      stageBox('clipGeneration', '② 영상 생성', st.clipGeneration),
      stageBox('clipApproval', '③ 클립 승인', st.clipApproval),
      stageBox('render', '④ 최종 렌더', st.render)),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, r.categories.map((c) => h('span', { class: 'asset-chip ' + (c.blocking ? 'need' : c.pending ? 'pend' : 'ok'), 'data-ready-cat': c.key }, h('b', null, c.label + ': '), c.blocking ? `${c.blocking}개 문제` : c.pending ? '진행 중' : '확인됨'))),
    blocks.length ? h('div', { class: 'stack', style: 'gap:6px', 'data-ready-blocks': '' }, h('b', { class: 'small', style: 'color:#8a4e2c' }, '확인 필요 (실제 문제)'), blocks.slice(0, 40).map((i) => clickable(ep, i.action, { class: 'issue err', 'data-ready-block': i.code, 'data-ready-scene': i.sceneId || '' }, h('b', null, i.message), i.recovery ? h('div', { class: 'small' }, '→ ' + i.recovery) : null, i.stage === 'render' ? h('div', { class: 'small muted' }, '최종 렌더 단계') : null, goBtn(ep, i.action, i.code, i.sceneId)))) : h('div', { class: 'small', style: 'color:var(--sage-deep)' }, '실제 문제는 없습니다.'),
    pend.length ? h('div', { class: 'stack', style: 'gap:6px', 'data-ready-pending': '' }, h('b', { class: 'small muted' }, '다음 단계 (정상 진행 중)'), groupBy(pend).map((g) => clickable(ep, g.action && Object.assign({}, g.action, { sceneId: g.scenes[0] || g.action.sceneId }), { class: 'pending-note', 'data-ready-pend': g.code }, h('span', null, g.text), g.scenes.length ? h('span', { class: 'small muted' }, ` · ${ranges(g.scenes)}`) : null, g.recovery ? h('div', { class: 'small muted' }, '→ ' + g.recovery) : null, h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:4px' }, g.scenes.length ? g.scenes.map((sid) => goBtn(ep, Object.assign({}, g.action, { sceneId: sid }), g.code, sid) && h('button', { class: 'btn sm ghost', type: 'button', 'data-ready-go': g.code, 'data-ready-scene': sid, onclick: () => jump(ep, Object.assign({}, g.action, { sceneId: sid })) }, sid + ' 이동')) : [goBtn(ep, g.action, g.code, '')])))) : null,
    ep.derived.storyboardApproval && ep.derived.storyboardApproval.reasons.length && ep.derived.storyboardApproval.everApproved ? h('div', { class: 'stack', style: 'gap:4px' }, h('b', { class: 'small' }, '스토리보드 승인이 필요한 이유'), ep.derived.storyboardApproval.reasons.map((x) => h('div', { class: 'small' }, x))) : null,
    warns.length ? h('div', { class: 'stack', style: 'gap:4px' }, warns.slice(0, 20).map((i) => h('div', { class: 'issue warn' }, i.message))) : null,
    info.length ? h('div', { class: 'small muted' }, info.map((i) => i.message).join(' ')) : null);
}
