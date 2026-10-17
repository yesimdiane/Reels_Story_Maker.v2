// "컷 추가" editor: close-ups / reaction cuts made by CROPPING the scene's approved clip. Free: nothing is generated, no cost.
// An insert replaces a time range of the scene's own shot (scene length, dialogue, subtitles and audio timing never change).
// A crop is a camera move only: it cannot create new eye / face motion (stated in the editor).
import { h, chip, modal, toast, confirmDialog } from '../ui.js';
import { act } from '../state.js';
import { api } from '../api.js';

const FW = 230; // source preview width (9:16)
const FH = Math.round((FW * 16) / 9);
const RW = 150; // result preview width
const RH = Math.round((RW * 16) / 9);
const r1 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fixCrop = (c) => { const scale = clamp(Number(c.scale) || 1.5, 1, 4); const half = 0.5 / scale; return { scale: r1(scale), x: clamp(Number(c.x) || 0.5, half, 1 - half), y: clamp(Number(c.y) || 0.5, half, 1 - half) }; };

export async function openCutEditor(ep, sceneId) {
  const sc = ep.scenes.find((s) => s.id === sceneId);
  if (!sc) return;
  let cfg;
  try { cfg = await api.get('/api/cut-presets'); } catch (e) { return toast(e.message, { error: true }); }
  const info = sc.cutInfo || { source: { kind: 'none' }, inserts: [], warnings: [] };
  const dur = Number(sc.durationSec) || 4;
  const list = (info.inserts || []).map((i) => JSON.parse(JSON.stringify(i)));
  let sel = list.length ? 0 : -1;
  let custom = cfg.custom.slice();
  const body = h('div', { class: 'stack cut-editor', style: 'gap:14px' });

  const frameUrl = (t) => (info.source.kind === 'none' ? '' : `/media/cutframe/${ep.id}/${sceneId}?t=${r1(t)}`);
  const free = () => { const used = list.map((i) => [i.startSec, i.startSec + i.durationSec]).sort((a, b) => a[0] - b[0]); let t = 0.3; used.forEach(([a, b]) => { if (t + 0.8 > a && t < b) t = b + 0.2; }); return r1(Math.min(t, Math.max(0, dur - 0.9))); };
  const addInsert = (preset = 'jack_face') => {
    const p = cfg.builtIn.find((x) => x.key === preset);
    list.push({ id: '', kind: 'insert', preset, label: p.label, transition: p.transition, startSec: free(), durationSec: Math.min(p.durationSec, Math.max(0.3, dur - 0.5)), crop: { ...p.crop }, source: 'clip', effect: 'camera_crop', note: '' });
    sel = list.length - 1;
    draw();
  };
  const applyPreset = (i, p) => { i.preset = p.preset || p.key; i.label = p.name || p.label; i.transition = p.transition; i.durationSec = Math.min(p.durationSec, Math.max(0.2, dur - i.startSec)); i.crop = { ...p.crop }; };
  const warnFor = (i) => {
    const w = [];
    const src = info.source;
    if (src.width && src.height) {
      const ratio = 1080 / (src.width / i.crop.scale);
      if (ratio > 1.05) w.push({ level: ratio > 1.6 ? 'blur' : 'soft', text: `원본(${src.width}×${src.height})에서 ${Math.round(src.width / i.crop.scale)}px 폭만 잘라 1080px로 ${ratio.toFixed(2)}배 확대합니다. ${ratio > 1.6 ? '화면이 뚜렷하게 흐려질 수 있습니다.' : '약간 흐려질 수 있습니다.'}` });
    } else if (info.source.kind === 'clip') w.push({ level: 'unknown', text: '원본 해상도를 알 수 없어 흐림 여부를 계산하지 못했습니다.' });
    return w;
  };

  function timeline() {
    const bar = h('div', { class: 'cut-timeline', title: `장면 ${dur}초 — 컷을 끌어서 옮기고, 양 끝을 끌어서 길이를 바꾸세요` });
    const snap = (v) => Math.round(v * 10) / 10;
    const neighbours = (k) => { const others = list.map((x, n) => ({ x, n })).filter((o) => o.n !== k).sort((a, b) => a.x.startSec - b.x.startSec); const me = list[k]; const prev = others.filter((o) => o.x.startSec + o.x.durationSec <= me.startSec + 0.001).pop(); const next = others.find((o) => o.x.startSec >= me.startSec + me.durationSec - 0.001); return { min: prev ? prev.x.startSec + prev.x.durationSec : 0, max: next ? next.x.startSec : dur }; };
    const place = (seg, i) => { seg.style.left = (i.startSec / dur) * 100 + '%'; seg.style.width = Math.max(2, (i.durationSec / dur) * 100) + '%'; seg.title = `${i.label} ${i.startSec}–${r1(i.startSec + i.durationSec)}초`; };
    list.forEach((i, k) => {
      const seg = h('div', { class: 'cut-seg' + (k === sel ? ' sel' : ''), role: 'button', tabindex: 0, 'data-cut-seg': i.id || 'NEW', style: 'touch-action:none' }, h('span', { class: 'cut-handle left', 'data-handle': 'left' }), h('span', { class: 'cut-seg-label' }, i.id || 'NEW'), h('span', { class: 'cut-handle right', 'data-handle': 'right' }));
      place(seg, i);
      let drag = null;
      seg.addEventListener('pointerdown', (e) => {
        const bw = bar.getBoundingClientRect().width;
        drag = { mode: e.target.dataset.handle || 'move', x0: e.clientX, start: i.startSec, dur: i.durationSec, bw, moved: false, nb: neighbours(k) };
        seg.setPointerCapture(e.pointerId);
      });
      seg.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dt = ((e.clientX - drag.x0) / drag.bw) * dur;
        if (Math.abs(e.clientX - drag.x0) > 3) drag.moved = true;
        if (!drag.moved) return;
        const { min, max } = drag.nb;
        if (drag.mode === 'move') i.startSec = snap(clamp(drag.start + dt, min, Math.max(min, max - drag.dur)));
        else if (drag.mode === 'right') i.durationSec = snap(clamp(drag.dur + dt, cfg.limits.minDur, Math.min(cfg.limits.maxDur, max - drag.start)));
        else { const end = drag.start + drag.dur; const ns = snap(clamp(drag.start + dt, Math.max(min, end - cfg.limits.maxDur), end - cfg.limits.minDur)); i.startSec = ns; i.durationSec = snap(end - ns); }
        place(seg, i);
      });
      const finish = () => { if (!drag) return; const moved = drag.moved; drag = null; sel = k; if (moved || sel !== k) { /* values changed */ } draw(); };
      seg.addEventListener('pointerup', finish);
      seg.addEventListener('pointercancel', finish);
      seg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = k; draw(); } if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const { min, max } = neighbours(k); i.startSec = snap(clamp(i.startSec + (e.key === 'ArrowLeft' ? -0.1 : 0.1), min, Math.max(min, max - i.durationSec))); sel = k; draw(); } });
      bar.append(seg);
    });
    return h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row between small muted' }, h('span', null, `장면 길이 ${dur}초 — 컷은 원래 장면의 일부를 바꿔 끼우며 장면을 늘리지 않습니다. 끌어서 옮기고 양 끝을 끌어 길이를 바꿉니다.`), h('span', null, '0초 ─ ' + dur + '초')), bar);
  }

  function editor(i) {
    const k = sel;
    const mid = clamp(i.startSec + Math.min(i.durationSec / 2, 0.5), 0, dur);
    const url = frameUrl(mid);
    const rect = h('div', { class: 'crop-rect', title: '끌어서 위치 이동' });
    const src = h('div', { class: 'crop-src', style: `width:${FW}px;height:${FH}px;${url ? `background-image:url('${url}')` : ''}` }, url ? rect : h('div', { class: 'small muted', style: 'padding:14px' }, '미리볼 클립/이미지가 없습니다. 위치·배율 값은 그대로 저장되고, 클립이 승인된 뒤 화면으로 확인할 수 있습니다.'), url ? null : rect);
    const res = h('div', { class: 'crop-res', style: `width:${RW}px;height:${RH}px;${url ? `background-image:url('${url}')` : ''}` });
    const readout = h('div', { class: 'small muted mono' });
    const place = () => {
      const c = fixCrop(i.crop); i.crop = { x: Math.round(c.x * 1000) / 1000, y: Math.round(c.y * 1000) / 1000, scale: c.scale };
      rect.style.width = FW / c.scale + 'px'; rect.style.height = FH / c.scale + 'px';
      rect.style.left = (c.x - 0.5 / c.scale) * FW + 'px'; rect.style.top = (c.y - 0.5 / c.scale) * FH + 'px';
      res.style.backgroundSize = `${RW * c.scale}px ${RH * c.scale}px`;
      res.style.backgroundPosition = `${-(c.x * RW * c.scale - RW / 2)}px ${-(c.y * RH * c.scale - RH / 2)}px`;
      readout.textContent = `중심 x ${c.x.toFixed(2)} · y ${c.y.toFixed(2)} · 배율 ×${c.scale.toFixed(2)}`;
    };
    // drag the crop window; click anywhere on the frame to centre it there
    let drag = null;
    const move = (e) => { const b = src.getBoundingClientRect(); i.crop.x = (e.clientX - b.left) / FW; i.crop.y = (e.clientY - b.top) / FH; place(); };
    src.addEventListener('pointerdown', (e) => { drag = true; src.setPointerCapture(e.pointerId); move(e); });
    src.addEventListener('pointermove', (e) => { if (drag) move(e); });
    src.addEventListener('pointerup', () => { drag = null; });
    const scale = h('input', { type: 'range', min: 1, max: 4, step: 0.05, value: i.crop.scale, 'aria-label': '배율', oninput: (e) => { i.crop.scale = Number(e.target.value); place(); warnBox(); } });
    const warnBox = () => {
      const ws = warnFor(i);
      box.replaceChildren(...ws.map((w) => h('div', { class: 'banner ' + (w.level === 'unknown' ? '' : 'warn') }, h('div', null, w.text,
        w.level === 'blur' || w.level === 'soft' ? h('div', { class: 'small', style: 'margin-top:4px' }, '더 선명한 컷이 필요하면 고해상도 이미지를 따로 만들 수 있습니다. 스토리보드에서 비용 확인과 별도 승인을 거치며, 여기서는 아무것도 생성하지 않습니다. ',
          h('label', { class: 'row small', style: 'gap:6px;margin-top:4px' }, h('input', { type: 'checkbox', checked: !!i.hiResRequested, onchange: (e) => { i.hiResRequested = e.target.checked; } }), '이 컷은 고해상도 이미지가 필요함으로 표시'),
          h('a', { href: '#/image/' + ep.id, onclick: () => closeModal() }, '스토리보드로 이동')) : null))));
    };
    const box = h('div', { class: 'stack', style: 'gap:6px' });
    const presetBtns = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, cfg.builtIn.map((p) => h('button', { type: 'button', class: 'btn sm ' + (i.preset === p.key ? '' : 'ghost'), onclick: () => { applyPreset(i, p); draw(); } }, p.label)));
    const saved = custom.length ? h('select', { 'aria-label': '저장한 프리셋', style: 'width:auto', onchange: (e) => { const p = custom.find((x) => x.id === e.target.value); if (p) { applyPreset(i, p); draw(); } } }, h('option', { value: '' }, '저장한 프리셋 불러오기…'), custom.map((p) => h('option', { value: p.id }, `${p.name} (v${p.current})`))) : null;
    const num = (label, key, step, min, max) => h('label', { class: 'field', style: 'margin:0' }, h('span', { class: 'small muted' }, label), h('input', { type: 'number', step, min, max, value: i[key], 'aria-label': label, onchange: (e) => { i[key] = Number(e.target.value); i[key] = r1(clamp(i[key], min, max)); if (key === 'startSec') i.durationSec = r1(Math.min(i.durationSec, Math.max(0.2, dur - i.startSec))); draw(); } }));
    const motion = (cfg.builtIn.find((p) => p.key === i.preset) || {}).face;
    const el = h('div', { class: 'stack', style: 'gap:10px' },
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, h('b', null, `${i.id || '새 컷'} · ${i.label}`), chip('카메라 크롭 · 요금 없음', 'done')),
      presetBtns, saved,
      h('div', { class: 'row', style: 'gap:18px;align-items:flex-start;flex-wrap:wrap' },
        h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'small muted' }, '원본 (끌어서 위치 조정)'), src),
        h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'small muted' }, '컷 결과 미리보기'), res, readout),
        h('div', { class: 'stack', style: 'gap:8px;min-width:210px;flex:1' },
          h('div', { class: 'field', style: 'margin:0' }, h('span', { class: 'small muted' }, '배율 (확대)'), scale),
          h('div', { class: 'row', style: 'gap:10px' }, num('시작 (초)', 'startSec', 0.1, 0, Math.max(0, dur - 0.2)), num('길이 (초)', 'durationSec', 0.1, 0.2, Math.min(4, Math.max(0.2, dur - i.startSec)))),
          h('div', { class: 'small muted' }, `끝 ${r1(i.startSec + i.durationSec)}초 / 장면 ${dur}초`),
          h('div', { class: 'field', style: 'margin:0' }, h('span', { class: 'small muted' }, '전환'),
            h('div', { class: 'stack', style: 'gap:4px' }, Object.entries(cfg.transitions).map(([key, t]) => h('label', { class: 'row small', style: 'gap:6px;align-items:flex-start' }, h('input', { type: 'radio', name: 'tr' + k, checked: i.transition === key, onchange: () => { i.transition = key; } }), h('span', null, h('b', null, t.label), ' — ', t.note)))))
        )),
      box,
      h('div', { class: 'banner' }, h('div', null, h('b', null, '카메라 크롭입니다. '), '원본 영상에 이미 있는 움직임만 확대해서 보여줍니다. ', motion ? h('span', null, '눈동자·표정의 새로운 움직임은 크롭으로 만들 수 없습니다. 그런 연기가 필요하면 별도의 AI 영상 생성(유료, 비용 확인과 승인 필요)이 따로 필요합니다.') : null)),
      h('label', { class: 'field', style: 'margin:0' }, h('span', { class: 'small muted' }, '메모 (선택)'), h('input', { type: 'text', value: i.note || '', maxLength: 300, placeholder: '예: 잭이 시큰둥하게 쳐다보는 컷', oninput: (e) => { i.note = e.target.value; } })),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', { type: 'button', class: 'btn sm ghost', onclick: async () => { const name = prompt('프리셋 이름 (다른 에피소드에서도 쓸 수 있습니다)', i.label); if (!name) return; try { const p = await api.post('/api/cut-presets', { name, preset: i.preset, transition: i.transition, durationSec: i.durationSec, crop: i.crop }); custom = (await api.get('/api/cut-presets')).custom; toast(`프리셋 "${p.name}" 저장 (v${p.current})`); draw(); } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); } } }, '프리셋으로 저장'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: () => { list.splice(k, 1); sel = list.length ? Math.min(k, list.length - 1) : -1; draw(); } }, '이 컷 삭제')));
    place();
    warnBox();
    return el;
  }

  function draw() {
    body.replaceChildren(...[
      h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' }, h('div', null, h('div', { class: 'eyebrow' }, `${sceneId} · 컷 추가`), h('h2', { style: 'margin:0' }, sc.title_ko || sceneId)), h('div', { class: 'row' }, chip('원본 영상을 잘라서 만듭니다 · 새 AI 영상 없음 · 요금 없음', 'done'))),
      info.source.kind === 'none' ? h('div', { class: 'banner warn' }, h('div', null, '이 장면에는 아직 클립이나 시작 이미지가 없어 화면 미리보기를 볼 수 없습니다. 컷은 승인된 클립에서만 렌더링됩니다.')) : info.source.kind === 'start_image' ? h('div', { class: 'banner' }, h('div', null, '아직 클립이 없어 시작 이미지로 미리보기합니다. 렌더링은 승인된 클립에서 잘라냅니다.')) : null,
      timeline(),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, list.map((i, k) => h('button', { type: 'button', class: 'btn sm ' + (k === sel ? '' : 'ghost'), onclick: () => { sel = k; draw(); } }, `${i.id || 'NEW'} ${i.label}`)), h('button', { type: 'button', class: 'btn sm clay', disabled: list.length >= cfg.limits.maxInserts, onclick: () => addInsert() }, '+ 컷 추가')),
      sel >= 0 ? editor(list[sel]) : h('div', { class: 'muted small' }, '컷이 없습니다. "+ 컷 추가"를 눌러 클로즈업이나 리액션 컷을 넣으세요. 컷은 이 장면의 대사·자막·오디오 타이밍을 바꾸지 않습니다.'),
      h('div', { class: 'small muted' }, '저장하면 이 장면의 새 버전이 기록되고, 이 장면을 다시 검토·승인해야 합니다 (이전 승인본은 보관됩니다).'),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => closeModal() }, '닫기'), h('button', { type: 'button', class: 'btn sage', 'data-cut-save': sceneId, onclick: save }, '저장'))].filter(Boolean));
  }
  async function save() {
    const r = await act(() => api.put(`/api/episodes/${ep.id}/scenes/${sceneId}/inserts`, { inserts: list.map((i) => ({ ...i, crop: fixCrop(i.crop) })) }), { ok: '컷을 저장했습니다 (이 장면은 다시 승인해야 합니다)' });
    if (r) { (r.cutWarnings || []).slice(0, 3).forEach((w) => toast(w.message, { ms: 7000 })); closeModal(); }
  }
  let closeModal = () => {};
  closeModal = modal(() => { draw(); return body; }, { wide: true });
}
