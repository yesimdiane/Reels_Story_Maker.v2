// Shared scene-approval overview across the episode's Script, Image, Animation, Voice, Lip Sync and Editing studios.
// Keeps the six-beat Script Studio / fixed Part B layout untouched. This is navigation + guarded approvals only.
import { h, chip, confirmDialog, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { goToScenePanel } from './scene-nav.js';

const SCRIPT_VIEW = 'script';
function status(view, ep, sc) {
  const f = ep.sceneFlow && ep.sceneFlow.scenes && ep.sceneFlow.scenes[sc.id];
  const ap = sc.approval || {};
  const image = sc.startImageInfo || {};
  const clip = sc.clips || {};
  const ls = ep.lipsync && ep.lipsync.scenes && ep.lipsync.scenes[sc.id];
  const skipped = ep.lipsyncSkipped && ep.lipsyncSkipped[sc.id];
  if (view === SCRIPT_VIEW) return { approved: !!ap.approved, ready: ap.status === 'ready' && !ap.editedAfterApproval && !ap.errorCount, url: 'script', panel: '', action: 'script' };
  if (view === 'image') return { approved: !!image.approved && !image.error, ready: !!image.url && !image.approved && !image.error, url: 'image', panel: '', action: 'image' };
  if (view === 'animation') return { approved: !!clip.approvedVersion, ready: !!(clip.versions || []).some((v) => v.status === 'pending_review'), url: 'animation', panel: 'clips', action: 'clip' };
  if (view === 'voice') return { approved: !!f && ['approved', 'silent'].includes(f.audio.state), ready: !!f && f.audio.state === 'unapproved', url: 'voice', panel: 'audio', action: 'audio' };
  if (view === 'lipsync') return { approved: !ls || !ls.dialogue || !!skipped || ls.state === 'approved', ready: false, url: 'lipsync', panel: 'lipsync', action: null };
  return { approved: !!f && f.final.state === 'approved', ready: !!f && f.final.state === 'built' && !!f.final.composite, url: 'render', panel: 'compose', action: 'final' };
}

function openScene(view, ep, sc) {
  if (view === 'script') {
    state.ui = state.ui || {};
    state.ui.scriptScene = state.ui.scriptScene || {};
    state.ui.scriptScene[ep.id] = sc.id;
    location.hash = '#/script/' + ep.id;
    const el = document.querySelector('[data-scene-id="' + sc.id + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (view === 'render') { location.hash = '#/render/' + ep.id; return; }
  goToScenePanel(ep, sc.id, status(view, ep, sc).panel);
}

export function studioApprovals(view, ep) {
  const group = ['animation', 'voice', 'lipsync', 'render', 'review'].includes(view) ? view : view;
  const items = (ep.scenes || []).map((sc) => ({ sc, ...status(group, ep, sc) }));
  if (!items.length) return null;
  const approved = items.filter((x) => x.approved);
  const pending = items.filter((x) => !x.approved);
  const approve = async (x) => {
    if (!x.ready || !x.action) return openScene(view, ep, x.sc);
    const yes = await confirmDialog({
      title: x.sc.id + ' 승인할까요?',
      body: '현재 저장된 결과를 확인한 뒤 승인하세요. 저장하지 않은 변경사항은 승인되지 않습니다.',
      confirm: '승인', tone: 'sage',
    });
    if (!yes) return;
    const base = '/api/episodes/' + ep.id + '/scenes/' + x.sc.id;
    const paths = {
      script: base + '/approve',
      image: base + '/start-frame/approve',
      audio: base + '/audio/approve',
      final: base + '/final/approve',
    };
    if (x.action === 'clip') {
      const candidate = (x.sc.clips.versions || []).filter((v) => v.status === 'pending_review').slice(-1)[0];
      if (!candidate) return openScene(view, ep, x.sc);
      return act(() => api.post('/api/episodes/' + ep.id + '/clips/' + x.sc.id + '/' + candidate.v + '/review', { decision: 'approve' }), { ok: x.sc.id + ' 애니메이션 승인 완료' });
    }
    await act(() => api.post(paths[x.action], x.action === 'image' ? { approved: true } : {}), { ok: x.sc.id + ' 승인 완료' });
  };
  return h('section', { class: 'card stack', 'data-studio-approval-overview': view, style: 'gap:10px;margin-bottom:12px' },
    h('div', { class: 'row between', style: 'gap:8px;flex-wrap:wrap' },
      h('b', null, '씬 승인 현황 · ' + approved.length + '/' + items.length),
      h('span', { class: 'small muted' }, '승인된 씬 ' + approved.length + ' · 승인이 필요한 씬 ' + pending.length)),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      items.map((x) => h('button', { class: 'btn sm ' + (x.approved ? 'sage' : x.ready ? 'clay' : 'ghost'), type: 'button',
        'data-approval-scene': x.sc.id, 'data-approval-ready': x.ready ? '1' : '0',
        title: x.approved ? '승인됨 · 장면 열기' : x.ready && x.action ? '검토 후 바로 승인' : '장면 열어 준비하기',
        onclick: () => x.approved || !x.ready || !x.action ? openScene(view, ep, x.sc) : approve(x) },
        (x.approved ? '✓ ' : x.ready && x.action ? '승인 ' : '확인 ') + x.sc.id))),
    pending.length ? h('div', { class: 'small muted' }, '미승인 씬을 클릭하면 승인하거나 해당 장면으로 이동합니다. 승인 조건을 통과하지 않은 씬은 자동 승인하지 않습니다.') : h('div', { class: 'small muted' }, '이 단계의 모든 씬이 승인되었습니다.'));
}
