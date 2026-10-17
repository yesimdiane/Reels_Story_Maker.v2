// Script Studio: scene approval footer, project approval panel (progress + hand-off to Image Development), reuse tools.
// Nothing here can start a paid generation: approval and hand-off only save state; image generation has its own cost review.
import { h, chip, confirmDialog, toast } from '../ui.js';
import { state, act, selectEpisode } from '../state.js';
import { api } from '../api.js';
import { jumpTo } from './script-validate.js';

const STATUS_CHIP = { draft: ['초안', 'mock'], needs_changes: ['수정 필요', 'err'], ready: ['승인 가능', 'attention'], approved: ['승인됨', 'done'] };
const when = (iso) => { try { return new Date(iso).toLocaleString('ko-KR'); } catch (_) { return iso || ''; } };

export const statusChip = (ap) => { const [t, k] = STATUS_CHIP[ap.status] || ['', '']; return chip(t + (ap.approved && ap.revision ? ` · r${ap.revision}` : ''), k); };

/** Bottom of every scene editor: status, blocking reasons (clickable) and the "씬 승인" button. */
export function sceneFooter(ep, sc, d) {
  const scEp = ep.scenes.find((s) => s.id === sc.id);
  const ap = scEp && scEp.approval;
  if (!ap) return h('div', { class: 'scene-footer' }, h('div', { class: 'small muted' }, '새 장면입니다. 저장한 뒤 승인할 수 있습니다.'));
  const approve = () => act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/approve`), { ok: `${sc.id} 씬을 승인했습니다` });
  const revoke = async () => { if (await confirmDialog({ title: `${sc.id} 승인을 취소할까요?`, body: '대본 전체 승인도 함께 무효가 됩니다. 이전 승인본은 기록에 남습니다.', tone: 'clay' })) act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/revoke`), { ok: '씬 승인을 취소했습니다' }); };
  const unsaved = !!d.dirty;
  const blocked = unsaved || ap.errorCount > 0 || ap.approved;
  const btn = ap.approved
    ? h('button', { class: 'btn ghost', onclick: revoke }, '씬 승인 취소')
    : h('button', { class: 'btn sage', 'data-scene-approve': sc.id, disabled: blocked, title: unsaved ? '저장하지 않은 변경이 있습니다. 먼저 저장하세요.' : ap.errorCount ? '빨간 표시된 항목을 먼저 고치세요.' : '', onclick: approve }, '씬 승인');
  const hist = h('details', null, h('summary', { class: 'small muted', style: 'cursor:pointer' }, `승인 기록 (${ap.history.length}개 버전)`), h('div', { class: 'stack', style: 'gap:6px;margin-top:6px', 'data-history': sc.id }, h('span', { class: 'small muted' }, '열어서 불러옵니다…')));
  hist.addEventListener('toggle', async () => {
    if (!hist.open) return;
    const box = hist.querySelector('[data-history]');
    try {
      const r = await api.get(`/api/episodes/${ep.id}/scenes/${sc.id}/history`);
      box.replaceChildren(...(r.versions.length ? r.versions.slice().reverse().map((v) => h('div', { class: 'scene-version' },
        h('div', { class: 'row between' }, h('b', null, `r${v.rev}`), h('span', { class: 'small muted' }, `${when(v.at)} · ${v.by}${v.revokedAt ? ' · 취소됨' : v.supersededAt ? ' · 새 버전으로 대체됨' : ''}`)),
        h('div', { class: 'small muted' }, `${v.snapshot.scene.durationSec}초 · 대사 ${v.snapshot.lines.length}개`),
        v.snapshot.lines.map((l) => h('div', { class: 'small' }, `${l.speaker}: ${l.en}  /  ${l.ko}`)))) : [h('span', { class: 'small muted' }, '아직 승인한 적이 없습니다.')]));
    } catch (e) { box.replaceChildren(h('span', { class: 'small', style: 'color:var(--rose)' }, e.message)); }
  });
  return h('div', { class: 'scene-footer ' + ap.status, 'data-rf': `S:${sc.id}:footer` },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' },
      h('div', { class: 'row' }, statusChip(ap), ap.editedAfterApproval ? chip(`승인 후 수정됨 — r${ap.lastApprovedRev} 승인본은 기록에 보관됨`, 'attention') : null, ap.approved ? h('span', { class: 'small muted' }, `${when(ap.approvedAt)} · ${ap.approvedBy}`) : null),
      btn),
    unsaved ? h('div', { class: 'small', style: 'color:var(--clay)' }, '저장하지 않은 변경이 있습니다. 저장한 뒤 승인할 수 있습니다.') : null,
    !ap.approved && ap.errors.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'small', style: 'color:var(--rose);font-weight:600' }, `승인하려면 ${ap.errors.length}개를 고쳐야 합니다`), ap.errors.map((e) => h('button', { class: 'issue err issue-link', type: 'button', onclick: () => jumpTo(Object.assign({ sceneId: sc.id }, e, { key: undefined })) }, h('span', null, e.message)))) : null,
    hist);
}

/** Top panel: scene approval progress, clickable validation summary, bulk approve, script approval status and the Image Development button. */
export function projectPanel(ep, d, summaryEl) {
  const sa = ep.derived.sceneApproval;
  const pct = sa.sceneCount ? Math.round((sa.approvedCount / sa.sceneCount) * 100) : 0;
  const ho = ep.derived.handoff;
  const scriptOk = ep.derived.scriptApproved;
  const bulk = async () => {
    const n = sa.readyScenes.length;
    if (!n) return toast('지금 바로 승인할 수 있는 씬이 없습니다. 먼저 빨간 항목을 고치세요.');
    if (await confirmDialog({ title: `승인 가능한 씬 ${n}개를 한꺼번에 승인할까요?`, body: h('div', { class: 'small stack' }, h('div', null, sa.readyScenes.join(', ')), h('div', { class: 'muted' }, '모든 검사를 통과한 씬만 승인됩니다. 오류가 있는 씬은 그대로 두며, 대본 전체 승인은 따로 눌러야 합니다.')), confirm: '승인' })) {
      const r = await act(() => api.post(`/api/episodes/${ep.id}/scenes/approve-ready`), { ok: '' });
      if (r && r.approveResult) toast(`${r.approveResult.approved.length}개 씬을 승인했습니다` + (r.approveResult.skipped.length ? ` · ${r.approveResult.skipped.length}개는 아직 승인할 수 없습니다` : ''));
    }
  };
  // 전체 대본 승인 → 이미지 디벨롭: approves the script (when it is not approved yet) and hands over to Image Development. Explicitly confirmed; never generates anything.
  const handoff = async () => {
    const ok = await confirmDialog({ title: '전체 대본을 승인하고 스토리보드로 이동할까요?', body: h('div', { class: 'small stack' },
      h('div', null, `${sa.progress}. 전체 대본을 승인하고, 승인된 대본의 변경 불가능한 스냅샷을 저장해 장면 ID·한국어 제목·대사·시각 연출·승인된 캐릭터/제품 참조를 이미지 디벨롭 작업공간으로 넘깁니다.`),
      h('div', { class: 'banner ok' }, '이 단계에서는 이미지가 만들어지거나 요금이 발생하지 않습니다. 이미지 생성은 이동 후 별도의 비용 확인과 승인을 거칩니다.')), confirm: scriptOk ? '스냅샷 저장하고 이동' : '승인하고 이동' });
    if (!ok) return;
    const r = await act(async () => { if (!scriptOk) await api.post(`/api/episodes/${ep.id}/script/approve`); return api.post(`/api/episodes/${ep.id}/script/handoff`); }, { ok: '전체 대본을 승인하고 스냅샷을 저장했습니다' });
    if (r) { state.leaveGuard = null; location.hash = '#/image/' + ep.id; }
  };
  const dup = async () => {
    const title = h('input', { type: 'text', value: `${ep.title} (복제)`, 'aria-label': '새 에피소드 제목' });
    const ok = await confirmDialog({ title: '에피소드를 복제할까요?', body: h('div', { class: 'stack small' }, h('div', { class: 'muted' }, '대본(장면·대사·CTA·엔딩 선택)만 독립된 복사본으로 만듭니다. 승인, 이미지, 클립, 음성, 렌더는 복사되지 않고 원본은 바뀌지 않습니다.'), h('div', { class: 'field' }, h('label', null, '새 제목'), title)), confirm: '복제' });
    if (!ok) return;
    try { const r = await api.post(`/api/episodes/${ep.id}/duplicate`, { title: title.value }); await selectEpisode(r.duplicatedId); location.hash = '#/script/' + r.duplicatedId; toast('복제했습니다 · ' + r.duplicatedId); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
  };
  const addFromTemplate = async () => {
    let list = [];
    try { list = (await api.get('/api/scene-templates')).templates; } catch (e) { return toast(e.message, { error: true }); }
    if (!list.length) return toast('저장된 씬 템플릿이 없습니다. 장면의 "재사용" 메뉴에서 먼저 템플릿으로 저장하세요.');
    const sel = h('select', { 'aria-label': '씬 템플릿' }, list.map((t) => h('option', { value: t.id }, `${t.name} (v${t.current})`)));
    const linked = h('input', { type: 'checkbox' });
    const beat = ep.formula.structured ? h('select', { 'aria-label': '들어갈 단계' }, ep.formula.partA.map((b) => h('option', { value: b.key }, b.label))) : null;
    const ok = await confirmDialog({ title: '템플릿에서 씬 추가', body: h('div', { class: 'stack small' }, h('div', { class: 'field' }, h('label', null, '템플릿'), sel), beat ? h('div', { class: 'field' }, h('label', null, '들어갈 단계 (PART A)'), beat) : null,
      h('label', { class: 'row', style: 'gap:6px' }, linked, '링크된 템플릿으로 추가 (나중에 템플릿이 바뀌면 직접 "최신 버전 가져오기"를 눌러야 반영됩니다)'), h('div', { class: 'muted' }, '기본은 독립된 복사본입니다. 이 에피소드를 고쳐도 템플릿이나 다른 에피소드는 바뀌지 않습니다.')), confirm: '추가' });
    if (!ok) return;
    try { await api.post(`/api/scene-templates/${sel.value}/apply`, { episodeId: ep.id, linked: linked.checked, beatKey: beat ? beat.value : undefined }); state.draft.script = null; await act(async () => null, { ok: '씬을 추가했습니다 (새 씬은 승인이 필요합니다)' }); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
  };

  const blockers = sa.blockers.filter((b) => b.scope === 'project' && !['SCENES_PENDING'].includes(b.code));
  const card = h('div', { class: 'card project-panel stack', style: 'gap:12px', 'data-project-panel': ep.id },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' },
      h('div', null, h('div', { class: 'eyebrow' }, `프로젝트 · ${ep.derived.project.name || ep.id}`), h('h3', null, '승인 진행')),
      h('div', { class: 'row' }, chip(sa.progress, sa.allScenesApproved ? 'done' : 'attention'), scriptOk ? chip(`대본 승인됨 v${ep.approvals.script.version}`, 'done') : chip(ep.derived.scriptChangedSinceApproval ? '대본 재승인 필요' : '대본 승인 대기', 'attention'))),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': sa.sceneCount, 'aria-valuenow': sa.approvedCount, 'aria-label': sa.progress }, h('i', { style: `width:${pct}%` })),
    h('div', { class: 'row project-actions', style: 'flex-wrap:wrap;gap:10px' },
      h('button', { class: 'btn clay big-cta', 'data-handoff': ep.id, disabled: d.dirty || d.epDirty || !(scriptOk ? ho.ready : (sa.canApproveProject && ep.derived.validation.ok)), title: !sa.allScenesApproved ? `${sa.progress} — 모든 씬을 먼저 승인하세요` : d.dirty || d.epDirty ? '저장하지 않은 변경이 있습니다' : '', onclick: handoff }, '스토리보드로 이동'),
      ho.done ? h('a', { class: 'btn ghost', href: '#/image/' + ep.id }, ho.current ? '스토리보드 열기' : '스토리보드 열기 (대본이 바뀜 — 다시 이동 필요)') : null),
    h('details', { class: 'plain-details' }, h('summary', { class: 'small muted' }, '더보기 · 오류 목록 · 일괄 승인 · 복제 · 템플릿'),
      h('div', { class: 'stack', style: 'gap:10px;margin-top:8px' },
        h('div', { class: 'small muted' }, '① 빨간 항목 고치기 → ② 씬별 승인 → ③ 스토리보드로 이동 (전체 대본 승인 포함)'),
        summaryEl,
        blockers.length ? h('div', { class: 'stack', style: 'gap:6px' }, blockers.map((b) => h('div', { class: 'issue err' }, b.message))) : null,
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
          h('button', { class: 'btn sm ghost', disabled: d.dirty || !sa.readyScenes.length, title: d.dirty ? '먼저 씬을 저장하세요' : '모든 검사를 통과한 씬만 한꺼번에 승인합니다', onclick: bulk }, `승인 가능한 씬 모두 승인${sa.readyScenes.length ? ` (${sa.readyScenes.length})` : ''}`),
          h('button', { class: 'btn sm ghost', onclick: dup }, '에피소드 복제'),
          h('button', { class: 'btn sm ghost', onclick: addFromTemplate }, '템플릿에서 씬 추가')),
        ep.duplicatedFrom ? h('span', { class: 'small muted' }, `원본: ${ep.duplicatedFrom.episodeId} (독립 복사본)`) : null)));
  return card;
}

/** "재사용" menu of one scene: origin, save as template, copy into another episode, update a linked template scene. */
export function sceneTools(ep, sc) {
  const scEp = ep.scenes.find((s) => s.id === sc.id);
  if (!scEp) return null;
  const link = scEp.link;
  const locked = scEp.part === 'B';
  const saveTpl = async () => {
    const name = h('input', { type: 'text', value: `${scEp.title_ko || sc.id} 템플릿`, 'aria-label': '템플릿 이름' });
    if (await confirmDialog({ title: '씬 템플릿으로 저장', body: h('div', { class: 'stack small' }, h('div', { class: 'muted' }, '저장된 내용(저장된 버전)이 템플릿이 됩니다. 이후 이 씬을 고쳐도 템플릿은 바뀌지 않습니다.'), h('div', { class: 'field' }, h('label', null, '이름'), name)), confirm: '저장' })) {
      try { const t = await api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/template`, { name: name.value }); toast(`템플릿 "${t.name}" v${t.current} 저장`); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    }
  };
  const copy = async () => {
    const others = (state.summary.episodes || []).filter((e) => e.id !== ep.id);
    if (!others.length) return toast('복사할 다른 에피소드가 없습니다.');
    const to = h('select', { 'aria-label': '대상 에피소드' }, others.map((e) => h('option', { value: e.id }, `${e.id} · ${e.title}`)));
    if (await confirmDialog({ title: `${sc.id} 장면을 다른 에피소드로 복사`, body: h('div', { class: 'stack small' }, h('div', { class: 'muted' }, '독립된 복사본이 만들어집니다 (원본 링크만 기록). 복사된 씬은 새 씬이므로 승인이 필요하고, 원본은 바뀌지 않습니다.'), h('div', { class: 'field' }, h('label', null, '대상 에피소드'), to)), confirm: '복사' })) {
      try { const r = await api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/copy`, { toEpisodeId: to.value }); toast(`${to.value}에 ${r.sceneId}로 복사했습니다`); await act(async () => null); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); }
    }
  };
  const sync = () => act(() => api.post(`/api/episodes/${ep.id}/scenes/${sc.id}/template-sync`), { ok: '템플릿 최신 버전을 가져왔습니다 (다시 승인 필요)' });
  const origin = link ? (link.type === 'template' ? `템플릿 "${link.templateName || link.templateId}" v${link.templateVersion}${link.linked ? ' (링크됨)' : ' (독립 복사본)'}` : `${link.episodeId}/${link.sceneId}에서 복사 (독립 복사본)`) : '';
  return h('details', { class: 'small' }, h('summary', { class: 'muted', style: 'cursor:pointer' }, '재사용 · 복사 · 템플릿' + (origin ? ' — ' + origin : '')),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-top:8px' },
      locked ? h('span', { class: 'small muted' }, '제품 엔딩 컷은 엔딩 템플릿으로 재사용됩니다 (설정 → 엔딩 템플릿 / 에피소드 복제).') : [h('button', { class: 'btn sm ghost', onclick: saveTpl }, '템플릿으로 저장'), h('button', { class: 'btn sm ghost', onclick: copy }, '다른 에피소드로 복사')],
      link && link.linked && link.updateAvailable ? h('button', { class: 'btn sm clay', onclick: sync }, '템플릿 최신 버전 가져오기') : null));
}
