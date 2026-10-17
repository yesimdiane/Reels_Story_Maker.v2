// "Big picture" of the episode + drag & drop scene order.
//   PART A: the six story beats as columns; drag a scene chip within a beat or into another beat (every beat keeps at least one scene).
//   PART B: the fixed three-shot product ending is not draggable; it shows the approved product reference images instead.
// Moving scenes saves the new order right away (a dedicated, small request); unsaved text edits must be saved first.
import { h, chip, toast } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';

const short = (t, n = 12) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function structureMap(ep, { dirty }) {
  const F = ep.formula;
  const root = h('div', { class: 'card structure-map stack', style: 'gap:10px', 'data-structure-map': ep.id },
    h('div', { class: 'card-head', style: 'margin-bottom:0' }, h('div', null, h('div', { class: 'eyebrow' }, '스토리 구조'), h('h3', null, '장면 순서 (드래그해서 바꾸기)')), h('span', { class: 'small muted' }, '장면 칩을 끌어 놓으면 순서와 단계가 바뀝니다')));

  const sceneOf = (id) => ep.scenes.find((s) => s.id === id);
  const chipFor = (sc) => {
    const ap = sc.approval || {};
    const el = h('div', { class: 'scene-chip' + (ap.approved ? ' approved' : '') + (ap.errorCount ? ' has-err' : ''), draggable: 'true', 'data-scene': sc.id, title: `${sc.id} · ${sc.title_ko || ''}${ap.label ? ' · ' + ap.label : ''}` },
      h('b', null, sc.id), ' ', short(sc.title_ko), ap.approved ? h('span', { class: 'tab-badge ok' }, '✓') : ap.errorCount ? h('span', { class: 'tab-badge err' }, String(ap.errorCount)) : null);
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', sc.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('click', () => { const b = document.getElementById('script-scene-' + sc.id); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    return el;
  };

  async function send(body) {
    if (dirty && dirty()) { toast('저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 순서를 바꾸세요.', { error: true }); return; }
    state.draft.script = null;
    await act(() => api.post(`/api/episodes/${ep.id}/scenes/reorder`, body), { ok: '장면 순서를 바꿨습니다 (대본 승인은 다시 필요합니다)' });
  }
  /** Insert position inside a drop zone: before the first chip whose centre is after the pointer. */
  const indexAt = (zone, e, movingId) => {
    const chips = Array.from(zone.querySelectorAll('.scene-chip')).filter((c) => c.dataset.scene !== movingId);
    const i = chips.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2); });
    return i < 0 ? chips.length : i;
  };
  function zone(key, ids) {
    const z = h('div', { class: 'drop-zone', 'data-beat': key || 'all' }, ids.map((id) => chipFor(sceneOf(id))));
    z.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => {
      e.preventDefault();
      z.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if (!sceneOf(id)) return;
      if (F.structured) {
        if (sceneOf(id).part === 'B') return toast('고정 엔딩 컷은 옮길 수 없습니다.', { error: true });
        const srcKey = sceneOf(id).beatKey;
        const beats = Object.fromEntries(F.partA.map((b) => [b.key, b.sceneIds.slice()]));
        const idx = indexAt(z, e, id);
        const targetChip = e.target.closest && e.target.closest('.scene-chip');
        const targetId = targetChip ? targetChip.dataset.scene : (beats[key].filter((x) => x !== id)[Math.min(idx, beats[key].filter((x) => x !== id).length - 1)] || '');
        // the only scene of a beat dropped onto another scene: swap the two (a beat can never be left empty)
        if (key !== srcKey && beats[srcKey].length === 1 && targetId && targetId !== id) {
          const ti = beats[key].indexOf(targetId);
          beats[key][ti] = id;
          beats[srcKey] = [targetId];
          send({ beats });
          return;
        }
        beats[srcKey] = beats[srcKey].filter((x) => x !== id);
        beats[key] = beats[key].filter((x) => x !== id);
        beats[key].splice(idx, 0, id);
        send({ beats });
      } else {
        const order = ep.scenes.map((s) => s.id).filter((x) => x !== id);
        order.splice(indexAt(z, e, id), 0, id);
        send({ order });
      }
    });
    return z;
  }

  if (F.structured) {
    root.append(h('div', { class: 'eyebrow' }, 'PART A — 이번 에피소드 이야기'));
    root.append(h('div', { class: 'beat-columns' }, F.partA.map((b) => h('div', { class: 'beat-col' }, h('div', { class: 'beat-title' }, h('b', null, b.label), h('span', { class: 'small muted' }, ' ' + b.labelEn)), zone(b.key, b.sceneIds)))));
    const imgs = (ep.productRefImages && ep.productRefImages.length ? ep.productRefImages : (ep.productStudioImages || []).filter((i) => i.status === 'approved'));
    root.append(h('div', { class: 'eyebrow', style: 'margin-top:4px' }, 'PART B — 고정 제품 엔딩 (' + F.partB.map((b) => b.sceneIds.join('·')).join(' / ') + ')'));
    root.append(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' },
      imgs.length ? imgs.map((im) => h('img', { class: 'ref-thumb', src: im.url, alt: im.label || '제품 참조 이미지', title: im.label || '' })) : h('span', { class: 'small muted' }, '승인된 제품 참조 이미지가 없습니다. ', h('a', { href: '#/products' }, '제품 스튜디오에서 승인하세요')),
      chip('드래그 불가 (고정)', 'done')));
  } else {
    root.append(h('div', { class: 'beat-columns single' }, h('div', { class: 'beat-col' }, h('div', { class: 'beat-title' }, h('b', null, '장면 순서')), zone(null, ep.scenes.map((s) => s.id)))));
  }
  return root;
}
