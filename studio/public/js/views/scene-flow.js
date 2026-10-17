// Storyboard → per-scene production steps after the start image and B-cuts: audio check/approval and "씬 합본 · 최종 승인" (sound effects included).
// Everything here is free except audio generation in LIVE voice mode, which shows the exact character count and needs a confirmation (same as the Voice page).
import { h, chip, icon, confirmDialog, fmtUsd, toast } from '../ui.js';
import { state, act, go } from '../state.js';
import { api } from '../api.js';
import { goToScenePanel } from './scene-nav.js';
import { sfxEditor } from './sfx-editor.js';

const AUDIO_LABEL = { none: '오디오 없음', partial: '일부만 있음', unapproved: '확인·승인 대기', approved: '승인됨', stale: '수정됨 · 다시 승인', silent: '대사 없음' };
const AUDIO_KIND = { none: 'attention', partial: 'attention', unapproved: 'attention', approved: 'done', stale: 'err', silent: 'done' };
const FINAL_LABEL = { incomplete: '앞 단계 대기', ready: '합본 만들기 대기', built: '합본 확인·승인 대기', approved: '최종 승인됨', stale: '승인 후 바뀜' };
const FINAL_KIND = { incomplete: '', ready: 'attention', built: 'attention', approved: 'done', stale: 'err' };

export const flowOf = (ep, sid) => (ep.sceneFlow && ep.sceneFlow.scenes && ep.sceneFlow.scenes[sid]) || null;

/** The six steps of one scene, each with a state and the panel that fixes it. */
export function sceneSteps(ep, sc) {
  const f = flowOf(ep, sc.id) || { audio: { state: 'none' }, final: { state: 'incomplete' } };
  const img = sc.startImageInfo;
  const imgOk = !!(img && !img.error && img.approved);
  const brollOpen = (sc.broll || []).filter((b) => b.status === 'proposed').length;
  const audioOk = ['approved', 'silent'].includes(f.audio.state);
  const clipOk = !!(sc.clips && sc.clips.approvedVersion);
  const dlg = f.audio.state !== 'silent';
  const ls = (ep.lipsync && ep.lipsync.scenes && ep.lipsync.scenes[sc.id]) || { state: dlg ? 'blocked' : 'not-needed' };
  const lsDone = !dlg || ls.state === 'approved' || (f.final && f.final.state === 'approved');
  return [
    { key: 'image', n: 1, label: '이미지 · B컷', done: imgOk && !brollOpen, note: !imgOk ? '이미지 승인 필요' : brollOpen ? `B컷 ${brollOpen}개 검토 대기` : '완료', panel: imgOk ? 'cuts' : '' },
    { key: 'clips', n: 2, label: '무음 애니메이션', done: clipOk, note: clipOk ? '무음 클립 승인됨' : sc.clips && sc.clips.versions.length ? '클립 승인 대기' : '생성 대기', panel: 'clips', view: 'animation' },
    { key: 'audio', n: 3, label: '보이스', done: audioOk, note: AUDIO_LABEL[f.audio.state], panel: 'audio', attention: f.audio.state === 'stale', view: 'voice' },
    { key: 'lipsync', n: 4, label: '립싱크', done: lsDone, note: !dlg ? '대사 없음 — 건너뜀' : ls.state === 'approved' ? '립싱크 승인됨' : !clipOk || !audioOk ? '무음 애니메이션·음성 승인 후' : '립싱크 대기', panel: 'lipsync', attention: ls.state === 'stale', view: 'lipsync' },
    { key: 'compose', n: 5, label: '합본 · 효과음', done: ['built', 'approved'].includes(f.final.state), note: f.final.state === 'incomplete' ? '앞 단계 대기' : f.final.composite ? '합본 있음' : '합본 대기', panel: 'compose' },
    { key: 'final', n: 6, label: '씬 최종 승인', done: f.final.state === 'approved', note: FINAL_LABEL[f.final.state], panel: 'compose', attention: f.final.state === 'stale' },
  ];
}

export function stepper(ep, sc) {
  return h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap', 'data-sb-stepper': sc.id }, sceneSteps(ep, sc).map((s) =>
    h('button', { class: 'chip ' + (s.attention ? 'err' : s.done ? 'done' : s.locked ? '' : 'attention'), type: 'button', style: 'cursor:pointer', 'data-step': s.key, 'data-step-done': s.done ? '1' : '0', title: s.note, onclick: () => goToScenePanel(ep, sc.id, s.panel) }, `${s.n}. ${s.label} · ${s.note}`)));
}

// ------------------------------------------------------------------ audio
export function audioBadge(ep, sc) { const f = flowOf(ep, sc.id); return f ? AUDIO_LABEL[f.audio.state] : ''; }

export function audioPanelBody(ep, sc) {
  const f = flowOf(ep, sc.id);
  if (!f) return h('div', { class: 'small muted' }, '오디오 정보를 불러오지 못했습니다.');
  const a = f.audio;
  const chars = state.summary.characters || [];
  const nameOf = (id) => (chars.find((c) => c.id === id) || {}).name || id;
  const base = `/api/episodes/${ep.id}/scenes/${sc.id}/audio`;
  const generate = async () => {
    let est;
    try { est = await api.post(base + '/estimate', {}); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return; }
    if (est.blockers && est.blockers.length) { toast(est.blockers[0].message, { error: true, recovery: est.blockers[0].recovery }); return; }
    const live = est.mode === 'live';
    const todo = est.lines.length - est.cachedLines;
    if (!todo) { toast('이미 모든 대사의 음성이 있습니다.'); return; }
    const ok = await confirmDialog({ title: live ? `${sc.id} 유료 음성 생성을 진행할까요?` : `${sc.id} 목업 음성을 만들까요?`, body: h('div', { class: 'stack small' }, h('div', null, `${todo}개 대사 · ${est.billableChars}자 (이미 있는 ${est.cachedLines}개는 다시 만들지 않음)`), live ? h('div', null, est.usdKnown ? '예상 ' + fmtUsd(est.usd) : '가격 추정치가 입력되지 않았습니다 (설정에서 입력)') : h('div', { class: 'muted' }, '요금이 없습니다.'), h('div', { class: 'muted' }, '실패한 대사는 자동으로 다시 시도하지 않습니다.')), confirm: '생성', tone: live ? 'clay' : 'sage' });
    if (ok) await act(() => api.post(base + '/run', { confirmChars: est.billableChars }), { ok: '오디오를 만들었습니다 — 들어보고 승인하세요' });
  };
  const approve = () => act(() => api.post(base + '/approve', {}), { ok: `${sc.id} 오디오를 승인했습니다` });
  const revoke = async () => { if (await confirmDialog({ title: '오디오 승인을 취소할까요?', body: '음성 파일은 지워지지 않습니다. 취소하면 이 장면의 영상 생성과 씬 최종 승인이 다시 대기 상태가 됩니다 (이미 만든 클립은 그대로입니다).', confirm: '승인 취소', tone: 'clay' })) act(() => api.post(base + '/revoke', {}), { ok: '오디오 승인을 취소했습니다' }); };
  if (a.state === 'silent') return h('div', { class: 'small muted', 'data-audio-panel': sc.id }, '이 장면에는 대사가 없어 오디오 확인이 필요 없습니다.');
  return h('div', { class: 'stack', style: 'gap:10px', 'data-audio-panel': sc.id, 'data-audio-state': a.state },
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, chip(AUDIO_LABEL[a.state], AUDIO_KIND[a.state]), a.totalSec ? h('span', { class: 'small muted' }, `총 ${a.totalSec}초`) : null),
    a.state === 'stale' ? h('div', { class: 'issue err' }, '승인 후 대사 또는 목소리가 바뀌었습니다. 다시 들어보고 승인하세요.') : null,
    h('div', { class: 'stack', style: 'gap:8px' }, a.lines.map((l) => h('div', { class: 'card flat stack', style: 'gap:4px', 'data-audio-line': l.id },
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, h('b', null, nameOf(l.speaker)), h('span', { class: 'small muted' }, l.id), l.valid ? chip(`${l.durationSec}초`, 'done') : chip('음성 없음', 'attention'), l.mock ? chip('목업 음성', 'mock') : null),
      h('div', null, l.en), h('div', { class: 'small muted' }, l.ko),
      l.valid ? h('audio', { controls: true, preload: 'none', src: l.url, 'data-audio-player': l.id, style: 'width:100%' }) : null))),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm clay', type: 'button', 'data-audio-generate': sc.id, onclick: generate }, icon('play'), ['none', 'partial'].includes(a.state) ? '오디오 생성' : '없는 대사 오디오 생성'),
      a.state === 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-audio-revoke': sc.id, onclick: revoke }, '승인 취소') : h('button', { class: 'btn sm sage', type: 'button', 'data-audio-approve': sc.id, disabled: ['none', 'partial'].includes(a.state), onclick: approve }, icon('check'), '오디오 승인'),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-audio-edit': sc.id, onclick: async () => { if (a.state === 'approved' && !(await confirmDialog({ title: '대사를 고치러 갈까요?', body: '대본에서 대사를 고치면 이 장면의 오디오 승인이 "수정됨"으로 바뀌고 다시 만들어 승인해야 합니다.', confirm: '대본으로 이동' }))) return; go('script'); } }, '대사 수정 (대본)')),
    h('div', { class: 'small muted' }, '영상(애니메이션)은 승인된 오디오 길이에 맞춰 만듭니다. 대사 오디오는 대본이 승인된 뒤에 만들 수 있습니다.'));
}

// ------------------------------------------------------------------ sound effects + composite + scene final approval
export function composeBadge(ep, sc) { const f = flowOf(ep, sc.id); return f ? FINAL_LABEL[f.final.state] : ''; }

export function composePanelBody(ep, sc) {
  const f = flowOf(ep, sc.id);
  if (!f) return h('div', { class: 'small muted' }, '정보를 불러오지 못했습니다.');
  const fin = f.final;
  const base = `/api/episodes/${ep.id}/scenes/${sc.id}`;
  const compose = () => act(() => api.post(base + '/compose', {}), { ok: '씬 합본을 만들었습니다 — 재생해서 확인하세요' });
  const approve = () => act(() => api.post(base + '/final/approve', {}), { ok: `${sc.id} 씬을 최종 승인했습니다` });
  const revoke = async () => { if (await confirmDialog({ title: '씬 최종 승인을 취소할까요?', body: '합본과 파일은 지워지지 않습니다. 취소하면 이 씬은 최종 렌더에서 제외(차단)됩니다. 효과음·컷을 고친 뒤 다시 합치고 승인하세요.', confirm: '승인 취소', tone: 'clay' })) act(() => api.post(base + '/final/revoke', {}), { ok: '씬 최종 승인을 취소했습니다' }); };
  return h('div', { class: 'stack', style: 'gap:12px', 'data-compose-panel': sc.id, 'data-final-state': fin.state },
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, chip(FINAL_LABEL[fin.state], FINAL_KIND[fin.state]), fin.missing.length ? h('span', { class: 'small muted' }, `필요: ${fin.missing.join(', ')} 승인`) : null),
    fin.state === 'stale' ? h('div', { class: 'issue err' }, `승인 후 바뀐 부분: ${fin.changed.join(', ') || '내용'}. 다시 합쳐서 확인한 뒤 승인하세요.`) : null,
    sfxEditor(ep, sc),
    h('div', { class: 'stack', style: 'gap:6px' }, h('b', { class: 'small' }, '씬 합본 (영상 클립 + 오디오 + 컷 · B컷 + 효과음, 미리보기 화질)'),
      fin.composite ? h('video', { controls: true, preload: 'metadata', src: fin.composite.url, 'data-scene-composite': sc.id, style: 'max-width:260px;border-radius:8px' }) : h('div', { class: 'small muted' }, '아직 합본이 없습니다.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn sm clay', type: 'button', 'data-compose': sc.id, disabled: fin.state === 'incomplete', title: fin.state === 'incomplete' ? '영상 클립과 오디오가 먼저 승인되어야 합니다' : '', onclick: compose }, fin.composite ? '다시 합치기' : '씬 합치기 (무료)'),
        fin.state === 'approved' ? h('button', { class: 'btn sm ghost', type: 'button', 'data-final-revoke': sc.id, onclick: revoke }, '씬 승인 취소') : h('button', { class: 'btn sm sage', type: 'button', 'data-final-approve': sc.id, disabled: !fin.composite, title: fin.composite ? '' : '합본을 만들고 확인한 뒤 승인합니다', onclick: approve }, icon('check'), '씬 최종 승인'))),
    fin.history && fin.history.length ? h('div', { class: 'small muted' }, '기록: ' + fin.history.map((x) => `${x.action === 'approved' ? '승인' : '취소'} ${String(x.at).slice(5, 16).replace('T', ' ')}`).join(' · ')) : null);
}
