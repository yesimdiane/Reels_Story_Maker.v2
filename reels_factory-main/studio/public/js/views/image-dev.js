// Image Development workspace card (top of the Storyboard page): what was carried over from the approved script.
// Creating or opening it never generates anything; image generation keeps its own cost review + approval.
import { h, chip } from '../ui.js';

const STATUS = { missing: ['없음', 'err'], unapproved: ['승인 대기', 'attention'], approved: ['승인됨', 'done'], ok: ['준비됨', 'done'] };
const when = (iso) => { try { return new Date(iso).toLocaleString('ko-KR'); } catch (_) { return iso || ''; } };

export function imageDevCard(ep) {
  const iv = ep.imageDev;
  const ho = ep.derived.handoff;
  if (!iv) {
    return h('div', { class: 'banner mock', 'data-image-dev': 'none' }, h('div', null, h('b', null, '이미지 디벨롭 작업공간이 아직 없습니다'), ' 대본의 모든 씬과 대본 전체를 승인한 뒤 Script Studio에서 "대본 승인 완료 → 이미지 디벨롭으로 이동"을 누르세요. ', h('a', { href: '#/script/' + ep.id }, 'Script Studio로 이동')));
  }
  const rows = Object.values(iv.scenes);
  const sceneTitle = (sid) => ((ep.scenes.find((s) => s.id === sid) || {}).title_ko) || iv.scenes[sid].title_ko;
  return h('div', { class: 'card stack', style: 'gap:12px', 'data-image-dev': ep.id },
    h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' },
      h('div', null, h('div', { class: 'eyebrow' }, '이미지 디벨롭 · ' + iv.workspaceId), h('h3', null, '승인된 대본에서 넘어온 작업공간')),
      h('div', { class: 'row' }, ho.current ? chip('승인된 대본과 일치', 'done') : chip('대본이 바뀜 — 다시 승인 후 이동 필요', 'attention'), chip(`스냅샷 v${iv.snapshot.scriptVersion}`, ''))),
    h('div', { class: 'small muted' }, `스냅샷: ${iv.snapshot.file} · ${when(iv.snapshot.at)} · 변경 불가(저장 후 수정되지 않음) · sha256 ${iv.snapshot.sha256.slice(0, 12)}…`),
    h('div', { class: 'banner ok' }, iv.paidGeneration.note),
    h('div', { class: 'stack', style: 'gap:8px' }, rows.map((r) => h('div', { class: 'scene-version' },
      h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:6px' }, h('b', null, `${r.sceneId} · ${sceneTitle(r.sceneId)}`), h('span', { class: 'small muted' }, `${r.durationSec}초 · 대사 ${r.lineIds.length}개 · 씬 r${r.sceneRevision || '-'}${r.changedSinceLastHandoff ? ' · 지난 이동 이후 변경됨' : ''}`)),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-top:4px' }, r.requiredAssets.map((a) => { const [t, k] = STATUS[a.status] || [a.status, '']; return chip(`${a.label}: ${t}`, k); }))))));
}
