// Lip Sync Studio: approved SILENT animation + approved voice audio → lip-synced video (stored apart from the animation).
// Provider limits are shown before anything is sent; a paid call needs the exact amount confirmed; approved results are never replaced silently.
import { h, chip, confirmDialog, fmtUsd, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { pageHead, pipelineBar, noEpisode, episodePicker, videoTabs } from './common.js';
import { goToScenePanel } from './scene-nav.js';

const STATE = { 'not-needed': ['대사 없음 — 립싱크 불필요', 'done'], blocked: ['준비 안 됨', 'attention'], ready: ['만들 수 있음', 'attention'], pending: ['검토·승인 대기', 'attention'], approved: ['립싱크 승인됨', 'done'], stale: ['승인 후 입력이 바뀜', 'err'] };
const VER = { unverified: ['미확인 — 실제 호출 차단', 'attention'], 'user-entered': ['직접 확인함', 'mock'], verified: ['실제 호출로 검증됨', 'done'] };
const SPEAKERS = { multi: '다인 립싱크 지원(운영자가 선언)', single: '1인만', unknown: '다인 지원 미확인 → 1인만 허용' };

function modelCard(ep) {
  const L = ep.lipsync;
  const m = L.model;
  const [vl, vk] = VER[m.verification] || [m.verification, ''];
  const sel = h('select', { 'data-lipsync-model': '', 'aria-label': '립싱크 모델', onchange: (e) => act(() => api.put('/api/lipsync/default', { modelId: e.target.value }), { ok: '립싱크 기본 모델을 저장했습니다' }) },
    L.models.map((x) => h('option', { value: x.id, selected: x.id === m.id }, `${x.label} · ${x.endpoint}`)));
  return h('div', { class: 'card stack', style: 'gap:8px', 'data-lipsync-model-card': '' },
    h('div', { class: 'card-head' }, h('h2', null, '립싱크 모델'), chip(L.mode === 'live' ? 'LIVE · 유료 호출 가능' : 'MOCK · 요금 없음 (영상+음성을 로컬에서 합침)', L.mode === 'live' ? 'live' : 'mock')),
    sel,
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', 'data-lipsync-caps': '' }, chip(vl, vk), chip(SPEAKERS[m.speakers] || SPEAKERS.unknown, m.speakers === 'multi' ? 'done' : 'attention'),
      chip(m.costEstimateUsd != null ? `장면당 약 ${fmtUsd(m.costEstimateUsd)} (직접 입력)` : '가격 미입력 — 실제 모드에서는 차단', m.costEstimateUsd != null ? 'done' : 'attention'),
      m.maxDurationSec ? chip(`최대 ${m.maxDurationSec}초`, '') : null),
    h('div', { class: 'small muted' }, '이 앱은 다인 립싱크를 가정하지 않습니다. 모델 엔드포인트·가격·화자 수는 Settings → 립싱크 모델에서 플레이그라운드로 확인한 값만 입력하세요. 실제 호출은 확인 + 정확한 금액 승인 후에만 시작됩니다.'));
}

function sceneCard(ep, sc) {
  const v = ep.lipsync.scenes[sc.id];
  const [lab, kind] = STATE[v.state] || [v.state, ''];
  const m = ep.lipsync.model;
  const base = `/api/episodes/${ep.id}`;
  const anim = sc.clips && sc.clips.versions.find((x) => x.v === sc.clips.approvedVersion);
  const sf = ep.sceneFlow.scenes[sc.id];
  const checklist = v.dialogue ? h('ul', { style: 'margin:0;padding-left:18px', 'data-lipsync-prereq': sc.id }, [
    ['anim', '승인된 무음 애니메이션', !!anim],
    ['audio', '승인된 대사 음성', !!(sf && sf.audio.state === 'approved')],
    ['speakers', `화자 ${v.speakers.length}명 (${v.speakers.join(', ')}) — ${v.speakers.length > 1 ? (m.speakers === 'multi' ? '모델이 다인 지원 선언' : '선택한 모델은 다인 미지원') : '1인'}`, !v.problems.some((p) => p.code === 'MULTI_SPEAKER_UNSUPPORTED')],
  ].map(([k, t, ok]) => h('li', { 'data-lipsync-check': k, 'data-lipsync-check-ok': ok ? '1' : '0', style: ok ? '' : 'color:var(--clay)' }, (ok ? '✓ ' : '✗ ') + t))) : null;
  const start = async () => {
    let est;
    try { est = await api.post(`${base}/lipsync/estimate`, { sceneIds: [sc.id] }); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return; }
    if (est.blockers.length) { toast(est.blockers[0].message, { error: true, recovery: est.blockers[0].recovery }); return; }
    const live = est.mode === 'live';
    const ok = await confirmDialog({ title: live ? `${sc.id} 유료 립싱크를 진행할까요?` : `${sc.id} 목업 립싱크를 만들까요?`,
      body: h('div', { class: 'stack small' }, h('div', null, `모델: ${est.model.label}`), h('div', null, live ? `예상 비용: ${fmtUsd(est.totalUsd)} — 이 금액을 승인합니다. 실패해도 자동 재시도하지 않습니다.` : '목업: 무음 애니메이션과 음성을 로컬 FFmpeg로 합칩니다 (요금 없음, 입 모양 동기화는 아님).'),
        est.items[0] && est.items[0].warnings.length ? h('div', { style: 'color:var(--clay)' }, est.items[0].warnings.map((w) => w.message).join(' ')) : null), confirm: live ? '승인하고 실행' : '만들기' });
    if (!ok) return;
    await act(async () => {
      const a = await api.post(`${base}/lipsync/authorize`, { sceneIds: [sc.id], confirmUsd: est.totalUsd, confirmUnknown: est.totalUsd == null });
      await api.post(`${base}/lipsync/run`, { authorizationId: a.id, sceneIds: [sc.id] });
      return null;
    }, { ok: '립싱크를 시작했습니다 — 끝나면 미리보기가 나타납니다' });
    setTimeout(() => act(async () => null), 1500);
    setTimeout(() => act(async () => null), 4000);
  };
  const review = (ver, action, msg) => act(() => api.post(`${base}/scenes/${sc.id}/lipsync/${ver.v}/review`, { action }), { ok: msg });
  const approved = v.versions.find((x) => x.v === v.approvedVersion);
  const skip = !!(ep.lipsyncSkipped && ep.lipsyncSkipped[sc.id]);
  return h('article', { class: 'card stack', style: 'gap:10px', 'data-lipsync-scene': sc.id, 'data-lipsync-state': v.state },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:6px' }, h('b', null, `${sc.id} · ${sc.title_ko || sc.title || ''}`), chip(lab, kind)),
    !v.dialogue ? h('div', { class: 'small muted' }, '이 장면에는 대사가 없습니다. 승인된 무음 애니메이션이 비디오 스튜디오에 그대로 들어갑니다 (명시적 무대사 장면).') : h('div', { class: 'stack', style: 'gap:10px' },
      h('label', { class: 'row small', style: 'gap:8px;cursor:pointer;flex-wrap:wrap', 'data-lipsync-skip': sc.id },
        h('input', { type: 'checkbox', checked: skip, onchange: (e) => act(() => api.put(`${base}/scenes/${sc.id}/lipsync/skip`, { skip: e.target.checked }), { ok: e.target.checked ? '립싱크 생략: 원본 영상과 승인된 음성으로 합본할 수 있습니다' : '립싱크 사용으로 변경했습니다' }) }),
        '립싱크 건너뛰기 (원본 영상 + 음성으로 합본)'),
      skip ? h('div', { class: 'small muted' }, '입 모양은 맞추지 않습니다. 합본 제작·영상 편집·최종 승인은 계속 진행할 수 있습니다.') : null,
      checklist,
      v.problems.length ? h('div', { class: 'stack', style: 'gap:4px' }, v.problems.map((p) => h('div', { class: 'issue err', 'data-lipsync-problem': p.code }, p.message, p.recovery ? h('div', { class: 'small' }, p.recovery) : null))) : null,
      v.stale ? h('div', { class: 'issue err' }, '승인 후 애니메이션 또는 음성이 바뀌었습니다. 다시 만들려면 "승인 취소" 후 새로 승인하세요.') : null,
      h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap;align-items:flex-start' },
        h('div', { class: 'stack', style: 'gap:4px;align-items:center' }, h('div', { class: 'small muted' }, '입력: 무음 애니메이션'), anim ? h('video', { src: anim.url, controls: true, preload: 'metadata', playsinline: true, style: 'width:150px;border-radius:8px' }) : h('div', { class: 'empty small', style: 'width:150px' }, '승인 대기')),
        ...v.versions.slice().reverse().slice(0, 3).map((ver) => h('div', { class: 'stack', style: 'gap:4px;align-items:center', 'data-lipsync-version': ver.v }, h('div', { class: 'small muted' }, `립싱크 v${ver.v}${ver.mock ? ' (목업)' : ''} · ${ver.status === 'approved' ? '승인됨' : ver.status === 'rejected' ? '거절됨' : '검토 대기'}`),
          h('video', { src: ver.url, controls: true, preload: 'metadata', playsinline: true, style: 'width:150px;border-radius:8px' }),
          h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap;justify-content:center' },
            ver.status !== 'approved' ? h('button', { class: 'btn sm sage', type: 'button', 'data-lipsync-approve': sc.id, onclick: () => review(ver, 'approve', `${sc.id} 립싱크 v${ver.v}를 승인했습니다`) }, '승인') : h('button', { class: 'btn sm ghost', type: 'button', 'data-lipsync-unapprove': sc.id, onclick: () => review(ver, 'unapprove', '승인을 취소했습니다 (파일은 보관됩니다)') }, '승인 취소'),
            ver.status === 'pending_review' ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => review(ver, 'reject', '거절했습니다') }, '거절') : null)))),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn clay', type: 'button', 'data-lipsync-start': sc.id, disabled: skip || !!approved || v.problems.length > 0, title: approved ? '승인된 립싱크가 있습니다. 먼저 승인을 취소하세요 (자동으로 덮어쓰지 않습니다)' : v.problems.length ? v.problems[0].message : '', onclick: start }, v.versions.length ? '립싱크 다시 만들기 (비용 확인)' : '립싱크 만들기 (비용 확인)'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { location.hash = '#/animation/' + ep.id; } }, '애니메이션'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { location.hash = '#/voice/' + ep.id; } }, '보이스'))));
}

export function lipsyncStudio() {
  const ep = state.episode;
  if (!ep) return noEpisode();
  const wrap = h('div', { class: 'stack', style: 'gap:18px', 'data-lipsync-studio': '' });
  wrap.append(pageHead('Lip Sync Studio', '립싱크 스튜디오', '승인된 무음 애니메이션과 승인된 음성을 합쳐 말하는 영상을 만듭니다. 결과는 원본 애니메이션과 따로 저장되어, 립싱크만 다시 만들어도 애니메이션·음성은 다시 생성되지 않습니다.', episodePicker()));
  wrap.append(videoTabs('lipsync'));
  wrap.append(pipelineBar(ep));
  const dialogueScenes = ep.scenes.filter((sc) => ep.lipsync.scenes[sc.id].dialogue);
  const notSkipped = dialogueScenes.filter((sc) => !(ep.lipsyncSkipped && ep.lipsyncSkipped[sc.id]));
  const skipAll = h('button', { class: 'btn clay', type: 'button', 'data-lipsync-skip-all': ep.id, disabled: !notSkipped.length,
    onclick: async () => {
      skipAll.disabled = true;
      const failed = [];
      for (const sc of notSkipped) {
        try { await api.put(`/api/episodes/${ep.id}/scenes/${sc.id}/lipsync/skip`, { skip: true }); }
        catch (e) { failed.push(sc.id + ': ' + e.message); }
      }
      if (failed.length) toast('건너뛰기 실패: ' + failed.join(' / '), { error: true });
      else toast('립싱크를 생략했습니다. 승인된 영상과 음성으로 합본할 수 있습니다.');
      await act(async () => null);
    } }, '모든 대사 장면 립싱크 건너뛰기 (' + notSkipped.length + ')');
  const talk = ep.scenes.filter((s) => ep.lipsync.scenes[s.id].dialogue);
  const done = talk.filter((s) => ep.lipsync.scenes[s.id].state === 'approved').length;
  wrap.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap', 'data-lipsync-summary': '' }, chip(`대사 장면 ${talk.length}개 중 ${done}개 승인`, done === talk.length ? 'done' : 'attention'), chip(`대사 없는 장면 ${ep.scenes.length - talk.length}개는 건너뜀`, '')));
  wrap.append(h('section', { class: 'card stack', style: 'gap:10px', 'data-lipsync-skip-all-panel': ep.id },
    h('b', null, '립싱크 없이 진행하기'),
    h('div', { class: 'small muted' }, '입 모양을 맞추지 않고 승인된 애니메이션 + 승인된 음성을 씬 합본에 사용합니다. 모델 선택이나 가격 입력, 유료 립싱크 호출이 필요 없습니다.'),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, skipAll,
      h('button', { class: 'btn sage', type: 'button', 'data-lipsync-to-editing': '', onclick: () => { location.hash = '#/render/' + ep.id; } }, '영상 편집으로 이동 →')),
    h('div', { class: 'small muted' }, '합본 자체는 비디오 스튜디오의 장면 검토에서 일괄 실행하세요. 영상·음성 승인이 안 된 장면은 준비 후 합본할 수 있습니다.')));
  wrap.append(h('details', { class: 'scene-section', 'data-lipsync-model-advanced': '' },
    h('summary', null, '립싱크 모델 설정 · 유료 생성 (선택사항)'),
    modelCard(ep)));
  ep.scenes.forEach((sc) => wrap.append(sceneCard(ep, sc)));
  return wrap;
}
