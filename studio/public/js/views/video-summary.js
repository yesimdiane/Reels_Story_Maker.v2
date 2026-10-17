// Video Studio summary: preview, video / voice / B-roll / render status, estimated cost, honest infrastructure status and the
// primary actions. Technical parameters stay in the collapsed panels of the studio pages. Paid actions always go through their own
// cost confirmation; previews and renders run on the server's FFmpeg and cost nothing.
import { h, chip, icon, confirmDialog, fmtUsd, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

const MODE_CHIP = { mock: ['목업', 'mock'], live: ['실제', 'live'], local: ['서버', 'done'], manual: ['수동', ''] };

export function videoSummary(ep, { startVideo }) {
  const vs = ep.derived.videoStudio;
  if (!vs) return h('div', null);
  const c = vs.clips; const v = vs.voice; const r = vs.render; const cost = vs.cost;
  const shown = r.lastFinal || r.lastPreview;
  const clipPreview = !shown && (ep.scenes || []).flatMap((s) => (s.clips && s.clips.versions || []).map((v) => ({ ...v, sceneId: s.id }))).find((v) => v.url);
  const previewAvailable = !!clipPreview;
  const busy = r.running || c.running.length > 0;

  const render = (preview) => async () => {
    if (!preview && !(await confirmDialog({ title: '최종 렌더(1080×1920)를 시작할까요?', body: '이 서버의 FFmpeg로 영상을 만듭니다 (요금 없음). 렌더는 새 버전으로 저장되고 이전 영상은 덮어쓰지 않습니다.', confirm: '렌더 시작', tone: 'sage' }))) return;
    await act(() => api.post(`/api/episodes/${ep.id}/render`, { preview }), { ok: preview ? '미리보기 렌더를 시작했습니다' : '최종 렌더를 시작했습니다' });
  };
  const startVoice = async () => {
    const est = ep.derived.voice;
    const live = est.mode === 'live';
    const ok = await confirmDialog({ title: live ? '유료 음성 생성을 진행할까요?' : '목업 음성을 만들까요?', body: h('div', { class: 'stack small' }, h('div', null, `${est.lines.length - est.cachedLines}개 대사 · ${est.billableChars}자`), h('div', { class: 'muted' }, live ? '실제 HeyGen 호출은 요금이 청구될 수 있습니다. 이미 만든 음성은 다시 만들지 않습니다.' : '목업 음성은 요금이 없습니다.')), confirm: live ? '승인하고 생성' : '생성', tone: live ? 'clay' : 'sage' });
    if (ok) await act(() => api.post(`/api/episodes/${ep.id}/voice/run`, { confirmChars: est.billableChars }), { ok: '음성을 생성했습니다' });
  };

  const stat = (label, main, kind, sub) => h('div', { class: 'vs-stat', 'data-vs': label }, h('div', { class: 'small muted' }, label), h('div', { class: 'row', style: 'gap:6px' }, chip(main, kind)), sub ? h('div', { class: 'small muted' }, sub) : null);
  const failedBox = c.failed.length || c.uncertain.length ? h('div', { class: 'card flat stack', style: 'gap:8px', 'data-vs-failed': '' },
    h('b', null, '다시 확인이 필요한 장면'),
    ...c.failed.map((f) => h('div', { class: 'stack', style: 'gap:4px', 'data-failed-scene': f.sceneId }, h('div', null, h('b', null, f.sceneId), ' · ', JOB_LABEL(f.status)), f.message ? h('div', { class: 'small', style: 'color:var(--rose)' }, f.message) : null, f.recovery ? h('div', { class: 'small muted' }, '→ ' + f.recovery) : null,
      h('button', { class: 'btn sm clay', type: 'button', 'data-retry': f.sceneId, disabled: busy, onclick: () => startVideo([f.sceneId]) }, `${f.sceneId}만 다시 시도 (비용 확인)`))),
    ...c.uncertain.map((u) => h('div', { class: 'small', 'data-uncertain-scene': u.sceneId }, h('b', null, u.sceneId), ' · 결과 확인 필요: ', u.message, ' — 요금이 이미 청구되었을 수 있어 자동으로 다시 실행하지 않습니다. 작업 내역에서 확인하세요.')),
    c.failed.length > 1 ? h('button', { class: 'btn sm ghost', type: 'button', disabled: busy, onclick: () => startVideo(c.retryable) }, `실패한 ${c.failed.length}개 장면만 한 번에 다시 시도`) : null) : null;

  return h('section', { class: 'card stack vs-summary', style: 'gap:14px', 'data-video-summary': ep.id },
    h('div', { class: 'vs-grid' },
      h('div', { class: 'vs-preview' },
        shown || previewAvailable ? h('video', { src: shown ? shown.url : clipPreview.url, controls: true, playsinline: true, preload: 'metadata', 'data-vs-player': '', onerror: () => toast('미리보기 영상 파일을 재생할 수 없습니다. 영상 생성 화면에서 클립을 확인하세요.', { error: true }) }) : h('div', { class: 'ph' }, '재생 가능한 영상 클립이 없습니다'),
        shown ? h('div', { class: 'small muted' }, `v${shown.v} · ${r.lastFinal ? '최종' : '미리보기'}${r.lastFinal && !r.fresh ? ' · 이전 상태(다시 렌더 필요)' : ''}`) : previewAvailable ? h('div', { class: 'small muted' }, `${clipPreview.sceneId} · 클립 미리보기 (전체 합본 아님, 무료)`) : null),
      h('div', { class: 'stack', style: 'gap:10px' },
        h('div', { class: 'vs-stats' },
          stat('영상 생성', `${c.approved}/${c.total} 승인`, c.approved === c.total ? 'done' : 'attention', c.running.length ? `${c.running.length}개 생성 중` : c.failed.length ? `${c.failed.length}개 실패` : `${c.generated}개 생성됨`),
          stat('음성', `${v.ready}/${v.total} 대사`, v.ready === v.total && v.total ? 'done' : 'attention', v.needsApi ? 'HeyGen API 필요' : v.mode === 'mock' ? '목업 음성' : ''),
          stat('B-roll', `${vs.broll.approved}개 승인`, vs.broll.approved ? 'done' : '', vs.broll.needImage ? `이미지 필요 ${vs.broll.needImage}` : ''),
          stat('렌더', r.running ? '렌더 중…' : r.lastFinal ? (r.fresh ? '최신' : '오래됨') : '없음', r.running ? 'processing' : r.fresh ? 'done' : 'attention')),
        h('div', { class: 'card flat tight', 'data-vs-cost': '' }, h('div', { class: 'small muted' }, '예상 생성 비용 (아직 승인되지 않은 장면 기준)'),
          h('div', { style: 'font-family:var(--serif);font-size:26px;font-weight:600' }, cost.mode === 'mock' ? '$0 (목업)' : cost.videoUnknown ? '추정치 없음' : fmtUsd(cost.videoUsd)),
          h('div', { class: 'small muted' }, [cost.voiceChars != null ? `음성 ${cost.voiceChars}자` : null, cost.note].filter(Boolean).join(' · '))),
        h('div', { class: 'small', style: 'font-weight:600' }, '다음: ', vs.next.label))),
    ep.derived.castWarnings && ep.derived.castWarnings.length ? h('div', { class: 'banner warn', 'data-cast-warnings': '' }, icon('lock'), h('div', null, h('b', null, '렌더 전에 확인하세요 — 캐릭터 자산이 부족합니다'), h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, ep.derived.castWarnings.map((w) => h('li', null, w.message, w.recovery ? h('span', { class: 'small muted' }, ' → ' + w.recovery) : null))), h('div', { class: 'small muted' }, '다른 캐릭터의 목소리나 이미지로 대체하지 않습니다.'))) : null,
    failedBox,
    vs.render.problems.length ? h('div', { class: 'small muted' }, '렌더 전에 필요한 것: ' + vs.render.problems.map((p) => p.message).join(' / ')) : null,
    h('div', { class: 'vs-actions' },
      h('button', { class: 'btn ghost', type: 'button', 'data-vs-preview': '', disabled: (!r.canRender && !previewAvailable && !shown) || busy, onclick: r.canRender ? render(true) : () => { const player = document.querySelector('[data-vs-player]'); if (player) { player.currentTime = 0; player.play().catch(() => toast('브라우저에서 재생할 수 없습니다. 클립 파일을 확인하세요.', { error: true })); } } }, icon('play'), r.canRender ? '미리보기 렌더 (무료)' : '기존 클립 재생 (무료)'),
      h('button', { class: 'btn sage', type: 'button', 'data-vs-render': '', disabled: !r.canRender || busy, onclick: render(false) }, icon('render'), '최종 렌더'),
      r.lastFinal ? h('a', { class: 'btn', 'data-vs-download': '', href: r.lastFinal.downloadUrl }, icon('download'), '다운로드') : h('button', { class: 'btn', type: 'button', 'data-vs-download': '', disabled: true, title: '최종 렌더가 있어야 합니다' }, icon('download'), '다운로드')),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn sm clay', type: 'button', 'data-vs-gen': '', disabled: busy || !ep.derived.storyboardApproved, title: '비용을 확인한 뒤에만 생성됩니다', onclick: () => startVideo(ep.scenes.filter((s) => !s.clips.approvedVersion).map((s) => s.id)) }, icon('plus'), '영상 생성 (비용 확인)'),
      h('button', { class: 'btn sm clay', type: 'button', 'data-vs-voice': '', disabled: busy || !ep.derived.voice.canRun || ep.derived.voice.cachedLines === ep.derived.voice.lines.length, onclick: startVoice }, icon('plus'), '음성 생성 (비용 확인)')),
    h('details', { class: 'small', 'data-vs-infra': '' }, h('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center;gap:8px' }, h('b', null, '실행 환경'), vs.unavailable.length ? chip(`준비 필요 ${vs.unavailable.length}`, 'attention') : chip('모두 사용 가능', 'done')),
      h('div', { class: 'stack', style: 'gap:8px;margin-top:6px' }, vs.infra.map((x) => h('div', { class: 'vs-infra-row', 'data-infra': x.key }, h('div', { class: 'row', style: 'gap:6px' }, h('b', null, x.label), chip((MODE_CHIP[x.mode] || [x.mode, ''])[0], (MODE_CHIP[x.mode] || [x.mode, ''])[1]), x.available ? chip('사용 가능', 'done') : chip('사용 불가', 'err')), h('div', { class: 'muted' }, `${x.runsOn} — ${x.note}`)))),
      vs.compat ? h('div', { class: 'stack', style: 'gap:2px;margin-top:8px' }, h('b', null, '모델 호환성 (로컬 점검)'), vs.compat.items.map((i) => h('div', { class: i.ok ? 'muted' : '', style: i.ok ? '' : 'color:var(--rose)' }, (i.ok ? '✓ ' : '✗ ') + i.message)), h('div', { class: 'muted' }, vs.compat.note)) : null));
}

function JOB_LABEL(s) { return ({ failed: '실패', download_failed: '다운로드 실패' })[s] || s; }
