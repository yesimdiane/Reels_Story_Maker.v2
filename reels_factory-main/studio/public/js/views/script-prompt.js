// AI 프롬프트 관리: editable script-writing presets (Settings) and the per-episode preset picker / prompt viewer / Test Prompt (Script Studio).
// Only the creative instructions are editable here. The application constraints (JSON schema, Korean scene titles, verified claims,
// CTA rules, approvals, cost confirmation) are added by the server after this text and are shown read-only.
import { h, chip, icon, toast, modal, confirmDialog } from '../ui.js';
import { state, act } from '../state.js';
import { api } from '../api.js';
import { asyncBlock, confirmPaid } from './common.js';

const LEVELS = [[1, '1 · 잔잔'], [2, '2 · 기본'], [3, '3 · 고에너지']];

function lockedCard(locked) {
  return h('div', { class: 'card stack', style: 'gap:8px;background:var(--sage-wash, #eef2ea)' },
    h('div', { class: 'row' }, icon('lock'), h('h3', { style: 'margin:0' }, '수정할 수 없는 시스템 제약 (애플리케이션 코드가 항상 적용)')),
    h('div', { class: 'small muted' }, '출력 형식(JSON), 한국어 장면 제목(title_ko) 필수, 확인된 제품 사실만 사용, CTA 규칙, 유료 생성 승인, 승인·버전 관리는 프롬프트를 어떻게 고쳐도 항상 지켜집니다. 아래 문구는 편집 가능한 프롬프트 뒤에 자동으로 붙습니다.'),
    h('pre', { class: 'mono small', style: 'white-space:pre-wrap;margin:0;max-height:260px;overflow:auto;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--paper, #fff)' }, locked));
}

/** Modal: the full effective prompt, split into the editable part, the input data and the locked constraints. */
export function showEffectivePrompt(r) {
  const m = r.meta;
  modal((close) => h('div', { class: 'stack' },
    h('h2', null, '실제로 전송되는 전체 프롬프트'),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, chip(`${m.presetName} v${m.presetVersion}${m.pinned ? ' (고정)' : ' (최신)'}`, 'done'), chip('코미디 강도 ' + m.comedyLevel, ''), chip(`${r.chars.toLocaleString()}자 · 해시 ${m.promptHash}`, 'mock')),
    block('① 편집 가능한 창작 지침 (프리셋)', r.parts.editable, false),
    block('② 입력 데이터 (승인된 컨셉 · 확인된 제품 사실 · 캐릭터)', r.parts.data, false),
    block('③ 수정할 수 없는 시스템 제약 (코드)', r.parts.locked, true),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => navigator.clipboard && navigator.clipboard.writeText(r.full).then(() => toast('복사했습니다')) }, '전체 복사'), h('button', { class: 'btn', onclick: close }, '닫기'))), { wide: true });
  function block(title, text, locked) {
    return h('div', { class: 'stack', style: 'gap:4px' }, h('b', { class: 'small' }, (locked ? '🔒 ' : '') + title),
      h('pre', { class: 'mono small', style: 'white-space:pre-wrap;margin:0;max-height:240px;overflow:auto;padding:10px;border:1px solid var(--line);border-radius:10px;' + (locked ? 'background:var(--sage-wash,#eef2ea)' : '') }, text));
  }
}

/** Settings → AI 프롬프트 관리 */
export function presetManager() {
  const ui = state.presetUi || (state.presetUi = { id: null, note: '', drafts: {} });
  return asyncBlock(() => api.get('/api/script-presets'), (list) => draw(list));

  function draw(list) {
    const id = list.presets.some((p) => p.id === ui.id) ? ui.id : list.activePresetId;
    ui.id = id;
    const wrap = h('div', { class: 'stack', style: 'gap:18px' });
    const rerender = () => import('../state.js').then(({ hooks }) => hooks.rerender());
    const call = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return null; } };
    wrap.append(h('div', { class: 'banner' }, icon('lock'), h('div', null, h('b', null, 'Script Studio가 대본을 쓸 때 쓰는 창작 지침을 여기서 직접 고칩니다. '), '저장하면 새 버전이 생기고(이전 버전은 그대로 보존), 에피소드마다 프리셋과 버전을 골라 쓸 수 있습니다. 이미 만든 대본과 승인된 대본은 바뀌지 않습니다. 프롬프트는 서버의 영구 저장소(/data 볼륨)에 저장되어 재시작·재배포 후에도 유지됩니다.')));
    const sel = h('select', { 'aria-label': '프리셋 선택', style: 'width:auto', onchange: (e) => { ui.id = e.target.value; rerender(); } }, list.presets.map((p) => h('option', { value: p.id, selected: p.id === id }, p.name + (p.active ? ' ★기본' : ''))));
    wrap.append(h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, h('label', { class: 'row small', style: 'gap:6px' }, '프리셋', sel),
      h('button', { class: 'btn sm ghost', onclick: async () => { const name = prompt('복제본 이름 (비워 두면 자동)', ''); if (name === null) return; const r = await call(() => api.post(`/api/script-presets/${id}/duplicate`, { name }), '복제했습니다'); if (r) { ui.id = r.id; rerender(); } } }, '프리셋 복제'),
      h('button', { class: 'btn sm ghost', disabled: list.presets.find((p) => p.id === id).active, onclick: async () => { await call(() => api.put('/api/script-presets/active', { presetId: id }), '새 에피소드의 기본 프리셋으로 지정했습니다'); rerender(); } }, '기본 프리셋으로 지정')));
    wrap.append(asyncBlock(() => api.get('/api/script-presets/' + id), (p) => editor(p, list, rerender, call)));
    return wrap;
  }

  function editor(p, list, rerender, call) {
    const box = h('div', { class: 'stack', style: 'gap:16px' });
    const draftKey = p.id + ':' + p.current;
    const f = ui.drafts[draftKey] || (ui.drafts[draftKey] = Object.assign({}, p.sections));
    let name = p.name;
    const dirty = () => Object.keys(f).some((k) => f[k] !== p.sections[k]) || name !== p.name;
    box.append(h('div', { class: 'card stack', style: 'gap:12px' },
      h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, p.builtIn ? '기본 제공 프리셋' : '사용자 프리셋'), h('h2', { style: 'margin:0' }, p.name)), h('div', { class: 'row' }, chip('현재 v' + p.current, 'done'), p.active ? chip('기본', 'done') : null)),
      p.description ? h('div', { class: 'small muted' }, p.description) : null,
      h('div', { class: 'field' }, h('label', null, '프리셋 이름'), h('input', { type: 'text', value: name, oninput: (e) => (name = e.target.value) })),
      p.sectionInfo.map((s) => h('div', { class: 'field' }, h('label', null, s.label, h('span', { class: 'small muted' }, ' — ' + s.help)),
        h('textarea', { rows: s.key.startsWith('comedyLevel') ? 4 : 7, spellcheck: 'false', style: 'font-family:var(--mono);font-size:12.5px', 'aria-label': s.label, oninput: (e) => (f[s.key] = e.target.value) }, f[s.key]))),
      h('div', { class: 'field' }, h('label', null, '변경 메모 (선택)'), h('input', { type: 'text', value: ui.note, placeholder: '예: 코미디 강도 3을 더 과장되게', oninput: (e) => (ui.note = e.target.value) })),
      h('div', { class: 'row end' },
        p.builtIn ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: '원래 기본값으로 복원할까요?', body: '새 버전으로 저장됩니다. 지금까지의 버전과 이미 만든 대본은 그대로 남습니다.', confirm: '복원' })) { delete ui.drafts[draftKey]; await call(() => api.post(`/api/script-presets/${p.id}/restore`, { toDefault: true }), '기본값을 새 버전으로 복원했습니다'); rerender(); } } }, '기본값 복원') : null,
        h('button', { class: 'btn', onclick: async () => { if (!dirty()) return toast('바뀐 내용이 없습니다'); const r = await call(() => api.put('/api/script-presets/' + p.id, { sections: f, name, note: ui.note }), null); if (r) { delete ui.drafts[draftKey]; ui.note = ''; toast(`v${r.current}로 저장했습니다 (새 대본부터 적용 · 기존 대본은 그대로)`); rerender(); } } }, '새 버전으로 저장'))));
    box.append(lockedCard(list.locked));
    box.append(h('div', { class: 'card stack', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, '버전 기록'),
      h('div', { class: 'list' }, p.versions.slice().reverse().map((v) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `v${v.v}` + (v.v === p.current ? ' (현재)' : '') + (v.default ? ' · 기본값' : '')), h('div', { class: 'small muted' }, `${new Date(v.at).toLocaleString('ko-KR')} · ${v.by}${v.note ? ' · ' + v.note : ''}`)),
        h('button', { class: 'btn sm ghost', onclick: async () => { const r = await call(() => api.get(`/api/script-presets/${p.id}/versions/${v.v}`)); if (r) modal((close) => h('div', { class: 'stack' }, h('h2', null, `${p.name} v${v.v}`), p.sectionInfo.map((s) => h('div', { class: 'stack', style: 'gap:2px' }, h('b', { class: 'small' }, s.label), h('pre', { class: 'mono small', style: 'white-space:pre-wrap;margin:0' }, r.sections[s.key]))), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, '닫기'))), { wide: true }); } }, '보기'),
        v.v === p.current ? null : h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDialog({ title: `v${v.v}로 복원할까요?`, body: '새 버전으로 저장됩니다. 기록은 지워지지 않습니다.', confirm: '복원' })) { delete ui.drafts[draftKey]; await call(() => api.post(`/api/script-presets/${p.id}/restore`, { version: v.v }), `v${v.v}를 새 버전으로 복원했습니다`); rerender(); } } }, '복원'))))));
    // effective prompt preview for a chosen episode
    const eps = (state.summary.episodes || []).filter((e) => e.concept && e.concept.linked);
    let epId = state.episodeId && eps.some((e) => e.id === state.episodeId) ? state.episodeId : eps[0] && eps[0].id;
    let level = 2;
    box.append(h('div', { class: 'card stack', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, '전체 프롬프트 미리보기'),
      h('div', { class: 'small muted' }, '저장된 현재 버전과 선택한 에피소드의 컨셉·제품 사실을 합친, 실제로 전송될 전체 프롬프트를 봅니다. 비용이 들지 않습니다.'),
      eps.length ? h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' },
        h('select', { 'aria-label': '에피소드', style: 'width:auto', onchange: (e) => (epId = e.target.value) }, eps.map((e) => h('option', { value: e.id, selected: e.id === epId }, e.id + ' · ' + e.title))),
        h('select', { 'aria-label': '코미디 강도', style: 'width:auto', onchange: (e) => (level = Number(e.target.value)) }, LEVELS.map(([k, l]) => h('option', { value: k, selected: k === level }, '코미디 강도 ' + l))),
        h('button', { class: 'btn sm', onclick: async () => { const r = await call(() => api.post(`/api/episodes/${epId}/script/prompt`, { preset: { presetId: p.id, comedyLevel: level } })); if (r) showEffectivePrompt(r); } }, '전체 프롬프트 보기'))
        : h('div', { class: 'small muted' }, '컨셉이 승인된 에피소드가 생기면 미리볼 수 있습니다.')));
    return box;
  }
}

/** Script Studio: which preset/version/intensity the NEXT generation uses, the full prompt, and Test Prompt. */
export function presetPanel(ep) {
  return asyncBlock(() => Promise.all([api.get('/api/script-presets'), api.get(`/api/episodes/${ep.id}/script/tests`)]), ([list, tests]) => draw(list, tests.tests), { label: '프롬프트 프리셋 불러오는 중…' });

  function draw(list, tests) {
    const cur = ep.promptPreset || {};
    const sel = { presetId: cur.presetId || list.activePresetId, version: cur.version || null, comedyLevel: cur.comedyLevel || 2 };
    if (!list.presets.some((p) => p.id === sel.presetId)) sel.presetId = list.activePresetId;
    const preset = list.presets.find((p) => p.id === sel.presetId);
    const src = ep.scriptSource;
    const call = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, { error: true, recovery: e.recovery }); return null; } };
    const save = async (patch) => { Object.assign(sel, patch); if (patch.presetId) sel.version = null; await act(async () => { await api.put(`/api/episodes/${ep.id}/script/preset`, sel); return null; }, { ok: '다음 대본 생성에 쓸 프롬프트를 선택했습니다 (기존 대본은 그대로)' }); };
    const route = (state.summary.ai.routing || []).find((r) => r.task === 'scriptWriting') || { provider: 'mock' };
    const testIt = async () => {
      let est;
      try { est = await api.post(`/api/episodes/${ep.id}/script/estimate`, { preset: sel }); } catch (e) { return toast(e.message, { error: true, recovery: e.recovery }); }
      const c = await confirmPaid({ title: '프롬프트 테스트 (새 초안 생성 · 유료일 수 있음)', est, confirmLabel: '테스트 실행', body: h('p', { class: 'small muted', style: 'margin:0' }, `${preset.name} · ${sel.version ? 'v' + sel.version : '최신 v' + preset.current} · 코미디 강도 ${sel.comedyLevel}. 결과는 "테스트 초안"으로만 저장되고 현재 대본·승인·버전은 바뀌지 않습니다.`) });
      if (c === null) return;
      const r = await call(() => api.post(`/api/episodes/${ep.id}/script/test`, { preset: sel, confirm: c }));
      if (r) { showTest(r); await act(async () => null); }
    };
    return h('div', { class: 'card stack', style: 'gap:10px' },
      h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'AI 프롬프트'), h('h3', { style: 'margin:0' }, '대본 생성에 쓸 프롬프트')), chip(`${preset.name} · 강도 ${sel.comedyLevel}`, ''), h('a', { class: 'small', href: '#/settings', onclick: () => { state.settingsTab = 'scriptprompts'; } }, '프롬프트 편집 (설정 → AI 프롬프트 관리)')),
      src ? h('div', { class: 'small' }, h('b', null, '현재 대본을 만든 프롬프트: '), src.presetId ? `${src.presetName} v${src.presetVersion} · 코미디 강도 ${src.comedyLevel} · 해시 ${src.promptHash}` : `이전 방식(프롬프트 매니저 script v${src.promptVersion})`) : h('div', { class: 'small muted' }, '아직 AI로 만든 대본이 없습니다.'),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' },
        h('label', { class: 'row small', style: 'gap:6px' }, '프리셋', h('select', { 'aria-label': '프리셋', style: 'width:auto', onchange: (e) => save({ presetId: e.target.value }) }, list.presets.map((p) => h('option', { value: p.id, selected: p.id === sel.presetId }, p.name)))),
        h('label', { class: 'row small', style: 'gap:6px' }, '버전', h('select', { 'aria-label': '프리셋 버전', style: 'width:auto', onchange: (e) => save({ version: e.target.value ? Number(e.target.value) : null }) }, h('option', { value: '', selected: !sel.version }, `최신 (v${preset.current})`), preset.versions.slice().reverse().map((v) => h('option', { value: v.v, selected: sel.version === v.v }, 'v' + v.v + (v.note ? ' · ' + v.note : ''))))),
        h('label', { class: 'row small', style: 'gap:6px' }, '코미디 강도', h('select', { 'aria-label': '코미디 강도', style: 'width:auto', onchange: (e) => save({ comedyLevel: Number(e.target.value) }) }, LEVELS.map(([k, l]) => h('option', { value: k, selected: k === sel.comedyLevel }, l))))),
      h('div', { class: 'row', style: 'flex-wrap:wrap' },
        h('button', { class: 'btn sm ghost', onclick: async () => { const r = await call(() => api.post(`/api/episodes/${ep.id}/script/prompt`, { preset: sel })); if (r) showEffectivePrompt(r); } }, '전체 프롬프트 보기'),
        h('button', { class: 'btn sm clay', disabled: !ep.derived.concept.approved, onclick: testIt }, '프롬프트 테스트'),
        route.provider === 'mock' ? h('span', { class: 'small', style: 'color:var(--clay)' }, '대본 AI가 연결되지 않아 테스트도 샘플 초안이 만들어집니다.') : null),
      tests.length ? h('details', null, h('summary', { class: 'small muted', style: 'cursor:pointer' }, `테스트 초안 ${tests.length}개 (현재 대본에는 영향 없음)`),
        h('div', { class: 'list' }, tests.slice(0, 8).map((t) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${t.meta.presetName} v${t.meta.presetVersion} · 강도 ${t.meta.comedyLevel}`), h('div', { class: 'small muted' }, `${new Date(t.at).toLocaleString('ko-KR')} · ${t.mock ? '샘플' : t.provider + '/' + t.model}${t.error ? ' · 규칙 위반으로 저장 안 됨' : ''}`)), h('button', { class: 'btn sm ghost', onclick: () => showTest(t) }, '보기'))))) : null);
  }

  function showTest(t) {
    modal((close) => h('div', { class: 'stack' }, h('h2', null, '프롬프트 테스트 결과'),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, chip(`${t.meta.presetName} v${t.meta.presetVersion}`, 'done'), chip('코미디 강도 ' + t.meta.comedyLevel, ''), t.mock ? chip('샘플', 'mock') : chip(t.provider + '/' + t.model, '')),
      h('div', { class: 'banner' }, h('div', null, '이 초안은 테스트 기록으로만 저장되었습니다. 현재 대본·승인·버전은 바뀌지 않았습니다.')),
      t.error ? h('div', { class: 'banner err' }, h('div', null, h('b', null, t.error.message), (t.error.details || []).slice(0, 5).map((d) => h('div', { class: 'small' }, d)))) : [
        h('b', null, t.draft.title),
        h('div', { class: 'stack', style: 'gap:4px' }, t.draft.scenes.map((s) => h('div', { class: 'small' }, h('b', null, (s.part ? 'PART ' + s.part + ' · ' : '') + s.id + ' · ' + s.title_ko), ' — ' + (s.visual || '').slice(0, 90)))),
        h('div', { class: 'small' }, t.draft.lines.slice(0, 6).map((l) => h('div', null, `${l.speaker}: ${l.en} / ${l.ko}`))),
        t.validation && !t.validation.ok ? h('div', { class: 'small', style: 'color:var(--clay)' }, '검증 문제: ' + t.validation.errors.slice(0, 3).map((e) => e.message).join(' · ')) : h('div', { class: 'small' }, '검증 통과')],
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, '닫기'))), { wide: true });
  }
}
