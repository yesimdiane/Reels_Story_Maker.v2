// Settings → 엔딩 템플릿: the reusable three-shot product ending ("Jack & Diane — Coupang Ending v1" by default).
// Only the content of the three fixed shots can be edited; their number and order are fixed by the application.
import { h, chip, icon, toast, modal, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { asyncBlock } from './common.js';

const KEYS = ['shopping_excuse', 'product_demonstration', 'jack_reaction'];
const KO = { shopping_excuse: '컷 1 · 다이앤의 쇼핑 핑계', product_demonstration: '컷 2 · 제품 시연', jack_reaction: '컷 3 · 잭의 한결같은 반응' };

export function endingManager() {
  const ui = state.endingUi || (state.endingUi = { id: null, note: '', drafts: {} });
  return asyncBlock(() => api.get('/api/ending-templates'), (list) => draw(list));

  function draw(list) {
    const id = list.templates.some((t) => t.id === ui.id) ? ui.id : list.activeTemplateId;
    ui.id = id;
    const rerender = () => import('../state.js').then(({ hooks }) => hooks.rerender());
    const call = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return null; } };
    const wrap = h('div', { class: 'stack', style: 'gap:18px' });
    wrap.append(h('div', { class: 'banner' }, icon('lock'), h('div', null, h('b', null, '모든 에피소드가 같은 3컷으로 끝납니다. '), '여기서 각 컷의 템플릿(연출·대사·구도)을 고치고 새 버전으로 저장합니다. 컷 수와 순서(쇼핑 핑계 → 제품 시연 → 잭의 반응)는 고정입니다. {{PRODUCT_NAME}} 같은 자리표시자는 에피소드마다 제품별 값으로 채워집니다. 새 에피소드에는 "기본" 템플릿이 자동으로 적용되고, 저장한 버전은 서버의 영구 저장소(/data 볼륨)에 남아 재배포 후에도 유지됩니다. 이미 만든 에피소드는 바뀌지 않습니다.')));
    const sel = h('select', { 'aria-label': '템플릿 선택', style: 'width:auto', onchange: (e) => { ui.id = e.target.value; rerender(); } }, list.templates.map((t) => h('option', { value: t.id, selected: t.id === id }, t.name + (t.active ? ' ★기본' : ''))));
    const cur = list.templates.find((t) => t.id === id);
    wrap.append(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, h('label', { class: 'row small', style: 'gap:6px' }, '템플릿', sel),
      h('button', { class: 'btn sm ghost', onclick: async () => { const name = prompt('복제본 이름 (비워 두면 자동)', ''); if (name === null) return; const r = await call(() => api.post(`/api/ending-templates/${id}/duplicate`, { name }), '복제했습니다'); if (r) { ui.id = r.id; rerender(); } } }, '템플릿 복제'),
      h('button', { class: 'btn sm ghost', disabled: cur.active, onclick: async () => { await call(() => api.put('/api/ending-templates/active', { templateId: id }), '새 에피소드의 기본 엔딩으로 지정했습니다'); rerender(); } }, '새 에피소드 기본값으로 지정')));
    wrap.append(asyncBlock(() => api.get('/api/ending-templates/' + id), (t) => editor(t, list, rerender, call)));
    return wrap;
  }

  function editor(t, list, rerender, call) {
    const key = t.id + ':' + t.current;
    const f = ui.drafts[key] || (ui.drafts[key] = { name: t.name, structureLocked: t.structureLocked, shots: JSON.parse(JSON.stringify(t.shots)) });
    const dirty = () => JSON.stringify(f.shots) !== JSON.stringify(t.shots) || f.name !== t.name || f.structureLocked !== t.structureLocked;
    const box = h('div', { class: 'stack', style: 'gap:16px' });
    box.append(h('div', { class: 'card stack', style: 'gap:12px' },
      h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, t.builtIn ? '기본 제공 템플릿' : '사용자 템플릿'), h('h2', { style: 'margin:0' }, t.name)), h('div', { class: 'row' }, chip('현재 v' + t.current, 'done'), t.active ? chip('기본', 'done') : null)),
      h('div', { class: 'field' }, h('label', null, '템플릿 이름'), h('input', { type: 'text', value: f.name, oninput: (e) => (f.name = e.target.value) })),
      h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', checked: f.structureLocked, onchange: (e) => (f.structureLocked = e.target.checked) }), '🔒 엔딩 구조 잠금 — 켜 두면 에피소드에서 엔딩 컷을 추가·삭제·순서 변경할 수 없고, 제품별 내용(대사·연출)만 고칠 수 있습니다.'),
      h('div', { class: 'small muted' }, '자리표시자: ' + list.vars.map((v) => `{{${v.key}}} = ${v.label}`).join(' · '))));
    KEYS.forEach((k) => {
      const sh = f.shots[k];
      const lines = h('div', { class: 'stack', style: 'gap:8px' });
      const drawLines = () => lines.replaceChildren(...sh.lines.map((l, i) => h('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start;gap:8px' },
        h('select', { 'aria-label': '화자', style: 'width:96px', onchange: (e) => (l.speaker = e.target.value) }, ['diane', 'jack'].map((c) => h('option', { value: c, selected: l.speaker === c }, c))),
        h('textarea', { rows: 2, lang: 'en', 'aria-label': 'English dialogue', style: 'flex:1', oninput: (e) => (l.en = e.target.value) }, l.en),
        h('textarea', { rows: 2, lang: 'ko', 'aria-label': '한국어 자막', style: 'flex:1', oninput: (e) => (l.ko = e.target.value) }, l.ko),
        h('button', { class: 'btn icon danger', 'aria-label': '대사 삭제', disabled: sh.lines.length <= 1, onclick: () => { sh.lines.splice(i, 1); drawLines(); } }, icon('trash')))));
      drawLines();
      box.append(h('div', { class: 'card stack', style: 'gap:12px;border-left:4px solid var(--sage-deep,#5f7a5a)' },
        h('div', { class: 'row between' }, h('h3', { style: 'margin:0' }, KO[k]), chip('고정 슬롯', 'done')),
        h('div', { class: 'grid two' },
          h('div', { class: 'field' }, h('label', null, '컷 제목 (한국어)'), h('input', { type: 'text', value: sh.title_ko, maxLength: 24, lang: 'ko', oninput: (e) => (sh.title_ko = e.target.value) })),
          h('div', { class: 'field' }, h('label', null, '길이 (초)'), h('input', { type: 'number', min: 1, max: 15, step: 0.5, value: sh.durationSec, oninput: (e) => (sh.durationSec = Number(e.target.value)) }))),
        h('div', { class: 'field' }, h('label', null, '컷 설명 (English)'), h('textarea', { rows: 2, lang: 'en', oninput: (e) => (sh.story_en = e.target.value) }, sh.story_en)),
        h('div', { class: 'grid two' },
          h('div', { class: 'field' }, h('label', null, '비주얼 방향'), h('textarea', { rows: 3, oninput: (e) => (sh.visual = e.target.value) }, sh.visual)),
          h('div', { class: 'field' }, h('label', null, '캐릭터 행동'), h('textarea', { rows: 3, oninput: (e) => (sh.action = e.target.value) }, sh.action))),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, '등장'), ['diane', 'jack'].map((c) => h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: sh.characters.includes(c), onchange: (e) => { sh.characters = e.target.checked ? [...new Set([...sh.characters, c])] : sh.characters.filter((x) => x !== c); } }), c)),
          h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: sh.showsProduct, onchange: (e) => (sh.showsProduct = e.target.checked) }), '제품이 보임')),
        h('div', { class: 'field' }, h('label', null, '대사 / 자막 (자리표시자 사용 가능)'), lines),
        h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => { sh.lines.push({ speaker: 'diane', en: '', ko: '' }); drawLines(); } }, icon('plus'), '대사 추가'))));
    });
    box.append(h('div', { class: 'card stack', style: 'gap:10px' },
      h('div', { class: 'field' }, h('label', null, '변경 메모 (선택)'), h('input', { type: 'text', value: ui.note, oninput: (e) => (ui.note = e.target.value) })),
      h('div', { class: 'row end' },
        t.builtIn ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: '원래 기본값으로 복원할까요?', body: '새 버전으로 저장됩니다. 지금까지의 버전과 이미 만든 에피소드는 그대로입니다.', confirm: '복원' })) { delete ui.drafts[key]; await call(() => api.post(`/api/ending-templates/${t.id}/restore`, { toDefault: true }), '기본값을 새 버전으로 복원했습니다'); rerender(); } } }, '기본값 복원') : null,
        h('button', { class: 'btn', onclick: async () => { if (!dirty()) return toast('바뀐 내용이 없습니다'); const r = await call(() => api.put('/api/ending-templates/' + t.id, { shots: f.shots, structureLocked: f.structureLocked, name: f.name, note: ui.note })); if (r) { delete ui.drafts[key]; ui.note = ''; toast(`v${r.current}로 저장했습니다 (새 에피소드부터 적용 · 기존 에피소드는 그대로)`); rerender(); } } }, '새 버전으로 저장'))));
    box.append(h('div', { class: 'card stack', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, '버전 기록'),
      h('div', { class: 'list' }, t.versions.slice().reverse().map((v) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `v${v.v}` + (v.v === t.current ? ' (현재)' : '') + (v.default ? ' · 기본값' : '')), h('div', { class: 'small muted' }, `${new Date(v.at).toLocaleString('ko-KR')} · ${v.by}${v.note ? ' · ' + v.note : ''}`)),
        h('button', { class: 'btn sm ghost', onclick: async () => { const r = await call(() => api.get(`/api/ending-templates/${t.id}/versions/${v.v}`)); if (r) modal((close) => h('div', { class: 'stack' }, h('h2', null, `${t.name} v${v.v}`), KEYS.map((k) => h('div', { class: 'stack', style: 'gap:2px' }, h('b', { class: 'small' }, KO[k] + ' · ' + r.shots[k].title_ko), r.shots[k].lines.map((l) => h('div', { class: 'small mono' }, `${l.speaker}: ${l.en} / ${l.ko}`)))), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, '닫기'))), { wide: true }); } }, '보기'),
        v.v === t.current ? null : h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDialog({ title: `v${v.v}로 복원할까요?`, body: '새 버전으로 저장됩니다. 기록은 지워지지 않습니다.', confirm: '복원' })) { delete ui.drafts[key]; await call(() => api.post(`/api/ending-templates/${t.id}/restore`, { version: v.v }), `v${v.v}를 새 버전으로 복원했습니다`); rerender(); } } }, '복원'))))));
    return box;
  }
}
